// Shared attack (telegraph -> charge -> recovery) and dodge (instant -> invincible burst)
// state machines. Both Player and AI entities use the exact same functions so the two
// systems behave identically wherever they can.
//
// v0.2: attack range and dodge distance are no longer fixed globals — they scale with the
// entity's own Size (spec §16-18), snapshotted at the moment the action starts.
// v0.3: dodge now has priority over attack (can cancel telegraph/charge/recovery — spec §8),
// hits apply knockback and cancel any in-progress absorption on the target (spec §12-13),
// and dodge afterimages fade out on a real timer instead of lingering forever (spec §7).
// v0.4: attack damage scales with Size, HP regenerates after a no-damage delay.
// v0.5: attack/dodge are stack-based resources instead of a single-shot cooldown (spec §7-8,
// §25) — `attackCooldown`/`dodgeCooldown` are now the *per-stack regen interval*, not a
// mandatory wait between every use. Defense reduces incoming damage (spec §3). Charge distance
// is derived from the attack's own range instead of a fixed speed constant, fixing the v0.4 bug
// where a bigger attack range didn't actually make the dash travel any further (spec §6).
// v0.6: Defense moved under combatScaling (spec §2-1) — it's Size-driven combat scaling, not
// its own subsystem. Attack *charge duration* now also scales with Size (spec §4-2, separate
// from charge *distance* — see startAttack), and AI gets its own, slower attack cadence: a
// dedicated `ai.attackCooldown` for stack regen plus a hard per-attack gate
// (`aiAttackGateTimer`) so a multi-stack AI can't burst every charge out instantly (spec §3).
// Dodge distance switches from the exponential Size curve to the flat linear one the spec
// gives directly (spec §6): `baseDistance + size * distanceGrowth`.

import { cancelAbsorption } from './absorption.js';

export function attackDamageForSize(size, balance) {
  const c = balance.combatScaling;
  return Math.max(1, c.baseAttackDamage + size * c.attackDamagePerSize);
}

export function defenseForSize(size, balance) {
  const c = balance.combatScaling;
  return Math.max(0, c.baseDefense + size * c.defensePerSize);
}

export function applyDefense(rawDamage, targetSize, balance) {
  const c = balance.combatScaling;
  return Math.max(c.minimumDamage, rawDamage - defenseForSize(targetSize, balance));
}

export function attackRangeForSize(size, balance) {
  const c = balance.combatScaling;
  return Math.max(20, c.baseAttackRange * Math.pow(size / c.referenceSize, c.attackRangeGrowthExponent));
}

// v0.6 spec §4-2: bigger balls hit harder and further, but need longer to wind up — a
// deliberate risk/reward tradeoff, not just a range bonus. Independent of attackRangeForSize;
// see startAttack for how the two combine into an actual dash speed.
export function attackChargeDurationForSize(size, balance) {
  const c = balance.combatScaling;
  return Math.max(0.05, c.attackChargeDurationBase + size * c.attackChargeDurationPerSize);
}

// v0.6 balance pass: Telegraph time used to be a flat constant (0.4s for every size) — now it
// scales with Size exactly like Charge Duration, so a bigger ball also gives opponents more
// visible warning before it commits, not just a longer wind-up once it's already charging.
export function attackTelegraphTimeForSize(size, balance) {
  const c = balance.combatScaling;
  return Math.max(0.05, c.attackTelegraphTimeBase + size * c.attackTelegraphTimePerSize);
}

// v0.6 spec §6: linear instead of v0.5's exponential curve — Base(100) + Size × Growth(0.8).
export function dodgeDistanceForSize(size, balance) {
  const d = balance.dodge;
  return Math.max(20, d.baseDistance + size * d.distanceGrowth);
}

export function canStartAttack(entity) {
  if (entity.attackStack <= 0 || entity.attackState !== 'READY' || entity.dodgeState === 'DODGING') return false;
  if (entity.behavior === 'ai' && entity.aiAttackGateTimer > 0) return false;
  return true;
}

export function startAttack(entity, dirAngle, balance) {
  entity.attackStack -= 1;
  entity.attackState = 'TELEGRAPH';
  entity.attackDir = dirAngle;
  entity.attackTimer = 0;
  entity.attackHitSet.clear();
  entity.trail = [];
  const c = balance.combatScaling;
  entity.currentAttackRange = attackRangeForSize(entity.size, balance);
  entity.currentChargeDistance = entity.currentAttackRange * c.chargeDistanceMultiplier;
  entity.currentChargeDuration = attackChargeDurationForSize(entity.size, balance);
  entity.currentTelegraphTime = attackTelegraphTimeForSize(entity.size, balance);
  if (entity.behavior === 'ai') entity.aiAttackGateTimer = balance.ai.attackCooldown;
}

