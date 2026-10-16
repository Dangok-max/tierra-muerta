# Tierra Muerta — Arquitectura y contratos entre módulos

JavaScript puro, sin herramientas de compilación. Cada archivo es un `<script>` normal
(no módulos ES) que cuelga sus cosas del objeto global `TM`. El orden de carga está en
`index.html`. Coordenadas del mundo: x → derecha, y → abajo. Ángulos en radianes,
`Math.atan2(dy, dx)` (0 = este). `TM.Config.UNITS_PER_M = 10` (escala de juego, solo para mostrar distancias).

## Carpetas

| Carpeta | Dueño | Contenido |
|---|---|---|
| `js/core/` | núcleo | `util.js` (TM.U), `config.js` (TM.Config), `input.js` (TM.Input), `save.js` (TM.Save) |
| `js/world/` | núcleo | `world.js` (TM.World: chunks procedurales, colisión, raycast, biomas) |
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

`CHUNK` (512), `UNITS_PER_M` (10), `DAY_LENGTH` (segundos reales por día de juego, 480),
`quality` ('low'|'med'|'high'), `maxZombies` (según calidad: 35/55/75),
`DEBUG` (bool).

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
- `biomeAt(x, y)` → 'city' | 'forest' | 'desert' | 'road'.
- `dangerAt(x, y)` → peligro por distancia al origen (0 en el campamento, crece sin tope;
  ≈ 1 a 4000 unidades).
- `paintBlood(x, y, size, intensity)` — mancha persistente en el suelo.
- Pre-renderizado: cada chunk se hornea con un generador (`bakeGen`) repartido en varios
  frames: `prefetch(rect)` encola los chunks cercanos y `bakeTick(ms)` avanza con un
  presupuesto de tiempo. Un chunk visible sin terminar se completa con `bake(ch)`.
  Solo se dibujan chunks con `ready = true`.
- El campamento inicial está en (0, 0). Radio seguro: `TM.Config.SAFE_RADIUS` (260).

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

## Director (`game.director`, director.js)

- `new TM.Director(game)`.
- `update(dt)` — aparece/elimina zombies, actualiza TODOS los zombies, separación entre
  ellos, evolución por día y aprendizaje.
- `onNoise(x, y, radius, kind)` — 'shot' | 'shove' | 'scream' | 'footstep' | 'impact'.
- `onPlayerAttack(kind)` — cada disparo/empujón del jugador (para aprender).
- `onKill(zombie, kind)`.
- `stageInfo()` → `{ stage, name }`.
- `serialize()` / `deserialize(data)` — estado de aprendizaje para el guardado.
- `debugText()` → array de strings para el overlay de depuración.

## Orden de un frame (main.js)

1. `TM.Input` lee toques → `player.update(dt)` → `world.collideCircle(player)`.
2. `combat.update(dt)` (disparos, balas, empujón).
3. `director.update(dt)` (zombies).
4. `fx.update(dt)`, cámara, tiempo/clima, audio ambiente.
5. Render: suelo (chunks pre-renderizados con objetos) → manchas → zombies y jugador
   → partículas → oscuridad + luces → `drawGlow` → lluvia/niebla → HUD y controles.
