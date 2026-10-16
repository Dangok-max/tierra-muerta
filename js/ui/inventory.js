// Interfaz DOM de la mochila (con pestaña de fabricación) y panel rápido de botín.
// La mochila PAUSA el juego: en el celular hacen falta los dos pulgares y la atención para ordenar,
// y así no se muere uno mirando la lista. La tensión se mantiene porque consumir tarda (se hace en
// tiempo real al cerrar) y el panel de botín de los cofres NO pausa: se saquea con los muertos cerca.
(function () {
  const DB = () => TM.Items.DB;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const kg = (w) => (w < 10 ? w.toFixed(1) : Math.round(w)) + ' kg';

  const PRIMARY = {
    weapon: 'EQUIPAR', throwable: 'PREPARAR', food: 'COMER', drink: 'BEBER', med: 'USAR', blueprint: 'LEER PLANO',
  };

  const InvUI = {
    ready: false,
    isOpen: false,
    tab: 'bag',
    sel: null,          // pila seleccionada (mochila) o índice de receta
    selRecipe: null,
    lastVersion: -1,
    loot: null,
    toastT: 0,

    init() {
      if (this.ready) return;
      this.ready = true;
      const ui = document.getElementById('ui') || document.body;
      const inv = document.createElement('div');
      inv.id = 'tm-inv';
      inv.innerHTML =
        '<div class="inv-box">' +
        ' <div class="inv-head">' +
        '  <button class="inv-tab on" data-tab="bag">MOCHILA</button>' +
        '  <button class="inv-tab" data-tab="craft">FABRICAR</button>' +
        '  <div class="inv-weight"><div class="inv-wbar"><i></i></div><span class="inv-wtxt"></span></div>' +
        '  <button class="inv-close" aria-label="Cerrar">✕</button>' +
        ' </div>' +
        ' <div class="inv-body">' +
        '  <div class="inv-list"></div>' +
        '  <div class="inv-detail"></div>' +
        ' </div>' +
        ' <div class="inv-toast"></div>' +
        '</div>';
      const loot = document.createElement('div');
      loot.id = 'tm-loot';
      loot.innerHTML =
        '<div class="lt-head"><span class="lt-title"></span><span class="lt-w"></span></div>' +
        '<div class="lt-row"><div class="lt-items"></div>' +
        '<button class="lt-all">TOMAR<br>TODO</button><button class="lt-close" aria-label="Cerrar">✕</button></div>';
      // debajo de las pantallas de menú (pausa, muerte) para que estas queden encima
      ui.insertBefore(loot, ui.firstChild);
      ui.insertBefore(inv, ui.firstChild);
      this.el = inv; this.lootEl = loot;
      this.$list = inv.querySelector('.inv-list');
      this.$detail = inv.querySelector('.inv-detail');
      this.$wbar = inv.querySelector('.inv-wbar i');
      this.$wtxt = inv.querySelector('.inv-wtxt');
      this.$toast = inv.querySelector('.inv-toast');

      const tap = (el, fn) => el.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); fn(e); });
      tap(inv.querySelector('.inv-close'), () => this.close());
      for (const b of inv.querySelectorAll('.inv-tab')) tap(b, () => { this.setTab(b.dataset.tab); this.click(); });
      tap(this.$list, (e) => this.onListClick(e));
      tap(this.$detail, (e) => this.onDetailClick(e));
      // tocar el fondo oscuro fuera de la caja cierra
      inv.addEventListener('click', (e) => { if (e.target === inv) this.close(); });
      tap(loot.querySelector('.lt-all'), () => this.lootTakeAll());
      tap(loot.querySelector('.lt-close'), () => this.closeLoot());
      tap(loot.querySelector('.lt-items'), (e) => {
        const b = e.target.closest('.lt-item'); if (!b) return;
        this.lootTake(+b.dataset.i);
      });
      window.addEventListener('keydown', (e) => {
        if (!this.isOpen) return;
        if (e.code === 'Escape' || e.code === 'KeyI' || e.code === 'Tab') { e.preventDefault(); this.close(); }
      });
      // con la mochila abierta el estado es 'pause': main.js no guarda al ir a segundo plano, así que guardamos aquí
      document.addEventListener('visibilitychange', () => {
        const g = this.game;
        if (document.hidden && this.isOpen && g && g.saveNow) g.saveNow();
      });
    },

    get game() { return TM.game; },
    get inv() { const g = TM.game; return g && g.player && g.player.inventory; },
    click() { if (TM.Audio) TM.Audio.play('ui_click'); },

    // ---------- abrir / cerrar ----------
    open(tab) {
      const g = this.game;
      if (!g || g.state !== 'play' || !g.player.alive || !this.inv) return;
      this.init();
      this.isOpen = true;
      g.state = 'pause';            // pausa sin mostrar el menú de pausa
      TM.Input.enabled = false;
      TM.Input.reset();
      this.el.classList.add('show');
      if (TM.Audio) TM.Audio.play('inv_open');
      this.setTab(tab || this.tab);
    },

    close() {
      if (!this.isOpen) return;
      this.isOpen = false;
      this.el.classList.remove('show');
      this.sel = null;
      const g = this.game;
      if (TM.Audio) TM.Audio.play('inv_open', undefined, undefined, { pitch: 0.8, volume: 0.7 });
      if (g && g.state === 'pause') g.resume();
    },

    closeAll() {
      if (this.isOpen) { this.isOpen = false; this.el.classList.remove('show'); }
      if (this.loot) this.closeLoot();
    },

    setTab(t) {
      this.tab = t;
      for (const b of this.el.querySelectorAll('.inv-tab')) b.classList.toggle('on', b.dataset.tab === t);
      this.render();
    },

    toast(text, bad) {
      this.$toast.textContent = text;
      this.$toast.className = 'inv-toast show' + (bad ? ' bad' : '');
      clearTimeout(this._tt);
      this._tt = setTimeout(() => { this.$toast.className = 'inv-toast'; }, 1800);
    },

    // ---------- dibujo ----------
    render() {
      const inv = this.inv;
      if (!inv || !this.ready) return;
      const w = inv.weight(), max = inv.maxWeight;
      const k = w / max;
      this.$wbar.style.width = Math.min(100, k * 100) + '%';
      this.$wbar.style.background = k > 1 ? '#c8502e' : k > 0.85 ? '#c8a040' : '#7ea456';
      this.$wtxt.textContent = `${kg(w)} / ${max} kg` + (k > 1 ? (inv.canSprint() ? ' · LENTO' : ' · NO CORRES') : '');
      this.$wtxt.classList.toggle('over', k > 1);
      if (this.tab === 'bag') this.renderBag(); else this.renderCraft();
      this.lastVersion = inv.version;
    },

    cellHTML(s, i, inv) {
      const d = DB()[s.id];
      const eq = inv.equipped === s;
      const qi = inv.quick.indexOf(s.id);
      let h = `<button class="inv-cell t${d.tier}${this.sel === s ? ' sel' : ''}${eq ? ' eq' : ''}" data-i="${i}">` +
        `<img src="${TM.Items.iconURL(s.id)}" alt="">`;
      if (s.qty > 1) h += `<span class="q">${s.qty}</span>`;
      if (s.dur !== undefined) h += `<span class="dur"><i style="width:${Math.round(s.dur * 100)}%;background:${s.dur < 0.2 ? '#d05030' : s.dur < 0.5 ? '#c8a040' : '#8ab060'}"></i></span>`;
      if (d.weapon && TM.WEAPONS[d.weapon] && TM.WEAPONS[d.weapon].kind === 'gun') h += `<span class="mag">${s.mag | 0}</span>`;
      if (qi >= 0) h += `<span class="qs">${qi + 1}</span>`;
      if (eq) h += '<span class="hand"></span>';
      return h + '</button>';
    },

    renderBag() {
      const inv = this.inv;
      this.$list.className = 'inv-list grid';
      let h = '';
      inv.slots.forEach((s, i) => { h += this.cellHTML(s, i, inv); });
      for (let i = inv.slots.length; i < Math.max(12, inv.slots.length + (6 - inv.slots.length % 6) % 6); i++) h += '<div class="inv-cell empty"></div>';
      this.$list.innerHTML = h;
      if (this.sel && inv.slots.indexOf(this.sel) < 0) this.sel = null;
      this.$detail.innerHTML = this.sel ? this.detailHTML(this.sel) : this.summaryHTML();
    },

    summaryHTML() {
      const g = this.game, p = g.player, inv = this.inv;
      const bar = (label, v, col) => `<div class="st-row"><span>${label}</span><div class="st-bar"><i style="width:${Math.max(0, Math.min(100, v))}%;background:${col}"></i></div><b>${Math.round(v)}</b></div>`;
      let h = '<div class="d-title">Superviviente</div>';
      h += bar('Vida', p.hp / p.maxHp * 100, '#a83228');
      h += bar('Comida', p.hunger, '#b08040');
      h += bar('Agua', p.thirst, '#3a78b8');
      const st = [];
      if (p.bleedT > 0) st.push('<span class="tag red">Sangrando: usa una venda</span>');
      if (p.infection >= 0.25) st.push('<span class="tag green">Infección: busca antibióticos</span>');
      else if (p.infection > 0) st.push('<span class="tag green">Mordedura: come y bebe bien</span>');
      if (p.painT > 0) st.push(`<span class="tag">Analgésicos: ${Math.ceil(p.painT)} s</span>`);
      if (st.length) h += `<div class="tags">${st.join('')}</div>`;
      const pk = inv.pack ? DB()[inv.pack] : null;
      h += `<div class="d-stats">Mochila: ${pk ? esc(pk.name) + ' (+' + pk.pack + ' kg)' : 'la de siempre'}</div>`;
      const known = Object.keys(inv.known);
      if (known.length) h += `<div class="d-stats">Planos: ${known.map((k) => esc((TM.Crafting.BP_NAMES[k] || k).replace('Plano: ', ''))).join(', ')}</div>`;
      h += '<div class="d-hint">Toca un objeto para verlo. Los accesos rápidos (1, 2, 3) se usan en combate sin abrir la mochila.</div>';
      return h;
    },

    detailHTML(s) {
      const d = DB()[s.id], inv = this.inv, p = this.game.player;
      const W = d.weapon && TM.WEAPONS[d.weapon];
      let h = `<div class="d-head"><img src="${TM.Items.iconURL(s.id)}" alt=""><div><div class="d-name">${esc(d.name)}${s.qty > 1 ? ' ×' + s.qty : ''}</div>` +
        `<div class="d-sub" style="color:${TM.Items.TIER_COLORS[d.tier]}">${TM.Items.CAT_NAMES[d.cat]} · ${TM.Items.TIER_NAMES[d.tier]}</div></div></div>`;
      h += `<div class="d-desc">${esc(d.desc)}</div>`;
      const stats = [];
      stats.push(`Peso: ${kg(d.weight * s.qty)}`);
      if (W && W.kind === 'gun') stats.push(`Cargador: ${s.mag | 0}/${W.magSize} · ${esc(TM.Items.name(W.ammo))}: ${inv.count(W.ammo)}`);
      if (W && W.kind !== 'throw') stats.push(`Daño: ${W.pellets > 1 ? W.pellets + '×' : ''}${W.damage}` + (W.kind === 'gun' ? ` · Ruido: ${W.noise > 900 ? 'enorme' : W.noise > 500 ? 'alto' : 'bajo'}` : ` · Ruido: bajo`));
      if (s.dur !== undefined) stats.push(`${d.weapon === 'pistol_sil' ? 'Silenciador' : 'Estado'}: ${Math.round(s.dur * 100)} %`);
      if (d.food) stats.push(`Comida +${d.food}`);
      if (d.water) stats.push(`Agua ${d.water > 0 ? '+' : ''}${d.water}`);
      if (d.heal) stats.push(`Vida +${d.heal}`);
      if (d.pack) stats.push(`Capacidad +${d.pack} kg`);
      if (d.learns && inv.known[d.learns]) stats.push('Ya lo conoces');
      h += `<div class="d-stats">${stats.join('<br>')}</div>`;
      // acciones
      let prim = PRIMARY[d.cat] || (d.pack ? 'PONÉRMELA' : '');
      let disabled = false;
      if (d.cat === 'weapon' && inv.equipped === s) { prim = 'EN LA MANO'; disabled = true; }
      if (d.cat === 'med') prim = d.stopBleed && p.bleedT > 0 ? 'CURARME' : 'USAR';
      if (d.learns && inv.known[d.learns]) disabled = true;
      h += '<div class="d-actions">';
      if (prim) h += `<button class="ibtn primary" data-a="use"${disabled ? ' disabled' : ''}>${prim}</button>`;
      if (s.qty > 1) h += '<button class="ibtn" data-a="drop1">SOLTAR 1</button>';
      h += `<button class="ibtn" data-a="drop">${s.qty > 1 ? 'SOLTAR TODO' : 'SOLTAR'}</button>`;
      h += '</div>';
      if (prim && d.cat !== 'blueprint' && !d.pack) {
        h += '<div class="d-quick"><span>Rápido</span>';
        for (let i = 0; i < 3; i++) h += `<button class="ibtn qk${inv.quick[i] === s.id ? ' on' : ''}" data-a="q${i}">${i + 1}</button>`;
        h += '</div>';
      }
      return h;
    },

    renderCraft() {
      const inv = this.inv;
      this.$list.className = 'inv-list rows';
      const list = TM.Crafting.list(inv);
      this._craftList = list;
      let h = '';
      list.forEach((e, i) => {
        const r = e.recipe, out = r.out;
        const d = DB()[out[0]];
        const name = r.repair ? `Reparar ${d.name.toLowerCase()} (${Math.round(r.target.dur * 100)} %)` : d.name + (out[1] > 1 ? ' ×' + out[1] : '');
        const cls = e.st.ok ? 'ok' : e.st.locked ? 'locked' : 'miss';
        const sel = this.selRecipe && (this.selRecipe === r || (r.repair && this.selRecipe.repair && this.selRecipe.target === r.target)) ? ' sel' : '';
        h += `<button class="cr-row ${cls}${sel}" data-i="${i}"><img src="${TM.Items.iconURL(out[0])}" alt=""><span class="cr-name">${esc(name)}</span>` +
          `<span class="cr-st">${e.st.ok ? 'LISTO' : e.st.locked ? 'PLANO' : 'FALTA'}</span></button>`;
      });
      this.$list.innerHTML = h;
      const cur = this.selRecipe && list.find((e) => e.recipe === this.selRecipe || (e.recipe.repair && this.selRecipe.repair && e.recipe.target === this.selRecipe.target));
      if (cur) { this.selRecipe = cur.recipe; this.$detail.innerHTML = this.recipeHTML(cur); }
      else { this.selRecipe = null; this.$detail.innerHTML = '<div class="d-title">Fabricar</div><div class="d-hint">Elige una receta. Las marcadas con PLANO se aprenden leyendo planos que encuentres en escuelas, ferreterías, comisarías y bases militares.</div>'; }
    },

    recipeHTML(e) {
      const r = e.recipe, inv = this.inv;
      const d = DB()[r.out[0]];
      const title = r.repair ? 'Reparar: ' + d.name : d.name + (r.out[1] > 1 ? ' ×' + r.out[1] : '');
      let h = `<div class="d-head"><img src="${TM.Items.iconURL(d.id)}" alt=""><div><div class="d-name">${esc(title)}</div>` +
        `<div class="d-sub" style="color:${TM.Items.TIER_COLORS[d.tier]}">${TM.Items.CAT_NAMES[d.cat]}</div></div></div>`;
      if (!r.repair) h += `<div class="d-desc">${esc(d.desc)}</div>`;
      else h += `<div class="d-desc">Recupera ${r.kind === 'sil' ? 'el silenciador por completo' : 'un 40 % de su estado'}.</div>`;
      h += '<div class="cr-need">';
      for (const [id, n] of r.need) {
        const have = inv.count(id);
        h += `<div class="need ${have >= n ? 'ok' : 'no'}"><img src="${TM.Items.iconURL(id)}" alt=""><span>${esc(TM.Items.name(id))}</span><b>${Math.min(have, 999)}/${n}</b></div>`;
      }
      if (r.tool) h += `<div class="need ${inv.has(r.tool) ? 'ok' : 'no'}"><img src="${TM.Items.iconURL(r.tool)}" alt=""><span>Herramienta: ${esc(TM.Items.name(r.tool))}</span><b>${inv.has(r.tool) ? '✓' : '✗'}</b></div>`;
      if (r.bp && !inv.known[r.bp]) h += `<div class="need no lock"><span>Requiere el ${esc(TM.Crafting.BP_NAMES[r.bp])}</span></div>`;
      h += '</div>';
      h += `<div class="d-actions"><button class="ibtn primary big" data-a="craft"${e.st.ok ? '' : ' disabled'}>${r.repair ? 'REPARAR' : 'FABRICAR'}</button></div>`;
      return h;
    },

    // ---------- eventos ----------
    onListClick(e) {
      const inv = this.inv;
      if (this.tab === 'bag') {
        const b = e.target.closest('.inv-cell'); if (!b || b.classList.contains('empty')) return;
        const s = inv.slots[+b.dataset.i];
        this.sel = this.sel === s ? null : s;
        this.click();
        this.renderBag();
      } else {
        const b = e.target.closest('.cr-row'); if (!b) return;
        const ent = this._craftList[+b.dataset.i];
        this.selRecipe = ent ? ent.recipe : null;
        this.click();
        this.renderCraft();
      }
    },

    onDetailClick(e) {
      const b = e.target.closest('button[data-a]'); if (!b || b.disabled) return;
      const a = b.dataset.a, g = this.game, inv = this.inv, it = g.combat && g.combat.interact;
      if (a === 'craft') return this.doCraft();
      const s = this.sel;
      if (!s || inv.slots.indexOf(s) < 0 || !it) return;
      const d = DB()[s.id];
      if (a === 'use') {
        // consumir tarda: se cierra la mochila y se hace en tiempo real
        const closes = d.cat === 'food' || d.cat === 'drink' || d.cat === 'med' || d.cat === 'throwable';
        if (closes) {
          this.close();
          it.useItem(s);
          return;
        }
        const ok = it.useItem(s);
        this.click();
        if (d.cat === 'weapon' && ok) this.toast('En la mano: ' + d.name);
        if (d.pack && ok) { this.toast('Ahora llevas ' + d.name); this.sel = null; }
        if (d.cat === 'blueprint') { this.toast(ok ? 'Plano aprendido: mira FABRICAR' : 'Ya conoces este plano', !ok); if (ok) this.sel = null; }
      } else if (a === 'drop' || a === 'drop1') {
        it.drop(s, a === 'drop1' ? 1 : s.qty);
        if (inv.slots.indexOf(s) < 0) this.sel = null;
        this.toast('Soltado en el suelo');
      } else if (a[0] === 'q') {
        inv.setQuick(+a.slice(1), s.id);
        this.click();
      }
      this.render();
    },

    doCraft() {
      const r = this.selRecipe, inv = this.inv, g = this.game;
      if (!r) return;
      const res = TM.Crafting.craft(inv, r);
      if (res.ok) {
        if (TM.Audio) TM.Audio.play('craft');
        if (res.leftover) { g.combat.interact.dropStack(res.leftover, g.player.x, g.player.y); this.toast(res.text + ' (al suelo: mochila llena)'); }
        else this.toast(res.text);
        if (res.toolBroke) setTimeout(() => this.toast('Se rompió: ' + TM.Items.name(res.toolBroke), true), 900);
        if (r.repair && r.target.dur >= 0.97) this.selRecipe = null;
      } else {
        this.toast(res.text, true);
        if (TM.Audio) TM.Audio.play('empty_click');
      }
      this.render();
    },

    // ---------- panel de botín (no pausa) ----------
    showLoot(l) {
      this.init();
      if (this.loot) this.closeLoot();
      this.loot = l;
      l.world = this.game.world;
      const it = this.game.combat.interact;
      it.loot = l;
      this.lootEl.className = 'show r-' + l.rarity;
      this.placeLoot();
      this.renderLoot();
    },

    // Arriba, entre el borde izquierdo y la columna derecha del HUD (arma, USAR): no la tapa.
    placeLoot() {
      const In = TM.Input, W = In.w || window.innerWidth;
      const right = W - In.s * 3.7 - 8, left = 8;
      const w = Math.min(600, right - left);
      const x = left + Math.max(0, (right - left - w) / 2);
      const st = this.lootEl.style;
      st.left = x + 'px'; st.width = w + 'px';
    },

    renderLoot() {
      const l = this.loot;
      if (!l) return;
      const inv = this.inv;
      const rt = { common: '', rare: ' · raro', legendary: ' · ¡legendario!' }[l.rarity] || '';
      this.lootEl.querySelector('.lt-title').textContent = l.title.toUpperCase() + rt;
      this.lootEl.querySelector('.lt-w').textContent = `${kg(inv.weight())} / ${inv.maxWeight} kg`;
      let h = '';
      l.stacks.forEach((s, i) => {
        if (s.qty <= 0) return;
        const d = DB()[s.id];
        h += `<button class="lt-item t${d.tier}" data-i="${i}"><span class="ic"><img src="${TM.Items.iconURL(s.id)}" alt="">` +
          `${s.qty > 1 ? '<b class="q">' + s.qty + '</b>' : ''}</span><span class="nm">${esc(d.name)}</span></button>`;
      });
      this.lootEl.querySelector('.lt-items').innerHTML = h;
    },

    lootTake(i) {
      const l = this.loot;
      if (!l || !l.stacks[i]) return;
      this.game.combat.interact.takeStack(l.stacks[i]);
      if (!l.stacks.some((s) => s.qty > 0)) { this.closeLoot(); return; }
      this.renderLoot();
    },

    lootTakeAll() {
      const l = this.loot;
      if (!l) return;
      const it = this.game.combat.interact;
      for (const s of l.stacks) if (s.qty > 0) it.takeStack(s);
      if (!l.stacks.some((s) => s.qty > 0)) { this.closeLoot(); return; }
      this.renderLoot();
    },

    closeLoot() {
      const l = this.loot;
      this.loot = null;
      if (this.lootEl) this.lootEl.className = '';
      const g = this.game;
      if (g && g.combat && g.combat.interact) g.combat.interact.lootClosed(l);
    },
  };

  TM.InvUI = InvUI;
})();
