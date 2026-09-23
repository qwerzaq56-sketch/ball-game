import { Player } from './player.js';
import { AIEntity, updateAI } from './ai.js';
import { canEatOrb, canAbsorb, isHostile, circlesOverlap, dist } from './collision.js';
import {
  updateAttack, updateDodge, updateKnockback, updateHealthRegen,
  updateAttackStack, updateDodgeStack, attackRangeForSize,
  canStartAttack, startAttack, canStartDodge, startDodge,
} from './combat.js';
import { spawnOrb, spawnAI, spawnDeathOrbs } from './spawning.js';
import { startAbsorption, updateAbsorptions, maintainDistanceFor } from './absorption.js';
import { AudioManager } from './audio.js';

const CELL_SIZE = 220;

export class Game {
  constructor(balance, canvas, input, ui) {
    this.balance = balance;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.input = input;
    this.ui = ui;

    this.audio = new AudioManager(balance);
    this.onGameOver = null; // set by main.js — persists across reset()
    this._absorbDroneActive = false;

    this.reset();
  }

  // v0.6 spec §14: "전체 초기화" rebuilds every piece of runtime state exactly as a fresh page
  // load would, WITHOUT touching audio/canvas/input wiring (session-level, not run-level) or the
  // Top 10 scoreboard (which lives entirely in storage.js/localStorage and is a deliberately
  // separate action — see spec §14/§17). Also doubles as the constructor's own init path so
  // there's only one place that defines "what a fresh run looks like".
  reset() {
    this.player = new Player(this.balance);
    this.player.onSkillUnlock = (type) => {
      this.ui.showUnlock(type);
      this.audio.unlock();
    };
    this.entities = [this.player];
    this.particles = [];
    this.floatingTexts = [];
    this.grid = new Map();
    this.orbSpawnTimer = 0;
    this.enemySpawnTimer = 0;
    this.paused = false;
    this.gameOver = false;
    this.lives = this.balance.lives.maxLives;
    this.score = 0;
    if (this._absorbDroneActive) {
      this.audio.stopAbsorbDrone();
      this._absorbDroneActive = false;
    }

    this.camera = {
      x: this.player.x,
      y: this.player.y,
      zoom: this.balance.camera.baseZoom,
    };

    this.initWorld();
  }

  initWorld() {
    const b = this.balance;

    for (let i = 0; i < b.spawning.initialOrbCount; i++) this.entities.push(spawnOrb(b));

    const perColor = Math.max(1, Math.floor(b.spawning.initialEnemyCount / b.colors.length));
    for (const c of b.colors) {
      for (let i = 0; i < perColor; i++) {
        this.entities.push(spawnAI(b, c, this.pickSafeSpawnPos(350), this.player.size));
      }
    }
  }

