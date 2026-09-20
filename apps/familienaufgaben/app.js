// Familienaufgaben – Local-First-PWA.
// Alle Daten liegen vollstaendig auf jedem Geraet (IndexedDB). Abgeglichen wird ueber
// api/sync.php, wo nur ein mit dem Familien-Passwort verschluesselter Block liegt.
// Zusammengefuehrt wird pro Datensatz nach dem Prinzip "letzte Aenderung gewinnt".
(() => {
'use strict';

// ---------------------------------------------------------------- Konstanten
const PROFILE = new URLSearchParams(location.search).get('profile') || ''; // nur fuer Tests: getrennte Geraete im selben Browser
const DB_NAME = 'familienaufgaben' + (PROFILE ? '-' + PROFILE : '');
const API_URL = 'api/sync.php';
const ADMIN_MINUTES = 5;      // so lange bleibt der Elternmodus nach PIN-Eingabe offen
const EXPIRE_DAYS = 3;        // verpasste wiederkehrende Termine verfallen so viele Tage nach Fristende
const UPCOMING_DAYS = 7;
const DONE_DAYS = 7;
const SYNC_INTERVAL_MS = 30000;
const COLLECTIONS = ['members', 'tasks', 'completions', 'transactions'];
const COLORS = ['#d9472b', '#2f7d5b', '#e0a526', '#2b6cb0', '#8e4585', '#d46a92', '#3f8f9b', '#7a5c3e'];
const EMOJIS = ['🦊', '🐻', '🐼', '🦁', '🐸', '🐙', '🦄', '🐝', '🦉', '🐳', '🚀', '⚽', '🎸', '🌻', '🍀', '⭐'];
const WEEKDAYS = [[1, 'Mo'], [2, 'Di'], [3, 'Mi'], [4, 'Do'], [5, 'Fr'], [6, 'Sa'], [0, 'So']];

const ICONS = {
  tasks: '<path d="M4 6.5l1.8 1.8L9 5M4 12.5l1.8 1.8L9 11M4 18.5l1.8 1.8L9 17M12.5 7H20M12.5 13H20M12.5 19H20"/>',
  book: '<path d="M5 4h11a3 3 0 013 3v13H8a3 3 0 01-3-3V4zM5 17a3 3 0 013-3h11M9.5 8.5h5"/>',
  manage: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  more: '<circle cx="5.5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18.5" cy="12" r="1.4"/>',
  lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8 10.5V8a4 4 0 018 0v2.5"/>',
  unlock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8 10.5V8a4 4 0 017.6-1.7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  repeat: '<path d="M17 3.5l3 3-3 3M4 11.5v-1a4 4 0 014-4h12M7 20.5l-3-3 3-3M20 12.5v1a4 4 0 01-4 4H4"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  undo: '<path d="M8 5L4 9l4 4M4 9h10a6 6 0 010 12h-3"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  chevron: '<path d="M9 5l7 7-7 7"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4"/>',
};

// ---------------------------------------------------------------- Hilfsfunktionen
const $ = (sel, el = document) => el.querySelector(sel);

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

function icon(name, cls = '') {
  const span = h('span', { class: 'icon ' + cls, 'aria-hidden': 'true' });
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
  return span;
}

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join(''));
const pad = (n) => String(n).padStart(2, '0');
const dateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12); };
const today = () => dateStr(new Date());
const addDays = (s, n) => { const d = parseDate(s); d.setDate(d.getDate() + n); return dateStr(d); };
const diffDays = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 864e5);
const weekStart = (s) => addDays(s, -((parseDate(s).getDay() + 6) % 7));
const maxStr = (a, b) => (a > b ? a : b);

const euroFmt = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const euro = (cents) => euroFmt.format((cents || 0) / 100);
const centsToText = (cents) => (cents / 100).toFixed(2).replace('.', ',');
function parseMoney(text) {
  const n = parseFloat(String(text).trim().replace(/\s|€/g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

function fmtDay(s) {
  const diff = diffDays(today(), s);
  if (diff === 0) return 'heute';
  if (diff === 1) return 'morgen';
  if (diff === -1) return 'gestern';
  return parseDate(s).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'numeric' });
}
const fmtLong = (d) => d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
const fmtStamp = (ts) => new Date(ts).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

// ---------------------------------------------------------------- Speicher (IndexedDB, ein Schluessel)
const store = {
  db: null,
  open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => { this.db = req.result; resolve(); };
      req.onerror = () => reject(req.error);
    });
  },
  tx(mode, fn) {
    return new Promise((resolve, reject) => {
      const t = this.db.transaction('kv', mode);
      const req = fn(t.objectStore('kv'));
      t.oncomplete = () => resolve(req.result);
      t.onerror = () => reject(t.error);
    });
  },
  get(key) { return this.tx('readonly', (s) => s.get(key)); },
  set(key, val) { return this.tx('readwrite', (s) => s.put(val, key)); },
  clear() { return this.tx('readwrite', (s) => s.clear()); },
};

// ---------------------------------------------------------------- Zustand
let S = null; // dauerhaft gespeichert: {deviceId, me, family, serverVersion, dirty, data}
const ui = { tab: 'tasks', filter: 'me', adminUntil: 0, sync: 'ok', lastSync: 0, syncError: '' };
let changeCounter = 0;

const emptyData = () => ({ members: {}, tasks: {}, completions: {}, transactions: {}, settings: { updatedAt: 0 } });
const live = (coll) => Object.values(coll).filter((r) => !r.deleted);
const member = (id) => { const m = S.data.members[id]; return m && !m.deleted ? m : null; };
const me = () => (S.me ? member(S.me) : null);

function touch(rec) {
  rec.updatedAt = Math.max(Date.now(), (rec.updatedAt || 0) + 1);
  rec.dev = S.deviceId;
  return rec;
}

const persist = () => store.set('state', S).catch((e) => console.error('Speichern fehlgeschlagen', e));

function save() {
  S.dirty = true;
  changeCounter++;
  persist();
  render();
  scheduleSync(1200);
}

// ---------------------------------------------------------------- Zusammenfuehren
const newer = (a, b) => a.updatedAt > b.updatedAt || (a.updatedAt === b.updatedAt && (a.dev || '') > (b.dev || ''));

function mergeData(local, remote) {
  const out = emptyData();
  let localWins = false, changed = false;
  const pick = (a, b) => {
    if (!b) { localWins = true; return a; }
    if (!a) { changed = true; return b; }
    if (newer(a, b)) { localWins = true; return a; }
    if (newer(b, a)) changed = true;
    return b;
  };
  for (const coll of COLLECTIONS) {
    const L = local[coll] || {}, R = remote[coll] || {};
    for (const id of new Set([...Object.keys(L), ...Object.keys(R)])) out[coll][id] = pick(L[id], R[id]);
  }
  out.settings = pick(local.settings || { updatedAt: 0 }, remote.settings || { updatedAt: 0 });
  return { data: out, localWins, changed };
}

// ---------------------------------------------------------------- Kryptografie
const enc = new TextEncoder(), dec = new TextDecoder();

function toB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const fromB64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

async function pbkdf2(secret, salt, iterations, bits) {
  const base = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base, bits));
}

