// Granjas, hallazgos raros, lugares especiales (base militar, cárcel, aeródromo, polígono),
// elementos de carretera (gasolineras, atascos, controles) y campamento inicial. TM.WG.Places
(function () {
  const U = TM.U;
  const WG = TM.WG = TM.WG || {};
  const G = WG.G;
  const M = 32;
  const R_ = (rng, a, b) => rng.range(a, b) * M;

  // Rectángulo centrado
  const rc = (cx, cy, w, h) => ({ x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), w: Math.round(w), h: Math.round(h) });
  // Lado de un rectángulo que mira hacia un punto
  function faceTo(r, x, y) {
    const dx = x - (r.x + r.w / 2), dy = y - (r.y + r.h / 2);
    if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'e' : 'w';
    return dy > 0 ? 's' : 'n';
  }
  // Camino de tierra desde (x0,y0) hasta (x1,y1) con una curva
  function dirtPath(P, x0, y0, x1, y1, w, kind) {
    const rng = P.rng;
    const mx = (x0 + x1) / 2 + rng.range(-0.2, 0.2) * (y1 - y0), my = (y0 + y1) / 2 + rng.range(-0.2, 0.2) * (x0 - x1);
    const pts = G.catmull([x0, y0, mx, my, x1, y1], 6);
    for (let i = 0; i < pts.length; i += 2) if (P.world.terrain.blocked(pts[i], pts[i + 1])) return null;
    const r = G.makeRoad(pts, w || 120, kind || 'dirt', { local: true });
    P.addRoad(r);
    return r;
  }
  // Huecos donde las carreteras cruzan un tramo de valla
  function roadGaps(P, x0, y0, x1, y1) {
    const gaps = [];
    const horiz = Math.abs(y1 - y0) < Math.abs(x1 - x0);
    P.rh.query(Math.min(x0, x1) - 10, Math.min(y0, y1) - 10, Math.max(x0, x1) + 10, Math.max(y0, y1) + 10, (s) => {
      // intersección segmento-segmento
      const t = U.segRect(s.x0, s.y0, s.x1, s.y1, Math.min(x0, x1), Math.min(y0, y1) - 1, Math.abs(x1 - x0) || 2, Math.abs(y1 - y0) || 2);
      if (t >= 0) {
        const ix = s.x0 + (s.x1 - s.x0) * t, iy = s.y0 + (s.y1 - s.y0) * t;
        const c = horiz ? ix : iy, hw = s.r.w / 2 + 2 * M;
        gaps.push([c - hw, c + hw]);
      }
      return false;
    });
    return gaps;
  }
  function fenceRect(P, r, style, extraGaps) {
    const { x, y, w, h } = r;
    const g = (a, b, c, d) => roadGaps(P, a, b, c, d).concat((extraGaps || []).filter((q) => q.side === (b === d ? (b === y ? 'n' : 's') : (a === x ? 'w' : 'e'))).map((q) => q.g));
    P.fence(x, y, x + w, y, style, g(x, y, x + w, y));
    P.fence(x, y + h, x + w, y + h, style, g(x, y + h, x + w, y + h));
    P.fence(x, y, x, y + h, style, g(x, y, x, y + h));
    P.fence(x + w, y, x + w, y + h, style, g(x + w, y, x + w, y + h));
  }
  function field(P, x, y, w, h) {
    const rng = P.rng;
    const r = { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
    if (!P.okRect(r, 0, 4)) return null;
    P.reserve(r);
    P.area('field', r.x, r.y, r.w, r.h, { rot: rng.chance(0.5) ? 0 : 1, dead: rng.chance(0.6) });
    if (rng.chance(0.45)) {
      const gs = rng.pick(['n', 's', 'e', 'w']);
      fenceRect(P, r, 'wood', [{ side: gs, g: gs === 'n' || gs === 's' ? [r.x + r.w * 0.45, r.x + r.w * 0.55] : [r.y + r.h * 0.45, r.y + r.h * 0.55] }]);
    }
    if (rng.chance(0.25)) P.prop('scarecrow', r.x + r.w * rng.range(0.3, 0.7), r.y + r.h * rng.range(0.3, 0.7), {}, []);
    if (rng.chance(0.15)) P.decal('body', r.x + rng.range(0, r.w), r.y + rng.range(0, r.h), 1, rng.range(0, 6));
    return r;
  }

  // ---------- granjas ----------
  function* planFarm(world, f) {
    const P = new WG.Plan(world, f.key, 'farm', f.seed);
    P.danger = f.dB + 0.1;
    const rng = P.rng;
    yield* WG.warmEdges(world, f.x - 240 * M, f.y - 240 * M, f.x + 240 * M, f.y + 240 * M);
    for (const r of world.macro.roadsInRect(f.x - 160 * M, f.y - 160 * M, f.x + 160 * M, f.y + 160 * M, [])) P.addRoad(r, false);
    P.grow(f.x - f.R, f.y - f.R, f.x + f.R, f.y + f.R);
    // camino de acceso hasta la carretera más cercana
    const nr = world.macro.nearestRoad(f.x, f.y, 240 * M);
    let ax = f.x, ay = f.y + 1;
    if (nr) {
      const a = Math.atan2(nr.y - f.y, nr.x - f.x);
      const sx = f.x + Math.cos(a) * 14 * M, sy = f.y + Math.sin(a) * 14 * M;
      if (dirtPath(P, sx, sy, nr.x, nr.y, 120, 'dirt')) { ax = nr.x; ay = nr.y; }
    }
    yield;
    const t = f.type;
    if (t === 'farm') {
      // casa de campo mirando al camino
      const hw = R_(rng, 10, 12.5), hh = R_(rng, 11, 14);
      const a = Math.atan2(ay - f.y, ax - f.x);
      const hr = rc(f.x + Math.cos(a) * 2 * M, f.y + Math.sin(a) * 2 * M, hw, hh);
      if (P.okRect(hr, 0, 8)) {
        P.reserve(hr, 2 * M);
        const b = P.building('farmhouse', null, hr.x, hr.y, hr.w, hr.h, faceTo(hr, ax, ay), {});
        WG.Settle.storyBuilding(P, b);
        P.area('lawn', hr.x - 4 * M, hr.y - 4 * M, hr.w + 8 * M, hr.h + 8 * M);
      }
      // granero
      const ba = a + Math.PI + rng.range(-0.9, 0.9);
      const bw = R_(rng, 12, 17), bh = R_(rng, 16, 24);
      const br = rc(f.x + Math.cos(ba) * 22 * M, f.y + Math.sin(ba) * 22 * M, bw, bh);
      if (P.okRect(br, M, 8)) {
        P.reserve(br, 2 * M);
        P.building('barn', null, br.x, br.y, br.w, br.h, faceTo(br, f.x, f.y), { roofStyle: 'metal' });
        P.area('dirtroad', Math.min(br.x + br.w / 2, f.x) - 2 * M, Math.min(br.y + br.h / 2, f.y) - 2 * M, Math.abs(br.x + br.w / 2 - f.x) + 4 * M, Math.abs(br.y + br.h / 2 - f.y) + 4 * M);
        // silo
        const sr = R_(rng, 2.5, 3.5);
        const sx = br.x + br.w + sr + M, sy = br.y + sr + M;
        if (P.rectFree({ x: sx - sr, y: sy - sr, w: sr * 2, h: sr * 2 }, 0)) P.circleProp('silo', sx, sy, sr, {}, true);
      }
      // cobertizos, tractor, pacas, corral
      for (let i = 0; i < rng.int(0, 2); i++) {
        const a2 = rng.range(0, 6.28), d = R_(rng, 14, 24);
        const r = rc(f.x + Math.cos(a2) * d, f.y + Math.sin(a2) * d, R_(rng, 3, 5), R_(rng, 3.5, 5));
        if (P.okRect(r, M, 6)) { P.reserve(r); P.building('house', 'shed', r.x, r.y, r.w, r.h, faceTo(r, f.x, f.y), { roofStyle: 'metal' }); }
      }
      if (rng.chance(0.6)) {
        const a2 = rng.range(0, 6.28);
        const x = f.x + Math.cos(a2) * 12 * M, y = f.y + Math.sin(a2) * 12 * M;
        if (P.rectFree({ x: x - 70, y: y - 70, w: 140, h: 140 }, 0)) { P.reserve({ x: x - 60, y: y - 60, w: 120, h: 120 }); P.car(x, y, rng.range(0, 6.28), { kind: 'tractor', L: 110, W: 60, color: rng.pick(['#6a2a1e', '#2e4a2a', '#7a6a2a']), trunk: false }); }
      }
      for (let i = 0; i < rng.int(2, 6); i++) {
        const x = f.x + rng.range(-20, 20) * M, y = f.y + rng.range(-20, 20) * M;
        if (P.rectFree({ x: x - 24, y: y - 24, w: 48, h: 48 }, 0)) P.circleProp('haybale', x, y, 22, {}, false);
      }
      if (rng.chance(0.5)) {
        const a2 = rng.range(0, 6.28);
        const cr = rc(f.x + Math.cos(a2) * 30 * M, f.y + Math.sin(a2) * 30 * M, R_(rng, 14, 22), R_(rng, 14, 22));
        if (P.okRect(cr, 0, 4)) { P.reserve(cr); P.area('dirtroad', cr.x, cr.y, cr.w, cr.h); fenceRect(P, cr, 'wood', [{ side: 'n', g: [cr.x + cr.w * 0.4, cr.x + cr.w * 0.6] }]); P.decal('bones', cr.x + cr.w / 2, cr.y + cr.h / 2, 1.5, 0); P.prop('trough', cr.x + cr.w / 2, cr.y + 30, {}, [{ shape: 'rect', kind: 'trough', x: cr.x + cr.w / 2 - 30, y: cr.y + 22, w: 60, h: 18, blocksSight: false }]); }
      }
      if (rng.chance(0.5)) P.circleProp('well', f.x + rng.range(-8, 8) * M, f.y + rng.range(-8, 8) * M, 22, {}, false);
      // campos
      yield;
      for (let i = 0; i < rng.int(2, 5); i++) {
        const a2 = rng.range(0, 6.28), d = R_(rng, 38, 60);
        field(P, f.x + Math.cos(a2) * d - R_(rng, 15, 30), f.y + Math.sin(a2) * d - R_(rng, 15, 30), R_(rng, 30, 70), R_(rng, 30, 70));
      }
      P.chest(f.x + rng.range(-6, 6) * M, f.y + rng.range(-6, 6) * M, 'caja', 'farmhouse');
    } else if (t === 'cabin' || t === 'shack') {
      const cw = R_(rng, 5, 7), chh = R_(rng, 6, 8);
      const r = rc(f.x, f.y, cw, chh);
      if (P.okRect(r, 0, 6)) {
        P.reserve(r, 2 * M);
        const b = P.building('house', t, r.x, r.y, r.w, r.h, faceTo(r, ax, ay), { roofStyle: rng.chance(0.5) ? 'metal' : 'gable', roofColor: rng.pick(['#4a3a2a', '#3e3a30', '#5a4a3a']) });
        WG.Settle.storyBuilding(P, b);
        P.area(t === 'shack' ? 'dirtroad' : 'dirtroad', r.x - 3 * M, r.y - 3 * M, r.w + 6 * M, r.h + 6 * M);
      }
      P.prop('woodpile', f.x + 5 * M, f.y - 3 * M, {}, [{ shape: 'rect', kind: 'woodpile', x: f.x + 5 * M - 30, y: f.y - 3 * M - 12, w: 60, h: 24, blocksSight: false }]);
      const o = rc(f.x - 7 * M, f.y + 4 * M, 1.6 * M, 1.6 * M);
      if (P.okRect(o, 0, 4)) { P.reserve(o); P.building('house', 'shed', o.x, o.y, o.w + 20, o.h + 20, faceTo(o, f.x, f.y), { roofStyle: 'metal' }); }
      if (rng.chance(0.5)) { const x = f.x + rng.range(-10, 10) * M, y = f.y + 9 * M; if (P.rectFree({ x: x - 80, y: y - 80, w: 160, h: 160 }, 0)) P.car(x, y, rng.range(0, 6.28), { kind: t === 'shack' ? 'boat' : 'car', L: t === 'shack' ? 150 : 150, W: t === 'shack' ? 56 : 66, color: rng.pick(['#4a4a3a', '#3a4a5a', '#5a3a2a']) }); }
      P.decal('firepit', f.x - 4 * M, f.y - 5 * M, 1, 0);
    } else if (t === 'ranch') {
      const r = rc(f.x, f.y, R_(rng, 10, 13), R_(rng, 9, 12));
      if (P.okRect(r, 0, 8)) {
        P.reserve(r, 2 * M);
        const b = P.building('farmhouse', null, r.x, r.y, r.w, r.h, faceTo(r, ax, ay), { roofStyle: 'flat', roofColor: '#6a5a44' });
        WG.Settle.storyBuilding(P, b);
      }
      P.circleProp('watertower', f.x + 14 * M, f.y - 10 * M, 2.4 * M, {}, true);
      for (let i = 0; i < 2; i++) {
        const cr = rc(f.x + (i ? -1 : 1) * 30 * M, f.y + rng.range(-10, 10) * M, R_(rng, 18, 28), R_(rng, 18, 28));
        if (P.okRect(cr, 0, 4)) { P.reserve(cr); fenceRect(P, cr, 'wood', [{ side: 'e', g: [cr.y + cr.h * 0.4, cr.y + cr.h * 0.6] }]); for (let k = 0; k < 4; k++) P.decal('bones', cr.x + rng.range(0, cr.w), cr.y + rng.range(0, cr.h), rng.range(1, 2), rng.range(0, 6)); }
      }
      const br = rc(f.x - 18 * M, f.y - 14 * M, R_(rng, 10, 14), R_(rng, 12, 16));
      if (P.okRect(br, 0, 6)) { P.reserve(br); P.building('barn', null, br.x, br.y, br.w, br.h, faceTo(br, f.x, f.y), { roofStyle: 'metal' }); }
      if (rng.chance(0.6)) P.car(f.x + 8 * M, f.y + 9 * M, rng.range(0, 6.28), { kind: 'pickup', L: 170, W: 66 });
    }
    P.hint(f.x, f.y);
    P.done = true;
    return P;
  }

  // ---------- hallazgos raros ----------
  function* planRare(world, r) {
    const P = new WG.Plan(world, r.key, 'rare', r.seed);
    P.danger = r.danger;
    const rng = P.rng;
    yield* WG.warmEdges(world, r.x - 80 * M, r.y - 80 * M, r.x + 80 * M, r.y + 80 * M);
    for (const rd of world.macro.roadsInRect(r.x - 80 * M, r.y - 80 * M, r.x + 80 * M, r.y + 80 * M, [])) P.addRoad(rd, false);
    P.grow(r.x - r.R, r.y - r.R, r.x + r.R, r.y + r.R);
    yield;
    const x = r.x, y = r.y;
    switch (r.type) {
      case 'bunker': {
        const b = rc(x, y, R_(rng, 10, 14), R_(rng, 10, 14));
        if (P.okRect(b, 0, 6)) {
          P.reserve(b, 3 * M);
          P.building('bunker', null, b.x, b.y, b.w, b.h, rng.pick(['n', 's', 'e', 'w']), { roofStyle: 'earth', boost: 1.6, danger: r.danger });
          for (let i = 0; i < 5; i++) { const a = rng.range(0, 6.28), d = R_(rng, 10, 16); P.tree(x + Math.cos(a) * d, y + Math.sin(a) * d, R_(rng, 3, 5)); }
          P.prop('antenna', b.x + b.w + 2 * M, b.y + 2 * M, {}, [{ shape: 'circle', kind: 'post', cx: b.x + b.w + 2 * M, cy: b.y + 2 * M, r: 6, blocksSight: false }]);
        }
        break;
      }
      case 'crash': {
        const a = rng.range(0, 6.28), L = R_(rng, 20, 28), rad = 1.6 * M;
        P.circleArea('ash', x, y, R_(rng, 18, 26));
        // fuselaje partido
        const obs = [];
        for (let t = -L / 2; t <= L / 2; t += rad * 1.4) {
          if (Math.abs(t) < rad * 0.8) continue;
          obs.push({ shape: 'circle', kind: 'wreck', cx: x + Math.cos(a) * t, cy: y + Math.sin(a) * t, r: rad, blocksSight: true });
        }
        P.prop('fuselage', x, y, { ang: a, L, rad, ext: L / 2 + 6 * M }, obs);
        const wa = a + Math.PI / 2 + rng.range(-0.3, 0.3), wx = x + Math.cos(wa) * 7 * M, wy = y + Math.sin(wa) * 7 * M;
        P.prop('wing', wx, wy, { ang: wa + rng.range(-0.4, 0.4), L: 11 * M, ext: 7 * M }, [{ shape: 'circle', kind: 'wreck', cx: wx, cy: wy, r: 1.4 * M, blocksSight: false }]);
        for (let i = 0; i < 14; i++) P.decal('debris', x + rng.range(-28, 28) * M, y + rng.range(-28, 28) * M, rng.range(0.8, 2), rng.range(0, 6));
        for (let i = 0; i < rng.int(3, 7); i++) P.decal(rng.chance(0.5) ? 'suitcase' : 'body', x + rng.range(-20, 20) * M, y + rng.range(-20, 20) * M, 1, rng.range(0, 6));
        for (let i = 0; i < rng.int(2, 4); i++) P.chest(x + rng.range(-16, 16) * M, y + rng.range(-16, 16) * M, 'maleta', 'other', 1.5);
        P.chest(x + Math.cos(a) * (L / 2 - rad), y + Math.sin(a) * (L / 2 - rad), 'cabina', 'military', 2.5);
        P.dyn.push({ kind: 'fire', x: x + Math.cos(a) * L * 0.3, y: y + Math.sin(a) * L * 0.3, small: true });
        P.hint(x, y);
        break;
      }
      case 'convoy': case 'pileup': {
        const q = r.road;
        const rd = q.road;
        const n = r.type === 'convoy' ? rng.int(3, 6) : rng.int(8, 15);
        const span = r.type === 'convoy' ? 12 * M : 6 * M;
        for (let i = 0; i < n; i++) {
          const sAl = U.clamp(q.s + (i - n / 2) * span + rng.range(-1, 1) * M, 0, rd.len);
          const p = G.roadAt(rd, sAl);
          const lane = (r.type === 'convoy' ? 0.15 : rng.range(-0.35, 0.35)) * rd.w;
          const cx = p.x - p.dy * lane, cy = p.y + p.dx * lane;
          if (!P.rectFree({ x: cx - 90, y: cy - 90, w: 180, h: 180 }, 0)) continue;
          P.reserve({ x: cx - 70, y: cy - 70, w: 140, h: 140 });
          const ang = Math.atan2(p.dy, p.dx) + (r.type === 'convoy' ? rng.range(-0.15, 0.15) : rng.range(-1.2, 1.2));
          if (r.type === 'convoy') {
            const hum = rng.chance(0.3);
            P.car(cx, cy, ang, { kind: hum ? 'humvee' : 'military', L: hum ? 160 : 230, W: hum ? 72 : 84, color: rng.pick(['#3e4632', '#4a4a36', '#38402e']), burned: rng.chance(0.35), btype: 'military', container: 'cofre militar', trunkP: 0.7, boost: 1.4 });
          } else P.car(cx, cy, ang, { burned: rng.chance(0.4), wreck: true, trunkP: 0.5 });
          if (rng.chance(0.4)) P.decal('body', cx + rng.range(-80, 80), cy + rng.range(-80, 80), 1, rng.range(0, 6));
        }
        if (r.type === 'convoy') {
          for (let i = 0; i < rng.int(2, 4); i++) {
            const px = q.x + rng.range(-12, 12) * M, py = q.y + rng.range(-12, 12) * M;
            if (P.rectFree({ x: px - 30, y: py - 20, w: 60, h: 40 }, 0) && !P.world.terrain.blocked(px, py)) { const pr = P.rectProp('milcrate', px - 19, py - 10, 38, 20, {}); const c = P.chest(px, py, 'cofre militar', 'military', 1.5); pr.chestId = c.id; }
          }
          for (let i = 0; i < 6; i++) P.decal('casings', q.x + rng.range(-10, 10) * M, q.y + rng.range(-10, 10) * M, 1, 0);
          P.decal('crater', q.x + rng.range(-6, 6) * M, q.y + rng.range(-6, 6) * M, 2, 0);
        } else {
          P.decal('crater', q.x, q.y, 1.5, 0);
          for (let i = 0; i < 6; i++) P.decal('glass', q.x + rng.range(-12, 12) * M, q.y + rng.range(-12, 12) * M, 1, 0);
        }
        P.hint(q.x, q.y);
        break;
      }
      case 'hideout': {
        const b = rc(x, y, R_(rng, 5, 7), R_(rng, 6, 8));
        if (P.okRect(b, 0, 6)) {
          P.reserve(b, 3 * M);
          const hb = P.building('house', 'hideout', b.x, b.y, b.w, b.h, rng.pick(['n', 's', 'e', 'w']), { roofStyle: 'metal', boost: 1.4, barricaded: rng.chance(0.4) });
          hb.sign = rng.pick(['VIVO AQUÍ', 'NO DISPARES', 'VETE', 'NO HAY NADA']);
          // trampas y barricada exterior
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2 + rng.range(-0.2, 0.2), d = Math.max(b.w, b.h) * 0.75 + 2 * M;
            if (rng.chance(0.6)) { const sx = x + Math.cos(a) * d, sy = y + Math.sin(a) * d; P.rectProp('barricade', sx - 30, sy - 8, 60, 16, {}); }
          }
          P.decal('firepit', x + 5 * M, y + 5 * M, 1, 0);
          P.decal('cans', x + 4 * M, y + 6 * M, 1, 0);
          P.decal('text', x, b.y - 2.5 * M, 1, 0, { text: rng.pick(['NO CONFÍES EN NADIE', 'ESPERÉ 40 DÍAS', 'SE OYEN POR LA NOCHE', 'LA RADIO MIENTE']), color: 'rgba(210,200,180,0.65)', size: 12 });
          if (rng.chance(0.5)) P.decal('body', x - 5 * M, y + 4 * M, 1, rng.range(0, 6));
          P.chest(x + 4 * M, y - 4 * M, 'alijo enterrado', 'other', 1.8, { trapped: rng.chance(0.4) });
        }
        break;
      }
      case 'lab': {
        const b = rc(x, y, R_(rng, 16, 22), R_(rng, 14, 18));
        if (P.okRect(b, 0, 6)) {
          P.reserve(b, 3 * M);
          P.building('other', 'lab', b.x, b.y, b.w, b.h, rng.pick(['n', 's', 'e', 'w']), { roofStyle: 'flat', boost: 2.2, danger: r.danger, sign: 'PELIGRO BIOLÓGICO' });
          const lot = { x: b.x - 8 * M, y: b.y - 8 * M, w: b.w + 16 * M, h: b.h + 16 * M };
          P.area('concrete', lot.x, lot.y, lot.w, lot.h);
          fenceRect(P, lot, 'chain', [{ side: 's', g: [lot.x + lot.w * 0.45, lot.x + lot.w * 0.55] }]);
          for (let i = 0; i < 5; i++) P.circleProp('barrel', lot.x + rng.range(1, 4) * M, lot.y + rng.range(2, lot.h / M - 2) * M, 14, { toxic: true });
          P.car(lot.x + lot.w - 4 * M, lot.y + lot.h - 3 * M, 0, { kind: 'van', L: 170, W: 70, color: '#d0d0c8', burned: rng.chance(0.4) });
          for (let i = 0; i < 4; i++) P.decal('bodybag', lot.x + rng.range(0, lot.w), lot.y + lot.h - rng.range(0, 3) * M, 1, rng.range(0, 6));
        }
        break;
      }
      default: { // laststand
        WG.Settle.lastStand(P, x, y, R_(rng, 6, 9), rng.chance(0.5) ? 'military' : 'other');
        for (let i = 0; i < rng.int(1, 3); i++) P.rectProp('tent', x + rng.range(-14, 10) * M, y + rng.range(-14, 10) * M, 96, 72, { color: rng.pick(['#3c4432', '#4a3c2c', '#3e4632']) }, true);
        P.decal('firepit', x + 2 * M, y - M, 1, 0);
        P.circleArea('camp', x, y, 14 * M);
      }
    }
    P.done = true;
    return P;
  }

  // ---------- lugares especiales ----------
  function* planSpecial(world, s) {
    const P = new WG.Plan(world, s.key, 'special', s.seed);
    P.site = s; P.danger = s.danger;
    const rng = P.rng;
    const R = s.R;
    yield* WG.warmEdges(world, s.x - R * 1.3, s.y - R * 1.3, s.x + R * 1.3, s.y + R * 1.3);
    P.extRoads = world.macro.roadsInRect(s.x - R * 1.3, s.y - R * 1.3, s.x + R * 1.3, s.y + R * 1.3, []);
    for (const r of P.extRoads) P.addRoad(r, false);
    P.grow(s.x - R, s.y - R, s.x + R, s.y + R);
    yield* P.dryScan();
    const half = R * 0.8;
    const base = { x: Math.round(s.x - half), y: Math.round(s.y - half), w: Math.round(half * 2), h: Math.round(half * 2) };
    yield;
    // cuadrícula de parcelas dentro del recinto
    const place = (w, h, fn, tries) => {
      for (let i = 0; i < (tries || 30); i++) {
        const r = { x: Math.round(base.x + 4 * M + rng.range(0, base.w - w - 8 * M)), y: Math.round(base.y + 4 * M + rng.range(0, base.h - h - 8 * M)), w: Math.round(w), h: Math.round(h) };
        if (P.okRect(r, 3 * M, 3 * M)) { P.reserve(r, M); fn(r); return r; }
      }
      return null;
    };
    const sub = s.sub;
    if (sub === 'military' || sub === 'prison') {
      fenceRect(P, base, sub === 'prison' ? 'concrete' : 'chain');
      P.area(sub === 'prison' ? 'gravel' : 'gravel', base.x, base.y, base.w, base.h);
      // torres en las esquinas
      for (const [cx, cy] of [[base.x, base.y], [base.x + base.w, base.y], [base.x, base.y + base.h], [base.x + base.w, base.y + base.h]]) {
        P.rectProp('watchtower', cx - 48, cy - 48, 96, 96, {}, true);
      }
    }
    if (sub === 'military') {
      // el recinto se divide en zonas (3x3) con funciones distintas
      const zones = [];
      const nz = 3, zw = base.w / nz, zh = base.h / nz;
      for (let j = 0; j < nz; j++) for (let i = 0; i < nz; i++) zones.push({ x: Math.round(base.x + i * zw + 2 * M), y: Math.round(base.y + j * zh + 2 * M), w: Math.round(zw - 4 * M), h: Math.round(zh - 4 * M) });
      zones.sort(() => rng.next() - 0.5);
      const kinds = ['barracks', 'hq', 'tents', 'motor', 'barracks', 'heli', 'containers', 'range', 'tents'];
      let k = 0;
      const vehicle = (x, y, a) => P.car(x, y, a, { kind: rng.chance(0.3) ? 'humvee' : 'military', L: rng.chance(0.3) ? 160 : 230, W: 84, color: rng.pick(['#3e4632', '#4a4a36']), btype: 'military', container: 'cofre militar', burned: rng.chance(0.2), trunkP: 0.6 });
      const usable = (z) => P.roadGap(z.x, z.y, z.w, z.h) >= M && P.terrainOk(z) && P.rectFree(z, 0);
      const todo = [];
      for (const z of zones) {
        if (usable(z)) { todo.push({ z, kind: kinds[k++ % kinds.length] }); continue; }
        // zona cruzada por la carretera: se aprovechan sus cuartos libres y se pone un control
        const hw = z.w / 2 - M, hh = z.h / 2 - M;
        for (const [qx, qy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
          const q = { x: Math.round(z.x + qx * (hw + 2 * M)), y: Math.round(z.y + qy * (hh + 2 * M)), w: Math.round(hw), h: Math.round(hh) };
          if (usable(q)) todo.push({ z: q, kind: rng.pick(['tents', 'containers', 'motor', 'sandbags']) });
        }
        if (rng.chance(0.5)) { const q = P.nearestRoadPoint(z.x + z.w / 2, z.y + z.h / 2, 40 * M); if (q) WG.Settle.lastStand(P, q.x, q.y, R_(rng, 5, 7), 'military'); }
      }
      for (const { z, kind } of todo) {
        if (!P.rectFree(z, 0)) continue;
        P.reserve(z);
        const cx = z.x + z.w / 2, cy = z.y + z.h / 2;
        if (kind === 'barracks') {
          const bw = R_(rng, 10, 12), bh = Math.min(z.h - 3 * M, R_(rng, 22, 28));
          const n = Math.max(1, Math.floor(z.w / (bw + 3 * M)));
          for (let i = 0; i < n; i++) {
            const x = z.x + (z.w - n * (bw + 3 * M)) / 2 + i * (bw + 3 * M) + 1.5 * M;
            P.building('military', 'barracks', x, cy - bh / 2, bw, bh, i % 2 ? 'e' : 'w', { roofStyle: 'metal', roofColor: rng.pick(['#4a5040', '#525a48']), boost: 1.3 });
          }
        } else if (kind === 'hq') {
          const w = Math.min(z.w - 4 * M, R_(rng, 18, 24)), h = Math.min(z.h - 14 * M, R_(rng, 16, 22));
          P.building('military', null, cx - w / 2, z.y + 2 * M, w, h, 's', { roofStyle: 'flat', roofColor: '#4a4e48', boost: 1.5 });
          const bw = R_(rng, 9, 11);
          if (z.h - h - 6 * M > bw) P.building('bunker', null, cx - bw / 2, z.y + h + 4 * M, bw, Math.min(bw, z.h - h - 6 * M), 'n', { roofStyle: 'earth', boost: 1.8 });
          P.prop('flag', cx + w / 2 + 2 * M, z.y + h + 2 * M, {}, [{ shape: 'circle', kind: 'post', cx: cx + w / 2 + 2 * M, cy: z.y + h + 2 * M, r: 5, blocksSight: false }]);
        } else if (kind === 'tents') {
          for (let y = z.y + M; y + 90 < z.y + z.h; y += 90 + 2.2 * M) for (let x = z.x + M; x + 110 < z.x + z.w; x += 110 + 2 * M) {
            if (rng.chance(0.78)) P.rectProp('tent', x, y, 110, 90, { color: rng.pick(['#3e4632', '#46503a', '#3a4030']), cross: rng.chance(0.15) }, true);
            else if (rng.chance(0.5)) { const pr = P.rectProp('milcrate', x + 30, y + 30, 38, 20, {}); const c = P.chest(x + 49, y + 40, 'cofre militar', 'military', 1.2); pr.chestId = c.id; }
          }
          P.decal('firepit', cx, cy, 1, 0);
        } else if (kind === 'motor') {
          P.area('concrete', z.x, z.y, z.w, z.h);
          for (let x = z.x + 2 * M; x + 3 * M < z.x + z.w; x += 4.2 * M) {
            if (rng.chance(0.75)) vehicle(x + 1.3 * M, z.y + z.h * 0.3, Math.PI / 2);
            if (rng.chance(0.6)) vehicle(x + 1.3 * M, z.y + z.h * 0.72, -Math.PI / 2);
          }
          P.decal('stain', cx, cy, 3, 0);
        } else if (kind === 'heli') {
          P.area('concrete', z.x, z.y, z.w, z.h);
          P.decal('helipad', cx, cy, 1, 0);
          if (rng.chance(0.6)) P.prop('helicopter', cx, cy, { ang: rng.range(0, 6.28), ext: 300, crashed: rng.chance(0.5) }, [{ shape: 'circle', kind: 'heli', cx, cy, r: 60, blocksSight: false }]);
          if (rng.chance(0.4)) P.dyn.push({ kind: 'fire', x: cx + 40, y: cy - 30, small: true });
        } else if (kind === 'containers') {
          P.area('gravel', z.x, z.y, z.w, z.h);
          for (let y = z.y + M; y + 78 < z.y + z.h; y += 78 + 2.5 * M) for (let x = z.x + M; x + 192 < z.x + z.w; x += 192 + 2 * M) {
            if (!rng.chance(0.75)) continue;
            const p = P.rectProp('container', x, y, 192, 78, { color: rng.pick(['#4a5236', '#5a5a3a', '#3e4632']), vert: false, open: rng.chance(0.3) }, true);
            if (rng.chance(0.6)) { const c = P.chest(x + 96, y + 39, 'cofre militar', 'military', 1.3); p.chestId = c.id; }
          }
        } else if (kind === 'sandbags') {
          // nido de ametralladora con cajas
          WG.Settle.lastStand(P, cx, cy, Math.min(z.w, z.h) * 0.3, 'military');
        } else {
          // campo de tiro: trincheras de sacos y dianas
          P.area('dirtroad', z.x, z.y, z.w, z.h);
          for (let x = z.x + 2 * M; x + 52 < z.x + z.w - 2 * M; x += 70) P.rectProp('sandbag', x, z.y + z.h - 3 * M, 52, 24, { horiz: true });
          for (let i = 0; i < 5; i++) P.prop('target', z.x + z.w * (i + 0.5) / 5, z.y + 3 * M, {}, [{ shape: 'rect', kind: 'post', x: z.x + z.w * (i + 0.5) / 5 - 14, y: z.y + 3 * M - 3, w: 28, h: 6, blocksSight: false }]);
          for (let i = 0; i < 6; i++) P.decal('casings', z.x + rng.range(0, z.w), z.y + z.h - rng.range(2, 6) * M, 1, 0);
        }
        yield;
      }
      for (let i = 0; i < rng.int(3, 9); i++) P.decal('body', base.x + rng.range(0, base.w), base.y + rng.range(0, base.h), 1, rng.range(0, 6));
      P.decal('text', base.x + base.w / 2, base.y - 3 * M, 1, 0, { text: 'ZONA MILITAR · PROHIBIDO EL PASO', color: 'rgba(210,190,90,0.7)', size: 16 });
    } else if (sub === 'prison') {
      for (let i = 0; i < 2; i++) place(R_(rng, 18, 22), R_(rng, 36, 46), (r) => P.building('police', 'prison', r.x, r.y, r.w, r.h, faceTo(r, s.x, s.y), { roofStyle: 'flat', roofColor: '#4a4a46' }));
      yield;
      place(R_(rng, 18, 22), R_(rng, 18, 22), (r) => P.building('police', null, r.x, r.y, r.w, r.h, faceTo(r, s.x, s.y), { roofStyle: 'flat', boost: 1.4 }));
      place(R_(rng, 28, 36), R_(rng, 22, 30), (r) => { P.area('court', r.x, r.y, r.w, r.h); WG.Settle.lotFence(P, Object.assign({ front: 's' }, r), 'chain', 0.5, 0.1); });
      place(R_(rng, 12, 16), R_(rng, 10, 12), (r) => P.building('other', 'office', r.x, r.y, r.w, r.h, faceTo(r, s.x, s.y), {}));
      if (rng.chance(0.6)) P.car(s.x + rng.range(-10, 10) * M, s.y + rng.range(-10, 10) * M, rng.range(0, 6.28), { kind: 'bus', L: 360, W: 82, color: '#4a4f52' });
      for (let i = 0; i < rng.int(4, 10); i++) P.decal('body', base.x + rng.range(0, base.w), base.y + rng.range(0, base.h), 1, rng.range(0, 6));
    } else if (sub === 'airfield') {
      const horiz = rng.chance(0.5);
      const rl = Math.min(base.w, base.h) * 1.15, rw = 22 * M;
      const run = horiz ? rc(s.x, s.y - half * 0.35, rl, rw) : rc(s.x - half * 0.35, s.y, rw, rl);
      if (P.okRect(run, 0, 0) || true) {
        P.area('runway', run.x, run.y, run.w, run.h, { horiz });
        P.reserve(run);
      }
      P.area('concrete', horiz ? s.x - half * 0.6 : s.x + half * 0.05, horiz ? s.y + half * 0.05 : s.y - half * 0.6, horiz ? half * 1.2 : half * 0.6, horiz ? half * 0.6 : half * 1.2);
      yield;
      for (let i = 0; i < rng.int(1, 2); i++) place(R_(rng, 28, 34), R_(rng, 30, 38), (r) => P.building('warehouse', 'hangar', r.x, r.y, r.w, r.h, faceTo(r, run.x + run.w / 2, run.y + run.h / 2), { roofStyle: 'metal' }));
      place(7 * M, 7 * M, (r) => P.building('other', 'tower', r.x, r.y, r.w, r.h, faceTo(r, s.x, s.y), { roofStyle: 'flat', roofColor: '#3a4a52', tower: true }));
      for (let i = 0; i < rng.int(2, 5); i++) place(12 * M, 10 * M, (r) => {
        const a = rng.range(0, 6.28);
        P.prop('smallplane', r.x + r.w / 2, r.y + r.h / 2, { ang: a, ext: 7 * M, crashed: rng.chance(0.3) }, [{ shape: 'circle', kind: 'plane', cx: r.x + r.w / 2, cy: r.y + r.h / 2, r: 1.3 * M, blocksSight: false }]);
        P.chest(r.x + r.w / 2 + Math.cos(a) * M, r.y + r.h / 2 + Math.sin(a) * M, 'cabina', 'other', 1.3);
      }, 10);
      for (let i = 0; i < 2; i++) place(6 * M, 6 * M, (r) => P.circleProp('fueltank', r.x + r.w / 2, r.y + r.h / 2, 2.8 * M, { explosive: true }, true));
      fenceRect(P, base, 'chain');
    } else {
      // polígono industrial
      P.area('concrete', base.x, base.y, base.w, base.h);
      for (let i = 0; i < rng.int(3, 6); i++) {
        const big = rng.chance(0.4);
        place(big ? R_(rng, 44, 56) : R_(rng, 26, 38), big ? R_(rng, 50, 66) : R_(rng, 30, 44), (r) => P.building(big ? 'factory' : 'warehouse', null, r.x, r.y, r.w, r.h, faceTo(r, s.x, s.y), {}));
        yield;
      }
      for (let i = 0; i < rng.int(4, 9); i++) place(192, 78, (r) => { const p = P.rectProp('container', r.x, r.y, r.w, r.h, { color: rng.pick(['#6a3a2a', '#2a4a5a', '#5a5a3a']), vert: false }, true); if (rng.chance(0.4)) { const c = P.chest(r.x + 96, r.y + 39, 'contenedor', 'warehouse'); p.chestId = c.id; } }, 6);
      for (let i = 0; i < rng.int(2, 4); i++) P.car(s.x + rng.range(-0.6, 0.6) * half, s.y + rng.range(-0.6, 0.6) * half, rng.range(0, 6.28), { kind: 'truck', L: 260, W: 80 });
      fenceRect(P, base, 'chain');
    }
    P.hint(s.x, s.y);
    P.done = true;
    return P;
  }

  // ---------- tramos de carretera ----------
  function* planEdge(world, e) {
    const P = new WG.Plan(world, e.key, 'edge', e.seed);
    const rng = P.rng;
    for (const r of e.roads) P.addRoad(r);
    yield* P.dryScan();
    P.danger = (e.A.dB + e.B.dB) / 2;
    const full = e.full;
    // lejos de asentamientos, granjas y hallazgos
    const free = (x, y, rad) => {
      for (const S of [e.A, e.B]) if (S.type !== 'none' && Math.hypot(x - S.x, y - S.y) < S.R * 1.1 + rad + 20 * M) return false;
      const F = world.macro.FARM;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const f = world.macro.farm(Math.floor(x / F) + di, Math.floor(y / F) + dj);
        if (f && Math.hypot(f.x - x, f.y - y) < f.R * 2 + rad) return false;
      }
      const RR = world.macro.RARE;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const q = world.macro.rare(Math.floor(x / RR) + di, Math.floor(y / RR) + dj);
        if (q && Math.hypot(q.x - x, q.y - y) < q.R * 1.5 + rad) return false;
      }
      return Math.hypot(x, y) > TM.Config.SAFE_RADIUS + rad + 30 * M;
    };
    yield;
    // gasolinera de carretera
    if (e.kind !== 'dirt' && rng.chance(0.32)) {
      for (let t = 0; t < 6; t++) {
        const sAl = full.len * rng.range(0.3, 0.7);
        const p = G.roadAt(full, sAl);
        if (!free(p.x, p.y, 40 * M)) continue;
        const side = rng.chance(0.5) ? 1 : -1;
        const fw = R_(rng, 34, 42), dp = R_(rng, 30, 36);
        const nx = -p.dy * side, ny = p.dx * side;
        const ax = Math.abs(nx) >= Math.abs(ny);
        const off = full.w / 2 + 2 * M + (fw / 2) * (Math.min(Math.abs(nx), Math.abs(ny)) / Math.max(Math.abs(nx), Math.abs(ny)));
        let lot;
        if (ax) lot = { x: Math.round(nx > 0 ? p.x + nx * off : p.x + nx * off - dp), y: Math.round(p.y + ny * off - fw / 2), w: Math.round(dp), h: Math.round(fw), front: nx > 0 ? 'w' : 'e' };
        else lot = { x: Math.round(p.x + nx * off - fw / 2), y: Math.round(ny > 0 ? p.y + ny * off : p.y + ny * off - dp), w: Math.round(fw), h: Math.round(dp), front: ny > 0 ? 'n' : 's' };
        if (!P.okRect(lot, 0, 4)) continue;
        P.reserve(lot);
        WG.Settle.BUILD.gas(P, lot);
        if (rng.chance(0.4)) {
          // motel / bar de carretera al lado
          const lot2 = Object.assign({}, lot);
          if (lot.front === 'n' || lot.front === 's') lot2.x = lot.x + (rng.chance(0.5) ? lot.w + 2 * M : -lot.w - 2 * M);
          else lot2.y = lot.y + (rng.chance(0.5) ? lot.h + 2 * M : -lot.h - 2 * M);
          if (P.okRect(lot2, 0, 4)) { P.reserve(lot2); WG.Settle.BUILD.bar(P, lot2); }
        }
        break;
      }
      yield;
    }
    // autos sueltos en el arcén y basura
    for (let sAl = R_(rng, 20, 80); sAl < full.len; sAl += R_(rng, 60, 160)) {
      if (WG.over()) yield;
      const p = G.roadAt(full, sAl);
      if (!free(p.x, p.y, 4 * M)) continue;
      const k = rng.next();
      const side = rng.chance(0.5) ? 1 : -1;
      if (k < 0.4) {
        const off = full.w * 0.45 + rng.range(0, 1.5) * M;
        P.car(p.x - p.dy * off * side, p.y + p.dx * off * side, Math.atan2(p.dy, p.dx) + rng.range(-0.5, 0.5) + (rng.chance(0.5) ? Math.PI : 0), { burned: rng.chance(0.3), wreck: rng.chance(0.4) });
      } else if (k < 0.55) P.decal('body', p.x + rng.range(-3, 3) * M, p.y + rng.range(-3, 3) * M, 1, rng.range(0, 6));
      else if (k < 0.7) P.decal('roadsign', p.x - p.dy * (full.w / 2 + 1.5 * M) * side, p.y + p.dx * (full.w / 2 + 1.5 * M) * side, 1, Math.atan2(p.dy, p.dx), { text: rng.pick(['EVACUACIÓN →', 'ZONA SEGURA 20 KM', 'CERRADO', 'NO SE DETENGA', '← REFUGIO']) });
      else if (k < 0.85) P.decal('bloodtrail', p.x, p.y, 1, rng.range(0, 6));
      else P.decal('tiretrack', p.x, p.y, 1.5, Math.atan2(p.dy, p.dx));
    }
    yield;
    // atasco de huida
    if (rng.chance(0.18)) {
      const sAl0 = full.len * rng.range(0.25, 0.6);
      const p0 = G.roadAt(full, sAl0);
      if (free(p0.x, p0.y, 60 * M)) {
        const dir = rng.chance(0.5) ? 1 : -1;
        const n = rng.int(8, 20);
        for (let i = 0; i < n; i++) {
          if (WG.over()) yield;
          const sAl = sAl0 + i * R_(rng, 6, 8.5);
          if (sAl > full.len) break;
          const p = G.roadAt(full, sAl);
          for (const lane of [0.24, -0.24]) {
            if (!rng.chance(0.75)) continue;
            const x = p.x - p.dy * lane * full.w, y = p.y + p.dx * lane * full.w;
            if (!P.rectFree({ x: x - 60, y: y - 60, w: 120, h: 120 }, 0)) continue;
            P.reserve({ x: x - 50, y: y - 50, w: 100, h: 100 });
            P.car(x, y, Math.atan2(p.dy, p.dx) + (dir > 0 ? 0 : Math.PI) + rng.range(-0.2, 0.2), { burned: rng.chance(0.12), trunkP: 0.75 });
            if (rng.chance(0.25)) P.decal('suitcase', x + rng.range(-70, 70), y + rng.range(-70, 70), 1, rng.range(0, 6));
          }
        }
        P.hint(p0.x, p0.y);
      }
    }
    // puente caído: la carretera se corta en el agua; restos y aviso en las orillas
    for (const r of e.roads) {
      if (!r.collapsed) continue;
      let prev = 0, lastLand = null;
      for (let sAl = 0; sAl < r.len; sAl += 3 * M) {
        const p = G.roadAt(r, sAl);
        const k = world.terrain.kindAt(p.x, p.y);
        const wet = k === 1 || k === 2 || k === 3 ? 1 : 0;
        if (wet !== prev && sAl > 0) {
          const land = wet ? lastLand : p; // punto en tierra junto a la orilla
          if (land) {
            for (let i = 0; i < 4; i++) P.decal('rubble', land.x + rng.range(-1, 1) * r.w * 0.5, land.y + rng.range(-1, 1) * r.w * 0.5, rng.range(1.2, 2.2), 0);
            const back = wet ? -1 : 1;
            const bx = land.x + land.dx * back * 6 * M, by = land.y + land.dy * back * 6 * M;
            const nx = -land.dy, ny = land.dx;
            P.prop('barrier', bx, by, { w: r.w * 0.8, h: 12, ang: Math.atan2(ny, nx), rotated: true }, []);
            P.decal('text', bx + land.dx * back * 2 * M, by + land.dy * back * 2 * M, 1, Math.atan2(land.dy, land.dx) + Math.PI / 2, { text: 'PUENTE CAÍDO', color: 'rgba(220,200,90,0.75)', size: 15 });
          }
        }
        if (!wet) lastLand = p;
        prev = wet;
      }
      yield;
    }
    // control de carretera
    if (rng.chance(0.07)) {
      const sAl = full.len * rng.range(0.3, 0.7);
      const p = G.roadAt(full, sAl);
      if (free(p.x, p.y, 20 * M)) WG.Settle.checkpoint(P, full, sAl);
    }
    P.done = true;
    return P;
  }

  // ---------- campamento inicial ----------
  function* planCamp(world) {
    const P = new WG.Plan(world, 'camp', 'camp', 4242);
    const rng = P.rng;
    P.circleArea('camp', 0, 0, 430);
    P.circleProp('firepit', 0, 0, 20, {}, false);
    P.dyn.push({ kind: 'fire', x: 0, y: 0 });
    P.rectProp('tent', -190, -150, 96, 76, { color: '#3c4432' }, true);
    P.rectProp('tent', 110, -170, 88, 70, { color: '#4a3c2c' }, true);
    P.rectProp('crate', 150, 110, 28, 28, {});
    const cr = P.rectProp('crate', 184, 118, 24, 24, {});
    const c = P.chest(196, 130, 'caja', 'other', 1, { rarity: 'common', trapped: false, noisy: false });
    cr.chestId = c.id;
    P.car(-175, 165, -0.35, { color: '#3a4250', burned: false, trunkP: 1, trunk: true });
    P.decal('logseat', -40, 52, 1, 1.4);
    P.decal('logseat', 58, 26, 1, 0.2);
    P.decal('logseat', -50, -40, 1, 2.6);
    P.prop('clothesline', -40, -230, { ang: 0.1 }, []);
    P.circleProp('barrel', 230, -40, 14, { water: true });
    // anillo de sacos de arena con entradas
    const ring = 340;
    for (let i = 0; i < 24; i++) {
      if (i % 6 === 0) continue;
      const a = (i / 24) * Math.PI * 2;
      const x = Math.cos(a) * ring, y = Math.sin(a) * ring;
      const horiz = Math.abs(Math.sin(a)) > 0.7;
      P.rectProp('sandbag', x - (horiz ? 28 : 13), y - (horiz ? 13 : 28), horiz ? 56 : 26, horiz ? 26 : 56, { horiz });
    }
    yield;
    // sendero hasta la carretera más cercana
    const nr = world.macro.nearestRoad(0, 0, 320 * M);
    if (nr) {
      const a = Math.atan2(nr.y, nr.x);
      // sale por la entrada del anillo más cercana a esa dirección
      const ga = Math.round(a / (Math.PI / 2)) * (Math.PI / 2);
      const sx = Math.cos(ga) * (ring + 40), sy = Math.sin(ga) * (ring + 40);
      const pts = G.catmull([sx, sy, sx + Math.cos(ga) * 300 + (nr.x - sx) * 0.3, sy + Math.sin(ga) * 300 + (nr.y - sy) * 0.3, nr.x, nr.y], 8);
      let ok = true;
      for (let i = 0; i < pts.length; i += 2) if (world.terrain.blocked(pts[i], pts[i + 1])) ok = false;
      if (ok) P.addRoad(G.makeRoad(pts, 110, 'dirt', { local: true, path: true }));
    }
    P.grow(-600, -600, 600, 600);
    P.done = true;
    return P;
  }

  WG.Places = { planFarm, planRare, planSpecial, planEdge, planCamp, fenceRect, dirtPath };
})();
