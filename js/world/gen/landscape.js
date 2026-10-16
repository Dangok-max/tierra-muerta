// Paisaje por chunk: árboles, rocas, crestas rocosas, troncos caídos, matorrales y restos sueltos. TM.WG.Land
(function () {
  const U = TM.U;
  const WG = TM.WG = TM.WG || {};
  const G = WG.G;
  const M = 32;

  // Rejilla de campos de cultivo (48 m) en tierras de labranza
  const FIELD = 48 * M;
  WG.fieldCell = function (seed, i, j) {
    const h = G.hash(i, j, 77, seed);
    return { x: i * FIELD, y: j * FIELD, w: FIELD, h: FIELD, rot: h < 0.5 ? 0 : 1, dead: G.hash(i, j, 78, seed) < 0.6, fallow: G.hash(i, j, 79, seed) < 0.18 };
  };
  WG.FIELD = FIELD;

  WG.Land = {
    // ch: chunk con .roads (lista), .excl (rectángulos ocupados); añade a ch.props / ch.obs / ch.decor
    populate(world, ch) {
      const T = world.terrain;
      const CH = TM.Config.CHUNK;
      const x0 = ch.x0, y0 = ch.y0;
      const rng = new U.RNG(Math.floor(U.hash2(ch.cx, ch.cy, world.seed + 31) * 4294967295) || 1);
      const safe = TM.Config.SAFE_RADIUS + 120;
      const W = {};
      // urbanización: menos naturaleza dentro de pueblos y ciudades
      const S = world.macro.settlementAt(x0 + CH / 2, y0 + CH / 2);
      let urban = 0;
      if (S) {
        const d = Math.hypot(x0 + CH / 2 - S.x, y0 + CH / 2 - S.y) / S.R;
        urban = (S.type === 'village' ? 0.5 : 0.92) * (1 - U.smoothstep(0.75, 1.05, d));
      }
      const placed = [];
      const okAt = (x, y, r, pad) => {
        if (x - r < x0 + 1 || y - r < y0 + 1 || x + r > x0 + CH - 1 || y + r > y0 + CH - 1) return false;
        if (x * x + y * y < safe * safe) return false;
        for (const e of ch.excl) if (x + r + pad > e.x && x - r - pad < e.x + e.w && y + r + pad > e.y && y - r - pad < e.y + e.h) return false;
        for (const rd of ch.roads) {
          const b = rd.bbox;
          if (x < b.x0 - r || x > b.x1 + r || y < b.y0 - r || y > b.y1 + r) continue;
          if (G.roadDist(rd, x, y) < rd.w / 2 + (rd.side || 0) + r + pad) return false;
        }
        for (const p of placed) if ((p.x - x) * (p.x - x) + (p.y - y) * (p.y - y) < (p.r + r + pad) * (p.r + r + pad)) return false;
        if (T.kindAt(x, y) !== 0 || T.kindAt(x + r + 8, y) !== 0 || T.kindAt(x - r - 8, y) !== 0 || T.kindAt(x, y + r + 8) !== 0 || T.kindAt(x, y - r - 8) !== 0) return false;
        return true;
      };
      const addCircle = (kind, x, y, r, extra, bs) => {
        const o = { shape: 'circle', kind, cx: x, cy: y, r, blocksSight: !!bs };
        const p = Object.assign({ kind, x, y, r, seed: rng.int(1, 2e9), land: true, obs: [o], ext: (extra && extra.crown) || r + 20 }, extra || {});
        o.prop = p;
        ch.props.push(p); ch.obs.push(o);
        placed.push({ x, y, r });
        return p;
      };
      const decor = (kind, x, y, s, rot, extra) => ch.decor.push(Object.assign({ kind, x, y, s: s || 1, rot: rot || 0, seed: rng.int(1, 2e9), land: true }, extra || {}));

      const N = 14;
      for (let i = 0; i < N; i++) {
        const x = x0 + rng.range(20, CH - 20), y = y0 + rng.range(20, CH - 20);
        T.weights(x, y, W);
        const burn = T.burn(x, y);
        const nat = 1 - urban;
        const pTree = (0.5 * W.forest + 0.22 * W.swamp + 0.025 * W.plains + 0.015 * W.farmland + 0.004 * W.desert) * nat;
        const pRock = (0.1 * W.desert + 0.03 * W.plains + 0.04 * W.forest) * nat;
        const k = rng.next();
        if (k < pTree) {
          const crown = rng.range(64, 128) * (W.swamp > 0.5 ? 0.8 : 1);
          const r = crown * rng.range(0.09, 0.13);
          if (okAt(x, y, r, 30)) addCircle('tree', x, y, r, { crown, branches: rng.int(5, 8), burned: burn > 0.3, swamp: W.swamp > 0.5 });
        } else if (k < pTree + pRock) {
          const big = rng.chance(0.25);
          const r = big ? rng.range(28, 52) : rng.range(12, 24);
          if (okAt(x, y, r, 10)) addCircle('rock', x, y, r, { desert: W.desert > 0.5 }, big);
        } else if (k < pTree + pRock + 0.08 * W.forest * nat) {
          // tronco caído (rectángulo alineado)
          const horiz = rng.chance(0.5), L = rng.range(90, 170);
          const w = horiz ? L : 20, h = horiz ? 20 : L;
          if (okAt(x, y, Math.max(w, h) / 2, 6)) {
            const o = { shape: 'rect', kind: 'log', x: x - w / 2, y: y - h / 2, w, h, blocksSight: false };
            const p = { kind: 'log', x, y, w, h, horiz, seed: rng.int(1, 2e9), land: true, obs: [o], ext: L / 2 + 10 };
            o.prop = p; ch.props.push(p); ch.obs.push(o); placed.push({ x, y, r: Math.max(w, h) / 2 });
          }
        }
      }
      // crestas rocosas en zonas áridas y llanas
      const rx = x0 + CH / 2, ry = y0 + CH / 2;
      T.weights(rx, ry, W);
      if ((W.desert + W.plains) * (1 - urban) > 0.5) {
        const n = U.fbm(rx / 9000 + 3, ry / 9000 - 7, world.seed + 501, 3);
        if (Math.abs(n - 0.5) < 0.018) {
          for (let i = 0; i < 6; i++) {
            const x = x0 + rng.range(40, CH - 40), y = y0 + rng.range(40, CH - 40), r = rng.range(36, 64);
            if (okAt(x, y, r, 4)) addCircle('rock', x, y, r, { desert: W.desert > 0.5, ridge: true }, true);
          }
        }
      }
      // decorado suelto
      for (let i = 0; i < 18; i++) {
        const x = x0 + rng.range(8, CH - 8), y = y0 + rng.range(8, CH - 8);
        if (x * x + y * y < (safe * 0.7) * (safe * 0.7)) continue;
        if (ch.water && T.kindAt(x, y) !== 0) continue;
        T.weights(x, y, W);
        const r = rng.next();
        let kind;
        if (r < W.forest) kind = rng.pick(['shrub', 'leaves', 'leaves', 'grass', 'shrub']);
        else if (r < W.forest + W.plains) kind = rng.pick(['grass', 'grass', 'deadshrub', 'shrub']);
        else if (r < W.forest + W.plains + W.farmland) kind = rng.pick(['grass', 'deadshrub', 'stain']);
        else if (r < W.forest + W.plains + W.farmland + W.desert) kind = rng.pick(['crack', 'deadshrub', 'pebbles']);
        else kind = rng.pick(['reeds', 'puddle', 'reeds', 'grass']);
        if (urban > 0.5 && rng.chance(urban)) kind = rng.pick(['trash', 'paper', 'rubble', 'stain']);
        if (T.burn(x, y) > 0.3) kind = rng.pick(['ash', 'ash', 'crack']);
        decor(kind, x, y, rng.range(0.7, 1.5), rng.range(0, 6.28));
      }
      // restos raros en la naturaleza
      const wild = 1 - urban;
      if (rng.chance(0.025 * wild)) decor('bones', x0 + rng.range(40, CH - 40), y0 + rng.range(40, CH - 40), 1, rng.range(0, 6));
      if (rng.chance(0.012 * wild)) decor('body', x0 + rng.range(40, CH - 40), y0 + rng.range(40, CH - 40), 1, rng.range(0, 6));
    },
  };
})();
