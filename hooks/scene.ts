// Escena de fondo: tiburones en ASCII sobre negro, estilo terminal.
//
// Basada en stackedlol/ascii-sharks (https://github.com/stackedlol/ascii-sharks),
// Copyright (c) 2026 drewdi, licencia MIT; el aviso completo está en LICENSE.
// De allí vienen, portadas casi tal cual desde src/renderer.ts y src/math.ts: las siluetas vistas
// desde arriba de cada especie (anchura del cuerpo, aletas, cabeza de martillo), la onda que
// recorre el cuerpo al nadar, el muestreo de cada celda con sub-muestras para que los bordes
// salgan suaves, el hash de las texturas y los juegos de glifos.
//
// Lo que cambia: el fondo de la app es un SVG sin scripts, así que aquí no hay canvas ni bucle.
// Cada tiburón se rasteriza unas pocas veces al cargar el mod (una por postura de la cola) y el CSS
// de dentro del SVG lo desplaza y alterna las posturas. En vez de bloques grises con glifos oscuros,
// los glifos van en gris claro sobre negro: más denso donde la piel recibe más luz.
//
// Batería: en modo «ahorro» todo cambia a la vez en pasos de 1/8 de segundo, así que el fondo se
// repinta como mucho 8 veces por segundo en lugar de 60 o 120. No hay filtros ni desenfoques.
// Con «reducir movimiento» activado en el sistema, la escena se queda quieta en una composición fija.
// Todo es construir texto: sin DOM, sin nada de fuera y la misma salida en cada llamada.

export type Motion = 'ahorro' | 'fluido'

const VIEW_W = 1600
const VIEW_H = 1000
/** Una celda de la rejilla, en unidades del viewBox (el original usa celdas de unos 12×18 px). */
const CW = 10
const CH = 15
/** El reloj común: todo paso y todo cambio de postura cae en múltiplos de este tiempo. */
const TICK = 0.125
const NODES = 20
const POSES = 6
/** Amplitud de la onda al nadar a velocidad de crucero (en el original, `speed / 60` acotado). */
const SWIM = 0.85

export const BACKGROUND = '#0a0b0d'

const BODY = 1
const EDGE = 2
const FIN = 3
const RIDGE = 4
const EYE = 5

// Glifos del original: escasos donde hay poca tinta, densos donde hay mucha.
const SKIN_RAMP = ':;t%SX8#@'
const FIN_GLYPHS = '%;tS:'
const RIDGE_GLYPHS = '@8%'
const EDGE_HEAVY = ':;'
const EDGE_LIGHT = ".',`"
const WAKE_GLYPHS = ".`',"

/** Sub-muestras dentro de cada celda, para bordes con antialias. */
const SUBSAMPLES: ReadonlyArray<readonly [number, number]> = [
  [0.25, 0.3],
  [0.75, 0.3],
  [0.25, 0.72],
  [0.75, 0.72],
]

/** Brillos posibles de un glifo: cuatro grises por animal, para que el SVG pese poco. */
const LEVELS = [0.34, 0.52, 0.7, 0.88] as const

// ── utilidades (de src/math.ts) ──────────────────────────────────────────

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)

function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1)
  return t * t * (3 - 2 * t)
}

/** Hash entero barato → [0, 1). Determinista, así las texturas no cambian entre cargas. */
function hash3(x: number, y: number, z: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1442695041)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

function charOf(set: string, index: number): string {
  return set[index % set.length] ?? set[0] ?? '.'
}

// ── siluetas (de src/renderer.ts) ────────────────────────────────────────

type Shape = {
  halfWidth: (s: number) => number
  pectoral: readonly [number, number, number, number]
  falcate: boolean
  pelvic: readonly [number, number, number, number]
  caudal: number
  dorsal: readonly [number, number]
  secondDorsal: readonly [number, number]
  head?: { span: number; sweep: number; depth: number; notch: number }
  eye: readonly [number, number] | null
  gills: readonly [number, number]
}