// Aus Familienname + Passwort entstehen der AES-Schluessel und die Familien-ID fuer den Server.
// Der Server erfaehrt nur die ID; daraus laesst sich der Schluessel nicht ableiten.
async function deriveFamily(name, password) {
  const salt = enc.encode('familienaufgaben-v1|' + name.trim().toLowerCase());
  const bits = await pbkdf2(password, salt, 250000, 512);
  return { name: name.trim(), key: toB64(bits.subarray(0, 32)), id: toHex(bits.subarray(32, 64)) };
}

async function hashPin(pin, saltB64) {
  const salt = saltB64 ? fromB64(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const bits = await pbkdf2(pin, salt, 100000, 256);
  return { pinSalt: toB64(salt), pinHash: toB64(bits) };
}

async function throughStream(bytes, stream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}

const aesKey = (usage) => crypto.subtle.importKey('raw', fromB64(S.family.key), 'AES-GCM', false, [usage]);

// Format: 12 Byte IV + AES-GCM(Flag-Byte + Nutzdaten); Flag 1 = gzip, 0 = unkomprimiert.
async function encryptData(data) {
  let body = enc.encode(JSON.stringify(data)), flag = 0;
  if (typeof CompressionStream === 'function') { body = await throughStream(body, new CompressionStream('gzip')); flag = 1; }
  const plain = new Uint8Array(body.length + 1);
  plain[0] = flag;
  plain.set(body, 1);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey('encrypt'), plain));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return toB64(out);
}

async function decryptData(b64) {
  const buf = fromB64(b64);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf.subarray(0, 12) }, await aesKey('decrypt'), buf.subarray(12)));
  let body = plain.subarray(1);
  if (plain[0] === 1) body = await throughStream(body, new DecompressionStream('gzip'));
  const data = JSON.parse(dec.decode(body));
  for (const coll of COLLECTIONS) if (!data[coll] || typeof data[coll] !== 'object') data[coll] = {};
  if (!data.settings) data.settings = { updatedAt: 0 };
  return data;
}

// ---------------------------------------------------------------- Synchronisation
let syncing = false, syncAgain = false, syncTimer = null;

async function api(body) {
  const res = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' });
  if (res.status !== 200 && res.status !== 409) throw new Error('Server antwortet mit ' + res.status);
  return { status: res.status, json: await res.json() };
}

function setSync(state, error = '') {
  ui.sync = state;
  ui.syncError = error;
  const dot = $('#sync-dot');
  if (dot) { dot.dataset.state = state; dot.title = syncLabel(); }
  if (ui.tab === 'more' && !$('#modal-root').children.length) render();
}

function syncLabel() {
  switch (ui.sync) {
    case 'syncing': return 'Synchronisiere …';
    case 'offline': return S && S.dirty ? 'Offline – Änderungen warten auf den nächsten Abgleich' : 'Offline';
    case 'error': return 'Abgleich fehlgeschlagen: ' + ui.syncError;
    default: return ui.lastSync ? 'Abgeglichen um ' + new Date(ui.lastSync).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : 'Bereit';
  }
}

function scheduleSync(delay) {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(sync, delay);
}

async function sync() {
  if (!S || !S.family) return;
  if (syncing) { syncAgain = true; return; }
  if (!navigator.onLine) { setSync('offline'); return; }
  syncing = true;
  setSync('syncing');
  try {
    let res = (await api({ action: 'pull', family: S.family.id, known: S.serverVersion })).json;
    for (let attempt = 0; attempt < 6; attempt++) {
      let localWins = S.dirty;
      if (res.data && res.version !== S.serverVersion) {
        const m = mergeData(S.data, await decryptData(res.data));
        S.data = m.data;
        localWins = m.localWins;
        S.serverVersion = res.version;
        await persist();
        if (m.changed) render();
      } else if (!res.unchanged) {
        S.serverVersion = res.version; // leere oder zurueckgesetzte Ablage
        localWins = true;
      }
      if (!localWins) { S.dirty = false; break; }
      const counter = changeCounter;
      const push = await api({ action: 'push', family: S.family.id, base: S.serverVersion, data: await encryptData(S.data) });
      if (push.status === 200) {
        S.serverVersion = push.json.version;
        if (counter === changeCounter) S.dirty = false; else syncAgain = true;
        break;
      }
      res = push.json; // Konflikt: anderes Geraet war schneller -> zusammenfuehren, erneut versuchen
    }
    await persist();
    ui.lastSync = Date.now();
    setSync('ok');
  } catch (e) {
    console.warn('Sync', e);
    if (!navigator.onLine || e instanceof TypeError) setSync('offline'); else setSync('error', e.message);
  } finally {
    syncing = false;
    if (syncAgain) { syncAgain = false; scheduleSync(300); }
  }
}

