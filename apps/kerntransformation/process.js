/* Kerntransformation – Prozessmodell (reine Logik, kein DOM).
   Quelle der Schritte und Stolpersteine: .claude/skills/core-transformation/SKILL.md
   Exportiert window.KT mit newSession, view, analyze, commit, action, summary. */
(function (global) {
  'use strict';

  const MAX_DEPTH = 3;      // Einwand-Teile, die selbst wieder Einwand-Teile haben
  const LONG_CHAIN = 10;

  const q = (s) => '„' + String(s || '').trim() + '“';

  function newFrame(kind, teil, parent) {
    return {
      kind,                       // 'main' | 'objection'
      teil: teil || '',
      art: '',
      kontext: parent ? parent.kontext : '',
      koerper: '',
      ergebnisse: [],
      kern: '',
      kernErleben: '',
      rueck: [],
      rIdx: -1,
      kontextNeu: '',
      alter: '',
      zukunft: '',
      step: kind === 'main' ? 'intro' : 'experience'
    };
  }

  function newSession() {
    const now = new Date().toISOString();
    return {
      v: 1,
      id: 'kt-' + Date.now().toString(36),
      started: now,
      updated: now,
      frames: [newFrame('main')],   // Stapel: letzter Eintrag ist der aktive Teil
      finished: [],                 // abgeschlossene Einwand-Teile
      log: []
    };
  }

  const cur = (s) => s.frames[s.frames.length - 1];
  const root = (s) => s.frames[0];
  const lastOutcome = (f) => f.ergebnisse[f.ergebnisse.length - 1];
  const isBelief = (f) => f.art === 'Glaubenssatz';

  /* ---------- Schrittdefinitionen ---------- */

  // phase: Position im 15-Schritte-Modell (für die Fortschrittsanzeige)
  // input: 'confirm' | 'text' | 'text-optional' | 'choice' | 'none'
  // kind:  Antwortart für die Stolperstein-Erkennung
  const STEPS = {
    intro: {
      phase: 0, title: 'Ankommen', input: 'confirm', ok: 'Ich bin bereit',
      say: () => [
        'Die Kerntransformation folgt einem Teil von dir – einem Verhalten, Gefühl oder Glaubenssatz – zu seiner tiefsten positiven Absicht, dem Kernzustand.',
        'Nimm dir 45 bis 60 Minuten Ruhe. Du kannst die Fragen sprechen oder tippen, jederzeit pausieren und später weitermachen.',
        'Die Übung ersetzt keine Therapie. Wenn du gerade in einer akuten Krise bist, nutze bitte nicht diese App, sondern ruf die Telefonseelsorge an: 0800 111 0 111.'
      ]
    },
    select: {
      phase: 1, title: 'Teil auswählen', input: 'text', kind: 'teil',
      chips: ['Verhalten', 'Gefühl', 'Reaktion', 'Glaubenssatz'],
      say: () => ['Nimm etwas, das wie von selbst geschieht und das du gern anders hättest – zum Beispiel „Ich werde ungeduldig, wenn …“, „Ich schiebe Dinge auf“ oder „Ich bin nicht gut genug“.'],
      ask: () => 'Welches Verhalten, Gefühl, welche Reaktion oder welchen Glaubenssatz möchtest du verwandeln?'
    },
    context: {
      phase: 2, title: 'Situation', input: 'text', kind: 'kontext',
      say: (f) => [isBelief(f)
        ? 'Wann wirkt der Glaubenssatz ' + q(f.teil) + '? Wähle eine konkrete Situation.'
        : 'Wähle eine konkrete Situation, in der ' + q(f.teil) + ' auftritt.',
        'Geh innerlich hinein, als wärst du jetzt dort: Was siehst du, was hörst du, was spürst du?'],
      ask: () => 'Wann und wo tritt es auf?'
    },
    experience: {
      phase: 3, title: 'Teil erleben', input: 'text', kind: 'koerper',
      say: (f) => [f.kind === 'objection'
        ? 'Spür jetzt den Teil, der den Einwand hat: ' + q(f.teil) + '.'
        : 'Bleib in der Situation und achte darauf, wie sich ' + q(f.teil) + ' anfühlt.',
        'Vielleicht ist es ein Gefühl an einem bestimmten Ort, ein Druck, eine Wärme, ein Bild oder eine innere Stimme.'],
      ask: () => 'Wo in deinem Körper spürst du diesen Teil, und wie fühlt er sich an?'
    },
    welcome: {
      phase: 4, title: 'Willkommen', input: 'confirm', ok: 'Getan',
      say: (f) => [
        'Heiße diesen Teil willkommen – dort, wo du ihn spürst' + (f.koerper ? ' (' + q(f.koerper) + ')' : '') + '.',
        'Danke ihm dafür, dass er da ist und für dich arbeitet, auch wenn du noch nicht weißt, wofür.',
        'Nimm wahr, wie er darauf reagiert.'
      ]
    },
    chain: {
      phase: 5, title: 'Ergebniskette', input: 'text', kind: 'outcome', ladder: true,
      phase2: 6,
      say: (f) => {
        if (!f.ergebnisse.length) {
          return ['Stell die Frage nach innen, direkt an den Teil – und warte.',
            'Die Antwort kann ein Wort sein, ein Bild, ein Gefühl. Nimm, was kommt, auch wenn es dich überrascht.'];
        }
        const e = lastOutcome(f);
        return ['Danke dem Teil für ' + q(e) + '.',
          'Frage ihn jetzt: »Wenn du ' + q(e) + ' ganz und vollständig hast – was willst du dann, durch das Haben von ' + q(e) + ', das noch wichtiger ist?«',
          'Lass dir Zeit und warte auf die Antwort des Teils.'];
      },
      ask: (f) => f.ergebnisse.length ? 'Was antwortet der Teil?' : 'Frage den Teil: »Was willst du?«',
      extra: (f) => f.ergebnisse.length ? [{ id: 'markCore', label: q(lastOutcome(f)) + ' ist schon der Kernzustand' }] : []
    },
    coreCheck: {
      phase: 7, title: 'Kernzustand?', input: 'choice', ladder: true,
      say: (f) => [
        q(lastOutcome(f)) + ' – nimm dir einen Moment, das ganz zu spüren.',
        'Ist das ein Zustand des Seins, in dem nichts mehr fehlt? Oder willst du durch das Haben davon noch etwas Tieferes?'
      ],
      choices: () => [
        { id: 'coreYes', label: 'Ja, das ist mein Kernzustand', primary: true },
        { id: 'coreNo', label: 'Nein, weiterfragen' }
      ]
    },
    core: {
      phase: 7, title: 'Kernzustand', input: 'text-optional', kind: 'reflect', ladder: true,
      say: (f) => [
        'Dein Kernzustand: ' + q(f.kern) + '.',
        'Lass ' + q(f.kern) + ' jetzt ganz da sein. Spür, wie es sich ausbreitet – in deinem ganzen Körper und über ihn hinaus.',
        'Wie ist es, ' + q(f.kern) + ' einfach zu haben – nicht als Ziel, sondern als Art zu sein, von der aus alles beginnt?'
      ],
      ask: () => 'Was nimmst du wahr? (optional)'
    },
    reverse: {
      phase: 8, title: 'Rückführung', input: 'text-optional', kind: 'reflect', ladder: true,
      say: (f) => {
        const e = f.ergebnisse[f.rIdx];
        return ['Frage den Teil: »Wenn du ' + q(f.kern) + ' schon als Art zu sein hast – wie verändert, bereichert oder verwandelt das ' + q(e) + '?«',
          'Nimm wahr, was sich verändert. Oft fühlt es sich ganz anders an als vorher.'];
      },
      ask: () => 'Was nimmst du wahr? (optional)'
    },
    reverseContext: {
      phase: 8, title: 'Rückführung: Situation', input: 'text-optional', kind: 'reflect',
      say: (f) => [
        'Und jetzt: Wenn du ' + q(f.kern) + ' schon als Art zu sein hast – wie verändert das die Situation ' + q(f.kontext) + '?',
        'Stell dir vor, du bist dort, mit ' + q(f.kern) + ' als Grundlage. Was ist anders – und was wird aus ' + q(f.teil) + '?'
      ],
      ask: () => 'Was ist jetzt anders? (optional)'
    },
    age: {
      phase: 9, title: 'Alter des Teils', input: 'text', kind: 'age',
      say: () => ['Nimm die erste Zahl, die auftaucht, ohne nachzurechnen.'],
      ask: () => 'Frage den Teil: »Wie alt bist du?«',
      extra: () => [{ id: 'noAge', label: 'Kein Alter / schon so alt wie ich' }]
    },
    growUp: {
      phase: 9, title: 'Aufwachsen', input: 'confirm', ok: 'Der Teil ist angekommen',
      say: (f) => [
        'Lass den Teil jetzt – ganz erfüllt von ' + q(f.kern) + ' – vom Alter ' + q(f.alter) + ' an aufwachsen.',
        'Jahr für Jahr, Moment für Moment, bis zu deinem jetzigen Alter. Erlebe, wie jedes Jahr mit ' + q(f.kern) + ' als Grundlage anders verläuft.',
        'Gib dem so viel Zeit, wie es braucht.'
      ]
    },
    body: {
      phase: 10, title: 'Im Körper', input: 'confirm', ok: 'Ist geschehen',
      say: (f) => [
        'Wo ist der Teil jetzt – in deinem Körper oder um dich herum?',
        'Lass ihn, mit ' + q(f.kern) + ', ganz in deinen Körper hineinfließen, bis er überall ist, in jeder Zelle – und vielleicht auch über den Körper hinaus.'
      ],
      extra: () => [{ id: 'hesitate', label: 'Der Teil zögert' }]
    },
    reverse2: {
      phase: 11, title: 'Zweite Rückführung', input: 'confirm', ok: 'Weiter', ladder: true,
      say: (f) => {
        const chain = f.ergebnisse.slice().reverse().map(q).join(' → ');
        return ['Mit dem gewachsenen Teil, ganz in dir: Lass ' + q(f.kern) + ' noch einmal in Ruhe durch alles hindurchstrahlen' + (chain ? ':' : '.'),
          chain ? chain + ' …' : '',
          '… und in die Situation ' + q(f.kontext) + '.'].filter(Boolean);
      }
    },
    objectionDone: {
      phase: 12, title: 'Einwand integriert', input: 'confirm', ok: 'Zurück zum ersten Teil',
      say: (f, s) => {
        const parent = s.frames[s.frames.length - 2];
        return ['Auch der Teil, der den Einwand hatte, ist jetzt mit seinem Kernzustand ' + q(f.kern) + ' verbunden.',
          'Lass beide Teile zusammen ' + q(parent.kern) + ' und ' + q(f.kern) + ' erleben – und spür, wie sie sich ergänzen.'];
      }
    },
    objection: {
      phase: 12, title: 'Einwandprüfung', input: 'choice',
      say: () => ['Frag nach innen und achte auf jedes Signal – ein Gefühl, ein Gedanke, ein »Ja, aber …«.'],
      ask: (f) => 'Gibt es einen Teil in dir, der Einwände dagegen hat, ' + q(f.kern) + ' jetzt als Art zu sein zu haben?',
      choices: () => [
        { id: 'objNo', label: 'Nein, kein Einwand', primary: true },
        { id: 'objYes', label: 'Ja, es gibt einen Einwand' }
      ]
    },
    objectionName: {
      phase: 12, title: 'Einwand-Teil', input: 'text', kind: 'teil',
      say: () => ['Danke diesem Teil: Er passt auf dich auf. Er bekommt jetzt seine eigene Kerntransformation.'],
      ask: () => 'Was sagt oder will der Teil, der den Einwand hat?'
    },
    timeline: {
      phase: 13, title: 'Zeitintegration', input: 'confirm', ok: 'Getan',
      say: (f) => [
        'Nimm ' + q(f.kern) + ' mit in die Zeit, noch bevor du gezeugt wurdest.',
        'Lass es von dort durch jeden Moment deines Lebens strömen – Kindheit, Jugend, alle Jahre bis heute – und alles, was geschehen ist, davon färben.',
        'Lass ' + q(f.kern) + ' dann weiter in deine Zukunft strahlen.'
      ]
    },
    future: {
      phase: 14, title: 'Zukunftsschritt', input: 'text-optional', kind: 'reflect',
      say: (f) => ['Stell dir eine künftige Situation vor, in der früher ' + q(f.teil) + ' aufgetreten wäre. Sei mit ' + q(f.kern) + ' dort.'],
      ask: () => 'Was ist jetzt anders?'
    },
    done: {
      phase: 15, title: 'Abschluss', input: 'none',
      say: (f) => ['Danke allen Teilen, die heute mitgearbeitet haben.',
        'Lass ' + q(f.kern) + ' in den nächsten Tagen einfach weiterwirken. Es ist nicht nötig, etwas zu tun.']
    }
  };

  const PHASES = 15;

  /* ---------- Ansicht ---------- */

  function view(s) {
    const f = cur(s);
    const st = STEPS[f.step];
    let phase = st.phase;
    if (f.step === 'chain' && f.ergebnisse.length) phase = st.phase2;
    return {
      step: f.step,
      title: st.title,
      phase,
      phases: PHASES,
      depth: s.frames.length - 1,
      frame: f,
      say: st.say(f, s),
      ask: st.ask ? st.ask(f, s) : '',
      input: st.input,
      ok: st.ok || 'Weiter',
      chips: st.chips || null,
      choices: st.choices ? st.choices(f, s) : null,
      extra: st.extra ? st.extra(f, s) : [],
      ladder: st.ladder ? ladder(f) : null
    };
  }

  // Ergebniskette zur Anzeige: Teil → E1 → … → Kern, mit Markierung der aktuellen Stelle
  function ladder(f) {
    const items = [{ label: f.teil, type: 'teil' }];
    f.ergebnisse.forEach((e, i) => items.push({
      label: e, type: 'ergebnis',
      active: f.step === 'reverse' && i === f.rIdx,
      rueck: f.rueck[i] || ''
    }));
    if (f.kern) items.push({ label: f.kern, type: 'kern' });
    return items;
  }

  /* ---------- Stolpersteine (lokales Modell) ---------- */

  const norm = (t) => String(t || '').toLowerCase()
    .replace(/[„“"'»«.,!?;:()]/g, ' ').replace(/\s+/g, ' ').trim();

  const RX = {
    crisis: /suizid|selbstmord|umbringen|nicht mehr leben|will sterben|sterben will|möchte sterben|tot sein will|lebensmüde|mich (selbst )?verletzen|ritzen|mir (was|etwas) an(zu)?tun|mir das leben nehmen/,
    overwhelm: /panik|überwältig|ich kann nicht mehr|zu viel für mich|wird mir zu viel|ich weine|muss weinen|heule|zittere|keine luft|bekomme kaum luft|dissoziier|wie betäubt|ich bin weg/,
    dontKnow: /^(ich )?(weiß|weiss) (es )?(nicht|ich nicht)$|^keine ahnung$|^nichts$|^(da )?kommt nichts$|^(ich )?(weiß|weiss) nicht so recht$|^unklar$|^keine antwort$/,
    refusal: /will nicht (antworten|reden|sprechen|sagen)|sagt nichts|antwortet nicht|misstrau|traut (sich|mir) nicht|blockiert|wehrt sich|verschlossen|zieht sich zurück/,
    negative: /\b(nicht|kein|keine|keinen|keiner|nie|niemals|weg|aufhören|aufhört|vermeiden|loswerden|los sein|ohne)\b/,
    analytic: /\bweil\b|ich sollte|ich müsste|man sollte|man müsste|wahrscheinlich|vermutlich|ich denke|theoretisch|psychologisch|das liegt (wohl )?daran/,
    others: /\b(dass|damit) (mein|meine|meinen|er|sie|die anderen|andere|man|alle|jemand)\b|\bvon (den )?anderen\b/,
    noAge: /kein alter|zeitlos|alterslos|immer schon|so alt wie ich|älter als ich|uralt/
  };

  const CORE_WORDS = ['sein', 'einfach sein', 'frieden', 'friede', 'innerer frieden', 'liebe', 'ok sein', 'okay sein',
    'ok-sein', 'einssein', 'eins sein', 'einheit', 'ganz sein', 'ganzsein', 'ganzheit', 'vollständig', 'heil',
    'stille', 'weite', 'licht', 'gelassenheit', 'geborgenheit', 'freiheit', 'verbundenheit', 'verbunden sein',
    'präsenz', 'gnade', 'ruhe', 'innere ruhe', 'leere', 'sein dürfen', 'da sein', 'dasein', 'zuhause sein', 'göttlich'];

  function looksLikeCore(text) {
    const t = norm(text).replace(/^(ich will |ich möchte |ich wünsche mir |einfach |nur |tiefe[rn]? |tiefe |tiefer |reine[rn]? |reines )+/, '');
    if (t.split(' ').length > 5) return false;
    // „sein“ allein nur als ganze Antwort zählen, sonst wäre „sicher sein“ ein Treffer
    return CORE_WORDS.some((w) => t === w || (w !== 'sein' && (t.endsWith(' ' + w) || t.startsWith(w + ' '))));
  }

  // Liefert Hinweise zur Antwort. severity:
  //  'crisis'  – Prozess anhalten, Hilfsangebote zeigen
  //  'ground'  – Erdungs-Hinweis, Antwort darf übernommen werden
  //  'block'   – Nachfrage; Antwort erst nach „trotzdem übernehmen“
  //  'info'    – Randnotiz
  function analyze(s, answer) {
    const f = cur(s);
    const st = STEPS[f.step];
    const t = norm(answer);
    const out = [];
    if (RX.crisis.test(t)) {
      out.push({ code: 'crisis', severity: 'crisis', text: 'Was du schreibst, klingt nach großer Not. Bitte pass zuerst auf dich auf.' });
      return out;
    }
    if (RX.overwhelm.test(t)) {
      out.push({ code: 'overwhelm', severity: 'ground', text: 'Nimm das Tempo heraus. Spür deine Füße auf dem Boden und atme drei Mal ruhig aus. Tritt innerlich einen Schritt zurück und beobachte von dort. Du darfst jederzeit pausieren.' });
    }
    if (!st.kind || st.input === 'text-optional') return out;

    if (t.length < 2 || RX.dontKnow.test(t)) {
      out.push({ code: 'dontKnow', severity: 'block', text: f.step === 'chain'
        ? 'Das ist ganz normal. Danke dem Teil und frag noch einmal – dann warte einfach. Achte auf ein Bild, ein Gefühl, ein einzelnes Wort. Was taucht als Erstes auf? Wenn du raten würdest, was wäre es?'
        : 'Nimm dir Zeit. Was taucht als Erstes auf – auch wenn es nur eine Ahnung ist?' });
      return out;
    }
    if (RX.refusal.test(t)) {
      out.push({ code: 'refusal', severity: 'block', text: 'Respektiere das und danke dem Teil für seine Vorsicht. Frag ihn, was er braucht, um sich sicher genug zu fühlen – und warte, ob er antworten möchte. Drängen hilft hier nicht.' });
      return out;
    }

    if (st.kind === 'outcome') {
      const earlier = f.ergebnisse.map(norm);
      if (earlier.includes(t)) {
        out.push({ code: 'repeat', severity: 'block', text: q(answer) + ' kam schon einmal. Frag den Teil noch einmal: »Wenn du das ganz und vollständig hast – was ist dann noch wichtiger?« Oder ist das vielleicht schon dein Kernzustand?' });
      }
      if (RX.negative.test(t)) {
        out.push({ code: 'negative', severity: 'block', text: 'Das beschreibt, was der Teil nicht will. Was will er stattdessen? Frag ihn: »Was hättest du, wenn das erreicht ist?«' });
      }
      if (RX.analytic.test(t)) {
        out.push({ code: 'analytic', severity: 'block', text: 'Das klingt eher nach Nachdenken als nach der Antwort des Teils. Frag den Teil direkt und lass die Antwort von ihm kommen – auch wenn sie unlogisch wirkt.' });
      }
      if (RX.others.test(t)) {
        out.push({ code: 'others', severity: 'block', text: 'Das richtet sich an andere. Frag den Teil: »Und wenn das so ist und du das ganz hast – was hast du dann für dich, das noch wichtiger ist?«' });
      }
      if (f.ergebnisse.length + 1 >= LONG_CHAIN) {
        out.push({ code: 'longChain', severity: 'info', text: 'Die Kette ist schon lang. Prüfe, ob eines der Glieder bereits ein Zustand des Seins war – du kannst es in der Liste antippen und als Kernzustand wählen.' });
      }
    }
    if (st.kind === 'age' && RX.noAge.test(t)) {
      out.push({ code: 'noAge', severity: 'info', text: 'Kein Problem – dann ist kein Aufwachsen nötig.' });
    }
    return out;
  }

  /* ---------- Übergänge ---------- */

  function logEntry(s, answer) {
    const v = view(s);
    s.log.push({ t: new Date().toISOString(), depth: v.depth, step: v.step, ask: v.ask || v.title, answer: answer || '' });
  }

  function guessArt(text) {
    const t = norm(text);
    if (/^(ich bin|ich kann nicht|ich glaube|ich darf nicht|ich habe es nicht verdient|niemand|man kann|ich werde nie)/.test(t)) return 'Glaubenssatz';
    return '';
  }

  // Übernimmt eine Antwort bzw. Bestätigung für den aktuellen Schritt und geht weiter.
  // opts.core (true/false) überschreibt in der Ergebniskette die lokale Kernzustand-Erkennung.
  function commit(s, answer, chip, opts) {
    const f = cur(s);
    const a = String(answer || '').trim();
    logEntry(s, a);
    switch (f.step) {
      case 'intro': f.step = 'select'; break;
      case 'select':
        f.teil = a; f.art = chip || guessArt(a);
        f.step = 'context'; break;
      case 'context': f.kontext = a; f.step = 'experience'; break;
      case 'experience': f.koerper = a; f.step = 'welcome'; break;
      case 'welcome': f.step = 'chain'; break;
      case 'chain':
        f.ergebnisse.push(a);
        f.step = (opts && typeof opts.core === 'boolean' ? opts.core : looksLikeCore(a)) ? 'coreCheck' : 'chain';
        break;
      case 'core':
        f.kernErleben = a;
        f.rIdx = f.ergebnisse.length - 1;
        f.step = f.rIdx >= 0 ? 'reverse' : 'reverseContext';
        break;
      case 'reverse':
        f.rueck[f.rIdx] = a;
        f.rIdx -= 1;
        if (f.rIdx < 0) f.step = 'reverseContext';
        break;
      case 'reverseContext': f.kontextNeu = a; f.step = 'age'; break;
      case 'age': f.alter = a; f.step = RX.noAge.test(norm(a)) ? 'body' : 'growUp'; break;
      case 'growUp': f.step = 'body'; break;
      case 'body': f.step = 'reverse2'; break;
      case 'reverse2': f.step = f.kind === 'objection' ? 'objectionDone' : 'objection'; break;
      case 'objectionDone':
        s.finished.push(s.frames.pop());
        cur(s).step = 'objection';
        break;
      case 'objectionName': {
        const nf = newFrame('objection', a, f);
        f.step = 'objection';
        s.frames.push(nf);
        break;
      }
      case 'timeline': f.step = 'future'; break;
      case 'future': f.zukunft = a; f.step = 'done'; break;
      default: break;
    }
    s.updated = new Date().toISOString();
    return s;
  }

  // Auswahl- und Zusatzaktionen (Buttons außer „Weiter“)
  function action(s, id, arg) {
    const f = cur(s);
    switch (id) {
      case 'coreYes':
      case 'markCore':
        logEntry(s, 'Kernzustand: ' + lastOutcome(f));
        f.kern = f.ergebnisse.pop();
        f.step = 'core';
        break;
      case 'pickCore': {   // beliebiges Glied der Kette als Kern wählen (arg = Index)
        const i = Number(arg);
        if (!(i >= 0 && i < f.ergebnisse.length)) return s;
        logEntry(s, 'Kernzustand: ' + f.ergebnisse[i]);
        f.kern = f.ergebnisse[i];
        f.ergebnisse = f.ergebnisse.slice(0, i);
        f.step = 'core';
        break;
      }
      case 'coreNo': logEntry(s, 'weiterfragen'); f.step = 'chain'; break;
      case 'noAge': logEntry(s, 'kein Alter'); f.alter = ''; f.step = 'body'; break;
      case 'objNo':
        logEntry(s, 'kein Einwand');
        f.step = 'timeline';
        break;
      case 'objYes':
        logEntry(s, 'Einwand');
        if (s.frames.length > MAX_DEPTH) return s;   // zu tief verschachtelt: Hinweis in der UI
        f.step = 'objectionName';
        break;
      default: return s;
    }
    s.updated = new Date().toISOString();
    return s;
  }

  const canNest = (s) => s.frames.length <= MAX_DEPTH;

  /* ---------- Zusammenfassung ---------- */

  function frameSummary(f, title) {
    const L = [];
    L.push(title);
    L.push('Teil: ' + f.teil + (f.art ? ' (' + f.art + ')' : ''));
    if (f.kontext && f.kind === 'main') L.push('Situation: ' + f.kontext);
    if (f.koerper) L.push('Im Körper: ' + f.koerper);
    if (f.ergebnisse.length) {
      L.push('Ergebniskette:');
      f.ergebnisse.forEach((e, i) => L.push('  ' + (i + 1) + '. ' + e + (f.rueck[i] ? '   ⟵ mit Kern: ' + f.rueck[i] : '')));
    }
    if (f.kern) L.push('Kernzustand: ' + f.kern + (f.kernErleben ? ' – ' + f.kernErleben : ''));
    if (f.kontextNeu) L.push('Situation mit Kern: ' + f.kontextNeu);
    if (f.alter) L.push('Alter des Teils: ' + f.alter);
    if (f.zukunft) L.push('Zukunft: ' + f.zukunft);
    return L.join('\n');
  }

  function summary(s) {
    const d = new Date(s.started);
    const parts = ['Kerntransformation vom ' + d.toLocaleDateString('de-DE') + ', ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }), ''];
    parts.push(frameSummary(root(s), '== Teil =='));
    s.finished.forEach((f, i) => { parts.push(''); parts.push(frameSummary(f, '== Einwand-Teil ' + (i + 1) + ' ==')); });
    return parts.join('\n');
  }

  global.KT = { newSession, view, analyze, commit, action, summary, looksLikeCore, canNest, cur, root, STEPS };
})(typeof window !== 'undefined' ? window : globalThis);
