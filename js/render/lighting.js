// Iluminación: capa de oscuridad a baja resolución con luces recortadas, niebla y lluvia.
(function () {
  const U = TM.U;
  // Cuánto tapa la luz un obstáculo: 1 = sombra completa, 0.4 = sombra tenue, 0 = deja pasar.
  // Sólidos y opacos (muros, puertas, autos, contenedores, rocas, troncos, muebles altos, ventanas tapiadas) = 1;
  // vallas de alambre/madera = tenue; ventanas, cristal, rejas, muebles bajos, agua y barrancos = nada.
  const SOLID_KINDS = { car: 1, container: 1, truck: 1, bus: 1, dumpster: 1 };
  function lightBlock(o) {
    if (o.over) return 0;
    if (o.blocksSight) return 1;
    if (SOLID_KINDS[o.kind]) return 1;
    if (o.kind === 'window') return o.boarded ? 1 : 0;
    if (o.kind === 'fence') return 0.4;
    return 0;
  }

  function radialSprite(size, stops) {
    const c = U.makeCanvas(size, size), g = c.getContext('2d');
    const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    for (const [o, col] of stops) gr.addColorStop(o, col);
    g.fillStyle = gr; g.fillRect(0, 0, size, size);
    return c;
  }

  // Cono de linterna: origen en (0, S/2), apunta a +x, bordes suaves por capas.
  function coneSprite(S) {
    const c = U.makeCanvas(S, S), g = c.getContext('2d');
    const layers = 7;
    for (let i = 0; i < layers; i++) {
      const half = 0.2 + (i / (layers - 1)) * 0.3;
      g.save();
      g.beginPath();
      g.moveTo(0, S / 2);
      g.lineTo(S * Math.cos(half), S / 2 - S * Math.sin(half));
      g.arc(0, S / 2, S, -half, half);
      g.closePath();
      g.clip();
      const gr = g.createRadialGradient(0, S / 2, 0, 0, S / 2, S);
      gr.addColorStop(0, 'rgba(255,255,255,0.27)');
      gr.addColorStop(0.55, 'rgba(255,255,255,0.2)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, S, S);
      g.restore();
    }
    return c;
  }

  function fogSprite(S, seed) {
    const c = U.makeCanvas(S, S), g = c.getContext('2d');
    const img = g.createImageData(S, S), d = img.data;
    const P = 4;
    const wrapNoise = (x, y, per, sd) => {
      const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      const m = (v) => ((v % per) + per) % per;
      const a = U.hash2(m(ix), m(iy), sd), b = U.hash2(m(ix + 1), m(iy), sd);
      const cc = U.hash2(m(ix), m(iy + 1), sd), dd = U.hash2(m(ix + 1), m(iy + 1), sd);
      return a + (b - a) * sx + (cc - a) * sy + (a - b - cc + dd) * sx * sy;
    };
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        let v = 0, amp = 0.5, per = P, n = 0;
        for (let o = 0; o < 3; o++) { v += wrapNoise(x * per / S, y * per / S, per, seed + o) * amp; n += amp; amp *= 0.5; per *= 2; }
        v = U.smoothstep(0.35, 0.8, v / n);
        const i = (y * S + x) * 4;
        d[i] = 170; d[i + 1] = 175; d[i + 2] = 180; d[i + 3] = v * 255;
      }
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  class Lighting {
    constructor() {
      this.canvas = U.makeCanvas(8, 8);
      this.ctx = this.canvas.getContext('2d');
      // luz del jugador por separado para poder recortar sombras de obstáculos
      this.pcanvas = U.makeCanvas(8, 8);
      this.pctx = this.pcanvas.getContext('2d');
      this._obs = [];
      this.light = radialSprite(256, [[0, 'rgba(255,255,255,1)'], [0.4, 'rgba(255,255,255,0.7)'], [1, 'rgba(255,255,255,0)']]);
      this.warm = radialSprite(256, [[0, 'rgba(255,150,60,0.55)'], [0.35, 'rgba(255,110,40,0.22)'], [1, 'rgba(255,90,30,0)']]);
      this.cone = coneSprite(512);
      this.fogTex = fogSprite(256, 41);
      this.rain = [];
      this.fogT = 0;
      this.lightning = 0;
    }

    resize(cssW, cssH) {
      const s = TM.Config.preset.lightScale;
      this.scale = s;
      this.canvas.width = Math.max(8, Math.ceil(cssW * s));
      this.canvas.height = Math.max(8, Math.ceil(cssH * s));
      this.pcanvas.width = this.canvas.width;
      this.pcanvas.height = this.canvas.height;
      this.cssW = cssW; this.cssH = cssH;
      // gotas de lluvia en espacio de pantalla
      this.rain.length = 0;
      const n = TM.Config.preset.rainDrops;
      for (let i = 0; i < n; i++) this.rain.push({ x: Math.random() * cssW, y: Math.random() * cssH, l: U.randRange(10, 22), v: U.randRange(650, 900) });
      // viñeta
      this.vignette = U.makeCanvas(cssW, cssH);
      const vg = this.vignette.getContext('2d');
      const gr = vg.createRadialGradient(cssW / 2, cssH / 2, Math.min(cssW, cssH) * 0.35, cssW / 2, cssH / 2, Math.hypot(cssW, cssH) * 0.6);
      gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.6)');
      vg.fillStyle = gr; vg.fillRect(0, 0, cssW, cssH);
    }

    darknessColor(game) {
      const h = game.hour;
      // tono: noche azul muy oscuro, atardecer púrpura, día gris frío
      if (h >= 17.5 && h < 21) return [26, 14, 26];
      if (h >= 4.5 && h < 7) return [22, 16, 28];
      if (game.isNight) return [3, 5, 12];
      return [18, 24, 32];
    }

    // Dibuja la oscuridad y las luces sobre el contexto principal (ya en px CSS).
    render(main, game, cam) {
      const lc = this.ctx, s = this.scale;
      const W = this.canvas.width, H = this.canvas.height;
      const [r, g, b] = this.darknessColor(game);
      const rainDark = game.weather.rain * 0.12;
      const alpha = U.clamp(0.08 + game.darkness * 0.86 + rainDark - this.lightning * 0.6, 0, 0.96);
      lc.setTransform(1, 0, 0, 1, 0, 0);
      lc.globalCompositeOperation = 'source-over';
      lc.clearRect(0, 0, W, H);
      lc.fillStyle = `rgba(${r},${g},${b},${alpha})`;
      lc.fillRect(0, 0, W, H);

      // mundo -> píxeles de la capa de luz
      const k = cam.zoom * s;
      const ox = -(cam.x - cam.viewW / 2) * k, oy = -(cam.y - cam.viewH / 2) * k;
      lc.setTransform(k, 0, 0, k, ox, oy);
      // interiores más oscuros que la calle (solo el edificio donde está el jugador, cuyo techo se ha desvanecido)
      const ind = game.world && game.world.indoorShade ? game.world.indoorShade() : null;
      const indoorK = ind ? ind.k : 0;
      if (indoorK > 0.01) {
        lc.fillStyle = `rgba(${r},${g},${b},${(TM.Config.WORLD.INDOOR_DARK * indoorK).toFixed(3)})`;
        lc.fillRect(ind.x, ind.y, ind.w, ind.h);
      }
      lc.globalCompositeOperation = 'destination-out';

      const p = game.player;
      const night = game.darkness;
      // --- luz del jugador (ambiente + linterna) con sombras de obstáculos ---
      const pc = this.pctx;
      pc.setTransform(1, 0, 0, 1, 0, 0);
      pc.globalCompositeOperation = 'source-over';
      pc.clearRect(0, 0, W, H);
      pc.setTransform(k, 0, 0, k, ox, oy);
      const amb = p.flashlightOn ? 85 : 60;
      this.blit(pc, this.light, p.x, p.y, amb, p.flashlightOn ? 0.68 : 0.4);
      let L = 0;
      if (p.flashlightOn && p.alive) {
        L = 300 + night * 140;
        const flick = 0.96 + Math.random() * 0.04;
        pc.save();
        pc.translate(p.x, p.y);
        pc.rotate(p.aimAngle);
        pc.globalAlpha = flick;
        pc.drawImage(this.cone, 4, -L / 2, L, L);
        pc.restore();
      }
      pc.globalAlpha = 1;
      if (alpha > 0.25 || indoorK > 0.2) this.castShadows(pc, game, p.x, p.y, Math.max(L, amb) + 20, p.flashlightOn ? p.aimAngle : null, amb);
      lc.setTransform(1, 0, 0, 1, 0, 0);
      lc.drawImage(this.pcanvas, 0, 0);
      lc.setTransform(k, 0, 0, k, ox, oy);

      // luces de chunks (fuego), luces temporales y de frame
      for (const L of game.frameLights) this.blit(lc, this.light, L.x, L.y, L.radius, L.intensity);
      for (const L of game.fx.lights) this.blit(lc, this.light, L.x, L.y, L.radius, L.intensity * (L.life / L.max));
      lc.globalAlpha = 1;
      lc.globalCompositeOperation = 'source-over';

      main.drawImage(this.canvas, 0, 0, this.cssW, this.cssH);
    }

    castShadows(pc, game, lx, ly, range, aim, amb) {
      const obs = this._obs; obs.length = 0;
      game.world.queryObstacles(lx - range, ly - range, lx + range, ly + range, obs);
      // descarta obstáculos fuera de la zona iluminada (cono + círculo ambiente): su sombra no la toca
      if (aim !== null && aim !== undefined) {
        const half = 0.62, amb2 = (amb + 6) * (amb + 6);
        let n = 0;
        for (let i = 0; i < obs.length; i++) {
          const o = obs[i];
          if (!lightBlock(o)) continue;
          let keep = false;
          if (o.shape === 'rect') {
            const qx = U.clamp(lx, o.x, o.x + o.w), qy = U.clamp(ly, o.y, o.y + o.h);
            if ((qx - lx) * (qx - lx) + (qy - ly) * (qy - ly) < amb2) keep = true;
            else {
              let pos = 0, neg = 0;
              const cs = [o.x, o.y, o.x + o.w, o.y, o.x, o.y + o.h, o.x + o.w, o.y + o.h];
              for (let c = 0; c < 8; c += 2) {
                const d = U.angDiff(aim, Math.atan2(cs[c + 1] - ly, cs[c] - lx));
                if (Math.abs(d) <= half) { keep = true; break; }
                if (d > 0) pos++; else neg++;
              }
              // esquinas a ambos lados del cono: el rectángulo lo cruza
              if (!keep && pos && neg) keep = true;
            }
          } else keep = true;
          if (keep) obs[n++] = o;
        }
        obs.length = n;
      }
      const FAR = 1600;
      pc.globalCompositeOperation = 'destination-out';
      pc.fillStyle = '#fff';
      pc.beginPath();
      const quad = (ax, ay, bx, by) => {
        let dax = ax - lx, day = ay - ly, dbx = bx - lx, dby = by - ly;
        const da = Math.hypot(dax, day) || 1, db = Math.hypot(dbx, dby) || 1;
        const fax = ax + (dax / da) * FAR, fay = ay + (day / da) * FAR;
        const fbx = bx + (dbx / db) * FAR, fby = by + (dby / db) * FAR;
        // mismo sentido de giro para todos (regla nonzero = unión)
        const cross = dax * dby - day * dbx;
        if (cross < 0) { pc.moveTo(ax, ay); pc.lineTo(bx, by); pc.lineTo(fbx, fby); pc.lineTo(fax, fay); }
        else { pc.moveTo(bx, by); pc.lineTo(ax, ay); pc.lineTo(fax, fay); pc.lineTo(fbx, fby); }
        pc.closePath();
      };
      const drawSet = (soft) => {
      pc.beginPath();
      for (const o of obs) {
        const lb = lightBlock(o);
        if (!lb || (lb < 1) !== soft) continue;
        if (o.shape === 'rect') {
          const x0 = o.x, y0 = o.y, x1 = o.x + o.w, y1 = o.y + o.h;
          // solo los bordes que dan a la luz bastan para la silueta
          if (ly < y0) quad(x0, y0, x1, y0);
          if (ly > y1) quad(x1, y1, x0, y1);
          if (lx < x0) quad(x0, y1, x0, y0);
          if (lx > x1) quad(x1, y0, x1, y1);
          if (!SOLID_KINDS[o.kind] && o.kind !== 'fence') pc.rect(x0, y0, o.w, o.h); // el auto se ilumina por encima
        } else {
          // círculo: segmento entre las dos tangentes
          const dx = o.cx - lx, dy = o.cy - ly, d = Math.hypot(dx, dy);
          if (d <= o.r + 1) continue;
          const back = Math.atan2(-dy, -dx), h = Math.acos(o.r / d);
          quad(o.cx + Math.cos(back - h) * o.r, o.cy + Math.sin(back - h) * o.r,
               o.cx + Math.cos(back + h) * o.r, o.cy + Math.sin(back + h) * o.r);
          if (!SOLID_KINDS[o.kind]) { pc.moveTo(o.cx + o.r, o.cy); pc.arc(o.cx, o.cy, o.r, 0, Math.PI * 2); }
        }
      }
      pc.fill();
      };
      drawSet(false);
      pc.globalAlpha = 0.4; drawSet(true); pc.globalAlpha = 1;
      pc.globalCompositeOperation = 'source-over';
    }

    blit(lc, spr, x, y, radius, intensity) {
      lc.globalAlpha = U.clamp(intensity, 0, 1);
      lc.drawImage(spr, x - radius, y - radius, radius * 2, radius * 2);
    }

    // Brillo cálido aditivo (fuego, fogonazos) en coordenadas de mundo
    warmGlow(ctx, x, y, radius, a) {
      ctx.globalAlpha = U.clamp(a, 0, 1);
      ctx.drawImage(this.warm, x - radius, y - radius, radius * 2, radius * 2);
      ctx.globalAlpha = 1;
    }

    // Niebla en espacio de pantalla (px CSS). Va debajo de la capa de oscuridad.
    fog(ctx, game, cam, dt) {
      const W = this.cssW, H = this.cssH;
      const fog = U.clamp(game.weather.fog * 0.5 + 0.06, 0, 0.6);
      this.fogT += dt;
      if (fog > 0.02) {
        const S = 256 * 2.2 * cam.zoom;
        const layers = TM.Config.quality === 'low' ? 1 : 2;
        for (let l = 0; l < layers; l++) {
          const par = l === 0 ? 1 : 0.7;
          const drift = this.fogT * (l === 0 ? 9 : -6);
          let ox = (-(cam.x * par + drift) * cam.zoom) % S, oy = (-(cam.y * par + drift * 0.4) * cam.zoom) % S;
          if (ox > 0) ox -= S; if (oy > 0) oy -= S;
          ctx.globalAlpha = fog * (l === 0 ? 0.6 : 0.45);
          for (let y = oy; y < H; y += S) for (let x = ox; x < W; x += S) ctx.drawImage(this.fogTex, x, y, S + 1, S + 1);
        }
        ctx.globalAlpha = 1;
      }
    }

    // Lluvia y relámpagos (encima de todo)
    weather(ctx, game, cam, dt) {
      const W = this.cssW, H = this.cssH;
      const rain = game.weather.rain;
      if (rain > 0.03) {
        const n = Math.floor(this.rain.length * rain);
        ctx.strokeStyle = `rgba(170,185,200,${0.18 + rain * 0.2})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const d = this.rain[i];
          d.y += d.v * dt; d.x -= d.v * 0.18 * dt;
          if (d.y > H) { d.y = -20; d.x = Math.random() * (W + 100); }
          if (d.x < -20) d.x = W + 10;
          ctx.moveTo(d.x, d.y); ctx.lineTo(d.x - d.l * 0.18, d.y + d.l);
        }
        ctx.stroke();
        // salpicaduras
        ctx.fillStyle = `rgba(170,185,200,${0.12 * rain})`;
        for (let i = 0; i < n * 0.25; i++) ctx.fillRect(Math.random() * W, Math.random() * H, 2, 1);
      }
      if (this.lightning > 0) {
        ctx.fillStyle = `rgba(200,210,230,${this.lightning * 0.25})`;
        ctx.fillRect(0, 0, W, H);
        this.lightning = Math.max(0, this.lightning - dt * 3);
      }
    }
  }

  TM.Lighting = Lighting;
})();
