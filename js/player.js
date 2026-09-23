import { Entity, sizeFromGrowth, computeMaxStack } from './entity.js';

export class Player extends Entity {
  constructor(balance) {
    const b = balance.player;
    const colorDef = balance.colors.find((c) => c.id === 'blue') || balance.colors[0];
    super({
      x: balance.world.worldWidth / 2,
      y: balance.world.worldHeight / 2,
      size: b.startingSize,
      color: colorDef.id,
      colorHex: colorDef.color,
      moveSpeed: b.moveSpeed,
      behavior: 'player',
      hp: b.startingHp,
      maxHp: b.startingHp,
    });
    this.baseSize = b.startingSize;
    this.growth = b.startingGrowth;
    this.kills = 0; // v0.3: only counts kills the player's own attack landed the final hit on
    this.onSkillUnlock = null; // set by Game to trigger the HUD banner
    this._recomputeStacks(balance, false);
  }

  addGrowth(amount, balance) {
    this.growth += amount;
    this.refreshFromGrowth(balance);
    this._recomputeStacks(balance, true);
  }

  refreshFromGrowth(balance) {
    const g = balance.growth;
    const p = balance.player;
    this.size = sizeFromGrowth(this.growth, this.baseSize, g.growthToSizeRatio);
    const newMaxHp = p.startingHp + this.growth * (p.hpPerGrowth ?? 0);
    this.hp = Math.min(this.hp + Math.max(0, newMaxHp - this.maxHp), newMaxHp);
    this.maxHp = newMaxHp;
  }

  // v0.5: Size-driven stack capacity, identical rule to AI (spec §9, §25). When capacity grows,
  // the new charge(s) appear immediately full rather than needing to regen from empty — crossing
  // a threshold should feel like an instant reward.
  _recomputeStacks(balance, fireEvents) {
    const newAttackMax = computeMaxStack(this.size, balance.skills.attackStackThresholds);
    const newDodgeMax = computeMaxStack(this.size, balance.skills.dodgeStackThresholds);

    if (newAttackMax !== this.attackMaxStack) {
      if (fireEvents && this.onSkillUnlock && this.attackMaxStack === 0 && newAttackMax > 0) this.onSkillUnlock('attack');
      this.attackStack += newAttackMax - this.attackMaxStack;
      this.attackMaxStack = newAttackMax;
      this.attackUnlocked = newAttackMax > 0;
    }
    if (newDodgeMax !== this.dodgeMaxStack) {
      if (fireEvents && this.onSkillUnlock && this.dodgeMaxStack === 0 && newDodgeMax > 0) this.onSkillUnlock('dodge');
      this.dodgeStack += newDodgeMax - this.dodgeMaxStack;
      this.dodgeMaxStack = newDodgeMax;
      this.dodgeUnlocked = newDodgeMax > 0;
    }
  }
}
