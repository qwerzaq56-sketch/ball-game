import { Entity, sizeFromGrowth, computeMaxStack } from './entity.js';
import { canAbsorb, canEatOrb, isHostile, dist } from './collision.js';
import { canStartAttack, startAttack, updateAttack, canStartDodge, startDodge, updateDodge, attackRangeForSize } from './combat.js';

// AI states, implemented in priority order per spec section 25:
// Search -> Chase -> Eat(resolved centrally by Game) -> Attack -> Dodge -> Dead.
// Idle/Recover/Flee are folded into Search/Chase for the prototype.

export class AIEntity extends Entity {
  constructor({ x, y, color, colorHex, balance, startSize }) {
    if (startSize === undefined) startSize = balance.world.minOrbSize * 2.2 + Math.random() * 10;
    super({
      x,
      y,
      size: startSize,
      color,
      colorHex,
      moveSpeed: balance.ai.movementSpeed * (0.8 + Math.random() * 0.4),
      behavior: 'ai',
      hp: startSize * 5,
      maxHp: startSize * 5,
    });
    this.baseSize = startSize;
    this.growth = 0;
    this.state = 'search'; // search | chase_eat | chase_fight | flee
    this.target = null;
    this.decisionTimer = Math.random() * 0.3;
    this._recomputeStacks(balance);
  }

  addGrowth(amount, balance) {
    this.growth += amount;
    const newSize = sizeFromGrowth(this.growth, this.baseSize, balance.growth.growthToSizeRatio);
    const newMaxHp = newSize * 5;
    this.hp = Math.min(this.hp + Math.max(0, newMaxHp - this.maxHp), newMaxHp);
    this.size = newSize;
    this.maxHp = newMaxHp;
    this._recomputeStacks(balance);
  }

  // Size-driven stack capacity, identical rule to Player (spec v0.5 §9, §25) — AI gets no banner,
  // and a capacity increase grants the bonus charge(s) immediately full (see player.js).
  _recomputeStacks(balance) {
    const newAttackMax = computeMaxStack(this.size, balance.skills.attackStackThresholds);
    const newDodgeMax = computeMaxStack(this.size, balance.skills.dodgeStackThresholds);
    this.attackStack += newAttackMax - this.attackMaxStack;
    this.attackMaxStack = newAttackMax;
    this.attackUnlocked = newAttackMax > 0;
    this.dodgeStack += newDodgeMax - this.dodgeMaxStack;
    this.dodgeMaxStack = newDodgeMax;
    this.dodgeUnlocked = newDodgeMax > 0;
  }
}

export function updateAI(ai, dt, game, balance) {
  if (!ai.alive) return;

  updateAttack(ai, dt, balance, game.hostileTargetsFor(ai), game);
  updateDodge(ai, dt, balance);
  // NOTE: attack/dodge stack regen is handled once for every player+ai entity in
  // Game.update()'s shared loop — do not also call updateAttackStack/updateDodgeStack here.
  // (A duplicate call here previously made every AI regenerate stacks at 2x the configured
  // rate, which is what made enemies look like they could attack almost nonstop.)

  // Committed to an attack or dodge animation: no fresh decisions, but charging already
  // moves the entity inside updateAttack/updateDodge.
  if (ai.attackState !== 'READY' || ai.dodgeState === 'DODGING') return;

  // v0.3 spec §1: being absorbed no longer freezes the target — it actively tries to escape
  // by fleeing straight away from its absorber (reuses the normal 'flee' movement branch).
  if (ai.beingAbsorbedByRef) {
    ai.state = 'flee';
    ai.target = ai.beingAbsorbedByRef;
    moveAI(ai, dt, balance);
    return;
  }

  ai.decisionTimer -= dt;
  if (ai.decisionTimer <= 0) {
    ai.decisionTimer = 0.2 + Math.random() * 0.15;
    decideAI(ai, game, balance);
  }

  reactToThreats(ai, game, balance);
  moveAI(ai, dt, balance);
}

