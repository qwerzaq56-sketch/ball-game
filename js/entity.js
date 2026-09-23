// Base entity used by orbs (incl. death-spawned orbs), AI balls and the player.
// v0.2: Size is the single unified stat driving edibility, skill stage, and combat range —
// see computeMaxStack() below and combatScaling in combat.js.
// v0.3: added knockback physics fields (see combat.js#updateKnockback).
// v0.5: attack/dodge are no longer a single "unlocked + cooldown" pair — they're stack-based
// resources whose *capacity* is driven by Size (see computeMaxStack() below), shared identically
// by Player and AI. Also added Defense (see combat.js#defenseForSize).

let nextId = 1;

export function sizeFromGrowth(growth, baseSize, growthToSizeRatio) {
  return baseSize + Math.sqrt(Math.max(growth, 0)) * growthToSizeRatio;
}

// v0.5: generic threshold-list lookup shared by attack/dodge stack capacity. Thresholds are
// [{size, maxStack}, ...] sorted ascending; returns the maxStack of the highest threshold met,
// or 0 below the first one. Adding a Stage 3/4 later is just adding another entry — no code
// changes needed (spec §25's "배열 또는 설정 데이터 구조" request).
export function computeMaxStack(size, thresholds) {
  let stack = 0;
  for (const t of thresholds) {
    if (size >= t.size) stack = t.maxStack;
  }
  return stack;
}

export class Entity {
  constructor({ x, y, size, color, colorHex, growthValue = 0, moveSpeed = 80, behavior = 'orb', hp = null, maxHp = null }) {
    this.id = nextId++;
    this.x = x;
    this.y = y;
    this.size = size;
    this.color = color;
    this.colorHex = colorHex;
    this.growthValue = growthValue;
    this.moveSpeed = moveSpeed;
    this.behavior = behavior; // 'orb' | 'ai' | 'player'
    this.maxHp = maxHp ?? size * 5;
    this.hp = hp ?? this.maxHp;
    this.alive = true;
    this.facing = 0;

    this.wanderAngle = Math.random() * Math.PI * 2;
    this.wanderTimer = 0;

    // shared attack state machine (see combat.js) — one attack "in flight" at a time, gated by
    // attackStack rather than a cooldown timer (v0.5 §7)
    this.attackState = 'READY'; // READY | TELEGRAPH | CHARGING | RECOVERY
    this.attackTimer = 0;
    this.attackDir = 0;
    this.attackHitSet = new Set();
    this.trail = [];
    this.currentAttackRange = 0; // snapshotted from size when an attack starts
    this.currentChargeDistance = 0; // snapshotted from size when an attack starts (v0.5 §6)
    this.currentChargeDuration = 0; // snapshotted from size when an attack starts (v0.6 §4-2)
    this.attackStack = 0;
    this.attackMaxStack = 0;
    this.attackStackTimer = 0;
    // v0.6 §3: a hard minimum-spacing gate between AI attacks, independent of stack count — a
    // large AI with 2 stacks can still only fire the second one after this timer clears, so
    // "has stacks" no longer means "can burst them out instantly". Unused by the player.
    this.aiAttackGateTimer = 0;

    // shared dodge state machine — same stack model as attack (v0.5 §8)
    this.dodgeState = 'READY'; // READY | DODGING
    this.dodgeTimer = 0;
    this.dodgeDir = 0;
    this.invincible = false;
    this.dodgeTrail = [];
    this.currentDodgeDistance = 0; // snapshotted from size when a dodge starts
    this.dodgeStack = 0;
    this.dodgeMaxStack = 0;
    this.dodgeStackTimer = 0;

    // shared absorption state: set on the entity being absorbed, referencing its absorber.
    // v0.5 reworks this to a continuous distance-based connection (see absorption.js) instead
    // of the discrete escape/break-distance model from v0.3/v0.4.
    this.beingAbsorbedByRef = null;
    this.absorptionProgress = 0;
    this.absorptionRequired = 0;

    this.hitFlash = 0;
    this.attackUnlocked = false; // derived: attackMaxStack > 0
    this.dodgeUnlocked = false; // derived: dodgeMaxStack > 0

    // v0.3 knockback impulse (see combat.js#applyDamage / #updateKnockback)
    this.kx = 0;
    this.ky = 0;
    this.knockbackTimer = 0;
    this.knockbackDuration = 0;

    // v0.4: seconds since last taking damage (see combat.js#updateHealthRegen)
    this.regenTimer = 999;
    // v0.4: brief "grew bigger" scale pulse played on a successful absorption (render-only)
    this.scalePulseTimer = 0;
  }
}
