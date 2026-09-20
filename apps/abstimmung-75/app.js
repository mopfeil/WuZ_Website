'use strict';

/* ArUco Abstimmung 75 - PWA
   Variante fuer 7,5-cm-Marker:
   - Hochkant (portrait)  = Scannen mit der Kamera
   - Quer (landscape)     = grosse, plakative Ergebnis-Anzeige
     (live waehrend einer Frage, navigierbar nach Abschluss;
      am Beamer via AirPlay/HDMI-Spiegelung)
   - Antwortcodes, die bei der aktuellen Frage keine Option sind
     (z. B. "E" bei 315°), rasten nicht ein -> tote Zone zwischen 7 und 1.
   Erkennt ArUco-Marker (js-aruco2) ueber die iPhone-Kamera, wertet die
   Drehung als Antwort aus und exportiert die Ergebnisse als CSV. */

// ---- Farben fuer Overlay ----
const COL = { scanned: '#4fc46a', pending: '#f0c44a', unknown: '#e8843c' };
const LS_CFG = 'aruco_cfg';
const LS_PROGRESS = 'aruco_progress';

// ---- Zustand ----
let CFG = null;
let detector = null;
let participantsSet = new Set();
let orientationKeys = [];
let stableFrames = 8;

let video = null, canvas = null, ctx = null;
let running = false, frame = 0;

let qIndex = 0;
let answers = {};          // markerId -> Antwortbuchstabe (uebernommen)
let recent = {};           // markerId -> letzte Lesungen
let unknown = new Set();   // erkannte Marker, die nicht in der Teilnehmerliste sind
let results = [];          // gesammelte Ergebniszeilen
let lastDetected = [];     // aktuelle Frame-Erkennungen (fuer Overlay/Test)

let currentScreen = 'start';   // start | scan | done
let statsVisible = false;      // Querformat-Statistik eingeblendet?
let statsIndex = 0;            // welche Frage die Statistik zeigt
let statsTimer = null;         // Live-Aktualisierung im Querformat
let lockAt = {};               // markerId -> Zeitpunkt des Einrastens (Flash)

// ---- DOM ----
const $ = (id) => document.getElementById(id);

document.addEventListener('DOMContentLoaded', init);

async function init() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  canvas = $('cv');
  ctx = canvas.getContext('2d');

  video = document.createElement('video');
  video.setAttribute('playsinline', '');
  video.playsInline = true;
  video.muted = true;
  video.autoplay = true;
  video.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:0;top:0';
  document.body.appendChild(video);

  await loadConfig();
  wireEvents();

  const prog = loadProgress();
  if (prog && (prog.results.length > 0 || prog.qIndex > 0)) {
    if (confirm('Es gibt eine unterbrochene Sitzung. Fortsetzen?\n'
        + '(Abbrechen = neu beginnen)')) {
      qIndex = prog.qIndex; results = prog.results; answers = prog.answers || {};
    } else {
      clearProgress();
    }
  }
}

// ---------------------------------------------------------------- Konfig
function defaultConfigText() {
  return fetch('config.json', { cache: 'no-store' }).then((r) => r.text());
}

async function loadConfig() {
  let raw = null;
  const stored = localStorage.getItem(LS_CFG);
  if (stored) { try { raw = JSON.parse(stored); } catch (e) { raw = null; } }
  if (!raw) {
    try {
      const resp = await fetch('config.json', { cache: 'no-store' });
      raw = await resp.json();
    } catch (e) {
      raw = { settings: {}, orientation_map: {}, participants: [], questions: [] };
    }
  }
  applyConfig(raw);
}

function normalizeConfig(raw) {
  const s = raw.settings || {};
  const om = {};
  const rawom = raw.orientation_map && Object.keys(raw.orientation_map).length
    ? raw.orientation_map
    : { 0: 'A', 45: 'B', 90: 'C', 135: 'D', 180: 'E', 225: 'F', 270: 'G', 315: 'H' };
  for (const k in rawom) om[parseInt(k, 10)] = String(rawom[k]).trim();

  // Teilnehmer einlesen und doppelte Marker-Nummern entfernen, damit jeder
  // Marker in den Ergebnissen genau einmal vorkommt.
  const parts = [];
  const seenIds = new Set();
  for (const p of (raw.participants || [])) {
    const id = (p && typeof p === 'object') ? parseInt(p.marker_id, 10) : parseInt(p, 10);
    if (!isNaN(id) && !seenIds.has(id)) { seenIds.add(id); parts.push(id); }
  }

  const qs = (raw.questions || []).map((q) => ({
    id: String(q.id || ''),
    text: String(q.text || ''),
    options: Object.fromEntries(
      Object.entries(q.options || {}).map(([k, v]) => [String(k).trim(), String(v)])
    )
  }));

  return {
    settings: {
      stable_frames: Math.max(1, parseInt(s.stable_frames || 8, 10)),
      process_width: Math.max(320, parseInt(s.process_width || 1280, 10)),
      marker_dictionary: s.marker_dictionary || 'ARUCO_MIP_36h12',
      max_hamming_distance: Math.max(1, parseInt(
        s.max_hamming_distance != null ? s.max_hamming_distance : 5, 10))
    },
    orientationMap: om,
    participants: parts,
    questions: qs
  };
}