// ---------------------------------------------------------------- Termine & Konten
const weekdaysOf = (task) => (task.repeat.weekdays && task.repeat.weekdays.length ? task.repeat.weekdays : [parseDate(task.date).getDay()]);
const monthsBetween = (a, b) => (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth();

function isOccurrence(task, d) {
  if (d < task.date || (task.endDate && d > task.endDate)) return false;
  const n = Math.max(1, task.repeat.interval || 1);
  switch (task.repeat.freq) {
    case 'daily': return diffDays(task.date, d) % n === 0;
    case 'weekly': return (diffDays(weekStart(task.date), weekStart(d)) / 7) % n === 0 && weekdaysOf(task).includes(parseDate(d).getDay());
    case 'monthly': {
      const a = parseDate(task.date), b = parseDate(d);
      if (monthsBetween(a, b) % n) return false;
      const lastDay = new Date(b.getFullYear(), b.getMonth() + 1, 0).getDate();
      return b.getDate() === Math.min(a.getDate(), lastDay);
    }
    default: return d === task.date;
  }
}

// Wer eine Aufgabe erledigen darf: die zugewiesenen Personen – ohne Zuweisung alle.
// Bei mehreren gilt "wer sie erledigt, bekommt die Belohnung"; es wird nicht abgewechselt.
const assignedTo = (task) => (task.assigneeIds || []).filter((id) => member(id));
function eligibleFor(task) {
  const ids = assignedTo(task);
  return ids.length ? ids : live(S.data.members).map((m) => m.id);
}
const isAlways = (task) => task.repeat.freq === 'always';
const doneToday = (task) => Object.values(S.data.completions).filter((c) => c.done && c.taskId === task.id && c.date === today()).length;

function collectOccurrences() {
  const t = today(), horizon = addDays(t, UPCOMING_DAYS);
  const overdue = [], open = [], upcoming = [], always = [];
  for (const task of live(S.data.tasks)) {
    const eligible = eligibleFor(task);
    if (!eligible.length) continue;
    if (isAlways(task)) { always.push({ task, date: t, deadline: t, eligible, always: true }); continue; }
    const grace = task.graceDays || 0;
    const once = task.repeat.freq === 'none';
    const dates = [];
    if (once) { if (task.date <= horizon) dates.push(task.date); }
    else for (let d = maxStr(task.date, addDays(t, -(grace + EXPIRE_DAYS))); d <= horizon; d = addDays(d, 1)) if (isOccurrence(task, d)) dates.push(d);
    let hasUpcoming = false;
    for (const d of dates) {
      const c = S.data.completions[task.id + '|' + d];
      if (c && c.done) continue;
      const occ = { task, date: d, deadline: addDays(d, grace), eligible };
      if (d > t) { if (!hasUpcoming) upcoming.push(occ); hasUpcoming = true; }
      else if (occ.deadline < t) overdue.push(occ);
      else open.push(occ);
    }
  }
  const byTitle = (a, b) => a.task.title.localeCompare(b.task.title, 'de');
  const byDeadline = (a, b) => (a.deadline + a.task.title).localeCompare(b.deadline + b.task.title);
  return { overdue: overdue.sort(byDeadline), open: open.sort(byDeadline), always: always.sort(byTitle), upcoming: upcoming.sort((a, b) => (a.date + a.task.title).localeCompare(b.date + b.task.title)) };
}

function repeatLabel(task) {
  const r = task.repeat, n = Math.max(1, r.interval || 1);
  if (r.freq === 'daily') return n === 1 ? 'täglich' : `alle ${n} Tage`;
  if (r.freq === 'weekly') {
    const days = WEEKDAYS.filter(([wd]) => weekdaysOf(task).includes(wd)).map(([, l]) => l).join(', ');
    return (n === 1 ? 'wöchentlich ' : `alle ${n} Wochen `) + days;
  }
  if (r.freq === 'monthly') return (n === 1 ? 'monatlich' : `alle ${n} Monate`) + ` am ${parseDate(task.date).getDate()}.`;
  return r.freq === 'always' ? 'immer offen' : 'einmalig';
}

function balanceOf(memberId) {
  let sum = 0;
  for (const c of Object.values(S.data.completions)) if (c.done && c.memberId === memberId) sum += c.reward || 0;
  for (const x of live(S.data.transactions)) if (x.memberId === memberId) sum += x.amount || 0;
  return sum;
}

function ledgerOf(memberId) {
  const rows = [];
  for (const c of Object.values(S.data.completions)) if (c.done && c.memberId === memberId) rows.push({ ts: c.doneAt, title: c.title, amount: c.reward || 0, late: c.late });
  for (const x of live(S.data.transactions)) if (x.memberId === memberId) rows.push({ ts: x.ts, title: x.note, amount: x.amount, tx: x });
  return rows.sort((a, b) => b.ts - a.ts);
}

// ---------------------------------------------------------------- Aktionen
async function completeOcc(occ, slipEl) {
  if (!me()) { toast('Bitte zuerst unter „Mehr“ festlegen, wem dieses iPhone gehört.'); return; }
  // Gutgeschrieben wird, wer abhakt. Im Elternmodus (oder wenn das Gerät nicht berechtigt ist)
  // wird gefragt, wer es war.
  let who = S.me;
  if (!occ.eligible.includes(S.me)) {
    if (!(await requireAdmin('Diese Aufgabe ist jemand anderem zugewiesen.'))) return;
    who = occ.eligible.length === 1 ? occ.eligible[0] : await chooseMember(occ.eligible);
  } else if (isAdmin() && occ.eligible.length > 1) {
    who = await chooseMember(occ.eligible, S.me);
  }
  if (!who) return;
  if (slipEl) { slipEl.classList.add('stamped'); await new Promise((r) => setTimeout(r, 750)); }
  // Immer offene Aufgaben können mehrmals am Tag anfallen -> jede Erledigung ist ein eigener Eintrag.
  const id = occ.task.id + '|' + occ.date + (occ.always ? '|' + uid().slice(0, 8) : '');
  const rec = S.data.completions[id] || { id, taskId: occ.task.id, date: occ.date };
  Object.assign(rec, { memberId: who, title: occ.task.title, reward: occ.task.reward || 0, done: true, doneAt: Date.now(), doneBy: S.me, late: !occ.always && today() > occ.deadline });
  S.data.completions[id] = touch(rec);
  save();
}

async function undoCompletion(c) {
  const own = c.doneBy === S.me && dateStr(new Date(c.doneAt)) === today();
  if (!own && !(await requireAdmin('Ältere oder fremde Einträge kann nur ein Elternteil zurücknehmen.'))) return;
  c.done = false;
  touch(c);
  save();
  toast('Zurückgenommen – die Belohnung wurde wieder abgezogen.');
}

// ---------------------------------------------------------------- Dialoge
function openSheet(title, build, opts = {}) {
  const root = $('#modal-root');
  const body = h('div', { class: 'sheet-body' });
  let closed = false;
  const close = (result) => {
    if (closed) return;
    closed = true;
    wrap.classList.add('closing');
    setTimeout(() => { wrap.remove(); if (!root.children.length) document.body.classList.remove('modal-open'); }, 220);
    if (opts.onClose) opts.onClose(result);
  };
  const wrap = h('div', { class: 'sheet-wrap', onclick: (e) => { if (e.target === wrap) close(); } },
    h('section', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('header', { class: 'sheet-head' }, h('h2', null, title), h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Schließen', onclick: () => close() }, icon('close'))),
      body));
  root.append(wrap);
  document.body.classList.add('modal-open');
  build(body, close);
  return close;
}

const isAdmin = () => Date.now() < ui.adminUntil;
let adminTimer;
function setAdmin(on) {
  ui.adminUntil = on ? Date.now() + ADMIN_MINUTES * 60000 : 0;
  clearTimeout(adminTimer);
  if (on) adminTimer = setTimeout(render, ADMIN_MINUTES * 60000 + 200);
  render();
}

function requireAdmin(reason) {
  if (isAdmin()) return Promise.resolve(true);
  return new Promise((resolve) => {
    let ok = false;
    openSheet('Eltern-PIN', (body, close) => {
      const input = h('input', { type: 'password', inputmode: 'numeric', autocomplete: 'off', class: 'pin-input', maxLength: 8, placeholder: '••••', 'aria-label': 'Eltern-PIN' });
      const msg = h('p', { class: 'form-error' });
      const form = h('form', { class: 'form', onsubmit: async (e) => {
        e.preventDefault();
        const s = S.data.settings;
        const res = await hashPin(input.value, s.pinSalt);
        if (res.pinHash === s.pinHash) { ok = true; setAdmin(true); close(); }
        else { msg.textContent = 'Das war nicht die richtige PIN.'; input.value = ''; form.classList.remove('shake'); void form.offsetWidth; form.classList.add('shake'); }
      } },
        reason && h('p', { class: 'hint' }, reason),
        input, msg,
        h('button', { class: 'btn primary', type: 'submit' }, 'Entsperren'),
        h('p', { class: 'hint center' }, `Der Elternmodus bleibt ${ADMIN_MINUTES} Minuten offen.`));
      body.append(form);
      setTimeout(() => input.focus(), 250);
    }, { onClose: () => resolve(ok) });
  });
}

// ---------------------------------------------------------------- Formularbausteine
const field = (label, control, hint) => h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), control, hint && h('span', { class: 'hint' }, hint));

function segmented(options, value, onChange) {
  return h('div', { class: 'segmented', role: 'group' }, options.map(([val, label]) =>
    h('button', { type: 'button', class: val === value ? 'on' : '', 'aria-pressed': String(val === value), onclick: () => onChange(val) }, label)));
}