/** Media anchura clásica vista desde arriba en s ∈ [0, 1] (hocico → cola), como fracción de la longitud. */
function classicHalfWidth(s: number): number {
  if (s < 0.13) return 0.09 * Math.pow(Math.sin(((s / 0.13) * Math.PI) / 2), 0.95)
  if (s < 0.3) return 0.09 + 0.016 * smoothstep(0.13, 0.3, s)
  if (s < 0.84) return 0.019 + 0.087 * Math.pow(1 - (s - 0.3) / 0.54, 1.25)
  const k = (s - 0.84) / 0.16
  return 0.019 * (1 - k) + 0.012 * Math.sin(k * Math.PI)
}

const SHAPES = {
  classic: {
    halfWidth: classicHalfWidth,
    pectoral: [0.15, 0.43, 0.55, 0.26],
    falcate: true,
    pelvic: [0.57, 0.65, 0.69, 0.085],
    caudal: 0.085,
    dorsal: [0.33, 0.47],
    secondDorsal: [0.71, 0.76],
    eye: [0.1, 0.14],
    gills: [0.19, 0.29],
  },
  // Cuello fino bajo un cefalofolio ancho y echado hacia atrás, primera dorsal alta.
  hammerhead: {
    halfWidth: (s: number) => {
      if (s < 0.06) return 0.045
      if (s < 0.3) return 0.045 + 0.061 * smoothstep(0.06, 0.3, s)
      return classicHalfWidth(s) * 0.92
    },
    head: { span: 0.17, sweep: 0.035, depth: 0.09, notch: 0 },
    pectoral: [0.17, 0.4, 0.5, 0.22],
    falcate: true,
    pelvic: [0.56, 0.63, 0.67, 0.075],
    caudal: 0.11,
    dorsal: [0.28, 0.44],
    secondDorsal: [0.7, 0.74],
    eye: null,
    gills: [0.16, 0.26],
  },
  // Marrajo: hocico cónico y largo, cuerpo de torpedo y cola alta en media luna.
  mako: {
    halfWidth: (s: number) => {
      if (s < 0.17) return 0.088 * Math.pow(Math.sin(((s / 0.17) * Math.PI) / 2), 1.5)
      if (s < 0.32) return 0.088 + 0.012 * smoothstep(0.17, 0.32, s)
      if (s < 0.86) return 0.014 + 0.086 * Math.pow(1 - (s - 0.32) / 0.54, 1.45)
      const k = (s - 0.86) / 0.14
      return 0.014 * (1 - k) + 0.01 * Math.sin(k * Math.PI)
    },
    pectoral: [0.18, 0.4, 0.5, 0.21],
    falcate: true,
    pelvic: [0.58, 0.64, 0.68, 0.06],
    caudal: 0.13,
    dorsal: [0.34, 0.45],
    secondDorsal: [0.76, 0.79],
    eye: [0.11, 0.15],
    gills: [0.2, 0.3],
  },
  // Tiburón zorro: cuerpo compacto delante y el lóbulo superior de la cola como un látigo larguísimo.
  thresher: {
    halfWidth: (s: number) => {
      if (s < 0.08) return 0.07 * Math.pow(Math.sin(((s / 0.08) * Math.PI) / 2), 0.75)
      if (s < 0.2) return 0.07 + 0.02 * smoothstep(0.08, 0.2, s)
      if (s < 0.48) return 0.012 + 0.078 * Math.pow(1 - (s - 0.2) / 0.28, 1.3)
      const k = (s - 0.48) / 0.52
      return 0.012 * (1 - k) + 0.006 * Math.sin(k * Math.PI * 0.9) + 0.002
    },
    pectoral: [0.12, 0.27, 0.36, 0.2],
    falcate: true,
    pelvic: [0.37, 0.41, 0.44, 0.045],
    caudal: 0,
    dorsal: [0.24, 0.32],
    secondDorsal: [0.45, 0.47],
    eye: [0.05, 0.1],
    gills: [0.11, 0.18],
  },
} satisfies Record<string, Shape>

