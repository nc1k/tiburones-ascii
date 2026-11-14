// Tema «tiburones-ascii»: un fondo animado de tiburones en ASCII detrás del chat de la app de escritorio,
// con colores oscuros para que el texto se lea encima. La escena está en scene.ts, basada en
// stackedlol/ascii-sharks (MIT, © 2026 drewdi; ver LICENSE).
//
//   /tiburones          dice cómo está y qué opciones hay
//   /tiburones on|off   activa o quita el tema (se recuerda entre sesiones)
//   /tiburones ahorro   movimiento a saltos de 1/8 s: gasta muy poca batería (por defecto)
//   /tiburones fluido   movimiento continuo: más suave, gasta más

import type { EngineInterface, Register, ThemeBackdropGlass, ThemeResult, ThemeSetArgs } from 'claude-code'

import { makeColors } from './make-colors.js'
import { BACKGROUND, sharkScene, type Motion } from './scene'

const PLUGIN = 'tiburones-ascii'
const SCENES: Record<Motion, string> = { ahorro: 'tiburones-ascii', fluido: 'tiburones-ascii-fluido' }

/**
 * Los paneles (barra lateral, caja del mensaje) quedan casi opacos sobre el fondo y sin desenfoque:
 * el desenfoque obliga a recalcular el panel cada vez que algo se mueve detrás, y aquí no hace falta.
 */
const GLASS: ThemeBackdropGlass = { blur: 0, tint: BACKGROUND, opacity: 0.8 }

/** Grises casi negros y texto claro; los colores de estado conservan su significado. */
const { theme: COLORS, problems } = makeColors({
  label: 'Tiburones ASCII',
  only: 'dark',
  roles: { accent: '#7fd4e6', danger: '#e5534b', success: '#57c26a', warning: '#d9a441', pro: '#a98be0' },
  dark: {
    gray: {
      anchors: {
        'surface-0': BACKGROUND,
        'surface-1': '#101215',
        'surface-2': '#15171b',
        'surface-3': '#1b1e23',
        'text-primary': '#e8eaed',
        'text-secondary': '#bfc3c9',
        'text-muted': '#959aa2',
      },
    },
  },
})

type Prefs = { isOn: boolean; motion: Motion }

async function prefsOf($: EngineInterface): Promise<Prefs> {
  const isOn = await $.store.get('activo')
  const motion = await $.store.get('movimiento')
  return { isOn: isOn !== false, motion: motion === 'fluido' ? 'fluido' : 'ahorro' }
}

function lookOf(motion: Motion): ThemeSetArgs {
  return {
    colors: COLORS,
    backdrop: { scene: SCENES[motion], glass: GLASS },
    overrideColorScheme: 'dark',
  }
}

/** Cada SVG se construye la primera vez que se pide y se guarda: la sesión solo paga lo que muestra. */
const built = new Map<Motion, string>()

function sceneOf(name: string): string | undefined {
  const motion = (Object.keys(SCENES) as Motion[]).find(m => SCENES[m] === name)
  if (motion === undefined) return undefined
  const ready = built.get(motion)
  if (ready !== undefined) return ready
  const source = sharkScene(motion)
  built.set(motion, source)
  return source
}

/** La sesión a la que se le puso el tema por última vez: tras un /clear cambia y se vuelve a poner. */
let shownFor: string | undefined

async function show($: EngineInterface): Promise<ThemeResult | undefined> {
  const prefs = await prefsOf($)
  if (!prefs.isOn) return undefined
  const set = await $.theme.set(lookOf(prefs.motion))
  shownFor = await $.session.id()
  return set
}

function drawnNote(set: ThemeResult | undefined): string {
  if (set === undefined || set.isDrawn) return ''
  return ` (Ahora mismo no hay una ventana que dibuje fondos: ${set.reason}. Se verá en la app de escritorio.)`
}

const HELP = [
  '/tiburones on      activa el fondo de tiburones',
  '/tiburones off     lo quita y vuelve al aspecto normal',
  '/tiburones ahorro  movimiento a saltos suaves, 8 veces por segundo: casi no gasta batería',
  '/tiburones fluido  movimiento continuo: más suave, gasta más',
].join('\n')

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'tiburones',
      description: 'Fondo de tiburones ASCII: on, off, ahorro o fluido',
    })
    // Mientras se ajustan los colores: la línea que haría que la app ignorase el tema entero.
    const unpainted = problems.find(line => line.startsWith("Desktop won't paint"))
    if (unpainted !== undefined) $.ui.toast(unpainted)
    await show($)
    return next(e)
  })

  // Tras un /clear la conversación sigue con otro id y no llega session.start: se repone al primer turno.
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined && shownFor !== (await $.session.id())) await show($)
    return next(e)
  })

  on('command.run', { command: 'tiburones' }, async ($, e) => {
    const word = e.args.trim().toLowerCase()
    const prefs = await prefsOf($)

    if (word === 'on' || word === 'activar') {
      await $.store.set('activo', true)
      const set = await show($)
      return { text: `Tiburones activados (movimiento: ${prefs.motion}).${drawnNote(set)}` }
    }
    if (word === 'off' || word === 'desactivar') {
      await $.store.set('activo', false)
      // Quitar el tema es lo que se ha pedido: solo aquí se borra.
      await $.theme.clear()
      shownFor = undefined
      return { text: 'Tiburones desactivados en todas las sesiones. Vuelven con /tiburones on.' }
    }
    if (word === 'ahorro' || word === 'fluido') {
      await $.store.set('movimiento', word)
      if (!prefs.isOn) return { text: `Movimiento: ${word}. El fondo está apagado; actívalo con /tiburones on.` }
      const set = await show($)
      return { text: `Movimiento: ${word}.${drawnNote(set)}` }
    }
    const state = prefs.isOn ? `activado, movimiento ${prefs.motion}` : 'desactivado'
    const intro = word === '' ? `Fondo de tiburones: ${state}.` : `No conozco «${word}». Fondo de tiburones: ${state}.`
    return { text: `${intro}\n${HELP}` }
  })

  on('ui.render', { component: 'Backdrop' }, ($, e, next) => {
    // Solo la app de escritorio y la móvil tienen sitio detrás del chat.
    if (e.surface !== 'desktop' && e.surface !== 'mobile') return next(e)
    if (!e.props.plugin.includes(PLUGIN)) return next(e)
    const source = sceneOf(e.props.scene)
    if (source === undefined) return next(e)
    const { Svg } = $.ui.resolve(e)
    return <Svg source={source} alt="Tiburones en ASCII nadando despacio sobre un fondo negro" isInteractive />
  })
}
