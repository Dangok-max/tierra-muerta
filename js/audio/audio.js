// Tierra Muerta — audio 100 % sintetizado con Web Audio API (sin archivos).
// init() pre-renderiza cada efecto (2–4 variaciones) con OfflineAudioContext;
// reproducir es solo BufferSource + Gain (+ paso-bajo por distancia) + StereoPanner.
(function () {
  'use strict';
  const TM = window.TM = window.TM || {};

  const AC = window.AudioContext || window.webkitAudioContext;
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;

  // --- Mezcla ---
  const MASTER = 0.85;      // volumen general
  const MAX_VOICES = 16;    // voces de efectos simultáneas
  const MAX_DIST = 1100;    // más lejos no se oye
  const NEAR = 50;          // dentro de este radio, volumen pleno
  const PAN_W = 520;        // dx que da el paneo máximo
  const RMS_T = 0.2;        // sonoridad objetivo al normalizar efectos
  const KEY = 'tm_muted';

  function noop() {}
  function safe(p) { if (p && typeof p.catch === 'function') p.catch(noop); }
  function R(a, b) { return a + Math.random() * (b - a); }
  function pick(a) { return a[(Math.random() * a.length) | 0]; }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function num(v, d) { return typeof v === 'number' && v === v ? clamp01(v) : d; }
  function loadMuted() { try { return window.localStorage.getItem(KEY) === '1'; } catch (e) { return false; } }

  // --- Estado ---
  let ctx = null, master = null, sfxBus = null, ambBus = null, distIn = null;
  const layers = {};        // capas en bucle: wind, rain, drone, tension, music (GainNode)
  const applied = {};       // último nivel aplicado a cada capa
  const bank = {};          // nombre -> [AudioBuffer]
  const voices = [];        // voces de efectos vivas
  const lastT = {}, lastV = {};
  let lx = 0, ly = 0;
  let noiseCache = {}, curveCache = {};
  const amb = { night: 0, rain: 0, danger: 0, combat: 0, health: 1 };
  let ambT = -1, beatT = 0, padT = 0, bellT = 0, oneT = 0, thunT = 0, lastThunder = -99;
  let lastPad = 99, lastBell = 99, muteTimer = 0;

  const A = {
    muted: loadMuted(),
    ready: false,           // true cuando todo está pre-renderizado
    init: init,
    setMuted: setMuted,
    toggleMuted: toggleMuted,
    setListener: setListener,
    play: play,
    setAmbience: setAmbience
  };
  TM.Audio = A;

  // =====================================================================
  // Ayudas de síntesis (sobre un OfflineAudioContext c)
  // =====================================================================

  // Ruido compartido por frecuencia de muestreo (3 s, empalme sin salto).
  function noiseBuf(kind, sr) {
    const key = kind + sr;
    if (noiseCache[key]) return noiseCache[key];
    const n = Math.floor(sr * 3), b = ctx.createBuffer(1, n, sr), d = b.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'pink') {
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      } else if (kind === 'brown') {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last;
      } else d[i] = w;
    }
    const off = d[n - 1] - d[0];
    let pk = 0;
    for (let i = 0; i < n; i++) {
      d[i] -= off * i / (n - 1);
      const a = d[i] < 0 ? -d[i] : d[i];
      if (a > pk) pk = a;
    }
    if (pk > 0) for (let i = 0; i < n; i++) d[i] /= pk;
    noiseCache[key] = b;
    return b;
  }

  function nz(c, kind, t0, t1, rate) {
    const s = c.createBufferSource();
    s.buffer = noiseBuf(kind, c.sampleRate);
    s.loop = true;
    if (rate) s.playbackRate.value = rate;
    s.start(t0, Math.random() * 2.5);
    s.stop(t1);
    return s;
  }

  function osc(c, type, f, t0, t1) {
    const o = c.createOscillator();
    o.type = type;
    o.frequency.value = f;
    o.start(t0);
    o.stop(t1);
    return o;
  }

  function amp(c, v) { const g = c.createGain(); g.gain.value = v; return g; }

  function flt(c, type, f, q) {
    const b = c.createBiquadFilter();
    b.type = type;
    b.frequency.value = Math.min(f, c.sampleRate * 0.45);
    b.Q.value = q == null ? 1 : q;
    return b;
  }

  // Conecta en cadena; devuelve el último.
  function wire() {
    for (let i = 0; i < arguments.length - 1; i++) arguments[i].connect(arguments[i + 1]);
    return arguments[arguments.length - 1];
  }

  // Automatización por puntos [[t, v], ...] (t relativo a t0). ex = rampa exponencial.
  function ramp(p, t0, pts, ex) {
    p.setValueAtTime(pts[0][1], t0 + pts[0][0]);
    for (let i = 1; i < pts.length; i++) {
      const t = t0 + pts[i][0], v = pts[i][1];
      if (ex) p.exponentialRampToValueAtTime(Math.max(v, 0.0001), t);
      else p.linearRampToValueAtTime(v, t);
    }
  }

  function gl(a, b, d) { return [[0, a], [d, b]]; }

  // Envolvente percusiva: ataque lineal, caída exponencial (d = hasta -80 dB).
  function pe(c, t, a, p, d) {
    const g = c.createGain(), q = g.gain;
    q.value = 0;
    q.setValueAtTime(0, t);
    q.linearRampToValueAtTime(p, t + a);
    q.exponentialRampToValueAtTime(0.0001, t + a + d);
    q.setValueAtTime(0, t + a + d + 0.001);
    return g;
  }

  function curve(k) {
    const key = 'k' + k;
    if (curveCache[key]) return curveCache[key];
    const n = 1024, d = new Float32Array(n), tk = Math.tanh(k);
    for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; d[i] = Math.tanh(k * x) / tk; }
    curveCache[key] = d;
    return d;
  }

  function shaper(c, k) { const s = c.createWaveShaper(); s.curve = curve(k); return s; }

  // Reverb por convolución con respuesta generada (se oscurece con el tiempo).
  function verb(c, secs, decay, bright) {
    const sr = c.sampleRate, n = Math.floor(sr * secs);
    const ch = c.destination.channelCount > 1 ? 2 : 1;
    const b = c.createBuffer(ch, n, sr);
    for (let k = 0; k < ch; k++) {
      const d = b.getChannelData(k);
      let y = 0;
      for (let i = 0; i < n; i++) {
        const x = i / n;
        y += (bright * (1 - x) + 0.04) * ((Math.random() * 2 - 1) - y);
        d[i] = y * Math.pow(1 - x, decay);
      }
    }
    const cv = c.createConvolver();
    cv.buffer = b;
    return cv;
  }

  // Golpe grave con caída de tono.
  function thump(c, out, t, fa, fb, lvl, d) {
    const o = osc(c, 'sine', fa, t, t + d + 0.05);
    ramp(o.frequency, t, [[0, fa], [d * 0.5, fb]], true);
    wire(o, pe(c, t, 0.003, lvl, d), out);
  }

  // Clic metálico: ruido muy corto + resonancias inarmónicas.
  function clk(c, out, t, f, lvl, d) {
    wire(nz(c, 'white', t, t + d + 0.02), flt(c, 'bandpass', f, 2.5), pe(c, t, 0.0004, lvl * 3, d), out);
    const ny = c.sampleRate * 0.45, rs = [1, 2.32, 3.87];
    for (let i = 0; i < 3; i++) {
      const fr = f * 0.8 * rs[i];
      if (fr > ny) break;
      wire(osc(c, 'sine', fr * R(0.97, 1.03), t, t + d * 3 + 0.05), pe(c, t, 0.0004, lvl * 0.3 / (i + 1), d * 2.2), out);
    }
  }

  // Roce metálico/áspero con barrido de filtro.
  function scrape(c, out, t, d, f0, f1, lvl, rate) {
    const b = flt(c, 'bandpass', f0, 1.8);
    ramp(b.frequency, t, [[0, f0], [d, f1]], true);
    const g = amp(c, 0);
    ramp(g.gain, t, [[0, 0], [d * 0.3, lvl * 3], [d, 0]]);
    const am = amp(c, 0.5);
    wire(osc(c, 'square', rate || 70, t, t + d + 0.02), amp(c, 0.5), am.gain);
    wire(nz(c, 'white', t, t + d + 0.02), b, am, g, out);
  }

  // Granos cortos de ruido (grava, escombros, salpicaduras).
  function grains(c, out, t0, t1, n, fLo, fHi, lvl, dLo, dHi) {
    const s = nz(c, 'white', t0, t1 + dHi + 0.05);
    for (let i = 0; i < n; i++) {
      wire(s, flt(c, 'bandpass', R(fLo, fHi), R(1, 3)), pe(c, R(t0, t1), 0.0005, lvl * R(1.2, 4), R(dLo, dHi)), out);
    }
  }

  // Voz con formantes (zombies, humanos, cuervos). Tiempos relativos a o.t.
  // o: d, f0 [[t,Hz]], amp [[t,v]], F [[Hz | [[t,Hz]], Q, gan]], sub, dual [ratio, gan],
  //    jit, vib, vibR, fry (Hz | [[t,Hz]]), fryD, fryW, breath, bn, drive, wet, body, bodyF, wave
  function voice(c, out, o) {
    const t0 = o.t || 0, d = o.d, t1 = t0 + d + 0.05, f0 = o.f0, base = f0[0][1];
    const vm = amp(c, 1), oscs = [];
    const src = function (type, mul, lvl) {
      const s = osc(c, type, base * mul, t0, t1);
      ramp(s.frequency, t0, f0.map(function (p) { return [p[0], p[1] * mul]; }), true);
      wire(s, amp(c, lvl), vm);
      oscs.push([s, mul]);
    };
    src(o.wave || 'sawtooth', 1, 1);
    if (o.sub) src('square', 0.5, o.sub);
    if (o.dual) src('sawtooth', o.dual[0], o.dual[1]);
    // tono inestable: ruido lento + vibrato
    if (o.jit || o.vib) {
      const mod = amp(c, 1);
      if (o.jit) wire(nz(c, 'brown', t0, t1), flt(c, 'lowpass', 14, 0), amp(c, o.jit * base * 3), mod);
      if (o.vib) wire(osc(c, 'sine', o.vibR || 5.5, t0, t1), amp(c, o.vib), mod);
      for (let i = 0; i < oscs.length; i++) wire(mod, amp(c, oscs[i][1]), oscs[i][0].frequency);
    }
    // ronquera: modulación de amplitud (fritura vocal)
    let head = vm;
    if (o.fry) {
      const am = amp(c, 1 - o.fryD);
      const fr = typeof o.fry === 'number' ? [[0, o.fry]] : o.fry;
      const lf = osc(c, o.fryW || 'sawtooth', fr[0][1], t0, t1);
      if (fr.length > 1) ramp(lf.frequency, t0, fr, true);
      wire(lf, amp(c, o.fryD), am.gain);
      wire(vm, am);
      head = am;
    }
    const pre = amp(c, 1);
    wire(head, pre);
    if (o.breath) wire(nz(c, o.bn || 'white', t0, t1), amp(c, o.breath), pre);
    const sh = shaper(c, o.drive || 1.5);
    wire(pre, sh);
    // banco de formantes
    const post = amp(c, 1);
    for (let i = 0; i < o.F.length; i++) {
      const F = o.F[i], fq = F[0];
      const b = flt(c, 'bandpass', typeof fq === 'number' ? fq : fq[0][1], F[1]);
      if (typeof fq !== 'number') ramp(b.frequency, t0, fq, true);
      if (i === 0 && o.wet) wire(nz(c, 'brown', t0, t1), flt(c, 'lowpass', 30, 0), amp(c, o.wet * 3), b.frequency);
      wire(sh, b, amp(c, F[2]), post);
    }
    if (o.body !== 0) wire(sh, flt(c, 'lowpass', o.bodyF || 450, 0), amp(c, o.body == null ? 0.3 : o.body), post);
    const env = amp(c, 0);
    ramp(env.gain, t0, [[0, 0]].concat(o.amp));
    wire(post, env, out);
    return env;
  }

  // Lluvia: impulsos cortos aleatorios (gotas) generados en JS.
  function drops(c, T) {
    const sr = c.sampleRate, n = Math.floor(T * sr), b = c.createBuffer(1, n, sr), d = b.getChannelData(0);
    const cnt = Math.floor(T * 110);
    for (let k = 0; k < cnt; k++) {
      const i0 = (Math.random() * n) | 0, a = 0.05 + 0.9 * Math.random() * Math.random();
      const len = (sr * R(0.002, 0.007)) | 0;
      for (let i = 0; i < len && i0 + i < n; i++) {
        const e = 1 - i / len;
        d[i0 + i] += (Math.random() * 2 - 1) * a * e * e;
      }
    }
    return b;
  }

  // =====================================================================
  // Definición de efectos
  // d: duración renderizada, n: variaciones, sr: muestreo, vol: nivel base,
  // max: voces del mismo nombre, pv: variación de tono, pri: prioridad, gap: separación mínima,
  // rms: sonoridad objetivo al normalizar (más alto = más fuerte, limitado por el pico)
  // =====================================================================
  const S = {};
  function def(name, o) {
    S[name] = {
      d: o.d, b: o.b, n: o.n || 3, sr: o.sr || 22050, ch: o.ch || 1,
      vol: o.vol == null ? 0.6 : o.vol, max: o.max || 4, pv: o.pv == null ? 0.05 : o.pv,
      pri: o.pri || 1, gap: o.gap == null ? 0.02 : o.gap, rms: o.rms || RMS_T
    };
  }

  def('shot_pistol', { d: 1.25, sr: 44100, n: 4, vol: 1, max: 6, pv: 0.04, pri: 2.5, gap: 0.03, rms: 0.5, b: function (c, v, out) {
    const t = 0.002, pre = amp(c, 1);
    wire(pre, shaper(c, 3), out);
    // chasquido (onda de choque)
    wire(nz(c, 'white', t, t + 0.1), flt(c, 'highpass', R(1500, 2600), 0), pe(c, t, 0.0006, 1.2, R(0.04, 0.06)), pre);
    // cuerpo
    wire(nz(c, 'white', t, t + 0.3), flt(c, 'bandpass', R(550, 950), 0.8), pe(c, t, 0.001, 1.6, R(0.12, 0.18)), pre);
    // golpe grave
    const o = osc(c, 'sine', 170, t, t + 0.4);
    ramp(o.frequency, t, [[0, R(150, 200)], [0.11, R(40, 50)]], true);
    wire(o, pe(c, t, 0.002, 1.4, 0.22), pre);
    // mecanismo
    clk(c, pre, t + R(0.012, 0.02), R(2600, 3400), 0.25, 0.03);
    // cola: retumbo del entorno
    const lp = flt(c, 'lowpass', 900, 0);
    ramp(lp.frequency, t, [[0, R(700, 1100)], [0.9, 160]], true);
    wire(nz(c, 'brown', t, 1.2), lp, pe(c, t + 0.004, 0.012, 0.9, R(0.6, 0.9)), out);
    wire(pre, amp(c, R(0.25, 0.4)), verb(c, 1.0, 3, 0.6), out);
  } });

  def('reload', { d: 1.15, sr: 32000, n: 2, vol: 0.55, max: 2, pv: 0.03, pri: 1.8, b: function (c, v, out) {
    const k = R(0.9, 1.1), j = function () { return R(-0.015, 0.015); };
    const t1 = 0.02, t2 = 0.07 + j(), t3 = 0.27 + j(), t4 = 0.44 + j(), t5 = t4 + 0.1;
    const t6 = 0.8 + j(), t7 = t6 + R(0.1, 0.13);
    clk(c, out, t1, 2300 * k, 0.6, 0.05);                   // botón del cargador
    scrape(c, out, t2, 0.18, 1900 * k, 900 * k, 0.25, 60);   // sale el cargador
    clk(c, out, t3, 1300 * k, 0.35, 0.06);
    scrape(c, out, t4, 0.1, 900 * k, 1700 * k, 0.3, 90);     // entra el nuevo
    clk(c, out, t5, 1500 * k, 1, 0.07);                      // encaja
    thump(c, out, t5, 220, 110, 0.5, 0.08);
    clk(c, out, t6, 2700 * k, 0.55, 0.04);                   // corredera atrás
    scrape(c, out, t6, 0.07, 2200 * k, 3000 * k, 0.2, 120);
    clk(c, out, t7, 2000 * k, 0.9, 0.08);                    // corredera adelante
    thump(c, out, t7, 260, 140, 0.4, 0.06);
  } });

  def('empty_click', { d: 0.2, sr: 32000, n: 3, vol: 0.5, max: 2, pri: 2, b: function (c, v, out) {
    const f = R(2300, 3300);
    clk(c, out, 0.005, f, 1, 0.035);
    clk(c, out, 0.008, f * 0.45, 0.4, 0.02);
    thump(c, out, 0.005, 500, 300, 0.25, 0.03);
  } });

  def('shove', { d: 0.45, sr: 32000, n: 3, vol: 0.7, max: 3, pri: 1.6, b: function (c, v, out) {
    // roce de ropa / aire
    const b = flt(c, 'bandpass', 800, 1.1);
    ramp(b.frequency, 0, [[0, R(600, 900)], [0.14, R(2000, 3000)]], true);
    const g = amp(c, 0);
    ramp(g.gain, 0, [[0, 0], [0.07, 2], [0.16, 0]]);
    wire(nz(c, 'pink', 0, 0.2), b, g, out);
    // golpe sordo contra el cuerpo
    const t = R(0.07, 0.09);
    thump(c, out, t, R(120, 150), 50, 1, 0.2);
    thump(c, out, t, 260, 160, 0.3, 0.06);
    wire(nz(c, 'brown', t, t + 0.2), flt(c, 'lowpass', 500, 0), pe(c, t, 0.002, 1.2, 0.12), out);
    wire(nz(c, 'white', t, t + 0.06), flt(c, 'bandpass', 1500, 1), pe(c, t, 0.001, 0.5, 0.04), out);
  } });

  def('hit_flesh', { d: 0.42, sr: 32000, n: 4, vol: 0.75, max: 5, pv: 0.08, pri: 1.4, b: function (c, v, out) {
    const pre = amp(c, 1);
    wire(pre, shaper(c, 1.8), out);
    thump(c, pre, 0.003, R(120, 160), 55, 0.9, 0.14);
    wire(nz(c, 'white', 0.002, 0.12), flt(c, 'lowpass', R(1400, 2200), 0), pe(c, 0.002, 0.001, 0.8, 0.07), pre);
    // chapoteo: barrido resonante hacia abajo
    for (let i = 0; i < 2; i++) {
      const t = 0.004 + i * R(0.02, 0.05);
      const b = flt(c, 'bandpass', 1800, R(4, 7));
      ramp(b.frequency, t, [[0, R(1500, 2600)], [0.13, R(250, 450)]], true);
      wire(nz(c, 'white', t, t + 0.25), b, pe(c, t, 0.004, 2.2 - i, R(0.15, 0.22)), pre);
    }
    // salpicaduras
    grains(c, out, 0.04, 0.22, 4, 2500, 5000, 0.25, 0.008, 0.02);
  } });

  def('bullet_wall', { d: 0.75, sr: 44100, n: 4, vol: 0.6, max: 4, pv: 0.1, pri: 0.8, b: function (c, v, out) {
    wire(nz(c, 'white', 0.002, 0.06), flt(c, 'highpass', R(2500, 4000), 0), pe(c, 0.002, 0.0004, 1.4, 0.03), out);
    wire(nz(c, 'white', 0.002, 0.15), flt(c, 'bandpass', R(1000, 1800), 1.4), pe(c, 0.002, 0.001, 1.6, 0.08), out);
    thump(c, out, 0.002, 300, 120, 0.35, 0.05);
    // escombros de concreto
    grains(c, out, 0.01, 0.3, R(7, 11) | 0, 1800, 6500, 0.35, 0.006, 0.025);
    if (v % 2 === 0) {
      // rebote silbante
      const t = 0.01, d = R(0.35, 0.55);
      const o = osc(c, 'triangle', 3500, t, t + d + 0.05);
      ramp(o.frequency, t, [[0, R(3200, 4400)], [d, R(1100, 1700)]], true);
      wire(osc(c, 'sine', R(25, 40), t, t + d), amp(c, R(40, 90)), o.frequency);
      const g = amp(c, 0);
      ramp(g.gain, t, [[0, 0], [0.01, 0.35], [d, 0]]);
      wire(o, flt(c, 'highpass', 900, 0), g, out);
    }
  } });

  def('zombie_groan', { d: 1.9, sr: 22050, n: 4, vol: 0.5, max: 4, pv: 0.08, pri: 0.6, gap: 0.08, b: function (c, v, out) {
    const k = R(0.88, 1.12);   // tamaño de la garganta
    const P = [
      { d: 1.5, f0: [[0, 82], [0.5, 96], [1.5, 66]], amp: [[0.18, 0.9], [0.8, 1], [1.5, 0]],
        F: [[gl(380, 560, 1.5), 5, 1], [gl(820, 980, 1.5), 7, 0.6], [2300, 10, 0.25]],
        fry: 27, fryD: 0.55, breath: 0.25, drive: 3, jit: 0.12, sub: 0.3, wet: 60 },
      { d: 1.1, f0: [[0, 70], [1.1, 58]], amp: [[0.08, 1], [0.7, 0.8], [1.1, 0]],
        F: [[450, 4, 1], [gl(1000, 1150, 1.1), 6, 0.7], [2400, 9, 0.3]],
        fry: 36, fryD: 0.85, breath: 0.45, drive: 5, jit: 0.15, sub: 0.5, wet: 120 },
      { d: 1.7, f0: [[0, 88], [0.6, 118], [1.7, 74]], amp: [[0.25, 1], [1.1, 0.8], [1.7, 0]],
        F: [[[[0, 450], [0.6, 700], [1.7, 420]], 5, 1], [[[0, 950], [0.6, 1250], [1.7, 900]], 7, 0.6], [2600, 10, 0.25]],
        fry: 24, fryD: 0.5, breath: 0.3, drive: 3.5, jit: 0.1, vib: 3, vibR: 4.5, wet: 50 },
      { d: 1.25, f0: [[0, 95], [0.4, 80], [0.55, 100], [1.25, 70]],
        amp: [[0.06, 1], [0.38, 0.5], [0.45, 0.05], [0.58, 1], [1.25, 0]],
        F: [[gl(550, 420, 1.25), 5, 1], [gl(1100, 850, 1.25), 7, 0.6], [2400, 9, 0.3]],
        fry: 32, fryD: 0.7, breath: 0.4, drive: 4.5, jit: 0.12, sub: 0.4, wet: 90 }
    ];
    const p = P[v % 4];
    p.f0 = p.f0.map(function (q) { return [q[0], q[1] * k]; });
    voice(c, out, p);
  } });

  def('zombie_attack', { d: 0.75, sr: 22050, n: 3, vol: 0.75, max: 3, pv: 0.07, pri: 1.2, b: function (c, v, out) {
    const k = R(0.9, 1.1), d = R(0.45, 0.6);
    voice(c, out, { d: d, f0: [[0, 105 * k], [0.08, 140 * k], [d, 85 * k]], amp: [[0.025, 1], [d * 0.6, 0.75], [d, 0]],
      F: [[gl(650, 750, d), 4, 1], [gl(1150, 1350, d), 6, 0.7], [2600, 8, 0.35]],
      fry: R(38, 50), fryD: 0.7, breath: 0.6, drive: 7, jit: 0.1, sub: 0.6, wet: 80, body: 0.4 });
    // bocanada inicial
    wire(nz(c, 'white', 0, 0.12), flt(c, 'bandpass', 1800, 0.8), pe(c, 0, 0.005, 0.5, 0.1), out);
  } });

  def('zombie_death', { d: 1.75, sr: 22050, n: 3, vol: 0.65, max: 3, pri: 1, b: function (c, v, out) {
    const k = R(0.9, 1.1), d = R(1.1, 1.4);
    voice(c, out, { d: d, f0: [[0, 115 * k], [0.25, 100 * k], [d, 42 * k]],
      amp: [[0.04, 1], [d * 0.4, 0.75], [d * 0.8, 0.3], [d, 0]],
      F: [[gl(650, 300, d), 4, 1], [gl(1150, 700, d), 6, 0.6], [gl(2500, 2200, d), 9, 0.25]],
      fry: [[0, 32], [d, 7]], fryD: 0.75, breath: 0.4, drive: 4, jit: 0.15, sub: 0.4, wet: 110 });
    // el cuerpo cae
    const t = d * R(0.7, 0.85);
    thump(c, out, t, 110, 45, 0.9, 0.25);
    wire(nz(c, 'brown', t, t + 0.3), flt(c, 'lowpass', 600, 0), pe(c, t, 0.003, 1.2, 0.2), out);
    grains(c, out, t, t + 0.12, 4, 1200, 3500, 0.2, 0.01, 0.03);
  } });

  def('stalker_hiss', { d: 1.1, sr: 32000, n: 3, vol: 0.55, max: 2, pri: 1.3, b: function (c, v, out) {
    const d = R(0.7, 1.0);
    const g = amp(c, 0);
    ramp(g.gain, 0, [[0, 0], [d * 0.25, 1], [d * 0.75, 0.8], [d, 0]]);
    g.connect(out);
    const b1 = flt(c, 'bandpass', 4200, 1.2);
    ramp(b1.frequency, 0, [[0, R(3000, 3800)], [d, R(4500, 5500)]], true);
    wire(nz(c, 'white', 0, d + 0.05), b1, g);
    wire(nz(c, 'white', 0, d + 0.05), flt(c, 'bandpass', R(2400, 3000), 7), amp(c, 1.5), g);
    // vibración gutural (reptil)
    const am = amp(c, 0.4);
    wire(osc(c, 'square', R(38, 55), 0, d), amp(c, 0.6), am.gain);
    wire(nz(c, 'pink', 0, d + 0.05), flt(c, 'bandpass', R(700, 1000), 2.5), am, amp(c, 0.8), g);
  } });

  def('scream', { d: 2.0, sr: 32000, n: 3, vol: 0.9, max: 2, pv: 0.04, pri: 2, b: function (c, v, out) {
    const k = R(0.92, 1.08), d = R(1.1, 1.3), pre = amp(c, 1);
    voice(c, pre, { d: d, f0: [[0, 380 * k], [0.09, 760 * k], [0.45, 860 * k], [d * 0.8, 800 * k], [d, 520 * k]],
      amp: [[0.05, 1], [d * 0.75, 0.85], [d, 0]],
      F: [[gl(850, 1000, d), 7, 1], [gl(1350, 1650, d), 9, 0.8], [2900, 12, 0.5], [3900, 14, 0.3]],
      fry: R(60, 85), fryD: 0.35, fryW: 'sine', breath: 0.35, drive: 9, jit: 0.04, vib: 22, vibR: R(6, 8),
      dual: [R(1.05, 1.08), 0.5], body: 0.1, bodyF: 1200 });
    wire(pre, out);
    wire(pre, amp(c, 0.35), verb(c, 0.9, 2.5, 0.7), out);
  } });

  def('tank_roar', { d: 2.8, sr: 22050, n: 3, vol: 0.9, max: 2, pri: 2, b: function (c, v, out) {
    const k = R(0.9, 1.1), d = R(1.4, 1.8), pre = amp(c, 1);
    voice(c, pre, { d: d, f0: [[0, 46 * k], [0.25, 64 * k], [d * 0.7, 56 * k], [d, 38 * k]],
      amp: [[0.18, 1], [d * 0.7, 0.85], [d, 0]],
      F: [[gl(300, 420, d), 3, 1], [gl(680, 820, d), 4, 0.8], [1500, 5, 0.4], [2600, 6, 0.15]],
      fry: R(18, 26), fryD: 0.6, breath: 0.7, bn: 'pink', drive: 10, jit: 0.15, sub: 0.9, wet: 40, body: 0.7, bodyF: 260 });
    // retumbo de pecho
    const g = amp(c, 0);
    ramp(g.gain, 0, [[0, 0], [0.2, 0.8], [d, 0]]);
    wire(nz(c, 'brown', 0, d + 0.1), flt(c, 'lowpass', 160, 0), g, pre);
    wire(pre, out);
    wire(pre, amp(c, 0.3), verb(c, 1.2, 2.5, 0.4), out);
  } });

  def('tank_stomp', { d: 1.25, sr: 22050, n: 3, vol: 0.9, max: 2, pri: 1.2, gap: 0.1, rms: 0.32, b: function (c, v, out) {
    const pre = amp(c, 1);
    wire(pre, shaper(c, 2.2), out);
    thump(c, pre, 0.003, R(75, 90), 28, 1.3, 0.5);
    thump(c, pre, 0.003, 180, 90, 0.5, 0.12);   // armónico audible en altavoces de móvil
    wire(nz(c, 'brown', 0.002, 0.3), flt(c, 'lowpass', 350, 0), pe(c, 0.002, 0.002, 1.2, 0.18), pre);
    wire(nz(c, 'brown', 0.005, 1.2), flt(c, 'lowpass', 120, 0), pe(c, 0.01, 0.02, 0.9, 0.9), out);
    grains(c, out, 0.02, 0.2, 5, 1200, 3500, 0.15, 0.01, 0.03);
  } });

  def('tank_charge', { d: 3.3, sr: 22050, n: 2, vol: 1, max: 1, pri: 2.2, b: function (c, v, out) {
    const k = R(0.92, 1.08), d = 2.2, pre = amp(c, 1);
    voice(c, pre, { d: d, f0: [[0, 36 * k], [1.5, 60 * k], [d, 72 * k]],
      amp: [[0.4, 0.25], [1.5, 0.75], [2.0, 1], [d, 0]],
      F: [[gl(260, 520, d), 3, 1], [gl(600, 1000, d), 4, 0.8], [gl(1300, 1700, d), 5, 0.4]],
      fry: [[0, 16], [d, 30]], fryD: 0.6, breath: 0.6, bn: 'pink', drive: 12, jit: 0.15, sub: 0.9, body: 0.7, bodyF: 280 });
    const g = amp(c, 0);
    ramp(g.gain, 0, [[0, 0], [1.8, 1], [d, 0]]);
    wire(nz(c, 'brown', 0, d + 0.1), flt(c, 'lowpass', 200, 0), g, pre);
    wire(pre, out);
    wire(pre, amp(c, 0.25), verb(c, 1.2, 2.5, 0.4), out);
  } });

  def('player_hurt', { d: 0.45, sr: 32000, n: 4, vol: 0.75, max: 1, pri: 2.5, gap: 0.12, b: function (c, v, out) {
    const k = R(0.9, 1.1), d = R(0.22, 0.34);
    const vw = [[620, 1150], [700, 1200], [520, 1000], [600, 1300]][v % 4];
    voice(c, out, { d: d, f0: [[0, 140 * k], [0.04, 168 * k], [d, 105 * k]], amp: [[0.012, 1], [d * 0.45, 0.7], [d, 0]],
      F: [[gl(vw[0], vw[0] * 0.85, d), 8, 1], [gl(vw[1], vw[1] * 0.9, d), 10, 0.55], [2500, 14, 0.25], [3400, 16, 0.1]],
      breath: 0.22, drive: 2.2, jit: 0.05, fry: v === 2 ? 55 : 0, fryD: 0.3, body: 0.25, bodyF: 350 });
    // golpe de aire al quejarse
    wire(nz(c, 'white', 0, 0.08), flt(c, 'bandpass', 1600, 1), pe(c, 0, 0.004, 0.25, 0.06), out);
  } });

  def('player_death', { d: 2.4, sr: 32000, n: 2, vol: 0.85, max: 1, pri: 3, b: function (c, v, out) {
    const k = R(0.92, 1.08), d = R(1.5, 1.8);
    voice(c, out, { d: d, f0: [[0, 150 * k], [0.12, 195 * k], [0.6, 160 * k], [d * 0.85, 92 * k], [d, 75 * k]],
      amp: [[0.03, 1], [0.6, 0.9], [d * 0.75, 0.5], [d, 0]],
      F: [[gl(760, 480, d), 7, 1], [gl(1250, 850, d), 9, 0.55], [gl(2500, 2300, d), 13, 0.25], [3400, 15, 0.1]],
      breath: 0.28, drive: 2.8, jit: 0.07, vib: 5, vibR: 5 });
    // último estertor
    const t = d * 0.9, g = amp(c, 0), am = amp(c, 0.5);
    ramp(g.gain, t, [[0, 0], [0.15, 0.35], [0.6, 0]]);
    wire(osc(c, 'sawtooth', 14, t, t + 0.7), amp(c, 0.5), am.gain);
    wire(nz(c, 'pink', t, t + 0.7), flt(c, 'bandpass', 900, 1.5), am, g, out);
  } });

  def('footstep', { d: 0.2, sr: 22050, n: 4, vol: 0.55, max: 3, pv: 0.1, pri: 0.5, gap: 0.05, b: function (c, v, out) {
    wire(nz(c, 'brown', 0, 0.12), flt(c, 'lowpass', R(250, 400), 0), pe(c, 0.002, 0.004, 1, 0.08), out);
    grains(c, out, 0.004, 0.08, R(8, 13) | 0, 1500, 4800, 0.4, 0.006, 0.022);
    wire(nz(c, 'pink', 0, 0.12), flt(c, 'bandpass', R(900, 1500), 0.8), pe(c, 0.005, 0.01, 0.3, 0.07), out);
  } });

  def('ui_click', { d: 0.12, sr: 32000, n: 2, vol: 0.35, max: 2, pv: 0.03, pri: 3, b: function (c, v, out) {
    const f = v ? 760 : 680;
    const o = osc(c, 'sine', f, 0, 0.1);
    ramp(o.frequency, 0, [[0, f], [0.05, f * 0.7]], true);
    wire(o, pe(c, 0, 0.001, 1, 0.07), out);
    wire(osc(c, 'triangle', f * 2.01, 0, 0.05), pe(c, 0, 0.0005, 0.2, 0.025), out);
    wire(nz(c, 'white', 0, 0.02), flt(c, 'highpass', 3000, 0), pe(c, 0, 0.0004, 0.35, 0.012), out);
  } });

  def('ui_notify', { d: 2.8, sr: 22050, n: 2, vol: 0.6, max: 1, pv: 0, pri: 3, b: function (c, v, out) {
    const pre = amp(c, 1), base = v ? 49 : 55;
    // gong grave y disonante (segunda menor que bate)
    const P = [[1, 1, 2.4], [1.06, 0.5, 2.0], [2, 0.5, 1.8], [2.83, 0.3, 1.2], [4.2, 0.15, 0.8], [5.4, 0.1, 0.6]];
    for (let i = 0; i < P.length; i++) {
      wire(osc(c, i < 2 ? 'triangle' : 'sine', base * P[i][0], 0, 2.7), pe(c, 0, 0.03, P[i][1], P[i][2]), pre);
    }
    wire(nz(c, 'brown', 0, 0.4), flt(c, 'lowpass', 300, 0), pe(c, 0, 0.01, 0.5, 0.3), pre);
    const lp = flt(c, 'lowpass', 900, 0);
    wire(pre, shaper(c, 1.6), lp, out);
    wire(lp, amp(c, 0.4), verb(c, 1.8, 2.5, 0.4), out);
  } });

  def('flashlight', { d: 0.12, sr: 32000, n: 2, vol: 0.35, max: 2, pri: 1.5, b: function (c, v, out) {
    clk(c, out, 0.003, R(3000, 3800), 0.7, 0.012);
    thump(c, out, 0.003, 700, 400, 0.25, 0.02);
    clk(c, out, R(0.03, 0.045), R(2200, 2800), 0.35, 0.01);
  } });

  def('thunder', { d: 7, sr: 16000, n: 3, vol: 0.9, max: 2, pv: 0.06, pri: 1, gap: 0.5, rms: 0.26, b: function (c, v, out) {
    const pre = amp(c, 1), near = v === 0, t0 = R(0.05, 0.3);
    // chasquido inicial (apagado por la distancia)
    wire(nz(c, 'white', t0, t0 + 1), flt(c, 'lowpass', near ? 2400 : 1000, 0), pe(c, t0, 0.015, near ? 0.7 : 0.3, 0.7), pre);
    // retumbos encadenados
    const n = 5 + ((Math.random() * 4) | 0);
    for (let i = 0; i < n; i++) {
      const t = t0 + 3 * i / n + R(0, 0.5), a = R(0.08, 0.45), pk = R(0.4, 1) * (1 - 0.5 * i / n), dd = R(1, 2.4);
      const g = amp(c, 0);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(pk, t + a);
      g.gain.setTargetAtTime(0, t + a, dd / 5);
      wire(nz(c, 'brown', t, 7), flt(c, 'lowpass', R(120, 380), 0), g, pre);
    }
    wire(pre, out);
    wire(pre, amp(c, 0.5), verb(c, 2.5, 2.2, 0.3), out);
  } });

  def('heartbeat', { d: 0.7, sr: 22050, n: 2, vol: 0.75, max: 2, pv: 0.02, pri: 2, b: function (c, v, out) {
    const pre = amp(c, 1);
    const beat = function (t, l) {
      thump(c, pre, t, 64, 36, l, 0.22);
      thump(c, pre, t, 150, 85, l * 0.35, 0.09);   // armónico audible en altavoz pequeño
      wire(nz(c, 'brown', t, t + 0.15), flt(c, 'lowpass', 240, 0), pe(c, t, 0.006, l * 0.6, 0.1), pre);
    };
    beat(0.01, 1);
    beat(R(0.25, 0.29), 0.75);
    wire(pre, shaper(c, 1.6), flt(c, 'lowpass', 700, 0), out);
  } });

  // --- Solo para el ambiente ---
  def('amb_crow', { d: 1.9, sr: 22050, n: 3, vol: 0.7, b: function (c, v, out) {
    let t = 0.02;
    for (let i = 0; i <= v; i++) {   // 1, 2 o 3 graznidos
      const d = R(0.2, 0.3), f = R(520, 680);
      voice(c, out, { t: t, d: d, f0: [[0, f], [d * 0.3, f * 1.08], [d, f * 0.8]], amp: [[0.02, 1], [d * 0.5, 0.8], [d, 0]],
        F: [[gl(1300, 1100, d), 4, 1], [gl(2100, 1900, d), 5, 0.7], [3000, 6, 0.3]],
        fry: R(80, 110), fryD: 0.5, breath: 0.8, drive: 8, jit: 0.08, body: 0 });
      t += d + R(0.12, 0.25);
    }
  } });

  def('amb_howl', { d: 3.6, sr: 22050, n: 3, vol: 0.6, b: function (c, v, out) {
    if (v === 2) {
      // metal lejano: golpe inarmónico + chirrido de bisagra
      const f = R(140, 200), rs = [1, 2.31, 3.6, 5.1, 6.9];
      for (let i = 0; i < rs.length; i++) {
        wire(osc(c, 'sine', f * rs[i], 0.02, 3.5), pe(c, 0.02, 0.003, 0.6 / (i + 1), R(1.5, 3) / (1 + i * 0.4)), out);
      }
      const cb = flt(c, 'bandpass', 1100, 5);
      ramp(cb.frequency, 1.2, [[0, 900], [1.4, 1300]], true);
      const cg = amp(c, 0);
      ramp(cg.gain, 1.2, [[0, 0], [0.3, 0.5], [1.2, 0.4], [1.6, 0]]);
      wire(osc(c, 'sawtooth', R(22, 35), 1.2, 3.0), cb, cg, out);
      return;
    }
    const hw = v === 0;   // 0: aullido, 1: lamento humano lejano
    voice(c, out, {
      d: 3.0,
      f0: hw ? [[0, 330], [0.4, 470], [1.8, 505], [2.5, 400], [3.0, 300]] : [[0, 250], [0.8, 300], [2.2, 245], [3.0, 190]],
      amp: hw ? [[0.35, 1], [2.2, 0.8], [3.0, 0]] : [[0.6, 0.9], [1.6, 1], [3.0, 0]],
      F: hw ? [[gl(500, 720, 3), 3, 1], [1000, 4, 0.35]] : [[350, 6, 1], [800, 8, 0.5], [2400, 12, 0.15]],
      wave: hw ? 'triangle' : 'sawtooth', vib: hw ? 7 : 6, vibR: hw ? 5 : 4, jit: 0.03,
      breath: hw ? 0.08 : 0.2, drive: hw ? 1.2 : 1.6, body: 0.5, bodyF: 700
    });
  } });

  // Nota de pad (La2) para la música generativa; se transpone con playbackRate.
  def('amb_pad', { d: 7, sr: 16000, ch: 2, n: 2, vol: 1, pv: 0, b: function (c, v, out) {
    const d = 5.5, f = 110, m = c.createChannelMerger(2);
    const lp = flt(c, 'lowpass', 250, 2);
    ramp(lp.frequency, 0, [[0, 220], [2.2, v ? 650 : 950], [d, 260]], true);
    const g = amp(c, 0);
    ramp(g.gain, 0, [[0, 0], [1.8, 1], [3.6, 0.75], [d, 0]]);
    for (let ch = 0; ch < 2; ch++) {
      const cg = amp(c, 0.3), det = ch ? [1.003, 0.995, 2.002] : [0.997, 1.005, 1.998];
      for (let i = 0; i < 3; i++) wire(osc(c, v ? 'square' : 'sawtooth', f * det[i], 0, d), amp(c, i === 2 ? 0.25 : 1), cg);
      cg.connect(m, 0, ch);
    }
    wire(osc(c, 'sine', f / 2, 0, d), amp(c, 0.5), lp);
    wire(m, lp, g, out);
    wire(g, amp(c, 0.7), verb(c, 2.5, 2.2, 0.35), out);
  } });

  // Campana grave y lejana (La3) para la música.
  def('amb_bell', { d: 5, sr: 16000, ch: 2, n: 2, vol: 1, pv: 0, b: function (c, v, out) {
    const f = 220, pre = amp(c, 1);
    const P = [[0.5, 0.5, 4], [1, 1, 3.5], [1.19, 0.3, 2.4], [2, 0.35, 2], [2.76, 0.25, 1.4], [4.07, 0.12, 0.9], [5.4, 0.07, 0.6]];
    for (let i = 0; i < P.length; i++) {
      wire(osc(c, 'sine', f * P[i][0] * R(0.998, 1.002), 0, 4.9), pe(c, 0.01, 0.002, P[i][1], P[i][2]), pre);
    }
    const lp = flt(c, 'lowpass', v ? 1700 : 2500, 0);
    wire(pre, lp, out);
    wire(lp, amp(c, 0.9), verb(c, 3.2, 2, 0.3), out);
  } });

  // =====================================================================
  // Capas en bucle (estéreo). L: duración del bucle, F: fundido de empalme,
  // lin: fundido lineal (material periódico) o de igual potencia (ruido).
  // =====================================================================
  const LOOPS = {
    wind: { L: 12, F: 2, sr: 16000, lin: false, b: function (c, T, out) {
      const m = c.createChannelMerger(2);
      m.connect(out);
      for (let ch = 0; ch < 2; ch++) {
        const pf = [], pg = [];
        for (let t = 0; t < T + 2; t += R(1.2, 2.4)) { pf.push([t, R(260, 850)]); pg.push([t, R(0.25, 1)]); }
        const s = amp(c, 1);
        wire(nz(c, 'pink', 0, T), s);
        wire(nz(c, 'pink', 0, T, 0.83), s);
        const bp = flt(c, 'bandpass', 500, 0.8);
        ramp(bp.frequency, 0, pf, true);
        const g = amp(c, 0);
        ramp(g.gain, 0, pg);
        wire(s, bp, g);
        g.connect(m, 0, ch);
        // silbido entre ruinas
        const wb = flt(c, 'bandpass', 1200, 12);
        ramp(wb.frequency, 0, pf.map(function (p) { return [p[0], p[1] * 1.9]; }), true);
        const wg = amp(c, 0);
        ramp(wg.gain, 0, pg.map(function (p) { return [p[0], p[1] * p[1] * 0.8]; }));
        wire(nz(c, 'white', 0, T), wb, wg);
        wg.connect(m, 0, ch);
      }
      wire(nz(c, 'brown', 0, T), flt(c, 'lowpass', 140, 0), amp(c, 0.5), out);
    } },

    rain: { L: 8, F: 1.5, sr: 24000, lin: false, b: function (c, T, out) {
      const m = c.createChannelMerger(2);
      m.connect(out);
      for (let ch = 0; ch < 2; ch++) {
        const s = amp(c, 1);
        wire(nz(c, 'white', 0, T), s);
        wire(nz(c, 'white', 0, T, 0.79), s);
        wire(s, flt(c, 'highpass', 500, 0), flt(c, 'lowpass', 7000, 0), amp(c, 0.3)).connect(m, 0, ch);
        wire(nz(c, 'pink', 0, T, ch ? 0.9 : 1.1), flt(c, 'bandpass', 1800, 0.6), amp(c, 0.6)).connect(m, 0, ch);
        const dr = c.createBufferSource();
        dr.buffer = drops(c, T);
        dr.start(0);
        wire(dr, flt(c, 'bandpass', R(2600, 3600), 0.9), amp(c, 1.2)).connect(m, 0, ch);
      }
      wire(nz(c, 'brown', 0, T), flt(c, 'lowpass', 300, 0), amp(c, 0.35), out);
    } },

    // Frecuencias múltiplo de 1/8 Hz: el bucle de 8 s empalma exacto.
    drone: { L: 8, F: 0.5, sr: 16000, lin: true, b: function (c, T, out) {
      const m = c.createChannelMerger(2);
      m.connect(out);
      const FR = [[41.25, 41.5, 61.875, 82.5], [41.375, 41.625, 62, 82.625]], LV = [1, 0.8, 0.5, 0.3];
      for (let ch = 0; ch < 2; ch++) {
        const lp = flt(c, 'lowpass', 200, 4);
        wire(osc(c, 'sine', ch ? 0.25 : 0.125, 0, T), amp(c, 90), lp.frequency);
        const g = amp(c, 0.7);
        wire(osc(c, 'sine', ch ? 0.125 : 0.25, 0, T), amp(c, 0.3), g.gain);
        for (let i = 0; i < 4; i++) wire(osc(c, 'sawtooth', FR[ch][i], 0, T), amp(c, LV[i]), lp);
        wire(lp, g);
        g.connect(m, 0, ch);
      }
      // tono fantasma agudo, casi inaudible
      wire(osc(c, 'sine', 658.75, 0, T), amp(c, 0.02), out);
      wire(osc(c, 'sine', 660, 0, T), amp(c, 0.02), out);
    } },

    // Combate: cluster disonante con trémolo + ostinato grave (120 lpm).
    tension: { L: 8, F: 0.5, sr: 16000, lin: true, b: function (c, T, out) {
      const m = c.createChannelMerger(2);
      m.connect(out);
      const NT = [110, 116.5, 155.5];
      for (let ch = 0; ch < 2; ch++) {
        const g = amp(c, 0.7);
        wire(osc(c, 'sine', 6, 0, T), amp(c, 0.3), g.gain);
        const bp = flt(c, 'bandpass', 750, 0.8);
        for (let i = 0; i < 3; i++) wire(osc(c, 'sawtooth', NT[i] + ch * 0.125, 0, T), amp(c, 0.4), bp);
        wire(bp, g);
        g.connect(m, 0, ch);
      }
      for (let t = 0; t < T; t += 0.5) {
        const i = Math.round(t * 2);
        wire(osc(c, 'sawtooth', 55, t, t + 0.32), flt(c, 'lowpass', 280, 2), pe(c, t, 0.006, i % 4 === 0 ? 1 : 0.5, 0.3), out);
      }
    } }
  };

  // =====================================================================
  // Pre-renderizado
  // =====================================================================
  function render(ch, dur, sr, build) {
    return new Promise(function (res, rej) {
      const c = new OAC(ch, Math.max(1, Math.ceil(dur * sr)), sr);
      build(c);
      let done = false;
      const fin = function (b) {
        if (done) return;
        done = true;
        if (b) res(b); else rej(new Error('render'));
      };
      c.oncomplete = function (e) { fin(e.renderedBuffer); };
      const p = c.startRendering();
      if (p && typeof p.then === 'function') p.then(fin, rej);
    });
  }

  // Recorta la cola silenciosa y normaliza por sonoridad (RMS máximo en ventanas de 50 ms).
  function finish(buf, rmsT) {
    const ch = buf.numberOfChannels, sr = buf.sampleRate, n = buf.length, src = [];
    for (let k = 0; k < ch; k++) src.push(buf.getChannelData(k));
    const W = Math.max(64, (sr * 0.05) | 0);
    let peak = 0, best = 0, last = 0;
    for (let i = 0; i < n; i += W) {
      const e = Math.min(n, i + W);
      let s = 0;
      for (let k = 0; k < ch; k++) {
        const d = src[k];
        for (let j = i; j < e; j++) {
          const x = d[j];
          s += x * x;
          if (x > peak) peak = x; else if (-x > peak) peak = -x;
        }
      }
      s /= (e - i) * ch;
      if (s > best) best = s;
    }
    if (peak < 1e-5) return null;
    const thr = peak * 0.002;
    for (let i = n - 1; i > 0 && !last; i--) {
      for (let k = 0; k < ch; k++) if (Math.abs(src[k][i]) > thr) { last = i; break; }
    }
    const g = Math.min(rmsT / Math.sqrt(best), 0.97 / peak);
    const len = Math.min(n, last + ((sr * 0.01) | 0) + 1);
    const fade = Math.max(1, Math.min(len >> 2, (sr * 0.03) | 0));
    const out = ctx.createBuffer(ch, len, sr);
    for (let k = 0; k < ch; k++) {
      const s = src[k], d = out.getChannelData(k);
      for (let i = 0; i < len; i++) {
        const r = len - i;
        d[i] = s[i] * g * (r < fade ? r / fade : 1);
      }
    }
    return out;
  }

  // Convierte un render de L+F segundos en un bucle de L sin costura y lo normaliza.
  function makeLoop(buf, L, F, lin) {
    const sr = buf.sampleRate, ch = buf.numberOfChannels, n = Math.floor(L * sr), f = Math.floor(F * sr);
    if (buf.length < n + f) return null;
    const out = ctx.createBuffer(ch, n, sr);
    let ss = 0, peak = 0;
    for (let k = 0; k < ch; k++) {
      const s = buf.getChannelData(k), d = out.getChannelData(k);
      for (let i = 0; i < n; i++) {
        let x = s[i];
        if (i < f) {
          const u = i / f;
          x = lin ? x * u + s[n + i] * (1 - u) : x * Math.sin(u * 1.5707963) + s[n + i] * Math.cos(u * 1.5707963);
        }
        d[i] = x;
        ss += x * x;
        if (x > peak) peak = x; else if (-x > peak) peak = -x;
      }
    }
    if (peak < 1e-5) return null;
    const g = Math.min(0.18 / Math.sqrt(ss / (n * ch)), 0.97 / peak);
    for (let k = 0; k < ch; k++) {
      const d = out.getChannelData(k);
      for (let i = 0; i < n; i++) d[i] *= g;
    }
    return out;
  }

  function sfxJob(name, v) {
    return function () {
      const d = S[name];
      return render(d.ch, d.d, d.sr, function (c) { d.b(c, v, c.destination); }).then(function (buf) {
        const out = finish(buf, d.rms);
        if (out) (bank[name] || (bank[name] = [])).push(out);
      });
    };
  }

  function loopJob(key) {
    return function () {
      const L = LOOPS[key], T = L.L + L.F + 0.05;
      return render(2, T, L.sr, function (c) { L.b(c, T, c.destination); }).then(function (buf) {
        const out = makeLoop(buf, L.L, L.F, L.lin);
        if (out) startLayer(key, out);
      });
    };
  }

  // Primero una variación de cada sonido (por importancia), luego el resto.
  function buildJobs() {
    const order = ['shot_pistol', 'footstep', 'zombie_groan', 'hit_flesh', 'zombie_attack', 'empty_click', 'reload',
      'shove', 'bullet_wall', 'ui_click', 'player_hurt', 'zombie_death', 'flashlight', '@wind', 'ui_notify',
      'heartbeat', 'stalker_hiss', 'scream', 'tank_roar', 'tank_stomp', 'tank_charge', 'player_death', '@drone',
      '@rain', 'thunder', 'amb_crow', 'amb_howl', 'amb_pad', 'amb_bell', '@tension'];
    const jobs = [];
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < order.length; i++) {
        const name = order[i];
        if (name.charAt(0) === '@') { if (pass === 0) jobs.push(loopJob(name.slice(1))); continue; }
        const d = S[name];
        if (!d) continue;
        if (pass === 0) jobs.push(sfxJob(name, 0));
        else for (let v = 1; v < d.n; v++) jobs.push(sfxJob(name, v));
      }
    }
    return jobs;
  }

  // Un render a la vez para no saturar CPU en gama baja.
  function runJobs(jobs) {
    let i = 0;
    const next = function () { setTimeout(step, 0); };
    function step() {
      if (i >= jobs.length) {
        A.ready = true;
        noiseCache = {};   // libera memoria de trabajo
        curveCache = {};
        return;
      }
      const job = jobs[i++];
      let p = null;
      try { p = job(); } catch (e) { p = null; }
      if (p && typeof p.then === 'function') p.then(next, next); else next();
    }
    step();
  }

  // =====================================================================
  // Grafo en tiempo real
  // =====================================================================
  function buildGraph() {
    master = ctx.createGain();
    master.gain.value = A.muted ? 0 : MASTER;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.knee.value = 10;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.25;
    comp.connect(master);
    master.connect(ctx.destination);
    sfxBus = ctx.createGain();
    sfxBus.connect(comp);
    ambBus = ctx.createGain();
    ambBus.gain.value = 0.9;
    ambBus.connect(comp);
    const names = ['wind', 'rain', 'drone', 'tension', 'music'];
    for (let i = 0; i < names.length; i++) {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(ambBus);
      layers[names[i]] = g;
      applied[names[i]] = -1;
    }
    layers.wind.gain.value = 0.3;   // viento de fondo aunque aún no llamen a setAmbience (menú)
    applied.wind = 0.3;
    // sonidos lejanos: apagados (paso-bajo) y con eco
    distIn = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1500;
    const dl = ctx.createDelay(1);
    dl.delayTime.value = 0.42;
    const fb = ctx.createGain();
    fb.gain.value = 0.35;
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    distIn.connect(lp);
    lp.connect(ambBus);
    lp.connect(dl);
    dl.connect(fb);
    fb.connect(dl);
    dl.connect(wet);
    wet.connect(ambBus);
  }

  function startLayer(key, buf) {
    const g = layers[key];
    if (!g) return;
    const s = ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.connect(g);
    s.start(ctx.currentTime + 0.02, Math.random() * buf.duration * 0.9);
  }

  // Desbloqueo para algunos navegadores: buffer silencioso durante el gesto.
  function unlock() {
    try {
      const s = ctx.createBufferSource();
      s.buffer = ctx.createBuffer(1, 1, 22050);
      s.connect(ctx.destination);
      s.start(0);
    } catch (e) { /* nada */ }
  }

  function resume() {
    if (!ctx || A.muted || document.hidden) return;
    if (ctx.state !== 'running' && ctx.state !== 'closed') safe(ctx.resume());
  }

  function suspendIfMuted() {
    try { if (A.muted && ctx && ctx.state === 'running') safe(ctx.suspend()); } catch (e) { /* nada */ }
  }

  // =====================================================================
  // API pública
  // =====================================================================
  function init() {
    try {
      if (!AC) return;
      if (!ctx) {
        try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { ctx = new AC(); }
        buildGraph();
        unlock();
        if (OAC) runJobs(buildJobs());
        if (A.muted) {
          // desbloquea con el gesto y luego suspende para ahorrar batería
          if (ctx.state === 'suspended') safe(ctx.resume());
          muteTimer = setTimeout(suspendIfMuted, 300);
          return;
        }
      }
      resume();
    } catch (e) { /* nunca romper el juego */ }
  }

  function setMuted(b) {
    try {
      A.muted = !!b;
      try { window.localStorage.setItem(KEY, A.muted ? '1' : '0'); } catch (e) { /* sin almacenamiento */ }
      if (!ctx) return;
      master.gain.setTargetAtTime(A.muted ? 0 : MASTER, ctx.currentTime, 0.04);
      clearTimeout(muteTimer);
      if (A.muted) muteTimer = setTimeout(suspendIfMuted, 250);
      else resume();
    } catch (e) { /* nada */ }
  }

  function toggleMuted() {
    setMuted(!A.muted);
    return A.muted;
  }

  function setListener(x, y) {
    if (typeof x === 'number' && x === x) lx = x;
    if (typeof y === 'number' && y === y) ly = y;
  }

  // Quita una voz de la lista y, si terminó, libera sus nodos.
  function unlist(vo) {
    const i = voices.indexOf(vo);
    if (i >= 0) voices.splice(i, 1);
  }
  function ended(vo) {
    unlist(vo);
    try {
      vo.s.disconnect();
      vo.g.disconnect();
      if (vo.f) vo.f.disconnect();
      if (vo.p) vo.p.disconnect();
    } catch (e) { /* nada */ }
  }
  function kill(vo, now) {
    unlist(vo);
    try {
      vo.g.gain.setTargetAtTime(0, now, 0.015);
      vo.s.stop(now + 0.08);
    } catch (e) { /* nada */ }
  }

  // Si se supera el límite, descarta la voz con menor prioridad (lejana / vieja).
  function makeRoom(name, limit, prio, now) {
    let count = 0, worst = null, ws = Infinity;
    for (let i = 0; i < voices.length; i++) {
      const vo = voices[i];
      if (name && vo.n !== name) continue;
      count++;
      const age = (now - vo.t) / Math.max(0.05, vo.e - vo.t);
      const sc = vo.w * (1 - 0.6 * (age > 1 ? 1 : age));
      if (sc < ws) { ws = sc; worst = vo; }
    }
    if (count < limit) return true;
    if (!worst || ws > prio) return false;
    kill(worst, now);
    return true;
  }

  function play(name, x, y, opts) {
    try {
      if (!ctx || A.muted || ctx.state !== 'running') return false;
      const d = S[name], set = bank[name];
      if (!d || !set || !set.length) return false;
      let vol = d.vol, pan = 0, cut = 0;
      if (opts && typeof opts.volume === 'number') vol *= opts.volume;
      if (typeof x === 'number' && typeof y === 'number' && isFinite(x) && isFinite(y)) {
        const dx = x - lx, dy = y - ly, dist = Math.sqrt(dx * dx + dy * dy);
        if (dist >= MAX_DIST) return false;
        const t = dist <= NEAR ? 0 : (dist - NEAR) / (MAX_DIST - NEAR), a = 1 - t;
        vol *= a * a;
        pan = (dx < -PAN_W ? -1 : dx > PAN_W ? 1 : dx / PAN_W) * 0.85;
        if (t > 0.2) cut = 900 + 16000 * a * a * a;   // lo lejano suena apagado
      }
      if (vol < 0.008) return false;
      if (vol > 2) vol = 2;
      const now = ctx.currentTime;
      if (name === 'thunder') lastThunder = now;
      if (now - (lastT[name] || -9) < d.gap) return false;
      let rate = d.pv ? 1 + (Math.random() * 2 - 1) * d.pv : 1;
      if (opts && typeof opts.pitch === 'number' && opts.pitch > 0) rate *= opts.pitch;
      rate = rate < 0.25 ? 0.25 : rate > 4 ? 4 : rate;
      // límites de voces
      for (let i = voices.length - 1; i >= 0; i--) if (now > voices[i].e + 0.5) voices.splice(i, 1);
      const prio = vol * d.pri;
      if (!makeRoom(name, d.max, prio, now)) return false;
      if (!makeRoom(null, MAX_VOICES, prio, now)) return false;
      // variación al azar sin repetir la anterior
      let i = 0;
      const n = set.length;
      if (n > 1) {
        const lv = lastV[name];
        if (lv == null) i = (Math.random() * n) | 0;
        else { i = (Math.random() * (n - 1)) | 0; if (i >= lv) i++; }
      }
      lastV[name] = i;
      const buf = set[i];
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.playbackRate.value = rate;
      const g = ctx.createGain();
      g.gain.value = vol;
      s.connect(g);
      let tail = g, f = null, p = null;
      if (cut) {
        f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = cut;
        tail.connect(f);
        tail = f;
      }
      if (pan && ctx.createStereoPanner) {
        p = ctx.createStereoPanner();
        p.pan.value = pan;
        tail.connect(p);
        tail = p;
      }
      tail.connect(sfxBus);
      const vo = { n: name, s: s, g: g, f: f, p: p, t: now, e: now + buf.duration / rate, w: prio };
      voices.push(vo);
      s.onended = function () { ended(vo); };
      s.start(now);
      lastT[name] = now;
      return true;
    } catch (e) {
      return false;
    }
  }

  // Disparo simple para el ambiente (sin límite de voces; son pocos y espaciados).
  function fire(name, when, vol, rate, pan, dest) {
    const set = bank[name];
    if (!set || !set.length) return false;
    const s = ctx.createBufferSource();
    s.buffer = set[(Math.random() * set.length) | 0];
    s.playbackRate.value = rate || 1;
    const g = ctx.createGain();
    g.gain.value = vol;
    s.connect(g);
    let p = null;
    if (pan && ctx.createStereoPanner) {
      p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      p.connect(dest);
    } else g.connect(dest);
    s.onended = function () {
      try { s.disconnect(); g.disconnect(); if (p) p.disconnect(); } catch (e) { /* nada */ }
    };
    s.start(when || 0);
    return true;
  }

  function lvl(k, v, tau, now) {
    if (Math.abs(v - applied[k]) < 0.004) return;
    applied[k] = v;
    layers[k].gain.setTargetAtTime(v, now, tau);
  }

  const PAD_ST = [-12, -7, -5, 0, 0, 1, 3, 5, 7];   // La frigio, registro grave
  const BELL_ST = [0, 1, 3, 7, 8, 12, -5];

  function tickAmbience(now) {
    const s = amb, dead = s.health <= 0.001;
    const combat = dead ? 0 : s.combat;
    // capas en bucle
    lvl('wind', 0.3 + 0.25 * s.rain + 0.08 * s.night, 2, now);
    lvl('rain', 0.8 * Math.pow(s.rain, 1.3), 1.5, now);
    lvl('drone', 0.5 * s.night + 0.12 * s.danger, 3, now);
    const mus = dead ? 0.15 : clamp01(0.5 * s.danger + 0.7 * combat);
    lvl('music', 0.4 * mus, 2.5, now);
    lvl('tension', 0.3 * Math.pow(combat, 1.5), 1.2, now);

    // latido con poca vida: más rápido y fuerte cuanto menor
    const h = s.health;
    if (h < 0.3 && !dead) {
      const k = h / 0.3;
      if (beatT < now) beatT = now + 0.05;
      if (beatT - now < 0.2) {
        fire('heartbeat', beatT, (0.45 + 0.55 * (1 - k)) * S.heartbeat.vol, 1, 0, sfxBus);
        beatT += 0.5 + 0.6 * k;
      }
    } else beatT = 0;

    // música generativa: notas de pad espaciadas y alguna campana
    if (mus > 0.05) {
      if (!padT) padT = now + R(0.3, 1.5);
      if (!bellT) bellT = now + R(4, 8);
      if (now >= padT) {
        let st = pick(PAD_ST);
        if (st === lastPad) st = pick(PAD_ST);
        lastPad = st;
        fire('amb_pad', 0, R(0.6, 1), Math.pow(2, st / 12), 0, layers.music);
        padT = now + (10 - 5 * mus) * R(0.75, 1.3);
      }
      if (now >= bellT) {
        if (mus > 0.4) {
          let st = pick(BELL_ST);
          if (st === lastBell) st = pick(BELL_ST);
          lastBell = st;
          fire('amb_bell', 0, R(0.35, 0.7), Math.pow(2, st / 12), R(-0.5, 0.5), layers.music);
        }
        bellT = now + (14 - 7 * mus) * R(0.7, 1.4);
      }
    } else { padT = 0; bellT = 0; }

    // sonidos lejanos: cuervos de día; aullidos, gemidos y ecos de noche
    if (!oneT) oneT = now + R(8, 20);
    else if (now >= oneT) {
      if (s.night < 0.5) {
        fire('amb_crow', 0, R(0.25, 0.5) * S.amb_crow.vol, R(0.92, 1.08), R(-0.9, 0.9), distIn);
        oneT = now + R(15, 40);
      } else {
        const r = Math.random();
        if (r < 0.8 && r >= 0.4) fire('zombie_groan', 0, R(0.18, 0.35), R(0.7, 0.85), R(-0.9, 0.9), distIn);
        else if (r >= 0.8 && s.danger > 0.25) fire('scream', 0, R(0.08, 0.16), R(0.72, 0.82), R(-0.9, 0.9), distIn);
        else fire('amb_howl', 0, R(0.3, 0.6) * S.amb_howl.vol, R(0.9, 1.05), R(-0.9, 0.9), distIn);
        oneT = now + R(18, 45) * (1 - 0.4 * s.danger);
      }
    }

    // truenos lejanos con lluvia fuerte (el juego dispara los cercanos con relámpago)
    if (s.rain > 0.6) {
      if (!thunT) thunT = now + R(10, 25);
      else if (now >= thunT) {
        if (now - lastThunder > 20) {
          fire('thunder', 0, (0.35 + 0.8 * (s.rain - 0.6)) * S.thunder.vol, R(0.8, 0.95), R(-0.8, 0.8), distIn);
        }
        thunT = now + R(25, 60);
      }
    } else thunT = 0;
  }

  function setAmbience(o) {
    try {
      if (o) {
        amb.night = num(o.night, amb.night);
        amb.rain = num(o.rain, amb.rain);
        amb.danger = num(o.danger, amb.danger);
        amb.combat = num(o.combat, amb.combat);
        amb.health = num(o.health, amb.health);
      }
      if (!ctx || A.muted || ctx.state !== 'running') return;
      const now = ctx.currentTime;
      if (now - ambT < 0.1) return;   // ~10 veces por segundo es suficiente
      ambT = now;
      tickAmbience(now);
    } catch (e) { /* nada */ }
  }

  // --- Eventos del navegador ---
  try {
    document.addEventListener('visibilitychange', function () {
      try {
        if (!ctx) return;
        if (document.hidden) { if (ctx.state === 'running') safe(ctx.suspend()); } else resume();
      } catch (e) { /* nada */ }
    });
    // touchstart no cuenta como gesto para Chrome: reanudar también en touchend/pointerup/click.
    const wake = function () { try { if (ctx) resume(); } catch (e) { /* nada */ } };
    const evs = ['touchend', 'pointerup', 'mousedown', 'keydown', 'click'];
    for (let i = 0; i < evs.length; i++) window.addEventListener(evs[i], wake, { capture: true, passive: true });
  } catch (e) { /* nada */ }
})();