type Kind = keyof typeof SHAPES

function inTriangle(px: number, py: number, ax: number, ay: number, bx: number, by: number, cx: number, cy: number): boolean {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by)
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy)
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay)
  const neg = d1 < 0 || d2 < 0 || d3 < 0
  const pos = d1 > 0 || d2 > 0 || d3 > 0
  return !(neg && pos)
}

// ── rasterizado de un tiburón en una postura ─────────────────────────────

type Point = { x: number; y: number }
/** Una celda pintada: columna, fila, glifo y brillo (0–1). */
type Cell = { c: number; r: number; glyph: string; level: number }
type Raster = { cells: Cell[]; cols: number; rows: number; tail: Point }
type Seg = { ax: number; ay: number; sx: number; sy: number; len2: number; len: number; arc: number }
type Hit = { on: boolean; flag: number; shade: number; s: number; v: number; dist: number }

/**
 * Rasteriza un tiburón recto, mirando a la derecha (`dir` 1) o a la izquierda (-1), con la onda del
 * cuerpo en la fase `phase`. Devuelve las celdas en la rejilla de su propia caja.
 */
function rasterShark(shape: Shape, L: number, phase: number, dir: 1 | -1, id: number): Raster {
  const padCols = Math.ceil((L * 0.06) / CW)
  const halfRows = Math.ceil((L * 0.31) / CH)
  const rows = halfRows * 2 + 1
  const cols = Math.ceil(L / CW) + padCols * 2
  const padX = padCols * CW
  const midY = (halfRows + 0.5) * CH

  // La columna vertebral: recta, más la onda que crece hacia la cola.
  const spine: Point[] = []
  for (let k = 0; k < NODES; k += 1) {
    const s = k / (NODES - 1)
    const x = dir > 0 ? padX + L - s * L : padX + s * L
    const amp = L * 0.05 * (0.1 + 0.9 * Math.pow(s, 1.8)) * SWIM
    const off = amp * Math.sin(phase - s * 5.2)
    spine.push({ x, y: midY + dir * off })
  }
  const segs: Seg[] = []
  let arcSoFar = 0
  let prev: Point | undefined
  for (const p of spine) {
    if (prev !== undefined) {
      const sx = p.x - prev.x
      const sy = p.y - prev.y
      const len2 = sx * sx + sy * sy || 1
      const len = Math.sqrt(len2)
      segs.push({ ax: prev.x, ay: prev.y, sx, sy, len2, len, arc: arcSoFar })
      arcSoFar += len
    }
    prev = p
  }
  const total = arcSoFar || 1
  const flex = 1 + 0.06 * Math.sin(phase * 0.5)
  const tip = L * shape.pectoral[3] * flex
  const hit: Hit = { on: false, flag: 0, shade: 0, s: 0, v: 0, dist: 0 }

  /** Clasifica un punto respecto al tiburón: s a lo largo del cuerpo (0 hocico → 1 cola), v a través. */
  const sample = (px: number, py: number): Hit => {
    let best = Infinity
    let bestS = 0
    let bestSign = 1
    let bestNx = 0
    let bestNy = 0
    for (const g of segs) {
      const u = clamp(((px - g.ax) * g.sx + (py - g.ay) * g.sy) / g.len2, 0, 1)
      const qx = g.ax + g.sx * u
      const qy = g.ay + g.sy * u
      const d2 = (px - qx) ** 2 + (py - qy) ** 2
      if (d2 < best) {
        best = d2
        bestS = (g.arc + u * g.len) / total
        bestSign = g.sx * (py - g.ay) - g.sy * (px - g.ax) >= 0 ? 1 : -1
        bestNx = (-g.sy / g.len) * bestSign
        bestNy = (g.sx / g.len) * bestSign
      }
    }
    const a = Math.sqrt(best)
    const s = bestS
    const u = s * L
    const w = shape.halfWidth(s) * L
    hit.on = false
    hit.dist = a
    hit.s = s
    hit.v = a * bestSign

    const head = shape.head
    if (head !== undefined && u < L * (head.sweep + head.depth + head.notch)) {
      // Cefalofolio: un ala ancha a través del hocico, con las puntas echadas hacia atrás.
      const span = L * head.span
      const r = a / span
      const front = L * head.sweep * r * r + L * head.notch * Math.max(0, 1 - r / 0.14)
      const depth = L * head.depth * (1 - 0.2 * r * r * r * r)
      if (r <= 1 && u >= front && u <= front + depth) {
        hit.on = true
        hit.flag = r > 0.84 ? EYE : BODY
        hit.shade = r > 0.84 ? 0 : 0.62 - 0.2 * r + (u < front + L * 0.012 ? 0.1 : 0)
        return hit
      }
    }

    if (a <= w) {
      const across = a / (w || 1)
      // Lomo redondeado iluminado desde arriba a la izquierda; los flancos caen en sombra.
      const facing = (bestNx * -0.6 + bestNy * -0.8) * across
      let shade = 0.58 - across * across * 0.42 + facing * 0.26
      let flag = BODY
      if (s > shape.dorsal[0] && s < shape.dorsal[1] && across < 0.3) {
        flag = RIDGE
        shade = 1
      } else if (s > shape.secondDorsal[0] && s < shape.secondDorsal[1] && across < 0.4) {
        shade = Math.max(shade, 0.82)
      } else if (shape.eye !== null && s > shape.eye[0] && s < shape.eye[1] && across > 0.6) {
        flag = EYE
        shade = 0
      } else if (s > shape.gills[0] && s < shape.gills[1] && across > 0.58) {
        // Cinco hendiduras branquiales.
        if (Math.floor(((s - shape.gills[0]) / (shape.gills[1] - shape.gills[0])) * 5) % 2 === 0) shade *= 0.45
      } else if (s < 0.05) {
        shade = Math.max(shade, 0.7)
      }
      hit.on = true
      hit.flag = flag
      hit.shade = shade
      return hit
    }

    const [p0, p1, p2] = shape.pectoral
    if (
      inTriangle(u, a, L * p0, 0, L * p1, 0, L * p2, tip) &&
      // Las aletas falcadas (en hoz) tienen el borde de salida cóncavo.
      !(shape.falcate && inTriangle(u, a, L * p1, 0, L * (p1 + (p2 - p1) * 0.33), tip * 0.55, L * p2, tip))
    ) {
      hit.on = true
      hit.flag = FIN
      hit.shade = 0.38 + 0.22 * (1 - clamp(a / tip, 0, 1))
      return hit
    }
    const [v0, v1, v2, vr] = shape.pelvic
    if (
      inTriangle(u, a, L * v0, 0, L * v1, 0, L * v2, L * vr) ||
      (shape.caudal > 0 && inTriangle(u, a, L * 0.86, 0, L * 0.95, 0, L, L * shape.caudal))
    ) {
      hit.on = true
      hit.flag = FIN
      hit.shade = 0.36
      return hit
    }
    return hit
  }

  const cells: Cell[] = []
  const skipBeyond = L * 0.36 + Math.hypot(CW, CH)
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const x = c * CW
      const y = r * CH
      const center = sample(x + CW / 2, y + CH / 2)
      const centerHit = center.on
      if (!centerHit && center.dist > skipBeyond) continue
      const { flag, shade, s, v } = center
      let hits = centerHit ? 1 : 0
      for (const [ox, oy] of SUBSAMPLES) {
        if (sample(x + ox * CW, y + oy * CH).on) hits += 1
      }
      if (hits === 0) continue
      const coverage = hits / 5
      // Clave anclada al cuerpo: cada glifo viaja con su trozo de piel de una postura a otra.
      const key = (hash3(Math.round(s * 52), Math.round(v / (CW * 0.9)), id) * 4294967295) >>> 0
      const look = centerHit && coverage >= 0.6 ? lookOf(flag, shade, key) : lookOf(EDGE, coverage, key)
      cells.push({ c, r, glyph: look[0], level: look[1] })
    }
  }
  const tail = spine[spine.length - 1] ?? { x: padX, y: midY }
  return { cells, cols, rows, tail }
}

