import { Game } from './game.js';
import { UI } from './ui.js';
import { loadMuted, saveMuted } from './storage.js';

class InputState {
  constructor() {
    this.keys = new Set();
    this.mouseX = 0;
    this.mouseY = 0;
    this.mouseDown = false;
    this._dodgeQueued = false;
  }
  consumeDodge() {
    const v = this._dodgeQueued;
    this._dodgeQueued = false;
    return v;
  }
}

async function loadBalance() {
  const res = await fetch('config/gameBalance.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to load config/gameBalance.json');
  return res.json();
}

function resizeCanvas(canvas) {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

async function main() {
  const canvas = document.getElementById('game-canvas');
  resizeCanvas(canvas);
  window.addEventListener('resize', () => resizeCanvas(canvas));

  let balance;
  try {
    balance = await loadBalance();
  } catch (err) {
    document.getElementById('load-error').style.display = 'block';
    document.getElementById('load-error').textContent =
      'gameBalance.json을 불러오지 못했습니다. 로컬 서버(예: python -m http.server)로 실행해 주세요. (' + err.message + ')';
    return;
  }

  const input = new InputState();

  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    input.keys.add(k);
    if (k === ' ') {
      e.preventDefault();
      if (!e.repeat) input._dodgeQueued = true;
    }
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => {
    input.keys.delete(e.key.toLowerCase());
  });
  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    input.mouseX = e.clientX - rect.left;
    input.mouseY = e.clientY - rect.top;
  });
  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) input.mouseDown = true;
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) input.mouseDown = false;
  });
  const ui = new UI(balance, () => {});
  const game = new Game(balance, canvas, input, ui);
  window.__game = game; // debug inspection hook

  // v0.6 spec §7: right-click toggles whether the player can absorb same-color (ally) balls.
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (game.player.alive) game.player.allyAbsorptionEnabled = !game.player.allyAbsorptionEnabled;
  });

  // v0.6 spec §17: mute button, persisted across reloads via localStorage.
  const muteBtn = document.getElementById('mute-btn');
  let muted = loadMuted();
  function applyMuteLabel() {
    muteBtn.textContent = muted ? 'SOUND: OFF' : 'SOUND: ON';
  }
  applyMuteLabel();
  game.audio.setMuted(muted);
  muteBtn.addEventListener('click', () => {
    muted = !muted;
    game.audio.setMuted(muted);
    saveMuted(muted);
    applyMuteLabel();
  });

  // v0.6 spec §14: Full Reset — confirmed since it discards the current run (but never the
  // Top 10 scoreboard, which reset() deliberately never touches). Uses a custom in-page
  // confirm instead of window.confirm(): the native dialog was found to silently resolve to
  // "cancel" with zero visible feedback in some browser/embedding contexts, which is exactly
  // what made the button look broken/unresponsive.
  const resetBtn = document.getElementById('reset-btn');
  const resetConfirmOverlay = document.getElementById('reset-confirm-overlay');
  resetBtn.addEventListener('click', () => {
    resetConfirmOverlay.style.display = 'flex';
  });
  document.getElementById('reset-confirm-yes').addEventListener('click', () => {
    resetConfirmOverlay.style.display = 'none';
    game.reset();
  });
  document.getElementById('reset-confirm-no').addEventListener('click', () => {
    resetConfirmOverlay.style.display = 'none';
  });

  // v0.6 spec §16: wired once — game.js calls this via onGameOver whenever Lives hits 0.
  game.onGameOver = (score) => ui.showGameOver(score);

  const restartBtn = document.getElementById('restart-btn');
  restartBtn.addEventListener('click', () => {
    ui.hideGameOver();
    game.reset();
  });

  let lastTime = performance.now();
  function loop(now) {
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;

    game.update(dt);
    game.render();
    ui.update(dt, game);

    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

main();
