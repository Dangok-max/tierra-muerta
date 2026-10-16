// Menús en DOM: título, ajustes, pausa, fin de partida y confirmación.
(function () {
  const $ = (id) => document.getElementById(id);
  const SCREENS = ['loading', 'title', 'settings', 'pause', 'gameover', 'confirm'];

  const Menus = {
    current: null,
    settingsReturn: 'title',

    show(id) {
      for (const s of SCREENS) $(s).classList.toggle('show', s === id);
      this.current = id;
      TM.Input.enabled = !id;
      if (id) TM.Input.reset();
    },
    hide() { this.show(null); },

    init(game) {
      this.game = game;
      $('ver').textContent = TM.Config.VERSION;
      try { const n = localStorage.getItem('tm_name'); if (n) $('nameInput').value = n; } catch (e) { /* ignorar */ }

      const click = (id, fn) => $(id).addEventListener('click', (e) => {
        e.preventDefault();
        if (TM.Audio) { TM.Audio.init(); TM.Audio.play('ui_click'); }
        fn();
      });

      click('btnContinue', () => { const d = TM.Save.load(); if (d) game.loadGame(d); });
      click('btnNew', () => {
        const start = () => game.newGame(this.playerName());
        if (TM.Save.has()) this.confirm('¿Empezar una partida nueva? Se perderá la partida guardada.', start, 'title');
        else start();
      });
      click('btnImport', () => $('fileInput').click());
      $('fileInput').addEventListener('change', (e) => {
        const f = e.target.files && e.target.files[0];
        if (!f) return;
        TM.Save.importFile(f, (err, d) => {
          e.target.value = '';
          if (err) { this.alert(err.message); return; }
          game.loadGame(d);
        });
      });
      click('btnSettings', () => this.openSettings('title'));
      click('btnSettingsBack', () => this.show(this.settingsReturn));
      click('btnResume', () => game.resume());
      click('btnMute', () => { this.setSound(TM.Audio.muted); this.refreshSettings(); });
      click('btnPauseSettings', () => this.openSettings('pause'));
      click('btnExport', () => { game.saveNow(); const d = TM.Save.load(); if (d) TM.Save.exportFile(d); });
      click('btnQuit', () => { game.saveNow(); game.toMenu(); });
      click('btnRetry', () => game.newGame(this.playerName()));
      click('btnGoMenu', () => game.toMenu());
      click('btnConfirmNo', () => this.show(this._confirmBack));
      click('btnConfirmYes', () => { const fn = this._confirmFn; this._confirmFn = null; if (fn) fn(); });

      // ajustes
      const seg = (id, fn) => {
        $(id).addEventListener('click', (e) => {
          const b = e.target.closest('button'); if (!b) return;
          if (TM.Audio) { TM.Audio.init(); TM.Audio.play('ui_click'); }
          fn(b.dataset.v); this.refreshSettings();
        });
      };
      seg('segQuality', (v) => game.setQuality(v));
      seg('segSound', (v) => this.setSound(v === 'on'));
      seg('segVibe', (v) => {
        TM.Input.vibration = v === 'on';
        try { localStorage.setItem('tm_vibration', v === 'on' ? '1' : '0'); } catch (e) { /* ignorar */ }
        if (v === 'on') TM.Input.vibrate(30);
      });
      this.refreshSettings();
    },

    playerName() {
      let n = ($('nameInput').value || '').trim().replace(/[<>]/g, '');
      if (!n) n = 'Superviviente';
      try { localStorage.setItem('tm_name', n); } catch (e) { /* ignorar */ }
      return n;
    },

    setSound(on) { if (TM.Audio && TM.Audio.setMuted) TM.Audio.setMuted(!on); },

    openSettings(back) { this.settingsReturn = back; this.refreshSettings(); this.show('settings'); },

    refreshSettings() {
      const mark = (id, v) => { for (const b of $(id).querySelectorAll('button')) b.classList.toggle('on', b.dataset.v === v); };
      mark('segQuality', TM.Config.quality);
      const muted = TM.Audio && TM.Audio.muted;
      mark('segSound', muted ? 'off' : 'on');
      mark('segVibe', TM.Input.vibration ? 'on' : 'off');
      $('btnMute').textContent = muted ? 'Activar sonido' : 'Silencio';
    },

    confirm(text, fn, back) {
      $('confirmText').textContent = text;
      $('btnConfirmYes').classList.remove('hidden');
      $('btnConfirmNo').textContent = 'Cancelar';
      this._confirmFn = fn; this._confirmBack = back;
      this.show('confirm');
    },
    alert(text) {
      $('confirmText').textContent = text;
      $('btnConfirmYes').classList.add('hidden');
      $('btnConfirmNo').textContent = 'Aceptar';
      this._confirmBack = this.current;
      this.show('confirm');
    },

    showTitle() {
      const d = TM.Save.load();
      $('continueBox').classList.toggle('hidden', !d);
      if (d) $('continueInfo').textContent = `${d.player.name} · Día ${d.day} · ${d.kills || 0} zombies eliminados`;
      const r = TM.Save.records();
      $('records').textContent = r.days ? `Récord: ${r.days} días · ${r.kills} zombies · ${r.distance} km explorados` : '';
      this.show('title');
    },

    showPause(game) {
      const p = game.player;
      $('pauseStats').textContent = `${p.name} · Día ${game.day} · ${game.totalKills()} zombies eliminados`;
      this.refreshSettings();
      this.show('pause');
    },

    showGameOver(game, rec) {
      const k = game.stats.kills;
      const names = { normal: 'Caminantes', acechador: 'Acechadores', griton: 'Gritones', tanque: 'Tanques' };
      let byType = '';
      for (const t in k) if (k[t]) byType += `<br>&nbsp;&nbsp;${names[t] || t}: <b>${k[t]}</b>`;
      const km = (game.player.maxDist / TM.Config.UNITS_PER_M / 1000).toFixed(2);
      $('goStats').innerHTML =
        `<b>${escapeHtml(game.player.name)}</b> sobrevivió <b>${game.day}</b> día(s).<br>` +
        `Zombies eliminados: <b>${game.totalKills()}</b>${byType}<br>` +
        `Distancia máxima: <b>${km} km</b><br>` +
        learned(game) +
        `<span style="color:#8c8274">Récords: ${rec.days} días · ${rec.kills} zombies · ${rec.distance} km</span>`;
      this.show('gameover');
    },
  };

  // Lo que los muertos aprendieron del jugador (refuerza el gancho principal)
  function learned(game) {
    const d = game.director;
    const list = d && d.learnedSummary ? d.learnedSummary() : [];
    if (!list || !list.length) return '';
    return '<div style="margin-top:6px;color:#c08070">Los muertos aprendieron de ti:</div>' +
      list.slice(0, 4).map((t) => `<div style="color:#a89c8c">· ${escapeHtml(t)}</div>`).join('');
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  TM.Menus = Menus;
})();
