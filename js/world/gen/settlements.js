// Asentamientos: aldeas, pueblos, ciudades y grandes ciudades con calles, barrios, lotes y lugares especiales. TM.WG.Settle
(function () {
  const U = TM.U;
  const WG = TM.WG = TM.WG || {};
  const G = WG.G;
  const M = 32;
  const ss = U.smoothstep;

  // Tamaños de lote en metros: [frente min, frente max, fondo min, fondo max]
  const LOT = {
    house_s: [12, 16, 20, 26], house_m: [16, 22, 26, 32], house_v: [16, 26, 24, 36], apartments: [22, 32, 26, 40], office: [20, 30, 24, 36],
    store: [12, 18, 18, 24], bar: [12, 18, 18, 24], pharmacy: [16, 22, 22, 28], hardware: [24, 32, 30, 38], garage: [18, 24, 22, 28],
    supermarket: [46, 56, 56, 66], gas: [34, 42, 30, 36], warehouse: [38, 52, 44, 60], factory: [58, 76, 66, 90], police: [30, 36, 32, 38],
    school: [50, 60, 50, 62], hospital: [66, 80, 76, 96], clinic: [36, 44, 40, 48], church: [26, 32, 40, 48], cemetery: [40, 64, 40, 60],
    park: [34, 64, 34, 56], sports: [58, 66, 84, 96], parking: [26, 36, 26, 36], empty: [14, 24, 18, 28], containers: [30, 44, 30, 44],
    farmlot: [34, 48, 36, 50], junk: [26, 36, 26, 36], chapel: [16, 22, 24, 30],
  };

  // ---------- utilidades de lote ----------
  // Rectángulo de lote junto a la carretera en el punto p con normal n (lado elegido)
  function makeLot(P, road, p, nx, ny, fw, dp, sb) {
    const ax = Math.abs(nx) >= Math.abs(ny);
    // en carreteras diagonales el lote (alineado a los ejes) se aleja más para no pisar la calzada
    const slope = Math.min(Math.abs(nx), Math.abs(ny)) / Math.max(Math.abs(nx), Math.abs(ny), 1e-6);
    const off = road.w / 2 + (road.side || 0) + sb + (fw / 2) * slope;
    let x, y, w, h, front;
    if (ax) {
      w = dp; h = fw;
      const sx = Math.sign(nx);
      const ex = p.x + nx * off;
      x = sx > 0 ? ex : ex - w;
      y = p.y + ny * off - h / 2;
      front = sx > 0 ? 'w' : 'e';
    } else {
      w = fw; h = dp;
      const sy = Math.sign(ny);
      const ey = p.y + ny * off;
      y = sy > 0 ? ey : ey - h;
      x = p.x + nx * off - w / 2;
      front = sy > 0 ? 'n' : 's';
    }
    return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h), front };
  }
  // Coloca un rectángulo (ancho bw a lo largo del frente, fondo bd) dentro del lote
  function inLot(lot, bw, bd, sb, off) {
    const f = lot.front;
    if (f === 's' || f === 'n') {
      const x = lot.x + (lot.w - bw) * off;
      const y = f === 's' ? lot.y + lot.h - sb - bd : lot.y + sb;
      return { x: Math.round(x), y: Math.round(y), w: Math.round(bw), h: Math.round(bd) };
    }
    const y = lot.y + (lot.h - bw) * off;
    const x = f === 'e' ? lot.x + lot.w - sb - bd : lot.x + sb;
    return { x: Math.round(x), y: Math.round(y), w: Math.round(bd), h: Math.round(bw) };
  }
  // Punto en el borde frontal del lote (t a lo largo del frente)
  function frontPt(lot, t, out) {
    const f = lot.front;
    if (f === 's') return { x: lot.x + lot.w * t, y: lot.y + lot.h + (out || 0) };
    if (f === 'n') return { x: lot.x + lot.w * t, y: lot.y - (out || 0) };
    if (f === 'e') return { x: lot.x + lot.w + (out || 0), y: lot.y + lot.h * t };
    return { x: lot.x - (out || 0), y: lot.y + lot.h * t };
  }
  const R_ = (rng, a, b) => rng.range(a, b) * M;

  // Valla alrededor de un lote con hueco de entrada en el frente
  function lotFence(P, lot, style, gapT, gapW) {
    const g0 = gapT - gapW / 2, g1 = gapT + gapW / 2;
    const { x, y, w, h } = lot, f = lot.front;
    P.fence(x, y, x + w, y, style, f === 'n' ? [[x + w * g0, x + w * g1]] : null);
    P.fence(x, y + h, x + w, y + h, style, f === 's' ? [[x + w * g0, x + w * g1]] : null);
    P.fence(x, y, x, y + h, style, f === 'w' ? [[y + h * g0, y + h * g1]] : null);
    P.fence(x + w, y, x + w, y + h, style, f === 'e' ? [[y + h * g0, y + h * g1]] : null);
  }

  // Camino de 1,2 m desde el borde frontal del lote (punto fp) hasta la fachada del edificio r
  function walkway(P, lot, r, fp, mat, wd) {
    const W = wd || 40, f = lot.front;
    if (f === 's') P.area(mat || 'concrete', fp.x - W / 2, r.y + r.h, W, lot.y + lot.h - (r.y + r.h));
    else if (f === 'n') P.area(mat || 'concrete', fp.x - W / 2, lot.y, W, r.y - lot.y);
    else if (f === 'e') P.area(mat || 'concrete', r.x + r.w, fp.y - W / 2, lot.x + lot.w - (r.x + r.w), W);
    else P.area(mat || 'concrete', lot.x, fp.y - W / 2, r.x - lot.x, W);
  }

  // Historias en un edificio: carteles, barricadas, sangre
  function storyBuilding(P, b) {
    const rng = P.rng;
    const r = rng.next();
    if (r < 0.04) { b.sign = 'INFECTADOS DENTRO'; b.infected = true; }
    else if (r < 0.07) { b.sign = 'NO ENTRAR'; b.barricaded = true; }
    else if (r < 0.085) { b.sign = 'VACÍO'; }
    if (rng.chance(0.035)) b.roofText = rng.pick(['AYUDA', 'SOS', 'AYUDA', 'VIVOS']);
    if (rng.chance(0.12)) b.bloody = true;
    if (b.infected) P.hint(b.x + b.w / 2, b.y + b.h / 2, { indoor: true, buildingType: b.type, infected: true, buildingId: b.id });
  }

  // ---------- constructores de lotes ----------
  const BUILD = {};
  BUILD.house = function (P, lot, opt) {
    const rng = P.rng;
    const medium = opt.size === 'm' || (opt.size === 'v' && rng.chance(0.5));
    const fw = lot.front === 's' || lot.front === 'n' ? lot.w : lot.h;
    const dp = lot.front === 's' || lot.front === 'n' ? lot.h : lot.w;
    let bw = medium ? R_(rng, 10, 12.5) : R_(rng, 7, 9), bd = medium ? R_(rng, 11, 14.5) : R_(rng, 8, 10.5);
    const garage = medium && rng.chance(0.4) && fw > bw + 6 * M;
    if (garage) bw += 4 * M;
    bw = Math.min(bw, fw - 2 * M); bd = Math.min(bd, dp - 5 * M);
    if (bw < 6 * M || bd < 7 * M) return false;
    const sb = Math.min(R_(rng, 2.5, 6), dp - bd - 2 * M);
    const off = rng.range(0.15, 0.85);
    const r = inLot(lot, bw, bd, sb, off);
    const b = P.building(opt.farm ? 'farmhouse' : 'house', null, r.x, r.y, r.w, r.h, lot.front, { garage });
    storyBuilding(P, b);
    if (opt.yard !== false && rng.chance(0.65)) P.area('lawn', lot.x, lot.y, lot.w, lot.h);
    // camino de entrada desde la calle hasta la fachada
    const tDoor = (off * (fw - bw) + bw * 0.5) / fw;
    const fp = frontPt(lot, U.clamp(tDoor, 0.1, 0.9));
    walkway(P, lot, r, fp);
    if (rng.chance(0.45)) {
      // auto en la entrada
      const t2 = U.clamp(off < 0.5 ? (off * (fw - bw) + bw + 2.5 * M) / fw : (off * (fw - bw) - 2.5 * M) / fw, 0.08, 0.92);
      const cp = frontPt(lot, t2, -2.6 * M);
      const vert = lot.front === 's' || lot.front === 'n';
      if (sb > 5.2 * M) P.car(cp.x, cp.y, vert ? Math.PI / 2 : 0, { burned: rng.chance(0.1) });
    }
    if (rng.chance(opt.fenceP === undefined ? 0.45 : opt.fenceP)) lotFence(P, lot, rng.pick(['wood', 'picket', 'chain', 'wood']), U.clamp(tDoor, 0.15, 0.85), 0.16);
    // patio trasero: árboles, cobertizo
    const backD = Math.max(0, dp - sb - bd - 1.5 * M);
    const back = inLot(lot, fw - 2 * M, backD, dp - backD - 0.5 * M, 0.5);
    if (backD > 3 * M) {
      if (rng.chance(0.3) && backD > 5 * M) {
        const sw = R_(rng, 3, 4), sd = Math.min(R_(rng, 3, 3.6), backD - 8);
        const sr = inLot(lot, sw, sd, dp - sd - 0.8 * M, rng.chance(0.5) ? 0.05 : 0.95);
        if (sr.w > 60 && sr.h > 60) P.building('house', 'shed', sr.x, sr.y, sr.w, sr.h, lot.front, { roofStyle: 'metal' });
      } else {
        const n = rng.int(0, 2);
        for (let i = 0; i < n; i++) P.tree(back.x + rng.range(0.15, 0.85) * back.w, back.y + rng.range(0.2, 0.8) * back.h, R_(rng, 2.2, 3.6));
      }
    }
    if (rng.chance(0.15)) P.decal(rng.pick(['trash', 'stain', 'tiretrack']), fp.x, fp.y, 1, 0);
    return true;
  };
  function simple(type, sub, sizes, sbR, extra) {
    return function (P, lot) {
      const rng = P.rng;
      const fw = lot.front === 's' || lot.front === 'n' ? lot.w : lot.h;
      const dp = lot.front === 's' || lot.front === 'n' ? lot.h : lot.w;
      const bw = Math.min(fw - 2 * M, R_(rng, sizes[0], sizes[1])), bd = Math.min(dp - 2 * M, R_(rng, sizes[2], sizes[3]));
      const sb = Math.min(R_(rng, sbR[0], sbR[1]), dp - bd - M);
      const r = inLot(lot, bw, bd, sb, rng.range(0.1, 0.9));
      const b = P.building(type, sub, r.x, r.y, r.w, r.h, lot.front);
      storyBuilding(P, b);
      P.area(rng.chance(0.7) ? 'concrete' : 'urban', lot.x, lot.y, lot.w, lot.h);
      if (extra) extra(P, lot, b, r);
      return b;
    };
  }
  function parkingRows(P, area, front, density, btype) {
    const rng = P.rng;
    P.area('parking', area.x, area.y, area.w, area.h);
    const vert = front === 's' || front === 'n'; // los autos apuntan hacia la calle
    const slotW = 2.7 * M, slotL = 5.2 * M;
    if (vert) {
      for (let y = area.y + 0.5 * M; y + slotL <= area.y + area.h - M; y += slotL * 2 + 2 * M) {
        for (let x = area.x + M; x + slotW <= area.x + area.w - M; x += slotW) {
          P.decal('pline', x, y, 1, 0, { len: slotL });
          if (rng.chance(density)) P.car(x + slotW / 2, y + slotL / 2, Math.PI / 2 + (rng.chance(0.5) ? 0 : Math.PI), { btype });
        }
      }
    } else {
      for (let x = area.x + 0.5 * M; x + slotL <= area.x + area.w - M; x += slotL * 2 + 2 * M) {
        for (let y = area.y + M; y + slotW <= area.y + area.h - M; y += slotW) {
          P.decal('pline', x, y, 1, Math.PI / 2, { len: slotL });
          if (rng.chance(density)) P.car(x + slotL / 2, y + slotW / 2, rng.chance(0.5) ? 0 : Math.PI, { btype });
        }
      }
    }
  }
  BUILD.apartments = simple('other', 'apartments', [18, 28, 18, 32], [1, 3], (P, lot, b) => { if (P.rng.chance(0.3)) P.prop('dumpster', b.x - 30, b.y + b.h / 2, {}, []); });
  BUILD.office = simple('other', 'office', [16, 26, 18, 30], [1, 4]);
  BUILD.store = simple('other', 'store', [9, 14, 11, 16], [0.5, 3]);
  BUILD.bar = simple('other', 'bar', [10, 14, 12, 16], [0.5, 3]);
  BUILD.pharmacy = simple('pharmacy', null, [12, 16, 14, 20], [1, 4]);
  BUILD.hardware = simple('hardware', null, [18, 24, 22, 28], [2, 6]);
  BUILD.garage = simple('garage', null, [13, 18, 12, 16], [3, 7], (P, lot, b) => {
    const rng = P.rng;
    for (let i = 0; i < rng.int(0, 3); i++) {
      const fp = frontPt(lot, rng.range(0.15, 0.85), -2.8 * M);
      if (P.rectFree({ x: fp.x - 80, y: fp.y - 80, w: 160, h: 160 }, 0)) P.car(fp.x, fp.y, rng.range(0, 6.28), { wreck: rng.chance(0.5) });
    }
    P.decal('stain', lot.x + lot.w / 2, lot.y + lot.h / 2, 2, 0);
  });
  BUILD.police = simple('police', null, [22, 26, 22, 28], [2, 4], (P, lot, b) => {
    const rng = P.rng;
    for (let i = 0; i < rng.int(1, 3); i++) {
      const fp = frontPt(lot, rng.range(0.1, 0.9), -1.8 * M);
      P.car(fp.x, fp.y, lot.front === 's' || lot.front === 'n' ? 0 : Math.PI / 2, { kind: 'police', color: '#20262e', btype: 'police', boost: 1.5 });
    }
    if (rng.chance(0.5)) { const fp = frontPt(lot, 0.5, -0.6 * M); P.rectProp('barrier', fp.x - 40, fp.y - 6, 80, 12, {}); }
  });
  BUILD.church = function (P, lot) {
    const rng = P.rng;
    const fw = lot.front === 's' || lot.front === 'n' ? lot.w : lot.h;
    const dp = lot.front === 's' || lot.front === 'n' ? lot.h : lot.w;
    const bw = Math.min(fw - 4 * M, R_(rng, 13, 17)), bd = Math.min(dp - 6 * M, R_(rng, 24, 31));
    const r = inLot(lot, bw, bd, R_(rng, 4, 6), 0.5);
    const b = P.building('church', null, r.x, r.y, r.w, r.h, lot.front, { roofStyle: 'gable', roofColor: rng.pick(['#3e3a38', '#4a3430', '#38403e']) });
    storyBuilding(P, b);
    P.area('lawn', lot.x, lot.y, lot.w, lot.h);
    const fp = frontPt(lot, 0.5);
    walkway(P, lot, r, fp, 'gravel', 80);
    // tumbas a un lado
    if (rng.chance(0.5)) {
      const side = inLot(lot, Math.max(0, (fw - bw) / 2 - 2 * M), dp - 4 * M, 2 * M, 0.02);
      graves(P, side, 0.7);
    }
    for (let i = 0; i < rng.int(1, 3); i++) P.tree(lot.x + rng.range(0.05, 0.95) * lot.w, lot.y + rng.range(0.05, 0.95) * lot.h, R_(rng, 2.5, 4));
    if (rng.chance(0.25)) P.decal('body', fp.x + rng.range(-40, 40), fp.y + rng.range(-60, 60), 1, rng.range(0, 6.28));
  };
  function graves(P, r, density) {
    const rng = P.rng;
    if (r.w < 40 || r.h < 40) return;
    for (let y = r.y + 16; y + 30 < r.y + r.h; y += 52) {
      for (let x = r.x + 12; x + 18 < r.x + r.w; x += 34) {
        if (!rng.chance(density)) continue;
        P.rectProp('grave', x, y, 18, 30, { open: rng.chance(0.08) });
      }
    }
  }
  BUILD.cemetery = function (P, lot) {
    const rng = P.rng;
    P.area('lawn', lot.x, lot.y, lot.w, lot.h);
    lotFence(P, lot, rng.chance(0.5) ? 'stone' : 'chain', 0.5, 0.12);
    const inner = { x: lot.x + 2 * M, y: lot.y + 2 * M, w: lot.w - 4 * M, h: lot.h - 4 * M };
    graves(P, inner, 0.82);
    for (let i = 0; i < rng.int(2, 5); i++) P.tree(lot.x + rng.range(0.05, 0.95) * lot.w, lot.y + rng.range(0.05, 0.95) * lot.h, R_(rng, 2.5, 4.5));
    if (rng.chance(0.4)) {
      const c = inLot(lot, R_(rng, 5, 7), R_(rng, 6, 8), 3 * M, rng.range(0.2, 0.8));
      if (P.rectFree(c, 0)) P.building('church', null, c.x, c.y, c.w, c.h, lot.front, { roofStyle: 'gable', small: true });
    }
    if (rng.chance(0.3)) P.decal('massgrave', lot.x + lot.w * 0.5, lot.y + lot.h * 0.5, rng.range(1, 1.6), rng.range(0, 3));
  };
  BUILD.park = function (P, lot) {
    const rng = P.rng;
    P.area('lawn', lot.x, lot.y, lot.w, lot.h);
    const cx = lot.x + lot.w / 2, cy = lot.y + lot.h / 2;
    P.area('gravel', lot.x, cy - 40, lot.w, 80);
    P.area('gravel', cx - 40, lot.y, 80, lot.h);
    if (rng.chance(0.6)) P.circleProp(rng.chance(0.5) ? 'fountain' : 'statue', cx, cy, rng.chance(0.5) ? 70 : 40, {}, false);
    else P.circleArea('gravel', cx, cy, 120);
    for (let i = 0; i < rng.int(4, 9); i++) {
      const x = lot.x + rng.range(0.08, 0.92) * lot.w, y = lot.y + rng.range(0.08, 0.92) * lot.h;
      if (Math.abs(x - cx) < 70 || Math.abs(y - cy) < 70) continue;
      P.tree(x, y, R_(rng, 2.5, 5));
    }
    for (let i = 0; i < rng.int(2, 5); i++) {
      const horiz = rng.chance(0.5);
      const x = horiz ? lot.x + rng.range(0.1, 0.8) * lot.w : cx + (rng.chance(0.5) ? 48 : -64), y = horiz ? cy + (rng.chance(0.5) ? 48 : -60) : lot.y + rng.range(0.1, 0.8) * lot.h;
      P.rectProp('bench', x, y, horiz ? 56 : 14, horiz ? 14 : 56, { horiz });
    }
    if (rng.chance(0.35)) {
      // campamento de refugiados abandonado
      for (let i = 0; i < rng.int(2, 5); i++) {
        const x = lot.x + rng.range(0.1, 0.8) * lot.w, y = lot.y + rng.range(0.1, 0.8) * lot.h;
        P.rectProp('tent', x, y, 80, 64, { color: rng.pick(['#3c4432', '#4a3c2c', '#38424a', '#5a5040']) }, true);
      }
      P.decal('body', cx + rng.range(-100, 100), cy + rng.range(-100, 100), 1, rng.range(0, 6));
      P.chest(cx + rng.range(-60, 60), cy + rng.range(-60, 60), 'mochila', 'other');
    }
    P.hint(cx, cy);
  };
  BUILD.sports = function (P, lot) {
    const rng = P.rng;
    P.area('lawn', lot.x, lot.y, lot.w, lot.h);
    const vert = lot.h > lot.w;
    const fw = vert ? lot.w - 12 * M : lot.w - 12 * M, fh = vert ? lot.h - 12 * M : lot.h - 12 * M;
    const f = { x: lot.x + (lot.w - fw) / 2, y: lot.y + (lot.h - fh) / 2, w: fw, h: fh };
    P.area('pitch', f.x, f.y, f.w, f.h, { vert });
    // gradas
    if (vert) { P.rectProp('bleacher', lot.x + M, f.y + fh * 0.2, 4 * M, fh * 0.6, {}, true); }
    else P.rectProp('bleacher', f.x + fw * 0.2, lot.y + M, fw * 0.6, 4 * M, {}, true);
    lotFence(P, lot, 'chain', 0.5, 0.1);
    P.hint(f.x + f.w / 2, f.y + f.h / 2);
    if (rng.chance(0.4)) P.prop('helicopter', f.x + f.w / 2, f.y + f.h / 2, { ang: rng.range(0, 6.28), ext: 300 }, [{ shape: 'circle', kind: 'heli', cx: f.x + f.w / 2, cy: f.y + f.h / 2, r: 60, blocksSight: false }]);
  };
  BUILD.parking = function (P, lot) {
    parkingRows(P, { x: lot.x + M, y: lot.y + M, w: lot.w - 2 * M, h: lot.h - 2 * M }, lot.front, 0.35);
  };
  BUILD.empty = function (P, lot) {
    const rng = P.rng;
    P.area(rng.chance(0.5) ? 'urban' : 'gravel', lot.x, lot.y, lot.w, lot.h);
    for (let i = 0; i < rng.int(2, 6); i++) P.decal('rubble', lot.x + rng.range(0.1, 0.9) * lot.w, lot.y + rng.range(0.1, 0.9) * lot.h, rng.range(1, 2.2), 0);
    if (rng.chance(0.4)) {
      // cimientos de una casa en ruinas
      const r = inLot(lot, Math.min(lot.w, lot.h) * 0.6, Math.min(lot.w, lot.h) * 0.55, 2 * M, 0.5);
      P.prop('foundation', r.x + r.w / 2, r.y + r.h / 2, { w: r.w, h: r.h, ext: Math.max(r.w, r.h) / 2 + 20 }, [
        { shape: 'rect', kind: 'wall', x: r.x, y: r.y, w: r.w * 0.6, h: 10, blocksSight: false },
        { shape: 'rect', kind: 'wall', x: r.x, y: r.y, w: 10, h: r.h * 0.7, blocksSight: false },
      ]);
    }
    if (rng.chance(0.3)) P.car(lot.x + lot.w / 2, lot.y + lot.h / 2, rng.range(0, 6.28), { burned: true, wreck: true });
  };
  BUILD.supermarket = function (P, lot) {
    const rng = P.rng;
    const fw = lot.front === 's' || lot.front === 'n' ? lot.w : lot.h;
    const dp = lot.front === 's' || lot.front === 'n' ? lot.h : lot.w;
    const bw = Math.min(fw - 4 * M, R_(rng, 32, 40)), bd = Math.min(dp - 18 * M, R_(rng, 30, 38));
    const sb = dp - bd - 1.5 * M;
    const r = inLot(lot, bw, bd, sb, 0.5);
    const b = P.building('supermarket', null, r.x, r.y, r.w, r.h, lot.front);
    storyBuilding(P, b);
    const park = inLot(lot, fw - 2 * M, sb - 2.5 * M, M, 0.5);
    parkingRows(P, park, lot.front, 0.3, 'supermarket');
    for (let i = 0; i < rng.int(2, 6); i++) P.decal('cart', park.x + rng.range(0, park.w), park.y + rng.range(0, park.h), 1, rng.range(0, 6.28));
    P.hint(park.x + park.w / 2, park.y + park.h / 2);
  };
  BUILD.gas = function (P, lot) {
    const rng = P.rng;
    P.area('concrete', lot.x, lot.y, lot.w, lot.h);
    const fw = lot.front === 's' || lot.front === 'n' ? lot.w : lot.h;
    const dp = lot.front === 's' || lot.front === 'n' ? lot.h : lot.w;
    const sw = R_(rng, 10, 13), sd = R_(rng, 9, 12);
    const off = rng.chance(0.5) ? 0.08 : 0.92;
    const r = inLot(lot, sw, sd, dp - sd - M, off);
    const b = P.building('gas', null, r.x, r.y, r.w, r.h, lot.front, { roofStyle: 'flat' });
    storyBuilding(P, b);
    // marquesina con surtidores
    const cw = Math.min(fw - sw - 4 * M, R_(rng, 14, 20)), cd = R_(rng, 8, 10);
    const can = inLot(lot, cw, cd, 2.5 * M, off < 0.5 ? 0.92 : 0.08);
    P.roofs.push({ kind: 'canopy', x: can.x, y: can.y, w: can.w, h: can.h, color: rng.pick(['#7a2a22', '#2a4a6a', '#6a6a2a', '#3a6a3a']) });
    const vert = lot.front === 's' || lot.front === 'n';
    const n = Math.max(2, Math.floor((vert ? can.w : can.h) / (5 * M)));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const px = vert ? can.x + can.w * t : can.x + can.w / 2, py = vert ? can.y + can.h / 2 : can.y + can.h * t;
      P.rectProp('pump', px - (vert ? 12 : 18), py - (vert ? 18 : 12), vert ? 24 : 36, vert ? 36 : 24, { explosive: true });
      if (rng.chance(0.3)) P.car(px + (vert ? 0 : 3.4 * M), py + (vert ? 3.4 * M : 0), vert ? 0 : Math.PI / 2, {});
    }
    P.decal('stain', can.x + can.w / 2, can.y + can.h / 2, 2.5, 0);
    if (rng.chance(0.3)) P.decal('crater', can.x + can.w / 2, can.y + can.h / 2, 2, 0);
    P.hint(can.x + can.w / 2, can.y + can.h + 40);
  };
  BUILD.warehouse = function (P, lot, opt) {
    const rng = P.rng;
    const big = opt && opt.factory;
    const fw = lot.front === 's' || lot.front === 'n' ? lot.w : lot.h;
    const dp = lot.front === 's' || lot.front === 'n' ? lot.h : lot.w;
    const bw = Math.min(fw - 4 * M, big ? R_(rng, 44, 60) : R_(rng, 26, 40)), bd = Math.min(dp - 10 * M, big ? R_(rng, 50, 72) : R_(rng, 30, 46));
    const r = inLot(lot, bw, bd, R_(rng, 6, 9), rng.range(0.3, 0.7));
    const b = P.building(big ? 'factory' : 'warehouse', null, r.x, r.y, r.w, r.h, lot.front);
    storyBuilding(P, b);
    P.area(rng.chance(0.6) ? 'concrete' : 'gravel', lot.x, lot.y, lot.w, lot.h);
    if (rng.chance(0.6)) lotFence(P, lot, 'chain', rng.range(0.3, 0.7), 0.18);
    // contenedores, camiones, palés
    for (let i = 0; i < rng.int(1, 4); i++) {
      const fp = frontPt(lot, rng.range(0.1, 0.9), -rng.range(2.5, 5) * M);
      const vert = rng.chance(0.5);
      const c = { x: fp.x - (vert ? 39 : 96), y: fp.y - (vert ? 96 : 39), w: vert ? 78 : 192, h: vert ? 192 : 78 };
      if (P.rectFree(c, 8) && !G.overlap(c, r, 16)) {
        P.reserve(c);
        const p = P.rectProp('container', c.x, c.y, c.w, c.h, { color: rng.pick(['#6a3a2a', '#2a4a5a', '#5a5a3a', '#3a5a3a', '#7a6a3a']), vert, open: rng.chance(0.3) }, true);
        if (rng.chance(0.4)) { const ch = P.chest(c.x + c.w / 2, c.y + c.h / 2, 'contenedor', 'warehouse'); p.chestId = ch.id; }
      }
    }
    if (rng.chance(0.5)) {
      const fp = frontPt(lot, rng.range(0.2, 0.8), -3 * M);
      P.car(fp.x, fp.y, lot.front === 's' || lot.front === 'n' ? Math.PI / 2 : 0, { kind: 'truck', L: 260, W: 80 });
    }
    P.decal('stain', r.x + r.w / 2, r.y + r.h + 40, 2, 0);
  };
  BUILD.factory = function (P, lot) { BUILD.warehouse(P, lot, { factory: true }); };
  BUILD.containers = function (P, lot) {
    const rng = P.rng;
    P.area('gravel', lot.x, lot.y, lot.w, lot.h);
    lotFence(P, lot, 'chain', 0.5, 0.2);
    for (let y = lot.y + 2 * M; y + 78 < lot.y + lot.h - 2 * M; y += 78 + 2.5 * M) {
      for (let x = lot.x + 2 * M; x + 192 < lot.x + lot.w - 2 * M; x += 192 + 2 * M) {
        if (!rng.chance(0.7)) continue;
        const p = P.rectProp('container', x, y, 192, 78, { color: rng.pick(['#6a3a2a', '#2a4a5a', '#5a5a3a', '#3a5a3a', '#7a6a3a']), vert: false, open: rng.chance(0.3) }, true);
        if (rng.chance(0.35)) { const ch = P.chest(x + 96, y + 39, 'contenedor', 'warehouse'); p.chestId = ch.id; }
      }
    }
  };
  BUILD.junk = function (P, lot) {
    const rng = P.rng;
    P.area('gravel', lot.x, lot.y, lot.w, lot.h);
    lotFence(P, lot, 'chain', 0.5, 0.2);
    for (let i = 0; i < rng.int(4, 9); i++) P.car(lot.x + rng.range(0.15, 0.85) * lot.w, lot.y + rng.range(0.15, 0.85) * lot.h, rng.range(0, 6.28), { wreck: true, burned: rng.chance(0.3), trunkP: 0.3 });
    for (let i = 0; i < 3; i++) P.decal('debris', lot.x + rng.range(0, lot.w), lot.y + rng.range(0, lot.h), 1.5, 0);
  };
  BUILD.school = function (P, lot) {
    const rng = P.rng;
    const fw = lot.front === 's' || lot.front === 'n' ? lot.w : lot.h;
    const dp = lot.front === 's' || lot.front === 'n' ? lot.h : lot.w;
    const bw = Math.min(fw - 4 * M, R_(rng, 34, 44)), bd = Math.min(dp * 0.55, R_(rng, 24, 30));
    const r = inLot(lot, bw, bd, R_(rng, 3, 6), 0.5);
    const b = P.building('school', null, r.x, r.y, r.w, r.h, lot.front);
    storyBuilding(P, b);
    P.area('lawn', lot.x, lot.y, lot.w, lot.h);
    const court = inLot(lot, Math.min(fw - 6 * M, 28 * M), Math.min(dp - bd - 10 * M, 16 * M), dp - Math.min(dp - bd - 10 * M, 16 * M) - 2 * M, 0.5);
    if (court.w > 8 * M && court.h > 8 * M) P.area('court', court.x, court.y, court.w, court.h);
    lotFence(P, lot, 'chain', 0.5, 0.12);
    if (rng.chance(0.5)) { const fp = frontPt(lot, 0.2, 3 * M); P.car(fp.x, fp.y, lot.front === 's' || lot.front === 'n' ? 0 : Math.PI / 2, { kind: 'bus', L: 360, W: 82, color: '#b08a2a' }); }
  };
  BUILD.hospital = function (P, lot, opt) {
    const rng = P.rng;
    const small = opt && opt.clinic;
    const fw = lot.front === 's' || lot.front === 'n' ? lot.w : lot.h;
    const dp = lot.front === 's' || lot.front === 'n' ? lot.h : lot.w;
    const bw = Math.min(fw - 4 * M, small ? R_(rng, 26, 32) : R_(rng, 46, 58)), bd = Math.min(dp - 14 * M, small ? R_(rng, 22, 28) : R_(rng, 50, 66));
    const r = inLot(lot, bw, bd, dp - bd - 2 * M, 0.5);
    const b = P.building('hospital', null, r.x, r.y, r.w, r.h, lot.front, { boost: 1.2 });
    storyBuilding(P, b);
    const park = inLot(lot, fw - 2 * M, dp - bd - 4 * M, M, 0.5);
    P.area('parking', park.x, park.y, park.w, park.h);
    for (let i = 0; i < rng.int(1, 3); i++) {
      const x = park.x + rng.range(0.15, 0.85) * park.w, y = park.y + rng.range(0.25, 0.75) * park.h;
      P.car(x, y, rng.range(0, 6.28), { kind: 'ambulance', L: 190, W: 70, color: '#c8c4b8', btype: 'hospital', container: 'maletero', boost: 1.5 });
    }
    // triaje desbordado: tiendas, camillas y cuerpos
    if (rng.chance(0.55)) {
      for (let i = 0; i < rng.int(1, 3); i++) P.rectProp('tent', park.x + rng.range(0.1, 0.7) * park.w, park.y + rng.range(0.1, 0.6) * park.h, 110, 90, { color: '#4a5040', cross: true }, true);
      for (let i = 0; i < rng.int(3, 8); i++) P.decal(rng.chance(0.5) ? 'bodybag' : 'body', park.x + rng.range(0, park.w), park.y + rng.range(0, park.h), 1, rng.range(0, 6.28));
      P.chest(park.x + park.w / 2, park.y + park.h / 2, 'caja médica', 'hospital', 1.4);
    }
    P.hint(park.x + park.w / 2, park.y + park.h / 2);
  };
  BUILD.clinic = function (P, lot) { BUILD.hospital(P, lot, { clinic: true }); };
  BUILD.farmlot = function (P, lot) {
    const rng = P.rng;
    BUILD.house(P, lot, { size: 'v', farm: true, fenceP: 0.2 });
    // granero pequeño detrás si cabe
    const back = inLot(lot, R_(rng, 8, 11), R_(rng, 9, 12), 2 * M, rng.chance(0.5) ? 0.05 : 0.95);
    void back;
  };
  BUILD.chapel = function (P, lot) { BUILD.church(P, lot); };

  // ---------- calles ----------
  // Distancia del centro al borde del anillo central en la dirección a
  function ringDist(s, a) {
    if (!s.ring) return 0;
    if (s.ringShape === 'square') return s.ring / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)));
    return s.ring;
  }
  function growStreet(P, s, x, y, ang, maxLen, o) {
    const rng = P.rng;
    const step = (o.step || 12) * M;
    const pts = [x, y];
    let a = ang, curv = rng.range(-1, 1) * (o.curv || 0.03), len = 0, snapped = false;
    const R = s.R * (o.rmax || 1.04);
    while (len < maxLen) {
      a += curv + rng.range(-1, 1) * (o.wobble || 0.04);
      curv = U.clamp(curv + rng.range(-0.015, 0.015), -(o.curv || 0.03) * 2, (o.curv || 0.03) * 2);
      const nx = x + Math.cos(a) * step, ny = y + Math.sin(a) * step;
      if (Math.hypot(nx - s.x, ny - s.y) > R) break;
      if (P.world.terrain.blocked(nx, ny)) break;
      if (Math.hypot(nx, ny) < TM.Config.SAFE_RADIUS + 26 * M) break;
      if (len >= step * 1.5) {
        const q = P.nearestRoadPoint(nx, ny, 22 * M, o.parent);
        if (q && q.d < q.r.w / 2 + (o.snap || 9) * M) { pts.push(q.x, q.y); snapped = true; len += q.d; break; }
      }
      pts.push(nx, ny); x = nx; y = ny; len += step;
    }
    if (len < (o.minLen || 30) * M) return null;
    const dense = pts.length > 6 ? G.catmull(pts, 2) : pts;
    const r = G.makeRoad(dense, o.w || 192, o.kind || 'street', { side: o.side || 0, local: true });
    P.addRoad(r);
    if (!snapped && o.culdesac) P.circleArea('asphalt', x, y, (o.w || 192) * 0.8);
    return r;
  }

  // Calle recta alineada a los ejes
  function straight(P, x0, y0, x1, y1, w, side, kind) {
    const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / (16 * M)));
    const pts = [];
    for (let i = 0; i <= n; i++) pts.push(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n);
    const r = G.makeRoad(pts, w, kind || 'street', { side, local: true });
    P.addRoad(r);
    return r;
  }

  // Anillo central: rotonda (círculo) o plaza (cuadrado)
  function centerRing(P, s) {
    if (!s.ring) return;
    const rng = P.rng;
    const pts = [];
    const w = 224;
    if (s.ringShape === 'square') {
      const h = s.ring;
      const c = [[-h, -h], [h, -h], [h, h], [-h, h], [-h, -h]];
      for (let i = 0; i < 4; i++) {
        for (let k = 0; k < 6; k++) { const t = k / 6; pts.push(s.x + c[i][0] + (c[i + 1][0] - c[i][0]) * t, s.y + c[i][1] + (c[i + 1][1] - c[i][1]) * t); }
      }
      pts.push(s.x - h, s.y - h);
      P.addRoad(G.makeRoad(pts, w, 'street', { side: 64, local: true, closed: true }));
      const isl = h - w / 2 - 64;
      P.area('plaza', s.x - isl, s.y - isl, isl * 2, isl * 2);
      P.reserve({ x: s.x - isl, y: s.y - isl, w: isl * 2, h: isl * 2 });
      const k = rng.next();
      if (k < 0.4) P.circleProp('fountain', s.x, s.y, 80, {}, false);
      else if (k < 0.7) P.circleProp('statue', s.x, s.y, 44, {}, false);
      else P.rectProp('kiosk', s.x - 90, s.y - 90, 180, 180, {}, false);
      for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) P.tree(s.x + dx * isl * 0.65, s.y + dy * isl * 0.65, R_(rng, 2.5, 4));
      for (let i = 0; i < 4; i++) P.rectProp('bench', s.x - 28 + (i % 2 ? isl * 0.4 : -isl * 0.4), s.y + (i < 2 ? -isl * 0.8 : isl * 0.7), 56, 14, { horiz: true });
    } else {
      const R = s.ring;
      for (let i = 0; i <= 32; i++) { const a = (i / 32) * Math.PI * 2; pts.push(s.x + Math.cos(a) * R, s.y + Math.sin(a) * R); }
      P.addRoad(G.makeRoad(pts, w, 'street', { side: 48, local: true, closed: true }));
      const isl = R - w / 2 - 48;
      P.circleArea('lawn', s.x, s.y, isl);
      P.reserve({ x: s.x - isl, y: s.y - isl, w: isl * 2, h: isl * 2 });
      if (rng.chance(0.6)) P.circleProp(rng.chance(0.5) ? 'statue' : 'fountain', s.x, s.y, rng.chance(0.5) ? 44 : 70, {}, false);
      else P.tree(s.x, s.y, R_(rng, 5, 7));
    }
    P.hint(s.x, s.y + s.ring);
  }

  function* cityStreets(P, s, inc) {
    const rng = P.rng, R = s.R, metro = s.type === 'metro';
    // avenidas radiales extra
    const angs = inc.map((r) => r.angle);
    const nAv = metro ? rng.int(6, 8) : rng.int(4, 5);
    for (let k = angs.length; k < nAv; k++) {
      let best = 0, bg = -1;
      for (let t = 0; t < 24; t++) {
        const a = (t / 24) * Math.PI * 2 + rng.range(-0.1, 0.1);
        let g = Math.PI;
        for (const b of angs) g = Math.min(g, Math.abs(U.angDiff(a, b)));
        if (g > bg) { bg = g; best = a; }
      }
      angs.push(best);
      growStreet(P, s, s.x + Math.cos(best) * ringDist(s, best), s.y + Math.sin(best) * ringDist(s, best), best, R, { w: 256, side: 64, kind: 'avenue', curv: 0.012, wobble: 0.02, minLen: 60, step: 16 });
      yield;
    }
    // cinturones
    const rings = metro ? [rng.range(0.3, 0.38), rng.range(0.62, 0.72)] : rng.chance(0.65) ? [rng.range(0.5, 0.68)] : [];
    for (const f of rings) {
      const rr = R * f, pts = [];
      const ph = rng.range(0, 6.28), amp = rng.range(0.03, 0.08);
      for (let i = 0; i <= 40; i++) {
        const a = (i / 40) * Math.PI * 2;
        const q = rr * (1 + amp * Math.sin(a * 3 + ph));
        pts.push(s.x + Math.cos(a) * q, s.y + Math.sin(a) * q);
      }
      // los cinturones se cortan donde haya agua
      let cur = [];
      for (let i = 0; i < pts.length; i += 2) {
        if (P.world.terrain.blocked(pts[i], pts[i + 1]) || Math.hypot(pts[i], pts[i + 1]) < TM.Config.SAFE_RADIUS + 30 * M) {
          if (cur.length >= 6) P.addRoad(G.makeRoad(cur, 224, 'avenue', { side: 64, local: true }));
          cur = [];
        } else cur.push(pts[i], pts[i + 1]);
      }
      if (cur.length >= 6) P.addRoad(G.makeRoad(cur, 224, 'avenue', { side: 64, local: true }));
      yield;
    }
    // centro en cuadrícula (calles alineadas, manzanas de tamaño variable)
    const gh = R * (metro ? rng.range(0.3, 0.42) : rng.range(0.22, 0.34));
    const gx0 = s.x - gh + rng.range(-1, 1) * 8 * M, gy0 = s.y - gh + rng.range(-1, 1) * 8 * M;
    const lines = (o0, L) => { const xs = [o0]; let p = o0; while (p < o0 + L) { p += R_(rng, 58, 105); xs.push(Math.min(p, o0 + L)); } return xs; };
    const xs = lines(gx0, gh * 2), ys = lines(gy0, gh * 2);
    const inRing = (x, y) => s.ring && (s.ringShape === 'square' ? Math.max(Math.abs(x - s.x), Math.abs(y - s.y)) < s.ring + 6 * M : Math.hypot(x - s.x, y - s.y) < s.ring + 6 * M);
    const keepP = 0.86;
    for (const x of xs) {
      let run = null;
      for (let j = 0; j < ys.length - 1; j++) {
        if (WG.over()) yield;
        const keep = rng.chance(keepP) && !inRing(x, (ys[j] + ys[j + 1]) / 2) && !P.world.terrain.blocked(x, (ys[j] + ys[j + 1]) / 2);
        if (keep) { if (!run) run = [ys[j], ys[j + 1]]; else run[1] = ys[j + 1]; }
        if ((!keep || j === ys.length - 2) && run) { straight(P, x, run[0], x, run[1], 224, 64); run = null; }
      }
    }
    yield;
    for (const y of ys) {
      let run = null;
      for (let i = 0; i < xs.length - 1; i++) {
        if (WG.over()) yield;
        const keep = rng.chance(keepP) && !inRing((xs[i] + xs[i + 1]) / 2, y) && !P.world.terrain.blocked((xs[i] + xs[i + 1]) / 2, y);
        if (keep) { if (!run) run = [xs[i], xs[i + 1]]; else run[1] = xs[i + 1]; }
        if ((!keep || i === xs.length - 2) && run) { straight(P, run[0], y, run[1], y, 224, 64); run = null; }
      }
    }
    yield;
    P.grid = { x: gx0, y: gy0, w: gh * 2, h: gh * 2 };
    // calles secundarias (residenciales, curvas) desde avenidas y cinturones
    const trunks = P.roads.filter((r) => r.kind === 'avenue').concat(inc.map((i) => i.road));
    let n = 0;
    for (const t of trunks) {
      for (let sAl = R_(rng, 30, 60); sAl < t.len; sAl += R_(rng, 55, 100)) {
        const p = G.roadAt(t, sAl);
        const d = Math.hypot(p.x - s.x, p.y - s.y);
        if (d > R * 0.95 || d < gh * 0.9) continue;
        if (G.inRect(p.x, p.y, P.grid, 4 * M)) continue;
        if (!rng.chance(metro ? 0.85 : 0.75)) continue;
        const side = rng.chance(0.5) ? 1 : -1;
        const a = Math.atan2(p.dx, -p.dy) * 1 + (side < 0 ? Math.PI : 0) + rng.range(-0.3, 0.3);
        const sx = p.x + Math.cos(a) * (t.w / 2 + 2 * M), sy = p.y + Math.sin(a) * (t.w / 2 + 2 * M);
        const curvy = rng.chance(0.55);
        const r2 = growStreet(P, s, p.x, p.y, a, R_(rng, 70, 220), { w: 192, side: 48, curv: curvy ? 0.05 : 0.008, wobble: curvy ? 0.05 : 0.01, parent: t, culdesac: rng.chance(0.5), minLen: 35 });
        if (r2 && metro && rng.chance(0.5)) {
          // ramas de segundo nivel
          for (let s2 = R_(rng, 40, 70); s2 < r2.len - 30 * M; s2 += R_(rng, 60, 110)) {
            const p2 = G.roadAt(r2, s2);
            const sd = rng.chance(0.5) ? 1 : -1;
            const a2 = Math.atan2(p2.dx, -p2.dy) + (sd < 0 ? Math.PI : 0) + rng.range(-0.2, 0.2);
            growStreet(P, s, p2.x, p2.y, a2, R_(rng, 50, 140), { w: 176, side: 32, curv: 0.04, parent: r2, culdesac: true, minLen: 30 });
          }
        }
        if (WG.over()) yield;
      }
    }
    // barrios en cuadrícula (gran ciudad)
    if (metro) {
      for (let k = 0; k < rng.int(1, 3); k++) {
        const a = rng.range(0, 6.28), d = R * rng.range(0.5, 0.8);
        const cx = s.x + Math.cos(a) * d, cy = s.y + Math.sin(a) * d;
        const sp = R_(rng, 45, 70), nn = rng.int(3, 4);
        for (let i = 0; i < nn; i++) {
          const x = cx - sp * (nn - 1) / 2 + i * sp;
          if (P.roadDist(x, cy, 30 * M) > 12 * M) growStreet(P, s, x, cy - sp * 1.5, Math.PI / 2, sp * 3, { w: 192, side: 48, curv: 0.001, wobble: 0.001, minLen: 30, snap: 6 });
          const y = cy - sp * (nn - 1) / 2 + i * sp;
          if (P.roadDist(cx, y, 30 * M) > 12 * M) growStreet(P, s, cx - sp * 1.5, y, 0, sp * 3, { w: 192, side: 48, curv: 0.001, wobble: 0.001, minLen: 30, snap: 6 });
        }
        yield;
      }
    }
    yield* coverStreets(P, s, metro ? 40 * M : 45 * M, 176, 40);
  }

  // Cubre los huecos sin calles: desde la calle más cercana crece una nueva hacia el hueco
  function* coverStreets(P, s, gap, w, side) {
    const rng = P.rng, R = s.R;
    const step = gap * 0.9;
    let n = 0;
    // varias pasadas: las calles nuevas acercan los huecos lejanos a una calle
    for (let pass = 0; pass < 3; pass++) {
      for (let y = s.y - R; y <= s.y + R; y += step) {
        for (let x = s.x - R; x <= s.x + R; x += step) {
          const px = x + rng.range(-0.3, 0.3) * step, py = y + rng.range(-0.3, 0.3) * step;
          if (Math.hypot(px - s.x, py - s.y) > R * 0.88) continue;
          if (WG.over()) yield;
          if (P.roadDist(px, py, gap * 1.4) < gap) continue;
          if (P.world.terrain.blocked(px, py)) continue;
          const q = P.nearestRoadPoint(px, py, pass === 0 ? gap * 3 : R * 1.6);
          if (!q) continue;
          const ang = Math.atan2(py - q.y, px - q.x);
          const len = Math.min(Math.hypot(px - q.x, py - q.y) + R_(rng, 30, 110), R * 0.9);
          growStreet(P, s, q.x, q.y, ang, len, { w, side, curv: 0.03, wobble: 0.035, parent: q.r, culdesac: rng.chance(0.6), minLen: 25 });
        }
      }
    }
  }

  function* townStreets(P, s, inc) {
    const rng = P.rng, R = s.R;
    const angs = inc.map((r) => r.angle);
    const extra = rng.int(1, 3);
    for (let k = 0; k < extra; k++) {
      let best = 0, bg = -1;
      for (let t = 0; t < 16; t++) {
        const a = (t / 16) * Math.PI * 2 + rng.range(-0.2, 0.2);
        let g = Math.PI;
        for (const b of angs) g = Math.min(g, Math.abs(U.angDiff(a, b)));
        if (g > bg) { bg = g; best = a; }
      }
      angs.push(best);
      growStreet(P, s, s.x + Math.cos(best) * ringDist(s, best), s.y + Math.sin(best) * ringDist(s, best), best, R * rng.range(0.7, 1), { w: 224, side: 48, kind: 'avenue', curv: 0.04, wobble: 0.03, minLen: 40 });
    }
    yield;
    // pequeña cuadrícula alrededor del centro
    if (rng.chance(0.6)) {
      const sp = R_(rng, 45, 70), n = rng.int(2, 3);
      for (let i = -n; i <= n; i++) {
        if (i === 0) continue;
        const x = s.x + i * sp;
        if (P.roadDist(x, s.y, 20 * M) > 10 * M) growStreet(P, s, x, s.y - sp * 0.5, -Math.PI / 2, sp * n * 1.2, { w: 192, side: 32, curv: 0.002, wobble: 0.002, minLen: 25, snap: 8 });
        if (P.roadDist(x, s.y, 20 * M) > 10 * M) growStreet(P, s, x, s.y + sp * 0.5, Math.PI / 2, sp * n * 1.2, { w: 192, side: 32, curv: 0.002, wobble: 0.002, minLen: 25, snap: 8 });
        const y = s.y + i * sp;
        if (P.roadDist(s.x, y, 20 * M) > 10 * M) growStreet(P, s, s.x - sp * 0.5, y, Math.PI, sp * n * 1.2, { w: 192, side: 32, curv: 0.002, wobble: 0.002, minLen: 25, snap: 8 });
        if (P.roadDist(s.x, y, 20 * M) > 10 * M) growStreet(P, s, s.x + sp * 0.5, y, 0, sp * n * 1.2, { w: 192, side: 32, curv: 0.002, wobble: 0.002, minLen: 25, snap: 8 });
      }
      yield;
    }
    // ramas irregulares
    const trunks = P.roads.slice().concat(inc.map((i) => i.road));
    for (const t of trunks) {
      for (let sAl = R_(rng, 25, 50); sAl < t.len; sAl += R_(rng, 55, 110)) {
        const p = G.roadAt(t, sAl);
        if (Math.hypot(p.x - s.x, p.y - s.y) > R * 0.9) continue;
        if (!rng.chance(0.55)) continue;
        const side = rng.chance(0.5) ? 1 : -1;
        const a = Math.atan2(p.dx, -p.dy) + (side < 0 ? Math.PI : 0) + rng.range(-0.4, 0.4);
        growStreet(P, s, p.x, p.y, a, R_(rng, 45, 140), { w: 176, side: 32, curv: 0.06, wobble: 0.05, parent: t, culdesac: rng.chance(0.3), minLen: 30 });
      }
      yield;
    }
    yield* coverStreets(P, s, 55 * M, 176, 32);
  }

  function* villageStreets(P, s, inc) {
    const rng = P.rng, R = s.R;
    // si no hay carretera que cruce, se crea un camino local
    if (!inc.length) {
      const a = rng.range(0, 6.28);
      growStreet(P, s, s.x - Math.cos(a) * R, s.y - Math.sin(a) * R, a, R * 2, { w: 176, kind: 'lane', curv: 0.04, minLen: 40, rmax: 1.1 });
    }
    const trunks = inc.map((i) => i.road).concat(P.roads.slice());
    const nb = s.shape === 'radial' ? rng.int(2, 4) : rng.int(1, 3);
    for (let k = 0; k < nb; k++) {
      let x, y, a, parent = null;
      if (s.shape === 'radial' || !trunks.length) {
        a = rng.range(0, 6.28);
        x = s.x + Math.cos(a) * 14 * M; y = s.y + Math.sin(a) * 14 * M;
      } else {
        const t = trunks[Math.floor(rng.next() * trunks.length)];
        const res = {};
        G.roadDist(t, s.x, s.y, res);
        const sAl = U.clamp(res.s + rng.range(-0.6, 0.6) * R, 0, t.len);
        const p = G.roadAt(t, sAl);
        a = Math.atan2(p.dx, -p.dy) + (rng.chance(0.5) ? Math.PI : 0) + rng.range(-0.5, 0.5);
        x = p.x; y = p.y;
        parent = t;
      }
      const dirt = rng.chance(0.5);
      growStreet(P, s, x, y, a, R_(rng, 40, 110), { w: dirt ? 128 : 160, kind: dirt ? 'dirt' : 'lane', curv: 0.07, wobble: 0.06, parent, minLen: 25, rmax: 1.15 });
      yield;
    }
  }

  // ---------- barrios ----------
  function district(P, s, x, y) {
    const d = Math.hypot(x - s.x, y - s.y) / s.R;
    if (s.type === 'village') return d > 0.8 ? 'periphery' : 'residential';
    const a = Math.atan2(y - s.y, x - s.x);
    if (s.ind !== undefined && d > 0.4 && Math.abs(U.angDiff(a, s.ind)) < s.indW) return 'industrial';
    if (d < (s.type === 'metro' ? 0.3 : s.type === 'city' ? 0.3 : 0.38)) return 'center';
    if (d > 0.88) return 'periphery';
    const n = U.noise2(x / (60 * M), y / (60 * M), s.seed);
    if (n > 0.7 && d < 0.8) return 'commercial';
    return 'residential';
  }

  // Elección de lote por barrio
  function pickLot(P, s, dist, nearMain) {
    const rng = P.rng;
    const W = {
      center: { apartments: 0.36, office: 0.2, store: 0.18, bar: 0.08, pharmacy: 0.02, parking: 0.05, empty: 0.04, garage: 0.03, park: 0.03 },
      commercial: { store: 0.22, bar: 0.1, pharmacy: 0.03, hardware: 0.04, garage: 0.1, parking: 0.08, house_s: 0.15, apartments: 0.1, empty: 0.05, office: 0.05 },
      residential: { house_s: 0.45, house_m: 0.34, apartments: 0.05, store: 0.04, empty: 0.04, park: 0.025, garage: 0.025, bar: 0.01 },
      industrial: { warehouse: 0.42, factory: 0.22, containers: 0.12, garage: 0.08, junk: 0.06, empty: 0.06, parking: 0.04 },
      periphery: { house_v: 0.45, farmlot: 0.12, garage: 0.08, empty: 0.15, junk: 0.05, house_s: 0.15 },
    }[dist];
    if (s.type === 'village') { delete W.apartments; }
    if (s.type === 'town' && dist === 'center') { W.apartments = 0.12; W.house_m = 0.2; }
    if (nearMain && dist === 'residential') { W.store += 0.05; W.garage += 0.03; }
    let tot = 0; for (const k in W) tot += W[k];
    let r = rng.next() * tot;
    for (const k in W) { r -= W[k]; if (r <= 0) return k; }
    return 'house_s';
  }
  const BUILD_OF = {
    house_s: (P, lot) => BUILD.house(P, lot, { size: 's' }), house_m: (P, lot) => BUILD.house(P, lot, { size: 'm' }),
    house_v: (P, lot) => BUILD.house(P, lot, { size: 'v' }),
  };
  function build(P, kind, lot) {
    const f = BUILD_OF[kind] || BUILD[kind];
    if (!f) return false;
    const r = f(P, lot, {});
    return r !== false;
  }

  // Intenta poner un lote del tipo kind a lo largo de una carretera
  function tryLotAt(P, s, road, sAl, side, kind, filter, scale) {
    const rng = P.rng;
    const L = LOT[kind === 'house_s' || kind === 'house_m' || kind === 'house_v' ? kind : kind] || LOT.house_s;
    const sc = scale || 1;
    const fw = R_(rng, L[0], L[1]) * sc, dp = R_(rng, L[2], L[3]) * sc;
    const p = G.roadAt(road, sAl);
    const nx = -p.dy * side, ny = p.dx * side;
    for (let k = 0; k < 3; k++) {
      const lot = makeLot(P, road, p, nx, ny, fw, dp, (0.5 + k * 2) * M);
      const cx = lot.x + lot.w / 2, cy = lot.y + lot.h / 2;
      if (filter && !filter(cx, cy, lot)) return null;
      if (P.okRect(lot, 0.4 * M, 6)) {
        P.reserve(lot);
        lot.kind = kind;
        lot.proj = Math.abs(p.dx) * lot.w + Math.abs(p.dy) * lot.h;
        return lot;
      }
    }
    return null;
  }

  function* fillLots(P, s, inc) {
    const rng = P.rng, R = s.R;
    const roads = P.roads.filter((r) => r.kind !== 'ringonly').concat(inc.map((i) => i.road));
    // otras carreteras globales que crucen el área
    for (const r of P.extRoads) if (!roads.includes(r)) roads.push(r);
    const inside = (x, y) => {
      const d = Math.hypot(x - s.x, y - s.y) / R;
      const edge = 1 + 0.18 * (U.noise2(Math.atan2(y - s.y, x - s.x) * 2 + 10, 3.3, s.seed) - 0.5);
      if (d > edge) return false;
      // densidad decreciente en las afueras
      return d < 0.7 || rng.chance(1 - ss(0.7, edge, d) * 0.75);
    };
    // lugares especiales primero (son grandes)
    const pois = [];
    const add = (k, p, n) => { for (let i = 0; i < (n || 1); i++) if (rng.chance(p)) pois.push(k); };
    if (s.type === 'metro') {
      add('hospital', 1, 2); add('police', 1, 2); add('school', 1, 2); add('church', 1, 3); add('supermarket', 1, 3);
      add('sports', 0.6); add('cemetery', 0.8); add('park', 1, 4); add('hardware', 1, 2); add('pharmacy', 1, 4); add('gas', 1, 2);
      add('warehouse', 1, 4); add('factory', 1, 3);
    } else if (s.type === 'city') {
      add('hospital', 0.8); add('police', 0.95); add('school', 0.9); add('church', 0.9, 2); add('supermarket', 1, 2);
      add('sports', 0.4); add('cemetery', 0.6); add('park', 1, 2); add('hardware', 0.9); add('pharmacy', 1, 2); add('gas', 0.9, 2);
      add('warehouse', 0.9, 2); add('factory', 0.6, 2);
    } else if (s.type === 'town') {
      add('clinic', 0.3); add('police', 0.55); add('school', 0.6); add('church', 0.9); add('supermarket', 0.55); add('hardware', 0.5);
      add('pharmacy', 0.8); add('gas', 0.75); add('garage', 0.6); add('cemetery', 0.4); add('sports', 0.3); add('park', 0.5); add('warehouse', 0.4);
    } else {
      add('chapel', 0.4); add('store', 0.55); add('gas', 0.35); add('garage', 0.3); add('farmlot', 0.5, 2); add('cemetery', 0.15); add('bar', 0.25);
    }
    // sector industrial
    if (s.type === 'city' || s.type === 'metro') { s.ind = rng.range(0, 6.28); s.indW = rng.range(0.4, 0.8); }
    const POI_DIST = { warehouse: 'industrial', factory: 'industrial', hospital: null, school: 'residential', park: null, sports: 'residential', cemetery: 'periphery' };
    let k = 0;
    for (const kind of pois) {
      let placed = false;
      // los recintos enormes (hospital, fábrica) casi nunca caben enteros: más intentos y, si no, un solar algo menor
      const big = kind === 'hospital' || kind === 'factory' || kind === 'school';
      const tries = big ? 70 : 40;
      for (let t = 0; t < tries && !placed; t++) {
        if (WG.over()) yield;
        const road = roads[Math.floor(rng.next() * roads.length)];
        if (!road || road.len < 20 * M) continue;
        const sAl = rng.range(0, road.len);
        const want = POI_DIST[kind];
        const lot = tryLotAt(P, s, road, sAl, rng.chance(0.5) ? 1 : -1, kind, (x, y) => {
          if (Math.hypot(x - s.x, y - s.y) > R * 0.95) return false;
          if (want && t < 25 && district(P, s, x, y) !== want && !(want === 'residential' && district(P, s, x, y) === 'periphery')) return false;
          if (kind === 'gas' && road.kind !== 'highway' && road.kind !== 'road' && road.kind !== 'avenue' && t < 30) return false;
          return true;
        }, big ? (t < 25 ? 1 : t < 45 ? 0.85 : 0.72) : 1);
        if (lot) { build(P, kind, lot); placed = true; }
      }
      yield; k++;
    }
    // relleno por fachadas a lo largo de todas las calles
    const order = roads.slice().sort(() => rng.next() - 0.5);
    yield* frontageFill(P, s, order, inside);
    // relleno del interior de las manzanas (centros densos, patios, aparcamientos, naves)
    if (s.type !== 'village') yield* blockInfill(P, s);
  }

  function* blockInfill(P, s) {
    const rng = P.rng, R = s.R;
    const maxD = s.type === 'town' ? 0.5 : 0.85;
    const step = 12 * M;
    let n = 0;
    for (let y = s.y - R * maxD; y < s.y + R * maxD; y += step) {
      for (let x = s.x - R * maxD; x < s.x + R * maxD; x += step) {
        const d = Math.hypot(x - s.x, y - s.y) / R;
        if (d > maxD) continue;
        const dist = district(P, s, x, y);
        const W = {
          center: { apartments: 0.4, office: 0.3, parking: 0.15, empty: 0.1, store: 0.05 },
          commercial: { store: 0.2, warehouse: 0.15, parking: 0.3, empty: 0.2, apartments: 0.15 },
          industrial: { warehouse: 0.45, containers: 0.25, junk: 0.15, factory: 0.15 },
          residential: { house_s: 0.6, park: 0.06, empty: 0.2, garage: 0.14 },
          periphery: { house_v: 0.4, empty: 0.4, junk: 0.2 },
        }[dist];
        if (s.type === 'town' && dist === 'center') Object.assign(W, { apartments: 0.1, office: 0.05, store: 0.3, house_m: 0.3, bar: 0.1 });
        const pFill = dist === 'center' ? 0.9 : dist === 'commercial' || dist === 'industrial' ? 0.7 : s.type === 'town' ? 0.25 : 0.4;
        if (!rng.chance(pFill)) continue;
        let tot = 0; for (const k in W) tot += W[k];
        let r = rng.next() * tot, kind = 'empty';
        for (const k in W) { r -= W[k]; if (r <= 0) { kind = k; break; } }
        const L = LOT[kind] || LOT.empty;
        const fw = R_(rng, L[0], L[1]), dp = R_(rng, L[2], L[3]);
        const q = P.nearestRoadPoint(x, y, 70 * M);
        // sin calle cerca no se construye en zonas residenciales (no quedan casas aisladas en mitad de la manzana)
        if ((dist === 'residential' || dist === 'periphery') && (!q || q.d > 38 * M)) continue;
        let front = 's';
        if (q) { const dx = q.x - x, dy = q.y - y; front = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'e' : 'w') : (dy > 0 ? 's' : 'n'); }
        const horizF = front === 's' || front === 'n';
        const w = horizF ? fw : dp, h = horizF ? dp : fw;
        for (let t = 0; t < 3; t++) {
          const lot = { x: Math.round(x + rng.range(-0.5, 0.5) * step - w / 2), y: Math.round(y + rng.range(-0.5, 0.5) * step - h / 2), w: Math.round(w * (1 - t * 0.2)), h: Math.round(h * (1 - t * 0.2)), front };
          if (P.okRect(lot, 0.8 * M, 2 * M)) { P.reserve(lot); lot.kind = kind; build(P, kind, lot); break; }
        }
        if (WG.over()) yield;
      }
    }
  }

  function* frontageFill(P, s, order, inside) {
    const rng = P.rng;
    let n = 0;
    for (const road of order) {
      for (const side of [1, -1]) {
        let sAl = rng.range(0, 4) * M;
        while (sAl < road.len) {
          const p = G.roadAt(road, sAl);
          if (!inside(p.x, p.y)) { sAl += 6 * M; if (WG.over()) yield; continue; }
          const dist = district(P, s, p.x, p.y);
          const kind = pickLot(P, s, dist, road.kind === 'highway' || road.kind === 'avenue');
          const lot = tryLotAt(P, s, road, sAl, side, s.type === 'village' && (kind === 'house_s' || kind === 'house_m') ? 'house_v' : kind, (x, y) => inside(x, y));
          if (lot) {
            build(P, lot.kind, lot);
            sAl += lot.proj + rng.range(0.5, s.type === 'village' ? 14 : 3) * M;
          } else sAl += 5 * M;
          if (WG.over()) yield;
        }
      }
    }
  }

  // ---------- accesorios de calle e historias ----------
  function* streetProps(P, s, inc) {
    const rng = P.rng, R = s.R;
    const pCar = { village: 0.07, town: 0.13, city: 0.22, metro: 0.3 }[s.type] || 0.1;
    const roads = P.roads.concat(inc.map((i) => i.road));
    let n = 0;
    const carBoxFree = (x, y, rad) => P.rectFree({ x: x - rad, y: y - rad, w: rad * 2, h: rad * 2 }, 0);
    for (const r of roads) {
      if (r.kind === 'dirt') continue;
      for (let sAl = rng.range(0, 8) * M; sAl < r.len; sAl += 8 * M) {
        const p = G.roadAt(r, sAl);
        const d = Math.hypot(p.x - s.x, p.y - s.y);
        if (d > R * 1.02) { if (WG.over()) yield; continue; }
        const ang = Math.atan2(p.dy, p.dx);
        const nx = -p.dy, ny = p.dx;
        // lejos de cruces
        const cross = P.roadDist(p.x, p.y, 16 * M, r);
        if (rng.chance(pCar) && cross > 9 * M) {
          const side = rng.chance(0.5) ? 1 : -1;
          const off = r.w / 2 - 1.3 * M;
          const x = p.x + nx * off * side, y = p.y + ny * off * side;
          if (carBoxFree(x, y, 80)) {
            P.reserve({ x: x - 60, y: y - 60, w: 120, h: 120 });
            P.car(x, y, ang + (rng.chance(0.5) ? 0 : Math.PI) + rng.range(-0.08, 0.08), {});
          }
        }
        if (rng.chance(pCar * 0.12) && cross > 9 * M) {
          // auto cruzado o volcado en medio
          const x = p.x + rng.range(-1, 1) * M, y = p.y + rng.range(-1, 1) * M;
          if (carBoxFree(x, y, 90)) { P.reserve({ x: x - 70, y: y - 70, w: 140, h: 140 }); P.car(x, y, ang + rng.range(0.4, 1.4), { burned: rng.chance(0.5), wreck: true }); }
        }
        // árboles y farolas en aceras
        if (r.side >= 48 && rng.chance(r.kind === 'avenue' ? 0.45 : 0.15) && cross > 6 * M) {
          const side = rng.chance(0.5) ? 1 : -1;
          const off = r.w / 2 + r.side / 2;
          const x = p.x + nx * off * side, y = p.y + ny * off * side;
          if (carBoxFree(x, y, 14)) P.tree(x, y, R_(rng, 2.2, 3.4), { street: true });
        } else if (r.side > 0 && rng.chance(0.18)) {
          const side = rng.chance(0.5) ? 1 : -1;
          const off = r.w / 2 + r.side * 0.7;
          P.decal('lamp', p.x + nx * off * side, p.y + ny * off * side, 1, ang);
        }
        if (rng.chance(0.25)) P.decal(rng.pick(['trash', 'paper', 'crack', 'stain', 'manhole']), p.x + nx * rng.range(-1, 1) * r.w * 0.4, p.y + ny * rng.range(-1, 1) * r.w * 0.4, rng.range(0.8, 1.6), rng.range(0, 6.28));
        if (rng.chance(0.025)) P.decal('body', p.x + nx * rng.range(-1, 1) * r.w * 0.5, p.y + ny * rng.range(-1, 1) * r.w * 0.5, 1, rng.range(0, 6.28));
        if (rng.chance(0.02)) P.decal('bloodtrail', p.x, p.y, 1, rng.range(0, 6.28));
        if ((s.type === 'city' || s.type === 'metro') && rng.chance(0.03) && cross > 8 * M) {
          const side = rng.chance(0.5) ? 1 : -1, off = r.w / 2 - 0.9 * M;
          const x = p.x + nx * off * side, y = p.y + ny * off * side;
          if (carBoxFree(x, y, 40)) { const pr = P.rectProp('dumpster', x - 28, y - 16, 56, 32, {}); if (rng.chance(0.3)) { const c = P.chest(x, y, 'contenedor de basura', 'other'); pr.chestId = c.id; } }
        }
        if (WG.over()) yield;
      }
    }
    // cola de huida en una carretera de salida
    if (inc.length && s.type !== 'village' && rng.chance(0.45)) {
      const it = inc[Math.floor(rng.next() * inc.length)], r = it.road;
      const res = {};
      G.roadDist(r, s.x, s.y, res);
      const out = Math.sign(r.len / 2 - res.s) || 1; // hacia fuera
      const startS = res.s + out * R * rng.range(0.6, 0.85);
      const nCars = rng.int(6, 16);
      for (let i = 0; i < nCars; i++) {
        const sAl = startS + out * i * R_(rng, 6.5, 9);
        if (sAl < 0 || sAl > r.len) break;
        const p = G.roadAt(r, sAl);
        const lane = (rng.chance(0.75) ? 1 : -1) * r.w * 0.24;
        const x = p.x - p.dy * lane, y = p.y + p.dx * lane;
        if (!carBoxFree(x, y, 70)) continue;
        P.reserve({ x: x - 50, y: y - 50, w: 100, h: 100 });
        P.car(x, y, Math.atan2(p.dy, p.dx) + (out > 0 ? 0 : Math.PI) + rng.range(-0.15, 0.15), { burned: rng.chance(0.15), trunkP: 0.7 });
        if (rng.chance(0.3)) P.decal('suitcase', x + rng.range(-60, 60), y + rng.range(-60, 60), 1, rng.range(0, 6));
        if (rng.chance(0.2)) P.decal('body', x + rng.range(-70, 70), y + rng.range(-70, 70), 1, rng.range(0, 6));
      }
    }
    // última resistencia en un cruce cercano al centro
    if (rng.chance(s.type === 'village' ? 0.15 : 0.35)) {
      const a = rng.range(0, 6.28), d = R * rng.range(0.1, 0.5);
      const q = P.nearestRoadPoint(s.x + Math.cos(a) * d, s.y + Math.sin(a) * d, 40 * M);
      if (q) lastStand(P, q.x, q.y, rng.range(5, 8) * M, 'military');
    }
    // control militar en una entrada (ciudades)
    if ((s.type === 'city' || s.type === 'metro') && inc.length && rng.chance(0.4)) {
      const it = inc[Math.floor(rng.next() * inc.length)], r = it.road;
      const res = {};
      G.roadDist(r, s.x, s.y, res);
      const out = Math.sign(r.len / 2 - res.s) || 1;
      const sAl = res.s + out * R * 0.95;
      if (sAl > 0 && sAl < r.len) checkpoint(P, r, sAl);
    }
    // pistas exteriores en el centro y cruces
    for (let i = 0; i < 6; i++) {
      const a = rng.range(0, 6.28), d = R * rng.range(0, 0.8);
      const q = P.nearestRoadPoint(s.x + Math.cos(a) * d, s.y + Math.sin(a) * d, 30 * M);
      if (q) P.hint(q.x, q.y);
    }
  }

  function lastStand(P, x, y, rad, kind) {
    const rng = P.rng;
    const n = rng.int(7, 11);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rng.range(-0.1, 0.1);
      if (rng.chance(0.18)) continue;
      const bx = x + Math.cos(a) * rad, by = y + Math.sin(a) * rad;
      const horiz = Math.abs(Math.cos(a)) < Math.abs(Math.sin(a));
      P.rectProp('sandbag', bx - (horiz ? 26 : 12), by - (horiz ? 12 : 26), horiz ? 52 : 24, horiz ? 24 : 52, { horiz });
    }
    for (let i = 0; i < rng.int(3, 7); i++) P.decal('body', x + rng.range(-1.6, 1.6) * rad, y + rng.range(-1.6, 1.6) * rad, 1, rng.range(0, 6.28));
    for (let i = 0; i < 4; i++) P.decal('casings', x + rng.range(-0.6, 0.6) * rad, y + rng.range(-0.6, 0.6) * rad, 1, 0);
    P.decal('stain', x, y, 2.5, 0);
    P.chest(x + rng.range(-0.3, 0.3) * rad, y + rng.range(-0.3, 0.3) * rad, kind === 'military' ? 'cofre militar' : 'mochila', kind === 'military' ? 'military' : 'other', 1.3);
    P.hint(x, y);
    if (rng.chance(0.5)) P.decal('text', x, y - rad - 40, 1, 0, { text: rng.pick(['AQUÍ CAYERON', 'NO HAY RESCATE', 'AL NORTE', 'PERDÓN']), color: 'rgba(220,210,190,0.6)', size: 14 });
  }
  function checkpoint(P, r, sAl) {
    const rng = P.rng;
    const p = G.roadAt(r, sAl);
    const nx = -p.dy, ny = p.dx;
    // barrera de sacos atravesando la carretera con un hueco
    const half = r.w / 2 + 2 * M;
    for (let t = -half; t <= half; t += 52) {
      if (Math.abs(t) < 50) continue;
      const x = p.x + nx * t, y = p.y + ny * t;
      if (!P.rectFree({ x: x - 26, y: y - 26, w: 52, h: 52 }, 0)) continue;
      P.rectProp('sandbag', x - 26, y - 12, 52, 24, { horiz: true });
    }
    for (let i = 0; i < 2; i++) {
      const off = (i ? 1 : -1) * (r.w / 2 + 6 * M);
      const x = p.x + nx * off + p.dx * 4 * M, y = p.y + ny * off + p.dy * 4 * M;
      if (P.rectFree({ x: x - 100, y: y - 100, w: 200, h: 200 }, 0)) P.car(x, y, Math.atan2(p.dy, p.dx), { kind: 'military', L: 230, W: 84, color: '#3e4632', btype: 'military', container: 'cofre militar', boost: 1.5 });
    }
    const tx = p.x + nx * (r.w / 2 + 6 * M) - p.dx * 6 * M, ty = p.y + ny * (r.w / 2 + 6 * M) - p.dy * 6 * M;
    if (P.rectFree({ x: tx - 60, y: ty - 50, w: 120, h: 100 }, 0)) P.rectProp('tent', tx - 55, ty - 45, 110, 90, { color: '#3e4632' }, true);
    for (let i = 0; i < rng.int(2, 6); i++) P.decal('body', p.x + rng.range(-8, 8) * M, p.y + rng.range(-8, 8) * M, 1, rng.range(0, 6));
    P.decal('text', p.x - p.dx * 9 * M, p.y - p.dy * 9 * M, 1, 0, { text: 'ZONA EN CUARENTENA', color: 'rgba(200,170,60,0.7)', size: 16 });
    P.chest(tx, ty + 70, 'cofre militar', 'military', 1.4);
    P.hint(p.x, p.y);
  }

  // Precalcula poco a poco las aristas (carreteras globales) de las celdas del rectángulo
  function* warmEdges(world, x0, y0, x1, y1) {
    const Mc = world.macro;
    for (let j = Mc.cellOf(y0) - 1; j <= Mc.cellOf(y1) + 1; j++) {
      for (let i = Mc.cellOf(x0) - 1; i <= Mc.cellOf(x1) + 1; i++) {
        const k0 = i + ',' + j + ',0', k1 = i + ',' + j + ',1';
        if (Mc.edges.has(k0) && Mc.edges.has(k1)) continue;
        Mc.edge(i, j, 0); Mc.edge(i, j, 1);
        yield;
      }
    }
  }
  WG.warmEdges = warmEdges;

  // ---------- plan completo de un asentamiento ----------
  WG.Settle = {
    LOT, BUILD, inLot, frontPt, lotFence, lastStand, checkpoint, growStreet, storyBuilding,
    * plan(world, s) {
      const P = new WG.Plan(world, s.key, 'settlement', s.seed);
      P.site = s; P.danger = s.danger;
      const R = s.R;
      P.grow(s.x - R, s.y - R, s.x + R, s.y + R);
      yield* P.dryScan();
      // carreteras globales cercanas (no se dibujan aquí)
      yield* warmEdges(world, s.x - R * 1.3, s.y - R * 1.3, s.x + R * 1.3, s.y + R * 1.3);
      P.extRoads = world.macro.roadsInRect(s.x - R * 1.3, s.y - R * 1.3, s.x + R * 1.3, s.y + R * 1.3, []);
      for (const r of P.extRoads) P.addRoad(r, false);
      // carreteras que llegan al centro: dirección desde el centro
      const inc = [];
      for (const e of [world.macro.edge(s.i, s.j, 0), world.macro.edge(s.i, s.j, 1), world.macro.edge(s.i - 1, s.j, 0), world.macro.edge(s.i, s.j - 1, 1)]) {
        if (!e) continue;
        const atA = e.A === s;
        for (const r of e.roads) {
          const res = {};
          const d = G.roadDist(r, s.x, s.y, res);
          if (d > R) continue;
          const pt = G.roadAt(r, U.clamp(res.s + (atA ? 1 : -1) * 30 * M, 0, r.len));
          inc.push({ road: r, angle: Math.atan2(pt.y - s.y, pt.x - s.x), edge: e });
        }
      }
      yield;
      centerRing(P, s);
      if (s.type === 'village') yield* villageStreets(P, s, inc);
      else if (s.type === 'town') yield* townStreets(P, s, inc);
      else yield* cityStreets(P, s, inc);
      yield* fillLots(P, s, inc);
      yield* streetProps(P, s, inc);
      P.done = true;
      return P;
    },
  };
})();
