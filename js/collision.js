// Distance / eating / hostility / absorption-eligibility predicates.
//
// v0.2 splits "consuming something smaller" into two distinct rules:
//   - Orbs (passive growth resources): color is irrelevant, only size matters, eaten instantly.
//   - Same-color Player/AI entities: size-hierarchy governed by the absorption system
//     (see absorption.js) which adds a resistance time instead of instant consumption.
// Different-color Player/AI entities are never consumable — only combat (attack) can remove them.

export function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function circlesOverlap(a, b) {
  return dist(a, b) <= (a.size / 2 + b.size / 2);
}

// Passive orb pickup: color-independent, instant.
export function canEatOrb(eater, orb, balance) {
  if (!orb.alive || !eater.alive) return false;
  if (orb.behavior !== 'orb') return false;
  const minDiff = balance.growth.minEatSizeDifference ?? 0;
  return orb.size < eater.size - minDiff;
}

// Same-color entity hierarchy: eligible to START an absorption (still subject to resistance time).
export function canAbsorb(absorber, target) {
  if (!target.alive || !absorber.alive) return false;
  if (target === absorber) return false;
  if (target.behavior !== 'ai' && target.behavior !== 'player') return false;
  if (target.color !== absorber.color) return false;
  if (target.beingAbsorbedByRef) return false; // already locked by another absorber
  return target.size < absorber.size;
}

// Different-color combatants (orbs are passive resources, never hostile).
export function isHostile(a, b) {
  if (a.color === b.color) return false;
  if (a.behavior === 'orb' || b.behavior === 'orb') return false;
  return true;
}
