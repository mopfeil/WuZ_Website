/* =====================================================================
   Ideomotor-Pendel online  -  Wettbewerb mehrerer Telefone
   ---------------------------------------------------------------------
   Sensorik, Kalibrierung und Darstellung entsprechen der Einzelfassung
   (apps/ideomotor/).  Physik und Wertung stehen in physik.js.

   Ablauf
   ------
   Die Spielleitung eroeffnet einen Raum (4-stelliger Code) und sieht die
   Anzeigetafel.  Mitspielende treten mit Code und Namen bei, kalibrieren
   und ueben frei.  Startet die Spielleitung eine Runde, laufen auf allen
   Telefonen nach 5 s Countdown gleichzeitig dieselben N Sekunden (Server-
   zeit).  Jedes Telefon wertet selbst aus und meldet seine Kennwerte etwa
   einmal pro Sekunde an api/room.php; die Rangliste sehen alle live.
   ===================================================================== */

'use strict';
(function () {

  var G = IdmPhysik.G, D2R = IdmPhysik.D2R, R2D = IdmPhysik.R2D, clamp = IdmPhysik.clamp;
  var TAU_DC = 8.0;     // Zeitkonstante der Driftkompensation [s]
  var TAU_GR = 1.5;     // Ersatz-Schwerkraftschaetzung (ohne Lagesensor)
  var API = 'api/room.php';

  var $ = function (s) { return document.querySelector(s); };
  function fmt(v, n) { return (Math.round(v * Math.pow(10, n)) / Math.pow(10, n)).toFixed(n); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function show(id) { $(id).classList.remove('hidden'); }
  function hide(id) { $(id).classList.add('hidden'); }
  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { } }

  /* =================================================================
     1  Modell und Voreinstellungen
     ================================================================= */

  var DEF_ROOM = { duration: 60, L: 0.5, Q: 30, targetFrac: 0.5, thetaMaxDeg: 12 };
  var RS = {};                 // Einstellungen des Raums (vom Server)
  for (var k0 in DEF_ROOM) RS[k0] = DEF_ROOM[k0];
  var M = IdmPhysik.create(RS);
  var PREF = { dcTrack: true, indicator: true, sound: true, exaggerate: 25 };

  function applyRoomSettings(s) {
    var changed = false;
    for (var k in DEF_ROOM) {
      if (s && typeof s[k] === 'number' && s[k] !== RS[k]) { RS[k] = s[k]; changed = true; }
    }
    if (changed) { M.setParams({ L: RS.L, Q: RS.Q, thetaMaxDeg: RS.thetaMaxDeg, gain: 1 }); M.resetAnalysis(); }
  }

  /* =================================================================
     2  Sensorik (wie Einzelfassung)
     ================================================================= */

  var sensor = {
    mode: 'none', hasMotion: false, sign: 1, rate: 60, lastT: 0,
    fRaw: [0, 0, 0], beta: 0, gamma: 0, orientOK: false
  };
  var cal = {
    active: false, t0: 0, n: 0, sx: 0, sy: 0, sz: 0, sq: 0, sb: 0, sg: 0, nOri: 0,
    done: false, f0: [0, 0], up0: [0, 0], quality: ''
  };
  var dc = [0, 0], lpg = [0, 0];

  function screenAngle() {
    var a = 0;
    if (window.screen && screen.orientation && typeof screen.orientation.angle === 'number') a = screen.orientation.angle;
    else if (typeof window.orientation === 'number') a = window.orientation;
    return a * D2R;
  }
  var rotC = 1, rotS = 0;
  function updateRot() { var a = -screenAngle(); rotC = Math.cos(a); rotS = Math.sin(a); }
  updateRot();
  function toScreen(x, y, out) { out[0] = x * rotC - y * rotS; out[1] = x * rotS + y * rotC; }

  var vDrv = [0, 0], vTr = [0, 0], vTi = [0, 0];

  function onOrient(e) {
    if (e.beta === null || e.gamma === null) return;
    sensor.orientOK = true;
    sensor.beta = e.beta; sensor.gamma = e.gamma;
  }

  function upFromOrientation() {
    if (!sensor.orientOK) return [0, 0, 1];
    var b = sensor.beta * D2R, g = sensor.gamma * D2R;
    return [-Math.cos(b) * Math.sin(g), Math.sin(b), Math.cos(b) * Math.cos(g)];
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
    } else if (e.acceleration && e.acceleration.x !== null) {
      var u = upFromOrientation();
      sensor.fRaw[0] = e.acceleration.x + G * u[0];
      sensor.fRaw[1] = e.acceleration.y + G * u[1];
      sensor.fRaw[2] = e.acceleration.z + G * u[2];
    } else return;

    if (cal.active) { accumulateCal(); return; }
    if (!cal.done) return;
    processSample(dt);
  }

  function accumulateCal() {
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
    lpg = [cal.f0[0], cal.f0[1]];
    dc = [0, 0];

    var mag = Math.sqrt(mx * mx + my * my + mz * mz);
    var rms = Math.sqrt(Math.max(0, cal.sq / cal.n - mag * mag));
    var tilt = Math.asin(clamp(Math.hypot(cal.f0[0], cal.f0[1]) / G, 0, 1)) * R2D;
    cal.quality = '';
    if (tilt > 12) cal.quality = 'Hinweis: Telefon war um ' + fmt(tilt, 0) + '° geneigt – flacher halten.';
    else if (rms > 0.35) cal.quality = 'Hinweis: Die Hand war unruhig (' + fmt(rms, 2) + ' m/s²).';
    cal.done = true;
    M.resetAnalysis();
    return true;
  }

  function processSample(dt) {
    var s = sensor.sign;
    var fx = s * sensor.fRaw[0] - cal.f0[0];
    var fy = s * sensor.fRaw[1] - cal.f0[1];

    var ux, uy;
    if (sensor.orientOK) {
      var b = sensor.beta * D2R, g = sensor.gamma * D2R;
      ux = -Math.cos(b) * Math.sin(g); uy = Math.sin(b);
    } else {
      var kg = dt / (TAU_GR + dt);
      lpg[0] += (s * sensor.fRaw[0] - lpg[0]) * kg;
      lpg[1] += (s * sensor.fRaw[1] - lpg[1]) * kg;
      ux = lpg[0] / G; uy = lpg[1] / G;
    }
    var tx = ux - cal.up0[0], ty = uy - cal.up0[1];   // ~ sin(Neigung)

    if (PREF.dcTrack) {
      var kd = dt / (TAU_DC + dt);
      dc[0] += (fx - dc[0]) * kd;
      dc[1] += (fy - dc[1]) * kd;
      fx -= dc[0]; fy -= dc[1];
    }
    var ax = fx - G * tx, ay = fy - G * ty;

    toScreen(fx, fy, vDrv);
    toScreen(ax, ay, vTr);
    toScreen(tx, ty, vTi);
    M.sample(dt, vDrv, vTr, vTi);
  }

  /* =================================================================
     3  Zeigermodus (ohne Sensor, nur zum Ausprobieren)
     ================================================================= */

  var ptr = { on: false, down: false, px: 0, py: 0, qx: 0, qy: 0, vx: 0, vy: 0, mPerPx: 0.00005 };
  var ZERO = [0, 0], pA = [0, 0];

  function pointerStep(dt) {
    var wn = 2 * Math.PI * 6, kk = wn * wn, d = 2 * wn;
    var axp = kk * (ptr.px - ptr.qx) - d * ptr.vx;
    var ayp = kk * (ptr.py - ptr.qy) - d * ptr.vy;
    ptr.vx += axp * dt; ptr.qx += ptr.vx * dt;
    ptr.vy += ayp * dt; ptr.qy += ptr.vy * dt;
    pA[0] = axp; pA[1] = ayp;
    M.sample(dt, pA, pA, ZERO);
  }

  function ready() { return (sensor.mode === 'motion' && cal.done && !cal.active) || ptr.on; }

  /* =================================================================
     4  Verbindung zum Server
     ================================================================= */

  var clockOff = 0, offSamples = [];   // Serverzeit - lokale Zeit [ms]
  function serverNow() { return Date.now() + clockOff; }

  function api(body) {
    var t0 = Date.now();
    return fetch(API, {
      method: 'POST', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (res) {
      var t1 = Date.now();
      return res.json().catch(function () { return {}; }).then(function (j) {
        if (!res.ok) {
          var err = new Error(j.error || ('HTTP ' + res.status));
          err.status = res.status; err.body = j;
          throw err;
        }
        if (typeof j.now === 'number') {
          // Uhrabgleich: Messung mit der kuerzesten Laufzeit ist die genaueste
          offSamples.push({ rtt: t1 - t0, off: j.now - (t0 + t1) / 2 });
          if (offSamples.length > 12) offSamples.shift();
          var best = offSamples[0];
          for (var i = 1; i < offSamples.length; i++) if (offSamples[i].rtt < best.rtt) best = offSamples[i];
          clockOff = best.off;
        }
        return j;
      });
    });
  }

  /* =================================================================
     5  Spielzustand (Telefon)
     ================================================================= */

  var code = null;            // Raumcode
  var me = null;              // {pid, token, nick}
  var room = null;            // letzter Serverzustand
  var game = { round: 0, scoring: false, final: null, finalAck: false, lastPhase: '' };
  var netErr = '';
  var syncTimer = null, syncBusy = false;

  function localPhase() {
    if (!room || room.round === 0) return 'lobby';
    var t = serverNow();
    if (t < room.startAt) return 'countdown';
    if (t < room.endAt) return 'running';
    return 'done';
  }

  function scheduleSync(ms) {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(doSync, ms);
  }

  function doSync() {
    if (!me || syncBusy) return;
    syncBusy = true;
    var body = {
      action: 'sync', room: code, pid: me.pid, token: me.token,
      src: ptr.on ? 'pointer' : sensor.mode, ready: ready()
    };
    if (game.round > 0 && (game.scoring || (game.final && !game.finalAck))) {
      body.report = { round: game.round };
      if (game.scoring) body.report.live = M.result(RS.targetFrac);
      if (game.final && !game.finalAck) body.report.final = game.final;
    }
    api(body).then(function (st) {
      syncBusy = false;
      netErr = '';
      onState(st);
      var ph = localPhase();
      scheduleSync(ph === 'running' || ph === 'countdown' || (game.final && !game.finalAck) ? 1000 : 2000);
    }, function (err) {
      syncBusy = false;
      if (err.status === 403 && err.body && err.body.rejoin) {
        lsDel('idmo.player.' + code);
        backToStart('Du wurdest aus dem Raum entfernt oder der Raum wurde neu angelegt. Bitte neu beitreten.');
        return;
      }
      if (err.status === 404) {
        lsDel('idmo.player.' + code);
        backToStart('Raum ' + code + ' gibt es nicht (mehr).');
        return;
      }
      netErr = 'Verbindung gestört …';
      scheduleSync(3000);
    });
  }

  function onState(st) {
    room = st;
    applyRoomSettings(st.settings);
    if (game.final && !game.finalAck) {
      var mine = myEntry();
      if (mine && mine.final && room.round === game.round) game.finalAck = true;
      if (room.round !== game.round) game.finalAck = true;   // neue Runde: alte Meldung verfaellt
    }
    renderMini();
    if (!$('#result').classList.contains('hidden')) updateResultRank();
  }

  function myEntry() {
    if (!room || !me) return null;
    for (var i = 0; i < room.players.length; i++) if (room.players[i].pid === me.pid) return room.players[i];
    return null;
  }

  // Rangliste: Punkte absteigend, bei Gleichstand weniger Bewegung vorn
  function ranking(st) {
    var list = st.players.filter(function (p) { return p.final || p.live; }).map(function (p) {
      return { p: p, r: p.final || p.live };
    });
    list.sort(function (a, b) { return (b.r.pts - a.r.pts) || (a.r.mov - b.r.mov); });
    return list;
  }

  // wird in jedem Bild aufgerufen
  function gameTick(dt) {
    var ph = localPhase();
    if (room && room.round > 0 && room.round !== game.round && (ph === 'countdown' || ph === 'running')) {
      // neue Runde
      game.round = room.round;
      game.scoring = false; game.final = null; game.finalAck = false;
      hide('#result');
      if (ph === 'countdown') beep(520, 0.06);
    }
    if (ph === 'countdown') {
      M.resetPendulum();
      trail.length = 0;
    } else if (ph === 'running') {
      if (!game.scoring && !game.final && game.round === room.round && ready()) {
        M.resetAnalysis(); M.resetPendulum(); trail.length = 0;
        M.startScore();
        game.scoring = true;
        beep(660, 0.08);
        requestWake();
        scheduleSync(300);
      }
      M.step(dt);
      if (game.scoring) M.accumulate(dt);
    } else {
      M.step(dt);
      if (game.scoring) finishRound();
    }
    if (ph !== game.lastPhase) { game.lastPhase = ph; }
  }

  function finishRound() {
    game.final = M.result(RS.targetFrac);
    game.scoring = false;
    M.stopScore();
    beep(880, 0.16);
    showResult();
    scheduleSync(150);
  }

  /* =================================================================
     6  Hauptschleife und Anzeige
     ================================================================= */

  var trail = [];
  var lastFrame = 0, lastChips = 0;

  function loop(now) {
    requestAnimationFrame(loop);
    var dt = lastFrame ? (now - lastFrame) / 1000 : 1 / 60;
    lastFrame = now;
    if (dt > 0.2) dt = 0.2;
    if (boardMode) { boardTick(now); return; }
    if (!me) return;

    if (ptr.on) pointerStep(dt);
    gameTick(dt);

    trail.push(M.P.x, M.P.y);
    if (trail.length > 240) trail.splice(0, trail.length - 240);
    draw();
    if (now - lastChips > 100) { lastChips = now; updateChips(); }
  }

  function updateChips() {
    var ph = localPhase();
    var tr = sensor.mode === 'motion' || ptr.on;
    var ana = M.ana;

    // Kopfzeile
    var task, clk = '–';
    if (netErr) task = netErr;
    else if (!ready()) task = sensor.mode === 'motion' ? 'Kalibrieren …' : 'Sensoren freigeben';
    else if (ph === 'countdown') task = 'Runde ' + room.round + ' – gleich geht’s los';
    else if (ph === 'running') task = game.scoring ? 'Runde ' + room.round + ' läuft' : 'Runde läuft (ohne dich)';
    else task = 'Freies Üben';
    if (ph === 'countdown') clk = fmt(Math.max(0, (room.startAt - serverNow()) / 1000), 0) + ' s';
    else if (ph === 'running') clk = fmt(Math.max(0, (room.endAt - serverNow()) / 1000), 0) + ' s';
    $('#task').textContent = task;
    $('#clock').textContent = clk;

    var res = game.scoring ? M.result(RS.targetFrac) : game.final;
    if (game.scoring) {
      // waehrend der Runde: Wirkungsgrad ueber die bisherige Runde
      $('#r-lab').textContent = 'Wirkungsgrad dieser Runde';
      var w = res.ratio;
      $('#r-gain').textContent = res.t > 2 && w > 0.3 ? '×' + fmt(w, w < 10 ? 1 : 0) : '–';
      $('#r-fill').style.width = clamp(100 * w / RS.Q, 0, 100).toFixed(1) + '%';
      $('#r-fill').className = '';
      $('#r-note').textContent = res.reach >= 1 ? 'Zielmarke erreicht ✓'
        : 'Zielmarke ' + fmt(100 * res.reach, 0) + ' %';
    } else {
      $('#r-lab').textContent = 'Ausschlag ÷ Handbewegung';
      var g = ana.gain, ok = g > 0.3;
      $('#r-gain').textContent = ok ? '×' + fmt(g, g < 10 ? 1 : 0) : '–';
      $('#r-fill').style.width = clamp(100 * g / RS.Q, 0, 100).toFixed(1) + '%';
      $('#r-fill').className = (ok && ana.qRes < 0.75) ? 'off' : '';
      $('#r-note').textContent = !ok ? 'Ausbeute –'
        : 'Ausbeute ' + fmt(clamp(100 * g / RS.Q, 0, 100), 0) + ' %' + resHint();
    }
    $('#r-max').textContent = 'max. ×' + RS.Q;

    $('#m-pts').textContent = res ? String(res.pts) : '–';
    $('#m-trans').textContent = tr ? fmt(ana.ampTrans * 1000, 2) + ' mm' : '–';
    $('#m-amp').textContent = fmt(100 * M.ampTot() / M.XMAX, 0) + ' %';
    var rk = myRank();
    $('#m-rank').innerHTML = rk ? rk.pos + '<small>/' + rk.of + '</small>' : '–';
  }

  function resHint() {
    var ana = M.ana;
    if (ana.qRes >= 0.9) return ' · im Takt';
    var df = ana.fDrive - 1 / M.TPER;
    if (Math.abs(df) < 0.01) return '';
    return df > 0 ? ' · zu schnell' : ' · zu langsam';
  }

  function myRank() {
    if (!room || !me || room.round === 0) return null;
    var list = ranking(room);
    for (var i = 0; i < list.length; i++) if (list[i].p.pid === me.pid) return { pos: i + 1, of: list.length };
    return null;
  }

  function renderMini() {
    var el = $('#mini');
    if (!room) { el.innerHTML = ''; return; }
    var nAct = room.players.filter(function (p) { return p.active; }).length;
    var list = ranking(room);
    if (room.round === 0 || !list.length) {
      el.innerHTML = '<div class="info">' + nAct + (nAct === 1 ? ' Telefon' : ' Telefone')
        + ' im Raum · warten auf den Start der Runde</div>';
      return;
    }
    var rows = [], mePos = -1;
    for (var i = 0; i < list.length; i++) if (me && list[i].p.pid === me.pid) mePos = i;
    for (var j = 0; j < Math.min(3, list.length); j++) rows.push(j);
    if (mePos >= 3) rows.push(mePos);
    el.innerHTML = rows.map(function (i) {
      var e = list[i];
      return '<div class="ml' + (i === mePos ? ' me' : '') + '"><span class="r">' + (i + 1) + '.</span>'
        + '<span class="n">' + esc(e.p.nick) + '</span><span class="p">' + e.r.pts + ' P · ×'
        + fmt(e.r.ratio, 1) + '</span></div>';
    }).join('') + '<div class="info">Runde ' + room.round + (room.phase === 'done' ? ' (beendet)' : '') + '</div>';
  }

  /* --- Zeichnen ---------------------------------------------------- */

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
    var sc = R / M.XMAX;
    var P = M.P;
    var ph = localPhase();

    ctx.clearRect(0, 0, w, h);
    var bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.7);
    bg.addColorStop(0, '#131c27'); bg.addColorStop(1, '#0b0f14');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);

    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,.10)';
    line(cx - R, cy, cx + R, cy);
    line(cx, cy - R, cx, cy + R);
    circle(cx, cy, R); ctx.stroke();

    // Zielmarke
    ctx.save();
    ctx.setLineDash([5, 6]);
    ctx.strokeStyle = (game.scoring && M.score && M.score.peak >= RS.targetFrac * M.XMAX)
      ? 'rgba(79,209,197,.8)' : 'rgba(240,180,41,.55)';
    circle(cx, cy, R * RS.targetFrac); ctx.stroke();
    ctx.restore();

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
    ctx.strokeStyle = 'rgba(255,255,255,.13)'; ctx.lineWidth = 1;
    line(cx, cy, px, py);
    ctx.fillStyle = 'rgba(255,255,255,.25)';
    circle(cx, cy, 2.5); ctx.fill();

    // Telefonbewegung (ueberhoeht)
    if (PREF.indicator && (sensor.mode === 'motion' || ptr.on)) {
      var ix = cx + M.ana.recon[0] * PREF.exaggerate * sc;
      var iy = cy - M.ana.recon[1] * PREF.exaggerate * sc;
      ctx.strokeStyle = 'rgba(240,180,41,.75)'; ctx.lineWidth = 1.5;
      circle(ix, iy, 6); ctx.stroke();
      line(ix - 9, iy, ix + 9, iy); line(ix, iy - 9, ix, iy + 9);
      ctx.fillStyle = 'rgba(240,180,41,.75)';
      ctx.font = '10px -apple-system,system-ui,sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('Telefon ×' + PREF.exaggerate, ix, iy + 18);
    }

    // Scheibe
    ctx.save();
    ctx.beginPath(); ctx.ellipse(px, py + discR * 0.45, discR * 0.92, discR * 0.3, 0, 0, 7);
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fill();
    ctx.restore();
    var gr = ctx.createRadialGradient(px - discR * .35, py - discR * .4, discR * .1, px, py, discR);
    gr.addColorStop(0, '#bff5ef'); gr.addColorStop(.45, '#4fd1c5'); gr.addColorStop(1, '#127a72');
    ctx.fillStyle = gr; circle(px, py, discR); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1.2;
    circle(px, py, discR); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.18)';
    circle(px, py, discR * 0.62); ctx.stroke();

    // Restzeit als Ring
    if (ph === 'running' && game.scoring) {
      var f = clamp((room.endAt - serverNow()) / (room.endAt - room.startAt), 0, 1);
      ctx.strokeStyle = 'rgba(240,180,41,.9)'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(cx, cy, R + 7, -Math.PI / 2, -Math.PI / 2 + f * 2 * Math.PI);
      ctx.stroke();
    }

    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (ph === 'countdown') {
      var num = Math.ceil((room.startAt - serverNow()) / 1000);
      ctx.fillStyle = 'rgba(240,180,41,.95)';
      ctx.font = '700 ' + Math.round(R * 0.6) + 'px -apple-system,system-ui,sans-serif';
      ctx.fillText(String(Math.max(1, num)), cx, cy);
      ctx.font = '600 14px -apple-system,system-ui,sans-serif';
      ctx.fillText(ready() ? 'Telefon ruhig halten' : 'Erst kalibrieren!', cx, cy + R * 0.45);
    } else if (ph !== 'running' && ready()) {
      ctx.fillStyle = 'rgba(139,155,176,.55)';
      ctx.font = '13px -apple-system,system-ui,sans-serif';
      ctx.fillText('Freies Üben – die Runde startet die Spielleitung', cx, h - 8);
    }
  }
  function line(x1, y1, x2, y2) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
  function circle(x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); }

  /* =================================================================
     7  Ton, Wake-Lock
     ================================================================= */

  var actx = null, wake = null;
  function beep(f, d) {
    if (!PREF.sound) return;
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
      if (navigator.wakeLock && !wake) navigator.wakeLock.request('screen').then(function (w) {
        wake = w;
        w.addEventListener('release', function () { wake = null; });
      }, function () { });
    } catch (e) { }
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && me) { requestWake(); scheduleSync(50); }
  });

  /* =================================================================
     8  Start, Beitritt, Sensorfreigabe, Kalibrierung
     ================================================================= */

  var params = new URLSearchParams(location.search);
  var boardMode = false;

  function baseUrl() { return location.origin + location.pathname.replace(/index\.html$/, ''); }

  function backToStart(msg) {
    clearTimeout(syncTimer);
    me = null; room = null;
    hide('#intro'); hide('#calib'); hide('#result');
    show('#start');
    $('#join-msg').textContent = msg || '';
  }

  // Einstellungsfelder aus der Vorlage bauen (Startseite und Tafel)
  function buildSettings(container, init) {
    container.appendChild($('#tpl-settings').content.cloneNode(true));
    var vals = {};
    for (var k in DEF_ROOM) vals[k] = (init && typeof init[k] === 'number') ? init[k] : DEF_ROOM[k];
    function refresh() {
      container.querySelector('[data-v=duration]').textContent = vals.duration + ' s';
      container.querySelector('[data-v=Q]').textContent = vals.Q;
      var om = Math.sqrt(G / vals.L);
      container.querySelector('[data-v=Qnote]').textContent = 'höchstens ×' + vals.Q
        + ' Verstärkung, Aufbauzeit ' + fmt(2 * vals.Q / om, 0) + ' s';
      container.querySelector('[data-v=targetFrac]').textContent = fmt(100 * vals.targetFrac, 0)
        + ' % vom Vollausschlag';
    }
    Array.prototype.forEach.call(container.querySelectorAll('[data-s]'), function (inp) {
      var key = inp.getAttribute('data-s');
      inp.value = vals[key];
      inp.addEventListener('input', function () { vals[key] = parseFloat(inp.value); refresh(); });
    });
    refresh();
    return {
      get: function () { return { duration: vals.duration, Q: vals.Q, targetFrac: vals.targetFrac, L: vals.L }; },
      set: function (s) {
        for (var k in vals) if (s && typeof s[k] === 'number') vals[k] = s[k];
        Array.prototype.forEach.call(container.querySelectorAll('[data-s]'), function (inp) {
          inp.value = vals[inp.getAttribute('data-s')];
        });
        refresh();
      }
    };
  }

  var hostSettings = buildSettings($('#host-settings'), lsGet('idmo.lastSettings'));

  $('#btn-create').addEventListener('click', function () {
    var btn = this;
    var s = hostSettings.get();
    s.title = $('#in-title').value.trim();
    lsSet('idmo.lastSettings', s);
    btn.disabled = true;
    $('#host-msg').textContent = 'Lege Raum an …';
    api({ action: 'create', settings: s }).then(function (r) {
      lsSet('idmo.host.' + r.room, r.hostKey);
      location.href = '?r=' + r.room + '&tafel=1';
    }, function (err) {
      btn.disabled = false;
      $('#host-msg').textContent = 'Fehler: ' + err.message;
    });
  });

  $('#in-code').addEventListener('input', function () {
    this.value = this.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  });

  $('#btn-join').addEventListener('click', function () {
    var c = $('#in-code').value.trim().toUpperCase();
    var nick = $('#in-nick').value.trim();
    if (!/^[A-Z2-9]{4}$/.test(c)) { $('#join-msg').textContent = 'Der Raumcode hat vier Zeichen.'; return; }
    if (!nick) { $('#join-msg').textContent = 'Bitte einen Namen eingeben.'; return; }
    lsSet('idmo.nick', nick);
    var btn = this;
    btn.disabled = true;
    $('#join-msg').textContent = 'Trete bei …';
    api({ action: 'join', room: c, nick: nick }).then(function (r) {
      btn.disabled = false;
      lsSet('idmo.player.' + c, r);
      enterRoom(c, r);
    }, function (err) {
      btn.disabled = false;
      $('#join-msg').textContent = err.status === 404 ? 'Diesen Raum gibt es nicht.' : 'Fehler: ' + err.message;
    });
  });

  function enterRoom(c, session) {
    code = c; me = session;
    try { history.replaceState(null, '', '?r=' + c); } catch (e) { }
    $('#room-chip').textContent = c;
    $('#intro-nick').textContent = session.nick;
    hide('#start');
    if (!ready()) show('#intro');
    scheduleSync(0);
  }

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
        if (r.some(function (x) { return x !== 'granted'; })) {
          st.textContent = 'Berechtigung abgelehnt. Seite neu laden und erneut versuchen.'; return;
        }
        attachSensors(st);
      }).catch(function (err) { st.textContent = 'Fehler: ' + err; });
    } else attachSensors(st);
    beep(440, 0.04);   // erzeugt zugleich den Audio-Kontext per Nutzergeste
    requestWake();
  });

  function attachSensors(st) {
    window.addEventListener('devicemotion', onMotion);
    window.addEventListener('deviceorientation', onOrient);
    sensor.mode = 'motion';
    st.textContent = 'Warte auf Sensordaten …';
    setTimeout(function () {
      if (!sensor.hasMotion) {
        st.textContent = 'Keine Sensordaten. Dieses Gerät hat offenbar keinen Bewegungssensor '
          + '– zum Ausprobieren den Knopf darunter nehmen.';
        sensor.mode = 'none';
        return;
      }
      hide('#intro');
      startCalibration();
    }, 1600);
  }

  $('#btn-nosensor').addEventListener('click', function () {
    sensor.mode = 'pointer';
    ptr.on = true;
    hide('#intro');
    beep(440, 0.04);
    scheduleSync(0);
  });

  var calTimer = null;
  function startCalibration() {
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
        if (!finishCal()) { $('#calib-hint').textContent = cal.quality + ' Bitte Seite neu laden.'; return; }
        hide('#calib');
        if (cal.quality) $('#task').textContent = cal.quality;
        scheduleSync(0);
      }
    }, 100);
  }
  $('#btn-calib-cancel').addEventListener('click', function () {
    clearInterval(calTimer); cal.active = false; hide('#calib');
    if (!cal.done) show('#intro');
  });
  $('#btn-recal').addEventListener('click', function () {
    if (sensor.mode === 'motion') startCalibration();
    else if (!ptr.on) show('#intro');
  });
  $('#btn-leave').addEventListener('click', function () {
    if (game.scoring && !confirm('Die Runde läuft noch. Trotzdem verlassen?')) return;
    lsDel('idmo.player.' + code);
    location.href = location.pathname;
  });

  // Zeigermodus ------------------------------------------------------
  var stage = $('#stage');
  function ptrPos(e) {
    var r = cv.getBoundingClientRect();
    var t = e.touches ? e.touches[0] : e;
    return [(t.clientX - r.left - r.width / 2) * ptr.mPerPx, -(t.clientY - r.top - r.height / 2) * ptr.mPerPx];
  }
  function pDown(e) { if (!ptr.on) return; ptr.down = true; var p = ptrPos(e); ptr.px = p[0]; ptr.py = p[1]; e.preventDefault(); }
  function pMove(e) { if (!ptr.on || !ptr.down) return; var p = ptrPos(e); ptr.px = p[0]; ptr.py = p[1]; e.preventDefault(); }
  function pUp() { if (!ptr.on) return; ptr.down = false; ptr.px = 0; ptr.py = 0; }
  stage.addEventListener('mousedown', pDown); window.addEventListener('mousemove', pMove); window.addEventListener('mouseup', pUp);
  stage.addEventListener('touchstart', pDown, { passive: false });
  stage.addEventListener('touchmove', pMove, { passive: false });
  stage.addEventListener('touchend', pUp);

  /* =================================================================
     9  Rundenergebnis auf dem Telefon
     ================================================================= */

  function showResult() {
    var r = game.final;
    if (!r) return;
    $('#res-title').textContent = 'Runde ' + game.round + ' beendet';
    updateResultRank();
    var target = RS.targetFrac * M.XMAX * 1000;
    var rows = [
      ['<b>Punkte</b>', r.pts + ' von 1000', 1],
      ['<b>Wirkungsgrad</b>', '×' + fmt(r.ratio, 1) + '  (möglich ×' + RS.Q + ')', 1],
      ['Mittlere Bewegung', fmt(r.mov, 2) + ' mm', 0],
      ['&nbsp;&nbsp;davon Verschieben', fmt(r.trans, 2) + ' mm', 0],
      ['&nbsp;&nbsp;Kippen', fmt(r.tilt, 2) + '°', 0],
      ['Größter Ausschlag', fmt(r.peak, 0) + ' mm', 0],
      ['&nbsp;&nbsp;Zielmarke', fmt(target, 0) + ' mm – ' + (r.reach >= 1 ? 'erreicht' : fmt(100 * r.reach, 0) + ' %'), 0],
      ['Takttreue', fmt(100 * r.sync, 0) + ' %', 0],
      ['Gewertete Zeit', fmt(r.t, 0) + ' s', 0]
    ];
    if (ptr.on) rows.push(['Quelle', 'ohne Sensor (Finger/Maus)', 0]);
    $('#res-tab').innerHTML = rows.map(function (x) {
      return '<tr><td>' + x[0] + '</td><td' + (x[2] ? ' class="hl"' : '') + '>' + x[1] + '</td></tr>';
    }).join('');

    var txt;
    if (r.t < 3) txt = 'Zu kurz gemessen – war das Telefon zum Start kalibriert?';
    else if (r.reach < 1) {
      txt = 'Die Scheibe hat die Zielmarke nicht erreicht, deshalb gab es nur '
        + fmt(100 * r.reach, 0) + ' % der Punkte. Etwas mehr Bewegung – aber genau im Takt des Pendels – hätte gereicht.';
    } else if (r.ratio / RS.Q >= 0.85) {
      txt = 'Nahezu das physikalisch Mögliche: Aus 1 mm Bewegung wurden im Mittel '
        + fmt(r.ratio, 0) + ' mm Ausschlag. Mehr als ×' + RS.Q + ' lässt die Güte des Pendels nicht zu.';
    } else if (r.sync < 0.75) {
      txt = 'Der Rhythmus lag neben der Eigenfrequenz des Pendels (Takttreue ' + fmt(100 * r.sync, 0)
        + ' %). Im genauen Takt erzeugt dieselbe Bewegung deutlich mehr Ausschlag.';
    } else {
      txt = 'Der Takt saß. Mehr Wirkungsgrad bringt es, früh kräftig im Takt anzuschwingen und dann '
        + 'ruhig zu halten: Das Ausschwingen kostet keine Bewegung mehr.';
    }
    $('#res-interp').textContent = txt;
    show('#result');
  }

  function updateResultRank() {
    var r = game.final;
    if (!r) return;
    var rk = (room && room.round === game.round) ? myRank() : null;
    $('#res-lead').innerHTML = (rk ? 'Platz <b>' + rk.pos + '</b> von ' + rk.of + ' · ' : '')
      + '<b>' + r.pts + '</b> Punkte';
  }
  $('#btn-res-close').addEventListener('click', function () { hide('#result'); });

  /* =================================================================
     10  Anzeigetafel (Beamer, Spielleitung)
     ================================================================= */

  var hostKey = null, boardSettings = null, boardTimer = null, lastBoardDraw = 0;

  function startBoard(c) {
    boardMode = true;
    code = c;
    hostKey = lsGet('idmo.host.' + c);
    hide('#start'); hide('#app'); show('#board');
    $('#b-code').textContent = c;
    $('#b-url').textContent = baseUrl().replace(/^https?:\/\//, '') + '?r=' + c;
    $('#b-qr').innerHTML = qrSvg(baseUrl() + '?r=' + c);
    $('#b-qr').addEventListener('click', function () { this.classList.toggle('big'); });
    if (hostKey) {
      show('#b-host');
      boardSettings = buildSettings($('#b-settings'), null);
    }
    boardSync();
  }

  // QR-Code als SVG (dunkle Module auf weissem Grund, 4 Module Ruhezone)
  function qrSvg(text) {
    if (typeof qrcode !== 'function') return '';
    var qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    var n = qr.getModuleCount(), q = 4, d = '';
    for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) {
      if (qr.isDark(y, x)) d += 'M' + (x + q) + ' ' + (y + q) + 'h1v1h-1z';
    }
    var s = n + 2 * q;
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + s + ' ' + s
      + '" shape-rendering="crispEdges"><rect width="' + s + '" height="' + s + '" fill="#fff"/>'
      + '<path d="' + d + '" fill="#000"/></svg>';
  }

  function boardSync() {
    clearTimeout(boardTimer);
    api({ action: 'sync', room: code }).then(function (st) {
      netErr = '';
      if (!room && boardSettings) boardSettings.set(st.settings);
      room = st;
      applyRoomSettings(st.settings);
      renderBoard();
      boardTimer = setTimeout(boardSync, 1000);
    }, function (err) {
      if (err.status === 404) { $('#b-phase').textContent = 'Raum ' + code + ' gibt es nicht (mehr).'; return; }
      netErr = 'Verbindung gestört …';
      boardTimer = setTimeout(boardSync, 3000);
    });
  }

  function hostAction(action, extra) {
    var body = { action: action, room: code, hostKey: hostKey };
    for (var k in extra) body[k] = extra[k];
    return api(body).then(function (st) { room = st; renderBoard(); }, function (err) { alert(err.message); });
  }

  $('#b-start').addEventListener('click', function () {
    hostAction('start', { settings: boardSettings.get() });
    hide('#b-settings');
  });
  $('#b-stop').addEventListener('click', function () {
    if (confirm('Runde jetzt beenden? Gewertet wird der Stand bis jetzt.')) hostAction('stop', {});
  });
  $('#b-set-toggle').addEventListener('click', function () { $('#b-settings').classList.toggle('hidden'); });
  $('#b-tab').addEventListener('click', function (e) {
    var b = e.target.closest('button.kick');
    if (b && confirm('„' + b.getAttribute('data-nick') + '“ aus dem Raum entfernen?')) {
      hostAction('kick', { pid: b.getAttribute('data-pid') });
    }
  });
  $('#b-csv').addEventListener('click', function () {
    if (!room) return;
    var head = 'raum;runde;platz;name;punkte;wirkungsgrad;mittlere_bewegung_mm;kippen_grad;'
      + 'groesster_ausschlag_mm;anteil_zielmarke;takttreue;gewertete_zeit_s;endwert;quelle;'
      + 'Q;L_m;dauer_s;zielmarke';
    var s = room.settings;
    var lines = ranking(room).map(function (e, i) {
      var r = e.r;
      return [room.room, room.round, i + 1, '"' + e.p.nick.replace(/"/g, '""') + '"', r.pts,
        fmt(r.ratio, 2), fmt(r.mov, 3), fmt(r.tilt, 3), fmt(r.peak, 1), fmt(r.reach, 3),
        fmt(r.sync, 3), fmt(r.t, 1), e.p.final ? 1 : 0, e.p.src, s.Q, s.L, s.duration, s.targetFrac].join(';');
    });
    openDump([head].concat(lines).join('\n'), 'pendel_raum_' + room.room + '_runde_' + room.round + '.csv');
  });

  // Uhr und Fortschrittsbalken laufen fluessig zwischen den Abfragen
  function boardTick(now) {
    if (!room || now - lastBoardDraw < 200) return;
    lastBoardDraw = now;
    var ph = localPhase(), t = serverNow(), clk = '', fill = 0;
    if (ph === 'countdown') { clk = fmt(Math.max(0, (room.startAt - t) / 1000), 0); fill = 0; }
    else if (ph === 'running') {
      clk = fmt(Math.max(0, (room.endAt - t) / 1000), 0) + ' s';
      fill = clamp((t - room.startAt) / (room.endAt - room.startAt), 0, 1);
    } else if (ph === 'done') fill = 1;
    $('#b-clock').textContent = clk;
    $('#b-fill').style.width = (100 * fill).toFixed(1) + '%';
    var nAct = room.players.filter(function (p) { return p.active; }).length;
    var nReady = room.players.filter(function (p) { return p.active && p.ready; }).length;
    var txt = netErr || (ph === 'lobby' ? 'Warten auf den Start · ' + nAct + ' im Raum, ' + nReady + ' bereit'
      : ph === 'countdown' ? 'Runde ' + room.round + ' beginnt …'
        : ph === 'running' ? 'Runde ' + room.round + ' läuft'
          : 'Runde ' + room.round + ' beendet · ' + nAct + ' im Raum, ' + nReady + ' bereit');
    $('#b-phase').textContent = txt;
    if (hostKey) {
      var busy = ph === 'running' || ph === 'countdown';
      $('#b-start').classList.toggle('hidden', busy);
      $('#b-stop').classList.toggle('hidden', !busy);
      $('#b-start').textContent = room.round ? 'Nächste Runde starten' : 'Runde starten';
    }
  }

  function renderBoard() {
    if (!room) return;
    var s = room.settings;
    $('#b-title').textContent = s.title || 'Ideomotor-Pendel';
    var list = ranking(room);
    var ranked = {};
    list.forEach(function (e) { ranked[e.p.pid] = true; });
    var rest = room.players.filter(function (p) { return !ranked[p.pid]; });
    var head = '<tr><th>#</th><th>Name</th><th>Punkte</th><th>Wirkungsgrad</th>'
      + '<th>Bewegung</th><th>Ausschlag</th><th>Ziel</th><th>Takt</th></tr>';
    var rows = list.map(function (e, i) {
      var r = e.r, p = e.p;
      return '<tr class="' + (i === 0 ? 'top1' : '') + (p.active ? '' : ' gone') + '"><td>' + (i + 1) + '.</td>'
        + '<td>' + esc(p.nick) + tagsFor(p) + '</td>'
        + '<td class="pts">' + r.pts + '</td>'
        + '<td>×' + fmt(r.ratio, 1) + '</td>'
        + '<td>' + fmt(r.mov, 2) + ' mm</td>'
        + '<td>' + fmt(r.peak, 0) + ' mm</td>'
        + '<td>' + (r.reach >= 1 ? '✓' : fmt(100 * r.reach, 0) + ' %') + '</td>'
        + '<td>' + fmt(100 * r.sync, 0) + ' %</td></tr>';
    });
    rest.forEach(function (p) {
      rows.push('<tr class="' + (p.active ? '' : 'gone') + '"><td></td><td>' + esc(p.nick) + tagsFor(p)
        + '</td><td colspan="6" class="st">' + (p.ready ? 'bereit' : (p.active ? 'kalibriert noch' : 'nicht verbunden'))
        + '</td></tr>');
    });
    $('#b-tab').innerHTML = room.players.length ? head + rows.join('')
      : '<tr><td class="st">Noch niemand im Raum. Telefone öffnen die Adresse oben und geben den Code ein.</td></tr>';
    $('#b-foot').textContent = 'Güte Q = ' + s.Q + ' · Pendellänge ' + fmt(s.L, 2) + ' m (Periode '
      + fmt(2 * Math.PI * Math.sqrt(s.L / G), 2) + ' s) · Rundendauer ' + s.duration + ' s · Zielmarke '
      + fmt(100 * s.targetFrac, 0) + ' % vom Vollausschlag';
    lastBoardDraw = 0;
  }

  function tagsFor(p) {
    var t = '';
    if (p.src === 'pointer') t += ' <span class="st">(ohne Sensor)</span>';
    if (room.phase === 'done' && p.live && !p.final) t += ' <span class="st">(vorläufig)</span>';
    if (hostKey) t += '<button class="kick ghost" data-pid="' + esc(p.pid) + '" data-nick="' + esc(p.nick) + '">×</button>';
    return t;
  }

  /* --- Export ------------------------------------------------------ */

  function openDump(text, filename) {
    $('#dump-txt').value = text;
    $('#btn-dump-dl').onclick = function () { download(text, filename); };
    show('#dump');
  }
  $('#btn-dump-close').addEventListener('click', function () { hide('#dump'); });
  function download(text, filename) {
    try {
      var b = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' });
      var u = URL.createObjectURL(b);
      var a = document.createElement('a');
      a.href = u; a.download = filename; document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(u); a.remove(); }, 1500);
    } catch (e) { alert('Download nicht möglich – bitte Text kopieren.'); }
  }

  /* =================================================================
     11  Start
     ================================================================= */

  document.addEventListener('gesturestart', function (e) { e.preventDefault(); });

  var urlCode = (params.get('r') || '').toUpperCase();
  if (/^[A-Z2-9]{4}$/.test(urlCode) && params.get('tafel')) {
    startBoard(urlCode);
  } else {
    $('#in-nick').value = lsGet('idmo.nick') || '';
    if (/^[A-Z2-9]{4}$/.test(urlCode)) {
      $('#in-code').value = urlCode;
      var sess = lsGet('idmo.player.' + urlCode);
      if (sess && sess.pid && sess.token) enterRoom(urlCode, sess);
    }
  }

  resize();
  requestAnimationFrame(loop);

})();
