// The physics worker: owns the World, steps it when the page asks, and answers with a snapshot.
import { PARTICLE_BUDGET, STEP, SURFACE_ROWS, World, layoutFor } from './world'
import { PACE } from './flip'
import { FLOW_COLUMNS, FLOW_ROWS, type FromWorker, type InitMessage, type StateMessage, type ToWorker } from './protocol'
import type { GlyphShape } from './glyph'

let world: World | null = null
let pressed = 0
const pool: ArrayBuffer[] = []

/** A Float32Array of `length`, reusing a buffer the page handed back when one is big enough. */
function take(length: number): Float32Array<ArrayBuffer> {
  const bytes = length * 4
  for (let i = 0; i < pool.length; i++) {
    if (pool[i].byteLength === bytes) return new Float32Array(pool.splice(i, 1)[0])
  }
  return new Float32Array(length)
}

const digitsBefore = new Float32Array(9)
const flowSample = { x: 0, y: 0 }

function snapshot(wd: World, stepMs: number, steps: number): StateMessage {
  const f = wd.fluid
  const n = f.numParticles
  const surface = take(SURFACE_ROWS * f.nX)
  wd.displaySurface(surface)
  const pos = take(2 * n)
  const prev = take(2 * n)
  wd.drawnParticles(surface, pos, prev)
  const digits = take(3 * wd.digits.length)
  wd.digits.forEach((d, i) => {
    digits[3 * i] = d.x
    digits[3 * i + 1] = d.y
    digits[3 * i + 2] = d.angle
  })
  const digitsPrev = take(3 * wd.digits.length)
  digitsPrev.set(digitsBefore.subarray(0, 3 * wd.digits.length))
  // Water velocity over the tank, from the floor to a little above the water line.
  const flow = take(2 * FLOW_COLUMNS * FLOW_ROWS)
  const L = wd.layout
  const top = L.waterLevel + 0.3
  for (let r = 0; r < FLOW_ROWS; r++) {
    const y = L.floorBase + ((r + 0.5) / FLOW_ROWS) * (top - L.floorBase)
    for (let c = 0; c < FLOW_COLUMNS; c++) {
      const x = ((c + 0.5) / FLOW_COLUMNS) * L.width
      const wet = f.surfaceAt(x) > y
      if (wet) f.velocityAt(x, y, flowSample)
      // In the page's time: the tank's clock runs PACE times faster.
      flow[2 * (r * FLOW_COLUMNS + c)] = wet ? flowSample.x * PACE : 0
      flow[2 * (r * FLOW_COLUMNS + c) + 1] = wet ? flowSample.y * PACE : 0
    }
  }
  return {
    type: 'state',
    count: n,
    pos,
    prev,
    alpha: wd.alpha,
    digits,
    digitsPrev,
    surface,
    flow,
    holding: wd.holding,
    pressed,
    tilt: wd.tilt,
    calm: wd.calm,
    agitation: wd.agitation,
    stepMs,
    steps,
  }
}

function send(message: FromWorker, transfer: Transferable[]): void {
  postMessage(message, transfer)
}

/** Steps run before timing (the JIT optimizes the solver's loops in the first few), then steps timed. */
const WARM_STEPS = 10
const TIMED_STEPS = 20
/**
 * A frame of physics (PACE steps) slower than this (ms) would keep this thread busy more than half
 * of every 60 Hz frame, with no room left when the device heats up and slows: the tank is built
 * again smaller.
 */
const SLOW_FRAME_MS = 9

/** A world for the page's view within the budget, announced at once so the page can build its meshes and compile their shaders while the water settles. */
function build(m: InitMessage, budget: number): World {
  const layout = layoutFor(m.cssWidth, m.cssHeight, budget)
  const wd = new World(layout, new Map(m.masks), m.chars)
  const shapes = new Map<string, GlyphShape>()
  for (const d of wd.digits) shapes.set(d.char, d.shape)
  send(
    {
      type: 'ready',
      layout,
      chars: m.chars,
      shapes: [...shapes],
      gridColumns: wd.fluid.nX,
      cell: wd.fluid.h,
      particleRadius: wd.fluid.particleRadius,
      maxParticles: wd.fluid.maxParticles,
      budget,
    },
    [],
  )
  return wd
}

function transfers(s: StateMessage): Transferable[] {
  return [s.pos.buffer, s.prev.buffer, s.digits.buffer, s.digitsPrev.buffer, s.surface.buffer, s.flow.buffer]
}

self.onmessage = (event: MessageEvent<ToWorker>) => {
  const m = event.data
  switch (m.type) {
    case 'init': {
      // Buffers handed back from an earlier layout are the wrong sizes now.
      pool.length = 0
      let wd = build(m, m.budget)
      if (m.settle > 0) {
        // Time a few steps once the JIT has warmed up. Too slow for this device: build again with
        // fewer particles before the first frame, rather than run the water in slow motion.
        wd.settle(WARM_STEPS * STEP)
        const start = performance.now()
        wd.settle(TIMED_STEPS * STEP)
        const frameMs = (PACE * (performance.now() - start)) / TIMED_STEPS
        const smaller = Math.max(PARTICLE_BUDGET.least, Math.floor(m.budget * (SLOW_FRAME_MS / frameMs) * 0.9))
        // A tank whose grid the digits' strokes already set has nothing to give back.
        if (frameMs > SLOW_FRAME_MS && layoutFor(m.cssWidth, m.cssHeight, smaller).rows < wd.layout.rows) {
          wd = build(m, smaller)
          wd.settle(m.settle)
        } else {
          wd.settle(Math.max(0, m.settle - (WARM_STEPS + TIMED_STEPS) * STEP))
        }
      }
      world = wd
      world.digits.forEach((d, i) => {
        digitsBefore[3 * i] = d.x
        digitsBefore[3 * i + 1] = d.y
        digitsBefore[3 * i + 2] = d.angle
      })
      const s = snapshot(world, 0, 0)
      send(s, transfers(s))
      break
    }
    case 'frame': {
      if (!world) return
      for (const b of m.recycle) if (pool.length < 24) pool.push(b)
      const wd = world
      wd.setPointer(m.pointer.x, m.pointer.y, m.pointer.vx, m.pointer.vy, m.pointer.active)
      if (m.shake.ax !== 0 || m.shake.ay !== 0) wd.shake(m.shake.ax, m.shake.ay)
      wd.setTilt(m.tilt)
      const start = performance.now()
      const steps = wd.advance(m.delta, () => {
        wd.digits.forEach((d, i) => {
          digitsBefore[3 * i] = d.x
          digitsBefore[3 * i + 1] = d.y
          digitsBefore[3 * i + 2] = d.angle
        })
      })
      const s = snapshot(wd, performance.now() - start, steps)
      send(s, transfers(s))
      break
    }
    case 'press':
      world?.press(m.x, m.y)
      pressed = m.id
      break
    case 'release':
      world?.release()
      break
  }
}
