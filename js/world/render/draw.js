// Dibujo del mundo: carreteras, zonas, decorado, accesorios, interiores, techos y puertas. TM.WG.Draw
(function () {
  const U = TM.U;
  const WG = TM.WG = TM.WG || {};
  const M = 32;
  const TAU = Math.PI * 2;

  function blob(ctx, x, y, r, rng, n, jit) {
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const rr = r * (1 - jit + rng.next() * jit * 2);
      const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }
  function rrect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
  }

  const D = { blob };
  let pats = null;
  D.pattern = function (ctx, name) {
    // los patrones se crean por contexto (cada chunk tiene el suyo): caché por contexto
    let c = ctx._pats;
    if (!c) c = ctx._pats = {};
    let p = c[name];
    if (!p) {
      const T = WG.Tex;
      const src = T.tiles[name] || T.floors[name] || T.tiles.urban;
      p = c[name] = ctx.createPattern(src, 'repeat');
    }
    return p;
  };
  void pats;

  // ---------- carreteras ----------
  // Añade al trazado los tramos de la carretera que tocan el rectángulo
  function roadPath(ctx, r, x0, y0, x1, y1) {
    const p = r.pts, pad = r.w / 2 + (r.side || 0) + 8;
    let open = false, any = false;
    for (let i = 0; i < p.length - 2; i += 2) {
      const ax = p[i], ay = p[i + 1], bx = p[i + 2], by = p[i + 3];
      const hit = !(Math.max(ax, bx) < x0 - pad || Math.min(ax, bx) > x1 + pad || Math.max(ay, by) < y0 - pad || Math.min(ay, by) > y1 + pad);
      if (hit) {
        if (!open) { ctx.moveTo(ax, ay); open = true; }
        ctx.lineTo(bx, by);
        any = true;
      } else open = false;
    }
    return any;
  }
  D.roads = function (ctx, roads, x0, y0, x1, y1, rng) {
    if (!roads.length) return;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    const stroke = (r, w, style, dash) => {
      ctx.beginPath();
      if (!roadPath(ctx, r, x0, y0, x1, y1)) return;
      ctx.lineWidth = w; ctx.strokeStyle = style;
      if (dash) ctx.setLineDash(dash);
      ctx.stroke();
      if (dash) ctx.setLineDash([]);
    };
    // aceras y bordillos
    for (const r of roads) if (r.side > 0) stroke(r, r.w + r.side * 2, D.pattern(ctx, 'concrete'));
    for (const r of roads) if (r.side > 0) stroke(r, r.w + 8, 'rgba(20,20,18,0.55)');
    // arcén de tierra en carreteras rurales
    for (const r of roads) if (!r.side && r.kind !== 'dirt' && r.kind !== 'lane') stroke(r, r.w + 26, 'rgba(60,52,40,0.35)');
    // calzada
    for (const r of roads) stroke(r, r.w, D.pattern(ctx, r.kind === 'dirt' ? 'dirtroad' : 'asphalt'));
    // marcas viales gastadas
    for (const r of roads) {
      if (r.kind === 'highway') {
        stroke(r, r.w - 18, 'rgba(200,196,180,0.22)');
        stroke(r, r.w - 24, D.pattern(ctx, 'asphalt'));
        stroke(r, 4, 'rgba(190,160,70,0.45)', [56, 44]);
      } else if (r.kind === 'road' || r.kind === 'avenue') {
        stroke(r, 4, 'rgba(210,205,190,0.3)', [44, 52]);
      } else if (r.kind === 'dirt') {
        // rodadas
        stroke(r, r.w * 0.55, 'rgba(40,30,20,0.18)');
        stroke(r, r.w * 0.3, D.pattern(ctx, 'dirtroad'));
      }
    }
    ctx.lineCap = 'butt';
    // grietas y baches
    void rng;
  };

  // ---------- zonas de suelo ----------
  D.area = function (ctx, a, rng) {
    const pat = (n) => D.pattern(ctx, n);
    const fillShape = (style) => {
      ctx.fillStyle = style;
      if (a.circle) { ctx.beginPath(); ctx.arc(a.cx, a.cy, a.r, 0, TAU); ctx.fill(); }
      else ctx.fillRect(a.x, a.y, a.w, a.h);
    };
    switch (a.mat) {
      case 'concrete': fillShape(pat('concrete')); break;
      case 'parking': case 'asphalt': fillShape(pat('asphalt')); break;
      case 'lawn': fillShape(pat('lawn')); break;
      case 'gravel': fillShape(pat('gravel')); break;
      case 'dirtroad': fillShape(pat('dirtroad')); break;
      case 'urban': fillShape(pat('urban')); break;
      case 'plaza': fillShape(pat('stone')); ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 3; ctx.strokeRect(a.x, a.y, a.w, a.h); break;
      case 'camp': {
        const g = ctx.createRadialGradient(a.cx, a.cy, 0, a.cx, a.cy, a.r);
        g.addColorStop(0, 'rgba(62,50,34,0.95)'); g.addColorStop(0.7, 'rgba(62,50,34,0.6)'); g.addColorStop(1, 'rgba(62,50,34,0)');
        ctx.fillStyle = g; ctx.fillRect(a.cx - a.r, a.cy - a.r, a.r * 2, a.r * 2);
        break;
      }
      case 'ash': {
        // mancha quemada irregular con bordes difusos
        const r2 = new U.RNG(((a.cx * 7) ^ (a.cy * 13)) | 0);
        ctx.save();
        ctx.fillStyle = pat('ash');
        ctx.globalAlpha = 0.35; blob(ctx, a.cx, a.cy, a.r * 1.15, r2, 14, 0.3); ctx.fill();
        ctx.globalAlpha = 0.6; blob(ctx, a.cx, a.cy, a.r * 0.85, r2, 12, 0.35); ctx.fill();
        ctx.globalAlpha = 0.85; blob(ctx, a.cx, a.cy, a.r * 0.55, r2, 10, 0.4); ctx.fill();
        ctx.restore();
        break;
      }
      case 'field': {
        ctx.save();
        ctx.beginPath(); ctx.rect(a.x, a.y, a.w, a.h); ctx.clip();
        if (a.rot) { ctx.translate(a.x + a.w / 2, a.y + a.h / 2); ctx.rotate(Math.PI / 2); ctx.translate(-(a.x + a.w / 2), -(a.y + a.h / 2)); }
        ctx.fillStyle = pat('field');
        const big = Math.max(a.w, a.h);
        ctx.fillRect(a.x + a.w / 2 - big, a.y + a.h / 2 - big, big * 2, big * 2);
        ctx.restore();
        if (a.dead) { ctx.fillStyle = 'rgba(60,50,36,0.35)'; ctx.fillRect(a.x, a.y, a.w, a.h); }
        break;
      }
      case 'court': {
        ctx.fillStyle = '#4a5048'; ctx.fillRect(a.x, a.y, a.w, a.h);
        ctx.strokeStyle = 'rgba(220,215,200,0.4)'; ctx.lineWidth = 3;
        ctx.strokeRect(a.x + 16, a.y + 16, a.w - 32, a.h - 32);
        ctx.beginPath();
        if (a.w > a.h) { ctx.moveTo(a.x + a.w / 2, a.y + 16); ctx.lineTo(a.x + a.w / 2, a.y + a.h - 16); }
        else { ctx.moveTo(a.x + 16, a.y + a.h / 2); ctx.lineTo(a.x + a.w - 16, a.y + a.h / 2); }
        ctx.stroke();
        ctx.beginPath(); ctx.arc(a.x + a.w / 2, a.y + a.h / 2, Math.min(a.w, a.h) * 0.15, 0, TAU); ctx.stroke();
        break;
      }
      case 'pitch': {
        ctx.fillStyle = pat('lawn'); ctx.fillRect(a.x, a.y, a.w, a.h);
        ctx.fillStyle = 'rgba(80,90,50,0.25)'; ctx.fillRect(a.x, a.y, a.w, a.h);
        ctx.strokeStyle = 'rgba(220,220,200,0.35)'; ctx.lineWidth = 4;
        ctx.strokeRect(a.x + 10, a.y + 10, a.w - 20, a.h - 20);
        ctx.beginPath();
        if (a.vert) { ctx.moveTo(a.x + 10, a.y + a.h / 2); ctx.lineTo(a.x + a.w - 10, a.y + a.h / 2); }
        else { ctx.moveTo(a.x + a.w / 2, a.y + 10); ctx.lineTo(a.x + a.w / 2, a.y + a.h - 10); }
        ctx.stroke();
        ctx.beginPath(); ctx.arc(a.x + a.w / 2, a.y + a.h / 2, Math.min(a.w, a.h) * 0.16, 0, TAU); ctx.stroke();
        break;
      }
      case 'runway': {
        ctx.fillStyle = pat('asphalt'); ctx.fillRect(a.x, a.y, a.w, a.h);
        ctx.fillStyle = 'rgba(210,205,190,0.4)';
        if (a.horiz) { for (let x = a.x + 60; x < a.x + a.w - 60; x += 140) ctx.fillRect(x, a.y + a.h / 2 - 4, 70, 8); ctx.fillRect(a.x, a.y + 14, a.w, 4); ctx.fillRect(a.x, a.y + a.h - 18, a.w, 4); }
        else { for (let y = a.y + 60; y < a.y + a.h - 60; y += 140) ctx.fillRect(a.x + a.w / 2 - 4, y, 8, 70); ctx.fillRect(a.x + 14, a.y, 4, a.h); ctx.fillRect(a.x + a.w - 18, a.y, 4, a.h); }
        break;
      }
      default: fillShape(pat('urban'));
    }
    void rng;
  };

  // ---------- decorado plano ----------
  D.decor = function (ctx, d) {
    const rng = new U.RNG(d.seed || 1);
    const s = d.s || 1;
    switch (d.kind) {
      case 'rubble':
        for (let i = 0; i < 7; i++) {
          ctx.fillStyle = rng.pick(['#4a4744', '#3a3836', '#55514c', '#2e2c2a', '#5e5850']);
          blob(ctx, d.x + rng.range(-14, 14) * s, d.y + rng.range(-14, 14) * s, rng.range(3, 8) * s, rng, 5, 0.4); ctx.fill();
        }
        break;
      case 'trash':
        for (let i = 0; i < 5; i++) {
          ctx.fillStyle = rng.pick(['#4b4a3a', '#3d3a36', '#5a4636', '#2f3a3d', '#6b6656', '#2a2a2a']);
          ctx.save(); ctx.translate(d.x + rng.range(-12, 12) * s, d.y + rng.range(-12, 12) * s); ctx.rotate(rng.range(0, 6.28));
          ctx.fillRect(-4 * s, -3 * s, rng.range(5, 10) * s, rng.range(4, 7) * s);
          ctx.restore();
        }
        break;
      case 'paper':
        for (let i = 0; i < 3; i++) {
          ctx.fillStyle = 'rgba(160,155,140,0.4)';
          ctx.save(); ctx.translate(d.x + rng.range(-10, 10), d.y + rng.range(-10, 10)); ctx.rotate(rng.range(0, 6.28)); ctx.fillRect(-5, -4, 10, 8); ctx.restore();
        }
        break;
      case 'stain': {
        const R = 26 * s;
        const g = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, R);
        g.addColorStop(0, 'rgba(12,10,8,0.38)'); g.addColorStop(1, 'rgba(12,10,8,0)');
        ctx.fillStyle = g; ctx.fillRect(d.x - R, d.y - R, R * 2, R * 2);
        break;
      }
      case 'puddle':
        ctx.fillStyle = 'rgba(20,26,30,0.55)';
        blob(ctx, d.x, d.y, 18 * s, rng, 10, 0.25); ctx.fill();
        ctx.strokeStyle = 'rgba(120,130,140,0.12)'; ctx.lineWidth = 1.5; ctx.stroke();
        break;
      case 'shrub':
        for (let i = 0; i < 5; i++) {
          ctx.fillStyle = rng.pick(['#2e3226', '#363a2a', '#2a2a20', '#3a3626']);
          blob(ctx, d.x + rng.range(-10, 10) * s, d.y + rng.range(-10, 10) * s, rng.range(7, 13) * s, rng, 7, 0.35); ctx.fill();
        }
        break;
      case 'leaves':
        for (let i = 0; i < 10; i++) {
          ctx.fillStyle = rng.pick(['#4a3a24', '#3c2e1e', '#5a4a2c', '#2e2a1e']);
          ctx.fillRect(d.x + rng.range(-20, 20), d.y + rng.range(-20, 20), 4, 3);
        }
        break;
      case 'grass': case 'reeds': {
        ctx.strokeStyle = d.kind === 'reeds' ? rng.pick(['#4a5036', '#3e4430', '#565a3a']) : rng.pick(['#4a4a32', '#55513a', '#3d3f2c']);
        ctx.lineWidth = d.kind === 'reeds' ? 1.6 : 1.2;
        ctx.beginPath();
        const n = d.kind === 'reeds' ? 12 : 8, L = d.kind === 'reeds' ? 16 : 9;
        for (let i = 0; i < n; i++) {
          const a = rng.range(-2.6, -0.5), ox = rng.range(-6, 6) * s;
          ctx.moveTo(d.x + ox, d.y); ctx.lineTo(d.x + ox + Math.cos(a) * L * s, d.y + Math.sin(a) * L * s);
        }
        ctx.stroke();
        break;
      }
      case 'deadshrub':
        ctx.strokeStyle = '#3a2e22'; ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const a = rng.range(0, 6.28), L = rng.range(7, 16) * s;
          ctx.moveTo(d.x, d.y); ctx.lineTo(d.x + Math.cos(a) * L, d.y + Math.sin(a) * L);
        }
        ctx.stroke();
        break;
      case 'crack': {
        ctx.strokeStyle = 'rgba(20,16,12,0.5)'; ctx.lineWidth = 1.2;
        ctx.beginPath();
        let x = d.x, y = d.y;
        ctx.moveTo(x, y);
        for (let k = 0; k < 7; k++) {
          x += rng.range(-14, 14) * s; y += rng.range(-14, 14) * s; ctx.lineTo(x, y);
          if (rng.chance(0.3)) { ctx.moveTo(x, y); ctx.lineTo(x + rng.range(-10, 10), y + rng.range(-10, 10)); ctx.moveTo(x, y); }
        }
        ctx.stroke();
        break;
      }
      case 'pebbles':
        for (let i = 0; i < 6; i++) { ctx.fillStyle = rng.pick(['#6a5e4c', '#5a5040', '#7a6e5a']); ctx.beginPath(); ctx.arc(d.x + rng.range(-12, 12), d.y + rng.range(-12, 12), rng.range(2, 5), 0, TAU); ctx.fill(); }
        break;
      case 'ash':
        ctx.fillStyle = 'rgba(10,10,10,0.35)'; blob(ctx, d.x, d.y, 22 * s, rng, 9, 0.3); ctx.fill();
        break;
      case 'bones':
        ctx.save(); ctx.translate(d.x, d.y); ctx.rotate(d.rot);
        ctx.fillStyle = '#b8b0a0';
        ctx.beginPath(); ctx.ellipse(0, 0, 6, 5, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#2a2622'; ctx.fillRect(-3, -1.5, 2, 2); ctx.fillRect(1, -1.5, 2, 2);
        ctx.fillStyle = '#a69e8e';
        for (let i = 0; i < 4; i++) ctx.fillRect(rng.range(7, 22), rng.range(-8, 8), rng.range(8, 14), 2);
        ctx.restore();
        break;
      case 'body': case 'bodybag': {
        ctx.save(); ctx.translate(d.x, d.y); ctx.rotate(d.rot);
        if (d.kind === 'bodybag') {
          ctx.fillStyle = '#1e2420'; rrect(ctx, -26, -9, 52, 18, 8); ctx.fill();
          ctx.strokeStyle = 'rgba(160,160,150,0.4)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-20, 0); ctx.lineTo(20, 0); ctx.stroke();
        } else {
          ctx.fillStyle = 'rgba(70,10,8,0.6)'; blob(ctx, 2, 4, 20, rng, 9, 0.35); ctx.fill();
          ctx.fillStyle = rng.pick(['#3a3a40', '#4a3c30', '#2e3a30', '#50463a']);
          rrect(ctx, -16, -8, 28, 16, 6); ctx.fill();
          ctx.fillRect(-26, -7, 12, 5); ctx.fillRect(-26, 2, 12, 5);
          ctx.fillRect(10, -12, 10, 4); ctx.fillRect(10, 8, 10, 4);
          ctx.fillStyle = rng.pick(['#7a6a5a', '#5e5048', '#8a7a68']);
          ctx.beginPath(); ctx.arc(17, 0, 6, 0, TAU); ctx.fill();
        }
        ctx.restore();
        break;
      }
      case 'bloodtrail': {
        ctx.fillStyle = 'rgba(80,10,8,0.55)';
        let x = d.x, y = d.y, a = d.rot;
        for (let i = 0; i < 14; i++) {
          a += rng.range(-0.3, 0.3);
          x += Math.cos(a) * 14; y += Math.sin(a) * 14;
          ctx.beginPath(); ctx.ellipse(x, y, rng.range(3, 6), rng.range(2, 4), a, 0, TAU); ctx.fill();
        }
        break;
      }
      case 'casings':
        ctx.fillStyle = 'rgba(190,150,70,0.8)';
        for (let i = 0; i < 9; i++) { ctx.save(); ctx.translate(d.x + rng.range(-16, 16), d.y + rng.range(-16, 16)); ctx.rotate(rng.range(0, 6.28)); ctx.fillRect(-2, -0.8, 4, 1.6); ctx.restore(); }
        break;
      case 'text': {
        ctx.save(); ctx.translate(d.x, d.y); ctx.rotate(d.rot || 0);
        ctx.font = `bold ${d.size || 16}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = d.color || 'rgba(200,40,30,0.8)';
        ctx.fillText(d.text || '', 0, 0);
        ctx.restore();
        break;
      }
      case 'note':
        ctx.fillStyle = 'rgba(200,195,170,0.85)';
        ctx.save(); ctx.translate(d.x, d.y); ctx.rotate(d.rot); ctx.fillRect(-6, -8, 12, 16);
        ctx.fillStyle = 'rgba(40,40,40,0.6)'; for (let i = 0; i < 4; i++) ctx.fillRect(-4, -5 + i * 3.5, 8, 1);
        ctx.restore();
        break;
      case 'cans':
        for (let i = 0; i < 5; i++) { ctx.fillStyle = rng.pick(['#8a8a80', '#6a6a60', '#9a7a50']); ctx.beginPath(); ctx.arc(d.x + rng.range(-10, 10), d.y + rng.range(-10, 10), 3, 0, TAU); ctx.fill(); }
        break;
      case 'glass':
        ctx.fillStyle = 'rgba(170,190,200,0.4)';
        for (let i = 0; i < 12; i++) ctx.fillRect(d.x + rng.range(-16, 16), d.y + rng.range(-16, 16), 2, 2);
        break;
      case 'pills':
        for (let i = 0; i < 6; i++) { ctx.fillStyle = rng.pick(['#c8c0b0', '#d0a050', '#a0b8c8', '#e0e0d8']); ctx.fillRect(d.x + rng.range(-10, 10), d.y + rng.range(-10, 10), 3, 2); }
        break;
      case 'hay':
        ctx.strokeStyle = 'rgba(160,140,80,0.45)'; ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i < 14; i++) { const x = d.x + rng.range(-24, 24), y = d.y + rng.range(-24, 24), a = rng.range(0, 6.28); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * 8, y + Math.sin(a) * 8); }
        ctx.stroke();
        break;
      case 'candle':
        ctx.fillStyle = '#c8c0a8'; ctx.fillRect(d.x - 1.5, d.y - 1.5, 3, 3);
        ctx.fillStyle = 'rgba(30,20,10,0.4)'; ctx.beginPath(); ctx.arc(d.x, d.y, 5, 0, TAU); ctx.fill();
        break;
      case 'tiretrack':
        ctx.save(); ctx.translate(d.x, d.y); ctx.rotate(d.rot);
        ctx.fillStyle = 'rgba(15,12,10,0.3)'; ctx.fillRect(-60 * s, -26, 120 * s, 8); ctx.fillRect(-60 * s, 18, 120 * s, 8);
        ctx.restore();
        break;
      case 'manhole':
        ctx.fillStyle = '#26262a'; ctx.beginPath(); ctx.arc(d.x, d.y, 12, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(120,120,120,0.35)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(d.x, d.y, 9, 0, TAU); ctx.stroke();
        break;
      case 'pline':
        ctx.save(); ctx.translate(d.x, d.y); ctx.rotate(d.rot);
        ctx.fillStyle = 'rgba(210,205,190,0.32)'; ctx.fillRect(0, 0, 3, d.len || 160); ctx.restore();
        break;
      case 'lamp':
        ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.arc(d.x + 3, d.y + 4, 6, 0, TAU); ctx.fill();
        ctx.fillStyle = '#3a3c3e'; ctx.beginPath(); ctx.arc(d.x, d.y, 5, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#4a4c4e'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(d.x + Math.cos(d.rot + 1.57) * 26, d.y + Math.sin(d.rot + 1.57) * 26); ctx.stroke();
        break;
      case 'roadsign': {
        ctx.save(); ctx.translate(d.x, d.y);
        ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(-36, -8, 76, 20);
        ctx.fillStyle = '#2e4a36'; ctx.fillRect(-38, -12, 76, 20);
        ctx.fillStyle = 'rgba(230,230,220,0.85)'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(d.text || '', 0, -2);
        ctx.restore();
        break;
      }
      case 'suitcase':
        ctx.save(); ctx.translate(d.x, d.y); ctx.rotate(d.rot);
        ctx.fillStyle = rng.pick(['#4a2e24', '#2e3440', '#5a4a30']); rrect(ctx, -12, -8, 24, 16, 3); ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(-3, -10, 6, 3);
        for (let i = 0; i < 4; i++) { ctx.fillStyle = rng.pick(['#8a8070', '#6a7080', '#9a6a5a']); ctx.fillRect(rng.range(-26, 20), rng.range(-20, 16), 7, 5); }
        ctx.restore();
        break;
      case 'debris':
        for (let i = 0; i < 6; i++) {
          ctx.fillStyle = rng.pick(['#5a5c5e', '#3a3c3e', '#6a6460', '#2a2826']);
          ctx.save(); ctx.translate(d.x + rng.range(-24, 24) * s, d.y + rng.range(-24, 24) * s); ctx.rotate(rng.range(0, 6.28));
          ctx.fillRect(-rng.range(4, 14), -2, rng.range(8, 28), rng.range(3, 6)); ctx.restore();
        }
        break;
      case 'crater': {
        const R = 40 * s;
        const g = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, R);
        g.addColorStop(0, 'rgba(8,8,8,0.85)'); g.addColorStop(0.6, 'rgba(20,18,16,0.6)'); g.addColorStop(1, 'rgba(20,18,16,0)');
        ctx.fillStyle = g; ctx.fillRect(d.x - R, d.y - R, R * 2, R * 2);
        break;
      }
      case 'cart':
        ctx.save(); ctx.translate(d.x, d.y); ctx.rotate(d.rot);
        ctx.strokeStyle = '#7a7c7e'; ctx.lineWidth = 2; ctx.strokeRect(-12, -9, 24, 18);
        ctx.beginPath(); for (let i = -8; i < 12; i += 5) { ctx.moveTo(i, -9); ctx.lineTo(i, 9); } ctx.stroke();
        ctx.restore();
        break;
      case 'helipad':
        ctx.strokeStyle = 'rgba(220,210,180,0.5)'; ctx.lineWidth = 8;
        ctx.beginPath(); ctx.arc(d.x, d.y, 280, 0, TAU); ctx.stroke();
        ctx.fillStyle = 'rgba(220,210,180,0.5)';
        ctx.fillRect(d.x - 90, d.y - 120, 30, 240); ctx.fillRect(d.x + 60, d.y - 120, 30, 240); ctx.fillRect(d.x - 60, d.y - 15, 120, 30);
        break;
      case 'massgrave':
        ctx.save(); ctx.translate(d.x, d.y); ctx.rotate(d.rot);
        ctx.fillStyle = '#3a2e22'; ctx.fillRect(-160 * s, -60 * s, 320 * s, 120 * s);
        ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(-150 * s, -50 * s, 300 * s, 100 * s);
        ctx.restore();
        for (let i = 0; i < 6; i++) D.decor(ctx, { kind: 'bodybag', x: d.x + rng.range(-120, 120) * s, y: d.y + rng.range(-40, 40) * s, rot: d.rot + rng.range(-0.3, 0.3), seed: rng.int(1, 1e9) });
        break;
      case 'firepit':
        ctx.fillStyle = '#1a1410'; ctx.beginPath(); ctx.arc(d.x, d.y, 16, 0, TAU); ctx.fill();
        for (let i = 0; i < 9; i++) { const a = (i / 9) * TAU; ctx.fillStyle = rng.pick(['#5a5650', '#4a4640']); ctx.beginPath(); ctx.arc(d.x + Math.cos(a) * 18, d.y + Math.sin(a) * 18, 5, 0, TAU); ctx.fill(); }
        break;
      case 'logseat':
        ctx.save(); ctx.translate(d.x, d.y); ctx.rotate(d.rot);
        ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(-22, -4, 46, 15);
        ctx.fillStyle = '#4a3624'; ctx.fillRect(-24, -7, 46, 14);
        ctx.fillStyle = '#5e4630'; ctx.fillRect(-24, -7, 46, 4);
        ctx.fillStyle = '#6e5a40'; ctx.beginPath(); ctx.ellipse(22, 0, 4, 7, 0, 0, TAU); ctx.fill();
        ctx.restore();
        break;
    }
  };

  // ---------- autos y vehículos ----------
  D.vehicle = function (ctx, p, rng) {
    const L = p.L, W = p.W;
    ctx.save();
    ctx.translate(p.x, p.y); ctx.rotate(p.ang);
    const burned = p.burned;
    const body = burned ? '#1f1c1a' : p.color;
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; rrect(ctx, -L / 2 + 6, -W / 2 + 8, L, W, 8); ctx.fill();
    // ruedas
    ctx.fillStyle = '#121212';
    const wl = Math.min(26, L * 0.16);
    ctx.fillRect(-L / 2 + L * 0.12, -W / 2 - 3, wl, 6); ctx.fillRect(L / 2 - L * 0.12 - wl, -W / 2 - 3, wl, 6);
    ctx.fillRect(-L / 2 + L * 0.12, W / 2 - 3, wl, 6); ctx.fillRect(L / 2 - L * 0.12 - wl, W / 2 - 3, wl, 6);
    ctx.fillStyle = body;
    const k = p.kind;
    if (k === 'truck' || k === 'military' || k === 'bus' || k === 'van' || k === 'ambulance' || k === 'pickup') {
      rrect(ctx, -L / 2, -W / 2, L, W, 6); ctx.fill();
      if (k === 'truck' || k === 'military') {
        // cabina delante y carga detrás
        ctx.fillStyle = burned ? '#151311' : U.shade(p.color, 0.8);
        ctx.fillRect(L / 2 - L * 0.24, -W / 2 + 2, L * 0.24 - 2, W - 4);
        ctx.fillStyle = burned ? '#0c0b0a' : '#14181c';
        ctx.fillRect(L / 2 - L * 0.24 + 6, -W / 2 + 6, 12, W - 12);
        ctx.fillStyle = burned ? '#2a2420' : (k === 'military' ? '#4e5640' : U.shade(p.color, 1.15));
        ctx.fillRect(-L / 2 + 4, -W / 2 + 4, L * 0.72, W - 8);
        ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 2;
        ctx.beginPath(); for (let x = -L / 2 + 20; x < L * 0.2; x += 22) { ctx.moveTo(x, -W / 2 + 4); ctx.lineTo(x, W / 2 - 4); } ctx.stroke();
      } else if (k === 'bus') {
        ctx.fillStyle = burned ? '#0c0b0a' : '#1a1e22';
        for (let x = -L / 2 + 20; x < L / 2 - 40; x += 34) { ctx.fillRect(x, -W / 2 + 3, 24, 6); ctx.fillRect(x, W / 2 - 9, 24, 6); }
        ctx.fillStyle = burned ? '#2a2420' : U.shade(p.color, 1.12); ctx.fillRect(-L / 2 + 8, -W / 2 + 12, L - 30, W - 24);
      } else {
        ctx.fillStyle = burned ? '#0c0b0a' : '#14181c';
        ctx.fillRect(L / 2 - L * 0.3, -W / 2 + 4, 14, W - 8);
        ctx.fillStyle = burned ? '#2a2420' : U.shade(p.color, 1.1);
        ctx.fillRect(-L / 2 + 6, -W / 2 + 5, L * 0.62, W - 10);
        if (k === 'ambulance' && !burned) { ctx.fillStyle = '#a02a22'; ctx.fillRect(-L / 2 + 6, -3, L * 0.62, 6); ctx.fillRect(-L * 0.12 - 3, -W / 2 + 8, 6, W - 16); }
        if (k === 'pickup' && !burned) { ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(-L / 2 + 8, -W / 2 + 8, L * 0.4, W - 16); }
      }
    } else if (k === 'tractor') {
      ctx.fillStyle = '#121212'; ctx.fillRect(-L / 2, -W / 2 - 6, 34, W + 12); ctx.fillRect(L / 2 - 22, -W / 2 + 2, 18, W - 4);
      ctx.fillStyle = body; rrect(ctx, -L / 2 + 10, -W / 2 + 10, L - 14, W - 20, 4); ctx.fill();
      ctx.fillStyle = '#1a1a1a'; ctx.fillRect(-L / 2 + 14, -W / 2 + 14, 26, W - 28);
    } else if (k === 'boat') {
      ctx.beginPath(); ctx.moveTo(-L / 2, -W / 2); ctx.lineTo(L / 2 - 30, -W / 2); ctx.quadraticCurveTo(L / 2, 0, L / 2 - 30, W / 2); ctx.lineTo(-L / 2, W / 2); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(-L / 2 + 8, -W / 2 + 8, L * 0.6, W - 16);
    } else {
      // turismo / policía / todoterreno
      rrect(ctx, -L / 2, -W / 2, L, W, 10); ctx.fill();
      ctx.fillStyle = burned ? '#121110' : '#14181c';
      ctx.fillRect(-L * 0.2, -W / 2 + 5, L * 0.48, W - 10);
      ctx.fillStyle = burned ? '#2a2420' : U.shade(p.color, 1.14);
      ctx.fillRect(-L * 0.1, -W / 2 + 7, L * 0.28, W - 14);
      ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fillRect(L * 0.3, -W / 2 + 5, L * 0.15, W - 10);
      if (k === 'police' && !burned) { ctx.fillStyle = '#d8d8d0'; ctx.fillRect(-L / 2 + 4, -W / 2 + 2, L * 0.22, W - 4); ctx.fillStyle = '#2a4a8a'; ctx.fillRect(-L * 0.05, -W / 2 + 6, 6, 10); ctx.fillStyle = '#8a2a2a'; ctx.fillRect(-L * 0.05, W / 2 - 16, 6, 10); }
      if (k === 'humvee') { ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(-L / 2 + 6, -W / 2 + 6, L * 0.3, W - 12); }
    }
    // óxido, abolladuras
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = burned ? 'rgba(80,40,20,0.4)' : 'rgba(110,60,30,0.32)';
      ctx.beginPath(); ctx.arc(rng.range(-L / 2 + 6, L / 2 - 6), rng.range(-W / 2 + 4, W / 2 - 4), rng.range(2, 6), 0, TAU); ctx.fill();
    }
    if (p.doorOpen && !burned && (k === 'car' || k === 'police' || !k)) {
      ctx.fillStyle = U.shade(p.color, 0.85);
      ctx.save(); ctx.translate(-L * 0.05, W / 2); ctx.rotate(0.9); ctx.fillRect(0, -3, 34, 5); ctx.restore();
    }
    ctx.fillStyle = 'rgba(210,200,160,0.4)';
    ctx.fillRect(L / 2 - 4, -W / 2 + 5, 3, 7); ctx.fillRect(L / 2 - 4, W / 2 - 12, 3, 7);
    ctx.restore();
    // cristales rotos
    ctx.fillStyle = 'rgba(160,180,190,0.3)';
    for (let i = 0; i < 8; i++) ctx.fillRect(p.x + rng.range(-L * 0.6, L * 0.6), p.y + rng.range(-L * 0.6, L * 0.6), 2, 2);
  };

  // ---------- árboles y rocas ----------
  D.tree = function (ctx, o, rng) {
    const cx = o.x, cy = o.y, r = o.r, crown = o.crown;
    const wood = o.burned ? rng.pick(['#1e1a16', '#24201c']) : rng.pick(['#4a4036', '#52473b', '#443a31', '#5a4e42']);
    ctx.lineCap = 'round';
    ctx.strokeStyle = wood;
    const branch = (x, y, a, len, w, depth) => {
      const ex = x + Math.cos(a) * len, ey = y + Math.sin(a) * len;
      const mx = (x + ex) / 2 + Math.cos(a + 1.57) * len * rng.range(-0.15, 0.15);
      const my = (y + ey) / 2 + Math.sin(a + 1.57) * len * rng.range(-0.15, 0.15);
      ctx.lineWidth = w;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(mx, my, ex, ey); ctx.stroke();
      if (depth <= 0) return;
      const n = rng.chance(0.4) ? 3 : 2;
      for (let k = 0; k < n; k++) branch(ex, ey, a + rng.range(-0.75, 0.75), len * rng.range(0.5, 0.72), Math.max(1, w * 0.6), depth - 1);
    };
    const variant = o.seed % 6;
    if (variant === 3 && !o.burned) {
      // conífera muerta
      for (let layer = 0; layer < 3; layer++) {
        const R = crown * (0.85 - layer * 0.25), n = 10 + layer * 2;
        ctx.fillStyle = ['#2b3027', '#363a2e', '#424532'][layer];
        ctx.beginPath();
        for (let i = 0; i < n * 2; i++) {
          const a = (i / (n * 2)) * TAU + layer * 0.3;
          const rr = (i % 2 ? R * 0.55 : R) * rng.range(0.85, 1.1);
          const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr;
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath(); ctx.fill();
      }
      ctx.lineCap = 'butt';
      return;
    }
    if (variant === 4) {
      // tocón con el tronco caído
      const fa = rng.range(0, TAU), FL = crown * 1.0;
      ctx.lineWidth = r * 1.1;
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(fa) * r, cy + Math.sin(fa) * r); ctx.lineTo(cx + Math.cos(fa) * FL, cy + Math.sin(fa) * FL); ctx.stroke();
      branch(cx + Math.cos(fa) * FL, cy + Math.sin(fa) * FL, fa + 0.4, crown * 0.3, r * 0.4, 1);
      ctx.fillStyle = U.shade(o.burned ? '#2a2420' : wood, 1.15);
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.9, 0, TAU); ctx.fill();
      ctx.lineCap = 'butt';
      return;
    }
    const limbs = Math.max(4, (o.branches || 6) - (variant === 2 ? 0 : 1));
    const base = rng.range(0, TAU);
    for (let i = 0; i < limbs; i++) {
      const a = base + (i / limbs) * TAU + rng.range(-0.5, 0.5);
      branch(cx, cy, a, crown * rng.range(0.32, 0.46), r * 0.55, variant === 2 ? 3 : 2);
    }
    if ((variant === 1 || variant === 5) && !o.burned) {
      for (let i = 0; i < 8; i++) {
        const a = rng.range(0, TAU), d = rng.range(crown * 0.3, crown * 0.8);
        ctx.fillStyle = rng.pick(['rgba(58,60,40,0.55)', 'rgba(70,62,40,0.5)', 'rgba(48,50,36,0.6)', 'rgba(64,56,36,0.5)']);
        blob(ctx, cx + Math.cos(a) * d, cy + Math.sin(a) * d, rng.range(8, 18), rng, 7, 0.35); ctx.fill();
      }
    }
    ctx.fillStyle = U.shade(o.burned ? '#2a2420' : wood, 0.85);
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.85, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,235,200,0.07)';
    ctx.beginPath(); ctx.arc(cx - r * 0.25, cy - r * 0.25, r * 0.4, 0, TAU); ctx.fill();
    ctx.lineCap = 'butt';
  };
  D.rock = function (ctx, o, rng) {
    const base = o.desert ? rng.pick(['#6e5e48', '#7a6850', '#62564a']) : rng.pick(['#4e4a44', '#57524a', '#45423e', '#5c5448']);
    ctx.fillStyle = base;
    blob(ctx, o.x, o.y, o.r, rng, 9, 0.18); ctx.fill();
    ctx.fillStyle = 'rgba(255,245,225,0.09)';
    blob(ctx, o.x - o.r * 0.25, o.y - o.r * 0.3, o.r * 0.55, rng, 7, 0.25); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    blob(ctx, o.x + o.r * 0.3, o.y + o.r * 0.3, o.r * 0.5, rng, 7, 0.25); ctx.fill();
    if (o.r > 30) { ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(o.x - o.r * 0.5, o.y); ctx.lineTo(o.x + o.r * 0.2, o.y + o.r * 0.3); ctx.stroke(); }
  };

  // Sombra de un accesorio (antes de dibujarlo)
  D.propShadow = function (ctx, p) {
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    switch (p.kind) {
      case 'tree': {
        const sx = p.x + 18, sy = p.y + 22, R = p.crown * 1.0;
        const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, R);
        g.addColorStop(0, 'rgba(0,0,0,0.24)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.fillRect(sx - R, sy - R, R * 2, R * 2);
        return;
      }
      case 'rock': case 'silo': case 'watertower': case 'fueltank': case 'barrel': case 'haybale': case 'well':
        ctx.beginPath(); ctx.ellipse(p.x + p.r * 0.25 + 3, p.y + p.r * 0.3 + 4, p.r, p.r * 0.85, 0, 0, TAU); ctx.fill();
        return;
      case 'container': case 'tent': case 'watchtower': case 'bleacher': case 'dumpster': case 'kiosk':
        ctx.fillRect(p.x - p.w / 2 + 10, p.y - p.h / 2 + 14, p.w, p.h);
        return;
    }
  };

  // ---------- accesorios ----------
  D.prop = function (ctx, p) {
    const rng = new U.RNG(p.seed || 1);
    const x0 = p.x - (p.w || 0) / 2, y0 = p.y - (p.h || 0) / 2;
    switch (p.kind) {
      case 'tree': return D.tree(ctx, p, rng);
      case 'rock': return D.rock(ctx, p, rng);
      case 'car': case 'police': case 'ambulance': case 'military': case 'humvee': case 'truck': case 'bus': case 'van': case 'pickup': case 'tractor': case 'boat':
        return D.vehicle(ctx, p, rng);
      case 'log':
        ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(x0 + 4, y0 + 5, p.w, p.h);
        ctx.fillStyle = '#3e2e20'; rrect(ctx, x0, y0, p.w, p.h, 8); ctx.fill();
        ctx.fillStyle = '#4e3a28';
        if (p.horiz) ctx.fillRect(x0 + 4, y0 + 3, p.w - 8, p.h * 0.3); else ctx.fillRect(x0 + 3, y0 + 4, p.w * 0.3, p.h - 8);
        ctx.fillStyle = '#6e5a40'; ctx.beginPath();
        if (p.horiz) ctx.ellipse(x0 + p.w, p.y, 5, p.h / 2, 0, 0, TAU); else ctx.ellipse(p.x, y0 + p.h, p.w / 2, 5, 0, 0, TAU);
        ctx.fill();
        return;
      case 'barrel': {
        ctx.fillStyle = p.toxic ? '#4a5a2a' : p.water ? '#2a3a4a' : rng.pick(['#4a3020', '#3a4030', '#5a4a30']);
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 0.65, 0, TAU); ctx.stroke();
        if (p.toxic) { ctx.fillStyle = 'rgba(160,200,60,0.5)'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 0.3, 0, TAU); ctx.fill(); }
        return;
      }
      case 'dumpster':
        ctx.fillStyle = '#2f3d33'; ctx.fillRect(x0, y0, p.w, p.h);
        ctx.fillStyle = '#26322a'; ctx.fillRect(x0 + 2, y0 + 2, p.w / 2 - 3, p.h - 4); ctx.fillRect(x0 + p.w / 2 + 1, y0 + 2, p.w / 2 - 3, p.h - 4);
        ctx.fillStyle = 'rgba(120,70,30,0.4)'; ctx.fillRect(x0 + rng.range(0, p.w - 10), y0 + rng.range(0, p.h - 8), 10, 6);
        return;
      case 'crate':
        ctx.fillStyle = '#5a4630'; ctx.fillRect(x0, y0, p.w, p.h);
        ctx.strokeStyle = '#3a2c1c'; ctx.lineWidth = 2; ctx.strokeRect(x0 + 1, y0 + 1, p.w - 2, p.h - 2);
        ctx.beginPath(); ctx.moveTo(x0 + 2, y0 + 2); ctx.lineTo(x0 + p.w - 2, y0 + p.h - 2); ctx.stroke();
        return;
      case 'milcrate':
        ctx.fillStyle = '#434a34'; ctx.fillRect(x0, y0, p.w, p.h);
        ctx.fillStyle = '#2e3324'; ctx.fillRect(x0 + 2, y0 + p.h / 2 - 1, p.w - 4, 2);
        ctx.fillStyle = 'rgba(220,210,170,0.4)'; ctx.fillRect(x0 + 5, y0 + 4, 8, 3);
        return;
      case 'sandbag': {
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(x0 + 3, y0 + 4, p.w, p.h);
        ctx.fillStyle = '#5e5440';
        const n = Math.max(2, Math.round(Math.max(p.w, p.h) / 18));
        for (let i = 0; i < n; i++) {
          const t = (i + 0.5) / n;
          ctx.beginPath();
          if (p.horiz) ctx.ellipse(x0 + p.w * t, p.y, p.w / n / 2 + 1, p.h / 2 - 1, 0, 0, TAU);
          else ctx.ellipse(p.x, y0 + p.h * t, p.w / 2 - 1, p.h / n / 2 + 1, 0, 0, TAU);
          ctx.fill();
        }
        ctx.fillStyle = 'rgba(255,240,200,0.07)'; ctx.fillRect(x0, y0 + 2, p.w, 3);
        return;
      }
      case 'tent': {
        ctx.fillStyle = p.color; ctx.fillRect(x0, y0, p.w, p.h);
        ctx.fillStyle = U.shade(p.color, 0.7); ctx.fillRect(x0, p.y, p.w, p.h / 2);
        ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x0, p.y); ctx.lineTo(x0 + p.w, p.y); ctx.stroke();
        if (p.cross) { ctx.fillStyle = '#8a2a22'; ctx.fillRect(p.x - 4, p.y - 14, 8, 28); ctx.fillRect(p.x - 14, p.y - 4, 28, 8); }
        ctx.fillStyle = '#16140f'; ctx.beginPath();
        ctx.moveTo(x0 + p.w, p.y - 9); ctx.lineTo(x0 + p.w - 12, p.y); ctx.lineTo(x0 + p.w, p.y + 9); ctx.fill();
        return;
      }
      case 'firepit':
        for (let i = 0; i < 11; i++) {
          const a = (i / 11) * TAU;
          ctx.fillStyle = rng.pick(['#5a5650', '#4a4640', '#625c54']);
          ctx.beginPath(); ctx.arc(p.x + Math.cos(a) * p.r, p.y + Math.sin(a) * p.r, 5, 0, TAU); ctx.fill();
        }
        ctx.fillStyle = '#1a1410'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r - 4, 0, TAU); ctx.fill();
        return;
      case 'fence': {
        const st = p.style;
        if (st === 'concrete') { ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(x0 + 6, y0 + 8, p.w, p.h); ctx.fillStyle = '#6a6862'; ctx.fillRect(x0, y0, p.w, p.h); ctx.fillStyle = '#7a7872'; ctx.fillRect(x0, y0, p.w, 4); ctx.fillStyle = 'rgba(40,40,40,0.5)'; for (let i = 0; i < (p.horiz ? p.w : p.h); i += 60) { if (p.horiz) ctx.fillRect(x0 + i, y0, 2, p.h); else ctx.fillRect(x0, y0 + i, p.w, 2); } return; }
        if (st === 'stone') { ctx.fillStyle = '#5a564e'; ctx.fillRect(x0, y0, p.w, p.h); ctx.fillStyle = 'rgba(0,0,0,0.25)'; for (let i = 0; i < (p.horiz ? p.w : p.h); i += 14) { if (p.horiz) ctx.fillRect(x0 + i, y0, 1.5, p.h); else ctx.fillRect(x0, y0 + i, p.w, 1.5); } return; }
        if (st === 'chain') {
          ctx.strokeStyle = 'rgba(150,155,155,0.45)'; ctx.lineWidth = 1;
          ctx.beginPath();
          if (p.horiz) { for (let i = 0; i < p.w; i += 6) { ctx.moveTo(x0 + i, y0); ctx.lineTo(x0 + i + 4, y0 + p.h); } } else { for (let i = 0; i < p.h; i += 6) { ctx.moveTo(x0, y0 + i); ctx.lineTo(x0 + p.w, y0 + i + 4); } }
          ctx.stroke();
          ctx.fillStyle = '#5a5e60';
          if (p.horiz) for (let i = 0; i <= p.w; i += 80) ctx.fillRect(x0 + i - 2, y0 - 1, 4, p.h + 2); else for (let i = 0; i <= p.h; i += 80) ctx.fillRect(x0 - 1, y0 + i - 2, p.w + 2, 4);
          return;
        }
        // madera / estacas
        ctx.fillStyle = st === 'picket' ? '#8a8270' : '#4e3e2c';
        if (p.horiz) { ctx.fillRect(x0, p.y - 1.5, p.w, 3); for (let i = 0; i <= p.w; i += st === 'picket' ? 10 : 40) ctx.fillRect(x0 + i - 2, y0 - 1, 4, p.h + 2); }
        else { ctx.fillRect(p.x - 1.5, y0, 3, p.h); for (let i = 0; i <= p.h; i += st === 'picket' ? 10 : 40) ctx.fillRect(x0 - 1, y0 + i - 2, p.w + 2, 4); }
        return;
      }
      case 'grave':
        ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(x0 + 3, y0 + 4, p.w, p.h);
        ctx.fillStyle = p.open ? '#2a2018' : '#4a4038'; ctx.fillRect(x0, y0 + 6, p.w, p.h - 6);
        ctx.fillStyle = '#7a7670'; rrect(ctx, x0 + 1, y0, p.w - 2, 8, 3); ctx.fill();
        return;
      case 'bench':
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(x0 + 3, y0 + 4, p.w, p.h);
        ctx.fillStyle = '#4e3e2c'; ctx.fillRect(x0, y0, p.w, p.h);
        ctx.fillStyle = '#5e4c36'; if (p.horiz) { ctx.fillRect(x0, y0 + 2, p.w, 3); ctx.fillRect(x0, y0 + 8, p.w, 3); } else { ctx.fillRect(x0 + 2, y0, 3, p.h); ctx.fillRect(x0 + 8, y0, 3, p.h); }
        return;
      case 'fountain':
        ctx.fillStyle = '#6a6862'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
        ctx.fillStyle = '#26302c'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r - 10, 0, TAU); ctx.fill();
        ctx.fillStyle = '#7a7872'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 0.25, 0, TAU); ctx.fill();
        return;
      case 'statue':
        ctx.fillStyle = '#5a5852'; ctx.fillRect(p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
        ctx.fillStyle = '#3e4a44'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 0.55, 0, TAU); ctx.fill();
        ctx.fillStyle = '#4e5a54'; ctx.beginPath(); ctx.arc(p.x - 4, p.y - 4, p.r * 0.3, 0, TAU); ctx.fill();
        return;
      case 'kiosk':
        ctx.fillStyle = '#4a3e30'; ctx.beginPath();
        for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; const px = p.x + Math.cos(a) * p.w / 2, py = p.y + Math.sin(a) * p.h / 2; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = '#5a4c3a'; ctx.beginPath(); ctx.arc(p.x, p.y, 16, 0, TAU); ctx.fill();
        return;
      case 'bleacher':
        ctx.fillStyle = '#4a4e52'; ctx.fillRect(x0, y0, p.w, p.h);
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        if (p.w > p.h) for (let y = y0 + 8; y < y0 + p.h; y += 16) ctx.fillRect(x0, y, p.w, 4); else for (let x = x0 + 8; x < x0 + p.w; x += 16) ctx.fillRect(x, y0, 4, p.h);
        return;
      case 'container': {
        ctx.fillStyle = p.color; ctx.fillRect(x0, y0, p.w, p.h);
        ctx.fillStyle = 'rgba(0,0,0,0.22)';
        if (p.w > p.h) for (let x = x0 + 6; x < x0 + p.w; x += 10) ctx.fillRect(x, y0 + 2, 4, p.h - 4); else for (let y = y0 + 6; y < y0 + p.h; y += 10) ctx.fillRect(x0 + 2, y, p.w - 4, 4);
        ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 2; ctx.strokeRect(x0 + 1, y0 + 1, p.w - 2, p.h - 2);
        if (p.open) { ctx.fillStyle = '#121212'; if (p.w > p.h) ctx.fillRect(x0 + p.w - 6, y0 + 3, 5, p.h - 6); else ctx.fillRect(x0 + 3, y0 + p.h - 6, p.w - 6, 5); }
        return;
      }
      case 'pump':
        ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(x0 + 3, y0 + 4, p.w, p.h);
        ctx.fillStyle = '#8a8a82'; ctx.fillRect(x0, y0, p.w, p.h);
        ctx.fillStyle = '#7a2a22'; ctx.fillRect(x0 + 3, y0 + 3, p.w - 6, p.h * 0.35);
        ctx.fillStyle = '#1a1a1a'; ctx.fillRect(x0 + 4, y0 + p.h * 0.55, p.w - 8, 5);
        return;
      case 'silo':
        ctx.fillStyle = '#6a6c6a'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 2;
        for (let k = 1; k < 4; k++) { ctx.beginPath(); ctx.arc(p.x, p.y, p.r * k / 4, 0, TAU); ctx.stroke(); }
        ctx.fillStyle = 'rgba(255,255,255,0.1)'; ctx.beginPath(); ctx.arc(p.x - p.r * 0.3, p.y - p.r * 0.3, p.r * 0.4, 0, TAU); ctx.fill();
        return;
      case 'watertower': case 'fueltank':
        ctx.fillStyle = p.kind === 'fueltank' ? '#9a9890' : '#5a4a3a'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 0.7, 0, TAU); ctx.stroke();
        if (p.kind === 'fueltank') { ctx.fillStyle = '#7a2a22'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('GASOIL', p.x, p.y); }
        return;
      case 'haybale':
        ctx.fillStyle = '#8a7444'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(60,44,20,0.5)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 0.6, 0, TAU); ctx.stroke(); ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 0.25, 0, TAU); ctx.stroke();
        return;
      case 'well':
        ctx.fillStyle = '#5a564e'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
        ctx.fillStyle = '#0e1012'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 0.6, 0, TAU); ctx.fill();
        return;
      case 'trough':
        ctx.fillStyle = '#5a5e60'; ctx.fillRect(p.x - 30, p.y - 8, 60, 18); ctx.fillStyle = '#2a3236'; ctx.fillRect(p.x - 26, p.y - 4, 52, 10);
        return;
      case 'woodpile':
        for (let i = 0; i < 9; i++) { ctx.fillStyle = rng.pick(['#5a4430', '#4a3828', '#6a5038']); ctx.beginPath(); ctx.arc(p.x - 24 + (i % 5) * 12, p.y - 6 + Math.floor(i / 5) * 12, 6, 0, TAU); ctx.fill(); }
        return;
      case 'scarecrow':
        ctx.strokeStyle = '#4a3828'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(p.x - 22, p.y); ctx.lineTo(p.x + 22, p.y); ctx.stroke();
        ctx.fillStyle = '#5a4a3a'; ctx.beginPath(); ctx.arc(p.x, p.y, 9, 0, TAU); ctx.fill(); ctx.fillStyle = '#8a7444'; ctx.beginPath(); ctx.arc(p.x, p.y - 2, 7, 0, TAU); ctx.fill();
        return;
      case 'flag':
        ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(p.x + 2, p.y + 2, 50, 4);
        ctx.fillStyle = '#7a7c7e'; ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, TAU); ctx.fill();
        ctx.fillStyle = '#5a6a3a'; ctx.beginPath(); ctx.moveTo(p.x + 3, p.y - 2); ctx.lineTo(p.x + 40, p.y - 8); ctx.lineTo(p.x + 36, p.y + 10); ctx.lineTo(p.x + 3, p.y + 6); ctx.closePath(); ctx.fill();
        return;
      case 'target':
        ctx.fillStyle = '#4a3828'; ctx.fillRect(p.x - 14, p.y - 3, 28, 6);
        ctx.fillStyle = '#c8c0a8'; ctx.beginPath(); ctx.arc(p.x, p.y - 8, 10, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#8a2a22'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y - 8, 6, 0, TAU); ctx.stroke();
        ctx.fillStyle = '#8a2a22'; ctx.beginPath(); ctx.arc(p.x, p.y - 8, 2, 0, TAU); ctx.fill();
        return;
      case 'antenna':
        ctx.strokeStyle = '#6a6c6e'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + 40, p.y - 30); ctx.stroke();
        ctx.fillStyle = '#4a4c4e'; ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, TAU); ctx.fill();
        return;
      case 'clothesline':
        ctx.strokeStyle = 'rgba(160,150,130,0.6)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(p.x - 80, p.y); ctx.lineTo(p.x + 80, p.y + 6); ctx.stroke();
        for (let i = 0; i < 4; i++) { ctx.fillStyle = rng.pick(['#6a5a4a', '#4a5a6a', '#7a7a6a', '#5a3a3a']); ctx.fillRect(p.x - 60 + i * 34, p.y - 2 + i * 1.5, 18, 14); }
        return;
      case 'watchtower':
        ctx.fillStyle = '#4a4036'; ctx.fillRect(x0, y0, p.w, p.h);
        ctx.fillStyle = '#5a5046'; ctx.fillRect(x0 + 6, y0 + 6, p.w - 12, p.h - 12);
        ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 2; ctx.strokeRect(x0 + 2, y0 + 2, p.w - 4, p.h - 4);
        return;
      case 'barrier':
        if (p.rotated) {
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.ang || 0);
          ctx.fillStyle = '#8a8a82'; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
          ctx.fillStyle = '#9a3a2a'; for (let i = 0; i < p.w; i += 20) ctx.fillRect(-p.w / 2 + i, -p.h / 2, 10, p.h);
          ctx.restore();
          return;
        }
        ctx.fillStyle = '#8a8a82'; ctx.fillRect(x0, y0, p.w, p.h);
        ctx.fillStyle = '#9a3a2a'; for (let i = 0; i < p.w; i += 20) ctx.fillRect(x0 + i, y0, 10, p.h);
        return;
      case 'barricade':
        ctx.fillStyle = '#5a4430'; ctx.fillRect(x0, y0, p.w, p.h);
        ctx.strokeStyle = '#3a2a1a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + p.w, y0 + p.h); ctx.moveTo(x0 + p.w, y0); ctx.lineTo(x0, y0 + p.h); ctx.stroke();
        return;
      case 'foundation':
        ctx.fillStyle = 'rgba(30,28,26,0.5)'; ctx.fillRect(x0, y0, p.w, p.h);
        ctx.fillStyle = '#5a5650'; ctx.fillRect(x0, y0, p.w * 0.6, 10); ctx.fillRect(x0, y0, 10, p.h * 0.7);
        D.decor(ctx, { kind: 'rubble', x: p.x, y: p.y, s: 2, seed: p.seed });
        return;
      case 'fuselage': {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.ang);
        ctx.fillStyle = 'rgba(0,0,0,0.35)'; rrect(ctx, -p.L / 2 + 10, -p.rad + 14, p.L, p.rad * 2, p.rad); ctx.fill();
        ctx.fillStyle = '#8a8c88'; rrect(ctx, -p.L / 2, -p.rad, p.L * 0.46, p.rad * 2, p.rad); ctx.fill();
        rrect(ctx, p.L * 0.06, -p.rad, p.L * 0.44, p.rad * 2, p.rad); ctx.fill();
        ctx.fillStyle = '#1a1a1a'; ctx.fillRect(-p.L * 0.05, -p.rad, p.L * 0.12, p.rad * 2);
        ctx.fillStyle = 'rgba(20,20,20,0.6)'; for (let x = -p.L / 2 + 30; x < p.L / 2 - 30; x += 22) ctx.fillRect(x, -p.rad + 6, 8, 5);
        ctx.fillStyle = 'rgba(30,20,10,0.5)'; blob(ctx, p.L * 0.2, 0, p.rad * 0.9, rng, 8, 0.4); ctx.fill();
        ctx.restore();
        return;
      }
      case 'wing':
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.ang);
        ctx.fillStyle = '#7a7c78'; ctx.beginPath(); ctx.moveTo(-p.L / 2, -30); ctx.lineTo(p.L / 2, -10); ctx.lineTo(p.L / 2, 10); ctx.lineTo(-p.L / 2, 34); ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(-p.L / 4, -8, p.L / 2, 6);
        ctx.restore();
        return;
      case 'smallplane':
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.ang);
        ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(-120, 10, 260, 40);
        ctx.fillStyle = p.crashed ? '#3a3836' : '#c8c4b8';
        rrect(ctx, -130, -18, 260, 36, 16); ctx.fill();
        ctx.fillRect(-30, -170, 60, 340);
        ctx.fillRect(-130, -60, 36, 120);
        ctx.fillStyle = '#2a3a4a'; ctx.fillRect(70, -12, 30, 24);
        ctx.fillStyle = '#8a2a22'; ctx.fillRect(-120, -4, 220, 8);
        ctx.restore();
        return;
      case 'helicopter':
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.ang);
        ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(-150, 14, 300, 50);
        ctx.fillStyle = p.crashed ? '#262622' : '#3e4632';
        rrect(ctx, -80, -40, 170, 80, 36); ctx.fill();
        ctx.fillRect(-260, -10, 190, 20);
        ctx.fillStyle = '#1a2026'; ctx.fillRect(50, -28, 30, 56);
        ctx.strokeStyle = 'rgba(40,40,40,0.8)'; ctx.lineWidth = 8; ctx.beginPath();
        for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + 0.4; ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * (p.crashed && i === 1 ? 90 : 250), Math.sin(a) * (p.crashed && i === 1 ? 90 : 250)); }
        ctx.stroke();
        ctx.restore();
        return;
    }
  };

  // ---------- interiores ----------
  const FCOL = { wood: '#5e4630', dark: '#3e2e20', metal: '#5a5e62', white: '#b8b4a8', fabric: '#4a4038' };
  D.furn = function (ctx, f, rng) {
    const { x, y, w, h } = f;
    const sh = () => { ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.fillRect(x + 3, y + 4, w, h); };
    switch (f.f) {
      case 'bed': case 'hbed': case 'bunk': {
        sh();
        ctx.fillStyle = f.f === 'hbed' ? '#8a8e8c' : f.f === 'bunk' ? '#5a5e52' : FCOL.dark; ctx.fillRect(x, y, w, h);
        ctx.fillStyle = f.f === 'hbed' ? '#c8c8c0' : '#a8a498'; ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
        ctx.fillStyle = f.color || (f.f === 'hbed' ? '#9ab0b8' : '#5d6a55');
        // manta hacia los pies (lado opuesto a la pared)
        const fc = f.face;
        if (fc === 's') ctx.fillRect(x + 2, y + h * 0.35, w - 4, h * 0.65 - 2);
        else if (fc === 'n') ctx.fillRect(x + 2, y + 2, w - 4, h * 0.65 - 2);
        else if (fc === 'e') ctx.fillRect(x + w * 0.35, y + 2, w * 0.65 - 2, h - 4);
        else ctx.fillRect(x + 2, y + 2, w * 0.65 - 2, h - 4);
        ctx.fillStyle = '#d0ccc0';
        if (fc === 's') ctx.fillRect(x + 4, y + 4, w - 8, h * 0.18);
        else if (fc === 'n') ctx.fillRect(x + 4, y + h - 4 - h * 0.18, w - 8, h * 0.18);
        else if (fc === 'e') ctx.fillRect(x + 4, y + 4, w * 0.18, h - 8);
        else ctx.fillRect(x + w - 4 - w * 0.18, y + 4, w * 0.18, h - 8);
        if (rng.chance(0.25)) { ctx.fillStyle = 'rgba(90,10,8,0.5)'; blob(ctx, x + w / 2, y + h / 2, Math.min(w, h) * 0.25, rng, 8, 0.3); ctx.fill(); }
        return;
      }
      case 'sofa': case 'armchair': {
        sh();
        const c = f.color || '#4a4038';
        ctx.fillStyle = U.shade(c, 0.75); ctx.fillRect(x, y, w, h);
        ctx.fillStyle = c;
        const b = 7;
        if (f.face === 's') ctx.fillRect(x + b, y + b, w - b * 2, h - b);
        else if (f.face === 'n') ctx.fillRect(x + b, y, w - b * 2, h - b);
        else if (f.face === 'e') ctx.fillRect(x + b, y + b, w - b, h - b * 2);
        else ctx.fillRect(x, y + b, w - b, h - b * 2);
        return;
      }
      case 'table': case 'ctable': case 'rtable': {
        if (f.chairs) {
          ctx.fillStyle = '#4a3828';
          const n = f.chairs;
          for (let i = 0; i < n; i++) {
            const side = i % 2, k = Math.floor(i / 2), m = Math.ceil(n / 2);
            if (w >= h) { const cx = x + (w * (k + 0.5)) / m - 6; ctx.fillRect(cx, side ? y + h + 2 : y - 12, 12, 10); }
            else { const cy = y + (h * (k + 0.5)) / m - 6; ctx.fillRect(side ? x + w + 2 : x - 12, cy, 10, 12); }
          }
        }
        sh();
        ctx.fillStyle = f.f === 'ctable' ? FCOL.dark : '#6a5038';
        if (f.f === 'rtable') { ctx.beginPath(); ctx.arc(x + w / 2, y + h / 2, w / 2, 0, TAU); ctx.fill(); }
        else ctx.fillRect(x, y, w, h);
        ctx.fillStyle = 'rgba(255,240,210,0.06)'; ctx.fillRect(x + 2, y + 2, w - 4, 3);
        if (rng.chance(0.4)) { ctx.fillStyle = rng.pick(['#8a8a80', '#a09080', '#6a6a70']); ctx.fillRect(x + rng.range(4, w - 10), y + rng.range(3, h - 8), 6, 5); }
        return;
      }
      case 'counter': case 'labbench': case 'checkout': {
        sh();
        ctx.fillStyle = f.f === 'labbench' ? '#c0c0b8' : f.f === 'checkout' ? '#5a5e60' : '#8a8478'; ctx.fillRect(x, y, w, h);
        ctx.fillStyle = f.f === 'labbench' ? '#d8d8d0' : '#9a958a'; ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
        if (f.register || f.f === 'checkout') { ctx.fillStyle = '#2a2c2e'; ctx.fillRect(x + w / 2 - 6, y + h / 2 - 5, 12, 10); }
        if (f.f === 'counter' && w > 60 && rng.chance(0.5)) { ctx.fillStyle = '#4a5052'; ctx.beginPath(); ctx.arc(x + w * 0.3, y + h / 2, Math.min(w, h) * 0.3, 0, TAU); ctx.fill(); }
        return;
      }
      case 'fridge': case 'fridgerow':
        sh();
        ctx.fillStyle = '#c4c2ba'; ctx.fillRect(x, y, w, h);
        ctx.fillStyle = '#a8a69e';
        if (f.f === 'fridgerow') { for (let i = 0; i < Math.max(w, h); i += 24) { if (w > h) ctx.fillRect(x + i, y, 2, h); else ctx.fillRect(x, y + i, w, 2); } ctx.fillStyle = 'rgba(120,170,190,0.35)'; ctx.fillRect(x + 2, y + 2, w - 4, h - 4); }
        else ctx.fillRect(x + 2, y + h * 0.4, w - 4, 2);
        return;
      case 'stove':
        sh(); ctx.fillStyle = '#3a3c3e'; ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 1.5;
        for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.arc(x + w * (i % 2 ? 0.7 : 0.3), y + h * (i < 2 ? 0.3 : 0.7), 3.5, 0, TAU); ctx.stroke(); }
        return;
      case 'cabinet': case 'wardrobe': case 'nightstand': case 'bookshelf': case 'filecab': case 'medcab': case 'toolcab': case 'desk': {
        sh();
        const col = f.f === 'filecab' || f.f === 'toolcab' ? (f.f === 'toolcab' ? '#7a2a22' : '#5a5e62') : f.f === 'medcab' ? '#c8c8c0' : f.f === 'desk' ? '#6a5038' : FCOL.wood;
        ctx.fillStyle = col; ctx.fillRect(x, y, w, h);
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        if (w > h) ctx.fillRect(x + w / 2 - 0.75, y + 1, 1.5, h - 2); else ctx.fillRect(x + 1, y + h / 2 - 0.75, w - 2, 1.5);
        if (f.f === 'bookshelf') for (let i = 3; i < Math.max(w, h) - 3; i += 5) { ctx.fillStyle = rng.pick(['#6a3a2a', '#2a4a5a', '#5a5a3a', '#8a7a5a']); if (w > h) ctx.fillRect(x + i, y + 1, 3, h - 2); else ctx.fillRect(x + 1, y + i, w - 2, 3); }
        if (f.f === 'medcab') { ctx.fillStyle = '#8a2a22'; ctx.fillRect(x + w / 2 - 3, y + h / 2 - 1, 6, 2); ctx.fillRect(x + w / 2 - 1, y + h / 2 - 3, 2, 6); }
        if (f.f === 'desk' && f.pc) { ctx.fillStyle = '#1e2022'; ctx.fillRect(x + w / 2 - 7, y + h / 2 - 4, 14, 6); ctx.fillStyle = '#3a2e22'; ctx.beginPath(); ctx.arc(x + w / 2, f.face === 's' ? y + h + 9 : f.face === 'n' ? y - 9 : y + h / 2, 7, 0, TAU); ctx.fill(); }
        return;
      }
      case 'tvstand':
        sh(); ctx.fillStyle = FCOL.dark; ctx.fillRect(x, y, w, h);
        ctx.fillStyle = '#121416'; if (w > h) ctx.fillRect(x + 4, y + h / 2 - 2, w - 8, 4); else ctx.fillRect(x + w / 2 - 2, y + 4, 4, h - 8);
        return;
      case 'plant':
        ctx.fillStyle = '#5a3a2a'; ctx.beginPath(); ctx.arc(x + w / 2, y + h / 2, w / 2, 0, TAU); ctx.fill();
        ctx.fillStyle = '#3a3a24'; blob(ctx, x + w / 2, y + h / 2, w * 0.6, rng, 7, 0.4); ctx.fill();
        return;
      case 'tub':
        sh(); ctx.fillStyle = '#c8c6be'; rrect(ctx, x, y, w, h, 8); ctx.fill();
        ctx.fillStyle = '#9aa2a4'; rrect(ctx, x + 4, y + 4, w - 8, h - 8, 7); ctx.fill();
        return;
      case 'toilet':
        ctx.fillStyle = '#d0cec6'; ctx.fillRect(x, y, w, h * 0.35); ctx.beginPath(); ctx.ellipse(x + w / 2, y + h * 0.65, w / 2, h * 0.35, 0, 0, TAU); ctx.fill();
        return;
      case 'sink':
        ctx.fillStyle = '#c8c6be'; ctx.fillRect(x, y, w, h); ctx.fillStyle = '#8a9294'; ctx.beginPath(); ctx.ellipse(x + w / 2, y + h / 2, w * 0.35, h * 0.3, 0, 0, TAU); ctx.fill();
        return;
      case 'shelf': case 'gondola': case 'wshelf': case 'rack': {
        sh();
        ctx.fillStyle = f.f === 'rack' ? '#3a4a5a' : '#6a6e70'; ctx.fillRect(x, y, w, h);
        ctx.fillStyle = f.f === 'rack' ? '#c06a2a' : '#4a4e50';
        if (w > h) { ctx.fillRect(x, y, w, 2); ctx.fillRect(x, y + h - 2, w, 2); } else { ctx.fillRect(x, y, 2, h); ctx.fillRect(x + w - 2, y, 2, h); }
        // productos (algunos huecos: saqueado)
        const L = Math.max(w, h), Wd = Math.min(w, h);
        for (let i = 3; i < L - 4; i += 7) {
          if (rng.chance(0.45)) continue;
          ctx.fillStyle = f.f === 'rack' ? rng.pick(['#7a5a3a', '#8a6a42', '#6a4a2a']) : rng.pick(['#8a3a2a', '#3a6a8a', '#c0a050', '#4a7a3a', '#a0a098', '#6a3a6a', '#c07030']);
          const s2 = f.f === 'rack' ? 6 : 4;
          if (w > h) ctx.fillRect(x + i, y + 3 + rng.range(0, Wd - 6 - s2), s2, s2); else ctx.fillRect(x + 3 + rng.range(0, Wd - 6 - s2), y + i, s2, s2);
        }
        return;
      }
      case 'workbench':
        sh(); ctx.fillStyle = '#6a5038'; ctx.fillRect(x, y, w, h);
        ctx.fillStyle = '#5a5e62'; ctx.fillRect(x + 6, y + 4, 10, 6); ctx.fillRect(x + w - 20, y + h - 10, 14, 5);
        ctx.fillStyle = '#7a2a22'; ctx.fillRect(x + w / 2, y + h / 2 - 2, 12, 4);
        return;
      case 'car':
        D.vehicle(ctx, { kind: 'car', x: x + w / 2, y: y + h / 2, ang: w > h ? 0 : Math.PI / 2, L: Math.max(w, h), W: Math.min(w, h), color: f.color || '#545a5c', burned: false, seed: f.seed }, rng);
        return;
      case 'post':
        ctx.fillStyle = '#c0a030'; ctx.fillRect(x, y, w, h);
        return;
      case 'safe':
        sh(); ctx.fillStyle = '#2a2c2e'; ctx.fillRect(x, y, w, h); ctx.fillStyle = '#5a5c5e'; ctx.beginPath(); ctx.arc(x + w / 2, y + h / 2, 4, 0, TAU); ctx.fill();
        return;
      case 'crate': case 'milcrate':
        sh(); ctx.fillStyle = f.f === 'milcrate' ? '#434a34' : '#5a4630'; ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = f.f === 'milcrate' ? '#2e3324' : '#3a2c1c'; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
        ctx.beginPath(); ctx.moveTo(x + 2, y + 2); ctx.lineTo(x + w - 2, y + h - 2); ctx.stroke();
        return;
      case 'locker':
        sh(); ctx.fillStyle = '#4a5a6a'; ctx.fillRect(x, y, w, h);
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        for (let i = 13; i < Math.max(w, h); i += 13) { if (w > h) ctx.fillRect(x + i, y, 1.5, h); else ctx.fillRect(x, y + i, w, 1.5); }
        return;
      case 'bench':
        ctx.fillStyle = '#5a4a38'; ctx.fillRect(x, y, w, h); ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.fillRect(x, y + h - 3, w, 3);
        return;
      case 'gunrack':
        sh(); ctx.fillStyle = '#3e3a32'; ctx.fillRect(x, y, w, h);
        ctx.fillStyle = '#1a1a1a'; for (let i = 4; i < Math.max(w, h) - 3; i += 7) { if (w > h) ctx.fillRect(x + i, y + 2, 2, h - 4); else ctx.fillRect(x + 2, y + i, w - 4, 2); }
        return;
      case 'optable': case 'equip':
        sh(); ctx.fillStyle = f.f === 'equip' ? '#7a8288' : '#9aa4a8'; ctx.fillRect(x, y, w, h);
        ctx.fillStyle = '#c8d0d0'; ctx.fillRect(x + 3, y + 3, w - 6, h - 6);
        return;
      case 'sdesk':
        ctx.fillStyle = '#7a6448'; ctx.fillRect(x, y, w, h); ctx.fillStyle = '#4a4440'; ctx.fillRect(x + w / 2 - 5, y + h + 2, 10, 8);
        return;
      case 'board':
        ctx.fillStyle = '#26322a'; ctx.fillRect(x, y, w, h);
        return;
      case 'mat':
        ctx.fillStyle = 'rgba(40,60,90,0.6)'; ctx.fillRect(x, y, w, h);
        return;
      case 'pew':
        sh(); ctx.fillStyle = '#4e3a28'; ctx.fillRect(x, y, w, h); ctx.fillStyle = '#5e4632'; ctx.fillRect(x, y, w, 5);
        return;
      case 'altar':
        sh(); ctx.fillStyle = '#7a7268'; ctx.fillRect(x, y, w, h); ctx.fillStyle = '#c8c0a8'; ctx.fillRect(x + 4, y + 4, w - 8, h - 8);
        ctx.fillStyle = '#5a4a2a'; ctx.fillRect(x + w / 2 - 2, y + 6, 4, h - 12); ctx.fillRect(x + w / 2 - 8, y + 10, 16, 4);
        return;
      case 'stall':
        ctx.fillStyle = '#5a4430'; ctx.fillRect(x, y, w, h);
        return;
      case 'hay':
        ctx.fillStyle = '#8a7444'; ctx.fillRect(x, y, w, h); ctx.fillStyle = 'rgba(60,44,20,0.4)'; ctx.fillRect(x, y + h / 2, w, 1.5);
        return;
      case 'tractor':
        D.vehicle(ctx, { kind: 'tractor', x: x + w / 2, y: y + h / 2, ang: w > h ? 0 : Math.PI / 2, L: Math.max(w, h), W: Math.min(w, h), color: '#6a2a1e', seed: f.seed }, rng);
        return;
      case 'machine':
        sh(); ctx.fillStyle = '#5a5e5a'; ctx.fillRect(x, y, w, h);
        ctx.fillStyle = '#4a4e4a'; ctx.fillRect(x + 6, y + 6, w - 12, h - 12);
        ctx.fillStyle = '#c0a030'; ctx.fillRect(x, y, w, 4); ctx.fillStyle = '#1a1a1a'; for (let i = 0; i < w; i += 12) ctx.fillRect(x + i, y, 6, 4);
        ctx.fillStyle = '#2a2c2e'; ctx.beginPath(); ctx.arc(x + w * 0.65, y + h * 0.55, Math.min(w, h) * 0.18, 0, TAU); ctx.fill();
        return;
      case 'conveyor':
        sh(); ctx.fillStyle = '#3a3c3e'; ctx.fillRect(x, y, w, h);
        ctx.fillStyle = '#5a5c5e'; for (let i = 2; i < Math.max(w, h); i += 6) { if (w > h) ctx.fillRect(x + i, y + 2, 2, h - 4); else ctx.fillRect(x + 2, y + i, w - 4, 2); }
        return;
      case 'forklift':
        D.vehicle(ctx, { kind: 'tractor', x: x + w / 2, y: y + h / 2, ang: w > h ? 0 : Math.PI / 2, L: Math.max(w, h), W: Math.min(w, h), color: '#c0902a', seed: f.seed }, rng);
        return;
      case 'barrelr':
        ctx.fillStyle = rng.pick(['#4a3020', '#2a3a5a', '#5a4a30']); ctx.beginPath(); ctx.arc(x + w / 2, y + h / 2, w / 2, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x + w / 2, y + h / 2, w * 0.32, 0, TAU); ctx.stroke();
        return;
      case 'generator':
        sh(); ctx.fillStyle = '#4a5a3a'; ctx.fillRect(x, y, w, h); ctx.fillStyle = '#2a2c2e'; ctx.fillRect(x + 6, y + 5, w * 0.4, h - 10);
        return;
      case 'pool':
        sh(); ctx.fillStyle = '#4a3020'; ctx.fillRect(x, y, w, h); ctx.fillStyle = '#2a5a3a'; ctx.fillRect(x + 5, y + 5, w - 10, h - 10);
        return;
      case 'plane': {
        ctx.save(); ctx.translate(x + w / 2, y + h / 2);
        const s = Math.min(w, h) / 340;
        ctx.scale(s, s);
        ctx.fillStyle = '#c8c4b8'; rrect(ctx, -130, -18, 260, 36, 16); ctx.fill();
        ctx.fillRect(-30, -170, 60, 340); ctx.fillRect(-130, -60, 36, 120);
        ctx.fillStyle = '#2a3a4a'; ctx.fillRect(70, -12, 30, 24);
        ctx.restore();
        return;
      }
      default:
        sh(); ctx.fillStyle = '#5a5048'; ctx.fillRect(x, y, w, h);
    }
  };

  // Interior completo de un edificio (pisos, decorado, muebles, muros, ventanas)
  // bx: límites del chunk {x0,y0,x1,y1} para no dibujar lo que cae fuera
  D.building = function (ctx, b, rng, bx) {
    const det = b.det;
    const vis = (o, m) => !bx || !(o.x > bx.x1 + m || o.x + o.w < bx.x0 - m || o.y > bx.y1 + m || o.y + o.h < bx.y0 - m);
    const visP = (x, y, m) => !bx || !(x > bx.x1 + m || x < bx.x0 - m || y > bx.y1 + m || y < bx.y0 - m);
    // sombra del edificio sobre el suelo
    ctx.fillStyle = 'rgba(0,0,0,0.38)';
    ctx.fillRect(b.x + 14, b.y + 18, b.w, b.h);
    for (const f of det.floors) { if (!vis(f, 0)) continue; ctx.fillStyle = D.pattern(ctx, f.mat); ctx.fillRect(f.x, f.y, f.w, f.h); }
    if (b.burned) { ctx.fillStyle = 'rgba(10,8,6,0.45)'; ctx.fillRect(b.x, b.y, b.w, b.h); }
    // suciedad por habitación
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    for (const r of det.rooms) { if (!vis(r, 0)) continue; ctx.fillRect(r.x, r.y, r.w, 5); ctx.fillRect(r.x, r.y, 5, r.h); }
    for (const d of det.decor) if (visP(d.x, d.y, 40)) D.decor(ctx, d);
    const fs = det.furn.filter((f) => vis(f, 16)).sort((a, b2) => a.y + a.h - (b2.y + b2.h));
    for (const f of fs) D.furn(ctx, f, new U.RNG(f.seed));
    // muros
    const ext = b.wallColor || '#8a8070';
    for (const w of det.walls) {
      if (!vis(w, 2)) continue;
      ctx.fillStyle = w.ext ? U.shade(ext, 0.5) : '#262220';
      ctx.fillRect(w.x, w.y, w.w, w.h);
      ctx.fillStyle = w.ext ? ext : '#857c70';
      ctx.fillRect(w.x + 1, w.y + 1, Math.max(0, w.w - 2), Math.max(0, w.h - 2));
    }
    for (const w of det.windows) {
      if (!vis(w, 20)) continue;
      ctx.fillStyle = '#2a2a28'; ctx.fillRect(w.x, w.y, w.w, w.h);
      ctx.fillStyle = w.broken ? 'rgba(120,150,160,0.35)' : 'rgba(140,170,180,0.55)';
      if (w.w > w.h) ctx.fillRect(w.x + 1, w.y + w.h / 2 - 1.5, w.w - 2, 3); else ctx.fillRect(w.x + w.w / 2 - 1.5, w.y + 1, 3, w.h - 2);
      if (w.boarded) {
        ctx.fillStyle = '#5a4430';
        if (w.w > w.h) { for (let i = 4; i < w.w - 6; i += 12) ctx.fillRect(w.x + i, w.y - 2, 7, w.h + 4); }
        else { for (let i = 4; i < w.h - 6; i += 12) ctx.fillRect(w.x - 2, w.y + i, w.w + 4, 7); }
      }
      if (w.broken) D.decor(ctx, { kind: 'glass', x: w.x + w.w / 2, y: w.y + w.h / 2, seed: (w.x * 7 + w.y) | 0 });
    }
    // umbrales de puertas
    for (const d of det.doors) { if (!vis(d, 2)) continue; ctx.fillStyle = "#2e2a26"; ctx.fillRect(d.x, d.y, d.w, d.h); }
    if (det.decorOut) for (const d of det.decorOut) D.decor(ctx, d);
    void rng;
  };

  // ---------- techos ----------
  D.roof = function (ctx, b) {
    const rng = new U.RNG(b.seed + 7);
    const ov = 6;
    const x = b.x - ov, y = b.y - ov, w = b.w + ov * 2, h = b.h + ov * 2;
    const col = b.roofColor || '#4a4846';
    const st = b.roofStyle;
    if (st === 'gable' || st === 'hip') {
      const along = w >= h; // la cumbrera sigue el lado largo
      ctx.fillStyle = U.shade(col, 1.08);
      if (along) ctx.fillRect(x, y, w, h / 2); else ctx.fillRect(x, y, w / 2, h);
      ctx.fillStyle = U.shade(col, 0.78);
      if (along) ctx.fillRect(x, y + h / 2, w, h / 2); else ctx.fillRect(x + w / 2, y, w / 2, h);
      if (st === 'hip') {
        const m = Math.min(w, h) / 2;
        ctx.fillStyle = U.shade(col, 0.92);
        ctx.beginPath();
        if (along) { ctx.moveTo(x, y); ctx.lineTo(x + m, y + h / 2); ctx.lineTo(x, y + h); ctx.closePath(); ctx.moveTo(x + w, y); ctx.lineTo(x + w - m, y + h / 2); ctx.lineTo(x + w, y + h); ctx.closePath(); }
        else { ctx.moveTo(x, y); ctx.lineTo(x + w / 2, y + m); ctx.lineTo(x + w, y); ctx.closePath(); ctx.moveTo(x, y + h); ctx.lineTo(x + w / 2, y + h - m); ctx.lineTo(x + w, y + h); ctx.closePath(); }
        ctx.fill();
      }
      // tejas
      ctx.fillStyle = 'rgba(0,0,0,0.16)';
      if (along) for (let yy = y + 6; yy < y + h; yy += 9) ctx.fillRect(x, yy, w, 2);
      else for (let xx = x + 6; xx < x + w; xx += 9) ctx.fillRect(xx, y, 2, h);
      ctx.fillStyle = 'rgba(255,240,220,0.12)';
      if (along) ctx.fillRect(x, y + h / 2 - 2, w, 4); else ctx.fillRect(x + w / 2 - 2, y, 4, h);
      if (b.type !== 'church' && b.sub !== 'shed' && rng.chance(0.55)) {
        const cx = x + w * rng.range(0.2, 0.8), cy = y + h * rng.range(0.2, 0.8);
        ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(cx + 4, cy + 4, 16, 16);
        ctx.fillStyle = '#5a4a40'; ctx.fillRect(cx, cy, 16, 16); ctx.fillStyle = '#1a1614'; ctx.fillRect(cx + 4, cy + 4, 8, 8);
      }
      if (b.type === 'church') {
        // campanario y cruz en la fachada
        const fx = b.front === 'e' ? x + w - 50 : b.front === 'w' ? x + 50 : x + w / 2;
        const fy = b.front === 's' ? y + h - 50 : b.front === 'n' ? y + 50 : y + h / 2;
        ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(fx - 34, fy - 26, 68, 68);
        ctx.fillStyle = U.shade(col, 0.9); ctx.fillRect(fx - 40, fy - 40, 80, 80);
        ctx.fillStyle = U.shade(col, 1.2); ctx.beginPath(); ctx.moveTo(fx - 40, fy - 40); ctx.lineTo(fx, fy); ctx.lineTo(fx + 40, fy - 40); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#b8b0a0'; ctx.fillRect(fx - 3, fy - 22, 6, 44); ctx.fillRect(fx - 14, fy - 10, 28, 6);
      }
    } else if (st === 'metal') {
      ctx.fillStyle = col; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      const along = w >= h;
      if (along) for (let yy = y; yy < y + h; yy += 8) ctx.fillRect(x, yy, w, 3); else for (let xx = x; xx < x + w; xx += 8) ctx.fillRect(xx, y, 3, h);
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      if (along) ctx.fillRect(x, y + h / 2 - 1, w, 2); else ctx.fillRect(x + w / 2 - 1, y, 2, h);
      for (let i = 0; i < 4; i++) {
        const rx = x + rng.range(0, w), ry = y + rng.range(0, h), r = rng.range(10, 40);
        const g = ctx.createRadialGradient(rx, ry, 0, rx, ry, r);
        g.addColorStop(0, 'rgba(110,60,30,0.35)'); g.addColorStop(1, 'rgba(110,60,30,0)');
        ctx.fillStyle = g; ctx.fillRect(rx - r, ry - r, r * 2, r * 2);
      }
      if (w * h > 600 * 600) {
        ctx.fillStyle = 'rgba(160,190,200,0.25)';
        for (let i = 1; i < 4; i++) { if (along) ctx.fillRect(x + (w * i) / 4 - 20, y + h * 0.2, 40, h * 0.6); else ctx.fillRect(x + w * 0.2, y + (h * i) / 4 - 20, w * 0.6, 40); }
      }
    } else if (st === 'earth') {
      ctx.fillStyle = '#3c3a2a'; rrect(ctx, x - 10, y - 10, w + 20, h + 20, 40); ctx.fill();
      ctx.fillStyle = D.pattern(ctx, 'forest'); rrect(ctx, x, y, w, h, 30); ctx.fill();
      ctx.fillStyle = '#4a4c4a'; ctx.beginPath(); ctx.arc(x + w * 0.3, y + h * 0.3, 8, 0, TAU); ctx.fill(); ctx.beginPath(); ctx.arc(x + w * 0.7, y + h * 0.6, 6, 0, TAU); ctx.fill();
      for (let i = 0; i < 6; i++) D.decor(ctx, { kind: 'shrub', x: x + rng.range(0, w), y: y + rng.range(0, h), s: 1, seed: rng.int(1, 1e9) });
    } else {
      // plano con pretil, grava y equipos
      ctx.fillStyle = col; ctx.fillRect(x, y, w, h);
      ctx.save(); ctx.globalAlpha = 0.18; ctx.fillStyle = D.pattern(ctx, 'gravel'); ctx.fillRect(x, y, w, h); ctx.restore();
      ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.lineWidth = 6; ctx.strokeRect(x + 4, y + 4, w - 8, h - 8);
      ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
      const n = Math.max(1, Math.min(8, Math.round(w * h / (220 * 220))));
      for (let i = 0; i < n; i++) {
        const ew = rng.range(22, 48), eh = rng.range(20, 40);
        const ex = x + rng.range(14, Math.max(15, w - ew - 14)), ey = y + rng.range(14, Math.max(15, h - eh - 14));
        ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(ex + 5, ey + 6, ew, eh);
        ctx.fillStyle = '#5c5e60'; ctx.fillRect(ex, ey, ew, eh);
        ctx.fillStyle = '#44464a'; ctx.beginPath(); ctx.arc(ex + ew / 2, ey + eh / 2, Math.min(ew, eh) * 0.32, 0, TAU); ctx.fill();
      }
      if (b.tower) { ctx.fillStyle = 'rgba(140,170,180,0.4)'; ctx.fillRect(x + 8, y + 8, w - 16, h - 16); }
    }
    // manchas de humedad
    for (let i = 0; i < 3; i++) {
      const sx = x + rng.range(10, w - 10), sy = y + rng.range(10, h - 10), r = rng.range(14, 40);
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
      g.addColorStop(0, 'rgba(0,0,0,0.22)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(sx - r, sy - r, r * 2, r * 2);
    }
    if (b.roofText) {
      ctx.save();
      ctx.translate(b.x + b.w / 2, b.y + b.h / 2);
      if (b.h > b.w * 1.2) ctx.rotate(-Math.PI / 2);
      const L = Math.max(b.w, b.h), S = Math.min(b.w, b.h);
      ctx.font = `bold ${Math.min(S * 0.45, L / (b.roofText.length * 0.75))}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(230,226,215,0.75)';
      ctx.fillText(b.roofText, 0, 0);
      ctx.restore();
    }
    if (b.burned) { ctx.fillStyle = 'rgba(12,10,8,0.5)'; ctx.fillRect(x, y, w, h); }
    // agujeros (ruinas): se ve el interior
    if (b.ruined || b.burned) {
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      const n = b.burned ? rng.int(2, 4) : rng.int(1, 2);
      for (let i = 0; i < n; i++) {
        const hx = b.x + b.w * rng.range(0.2, 0.8), hy = b.y + b.h * rng.range(0.2, 0.8);
        const r = Math.min(b.w, b.h) * rng.range(0.1, b.burned ? 0.32 : 0.2);
        ctx.fillStyle = '#000'; blob(ctx, hx, hy, r, rng, 10, 0.4); ctx.fill();
      }
      ctx.restore();
    }
  };
  D.canopy = function (ctx, c) {
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(c.x + 10, c.y + 14, c.w, c.h);
    ctx.fillStyle = '#b8b6ae'; ctx.fillRect(c.x, c.y, c.w, c.h);
    ctx.fillStyle = c.color || '#7a2a22';
    if (c.w > c.h) { ctx.fillRect(c.x, c.y, c.w, 12); ctx.fillRect(c.x, c.y + c.h - 12, c.w, 12); } else { ctx.fillRect(c.x, c.y, 12, c.h); ctx.fillRect(c.x + c.w - 12, c.y, 12, c.h); }
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    for (let i = 1; i < 5; i++) ctx.fillRect(c.x + (c.w * i) / 5, c.y + 14, 2, c.h - 28);
  };

  // ---------- puertas (dinámicas) ----------
  const DOORC = { wood: '#9a7048', glass: 'rgba(160,195,205,0.6)', metal: '#6e747a', garage: '#7a7c76', bars: '#2a2a2a' };
  D.door = function (ctx, d) {
    const horiz = d.horiz;
    if (d.broken) {
      ctx.fillStyle = 'rgba(30,26,22,0.9)'; ctx.fillRect(d.x, d.y, d.w, d.h);
      ctx.fillStyle = d.mat === 'glass' ? 'rgba(160,190,200,0.5)' : '#4a3424';
      const n = 4;
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        const px = horiz ? d.x + d.w * t : d.x + d.w / 2 + d.swing * (6 + i * 3);
        const py = horiz ? d.y + d.h / 2 + d.swing * (6 + i * 3) : d.y + d.h * t;
        ctx.fillRect(px - 3, py - 2, 7, 4);
      }
      return;
    }
    const col = DOORC[d.mat] || DOORC.wood;
    if (!d.open) {
      ctx.fillStyle = col;
      if (d.mat === 'bars') {
        ctx.fillStyle = 'rgba(30,30,30,0.9)';
        const L = horiz ? d.w : d.h;
        for (let i = 2; i < L; i += 6) { if (horiz) ctx.fillRect(d.x + i, d.y, 2, d.h); else ctx.fillRect(d.x, d.y + i, d.w, 2); }
        if (horiz) ctx.fillRect(d.x, d.y + d.h / 2 - 1, d.w, 2); else ctx.fillRect(d.x + d.w / 2 - 1, d.y, 2, d.h);
      } else {
        ctx.fillRect(d.x, d.y, d.w, d.h);
        ctx.strokeStyle = "rgba(0,0,0,0.65)"; ctx.lineWidth = 1; ctx.strokeRect(d.x + 0.5, d.y + 0.5, d.w - 1, d.h - 1);
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        if (horiz) ctx.fillRect(d.x, d.y, 2, d.h); else ctx.fillRect(d.x, d.y, d.w, 2);
        if (d.mat === 'garage') { ctx.fillStyle = 'rgba(0,0,0,0.2)'; for (let i = 0; i < (horiz ? d.w : d.h); i += 8) { if (horiz) ctx.fillRect(d.x + i, d.y, 2, d.h); else ctx.fillRect(d.x, d.y + i, d.w, 2); } }
      }
      if (d.barricade) {
        ctx.fillStyle = '#6a5038';
        const L = horiz ? d.w : d.h;
        for (let i = 0; i < 3; i++) {
          ctx.save(); ctx.translate(d.cx, d.cy); ctx.rotate((horiz ? 0 : Math.PI / 2) + (i - 1) * 0.35);
          ctx.fillRect(-L * 0.6, -3, L * 1.2, 6); ctx.restore();
        }
      }
      return;
    }
    // abierta: hoja girada 90° hacia el lado de apertura
    if (d.mat === 'garage') { ctx.fillStyle = 'rgba(20,18,16,0.6)'; ctx.fillRect(d.x, d.y, d.w, d.h); return; }
    const L = horiz ? d.w : d.h, T = 5;
    ctx.fillStyle = col;
    if (horiz) {
      const hx = d.hinge ? d.x + d.w : d.x, hy = d.cy;
      const lr = [hx - (d.hinge ? T : 0), d.swing > 0 ? hy : hy - L, T, L];
      ctx.fillRect(lr[0], lr[1], lr[2], lr[3]); ctx.strokeStyle = "rgba(0,0,0,0.6)"; ctx.lineWidth = 1; ctx.strokeRect(lr[0] + 0.5, lr[1] + 0.5, lr[2] - 1, lr[3] - 1);
    } else {
      const hy = d.hinge ? d.y + d.h : d.y, hx = d.cx;
      const lr = [d.swing > 0 ? hx : hx - L, hy - (d.hinge ? T : 0), L, T];
      ctx.fillRect(lr[0], lr[1], lr[2], lr[3]); ctx.strokeStyle = "rgba(0,0,0,0.6)"; ctx.lineWidth = 1; ctx.strokeRect(lr[0] + 0.5, lr[1] + 0.5, lr[2] - 1, lr[3] - 1);
    }
  };
  // Marca de puerta exterior sobre el techo (para verla desde fuera)
  D.doorMark = function (ctx, d) {
    const col = d.broken ? '#141210' : d.open ? '#1a1816' : (DOORC[d.mat] || DOORC.wood);
    ctx.fillStyle = col;
    ctx.fillRect(d.x - 1, d.y - 1, d.w + 2, d.h + 2);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    if (d.horiz) ctx.fillRect(d.x - 3, d.y - 1, 3, d.h + 2), ctx.fillRect(d.x + d.w, d.y - 1, 3, d.h + 2);
    else ctx.fillRect(d.x - 1, d.y - 3, d.w + 2, 3), ctx.fillRect(d.x - 1, d.y + d.h, d.w + 2, 3);
    if (d.barricade && !d.broken) { ctx.fillStyle = '#6a5038'; ctx.fillRect(d.cx - 4, d.cy - 4, 8, 8); }
  };

  // Cofres sueltos (sin mueble)
  D.looseChest = function (ctx, c) {
    const rng = new U.RNG((c.x * 13 + c.y * 7) | 0);
    ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(rng.range(-0.4, 0.4));
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(-10, -6, 24, 18);
    switch (c.container) {
      case 'mochila': ctx.fillStyle = '#3e4a32'; rrect(ctx, -10, -9, 20, 18, 6); ctx.fill(); ctx.fillStyle = '#2e3624'; ctx.fillRect(-7, -3, 14, 7); break;
      case 'maleta': ctx.fillStyle = '#4a2e24'; rrect(ctx, -13, -8, 26, 16, 3); ctx.fill(); ctx.fillStyle = '#2a1a14'; ctx.fillRect(-3, -10, 6, 3); break;
      case 'alijo enterrado': ctx.fillStyle = '#3a2e20'; ctx.beginPath(); ctx.ellipse(0, 0, 16, 11, 0, 0, TAU); ctx.fill(); ctx.strokeStyle = '#8a7a5a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-6, -6); ctx.lineTo(6, 6); ctx.moveTo(6, -6); ctx.lineTo(-6, 6); ctx.stroke(); break;
      case 'caja médica': ctx.fillStyle = '#c8c4b8'; ctx.fillRect(-11, -8, 22, 16); ctx.fillStyle = '#8a2a22'; ctx.fillRect(-2, -6, 4, 12); ctx.fillRect(-6, -2, 12, 4); break;
      case 'cofre militar': case 'cabina': ctx.fillStyle = '#434a34'; ctx.fillRect(-14, -8, 28, 16); ctx.fillStyle = '#2e3324'; ctx.fillRect(-14, -1, 28, 2); break;
      default: ctx.fillStyle = '#5a4630'; ctx.fillRect(-11, -11, 22, 22); ctx.strokeStyle = '#3a2c1c'; ctx.lineWidth = 2; ctx.strokeRect(-10, -10, 20, 20);
    }
    ctx.restore();
  };

  WG.Draw = D;
})();
