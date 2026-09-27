(() => {
  'use strict';

  const PIPS = {
    1: '⚀', 2: '⚁', 3: '⚂',
    4: '⚃', 5: '⚄', 6: '⚅'
  };
  const STORAGE_KEY = 'wuerfel:v1';
  const MAX_HISTORY = 10;

  const grid = document.getElementById('select-grid');
  const faceButtons = Array.from(grid.querySelectorAll('.face-btn'));
  const presets = document.getElementById('presets');
  const resultFace = document.getElementById('result-face');
  const resultHint = document.getElementById('result-hint');
  const rollBtn = document.getElementById('btn-roll');
  const resetBtn = document.getElementById('btn-reset');
  const historyEl = document.getElementById('history');
  const live = document.getElementById('live');

  let enabled = new Set([1, 2, 3, 4, 5, 6]);
  let history = [];
  let rolling = false;

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (Array.isArray(data.enabled) && data.enabled.length) {
        enabled = new Set(data.enabled.filter((n) => n >= 1 && n <= 6));
      }
      if (Array.isArray(data.history)) {
        history = data.history.filter((n) => n >= 1 && n <= 6).slice(0, MAX_HISTORY);
      }
    } catch (e) { /* privater Modus o.ä. - ohne Speicher weiter */ }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        enabled: Array.from(enabled),
        history
      }));
    } catch (e) { /* ignorieren */ }
  }

  function renderGrid() {
    faceButtons.forEach((btn) => {
      const n = Number(btn.dataset.face);
      const on = enabled.has(n);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function renderHistory() {
    historyEl.innerHTML = '';
    history.forEach((n) => {
      const span = document.createElement('span');
      span.className = 'chip';
      span.textContent = PIPS[n];
      span.setAttribute('aria-hidden', 'true');
      historyEl.appendChild(span);
    });
  }

  function updateRollState() {
    const count = enabled.size;
    rollBtn.disabled = count === 0 || rolling;
    if (rolling) {
      resultHint.textContent = 'Würfelt …';
      resultHint.classList.remove('bad');
    } else if (count === 0) {
      resultHint.textContent = 'Mindestens eine Augenzahl aktivieren';
      resultHint.classList.add('bad');
    } else if (count === 6) {
      resultHint.textContent = 'Bereit · alle Augenzahlen erlaubt';
      resultHint.classList.remove('bad');
    } else {
      const list = Array.from(enabled).sort((a, b) => a - b).join(', ');
      resultHint.textContent = `Bereit · erlaubt: ${list}`;
      resultHint.classList.remove('bad');
    }
  }

  function toggleFace(n) {
    if (rolling) return;
    if (enabled.has(n)) {
      enabled.delete(n);
    } else {
      enabled.add(n);
    }
    renderGrid();
    updateRollState();
    saveState();
  }

  function applyPreset(name) {
    if (rolling) return;
    const sets = {
      all: [1, 2, 3, 4, 5, 6],
      none: [],
      low: [1, 2, 3],
      high: [4, 5, 6],
      even: [2, 4, 6],
      odd: [1, 3, 5]
    };
    enabled = new Set(sets[name] || []);
    renderGrid();
    updateRollState();
    saveState();
  }

  function vibrate(pattern) {
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) { /* ignorieren */ }
  }

  function roll() {
    if (rolling) return;
    const allowed = Array.from(enabled);
    if (!allowed.length) return;

    rolling = true;
    updateRollState();
    resultFace.classList.add('rolling');

    const duration = 550 + Math.floor(Math.random() * 300);
    const stepMs = 60;
    let elapsed = 0;

    const timer = setInterval(() => {
      const flash = allowed[Math.floor(Math.random() * allowed.length)];
      resultFace.textContent = PIPS[flash];
      elapsed += stepMs;
      if (elapsed >= duration) {
        clearInterval(timer);
        finishRoll(allowed);
      }
    }, stepMs);
  }

  function finishRoll(allowed) {
    const result = allowed[Math.floor(Math.random() * allowed.length)];
    resultFace.classList.remove('rolling');
    resultFace.textContent = PIPS[result];
    vibrate([15]);

    history.unshift(result);
    history = history.slice(0, MAX_HISTORY);
    renderHistory();
    saveState();

    rolling = false;
    updateRollState();
    live.textContent = `Ergebnis: ${result}`;
  }

  faceButtons.forEach((btn) => {
    btn.addEventListener('click', () => toggleFace(Number(btn.dataset.face)));
  });

  presets.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-preset]');
    if (btn) applyPreset(btn.dataset.preset);
  });

  resetBtn.addEventListener('click', () => applyPreset('all'));
  rollBtn.addEventListener('click', roll);

  loadState();
  renderGrid();
  renderHistory();
  updateRollState();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => { /* offline-Cache optional */ });
    });
  }
})();
