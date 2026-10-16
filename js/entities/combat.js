// Combate del jugador: pistola (hitscan con trazadoras), recarga y empujón.
(function () {
  const U = TM.U;

  const WEAPONS = {
    pistol: {
      name: 'Pistola', damage: 34, fireDelay: 0.24, magSize: 12, reloadTime: 1.35,
      spread: 0.035, range: 720, noise: 720, crit: 0.14, knock: 70,
    },
  };

  class Combat {
    constructor(game) {
      this.game = game;
      this.weapon = WEAPONS.pistol;
      this.mag = this.weapon.magSize;
      this.cooldown = 0;
      this.reloading = false;
      this.reloadT = 0;
      this.shoveCd = 0;
      this.shotsFired = 0;
      this.shotsHit = 0;
      this._zbuf = [];
    }

    serialize() { return { mag: this.mag }; }
    deserialize(d) { if (d && typeof d.mag === 'number') this.mag = U.clamp(d.mag | 0, 0, this.weapon.magSize); }

    update(dt) {
      const g = this.game, p = g.player, In = TM.Input;
      this.cooldown -= dt;
      this.shoveCd -= dt;
      if (!p.alive) return;

      if (this.reloading) {
        this.reloadT -= dt;
        if (this.reloadT <= 0) {
          this.reloading = false;
          this.mag = this.weapon.magSize;
        }
      }

      if (In.consume('reload') && !this.reloading && this.mag < this.weapon.magSize) this.startReload();
      if (In.consume('shove')) this.shove();
      if (In.consume('light')) {
        p.flashlightOn = !p.flashlightOn;
        if (TM.Audio) TM.Audio.play('flashlight');
      }

      if (In.fire && this.cooldown <= 0 && !this.reloading) {
        if (this.mag > 0) this.fire();
        else {
          if (TM.Audio) TM.Audio.play('empty_click', p.x, p.y);
          this.cooldown = 0.3;
          this.startReload();
        }
      }
    }

    startReload() {
      if (this.reloading) return;
      this.reloading = true;
      this.reloadT = this.weapon.reloadTime;
      const p = this.game.player;
      if (TM.Audio) TM.Audio.play('reload', p.x, p.y);
    }

    // Ayuda de apuntado suave: corrige hacia el zombie más alineado dentro de un cono estrecho.
    assist(angle) {
      const g = this.game, p = g.player;
      let best = null, bestScore = 0.16; // ~9 grados
      for (const z of g.zombies) {
        if (z.dead || z.fakeDead) continue;
        const d = U.dist(p.x, p.y, z.x, z.y);
        if (d > this.weapon.range * 0.85) continue;
        const da = Math.abs(U.angDiff(angle, Math.atan2(z.y - p.y, z.x - p.x)));
        const score = da + d / 6000;
        if (score < bestScore && g.world.lineOfSight(p.x, p.y, z.x, z.y)) { best = z; bestScore = score; }
      }
      if (!best) return angle;
      const ta = Math.atan2(best.y - p.y, best.x - p.x);
      return angle + U.angDiff(angle, ta) * 0.65;
    }

    fire() {
      const g = this.game, p = g.player, w = this.weapon;
      this.cooldown = w.fireDelay;
      this.mag--;
      this.shotsFired++;
      p.recoil = 1;
      p.aimHold = 0.6;

      let ang = this.assist(p.aimAngle);
      const moveSpread = p.moving ? 1.6 : 1;
      ang += U.randRange(-w.spread, w.spread) * moveSpread;
      const dx = Math.cos(ang), dy = Math.sin(ang);
      const mx = p.x + dx * 22, my = p.y + dy * 22;
      const ex = p.x + dx * w.range, ey = p.y + dy * w.range;

      // obstáculo más cercano
      let tWall = g.world.raycast(p.x, p.y, ex, ey);
      // zombie más cercano en la línea
      let hitZ = null, tZ = tWall;
      for (const z of g.zombies) {
        if (z.dead) continue;
        const t = U.segCircle(p.x, p.y, ex, ey, z.x, z.y, z.r + 2);
        if (t >= 0 && t < tZ) { tZ = t; hitZ = z; }
      }
      const tEnd = hitZ ? tZ : tWall;
      const hx = p.x + (ex - p.x) * tEnd, hy = p.y + (ey - p.y) * tEnd;

      g.fx.tracer(mx, my, hx, hy);
      g.fx.muzzle(mx, my, ang);
      g.fx.light(mx, my, 230, 0.9, 0.07);
      g.fx.shell(p.x + dx * 8, p.y + dy * 8, ang);
      g.shake(2.2);
      if (TM.Audio) TM.Audio.play('shot_pistol', p.x, p.y);
      g.emitNoise(p.x, p.y, w.noise, 'shot');
      if (g.director && g.director.onPlayerAttack) g.director.onPlayerAttack('bullet');

      if (hitZ) {
        this.shotsHit++;
        const crit = U.chance(w.crit);
        const dmg = w.damage * (crit ? 2 : 1) * U.randRange(0.9, 1.1);
        const killed = hitZ.takeDamage(dmg, 'bullet', dx, dy);
        if (crit) g.fx.floatText(hitZ.x, hitZ.y - 18, '¡CRÍTICO!', '#e8c070');
        if (killed) g.hitstop(0.035);
        TM.Input.vibrate(12);
      } else if (tWall < 1) {
        g.fx.spark(hx, hy, -dx, -dy, 6);
        g.fx.dust(hx, hy, 3);
        if (TM.Audio) TM.Audio.play('bullet_wall', hx, hy, { volume: 0.6 });
        g.emitNoise(hx, hy, 260, 'impact');
      }

      if (this.mag === 0) this.startReload();
    }

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
  }

  TM.Combat = Combat;
  TM.WEAPONS = WEAPONS;
})();
