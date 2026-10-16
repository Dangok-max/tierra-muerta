// Geometría y utilidades para la generación del mundo (TM.WG.G).
(function () {
  const U = TM.U;
  const WG = TM.WG = TM.WG || {};
  const G = {};
  G.M = 32; // unidades por metro

  // RNG determinista a partir de varias claves enteras
  G.hash = (a, b, c, seed) => U.hash2((a | 0) + Math.imul(c | 0, 7919), b | 0, seed | 0);
  G.rng = (a, b, c, seed) => new U.RNG(Math.floor(G.hash(a, b, c, seed) * 4294967295) || 1);

  G.segPointDist2 = (ax, ay, bx, by, px, py) => {
    const dx = bx - ax, dy = by - ay;
    const L = dx * dx + dy * dy;
    let t = L > 0 ? ((px - ax) * dx + (py - ay) * dy) / L : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = ax + dx * t - px, qy = ay + dy * t - py;
    return qx * qx + qy * qy;
  };

  // Distancia de un segmento a un rectángulo (0 si se cortan)
  G.segRectDist = (ax, ay, bx, by, rx, ry, rw, rh) => {
    if (U.segRect(ax, ay, bx, by, rx, ry, rw, rh) >= 0) return 0;
    const pr = (px, py) => {
      const qx = U.clamp(px, rx, rx + rw), qy = U.clamp(py, ry, ry + rh);
      return (px - qx) * (px - qx) + (py - qy) * (py - qy);
    };
    let d = Math.min(pr(ax, ay), pr(bx, by));
    d = Math.min(d, G.segPointDist2(ax, ay, bx, by, rx, ry), G.segPointDist2(ax, ay, bx, by, rx + rw, ry),
      G.segPointDist2(ax, ay, bx, by, rx, ry + rh), G.segPointDist2(ax, ay, bx, by, rx + rw, ry + rh));
    return Math.sqrt(d);
  };

  G.overlap = (a, b, pad) => {
    pad = pad || 0;
    return a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y;
  };
  G.inRect = (x, y, r, pad) => {
    pad = pad || 0;
    return x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad;
  };

  // Catmull-Rom sobre puntos de control [x,y,...] -> polilínea densa
  G.catmull = (cp, steps) => {
    const n = cp.length / 2;
    if (n < 3) return cp.slice();
    const out = [];
    const P = (i) => { i = U.clamp(i, 0, n - 1); return [cp[i * 2], cp[i * 2 + 1]]; };
    for (let i = 0; i < n - 1; i++) {
      const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
      for (let s = 0; s < steps; s++) {
        const t = s / steps, t2 = t * t, t3 = t2 * t;
        const f = (a, b, c, d) => 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
        out.push(f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1]));
      }
    }
    out.push(cp[cp.length - 2], cp[cp.length - 1]);
    return out;
  };

  // Crea un objeto carretera a partir de una polilínea
  let roadIds = 1;
  G.makeRoad = (pts, w, kind, extra) => {
    const r = Object.assign({ id: roadIds++, pts, w, kind, side: 0 }, extra || {});
    G.roadMeta(r);
    return r;
  };
  G.roadMeta = (r) => {
    const p = r.pts, cum = [0];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, L = 0;
    for (let i = 0; i < p.length; i += 2) {
      if (p[i] < x0) x0 = p[i]; if (p[i] > x1) x1 = p[i];
      if (p[i + 1] < y0) y0 = p[i + 1]; if (p[i + 1] > y1) y1 = p[i + 1];
      if (i > 0) { L += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]); cum.push(L); }
    }
    const pad = r.w / 2 + (r.side || 0) + 8;
    r.cum = cum; r.len = L;
    r.bbox = { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
    return r;
  };
  // Punto y tangente a distancia s a lo largo de la carretera
  G.roadAt = (r, s, out) => {
    out = out || {};
    const p = r.pts, cum = r.cum;
    s = U.clamp(s, 0, r.len);
    let lo = 0, hi = cum.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
    const L = cum[hi] - cum[lo] || 1;
    const t = (s - cum[lo]) / L;
    const ax = p[lo * 2], ay = p[lo * 2 + 1], bx = p[hi * 2], by = p[hi * 2 + 1];
    out.x = ax + (bx - ax) * t; out.y = ay + (by - ay) * t;
    const dl = Math.hypot(bx - ax, by - ay) || 1;
    out.dx = (bx - ax) / dl; out.dy = (by - ay) / dl;
    return out;
  };
  // Distancia mínima de un punto a la polilínea (y s aproximado)
  G.roadDist = (r, x, y, res) => {
    const p = r.pts;
    let best = Infinity, bs = 0;
    for (let i = 0; i < p.length - 2; i += 2) {
      const ax = p[i], ay = p[i + 1], bx = p[i + 2], by = p[i + 3];
      // descarte rápido por caja
      if ((x < Math.min(ax, bx) - best) || (x > Math.max(ax, bx) + best) || (y < Math.min(ay, by) - best) || (y > Math.max(ay, by) + best)) continue;
      const d2 = G.segPointDist2(ax, ay, bx, by, x, y);
      if (d2 < best * best) {
        best = Math.sqrt(d2);
        if (res) {
          const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy || 1;
          const t = U.clamp(((x - ax) * dx + (y - ay) * dy) / L, 0, 1);
          bs = r.cum[i / 2] + t * Math.sqrt(L);
        }
      }
    }
    if (res) res.s = bs;
    return best;
  };
  G.roadRectDist = (r, rx, ry, rw, rh) => {
    const p = r.pts;
    let best = Infinity;
    for (let i = 0; i < p.length - 2; i += 2) {
      const ax = p[i], ay = p[i + 1], bx = p[i + 2], by = p[i + 3];
      if (Math.max(ax, bx) < rx - 600 || Math.min(ax, bx) > rx + rw + 600 || Math.max(ay, by) < ry - 600 || Math.min(ay, by) > ry + rh + 600) continue;
      const d = G.segRectDist(ax, ay, bx, by, rx, ry, rw, rh);
      if (d < best) best = d;
      if (best === 0) break;
    }
    return best;
  };

  // Rejilla espacial genérica con deduplicación por sello
  class SHash {
    constructor(cell) { this.cell = cell; this.m = new Map(); }
    insert(item, x0, y0, x1, y1) {
      const c = this.cell;
      const a0 = Math.floor(x0 / c), a1 = Math.floor(x1 / c), b0 = Math.floor(y0 / c), b1 = Math.floor(y1 / c);
      for (let j = b0; j <= b1; j++) for (let i = a0; i <= a1; i++) {
        const k = i * 73856093 ^ j * 19349663;
        let arr = this.m.get(k);
        if (!arr) { arr = []; this.m.set(k, arr); }
        arr.push(item);
      }
    }
    // fn(item) devuelve true para cortar
    query(x0, y0, x1, y1, fn) {
      const c = this.cell, st = ++SHash.stamp;
      const a0 = Math.floor(x0 / c), a1 = Math.floor(x1 / c), b0 = Math.floor(y0 / c), b1 = Math.floor(y1 / c);
      for (let j = b0; j <= b1; j++) for (let i = a0; i <= a1; i++) {
        const arr = this.m.get(i * 73856093 ^ j * 19349663);
        if (!arr) continue;
        for (let n = 0; n < arr.length; n++) {
          const it = arr[n];
          if (it._sh === st) continue;
          it._sh = st;
          if (fn(it)) return true;
        }
      }
      return false;
    }
  }
  SHash.stamp = 1; // sello global (un objeto puede estar en varias rejillas)
  G.SHash = SHash;

  // Rectángulo de una pared/tramo
  G.rect = (x, y, w, h) => ({ x, y, w, h });

  WG.G = G;
  // Reparto por tiempo: los generadores ceden el paso cuando el paso actual supera SLICE ms
  // (en un celular lento cede antes, porque el tiempo se mide en el propio dispositivo)
  WG.t0 = 0;
  WG.SLICE = 1.0;
  WG.over = () => performance.now() - WG.t0 > WG.SLICE;
  WG.mark = () => { WG.t0 = performance.now(); };
})();
