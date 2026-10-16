// Texturas de suelo y pisos interiores (tileables, generadas una vez al arrancar). TM.WG.Tex
// Todo procedural y determinista. Cada textura: ruido periódico de baja frecuencia (tonos) + grano fino +
// detalles dibujados con envoltura en los bordes (sin costuras al repetir).
(function () {
  const U = TM.U;
  const WG = TM.WG = TM.WG || {};
  const TILE = 256;
  const TAU = Math.PI * 2;

  // Paletas de suelo exterior (apagadas, terrosas; buen contraste con jugador y zombies)
  const PAL = {
    forest:   { lo: [30, 29, 22], hi: [58, 54, 39], grain: 14, base: 5 },
    plains:   { lo: [54, 55, 38], hi: [86, 84, 58], grain: 12, base: 5 },
    farmland: { lo: [47, 38, 28], hi: [76, 61, 44], grain: 14, base: 4 },
    desert:   { lo: [96, 82, 60], hi: [132, 115, 86], grain: 12, base: 4 },
    swamp:    { lo: [26, 30, 24], hi: [50, 54, 39], grain: 12, base: 6 },
    urban:    { lo: [46, 44, 39], hi: [72, 69, 61], grain: 16, base: 6 },
    ash:      { lo: [22, 21, 20], hi: [46, 43, 40], grain: 14, base: 6 },
    drymud:   { lo: [96, 84, 66], hi: [122, 108, 86], grain: 10, base: 3 },
    camp:     { lo: [46, 40, 30], hi: [74, 64, 46], grain: 14, base: 5 },
    asphalt:  { lo: [34, 34, 36], hi: [54, 54, 56], grain: 22, base: 6 },
    dirtroad: { lo: [62, 51, 37], hi: [90, 74, 54], grain: 16, base: 6 },
    concrete: { lo: [84, 82, 76], hi: [104, 102, 95], grain: 14, base: 4 },
    pavers:   { lo: [80, 77, 70], hi: [100, 96, 88], grain: 12, base: 4 },
    lawn:     { lo: [48, 54, 35], hi: [74, 80, 52], grain: 12, base: 6 },
    gravel:   { lo: [70, 67, 60], hi: [94, 90, 80], grain: 26, base: 8 },
    field:    { lo: [54, 44, 30], hi: [84, 68, 46], grain: 14, base: 4 },
  };

  // ---------- utilidades ----------
  function lattice(seed, P0, oct) {
    const lat = [], Ps = [];
    const lr = new U.RNG(seed);
    for (let o = 0, P = P0; o < oct; o++, P *= 2) {
      const L = new Float32Array(P * P);
      for (let i = 0; i < L.length; i++) L[i] = lr.next();
      lat.push(L); Ps.push(P);
    }
    return { lat, Ps };
  }
  // ruido periódico (u, v en [0,1)) a partir de celosías
  function pnoise(N, u, v) {
    let s = 0, amp = 0.5, norm = 0;
    for (let o = 0; o < N.Ps.length; o++) {
      const P = N.Ps[o], L = N.lat[o];
      const x = u * P, y = v * P;
      const ix = Math.floor(x), iy = Math.floor(y);
      let fx = x - ix, fy = y - iy;
      fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
      const x0 = ((ix % P) + P) % P, x1 = (x0 + 1) % P, y0 = (((iy % P) + P) % P) * P, y1 = ((((iy + 1) % P) + P) % P) * P;
      const a = L[y0 + x0], b = L[y0 + x1], c = L[y1 + x0], d = L[y1 + x1];
      s += (a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy) * amp;
      norm += amp; amp *= 0.5;
    }
    return s / norm;
  }

  // Dibuja fn(x, y) en la posición y en sus copias envueltas si el detalle (radio r) cruza un borde
  function wrapAt(g, S, x, y, r, fn) {
    const xs = [0], ys = [0];
    if (x - r < 0) xs.push(S); if (x + r > S) xs.push(-S);
    if (y - r < 0) ys.push(S); if (y + r > S) ys.push(-S);
    for (const ox of xs) for (const oy of ys) fn(x + ox, y + oy);
  }

  function baseLayer(g, pal, seed, S) {
    const N = 64, Sm = N + 2;
    const nz = lattice(seed * 13 + 7, pal.base, 3);
    const small = U.makeCanvas(Sm, Sm), sg = small.getContext('2d');
    const img = sg.createImageData(Sm, Sm), d = img.data;
    for (let j = 0; j < Sm; j++) {
      for (let i = 0; i < Sm; i++) {
        let v = pnoise(nz, (i - 0.5) / N, (j - 0.5) / N);
        v = U.smoothstep(0.2, 0.8, v);
        const k = (j * Sm + i) * 4;
        d[k] = pal.lo[0] + (pal.hi[0] - pal.lo[0]) * v;
        d[k + 1] = pal.lo[1] + (pal.hi[1] - pal.lo[1]) * v;
        d[k + 2] = pal.lo[2] + (pal.hi[2] - pal.lo[2]) * v;
        d[k + 3] = 255;
      }
    }
    sg.putImageData(img, 0, 0);
    g.imageSmoothingEnabled = true;
    const sc = S / N;
    g.drawImage(small, 0, 0, Sm, Sm, -sc, -sc, Sm * sc, Sm * sc);
    g.globalAlpha = Math.min(1, pal.grain / 26);
    g.drawImage(grainCanvas(), 0, 0, S, S);
    g.globalAlpha = 1;
  }

  // Grietas ramificadas (línea oscura + borde claro)
  function crack(g, S, rng, x, y, len, w, dark, light) {
    const pts = [x, y];
    let a = rng.range(0, TAU);
    for (let k = 0; k < len; k++) { a += rng.range(-0.7, 0.7); x += Math.cos(a) * rng.range(5, 12); y += Math.sin(a) * rng.range(5, 12); pts.push(x, y); }
    const draw = (ox, oy) => {
      g.beginPath(); g.moveTo(pts[0] + ox, pts[1] + oy);
      for (let k = 2; k < pts.length; k += 2) g.lineTo(pts[k] + ox, pts[k + 1] + oy);
    };
    let mnx = 1e9, mny = 1e9, mxx = -1e9, mxy = -1e9;
    for (let k = 0; k < pts.length; k += 2) { mnx = Math.min(mnx, pts[k]); mxx = Math.max(mxx, pts[k]); mny = Math.min(mny, pts[k + 1]); mxy = Math.max(mxy, pts[k + 1]); }
    const xs = [0], ys = [0];
    if (mnx < 0) xs.push(S); if (mxx > S) xs.push(-S);
    if (mny < 0) ys.push(S); if (mxy > S) ys.push(-S);
    for (const ox of xs) for (const oy of ys) {
      if (light) { g.strokeStyle = light; g.lineWidth = w + 0.8; draw(ox + 0.7, oy + 0.7); g.stroke(); }
      g.strokeStyle = dark; g.lineWidth = w; draw(ox, oy); g.stroke();
    }
  }

  function softSpot(g, S, x, y, r, rgba0) {
    wrapAt(g, S, x, y, r, (px, py) => {
      const gr = g.createRadialGradient(px, py, 0, px, py, r);
      gr.addColorStop(0, rgba0); gr.addColorStop(1, rgba0.replace(/[\d.]+\)$/, '0)'));
      g.fillStyle = gr; g.fillRect(px - r, py - r, r * 2, r * 2);
    });
  }

  function blobPath(g, x, y, r, rng, n, jit) {
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU, rr = r * (1 - jit + rng.next() * jit * 2);
      const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
      if (i) g.lineTo(px, py); else g.moveTo(px, py);
    }
    g.closePath();
  }

  // hojitas de hierba (trazos cortos) en un mechón
  function tuft(g, x, y, n, L, cols, rng) {
    g.lineWidth = 1;
    for (let k = 0; k < n; k++) {
      const a = -Math.PI / 2 + rng.range(-1.1, 1.1), l = L * rng.range(0.5, 1.1);
      g.strokeStyle = cols[k % cols.length];
      g.beginPath(); g.moveTo(x + rng.range(-1.5, 1.5), y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
  }

  // ---------- detalles por textura ----------
  const DETAIL = {
    asphalt(g, S, rng) {
      // árido: puntos claros y oscuros
      for (let i = 0; i < 2600; i++) {
        g.fillStyle = rng.chance(0.55) ? `rgba(0,0,0,${rng.range(0.12, 0.3).toFixed(2)})` : `rgba(200,195,185,${rng.range(0.05, 0.16).toFixed(2)})`;
        g.fillRect(rng.range(0, S), rng.range(0, S), rng.range(0.8, 1.8), rng.range(0.8, 1.6));
      }
      // desgaste claro y parches de alquitrán
      for (let i = 0; i < 4; i++) softSpot(g, S, rng.range(0, S), rng.range(0, S), rng.range(30, 70), 'rgba(120,118,110,0.10)');
      for (let i = 0; i < 2; i++) {
        const w = rng.range(30, 70), h = rng.range(20, 50), x = rng.range(0, S), y = rng.range(0, S);
        wrapAt(g, S, x + w / 2, y + h / 2, Math.max(w, h), (px, py) => {
          g.fillStyle = 'rgba(16,16,18,0.42)'; g.fillRect(px - w / 2, py - h / 2, w, h);
          g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 1; g.strokeRect(px - w / 2, py - h / 2, w, h);
        });
      }
      for (let i = 0; i < 3; i++) softSpot(g, S, rng.range(0, S), rng.range(0, S), rng.range(8, 20), 'rgba(12,10,14,0.38)');
      for (let i = 0; i < 7; i++) crack(g, S, rng, rng.range(0, S), rng.range(0, S), rng.int(4, 9), rng.range(0.8, 1.4), 'rgba(10,10,12,0.6)', 'rgba(120,118,110,0.12)');
    },
    concrete(g, S, rng) {
      const T = 64;
      for (let y = 0; y < S; y += T) for (let x = 0; x < S; x += T) {
        const v = rng.range(-12, 10);
        g.fillStyle = v > 0 ? `rgba(255,250,240,${(v / 160).toFixed(3)})` : `rgba(0,0,0,${(-v / 140).toFixed(3)})`;
        g.fillRect(x, y, T, T);
        if (rng.chance(0.35)) softSpot(g, S, x + rng.range(10, T - 10), y + rng.range(10, T - 10), rng.range(8, 22), 'rgba(30,26,20,0.16)');
      }
      for (let i = 0; i < 900; i++) { g.fillStyle = rng.chance(0.5) ? 'rgba(0,0,0,0.14)' : 'rgba(255,255,255,0.08)'; g.fillRect(rng.range(0, S), rng.range(0, S), 1.2, 1.2); }
      for (let i = 0; i < 4; i++) crack(g, S, rng, rng.range(0, S), rng.range(0, S), rng.int(3, 6), 0.9, 'rgba(30,28,24,0.5)', null);
      // juntas con borde claro
      g.fillStyle = 'rgba(28,26,22,0.5)';
      for (let i = 0; i < S; i += T) { g.fillRect(i, 0, 1.5, S); g.fillRect(0, i, S, 1.5); }
      g.fillStyle = 'rgba(255,250,235,0.08)';
      for (let i = 0; i < S; i += T) { g.fillRect(i + 1.5, 0, 1, S); g.fillRect(0, i + 1.5, S, 1); }
    },
    pavers(g, S, rng) {
      // baldosas de acera 32 u con desgaste
      const T = 32;
      for (let y = 0; y < S; y += T) for (let x = 0; x < S; x += T) {
        const v = rng.range(-14, 10);
        g.fillStyle = v > 0 ? `rgba(255,250,240,${(v / 150).toFixed(3)})` : `rgba(0,0,0,${(-v / 120).toFixed(3)})`;
        g.fillRect(x, y, T, T);
        if (rng.chance(0.08)) { g.fillStyle = 'rgba(20,18,14,0.35)'; g.fillRect(x + 2, y + 2, T - 4, T - 4); }
        if (rng.chance(0.1)) crack(g, S, rng, x + T / 2, y + T / 2, 2, 0.8, 'rgba(25,22,18,0.55)', null);
      }
      for (let i = 0; i < 700; i++) { g.fillStyle = rng.chance(0.5) ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.07)'; g.fillRect(rng.range(0, S), rng.range(0, S), 1.2, 1.2); }
      g.fillStyle = 'rgba(24,22,18,0.55)';
      for (let i = 0; i < S; i += T) { g.fillRect(i, 0, 1.2, S); g.fillRect(0, i, S, 1.2); }
      // hierba en las juntas
      g.lineWidth = 1;
      for (let i = 0; i < 26; i++) {
        const onX = rng.chance(0.5), a = Math.floor(rng.range(0, S / T)) * T, b = rng.range(0, S);
        const x = onX ? a : b, y = onX ? b : a;
        tuft(g, x, y, rng.int(2, 4), 5, ['rgba(80,88,52,0.8)', 'rgba(98,100,62,0.7)'], rng);
      }
    },
    plains(g, S, rng) { grassDetail(g, S, rng, 1); },
    lawn(g, S, rng) { grassDetail(g, S, rng, 1.25); },
    forest(g, S, rng) {
      // musgo
      for (let i = 0; i < 7; i++) softSpot(g, S, rng.range(0, S), rng.range(0, S), rng.range(18, 40), 'rgba(52,62,34,0.35)');
      // hojarasca
      const cols = ['#4a3a24', '#3c2e1e', '#57472b', '#2e2a1e', '#5e4a2c', '#43381f', '#6a5432'];
      for (let i = 0; i < 520; i++) {
        const x = rng.range(0, S), y = rng.range(0, S), a = rng.range(0, TAU), l = rng.range(1.8, 3.6);
        const c = cols[rng.int(0, cols.length - 1)];
        wrapAt(g, S, x, y, 4, (px, py) => {
          g.fillStyle = c; g.beginPath(); g.ellipse(px, py, l, l * 0.55, a, 0, TAU); g.fill();
        });
      }
      // ramitas y agujas
      g.lineWidth = 1;
      for (let i = 0; i < 70; i++) {
        const x = rng.range(4, S - 4), y = rng.range(4, S - 4), a = rng.range(0, TAU), l = rng.range(3, 11);
        g.strokeStyle = rng.chance(0.5) ? 'rgba(30,24,16,0.7)' : 'rgba(90,74,50,0.5)';
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
      }
      for (let i = 0; i < 40; i++) tuft(g, rng.range(6, S - 6), rng.range(6, S - 6), rng.int(2, 5), 6, ['rgba(70,74,44,0.75)', 'rgba(56,60,36,0.8)'], rng);
    },
    farmland(g, S, rng) {
      for (let i = 0; i < 260; i++) {
        const x = rng.range(3, S - 3), y = rng.range(3, S - 3), r = rng.range(1, 3);
        g.fillStyle = 'rgba(20,14,8,0.35)'; g.beginPath(); g.arc(x + 0.8, y + 0.8, r, 0, TAU); g.fill();
        g.fillStyle = 'rgba(120,100,70,0.3)'; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
      }
      for (let i = 0; i < 30; i++) tuft(g, rng.range(6, S - 6), rng.range(6, S - 6), 3, 5, ['rgba(110,100,62,0.6)'], rng);
    },
    desert(g, S, rng) {
      // ondas de arena (periódicas en x)
      const k1 = rng.int(1, 2), ph = rng.range(0, TAU);
      for (let y0 = 0; y0 < S; y0 += 9) {
        const amp = 3 + (y0 % 27) / 9;
        for (const [col, dy] of [['rgba(60,46,28,0.16)', 1.6], ['rgba(255,240,210,0.10)', 0]]) {
          g.strokeStyle = col; g.lineWidth = 1.4;
          g.beginPath();
          for (let x = 0; x <= S; x += 4) {
            const y = y0 + dy + Math.sin((x / S) * TAU * k1 + ph + y0 * 0.11) * amp + Math.sin((x / S) * TAU * 3 + y0) * 1.2;
            if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
          }
          g.stroke();
        }
      }
      for (let i = 0; i < 90; i++) {
        const x = rng.range(3, S - 3), y = rng.range(3, S - 3), r = rng.range(0.8, 2.4);
        g.fillStyle = 'rgba(40,30,20,0.3)'; g.beginPath(); g.arc(x + 0.7, y + 0.8, r, 0, TAU); g.fill();
        g.fillStyle = rng.pick(['#8a7a62', '#6e604c', '#a08e70']); g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
      }
      for (let i = 0; i < 6; i++) tuft(g, rng.range(8, S - 8), rng.range(8, S - 8), rng.int(4, 7), 7, ['rgba(120,104,66,0.8)', 'rgba(96,84,52,0.8)'], rng);
    },
    swamp(g, S, rng) {
      for (let i = 0; i < 18; i++) {
        const x = rng.range(0, S), y = rng.range(0, S), r = rng.range(8, 24);
        wrapAt(g, S, x, y, r * 1.2, (px, py) => {
          g.fillStyle = 'rgba(12,18,16,0.42)'; blobPath(g, px, py, r, new U.RNG((x * 7 + y) | 0), 9, 0.3); g.fill();
          g.fillStyle = 'rgba(130,150,150,0.06)'; g.beginPath(); g.ellipse(px - r * 0.2, py - r * 0.2, r * 0.5, r * 0.2, -0.4, 0, TAU); g.fill();
        });
      }
      for (let i = 0; i < 10; i++) softSpot(g, S, rng.range(0, S), rng.range(0, S), rng.range(12, 30), 'rgba(60,72,34,0.3)');
      for (let i = 0; i < 50; i++) tuft(g, rng.range(6, S - 6), rng.range(6, S - 6), rng.int(3, 6), 8, ['rgba(70,78,46,0.85)', 'rgba(54,60,36,0.85)'], rng);
    },
    urban(g, S, rng) {
      // solar urbano: tierra apisonada, grava, cascotes, basura
      for (let i = 0; i < 6; i++) softSpot(g, S, rng.range(0, S), rng.range(0, S), rng.range(20, 50), 'rgba(90,86,76,0.18)');
      for (let i = 0; i < 260; i++) {
        const x = rng.range(2, S - 2), y = rng.range(2, S - 2), r = rng.range(0.7, 2);
        g.fillStyle = rng.chance(0.5) ? 'rgba(0,0,0,0.25)' : 'rgba(150,145,130,0.18)'; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
      }
      for (let i = 0; i < 14; i++) {
        const x = rng.range(6, S - 6), y = rng.range(6, S - 6);
        g.save(); g.translate(x, y); g.rotate(rng.range(0, TAU));
        g.fillStyle = rng.pick(['rgba(110,106,96,0.6)', 'rgba(70,66,60,0.6)', 'rgba(120,96,70,0.5)']); g.fillRect(-2, -1.5, rng.range(3, 6), rng.range(2, 4));
        g.restore();
      }
      for (let i = 0; i < 26; i++) tuft(g, rng.range(6, S - 6), rng.range(6, S - 6), rng.int(2, 5), 6, ['rgba(84,86,54,0.75)', 'rgba(104,98,64,0.7)'], rng);
      for (let i = 0; i < 3; i++) crack(g, S, rng, rng.range(0, S), rng.range(0, S), 4, 0.9, 'rgba(20,18,14,0.4)', null);
    },
    ash(g, S, rng) {
      for (let i = 0; i < 400; i++) { g.fillStyle = rng.chance(0.6) ? 'rgba(0,0,0,0.35)' : 'rgba(150,145,140,0.14)'; g.fillRect(rng.range(0, S), rng.range(0, S), rng.range(1, 2.5), rng.range(1, 2.5)); }
      for (let i = 0; i < 14; i++) { g.fillStyle = 'rgba(150,60,24,0.45)'; g.fillRect(rng.range(4, S - 4), rng.range(4, S - 4), 1.5, 1.5); }
      g.lineWidth = 2;
      for (let i = 0; i < 18; i++) { const x = rng.range(10, S - 10), y = rng.range(10, S - 10), a = rng.range(0, TAU), l = rng.range(5, 14); g.strokeStyle = 'rgba(8,8,8,0.6)'; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); }
    },
    drymud(g, S, rng) {
      // celdas de Voronoi periódicas: placas de barro cuarteado
      const pts = [];
      for (let i = 0; i < 46; i++) pts.push([rng.range(0, S), rng.range(0, S)]);
      const img = g.getImageData(0, 0, S, S), d = img.data;
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        let d1 = 1e9, d2 = 1e9;
        for (const p of pts) {
          let dx = Math.abs(x - p[0]), dy = Math.abs(y - p[1]);
          if (dx > S / 2) dx = S - dx; if (dy > S / 2) dy = S - dy;
          const dd = dx * dx + dy * dy;
          if (dd < d1) { d2 = d1; d1 = dd; } else if (dd < d2) d2 = dd;
        }
        const e = Math.sqrt(d2) - Math.sqrt(d1);
        const k = (y * S + x) * 4;
        let f = 1;
        if (e < 1.1) f = 0.62; else if (e < 2.2) f = 0.88; else f = 1 + Math.min(0.08, (e - 2.2) * 0.006);
        d[k] *= f; d[k + 1] *= f; d[k + 2] *= f;
      }
      g.putImageData(img, 0, 0);
    },
    camp(g, S, rng) {
      for (let i = 0; i < 200; i++) { const x = rng.range(2, S - 2), y = rng.range(2, S - 2); g.fillStyle = rng.chance(0.5) ? 'rgba(0,0,0,0.2)' : 'rgba(150,130,100,0.15)'; g.beginPath(); g.arc(x, y, rng.range(0.8, 2), 0, TAU); g.fill(); }
      for (let i = 0; i < 20; i++) tuft(g, rng.range(6, S - 6), rng.range(6, S - 6), 3, 5, ['rgba(90,88,56,0.7)'], rng);
    },
    dirtroad(g, S, rng) {
      for (let i = 0; i < 300; i++) {
        const x = rng.range(2, S - 2), y = rng.range(2, S - 2), r = rng.range(0.8, 2.6);
        g.fillStyle = 'rgba(25,18,10,0.3)'; g.beginPath(); g.arc(x + 0.7, y + 0.7, r, 0, TAU); g.fill();
        g.fillStyle = rng.pick(['rgba(130,112,86,0.5)', 'rgba(100,88,70,0.5)', 'rgba(150,134,108,0.4)']); g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
      }
      for (let i = 0; i < 5; i++) softSpot(g, S, rng.range(0, S), rng.range(0, S), rng.range(10, 26), 'rgba(30,22,14,0.25)');
    },
    gravel(g, S, rng) {
      for (let i = 0; i < 1500; i++) {
        const x = rng.range(2, S - 2), y = rng.range(2, S - 2), r = rng.range(1, 2.8);
        const v = rng.int(60, 120);
        g.fillStyle = 'rgba(0,0,0,0.3)'; g.beginPath(); g.ellipse(x + 0.6, y + 0.8, r, r * 0.8, 0, 0, TAU); g.fill();
        g.fillStyle = `rgb(${v},${v - 3},${v - 9})`; g.beginPath(); g.ellipse(x, y, r, r * 0.8, rng.range(0, 3), 0, TAU); g.fill();
      }
    },
    field(g, S, rng) {
      // surcos de cultivo (horizontales; se giran al dibujar)
      for (let y = 0; y < S; y += 16) {
        g.fillStyle = 'rgba(20,14,8,0.38)'; g.fillRect(0, y, S, 5);
        g.fillStyle = 'rgba(140,120,80,0.14)'; g.fillRect(0, y + 8, S, 3);
      }
      for (let i = 0; i < 260; i++) {
        const x = rng.range(4, S - 4), y = Math.floor(rng.range(0, 16)) * 16 + 10;
        tuft(g, x, y, rng.int(2, 4), 5, rng.chance(0.6) ? ['rgba(120,104,58,0.8)', 'rgba(96,84,44,0.8)'] : ['rgba(80,84,46,0.8)'], rng);
      }
    },
  };

  function grassDetail(g, S, rng, lush) {
    // matas oscuras y claras, calvas de tierra, mechones de varios tonos, flores secas
    for (let i = 0; i < 10; i++) softSpot(g, S, rng.range(0, S), rng.range(0, S), rng.range(14, 36), rng.chance(0.5) ? 'rgba(30,34,18,0.28)' : 'rgba(120,112,70,0.16)');
    for (let i = 0; i < 4; i++) softSpot(g, S, rng.range(0, S), rng.range(0, S), rng.range(8, 18), 'rgba(70,56,36,0.35)');
    const cols = [
      ['rgba(78,84,48,0.85)', 'rgba(96,98,60,0.8)'], ['rgba(110,104,64,0.75)', 'rgba(126,114,72,0.7)'],
      ['rgba(58,66,38,0.85)', 'rgba(70,78,44,0.8)'], ['rgba(88,96,56,0.8)', 'rgba(64,72,40,0.85)'],
    ];
    g.lineWidth = 1;
    const n = Math.round(330 * lush);
    for (let i = 0; i < n; i++) tuft(g, rng.range(7, S - 7), rng.range(7, S - 7), rng.int(3, 6), rng.range(4, 7), cols[rng.int(0, 3)], rng);
    for (let i = 0; i < 26; i++) {
      const x = rng.range(4, S - 4), y = rng.range(4, S - 4);
      g.fillStyle = rng.pick(['rgba(190,170,110,0.7)', 'rgba(170,150,150,0.55)', 'rgba(200,190,160,0.6)', 'rgba(150,110,80,0.6)']);
      for (let k = 0; k < 3; k++) g.fillRect(x + rng.range(-3, 3), y + rng.range(-3, 3), 1.6, 1.6);
    }
  }

  function makeTile(name, seed) {
    const pal = PAL[name];
    const c = U.makeCanvas(TILE, TILE);
    const g = c.getContext('2d', { willReadFrequently: name === 'drymud' });
    baseLayer(g, pal, seed, TILE);
    const rng = new U.RNG(seed * 7 + 1);
    if (DETAIL[name]) DETAIL[name](g, TILE, rng);
    return c;
  }

  // ---------- Pisos interiores (128 px) ----------
  function floorTile(kind, seed) {
    const S = 128;
    const c = U.makeCanvas(S, S), g = c.getContext('2d');
    const rng = new U.RNG(seed);
    const speck = (n, a1, a2) => { for (let i = 0; i < n; i++) { g.fillStyle = rng.chance(0.5) ? `rgba(0,0,0,${a1})` : `rgba(255,255,255,${a2})`; g.fillRect(rng.range(0, S), rng.range(0, S), 1, 1); } };
    switch (kind) {
      case 'wood': case 'woodDark': {
        const base = kind === 'wood' ? [108, 80, 54] : [70, 52, 38];
        const PH = 12;
        for (let y = 0; y < S; y += PH) {
          let x = -rng.range(0, 60);
          const row = [];
          while (x < S) { const L = rng.range(44, 96); row.push([x, L, rng.range(0.8, 1.12)]); x += L; }
          // tabla que cruza el borde derecho: repetirla a la izquierda
          const last = row[row.length - 1];
          const all = row.concat([[last[0] - S, last[1], last[2]], [row[0][0] + S, row[0][1], row[0][2]]]);
          for (const [px, L, f] of all) {
            g.fillStyle = U.rgb(base[0] * f, base[1] * f, base[2] * f);
            g.fillRect(px, y, L, PH);
            // veta
            g.strokeStyle = 'rgba(30,18,8,0.18)'; g.lineWidth = 0.7;
            const gr = new U.RNG(((px * 13 + y * 7) | 0) + seed);
            for (let k = 0; k < 3; k++) {
              const yy = y + gr.range(2, PH - 2);
              g.beginPath(); g.moveTo(px, yy);
              for (let xx = px; xx < px + L; xx += 8) g.lineTo(xx, yy + Math.sin(xx * 0.15 + k) * 0.8);
              g.stroke();
            }
            if (gr.chance(0.15)) { g.fillStyle = 'rgba(30,18,8,0.3)'; g.beginPath(); g.ellipse(px + gr.range(8, L - 8), y + PH / 2, 2.5, 1.5, 0, 0, TAU); g.fill(); }
            g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(px, y, 1, PH);
            g.fillStyle = 'rgba(255,230,200,0.06)'; g.fillRect(px + 1, y, L - 1, 1);
          }
          g.fillStyle = 'rgba(0,0,0,0.38)'; g.fillRect(0, y + PH - 1, S, 1);
        }
        // desgaste en zonas de paso
        for (let i = 0; i < 3; i++) { const x = rng.range(0, S), y = rng.range(0, S), r = rng.range(20, 40); const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(0,0,0,0.12)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
        break;
      }
      case 'tile': case 'tileCheck': case 'stone': {
        const T = kind === 'stone' ? 32 : 16;
        for (let y = 0; y < S; y += T) for (let x = 0; x < S; x += T) {
          let col;
          if (kind === 'tileCheck') { const dark = ((x / T + y / T) % 2) === 1; const v = rng.range(-6, 6); col = dark ? [70 + v, 72 + v, 70 + v] : [156 + v, 152 + v, 140 + v]; }
          else if (kind === 'stone') { const v = 116 + rng.range(-12, 10); col = [v, v * 0.95, v * 0.86]; }
          else { const v = 140 + rng.range(-9, 8); col = [v * 0.97, v, v * 0.98]; }
          g.fillStyle = U.rgb(col[0], col[1], col[2]); g.fillRect(x, y, T, T);
          // brillo arriba-izquierda, sombra abajo-derecha
          g.fillStyle = 'rgba(255,255,255,0.10)'; g.fillRect(x + 1, y + 1, T - 2, 1); g.fillRect(x + 1, y + 1, 1, T - 2);
          g.fillStyle = 'rgba(0,0,0,0.10)'; g.fillRect(x + 1, y + T - 2, T - 2, 1); g.fillRect(x + T - 2, y + 1, 1, T - 2);
          if (kind === 'stone' && rng.chance(0.5)) { g.strokeStyle = 'rgba(80,72,64,0.25)'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(x + rng.range(0, T), y); g.quadraticCurveTo(x + rng.range(0, T), y + T / 2, x + rng.range(0, T), y + T); g.stroke(); }
          if (rng.chance(0.03)) { g.strokeStyle = 'rgba(30,30,28,0.5)'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(x + 2, y + rng.range(2, T - 2)); g.lineTo(x + T / 2, y + T / 2); g.lineTo(x + rng.range(2, T - 2), y + T - 2); g.stroke(); }
        }
        g.fillStyle = 'rgba(40,38,34,0.55)';
        for (let i = 0; i < S; i += T) { g.fillRect(i, 0, 1, S); g.fillRect(0, i, S, 1); }
        // mugre
        for (let i = 0; i < 4; i++) { const x = rng.range(10, S - 10), y = rng.range(10, S - 10), r = rng.range(10, 26); const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(40,34,24,0.14)'); gr.addColorStop(1, 'rgba(40,34,24,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
        speck(220, 0.08, 0.05);
        break;
      }
      case 'lino': {
        g.fillStyle = '#7a8176'; g.fillRect(0, 0, S, S);
        speck(900, 0.1, 0.08);
        for (let i = 0; i < 260; i++) { g.fillStyle = rng.pick(['rgba(60,70,60,0.25)', 'rgba(150,150,140,0.2)']); g.fillRect(rng.range(0, S), rng.range(0, S), 2, 1); }
        // marcas de arrastre
        g.strokeStyle = 'rgba(30,30,28,0.12)'; g.lineWidth = 1;
        for (let i = 0; i < 6; i++) { const x = rng.range(10, S - 10), y = rng.range(10, S - 10); g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + rng.range(-20, 20), y + rng.range(-10, 10), x + rng.range(-30, 30), y + rng.range(-12, 12)); g.stroke(); }
        g.fillStyle = 'rgba(0,0,0,0.14)'; g.fillRect(0, 0, S, 1); g.fillRect(0, S / 2, S, 1);
        break;
      }
      case 'concreteF': {
        g.fillStyle = '#5e5d59'; g.fillRect(0, 0, S, S);
        for (let i = 0; i < 5; i++) { const x = rng.range(0, S), y = rng.range(0, S), r = rng.range(14, 34); const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, rng.chance(0.5) ? 'rgba(0,0,0,0.14)' : 'rgba(255,255,255,0.05)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
        for (let i = 0; i < 500; i++) { g.fillStyle = rng.chance(0.5) ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.05)'; const r = rng.range(0.8, 2.5); g.fillRect(rng.range(0, S), rng.range(0, S), r, r); }
        g.strokeStyle = 'rgba(20,20,18,0.35)'; g.lineWidth = 0.8;
        for (let i = 0; i < 2; i++) { let x = rng.range(20, S - 20), y = rng.range(20, S - 20); g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 4; k++) { x += rng.range(-10, 10); y += rng.range(-10, 10); g.lineTo(x, y); } g.stroke(); }
        g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, 0, S, 1); g.fillRect(0, 0, 1, S);
        break;
      }
      case 'carpet': {
        const col = [64, 52, 46];
        g.fillStyle = U.rgb(col[0], col[1], col[2]); g.fillRect(0, 0, S, S);
        // trama
        for (let y = 0; y < S; y += 2) { g.fillStyle = y % 4 ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.03)'; g.fillRect(0, y, S, 1); }
        speck(1400, 0.12, 0.05);
        // dibujo geométrico apagado
        g.strokeStyle = 'rgba(120,96,70,0.18)'; g.lineWidth = 2;
        for (let y = 16; y < S; y += 32) for (let x = 16; x < S; x += 32) { g.beginPath(); g.moveTo(x, y - 8); g.lineTo(x + 8, y); g.lineTo(x, y + 8); g.lineTo(x - 8, y); g.closePath(); g.stroke(); }
        for (let i = 0; i < 3; i++) { const x = rng.range(16, S - 16), y = rng.range(16, S - 16), r = rng.range(8, 18); const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(20,14,10,0.3)'); gr.addColorStop(1, 'rgba(20,14,10,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
        break;
      }
      case 'metal': {
        g.fillStyle = '#4a4d4e'; g.fillRect(0, 0, S, S);
        for (let y = 0; y < S; y += 8) for (let x = (y / 8 % 2) * 4; x < S; x += 8) {
          g.save(); g.translate(x + 2, y + 2); g.rotate(y / 8 % 2 ? 0.6 : -0.6);
          g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(-2.5, -0.8, 5, 1.2);
          g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(-2.5, 0.4, 5, 0.8);
          g.restore();
        }
        for (let i = 0; i < 4; i++) { const x = rng.range(10, S - 10), y = rng.range(10, S - 10), r = rng.range(8, 20); const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(110,60,30,0.25)'); gr.addColorStop(1, 'rgba(110,60,30,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
        g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, 0, S, 1); g.fillRect(0, 0, 1, S);
        break;
      }
      case 'dirtF': {
        g.fillStyle = '#4d4030'; g.fillRect(0, 0, S, S);
        for (let i = 0; i < 400; i++) { g.fillStyle = rng.pick(['rgba(0,0,0,0.15)', 'rgba(150,120,60,0.15)']); g.fillRect(rng.int(0, S), rng.int(0, S), rng.range(1, 4), 1); }
        g.strokeStyle = 'rgba(160,140,80,0.35)'; g.lineWidth = 1;
        for (let i = 0; i < 30; i++) { const x = rng.range(4, S - 4), y = rng.range(4, S - 4), a = rng.range(0, TAU); g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * 6, y + Math.sin(a) * 6); g.stroke(); }
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
