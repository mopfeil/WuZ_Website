'use strict';

/* Duplex-Marker-Karten (7,5 x 7,5 cm), 6 pro A4-Seite:
     Vorderseite: nur der ArUco-Marker (78 % der Karte, Rand = Ruhezone)
     Rueckseite : Antwortziffern 1-7 im Kranz (Luecke bei der toten
                  Richtung) + waehlbarer Studientext in Gruppenversionen
                  (siehe STUDIES) + Marker-Nr. klein in der Ecke

   Seitenfolge fuer den Drucker: Vorne 1, Hinten 1, Vorne 2, Hinten 2 ...
   Einstellung: "Beidseitig drucken - an langer Kante spiegeln".
   Auf den Rueckseiten sind die beiden Spalten vertauscht, damit nach dem
   Umschlagen jede Rueckseite exakt hinter ihrer Vorderseite liegt.

   Zur Geometrie des Ziffernkranzes: Die Ziffer fuer Kartendrehung D
   (orientation_map) steht in der Rueckseiten-Ansicht bei D Grad im
   Uhrzeigersinn ab oben und ist um +D Grad mitgedreht. Dreht man die
   Karte so, dass diese Ziffer oben steht und gerade lesbar ist, liefert
   der (spiegelbildlich mitgedrehte) Marker auf der Vorderseite genau die
   Erkennung D -> Antwortcode orientation_map[D]. */

let CFG = null;

// Kartentexte (Rueckseite). Gruppe = Marker-Nr. % n (Rest 0 -> Gruppe n).
//   schlaf: Gender-Bias-Studie Schule, 4 Gruppen (Autor wechselt)
//   berger: Orange Days, 2 Gruppen (Thomas / Tanja Berger, Text sonst gleich)
//   ohne  : kein Text, nur Ziffernkranz
const SCHLAF_AUTHORS = {
  1: 'Alexander Bremer, Klasse 10',
  2: 'Mandy Bremer, Klasse 10',
  3: 'Dr. Alexander Bremer, Hochschule Weingarten',
  4: 'Dr. Mandy Bremer, Hochschule Weingarten'
};

const SCHLAF_TEXT =
  'Schlafen und Lernen – hängt das zusammen?\n' +
  'Wer zu wenig schläft, kann sich schlechter konzentrieren. Das haben ' +
  'wir in einer Beobachtung untersucht. Dafür haben wir 12 Schülerinnen ' +
  'und Schüler befragt, die in der Nacht vorher weniger als 5 Stunden ' +
  'geschlafen hatten. Die meisten sagten, dass sie sich in der Schule ' +
  'schlecht konzentrieren konnten.\n' +
  'Stress könnte dabei auch eine Rolle spielen – das haben wir aber ' +
  'nicht untersucht. In Zukunft sollte man mehr Personen befragen. Unser ' +
  'Ergebnis zeigt: Genug Schlaf ist wichtig für die Schule.';

// Heilman et al. (2004): erfolgreiche, durchsetzungsstarke Fuehrungskraft;
// beide Versionen wortgleich bis auf Vorname und Pronomen.
function bergerText(w) {
  const P = w ? { n: 'Tanja', er: 'Sie', er2: 'sie', sein: 'ihres' }
              : { n: 'Thomas', er: 'Er', er2: 'er', sein: 'seines' };
  return P.n + ' Berger, 44, leitet seit drei Jahren den Vertrieb eines ' +
    'Technikunternehmens mit 120 Beschäftigten. ' + P.er + ' gilt als ' +
    'ehrgeizig und durchsetzungsstark. In Besprechungen ergreift ' + P.er2 +
    ' früh das Wort und lässt sich selten unterbrechen. Mit Kunden ' +
    'verhandelt ' + P.er2 + ' hart. Gegen Widerstände im eigenen Haus hat ' +
    P.er2 + ' eine neue Vertriebsstrategie durchgesetzt. Seitdem ist der ' +
    'Umsatz ' + P.sein + ' Bereichs um 18 % gestiegen.';
}

