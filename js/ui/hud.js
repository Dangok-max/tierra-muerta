// HUD en canvas: vida, estamina, hambre y sed, estados, arma y munición, reloj, avisos, indicadores,
// accesos rápidos, indicación contextual de USAR y controles táctiles.
(function () {
  const U = TM.U;
  const FONT = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';

  function rrect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r); ctx.closePath();
  }

  class HUD {
    constructor(game) {
      this.game = game;
      this.notes = [];
      this.hits = [];
      this.lowPulse = 0;
      this.fps = 60;
      this.fpsAcc = 0; this.fpsN = 0;
      this.tutT = 0;
      this.useHintT = 0;     // pulso del botón USAR las primeras veces
      this.usesSeen = 0;
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

      // efectos del mundo que brillan (fuego, proyectiles, marca de USAR): encima de la oscuridad
      this.drawWorldPass(ctx, g);

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
      this.drawCampArrow(ctx, g, W, H);
      if (p.alive) this.drawPrompt(ctx, g, W, H, s);
      if (p.alive && In.enabled) this.drawControls(ctx, In, p, g);

      if (TM.Config.DEBUG) {
        ctx.font = `11px ${FONT}`; ctx.textAlign = 'left'; ctx.fillStyle = '#9f9';
        const inv = p.inventory;
        const lines = [`FPS ${this.fps.toFixed(0)}  trabajo ${g.perfInfo.work.toFixed(1)}ms  dpr ${g.renderer.dpr.toFixed(2)}  zombies ${g.zombies.length}`,
          `pos ${p.x.toFixed(0)},${p.y.toFixed(0)}  bioma ${g.world.biomeAt(p.x, p.y)}  hambre ${p.hunger.toFixed(0)} sed ${p.thirst.toFixed(0)}` +
          (inv ? `  peso ${inv.weight().toFixed(1)}/${inv.maxWeight}` : '') + `  inf ${(p.infection * 100).toFixed(0)}%`];
        if (g.director && g.director.debugText) lines.push(...g.director.debugText());
        lines.forEach((l, i) => ctx.fillText(l, 10, H - 80 + i * 13));
      }
    }

    drawWorldPass(ctx, g) {
      const r = g.renderer;
      if (!r || !r.worldTransform || !g.combat) return;
      r.worldTransform(g.camera);
      const t = g.time;
      try {
        if (g.combat.drawFx) g.combat.drawFx(ctx, t);
        if (g.combat.interact) g.combat.interact.drawFx(ctx, t);
      } catch (e) { console.error(e); }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.setTransform(r.dpr, 0, 0, r.dpr, 0, 0);
    }

    bar(ctx, x, y, w, h, k, col, back) {
      ctx.fillStyle = back || 'rgba(0,0,0,0.55)';
      ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
      ctx.fillStyle = col;
      ctx.fillRect(x, y, w * U.clamp(k, 0, 1), h);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(x, y, w * U.clamp(k, 0, 1), Math.max(1, h * 0.35));
    }

    // iconos mínimos para las barras
    iconFood(ctx, x, y, col) {
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.ellipse(x + 1.5, y - 1, 3.6, 2.8, -0.6, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(x - 3.5, y + 0.5, 3.4, 1.6);
    }
    iconDrop(ctx, x, y, col) {
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.moveTo(x, y - 4.5); ctx.quadraticCurveTo(x + 4, y + 0.5, x, y + 3.2); ctx.quadraticCurveTo(x - 4, y + 0.5, x, y - 4.5); ctx.fill();
    }

    drawTopLeft(ctx, g, p, s) {
      const x = 14, y = 12;
      const w = U.clamp(s * 3.2, 120, 190);
      const t = g.time;
      ctx.textAlign = 'left';
      ctx.font = `600 ${Math.round(s * 0.26)}px ${FONT}`;
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillText(p.name.toUpperCase(), x + 1, y + 11);
      ctx.fillStyle = '#d8d2c4'; ctx.fillText(p.name.toUpperCase(), x, y + 10);
      const hpk = p.hp / p.maxHp;
      this.bar(ctx, x, y + 16, w, 9, hpk, hpk < 0.3 ? '#c0281e' : '#9c2a22');
      this.bar(ctx, x, y + 29, w * 0.75, 4, p.stamina / p.maxStamina, p.sprinting ? '#d8c890' : '#a89c70');
      // hambre y sed: discretas, parpadean cuando están bajas
      const bw = w * 0.42, by = y + 39;
      const blink = (v) => (v < 20 ? 0.55 + 0.45 * Math.sin(t * 8) : 1);
      ctx.globalAlpha = blink(p.hunger);
      this.iconFood(ctx, x + 4, by + 2, p.hunger < 20 ? '#e08040' : '#c89a50');
      this.bar(ctx, x + 11, by, bw - 11, 4, p.hunger / 100, p.hunger < 20 ? '#d07030' : '#b08040');
      ctx.globalAlpha = blink(p.thirst);
      this.iconDrop(ctx, x + bw + 12, by + 2, p.thirst < 20 ? '#70b0f0' : '#5a90c8');
      this.bar(ctx, x + bw + 19, by, bw - 11, 4, p.thirst / 100, p.thirst < 20 ? '#4a90e0' : '#3a78b8');
      ctx.globalAlpha = 1;

      // estados
      let sx = x, sy = y + 52;
      ctx.font = `700 ${Math.max(10, Math.round(s * 0.2))}px ${FONT}`;
      const pill = (txt, col, bg) => {
        const tw = ctx.measureText(txt).width + 10;
        ctx.fillStyle = bg; rrect(ctx, sx, sy - 9, tw, 13, 3); ctx.fill();
        ctx.fillStyle = col; ctx.fillText(txt, sx + 5, sy + 1);
        sx += tw + 4;
      };
      if (p.bleedT > 0) pill('SANGRADO', '#ffb0a0', `rgba(150,20,10,${0.55 + 0.3 * Math.sin(t * 6)})`);
      if (p.infection >= 0.25) pill('INFECCIÓN', '#d0f0a0', 'rgba(60,90,20,0.75)');
      else if (p.infection > 0) pill('MORDEDURA', '#d0e0b0', 'rgba(60,70,30,0.6)');
      if (p.painT > 0) pill('ANALGÉSICO', '#f0d8b0', 'rgba(110,70,20,0.6)');
      const inv = p.inventory;
      if (inv && inv.load() > 1) pill(inv.canSprint() ? 'SOBRECARGA' : 'SIN CORRER: PESO', '#f0c0a0', 'rgba(110,50,20,0.7)');
      if (sx > x) sy += 15;

      ctx.font = `${Math.round(s * 0.22)}px ${FONT}`;
      ctx.fillStyle = 'rgba(210,200,180,0.75)';
      const kills = g.totalKills();
      const km = (Math.hypot(p.x, p.y) / TM.Config.UNITS_PER_M / 1000).toFixed(2);
      ctx.fillText(`☠ ${kills}    ⌖ ${km} km`, x, sy + 4);
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
      // entre el bloque de vida (izquierda) y el panel del arma (derecha), partiendo en líneas si no cabe
      const x0 = 14 + U.clamp(s * 3.2, 120, 190) + 8, x1 = W - s * 3.7 - 8;
      const cx = (x0 + x1) / 2, maxW = Math.max(160, x1 - x0 - 24);
      for (const n of this.notes) {
        const k = n.life / n.max;
        const a = Math.min(1, (1 - k) * 8, k * 4);
        ctx.globalAlpha = a;
        if (n._w !== maxW) { n._lines = this.wrap(ctx, n.text, maxW); n._w = maxW; }
        for (const ln of n._lines) {
          const tw = ctx.measureText(ln).width;
          ctx.fillStyle = 'rgba(0,0,0,0.55)';
          ctx.fillRect(cx - tw / 2 - 12, y - s * 0.3, tw + 24, s * 0.44);
          ctx.fillStyle = n.color;
          ctx.fillText(ln, cx, y);
          y += s * 0.44;
        }
        y += s * 0.08;
      }
      ctx.globalAlpha = 1;
    }

    wrap(ctx, text, maxW) {
      if (ctx.measureText(text).width <= maxW) return [text];
      const words = text.split(' ');
      const lines = [];
      let cur = '';
      for (const w of words) {
        const t = cur ? cur + ' ' + w : w;
        if (cur && ctx.measureText(t).width > maxW) { lines.push(cur); cur = w; } else cur = t;
      }
      if (cur) lines.push(cur);
      return lines;
    }

    // Panel del arma (arriba a la derecha). Tocarlo cambia de arma.
    drawWeapon(ctx, g, b) {
      const c = g.combat, p = g.player, inv = p.inventory, s = TM.Input.s;
      if (!b || !inv) return;
      const w = c.weapon;
      const stack = inv.activeStack();
      const held = TM.Input.held.swap !== undefined;
      ctx.fillStyle = held ? 'rgba(200,190,170,0.28)' : 'rgba(10,10,10,0.42)';
      rrect(ctx, b.x, b.y, b.w, b.h, 8); ctx.fill();
      ctx.strokeStyle = inv.ready ? 'rgba(240,180,90,0.7)' : 'rgba(220,210,190,0.2)'; ctx.lineWidth = 1.5; ctx.stroke();
      const ic = b.h * 0.86;
      const iconId = stack ? stack.id : null;
      if (iconId) ctx.drawImage(TM.Items.iconCanvas(iconId, 64), b.x + 4, b.y + (b.h - ic) / 2, ic, ic);
      else {
        // puño
        ctx.fillStyle = '#b88a6a';
        ctx.beginPath(); ctx.arc(b.x + 4 + ic / 2, b.y + b.h / 2, ic * 0.24, 0, Math.PI * 2); ctx.fill();
      }
      const tx = b.x + b.w - 8;
      ctx.textAlign = 'right';
      const nameF = Math.max(10, Math.round(s * 0.2));
      ctx.font = `600 ${nameF}px ${FONT}`;
      ctx.fillStyle = 'rgba(210,200,180,0.75)';
      const name = inv.ready ? `${TM.Items.name(inv.ready.id)} · LISTO` : stack ? TM.Items.name(stack.id) : 'Puños';
      ctx.fillText(name.toUpperCase(), tx, b.y + nameF + 3);
      const bigF = Math.round(s * 0.36);
      const by = b.y + b.h - 7;
      if (w.kind === 'gun') {
        const res = c.reserve();
        if (c.reloading) {
          ctx.font = `700 ${Math.round(s * 0.26)}px ${FONT}`;
          ctx.fillStyle = '#d0a050';
          ctx.fillText('RECARGANDO', tx, by - 4);
          this.bar(ctx, b.x + ic + 10, by, tx - (b.x + ic + 10), 3, 1 - c.reloadT / c.reloadMax, '#d0a050');
        } else {
          ctx.font = `600 ${Math.round(s * 0.24)}px ${FONT}`;
          ctx.fillStyle = res === 0 ? '#c06040' : 'rgba(200,190,170,0.7)';
          const rs = `/ ${res}`;
          ctx.fillText(rs, tx, by);
          const rw = ctx.measureText(rs).width;
          ctx.font = `700 ${bigF}px ${FONT}`;
          ctx.fillStyle = c.mag === 0 ? '#d06040' : '#e8dfcc';
          ctx.fillText(String(c.mag), tx - rw - 5, by);
          if (c.mag === 0 && res === 0) {
            ctx.font = `700 ${nameF}px ${FONT}`; ctx.fillStyle = '#e07050';
            ctx.textAlign = 'right';
            ctx.fillText(TM.Input.usingTouch ? 'SIN MUNICIÓN · TOCA AQUÍ' : 'SIN MUNICIÓN · Q CAMBIA', b.x + b.w - 2, b.y + b.h + nameF + 2);
          }
        }
      } else if (w.kind === 'melee') {
        if (stack && stack.dur !== undefined) {
          const k = stack.dur;
          const bx = b.x + ic + 10, bw = tx - bx;
          this.bar(ctx, bx, by - 4, bw, 5, k, k < 0.2 ? '#d05030' : k < 0.5 ? '#c8a040' : '#8ab060');
        } else {
          ctx.font = `600 ${Math.round(s * 0.22)}px ${FONT}`;
          ctx.fillStyle = 'rgba(200,190,170,0.6)';
          ctx.fillText('cuerpo a cuerpo', tx, by);
        }
      } else if (w.kind === 'throw' && stack) {
        ctx.font = `700 ${bigF}px ${FONT}`;
        ctx.fillStyle = '#f0c890';
        ctx.fillText('×' + inv.count(stack.id), tx, by);
      }
      // indicador de "tocar para cambiar" si hay más de un arma
      if (inv.weaponStacks().length > 0 && TM.Input.usingTouch) {
        ctx.strokeStyle = 'rgba(220,210,190,0.45)'; ctx.lineWidth = 1.5;
        const ax = b.x + ic + 9, ay = b.y + 8;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax + 9, ay); ctx.lineTo(ax + 6, ay - 3);
        ctx.moveTo(ax + 9, ay + 5); ctx.lineTo(ax, ay + 5); ctx.lineTo(ax + 3, ay + 8); ctx.stroke();
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

    // Indicación contextual junto al objeto: "ABRIR PUERTA", "RECOGER Venda ×2"...
    drawPrompt(ctx, g, W, H, s) {
      const it = g.combat && g.combat.interact;
      if (!it) return;
      let text = null, color = '#e0d6c0', wx = 0, wy = 0, dim = false;
      if (it.search) {
        text = 'REGISTRANDO…'; wx = it.search.chest.x; wy = it.search.chest.y; color = '#e8d8b0';
      } else if (it.target && !it.loot) {
        const L = it.target.label;
        text = L.text; color = L.color; dim = L.dim; wx = it.target.x; wy = it.target.y;
        if (!TM.Input.usingTouch) text = '[E] ' + text;
      }
      if (!text) return;
      const sp = g.worldToScreen(wx, wy);
      const f = Math.max(12, Math.round(s * 0.26));
      ctx.font = `700 ${f}px ${FONT}`;
      const tw = ctx.measureText(text).width + 16;
      const x = U.clamp(sp.x, tw / 2 + 6, W - tw / 2 - 6);
      const y = U.clamp(sp.y - 30, 60 + f, H - s * 1.6);
      ctx.globalAlpha = dim ? 0.6 : 1;
      ctx.fillStyle = 'rgba(0,0,0,0.62)';
      rrect(ctx, x - tw / 2, y - f, tw, f + 9, 5); ctx.fill();
      ctx.strokeStyle = color; ctx.globalAlpha *= 0.5; ctx.lineWidth = 1; ctx.stroke();
      ctx.globalAlpha = dim ? 0.6 : 1;
      ctx.fillStyle = color; ctx.textAlign = 'center';
      ctx.fillText(text, x, y + 1);
      ctx.globalAlpha = 1;
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
          ctx.fillText('CORRIENDO', U.clamp(bx, 40, TM.Input.w - 40), Math.max(14, by - st.R * TM.Input.SPRINT_RATIO - 6));
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
      const find = (id) => In.buttons.find((b) => b.id === id);
      this.drawWeapon(ctx, g, find('swap'));
      if (!In.usingTouch) {
        if (g.time < 90) {
          ctx.globalAlpha = Math.min(1, (90 - g.time) / 10);
          ctx.font = `11px ${FONT}`; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(200,190,170,0.5)';
          ctx.fillText('WASD mover · MAYÚS correr · ratón apuntar · clic atacar · E usar · I mochila · Q / rueda cambiar arma · 1-3 rápidos · R recargar · ESPACIO empujar · F linterna', In.w / 2, In.h - In.s * 1.3);
          ctx.globalAlpha = 1;
        }
        for (const id of ['pause', 'q1', 'q2', 'q3', 'bag']) this.drawButton(ctx, find(id), p, g);
        return;
      }
      this.drawStick(ctx, In.moveStick, In.moveHome, In.moveStick.active, false, true);
      this.drawStick(ctx, In.aimStick, In.aimHome, In.aimStick.active, true, false);
      for (const b of In.buttons) if (!b.rect) this.drawButton(ctx, b, p, g);
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

    drawQuick(ctx, b, p, g) {
      const inv = p.inventory;
      if (!inv) return;
      const id = inv.quick[b.slot];
      const r = b.r;
      const held = TM.Input.held[b.id] !== undefined;
      ctx.fillStyle = held ? 'rgba(200,190,170,0.35)' : 'rgba(20,20,20,0.45)';
      ctx.beginPath(); ctx.arc(b.x, b.y, r, 0, Math.PI * 2); ctx.fill();
      const act = p.action && id && p.action.id === id;
      const ready = id && inv.ready && inv.ready.id === id;
      const eq = id && inv.equipped && inv.equipped.id === id && !inv.ready;
      ctx.strokeStyle = ready ? 'rgba(240,180,90,0.9)' : eq ? 'rgba(160,200,140,0.7)' : 'rgba(220,210,190,0.3)';
      ctx.lineWidth = ready || eq ? 2.5 : 2; ctx.stroke();
      if (!TM.Input.usingTouch) {
        ctx.font = `700 10px ${FONT}`; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(220,210,190,0.6)';
        ctx.fillText(String(b.slot + 1), b.x - r * 0.72, b.y - r * 0.6);
      }
      if (!id) {
        ctx.strokeStyle = 'rgba(220,210,190,0.35)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(b.x - r * 0.3, b.y); ctx.lineTo(b.x + r * 0.3, b.y); ctx.moveTo(b.x, b.y - r * 0.3); ctx.lineTo(b.x, b.y + r * 0.3); ctx.stroke();
        return;
      }
      const n = inv.count(id);
      ctx.globalAlpha = n > 0 ? 1 : 0.3;
      const sz = r * 1.45;
      ctx.drawImage(TM.Items.iconCanvas(id, 64), b.x - sz / 2, b.y - sz / 2, sz, sz);
      ctx.globalAlpha = 1;
      const d = TM.Items.DB[id];
      if (d && d.stack > 1) {
        const f = Math.max(10, Math.round(r * 0.5));
        ctx.font = `800 ${f}px ${FONT}`; ctx.textAlign = 'right';
        ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.fillText(String(n), b.x + r + 1, b.y + r + 1);
        ctx.fillStyle = n > 0 ? '#f0e8d8' : '#a07060'; ctx.fillText(String(n), b.x + r, b.y + r);
      }
      if (act) {
        ctx.strokeStyle = '#f0e0b0'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(b.x, b.y, r + 2, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (p.action.t / p.action.dur)); ctx.stroke();
      }
    }

    drawButton(ctx, b, p, g) {
      if (!b || b.hidden) return;
      if (b.slot !== undefined) { this.drawQuick(ctx, b, p, g); return; }
      const held = TM.Input.held[b.id] !== undefined;
      const r = b.r;
      const it = g.combat && g.combat.interact;
      let alpha = 1;
      if (b.id === 'use') {
        const avail = it && (it.target || it.loot || it.search);
        alpha = avail ? 1 : 0.38;
      }
      ctx.globalAlpha = alpha;
      ctx.fillStyle = held ? 'rgba(200,190,170,0.35)' : 'rgba(20,20,20,0.42)';
      ctx.beginPath(); ctx.arc(b.x, b.y, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(220,210,190,0.3)'; ctx.lineWidth = 2; ctx.stroke();
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
            ctx.beginPath(); ctx.arc(b.x, b.y, r - 2, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - c.reloadT / c.reloadMax)); ctx.stroke();
          }
          if (c.weapon.kind !== 'gun') { ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.beginPath(); ctx.arc(b.x, b.y, r, 0, Math.PI * 2); ctx.fill(); }
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
          ctx.globalAlpha = alpha * (p.flashlightOn ? 1 : 0.4);
          ctx.fillRect(b.x - r * 0.45, b.y - r * 0.13, r * 0.4, r * 0.26);
          ctx.beginPath(); ctx.moveTo(b.x - r * 0.05, b.y - r * 0.2); ctx.lineTo(b.x + r * 0.45, b.y - r * 0.4);
          ctx.lineTo(b.x + r * 0.45, b.y + r * 0.4); ctx.lineTo(b.x - r * 0.05, b.y + r * 0.2); ctx.closePath();
          if (p.flashlightOn) ctx.fill(); else ctx.stroke();
          break;
        case 'use': {
          // mano abierta + texto
          const col = it && it.target && it.target.label ? it.target.label.color : '#e6dcc8';
          if (alpha === 1) {
            const pulse = 0.5 + 0.5 * Math.sin(g.time * 5);
            ctx.strokeStyle = col; ctx.globalAlpha = 0.35 + pulse * 0.4; ctx.lineWidth = 3;
            ctx.beginPath(); ctx.arc(b.x, b.y, r + 2 + pulse * 2, 0, Math.PI * 2); ctx.stroke();
            ctx.globalAlpha = 1;
          }
          ctx.fillStyle = 'rgba(230,220,200,0.9)';
          ctx.font = `800 ${Math.max(11, Math.round(r * 0.42))}px ${FONT}`; ctx.textAlign = 'center';
          ctx.fillText(it && it.loot ? 'TODO' : 'USAR', b.x, b.y + r * 0.15);
          ctx.strokeStyle = 'rgba(230,220,200,0.7)'; ctx.lineWidth = 1.6;
          ctx.beginPath(); ctx.arc(b.x, b.y + r * 0.42, r * 0.14, Math.PI, 0); ctx.stroke();
          break;
        }
        case 'bag': {
          const inv = p.inventory;
          ctx.drawImage(TM.Items.iconCanvas('mochila_escolar', 64), b.x - r * 0.75, b.y - r * 0.8, r * 1.5, r * 1.5);
          if (inv) {
            const l = inv.load();
            ctx.strokeStyle = l > 1 ? '#e06040' : l > 0.85 ? '#d8b050' : 'rgba(170,200,140,0.8)';
            ctx.lineWidth = 3;
            ctx.beginPath(); ctx.arc(b.x, b.y, r - 1.5, Math.PI * 0.75, Math.PI * 0.75 + Math.PI * 1.5 * Math.min(1, l)); ctx.stroke();
          }
          if (!TM.Input.usingTouch) {
            ctx.font = `700 10px ${FONT}`; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(220,210,190,0.6)';
            ctx.fillText('I', b.x + r * 0.8, b.y - r * 0.6);
          }
          break;
        }
      }
      ctx.globalAlpha = 1;
    }
  }

  TM.HUD = HUD;
})();
