// Entrada: joysticks táctiles flotantes + botones, y teclado/ratón para escritorio.
(function () {
  const U = TM.U;
  const FIRE_THRESHOLD = 0.78;   // empujar la mira hasta casi el borde para disparar
  const FIRE_RELEASE = 0.62;     // histéresis: deja de disparar al bajar de aquí
  const SPRINT_RATIO = 1.3;      // arrastrar el dedo más allá del anillo exterior = correr

  const Input = {
    enabled: false,
    canvas: null,
    w: 0, h: 0, s: 50,
    move: { x: 0, y: 0, mag: 0, sprint: false },
    aim: { x: 1, y: 0, mag: 0, active: false },
    fire: false,
    pressed: {},          // botones con flanco (se consumen)
    held: {},
    usingTouch: false,
    lastMouseMove: -1e9,
    getPlayerScreen: null, // función -> {x,y} en px CSS
    vibration: true,
    moveStick: { id: null, active: false, bx: 0, by: 0, kx: 0, ky: 0, R: 60 },
    aimStick: { id: null, active: false, bx: 0, by: 0, kx: 0, ky: 0, R: 60 },
    buttons: [],
    keys: {},
    mouseDown: false,
  };

  // Disposición en px CSS. Se recalcula al cambiar tamaño.
  // Derecha (pulgar derecho): empujar al borde, USAR arriba del joystick, recargar hacia dentro.
  // Arriba a la derecha: pausa, linterna y el panel del arma (tocarlo cambia de arma).
  // Abajo al centro: 3 accesos rápidos + MOCHILA (entre los dos joysticks, sin tapar el juego).
  Input.layoutButtons = function (w, h) {
    this.w = w; this.h = h;
    const s = this.s = U.clamp(Math.min(h * 0.135, w * 0.07), 38, 72);
    this.moveStick.R = s * 1.15;
    this.aimStick.R = s * 1.15;
    this.aimHome = { x: w - s * 2.1, y: h - s * 2.0 };
    this.moveHome = { x: s * 2.1, y: h - s * 2.0 };
    const cx = w / 2 + s * 0.6, qy = h - s * 0.7;
    this.buttons = [
      { id: 'shove',  x: w - s * 0.85, y: h - s * 3.75, r: s * 0.62, label: 'EMPUJAR', touchOnly: true },
      { id: 'use',    x: w - s * 2.35, y: h - s * 4.05, r: s * 0.6,  label: 'USAR', touchOnly: true },
      { id: 'reload', x: w - s * 3.8,  y: h - s * 3.5,  r: s * 0.48, label: 'RECARGAR', touchOnly: true },
      { id: 'light',  x: w - s * 1.8,  y: s * 0.7,      r: s * 0.42, label: 'LINTERNA', touchOnly: true },
      { id: 'pause',  x: w - s * 0.7,  y: s * 0.7,      r: s * 0.42, label: '' },
      { id: 'q1',     x: cx - s * 1.7,  y: qy, r: s * 0.44, slot: 0 },
      { id: 'q2',     x: cx - s * 0.58, y: qy, r: s * 0.44, slot: 1 },
      { id: 'q3',     x: cx + s * 0.54, y: qy, r: s * 0.44, slot: 2 },
      { id: 'bag',    x: cx + s * 1.75, y: qy, r: s * 0.5, label: 'MOCHILA' },
      { id: 'swap',   rect: true, x: w - s * 3.7, y: s * 1.3, w: s * 3.45, h: s * 1.05 },
    ];
    // la zona del joystick de mover termina antes del primer acceso rápido (no gastar vendas sin querer)
    const q1 = this.buttons.find((b) => b.id === 'q1');
    this.moveZoneX = Math.min(w * 0.42, q1.x - q1.r - 6);
  };

  function buttonAt(x, y, mouse) {
    for (const b of Input.buttons) {
      if (b.hidden || (mouse && b.touchOnly)) continue;
      if (b.rect) {
        if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b;
        continue;
      }
      const rr = b.r * 1.25; // área táctil un poco mayor que el dibujo
      if (U.dist2(x, y, b.x, b.y) <= rr * rr) return b;
    }
    return null;
  }

  function setStick(st, x, y, maxR) {
    const dx = x - st.bx, dy = y - st.by;
    const d = Math.hypot(dx, dy);
    const lim = st.R * (maxR || 1);
    if (d > lim) {
      // la base sigue al dedo si se pasa del límite (sensación más suelta)
      const over = d - lim;
      st.bx += (dx / d) * over; st.by += (dy / d) * over;
    }
    st.kx = x; st.ky = y;
  }

  function stickVec(st) {
    const dx = st.kx - st.bx, dy = st.ky - st.by;
    const d = Math.hypot(dx, dy);
    const mag = U.clamp(d / st.R, 0, 1);
    if (d < 1e-3) return { x: 0, y: 0, mag: 0 };
    return { x: dx / d, y: dy / d, mag };
  }

  function pos(t) {
    const r = Input.canvas.getBoundingClientRect();
    return { x: t.clientX - r.left, y: t.clientY - r.top };
  }

  function onTouchStart(e) {
    e.preventDefault();
    Input.usingTouch = true;
    if (TM.Audio && TM.Audio.init) TM.Audio.init();
    if (!Input.enabled) return;
    for (const t of e.changedTouches) {
      const p = pos(t);
      const b = buttonAt(p.x, p.y);
      if (b) {
        Input.pressed[b.id] = true;
        Input.held[b.id] = t.identifier;
        Input.vibrate(8);
        continue;
      }
      if (p.x < (Input.moveZoneX || Input.w * 0.42)) {
        if (Input.moveStick.id === null) {
          const st = Input.moveStick;
          st.id = t.identifier; st.active = true;
          // cerca del borde la base se mete un poco hacia dentro (el resto lo resuelve el umbral de borde)
          const m = st.R * 0.42;
          st.bx = Math.max(p.x, m); st.by = U.clamp(p.y, m, Input.h - m);
          st.kx = p.x; st.ky = p.y;
        }
      } else if (Input.aimStick.id === null) {
        const st = Input.aimStick;
        st.id = t.identifier; st.active = true;
        st.bx = p.x; st.by = p.y; st.kx = p.x; st.ky = p.y;
      }
    }
  }

  function onTouchMove(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      const p = pos(t);
      if (t.identifier === Input.moveStick.id) setStick(Input.moveStick, p.x, p.y, SPRINT_RATIO + 0.25);
      else if (t.identifier === Input.aimStick.id) setStick(Input.aimStick, p.x, p.y, 1);
    }
  }

  function onTouchEnd(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === Input.moveStick.id) { Input.moveStick.id = null; Input.moveStick.active = false; }
      if (t.identifier === Input.aimStick.id) { Input.aimStick.id = null; Input.aimStick.active = false; }
      for (const k in Input.held) if (Input.held[k] === t.identifier) delete Input.held[k];
    }
  }

  const KEYMAP = {
    KeyR: 'reload', Space: 'shove', KeyE: 'use', KeyF: 'light', Escape: 'pause', KeyP: 'pause',
    KeyI: 'bag', Tab: 'bag', KeyQ: 'swap', Digit1: 'q1', Digit2: 'q2', Digit3: 'q3',
  };

  function onKeyDown(e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    Input.keys[e.code] = true;
    if (Input.enabled && KEYMAP[e.code] && !e.repeat) { Input.pressed[KEYMAP[e.code]] = true; }
    if (e.code === 'Space' || e.code === 'Tab') e.preventDefault();
  }
  function onKeyUp(e) { Input.keys[e.code] = false; }

  function onMouseMove(e) {
    if (Input.usingTouch) return;
    const p = pos(e);
    Input.mx = p.x; Input.my = p.y;
    Input.lastMouseMove = performance.now();
  }
  function onMouseDown(e) {
    if (Input.usingTouch) return;
    if (TM.Audio && TM.Audio.init) TM.Audio.init();
    if (!Input.enabled) return;
    const p = pos(e);
    const b = buttonAt(p.x, p.y, true);
    if (b && e.button === 0) { Input.pressed[b.id] = true; return; }
    if (e.button === 0) Input.mouseDown = true;
    if (e.button === 2) Input.pressed.shove = true;
    Input.mx = p.x; Input.my = p.y;
    Input.lastMouseMove = performance.now();
  }
  function onMouseUp(e) { if (e.button === 0) Input.mouseDown = false; }
  let wheelT = 0;
  function onWheel(e) {
    e.preventDefault();
    if (!Input.enabled || Input.usingTouch) return;
    const now = performance.now();
    if (now - wheelT < 160) return;
    wheelT = now;
    Input.pressed.swap = true;
  }

  Input.init = function (canvas) {
    this.canvas = canvas;
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd, { passive: false });
    canvas.addEventListener('touchcancel', onTouchEnd, { passive: false });
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', () => Input.reset());
    try { this.vibration = localStorage.getItem('tm_vibration') !== '0'; } catch (e) { /* sin almacenamiento */ }
  };

  // Detecta pantalla táctil sin esperar a tocar el canvas (los menús lo tapan).
  Input.detectTouch = function () {
    try {
      const coarse = window.matchMedia && matchMedia('(pointer: coarse)').matches;
      const fine = window.matchMedia && matchMedia('(pointer: fine)').matches;
      if (coarse || ((navigator.maxTouchPoints || 0) > 0 && !fine)) this.usingTouch = true;
    } catch (e) { /* ignorar */ }
    // cualquier toque en la página (también en menús) activa el modo táctil
    window.addEventListener('touchstart', () => { Input.usingTouch = true; }, { capture: true, passive: true });
  };

  Input.reset = function () {
    this.moveStick.id = null; this.moveStick.active = false;
    this.aimStick.id = null; this.aimStick.active = false;
    this.keys = {}; this.pressed = {}; this.held = {}; this.mouseDown = false;
    this.move.x = this.move.y = this.move.mag = 0;
    this.aim.mag = 0; this.aim.active = false; this.fire = false;
  };

  Input.consume = function (id) {
    const v = !!this.pressed[id];
    this.pressed[id] = false;
    return v;
  };

  Input.vibrate = function (ms) {
    if (this.vibration && navigator.vibrate) { try { navigator.vibrate(ms); } catch (e) { /* ignorar */ } }
  };

  // Se llama una vez por frame antes de actualizar al jugador.
  Input.update = function () {
    // Movimiento
    let mx = 0, my = 0, mmag = 0, sprint = false;
    const now = performance.now();
    const dtu = Math.min(0.05, Math.max(0, (now - (this._lastUpd || now)) / 1000));
    this._lastUpd = now;
    if (this.moveStick.active) {
      const st = this.moveStick;
      // dedo apoyado contra el borde empujando hacia fuera: la base se desliza hacia dentro hasta
      // dejar sitio para el anillo de correr (antes podía quedar fuera de la pantalla)
      const E = 12, slide = 220 * dtu, lim = st.R * (SPRINT_RATIO + 0.06);
      const d0 = Math.hypot(st.kx - st.bx, st.ky - st.by) || 1;
      const ux0 = (st.kx - st.bx) / d0, uy0 = (st.ky - st.by) / d0;
      if (d0 > st.R * 0.3) {
        if (st.kx < E && ux0 < -0.6) st.bx = Math.min(st.bx + slide, st.kx + lim);
        if (st.ky > this.h - E && uy0 > 0.6) st.by = Math.max(st.by - slide, st.ky - lim);
        if (st.ky < E && uy0 < -0.6) st.by = Math.min(st.by + slide, st.ky + lim);
      }
      const d = Math.hypot(st.kx - st.bx, st.ky - st.by);
      sprint = d > st.R * SPRINT_RATIO;
      // dedo pegado al borde de la pantalla empujando hacia él: no cabe el anillo de correr, así que basta
      // con llevar el joystick al tope (con histéresis para que no parpadee)
      if (!sprint && d > st.R * (this.move.sprint ? 0.75 : 0.88)) {
        const E = 12, ux = (st.kx - st.bx) / d, uy = (st.ky - st.by) / d;
        if ((st.kx < E && ux < -0.5) || (st.ky > this.h - E && uy > 0.5) || (st.ky < E && uy < -0.5)) sprint = true;
      }
      const v = stickVec(st);
      // zona muerta pequeña y curva de respuesta suave
      const m = v.mag < 0.12 ? 0 : (v.mag - 0.12) / 0.88;
      mx = v.x; my = v.y; mmag = Math.pow(m, 0.85);
    } else {
      const k = this.keys;
      mx = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);
      my = (k.KeyS || k.ArrowDown ? 1 : 0) - (k.KeyW || k.ArrowUp ? 1 : 0);
      const d = Math.hypot(mx, my);
      if (d > 0) { mx /= d; my /= d; mmag = 1; }
      sprint = mmag > 0 && !!(k.ShiftLeft || k.ShiftRight);
      // C (mantener): caminar en sigilo, despacio y en silencio (Ctrl no: Ctrl+W cierra la pestaña)
      if (mmag > 0 && !sprint && k.KeyC) mmag = 0.5;
    }
    this.move.x = mx; this.move.y = my; this.move.mag = mmag; this.move.sprint = sprint;

    // Apuntado
    if (this.aimStick.active) {
      const v = stickVec(this.aimStick);
      if (v.mag > 0.15) { this.aim.x = v.x; this.aim.y = v.y; }
      this.aim.mag = v.mag;
      this.aim.active = v.mag > 0.15;
      this.fire = this.fire ? v.mag > FIRE_RELEASE : v.mag > FIRE_THRESHOLD;
    } else if (!this.usingTouch && this.getPlayerScreen && this.mx !== undefined) {
      const ps = this.getPlayerScreen();
      const dx = this.mx - ps.x, dy = this.my - ps.y;
      const d = Math.hypot(dx, dy);
      if (d > 4) { this.aim.x = dx / d; this.aim.y = dy / d; }
      this.aim.active = performance.now() - this.lastMouseMove < 2500 || this.mouseDown;
      this.aim.mag = this.aim.active ? 1 : 0;
      this.fire = this.mouseDown;
    } else {
      this.aim.active = false; this.aim.mag = 0; this.fire = false;
    }
  };

  Input.FIRE_THRESHOLD = FIRE_THRESHOLD;
  Input.SPRINT_RATIO = SPRINT_RATIO;
  TM.Input = Input;
})();
