// HUD en canvas: vida, estamina, munición, reloj, avisos, indicadores y controles táctiles.
(function () {
  const U = TM.U;
  const FONT = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';

  class HUD {
    constructor(game) {
      this.game = game;
      this.notes = [];
      this.hits = [];
      this.lowPulse = 0;
      this.fps = 60;
      this.fpsAcc = 0; this.fpsN = 0;
      this.tutT = 0;
    }

    // Guía visual de los pulgares en la primera partida
    showTutorial(sec) { this.tutT = sec; }

    notify(text, color) {
      // evita repetir el mismo aviso seguido
      if (this.notes.length && this.notes[this.notes.length - 1].text === text) return;
      this.notes.push({ text, color: color || '#e0b060', life: 4.2, max: 4.2 });
      if (this.notes.length > 4) this.notes.shift();
      if (TM.Audio) TM.Audio.play('ui_notify');
    }

    hitFrom(angle) {
      this.hits.push({ a: angle, life: 1, max: 1 });
      if (this.hits.length > 6) this.hits.shift();
    }

    draw(ctx, W, H, dt) {
      const g = this.game, p = g.player, In = TM.Input;
      const s = In.s;
      this.lastDt = dt;
      // fps
      this.fpsAcc += dt; this.fpsN++;
      if (this.fpsAcc > 0.5) { this.fps = this.fpsN / this.fpsAcc; this.fpsAcc = 0; this.fpsN = 0; }

      // viñeta roja por daño / vida baja
      const hpk = p.hp / p.maxHp;
      this.lowPulse += dt * (hpk < 0.3 ? 4 : 2);
      let red = p.hurtFlash * 0.45;
      if (hpk < 0.3 && p.alive) red = Math.max(red, (0.18 + Math.sin(this.lowPulse) * 0.1) * (1 - hpk / 0.3));
      if (red > 0.01) {
        const gr = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, Math.hypot(W, H) * 0.6);
        gr.addColorStop(0, 'rgba(120,0,0,0)'); gr.addColorStop(1, `rgba(140,0,0,${red})`);
        ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
      }

      // indicadores de dirección de golpe
      for (let i = this.hits.length - 1; i >= 0; i--) {
        const h = this.hits[i]; h.life -= dt;
        if (h.life <= 0) { this.hits.splice(i, 1); continue; }
        const ps = g.worldToScreen(p.x, p.y);
        ctx.strokeStyle = `rgba(220,40,30,${h.life / h.max * 0.8})`;
        ctx.lineWidth = 5;
        ctx.beginPath(); ctx.arc(ps.x, ps.y, 46, h.a - 0.45, h.a + 0.45); ctx.stroke();
      }

      this.drawTopLeft(ctx, g, p, s);
      this.drawClock(ctx, g, W, s);
      this.drawNotes(ctx, W, H, dt, s);
      this.drawAmmo(ctx, g, W, s);
      this.drawCampArrow(ctx, g, W, H);
      if (p.alive && In.enabled) this.drawControls(ctx, In, p, g);

      if (TM.Config.DEBUG) {
        ctx.font = `11px ${FONT}`; ctx.textAlign = 'left'; ctx.fillStyle = '#9f9';
        const lines = [`FPS ${this.fps.toFixed(0)}  trabajo ${g.perfInfo.work.toFixed(1)}ms  dpr ${g.renderer.dpr.toFixed(2)}  zombies ${g.zombies.length}`,
          `pos ${p.x.toFixed(0)},${p.y.toFixed(0)}  bioma ${g.world.biomeAt(p.x, p.y)}`];
        if (g.director && g.director.debugText) lines.push(...g.director.debugText());
        lines.forEach((l, i) => ctx.fillText(l, 10, H - 80 + i * 13));
      }
    }

    bar(ctx, x, y, w, h, k, col, back) {
      ctx.fillStyle = back || 'rgba(0,0,0,0.55)';
      ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
      ctx.fillStyle = col;
      ctx.fillRect(x, y, w * U.clamp(k, 0, 1), h);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(x, y, w * U.clamp(k, 0, 1), Math.max(1, h * 0.35));
    }

    drawTopLeft(ctx, g, p, s) {
      const x = 14, y = 12;
      const w = U.clamp(s * 3.2, 120, 190);
      ctx.textAlign = 'left';
      ctx.font = `600 ${Math.round(s * 0.26)}px ${FONT}`;
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillText(p.name.toUpperCase(), x + 1, y + 11);
      ctx.fillStyle = '#d8d2c4'; ctx.fillText(p.name.toUpperCase(), x, y + 10);
      const hpk = p.hp / p.maxHp;
      this.bar(ctx, x, y + 16, w, 9, hpk, hpk < 0.3 ? '#c0281e' : '#9c2a22');
      this.bar(ctx, x, y + 29, w * 0.75, 4, p.stamina / p.maxStamina, p.sprinting ? '#d8c890' : '#a89c70');
      ctx.font = `${Math.round(s * 0.22)}px ${FONT}`;
      ctx.fillStyle = 'rgba(210,200,180,0.75)';
      const kills = g.totalKills();
      const km = (Math.hypot(p.x, p.y) / TM.Config.UNITS_PER_M / 1000).toFixed(2);
      ctx.fillText(`☠ ${kills}    ⌖ ${km} km`, x, y + 48);
    }

    drawClock(ctx, g, W, s) {
      const h = Math.floor(g.hour), m = Math.floor((g.hour - h) * 60 / 10) * 10;
      const txt = `DÍA ${g.day}   ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      ctx.textAlign = 'center';
      ctx.font = `700 ${Math.round(s * 0.32)}px ${FONT}`;
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillText(txt, W / 2 + 1, 25);
      ctx.fillStyle = g.isNight ? '#a8b4d0' : '#e0d6c0';
      ctx.fillText(txt, W / 2, 24);
      // sol / luna
      const ix = W / 2 - ctx.measureText(txt).width / 2 - 14;
      if (g.isNight) {
        ctx.fillStyle = '#c8d0e8'; ctx.beginPath(); ctx.arc(ix, 19, 6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#121418'; ctx.beginPath(); ctx.arc(ix + 3, 17, 5.5, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.fillStyle = '#e8c070'; ctx.beginPath(); ctx.arc(ix, 19, 5, 0, Math.PI * 2); ctx.fill();
      }
      if (g.director && g.director.stageInfo) {
        const st = g.director.stageInfo();
        ctx.font = `600 ${Math.max(11, Math.round(s * 0.24))}px ${FONT}`;
        ctx.fillStyle = 'rgba(210,130,110,0.8)';
        ctx.fillText(st.name.toUpperCase(), W / 2, 26 + s * 0.32);
      }
    }

    drawNotes(ctx, W, H, dt, s) {
      let y = 30 + s * 1.0;
      for (let i = this.notes.length - 1; i >= 0; i--) {
        const n = this.notes[i];
        n.life -= dt;
        if (n.life <= 0) { this.notes.splice(i, 1); continue; }
      }
      ctx.textAlign = 'center';
      ctx.font = `700 ${Math.round(s * 0.3)}px ${FONT}`;
      for (const n of this.notes) {
        const k = n.life / n.max;
        const a = Math.min(1, (1 - k) * 8, k * 4);
        ctx.globalAlpha = a;
        const tw = ctx.measureText(n.text).width;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(W / 2 - tw / 2 - 12, y - s * 0.3, tw + 24, s * 0.44);
        ctx.fillStyle = n.color;
        ctx.fillText(n.text, W / 2, y);
        y += s * 0.52;
      }
      ctx.globalAlpha = 1;
    }

    drawAmmo(ctx, g, W, s) {
      const c = g.combat;
      const x = W - s * 1.45, y = s * 0.82;
      ctx.textAlign = 'right';
      ctx.font = `700 ${Math.round(s * 0.36)}px ${FONT}`;
      const txt = c.reloading ? 'RECARGANDO' : `${c.mag}`;
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillText(txt, x + 1, y + 1);
      ctx.fillStyle = c.mag === 0 || c.reloading ? '#d06040' : '#e0d6c0';
      ctx.fillText(txt, x, y);
      if (!c.reloading) {
        ctx.font = `${Math.round(s * 0.22)}px ${FONT}`;
        ctx.fillStyle = 'rgba(200,190,170,0.6)';
        ctx.fillText(`/ ${c.weapon.magSize}  ${c.weapon.name.toUpperCase()}`, x, y + s * 0.3);
      } else {
        const k = 1 - c.reloadT / c.weapon.reloadTime;
        this.bar(ctx, x - s * 1.9, y + s * 0.15, s * 1.9, 3, k, '#d0a050');
      }
    }

    drawCampArrow(ctx, g, W, H) {
      const p = g.player;
      const d = Math.hypot(p.x, p.y);
      if (d < 700 || !p.alive) return;
      const a = Math.atan2(-p.y, -p.x);
      const cx = W / 2, cy = H / 2;
      const R = Math.min(W, H) * 0.42;
      const x = cx + Math.cos(a) * R;
      // no tapar el reloj ni los avisos de arriba
      const y = Math.max(H * 0.36, cy + Math.sin(a) * R);
      ctx.save(); ctx.translate(x, y); ctx.rotate(a);
      ctx.fillStyle = 'rgba(230,170,80,0.7)';
      ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(-6, -7); ctx.lineTo(-3, 0); ctx.lineTo(-6, 7); ctx.closePath(); ctx.fill();
      ctx.restore();
      ctx.font = `10px ${FONT}`; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(230,190,120,0.7)';
      ctx.fillText(`campamento ${Math.round(d / TM.Config.UNITS_PER_M)} m`, x, y + 18);
    }

    drawStick(ctx, st, home, active, fireRing, sprintRing) {
      const bx = active ? st.bx : home.x, by = active ? st.by : home.y;
      if (sprintRing && active) {
        const run = TM.Input.move.sprint;
        ctx.strokeStyle = run ? 'rgba(232,200,120,0.75)' : 'rgba(220,210,190,0.18)';
        ctx.lineWidth = run ? 3 : 1.5;
        ctx.setLineDash([3, 6]);
        ctx.beginPath(); ctx.arc(bx, by, st.R * TM.Input.SPRINT_RATIO, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
        if (run) {
          ctx.font = `700 11px ${FONT}`; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(232,200,120,0.85)';
          ctx.fillText('CORRIENDO', bx, by - st.R * TM.Input.SPRINT_RATIO - 6);
        }
      }
      const kx = active ? st.kx : home.x, ky = active ? st.ky : home.y;
      ctx.globalAlpha = active ? 1 : 0.45;
      ctx.fillStyle = 'rgba(20,20,20,0.35)';
      ctx.beginPath(); ctx.arc(bx, by, st.R, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(220,210,190,0.25)'; ctx.lineWidth = 2;
      ctx.stroke();
      if (fireRing) {
        ctx.strokeStyle = 'rgba(210,80,60,0.35)'; ctx.setLineDash([4, 5]);
        ctx.beginPath(); ctx.arc(bx, by, st.R * TM.Input.FIRE_THRESHOLD, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.fillStyle = fireRing && TM.Input.fire ? 'rgba(220,90,60,0.7)' : 'rgba(220,210,190,0.45)';
      ctx.beginPath(); ctx.arc(kx, ky, st.R * 0.42, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }

    drawControls(ctx, In, p, g) {
      if (!In.usingTouch) {
        ctx.font = `11px ${FONT}`; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(200,190,170,0.45)';
        ctx.fillText('WASD mover · MAYÚS correr · ratón apuntar · clic disparar · R recargar · ESPACIO empujar · F linterna · ESC pausa', In.w / 2, In.h - 10);
        this.drawButton(ctx, In.buttons.find((b) => b.id === 'pause'), p, g);
        return;
      }
      this.drawStick(ctx, In.moveStick, In.moveHome, In.moveStick.active, false, true);
      this.drawStick(ctx, In.aimStick, In.aimHome, In.aimStick.active, true, false);
      for (const b of In.buttons) this.drawButton(ctx, b, p, g);
      if (this.tutT > 0) this.drawTutorial(ctx, In);
    }

    drawTutorial(ctx, In) {
      this.tutT -= this.lastDt || 1 / 60;
      const a = Math.min(1, this.tutT / 1.5);
      const t = performance.now() / 1000;
      ctx.globalAlpha = a;
      ctx.textAlign = 'center';
      ctx.font = `700 ${Math.round(In.s * 0.28)}px ${FONT}`;
      // pulgar izquierdo
      const m = In.moveHome, r = In.moveStick.R;
      const ox = Math.cos(t * 2) * r * 0.6, oy = Math.sin(t * 2) * r * 0.6;
      ctx.fillStyle = 'rgba(230,220,200,0.55)';
      ctx.beginPath(); ctx.arc(m.x + ox, m.y + oy, r * 0.32, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#e8dcc4';
      ctx.fillText('MOVERTE', m.x, m.y - r - 26);
      ctx.font = `${Math.round(In.s * 0.22)}px ${FONT}`;
      ctx.fillStyle = 'rgba(232,200,120,0.9)';
      ctx.fillText('arrastra lejos para correr', m.x, m.y - r - 10);
      // pulgar derecho
      const h = In.aimHome, r2 = In.aimStick.R;
      const k = (Math.sin(t * 1.6) + 1) / 2;
      const d = r2 * (0.3 + k * 0.62);
      ctx.fillStyle = k > 0.8 ? 'rgba(220,90,60,0.7)' : 'rgba(230,220,200,0.55)';
      ctx.beginPath(); ctx.arc(h.x - d * 0.7, h.y - d * 0.7, r2 * 0.32, 0, Math.PI * 2); ctx.fill();
      ctx.font = `700 ${Math.round(In.s * 0.28)}px ${FONT}`;
      ctx.fillStyle = '#e8dcc4';
      ctx.fillText('APUNTAR', h.x - r2 * 1.9, h.y - 6);
      ctx.font = `${Math.round(In.s * 0.22)}px ${FONT}`;
      ctx.fillStyle = 'rgba(230,110,80,0.95)';
      ctx.fillText('al borde: DISPARAR', h.x - r2 * 1.9, h.y + 12);
      ctx.globalAlpha = 1;
    }

    drawButton(ctx, b, p, g) {
      if (!b || b.hidden) return;
      const held = TM.Input.held[b.id] !== undefined;
      ctx.fillStyle = held ? 'rgba(200,190,170,0.35)' : 'rgba(20,20,20,0.42)';
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(220,210,190,0.3)'; ctx.lineWidth = 2; ctx.stroke();
      const r = b.r;
      ctx.strokeStyle = 'rgba(230,220,200,0.85)'; ctx.fillStyle = 'rgba(230,220,200,0.85)';
      ctx.lineWidth = 2.2;
      switch (b.id) {
        case 'pause':
          ctx.fillRect(b.x - r * 0.3, b.y - r * 0.38, r * 0.2, r * 0.76);
          ctx.fillRect(b.x + r * 0.1, b.y - r * 0.38, r * 0.2, r * 0.76);
          break;
        case 'reload': {
          ctx.beginPath(); ctx.arc(b.x, b.y, r * 0.42, -0.3, Math.PI * 1.5); ctx.stroke();
          const ax = b.x + Math.cos(-0.3) * r * 0.42, ay = b.y + Math.sin(-0.3) * r * 0.42;
          ctx.beginPath(); ctx.moveTo(ax - 5, ay - 4); ctx.lineTo(ax + 2, ay + 3); ctx.lineTo(ax + 5, ay - 6); ctx.stroke();
          const c = g.combat;
          if (c.reloading) {
            ctx.strokeStyle = '#d0a050'; ctx.lineWidth = 3;
            ctx.beginPath(); ctx.arc(b.x, b.y, r - 2, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - c.reloadT / c.weapon.reloadTime)); ctx.stroke();
          }
          break;
        }
        case 'shove':
          // puño / golpe
          ctx.beginPath();
          ctx.moveTo(b.x - r * 0.45, b.y + r * 0.1); ctx.lineTo(b.x + r * 0.15, b.y + r * 0.1);
          ctx.moveTo(b.x + r * 0.05, b.y - r * 0.2); ctx.lineTo(b.x + r * 0.45, b.y + r * 0.1); ctx.lineTo(b.x + r * 0.05, b.y + r * 0.4);
          ctx.stroke();
          if (g.combat.shoveCd > 0) {
            ctx.fillStyle = 'rgba(0,0,0,0.45)';
            ctx.beginPath(); ctx.moveTo(b.x, b.y);
            ctx.arc(b.x, b.y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (g.combat.shoveCd / 0.65)); ctx.fill();
          }
          break;
        case 'light':
          ctx.globalAlpha = p.flashlightOn ? 1 : 0.4;
          ctx.fillRect(b.x - r * 0.45, b.y - r * 0.13, r * 0.4, r * 0.26);
          ctx.beginPath(); ctx.moveTo(b.x - r * 0.05, b.y - r * 0.2); ctx.lineTo(b.x + r * 0.45, b.y - r * 0.4);
          ctx.lineTo(b.x + r * 0.45, b.y + r * 0.4); ctx.lineTo(b.x - r * 0.05, b.y + r * 0.2); ctx.closePath();
          if (p.flashlightOn) ctx.fill(); else ctx.stroke();
          ctx.globalAlpha = 1;
          break;
      }
    }
  }

  TM.HUD = HUD;
})();
