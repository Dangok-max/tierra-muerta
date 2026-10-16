// Constantes globales y ajustes de calidad.
(function () {
  const C = {
    VERSION: '0.2.0',
    CHUNK: 512,            // chunk de render/colisión (16 m)
    UNITS_PER_M: 32,       // escala real: 32 unidades = 1 metro
    DAY_LENGTH: 480,       // segundos reales por día de juego
    START_HOUR: 7,
    SAFE_RADIUS: 450,      // radio del campamento inicial (~14 m)
    VIEW_HEIGHT: 540,      // unidades de mundo visibles en vertical (~17 m)
    DANGER_DIST: 12000,    // distancia (u) a la que el peligro base vale 1 (~375 m)
    DEBUG: /[?&]debug/.test(location.search),
    quality: 'med',
    maxZombies: 55,
  };

  // Generación del mundo (ajustables)
  C.WORLD = {
    SITE: 12288,           // rejilla de asentamientos principales (384 m)
    FARM: 2560,            // rejilla de granjas y casas sueltas (80 m)
    RARE: 8192,            // rejilla de hallazgos raros (256 m)
    RARE_P: 0.14,          // probabilidad de hallazgo raro por celda
    METRO_P: 0.045,        // probabilidad de candidata a gran ciudad (si está lejos)
    METRO_MIN_DANGER: 2.6, // peligro base mínimo para una gran ciudad (~1 km del origen)
    INDOOR_DARK: 0.5,      // oscuridad extra dentro de edificios (de día)
  };

  // Preajustes de calidad: resolución del canvas, luz, población y caché de chunks.
  C.PRESETS = {
    low:  { dpr: 1.0,  lightScale: 0.25, maxZombies: 35, particles: 120, rainDrops: 60,  chunkCache: 24, roofCache: 20, groundRes: 0.75, roofRes: 0.5,  genBudget: 3.5 },
    med:  { dpr: 1.5,  lightScale: 0.34, maxZombies: 55, particles: 220, rainDrops: 110, chunkCache: 30, roofCache: 24, groundRes: 1,    roofRes: 0.75, genBudget: 3 },
    high: { dpr: 2.0,  lightScale: 0.5,  maxZombies: 75, particles: 350, rainDrops: 170, chunkCache: 36, roofCache: 30, groundRes: 1,    roofRes: 1,    genBudget: 3 },
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
