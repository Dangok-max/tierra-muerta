// Jugador: movimiento, estamina, vida, animación y dibujo.
(function () {
  const U = TM.U;

  const WALK_SPEED = 150;
  const SPRINT_SPEED = 208;
  const STAMINA_DRAIN = 24;
  const STAMINA_REGEN = 20;

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
      this.noise = 0;
      this.lastDamageTime = -999;
      this.hurtFlash = 0;
      this.walkPhase = 0;
      this.stepAcc = 0;
      this.recoil = 0;
      this.shoveAnim = 0;
      this.deathTime = 0;
      this.maxDist = 0;
    }

    update(dt, game) {
      const In = TM.Input;
      if (!this.alive) {
        this.vx *= 0.9; this.vy *= 0.9;
        return;
      }
      // --- Movimiento ---
      const mv = In.move;
      const wantsSprint = mv.sprint && mv.mag > 0.5 && this.stamina > 2 && !game.combat.reloading;
      this.sprinting = wantsSprint && (this.sprinting || this.stamina > 15);
      let speed = (this.sprinting ? SPRINT_SPEED : WALK_SPEED) * mv.mag;
      if (In.aim.active && !this.sprinting) speed *= 0.86;
      if (game.combat.reloading) speed *= 0.9;
      // herido grave: más lento
      if (this.hp < 25) speed *= 0.9;
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

      // --- Estamina ---
      if (this.sprinting && this.moving) {
        this.stamina = Math.max(0, this.stamina - STAMINA_DRAIN * dt);
        this.staminaDelay = 0.7;
        if (this.stamina <= 0) this.sprinting = false;
      } else if (this.staminaDelay > 0) this.staminaDelay -= dt;
      else this.stamina = Math.min(this.maxStamina, this.stamina + STAMINA_REGEN * dt);

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
      this.noise = this.sprinting ? 1 : this.moving ? 0.35 * mv.mag : 0;
      if (this.moving) {
        this.walkPhase += sp * dt * 0.09;
        this.stepAcc += sp * dt;
        const stepLen = this.sprinting ? 52 : 44;
        if (this.stepAcc > stepLen) {
          this.stepAcc = 0;
          if (TM.Audio) TM.Audio.play('footstep', this.x, this.y, { volume: this.sprinting ? 0.5 : 0.28 });
          if (this.sprinting) game.emitNoise(this.x, this.y, 220, 'footstep');
        }
      }

      // --- Regeneración ---
      const sinceHit = game.time - this.lastDamageTime;
      const inCamp = Math.hypot(this.x, this.y) < TM.Config.SAFE_RADIUS;
      if (inCamp && sinceHit > 4) this.hp = Math.min(this.maxHp, this.hp + 4 * dt);
      else if (sinceHit > 9 && this.hp < this.maxHp * 0.6) this.hp = Math.min(this.maxHp * 0.6, this.hp + 1.5 * dt);

      this.hurtFlash = Math.max(0, this.hurtFlash - dt * 4);
      this.recoil = Math.max(0, this.recoil - dt * 10);
      this.shoveAnim = Math.max(0, this.shoveAnim - dt * 4);
      this.maxDist = Math.max(this.maxDist, Math.hypot(this.x, this.y));
    }

    damage(amount, fromX, fromY, kind) {
      if (!this.alive || amount <= 0) return 0;
      const g = TM.game;
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
      if (this.hp <= 0) {
        this.hp = 0;
        this.alive = false;
        this.deathTime = g.time;
        if (TM.Audio) TM.Audio.play('player_death', this.x, this.y);
        g.world.paintBlood(this.x, this.y, 16, 0.85);
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
      // mochila
      ctx.fillStyle = '#3d3326';
      ctx.fillRect(-13, -7, 7, 14);
      ctx.fillStyle = '#2f281e'; ctx.fillRect(-13, -7, 2, 14);
      // torso (chaqueta)
      const flash = this.hurtFlash;
      ctx.fillStyle = flash > 0.5 ? '#8a3b30' : '#55613f';
      ctx.beginPath(); ctx.ellipse(-1, 0, 8, 12, 0, 0, Math.PI * 2); ctx.fill();
      // contorno oscuro para leerse contra el suelo
      ctx.strokeStyle = 'rgba(8,8,6,0.75)'; ctx.lineWidth = 1.4; ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.beginPath(); ctx.ellipse(1, -3, 5, 7, 0, 0, Math.PI * 2); ctx.fill();
      // brazos sosteniendo la pistola
      const rec = this.recoil * 4;
      const sh = this.shoveAnim;
      ctx.fillStyle = '#3d4632';
      ctx.beginPath(); ctx.ellipse(6 - rec + sh * 8, -6, 8, 3.2, 0.25, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(6 - rec + sh * 8, 6, 8, 3.2, -0.25, 0, Math.PI * 2); ctx.fill();
      // manos
      ctx.fillStyle = '#b88a6a';
      ctx.beginPath(); ctx.arc(13 - rec + sh * 8, -1.5, 2.8, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(13 - rec + sh * 8, 2, 2.8, 0, Math.PI * 2); ctx.fill();
      // pistola
      ctx.fillStyle = '#151618';
      ctx.fillRect(14 - rec + sh * 8, -1.6, 10, 3.2);
      // cabeza
      ctx.fillStyle = '#c4946f';
      ctx.beginPath(); ctx.arc(1, 0, 6.2, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(8,8,6,0.7)'; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.fillStyle = '#2a2018';
      ctx.beginPath(); ctx.arc(-0.5, 0, 6.2, Math.PI * 0.55, Math.PI * 1.45); ctx.fill();
      ctx.beginPath(); ctx.ellipse(-1.2, 0, 4.6, 5.6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  TM.Player = Player;
})();
