// Guardado automático en el celular (localStorage) y exportar/importar a archivo.
(function () {
  const KEY = 'tm_save_v1';
  const REC = 'tm_records_v1';

  const Save = {
    has() {
      try { return !!localStorage.getItem(KEY); } catch (e) { return false; }
    },
    load() {
      try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return null;
        const d = JSON.parse(raw);
        return Save.valid(d) ? d : null;
      } catch (e) { return null; }
    },
    write(data) {
      try { localStorage.setItem(KEY, JSON.stringify(data)); return true; } catch (e) { return false; }
    },
    clear() {
      try { localStorage.removeItem(KEY); } catch (e) { /* ignorar */ }
    },
    valid(d) {
      return d && typeof d === 'object' && d.game === 'tierra-muerta' && typeof d.seed === 'number' &&
        d.player && Number.isFinite(d.player.x) && Number.isFinite(d.player.y) && Number.isFinite(d.time) &&
        (d.player.hp === undefined || Number.isFinite(d.player.hp));
    },

    exportFile(data) {
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const day = data.day || 1;
      a.href = url;
      a.download = `tierra-muerta-dia-${day}.json`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
    },

    importFile(file, cb) {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const d = JSON.parse(reader.result);
          if (!Save.valid(d)) return cb(new Error('El archivo no es una partida válida de Tierra Muerta.'));
          Save.write(d);
          cb(null, d);
        } catch (e) { cb(new Error('No se pudo leer el archivo.')); }
      };
      reader.onerror = () => cb(new Error('No se pudo leer el archivo.'));
      reader.readAsText(file);
    },

    records() {
      try { return JSON.parse(localStorage.getItem(REC)) || {}; } catch (e) { return {}; }
    },
    updateRecords(r) {
      const old = Save.records();
      const out = {
        days: Math.max(old.days || 0, r.days || 0),
        kills: Math.max(old.kills || 0, r.kills || 0),
        distance: Math.max(old.distance || 0, r.distance || 0),
      };
      try { localStorage.setItem(REC, JSON.stringify(out)); } catch (e) { /* ignorar */ }
      return out;
    },
  };

  TM.Save = Save;
})();