function memberChip(m, on, onclick) {
  return h('button', { type: 'button', class: 'chip person' + (on ? ' on' : ''), style: '--c:' + m.color, 'aria-pressed': String(on), onclick }, h('span', { class: 'chip-emoji' }, m.emoji), m.name);
}

// ---------------------------------------------------------------- Formulare
function taskForm(existing) {
  const d = existing ? JSON.parse(JSON.stringify(existing)) : { id: uid(), title: '', description: '', assigneeIds: [], reward: 50, date: today(), graceDays: 0, endDate: null, repeat: { freq: 'none', interval: 1, weekdays: [] } };
  let rewardText = centsToText(d.reward);
  let deadline = addDays(d.date, d.graceDays || 0);
  let kind = d.repeat.freq === 'none' ? 'once' : d.repeat.freq === 'always' ? 'always' : 'repeat';

  openSheet(existing ? 'Aufgabe bearbeiten' : 'Neue Aufgabe', (body, close) => {
    const draw = () => {
      const members = live(S.data.members);
      const once = kind === 'once', always = kind === 'always';
      const unit = { daily: ['Tag', 'Tage'], weekly: ['Woche', 'Wochen'], monthly: ['Monat', 'Monate'] }[d.repeat.freq] || ['', ''];
      body.replaceChildren(h('form', { class: 'form', onsubmit: (e) => { e.preventDefault(); submit(); } },
        field('Was ist zu tun?', h('input', { type: 'text', value: d.title, maxLength: 80, placeholder: 'z. B. Spülmaschine ausräumen', oninput: (e) => { d.title = e.target.value; } })),
        field('Beschreibung', h('textarea', { rows: 3, value: d.description, placeholder: 'Worauf kommt es an?', oninput: (e) => { d.description = e.target.value; } })),
        h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Wer?'),
          h('div', { class: 'chips' }, members.map((m) => memberChip(m, d.assigneeIds.includes(m.id), () => {
            d.assigneeIds = d.assigneeIds.includes(m.id) ? d.assigneeIds.filter((x) => x !== m.id) : [...d.assigneeIds, m.id];
            draw();
          }))),
          h('span', { class: 'hint' }, !d.assigneeIds.length ? 'Niemand ausgewählt: Jeder in der Familie kann die Aufgabe erledigen.'
            : d.assigneeIds.length > 1 ? 'Eine der ausgewählten Personen erledigt sie – wer abhakt, bekommt die Belohnung.' : 'Nur diese Person kann die Aufgabe abhaken.')),
        field('Belohnung in Euro', h('input', { type: 'text', inputmode: 'decimal', value: rewardText, oninput: (e) => { rewardText = e.target.value; } })),
        h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Art'),
          segmented([['once', 'Einmalig'], ['repeat', 'Regelmäßig'], ['always', 'Immer offen']], kind, (v) => {
            kind = v;
            d.repeat.freq = v === 'once' ? 'none' : v === 'always' ? 'always' : (['daily', 'weekly', 'monthly'].includes(d.repeat.freq) ? d.repeat.freq : 'weekly');
            draw();
          }),
          always && h('span', { class: 'hint' }, 'Steht dauerhaft in der Liste und kann beliebig oft abgehakt werden – jedes Mal gibt es die Belohnung. Ideal für Spülmaschine, Müll & Co.')),
        !always && h('div', { class: 'row' },
          field(once ? 'Datum' : 'Erster Termin', h('input', { type: 'date', value: d.date, required: true, oninput: (e) => { if (e.target.value) { d.date = e.target.value; if (deadline < d.date) { deadline = d.date; draw(); } } } })),
          once
            ? field('Frist bis', h('input', { type: 'date', value: deadline, min: d.date, oninput: (e) => { if (e.target.value) deadline = e.target.value; } }))
            : field('Frist', h('select', { onchange: (e) => { d.graceDays = Number(e.target.value); } },
              [0, 1, 2, 3, 5, 7, 14].map((n) => h('option', { value: String(n), selected: (d.graceDays || 0) === n }, n === 0 ? 'am selben Tag' : n === 1 ? 'bis zum Folgetag' : `${n} Tage Zeit`))))),
        kind === 'repeat' && h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Wiederholung'),
          segmented([['daily', 'Täglich'], ['weekly', 'Wöchentlich'], ['monthly', 'Monatlich']], d.repeat.freq, (v) => { d.repeat.freq = v; draw(); })),
        kind === 'repeat' && d.repeat.freq === 'weekly' && h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'An diesen Tagen'),
          h('div', { class: 'chips' }, WEEKDAYS.map(([wd, label]) => {
            const on = weekdaysOf(d).includes(wd);
            return h('button', { type: 'button', class: 'chip day' + (on ? ' on' : ''), 'aria-pressed': String(on), onclick: () => {
              const cur = weekdaysOf(d);
              d.repeat.weekdays = on ? cur.filter((x) => x !== wd) : [...cur, wd];
              draw();
            } }, label);
          }))),
        kind === 'repeat' && h('div', { class: 'row' },
          field('Abstand', h('select', { onchange: (e) => { d.repeat.interval = Number(e.target.value); } },
            [1, 2, 3, 4, 6].map((n) => h('option', { value: String(n), selected: (d.repeat.interval || 1) === n }, n === 1 ? `jede(n) ${unit[0]}` : `alle ${n} ${unit[1]}`)))),
          field('Endet am (optional)', h('input', { type: 'date', value: d.endDate || '', min: d.date, oninput: (e) => { d.endDate = e.target.value || null; } }))),
        h('button', { class: 'btn primary', type: 'submit' }, existing ? 'Änderungen speichern' : 'Aufgabe anlegen'),
        existing && h('button', { class: 'btn danger', type: 'button', onclick: () => {
          if (!confirm(`„${existing.title}“ wirklich löschen? Bereits verdiente Belohnungen bleiben erhalten.`)) return;
          const rec = S.data.tasks[existing.id];
          rec.deleted = true;
          touch(rec);
          save();
          close();
        } }, 'Aufgabe löschen')));
    };

    const submit = () => {
      d.title = d.title.trim();
      d.description = (d.description || '').trim();
      if (!d.title) return toast('Bitte einen Titel eingeben.');
      const cents = parseMoney(rewardText);
      if (cents == null || cents < 0) return toast('Bitte eine gültige Belohnung eingeben.');
      d.reward = cents;
      if (kind === 'once') {
        d.repeat = { freq: 'none', interval: 1, weekdays: [] };
        d.graceDays = Math.max(0, diffDays(d.date, deadline));
        d.endDate = null;
      } else if (kind === 'always') {
        d.repeat = { freq: 'always', interval: 1, weekdays: [] };
        d.graceDays = 0;
        d.endDate = null;
      } else if (d.repeat.freq === 'weekly') {
        d.repeat.weekdays = weekdaysOf(d);
      }
      S.data.tasks[d.id] = touch(d);
      save();
      close();
      toast(existing ? 'Aufgabe gespeichert.' : 'Aufgabe angelegt.');
    };
    draw();
  });
}

