// Tierra Muerta — Zombie: percepción, comportamientos por tipo/etapa, combate y dibujo procedural.
(function () {
  'use strict';
  const TM = window.TM = window.TM || {};

  // ---------- utilidades locales ----------
  const PI = Math.PI, TAU = PI * 2;
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function rr(a, b) { return a + Math.random() * (b - a); }
  function angDiff(a, b) {
    let d = (b - a) % TAU;
    if (d > PI) d -= TAU; else if (d < -PI) d += TAU;
    return d;
  }
  function sfx(name, x, y, opts) {
    const A = TM.Audio;
    if (A && typeof A.play === 'function') { try { A.play(name, x, y, opts); } catch (e) { /* audio opcional */ } }
  }
  function fx(g, name, a, b, c, d, e) {
    const f = g && g.fx;
    if (f && typeof f[name] === 'function') f[name](a, b, c, d, e);
  }
  function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    const r = clamp(((n >> 16) & 255) * f, 0, 255) | 0;
    const g = clamp(((n >> 8) & 255) * f, 0, 255) | 0;
    const b = clamp((n & 255) * f, 0, 255) | 0;
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }
  function mulberry(seed) {
    let s = (seed >>> 0) || 1;
    return function () {
      let t = (s += 0x6D2B79F5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // subtrayectos sin líneas de unión
  function circ(ctx, x, y, r) { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, TAU); }
  function ell(ctx, x, y, rx, ry, rot) {
    ctx.moveTo(x + rx * Math.cos(rot), y + rx * Math.sin(rot));
    ctx.ellipse(x, y, rx, ry, rot, 0, TAU);
  }

  const CLOTH = ['#4a4f3a', '#5a4636', '#3d4552', '#575757', '#6b5a45', '#3f3a35', '#4f3f4a', '#55603f', '#6a4a3a', '#3b4a4a', '#5c5040', '#463c52', '#6b6a60', '#3a3f2c'];
  const SKIN = ['#7f8b70', '#8a8f78', '#76806a', '#8c8a74', '#6f7a66', '#858c7a', '#7a7f6c'];
  const HAIR = ['#2a2420', '#3a2f25', '#1f1c1a', '#4a4038', '#5a5048', '#3b3530'];

  // ---------- ajustes ----------
  const CORPSE_TIME = 7;       // segundos que el cadáver permanece antes de desvanecerse
  const CORPSE_FADE = 2;
  const LOSE_TRACK = 1.2;      // segundos sin ver al jugador antes de ir a su último punto
  const SCREAM_CD = 15;
  const CHARGE_WINDUP = 0.6;
  const STUN_TIME = 1.2;
  const BUSY = { stagger: 1, windup: 1, recover: 1, crouch: 1, lunge: 1, cwind: 1, charge: 1, brake: 1, stun: 1, inflate: 1, dodge: 1, rise: 1 };
  const PASSIVE = { wander: 1, search: 1, investigate: 1 };
  const TOKEN_STATES = { chase: 1, windup: 1, recover: 1, crouch: 1, lunge: 1, keepaway: 1 };
  const CROUCH_TIME = 0.45;    // telegrafiado del salto del acechador (siseo + agazapado)
  const CHARGE_DMG = 1.4;      // multiplicador de daño de la embestida del tanque
  const VARIANTS = { normal: 8, acechador: 3, griton: 3, tanque: 2 };
  const TYPE_SEED = { normal: 1013, acechador: 2027, griton: 3041, tanque: 4057 };

  const TMP = { x: 0, y: 0 };
  const QBUF = [];
  let NEXT_ID = 1;

  // ---------- caché de sprites (cuerpo + ropa + contorno pre-renderizados por variante y pose) ----------
  const SPRITE_BUDGET = 8;                     // sprites nuevos por frame como máximo (si no, dibujo vectorial)
  // memoria máxima del caché según la calidad; al superarla se vacía y se reconstruye a demanda
  const SPRITE_MAX_MB = { low: 8, med: 14, high: 24 };
  const OUTLINE = 'rgba(12,10,8,0.62)';        // contorno oscuro sutil: mejor lectura sobre el suelo
  const OUTLINE_CORPSE = 'rgba(12,10,8,0.4)';
  const OUT_OFFS = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]];
  // límites de dibujo en múltiplos de r: [x0, x1, y0, y1] (x = hacia delante)
  const BOUNDS = {
    normal: [-0.85, 2.75, -1.9, 1.9], acechador: [-1.15, 2.85, -1.5, 1.5],
    griton: [-1.2, 1.4, -1.2, 1.2], tanque: [-1.0, 2.4, -1.85, 1.85], corpse: [-1.75, 1.75, -1.55, 1.55],
  };
  const POSE = { sw: 0, raise: 0, strike: 0, crouch: 0, lunge: 0, open: 0, corpse: 0, twitch: 0 };
  const SPR = { map: new Map(), S: 0, bytes: 0, budget: SPRITE_BUDGET, lastT: 0, scratch: null, shadow: null, glow: {}, built: 0, gen: 0 };
  function clearCache() { SPR.map.clear(); SPR.bytes = 0; SPR.gen++; }

  function newCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

  // Resolución del sprite (px por unidad de mundo): ≥ la de pantalla y al menos 2× para que se vea nítido
  function spriteScale() {
    const g = TM.game, rd = g && g.renderer, cam = g && g.camera;
    const s = ((rd && rd.dpr) || 1) * ((cam && cam.zoom) || 1);
    return clamp(Math.ceil(s * 2) / 2, 2, 4);
  }

  function getSprite(z, key, P) {
    const S = spriteScale();
    if (S !== SPR.S) { clearCache(); SPR.S = S; }
    let sp = SPR.map.get(key);
    if (sp) return sp;
    const now = performance.now();
    if (now - SPR.lastT > 12) { SPR.lastT = now; SPR.budget = SPRITE_BUDGET; }
    if (SPR.budget <= 0) return null;
    SPR.budget--;
    const q = TM.Config && TM.Config.quality;
    if (SPR.bytes > (SPRITE_MAX_MB[q] || 14) * 1048576) clearCache();
    sp = buildSprite(z, P, S);
    SPR.map.set(key, sp);
    SPR.bytes += sp.c.width * sp.c.height * 4;
    SPR.built++;
    return sp;
  }

  function buildSprite(z, P, S) {
    const r = z.r, B = P.corpse ? BOUNDS.corpse : BOUNDS[z.type];
    const o = Math.max(1, Math.round(S * 0.55)); // grosor del contorno (px)
    const pad = o + 1;
    const w = Math.ceil((B[1] - B[0]) * r * S) + pad * 2;
    const h = Math.ceil((B[3] - B[2]) * r * S) + pad * 2;
    let scr = SPR.scratch;
    if (!scr) scr = SPR.scratch = newCanvas(w, h);
    if (scr.width < w || scr.height < h) { scr.width = Math.max(scr.width, w); scr.height = Math.max(scr.height, h); }
    const sc = scr.getContext('2d');
    sc.setTransform(1, 0, 0, 1, 0, 0);
    sc.globalAlpha = 1;
    sc.globalCompositeOperation = 'source-over';
    sc.clearRect(0, 0, scr.width, scr.height);
    sc.setTransform(S, 0, 0, S, pad - B[0] * r * S, pad - B[2] * r * S);
    sc.lineCap = 'round'; sc.lineJoin = 'round';
    if (P.corpse) z._drawCorpseBody(sc, P); else z._drawBody(sc, P);
    // contorno: silueta desplazada en 8 direcciones, teñida, y el cuerpo encima
    const out = newCanvas(w, h);
    const oc = out.getContext('2d');
    for (let i = 0; i < OUT_OFFS.length; i++) oc.drawImage(scr, 0, 0, w, h, OUT_OFFS[i][0] * o, OUT_OFFS[i][1] * o, w, h);
    oc.globalCompositeOperation = 'source-in';
    oc.fillStyle = P.corpse ? OUTLINE_CORPSE : OUTLINE;
    oc.fillRect(0, 0, w, h);
    oc.globalCompositeOperation = 'source-over';
    oc.drawImage(scr, 0, 0, w, h, 0, 0, w, h);
    return { c: out, ox: pad / S - B[0] * r, oy: pad / S - B[2] * r, w: w / S, h: h / S };
  }

  // Sombra elíptica suave compartida
  function shadowSprite() {
    if (SPR.shadow) return SPR.shadow;
    const c = newCanvas(64, 64), g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(0,0,0,0.42)');
    gr.addColorStop(0.55, 'rgba(0,0,0,0.3)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return (SPR.shadow = c);
  }

  // Par de ojos brillantes por tipo y orientación (16 direcciones), centrado entre ambos ojos
  function eyePair(type, di, off, er, red) {
    const key = type + di;
    let e = SPR.glow[key];
    if (e) return e;
    const S = 4;                              // px por unidad (son muy pequeños)
    const half = off + er * 1.6 + 0.5;        // semiancho en unidades de mundo
    const n = Math.ceil(half * 2 * S);
    const c = newCanvas(n, n), g = c.getContext('2d');
    const a = di * TAU / 16;
    const px = -Math.sin(a) * off, py = Math.cos(a) * off;
    const dot = glowSprite(red ? 'red' : 'yellow');
    const es = er * 3.2 * S;
    const cx = n / 2, cy = n / 2;
    g.drawImage(dot, cx + px * S - es / 2, cy + py * S - es / 2, es, es);
    g.drawImage(dot, cx - px * S - es / 2, cy - py * S - es / 2, es, es);
    e = { c, h: n / 2 / S };
    SPR.glow[key] = e;
    return e;
  }

  // Puntos de brillo (ojos y halo) pre-renderizados
  function glowSprite(kind) {
    let c = SPR.glow[kind];
    if (c) return c;
    const rgb = kind === 'yellow' ? '240,205,95' : kind === 'red' ? '255,45,25' : '255,40,20';
    c = newCanvas(32, 32);
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    if (kind === 'halo') {
      gr.addColorStop(0, 'rgba(' + rgb + ',0.3)');
      gr.addColorStop(1, 'rgba(' + rgb + ',0)');
    } else {
      gr.addColorStop(0, 'rgba(' + rgb + ',1)');
      gr.addColorStop(0.4, 'rgba(' + rgb + ',1)');
      gr.addColorStop(0.6, 'rgba(' + rgb + ',0.35)');
      gr.addColorStop(1, 'rgba(' + rgb + ',0)');
    }
    g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
    return (SPR.glow[kind] = c);
  }

  class Zombie {
    // opts: { game, day, profile, danger, state: 'fakeDead'|'ambush', seed, alertX, alertY }
    constructor(type, x, y, opts) {
      opts = opts || {};
      this.id = NEXT_ID++;
      this.type = (type === 'acechador' || type === 'griton' || type === 'tanque') ? type : 'normal';
      this.game = opts.game || TM.game;
      this.x = x; this.y = y;
      this.vx = 0; this.vy = 0;
      this.kx = 0; this.ky = 0;          // empuje externo (retroceso)
      this.dead = false; this.fakeDead = false; this.remove = false;
      this.angle = Math.random() * TAU;
      this.runner = false;
      this._applyStats(opts.day || 1, opts.profile, opts.danger || 0, true);

      this.state = 'wander'; this.stateT = 0;
      this.alerted = false;
      this.seesPlayer = false;
      this.unseenT = 99;                 // segundos desde que vio al jugador
      this.lkX = x; this.lkY = y;        // último punto conocido
      this.urgent = false;
      this.tx = x; this.ty = y;          // objetivo de movimiento (flanqueo, rodeo, cobertura)
      this.flanking = false; this.flankAngle = null;
      this.thinkT = Math.random() * 0.3; this.lastThink = 0.2;
      this.atkCd = rr(0.2, 0.6); this.windDur = 0.3;
      this.hasToken = false; this.tokenT = 0;
      this.dodgeCd = rr(0.5, 1.5); this.dodgeX = 0; this.dodgeY = 0; this.dodgeSpeed = 0;
      this.coverCd = rr(1, 3); this.coverX = x; this.coverY = y; this.hideDur = 1;
      this.retreats = 0;
      this.screamCd = rr(1.5, 3); this.screamAnim = 0;
      this.chargeCd = rr(2.5, 5); this.chargeDX = 1; this.chargeDY = 0; this.chargeDist = 0;
      this.stalkT = 0; this.stalkSpd = 0; this.withdrawDur = 2; this.fleeing = false;
      this.wanderA = Math.random() * TAU; this.wanderDur = rr(1, 4); this.idle = Math.random() < 0.4;
      this.searchDur = 3; this.staggerDur = 0.6;
      this.groanT = rr(2, 10);
      this.stepAcc = 0;
      this.flash = 0; this.unhitT = 99;
      this.walkPhase = Math.random() * TAU;
      this.armRaise = 0; this.strike = 0; this.crouch = 0; this.inflate = 0;
      this.deathT = 0; this.alpha = 1; this.fallA = this.angle;
      this.group = null; this.ambushA = this.angle;
      this.homing = 0;                   // segundos guiados hacia el jugador (horda del gritón)
      this.navDirect = true; this.detourT = 0; this.detourA = 0;
      this.navTX = null; this.navTY = null;        // objetivo de navegación actual (para medir progreso)
      this.ancX = x; this.ancY = y; this.ancT = 0; // ventana de avance real
      this.stuckN = 0; this.forceFlowT = 0;        // escalada anti-atasco
      this.waitT = 0;                              // espera al acecho (sin camino para su cuerpo)
      this.side = Math.random() < 0.5 ? 1 : -1;
      this.wantSpd = 0;
      // desplazamiento propio al investigar (no se amontonan en el mismo punto)
      const ia = this.id * 2.39996, ir = 18 + ((this.id * 37) % 50);
      this.invOX = Math.cos(ia) * ir; this.invOY = Math.sin(ia) * ir;
      this.twitchT = rr(2, 6); this.twitch = 0;
      this.speedMag = 0;
      this._pd = 9999; this._nx = 0; this._ny = 0; this._snap = false;
      this.voice = this.type === 'tanque' ? 0.6 : this.type === 'griton' ? 1.3 : this.type === 'acechador' ? 1.2 : rr(0.85, 1.12);
      // aspecto: variantes compartidas por tipo (permiten reutilizar sprites)
      const seed = opts.seed != null ? opts.seed : (Math.random() * 1e9) | 0;
      this.variant = (seed >>> 0) % VARIANTS[this.type];
      this._initLook(TYPE_SEED[this.type] + this.variant * 7919);

      if (opts.state === 'fakeDead') this.setFakeDead();
      else if (opts.state === 'ambush') { this.state = 'ambush'; this.crouch = 0.6; }
      if (opts.alertX != null) this.alertTo(opts.alertX, opts.alertY, opts.knows !== false);
    }

    // ---------- estadísticas ----------
    _applyStats(day, profile, danger, initial) {
      const s = TM.Evolution ? TM.Evolution.stats(this.type, day, profile, danger) : {
        type: this.type, stage: 1, r: 11, hp: 55, speed: 55, runSpeed: 140, runChance: 0, speedVar: 0.15,
        damage: 9, attackCooldown: 1.15, windup: 0.38, reach: 13, sight: 1, hearing: 1, dodgeChance: 0,
        coverChance: 0, flank: false, retreat: false, fakeDead: false, canCharge: false, chargeSpeed: 380,
        packRadius: 170, regen: 0, mut: {}, resist: {},
      };
      const frac = initial ? 1 : clamp(this.hp / this.maxHp, 0.05, 1);
      this.s = s;
      this.stage = s.stage;
      this.r = s.r;
      this.mass = s.r * s.r;
      this.maxHp = s.hp;
      this.hp = s.hp * frac;
      if (initial) this.vf = 1 + (Math.random() * 2 - 1) * s.speedVar;
      if (!this.runner && s.runChance > 0 && Math.random() < s.runChance) this.runner = true;
      this.chaseSpeed = (this.runner ? s.runSpeed : s.speed) * this.vf;
      this.wanderSpeed = Math.min(s.speed * this.vf, 60) * 0.4;
    }

    // Recalcula al cambiar de etapa/día (mantiene el % de vida)
    refreshStats(day, profile, danger) {
      if (this.dead) return;
      this._applyStats(day, profile, danger, false);
    }

    // ---------- apariencia ----------
    _initLook(seed) {
      const R = mulberry(seed);
      const pick = (arr) => arr[(R() * arr.length) | 0];
      let cloth = pick(CLOTH), skin = pick(SKIN);
      if (this.type === 'acechador') { skin = pick(['#5c6468', '#626a6a', '#585f63', '#5f655c']); cloth = pick(['#2e2c2a', '#35322e', '#2b2f33']); }
      else if (this.type === 'griton') { skin = pick(['#b8b69c', '#c2bda2', '#aeb19a', '#bdb59a']); cloth = pick(['#6b6656', '#5e5a4c', '#5a4e44']); }
      else if (this.type === 'tanque') { skin = pick(['#5e5048', '#62544a', '#584c44', '#5d5245']); cloth = pick(['#3a3530', '#2f3a3a', '#403632']); }
      const v = 0.82 + R() * 0.28;
      this.cCloth = shade(cloth, v);
      this.cClothDark = shade(cloth, v * 0.6);
      this.cSkin = shade(skin, 0.9 + R() * 0.18);
      this.cSkinDark = shade(skin, 0.68);
      this.cSkinLight = shade(skin, 1.1);
      this.cHair = shade(pick(HAIR), 0.85 + R() * 0.3);
      this.cBlood = 'rgba(' + (88 + ((R() * 34) | 0)) + ',12,10,0.85)';
      // parches (múltiplos de r): [x, y, rx, ry, rot]
      this.tears = [];
      const nt = 1 + ((R() * 3) | 0);
      for (let i = 0; i < nt; i++) this.tears.push([R() * 0.9 - 0.55, (R() * 2 - 1) * 0.65, 0.1 + R() * 0.16, 0.07 + R() * 0.12, R() * PI]);
      this.shadows = [];
      const ns = 1 + ((R() * 2) | 0);
      for (let i = 0; i < ns; i++) this.shadows.push([R() * 0.8 - 0.5, (R() * 2 - 1) * 0.6, 0.15 + R() * 0.2, 0.1 + R() * 0.16, R() * PI]);
      this.stains = [];
      const nb = 1 + ((R() * 3) | 0);
      for (let i = 0; i < nb; i++) this.stains.push([R() * 0.9 - 0.45, (R() * 2 - 1) * 0.6, 0.08 + R() * 0.2, 0.06 + R() * 0.14, R() * PI]);
      this.plates = [];
      for (let i = 0; i < 5; i++) this.plates.push([-0.75 + R() * 0.75, (R() * 2 - 1) * 0.85, 0.16 + R() * 0.12, 0.12 + R() * 0.1, R() * PI]);
      this.bald = R() < 0.3;
      this.lieSide = R() < 0.5 ? 1 : -1;
      this.lean = (R() * 2 - 1) * 0.12;
      this.armOff = R() * 0.25;
      this.wound = R() < 0.4;
    }

    // ---------- estados ----------
    setState(s) {
      this.state = s;
      this.stateT = 0;
      // el turno de ataque solo se conserva en estados de ataque
      if (this.hasToken && !TOKEN_STATES[s]) {
        const dir = this.game && this.game.director;
        if (dir && dir.releaseToken) dir.releaseToken(this); else this.hasToken = false;
      }
      switch (s) {
        case 'windup': this.windDur = this.s.windup; break;
        case 'search': this.searchDur = rr(2.5, 4.5); break;
        case 'hide': this.hideDur = rr(0.7, 1.6); break;
        case 'withdraw': this.withdrawDur = rr(1.5, 2.5); break;
        case 'stalk': this.stalkT = 0; break;
        case 'wander': this.urgent = false; this.wanderDur = rr(0.5, 2); break;
      }
    }

    _resumeState() {
      if (this.type === 'acechador') return 'stalk';
      if (this.type === 'griton') return 'keepaway';
      return 'chase';
    }

    setFakeDead() {
      this.state = 'fakeDead'; this.stateT = 0;
      this.fakeDead = true;
      this.fallA = Math.random() * TAU;
      this.vx = this.vy = 0;
    }

    // Lo alertan (grito, compañeros, golpe): sabe dónde está el jugador
    alertTo(x, y, knows) {
      if (this.dead || this.state === 'fakeDead' || this.state === 'ambush') return;
      this.lkX = x; this.lkY = y;
      this.alerted = true;
      this.urgent = true;
      if (knows) this.unseenT = Math.min(this.unseenT, 0.6);
      if (PASSIVE[this.state]) this.setState(knows ? this._resumeState() : 'investigate');
    }

    // Activación de emboscada
    activate(g) {
      if (this.dead || this.state !== 'ambush') return;
      const p = g.player;
      this.crouch = 0;
      this.alerted = true; this.unseenT = 0; this.urgent = true;
      if (p) { this.lkX = p.x; this.lkY = p.y; }
      this.setState(this._resumeState());
    }

    // Se levanta (fingía estar muerto)
    rise(g) {
      if (this.dead || this.state !== 'fakeDead') return;
      this.fakeDead = false;
      this.angle = this.fallA + PI;
      this.setState('rise');
      this.alerted = true; this.unseenT = 0; this.urgent = true;
      const p = g && g.player;
      if (p) { this.lkX = p.x; this.lkY = p.y; }
      fx(g, 'dust', this.x, this.y, 5);
      sfx(this.type === 'acechador' ? 'stalker_hiss' : 'zombie_groan', this.x, this.y, { pitch: this.voice * 0.9, volume: 1 });
    }

    // Ruido percibido (llamado por el director)
    hearNoise(x, y, kind, frac, g) {
      if (this.dead) return;
      const st = this.state;
      if (st === 'fakeDead' || st === 'ambush') return;
      const p = g.player;
      if (kind === 'scream') {
        if (p && p.alive !== false) { this.lkX = p.x; this.lkY = p.y; this.unseenT = Math.min(this.unseenT, 0.3); }
        this.alerted = true; this.urgent = true;
        if (PASSIVE[st]) this.setState(this._resumeState());
        return;
      }
      if (this.seesPlayer) return;
      this.lkX = x; this.lkY = y; // cada uno investiga alrededor con su propio desplazamiento (invOX/invOY)
      if (PASSIVE[st]) {
        this.urgent = kind === 'shot' ? frac < 0.75 : kind === 'shove';
        this.setState('investigate');
      }
    }

    // ---------- actualización ----------
    update(dt, g, dir) {
      if (this.dead) { this._updateDead(dt); return; }
      const p = g.player;
      if (!p) return;
      this.flash = Math.max(0, this.flash - dt * 6);
      this.atkCd -= dt; this.dodgeCd -= dt; this.coverCd -= dt; this.screamCd -= dt; this.chargeCd -= dt;
      this.detourT -= dt;
      if (this.waitT > 0) this.waitT -= dt;
      this.stateT += dt;
      this.unseenT += dt;
      this.unhitT += dt;
      const kd = Math.exp(-7 * dt);
      this.kx *= kd; this.ky *= kd;
      // mutación de regeneración
      if (this.s.regen > 0 && this.hp < this.maxHp && this.unhitT > 3) this.hp = Math.min(this.maxHp, this.hp + this.maxHp * this.s.regen * dt);

      this.thinkT -= dt;
      if (this.thinkT <= 0) {
        const far = !this.alerted && this._pd > 800;
        const iv = far ? rr(0.4, 0.6) : rr(0.15, 0.3);
        this.thinkT = iv;
        this.think(g, dir);
        this.lastThink = iv;
      }
      this.act(dt, g, dir);
      this.x += (this.vx + this.kx) * dt;
      this.y += (this.vy + this.ky) * dt;

      // gruñidos espaciados
      this.groanT -= dt;
      if (this.groanT <= 0) {
        this.groanT = rr(5, 13);
        if (this._pd < 750 && this.state !== 'fakeDead' && this.state !== 'ambush' && dir && dir.canGroan()) {
          if (this.type === 'acechador') { if (this.alerted) sfx('stalker_hiss', this.x, this.y, { volume: 0.35 }); }
          else sfx('zombie_groan', this.x, this.y, { pitch: this.voice * rr(0.92, 1.08), volume: this.alerted ? 0.9 : 0.6 });
        }
      }
    }

    // ---------- pensamiento escalonado (percepción y decisiones) ----------
    think(g, dir) {
      const p = g.player;
      const dx = p.x - this.x, dy = p.y - this.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 0.001;
      this._pd = d;
      const pAlive = p.alive !== false;
      this._stuckCheck(g);
      const st = this.state;

      if (st === 'fakeDead') { this._thinkFake(g, dir, p, d); return; }
      if (st === 'ambush') { this._thinkAmbush(g, dir, p, d); return; }
      if (BUSY[st]) {
        if (pAlive && d < 300) { this.unseenT = 0; this.lkX = p.x; this.lkY = p.y; }
        return;
      }

      if (!pAlive) { this._thinkFeed(p, d); return; }

      // percepción
      this.seesPlayer = this._canSee(g, p, d);
      if (this.seesPlayer) {
        this.lkX = p.x; this.lkY = p.y; this.unseenT = 0;
        if (!this.alerted) this._onSpot(g, dir);
      } else if (d < (50 + 230 * (p.noise || 0)) * this.s.hearing) {
        // oye pasos cercanos
        this.lkX = p.x; this.lkY = p.y;
        if (this.alerted) this.unseenT = Math.min(this.unseenT, 0.5);
        else if (this.state === 'wander' || this.state === 'search') { this.urgent = false; this.setState('investigate'); }
      }
      // guiados por el grito: conocen la posición del jugador un rato
      if (this.homing > 0) {
        this.homing -= this.lastThink;
        this.lkX = p.x; this.lkY = p.y;
        this.alerted = true;
        this.unseenT = Math.min(this.unseenT, 0.5);
      }
      const knows = this.seesPlayer || this.unseenT < LOSE_TRACK;

      // retirada al estar malherido (etapa 3+)
      if (this.s.retreat && this.alerted && this.state !== 'retreat' && this.hp < this.maxHp * 0.3 && this.retreats < 2) {
        this.retreats++;
        if (dir) dir.releaseToken(this);
        this.setState('retreat');
        return;
      }

      switch (this.type) {
        case 'acechador': this._thinkStalker(g, dir, p, d, knows); break;
        case 'griton': this._thinkScreamer(g, dir, p, d, knows); break;
        case 'tanque': this._thinkTank(g, dir, p, d, knows); break;
        default: this._thinkNormal(g, dir, p, d, knows);
      }
      this._planNav(g, p, knows);
    }

    _canSee(g, p, d) {
      const dark = g.darkness || 0;
      const wx = g.weather || {};
      let range = lerp(450, this.type === 'acechador' ? 270 : 150, dark);
      if (p.flashlightOn && dark > 0.15) {
        // la linterna lo delata: muy lejos si apunta hacia ellos, bastante si no
        const a = Math.atan2(this.y - p.y, this.x - p.x);
        const inBeam = Math.abs(angDiff(p.aimAngle, a)) < 0.5;
        range = Math.max(range, lerp(450, inBeam ? 760 : 380, dark));
      }
      range *= (1 - 0.5 * (wx.fog || 0)) * (1 - 0.15 * (wx.rain || 0)) * this.s.sight;
      // sin alerta: campo de visión frontal
      if (!this.alerted && d > 110) {
        const a2 = Math.atan2(p.y - this.y, p.x - this.x);
        if (Math.abs(angDiff(this.angle, a2)) > 1.75) range *= 0.45;
      }
      if (d > range) return false;
      const w = g.world;
      return !w || !w.lineOfSight || w.lineOfSight(this.x, this.y, p.x, p.y);
    }

    _onSpot(g, dir) {
      this.alerted = true; this.urgent = true; this.unseenT = 0;
      if (this.type === 'tanque') sfx('tank_roar', this.x, this.y);
      else if (this.type !== 'acechador' && dir && dir.canGroan()) sfx('zombie_groan', this.x, this.y, { pitch: this.voice, volume: 1 });
      if (dir) dir.alertNear(this, this.s.packRadius);
      if (PASSIVE[this.state]) this.setState(this._resumeState());
    }

    _aimedAtMe(p, d, mult, minTol) {
      if (!p.aiming) return false;
      const a = Math.atan2(this.y - p.y, this.x - p.x);
      const tol = Math.max(minTol || 0.1, Math.atan2(this.r * mult, d));
      return Math.abs(angDiff(p.aimAngle, a)) < tol;
    }

    // Común: pérdida de rastro, búsqueda, deambular, retirada. true = ya decidido.
    _thinkPassive(g, dir, p, d, knows) {
      const st = this.state;
      if (st === 'retreat') {
        if (this.hp >= this.maxHp * 0.7 || this.stateT > 14) { this.setState(this._resumeState()); return false; }
        return true;
      }
      if (st === 'cover' || st === 'hide') return false;
      if (this.alerted) {
        if (knows) return false;
        if (st === 'search') {
          if (this.stateT > this.searchDur) { this.alerted = false; this.flankAngle = null; this.setState('wander'); }
          return true;
        }
        if (st !== 'investigate') { this.urgent = true; this.setState('investigate'); }
        return true;
      }
      if (st === 'search') { if (this.stateT > this.searchDur) this.setState('wander'); return true; }
      if (st === 'wander') { this._thinkWander(g, p, d); return true; }
      if (st !== 'investigate') this.setState('wander');
      return true;
    }

    _thinkWander(g, p, d) {
      if (this.stateT > this.wanderDur) {
        this.stateT = 0;
        if (!this.idle && Math.random() < 0.35) { this.idle = true; this.wanderDur = rr(1, 3.5); }
        else {
          this.idle = false; this.wanderDur = rr(2, 5);
          const bias = 0.35 + 0.35 * (g.darkness || 0); // de noche "huelen" al jugador
          if (d < 1400 && Math.random() < bias) this.wanderA = Math.atan2(p.y - this.y, p.x - this.x) + rr(-1.1, 1.1);
          else this.wanderA = Math.random() * TAU;
        }
      }
      // sin alerta no entran al campamento
      const safe = (TM.Config && TM.Config.SAFE_RADIUS) || 260;
      if (this.x * this.x + this.y * this.y < (safe + 40) * (safe + 40)) {
        this.wanderA = Math.atan2(this.y, this.x) + rr(-0.5, 0.5);
        this.idle = false;
      }
    }

    // Jugador muerto: se acercan al cuerpo y se quedan ahí
    _thinkFeed(p, d) {
      this.seesPlayer = false;
      if (!this.alerted && d > 400) { if (this.state !== 'wander' && this.state !== 'search') this.setState('wander'); return; }
      this.alerted = true;
      this.lkX = p.x; this.lkY = p.y;
      if (this.state !== 'investigate' && this.state !== 'search') { this.urgent = false; this.setState('investigate'); }
      if (this.state === 'search') this.stateT = 0;
    }

    _thinkNormal(g, dir, p, d, knows) {
      if (this._thinkPassive(g, dir, p, d, knows)) return;
      const s = this.s;
      let st = this.state;
      if (st === 'hide') {
        const exposed = this.seesPlayer && this._aimedAtMe(p, d, 3.5, 0.22);
        if (this.stateT < this.hideDur && !exposed) return;
        if (d < 230 || this.stateT > 5) { this.setState('chase'); }
        else if (!(p.aiming && this._aimedAtMe(p, d, 4, 0.25))) {
          // de cobertura en cobertura
          if (this._findCover(g, p, d, true)) this.setState('cover'); else this.setState('chase');
        } else if (exposed && this._findCover(g, p, d, false)) this.setState('cover');
        return;
      }
      if (st === 'cover') return;
      if (st !== 'chase') { this.setState('chase'); st = 'chase'; }

      // esquiva lateral al ser apuntado (etapa 2+)
      if (this.seesPlayer && s.dodgeChance > 0 && this.dodgeCd <= 0 && d > 55 && d < 600 && this._aimedAtMe(p, d, 1.7, 0.1)) {
        this.dodgeCd = rr(1.0, 1.7);
        if (Math.random() < s.dodgeChance) { this._startDodge(g, p, d); return; }
      }
      // cobertura si lo apuntan de lejos (etapa 2+)
      if (this.seesPlayer && s.coverChance > 0 && this.coverCd <= 0 && d > 240 && this._aimedAtMe(p, d, 3.5, 0.22)) {
        this.coverCd = rr(2.5, 4.5);
        if (Math.random() < s.coverChance && this._findCover(g, p, d, false)) { this.setState('cover'); return; }
      }
      this._chaseTarget(p, d);
    }

    _chaseTarget(p, d) {
      this.flanking = false;
      this.tx = p.x; this.ty = p.y;
      if (this.flankAngle !== null && this.s.flank && d > 80) {
        const A = Math.atan2(this.y - p.y, this.x - p.x);
        const err = angDiff(A, this.flankAngle);
        if (Math.abs(err) > 0.4) {
          const T = A + clamp(err, -0.75, 0.75);
          const R = clamp(d * 0.85, 100, 240);
          this.tx = p.x + Math.cos(T) * R;
          this.ty = p.y + Math.sin(T) * R;
          this.flanking = true;
        }
      }
    }

    _startDodge(g, p, d) {
      const ax = (this.x - p.x) / d, ay = (this.y - p.y) / d; // jugador→zombie
      const off = angDiff(p.aimAngle, Math.atan2(ay, ax));
      let side = off > 0.01 ? 1 : off < -0.01 ? -1 : (Math.random() < 0.5 ? 1 : -1);
      let mx = -ay * side - ax * 0.35, my = ax * side - ay * 0.35;
      const w = g.world;
      if (w && w.raycast && w.raycast(this.x, this.y, this.x + mx * 50, this.y + my * 50) < 0.9) {
        side = -side;
        mx = -ay * side - ax * 0.35; my = ax * side - ay * 0.35;
      }
      const L = Math.sqrt(mx * mx + my * my) || 1;
      this.dodgeX = mx / L; this.dodgeY = my / L;
      this.dodgeSpeed = Math.max(this.chaseSpeed * 2.0, 220);
      this.setState('dodge');
    }

    // Punto cercano sin línea de visión del jugador (detrás de un obstáculo que bloquea la vista)
    _findCover(g, p, d, advance) {
      const w = g.world;
      if (!w || !w.queryObstacles || !w.lineOfSight) return false;
      const R = 240;
      QBUF.length = 0;
      w.queryObstacles(this.x - R, this.y - R, this.x + R, this.y + R, QBUF);
      let bx = 0, by = 0, best = Infinity, checks = 0;
      for (let i = 0; i < QBUF.length && checks < 8; i++) {
        const o = QBUF[i];
        if (!o.blocksSight) continue;
        let cx, cy, ex;
        if (o.shape === 'rect') { cx = o.x + o.w / 2; cy = o.y + o.h / 2; } else { cx = o.cx; cy = o.cy; }
        let ux = cx - p.x, uy = cy - p.y;
        const ul = Math.sqrt(ux * ux + uy * uy) || 1;
        ux /= ul; uy /= ul;
        ex = o.shape === 'rect' ? Math.abs(ux) * o.w / 2 + Math.abs(uy) * o.h / 2 : o.r;
        const qx = cx + ux * (ex + this.r + 7), qy = cy + uy * (ex + this.r + 7);
        const dz = Math.hypot(qx - this.x, qy - this.y);
        if (dz > 260) continue;
        const dp = Math.hypot(qx - p.x, qy - p.y);
        if (dp < 140) continue;
        if (advance ? dp > d - 50 : dp > d + 60) continue;
        checks++;
        if (w.isFree && !w.isFree(qx, qy, this.r)) continue;
        if (w.lineOfSight(p.x, p.y, qx, qy)) continue;
        const score = dz + dp * 0.5;
        if (score < best) { best = score; bx = qx; by = qy; }
      }
      QBUF.length = 0;
      if (best === Infinity) return false;
      this.coverX = bx; this.coverY = by;
      return true;
    }

    // Acechador: rodea fuera del cono de la linterna y ataca por la espalda
    _thinkStalker(g, dir, p, d, knows) {
      if (this._thinkPassive(g, dir, p, d, knows)) return;
      if (this.state === 'withdraw') return;
      if (this.state !== 'stalk') this.setState('stalk');
      this.stalkT += this.lastThink;
      const s = this.s;
      if (this.seesPlayer && s.dodgeChance > 0 && this.dodgeCd <= 0 && d > 55 && d < 600 && this._aimedAtMe(p, d, 1.7, 0.1)) {
        this.dodgeCd = rr(1.0, 1.7);
        if (Math.random() < s.dodgeChance) { this._startDodge(g, p, d); return; }
      }
      const A = Math.atan2(this.y - p.y, this.x - p.x);   // ángulo jugador→acechador
      const B = p.aimAngle + PI;                            // espalda del jugador
      const toBack = angDiff(A, B);
      const inCone = Math.abs(angDiff(p.aimAngle, A)) < 0.6 && d < 520;
      const behind = Math.abs(toBack) < 0.85;
      const ready = this.atkCd <= 0 && this.seesPlayer && d < 175;
      if (ready && ((behind && !inCone) || (this.stalkT > 8 && !inCone) || this.stalkT > 13)) {
        if (!dir || dir.requestToken(this)) {
          sfx('stalker_hiss', this.x, this.y, { volume: 1 });
          this.setState('crouch');
          return;
        }
      }
      let T, R, mul;
      if (inCone) {
        const side = toBack >= 0 ? 1 : -1;
        T = A + side * 0.9; R = Math.max(d, 200); mul = 1.2;
      } else {
        T = A + clamp(toBack, -0.8, 0.8);
        R = behind ? 70 : 200; mul = behind ? 1 : 0.85;
      }
      this.tx = p.x + Math.cos(T) * R;
      this.ty = p.y + Math.sin(T) * R;
      this.stalkSpd = this.chaseSpeed * mul;
    }

    // Gritón: mantiene distancia, se infla y grita
    _thinkScreamer(g, dir, p, d, knows) {
      if (this._thinkPassive(g, dir, p, d, knows)) return;
      if (this.state !== 'keepaway') this.setState('keepaway');
      if (this.seesPlayer && this.screamCd <= 0 && d < 560) {
        if (dir) dir.releaseToken(this);
        this.setState('inflate');
        sfx('zombie_groan', this.x, this.y, { pitch: 1.7, volume: 1 });
        return;
      }
      const want = this.screamCd > 0 ? 400 : 300;
      const ax = (this.x - p.x) / d, ay = (this.y - p.y) / d;
      if (d < want - 70) {
        this.tx = this.x + ax * 120; this.ty = this.y + ay * 120; this.fleeing = true;
      } else if (d > want + 90 || !this.seesPlayer) {
        this.tx = knows ? p.x : this.lkX; this.ty = knows ? p.y : this.lkY; this.fleeing = false;
      } else {
        const side = (this.id & 1) ? 1 : -1;
        this.tx = this.x - ay * side * 60; this.ty = this.y + ax * side * 60; this.fleeing = true;
      }
    }

    // Tanque: persigue y, desde la etapa 2, carga
    _thinkTank(g, dir, p, d, knows) {
      if (this._thinkPassive(g, dir, p, d, knows)) return;
      if (this.state !== 'chase') this.setState('chase');
      if (this.s.canCharge && this.seesPlayer && this.chargeCd <= 0 && d > 120 && d < 430) {
        const w = g.world;
        if (!w || !w.raycast || w.raycast(this.x, this.y, p.x, p.y) >= 0.999) {
          if (dir) dir.releaseToken(this);
          this.chargeDX = (p.x - this.x) / d; this.chargeDY = (p.y - this.y) / d;
          this.setState('cwind');
          sfx('tank_charge', this.x, this.y, { volume: 1 });
          return;
        }
      }
      this.flanking = false;
      this.tx = p.x; this.ty = p.y;
    }

    _thinkFake(g, dir, p, d) {
      if (p.alive === false) return;
      const a = Math.atan2(this.y - p.y, this.x - p.x);
      const away = Math.abs(angDiff(p.aimAngle, a)) > 1.9;
      if (d < 90 || (d < 200 && away && this.stateT > 2)) this.rise(g);
    }

    _thinkAmbush(g, dir, p, d) {
      if (p.alive === false) return;
      this.ambushA = Math.atan2(p.y - this.y, p.x - this.x);
      let trig = d < 170;
      const dark = g.darkness || 0;
      if (!trig && d < 330 && p.flashlightOn && dark > 0.3) {
        const a = Math.atan2(this.y - p.y, this.x - p.x);
        if (Math.abs(angDiff(p.aimAngle, a)) < 0.35 && (!g.world || g.world.lineOfSight(p.x, p.y, this.x, this.y))) trig = true;
      }
      if (!trig && dark < 0.3 && d < 260 && (!g.world || g.world.lineOfSight(p.x, p.y, this.x, this.y))) trig = true;
      if (trig) {
        if (this.group && dir) dir.activateGroup(this.group);
        else this.activate(g);
      }
    }

    // ¿Línea directa al objetivo o campo de flujo?
    _planNav(g, p, knows) {
      const w = g.world;
      const st = this.state;
      let tx, ty;
      if (st === 'chase') {
        if (!knows) { tx = this.lkX; ty = this.lkY; } else if (this.flanking) { tx = this.tx; ty = this.ty; } else { tx = p.x; ty = p.y; }
      } else if (st === 'investigate') { tx = this.lkX + this.invOX; ty = this.lkY + this.invOY; }
      else if (st === 'cover') { tx = this.coverX; ty = this.coverY; }
      else if (st === 'stalk' || (st === 'keepaway' && !this.fleeing)) { tx = this.tx; ty = this.ty; }
      else { this.navDirect = true; this.navTX = null; return; }
      this.navTX = tx; this.navTY = ty;
      const ex = tx - this.x, ey = ty - this.y;
      const L2 = ex * ex + ey * ey;
      if (!w || !w.raycast || L2 < 40 * 40) { this.navDirect = true; return; }
      // camino directo solo si cabe el cuerpo: rayo central + dos rayos desplazados ±0.85·r
      let ok = w.raycast(this.x, this.y, tx, ty) >= 0.999;
      if (ok) {
        const L = Math.sqrt(L2), o = this.r * 0.85;
        const ox = -ey / L * o, oy = ex / L * o;
        ok = w.raycast(this.x + ox, this.y + oy, tx + ox, ty + oy) >= 0.999 &&
             w.raycast(this.x - ox, this.y - oy, tx - ox, ty - oy) >= 0.999;
      }
      this.navDirect = ok;
    }

    // Atasco: mide el avance real en ventanas de ~1.6 s (detecta también oscilaciones)
    // y escala: rodeo lateral → forzar campo de flujo → retroceder / abandonar / reubicar fuera de pantalla.
    _stuckCheck(g) {
      const dt = this.lastThink;
      if (this.forceFlowT > 0) this.forceFlowT -= dt;
      if (this.waitT > 0 && !this._unreachable(g)) this.waitT = 0; // se abrió camino: deja de esperar
      const st = this.state;
      const moving = this.wantSpd > 12 && !BUSY[st] && st !== 'hide' && st !== 'search' && st !== 'fakeDead' && st !== 'ambush';
      if (!moving || this._pd < 80 || this.detourT > 0) {
        if (!moving || this._pd < 80) { this.ancX = this.x; this.ancY = this.y; this.ancT = 0; }
        return;
      }
      this.ancT += dt;
      if (this.ancT < 1.6) return;
      const moved = Math.hypot(this.x - this.ancX, this.y - this.ancY);
      const expect = this.wantSpd * this.ancT;
      this.ancX = this.x; this.ancY = this.y; this.ancT = 0;
      if (moved > Math.max(18, expect * 0.25)) {
        if (moved > expect * 0.5) this.stuckN = 0;
        return;
      }
      // sin avance real
      this.stuckN++;
      const tx = this.navTX !== null ? this.navTX : this.x + Math.cos(this.angle) * 50;
      const ty = this.navTY !== null ? this.navTY : this.y + Math.sin(this.angle) * 50;
      const base = Math.atan2(ty - this.y, tx - this.x);
      if (this.alerted && this._unreachable(g)) {
        // el campo de flujo confirma que no hay camino para su cuerpo: espera al acecho en el borde
        this.stuckN = 0;
        this.waitT = rr(4, 8);
        return;
      }
      if (this.stuckN === 1) {
        this.detourT = rr(0.5, 0.8);
        this.detourA = base + this.side * rr(1.2, 1.8);
      } else if (this.stuckN <= 3) {
        this.forceFlowT = 3.5;
        this.side = -this.side;
        this.detourT = rr(0.4, 0.7);
        this.detourA = base + this.side * rr(1.4, 2.2);
      } else {
        this.stuckN = 0;
        const cam = g.camera, w = g.world;
        const offscreen = !(cam && cam.inView && cam.inView(this.x, this.y, 80));
        if (offscreen && w && w.findFree) {
          // fuera de pantalla: reubicar en un hueco libre cercano (nadie lo ve)
          const f = w.findFree(this.x - Math.cos(base) * 40, this.y - Math.sin(base) * 40, this.r + 3, 160);
          this.x = f.x; this.y = f.y;
        }
        if (!this.alerted || st === 'investigate' || st === 'wander') {
          // abandona ese objetivo
          this.wanderA = base + PI + rr(-0.8, 0.8);
          this.idle = false;
          this.setState(this.alerted ? 'search' : 'wander');
        } else {
          // retrocede y vuelve a intentarlo siguiendo el campo de flujo
          this.detourT = rr(0.9, 1.4);
          this.detourA = base + PI + rr(-0.6, 0.6);
          this.forceFlowT = 5;
        }
      }
    }

    // ¿Sin camino hasta el jugador para su tamaño? (según el campo de flujo que le corresponde)
    _unreachable(g) {
      const dir = g.director;
      if (!dir) return false;
      const ff = (this.r >= 16 && dir.flowBig && dir.flowBig.valid) ? dir.flowBig : dir.flow;
      if (!ff || !ff.valid || !ff.inField(this.x, this.y)) return false;
      if (ff.distAt(this.x, this.y) !== Infinity) return false;
      // su propia celda puede estar "inflada" junto a una pared: mira también las vecinas
      const c = ff.cell;
      for (let i = 0; i < 8; i++) {
        const a = i * PI / 4;
        if (ff.distAt(this.x + Math.cos(a) * c, this.y + Math.sin(a) * c) !== Infinity) return false;
      }
      return true;
    }

    // Dirección de navegación hacia (tx, ty)
    _nav(tx, ty, dir, allowFlow) {
      if (this.detourT > 0) { this._nx = Math.cos(this.detourA); this._ny = Math.sin(this.detourA); return; }
      const ex = tx - this.x, ey = ty - this.y;
      const L = Math.sqrt(ex * ex + ey * ey);
      if (L < 1) { this._nx = 0; this._ny = 0; return; }
      if (allowFlow && dir && (!this.navDirect || this.forceFlowT > 0)) {
        // los grandes usan el campo con obstáculos más inflados (no intentan huecos estrechos)
        const big = this.r >= 16 && dir.flowBig && dir.flowBig.valid;
        if ((big && dir.flowBig.dirAt(this.x, this.y, TMP)) || (dir.flow && dir.flow.dirAt(this.x, this.y, TMP))) {
          this._nx = TMP.x; this._ny = TMP.y; return;
        }
      }
      this._nx = ex / L; this._ny = ey / L;
    }

    // ---------- acción por frame ----------
    act(dt, g, dir) {
      const p = g.player;
      const dx = p.x - this.x, dy = p.y - this.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 0.001;
      this._pd = d;
      const s = this.s;
      const pAlive = p.alive !== false;
      const reach = this.r + p.r + s.reach;
      const knows = pAlive && (this.seesPlayer || this.unseenT < LOSE_TRACK);
      let spd = 0, faceA = null, raise = 0, crouchT = 0;
      this._nx = 0; this._ny = 0;

      if (this.hasToken) this.tokenT += dt;

      switch (this.state) {
        case 'wander':
          if (!this.idle) {
            spd = this.wanderSpeed;
            this._nav(this.x + Math.cos(this.wanderA) * 80, this.y + Math.sin(this.wanderA) * 80, dir, false);
          }
          break;

        case 'search':
          this.angle += Math.sin(this.stateT * 1.7 + this.id) * dt * 1.2;
          break;

        case 'investigate': {
          const ix = this.lkX + this.invOX, iy = this.lkY + this.invOY;
          const ex = ix - this.x, ey = iy - this.y;
          if (ex * ex + ey * ey < 24 * 24) { this.setState('search'); break; }
          spd = this.urgent ? this.chaseSpeed : Math.max(this.wanderSpeed * 1.6, this.chaseSpeed * 0.55);
          this._nav(ix, iy, dir, true);
          break;
        }

        case 'chase': {
          let tx, ty;
          if (!knows) { tx = this.lkX; ty = this.lkY; } else if (this.flanking) { tx = this.tx; ty = this.ty; } else { tx = p.x; ty = p.y; }
          if (this.waitT > 0 && d > reach + 40) { faceA = Math.atan2(dy, dx); break; } // al acecho
          spd = this.chaseSpeed;
          if (knows && d < reach + 40) {
            if (this.atkCd <= 0 && dir) dir.requestToken(this);
            if (this.hasToken) {
              if (d <= reach - 2) { this.setState('windup'); break; }
              if (this.tokenT > 2.5) dir.releaseToken(this); // no logra llegar: cede el turno
            } else {
              // sin turno de ataque: rodea a corta distancia
              this._hold(d, dx, dy, reach);
              spd = this.chaseSpeed * 0.45;
              faceA = Math.atan2(dy, dx);
              break;
            }
            faceA = Math.atan2(dy, dx);
          }
          this._nav(tx, ty, dir, true);
          break;
        }

        case 'windup':
          faceA = Math.atan2(dy, dx);
          raise = 1;
          if (d > this.r + p.r + 3) { this._nx = dx / d; this._ny = dy / d; spd = this.chaseSpeed * 0.2; }
          if (this.stateT >= this.windDur) this._strike(g, dir, d, dx, dy, reach);
          break;

        case 'recover': {
          const rec = this.type === 'acechador' ? 0.2 : this.type === 'tanque' ? 0.5 : 0.35;
          this._nx = -dx / d; this._ny = -dy / d; spd = this.chaseSpeed * 0.15;
          if (this.stateT >= rec) {
            if (dir) dir.releaseToken(this);
            this.setState(this.type === 'acechador' ? 'withdraw' : this._resumeState());
          }
          break;
        }

        case 'stagger':
          spd = 0;
          if (this.stateT >= this.staggerDur) this.setState(this.alerted ? this._resumeState() : 'wander');
          break;

        case 'dodge':
          this._nx = this.dodgeX; this._ny = this.dodgeY;
          spd = this.dodgeSpeed; this._snap = true;
          faceA = Math.atan2(dy, dx);
          if (this.stateT >= 0.26) this.setState(this._resumeState());
          break;

        case 'cover': {
          const ex = this.coverX - this.x, ey = this.coverY - this.y;
          if (ex * ex + ey * ey < 12 * 12 || this.stateT > 3.5) { this.setState('hide'); break; }
          spd = this.chaseSpeed * 1.1;
          this._nav(this.coverX, this.coverY, dir, false);
          break;
        }

        case 'hide':
          faceA = Math.atan2(dy, dx);
          crouchT = 0.5;
          break;

        case 'retreat': {
          if (d < 430) {
            this._nav(this.x - dx / d * 120, this.y - dy / d * 120, dir, false);
            spd = this.chaseSpeed * 0.95;
          }
          if (this.unhitT > 1.5) this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.035 * dt);
          crouchT = 0.4;
          break;
        }

        // --- acechador ---
        case 'stalk':
          spd = this.stalkSpd || this.chaseSpeed;
          this._nav(this.tx, this.ty, dir, true);
          if (d < 500) faceA = Math.atan2(dy, dx);
          crouchT = 0.7;
          break;

        case 'crouch':
          // telegrafiado claro: se agazapa, encoge los brazos (arco rojo) y sisea antes de saltar
          faceA = Math.atan2(dy, dx);
          crouchT = 1;
          raise = 0.6;
          if (this.stateT >= CROUCH_TIME) this.setState('lunge');
          break;

        case 'lunge':
          spd = Math.max(this.chaseSpeed * 1.45, 230);
          this._nx = dx / d; this._ny = dy / d; this._snap = true;
          faceA = Math.atan2(dy, dx);
          raise = 1;
          if (d <= reach) this._strike(g, dir, d, dx, dy, reach);
          else if (this.stateT > 1.0) { if (dir) dir.releaseToken(this); this.atkCd = rr(1.2, 2); this.setState('withdraw'); }
          break;

        case 'withdraw': {
          const side = (this.id & 1) ? 1 : -1;
          let mx = -dx / d * 0.85 - dy / d * side * 0.5, my = -dy / d * 0.85 + dx / d * side * 0.5;
          const L = Math.sqrt(mx * mx + my * my) || 1;
          this._nx = mx / L; this._ny = my / L;
          if (this.detourT > 0) { this._nx = Math.cos(this.detourA); this._ny = Math.sin(this.detourA); }
          spd = this.chaseSpeed;
          crouchT = 0.7;
          if (this.stateT > this.withdrawDur || d > 260) this.setState('stalk');
          break;
        }

        // --- gritón ---
        case 'keepaway':
          spd = this.chaseSpeed;
          this._nav(this.tx, this.ty, dir, !this.fleeing);
          if (d < 520) faceA = Math.atan2(dy, dx);
          // acorralado: golpe débil
          if (knows && d < reach + 6 && this.atkCd <= 0 && dir && dir.requestToken(this)) this.setState('windup');
          break;

        case 'inflate':
          faceA = Math.atan2(dy, dx);
          this.inflate = clamp(this.stateT / 1.0, 0, 1);
          if (this.stateT >= 1.0) this._scream(g, dir);
          break;

        // --- tanque ---
        case 'cwind':
          crouchT = 1;
          if (this.stateT < CHARGE_WINDUP - 0.15) { this.chargeDX = dx / d; this.chargeDY = dy / d; }
          faceA = Math.atan2(this.chargeDY, this.chargeDX);
          if (this.stateT >= CHARGE_WINDUP) {
            this.chargeDist = 0;
            this.setState('charge');
            sfx('tank_roar', this.x, this.y, { volume: 1 });
          }
          break;

        case 'charge': {
          spd = s.chargeSpeed;
          this._nx = this.chargeDX; this._ny = this.chargeDY; this._snap = true;
          this.angle = Math.atan2(this.chargeDY, this.chargeDX);
          this.chargeDist += spd * dt;
          crouchT = 0.6;
          if (pAlive && d <= this.r + p.r + 6) this._chargeHit(g, dx, dy, d);
          else if (this.chargeDist > 560 || this.stateT > 1.6) { this.chargeCd = rr(6, 8.5); this.setState('brake'); }
          break;
        }

        case 'brake':
          spd = s.chargeSpeed * Math.max(0, 1 - this.stateT / 0.35) * 0.6;
          this._nx = this.chargeDX; this._ny = this.chargeDY; this._snap = true;
          if (this.stateT > 0.7) this.setState('chase');
          break;

        case 'stun':
          spd = 0;
          if (this.stateT >= STUN_TIME) this.setState('chase');
          break;

        // --- trampas ---
        case 'fakeDead':
          this.vx = 0; this.vy = 0;
          this.twitchT -= dt;
          if (this.twitchT <= 0) { this.twitchT = rr(3, 7); this.twitch = 1; }
          this.twitch = Math.max(0, this.twitch - dt * 3);
          return;

        case 'rise':
          spd = 0;
          if (p) faceA = Math.atan2(dy, dx);
          if (this.stateT >= 0.5) this.setState(this._resumeState());
          break;

        case 'ambush':
          faceA = this.ambushA;
          crouchT = 0.6;
          break;
      }

      // velocidad con suavizado (o directa en embestidas/esquivas)
      this.wantSpd = spd;
      if (this._snap) {
        this.vx = this._nx * spd; this.vy = this._ny * spd; this._snap = false;
      } else {
        const k = 1 - Math.exp(-(this.type === 'tanque' ? 5 : 9) * dt);
        this.vx += (this._nx * spd - this.vx) * k;
        this.vy += (this._ny * spd - this.vy) * k;
      }
      const sp = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
      this.speedMag = sp;
      if (faceA === null && sp > 6) faceA = Math.atan2(this.vy, this.vx);
      if (faceA !== null && this.state !== 'charge') {
        const turn = (this.type === 'tanque' ? 3.5 : 7) * dt;
        this.angle += clamp(angDiff(this.angle, faceA), -turn, turn);
      }

      // animación
      this.walkPhase += sp * dt * (this.type === 'tanque' ? 0.05 : 0.085);
      this.armRaise += (raise - this.armRaise) * Math.min(1, dt * 12);
      this.strike = Math.max(0, this.strike - dt * 4);
      this.crouch += (crouchT - this.crouch) * Math.min(1, dt * 8);
      if (this.state !== 'inflate') this.inflate = Math.max(0, this.inflate - dt * 3);
      this.screamAnim = Math.max(0, this.screamAnim - dt * 1.2);

      // pisadas del tanque
      if (this.type === 'tanque' && sp > 15) {
        this.stepAcc += sp * dt;
        if (this.stepAcc > (this.state === 'charge' ? 70 : 52)) {
          this.stepAcc = 0;
          if (d < 750) sfx('tank_stomp', this.x, this.y, { volume: this.state === 'charge' ? 1 : 0.7 });
          if (d < 260 && g.shake) g.shake(this.state === 'charge' ? 2.5 : 1.2);
        }
      }
    }

    // Mantiene distancia mientras otros atacan
    _hold(d, dx, dy, reach) {
      const want = reach + 14;
      const ux = dx / d, uy = dy / d;
      const radial = clamp((d - want) / 20, -1, 1);
      const side = (this.id & 1) ? 1 : -1;
      let mx = ux * radial - uy * side * 0.35, my = uy * radial + ux * side * 0.35;
      const L = Math.sqrt(mx * mx + my * my) || 1;
      this._nx = mx / L; this._ny = my / L;
    }

    // Resolución del golpe tras el telegrafiado
    _strike(g, dir, d, dx, dy, reach) {
      const p = g.player;
      this.strike = 1;
      this.atkCd = this.s.attackCooldown * rr(0.9, 1.15);
      if (p.alive !== false && d <= reach + 7) {
        let dmg = this.s.damage * rr(0.9, 1.1);
        if (this.type === 'acechador') {
          // por la espalda duele más
          const A = Math.atan2(this.y - p.y, this.x - p.x);
          if (Math.abs(angDiff(p.aimAngle + PI, A)) < 1.0) dmg *= 1.35;
          this.atkCd = rr(1.6, 2.4);
        }
        if (typeof p.damage === 'function') p.damage(dmg, this.x, this.y, 'zombie');
        if (this.type === 'tanque' && p.push) p.push(dx / d, dy / d, 260);
        sfx('zombie_attack', this.x, this.y, { pitch: this.voice });
      }
      this.setState('recover');
    }

    _chargeHit(g, dx, dy, d) {
      const p = g.player;
      const dmg = this.s.damage * CHARGE_DMG;
      if (typeof p.damage === 'function') p.damage(dmg, this.x, this.y, 'zombie');
      // derribo: mezcla la dirección de la carga con la del impacto
      let px = this.chargeDX * 0.6 + (dx / d) * 0.4, py = this.chargeDY * 0.6 + (dy / d) * 0.4;
      const L = Math.sqrt(px * px + py * py) || 1;
      if (p.push) p.push(px / L, py / L, 560);
      if (g.shake) g.shake(10);
      if (g.hitstop) g.hitstop(0.05);
      fx(g, 'dust', p.x, p.y, 6);
      sfx('zombie_attack', this.x, this.y, { pitch: 0.6, volume: 1 });
      this.strike = 1;
      this.chargeCd = rr(6, 8.5);
      this.atkCd = 1.2;
      this.setState('brake');
    }

    // El director llama esto si la carga choca de frente contra un obstáculo
    chargeBlocked(g) {
      if (this.state !== 'charge') return;
      this.vx = 0; this.vy = 0;
      this.chargeCd = rr(6, 8.5);
      this.setState('stun');
      if (g.shake && this._pd < 400) g.shake(5);
      fx(g, 'dust', this.x + this.chargeDX * this.r, this.y + this.chargeDY * this.r, 8);
      sfx('tank_stomp', this.x, this.y, { volume: 1, pitch: 0.7 });
    }

    _scream(g, dir) {
      this.screamCd = SCREAM_CD * rr(0.95, 1.1);
      this.inflate = 0;
      this.screamAnim = 1;
      this.setState('keepaway');
      if (dir && dir.onScream) dir.onScream(this);
    }

    // ---------- daño ----------
    takeDamage(amount, kind, dirX, dirY) {
      if (this.dead || !(amount > 0)) return false;
      const g = this.game || TM.game;
      const dir = g && g.director;
      kind = kind || 'bullet';
      dirX = dirX || 0; dirY = dirY || 0;
      const res = dir && dir.resistFor ? dir.resistFor(kind) : 0;
      const dmg = amount * (1 - res);
      this.hp -= dmg;
      this.flash = 1;
      this.unhitT = 0;
      const kb = (kind === 'explosion' ? 260 : kind === 'vehicle' ? 300 : kind === 'melee' ? 60 : 45) * (this.type === 'tanque' ? 0.12 : 1);
      this.kx += dirX * kb; this.ky += dirY * kb;
      fx(g, 'blood', this.x, this.y, dirX, dirY, dmg > 25 ? 8 : 5);
      sfx('hit_flesh', this.x, this.y);
      if (dir && dir.onDamage) dir.onDamage(this, kind, dmg);

      if (this.state === 'fakeDead') this.rise(g);
      else if (this.state === 'ambush') { if (this.group && dir) dir.activateGroup(this.group); else this.activate(g); }

      if (this.hp <= 0) { this.die(kind, dirX, dirY); return true; }

      // sabe de dónde vino el golpe
      const p = g && g.player;
      if (p && !this.alerted) this.alertTo(p.x, p.y, true);
      // un impacto fuerte interrumpe el golpe (no al tanque)
      if (this.type !== 'tanque' && this.state === 'windup' && dmg >= this.maxHp * 0.3) {
        if (dir) dir.releaseToken(this);
        this.staggerDur = 0.25;
        this.setState('stagger');
      }
      return false;
    }

    shove(dirX, dirY, force) {
      if (this.dead) return;
      const g = this.game || TM.game;
      const dir = g && g.director;
      if (this.state === 'fakeDead') this.rise(g);
      force = clamp(force || 300, 0, 700);
      if (this.type === 'tanque') {
        // casi inmune
        this.kx += dirX * force * 0.06; this.ky += dirY * force * 0.06;
        fx(g, 'dust', this.x, this.y, 3);
        return;
      }
      const res = dir && dir.resistFor ? dir.resistFor('melee') * 0.6 : 0;
      const f = force * (1 - res);
      this.kx += dirX * f; this.ky += dirY * f;
      if (dir) dir.releaseToken(this);
      if (this.state === 'inflate') { this.screamCd = 4; this.inflate = 0; } // interrumpe el grito
      this.staggerDur = rr(0.5, 0.8) * (1 - res * 0.5);
      if (this.state === 'ambush') this.crouch = 0;
      this.setState('stagger');
      const p = g && g.player;
      if (p && !this.alerted) { this.alerted = true; this.lkX = p.x; this.lkY = p.y; this.unseenT = 0; }
    }

    die(kind, dirX, dirY) {
      if (this.dead) return;
      const g = this.game || TM.game;
      const dir = g && g.director;
      const wasInflating = this.state === 'inflate';
      this.dead = true; this.hp = 0; this.fakeDead = false;
      this.state = 'dead'; this.stateT = 0; this.deathT = 0; this.alpha = 1;
      this.fallA = (dirX || dirY) ? Math.atan2(dirY, dirX) : this.angle + PI;
      this.vx = (dirX || 0) * 70; this.vy = (dirY || 0) * 70;
      this.kx = 0; this.ky = 0;
      if (dir) dir.releaseToken(this);
      const w = g && g.world;
      if (w && w.paintBlood) w.paintBlood(this.x + (dirX || 0) * 8, this.y + (dirY || 0) * 8, this.r * (this.type === 'tanque' ? 1.5 : 1.15), 0.8);
      fx(g, 'blood', this.x, this.y, dirX || 0, dirY || 0, 12);
      if (this.type === 'griton') {
        fx(g, 'acid', this.x, this.y, 8);
        if (wasInflating) fx(g, 'floatText', this.x, this.y - 22, '¡SILENCIADO!', '#ffd27a');
      }
      sfx('zombie_death', this.x, this.y, { pitch: this.voice });
      if (g && typeof g.onZombieKilled === 'function') g.onZombieKilled(this, kind);
      else if (dir && dir.onKill) dir.onKill(this, kind);
    }

    _updateDead(dt) {
      this.deathT += dt;
      const k = Math.exp(-6 * dt);
      this.vx *= k; this.vy *= k;
      this.x += this.vx * dt; this.y += this.vy * dt;
      if (this.deathT > CORPSE_TIME) {
        this.alpha = Math.max(0, 1 - (this.deathT - CORPSE_TIME) / CORPSE_FADE);
        if (this.alpha <= 0) this.remove = true;
      }
    }

    // ---------- dibujo ----------
    _headX() {
      const r = this.r;
      if (this.type === 'acechador') return r * 0.75;
      if (this.type === 'griton') return r * (1 + 0.38 * this.inflate) * 0.72;
      if (this.type === 'tanque') return r * (0.42 + 0.12 * this.crouch);
      return r * (0.3 + 0.15 * this.crouch);
    }

    // Pose cuantizada (para el caché de sprites): rellena P y devuelve un código numérico
    _pose(P) {
      const t = this.type;
      const div = t === 'acechador' ? 60 : t === 'tanque' ? 30 : 40;
      let sw = Math.sin(this.walkPhase) * clamp(this.speedMag / div, 0, 1);
      let raise = this.armRaise < 0.25 ? 0 : this.armRaise < 0.75 ? 0.5 : 1;
      let strike = this.strike > 0.4 ? 1 : 0;
      let crouch = 0, lunge = 0, open = 0;
      if (t === 'acechador') {
        lunge = (this.state === 'lunge' || strike) ? 1 : raise;
        crouch = this.crouch < 0.75 ? 0.5 : 1;
        raise = 0; strike = 0;
      } else if (t === 'tanque') {
        crouch = this.crouch < 0.3 ? 0 : this.crouch < 0.75 ? 0.5 : 1;
      } else if (t === 'griton') {
        open = Math.max(this.inflate, this.screamAnim) > 0.4 ? 1 : 0;
        raise = 0; strike = 0;
      }
      if (raise || strike || lunge) sw = 0;
      const lv = t === 'tanque' ? 2 : 3; // pasos de balanceo por lado
      sw = Math.round(sw * lv) / lv;
      P.sw = sw; P.raise = raise; P.strike = strike; P.crouch = crouch; P.lunge = lunge; P.open = open;
      P.corpse = 0; P.twitch = 0;
      const m = this.s.mut || {};
      return (Math.round(sw * 6) + 6) + 13 * (raise * 2) + 39 * strike + 78 * (crouch * 2) + 234 * (lunge * 2) +
        702 * open + 1404 * ((m.piel ? 1 : 0) + (m.garras ? 2 : 0));
    }

    // Sprite actual (memorizado mientras no cambie la pose ni el caché)
    _sprite(P) {
      const code = this._pose(P);
      if (code === this._sprCode && this._sprGen === SPR.gen && this._spr && SPR.S === spriteScale()) return this._spr;
      const sp = getSprite(this, this.type + this.variant + '|' + code, P);
      this._spr = sp; this._sprCode = sp ? code : -1; this._sprGen = SPR.gen;
      return sp;
    }

    // ¿Le llega luz? (en plena noche, lejos de la luz se omite la sombra)
    _lit() {
      const g = this.game || TM.game;
      const dark = g ? (g.darkness || 0) : 0;
      if (dark < 0.7) return true;
      const p = g.player;
      if (!p) return true;
      const dx = this.x - p.x, dy = this.y - p.y, d2 = dx * dx + dy * dy;
      if (d2 < 140 * 140) return true;
      return !!p.flashlightOn && d2 < 480 * 480 && Math.abs(angDiff(p.aimAngle, Math.atan2(dy, dx))) < 0.6;
    }

    _drawBody(ctx, P) {
      const r = this.r;
      if (this.type === 'acechador') this._drawStalker(ctx, r, P);
      else if (this.type === 'griton') this._drawScreamer(ctx, r, P);
      else if (this.type === 'tanque') this._drawTank(ctx, r, P);
      else this._drawNormal(ctx, r, P);
    }

    draw(ctx, t) {
      if (this.dead || this.state === 'fakeDead' || (this.state === 'rise' && this.stateT < 0.25)) { this._drawCorpse(ctx); return; }
      const r = this.r;
      const P = POSE;
      const sp = this._sprite(P);
      const gk = this.type === 'griton' ? 1 + 0.38 * this.inflate + 0.05 * Math.sin(this.walkPhase * 0.6) : 1;
      // sombra suave pre-renderizada (sin rotar)
      if (this._lit()) {
        const sr = r * 1.45 * gk;
        ctx.drawImage(shadowSprite(), this.x + 2.5 - sr, this.y + 3.5 - sr * 0.9, sr * 2, sr * 1.8);
      }
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(this.angle);
      if (gk !== 1) ctx.scale(gk, gk);
      if (sp) ctx.drawImage(sp.c, -sp.ox, -sp.oy, sp.w, sp.h);
      else { ctx.lineCap = 'round'; ctx.lineJoin = 'round'; this._drawBody(ctx, P); } // respaldo vectorial
      // gritón inflándose: rubor rojizo que palpita
      if (this.type === 'griton' && this.inflate > 0.05) {
        ctx.fillStyle = 'rgba(200,70,60,' + (this.inflate * (0.25 + 0.15 * Math.sin(this.stateT * 30))).toFixed(3) + ')';
        ctx.beginPath(); circ(ctx, -r * 0.05, 0, r * 0.98); ctx.fill();
      }

      // telegrafiado del golpe: brillo rojizo delante
      if (this.armRaise > 0.15) {
        ctx.strokeStyle = 'rgba(200,45,30,' + (0.4 * this.armRaise).toFixed(3) + ')';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, r * 2.1, -0.55, 0.55);
        ctx.stroke();
      }
      // destello al recibir daño
      if (this.flash > 0) {
        ctx.globalAlpha = Math.min(1, this.flash) * 0.7;
        ctx.fillStyle = this.flash > 0.6 ? '#fff4ec' : '#ff9a88';
        ctx.beginPath();
        ell(ctx, 0, 0, r * 0.8, r * 1.05, 0);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    }

    _drawNormal(ctx, r, P) {
      const sw = P.sw, raise = P.raise, strike = P.strike;
      const sx = r * 0.1, sy = r * 0.72;
      const reachA = r * (1.3 + 0.55 * strike - 0.35 * raise);
      const spread = r * (0.5 + 0.75 * raise);
      const hlx = sx + reachA + sw * r * 0.3, hly = -spread - this.armOff * r;
      const hrx = sx + reachA - sw * r * 0.3, hry = spread;
      // antebrazos
      ctx.lineWidth = r * 0.32;
      ctx.strokeStyle = this.cSkinDark;
      ctx.beginPath();
      ctx.moveTo(sx, -sy); ctx.lineTo(hlx, hly);
      ctx.moveTo(sx, sy); ctx.lineTo(hrx, hry);
      ctx.stroke();
      // mangas rasgadas
      ctx.lineWidth = r * 0.42;
      ctx.strokeStyle = this.cCloth;
      ctx.beginPath();
      ctx.moveTo(sx, -sy); ctx.lineTo(sx + (hlx - sx) * 0.42, -sy + (hly + sy) * 0.42);
      ctx.moveTo(sx, sy); ctx.lineTo(sx + (hrx - sx) * 0.42, sy + (hry - sy) * 0.42);
      ctx.stroke();
      // manos
      ctx.fillStyle = this.cSkin;
      ctx.beginPath(); circ(ctx, hlx, hly, r * 0.19); circ(ctx, hrx, hry, r * 0.19); ctx.fill();
      if (this.s.mut && this.s.mut.garras) this._drawClaws(ctx, r, hlx, hly, hrx, hry);
      // torso
      ctx.fillStyle = this.cCloth;
      ctx.beginPath(); ell(ctx, -r * 0.05, 0, r * 0.56, r * 0.95, this.lean); ctx.fill();
      this._drawPatches(ctx, r);
      // cabeza
      const hx = r * 0.3;
      ctx.fillStyle = this.cSkin;
      ctx.beginPath(); circ(ctx, hx, 0, r * 0.46); ctx.fill();
      if (!this.bald) {
        ctx.fillStyle = this.cHair;
        ctx.beginPath(); ctx.arc(hx - r * 0.04, 0, r * 0.42, PI * 0.55, PI * 1.45); ctx.closePath(); ctx.fill();
      }
      if (this.wound) {
        ctx.fillStyle = this.cBlood;
        ctx.beginPath(); ell(ctx, hx + r * 0.08, r * 0.18, r * 0.14, r * 0.09, 0.6); ctx.fill();
      }
    }

    _drawPatches(ctx, r) {
      ctx.fillStyle = this.cClothDark;
      ctx.beginPath();
      for (let i = 0; i < this.shadows.length; i++) { const a = this.shadows[i]; ell(ctx, a[0] * r, a[1] * r, a[2] * r, a[3] * r, a[4]); }
      ctx.fill();
      ctx.fillStyle = this.cSkinDark;
      ctx.beginPath();
      for (let i = 0; i < this.tears.length; i++) { const a = this.tears[i]; ell(ctx, a[0] * r, a[1] * r, a[2] * r, a[3] * r, a[4]); }
      ctx.fill();
      ctx.fillStyle = this.cBlood;
      ctx.beginPath();
      for (let i = 0; i < this.stains.length; i++) { const a = this.stains[i]; ell(ctx, a[0] * r, a[1] * r, a[2] * r, a[3] * r, a[4]); }
      ctx.fill();
      if (this.s.mut && this.s.mut.piel) {
        // piel endurecida: costras grises
        ctx.fillStyle = 'rgba(128,120,104,0.85)';
        ctx.beginPath();
        for (let i = 0; i < 3; i++) { const a = this.plates[i]; ell(ctx, a[0] * r * 0.7, a[1] * r * 0.8, a[2] * r * 0.8, a[3] * r * 0.8, a[4]); }
        ctx.fill();
      }
    }

    _drawClaws(ctx, r, hlx, hly, hrx, hry) {
      ctx.strokeStyle = '#d8d0b8';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let k = -1; k <= 1; k++) {
        ctx.moveTo(hlx, hly + k * 2); ctx.lineTo(hlx + r * 0.45, hly + k * 3);
        ctx.moveTo(hrx, hry + k * 2); ctx.lineTo(hrx + r * 0.45, hry + k * 3);
      }
      ctx.stroke();
    }

    _drawStalker(ctx, r, P) {
      const lunge = P.lunge;
      const crouch = Math.max(P.crouch, 0.4);
      // brazos largos con codos hacia fuera
      const hx = r * (0.5 + 1.6 * lunge), hy = r * (1.0 - 0.45 * lunge);
      const ex = r * (0.15 + 0.5 * lunge), ey = r * (1.25 - 0.2 * lunge);
      const sw = P.sw * r * 0.25;
      ctx.lineWidth = r * 0.24;
      ctx.strokeStyle = this.cSkinDark;
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.55); ctx.lineTo(ex + sw, -ey); ctx.lineTo(hx + sw, -hy);
      ctx.moveTo(0, r * 0.55); ctx.lineTo(ex - sw, ey); ctx.lineTo(hx - sw, hy);
      ctx.stroke();
      // garras
      ctx.strokeStyle = 'rgba(170,160,140,0.8)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(hx + sw, -hy); ctx.lineTo(hx + sw + r * 0.3, -hy - 0.8);
      ctx.moveTo(hx + sw, -hy); ctx.lineTo(hx + sw + r * 0.28, -hy + 0.9);
      ctx.moveTo(hx - sw, hy); ctx.lineTo(hx - sw + r * 0.3, hy + 0.8);
      ctx.moveTo(hx - sw, hy); ctx.lineTo(hx - sw + r * 0.28, hy - 0.9);
      ctx.stroke();
      // cuerpo delgado y encorvado
      ctx.fillStyle = this.cSkin;
      ctx.beginPath(); ell(ctx, -r * 0.1 + crouch * r * 0.1, 0, r * 0.88, r * 0.55, 0); ctx.fill();
      // harapos
      ctx.fillStyle = this.cClothDark;
      ctx.beginPath(); ell(ctx, -r * 0.45, 0, r * 0.42, r * 0.5, 0); ctx.fill();
      // columna y costillas
      ctx.strokeStyle = 'rgba(20,22,24,0.45)';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(-r * 0.8, 0); ctx.lineTo(r * 0.45, 0);
      for (let i = 0; i < 3; i++) {
        const x0 = -r * 0.2 + i * r * 0.22;
        ctx.moveTo(x0, -1); ctx.lineTo(x0 - r * 0.12, -r * 0.4);
        ctx.moveTo(x0, 1); ctx.lineTo(x0 - r * 0.12, r * 0.4);
      }
      ctx.stroke();
      ctx.fillStyle = this.cBlood;
      ctx.beginPath();
      const a = this.stains[0];
      ell(ctx, a[0] * r, a[1] * r, a[2] * r, a[3] * r, a[4]);
      ctx.fill();
      // cabeza adelantada, calva
      const hX = r * 0.75;
      ctx.fillStyle = this.cSkinDark;
      ctx.beginPath(); circ(ctx, hX, 0, r * 0.42); ctx.fill();
      ctx.fillStyle = this.cSkin;
      ctx.beginPath(); circ(ctx, hX + r * 0.06, 0, r * 0.32); ctx.fill();
    }

    // (el inflado y el rubor se aplican al dibujar el sprite: escala + capa roja)
    _drawScreamer(ctx, r, P) {
      const R = r;
      // brazos cortos
      ctx.lineWidth = r * 0.34;
      ctx.strokeStyle = this.cSkinDark;
      const sw = P.sw * r * 0.2;
      ctx.beginPath();
      ctx.moveTo(0, -R * 0.78); ctx.lineTo(R * 0.85 + sw, -R * 0.82);
      ctx.moveTo(0, R * 0.78); ctx.lineTo(R * 0.85 - sw, R * 0.82);
      ctx.stroke();
      // cuerpo hinchado y pálido, con borde en sombra para dar volumen
      ctx.fillStyle = this.cSkin;
      ctx.beginPath(); circ(ctx, -r * 0.05, 0, R * 0.98); ctx.fill();
      ctx.strokeStyle = 'rgba(70,60,50,0.35)';
      ctx.lineWidth = 1.6;
      ctx.stroke();
      // tirantes de ropa rasgada
      ctx.strokeStyle = this.cClothDark;
      ctx.lineWidth = r * 0.16;
      ctx.beginPath();
      ctx.moveTo(-R * 0.75, -R * 0.45); ctx.lineTo(R * 0.15, -R * 0.62);
      ctx.moveTo(-R * 0.75, R * 0.45); ctx.lineTo(R * 0.15, R * 0.62);
      ctx.stroke();
      ctx.fillStyle = this.cBlood;
      ctx.beginPath();
      for (let i = 0; i < this.stains.length; i++) { const a = this.stains[i]; ell(ctx, a[0] * R, a[1] * R, a[2] * r, a[3] * r, a[4]); }
      ctx.fill();
      // pústulas y venas
      ctx.fillStyle = 'rgba(150,135,95,0.75)';
      ctx.beginPath();
      for (let i = 0; i < this.tears.length; i++) { const a = this.tears[i]; circ(ctx, a[0] * R, a[1] * R, a[3] * R); }
      ctx.fill();
      ctx.strokeStyle = 'rgba(110,60,75,0.45)';
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(-R * 0.6, -R * 0.2); ctx.lineTo(-R * 0.1, -R * 0.45); ctx.lineTo(R * 0.25, -R * 0.3);
      ctx.moveTo(-R * 0.5, R * 0.35); ctx.lineTo(0, R * 0.5); ctx.lineTo(R * 0.3, R * 0.2);
      ctx.stroke();
      // cabeza pequeña con boca abierta
      const hX = R * 0.72;
      ctx.fillStyle = this.cSkin;
      ctx.beginPath(); circ(ctx, hX, 0, r * 0.4); ctx.fill();
      const open = P.open;
      ctx.fillStyle = '#1a0c0c';
      ctx.beginPath(); ell(ctx, hX + r * 0.2, 0, r * (0.12 + 0.12 * open), r * (0.1 + 0.14 * open), 0); ctx.fill();
    }

    _drawTank(ctx, r, P) {
      const crouch = P.crouch, strike = P.strike;
      const sw = P.sw;
      const fx_ = r * (1.05 + 0.4 * strike - 0.3 * crouch);
      const fy = r * (0.95 + 0.2 * crouch + 0.2 * P.raise);
      const lx = fx_ + sw * r * 0.15, rx = fx_ - sw * r * 0.15;
      // brazos enormes
      ctx.lineWidth = r * 0.42;
      ctx.strokeStyle = this.cSkinDark;
      ctx.beginPath();
      ctx.moveTo(r * 0.05, -r * 0.85); ctx.lineTo(lx, -fy);
      ctx.moveTo(r * 0.05, r * 0.85); ctx.lineTo(rx, fy);
      ctx.stroke();
      ctx.fillStyle = this.cSkinDark;
      ctx.beginPath(); circ(ctx, lx, -fy, r * 0.3); circ(ctx, rx, fy, r * 0.3); ctx.fill();
      if (this.s.mut && this.s.mut.garras) this._drawClaws(ctx, r, lx, -fy, rx, fy);
      // torso masivo con la espalda en sombra
      ctx.fillStyle = this.cSkin;
      ctx.beginPath(); ell(ctx, -r * 0.05, 0, r * 0.72, r * 1.12, 0); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.16)';
      ctx.beginPath(); ell(ctx, -r * 0.32, 0, r * 0.42, r * 0.95, 0); ctx.fill();
      // trapecios / masa muscular
      ctx.fillStyle = this.cSkinLight;
      ctx.beginPath();
      ell(ctx, r * 0.05, -r * 0.55, r * 0.34, r * 0.28, 0.35);
      ell(ctx, r * 0.05, r * 0.55, r * 0.34, r * 0.28, -0.35);
      ctx.fill();
      // cresta ósea a lo largo de la columna (y placas en hombros con piel endurecida)
      const piel = this.s.mut && this.s.mut.piel;
      ctx.fillStyle = '#7e776b';
      ctx.beginPath();
      for (let i = 0; i < 4; i++) ell(ctx, -r * 0.78 + i * r * 0.24, 0, r * 0.1, r * (0.07 + 0.02 * i), 0);
      if (piel) { ell(ctx, -r * 0.05, -r * 0.62, r * 0.22, r * 0.14, 0.5); ell(ctx, -r * 0.05, r * 0.62, r * 0.22, r * 0.14, -0.5); }
      ctx.fill();
      ctx.strokeStyle = 'rgba(25,20,16,0.45)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
      // sangre (manchas más pequeñas que su tamaño)
      ctx.fillStyle = this.cBlood;
      ctx.beginPath();
      for (let i = 0; i < this.stains.length; i++) { const a = this.stains[i]; ell(ctx, a[0] * r, a[1] * r, a[2] * r * 0.55, a[3] * r * 0.55, a[4]); }
      ctx.fill();
      // cabeza pequeña hundida entre los hombros, con ceño
      const hX = r * (0.42 + 0.12 * crouch);
      ctx.fillStyle = this.cSkinDark;
      ctx.beginPath(); circ(ctx, hX, 0, r * 0.3); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(hX, 0, r * 0.22, -0.9, 0.9); ctx.stroke();
    }

    // Cadáver (o fingiendo): sprite tendido; al caer se estira de 0.6 a 1 en 0.35 s
    _drawCorpse(ctx) {
      const r = this.r;
      const k = this.dead ? clamp(this.deathT / 0.35, 0, 1) : 1;
      const L = lerp(0.6, 1, k);
      const P = POSE;
      P.sw = 0; P.raise = 0; P.strike = 0; P.crouch = 0; P.lunge = 0; P.open = 0;
      P.corpse = 1; P.twitch = this.twitch > 0.5 ? 1 : 0;
      const sp = getSprite(this, 'c' + this.type + this.variant + P.twitch, P);
      ctx.save();
      const a0 = this.alpha < 1 ? this.alpha : 1;
      ctx.translate(this.x, this.y);
      ctx.rotate(this.fallA);
      ctx.globalAlpha = a0 * 0.55;
      ctx.drawImage(shadowSprite(), -r * 1.7 * L + 1, -r * 1.15 + 2, r * 3.4 * L, r * 2.3);
      ctx.globalAlpha = a0;
      if (L !== 1) ctx.scale(L, 1);
      if (sp) ctx.drawImage(sp.c, -sp.ox, -sp.oy, sp.w, sp.h);
      else { ctx.lineCap = 'round'; this._drawCorpseBody(ctx, P); }
      ctx.restore();
    }

    _drawCorpseBody(ctx, P) {
      const r = this.r;
      const L = 1;
      const big = this.type === 'griton' ? 1.25 : 1;
      // piernas
      ctx.strokeStyle = this.type === 'tanque' ? this.cSkinDark : this.cClothDark;
      ctx.lineWidth = r * 0.32;
      ctx.beginPath();
      ctx.moveTo(-r * 0.5 * L, -r * 0.25); ctx.lineTo(-r * 1.45 * L, -r * 0.45);
      ctx.moveTo(-r * 0.5 * L, r * 0.25); ctx.lineTo(-r * 1.4 * L, r * 0.6);
      ctx.stroke();
      // brazos abiertos (con espasmo si finge)
      const tw = P.twitch * r * 0.3;
      ctx.strokeStyle = this.cSkinDark;
      ctx.lineWidth = r * 0.28;
      ctx.beginPath();
      ctx.moveTo(r * 0.35, -r * 0.55); ctx.lineTo(r * 0.85 + tw, -r * 1.25 * L);
      ctx.moveTo(r * 0.35, r * 0.55); ctx.lineTo(r * 1.05, (r * 1.0 + this.lieSide * r * 0.2) * L);
      ctx.stroke();
      // torso tendido
      ctx.fillStyle = (this.type === 'griton' || this.type === 'tanque' || this.type === 'acechador') ? this.cSkin : this.cCloth;
      ctx.beginPath(); ell(ctx, 0, 0, r * 0.85 * L * big, r * 0.62 * big, 0); ctx.fill();
      ctx.fillStyle = this.cBlood;
      ctx.beginPath();
      for (let i = 0; i < this.stains.length; i++) { const a = this.stains[i]; ell(ctx, a[0] * r, a[1] * r * 0.8, a[2] * r, a[3] * r, a[4]); }
      ctx.fill();
      // cabeza
      const hx = r * 1.1 * L, hy = this.lieSide * r * 0.12;
      ctx.fillStyle = this.cSkin;
      ctx.beginPath(); circ(ctx, hx, hy, r * (this.type === 'tanque' ? 0.32 : 0.44)); ctx.fill();
      if (!this.bald && this.type === 'normal') {
        ctx.fillStyle = this.cHair;
        ctx.beginPath(); ctx.arc(hx, hy, r * 0.42, PI * 0.6, PI * 1.4); ctx.closePath(); ctx.fill();
      }
    }

    // Ojos brillantes (se dibuja tras la capa de oscuridad)
    drawGlow(ctx, t) {
      if (this.dead || this.state === 'fakeDead' || this.state === 'rise') return;
      const g = this.game || TM.game;
      const dark = g ? (g.darkness || 0) : 0;
      if (dark < 0.25) return;
      const k = (dark - 0.25) / 0.75;
      const stalker = this.type === 'acechador';
      let a = stalker ? 0.95 : this.type === 'tanque' ? 0.5 : 0.4;
      a *= k;
      if (this.state === 'ambush') a *= 0.6;
      if (a < 0.03) return;
      const hx = this._headX() + this.r * 0.28;
      const ca = Math.cos(this.angle), sa = Math.sin(this.angle);
      const ex = this.x + ca * hx, ey = this.y + sa * hx;
      const off = this.r * (this.type === 'tanque' ? 0.12 : 0.17);
      const ox = -sa * off, oy = ca * off;
      const er = stalker ? 1.7 : this.type === 'tanque' ? 1.6 : 1.3;
      if (stalker || this.armRaise > 0.3) {
        // halo rojo (más intenso al agazaparse antes del salto)
        const hk = this.state === 'crouch' ? 1 : 0.55;
        ctx.globalAlpha = Math.min(1, hk * k);
        const hs = this.state === 'crouch' ? 22 : 16;
        ctx.drawImage(glowSprite('halo'), ex - hs / 2, ey - hs / 2, hs, hs);
      }
      // par de ojos pre-renderizado en 16 orientaciones: una sola llamada
      const di = ((Math.round(this.angle / (TAU / 16)) % 16) + 16) % 16;
      const pr = eyePair(this.type, di, off, er, stalker);
      ctx.globalAlpha = Math.min(1, a);
      ctx.drawImage(pr.c, ex - pr.h, ey - pr.h, pr.h * 2, pr.h * 2);
      ctx.globalAlpha = 1;
    }
  }

  Zombie.sfx = sfx;
  Zombie.fx = fx;
  Zombie.clearSprites = clearCache;
  Zombie.spriteStats = function () { return { count: SPR.map.size, kb: Math.round(SPR.bytes / 1024), built: SPR.built, scale: SPR.S }; };
  TM.Zombie = Zombie;
})();
