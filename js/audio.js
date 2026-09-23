// v0.3: lightweight synthesized SFX via the Web Audio API — no binary assets to ship or go
// missing, which also directly helps the "runs on any other PC" deployment goal (spec §5).
// The AudioContext is created lazily on first use, which in practice is always inside a
// user-initiated input handler (click/keydown), satisfying browser autoplay policies.

export class AudioManager {
  constructor(balance) {
    this.balance = balance;
    this.ctx = null;
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
