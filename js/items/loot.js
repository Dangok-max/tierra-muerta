// Botín: tablas por tipo de edificio, rareza del contenedor y peligro de la zona.
(function () {
  const DB = () => TM.Items.DB;

  // Entrada: [id, peso, min, max, tier?]  (tier por defecto = el del objeto; aquí se puede rebajar
  // para que algo raro en general sea normal en su sitio: munición en la comisaría, vendas en la farmacia).
  const SEEDS = (w, a, b) => [['semillas_papa', w, a, b], ['semillas_maiz', w, a, b], ['semillas_tomate', w, a, b]];
  const T = {
    house: [
      ['lata', 10, 1, 2], ['galletas', 7, 1, 2], ['barrita', 6, 1, 2], ['manzana', 4, 1, 2], ['refresco', 7, 1, 1],
      ['agua', 11, 1, 1], ['jugo', 5, 1, 1], ['chocolate', 3, 1, 1],
      ['venda', 7, 1, 2], ['analgesicos', 4, 1, 1], ['antibioticos', 1.2, 1, 1],
      ['tela', 8, 2, 4], ['cinta', 4, 1, 1], ['botella', 6, 1, 2], ['alcohol', 4, 1, 1], ['cuerda', 2, 1, 1],
      ['clavos', 3, 5, 15], ['madera', 2, 1, 1], ['electronica', 2, 1, 1],
      ['encendedor', 3, 1, 1], ['martillo', 1.5, 1, 1], ['knife', 3.5, 1, 1], ['bat', 3, 1, 1], ['pipe', 1.5, 1, 1],
      ['ammo_9mm', 4.5, 3, 8, 0], ['ammo_shell', 1.5, 2, 4], ['pistol', 0.8, 1, 1], ['shotgun', 0.35, 1, 1],
      ['mochila_escolar', 1.2, 1, 1], ...SEEDS(1, 3, 8), ['plano_refugio', 0.6, 1, 1], ['plano_municion', 0.3, 1, 1],
      ['plano_mejoras', 0.3, 1, 1], ['molotov', 0.5, 1, 1], ['firecracker', 1.5, 1, 2], ['flare', 0.8, 1, 1],
    ],
    pharmacy: [
      ['venda', 14, 1, 3, 0], ['botiquin', 4, 1, 1, 1], ['analgesicos', 10, 1, 2, 0], ['antibioticos', 6, 1, 1, 1],
      ['alcohol', 7, 1, 1], ['tela', 5, 2, 3], ['agua', 5, 1, 1], ['barrita', 4, 1, 2], ['refresco', 3, 1, 1],
      ['chocolate', 2, 1, 1], ['jugo', 2, 1, 1],
    ],
    hospital: [
      ['venda', 12, 2, 3, 0], ['botiquin', 6, 1, 1, 1], ['analgesicos', 8, 1, 2, 0], ['antibioticos', 7, 1, 2, 1],
      ['alcohol', 6, 1, 1], ['tela', 6, 2, 4], ['agua', 4, 1, 1], ['electronica', 3, 1, 1], ['knife', 1.5, 1, 1],
      ['cinta', 3, 1, 1], ['racion', 0.5, 1, 1], ['barrita', 2, 1, 1],
    ],
    supermarket: [
      ['lata', 14, 1, 3], ['galletas', 10, 1, 2], ['barrita', 8, 1, 3], ['cecina', 6, 1, 1, 0], ['chocolate', 5, 1, 2, 0],
      ['manzana', 4, 1, 3], ['agua', 12, 1, 2], ['refresco', 10, 1, 2], ['jugo', 7, 1, 2], ['alcohol', 6, 1, 1],
      ['cinta', 3, 1, 1], ['tela', 2, 2, 2], ['botella', 4, 1, 2], ['encendedor', 4, 1, 1], ...SEEDS(1.5, 3, 8),
      ['venda', 2, 1, 1], ['analgesicos', 1.5, 1, 1], ['knife', 1.5, 1, 1], ['mochila_escolar', 1, 1, 1],
      ['firecracker', 1, 1, 3],
    ],
    gas: [
      ['gasolina', 9, 1, 1, 0], ['refresco', 8, 1, 2], ['agua', 6, 1, 1], ['barrita', 7, 1, 2], ['chocolate', 5, 1, 1, 0],
      ['galletas', 4, 1, 1], ['cecina', 3, 1, 1], ['encendedor', 7, 1, 1], ['cinta', 5, 1, 1], ['llave', 3, 1, 1],
      ['bujias', 4, 1, 2], ['alcohol', 3, 1, 1], ['botella', 4, 1, 2], ['tela', 3, 2, 2], ['pipe', 1.5, 1, 1],
      ['ammo_9mm', 1.5, 3, 6, 0], ['flare', 2, 1, 1], ['neumatico', 0.8, 1, 1], ['bateria', 0.8, 1, 1],
      ['firecracker', 1.5, 1, 2],
    ],
    hardware: [
      ['madera', 10, 1, 3], ['clavos', 10, 10, 30], ['chatarra', 9, 1, 3], ['cinta', 9, 1, 2], ['cuerda', 6, 1, 1],
      ['martillo', 4, 1, 1, 0], ['sierra', 3.5, 1, 1, 0], ['llave', 3.5, 1, 1, 0], ['axe', 2, 1, 1, 1],
      ['machete', 2, 1, 1], ['pipe', 4, 1, 1], ['knife', 2, 1, 1], ['polvora', 1.6, 3, 8], ['electronica', 4, 1, 2],
      ['alcohol', 3, 1, 1], ['encendedor', 3, 1, 1], ['botella', 2, 1, 1], ['plano_mejoras', 0.8, 1, 1],
      ['plano_refugio', 1.2, 1, 1], ['plano_explosivos', 0.4, 1, 1], ['gasolina', 1.5, 1, 1], ['mochila_excursion', 0.5, 1, 1],
    ],
    police: [
      ['ammo_9mm', 14, 6, 14, 0], ['ammo_shell', 6, 3, 6, 0], ['pistol', 6, 1, 1, 0], ['shotgun', 3, 1, 1, 1],
      ['smg', 0.8, 1, 1, 2], ['ammo_rifle', 1.5, 3, 6, 1], ['venda', 6, 1, 2], ['botiquin', 2, 1, 1],
      ['analgesicos', 3, 1, 1], ['knife', 2, 1, 1], ['bat', 2, 1, 1], ['flare', 4, 1, 2, 0], ['barrita', 3, 1, 1],
      ['agua', 3, 1, 1], ['refresco', 2, 1, 1], ['cinta', 2, 1, 1], ['mochila_excursion', 0.8, 1, 1],
      ['plano_municion', 1.2, 1, 1], ['firecracker', 1, 1, 2],
    ],
    military: [
      ['ammo_9mm', 10, 10, 24, 0], ['ammo_shell', 6, 4, 8, 0], ['ammo_rifle', 8, 4, 10, 1], ['rifle', 3, 1, 1, 2],
      ['smg', 2.5, 1, 1, 2], ['shotgun', 2.5, 1, 1, 1], ['pistol', 3, 1, 1, 0], ['racion', 8, 1, 2, 1],
      ['agua', 5, 1, 2], ['botiquin', 5, 1, 1, 1], ['venda', 5, 2, 3], ['antibioticos', 3, 1, 1], ['analgesicos', 3, 1, 1],
      ['polvora', 4, 4, 10, 1], ['pipebomb', 2, 1, 1], ['flare', 5, 1, 2, 0], ['machete', 2, 1, 1], ['knife', 3, 1, 1],
      ['mochila_militar', 1.2, 1, 1, 2], ['plano_explosivos', 1.5, 1, 1], ['plano_municion', 1.5, 1, 1], ['llave', 2, 1, 1],
    ],
    bunker: [
      ['ammo_9mm', 8, 12, 30, 0], ['ammo_shell', 5, 6, 12, 0], ['ammo_rifle', 8, 6, 14, 1], ['rifle', 4, 1, 1, 2],
      ['smg', 4, 1, 1, 2], ['shotgun', 3, 1, 1, 1], ['racion', 10, 2, 3, 1], ['agua', 6, 2, 3], ['botiquin', 6, 1, 2, 1],
      ['antibioticos', 5, 1, 2, 1], ['polvora', 5, 6, 14, 1], ['pipebomb', 3, 1, 2], ['mochila_militar', 2.5, 1, 1, 2],
      ['plano_municion', 2, 1, 1], ['plano_explosivos', 2, 1, 1], ['plano_mejoras', 2, 1, 1], ['plano_refugio', 2, 1, 1],
      ...SEEDS(2, 5, 12), ['axe', 1.5, 1, 1],
    ],
    school: [
      ['tela', 8, 2, 4], ['cinta', 7, 1, 2], ['cuerda', 4, 1, 1], ['botella', 5, 1, 2], ['barrita', 6, 1, 2],
      ['galletas', 5, 1, 1], ['refresco', 6, 1, 1], ['jugo', 6, 1, 1], ['manzana', 4, 1, 1], ['analgesicos', 3, 1, 1],
      ['venda', 4, 1, 1], ['bat', 3, 1, 1], ['electronica', 5, 1, 2], ['alcohol', 2, 1, 1], ['polvora', 0.8, 2, 4],
      ['mochila_escolar', 5, 1, 1], ['plano_municion', 1.6, 1, 1, 1], ['plano_explosivos', 1.6, 1, 1, 1],
      ['plano_mejoras', 1.6, 1, 1, 1], ['plano_refugio', 1.6, 1, 1, 1], ['encendedor', 1.5, 1, 1], ...SEEDS(1, 2, 6),
    ],
    garage: [
      ['chatarra', 10, 1, 3], ['llave', 6, 1, 1, 0], ['martillo', 3, 1, 1, 0], ['sierra', 2, 1, 1, 0], ['cinta', 6, 1, 1],
      ['bujias', 7, 1, 3, 0], ['piezas_motor', 4, 1, 1, 1], ['bateria', 3, 1, 1, 0], ['neumatico', 3, 1, 1, 0],
      ['gasolina', 5, 1, 1, 0], ['pipe', 4, 1, 1], ['alcohol', 2, 1, 1], ['tela', 4, 2, 2], ['encendedor', 2, 1, 1],
      ['electronica', 3, 1, 1], ['axe', 0.8, 1, 1], ['plano_mejoras', 0.5, 1, 1],
    ],
    warehouse: [
      ['madera', 8, 1, 3], ['chatarra', 8, 1, 3], ['cuerda', 6, 1, 1], ['cinta', 6, 1, 1], ['clavos', 6, 10, 20],
      ['lata', 6, 1, 3], ['agua', 6, 1, 2], ['galletas', 4, 1, 2], ['gasolina', 3, 1, 1], ['piezas_motor', 1.5, 1, 1],
      ['tela', 4, 2, 4], ['botella', 4, 1, 3], ['electronica', 3, 1, 1], ['pipe', 2, 1, 1], ['mochila_excursion', 0.6, 1, 1],
      ['alcohol', 3, 1, 1],
    ],
    factory: [
      ['chatarra', 12, 2, 4], ['polvora', 2, 3, 6], ['cuerda', 6, 1, 1], ['electronica', 6, 1, 2, 0], ['pipe', 5, 1, 1],
      ['llave', 4, 1, 1], ['sierra', 3, 1, 1], ['martillo', 3, 1, 1], ['cinta', 5, 1, 1], ['clavos', 5, 10, 25],
      ['gasolina', 2, 1, 1], ['tela', 3, 1, 2], ['piezas_motor', 2, 1, 1], ['agua', 2, 1, 1], ['plano_refugio', 1, 1, 1],
      ['plano_explosivos', 0.6, 1, 1],
    ],
    church: [
      ['agua', 8, 1, 2], ['galletas', 7, 1, 2], ['lata', 6, 1, 2], ['venda', 7, 1, 2], ['tela', 8, 2, 4],
      ['alcohol', 3, 1, 1], ['analgesicos', 3, 1, 1], ['encendedor', 4, 1, 1], ['botella', 4, 1, 1], ['manzana', 3, 1, 2],
      ['chocolate', 2, 1, 1], ['plano_refugio', 1, 1, 1], ['antibioticos', 1.2, 1, 1],
    ],
    farmhouse: [
      ...SEEDS(6, 3, 10), ['lata', 6, 1, 2], ['cecina', 6, 1, 2, 0], ['manzana', 6, 1, 3], ['agua', 5, 1, 1],
      ['jugo', 3, 1, 1], ['tela', 5, 2, 3], ['cuerda', 6, 1, 2], ['axe', 2.5, 1, 1, 1], ['machete', 2, 1, 1],
      ['knife', 3, 1, 1], ['shotgun', 1.5, 1, 1], ['ammo_shell', 5, 2, 6, 0], ['gasolina', 3, 1, 1], ['martillo', 2, 1, 1],
      ['sierra', 2, 1, 1], ['madera', 4, 1, 2], ['clavos', 3, 5, 15], ['alcohol', 2, 1, 1], ['mochila_excursion', 0.6, 1, 1],
    ],
    barn: [
      ...SEEDS(5, 4, 12), ['madera', 8, 1, 3], ['cuerda', 6, 1, 2], ['axe', 3, 1, 1, 1], ['pipe', 2, 1, 1],
      ['gasolina', 4, 1, 1, 0], ['chatarra', 5, 1, 2], ['clavos', 4, 5, 15], ['ammo_shell', 3, 2, 4, 0], ['tela', 3, 1, 2],
      ['neumatico', 1, 1, 1], ['bujias', 1.5, 1, 1], ['encendedor', 1.5, 1, 1],
    ],
    car: [
      ['gasolina', 4, 1, 1, 0], ['bujias', 4, 1, 2, 0], ['bateria', 2, 1, 1, 0], ['neumatico', 2, 1, 1, 0], ['llave', 4, 1, 1, 0],
      ['cinta', 4, 1, 1], ['agua', 5, 1, 1], ['refresco', 4, 1, 1], ['barrita', 4, 1, 2], ['lata', 3, 1, 1],
      ['venda', 3, 1, 1], ['tela', 3, 1, 2], ['ammo_9mm', 2.5, 3, 6, 0], ['flare', 3, 1, 1, 0], ['pipe', 2, 1, 1],
      ['bat', 2, 1, 1], ['mochila_escolar', 1, 1, 1], ['encendedor', 2, 1, 1], ['pistol', 0.4, 1, 1],
    ],
  };
  T.other = T.house;

  // Botín garantizado de los contenedores legendarios si su tabla no tiene nada raro
  const LEGEND_POOL = [
    ['rifle', 3, 1, 1], ['smg', 3, 1, 1], ['shotgun', 3, 1, 1], ['mochila_militar', 2, 1, 1], ['mochila_excursion', 3, 1, 1],
    ['botiquin', 4, 1, 2], ['ammo_rifle', 3, 6, 12], ['ammo_9mm', 4, 12, 24], ['ammo_shell', 3, 6, 10], ['racion', 3, 2, 3],
    ['pipebomb', 2, 1, 2], ['antibioticos', 3, 1, 2], ['plano_municion', 2, 1, 1], ['plano_explosivos', 2, 1, 1],
    ['plano_mejoras', 2, 1, 1], ['axe', 2, 1, 1], ['machete', 2, 1, 1],
  ];

  // Filtros por mueble (palabras clave del campo `container`)
  const CONTAINER_FILTERS = [
    [/nevera|refri|frigor|congel/, ['food', 'drink']],
    [/botiqu|medic|farmac/, ['med']],
    [/armer|arsenal|armas/, ['weapon', 'ammo', 'throwable']],
    [/herramient|banco de trabajo/, ['tool', 'material', 'part']],
    [/caja fuerte/, ['ammo', 'weapon', 'med', 'blueprint', 'food']],
    [/despensa|alacena|cocina/, ['food', 'drink', 'material']],
    [/escritorio|archivador|librer/, ['blueprint', 'material', 'med', 'food']],
    [/registradora|mostrador/, ['food', 'tool', 'med', 'throwable']],
    [/c[oó]moda|ropero|armario/, ['material', 'med', 'tool', 'weapon', 'ammo']],
  ];

  const RAR_Q = { common: 0, rare: 0.9, legendary: 2.0 };

  function rngFn(rng) {
    if (!rng) return Math.random;
    if (typeof rng === 'function') return rng;
    if (typeof rng.next === 'function') return () => rng.next();
    return Math.random;
  }

  function tierFactor(tier, q) {
    switch (tier) {
      case 0: return Math.max(0.35, 1 - q * 0.22);
      case 1: return 0.5 + q * 0.35;
      case 2: return 0.09 + q * 0.3;
      default: return q < 0.8 ? 0.006 : 0.03 + (q - 0.8) * 0.16;
    }
  }

  function pickWeighted(list, q, r, exclude) {
    let total = 0;
    const ws = [];
    for (const e of list) {
      const d = DB()[e[0]];
      if (!d || (exclude && exclude.has(e[0]))) { ws.push(0); continue; }
      const tier = e[4] !== undefined ? e[4] : d.tier;
      const w = e[1] * tierFactor(tier, q);
      ws.push(w); total += w;
    }
    if (total <= 0) return null;
    let x = r() * total;
    for (let i = 0; i < list.length; i++) { x -= ws[i]; if (x <= 0 && ws[i] > 0) return list[i]; }
    return list[list.length - 1];
  }

  function makeStack(e, q, r) {
    const d = DB()[e[0]];
    const qtyMult = (d.cat === 'ammo' || d.cat === 'seed' || d.id === 'clavos') ? 1 + q * 0.3 : 1;
    let qty = Math.round((e[2] + Math.floor(r() * (e[3] - e[2] + 1))) * qtyMult);
    qty = Math.max(1, Math.min(qty, d.stack));
    const s = { id: d.id, qty };
    if (d.dur) s.dur = Math.min(1, 0.35 + r() * 0.45 + q * 0.12);
    const w = d.weapon && TM.WEAPONS && TM.WEAPONS[d.weapon];
    if (w && w.kind === 'gun') s.mag = Math.floor(r() * (w.magSize * 0.5 + 1));
    return s;
  }

  function tableFor(chest) {
    const cont = String(chest.container || '').toLowerCase();
    let bt = chest.buildingType || 'other';
    // maletero: el de una ambulancia/patrulla/humvee usa la tabla de su tipo; el de un auto cualquiera, la de autos
    if (/maleter|guantera|auto|coche|carro/.test(cont) && (!T[bt] || bt === 'house' || bt === 'other')) bt = 'car';
    if (/militar/.test(cont) && bt !== 'bunker') bt = 'military';
    if (/alijo/.test(cont)) bt = 'bunker';
    let list = T[bt] || T.other;
    for (const [re, cats] of CONTAINER_FILTERS) {
      if (re.test(cont)) {
        const f = list.filter((e) => DB()[e[0]] && cats.includes(DB()[e[0]].cat));
        if (f.length >= 3) list = f;
        else {
          // el mueble pide algo que este edificio casi no tiene: usa la casa como respaldo
          const f2 = T.house.filter((e) => DB()[e[0]] && cats.includes(DB()[e[0]].cat));
          if (f2.length >= 3) list = f2;
        }
        break;
      }
    }
    return list;
  }

  const Loot = {
    TABLES: T,

    // Devuelve un array de pilas { id, qty, dur?, mag? }.
    roll(chest, rng) {
      chest = chest || {};
      const r = rngFn(rng);
      const rarity = RAR_Q[chest.rarity] !== undefined ? chest.rarity : 'common';
      const danger = Math.max(0, Math.min(3, Number(chest.danger) || 0));
      const q = RAR_Q[rarity] + danger * 0.45;
      const list = tableFor(chest);
      const out = [];

      // a veces alguien llegó antes
      if (rarity === 'common' && r() < 0.1) return out;

      let n = rarity === 'legendary' ? 3 + Math.floor(r() * 3) : rarity === 'rare' ? 2 + Math.floor(r() * 3) : 1 + Math.floor(r() * 2.6);
      const seen = new Set();
      const add = (e) => {
        if (!e) return;
        const d = DB()[e[0]];
        // armas y herramientas no se repiten en el mismo mueble
        if (d.stack === 1) seen.add(d.id);
        const s = makeStack(e, q, r);
        const same = out.find((o) => o.id === s.id && d.stack > 1);
        if (same) same.qty = Math.min(d.stack, same.qty + s.qty);
        else out.push(s);
      };

      if (rarity === 'legendary') {
        // garantiza algo raro o mejor
        const rare = list.filter((e) => { const d = DB()[e[0]]; return d && (e[4] !== undefined ? e[4] : d.tier) >= 2; });
        add(pickWeighted(rare.length ? rare : LEGEND_POOL, q + 1, r, seen));
        n--;
      }
      for (let i = 0; i < n; i++) add(pickWeighted(list, q, r, seen));
      return out;
    },

    // Utilidad de equilibrio: media de unidades por contenedor (solo depuración)
    simulate(buildingType, rarity, danger, n) {
      n = n || 1000;
      const tot = {};
      for (let i = 0; i < n; i++) {
        for (const s of this.roll({ buildingType, rarity, danger }, null)) tot[s.id] = (tot[s.id] || 0) + s.qty;
      }
      const res = {};
      for (const k in tot) res[k] = +(tot[k] / n).toFixed(3);
      return res;
    },
  };

  TM.Loot = Loot;
})();
