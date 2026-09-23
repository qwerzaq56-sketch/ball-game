// v0.6 spec §15/§17: client-side persistence only (no server) — Top 10 local high scores and
// the mute toggle. Both survive a page refresh via localStorage but are strictly per-browser:
// on GitHub Pages every visitor gets their own separate Top 10, not a shared/global leaderboard
// (spec §15 explicitly calls this out as the intended v0.6 scope, not a bug).
//
// Every read/write is wrapped in try/catch: localStorage can throw (private browsing, blocked
// site data, storage quota) and none of that should ever crash the game.

const SCOREBOARD_KEY = 'ballgame_scoreboard_v1';
const MUTED_KEY = 'ballgame_muted_v1';
const MAX_ENTRIES = 10;

export function loadScoreboard() {
  try {
    const raw = localStorage.getItem(SCOREBOARD_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Inserts `score` if it earns a Top 10 spot, re-sorts, trims, and persists. Returns the
// resulting (possibly unchanged) list either way, so the caller can render it immediately.
export function submitScore(score) {
  const board = loadScoreboard();
  board.push({ score: Math.max(0, Math.round(score)), date: Date.now() });
  board.sort((a, b) => b.score - a.score);
  const top = board.slice(0, MAX_ENTRIES);
  try {
    localStorage.setItem(SCOREBOARD_KEY, JSON.stringify(top));
  } catch {
    // ignore — the in-memory `top` is still returned so the UI can show it this session
  }
  return top;
}

// v0.6 spec §14: Full Reset must NOT touch the scoreboard — this is a deliberately separate
// action, only ever called from its own dedicated control.
export function resetScoreboard() {
  try {
    localStorage.removeItem(SCOREBOARD_KEY);
  } catch {
    // ignore
  }
}

export function loadMuted() {
  try {
    return localStorage.getItem(MUTED_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveMuted(muted) {
  try {
    localStorage.setItem(MUTED_KEY, muted ? '1' : '0');
  } catch {
    // ignore
  }
}