export function updateAttack(entity, dt, balance, hostiles, game) {
  const cfg = balance.attack;

  if (entity.hitFlash > 0) entity.hitFlash -= dt;

  switch (entity.attackState) {
    case 'TELEGRAPH': {
      entity.attackTimer += dt;
      if (entity.attackTimer >= entity.currentTelegraphTime) {
        entity.attackState = 'CHARGING';
        entity.attackTimer = 0;
        if (game && entity === game.player) game.audio.attackCharge();
      }
      break;
    }
    case 'CHARGING': {
      entity.attackTimer += dt;
      // v0.5 fix: speed is derived from the range-scaled charge distance so a bigger attack
      // range always means the dash actually travels further, not just a wider hit padding.
      // v0.6: the duration it's spread over now also scales with Size independently (see
      // attackChargeDurationForSize) — a bigger ball's dash covers more ground but takes longer.
      const speed = entity.currentChargeDistance / entity.currentChargeDuration;
      entity.x += Math.cos(entity.attackDir) * speed * dt;
      entity.y += Math.sin(entity.attackDir) * speed * dt;
      entity.trail.push({ x: entity.x, y: entity.y });
      if (entity.trail.length > 8) entity.trail.shift();

      const hitPadding = entity.currentAttackRange * 0.2;
      const rawDamage = attackDamageForSize(entity.size, balance);
      for (const target of hostiles) {
        if (!target.alive || entity.attackHitSet.has(target.id)) continue;
        const d = Math.hypot(target.x - entity.x, target.y - entity.y);
        if (d <= entity.size / 2 + target.size / 2 + hitPadding) {
          applyDamage(target, rawDamage, game, entity, balance);
          entity.attackHitSet.add(target.id);
        }
      }

      if (entity.attackTimer >= entity.currentChargeDuration) {
        entity.attackState = 'RECOVERY';
        entity.attackTimer = 0;
      }
      break;
    }
    case 'RECOVERY': {
      entity.attackTimer += dt;
      if (entity.attackTimer >= cfg.attackRecoveryTime) {
        entity.attackState = 'READY';
        entity.attackTimer = 0;
        entity.trail = [];
      }
      break;
    }
  }
}

// v0.5: attackStack/dodgeStack refill one charge at a time, every `cooldownSeconds`, capped at
// the entity's current max (itself Size-driven — see entity.js#computeMaxStack and
// player.js/ai.js's skill-stage recompute).
// v0.6: `cooldownSeconds` is now passed in explicitly rather than always read from
// `balance.attack.attackCooldown` — AI uses its own, slower `balance.ai.attackCooldown` (spec
// §3), the player keeps `balance.attack.attackCooldown`. See game.js's shared per-entity loop.
export function updateAttackStack(entity, dt, cooldownSeconds) {
  if (entity.aiAttackGateTimer > 0) entity.aiAttackGateTimer = Math.max(0, entity.aiAttackGateTimer - dt);
  if (entity.attackStack >= entity.attackMaxStack) {
    entity.attackStackTimer = 0;
    return;
  }
  entity.attackStackTimer += dt;
  if (entity.attackStackTimer >= cooldownSeconds) {
    entity.attackStackTimer -= cooldownSeconds;
    entity.attackStack = Math.min(entity.attackMaxStack, entity.attackStack + 1);
  }
}

export function updateDodgeStack(entity, dt, balance) {
  if (entity.dodgeStack >= entity.dodgeMaxStack) {
    entity.dodgeStackTimer = 0;
    return;
  }
  entity.dodgeStackTimer += dt;
  if (entity.dodgeStackTimer >= balance.dodge.dodgeCooldown) {
    entity.dodgeStackTimer -= balance.dodge.dodgeCooldown;
    entity.dodgeStack = Math.min(entity.dodgeMaxStack, entity.dodgeStack + 1);
  }
}