function memberForm(existing) {
  const used = live(S.data.members).length;
  const d = existing ? { ...existing } : { id: uid(), name: '', role: 'child', color: COLORS[used % COLORS.length], emoji: EMOJIS[used % EMOJIS.length] };
  openSheet(existing ? 'Mitglied bearbeiten' : 'Neues Familienmitglied', (body, close) => {
    const draw = () => body.replaceChildren(h('form', { class: 'form', onsubmit: (e) => {
      e.preventDefault();
      d.name = d.name.trim();
      if (!d.name) return toast('Bitte einen Namen eingeben.');
      S.data.members[d.id] = touch(d);
      save();
      close();
    } },
      field('Name', h('input', { type: 'text', value: d.name, maxLength: 30, autocomplete: 'off', oninput: (e) => { d.name = e.target.value; } })),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Rolle'), segmented([['child', 'Kind'], ['parent', 'Elternteil']], d.role, (v) => { d.role = v; draw(); })),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Zeichen'),
        h('div', { class: 'swatches' }, EMOJIS.map((em) => h('button', { type: 'button', class: 'swatch emoji' + (em === d.emoji ? ' on' : ''), onclick: () => { d.emoji = em; draw(); } }, em)))),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Farbe'),
        h('div', { class: 'swatches' }, COLORS.map((c) => h('button', { type: 'button', class: 'swatch color' + (c === d.color ? ' on' : ''), style: '--c:' + c, 'aria-label': 'Farbe ' + c, onclick: () => { d.color = c; draw(); } })))),
      h('button', { class: 'btn primary', type: 'submit' }, existing ? 'Speichern' : 'Hinzufügen'),
      existing && h('button', { class: 'btn danger', type: 'button', onclick: () => {
        if (!confirm(`${existing.name} wirklich entfernen? Das Konto wird ausgeblendet.`)) return;
        const rec = S.data.members[existing.id];
        rec.deleted = true;
        touch(rec);
        save();
        close();
      } }, 'Mitglied entfernen')));
    draw();
  });
}

function txForm(m, kind) {
  const titles = { payout: 'Auszahlen', bonus: 'Gutschrift', deduct: 'Abzug' };
  const balance = balanceOf(m.id);
  let amountText = kind === 'payout' && balance > 0 ? centsToText(balance) : '';
  let note = { payout: 'Auszahlung', bonus: 'Extra-Belohnung', deduct: 'Abzug' }[kind];
  openSheet(`${titles[kind]} – ${m.name}`, (body, close) => {
    body.append(h('form', { class: 'form', onsubmit: (e) => {
      e.preventDefault();
      const cents = parseMoney(amountText);
      if (!cents || cents <= 0) return toast('Bitte einen Betrag größer als 0 eingeben.');
      const x = { id: uid(), memberId: m.id, amount: kind === 'bonus' ? cents : -cents, note: note.trim() || titles[kind], ts: Date.now() };
      S.data.transactions[x.id] = touch(x);
      save();
      close();
    } },
      h('p', { class: 'hint' }, `Aktueller Kontostand: ${euro(balance)}`),
      field('Betrag in Euro', h('input', { type: 'text', inputmode: 'decimal', value: amountText, placeholder: '0,00', oninput: (e) => { amountText = e.target.value; } })),
      field('Notiz', h('input', { type: 'text', value: note, maxLength: 60, oninput: (e) => { note = e.target.value; } })),
      h('button', { class: 'btn primary', type: 'submit' }, 'Buchen')));
  });
}

function ledgerSheet(m) {
  openSheet(`Sparbuch ${m.name}`, (body, close) => {
    const draw = () => {
      const rows = ledgerOf(m.id);
      body.replaceChildren(
        h('div', { class: 'ledger-balance', style: '--c:' + m.color }, h('span', null, 'Guthaben'), h('strong', null, euro(balanceOf(m.id)))),
        h('div', { class: 'btn-row' },
          ['payout', 'bonus', 'deduct'].map((kind) => h('button', { class: 'btn small' + (kind === 'payout' ? ' primary' : ''), type: 'button', onclick: async () => {
            if (!(await requireAdmin('Buchungen nimmt ein Elternteil vor.'))) return;
            close();
            txForm(m, kind);
          } }, { payout: 'Auszahlen', bonus: 'Gutschrift', deduct: 'Abzug' }[kind]))),
        rows.length
          ? h('ul', { class: 'ledger' }, rows.slice(0, 150).map((r) => h('li', null,
            h('span', { class: 'ledger-date' }, fmtStamp(r.ts)),
            h('span', { class: 'ledger-title' }, r.title, r.late && h('em', null, ' · verspätet')),
            h('span', { class: 'ledger-amount ' + (r.amount < 0 ? 'neg' : 'pos') }, (r.amount > 0 ? '+' : '') + euro(r.amount)),
            r.tx && isAdmin() && h('button', { class: 'icon-btn tiny', type: 'button', 'aria-label': 'Buchung löschen', onclick: () => {
              if (!confirm('Diese Buchung löschen?')) return;
              r.tx.deleted = true;
              touch(r.tx);
              save();
              draw();
            } }, icon('close')))))
          : h('p', { class: 'empty' }, 'Noch keine Einträge. Die erste erledigte Aufgabe landet hier.'));
    };
    draw();
  });
}

function pinForm() {
  openSheet('Eltern-PIN ändern', (body, close) => {
    let a = '', b = '';
    body.append(h('form', { class: 'form', onsubmit: async (e) => {
      e.preventDefault();
      if (!/^\d{4,8}$/.test(a)) return toast('Die PIN braucht 4 bis 8 Ziffern.');
      if (a !== b) return toast('Die beiden Eingaben stimmen nicht überein.');
      S.data.settings = touch({ ...S.data.settings, ...(await hashPin(a)) });
      save();
      close();
      toast('Neue PIN gespeichert – sie gilt nach dem Abgleich auf allen Geräten.');
    } },
      field('Neue PIN', h('input', { type: 'password', inputmode: 'numeric', autocomplete: 'off', maxLength: 8, oninput: (e) => { a = e.target.value; } })),
      field('Wiederholen', h('input', { type: 'password', inputmode: 'numeric', autocomplete: 'off', maxLength: 8, oninput: (e) => { b = e.target.value; } })),
      h('button', { class: 'btn primary', type: 'submit' }, 'PIN speichern')));
  });
}

function chooseMember(ids, preferred) {
  return new Promise((resolve) => {
    openSheet('Wer hat es erledigt?', (body, close) => {
      body.append(h('div', { class: 'form' },
        h('p', { class: 'hint' }, 'Die Belohnung wird dieser Person gutgeschrieben.'),
        h('div', { class: 'who-list' }, ids.map(member).filter(Boolean).map((m) => h('button', { type: 'button', class: 'who' + (m.id === preferred ? ' on' : ''), style: '--c:' + m.color, onclick: () => close(m.id) },
          h('span', { class: 'avatar big' }, m.emoji), h('span', null, m.name))))));
    }, { onClose: (id) => resolve(id || null) });
  });
}

