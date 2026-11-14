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

/** This session's own copy of the preferences, used when the store cannot be read or written. */
const local = new Map<string, unknown>()

/** Reads a saved preference; if the store is unavailable, this session's copy stands instead of failing. */
async function stored($: EngineInterface, key: string): Promise<unknown> {
  try {
    return await $.store.get(key)
  } catch {
    return local.get(key)
  }
}

/** Saves a preference; returns false when the store refused, so the reply can say it was not remembered. */
async function save($: EngineInterface, key: string, value: unknown): Promise<boolean> {
  local.set(key, value)
  try {
    await $.store.set(key, value)
    return true
  } catch {
    return false
  }
}

async function prefsOf($: EngineInterface): Promise<Prefs> {
  const isOn = await stored($, 'enabled')
  const motion = await stored($, 'motion')
  return { isOn: isOn !== false, motion: motion === 'smooth' ? 'smooth' : 'saver' }
}

/** True for this plugin's command, with or without the plugin's name in front of it. */
const isSharks = (command: string): boolean => command === 'sharks' || command.endsWith(':sharks')

const NOT_SAVED = ' (This choice could not be saved, so it lasts for this session only.)'

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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
    try {
      await show($)
    } catch (error) {
      $.ui.toast(`ASCII sharks could not apply the theme: ${messageOf(error)}`)
    }
    return next(e)
  })

  // After a /clear the conversation goes on with a new id and no session.start arrives: reapply on the first turn.
  on('turn.start', async ($, e, next) => {
    try {
      if (e.agentId === undefined && shownFor !== (await $.session.id())) await show($)
    } catch {
      // The theme stays as it was; /sharks says what failed if asked.
    }
    return next(e)
  })

  // Always answers, even when something below fails, so /sharks never goes unanswered. It listens to every
  // command and picks /sharks out itself, so it also answers where an app names it after the plugin
  // ("ascii-sharks-theme:sharks").
  on('command.run', async ($, e, next) => {
    if (!isSharks(e.command)) return next(e)
    const word = String(e.args ?? '').trim().toLowerCase()
    try {
      const prefs = await prefsOf($)

      if (word === 'on') {
        const kept = await save($, 'enabled', true)
        const set = await show($)
        return { text: `Sharks on (motion: ${prefs.motion}).${kept ? '' : NOT_SAVED}${drawnNote(set)}` }
      }
      if (word === 'off') {
        const kept = await save($, 'enabled', false)
        // Removing the theme is what was asked for: only here is it cleared.
        await $.theme.clear()
        shownFor = undefined
        const where = kept ? 'in every session' : 'for this session'
        return { text: `Sharks off ${where}. Bring them back with /sharks on.` }
      }
      if (word === 'saver' || word === 'smooth') {
        const kept = await save($, 'motion', word)
        const note = kept ? '' : NOT_SAVED
        if (!prefs.isOn) return { text: `Motion: ${word}.${note} The backdrop is off; turn it on with /sharks on.` }
        const set = await show($)
        return { text: `Motion: ${word}.${note}${drawnNote(set)}` }
      }
      const state = prefs.isOn ? `on, motion ${prefs.motion}` : 'off'
      const intro = word === '' ? `Shark backdrop: ${state}.` : `Unknown option "${word}". Shark backdrop: ${state}.`
      return { text: `${intro}\n${HELP}` }
    } catch (error) {
      return {
        text:
          `/sharks ${word} could not finish: ${messageOf(error)}\n` +
          'Please open an issue at https://github.com/Ryukamy/ascii-sharks-theme/issues with this message and your Claude Code version.',
      }
    }
  }).catch(($, e, next) => (next.called || !isSharks(e.command) ? next(e) : { text: 'ASCII sharks: /sharks failed before it could answer.' }))

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