function applyConfig(raw) {
  CFG = normalizeConfig(raw);
  participantsSet = new Set(CFG.participants);
  orientationKeys = Object.keys(CFG.orientationMap).map(Number).sort((a, b) => a - b);
  stableFrames = CFG.settings.stable_frames;
  // Strenge Hamming-Distanz: verhindert, dass ein Marker bei Bewegung/
  // Unschaerfe faelschlich als anderer Marker erkannt wird.
  const opt = (name) => ({
    dictionaryName: name,
    maxHammingDistance: CFG.settings.max_hamming_distance
  });
  try {
    detector = new AR.Detector(opt(CFG.settings.marker_dictionary));
  } catch (e) {
    detector = new AR.Detector(opt('ARUCO_MIP_36h12'));
  }
}

// ---------------------------------------------------------------- Kamera
function once(el, ev) {
  return new Promise((res) => el.addEventListener(ev, res, { once: true }));
}

async function startCamera() {
  $('start-status').textContent = 'Kamera wird gestartet ...';
  $('start-status').className = 'msg';
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' },
               width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    });
    video.srcObject = stream;
    if (video.readyState < 1) await once(video, 'loadedmetadata');
    await video.play();
    sizeCanvas();
    showScreen('scan');
    renderHUD();
    running = true;
    requestAnimationFrame(loop);
  } catch (e) {
    $('start-status').className = 'msg err';
    $('start-status').textContent =
      'Kamerazugriff nicht moeglich: ' + (e && e.message ? e.message : e)
      + '. Die Seite muss ueber HTTPS geladen sein und Kamerazugriff erlaubt werden.';
  }
}

function sizeCanvas() {
  const vw = video.videoWidth || 1280;
  const vh = video.videoHeight || 720;
  const pw = CFG.settings.process_width;
  canvas.width = pw;
  canvas.height = Math.round(pw * vh / vw);
}

// ---------------------------------------------------------------- Loop
function loop() {
  if (!running) return;
  // Im Querformat (Statistik-Anzeige) wird die Erkennung pausiert,
  // damit beim Praesentieren nichts versehentlich gescannt wird.
  if (statsVisible) { requestAnimationFrame(loop); return; }
  if (video.readyState >= 2) {
    if (video.videoWidth && canvas.width !== CFG.settings.process_width) sizeCanvas();
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    let img = null;
    try { img = ctx.getImageData(0, 0, canvas.width, canvas.height); } catch (e) {}
    if (img) {
      let markers = [];
      try { markers = detector.detect(img); } catch (e) {}
      processMarkers(markers);
      drawOverlay();
    }
  }
  frame++;
  if (frame % 6 === 0) {
    renderHUD();
    if (!$('sheet-test').classList.contains('hidden')) renderTest();
  }
  requestAnimationFrame(loop);
}

function snapOrientation(corners) {
  const c0 = corners[0], c1 = corners[1];
  let ang = Math.atan2(c1.y - c0.y, c1.x - c0.x) * 180 / Math.PI;
  ang = ((ang % 360) + 360) % 360;
  let best = orientationKeys[0], bestD = 1e9;
  for (const k of orientationKeys) {
    let d = Math.abs(ang - k);
    d = Math.min(d, 360 - d);
    if (d < bestD) { bestD = d; best = k; }
  }
  return { key: best, angle: ang };
}

function quadArea(c) {
  let a = 0;
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    a += c[i].x * c[j].y - c[j].x * c[i].y;
  }
  return Math.abs(a) / 2;
}

