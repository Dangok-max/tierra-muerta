// Cámara y renderizador principal.
(function () {
  const U = TM.U;
  const CH = TM.Config.CHUNK;

  class Camera {
    constructor() {
      this.x = 0; this.y = 0; this.zoom = 1;
      this.viewW = 800; this.viewH = 430;
      this.shakeX = 0; this.shakeY = 0;
    }
    inView(x, y, m) {
      m = m || 0;
      return x > this.x - this.viewW / 2 - m && x < this.x + this.viewW / 2 + m &&
             y > this.y - this.viewH / 2 - m && y < this.y + this.viewH / 2 + m;
    }
    update(dt, p, shake) {
      let tx = p.x, ty = p.y;
      // mirar hacia donde se apunta / avanza
      if (p.aiming || p.aimHold > 0) { tx += Math.cos(p.aimAngle) * 60; ty += Math.sin(p.aimAngle) * 45; }
      else { tx += p.vx * 0.22; ty += p.vy * 0.18; }
      const k = Math.min(1, 5 * dt);
      this.x += (tx - this.x) * k;
      this.y += (ty - this.y) * k;
      this.shakeX = (Math.random() - 0.5) * shake * 2;
      this.shakeY = (Math.random() - 0.5) * shake * 2;
    }
    snap(p) { this.x = p.x; this.y = p.y; }
  }

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { alpha: false });
      this.lighting = new TM.Lighting();
      this.dynScale = 1;
      this.drawList = [];
    }

    resize(camera) {
      const cssW = window.innerWidth, cssH = window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, TM.Config.preset.dpr) * this.dynScale;
      this.dpr = dpr;
      this.cssW = cssW; this.cssH = cssH;
      this.canvas.width = Math.round(cssW * dpr);
      this.canvas.height = Math.round(cssH * dpr);
      this.canvas.style.width = cssW + 'px';
      this.canvas.style.height = cssH + 'px';
      camera.zoom = cssH / TM.Config.VIEW_HEIGHT;
      // en pantallas muy anchas, mostrar algo más de mundo vertical
      if (cssW / cssH > 2.1) camera.zoom *= 0.94;
      camera.viewW = cssW / camera.zoom;
      camera.viewH = cssH / camera.zoom;
      this.lighting.resize(cssW, cssH);
      TM.Input.layoutButtons(cssW, cssH);
    }

    worldTransform(cam) {
      const s = this.dpr * cam.zoom;
      const ox = -(cam.x + cam.shakeX - cam.viewW / 2) * s;
      const oy = -(cam.y + cam.shakeY - cam.viewH / 2) * s;
      this.ctx.setTransform(s, 0, 0, s, Math.round(ox), Math.round(oy));
    }

    render(game, dt) {
      const ctx = this.ctx, cam = game.camera, t = game.time;
      this.frame = (this.frame || 0) + 1;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#121211';
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

      // --- suelo pre-renderizado ---
      const margin = 40;
      const vis = game.world.prepareView(cam.x - cam.viewW / 2 - margin, cam.y - cam.viewH / 2 - margin,
        cam.x + cam.viewW / 2 + margin, cam.y + cam.viewH / 2 + margin, this.frame, game.bakeBudget);
      // pre-hornear poco a poco los chunks alrededor de la vista (sin tirones)
      game.world.prefetch(cam.x - cam.viewW / 2 - 420, cam.y - cam.viewH / 2 - 420,
        cam.x + cam.viewW / 2 + 420, cam.y + cam.viewH / 2 + 420, this.frame - 1);
      for (const ch of vis) ch.lastUsed = this.frame;
      game.world.bakeTick(game.state === 'play' ? 2.5 : 4);

      this.worldTransform(cam);
      ctx.imageSmoothingEnabled = true;
      for (const ch of vis) {
        if (ch.ready) ctx.drawImage(ch.canvas, ch.x0, ch.y0, CH + 0.6, CH + 0.6);
      }

      // --- objetos dinámicos (fuego) ---
      for (const ch of vis) {
        for (const d of ch.dyn) {
          if (d.kind === 'fire') {
            const f = 0.85 + Math.sin(t * 13) * 0.05 + Math.sin(t * 7.3) * 0.06 + Math.random() * 0.05;
            game.frameLights.push({ x: d.x, y: d.y, radius: 250 * f, intensity: 0.95 });
            this.drawFire(ctx, d.x, d.y, t);
          }
        }
      }

      // --- partículas de suelo ---
      game.fx.draw(ctx, cam);

      // --- entidades ordenadas por y (cadáveres primero) ---
      const list = this.drawList; list.length = 0;
      for (const z of game.zombies) if (cam.inView(z.x, z.y, 60)) list.push(z);
      if (game.state !== 'menu') list.push(game.player);
      list.sort((a, b) => ((a.dead ? -1e6 : 0) + a.y) - ((b.dead ? -1e6 : 0) + b.y));
      for (const e of list) e.draw(ctx, t);

      // --- niebla, oscuridad y luces (en px CSS) ---
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.lighting.fog(ctx, game, cam, dt);
      this.lighting.render(ctx, game, cam);

      // --- capa luminosa en mundo ---
      this.worldTransform(cam);
      ctx.globalCompositeOperation = 'lighter';
      for (const L of game.frameLights) this.lighting.warmGlow(ctx, L.x, L.y, L.radius * 0.8, 0.5);
      for (const L of game.fx.lights) this.lighting.warmGlow(ctx, L.x, L.y, L.radius * 0.5, 0.35 * L.life / L.max);
      ctx.globalCompositeOperation = 'source-over';
      for (const e of list) if (e.drawGlow) e.drawGlow(ctx, t);
      game.fx.drawGlow(ctx);
      // mira láser al apuntar
      if (game.player.alive && TM.Input.aim.active) this.drawLaser(ctx, game);

      // --- clima, viñeta (px CSS) ---
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.lighting.weather(ctx, game, cam, dt);
      ctx.drawImage(this.lighting.vignette, 0, 0, this.cssW, this.cssH);

      // --- HUD y controles ---
      if (game.state !== 'menu') game.hud.draw(ctx, this.cssW, this.cssH, dt);
      game.frameLights.length = 0;
    }

    drawFire(ctx, x, y, t) {
      for (let i = 0; i < 5; i++) {
        const a = t * 3 + i * 1.3;
        const r = 5 + Math.sin(a * 2.1) * 1.5;
        const ox = Math.sin(a) * 3, oy = Math.cos(a * 1.3) * 3 - 2;
        ctx.fillStyle = i < 2 ? 'rgba(255,120,30,0.85)' : 'rgba(255,200,90,0.8)';
        ctx.beginPath(); ctx.arc(x + ox, y + oy, r * (i < 2 ? 1.4 : 0.8), 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = '#2a1a10';
      ctx.fillRect(x - 9, y - 2, 18, 4);
      ctx.fillRect(x - 2, y - 9, 4, 18);
    }

    drawLaser(ctx, game) {
      const p = game.player;
      const dx = Math.cos(p.aimAngle), dy = Math.sin(p.aimAngle);
      const L = 420;
      const t = game.world.raycast(p.x, p.y, p.x + dx * L, p.y + dy * L);
      const ex = p.x + dx * L * t, ey = p.y + dy * L * t;
      const g = ctx.createLinearGradient(p.x, p.y, ex, ey);
      const firing = TM.Input.fire;
      g.addColorStop(0, firing ? 'rgba(255,90,60,0.5)' : 'rgba(255,90,60,0.32)');
      g.addColorStop(1, 'rgba(255,90,60,0)');
      ctx.strokeStyle = g;
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(p.x + dx * 24, p.y + dy * 24); ctx.lineTo(ex, ey); ctx.stroke();
    }
  }

  TM.Camera = Camera;
  TM.Renderer = Renderer;
})();
