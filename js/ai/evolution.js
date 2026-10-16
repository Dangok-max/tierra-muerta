// Tierra Muerta — Evolución de los zombies por días: etapas, estadísticas, mutaciones y pesos de aparición.
(function () {
  'use strict';
  const TM = window.TM = window.TM || {};

  // Etapas (sin tope: la 4 dura para siempre, la escalada sigue con estadísticas y mutaciones)
  const STAGES = [
    { stage: 1, from: 1,  name: 'Los muertos caminan', banner: 'Los muertos caminan' },
    { stage: 2, from: 6,  name: 'Los muertos corren',  banner: 'Los muertos ahora corren' },
    { stage: 3, from: 16, name: 'Cazan en manada',     banner: 'Ahora cazan en manada' },
    { stage: 4, from: 31, name: 'Tienden trampas',     banner: 'Ahora tienden trampas' },
  ];

  // Valores base (día 1, peligro 0). walk = velocidad de persecución típica en etapa 1,
  // walk2 = desde la etapa 2; run = corredores (solo 'normal').
  const BASE = {
    normal:    { hp: 55,  r: 11,   walk: 55,  walk2: 55,  run: 140, dmg: 9,  cd: 1.15, reach: 13, sight: 1.0,  hearing: 1.0,  windup: 0.3 },
    acechador: { hp: 42,  r: 9.5,  walk: 108, walk2: 155, run: 0,   dmg: 8,  cd: 1.0,  reach: 12, sight: 1.15, hearing: 1.25, windup: 0.3 },
    griton:    { hp: 50,  r: 12.5, walk: 54,  walk2: 66,  run: 0,   dmg: 5,  cd: 1.3,  reach: 12, sight: 1.1,  hearing: 1.0,  windup: 0.32 },
    tanque:    { hp: 340, r: 20,   walk: 41,  walk2: 52,  run: 0,   dmg: 20, cd: 1.6,  reach: 16, sight: 0.9,  hearing: 0.8,  windup: 0.45 },
  };

  // ---- Ajustes de equilibrio ----
  // Fase 1 (solo pistola): la amenaza crece sobre todo por número, coordinación y tipos;
  // vida, daño y velocidad crecen sin tope pero de forma logarítmica.
  const HP_LOG = 1.28, HP_DAYS = 40; // vida ×(1 + 1.28·ln(1 + (día−1)/40)): día 30 ≈ ×1.70, día 60 ≈ ×2.16, día 100 ≈ ×2.6
  const HP_DANGER = 0.10;         // +10 % de vida por unidad de peligro (lejos del campamento)
  const SPEED_LOG = 0.08;         // velocidad: crecimiento logarítmico
  const DMG_LOG = 0.28;           // daño: crecimiento logarítmico (día 30 ≈ ×1.43, día 60 ≈ ×1.60)
  // velocidad máxima de persecución por tipo (el jugador camina a 150 y corre a 208)
  const SPEED_CAP = { normal: 78, runner: 185, acechador: 195, griton: 90, tanque: 70 };
  const RUN_CHANCE = [0, 0, 0.35, 0.45, 0.55]; // por etapa (normales corredores)
  const DODGE = [0, 0, 0.4, 0.5, 0.55];        // probabilidad de esquivar al ser apuntado
  const COVER = [0, 0, 0.3, 0.4, 0.45];        // probabilidad de buscar cobertura

  function stageOf(day) {
    day = Math.max(1, day | 0);
    let s = STAGES[0];
    for (let i = 0; i < STAGES.length; i++) if (day >= STAGES[i].from) s = STAGES[i];
    return s;
  }

  // ---- Mutaciones visibles: fijas hasta el día 45, luego cíclicas cada 12 días sin tope ----
  const MUT_KINDS = {
    piel:     { name: 'Piel endurecida', hp: 0.10,    msg: 'MUTACIÓN — Su piel se endurece: aguantan más castigo' },
    tendones: { name: 'Tendones tensos', speed: 0.05, msg: 'MUTACIÓN — Tendones tensos: ahora son más rápidos' },
    garras:   { name: 'Garras',          dmg: 0.12,   msg: 'MUTACIÓN — Les crecen garras: sus golpes desgarran' },
    regen:    { name: 'Regeneración',    regen: 0.008, msg: 'MUTACIÓN — Su carne se regenera sola' },
  };
  const MUT_ORDER = ['piel', 'tendones', 'garras', 'regen'];
  const MUT_DAYS = [20, 26, 35, 45];
  const MUT_EVERY = 12;
  const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

  function makeMut(kind, level, day) {
    const k = MUT_KINDS[kind];
    const lv = level < ROMAN.length ? ROMAN[level] : String(level);
    const f = level === 1 ? 1 : 0.6; // los niveles extra son más suaves
    return {
      kind, level, day,
      name: k.name + (level > 1 ? ' ' + lv : ''),
      msg: level > 1 ? k.msg.replace('MUTACIÓN', 'MUTACIÓN ' + lv) : k.msg,
      hp: (k.hp || 0) * f, speed: (k.speed || 0) * f, dmg: (k.dmg || 0) * f, regen: (k.regen || 0) * f,
    };
  }

  function mutations(day) {
    day = Math.max(1, day | 0);
    const out = [];
    for (let i = 0; i < MUT_DAYS.length; i++) {
      if (day >= MUT_DAYS[i]) out.push(makeMut(MUT_ORDER[i], 1, MUT_DAYS[i]));
    }
    const last = MUT_DAYS[MUT_DAYS.length - 1];
    const extra = day > last ? Math.floor((day - last) / MUT_EVERY) : 0;
    for (let j = 0; j < extra; j++) {
      out.push(makeMut(MUT_ORDER[j % MUT_ORDER.length], 2 + Math.floor(j / MUT_ORDER.length), last + (j + 1) * MUT_EVERY));
    }
    return out;
  }

  // Estadísticas de un zombie según tipo, día, perfil de aprendizaje y peligro de la zona
  function stats(type, day, profile, danger) {
    const b = BASE[type] || BASE.normal;
    if (!BASE[type]) type = 'normal';
    day = Math.max(1, (day | 0) || 1);
    danger = Math.max(0, +danger || 0);
    const st = stageOf(day).stage;
    const prof = profile || {};

    const muts = mutations(day);
    let mh = 0, ms = 0, md = 0, regen = 0;
    const mut = { piel: 0, tendones: 0, garras: 0, regen: 0 };
    for (let i = 0; i < muts.length; i++) {
      const m = muts[i];
      mh += m.hp; ms += m.speed; md += m.dmg; regen += m.regen;
      mut[m.kind] = Math.max(mut[m.kind], m.level);
    }

    // peligro: lineal hasta 4, luego muy suave
    const dng = Math.min(danger, 4) + Math.max(0, danger - 4) * 0.25;
    const hpMul = (1 + HP_LOG * Math.log(1 + (day - 1) / HP_DAYS)) * (1 + HP_DANGER * dng) * (1 + mh);
    const spdMul = (1 + SPEED_LOG * Math.log(1 + (day - 1) / 5)) * (1 + ms) * (1 + 0.03 * Math.min(dng, 4));
    const dmgMul = (1 + DMG_LOG * Math.log(1 + (day - 1) / 8)) * (1 + 0.06 * dng) * (1 + md);

    const rl = prof.rangeLevel || 0;
    const farLv = Math.max(0, rl), nearLv = Math.max(0, -rl);

    const speed = Math.min((st >= 2 ? b.walk2 : b.walk) * spdMul, SPEED_CAP[type] || 999);
    const runSpeed = Math.min(b.run * spdMul, SPEED_CAP.runner);
    let runChance = 0;
    if (type === 'normal' && st >= 2) runChance = Math.min(0.75, RUN_CHANCE[Math.min(st, 4)] + 0.08 * farLv);

    const res = prof.resist || {};
    return {
      type, stage: st, day,
      r: b.r,
      hp: Math.round(b.hp * hpMul),
      speed, runSpeed, runChance,
      speedVar: type === 'tanque' ? 0.06 : 0.16,
      damage: b.dmg * dmgMul,
      attackCooldown: b.cd * (st === 1 ? 1.2 : st >= 3 ? 0.9 : 1),
      windup: st === 1 ? b.windup + 0.08 : b.windup,   // etapa 1: telegrafiado más largo
      reach: b.reach,
      sight: b.sight, hearing: b.hearing,
      dodgeChance: (type === 'normal' || type === 'acechador') ? Math.min(0.8, DODGE[Math.min(st, 4)] + (st >= 2 ? 0.1 * farLv : 0)) : 0,
      coverChance: type === 'normal' ? Math.min(0.75, COVER[Math.min(st, 4)] + (st >= 2 ? 0.12 * farLv : 0)) : 0,
      flank: st >= 3,
      retreat: st >= 3 && type !== 'tanque',
      fakeDead: st >= 4 && (type === 'normal' || type === 'acechador'),
      canCharge: type === 'tanque' && st >= 2,
      chargeSpeed: type === 'tanque' ? Math.min(430, 380 * (1 + 0.04 * Math.log(day))) : 0,
      packRadius: st >= 3 ? 280 : 170,
      regen,
      mut,
      nearLv,
      resist: {
        bullet: res.bullet || 0, melee: res.melee || 0, fire: res.fire || 0,
        explosion: res.explosion || 0, vehicle: 0,
      },
    };
  }

  // Pesos de aparición por tipo
  function spawnWeights(day, darkness, profile, danger) {
    day = Math.max(1, day | 0);
    const st = stageOf(day).stage;
    const night = Math.max(0, Math.min(1, darkness || 0));
    const prof = profile || {};
    const nl = prof.nightLevel || 0;
    const rl = prof.rangeLevel || 0;
    const dk = 1 + 0.25 * Math.min(Math.max(0, danger || 0), 3);
    const w = { normal: 1, acechador: 0, griton: 0, tanque: 0 };
    if (day >= 2) {
      w.acechador = ((0.025 + (0.14 - 0.025) * night) + (st >= 2 ? 0.04 : 0)) * (1 + 0.6 * nl * night) * dk;
    }
    if (day >= 3) w.griton = (st >= 2 ? 0.07 : 0.05) * dk;
    if (day >= 4) w.tanque = (st >= 3 ? 0.07 : st >= 2 ? 0.05 : 0.03) * (1 + 0.5 * Math.max(0, -rl)) * dk;
    return w;
  }

  // Máximo simultáneo por tipo especial
  function maxOfType(type, stage, profile) {
    const nl = (profile && profile.nightLevel) || 0;
    if (type === 'griton') return stage <= 2 ? 2 : 3;
    if (type === 'tanque') return stage <= 2 ? 1 : stage === 3 ? 2 : 3;
    if (type === 'acechador') return (stage === 1 ? 3 : stage === 2 ? 4 : 6) + nl;
    return 9999;
  }

  TM.Evolution = {
    STAGES,
    BASE,
    stage(day) {
      const s = stageOf(day);
      return { stage: s.stage, name: s.name, banner: s.banner, from: s.from };
    },
    stats,
    mutations,
    spawnWeights,
    maxOfType,
  };
})();