function identitySheet(afterJoin) {
  openSheet('Wem gehört dieses iPhone?', (body, close) => {
    const members = live(S.data.members);
    body.append(h('div', { class: 'form' },
      h('p', { class: 'hint' }, 'Eigene Aufgaben lassen sich ohne PIN abhaken – darum merkt sich die App, wer dieses Gerät benutzt.'),
      h('div', { class: 'who-list' }, members.map((m) => h('button', { type: 'button', class: 'who' + (m.id === S.me ? ' on' : ''), style: '--c:' + m.color, onclick: () => {
        S.me = m.id;
        ui.filter = 'me';
        persist();
        render();
        close();
      } }, h('span', { class: 'avatar big' }, m.emoji), h('span', null, m.name)))),
      afterJoin && !members.length && h('p', { class: 'empty' }, 'In dieser Familie gibt es noch keine Mitglieder.')));
  });
}

// ---------------------------------------------------------------- Ansichten
function whoLine(task) {
  const who = assignedTo(task).map(member);
  if (!who.length) return h('div', { class: 'slip-who' }, h('span', { class: 'for-all' }, 'Für alle'), isAlways(task) ? 'wer es gerade erledigt' : 'wer zuerst abhakt');
  return h('div', { class: 'slip-who' }, h('span', { class: 'avatars' }, who.map((m) => h('span', { class: 'avatar', style: '--c:' + m.color }, m.emoji))),
    who.map((m) => m.name).join(who.length > 2 ? ', ' : ' oder '));
}

function slip(occ, state) {
  const task = occ.task, who = assignedTo(task);
  const count = occ.always ? doneToday(task) : 0;
  const el = h('article', { class: 'slip ' + state, style: '--c:' + (who.length === 1 ? member(who[0]).color : 'var(--ink)') },
    h('div', { class: 'slip-main' },
      whoLine(task),
      h('h3', null, task.title),
      task.description && h('p', { class: 'slip-desc' }, task.description),
      h('div', { class: 'slip-meta' },
        h('span', { class: 'due' }, occ.always ? (count ? `heute ${count}× erledigt` : 'jederzeit') : state === 'upcoming' ? 'ab ' + fmtDay(occ.date) : state === 'overdue' ? 'Frist war ' + fmtDay(occ.deadline) : 'bis ' + fmtDay(occ.deadline)),
        task.repeat.freq !== 'none' && h('span', { class: 'rep' }, icon('repeat'), repeatLabel(task)))),
    h('div', { class: 'slip-stub' },
      h('span', { class: 'reward' }, euro(task.reward)),
      state !== 'upcoming' && h('button', { class: 'check', type: 'button', 'aria-label': `„${task.title}“ als erledigt markieren`, onclick: () => completeOcc(occ, el) }, icon('check'))),
    h('span', { class: 'stamp', 'aria-hidden': 'true' }, 'Erledigt'));
  return el;
}

function doneSlip(c) {
  const m = member(c.memberId);
  return h('article', { class: 'slip done', style: '--c:' + (m ? m.color : '#888') },
    h('div', { class: 'slip-main' },
      h('div', { class: 'slip-who' }, h('span', { class: 'avatar' }, m ? m.emoji : '?'), m ? m.name : 'Ehemalig'),
      h('h3', null, c.title),
      h('div', { class: 'slip-meta' }, h('span', null, 'erledigt ' + fmtDay(dateStr(new Date(c.doneAt)))), c.late && h('span', { class: 'late' }, 'verspätet'))),
    h('div', { class: 'slip-stub' },
      h('span', { class: 'reward' }, '+' + euro(c.reward)),
      h('button', { class: 'check undo', type: 'button', 'aria-label': 'Zurücknehmen', onclick: () => undoCompletion(c) }, icon('undo'))));
}

const sectionHead = (title, count, cls = '') => h('h2', { class: 'section-head ' + cls }, h('span', null, title), count != null && h('span', { class: 'count' }, count));

function viewTasks() {
  const members = live(S.data.members);
  if (ui.filter === 'me' && !me()) ui.filter = 'all';
  if (ui.filter !== 'me' && ui.filter !== 'all' && !member(ui.filter)) ui.filter = 'all';
  const filterId = ui.filter === 'me' ? S.me : ui.filter === 'all' ? null : ui.filter;
  const match = (id) => !filterId || id === filterId;

  const { overdue, open, always, upcoming } = collectOccurrences();
  const mine = (o) => !filterId || o.eligible.includes(filterId);
  const since = Date.now() - DONE_DAYS * 864e5;
  const done = Object.values(S.data.completions).filter((c) => c.done && c.doneAt >= since && match(c.memberId)).sort((a, b) => b.doneAt - a.doneAt);
  const lists = { overdue: overdue.filter(mine), open: open.filter(mine), always: always.filter(mine), upcoming: upcoming.filter(mine) };
  const nothing = !lists.overdue.length && !lists.open.length;

  return [
    h('nav', { class: 'filters', 'aria-label': 'Personenfilter' },
      me() && h('button', { class: 'chip' + (ui.filter === 'me' ? ' on' : ''), type: 'button', onclick: () => { ui.filter = 'me'; render(); } }, 'Ich'),
      h('button', { class: 'chip' + (ui.filter === 'all' ? ' on' : ''), type: 'button', onclick: () => { ui.filter = 'all'; render(); } }, 'Alle'),
      members.filter((m) => m.id !== S.me).map((m) => memberChip(m, ui.filter === m.id, () => { ui.filter = m.id; render(); }))),
    lists.overdue.length > 0 && [sectionHead('Überfällig', lists.overdue.length, 'warn'), lists.overdue.map((o) => slip(o, 'overdue'))],
    sectionHead('Jetzt dran', lists.open.length || null),
    lists.open.map((o) => slip(o, 'open')),
    nothing && h('div', { class: 'empty big' }, h('span', { class: 'empty-mark' }, '✓'),
      live(S.data.tasks).length ? 'Alles erledigt. Füße hoch!' : 'Noch keine Aufgaben. Ein Elternteil legt sie unter „Verwalten“ an.'),
    lists.always.length > 0 && [sectionHead('Immer offen'), lists.always.map((o) => slip(o, 'always'))],
    lists.upcoming.length > 0 && [sectionHead('Demnächst'), lists.upcoming.map((o) => slip(o, 'upcoming'))],
    done.length > 0 && [sectionHead('Erledigt', done.length), done.map(doneSlip)],
  ];
}

function viewAccounts() {
  const members = live(S.data.members);
  const weekAgo = Date.now() - 7 * 864e5;
  return [
    sectionHead('Sparbücher'),
    members.map((m, i) => {
      const count = Object.values(S.data.completions).filter((c) => c.done && c.memberId === m.id && c.doneAt >= weekAgo).length;
      return h('button', { class: 'book', type: 'button', style: `--c:${m.color};--i:${i}`, onclick: () => ledgerSheet(m) },
        h('span', { class: 'avatar big' }, m.emoji),
        h('span', { class: 'book-name' }, h('strong', null, m.name), h('small', null, count === 1 ? '1 Aufgabe in 7 Tagen' : `${count} Aufgaben in 7 Tagen`)),
        h('span', { class: 'book-balance' }, euro(balanceOf(m.id))),
        icon('chevron', 'chev'));
    }),
    !members.length && h('p', { class: 'empty' }, 'Noch keine Familienmitglieder.'),
  ];
}