// v0.4 spec §15-19: AI actively hunts for absorbable prey instead of only noticing whichever
// happens to be nearest. It scans a wider `absorptionDetectionRange` and picks the target with
// the *biggest size advantage* (not the closest), then follows the priority ladder from §18:
// survival flee > retaliate if just hit > a clearly-winnable absorption > general hostile
// engagement > wander.
// v0.6 spec §8: not every AI attempts an absorption it spots — `willAttemptAbsorption` is
// re-rolled every decision cycle (~0.2-0.35s), so some AI just ignore a winnable absorption
// this cycle and fall through to orb-grazing/combat/wander instead. Keeps the population from
// reading as one predictable hive mind.
function decideAI(ai, game, balance) {
  const cfg = balance.ai;
  const scanRange = Math.max(cfg.detectionRange, cfg.absorptionDetectionRange);
  const nearby = game.getNearbyEntities(ai, scanRange);

  let nearestEdible = null;
  let edibleDist = Infinity;
  let bestAbsorbable = null;
  let bestAbsorbRatio = 0;
  let absorbableDist = Infinity;
  let nearestHostile = null;
  let hostileDist = Infinity;

  for (const other of nearby) {
    if (!other.alive) continue;
    const d = dist(ai, other);
    if (canEatOrb(ai, other, balance) && d < edibleDist) {
      nearestEdible = other;
      edibleDist = d;
    }
    if (d <= cfg.absorptionDetectionRange && canAbsorb(ai, other)) {
      const ratio = ai.size / other.size;
      if (ratio > bestAbsorbRatio) {
        bestAbsorbable = other;
        bestAbsorbRatio = ratio;
        absorbableDist = d;
      }
    }
    if (isHostile(ai, other) && d < hostileDist) {
      nearestHostile = other;
      hostileDist = d;
    }
  }

  // 1. survival — v0.6 spec §13: even at critical HP, don't go to 0% attack probability.
  // Most of the time a low-HP AI still flees, but `lowHealthAttackChance` keeps a small chance
  // open every decision cycle to instead fall through and take a swing if one's available —
  // "생존 행동 우선, 단 공격 시도가 완전히 0이 되지는 않음".
  const hpRatio = ai.hp / ai.maxHp;
  if (nearestHostile && hpRatio <= cfg.fleeThreshold && nearestHostile.size > ai.size) {
    if (Math.random() >= (cfg.lowHealthAttackChance ?? 0)) {
      ai.state = 'flee';
      ai.target = nearestHostile;
      return;
    }
    // else: skip fleeing this cycle and fall through to the normal priority chain below,
    // which may result in a retaliation/attack attempt if conditions allow.
  }

  // v0.6 spec §8: whether this AI even considers an absorption opportunity this cycle at all.
  const willAttemptAbsorption = !!bestAbsorbable && Math.random() < (cfg.absorptionAttemptChance ?? 1);

  // 2a. an overwhelmingly favorable absorption target overrides everything but survival
  if (willAttemptAbsorption && bestAbsorbRatio >= cfg.highPriorityAbsorptionRatio) {
    ai.state = 'chase_eat';
    ai.target = bestAbsorbable;
    return;
  }

  // 2b. retaliate against whoever just hit us, if we can actually fight back
  if (ai.hitFlash > 0 && nearestHostile && ai.attackUnlocked && hostileDist <= attackRangeForSize(ai.size, balance) * 1.5) {
    ai.state = 'chase_fight';
    ai.target = nearestHostile;
    return;
  }

  // 3. a clearly winnable absorption still beats casual orb-grazing or picking a fight
  if (willAttemptAbsorption && bestAbsorbRatio >= cfg.absorptionPriorityRatio) {
    ai.state = 'chase_eat';
    ai.target = bestAbsorbable;
    return;
  }

  // pick whichever consumable target (orb or a marginally-smaller rival) is closest
  const consumeTarget = (bestAbsorbable && absorbableDist < edibleDist) ? bestAbsorbable : nearestEdible;
  const consumeDist = Math.min(absorbableDist, edibleDist);
  if (consumeTarget) {
    ai.state = 'chase_eat';
    ai.target = consumeTarget;
    if (!nearestHostile || consumeDist <= hostileDist) return;
  }

  if (nearestHostile && ai.attackUnlocked && Math.random() < cfg.aggression) {
    ai.state = 'chase_fight';
    ai.target = nearestHostile;
    return;
  }

  if (!consumeTarget) {
    ai.state = 'search';
    ai.target = null;
  }
}

function reactToThreats(ai, game, balance) {
  if (!ai.dodgeUnlocked || !canStartDodge(ai)) return;
  const range = attackRangeForSize(ai.size, balance) * 1.5;
  const nearby = game.getNearbyEntities(ai, range);
  for (const other of nearby) {
    if (other.attackState === 'TELEGRAPH' && isHostile(ai, other)) {
      const d = dist(ai, other);
      if (d < range && Math.random() < 0.5) {
        const away = Math.atan2(ai.y - other.y, ai.x - other.x);
        startDodge(ai, away, balance);
        return;
      }
    }
  }
}

function moveAI(ai, dt, balance) {
  let targetAngle = null;
  let speed = ai.moveSpeed;

  if (ai.state === 'flee' && ai.target) {
    targetAngle = Math.atan2(ai.y - ai.target.y, ai.x - ai.target.x);
    // v0.3: fleeing a low-HP threat gets a burst of speed, but fleeing an absorption grab
    // (spec §1) does not — you're still partly held, so the absorber gets a fair chance.
    speed *= ai.beingAbsorbedByRef ? 1.0 : 1.3;
  } else if (ai.state === 'chase_eat' && ai.target && ai.target.alive) {
    // actual eating/absorption is resolved centrally in Game.resolveConsumption()
    targetAngle = Math.atan2(ai.target.y - ai.y, ai.target.x - ai.x);
  } else if (ai.state === 'chase_fight' && ai.target && ai.target.alive) {
    const d = dist(ai, ai.target);
    targetAngle = Math.atan2(ai.target.y - ai.y, ai.target.x - ai.x);
    if (d <= attackRangeForSize(ai.size, balance) && canStartAttack(ai)) {
      startAttack(ai, targetAngle, balance);
      return;
    }
  } else {
    ai.wanderTimer -= dt;
    if (ai.wanderTimer <= 0) {
      ai.wanderAngle = Math.random() * Math.PI * 2;
      ai.wanderTimer = 1 + Math.random() * 2;
    }
    targetAngle = ai.wanderAngle;
    speed *= 0.55;
  }

  if (targetAngle !== null) {
    ai.facing = targetAngle;
    ai.x += Math.cos(targetAngle) * speed * dt;
    ai.y += Math.sin(targetAngle) * speed * dt;
  }
}
