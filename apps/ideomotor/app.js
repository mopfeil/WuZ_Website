/* =====================================================================
   Ideomotor-Pendel  -  Quantifizierung des ideomotorischen Effekts
   ---------------------------------------------------------------------
   Modell
   ------
   Auf dem waagerecht gehaltenen Display schwingt eine Scheibe wie der
   Koerper eines mathematischen Pendels der Laenge L, dessen Aufhaenge-
   punkt das Telefon ist.  Mit r = Auslenkung des Pendelkoerpers relativ
   zum Aufhaengepunkt (in der Bildschirmebene) gilt fuer kleine Winkel

        r'' = -(g/L) r - 2 gamma r' - f_h ,      gamma = omega/(2Q)

   wobei f_h der waagerechte Anteil der spezifischen Kraft ist, also
   genau das, was der Beschleunigungssensor misst (a - g).  Damit sind
   BEIDE Antriebswege physikalisch korrekt und in einer Groesse erfasst:

     * Verschieben des Telefons   ->  f_h = a_translation
     * Kippen des Telefons        ->  f_h = g * sin(Neigung)

   Auswertung
   ----------
   Mit der Lage (DeviceOrientation) wird f_h in Kipp- und Translations-
   anteil zerlegt.  Beide werden per Lock-in-Demodulation bei der
   Pendelfrequenz omega ausgewertet; die Amplitude der Telefonbewegung
   ergibt sich aus  x = A_a / omega^2 .  Verglichen mit dem erzielten
   Pendelausschlag liefert das die effektive Verstaerkung (theoretisch Q).
   ===================================================================== */

