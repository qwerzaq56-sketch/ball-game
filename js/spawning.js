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

// Orbs generated when a Player/AI dies in combat — same Entity type as spawnOrb(), just
// smaller and keeping the dead entity's color (spec v0.2 §4: no more separate "Fragment").
export function spawnDeathOrbs(deadEntity, balance) {
  const cfg = balance.deathOrb;
  const orbs = [];
  for (let i = 0; i < cfg.deathOrbCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.random() * (deadEntity.size + 20);
    const orb = new Entity({
      x: deadEntity.x + Math.cos(angle) * dist,
      y: deadEntity.y + Math.sin(angle) * dist,
      size: cfg.deathOrbSize,
      color: deadEntity.color,
      colorHex: deadEntity.colorHex,
      growthValue: cfg.deathOrbGrowthValue,
      moveSpeed: 0,
      behavior: 'orb',
      hp: 1,
      maxHp: 1,
    });
    orb.fromDeath = true; // purely cosmetic marker, does not affect eating rules
    orbs.push(orb);
  }
  return orbs;
}
