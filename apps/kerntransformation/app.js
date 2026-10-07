/* Kerntransformation – Oberfläche, Spracheingabe, Vorlesen, Speicherung, KI-Begleiter.
   Prozesslogik liegt in process.js (window.KT). */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const KEY = { session: 'kt.session', undo: 'kt.undo', archive: 'kt.archive', settings: 'kt.settings' };
  const API = 'api/coach.php';

  /* ---------- Speicher ---------- */

  function load(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
  }
  function store(key, value) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { toast('Speichern nicht möglich (privater Modus?)'); }
  }

  const settings = Object.assign({ autoSpeak: false, rate: 0.9, voice: '', ai: false, code: '' }, load(KEY.settings, {}));
  let S = load(KEY.session, null);      // laufende Sitzung
  let undo = load(KEY.undo, []);
  let chip = '';                         // gewählte Art im Schritt „Teil auswählen“
  let pendingInfo = [];                  // Randnotizen für den nächsten Schritt

  const save = () => { store(KEY.session, S); store(KEY.undo, undo); };

  /* ---------- kleine Helfer ---------- */

  function el(tag, attrs, text) {
    const e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach((k) => {
      if (k === 'class') e.className = attrs[k];
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), attrs[k]);
      else e.setAttribute(k, attrs[k]);
    });
    if (text != null) e.textContent = text;
    return e;
  }

  let toastTimer = 0;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2800);
  }

  function show(id, on) { $(id).hidden = !on; }

  /* ---------- Vorlesen ---------- */

  const synth = window.speechSynthesis;
  let voices = [];

  function loadVoices() {
    if (!synth) return;
    voices = synth.getVoices().filter((v) => /^de(-|_|$)/i.test(v.lang));
    const sel = $('set-voice');
    sel.innerHTML = '';
    sel.appendChild(el('option', { value: '' }, 'Standard'));
    voices.forEach((v) => {
      const o = el('option', { value: v.name }, v.name + (v.localService ? '' : ' (online)'));
      if (v.name === settings.voice) o.selected = true;
      sel.appendChild(o);
    });
  }

  function speak(text) {
    if (!synth || !text) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'de-DE';
    u.rate = Number(settings.rate) || 0.9;
    const v = voices.find((x) => x.name === settings.voice);
    if (v) u.voice = v;
    synth.speak(u);
  }
  const hush = () => { if (synth) synth.cancel(); };

  function speakView() {
    const v = KT.view(S);
    speak(v.say.concat(v.ask ? [v.ask] : []).join(' ').replace(/[„“»«]/g, ''));
  }

  /* ---------- Spracheingabe ---------- */

  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null;           // aktive Erkennung

  function micSupported() { return !!Rec; }

  function stopMic() {
    if (rec) { try { rec.stop(); } catch (e) { /* schon beendet */ } }
  }

  function toggleMic(target, button, statusEl) {
    if (rec) { stopMic(); return; }
    if (!Rec) {
      target.focus();
      if (statusEl) statusEl.textContent = 'Spracheingabe hier nicht verfügbar – nutze die Diktiertaste (Mikrofon) der Tastatur.';
      return;
    }
    hush();
    const r = new Rec();
    r.lang = 'de-DE';
    r.interimResults = true;
    r.continuous = true;
    const base = target.value ? target.value.replace(/\s*$/, ' ') : '';
    let finalText = '';
    r.onresult = (ev) => {
      let interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results[i];
        if (res.isFinal) finalText += res[0].transcript;
        else interim += res[0].transcript;
      }
      target.value = (base + finalText + interim).replace(/\s+/g, ' ').trimStart();
    };
    r.onerror = (ev) => {
      if (!statusEl) return;
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
        statusEl.textContent = 'Spracherkennung nicht erlaubt. Erlaube Mikrofon und Spracherkennung in den Einstellungen – oder nutze die Diktiertaste der Tastatur.';
      } else if (ev.error === 'no-speech') {
        statusEl.textContent = 'Nichts gehört – tippe erneut auf das Mikrofon.';
      } else if (ev.error !== 'aborted') {
        statusEl.textContent = 'Spracherkennung unterbrochen (' + ev.error + ').';
      }
    };
    r.onend = () => {
      rec = null;
      button.classList.remove('on');
      if (statusEl && statusEl.textContent === 'Ich höre zu …') statusEl.textContent = '';
    };
    try {
      r.start();
      rec = r;
      button.classList.add('on');
      if (statusEl) statusEl.textContent = 'Ich höre zu …';
    } catch (e) {
      if (statusEl) statusEl.textContent = 'Spracherkennung konnte nicht starten – nutze die Diktiertaste der Tastatur.';
    }
  }

  /* ---------- Bildschirm wach halten ---------- */

  let wakeLock = null;
  async function keepAwake(on) {
    try {
      if (on && 'wakeLock' in navigator && !wakeLock && document.visibilityState === 'visible') {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      } else if (!on && wakeLock) {
        await wakeLock.release(); wakeLock = null;
      }
    } catch (e) { wakeLock = null; }
  }
  document.addEventListener('visibilitychange', () => { if (S && !$('session').hidden) keepAwake(true); });

  /* ---------- Startseite ---------- */

  function renderHome() {
    stopMic(); hush(); keepAwake(false);
    show('home', true); show('session', false);
    $('btn-home').href = '/werkzeuge/';
    $('btn-home').onclick = null;
    $('bar-title').textContent = 'Kerntransformation';

    const resume = $('btn-resume');
    if (S) {
      const v = KT.view(S);
      const teil = KT.root(S).teil;
      resume.textContent = 'Fortsetzen' + (teil ? ': „' + teil + '“' : '') + ' · ' + v.title;
      resume.hidden = false;
      $('btn-new').className = 'secondary';
    } else {
      resume.hidden = true;
      $('btn-new').className = 'primary';
    }

    const arch = load(KEY.archive, []);
    const list = $('archive');
    list.innerHTML = '';
    arch.slice().reverse().forEach((a) => {
      const b = el('button', { type: 'button', onclick: () => openArchived(a.id) });
      b.appendChild(el('span', null, a.teil || '(ohne Titel)'));
      const meta = el('span', { class: 'meta' }, new Date(a.started).toLocaleDateString('de-DE') + ' · ');
      meta.appendChild(el('span', { class: 'kern' }, a.kern || '–'));
      b.appendChild(meta);
      const li = el('li'); li.appendChild(b); list.appendChild(li);
    });
    show('archive-wrap', arch.length > 0);
  }

  let viewing = null;
  function openArchived(id) {
    const a = load(KEY.archive, []).find((x) => x.id === id);
    if (!a) return;
    viewing = a;
    $('view-text').textContent = a.summary;
    show('ov-view', true);
  }

  /* ---------- Sitzung ---------- */

  function startNew() {
    if (S && !confirm('Die laufende Sitzung verwerfen und neu beginnen?')) return;
    S = KT.newSession();
    undo = [];
    save();
    renderSession();
  }

  function renderSession(opts) {
    show('home', false); show('session', true);
    keepAwake(true);
    $('btn-home').removeAttribute('href');
    $('btn-home').onclick = (e) => { e.preventDefault(); renderHome(); };

    const v = KT.view(S);
    $('bar-title').textContent = v.title;
    $('progress').firstElementChild.style.width = Math.round((v.phase / v.phases) * 100) + '%';
    $('phase-label').textContent = v.phase ? 'Schritt ' + v.phase + ' von ' + v.phases : 'Vorbereitung';

    const badge = $('depth-badge');
    badge.hidden = v.depth === 0;
    badge.textContent = v.depth === 1 ? 'Einwand-Teil' : 'Einwand-Teil · Ebene ' + v.depth;

    $('step-title').textContent = v.title;
    const say = $('say');
    say.innerHTML = '';
    v.say.forEach((p) => say.appendChild(el('p', null, p)));
    $('ask').textContent = v.ask || '';

    renderLadder(v);

    // Eingabe
    const isText = v.input === 'text' || v.input === 'text-optional';
    show('text-wrap', isText);
    show('btn-mic', isText);
    $('mic-status').textContent = '';
    if (!(opts && opts.keepAnswer)) $('answer').value = '';
    $('answer').placeholder = v.input === 'text-optional' ? 'Optional – sprechen oder tippen …' : 'Sprechen oder tippen …';

    const chips = $('chips');
    chips.innerHTML = '';
    chip = '';
    if (v.chips) {
      v.chips.forEach((c) => chips.appendChild(el('button', {
        type: 'button', 'aria-pressed': 'false',
        onclick: (e) => {
          chip = chip === c ? '' : c;
          [...chips.children].forEach((b) => b.setAttribute('aria-pressed', String(b.textContent === chip)));
        }
      }, c)));
    }
    show('chips', !!v.chips);

    const next = $('btn-next');
    next.textContent = v.ok;
    show('main-row', v.input !== 'choice' && v.input !== 'none');

    const choices = $('choices');
    choices.innerHTML = '';
    (v.choices || []).forEach((c) => choices.appendChild(el('button', {
      type: 'button', class: c.primary ? 'primary' : 'secondary', onclick: () => doAction(c.id)
    }, c.label)));
    show('choices', !!(v.choices && v.choices.length));

    const extras = $('extras');
    extras.innerHTML = '';
    v.extra.forEach((c) => extras.appendChild(el('button', {
      type: 'button', class: 'secondary', onclick: () => doAction(c.id)
    }, c.label)));
    show('extras', v.extra.length > 0);

    // Abschluss
    const done = v.step === 'done';
    show('summary-area', done);
    if (done) $('summary').textContent = KT.summary(S);

    show('btn-coach', !!(settings.ai && settings.code));
    $('btn-undo').disabled = undo.length === 0;

    // Hinweise
    const hints = $('hints');
    hints.innerHTML = '';
    pendingInfo.forEach((h) => hints.appendChild(hintBox(h)));
    pendingInfo = [];

    if (!(opts && opts.noScroll)) window.scrollTo(0, 0);
    if (settings.autoSpeak && !(opts && opts.quiet)) speakView();
  }

  function renderLadder(v) {
    const ol = $('ladder');
    ol.innerHTML = '';
    if (!v.ladder || v.ladder.length < 2 && v.step !== 'chain') { ol.hidden = true; return; }
    v.ladder.forEach((item, i) => {
      const li = el('li', { class: item.type + (item.active ? ' active' : '') });
      // In der Ergebniskette lässt sich jedes Glied nachträglich als Kernzustand wählen.
      if (v.step === 'chain' && item.type === 'ergebnis') {
        li.appendChild(el('button', { type: 'button', onclick: () => {
          if (confirm('„' + item.label + '“ als Kernzustand wählen? Die Glieder danach werden verworfen.')) doAction('pickCore', i - 1);
        } }, item.label));
      } else {
        li.appendChild(document.createTextNode(item.label));
      }
      if (item.rueck) li.appendChild(el('span', { class: 'rueck' }, '↳ ' + item.rueck));
      ol.appendChild(li);
    });
    ol.hidden = false;
  }

  function hintBox(h, answer) {
    const box = el('div', { class: 'hint ' + h.severity + (h.source === 'ki' ? ' ki' : '') });
    box.appendChild(el('p', null, h.text));
    if (h.severity === 'block' || h.severity === 'ground') {
      const row = el('div', { class: 'row' });
      row.appendChild(el('button', { type: 'button', class: 'secondary', onclick: () => {
        box.remove(); $('answer').focus();
      } }, 'Neu fragen'));
      row.appendChild(el('button', { type: 'button', class: 'secondary', onclick: () => {
        doCommit(h.accept != null ? h.accept : answer, h.opts);
      } }, 'So übernehmen'));
      box.appendChild(row);
    }
    return box;
  }

  function showHints(list, answer) {
    const hints = $('hints');
    hints.innerHTML = '';
    list.forEach((h) => hints.appendChild(hintBox(h, answer)));
    hints.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (settings.autoSpeak) speak(list.map((h) => h.text).join(' '));
  }

  function pushUndo() {
    undo.push(JSON.stringify(S));
    if (undo.length > 60) undo.shift();
  }

  function doCommit(answer, opts) {
    stopMic();
    pushUndo();
    KT.commit(S, answer, chip, opts);
    save();
    renderSession();
  }

  function doAction(id, arg) {
    stopMic();
    if (id === 'objYes' && !KT.canNest(S)) {
      showHints([{ severity: 'info', text: 'Die Einwände sind schon drei Ebenen tief. Würdige diesen Einwand, lass den Teil wissen, dass er gehört wurde, und nimm dir für ihn eine eigene Sitzung.' }]);
      return;
    }
    if (id === 'hesitate') {
      showHints([{ severity: 'info', text: 'Frag den Teil, was er braucht, um sich ganz einlassen zu können – und respektiere sein Tempo. Es genügt auch, wenn er nur ein Stück weit hineinfließt.' }]);
      return;
    }
    pushUndo();
    KT.action(S, id, arg);
    save();
    renderSession();
  }

  async function submit() {
    const v = KT.view(S);
    const isText = v.input === 'text' || v.input === 'text-optional';
    stopMic();
    const answer = isText ? $('answer').value.trim() : '';

    if (v.input === 'text' && !answer) {
      showHints([{ severity: 'info', text: 'Nimm dir Zeit. Sprich oder tippe, was auftaucht – auch ein einzelnes Wort genügt.' }]);
      return;
    }

    const local = isText ? KT.analyze(S, answer) : [];
    const crisis = local.find((h) => h.severity === 'crisis');
    if (crisis) { showCrisis(crisis.text, answer); return; }

    // Mit KI-Begleiter: Claude ordnet die Antwort ein; bei Fehlern greift das lokale Modell.
    if (isText && answer && settings.ai && settings.code && navigator.onLine !== false) {
      const r = await coach('antwort', v, answer, local.map((h) => h.code));
      if (r) { handleCoach(r, v, answer); return; }
      toast('Begleiter nicht erreichbar – lokale Prüfung');
    }

    const blocking = local.filter((h) => h.severity === 'block' || h.severity === 'ground');
    if (blocking.length) { showHints(blocking, answer); return; }
    pendingInfo = local.filter((h) => h.severity === 'info');
    doCommit(answer);
  }

  function handleCoach(r, v, answer) {
    const clean = (r.antwort || '').trim() || answer;
    const msg = (r.nachricht || '').trim();
    switch (r.verdict) {
      case 'krise': showCrisis(msg || 'Was du schreibst, klingt nach großer Not.', answer); break;
      case 'erden': showHints([{ severity: 'ground', source: 'ki', text: msg, accept: clean }], answer); break;
      case 'nachfragen': showHints([{ severity: 'block', source: 'ki', text: msg, accept: clean }], answer); break;
      case 'kern_pruefen':
        doCommit(clean, v.step === 'chain' ? { core: true } : undefined);
        break;
      default:
        if (msg) pendingInfo = [{ severity: 'info', source: 'ki', text: msg }];
        doCommit(clean, v.step === 'chain' ? { core: false } : undefined);
    }
  }

  async function coach(mode, v, answer, local) {
    const f = v.frame;
    const body = {
      code: settings.code, mode, step: v.step, title: v.title,
      ask: [].concat(v.say, v.ask ? [v.ask] : []).join(' '),
      answer, local: local || [],
      frame: { kind: f.kind, teil: f.teil, art: f.art, kontext: f.kontext, koerper: f.koerper, ergebnisse: f.ergebnisse, kern: f.kern }
    };
    document.body.classList.add('busy');
    $('btn-next').disabled = true;
    const prev = $('btn-next').textContent;
    $('btn-next').textContent = 'Begleiter denkt nach …';
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 45000);
      const res = await fetch(API, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: ctrl.signal
      });
      clearTimeout(timer);
      if (res.status === 401) { toast('Zugangscode falsch – KI-Begleiter pausiert'); return null; }
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      return null;
    } finally {
      document.body.classList.remove('busy');
      $('btn-next').disabled = false;
      $('btn-next').textContent = prev;
    }
  }

  /* ---------- Überlagerungen ---------- */

  let crisisAnswer = '';
  function showCrisis(text, answer) {
    hush(); stopMic();
    crisisAnswer = answer;
    $('crisis-text').textContent = text;
    show('ov-crisis', true);
  }

  function showGround(text) {
    hush(); stopMic();
    $('ground-text').textContent = text || 'Du kannst jederzeit innehalten. Deine Sitzung ist gespeichert.';
    show('ov-ground', true);
  }

  /* ---------- Abschluss ---------- */

  async function shareText(text) {
    if (navigator.share) {
      try { await navigator.share({ title: 'Kerntransformation', text }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(text); toast('In die Zwischenablage kopiert'); }
    catch (e) { toast('Kopieren nicht möglich'); }
  }

  function download(text) {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const a = el('a', { href: URL.createObjectURL(blob), download: 'kerntransformation-' + S.started.slice(0, 10) + '.txt' });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function finish() {
    const arch = load(KEY.archive, []);
    const r = KT.root(S);
    arch.push({ id: S.id, started: S.started, teil: r.teil, kern: r.kern, summary: KT.summary(S) });
    store(KEY.archive, arch.slice(-50));
    S = null; undo = [];
    store(KEY.session, null); store(KEY.undo, null);
    renderHome();
    toast('Sitzung gespeichert');
  }

  /* ---------- Einstellungen ---------- */

  function openSettings() {
    loadVoices();
    $('set-autospeak').checked = !!settings.autoSpeak;
    $('set-rate').value = settings.rate;
    $('set-ai').checked = !!settings.ai;
    $('set-code').value = settings.code || '';
    $('set-status').textContent = '';
    show('ov-settings', true);
  }

  function closeSettings() {
    settings.autoSpeak = $('set-autospeak').checked;
    settings.rate = Number($('set-rate').value);
    settings.voice = $('set-voice').value;
    settings.ai = $('set-ai').checked;
    settings.code = $('set-code').value.trim();
    store(KEY.settings, settings);
    show('ov-settings', false);
    if (S && !$('session').hidden) show('btn-coach', !!(settings.ai && settings.code));
  }

  async function testConnection() {
    const st = $('set-status');
    st.textContent = 'Prüfe …';
    try {
      const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: $('set-code').value.trim(), mode: 'ping' }) });
      st.textContent = res.ok ? 'Verbunden. Der Begleiter ist bereit.'
        : res.status === 401 ? 'Zugangscode falsch.'
        : res.status === 503 ? 'Auf dem Server ist der Begleiter nicht eingerichtet.'
        : 'Fehler ' + res.status + '.';
    } catch (e) {
      st.textContent = 'Keine Verbindung (offline?).';
    }
  }

  /* ---------- Ereignisse ---------- */

  $('btn-new').addEventListener('click', startNew);
  $('btn-resume').addEventListener('click', () => renderSession());
  $('btn-next').addEventListener('click', submit);
  $('btn-mic').addEventListener('click', () => toggleMic($('answer'), $('btn-mic'), $('mic-status')));
  $('btn-speak').addEventListener('click', speakView);
  $('btn-undo').addEventListener('click', () => {
    if (!undo.length) return;
    stopMic(); hush();
    S = JSON.parse(undo.pop());
    save();
    renderSession({ quiet: true });
  });
  $('btn-pause').addEventListener('click', () => showGround());
  $('btn-coach').addEventListener('click', () => {
    hush();
    $('coach-q').value = ''; $('coach-answer').hidden = true;
    show('ov-coach', true);
  });

  $('coach-mic').addEventListener('click', () => toggleMic($('coach-q'), $('coach-mic'), null));
  $('coach-send').addEventListener('click', async () => {
    stopMic();
    const qtext = $('coach-q').value.trim();
    if (!qtext) return;
    const ans = $('coach-answer');
    ans.hidden = false; ans.textContent = 'Der Begleiter denkt nach …';
    const r = await coach('frage', KT.view(S), qtext, []);
    if (!r) { ans.textContent = 'Der Begleiter ist gerade nicht erreichbar.'; return; }
    if (r.verdict === 'krise') { show('ov-coach', false); showCrisis(r.nachricht, ''); return; }
    ans.textContent = r.nachricht;
    if (settings.autoSpeak) speak(r.nachricht);
  });
  $('coach-close').addEventListener('click', () => { stopMic(); hush(); show('ov-coach', false); });

  $('crisis-continue').addEventListener('click', () => {
    show('ov-crisis', false);
    if (crisisAnswer) doCommit(crisisAnswer);
  });
  $('crisis-stop').addEventListener('click', () => { show('ov-crisis', false); renderHome(); });

  $('ground-resume').addEventListener('click', () => show('ov-ground', false));
  $('ground-close').addEventListener('click', () => { show('ov-ground', false); renderHome(); });

  $('btn-share').addEventListener('click', () => shareText(KT.summary(S)));
  $('btn-download').addEventListener('click', () => download(KT.summary(S)));
  $('btn-finish').addEventListener('click', finish);

  $('btn-settings').addEventListener('click', openSettings);
  $('settings-close').addEventListener('click', closeSettings);
  $('set-test').addEventListener('click', testConnection);
  $('set-voice').addEventListener('change', () => { settings.voice = $('set-voice').value; speak('So klinge ich.'); });

  $('view-share').addEventListener('click', () => viewing && shareText(viewing.summary));
  $('view-delete').addEventListener('click', () => {
    if (!viewing || !confirm('Diese Sitzung endgültig löschen?')) return;
    store(KEY.archive, load(KEY.archive, []).filter((a) => a.id !== viewing.id));
    viewing = null; show('ov-view', false); renderHome();
  });
  $('view-close').addEventListener('click', () => { viewing = null; show('ov-view', false); });

  // Strg/Cmd+Enter schickt die Antwort ab (Desktop)
  $('answer').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(); });

  if (synth) { loadVoices(); synth.onvoiceschanged = loadVoices; }
  if (!micSupported()) $('btn-mic').title = 'Spracheingabe über die Diktiertaste der Tastatur';

  renderHome();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
