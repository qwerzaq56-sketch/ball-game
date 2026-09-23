// HUD rendering (DOM overlay) + live-editable Debug/Balance panel.

import { submitScore } from './storage.js';

export class UI {
  constructor(balance, onBalanceChange) {
    this.balance = balance;
    this.onBalanceChange = onBalanceChange || (() => {});

    this.hpFill = document.getElementById('hp-fill');
    this.hpText = document.getElementById('hp-text');
    this.growthText = document.getElementById('growth-text');
    this.sizeText = document.getElementById('size-text');
    this.killsText = document.getElementById('kills-text');
    this.scoreText = document.getElementById('score-text');
    this.lifeText = document.getElementById('life-text');
    this.allyAbsorbText = document.getElementById('ally-absorb-text');
    this.attackPips = document.getElementById('attack-pips');
    this.dodgePips = document.getElementById('dodge-pips');

    this.unlockBanner = document.getElementById('unlock-banner');
    this.unlockTimer = 0;

    this.defeatBanner = document.getElementById('defeat-banner');
    this.defeatTimer = 0;

    this.gameOverOverlay = document.getElementById('gameover-overlay');
    this.gameOverScore = document.getElementById('gameover-score');
    this.scoreboardList = document.getElementById('scoreboard-list');

    this.debugPanel = document.getElementById('debug-panel');
    this.debugVisible = false;
    this.buildDebugPanel();

    window.addEventListener('keydown', (e) => {
      if (e.key === 'F1') {
        e.preventDefault();
        this.debugVisible = !this.debugVisible;
        this.debugPanel.style.display = this.debugVisible ? 'block' : 'none';
      }
    });
  }

  showUnlock(type) {
    this.unlockBanner.textContent = type === 'attack' ? 'ATTACK UNLOCKED' : 'DODGE UNLOCKED';
    this.unlockBanner.style.opacity = '1';
    this.unlockTimer = 2.2;
  }

  showDefeatMessage(reason = 'DEFEATED') {
    this.defeatBanner.textContent = reason === 'ABSORBED' ? 'ABSORBED — RESPAWNING...' : 'DEFEATED — RESPAWNING...';
    this.defeatBanner.style.opacity = '1';
    this.defeatTimer = 2.0;
  }

  // v0.6 spec §14-15: submits the run's score to the local Top 10 (storage.js/localStorage),
  // renders the resulting board, and shows the Game Over overlay. Called once by main.js via
  // Game#onGameOver — never called directly by game.js, which only owns simulation state.
  showGameOver(score) {
    const top10 = submitScore(score);
    this.gameOverScore.textContent = `SCORE: ${Math.round(score)}`;
    this.scoreboardList.innerHTML = '';
    if (top10.length === 0) {
      const li = document.createElement('li');
      li.textContent = '(기록 없음)';
      this.scoreboardList.appendChild(li);
    } else {
      for (const entry of top10) {
        const li = document.createElement('li');
        li.textContent = String(entry.score).padStart(6, '0');
        this.scoreboardList.appendChild(li);
      }
    }
    this.gameOverOverlay.style.display = 'flex';
  }

  hideGameOver() {
    this.gameOverOverlay.style.display = 'none';
  }

  // v0.5 spec §23: HUD shows filled/empty pips (●/○) per stack instead of a LOCKED/READY label
  // + cooldown bar. LOCKED (maxStack 0) still reads as plain text.
  renderPips(container, stack, maxStack) {
    if (maxStack <= 0) {
      container.textContent = 'LOCKED';
      container.className = 'pips locked';
      return;
    }
    container.className = 'pips';
    container.textContent = '';
    for (let i = 0; i < maxStack; i++) {
      const span = document.createElement('span');
      span.className = i < stack ? 'pip filled' : 'pip';
      span.textContent = i < stack ? '●' : '○';
      container.appendChild(span);
    }
  }

