import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { sharkScene } from '../hooks/scene'

const BACKDROP = {
  plugin: 'ascii-sharks-theme',
  component: 'Backdrop',
  requestId: 'backdrop',
  props: { scene: 'ascii-sharks', plugin: 'ascii-sharks-theme', glass: { blur: 0, opacity: 0.8 } },
} as const

/** What the engine would answer beneath the mod: here each hook stands in for the engine. */
function engine(on: On, record: { sets: unknown[]; clears: number }): void {
  mock.store(on)
  on('command.register', () => ({ value: { command: 'sharks' } }))
  on('theme.set', (_, e) => {
    record.sets.push(e)
    return { value: { isDrawn: true, requestId: 'backdrop' } }
  })
  on('theme.clear', () => {
    record.clears += 1
    return { value: { isDrawn: false, reason: 'cleared' } }
  })
  on('session.id', () => ({ value: 'session-1' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
}

test('both scenes fit an Svg limit, and only "saver" moves in steps', () => {
  const saver = sharkScene('saver')
  const smooth = sharkScene('smooth')
  for (const svg of [saver, smooth]) {
    expect(svg.length).toBeLessThan(131072)
    expect(svg).toContain('class="m hammerhead"')
  }
  expect(saver).toContain('steps(')
  expect(smooth).not.toContain('steps(')
  expect(saver).toContain('prefers-reduced-motion')
})

test('on start it sets the dark theme and draws the sharks on desktop', async ($, on) => {
  const record = { sets: [] as unknown[], clears: 0 }
  engine(on, record)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(record.sets.length).toBe(1)
  expect(JSON.stringify(record.sets[0])).toContain('"scene":"ascii-sharks"')

  const ui = await $.ui.mount({ ...BACKDROP, surface: 'desktop' })
  const svg = await ui.find({ type: 'Svg' })
  expect(String(svg?.props.source ?? '')).toContain('<svg')
  await ui.unmount()
})

test('/sharks off removes it and remembers; on brings it back', async ($, on) => {
  const record = { sets: [] as unknown[], clears: 0 }
  engine(on, record)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const off = await $.command.run({ command: 'sharks', args: 'off' })
  expect(off.text ?? '').toContain('Sharks off')
  expect(record.clears).toBe(1)
  // Off is remembered: a new session does not apply it again.
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(record.sets.length).toBe(1)

  const back = await $.command.run({ command: 'sharks', args: 'on' })
  expect(back.text ?? '').toContain('Sharks on')
  expect(record.sets.length).toBe(2)
})

test('/sharks smooth switches to the continuous scene', async ($, on) => {
  const record = { sets: [] as unknown[], clears: 0 }
  engine(on, record)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'sharks', args: 'smooth' })
  expect(JSON.stringify(record.sets.at(-1))).toContain('"scene":"ascii-sharks-smooth"')
  // And it is remembered in the next session.
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(JSON.stringify(record.sets.at(-1))).toContain('"scene":"ascii-sharks-smooth"')
})

test('/sharks still answers when the app names it after the plugin or the store fails', async ($, on) => {
  const record = { sets: [] as unknown[], clears: 0 }
  on('store.get', () => {
    throw new Error('store unavailable')
  })
  on('store.set', () => {
    throw new Error('store unavailable')
  })
  on('command.register', () => ({ value: { command: 'sharks' } }))
  on('theme.set', (_, e) => {
    record.sets.push(e)
    return { value: { isDrawn: true, requestId: 'backdrop' } }
  })
  on('theme.clear', () => ({ value: { isDrawn: false, reason: 'cleared' } }))
  on('session.id', () => ({ value: 'session-1' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const named = await $.command.run({ command: 'ascii-sharks-theme:sharks', args: 'smooth' })
  expect(named.text ?? '').toContain('Motion: smooth')
  expect(named.text ?? '').toContain('could not be saved')
  // This session's own copy keeps the choice.
  const status = await $.command.run({ command: 'sharks', args: '' })
  expect(status.text ?? '').toContain('motion smooth')
})
