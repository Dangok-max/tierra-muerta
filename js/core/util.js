// Utilidades matemáticas, ruido y aleatoriedad determinista.
const TM = window.TM = window.TM || {};

(function () {
  const U = {};

  U.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  U.lerp = (a, b, t) => a + (b - a) * t;
  U.smoothstep = (a, b, x) => {
    const t = U.clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };
  U.dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
  U.dist2 = (ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay; return dx * dx + dy * dy; };
  U.angleTo = (ax, ay, bx, by) => Math.atan2(by - ay, bx - ax);
  U.angDiff = (a, b) => {
    let d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    else if (d < -Math.PI) d += Math.PI * 2;
    return d;
  };
  U.rand = Math.random;
  U.randRange = (a, b) => a + Math.random() * (b - a);
  U.randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  U.pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  U.chance = (p) => Math.random() < p;

  // Hash entero -> [0,1). Rápido y estable entre sesiones.
  U.hash2 = (ix, iy, seed) => {
    let h = (Math.imul(ix | 0, 374761393) + Math.imul(iy | 0, 668265263) + Math.imul(seed | 0, 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h = h ^ (h >>> 16);
    return (h >>> 0) / 4294967296;
  };

  // Value noise suavizado.
  U.noise2 = (x, y, seed) => {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = U.hash2(ix, iy, seed), b = U.hash2(ix + 1, iy, seed);
    const c = U.hash2(ix, iy + 1, seed), d = U.hash2(ix + 1, iy + 1, seed);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };

  U.fbm = (x, y, seed, oct = 4) => {
    let s = 0, amp = 0.5, f = 1, norm = 0;
    for (let i = 0; i < oct; i++) {
      s += U.noise2(x * f, y * f, seed + i * 101) * amp;
      norm += amp; amp *= 0.5; f *= 2;
    }
    return s / norm;
  };

  // Intersección segmento-círculo: t del primer contacto en [0,1] o -1.
  U.segCircle = (x0, y0, x1, y1, cx, cy, r) => {
    const dx = x1 - x0, dy = y1 - y0;
    const fx = x0 - cx, fy = y0 - cy;
    const a = dx * dx + dy * dy;
    if (a < 1e-9) return fx * fx + fy * fy <= r * r ? 0 : -1;
    const b = 2 * (fx * dx + fy * dy);
    const c = fx * fx + fy * fy - r * r;
    if (c <= 0) return 0;
    let disc = b * b - 4 * a * c;
    if (disc < 0) return -1;
    disc = Math.sqrt(disc);
    const t = (-b - disc) / (2 * a);
    return t >= 0 && t <= 1 ? t : -1;
  };

  // Intersección segmento-AABB (slab). t en [0,1] o -1.
  U.segRect = (x0, y0, x1, y1, rx, ry, rw, rh) => {
    const dx = x1 - x0, dy = y1 - y0;
    let tmin = 0, tmax = 1;
    if (Math.abs(dx) < 1e-9) {
      if (x0 < rx || x0 > rx + rw) return -1;
    } else {
      let t1 = (rx - x0) / dx, t2 = (rx + rw - x0) / dx;
      if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return -1;
    }
    if (Math.abs(dy) < 1e-9) {
      if (y0 < ry || y0 > ry + rh) return -1;
    } else {
      let t1 = (ry - y0) / dy, t2 = (ry + rh - y0) / dy;
      if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return -1;
    }
    return tmin;
  };

  // Generador determinista (mulberry32).
  class RNG {
    constructor(seed) { this.s = (seed >>> 0) || 1; }
    next() {
      let t = (this.s += 0x6D2B79F5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    range(a, b) { return a + this.next() * (b - a); }
    int(a, b) { return a + Math.floor(this.next() * (b - a + 1)); }
    pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
    chance(p) { return this.next() < p; }
  }
  U.RNG = RNG;

  // Color: mezcla dos colores hex "#rrggbb" -> "rgb()".
  U.hexToRgb = (h) => {
    const n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  U.rgb = (r, g, b, a) => (a === undefined
    ? `rgb(${r | 0},${g | 0},${b | 0})`
    : `rgba(${r | 0},${g | 0},${b | 0},${a})`);
  U.shade = (hex, f) => {
    const [r, g, b] = U.hexToRgb(hex);
    return U.rgb(U.clamp(r * f, 0, 255), U.clamp(g * f, 0, 255), U.clamp(b * f, 0, 255));
  };

  U.makeCanvas = (w, h) => {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w));
    c.height = Math.max(1, Math.ceil(h));
    return c;
  };

  TM.U = U;
})();