function processMarkers(markers) {
  // js-aruco2 meldet denselben Marker teils mehrfach (verschachtelte
  // Konturen) - pro ID nur die flaechengroesste Erkennung behalten.
  const byId = {};
  for (const m of markers) {
    if (!m.corners || m.corners.length !== 4) continue;
    const a = quadArea(m.corners);
    if (!byId[m.id] || a > byId[m.id]._area) { m._area = a; byId[m.id] = m; }
  }

  lastDetected = [];
  for (const m of Object.values(byId)) {
    const o = snapOrientation(m.corners);
    const letter = CFG.orientationMap[o.key] || '?';
    const known = participantsSet.has(m.id);
    lastDetected.push({ id: m.id, corners: m.corners, angle: o.angle,
                        key: o.key, letter: letter, known: known });
    if (!known) { unknown.add(m.id); continue; }
    // Tote Zone: Codes, die bei der aktuellen Frage keine Option sind
    // (z. B. "E" bei 315° oder ungenutzte Stufen), rasten nicht ein.
    const q = CFG.questions[qIndex];
    if (!q || !(letter in q.options)) continue;
    let buf = recent[m.id] || (recent[m.id] = []);
    buf.push(letter);
    if (buf.length > stableFrames) buf.shift();
    if (buf.length === stableFrames && buf.every((x) => x === buf[0])) {
      if (answers[m.id] !== buf[0]) {
        answers[m.id] = buf[0];
        lockAt[m.id] = performance.now();   // Einrast-Flash ausloesen
        saveProgress();
      }
    }
  }
}

function drawOverlay() {
  const now = performance.now();
  ctx.textAlign = 'center';
  for (const d of lastDetected) {
    const cs = d.corners;
    const locked = d.known && answers[d.id] != null;
    const color = !d.known ? COL.unknown : (locked ? COL.scanned : COL.pending);
    // Einrast-Flash: kurz nach dem Erfassen deutlich hervorheben
    const dt = locked && lockAt[d.id] ? now - lockAt[d.id] : 1e9;
    const flash = dt < 900;

    if (flash) {
      // Flaeche gruen fuellen
      ctx.beginPath();
      ctx.moveTo(cs[0].x, cs[0].y);
      for (let i = 1; i < 4; i++) ctx.lineTo(cs[i].x, cs[i].y);
      ctx.closePath();
      ctx.fillStyle = 'rgba(79, 196, 106, ' + (0.4 * (1 - dt / 900)) + ')';
      ctx.fill();
    }

    ctx.lineWidth = flash ? 9 : (locked ? 5 : 3);
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(cs[0].x, cs[0].y);
    for (let i = 1; i < 4; i++) ctx.lineTo(cs[i].x, cs[i].y);
    ctx.closePath();
    ctx.stroke();

    const cx = (cs[0].x + cs[1].x + cs[2].x + cs[3].x) / 4;
    const cy = (cs[0].y + cs[1].y + cs[2].y + cs[3].y) / 4;
    const edge = Math.hypot(cs[1].x - cs[0].x, cs[1].y - cs[0].y);

    if (flash) {
      // Wachsender Ring + grosses Haekchen
      const t = dt / 900;
      ctx.beginPath();
      ctx.arc(cx, cy, edge * (0.55 + 0.55 * t), 0, 2 * Math.PI);
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(79, 196, 106, ' + (0.9 * (1 - t)) + ')';
      ctx.stroke();
      ctx.font = 'bold ' + Math.max(28, edge * 0.7) + 'px -apple-system, sans-serif';
      ctx.lineWidth = 6;
      ctx.strokeStyle = '#000';
      ctx.strokeText('✓', cx, cy - edge * 0.05);
      ctx.fillStyle = '#5dff85';
      ctx.fillText('✓', cx, cy - edge * 0.05);
    }

    ctx.font = 'bold 20px -apple-system, sans-serif';
    const label = !d.known ? ('?' + d.id)
      : (d.id + ':' + (answers[d.id] || d.letter));
    const ly = flash ? cy + edge * 0.55 : cy + 7;
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#000';
    ctx.strokeText(label, cx, ly);
    ctx.fillStyle = color;
    ctx.fillText(label, cx, ly);
  }
}