function viewManage() {
  if (!isAdmin()) {
    return [h('div', { class: 'locked' }, icon('lock', 'lock-big'),
      h('h2', null, 'Elternbereich'),
      h('p', null, 'Aufgaben, Belohnungen und Mitglieder verwaltet ein Elternteil mit der PIN.'),
      h('button', { class: 'btn primary', type: 'button', onclick: () => requireAdmin() }, 'Mit PIN entsperren'))];
  }
  const tasks = live(S.data.tasks).sort((a, b) => a.title.localeCompare(b.title, 'de'));
  const members = live(S.data.members);
  return [
    sectionHead('Aufgaben', tasks.length || null),
    h('button', { class: 'btn primary add', type: 'button', onclick: () => (members.length ? taskForm() : toast('Bitte zuerst ein Familienmitglied anlegen.')) }, icon('plus'), 'Neue Aufgabe'),
    h('ul', { class: 'manage-list' }, tasks.map((t) => {
      const who = assignedTo(t).map(member);
      const ended = isAlways(t) ? false : t.repeat.freq === 'none' ? S.data.completions[t.id + '|' + t.date]?.done : t.endDate && t.endDate < today();
      return h('li', null, h('button', { type: 'button', class: ended ? 'ended' : '', onclick: () => taskForm(t) },
        h('span', { class: 'manage-main' }, h('strong', null, t.title),
          h('small', null, (who.length ? who.map((m) => m.emoji + ' ' + m.name).join(', ') : 'für alle') + ' · ' + (t.repeat.freq === 'none' ? fmtDay(t.date) : repeatLabel(t)) + (ended ? ' · abgeschlossen' : ''))),
        h('span', { class: 'reward' }, euro(t.reward)), icon('edit', 'chev')));
    })),
    sectionHead('Familie', members.length || null),
    h('button', { class: 'btn add', type: 'button', onclick: () => memberForm() }, icon('plus'), 'Neues Mitglied'),
    h('ul', { class: 'manage-list' }, members.map((m) => h('li', null, h('button', { type: 'button', onclick: () => memberForm(m) },
      h('span', { class: 'avatar', style: '--c:' + m.color }, m.emoji),
      h('span', { class: 'manage-main' }, h('strong', null, m.name), h('small', null, m.role === 'parent' ? 'Elternteil' : 'Kind')),
      icon('edit', 'chev'))))),
  ];
}

