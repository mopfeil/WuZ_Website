'use strict';

/* Erzeugt druckbare Marker-Karten: Marker plus Antwortbuchstaben rundherum.
   Der Buchstabe, der beim Hochhalten oben ist, ist die Antwort. */

let CFG = null;

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
    : { 0: 'A', 45: 'B', 90: 'C', 135: 'D', 180: 'E', 225: 'F', 270: 'G', 315: 'H' };
  const om = {};
  for (const k in rawom) om[parseInt(k, 10)] = String(rawom[k]).trim();
  const parts = (raw.participants || []).map(
    (p) => (p && typeof p === 'object') ? parseInt(p.marker_id, 10) : parseInt(p, 10)
  ).filter((n) => !isNaN(n));
  CFG = {
    orientationMap: om,
    participants: parts,
    dictionary: (raw.settings && raw.settings.marker_dictionary) || 'ARUCO_MIP_36h12'
  };
}

function buildCard(dict, id, sizeCm) {
  const card = document.createElement('div');
  card.className = 'card';
  card.style.width = sizeCm + 'cm';
  card.style.height = sizeCm + 'cm';

  const marker = document.createElement('div');
  marker.className = 'marker';
  marker.innerHTML = dict.generateSVG(id);
  card.appendChild(marker);

  // Buchstaben rund um den Marker platzieren.
  // Position: 'deg' Grad gegen den Uhrzeigersinn vom oberen Rand.
  // Buchstabe so vorgedreht, dass er aufrecht steht, wenn diese Position
  // durch Drehen der Karte nach oben kommt.
  const radius = 41; // Prozent vom Kartenzentrum
  for (const degStr of Object.keys(CFG.orientationMap)) {
    const deg = parseInt(degStr, 10);
    const rad = deg * Math.PI / 180;
    const left = 50 - radius * Math.sin(rad);
    const top = 50 - radius * Math.cos(rad);
    const lt = document.createElement('div');
    lt.className = 'lt';
    lt.textContent = CFG.orientationMap[deg];
    lt.style.left = left + '%';
    lt.style.top = top + '%';
    lt.style.fontSize = (sizeCm * 0.13) + 'cm';
    lt.style.transform = 'translate(-50%,-50%) rotate(' + (-deg) + 'deg)';
    card.appendChild(lt);
  }

  const mid = document.createElement('div');
  mid.className = 'mid';
  mid.textContent = 'Marker ' + id;
  mid.style.fontSize = (sizeCm * 0.06) + 'cm';
  card.appendChild(mid);
  return card;
}

function generate() {
  const dict = new AR.Dictionary(CFG.dictionary);
  const from = parseInt(document.getElementById('from').value, 10) || 0;
  const to = parseInt(document.getElementById('to').value, 10) || 0;
  const sizeCm = parseFloat(document.getElementById('size').value) || 8;
  const sheet = document.getElementById('sheet');
  sheet.innerHTML = '';

  const maxId = dict.codeList.length - 1;
  let skipped = 0;
  for (let id = from; id <= to; id++) {
    if (id < 0 || id > maxId) { skipped++; continue; }
    sheet.appendChild(buildCard(dict, id, sizeCm));
  }
  if (skipped > 0) {
    document.getElementById('info').textContent =
      skipped + ' Marker-Nr. ausserhalb des gueltigen Bereichs (0-' + maxId
      + ') wurden uebersprungen.';
  }
}

async function start() {
  await loadConfig();
  const parts = CFG.participants;
  if (parts.length) {
    document.getElementById('from').value = Math.min.apply(null, parts);
    document.getElementById('to').value = Math.max.apply(null, parts);
  }
  document.getElementById('gen').addEventListener('click', generate);
  document.getElementById('print').addEventListener('click', () => window.print());
  generate();
}

document.addEventListener('DOMContentLoaded', start);
