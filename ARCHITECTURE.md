# Tierra Muerta — Arquitectura y contratos entre módulos

JavaScript puro, sin herramientas de compilación. Cada archivo es un `<script>` normal
(no módulos ES) que cuelga sus cosas del objeto global `TM`. El orden de carga está en
`index.html`. Coordenadas del mundo: x → derecha, y → abajo. Ángulos en radianes,
`Math.atan2(dy, dx)` (0 = este). Escala real: `TM.Config.UNITS_PER_M = 32` (32 unidades = 1 m).

## Carpetas

| Carpeta | Dueño | Contenido |
|---|---|---|
| `js/core/` | núcleo | `util.js` (TM.U), `config.js` (TM.Config), `input.js` (TM.Input), `save.js` (TM.Save) |
| `js/world/` | mundo | `world.js` (TM.World: chunks, colisión, raycast, puertas, cofres, techos, horneado), `gen/*.js` (TM.WG: geometría, texturas, paisaje, sitios, planes de asentamientos, interiores, lugares especiales, naturaleza), `render/draw.js` (TM.WG.Draw) |
| `js/entities/` | núcleo + IA | `player.js` (núcleo), `combat.js` (núcleo), `zombie.js` (IA) |
| `js/ai/` | IA | `flowfield.js`, `evolution.js`, `director.js` |
| `js/audio/` | audio | `audio.js` (TM.Audio, sonido 100 % sintetizado) |
| `js/render/` | núcleo | `renderer.js`, `fx.js`, `lighting.js` |
| `js/ui/` | núcleo | `hud.js`, `menus.js` |
| `js/main.js` | núcleo | TM.Game: bucle principal, tiempo, día/noche, clima |

## TM.U (util.js)

`clamp(v,a,b)`, `lerp(a,b,t)`, `smoothstep(a,b,x)`, `dist(ax,ay,bx,by)`, `dist2(...)`,
`angleTo(ax,ay,bx,by)`, `angDiff(a,b)` (diferencia firmada más corta, −π..π),
`rand()`, `randRange(a,b)`, `randInt(a,b)` (inclusivo), `pick(arr)`, `chance(p)`,
`hash2(ix,iy,seed)` → [0,1), `noise2(x,y,seed)` → [0,1) (value noise suave),
`fbm(x,y,seed,octaves)` → [0,1), `segCircle(x0,y0,x1,y1,cx,cy,r)` → t∈[0,1] del primer
impacto o −1, `new TM.U.RNG(seed)` con `.next()`, `.range(a,b)`, `.int(a,b)`,
`.pick(arr)`, `.chance(p)`.

## TM.Config (config.js)

`CHUNK` (512 u = 16 m), `UNITS_PER_M` (32), `DAY_LENGTH` (segundos reales por día de juego, 480),
`SAFE_RADIUS` (450, campamento), `VIEW_HEIGHT` (420 u ≈ 13 m visibles en vertical), `DANGER_DIST` (12000: peligro
base 1 a ~375 m), `quality` ('low'|'med'|'high'), `maxZombies` (según calidad: 35/55/75), `DEBUG` (bool).
`WORLD` = parámetros de generación (`SITE`, `FARM`, `RARE`, `RARE_P`, `METRO_P`, `METRO_MIN_DANGER`, `INDOOR_DARK`).
`PRESETS[q]` = `{ dpr, lightScale, maxZombies, particles, rainDrops, chunkCache, roofCache, groundRes, roofRes, genBudget }`
(`genBudget` = ms por frame para generar/hornear; `groundRes`/`roofRes` = píxeles por unidad de los lienzos de chunk).

## TM.game (instancia de TM.Game, main.js)

Campos de lectura:

- `time` — segundos de juego acumulados en la partida.
- `day` — día actual (entero, empieza en 1). `hour` — 0..24. `isNight` — bool.
- `darkness` — 0 (pleno día) .. 1 (noche cerrada).
- `weather` — `{ rain: 0..1, fog: 0..1 }`.
- `player`, `world`, `camera`, `director`, `fx`, `zombies` (array), `stats`.
- `stats.kills` — `{ normal, acechador, griton, tanque, ... }` (contadores por tipo).

Métodos:

- `notify(text, color?)` — aviso grande en pantalla (p. ej. aprendizaje de los zombies).
- `shake(amount)` — sacudida de cámara (≈ 2..12).
- `hitstop(seconds)` — micro-pausa de impacto (≤ 0.06).
- `emitNoise(x, y, radius, kind)` — reenvía a `director.onNoise`.
- `onZombieKilled(zombie, kind)` — el zombie lo llama al morir (estadísticas, sonido, director.onKill).
- `addFrameLight(x, y, radius, intensity)` — luz dinámica solo para este frame.

## Jugador (`game.player`, player.js)

Campos: `x, y, r (11), vx, vy, hp, maxHp, alive, aimAngle` (hacia donde apunta la
linterna/arma), `aiming` (bool: el jugador está apuntando activamente), `flashlightOn`,
`sprinting`, `noise` (0..1, ruido que hace al moverse), `lastDamageTime` (game.time),
`name`.

Métodos: `damage(amount, fromX, fromY, kind)` → daño real aplicado;
`push(dx, dy, speed)` — empujón (dx, dy normalizados).

## Mundo (`game.world`, world.js)

- `collideCircle(ent)` — `ent` tiene `x, y, r`; lo saca de los obstáculos. Devuelve bool.
- `raycast(x0,y0,x1,y1)` → t∈[0,1] del primer obstáculo (1 = libre).
- `lineOfSight(x0,y0,x1,y1)` → bool (solo obstáculos con `blocksSight`).
- `isFree(x, y, r)` → bool.
- `queryObstacles(x0,y0,x1,y1, out)` → llena `out` con obstáculos:
  `{ shape:'rect', x, y, w, h, blocksSight, kind }` (x,y = esquina superior izquierda) o
  `{ shape:'circle', cx, cy, r, blocksSight, kind }`.
- `rasterize(x0, y0, cols, rows, cell, inflate)` → `Uint8Array(cols*rows)`, 1 = bloqueado
  (obstáculos inflados `inflate` unidades). Para el flow field.
- `biomeAt(x, y)` → 'forest' | 'plains' | 'farmland' | 'desert' | 'swamp' | 'city' | 'road' | 'water'.
- `dangerAt(x, y)` → `distancia / DANGER_DIST` (0 en el campamento, ≈ 1 a 375 m) + extra por asentamiento
  (aldea +0,1, pueblo +0,3, ciudad +0,7, gran ciudad +1,6, base/cárcel/aeródromo +0,6, con caída suave en el borde).
- `paintBlood(x, y, size, intensity)` — mancha persistente en el suelo.
- Pre-renderizado: cada chunk se hornea con un generador (`bakeGen`) repartido en varios
  frames: `prefetch(rect)` encola los chunks cercanos y `bakeTick(ms)` avanza con un
  presupuesto de tiempo. Un chunk visible sin terminar se completa con `bake(ch)`.
  Solo se dibujan chunks con `ready = true`.
- El campamento inicial está en (0, 0) con su fogata. Radio seguro: `TM.Config.SAFE_RADIUS` (450).

## Cámara (`game.camera`)

`x, y` (centro en el mundo), `zoom`, `viewW, viewH` (tamaño visible en unidades),
`inView(x, y, margin)` → bool.

## Efectos (`game.fx`, fx.js)

`blood(x,y,dx,dy,n)`, `dust(x,y,n)`, `spark(x,y,dx,dy,n)`, `acid(x,y,n)`,
`ring(x,y,radius,color,duration)` (onda expansiva, p. ej. grito),
`floatText(x,y,text,color)`, `light(x,y,radius,intensity,duration)` (destello temporal),
`tracer`, `muzzle`, `shell`, `swipe` (efectos del arma).

## Iluminación (lighting.js)

Capa de oscuridad a baja resolución. La luz del jugador (ambiente + linterna) se dibuja en
un canvas aparte y se le recortan sombras de los obstáculos con `blocksSight` (extrusión de
bordes desde la luz); luego se resta de la oscuridad. La niebla va debajo de la oscuridad;
la lluvia y los relámpagos, encima.

## Audio (`TM.Audio`, audio.js)

- `TM.Audio.init()` — se llama en el primer toque del usuario.
- `TM.Audio.setMuted(bool)`, `TM.Audio.muted`.
- `TM.Audio.setListener(x, y)` — posición del jugador cada frame.
- `TM.Audio.play(name, x?, y?, opts?)` — sin x,y = sonido de interfaz (no posicional).
  `opts = { volume, pitch }`.