/** Glifo y brillo de una celda: más tinta y más claro donde el lomo recibe luz. */
function lookOf(flag: number, shade: number, key: number): [string, number] {
  const pick = key >>> 8
  if (flag === EDGE) return [charOf(shade >= 0.5 ? EDGE_HEAVY : EDGE_LIGHT, pick), 0.3 + shade * 0.25]
  if (flag === RIDGE) return [charOf(RIDGE_GLYPHS, pick), 1]
  if (flag === EYE) return ['o', 0.5]
  if (flag === FIN) return [charOf(FIN_GLYPHS, pick), 0.3 + shade * 0.6]
  const jitter = ((key >>> 4) % 3) - 1
  const index = clamp(Math.floor(shade * 8.99) + jitter, 0, SKIN_RAMP.length - 1)
  return [charOf(SKIN_RAMP, index), 0.34 + shade * 0.62]
}

/** La estela: unos puntos tenues detrás de la cola, distintos en cada postura para que titilen. */
function wakeCells(tail: Point, dir: 1 | -1, seed: number): Cell[] {
  const out: Cell[] = []
  const taken = new Set<string>()
  const tc = Math.floor(tail.x / CW)
  const tr = Math.floor(tail.y / CH)
  for (let i = 0; i < 16; i += 1) {
    const along = Math.pow(hash3(seed, i, 3), 0.85)
    const back = 1 + Math.round(along * 13)
    const spread = 0.4 + along * 2.6
    const c = tc - dir * back
    const r = tr + Math.round((hash3(seed, i, 5) - 0.5) * 2 * spread)
    const at = `${c},${r}`
    if (taken.has(at)) continue
    taken.add(at)
    out.push({ c, r, glyph: charOf(WAKE_GLYPHS, Math.floor(hash3(seed, i, 7) * 97)), level: 0.42 - along * 0.1 })
  }
  return out
}

