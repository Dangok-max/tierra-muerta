// Service worker: red primero (siempre la última versión con internet) y caché como respaldo sin conexión.
// Al instalarse guarda todo el juego, así funciona sin conexión desde la primera visita.
const CACHE = 'tierra-muerta-v4';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/style.css',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
  'js/core/util.js', 'js/core/config.js', 'js/core/input.js', 'js/core/save.js',
  'js/audio/audio.js',
  'js/world/gen/geom.js', 'js/world/gen/textures.js', 'js/world/gen/terrain.js', 'js/world/gen/macro.js',
  'js/world/gen/buildings.js', 'js/world/gen/plan.js', 'js/world/gen/settlements.js', 'js/world/gen/places.js',
  'js/world/gen/landscape.js', 'js/world/render/draw.js', 'js/world/world.js',
  'js/render/fx.js', 'js/render/lighting.js', 'js/render/renderer.js',
  'css/inventory.css',
  'js/items/items.js', 'js/items/loot.js', 'js/items/inventory.js', 'js/items/crafting.js', 'js/items/interact.js',
  'js/ui/inventory.js',
  'js/entities/player.js', 'js/entities/combat.js',
  'js/ai/evolution.js', 'js/ai/flowfield.js', 'js/entities/zombie.js', 'js/ai/director.js',
  'js/ui/hud.js', 'js/ui/menus.js', 'js/main.js',
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .catch(() => {})
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    // 'no-cache' revalida con el servidor para no quedarse con versiones viejas del juego
    fetch(req, { cache: 'no-cache' })
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('index.html')))
  );
});
