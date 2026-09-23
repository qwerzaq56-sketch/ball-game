import { Game } from './game.js';
import { UI } from './ui.js';

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
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  const ui = new UI(balance, () => {});
  const game = new Game(balance, canvas, input, ui);
  window.__game = game; // debug inspection hook

  let lastTime = performance.now();
  function loop(now) {
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;

    game.update(dt);
    game.render();
    ui.update(dt, game.player);

    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

main();