'use strict';
(function () {

  var G = 9.80665, D2R = Math.PI / 180, R2D = 180 / Math.PI;
  var TAU_LI = 1.2;     // Zeitkonstante der Lock-in-Tiefpaesse [s]
  var TAU_DC = 8.0;     // Zeitkonstante der Driftkompensation [s]
  var TAU_GR = 1.5;     // Ersatz-Schwerkraftschaetzung (ohne Lagesensor)
  var WIN_MED = 2.0;    // Auswertefenster am Versuchsende [s]

  var $ = function (s) { return document.querySelector(s); };
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function fmt(v, n) { return (Math.round(v * Math.pow(10, n)) / Math.pow(10, n)).toFixed(n); }
  function median(arr) {
    if (!arr.length) return 0;
    var a = arr.slice().sort(function (p, q) { return p - q; });
    var m = a.length >> 1;
    return a.length % 2 ? a[m] : 0.5 * (a[m - 1] + a[m]);
  }

  /* =================================================================
     1  Einstellungen
     ================================================================= */

  var DEF = {
    L: 0.50,          // Pendellaenge [m]
    Q: 30,            // Guete
    thetaMaxDeg: 12,  // Vollausschlag am Bildschirmrand [Grad]
    targetFrac: 0.50, // Zielmarke als Anteil des Vollausschlags
    holdTime: 1.5,    // Haltedauer fuer "geschafft" [s]
    purityMin: 0.70,  // geforderte Achsentreue
    maxTime: 90,      // maximale Versuchsdauer [s]
    gain: 1.0,        // Antriebsfaktor (1 = physikalisch exakt)
    dcTrack: true,
    indicator: true,
    sound: true,
    exaggerate: 25    // Ueberhoehung der Telefonbewegungs-Anzeige
  };
  var S = {};
  for (var k in DEF) S[k] = DEF[k];
  try {
    var st = JSON.parse(localStorage.getItem('idm.settings') || '{}');
    for (var k2 in st) if (k2 in S) S[k2] = st[k2];
  } catch (e) { /* ignore */ }

  var OM, W2, GAM, XMAX, TPER;
  function derive() {
    OM = Math.sqrt(G / S.L);
    W2 = OM * OM;
    GAM = OM / (2 * S.Q);
    TPER = 2 * Math.PI / OM;
    XMAX = S.L * Math.sin(S.thetaMaxDeg * D2R);
  }
  derive();

  function saveSettings() {
    try { localStorage.setItem('idm.settings', JSON.stringify(S)); } catch (e) { }
  }

  /* =================================================================
     2  Sensorik
     ================================================================= */

  var sensor = {
    mode: 'none',        // 'motion' | 'pointer' | 'none'
    hasMotion: false,
    hasOrient: false,
    sign: 1,             // iOS meldet accelerationIncludingGravity invertiert
    rate: 60,
    lastT: 0,
    fRaw: [0, 0, 0],
    beta: 0, gamma: 0,
    orientOK: false,
    lin: null            // Fallback: nur lineare Beschleunigung vorhanden
  };

  var cal = {
    active: false, t0: 0, n: 0,
    sx: 0, sy: 0, sz: 0, sq: 0,
    sb: 0, sg: 0, nOri: 0,
    done: false,
    f0: [0, 0], up0: [0, 0],
    quality: ''
  };

  // Analysezustand -------------------------------------------------
  var ana = {
    t: 0,
    drive: [0, 0],     // spezifische Kraft (Bildschirmrahmen), DC-frei
    trans: [0, 0],     // translatorischer Anteil
    tiltR: [0, 0],     // Neigung [rad]
    dc: [0, 0],
    lpg: [0, 0],       // Schwerkraftschaetzung, falls kein Lagesensor
    li: {
      trans: mkLI(), tilt: mkLI(), drv: mkLI(), bob: mkLI()
    },
    ampTrans: 0,       // Amplitude der Telefonverschiebung [m]
    ampTilt: 0,        // Amplitude der Neigung [rad]
    ampDrive: 0,       // Gesamt-Antrieb als aequivalente Verschiebung [m]
    recon: [0, 0],     // rekonstruierte Momentanverschiebung [m]
    tiltEq: 0,         // Kippen als gleichwertiger Weg [m]
    wEff: 0,           // tatsaechliche Kreisfrequenz der Hand [1/s]
    gain: 0,           // Ausschlag / Antrieb
    psi: 0,            // Phase Scheibe gegen Antrieb [rad]
    qRes: 0,           // Resonanzguete = |sin psi| (1 = perfekt im Takt)
    phiPrev: null,     // fuer die Frequenzschaetzung
    dPhi: 0,
    fDrive: 0          // tatsaechlicher Takt der Hand [Hz]
  };

  // unterhalb dieser Antriebsamplitude ist das Verhaeltnis reines Rauschen
  var DRV_MIN = 1.2e-4;   // 0,12 mm

  function mkLI() { return { I: [0, 0], Q: [0, 0], A: [0, 0] }; }

  function pushLI(li, vx, vy, c, s, k) {
    li.I[0] += (vx * c - li.I[0]) * k;
    li.Q[0] += (vx * s - li.Q[0]) * k;
    li.I[1] += (vy * c - li.I[1]) * k;
    li.Q[1] += (vy * s - li.Q[1]) * k;
    li.A[0] = 2 * Math.hypot(li.I[0], li.Q[0]);
    li.A[1] = 2 * Math.hypot(li.I[1], li.Q[1]);
    return Math.hypot(li.A[0], li.A[1]);
  }

  function resetAnalysis() {
    ana.li.trans = mkLI(); ana.li.tilt = mkLI(); ana.li.drv = mkLI(); ana.li.bob = mkLI();
    ana.dc = [0, 0];
    ana.ampTrans = ana.ampTilt = ana.ampDrive = ana.tiltEq = 0;
    ana.gain = ana.psi = ana.qRes = ana.dPhi = 0;
    ana.wEff = OM;
    ana.phiPrev = null; ana.fDrive = 0;
  }

  // Bildschirmdrehung: Geraeteachsen -> Bildschirmachsen -------------
  function screenAngle() {
    var a = 0;
    if (window.screen && screen.orientation && typeof screen.orientation.angle === 'number') {
      a = screen.orientation.angle;
    } else if (typeof window.orientation === 'number') {
      a = window.orientation;
    }
    return a * D2R;
  }
  var rotC = 1, rotS = 0;
  function updateRot() { var a = -screenAngle(); rotC = Math.cos(a); rotS = Math.sin(a); }
  updateRot();
  function toScreen(x, y, out) { out[0] = x * rotC - y * rotS; out[1] = x * rotS + y * rotC; }

  var tmpA = [0, 0], tmpB = [0, 0];

  /* --- Ereignisse ------------------------------------------------- */

  function onOrient(e) {
    if (e.beta === null || e.gamma === null) return;
    sensor.hasOrient = true;
    sensor.orientOK = true;
    sensor.beta = e.beta;
    sensor.gamma = e.gamma;
  }

  function onMotion(e) {
    var now = performance.now() / 1000;
    var dt = sensor.lastT ? now - sensor.lastT : 1 / 60;
    sensor.lastT = now;
    if (!(dt > 0.001)) return;
    if (dt > 0.25) dt = 0.25;
    sensor.rate = sensor.rate * 0.9 + (1 / dt) * 0.1;
    sensor.hasMotion = true;

    var a = e.accelerationIncludingGravity;
    if (a && a.x !== null && a.x !== undefined) {
      sensor.fRaw[0] = a.x; sensor.fRaw[1] = a.y; sensor.fRaw[2] = a.z;
      sensor.lin = null;
    } else if (e.acceleration && e.acceleration.x !== null) {
      // Notfall: nur lineare Beschleunigung -> Schwerkraft aus Lage ergaenzen
      var u = upFromOrientation();
      sensor.lin = true;
      sensor.fRaw[0] = e.acceleration.x + G * u[0];
      sensor.fRaw[1] = e.acceleration.y + G * u[1];
      sensor.fRaw[2] = e.acceleration.z + G * u[2];
    } else return;

    if (cal.active) { accumulateCal(dt); return; }
    if (!cal.done) return;
    processSample(dt);
  }

  // Einheitsvektor "Welt-oben" in Geraetekoordinaten
  function upFromOrientation() {
    if (!sensor.orientOK) return [0, 0, 1];
    var b = sensor.beta * D2R, g = sensor.gamma * D2R;
    return [-Math.cos(b) * Math.sin(g), Math.sin(b), Math.cos(b) * Math.cos(g)];
  }

  function accumulateCal(dt) {
    var fx = sensor.fRaw[0], fy = sensor.fRaw[1], fz = sensor.fRaw[2];
    cal.n++;
    cal.sx += fx; cal.sy += fy; cal.sz += fz;
    cal.sq += fx * fx + fy * fy + fz * fz;
    if (sensor.orientOK) { cal.sb += sensor.beta; cal.sg += sensor.gamma; cal.nOri++; }
  }

  function finishCal() {
    if (cal.n < 5) { cal.quality = 'Keine Sensordaten empfangen.'; return false; }
    var mx = cal.sx / cal.n, my = cal.sy / cal.n, mz = cal.sz / cal.n;
    sensor.sign = (mz < 0) ? -1 : 1;          // iOS-Vorzeichen automatisch erkennen
    var s = sensor.sign;
    cal.f0 = [s * mx, s * my];
    if (cal.nOri) {
      var b = (cal.sb / cal.nOri) * D2R, g = (cal.sg / cal.nOri) * D2R;
      cal.up0 = [-Math.cos(b) * Math.sin(g), Math.sin(b)];
    } else {
      cal.up0 = [cal.f0[0] / G, cal.f0[1] / G];
    }
    ana.lpg = [cal.f0[0], cal.f0[1]];

    // Qualitaetsurteil
    var mag = Math.sqrt(mx * mx + my * my + mz * mz);
    var rms = Math.sqrt(Math.max(0, cal.sq / cal.n - mag * mag));
    var tilt = Math.asin(clamp(Math.hypot(cal.f0[0], cal.f0[1]) / G, 0, 1)) * R2D;
    cal.quality = '';
    if (tilt > 12) cal.quality = 'Hinweis: Telefon war um ' + fmt(tilt, 0) + '° geneigt – flacher halten.';
    else if (rms > 0.35) cal.quality = 'Hinweis: Die Hand war unruhig (' + fmt(rms, 2) + ' m/s²).';
    cal.done = true;
    resetAnalysis();
    return true;
  }

  /* --- Kern der Messung ------------------------------------------- */

  function processSample(dt) {
    var s = sensor.sign;
    var fx = s * sensor.fRaw[0] - cal.f0[0];
    var fy = s * sensor.fRaw[1] - cal.f0[1];

    // Neigung relativ zur Kalibrierlage
    var ux, uy;
    if (sensor.orientOK) {
      var b = sensor.beta * D2R, g = sensor.gamma * D2R;
      ux = -Math.cos(b) * Math.sin(g); uy = Math.sin(b);
    } else {
      var kg = dt / (TAU_GR + dt);
      ana.lpg[0] += (s * sensor.fRaw[0] - ana.lpg[0]) * kg;
      ana.lpg[1] += (s * sensor.fRaw[1] - ana.lpg[1]) * kg;
      ux = ana.lpg[0] / G; uy = ana.lpg[1] / G;
    }
    var tx = ux - cal.up0[0], ty = uy - cal.up0[1];   // ~ sin(Neigung)

    // langsame Drift herausnehmen (Handhaltung aendert sich)
    if (S.dcTrack) {
      var kd = dt / (TAU_DC + dt);
      ana.dc[0] += (fx - ana.dc[0]) * kd;
      ana.dc[1] += (fy - ana.dc[1]) * kd;
      fx -= ana.dc[0]; fy -= ana.dc[1];
    }

    // translatorischer Anteil = gemessen minus Kippanteil
    var ax = fx - G * tx, ay = fy - G * ty;

    // in Bildschirmkoordinaten drehen
    toScreen(fx, fy, tmpA); var dvx = tmpA[0], dvy = tmpA[1];
    toScreen(ax, ay, tmpB); var trx = tmpB[0], trry = tmpB[1];
    toScreen(tx, ty, tmpA); var tlx = tmpA[0], tly = tmpA[1];

    ana.drive[0] = dvx; ana.drive[1] = dvy;
    ana.trans[0] = trx; ana.trans[1] = trry;
    ana.tiltR[0] = tlx; ana.tiltR[1] = tly;

    analyse(dt);
    record();
  }

  function analyse(dt) {
    ana.t += dt;
    var c = Math.cos(OM * ana.t), sn = Math.sin(OM * ana.t);
    var k = dt / (TAU_LI + dt);

    var aT = pushLI(ana.li.trans, ana.trans[0], ana.trans[1], c, sn, k);
    var aD = pushLI(ana.li.drv, ana.drive[0], ana.drive[1], c, sn, k);
    pushLI(ana.li.tilt, ana.tiltR[0], ana.tiltR[1], c, sn, k);

    /* Beschleunigung -> Weg mit dem TATSAECHLICHEN Takt der Hand
       (x = a/w^2).  Mit fest omega0 waeren die mm-Werte nur bei exakter
       Resonanz richtig.  ana.dPhi stammt aus dem vorigen Abtastwert.   */
    ana.wEff = clamp(OM + ana.dPhi, 0.4 * OM, 2.5 * OM);
    var we2 = ana.wEff * ana.wEff;

    ana.ampTrans = aT / we2;                                  // [m]
    ana.ampDrive = aD / we2;                                  // [m] aequivalenter Weg
    ana.ampTilt = Math.hypot(ana.li.tilt.A[0], ana.li.tilt.A[1]); // [rad]
    ana.tiltEq = G * ana.ampTilt / we2;                       // Kippen als Weg [m]
    var rawDrive = ana.ampDrive;

    // schmalbandige Rekonstruktion der Momentanverschiebung
    var li = ana.li.trans;
    ana.recon[0] = -2 * (li.I[0] * c + li.Q[0] * sn) / we2;
    ana.recon[1] = -2 * (li.I[1] * c + li.Q[1] * sn) / we2;

    /* --- Guete der Resonanz -------------------------------------------
       Die Scheibenauslenkung wird mit derselben Referenz demoduliert wie
       der Antrieb.  Aus beiden komplexen Amplituden folgt die Phasenlage
       psi; im exakten Resonanzfall betraegt sie 90°.  Fuer den getriebenen
       Oszillator gilt   |Ausschlag| / |Ausschlag bei Resonanz| = |sin psi| ,
       also ist |sin psi| unmittelbar die Resonanzguete.                */
    var bob = ana.li.bob, drv = ana.li.drv;
    pushLI(bob, P.x, P.y, c, sn, k);

    if (rawDrive > DRV_MIN && ampTot() > 1e-4) {
      var re = 0, im = 0;
      for (var j = 0; j < 2; j++) {
        re += bob.I[j] * drv.I[j] + bob.Q[j] * drv.Q[j];
        im += bob.I[j] * drv.Q[j] - bob.Q[j] * drv.I[j];
      }
      ana.psi = Math.atan2(im, re);
      ana.qRes = Math.abs(Math.sin(ana.psi));

      // Takt der Hand: die Phase des Antriebs dreht mit (omega_Hand - omega)
      var jd = drv.A[0] >= drv.A[1] ? 0 : 1;
      var phi = Math.atan2(-drv.Q[jd], drv.I[jd]);
      if (ana.phiPrev !== null) {
        var d = phi - ana.phiPrev;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        ana.dPhi += (d / dt - ana.dPhi) * (dt / (1.5 + dt));
      }
      ana.phiPrev = phi;
      ana.fDrive = clamp((OM + ana.dPhi) / (2 * Math.PI), 0, 5);
    } else {
      ana.phiPrev = null;
      ana.dPhi = 0; ana.qRes = 0; ana.fDrive = 0;
    }

    /* Liegt der Takt neben omega, dreht der Lock-in-Zeiger mit der
       Schwebung dPhi und der Tiefpass daempft ihn um 1/sqrt(1+(dPhi*tau)^2).
       Da dPhi bekannt ist, laesst sich das exakt zuruecknehmen.        */
    var corr = clamp(Math.sqrt(1 + Math.pow(ana.dPhi * TAU_LI, 2)), 1, 3);
    ana.ampTrans *= corr; ana.ampDrive *= corr;
    ana.ampTilt *= corr; ana.tiltEq *= corr;
    ana.recon[0] *= corr; ana.recon[1] *= corr;

    ana.gain = ana.ampDrive > DRV_MIN ? ampTot() / ana.ampDrive : 0;
  }

  /* =================================================================
     3  Zeigermodus (Test ohne Sensor)
     ================================================================= */

  var ptr = { on: false, down: false, px: 0, py: 0, qx: 0, qy: 0, vx: 0, vy: 0, mPerPx: 0.00005 };

  function pointerStep(dt) {
    // kritisch gedaempfter Verfolger liefert eine saubere 2. Ableitung
    var wn = 2 * Math.PI * 6, k = wn * wn, d = 2 * wn;
    var axp = k * (ptr.px - ptr.qx) - d * ptr.vx;
    var ayp = k * (ptr.py - ptr.qy) - d * ptr.vy;
    ptr.vx += axp * dt; ptr.qx += ptr.vx * dt;
    ptr.vy += ayp * dt; ptr.qy += ptr.vy * dt;
    ana.drive[0] = ana.trans[0] = axp;
    ana.drive[1] = ana.trans[1] = ayp;
    ana.tiltR[0] = ana.tiltR[1] = 0;
    analyse(dt);
    record();
  }

  /* =================================================================
     4  Simulation des Pendels
     ================================================================= */

  var P = { x: 0, y: 0, vx: 0, vy: 0 };
  var trail = [];

  function resetPendulum() { P.x = P.y = P.vx = P.vy = 0; trail.length = 0; }

  function stepPendulum(h, drive) {
    var ax = -W2 * P.x - 2 * GAM * P.vx - S.gain * drive[0];
    var ay = -W2 * P.y - 2 * GAM * P.vy - S.gain * drive[1];
    P.vx += ax * h; P.x += P.vx * h;
    P.vy += ay * h; P.y += P.vy * h;
    // weiche Begrenzung am Bildrand
    var r = Math.hypot(P.x, P.y), rm = XMAX * 1.02;
    if (r > rm) {
      var f = rm / r;
      P.x *= f; P.y *= f;
      var vr = (P.vx * P.x + P.vy * P.y) / (r * r + 1e-12);
      if (vr > 0) { P.vx -= vr * P.x; P.vy -= vr * P.y; }
    }
  }

  function ampX() { return Math.hypot(P.x, P.vx / OM); }
  function ampY() { return Math.hypot(P.y, P.vy / OM); }
  function ampTot() { return Math.hypot(ampX(), ampY()); }

  /* =================================================================
     5  Versuchsablauf
     ================================================================= */

  var mode = 'intro';     // intro | idle | countdown | run
  var trial = null;
  var history = [];
  try { history = JSON.parse(localStorage.getItem('idm.history') || '[]'); } catch (e) { history = []; }

  function newTrial(task) {
    trial = {
      task: task,                 // 'ja' | 'nein' | 'frei'
      axis: task === 'nein' ? 1 : 0,
      t: 0, hold: 0,
      success: false, tSuccess: null,
      peakAmp: 0, peakPurity: 0,
      hist: [],                   // laufende Kennwerte
      raw: []                     // Rohdatenzeilen
    };
    resetPendulum();
    resetAnalysis();
  }

  function record() {
    if (!trial || mode !== 'run') return;
    if (trial.raw.length < 20000) {
      trial.raw.push([
        trial.t,
        ana.trans[0], ana.trans[1],
        ana.tiltR[0] * R2D, ana.tiltR[1] * R2D,
        ana.drive[0], ana.drive[1],
        P.x * 1000, P.y * 1000,
        ana.ampTrans * 1000, ana.ampTilt * R2D, ana.ampDrive * 1000,
        ampTot() * 1000,
        ana.gain, ana.gain / S.Q, ana.qRes, ana.psi * R2D, ana.fDrive
      ]);
    }
    trial.hist.push({
      t: trial.t,
      tr: ana.ampTrans, ti: ana.ampTilt, dv: ana.ampDrive, ab: ampTot(),
      te: ana.tiltEq, gn: ana.gain, rs: ana.qRes, ps: ana.psi * R2D, fd: ana.fDrive
    });
  }

  function startTask(task) {
    if (sensor.mode === 'none') { showIntro(); return; }
    if (sensor.mode === 'motion' && !cal.done) { startCalibration(task); return; }
    newTrial(task);
    mode = 'countdown';
    trial.t = -3.0;
    requestWake();
    $('#btn-ja').classList.add('hidden');
    $('#btn-nein').classList.add('hidden');
    $('#btn-frei').classList.add('hidden');
    $('#btn-stop').classList.remove('hidden');
  }

  function endTrial(success) {
    if (mode !== 'run' && mode !== 'countdown') return;
    var t = trial;
    mode = 'idle';
    releaseWake();
    $('#btn-ja').classList.remove('hidden');
    $('#btn-nein').classList.remove('hidden');
    $('#btn-frei').classList.remove('hidden');
    $('#btn-stop').classList.add('hidden');
    $('#task').textContent = 'Bereit';
    if (!t || t.t <= 0.5) { trial = null; return; }
    var res = evaluate(t, success);
    history.push(res);
    try { localStorage.setItem('idm.history', JSON.stringify(history.slice(-200))); } catch (e) { }
    lastRaw = t;
    showResult(res, t);
  }

  var lastRaw = null;

  function evaluate(t, success) {
    var tEnd = t.tSuccess != null ? t.tSuccess : t.t;
    var win = t.hist.filter(function (h) { return h.t >= tEnd - WIN_MED && h.t <= tEnd; });
    if (!win.length) win = t.hist.slice(-30);
    var mTr = median(win.map(function (h) { return h.tr; }));
    var mTi = median(win.map(function (h) { return h.ti; }));
    var mDv = median(win.map(function (h) { return h.dv; }));
    var mAb = median(win.map(function (h) { return h.ab; }));
    var tiltEq = median(win.map(function (h) { return h.te || 0; }));
    var shTilt = (mTr + tiltEq) > 0 ? tiltEq / (mTr + tiltEq) : 0;

    // Resonanzkennwerte nur aus Abschnitten mit auswertbarem Antrieb
    var val = win.filter(function (h) { return h.dv > DRV_MIN && h.gn > 0; });
    var mRs = median(val.map(function (h) { return h.rs; }));
    var mPs = median(val.map(function (h) { return Math.abs(h.ps); }));
    var mFd = median(val.map(function (h) { return h.fd; }));
    return {
      ts: Date.now(),
      task: t.task,
      success: !!success,
      time: t.tSuccess != null ? t.tSuccess : t.t,
      peakDeg: (t.peakAmp / S.L) * R2D,
      peakFrac: t.peakAmp / XMAX,
      purity: t.peakPurity,
      transMm: mTr * 1000,
      tiltDeg: mTi * R2D,
      tiltEqMm: tiltEq * 1000,
      driveMm: mDv * 1000,
      bobMm: mAb * 1000,
      gain: mDv > 1e-9 ? mAb / mDv : 0,
      qRes: mRs, psi: mPs, fDrive: mFd, f0: 1 / TPER,
      shareTilt: shTilt,
      L: S.L, Q: S.Q, thMax: S.thetaMaxDeg, gainSet: S.gain,
      src: sensor.mode
    };
  }

  /* =================================================================
     6  Hauptschleife
     ================================================================= */

  var lastFrame = 0;

  function loop(now) {
    requestAnimationFrame(loop);
    var dt = lastFrame ? (now - lastFrame) / 1000 : 1 / 60;
    lastFrame = now;
    if (dt > 0.2) dt = 0.2;

    if (ptr.on) pointerStep(dt);

    if (mode === 'countdown') {
      trial.t += dt;
      resetPendulum();
      var n = Math.ceil(-trial.t);
      $('#task').textContent = n > 0 ? taskLabel(trial.task) + '  –  ' + n
        : taskLabel(trial.task);
      if (trial.t >= 0) { mode = 'run'; trial.t = 0; resetAnalysis(); beep(660, 0.07); }
    } else if (mode === 'run') {
      trial.t += dt;
      var steps = Math.max(1, Math.ceil(dt / 0.004));
      var h = dt / steps;
      for (var i = 0; i < steps; i++) stepPendulum(h, ana.drive);

      var ax = ampX(), ay = ampY(), at = Math.hypot(ax, ay);
      var ex = ax * ax, ey = ay * ay;
      var pur = (ex + ey) > 1e-12 ? (trial.axis === 0 ? ex : ey) / (ex + ey) : 0;
      var aAxis = trial.axis === 0 ? ax : ay;
      if (at > trial.peakAmp) { trial.peakAmp = at; trial.peakPurity = pur; }

      if (trial.task !== 'frei') {
        if (aAxis >= S.targetFrac * XMAX && pur >= S.purityMin) {
          trial.hold += dt;
          if (trial.hold >= S.holdTime && !trial.success) {
            trial.success = true;
            trial.tSuccess = trial.t;
            beep(880, 0.16);
            endTrial(true);
          }
        } else trial.hold = Math.max(0, trial.hold - dt * 1.5);
      }
      if (mode === 'run' && trial.t >= S.maxTime) endTrial(false);
      $('#clock').textContent = fmt(trial.t, 1) + ' s';
    } else {
      // Leerlauf: Pendel laeuft weiter, damit man den Effekt spuert
      var st2 = Math.max(1, Math.ceil(dt / 0.004)), h2 = dt / st2;
      for (var j = 0; j < st2; j++) stepPendulum(h2, ana.drive);
    }

    trail.push(P.x, P.y);
    if (trail.length > 240) trail.splice(0, trail.length - 240);

    draw();
    if (now - lastChips > 100) { lastChips = now; updateChips(); }
  }
  var lastChips = 0;

  function taskLabel(t) {
    return t === 'ja' ? 'JA – links / rechts'
      : t === 'nein' ? 'NEIN – vor / zurück'
        : 'Freies Pendeln';
  }

  function updateChips() {
    var tr = sensor.mode === 'motion' || ptr.on;
    $('#m-trans').textContent = tr ? fmt(ana.ampTrans * 1000, 2) + ' mm' : '–';
    $('#m-tilt').textContent = (sensor.mode === 'motion')
      ? fmt(ana.ampTilt * R2D, 2) + '°' : '–';
    $('#m-amp').textContent = fmt(100 * ampTot() / XMAX, 0) + ' %';
    $('#m-freq').textContent = ana.fDrive > 0.05 ? fmt(ana.fDrive, 2) + ' Hz' : '–';

    // Verhaeltnis Ausschlag : Handbewegung
    var g = ana.gain;
    var ok = g > 0.3;
    $('#r-gain').textContent = ok ? '×' + fmt(g, g < 10 ? 1 : 0) : '–';
    var fill = $('#r-fill');
    fill.style.width = clamp(100 * g / S.Q, 0, 100).toFixed(1) + '%';
    fill.className = (ok && ana.qRes < 0.75) ? 'off' : '';
    $('#r-max').textContent = 'max. ×' + S.Q;
    $('#r-note').textContent = !ok ? 'Ausbeute –'
      : 'Ausbeute ' + fmt(clamp(100 * g / S.Q, 0, 100), 0) + ' %' + resHint();
  }

  function resHint() {
    if (ana.qRes >= 0.9) return ' · im Takt';
    var df = ana.fDrive - 1 / TPER;
    if (Math.abs(df) < 0.01) return '';
    return df > 0 ? ' · zu schnell' : ' · zu langsam';
  }

  /* =================================================================
     7  Darstellung
     ================================================================= */

  var cv = $('#cv'), ctx = cv.getContext('2d');
  var VW = 0, VH = 0, DPR = 1;

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 3);
    VW = cv.clientWidth; VH = cv.clientHeight;
    cv.width = Math.round(VW * DPR); cv.height = Math.round(VH * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    updateRot();
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', function () { setTimeout(resize, 250); });

  function draw() {
    if (!VW || cv.clientWidth !== VW || cv.clientHeight !== VH) resize();
    var w = VW, h = VH, cx = w / 2, cy = h / 2;
    var discR = clamp(Math.min(w, h) * 0.085, 14, 46);
    var R = Math.min(w, h) / 2 - discR - 14;
    var sc = R / XMAX;

    ctx.clearRect(0, 0, w, h);
    var bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.7);
    bg.addColorStop(0, '#131c27'); bg.addColorStop(1, '#0b0f14');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);

    var act = (mode === 'run' || mode === 'countdown') ? trial.task : null;

    // Achsen + Beschriftung
    ctx.lineWidth = 1;
    ctx.strokeStyle = act === 'ja' ? 'rgba(79,209,197,.55)' : 'rgba(255,255,255,.10)';
    line(cx - R, cy, cx + R, cy);
    ctx.strokeStyle = act === 'nein' ? 'rgba(79,209,197,.55)' : 'rgba(255,255,255,.10)';
    line(cx, cy - R, cx, cy + R);

    ctx.font = '600 11px -apple-system,system-ui,sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = act === 'ja' ? 'rgba(79,209,197,.9)' : 'rgba(139,155,176,.55)';
    ctx.fillText('JA', cx - R + 12, cy - 12);
    ctx.fillText('JA', cx + R - 12, cy - 12);
    ctx.fillStyle = act === 'nein' ? 'rgba(79,209,197,.9)' : 'rgba(139,155,176,.55)';
    ctx.fillText('NEIN', cx + 22, cy - R + 10);
    ctx.fillText('NEIN', cx + 22, cy + R - 10);

    // Rand und Zielmarke
    ctx.strokeStyle = 'rgba(255,255,255,.10)';
    circle(cx, cy, R); ctx.stroke();
    if (act && act !== 'frei') {
      ctx.save();
      ctx.setLineDash([5, 6]);
      ctx.strokeStyle = 'rgba(240,180,41,.55)';
      circle(cx, cy, R * S.targetFrac); ctx.stroke();
      ctx.restore();
    }

    // Spur
    if (trail.length >= 4) {
      var n = trail.length / 2;
      for (var i = 1; i < n; i++) {
        var a = i / n;
        ctx.strokeStyle = 'rgba(79,209,197,' + (a * a * 0.35).toFixed(3) + ')';
        ctx.lineWidth = 1 + 1.6 * a;
        line(cx + trail[(i - 1) * 2] * sc, cy - trail[(i - 1) * 2 + 1] * sc,
          cx + trail[i * 2] * sc, cy - trail[i * 2 + 1] * sc);
      }
    }

    var px = cx + P.x * sc, py = cy - P.y * sc;

    // Faden-Projektion
    ctx.strokeStyle = 'rgba(255,255,255,.13)'; ctx.lineWidth = 1;
    line(cx, cy, px, py);
    ctx.fillStyle = 'rgba(255,255,255,.25)';
    circle(cx, cy, 2.5); ctx.fill();

    // Telefonbewegung (ueberhoeht)
    if (S.indicator && (sensor.mode === 'motion' || ptr.on)) {
      var ix = cx + ana.recon[0] * S.exaggerate * sc;
      var iy = cy - ana.recon[1] * S.exaggerate * sc;
      ctx.strokeStyle = 'rgba(240,180,41,.75)'; ctx.lineWidth = 1.5;
      circle(ix, iy, 6); ctx.stroke();
      line(ix - 9, iy, ix + 9, iy); line(ix, iy - 9, ix, iy + 9);
      ctx.fillStyle = 'rgba(240,180,41,.75)';
      ctx.font = '10px -apple-system,system-ui,sans-serif';
      ctx.fillText('Telefon ×' + S.exaggerate, ix, iy + 18);
    }

    // Scheibe
    ctx.save();
    ctx.beginPath(); ctx.ellipse(px, py + discR * 0.45, discR * 0.92, discR * 0.3, 0, 0, 7);
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fill();
    ctx.restore();

    var gr = ctx.createRadialGradient(px - discR * .35, py - discR * .4, discR * .1,
      px, py, discR);
    gr.addColorStop(0, '#bff5ef'); gr.addColorStop(.45, '#4fd1c5'); gr.addColorStop(1, '#127a72');
    ctx.fillStyle = gr; circle(px, py, discR); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1.2;
    circle(px, py, discR); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.18)';
    circle(px, py, discR * 0.62); ctx.stroke();

    // Fortschrittsbalken fuer die Haltedauer
    if (mode === 'run' && trial.task !== 'frei' && trial.hold > 0) {
      var f = clamp(trial.hold / S.holdTime, 0, 1);
      ctx.strokeStyle = 'rgba(240,180,41,.9)'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(cx, cy, R + 7, -Math.PI / 2, -Math.PI / 2 + f * 2 * Math.PI);
      ctx.stroke();
    }

    if (mode === 'idle' && sensor.mode !== 'none') {
      ctx.fillStyle = 'rgba(139,155,176,.55)';
      ctx.font = '13px -apple-system,system-ui,sans-serif';
      ctx.fillText('Aufgabe unten wählen', cx, h - 8);
    }
  }

  function line(x1, y1, x2, y2) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
  function circle(x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); }

  /* =================================================================
     8  Ton, Wake-Lock
     ================================================================= */

  var actx = null, wake = null;
  function beep(f, d) {
    if (!S.sound) return;
    try {
      if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
      var o = actx.createOscillator(), g = actx.createGain();
      o.frequency.value = f; o.type = 'sine';
      g.gain.setValueAtTime(0.0001, actx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.25, actx.currentTime + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + d);
      o.connect(g); g.connect(actx.destination);
      o.start(); o.stop(actx.currentTime + d + 0.02);
    } catch (e) { }
  }
  function requestWake() {
    try {
      if (navigator.wakeLock && !wake) navigator.wakeLock.request('screen').then(function (w) { wake = w; }, function () { });
    } catch (e) { }
  }
  function releaseWake() { try { if (wake) { wake.release(); wake = null; } } catch (e) { } }

  /* =================================================================
     9  Bedienung
     ================================================================= */

  function show(id) { $(id).classList.remove('hidden'); }
  function hide(id) { $(id).classList.add('hidden'); }
  function showIntro() { show('#intro'); }

  $('#btn-enable').addEventListener('click', function () {
    var st = $('#intro-status');
    st.textContent = 'Frage Berechtigung an …';
    var jobs = [];
    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function')
      jobs.push(DeviceMotionEvent.requestPermission());
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function')
      jobs.push(DeviceOrientationEvent.requestPermission());

    if (jobs.length) {
      Promise.all(jobs).then(function (r) {
        var denied = r.some(function (x) { return x !== 'granted'; });
        if (denied) { st.textContent = 'Berechtigung abgelehnt. Seite neu laden und erneut versuchen.'; return; }
        attachSensors(st);
      }).catch(function (err) {
        st.textContent = 'Fehler: ' + err + ' – Sensoren brauchen HTTPS (siehe README).';
      });
    } else {
      attachSensors(st);   // Android/Desktop: keine Freigabe noetig
    }
    beep(440, 0.04); // erzeugt zugleich den Audio-Kontext per Nutzergeste
  });

  function attachSensors(st) {
    window.addEventListener('devicemotion', onMotion);
    window.addEventListener('deviceorientation', onOrient);
    sensor.mode = 'motion';
    st.textContent = 'Warte auf Sensordaten …';
    setTimeout(function () {
      if (!sensor.hasMotion) {
        st.textContent = 'Keine Sensordaten. Die Seite muss über HTTPS (oder localhost) '
          + 'geladen sein; eine reine Datei-URL liefert keine Bewegungsdaten.';
        sensor.mode = 'none';
        return;
      }
      hide('#intro');
      startCalibration(null);
    }, 1600);
  }

  $('#btn-nosensor').addEventListener('click', function () {
    sensor.mode = 'pointer';
    ptr.on = true;
    cal.done = true;
    cal.f0 = [0, 0]; cal.up0 = [0, 0];
    hide('#intro');
    mode = 'idle';
    $('#task').textContent = 'Testmodus – ziehen';
  });

  // Kalibrierung ----------------------------------------------------
  var calNext = null, calTimer = null;
  function startCalibration(next) {
    calNext = next;
    cal.active = true; cal.done = false; cal.n = 0;
    cal.sx = cal.sy = cal.sz = cal.sq = cal.sb = cal.sg = 0; cal.nOri = 0;
    cal.t0 = performance.now();
    show('#calib');
    $('#calib-hint').textContent = 'Telefon flach und ruhig halten …';
    clearInterval(calTimer);
    calTimer = setInterval(function () {
      var el = (performance.now() - cal.t0) / 1000, dur = 2.0;
      var f = clamp(el / dur, 0, 1);
      $('#calib-arc').style.strokeDashoffset = (327 * (1 - f)).toFixed(1);
      $('#calib-num').textContent = fmt(Math.max(0, dur - el), 1);
      if (f >= 1) {
        clearInterval(calTimer);
        cal.active = false;
        var ok = finishCal();
        if (!ok) {
          $('#calib-hint').textContent = cal.quality + ' Bitte Seite neu laden.';
          return;
        }
        hide('#calib');
        mode = 'idle';
        $('#task').textContent = cal.quality ? cal.quality : 'Bereit';
        if (calNext) startTask(calNext);
      }
    }, 100);
  }
  $('#btn-calib-cancel').addEventListener('click', function () {
    clearInterval(calTimer); cal.active = false; hide('#calib');
  });

  // Aufgaben --------------------------------------------------------
  $('#btn-ja').addEventListener('click', function () { startTask('ja'); });
  $('#btn-nein').addEventListener('click', function () { startTask('nein'); });
  $('#btn-frei').addEventListener('click', function () { startTask('frei'); });
  $('#btn-stop').addEventListener('click', function () { endTrial(false); });

  // Zeigermodus -----------------------------------------------------
  var stage = $('#stage');
  function ptrPos(e) {
    var r = cv.getBoundingClientRect();
    var t = e.touches ? e.touches[0] : e;
    return [(t.clientX - r.left - r.width / 2) * ptr.mPerPx,
    -(t.clientY - r.top - r.height / 2) * ptr.mPerPx];
  }
  function pDown(e) { if (!ptr.on) return; ptr.down = true; var p = ptrPos(e); ptr.px = p[0]; ptr.py = p[1]; e.preventDefault(); }
  function pMove(e) { if (!ptr.on || !ptr.down) return; var p = ptrPos(e); ptr.px = p[0]; ptr.py = p[1]; e.preventDefault(); }
  function pUp() { if (!ptr.on) return; ptr.down = false; ptr.px = 0; ptr.py = 0; }
  stage.addEventListener('mousedown', pDown); window.addEventListener('mousemove', pMove); window.addEventListener('mouseup', pUp);
  stage.addEventListener('touchstart', pDown, { passive: false });
  stage.addEventListener('touchmove', pMove, { passive: false });
  stage.addEventListener('touchend', pUp);

  /* =================================================================
     10  Ergebnisanzeige
     ================================================================= */

  function showResult(r, t) {
    $('#res-title').textContent = r.success ? 'Geschafft' :
      (r.task === 'frei' ? 'Messung beendet' : 'Zeit abgelaufen');
    $('#res-lead').innerHTML = r.success
      ? 'Die Scheibe erreichte die Zielmarke nach <b>' + fmt(r.time, 1) + ' s</b>.'
      : 'Größter Ausschlag: <b>' + fmt(100 * r.peakFrac, 0) + '&nbsp;%</b> des Vollausschlags.';

    var rows = [
      ['Aufgabe', taskLabel(r.task), 0],
      ['Ausschlag der Scheibe', fmt(r.peakDeg, 1) + '° (' + fmt(r.bobMm, 0) + ' mm)', 0],
      ['<b>Bewegung des Telefons</b>', '±' + fmt(r.transMm, 2) + ' mm', 1],
      ['&nbsp;&nbsp;Spitze-Spitze', fmt(2 * r.transMm, 2) + ' mm', 0],
      ['<b>Kippen des Telefons</b>', '±' + fmt(r.tiltDeg, 2) + '°', 1],
      ['&nbsp;&nbsp;entspricht', fmt(r.tiltEqMm, 2) + ' mm Antrieb', 0],
      ['Anteil Kippen am Antrieb', fmt(100 * r.shareTilt, 0) + ' %', 0],
      ['<b>Ausschlag ÷ Handbewegung</b>', '×' + fmt(r.gain, 1), 1],
      ['&nbsp;&nbsp;möglich wäre', '×' + r.Q + '  (Güte Q)', 0],
      ['<b>Resonanzausbeute</b>', fmt(100 * r.gain / r.Q, 0) + ' %', 1],
      ['&nbsp;&nbsp;Takttreue', fmt(100 * (r.qRes || 0), 0) + ' %', 0],
      ['&nbsp;&nbsp;Phasenlage', fmt(r.psi || 0, 0) + '°  (ideal 90°)', 0],
      ['&nbsp;&nbsp;Ihr Takt', fmt(r.fDrive || 0, 3) + ' Hz  (Pendel '
        + fmt(r.f0 || 0, 3) + ' Hz)', 0],
      ['Achsentreue', fmt(100 * r.purity, 0) + ' %', 0],
      ['Pendel', 'L = ' + fmt(r.L, 2) + ' m,  T = ' + fmt(2 * Math.PI * Math.sqrt(r.L / G), 2) + ' s', 0]
    ];
    if (r.gainSet !== 1) rows.push(['Antriebsfaktor', '×' + fmt(r.gainSet, 2) + ' (nicht 1!)', 0]);
    if (r.src !== 'motion') rows.push(['Quelle', 'Testmodus ohne Sensor', 0]);

    $('#res-tab').innerHTML = rows.map(function (x) {
      return '<tr><td>' + x[0] + '</td><td' + (x[2] ? ' class="hl"' : '') + '>' + x[1] + '</td></tr>';
    }).join('');

    var mm = r.transMm;
    var cmpTxt = mm < 0.1 ? 'weniger als ein Zehntel Millimeter'
      : mm < 0.3 ? 'etwa die Dicke eines Haares'
        : mm < 1.0 ? 'etwa die Dicke eines Blatts Papier (mehrfach)'
          : mm < 3.0 ? 'etwa die Dicke einer Kreditkarte'
            : mm < 10 ? 'etwa die Breite eines Fingernagels'
              : 'eine deutlich sichtbare Handbewegung';
    /* Niedrige Ausbeute hat zwei ganz verschiedene Ursachen: falscher Takt
       oder noch nicht fertig aufgeschwungen. Die Takttreue trennt beides. */
    var qAus = clamp(100 * r.gain / r.Q, 0, 100);    // Resonanzausbeute
    var qTak = 100 * (r.qRes || 0);                  // Takttreue
    var qTxt;
    if (qTak >= 88) {
      qTxt = qAus >= 85
        ? 'Der Takt traf die Eigenfrequenz des Pendels nahezu genau – mehr '
        + 'Ausschlag wäre bei dieser Handbewegung physikalisch nicht möglich gewesen.'
        : 'Der Takt saß genau; das Pendel war aber noch im Aufschwingen. '
        + 'Bei gleicher Bewegung wären am Ende bis zu ×' + fmt(r.Q, 0)
        + ' statt ×' + fmt(r.gain, 1) + ' herausgekommen.';
    } else if (qTak >= 50) {
      qTxt = 'Der Takt lag etwas neben der Eigenfrequenz; im genauen Rhythmus '
        + 'hätte dieselbe Handbewegung rund ' + fmt(10000 / Math.max(qTak, 1) - 100, 0)
        + ' % mehr Ausschlag erzeugt.';
    } else {
      qTxt = 'Der Takt lag deutlich neben der Eigenfrequenz – der Ausschlag entstand '
        + 'überwiegend durch die Größe der Bewegung, nicht durch Resonanz. '
        + 'Im richtigen Rhythmus hätte dieselbe Bewegung ×' + fmt(r.Q, 0)
        + ' statt ×' + fmt(r.gain, 1) + ' erzeugt.';
    }

    $('#res-interp').innerHTML = r.transMm > 0
      ? 'Die reine Verschiebung der Hand betrug im Mittel <b>' + fmt(mm, 2) + ' mm</b> – '
      + cmpTxt + '. Aus <b>1 mm Handbewegung wurden ' + fmt(r.gain, r.gain < 10 ? 1 : 0)
      + ' mm Ausschlag</b>. ' + qTxt
      + (r.gain >= 3 ? ' Genau diese Verstärkung macht unwillkürliche Mikrobewegungen '
        + 'sichtbar, ohne dass sie bewusst wahrgenommen werden.' : '')
      : '';
    show('#result');
  }
  $('#btn-res-close').addEventListener('click', function () { hide('#result'); });
  $('#btn-again').addEventListener('click', function () {
    var task = history.length ? history[history.length - 1].task : 'ja';
    hide('#result'); startTask(task);
  });

  /* =================================================================
     11  Menue, Einstellungen, Export
     ================================================================= */

  function bindRange(sel, key, fmtFn) {
    var el = $(sel);
    el.value = S[key];
    el.addEventListener('input', function () {
      S[key] = parseFloat(el.value);
      derive(); saveSettings(); refreshSettings();
    });
  }
  function refreshSettings() {
    $('#s-L').value = S.L; $('#s-Q').value = S.Q; $('#s-th').value = S.thetaMaxDeg;
    $('#s-tg').value = S.targetFrac; $('#s-mt').value = S.maxTime; $('#s-gn').value = S.gain;
    $('#v-L').textContent = fmt(S.L, 2) + ' m';
    $('#v-T').textContent = fmt(TPER, 2) + ' s  (' + fmt(1 / TPER, 2) + ' Hz)';
    $('#v-Q').textContent = S.Q;
    $('#v-tau').textContent = fmt(2 * S.Q / OM, 0) + ' s';
    $('#v-th').textContent = S.thetaMaxDeg + '°  (' + fmt(XMAX * 1000, 0) + ' mm)';
    $('#v-tg').textContent = fmt(100 * S.targetFrac, 0) + ' %';
    $('#v-mt').textContent = S.maxTime + ' s';
    $('#v-gn').textContent = fmt(S.gain, 2);
    $('#v-gn-warn').textContent = S.gain === 1 ? '1.00 = physikalisch exakt'
      : 'Achtung: Messwerte nicht mehr direkt vergleichbar';
    $('#s-dc').checked = S.dcTrack; $('#s-ind').checked = S.indicator; $('#s-snd').checked = S.sound;
    renderHistory();
    $('#diag').textContent = 'Quelle: ' + sensor.mode
      + ' | Rate: ' + fmt(sensor.rate, 0) + ' Hz'
      + ' | Vorzeichen: ' + sensor.sign
      + ' | Lagesensor: ' + (sensor.orientOK ? 'ja' : 'nein')
      + ' | secure: ' + (window.isSecureContext ? 'ja' : 'nein');
  }

  bindRange('#s-L', 'L'); bindRange('#s-Q', 'Q'); bindRange('#s-th', 'thetaMaxDeg');
  bindRange('#s-tg', 'targetFrac'); bindRange('#s-mt', 'maxTime'); bindRange('#s-gn', 'gain');
  $('#s-dc').addEventListener('change', function () { S.dcTrack = this.checked; saveSettings(); });
  $('#s-ind').addEventListener('change', function () { S.indicator = this.checked; saveSettings(); });
  $('#s-snd').addEventListener('change', function () { S.sound = this.checked; saveSettings(); });

  $('#btn-menu').addEventListener('click', function () { refreshSettings(); show('#menu'); });
  $('#btn-menu-close').addEventListener('click', function () { hide('#menu'); });
  $('#btn-reset').addEventListener('click', function () {
    for (var q in DEF) S[q] = DEF[q];
    derive(); saveSettings(); refreshSettings();
  });
  $('#btn-recal').addEventListener('click', function () {
    hide('#menu');
    if (sensor.mode === 'motion') startCalibration(null);
  });
  $('#btn-clear').addEventListener('click', function () {
    history = []; try { localStorage.removeItem('idm.history'); } catch (e) { }
    renderHistory();
  });

  function renderHistory() {
    var el = $('#hist');
    if (!history.length) { el.innerHTML = '<div class="none">Noch keine Versuche.</div>'; return; }
    var rows = history.slice().reverse().slice(0, 40).map(function (r, i) {
      var d = new Date(r.ts);
      return '<tr><td>' + (history.length - i) + '. ' + r.task.toUpperCase()
        + ' &middot; ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2)
        + '</td><td>' + (r.success ? fmt(r.time, 1) + ' s' : '–')
        + ' &middot; ' + fmt(r.transMm, 2) + ' mm'
        + ' &middot; ×' + fmt(r.gain, 0)
        + ' &middot; ' + fmt(100 * r.gain / r.Q, 0) + '%</td></tr>';
    }).join('');
    el.innerHTML = '<table>' + rows + '</table>';
  }

  // Export ----------------------------------------------------------
  function openDump(text, filename) {
    $('#dump-txt').value = text;
    $('#btn-dump-dl').onclick = function () { download(text, filename); };
    show('#dump');
  }
  $('#btn-dump-close').addEventListener('click', function () { hide('#dump'); });

  function download(text, filename) {
    try {
      var b = new Blob([text], { type: 'text/csv;charset=utf-8' });
      var u = URL.createObjectURL(b);
      var a = document.createElement('a');
      a.href = u; a.download = filename; document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(u); a.remove(); }, 1500);
    } catch (e) { alert('Download nicht möglich – bitte Text kopieren.'); }
  }

  $('#btn-csv').addEventListener('click', function () {
    var head = 'nr;zeit;aufgabe;erfolg;dauer_s;ausschlag_grad;ausschlag_mm;'
      + 'translation_mm;kippen_grad;kippen_aequiv_mm;antrieb_mm;verstaerkung;'
      + 'resonanzausbeute;takttreue;phasenlage_grad;takt_hz;pendel_hz;'
      + 'anteil_kippen;achsentreue;L_m;Q;vollausschlag_grad;antriebsfaktor;quelle';
    var lines = history.map(function (r, i) {
      return [i + 1, new Date(r.ts).toISOString(), r.task, r.success ? 1 : 0,
      fmt(r.time, 2), fmt(r.peakDeg, 2), fmt(r.bobMm, 1),
      fmt(r.transMm, 3), fmt(r.tiltDeg, 3), fmt(r.tiltEqMm, 3), fmt(r.driveMm, 3),
      fmt(r.gain, 2), fmt(r.gain / r.Q, 3), fmt(r.qRes || 0, 3), fmt(r.psi || 0, 1),
      fmt(r.fDrive || 0, 4), fmt(r.f0 || 0, 4),
      fmt(r.shareTilt, 3), fmt(r.purity, 3),
      fmt(r.L, 2), r.Q, r.thMax, fmt(r.gainSet, 2), r.src].join(';');
    });
    openDump([head].concat(lines).join('\n'), 'ideomotor_versuche.csv');
  });

  $('#btn-raw').addEventListener('click', function () {
    if (!lastRaw || !lastRaw.raw.length) { openDump('Keine Rohdaten vorhanden.', 'leer.csv'); return; }
    var head = 't_s;a_trans_x;a_trans_y;neigung_x_grad;neigung_y_grad;antrieb_x;antrieb_y;'
      + 'scheibe_x_mm;scheibe_y_mm;amp_translation_mm;amp_neigung_grad;amp_antrieb_mm;'
      + 'amp_scheibe_mm;verstaerkung;resonanzausbeute;takttreue;phasenlage_grad;takt_hz';
    var lines = lastRaw.raw.map(function (r) {
      return r.map(function (v, i) { return fmt(v, i === 0 ? 3 : 4); }).join(';');
    });
    openDump([head].concat(lines).join('\n'), 'ideomotor_rohdaten.csv');
  });

  /* =================================================================
     12  Start
     ================================================================= */

  document.addEventListener('gesturestart', function (e) { e.preventDefault(); });
  document.addEventListener('dblclick', function (e) { e.preventDefault(); });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { });
    });
  }

  resize();
  refreshSettings();
  requestAnimationFrame(loop);

})();