  // v0.6: takes the whole Game instance now (was just `player`) so it can also read
  // lives/score/ally-absorption state, all of which live on Game, not Player/HUD-local state.
  update(dt, game) {
    const player = game.player;
    const hpRatio = Math.max(0, player.hp / player.maxHp);
    this.hpFill.style.width = `${hpRatio * 100}%`;
    this.hpText.textContent = `${Math.ceil(player.hp)} / ${Math.ceil(player.maxHp)}`;
    this.growthText.textContent = Math.floor(player.growth);
    this.sizeText.textContent = Math.floor(player.size);
    this.killsText.textContent = player.kills;
    this.scoreText.textContent = Math.round(game.score);
    this.lifeText.textContent = Math.max(0, game.lives);

    this.allyAbsorbText.textContent = player.allyAbsorptionEnabled ? 'ON' : 'OFF';
    this.allyAbsorbText.className = player.allyAbsorptionEnabled ? 'ally-on' : 'ally-off';

    this.renderPips(this.attackPips, player.attackStack, player.attackMaxStack);
    this.renderPips(this.dodgePips, player.dodgeStack, player.dodgeMaxStack);

    if (this.unlockTimer > 0) {
      this.unlockTimer -= dt;
      if (this.unlockTimer <= 0) this.unlockBanner.style.opacity = '0';
    }
    if (this.defeatTimer > 0) {
      this.defeatTimer -= dt;
      if (this.defeatTimer <= 0) this.defeatBanner.style.opacity = '0';
    }
  }