// ── de celdas a SVG ──────────────────────────────────────────────────────

/** Gris frío de un brillo y una profundidad: cuanto más hondo nada el animal, más apagado. */
function grayOf(level: number, depth: number): string {
  const g = Math.round(240 * level * depth)
  const r = Math.round(g * 0.96)
  const b = Math.min(255, Math.round(g * 1.03) + 3)
  return `#${[r, g, b].map(n => clamp(n, 0, 255).toString(16).padStart(2, '0')).join('')}`
}

function bucketOf(level: number): number {
  let best = 0
  let gap = Infinity
  LEVELS.forEach((l, i) => {
    const d = Math.abs(l - level)
    if (d < gap) {
      gap = d
      best = i
    }
  })
  return best
}

/** Un grupo por gris y, dentro, un `<text>` por fila con una x por glifo: la rejilla no depende de la fuente. */
function cellsSvg(cells: Cell[], depth: number): string {
  const buckets = new Map<number, Map<number, Cell[]>>()
  for (const cell of cells) {
    const b = bucketOf(cell.level)
    const rows = buckets.get(b) ?? new Map<number, Cell[]>()
    const row = rows.get(cell.r) ?? []
    row.push(cell)
    rows.set(cell.r, row)
    buckets.set(b, rows)
  }
  let out = ''
  for (const [b, rows] of [...buckets].sort((x, y) => x[0] - y[0])) {
    let texts = ''
    for (const [r, row] of rows) {
      row.sort((x, y) => x.c - y.c)
      const xs = row.map(cell => cell.c * CW + CW / 2).join(' ')
      texts += `<text x="${xs}" y="${r * CH + CH / 2 + 4}">${row.map(cell => cell.glyph).join('')}</text>`
    }
    out += `<g fill="${grayOf(LEVELS[b] ?? 0.5, depth)}">${texts}</g>`
  }
  return out
}

