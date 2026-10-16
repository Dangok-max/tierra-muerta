// Interacción (botón USAR / tecla E): recoger objetos, puertas, cofres; usar objetos y accesos rápidos.
(function () {
  const U = TM.U;
  const DB = () => TM.Items.DB;

  const R_ITEM = 34, R_CHEST = 46, R_DOOR = 52;
  const SEARCH_TIME = { common: 0.7, rare: 1.1, legendary: 1.6 };
  const RAR_TXT = { common: '', rare: 'raro', legendary: 'legendario' };
  const RAR_COL = { common: '#e0d6c0', rare: '#7ab4f0', legendary: '#f0c050' };

  // Objetos en el suelo de respaldo si el mundo todavía no los implementa (no se guardan).
  function ensureGround(world) {
    if (!world || world.addGroundItem) return;
    let nextId = 1;
    const list = [];
    world._groundPolyfill = list;
    world.addGroundItem = (x, y, stack) => { const id = 'g' + nextId++; list.push({ id, x, y, stack }); return id; };
    world.removeGroundItem = (id) => { const i = list.findIndex((g) => g.id === id); if (i >= 0) list.splice(i, 1); };
    world.groundItemsNear = (x, y, r) => list.filter((g) => U.dist2(g.x, g.y, x, y) <= r * r);
  }

  function distRect(px, py, x, y, w, h) {
    const cx = U.clamp(px, x, x + w), cy = U.clamp(py, y, y + h);
    return Math.hypot(px - cx, py - cy);
  }
  // distancia a una puerta (acepta x,y como esquina o como centro)
  function doorDist(px, py, d) {
    if (d.w === undefined) return U.dist(px, py, d.x, d.y);
    return Math.min(distRect(px, py, d.x, d.y, d.w, d.h), distRect(px, py, d.x - d.w / 2, d.y - d.h / 2, d.w, d.h));
  }
  function doorCenter(d) {
    if (d.cx !== undefined) return { x: d.cx, y: d.cy };
    if (d.w === undefined) return { x: d.x, y: d.y };
    return { x: d.x + d.w / 2, y: d.y + d.h / 2 };
  }
  function call(obj, fn, ...args) {
    if (!obj || typeof obj[fn] !== 'function') return undefined;
    try { return obj[fn](...args); } catch (e) { console.warn('mundo.' + fn, e); return undefined; }
  }

  class Interact {
    constructor(game) {
      this.game = game;
      this.target = null;
      this.scanT = 0;
      this.search = null;     // registro de un cofre en curso
      this.loot = null;       // panel de botín abierto { chest, stacks, x, y }
      this.glints = [];
      this.glintT = 0;
      this.autoT = 0;
      ensureGround(game.world);
    }

    get world() { return this.game.world; }

    update(dt) {
      const g = this.game, p = g.player, In = TM.Input;
      ensureGround(g.world);
      this.scanT -= dt;
      if (this.scanT <= 0) { this.scanT = 0.1; this.target = this.findTarget(); }
      this.glintT -= dt;
      if (this.glintT <= 0) { this.glintT = 0.35; this.scanGlints(); }

      if (In.consume('bag') && TM.InvUI) TM.InvUI.open('bag');
      if (In.consume('use')) {
        if (this.loot) { if (TM.InvUI) TM.InvUI.lootTakeAll(); }
        else if (this.search) this.cancelSearch('');
        else if (this.target) this.act(this.target);
      }

      // registro de cofre
      if (this.search) {
        const s = this.search;
        if (U.dist(p.x, p.y, s.chest.x, s.chest.y) > R_CHEST + 22 || !this.reachable(s.chest.x, s.chest.y, s.chest.loose ? null : s.chest.buildingId, s.chest.container === 'maletero' ? 34 : 20)) this.cancelSearch('Registro interrumpido');
        else {
          s.t += dt;
          if (Math.random() < dt * 4) g.fx.dust(s.chest.x + U.randRange(-8, 8), s.chest.y + U.randRange(-8, 8), 1);
          if (s.t >= s.dur) { this.search = null; this.openChest(s.chest); }
        }
      }
      // el panel de botín se cierra al alejarse
      if (this.loot && U.dist(p.x, p.y, this.loot.x, this.loot.y) > R_CHEST + 40 && TM.InvUI) TM.InvUI.closeLoot();

      // munición del suelo: se recoge sola al pasar por encima
      this.autoT -= dt;
      if (this.autoT <= 0) { this.autoT = 0.2; this.autoPickup(); }
    }

    // ---------- alcance real (sin atravesar paredes) ----------
    reachable(x, y, buildingId, short) {
      const p = this.game.player, W = this.world;
      // si el objeto está dentro de un edificio, hay que estar dentro de ese edificio
      // (el maletero de un auto aparcado fuera tiene buildingId pero se registra desde la calle)
      if (buildingId) {
        const ob = call(W, 'buildingAt', x, y);
        if (ob && ob.id === buildingId) {
          const pb = call(W, 'buildingAt', p.x, p.y);
          if (!pb || pb.id !== buildingId) return false;
        }
      }
      // línea libre hasta casi el objeto (el mueble que lo contiene no cuenta)
      const d = U.dist(p.x, p.y, x, y);
      const sh = short || 20; // lo que mide el mueble/auto desde su centro hasta el borde
      if (d < sh + 2 || typeof W.raycast !== 'function') return true;
      const k = (d - sh) / d;
      // raycast sólido: también frena en puertas de cristal cerradas (que no tapan la vista)
      if (W.raycast(p.x, p.y, p.x + (x - p.x) * k, p.y + (y - p.y) * k) >= 1) return true;
      // solo cuentan paredes, ventanas y puertas; los muebles bajos (una cama) no impiden alcanzar la mesita
      const o = W.lastRayObstacle;
      return !!o && o.kind !== 'wall' && o.kind !== 'window' && o.kind !== 'door';
    }

    // ---------- objetivos cercanos ----------
    findTarget() {
      const g = this.game, p = g.player, W = this.world;
      let best = null, bestD = 1e9;
      const items = call(W, 'groundItemsNear', p.x, p.y, R_ITEM + 10) || [];
      for (const it of items) {
        if (!it || !it.stack || !DB()[it.stack.id]) continue;
        const d = U.dist(p.x, p.y, it.x, it.y) - 6; // preferencia leve a los objetos
        if (d < R_ITEM && d < bestD) { bestD = d; best = { type: 'item', obj: it, x: it.x, y: it.y }; }
      }
      const chests = call(W, 'chestsNear', p.x, p.y, R_CHEST + 10) || [];
      for (const c of chests) {
        if (!c || c.opened) continue;
        const d = U.dist(p.x, p.y, c.x, c.y);
        if (d < R_CHEST && d < bestD && this.reachable(c.x, c.y, c.loose ? null : c.buildingId, c.container === 'maletero' ? 34 : 20)) { bestD = d; best = { type: 'chest', obj: c, x: c.x, y: c.y }; }
      }
      const doors = call(W, 'doorsNear', p.x, p.y, R_DOOR + 30) || [];
      for (const dr of doors) {
        if (!dr) continue;
        const d = doorDist(p.x, p.y, dr) + 4;
        if (d < R_DOOR && d < bestD && (dr.ext || this.reachable(doorCenter(dr).x, doorCenter(dr).y, dr.buildingId))) { const c = doorCenter(dr); bestD = d; best = { type: 'door', obj: dr, x: c.x, y: c.y }; }
      }
      if (best) best.label = this.labelFor(best);
      return best;
    }

    labelFor(t) {
      if (t.type === 'item') {
        const s = t.obj.stack;
        return { text: 'RECOGER ' + TM.Items.label(s), color: TM.Items.tierColor(s.id) };
      }
      if (t.type === 'chest') {
        const c = t.obj;
        const name = (c.container || 'contenedor').toUpperCase();
        const rt = RAR_TXT[c.rarity] || '';
        return { text: 'REGISTRAR ' + name + (rt ? ` (${rt})` : ''), color: RAR_COL[c.rarity] || RAR_COL.common };
      }
      const d = t.obj;
      if (d.broken) return { text: 'PUERTA ROTA', color: '#a09080', dim: true };
      if (!d.open && (d.locked || d.barricade)) return { text: 'ATRANCADA (rómpela a golpes)', color: '#d0a080' };
      return { text: d.open ? 'CERRAR PUERTA' : 'ABRIR PUERTA', color: '#e0d6c0' };
    }

    act(t) {
      if (t.type === 'item') this.pickup(t.obj);
      else if (t.type === 'chest') this.startSearch(t.obj);
      else if (t.type === 'door') this.toggleDoor(t.obj);
      this.scanT = 0;
    }

    // ---------- puertas ----------
    toggleDoor(d) {
      const g = this.game, p = g.player, W = this.world;
      if (d.broken) { g.fx.floatText(p.x, p.y - 24, 'Está rota', '#b0a090'); return; }
      const open = !d.open;
      const c = doorCenter(d);
      if (!open) {
        // no cerrar con alguien en el marco
        const hw = (d.w || 32) / 2 + 4, hh = (d.h || 32) / 2 + 4;
        const inside = (e) => Math.abs(e.x - c.x) < hw + e.r && Math.abs(e.y - c.y) < hh + e.r;
        if (inside(p) || g.zombies.some((z) => !z.dead && inside(z))) { g.fx.floatText(c.x, c.y - 16, 'Algo bloquea la puerta', '#d0a080'); return; }
      }
      if (call(W, 'setDoor', d.id, open) === false) {
        g.fx.floatText(c.x, c.y - 16, 'Atrancada: rómpela con un arma cuerpo a cuerpo', '#d0a080');
        if (TM.Audio) TM.Audio.play('door_bash', c.x, c.y, { volume: 0.35, pitch: 1.3 });
        g.emitNoise(c.x, c.y, 120, 'door');
        return;
      }
      if (TM.Audio) TM.Audio.play(open ? 'door_open' : 'door_close', c.x, c.y);
      g.emitNoise(c.x, c.y, 180, 'door');
    }

    // ---------- cofres ----------
    startSearch(c) {
      const g = this.game;
      this.search = { chest: c, t: 0, dur: SEARCH_TIME[c.rarity] || 0.8 };
      if (TM.Audio) TM.Audio.play('chest_open', c.x, c.y, { volume: 0.5, pitch: 1.3 });
      g.player.aimHold = 0;
    }
    cancelSearch(msg) {
      const s = this.search;
      this.search = null;
      if (msg && s) this.game.fx.floatText(s.chest.x, s.chest.y - 18, msg, '#b0a090');
    }

    openChest(c) {
      const g = this.game, p = g.player, W = this.world;
      call(W, 'markChestOpened', c.id);
      c.opened = true;
      const rng = new U.RNG(((c.id && String(c.id).split('').reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7)) || 1) ^ (g.seed | 0));
      const stacks = TM.Loot.roll(c, rng);
      if (TM.Audio) TM.Audio.play('chest_open', c.x, c.y);
      if (c.noisy) {
        if (TM.Audio) TM.Audio.play('chest_alarm', c.x, c.y);
        g.emitNoise(c.x, c.y, 900, 'chest_alarm');
        g.notify('¡Una alarma! Todos lo han oído', '#e06040');
        g.fx.ring(c.x, c.y, 300, 'rgba(230,80,60,0.6)', 1.2);
      } else g.emitNoise(c.x, c.y, 150, 'chest');
      if (c.trapped) {
        if (TM.Audio) TM.Audio.play('trap_trigger', c.x, c.y);
        g.fx.floatText(c.x, c.y - 26, '¡TRAMPA!', '#e05040');
        g.fx.spark(c.x, c.y, 0, -1, 10);
        g.emitNoise(c.x, c.y, 350, 'impact');
        p.damage(U.randRange(14, 22), c.x, c.y, 'trap');
      }
      if (c.rarity === 'legendary') {
        g.fx.ring(c.x, c.y, 120, 'rgba(240,190,80,0.9)', 0.9);
        g.fx.light(c.x, c.y, 220, 0.9, 0.6);
        g.fx.floatText(c.x, c.y - 40, '¡LEGENDARIO!', '#f0c050');
        if (TM.Audio) TM.Audio.play('ui_notify');
        TM.Input.vibrate([30, 40, 60]);
      } else if (c.rarity === 'rare') g.fx.light(c.x, c.y, 140, 0.6, 0.4);
      if (!stacks.length) { g.fx.floatText(c.x, c.y - 18, 'Vacío. Alguien llegó antes.', '#a09888'); return; }
      // texto flotante del botín
      stacks.forEach((s, i) => g.fx.floatText(c.x, c.y - 20 - i * 12, TM.Items.label(s), TM.Items.tierColor(s.id)));
      if (TM.InvUI) TM.InvUI.showLoot({ chest: c, stacks, x: c.x, y: c.y, title: (c.container || 'Contenedor'), rarity: c.rarity || 'common' });
      else for (const s of stacks) this.dropStack(s, c.x, c.y);
    }

    // El panel de botín se cerró: lo que quede se queda en el suelo junto al mueble
    lootClosed(l) {
      this.loot = null;
      if (!l || (l.world && l.world !== this.game.world)) return;
      for (const s of l.stacks) if (s.qty > 0) this.dropStack(s, l.x, l.y, true);
    }

    // Toma una pila del botín. Devuelve true si la tomó entera.
    takeStack(s) {
      const g = this.game, p = g.player, inv = p.inventory;
      const fit = inv.fitQty(s.id, s.qty);
      if (fit <= 0) { g.fx.floatText(p.x, p.y - 24, 'Demasiado peso', '#e07050'); if (TM.Audio) TM.Audio.play('empty_click'); return false; }
      const take = TM.Inventory.cloneStack(s, fit);
      const left = inv.add(take);
      const got = fit - (left ? left.qty : 0);
      if (got <= 0) { g.fx.floatText(p.x, p.y - 24, 'Mochila llena', '#e07050'); return false; }
      s.qty -= got;
      g.fx.floatText(p.x, p.y - 22, '+ ' + TM.Items.label({ id: s.id, qty: got }), TM.Items.tierColor(s.id));
      if (TM.Audio) TM.Audio.play('pickup', p.x, p.y);
      return s.qty <= 0;
    }

    // ---------- objetos del suelo ----------
    pickup(it) {
      const g = this.game, p = g.player, inv = p.inventory, W = this.world;
      const s = it.stack;
      const fit = inv.fitQty(s.id, s.qty);
      if (fit <= 0) { g.fx.floatText(p.x, p.y - 24, 'Demasiado peso: suelta algo', '#e07050'); if (TM.Audio) TM.Audio.play('empty_click'); return false; }
      const left = inv.add(TM.Inventory.cloneStack(s, fit));
      const got = fit - (left ? left.qty : 0);
      if (got <= 0) { g.fx.floatText(p.x, p.y - 24, 'Mochila llena', '#e07050'); return false; }
      call(W, 'removeGroundItem', it.id);
      const rest = s.qty - got;
      if (rest > 0) call(W, 'addGroundItem', it.x, it.y, TM.Inventory.cloneStack(s, rest));
      g.fx.floatText(it.x, it.y - 16, '+ ' + TM.Items.label({ id: s.id, qty: got }), TM.Items.tierColor(s.id));
      if (TM.Audio) TM.Audio.play('pickup', it.x, it.y);
      TM.Input.vibrate(10);
      return true;
    }

    autoPickup() {
      const g = this.game, p = g.player, W = this.world;
      if (!p.alive) return;
      const items = call(W, 'groundItemsNear', p.x, p.y, p.r + 14) || [];
      for (const it of items) {
        const s = it && it.stack;
        if (!s || s.dropped || !DB()[s.id] || DB()[s.id].cat !== 'ammo') continue;
        this.pickup(it);
      }
    }

    // Suelta una pila en el suelo cerca de (x, y)
    dropStack(s, x, y, fromChest) {
      const g = this.game, W = this.world;
      const a = Math.random() * Math.PI * 2, r = fromChest ? U.randRange(10, 22) : U.randRange(8, 16);
      let gx = x + Math.cos(a) * r, gy = y + Math.sin(a) * r;
      if (W.isFree && !W.isFree(gx, gy, 4)) { gx = x; gy = y; }
      const st = TM.Inventory.cloneStack(s);
      if (!fromChest) st.dropped = true;
      call(W, 'addGroundItem', gx, gy, st);
    }

    drop(stack, qty) {
      const g = this.game, p = g.player, inv = p.inventory;
      const wasEquipped = inv.equipped === stack;
      const out = inv.removeStack(stack, qty);
      if (!out) return;
      this.dropStack(out, p.x + Math.cos(p.aimAngle) * 14, p.y + Math.sin(p.aimAngle) * 14);
      if (wasEquipped && g.combat) g.combat.onWeaponChanged();
      if (TM.Audio) TM.Audio.play('pickup', p.x, p.y, { pitch: 0.7, volume: 0.6 });
    }

    // ---------- brillos de objetos cercanos (para encontrarlos de noche) ----------
    scanGlints() {
      const g = this.game, p = g.player;
      this.glints = call(this.world, 'groundItemsNear', p.x, p.y, 420) || [];
    }

    // ---------- usar objetos ----------
    useQuick(i) {
      const g = this.game, p = g.player, inv = p.inventory;
      const s = inv.quickStack(i);
      if (!s) {
        const id = inv.quick[i];
        if (id) g.fx.floatText(p.x, p.y - 24, 'No te quedan: ' + TM.Items.name(id), '#b0a090');
        else if (TM.InvUI) TM.InvUI.open('bag');
        return;
      }
      this.useItem(s);
    }

    // Acción principal de un objeto (equipar, preparar, consumir, aprender, ponerse la mochila)
    useItem(stack) {
      const g = this.game, p = g.player, inv = p.inventory, c = g.combat;
      const d = DB()[stack.id];
      if (!d || inv.slots.indexOf(stack) < 0) return false;
      if (d.cat === 'weapon') {
        if (inv.equipped === stack && !inv.ready) return false;
        c.equip(stack);
        return true;
      }
      if (d.cat === 'throwable') {
        if (inv.ready === stack) { inv.setReady(null); c.onWeaponChanged(); return true; }
        inv.setReady(stack);
        c.onWeaponChanged();
        g.fx.floatText(p.x, p.y - 26, d.name + ': apunta y lanza', '#f0c890');
        return true;
      }
      if (d.cat === 'food' || d.cat === 'drink' || d.cat === 'med') return p.startUse(stack);
      if (d.cat === 'blueprint') {
        const r = TM.Crafting.learn(inv, stack);
        if (r.text) g.notify(r.text, r.ok ? '#8fc870' : '#b0a090');
        if (r.ok && TM.Audio) TM.Audio.play('craft');
        return r.ok;
      }
      if (d.pack) {
        const old = inv.pack;
        inv.removeStack(stack, 1);
        inv.pack = d.id;
        if (old) inv.add({ id: old, qty: 1 });
        inv.changed();
        g.notify(`Llevas: ${d.name} (${inv.maxWeight} kg)`, '#c8d0a0');
        if (TM.Audio) TM.Audio.play('pickup', p.x, p.y);
        return true;
      }
      g.fx.floatText(p.x, p.y - 24, 'Sirve para fabricar', '#b0a090');
      return false;
    }

    // Capa de mundo: marca del objetivo, progreso del registro y brillos (lo llama el HUD)
    drawFx(ctx, t) {
      const g = this.game, p = g.player;
      // objetos del suelo de respaldo (si el mundo aún no los dibuja)
      const poly = this.world && this.world._groundPolyfill;
      if (poly) for (const it of poly) if (g.camera.inView(it.x, it.y, 20)) TM.Items.drawGround(ctx, it.stack, it.x, it.y, t);
      // destellos periódicos en objetos cercanos
      ctx.globalCompositeOperation = 'lighter';
      for (const it of this.glints) {
        if (!it || !it.stack) continue;
        const d = DB()[it.stack.id];
        if (!d) continue;
        const ph = (t * 0.6 + (it.x * 0.013 + it.y * 0.007)) % 1;
        if (ph > 0.12) continue;
        const k = Math.sin(ph / 0.12 * Math.PI);
        const col = d.tier >= 3 ? '255,200,90' : d.tier === 2 ? '130,180,255' : '255,245,220';
        const s = (d.tier >= 2 ? 7 : 5) * k;
        ctx.strokeStyle = `rgba(${col},${0.8 * k})`; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(it.x - s, it.y - 6); ctx.lineTo(it.x + s, it.y - 6); ctx.moveTo(it.x, it.y - 6 - s); ctx.lineTo(it.x, it.y - 6 + s); ctx.stroke();
      }
      ctx.globalCompositeOperation = 'source-over';
      // marca del objetivo
      const tg = this.target;
      if (tg && p.alive && !this.loot) {
        const pulse = 0.5 + 0.5 * Math.sin(t * 6);
        ctx.strokeStyle = `rgba(240,220,170,${0.35 + pulse * 0.35})`;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 4]);
        ctx.beginPath(); ctx.arc(tg.x, tg.y, tg.type === 'item' ? 13 : 18, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
      }
      // progreso del registro
      const s = this.search;
      if (s) {
        const k = s.t / s.dur;
        ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 5;
        ctx.beginPath(); ctx.arc(s.chest.x, s.chest.y - 4, 14, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = RAR_COL[s.chest.rarity] || '#e0d6c0'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(s.chest.x, s.chest.y - 4, 14, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k); ctx.stroke();
      }
    }
  }

  TM.Interact = Interact;
})();