const STUDIES = {
  schlaf: {
    label: 'Schlaf-Studie (Gender-Bias Schule, 4 Gruppen)',
    groups: 4,
    title: (g) => 'Geschrieben von: ' + SCHLAF_AUTHORS[g],
    text: () => SCHLAF_TEXT,
    hint: 'Deine Antwort-Ziffer nach OBEN drehen',
    maxPt: 6.4
  },
  berger: {
    label: 'Thomas/Tanja Berger (Orange Days, 2 Gruppen)',
    groups: 2,
    title: () => 'Kurzporträt',
    text: (g) => bergerText(g === 2),   // ungerade Nr. = Thomas, gerade = Tanja
    hint: 'Antwort-Ziffer nach OBEN drehen',
    maxPt: 10                            // aeltere Zuhoerer: so gross wie moeglich
  },
  ohne: { label: 'ohne Text', groups: 1, title: null, text: null, hint: null }
};

function currentStudy() {
  const sel = document.getElementById('study');
  return STUDIES[(sel && sel.value) || 'schlaf'] || STUDIES.schlaf;
}

function groupNum(id, n) {
  const r = id % n;
  return r === 0 ? n : r;
}

async function loadConfig() {
  let raw = null;
  const stored = localStorage.getItem('aruco_cfg');
  if (stored) { try { raw = JSON.parse(stored); } catch (e) {} }
  if (!raw) {
    try {
      const resp = await fetch('config.json', { cache: 'no-store' });
      raw = await resp.json();
    } catch (e) { raw = {}; }
  }
  const rawom = raw.orientation_map && Object.keys(raw.orientation_map).length
    ? raw.orientation_map
    : { 0: '1', 45: '2', 90: '3', 135: '4', 180: '5', 225: '6', 270: '7', 315: 'E' };
  const om = {};
  for (const k in rawom) om[parseInt(k, 10)] = String(rawom[k]).trim();

  // Codes, die in mindestens einer Frage Option sind -> nur diese werden
  // auf die Karte gedruckt (tote Richtungen wie "E" bleiben Luecken).
  const usedCodes = new Set();
  for (const q of (raw.questions || [])) {
    for (const c of Object.keys(q.options || {})) usedCodes.add(String(c).trim());
  }

  const parts = (raw.participants || []).map(
    (p) => (p && typeof p === 'object') ? parseInt(p.marker_id, 10) : parseInt(p, 10)
  ).filter((n) => !isNaN(n));

  CFG = {
    orientationMap: om,
    usedCodes: usedCodes,
    participants: parts,
    dictionary: (raw.settings && raw.settings.marker_dictionary) || 'WUZ_16h5_20'
  };
}

function buildFrontCard(dict, id) {
  const card = document.createElement('div');
  card.className = 'card';
  const marker = document.createElement('div');
  marker.className = 'marker';
  marker.innerHTML = dict.generateSVG(id);
  card.appendChild(marker);
  return card;
}

function buildBackCard(id) {
  const card = document.createElement('div');
  card.className = 'card';

  // Ziffernkranz (nur Codes, die als Option vorkommen -> Luecke bei "E").
  // Kardinalrichtungen bei 45 % Radius, Diagonalen weiter aussen in den
  // Ecken (56 %), damit sie nicht mit dem Textkasten kollidieren.
  for (const degStr of Object.keys(CFG.orientationMap)) {
    const deg = parseInt(degStr, 10);
    const code = CFG.orientationMap[deg];
    if (CFG.usedCodes.size && !CFG.usedCodes.has(code)) continue;
    const radius = (deg % 90 === 0) ? 45 : 56;
    const rad = deg * Math.PI / 180;
    // Rueckseiten-Ansicht: im Uhrzeigersinn ab oben (siehe Kopfkommentar)
    const left = 50 + radius * Math.sin(rad);
    const top = 50 - radius * Math.cos(rad);
    const el = document.createElement('div');
    el.className = 'num';
    el.textContent = code;
    el.style.left = left + '%';
    el.style.top = top + '%';
    el.style.transform = 'translate(-50%,-50%) rotate(' + deg + 'deg)';
    card.appendChild(el);
  }

  // Studientext in der Mitte
  const st = currentStudy();
  const g = groupNum(id, st.groups);
  if (st.text) {
    const box = document.createElement('div');
    box.className = 'textbox';
    box.dataset.maxpt = st.maxPt;
    box.innerHTML =
      '<div class="author"></div>'
      + '<div class="stimulus"></div>'
      + '<div class="boxhint"></div>';
    box.querySelector('.author').textContent = st.title(g);
    box.querySelector('.stimulus').textContent = st.text(g);
    box.querySelector('.boxhint').textContent = st.hint;
    card.appendChild(box);
  }

  const cid = document.createElement('div');
  cid.className = 'cardid';
  cid.textContent = 'M' + id + (st.groups > 1 ? ' · G' + g : '');
  card.appendChild(cid);

  return card;
}

