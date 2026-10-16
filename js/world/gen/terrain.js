// Paisaje: biomas grandes con transiciones suaves, ríos, lagos, pantanos, barrancos y zonas quemadas. TM.WG.Terrain
(function () {
  const U = TM.U;
  const WG = TM.WG = TM.WG || {};
  const ss = U.smoothstep;

  // Escalas (unidades de mundo)
  const S_MOIST = 36000, S_HEAT = 50000, S_FARM = 26000;
  const S_RIVER = 52000, S_LAKE = 28000, S_POOL = 3200, S_RAV = 40000, S_BURN = 14000;
  const LIP = 2.7; // pendiente máxima aproximada del fbm (por unidad de ruido)

  const BIOMES = ['forest', 'plains', 'farmland', 'desert', 'swamp'];

  class Terrain {
    constructor(seed) {
      this.seed = seed | 0;
      this.s = (k) => (this.seed + k * 977) | 0;
    }

    // Protección del campamento: sin agua ni barrancos cerca del origen
    originMask(x, y) { return ss(1800, 4200, Math.hypot(x, y)); }

    // Pesos de biomas naturales (suman 1)
    weights(x, y, out) {
      out = out || {};
      const m = U.fbm(x / S_MOIST + 13.1, y / S_MOIST - 7.7, this.s(1), 3);
      const h = U.fbm(x / S_HEAT - 3.3, y / S_HEAT + 21.9, this.s(2), 3);
      const f = U.fbm(x / S_FARM + 5.5, y / S_FARM + 9.1, this.s(3), 2);
      const dry = Math.max(1 - ss(0.33, 0.41, m), ss(0.63, 0.71, h));
      const wet = ss(0.50, 0.58, m);
      const swamp = ss(0.61, 0.69, m) * ss(0.42, 0.5, h) * (1 - dry);
      const forest = wet * (1 - swamp) * (1 - dry);
      const mid = (1 - dry) * (1 - wet);
      const farm = mid * ss(0.44, 0.54, f);
      const plains = mid * (1 - ss(0.44, 0.54, f));
      const desert = dry;
      const sum = forest + plains + farm + desert + swamp || 1;
      out.forest = forest / sum; out.plains = plains / sum; out.farmland = farm / sum;
      out.desert = desert / sum; out.swamp = swamp / sum;
      return out;
    }

    dominant(x, y) {
      const w = this.weights(x, y, this._w || (this._w = {}));
      let best = 'plains', bv = -1;
      for (const b of BIOMES) if (w[b] > bv) { bv = w[b]; best = b; }
      return best;
    }

    burn(x, y) {
      const n = U.fbm(x / S_BURN + 1.7, y / S_BURN - 4.4, this.s(9), 3);
      return ss(0.69, 0.76, n) * this.originMask(x, y);
    }

    // Lago seco (solo en zonas áridas): 0..1
    dryLake(x, y) {
      const L = U.fbm(x / S_LAKE + 2.2, y / S_LAKE + 8.8, this.s(5), 3);
      if (L > 0.33) return 0;
      const w = this.weights(x, y, this._w2 || (this._w2 = {}));
      return ss(0.33, 0.29, L) * ss(0.4, 0.7, w.desert);
    }

    // Distancia firmada aproximada a la orilla de un río (negativa = dentro). Infinity si no hay río.
    _riverField(x, y, margin) {
      const wx = (U.fbm(x / 20000, y / 20000, this.s(11), 2) - 0.5) * 0.6;
      const wy = (U.fbm(x / 20000 + 40, y / 20000 - 40, this.s(12), 2) - 0.5) * 0.6;
      const nx = x / S_RIVER + wx, ny = y / S_RIVER + wy;
      const n = U.fbm(nx, ny, this.s(10), 3);
      const v = Math.abs(n - 0.5);
      const mask = ss(0.38, 0.5, U.noise2(x / 60000 + 3, y / 60000 - 9, this.s(13))) * this.originMask(x, y);
      if (mask <= 0) return Infinity;
      const half = (160 + 260 * U.noise2(x / 9000, y / 9000, this.s(14))) * mask;
      // descarte rápido con la pendiente máxima
      if (v * S_RIVER / LIP > half + (margin || 200)) return Infinity;
      const e = 24;
      const nx2 = U.fbm(nx + e / S_RIVER, ny, this.s(10), 3), ny2 = U.fbm(nx, ny + e / S_RIVER, this.s(10), 3);
      const g = Math.hypot(nx2 - n, ny2 - n) / e || 1e-6;
      return v / g - half;
    }

    _lakeField(x, y) {
      const L = U.fbm(x / S_LAKE + 2.2, y / S_LAKE + 8.8, this.s(5), 3);
      const th = 0.25 * this.originMask(x, y);
      const w = this.weights(x, y, this._w3 || (this._w3 = {}));
      const t = th * (1 - w.desert); // en el desierto los lagos están secos
      return (L - t) * S_LAKE / LIP; // distancia aproximada (negativa = agua)
    }

    _poolField(x, y) {
      const w = this.weights(x, y, this._w4 || (this._w4 = {}));
      if (w.swamp < 0.35) return Infinity;
      const n = U.fbm(x / S_POOL + 7, y / S_POOL - 3, this.s(15), 2);
      return (n - 0.36 * ss(0.35, 0.8, w.swamp) * this.originMask(x, y)) * S_POOL / LIP;
    }

    _ravineField(x, y) {
      const mask = ss(0.62, 0.72, U.noise2(x / 50000 - 11, y / 50000 + 5, this.s(17))) * this.originMask(x, y);
      if (mask <= 0) return Infinity;
      const n = U.fbm(x / S_RAV - 20, y / S_RAV + 30, this.s(16), 3);
      const v = Math.abs(n - 0.5);
      const half = (90 + 120 * U.noise2(x / 7000, y / 7000, this.s(18))) * mask;
      return v * S_RAV / LIP * 0.8 - half;
    }

    // Tipo de terreno: 0 suelo, 1 agua (orilla), 2 agua profunda, 3 barranco
    kindAt(x, y) {
      const r = this._riverField(x, y);
      const l = this._lakeField(x, y);
      const p = this._poolField(x, y);
      const d = Math.min(r, l, p);
      if (d < 0) return d < -40 ? 2 : 1;
      if (this._ravineField(x, y) < 0) return 3;
      return 0;
    }

    // ¿Puede haber agua o barranco en este rectángulo? (descarte barato)
    mayHaveWater(x0, y0, x1, y1) {
      const step = 128;
      for (let y = y0; y <= y1 + 1; y += step) {
        for (let x = x0; x <= x1 + 1; x += step) {
          if (this._riverField(x, y) < 140) return true;
          if (this._lakeField(x, y) < 140) return true;
          const p = this._poolField(x, y); if (p < 200) return true;
          if (this._ravineField(x, y) < 140) return true;
        }
      }
      return false;
    }

    // Versión gruesa para áreas grandes (asentamientos): muestras cada 1024 u
    mayHaveWaterCoarse(x0, y0, x1, y1) {
      const step = 1024, m = step * 0.75 + 160;
      for (let y = y0; y <= y1 + step; y += step) {
        for (let x = x0; x <= x1 + step; x += step) {
          if (this._riverField(x, y, m + 100) < m) return true;
          if (this._lakeField(x, y) < m) return true;
          if (this._poolField(x, y) < m + 200) return true;
          if (this._ravineField(x, y) < m) return true;
        }
      }
      return false;
    }

    blocked(x, y) { return this.kindAt(x, y) !== 0; }
  }

  Terrain.BIOMES = BIOMES;
  WG.Terrain = Terrain;
})();
