// Planificación a gran escala: sitios de asentamiento, carreteras entre ellos, granjas y hallazgos raros. TM.WG.Macro
(function () {
  const U = TM.U;
  const WG = TM.WG = TM.WG || {};
  const G = WG.G;
  const M = 32;
  const ss = U.smoothstep;

  const RANK = { none: 0, village: 1, special: 1, town: 2, city: 3, metro: 4 };
  const DANGER_BONUS = { none: 0, village: 0.1, town: 0.3, city: 0.7, metro: 1.6, special: 0.6 };
  const SPECIALS = ['military', 'prison', 'airfield', 'industrial'];

  class Macro {
    constructor(seed, terrain) {
      this.seed = seed | 0;
      this.terrain = terrain;
      const W = TM.Config.WORLD;
      this.SITE = W.SITE; this.FARM = W.FARM; this.RARE = W.RARE;
      this.bases = new Map(); this.sites = new Map(); this.edges = new Map();
      this.farms = new Map(); this.rares = new Map(); this.cand = new Map();
    }
    h(a, b, c) { return G.hash(a, b, c, this.seed); }
    cellOf(x) { return Math.floor((x + this.SITE / 2) / this.SITE); }
    baseDanger(x, y) { return Math.hypot(x, y) / TM.Config.DANGER_DIST; }

    // ---------- sitios principales ----------
    metroCand(i, j) {
      const k = i + ',' + j;
      let v = this.cand.get(k);
      if (v !== undefined) return v;
      const dB = this.baseDanger(i * this.SITE, j * this.SITE);
      v = -1;
      if (dB > TM.Config.WORLD.METRO_MIN_DANGER && this.h(i, j, 101) < TM.Config.WORLD.METRO_P) v = this.h(i, j, 102);
      this.cand.set(k, v);
      return v;
    }
    isMetro(i, j) {
      const c = this.metroCand(i, j);
      if (c < 0) return false;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if ((dx || dy) && this.metroCand(i + dx, j + dy) > c) return false;
      }
      return true;
    }
    // Tipo elegido por sorteo ponderado según la distancia (sin reglas de vecindad)
    rawType(i, j) {
      if (i === 0 && j === 0) return 'village';
      const S = this.SITE;
      const x = i * S - S / 2 + S * (0.25 + 0.5 * this.h(i, j, 1)), y = j * S - S / 2 + S * (0.25 + 0.5 * this.h(i, j, 2));
      const dB = this.baseDanger(x, y);
      const ring1 = Math.abs(i) <= 1 && Math.abs(j) <= 1;
      const w = {
        none: 0.22,
        village: U.clamp(0.42 - 0.07 * dB, 0.08, 0.42),
        town: U.clamp(0.18 + 0.05 * dB, 0, 0.36),
        city: ring1 ? 0 : (dB < 1.6 ? 0.03 : U.clamp(0.06 + 0.05 * dB, 0, 0.3)),
        special: ring1 ? 0 : 0.09,
      };
      let tot = 0; for (const t in w) tot += w[t];
      let r = this.h(i, j, 4) * tot;
      for (const t in w) { r -= w[t]; if (r <= 0) return t; }
      return 'none';
    }
    siteBase(i, j) {
      const k = i + ',' + j;
      let s = this.bases.get(k);
      if (s) return s;
      const S = this.SITE;
      const ox = i * S - S / 2, oy = j * S - S / 2;
      let x = ox + S * (0.25 + 0.5 * this.h(i, j, 1)), y = oy + S * (0.25 + 0.5 * this.h(i, j, 2));
      let type = 'none', sub = null;
      const dB = this.baseDanger(x, y);
      if (i === 0 && j === 0) {
        // aldea cercana al campamento inicial
        const a = this.h(0, 0, 3) * Math.PI * 2;
        x = Math.cos(a) * 5600; y = Math.sin(a) * 5600;
        type = 'village';
      } else if (this.isMetro(i, j)) {
        type = 'metro';
      } else {
        let nearMetro = false;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && this.isMetro(i + dx, j + dy)) nearMetro = true;
        if (!nearMetro) {
          type = this.rawType(i, j);
          // dos ciudades no pueden ser vecinas: la de menor prioridad queda en pueblo
          if (type === 'city') {
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
              if ((dx || dy) && this.rawType(i + dx, j + dy) === 'city' && this.h(i + dx, j + dy, 4) > this.h(i, j, 4)) type = 'town';
            }
          }
          if (type === 'special') sub = SPECIALS[Math.floor(this.h(i, j, 5) * SPECIALS.length)];
        }
      }
      // los asentamientos evitan el agua: se desplaza el centro si cae en el agua
      if (type !== 'none' && this.terrain.blocked(x, y)) {
        let moved = false;
        for (let d = 1600; d <= 6400 && !moved; d += 1600) {
          for (let a = 0; a < 8; a++) {
            const px = x + Math.cos(a * 0.785) * d, py = y + Math.sin(a * 0.785) * d;
            if (!this.terrain.blocked(px, py)) { x = px; y = py; moved = true; break; }
          }
        }
      }
      s = { i, j, key: 's' + i + '_' + j, type, sub, x, y, rank: RANK[type], dB };
      this.bases.set(k, s);
      return s;
    }
    // Radio deseado (antes de repartir el espacio con los vecinos)
    desiredR(i, j) {
      const s = this.siteBase(i, j);
      const r = (a, b) => (a + (b - a) * this.h(i, j, 6)) * M;
      switch (s.type) {
        case 'village': return r(70, 150);
        case 'town': return r(120, 200);
        case 'city': return r(220, 340);
        case 'metro': return r(430, 600);
        case 'special': return r(70, 110);
      }
      return 0;
    }
    site(i, j) {
      const k = i + ',' + j;
      let s = this.sites.get(k);
      if (s) return s;
      s = this.siteBase(i, j);
      const Rd = this.desiredR(i, j);
      let R = Rd;
      if (R > 0) {
        // el espacio entre dos vecinos se reparte según sus tamaños deseados
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          if (!dx && !dy) continue;
          const n = this.siteBase(i + dx, j + dy);
          if (n.type === 'none') continue;
          const rn = this.desiredR(i + dx, j + dy);
          const d = Math.hypot(n.x - s.x, n.y - s.y);
          R = Math.min(R, d * 0.9 * Rd / (Rd + rn));
        }
      }
      s.R = R;
      // forma: alargada a lo largo de la carretera, en un cruce, radial
      s.shape = s.type === 'village' ? (this.h(i, j, 7) < 0.55 ? 'long' : this.h(i, j, 7) < 0.8 ? 'cross' : 'radial') : 'radial';
      if (i === 0 && j === 0) R = Math.min(R, Math.hypot(s.x, s.y) - 1700);
      s.R = R;
      s.danger = s.dB + DANGER_BONUS[s.type];
      s.seed = Math.floor(this.h(i, j, 8) * 1e9);
      // anillo central: plaza cuadrada (pueblos) o rotonda (ciudades)
      s.ring = 0; s.ringShape = null;
      const hr = this.h(i, j, 9);
      if (s.type === 'town' && hr < 0.5) { s.ring = (20 + 6 * this.h(i, j, 10)) * M; s.ringShape = 'square'; }
      else if ((s.type === 'city' && hr < 0.55) || s.type === 'metro') { s.ring = (18 + 8 * this.h(i, j, 10)) * M; s.ringShape = hr < 0.2 && s.type === 'city' ? 'square' : 'circle'; }
      this.sites.set(k, s);
      return s;
    }

    // Sitios cercanos a un punto (para el peligro, lugar y planes)
    sitesAround(x, y, ring, out) {
      out = out || [];
      const ci = this.cellOf(x), cj = this.cellOf(y);
      for (let dj = -ring; dj <= ring; dj++) for (let di = -ring; di <= ring; di++) out.push(this.site(ci + di, cj + dj));
      return out;
    }
    settlementAt(x, y) {
      let best = null, bv = 1;
      const list = this.sitesAround(x, y, 2, this._sa || (this._sa = []));
      for (const s of list) {
        if (s.type === 'none') continue;
        const v = Math.hypot(x - s.x, y - s.y) / (s.R * 1.05);
        if (v < bv) { bv = v; best = s; }
      }
      list.length = 0;
      return best;
    }
    dangerBonus(x, y) {
      let b = 0;
      const list = this.sitesAround(x, y, 2, this._sb || (this._sb = []));
      for (const s of list) {
        if (s.type === 'none') continue;
        const d = Math.hypot(x - s.x, y - s.y);
        b = Math.max(b, DANGER_BONUS[s.type] * (1 - ss(s.R * 0.7, s.R * 1.2, d)));
      }
      list.length = 0;
      return b;
    }

    // ---------- carreteras entre sitios ----------
    edgeBaseOn(i, j, dir) {
      const a = this.siteBase(i, j), b = dir === 0 ? this.siteBase(i + 1, j) : this.siteBase(i, j + 1);
      if (a.type === 'metro' || b.type === 'metro') return true;
      const touchesOrigin = (i === 0 && j === 0) || (dir === 0 && i === -1 && j === 0) || (dir === 1 && i === 0 && j === -1);
      const n = (a.rank > 0) + (b.rank > 0);
      const p = touchesOrigin ? 0.92 : n === 2 ? 0.85 : n === 1 ? 0.6 : 0.4;
      return this.h(i * 2 + dir, j, 21) < p;
    }
    // aristas de un sitio: [E, S, W, N] como (i, j, dir)
    siteEdges(i, j) { return [[i, j, 0], [i, j, 1], [i - 1, j, 0], [i, j - 1, 1]]; }
    needsForce(i, j) {
      for (const e of this.siteEdges(i, j)) if (this.edgeBaseOn(e[0], e[1], e[2])) return null;
      let best = null, bv = -1;
      for (const e of this.siteEdges(i, j)) { const v = this.h(e[0] * 2 + e[2], e[1], 22); if (v > bv) { bv = v; best = e; } }
      return best;
    }
    edgeExists(i, j, dir) {
      if (this.edgeBaseOn(i, j, dir)) return true;
      const same = (e) => e && e[0] === i && e[1] === j && e[2] === dir;
      if (same(this.needsForce(i, j))) return true;
      const bi = dir === 0 ? i + 1 : i, bj = dir === 0 ? j : j + 1;
      return same(this.needsForce(bi, bj));
    }
    // Devuelve la arista (con sus tramos de carretera) o null
    edge(i, j, dir) {
      const k = i + ',' + j + ',' + dir;
      if (this.edges.has(k)) return this.edges.get(k);
      let e = null;
      if (this.edgeExists(i, j, dir)) e = this.buildEdge(i, j, dir);
      this.edges.set(k, e);
      return e;
    }
    buildEdge(i, j, dir) {
      const A = this.site(i, j), B = dir === 0 ? this.site(i + 1, j) : this.site(i, j + 1);
      const rng = G.rng(i * 2 + dir, j, 31, this.seed);
      const dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy);
      const px = -dy / L, py = dx / L;
      const cp = [A.x, A.y];
      const nMid = 3;
      for (let k = 1; k <= nMid; k++) {
        const t = k / (nMid + 1) + rng.range(-0.05, 0.05);
        const off = rng.range(-0.16, 0.16) * L;
        cp.push(A.x + dx * t + px * off, A.y + dy * t + py * off);
      }
      cp.push(B.x, B.y);
      let pts = G.catmull(cp, Math.max(3, Math.round(L / (24 * M) / (nMid + 1))));
      // rodear el campamento inicial
      const AV = TM.Config.SAFE_RADIUS + 60 * M;
      for (let k = 0; k < pts.length; k += 2) {
        const d = Math.hypot(pts[k], pts[k + 1]);
        if (d < AV) {
          const f = d > 1 ? AV / d : 1;
          pts[k] = d > 1 ? pts[k] * f : AV; pts[k + 1] *= f;
        }
      }
      // las carreteras terminan en el anillo central (rotonda o plaza)
      const inRing = (S, x, y) => S.ring && (S.ringShape === 'square' ? Math.max(Math.abs(x - S.x), Math.abs(y - S.y)) < S.ring : Math.hypot(x - S.x, y - S.y) < S.ring);
      const trimStart = (p, S) => {
        if (!S.ring) return p;
        let k = 0;
        while (k < p.length - 2 && inRing(S, p[k], p[k + 1])) k += 2;
        if (k === 0) return p;
        // bisección sobre el segmento que cruza el borde
        let ax = p[k - 2], ay = p[k - 1], bx = p[k], by = p[k + 1];
        for (let it = 0; it < 12; it++) { const mx = (ax + bx) / 2, my = (ay + by) / 2; if (inRing(S, mx, my)) { ax = mx; ay = my; } else { bx = mx; by = my; } }
        return [ax, ay].concat(p.slice(k));
      };
      pts = trimStart(pts, A);
      const rev = [];
      for (let k = pts.length - 2; k >= 0; k -= 2) rev.push(pts[k], pts[k + 1]);
      const rt = trimStart(rev, B);
      pts = [];
      for (let k = rt.length - 2; k >= 0; k -= 2) pts.push(rt[k], rt[k + 1]);
      const rmin = Math.min(A.rank, B.rank), rmax = Math.max(A.rank, B.rank);
      let kind = 'road';
      if (rmin >= 2 || (rmax >= 3 && rng.chance(0.5))) kind = 'highway';
      else if (rmin === 0 && rmax <= 1 && rng.chance(0.5)) kind = 'dirt';
      const w = kind === 'highway' ? 288 : kind === 'road' ? 224 : 128;
      const e = { i, j, dir, A, B, kind, w, key: 'e' + i + '_' + j + '_' + dir, collapsed: rng.chance(0.14), seed: rng.int(1, 1e9) };
      // tramos: urbano (con aceras) cerca de pueblos y ciudades, rural en medio
      const urbA = A.rank >= 2 ? A.R * 0.92 : 0, urbB = B.rank >= 2 ? B.R * 0.92 : 0;
      const parts = [];
      let cur = [pts[0], pts[1]], curUrb = urbA > 0;
      const isUrb = (x, y) => (urbA > 0 && Math.hypot(x - A.x, y - A.y) < urbA) || (urbB > 0 && Math.hypot(x - B.x, y - B.y) < urbB);
      for (let k = 2; k < pts.length; k += 2) {
        const u = isUrb(pts[k], pts[k + 1]);
        cur.push(pts[k], pts[k + 1]);
        if (u !== curUrb) {
          parts.push({ pts: cur, urb: curUrb });
          cur = [pts[k], pts[k + 1]]; curUrb = u;
        }
      }
      if (cur.length >= 4) parts.push({ pts: cur, urb: curUrb });
      e.roads = parts.map((p) => G.makeRoad(p.pts, w, kind, { side: p.urb ? 64 : 0, edge: e, urban: p.urb, collapsed: !p.urb && e.collapsed }));
      e.full = G.makeRoad(pts, w, kind, { edge: e });
      e.bbox = e.full.bbox;
      return e;
    }
    // Aristas cuya caja toca el rectángulo
    edgesInRect(x0, y0, x1, y1, out) {
      out = out || [];
      const c0 = this.cellOf(x0) - 1, c1 = this.cellOf(x1) + 1, r0 = this.cellOf(y0) - 1, r1 = this.cellOf(y1) + 1;
      for (let j = r0; j <= r1; j++) for (let i = c0; i <= c1; i++) {
        for (let dir = 0; dir < 2; dir++) {
          const e = this.edge(i, j, dir);
          if (!e) continue;
          const b = e.bbox;
          if (b.x1 < x0 || b.x0 > x1 || b.y1 < y0 || b.y0 > y1) continue;
          out.push(e);
        }
      }
      return out;
    }
    // Carreteras (tramos) que tocan el rectángulo
    roadsInRect(x0, y0, x1, y1, out) {
      out = out || [];
      const es = this.edgesInRect(x0, y0, x1, y1, this._er || (this._er = []));
      for (const e of es) for (const r of e.roads) {
        const b = r.bbox;
        if (b.x1 < x0 || b.x0 > x1 || b.y1 < y0 || b.y0 > y1) continue;
        out.push(r);
      }
      es.length = 0;
      return out;
    }
    // Punto más cercano de una carretera (dentro de maxD) o null
    nearestRoad(x, y, maxD) {
      const rs = this.roadsInRect(x - maxD, y - maxD, x + maxD, y + maxD, []);
      let best = null, bd = maxD;
      const res = {};
      for (const r of rs) {
        const d = G.roadDist(r, x, y, res);
        if (d < bd) { bd = d; best = { road: r, d, s: res.s }; }
      }
      if (best) { const p = G.roadAt(best.road, best.s); best.x = p.x; best.y = p.y; best.dx = p.dx; best.dy = p.dy; }
      return best;
    }

    // ---------- granjas (rejilla de 128 m) ----------
    farm(i, j) {
      const k = i + ',' + j;
      if (this.farms.has(k)) return this.farms.get(k);
      const F = this.FARM;
      let f = null;
      const x = i * F + F * (0.3 + 0.4 * this.h(i, j, 41)), y = j * F + F * (0.3 + 0.4 * this.h(i, j, 42));
      // granja garantizada cerca del campamento, en el lado opuesto a la aldea
      const v = this.siteBase(0, 0);
      const fi = v.x > 0 ? -1 : 0, fj = v.y > 0 ? -1 : 0;
      const forced = i === fi && j === fj;
      const w = this.terrain.weights(x, y, {});
      const p = forced ? 1 : 0.3 * w.farmland + 0.14 * w.plains + 0.06 * w.forest + 0.05 * w.desert + 0.04 * w.swamp;
      let ok = this.h(i, j, 43) < p && Math.hypot(x, y) > TM.Config.SAFE_RADIUS + 1100 && !this.terrain.blocked(x, y);
      if (ok && !forced) {
        const list = this.sitesAround(x, y, 2, []);
        for (const s of list) if (s.type !== 'none' && Math.hypot(x - s.x, y - s.y) < s.R * 1.12 + 50 * M) ok = false;
      }
      if (ok) {
        let type = 'farm';
        if (w.forest > 0.55) type = this.h(i, j, 44) < 0.7 ? 'cabin' : 'farm';
        else if (w.desert > 0.55) type = 'ranch';
        else if (w.swamp > 0.5) type = 'shack';
        f = { kind: 'farm', type, i, j, x, y, key: 'f' + i + '_' + j, seed: Math.floor(this.h(i, j, 45) * 1e9), dB: this.baseDanger(x, y) };
        f.R = (type === 'farm' ? 46 : type === 'ranch' ? 40 : 22) * M;
      }
      this.farms.set(k, f);
      return f;
    }

    // ---------- hallazgos raros (rejilla de 256 m) ----------
    rare(i, j) {
      const k = i + ',' + j;
      if (this.rares.has(k)) return this.rares.get(k);
      const RR = this.RARE;
      let r = null;
      const x = i * RR + RR * (0.2 + 0.6 * this.h(i, j, 61)), y = j * RR + RR * (0.2 + 0.6 * this.h(i, j, 62));
      const dB = this.baseDanger(x, y);
      const p = TM.Config.WORLD.RARE_P * U.clamp(0.4 + dB * 0.3, 0, 1.6);
      if (this.h(i, j, 63) < p && Math.hypot(x, y) > 2600 && !this.terrain.blocked(x, y)) {
        let ok = true;
        const list = this.sitesAround(x, y, 2, []);
        for (const s of list) if (s.type !== 'none' && Math.hypot(x - s.x, y - s.y) < s.R * 1.05 + 30 * M) ok = false;
        // no encima de granjas
        const F = this.FARM;
        for (let dj = -1; dj <= 1 && ok; dj++) for (let di = -1; di <= 1 && ok; di++) {
          const f = this.farm(Math.floor(x / F) + di, Math.floor(y / F) + dj);
          if (f && Math.hypot(f.x - x, f.y - y) < f.R + 40 * M) ok = false;
        }
        if (ok) {
          const types = ['bunker', 'crash', 'convoy', 'hideout', 'lab', 'pileup', 'laststand'];
          const wts = [1, 1, 1.1, 1.3, 0.6, 1.1, 1];
          let tot = 0; for (const t of wts) tot += t;
          let q = this.h(i, j, 64) * tot, type = types[0];
          for (let n = 0; n < types.length; n++) { q -= wts[n]; if (q <= 0) { type = types[n]; break; } }
          r = { kind: 'rare', type, i, j, x, y, key: 'r' + i + '_' + j, seed: Math.floor(this.h(i, j, 65) * 1e9), dB };
          if (type === 'convoy' || type === 'pileup') {
            const nr = this.nearestRoad(x, y, 110 * M);
            if (nr && !nr.road.urban) { r.x = nr.x; r.y = nr.y; r.road = nr; }
            else r.type = this.h(i, j, 66) < 0.5 ? 'hideout' : 'laststand';
          }
          r.R = 40 * M;
          r.danger = dB + (type === 'lab' ? 1 : type === 'bunker' ? 0.5 : 0.3);
        }
      }
      this.rares.set(k, r);
      return r;
    }

    // Lista de planes (asentamientos, granjas, raros, aristas) que pueden tocar un rectángulo
    plansInRect(x0, y0, x1, y1, out) {
      out = out || [];
      const ring = 2;
      const c0 = this.cellOf(x0), c1 = this.cellOf(x1), r0 = this.cellOf(y0), r1 = this.cellOf(y1);
      for (let j = r0 - ring; j <= r1 + ring; j++) for (let i = c0 - ring; i <= c1 + ring; i++) {
        const s = this.site(i, j);
        if (s.type === 'none') continue;
        const pad = s.R * 1.15 + 60 * M;
        if (s.x + pad < x0 || s.x - pad > x1 || s.y + pad < y0 || s.y - pad > y1) continue;
        out.push(s);
      }
      const F = this.FARM;
      for (let j = Math.floor(y0 / F) - 1; j <= Math.floor(y1 / F) + 1; j++) for (let i = Math.floor(x0 / F) - 1; i <= Math.floor(x1 / F) + 1; i++) {
        const f = this.farm(i, j);
        if (!f) continue;
        const pad = f.R * 2.2 + 140 * M; // incluye el camino de acceso
        if (f.x + pad < x0 || f.x - pad > x1 || f.y + pad < y0 || f.y - pad > y1) continue;
        out.push(f);
      }
      const RR = this.RARE;
      for (let j = Math.floor(y0 / RR) - 1; j <= Math.floor(y1 / RR) + 1; j++) for (let i = Math.floor(x0 / RR) - 1; i <= Math.floor(x1 / RR) + 1; i++) {
        const r = this.rare(i, j);
        if (!r) continue;
        const pad = r.R * 2;
        if (r.x + pad < x0 || r.x - pad > x1 || r.y + pad < y0 || r.y - pad > y1) continue;
        out.push(r);
      }
      const es = this.edgesInRect(x0, y0, x1, y1, []);
      for (const e of es) out.push(e);
      return out;
    }
  }

  Macro.RANK = RANK;
  WG.Macro = Macro;
})();