/** Posturas que se turnan: cada una se ve `ticksPerPose` ticks; la primera es la que queda en reposo. */
function posesSvg(poses: string[], ticksPerPose: number): string {
  const count = poses.length
  const period = count * ticksPerPose * TICK
  return poses
    .map((body, j) => {
      const delay = ((count - j) % count) * ticksPerPose * TICK
      const hidden = j === 0 ? '' : ' opacity="0"'
      return `<g class="b${count}"${hidden} style="animation-duration:${period}s;animation-delay:-${delay}s">${body}</g>`
    })
    .join('')
}

// ── quién nada, por dónde y a qué ritmo ──────────────────────────────────

type Mover = {
  /** Su clase y el nombre de su animación. */
  name: string
  body: string
  /** Desde dónde y hasta dónde va su caja (esquina superior izquierda), en unidades del viewBox. */
  from: Point
  to: Point
  /** Cuánto avanza en horizontal por tick. */
  step: number
  /** Cuántos ticks espera fuera de la pantalla antes de volver a pasar. */
  pauseTicks: number
  /** Por dónde va de su ciclo en el instante cero: así la escena arranca ya poblada. */
  start: number
  /** Dónde se queda cuando no hay animación (reducir movimiento). */
  rest: Point
}

function moverCss(m: Mover, motion: Motion): string {
  const steps = Math.max(1, Math.round(Math.abs(m.to.x - m.from.x) / m.step))
  const cycle = steps + m.pauseTicks
  const pct = ((steps / cycle) * 100).toFixed(4)
  const duration = cycle * TICK
  const delay = Math.round(m.start * cycle) * TICK
  // Ahorro: un salto por tick, todos a la vez. Fluido: deslizamiento continuo, a la tasa de la pantalla.
  const timing = motion === 'ahorro' ? `steps(${steps},end)` : 'linear'
  return (
    `.${m.name}{transform:translate(${m.rest.x}px,${m.rest.y}px);animation:${m.name} ${duration}s ${timing} -${delay}s infinite}` +
    `@keyframes ${m.name}{0%{transform:translate(${m.from.x}px,${m.from.y}px)}${pct}%,100%{transform:translate(${m.to.x}px,${m.to.y}px)}}`
  )
}

type SharkSpec = {
  name: string
  kind: Kind
  length: number
  dir: 1 | -1
  /** Centro de su carril al entrar y al salir. */
  laneFrom: number
  laneTo: number
  step: number
  pause: number
  start: number
  depth: number
  ticksPerPose: number
  /** Dónde descansa su caja con reducir movimiento; fuera de la pantalla si no se ve. */
  restX: number
  seed: number
}

/** Cuatro tiburones a distintas profundidades: los más hondos, más apagados y por debajo. */
const SHARKS: readonly SharkSpec[] = [
  { name: 'zorro', kind: 'thresher', length: 440, dir: -1, laneFrom: 400, laneTo: 350, step: 3, pause: 50, start: 0.06, depth: 0.55, ticksPerPose: 2, restX: -3000, seed: 41 },
  { name: 'marrajo', kind: 'mako', length: 360, dir: 1, laneFrom: 560, laneTo: 470, step: 5, pause: 36, start: 0.92, depth: 0.7, ticksPerPose: 1, restX: -3000, seed: 23 },
  { name: 'clasico', kind: 'classic', length: 430, dir: -1, laneFrom: 770, laneTo: 815, step: 3.5, pause: 14, start: 0.52, depth: 0.92, ticksPerPose: 2, restX: 1010, seed: 7 },
  { name: 'martillo', kind: 'hammerhead', length: 500, dir: 1, laneFrom: 250, laneTo: 205, step: 3, pause: 8, start: 0.24, depth: 1, ticksPerPose: 2, restX: 70, seed: 3 },
]

