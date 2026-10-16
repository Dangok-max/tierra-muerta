// Efectos: partículas, trazadoras, destellos, ondas, textos flotantes y luces temporales.
(function () {
  const U = TM.U;

  class FX {
    constructor(game) {
      this.game = game;
      this.parts = [];
      this.tracers = [];
      this.flashes = [];
      this.rings = [];
      this.texts = [];
      this.lights = [];
      this.swipes = [];
      this.bloodPaintBudget = 0;
    }

    max() { return TM.Config.preset.particles; }

    add(p) {
      if (this.parts.length >= this.max()) this.parts.shift();
      this.parts.push(p);
      return p;
    }

    blood(x, y, dx, dy, n) {
      n = Math.min(n || 6, 14);
      for (let i = 0; i < n; i++) {
        const a = Math.atan2(dy || 0, dx || 0) + U.randRange(-0.7, 0.7);
        const s = U.randRange(40, 170);
        this.add({
          type: 'blood', x, y, z: U.randRange(6, 14), vx: Math.cos(a) * s, vy: Math.sin(a) * s,
          vz: U.randRange(20, 90), life: 1.6, max: 1.6, size: U.randRange(1.2, 2.8), landed: false,
        });
      }
    }

    acid(x, y, n) {
      for (let i = 0; i < (n || 6); i++) {
        const a = U.randRange(0, Math.PI * 2), s = U.randRange(20, 90);
        this.add({ type: 'acid', x, y, z: 4, vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: U.randRange(20, 60), life: 1.2, max: 1.2, size: U.randRange(1.5, 3), landed: false });
      }
    }

    dust(x, y, n) {
      for (let i = 0; i < (n || 4); i++) {
        const a = U.randRange(0, Math.PI * 2), s = U.randRange(5, 30);
        this.add({ type: 'dust', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.8, max: 0.8, size: U.randRange(4, 9) });
      }
    }

    spark(x, y, dx, dy, n) {
      for (let i = 0; i < (n || 5); i++) {
        const a = Math.atan2(dy, dx) + U.randRange(-1, 1), s = U.randRange(80, 260);
        this.add({ type: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.22, max: 0.22, size: 1 });
      }
    }

    shell(x, y, ang) {
      const a = ang + Math.PI / 2 + U.randRange(-0.3, 0.3), s = U.randRange(60, 110);
      this.add({ type: 'shell', x, y, z: 10, vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: 60, life: 4, max: 4, rot: U.randRange(0, 6), landed: false });
    }

    tracer(x0, y0, x1, y1) { this.tracers.push({ x0, y0, x1, y1, life: 0.07, max: 0.07 }); }
    muzzle(x, y, ang) { this.flashes.push({ x, y, ang, life: 0.05, max: 0.05 }); }
    ring(x, y, radius, color, duration) { this.rings.push({ x, y, radius, color: color || 'rgba(220,200,160,0.6)', life: duration || 0.8, max: duration || 0.8 }); }
    floatText(x, y, text, color) { this.texts.push({ x, y, text, color: color || '#ddd', life: 1.1, max: 1.1 }); }
    light(x, y, radius, intensity, duration) { this.lights.push({ x, y, radius, intensity, life: duration, max: duration }); }
    swipe(x, y, ang) { this.swipes.push({ x, y, ang, life: 0.16, max: 0.16 }); }

    update(dt) {
      const g = this.game;
      this.bloodPaintBudget = Math.min(6, this.bloodPaintBudget + dt * 12);
      const ps = this.parts;
      for (let i = ps.length - 1; i >= 0; i--) {
        const p = ps[i];
        p.life -= dt;
        if (p.life <= 0) { ps.splice(i, 1); continue; }
        if (p.type === 'blood' || p.type === 'acid' || p.type === 'shell') {
          if (!p.landed) {
            p.x += p.vx * dt; p.y += p.vy * dt;
            p.vz -= 320 * dt; p.z += p.vz * dt;
            if (p.z <= 0) {
              if (p.type === 'shell' && Math.abs(p.vz) > 40) { p.vz = -p.vz * 0.35; p.z = 0.1; p.vx *= 0.5; p.vy *= 0.5; }
              else {
                p.z = 0; p.landed = true;
                if (p.type === 'blood' && this.bloodPaintBudget > 1 && U.chance(0.35)) {
                  this.bloodPaintBudget -= 1;
                  g.world.paintBlood(p.x, p.y, p.size * 1.3, 0.55);
                  p.life = Math.min(p.life, 0.2);
                }
              }
            }
            if (p.type === 'shell') p.rot += dt * 14;
          }
        } else {
          p.x += p.vx * dt; p.y += p.vy * dt;
          p.vx *= 0.92; p.vy *= 0.92;
        }
      }
      const tick = (arr) => { for (let i = arr.length - 1; i >= 0; i--) { arr[i].life -= dt; if (arr[i].life <= 0) arr.splice(i, 1); } };
      tick(this.tracers); tick(this.flashes); tick(this.rings); tick(this.lights); tick(this.swipes);
      for (let i = this.texts.length - 1; i >= 0; i--) {
        const t = this.texts[i]; t.life -= dt; t.y -= 22 * dt;
        if (t.life <= 0) this.texts.splice(i, 1);
      }
    }

    // Capa de mundo (antes de la oscuridad)
    draw(ctx, cam) {
      for (const p of this.parts) {
        if (!cam.inView(p.x, p.y, 20)) continue;
        const a = U.clamp(p.life / p.max * 2, 0, 1);
        switch (p.type) {
          case 'blood':
            ctx.fillStyle = `rgba(110,10,10,${a})`;
            ctx.beginPath(); ctx.arc(p.x, p.y - p.z, p.size, 0, Math.PI * 2); ctx.fill();
            break;
          case 'acid':
            ctx.fillStyle = `rgba(140,190,40,${a})`;
            ctx.beginPath(); ctx.arc(p.x, p.y - p.z, p.size, 0, Math.PI * 2); ctx.fill();
            break;
          case 'dust': {
            const k = 1 - p.life / p.max;
            ctx.fillStyle = `rgba(120,112,100,${0.35 * (1 - k)})`;
            ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1 + k * 1.5), 0, Math.PI * 2); ctx.fill();
            break;
          }
          case 'shell':
            ctx.save(); ctx.translate(p.x, p.y - p.z); ctx.rotate(p.rot);
            ctx.fillStyle = `rgba(190,150,70,${a})`; ctx.fillRect(-2.2, -1, 4.4, 2);
            ctx.restore();
            break;
        }
      }
      for (const s of this.swipes) {
        const k = 1 - s.life / s.max;
        ctx.strokeStyle = `rgba(230,220,200,${0.35 * (1 - k)})`;
        ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(s.x, s.y, 28 + k * 16, s.ang - 0.9, s.ang + 0.9); ctx.stroke();
      }
    }

    // Capa luminosa (después de la oscuridad): chispas, fogonazos, trazadoras
    drawGlow(ctx) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const t of this.tracers) {
        const a = t.life / t.max;
        ctx.strokeStyle = `rgba(255,220,150,${0.7 * a})`;
        ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(t.x0, t.y0); ctx.lineTo(t.x1, t.y1); ctx.stroke();
      }
      for (const f of this.flashes) {
        const a = f.life / f.max;
        ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(f.ang);
        ctx.fillStyle = `rgba(255,200,110,${0.9 * a})`;
        ctx.beginPath(); ctx.moveTo(0, -4); ctx.lineTo(18, 0); ctx.lineTo(0, 4); ctx.closePath(); ctx.fill();
        ctx.fillStyle = `rgba(255,240,200,${a})`;
        ctx.beginPath(); ctx.arc(2, 0, 4, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
      for (const p of this.parts) {
        if (p.type !== 'spark') continue;
        const a = p.life / p.max;
        ctx.strokeStyle = `rgba(255,200,120,${a})`;
        ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03); ctx.stroke();
      }
      ctx.restore();
      for (const r of this.rings) {
        const k = 1 - r.life / r.max;
        ctx.strokeStyle = r.color;
        ctx.globalAlpha = 1 - k;
        ctx.lineWidth = 3 + 6 * (1 - k);
        ctx.beginPath(); ctx.arc(r.x, r.y, r.radius * (0.15 + 0.85 * k), 0, Math.PI * 2); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      if (this.texts.length) {
        ctx.font = 'bold 11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        for (const t of this.texts) {
          ctx.globalAlpha = U.clamp(t.life / t.max * 2, 0, 1);
          ctx.fillStyle = '#000'; ctx.fillText(t.text, t.x + 1, t.y + 1);
          ctx.fillStyle = t.color; ctx.fillText(t.text, t.x, t.y);
        }
        ctx.globalAlpha = 1;
      }
    }

    clear() {
      this.parts.length = 0; this.tracers.length = 0; this.flashes.length = 0;
      this.rings.length = 0; this.texts.length = 0; this.lights.length = 0; this.swipes.length = 0;
    }
  }

  TM.FX = FX;
})();
