// Plan de un lugar (asentamiento, granja, hallazgo, tramo de carretera, campamento):
// carreteras locales, zonas de suelo, lotes, edificios (detalle perezoso), accesorios, decorado, cofres y pistas. TM.WG.Plan
(function () {
  const U = TM.U;
  const WG = TM.WG = TM.WG || {};
  const G = WG.G;
  const M = 32;

  const CAR_COLORS = ['#5a2a24', '#2f3b48', '#545a5c', '#7a766c', '#3c4430', '#4a3a28', '#23262a', '#6b5a3a', '#6e6e66', '#3b2f40'];
  const ROOF = {
    house: ['#5a3a30', '#4a3a34', '#3e3a36', '#5c4a3c', '#46403a', '#63402f', '#3a4048', '#534a42'],
    flat: ['#4a4846', '#3e3d3b', '#55524c', '#45443f', '#4c4a44'],
    metal: ['#4f5658', '#5c5f5a', '#4a5050', '#6a6458'],
  };
  const WALLC = ['#8a8070', '#9a8f7c', '#7a6a5a', '#a09484', '#6e6458', '#8c7a66', '#7c7468', '#94886e', '#6a5e52', '#8e5a48'];

  class Plan {
    constructor(world, key, kind, seed) {
      this.world = world; this.key = key; this.kind = kind;
      this.rng = new U.RNG((seed >>> 0) || 1);
      this.roads = []; this.areas = []; this.buildings = []; this.props = []; this.obs = [];
      this.decor = []; this.chests = []; this.hints = []; this.roofs = []; this.excl = []; this.dyn = [];
      this.lots = new G.SHash(1024); this.rh = new G.SHash(768);
      this.bN = 0; this.cN = 0;
      this.done = false; this.danger = 0;
      this.bbox = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    }
    grow(x0, y0, x1, y1) {
      const b = this.bbox;
      if (x0 < b.x0) b.x0 = x0; if (y0 < b.y0) b.y0 = y0; if (x1 > b.x1) b.x1 = x1; if (y1 > b.y1) b.y1 = y1;
    }

    // ---------- carreteras ----------
    addRoad(r, draw) {
      if (draw !== false) { this.roads.push(r); this.grow(r.bbox.x0, r.bbox.y0, r.bbox.x1, r.bbox.y1); }
      const p = r.pts, pad = r.w / 2 + (r.side || 0);
      for (let i = 0; i < p.length - 2; i += 2) {
        const s = { r, x0: p[i], y0: p[i + 1], x1: p[i + 2], y1: p[i + 3] };
        this.rh.insert(s, Math.min(s.x0, s.x1) - pad, Math.min(s.y0, s.y1) - pad, Math.max(s.x0, s.x1) + pad, Math.max(s.y0, s.y1) + pad);
      }
      return r;
    }
    // Margen libre entre el rectángulo y el borde de cualquier carretera (incluida la acera)
    roadGap(x, y, w, h, look) {
      let best = Infinity;
      const L = look || 8 * M;
      this.rh.query(x - L, y - L, x + w + L, y + h + L, (s) => {
        const d = G.segRectDist(s.x0, s.y0, s.x1, s.y1, x, y, w, h) - s.r.w / 2 - (s.r.side || 0);
        if (d < best) best = d;
        return best < -1000;
      });
      return best;
    }
    roadDist(x, y, look, skip) {
      let best = Infinity;
      const L = look || 20 * M;
      this.rh.query(x - L, y - L, x + L, y + L, (s) => {
        if (skip && s.r === skip) return false;
        const d = Math.sqrt(G.segPointDist2(s.x0, s.y0, s.x1, s.y1, x, y)) - s.r.w / 2;
        if (d < best) best = d;
        return false;
      });
      return best;
    }
    // Punto más cercano sobre carreteras (excepto skip)
    nearestRoadPoint(x, y, look, skip) {
      let best = null, bd = Infinity;
      this.rh.query(x - look, y - look, x + look, y + look, (s) => {
        if (skip && (s.r === skip || (Array.isArray(skip) && skip.includes(s.r)))) return false;
        const dx = s.x1 - s.x0, dy = s.y1 - s.y0, L = dx * dx + dy * dy || 1;
        const t = U.clamp(((x - s.x0) * dx + (y - s.y0) * dy) / L, 0, 1);
        const px = s.x0 + dx * t, py = s.y0 + dy * t;
        const d = Math.hypot(px - x, py - y);
        if (d < bd) { bd = d; best = { x: px, y: py, d, r: s.r }; }
        return false;
      });
      return best;
    }

    // ---------- lotes y reservas ----------
    reserve(r, pad) {
      const p = pad || 0;
      this.lots.insert(r, r.x - p, r.y - p, r.x + r.w + p, r.y + r.h + p);
      this.excl.push(r);
      this.grow(r.x, r.y, r.x + r.w, r.y + r.h);
    }
    rectFree(r, pad) {
      const p = pad || 0;
      return !this.lots.query(r.x - p, r.y - p, r.x + r.w + p, r.y + r.h + p, (o) => G.overlap(r, o, p));
    }
    // Barrido grueso (repartido en pasos) para saber si en toda la zona no hay agua
    * dryScan() {
      const T = this.world.terrain, b = this.bbox;
      if (!isFinite(b.x0)) { this.dryArea = false; return; }
      const step = 1024;
      for (let y = b.y0 - 2048; y <= b.y1 + 2048; y += step) {
        if (T.mayHaveWaterCoarse(b.x0 - 2048, y, b.x1 + 2048, y)) { this.dryArea = false; return; }
        yield;
      }
      this.dryArea = true;
    }
    terrainOk(r) {
      const T = this.world.terrain;
      // sin agua en toda la zona: no hace falta comprobar
      if (this.dryArea === undefined) {
        const b = this.bbox;
        this.dryArea = isFinite(b.x0) ? !T.mayHaveWaterCoarse(b.x0 - 2048, b.y0 - 2048, b.x1 + 2048, b.y1 + 2048) : false;
      }
      if (this.dryArea) return true;
      const nx = Math.max(2, Math.ceil(r.w / (14 * M))), ny = Math.max(2, Math.ceil(r.h / (14 * M)));
      const cache = this._tc || (this._tc = new Map());
      for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
        const x = Math.round((r.x + (r.w * i) / nx) / 64), y = Math.round((r.y + (r.h * j) / ny) / 64);
        const k = x * 100003 + y;
        let v = cache.get(k);
        if (v === undefined) { v = T.blocked(x * 64, y * 64); cache.set(k, v); }
        if (v) return false;
      }
      return true;
    }
    safeOk(r) {
      const R = TM.Config.SAFE_RADIUS + 22 * M;
      const qx = U.clamp(0, r.x, r.x + r.w), qy = U.clamp(0, r.y, r.y + r.h);
      return qx * qx + qy * qy > R * R;
    }
    okRect(r, pad, roadMargin) {
      if (!this.safeOk(r)) return false;
      if (!this.rectFree(r, pad || 0)) return false;
      if (this.roadGap(r.x, r.y, r.w, r.h) < (roadMargin === undefined ? 12 : roadMargin)) return false;
      return this.terrainOk(r);
    }

    // ---------- elementos ----------
    area(mat, x, y, w, h, extra) {
      const a = Object.assign({ mat, x, y, w, h }, extra || {});
      this.areas.push(a);
      this.grow(x, y, x + w, y + h);
      return a;
    }
    circleArea(mat, cx, cy, r, extra) {
      const a = Object.assign({ mat, circle: true, cx, cy, r, x: cx - r, y: cy - r, w: r * 2, h: r * 2 }, extra || {});
      this.areas.push(a);
      this.grow(cx - r, cy - r, cx + r, cy + r);
      return a;
    }
    building(type, sub, x, y, w, h, front, extra) {
      const rng = this.rng;
      const b = Object.assign({
        id: this.key + 'b' + (this.bN++), type, sub: sub || null, x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h),
        front: front || 's', seed: rng.int(1, 2e9), danger: +(this.danger + rng.range(-0.1, 0.25)).toFixed(2), indoor: true, roofAlpha: 1,
        wallColor: rng.pick(WALLC), det: null,
      }, extra || {});
      if (!b.roofStyle) {
        if (type === 'house' || type === 'farmhouse' || type === 'church') b.roofStyle = rng.chance(0.75) ? 'gable' : 'hip';
        else if (type === 'barn' || type === 'warehouse' || type === 'factory' || type === 'garage') b.roofStyle = 'metal';
        else if (type === 'bunker') b.roofStyle = 'earth';
        else b.roofStyle = 'flat';
        if (b.sub === 'shed' || b.sub === 'cabin' || b.sub === 'hideout' || b.sub === 'shack') b.roofStyle = rng.chance(0.5) ? 'metal' : 'gable';
      }
      if (!b.roofColor) b.roofColor = rng.pick(b.roofStyle === 'flat' ? ROOF.flat : b.roofStyle === 'metal' ? ROOF.metal : b.roofStyle === 'earth' ? ['#3c3a2a'] : ROOF.house);
      if (type === 'barn' && rng.chance(0.6)) b.roofColor = rng.pick(['#6a2e24', '#5a2a22', '#4f3a2a']);
      // ruinas por peligro o por estar en zona quemada
      const burn = this.world.terrain.burn(b.x + b.w / 2, b.y + b.h / 2);
      if (burn > 0.3 || (b.ruined === undefined && rng.chance(0.05 + 0.025 * Math.min(this.danger, 4)))) b.ruined = true;
      if (burn > 0.3) b.burned = true;
      this.buildings.push(b);
      this.grow(b.x - 60, b.y - 60, b.x + b.w + 60, b.y + b.h + 60);
      return b;
    }
    // Accesorio dibujable con obstáculos opcionales
    prop(kind, x, y, extra, obs) {
      const p = Object.assign({ kind, x, y, seed: this.rng.int(1, 2e9) }, extra || {});
      p.obs = obs || [];
      for (const o of p.obs) { o.prop = p; this.obs.push(o); }
      this.props.push(p);
      const ext = (p.ext || 40);
      this.grow(x - ext, y - ext, x + ext, y + ext);
      return p;
    }
    rectProp(kind, x, y, w, h, extra, blocksSight) {
      const o = { shape: 'rect', kind, x, y, w, h, blocksSight: !!blocksSight };
      return this.prop(kind, x + w / 2, y + h / 2, Object.assign({ w, h, ext: Math.max(w, h) / 2 + 24 }, extra || {}), [o]);
    }
    circleProp(kind, cx, cy, r, extra, blocksSight) {
      const o = { shape: 'circle', kind, cx, cy, r, blocksSight: !!blocksSight };
      return this.prop(kind, cx, cy, Object.assign({ r, ext: r + 24 }, extra || {}), [o]);
    }
    decal(kind, x, y, s, rot, extra) {
      const d = Object.assign({ kind, x, y, s: s || 1, rot: rot || 0, seed: this.rng.int(1, 2e9) }, extra || {});
      this.decor.push(d);
      return d;
    }
    chest(x, y, container, btype, boost, extra) {
      const c = WG.makeChest(this.rng, this.key + 'c' + (this.cN++), x, y, container, btype || 'other', this.danger, null, boost, extra);
      this.chests.push(c);
      return c;
    }
    hint(x, y, extra) { this.hints.push(Object.assign({ x, y, indoor: false, buildingType: null, danger: this.danger }, extra || {})); }

    // Auto abandonado: rectángulo si está alineado a los ejes, si no tres círculos
    car(x, y, ang, opts) {
      opts = opts || {};
      const rng = this.rng;
      const L = opts.L || 144, W = opts.W || 60;
      const a = ((ang % Math.PI) + Math.PI) % Math.PI;
      const axis = Math.min(Math.abs(a), Math.abs(a - Math.PI / 2), Math.abs(a - Math.PI)) < 0.14;
      const obs = [];
      if (axis) {
        const horiz = Math.abs(a) < 0.3 || Math.abs(a - Math.PI) < 0.3;
        const w = horiz ? L : W, h = horiz ? W : L;
        obs.push({ shape: 'rect', kind: 'car', x: x - w / 2, y: y - h / 2, w, h, blocksSight: false });
      } else {
        const cx = Math.cos(ang), cy = Math.sin(ang), rr = W / 2;
        for (const k of [-1, 0, 1]) obs.push({ shape: 'circle', kind: 'car', cx: x + cx * k * (L / 2 - rr), cy: y + cy * k * (L / 2 - rr), r: rr, blocksSight: false });
      }
      const kind = opts.kind || 'car';
      const p = this.prop(kind, x, y, {
        ang, L, W, color: opts.color || rng.pick(CAR_COLORS), burned: opts.burned !== undefined ? opts.burned : rng.chance(0.2),
        doorOpen: rng.chance(0.3), ext: L / 2 + 30, style: opts.style || rng.int(0, 3), wreck: !!opts.wreck,
      }, obs);
      if (opts.trunk !== false && rng.chance(opts.trunkP === undefined ? 0.55 : opts.trunkP) && !p.burned) {
        const tx = x - Math.cos(ang) * (L / 2 + 4), ty = y - Math.sin(ang) * (L / 2 + 4);
        const c = this.chest(tx, ty, opts.container || 'maletero', opts.btype || 'other', opts.boost);
        p.chestId = c.id;
      }
      return p;
    }
    tree(x, y, size, opts) {
      const rng = this.rng;
      const crown = size || rng.range(64, 120);
      return this.circleProp('tree', x, y, Math.max(7, crown * 0.11), Object.assign({ crown, branches: rng.int(5, 8), ext: crown + 30, burned: this.world.terrain.burn(x, y) > 0.3 }, opts || {}));
    }
    // Valla recta alineada (tramo) con huecos opcionales
    fence(x0, y0, x1, y1, style, gaps) {
      const horiz = Math.abs(y1 - y0) < Math.abs(x1 - x0);
      const th = style === 'concrete' ? 14 : style === 'stone' ? 10 : 5;
      const a0 = horiz ? Math.min(x0, x1) : Math.min(y0, y1), a1 = horiz ? Math.max(x0, x1) : Math.max(y0, y1);
      const cuts = (gaps || []).slice().sort((p, q) => p[0] - q[0]);
      let cur = a0;
      const seg = (s0, s1) => {
        if (s1 - s0 < 6) return;
        if (horiz) this.rectProp('fence', s0, y0 - th / 2, s1 - s0, th, { style, horiz: true }, style === 'concrete');
        else this.rectProp('fence', x0 - th / 2, s0, th, s1 - s0, { style, horiz: false }, style === 'concrete');
      };
      for (const [g0, g1] of cuts) { seg(cur, Math.max(cur, g0)); cur = Math.max(cur, g1); }
      seg(cur, a1);
    }

    // Índice por chunk (tras terminar el plan)
    index(CH) { const g = this.indexGen(CH); while (!g.next().done) { /* */ } return this.idx; }
    * indexGen(CH) {
      const idx = new Map();
      const B = (cx, cy) => {
        const k = cx + ',' + cy;
        let b = idx.get(k);
        if (!b) { b = { roads: [], areas: [], buildings: [], props: [], obs: [], decor: [], chests: [], hints: [], roofs: [], excl: [], dyn: [] }; idx.set(k, b); }
        return b;
      };
      const put = (list, item, x0, y0, x1, y1) => {
        const c0 = Math.floor(x0 / CH), c1 = Math.floor(x1 / CH), r0 = Math.floor(y0 / CH), r1 = Math.floor(y1 / CH);
        for (let j = r0; j <= r1; j++) for (let i = c0; i <= c1; i++) B(i, j)[list].push(item);
      };
      let nr = 0;
      for (const r of this.roads) {
        if (WG.over()) yield;
        // por segmentos para no meter carreteras largas en chunks que solo tocan su caja
        const p = r.pts, pad = r.w / 2 + (r.side || 0) + 24;
        const seen = new Set();
        for (let i = 0; i < p.length - 2; i += 2) {
          const x0 = Math.min(p[i], p[i + 2]) - pad, x1 = Math.max(p[i], p[i + 2]) + pad;
          const y0 = Math.min(p[i + 1], p[i + 3]) - pad, y1 = Math.max(p[i + 1], p[i + 3]) + pad;
          for (let j = Math.floor(y0 / CH); j <= Math.floor(y1 / CH); j++) for (let k = Math.floor(x0 / CH); k <= Math.floor(x1 / CH); k++) {
            const key = k + ',' + j;
            if (seen.has(key)) continue;
            seen.add(key);
            B(k, j).roads.push(r);
          }
        }
      }
      yield;
      for (const a of this.areas) put("areas", a, a.x, a.y, a.x + a.w, a.y + a.h);
      yield;
      for (const b of this.buildings) put('buildings', b, b.x - 64, b.y - 64, b.x + b.w + 64, b.y + b.h + 64);
      let n = 0;
      for (const p of this.props) { const e = p.ext || 40; put("props", p, p.x - e, p.y - e, p.x + e, p.y + e); if (WG.over()) yield; }
      yield;
      for (const o of this.obs) {
        if (WG.over()) yield;
        if (o.shape === 'rect') put('obs', o, o.x, o.y, o.x + o.w, o.y + o.h);
        else put('obs', o, o.cx - o.r, o.cy - o.r, o.cx + o.r, o.cy + o.r);
      }
      yield;
      for (const d of this.decor) { const e = 40 * (d.s || 1) + (d.size || 0) * 6; put("decor", d, d.x - e, d.y - e, d.x + e, d.y + e); if (WG.over()) yield; }
      for (const c of this.chests) put('chests', c, c.x, c.y, c.x, c.y);
      for (const h of this.hints) put('hints', h, h.x, h.y, h.x, h.y);
      for (const r of this.roofs) put('roofs', r, r.x - 16, r.y - 16, r.x + r.w + 16, r.y + r.h + 16);
      for (const e of this.excl) put('excl', e, e.x, e.y, e.x + e.w, e.y + e.h);
      for (const d of this.dyn) put('dyn', d, d.x, d.y, d.x, d.y);
      this.idx = idx;
      return idx;
    }
  }

  Plan.CAR_COLORS = CAR_COLORS;
  WG.Plan = Plan;
})();
