# tiburones-ascii

Un tema para Claude Code en la app de escritorio: detrás del chat nadan cuatro tiburones dibujados con caracteres ASCII (martillo, clásico, marrajo y zorro), en gris claro sobre un fondo casi negro, como en una terminal. Cruzan la pantalla de un lado a otro moviendo la cola. Los colores de la app pasan a grises oscuros con texto claro, y un velo oscurece a los tiburones cuando pasan por detrás de la columna del chat.

Basado en [ascii-sharks](https://github.com/stackedlol/ascii-sharks) de drewdi (licencia MIT; el aviso está en `LICENSE`).

## Instalación

En una sesión de Claude Code en la terminal, escribe:

```
/plugin install tiburones-ascii --marketplace nc1k/tiburones-ascii
```

Responde `y` para añadir el marketplace y pulsa Enter para instalarlo para tu usuario. O, desde una shell:

```bash
claude plugin install tiburones-ascii --marketplace nc1k/tiburones-ascii
```

En la app de escritorio, donde `/plugin` no funciona: pulsa **+** junto a la caja del mensaje, luego **Plugins**, **Add marketplace** con `nc1k/tiburones-ascii` y después **Add plugin**.

Abre una sesión nueva en la app de escritorio y los tiburones aparecen detrás del chat.

## Uso

- `/tiburones`: dice si está activado y qué opciones hay.
- `/tiburones on` y `/tiburones off`: activa o quita el fondo. Se recuerda para las sesiones siguientes.
- `/tiburones ahorro` (por defecto): los tiburones avanzan a saltos pequeños, todos a la vez, 8 veces por segundo. El fondo se repinta como mucho 8 veces por segundo en vez de 60 o 120.
- `/tiburones fluido`: deslizamiento continuo. Más suave, gasta más batería.

Si el sistema tiene activado «reducir movimiento», la escena se queda quieta.

## Qué hay dentro

- `hooks/scene.ts`: la escena. Rasteriza cada tiburón en seis posturas de la cola y monta un SVG cuyo CSS los desplaza y alterna las posturas. Ese SVG no ejecuta ningún script.
- `hooks/register.tsx`: pone el tema al empezar la sesión, lo repone tras `/clear`, registra `/tiburones` y dibuja el fondo.
- `hooks/make-colors.js`: el generador de paletas que trae Claude Code, sin cambios.
- `tests/tiburones.test.ts`: pruebas para `claude plugin test`.

## Límites

Solo la app de escritorio (y la móvil) dibujan fondos. La terminal y los editores no muestran nada. El tema está pensado para el modo oscuro: si la app está en modo claro y el texto sale oscuro, cámbialo en Ajustes → General → Apariencia.