- `TM.Audio.setAmbience({ night, rain, danger, combat, health })` — todos 0..1, cada frame.
- Nombres de sonidos: `shot_pistol, reload, empty_click, shove, hit_flesh, bullet_wall,
  zombie_groan, zombie_attack, zombie_death, stalker_hiss, scream, tank_roar, tank_stomp,
  tank_charge, player_hurt, player_death, footstep, ui_click, ui_notify, flashlight,
  thunder, heartbeat`.
- Nombres desconocidos se ignoran en silencio.

## Zombies (contrato que cumple `js/entities/zombie.js`)

Cada zombie en `game.zombies` tiene:

- Campos: `x, y, r, type` ('normal'|'acechador'|'griton'|'tanque'), `hp, maxHp`,
  `dead` (bool), `fakeDead` (bool, fingiendo estar muerto), `vx, vy`.
- `takeDamage(amount, kind, dirX, dirY)` — `kind`: 'bullet'|'melee'|'fire'|'vehicle'|'explosion'.
  Devuelve true si murió. Al morir llama `TM.game.onZombieKilled(this, kind)`.
- `shove(dirX, dirY, force)` — empujón del jugador (tambaleo).
- `draw(ctx, t)` — dibuja en coordenadas de mundo (la cámara ya está aplicada).
- `drawGlow(ctx, t)` — opcional; se dibuja DESPUÉS de la capa de oscuridad (ojos brillantes).
- `alerted` (bool) — false mientras no ha detectado al jugador (lo vio, lo golpearon, un grito o un compañero lo
  avisaron). Oír un ruido NO lo alerta: solo va a investigar. `combat.js` usa `!z.alerted && !z.fakeDead` para el
  golpe de sigilo (cuchillo ×3). Sin alerta solo ve en un cono frontal de ~100° de semiángulo (por detrás nota al
  jugador a ≤ 40 u); las paredes, puertas cerradas y muebles altos tapan la vista (`world.lineOfSight`).
- `state` — además de los de la Fase 1, `'dormant'`: quieto/adormilado (aparecidos dentro de edificios); ve ×0,55 y
  solo oye ruidos dentro del 60 % de su radio; al oír algo pasa a `'investigate'`, al ver al jugador lo persigue.
- `indoor` (apareció en un interior), `bId` (id del edificio en el que está, cacheado ~1 s), `bashDoor` (puerta cerrada
  que está golpeando o null).

## Director (`game.director`, director.js)

- `new TM.Director(game)`.
- `update(dt)` — aparece/elimina zombies, actualiza TODOS los zombies, separación entre
  ellos, evolución por día y aprendizaje.
- `onNoise(x, y, radius, kind)` — 'shot' | 'shove' | 'scream' | 'footstep' | 'impact' | 'melee' | 'door' |
  'door_bash' | 'chest' | 'chest_alarm' | 'explosion' | 'glass' | 'flare'. El radio se multiplica por el oído del
  zombie y por 0,6 si el ruido y el zombie no están en el mismo edificio (dentro↔fuera). Quien lo oye va a investigar
  el punto (con prisa si está cerca de un ruido fuerte); los que ya persiguen al jugador no se distraen, salvo con
  una bengala ('flare'). 'shot', 'scream', 'impact', 'explosion' y 'chest_alarm' activan emboscadas cercanas.
- `onPlayerAttack(kind)` — cada disparo/empujón del jugador (para aprender).
- `onKill(zombie, kind)`.
- `stageInfo()` → `{ stage, name }`.
- `serialize()` / `deserialize(data)` — estado de aprendizaje para el guardado.
- `debugText()` → array de strings para el overlay de depuración.

### IA y mundo v2 (zombie.js, director.js, flowfield.js, evolution.js)
- Escala: caminante ≈ 1,25 m/s (40 u/s; 46 desde la etapa 2, tope 64), corredor ≈ 4,4 m/s, acechador 3,4–4,8 m/s,
  tanque ≈ 1,25–1,55 m/s; de noche corredores y acechadores +15 %, el resto +8 %. Visión: ~19 m de día (600 u),
  ~6 m de noche cerrada (190; acechador 330), con la linterna encendida ~12 m y ~24 m si les apunta; dentro de
  edificios cuenta como oscuridad ≥ `WORLD.INDOOR_DARK`. Pasos: 50 + 230·`player.noise` u (la mitad a través de muros).
- Flow field: celdas 0 libre, 1 bloqueada, 2 puerta cerrada (coste extra ≈ 6 m de rodeo; sin diagonales por puertas).
  Hay un segundo campo para los grandes (r ≥ 16: tanque) con obstáculos inflados 16 u y `minDoor = 44`: las puertas
  (abiertas, cerradas o rotas) más estrechas que eso se bloquean, salvo las dobles. `flow.doorAt(x, y)`.
