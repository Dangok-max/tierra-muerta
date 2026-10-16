// Tierra Muerta — Campo de flujo local alrededor del jugador (Dijkstra con cubetas sobre rejilla).
(function () {
  'use strict';
  const TM = window.TM = window.TM || {};

  const INF = 0xffff;
  const C_ORTH = 2, C_DIAG = 3; // costos enteros (≈ 1 : 1.5)

  class FlowField {
    constructor(cols, rows, cell) {
      this.cols = cols || 80;
      this.rows = rows || 80;
      this.cell = cell || 16;
      this.n = this.cols * this.rows;
      this.dist = new Uint16Array(this.n).fill(INF);
      this.blocked = new Uint8Array(this.n);
      this._empty = new Uint8Array(this.n);
      this.x0 = 0; this.y0 = 0;          // esquina superior izquierda en el mundo
      this.valid = false;
      this.timer = 0;
      this.interval = 0.4;               // recálculo periódico
      this.maxAge = 2.0;                 // recálculo forzado (puertas, cambios del mundo)
      this.moveCells = 4;                // recálculo inmediato si el jugador se aleja tanto
      this.inflate = 6;                  // inflado de obstáculos (u)
      this.pcx = 1e9; this.pcy = 1e9;    // celda global del jugador en el último cálculo
      this.buckets = [[], [], [], []];
      this.lastMs = 0;
      this.computes = 0;
    }

    // Llamar cada frame con la posición del jugador
    update(dt, world, px, py) {
      this.timer += dt;
      const c = this.cell;
      const gcx = Math.floor(px / c), gcy = Math.floor(py / c);
      const moved = Math.max(Math.abs(gcx - this.pcx), Math.abs(gcy - this.pcy));
      if (!this.valid || moved >= this.moveCells ||
          (moved > 0 && this.timer >= this.interval) || this.timer >= this.maxAge) {
        this.compute(world, px, py);
      }
    }

    compute(world, px, py) {
      const t0 = (window.performance && performance.now) ? performance.now() : 0;
      const c = this.cell, cols = this.cols, rows = this.rows;
      const gcx = Math.floor(px / c), gcy = Math.floor(py / c);
      this.x0 = (gcx - (cols >> 1)) * c;
      this.y0 = (gcy - (rows >> 1)) * c;
      this.pcx = gcx; this.pcy = gcy;
      this.timer = 0;

      let blk = null;
      try {
        if (world && typeof world.rasterize === 'function') {
          blk = world.rasterize(this.x0, this.y0, cols, rows, c, this.inflate);
        }
      } catch (e) { blk = null; }
      if (!blk || blk.length < this.n) blk = this._empty;
      this.blocked = blk;

      const dist = this.dist;
      dist.fill(INF);
      let start = (rows >> 1) * cols + (cols >> 1);
      if (blk[start]) {
        start = this._nearestFree(cols >> 1, rows >> 1);
        if (start < 0) { this.valid = false; return; }
      }
      dist[start] = 0;
      const B = this.buckets;
      for (let i = 0; i < 4; i++) B[i].length = 0;
      B[0].push(start);
      let pending = 1, cur = 0;
      while (pending > 0) {
        const b = B[cur & 3];
        while (b.length) {
          const i = b.pop(); pending--;
          if (dist[i] !== cur) continue; // entrada obsoleta
          const x = i % cols, y = (i - x) / cols;
          const fl = x > 0 && !blk[i - 1];
          const fr = x < cols - 1 && !blk[i + 1];
          const fu = y > 0 && !blk[i - cols];
          const fd = y < rows - 1 && !blk[i + cols];
          const n2 = cur + C_ORTH, n3 = cur + C_DIAG;
          let j;
          if (fl && n2 < dist[j = i - 1]) { dist[j] = n2; B[n2 & 3].push(j); pending++; }
          if (fr && n2 < dist[j = i + 1]) { dist[j] = n2; B[n2 & 3].push(j); pending++; }
          if (fu && n2 < dist[j = i - cols]) { dist[j] = n2; B[n2 & 3].push(j); pending++; }
          if (fd && n2 < dist[j = i + cols]) { dist[j] = n2; B[n2 & 3].push(j); pending++; }
          // diagonales sin cortar esquinas
          if (fl && fu && !blk[j = i - cols - 1] && n3 < dist[j]) { dist[j] = n3; B[n3 & 3].push(j); pending++; }
          if (fr && fu && !blk[j = i - cols + 1] && n3 < dist[j]) { dist[j] = n3; B[n3 & 3].push(j); pending++; }
          if (fl && fd && !blk[j = i + cols - 1] && n3 < dist[j]) { dist[j] = n3; B[n3 & 3].push(j); pending++; }
          if (fr && fd && !blk[j = i + cols + 1] && n3 < dist[j]) { dist[j] = n3; B[n3 & 3].push(j); pending++; }
        }
        cur++;
      }
      this.valid = true;
      this.computes++;
      if (t0) this.lastMs = performance.now() - t0;
    }

    _nearestFree(sx, sy) {
      const cols = this.cols, rows = this.rows, blk = this.blocked;
      for (let r = 1; r <= 4; r++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            const x = sx + dx, y = sy + dy;
            if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
            const i = y * cols + x;
            if (!blk[i]) return i;
          }
        }
      }
      return -1;
    }

    inField(x, y) {
      const c = this.cell;
      const cx = Math.floor((x - this.x0) / c), cy = Math.floor((y - this.y0) / c);
      return this.valid && cx >= 0 && cy >= 0 && cx < this.cols && cy < this.rows;
    }

    // Distancia de camino aproximada (unidades) o Infinity
    distAt(x, y) {
      if (!this.valid) return Infinity;
      const c = this.cell;
      const cx = Math.floor((x - this.x0) / c), cy = Math.floor((y - this.y0) / c);
      if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) return Infinity;
      const d = this.dist[cy * this.cols + cx];
      return d === INF ? Infinity : d * c / C_ORTH;
    }

    // Paso de descenso desde la celda i; devuelve índice vecino o -1
    _descend(i) {
      const cols = this.cols, rows = this.rows, dist = this.dist, blk = this.blocked;
      const cx = i % cols, cy = (i - cx) / cols;
      let best = dist[i], bi = -1;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = cy + dy;
        if (ny < 0 || ny >= rows) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = cx + dx;
          if (nx < 0 || nx >= cols) continue;
          const j = ny * cols + nx;
          const d = dist[j];
          if (d >= best) continue;
          if (dx && dy && (blk[cy * cols + nx] || blk[ny * cols + cx])) continue;
          best = d; bi = j;
        }
      }
      return bi;
    }

    // Dirección (unitaria) hacia el jugador siguiendo el gradiente. false si no aplica.
    dirAt(x, y, out) {
      if (!this.valid) return false;
      const c = this.cell, cols = this.cols;
      const cx = Math.floor((x - this.x0) / c), cy = Math.floor((y - this.y0) / c);
      if (cx < 0 || cy < 0 || cx >= cols || cy >= this.rows) return false;
      const i = cy * cols + cx;
      if (this.dist[i] === 0) return false; // ya está en la celda del jugador
      const a = this._descend(i);
      if (a < 0) return false;
      // dos pasos de anticipación para suavizar
      let tgt = a;
      if (this.dist[a] > 0) {
        const b2 = this._descend(a);
        if (b2 >= 0) tgt = b2;
      }
      const tx = this.x0 + ((tgt % cols) + 0.5) * c;
      const ty = this.y0 + (Math.floor(tgt / cols) + 0.5) * c;
      const dx = tx - x, dy = ty - y;
      const L = Math.sqrt(dx * dx + dy * dy);
      if (L < 0.001) return false;
      out.x = dx / L; out.y = dy / L;
      return true;
    }
  }

  FlowField.INF = INF;
  TM.FlowField = FlowField;
})();
