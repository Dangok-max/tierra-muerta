// Tierra Muerta — audio 100 % sintetizado con Web Audio API (sin archivos).
// init() pre-renderiza cada efecto (2–4 variaciones) con OfflineAudioContext;
// reproducir es solo BufferSource + Gain (+ paso-bajo por distancia) + StereoPanner.
// Interior (setAmbience.indoor): paso-bajo al exterior + envío a una sala corta (convolución).
// setFire(0..1): bucle de fuego cercano.
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

  const WX_OPEN = 18000;    // paso-bajo de viento/lluvia al aire libre (transparente)
  const WX_SHUT = 650;      // ... y dentro de un edificio
  const ROOM_SEND = 0.45;   // envío a la reverberación de sala con indoor = 1

  // --- Estado ---
  let ctx = null, master = null, comp = null, sfxBus = null, ambBus = null, distIn = null;
  let wxLp = null, roomIn = null, fireLp = null, fireLvl = 0;
  const layers = {};        // capas en bucle: wind, rain, drone, tension, music, fire (GainNode)
  const applied = {};       // último nivel aplicado a cada capa
  const bank = {};          // nombre -> [AudioBuffer]
  const voices = [];        // voces de efectos vivas
  const lastT = {}, lastV = {};
  let lx = 0, ly = 0;
  let noiseCache = {}, curveCache = {};
  const amb = { night: 0, rain: 0, danger: 0, combat: 0, health: 1, indoor: 0 };
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
    setAmbience: setAmbience,
    setFire: setFire
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

  // Eco discreto con realimentación (retardo + paso-bajo en el lazo).
  function echo(c, inp, out, dt, fb, f, wet) {
    const dl = c.createDelay(1);
    dl.delayTime.value = dt;
    const lp = flt(c, 'lowpass', f, 0);
    wire(inp, dl, lp, amp(c, fb), dl);
    wire(lp, amp(c, wet), out);
  }

  // Barrido de ruido con envolvente de campana (silbido de aire, roce de tela).
  function swish(c, out, t, d, f0, f1, lvl, q, kind) {
    const b = flt(c, 'bandpass', f0, q || 1.2);
    ramp(b.frequency, t, [[0, f0], [d * 0.55, f1], [d, f0 * 0.8]], true);
    const g = amp(c, 0);
    ramp(g.gain, t, [[0, 0], [d * 0.55, lvl], [d, 0]]);
    wire(nz(c, kind || 'pink', t, t + d + 0.02), b, g, out);
  }

  // Crujido (madera, bisagra): tren de pulsos irregular por resonancias F [[Hz, Q, gan]].
  function creak(c, out, t, d, f0, f1, lvl, F) {
    const o = osc(c, 'sawtooth', f0, t, t + d + 0.02), pts = [[0, f0]];
    for (let k = 1; k <= 4; k++) pts.push([d * k / 4, Math.max(8, (f0 + (f1 - f0) * k / 4) * R(0.75, 1.25))]);
    ramp(o.frequency, t, pts, true);
    wire(nz(c, 'brown', t, t + d + 0.02), flt(c, 'lowpass', 25, 0), amp(c, f0 * 0.5), o.frequency);
    const g = amp(c, 0), gp = [[0, 0], [Math.min(0.04, d * 0.2), lvl]];
    for (let k = 1; k < 5; k++) gp.push([d * (0.15 + 0.17 * k), lvl * R(0.35, 1)]);
    gp.push([d, 0]);
    ramp(g.gain, t, gp);
    const sh = shaper(c, 2.5);
    o.connect(sh);
    for (let i = 0; i < F.length; i++) wire(sh, flt(c, 'bandpass', F[i][0], F[i][1]), amp(c, F[i][2]), g);
    g.connect(out);
  }

  // Modos resonantes (metal, madera, vidrio): senos con caída exponencial.
  function ring(c, out, t, f, rs, lvl, dec) {
    const ny = c.sampleRate * 0.45;
    for (let i = 0; i < rs.length; i++) {
      const fr = f * rs[i] * R(0.985, 1.015), dd = dec / (1 + i * 0.5);
      if (fr > ny) break;
      wire(osc(c, 'sine', fr, t, t + dd + 0.05), pe(c, t, 0.0008, lvl / (i + 1), dd), out);
    }
  }

  // Burbuja: seno con barrido ascendente.
  function bubble(c, out, t, f0, f1, d, lvl) {
    const o = osc(c, 'sine', f0, t, t + d + 0.03);
    ramp(o.frequency, t, [[0, f0], [d, f1]], true);
    wire(o, pe(c, t, 0.002, lvl, d), out);
  }

  // Llamas: rugido grave que parpadea + siseo + chasquidos y estallidos de brasas.
  function flames(c, out, t0, t1) {
    const fl = amp(c, 0.7);
    wire(nz(c, 'brown', t0, t1, 0.77), flt(c, 'lowpass', 7, 0), amp(c, 1.6), fl.gain);
    wire(nz(c, 'brown', t0, t1, 1.3), flt(c, 'lowpass', 420, 0), fl, out);
    wire(nz(c, 'pink', t0, t1), flt(c, 'bandpass', 1100, 0.6), amp(c, 0.22), fl);
    // chasquidos por tramos de 1 s con fuente propia: cada filtro solo procesa mientras suena
    for (let s = t0; s < t1 - 0.1; s += 1) {
      const e = Math.min(s + 1, t1 - 0.05);
      grains(c, out, s, e, Math.max(1, Math.round((e - s) * 14)), 1500, 6000, 0.4, 0.002, 0.01);
    }
    for (let i = 0; i < (t1 - t0) * 1.5; i++) {
      const tt = R(t0, t1 - 0.1);
      wire(nz(c, 'white', tt, tt + 0.06), flt(c, 'bandpass', R(450, 1000), 1.5), pe(c, tt, 0.0005, R(0.5, 1.1), R(0.02, 0.045)), out);
    }
  }

  // Respuesta de sala corta (~0,35 s, oscura) para interiores; energía unitaria.
  function roomIR(sr) {
    const n = Math.floor(sr * 0.35), b = ctx.createBuffer(2, n, sr), p0 = (sr * 0.003) | 0;
    for (let k = 0; k < 2; k++) {
      const d = b.getChannelData(k);
      let y = 0, e = 0;
      for (let i = p0; i < n; i++) {
        const x = (i - p0) / (n - p0);
        y += (0.55 * (1 - x) + 0.08) * ((Math.random() * 2 - 1) - y);
        d[i] = y * Math.exp(-(i - p0) / (sr * 0.055));
        e += d[i] * d[i];
      }
      // primeras reflexiones (paredes cercanas)
      const a = Math.sqrt(e);
      for (let r = 0; r < 6; r++) d[p0 + ((sr * R(0.002, 0.03)) | 0)] += a * R(0.12, 0.28) * (Math.random() < 0.5 ? -1 : 1);
      e = 0;
      for (let i = 0; i < n; i++) e += d[i] * d[i];
      const s = e > 0 ? 1 / Math.sqrt(e) : 0;
      for (let i = 0; i < n; i++) d[i] *= s;
    }
    return b;
  }

  // =====================================================================
  // Definición de efectos
  // d: duración renderizada, n: variaciones, sr: muestreo, vol: nivel base,
  // max: voces del mismo nombre, pv: variación de tono, pri: prioridad, gap: separación mínima,
  // rms: sonoridad objetivo al normalizar (más alto = más fuerte, limitado por el pico),
  // dry: sin sala de interior (interfaz), wx: sonido de exterior (se amortigua dentro)
  // =====================================================================
  const S = {};
  function def(name, o) {
    S[name] = {
      d: o.d, b: o.b, n: o.n || 3, sr: o.sr || 22050, ch: o.ch || 1,
      vol: o.vol == null ? 0.6 : o.vol, max: o.max || 4, pv: o.pv == null ? 0.05 : o.pv,
      pri: o.pri || 1, gap: o.gap == null ? 0.02 : o.gap, rms: o.rms || RMS_T,
      dry: !!o.dry, wx: !!o.wx
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

  def('ui_click', { d: 0.12, sr: 32000, n: 2, vol: 0.35, max: 2, pv: 0.03, pri: 3, dry: true, b: function (c, v, out) {
    const f = v ? 760 : 680;
    const o = osc(c, 'sine', f, 0, 0.1);
    ramp(o.frequency, 0, [[0, f], [0.05, f * 0.7]], true);
    wire(o, pe(c, 0, 0.001, 1, 0.07), out);
    wire(osc(c, 'triangle', f * 2.01, 0, 0.05), pe(c, 0, 0.0005, 0.2, 0.025), out);
    wire(nz(c, 'white', 0, 0.02), flt(c, 'highpass', 3000, 0), pe(c, 0, 0.0004, 0.35, 0.012), out);
  } });

  def('ui_notify', { d: 2.8, sr: 22050, n: 2, vol: 0.6, max: 1, pv: 0, pri: 3, dry: true, b: function (c, v, out) {
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

  def('thunder', { d: 7, sr: 16000, n: 3, vol: 0.9, max: 2, pv: 0.06, pri: 1, gap: 0.5, rms: 0.26, wx: true, b: function (c, v, out) {
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

  // =====================================================================
  // Fase 2: armas, puertas, objetos, fuego
  // =====================================================================

  def('shot_shotgun', { d: 1.8, sr: 32000, n: 3, vol: 1, max: 4, pv: 0.035, pri: 2.6, gap: 0.05, rms: 0.55, b: function (c, v, out) {
    const t = 0.002, pre = amp(c, 1);
    wire(pre, shaper(c, 3.5), out);
    // chasquido
    wire(nz(c, 'white', t, t + 0.12), flt(c, 'highpass', R(1100, 1800), 0), pe(c, t, 0.0008, 1.1, R(0.05, 0.08)), pre);
    // cuerpo ancho: dos bandas graves/medias
    wire(nz(c, 'white', t, t + 0.45), flt(c, 'bandpass', R(260, 400), 0.7), pe(c, t, 0.0015, 2.4, R(0.2, 0.28)), pre);
    wire(nz(c, 'pink', t, t + 0.35), flt(c, 'bandpass', R(800, 1300), 0.6), pe(c, t, 0.001, 1.3, R(0.12, 0.18)), pre);
    // golpe grave largo + armónico para altavoz pequeño
    const o = osc(c, 'sine', 130, t, t + 0.6);
    ramp(o.frequency, t, [[0, R(115, 145)], [0.2, R(32, 40)]], true);
    wire(o, pe(c, t, 0.003, 1.9, 0.4), pre);
    thump(c, pre, t, R(230, 270), 110, 0.7, 0.14);
    clk(c, pre, t + R(0.015, 0.025), R(1800, 2400), 0.2, 0.04);
    // cola: retumbo del entorno
    const lp = flt(c, 'lowpass', 800, 0);
    ramp(lp.frequency, t, [[0, R(600, 900)], [1.4, 120]], true);
    wire(nz(c, 'brown', t, 1.75), lp, pe(c, t + 0.006, 0.02, 1.2, R(1.0, 1.4)), out);
    wire(pre, amp(c, R(0.3, 0.45)), verb(c, 1.3, 3, 0.5), out);
  } });

  def('shot_rifle', { d: 2.6, sr: 32000, n: 3, vol: 1, max: 3, pv: 0.03, pri: 2.8, gap: 0.08, rms: 0.62, b: function (c, v, out) {
    const t = 0.002, pre = amp(c, 1);
    wire(pre, shaper(c, 4.5), out);
    // estampido supersónico: muy corto y seco
    wire(nz(c, 'white', t, t + 0.05), flt(c, 'highpass', R(2200, 3200), 0), pe(c, t, 0.0003, 1.8, R(0.02, 0.03)), pre);
    wire(nz(c, 'white', t, t + 0.15), flt(c, 'bandpass', R(700, 1100), 1), pe(c, t, 0.0006, 2, R(0.06, 0.09)), pre);
    const o = osc(c, 'sine', 190, t, t + 0.3);
    ramp(o.frequency, t, [[0, R(170, 210)], [0.07, R(42, 50)]], true);
    wire(o, pe(c, t, 0.0015, 1.7, 0.17), pre);
    thump(c, pre, t, R(300, 360), 150, 0.6, 0.06);
    // eco largo: rebotes discretos del entorno + reverberación oscura
    const e = amp(c, 1);
    wire(pre, flt(c, 'lowpass', R(1800, 2600), 0), e);
    echo(c, e, out, R(0.26, 0.36), R(0.42, 0.5), 1300, R(0.45, 0.6));
    wire(e, amp(c, 0.3), verb(c, 2.2, 2.4, 0.35), out);
    const lp = flt(c, 'lowpass', 700, 0);
    ramp(lp.frequency, t, [[0, R(600, 800)], [2.0, 100]], true);
    wire(nz(c, 'brown', t, 2.5), lp, pe(c, t + 0.005, 0.01, 0.8, R(1.6, 2.1)), out);
  } });

  // Un disparo por llamada; cola corta para que la ráfaga no empaste.
  def('shot_smg', { d: 0.55, sr: 32000, n: 4, vol: 0.85, max: 6, pv: 0.04, pri: 2.3, gap: 0.025, rms: 0.45, b: function (c, v, out) {
    const t = 0.002, pre = amp(c, 1);
    wire(pre, shaper(c, 3), out);
    wire(nz(c, 'white', t, t + 0.05), flt(c, 'highpass', R(1800, 2600), 0), pe(c, t, 0.0005, 1.2, R(0.025, 0.035)), pre);
    wire(nz(c, 'white', t, t + 0.12), flt(c, 'bandpass', R(900, 1400), 0.9), pe(c, t, 0.0008, 1.5, R(0.05, 0.07)), pre);
    const o = osc(c, 'sine', 200, t, t + 0.15);
    ramp(o.frequency, t, [[0, R(180, 220)], [0.05, R(55, 70)]], true);
    wire(o, pe(c, t, 0.0015, 1.1, 0.09), pre);
    clk(c, pre, t + R(0.008, 0.014), R(2800, 3600), 0.22, 0.02);   // cerrojo
    const lp = flt(c, 'lowpass', 900, 0);
    ramp(lp.frequency, t, [[0, R(800, 1100)], [0.35, 200]], true);
    wire(nz(c, 'brown', t, 0.5), lp, pe(c, t + 0.004, 0.008, 0.6, R(0.28, 0.38)), out);
    wire(pre, amp(c, 0.2), verb(c, 0.45, 3, 0.5), out);
  } });

  def('melee_swing', { d: 0.45, sr: 22050, n: 3, vol: 0.55, max: 3, pv: 0.1, pri: 1.5, gap: 0.05, b: function (c, v, out) {
    const d = R(0.2, 0.3), t = 0.005;
    swish(c, out, t, d, R(450, 700), R(1500, 2400), 1, 1.4, 'pink');
    swish(c, out, t + 0.01, d * 0.9, R(2500, 3500), R(4500, 6000), 0.25, 0.8, 'white');
    // masa del arma cortando el aire
    const g = amp(c, 0);
    ramp(g.gain, t, [[0, 0], [d * 0.5, 0.6 + 0.3 * (v % 2)], [d, 0]]);
    wire(nz(c, 'brown', t, t + d + 0.02), flt(c, 'lowpass', 350, 0), g, out);
  } });

  def('melee_hit', { d: 0.55, sr: 32000, n: 4, vol: 0.85, max: 4, pv: 0.07, pri: 1.6, gap: 0.03, rms: 0.3, b: function (c, v, out) {
    const pre = amp(c, 1), t = 0.003;
    wire(pre, shaper(c, 2.2), out);
    thump(c, pre, t, R(90, 120), 40, 1.3, 0.2);
    thump(c, pre, t, R(200, 240), 110, 0.6, 0.07);
    wire(nz(c, 'brown', t, t + 0.2), flt(c, 'lowpass', R(700, 1100), 0), pe(c, t, 0.002, 1.5, 0.11), pre);
    wire(nz(c, 'white', t, t + 0.06), flt(c, 'bandpass', R(1800, 2600), 1.2), pe(c, t, 0.0006, 0.7, 0.03), pre);
    if (v % 2 === 0) grains(c, pre, t, t + 0.04, 5, 1500, 4000, 0.4, 0.004, 0.015);   // crujido de hueso
    // chapoteo húmedo
    for (let i = 0; i < 2; i++) {
      const tt = t + 0.006 + i * R(0.025, 0.06), b = flt(c, 'bandpass', 1400, R(4, 6));
      ramp(b.frequency, tt, [[0, R(1100, 1900)], [0.16, R(220, 380)]], true);
      wire(nz(c, 'white', tt, tt + 0.3), b, pe(c, tt, 0.004, 2.4 - i * 0.8, R(0.17, 0.26)), pre);
    }
    grains(c, out, 0.05, 0.25, 5, 2000, 4500, 0.22, 0.008, 0.025);
  } });

  def('door_open', { d: 1.5, sr: 22050, n: 3, vol: 0.6, max: 2, pv: 0.06, pri: 1.2, gap: 0.2, b: function (c, v, out) {
    clk(c, out, 0.01, R(1700, 2300), 0.45, 0.04);   // pestillo
    thump(c, out, 0.01, 320, 180, 0.3, 0.04);
    // bisagra y madera que crujen
    const t = R(0.08, 0.15), d = R(0.7, 1.0), k = R(0.85, 1.15);
    creak(c, out, t, d, R(28, 40), R(55, 85), 1, [[420 * k, 7, 1], [1050 * k, 9, 0.7], [2300 * k, 10, 0.3]]);
    if (v !== 1) creak(c, out, t + d * 0.4, d * 0.5, R(60, 80), R(35, 45), 0.5, [[700 * k, 8, 1], [1600 * k, 10, 0.5]]);
    wire(nz(c, 'pink', t, t + d), flt(c, 'lowpass', 500, 0), pe(c, t, 0.15, 0.25, d), out);
  } });

  def('door_close', { d: 1.0, sr: 22050, n: 3, vol: 0.75, max: 2, pv: 0.05, pri: 1.3, gap: 0.2, rms: 0.3, b: function (c, v, out) {
    const pre = amp(c, 1), t = R(0.07, 0.11);
    wire(pre, shaper(c, 1.8), out);
    swish(c, out, 0, 0.12, 300, 700, 0.3, 1, 'pink');   // aire que empuja la hoja
    thump(c, pre, t, R(85, 110), 45, 1.3, 0.25);
    thump(c, pre, t, R(190, 220), 110, 0.5, 0.08);
    wire(nz(c, 'white', t, t + 0.25), flt(c, 'bandpass', R(250, 400), 1.5), pe(c, t, 0.002, 1.6, 0.16), pre);
    ring(c, pre, t, R(170, 200), [1, 2.4, 4.1, 6.3], 0.35, 0.14);   // panel de madera
    clk(c, pre, t + 0.008, R(1800, 2300), 0.5, 0.04);               // pestillo
    for (let i = 0; i < 3; i++) clk(c, out, t + R(0.04, 0.16), R(1200, 2400), 0.12, 0.02);   // marco
    wire(pre, amp(c, 0.2), verb(c, 0.5, 3, 0.4), out);
  } });

  // Un golpe de zombie contra la puerta por llamada.
  def('door_bash', { d: 0.9, sr: 22050, n: 4, vol: 0.8, max: 2, pv: 0.06, pri: 1.3, gap: 0.12, rms: 0.3, b: function (c, v, out) {
    const pre = amp(c, 1), t = 0.004;
    wire(pre, shaper(c, 2.2), out);
    thump(c, pre, t, R(70, 95), 38, 1.4, 0.3);
    thump(c, pre, t, R(170, 200), 95, 0.5, 0.1);
    wire(nz(c, 'white', t, t + 0.3), flt(c, 'bandpass', R(180, 320), 1.2), pe(c, t, 0.003, 1.8, 0.2), pre);
    ring(c, pre, t, R(140, 180), [1, 2.3, 3.9], 0.3, 0.18);
    // marco y bisagras temblando
    grains(c, out, t + 0.01, t + 0.18, 6, 1200, 3000, 0.2, 0.008, 0.025);
    for (let i = 0; i < 2 + (v % 2); i++) clk(c, out, t + R(0.03, 0.2), R(1500, 2600), 0.2, 0.025);
    if (v >= 2) creak(c, out, t + 0.05, R(0.2, 0.3), R(45, 60), R(30, 40), 0.35, [[500, 6, 1], [1200, 8, 0.6]]);
    wire(pre, amp(c, 0.18), verb(c, 0.5, 3, 0.4), out);
  } });

  def('door_break', { d: 1.9, sr: 32000, n: 2, vol: 0.9, max: 1, pv: 0.05, pri: 2, gap: 0.3, rms: 0.32, b: function (c, v, out) {
    const pre = amp(c, 1), t = 0.004;
    wire(pre, shaper(c, 2.5), out);
    thump(c, pre, t, R(75, 95), 35, 1.4, 0.35);
    thump(c, pre, t, 190, 95, 0.5, 0.1);
    wire(nz(c, 'white', t, t + 0.3), flt(c, 'bandpass', 260, 1.2), pe(c, t, 0.003, 1.6, 0.22), pre);
    // la madera se astilla: chasquidos encadenados
    wire(nz(c, 'white', t, t + 0.12), flt(c, 'bandpass', R(1500, 2500), 0.8), pe(c, t, 0.0005, 2.2, 0.07), pre);
    const s = nz(c, 'white', t, t + 0.6);
    for (let i = 0; i < 9; i++) {
      const tt = t + 0.01 + 0.4 * Math.pow(Math.random(), 1.5);
      wire(s, flt(c, 'bandpass', R(700, 4000), R(1.5, 3)), pe(c, tt, 0.0004, R(0.8, 2), R(0.012, 0.05)), pre);
    }
    creak(c, pre, t + 0.02, R(0.25, 0.35), R(70, 100), R(140, 200), 0.6, [[900, 5, 1], [2100, 6, 0.6]]);
    grains(c, out, t + 0.02, t + 0.55, 18, 1500, 6000, 0.3, 0.005, 0.03);
    // tablas que caen
    for (let i = 0; i < 2; i++) {
      const tt = R(0.4, 0.95);
      thump(c, out, tt, R(140, 190), 70, 0.5, 0.1);
      ring(c, out, tt, R(280, 420), [1, 2.7, 5.1], 0.25, 0.1);
      grains(c, out, tt, tt + 0.08, 4, 1200, 3500, 0.15, 0.008, 0.02);
    }
    wire(pre, amp(c, 0.25), verb(c, 0.8, 3, 0.4), out);
  } });

  def('chest_open', { d: 1.1, sr: 32000, n: 3, vol: 0.6, max: 2, pv: 0.05, pri: 1.4, gap: 0.2, b: function (c, v, out) {
    if (v === 0) {          // baúl: cerrojo + bisagra
      clk(c, out, 0.01, R(2200, 2800), 0.6, 0.04);
      clk(c, out, 0.03, R(1300, 1700), 0.35, 0.03);
      creak(c, out, R(0.08, 0.12), R(0.45, 0.6), R(55, 75), R(100, 140), 1, [[900, 8, 1], [1900, 10, 0.6], [3300, 12, 0.3]]);
      thump(c, out, 0.6, 160, 90, 0.25, 0.08);
    } else if (v === 1) {   // cajón que se desliza y topa
      scrape(c, out, 0.02, R(0.3, 0.4), R(500, 700), R(900, 1200), 0.35, R(35, 50));
      wire(nz(c, 'brown', 0.02, 0.42), flt(c, 'lowpass', 400, 0), pe(c, 0.02, 0.1, 0.4, 0.3), out);
      grains(c, out, 0.05, 0.4, 8, 1500, 4000, 0.15, 0.006, 0.02);   // contenido
      thump(c, out, 0.44, 200, 110, 0.6, 0.07);
      clk(c, out, 0.44, 1400, 0.3, 0.03);
      ring(c, out, 0.44, R(380, 460), [1, 2.6, 4.4], 0.15, 0.08);
    } else {                // taquilla metálica
      clk(c, out, 0.01, R(2600, 3200), 0.8, 0.05);
      ring(c, out, 0.01, R(300, 360), [1, 2.32, 4.05, 6.7, 9.3], 0.35, 0.5);
      creak(c, out, R(0.07, 0.1), R(0.35, 0.5), R(150, 190), R(230, 280), 0.6, [[1500, 12, 1], [2600, 14, 0.5]]);
    }
  } });

  def('chest_alarm', { d: 2.8, sr: 22050, n: 2, vol: 0.85, max: 1, pv: 0, pri: 2.8, gap: 0.6, rms: 0.3, b: function (c, v, out) {
    const T = 2.6, pre = amp(c, 1), g = amp(c, 0);
    if (v === 0) {
      // sirena que oscila rápido y luego alterna dos tonos
      const o = osc(c, 'square', 1250, 0, T);
      wire(osc(c, 'triangle', R(7, 9), 0, 1.3), amp(c, 250), o.frequency);
      o.frequency.setValueAtTime(1250, 0);
      for (let t = 1.3, i = 0; t < T; t += 0.16, i++) o.frequency.setValueAtTime(i % 2 ? 950 : 1450, t);
      o.connect(pre);
      ramp(g.gain, 0, [[0, 0], [0.01, 1], [T - 0.03, 1], [T, 0]]);
    } else {
      // pitidos rápidos y disonantes
      wire(osc(c, 'square', 2400, 0, T), amp(c, 0.7), pre);
      wire(osc(c, 'square', 3150, 0, T), amp(c, 0.4), pre);
      g.gain.setValueAtTime(0, 0);
      for (let t = 0.01; t < T - 0.1; t += 0.13) {
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(1, t + 0.004);
        g.gain.setValueAtTime(1, t + 0.075);
        g.gain.linearRampToValueAtTime(0, t + 0.08);
      }
    }
    // altavoz pequeño y saturado
    wire(pre, shaper(c, 2), flt(c, 'bandpass', 2200, 0.6), g, out);
    wire(g, amp(c, 0.15), verb(c, 0.6, 3, 0.5), out);
  } });

  def('trap_trigger', { d: 0.8, sr: 32000, n: 3, vol: 0.8, max: 3, pv: 0.05, pri: 1.8, gap: 0.1, rms: 0.32, b: function (c, v, out) {
    const pre = amp(c, 1);
    wire(pre, shaper(c, 2.5), out);
    // chasquido del resorte y las mandíbulas
    clk(c, pre, 0.004, R(2600, 3400), 1.2, 0.05);
    clk(c, pre, 0.007, R(1100, 1500), 0.6, 0.04);
    thump(c, pre, 0.004, 260, 130, 0.5, 0.05);
    // el resorte vibra
    const f = R(320, 460), o = osc(c, 'triangle', f, 0.006, 0.5);
    wire(osc(c, 'sine', R(18, 26), 0.006, 0.5), amp(c, f * 0.04), o.frequency);
    wire(o, pe(c, 0.006, 0.001, 0.35, 0.4), out);
    ring(c, out, 0.006, f * 2.1, [1, 2.7, 4.9], 0.15, 0.3);
    // pequeño estallido
    const t = R(0.03, 0.06);
    wire(nz(c, 'white', t, t + 0.04), flt(c, 'highpass', 2000, 0), pe(c, t, 0.0004, 1, 0.025), pre);
    wire(nz(c, 'white', t, t + 0.12), flt(c, 'bandpass', R(700, 1100), 0.8), pe(c, t, 0.0008, 1.5, 0.08), pre);
    thump(c, pre, t, R(150, 180), 50, 1.1, 0.13);
    wire(pre, amp(c, 0.2), verb(c, 0.6, 3, 0.5), out);
  } });

  def('pickup', { d: 0.4, sr: 32000, n: 3, vol: 0.55, max: 2, pv: 0.06, pri: 2, gap: 0.06, b: function (c, v, out) {
    swish(c, out, 0, R(0.08, 0.11), R(1200, 1600), R(2400, 3200), 0.6, 1.2, 'pink');   // roce al agarrar
    const t = R(0.05, 0.07), f = R(300, 340);
    clk(c, out, t, R(1400, 2200), 0.4, 0.03);
    thump(c, out, t, 340, 190, 0.5, 0.06);
    // tono hueco y grave que confirma (madera, no electrónico)
    wire(osc(c, 'sine', f, t, t + 0.25), pe(c, t, 0.002, 0.35, 0.18), out);
    wire(osc(c, 'sine', f * 1.5, t + 0.05, t + 0.3), pe(c, t + 0.05, 0.002, 0.3, 0.2), out);
    wire(osc(c, 'sine', f * 3.01, t + 0.05, t + 0.15), pe(c, t + 0.05, 0.001, 0.08, 0.06), out);
  } });

  def('eat', { d: 1.3, sr: 22050, n: 2, vol: 0.55, max: 1, pv: 0.06, pri: 1.6, gap: 0.3, b: function (c, v, out) {
    let t = 0.03;
    for (let i = 0; i < 4; i++) {
      // crujido + chasquido húmedo + mandíbula
      if (v === 0 || i === 0) grains(c, out, t, t + 0.07, R(5, 9) | 0, 1200, 4500, 0.3, 0.004, 0.02);
      const b = flt(c, 'bandpass', 700, 2);
      ramp(b.frequency, t, [[0, R(700, 1100)], [0.1, R(350, 500)]], true);
      wire(nz(c, 'pink', t, t + 0.15), b, pe(c, t + 0.01, 0.015, v ? 1 : 0.6, 0.1), out);
      thump(c, out, t, 150, 80, 0.3, 0.05);
      t += R(0.24, 0.3);
    }
  } });

  def('drink', { d: 1.3, sr: 22050, n: 2, vol: 0.55, max: 1, pv: 0.05, pri: 1.6, gap: 0.3, b: function (c, v, out) {
    // líquido que se mueve en la botella
    const am = amp(c, 0.5);
    wire(osc(c, 'sine', R(5, 7), 0, 1.2), amp(c, 0.5), am.gain);
    wire(nz(c, 'pink', 0, 1.2), flt(c, 'bandpass', R(1000, 1400), 1.5), am, pe(c, 0, 0.1, 0.25, 1.0), out);
    let t = 0.1;
    for (let i = 0; i < 3; i++) {
      // trago: garganta + burbuja ascendente
      thump(c, out, t, R(170, 200), 90, 0.6, 0.08);
      bubble(c, out, t + 0.01, R(240, 320), R(600, 850), R(0.04, 0.06), 0.5);
      if (v) bubble(c, out, t + R(0.08, 0.12), R(400, 500), R(900, 1200), 0.035, 0.25);
      wire(nz(c, 'white', t, t + 0.12), flt(c, 'bandpass', 700, 3), pe(c, t, 0.004, 0.5, 0.08), out);
      t += R(0.3, 0.38);
    }
  } });

  def('bandage', { d: 1.3, sr: 22050, n: 2, vol: 0.5, max: 1, pv: 0.05, pri: 1.5, gap: 0.3, b: function (c, v, out) {
    let t = 0.02;
    if (v === 0) {
      // tela que se rasga: crepitar denso
      const d = R(0.3, 0.4), g = amp(c, 0);
      ramp(g.gain, t, [[0, 0], [0.03, 1], [d * 0.7, 0.8], [d, 0]]);
      wire(nz(c, 'white', t, t + d + 0.02), flt(c, 'bandpass', R(2000, 3000), 0.7), g, out);
      grains(c, out, t, t + d, 30, 1500, 6000, 0.3, 0.002, 0.008);
      t += d + 0.08;
    }
    // vueltas de venda
    for (let i = 0; i < (v ? 3 : 2); i++) {
      swish(c, out, t, R(0.18, 0.25), R(700, 900), R(1600, 2200), 0.8, 1, 'pink');
      grains(c, out, t, t + 0.2, 6, 1500, 4000, 0.12, 0.004, 0.012);
      t += R(0.26, 0.32);
    }
  } });

  def('craft', { d: 1.6, sr: 24000, n: 3, vol: 0.6, max: 1, pv: 0.04, pri: 1.5, gap: 0.3, b: function (c, v, out) {
    const hammer = function (t) {
      clk(c, out, t, R(1800, 2600), 0.8, 0.05);
      thump(c, out, t, 260, 140, 0.6, 0.06);
      ring(c, out, t, R(700, 900), [1, 2.76, 5.4], 0.15, 0.2);
    };
    const saw = function (t, d, up) { scrape(c, out, t, d, up ? 1400 : 2400, up ? 2400 : 1400, 0.35, R(90, 140)); };
    const ratchet = function (t, n) {
      for (let i = 0; i < n; i++) clk(c, out, t + i * R(0.03, 0.04), R(2800, 3400), 0.35, 0.015);
    };
    if (v === 0) { hammer(0.03); hammer(R(0.35, 0.42)); saw(0.75, 0.3, 1); saw(1.1, 0.28, 0); }
    else if (v === 1) { saw(0.02, 0.3, 1); saw(0.36, 0.28, 0); saw(0.7, 0.3, 1); ratchet(1.1, 7); }
    else { ratchet(0.03, 8); ratchet(0.45, 8); hammer(0.9); hammer(R(1.15, 1.25)); }
  } });

  def('inv_open', { d: 0.75, sr: 24000, n: 3, vol: 0.5, max: 1, pv: 0.06, pri: 2, gap: 0.15, b: function (c, v, out) {
    // cremallera: los dientes (tren de pulsos) modulan un ruido agudo
    const t = 0.01, d = R(0.28, 0.4), r0 = R(160, 220), r1 = R(300, 420);
    const o = osc(c, 'sawtooth', r0, t, t + d + 0.02);
    ramp(o.frequency, t, [[0, r0], [d * 0.5, r1], [d, r0 * 0.8]], true);
    const am = amp(c, 0.15), g = amp(c, 0);
    wire(o, amp(c, 0.85), am.gain);
    ramp(g.gain, t, [[0, 0], [0.03, 1], [d * 0.8, 0.85], [d, 0]]);
    wire(nz(c, 'white', t, t + d + 0.02), flt(c, 'bandpass', R(2500, 3500), 1.1), am, g, out);
    wire(o, flt(c, 'bandpass', R(1200, 1600), 3), amp(c, 0.25), g);
    swish(c, out, t + d * 0.8, 0.22, 600, 1300, 0.45, 1, 'pink');   // tela de la mochila
  } });

  def('explosion', { d: 4.5, sr: 22050, n: 3, vol: 1, max: 2, pv: 0.06, pri: 3, gap: 0.06, rms: 0.42, b: function (c, v, out) {
    const t = 0.003, pre = amp(c, 1);
    wire(pre, shaper(c, 3), out);
    // estampido inicial
    wire(nz(c, 'white', t, t + 0.2), flt(c, 'highpass', R(1000, 1600), 0), pe(c, t, 0.001, 1.2, R(0.1, 0.15)), pre);
    // masa de la explosión: ruido que se oscurece
    const lp = flt(c, 'lowpass', 4000, 0);
    ramp(lp.frequency, t, [[0, R(3500, 5000)], [0.9, R(250, 350)]], true);
    wire(nz(c, 'pink', t, t + 1.2), lp, pe(c, t, 0.004, 2, R(0.7, 1)), pre);
    // banda media-grave: es el "bum" que sí suena en el altavoz del móvil
    wire(nz(c, 'white', t, t + 0.8), flt(c, 'bandpass', R(280, 420), 0.8), pe(c, t, 0.003, 1.6, R(0.45, 0.6)), pre);
    // sub + armónicos (el saturador añade más)
    const o = osc(c, 'sine', 60, t, t + 1.5);
    ramp(o.frequency, t, [[0, R(55, 68)], [0.7, R(22, 28)]], true);
    wire(o, pe(c, t, 0.005, 2.2, 1.3), pre);
    thump(c, pre, t, R(130, 150), 55, 1.1, 0.55);
    thump(c, pre, t, R(260, 300), 110, 0.6, 0.28);
    // cola grave larga, sin saturar: caída lenta como un trueno cercano
    const tail = function (f, pk, tau, t1) {
      const g = amp(c, 0);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(pk, t + 0.08);
      g.gain.setTargetAtTime(0, t + 0.1, tau);
      wire(nz(c, 'brown', t, t1), f, g, out);
    };
    const tl = flt(c, 'lowpass', 600, 0);
    ramp(tl.frequency, t, [[0, 600], [3.5, 90]], true);
    tail(tl, 1.3, R(0.6, 0.75), 4.4);
    tail(flt(c, 'bandpass', R(180, 240), 1.2), 0.6, R(0.4, 0.5), 3.2);   // retumbo que llega al altavoz del móvil
    // escombros que caen
    grains(c, out, 0.25, 2.0, 18, 800, 4000, 0.14, 0.01, 0.04);
    for (let i = 0; i < 3; i++) thump(c, out, R(0.5, 1.8), R(180, 260), 80, R(0.15, 0.3), 0.08);
    wire(pre, amp(c, 0.4), verb(c, 2.5, 2.2, 0.35), out);
  } });

  def('glass_break', { d: 1.4, sr: 32000, n: 3, vol: 0.75, max: 3, pv: 0.06, pri: 1.7, gap: 0.05, rms: 0.28, b: function (c, v, out) {
    const t = 0.003;
    wire(nz(c, 'white', t, t + 0.06), flt(c, 'highpass', R(2500, 3500), 0), pe(c, t, 0.0004, 1.5, 0.04), out);
    wire(nz(c, 'white', t, t + 0.1), flt(c, 'bandpass', R(1800, 2600), 1), pe(c, t, 0.001, 1, 0.06), out);
    thump(c, out, t, 420, 200, 0.3, 0.04);
    // fragmentos que tintinean
    const n = 14 + ((Math.random() * 7) | 0);
    for (let i = 0; i < n; i++) {
      const tt = t + 0.002 + 0.55 * Math.pow(Math.random(), 2), f = R(2200, 8500), dd = R(0.04, 0.22);
      const lv = R(0.1, 0.35) * (1 - (tt - t) * 1.2);
      wire(osc(c, 'sine', f, tt, tt + dd + 0.03), pe(c, tt, 0.0005, lv, dd), out);
      if (f * 2.7 < 14000) wire(osc(c, 'sine', f * 2.7, tt, tt + dd * 0.5 + 0.03), pe(c, tt, 0.0005, lv * 0.4, dd * 0.5), out);
    }
    grains(c, out, 0.01, 0.6, 22, 3000, 9000, 0.25, 0.003, 0.015);
    grains(c, out, 0.35, 1.0, 10, 2500, 7000, 0.12, 0.004, 0.012);   // trozos que rebotan
  } });

  def('molotov_throw', { d: 1.0, sr: 22050, n: 2, vol: 0.6, max: 2, pv: 0.06, pri: 1.6, gap: 0.15, b: function (c, v, out) {
    const d = R(0.6, 0.8), t = 0.01, rot = R(7, 11);
    swish(c, out, 0, 0.18, 500, 1400, 0.5, 1.3, 'pink');   // impulso del brazo
    // botella girando: silbido modulado por la rotación
    const am = amp(c, 0.4), g = amp(c, 0);
    wire(osc(c, 'sine', rot, t, t + d), amp(c, 0.6), am.gain);
    const b = flt(c, 'bandpass', 900, 2);
    ramp(b.frequency, t, [[0, R(700, 900)], [d * 0.5, R(1300, 1600)], [d, R(800, 1000)]], true);
    ramp(g.gain, t, [[0, 0], [0.12, 1], [d * 0.7, 0.8], [d, 0]]);
    wire(nz(c, 'pink', t, t + d + 0.02), b, am, g, out);
    // líquido que se agita (a contratiempo) y trapo ardiendo
    const am2 = amp(c, 0.5);
    wire(osc(c, 'sine', rot, t + 0.5 / rot, t + d), amp(c, 0.5), am2.gain);
    wire(nz(c, 'pink', t, t + d + 0.02), flt(c, 'bandpass', R(400, 550), 3), am2, amp(c, 0.6), g);
    wire(nz(c, 'brown', t, t + d + 0.02), flt(c, 'lowpass', 300, 0), amp(c, 0.5), g);
  } });

  // Con entrada y salida suaves: se puede repetir solapado.
  def('fire_burn', { d: 1.7, sr: 22050, n: 3, vol: 0.55, max: 2, pv: 0.08, pri: 1, gap: 0.25, b: function (c, v, out) {
    const g = amp(c, 0);
    ramp(g.gain, 0, [[0, 0], [0.2, 1], [1.15, 0.9], [1.6, 0]]);
    g.connect(out);
    flames(c, g, 0, 1.62);
  } });

  def('weapon_break', { d: 1.1, sr: 32000, n: 2, vol: 0.8, max: 2, pv: 0.05, pri: 2, gap: 0.2, rms: 0.3, b: function (c, v, out) {
    const pre = amp(c, 1), t = 0.003;
    wire(pre, shaper(c, 2.5), out);
    wire(nz(c, 'white', t, t + 0.1), flt(c, 'bandpass', R(1500, 2500), 0.8), pe(c, t, 0.0004, 2, 0.05), pre);
    thump(c, pre, t, R(160, 200), 80, 0.7, 0.08);
    if (v === 0) {
      // madera que se parte: astillas
      grains(c, pre, t, t + 0.15, 12, 1200, 5000, 0.35, 0.004, 0.02);
      creak(c, pre, t, 0.12, R(90, 120), R(160, 200), 0.4, [[1000, 5, 1], [2300, 6, 0.5]]);
    } else {
      // metal que se quiebra: resonancia inarmónica
      clk(c, pre, t, R(2800, 3400), 1, 0.05);
      ring(c, out, t, R(700, 1000), [1, 2.76, 5.4, 8.9], 0.3, 0.6);
    }
    // el trozo cae al suelo y rebota
    const tt = R(0.35, 0.5);
    if (v === 0) { thump(c, out, tt, 220, 120, 0.3, 0.06); ring(c, out, tt, R(450, 600), [1, 2.7, 5.2], 0.15, 0.08); }
    else { clk(c, out, tt, R(2000, 2600), 0.5, 0.04); ring(c, out, tt, R(900, 1200), [1, 2.76, 5.4], 0.15, 0.3); }
    clk(c, out, tt + R(0.1, 0.16), R(1800, 2400), 0.2, 0.03);
  } });

  def('hunger_stomach', { d: 1.9, sr: 16000, n: 2, vol: 0.4, max: 1, pv: 0.08, pri: 1.2, gap: 1, b: function (c, v, out) {
    const d = R(1.2, 1.6), f = R(70, 95);
    voice(c, out, { d: d, f0: [[0, f], [d * 0.3, f * 1.6], [d * 0.6, f * 0.9], [d, f * 1.3]],
      amp: [[0.15, 0.5], [d * 0.3, 0.9], [d * 0.5, 0.3], [d * 0.75, 0.8], [d, 0]],
      F: [[gl(280, 420, d), 3, 1], [gl(650, 800, d), 4, 0.35]],
      fry: [[0, R(9, 14)], [d, R(5, 8)]], fryD: 0.85, jit: 0.25, wet: 60, breath: 0.08, bn: 'brown',
      drive: 1.5, body: 0.5, bodyF: 260 });
    // burbujas de gases
    for (let i = 0; i < 4 + v * 2; i++) bubble(c, out, R(0.1, d), R(140, 200), R(300, 480), R(0.03, 0.06), R(0.15, 0.3));
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
    } },

    // Fuego cercano (molotov, fogata) para setFire; mono para ahorrar memoria.
    fire: { L: 6, F: 1, sr: 16000, ch: 1, lin: false, b: function (c, T, out) { flames(c, out, 0, T); } }
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
      return render(L.ch || 2, T, L.sr, function (c) { L.b(c, T, c.destination); }).then(function (buf) {
        const out = makeLoop(buf, L.L, L.F, L.lin);
        if (out) startLayer(key, out);
      });
    };
  }

  // Primero una variación de cada sonido (por importancia), luego el resto.
  function buildJobs() {
    const order = ['shot_pistol', 'shot_shotgun', 'shot_rifle', 'shot_smg', 'footstep', 'zombie_groan', 'hit_flesh',
      'melee_swing', 'melee_hit', 'zombie_attack', 'empty_click', 'reload', 'shove', 'bullet_wall', 'ui_click',
      'pickup', 'player_hurt', 'zombie_death', 'door_open', 'door_close', 'flashlight', 'inv_open', '@wind',
      'ui_notify', 'chest_open', 'door_bash', 'door_break', 'trap_trigger', 'explosion', 'glass_break',
      'molotov_throw', 'fire_burn', '@fire', 'weapon_break', 'heartbeat', 'stalker_hiss', 'scream', 'tank_roar',
      'tank_stomp', 'tank_charge', 'eat', 'drink', 'bandage', 'craft', 'chest_alarm', 'player_death', '@drone',
      '@rain', 'thunder', 'hunger_stomach', 'amb_crow', 'amb_howl', 'amb_pad', 'amb_bell', '@tension'];
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
    comp = ctx.createDynamicsCompressor();
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
    // exterior (viento, lluvia, truenos, lejanos): paso-bajo que se cierra al entrar a un edificio
    wxLp = ctx.createBiquadFilter();
    wxLp.type = 'lowpass';
    wxLp.frequency.value = Math.min(WX_OPEN, ctx.sampleRate * 0.45);
    wxLp.Q.value = -3;   // sin resonancia (Butterworth)
    wxLp.connect(ambBus);
    applied.indoor = 0;
    // sala de interior: envío desde los efectos a una convolución corta (silenciosa si indoor = 0)
    roomIn = ctx.createGain();
    roomIn.gain.value = 0;
    try {
      const cv = ctx.createConvolver();
      cv.normalize = false;
      cv.buffer = roomIR(ctx.sampleRate);
      sfxBus.connect(roomIn);
      roomIn.connect(cv);
      cv.connect(comp);
    } catch (e) { /* sin sala */ }
    const names = ['wind', 'rain', 'drone', 'tension', 'music', 'fire'];
    for (let i = 0; i < names.length; i++) {
      const g = ctx.createGain();
      g.gain.value = 0;
      if (i < 5) g.connect(i < 2 ? wxLp : ambBus);
      layers[names[i]] = g;
      applied[names[i]] = -1;
    }
    layers.wind.gain.value = 0.3;   // viento de fondo aunque aún no llamen a setAmbience (menú)
    applied.wind = 0.3;
    // fuego cercano: va a efectos (recibe sala); el filtro se abre con la intensidad
    fireLp = ctx.createBiquadFilter();
    fireLp.type = 'lowpass';
    fireLp.frequency.value = 1500;
    layers.fire.connect(fireLp);
    fireLp.connect(sfxBus);
    applied.fire = 0;
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
    lp.connect(wxLp);
    lp.connect(dl);
    dl.connect(fb);
    fb.connect(dl);
    dl.connect(wet);
    wet.connect(wxLp);
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
      let vol = d.vol, pan = 0, cut = 0, dest = sfxBus;
      if (opts && typeof opts.volume === 'number') vol *= opts.volume;
      if (typeof x === 'number' && typeof y === 'number' && isFinite(x) && isFinite(y)) {
        const dx = x - lx, dy = y - ly, dist = Math.sqrt(dx * dx + dy * dy);
        if (dist >= MAX_DIST) return false;
        const t = dist <= NEAR ? 0 : (dist - NEAR) / (MAX_DIST - NEAR), a = 1 - t;
        vol *= a * a;
        pan = (dx < -PAN_W ? -1 : dx > PAN_W ? 1 : dx / PAN_W) * 0.85;
        if (t > 0.2) cut = 900 + 16000 * a * a * a;   // lo lejano suena apagado
      } else if (d.wx) { dest = wxLp; vol /= 0.9; }   // trueno: se amortigua bajo techo (ambBus = 0.9)
      if (d.dry) dest = comp;                          // interfaz: sin sala
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
      tail.connect(dest);
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

  // Transición suave; al ir a 0 fija 0 exacto después, para que el grafo quede en silencio
  // (así la convolución y los filtros detrás dejan de procesar).
  function glide(p, v, tau, now) {
    p.cancelScheduledValues(now);
    p.setTargetAtTime(v, now, tau);
    if (v === 0) p.setValueAtTime(0, now + tau * 8);
  }

  // Interior: cierra el paso-bajo de exterior y abre el envío a la sala.
  function applyIndoor(now) {
    const v = amb.indoor;
    if (Math.abs(v - applied.indoor) < 0.004 && !(v === 0 && applied.indoor !== 0)) return;
    applied.indoor = v;
    const f = Math.min(WX_OPEN, ctx.sampleRate * 0.45) * Math.pow(WX_SHUT / WX_OPEN, v);
    wxLp.frequency.setTargetAtTime(f, now, 0.35);
    glide(roomIn.gain, ROOM_SEND * v, 0.35, now);
  }

  // Bucle de fuego cercano: volumen y brillo según la intensidad.
  function applyFire(now) {
    const v = fireLvl;
    if (Math.abs(v - applied.fire) < 0.01 && !(v === 0 && applied.fire !== 0)) return;
    applied.fire = v;
    glide(layers.fire.gain, 0.9 * Math.pow(v, 0.8), 0.25, now);
    fireLp.frequency.setTargetAtTime(1200 + 6800 * v, now, 0.25);
  }

  const PAD_ST = [-12, -7, -5, 0, 0, 1, 3, 5, 7];   // La frigio, registro grave
  const BELL_ST = [0, 1, 3, 7, 8, 12, -5];

  function tickAmbience(now) {
    const s = amb, dead = s.health <= 0.001;
    const combat = dead ? 0 : s.combat;
    // capas en bucle (bajo techo el viento y la lluvia bajan y se apagan)
    const ind = s.indoor;
    lvl('wind', (0.3 + 0.25 * s.rain + 0.08 * s.night) * (1 - 0.6 * ind), 2, now);
    lvl('rain', 0.8 * Math.pow(s.rain, 1.3) * (1 - 0.45 * ind), 1.5, now);
    applyIndoor(now);
    applyFire(now);
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
        fire('heartbeat', beatT, (0.45 + 0.55 * (1 - k)) * S.heartbeat.vol, 1, 0, comp);   // interno: sin sala
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
        amb.indoor = num(o.indoor, amb.indoor);
      }
      if (!ctx || A.muted || ctx.state !== 'running') return;
      const now = ctx.currentTime;
      if (now - ambT < 0.1) return;   // ~10 veces por segundo es suficiente
      ambT = now;
      tickAmbience(now);
    } catch (e) { /* nada */ }
  }

  // Fuego cercano 0..1 (molotov, fogata); 0 lo silencia. Se puede llamar cada frame.
  function setFire(i) {
    try {
      fireLvl = num(i, 0);
      if (!ctx || A.muted || ctx.state !== 'running') return;
      applyFire(ctx.currentTime);
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
