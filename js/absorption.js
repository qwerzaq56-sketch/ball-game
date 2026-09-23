// Absorption system for same-color Player/AI hierarchy.
//
// v0.5 rework (spec §10-14): absorption no longer requires the two balls to physically overlap.
// A bigger ball projects a "maintain distance" (Size-scaled) around itself; any smaller
// same-color ball inside that range is connected by a visible link and drains toward the
// absorber at a rate that scales continuously with distance — fast up close, slow at the edge,
// and zero (connection severed) past maintainDistance. This replaces the discrete
// escape/break-distance step model from v0.3/v0.4 entirely.
//
// This is also a structural bug fix, not just a feature: v0.3/v0.4's position-pulling physics
// could reach a stable equilibrium where a fleeing target neither escaped nor got absorbed (see
// v0.4's BALANCE_NOTES for the postmortem). v0.5 has no antagonistic position-pulling loop to
// fight over — the connection speed is a pure function of the current distance every frame, so
// there is nothing for a "stuck forever" equilibrium to form around. A light cosmetic pull
// (`pullForce`) still eases the target toward the absorber for feel, but it never gates whether
// progress advances — only distance does.

export function maintainDistanceFor(absorber, balance) {
  const cfg = balance.absorption;
  return cfg.baseMaintainDistance + absorber.size * cfg.maintainDistancePerSize;
}

export function resistanceTimeFor(target, balance) {
  const cfg = balance.absorption;
  return Math.max(0.05, cfg.baseResistanceTime + target.size * cfg.resistancePerSize);
}

export function startAbsorption(absorber, target, balance, game) {
  target.beingAbsorbedByRef = absorber;
  target.absorptionProgress = 0;
  target.absorptionRequired = resistanceTimeFor(target, balance);
  if (game && (absorber === game.player || target === game.player)) game.audio.absorbStart();
}

export function cancelAbsorption(target) {
  target.beingAbsorbedByRef = null;
  target.absorptionProgress = 0;
  target.absorptionRequired = 0;
}

function completeAbsorption(absorber, target, game, balance) {
  const gained = target.behavior === 'orb' ? target.growthValue : target.growth;
  absorber.addGrowth(gained, balance);
  game.spawnAbsorptionParticles(target.x, target.y, target.colorHex);
  absorber.scalePulseTimer = 0.3; // short "grew bigger" scale pulse on the absorber
  if (absorber === game.player || target === game.player) game.audio.absorbSuccess();
  if (absorber === game.player) {
    game.spawnFloatingText(absorber.x, absorber.y - absorber.size / 2 - 10, `+${Math.round(gained)} GROWTH`, '#93c5fd');
    game.score += Math.round(gained);
  }
  cancelAbsorption(target);

  if (target.behavior === 'player') {
    // v0.6 spec §16: being fully absorbed costs a Life exactly like a combat death — route
    // through the same shared handler so Game Over triggers consistently either way.
    game.handlePlayerDefeat('ABSORBED');
  } else {
    // Kill Count only tracks the player's own attack finishing an enemy off, not absorption —
    // so no kills++ here even when the player is the absorber.
    target.alive = false;
  }
}

// Advances every in-progress absorption: the connection's fill rate scales continuously with
// distance (max speed at 0, zero at maintainDistance), a light cosmetic pull eases the target
// inward without ever being strong enough to trap it, and the whole thing severs the instant the
// target drifts past maintainDistance, the size hierarchy flips, or the absorber dies.
export function updateAbsorptions(game, dt, balance) {
  const cfg = balance.absorption;
  for (const target of game.entities) {
    if (!target.alive || !target.beingAbsorbedByRef) continue;
    const absorber = target.beingAbsorbedByRef;

    if (!absorber.alive || target.size >= absorber.size) {
      cancelAbsorption(target);
      continue;
    }

    const maintainDistance = maintainDistanceFor(absorber, balance);
    const d = Math.hypot(target.x - absorber.x, target.y - absorber.y);
    if (d > maintainDistance) {
      cancelAbsorption(target);
      continue;
    }

    const proximity = 1 - Math.min(1, d / maintainDistance); // 1 at contact, 0 at the edge
    target.absorptionProgress += cfg.maxAbsorptionSpeed * proximity * dt;

    if (proximity > 0) {
      const pull = 1 - Math.pow(1 - cfg.pullForce * proximity, dt);
      target.x += (absorber.x - target.x) * pull;
      target.y += (absorber.y - target.y) * pull;
    }

    if (target.absorptionProgress >= target.absorptionRequired) {
      completeAbsorption(absorber, target, game, balance);
    }
  }
}
