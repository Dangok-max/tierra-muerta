# Tierra Muerta

Juego 2D de supervivencia zombie con vista desde arriba, para jugar en el navegador del celular (Chrome Android) en horizontal. Mundo infinito, sin final.

**Jugar:** https://dangok-max.github.io/tierra-muerta/

En Chrome Android: menú ⋮ → **Agregar a la pantalla principal** para instalarlo como app (funciona sin conexión después de la primera carga).

## Controles

| Celular | Acción |
|---|---|
| Pulgar izquierdo (cualquier punto de la mitad izquierda) | Moverse. Al fondo del joystick, corres (gasta estamina). |
| Pulgar derecho (mitad derecha) | Apuntar. Si lo empujas más allá del anillo rojo, disparas. |
| Botón de flecha | Empujar a los zombies cercanos |
| Botón circular | Recargar |
| Botón de linterna | Encender o apagar la linterna (apagada te ven menos de noche) |
| ⏸ | Pausa, ajustes, exportar partida |

En PC: WASD para moverse, ratón para apuntar, clic para disparar, R recargar, Espacio empujar, F linterna, Esc pausa.

## Estado del desarrollo

- [x] **Fase 1:** mundo infinito, movimiento, combate, controles táctiles, zombies que evolucionan y aprenden (acechador, gritón, tanque), día y noche, clima.
- [ ] Fase 2: cofres, objetos, inventario, fabricación y establecimientos.
- [ ] Fase 3: refugio y construcción.
- [ ] Fase 4: sobrevivientes, diálogos, tareas, intercambio y saqueadores.
- [ ] Fase 5: esposa, hijos, crecimiento y herencia.
- [ ] Fase 6: vehículos.
- [ ] Fase 7: terraformación completa y mutantes avanzados.

## Desarrollo local

Sin herramientas de compilación: HTML + Canvas + JavaScript puro.

```bash
py -m http.server 8080 --bind 0.0.0.0
```

Abre `http://localhost:8080`. Para probar en el celular con el mismo Wi-Fi usa `http://IP-DE-TU-PC:8080`. Si agregas `?debug` a la dirección, se muestran los FPS y el estado de la IA.

La arquitectura y los contratos entre módulos están en [ARCHITECTURE.md](ARCHITECTURE.md).