  buildDebugPanel() {
    const schema = [
      { label: 'Player', key: 'player', fields: [
        ['startingSize', 1], ['startingGrowth', 1], ['startingHp', 1], ['moveSpeed', 1], ['hpPerGrowth', 0.01],
      ] },
      { label: 'Growth', key: 'growth', fields: [
        ['growthToSizeRatio', 0.05], ['minEatSizeDifference', 1],
      ] },
      { label: 'Absorption', key: 'absorption', fields: [
        ['baseResistanceTime', 0.02], ['resistancePerSize', 0.005],
        ['baseMaintainDistance', 2], ['maintainDistancePerSize', 0.05],
        ['maxAbsorptionSpeed', 0.05], ['pullForce', 0.01],
      ] },
      // v0.6 §2-1: Defense moved here from its own top-level section — it's Size-driven combat
      // scaling like everything else in this section, not a separate subsystem. Charge duration
      // (§4-2) and knockbackForce also live here now.
      { label: 'Combat Scaling (Size 기준 전투력)', key: 'combatScaling', fields: [
        ['referenceSize', 1],
        ['baseAttackDamage', 1], ['attackDamagePerSize', 0.05],
        ['baseAttackRange', 2], ['attackRangeGrowthExponent', 0.05], ['chargeDistanceMultiplier', 0.05],
        ['attackChargeDurationBase', 0.01], ['attackChargeDurationPerSize', 0.0005],
        ['attackTelegraphTimeBase', 0.01], ['attackTelegraphTimePerSize', 0.0005],
        ['baseDefense', 1], ['defensePerSize', 0.05], ['minimumDamage', 1],
        ['knockbackForce', 5],
      ] },
      { label: 'Combat (Hit FX)', key: 'combat', fields: [
        ['knockbackDuration', 0.02], ['knockbackResistance', 0.1],
        ['hitFlashDuration', 0.01], ['hitParticleLifetime', 0.02],
      ] },
      { label: 'Health Regen', key: 'healthRegen', fields: [
        ['delay', 0.1], ['baseRate', 0.1], ['regenPerSize', 0.005],
      ] },
      { label: 'Attack', key: 'attack', fields: [
        ['attackCooldown', 0.1], ['attackRecoveryTime', 0.05],
      ] },
      // v0.6 §6: baseDistance/distanceGrowth replace the old exponential dodge-distance curve.
      { label: 'Dodge', key: 'dodge', fields: [
        ['dodgeDuration', 0.02], ['dodgeInvincibleTime', 0.02], ['dodgeCooldown', 0.1], ['effectLifetime', 0.02],
        ['baseDistance', 2], ['distanceGrowth', 0.02],
      ] },
      { label: 'AI', key: 'ai', fields: [
        ['movementSpeed', 5], ['detectionRange', 10],
        ['aggression', 0.05], ['fleeThreshold', 0.05],
        ['absorptionDetectionRange', 10], ['absorptionPriorityRatio', 0.05], ['highPriorityAbsorptionRatio', 0.05],
        ['attackCooldown', 0.1], ['absorptionAttemptChance', 0.05], ['lowHealthAttackChance', 0.05],
      ] },
      { label: 'Spawning', key: 'spawning', fields: [
        ['maxOrbCount', 10], ['orbSpawnInterval', 0.05],
        ['maxEnemyCount', 2], ['enemySpawnInterval', 0.1],
      ] },
      { label: 'Enemy Scaling (vs Player Size)', key: 'enemyScaling', fields: [
        ['baseEnemyMaxSize', 1], ['enemyMaxSizePerPlayerSize', 0.05],
      ] },
      // v0.6 §10-12: Death Orb section is gone — kill payoff is now `killReward`'s own orb
      // fields (a bigger kill drops noticeably more orbs, see spawning.js#spawnDeathOrbs), plus
      // the reduced direct-growth multiplier.
      { label: 'Kill Reward', key: 'killReward', fields: [
        ['baseReward', 1], ['referenceSize', 1], ['growthExponent', 0.05], ['growthRewardMultiplier', 0.05],
        ['orbBaseCount', 1], ['orbPerEnemySize', 0.01], ['orbMaxCount', 1], ['orbSize', 1], ['orbGrowthValue', 1],
      ] },
      { label: 'Enemy Size Distribution', key: 'enemySpawn', fields: [
        ['smallSizeRatio', 0.05], ['mediumSizeRatio', 0.05], ['largeSizeRatio', 0.05],
        ['smallSizeMin', 1], ['smallSizeMax', 1],
        ['mediumSizeMin', 1], ['mediumSizeMax', 1],
        ['largeSizeMin', 1], ['largeSizeMax', 1],
      ] },
      { label: 'World', key: 'world', fields: [
        ['minOrbSize', 1], ['maxOrbSize', 1],
      ] },
      { label: 'Lives', key: 'lives', fields: [
        ['maxLives', 1],
      ] },
      { label: 'Camera', key: 'camera', fields: [
        ['baseZoom', 0.05], ['zoomOutPerSize', 0.0005], ['maxZoomOut', 0.1],
      ] },
      { label: 'Audio', key: 'audio', fields: [
        ['masterVolume', 0.05], ['sfxVolume', 0.05], ['attackVolume', 0.05],
        ['damageVolume', 0.05], ['dodgeVolume', 0.05], ['deathVolume', 0.05],
      ] },
    ];

    const root = document.createElement('div');
    root.innerHTML = '<h2>DEBUG <span class="hint">(F1 to close)</span></h2>';

    // v0.5 §22: Skill stack thresholds are a small array, not a flat scalar, so they get their
    // own hand-built section instead of the generic flat-key loop below.
    root.appendChild(this.buildSkillThresholdSection());

    for (const section of schema) {
      const box = document.createElement('div');
      box.className = 'debug-section';
      const h = document.createElement('h3');
      h.textContent = section.label;
      box.appendChild(h);

      for (const [field, step] of section.fields) {
        const row = document.createElement('label');
        row.className = 'debug-row';
        const span = document.createElement('span');
        span.textContent = field;
        const input = document.createElement('input');
        input.type = 'number';
        input.step = step;
        input.value = this.balance[section.key][field];
        input.addEventListener('input', () => {
          const v = parseFloat(input.value);
          if (!Number.isNaN(v)) {
            this.balance[section.key][field] = v;
            this.onBalanceChange(section.key, field, v);
          }
        });
        row.appendChild(span);
        row.appendChild(input);
        box.appendChild(row);
      }
      root.appendChild(box);
    }

    this.debugPanel.appendChild(root);
  }

  buildSkillThresholdSection() {
    const box = document.createElement('div');
    box.className = 'debug-section';
    const h = document.createElement('h3');
    h.textContent = 'Skills (Size 기준 스택 해금)';
    box.appendChild(h);

    const rows = [
      ['Attack Unlock Size', this.balance.skills.attackStackThresholds, 0],
      ['Attack 2nd Stack Size', this.balance.skills.attackStackThresholds, 1],
      ['Dodge Unlock Size', this.balance.skills.dodgeStackThresholds, 0],
      ['Dodge 2nd Stack Size', this.balance.skills.dodgeStackThresholds, 1],
    ];
    for (const [label, list, index] of rows) {
      const row = document.createElement('label');
      row.className = 'debug-row';
      const span = document.createElement('span');
      span.textContent = label;
      const input = document.createElement('input');
      input.type = 'number';
      input.step = 1;
      input.value = list[index].size;
      input.addEventListener('input', () => {
        const v = parseFloat(input.value);
        if (!Number.isNaN(v)) {
          list[index].size = v;
          this.onBalanceChange('skills', label, v);
        }
      });
      row.appendChild(span);
      row.appendChild(input);
      box.appendChild(row);
    }
    return box;
  }
}
