// Tierra Muerta — Director de la IA: aparición, eliminación, actualización de zombies, separación,
// ruido, hordas, emboscadas, flanqueo, evolución por días y aprendizaje del jugador (persistente).
(function () {
  'use strict';
  const TM = window.TM = window.TM || {};

  // ---------- utilidades locales ----------
  const PI = Math.PI, TAU = PI * 2;
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function rr(a, b) { return a + Math.random() * (b - a); }
  function ri(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
  function smoothstep(a, b, x) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
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
  function safeR() { return (TM.Config && TM.Config.SAFE_RADIUS) || 260; }

  // ---------- ajustes de equilibrio ----------
  const CULL_DIST = 1600;          // elimina no alertados más lejos que esto
  const CULL_DIST_ALERTED = 2300;  // y alertados que se quedaron muy atrás
  // resistencia máxima por tipo de daño (fase 1: solo pistola → balas como mucho 20 %)
  const RESIST_MAX = { bullet: 0.2, melee: 0.3, fire: 0.35, explosion: 0.35 };
  const RESIST_K = 2000;           // "uso" necesario para ~63 % del máximo (1 por ataque + 0.5 por impacto)
  const RESIST_LV = [0.2, 0.4, 0.6, 0.8]; // niveles de aviso, como fracción del máximo de cada tipo
  const FLEE_NEAR = 250;           // zombies a menos de esto cuentan para "huida"
  const FLEE_SPEED = 90;           // velocidad mínima del jugador para contar huida
  const NIGHT_LV = [60, 180, 400]; // segundos fuera de noche por nivel
  const ATTACKERS = [3, 3, 4, 4, 5]; // máximo cuerpo a cuerpo simultáneo por etapa (índice = etapa)
  const NOTIFY_GAP = 2.6;
  const SPAWN_RATE = [null, 0.3, 0.4, 0.5, 0.6]; // zombies/s sostenidos por etapa (de día; ×1.5 de noche)
  const SPAWN_BURST = 6;           // apariciones acumulables (relleno inicial al llegar a una zona)
  const HORDE_CD = [null, 35, 32, 28, 22]; // s mínimos entre mini-hordas de gritón, por etapa
  const BIG_R = 16;                // radio desde el que un zombi usa el campo de flujo "grande"
  const BIG_INFLATE = 16;          // inflado de obstáculos de ese campo (u)
  const INTENSITY_KILL = 0.07;     // intensidad por muerte cercana
  const INTENSITY_HP = 60;         // daño recibido que suma 1 de intensidad
  const RELAX_TIME = [14, 24];     // duración de la calma (s)
  const RELAX_POP = 0.45;          // fracción de la población objetivo durante la calma
  // ---- interiores (pistas de aparición del mundo v2) ----
  const INDOOR_SCAN = 1.3;         // s entre barridos de pistas de interior
  const INDOOR_SHARE = 0.45;       // fracción máxima de la población que puede estar dormida en interiores
  const INDOOR_WEIGHT = 0.6;       // cuánto cuenta un dormido de interior para la población objetivo de exterior
  const INDOOR_MIN_D = 260;        // no aparecen más cerca que esto (~8 m), y nunca a la vista
  const INDOOR_FORGET = 1900;      // una pista se puede volver a tirar cuando el jugador se aleja tanto
  const STRONG_BT = { hospital: 1, police: 1, military: 1, bunker: 1 }; // más y más fuertes
  const NOISE_AMBUSH = { shot: 1, scream: 1, impact: 1, explosion: 1, chest_alarm: 1 };
  const MUFFLE = 0.6;              // ruido a través de paredes (otro edificio / dentro↔fuera)

  const KINDS = ['bullet', 'melee', 'fire', 'explosion'];
  const KIND_MAP = {
    bullet: 'bullet', shot: 'bullet', pistol: 'bullet', rifle: 'bullet', shotgun: 'bullet',
    melee: 'melee', shove: 'melee', knife: 'melee', bat: 'melee', axe: 'melee',
    fire: 'fire', molotov: 'fire', flame: 'fire',
    explosion: 'explosion', grenade: 'explosion',
  };
  const SECTORS = ['ESTE', 'SURESTE', 'SUR', 'SUROESTE', 'OESTE', 'NOROESTE', 'NORTE', 'NORESTE'];

  const RESIST_MSG = {
    bullet: ['Su piel se endurece contra las balas', 'Las balas les hacen menos daño: su carne se vuelve correosa',
      'Aprendieron a aguantar tus balas: cambia de táctica', 'Sus cuerpos casi ignoran las balas'],
    melee: ['Se afianzan contra tus golpes y empujones', 'Tus golpes ya no los tumban como antes',
      'Aprendieron a encajar tus golpes', 'Tus golpes apenas los mueven'],
    fire: ['Su carne ya no arde tan fácil', 'El fuego les hace menos daño',
      'Aprendieron a soportar el fuego', 'El fuego casi no los detiene'],
    explosion: ['Las explosiones ya no los dispersan como antes', 'Resisten mejor las explosiones',
      'Las explosiones les hacen poco daño', 'Casi ignoran las explosiones'],
  };
  const NIGHT_MSG = ['Te vieron rondar de noche: los acechadores salen a cazarte',
    'Más acechadores rondan en la oscuridad', 'La noche es suya: los acechadores te esperan'];
  const FAR_MSG = ['Temen tu puntería: ahora esquivan tus disparos',
    'Aprendieron a cubrirse de tus disparos', 'Corren de cobertura en cobertura: ya no se dejan cazar de lejos'];
  const NEAR_MSG = ['Te gusta pelear de cerca: los brutos vienen por ti',
    'Más tanques se suman a la cacería', 'Los muertos traen a sus bestias más grandes contra ti'];
  function fleeMsg(sector, lv) {
    const S = SECTORS[sector];
    if (lv >= 3) return 'Tu ruta de escape al ' + S + ' es ahora una trampa';
    if (lv === 2) return 'Más muertos te esperan al ' + S + ', tu ruta de escape';
    return 'Los muertos aprendieron tu ruta de escape: te esperan al ' + S;
  }

  const COL_STAGE = '#ff5a40', COL_ADAPT = '#ffb347', COL_MUT = '#c58cff', COL_WARN = '#ff8060';

  // Perfil de aprendizaje persistente
  function defaultProfile() {
    return {
      v: 1,
      use: { bullet: 0, melee: 0, fire: 0, explosion: 0 },        // uso por tipo de daño (decae por día)
      resist: { bullet: 0, melee: 0, fire: 0, explosion: 0 },     // resistencia derivada (0..0.4)
      flee: [0, 0, 0, 0, 0, 0, 0, 0],                             // segundos huyendo por sector
      fleeSector: -1, fleeLevel: 0,
      nightOut: 0, nightLevel: 0,                                 // segundos fuera de la zona segura de noche
      killFar: 0, killNear: 0, rangeLevel: 0,                     // >0 lejos, <0 cerca
      shown: { bullet: 0, melee: 0, fire: 0, explosion: 0, night: 0, far: 0, near: 0, flee: 0, fleeSector: -1 },
      stageShown: 1, mutShown: 0,
      // ganchos para fases futuras
      baseSide: [0, 0, 0, 0],            // lado de la base defendido (N, E, S, O)
      family: { aloneTime: 0, level: 0 }, // familia sola en la base
    };
  }
  // Copia valores numéricos válidos de src sobre dst (misma forma)
  function mergeInto(dst, src) {
    if (!src || typeof src !== 'object') return dst;
    for (const k in dst) {
      const dv = dst[k], sv = src[k];
      if (typeof dv === 'number') { if (typeof sv === 'number' && isFinite(sv)) dst[k] = sv; }
      else if (Array.isArray(dv)) {
        if (Array.isArray(sv)) for (let i = 0; i < dv.length; i++) if (typeof sv[i] === 'number' && isFinite(sv[i])) dv[i] = sv[i];
      } else if (dv && typeof dv === 'object') mergeInto(dv, sv);
    }
    return dst;
  }

  class Director {
    constructor(game) {
      this.game = game;
      this.profile = defaultProfile();
      this.flow = TM.FlowField ? new TM.FlowField(80, 80, 16) : null;
      // segundo campo con obstáculos más inflados para zombis grandes (tanques): evita huecos estrechos
      this.flowBig = TM.FlowField ? new TM.FlowField(80, 80, 16) : null;
      if (this.flowBig) { this.flowBig.inflate = BIG_INFLATE; this.flowBig.minDoor = 44; } // el tanque (r 20) no cabe por puertas de 34–38 u
      this._needBig = false;
      this.stage = 1;
      this._lastDay = null;
      this.clock = 0;
      this.frame = 0;
      this.spawnT = 1.5;
      this.spawnBudget = 4;
      this.target = 0;
      this.pending = [];          // apariciones diferidas (hordas)
      this.hordeCd = 0;
      this.groups = [];           // emboscadas
      this.ambushT = rr(25, 40);
      this.fleeAmbT = rr(40, 60);
      this.flankT = 0;
      this.learnAcc = 0;
      this.tokensUsed = 0;
      this.groanBudget = 1;
      this.intensity = 0;         // ritmo: sube con muertes cercanas y daño recibido
      this.relaxT = 0;            // fase de calma tras un pico
      this._lastHp = null;
      this.notifyQ = []; this.notifyT = 1.5;
      this.fleeNotifyT = 0;
      this.screamTip = false;
      this.info = { living: 0, alerted: 0, chasers: 0, dormant: 0, chaseA: 0, counts: { normal: 0, acechador: 0, griton: 0, tanque: 0 } };
      this.stats = { spawned: 0, killed: 0, hordes: 0, ambushes: 0, indoor: 0 };
      // rejilla espacial para separación (centrada en el jugador)
      this.hCell = 48; this.hCols = 64; this.hRows = 64;
      this.hHead = new Int32Array(this.hCols * this.hRows);
      this.hNext = new Int32Array(256);
      this._flankArr = [];
      this.indoorT = 2;
      this.hintMem = new Map();   // pistas de interior ya tiradas (clave -> {x, y})
    }

    list() { const g = this.game; return g.zombies || (g.zombies = []); }
    _maxZ() { return (TM.Config && TM.Config.maxZombies) || 55; }
    stageInfo() {
      const s = TM.Evolution ? TM.Evolution.stage(this.game.day || 1) : { stage: 1, name: 'Los muertos caminan' };
      return { stage: s.stage, name: s.name };
    }
    maxAttackers() { return ATTACKERS[Math.min(this.stage, 4)] || 6; }

    // Turnos de ataque cuerpo a cuerpo (limita cuántos golpean a la vez)
    requestToken(z) {
      if (z.hasToken) return true;
      if (this.tokensUsed >= this.maxAttackers()) return false;
      z.hasToken = true; z.tokenT = 0;
      this.tokensUsed++;
      return true;
    }
    releaseToken(z) {
      if (!z.hasToken) return;
      z.hasToken = false;
      this.tokensUsed = Math.max(0, this.tokensUsed - 1);
    }
    canGroan() {
      if (this.groanBudget >= 1) { this.groanBudget -= 1; return true; }
      return false;
    }
    resistFor(kind) {
      const k = KIND_MAP[kind];
      return k ? (this.profile.resist[k] || 0) : 0;
    }

    // ---------- bucle ----------
    update(dt) {
      const g = this.game, p = g.player, w = g.world;
      if (!p || !w || !(dt > 0)) return;
      dt = Math.min(dt, 0.05);
      this.clock += dt;
      this.frame++;
      this.hordeCd -= dt;
      this.groanBudget = Math.min(2, this.groanBudget + dt * 1.2);
      const zs = this.list();
      const pAlive = p.alive !== false;

      this._dayCheck(g.day || 1);
      const fc = this.flow ? this.flow.computes : 0;
      if (this.flow && pAlive) this.flow.update(dt, w, p.x, p.y);
      // el campo grande nunca se recalcula en el mismo frame que el normal (reparte el pico)
      if (this.flowBig && pAlive && this._needBig) { if (!this.flow || this.flow.computes === fc || !this.flowBig.valid) this.flowBig.update(dt, w, p.x, p.y); }
      else if (this.flowBig) this.flowBig.valid = false;

      // recuento del frame
      const info = this.info, counts = info.counts;
      info.living = 0; info.alerted = 0; info.chasers = 0; info.dormant = 0;
      counts.normal = 0; counts.acechador = 0; counts.griton = 0; counts.tanque = 0;
      let tokens = 0, sx = 0, sy = 0, needBig = false;
      for (let i = 0; i < zs.length; i++) {
        const z = zs[i];
        if (z.dead || z.remove) continue;
        info.living++;
        counts[z.type] = (counts[z.type] || 0) + 1;
        if (z.hasToken) tokens++;
        if (z.state === 'dormant') info.dormant++;
        if (z.r >= BIG_R && z._pd < 700 && z.state !== 'fakeDead' && z.state !== 'ambush') needBig = true;
        if (z.alerted) {
          info.alerted++;
          if (z._pd < 500) { info.chasers++; sx += z.x - p.x; sy += z.y - p.y; }
        }
      }
      info.chaseA = Math.atan2(sy, sx);
      this.tokensUsed = tokens;
      this._needBig = needBig;

      if (pAlive) {
        this._pacing(dt, p);
        this.learnAcc += dt;
        if (this.learnAcc >= 0.25) { this._learnTick(this.learnAcc, zs); this.learnAcc = 0; }
        this._spawnLogic(dt, info);
        this._indoorLogic(dt, info);
        this._ambushLogic(dt, info);
      }
      this._pendingLogic(dt, info);

      if (this.stage >= 3) {
        this.flankT -= dt;
        if (this.flankT <= 0) { this.flankT = 0.5; this._assignFlanks(zs, p); }
      }

      for (let i = 0; i < zs.length; i++) {
        const z = zs[i];
        if (z.remove) continue;
        z.update(dt, g, this);
      }

      this._separate(zs, p);
      this._collide(zs, p, w, pAlive);
      this._cleanup(zs);
      this._notifyLogic(dt);
    }

    // Ritmo: tras un pico de acción, una fase de calma con menos apariciones
    _pacing(dt, p) {
      if (this._lastHp !== null && p.hp < this._lastHp) this.intensity += (this._lastHp - p.hp) / INTENSITY_HP;
      this._lastHp = p.hp;
      this.intensity = Math.max(0, this.intensity - dt * 0.025);
      this.relaxT -= dt;
      if (this.intensity >= 1 && this.relaxT <= 0) {
        this.relaxT = rr(RELAX_TIME[0], RELAX_TIME[1]) * (this.stage >= 3 ? 0.7 : 1) * (1 - 0.35 * (this.game.darkness || 0));
        this.intensity = 0.5;
      }
    }

    // ---------- días, etapas y mutaciones ----------
    _dayCheck(day) {
      const E = TM.Evolution;
      if (!E) return;
      const prof = this.profile;
      if (this._lastDay === null) {
        // primera actualización (nueva partida o carga): sin avisos
        this._lastDay = day;
        this.stage = E.stage(day).stage;
        prof.stageShown = Math.max(prof.stageShown, this.stage);
        prof.mutShown = Math.max(prof.mutShown, E.mutations(day).length);
        return;
      }
      if (day === this._lastDay) return;
      const steps = clamp(day - this._lastDay, 0, 5);
      this._lastDay = day;
      for (let s = 0; s < steps; s++) this._dailyDecay();
      this.notifyT = Math.max(this.notifyT, 1.8); // tras "Amanece el DÍA N"

      const st = E.stage(day);
      if (st.stage !== this.stage) {
        this.stage = st.stage;
        if (st.stage > prof.stageShown) {
          prof.stageShown = st.stage;
          this._notify('DÍA ' + day + ' — ' + st.banner, COL_STAGE);
        }
      }
      const muts = E.mutations(day);
      for (let i = prof.mutShown; i < muts.length; i++) this._notify(muts[i].msg, COL_MUT);
      prof.mutShown = Math.max(prof.mutShown, muts.length);

      // los vivos se ponen al día
      const w = this.game.world, zs = this.list();
      for (let i = 0; i < zs.length; i++) {
        const z = zs[i];
        if (!z.dead && z.refreshStats) z.refreshStats(day, prof, w && w.dangerAt ? w.dangerAt(z.x, z.y) : 0);
      }
    }

    _dailyDecay() {
      const prof = this.profile;
      for (const k of KINDS) prof.use[k] *= 0.8;
      for (let i = 0; i < 8; i++) prof.flee[i] *= 0.7;
      prof.nightOut *= 0.7;
      prof.killFar *= 0.75; prof.killNear *= 0.75;
      this._evalAdapt(true);
      // permite volver a anunciar niveles que bajaron
      const sh = prof.shown;
      for (const k of KINDS) sh[k] = Math.min(sh[k], this._resistLevel(prof.resist[k], k));
      sh.night = Math.min(sh.night, prof.nightLevel);
      sh.far = Math.min(sh.far, Math.max(0, prof.rangeLevel));
      sh.near = Math.min(sh.near, Math.max(0, -prof.rangeLevel));
      sh.flee = Math.min(sh.flee, prof.fleeLevel);
    }

    // ---------- aparición ----------
    _targetPop() {
      const g = this.game, p = g.player, w = g.world, day = g.day || 1;
      const dark = g.darkness || 0, rain = (g.weather && g.weather.rain) || 0;
      const danger = w && w.dangerAt ? w.dangerAt(p.x, p.y) : 0;
      const base = 7 + 1.2 * Math.min(day - 1, 15) + 0.3 * Math.max(0, day - 16);
      const nightF = 1 + 0.6 * dark * (1 + 0.12 * this.profile.nightLevel);
      const rainF = 1 + 0.25 * rain;
      const dF = 1 + 0.45 * Math.min(danger, 3) + 0.1 * Math.max(0, danger - 3);
      const S = safeR();
      const campF = lerp(lerp(0.06, 0.45, dark), 1, smoothstep(S * 1.1, S * 4.5, Math.hypot(p.x, p.y)));
      // días 1–3 más suaves: el jugador aprende antes de que la cosa se ponga seria
      const earlyF = day <= 1 ? 0.55 : day === 2 ? 0.7 : day === 3 ? 0.85 : 1;
      return Math.min(this._maxZ(), Math.round(base * nightF * rainF * dF * campF * earlyF));
    }

    _pickType(counts) {
      const g = this.game, p = g.player, w = g.world, E = TM.Evolution;
      if (!E) return 'normal';
      const danger = w && w.dangerAt ? w.dangerAt(p.x, p.y) : 0;
      const W = E.spawnWeights(g.day || 1, g.darkness || 0, this.profile, danger);
      for (const t of ['acechador', 'griton', 'tanque']) {
        if ((counts[t] || 0) >= E.maxOfType(t, this.stage, this.profile)) W[t] = 0;
      }
      let tot = 0;
      for (const k in W) tot += W[k];
      let r = Math.random() * tot;
      for (const k in W) { r -= W[k]; if (r <= 0) return k; }
      return 'normal';
    }

    // Punto libre fuera de pantalla alrededor del jugador
    _spawnPoint(baseA, spread, r, allowSafe) {
      const g = this.game, p = g.player, w = g.world, cam = g.camera;
      const vw = cam ? cam.viewW : 800, vh = cam ? cam.viewH : 430;
      const half = 0.5 * Math.hypot(vw, vh);
      const S = safeR() + 60;
      for (let i = 0; i < 10; i++) {
        const a = baseA === null || baseA === undefined ? Math.random() * TAU : baseA + rr(-spread, spread);
        const d = rr(half + 70, half + 330);
        const x = p.x + Math.cos(a) * d, y = p.y + Math.sin(a) * d;
        if (!allowSafe && x * x + y * y < S * S) continue;
        if (cam && cam.inView && cam.inView(x, y, 50)) continue;
        if (w && w.isFree && !w.isFree(x, y, r + 2)) continue;
        if (w && w.buildingAt && w.buildingAt(x, y)) continue; // los de interior los pone _indoorLogic
        return { x, y };
      }
      return null;
    }

    _makeZombie(type, x, y, opts) {
      if (!TM.Zombie) return null;
      const g = this.game, w = g.world;
      const danger = w && w.dangerAt ? w.dangerAt(x, y) : 0;
      const o = { game: g, day: g.day || 1, profile: this.profile, danger };
      if (opts) for (const k in opts) o[k] = opts[k];
      const z = new TM.Zombie(type, x, y, o);
      this.list().push(z);
      this.stats.spawned++;
      return z;
    }

    // Zombies/s sostenidos: las muertes no se reponen al instante
    _spawnRate() {
      const g = this.game, p = g.player, w = g.world;
      const danger = w && w.dangerAt ? w.dangerAt(p.x, p.y) : 0;
      let r = SPAWN_RATE[Math.min(this.stage, 4)] * (1 + 0.5 * (g.darkness || 0)) * (1 + 0.25 * Math.min(danger, 3));
      if (this.relaxT > 0) r *= 0.4;
      return r;
    }

    _spawnLogic(dt, info) {
      this.spawnBudget = Math.min(SPAWN_BURST, this.spawnBudget + this._spawnRate() * dt);
      this.spawnT -= dt;
      if (this.spawnT > 0) return;
      const g = this.game, p = g.player;
      this.target = this._targetPop();
      if (this.relaxT > 0) this.target = Math.round(this.target * RELAX_POP);
      const living = info.living;
      const eff = living - Math.floor(info.dormant * INDOOR_WEIGHT); // los dormidos de interior cuentan menos
      if (eff >= this.target) { this.spawnT = 0.8; return; }
      const st = this.stage;
      let n = st >= 3 ? ri(2, 4) : st === 2 ? ri(1, 3) : ri(1, 2);
      n = Math.min(n, this.target - eff, this._maxZ() - living, Math.floor(this.spawnBudget));
      if (n <= 0) { this.spawnT = 0.5; return; }
      this.spawnT = rr(1.0, 2.2);
      // dirección de aparición
      const prof = this.profile;
      const sp = Math.hypot(p.vx || 0, p.vy || 0);
      const roll = Math.random();
      let baseA = null, spread = PI;
      if (prof.fleeLevel > 0 && prof.fleeSector >= 0 && roll < 0.12 + 0.08 * prof.fleeLevel) { baseA = prof.fleeSector * PI / 4; spread = 0.5; }
      else if (st >= 4 && info.chasers >= 3 && roll < 0.5) { baseA = info.chaseA + PI; spread = 0.8; } // por el lado contrario
      else if (sp > 40 && roll < 0.6) { baseA = Math.atan2(p.vy, p.vx); spread = 1.2; }
      const pt = this._spawnPoint(baseA, spread, 14, false);
      if (!pt) return;
      const w = g.world;
      for (let i = 0; i < n; i++) {
        const type = this._pickType(info.counts);
        let x = pt.x, y = pt.y;
        if (i > 0) {
          const a = Math.random() * TAU, dd = rr(22, 48);
          x += Math.cos(a) * dd; y += Math.sin(a) * dd;
          if (w && w.isFree && !w.isFree(x, y, 14)) continue;
        }
        const fake = this.stage >= 4 && (type === 'normal' || type === 'acechador') && Math.random() < 0.12;
        if (this._makeZombie(type, x, y, fake ? { state: 'fakeDead' } : null)) {
          info.living++;
          info.counts[type] = (info.counts[type] || 0) + 1;
          this.spawnBudget -= 1;
        }
      }
    }

    // ---------- interiores ----------
    // Pistas de aparición solo de chunks ya generados (no fuerza generación síncrona)
    _readyHints(x0, y0, x1, y1) {
      const w = this.game.world;
      if (!w.chunks || !w.key) return w.spawnHints(x0, y0, x1, y1);
      const CH = (TM.Config && TM.Config.CHUNK) || 512;
      const out = [];
      const c0 = Math.floor(x0 / CH), c1 = Math.floor(x1 / CH), r0 = Math.floor(y0 / CH), r1 = Math.floor(y1 / CH);
      for (let cy = r0; cy <= r1; cy++) {
        for (let cx = c0; cx <= c1; cx++) {
          const ch = w.chunks.get(w.key(cx, cy));
          if (!ch || ch.state !== 2) continue;
          const hs = w.spawnHints(Math.max(x0, ch.x0), Math.max(y0, ch.y0), Math.min(x1, ch.x0 + CH - 0.01), Math.min(y1, ch.y0 + CH - 0.01));
          for (let i = 0; i < hs.length; i++) out.push(hs[i]);
        }
      }
      return out;
    }

    // Zombies dormidos dentro de edificios (habitaciones, naves, "INFECTADOS DENTRO"), fuera de la vista
    _indoorLogic(dt, info) {
      this.indoorT -= dt;
      if (this.indoorT > 0) return;
      this.indoorT = INDOOR_SCAN;
      const g = this.game, p = g.player, w = g.world, cam = g.camera;
      if (!w || !w.spawnHints) return;
      for (const [k, e] of this.hintMem) if (Math.hypot(e.x - p.x, e.y - p.y) > INDOOR_FORGET) this.hintMem.delete(k);
      const maxZ = this._maxZ();
      let budget = Math.min(8, maxZ - info.living, Math.round(maxZ * INDOOR_SHARE) - info.dormant);
      if (budget <= 0) return;
      const vw = cam ? cam.viewW : 800, vh = cam ? cam.viewH : 430;
      const R = Math.max(vw, vh) / 2 + 420;
      const hints = this._readyHints(p.x - R, p.y - R, p.x + R, p.y + R);
      if (!hints.length) return;
      const S = safeR() + 80;
      const curB = w.curB;
      for (let i = 0; i < hints.length && budget > 0; i++) {
        const h = hints[i];
        if (!h.indoor) continue;
        const key = (h.buildingId || '?') + ':' + Math.round(h.x) + ':' + Math.round(h.y);
        if (this.hintMem.has(key)) continue;
        if (h.x * h.x + h.y * h.y < S * S) { this.hintMem.set(key, { x: h.x, y: h.y }); continue; }
        // nunca a la vista ni demasiado cerca: se vuelve a intentar más tarde
        if (cam && cam.inView && cam.inView(h.x, h.y, 90)) continue;
        if (Math.hypot(h.x - p.x, h.y - p.y) < INDOOR_MIN_D) continue;
        if (curB && curB.id === h.buildingId && w.lineOfSight && w.lineOfSight(p.x, p.y, h.x, h.y)) continue;
        this.hintMem.set(key, { x: h.x, y: h.y });
        budget -= this._fillHint(h, info, budget);
      }
    }

    _fillHint(h, info, budget) {
      const g = this.game, w = g.world;
      const b = w.buildingAt ? w.buildingAt(h.x, h.y) : null;
      if (!b) return 0;
      const bt = h.buildingType || b.type;
      const strong = !!STRONG_BT[bt];
      const danger = Math.max(0, +h.danger || (w.dangerAt ? w.dangerAt(h.x, h.y) : 0));
      // la pista "INFECTADOS DENTRO" llena el edificio (según su superficie); el resto de sus pistas, algo más
      const infected = !!h.infected;
      const m2 = (b.w * b.h) / (32 * 32);
      let n;
      if (infected) n = Math.min(12, ri(3, 5) + Math.min(this.stage - 1, 2) + Math.floor(m2 / 120));
      else {
        let chance = (0.28 + 0.12 * Math.min(danger, 3)) * (strong ? 1.6 : bt === 'house' || bt === 'farmhouse' ? 0.8 : 1);
        if (b.infected) chance *= 1.5;
        if (this.relaxT > 0) chance *= 0.6;
        if (Math.random() > Math.min(0.9, chance)) return 0;
        n = 1 + (Math.random() < 0.2 + 0.1 * Math.min(danger, 3) ? 1 : 0) + (strong ? ri(0, 2) : 0);
      }
      n = Math.min(n, budget);
      const zDanger = danger + (strong ? 0.6 : 0) + (infected ? 0.3 : 0);
      const rooms = b.det && b.det.rooms && b.det.rooms.length ? b.det.rooms : null;
      const big = b.w * b.h > 600 * 600;
      let made = 0;
      for (let k = 0; k < n; k++) {
        let type = this._pickType(info.counts);
        if (type === 'tanque' && !big) type = 'normal';        // no cabría por las puertas
        const r = type === 'tanque' ? 22 : 13;
        // posición: alrededor de la pista; los infectados se reparten por las habitaciones
        let x = h.x + rr(-28, 28), y = h.y + rr(-28, 28);
        if (infected && rooms && k > 0) {
          const rm = rooms[(Math.random() * rooms.length) | 0];
          if (rm.w > r * 2 + 8 && rm.h > r * 2 + 8) { x = rr(rm.x + r + 4, rm.x + rm.w - r - 4); y = rr(rm.y + r + 4, rm.y + rm.h - r - 4); }
        }
        if (w.isFree && !w.isFree(x, y, r)) {
          if (!w.findFree) continue;
          const f = w.findFree(x, y, r, 64);
          if (!w.isFree(f.x, f.y, r)) continue;
          x = f.x; y = f.y;
        }
        const bb = w.buildingAt(x, y);
        if (!bb || bb.id !== b.id) continue;                    // que no quede fuera de los muros
        const z = this._makeZombie(type, x, y, { state: 'dormant', indoor: true, danger: zDanger });
        if (!z) continue;
        z.bId = b.id;
        made++;
        info.living++; info.dormant++;
        info.counts[type] = (info.counts[type] || 0) + 1;
        this.stats.indoor++;
      }
      return made;
    }

    // Elimina el no alertado más lejano fuera de pantalla para hacer sitio
    _cullOne() {
      const zs = this.list(), cam = this.game.camera;
      let best = null, bd = 700;
      for (let i = 0; i < zs.length; i++) {
        const z = zs[i];
        if (z.dead || z.remove || z.alerted || z.group) continue;
        if (cam && cam.inView && cam.inView(z.x, z.y, 40)) continue;
        if (z._pd > bd) { bd = z._pd; best = z; }
      }
      if (!best) return false;
      best.remove = true;
      this.info.living--;
      return true;
    }

    // ---------- gritos y hordas ----------
    onScream(z) {
      const g = this.game, p = g.player;
      fx(g, 'ring', z.x, z.y, 900, 'rgba(235,225,180,0.55)', 1.3);
      fx(g, 'ring', z.x, z.y, 280, 'rgba(255,110,80,0.7)', 0.6);
      sfx('scream', z.x, z.y, { volume: 1 });
      const d = Math.hypot(p.x - z.x, p.y - z.y);
      if (g.shake && d < 650) g.shake(d < 250 ? 6 : 3);
      this.onNoise(z.x, z.y, 900, 'scream');
      // mini-horda (con enfriamiento global para que varios gritones no saturen)
      if (this.hordeCd <= 0) {
        const n = clamp(3 + this.stage + ri(0, 2), 4, 8);
        this.spawnHorde(z.x, z.y, n);
        this.hordeCd = HORDE_CD[Math.min(this.stage, 4)];
      }
      if (!this.screamTip) {
        this.screamTip = true;
        this._notify('¡Un gritón llamó a la horda! Mátalos antes de que griten', COL_WARN, true);
      }
    }

    spawnHorde(x, y, n) {
      const p = this.game.player;
      const baseA = Math.atan2(y - p.y, x - p.x);
      const dirs = this.stage >= 4 ? [baseA, baseA + rr(1.6, 2.4), baseA - rr(1.6, 2.4)] : [baseA];
      let t = 0.3;
      for (let i = 0; i < n; i++) {
        t += rr(0.12, 0.35);
        this.pending.push({ t, a: dirs[i % dirs.length] });
      }
      this.stats.hordes++;
    }

    _pendingLogic(dt, info) {
      const g = this.game, p = g.player;
      for (let i = this.pending.length - 1; i >= 0; i--) {
        const q = this.pending[i];
        q.t -= dt;
        if (q.t > 0) continue;
        this.pending.splice(i, 1);
        if (p.alive === false) continue;
        if (info.living >= this._maxZ() && !this._cullOne()) continue;
        const pt = this._spawnPoint(q.a, 0.7, 14, false); // nunca dentro del radio seguro
        if (!pt) continue;
        let type = 'normal';
        if (this.stage >= 2 && Math.random() < 0.15 && TM.Evolution &&
            (info.counts.acechador || 0) < TM.Evolution.maxOfType('acechador', this.stage, this.profile)) type = 'acechador';
        const z = this._makeZombie(type, pt.x, pt.y, { alertX: p.x, alertY: p.y, knows: true });
        if (!z) continue;
        z.homing = 8; // el grito los guía hacia el jugador un rato
        info.living++;
        info.counts[type] = (info.counts[type] || 0) + 1;
      }
    }

    // ---------- emboscadas ----------
    _ambushLogic(dt, info) {
      const g = this.game, p = g.player;
      for (let i = this.groups.length - 1; i >= 0; i--) {
        const gp = this.groups[i];
        let alive = 0;
        for (const m of gp.members) if (!m.dead && !m.remove) alive++;
        if (alive === 0 || gp.active) { this.groups.splice(i, 1); continue; }
        if (Math.hypot(gp.x - p.x, gp.y - p.y) > CULL_DIST + 100) {
          for (const m of gp.members) if (!m.dead && (m.state === 'ambush' || m.state === 'fakeDead')) m.remove = true;
          this.groups.splice(i, 1);
        }
      }
      if (Math.hypot(p.x, p.y) < safeR() * 1.6) return;
      this.ambushT -= dt;
      this.fleeAmbT -= dt;
      if (this.stage >= 4 && this.ambushT <= 0) {
        this.ambushT = rr(28, 48) * (g.isNight ? 0.75 : 1);
        if (this.groups.length < 2) this._placeAmbush('trap', info);
      }
      const fl = this.profile.fleeLevel;
      if (fl > 0 && this.fleeAmbT <= 0) {
        this.fleeAmbT = rr(50, 75) / (0.7 + 0.3 * fl);
        if (this.groups.length < 3) this._placeAmbush('flee', info);
      }
    }

    _placeAmbush(mode, info) {
      const g = this.game, p = g.player, w = g.world, prof = this.profile, E = TM.Evolution;
      let n = mode === 'flee' ? Math.min(4, 1 + prof.fleeLevel) : ri(3, 6);
      let a;
      if (mode === 'flee' && prof.fleeSector >= 0) a = prof.fleeSector * PI / 4;
      else {
        const sp = Math.hypot(p.vx || 0, p.vy || 0);
        a = sp > 30 ? Math.atan2(p.vy, p.vx) : p.aimAngle;
      }
      // centro por delante, fuera de pantalla y, si se puede, sin línea de visión
      let c = null, fallback = null;
      for (let i = 0; i < 6; i++) {
        const pt = this._spawnPoint(a, 0.45, 14, false);
        if (!pt) continue;
        if (!w.lineOfSight || !w.lineOfSight(p.x, p.y, pt.x, pt.y)) { c = pt; break; }
        if (!fallback) fallback = pt;
      }
      c = c || fallback;
      if (!c) return;
      // hacer sitio retirando lejanos no alertados
      let room = this._maxZ() - info.living;
      while (room < n && this._cullOne()) room++;
      n = Math.min(n, room);
      if (n < 1) return;
      const gp = { x: c.x, y: c.y, members: [], active: false, mode };
      const maxA = E ? E.maxOfType('acechador', this.stage, prof) : 4;
      for (let i = 0; i < n; i++) {
        const ang = Math.random() * TAU, dd = i === 0 ? 0 : rr(25, 75);
        const x = c.x + Math.cos(ang) * dd, y = c.y + Math.sin(ang) * dd;
        if (w.isFree && !w.isFree(x, y, 13)) continue;
        let type = 'normal';
        if (mode === 'flee') { if (Math.random() < 0.5 + 0.15 * prof.fleeLevel) type = 'acechador'; }
        else if (Math.random() < 0.2) type = 'acechador';
        if (type === 'acechador' && (info.counts.acechador || 0) >= maxA) type = 'normal';
        const fake = this.stage >= 4 && Math.random() < 0.35;
        const z = this._makeZombie(type, x, y, { state: fake ? 'fakeDead' : 'ambush' });
        if (!z) continue;
        z.group = gp;
        z.ambushA = Math.atan2(p.y - y, p.x - x);
        z.angle = z.ambushA;
        gp.members.push(z);
        info.living++;
        info.counts[type] = (info.counts[type] || 0) + 1;
      }
      if (gp.members.length) { this.groups.push(gp); this.stats.ambushes++; }
    }

    activateGroup(gp) {
      if (!gp || gp.active) return;
      gp.active = true;
      const g = this.game;
      let any = false;
      for (const m of gp.members) {
        if (!m.dead && m.state === 'ambush') { m.activate(g); any = true; }
        m.group = null;
      }
      if (any) sfx(gp.mode === 'flee' ? 'stalker_hiss' : 'zombie_groan', gp.x, gp.y, { volume: 1, pitch: 0.85 });
    }

    // ---------- flanqueo (etapa 3+) ----------
    _assignFlanks(zs, p) {
      const arr = this._flankArr;
      arr.length = 0;
      for (let i = 0; i < zs.length; i++) {
        const z = zs[i];
        z.flankAngle = null;
        if (z.dead || z.remove || z.type !== 'normal' || z.state !== 'chase' || !z.s || !z.s.flank) continue;
        if (z._pd > 650 || z.unseenT > 1.2) continue;
        arr.push(z);
      }
      const n = arr.length;
      if (n < 2) return;
      let sx = 0, sy = 0;
      for (const z of arr) {
        z._fa = Math.atan2(z.y - p.y, z.x - p.x);
        sx += Math.cos(z._fa); sy += Math.sin(z._fa);
      }
      const ma = Math.atan2(sy, sx);
      for (const z of arr) z._rel = angDiff(ma, z._fa);
      arr.sort((a, b) => a._rel - b._rel);
      const step = this.stage >= 4 ? TAU / n : Math.min(0.9, 4.2 / (n - 1));
      for (let i = 0; i < n; i++) arr[i].flankAngle = ma + (i - (n - 1) / 2) * step;
    }

    // ---------- separación con rejilla espacial ----------
    _separate(zs, p) {
      const C = this.hCell, cols = this.hCols, rows = this.hRows;
      const x0 = p.x - cols * C / 2, y0 = p.y - rows * C / 2;
      const head = this.hHead;
      head.fill(-1);
      if (this.hNext.length < zs.length) this.hNext = new Int32Array(zs.length * 2);
      const next = this.hNext;
      for (let i = 0; i < zs.length; i++) {
        const z = zs[i];
        z._cell = -1;
        if (z.dead || z.remove || z.state === 'fakeDead') continue;
        if (z.x < x0 || z.y < y0) continue;
        const cx = ((z.x - x0) / C) | 0, cy = ((z.y - y0) / C) | 0;
        if (cx >= cols || cy >= rows) continue;
        const c = cy * cols + cx;
        z._cell = c;
        next[i] = head[c];
        head[c] = i;
      }
      for (let i = 0; i < zs.length; i++) {
        const a = zs[i];
        if (a._cell < 0) continue;
        const cx = a._cell % cols, cy = (a._cell - cx) / cols;
        const ma = a.mass * (a.state === 'charge' ? 4 : 1);
        for (let oy = -1; oy <= 1; oy++) {
          const yy = cy + oy;
          if (yy < 0 || yy >= rows) continue;
          for (let ox = -1; ox <= 1; ox++) {
            const xx = cx + ox;
            if (xx < 0 || xx >= cols) continue;
            for (let j = head[yy * cols + xx]; j !== -1; j = next[j]) {
              if (j <= i) continue;
              const b = zs[j];
              let dx = b.x - a.x, dy = b.y - a.y;
              const min = a.r + b.r + 1;
              const d2 = dx * dx + dy * dy;
              if (d2 >= min * min) continue;
              let d = Math.sqrt(d2);
              if (d < 0.001) { const an = Math.random() * TAU; dx = Math.cos(an); dy = Math.sin(an); d = 0.001; }
              else { dx /= d; dy /= d; }
              const over = (min - d) * 0.6;
              const mb = b.mass * (b.state === 'charge' ? 4 : 1);
              const t = ma + mb;
              const fa = over * mb / t, fb = over * ma / t;
              a.x -= dx * fa; a.y -= dy * fa;
              b.x += dx * fb; b.y += dy * fb;
            }
          }
        }
      }
    }

    // Jugador y obstáculos
    _collide(zs, p, w, pAlive) {
      const g = this.game;
      const frame = this.frame;
      for (let i = 0; i < zs.length; i++) {
        const z = zs[i];
        if (z.dead || z.remove || z.state === 'fakeDead') continue;
        if (!isFinite(z.x) || !isFinite(z.y)) { z.remove = true; continue; }
        if (pAlive) {
          const dx = z.x - p.x, dy = z.y - p.y, min = z.r + p.r;
          const d2 = dx * dx + dy * dy;
          if (d2 < min * min) {
            const d = Math.sqrt(d2);
            if (d > 0.001) { z.x = p.x + dx / d * min; z.y = p.y + dy / d * min; }
            else { z.x = p.x + min; }
          }
        }
        if (z._pd > 900 && ((frame + z.id) & 1)) continue; // lejanos: cada dos frames
        if (!w.collideCircle) continue;
        const bx = z.x, by = z.y;
        if (w.collideCircle(z) && z.state === 'charge') {
          const mx = z.x - bx, my = z.y - by;
          const m = Math.sqrt(mx * mx + my * my);
          if (m > 0.5 && (mx * z.chargeDX + my * z.chargeDY) < -0.4 * m) z.chargeBlocked(g);
        }
      }
    }

    _cleanup(zs) {
      for (let i = zs.length - 1; i >= 0; i--) {
        const z = zs[i];
        if (!z.remove) {
          if (z.dead) continue;
          const passive = !z.alerted || z.state === 'ambush' || z.state === 'fakeDead';
          if ((passive && z._pd > CULL_DIST) || z._pd > CULL_DIST_ALERTED) z.remove = true;
          else continue;
        }
        if (z.hasToken) this.releaseToken(z);
        zs.splice(i, 1);
      }
    }

    // ---------- eventos ----------
    // Ruido: 'shot' | 'shove' | 'scream' | 'footstep' | 'impact' | 'melee' | 'door' | 'door_bash' | 'chest' |
    // 'chest_alarm' | 'explosion' | 'glass' | 'flare'. Entre dentro y fuera (o entre edificios) se amortigua.
    onNoise(x, y, radius, kind) {
      const g = this.game, zs = this.list(), w = g.world;
      if (!(radius > 0)) return;
      const nb = w && w.buildingAt ? w.buildingAt(x, y) : null;
      const nbId = nb ? nb.id : null;
      const scream = kind === 'scream';
      for (let i = 0; i < zs.length; i++) {
        const z = zs[i];
        if (z.dead || z.remove) continue;
        let h = radius * (z.s ? z.s.hearing : 1);
        if (!scream && (z.bId || null) !== nbId) h *= MUFFLE;
        const dx = z.x - x, dy = z.y - y;
        const d2 = dx * dx + dy * dy;
        if (d2 > h * h) continue;
        z.hearNoise(x, y, kind, Math.sqrt(d2) / h, g);
        if (scream && z.state !== 'fakeDead' && z.state !== 'ambush') z.homing = Math.max(z.homing || 0, 4);
      }
      if (NOISE_AMBUSH[kind]) {
        for (const gp of this.groups) {
          if (!gp.active && Math.hypot(gp.x - x, gp.y - y) < radius * 0.4) this.activateGroup(gp);
        }
      }
    }

    // Avisa a los cercanos cuando uno descubre al jugador
    alertNear(src, radius) {
      const zs = this.list(), p = this.game.player;
      const r2 = radius * radius;
      for (let i = 0; i < zs.length; i++) {
        const z = zs[i];
        if (z === src || z.dead || z.remove || z.alerted) continue;
        if (z.state !== 'wander' && z.state !== 'search' && z.state !== 'investigate' && z.state !== 'dormant') continue;
        const dx = z.x - src.x, dy = z.y - src.y;
        if (dx * dx + dy * dy > r2) continue;
        z.alertTo(p.x, p.y, true);
      }
    }

    onPlayerAttack(kind) {
      const k = KIND_MAP[kind];
      if (k) this.profile.use[k] += 1;
    }

    onDamage(z, kind, dmg) {
      const k = KIND_MAP[kind];
      if (k && dmg > 0) this.profile.use[k] += 0.5;
    }

    onKill(z, kind) {
      this.stats.killed++;
      const p = this.game.player;
      if (!p || !z) return;
      const d = Math.hypot(z.x - p.x, z.y - p.y);
      if (d > 210) this.profile.killFar++;
      else if (d < 90) this.profile.killNear++;
      if (d < 450) this.intensity += INTENSITY_KILL;
    }

    // ---------- aprendizaje ----------
    _learnTick(dt, zs) {
      const g = this.game, p = g.player, prof = this.profile;
      // 1) dirección de huida
      const vx = p.vx || 0, vy = p.vy || 0;
      const sp = Math.sqrt(vx * vx + vy * vy);
      if (sp > FLEE_SPEED) {
        let cx = 0, cy = 0, n = 0;
        for (let i = 0; i < zs.length; i++) {
          const z = zs[i];
          if (z.dead || z.remove || !z.alerted || z.fakeDead) continue;
          if (z._pd < FLEE_NEAR) { cx += z.x; cy += z.y; n++; }
        }
        if (n > 0) {
          cx /= n; cy /= n;
          const ax = p.x - cx, ay = p.y - cy;
          const al = Math.sqrt(ax * ax + ay * ay) || 1;
          if ((ax * vx + ay * vy) / (al * sp) > 0.5) {
            const sec = ((Math.round(Math.atan2(vy, vx) / (PI / 4)) % 8) + 8) % 8;
            prof.flee[sec] += dt;
          }
        }
      }
      for (let i = 0; i < 8; i++) prof.flee[i] *= (1 - 0.0005);
      // 2) salidas nocturnas
      const S = safeR();
      if ((g.isNight || (g.darkness || 0) > 0.6) && p.x * p.x + p.y * p.y > S * S) prof.nightOut += dt;
      // 3) recalcular adaptaciones
      this._evalAdapt(false);
      this.fleeNotifyT -= dt;
    }

    _resistLevel(r, k) {
      const max = RESIST_MAX[k] || 0.3;
      let lv = 0;
      for (let i = 0; i < RESIST_LV.length; i++) if (r >= RESIST_LV[i] * max - 1e-9) lv = i + 1;
      return lv;
    }

    _evalAdapt(silent) {
      const prof = this.profile, sh = prof.shown;
      const day = this.game.day || 1;
      // resistencias asintóticas, crecen con el uso y con los días
      const ramp = Math.min(1, 0.25 + 0.75 * (day - 1) / 14);
      let total = 0;
      for (const k of KINDS) total += prof.use[k];
      for (const k of KINDS) {
        const share = total > 0 ? prof.use[k] / total : 0;
        const r = RESIST_MAX[k] * ramp * (1 - Math.exp(-prof.use[k] / RESIST_K)) * (0.35 + 0.65 * share);
        prof.resist[k] = r;
        const lv = this._resistLevel(r, k);
        if (lv > sh[k]) { sh[k] = lv; if (!silent) this._notify(RESIST_MSG[k][lv - 1], COL_ADAPT); }
      }
      // ruta de huida
      let ft = 0, bi = -1, bv = 0, second = 0;
      for (let i = 0; i < 8; i++) {
        const v = prof.flee[i];
        ft += v;
        if (v > bv) { second = bv; bv = v; bi = i; } else if (v > second) second = v;
      }
      let flv = 0;
      if (ft >= 15 && bv / ft >= 0.35 && bv >= second * 1.25) flv = ft >= 120 ? 3 : ft >= 50 ? 2 : 1;
      if (flv > 0) {
        const changed = bi !== prof.fleeSector;
        prof.fleeSector = bi;
        prof.fleeLevel = flv;
        if ((flv > sh.flee || (changed && sh.fleeSector !== bi)) && this.fleeNotifyT <= 0) {
          sh.flee = Math.max(sh.flee, flv);
          sh.fleeSector = bi;
          this.fleeNotifyT = 90;
          if (!silent) this._notify(fleeMsg(bi, flv), COL_ADAPT);
        }
      } else {
        prof.fleeLevel = 0;
      }
      // noches fuera
      let nlv = 0;
      for (let i = 0; i < NIGHT_LV.length; i++) if (prof.nightOut >= NIGHT_LV[i]) nlv = i + 1;
      prof.nightLevel = nlv;
      if (nlv > sh.night) { sh.night = nlv; if (!silent) this._notify(NIGHT_MSG[nlv - 1], COL_ADAPT); }
      // distancia de combate
      const tot = prof.killFar + prof.killNear;
      let rl = 0;
      if (tot >= 12) {
        const bias = (prof.killFar - prof.killNear) / tot;
        const ab = Math.abs(bias);
        let m = ab > 0.75 ? 3 : ab > 0.6 ? 2 : ab > 0.45 ? 1 : 0;
        m = Math.min(m, tot >= 45 ? 3 : tot >= 25 ? 2 : 1); // sube de nivel con más evidencia
        rl = bias > 0 ? m : -m;
      }
      if (rl > 0 && this.stage < 2) rl = 0;     // aún no corren ni esquivan
      if (rl < 0 && day < 4) rl = 0;            // aún no hay tanques
      prof.rangeLevel = rl;
      if (rl > 0 && rl > sh.far) { sh.far = rl; if (!silent) this._notify(FAR_MSG[rl - 1], COL_ADAPT); }
      if (rl < 0 && -rl > sh.near) { sh.near = -rl; if (!silent) this._notify(NEAR_MSG[-rl - 1], COL_ADAPT); }
    }

    // ---------- avisos espaciados ----------
    _notify(text, color, priority) {
      if (priority) this.notifyQ.unshift({ text, color });
      else this.notifyQ.push({ text, color });
      if (this.notifyQ.length > 6) this.notifyQ.length = 6;
    }
    _notifyLogic(dt) {
      this.notifyT -= dt;
      if (this.notifyT > 0 || !this.notifyQ.length) return;
      const n = this.notifyQ.shift();
      const g = this.game;
      if (g && typeof g.notify === 'function') g.notify(n.text, n.color);
      this.notifyT = NOTIFY_GAP;
    }

    // ---------- guardado ----------
    serialize() {
      return { v: 1, profile: JSON.parse(JSON.stringify(this.profile)), screamTip: !!this.screamTip };
    }
    deserialize(data) {
      if (!data || typeof data !== 'object') return;
      this.profile = mergeInto(defaultProfile(), data.profile || data);
      this.screamTip = !!data.screamTip;
      this._lastDay = null;
    }

    // Frases cortas para la pantalla de muerte: qué aprendieron los muertos (máx. 4; [] si nada)
    learnedSummary() {
      const prof = this.profile, out = [];
      const pct = (v) => Math.round(v * 100);
      if (prof.fleeLevel > 0 && prof.fleeSector >= 0) out.push('Te esperaban al ' + SECTORS[prof.fleeSector] + ': era tu ruta de escape');
      if (pct(prof.resist.bullet) >= 3) out.push('Su piel resistía un ' + pct(prof.resist.bullet) + ' % de tus balas');
      if (prof.rangeLevel > 0) out.push('Aprendieron a esquivar tu puntería de lejos');
      else if (prof.rangeLevel < 0) out.push('Tu gusto por pelear de cerca les trajo más tanques');
      if (prof.nightLevel > 0) out.push('Tus salidas nocturnas atrajeron a más acechadores');
      if (pct(prof.resist.melee) >= 3) out.push('Encajaban tus golpes un ' + pct(prof.resist.melee) + ' % mejor');
      if (pct(prof.resist.fire) >= 3) out.push('El fuego les hacía un ' + pct(prof.resist.fire) + ' % menos daño');
      if (pct(prof.resist.explosion) >= 3) out.push('Las explosiones les hacían un ' + pct(prof.resist.explosion) + ' % menos daño');
      return out.slice(0, 4);
    }

    // ---------- depuración ----------
    debugText() {
      const zs = this.list(), prof = this.profile, info = this.info;
      let amb = 0, fake = 0, corpses = 0;
      for (const z of zs) {
        if (z.dead) corpses++;
        else if (z.state === 'ambush') amb++;
        else if (z.state === 'fakeDead') fake++;
      }
      const st = this.stageInfo();
      const pc = (v) => Math.round(v * 100) + '%';
      const fs = prof.fleeSector >= 0 ? SECTORS[prof.fleeSector] : '-';
      return [
        'Zombis ' + info.living + '/' + this._maxZ() + ' (obj ' + this.target + ') alerta ' + info.alerted + ' · dormidos ' + info.dormant +
          ' (int ' + this.stats.indoor + ')' +
          ' · emb ' + amb + ' · fingen ' + fake + ' · cadáveres ' + corpses,
        'Etapa ' + st.stage + ': ' + st.name + ' (día ' + (this.game.day || 1) + ') · atacan ' + this.tokensUsed + '/' + this.maxAttackers() +
          ' · hordas ' + this.stats.hordes + ' · emboscadas ' + this.stats.ambushes,
        'Resist bal ' + pc(prof.resist.bullet) + ' cue ' + pc(prof.resist.melee) + ' fue ' + pc(prof.resist.fire) + ' exp ' + pc(prof.resist.explosion),
        'Huida ' + fs + ' nv' + prof.fleeLevel + ' · noche fuera ' + Math.round(prof.nightOut) + 's nv' + prof.nightLevel +
          ' · lejos ' + prof.killFar.toFixed(1) + ' cerca ' + prof.killNear.toFixed(1) + ' nv' + prof.rangeLevel,
        'Flujo ' + (this.flow ? this.flow.lastMs.toFixed(2) + 'ms' : '-') +
          (this.flowBig && this.flowBig.valid ? ' (grande ' + this.flowBig.lastMs.toFixed(2) + 'ms)' : '') +
          ' · pendientes ' + this.pending.length +
          ' · intensidad ' + this.intensity.toFixed(2) + (this.relaxT > 0 ? ' · CALMA ' + Math.ceil(this.relaxT) + 's' : ''),
      ];
    }
  }

  Director.SECTORS = SECTORS;
  TM.Director = Director;
})();