// v0.5: applyDamage now runs raw damage through Defense (spec §3) before it touches HP.
export function applyDamage(target, rawDamage, game, attacker, balance) {
  if (target.invincible || !target.alive) return;
  const bal = balance || (game && game.balance);
  const dmg = bal ? applyDefense(rawDamage, target.size, bal) : rawDamage;
  const cfg = game ? game.balance.combat : null;

  target.hp -= dmg;
  target.hitFlash = cfg ? cfg.hitFlashDuration : 0.08;
  target.regenTimer = 0; // taking a hit resets the HP regen delay

  if (attacker) applyKnockback(target, attacker, game);
  if (target.beingAbsorbedByRef) cancelAbsorption(target); // a hit breaks an absorption connection

  if (game) {
    game.spawnHitParticles(target.x, target.y, target.colorHex);
    if (attacker === game.player) game.audio.hit();
    if (target === game.player) game.audio.damage();
  }

  if (target.hp <= 0) {
    target.hp = 0;
    target.alive = false;
    if (game) game.onEntityDeath(target, attacker);
  }
}

// Bigger targets resist knockback more (received = base / (size / referenceSize)).
function applyKnockback(target, attacker, game) {
  if (!game) return;
  const cfg = game.balance.combat;
  const cs = game.balance.combatScaling;
  const dir = Math.atan2(target.y - attacker.y, target.x - attacker.x);
  const speed = (cs.knockbackForce * cfg.knockbackResistance) / Math.max(0.2, target.size / cs.referenceSize);
  target.kx = Math.cos(dir) * speed;
  target.ky = Math.sin(dir) * speed;
  target.knockbackTimer = cfg.knockbackDuration;
  target.knockbackDuration = cfg.knockbackDuration;
}

// v0.4 spec §6-11: HP regenerates automatically, but only after `delay` seconds have passed
// since the last hit. v0.5: both the delay and the rate now come from Size (spec §15).
export function updateHealthRegen(entity, dt, balance) {
  entity.regenTimer += dt;
  const cfg = balance.healthRegen;
  if (entity.hp >= entity.maxHp || entity.regenTimer < cfg.delay) return false;
  const rate = cfg.baseRate + entity.size * cfg.regenPerSize;
  entity.hp = Math.min(entity.maxHp, entity.hp + rate * dt);
  return true;
}

// Eases the knockback impulse out to zero over knockbackDuration. Called every frame for
// every living player/AI entity, independent of attack/dodge/absorption state.
export function updateKnockback(entity, dt) {
  if (entity.knockbackTimer <= 0) return;
  const fraction = entity.knockbackTimer / entity.knockbackDuration;
  entity.x += entity.kx * fraction * dt;
  entity.y += entity.ky * fraction * dt;
  entity.knockbackTimer -= dt;
  if (entity.knockbackTimer <= 0) {
    entity.knockbackTimer = 0;
    entity.kx = 0;
    entity.ky = 0;
  }
}

// v0.3 spec §8: dodge has priority — it can cancel an in-progress attack outright.
export function canStartDodge(entity) {
  return entity.dodgeStack > 0 && entity.dodgeState === 'READY';
}

export function startDodge(entity, dirAngle, balance) {
  entity.dodgeStack -= 1;

  entity.attackState = 'READY';
  entity.attackTimer = 0;
  entity.trail = [];

  entity.dodgeState = 'DODGING';
  entity.dodgeDir = dirAngle;
  entity.dodgeTimer = 0;
  entity.invincible = true;
  entity.currentDodgeDistance = dodgeDistanceForSize(entity.size, balance);
}

export function updateDodge(entity, dt, balance) {
  if (entity.dodgeState === 'DODGING') {
    const cfg = balance.dodge;
    entity.dodgeTimer += dt;
    const speed = entity.currentDodgeDistance / cfg.dodgeDuration;
    entity.x += Math.cos(entity.dodgeDir) * speed * dt;
    entity.y += Math.sin(entity.dodgeDir) * speed * dt;
    entity.dodgeTrail.push({ x: entity.x, y: entity.y, life: balance.dodge.effectLifetime });

    if (entity.dodgeTimer >= cfg.dodgeInvincibleTime) {
      entity.invincible = false;
    }
    if (entity.dodgeTimer >= cfg.dodgeDuration) {
      entity.dodgeState = 'READY';
      entity.invincible = false;
    }
  }

  // age and prune afterimages every frame (not just while dodging) so they always fully clear
  if (entity.dodgeTrail.length) {
    for (const t of entity.dodgeTrail) t.life -= dt;
    entity.dodgeTrail = entity.dodgeTrail.filter((t) => t.life > 0);
  }
}