/* Schrift im Textkasten verkleinern, bis der Text hineinpasst. */
function fitTextboxes() {
  let minPt = 99;
  if (!document.querySelector('.textbox')) return null;
  for (const box of document.querySelectorAll('.textbox')) {
    let pt = parseFloat(box.dataset.maxpt) || 6.4;
    const author = box.querySelector('.author');
    const stim = box.querySelector('.stimulus');
    const hint = box.querySelector('.boxhint');
    while (pt > 3.6) {
      author.style.fontSize = (pt * 1.08) + 'pt';
      stim.style.fontSize = pt + 'pt';
      hint.style.fontSize = (pt * 1.35) + 'pt';
      if (box.scrollHeight <= box.clientHeight + 1) break;
      pt -= 0.2;
    }
    minPt = Math.min(minPt, pt);
  }
  return minPt;
}

function generate() {
  const dict = new AR.Dictionary(CFG.dictionary);
  const from = parseInt(document.getElementById('from').value, 10) || 0;
  const to = parseInt(document.getElementById('to').value, 10) || 0;
  const sheet = document.getElementById('sheet');
  sheet.innerHTML = '';

  const maxId = dict.codeList.length - 1;
  const ids = [];
  let skipped = 0;
  for (let id = from; id <= to; id++) {
    if (id < 0 || id > maxId) { skipped++; continue; }
    ids.push(id);
  }

  const COLS = ['c0', 'c1'];
  const ROWS = ['r0', 'r1', 'r2'];
  const perPage = 6;
  const nPages = Math.ceil(ids.length / perPage);

  for (let p = 0; p < nPages; p++) {
    const pageIds = ids.slice(p * perPage, (p + 1) * perPage);

    const front = document.createElement('div');
    front.className = 'page';
    front.innerHTML = '<div class="pagelabel">Blatt ' + (p + 1)
      + ' - VORDERSEITE (Marker ' + pageIds[0] + '-'
      + pageIds[pageIds.length - 1] + ')</div>';
    const back = document.createElement('div');
    back.className = 'page';
    back.innerHTML = '<div class="pagelabel">Blatt ' + (p + 1)
      + ' - RUECKSEITE</div>';

    pageIds.forEach((id, i) => {
      const row = Math.floor(i / 2), col = i % 2;

      const posF = document.createElement('div');
      posF.className = 'cardpos ' + COLS[col] + ' ' + ROWS[row];
      posF.appendChild(buildFrontCard(dict, id));
      front.appendChild(posF);

      // Rueckseite: Spalte gespiegelt (Duplex, lange Kante)
      const posB = document.createElement('div');
      posB.className = 'cardpos ' + COLS[1 - col] + ' ' + ROWS[row];
      posB.appendChild(buildBackCard(id));
      back.appendChild(posB);
    });

    sheet.appendChild(front);
    sheet.appendChild(back);
  }

  const usedPt = fitTextboxes();
  const parts = [];
  parts.push(ids.length + ' Karten auf ' + nPages + ' Blatt ('
    + nPages * 2 + ' Druckseiten).'
    + (usedPt !== null ? ' Textgroesse: ' + usedPt.toFixed(1) + ' pt.' : ''));
  if (skipped > 0) {
    parts.push(skipped + ' Marker-Nr. ausserhalb 0-' + maxId + ' uebersprungen.');
  }
  document.getElementById('fitinfo').textContent = ' ' + parts.join(' ');
}

async function start() {
  await loadConfig();
  const parts = CFG.participants;
  if (parts.length) {
    document.getElementById('from').value = Math.min.apply(null, parts);
    document.getElementById('to').value = Math.max.apply(null, parts);
  }
  const sel = document.getElementById('study');
  for (const key of Object.keys(STUDIES)) {
    const o = document.createElement('option');
    o.value = key; o.textContent = STUDIES[key].label;
    sel.appendChild(o);
  }
  const want = new URLSearchParams(location.search).get('text');
  if (want && STUDIES[want]) sel.value = want;
  sel.addEventListener('change', generate);
  document.getElementById('gen').addEventListener('click', generate);
  document.getElementById('print').addEventListener('click', () => window.print());
  generate();
}

document.addEventListener('DOMContentLoaded', start);