- Puertas: un zombie que va hacia un objetivo (chase/investigate/stalk/keepaway/cover), frenado y pegado a una puerta
  cerrada en la dirección en que avanza, se para y la golpea cada 0,9–1,4 s: `world.damageDoor(id, daño)` (tanque ×3,2),
  sonido 'door_bash' (o 'door_break' en el golpe que la rompe) y `game.emitNoise(cx, cy, 400, 'door_bash')`. No golpea
  al jugador a través de paredes ni puertas cerradas (`world.raycast`). El tanque no intenta entrar por puertas
  sencillas: si no tiene camino, espera junto al muro y lo aporrea (o la puerta pegada); su embestida contra una puerta
  cerrada la revienta.
- Interiores: el director recorre cada 1,3 s las pistas `world.spawnHints` de chunks ya generados (lee `world.chunks` y
  `world.key` para no forzar generación síncrona) en un radio de ~media pantalla + 13 m. Cada pista de interior se tira
  una vez (se olvida cuando el jugador se aleja > 1900 u): nunca a la vista, a < 260 u, en el radio seguro ni con línea
  de visión si el jugador está en ese edificio. Hospital, comisaría, militar y búnker: más probabilidad, más zombies y
  más peligro (+0,6). "INFECTADOS DENTRO": un grupo de 3–12 según la superficie, repartido por las habitaciones. Sin
  tanques en edificios pequeños. Aparecen `'dormant'`; como mucho el 45 % de `maxZombies` y cuentan un 60 % para la
  población objetivo de exterior. Los de exterior ya no aparecen dentro de edificios.
- Dibujo: el renderer no mete en la lista de dibujo (cuerpo ni `drawGlow`) a los zombies con `world.roofCovers(x, y)`.
- `takeDamage(…, 'fire')`: sin sangre ni empuje; destello y 'hit_flesh' suave como mucho cada 0,8 s.
  'explosion': empuje fuerte (260; el tanque ×0,12) y deja de golpear puertas.
- Caché de sprites: tope 12/16/24 MB (low/med/high); al llenarse expulsa los menos usados (LRU) hasta el 80 %.
  `TM.Zombie.spriteLimitMB` (> 0) fuerza un tope para pruebas; `TM.Zombie.spriteStats()` incluye `evicted`.

## Orden de un frame (main.js)

1. `TM.Input` lee toques → `player.update(dt)` → `world.collideCircle(player)`.
2. `combat.update(dt)` (disparos, balas, empujón).
3. `director.update(dt)` (zombies).
4. `fx.update(dt)`, cámara, tiempo/clima, audio ambiente.
5. Render: suelo (chunks pre-renderizados con objetos e interiores) → fuego → puertas, cofres abiertos y objetos
   del suelo (`world.drawDynamic`) → partículas → zombies (los que están bajo un techo opaco no se dibujan) y jugador
   → techos (`world.drawRoofs`) → oscuridad + luces (interior más oscuro) → `drawGlow` → lluvia/niebla → HUD.

---

# FASE 2 — Contratos nuevos (mundo v2, objetos, interiores)

## Escala y cámara
- Escala real: **32 unidades = 1 metro** (`TM.Config.UNITS_PER_M = 32`). El jugador (r = 11) mide ~0,7 m.
  Puerta 1–1,2 m, auto 4,5 × 1,9 m, casa pequeña 8 × 10 m, supermercado 30 × 40 m, hospital/fábrica 50 × 80 m o más,
  calles 7–10 m, copa de árbol 4–8 m.
- `TM.Config.VIEW_HEIGHT` ≈ 420 (se ajusta probando en el celular).

## Mundo v2 (`js/world/`, dueño: constructor del mundo)
Se mantiene TODO el API de la Fase 1 (collideCircle, raycast, lineOfSight, isFree, findFree, queryObstacles,
rasterize, biomeAt, dangerAt, paintBlood, prepareView, prefetch, bakeTick, prune, rebakeAll, getChunk con
`ch.x0, ch.y0, ch.canvas, ch.ready, ch.dyn`). Los muros interiores y las puertas cerradas son obstáculos normales
(`blocksSight: true`). Añade:

- `world.buildingAt(x, y)` → `null` o el objeto edificio `{ id, type, sub, x, y, w, h, indoor: true, danger, roofAlpha,
  front ('n'|'s'|'e'|'w': fachada a la calle), ruined, burned, sign, infected, barricaded, det }`.
  `type` ∈ 'house' | 'pharmacy' | 'hospital' | 'supermarket' | 'gas' | 'hardware' | 'police' | 'school' |
  'garage' | 'warehouse' | 'factory' | 'church' | 'farmhouse' | 'barn' | 'bunker' | 'military' | 'other'.
  `sub` afina el tipo: house/'shed'|'cabin'|'shack'|'hideout', other/'apartments'|'office'|'store'|'bar'|'lab'|'tower',
  police/'prison', military/'barracks', warehouse/'hangar'. `det` (perezoso) tiene `rooms` (`{x,y,w,h,role}`), `doors`,
  `chests`, `walls`, `windows`, `furn`, `hints`. Mientras se genera el detalle, `det` es null.
- `world.placeAt(x, y)` → `{ biome, settlement: 'none'|'farm'|'village'|'town'|'city'|'metro', district, poi }`.
  `district` ∈ null | 'centro' | 'residencial' | 'industrial' | 'periferia'. `poi`: tipo del edificio en el punto,
  o 'military'|'prison'|'airfield'|'industrial' (recintos especiales), 'farm'|'ranch'|'cabin'|'shack' (granjas),
  'bunker'|'crash'|'convoy'|'hideout'|'lab'|'pileup'|'laststand' (hallazgos raros), 'campamento'.
- Puertas: `world.doorsNear(x, y, r)` → objetos puerta `{ id, x, y, w, h` (rectángulo, esquina sup. izq.)`, cx, cy`
  (centro)`, open, broken, hp, maxHp, buildingId, mat ('wood'|'glass'|'metal'|'garage'|'bars'), ext` (da a la calle)`,
  locked, barricade, horiz }`. `world.setDoor(id, open)` → bool (false si está rota, o si se intenta abrir una puerta
  `locked`/atrancada: hay que romperla). `world.damageDoor(id, dmg)` → true solo en el golpe que la rompe.
  Puerta cerrada = obstáculo (las de cristal y rejas no tapan la vista); abierta o rota = pasable.
  El jugador abre una puerta cerrada (no atrancada) al empujarla caminando (`collideCircle`); hace ruido 'door'.
  En `rasterize`, las celdas de puerta cerrada valen **2** (pasable con coste para la IA).
- Cofres: `world.chestsNear(x, y, r)` → `[{ id, x, y` (centro)`, rarity: 'common'|'rare'|'legendary', container,
  trapped, noisy, opened, buildingType, danger, buildingId, loose }]`; `world.markChestOpened(id)`.
  `container` en español: armario, cómoda, mesita de noche, nevera, alacena, botiquín, vitrina de medicinas, archivador,
  caja fuerte, caja registradora, estantería, taquilla, armero, caja de herramientas, escritorio, caja, cofre militar,
  maletero, contenedor, contenedor de basura, mochila, maleta, cabina, caja médica, alijo enterrado.
  Los maleteros de autos normales llevan `buildingType: 'other'` (tabla de autos); los de patrullas, ambulancias y
  vehículos militares, 'police' | 'hospital' | 'military'. Los ids son estables entre sesiones (misma semilla).
- Objetos en el suelo: `world.addGroundItem(x, y, stack)` → id ('g1', 'g2'...; guarda una copia de la pila completa);
  `world.removeGroundItem(id)`; `world.groundItemsNear(x, y, r)` → `[{ id, x, y, stack }]`. Los dibuja el mundo con
  `TM.Items.drawGround(ctx, stack, x, y, t)` (si no existe, un cuadrado de color).
- Pistas de aparición: `world.spawnHints(x0, y0, x1, y1)` → `[{ x, y, indoor, buildingType, danger, buildingId?,
  infected? }]` (centros de habitaciones, plazas, cruces, colas de autos, controles; `infected` = edificio con el cartel
  "INFECTADOS DENTRO", buen sitio para meter muchos zombies dentro).
- Estado persistente: `world.serialize()` → `{ v: 2, doors: [[id, open, broken, hp]], chests: [ids abiertos],
  ground: [{ id, x, y, stack }], nextG }`; `world.deserialize(data)` (llamarlo antes de generar la zona).
