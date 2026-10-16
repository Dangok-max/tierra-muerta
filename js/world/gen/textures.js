// Texturas de suelo y pisos interiores (tileables, generadas una vez al arrancar). TM.WG.Tex
(function () {
  const U = TM.U;
  const WG = TM.WG = TM.WG || {};
  const TILE = 256;

  // hash mezclado (evita franjas diagonales con valores enteros pequeños)
  function TH(x, y, seed) { return U.hash2(x * 7919 + y * 104729 + 17, (x * 31 + 7) ^ (y * 53), seed); }
  function tnoise(x, y, P, seed) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const m = (v) => ((v % P) + P) % P;
    const a = TH(m(ix), m(iy), seed), b = TH(m(ix + 1), m(iy), seed);
    const c = TH(m(ix), m(iy + 1), seed), d = TH(m(ix + 1), m(iy + 1), seed);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  }

  // Paletas de suelo exterior
  const PAL = {
    forest:   { lo: [33, 30, 23], hi: [62, 56, 41], grain: 14, base: 5, extra: 'leaves' },
    plains:   { lo: [56, 54, 39], hi: [88, 84, 60], grain: 14, base: 5, extra: 'grass' },
    farmland: { lo: [47, 37, 27], hi: [78, 62, 44], grain: 14, base: 4 },
    desert:   { lo: [84, 71, 52], hi: [124, 107, 80], grain: 16, base: 4, extra: 'pebbles' },
    swamp:    { lo: [25, 29, 23], hi: [50, 54, 39], grain: 12, base: 6, extra: 'wet' },
    urban:    { lo: [43, 42, 39], hi: [70, 68, 62], grain: 18, base: 6, extra: 'pebbles' },
    ash:      { lo: [22, 21, 20], hi: [46, 43, 40], grain: 14, base: 6, extra: 'embers' },
    drymud:   { lo: [92, 81, 64], hi: [120, 106, 85], grain: 10, base: 3, extra: 'cracks' },
    camp:     { lo: [44, 38, 28], hi: [74, 64, 46], grain: 14, base: 5 },
    asphalt:  { lo: [31, 31, 33], hi: [52, 52, 54], grain: 20, base: 8 },
    dirtroad: { lo: [60, 49, 35], hi: [88, 72, 52], grain: 16, base: 6, extra: 'pebbles' },
    concrete: { lo: [76, 75, 70], hi: [98, 96, 90], grain: 12, base: 4, extra: 'joints' },
    lawn:     { lo: [48, 52, 35], hi: [74, 78, 51], grain: 14, base: 6, extra: 'grass' },
    gravel:   { lo: [66, 63, 56], hi: [94, 90, 80], grain: 30, base: 8 },
    field:    { lo: [52, 42, 29], hi: [84, 68, 46], grain: 14, base: 4, extra: 'rows' },
  };

  function makeTile(name, seed) {
    const pal = PAL[name];
    const c = U.makeCanvas(TILE, TILE);
    const g = c.getContext('2d');
    const P0 = pal.base;
    // ruido periódico de baja resolución (celosías precalculadas) que luego se amplía con suavizado
    const lat = [], Ps = [];
    const lr = new U.RNG(seed * 13 + 7);
    for (let o = 0, P = P0; o < 3; o++, P *= 2) {
      const L = new Float32Array(P * P);
      for (let i = 0; i < L.length; i++) L[i] = lr.next();
      lat.push(L); Ps.push(P);
    }
    const N = 64, S = N + 2;
    const small = U.makeCanvas(S, S), sg = small.getContext("2d");
    const img = sg.createImageData(S, S), d = img.data;
    for (let j = 0; j < S; j++) {
      for (let i = 0; i < S; i++) {
        // muestra en el centro del píxel (con un píxel de margen envuelto a cada lado)
        let v = 0, amp = 0.5, norm = 0;
        for (let o = 0; o < 3; o++) {
          const P = Ps[o], L = lat[o];
          const u = (i - 0.5) * P / N, w = (j - 0.5) * P / N;
          const ix = Math.floor(u), iy = Math.floor(w);
          let fx = u - ix, fy = w - iy;
          fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
          const x0 = ((ix % P) + P) % P, x1 = (x0 + 1) % P, y0 = (((iy % P) + P) % P) * P, y1 = ((((iy + 1) % P) + P) % P) * P;
          const a = L[y0 + x0], b = L[y0 + x1], c2 = L[y1 + x0], e = L[y1 + x1];
          v += (a + (b - a) * fx + (c2 - a) * fy + (a - b - c2 + e) * fx * fy) * amp;
          norm += amp; amp *= 0.5;
        }
        v = U.smoothstep(0.2, 0.8, v / norm);
        const k = (j * S + i) * 4;
        d[k] = pal.lo[0] + (pal.hi[0] - pal.lo[0]) * v;
        d[k + 1] = pal.lo[1] + (pal.hi[1] - pal.lo[1]) * v;
        d[k + 2] = pal.lo[2] + (pal.hi[2] - pal.lo[2]) * v;
        d[k + 3] = 255;
      }
    }
    sg.putImageData(img, 0, 0);
    g.imageSmoothingEnabled = true;
    // el píxel 1 del pequeño cae en el centro del primer bloque de 4 px: sin costuras al repetir
    const sc = TILE / N;
    g.drawImage(small, 0, 0, S, S, -sc * 1, -sc * 1, S * sc, S * sc);
    // grano fino compartido
    g.globalAlpha = Math.min(1, pal.grain / 26);
    g.drawImage(grainCanvas(), 0, 0);
    g.globalAlpha = 1;
    const rng = new U.RNG(seed * 7 + 1);
    // detalles repetibles (dibujados con envoltura en los bordes)
    // los detalles pequeños se colocan lejos de los bordes (no hace falta repetirlos envueltos)
    const wrap = (fn) => fn();
    const wrapAll = (fn) => { for (const ox of [-TILE, 0, TILE]) for (const oy of [-TILE, 0, TILE]) { g.save(); g.translate(ox, oy); fn(); g.restore(); } };
    switch (pal.extra) {
      case 'leaves': {
        const pts = [];
        for (let i = 0; i < 220; i++) pts.push([rng.range(10, TILE - 10), rng.range(10, TILE - 10), rng.pick(['#4a3a24', '#3c2e1e', '#57472b', '#2e2a1e']), rng.range(0, 3)]);
        wrap(() => { for (const p of pts) { g.fillStyle = p[2]; g.save(); g.translate(p[0], p[1]); g.rotate(p[3]); g.fillRect(-2, -1, 4, 2.5); g.restore(); } });
        break;
      }
      case 'grass': {
        const pts = [];
        for (let i = 0; i < 160; i++) pts.push([rng.range(10, TILE - 10), rng.range(10, TILE - 10), rng.pick(['rgba(110,104,70,0.5)', 'rgba(80,80,52,0.55)', 'rgba(124,112,74,0.4)']), rng.int(3, 6)]);
        wrap(() => {
          g.lineWidth = 1;
          for (const p of pts) {
            g.strokeStyle = p[2]; g.beginPath();
            for (let k = 0; k < p[3]; k++) { const a = -1.2 - k * 0.35 + (k % 2) * 0.5; g.moveTo(p[0], p[1]); g.lineTo(p[0] + Math.cos(a) * 6, p[1] + Math.sin(a) * 6); }
            g.stroke();
          }
        });
        break;
      }
      case 'pebbles': {
        const pts = [];
        for (let i = 0; i < 140; i++) pts.push([rng.range(10, TILE - 10), rng.range(10, TILE - 10), rng.range(0.8, 2.2), rng.chance(0.5)]);
        wrap(() => { for (const p of pts) { g.fillStyle = p[3] ? 'rgba(0,0,0,0.18)' : 'rgba(255,240,220,0.08)'; g.beginPath(); g.arc(p[0], p[1], p[2], 0, 6.283); g.fill(); } });
        break;
      }
      case 'wet': {
        const pts = [];
        for (let i = 0; i < 26; i++) pts.push([rng.range(10, TILE - 10), rng.range(10, TILE - 10), rng.range(6, 18)]);
        wrap(() => { for (const p of pts) { g.fillStyle = 'rgba(12,18,16,0.35)'; g.beginPath(); g.ellipse(p[0], p[1], p[2], p[2] * 0.6, 0.3, 0, 6.283); g.fill(); } });
        break;
      }
      case 'embers': {
        const pts = [];
        for (let i = 0; i < 90; i++) pts.push([rng.range(10, TILE - 10), rng.range(10, TILE - 10), rng.chance(0.15)]);
        wrap(() => { for (const p of pts) { g.fillStyle = p[2] ? 'rgba(120,50,20,0.5)' : 'rgba(0,0,0,0.35)'; g.fillRect(p[0], p[1], 2, 2); } });
        break;
      }
      case 'cracks': {
        const segs = [];
        for (let i = 0; i < 26; i++) {
          let x = rng.range(0, TILE), y = rng.range(0, TILE);
          const s = [x, y];
          for (let k = 0; k < 4; k++) { x += rng.range(-22, 22); y += rng.range(-22, 22); s.push(x, y); }
          segs.push(s);
        }
        wrapAll(() => {
          g.strokeStyle = 'rgba(50,40,28,0.55)'; g.lineWidth = 1.3;
          for (const s of segs) { g.beginPath(); g.moveTo(s[0], s[1]); for (let k = 2; k < s.length; k += 2) g.lineTo(s[k], s[k + 1]); g.stroke(); }
        });
        break;
      }
      case 'joints': {
        g.strokeStyle = 'rgba(30,30,28,0.35)'; g.lineWidth = 1.5;
        g.beginPath();
        for (let i = 0; i <= TILE; i += 64) { g.moveTo(i, 0); g.lineTo(i, TILE); g.moveTo(0, i); g.lineTo(TILE, i); }
        g.stroke();
        break;
      }
      case 'rows': {
        // surcos de cultivo (horizontales; se giran al dibujar)
        for (let y = 0; y < TILE; y += 16) {
          g.fillStyle = 'rgba(20,14,8,0.35)'; g.fillRect(0, y, TILE, 5);
          g.fillStyle = 'rgba(140,120,80,0.12)'; g.fillRect(0, y + 8, TILE, 3);
        }
        for (let i = 0; i < 140; i++) {
          const x = rng.range(0, TILE), y = Math.floor(rng.range(0, 16)) * 16 + 9;
          g.fillStyle = rng.pick(['rgba(90,80,40,0.7)', 'rgba(70,64,34,0.7)', 'rgba(110,92,50,0.6)']);
          g.fillRect(x, y - 2, rng.range(2, 5), 4);
        }
        break;
      }
    }
    return c;
  }

  // ---------- Pisos interiores (patrones pequeños dibujados) ----------
  function floorTile(kind, seed) {
    const S = 128;
    const c = U.makeCanvas(S, S), g = c.getContext('2d');
    const rng = new U.RNG(seed);
    switch (kind) {
      case 'wood': case 'woodDark': {
        const base = kind === 'wood' ? [104, 76, 50] : [72, 52, 36];
        for (let y = 0; y < S; y += 10) {
          let x = -rng.range(0, 60);
          while (x < S) {
            const L = rng.range(40, 90), f = rng.range(0.82, 1.12);
            g.fillStyle = U.rgb(base[0] * f, base[1] * f, base[2] * f);
            g.fillRect(x, y, L, 10);
            g.fillStyle = 'rgba(0,0,0,0.28)'; g.fillRect(x, y, 1, 10);
            x += L;
          }
          g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(0, y + 9, S, 1);
        }
        // las tablas se cortan en el borde: repetir la fila envolviendo
        break;
      }
      case 'tile': case 'tileCheck': case 'stone': {
        const T = kind === 'stone' ? 32 : 16;
        for (let y = 0; y < S; y += T) for (let x = 0; x < S; x += T) {
          let v;
          if (kind === 'tileCheck') v = ((x / T + y / T) % 2) ? 150 : 92;
          else if (kind === 'stone') v = 118 + rng.range(-10, 10);
          else v = 138 + rng.range(-8, 8);
          g.fillStyle = kind === 'stone' ? U.rgb(v, v * 0.94, v * 0.84) : U.rgb(v, v * 1.0, v * 0.97);
          g.fillRect(x, y, T, T);
        }
        g.fillStyle = 'rgba(30,30,28,0.45)';
        for (let i = 0; i < S; i += T) { g.fillRect(i, 0, 1, S); g.fillRect(0, i, S, 1); }
        break;
      }
      case 'lino': {
        g.fillStyle = '#7d8478'; g.fillRect(0, 0, S, S);
        for (let i = 0; i < 500; i++) { g.fillStyle = rng.chance(0.5) ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.08)'; g.fillRect(rng.int(0, S), rng.int(0, S), 2, 2); }
        g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, 0, S, 1); g.fillRect(0, 0, 1, S);
        break;
      }
      case 'concreteF': {
        g.fillStyle = '#5c5b57'; g.fillRect(0, 0, S, S);
        for (let i = 0; i < 400; i++) { g.fillStyle = rng.chance(0.5) ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.05)'; const r = rng.range(1, 4); g.fillRect(rng.int(0, S), rng.int(0, S), r, r); }
        g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, 0, S, 1); g.fillRect(0, 0, 1, S);
        break;
      }
      case 'carpet': {
        const col = rng.pick([[86, 40, 38], [44, 52, 70], [70, 62, 44]]);
        g.fillStyle = U.rgb(col[0], col[1], col[2]); g.fillRect(0, 0, S, S);
        for (let i = 0; i < 900; i++) { g.fillStyle = rng.chance(0.5) ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.05)'; g.fillRect(rng.int(0, S), rng.int(0, S), 1, 1); }
        break;
      }
      case 'metal': {
        g.fillStyle = '#4c4f50'; g.fillRect(0, 0, S, S);
        g.fillStyle = 'rgba(255,255,255,0.08)';
        for (let y = 0; y < S; y += 8) for (let x = (y / 8 % 2) * 4; x < S; x += 8) g.fillRect(x, y, 4, 1.5);
        break;
      }
      case 'dirtF': {
        g.fillStyle = '#4d4030'; g.fillRect(0, 0, S, S);
        for (let i = 0; i < 300; i++) { g.fillStyle = rng.pick(['rgba(0,0,0,0.15)', 'rgba(150,120,60,0.15)']); g.fillRect(rng.int(0, S), rng.int(0, S), rng.range(1, 4), 1); }
        break;
      }
    }
    return c;
  }

  // Grano fino (puntos claros y oscuros) compartido por todas las texturas
  let grain = null;
  function grainCanvas() {
    if (grain) return grain;
    grain = U.makeCanvas(TILE, TILE);
    const g = grain.getContext('2d');
    const img = g.createImageData(TILE, TILE), d = img.data;
    let s = 12345;
    for (let i = 0; i < TILE * TILE; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      const r = (s >>> 8) / 16777216;
      const k = i * 4;
      const v = r < 0.5 ? 0 : 255;
      d[k] = v; d[k + 1] = v; d[k + 2] = v; d[k + 3] = Math.abs(r - 0.5) * 90;
    }
    g.putImageData(img, 0, 0);
    return grain;
  }

  const Tex = { TILE, PAL, tiles: null, floors: null };
  Tex.init = function () {
    if (Tex.tiles) return;
    Tex.tiles = {};
    let s = 11;
    for (const k in PAL) Tex.tiles[k] = makeTile(k, s += 17);
    Tex.floors = {};
    let f = 501;
    for (const k of ['wood', 'woodDark', 'tile', 'tileCheck', 'stone', 'lino', 'concreteF', 'carpet', 'metal', 'dirtF']) Tex.floors[k] = floorTile(k, f += 13);
  };

  WG.Tex = Tex;
})();
