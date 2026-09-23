import { Entity } from './entity.js';
import { AIEntity } from './ai.js';

function randomColor(balance) {
  return balance.colors[Math.floor(Math.random() * balance.colors.length)];
}

function randomWorldPos(balance) {
  return {
    x: Math.random() * balance.world.worldWidth,
    y: Math.random() * balance.world.worldHeight,
  };
}

// v0.2: Orb and Fragment are unified — both are just "orb" behavior entities. Color is kept
// purely for visual variety / to mark which faction an orb came from; it no longer gates
// whether it can be eaten (see collision.js#canEatOrb).
export function spawnOrb(balance, pos = null) {
  const c = randomColor(balance);
  const size = balance.world.minOrbSize + Math.random() * (balance.world.maxOrbSize - balance.world.minOrbSize);
  const { x, y } = pos || randomWorldPos(balance);
  const growthValue = Math.round(5 + (size - balance.world.minOrbSize) * 2);
  return new Entity({
    x,
    y,
    size,
    color: c.id,
    colorHex: c.color,
    growthValue,
    moveSpeed: 0,
    behavior: 'orb',
    hp: 1,
    maxHp: 1,
  });
}

// v0.3 spec §3: enemies spawn from a small/medium/large size distribution (weighted toward
// small) instead of one fixed formula, so the early map isn't dominated by big AI.
// v0.5 spec §17: the ceiling of that distribution now tracks the player's own Size — as the
// player grows, medium/large spawns are allowed to grow with them (so bigger, riskier fights
// keep appearing), while the small tier stays fixed so there's always a easy, safe option too
// (QA §"모든 적이 플레이어보다 크게 생성되는 것은 아닌가?").
function rollEnemySize(balance, playerSize) {
  const cfg = balance.enemySpawn;
  const es = balance.enemyScaling;
  const enemyMaxSize = es.baseEnemyMaxSize + playerSize * es.enemyMaxSizePerPlayerSize;

  const roll = Math.random();
  if (roll < cfg.smallSizeRatio) {
    return cfg.smallSizeMin + Math.random() * (cfg.smallSizeMax - cfg.smallSizeMin);
  }
  if (roll < cfg.smallSizeRatio + cfg.mediumSizeRatio) {
    const medMax = Math.max(cfg.mediumSizeMin + 1, Math.min(cfg.mediumSizeMax, enemyMaxSize * 0.7));
    return cfg.mediumSizeMin + Math.random() * (medMax - cfg.mediumSizeMin);
  }
  const largeMin = Math.max(cfg.largeSizeMin, enemyMaxSize * 0.7);
  const largeMax = Math.max(largeMin + 1, Math.max(cfg.largeSizeMax, enemyMaxSize));
  return largeMin + Math.random() * (largeMax - largeMin);
}

export function spawnAI(balance, colorDef, pos = null, playerSize = 20) {
  const { x, y } = pos || randomWorldPos(balance);
  const startSize = rollEnemySize(balance, playerSize);
  return new AIEntity({ x, y, color: colorDef.id, colorHex: colorDef.color, balance, startSize });
}

// Orbs generated when a Player/AI dies in combat — same Entity type and same size/growthValue
// formula as spawnOrb() (spec v0.2 §4: no more separate "Fragment", and there never has been
// one since — everything growth-giving is just "Orb" behavior). Only the color (kept from the
// dead entity, so a kill's reward reads as "belonging" to that spot) and the spawn distribution
// differ from a natural field orb.
//
// v0.6 spec §10-12: the direct Growth reward for a kill was cut way down (see
// game.js#onEntityDeath's killReward.growthRewardMultiplier), and that Growth moved here
// instead — the player has to actually go collect the payoff (and is exposed while doing it)
// rather than just insta-growing on the kill itself.
//
// v0.6 follow-up: these used to be a fixed tiny size (`orbSize`) with a flat `orbGrowthValue`
// and a cosmetic cross-mark — visually a uniform little "sparkle" instead of a natural-looking
// orb cluster, and the flat per-orb value meant total reward flattened out once `orbMaxCount`
// capped the *count* (a size-300+ kill was worth the same total Growth as a size-270 one).
// Now each orb's size is randomized like a field orb, but the *range* it's drawn from widens
// with the killed entity's Size — a bigger kill drops both more AND individually bigger/more
// valuable orbs, so total reward keeps climbing well past the point where orb count alone caps
// out (§ see BALANCE_NOTES for the math). Spread radius also scales more aggressively with Size
// so a big kill's reward visibly fans out across the field instead of clumping on one spot.
export function spawnDeathOrbs(deadEntity, balance) {
  const kr = balance.killReward;
  const w = balance.world;
  const count = Math.min(kr.orbMaxCount, Math.round(kr.orbBaseCount + deadEntity.size * kr.orbPerEnemySize));
  const orbs = [];
  const naturalSpread = w.maxOrbSize - w.minOrbSize;
  const sizeSpread = Math.max(naturalSpread, deadEntity.size * kr.orbSizeGrowthPerEnemySize);
  const spreadRadius = deadEntity.size * kr.orbSpreadMultiplier + kr.orbSpreadBase;
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.random() * spreadRadius;
    const size = w.minOrbSize + Math.random() * sizeSpread;
    const growthValue = Math.round(5 + (size - w.minOrbSize) * 2); // same value-density formula as a natural orb
    const orb = new Entity({
      x: deadEntity.x + Math.cos(angle) * dist,
      y: deadEntity.y + Math.sin(angle) * dist,
      size,
      color: deadEntity.color,
      colorHex: deadEntity.colorHex,
      growthValue,
      moveSpeed: 0,
      behavior: 'orb',
      hp: 1,
      maxHp: 1,
    });
    orbs.push(orb);
  }
  return orbs;
}
