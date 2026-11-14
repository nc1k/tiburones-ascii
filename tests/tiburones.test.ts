import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { sharkScene } from '../hooks/scene'

const BACKDROP = {
  plugin: 'tiburones-ascii',
  component: 'Backdrop',
  requestId: 'fondo',
  props: { scene: 'tiburones-ascii', plugin: 'tiburones-ascii', glass: { blur: 0, opacity: 0.8 } },
} as const

/** Lo que el motor respondería debajo del mod: aquí cada hook hace de motor. */
function engine(on: On, record: { sets: unknown[]; clears: number }): void {
  mock.store(on)
  on('command.register', () => ({ value: { command: 'tiburones' } }))
  on('theme.set', (_, e) => {
    record.sets.push(e)
    return { value: { isDrawn: true, requestId: 'fondo' } }
  })
  on('theme.clear', () => {
    record.clears += 1
    return { value: { isDrawn: false, reason: 'cleared' } }
  })
  on('session.id', () => ({ value: 'sesion-1' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
}

test('las dos escenas caben en el límite de un Svg, sin peces ni ballena, y solo «ahorro» va a saltos', () => {
  const ahorro = sharkScene('ahorro')
  const fluido = sharkScene('fluido')
  console.log(`tamaño: ahorro ${ahorro.length}, fluido ${fluido.length} (límite 131072)`)
  for (const svg of [ahorro, fluido]) {
    expect(svg.length).toBeLessThan(131072)
    expect(svg).toContain('class="m martillo"')
    expect(svg).not.toContain('sardinas')
    expect(svg).not.toContain('ballena')
  }
  expect(ahorro).toContain('steps(')
  expect(fluido).not.toContain('steps(')
  expect(ahorro).toContain('prefers-reduced-motion')
})

test('al empezar pone el tema oscuro y dibuja los tiburones en el escritorio', async ($, on) => {
  const record = { sets: [] as unknown[], clears: 0 }
  engine(on, record)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(record.sets.length).toBe(1)
  expect(JSON.stringify(record.sets[0])).toContain('"scene":"tiburones-ascii"')

  const ui = await $.ui.mount({ ...BACKDROP, surface: 'desktop' })
  const svg = await ui.find({ type: 'Svg' })
  expect(String(svg?.props.source ?? '')).toContain('<svg')
  await ui.unmount()
})

test('/tiburones off lo quita y lo recuerda; on lo devuelve', async ($, on) => {
  const record = { sets: [] as unknown[], clears: 0 }
  engine(on, record)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const off = await $.command.run({ command: 'tiburones', args: 'off' })
  expect(off.text ?? '').toContain('desactivados')
  expect(record.clears).toBe(1)
  // Apagado se recuerda: una sesión nueva no vuelve a ponerlo.
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(record.sets.length).toBe(1)

  const back = await $.command.run({ command: 'tiburones', args: 'on' })
  expect(back.text ?? '').toContain('activados')
  expect(record.sets.length).toBe(2)
})

test('/tiburones fluido cambia a la escena continua', async ($, on) => {
  const record = { sets: [] as unknown[], clears: 0 }
  engine(on, record)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'tiburones', args: 'fluido' })
  expect(JSON.stringify(record.sets.at(-1))).toContain('"scene":"tiburones-ascii-fluido"')
  // Y se recuerda en la sesión siguiente.
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(JSON.stringify(record.sets.at(-1))).toContain('"scene":"tiburones-ascii-fluido"')
})
