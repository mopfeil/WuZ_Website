/* =====================================================================
   Ideomotor-Pendel online  -  Physik und Auswertung (ohne DOM)
   ---------------------------------------------------------------------
   Pendel und Lock-in-Auswertung sind unveraendert aus der Einzelfassung
   (apps/ideomotor/app.js) uebernommen; siehe dort und README fuer das
   Modell.  Neu ist nur die Wertung fuer den Wettbewerb (Abschnitt 4).
   ===================================================================== */

'use strict';
var IdmPhysik = (function () {

  var G = 9.80665, D2R = Math.PI / 180, R2D = 180 / Math.PI;
  var TAU_LI = 1.2;       // Zeitkonstante der Lock-in-Tiefpaesse [s]
  var DRV_MIN = 1.2e-4;   // darunter ist Ausschlag/Antrieb reines Rauschen (0,12 mm)

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
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

  function create(params) {
    var S = { L: 0.5, Q: 30, thetaMaxDeg: 12, gain: 1 };
    var M = { S: S, OM: 0, W2: 0, GAM: 0, TPER: 0, XMAX: 0 };

    M.setParams = function (p) {
      for (var k in p) if (k in S && typeof p[k] === 'number' && isFinite(p[k])) S[k] = p[k];
      M.OM = Math.sqrt(G / S.L);
      M.W2 = M.OM * M.OM;
      M.GAM = M.OM / (2 * S.Q);
      M.TPER = 2 * Math.PI / M.OM;
      M.XMAX = S.L * Math.sin(S.thetaMaxDeg * D2R);
    };
    M.setParams(params || {});

    /* --- 1  Pendel ------------------------------------------------- */

    var P = M.P = { x: 0, y: 0, vx: 0, vy: 0 };

    M.resetPendulum = function () { P.x = P.y = P.vx = P.vy = 0; };

    function stepOnce(h, drive) {
      var ax = -M.W2 * P.x - 2 * M.GAM * P.vx - S.gain * drive[0];
      var ay = -M.W2 * P.y - 2 * M.GAM * P.vy - S.gain * drive[1];
      P.vx += ax * h; P.x += P.vx * h;
      P.vy += ay * h; P.y += P.vy * h;
      // weiche Begrenzung am Bildrand
      var r = Math.hypot(P.x, P.y), rm = M.XMAX * 1.02;
      if (r > rm) {
        var f = rm / r;
        P.x *= f; P.y *= f;
        var vr = (P.vx * P.x + P.vy * P.y) / (r * r + 1e-12);
        if (vr > 0) { P.vx -= vr * P.x; P.vy -= vr * P.y; }
      }
    }
    M.step = function (dt) {
      var n = Math.max(1, Math.ceil(dt / 0.004)), h = dt / n;
      for (var i = 0; i < n; i++) stepOnce(h, ana.drive);
    };

    M.ampX = function () { return Math.hypot(P.x, P.vx / M.OM); };
    M.ampY = function () { return Math.hypot(P.y, P.vy / M.OM); };
    M.ampTot = function () { return Math.hypot(M.ampX(), M.ampY()); };

    /* --- 2  Lock-in-Auswertung ------------------------------------- */

    var ana = M.ana = {
      t: 0,
      drive: [0, 0], trans: [0, 0], tiltR: [0, 0],
      li: { trans: mkLI(), tilt: mkLI(), drv: mkLI(), bob: mkLI() },
      ampTrans: 0, ampTilt: 0, ampDrive: 0, recon: [0, 0], tiltEq: 0,
      wEff: 0, gain: 0, psi: 0, qRes: 0, phiPrev: null, dPhi: 0, fDrive: 0
    };

    M.resetAnalysis = function () {
      ana.li.trans = mkLI(); ana.li.tilt = mkLI(); ana.li.drv = mkLI(); ana.li.bob = mkLI();
      ana.ampTrans = ana.ampTilt = ana.ampDrive = ana.tiltEq = 0;
      ana.gain = ana.psi = ana.qRes = ana.dPhi = 0;
      ana.wEff = M.OM;
      ana.phiPrev = null; ana.fDrive = 0;
    };
    M.resetAnalysis();

    // drive = spezifische Kraft (Bildschirmrahmen, driftfrei), trans = translatorischer
    // Anteil [m/s^2], tilt = Neigung [rad], alles schon in Bildschirmkoordinaten.
    M.sample = function (dt, drive, trans, tilt) {
      ana.drive[0] = drive[0]; ana.drive[1] = drive[1];
      ana.trans[0] = trans[0]; ana.trans[1] = trans[1];
      ana.tiltR[0] = tilt[0]; ana.tiltR[1] = tilt[1];

      ana.t += dt;
      var OM = M.OM;
      var c = Math.cos(OM * ana.t), sn = Math.sin(OM * ana.t);
      var k = dt / (TAU_LI + dt);

      var aT = pushLI(ana.li.trans, ana.trans[0], ana.trans[1], c, sn, k);
      var aD = pushLI(ana.li.drv, ana.drive[0], ana.drive[1], c, sn, k);
      pushLI(ana.li.tilt, ana.tiltR[0], ana.tiltR[1], c, sn, k);

      // Beschleunigung -> Weg mit dem tatsaechlichen Takt der Hand
      ana.wEff = clamp(OM + ana.dPhi, 0.4 * OM, 2.5 * OM);
      var we2 = ana.wEff * ana.wEff;
      ana.ampTrans = aT / we2;
      ana.ampDrive = aD / we2;
      ana.ampTilt = Math.hypot(ana.li.tilt.A[0], ana.li.tilt.A[1]);
      ana.tiltEq = G * ana.ampTilt / we2;
      var rawDrive = ana.ampDrive;

      var li = ana.li.trans;
      ana.recon[0] = -2 * (li.I[0] * c + li.Q[0] * sn) / we2;
      ana.recon[1] = -2 * (li.I[1] * c + li.Q[1] * sn) / we2;

      // Phasenlage Scheibe gegen Antrieb -> Takttreue |sin psi|
      var bob = ana.li.bob, drv = ana.li.drv;
      pushLI(bob, P.x, P.y, c, sn, k);

      if (rawDrive > DRV_MIN && M.ampTot() > 1e-4) {
        var re = 0, im = 0;
        for (var j = 0; j < 2; j++) {
          re += bob.I[j] * drv.I[j] + bob.Q[j] * drv.Q[j];
          im += bob.I[j] * drv.Q[j] - bob.Q[j] * drv.I[j];
        }
        ana.psi = Math.atan2(im, re);
        ana.qRes = Math.abs(Math.sin(ana.psi));

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

      var corr = clamp(Math.sqrt(1 + Math.pow(ana.dPhi * TAU_LI, 2)), 1, 3);
      ana.ampTrans *= corr; ana.ampDrive *= corr;
      ana.ampTilt *= corr; ana.tiltEq *= corr;
      ana.recon[0] *= corr; ana.recon[1] *= corr;

      ana.gain = ana.ampDrive > DRV_MIN ? M.ampTot() / ana.ampDrive : 0;
    };

    /* --- 3  Wertung fuer den Wettbewerb ----------------------------

       Gewertet wird das Verhaeltnis der ZEITINTEGRALE ueber die ganze Runde:

            Wirkungsgrad  W = Integral(Ausschlag dt) / Integral(Antrieb dt)

       "Antrieb" ist die gesamte Bewegung als gleichwertiger Weg (Verschieben
       plus Kippen).  Fuer die Huellkurve A des getriebenen Pendels gilt
       tau*dA/dt <= Q*d - A  (tau = 2Q/omega), integriert also
       Integral(A) <= Q*Integral(d) - tau*A_Ende.  W kann Q daher nicht
       ueberschreiten - auch nicht mit dem Trick, erst kraeftig anzuschwingen
       und dann still zu halten, denn das Ausschwingen hat die Bewegung
       vorher schon "bezahlt".  Ein Augenblicksverhaeltnis waere genau dabei
       beliebig gross geworden.

       Damit Stillhalten allein nichts bringt, zaehlt der Ausschlag mit:
       Erst wenn die Scheibe einmal die Zielmarke erreicht hat, gibt es die
       volle Punktzahl.

            Punkte = 1000 * min(1, W/Q) * min(1, Spitzenausschlag/Zielmarke)
       ------------------------------------------------------------------ */

    var sc = M.score = null;

    M.startScore = function () {
      sc = M.score = { t: 0, intA: 0, intD: 0, intTr: 0, intTi: 0, peak: 0, syncW: 0, syncT: 0 };
    };
    M.stopScore = function () { sc = M.score = null; };

    // nach jedem Pendelschritt mit derselben Zeitspanne aufrufen
    M.accumulate = function (dt) {
      if (!sc) return;
      var a = M.ampTot();
      sc.t += dt;
      sc.intA += a * dt;
      sc.intD += ana.ampDrive * dt;
      sc.intTr += ana.ampTrans * dt;
      sc.intTi += ana.ampTilt * dt;
      if (a > sc.peak) sc.peak = a;
      if (ana.ampDrive > DRV_MIN && ana.gain > 0) { sc.syncW += ana.qRes * dt; sc.syncT += dt; }
    };

    M.result = function (targetFrac) {
      var r = sc || { t: 0, intA: 0, intD: 0, intTr: 0, intTi: 0, peak: 0, syncW: 0, syncT: 0 };
      var target = targetFrac * M.XMAX;
      var ratio = r.intD > 1e-9 ? r.intA / r.intD : 0;
      var reach = target > 0 ? clamp(r.peak / target, 0, 1) : 0;
      var T = r.t > 0 ? r.t : 1;
      return {
        pts: Math.round(1000 * clamp(ratio / S.Q, 0, 1) * reach),
        ratio: ratio,                         // Wirkungsgrad W
        mov: 1000 * r.intD / T,               // mittlere Bewegung (gleichwertiger Weg) [mm]
        trans: 1000 * r.intTr / T,            // davon Verschieben [mm]
        tilt: R2D * r.intTi / T,              // mittleres Kippen [Grad]
        peak: 1000 * r.peak,                  // groesster Ausschlag [mm]
        amp: 1000 * M.ampTot(),               // momentaner Ausschlag [mm]
        reach: reach,
        sync: r.syncT > 0 ? r.syncW / r.syncT : 0,
        t: r.t
      };
    };

    return M;
  }

  return { create: create, G: G, D2R: D2R, R2D: R2D, DRV_MIN: DRV_MIN, clamp: clamp };
})();
