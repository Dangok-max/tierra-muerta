// Mundo infinito por chunks: generación procedural, colisión, raycast y pre-renderizado.
(function () {
  const U = TM.U;
  const CH = TM.Config.CHUNK;
  const TILE = 256;

  // ---------- Texturas de suelo (tileables, generadas una vez) ----------
  function tnoise(x, y, P, seed) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const m = (v) => ((v % P) + P) % P;
    const a = U.hash2(m(ix), m(iy), seed), b = U.hash2(m(ix + 1), m(iy), seed);
    const c = U.hash2(m(ix), m(iy + 1), seed), d = U.hash2(m(ix + 1), m(iy + 1), seed);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  }

  const PALETTE = {
    city:    { lo: [38, 37, 35], hi: [70, 68, 63], grain: 16, base: 5 },
    forest:  { lo: [36, 33, 25], hi: [66, 60, 44], grain: 14, base: 4 },
    desert:  { lo: [74, 63, 47], hi: [118, 102, 78], grain: 18, base: 4 },
    asphalt: { lo: [30, 30, 32], hi: [52, 52, 54], grain: 22, base: 8 },
    camp:    { lo: [44, 38, 28], hi: [74, 64, 46], grain: 14, base: 5 },
  };

  function makeGroundTile(name, seed) {
    const pal = PALETTE[name];
    const c = U.makeCanvas(TILE, TILE);
    const g = c.getContext('2d');
    const img = g.createImageData(TILE, TILE);
    const d = img.data;
    const P0 = pal.base;
    for (let py = 0; py < TILE; py++) {
      for (let px = 0; px < TILE; px++) {
        let v = 0, amp = 0.5, norm = 0, P = P0;
        for (let o = 0; o < 4; o++) {
          v += tnoise(px * P / TILE, py * P / TILE, P, seed + o * 31) * amp;
          norm += amp; amp *= 0.5; P *= 2;
        }
        v /= norm;
        v = U.smoothstep(0.2, 0.8, v);
        const gr = (U.hash2(px, py, seed + 999) - 0.5) * pal.grain;
        const i = (py * TILE + px) * 4;
        d[i] = pal.lo[0] + (pal.hi[0] - pal.lo[0]) * v + gr;
        d[i + 1] = pal.lo[1] + (pal.hi[1] - pal.lo[1]) * v + gr;
        d[i + 2] = pal.lo[2] + (pal.hi[2] - pal.lo[2]) * v + gr;
        d[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  // ---------- Utilidades de dibujo ----------
  function blobPath(ctx, x, y, r, rng, n, jit) {
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rr = r * (1 - jit + rng.next() * jit * 2);
      const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  const CAR_COLORS = ['#5a2a24', '#2f3b48', '#545a5c', '#7a766c', '#3c4430', '#4a3a28', '#23262a', '#6b5a3a'];
  const ROOF_COLORS = ['#3a3836', '#2f3133', '#433b33', '#383a35', '#2b2a2a', '#3d3530'];
  const WALL_COLORS = ['#4a4038', '#55504a', '#463c34', '#3f3d3a', '#5b4a3c'];

  class World {
    constructor(seed) {
      this.seed = seed | 0;
      this.chunks = new Map();
      this.bakedOrder = [];   // LRU de chunks con canvas
      this.jobs = new Map();  // horneados en curso (chunk -> generador)
      this.pool = [];         // canvas libres para reutilizar (menos basura = menos pausas)
      this.stamp = 1;
      this._tmp = null;
      this.tiles = World.tiles;
    }

    static initTextures() {
      if (World.tiles) return;
      World.tiles = {};
      let s = 11;
      for (const k in PALETTE) World.tiles[k] = makeGroundTile(k, s += 17);
    }

    key(cx, cy) { return cx + ',' + cy; }

    biomeOfChunk(cx, cy) {
      // el campamento inicial siempre está en un claro de bosque
      if ((cx === 0 || cx === -1) && (cy === 0 || cy === -1)) return 'forest';
      const n = U.fbm(cx * 0.11 + 100.5, cy * 0.11 - 50.5, this.seed + 7, 3);
      if (n < 0.44) return 'forest';
      if (n > 0.58) return 'desert';
      return 'city';
    }
    rowHasRoad(cy) { return cy === 0 || U.hash2(cy, 77, this.seed) < 0.22; }
    colHasRoad(cx) { return cx === 0 || U.hash2(77, cx, this.seed) < 0.22; }

    biomeAt(x, y) {
      const ch = this.getChunk(Math.floor(x / CH), Math.floor(y / CH));
      for (const r of ch.roads) {
        if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return 'road';
      }
      return ch.biome;
    }

    dangerAt(x, y) { return Math.hypot(x, y) / 4000; }

    getChunk(cx, cy) {
      const k = this.key(cx, cy);
      let ch = this.chunks.get(k);
      if (!ch) { ch = this.generate(cx, cy); this.chunks.set(k, ch); }
      return ch;
    }

    // ---------- Generación ----------
    generate(cx, cy) {
      const x0 = cx * CH, y0 = cy * CH;
      const rng = new U.RNG(Math.floor(U.hash2(cx, cy, this.seed) * 4294967295));
      const biome = this.biomeOfChunk(cx, cy);
      const ch = { cx, cy, x0, y0, biome, obs: [], decor: [], dyn: [], roads: [], canvas: null, blood: [], lastUsed: 0 };

      // Carreteras principales
      if (this.rowHasRoad(cy)) ch.roads.push({ x: x0, y: y0 + CH / 2 - 46, w: CH, h: 92, dir: 'h', hw: true });
      if (this.colHasRoad(cx)) ch.roads.push({ x: x0 + CH / 2 - 46, y: y0, w: 92, h: CH, dir: 'v', hw: true });
      // Calles de ciudad en los bordes
      if (biome === 'city') {
        ch.roads.push({ x: x0, y: y0, w: CH, h: 30, dir: 'h' });
        ch.roads.push({ x: x0, y: y0 + CH - 30, w: CH, h: 30, dir: 'h' });
        ch.roads.push({ x: x0, y: y0, w: 30, h: CH, dir: 'v' });
        ch.roads.push({ x: x0 + CH - 30, y: y0, w: 30, h: CH, dir: 'v' });
      }

      const nearCamp = Math.abs(cx + 0.5) <= 1.5 && Math.abs(cy + 0.5) <= 1.5;
      const safeR = TM.Config.SAFE_RADIUS;

      const fits = (x, y, w, h, pad, allowRoad) => {
        if (x < x0 + 4 || y < y0 + 4 || x + w > x0 + CH - 4 || y + h > y0 + CH - 4) return false;
        // lejos del campamento
        const ccx = U.clamp(0, x, x + w), ccy = U.clamp(0, y, y + h);
        if (ccx * ccx + ccy * ccy < (safeR + 20) * (safeR + 20)) return false;
        if (!allowRoad) {
          for (const r of ch.roads) {
            if (x < r.x + r.w + 6 && x + w > r.x - 6 && y < r.y + r.h + 6 && y + h > r.y - 6) return false;
          }
        }
        for (const o of ch.obs) {
          let ox, oy, ow, oh;
          if (o.shape === 'rect') { ox = o.x; oy = o.y; ow = o.w; oh = o.h; }
          else { ox = o.cx - o.r; oy = o.cy - o.r; ow = oh = o.r * 2; }
          if (x < ox + ow + pad && x + w > ox - pad && y < oy + oh + pad && y + h > oy - pad) return false;
        }
        return true;
      };
      const addRect = (kind, x, y, w, h, extra) => {
        const o = Object.assign({ shape: 'rect', kind, x, y, w, h, blocksSight: true, seed: rng.int(1, 1e9) }, extra || {});
        ch.obs.push(o); return o;
      };
      const addCircle = (kind, cx2, cy2, r, extra) => {
        const o = Object.assign({ shape: 'circle', kind, cx: cx2, cy: cy2, r, blocksSight: false, seed: rng.int(1, 1e9) }, extra || {});
        ch.obs.push(o); return o;
      };
      const tryRect = (kind, w, h, pad, tries, allowRoad, extra, area) => {
        for (let i = 0; i < tries; i++) {
          const ax = area ? area.x : x0, ay = area ? area.y : y0;
          const aw = area ? area.w : CH, ah = area ? area.h : CH;
          const x = ax + rng.range(0, Math.max(0, aw - w));
          const y = ay + rng.range(0, Math.max(0, ah - h));
          if (fits(x, y, w, h, pad, allowRoad)) return addRect(kind, x, y, w, h, extra);
        }
        return null;
      };
      const tryCircle = (kind, r, pad, tries, extra) => {
        for (let i = 0; i < tries; i++) {
          const x = x0 + rng.range(r + 6, CH - r - 6), y = y0 + rng.range(r + 6, CH - r - 6);
          if (fits(x - r, y - r, r * 2, r * 2, pad, false)) return addCircle(kind, x, y, r, extra);
        }
        return null;
      };
      const decor = (kind, n, onRoad) => {
        for (let i = 0; i < n; i++) {
          const x = x0 + rng.range(8, CH - 8), y = y0 + rng.range(8, CH - 8);
          if (!onRoad && Math.hypot(x, y) < safeR * 0.6) continue;
          ch.decor.push({ kind, x, y, s: rng.range(0.6, 1.4), rot: rng.range(0, Math.PI * 2), seed: rng.int(1, 1e9) });
        }
      };

      if (nearCamp) this.genCamp(ch, rng, addRect, addCircle);

      // Autos en carreteras
      for (const r of ch.roads) {
        const n = r.hw ? rng.int(0, 3) : (rng.chance(0.35) ? 1 : 0);
        for (let i = 0; i < n; i++) {
          const vertical = r.dir === 'v';
          const w = vertical ? 26 : 56, h = vertical ? 56 : 26;
          const area = { x: r.x + 4, y: r.y + 4, w: r.w - 8, h: r.h - 8 };
          tryRect('car', w, h, 14, 6, true, { vertical, color: rng.pick(CAR_COLORS), burned: rng.chance(0.25), rot: rng.range(-0.25, 0.25) }, area);
        }
      }

      if (biome === 'city') {
        const nB = rng.int(3, 6);
        for (let i = 0; i < nB; i++) {
          // si no cabe, se prueba con edificios más pequeños
          const shrink = 1 - (i / nB) * 0.35;
          const w = rng.range(80, 210) * shrink, h = rng.range(70, 170) * shrink;
          tryRect('building', w, h, 24, 16, false, {
            roof: rng.pick(ROOF_COLORS), wall: rng.pick(WALL_COLORS),
            wallH: rng.range(10, 18), ruined: rng.chance(0.4),
          });
        }
        for (let i = 0; i < rng.int(0, 2); i++) tryRect('car', 56, 26, 10, 6, false, { vertical: false, color: rng.pick(CAR_COLORS), burned: rng.chance(0.3), rot: rng.range(-0.6, 0.6) });
        for (let i = 0; i < rng.int(1, 3); i++) tryRect('dumpster', 36, 20, 8, 6, false, { blocksSight: false });
        for (let i = 0; i < rng.int(1, 4); i++) tryCircle('barrel', 9, 6, 6);
        for (let i = 0; i < rng.int(0, 2); i++) {
          const horiz = rng.chance(0.5);
          tryRect('wall', horiz ? rng.range(50, 120) : 12, horiz ? 12 : rng.range(50, 120), 10, 6, false);
        }
        decor('rubble', rng.int(6, 12)); decor('trash', rng.int(6, 12)); decor('stain', rng.int(3, 6));
        decor('puddle', rng.int(0, 3)); decor('paper', rng.int(4, 8));
      } else if (biome === 'forest') {
        const nT = rng.int(15, 25);
        for (let i = 0; i < nT; i++) {
          tryCircle('tree', rng.range(7, 11), 22, 5, { crown: rng.range(26, 46), branches: rng.int(5, 8) });
        }
        for (let i = 0; i < rng.int(2, 6); i++) tryCircle('rock', rng.range(9, 24), 10, 5);
        for (let i = 0; i < rng.int(0, 2); i++) {
          const horiz = rng.chance(0.5), L = rng.range(60, 110);
          tryRect('log', horiz ? L : 16, horiz ? 16 : L, 12, 6, false, { blocksSight: false });
        }
        if (rng.chance(0.15)) tryRect('building', rng.range(70, 100), rng.range(60, 90), 30, 8, false, { roof: '#3b2f25', wall: '#4a3a2c', wallH: 10, ruined: rng.chance(0.5), cabin: true });
        decor('shrub', rng.int(10, 18)); decor('leaves', rng.int(8, 14)); decor('grass', rng.int(10, 20));
        decor('stain', rng.int(2, 4)); decor('bones', rng.int(0, 2));
      } else {
        for (let i = 0; i < rng.int(6, 12); i++) {
          const big = rng.chance(0.3);
          tryCircle('rock', big ? rng.range(20, 34) : rng.range(8, 16), 10, 5, { blocksSight: big });
        }
        for (let i = 0; i < rng.int(0, 2); i++) tryRect('car', 56, 26, 12, 6, false, { vertical: false, color: rng.pick(CAR_COLORS), burned: rng.chance(0.6), rot: rng.range(-0.8, 0.8) });
        for (let i = 0; i < rng.int(0, 3); i++) {
          const horiz = rng.chance(0.5);
          tryRect('wall', horiz ? rng.range(50, 130) : 12, horiz ? 12 : rng.range(50, 130), 12, 6, false);
        }
        decor('crack', rng.int(10, 18)); decor('deadshrub', rng.int(8, 14)); decor('bones', rng.int(1, 3));
        decor('stain', rng.int(2, 4));
      }
      // escombros y basura en carreteras
      if (ch.roads.length) { decor('crack', rng.int(3, 6), true); decor('trash', rng.int(2, 5), true); }

      return ch;
    }

    genCamp(ch, rng, addRect, addCircle) {
      // Campamento inicial alrededor de (0,0). Cada objeto debe caer dentro de su chunk.
      const inCh = (x, y, w, h) => x >= ch.x0 + 2 && y >= ch.y0 + 2 && x + w <= ch.x0 + CH - 2 && y + h <= ch.y0 + CH - 2;
      const R = (kind, x, y, w, h, extra) => { if (inCh(x, y, w, h)) addRect(kind, x, y, w, h, extra); };
      const Cc = (kind, x, y, r, extra) => { if (inCh(x - r, y - r, r * 2, r * 2)) addCircle(kind, x, y, r, extra); };
      Cc('firepit', 26, 26, 13, { blocksSight: false });
      if (inCh(20, 20, 12, 12)) ch.dyn.push({ kind: 'fire', x: 26, y: 26 });
      R('tent', -96, -76, 50, 38, { blocksSight: true, color: '#3c4432' });
      R('tent', 56, -88, 44, 34, { blocksSight: true, color: '#4a3c2c' });
      R('crate', 70, 52, 22, 22, { blocksSight: false });
      R('crate', 96, 58, 18, 18, { blocksSight: false });
      R('car', -150, 46, 58, 27, { vertical: false, color: '#3a4250', burned: false, rot: -0.12 });
      // sacos de arena formando un anillo incompleto
      const ring = 175;
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI * 2;
        if (i % 6 === 0) continue; // huecos de entrada
        const x = Math.cos(a) * ring, y = Math.sin(a) * ring;
        R('sandbag', x - 13, y - 9, 26, 18, { blocksSight: false });
      }
      ch.decor.push({ kind: 'logseat', x: -12, y: 30, s: 1, rot: 1.4, seed: 5 });
      ch.decor.push({ kind: 'logseat', x: 60, y: 12, s: 1, rot: 0.2, seed: 6 });
    }

    // ---------- Consultas ----------
    forChunksInRect(x0, y0, x1, y1, fn) {
      const c0 = Math.floor(x0 / CH), c1 = Math.floor(x1 / CH);
      const r0 = Math.floor(y0 / CH), r1 = Math.floor(y1 / CH);
      for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) fn(this.getChunk(cx, cy));
    }

    queryObstacles(x0, y0, x1, y1, out) {
      out = out || [];
      this.forChunksInRect(x0, y0, x1, y1, (ch) => {
        for (const o of ch.obs) {
          if (o.shape === 'rect') {
            if (o.x > x1 || o.x + o.w < x0 || o.y > y1 || o.y + o.h < y0) continue;
          } else if (o.cx + o.r < x0 || o.cx - o.r > x1 || o.cy + o.r < y0 || o.cy - o.r > y1) continue;
          out.push(o);
        }
      });
      return out;
    }

    collideCircle(ent) {
      const r = ent.r;
      let hit = false;
      const list = this.queryObstacles(ent.x - r - 2, ent.y - r - 2, ent.x + r + 2, ent.y + r + 2, this._qbuf || (this._qbuf = []));
      for (let pass = 0; pass < 2; pass++) {
        for (const o of list) {
          if (o.shape === 'rect') {
            const px = U.clamp(ent.x, o.x, o.x + o.w), py = U.clamp(ent.y, o.y, o.y + o.h);
            let dx = ent.x - px, dy = ent.y - py;
            const d2 = dx * dx + dy * dy;
            if (d2 >= r * r) continue;
            hit = true;
            if (d2 > 1e-6) {
              const d = Math.sqrt(d2), push = r - d;
              ent.x += (dx / d) * push; ent.y += (dy / d) * push;
            } else {
              // centro dentro del rectángulo: salir por el lado más cercano
              const l = ent.x - o.x, rr = o.x + o.w - ent.x, t = ent.y - o.y, b = o.y + o.h - ent.y;
              const m = Math.min(l, rr, t, b);
              if (m === l) ent.x = o.x - r; else if (m === rr) ent.x = o.x + o.w + r;
              else if (m === t) ent.y = o.y - r; else ent.y = o.y + o.h + r;
            }
          } else {
            const dx = ent.x - o.cx, dy = ent.y - o.cy, rs = r + o.r;
            const d2 = dx * dx + dy * dy;
            if (d2 >= rs * rs) continue;
            hit = true;
            const d = Math.sqrt(d2) || 0.001;
            ent.x = o.cx + (dx / d) * rs; ent.y = o.cy + (dy / d) * rs;
          }
        }
      }
      list.length = 0;
      return hit;
    }

    isFree(x, y, r) {
      const list = this.queryObstacles(x - r, y - r, x + r, y + r, []);
      for (const o of list) {
        if (o.shape === 'rect') {
          const px = U.clamp(x, o.x, o.x + o.w), py = U.clamp(y, o.y, o.y + o.h);
          if (U.dist2(x, y, px, py) < r * r) return false;
        } else if (U.dist2(x, y, o.cx, o.cy) < (r + o.r) * (r + o.r)) return false;
      }
      return true;
    }

    _ray(x0, y0, x1, y1, sightOnly) {
      const list = this.queryObstacles(Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1), this._rbuf || (this._rbuf = []));
      let best = 1, bestO = null;
      for (const o of list) {
        if (sightOnly && !o.blocksSight) continue;
        const t = o.shape === 'rect'
          ? U.segRect(x0, y0, x1, y1, o.x, o.y, o.w, o.h)
          : U.segCircle(x0, y0, x1, y1, o.cx, o.cy, o.r);
        if (t >= 0 && t < best) { best = t; bestO = o; }
      }
      list.length = 0;
      this.lastRayObstacle = bestO;
      return best;
    }
    raycast(x0, y0, x1, y1) { return this._ray(x0, y0, x1, y1, false); }
    lineOfSight(x0, y0, x1, y1) { return this._ray(x0, y0, x1, y1, true) >= 1; }

    rasterize(x0, y0, cols, rows, cell, inflate) {
      const grid = new Uint8Array(cols * rows);
      const inf = inflate || 0;
      const list = this.queryObstacles(x0 - inf, y0 - inf, x0 + cols * cell + inf, y0 + rows * cell + inf, []);
      for (const o of list) {
        if (o.shape === 'rect') {
          const c0 = Math.max(0, Math.floor((o.x - inf - x0) / cell));
          const c1 = Math.min(cols - 1, Math.floor((o.x + o.w + inf - x0) / cell));
          const r0 = Math.max(0, Math.floor((o.y - inf - y0) / cell));
          const r1 = Math.min(rows - 1, Math.floor((o.y + o.h + inf - y0) / cell));
          for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) grid[r * cols + c] = 1;
        } else {
          const rr = o.r + inf;
          const c0 = Math.max(0, Math.floor((o.cx - rr - x0) / cell));
          const c1 = Math.min(cols - 1, Math.floor((o.cx + rr - x0) / cell));
          const r0 = Math.max(0, Math.floor((o.cy - rr - y0) / cell));
          const r1 = Math.min(rows - 1, Math.floor((o.cy + rr - y0) / cell));
          for (let r = r0; r <= r1; r++) {
            for (let c = c0; c <= c1; c++) {
              const px = x0 + (c + 0.5) * cell, py = y0 + (r + 0.5) * cell;
              if (U.dist2(px, py, o.cx, o.cy) <= (rr + cell * 0.5) * (rr + cell * 0.5)) grid[r * cols + c] = 1;
            }
          }
        }
      }
      return grid;
    }

    // Busca un punto libre cerca de (x,y)
    findFree(x, y, r, maxR) {
      if (this.isFree(x, y, r)) return { x, y };
      for (let d = 16; d <= (maxR || 200); d += 16) {
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          const px = x + Math.cos(a) * d, py = y + Math.sin(a) * d;
          if (this.isFree(px, py, r)) return { x: px, y: py };
        }
      }
      return { x, y };
    }

    // ---------- Sangre persistente ----------
    paintBlood(x, y, size, intensity) {
      const s = size || 10, a = U.clamp(intensity === undefined ? 0.7 : intensity, 0, 1);
      const splat = { x, y, s, a, seed: (Math.random() * 1e9) | 0 };
      this.forChunksInRect(x - s * 2, y - s * 2, x + s * 2, y + s * 2, (ch) => {
        ch.blood.push(splat);
        if (ch.blood.length > 60) ch.blood.shift();
        if (ch.canvas && ch.ready) this.drawBlood(ch.ctx, ch, splat);
      });
    }

    drawBlood(ctx, ch, b) {
      const rng = new U.RNG(b.seed);
      const res = ch.res;
      ctx.save();
      ctx.setTransform(res, 0, 0, res, -ch.x0 * res, -ch.y0 * res);
      ctx.fillStyle = `rgba(${70 + rng.int(0, 30)},${6 + rng.int(0, 8)},${6 + rng.int(0, 6)},${b.a})`;
      blobPath(ctx, b.x, b.y, b.s, rng, 9, 0.35);
      ctx.fill();
      const n = 3 + rng.int(0, 5);
      for (let i = 0; i < n; i++) {
        const a = rng.range(0, Math.PI * 2), d = rng.range(b.s * 0.8, b.s * 2.2);
        ctx.beginPath();
        ctx.arc(b.x + Math.cos(a) * d, b.y + Math.sin(a) * d, rng.range(1, b.s * 0.3), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // ---------- Pre-renderizado de chunk ----------
    // El horneado es un generador que se puede repartir en varios frames (bakeTick) para evitar tirones.
    // Si un chunk visible no está listo, se termina de golpe (bake).
    bake(ch) {
      let job = this.jobs.get(ch);
      if (!job) job = this.startJob(ch);
      while (!job.next().done) { /* terminar */ }
      this.jobs.delete(ch);
    }

    startJob(ch) {
      const job = this.bakeGen(ch);
      this.jobs.set(ch, job);
      return job;
    }

    // Avanza trabajos pendientes hasta agotar el presupuesto de milisegundos.
    bakeTick(budgetMs) {
      if (!this.jobs.size) return;
      const t0 = performance.now();
      for (const [ch, job] of this.jobs) {
        while (performance.now() - t0 < budgetMs) {
          if (job.next().done) { this.jobs.delete(ch); break; }
        }
        if (performance.now() - t0 >= budgetMs) return;
      }
    }

    allocCanvas(ch, size) {
      // reutiliza el canvas del chunk menos usado si se pasa el límite
      const limit = TM.Config.preset.chunkCache;
      let oldest = null;
      if (this.bakedOrder.length >= limit) {
        for (const c of this.bakedOrder) if (!oldest || c.lastUsed < oldest.lastUsed) oldest = c;
        // nunca reciclar un chunk que se está viendo
        if (oldest && oldest.lastUsed >= (this.now || 0) - 1) oldest = null;
      }
      if (oldest) {
        const i = this.bakedOrder.indexOf(oldest);
        this.bakedOrder.splice(i, 1);
        this.jobs.delete(oldest);
        ch.canvas = oldest.canvas; ch.ctx = oldest.ctx;
        oldest.canvas = null; oldest.ctx = null; oldest.ready = false;
        if (ch.canvas.width !== size) { ch.canvas.width = size; ch.canvas.height = size; }
      } else if (this.pool.length) {
        const c = this.pool.pop();
        ch.canvas = c.canvas; ch.ctx = c.ctx;
        if (ch.canvas.width !== size) { ch.canvas.width = size; ch.canvas.height = size; }
      } else {
        ch.canvas = U.makeCanvas(size, size);
        ch.ctx = ch.canvas.getContext('2d');
      }
      this.bakedOrder.push(ch);
    }

    * bakeGen(ch) {
      const res = TM.Config.quality === 'low' ? 0.75 : 1;
      const size = Math.round(CH * res);
      ch.ready = false;
      if (!ch.canvas) this.allocCanvas(ch, size);
      ch.res = res;
      const ctx = ch.ctx;
      const T = () => ctx.setTransform(res, 0, 0, res, -ch.x0 * res, -ch.y0 * res);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, size, size);
      T();
      const rng = new U.RNG(Math.floor(U.hash2(ch.cx, ch.cy, this.seed + 3) * 4294967295));

      // 1. suelo base
      ctx.fillStyle = ctx.createPattern(this.tiles[ch.biome], 'repeat');
      ctx.fillRect(ch.x0, ch.y0, CH, CH);
      yield;
      yield* this.blendEdges(ch, ctx, T);

      // 2. variación a gran escala (manchas). Se incluyen las de los vecinos para que no haya cortes en los bordes.
      T();
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const ncx = ch.cx + dx, ncy = ch.cy + dy;
          const nb = (dx === 0 && dy === 0) ? ch.biome : this.biomeOfChunk(ncx, ncy);
          const br = new U.RNG(Math.floor(U.hash2(ncx, ncy, this.seed + 5) * 4294967295));
          for (let i = 0; i < 9; i++) {
            const x = ncx * CH + br.range(0, CH), y = ncy * CH + br.range(0, CH), r = br.range(40, 140);
            const light = br.chance(0.5);
            const al = br.range(0.12, 0.28);
            if (x + r < ch.x0 || x - r > ch.x0 + CH || y + r < ch.y0 || y - r > ch.y0 + CH) continue;
            const tint = nb === 'forest' ? (light ? '40,46,30' : '20,16,10')
              : nb === 'desert' ? (light ? '140,120,90' : '50,40,30') : (light ? '80,76,70' : '20,20,18');
            const g = ctx.createRadialGradient(x, y, 0, x, y, r);
            g.addColorStop(0, `rgba(${tint},${al})`);
            g.addColorStop(1, `rgba(${tint},0)`);
            ctx.fillStyle = g;
            ctx.fillRect(x - r, y - r, r * 2, r * 2);
          }
          if (dx === 1) { yield; T(); }
        }
      }
      // campamento: tierra pisada alrededor del fuego
      if (Math.abs(ch.cx + 0.5) <= 1.5 && Math.abs(ch.cy + 0.5) <= 1.5) {
        const g = ctx.createRadialGradient(20, 20, 0, 20, 20, 240);
        g.addColorStop(0, 'rgba(58,48,34,0.9)'); g.addColorStop(0.6, 'rgba(58,48,34,0.5)'); g.addColorStop(1, 'rgba(58,48,34,0)');
        ctx.fillStyle = g; ctx.fillRect(-240, -240, 520, 520);
      }
      yield;

      // 3. carreteras
      T();
      for (const r of ch.roads) this.drawRoad(ctx, r, rng);
      yield;

      // 4. decorado, sombras y objetos (propios y de vecinos que invadan visualmente)
      const near = [];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          // generar los datos de un vecino nuevo cuesta: una pausa por cada uno
          const had = this.chunks.has(this.key(ch.cx + dx, ch.cy + dy));
          near.push(this.getChunk(ch.cx + dx, ch.cy + dy));
          if (!had) yield;
        }
      }
      const inside = (x, y, pad) => x > ch.x0 - pad && x < ch.x0 + CH + pad && y > ch.y0 - pad && y < ch.y0 + CH + pad;
      T();
      for (const n of near) for (const d of n.decor) if (inside(d.x, d.y, 40)) this.drawDecor(ctx, d);
      yield;
      T();
      const objs = [];
      for (const n of near) {
        for (const o of n.obs) {
          const ox = o.shape === 'rect' ? o.x + o.w / 2 : o.cx, oy = o.shape === 'rect' ? o.y + o.h / 2 : o.cy;
          const ext = o.shape === 'rect' ? Math.max(o.w, o.h) / 2 + 30 : (o.crown || o.r) + 30;
          if (inside(ox, oy, ext)) objs.push(o);
        }
      }
      for (const o of objs) this.drawShadow(ctx, o);
      yield;
      objs.sort((a, b) => (a.shape === 'rect' ? a.y + a.h : a.cy + a.r) - (b.shape === 'rect' ? b.y + b.h : b.cy + b.r));
      let n = 0;
      for (const o of objs) {
        T();
        this.drawObstacle(ctx, o);
        // los árboles y edificios son caros: pausa cada pocos objetos
        n += (o.kind === 'tree' || o.kind === 'building') ? 2 : 1;
        if (n >= 6) { n = 0; yield; }
      }
      for (const b of ch.blood) this.drawBlood(ctx, ch, b);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ch.ready = true;
    }

    * blendEdges(ch, ctx, T) {
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (const [dx, dy] of dirs) {
        const nb = this.biomeOfChunk(ch.cx + dx, ch.cy + dy);
        if (nb === ch.biome) continue;
        if (!this._tmp) { this._tmp = U.makeCanvas(CH, CH); this._tctx = this._tmp.getContext('2d'); }
        const t = this._tctx;
        t.setTransform(1, 0, 0, 1, 0, 0);
        t.globalCompositeOperation = 'source-over';
        t.clearRect(0, 0, CH, CH);
        t.fillStyle = t.createPattern(this.tiles[nb], 'repeat');
        t.fillRect(0, 0, CH, CH);
        t.globalCompositeOperation = 'destination-in';
        const W = 190;
        let g;
        if (dx === 1) g = t.createLinearGradient(CH, 0, CH - W, 0);
        else if (dx === -1) g = t.createLinearGradient(0, 0, W, 0);
        else if (dy === 1) g = t.createLinearGradient(0, CH, 0, CH - W);
        else g = t.createLinearGradient(0, 0, 0, W);
        g.addColorStop(0, 'rgba(0,0,0,0.5)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        t.fillStyle = g;
        t.fillRect(0, 0, CH, CH);
        t.globalCompositeOperation = 'source-over';
        T();
        ctx.drawImage(this._tmp, ch.x0, ch.y0);
        yield;
      }
    }

    drawRoad(ctx, r, rng) {
      ctx.fillStyle = ctx.createPattern(this.tiles.asphalt, 'repeat');
      ctx.fillRect(r.x, r.y, r.w, r.h);
      // bordes gastados
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      if (r.dir === 'h') { ctx.fillRect(r.x, r.y, r.w, 3); ctx.fillRect(r.x, r.y + r.h - 3, r.w, 3); }
      else { ctx.fillRect(r.x, r.y, 3, r.h); ctx.fillRect(r.x + r.w - 3, r.y, 3, r.h); }
      if (r.hw) {
        // línea central discontinua y desgastada
        ctx.fillStyle = 'rgba(170,150,90,0.35)';
        for (let i = 0; i < CH; i += 48) {
          if (rng.chance(0.2)) continue;
          if (r.dir === 'h') ctx.fillRect(r.x + i + 6, r.y + r.h / 2 - 2, 26, 3);
          else ctx.fillRect(r.x + r.w / 2 - 2, r.y + i + 6, 3, 26);
        }
        ctx.fillStyle = 'rgba(190,190,180,0.18)';
        if (r.dir === 'h') { ctx.fillRect(r.x, r.y + 7, r.w, 2); ctx.fillRect(r.x, r.y + r.h - 9, r.w, 2); }
        else { ctx.fillRect(r.x + 7, r.y, 2, r.h); ctx.fillRect(r.x + r.w - 9, r.y, 2, r.h); }
      }
      // grietas
      ctx.strokeStyle = 'rgba(10,10,10,0.45)';
      ctx.lineWidth = 1.2;
      for (let i = 0; i < 6; i++) {
        let x = r.x + rng.range(0, r.w), y = r.y + rng.range(0, r.h);
        ctx.beginPath(); ctx.moveTo(x, y);
        for (let k = 0; k < 5; k++) {
          x += rng.range(-14, 14); y += rng.range(-14, 14);
          x = U.clamp(x, r.x, r.x + r.w); y = U.clamp(y, r.y, r.y + r.h);
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }

    drawDecor(ctx, d) {
      const rng = new U.RNG(d.seed);
      const s = d.s;
      switch (d.kind) {
        case 'rubble':
          for (let i = 0; i < 5; i++) {
            ctx.fillStyle = rng.pick(['#4a4744', '#3a3836', '#55514c', '#2e2c2a']);
            blobPath(ctx, d.x + rng.range(-10, 10) * s, d.y + rng.range(-10, 10) * s, rng.range(2, 6) * s, rng, 5, 0.4);
            ctx.fill();
          }
          break;
        case 'trash':
          for (let i = 0; i < 4; i++) {
            ctx.fillStyle = rng.pick(['#4b4a3a', '#3d3a36', '#5a4636', '#2f3a3d', '#6b6656']);
            ctx.save(); ctx.translate(d.x + rng.range(-8, 8), d.y + rng.range(-8, 8)); ctx.rotate(rng.range(0, 6.28));
            ctx.fillRect(-3 * s, -2 * s, rng.range(4, 8) * s, rng.range(3, 5) * s);
            ctx.restore();
          }
          break;
        case 'paper':
          ctx.fillStyle = 'rgba(150,145,130,0.35)';
          ctx.save(); ctx.translate(d.x, d.y); ctx.rotate(d.rot); ctx.fillRect(-4, -3, 8, 6); ctx.restore();
          break;
        case 'stain': {
          const g = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, 26 * s);
          g.addColorStop(0, 'rgba(12,10,8,0.35)'); g.addColorStop(1, 'rgba(12,10,8,0)');
          ctx.fillStyle = g; ctx.fillRect(d.x - 26 * s, d.y - 26 * s, 52 * s, 52 * s);
          break;
        }
        case 'puddle':
          ctx.fillStyle = 'rgba(20,24,28,0.55)';
          blobPath(ctx, d.x, d.y, 16 * s, rng, 10, 0.25); ctx.fill();
          ctx.strokeStyle = 'rgba(120,130,140,0.12)'; ctx.lineWidth = 1.5; ctx.stroke();
          break;
        case 'shrub':
          for (let i = 0; i < 4; i++) {
            ctx.fillStyle = rng.pick(['#2e3226', '#363a2a', '#2a2a20', '#3a3626']);
            blobPath(ctx, d.x + rng.range(-6, 6) * s, d.y + rng.range(-6, 6) * s, rng.range(5, 9) * s, rng, 7, 0.35); ctx.fill();
          }
          break;
        case 'leaves':
          for (let i = 0; i < 8; i++) {
            ctx.fillStyle = rng.pick(['#4a3a24', '#3c2e1e', '#5a4a2c', '#2e2a1e']);
            ctx.fillRect(d.x + rng.range(-14, 14), d.y + rng.range(-14, 14), 3, 2);
          }
          break;
        case 'grass':
          ctx.strokeStyle = rng.pick(['#4a4a32', '#55513a', '#3d3f2c']);
          ctx.lineWidth = 1;
          ctx.beginPath();
          for (let i = 0; i < 6; i++) {
            const a = rng.range(-2.4, -0.7);
            ctx.moveTo(d.x, d.y); ctx.lineTo(d.x + Math.cos(a) * 7 * s, d.y + Math.sin(a) * 7 * s);
          }
          ctx.stroke();
          break;
        case 'deadshrub':
          ctx.strokeStyle = '#3a2e22'; ctx.lineWidth = 1.2;
          ctx.beginPath();
          for (let i = 0; i < 7; i++) {
            const a = rng.range(0, 6.28), L = rng.range(5, 12) * s;
            ctx.moveTo(d.x, d.y); ctx.lineTo(d.x + Math.cos(a) * L, d.y + Math.sin(a) * L);
          }
          ctx.stroke();
          break;
        case 'crack':
          ctx.strokeStyle = 'rgba(30,22,14,0.5)'; ctx.lineWidth = 1;
          ctx.beginPath();
          {
            let x = d.x, y = d.y;
            ctx.moveTo(x, y);
            for (let k = 0; k < 6; k++) {
              x += rng.range(-10, 10) * s; y += rng.range(-10, 10) * s; ctx.lineTo(x, y);
              if (rng.chance(0.3)) { ctx.moveTo(x, y); ctx.lineTo(x + rng.range(-8, 8), y + rng.range(-8, 8)); ctx.moveTo(x, y); }
            }
          }
          ctx.stroke();
          break;
        case 'bones':
          ctx.fillStyle = '#b8b0a0';
          ctx.save(); ctx.translate(d.x, d.y); ctx.rotate(d.rot);
          ctx.beginPath(); ctx.ellipse(0, 0, 5, 4, 0, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#2a2622'; ctx.fillRect(-2.5, -1, 1.6, 1.6); ctx.fillRect(1, -1, 1.6, 1.6);
          ctx.fillStyle = '#a69e8e';
          for (let i = 0; i < 3; i++) ctx.fillRect(rng.range(6, 16), rng.range(-6, 6), rng.range(6, 10), 1.6);
          ctx.restore();
          break;
        case 'logseat':
          ctx.save(); ctx.translate(d.x, d.y); ctx.rotate(d.rot);
          ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(-15, -3, 32, 11);
          ctx.fillStyle = '#4a3624'; ctx.fillRect(-16, -5, 32, 10);
          ctx.fillStyle = '#5e4630'; ctx.fillRect(-16, -5, 32, 3);
          ctx.fillStyle = '#6e5a40'; ctx.beginPath(); ctx.ellipse(16, 0, 3, 5, 0, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
          break;
      }
    }

    drawShadow(ctx, o) {
      ctx.fillStyle = 'rgba(0,0,0,0.32)';
      if (o.shape === 'rect') {
        const off = o.kind === 'building' ? 12 : o.kind === 'tent' ? 7 : 5;
        ctx.save();
        if (o.rot) { ctx.translate(o.x + o.w / 2 + off * 0.7, o.y + o.h / 2 + off); ctx.rotate(o.rot); ctx.fillRect(-o.w / 2, -o.h / 2, o.w, o.h); }
        else ctx.fillRect(o.x + off * 0.7, o.y + off, o.w, o.h);
        ctx.restore();
      } else if (o.kind === 'tree') {
        // sombra difusa de la copa (degradado, no mancha dura)
        const sx = o.cx + 14, sy = o.cy + 18, R = o.crown * 1.05;
        const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, R);
        g.addColorStop(0, 'rgba(0,0,0,0.26)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.fillRect(sx - R, sy - R, R * 2, R * 2);
      } else {
        ctx.beginPath(); ctx.ellipse(o.cx + 4, o.cy + 5, o.r, o.r * 0.85, 0, 0, Math.PI * 2); ctx.fill();
      }
    }

    drawObstacle(ctx, o) {
      const rng = new U.RNG(o.seed);
      switch (o.kind) {
        case 'building': return this.drawBuilding(ctx, o, rng);
        case 'car': return this.drawCar(ctx, o, rng);
        case 'tree': return this.drawTree(ctx, o, rng);
        case 'rock': return this.drawRock(ctx, o, rng);
        case 'barrel': {
          ctx.fillStyle = rng.pick(['#4a3020', '#3a4030', '#5a4a30']);
          ctx.beginPath(); ctx.arc(o.cx, o.cy, o.r, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(o.cx, o.cy, o.r * 0.65, 0, Math.PI * 2); ctx.stroke();
          ctx.fillStyle = 'rgba(160,90,40,0.35)'; ctx.beginPath(); ctx.arc(o.cx - 2, o.cy - 2, o.r * 0.4, 0, Math.PI * 2); ctx.fill();
          return;
        }
        case 'dumpster':
          ctx.fillStyle = '#2f3d33'; ctx.fillRect(o.x, o.y, o.w, o.h);
          ctx.fillStyle = '#26322a'; ctx.fillRect(o.x + 2, o.y + 2, o.w / 2 - 3, o.h - 4); ctx.fillRect(o.x + o.w / 2 + 1, o.y + 2, o.w / 2 - 3, o.h - 4);
          ctx.fillStyle = 'rgba(120,70,30,0.4)'; ctx.fillRect(o.x + rng.range(0, o.w - 8), o.y + rng.range(0, o.h - 6), 8, 5);
          return;
        case 'wall': {
          ctx.fillStyle = '#4c4842'; ctx.fillRect(o.x, o.y, o.w, o.h);
          ctx.fillStyle = '#5c5850'; ctx.fillRect(o.x, o.y, o.w, Math.min(4, o.h));
          ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 1;
          ctx.beginPath();
          const horiz = o.w > o.h;
          for (let i = 10; i < (horiz ? o.w : o.h); i += 14) {
            if (horiz) { ctx.moveTo(o.x + i, o.y); ctx.lineTo(o.x + i, o.y + o.h); }
            else { ctx.moveTo(o.x, o.y + i); ctx.lineTo(o.x + o.w, o.y + i); }
          }
          ctx.stroke();
          return;
        }
        case 'log':
          ctx.fillStyle = '#3e2e20'; ctx.fillRect(o.x, o.y, o.w, o.h);
          ctx.fillStyle = '#4e3a28';
          if (o.w > o.h) ctx.fillRect(o.x, o.y, o.w, o.h * 0.35); else ctx.fillRect(o.x, o.y, o.w * 0.35, o.h);
          ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1;
          ctx.strokeRect(o.x + 0.5, o.y + 0.5, o.w - 1, o.h - 1);
          return;
        case 'crate':
          ctx.fillStyle = '#5a4630'; ctx.fillRect(o.x, o.y, o.w, o.h);
          ctx.strokeStyle = '#3a2c1c'; ctx.lineWidth = 2;
          ctx.strokeRect(o.x + 1, o.y + 1, o.w - 2, o.h - 2);
          ctx.beginPath(); ctx.moveTo(o.x + 2, o.y + 2); ctx.lineTo(o.x + o.w - 2, o.y + o.h - 2); ctx.stroke();
          return;
        case 'sandbag':
          ctx.fillStyle = '#5e5440';
          for (let i = 0; i < 3; i++) {
            ctx.beginPath(); ctx.ellipse(o.x + 5 + i * 8, o.y + o.h / 2, 6, o.h / 2 - 1, 0, 0, Math.PI * 2); ctx.fill();
          }
          ctx.fillStyle = 'rgba(255,240,200,0.06)'; ctx.fillRect(o.x, o.y + 2, o.w, 3);
          return;
        case 'tent': {
          ctx.fillStyle = o.color; ctx.fillRect(o.x, o.y, o.w, o.h);
          ctx.fillStyle = U.shade(o.color, 0.7); ctx.fillRect(o.x, o.y + o.h / 2, o.w, o.h / 2);
          ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(o.x, o.y + o.h / 2); ctx.lineTo(o.x + o.w, o.y + o.h / 2); ctx.stroke();
          ctx.fillStyle = '#16140f'; ctx.beginPath();
          ctx.moveTo(o.x + o.w, o.y + o.h / 2 - 7); ctx.lineTo(o.x + o.w - 9, o.y + o.h / 2); ctx.lineTo(o.x + o.w, o.y + o.h / 2 + 7); ctx.fill();
          return;
        }
        case 'firepit':
          for (let i = 0; i < 10; i++) {
            const a = (i / 10) * Math.PI * 2;
            ctx.fillStyle = rng.pick(['#5a5650', '#4a4640', '#625c54']);
            ctx.beginPath(); ctx.arc(o.cx + Math.cos(a) * o.r, o.cy + Math.sin(a) * o.r, 3.6, 0, Math.PI * 2); ctx.fill();
          }
          ctx.fillStyle = '#1a1410'; ctx.beginPath(); ctx.arc(o.cx, o.cy, o.r - 3, 0, Math.PI * 2); ctx.fill();
          return;
      }
    }

    drawBuilding(ctx, o, rng) {
      const wh = o.wallH;
      // fachada sur (falsa altura)
      ctx.fillStyle = o.wall;
      ctx.fillRect(o.x, o.y + o.h - wh, o.w, wh);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(o.x, o.y + o.h - wh, o.w, 2);
      // ventanas rotas
      for (let x = o.x + 8; x < o.x + o.w - 12; x += 22) {
        if (rng.chance(0.25)) continue;
        ctx.fillStyle = rng.chance(0.5) ? '#0d0e10' : '#1b2026';
        ctx.fillRect(x, o.y + o.h - wh + 3, 10, wh - 6);
      }
      // techo
      const rh = o.h - wh;
      ctx.fillStyle = o.roof;
      ctx.fillRect(o.x, o.y, o.w, rh);
      // textura de techo: franjas sutiles
      ctx.fillStyle = 'rgba(255,255,255,0.025)';
      for (let y = o.y + 4; y < o.y + rh; y += 8) ctx.fillRect(o.x, y, o.w, 3);
      // pretil
      ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 3;
      ctx.strokeRect(o.x + 2, o.y + 2, o.w - 4, rh - 4);
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1;
      ctx.strokeRect(o.x + 0.5, o.y + 0.5, o.w - 1, rh - 1);
      // manchas de humedad
      for (let i = 0; i < 3; i++) {
        const x = o.x + rng.range(10, o.w - 10), y = o.y + rng.range(10, rh - 10), r = rng.range(10, 30);
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, 'rgba(0,0,0,0.3)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
      // equipos en el techo
      if (!o.cabin) {
        for (let i = 0; i < rng.int(1, 3); i++) {
          const w = rng.range(10, 20), h = rng.range(10, 16);
          const x = o.x + rng.range(8, o.w - w - 8), y = o.y + rng.range(8, Math.max(9, rh - h - 8));
          ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(x + 3, y + 3, w, h);
          ctx.fillStyle = '#56585a'; ctx.fillRect(x, y, w, h);
          ctx.fillStyle = '#3e4042'; ctx.fillRect(x + 2, y + 2, w - 4, 3);
        }
      } else {
        // tablones de cabaña
        ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = o.x + 6; x < o.x + o.w; x += 7) { ctx.moveTo(x, o.y); ctx.lineTo(x, o.y + rh); }
        ctx.stroke();
      }
      // en ruinas: agujero y escombros
      if (o.ruined) {
        const x = o.x + rng.range(o.w * 0.25, o.w * 0.75), y = o.y + rng.range(rh * 0.25, rh * 0.75);
        const r = Math.min(o.w, rh) * rng.range(0.12, 0.22);
        ctx.fillStyle = '#0c0b0a';
        blobPath(ctx, x, y, r, rng, 9, 0.4); ctx.fill();
        ctx.strokeStyle = 'rgba(90,80,70,0.6)'; ctx.lineWidth = 2; ctx.stroke();
        for (let i = 0; i < 6; i++) {
          ctx.fillStyle = rng.pick(['#4a4744', '#3a3836', '#55514c']);
          blobPath(ctx, x + rng.range(-r * 1.6, r * 1.6), y + rng.range(-r * 1.6, r * 1.6), rng.range(2, 5), rng, 5, 0.4); ctx.fill();
        }
      }
    }

    drawCar(ctx, o, rng) {
      const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
      const L = Math.max(o.w, o.h), W = Math.min(o.w, o.h);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate((o.vertical ? Math.PI / 2 : 0) + (o.rot || 0) * 0.3);
      const body = o.burned ? '#1f1c1a' : o.color;
      // ruedas
      ctx.fillStyle = '#121212';
      ctx.fillRect(-L / 2 + 7, -W / 2 - 2, 11, 4); ctx.fillRect(L / 2 - 18, -W / 2 - 2, 11, 4);
      ctx.fillRect(-L / 2 + 7, W / 2 - 2, 11, 4); ctx.fillRect(L / 2 - 18, W / 2 - 2, 11, 4);
      // carrocería
      ctx.fillStyle = body;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(-L / 2, -W / 2, L, W, 6); else ctx.rect(-L / 2, -W / 2, L, W);
      ctx.fill();
      // techo y cristales
      ctx.fillStyle = o.burned ? '#121110' : '#14181c';
      ctx.fillRect(-L * 0.22, -W / 2 + 3, L * 0.5, W - 6);
      ctx.fillStyle = o.burned ? '#2a2420' : U.shade(o.color, 1.15);
      ctx.fillRect(-L * 0.12, -W / 2 + 4, L * 0.3, W - 8);
      // capó
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fillRect(L * 0.3, -W / 2 + 3, L * 0.16, W - 6);
      // óxido / quemado
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = o.burned ? 'rgba(80,40,20,0.4)' : 'rgba(110,60,30,0.35)';
        ctx.beginPath(); ctx.arc(rng.range(-L / 2 + 4, L / 2 - 4), rng.range(-W / 2 + 3, W / 2 - 3), rng.range(1.5, 4), 0, Math.PI * 2); ctx.fill();
      }
      // faros
      ctx.fillStyle = 'rgba(200,190,150,0.35)';
      ctx.fillRect(L / 2 - 3, -W / 2 + 3, 2, 4); ctx.fillRect(L / 2 - 3, W / 2 - 7, 2, 4);
      ctx.restore();
      // cristales rotos alrededor
      ctx.fillStyle = 'rgba(160,180,190,0.25)';
      for (let i = 0; i < 6; i++) ctx.fillRect(cx + rng.range(-L * 0.7, L * 0.7), cy + rng.range(-L * 0.6, L * 0.6), 1.5, 1.5);
    }

    drawTree(ctx, o, rng) {
      // árbol seco visto desde arriba: ramas que se bifurcan, madera gris y algo de follaje muerto
      const wood = rng.pick(['#4a4036', '#52473b', '#443a31', '#5a4e42']);
      ctx.lineCap = 'round';
      ctx.strokeStyle = wood;
      const branch = (x, y, a, len, w, depth) => {
        const ex = x + Math.cos(a) * len, ey = y + Math.sin(a) * len;
        // ligera curvatura
        const mx = (x + ex) / 2 + Math.cos(a + 1.57) * len * rng.range(-0.15, 0.15);
        const my = (y + ey) / 2 + Math.sin(a + 1.57) * len * rng.range(-0.15, 0.15);
        ctx.lineWidth = w;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(mx, my, ex, ey); ctx.stroke();
        if (depth <= 0) return;
        const n = rng.chance(0.4) ? 3 : 2;
        for (let k = 0; k < n; k++) {
          branch(ex, ey, a + rng.range(-0.75, 0.75), len * rng.range(0.5, 0.72), Math.max(0.8, w * 0.6), depth - 1);
        }
      };
      const variant = o.seed % 5;
      if (variant === 3) {
        // conífera muerta: capas de agujas grises en estrella
        for (let layer = 0; layer < 3; layer++) {
          const R = o.crown * (0.85 - layer * 0.25), n = 9 + layer * 2;
          ctx.fillStyle = ['#2f342a', '#3a3e32', '#454836'][layer];
          ctx.beginPath();
          for (let i = 0; i < n * 2; i++) {
            const a = (i / (n * 2)) * Math.PI * 2 + layer * 0.3;
            const rr = (i % 2 ? R * 0.55 : R) * rng.range(0.85, 1.1);
            const px = o.cx + Math.cos(a) * rr, py = o.cy + Math.sin(a) * rr;
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          }
          ctx.closePath(); ctx.fill();
        }
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.beginPath(); ctx.arc(o.cx + 2, o.cy + 2, o.r * 0.6, 0, Math.PI * 2); ctx.fill();
        ctx.lineCap = 'butt';
        return;
      }
      if (variant === 4) {
        // tronco partido: tocón con astillas y el resto del árbol caído
        const fa = rng.range(0, Math.PI * 2), FL = o.crown * 1.1;
        ctx.lineWidth = o.r * 1.1;
        ctx.beginPath(); ctx.moveTo(o.cx + Math.cos(fa) * o.r, o.cy + Math.sin(fa) * o.r);
        ctx.lineTo(o.cx + Math.cos(fa) * FL, o.cy + Math.sin(fa) * FL); ctx.stroke();
        branch(o.cx + Math.cos(fa) * FL, o.cy + Math.sin(fa) * FL, fa + 0.4, o.crown * 0.3, o.r * 0.4, 1);
        branch(o.cx + Math.cos(fa) * FL * 0.7, o.cy + Math.sin(fa) * FL * 0.7, fa - 0.7, o.crown * 0.3, o.r * 0.35, 1);
        ctx.fillStyle = U.shade(wood, 1.15);
        ctx.beginPath(); ctx.arc(o.cx, o.cy, o.r * 0.9, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(o.cx, o.cy, o.r * 0.5, 0, Math.PI * 2); ctx.stroke();
        ctx.lineCap = 'butt';
        return;
      }
      const limbs = Math.max(3, o.branches - (variant === 2 ? 0 : 2));
      const base = rng.range(0, Math.PI * 2);
      for (let i = 0; i < limbs; i++) {
        const a = base + (i / limbs) * Math.PI * 2 + rng.range(-0.5, 0.5);
        branch(o.cx, o.cy, a, o.crown * rng.range(0.35, 0.5), o.r * 0.6, variant === 2 ? 3 : 2);
      }
      // follaje seco escaso en algunos árboles
      if (variant === 1) {
        for (let i = 0; i < 6; i++) {
          const a = rng.range(0, Math.PI * 2), d = rng.range(o.crown * 0.3, o.crown * 0.8);
          ctx.fillStyle = rng.pick(['rgba(58,60,40,0.55)', 'rgba(70,62,40,0.5)', 'rgba(48,50,36,0.6)']);
          blobPath(ctx, o.cx + Math.cos(a) * d, o.cy + Math.sin(a) * d, rng.range(5, 11), rng, 7, 0.35); ctx.fill();
        }
      }
      // tronco
      ctx.fillStyle = U.shade(wood, 0.85);
      ctx.beginPath(); ctx.arc(o.cx, o.cy, o.r * 0.8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,235,200,0.07)';
      ctx.beginPath(); ctx.arc(o.cx - o.r * 0.25, o.cy - o.r * 0.25, o.r * 0.4, 0, Math.PI * 2); ctx.fill();
      ctx.lineCap = 'butt';
    }

    drawRock(ctx, o, rng) {
      const base = rng.pick(['#4e4a44', '#57524a', '#45423e', '#5c5448']);
      ctx.fillStyle = base;
      blobPath(ctx, o.cx, o.cy, o.r, rng, 8, 0.18); ctx.fill();
      ctx.fillStyle = 'rgba(255,245,225,0.08)';
      blobPath(ctx, o.cx - o.r * 0.25, o.cy - o.r * 0.3, o.r * 0.55, rng, 7, 0.25); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      blobPath(ctx, o.cx + o.r * 0.3, o.cy + o.r * 0.3, o.r * 0.5, rng, 7, 0.25); ctx.fill();
    }

    // ---------- Mantenimiento ----------
    // Asegura chunks horneados para la vista. Máximo de horneados por frame para evitar tirones.
    prepareView(x0, y0, x1, y1, now, maxBakes) {
      let baked = 0;
      this.now = Math.max(this.now || 0, now);
      const c0 = Math.floor(x0 / CH), c1 = Math.floor(x1 / CH);
      const r0 = Math.floor(y0 / CH), r1 = Math.floor(y1 / CH);
      const visible = [];
      for (let cy = r0; cy <= r1; cy++) {
        for (let cx = c0; cx <= c1; cx++) {
          const ch = this.getChunk(cx, cy);
          ch.lastUsed = now;
          if (!ch.ready && baked < maxBakes) { this.bake(ch); baked++; }
          visible.push(ch);
        }
      }
      return visible;
    }

    // Encola el horneado de los chunks alrededor de la vista (se hace poco a poco con bakeTick).
    prefetch(x0, y0, x1, y1, now) {
      const c0 = Math.floor(x0 / CH), c1 = Math.floor(x1 / CH);
      const r0 = Math.floor(y0 / CH), r1 = Math.floor(y1 / CH);
      for (let cy = r0; cy <= r1; cy++) {
        for (let cx = c0; cx <= c1; cx++) {
          const ch = this.getChunk(cx, cy);
          ch.lastUsed = Math.max(ch.lastUsed, now);
          if (!ch.ready && !this.jobs.has(ch)) this.startJob(ch);
        }
      }
    }

    // Libera datos de chunks muy lejanos.
    prune(px, py) {
      const pcx = Math.floor(px / CH), pcy = Math.floor(py / CH);
      if (this.chunks.size < 180) return;
      for (const [k, ch] of this.chunks) {
        if (Math.abs(ch.cx - pcx) > 6 || Math.abs(ch.cy - pcy) > 6) {
          if (ch.canvas) {
            const i = this.bakedOrder.indexOf(ch);
            if (i >= 0) this.bakedOrder.splice(i, 1);
            if (this.pool.length < 10) this.pool.push({ canvas: ch.canvas, ctx: ch.ctx });
            ch.canvas = null; ch.ctx = null;
          }
          this.jobs.delete(ch);
          this.chunks.delete(k);
        }
      }
    }

    // Reconstruye todo (p. ej. al cambiar calidad).
    rebakeAll() {
      for (const ch of this.bakedOrder) { ch.canvas = null; ch.ctx = null; ch.ready = false; }
      this.bakedOrder.length = 0;
      this.jobs.clear();
    }
  }

  TM.World = World;
})();
