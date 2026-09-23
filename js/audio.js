// v0.3: lightweight synthesized SFX via the Web Audio API — no binary assets to ship or go
// missing, which also directly helps the "runs on any other PC" deployment goal (spec §5).
// The AudioContext is created lazily on first use, which in practice is always inside a
// user-initiated input handler (click/keydown), satisfying browser autoplay policies.
// v0.6 spec §9: adds a persistent absorption "drone" whose pitch/gain/filter are eased toward
// new targets every frame an absorption is active (see startAbsorbDrone/updateAbsorbDrone/
// stopAbsorbDrone) instead of firing a new one-shot sound — satisfies spec §25-8's "매 프레임
// 오디오 객체를 새로 생성하지 않는다". Also adds setMuted() (spec §17): since `volume()` reads
// `balance.audio.masterVolume` fresh on every call, muting is just zeroing that value out — no
// separate master-gain node needed, and it takes effect on the very next sound (one-shot or the
// drone's next per-frame update) with no extra plumbing.

export class AudioManager {
  constructor(balance) {
    this.balance = balance;
    this.ctx = null;
    this.absorbDrone = null;
    this.muted = false;
    this._preMuteVolume = undefined;
  }

  ensureContext() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      this.ctx = new Ctx();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  volume(kind) {
    const a = this.balance.audio;
    const master = a.masterVolume ?? 1;
    const sfx = a.sfxVolume ?? 1;
    const specific = a[kind + 'Volume'] ?? 1;
    return master * sfx * specific;
  }

  tone(freq, duration, type, kind, gainScale = 1) {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const v = this.volume(kind) * gainScale;
    if (v <= 0.001) return;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.001, v), t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  sweep(freqFrom, freqTo, duration, type, kind, gainScale = 1) {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const v = this.volume(kind) * gainScale;
    if (v <= 0.001) return;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freqFrom, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqTo), t0 + duration);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.001, v), t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  noiseBurst(duration, kind, gainScale = 1) {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const v = this.volume(kind) * gainScale;
    if (v <= 0.001) return;
    const t0 = ctx.currentTime;
    const bufferSize = Math.ceil(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(Math.max(0.001, v), t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 800;
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start(t0);
  }

  // v0.6 spec §9: continuous progress-driven absorption feedback. Nodes are created once here
  // and only ever have their existing parameters eased (setTargetAtTime) by updateAbsorbDrone —
  // never recreated mid-absorption.
  startAbsorbDrone() {
    const ctx = this.ensureContext();
    if (!ctx) return;
    this.stopAbsorbDrone(); // defensive: clear any stale graph before building a new one
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 220;
    filter.type = 'lowpass';
    filter.frequency.value = 700;
    gain.gain.value = 0.0001;
    osc.connect(filter).connect(gain).connect(ctx.destination);
    osc.start();
    this.absorbDrone = { osc, filter, gain };
    this.updateAbsorbDrone(0);
  }

  // progress: 0 (just connected) .. 1 (about to complete) — pitch rises and the tone opens up
  // (filter brightens, gain increases) as the absorption nears completion, so a player can tell
  // "it's almost done" purely by ear.
  updateAbsorbDrone(progress) {
    if (!this.absorbDrone || !this.ctx) return;
    const t = Math.max(0, Math.min(1, progress));
    const now = this.ctx.currentTime;
    const v = this.volume('sfx');
    this.absorbDrone.osc.frequency.setTargetAtTime(220 + t * 460, now, 0.05);
    this.absorbDrone.filter.frequency.setTargetAtTime(600 + t * 1400, now, 0.05);
    this.absorbDrone.gain.gain.setTargetAtTime(Math.max(0.0001, v * (0.12 + t * 0.16)), now, 0.05);
  }

  stopAbsorbDrone() {
    if (!this.absorbDrone || !this.ctx) {
      this.absorbDrone = null;
      return;
    }
    const { osc, gain } = this.absorbDrone;
    const now = this.ctx.currentTime;
    gain.gain.setTargetAtTime(0.0001, now, 0.08);
    osc.stop(now + 0.35);
    this.absorbDrone = null;
  }

  // v0.6 spec §17: mute toggles ALL SFX (one-shots and the drone) by zeroing masterVolume —
  // every sound already reads it live via volume(), so nothing else needs to change.
  setMuted(muted) {
    if (muted === this.muted) return;
    if (muted) {
      this._preMuteVolume = this.balance.audio.masterVolume ?? 1;
      this.balance.audio.masterVolume = 0;
    } else {
      this.balance.audio.masterVolume = this._preMuteVolume ?? 1;
    }
    this.muted = muted;
  }

  telegraph() { this.tone(880, 0.08, 'square', 'attack', 0.4); }
  attackCharge() { this.sweep(220, 520, 0.15, 'sawtooth', 'attack', 0.4); }
  hit() { this.noiseBurst(0.08, 'attack', 0.9); }
  damage() { this.tone(150, 0.12, 'sawtooth', 'damage', 0.8); }
  dodge() { this.sweep(500, 1000, 0.12, 'sine', 'dodge', 0.6); }
  death() { this.sweep(400, 60, 0.35, 'sawtooth', 'death', 0.7); }
  // v0.4 spec §20: absorption now has a distinct start cue and success cue.
  absorbStart() { this.tone(300, 0.1, 'sine', 'sfx', 0.4); }
  absorbSuccess() { this.sweep(150, 500, 0.4, 'sine', 'sfx', 0.6); }
  killReward() { this.sweep(500, 800, 0.18, 'triangle', 'sfx', 0.6); }
  growth() { this.tone(720, 0.06, 'sine', 'sfx', 0.35); }
  unlock() {
    this.tone(660, 0.15, 'sine', 'sfx', 0.9);
    setTimeout(() => this.tone(990, 0.22, 'sine', 'sfx', 0.9), 110);
  }
}