// ---------------------------------------------------------------- HUD
function renderHUD() {
  if (qIndex >= CFG.questions.length) return;
  const q = CFG.questions[qIndex];
  $('q-num').textContent = 'Frage ' + (qIndex + 1) + '/' + CFG.questions.length;
  $('q-text').textContent = q.text;

  const counts = {};
  for (const v of Object.values(answers)) counts[v] = (counts[v] || 0) + 1;
  const opts = $('q-opts');
  opts.innerHTML = '';
  for (const code of Object.keys(q.options).sort()) {
    const span = document.createElement('span');
    span.className = 'q-opt';
    span.innerHTML = '<b>' + code + '</b> ' + escapeHtml(q.options[code])
      + ' <span class="cnt">[' + (counts[code] || 0) + ']</span>';
    opts.appendChild(span);
  }

  const total = CFG.participants.length;
  const scanned = Object.keys(answers).length;
  $('cnt-scanned').textContent = scanned;
  $('cnt-total').textContent = total;
  $('cnt-missing').textContent = (total - scanned);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ---------------------------------------------------------------- Fragenfluss
function finishQuestion(save) {
  if (qIndex >= CFG.questions.length) return;
  if (save) {
    const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const q = CFG.questions[qIndex];
    for (const id of CFG.participants) {
      const code = answers[id] || '';
      results.push({
        ts: ts, qid: q.id, qtext: q.text, marker: id, code: code,
        text: code ? (q.options[code] || '(ungueltige Option)') : '',
        scanned: code ? 'ja' : 'nein'
      });
    }
  }
  qIndex++;
  answers = {}; recent = {}; unknown = new Set(); lastDetected = []; lockAt = {};
  saveProgress();
  if (qIndex >= CFG.questions.length) showDone();
  else renderHUD();
}

function resetQuestion() {
  answers = {}; recent = {}; unknown = new Set(); lockAt = {};
  saveProgress();
  renderHUD();
}

function showDone() {
  running = false;
  const qCount = new Set(results.map((r) => r.qid)).size;
  $('done-info').textContent = qCount + ' Frage(n) erfasst, '
    + results.length + ' Datenzeilen.';
  showScreen('done');
}

function restartSession() {
  qIndex = 0; results = []; answers = {}; recent = {}; unknown = new Set(); lockAt = {};
  clearProgress();
  showScreen('scan');
  renderHUD();
  if (!running && video && video.srcObject) {
    running = true;
    requestAnimationFrame(loop);
  }
}

// ---------------------------------------------------------------- CSV
function exportCSV() {
  if (results.length === 0) { alert('Es liegen noch keine Ergebnisse vor.'); return; }
  const head = ['Zeitstempel', 'Frage_ID', 'Frage_Text', 'Marker_ID',
                'Antwort_Code', 'Antwort_Text', 'Gescannt'];
  const esc = (v) => {
    v = String(v);
    return /[";\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  };
  const lines = [head.join(';')];
  for (const r of results) {
    lines.push([r.ts, r.qid, r.qtext, r.marker, r.code, r.text, r.scanned]
      .map(esc).join(';'));
  }
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv' });
  const name = 'ergebnisse_'
    + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.csv';
  try {
    const file = new File([blob], name, { type: 'text/csv' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: name }).catch(() => downloadBlob(blob, name));
      return;
    }
  } catch (e) { /* faellt auf Download zurueck */ }
  downloadBlob(blob, name);
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}

// ---------------------------------------------------------------- Persistenz
function saveProgress() {
  try {
    localStorage.setItem(LS_PROGRESS, JSON.stringify({
      qIndex: qIndex, answers: answers, results: results
    }));
  } catch (e) { /* Speicher voll - ignorieren */ }
}

function loadProgress() {
  try {
    const s = localStorage.getItem(LS_PROGRESS);
    if (!s) return null;
    const p = JSON.parse(s);
    p.results = p.results || [];
    return p;
  } catch (e) { return null; }
}

function clearProgress() {
  try { localStorage.removeItem(LS_PROGRESS); } catch (e) {}
}

// ---------------------------------------------------------------- Sheets
function showScreen(name) {
  currentScreen = name;
  for (const id of ['screen-start', 'screen-scan', 'screen-done']) {
    $(id).classList.toggle('hidden', id !== 'screen-' + name);
  }
  updateOrientation();
}

function openSheet(id) { $(id).classList.remove('hidden'); }
function closeSheets() {
  for (const s of document.querySelectorAll('.sheet')) s.classList.add('hidden');
}

function renderMissing() {
  const miss = $('miss-chips'), scan = $('scan-chips');
  miss.innerHTML = ''; scan.innerHTML = '';
  let nm = 0, ns = 0;
  for (const id of CFG.participants) {
    const c = document.createElement('span');
    if (answers[id] != null) {
      c.className = 'chip scanned';
      c.textContent = id + ':' + answers[id];
      scan.appendChild(c); ns++;
    } else {
      c.className = 'chip missing';
      c.textContent = id;
      miss.appendChild(c); nm++;
    }
  }
  $('miss-count').textContent = nm;
  $('scan-count').textContent = ns;
}

function renderTest() {
  const tb = $('test-rows');
  tb.innerHTML = '';
  const sorted = lastDetected.slice().sort((a, b) => a.id - b.id);
  for (const d of sorted) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>' + (d.known ? d.id : '?' + d.id) + '</td>'
      + '<td>' + d.angle.toFixed(0) + '&deg;</td>'
      + '<td>' + d.key + '&deg;</td>'
      + '<td><b>' + d.letter + '</b></td>';
    tb.appendChild(tr);
  }
  if (sorted.length === 0) {
    tb.innerHTML = '<tr><td colspan="4" style="color:#9fb0b0">'
      + 'Kein Marker im Bild ...</td></tr>';
  }
}

// ---------------------------------------------------------------- Config-Editor
async function openConfigSheet() {
  const stored = localStorage.getItem(LS_CFG);
  $('config-text').value = stored
    ? JSON.stringify(JSON.parse(stored), null, 2)
    : await defaultConfigText();
  $('config-msg').textContent = '';
  openSheet('sheet-config');
}

function saveConfigFromEditor() {
  const msg = $('config-msg');
  let raw;
  try { raw = JSON.parse($('config-text').value); }
  catch (e) {
    msg.className = 'msg err';
    msg.textContent = 'JSON-Fehler: ' + e.message;
    return;
  }
  const norm = normalizeConfig(raw);
  if (norm.questions.length === 0) {
    msg.className = 'msg err';
    msg.textContent = 'Es ist keine Frage definiert.';
    return;
  }
  if (norm.participants.length === 0) {
    msg.className = 'msg err';
    msg.textContent = 'Es ist kein Teilnehmer definiert.';
    return;
  }
  localStorage.setItem(LS_CFG, JSON.stringify(raw));
  applyConfig(raw);
  qIndex = 0; results = []; answers = {}; recent = {}; unknown = new Set();
  clearProgress();
  msg.className = 'msg ok';
  msg.textContent = 'Gespeichert. Die Sitzung wurde zurueckgesetzt.';
  renderHUD();
}

async function resetConfigToDefault() {
  localStorage.removeItem(LS_CFG);
  $('config-text').value = await defaultConfigText();
  $('config-msg').className = 'msg ok';
  $('config-msg').textContent = 'Standard geladen. Zum Anwenden "Speichern" druecken.';
}

// ---------------------------------------------------------------- Events
function wireEvents() {
  $('btn-start').addEventListener('click', startCamera);
  $('btn-start-menu').addEventListener('click', () => openSheet('sheet-menu'));

  $('btn-next').addEventListener('click', () => finishQuestion(true));
  $('btn-skip').addEventListener('click', () => {
    if (confirm('Frage ohne Speichern ueberspringen?')) finishQuestion(false);
  });
  $('btn-reset').addEventListener('click', () => {
    if (confirm('Erfasste Antworten dieser Frage verwerfen?')) resetQuestion();
  });
  $('btn-missing').addEventListener('click', () => { renderMissing(); openSheet('sheet-missing'); });
  $('btn-menu').addEventListener('click', () => openSheet('sheet-menu'));

  $('btn-export-done').addEventListener('click', exportCSV);
  $('btn-restart').addEventListener('click', () => {
    if (confirm('Neue Sitzung? Nicht exportierte Ergebnisse gehen verloren.')) restartSession();
  });

  for (const b of document.querySelectorAll('.close-sheet')) {
    b.addEventListener('click', closeSheets);
  }

  $('m-test').addEventListener('click', () => { closeSheets(); renderTest(); openSheet('sheet-test'); });
  $('m-config').addEventListener('click', () => { closeSheets(); openConfigSheet(); });
  $('m-export').addEventListener('click', () => { closeSheets(); exportCSV(); });
  $('m-markers').addEventListener('click', () => { location.href = 'markers.html'; });
  $('m-restart').addEventListener('click', () => {
    if (confirm('Neue Sitzung? Nicht exportierte Ergebnisse gehen verloren.')) {
      closeSheets(); restartSession();
    }
  });

  $('config-save').addEventListener('click', saveConfigFromEditor);
  $('config-default').addEventListener('click', resetConfigToDefault);

  window.addEventListener('resize', () => { if (running && video.videoWidth) sizeCanvas(); });
  initStats();
}

// ---------------------------------------------------------------- Statistik
/* Querformat = grosse Ergebnis-Anzeige ("plakativ"):
   - waehrend des Scannens: Live-Verteilung der aktuellen Frage
     (Erkennung pausiert, damit beim Praesentieren nichts einrastet)
   - nach Abschluss: durch alle Fragen blaetterbar
   Hochkant drehen fuehrt zurueck zum Scannen bzw. Abschluss-Bildschirm. */

const mqLandscape = window.matchMedia('(orientation: landscape)');

function updateOrientation() {
  const wantStats = mqLandscape.matches
    && (currentScreen === 'scan' || currentScreen === 'done');
  if (wantStats === statsVisible) {
    if (wantStats) renderStats();
    return;
  }
  statsVisible = wantStats;
  $('screen-stats').classList.toggle('hidden', !statsVisible);
  if (statsVisible) {
    statsIndex = (currentScreen === 'scan')
      ? qIndex
      : Math.min(statsIndex, CFG.questions.length - 1);
    renderStats();
    statsTimer = setInterval(() => { if (statsLive()) renderStats(); }, 700);
  } else if (statsTimer) {
    clearInterval(statsTimer);
    statsTimer = null;
  }
}

function statsLive() {
  return currentScreen === 'scan' && statsIndex === qIndex;
}

function maxStatsIndex() {
  return (currentScreen === 'done')
    ? CFG.questions.length - 1
    : Math.min(qIndex, CFG.questions.length - 1);
}

function countsForStats(qi) {
  const q = CFG.questions[qi];
  const counts = {};
  let n = 0;
  if (currentScreen === 'scan' && qi === qIndex) {
    // laufende Frage: Live-Zaehlung
    for (const v of Object.values(answers)) {
      counts[v] = (counts[v] || 0) + 1; n++;
    }
  } else {
    // abgeschlossene Frage: aus den gespeicherten Ergebnissen
    for (const r of results) {
      if (r.qid === q.id && r.code) {
        counts[r.code] = (counts[r.code] || 0) + 1; n++;
      }
    }
  }
  return { counts: counts, n: n };
}

function renderStats() {
  if (!CFG || CFG.questions.length === 0) return;
  statsIndex = Math.max(0, Math.min(statsIndex, maxStatsIndex()));
  const q = CFG.questions[statsIndex];
  const res = countsForStats(statsIndex);

  $('stats-qnum').textContent =
    'Frage ' + (statsIndex + 1) + ' / ' + CFG.questions.length;
  $('stats-qtext').textContent = q.text;
  $('stats-live').classList.toggle('hidden', !statsLive());
  $('stats-prev').disabled = statsIndex <= 0;
  $('stats-next').disabled = statsIndex >= maxStatsIndex();

  const codes = Object.keys(q.options).sort();
  const maxC = Math.max(1, ...codes.map((c) => res.counts[c] || 0));
  const chart = $('stats-chart');
  chart.innerHTML = '';
  for (const code of codes) {
    const c = res.counts[code] || 0;
    const h = c === 0 ? 0 : Math.max(3, Math.round(100 * c / maxC));
    const col = document.createElement('div');
    col.className = 'sbar-col';
    col.innerHTML =
      '<div class="sbar-value' + (c === 0 ? ' zero' : '') + '">' + c + '</div>'
      + '<div class="sbar-track"><div class="sbar" style="height:' + h + '%"></div></div>'
      + '<div class="sbar-code">' + escapeHtml(code) + '</div>'
      + '<div class="sbar-label">' + escapeHtml(q.options[code]) + '</div>';
    chart.appendChild(col);
  }

  $('stats-n').textContent = 'n = ' + res.n + ' von ' + CFG.participants.length;
  $('stats-hint').textContent = (currentScreen === 'done')
    ? 'blaettern mit ‹ ›   ·   hochkant drehen = zurueck'
    : 'hochkant drehen = weiter scannen';
}

function initStats() {
  $('stats-prev').addEventListener('click', () => { statsIndex--; renderStats(); });
  $('stats-next').addEventListener('click', () => { statsIndex++; renderStats(); });
  if (mqLandscape.addEventListener) {
    mqLandscape.addEventListener('change', updateOrientation);
  }
  window.addEventListener('resize', updateOrientation);
  window.addEventListener('orientationchange', updateOrientation);
  // Absicherung, falls ein Rotations-Event verschluckt wird
  setInterval(updateOrientation, 1200);
}
