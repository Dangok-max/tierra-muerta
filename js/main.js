// Juego: arranque, bucle principal, tiempo, día/noche, clima y guardado.
(function () {
  const U = TM.U;
  const C = TM.Config;

  // Director mínimo por si el módulo de IA no cargó (evita que el juego se rompa).
  class NullDirector {
    update() {} onNoise() {} onPlayerAttack() {} onKill() {}
    stageInfo() { return { stage: 1, name: '' }; }
    serialize() { return null; } deserialize() {} debugText() { return []; }
  }

  class Game {
    constructor() {
      this.canvas = document.getElementById('game');
      this.camera = new TM.Camera();
      this.renderer = new TM.Renderer(this.canvas);
      this.state = 'loading';
      this.zombies = [];
      this.frameLights = [];
      this.time = 0;
      this.day = 1; this.hour = C.START_HOUR; this.isNight = false; this.darkness = 0;
      this.weather = { rain: 0, fog: 0.2, targetRain: 0, targetFog: 0.2, next: 90 };
      this.shakeAmt = 0;
      this.hitstopT = 0;
      this.bakeBudget = 99;
      this.saveT = 0;
      this.perf = { acc: 0, n: 0, lowT: 0, highT: 0, work: 0, workN: 0 };
      this.perfInfo = { fps: 60, work: 0 };
      this.lastTs = 0;
      this.hud = new TM.HUD(this);
      this.stats = { kills: {} };
      this.runId = 0;
      this.deathT = -1;
    }

    // setTimeout que solo se ejecuta si sigue siendo la misma partida
    later(ms, fn) {
      const id = this.runId;
      setTimeout(() => { if (this.runId === id) fn(); }, ms);
    }

    boot() {
      try {
        const q = localStorage.getItem('tm_quality');
        C.setQuality(q || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4 ? 'low' : 'med'));
      } catch (e) { C.setQuality('med'); }
      TM.Input.init(this.canvas);
      TM.Input.detectTouch();
      TM.Input.getPlayerScreen = () => (this.player ? this.worldToScreen(this.player.x, this.player.y) : { x: 0, y: 0 });
      this.renderer.resize(this.camera);
      window.addEventListener('resize', () => {
        this.renderer.resize(this.camera);
        // en vertical se pausa (aparece el aviso de girar el teléfono)
        if (TM.Input.usingTouch && window.innerHeight > window.innerWidth && this.state === 'play') this.pause();
      });
      document.addEventListener('visibilitychange', () => {
        if (document.hidden && this.state === 'play') { this.saveNow(); this.pause(); }
      });
      window.addEventListener('pagehide', () => { if (this.state === 'play' || this.state === 'pause') this.saveNow(); });
      TM.Menus.init(this);
      // genera texturas tras pintar la pantalla de carga
      setTimeout(() => {
        TM.World.initTextures();
        // mundo de fondo para el menú
        this.setupWorld(1234, 'Superviviente');
        this.player.alive = true;
        this.state = 'menu';
        TM.Menus.showTitle();
        requestAnimationFrame((ts) => this.loop(ts));
      }, 30);
      if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
        navigator.serviceWorker.register('sw.js').catch(() => {});
      }
    }

    setupWorld(seed, name) {
      this.runId++;
      this.deathT = -1;
      this.seed = seed;
      this.world = new TM.World(seed);
      this.player = new TM.Player(name);
      this.combat = new TM.Combat(this);
      this.fx = new TM.FX(this);
      this.zombies = [];
      this.stats = { kills: { normal: 0, acechador: 0, griton: 0, tanque: 0 } };
      this.time = 0;
      this.updateClock();
      this.director = TM.Director ? new TM.Director(this) : new NullDirector();
      this.camera.snap(this.player);
      this.hud.notes.length = 0;
    }

    newGame(name) {
      this.enterFullscreen();
      TM.Save.clear();
      this.setupWorld((Math.random() * 1e9) | 0, name);
      this.weather = { rain: 0, fog: 0.25, targetRain: 0, targetFog: 0.25, next: 120 };
      this.state = 'play';
      TM.Menus.hide();
      this.saveNow();
      this.later(600, () => this.notify('Sobrevive. Los muertos aprenden de ti.', '#d8c8a8'));
      this.later(3400, () => this.notify('Junto al fuego del campamento te curas.', '#c0a070'));
      if (TM.Input.usingTouch) {
        this.hud.showTutorial(9);
        this.later(6800, () => this.notify('Pulgar derecho: apunta. Empuja hasta el borde para disparar.', '#b0a890'));
      }
    }

    loadGame(d) {
      this.enterFullscreen();
      this.setupWorld(d.seed, d.player.name);
      this.time = d.time;
      const p = this.player;
      p.x = d.player.x; p.y = d.player.y;
      p.hp = U.clamp(Number.isFinite(d.player.hp) ? d.player.hp : p.maxHp, 1, p.maxHp);
      p.stamina = Number.isFinite(d.player.stamina) ? d.player.stamina : 100;
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) { p.x = 0; p.y = 60; }
      if (!Number.isFinite(this.time) || this.time < 0) this.time = 0;
      p.maxDist = d.player.maxDist || 0;
      p.flashlightOn = d.player.flashlightOn !== false;
      if (d.stats && d.stats.kills) Object.assign(this.stats.kills, d.stats.kills);
      if (d.weather) Object.assign(this.weather, d.weather);
      this.combat.deserialize(d.combat);
      if (d.director && this.director.deserialize) this.director.deserialize(d.director);
      // Fase 2: estado del mundo, inventario y necesidades (las partidas v1 no los tienen)
      if (d.world && this.world.deserialize) this.world.deserialize(d.world);
      if (d.inventory && p.inventory && p.inventory.deserialize) p.inventory.deserialize(d.inventory);
      if (d.needs) {
        if (Number.isFinite(d.needs.hunger)) p.hunger = U.clamp(d.needs.hunger, 0, 100);
        if (Number.isFinite(d.needs.thirst)) p.thirst = U.clamp(d.needs.thirst, 0, 100);
      }
      if (d.skills && p.skills) { p.skills.deserialize(d.skills); p.maxStamina = p.skills.maxStamina(); }
      // el mapa puede haber cambiado entre versiones: no aparecer dentro de una pared
      if (this.world.findFree && !this.world.isFree(p.x, p.y, p.r + 1)) {
        const f = this.world.findFree(p.x, p.y, p.r + 1, 600);
        p.x = f.x; p.y = f.y;
      }
      this.updateClock();
      this.camera.snap(p);
      this.state = 'play';
      TM.Menus.hide();
      this.notify(`Día ${this.day}. Sigues con vida, ${p.name}.`, '#d8c8a8');
    }

    serialize() {
      const p = this.player;
      return {
        game: 'tierra-muerta', v: 2, savedAt: Date.now(),
        seed: this.seed, time: this.time, day: this.day, kills: this.totalKills(),
        player: { name: p.name, x: p.x, y: p.y, hp: p.hp, stamina: p.stamina, maxDist: p.maxDist, flashlightOn: p.flashlightOn },
        stats: this.stats,
        weather: { rain: this.weather.rain, fog: this.weather.fog, targetRain: this.weather.targetRain, targetFog: this.weather.targetFog, next: this.weather.next },
        combat: this.combat.serialize(),
        director: this.director.serialize ? this.director.serialize() : null,
        world: this.world.serialize ? this.world.serialize() : null,
        inventory: p.inventory && p.inventory.serialize ? p.inventory.serialize() : null,
        needs: { hunger: p.hunger, thirst: p.thirst },
        skills: p.skills ? p.skills.serialize() : null,   // v2+: habilidades (opcional; partidas antiguas sin él)
      };
    }

    saveNow() {
      if (!this.player || !this.player.alive || this.state === 'menu' || this.state === 'loading') return;
      TM.Save.write(this.serialize());
      this.saveT = 0;
    }

    pause() {
      if (this.state !== 'play') return;
      this.state = 'pause';
      TM.Menus.showPause(this);
    }
    resume() {
      this.state = 'play';
      TM.Menus.hide();
      this.lastTs = 0;
      // si murió justo antes de pausar, la cuenta atrás de la pantalla de muerte sigue en update()
      if (!this.player.alive && this.deathT < 0) this.deathT = 0.5;
    }
    toMenu() {
      this.state = 'menu';
      this.setupWorld(1234, 'Superviviente');
      TM.Menus.showTitle();
    }

    enterFullscreen() {
      if (!TM.Input.usingTouch) return;
      const el = document.documentElement;
      try {
        const r = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : null;
        const lock = () => { try { screen.orientation.lock('landscape').catch(() => {}); } catch (e) { /* ignorar */ } };
        if (r && r.then) r.then(lock).catch(() => {}); else lock();
      } catch (e) { /* ignorar */ }
    }

    setQuality(q) {
      C.setQuality(q);
      try { localStorage.setItem('tm_quality', q); } catch (e) { /* ignorar */ }
      this.renderer.dynScale = 1;
      this.renderer.resize(this.camera);
      if (this.world) this.world.rebakeAll();
    }

    // ---------- API para otros módulos ----------
    notify(text, color) { this.hud.notify(text, color); }
    shake(a) { this.shakeAmt = Math.min(14, Math.max(this.shakeAmt, a)); }
    hitstop(s) { this.hitstopT = Math.max(this.hitstopT, Math.min(0.06, s)); }
    emitNoise(x, y, radius, kind) { if (this.director && this.director.onNoise) this.director.onNoise(x, y, radius, kind); }
    addFrameLight(x, y, radius, intensity) { this.frameLights.push({ x, y, radius, intensity }); }
    totalKills() { let n = 0; for (const k in this.stats.kills) n += this.stats.kills[k]; return n; }
    worldToScreen(x, y) {
      const c = this.camera;
      return { x: (x - (c.x - c.viewW / 2)) * c.zoom, y: (y - (c.y - c.viewH / 2)) * c.zoom };
    }

    onZombieKilled(z, kind) {
      this.stats.kills[z.type] = (this.stats.kills[z.type] || 0) + 1;
      if (this.director && this.director.onKill) this.director.onKill(z, kind);
    }

    onPlayerDeath(kind) {
      this.deathCause = kind || 'zombie';
      this.notify('Has caído…', '#c03020');
      TM.Save.clear();
      const rec = TM.Save.updateRecords({
        days: this.day, kills: this.totalKills(),
        distance: +(this.player.maxDist / C.UNITS_PER_M / 1000).toFixed(2),
      });
      this.deathRecords = rec;
      this.deathT = 2.6; // la pantalla de muerte se muestra desde update(), no con un temporizador suelto
    }

    // ---------- Tiempo y clima ----------
    updateClock() {
      const totalH = C.START_HOUR + (this.time / C.DAY_LENGTH) * 24;
      // el día cambia al amanecer (06:00), no a medianoche
      const newDay = 1 + Math.floor((totalH - 6) / 24);
      this.hour = totalH % 24;
      if (this.state === 'play' && newDay !== this.day && newDay > 1) {
        this.notify(`Amanece el DÍA ${newDay}`, '#e0c890');
        this.saveNow();
      }
      this.day = newDay;
      const h = this.hour;
      let dark;
      if (h >= 21 || h < 4.5) dark = 1;
      else if (h >= 17.5) dark = U.smoothstep(17.5, 21, h);
      else if (h < 7) dark = 1 - U.smoothstep(4.5, 7, h);
      else dark = 0;
      const wasNight = this.isNight;
      this.darkness = dark;
      this.isNight = dark > 0.6;
      if (this.state === 'play' && this.isNight && !wasNight && this.time > 5) this.notify('Cae la noche. Ellos ven mejor que tú.', '#9aa8d0');
    }

    updateWeather(dt) {
      const w = this.weather;
      w.next -= dt;
      if (w.next <= 0) {
        w.next = U.randRange(70, 160);
        const r = Math.random();
        w.targetRain = r < 0.62 ? 0 : r < 0.86 ? U.randRange(0.25, 0.55) : U.randRange(0.65, 1);
        w.targetFog = U.chance(0.35) ? U.randRange(0.4, 0.85) : U.randRange(0.05, 0.3);
      }
      w.rain += (w.targetRain - w.rain) * Math.min(1, dt * 0.08);
      w.fog += (w.targetFog - w.fog) * Math.min(1, dt * 0.06);
      if (w.rain > 0.6 && Math.random() < dt * 0.025) {
        this.renderer.lighting.lightning = 1;
        this.later(U.randRange(300, 1500), () => { if (TM.Audio) TM.Audio.play('thunder'); });
      }
    }

    // ---------- Bucle ----------
    loop(ts) {
      requestAnimationFrame((t) => this.loop(t));
      let dt = this.lastTs ? (ts - this.lastTs) / 1000 : 1 / 60;
      this.lastTs = ts;
      if (dt > 0.25) dt = 0.25; // vuelta de segundo plano
      this.trackPerf(dt);
      dt = Math.min(dt, 1 / 30);

      const w0 = performance.now();
      try {
        if (this.state === 'play') this.update(dt);
        else if (this.state === 'menu') this.updateMenu(dt);
        else if (this.state === 'dead') this.updateDead(dt);
        if (this.state !== 'play' && TM.Audio && TM.Audio.setAmbience) {
          // fuera de la partida: ambiente tranquilo, sin tensión ni latido
          TM.Audio.setAmbience({ night: this.state === 'menu' ? 0.8 : this.darkness, rain: this.weather.rain, danger: 0.15, combat: 0, health: 1 });
        }
        this.renderer.render(this, this.state === 'pause' ? 0 : dt);
      } catch (err) {
        console.error(err);
        if (!this._errShown) { this._errShown = true; this.notify('Error: ' + (err && err.message), '#f66'); }
      }
      this.perf.work += performance.now() - w0; this.perf.workN++;
    }

    trackPerf(dt) {
      const p = this.perf;
      if (this.state !== 'play') return;
      p.acc += dt; p.n++;
      if (p.acc < 1) return;
      const fps = p.n / p.acc;
      p.acc = 0; p.n = 0;
      const r = this.renderer;
      const work = p.work / Math.max(1, p.workN);
      p.work = 0; p.workN = 0;
      this.perfInfo = { fps, work };
      // bajar resolución solo si el trabajo real es alto (no por un rAF limitado por el sistema)
      const slow = fps < 38 && (work > 14 || fps < 24);
      if (slow) { p.lowT++; p.highT = 0; } else if (fps > 55 && work < 9) { p.highT++; p.lowT = 0; } else { p.lowT = 0; p.highT = 0; }
      if (p.lowT >= 4 && r.dynScale > 0.7) { r.dynScale = Math.max(0.7, r.dynScale - 0.1); r.resize(this.camera); p.lowT = 0; }
      // si ya se bajó la resolución y la CPU sigue saturada, menos zombis a la vez
      else if (p.lowT >= 4 && work > 14 && C.maxZombies > 25) { C.maxZombies -= 5; p.lowT = 0; }
      if (p.highT >= 12 && r.dynScale < 1) { r.dynScale = Math.min(1, r.dynScale + 0.1); r.resize(this.camera); p.highT = 0; }
    }

    update(dt) {
      TM.Input.update();
      if (TM.Input.consume('pause')) { this.saveNow(); this.pause(); return; }

      if (this.hitstopT > 0) { this.hitstopT -= dt; dt *= 0.15; }
      this.time += dt;
      this.updateClock();
      this.updateWeather(dt);

      const p = this.player;
      if (!p.alive && this.deathT >= 0) {
        this.deathT -= dt;
        if (this.deathT < 0) {
          this.state = 'dead';
          TM.Menus.showGameOver(this, this.deathRecords || TM.Save.records());
          return;
        }
      }
      p.update(dt, this);
      this.combat.update(dt);
      this.director.update(dt);
      this.fx.update(dt);
      this.camera.update(dt, p, this.shakeAmt);
      this.shakeAmt = Math.max(0, this.shakeAmt - dt * 30);

      if (TM.Audio && TM.Audio.setListener) {
        TM.Audio.setListener(p.x, p.y);
        let near = 0;
        for (const z of this.zombies) if (!z.dead && U.dist2(z.x, z.y, p.x, p.y) < 350 * 350) near++;
        TM.Audio.setAmbience({
          night: this.darkness, rain: this.weather.rain,
          danger: U.clamp(this.world.dangerAt(p.x, p.y), 0, 1), combat: U.clamp(near / 6, 0, 1),
          health: p.hp / p.maxHp,
          indoor: this.world.buildingAt && this.world.buildingAt(p.x, p.y) ? 1 : 0,
        });
      }

      this.world.prune(p.x, p.y);
      this.bakeBudget = 99;
      this.saveT += dt;
      if (this.saveT > 20) this.saveNow();
    }

    // Menú: el mundo de fondo se mueve lentamente
    updateMenu(dt) {
      this.time += dt * 0.5;
      this.hour = 22; this.darkness = 0.85; this.isNight = true;
      const p = this.player;
      p.x += dt * 22; p.y += Math.sin(this.time * 0.1) * dt * 10;
      p.aimAngle = Math.sin(this.time * 0.4) * 0.6;
      p.flashlightOn = true;
      this.camera.update(dt, { x: p.x, y: p.y, vx: 0, vy: 0, aiming: false, aimHold: 0, aimAngle: 0 }, 0);
      this.fx.update(dt);
      this.bakeBudget = 99;
    }

    updateDead(dt) {
      this.time += dt * 0.3;
      this.fx.update(dt);
      this.director.update(dt * 0.5);
      this.camera.update(dt, this.player, 0);
    }
  }

  TM.Game = Game;
  window.addEventListener('load', () => {
    TM.game = new Game();
    TM.game.boot();
  });
})();
