// Catálogo de objetos (TM.Items.DB) e iconos dibujados con canvas (cacheados).
(function () {
  const U = TM.U;

  // tier: 0 común, 1 poco común, 2 raro, 3 legendario (color del texto y del botín)
  const TIER_COLORS = ['#d8d2c4', '#8fc870', '#6aa8f0', '#f0bc4c'];
  const TIER_NAMES = ['Común', 'Poco común', 'Raro', 'Legendario'];
  const CAT_NAMES = {
    weapon: 'Arma', ammo: 'Munición', food: 'Comida', drink: 'Bebida', med: 'Medicina', material: 'Material',
    tool: 'Herramienta', blueprint: 'Plano', seed: 'Semillas', part: 'Pieza de vehículo', fuel: 'Combustible',
    throwable: 'Arrojable',
  };

  // [id, nombre, cat, peso kg, pila, icono, color, tier, descripción, extra]
  const RAW = [
    // --- armas de fuego ---
    ['pistol', 'Pistola', 'weapon', 1.0, 1, 'pistol', '#2a2c30', 1, 'Semiautomática de 9 mm. Fiable, pero se oye lejos.', { weapon: 'pistol' }],
    ['pistol_sil', 'Pistola silenciada', 'weapon', 1.25, 1, 'pistolsil', '#2a2c30', 2, 'Silenciador casero: mucho menos ruido. Se gasta con cada disparo.', { weapon: 'pistol_sil', dur: true }],
    ['smg', 'Subfusil', 'weapon', 2.6, 1, 'smg', '#25272b', 3, 'Ráfagas rápidas de 9 mm. Devora munición.', { weapon: 'smg' }],
    ['shotgun', 'Escopeta', 'weapon', 3.4, 1, 'shotgun', '#2b2620', 2, 'Perdigones devastadores de cerca. Muy ruidosa.', { weapon: 'shotgun' }],
    ['rifle', 'Rifle de caza', 'weapon', 3.8, 1, 'rifle', '#3a2a1c', 3, 'Preciso y potente: atraviesa varios cuerpos. Se oye a kilómetros.', { weapon: 'rifle' }],
    // --- cuerpo a cuerpo (con durabilidad) ---
    ['knife', 'Cuchillo', 'weapon', 0.3, 1, 'knife', '#b8bcc0', 0, 'Rápido y silencioso. Letal por la espalda.', { weapon: 'knife', dur: true }],
    ['bat', 'Bate de béisbol', 'weapon', 1.0, 1, 'bat', '#a07848', 0, 'Golpe amplio que tumba a varios.', { weapon: 'bat', dur: true }],
    ['bat_nails', 'Bate con clavos', 'weapon', 1.2, 1, 'batn', '#9a7044', 1, 'Más daño que un bate normal. Se gasta antes.', { weapon: 'bat_nails', dur: true }],
    ['pipe', 'Tubo de metal', 'weapon', 1.5, 1, 'pipe', '#8a9098', 0, 'Pesado y casi irrompible.', { weapon: 'pipe', dur: true }],
    ['machete', 'Machete', 'weapon', 0.9, 1, 'machete', '#c0c4c8', 1, 'Corta limpio: a menudo de un golpe.', { weapon: 'machete', dur: true }],
    ['axe', 'Hacha', 'weapon', 2.2, 1, 'axe', '#9aa0a6', 2, 'Golpes lentos y brutales.', { weapon: 'axe', dur: true }],
    ['club', 'Garrote', 'weapon', 1.1, 1, 'club', '#8a6a40', 0, 'Madera y cinta. Se rompe pronto.', { weapon: 'club', dur: true }],
    ['spear', 'Lanza improvisada', 'weapon', 1.6, 1, 'spear', '#8a9098', 1, 'Mucho alcance: golpeas antes de que te alcancen.', { weapon: 'spear', dur: true }],
    // --- munición ---
    ['ammo_9mm', 'Munición 9 mm', 'ammo', 0.012, 90, 'ammo', '#c8a050', 1, 'Para pistola y subfusil.'],
    ['ammo_shell', 'Cartuchos', 'ammo', 0.045, 30, 'shells', '#b03a2a', 1, 'Para escopeta.'],
    ['ammo_rifle', 'Balas de rifle', 'ammo', 0.03, 40, 'rbullet', '#c8a050', 2, 'Para el rifle de caza.'],
    // --- arrojables ---
    ['molotov', 'Molotov', 'throwable', 0.7, 5, 'molotov', '#5a8a3a', 1, 'Fuego en el suelo durante unos segundos. Quema todo lo que lo pisa.', { weapon: 'molotov' }],
    ['pipebomb', 'Bomba casera', 'throwable', 0.9, 3, 'bomb', '#6a6e72', 2, 'Explota al poco de caer. Mantente lejos.', { weapon: 'pipebomb' }],
    ['firecracker', 'Petardo', 'throwable', 0.08, 10, 'firecracker', '#c03a2a', 0, 'Estalla lejos de ti y atrae a los muertos hacia el ruido.', { weapon: 'firecracker' }],
    ['flare', 'Bengala', 'throwable', 0.25, 5, 'flare', '#d8402a', 1, 'Luz roja intensa durante medio minuto. Atrae a los curiosos.', { weapon: 'flare' }],
    // --- comida ---
    ['lata', 'Lata de conserva', 'food', 0.45, 6, 'can', '#b8402a', 0, 'Frijoles fríos. Llenan.', { food: 35, water: 3, useTime: 1.4 }],
    ['galletas', 'Galletas', 'food', 0.2, 6, 'cookies', '#c89a58', 0, 'Secas, pero algo es algo.', { food: 18, water: -4, useTime: 1.0 }],
    ['barrita', 'Barrita energética', 'food', 0.08, 10, 'bar', '#d0a030', 0, 'Poca comida, mucha energía.', { food: 12, stam: 45, useTime: 0.7 }],
    ['cecina', 'Cecina', 'food', 0.15, 8, 'meat', '#8a3a28', 1, 'Carne seca muy salada. Da sed.', { food: 30, water: -8, useTime: 1.2 }],
    ['chocolate', 'Chocolate', 'food', 0.1, 8, 'choco', '#6a4028', 1, 'Un lujo. Energía y ánimo.', { food: 12, stam: 30, heal: 3, useTime: 0.7 }],
    ['manzana', 'Manzana', 'food', 0.18, 6, 'apple', '#c03028', 0, 'Algo arrugada. Quita un poco la sed.', { food: 12, water: 7, useTime: 0.8 }],
    ['racion', 'Ración militar', 'food', 0.6, 4, 'mre', '#7a6a40', 2, 'Comida completa sellada.', { food: 60, water: 8, heal: 5, useTime: 2.0 }],
    // --- bebida ---
    ['agua', 'Botella de agua', 'drink', 0.55, 6, 'water', '#58a0d8', 0, 'Agua limpia. Deja la botella vacía.', { water: 42, useTime: 1.0, leaves: 'botella' }],
    ['refresco', 'Refresco', 'drink', 0.35, 6, 'soda', '#c8302a', 0, 'Caliente y sin gas, pero dulce.', { water: 25, food: 4, stam: 30, useTime: 0.8 }],
    ['jugo', 'Jugo', 'drink', 0.4, 6, 'juice', '#e09030', 0, 'Jugo de caja. Algo de alimento.', { water: 30, food: 8, useTime: 0.9 }],
    // --- medicina ---
    ['venda', 'Venda', 'med', 0.05, 10, 'bandage', '#e8e4dc', 0, 'Detiene el sangrado y cura un poco.', { heal: 15, stopBleed: true, useTime: 1.6 }],
    ['botiquin', 'Botiquín', 'med', 0.8, 3, 'medkit', '#d8d4cc', 2, 'Cura mucho y detiene el sangrado. Tarda en aplicarse.', { heal: 60, stopBleed: true, useTime: 3.2 }],
    ['analgesicos', 'Analgésicos', 'med', 0.05, 10, 'pills', '#e08a30', 1, 'Durante 90 s recibes menos daño y no te frenan las heridas.', { heal: 6, pain: 90, useTime: 0.8 }],
    ['antibioticos', 'Antibióticos', 'med', 0.05, 6, 'antibio', '#58b070', 2, 'Curan la infección de las mordeduras.', { heal: 4, cureInf: true, useTime: 1.0 }],
    // --- materiales ---
    ['madera', 'Tablas de madera', 'material', 1.0, 10, 'wood', '#9a7448', 0, 'Para garrotes, barricadas y fogatas.'],
    ['chatarra', 'Chatarra', 'material', 0.4, 20, 'scrap', '#8a8e92', 0, 'Metal útil para munición y reparaciones.'],
    ['tela', 'Trapos', 'material', 0.08, 20, 'cloth', '#c8b898', 0, 'Para vendas, mechas y mochilas.'],
    ['cinta', 'Cinta adhesiva', 'material', 0.15, 10, 'tape', '#a8acb0', 0, 'Lo arregla casi todo.'],
    ['clavos', 'Clavos', 'material', 0.01, 100, 'nails', '#a0a4a8', 0, 'Para armas y construcción.'],
    ['alcohol', 'Alcohol', 'material', 0.5, 5, 'alcohol', '#a06a30', 0, 'Desinfecta y arde. Base del molotov.'],
    ['polvora', 'Pólvora', 'material', 0.03, 60, 'powder', '#3a3a3a', 2, 'Para munición casera y explosivos.'],
    ['botella', 'Botella vacía', 'material', 0.25, 6, 'bottle', '#5a9a6a', 0, 'Base del molotov y del silenciador.'],
    ['cuerda', 'Cuerda', 'material', 0.3, 5, 'rope', '#b89a68', 0, 'Para mochilas y trampas.'],
    ['electronica', 'Componentes electrónicos', 'material', 0.2, 10, 'chip', '#3a8a4a', 1, 'Piezas de aparatos rotos.'],
    // --- herramientas ---
    ['martillo', 'Martillo', 'tool', 0.8, 1, 'hammer', '#8a6a40', 1, 'Herramienta para munición casera y construcción.', { dur: true }],
    ['sierra', 'Sierra', 'tool', 0.9, 1, 'saw', '#a8acb0', 1, 'Herramienta para mejoras y construcción.', { dur: true }],
    ['llave', 'Llave inglesa', 'tool', 0.7, 1, 'wrench', '#9aa0a6', 1, 'Herramienta para explosivos y vehículos.', { dur: true }],
    ['encendedor', 'Encendedor', 'tool', 0.05, 1, 'lighter', '#d04a2a', 0, 'Necesario para fabricar molotov y petardos.'],
    ['mochila_escolar', 'Mochila escolar', 'tool', 0.6, 1, 'backpack', '#3a5a8a', 0, 'Úsala para llevar +6 kg.', { pack: 6 }],
    ['mochila_improvisada', 'Mochila improvisada', 'tool', 0.9, 1, 'backpack', '#7a6a4a', 1, 'Úsala para llevar +8 kg.', { pack: 8 }],
    ['mochila_excursion', 'Mochila de excursión', 'tool', 1.2, 1, 'backpack', '#3a7a4a', 2, 'Úsala para llevar +13 kg.', { pack: 13 }],
    ['mochila_militar', 'Mochila militar', 'tool', 1.6, 1, 'backpack', '#5a5a3a', 3, 'Úsala para llevar +20 kg.', { pack: 20 }],
    // --- planos ---
    ['plano_municion', 'Plano: munición casera', 'blueprint', 0.02, 1, 'paper', '#4a7ac0', 2, 'Úsalo para aprender a fabricar munición.', { learns: 'municion' }],
    ['plano_explosivos', 'Plano: explosivos', 'blueprint', 0.02, 1, 'paper', '#c05a3a', 2, 'Úsalo para aprender bombas caseras y bengalas.', { learns: 'explosivos' }],
    ['plano_mejoras', 'Plano: mejoras de armas', 'blueprint', 0.02, 1, 'paper', '#5aa070', 2, 'Úsalo para aprender el silenciador y la lanza.', { learns: 'mejoras' }],
    ['plano_refugio', 'Plano: refugio', 'blueprint', 0.02, 1, 'paper', '#a08a4a', 1, 'Barricadas y muros. Te servirá para fortificar un refugio.', { learns: 'refugio' }],
    // --- semillas ---
    ['semillas_papa', 'Semillas de papa', 'seed', 0.02, 20, 'seeds', '#a08a5a', 1, 'Para cultivar en tu refugio.'],
    ['semillas_maiz', 'Semillas de maíz', 'seed', 0.02, 20, 'seeds', '#d8b840', 1, 'Para cultivar en tu refugio.'],
    ['semillas_tomate', 'Semillas de tomate', 'seed', 0.02, 20, 'seeds', '#c84a3a', 1, 'Para cultivar en tu refugio.'],
    // --- piezas de vehículo ---
    ['bateria', 'Batería de auto', 'part', 12, 1, 'battery', '#3a3e44', 1, 'Pesada. Para arrancar un vehículo.'],
    ['neumatico', 'Neumático', 'part', 9, 1, 'tire', '#25272a', 1, 'Pesado. Para reparar un vehículo.'],
    ['bujias', 'Bujías', 'part', 0.2, 6, 'spark', '#c8ccd0', 1, 'Para reparar un motor.'],
    ['piezas_motor', 'Piezas de motor', 'part', 3, 3, 'engine', '#6a6e72', 2, 'Para reparar un motor.'],
    // --- combustible ---
    ['gasolina', 'Bidón de gasolina', 'fuel', 5.5, 3, 'jerrycan', '#c0302a', 1, 'Para vehículos y generadores. También arde.'],
  ];

  const DB = {};
  for (const r of RAW) {
    const d = { id: r[0], name: r[1], cat: r[2], weight: r[3], stack: r[4], icon: r[5], color: r[6], tier: r[7], desc: r[8] };
    if (r[9]) Object.assign(d, r[9]);
    DB[d.id] = d;
  }

  // ---------- dibujo de iconos (caja de 64 × 64 centrada en 0,0) ----------
  function rr(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r);
    c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r);
    c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y); c.closePath();
  }
  function fillRR(c, x, y, w, h, r, col) { c.fillStyle = col; rr(c, x, y, w, h, r); c.fill(); }
  function circle(c, x, y, r, col) { c.fillStyle = col; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); }
  function line(c, x0, y0, x1, y1, w, col) {
    c.strokeStyle = col; c.lineWidth = w; c.lineCap = 'round';
    c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
  }
  const OUT = 'rgba(0,0,0,0.55)';
  function outline(c, w) { c.strokeStyle = OUT; c.lineWidth = w || 2; c.stroke(); }

  function bottle(c, col, glass) {
    fillRR(c, -9, -6, 18, 30, 4, col); outline(c);
    fillRR(c, -4, -20, 8, 16, 2, col); outline(c);
    if (glass) { c.fillStyle = 'rgba(255,255,255,0.28)'; c.fillRect(-6, -2, 3, 22); }
  }

  const SHAPES = {
    pistol(c, col) {
      c.rotate(-0.08);
      fillRR(c, -22, -14, 42, 12, 2, col); outline(c);
      c.save(); c.translate(-14, -4); c.rotate(0.25); fillRR(c, -6, 0, 13, 24, 3, '#3a3026'); outline(c); c.restore();
      c.strokeStyle = col; c.lineWidth = 3; c.beginPath(); c.arc(0, 2, 6, 0, Math.PI); c.stroke();
      c.fillStyle = 'rgba(255,255,255,0.15)'; c.fillRect(-20, -12, 38, 3);
    },
    pistolsil(c, col) {
      c.translate(-6, 0);
      SHAPES.pistol(c, col);
      fillRR(c, 19, -15, 18, 14, 4, '#5a6066'); outline(c);
    },
    smg(c, col) {
      fillRR(c, -26, -12, 46, 13, 3, col); outline(c);
      fillRR(c, 18, -9, 12, 6, 2, col);
      fillRR(c, -4, 0, 9, 22, 2, '#1c1d20'); outline(c);
      fillRR(c, -16, 0, 9, 14, 3, '#3a3026'); outline(c);
      line(c, -26, -8, -32, 4, 4, '#1c1d20');
      c.fillStyle = 'rgba(255,255,255,0.15)'; c.fillRect(-24, -10, 42, 3);
    },
    shotgun(c, col) {
      c.rotate(-0.35);
      fillRR(c, -10, -6, 42, 7, 2, '#2a2c30'); outline(c);
      fillRR(c, 4, 0, 18, 6, 2, '#6a4a2a'); outline(c);
      c.beginPath(); c.moveTo(-10, -7); c.lineTo(-34, -6); c.lineTo(-36, 8); c.lineTo(-10, 5); c.closePath();
      c.fillStyle = '#7a5430'; c.fill(); outline(c);
    },
    rifle(c, col) {
      c.rotate(-0.35);
      fillRR(c, -6, -4, 40, 5, 2, '#2a2c30'); outline(c);
      c.beginPath(); c.moveTo(14, -4); c.lineTo(-34, -6); c.lineTo(-36, 9); c.lineTo(-14, 6); c.lineTo(14, 3); c.closePath();
      c.fillStyle = '#7a5430'; c.fill(); outline(c);
      fillRR(c, -10, -13, 22, 7, 3, '#1c1d20'); outline(c);
      circle(c, 12, -9.5, 3, '#6aa8d8');
    },
    knife(c, col) {
      c.rotate(-0.7);
      c.beginPath(); c.moveTo(-2, -6); c.lineTo(30, -2); c.lineTo(-2, 6); c.closePath();
      c.fillStyle = col; c.fill(); outline(c);
      c.fillStyle = 'rgba(255,255,255,0.4)'; c.fillRect(2, -4, 22, 2);
      fillRR(c, -26, -5, 24, 10, 3, '#2a2420'); outline(c);
      fillRR(c, -4, -9, 4, 18, 1, '#5a5a5a');
    },
    bat(c, col, nails) {
      c.rotate(-0.75);
      c.beginPath(); c.moveTo(-30, -3); c.lineTo(10, -8); c.quadraticCurveTo(32, -9, 32, 0);
      c.quadraticCurveTo(32, 9, 10, 8); c.lineTo(-30, 3); c.closePath();
      c.fillStyle = col; c.fill(); outline(c);
      fillRR(c, -32, -4, 10, 8, 2, '#3a2a1c');
      if (nails) {
        c.strokeStyle = '#c8ccd0'; c.lineWidth = 2;
        for (let i = 0; i < 5; i++) { const x = 6 + i * 5; c.beginPath(); c.moveTo(x, -8); c.lineTo(x + 2, -13); c.moveTo(x + 2, 8); c.lineTo(x + 4, 13); c.stroke(); }
      }
    },
    batn(c, col) { SHAPES.bat(c, col, true); },
    pipe(c, col) {
      c.rotate(-0.75);
      fillRR(c, -30, -5, 60, 10, 3, col); outline(c);
      c.fillStyle = 'rgba(255,255,255,0.3)'; c.fillRect(-28, -3, 56, 2);
      fillRR(c, -32, -7, 6, 14, 2, '#6a7078'); fillRR(c, 26, -7, 6, 14, 2, '#6a7078');
    },
    machete(c, col) {
      c.rotate(-0.7);
      c.beginPath(); c.moveTo(-6, -5); c.lineTo(26, -8); c.quadraticCurveTo(34, -2, 28, 6); c.lineTo(-6, 5); c.closePath();
      c.fillStyle = col; c.fill(); outline(c);
      fillRR(c, -28, -5, 22, 10, 3, '#3a2a1c'); outline(c);
    },
    axe(c, col) {
      c.rotate(-0.75);
      fillRR(c, -30, -3.5, 56, 7, 3, '#8a6238'); outline(c);
      c.beginPath(); c.moveTo(14, -4); c.lineTo(28, -16); c.quadraticCurveTo(34, 0, 28, 16); c.lineTo(14, 4); c.closePath();
      c.fillStyle = col; c.fill(); outline(c);
      c.fillStyle = 'rgba(255,255,255,0.35)'; c.fillRect(26, -12, 2, 24);
    },
    club(c, col) {
      c.rotate(-0.75);
      c.beginPath(); c.moveTo(-30, -4); c.lineTo(30, -9); c.lineTo(30, 9); c.lineTo(-30, 4); c.closePath();
      c.fillStyle = col; c.fill(); outline(c);
      c.fillStyle = '#9aa0a6'; c.fillRect(-4, -7, 6, 14); c.fillRect(14, -9, 6, 17);
    },
    spear(c, col) {
      c.rotate(-0.75);
      fillRR(c, -32, -3.5, 48, 7, 3, col); outline(c);
      c.beginPath(); c.moveTo(14, -6); c.lineTo(34, 0); c.lineTo(14, 6); c.closePath();
      c.fillStyle = '#c8ccd0'; c.fill(); outline(c);
      c.fillStyle = '#7a7e84'; c.fillRect(8, -5, 6, 10);
    },
    ammo(c, col) {
      for (let i = -1; i <= 1; i++) {
        const x = i * 13;
        fillRR(c, x - 5, -4, 10, 22, 2, col); outline(c);
        c.beginPath(); c.moveTo(x - 5, -4); c.quadraticCurveTo(x, -20, x + 5, -4); c.closePath();
        c.fillStyle = '#b06a3a'; c.fill(); outline(c);
      }
    },
    shells(c, col) {
      for (let i = -1; i <= 1; i++) {
        const x = i * 14;
        fillRR(c, x - 6, -18, 12, 28, 2, col); outline(c);
        fillRR(c, x - 6.5, 8, 13, 9, 1, '#c8a050'); outline(c);
      }
    },
    rbullet(c, col) {
      for (let i = -1; i <= 1; i++) {
        const x = i * 12;
        fillRR(c, x - 4, -8, 8, 28, 2, col); outline(c);
        c.beginPath(); c.moveTo(x - 4, -8); c.lineTo(x - 2, -16); c.quadraticCurveTo(x, -26, x + 2, -16); c.lineTo(x + 4, -8); c.closePath();
        c.fillStyle = '#b06a3a'; c.fill(); outline(c);
      }
    },
    can(c, col) {
      fillRR(c, -15, -20, 30, 40, 4, '#9aa0a6'); outline(c);
      c.fillStyle = col; c.fillRect(-15, -12, 30, 24);
      c.fillStyle = 'rgba(255,255,255,0.7)'; c.fillRect(-9, -4, 18, 6);
      c.fillStyle = 'rgba(255,255,255,0.2)'; c.fillRect(-12, -18, 4, 36);
    },
    cookies(c, col) {
      for (const [x, y] of [[-9, 4], [9, 4], [0, -9]]) {
        circle(c, x, y, 11, col); c.beginPath(); c.arc(x, y, 11, 0, Math.PI * 2); outline(c);
        circle(c, x - 3, y - 2, 1.8, '#5a3a20'); circle(c, x + 4, y + 2, 1.8, '#5a3a20');
      }
    },
    bar(c, col) {
      c.rotate(-0.4);
      fillRR(c, -26, -9, 52, 18, 3, col); outline(c);
      c.fillStyle = '#7a2a1a'; c.fillRect(-10, -9, 20, 18);
      c.fillStyle = 'rgba(255,255,255,0.6)'; c.fillRect(-6, -2, 12, 4);
    },
    meat(c, col) {
      c.rotate(-0.4);
      c.beginPath(); c.moveTo(-26, -6); c.quadraticCurveTo(0, -16, 26, -8); c.lineTo(24, 6); c.quadraticCurveTo(0, 14, -24, 8); c.closePath();
      c.fillStyle = col; c.fill(); outline(c);
      c.strokeStyle = 'rgba(255,220,200,0.35)'; c.lineWidth = 2;
      c.beginPath(); c.moveTo(-18, 0); c.quadraticCurveTo(0, -6, 18, -1); c.stroke();
    },
    choco(c, col) {
      c.rotate(-0.3);
      fillRR(c, -22, -14, 44, 28, 2, col); outline(c);
      c.strokeStyle = 'rgba(0,0,0,0.35)'; c.lineWidth = 1.5;
      for (let i = -1; i <= 1; i++) { c.beginPath(); c.moveTo(i * 11, -14); c.lineTo(i * 11, 14); c.stroke(); }
      c.beginPath(); c.moveTo(-22, 0); c.lineTo(22, 0); c.stroke();
      c.fillStyle = '#c8b070'; c.fillRect(6, -14, 16, 28);
    },
    apple(c, col) {
      circle(c, -6, 4, 15, col); circle(c, 6, 4, 15, col);
      c.beginPath(); c.arc(0, 4, 17, 0, Math.PI * 2); c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = 1; c.stroke();
      line(c, 0, -10, 2, -20, 3, '#5a3a1a');
      c.fillStyle = '#5a9a3a'; c.beginPath(); c.ellipse(9, -16, 7, 3.5, -0.5, 0, Math.PI * 2); c.fill();
      circle(c, -8, -2, 3, 'rgba(255,255,255,0.35)');
    },
    mre(c, col) {
      fillRR(c, -18, -22, 36, 44, 4, col); outline(c);
      c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(-18, -16, 36, 3);
      c.fillStyle = 'rgba(255,255,255,0.55)'; c.fillRect(-10, -4, 20, 4); c.fillRect(-10, 4, 14, 3);
    },
    water(c, col) {
      fillRR(c, -10, -12, 20, 34, 5, 'rgba(120,180,230,0.65)'); outline(c);
      fillRR(c, -5, -22, 10, 11, 2, '#2a6ab0'); outline(c);
      c.fillStyle = col; c.fillRect(-10, 0, 20, 10);
      c.fillStyle = 'rgba(255,255,255,0.45)'; c.fillRect(-7, -9, 3, 26);
    },
    soda(c, col) {
      fillRR(c, -12, -20, 24, 40, 5, col); outline(c);
      fillRR(c, -10, -22, 20, 5, 2, '#b8bcc0');
      c.fillStyle = 'rgba(255,255,255,0.85)'; c.beginPath(); c.moveTo(-12, 4); c.quadraticCurveTo(0, -6, 12, 4); c.lineTo(12, 8); c.quadraticCurveTo(0, -2, -12, 8); c.fill();
      c.fillStyle = 'rgba(255,255,255,0.2)'; c.fillRect(-8, -16, 3, 32);
    },
    juice(c, col) {
      c.beginPath(); c.moveTo(-14, -12); c.lineTo(0, -22); c.lineTo(14, -12); c.lineTo(14, 22); c.lineTo(-14, 22); c.closePath();
      c.fillStyle = col; c.fill(); outline(c);
      c.fillStyle = '#f0e8d8'; c.fillRect(-14, 4, 28, 12);
      circle(c, 0, 10, 4, '#e07a20');
      line(c, 6, -18, 10, -28, 2.5, '#e8e0d0');
    },
    bandage(c, col) {
      circle(c, -4, 2, 17, col); c.beginPath(); c.arc(-4, 2, 17, 0, Math.PI * 2); outline(c);
      circle(c, -4, 2, 6, '#b8b0a4');
      c.fillStyle = col; c.fillRect(-4, 13, 30, 9);
      c.strokeStyle = 'rgba(0,0,0,0.3)'; c.lineWidth = 1; c.strokeRect(-4, 13, 30, 9);
    },
    medkit(c, col) {
      fillRR(c, -24, -16, 48, 34, 5, col); outline(c);
      fillRR(c, -8, -22, 16, 7, 2, '#6a6e72');
      c.fillStyle = '#c8281e'; c.fillRect(-4, -10, 8, 22); c.fillRect(-11, -3, 22, 8);
    },
    pills(c, col) {
      fillRR(c, -13, -12, 26, 34, 4, col); outline(c);
      fillRR(c, -15, -22, 30, 11, 3, '#f0ece4'); outline(c);
      c.fillStyle = 'rgba(255,255,255,0.8)'; c.fillRect(-9, 0, 18, 9);
    },
    antibio(c, col) {
      c.rotate(-0.3);
      fillRR(c, -22, -16, 44, 32, 4, '#c8ccd0'); outline(c);
      for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
        const x = -14 + i * 14, y = -7 + j * 14;
        fillRR(c, x - 5, y - 3.5, 10, 7, 3.5, j ? '#f0ece4' : col);
      }
    },
    wood(c, col) {
      for (let i = 0; i < 3; i++) {
        c.save(); c.translate(0, -12 + i * 12); c.rotate(-0.12 + i * 0.06);
        fillRR(c, -28, -5, 56, 10, 1.5, i === 1 ? U.shade(col, 0.85) : col); outline(c, 1.5);
        c.fillStyle = 'rgba(0,0,0,0.2)'; c.fillRect(-20, -1, 30, 1.5);
        c.restore();
      }
    },
    scrap(c, col) {
      c.fillStyle = col;
      c.beginPath(); c.moveTo(-24, 6); c.lineTo(-8, -18); c.lineTo(4, -6); c.lineTo(-6, 16); c.closePath(); c.fill(); outline(c);
      c.fillStyle = U.shade(col, 0.75);
      c.beginPath(); c.moveTo(2, 10); c.lineTo(10, -16); c.lineTo(26, -6); c.lineTo(20, 18); c.closePath(); c.fill(); outline(c);
      circle(c, 14, 0, 3, '#5a5e62'); circle(c, -10, 0, 2.5, '#5a5e62');
      c.fillStyle = '#a86a3a'; c.fillRect(-20, 6, 6, 4);
    },
    cloth(c, col) {
      for (let i = 0; i < 3; i++) {
        c.save(); c.translate(i * 3 - 3, -10 + i * 9); c.rotate(-0.1 + i * 0.1);
        fillRR(c, -24, -7, 48, 14, 5, i === 1 ? '#a89070' : col); outline(c, 1.5);
        c.restore();
      }
    },
    tape(c, col) {
      circle(c, 0, 0, 22, col); c.beginPath(); c.arc(0, 0, 22, 0, Math.PI * 2); outline(c);
      circle(c, 0, 0, 11, '#c8a870'); circle(c, 0, 0, 7, 'rgba(0,0,0,0.6)');
      c.fillStyle = col; c.fillRect(14, 10, 16, 8);
    },
    nails(c, col) {
      for (let i = 0; i < 4; i++) {
        c.save(); c.translate(-14 + i * 9, 0); c.rotate(-0.3 + i * 0.2);
        line(c, 0, -18, 0, 18, 3, col);
        c.fillStyle = col; c.fillRect(-5, -20, 10, 3);
        c.restore();
      }
    },
    alcohol(c, col) {
      bottle(c, col, true);
      c.fillStyle = '#e8e0c8'; c.fillRect(-9, 2, 18, 12);
      c.fillStyle = '#c03a2a'; c.fillRect(-5, 6, 10, 3);
    },
    powder(c, col) {
      fillRR(c, -16, -10, 32, 30, 5, '#8a7a5a'); outline(c);
      c.beginPath(); c.moveTo(-16, -10); c.lineTo(-10, -20); c.lineTo(10, -20); c.lineTo(16, -10); c.closePath();
      c.fillStyle = '#7a6a4a'; c.fill(); outline(c);
      circle(c, 0, 4, 8, col);
      c.fillStyle = '#e8c070'; c.font = 'bold 12px sans-serif'; c.textAlign = 'center'; c.fillText('!', 0, 9);
    },
    bottle(c, col) { bottle(c, col, true); },
    rope(c, col) {
      c.strokeStyle = col; c.lineWidth = 5;
      for (let i = 0; i < 3; i++) { c.beginPath(); c.ellipse(0, 0, 22 - i * 6, 16 - i * 4, 0, 0, Math.PI * 2); c.stroke(); }
      c.strokeStyle = OUT; c.lineWidth = 1; c.beginPath(); c.ellipse(0, 0, 25, 19, 0, 0, Math.PI * 2); c.stroke();
      line(c, 20, 8, 30, 20, 5, col);
    },
    chip(c, col) {
      fillRR(c, -22, -16, 44, 32, 3, col); outline(c);
      c.fillStyle = '#1c1d20'; c.fillRect(-8, -8, 16, 16);
      c.strokeStyle = '#d8b850'; c.lineWidth = 1.5;
      for (let i = -1; i <= 1; i++) { c.beginPath(); c.moveTo(-22, i * 8); c.lineTo(-8, i * 4); c.moveTo(22, i * 8); c.lineTo(8, i * 4); c.stroke(); }
      circle(c, 14, -10, 2.5, '#c8402a');
    },
    hammer(c, col) {
      c.rotate(-0.7);
      fillRR(c, -28, -3.5, 46, 7, 3, col); outline(c);
      fillRR(c, 14, -14, 12, 28, 2, '#6a7078'); outline(c);
      fillRR(c, 24, -12, 8, 10, 1, '#5a6066');
    },
    saw(c, col) {
      c.rotate(-0.4);
      c.beginPath(); c.moveTo(-14, -10); c.lineTo(32, -6); c.lineTo(32, 4); c.lineTo(-14, 10); c.closePath();
      c.fillStyle = col; c.fill(); outline(c);
      c.fillStyle = '#5a5e62';
      for (let i = 0; i < 9; i++) { const x = -12 + i * 5; c.beginPath(); c.moveTo(x, 9 - i * 0.6); c.lineTo(x + 2.5, 13 - i * 0.6); c.lineTo(x + 5, 9 - i * 0.6); c.fill(); }
      fillRR(c, -32, -12, 20, 22, 6, '#a83a2a'); outline(c);
      fillRR(c, -27, -6, 10, 10, 3, 'rgba(0,0,0,0.6)');
    },
    wrench(c, col) {
      c.rotate(-0.75);
      fillRR(c, -26, -4.5, 42, 9, 4, col); outline(c);
      circle(c, 20, 0, 11, col); c.beginPath(); c.arc(20, 0, 11, 0, Math.PI * 2); outline(c);
      c.fillStyle = 'rgba(20,20,20,0.9)'; c.fillRect(22, -4, 12, 8);
      circle(c, -24, 0, 6, col);
    },
    lighter(c, col) {
      fillRR(c, -10, -10, 20, 32, 4, col); outline(c);
      fillRR(c, -10, -18, 20, 9, 2, '#b8bcc0'); outline(c);
      c.fillStyle = '#f0a030'; c.beginPath(); c.moveTo(-2, -18); c.quadraticCurveTo(4, -30, 2, -34); c.quadraticCurveTo(10, -26, 4, -18); c.fill();
    },
    backpack(c, col) {
      fillRR(c, -18, -18, 36, 40, 10, col); outline(c);
      fillRR(c, -12, 2, 24, 16, 4, U.shade(col, 0.8)); outline(c, 1.5);
      c.strokeStyle = U.shade(col, 0.6); c.lineWidth = 4; c.beginPath(); c.arc(0, -18, 8, Math.PI, 0); c.stroke();
      c.fillStyle = '#c8b070'; c.fillRect(-3, 6, 6, 4);
    },
    paper(c, col) {
      c.rotate(-0.12);
      fillRR(c, -22, -24, 44, 48, 2, col); outline(c);
      c.strokeStyle = 'rgba(255,255,255,0.75)'; c.lineWidth = 1.5;
      c.strokeRect(-14, -16, 18, 14);
      c.beginPath(); c.moveTo(-14, 6); c.lineTo(14, 6); c.moveTo(-14, 12); c.lineTo(8, 12); c.moveTo(8, -16); c.lineTo(14, -6); c.stroke();
      c.beginPath(); c.arc(10, -10, 4, 0, Math.PI * 2); c.stroke();
    },
    seeds(c, col) {
      fillRR(c, -18, -22, 36, 44, 3, '#e8dcc0'); outline(c);
      circle(c, 0, -4, 10, col);
      c.fillStyle = '#5a9a3a'; c.beginPath(); c.ellipse(6, -14, 6, 3, -0.6, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#7a6a4a'; c.fillRect(-12, 10, 24, 6);
    },
    battery(c, col) {
      fillRR(c, -24, -14, 48, 32, 3, col); outline(c);
      fillRR(c, -18, -20, 9, 7, 1, '#c8302a'); fillRR(c, 9, -20, 9, 7, 1, '#d8dcdf');
      c.fillStyle = '#e8c040'; c.fillRect(-24, -6, 48, 5);
    },
    tire(c, col) {
      circle(c, 0, 0, 25, col); c.beginPath(); c.arc(0, 0, 25, 0, Math.PI * 2); outline(c);
      circle(c, 0, 0, 13, '#8a8e92'); circle(c, 0, 0, 5, '#4a4e52');
      c.strokeStyle = 'rgba(255,255,255,0.12)'; c.lineWidth = 3; c.beginPath(); c.arc(0, 0, 20, 0, Math.PI * 2); c.stroke();
    },
    spark(c, col) {
      c.rotate(-0.6);
      fillRR(c, -6, -26, 12, 18, 3, '#f0ece4'); outline(c);
      fillRR(c, -8, -8, 16, 12, 2, col); outline(c);
      fillRR(c, -3, 4, 6, 18, 1, '#8a8e92');
    },
    engine(c, col) {
      fillRR(c, -22, -14, 44, 30, 4, col); outline(c);
      for (let i = 0; i < 3; i++) fillRR(c, -18 + i * 13, -22, 10, 10, 2, '#5a5e62');
      circle(c, 0, 2, 7, '#3a3e42'); c.fillStyle = '#a86a3a'; c.fillRect(-22, 10, 44, 3);
    },
    jerrycan(c, col) {
      fillRR(c, -18, -18, 36, 40, 4, col); outline(c);
      c.strokeStyle = 'rgba(0,0,0,0.3)'; c.lineWidth = 2;
      c.beginPath(); c.moveTo(-12, -8); c.lineTo(12, 16); c.moveTo(12, -8); c.lineTo(-12, 16); c.stroke();
      fillRR(c, -14, -26, 14, 8, 2, U.shade(col, 0.7)); fillRR(c, 6, -24, 8, 6, 2, '#d8c040');
    },
    molotov(c, col) {
      bottle(c, col, true);
      c.fillStyle = '#c8b898'; c.beginPath(); c.moveTo(-3, -20); c.quadraticCurveTo(-10, -28, -6, -32); c.lineTo(2, -22); c.fill();
      c.fillStyle = '#f08a28'; c.beginPath(); c.moveTo(-6, -30); c.quadraticCurveTo(-14, -38, -6, -44); c.quadraticCurveTo(-2, -36, 0, -32); c.fill();
      c.fillStyle = 'rgba(200,120,40,0.55)'; c.fillRect(-9, 6, 18, 18);
    },
    bomb(c, col) {
      c.rotate(-0.5);
      fillRR(c, -24, -10, 48, 20, 4, col); outline(c);
      fillRR(c, -27, -12, 7, 24, 2, '#4a4e52'); fillRR(c, 20, -12, 7, 24, 2, '#4a4e52');
      c.fillStyle = '#a8acb0'; c.fillRect(-6, -10, 8, 20);
      c.strokeStyle = '#3a3a3a'; c.lineWidth = 2; c.beginPath(); c.moveTo(27, 0); c.quadraticCurveTo(34, -12, 30, -20); c.stroke();
      circle(c, 30, -21, 3, '#f0a030');
    },
    firecracker(c, col) {
      for (let i = -1; i <= 1; i++) {
        c.save(); c.translate(i * 11, 0); c.rotate(i * 0.12);
        fillRR(c, -4.5, -16, 9, 32, 2, col); outline(c, 1.5);
        c.fillStyle = '#e8c040'; c.fillRect(-4.5, -4, 9, 3);
        c.restore();
      }
      c.strokeStyle = '#3a3a3a'; c.lineWidth = 2; c.beginPath(); c.moveTo(0, -16); c.quadraticCurveTo(6, -26, 2, -30); c.stroke();
    },
    flare(c, col) {
      c.rotate(-0.6);
      fillRR(c, -26, -6, 44, 12, 4, col); outline(c);
      fillRR(c, 16, -7, 12, 14, 3, '#e8e0d0'); outline(c);
      c.fillStyle = '#f0e0b0'; c.fillRect(-16, -6, 4, 12);
    },
  };

  const cache = {};
  const urlCache = {};

  const Items = {
    DB,
    TIER_COLORS, TIER_NAMES, CAT_NAMES,
    get(id) { return DB[id] || null; },
    name(id) { const d = DB[id]; return d ? d.name : id; },
    tierColor(id) { const d = DB[id]; return TIER_COLORS[d ? d.tier : 0]; },
    isWeapon(id) { const d = DB[id]; return !!(d && d.cat === 'weapon'); },
    hasDur(id) { const d = DB[id]; return !!(d && d.dur); },

    // Etiqueta de una pila: "Venda ×2"
    label(stack) {
      if (!stack) return '';
      const n = this.name(stack.id);
      return stack.qty > 1 ? `${n} ×${stack.qty}` : n;
    },

    // Dibuja el icono centrado en (x, y) con tamaño `size` (px del contexto actual).
    drawIcon(ctx, id, x, y, size) {
      const d = DB[id];
      ctx.save();
      ctx.translate(x, y);
      const k = size / 64;
      ctx.scale(k, k);
      ctx.lineJoin = 'round';
      const fn = d && SHAPES[d.icon];
      if (fn) fn(ctx, d.color);
      else { circle(ctx, 0, 0, 18, d ? d.color : '#888'); }
      ctx.restore();
    },

    // Icono pre-renderizado (canvas). px = tamaño en píxeles reales.
    iconCanvas(id, px) {
      px = px || 64;
      const key = id + '@' + px;
      let c = cache[key];
      if (!c) {
        c = U.makeCanvas(px, px);
        const x = c.getContext('2d');
        this.drawIcon(x, id, px / 2, px / 2, px * 0.9);
        cache[key] = c;
      }
      return c;
    },

    // Data URL para <img> en la interfaz DOM (se genera una vez por objeto)
    iconURL(id) {
      if (urlCache[id]) return urlCache[id];
      let url = '';
      try { url = this.iconCanvas(id, 96).toDataURL(); } catch (e) { url = ''; }
      urlCache[id] = url;
      return url;
    },

    // Dibujo de un objeto en el suelo (lo puede usar el mundo): sombra, icono y brillo por rareza.
    drawGround(ctx, stack, x, y, t) {
      const d = DB[stack.id];
      const size = 22;
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath(); ctx.ellipse(x + 2, y + 4, size * 0.48, size * 0.26, 0, 0, Math.PI * 2); ctx.fill();
      if (d && d.tier >= 2) {
        const a = 0.25 + 0.15 * Math.sin((t || 0) * 4 + x);
        ctx.strokeStyle = d.tier === 3 ? `rgba(240,188,76,${a + 0.2})` : `rgba(106,168,240,${a})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x, y, size * 0.62, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.drawImage(this.iconCanvas(stack.id, 48), x - size / 2, y - size / 2, size, size);
    },
  };

  TM.Items = Items;
})();
