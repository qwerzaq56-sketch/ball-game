// HUD rendering (DOM overlay) + live-editable Debug/Balance panel.

export class UI {
  constructor(balance, onBalanceChange) {
    this.balance = balance;
    this.onBalanceChange = onBalanceChange || (() => {});

    this.hpFill = document.getElementById('hp-fill');
    this.hpText = document.getElementById('hp-text');
    this.growthText = document.getElementById('growth-text');
    this.sizeText = document.getElementById('size-text');
    this.killsText = document.getElementById('kills-text');
    this.attackPips = document.getElementById('attack-pips');
    this.dodgePips = document.getElementById('dodge-pips');

    this.unlockBanner = document.getElementById('unlock-banner');
    this.unlockTimer = 0;

    this.defeatBanner = document.getElementById('defeat-banner');
    this.defeatTimer = 0;

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

  update(dt, player) {
    const hpRatio = Math.max(0, player.hp / player.maxHp);
    this.hpFill.style.width = `${hpRatio * 100}%`;
    this.hpText.textContent = `${Math.ceil(player.hp)} / ${Math.ceil(player.maxHp)}`;
    this.growthText.textContent = Math.floor(player.growth);
    this.sizeText.textContent = Math.floor(player.size);
    this.killsText.textContent = player.kills;

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
      { label: 'Defense', key: 'defense', fields: [
        ['baseDefense', 1], ['defensePerSize', 0.05], ['minimumDamage', 1],
      ] },
      { label: 'Absorption', key: 'absorption', fields: [
        ['baseResistanceTime', 0.02], ['resistancePerSize', 0.005],
        ['baseMaintainDistance', 2], ['maintainDistancePerSize', 0.05],
        ['maxAbsorptionSpeed', 0.05], ['pullForce', 0.01],
      ] },
      { label: 'Combat Scaling (Size 기준 전투력)', key: 'combatScaling', fields: [
        ['referenceSize', 1],
        ['baseAttackDamage', 1], ['attackDamagePerSize', 0.05],
        ['baseAttackRange', 2], ['attackRangeGrowthExponent', 0.05], ['chargeDistanceMultiplier', 0.05],
        ['baseDodgeDistance', 2], ['dodgeDistanceGrowthExponent', 0.05],
      ] },
      { label: 'Combat (Knockback / Hit FX)', key: 'combat', fields: [
        ['knockbackForce', 5], ['knockbackDuration', 0.02], ['knockbackResistance', 0.1],
        ['hitFlashDuration', 0.01], ['hitParticleLifetime', 0.02],
      ] },
      { label: 'Health Regen', key: 'healthRegen', fields: [
        ['delay', 0.1], ['baseRate', 0.1], ['regenPerSize', 0.005],
      ] },
      { label: 'Attack', key: 'attack', fields: [
        ['attackTelegraphTime', 0.02],
        ['attackChargeDuration', 0.02], ['attackCooldown', 0.1], ['attackRecoveryTime', 0.05],
      ] },
      { label: 'Dodge', key: 'dodge', fields: [
        ['dodgeDuration', 0.02], ['dodgeInvincibleTime', 0.02], ['dodgeCooldown', 0.1], ['effectLifetime', 0.02],
      ] },
      { label: 'AI', key: 'ai', fields: [
        ['movementSpeed', 5], ['detectionRange', 10],
        ['aggression', 0.05], ['fleeThreshold', 0.05],
        ['absorptionDetectionRange', 10], ['absorptionPriorityRatio', 0.05], ['highPriorityAbsorptionRatio', 0.05],
      ] },
      { label: 'Spawning', key: 'spawning', fields: [
        ['maxOrbCount', 10], ['orbSpawnInterval', 0.05],
        ['maxEnemyCount', 2], ['enemySpawnInterval', 0.1],
      ] },
      { label: 'Enemy Scaling (vs Player Size)', key: 'enemyScaling', fields: [
        ['baseEnemyMaxSize', 1], ['enemyMaxSizePerPlayerSize', 0.05],
      ] },
      { label: 'Kill Reward', key: 'killReward', fields: [
        ['baseReward', 1], ['referenceSize', 1], ['growthExponent', 0.05],
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
      { label: 'Death Orb', key: 'deathOrb', fields: [
        ['deathOrbCount', 1], ['deathOrbGrowthValue', 1], ['deathOrbSize', 1],
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
