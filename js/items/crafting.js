// Fabricación: recetas (algunas se desbloquean con planos) y reparación con cinta.
(function () {
  const DB = () => TM.Items.DB;

  // need: [[id, cantidad]], tool: herramienta necesaria (no se gasta, pierde algo de durabilidad),
  // bp: plano necesario, keep: id del ingrediente cuya durabilidad/cargador pasa al resultado.
  const RECIPES = [
    { id: 'venda', out: ['venda', 1], need: [['tela', 3]] },
    { id: 'botiquin', out: ['botiquin', 1], need: [['venda', 3], ['alcohol', 1]] },
    { id: 'molotov', out: ['molotov', 1], need: [['botella', 1], ['alcohol', 1], ['tela', 1]], tool: 'encendedor' },
    { id: 'molotov_gas', out: ['molotov', 3], need: [['botella', 3], ['gasolina', 1], ['tela', 3]], tool: 'encendedor' },
    { id: 'petardo', out: ['firecracker', 2], need: [['polvora', 2], ['tela', 1]], tool: 'encendedor' },
    { id: 'club', out: ['club', 1], need: [['madera', 2], ['cinta', 1]] },
    { id: 'bat_nails', out: ['bat_nails', 1], need: [['bat', 1], ['clavos', 8], ['cinta', 1]], keep: 'bat' },
    { id: 'mochila_improvisada', out: ['mochila_improvisada', 1], need: [['tela', 8], ['cuerda', 2], ['cinta', 2]] },
    { id: 'ammo_9mm', out: ['ammo_9mm', 8], need: [['polvora', 2], ['chatarra', 1]], tool: 'martillo', bp: 'municion' },
    { id: 'ammo_shell', out: ['ammo_shell', 4], need: [['polvora', 3], ['chatarra', 1], ['tela', 1]], tool: 'martillo', bp: 'municion' },
    { id: 'ammo_rifle', out: ['ammo_rifle', 3], need: [['polvora', 3], ['chatarra', 2]], tool: 'martillo', bp: 'municion' },
    { id: 'spear', out: ['spear', 1], need: [['pipe', 1], ['knife', 1], ['cinta', 2]], bp: 'mejoras', keep: 'pipe' },
    { id: 'pistol_sil', out: ['pistol_sil', 1], need: [['pistol', 1], ['botella', 1], ['cinta', 2], ['tela', 2]], tool: 'sierra', bp: 'mejoras', keep: 'pistol' },
    { id: 'pipebomb', out: ['pipebomb', 1], need: [['chatarra', 2], ['polvora', 5], ['cinta', 1], ['clavos', 6]], tool: 'llave', bp: 'explosivos' },
    { id: 'flare', out: ['flare', 2], need: [['polvora', 2], ['chatarra', 1], ['tela', 1]], bp: 'explosivos' },
    // recetas que se aprenden subiendo la habilidad Supervivencia (skill: [habilidad, nivel])
    { id: 'venda_lote', out: ['venda', 2], need: [['tela', 4]], skill: ['survival', 2], label: 'Vendas (lote)' },
    { id: 'botiquin_campo', out: ['botiquin', 1], need: [['venda', 2], ['alcohol', 1], ['tela', 2]], skill: ['survival', 4], label: 'Botiquín de campaña' },
    { id: 'flare_sup', out: ['flare', 1], need: [['polvora', 2], ['chatarra', 1], ['tela', 1]], skill: ['survival', 6], label: 'Bengala improvisada' },
    { id: 'molotov_sup', out: ['molotov', 1], need: [['botella', 1], ['alcohol', 1], ['tela', 1]], skill: ['survival', 8], label: 'Molotov sin mechero' },
  ];
  const SKILL_NAMES = { survival: 'Supervivencia' };
  function skillLv(id) { const g = TM.game, p = g && g.player; return p && p.skills ? p.skills.level(id) : 0; }

  const BP_NAMES = { municion: 'Plano: munición casera', explosivos: 'Plano: explosivos', mejoras: 'Plano: mejoras de armas', refugio: 'Plano: refugio' };

  // Reparación: madera = cinta; metal = cinta + chatarra; silenciador = botella + cinta
  const REPAIR = {
    bat: 'wood', bat_nails: 'wood', club: 'wood', spear: 'metal', knife: 'metal', pipe: 'metal', machete: 'metal',
    axe: 'metal', martillo: 'metal', sierra: 'metal', llave: 'metal', pistol_sil: 'sil',
  };
  const REPAIR_NEED = { wood: [['cinta', 1]], metal: [['cinta', 1], ['chatarra', 1]], sil: [['botella', 1], ['cinta', 1]] };
  const REPAIR_AMOUNT = { wood: 0.4, metal: 0.4, sil: 1 };
  const TOOL_WEAR = 0.025;

  function missingOf(inv, need) {
    const miss = [];
    for (const [id, n] of need) { const have = inv.count(id); if (have < n) miss.push([id, n - have]); }
    return miss;
  }

  const Crafting = {
    RECIPES, BP_NAMES, SKILL_NAMES,

    status(inv, r) {
      const skLocked = !!(r.skill && skillLv(r.skill[0]) < r.skill[1]);
      const locked = !!(r.bp && !inv.known[r.bp]) || skLocked;
      const miss = missingOf(inv, r.need);
      const toolOk = !r.tool || inv.has(r.tool);
      return { locked, skLocked, miss, toolOk, ok: !locked && !miss.length && toolOk };
    },

    // Lista para la interfaz: recetas normales + reparaciones de lo que esté gastado
    list(inv) {
      const out = [];
      for (const r of RECIPES) out.push({ recipe: r, st: this.status(inv, r) });
      for (const s of inv.slots) {
        const kind = REPAIR[s.id];
        if (!kind || s.dur === undefined || s.dur > 0.97) continue;
        const r = { id: 'repair', repair: true, target: s, out: [s.id, 1], need: REPAIR_NEED[kind], kind };
        out.push({ recipe: r, st: this.status(inv, r) });
      }
      // primero lo que se puede fabricar, luego lo que falta material, al final lo bloqueado
      const rank = (e) => (e.st.ok ? 0 : e.st.locked ? 2 : 1);
      out.sort((a, b) => rank(a) - rank(b));
      return out;
    },

    // Fabrica. Devuelve { ok, text, stack? }.
    craft(inv, r) {
      const st = this.status(inv, r);
      if (st.skLocked) return { ok: false, text: `Necesitas ${SKILL_NAMES[r.skill[0]] || r.skill[0]} ${r.skill[1]}` };
      if (st.locked) return { ok: false, text: 'Necesitas el ' + BP_NAMES[r.bp] };
      if (!st.toolOk) return { ok: false, text: 'Necesitas: ' + TM.Items.name(r.tool) };
      if (st.miss.length) return { ok: false, text: 'Te falta material' };
      if (r.repair) {
        const s = r.target;
        if (inv.slots.indexOf(s) < 0) return { ok: false, text: 'Ya no lo tienes' };
        for (const [id, n] of r.need) inv.remove(id, n);
        s.dur = Math.min(1, (s.dur || 0) + REPAIR_AMOUNT[r.kind]);
        inv.changed();
        return { ok: true, text: `${TM.Items.name(s.id)} reparado (${Math.round(s.dur * 100)} %)`, stack: s };
      }
      // el ingrediente que conserva durabilidad/cargador: el más gastado, para aprovecharlo
      let kept = null;
      if (r.keep) {
        for (const s of inv.slots) if (s.id === r.keep && (!kept || (s.dur || 1) < (kept.dur || 1))) kept = s;
      }
      const wasEquipped = kept && inv.equipped === kept;
      const keptCopy = kept ? TM.Inventory.cloneStack(kept) : null;
      if (kept) inv.removeStack(kept, 1);
      for (const [id, n] of r.need) {
        if (kept && id === r.keep) continue;
        inv.remove(id, n);
      }
      const d = DB()[r.out[0]];
      const res = { id: d.id, qty: r.out[1] };
      if (d.dur) res.dur = 1;
      if (keptCopy) {
        if (keptCopy.mag !== undefined) res.mag = keptCopy.mag;
        // el silenciador sale nuevo; las armas mejoradas conservan su desgaste
        if (d.id !== 'pistol_sil' && keptCopy.dur !== undefined) res.dur = keptCopy.dur;
        if (r.id === 'spear') {
          res.dur = Math.min(1, (keptCopy.dur || 1) * 0.5 + 0.5);
        }
      }
      if (r.tool) {
        const t = inv.find(r.tool);
        if (t && t.dur !== undefined) {
          t.dur -= TOOL_WEAR;
          if (t.dur <= 0) { inv.removeStack(t); res.toolBroke = r.tool; }
        }
      }
      const left = inv.add(res);
      const pl = TM.game && TM.game.player;
      if (pl && pl.skills) pl.skills.gain('survival', 4);
      if (wasEquipped) { const ns = inv.slots[inv.slots.length - 1]; if (ns && ns.id === res.id) inv.equip(ns); }
      return { ok: true, text: `Fabricado: ${TM.Items.label(res)}`, stack: res, leftover: left, toolBroke: res.toolBroke };
    },

    // Usar un plano: aprende sus recetas
    learn(inv, stack) {
      const d = DB()[stack.id];
      if (!d || !d.learns) return { ok: false, text: '' };
      if (inv.known[d.learns]) return { ok: false, text: 'Ya conoces este plano' };
      inv.known[d.learns] = true;
      inv.removeStack(stack, 1);
      const names = RECIPES.filter((r) => r.bp === d.learns).map((r) => TM.Items.name(r.out[0]));
      return { ok: true, text: names.length ? 'Aprendiste: ' + names.join(', ') : 'Aprendiste: ' + d.name.replace('Plano: ', '') };
    },
  };

  TM.Crafting = Crafting;
})();
