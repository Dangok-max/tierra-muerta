// Constantes globales y ajustes de calidad.
(function () {
  const C = {
    VERSION: '0.1.0',
    CHUNK: 512,
    UNITS_PER_M: 10,      // escala de juego (solo para mostrar distancias)
    DAY_LENGTH: 480,       // segundos reales por día de juego
    START_HOUR: 7,
    SAFE_RADIUS: 260,
    VIEW_HEIGHT: 360,      // unidades de mundo visibles en vertical
    DEBUG: /[?&]debug/.test(location.search),
    quality: 'med',
    maxZombies: 55,
  };

  // Preajustes de calidad: resolución del canvas, luz y población.
  C.PRESETS = {
    low:  { dpr: 1.0,  lightScale: 0.25, maxZombies: 35, particles: 120, rainDrops: 60,  chunkCache: 16 },
    med:  { dpr: 1.5,  lightScale: 0.34, maxZombies: 55, particles: 220, rainDrops: 110, chunkCache: 22 },
    high: { dpr: 2.0,  lightScale: 0.5,  maxZombies: 75, particles: 350, rainDrops: 170, chunkCache: 28 },
  };

  C.setQuality = function (q) {
    if (!C.PRESETS[q]) q = 'med';
    C.quality = q;
    const p = C.PRESETS[q];
    C.preset = p;
    C.maxZombies = p.maxZombies;
  };
  C.setQuality('med');

  TM.Config = C;
})();