  // Finds a random world position at least `safeRadius` away from the player, retrying a few
  // times; falls back to a fully random spot if it can't find one (keeps AI from spawning right
  // on top of the player — used both at world init and by the ongoing enemy spawn loop).
  pickSafeSpawnPos(safeRadius) {
    const b = this.balance;
    const px = this.player.x;
    const py = this.player.y;
    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate = {
        x: Math.random() * b.world.worldWidth,
        y: Math.random() * b.world.worldHeight,
      };
      if (Math.hypot(candidate.x - px, candidate.y - py) >= safeRadius) return candidate;
    }
    return null;
  }

  // ---------- spatial grid ----------

  buildGrid() {
    this.grid.clear();
    for (const e of this.entities) {
      if (!e.alive) continue;
      const cx = Math.floor(e.x / CELL_SIZE);
      const cy = Math.floor(e.y / CELL_SIZE);
      const key = cx + ',' + cy;
      let arr = this.grid.get(key);
      if (!arr) {
        arr = [];
        this.grid.set(key, arr);
      }
      arr.push(e);
    }
  }

  getNearbyEntities(entity, range) {
    const result = [];
    const minCx = Math.floor((entity.x - range) / CELL_SIZE);
    const maxCx = Math.floor((entity.x + range) / CELL_SIZE);
    const minCy = Math.floor((entity.y - range) / CELL_SIZE);
    const maxCy = Math.floor((entity.y + range) / CELL_SIZE);
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const arr = this.grid.get(cx + ',' + cy);
        if (!arr) continue;
        for (const e of arr) if (e !== entity) result.push(e);
      }
    }
    return result;
  }

  hostileTargetsFor(entity) {
    // v0.5: charge distance now scales with attack range (see combat.js), so the candidate
    // scan radius has to cover that instead of the old fixed chargeSpeed*duration distance.
    const c = this.balance.combatScaling;
    const range = attackRangeForSize(entity.size, this.balance) * c.chargeDistanceMultiplier + entity.size + 40;
    return this.getNearbyEntities(entity, range).filter((o) => isHostile(entity, o));
  }

  // ---------- update ----------

  update(dt) {
    if (this.paused) return;
    const b = this.balance;

    this.buildGrid();
    this.updatePlayer(dt);

    for (const e of this.entities) {
      if (e.behavior === 'ai' && e.alive) updateAI(e, dt, this, b);
    }

    for (const e of this.entities) {
      if (!e.alive || (e.behavior !== 'player' && e.behavior !== 'ai')) continue;
      updateKnockback(e, dt);
      const regenerating = updateHealthRegen(e, dt, b);
      if (regenerating && Math.random() < 0.15) this.spawnRegenParticle(e.x, e.y, e.size);
      if (e.scalePulseTimer > 0) e.scalePulseTimer = Math.max(0, e.scalePulseTimer - dt);
      // v0.6 spec §3: AI regenerates attack stacks on its own (slower) cooldown, separate from
      // the player's — see combat.js#updateAttackStack and gameBalance.json's `ai.attackCooldown`.
      const attackCooldown = e.behavior === 'ai' ? b.ai.attackCooldown : b.attack.attackCooldown;
      updateAttackStack(e, dt, attackCooldown);
      updateDodgeStack(e, dt, b);
    }

    this.resolveConsumption();
    updateAbsorptions(this, dt, b);
    this.resolvePushApart();
    this.clampAllToWorld();
    this.updateCamera(dt);
    this.updateParticles(dt);
    this.updateFloatingTexts(dt);
    this.updatePlayerAbsorbDrone();
    this.orbSpawnLoop(dt);
    this.enemySpawnLoop(dt);
    this.cleanupDead();
  }

  // v0.6 spec §9: a continuous, progress-driven absorption drone plays whenever the player is
  // involved in an active absorption (either side), instead of only a start/success one-shot.
  // Checks at most once per frame; the drone itself is a persistent oscillator/gain/filter graph
  // whose parameters are eased in place (see audio.js), never recreated.
  updatePlayerAbsorbDrone() {
    const p = this.player;
    let progress = null;
    if (p.alive && p.beingAbsorbedByRef) {
      progress = p.absorptionRequired > 0 ? p.absorptionProgress / p.absorptionRequired : 0;
    } else if (p.alive) {
      const target = this.entities.find((e) => e.alive && e.beingAbsorbedByRef === p);
      if (target) progress = target.absorptionRequired > 0 ? target.absorptionProgress / target.absorptionRequired : 0;
    }

    if (progress !== null) {
      if (!this._absorbDroneActive) {
        this.audio.startAbsorbDrone();
        this._absorbDroneActive = true;
      }
      this.audio.updateAbsorbDrone(progress);
    } else if (this._absorbDroneActive) {
      this.audio.stopAbsorbDrone();
      this._absorbDroneActive = false;
    }
  }

  updatePlayer(dt) {
    const b = this.balance;
    const p = this.player;
    const inp = this.input;

    updateAttack(p, dt, b, this.hostileTargetsFor(p), this);
    updateDodge(p, dt, b);

    // v0.3 spec §1: being absorbed no longer freezes player control — movement (and dodge)
    // still work, so the player can walk or dodge out of the grab.

    const mouseWorld = this.screenToWorld(inp.mouseX, inp.mouseY);
    const aimAngle = Math.atan2(mouseWorld.y - p.y, mouseWorld.x - p.x);

    let dx = 0;
    let dy = 0;
    if (inp.keys.has('w') || inp.keys.has('arrowup')) dy -= 1;
    if (inp.keys.has('s') || inp.keys.has('arrowdown')) dy += 1;
    if (inp.keys.has('a') || inp.keys.has('arrowleft')) dx -= 1;
    if (inp.keys.has('d') || inp.keys.has('arrowright')) dx += 1;

    const moving = dx !== 0 || dy !== 0;
    const moveAngle = moving ? Math.atan2(dy, dx) : p.facing;

    if (p.attackState === 'READY' && p.dodgeState !== 'DODGING') {
      if (moving) {
        const len = Math.hypot(dx, dy);
        p.x += (dx / len) * p.moveSpeed * dt;
        p.y += (dy / len) * p.moveSpeed * dt;
      }
      p.facing = aimAngle;
    }

    if (inp.mouseDown && p.attackUnlocked && canStartAttack(p)) {
      startAttack(p, aimAngle, b);
      this.audio.telegraph();
    }
    if (inp.consumeDodge() && p.dodgeUnlocked && canStartDodge(p)) {
      startDodge(p, moveAngle, b);
      this.audio.dodge();
    }
  }

  // Two separate consumption rules — instant color-independent orb pickup (still requires
  // physical overlap), and same-color entity absorption. v0.5 spec §10: absorption no longer
  // requires overlap to *start* — any smaller same-color ball within the absorber's
  // maintainDistance (Size-scaled) connects and begins draining (see absorption.js).
  resolveConsumption() {
    const b = this.balance;
    for (const eater of this.entities) {
      if (!eater.alive) continue;
      if (eater.behavior !== 'player' && eater.behavior !== 'ai') continue;
      if (eater.beingAbsorbedByRef) continue; // can't eat while being absorbed yourself

      const maintainDistance = maintainDistanceFor(eater, b);
      const scanRange = Math.max(eater.size + 40, maintainDistance);
      const nearby = this.getNearbyEntities(eater, scanRange);
      for (const target of nearby) {
        if (!target.alive) continue;

        if (target.behavior === 'orb') {
          if (!canEatOrb(eater, target, b)) continue;
          if (!circlesOverlap(eater, target)) continue;
          target.alive = false;
          eater.addGrowth(target.growthValue, b);
          this.spawnGrowthParticles(target.x, target.y, target.colorHex);
          if (eater === this.player) {
            this.audio.growth();
            this.score += Math.round(target.growthValue);
          }
          continue;
        }

        if (eater === this.player && !this.player.allyAbsorptionEnabled) continue; // v0.6 §7

        if (canAbsorb(eater, target) && dist(eater, target) <= maintainDistance) {
          startAbsorption(eater, target, b, this);
        }
      }
    }
  }

  // v0.5 spec §18: different-color Player/AI can't fully overlap — they physically push each
  // other apart, mass-weighted by Size (heavier balls give less ground). Only applies to normal
  // movement collision; an in-progress attack CHARGE or a DODGE passes straight through so the
  // hitbox/i-frames keep working exactly as before (spec §18-2 explicitly separates "movement
  // collision" from "attack hitbox"). Orbs are unaffected — they stay simple passive pickups.
  resolvePushApart() {
    for (const a of this.entities) {
      if (!a.alive || (a.behavior !== 'player' && a.behavior !== 'ai')) continue;
      if (a.attackState === 'CHARGING' || a.dodgeState === 'DODGING') continue;

      const nearby = this.getNearbyEntities(a, a.size);
      for (const b of nearby) {
        if (a.id >= b.id) continue; // each pair resolved once
        if (!b.alive || (b.behavior !== 'player' && b.behavior !== 'ai')) continue;
        if (a.color === b.color) continue; // same-color relationships go through absorption
        if (b.attackState === 'CHARGING' || b.dodgeState === 'DODGING') continue;

        const d = dist(a, b);
        const minDist = a.size / 2 + b.size / 2;
        if (d >= minDist) continue;

        const angle = d > 0.001 ? Math.atan2(a.y - b.y, a.x - b.x) : Math.random() * Math.PI * 2;
        const overlap = minDist - d;
        const totalSize = a.size + b.size;
        a.x += Math.cos(angle) * overlap * (b.size / totalSize);
        a.y += Math.sin(angle) * overlap * (b.size / totalSize);
        b.x -= Math.cos(angle) * overlap * (a.size / totalSize);
        b.y -= Math.sin(angle) * overlap * (a.size / totalSize);
      }
    }
  }

  clampAllToWorld() {
    const w = this.balance.world;
    for (const e of this.entities) {
      if (!e.alive) continue;
      const r = e.size / 2;
      e.x = Math.min(Math.max(e.x, r), w.worldWidth - r);
      e.y = Math.min(Math.max(e.y, r), w.worldHeight - r);
    }
  }

  // v0.6 spec §5: the camera zooms out as Size grows so a bigger ball doesn't block the
  // player's own view of incoming threats — a direct payoff for growing, not just a side effect
  // of it. `zoomOutFactor` divides baseZoom down, capped at `maxZoomOut` so it can't zoom out
  // indefinitely at very high Size.
  updateCamera(dt) {
    const cfg = this.balance.camera;
    const w = this.balance.world;
    const p = this.player;

    const zoomOutFactor = Math.min(cfg.maxZoomOut, 1 + p.size * cfg.zoomOutPerSize);
    const targetZoom = cfg.baseZoom / zoomOutFactor;

    const lerp = 1 - Math.pow(0.001, dt);
    this.camera.zoom += (targetZoom - this.camera.zoom) * lerp;
    this.camera.x += (p.x - this.camera.x) * lerp;
    this.camera.y += (p.y - this.camera.y) * lerp;

    const halfViewW = this.canvas.width / 2 / this.camera.zoom;
    const halfViewH = this.canvas.height / 2 / this.camera.zoom;
    this.camera.x = Math.min(Math.max(this.camera.x, halfViewW), Math.max(halfViewW, w.worldWidth - halfViewW));
    this.camera.y = Math.min(Math.max(this.camera.y, halfViewH), Math.max(halfViewH, w.worldHeight - halfViewH));
  }

  orbSpawnLoop(dt) {
    const s = this.balance.spawning;
    this.orbSpawnTimer -= dt;
    if (this.orbSpawnTimer > 0) return;
    this.orbSpawnTimer = s.orbSpawnInterval;

    const orbCount = this.entities.reduce((n, e) => n + (e.alive && e.behavior === 'orb' ? 1 : 0), 0);
    if (orbCount < s.maxOrbCount) this.entities.push(spawnOrb(this.balance));
  }

  // v0.3 spec §2: enemies are no longer a fixed one-time population — the world keeps
  // replenishing them up to maxEnemyCount, which also keeps the average enemy size down
  // (fresh spawns roll from the small-biased distribution in spawning.js#rollEnemySize).
  enemySpawnLoop(dt) {
    const s = this.balance.spawning;
    this.enemySpawnTimer -= dt;
    if (this.enemySpawnTimer > 0) return;
    this.enemySpawnTimer = s.enemySpawnInterval;

    const enemyCount = this.entities.reduce((n, e) => n + (e.alive && e.behavior === 'ai' ? 1 : 0), 0);
    if (enemyCount < s.maxEnemyCount) {
      const colorDef = this.balance.colors[Math.floor(Math.random() * this.balance.colors.length)];
      this.entities.push(spawnAI(this.balance, colorDef, this.pickSafeSpawnPos(350), this.player.size));
    }
  }

  cleanupDead() {
    if (this.entities.length > 2000) {
      this.entities = this.entities.filter((e) => e.alive || e.behavior === 'player');
      return;
    }
    if (Math.random() < 0.02) {
      this.entities = this.entities.filter((e) => e.alive || e.behavior === 'player');
    }
  }

  // v0.3: takes the attacker so we can credit a Kill Count (spec §6) and play the right
  // death-adjacent sound only for events that matter to the player (spec §4).
  // v0.6 spec §16: player death now costs a Life instead of ending the run outright — Size/
  // Growth carry over unchanged into the respawn, and only running out of Lives triggers Game
  // Over (spec: "부활할 때 Size는 감소하지 않는다").
  onEntityDeath(entity, attacker) {
    if (entity.behavior === 'player') {
      this.spawnDeathParticles(entity.x, entity.y, entity.colorHex);
      this.audio.death();
      this.handlePlayerDefeat('DEFEATED');
      return;
    }
    this.spawnDeathParticles(entity.x, entity.y, entity.colorHex);

    // v0.4 spec §31-36 / v0.6 spec §10-12: a direct, size-scaled growth reward for whoever
    // landed the killing attack, but cut down by `growthRewardMultiplier` — the bulk of a kill's
    // payoff now comes from the orb spray below instead, which has to be collected in person.
    if (attacker && (attacker.behavior === 'player' || attacker.behavior === 'ai') && attacker.alive) {
      const kr = this.balance.killReward;
      const reward = kr.baseReward * Math.pow(entity.size / kr.referenceSize, kr.growthExponent) * kr.growthRewardMultiplier;
      attacker.addGrowth(reward, this.balance);
      if (attacker === this.player) {
        this.player.kills += 1;
        this.score += Math.round(reward) + 100; // flat per-kill score bonus, on top of the growth
        this.audio.death();
        this.audio.killReward();
        this.spawnFloatingText(attacker.x, attacker.y - attacker.size / 2 - 10, `+${Math.round(reward)} GROWTH`, '#4ade80');
        this.spawnFloatingText(attacker.x, attacker.y - attacker.size / 2 - 28, 'KILL +1', '#fbbf24');
      }
    }

    if (entity.behavior === 'ai') {
      const orbs = spawnDeathOrbs(entity, this.balance);
      this.entities.push(...orbs);
    }
  }

  respawnPlayer() {
    const p = this.player;
    p.x = this.balance.world.worldWidth / 2;
    p.y = this.balance.world.worldHeight / 2;
    // Size/Growth/stacks are deliberately left untouched (spec §16: a Life-based respawn keeps
    // Size — only a death with zero Lives left resets anything, and that goes through reset()).
    p.hp = p.maxHp;
    p.alive = true;
    p.attackState = 'READY';
    p.dodgeState = 'READY';
    p.attackStack = p.attackMaxStack;
    p.dodgeStack = p.dodgeMaxStack;
    p.invincible = false;
    p.beingAbsorbedByRef = null;
    p.kx = 0;
    p.ky = 0;
    p.knockbackTimer = 0;
    p.regenTimer = 999;
    p.scalePulseTimer = 0;
  }

  // v0.6 spec §16: shared by both ways the player can go down — combat death
  // (onEntityDeath) and being fully absorbed (absorption.js#completeAbsorption) — so a Life is
  // spent and Game Over triggers consistently regardless of which one happened.
  handlePlayerDefeat(reason) {
    this.lives -= 1;
    if (this.lives > 0) {
      this.ui.showDefeatMessage(reason);
      this.respawnPlayer();
    } else {
      this.triggerGameOver();
    }
  }

  // v0.6 spec §16: all Lives spent — freeze the sim, submit the run's score to the local Top 10,
  // and hand off to whatever main.js wired up (the Game Over overlay) via onGameOver.
  triggerGameOver() {
    this.gameOver = true;
    this.paused = true;
    if (this.onGameOver) this.onGameOver(this.score);
  }

  // ---------- particles ----------

  spawnHitParticles(x, y, color) {
    const life = this.balance.combat.hitParticleLifetime;
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = 80 + Math.random() * 160;
      this.particles.push({
        x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
        life, maxLife: life, color, size: 3 + Math.random() * 3, type: 'spark',
      });
    }
  }

  spawnDeathParticles(x, y, color) {
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = 40 + Math.random() * 180;
      this.particles.push({
        x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
        life: 0.6, maxLife: 0.6, color, size: 3 + Math.random() * 4, type: 'burst',
      });
    }
  }

  spawnGrowthParticles(x, y, color) {
    this.particles.push({
      x, y, vx: 0, vy: -20, life: 0.4, maxLife: 0.4, color, size: 6, type: 'ring',
    });
  }

  // v0.4 spec §11: a subtle rising particle while HP is regenerating — deliberately understated.
  spawnRegenParticle(x, y, size) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * size * 0.4;
    this.particles.push({
      x: x + Math.cos(a) * r, y: y + Math.sin(a) * r,
      vx: 0, vy: -18, life: 0.5, maxLife: 0.5, color: '#4ade80', size: 2.5, type: 'spark',
    });
  }

  // v0.4 spec §35: short floating text popups ("+25 GROWTH", "KILL +1", etc).
  spawnFloatingText(x, y, text, color) {
    this.floatingTexts.push({ x, y, text, color, life: 1.1, maxLife: 1.1 });
  }

  updateFloatingTexts(dt) {
    for (const t of this.floatingTexts) {
      t.life -= dt;
      t.y -= 28 * dt;
    }
    this.floatingTexts = this.floatingTexts.filter((t) => t.life > 0);
  }

  spawnAbsorptionParticles(x, y, color) {
    for (let i = 0; i < 24; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = 30 + Math.random() * 90;
      this.particles.push({
        x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
        life: 0.5, maxLife: 0.5, color, size: 2 + Math.random() * 3, type: 'spark',
      });
    }
  }

  updateParticles(dt) {
    for (const p of this.particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.92;
      p.vy *= 0.92;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
  }

  // ---------- camera transforms ----------

  screenToWorld(sx, sy) {
    return {
      x: (sx - this.canvas.width / 2) / this.camera.zoom + this.camera.x,
      y: (sy - this.canvas.height / 2) / this.camera.zoom + this.camera.y,
    };
  }

  worldToScreen(wx, wy) {
    return {
      x: (wx - this.camera.x) * this.camera.zoom + this.canvas.width / 2,
      y: (wy - this.camera.y) * this.camera.zoom + this.canvas.height / 2,
    };
  }

  // ---------- render ----------

  render() {
    const ctx = this.ctx;
    const { width, height } = this.canvas;
    ctx.fillStyle = '#11151c';
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.scale(this.camera.zoom, this.camera.zoom);
    ctx.translate(-this.camera.x, -this.camera.y);

    this.drawGrid(ctx);
    this.drawWorldBorder(ctx);
    this.drawAbsorptionLinks(ctx);
    this.drawEntities(ctx);
    this.drawParticles(ctx);
    this.drawFloatingTexts(ctx);

    ctx.restore();
  }

  drawGrid(ctx) {
    const w = this.balance.world;
    const step = 200;
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1 / this.camera.zoom;
    ctx.beginPath();
    for (let x = 0; x <= w.worldWidth; x += step) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, w.worldHeight);
    }
    for (let y = 0; y <= w.worldHeight; y += step) {
      ctx.moveTo(0, y);
      ctx.lineTo(w.worldWidth, y);
    }
    ctx.stroke();
  }

  drawWorldBorder(ctx) {
    const w = this.balance.world;
    ctx.strokeStyle = 'rgba(255,80,80,0.6)';
    ctx.lineWidth = 6 / this.camera.zoom;
    ctx.strokeRect(0, 0, w.worldWidth, w.worldHeight);
  }

  // v0.5 spec §13-14: the connection line's strength now also reflects distance — thin and
  // faint near the edge of maintainDistance, strong and pulsing once the balls are touching.
  drawAbsorptionLinks(ctx) {
    for (const target of this.entities) {
      if (!target.alive || !target.beingAbsorbedByRef) continue;
      const absorber = target.beingAbsorbedByRef;
      const t = target.absorptionRequired > 0 ? Math.min(1, target.absorptionProgress / target.absorptionRequired) : 1;
      const maintainDistance = maintainDistanceFor(absorber, this.balance);
      const d = Math.hypot(target.x - absorber.x, target.y - absorber.y);
      const proximity = 1 - Math.min(1, d / maintainDistance);

      ctx.save();
      ctx.strokeStyle = this.withAlpha('#ffffff', 0.12 + proximity * 0.45 + t * 0.2);
      ctx.lineWidth = (1 + proximity * 3 + t * 1.5) / this.camera.zoom;
      ctx.beginPath();
      ctx.moveTo(target.x, target.y);
      ctx.lineTo(absorber.x, absorber.y);
      ctx.stroke();
      ctx.restore();
    }
  }

  drawEntities(ctx) {
    const visible = this.entities
      .filter((e) => e.alive && this.isRoughlyVisible(e))
      .sort((a, b) => a.size - b.size);

    for (const e of visible) this.drawEntity(ctx, e);
  }

  isRoughlyVisible(e) {
    const halfW = this.canvas.width / 2 / this.camera.zoom + 100;
    const halfH = this.canvas.height / 2 / this.camera.zoom + 100;
    return Math.abs(e.x - this.camera.x) < halfW && Math.abs(e.y - this.camera.y) < halfH;
  }

  drawEntity(ctx, e) {
    const beingAbsorbed = !!e.beingAbsorbedByRef;
    const absorbT = beingAbsorbed && e.absorptionRequired > 0 ? Math.min(1, e.absorptionProgress / e.absorptionRequired) : (beingAbsorbed ? 1 : 0);
    // v0.4 spec §23: a short outward "grew bigger" pulse plays on a successful absorption.
    const pulseScale = e.scalePulseTimer > 0 ? 1 + (e.scalePulseTimer / 0.3) * 0.18 : 1;
    const r = (e.size / 2) * (beingAbsorbed ? 1 - absorbT * 0.3 : 1) * pulseScale;

    // dodge afterimages — each fades independently over dodge.effectLifetime, then is pruned
    // (see combat.js#updateDodge), so they never linger on screen after the dodge ends.
    if (e.dodgeTrail.length) {
      const lifetime = this.balance.dodge.effectLifetime;
      for (const t of e.dodgeTrail) {
        const alpha = Math.max(0, t.life / lifetime) * 0.3;
        ctx.beginPath();
        ctx.fillStyle = this.withAlpha(e.colorHex, alpha);
        ctx.arc(t.x, t.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // charge afterimages
    if (e.attackState === 'CHARGING' && e.trail.length) {
      for (let i = 0; i < e.trail.length; i++) {
        const t = e.trail[i];
        const alpha = ((i + 1) / e.trail.length) * 0.3;
        ctx.beginPath();
        ctx.fillStyle = this.withAlpha('#ffffff', alpha);
        ctx.arc(t.x, t.y, r * 0.9, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // telegraph indicator
    if (e.attackState === 'TELEGRAPH') {
      const progress = e.attackTimer / e.currentTelegraphTime;
      const reach = e.currentAttackRange > 0 ? e.currentAttackRange * 0.5 : 40;
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 3 / this.camera.zoom;
      ctx.beginPath();
      ctx.moveTo(e.x, e.y);
      ctx.lineTo(e.x + Math.cos(e.attackDir) * (r + reach), e.y + Math.sin(e.attackDir) * (r + reach));
      ctx.stroke();

      ctx.beginPath();
      ctx.strokeStyle = 'rgba(255,60,60,0.9)';
      ctx.lineWidth = 4 / this.camera.zoom;
      ctx.arc(e.x, e.y, r + 10, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // shadow
    ctx.beginPath();
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.ellipse(e.x, e.y + r * 0.15, r * 0.95, r * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();

    // body
    ctx.beginPath();
    ctx.fillStyle = e.hitFlash > 0 ? '#ffffff' : e.colorHex;
    ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.lineWidth = Math.max(1.5, r * 0.08);
    ctx.strokeStyle = e.behavior === 'player' ? '#ffffff' : (beingAbsorbed ? '#ffffff' : 'rgba(0,0,0,0.45)');
    ctx.stroke();

    if (beingAbsorbed) {
      // absorption progress ring, pulsing as it nears completion
      ctx.beginPath();
      ctx.strokeStyle = this.withAlpha('#ffffff', 0.5 + Math.sin(absorbT * Math.PI * 6) * 0.2);
      ctx.lineWidth = 3 / this.camera.zoom;
      ctx.arc(e.x, e.y, r + 8, -Math.PI / 2, -Math.PI / 2 + absorbT * Math.PI * 2);
      ctx.stroke();
    }

    if (e.invincible) {
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 2 / this.camera.zoom;
      ctx.arc(e.x, e.y, r + 5, 0, Math.PI * 2);
      ctx.stroke();
    }

    // v0.6 follow-up: kill-reward orbs no longer get a cross-mark overlay — they're meant to
    // read as indistinguishable from a naturally-spawned field orb (see spawning.js#spawnDeathOrbs).

    // hp bar for AI / player
    if ((e.behavior === 'ai' || e.behavior === 'player') && e.hp < e.maxHp) {
      const barW = Math.max(24, r * 1.6);
      const barH = 5;
      const bx = e.x - barW / 2;
      const by = e.y - r - 14;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(bx, by, barW, barH);
      ctx.fillStyle = e.hp / e.maxHp > 0.3 ? '#4ade80' : '#f87171';
      ctx.fillRect(bx, by, barW * Math.max(0, e.hp / e.maxHp), barH);
    }
  }

  drawParticles(ctx) {
    for (const p of this.particles) {
      const alpha = Math.max(0, p.life / p.maxLife);
      ctx.beginPath();
      ctx.fillStyle = this.withAlpha(p.color, alpha);
      if (p.type === 'ring') {
        ctx.arc(p.x, p.y, p.size * (1 - alpha) * 3 + p.size, 0, Math.PI * 2);
        ctx.lineWidth = 2;
        ctx.strokeStyle = this.withAlpha(p.color, alpha);
        ctx.stroke();
      } else {
        ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  drawFloatingTexts(ctx) {
    if (!this.floatingTexts.length) return;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = `bold ${14 / this.camera.zoom}px 'Segoe UI', system-ui, sans-serif`;
    for (const t of this.floatingTexts) {
      const alpha = Math.max(0, Math.min(1, t.life / t.maxLife) * 1.2);
      ctx.fillStyle = this.withAlpha(t.color, alpha);
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.restore();
  }

  withAlpha(hex, alpha) {
    const h = hex.replace('#', '');
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
}
