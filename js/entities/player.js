// Jugador: movimiento, estamina, vida, necesidades (hambre/sed), estados (sangrado, infección,
// analgésicos), uso de objetos con tiempo, animación y dibujo según el arma.
(function () {
  const U = TM.U;

  const WALK_SPEED = 150;
  const SPRINT_SPEED = 208;
  const STAMINA_DRAIN = 24;
  const STAMINA_REGEN = 20;

  // Necesidades: con actividad normal un día (480 s) baja ~65 de hambre y ~80 de sed → comer y beber ~2 veces.
  const HUNGER_RATE = 0.14;   // por segundo caminando
  const THIRST_RATE = 0.17;
  const STARVE_DPS = 0.45;    // vida por segundo con hambre 0
  const DEHYD_DPS = 0.65;     // vida por segundo con sed 0
  const BLEED_DPS = 0.45;
  const BLEED_TIME = 40;      // el sangrado se corta solo pasado este tiempo
  const INFECT_CHANCE = 0.035;// por golpe de zombie
  const INFECT_TIME = 300;    // segundos hasta infección máxima
  const REGEN_FED = 0.1;      // vida/s bien alimentado (antes 1,5)
  const REGEN_CAMP = 0.8;     // vida/s junto a la fogata

  // ---------- Ruido de pasos (u; 32 u = 1 m). Los zombies solo oyen lo que se emite con game.emitNoise ----------
  const SNEAK_MAG = 0.6;      // joystick desplazado ≤ 60 % (≤ 90 u/s): pasos silenciosos
  const WALK_NOISE = 48;      // caminar normal: ~1,5 m
  const RUN_NOISE = 330;      // correr: ~10 m (la habilidad Sigilo lo reduce hasta un 45 %)

  // ---------- Habilidades (suben con el uso, niveles 0..10) ----------
  const SKILLS = [
    { id: 'aim', name: 'Puntería', color: '#e8c070', desc: 'Sube disparando y acertando. Menos dispersión, recarga más rápida y más críticos.' },
    { id: 'melee', name: 'Cuerpo a cuerpo', color: '#e08a6a', desc: 'Sube golpeando. Más daño, menos estamina por golpe y golpes más rápidos.' },
    { id: 'stealth', name: 'Sigilo', color: '#9ad0a0', desc: 'Sube moviéndote cerca de ellos sin que te vean y matando por la espalda. Menos ruido al correr y te ven peor.' },
    { id: 'fitness', name: 'Atletismo', color: '#d8c890', desc: 'Sube corriendo. Más estamina, corres más rápido y te cansas menos.' },
    { id: 'survival', name: 'Supervivencia', color: '#80b8e8', desc: 'Sube curándote, comiendo, fabricando y registrando. Vendas y comida rinden más, gastas menos y aprendes recetas.' },
  ];
  const SKILL_MAX = 10;
  // XP para pasar del nivel lv al lv+1: 25, 68, 120, 179, 245, 319, 400, 489, 585, 689 (≈ 2900 en total)
  function xpNeed(lv) { return Math.round(25 * (lv + 1) * (1 + lv * 0.35)); }

  class Skills {
    constructor() {
      this.xp = {}; this.lv = {};
      for (const s of SKILLS) { this.xp[s.id] = 0; this.lv[s.id] = 0; }
      this.version = 0;
      this.flash = {};               // id -> segundos de brillo tras subir de nivel (HUD/mochila)
    }
    level(id) { return this.lv[id] || 0; }
    progress(id) { const l = this.level(id); return l >= SKILL_MAX ? 1 : U.clamp(this.xp[id] / xpNeed(l), 0, 1); }
    gain(id, amount) {
      if (!(amount > 0) || this.lv[id] === undefined || this.lv[id] >= SKILL_MAX) return;
      this.xp[id] += amount;
      let up = false;
      while (this.lv[id] < SKILL_MAX && this.xp[id] >= xpNeed(this.lv[id])) {
        this.xp[id] -= xpNeed(this.lv[id]);
        this.lv[id]++;
        up = true;
      }
      if (this.lv[id] >= SKILL_MAX) this.xp[id] = 0;
      this.version++;
      if (up) this.onLevelUp(id);
    }
    onLevelUp(id) {
      const def = Skills.def(id), lv = this.lv[id], g = TM.game;
      this.flash[id] = 3;
      if (!g) return;
      g.notify(`¡${def.name} sube a nivel ${lv}!`, def.color);
      const p = g.player;
      if (p && g.fx) g.fx.floatText(p.x, p.y - 30, `${def.name.toUpperCase()} ${lv}`, def.color);
      if (id === 'fitness' && p) p.maxStamina = this.maxStamina();
      if (id === 'survival' && TM.Crafting && TM.Crafting.RECIPES) {
        const names = TM.Crafting.RECIPES.filter((r) => r.skill && r.skill[0] === 'survival' && r.skill[1] === lv).map((r) => r.label || TM.Items.name(r.out[0]));
        if (names.length && g.later) g.later(1800, () => g.notify('Nueva receta: ' + names.join(', '), '#80b8e8'));
      }
    }
    update(dt) { for (const k in this.flash) { this.flash[k] -= dt; if (this.flash[k] <= 0) delete this.flash[k]; } }

    // ---- efectos (moderados; a nivel 10 compensan aproximadamente la evolución de los zombies hasta el día ~30) ----
    spreadMul() { return 1 - 0.04 * this.level('aim'); }          // −40 % dispersión
    reloadMul() { return 1 - 0.03 * this.level('aim'); }          // −30 % tiempo de recarga
    critAdd() { return 0.01 * this.level('aim'); }                 // +10 % crítico
    meleeDmgMul() { return 1 + 0.04 * this.level('melee'); }      // +40 % daño
    meleeStamMul() { return 1 - 0.04 * this.level('melee'); }     // −40 % estamina por golpe
    meleeRateMul() { return 1 - 0.02 * this.level('melee'); }     // −20 % entre golpes
    noiseMul() { return 1 - 0.045 * this.level('stealth'); }      // −45 % ruido al correr
    sightMul() { return 1 - 0.03 * this.level('stealth'); }       // −30 % distancia a la que te ven
    stealthBonus() { return 0.1 * this.level('stealth'); }        // +1 al multiplicador de sigilo
    maxStamina() { return 100 + 5 * this.level('fitness'); }      // 150
    sprintMul() { return 1 + 0.012 * this.level('fitness'); }     // +12 % al correr
    drainMul() { return 1 - 0.03 * this.level('fitness'); }       // −30 % gasto al correr
    healMul() { return 1 + 0.05 * this.level('survival'); }       // +50 % curación de medicinas
    foodMul() { return 1 + 0.03 * this.level('survival'); }       // +30 % comida/agua
    needsMul() { return 1 - 0.025 * this.level('survival'); }     // −25 % hambre/sed

    serialize() { return { v: 1, xp: Object.assign({}, this.xp), lv: Object.assign({}, this.lv) }; }
    deserialize(d) {
      if (!d || typeof d !== 'object') return;
      for (const s of SKILLS) {
        const l = d.lv && Number.isFinite(d.lv[s.id]) ? U.clamp(d.lv[s.id] | 0, 0, SKILL_MAX) : 0;
        const x = d.xp && Number.isFinite(d.xp[s.id]) ? Math.max(0, d.xp[s.id]) : 0;
        this.lv[s.id] = l;
        this.xp[s.id] = l >= SKILL_MAX ? 0 : Math.min(x, xpNeed(l) - 0.01);
      }
      this.version++;
    }
    static def(id) { return SKILLS.find((s) => s.id === id); }
  }
  Skills.LIST = SKILLS;
  Skills.MAX = SKILL_MAX;
  Skills.xpNeed = xpNeed;
  TM.Skills = Skills;

  class Player {
    constructor(name) {
      this.name = name || 'Superviviente';
      this.x = 0; this.y = 60;
      this.r = 11;
      this.vx = 0; this.vy = 0;
      this.kvx = 0; this.kvy = 0;     // empuje externo
      this.hp = 100; this.maxHp = 100;
      this.stamina = 100; this.maxStamina = 100;
      this.staminaDelay = 0;
      this.alive = true;
      this.aimAngle = -Math.PI / 2;
      this.bodyAngle = -Math.PI / 2;
      this.aiming = false;
      this.aimHold = 0;               // segundos que mantiene la mira tras soltar
      this.flashlightOn = true;
      this.sprinting = false;
      this.moving = false;
      this.noise = 0;                 // 0..1 (noiseRadius / RUN_NOISE), para compatibilidad
      this.noiseRadius = 0;           // radio (u) del ruido de los pasos de este frame
      this.sneaking = false;          // moviéndose despacio (joystick poco desplazado) o quieto
      this.sightMul = 1;              // multiplicador de la distancia a la que lo ven (agachado, Sigilo)
      this.skills = new Skills();
      this._sneakT = 0;
      this.lastDamageTime = -999;
      this.hurtFlash = 0;
      this.walkPhase = 0;
      this.stepAcc = 0;
      this.recoil = 0;
      this.shoveAnim = 0;
      this.swingAnim = 0;
      this.swingDir = 1;
      this.swapAnim = 0;
      this.weaponId = 'pistol';
      this.deathTime = 0;
      this.maxDist = 0;
      // Fase 2
      this.hunger = 85;               // 100 = saciado
      this.thirst = 80;
      this.bleedT = 0;                // segundos de sangrado restantes
      this.infection = 0;             // 0..1
      this.painT = 0;                 // analgésicos activos (s)
      this.action = null;             // uso de un objeto en curso
      this._warn = {};
      this.inventory = TM.Inventory ? new TM.Inventory() : null;
      if (this.inventory) this.inventory.giveStarter();
    }

    get bleeding() { return this.bleedT > 0; }
    get infected() { return this.infection > 0; }

    serializeStatus() {
      return { b: +this.bleedT.toFixed(1), i: +this.infection.toFixed(3), p: +this.painT.toFixed(1) };
    }
    deserializeStatus(d) {
      if (!d) return;
      if (Number.isFinite(d.b)) this.bleedT = U.clamp(d.b, 0, BLEED_TIME);
      if (Number.isFinite(d.i)) this.infection = U.clamp(d.i, 0, 1);
      if (Number.isFinite(d.p)) this.painT = U.clamp(d.p, 0, 120);
    }

    update(dt, game) {
      const In = TM.Input;
      if (!this.alive) {
        this.vx *= 0.9; this.vy *= 0.9;
        this.action = null;
        return;
      }
      const inv = this.inventory;
      // --- Movimiento ---
      const mv = In.move;
      const canRun = !game.combat.reloading && !this.action && (!inv || inv.canSprint());
      const wantsSprint = mv.sprint && mv.mag > 0.5 && this.stamina > 2 && canRun;
      this.sprinting = wantsSprint && (this.sprinting || this.stamina > 15);
      const sk = this.skills;
      this.maxStamina = sk.maxStamina();
      let speed = (this.sprinting ? SPRINT_SPEED * sk.sprintMul() : WALK_SPEED) * mv.mag;
      if (In.aim.active && !this.sprinting) speed *= 0.86;
      if (game.combat.reloading) speed *= 0.9;
      if (this.action) speed *= 0.55;
      if (inv) speed *= inv.speedFactor();
      // herido grave: más lento (los analgésicos lo evitan)
      if (this.hp < 25 && this.painT <= 0) speed *= 0.9;
      const tvx = mv.x * speed, tvy = mv.y * speed;
      const acc = mv.mag > 0 ? 14 : 10;
      this.vx += (tvx - this.vx) * Math.min(1, acc * dt);
      this.vy += (tvy - this.vy) * Math.min(1, acc * dt);
      this.kvx *= Math.pow(0.02, dt); this.kvy *= Math.pow(0.02, dt);
      this.x += (this.vx + this.kvx) * dt;
      this.y += (this.vy + this.kvy) * dt;
      game.world.collideCircle(this);

      const sp = Math.hypot(this.vx, this.vy);
      this.moving = sp > 20;

      // --- Estamina (la infección y el hambre/sed la recuperan peor) ---
      let regen = STAMINA_REGEN;
      if (this.infection > 0.25) regen *= 0.6;
      if (this.hunger < 15 || this.thirst < 15) regen *= 0.65;
      if (this.sprinting && this.moving) {
        this.stamina = Math.max(0, this.stamina - STAMINA_DRAIN * sk.drainMul() * (inv && inv.load() > 1 ? 1.4 : 1) * dt);
        this.staminaDelay = 0.7;
        sk.gain('fitness', 0.5 * dt);
        if (this.stamina <= 0) this.sprinting = false;
      } else if (this.staminaDelay > 0) this.staminaDelay -= dt;
      else this.stamina = Math.min(this.maxStamina, this.stamina + regen * dt);

      // --- Apuntado y orientación ---
      if (In.aim.active) {
        this.aimAngle = Math.atan2(In.aim.y, In.aim.x);
        this.aimHold = 0.6;
      } else if (this.aimHold > 0) {
        this.aimHold -= dt;
      } else if (this.moving) {
        // la linterna sigue la dirección de marcha, suavizado
        const ta = Math.atan2(this.vy, this.vx);
        this.aimAngle += U.angDiff(this.aimAngle, ta) * Math.min(1, 8 * dt);
      }
      this.aiming = In.aim.active;
      this.bodyAngle += U.angDiff(this.bodyAngle, this.aimAngle) * Math.min(1, 18 * dt);

      // --- Ruido y pasos ---
      // Quieto o despacio (joystick ≤ 60 %): silencioso. Caminar normal: ~1,5 m. Correr: ~10 m (menos con Sigilo).
      // Ese radio es el ÚNICO modo en que los zombies "oyen" al jugador moverse (emitNoise 'footstep' en cada paso).
      const running = this.sprinting && this.moving;
      this.sneaking = !running && (!this.moving || mv.mag <= SNEAK_MAG + 1e-3);
      let nr = 0;
      if (running) nr = RUN_NOISE * sk.noiseMul();
      else if (this.moving && !this.sneaking) nr = WALK_NOISE * U.clamp((mv.mag - SNEAK_MAG) / (1 - SNEAK_MAG), 0.3, 1) * (1 - 0.05 * sk.level('stealth'));
      this.noiseRadius = nr;
      this.noise = nr / RUN_NOISE;
      // agachado/quieto: cuesta más verte; Sigilo también
      this.sightMul = (this.sneaking ? 0.75 : 1) * sk.sightMul();
      if (this.moving) {
        this.walkPhase += sp * dt * 0.09;
        this.stepAcc += sp * dt;
        const stepLen = this.sprinting ? 52 : 44;
        if (this.stepAcc > stepLen) {
          this.stepAcc = 0;
          if (TM.Audio) TM.Audio.play('footstep', this.x, this.y, { volume: this.sprinting ? 0.5 : this.sneaking ? 0.12 : 0.28 });
          if (nr > 0) game.emitNoise(this.x, this.y, nr, 'footstep');
        }
      }
      // Sigilo: moverse despacio cerca de zombies que no te han detectado
      this._sneakT -= dt;
      if (this._sneakT <= 0) {
        this._sneakT = 0.5;
        if (this.moving && this.sneaking && game.zombies) {
          for (const z of game.zombies) {
            if (z.dead || z.alerted || z.fakeDead || z.state === 'ambush') continue;
            const dx = z.x - this.x, dy = z.y - this.y;
            if (dx * dx + dy * dy < 230 * 230) { sk.gain('stealth', 0.6); break; }
          }
        }
      }
      sk.update(dt);

      this.updateNeeds(dt, game);
      this.updateAction(dt, game);

      this.hurtFlash = Math.max(0, this.hurtFlash - dt * 4);
      this.recoil = Math.max(0, this.recoil - dt * 10);
      this.shoveAnim = Math.max(0, this.shoveAnim - dt * 4);
      this.swingAnim = Math.max(0, this.swingAnim - dt * 4.5);
      this.swapAnim = Math.max(0, this.swapAnim - dt * 3);
      this.maxDist = Math.max(this.maxDist, Math.hypot(this.x, this.y));
    }

    // ---------- necesidades y estados ----------
    updateNeeds(dt, game) {
      const act = (this.sprinting && this.moving ? 1.7 : this.moving ? 1 : 0.7) * this.skills.needsMul();
      const biome = game.world.biomeAt ? game.world.biomeAt(this.x, this.y) : '';
      const heat = biome === 'desert' && !game.isNight ? 1.35 : 1;
      this.hunger = Math.max(0, this.hunger - HUNGER_RATE * act * dt);
      this.thirst = Math.max(0, this.thirst - THIRST_RATE * act * heat * dt);

      if (this.hunger <= 0) this.loseHp(STARVE_DPS * dt, 'hambre');
      if (this.thirst <= 0) this.loseHp(DEHYD_DPS * dt, 'sed');
      this.warnNeed(game, 'hunger', this.hunger, ['Tienes hambre', 'Te mueres de hambre: come algo', 'Te estás muriendo de hambre']);
      this.warnNeed(game, 'thirst', this.thirst, ['Tienes sed', 'Te mueres de sed: bebe algo', 'Te estás deshidratando']);

      // sangrado
      if (this.bleedT > 0) {
        this.bleedT -= dt;
        this.loseHp(BLEED_DPS * dt, 'sangrado');
        this._drip = (this._drip || 0) - dt;
        if (this._drip <= 0) {
          this._drip = U.randRange(0.5, 0.9);
          game.fx.blood(this.x, this.y, U.randRange(-1, 1), U.randRange(-1, 1), 2);
          if (U.chance(0.4)) game.world.paintBlood(this.x + U.randRange(-5, 5), this.y + U.randRange(-5, 5), 2.5, 0.5);
        }
        if (this.bleedT <= 0) game.notify('La herida dejó de sangrar', '#c0a080');
      }
      // infección: bien alimentado, al principio el cuerpo la vence
      if (this.infection > 0) {
        const fed = this.hunger > 60 && this.thirst > 60;
        if (fed && this.infection < 0.25) {
          this.infection -= dt / 220;
          if (this.infection <= 0) { this.infection = 0; game.notify('Tu cuerpo venció la infección', '#8fc870'); }
        } else {
          this.infection = Math.min(1, this.infection + dt / INFECT_TIME * (fed ? 0.6 : 1));
          if (this.infection >= 0.25) this.loseHp(0.14 * this.infection * dt, 'infeccion');
          if (this.infection >= 0.25 && !this._warn.inf) { this._warn.inf = true; game.notify('La infección avanza: necesitas antibióticos', '#90c060'); }
        }
      }
      if (this.painT > 0) this.painT -= dt;

      // regeneración: mucho más lenta que en la Fase 1; la fogata del campamento cura despacio
      const sinceHit = game.time - this.lastDamageTime;
      const inCamp = Math.hypot(this.x, this.y) < TM.Config.SAFE_RADIUS;
      const starving = this.hunger <= 0 || this.thirst <= 0;
      if (inCamp && sinceHit > 4 && !starving) this.hp = Math.min(this.maxHp, this.hp + REGEN_CAMP * dt);
      else if (sinceHit > 12 && this.hunger > 50 && this.thirst > 50 && this.bleedT <= 0 && this.infection < 0.25) {
        this.hp = Math.min(this.maxHp, this.hp + REGEN_FED * dt);
      }
    }

    warnNeed(game, key, v, msgs) {
      const lv = v <= 0 ? 3 : v < 12 ? 2 : v < 30 ? 1 : 0;
      const prev = this._warn[key] || 0;
      if (lv > prev) game.notify(msgs[lv - 1], key === 'thirst' ? '#80b0e0' : '#d0a060');
      this._warn[key] = lv;
    }

    // Pérdida de vida sin efectos de golpe (hambre, sed, sangrado, infección)
    loseHp(amount, kind) {
      if (!this.alive || amount <= 0) return;
      this.hp -= amount;
      if (this.hp <= 0) this.die(kind);
    }

    die(kind) {
      const g = TM.game;
      this.hp = 0;
      this.alive = false;
      this.deathTime = g.time;
      this.action = null;
      if (TM.Audio) TM.Audio.play('player_death', this.x, this.y);
      g.world.paintBlood(this.x, this.y, 16, 0.85);
      if (TM.InvUI) TM.InvUI.closeAll();
      g.onPlayerDeath(kind);
    }

    // ---------- uso de objetos (tarda un poco: no se puede atacar mientras tanto) ----------
    startUse(stack) {
      const g = TM.game, d = TM.Items.DB[stack.id];
      if (!d || !this.alive) return false;
      if (this.action) {
        // tocar otra vez el mismo acceso rápido cancela
        if (this.action.stack === stack || this.action.id === stack.id) { this.action = null; g.fx.floatText(this.x, this.y - 24, 'Cancelado', '#b0a090'); }
        return false;
      }
      // evitar desperdiciar
      let why = '';
      if (d.cat === 'med') {
        const useful = this.hp < this.maxHp - 2 || (d.stopBleed && this.bleedT > 0) || (d.cureInf && this.infection > 0) || (d.pain && this.painT <= 0);
        if (!useful) why = 'No lo necesitas';
      } else if (d.cat === 'food' && this.hunger > 96 && !(d.water > 0 && this.thirst < 90)) why = 'Estás lleno';
      else if (d.cat === 'drink' && this.thirst > 96) why = 'No tienes sed';
      if (why) { g.fx.floatText(this.x, this.y - 24, why, '#b0a090'); return false; }
      this.action = { id: d.id, stack, t: 0, dur: d.useTime || 1, cat: d.cat };
      const snd = d.cat === 'med' ? 'bandage' : d.cat === 'drink' ? 'drink' : 'eat';
      if (TM.Audio) TM.Audio.play(snd, this.x, this.y);
      if (g.combat) { g.combat.reloading = false; }
      return true;
    }

    updateAction(dt, game) {
      const a = this.action;
      if (!a) return;
      const inv = this.inventory;
      if (!inv || inv.slots.indexOf(a.stack) < 0) { this.action = null; return; }
      a.t += dt;
      if (a.t < a.dur) return;
      this.action = null;
      const d = TM.Items.DB[a.id];
      inv.removeStack(a.stack, 1);
      const parts = [];
      const sk = this.skills, fm = sk.foodMul();
      if (d.food) { const f = Math.round(d.food * fm); this.hunger = U.clamp(this.hunger + f, 0, 100); parts.push(`+${f} comida`); }
      if (d.water) { const wv = d.water > 0 ? Math.round(d.water * fm) : d.water; this.thirst = U.clamp(this.thirst + wv, 0, 100); if (wv > 0) parts.push(`+${wv} agua`); }
      if (d.stam) this.stamina = Math.min(this.maxStamina, this.stamina + d.stam);
      if (d.heal) {
        const h = Math.min(d.heal * (d.cat === 'med' ? sk.healMul() : 1), this.maxHp - this.hp);
        this.hp += h; if (h >= 1) parts.push(`+${Math.round(h)} vida`);
      }
      sk.gain('survival', d.cat === 'med' ? 6 : 2.5);
      if (d.stopBleed && this.bleedT > 0) { this.bleedT = 0; parts.push('sangrado detenido'); }
      if (d.cureInf && this.infection > 0) { this.infection = 0; this._warn.inf = false; game.notify('La infección remite', '#8fc870'); }
      if (d.pain) { this.painT = d.pain; parts.push('sin dolor'); }
      if (d.leaves) inv.add({ id: d.leaves, qty: 1 });
      if (this.hunger >= 30) this._warn.hunger = 0;
      if (this.thirst >= 30) this._warn.thirst = 0;
      const col = d.cat === 'med' ? '#e07070' : d.cat === 'drink' ? '#80b8e8' : '#d8b070';
      game.fx.floatText(this.x, this.y - 24, parts.join('  ') || d.name, col);
    }

    damage(amount, fromX, fromY, kind) {
      if (!this.alive || amount <= 0) return 0;
      const g = TM.game;
      if (this.painT > 0) amount *= 0.75;
      this.hp -= amount;
      this.lastDamageTime = g.time;
      this.hurtFlash = 1;
      const a = Math.atan2(fromY - this.y, fromX - this.x);
      if (g.hud) g.hud.hitFrom(a);
      g.shake(Math.min(10, 3 + amount * 0.3));
      g.fx.blood(this.x, this.y, -Math.cos(a), -Math.sin(a), 6);
      if (U.chance(0.5)) g.world.paintBlood(this.x + U.randRange(-6, 6), this.y + U.randRange(-6, 6), 4, 0.6);
      TM.Input.vibrate(amount > 15 ? 70 : 35);
      if (TM.Audio) TM.Audio.play('player_hurt', this.x, this.y, { volume: 0.8 });
      // heridas: sangrado (zarpazos, trampas) e infección (mordeduras)
      if (kind === 'zombie' || kind === 'trap') {
        const pb = kind === 'trap' ? 0.55 : 0.1 + amount * 0.012;
        if (U.chance(pb)) {
          if (this.bleedT <= 0) g.notify('Estás sangrando: usa una venda', '#e06050');
          this.bleedT = BLEED_TIME;
        }
        if (kind === 'zombie' && this.infection <= 0 && U.chance(INFECT_CHANCE)) {
          this.infection = 0.02;
          g.notify('La mordedura se ve mal. Come y bebe bien para resistir', '#a0c070');
        }
      }
      if (this.hp <= 0) {
        this.hp = 0;
        this.alive = false;
        this.deathTime = g.time;
        this.action = null;
        if (TM.Audio) TM.Audio.play('player_death', this.x, this.y);
        g.world.paintBlood(this.x, this.y, 16, 0.85);
        if (TM.InvUI) TM.InvUI.closeAll();
        g.onPlayerDeath(kind);
      }
      return amount;
    }

    push(dx, dy, speed) {
      this.kvx += dx * speed;
      this.kvy += dy * speed;
    }

    draw(ctx, t) {
      const x = this.x, y = this.y;
      if (!this.alive) {
        // cuerpo caído
        ctx.save(); ctx.translate(x, y); ctx.rotate(this.bodyAngle + 1.2);
        ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(2, 3, 16, 10, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#3b4030'; ctx.beginPath(); ctx.ellipse(0, 0, 14, 8, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#c49a7c'; ctx.beginPath(); ctx.arc(15, 0, 5, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        return;
      }
      const a = this.bodyAngle;
      const swing = this.moving ? Math.sin(this.walkPhase) : 0;
      // sombra
      ctx.fillStyle = 'rgba(0,0,0,0.38)';
      ctx.beginPath(); ctx.ellipse(x + 3, y + 4, 13, 11, 0, 0, Math.PI * 2); ctx.fill();

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(a);
      // piernas (asoman al caminar)
      ctx.fillStyle = '#23262a';
      ctx.beginPath(); ctx.ellipse(swing * 7, -5, 5, 3.6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(-swing * 7, 5, 5, 3.6, 0, 0, Math.PI * 2); ctx.fill();
      // mochila (más grande si lleva una mejor)
      const pack = this.inventory && this.inventory.pack;
      const pd = pack && TM.Items.DB[pack];
      ctx.fillStyle = pd ? pd.color : '#3d3326';
      const pw = pd ? 7 + Math.min(4, pd.pack / 5) : 7;
      ctx.fillRect(-6 - pw, -7 - (pw - 7), pw, 14 + (pw - 7) * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(-6 - pw, -7 - (pw - 7), 2, 14 + (pw - 7) * 2);
      // torso (chaqueta)
      const flash = this.hurtFlash;
      ctx.fillStyle = flash > 0.5 ? '#8a3b30' : '#55613f';
      ctx.beginPath(); ctx.ellipse(-1, 0, 8, 12, 0, 0, Math.PI * 2); ctx.fill();
      // contorno oscuro para leerse contra el suelo
      ctx.strokeStyle = 'rgba(8,8,6,0.75)'; ctx.lineWidth = 1.4; ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.beginPath(); ctx.ellipse(1, -3, 5, 7, 0, 0, Math.PI * 2); ctx.fill();

      this.drawArms(ctx);

      // cabeza
      ctx.fillStyle = '#c4946f';
      ctx.beginPath(); ctx.arc(1, 0, 6.2, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(8,8,6,0.7)'; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.fillStyle = '#2a2018';
      ctx.beginPath(); ctx.arc(-0.5, 0, 6.2, Math.PI * 0.55, Math.PI * 1.45); ctx.fill();
      ctx.beginPath(); ctx.ellipse(-1.2, 0, 4.6, 5.6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();

      // progreso de uso de un objeto
      if (this.action) {
        const k = this.action.t / this.action.dur;
        ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(x, y, 19, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = this.action.cat === 'med' ? '#e07070' : this.action.cat === 'drink' ? '#80b8e8' : '#d8b070';
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(x, y, 19, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k); ctx.stroke();
      }
    }

    // Brazos y arma según lo que lleva en la mano
    drawArms(ctx) {
      const W = TM.WEAPONS && TM.WEAPONS[this.weaponId];
      const kind = W ? W.kind : 'gun';
      const look = W ? W.look : 'pistol';
      const rec = this.recoil * 4;
      const sh = this.shoveAnim * 8;
      const sw = this.swapAnim;
      const arm = (ax, ay, rot) => { ctx.beginPath(); ctx.ellipse(ax, ay, 8, 3.2, rot, 0, Math.PI * 2); ctx.fill(); };
      const hand = (hx, hy) => { ctx.beginPath(); ctx.arc(hx, hy, 2.8, 0, Math.PI * 2); ctx.fill(); };

      if (kind === 'gun') {
        const long = look === 'shotgun' || look === 'rifle' || look === 'smg';
        const off = -rec + sh - sw * 6;
        ctx.fillStyle = '#3d4632';
        arm(6 + off, -6, 0.25); arm((long ? 10 : 6) + off, 6, long ? -0.1 : -0.25);
        ctx.fillStyle = '#b88a6a';
        hand(13 + off, -1.5); hand((long ? 20 : 13) + off, 2);
        if (long) {
          const L = look === 'rifle' ? 26 : look === 'shotgun' ? 22 : 16;
          ctx.fillStyle = look === 'smg' ? '#1c1d20' : '#5a3e24';
          ctx.fillRect(4 + off, -2, 10, 4);
          ctx.fillStyle = '#151618';
          ctx.fillRect(12 + off, -1.6, L, 3.2);
          if (look === 'rifle') { ctx.fillStyle = '#26282c'; ctx.fillRect(14 + off, -3.6, 8, 2); }
          if (look === 'smg') { ctx.fillStyle = '#151618'; ctx.fillRect(18 + off, 1.6, 3, 5); }
        } else {
          ctx.fillStyle = '#151618';
          ctx.fillRect(14 + off, -1.6, 10, 3.2);
          if (look === 'pistolsil') { ctx.fillStyle = '#4a5056'; ctx.fillRect(24 + off, -2.2, 7, 4.4); }
        }
        return;
      }
      if (kind === 'throw') {
        const k = this.swingAnim;
        ctx.fillStyle = '#3d4632';
        arm(4, -6, 0.4); arm(2 - k * 6, 7, -0.6 + k);
        ctx.fillStyle = '#b88a6a';
        hand(9, -4); hand(6 + k * 10, 9 - k * 6);
        if (k < 0.2) TM.Items.drawIcon(ctx, look === 'molotov' ? 'molotov' : look === 'bomb' ? 'pipebomb' : look, 8, 10, 12);
        return;
      }
      // cuerpo a cuerpo
      if (look === 'fists') {
        const k = this.swingAnim;
        const pr = this.swingDir > 0 ? k : 0, pl = this.swingDir < 0 ? k : 0;
        ctx.fillStyle = '#3d4632';
        arm(5 + pl * 7 + sh, -6, 0.3); arm(5 + pr * 7 + sh, 6, -0.3);
        ctx.fillStyle = '#b88a6a';
        hand(11 + pl * 9 + sh, -5); hand(11 + pr * 9 + sh, 5);
        return;
      }
      const k = this.swingAnim;
      let ang;
      if (W.thrust) ang = 0.15;
      else {
        // barrido de un lado a otro con aceleración al principio
        const e = 1 - Math.pow(1 - (1 - k), 3);
        ang = k > 0 ? this.swingDir * (1.3 - 2.6 * e) : 0.75;
      }
      const reach = W.thrust ? k * 14 : 0;
      ctx.fillStyle = '#3d4632';
      arm(5 + reach * 0.6, 4, -0.2);
      arm(4, -5, 0.4);
      ctx.save();
      ctx.translate(9 + reach, 3);
      ctx.rotate(ang);
      const L = { knife: 12, bat: 26, batn: 26, pipe: 26, machete: 22, axe: 24, club: 24, spear: 40 }[look] || 22;
      if (look === 'knife' || look === 'machete') {
        ctx.fillStyle = '#2a2420'; ctx.fillRect(0, -1.5, 6, 3);
        ctx.fillStyle = '#c8ccd0';
        ctx.beginPath(); ctx.moveTo(6, -2.2); ctx.lineTo(6 + L, -0.6); ctx.lineTo(6 + L - 2, 1.6); ctx.lineTo(6, 2); ctx.closePath(); ctx.fill();
      } else if (look === 'axe') {
        ctx.fillStyle = '#8a6238'; ctx.fillRect(0, -1.5, L, 3);
        ctx.fillStyle = '#a8aeb4';
        ctx.beginPath(); ctx.moveTo(L - 6, -1.5); ctx.lineTo(L, -7); ctx.lineTo(L + 2, 0); ctx.lineTo(L, 4); ctx.lineTo(L - 6, 1.5); ctx.closePath(); ctx.fill();
      } else if (look === 'spear') {
        ctx.fillStyle = '#8a9098'; ctx.fillRect(-8, -1.4, L, 2.8);
        ctx.fillStyle = '#d0d4d8';
        ctx.beginPath(); ctx.moveTo(L - 8, -2.6); ctx.lineTo(L - 1, 0); ctx.lineTo(L - 8, 2.6); ctx.closePath(); ctx.fill();
      } else if (look === 'pipe') {
        ctx.fillStyle = '#8a9098'; ctx.fillRect(0, -2, L, 4);
        ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(2, -1.5, L - 4, 1);
      } else {
        // bate / garrote / bate con clavos
        ctx.fillStyle = look === 'club' ? '#8a6a40' : '#a07848';
        ctx.beginPath(); ctx.moveTo(0, -1.6); ctx.lineTo(L, -3.2); ctx.lineTo(L, 3.2); ctx.lineTo(0, 1.6); ctx.closePath(); ctx.fill();
        if (look === 'batn') {
          ctx.strokeStyle = '#c8ccd0'; ctx.lineWidth = 1;
          ctx.beginPath();
          for (let i = 0; i < 4; i++) { const px = L - 12 + i * 3.5; ctx.moveTo(px, -3); ctx.lineTo(px + 1, -6); ctx.moveTo(px, 3); ctx.lineTo(px + 1, 6); }
          ctx.stroke();
        }
      }
      ctx.restore();
      ctx.fillStyle = '#b88a6a';
      hand(9 + reach, 3); hand(6, -3);
    }
  }

  TM.Player = Player;
})();
