// Inventario del jugador: pilas, límite de peso, arma equipada, accesos rápidos y planos aprendidos.
(function () {
  const U = TM.U;
  const DB = () => TM.Items.DB;

  const BASE_WEIGHT = 20;     // kg sin mochila
  const HARD_LIMIT = 1.5;     // no se puede recoger por encima de 1,5 × la capacidad
  const MAX_SLOTS = 30;

  function cloneStack(s, qty) {
    const o = { id: s.id, qty: qty === undefined ? s.qty : qty };
    if (s.dur !== undefined && s.dur !== null) o.dur = s.dur;
    if (s.mag !== undefined && s.mag !== null) o.mag = s.mag;
    return o;
  }

  class Inventory {
    constructor() {
      this.slots = [];
      this.maxSlots = MAX_SLOTS;
      this.baseWeight = BASE_WEIGHT;
      this.pack = null;            // id de la mochila que lleva puesta
      this.quick = [null, null, null];
      this.equipped = null;        // pila del arma en la mano (null = puños)
      this.ready = null;           // arrojable preparado para lanzar (pila)
      this.known = {};             // planos aprendidos: { municion: true, ... }
      this.version = 0;            // sube con cada cambio (la interfaz se refresca solo entonces)
      this._w = 0; this._wv = -1;
    }

    get maxWeight() {
      const d = this.pack && DB()[this.pack];
      return this.baseWeight + (d && d.pack ? d.pack : 0);
    }

    changed() { this.version++; }

    weight() {
      if (this._wv !== this.version) {
        let w = 0;
        for (const s of this.slots) { const d = DB()[s.id]; if (d) w += d.weight * s.qty; }
        this._w = w; this._wv = this.version;
      }
      return this._w;
    }

    load() { return this.weight() / this.maxWeight; }

    // Multiplicador de velocidad por sobrepeso (1 = normal)
    speedFactor() {
      const l = this.load();
      return l <= 1 ? 1 : Math.max(0.5, 1 - (l - 1) * 0.8);
    }
    canSprint() { return this.load() <= 1.25; }

    // Cuántas unidades de `id` se pueden recoger sin pasar el límite duro de peso
    fitQty(id, qty) {
      const d = DB()[id];
      if (!d) return 0;
      if (d.weight <= 0) return qty;
      const room = this.maxWeight * HARD_LIMIT - this.weight();
      return U.clamp(Math.floor(room / d.weight + 1e-6), 0, qty);
    }

    // Añade una pila. Devuelve el sobrante (pila) o null si cupo todo. No mira el peso (ver fitQty).
    add(stack) {
      const d = stack && DB()[stack.id];
      if (!d) return null;
      let qty = Math.max(1, stack.qty | 0);
      const had = this.count(d.id) > 0;
      if (d.stack > 1) {
        for (const s of this.slots) {
          if (qty <= 0) break;
          if (s.id !== d.id || s.qty >= d.stack) continue;
          const n = Math.min(qty, d.stack - s.qty);
          s.qty += n; qty -= n;
        }
      }
      while (qty > 0 && this.slots.length < this.maxSlots) {
        const n = Math.min(qty, d.stack);
        const s = cloneStack(stack, n);
        if (d.dur && s.dur === undefined) s.dur = 1;
        const w = d.weapon && TM.WEAPONS && TM.WEAPONS[d.weapon];
        if (w && w.kind === 'gun' && s.mag === undefined) s.mag = 0;
        this.slots.push(s);
        qty -= n;
      }
      // medicinas y arrojables nuevos ocupan un acceso rápido libre
      if (!had && (d.cat === 'med' || d.cat === 'throwable') && this.quick.indexOf(d.id) < 0) {
        const i = this.quick.indexOf(null);
        if (i >= 0) this.quick[i] = d.id;
      }
      this.changed();
      return qty > 0 ? cloneStack(stack, qty) : null;
    }

    count(id) {
      let n = 0;
      for (const s of this.slots) if (s.id === id) n += s.qty;
      return n;
    }
    has(id, qty) { return this.count(id) >= (qty || 1); }
    find(id) { for (const s of this.slots) if (s.id === id) return s; return null; }

    // Quita `qty` unidades de `id` (de las últimas pilas primero, el arma equipada al final).
    remove(id, qty) {
      qty = qty === undefined ? 1 : qty;
      let left = qty;
      for (let pass = 0; pass < 2 && left > 0; pass++) {
        for (let i = this.slots.length - 1; i >= 0 && left > 0; i--) {
          const s = this.slots[i];
          if (s.id !== id) continue;
          if (pass === 0 && (s === this.equipped || s === this.ready)) continue;
          const n = Math.min(left, s.qty);
          s.qty -= n; left -= n;
          if (s.qty <= 0) this._drop(i);
        }
      }
      if (left !== qty) this.changed();
      return qty - left;
    }

    // Quita unidades de una pila concreta (devuelve la parte quitada como pila nueva)
    removeStack(stack, qty) {
      const i = this.slots.indexOf(stack);
      if (i < 0) return null;
      qty = qty === undefined ? stack.qty : Math.min(qty, stack.qty);
      const out = cloneStack(stack, qty);
      stack.qty -= qty;
      if (stack.qty <= 0) this._drop(i);
      this.changed();
      return out;
    }

    _drop(i) {
      const s = this.slots[i];
      this.slots.splice(i, 1);
      if (s === this.equipped) this.equipped = null;
      if (s === this.ready) this.ready = null;
    }

    // ---------- armas ----------
    equip(stack) {
      if (stack && (this.slots.indexOf(stack) < 0 || !TM.Items.isWeapon(stack.id))) return false;
      this.equipped = stack || null;
      this.ready = null;
      this.changed();
      return true;
    }

    // Arma (definición de TM.WEAPONS) que se usa ahora: arrojable preparado > arma equipada > puños
    activeWeaponId() {
      if (this.ready) return DB()[this.ready.id].weapon;
      if (this.equipped) return DB()[this.equipped.id].weapon;
      return 'fists';
    }
    activeStack() { return this.ready || this.equipped; }

    weaponStacks() {
      return this.slots.filter((s) => { const d = DB()[s.id]; return d && d.cat === 'weapon'; });
    }

    // Siguiente arma del ciclo (armas de fuego y cuerpo a cuerpo; puños solo si no hay cuerpo a cuerpo)
    cycleWeapon() {
      const list = this.weaponStacks();
      const hasMelee = list.some((s) => TM.WEAPONS[DB()[s.id].weapon].kind === 'melee');
      const cyc = hasMelee ? list : list.concat([null]);
      if (!cyc.length) return null;
      const i = cyc.indexOf(this.equipped);
      const next = cyc[(i + 1) % cyc.length];
      this.equip(next);
      return next;
    }

    setReady(stack) {
      if (stack && this.slots.indexOf(stack) < 0) return;
      this.ready = stack || null;
      this.changed();
    }

    // ---------- accesos rápidos (guardan el id del objeto) ----------
    setQuick(i, id) {
      if (i < 0 || i >= this.quick.length) return;
      if (this.quick[i] === id) { this.quick[i] = null; this.changed(); return; }
      for (let k = 0; k < this.quick.length; k++) if (this.quick[k] === id) this.quick[k] = null;
      this.quick[i] = id;
      this.changed();
    }

    // Pila que usaría el acceso rápido i (la del arma equipada si coincide, si no la primera)
    quickStack(i) {
      const id = this.quick[i];
      if (!id) return null;
      const act = this.activeStack();
      if (act && act.id === id) return act;
      return this.find(id);
    }

    // ---------- persistencia ----------
    serialize() {
      return {
        v: 1,
        s: this.slots.map((s) => [s.id, s.qty, s.dur === undefined ? null : +s.dur.toFixed(3), s.mag === undefined ? null : s.mag]),
        e: this.slots.indexOf(this.equipped),
        q: this.quick.slice(),
        p: this.pack,
        k: Object.keys(this.known),
      };
    }

    deserialize(d) {
      if (!d || !Array.isArray(d.s)) return;
      const db = DB();
      this.slots = [];
      for (const a of d.s) {
        if (!Array.isArray(a) || !db[a[0]]) continue;
        const def = db[a[0]];
        const s = { id: a[0], qty: U.clamp(a[1] | 0, 1, def.stack) };
        if (Number.isFinite(a[2])) s.dur = U.clamp(a[2], 0.01, 1);
        else if (def.dur) s.dur = 1;
        if (Number.isFinite(a[3])) s.mag = Math.max(0, a[3] | 0);
        if (this.slots.length < this.maxSlots) this.slots.push(s);
      }
      this.equipped = (d.e >= 0 && this.slots[d.e] && TM.Items.isWeapon(this.slots[d.e].id)) ? this.slots[d.e] : null;
      this.ready = null;
      this.quick = [null, null, null];
      if (Array.isArray(d.q)) for (let i = 0; i < 3; i++) this.quick[i] = db[d.q[i]] ? d.q[i] : null;
      this.pack = d.p && db[d.p] && db[d.p].pack ? d.p : null;
      this.known = {};
      if (Array.isArray(d.k)) for (const k of d.k) this.known[k] = true;
      this.changed();
    }

    // Equipo inicial: pistola, algo de 9 mm, 1 venda, 1 agua, 1 lata
    giveStarter() {
      this.slots = [];
      this.add({ id: 'pistol', qty: 1, mag: 12 });
      this.add({ id: 'ammo_9mm', qty: 12 });
      this.add({ id: 'venda', qty: 1 });
      this.add({ id: 'agua', qty: 1 });
      this.add({ id: 'lata', qty: 1 });
      this.equipped = this.find('pistol');
      this.quick = ['venda', 'agua', 'lata'];
      this.changed();
    }
  }

  Inventory.HARD_LIMIT = HARD_LIMIT;
  Inventory.cloneStack = cloneStack;
  TM.Inventory = Inventory;
})();
