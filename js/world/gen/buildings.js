// Interiores de edificios: muros finos, puertas, ventanas, habitaciones, muebles y cofres. TM.WG.Build
// Se genera en un marco canónico (fachada al sur, ancho W en x, fondo D en y) y luego se gira a su orientación real.
(function () {
  const U = TM.U;
  const WG = TM.WG = TM.WG || {};
  const G = WG.G;
  const M = 32;

  // ---------- rarezas de cofres ----------
  const TYPE_RAR = {
    house: 1, farmhouse: 1, barn: 0.7, pharmacy: 1.3, hospital: 1.4, supermarket: 1, gas: 0.9, hardware: 1.2,
    police: 1.9, school: 0.8, garage: 1.1, warehouse: 1.1, factory: 1, church: 0.9, bunker: 3.5, military: 3, other: 1,
  };
  const CONT_RAR = { 'caja fuerte': 4, 'cofre militar': 3, 'armero': 3, 'vitrina de medicinas': 1.6, 'nevera': 0.6, 'taquilla': 1.2 };
  const CONT_NOISY = { 'caja registradora': 0.3, 'caja fuerte': 0.35, 'maletero': 0.25, 'vitrina de medicinas': 0.12 };

  WG.rollRarity = function (rng, btype, container, danger, boost) {
    const d = Math.min(Math.max(danger || 0, 0), 5);
    const k = (TYPE_RAR[btype] || 1) * (CONT_RAR[container] || 1) * (boost || 1);
    const pL = (0.004 + 0.009 * d) * k;
    const pR = (0.09 + 0.045 * d) * Math.sqrt(k);
    const r = rng.next();
    return r < pL ? 'legendary' : r < pL + pR ? 'rare' : 'common';
  };
  WG.makeChest = function (rng, id, x, y, container, btype, danger, buildingId, boost, opts) {
    const trapBase = (btype === 'military' || btype === 'bunker') ? 0.08 : 0.03;
    return Object.assign({
      id, x, y, container, buildingType: btype, danger: +(danger || 0).toFixed(2), buildingId: buildingId || null,
      rarity: WG.rollRarity(rng, btype, container, danger, boost),
      trapped: rng.chance(trapBase), noisy: rng.chance(CONT_NOISY[container] || 0.04), opened: false,
    }, opts || {});
  };

  // ---------- plano de un edificio ----------
  class BP {
    constructor(b, rng) {
      this.b = b; this.rng = rng;
      const f = b.front;
      this.W = (f === 's' || f === 'n') ? b.w : b.h;
      this.D = (f === 's' || f === 'n') ? b.h : b.w;
      this.mirror = rng.chance(0.5);
      this.T = b.T || 10; this.t = b.t || 6;
      this.walls = []; this.rooms = []; this.reqs = []; this.furn = []; this.zones = [];
      this.chestDefs = []; this.decor = []; this.floors = []; this.hintPts = [];
      this.fh = new G.SHash(128); this.pending = []; this.defer = false;
      const T = this.T, W = this.W, D = this.D;
      this.wN = this.wall('h', T / 2, 0, W, T, true);
      this.wS = this.wall('h', D - T / 2, 0, W, T, true);
      this.wW = this.wall('v', T / 2, T, D - T, T, true);
      this.wE = this.wall('v', W - T / 2, T, D - T, T, true);
      this.inner = { x: T, y: T, w: W - 2 * T, h: D - 2 * T };
      this.boost = b.boost || 1;
    }
    wall(axis, c, a0, a1, t, ext) {
      const w = { axis, c, a0, a1, t, ext, reqs: [], open: [], junc: [] };
      this.walls.push(w);
      return w;
    }
    splitV(r, x, opts) {
      opts = opts || {};
      const t = opts.t || this.t;
      const w = this.wall('v', x, r.y, r.y + r.h, t, false);
      const a = { x: r.x, y: r.y, w: x - t / 2 - r.x, h: r.h };
      const b = { x: x + t / 2, y: r.y, w: r.x + r.w - x - t / 2, h: r.h };
      if (opts.door !== false) this.req(w, r.y, r.y + r.h, opts);
      return [a, b, w];
    }
    splitH(r, y, opts) {
      opts = opts || {};
      const t = opts.t || this.t;
      const w = this.wall('h', y, r.x, r.x + r.w, t, false);
      const a = { x: r.x, y: r.y, w: r.w, h: y - t / 2 - r.y };
      const b = { x: r.x, y: y + t / 2, w: r.w, h: r.y + r.h - y - t / 2 };
      if (opts.door !== false) this.req(w, r.x, r.x + r.w, opts);
      return [a, b, w];
    }
    req(wall, r0, r1, opts) {
      opts = opts || {};
      const q = { wall, r0, r1, w: opts.dw || 34, kind: opts.kind || 'wood', gap: !!opts.gap, dbl: !!opts.dbl, center: !!opts.center, locked: !!opts.locked, hp: opts.hp, main: !!opts.main };
      wall.reqs.push(q); this.reqs.push(q);
      return q;
    }
    // Pide una puerta en la fachada que da a la habitación r (lado 's' por defecto)
    extDoor(r, side, opts) {
      const w = side === 'n' ? this.wN : side === 'e' ? this.wE : side === 'w' ? this.wW : this.wS;
      const horiz = w.axis === 'h';
      return this.req(w, horiz ? r.x : r.y, horiz ? r.x + r.w : r.y + r.h, Object.assign({ dw: 38 }, opts || {}));
    }
    room(r, role, floor) {
      const o = Object.assign({ role, floor }, r);
      this.rooms.push(o);
      return o;
    }

    // BSP: divide un rectángulo en habitaciones conectadas (una puerta por cada corte)
    bsp(r, minW, maxArea, maxDim, depth, opts) {
      const out = [];
      const rec = (n, d) => {
        const canV = n.w >= minW * 2 + this.t, canH = n.h >= minW * 2 + this.t;
        const big = n.w * n.h > maxArea || Math.max(n.w, n.h) > maxDim;
        if (!big || d >= depth || (!canV && !canH)) { out.push(n); return; }
        let vert = n.w > n.h ? true : n.w < n.h ? false : this.rng.chance(0.5);
        if (this.rng.chance(0.2)) vert = !vert;
        if (vert && !canV) vert = false;
        if (!vert && !canH) vert = true;
        if (vert) {
          const x = n.x + minW + this.t / 2 + this.rng.range(0.15, 0.85) * (n.w - 2 * minW - this.t);
          const [a, b] = this.splitV(n, Math.round(x), opts);
          rec(a, d + 1); rec(b, d + 1);
        } else {
          const y = n.y + minW + this.t / 2 + this.rng.range(0.15, 0.85) * (n.h - 2 * minW - this.t);
          const [a, b] = this.splitH(n, Math.round(y), opts);
          rec(a, d + 1); rec(b, d + 1);
        }
      };
      rec(r, 0);
      return out;
    }

    // Banda de habitaciones a lo largo de un pasillo: divide r en piezas de ancho [wMin,wMax] a lo largo de su eje largo
    rowRooms(r, along, wMin, wMax, corridorWall, opts) {
      const out = [];
      const L = along === 'x' ? r.w : r.h;
      let pos = 0;
      const cuts = [];
      while (L - pos > wMax + this.t) {
        const wv = this.rng.range(wMin, wMax);
        if (L - pos - wv - this.t < wMin) break;
        pos += wv; cuts.push(pos); pos += this.t;
      }
      let prev = 0;
      const pieces = [];
      for (const c of cuts) { pieces.push([prev, c]); prev = c + this.t; }
      pieces.push([prev, L]);
      for (let k = 0; k < cuts.length; k++) {
        const c = cuts[k] + this.t / 2;
        if (along === 'x') this.wall('v', r.x + c, r.y, r.y + r.h, this.t, false);
        else this.wall('h', r.y + c, r.x, r.x + r.w, this.t, false);
      }
      for (const [a, b] of pieces) {
        const rr = along === 'x' ? { x: r.x + a, y: r.y, w: b - a, h: r.h } : { x: r.x, y: r.y + a, w: r.w, h: b - a };
        out.push(rr);
        if (corridorWall) this.req(corridorWall, along === 'x' ? rr.x : rr.y, along === 'x' ? rr.x + rr.w : rr.y + rr.h, opts);
      }
      return out;
    }

    // ---------- resolución de puertas y ventanas ----------
    resolve() {
      const ws = this.walls;
      for (const w1 of ws) {
        for (const w2 of ws) {
          if (w1 === w2 || w1.axis === w2.axis) continue;
          if (w2.c <= w1.a0 || w2.c >= w1.a1) continue;
          const f0 = w1.c - w1.t / 2, f1 = w1.c + w1.t / 2;
          if (Math.abs(w2.a0 - f1) < 2.5 || Math.abs(w2.a1 - f0) < 2.5 || (w2.a0 < w1.c && w2.a1 > w1.c)) w1.junc.push([w2.c - w2.t / 2, w2.c + w2.t / 2]);
        }
      }
      for (const q of this.reqs) {
        const w = q.wall;
        if (w.removed) continue;
        const endPad = w.ext ? this.T + 6 : 6;
        const lo = Math.max(q.r0 + 4, w.a0 + endPad), hi = Math.min(q.r1 - 4, w.a1 - endPad);
        const blocked = [];
        for (const j of w.junc) blocked.push([j[0] - 7, j[1] + 7]);
        for (const o of w.open) blocked.push([o.a0 - 10, o.a1 + 10]);
        let dw = q.dbl ? q.w * 2 : q.w;
        let pos = this.slot(lo, hi, dw, blocked, q.center);
        if (pos === null && dw > 30) { dw = q.dbl ? 64 : 30; pos = this.slot(lo, hi, dw, blocked, q.center); }
        if (pos === null) {
          if (!w.ext) { w.removed = true; }
          continue;
        }
        w.open.push({ a0: pos, a1: pos + dw, type: q.gap ? 'gap' : 'door', q });
      }
      // zonas despejadas delante y detrás de cada puerta
      for (const w of ws) {
        if (w.removed) continue;
        for (const o of w.open) {
          if (o.type === 'window') continue;
          const deep = 44;
          if (w.axis === 'h') this.addZone({ x: o.a0 - 6, y: w.c - w.t / 2 - deep, w: o.a1 - o.a0 + 12, h: w.t + deep * 2 });
          else this.addZone({ x: w.c - w.t / 2 - deep, y: o.a0 - 6, w: w.t + deep * 2, h: o.a1 - o.a0 + 12 });
        }
      }
    }
    slot(lo, hi, dw, blocked, center) {
      if (hi - lo < dw) return null;
      blocked.sort((a, b) => a[0] - b[0]);
      const free = [];
      let cur = lo;
      for (const [a, b] of blocked) {
        if (b <= cur) continue;
        if (a >= hi) break;
        if (a > cur) free.push([cur, Math.min(a, hi)]);
        cur = Math.max(cur, b);
      }
      if (cur < hi) free.push([cur, hi]);
      const ok = free.filter((f) => f[1] - f[0] >= dw);
      if (!ok.length) return null;
      if (center) {
        const mid = (lo + hi) / 2;
        let best = null, bd = Infinity;
        for (const f of ok) {
          const p = U.clamp(mid - dw / 2, f[0], f[1] - dw);
          const d = Math.abs(p + dw / 2 - mid);
          if (d < bd) { bd = d; best = p; }
        }
        return Math.round(best);
      }
      let tot = 0;
      for (const f of ok) tot += f[1] - f[0] - dw + 1;
      let r = this.rng.next() * tot;
      for (const f of ok) {
        const span = f[1] - f[0] - dw + 1;
        if (r <= span) return Math.round(f[0] + r);
        r -= span;
      }
      return Math.round(ok[0][0]);
    }
    // Ventanas en un muro exterior
    windows(w, ww, gap, p) {
      if (w.removed) return;
      const lo = w.a0 + this.T + 14, hi = w.a1 - this.T - 14;
      const blocked = [];
      for (const j of w.junc) blocked.push([j[0] - 10, j[1] + 10]);
      for (const o of w.open) blocked.push([o.a0 - 16, o.a1 + 16]);
      blocked.sort((a, b) => a[0] - b[0]);
      let x = lo + this.rng.range(0, gap * 0.5);
      while (x + ww <= hi) {
        let hit = null;
        for (const bb of blocked) if (x < bb[1] && x + ww > bb[0]) { hit = bb; break; }
        if (hit) { x = hit[1] + 2; continue; }
        if (this.rng.chance(p)) { w.open.push({ a0: x, a1: x + ww, type: 'window' }); blocked.push([x - gap, x + ww + gap]); }
        x += ww + gap;
      }
    }
    allWindows(ww, gap, p, frontWW, frontP) {
      this.windows(this.wS, frontWW || ww, gap, frontP === undefined ? p : frontP);
      this.windows(this.wN, ww, gap, p);
      this.windows(this.wW, ww, gap, p);
      this.windows(this.wE, ww, gap, p);
    }

    // ---------- muebles ----------
    addZone(z) { z._zone = true; this.zones.push(z); this.fh.insert(z, z.x, z.y, z.x + z.w, z.y + z.h); }
    free(r, pad) {
      // rejilla local: zonas de puertas (sin margen) y muebles (con margen)
      return !this.fh.query(r.x - pad - 1, r.y - pad - 1, r.x + r.w + pad + 1, r.y + r.h + pad + 1, (o) => G.overlap(r, o, o._zone ? 0 : pad));
    }
    add(r, f, face, opts) {
      opts = opts || {};
      const it = Object.assign({ f, face: face || 's', x: r.x, y: r.y, w: r.w, h: r.h }, opts);
      if (opts.solid === undefined) it.solid = true;
      this.furn.push(it);
      this.fh.insert(it, it.x, it.y, it.x + it.w, it.y + it.h);
      if (opts.chest) this.chestDefs.push({ furn: it, container: opts.chest, boost: opts.boost || 1 });
      return it;
    }
    // Contra una pared de la habitación. sides: lista de lados permitidos
    against(room, w, d, f, opts, sides, tries) {
      opts = opts || {};
      const S = sides || ['n', 's', 'e', 'w'];
      for (let i = 0; i < (tries || 10); i++) {
        const side = S[Math.floor(this.rng.next() * S.length)];
        const along = side === 'n' || side === 's' ? room.w : room.h;
        if (along < w + 2) continue;
        let pos = opts.corner ? (this.rng.chance(0.5) ? 0 : along - w) : this.rng.range(0, along - w);
        if (opts.mid) pos = (along - w) / 2;
        pos = Math.round(pos);
        let r;
        if (side === 'n') r = { x: room.x + pos, y: room.y, w, h: d };
        else if (side === 's') r = { x: room.x + pos, y: room.y + room.h - d, w, h: d };
        else if (side === 'w') r = { x: room.x, y: room.y + pos, w: d, h: w };
        else r = { x: room.x + room.w - d, y: room.y + pos, w: d, h: w };
        if (!this.free(r, opts.pad === undefined ? 4 : opts.pad)) continue;
        const face = side === 'n' ? 's' : side === 's' ? 'n' : side === 'w' ? 'e' : 'w';
        return this.add(r, f, face, opts);
      }
      return null;
    }
    center(room, w, h, f, opts, margin) {
      const m = margin === undefined ? 36 : margin;
      if (room.w < w + m * 2 || room.h < h + m * 2) return null;
      for (let i = 0; i < 8; i++) {
        const r = { x: Math.round(room.x + m + this.rng.range(0, room.w - w - m * 2)), y: Math.round(room.y + m + this.rng.range(0, room.h - h - m * 2)), w, h };
        if (i === 0) { r.x = Math.round(room.x + (room.w - w) / 2); r.y = Math.round(room.y + (room.h - h) / 2); }
        if (this.free(r, 24)) return this.add(r, f, 's', opts);
      }
      return null;
    }
    decorIn(room, kind, n) {
      for (let i = 0; i < n; i++) this.decor.push({ kind, x: room.x + this.rng.range(8, room.w - 8), y: room.y + this.rng.range(8, room.h - 8), s: this.rng.range(0.7, 1.3), rot: this.rng.range(0, 6.28), seed: this.rng.int(1, 1e9) });
    }
  }

  // ---------- amueblado por función de la habitación ----------
  const R = (bp) => bp.rng;
  const FURNISH = {
    living(bp, r) {
      bp.against(r, 64, 28, 'sofa', { color: R(bp).pick(['#5a4636', '#3e4a52', '#5c3a34', '#4a4a3a']) });
      if (R(bp).chance(0.7)) bp.against(r, 28, 28, 'armchair', { color: R(bp).pick(['#5a4636', '#4c3b30', '#3e4a52']) });
      bp.against(r, 44, 14, 'tvstand', {});
      if (R(bp).chance(0.6)) bp.against(r, 32, 10, 'bookshelf', { tall: true, chest: R(bp).chance(0.35) ? 'estantería' : null });
      bp.center(r, 32, 20, 'ctable', { solid: true }, 34);
      if (R(bp).chance(0.5)) bp.against(r, 14, 14, 'plant', { solid: false, corner: true });
      bp.decorIn(r, R(bp).pick(['paper', 'trash', 'stain']), R(bp).int(1, 3));
    },
    kitchen(bp, r) {
      const side = R(bp).pick(['n', 'e', 'w', 's']);
      const L = side === 'n' || side === 's' ? r.w : r.h;
      const len = Math.min(L - 8, R(bp).range(64, 110));
      bp.against(r, Math.round(len), 20, 'counter', { pad: 0 }, [side], 6);
      bp.against(r, 22, 22, 'fridge', { chest: R(bp).chance(0.9) ? 'nevera' : null, tall: true, pad: 0 });
      bp.against(r, 20, 20, 'stove', { pad: 0 });
      if (R(bp).chance(0.65)) bp.against(r, 34, 16, 'cabinet', { chest: 'alacena', pad: 0 });
      const t = bp.center(r, 44, 28, 'table', {}, 30);
      if (t) t.chairs = 4;
      bp.decorIn(r, 'trash', R(bp).int(0, 2));
    },
    bed(bp, r) {
      const dbl = r.w > 100 && r.h > 100 && R(bp).chance(0.6);
      const b = bp.against(r, dbl ? 52 : 30, 64, 'bed', { color: R(bp).pick(['#6b6a5e', '#5a4a5a', '#4a5a6a', '#6a5040', '#5d6a55']), dbl, pad: 6 });
      if (b) {
        // mesita junto a la cabecera
        const ns = { w: 16, h: 14 };
        let nr;
        if (b.face === 's') nr = { x: b.x + b.w + 2, y: b.y, w: ns.w, h: ns.h };
        else if (b.face === 'n') nr = { x: b.x - 18, y: b.y + b.h - ns.h, w: ns.w, h: ns.h };
        else if (b.face === 'e') nr = { x: b.x, y: b.y - 16, w: ns.h, h: ns.w };
        else nr = { x: b.x + b.w - ns.h, y: b.y + b.h + 2, w: ns.h, h: ns.w };
        if (G.inRect(nr.x, nr.y, r) && G.inRect(nr.x + nr.w, nr.y + nr.h, r) && bp.free(nr, 0)) bp.add(nr, 'nightstand', b.face, { chest: R(bp).chance(0.5) ? 'mesita de noche' : null });
      }
      bp.against(r, 38, 20, 'wardrobe', { chest: R(bp).chance(0.85) ? 'armario' : null, tall: true });
      if (R(bp).chance(0.35)) bp.against(r, 40, 20, 'desk', {});
      bp.decorIn(r, R(bp).pick(['paper', 'stain', 'trash']), R(bp).int(0, 2));
    },
    bath(bp, r) {
      if (r.w >= 56 || r.h >= 56) bp.against(r, 54, 24, 'tub', { pad: 0 });
      bp.against(r, 14, 22, 'toilet', { pad: 2 });
      bp.against(r, 20, 14, 'sink', { pad: 2 });
      if (R(bp).chance(0.6)) bp.against(r, 18, 10, 'cabinet', { chest: 'botiquín', pad: 2 });
    },
    hall(bp, r) {
      if (R(bp).chance(0.3)) bp.against(r, 30, 12, 'cabinet', { chest: R(bp).chance(0.4) ? 'cómoda' : null });
      bp.decorIn(r, 'paper', R(bp).int(0, 2));
    },
    garage(bp, r) {
      // auto dentro (con maletero)
      const vertical = r.h > r.w;
      const cw = vertical ? 60 : 144, chh = vertical ? 144 : 60;
      if (r.w >= cw + 30 && r.h >= chh + 30) {
        const c = { x: Math.round(r.x + (r.w - cw) / 2), y: Math.round(r.y + (r.h - chh) / 2), w: cw, h: chh };
        if (bp.free(c, 4)) bp.add(c, 'car', vertical ? 'n' : 'e', { color: R(bp).pick(['#5a2a24', '#2f3b48', '#545a5c', '#7a766c', '#3c4430', '#23262a']), chest: 'maletero', tall: true });
      }
      bp.against(r, 60, 22, 'workbench', {});
      bp.against(r, 24, 16, 'toolcab', { chest: R(bp).chance(0.8) ? 'caja de herramientas' : null });
      if (R(bp).chance(0.6)) bp.against(r, 48, 16, 'shelf', { chest: R(bp).chance(0.4) ? 'estantería' : null, tall: true });
      bp.decorIn(r, 'stain', R(bp).int(1, 3));
    },
    storage(bp, r) {
      for (let i = 0; i < 4; i++) bp.against(r, Math.min(64, Math.max(30, (r.w > r.h ? r.w : r.h) * 0.3)) | 0, 16, 'shelf', { chest: R(bp).chance(0.45) ? 'estantería' : null, tall: true });
      for (let i = 0; i < 3; i++) bp.center(r, 26, 26, 'crate', { chest: R(bp).chance(0.5) ? 'caja' : null }, 30);
      bp.decorIn(r, 'trash', R(bp).int(1, 3));
    },
    office(bp, r) {
      const n = r.w * r.h > 120 * 120 ? 2 : 1;
      for (let i = 0; i < n; i++) bp.against(r, 44, 22, 'desk', { pc: true });
      bp.against(r, 16, 18, 'filecab', { chest: R(bp).chance(0.6) ? 'archivador' : null, tall: true });
      if (R(bp).chance(0.5)) bp.against(r, 32, 10, 'bookshelf', { tall: true });
      if (R(bp).chance(0.08 * bp.boost)) bp.against(r, 18, 18, 'safe', { chest: 'caja fuerte' });
      bp.decorIn(r, 'paper', R(bp).int(2, 5));
    },
    dispensary(bp, r) {
      for (let i = 0; i < 4; i++) bp.against(r, 40, 14, 'medcab', { chest: R(bp).chance(0.85) ? 'vitrina de medicinas' : null, tall: true, pad: 0 });
      bp.decorIn(r, 'pills', R(bp).int(2, 4));
    },
    patient(bp, r) {
      const n = Math.max(1, Math.min(3, Math.floor((r.w > r.h ? r.w : r.h) / 70)));
      for (let i = 0; i < n; i++) bp.against(r, 30, 66, 'hbed', { pad: 10 });
      bp.against(r, 18, 14, 'cabinet', { chest: R(bp).chance(0.6) ? 'botiquín' : null });
      bp.decorIn(r, R(bp).pick(['stain', 'pills', 'paper']), R(bp).int(1, 3));
    },
    surgery(bp, r) {
      bp.center(r, 24, 64, 'optable', {}, 34);
      bp.against(r, 40, 14, 'medcab', { chest: 'vitrina de medicinas', tall: true });
      bp.against(r, 22, 22, 'equip', {});
      bp.decorIn(r, 'stain', 2);
    },
    classroom(bp, r) {
      bp.against(r, 44, 22, 'desk', { chest: R(bp).chance(0.3) ? 'escritorio' : null }, ['n']);
      bp.against(r, 80, 6, 'board', { solid: false }, ['n'], 3);
      const cols = Math.floor((r.w - 60) / 40), rows = Math.floor((r.h - 100) / 36);
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        if (R(bp).chance(0.12)) continue;
        const d = { x: Math.round(r.x + 30 + i * 40 + 9), y: Math.round(r.y + 70 + j * 36 + 10), w: 22, h: 16 };
        if (bp.free(d, 2)) bp.add(d, 'sdesk', 'n', {});
      }
      bp.decorIn(r, 'paper', R(bp).int(2, 4));
    },
    cell(bp, r) {
      bp.against(r, 28, 62, 'bunk', { pad: 2 }, ['n', 'w', 'e']);
      bp.against(r, 14, 18, 'toilet', { pad: 2 });
    },
    lockers(bp, r) {
      for (let i = 0; i < 4; i++) bp.against(r, 52, 16, 'locker', { chest: R(bp).chance(0.6) ? 'taquilla' : null, tall: true, pad: 2 });
      bp.center(r, 64, 14, 'bench', {}, 30);
    },
    armory(bp, r) {
      for (let i = 0; i < 3; i++) bp.against(r, 48, 14, 'gunrack', { chest: R(bp).chance(0.8) ? 'armero' : null, tall: true, pad: 2 });
      for (let i = 0; i < 2; i++) bp.center(r, 38, 20, 'milcrate', { chest: 'cofre militar' }, 26);
    },
    breakroom(bp, r) {
      bp.against(r, 64, 20, 'counter', { pad: 0 });
      bp.against(r, 22, 22, 'fridge', { chest: R(bp).chance(0.8) ? 'nevera' : null, tall: true });
      const t = bp.center(r, 44, 28, 'table', {}, 30); if (t) t.chairs = 4;
    },
    restroom(bp, r) {
      const n = Math.max(1, Math.floor((r.w > r.h ? r.w : r.h) / 40));
      for (let i = 0; i < n; i++) bp.against(r, 14, 22, 'toilet', { pad: 10 });
      bp.against(r, 20, 14, 'sink', { pad: 4 });
    },
    bunks(bp, r) {
      const n = Math.max(1, Math.floor((r.w * r.h) / (90 * 90)));
      for (let i = 0; i < n; i++) bp.against(r, 28, 64, 'bunk', { pad: 8 });
      for (let i = 0; i < 2; i++) bp.against(r, 52, 16, 'locker', { chest: R(bp).chance(0.7) ? 'taquilla' : null, tall: true, pad: 2 });
    },
    lab(bp, r) {
      bp.against(r, 96, 24, 'labbench', { pad: 0 });
      bp.against(r, 22, 22, 'fridge', { chest: 'nevera', tall: true });
      bp.against(r, 40, 14, 'medcab', { chest: 'vitrina de medicinas', tall: true });
      bp.center(r, 64, 24, 'labbench', {}, 34);
      bp.decorIn(r, 'pills', 2);
    },
    generator(bp, r) {
      bp.center(r, 48, 26, 'generator', {}, 28);
      for (let i = 0; i < 3; i++) bp.against(r, 18, 18, 'barrelr', {});
      bp.against(r, 38, 20, 'milcrate', { chest: 'cofre militar' });
    },
    meeting(bp, r) {
      const t = bp.center(r, 90, 36, 'table', {}, 34); if (t) t.chairs = 8;
      bp.against(r, 80, 6, 'board', { solid: false }, null, 3);
    },
    gym(bp, r) {
      for (let i = 0; i < 4; i++) bp.center(r, 40, 24, 'mat', { solid: false }, 30);
      bp.against(r, 52, 16, 'locker', { chest: 'taquilla', tall: true });
    },
    cafeteria(bp, r) {
      const cols = Math.floor((r.w - 40) / 90), rows = Math.floor((r.h - 40) / 70);
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const t = { x: Math.round(r.x + 30 + i * 90), y: Math.round(r.y + 30 + j * 70), w: 64, h: 26 };
        if (bp.free(t, 4)) { const it = bp.add(t, 'table', 's', {}); it.chairs = 6; }
      }
      bp.against(r, 96, 22, 'counter', { pad: 0 });
    },
    empty(bp, r) { bp.decorIn(r, R(bp).pick(['trash', 'paper', 'rubble']), R(bp).int(1, 3)); },
  };
  WG.FURNISH = FURNISH;

  const FLOOR_OF = {
    living: 'wood', bed: 'wood', kitchen: 'tileCheck', bath: 'tile', hall: 'wood', garage: 'concreteF', storage: 'concreteF',
    office: 'carpet', dispensary: 'lino', patient: 'lino', surgery: 'tile', classroom: 'lino', cell: 'concreteF', lockers: 'tile',
    armory: 'concreteF', breakroom: 'lino', restroom: 'tile', bunks: 'concreteF', lab: 'tile', generator: 'metal', meeting: 'carpet',
    gym: 'woodDark', cafeteria: 'lino', empty: 'concreteF', corridor: 'lino', lobby: 'stone', hall2: 'lino', shop: 'lino',
  };

  function furnishAll(bp, rooms) {
    for (const r of rooms) {
      const fn = FURNISH[r.role];
      // en modo diferido el amueblado se reparte en varios pasos (edificios grandes)
      if (fn) { if (bp.defer) bp.pending.push(r); else fn(bp, r); }
      if (!r.floor) r.floor = FLOOR_OF[r.role] || 'concreteF';
      if (r.w * r.h > 70 * 70) bp.hintPts.push({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
    }
  }

  // ---------- plantillas ----------
  const T = {};

  // Asigna funciones a las habitaciones de una casa
  function houseRoles(bp, rooms, front) {
    const sorted = rooms.slice().sort((a, b) => b.w * b.h - a.w * a.h);
    const D = bp.D;
    // la mayor que toca la fachada = salón
    let living = rooms.filter((r) => r.y + r.h >= D - bp.T - 2).sort((a, b) => b.w * b.h - a.w * a.h)[0] || sorted[0];
    living.role = 'living';
    const rest = sorted.filter((r) => r !== living);
    const small = rest.slice().sort((a, b) => a.w * a.h - b.w * b.h);
    if (small.length) small[0].role = 'bath';
    const others = rest.filter((r) => !r.role);
    if (others.length) others[0].role = 'kitchen';
    for (let i = 1; i < others.length; i++) others[i].role = 'bed';
    if (!rooms.some((r) => r.role === 'kitchen') && living) living.alsoKitchen = true;
    return living;
  }

  T.house = function (bp, opts) {
    opts = opts || {};
    const rng = bp.rng;
    let inner = bp.inner;
    let rooms = [];
    // garaje adosado
    if (opts.garage && inner.w > 380) {
      const gw = 120;
      const [g, rest, gwall] = bp.splitV(inner, inner.x + gw + bp.t / 2, {});
      const gr = bp.room(g, 'garage', 'concreteF');
      bp.extDoor(gr, 's', { dw: 96, kind: 'garage', center: true, hp: 260 });
      inner = rest;
      rooms.push(gr);
    }
    let leaves;
    const corridor = !opts.small && inner.w >= 300 && inner.h >= 300 && rng.chance(0.6);
    if (corridor) {
      const cw = Math.round(rng.range(42, 50));
      const cx = Math.round(inner.x + inner.w * rng.range(0.35, 0.6));
      const [left, rest] = bp.splitV(inner, cx - cw / 2 - bp.t / 2, { door: false });
      const [cor, right] = bp.splitV(rest, cx + cw / 2 + bp.t / 2, { door: false });
      const wl = bp.walls[bp.walls.length - 2], wr = bp.walls[bp.walls.length - 1];
      const corr = bp.room(cor, 'hall', 'wood');
      const lr = left.h > 260 ? bp.rowRooms(left, 'y', 90, 150, wl, {}) : [left];
      const rr = right.h > 260 ? bp.rowRooms(right, 'y', 90, 150, wr, {}) : [right];
      if (lr.length === 1) bp.req(wl, left.y, left.y + left.h, {});
      if (rr.length === 1) bp.req(wr, right.y, right.y + right.h, {});
      leaves = lr.concat(rr);
      bp.extDoor(corr, 's', { center: true, main: true });
      if (rng.chance(0.5)) bp.extDoor(corr, 'n', {});
      rooms.push(corr);
      for (const l of leaves) rooms.push(bp.room(l, null));
      const roomsNoHall = rooms.filter((r) => !r.role);
      const sorted = roomsNoHall.slice().sort((a, b) => b.w * b.h - a.w * a.h);
      if (sorted[0]) sorted[0].role = 'living';
      const small = sorted.slice().reverse();
      if (small[0] && small[0] !== sorted[0]) small[0].role = 'bath';
      const others = sorted.filter((r) => !r.role);
      if (others[0]) others[0].role = 'kitchen';
      for (let i = 1; i < others.length; i++) others[i].role = 'bed';
    } else {
      const maxArea = (opts.small ? 18 : 24) * M * M;
      leaves = bp.bsp(inner, 78, maxArea, 190, 4, {});
      for (const l of leaves) rooms.push(bp.room(l, null));
      const living = houseRoles(bp, rooms.filter((r) => !r.role), bp.D);
      bp.extDoor(living, 's', { main: true });
      const k = rooms.find((r) => r.role === 'kitchen');
      if (k && k.y <= bp.T + 2 && rng.chance(0.6)) bp.extDoor(k, 'n', {});
    }
    bp.resolve();
    bp.allWindows(rng.range(36, 48), rng.range(40, 70), 0.75);
    furnishAll(bp, rooms);
    if (opts.rustic) for (const r of rooms) if (r.floor === 'wood') r.floor = 'woodDark';
  };

  T.cabin = function (bp, opts) {
    const rng = bp.rng;
    let rooms;
    if (bp.inner.w * bp.inner.h > 150 * 150 && rng.chance(0.6)) {
      const [a, b] = bp.inner.w > bp.inner.h ? bp.splitV(bp.inner, Math.round(bp.inner.x + bp.inner.w * rng.range(0.4, 0.6)), {}) : bp.splitH(bp.inner, Math.round(bp.inner.y + bp.inner.h * rng.range(0.4, 0.6)), {});
      rooms = [bp.room(b, 'living', 'woodDark'), bp.room(a, 'bed', 'woodDark')];
    } else rooms = [bp.room(bp.inner, 'living', 'woodDark')];
    bp.extDoor(rooms[0], 's', { main: true, locked: !!(opts && opts.locked) });
    bp.resolve();
    bp.allWindows(32, 50, 0.6);
    for (const r of rooms) {
      if (r.role === 'living') {
        bp.against(r, 30, 64, 'bed', { color: '#5a4a3a' });
        const t = bp.center(r, 40, 26, 'table', {}, 26); if (t) t.chairs = 2;
        bp.against(r, 34, 16, 'cabinet', { chest: 'alacena' });
        bp.against(r, 22, 22, 'stove', {});
        if (opts && opts.hideout) {
          bp.against(r, 38, 20, 'crate', { chest: 'caja' });
          bp.against(r, 38, 19, 'milcrate', { chest: 'cofre militar', boost: 1.5 });
          bp.decorIn(r, 'note', 3);
          bp.decorIn(r, 'cans', 3);
        }
        r.floor = 'woodDark';
      } else FURNISH.bed(bp, r);
      if (r.w * r.h > 60 * 60) bp.hintPts.push({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
    }
  };

  T.shed = function (bp) {
    const r = bp.room(bp.inner, 'storage', bp.rng.chance(0.5) ? 'woodDark' : 'concreteF');
    bp.extDoor(r, 's', { center: true, dw: 36 });
    bp.resolve();
    bp.allWindows(28, 60, 0.3);
    bp.against(r, 40, 18, 'workbench', {});
    bp.against(r, 24, 16, 'toolcab', { chest: 'caja de herramientas' });
    if (bp.rng.chance(0.5)) bp.against(r, 22, 22, 'barrelr', {});
  };

  T.barn = function (bp) {
    const rng = bp.rng;
    const r = bp.room(bp.inner, 'barn', 'dirtF');
    bp.extDoor(r, 's', { dw: 60, dbl: true, center: true, kind: 'wood', hp: 220 });
    if (rng.chance(0.6)) bp.extDoor(r, 'n', { dw: 38 });
    bp.resolve();
    bp.allWindows(30, 90, 0.4);
    // establos a ambos lados del pasillo central
    const aisle = Math.max(110, r.w * 0.36);
    const sw = (r.w - aisle) / 2;
    const stallD = 96;
    for (const side of [0, 1]) {
      const x0 = side ? r.x + r.w - sw : r.x;
      for (let y = r.y + 50; y + stallD < r.y + r.h - 70; y += stallD) {
        // separador
        bp.add({ x: x0, y, w: sw - 10, h: 4 }, 'stall', 's', {});
        if (rng.chance(0.4)) bp.add({ x: x0 + 6, y: y + 14, w: 38, h: 20 }, 'hay', 's', {});
        if (rng.chance(0.18)) bp.add({ x: x0 + 8, y: y + 46, w: 30, h: 18 }, 'crate', 's', { chest: 'caja' });
      }
    }
    const tr = { x: Math.round(r.x + r.w / 2 - 29), y: Math.round(r.y + r.h / 2 - 56), w: 58, h: 112 };
    if (rng.chance(0.6) && r.h > 300 && bp.free(tr, 10)) bp.add(tr, 'tractor', 's', { tall: true });
    bp.against(r, 38, 20, 'crate', { chest: 'caja' }, ['n']);
    bp.decorIn(r, 'hay', 6);
    bp.hintPts.push({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
    bp.rooms = [r];
  };

  // Tienda: sala grande + franja trasera de almacén/oficina/baño
  T.shop = function (bp, kind) {
    const rng = bp.rng;
    const inner = bp.inner;
    const backD = kind === 'supermarket' ? rng.range(170, 230) : kind === 'gas' || kind === 'store' || kind === 'bar' ? rng.range(90, 120) : rng.range(100, 150);
    const [back, hall, bw] = bp.splitH(inner, Math.round(inner.y + backD + bp.t / 2), { door: false });
    const hallR = bp.room(hall, 'shop', kind === 'hardware' ? 'concreteF' : kind === 'bar' ? 'woodDark' : 'lino');
    // habitaciones traseras
    const backRooms = back.w > 260 ? bp.rowRooms(back, 'x', 110, 220, bw, {}) : [back];
    if (backRooms.length === 1) bp.req(bw, back.x, back.x + back.w, {});
    const roles = kind === 'pharmacy' ? ['dispensary', 'office', 'restroom', 'storage'] :
      kind === 'supermarket' ? ['storage', 'storage', 'office', 'breakroom', 'restroom', 'storage'] :
      kind === 'bar' ? ['kitchen', 'storage', 'restroom'] : ['storage', 'office', 'restroom'];
    const rooms = [];
    backRooms.forEach((b, i) => rooms.push(bp.room(b, roles[i % roles.length])));
    // entrada: puerta doble en el centro o puerta lateral
    const big = kind === 'supermarket' || kind === 'hardware';
    bp.extDoor(hallR, 's', { dw: big ? 40 : 38, dbl: big || rng.chance(0.4), center: rng.chance(0.6), kind: 'glass', main: true });
    if (kind === 'supermarket' || rng.chance(0.4)) bp.extDoor(rooms[0], 'n', { dw: kind === 'supermarket' ? 96 : 36, kind: kind === 'supermarket' ? 'garage' : 'metal', hp: 300 });
    bp.resolve();
    // escaparate en la fachada
    bp.windows(bp.wS, rng.range(70, 110), 14, 0.95);
    bp.windows(bp.wW, 40, 90, 0.4); bp.windows(bp.wE, 40, 90, 0.4);
    furnishAll(bp, rooms);
    shopFloor(bp, hallR, kind);
    bp.rooms = rooms.concat([hallR]);
  };

  function shopFloor(bp, h, kind) {
    const rng = bp.rng;
    const front = kind === 'supermarket' ? 150 : 96;
    // mostrador / cajas cerca de la entrada
    if (kind === 'supermarket') {
      const n = Math.max(2, Math.floor((h.w - 200) / 110));
      for (let i = 0; i < n; i++) {
        const c = { x: Math.round(h.x + 70 + i * 110), y: Math.round(h.y + h.h - front + 20), w: 26, h: 64 };
        if (bp.free(c, 2)) bp.add(c, 'checkout', 'w', { chest: rng.chance(0.3) ? 'caja registradora' : null });
      }
    } else if (kind === 'bar') {
      bp.against(h, Math.min(h.w - 80, 200), 22, 'counter', { pad: 0 }, ['n'], 5);
      const cols = Math.floor((h.w - 60) / 90), rows = Math.floor((h.h - 140) / 80);
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const t = { x: Math.round(h.x + 40 + i * 90), y: Math.round(h.y + 80 + j * 80), w: 30, h: 30 };
        if (bp.free(t, 8)) { const it = bp.add(t, 'rtable', 's', {}); it.chairs = 4; }
      }
      if (h.w > 220 && rng.chance(0.5)) bp.center(h, 80, 44, 'pool', {}, 50);
      bp.decorIn(h, 'glass', 4);
      return;
    } else {
      const cx = rng.chance(0.5) ? h.x + 20 : h.x + h.w - 20 - 64;
      const c = { x: Math.round(cx), y: Math.round(h.y + h.h - front), w: 64, h: 24 };
      if (kind === 'pharmacy') { c.x = Math.round(h.x + (h.w - Math.min(h.w - 80, 160)) / 2); c.w = Math.round(Math.min(h.w - 80, 160)); c.y = Math.round(h.y + 20); }
      if (bp.free(c, 2)) bp.add(c, 'counter', 'n', { register: true, chest: rng.chance(0.5) ? 'caja registradora' : null });
    }
    // estanterías contra las paredes laterales
    const tallWall = kind !== 'gas';
    for (const side of ['w', 'e']) {
      const len = h.h - front - 70;
      if (len > 60) {
        const r = side === 'w' ? { x: h.x, y: h.y + 50, w: 16, h: len } : { x: h.x + h.w - 16, y: h.y + 50, w: 16, h: len };
        if (bp.free(r, 0)) bp.add(r, kind === 'supermarket' && side === 'e' ? 'fridgerow' : 'wshelf', side === 'w' ? 'e' : 'w', { tall: tallWall, chest: rng.chance(0.5) ? (kind === 'supermarket' && side === 'e' ? 'nevera' : 'estantería') : null });
      }
    }
    // filas de góndolas
    const top = h.y + (kind === 'pharmacy' ? 90 : 56), bot = h.y + h.h - front - 20;
    const left = h.x + 60, right = h.x + h.w - 60;
    const sd = kind === 'hardware' ? 38 : 32, aisle = kind === 'supermarket' ? 70 : 60;
    const len = bot - top;
    if (len > 60) {
      // filas verticales con un pasillo transversal en medio si son largas
      const cut = len > 420;
      for (let x = left; x + sd <= right; x += sd + aisle) {
        const seg = (y0, y1) => {
          const r = { x: Math.round(x), y: Math.round(y0), w: sd, h: Math.round(y1 - y0) };
          if (r.h > 40 && bp.free(r, 0)) bp.add(r, kind === 'hardware' ? 'rack' : 'gondola', 's', { tall: true, chest: rng.chance(kind === 'supermarket' ? 0.35 : 0.5) ? 'estantería' : null });
        };
        if (cut) { const m = top + len / 2; seg(top, m - 34); seg(m + 34, bot); } else seg(top, bot);
      }
    }
    bp.decorIn(h, rng.pick(['trash', 'paper', 'cans']), rng.int(3, 7));
    bp.hintPts.push({ x: h.x + h.w / 2, y: h.y + h.h / 2 });
    if (!h.floor) h.floor = 'lino';
  }

  T.garage = function (bp) {
    const rng = bp.rng;
    const inner = bp.inner;
    const ow = Math.min(150, inner.w * 0.35);
    const [bay, office, wv] = bp.splitV(inner, Math.round(inner.x + inner.w - ow - bp.t / 2), {});
    let offR = office;
    let rooms = [];
    if (office.h > 250) {
      const [o1, o2] = bp.splitH(office, Math.round(office.y + office.h * 0.5), {});
      rooms.push(bp.room(o1, 'storage'), bp.room(o2, 'office'));
      offR = o2;
    } else rooms.push(bp.room(office, 'office'));
    const bayR = bp.room(bay, 'garage', 'concreteF');
    const nDoors = bay.w > 260 ? 2 : 1;
    for (let i = 0; i < nDoors; i++) bp.req(bp.wS, bay.x + (bay.w / nDoors) * i, bay.x + (bay.w / nDoors) * (i + 1), { dw: 96, kind: 'garage', center: true, hp: 300 });
    bp.extDoor(offR, 's', { dw: 36, main: true });
    bp.resolve();
    bp.allWindows(40, 80, 0.4, 40, 0.2);
    // elevadores con autos
    const slots = Math.max(1, Math.floor((bay.w - 40) / 130));
    for (let i = 0; i < slots; i++) {
      const cx = bay.x + 30 + i * 130 + 35;
      const c = { x: Math.round(cx), y: Math.round(bay.y + 70), w: 60, h: 144 };
      if (c.y + c.h > bay.y + bay.h - 60 || !bp.free(c, 4)) continue;
      bp.add({ x: c.x - 12, y: c.y + 20, w: 8, h: 8 }, 'post', 's', {});
      bp.add({ x: c.x + c.w + 4, y: c.y + 20, w: 8, h: 8 }, 'post', 's', {});
      if (rng.chance(0.75)) bp.add(c, 'car', 'n', { color: rng.pick(['#5a2a24', '#2f3b48', '#545a5c', '#7a766c']), chest: rng.chance(0.6) ? 'maletero' : null, tall: true, lifted: true });
    }
    bp.against(bayR, 64, 24, 'workbench', {}, ['n']);
    bp.against(bayR, 26, 16, 'toolcab', { chest: 'caja de herramientas' }, ['n', 'w']);
    bp.against(bayR, 26, 16, 'toolcab', { chest: rng.chance(0.6) ? 'caja de herramientas' : null }, ['n', 'w']);
    bp.against(bayR, 18, 18, 'barrelr', {});
    bp.decorIn(bayR, 'stain', 5);
    furnishAll(bp, rooms);
    bp.hintPts.push({ x: bay.x + bay.w / 2, y: bay.y + bay.h / 2 });
    bp.rooms = rooms.concat([bayR]);
  };

  T.warehouse = function (bp, hangar) {
    const rng = bp.rng;
    const inner = bp.inner;
    // oficina en una esquina delantera
    const ow = Math.round(rng.range(140, 200)), oh = Math.round(rng.range(120, 170));
    const [restTop, frontBand] = bp.splitH(inner, Math.round(inner.y + inner.h - oh - bp.t / 2), { door: false });
    const hw = bp.walls[bp.walls.length - 1];
    const [office, hallFront, ow2] = bp.splitV(frontBand, Math.round(frontBand.x + ow + bp.t / 2), {});
    // el muro horizontal solo cubre la oficina: se recorta
    hw.a1 = office.x + office.w + bp.t;
    const officeR = bp.room(office, 'office');
    const hall = { x: inner.x, y: inner.y, w: inner.w, h: inner.h };
    const hallR = bp.room(hall, 'storage', 'concreteF');
    bp.req(hw, office.x, office.x + office.w, {});
    bp.extDoor(officeR, 's', { dw: 36, main: true });
    bp.req(bp.wS, hallFront.x, hallFront.x + hallFront.w, { dw: hangar ? 120 : 96, kind: 'garage', center: true, hp: 320, dbl: !!hangar });
    if (rng.chance(0.7)) bp.req(rng.chance(0.5) ? bp.wE : bp.wW, inner.y, inner.y + inner.h * 0.7, { dw: 96, kind: 'garage', hp: 320 });
    bp.resolve();
    bp.allWindows(40, 120, 0.3, 40, 0.25);
    FURNISH.office(bp, officeR);
    officeR.floor = 'lino';
    if (hangar) {
      const pw = Math.min(hall.w - 120, 360), ph = Math.min(hall.h - 160, 300);
      bp.add({ x: Math.round(hall.x + (hall.w - pw) / 2), y: Math.round(hall.y + 60), w: Math.round(pw), h: Math.round(ph) }, 'plane', 's', { tall: false, solid: true });
    } else {
      // estanterías industriales
      const sd = 36, aisle = 96;
      const top = hall.y + 40, bot = hall.y + hall.h - oh - 80;
      for (let x = hall.x + 40; x + sd < hall.x + hall.w - 40; x += sd + aisle) {
        const r = { x: Math.round(x), y: Math.round(top), w: sd, h: Math.round(bot - top) };
        if (r.h > 80 && bp.free(r, 0)) bp.add(r, 'rack', 's', { tall: true, chest: rng.chance(0.6) ? 'estantería' : null });
      }
      if (rng.chance(0.6)) bp.center({ x: hall.x, y: bot, w: hall.w, h: hall.y + hall.h - bot }, 30, 60, 'forklift', {}, 20);
      for (let i = 0; i < 4; i++) bp.center({ x: hall.x + ow, y: bot, w: hall.w - ow, h: hall.y + hall.h - bot }, 26, 26, 'crate', { chest: rng.chance(0.4) ? 'caja' : null }, 14);
    }
    bp.decorIn(hall, 'stain', 4); bp.decorIn(hall, 'trash', 3);
    bp.hintPts.push({ x: hall.x + hall.w / 2, y: hall.y + hall.h / 2 });
    bp.hintPts.push({ x: office.x + office.w / 2, y: office.y + office.h / 2 });
    bp.rooms = [hallR, officeR];
    // el muro horizontal de la oficina queda dentro de la nave: la nave se dibuja primero
    hallR.floor = 'concreteF';
    void restTop; void ow2;
  };

  T.factory = function (bp) {
    const rng = bp.rng;
    const inner = bp.inner;
    // franja delantera con oficinas, vestuarios y almacén
    const fd = Math.round(rng.range(150, 200));
    const [hall, band, bw] = bp.splitH(inner, Math.round(inner.y + inner.h - fd - bp.t / 2), { door: false });
    const hallR = bp.room(hall, 'storage', 'concreteF');
    const pieces = bp.rowRooms(band, 'x', 130, 230, bw, {});
    const roles = ['office', 'lockers', 'storage', 'office', 'restroom', 'breakroom', 'storage'];
    const rooms = pieces.map((p, i) => bp.room(p, roles[i % roles.length]));
    bp.extDoor(rooms[0], 's', { dw: 38, main: true });
    if (rooms.length > 2) bp.extDoor(rooms[rooms.length - 1], 's', { dw: 38 });
    bp.req(bp.wN, hall.x, hall.x + hall.w, { dw: 96, kind: 'garage', hp: 320 });
    bp.req(rng.chance(0.5) ? bp.wE : bp.wW, hall.y, hall.y + hall.h, { dw: 96, kind: 'garage', hp: 320 });
    bp.resolve();
    bp.allWindows(48, 110, 0.4, 40, 0.5);
    furnishAll(bp, rooms);
    // máquinas en cuadrícula y cintas transportadoras
    const cell = 200;
    for (let y = hall.y + 70; y + 130 < hall.y + hall.h - 60; y += cell) {
      for (let x = hall.x + 70; x + 130 < hall.x + hall.w - 60; x += cell) {
        const k = rng.next();
        const put = (r, f, o) => { if (bp.free(r, 12)) bp.add(r, f, 's', o); };
        if (k < 0.45) put({ x: Math.round(x), y: Math.round(y), w: Math.round(rng.range(70, 120)), h: Math.round(rng.range(60, 110)) }, 'machine', { tall: rng.chance(0.5) });
        else if (k < 0.65) put({ x: Math.round(x), y: Math.round(y + 40), w: 160, h: 26 }, 'conveyor', {});
        else if (k < 0.8) put({ x: Math.round(x + 20), y: Math.round(y + 20), w: 26, h: 26 }, 'crate', { chest: rng.chance(0.4) ? 'caja' : null });
        else if (k < 0.88) put({ x: Math.round(x + 30), y: Math.round(y + 30), w: 20, h: 20 }, 'barrelr', {});
      }
    }
    bp.decorIn(hall, 'stain', 8); bp.decorIn(hall, 'rubble', 4);
    for (let i = 0; i < 3; i++) bp.hintPts.push({ x: hall.x + hall.w * (0.2 + 0.3 * i), y: hall.y + hall.h / 2 });
    bp.rooms = rooms.concat([hallR]);
  };

  // Complejo de pasillos: vestíbulo delantero + espina central + bandas de habitaciones a ambos lados de pasillos
  T.complex = function* (bp, kind) {
    const rng = bp.rng;
    const inner = bp.inner;
    const lobbyD = Math.round(kind === 'apartments' ? rng.range(110, 150) : kind === 'prison' ? 140 : rng.range(150, 260));
    const [rest, lobby, lw] = bp.splitH(inner, Math.round(inner.y + inner.h - lobbyD - bp.t / 2), { door: false });
    const lobbyR = bp.room(lobby, 'lobby', kind === 'hospital' ? 'lino' : 'stone');
    bp.extDoor(lobbyR, 's', { dw: 40, dbl: kind !== 'apartments', center: true, kind: kind === 'police' || kind === 'prison' ? 'metal' : 'glass', main: true });
    // espina central
    const spW = Math.round(kind === 'hospital' ? 96 : 72);
    const sx = Math.round(rest.x + rest.w / 2);
    const [L, mid] = bp.splitV(rest, sx - spW / 2 - bp.t / 2, { door: false });
    const wL = bp.walls[bp.walls.length - 1];
    const [spine, Rr] = bp.splitV(mid, sx + spW / 2 + bp.t / 2, { door: false });
    const wR = bp.walls[bp.walls.length - 1];
    const spineR = bp.room(spine, 'corridor', 'lino');
    bp.req(lw, spine.x, spine.x + spine.w, { dw: Math.min(spW, 80), gap: true, center: true });
    if (rng.chance(0.7)) bp.extDoor(spineR, 'n', { dw: 38, kind: 'metal' });
    const rooms = [];
    const roleList = {
      hospital: ['patient', 'patient', 'patient', 'office', 'surgery', 'dispensary', 'restroom', 'storage', 'patient'],
      school: ['classroom', 'classroom', 'classroom', 'office', 'restroom', 'classroom', 'storage', 'cafeteria', 'gym'],
      police: ['office', 'office', 'cell', 'cell', 'lockers', 'armory', 'office', 'restroom', 'meeting'],
      prison: ['cell', 'cell', 'cell', 'cell', 'cell', 'lockers', 'office', 'cell', 'armory'],
      apartments: ['flat'], office: ['office', 'office', 'meeting', 'office', 'restroom', 'storage', 'breakroom'],
      military: ['office', 'bunks', 'armory', 'meeting', 'storage', 'bunks'],
      lab: ['lab', 'lab', 'office', 'storage', 'lab', 'generator'],
    }[kind] || ['office'];
    let ri = Math.floor(rng.next() * roleList.length);
    const roomDepth = kind === 'school' ? [190, 250] : kind === 'police' || kind === 'prison' ? [96, 130] : kind === 'apartments' ? [200, 260] : [150, 200];
    const roomW = kind === 'school' ? [200, 280] : kind === 'prison' ? [80, 96] : kind === 'apartments' ? [220, 320] : [110, 190];
    const corW = Math.round(rng.range(56, 72));
    for (const [part, sideWall, sideIsLeft] of [[L, wL, true], [Rr, wR, false]]) {
      // bandas horizontales: habitaciones / pasillo / habitaciones, repetidas
      let y = part.y;
      const bandsEnd = part.y + part.h;
      while (bandsEnd - y > 120) {
        const d1 = Math.round(rng.range(roomDepth[0], roomDepth[1]));
        const avail = bandsEnd - y;
        if (avail < d1 + corW + bp.t * 2 + 60) {
          // lo que queda: una banda de habitaciones encadenadas, la del extremo da a la espina
          const r = { x: part.x, y, w: part.w, h: avail };
          const w0 = bp.walls.length;
          const pcs = bp.rowRooms(r, 'x', roomW[0], roomW[1], null, {});
          for (const sw of bp.walls.slice(w0)) bp.req(sw, sw.a0, sw.a1, {});
          for (const p of pcs) {
            rooms.push(bp.room(p, roleList[ri++ % roleList.length]));
            const touches = sideIsLeft ? Math.abs(p.x + p.w - (sideWall.c - sideWall.t / 2)) < 2 : Math.abs(p.x - (sideWall.c + sideWall.t / 2)) < 2;
            if (touches) bp.req(sideWall, p.y, p.y + p.h, {});
          }
          break;
        }
        // banda superior de habitaciones
        const top = { x: part.x, y, w: part.w, h: d1 };
        const wTop = bp.wall('h', y + d1 + bp.t / 2, part.x, part.x + part.w, bp.t, false);
        const cor = { x: part.x, y: y + d1 + bp.t, w: part.w, h: corW };
        const wBot = bp.wall('h', cor.y + corW + bp.t / 2, part.x, part.x + part.w, bp.t, false);
        const corR = bp.room(cor, 'corridor', 'lino');
        bp.req(sideWall, cor.y, cor.y + cor.h, { dw: corW - 4, gap: true, center: true });
        const tops = bp.rowRooms(top, 'x', roomW[0], roomW[1], wTop, kind === 'prison' || (kind === 'police' && rng.chance(0.4)) ? { kind: 'bars', dw: 32 } : {});
        for (const p of tops) rooms.push(bp.room(p, roleList[ri++ % roleList.length]));
        y = cor.y + corW + bp.t;
        const remain = bandsEnd - y;
        const d2 = Math.round(Math.min(remain, rng.range(roomDepth[0], roomDepth[1])));
        if (remain - d2 < 120 + bp.t) {
          const bot = { x: part.x, y, w: part.w, h: remain };
          const bots = bp.rowRooms(bot, 'x', roomW[0], roomW[1], wBot, kind === 'prison' ? { kind: 'bars', dw: 32 } : {});
          for (const p of bots) rooms.push(bp.room(p, roleList[ri++ % roleList.length]));
          break;
        }
        const bot = { x: part.x, y, w: part.w, h: d2 };
        const bots = bp.rowRooms(bot, 'x', roomW[0], roomW[1], wBot, kind === 'prison' ? { kind: 'bars', dw: 32 } : {});
        for (const p of bots) rooms.push(bp.room(p, roleList[ri++ % roleList.length]));
        y += d2;
        if (bandsEnd - y > 120) { bp.wall('h', y + bp.t / 2, part.x, part.x + part.w, bp.t, false); y += bp.t; }
        void corR;
      }
    }
    yield;
    // pisos de apartamentos: subdivididos como casas (antes de colocar puertas)
    const final = [];
    for (const r of rooms) {
      if (r.role === 'flat') {
        const sub = bp.bsp(r, 76, 20 * M * M, 170, 3, {});
        if (sub.length === 1) { r.role = 'living'; final.push(r); continue; }
        const subs = sub.map((s) => ({ x: s.x, y: s.y, w: s.w, h: s.h, role: null }));
        subs.sort((a, b) => b.w * b.h - a.w * a.h);
        subs[0].role = 'living';
        subs[subs.length - 1].role = 'bath';
        if (subs.length > 2) subs[1].role = 'kitchen';
        for (let i = 2; i < subs.length - 1; i++) subs[i].role = 'bed';
        bp.rooms.splice(bp.rooms.indexOf(r), 1);
        for (const s of subs) { bp.rooms.push(s); final.push(s); }
      } else final.push(r);
    }
    bp.resolve();
    yield;
    bp.allWindows(rng.range(40, 56), rng.range(40, 70), kind === 'prison' || kind === 'military' ? 0.3 : 0.85, 56, 0.9);
    // mostrador del vestíbulo
    const lc = { x: Math.round(lobby.x + lobby.w / 2 - 90), y: Math.round(lobby.y + 24), w: 180, h: 26 };
    if (kind !== 'apartments' && bp.free(lc, 0)) bp.add(lc, 'counter', 's', { chest: rng.chance(0.4) ? 'archivador' : null });
    for (let i = 0; i < 3; i++) bp.against(lobbyR, 60, 20, 'bench', {}, ['e', 'w']);
    bp.decorIn(lobbyR, 'paper', 4);
    furnishAll(bp, final);
    bp.hintPts.push({ x: lobby.x + lobby.w / 2, y: lobby.y + lobby.h / 2 });
    bp.rooms = bp.rooms.filter((r) => r.role !== 'flat');
    void lobbyR; void spineR;
  };

  T.church = function (bp) {
    const rng = bp.rng;
    const inner = bp.inner;
    const sacW = Math.round(Math.min(130, inner.w * 0.35)), sacD = Math.round(rng.range(110, 150));
    const [top, nave] = bp.splitH(inner, Math.round(inner.y + sacD + bp.t / 2), { door: false });
    const hw = bp.walls[bp.walls.length - 1];
    const left = rng.chance(0.5);
    const [a, b] = bp.splitV(top, Math.round(left ? top.x + sacW + bp.t / 2 : top.x + top.w - sacW - bp.t / 2), {});
    const sac = left ? a : b, apse = left ? b : a;
    hw.a0 = left ? sac.x - bp.t : sac.x - bp.t; hw.a1 = sac.x + sac.w + bp.t;
    const sacR = bp.room(sac, 'office', 'woodDark');
    bp.req(hw, sac.x, sac.x + sac.w, {});
    const naveR = bp.room({ x: inner.x, y: inner.y, w: inner.w, h: inner.h }, 'nave', 'stone');
    bp.extDoor(naveR, 's', { dw: 40, dbl: true, center: true, hp: 220, main: true });
    if (rng.chance(0.6)) bp.extDoor({ x: inner.x, y: nave.y, w: inner.w, h: nave.h }, rng.chance(0.5) ? 'e' : 'w', { dw: 36 });
    bp.resolve();
    bp.windows(bp.wW, 30, 70, 0.9); bp.windows(bp.wE, 30, 70, 0.9);
    // altar y bancos
    bp.add({ x: Math.round(apse.x + apse.w / 2 - 32), y: Math.round(apse.y + 30), w: 64, h: 30 }, 'altar', 's', {});
    const aisle = 60;
    const pw = Math.round((nave.w - aisle - 80) / 2);
    for (let y = nave.y + 70; y + 20 < nave.y + nave.h - 90; y += 46) {
      if (rng.chance(0.1)) continue;
      bp.add({ x: Math.round(nave.x + 40), y: Math.round(y), w: pw, h: 18 }, 'pew', 's', {});
      if (rng.chance(0.92)) bp.add({ x: Math.round(nave.x + 40 + pw + aisle), y: Math.round(y), w: pw, h: 18 }, 'pew', 's', {});
    }
    FURNISH.office(bp, sacR);
    bp.decorIn(nave, 'candle', 5); bp.decorIn(nave, 'paper', 3);
    bp.hintPts.push({ x: nave.x + nave.w / 2, y: nave.y + nave.h / 2 });
    bp.rooms = [naveR, sacR];
  };

  T.bunker = function (bp) {
    const rng = bp.rng;
    const inner = bp.inner;
    const [back, front, hw] = bp.splitH(inner, Math.round(inner.y + inner.h * rng.range(0.55, 0.65)), { kind: 'metal', hp: 400, dw: 36 });
    const frontR = bp.room(front, 'storage', 'concreteF');
    const backs = back.w > 260 ? bp.rowRooms(back, 'x', 110, 170, hw, { kind: 'metal', hp: 400 }) : [back];
    void hw;
    const roles = ['bunks', 'armory', 'generator', 'storage'];
    const rooms = backs.map((b, i) => bp.room(b, roles[i % roles.length]));
    bp.extDoor(frontR, 's', { dw: 36, kind: 'metal', hp: 600, center: true, main: true });
    bp.resolve();
    furnishAll(bp, rooms.concat([frontR]));
    bp.rooms = rooms.concat([frontR]);
  };

  T.barracks = function (bp) {
    const rng = bp.rng;
    const inner = bp.inner;
    const ow = Math.round(Math.min(150, inner.w * 0.3));
    const [hall, office] = bp.splitV(inner, Math.round(inner.x + inner.w - ow - bp.t / 2), {});
    const hallR = bp.room(hall, 'bunks', 'concreteF');
    const offR = bp.room(office, rng.chance(0.5) ? 'armory' : 'office');
    bp.extDoor(hallR, 's', { dw: 38, main: true, kind: 'metal', hp: 260 });
    bp.resolve();
    bp.allWindows(40, 60, 0.7);
    // literas en filas
    for (let x = hall.x + 30; x + 28 < hall.x + hall.w - 20; x += 76) {
      if (bp.free({ x, y: hall.y + 8, w: 28, h: 64 }, 4)) bp.add({ x, y: hall.y + 8, w: 28, h: 64 }, 'bunk', 's', {});
      const y2 = hall.y + hall.h - 72;
      if (y2 > hall.y + 120 && bp.free({ x, y: y2, w: 28, h: 64 }, 4)) bp.add({ x, y: y2, w: 28, h: 64 }, 'bunk', 'n', {});
    }
    for (let i = 0; i < 3; i++) bp.center(hall, 52, 16, 'locker', { chest: rng.chance(0.7) ? 'taquilla' : null, tall: true }, 30);
    furnishAll(bp, [offR]);
    bp.hintPts.push({ x: hall.x + hall.w / 2, y: hall.y + hall.h / 2 });
    bp.rooms = [hallR, offR];
  };

  T.booth = function (bp) {
    const r = bp.room(bp.inner, 'office', 'concreteF');
    bp.extDoor(r, 's', { dw: 34, center: true, kind: 'metal' });
    bp.resolve();
    bp.allWindows(30, 20, 0.9);
    bp.against(r, 40, 20, 'desk', { pc: true });
    if (bp.rng.chance(0.6)) bp.against(r, 16, 18, 'filecab', { chest: 'archivador' });
  };

  // ---------- conversión a mundo ----------
  function makeXf(bp) {
    const b = bp.b, W = bp.W, D = bp.D, mir = bp.mirror;
    const pt = (lx, ly) => {
      if (mir) lx = W - lx;
      switch (b.front) {
        case 'n': return [b.x + W - lx, b.y + D - ly];
        case 'e': return [b.x + ly, b.y + W - lx];
        case 'w': return [b.x + D - ly, b.y + lx];
        default: return [b.x + lx, b.y + ly];
      }
    };
    const rect = (r) => {
      const [ax, ay] = pt(r.x, r.y), [bx, by] = pt(r.x + r.w, r.y + r.h);
      return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) };
    };
    const FACE = { s: { s: 's', n: 'n', e: 'e', w: 'w' }, n: { s: 'n', n: 's', e: 'w', w: 'e' }, e: { s: 'e', n: 'w', e: 'n', w: 's' }, w: { s: 'w', n: 'e', e: 's', w: 'n' } };
    const face = (f) => {
      if (mir) f = f === 'e' ? 'w' : f === 'w' ? 'e' : f;
      return FACE[b.front][f] || f;
    };
    return { pt, rect, face };
  }

  // Genera el detalle completo del edificio b (perezoso)
  WG.Build = {
    detail(b) { const g = this.detailGen(b); let r; do { r = g.next(); } while (!r.done); return r.value; },
    // Versión repartida en pasos: plantilla, amueblado por tandas y conversión final
    * detailGen(b) {
      const rng = new U.RNG(b.seed);
      b.T = b.T || ({ bunker: 16, military: 12, police: 12, hospital: 12, factory: 12, warehouse: 12, supermarket: 12, school: 12, church: 14 }[b.type] || 10);
      b.t = b.t || (b.w * b.h > 600 * 600 ? 8 : 6);
      const bp = new BP(b, rng);
      bp.boost = b.boost || 1;
      bp.defer = true;
      let it = null;
      try {
        switch (b.type) {
          case 'house':
            if (b.sub === 'cabin' || b.sub === 'shack') T.cabin(bp, {});
            else if (b.sub === 'hideout') T.cabin(bp, { hideout: true, locked: rng.chance(0.4) });
            else if (b.sub === 'shed') T.shed(bp);
            else T.house(bp, { garage: b.garage, small: b.w * b.h < 300 * 330 });
            break;
          case 'farmhouse': T.house(bp, { rustic: true, garage: false }); break;
          case 'barn': T.barn(bp); break;
          case 'pharmacy': T.shop(bp, 'pharmacy'); break;
          case 'supermarket': T.shop(bp, 'supermarket'); break;
          case 'gas': T.shop(bp, 'gas'); break;
          case 'hardware': T.shop(bp, 'hardware'); break;
          case 'garage': T.garage(bp); break;
          case 'warehouse': T.warehouse(bp, b.sub === 'hangar'); break;
          case 'factory': T.factory(bp); break;
          case 'hospital': it = T.complex(bp, 'hospital'); break;
          case 'school': it = T.complex(bp, 'school'); break;
          case 'police': it = T.complex(bp, b.sub === 'prison' ? 'prison' : 'police'); break;
          case 'church': T.church(bp); break;
          case 'bunker': T.bunker(bp); break;
          case 'military':
            if (b.sub === 'barracks') T.barracks(bp);
            else if (b.sub === 'booth' || b.sub === 'tower') T.booth(bp);
            else it = T.complex(bp, 'military');
            break;
          default:
            if (b.sub === 'apartments') it = T.complex(bp, 'apartments');
            else if (b.sub === 'office') it = T.complex(bp, 'office');
            else if (b.sub === 'lab') it = T.complex(bp, 'lab');
            else if (b.sub === 'store') T.shop(bp, 'store');
            else if (b.sub === 'bar') T.shop(bp, 'bar');
            else if (b.sub === 'shed') T.shed(bp);
            else if (b.sub === 'booth' || b.sub === 'tower') T.booth(bp);
            else T.house(bp, {});
        }
      } catch (e) {
        console.error('interior', b.type, b.sub, e);
      }
      // plantillas grandes repartidas en pasos
      if (it && typeof it.next === 'function') {
        try { yield* it; } catch (e) { console.error('interior', b.type, b.sub, e); }
      }
      yield;
      // amueblado diferido por tandas
      bp.defer = false;
      let nf = 0;
      for (const r of bp.pending) {
        try { FURNISH[r.role](bp, r); } catch (e) { console.error("amueblado", r.role, e); }
        if (WG.over()) yield;
      }
      if (b.type === "house" && !b.sub) for (const r of bp.rooms) if (r.alsoKitchen) FURNISH.kitchen(bp, r);
      if (bp.walls.length > 60) yield;
      return yield* finish(bp, rng);
    },
  };

  function* finish(bp, rng) {
    const b = bp.b, xf = makeXf(bp);
    const det = { obs: [], doors: [], chests: [], floors: [], walls: [], windows: [], furn: [], decor: [], hints: [], rooms: [], extDoors: [] };
    const ruin = b.ruined ? 0.25 : 0;
    // pisos: base del interior + habitaciones
    det.floors.push(Object.assign(xf.rect(bp.inner), { mat: b.baseFloor || (b.type === 'house' || b.type === 'farmhouse' ? 'wood' : 'concreteF') }));
    for (const r of bp.rooms) {
      if (!r.w || !r.h) continue;
      const wr = xf.rect(r);
      det.floors.push(Object.assign({ mat: r.floor || 'concreteF', role: r.role }, wr));
      det.rooms.push(Object.assign({ role: r.role }, wr));
    }
    let doorN = 0, chestN = 0;
    const DOOR_HP = { wood: 70, glass: 40, metal: 260, garage: 260, bars: 400 };
    for (const w of bp.walls) {
      if (w.removed) continue;
      // tramos sólidos entre aberturas
      const ops = w.open.slice().sort((p, q) => p.a0 - q.a0);
      let cur = w.a0;
      const seg = (a0, a1, kind) => {
        if (a1 - a0 < 0.5) return;
        const lr = w.axis === 'h' ? { x: a0, y: w.c - w.t / 2, w: a1 - a0, h: w.t } : { x: w.c - w.t / 2, y: a0, w: w.t, h: a1 - a0 };
        const r = xf.rect(lr);
        if (kind === 'wall') {
          // ruinas: algunos tramos interiores derrumbados
          if (!w.ext && ruin && rng.chance(ruin) && a1 - a0 > 50) { det.decor.push({ kind: 'rubble', x: r.x + r.w / 2, y: r.y + r.h / 2, s: 1.4, rot: 0, seed: rng.int(1, 1e9) }); return; }
          const o = { shape: 'rect', kind: 'wall', x: r.x, y: r.y, w: r.w, h: r.h, blocksSight: true, ext: w.ext };
          det.obs.push(o); det.walls.push(o);
        } else if (kind === 'window') {
          const o = { shape: 'rect', kind: 'window', x: r.x, y: r.y, w: r.w, h: r.h, blocksSight: false, boarded: !!b.barricaded || rng.chance(0.12), broken: rng.chance(0.5) };
          det.obs.push(o); det.windows.push(o);
        }
      };
      for (const o of ops) {
        seg(cur, o.a0, 'wall');
        if (o.type === 'window') seg(o.a0, o.a1, 'window');
        else if (o.type === 'door') {
          const q = o.q;
          const kinds = q.kind;
          const n = q.dbl ? 2 : 1;
          const dw = (o.a1 - o.a0) / n;
          for (let k = 0; k < n; k++) {
            const a0 = o.a0 + dw * k;
            const lr = w.axis === 'h' ? { x: a0, y: w.c - w.t / 2, w: dw, h: w.t } : { x: w.c - w.t / 2, y: a0, w: w.t, h: dw };
            const r = xf.rect(lr);
            const hp = q.hp || DOOR_HP[kinds] || 70;
            const d = {
              id: b.id + 'd' + (doorN++), shape: 'rect', kind: 'door', x: r.x, y: r.y, w: r.w, h: r.h,
              cx: r.x + r.w / 2, cy: r.y + r.h / 2, horiz: r.w >= r.h, mat: kinds, ext: w.ext,
              open: false, broken: false, hp, maxHp: hp, buildingId: b.id, locked: false,
              blocksSight: kinds !== 'glass' && kinds !== 'bars',
              hinge: n === 2 ? (k === 0 ? 0 : 1) : (rng.chance(0.5) ? 0 : 1),
            };
            // sentido de apertura: hacia el interior (puertas exteriores) o al azar
            const bcx = b.x + b.w / 2, bcy = b.y + b.h / 2;
            d.swing = d.horiz ? (w.ext ? Math.sign(bcy - d.cy) || 1 : (rng.chance(0.5) ? 1 : -1)) : (w.ext ? Math.sign(bcx - d.cx) || 1 : (rng.chance(0.5) ? 1 : -1));
            // estado inicial: muchas puertas quedaron abiertas o rotas
            const roll = rng.next();
            if (w.ext && b.barricaded && q.main) { d.locked = true; d.barricade = true; d.hp = d.maxHp = hp * 2; }
            else if (q.locked) d.locked = true;
            else if (roll < (w.ext ? 0.12 : 0.1)) d.broken = true;
            else if (roll < (w.ext ? 0.3 : 0.5)) d.open = true;
            if (kinds === 'garage' && !d.broken) d.open = rng.chance(0.25);
            if (d.broken) d.hp = 0;
            det.obs.push(d); det.doors.push(d);
            if (w.ext) det.extDoors.push(d);
          }
        }
        cur = o.a1;
      }
      seg(cur, w.a1, 'wall');
    }
    if (det.obs.length > 150) yield;
    // muebles y cofres
    for (const f of bp.furn) {
      const r = xf.rect(f);
      const it = Object.assign({}, f, r, { face: xf.face(f.face), seed: rng.int(1, 1e9) });
      det.furn.push(it);
      if (f.solid) {
        det.obs.push({ shape: 'rect', kind: 'furn', f: f.f, x: r.x, y: r.y, w: r.w, h: r.h, blocksSight: !!f.tall });
      }
    }
    for (const cd of bp.chestDefs) {
      const f = cd.furn;
      const r = xf.rect(f);
      det.chests.push(WG.makeChest(rng, b.id + 'c' + (chestN++), r.x + r.w / 2, r.y + r.h / 2, cd.container, b.type, b.danger, b.id, (cd.boost || 1) * (b.boost || 1)));
    }
    for (const d of bp.decor) {
      const [x, y] = xf.pt(d.x, d.y);
      det.decor.push(Object.assign({}, d, { x, y }));
    }
    for (const h of bp.hintPts) {
      const [x, y] = xf.pt(h.x, h.y);
      det.hints.push({ x, y, indoor: true, buildingType: b.type, danger: b.danger, buildingId: b.id });
    }
    // cartel delante de la puerta principal (infectados / no entrar)
    const main = det.extDoors[0];
    if (main && b.sign) {
      const out = 30;
      const bcx = b.x + b.w / 2, bcy = b.y + b.h / 2;
      let sx = main.cx, sy = main.cy;
      if (main.horiz) sy += main.cy < bcy ? -out : out; else sx += main.cx < bcx ? -out : out;
      det.decorOut = [{ kind: 'text', text: b.sign, x: sx, y: sy, s: 1, rot: main.horiz ? 0 : -Math.PI / 2, color: 'rgba(170,30,20,0.85)', seed: 1, size: 14 }];
    }
    if (b.ruined) {
      for (const r of det.rooms) if (rng.chance(0.5)) det.decor.push({ kind: 'rubble', x: r.x + rng.range(10, r.w - 10), y: r.y + rng.range(10, r.h - 10), s: rng.range(0.8, 1.6), rot: 0, seed: rng.int(1, 1e9) });
    }
    if (b.bloody) {
      const r = det.rooms[Math.floor(rng.next() * det.rooms.length)];
      if (r) det.decor.push({ kind: 'body', x: r.x + r.w / 2, y: r.y + r.h / 2, s: 1, rot: rng.range(0, 6.28), seed: rng.int(1, 1e9) });
    }
    return det;
  }

  WG.BP = BP;
})();