- Fuego dinámico y luces: `ch.dyn` como antes (`{ kind: 'fire', x, y, small? }`: campamento, accidentes de avión...).
- Techos: se dibujan ENCIMA de las entidades. `world.updateRoofs(dt, px, py)` desvanece el techo de la estructura donde
  está el jugador (edificio o marquesina); `world.drawRoofs(ctx, cam, curId, visibles)` los pinta;
  `world.curB` = estructura actual; `world.roofCovers(x, y)` → true si (x, y) está bajo un techo opaco (el renderer no
  dibuja ahí zombies ni sus ojos); `world.indoorShade()` → rectángulo del interior actual y su peso (lighting lo oscurece).
- `raycast` ignora el agua y los barrancos (las balas pasan por encima; obstáculos con `over: true`); `collideCircle`,
  `isFree` y `rasterize` sí los cuentan. `rasterize` muestrea el centro de cada celda.
- Obstáculos nuevos (`kind`): 'wall', 'window' (sólida, no tapa la vista), 'door', 'furn' (mueble; `f` = tipo),
  'water', 'ravine', 'fence', 'car' (si el auto está girado son 3 círculos), 'tree', 'rock', 'container', etc.
- Generación (TM.WG): `Terrain` (biomas, ríos, lagos, pantanos, barrancos, zonas quemadas) → `Macro` (rejilla de sitios de
  512 m: aldea/pueblo/ciudad/gran ciudad/recinto especial, carreteras entre sitios, granjas cada 128 m, hallazgos raros
  cada 256 m) → planes (`Settle.plan`, `Places.planFarm/planRare/planSpecial/planEdge/planCamp`: calles, lotes,
  edificios, accesorios, cofres) → chunks (`popGen`: detalle de edificios, agua, naturaleza) → horneado (`bakeGen`).
  Todo son generadores repartidos por tiempo (`WG.over()`, ~1 ms por paso) y deterministas por semilla.

## Objetos (`js/items/`, dueño: constructor de objetos)
- `TM.Items.DB[id]` = `{ id, name, cat, weight, stack, icon, ... }`; `cat` ∈ 'weapon' | 'ammo' | 'food' | 'drink' |
  'med' | 'material' | 'tool' | 'blueprint' | 'seed' | 'part' | 'fuel' | 'throwable'.
- Pila: `{ id, qty, dur? }` (dur = durabilidad 0..1 para armas cuerpo a cuerpo y herramientas).
- `TM.Loot.roll(chest, rng)` → array de pilas según `buildingType`, `rarity`, `danger`.
- `TM.Inventory` (en `player.inventory`): `add(stack)` → sobrante, `remove(id, qty)`, `count(id)`, `weight()`,
  `maxWeight`, `slots`, `quick` (accesos rápidos), `serialize()/deserialize()`.
- Armas: `TM.WEAPONS[id]` con `{ kind: 'gun'|'melee'|'throw', ammo, damage, dmgType, fireDelay, magSize, reloadTime,
  spread, pellets, range, noise, durLoss }`. `combat.js` usa el arma equipada.
- Necesidades: `player.hunger`, `player.thirst` (0..100, 100 = saciado); a 0 se pierde vida.
- Interacción: botón **USAR** (táctil) / tecla E: abre/cierra la puerta más cercana, abre el cofre más cercano,
  recoge el objeto más cercano. Botón **MOCHILA** (táctil) / tecla I / Tab: inventario y fabricación.

## Ruidos nuevos (`game.emitNoise(x, y, radius, kind)`)
`'door'` (abrir/cerrar ~180), `'door_bash'` (zombie golpeando ~400), `'chest'` (~150), `'chest_alarm'` (~900),
`'explosion'` (~1200), `'glass'` (~350).

## Audio nuevo (Fase 2)
Sonidos: shot_shotgun, shot_rifle, shot_smg, melee_swing, melee_hit, door_open, door_close, door_bash, door_break,
chest_open, chest_alarm, trap_trigger, pickup, eat, drink, bandage, craft, inv_open, explosion, glass_break,
molotov_throw, fire_burn, weapon_break, hunger_stomach.
`TM.Audio.setFire(0..1)` — bucle de fuego cercano. `setAmbience({ ..., indoor: 0..1 })` — amortigua exterior y añade sala.

## Daño nuevo a zombies
`takeDamage(amount, kind, dirX, dirY)` con `kind` ∈ 'bullet' | 'melee' | 'fire' | 'explosion'.
`fire` = molotov (quemadura en el tiempo), `explosion` = gasolinera o molotov.
