// Combate del jugador: armas de fuego (hitscan con trazadoras), cuerpo a cuerpo con durabilidad,
// arrojables (molotov, bomba casera, petardo, bengala), recarga desde el inventario y empujón.
(function () {
  const U = TM.U;
  const DB = () => TM.Items.DB;

  // Unidades de mundo (32 u = 1 m). noise = radio de ruido. durLoss = durabilidad por golpe que acierta.
  const WEAPONS = {
    fists: { name: 'Puños', kind: 'melee', dmgType: 'melee', damage: 12, fireDelay: 0.42, range: 30, arc: 1.0, maxHits: 1, knock: 200, stamina: 5, noise: 50, durLoss: 0, look: 'fists' },
    knife: { name: 'Cuchillo', kind: 'melee', dmgType: 'melee', damage: 30, fireDelay: 0.34, range: 33, arc: 0.9, maxHits: 1, knock: 0, stamina: 4, noise: 35, durLoss: 0.007, stealth: 3, look: 'knife' },
    bat: { name: 'Bate', kind: 'melee', dmgType: 'melee', damage: 38, fireDelay: 0.58, range: 46, arc: 1.4, maxHits: 3, knock: 300, stamina: 9, noise: 90, durLoss: 0.012, look: 'bat' },
    bat_nails: { name: 'Bate con clavos', kind: 'melee', dmgType: 'melee', damage: 52, fireDelay: 0.6, range: 46, arc: 1.4, maxHits: 3, knock: 280, stamina: 9, noise: 90, durLoss: 0.016, look: 'batn' },
    pipe: { name: 'Tubo', kind: 'melee', dmgType: 'melee', damage: 34, fireDelay: 0.62, range: 48, arc: 1.2, maxHits: 2, knock: 250, stamina: 10, noise: 100, durLoss: 0.005, look: 'pipe' },
    machete: { name: 'Machete', kind: 'melee', dmgType: 'melee', damage: 55, fireDelay: 0.5, range: 44, arc: 1.15, maxHits: 2, knock: 90, stamina: 8, noise: 60, durLoss: 0.009, stealth: 1.8, look: 'machete' },
    axe: { name: 'Hacha', kind: 'melee', dmgType: 'melee', damage: 85, fireDelay: 0.85, range: 48, arc: 0.95, maxHits: 2, knock: 160, stamina: 14, noise: 110, durLoss: 0.007, look: 'axe' },
    club: { name: 'Garrote', kind: 'melee', dmgType: 'melee', damage: 28, fireDelay: 0.6, range: 44, arc: 1.2, maxHits: 2, knock: 230, stamina: 8, noise: 80, durLoss: 0.025, look: 'club' },
    spear: { name: 'Lanza', kind: 'melee', dmgType: 'melee', damage: 42, fireDelay: 0.55, range: 68, arc: 0.45, maxHits: 2, knock: 140, stamina: 8, noise: 60, durLoss: 0.012, thrust: true, look: 'spear' },

    pistol: { name: 'Pistola', kind: 'gun', ammo: 'ammo_9mm', dmgType: 'bullet', damage: 34, fireDelay: 0.24, magSize: 12, reloadTime: 1.35, spread: 0.035, pellets: 1, range: 720, noise: 720, crit: 0.14, durLoss: 0, sound: 'shot_pistol', shake: 2.2, look: 'pistol' },
    pistol_sil: { name: 'Pistola silenciada', kind: 'gun', ammo: 'ammo_9mm', dmgType: 'bullet', damage: 31, fireDelay: 0.26, magSize: 12, reloadTime: 1.4, spread: 0.04, pellets: 1, range: 650, noise: 230, crit: 0.14, durLoss: 1 / 45, sound: 'shot_pistol', soundOpts: { volume: 0.35, pitch: 1.7 }, shake: 1.4, silenced: true, look: 'pistolsil' },
    smg: { name: 'Subfusil', kind: 'gun', ammo: 'ammo_9mm', dmgType: 'bullet', damage: 19, fireDelay: 0.075, magSize: 30, reloadTime: 1.9, spread: 0.075, pellets: 1, range: 620, noise: 820, crit: 0.06, durLoss: 0, sound: 'shot_smg', shake: 1.3, look: 'smg' },
    shotgun: { name: 'Escopeta', kind: 'gun', ammo: 'ammo_shell', dmgType: 'bullet', damage: 15, fireDelay: 0.85, magSize: 6, reloadTime: 0.5, perRound: true, spread: 0.19, pellets: 8, range: 340, falloff: 0.45, noise: 980, crit: 0, durLoss: 0, sound: 'shot_shotgun', shake: 5.5, look: 'shotgun' },
    rifle: { name: 'Rifle', kind: 'gun', ammo: 'ammo_rifle', dmgType: 'bullet', damage: 120, fireDelay: 1.15, magSize: 5, reloadTime: 2.4, spread: 0.006, moveSpread: 4, pellets: 1, pierce: 2, range: 1150, noise: 1350, crit: 0.22, durLoss: 0, sound: 'shot_rifle', shake: 4.5, look: 'rifle' },

    molotov: { name: 'Molotov', kind: 'throw', dmgType: 'fire', range: 300, radius: 66, burnTime: 7.5, damage: 22, noise: 350, fireDelay: 0.7, look: 'molotov' },
    pipebomb: { name: 'Bomba casera', kind: 'throw', dmgType: 'explosion', range: 280, radius: 135, damage: 170, fuse: 1.5, noise: 1300, fireDelay: 0.7, look: 'bomb' },
    firecracker: { name: 'Petardo', kind: 'throw', dmgType: null, range: 340, fuse: 0.9, duration: 4.5, noise: 700, fireDelay: 0.5, look: 'firecracker' },
    flare: { name: 'Bengala', kind: 'throw', dmgType: null, range: 300, duration: 30, noise: 260, light: 330, fireDelay: 0.5, look: 'flare' },
  };

  const SWAP_TIME = 0.35;

  class Combat {
    constructor(game) {
      this.game = game;
      this.cooldown = 0;
      this.reloading = false;
      this.reloadT = 0;
      this.reloadMax = 1;
      this.shoveCd = 0;
      this.shotsFired = 0;
      this.shotsHit = 0;
      this.swing = null;          // golpe cuerpo a cuerpo pendiente
      this.projectiles = [];
      this.fires = [];
      this.bombs = [];
      this.crackers = [];
      this.flares = [];
      this.burning = new Map();   // zombie -> segundos de quemadura restantes
      this.noAmmoT = 0;
      this.interact = TM.Interact ? new TM.Interact(game) : null;
      if (TM.InvUI && TM.InvUI.ready) TM.InvUI.closeAll(); // partida nueva o vuelta al menú
    }

    get inv() { const p = this.game.player; return p && p.inventory; }
    get weaponId() { const inv = this.inv; return inv ? inv.activeWeaponId() : 'pistol'; }
    get weapon() { return WEAPONS[this.weaponId] || WEAPONS.fists; }
    get gunStack() { const inv = this.inv; const s = inv && !inv.ready ? inv.equipped : null; return s && WEAPONS[DB()[s.id].weapon].kind === 'gun' ? s : null; }
    get mag() { const s = this.gunStack; return s ? s.mag | 0 : 0; }
    set mag(v) { const s = this.gunStack; if (s) s.mag = v; }
    reserve() { const w = this.weapon; return w.ammo && this.inv ? this.inv.count(w.ammo) : 0; }

    // El inventario va en su propio guardado (main.js); aquí solo el estado del jugador que no es inventario.
    serialize() {
      const p = this.game.player;
      return { v: 2, mag: this.mag, status: p && p.serializeStatus ? p.serializeStatus() : null };
    }
    deserialize(d) {
      if (!d) return;
      const p = this.game.player;
      // partidas de la Fase 1: solo traían el cargador de la pistola
      if (typeof d.mag === 'number' && !d.v) { const s = this.gunStack; if (s) s.mag = U.clamp(d.mag | 0, 0, this.weapon.magSize || 12); }
      if (d.status && p && p.deserializeStatus) p.deserializeStatus(d.status);
    }

    update(dt) {
      const g = this.game, p = g.player, In = TM.Input;
      this.cooldown -= dt;
      this.shoveCd -= dt;
      this.noAmmoT -= dt;
      this.updateProjectiles(dt);
      this.updateAreas(dt);
      if (!p.alive) { this.swing = null; return; }
      const inv = this.inv;

      if (this.interact) this.interact.update(dt);

      if (this.swing) {
        this.swing.t -= dt;
        if (this.swing.t <= 0) { const s = this.swing; this.swing = null; this.resolveSwing(s); }
      }

      if (this.reloading) this.updateReload(dt);

      if (In.consume('reload') && !this.reloading) this.startReload(true);
      if (In.consume('shove')) this.shove();
      if (In.consume('light')) {
        p.flashlightOn = !p.flashlightOn;
        if (TM.Audio) TM.Audio.play('flashlight');
      }
      if (In.consume('swap') && inv) this.cycleWeapon();
      for (let i = 0; i < 3; i++) if (In.consume('q' + (i + 1)) && this.interact) this.interact.useQuick(i);

      const w = this.weapon;
      if (In.fire && this.cooldown <= 0 && !p.action) {
        if (w.kind === 'gun') {
          const s = this.gunStack;
          if (this.reloading && w.perRound && s && s.mag > 0) this.reloading = false; // la escopeta interrumpe la recarga
          if (!this.reloading) {
            if (s && s.mag > 0) this.fireGun(w, s);
            else {
              if (TM.Audio) TM.Audio.play('empty_click', p.x, p.y);
              this.cooldown = 0.3;
              this.startReload(false);
            }
          }
        } else if (w.kind === 'melee') {
          if (!this.swing) this.startSwing(w);
        } else if (w.kind === 'throw') {
          this.throwReady(w);
        }
      }
      p.weaponId = this.weaponId;
    }

    // ---------- cambio de arma ----------
    onWeaponChanged() {
      this.reloading = false;
      this.swing = null;
      this.cooldown = Math.max(this.cooldown, SWAP_TIME);
      const p = this.game.player;
      p.swapAnim = 1;
      if (TM.Audio) TM.Audio.play('reload', p.x, p.y, { volume: 0.35, pitch: 1.4 });
    }

    cycleWeapon() {
      const inv = this.inv;
      if (inv.ready) { inv.setReady(null); this.onWeaponChanged(); return; }
      const before = inv.equipped;
      const next = inv.cycleWeapon();
      if (next !== before || (!next && before)) {
        this.onWeaponChanged();
        const p = this.game.player;
        this.game.fx.floatText(p.x, p.y - 24, next ? TM.Items.name(next.id) : 'Puños', '#e0d6c0');
      }
    }

    equip(stack) {
      const inv = this.inv;
      if (inv.equipped === stack && !inv.ready) return;
      inv.equip(stack);
      this.onWeaponChanged();
    }

    // ---------- recarga ----------
    startReload(manual) {
      if (this.reloading) return false;
      const w = this.weapon, s = this.gunStack, p = this.game.player;
      if (w.kind !== 'gun' || !s || s.mag >= w.magSize) return false;
      if (this.inv.count(w.ammo) <= 0) {
        if (this.noAmmoT <= 0) {
          this.noAmmoT = 1.2;
          this.game.fx.floatText(p.x, p.y - 26, 'SIN ' + TM.Items.name(w.ammo).toUpperCase(), '#e07050');
          if (manual || s.mag === 0) this.game.notify(TM.Input.usingTouch ? 'Sin munición. Toca el arma para cambiar.' : 'Sin munición. Pulsa Q para cambiar de arma.', '#d08060');
        }
        return false;
      }
      this.reloading = true;
      this.reloadT = this.reloadMax = w.reloadTime;
      if (TM.Audio) TM.Audio.play('reload', p.x, p.y, w.perRound ? { volume: 0.6, pitch: 1.2 } : undefined);
      return true;
    }

    updateReload(dt) {
      const w = this.weapon, s = this.gunStack;
      if (w.kind !== 'gun' || !s) { this.reloading = false; return; }
      this.reloadT -= dt;
      if (this.reloadT > 0) return;
      const inv = this.inv, p = this.game.player;
      if (w.perRound) {
        if (inv.remove(w.ammo, 1)) s.mag++;
        if (s.mag < w.magSize && inv.count(w.ammo) > 0) {
          this.reloadT = this.reloadMax = w.reloadTime;
          if (TM.Audio) TM.Audio.play('reload', p.x, p.y, { volume: 0.5, pitch: 1.25 });
        } else this.reloading = false;
      } else {
        const took = inv.remove(w.ammo, w.magSize - s.mag);
        s.mag += took;
        this.reloading = false;
      }
      inv.changed();
    }

    // ---------- armas de fuego ----------
    // Ayuda de apuntado suave: corrige hacia el zombie más alineado dentro de un cono estrecho.
    assist(angle, range, cone) {
      const g = this.game, p = g.player;
      let best = null, bestScore = cone || 0.16; // ~9 grados
      for (const z of g.zombies) {
        if (z.dead || z.fakeDead) continue;
        const d = U.dist(p.x, p.y, z.x, z.y);
        if (d > range * 0.85) continue;
        const da = Math.abs(U.angDiff(angle, Math.atan2(z.y - p.y, z.x - p.x)));
        const score = da + d / 6000;
        if (score < bestScore && g.world.lineOfSight(p.x, p.y, z.x, z.y)) { best = z; bestScore = score; }
      }
      if (!best) return angle;
      const ta = Math.atan2(best.y - p.y, best.x - p.x);
      return angle + U.angDiff(angle, ta) * 0.65;
    }

    fireGun(w, stack) {
      const g = this.game, p = g.player;
      this.cooldown = w.fireDelay;
      stack.mag--;
      this.shotsFired++;
      p.recoil = 1;
      p.aimHold = 0.6;

      const base = this.assist(p.aimAngle, w.range, w.pellets > 1 ? 0.22 : 0.16);
      const moveSpread = p.moving ? (w.moveSpread || 1.6) : 1;
      const mx = p.x + Math.cos(base) * 24, my = p.y + Math.sin(base) * 24;
      const hits = new Map();   // zombie -> daño acumulado (un solo takeDamage por zombie)
      let wallHit = null;

      for (let k = 0; k < (w.pellets || 1); k++) {
        let ang = base + U.randRange(-w.spread, w.spread) * moveSpread;
        if (w.pellets > 1) ang = base + (k / (w.pellets - 1) - 0.5) * w.spread * 2 * moveSpread + U.randRange(-0.03, 0.03);
        const dx = Math.cos(ang), dy = Math.sin(ang);
        const ex = p.x + dx * w.range, ey = p.y + dy * w.range;
        const tWall = g.world.raycast(p.x, p.y, ex, ey);
        // zombies en la línea, por orden
        const line = [];
        for (const z of g.zombies) {
          if (z.dead) continue;
          const t = U.segCircle(p.x, p.y, ex, ey, z.x, z.y, z.r + 2);
          if (t >= 0 && t < tWall) line.push({ z, t });
        }
        line.sort((a, b) => a.t - b.t);
        const maxHit = 1 + (w.pierce || 0);
        let tEnd = tWall;
        for (let i = 0; i < line.length && i < maxHit; i++) {
          const { z, t } = line[i];
          let dmg = w.damage * Math.pow(0.7, i) * U.randRange(0.9, 1.1);
          if (w.falloff) {
            const dist = t * w.range;
            if (dist > w.range * w.falloff) dmg *= U.lerp(1, 0.3, (dist - w.range * w.falloff) / (w.range * (1 - w.falloff)));
          }
          const h = hits.get(z) || { dmg: 0, dx: 0, dy: 0 };
          h.dmg += dmg; h.dx += dx; h.dy += dy;
          hits.set(z, h);
          tEnd = t;
        }
        const hx = p.x + (ex - p.x) * tEnd, hy = p.y + (ey - p.y) * tEnd;
        g.fx.tracer(mx, my, hx, hy);
        if (!line.length && tWall < 1 && (!wallHit || k % 3 === 0)) { wallHit = { x: hx, y: hy, dx, dy }; g.fx.spark(hx, hy, -dx, -dy, w.pellets > 1 ? 2 : 6); }
      }

      g.fx.muzzle(mx, my, base);
      g.fx.light(mx, my, w.silenced ? 90 : w.pellets > 1 ? 300 : 230, w.silenced ? 0.4 : 0.9, 0.07);
      if (w.pellets === 1 || !w.perRound) g.fx.shell(p.x + Math.cos(base) * 8, p.y + Math.sin(base) * 8, base);
      g.shake(w.shake || 2);
      if (TM.Audio) TM.Audio.play(w.sound, p.x, p.y, w.soundOpts);
      g.emitNoise(p.x, p.y, w.noise, 'shot');
      if (g.director && g.director.onPlayerAttack) g.director.onPlayerAttack('bullet');

      let anyKill = false, anyCrit = false;
      for (const [z, h] of hits) {
        const L = Math.hypot(h.dx, h.dy) || 1;
        const crit = U.chance(w.crit || 0);
        if (crit) { anyCrit = true; g.fx.floatText(z.x, z.y - 18, '¡CRÍTICO!', '#e8c070'); }
        const killed = z.takeDamage(h.dmg * (crit ? 2 : 1), 'bullet', h.dx / L, h.dy / L);
        if (killed) anyKill = true;
      }
      if (hits.size) {
        this.shotsHit++;
        if (anyKill) g.hitstop(w.pellets > 1 || w.pierce ? 0.045 : 0.035);
        TM.Input.vibrate(w.pellets > 1 || w.pierce ? 30 : 12);
      }
      if (wallHit) {
        g.fx.dust(wallHit.x, wallHit.y, 3);
        if (TM.Audio) TM.Audio.play('bullet_wall', wallHit.x, wallHit.y, { volume: 0.6 });
        g.emitNoise(wallHit.x, wallHit.y, 260, 'impact');
      }

      // el silenciador casero se gasta
      if (w.silenced && stack.dur !== undefined) {
        stack.dur -= w.durLoss;
        if (stack.dur <= 0) {
          stack.id = 'pistol'; delete stack.dur;
          g.notify('El silenciador se deshizo', '#d0a060');
          if (TM.Audio) TM.Audio.play('weapon_break', p.x, p.y);
        }
      }
      this.inv.changed();
      if (stack.mag === 0) this.startReload(false);
    }

    // ---------- cuerpo a cuerpo ----------
    meleeAssist(angle, w) {
      const g = this.game, p = g.player;
      let best = null, bestScore = 1e9;
      const reach = w.range + 34;
      for (const z of g.zombies) {
        if (z.dead || z.fakeDead) continue;
        const d = U.dist(p.x, p.y, z.x, z.y);
        if (d > reach + z.r) continue;
        const da = Math.abs(U.angDiff(angle, Math.atan2(z.y - p.y, z.x - p.x)));
        if (da > 1.0) continue;
        const score = da * 60 + d;
        if (score < bestScore) { bestScore = score; best = z; }
      }
      if (!best) return angle;
      return Math.atan2(best.y - p.y, best.x - p.x);
    }

    startSwing(w) {
      const g = this.game, p = g.player;
      const tired = p.stamina < w.stamina;
      if (!tired) { p.stamina -= w.stamina; p.staminaDelay = 0.5; }
      this.cooldown = w.fireDelay * (tired ? 1.5 : 1);
      const ang = this.meleeAssist(p.aimAngle, w);
      p.aimAngle = ang;
      p.aimHold = 0.5;
      p.swingAnim = 1;
      p.swingDir = -(p.swingDir || 1);
      this.swing = { t: w.thrust ? 0.06 : 0.08, w, ang, tired, stack: this.inv.equipped };
      if (TM.Audio) TM.Audio.play('melee_swing', p.x, p.y, { pitch: w.damage > 60 ? 0.8 : w.damage < 25 ? 1.3 : 1 });
      // pequeño impulso hacia delante: da peso al golpe
      p.push(Math.cos(ang), Math.sin(ang), w.thrust ? 90 : 55);
    }

    resolveSwing(s) {
      const g = this.game, p = g.player, w = s.w;
      const targets = [];
      for (const z of g.zombies) {
        if (z.dead) continue;
        const d = U.dist(p.x, p.y, z.x, z.y);
        if (d > w.range + z.r) continue;
        const za = Math.atan2(z.y - p.y, z.x - p.x);
        const close = d < z.r + p.r + 5;
        if (Math.abs(U.angDiff(s.ang, za)) > w.arc / 2 + (close ? 0.6 : 0)) continue;
        if (!close && !g.world.lineOfSight(p.x, p.y, z.x, z.y)) continue;
        targets.push({ z, d, za });
      }
      targets.sort((a, b) => a.d - b.d);
      let hits = 0, kills = 0;
      for (let i = 0; i < targets.length && i < w.maxHits; i++) {
        const { z, za } = targets[i];
        const nx = Math.cos(za), ny = Math.sin(za);
        let dmg = w.damage * U.randRange(0.9, 1.1) * (s.tired ? 0.6 : 1) * (i ? 0.75 : 1);
        // sigilo: golpe a un zombie que no te ha visto
        if (!z.alerted && !z.fakeDead) {
          dmg *= w.stealth || 1.5;
          g.fx.floatText(z.x, z.y - 20, '¡SIGILO!', '#a8d0a0');
        }
        const killed = z.takeDamage(dmg, 'melee', nx, ny);
        if (killed) kills++;
        else if (w.knock) z.shove(nx, ny, w.knock * (s.tired ? 0.6 : 1));
        g.fx.spark(z.x - nx * z.r, z.y - ny * z.r, -nx, -ny, 3);
        hits++;
      }
      g.fx.swipe(p.x, p.y, s.ang);
      // sin zombies alcanzados: golpear la puerta cerrada que hay delante (atrancadas incluidas)
      if (!hits && g.world.doorsNear && g.world.damageDoor) {
        const fx = p.x + Math.cos(s.ang) * w.range * 0.7, fy = p.y + Math.sin(s.ang) * w.range * 0.7;
        let door = null;
        try { door = g.world.doorsNear(fx, fy, w.range * 0.6).find((d) => !d.open && !d.broken); } catch (e) { door = null; }
        if (door) {
          const dc = door.cx !== undefined ? { x: door.cx, y: door.cy } : { x: door.x + door.w / 2, y: door.y + door.h / 2 };
          const broke = g.world.damageDoor(door.id, w.damage * (s.tired ? 0.6 : 1));
          if (TM.Audio) TM.Audio.play(broke ? 'door_break' : 'door_bash', dc.x, dc.y);
          g.fx.spark(dc.x, dc.y, -Math.cos(s.ang), -Math.sin(s.ang), broke ? 8 : 3);
          g.shake(broke ? 4 : 2);
          g.emitNoise(dc.x, dc.y, broke ? 400 : 250, 'door_bash');
          if (broke) g.fx.floatText(dc.x, dc.y - 16, 'Puerta rota', '#d0a080');
          const st = s.stack;
          if (st && w.durLoss && this.inv.slots.indexOf(st) >= 0) {
            st.dur = (st.dur === undefined ? 1 : st.dur) - w.durLoss;
            if (st.dur <= 0) this.breakWeapon(st);
            this.inv.changed();
          }
        }
      }
      if (hits) {
        if (TM.Audio) TM.Audio.play('melee_hit', p.x, p.y, { pitch: w.damage > 60 ? 0.85 : 1 });
        g.shake(kills ? 4 : 3);
        g.hitstop(kills ? 0.045 : 0.03);
        TM.Input.vibrate(kills ? 26 : 16);
        // desgaste del arma
        const st = s.stack;
        if (st && w.durLoss && this.inv.slots.indexOf(st) >= 0) {
          st.dur = (st.dur === undefined ? 1 : st.dur) - w.durLoss * (1 + 0.3 * (hits - 1));
          if (st.dur <= 0) this.breakWeapon(st);
          else if (st.dur < 0.15 && st.dur + w.durLoss >= 0.15) g.notify(`Tu ${TM.Items.name(st.id).toLowerCase()} está a punto de romperse`, '#d0a060');
          this.inv.changed();
        }
      }
      g.emitNoise(p.x, p.y, hits ? w.noise : w.noise * 0.4, 'melee');
      if (g.director && g.director.onPlayerAttack) g.director.onPlayerAttack('melee');
    }

    breakWeapon(stack) {
      const g = this.game, p = g.player, inv = this.inv;
      const name = TM.Items.name(stack.id);
      inv.removeStack(stack);
      g.notify(`¡Se rompió: ${name}!`, '#e08050');
      g.fx.spark(p.x + Math.cos(p.aimAngle) * 20, p.y + Math.sin(p.aimAngle) * 20, Math.cos(p.aimAngle), Math.sin(p.aimAngle), 8);
      if (TM.Audio) TM.Audio.play('weapon_break', p.x, p.y);
      TM.Input.vibrate(60);
      // equipa otra arma cuerpo a cuerpo si hay; si no, puños
      const next = inv.weaponStacks().find((s) => WEAPONS[DB()[s.id].weapon].kind === 'melee');
      inv.equip(next || null);
      this.onWeaponChanged();
    }

    // ---------- empujón (siempre disponible) ----------
    shove() {
      const g = this.game, p = g.player;
      if (this.shoveCd > 0 || p.stamina < 8) return;
      this.shoveCd = 0.65;
      p.stamina -= 12;
      p.staminaDelay = 0.6;
      p.shoveAnim = 1;
      const ang = p.aimAngle;
      let hits = 0;
      for (const z of g.zombies) {
        if (z.dead) continue;
        const d = U.dist(p.x, p.y, z.x, z.y);
        if (d > 46 + z.r) continue;
        const za = Math.atan2(z.y - p.y, z.x - p.x);
        if (Math.abs(U.angDiff(ang, za)) > 1.0 && d > z.r + p.r + 4) continue;
        const nx = Math.cos(za), ny = Math.sin(za);
        z.shove(nx, ny, 340);
        z.takeDamage(7, 'melee', nx, ny);
        hits++;
      }
      g.fx.swipe(p.x, p.y, ang);
      if (TM.Audio) TM.Audio.play('shove', p.x, p.y, { volume: hits ? 1 : 0.5 });
      if (hits) { g.shake(3); TM.Input.vibrate(20); }
      g.emitNoise(p.x, p.y, 200, 'shove');
      if (g.director && g.director.onPlayerAttack) g.director.onPlayerAttack('melee');
    }

    // ---------- arrojables ----------
    // Punto de caída: hacia la mira; si hay un zombie alineado, sobre él; nunca atraviesa muros.
    throwTarget(w) {
      const g = this.game, p = g.player;
      let ang = p.aimAngle, dist = w.range * 0.8;
      let best = null, bestScore = 0.35;
      for (const z of g.zombies) {
        if (z.dead || z.fakeDead) continue;
        const d = U.dist(p.x, p.y, z.x, z.y);
        if (d > w.range || d < 40) continue;
        const da = Math.abs(U.angDiff(ang, Math.atan2(z.y - p.y, z.x - p.x)));
        const sc = da + d / 3000;
        if (sc < bestScore) { bestScore = sc; best = z; }
      }
      if (best) { ang = Math.atan2(best.y - p.y, best.x - p.x); dist = U.dist(p.x, p.y, best.x, best.y); }
      let tx = p.x + Math.cos(ang) * dist, ty = p.y + Math.sin(ang) * dist;
      const t = g.world.raycast(p.x, p.y, tx, ty);
      if (t < 1) { const k = Math.max(0, t * dist - 12) / dist; tx = p.x + (tx - p.x) * k; ty = p.y + (ty - p.y) * k; }
      return { x: tx, y: ty };
    }

    throwReady(w) {
      const g = this.game, p = g.player, inv = this.inv;
      const stack = inv.ready;
      if (!stack) return;
      const id = stack.id;
      const tgt = this.throwTarget(w);
      inv.removeStack(stack, 1);
      // vuelve al arma anterior tras lanzar
      inv.setReady(null);
      this.cooldown = w.fireDelay;
      p.swingAnim = 1; p.swingDir = 1;
      const d = U.dist(p.x, p.y, tgt.x, tgt.y);
      this.projectiles.push({ id, w, x0: p.x, y0: p.y, x1: tgt.x, y1: tgt.y, t: 0, dur: 0.18 + d / 420, x: p.x, y: p.y, h: 0, rot: 0 });
      if (TM.Audio) TM.Audio.play(id === 'molotov' ? 'molotov_throw' : 'melee_swing', p.x, p.y, { pitch: 1.2 });
      if (w.dmgType && g.director && g.director.onPlayerAttack) g.director.onPlayerAttack(w.dmgType);
      g.emitNoise(p.x, p.y, 90, 'melee');
    }

    updateProjectiles(dt) {
      const g = this.game;
      for (let i = this.projectiles.length - 1; i >= 0; i--) {
        const pr = this.projectiles[i];
        pr.t += dt;
        const k = Math.min(1, pr.t / pr.dur);
        pr.x = U.lerp(pr.x0, pr.x1, k); pr.y = U.lerp(pr.y0, pr.y1, k);
        pr.h = Math.sin(k * Math.PI) * (20 + pr.dur * 40);
        pr.rot += dt * 14;
        if (pr.id === 'molotov' && Math.random() < 0.5) g.addFrameLight(pr.x, pr.y - pr.h, 70, 0.5);
        if (k >= 1) { this.projectiles.splice(i, 1); this.land(pr); }
      }
    }

    land(pr) {
      const g = this.game, w = pr.w, x = pr.x1, y = pr.y1;
      switch (pr.id) {
        case 'molotov':
          if (TM.Audio) { TM.Audio.play('glass_break', x, y); TM.Audio.play('fire_burn', x, y); }
          g.emitNoise(x, y, w.noise, 'glass');
          this.fires.push({ x, y, r: w.radius, t: 0, dur: w.burnTime, tick: 0, snd: 2.5, dps: w.damage, seed: Math.random() * 10 });
          g.fx.light(x, y, 360, 1, 0.4);
          g.fx.spark(x, y, 0, -1, 14);
          g.shake(2);
          break;
        case 'pipebomb':
          if (TM.Audio) TM.Audio.play('empty_click', x, y, { volume: 0.7 });
          this.bombs.push({ x, y, t: w.fuse, w, blink: 0 });
          break;
        case 'firecracker':
          if (TM.Audio) TM.Audio.play('empty_click', x, y, { volume: 0.5, pitch: 1.6 });
          this.crackers.push({ x, y, t: -w.fuse, dur: w.duration, next: 0, noiseT: 0, w });
          break;
        case 'flare':
          if (TM.Audio) TM.Audio.play('fire_burn', x, y, { volume: 0.5, pitch: 1.4 });
          this.flares.push({ x, y, t: 0, dur: w.duration, noiseT: 0.5, w });
          g.emitNoise(x, y, w.noise, 'flare');
          break;
      }
    }

    explode(x, y, w) {
      const g = this.game, p = g.player;
      if (TM.Audio) TM.Audio.play('explosion', x, y);
      g.emitNoise(x, y, w.noise, 'explosion');
      const dp = U.dist(x, y, p.x, p.y);
      g.shake(U.clamp(14 - dp / 60, 3, 14));
      g.hitstop(0.05);
      TM.Input.vibrate(dp < 400 ? 120 : 40);
      g.fx.ring(x, y, w.radius * 1.3, 'rgba(255,170,80,0.85)', 0.45);
      g.fx.light(x, y, w.radius * 4, 1, 0.45);
      g.fx.spark(x, y, 1, 0, 10); g.fx.spark(x, y, -1, 0, 10);
      g.fx.dust(x, y, 10);
      this.fires.push({ x, y, r: w.radius * 0.35, t: 0, dur: 2.2, tick: 0.25, snd: 9, dps: 8, seed: Math.random() * 10 });
      for (const z of g.zombies) {
        if (z.dead) continue;
        const d = U.dist(x, y, z.x, z.y);
        if (d > w.radius + z.r) continue;
        if (!g.world.lineOfSight(x, y, z.x, z.y)) continue;
        const nx = (z.x - x) / (d || 1), ny = (z.y - y) / (d || 1);
        const killed = z.takeDamage(w.damage * (1 - Math.min(1, d / w.radius) * 0.6), 'explosion', nx, ny);
        if (!killed) z.shove(nx, ny, 520);
      }
      if (p.alive && dp < w.radius * 1.1 && g.world.lineOfSight(x, y, p.x, p.y)) {
        const k = 1 - dp / (w.radius * 1.1);
        p.damage(w.damage * 0.45 * k + 6, x, y, 'explosion');
        p.push((p.x - x) / (dp || 1), (p.y - y) / (dp || 1), 380 * k);
      }
      // las puertas cercanas también sufren
      const W = g.world;
      if (W.doorsNear && W.damageDoor) {
        try { for (const d of W.doorsNear(x, y, w.radius)) if (!d.open && !d.broken) W.damageDoor(d.id, w.damage); } catch (e) { /* mundo sin puertas */ }
      }
    }

    updateAreas(dt) {
      const g = this.game, p = g.player;
      const t = g.time;
      // nivel de fuego cercano para el bucle de sonido (0..1); main.js puede combinarlo con la fogata
      let fireLvl = 0;
      // fuego en el suelo
      for (let i = this.fires.length - 1; i >= 0; i--) {
        const f = this.fires[i];
        f.t += dt;
        if (f.t >= f.dur) { this.fires.splice(i, 1); continue; }
        const fade = Math.min(1, (f.dur - f.t) / 1.2, f.t * 6);
        fireLvl = Math.max(fireLvl, fade * U.clamp(1 - (U.dist(p.x, p.y, f.x, f.y) - f.r) / 520, 0, 1));
        const fl = 0.85 + Math.sin(t * 13 + f.seed) * 0.08 + Math.random() * 0.07;
        g.addFrameLight(f.x, f.y, f.r * 3.4 * fl * fade, 0.95 * fade);
        if (Math.random() < dt * 22 * fade) {
          const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * f.r;
          g.fx.spark(f.x + Math.cos(a) * rr, f.y + Math.sin(a) * rr, U.randRange(-0.3, 0.3), -1, 1);
        }
        if (Math.random() < dt * 3 * fade) g.fx.dust(f.x + U.randRange(-f.r, f.r) * 0.6, f.y + U.randRange(-f.r, f.r) * 0.6, 1);
        f.snd -= dt;
        if (f.snd <= 0) { f.snd = 2.4; if (TM.Audio) TM.Audio.play('fire_burn', f.x, f.y, { volume: 0.6 * fade }); }
        f.tick -= dt;
        if (f.tick <= 0) {
          f.tick = 0.5;
          for (const z of g.zombies) {
            if (z.dead) continue;
            if (U.dist2(z.x, z.y, f.x, f.y) > (f.r + z.r * 0.5) * (f.r + z.r * 0.5)) continue;
            z.takeDamage(f.dps * 0.5, 'fire', 0, 0);
            if (!z.dead) this.burning.set(z, 2.5);
          }
          if (p.alive && U.dist(p.x, p.y, f.x, f.y) < f.r + p.r * 0.4) p.damage(5, f.x, f.y, 'fire');
        }
      }
      // zombies ardiendo tras salir del fuego
      for (const [z, rem] of this.burning) {
        const left = rem - dt;
        if (z.dead || left <= 0) { this.burning.delete(z); continue; }
        this.burning.set(z, left);
        if (Math.floor(left / 0.5) !== Math.floor(rem / 0.5)) z.takeDamage(4, 'fire', 0, 0);
        if (Math.random() < dt * 10) g.fx.spark(z.x + U.randRange(-5, 5), z.y + U.randRange(-5, 5), 0, -1, 1);
        if (Math.random() < 0.3) g.addFrameLight(z.x, z.y, 70, 0.4);
      }
      // bombas con mecha
      for (let i = this.bombs.length - 1; i >= 0; i--) {
        const b = this.bombs[i];
        b.t -= dt; b.blink += dt;
        if (b.blink > (b.t < 0.6 ? 0.1 : 0.25)) { b.blink = 0; if (TM.Audio) TM.Audio.play('empty_click', b.x, b.y, { volume: 0.5, pitch: 2 }); }
        if (b.t <= 0) { this.bombs.splice(i, 1); this.explode(b.x, b.y, b.w); }
      }
      // petardos: ráfagas de estallidos que atraen a los muertos
      for (let i = this.crackers.length - 1; i >= 0; i--) {
        const c = this.crackers[i];
        c.t += dt;
        if (c.t >= c.dur) { this.crackers.splice(i, 1); continue; }
        if (c.t < 0) continue;
        c.next -= dt;
        if (c.next <= 0) {
          c.next = U.randRange(0.12, 0.38);
          if (TM.Audio) TM.Audio.play('shot_pistol', c.x, c.y, { volume: 0.45, pitch: U.randRange(1.6, 2.2) });
          g.fx.spark(c.x, c.y, U.randRange(-1, 1), U.randRange(-1, 1), 3);
          g.fx.light(c.x, c.y, 120, 0.7, 0.06);
        }
        c.noiseT -= dt;
        if (c.noiseT <= 0) { c.noiseT = 0.7; g.emitNoise(c.x, c.y, c.w.noise, 'shot'); }
      }
      // bengalas
      for (let i = this.flares.length - 1; i >= 0; i--) {
        const f = this.flares[i];
        f.t += dt;
        if (f.t >= f.dur) { this.flares.splice(i, 1); continue; }
        const fade = Math.min(1, (f.dur - f.t) / 3);
        g.addFrameLight(f.x, f.y, f.w.light * (0.9 + Math.random() * 0.1) * fade, 0.95 * fade);
        if (Math.random() < dt * 14) g.fx.spark(f.x, f.y, U.randRange(-0.5, 0.5), -1, 1);
        f.noiseT -= dt;
        if (f.noiseT <= 0) { f.noiseT = 3; g.emitNoise(f.x, f.y, f.w.noise, 'flare'); }
      }
      fireLvl = Math.max(fireLvl, g.envFire || 0);
      this.fireLevel = fireLvl;
      if (TM.Audio && TM.Audio.setFire && (fireLvl > 0 || this._fireSent > 0)) { TM.Audio.setFire(fireLvl); this._fireSent = fireLvl; }
    }

    // Capa luminosa en coordenadas de mundo (el HUD la dibuja encima de la oscuridad)
    drawFx(ctx, t) {
      const g = this.game, cam = g.camera;
      // fuego
      for (const f of this.fires) {
        if (!cam.inView(f.x, f.y, f.r + 40)) continue;
        const fade = Math.min(1, (f.dur - f.t) / 1.2, f.t * 6);
        // suelo chamuscado (borde suave)
        ctx.globalCompositeOperation = 'source-over';
        let gr = ctx.createRadialGradient(f.x, f.y, f.r * 0.2, f.x, f.y, f.r * 1.1);
        gr.addColorStop(0, `rgba(18,10,6,${0.45 * fade})`); gr.addColorStop(1, 'rgba(18,10,6,0)');
        ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(f.x, f.y, f.r * 1.1, 0, Math.PI * 2); ctx.fill();
        // resplandor
        ctx.globalCompositeOperation = 'lighter';
        const fl = 0.85 + Math.random() * 0.15;
        gr = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r * 1.35);
        gr.addColorStop(0, `rgba(255,130,40,${0.32 * fade * fl})`); gr.addColorStop(0.6, `rgba(200,70,20,${0.14 * fade})`); gr.addColorStop(1, 'rgba(120,30,10,0)');
        ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(f.x, f.y, f.r * 1.35, 0, Math.PI * 2); ctx.fill();
        // lenguas de fuego (gota apuntando hacia arriba)
        const n = Math.max(6, Math.round(f.r / 4.5));
        for (let i = 0; i < n; i++) {
          const a = f.seed * 7 + i * 2.39996;
          const rr = f.r * 0.9 * Math.sqrt((i + 0.5) / n);
          const fx = f.x + Math.cos(a) * rr, fy = f.y + Math.sin(a) * rr * 0.85;
          const ph = t * (8 + (i % 4)) + i * 1.7;
          const s = (8.5 + Math.sin(ph) * 2.8 + Math.sin(ph * 2.3) * 1.5) * fade * (1.2 - rr / f.r * 0.6);
          if (s <= 0.5) continue;
          const lean = Math.sin(ph * 0.7) * s * 0.25;
          ctx.fillStyle = `rgba(255,${90 + (i % 3) * 25},20,${0.55 * fade})`;
          ctx.beginPath();
          ctx.moveTo(fx - s * 0.7, fy);
          ctx.quadraticCurveTo(fx - s * 0.6, fy - s * 1.3, fx + lean, fy - s * 2.4);
          ctx.quadraticCurveTo(fx + s * 0.6, fy - s * 1.3, fx + s * 0.7, fy);
          ctx.arc(fx, fy, s * 0.7, 0, Math.PI);
          ctx.fill();
          ctx.fillStyle = `rgba(255,225,150,${0.5 * fade})`;
          ctx.beginPath(); ctx.ellipse(fx + lean * 0.3, fy - s * 0.5, s * 0.32, s * 0.75, 0, 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.globalCompositeOperation = 'lighter';
      // zombies ardiendo
      for (const z of this.burning.keys()) {
        if (z.dead || !cam.inView(z.x, z.y, 30)) continue;
        for (let i = 0; i < 3; i++) {
          const ph = t * 9 + i * 2.1;
          const s = 5 + Math.sin(ph) * 1.5;
          ctx.fillStyle = 'rgba(255,140,40,0.55)';
          ctx.beginPath(); ctx.ellipse(z.x + (i - 1) * 4, z.y - 4 - s * 0.6, s * 0.7, s * 1.3, 0, 0, Math.PI * 2); ctx.fill();
        }
      }
      // bengalas
      for (const f of this.flares) {
        if (!cam.inView(f.x, f.y, 40)) continue;
        const fl = 0.8 + Math.random() * 0.2;
        const fade = Math.min(1, (f.dur - f.t) / 3);
        const gr = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, 120);
        gr.addColorStop(0, `rgba(255,40,30,${0.4 * fl * fade})`); gr.addColorStop(1, 'rgba(255,40,30,0)');
        ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(f.x, f.y, 120, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = `rgba(255,60,40,${0.5 * fl})`;
        ctx.beginPath(); ctx.arc(f.x, f.y, 9 * fl, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,220,200,0.9)';
        ctx.beginPath(); ctx.arc(f.x, f.y, 3, 0, Math.PI * 2); ctx.fill();
      }
      // bombas: luz roja parpadeante
      for (const b of this.bombs) {
        const on = (b.t < 0.6 ? Math.floor(t * 20) : Math.floor(t * 6)) % 2 === 0;
        if (on) { ctx.fillStyle = 'rgba(255,60,40,0.9)'; ctx.beginPath(); ctx.arc(b.x, b.y - 3, 3, 0, Math.PI * 2); ctx.fill(); }
      }
      ctx.globalCompositeOperation = 'source-over';
      for (const b of this.bombs) TM.Items.drawIcon(ctx, 'pipebomb', b.x, b.y, 18);
      for (const c of this.crackers) if (c.t < 0) TM.Items.drawIcon(ctx, 'firecracker', c.x, c.y, 14);
      // proyectiles en vuelo
      for (const pr of this.projectiles) {
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath(); ctx.ellipse(pr.x, pr.y + 2, 6, 3, 0, 0, Math.PI * 2); ctx.fill();
        ctx.save(); ctx.translate(pr.x, pr.y - pr.h); ctx.rotate(pr.rot);
        TM.Items.drawIcon(ctx, pr.id, 0, 0, 18);
        ctx.restore();
        if (pr.id === 'molotov') {
          ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = 'rgba(255,150,50,0.8)';
          ctx.beginPath(); ctx.arc(pr.x + Math.cos(pr.rot) * 6, pr.y - pr.h + Math.sin(pr.rot) * 6, 3.5, 0, Math.PI * 2); ctx.fill();
          ctx.globalCompositeOperation = 'source-over';
        }
      }
      // vista previa del lanzamiento
      const p = g.player, inv = this.inv;
      if (p.alive && inv && inv.ready && TM.Input.aim.active) {
        const w = this.weapon;
        const tg = this.throwTarget(w);
        ctx.strokeStyle = 'rgba(240,200,120,0.55)';
        ctx.setLineDash([4, 6]); ctx.lineWidth = 1.5;
        const mx = (p.x + tg.x) / 2, my = (p.y + tg.y) / 2 - U.dist(p.x, p.y, tg.x, tg.y) * 0.25;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.quadraticCurveTo(mx, my, tg.x, tg.y); ctx.stroke();
        ctx.setLineDash([]);
        ctx.strokeStyle = 'rgba(240,160,90,0.6)';
        ctx.beginPath(); ctx.arc(tg.x, tg.y, w.radius || 24, 0, Math.PI * 2); ctx.stroke();
      }
    }
  }

  TM.Combat = Combat;
  TM.WEAPONS = WEAPONS;
})();
