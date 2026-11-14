// The "ascii-sharks-theme" theme: an animated backdrop of ASCII sharks behind the desktop app's chat,
// with dark colors so the text stays readable on top. The scene lives in scene.ts, based on
// stackedlol/ascii-sharks (MIT, © 2026 drewdi; see LICENSE).
//
//   /sharks            says how it is set and lists the options
//   /sharks on|off     turns the theme on or off (remembered across sessions)
//   /sharks saver      moves in 1/8 s steps: uses very little battery (default)
//   /sharks smooth     continuous motion: smoother, uses more

import type { EngineInterface, Register, ThemeBackdropGlass, ThemeResult, ThemeSetArgs } from 'claude-code'

import { makeColors } from './make-colors.js'
import { BACKGROUND, sharkScene, type Motion } from './scene'

const PLUGIN = 'ascii-sharks-theme'
const SCENES: Record<Motion, string> = { saver: 'ascii-sharks', smooth: 'ascii-sharks-smooth' }

/**
 * Panels (sidebar, message box) stay almost opaque over the backdrop and unblurred:
 * a blur makes the panel recompute every time something moves behind it, and it is not needed here.
 */
const GLASS: ThemeBackdropGlass = { blur: 0, tint: BACKGROUND, opacity: 0.8 }

/** Near-black grays and light text; status colors keep their meaning. */
const { theme: COLORS, problems } = makeColors({
  label: 'ASCII Sharks',
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
  const isOn = await $.store.get('enabled')
  const motion = await $.store.get('motion')
  return { isOn: isOn !== false, motion: motion === 'smooth' ? 'smooth' : 'saver' }
}

function lookOf(motion: Motion): ThemeSetArgs {
  return {
    colors: COLORS,
    backdrop: { scene: SCENES[motion], glass: GLASS },
    overrideColorScheme: 'dark',
  }
}

/** Each SVG is built the first time it is asked for and then kept: a session only pays for what it shows. */
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

/** The session the theme was last applied to: after a /clear it changes and the theme is applied again. */
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
  return ` (No window can draw backdrops right now: ${set.reason}. It will show in the desktop app.)`
}

const HELP = [
  '/sharks on      turns the shark backdrop on',
  '/sharks off     removes it and goes back to the normal look',
  '/sharks saver   moves in small steps, 8 times per second: barely uses battery',
  '/sharks smooth  continuous motion: smoother, uses more battery',
].join('\n')

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'sharks',
      description: 'ASCII shark backdrop: on, off, saver or smooth',
    })
    // While the colors are being tuned: the line that would make the app ignore the whole theme.
    const unpainted = problems.find(line => line.startsWith("Desktop won't paint"))
    if (unpainted !== undefined) $.ui.toast(unpainted)
    await show($)
    return next(e)
  })

  // After a /clear the conversation goes on with a new id and no session.start arrives: reapply on the first turn.
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined && shownFor !== (await $.session.id())) await show($)
    return next(e)
  })

  on('command.run', { command: 'sharks' }, async ($, e) => {
    const word = e.args.trim().toLowerCase()
    const prefs = await prefsOf($)

    if (word === 'on') {
      await $.store.set('enabled', true)
      const set = await show($)
      return { text: `Sharks on (motion: ${prefs.motion}).${drawnNote(set)}` }
    }
    if (word === 'off') {
      await $.store.set('enabled', false)
      // Removing the theme is what was asked for: only here is it cleared.
      await $.theme.clear()
      shownFor = undefined
      return { text: 'Sharks off in every session. Bring them back with /sharks on.' }
    }
    if (word === 'saver' || word === 'smooth') {
      await $.store.set('motion', word)
      if (!prefs.isOn) return { text: `Motion: ${word}. The backdrop is off; turn it on with /sharks on.` }
      const set = await show($)
      return { text: `Motion: ${word}.${drawnNote(set)}` }
    }
    const state = prefs.isOn ? `on, motion ${prefs.motion}` : 'off'
    const intro = word === '' ? `Shark backdrop: ${state}.` : `Unknown option "${word}". Shark backdrop: ${state}.`
    return { text: `${intro}\n${HELP}` }
  })

  on('ui.render', { component: 'Backdrop' }, ($, e, next) => {
    // Only the desktop and mobile apps have room behind the chat.
    if (e.surface !== 'desktop' && e.surface !== 'mobile') return next(e)
    if (!e.props.plugin.includes(PLUGIN)) return next(e)
    const source = sceneOf(e.props.scene)
    if (source === undefined) return next(e)
    const { Svg } = $.ui.resolve(e)
    return <Svg source={source} alt="ASCII sharks swimming slowly across a black background" isInteractive />
  })
}