function sharkMover(spec: SharkSpec): Mover {
  const shape: Shape = SHAPES[spec.kind]
  const poses: string[] = []
  let box = { cols: 0, rows: 0 }
  for (let j = 0; j < POSES; j += 1) {
    const raster = rasterShark(shape, spec.length, (j / POSES) * Math.PI * 2, spec.dir, spec.seed)
    box = { cols: raster.cols, rows: raster.rows }
    const wake = wakeCells(raster.tail, spec.dir, spec.seed * 10 + j)
    poses.push(cellsSvg([...wake, ...raster.cells], spec.depth))
  }
  const width = box.cols * CW
  const height = box.rows * CH
  const wakeRoom = 16 * CW
  const offLeft = -(width + wakeRoom) - 40
  const offRight = VIEW_W + wakeRoom + 40
  const top = (lane: number): number => Math.round(lane - height / 2)
  return {
    name: spec.name,
    body: posesSvg(poses, spec.ticksPerPose),
    from: { x: spec.dir > 0 ? offLeft : offRight, y: top(spec.laneFrom) },
    to: { x: spec.dir > 0 ? offRight : offLeft, y: top(spec.laneTo) },
    step: spec.step,
    pauseTicks: Math.round(spec.pause / TICK),
    start: spec.start,
    rest: { x: spec.restX, y: top((spec.laneFrom + spec.laneTo) / 2) },
  }
}

// ── la escena completa ───────────────────────────────────────────────────

/**
 * El SVG del fondo. `ahorro` mueve todo a saltos de 1/8 s (se repinta como mucho 8 veces por segundo);
 * `fluido` desliza los animales de forma continua, a costa de repintar a la tasa de la pantalla.
 */
export function sharkScene(motion: Motion): string {
  // De más hondo a más cerca: lo que va después se pinta encima.
  const order = SHARKS.map(sharkMover)
  const style =
    `text{font:600 11px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;text-anchor:middle}` +
    `.b6{animation:b6 1s step-end infinite}@keyframes b6{0%{opacity:1}16.6667%,100%{opacity:0}}` +
    order.map(m => moverCss(m, motion)).join('') +
    `@media (prefers-reduced-motion:reduce){.m,.b6{animation:none!important}}`
  // Una rejilla de celdas casi invisible, como la del original, y un velo en la columna del chat.
  const defs =
    `<pattern id="rejilla" width="${CW}" height="${CH}" patternUnits="userSpaceOnUse">` +
    `<path d="M0 .5H${CW}M.5 0V${CH}" stroke="#ffffff" stroke-opacity=".03" fill="none"/></pattern>` +
    `<linearGradient id="velo" x1="0" x2="1" y1="0" y2="0">` +
    `<stop offset="0" stop-color="${BACKGROUND}" stop-opacity="0"/>` +
    `<stop offset=".24" stop-color="${BACKGROUND}" stop-opacity="0"/>` +
    `<stop offset=".38" stop-color="${BACKGROUND}" stop-opacity=".6"/>` +
    `<stop offset=".74" stop-color="${BACKGROUND}" stop-opacity=".6"/>` +
    `<stop offset=".88" stop-color="${BACKGROUND}" stop-opacity="0"/>` +
    `<stop offset="1" stop-color="${BACKGROUND}" stop-opacity="0"/></linearGradient>`
  const animals = order.map(m => `<g class="m ${m.name}">${m.body}</g>`).join('')
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW_W} ${VIEW_H}" width="100%" height="100%" preserveAspectRatio="xMidYMid slice">` +
    `<style>${style}</style><defs>${defs}</defs>` +
    `<rect x="-20" y="-20" width="${VIEW_W + 40}" height="${VIEW_H + 40}" fill="${BACKGROUND}"/>` +
    `<rect width="${VIEW_W}" height="${VIEW_H}" fill="url(#rejilla)"/>` +
    animals +
    `<rect width="${VIEW_W}" height="${VIEW_H}" fill="url(#velo)"/>` +
    `</svg>`
  )
}