function viewMore() {
  const mine = me();
  const standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  return [
    sectionHead('Dieses iPhone'),
    h('div', { class: 'card' },
      h('div', { class: 'card-row' }, h('span', { class: 'avatar', style: '--c:' + (mine ? mine.color : '#999') }, mine ? mine.emoji : '?'),
        h('span', { class: 'grow' }, h('strong', null, mine ? mine.name : 'Noch niemand gewählt'), h('small', null, 'benutzt dieses Gerät')),
        h('button', { class: 'btn small', type: 'button', onclick: async () => { if (!mine || (await requireAdmin('Den Besitzer wechselt ein Elternteil.'))) identitySheet(); } }, mine ? 'Wechseln' : 'Wählen'))),
    sectionHead('Abgleich'),
    h('div', { class: 'card' },
      h('div', { class: 'card-row' }, h('span', { class: 'grow' }, h('strong', null, 'Familie ' + S.family.name), h('small', null, syncLabel())),
        h('button', { class: 'btn small', type: 'button', onclick: () => sync() }, 'Jetzt abgleichen')),
      h('p', { class: 'hint' }, 'Alle Daten liegen auf diesem Gerät und funktionieren ohne Netz. Sobald eine Verbindung besteht, werden Änderungen verschlüsselt mit den anderen Familien-iPhones abgeglichen.')),
    !standalone && [sectionHead('Installieren'),
      h('div', { class: 'card' }, h('p', { class: 'hint' }, 'In Safari auf „Teilen“ tippen und „Zum Home-Bildschirm“ wählen. Danach startet die App wie jede andere – auch ohne Internet.'))],
    sectionHead('Elternbereich'),
    h('div', { class: 'card stack' },
      h('button', { class: 'btn', type: 'button', onclick: async () => { if (await requireAdmin()) pinForm(); } }, 'Eltern-PIN ändern'),
      h('button', { class: 'btn', type: 'button', onclick: async () => { if (await requireAdmin()) exportBackup(); } }, 'Sicherung exportieren'),
      h('label', { class: 'btn', role: 'button' }, 'Sicherung einspielen',
        h('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: (e) => importBackup(e.target) })),
      h('button', { class: 'btn danger', type: 'button', onclick: async () => {
        if (!(await requireAdmin())) return;
        if (!confirm('Alle Daten von DIESEM Gerät löschen? Die Daten der Familie bleiben auf den anderen Geräten und in der Ablage erhalten.')) return;
        await store.clear();
        location.reload();
      } }, 'Dieses Gerät zurücksetzen')),
    h('p', { class: 'colophon' }, 'Familienaufgaben · Daten Ende-zu-Ende verschlüsselt'),
  ];
}

async function exportBackup() {
  const name = `familienaufgaben-${today()}.json`;
  const blob = new Blob([JSON.stringify({ app: 'familienaufgaben', exported: new Date().toISOString(), data: S.data }, null, 1)], { type: 'application/json' });
  const file = new File([blob], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Familienaufgaben-Sicherung' }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

async function importBackup(input) {
  const file = input.files[0];
  input.value = '';
  if (!file || !(await requireAdmin())) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (parsed.app !== 'familienaufgaben' || !parsed.data || !parsed.data.members) throw new Error('Format');
    S.data = mergeData(S.data, parsed.data).data;
    save();
    toast('Sicherung eingespielt und mit den vorhandenen Daten zusammengeführt.');
  } catch {
    toast('Diese Datei ist keine gültige Sicherung.');
  }
}

// ---------------------------------------------------------------- Einrichtung
function viewOnboarding(root) {
  let mode = 'start';
  const v = { family: '', password: '', password2: '', pin: '', name: '' };
  let busy = false;
  const input = (key, attrs) => h('input', { value: v[key], autocapitalize: 'off', autocomplete: 'off', oninput: (e) => { v[key] = e.target.value; }, ...attrs });

  const draw = () => {
    const intro = h('header', { class: 'ob-head' },
      h('span', { class: 'ob-stamp' }, '✓'),
      h('h1', null, 'Familien', h('br'), 'aufgaben'),
      h('p', null, 'Wer macht was bis wann – und was gibt es dafür?'));
    let content;
    if (mode === 'start') {
      content = h('div', { class: 'form' },
        h('button', { class: 'btn primary', type: 'button', onclick: () => { mode = 'create'; draw(); } }, 'Neue Familie gründen'),
        h('button', { class: 'btn', type: 'button', onclick: () => { mode = 'join'; draw(); } }, 'Bestehender Familie beitreten'),
        h('p', { class: 'hint center' }, 'Das erste iPhone gründet die Familie, alle weiteren treten mit Familienname und Passwort bei.'));
    } else {
      const create = mode === 'create';
      content = h('form', { class: 'form', onsubmit: (e) => { e.preventDefault(); if (!busy) (create ? doCreate : doJoin)(); } },
        field('Familienname', input('family', { type: 'text', placeholder: 'z. B. Sonnenschein', maxLength: 40 }), create ? 'Zusammen mit dem Passwort ist das euer Schlüssel zur Familie.' : null),
        field('Familien-Passwort', input('password', { type: 'password', placeholder: 'mindestens 8 Zeichen' }), create ? 'Verschlüsselt eure Daten. Gut merken – es lässt sich nicht wiederherstellen.' : null),
        create && field('Passwort wiederholen', input('password2', { type: 'password' })),
        create && field('Eltern-PIN', input('pin', { type: 'password', inputmode: 'numeric', maxLength: 8, placeholder: '4–8 Ziffern' }), 'Schützt das Anlegen von Aufgaben und alle Buchungen.'),
        create && field('Dein Name', input('name', { type: 'text', maxLength: 30, autocapitalize: 'words' }), 'Du wirst als Elternteil angelegt; alle anderen fügst du danach hinzu.'),
        h('button', { class: 'btn primary', type: 'submit', disabled: busy }, busy ? 'Einen Moment …' : create ? 'Familie gründen' : 'Beitreten'),
        h('button', { class: 'btn ghost', type: 'button', onclick: () => { mode = 'start'; draw(); } }, 'Zurück'));
    }
    root.replaceChildren(h('main', { class: 'onboarding' }, intro, content));
  };

  const start = async (fn) => {
    busy = true; draw();
    try { await fn(); } catch (e) { console.warn(e); toast(e.userMessage || 'Das hat nicht geklappt. Besteht eine Internetverbindung?'); }
    busy = false;
    if (!S || !S.family) draw();
  };
  const fail = (msg) => Object.assign(new Error(msg), { userMessage: msg });
  const baseState = (family) => ({ v: 1, deviceId: uid(), me: null, family, serverVersion: 0, dirty: false, data: emptyData() });

  const doCreate = () => start(async () => {
    if (!v.family.trim()) throw fail('Bitte einen Familiennamen eingeben.');
    if (v.password.length < 8) throw fail('Das Passwort braucht mindestens 8 Zeichen.');
    if (v.password !== v.password2) throw fail('Die Passwörter stimmen nicht überein.');
    if (!/^\d{4,8}$/.test(v.pin)) throw fail('Die PIN braucht 4 bis 8 Ziffern.');
    if (!v.name.trim()) throw fail('Bitte deinen Namen eingeben.');
    const family = await deriveFamily(v.family, v.password);
    let remote = null;
    try { remote = (await api({ action: 'pull', family: family.id, known: -1 })).json; } catch { /* offline gruenden ist erlaubt */ }
    if (remote && remote.version > 0) throw fail('Diese Familie gibt es schon – bitte „Beitreten“ wählen.');
    S = baseState(family);
    const m = touch({ id: uid(), name: v.name.trim(), role: 'parent', color: COLORS[0], emoji: EMOJIS[0] });
    S.data.members[m.id] = m;
    S.data.settings = touch({ ...(await hashPin(v.pin)) });
    S.me = m.id;
    S.dirty = true;
    await persist();
    ui.adminUntil = Date.now() + ADMIN_MINUTES * 60000;
    ui.tab = 'manage';
    boot();
  });

  const doJoin = () => start(async () => {
    if (!v.family.trim() || !v.password) throw fail('Bitte Familienname und Passwort eingeben.');
    const family = await deriveFamily(v.family, v.password);
    const remote = (await api({ action: 'pull', family: family.id, known: -1 })).json;
    if (!remote.data) throw fail('Keine Familie gefunden. Stimmen Name und Passwort?');
    S = baseState(family);
    S.data = await decryptData(remote.data);
    S.serverVersion = remote.version;
    await persist();
    boot();
    identitySheet(true);
  });

  draw();
}

// ---------------------------------------------------------------- Rahmen
const TABS = [['tasks', 'Aufgaben', 'tasks'], ['accounts', 'Konten', 'book'], ['manage', 'Verwalten', 'manage'], ['more', 'Mehr', 'more']];
const VIEWS = { tasks: viewTasks, accounts: viewAccounts, manage: viewManage, more: viewMore };
let renderedTab = null;

function render() {
  const root = $('#app');
  if (!S || !S.family) return;
  const admin = isAdmin();
  const myOpen = (() => { const o = collectOccurrences(); return [...o.overdue, ...o.open].filter((x) => x.eligible.includes(S.me)).length; })();
  let main = $('#view');
  if (!main) {
    root.replaceChildren(h('header', { class: 'topbar', id: 'topbar' }), h('main', { id: 'view' }), h('nav', { class: 'tabbar', id: 'tabbar', 'aria-label': 'Hauptnavigation' }));
    main = $('#view');
  }
  $('#topbar').replaceChildren(
    h('div', { class: 'topbar-title' }, h('small', null, fmtLong(new Date())), h('h1', null, 'Familie ' + S.family.name)),
    h('button', { class: 'sync-dot', id: 'sync-dot', type: 'button', 'data-state': ui.sync, title: syncLabel(), 'aria-label': 'Abgleich', onclick: () => { sync(); toast(navigator.onLine ? 'Abgleich gestartet …' : 'Gerade offline – Änderungen bleiben gespeichert.'); } }),
    h('button', { class: 'icon-btn lock-btn' + (admin ? ' open' : ''), type: 'button', 'aria-label': admin ? 'Elternmodus sperren' : 'Elternmodus entsperren', onclick: () => (admin ? setAdmin(false) : requireAdmin()) }, icon(admin ? 'unlock' : 'lock')));
  main.className = 'view view-' + ui.tab + (renderedTab !== ui.tab ? ' enter' : '');
  renderedTab = ui.tab;
  main.replaceChildren(...[VIEWS[ui.tab]()].flat(Infinity).filter(Boolean));
  $('#tabbar').replaceChildren(...TABS.map(([id, label, ic]) => h('button', { type: 'button', class: id === ui.tab ? 'on' : '', 'aria-current': id === ui.tab ? 'page' : null, onclick: () => { ui.tab = id; render(); scrollTo(0, 0); } },
    icon(ic), h('span', null, label), id === 'tasks' && myOpen > 0 && h('em', { class: 'badge' }, myOpen))));
}

function boot() {
  $('#app').replaceChildren();
  render();
  sync();
}

async function init() {
  if (!window.isSecureContext || !crypto.subtle) {
    $('#app').append(h('main', { class: 'onboarding' }, h('p', { class: 'empty' }, 'Diese App braucht eine sichere Verbindung (https), damit die Verschlüsselung funktioniert.')));
    return;
  }
  await store.open();
  S = (await store.get('state')) || null;
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if (S && S.family) boot(); else viewOnboarding($('#app'));

  document.addEventListener('visibilitychange', () => { if (!document.hidden && S && S.family) { render(); sync(); } });
  addEventListener('online', () => sync());
  addEventListener('offline', () => setSync('offline'));
  setInterval(() => { if (!document.hidden) sync(); }, SYNC_INTERVAL_MS);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service Worker', e));
}

init();
})();
