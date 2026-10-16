// Mundo v2: generación jerárquica perezosa (paisaje → sitios → planes → chunks), colisión, raycast,
// puertas, cofres, objetos del suelo, techos y pre-renderizado incremental por chunks.
(function () {
  const U = TM.U;
  const WG = TM.WG;
  const CH = TM.Config.CHUNK;
  const SUB = 4, SC = CH / SUB; // subrejilla de obstáculos por chunk (128 u)
  const M = 32;

  // Suelo: capas que se mezclan por chunk
  const LAYERS = ['forest', 'plains', 'farmland', 'desert', 'swamp', 'urban', 'ash', 'drymud'];
  const SAMPLE = 5; // muestras por lado (cada 128 u)

  class World {
    constructor(seed) {
      this.seed = seed | 0;
      this.terrain = new WG.Terrain(this.seed);
      this.macro = new WG.Macro(this.seed, this.terrain);
      this.chunks = new Map();
      this.plans = new Map();          // clave -> { src, P, gen }
      this.jobs = [];                  // trabajos por prioridad
      this.jobMap = new Map();
      this.bakedOrder = []; this.roofOrder = [];
      this.pool = []; this.roofPool = [];
      this.doorIndex = new Map(); this.chestIndex = new Map();
      this.doorState = new Map();      // id -> [open, broken, hp] (persistente)
      this.opened = new Set();         // cofres abiertos (persistente)
      this.ground = new Map(); this.groundById = new Map(); this.nextG = 1;
      this.fading = new Set();
      this.curB = null;
      this.qs = 1;
      this.now = 0;
      this._tmp = null;
      this.stats = { popMs: 0, bakeMs: 0, planMs: 0, maxStep: 0, maxStepKey: '' };
    }

    static initTextures() {
      WG.Tex.init();
      World.tiles = WG.Tex.tiles;
    }

    key(cx, cy) { return cx + ',' + cy; }

    // ---------- peligro, bioma y lugar ----------
    dangerAt(x, y) { return Math.hypot(x, y) / TM.Config.DANGER_DIST + this.macro.dangerBonus(x, y); }

    biomeAt(x, y) {
      const k = this.terrain.kindAt(x, y);
      if (k === 1 || k === 2) return 'water';
      const ch = this.chunks.get(this.key(Math.floor(x / CH), Math.floor(y / CH)));
      if (ch && ch.state === 2) {
        for (const r of ch.roads) {
          const b = r.bbox;
          if (x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1) continue;
          if (WG.G.roadDist(r, x, y) < r.w / 2) return 'road';
        }
      }
      const S = this.macro.settlementAt(x, y);
      if (S && S.rank >= 2 && Math.hypot(x - S.x, y - S.y) < S.R * 0.85) return 'city';
      return this.terrain.dominant(x, y);
    }

    placeAt(x, y) {
      const out = { biome: this.terrain.dominant(x, y), settlement: 'none', district: null, poi: null };
      const S = this.macro.settlementAt(x, y);
      if (S) {
        if (S.type === 'special') { out.poi = S.sub; out.settlement = 'none'; }
        else {
          out.settlement = S.type;
          const d = Math.hypot(x - S.x, y - S.y) / S.R;
          out.district = S.type === 'village' ? (d > 0.8 ? 'periferia' : 'residencial') : d < 0.25 ? 'centro' : d > 0.88 ? 'periferia' : 'residencial';
          if (S.ind !== undefined && d > 0.4 && Math.abs(U.angDiff(Math.atan2(y - S.y, x - S.x), S.ind)) < S.indW) out.district = 'industrial';
        }
      } else {
        const F = this.macro.FARM;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const f = this.macro.farm(Math.floor(x / F) + di, Math.floor(y / F) + dj);
          if (f && Math.hypot(f.x - x, f.y - y) < f.R * 1.6) { out.settlement = 'farm'; out.poi = f.type; }
        }
        const RR = this.macro.RARE;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const r = this.macro.rare(Math.floor(x / RR) + di, Math.floor(y / RR) + dj);
          if (r && Math.hypot(r.x - x, r.y - y) < r.R * 1.5) out.poi = r.type;
        }
      }
      const b = this.buildingAt(x, y);
      if (b) out.poi = b.type;
      if (Math.hypot(x, y) < TM.Config.SAFE_RADIUS) out.poi = 'campamento';
      return out;
    }

    // ---------- planes ----------
    planSources(x0, y0, x1, y1) {
      const list = this.macro.plansInRect(x0, y0, x1, y1, []);
      if (x0 < 700 && x1 > -700 && y0 < 700 && y1 > -700) list.push({ key: 'camp', camp: true });
      return list;
    }
    planEntry(src) {
      let e = this.plans.get(src.key);
      if (!e) {
        let gen;
        if (src.camp) gen = WG.Places.planCamp(this);
        else if (src.kind === 'farm') gen = WG.Places.planFarm(this, src);
        else if (src.kind === 'rare') gen = WG.Places.planRare(this, src);
        else if (src.A) gen = WG.Places.planEdge(this, src);
        else if (src.type === 'special') gen = WG.Places.planSpecial(this, src);
        else gen = WG.Settle.plan(this, src);
        const base = gen;
        const full = (function* () { const P = yield* base; if (P && P.indexGen) yield* P.indexGen(CH); return P; })();
        e = { src, gen: full, P: null, key: src.key };
        this.plans.set(src.key, e);
      }
      return e;
    }
    // Avanza el plan; devuelve true si terminó
    stepPlan(e) {
      if (e.P) return true;
      const t0 = performance.now();
      let r;
      try { r = e.gen.next(); } catch (err) { console.error('plan', e.key, err); r = { done: true, value: null }; }
      this.stats.planMs += performance.now() - t0;
      if (r.done) {
        e.P = r.value || new WG.Plan(this, e.key, 'empty', 1);
        this.finishPlan(e.P);
        return true;
      }
      return false;
    }
    * planRun(e) { while (!this.stepPlan(e)) yield; }
    finishPlan(P) {
      if (!P.idx) P.index(CH);
      const byId = new Map();
      for (const c of P.chests) {
        c.loose = true;
        if (this.opened.has(c.id)) c.opened = true;
        byId.set(c.id, c);
        this.chestIndex.set(c.id, c);
      }
      for (const p of P.props) if (p.chestId && byId.has(p.chestId)) byId.get(p.chestId).loose = false;
      for (const b of P.buildings) b.plan = P;
    }

    // ---------- chunks ----------
    chunkObj(cx, cy) {
      const k = this.key(cx, cy);
      let ch = this.chunks.get(k);
      if (!ch) {
        ch = {
          cx, cy, x0: cx * CH, y0: cy * CH, key: k, state: 0, popGen: null,
          obs: [], grid: null, props: [], decor: [], areas: [], roads: [], buildings: [], doors: [], chests: [],
          hints: [], roofs: [], excl: [], dyn: [], water: null, blood: [],
          canvas: null, ctx: null, ready: false, roofCanvas: null, roofCtx: null, roofDone: false, hasRoof: false, lastUsed: 0,
        };
        this.chunks.set(k, ch);
      }
      return ch;
    }
    getChunk(cx, cy) {
      const ch = this.chunkObj(cx, cy);
      if (ch.state !== 2) this.populateSync(ch);
      return ch;
    }
    populateSync(ch) {
      if (!ch.popGen) ch.popGen = this.popGen(ch);
      const t0 = performance.now();
      while (ch.state !== 2) { if (ch.popGen.next().done) break; }
      this.stats.popMs += performance.now() - t0;
    }

    * popGen(ch) {
      ch.state = 1;
      const x0 = ch.x0, y0 = ch.y0, x1 = x0 + CH, y1 = y0 + CH;
      const srcs = this.planSources(x0, y0, x1, y1);
      const entries = [];
      for (const s of srcs) {
        const e = this.planEntry(s);
        if (!e.P) yield* this.planRun(e);
        entries.push(e);
      }
      yield 'pop-gather';
      const seenB = new Set();
      for (const e of entries) {
        const b = e.P.idx && e.P.idx.get(ch.key);
        if (!b) continue;
        for (const r of b.roads) if (!ch.roads.includes(r)) ch.roads.push(r);
        for (const a of b.areas) ch.areas.push(a);
        for (const p of b.props) ch.props.push(p);
        for (const o of b.obs) ch.obs.push(o);
        for (const d of b.decor) ch.decor.push(d);
        for (const c of b.chests) ch.chests.push(c);
        for (const h of b.hints) ch.hints.push(h);
        for (const r of b.roofs) { if (!r.id) r.id = e.key + 'r' + Math.round(r.x) + '_' + Math.round(r.y); r.roofAlpha = r.roofAlpha === undefined ? 1 : r.roofAlpha; ch.roofs.push(r); }
        for (const x of b.excl) ch.excl.push(x);
        for (const d of b.dyn) ch.dyn.push(d);
        for (const bd of b.buildings) if (!seenB.has(bd.id)) { seenB.add(bd.id); ch.buildings.push(bd); }
      }
      // detalle de edificios (perezoso, uno por paso)
      for (const b of ch.buildings) {
        // el generador de detalle se comparte por si otro chunk pide el mismo edificio a la vez
        while (!b.det) {
          if (!b._dg) b._dg = WG.Build.detailGen(b);
          const t0 = performance.now();
          let r;
          try { r = b._dg.next(); } catch (err) { console.error('edificio', b.id, err); r = { done: true, value: null }; }
          this.stats.popMs += performance.now() - t0;
          if (r.done) {
            b.det = r.value || { obs: [], doors: [], chests: [], floors: [], walls: [], windows: [], furn: [], decor: [], hints: [], rooms: [], extDoors: [] };
            b._dg = null;
            this.applyBuildingState(b);
          }
          yield 'pop-detail';
        }
        const det = b.det;
        for (const o of det.obs) {
          if (o.x > x1 || o.x + o.w < x0 || o.y > y1 || o.y + o.h < y0) continue;
          ch.obs.push(o);
          if (o.kind === 'door') ch.doors.push(o);
        }
        for (const c of det.chests) if (c.x >= x0 && c.x < x1 && c.y >= y0 && c.y < y1) ch.chests.push(c);
        for (const h of det.hints) if (h.x >= x0 && h.x < x1 && h.y >= y0 && h.y < y1) ch.hints.push(h);
        if (b.x < x1 && b.x + b.w > x0 && b.y < y1 && b.y + b.h > y0) ch.excl.push(b);
      }
      yield 'pop-collect';
      // agua y barrancos
      yield* this.terrainGen(ch);
      // naturaleza
      WG.Land.populate(this, ch);
      this.buildGrid(ch);
      ch.hasRoof = ch.roofs.length > 0 || ch.buildings.some((b) => b.x < x1 + 8 && b.x + b.w > x0 - 8 && b.y < y1 + 8 && b.y + b.h > y0 - 8);
      ch.biome = this.terrain.dominant(x0 + CH / 2, y0 + CH / 2);
      ch.state = 2;
      ch.popGen = null;
    }

    applyBuildingState(b) {
      for (const d of b.det.doors) {
        this.doorIndex.set(d.id, d);
        const s = this.doorState.get(d.id);
        if (s) { d.open = !!s[0]; d.broken = !!s[1]; d.hp = s[2]; if (d.broken) d.open = false; }
      }
      for (const c of b.det.chests) {
        if (this.opened.has(c.id)) c.opened = true;
        this.chestIndex.set(c.id, c);
      }
    }

    // Máscara de agua (8 u) y obstáculos (celdas de 16 u fusionadas)
    * terrainGen(ch) {
      const T = this.terrain;
      const x0 = ch.x0, y0 = ch.y0;
      if (!T.mayHaveWater(x0 - 24, y0 - 24, x0 + CH + 24, y0 + CH + 24)) { ch.water = null; return; }
      const N = 64, S = CH / N;
      const mask = new Uint8Array(N * N);
      const roads = ch.roads.filter((r) => !r.collapsed);
      let any = false;
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          const x = x0 + (i + 0.5) * S, y = y0 + (j + 0.5) * S;
          let k = T.kindAt(x, y);
          if (k) {
            for (const r of roads) {
              const b = r.bbox;
              if (x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1) continue;
              const d = WG.G.roadDist(r, x, y);
              if (d < r.w / 2 + 2) { k = 0; break; }
              if (d < r.w / 2 + 12) k = 4; // barandilla del puente
            }
          }
          if (k) any = true;
          mask[j * N + i] = k;
        }
        if (WG.over()) yield 'pop-water';
      }
      if (!any) { ch.water = null; return; }
      ch.water = { mask, N };
      // celdas de colisión de 16 u (2x2 píxeles): bloqueada si 2 o más píxeles son agua/barranco
      const C = N / 2;
      const cell = new Uint8Array(C * C);
      for (let j = 0; j < C; j++) for (let i = 0; i < C; i++) {
        let n = 0, kind = 0;
        for (let dj = 0; dj < 2; dj++) for (let di = 0; di < 2; di++) {
          const v = mask[(j * 2 + dj) * N + i * 2 + di];
          if (v) { n++; kind = v; }
        }
        cell[j * C + i] = n >= 2 ? (kind === 3 ? 2 : 1) : 0;
      }
      // fusión por filas y luego vertical
      const runs = [];
      for (let j = 0; j < C; j++) {
        let i = 0;
        while (i < C) {
          const v = cell[j * C + i];
          if (!v) { i++; continue; }
          let e = i;
          while (e + 1 < C && cell[j * C + e + 1] === v) e++;
          runs.push({ i0: i, i1: e, j0: j, j1: j, v });
          i = e + 1;
        }
      }
      const merged = [];
      const open = new Map();
      for (const r of runs) {
        const k = r.i0 + ',' + r.i1 + ',' + r.v;
        const prev = open.get(k);
        if (prev && prev.j1 === r.j0 - 1) prev.j1 = r.j0;
        else { merged.push(r); open.set(k, r); }
      }
      const cs = CH / C;
      for (const r of merged) {
        ch.obs.push({ shape: 'rect', kind: r.v === 2 ? 'ravine' : 'water', x: x0 + r.i0 * cs, y: y0 + r.j0 * cs, w: (r.i1 - r.i0 + 1) * cs, h: (r.j1 - r.j0 + 1) * cs, blocksSight: false, over: true });
        ch.excl.push({ x: x0 + r.i0 * cs, y: y0 + r.j0 * cs, w: (r.i1 - r.i0 + 1) * cs, h: (r.j1 - r.j0 + 1) * cs });
      }
    }

    buildGrid(ch) {
      const g = new Array(SUB * SUB);
      for (let i = 0; i < g.length; i++) g[i] = [];
      const x0 = ch.x0, y0 = ch.y0;
      for (const o of ch.obs) {
        let ax, ay, bx, by;
        if (o.shape === 'rect') { ax = o.x; ay = o.y; bx = o.x + o.w; by = o.y + o.h; }
        else { ax = o.cx - o.r; ay = o.cy - o.r; bx = o.cx + o.r; by = o.cy + o.r; }
        const i0 = Math.max(0, Math.floor((ax - x0) / SC)), i1 = Math.min(SUB - 1, Math.floor((bx - x0) / SC));
        const j0 = Math.max(0, Math.floor((ay - y0) / SC)), j1 = Math.min(SUB - 1, Math.floor((by - y0) / SC));
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) g[j * SUB + i].push(o);
      }
      ch.grid = g;
    }

    // ---------- consultas ----------
    forChunksInRect(x0, y0, x1, y1, fn) {
      const c0 = Math.floor(x0 / CH), c1 = Math.floor(x1 / CH);
      const r0 = Math.floor(y0 / CH), r1 = Math.floor(y1 / CH);
      for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) fn(this.getChunk(cx, cy));
    }

    queryObstacles(x0, y0, x1, y1, out) {
      out = out || [];
      const st = ++this.qs;
      const c0 = Math.floor(x0 / CH), c1 = Math.floor(x1 / CH);
      const r0 = Math.floor(y0 / CH), r1 = Math.floor(y1 / CH);
      for (let cy = r0; cy <= r1; cy++) {
        for (let cx = c0; cx <= c1; cx++) {
          const ch = this.getChunk(cx, cy);
          const gx0 = ch.x0, gy0 = ch.y0;
          const i0 = Math.max(0, Math.floor((x0 - gx0) / SC)), i1 = Math.min(SUB - 1, Math.floor((x1 - gx0) / SC));
          const j0 = Math.max(0, Math.floor((y0 - gy0) / SC)), j1 = Math.min(SUB - 1, Math.floor((y1 - gy0) / SC));
          for (let j = j0; j <= j1; j++) {
            for (let i = i0; i <= i1; i++) {
              const list = ch.grid[j * SUB + i];
              for (let n = 0; n < list.length; n++) {
                const o = list[n];
                if (o._qs === st) continue;
                o._qs = st;
                if (o.kind === 'door' && (o.open || o.broken)) continue;
                if (o.shape === 'rect') {
                  if (o.x > x1 || o.x + o.w < x0 || o.y > y1 || o.y + o.h < y0) continue;
                } else if (o.cx + o.r < x0 || o.cx - o.r > x1 || o.cy + o.r < y0 || o.cy - o.r > y1) continue;
                out.push(o);
              }
            }
          }
        }
      }
      return out;
    }

    collideCircle(ent) {
      const r = ent.r;
      let hit = false;
      const list = this.queryObstacles(ent.x - r - 2, ent.y - r - 2, ent.x + r + 2, ent.y + r + 2, this._qbuf || (this._qbuf = []));
      const isPlayer = TM.game && ent === TM.game.player;
      for (let pass = 0; pass < 2; pass++) {
        for (const o of list) {
          if (o.kind === 'door' && (o.open || o.broken)) continue;
          if (o.shape === 'rect') {
            const px = U.clamp(ent.x, o.x, o.x + o.w), py = U.clamp(ent.y, o.y, o.y + o.h);
            const dx = ent.x - px, dy = ent.y - py;
            const d2 = dx * dx + dy * dy;
            if (d2 >= r * r) continue;
            hit = true;
            // el jugador abre las puertas al empujarlas
            if (isPlayer && o.kind === 'door' && pass === 0 && this.tryPushDoor(ent, o)) continue;
            if (d2 > 1e-6) {
              const d = Math.sqrt(d2), push = r - d;
              ent.x += (dx / d) * push; ent.y += (dy / d) * push;
            } else {
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
    tryPushDoor(p, d) {
      if (d.locked || d.open || d.broken) return false;
      // solo si avanza hacia la puerta
      const vx = p.vx || 0, vy = p.vy || 0;
      const nx = d.horiz ? 0 : Math.sign(d.cx - p.x), ny = d.horiz ? Math.sign(d.cy - p.y) : 0;
      if (vx * nx + vy * ny < 25) return false;
      this.setDoor(d.id, true);
      const g = TM.game;
      if (TM.Audio) TM.Audio.play('door_open', d.cx, d.cy);
      if (g && g.emitNoise) g.emitNoise(d.cx, d.cy, 180, 'door');
      return true;
    }

    isFree(x, y, r) {
      const list = this.queryObstacles(x - r, y - r, x + r, y + r, this._fbuf || (this._fbuf = []));
      let ok = true;
      for (const o of list) {
        if (o.shape === 'rect') {
          const px = U.clamp(x, o.x, o.x + o.w), py = U.clamp(y, o.y, o.y + o.h);
          if (U.dist2(x, y, px, py) < r * r) { ok = false; break; }
        } else if (U.dist2(x, y, o.cx, o.cy) < (r + o.r) * (r + o.r)) { ok = false; break; }
      }
      list.length = 0;
      return ok;
    }

    _ray(x0, y0, x1, y1, sightOnly) {
      const list = this.queryObstacles(Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1), this._rbuf || (this._rbuf = []));
      let best = 1, bestO = null;
      for (const o of list) {
        if (sightOnly ? !o.blocksSight : o.over) continue;
        const t = o.shape === 'rect'
          ? U.segRect(x0, y0, x1, y1, o.x, o.y, o.w, o.h)
          : U.segCircle(x0, y0, x1, y1, o.cx, o.cy, o.r);
        if (t >= 0 && t < best) { best = t; bestO = o; }
      }
      list.length = 0;
      this.lastRayObstacle = bestO;
      return best;
    }
    // raycast: obstáculos sólidos (el agua y los barrancos no frenan balas). lineOfSight: solo los que tapan la vista.
    raycast(x0, y0, x1, y1) { return this._ray(x0, y0, x1, y1, false); }
    lineOfSight(x0, y0, x1, y1) { return this._ray(x0, y0, x1, y1, true) >= 1; }

    // Rejilla para el campo de flujo: 1 = bloqueado, 2 = puerta cerrada (pasable con coste). Muestreo por centro de celda.
    rasterize(x0, y0, cols, rows, cell, inflate) {
      const grid = new Uint8Array(cols * rows);
      const inf = inflate || 0;
      const list = this.queryObstacles(x0 - inf - cell, y0 - inf - cell, x0 + cols * cell + inf + cell, y0 + rows * cell + inf + cell, []);
      const fill = (o, val) => {
        const c0 = Math.max(0, Math.ceil((o.x - inf - x0) / cell - 0.5));
        const c1 = Math.min(cols - 1, Math.floor((o.x + o.w + inf - x0) / cell - 0.5));
        const r0 = Math.max(0, Math.ceil((o.y - inf - y0) / cell - 0.5));
        const r1 = Math.min(rows - 1, Math.floor((o.y + o.h + inf - y0) / cell - 0.5));
        for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) { const k = r * cols + c; if (grid[k] < val || val === 1) grid[k] = val === 1 ? 1 : (grid[k] === 1 ? 1 : val); }
      };
      // primero las puertas cerradas (2), luego lo demás (1) encima
      for (const o of list) if (o.kind === 'door') fill(o, 2);
      for (const o of list) {
        if (o.kind === 'door') continue;
        if (o.shape === 'rect') fill(o, 1);
        else {
          const rr = o.r + inf;
          const c0 = Math.max(0, Math.floor((o.cx - rr - x0) / cell));
          const c1 = Math.min(cols - 1, Math.floor((o.cx + rr - x0) / cell));
          const r0 = Math.max(0, Math.floor((o.cy - rr - y0) / cell));
          const r1 = Math.min(rows - 1, Math.floor((o.cy + rr - y0) / cell));
          for (let r = r0; r <= r1; r++) {
            for (let c = c0; c <= c1; c++) {
              const px = x0 + (c + 0.5) * cell, py = y0 + (r + 0.5) * cell;
              if (U.dist2(px, py, o.cx, o.cy) <= rr * rr) grid[r * cols + c] = 1;
            }
          }
        }
      }
      return grid;
    }

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

    // ---------- edificios, puertas y cofres ----------
    buildingAt(x, y) {
      const ch = this.getChunk(Math.floor(x / CH), Math.floor(y / CH));
      for (const b of ch.buildings) if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b;
      return null;
    }
    // estructura con techo bajo un punto (edificio o marquesina)
    roofAt(x, y) {
      const ch = this.chunks.get(this.key(Math.floor(x / CH), Math.floor(y / CH)));
      if (!ch || ch.state !== 2) return null;
      for (const b of ch.buildings) if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b;
      for (const r of ch.roofs) if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return r;
      return null;
    }
    // ¿Está (x,y) tapado por un techo opaco? (para ocultar zombies dentro de edificios)
    roofCovers(x, y) {
      const s = this.roofAt(x, y);
      return !!(s && s.roofAlpha > 0.55 && s !== this.curB);
    }

    doorsNear(x, y, r) {
      const out = [];
      const st = ++this.qs;
      this.forChunksInRect(x - r, y - r, x + r, y + r, (ch) => {
        for (const d of ch.doors) {
          if (d._qs === st) continue;
          d._qs = st;
          const px = U.clamp(x, d.x, d.x + d.w), py = U.clamp(y, d.y, d.y + d.h);
          if (U.dist2(x, y, px, py) <= r * r) out.push(d);
        }
      });
      return out;
    }
    setDoor(id, open) {
      const d = this.doorIndex.get(id);
      if (!d || d.broken) return false;
      if (open && d.locked) return false;
      d.open = !!open;
      this.doorState.set(id, [d.open ? 1 : 0, 0, Math.round(d.hp)]);
      return true;
    }
    damageDoor(id, dmg) {
      const d = this.doorIndex.get(id);
      if (!d || d.broken) return false;
      d.hp -= dmg;
      let broke = false;
      if (d.hp <= 0) { d.hp = 0; d.broken = true; d.open = false; d.locked = false; broke = true; }
      this.doorState.set(id, [d.open ? 1 : 0, d.broken ? 1 : 0, Math.round(d.hp)]);
      return broke;
    }
    chestsNear(x, y, r) {
      const out = [];
      const st = ++this.qs;
      this.forChunksInRect(x - r, y - r, x + r, y + r, (ch) => {
        for (const c of ch.chests) {
          if (c._qs === st) continue;
          c._qs = st;
          if (U.dist2(x, y, c.x, c.y) <= r * r) out.push(c);
        }
      });
      return out;
    }
    markChestOpened(id) {
      this.opened.add(id);
      const c = this.chestIndex.get(id);
      if (c) c.opened = true;
    }

    // ---------- objetos en el suelo ----------
    addGroundItem(x, y, stack) {
      const id = 'g' + (this.nextG++);
      const it = { id, x, y, stack: Object.assign({}, stack) };
      const k = this.key(Math.floor(x / CH), Math.floor(y / CH));
      let l = this.ground.get(k);
      if (!l) { l = []; this.ground.set(k, l); }
      l.push(it);
      this.groundById.set(id, it);
      return id;
    }
    removeGroundItem(id) {
      const it = this.groundById.get(id);
      if (!it) return false;
      this.groundById.delete(id);
      const k = this.key(Math.floor(it.x / CH), Math.floor(it.y / CH));
      const l = this.ground.get(k);
      if (l) { const i = l.indexOf(it); if (i >= 0) l.splice(i, 1); if (!l.length) this.ground.delete(k); }
      return true;
    }
    groundItemsNear(x, y, r) {
      const out = [];
      const c0 = Math.floor((x - r) / CH), c1 = Math.floor((x + r) / CH), r0 = Math.floor((y - r) / CH), r1 = Math.floor((y + r) / CH);
      for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) {
        const l = this.ground.get(this.key(cx, cy));
        if (!l) continue;
        for (const it of l) if (U.dist2(x, y, it.x, it.y) <= r * r) out.push(it);
      }
      return out;
    }

    // Pistas de aparición dentro del rectángulo
    spawnHints(x0, y0, x1, y1) {
      const out = [];
      this.forChunksInRect(x0, y0, x1, y1, (ch) => {
        for (const h of ch.hints) if (h.x >= x0 && h.x <= x1 && h.y >= y0 && h.y <= y1) out.push(h);
      });
      return out;
    }

    // ---------- guardado ----------
    serialize() {
      const doors = [];
      for (const [id, s] of this.doorState) doors.push([id, s[0], s[1], s[2]]);
      const ground = [];
      for (const it of this.groundById.values()) ground.push({ id: it.id, x: Math.round(it.x), y: Math.round(it.y), stack: it.stack });
      return { v: 2, doors, chests: Array.from(this.opened), ground, nextG: this.nextG };
    }
    deserialize(d) {
      if (!d || typeof d !== 'object') return;
      if (Array.isArray(d.doors)) for (const e of d.doors) {
        if (!Array.isArray(e)) continue;
        this.doorState.set(e[0], [e[1] ? 1 : 0, e[2] ? 1 : 0, Number(e[3]) || 0]);
        const door = this.doorIndex.get(e[0]);
        if (door) { door.open = !!e[1]; door.broken = !!e[2]; door.hp = Number(e[3]) || 0; }
      }
      if (Array.isArray(d.chests)) for (const id of d.chests) { this.opened.add(id); const c = this.chestIndex.get(id); if (c) c.opened = true; }
      if (Array.isArray(d.ground)) {
        for (const g of d.ground) {
          if (!g || !g.stack || !Number.isFinite(g.x) || !Number.isFinite(g.y)) continue;
          const id = this.addGroundItem(g.x, g.y, g.stack);
          // conservar el id original si es posible
          if (g.id && !this.groundById.has(g.id)) {
            const it = this.groundById.get(id);
            this.groundById.delete(id); it.id = g.id; this.groundById.set(g.id, it);
          }
        }
      }
      if (Number.isFinite(d.nextG)) this.nextG = Math.max(this.nextG, d.nextG);
    }

    // ---------- sangre persistente ----------
    paintBlood(x, y, size, intensity) {
      const s = size || 10, a = U.clamp(intensity === undefined ? 0.7 : intensity, 0, 1);
      const splat = { x, y, s, a, seed: (Math.random() * 1e9) | 0 };
      const c0 = Math.floor((x - s * 2) / CH), c1 = Math.floor((x + s * 2) / CH), r0 = Math.floor((y - s * 2) / CH), r1 = Math.floor((y + s * 2) / CH);
      for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) {
        const ch = this.chunks.get(this.key(cx, cy));
        if (!ch) continue;
        ch.blood.push(splat);
        if (ch.blood.length > 80) ch.blood.shift();
        if (ch.canvas && ch.ready) this.drawBlood(ch.ctx, ch, splat);
      }
    }
    drawBlood(ctx, ch, b) {
      const rng = new U.RNG(b.seed);
      const res = ch.res;
      ctx.save();
      ctx.setTransform(res, 0, 0, res, -ch.x0 * res, -ch.y0 * res);
      ctx.fillStyle = `rgba(${70 + rng.int(0, 30)},${6 + rng.int(0, 8)},${6 + rng.int(0, 6)},${b.a})`;
      WG.Draw.blob(ctx, b.x, b.y, b.s, rng, 9, 0.35);
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

    // ---------- horneado ----------
    allocCanvas(ch, size, roof) {
      const order = roof ? this.roofOrder : this.bakedOrder;
      const pool = roof ? this.roofPool : this.pool;
      const limit = roof ? TM.Config.preset.roofCache : TM.Config.preset.chunkCache;
      const C = roof ? 'roofCanvas' : 'canvas', X = roof ? 'roofCtx' : 'ctx';
      let oldest = null;
      if (order.length >= limit) {
        for (const c of order) if (!oldest || c.lastUsed < oldest.lastUsed) oldest = c;
        if (oldest && oldest.lastUsed >= this.now - 1) oldest = null;
      }
      if (oldest) {
        order.splice(order.indexOf(oldest), 1);
        ch[C] = oldest[C]; ch[X] = oldest[X];
        oldest[C] = null; oldest[X] = null;
        if (roof) oldest.roofDone = false; else { oldest.ready = false; oldest.roofDone = false; }
        this.dropJob('bake:' + oldest.key);
      } else if (pool.length) {
        const c = pool.pop();
        ch[C] = c.canvas; ch[X] = c.ctx;
      } else {
        ch[C] = U.makeCanvas(size, size);
        ch[X] = ch[C].getContext('2d');
      }
      if (ch[C].width !== size) { ch[C].width = size; ch[C].height = size; ch[X]._pats = null; }
      order.push(ch);
    }

    * bakeGen(ch) {
      while (ch.state !== 2) {
        if (!ch.popGen) ch.popGen = this.popGen(ch);
        const t0 = performance.now();
        const r = ch.popGen.next();
        this.stats.popMs += performance.now() - t0;
        if (r.done) break;
        yield 'bake-pop';
      }
      const P = TM.Config.preset;
      const res = P.groundRes;
      const size = Math.round(CH * res);
      ch.ready = false; ch.roofDone = false;
      if (!ch.canvas) this.allocCanvas(ch, size, false);
      ch.res = res;
      const ctx = ch.ctx;
      const D = WG.Draw;
      const x0 = ch.x0, y0 = ch.y0, x1 = x0 + CH, y1 = y0 + CH;
      const T = () => ctx.setTransform(res, 0, 0, res, -x0 * res, -y0 * res);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, size, size);
      T();
      const rng = new U.RNG(Math.floor(U.hash2(ch.cx, ch.cy, this.seed + 3) * 4294967295) || 1);
      yield 'bake-alloc';
      T();
      // 1. suelo: mezcla suave de capas
      yield* this.groundBlend(ch, ctx, T);
      // 2. manchas de variación (incluye las de los vecinos para que no haya cortes)
      T();
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const ncx = ch.cx + dx, ncy = ch.cy + dy;
        const br = new U.RNG(Math.floor(U.hash2(ncx, ncy, this.seed + 5) * 4294967295) || 1);
        for (let i = 0; i < 6; i++) {
          const x = ncx * CH + br.range(0, CH), y = ncy * CH + br.range(0, CH), r = br.range(60, 200);
          const light = br.chance(0.5), al = br.range(0.08, 0.2);
          if (x + r < x0 || x - r > x1 || y + r < y0 || y - r > y1) continue;
          const g = ctx.createRadialGradient(x, y, 0, x, y, r);
          const tint = light ? '120,110,90' : '10,8,6';
          g.addColorStop(0, `rgba(${tint},${al})`); g.addColorStop(1, `rgba(${tint},0)`);
          ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
        }
      }
      // 3. campos de cultivo en tierras de labranza
      this.drawFields(ch, ctx);
      yield 'bake-vary';
      // 4. zonas (patios, aparcamientos, plazas...)
      T();
      let n = 0;
      for (const a of ch.areas) { D.area(ctx, a, rng); if (WG.over()) { yield 'bake-areas'; T(); } }
      // 5. agua
      if (ch.water) { T(); this.drawWater(ch, ctx); yield 'bake-water'; }
      // 6. carreteras
      T();
      D.roads(ctx, ch.roads, x0, y0, x1, y1, rng);
      yield 'bake-roads';
      // naturaleza de los vecinos que invade este chunk (copas de árboles, sombras): sus datos deben existir
      const nbProps = [], nbDecor = [];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nb = this.chunkObj(ch.cx + dx, ch.cy + dy);
        while (nb.state !== 2) {
          if (!nb.popGen) nb.popGen = this.popGen(nb);
          const r = nb.popGen.next();
          if (r.done) break;
          yield 'bake-nbpop';
        }
        for (const p of nb.props) {
          if (!p.land) continue;
          const e = (p.ext || 40) + 30;
          if (p.x + e > x0 && p.x - e < x1 && p.y + e > y0 && p.y - e < y1) nbProps.push(p);
        }
        for (const d of nb.decor) if (d.land && d.x + 48 > x0 && d.x - 48 < x1 && d.y + 48 > y0 && d.y - 48 < y1) nbDecor.push(d);
      }
      // 7. decorado plano
      T();
      n = 0;
      for (const d of ch.decor) { D.decor(ctx, d); if (WG.over()) { yield 'bake-decor'; T(); } }
      for (const d of nbDecor) D.decor(ctx, d);
      // 8. sombras de accesorios
      T();
      const props = ch.props.concat(nbProps).sort((a, b) => a.y - b.y);
      for (const p of props) D.propShadow(ctx, p);
      yield 'bake-shadows';
      // 9. interiores de edificios (recortados al chunk)
      const bx = { x0, y0, x1, y1 };
      for (const b of ch.buildings) {
        if (!b.det) continue;
        T();
        D.building(ctx, b, rng, bx);
        yield 'bake-building';
      }
      // 10. accesorios ordenados por y
      n = 0;
      for (const p of props) {
        T();
        D.prop(ctx, p);
        n += (p.kind === 'tree') ? 3 : 1;
        if (WG.over()) { yield 'bake-props'; }
      }
      T();
      for (const c of ch.chests) if (c.loose) D.looseChest(ctx, c);
      for (const b of ch.blood) this.drawBlood(ctx, ch, b);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ch.ready = true;
      // 11. capa de techos
      if (ch.hasRoof) {
        yield 'bake-final';
        const rres = P.roofRes, rsize = Math.round(CH * rres);
        if (!ch.roofCanvas) this.allocCanvas(ch, rsize, true);
        ch.rres = rres;
        const rc = ch.roofCtx;
        rc.setTransform(1, 0, 0, 1, 0, 0);
        rc.clearRect(0, 0, rsize, rsize);
        for (const b of ch.buildings) {
          rc.setTransform(rres, 0, 0, rres, -x0 * rres, -y0 * rres);
          D.roof(rc, b);
          yield 'bake-roof';
        }
        rc.setTransform(rres, 0, 0, rres, -x0 * rres, -y0 * rres);
        for (const r of ch.roofs) D.canopy(rc, r);
        rc.setTransform(1, 0, 0, 1, 0, 0);
      }
      ch.roofDone = true;
    }

    // Mezcla de capas de suelo con máscaras bilineales de 5x5 muestras (continuas entre chunks)
    * groundBlend(ch, ctx, T) {
      const Tr = this.terrain;
      const W = {};
      const x0 = ch.x0, y0 = ch.y0, step = CH / (SAMPLE - 1);
      const vals = {};
      for (const L of LAYERS) vals[L] = new Float32Array(SAMPLE * SAMPLE);
      const S = this.macro.settlementAt(x0 + CH / 2, y0 + CH / 2);
      for (let j = 0; j < SAMPLE; j++) for (let i = 0; i < SAMPLE; i++) {
        const x = x0 + i * step, y = y0 + j * step;
        Tr.weights(x, y, W);
        let urban = 0;
        if (S && S.rank >= 2) urban = 1 - U.smoothstep(0.55, 0.95, Math.hypot(x - S.x, y - S.y) / S.R);
        else if (S && S.rank === 1) urban = 0.35 * (1 - U.smoothstep(0.4, 0.9, Math.hypot(x - S.x, y - S.y) / S.R));
        const burn = Tr.burn(x, y), dry = Tr.dryLake(x, y);
        const k = j * SAMPLE + i;
        const nat = (1 - urban);
        vals.forest[k] = W.forest * nat; vals.plains[k] = W.plains * nat; vals.farmland[k] = W.farmland * nat;
        vals.desert[k] = W.desert * nat; vals.swamp[k] = W.swamp * nat; vals.urban[k] = urban;
        // capas superpuestas (no normalizadas)
        vals.ash[k] = burn; vals.drymud[k] = dry;
      }
      // Orden fijo de capas (igual en todos los chunks) con alfa acumulado: el resultado es la media
      // ponderada de las capas en cada muestra y coincide exactamente en los bordes entre chunks.
      const ORDER = ['forest', 'farmland', 'desert', 'swamp', 'urban'];
      const acc = new Float32Array(SAMPLE * SAMPLE);
      const alphas = {};
      for (let k = 0; k < acc.length; k++) acc[k] = vals.plains[k];
      for (const L of ORDER) {
        const a = new Float32Array(acc.length);
        for (let k = 0; k < acc.length; k++) {
          const w = vals[L][k];
          acc[k] += w;
          a[k] = acc[k] > 1e-4 ? w / acc[k] : 0;
        }
        alphas[L] = a;
      }
      alphas.ash = vals.ash; alphas.drymud = vals.drymud;
      // si una capa cubre todo el chunk, las anteriores no se ven: se empieza por ella
      let start = -1;
      for (let i = ORDER.length - 1; i >= 0 && start < 0; i--) {
        let mn = 1; for (const a of alphas[ORDER[i]]) if (a < mn) mn = a;
        if (mn >= 0.999) start = i;
      }
      const baseL = start >= 0 ? ORDER[start] : 'plains';
      yield 'blend-sample';
      T();
      ctx.fillStyle = WG.Draw.pattern(ctx, baseL);
      ctx.fillRect(x0, y0, CH, CH);
      // segunda pasada del mismo patrón girada y ampliada: rompe la repetición visible del mosaico
      this.patternOverlay(ctx, baseL, x0, y0, 0.62, 2.35, 0.42);
      yield 'blend-base';
      if (!this._mask) {
        this._mask = U.makeCanvas(SAMPLE, SAMPLE); this._mctx = this._mask.getContext('2d');
        this._mimg = this._mctx.createImageData(SAMPLE, SAMPLE);
        this._tmp = U.makeCanvas(CH, CH); this._tctx = this._tmp.getContext('2d');
      }
      for (const L of ORDER.slice(start + 1).concat(['ash', 'drymud'])) {
        const v = alphas[L];
        let mx = 0; for (const a of v) if (a > mx) mx = a;
        if (mx < 0.01) continue;
        const d = this._mimg.data;
        for (let k = 0; k < SAMPLE * SAMPLE; k++) {
          d[k * 4] = 0; d[k * 4 + 1] = 0; d[k * 4 + 2] = 0;
          d[k * 4 + 3] = Math.round(U.clamp(v[k] * (L === 'ash' ? 1.2 : L === 'drymud' ? 1.3 : 1), 0, 1) * 255);
        }
        this._mctx.putImageData(this._mimg, 0, 0);
        const t = this._tctx;
        t.setTransform(1, 0, 0, 1, 0, 0);
        t.globalCompositeOperation = 'source-over';
        t.clearRect(0, 0, CH, CH);
        // el patrón se ancla al origen del mundo para que no haya costuras
        t.setTransform(1, 0, 0, 1, -x0, -y0);
        t.fillStyle = WG.Draw.pattern(t, L);
        t.fillRect(x0, y0, CH, CH);
        this.patternOverlay(t, L, x0, y0, 0.62, 2.35, 0.42);
        t.setTransform(1, 0, 0, 1, 0, 0);
        t.globalCompositeOperation = 'destination-in';
        t.imageSmoothingEnabled = true;
        // las muestras caen exactamente en los bordes del chunk
        t.drawImage(this._mask, -step / 2, -step / 2, step * SAMPLE, step * SAMPLE);
        t.globalCompositeOperation = 'source-over';
        T();
        ctx.drawImage(this._tmp, x0, y0);
        yield 'blend-layer';
      }
    }

    // Rellena el chunk con un patrón transformado (giro y escala respecto al origen del mundo: sin costuras)
    patternOverlay(ctx, name, x0, y0, ang, k, alpha) {
      const c = Math.cos(ang), s = Math.sin(ang);
      let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
      for (const [x, y] of [[x0, y0], [x0 + CH, y0], [x0, y0 + CH], [x0 + CH, y0 + CH]]) {
        const u = (x * c + y * s) / k, v = (-x * s + y * c) / k;
        if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v;
      }
      ctx.save();
      ctx.beginPath(); ctx.rect(x0, y0, CH, CH); ctx.clip();
      ctx.rotate(ang); ctx.scale(k, k);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = WG.Draw.pattern(ctx, name);
      ctx.fillRect(u0, v0, u1 - u0, v1 - v0);
      ctx.restore();
    }

    drawFields(ch, ctx) {
      // la decisión es por celda de campo (no por chunk) para que no haya cortes entre chunks
      const F = WG.FIELD;
      const i0 = Math.floor(ch.x0 / F), i1 = Math.floor((ch.x0 + CH) / F), j0 = Math.floor(ch.y0 / F), j1 = Math.floor((ch.y0 + CH) / F);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const c = WG.fieldCell(this.seed, i, j);
        if (c.fallow) continue;
        const cw = this.terrain.weights(c.x + F / 2, c.y + F / 2, {});
        if (cw.farmland < 0.5) continue;
        const S = this.macro.settlementAt(c.x + F / 2, c.y + F / 2);
        if (S && S.rank >= 2) continue;
        const inset = 2 * M;
        ctx.save();
        ctx.globalAlpha = 0.85 * U.clamp((cw.farmland - 0.5) * 4, 0, 1);
        WG.Draw.area(ctx, { mat: 'field', x: c.x + inset, y: c.y + inset, w: F - inset * 2, h: F - inset * 2, rot: c.rot, dead: c.dead });
        ctx.restore();
      }
    }

    drawWater(ch, ctx) {
      const w = ch.water, N = w.N;
      if (!this._wc) { this._wc = U.makeCanvas(N, N); this._wctx = this._wc.getContext('2d'); this._wimg = this._wctx.createImageData(N, N); }
      const d = this._wimg.data, m = w.mask;
      for (let k = 0; k < N * N; k++) {
        const v = m[k], i = k * 4;
        if (!v) { d[i + 3] = 0; continue; }
        let r, g, b, a = 255;
        if (v === 1) { r = 44; g = 56; b = 54; }
        else if (v === 2) { r = 28; g = 38; b = 42; }
        else if (v === 3) { r = 14; g = 12; b = 10; }
        else { r = 46; g = 42; b = 38; }
        d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = a;
      }
      this._wctx.putImageData(this._wimg, 0, 0);
      ctx.imageSmoothingEnabled = true;
      // orilla oscura y luego el agua
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.drawImage(this._wc, ch.x0 - 6, ch.y0 - 6, CH + 12, CH + 12);
      ctx.restore();
      ctx.drawImage(this._wc, ch.x0, ch.y0, CH, CH);
      // reflejos
      const rng = new U.RNG(ch.cx * 31 + ch.cy * 17);
      ctx.strokeStyle = 'rgba(150,170,175,0.08)'; ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < 30; i++) {
        const px = rng.range(0, N - 1) | 0, py = rng.range(0, N - 1) | 0;
        const v = m[py * N + px];
        if (v !== 1 && v !== 2) continue;
        const x = ch.x0 + px * (CH / N), y = ch.y0 + py * (CH / N);
        ctx.moveTo(x - 14, y); ctx.lineTo(x + 14, y);
      }
      ctx.stroke();
    }

    // ---------- trabajos (generación y horneado repartidos en frames) ----------
    addJob(key, pri, make) {
      let j = this.jobMap.get(key);
      if (j) { if (pri < j.pri) { j.pri = pri; this._dirty = true; } return j; }
      j = { key, pri, gen: make() };
      this.jobMap.set(key, j);
      this.jobs.push(j);
      this._dirty = true;
      return j;
    }
    dropJob(key) {
      const j = this.jobMap.get(key);
      if (!j) return;
      this.jobMap.delete(key);
      const i = this.jobs.indexOf(j);
      if (i >= 0) this.jobs.splice(i, 1);
    }
    bakeTick(budgetMs) {
      if (!this.jobs.length) return;
      if (this._dirty) { this.jobs.sort((a, b) => a.pri - b.pri); this._dirty = false; }
      const t0 = performance.now();
      // una parte del presupuesto siempre va al plan más cercano (si no, el horneado continuo lo dejaría sin avanzar)
      const pj = this.jobs.find((j) => j.key.charCodeAt(0) === 112 && j.key.startsWith('plan:'));
      if (pj) {
        const lim = budgetMs * 0.35;
        while (performance.now() - t0 < lim) {
          let r;
          WG.mark();
          try { r = pj.gen.next(); } catch (e) { console.error('trabajo', pj.key, e); r = { done: true }; }
          if (r.done) { this.dropJob(pj.key); break; }
        }
      }
      while (this.jobs.length && performance.now() - t0 < budgetMs) {
        const j = this.jobs[0];
        let r;
        const s0 = performance.now();
        WG.mark();
        try { r = j.gen.next(); } catch (e) { console.error("trabajo", j.key, e); r = { done: true }; }
        const sd = performance.now() - s0;
        if (sd > this.stats.maxStep) { this.stats.maxStep = sd; this.stats.maxStepKey = j.key; }
        const ty = j.key.slice(0, j.key.indexOf(":"));
        const mx = this.stats.max || (this.stats.max = {});
        if (!(mx[ty] > sd)) mx[ty] = +sd.toFixed(2);
        if (TM.Config.DEBUG && r) { const lb = typeof r.value === "string" ? r.value : (r.done ? "fin-" + ty : "otro-" + ty); const ml = this.stats.maxLab || (this.stats.maxLab = {}); if (!(ml[lb] > sd)) ml[lb] = +sd.toFixed(1); }
        if (r.done) { this.jobs.shift(); this.jobMap.delete(j.key); }
      }
      this.stats.bakeMs += performance.now() - t0;
    }
    bake(ch) {
      // termina de golpe (chunk visible sin terminar)
      const key = 'bake:' + ch.key;
      let j = this.jobMap.get(key);
      const gen = j ? j.gen : this.bakeGen(ch);
      while (!gen.next().done) { /* terminar */ }
      if (j) this.dropJob(key);
    }

    // Chunks visibles, horneados (como máximo maxBakes completos por frame)
    prepareView(x0, y0, x1, y1, now, maxBakes) {
      let baked = 0;
      this.now = Math.max(this.now || 0, now);
      const c0 = Math.floor(x0 / CH), c1 = Math.floor(x1 / CH);
      const r0 = Math.floor(y0 / CH), r1 = Math.floor(y1 / CH);
      const visible = this._vis || (this._vis = []);
      visible.length = 0;
      for (let cy = r0; cy <= r1; cy++) {
        for (let cx = c0; cx <= c1; cx++) {
          const ch = this.getChunk(cx, cy);
          ch.lastUsed = now;
          if ((!ch.ready || !ch.roofDone || !ch.canvas || (ch.hasRoof && !ch.roofCanvas)) && baked < maxBakes) { this.bake(ch); baked++; }
          visible.push(ch);
        }
      }
      return visible;
    }

    // Encola población y horneado alrededor de la vista (y por delante del movimiento) y planes cercanos
    prefetch(x0, y0, x1, y1, now) {
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      // velocidad aproximada de la vista
      if (this._pc) { this._vx = (this._vx || 0) * 0.9 + (cx - this._pc.x) * 6; this._vy = (this._vy || 0) * 0.9 + (cy - this._pc.y) * 6; }
      this._pc = { x: cx, y: cy };
      this._pf = (this._pf || 0) + 1;
      const ccx = Math.floor(cx / CH), ccy = Math.floor(cy / CH);
      if (this._pf % 8 !== 0 && this._lastPC === ccx + ',' + ccy) {
        // solo marca uso
        return;
      }
      this._lastPC = ccx + ',' + ccy;
      const vx = U.clamp(this._vx || 0, -400, 400), vy = U.clamp(this._vy || 0, -400, 400);
      // horneado: rectángulo de la vista + margen, desplazado hacia donde se mueve
      const ax = vx * 1.6, ay = vy * 1.6;
      const bx0 = Math.min(x0, x0 + ax), bx1 = Math.max(x1, x1 + ax), by0 = Math.min(y0, y0 + ay), by1 = Math.max(y1, y1 + ay);
      for (let j = Math.floor(by0 / CH); j <= Math.floor(by1 / CH); j++) for (let i = Math.floor(bx0 / CH); i <= Math.floor(bx1 / CH); i++) {
        const ch = this.chunkObj(i, j);
        ch.lastUsed = Math.max(ch.lastUsed, now);
        if (!ch.ready || !ch.roofDone) {
          const d = Math.hypot((i + 0.5) * CH - cx - ax * 0.5, (j + 0.5) * CH - cy - ay * 0.5);
          this.addJob('bake:' + ch.key, d, () => this.bakeGen(ch));
        }
      }
      // población (datos) en un radio mayor: la IA consulta obstáculos lejos de la vista
      const pr = 1100;
      for (let j = Math.floor((cy - pr + ay * 2) / CH); j <= Math.floor((cy + pr + ay * 2) / CH); j++) {
        for (let i = Math.floor((cx - pr + ax * 2) / CH); i <= Math.floor((cx + pr + ax * 2) / CH); i++) {
          const ch = this.chunkObj(i, j);
          if (ch.state === 2) continue;
          const d = Math.hypot((i + 0.5) * CH - cx, (j + 0.5) * CH - cy);
          this.addJob('pop:' + ch.key, 600 + d, () => this.popJob(ch));
        }
      }
      // planes de asentamientos que se acercan (hasta ~250 m por delante)
      if (this._pf % 30 === 0 || !this._planChecked) {
        this._planChecked = true;
        const R = 9000, fx = cx + vx * 14, fy = cy + vy * 14;
        const srcs = this.planSources(Math.min(cx, fx) - R, Math.min(cy, fy) - R, Math.max(cx, fx) + R, Math.max(cy, fy) + R);
        for (const s of srcs) {
          const e = this.planEntry(s);
          if (e.P) continue;
          let dd;
          if (s.bbox) dd = Math.hypot(Math.max(s.bbox.x0 - cx, 0, cx - s.bbox.x1), Math.max(s.bbox.y0 - cy, 0, cy - s.bbox.y1));
          else dd = Math.max(0, Math.hypot((s.x || 0) - cx, (s.y || 0) - cy) - (s.R || 0));
          this.addJob('plan:' + e.key, 3000 + dd * 0.2, () => this.planRun(e));
        }
      }
    }
    * popJob(ch) {
      if (!ch.popGen && ch.state !== 2) ch.popGen = this.popGen(ch);
      while (ch.state !== 2 && ch.popGen) {
        const t0 = performance.now();
        const r = ch.popGen.next();
        this.stats.popMs += performance.now() - t0;
        if (r.done) break;
        yield;
      }
    }

    // Libera chunks y planes muy lejanos
    prune(px, py) {
      const pcx = Math.floor(px / CH), pcy = Math.floor(py / CH);
      if (this.chunks.size > 260) {
        for (const [k, ch] of this.chunks) {
          if (Math.abs(ch.cx - pcx) > 7 || Math.abs(ch.cy - pcy) > 7) {
            if (ch.canvas) {
              const i = this.bakedOrder.indexOf(ch);
              if (i >= 0) this.bakedOrder.splice(i, 1);
              if (this.pool.length < 8) this.pool.push({ canvas: ch.canvas, ctx: ch.ctx });
              ch.canvas = null; ch.ctx = null;
            }
            if (ch.roofCanvas) {
              const i = this.roofOrder.indexOf(ch);
              if (i >= 0) this.roofOrder.splice(i, 1);
              if (this.roofPool.length < 6) this.roofPool.push({ canvas: ch.roofCanvas, ctx: ch.roofCtx });
              ch.roofCanvas = null; ch.roofCtx = null;
            }
            this.dropJob('bake:' + k); this.dropJob('pop:' + k);
            this.chunks.delete(k);
          }
        }
      }
      // planes lejanos (se regeneran igual si se vuelve: son deterministas)
      if (this.plans.size > 40) {
        const far = 60000;
        for (const [k, e] of this.plans) {
          if (!e.P || k === 'camp') continue;
          const b = e.P.bbox;
          const dx = Math.max(b.x0 - px, 0, px - b.x1), dy = Math.max(b.y0 - py, 0, py - b.y1);
          if (dx * dx + dy * dy > far * far) {
            for (const bd of e.P.buildings) if (bd.det) { for (const d of bd.det.doors) this.doorIndex.delete(d.id); for (const c of bd.det.chests) this.chestIndex.delete(c.id); }
            for (const c of e.P.chests) this.chestIndex.delete(c.id);
            this.plans.delete(k);
          }
        }
      }
    }

    // Reconstruye todos los lienzos (p. ej. al cambiar calidad)
    rebakeAll() {
      for (const ch of this.bakedOrder) { ch.canvas = null; ch.ctx = null; ch.ready = false; ch.roofDone = false; }
      for (const ch of this.roofOrder) { ch.roofCanvas = null; ch.roofCtx = null; ch.roofDone = false; }
      this.bakedOrder.length = 0; this.roofOrder.length = 0;
      this.pool.length = 0; this.roofPool.length = 0;
      for (const j of this.jobs.slice()) if (j.key.startsWith('bake:')) this.dropJob(j.key);
    }

    // ---------- capas dinámicas (las llama el renderer) ----------
    // Desvanece el techo de la estructura donde está el jugador
    updateRoofs(dt, px, py) {
      const cur = this.roofAt(px, py);
      if (cur !== this.curB) {
        if (this.curB) this.fading.add(this.curB);
        this.curB = cur;
      }
      if (cur) { cur.roofAlpha = Math.max(0, (cur.roofAlpha === undefined ? 1 : cur.roofAlpha) - dt * 3.5); this.fading.add(cur); }
      for (const s of this.fading) {
        if (s === cur) continue;
        s.roofAlpha = Math.min(1, s.roofAlpha + dt * 2.5);
        if (s.roofAlpha >= 1) this.fading.delete(s);
      }
    }
    // Interior oscuro: rectángulo del edificio actual y cuánto pesa (0..1)
    indoorShade() {
      const b = this.curB;
      if (!b || !b.indoor) return null;
      return { x: b.x, y: b.y, w: b.w, h: b.h, k: 1 - b.roofAlpha };
    }

    drawDynamic(ctx, vis, cam, t) {
      const D = WG.Draw;
      // puertas
      for (const ch of vis) for (const d of ch.doors) {
        if (d._dq === this._frameN) continue;
        d._dq = this._frameN;
        if (!cam.inView(d.cx, d.cy, 60)) continue;
        D.door(ctx, d);
      }
      // cofres abiertos: marca de registrado
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      for (const ch of vis) for (const c of ch.chests) {
        if (!c.opened || !cam.inView(c.x, c.y, 20)) continue;
        ctx.beginPath(); ctx.arc(c.x, c.y, 6, 0, Math.PI * 2); ctx.fill();
      }
      // objetos del suelo
      if (this.ground.size) {
        const I = TM.Items;
        for (const ch of vis) {
          const l = this.ground.get(ch.key);
          if (!l) continue;
          for (const it of l) {
            if (!cam.inView(it.x, it.y, 24)) continue;
            if (I && I.drawGround) { try { I.drawGround(ctx, it.stack, it.x, it.y, t); continue; } catch (e) { /* respaldo */ } }
            ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(it.x + 2, it.y + 4, 9, 5, 0, 0, Math.PI * 2); ctx.fill();
            const db = I && I.DB && I.DB[it.stack.id];
            ctx.fillStyle = (db && db.color) || '#c8b890';
            ctx.fillRect(it.x - 6, it.y - 6, 12, 12);
          }
        }
      }
    }

    // Techos encima de las entidades; el de la estructura actual (y las que se desvanecen) con transparencia
    drawRoofs(ctx, cam, curId, vis) {
      vis = vis || this._vis || [];
      const fading = [];
      for (const s of this.fading) if (s.roofAlpha < 0.999) fading.push(s);
      const vx0 = cam.x - cam.viewW / 2 - 40, vy0 = cam.y - cam.viewH / 2 - 40, vw = cam.viewW + 80, vh = cam.viewH + 80;
      const blit = (ch) => {
        if (!ch.roofCanvas || !ch.roofDone || !ch.hasRoof) return;
        ctx.drawImage(ch.roofCanvas, ch.x0, ch.y0, CH + 0.6, CH + 0.6);
      };
      if (!fading.length) {
        for (const ch of vis) blit(ch);
      } else {
        ctx.save();
        ctx.beginPath();
        ctx.rect(vx0, vy0, vw, vh);
        for (const s of fading) ctx.rect(s.x - 7, s.y - 7, s.w + 14, s.h + 14);
        ctx.clip('evenodd');
        for (const ch of vis) blit(ch);
        ctx.restore();
        for (const s of fading) {
          if (s.roofAlpha <= 0.01) continue;
          ctx.save();
          ctx.beginPath(); ctx.rect(s.x - 7, s.y - 7, s.w + 14, s.h + 14); ctx.clip();
          ctx.globalAlpha = s.roofAlpha;
          for (const ch of vis) if (ch.x0 < s.x + s.w + 8 && ch.x0 + CH > s.x - 8 && ch.y0 < s.y + s.h + 8 && ch.y0 + CH > s.y - 8) blit(ch);
          ctx.restore();
        }
      }
      // puertas exteriores visibles sobre el borde del techo
      const D = WG.Draw;
      for (const ch of vis) for (const d of ch.doors) {
        if (!d.ext || d._dm === this._frameN) continue;
        d._dm = this._frameN;
        if (!cam.inView(d.cx, d.cy, 40)) continue;
        const b = this.curB && this.curB.id === d.buildingId ? this.curB : null;
        const a = b ? b.roofAlpha : 1;
        if (a <= 0.02) continue;
        ctx.globalAlpha = a;
        D.doorMark(ctx, d);
      }
      ctx.globalAlpha = 1;
      void curId;
    }
  }

  TM.World = World;
})();
