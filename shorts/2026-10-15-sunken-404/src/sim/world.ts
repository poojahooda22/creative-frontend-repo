// The aquarium's physics: the water, the digits and what the visitor does to them, stepped at a
// fixed rate. Sizes are in sim units: the view is HEIGHT tall and as wide as its aspect.
import { FlipFluid, latticeDensity, PACE, type Stir } from './flip'
import { Digit, digitAt, floatHeight, floatTrim, stepDigits } from './digits'
import { buildGlyphShape, type GlyphShape, type Mask } from './glyph'

export const HEIGHT = 3
/** The sand runs from behind the back plants (z = TANK_BACK) to the front glass (TANK_FRONT). */
export const TANK_BACK = -1.4
export const TANK_FRONT = 0.5
/** A digit's slab is this deep front to back, as a fraction of its height. */
export const DIGIT_DEPTH = 0.2
export const STEP = 1 / 60
/**
 * The drawn surface is SURFACE_ROWS rows of one value per grid column: the volume line, the top of
 * the water above it (Flip.top), and how much water lies above it (Flip.above). See displaySurface.
 */
export const SURFACE_ROWS = 3
/**
 * The particles' own surface, drawn above the volume line (Zhu and Bridson, SIGGRAPH 2005, section
 * 5): a weighted mean of the particles within SPLAT_RADIUS (in particle radii: twice the particle
 * spacing, as the paper recommends), less DROP_RADIUS (a particle's own radius, half the spacing:
 * the least the paper finds reliable). UNION_SMOOTH (in cells) is how wide the smooth union is that
 * joins it to the body: a crest or a sheet rises out of the body without a crease.
 */
export const SPLAT_RADIUS = 4
export const DROP_RADIUS = 1
export const UNION_SMOOTH = 0.25
/**
 * Still water is flat. At rest the particles' surface wanders a few pixels about the volume line,
 * and next to the digits sits up to a cell and a half above it (measured at 1440x900): numerical,
 * not water. So a particle within STILL_BAND cells above the drawn line, where the water moves
 * slower than STILL_SPEED (units/s of tank time, eased between the two), is drawn sunk under the
 * line (see drawnParticles). The band reaches past water resting on a digit's top, about two cells
 * above the line. Measured at 1440x900, the water's speed at particles near the line: 0.09 units/s
 * at rest (99.9th percentile 0.38); above the line, the slowest tenth moves at 1.0 while it is
 * stirred and the median at 1.2 in the second and a half after.
 */
export const STILL_SPEED = [0.4, 0.9] as const
export const STILL_BAND = [2.5, 3.5] as const
/** Below every surface: the splat pass drops a particle drawn here (see density.vert). */
const DROPPED_Y = -1
const GRAVITY = -9.81
/** At most this many steps per frame; a long stall drops time instead of spiralling. */
const MAX_STEPS = 3
const STIR_RADIUS = 0.45
/** The most of the hand's speed the water takes (units per second of tank time). */
const STIR_MAX_SPEED = 6
/** A shaken window: at most this much inertial acceleration on the water (sim units / s^2). */
const SHAKE_MAX = 40
/**
 * A tilted phone turns the tank's gravity, as in a glass held in the hand. Tilt the tank could not
 * hold (the water climbing out at the low wall, the high side running dry) is eased off: once
 * settled, the water rises at the walls by at most this fraction of its depth.
 */
const TILT_RISE = 0.3
const GRAB_SLACK = 0.06
/**
 * Mean kinetic energy per particle (tank units and time) below which the water counts as calm, and
 * above which it churns. Resting water still reads about 0.005 (particles jostle in the solver,
 * mostly gravity packing them between separation passes), so calm starts just above that.
 */
const CALM_BELOW = 0.006
const CHURN_ABOVE = 0.03
/**
 * FLIP blend: lively FLIP while the water moves, sliding toward PIC as it calms. PIC's averaging
 * is what lets resting water settle; FLIP's particle detail is what keeps a splash alive.
 * Measured with the digits' settling damping: open-water surface noise at rest 3.0 to 1.6 px.
 */
const FLIP_LIVELY = 0.9
const FLIP_CALM = 0.45
/**
 * The drawn surface is the simulated one filtered the same way whatever the water does: a
 * Gaussian across columns (sigma in grid columns) takes out the bumps a column of particles
 * forms, and each column follows its target as a critically damped spring whose frequency (rad/s)
 * rises with how far it trails its target (in grid columns), as the 1€ filter raises its cutoff
 * with speed (Casiez, Roussel and Vogel, 2012): at rest the particles' jostle (under a cell) is
 * filtered hard, while a wave a few cells high is followed at once. Measured on a hard drag at
 * 1440x900: at a fixed 25 rad/s the line trailed the water by up to 118 px, and the water above
 * the lagging line was drawn as a second layer of spray; at a fixed 300 it jittered 4.6 px a
 * frame. Filtering only once calm left still water slow to answer the cursor and churned water raw.
 */
const SURFACE_BLUR_SIGMA = 3
const SURFACE_FOLLOW = 10
const SURFACE_CATCH_UP = 3
const SURFACE_FOLLOW_MAX = 120
/**
 * Ripples: a fine wave layer on the drawn surface, finer than the particles can carry, which the
 * cursor sets going where it moves through or close over the water. It is a damped 1D wave
 * equation, the height-field water of three.js's webgl_gpgpu_water example and Evan Wallace's
 * WebGL Water, laid over the simulated surface; the physics does not feel it.
 * - Speed (units/s): a ripple crosses a third of a desktop view in about two seconds.
 * - Damping per 60 Hz step: a ripple fades over about a second and a half.
 * - The cursor reaches the surface from REACH_ABOVE over it to REACH_BELOW under it, strongest at
 *   the surface. Moving sideways it raises the water ahead and draws it down behind (a bow wave
 *   and its trough, which add up to no water); moving up or down it lifts or presses the surface.
 */
const RIPPLE_SPEED = 0.9
const RIPPLE_DAMPING = 0.98
const RIPPLE_RADIUS = 0.15
const RIPPLE_PUSH = 2.6
const RIPPLE_MAX = 0.08
const REACH_ABOVE = 0.12
const REACH_BELOW = 0.35
/**
 * A slow, gentle swell (two travelling waves) keeps still water alive without the physics feeling
 * it, the way the owner's fluid experiment sways its resting water in the vertex shader.
 * Wavelengths (sim units) and periods (s) are long and slow; the amplitude is about two CSS pixels
 * on a desktop.
 */
const SWELL_AMPLITUDE = 0.008
const SWELL: ReadonlyArray<{ wavelength: number; period: number; share: number; phase: number }> = [
  { wavelength: 2.4, period: 5.5, share: 1, phase: 0 },
  { wavelength: 1.3, period: -3.7, share: 0.5, phase: 1.7 },
]

export interface Layout {
  width: number
  height: number
  /** Rows of grid cells over the view height. */
  rows: number
  floorBase: number
  digitHeight: number
  waterLevel: number
}

/** Cells across the depth of the water: enough for waves and splashes to read at any size. */
const CELLS_DEEP = 28
/**
 * Cells across a digit's height the grid aims for, and the fewest it will take to stay within the
 * particle budget: the water only has to find the digit's outline in its cells (the digits are
 * open to it), not resolve its strokes as walls.
 */
const CELLS_PER_DIGIT = 13
export const MIN_CELLS_PER_DIGIT = 9
const MAX_ROWS = 200
const MIN_ROWS = 64
/** Space between digits, as a fraction of their height. */
const DIGIT_GAP = 0.2
/** Geist's digits at weight 560 are about 0.8 of their height wide (ink box). */
const DIGIT_ASPECT = 0.8
/** Width of "404" in digit heights. */
const SPAN = 3 * DIGIT_ASPECT + 2 * DIGIT_GAP

/**
 * The most particles the physics may run. A step costs about 0.65 ms per thousand particles on the
 * lab's desktop CPU (`pnpm bench`); phones run JavaScript several times slower, so the page asks for
 * fewer there, and the worker lowers the count again if its first steps still run slow.
 */
export const PARTICLE_BUDGET = { desktop: 10000, phone: 5500, least: 2500 } as const

/**
 * Sizes everything from the view's CSS size. As in the reference, the digits float just under the
 * surface, with their tops breaking it, in water about 1.4 digits deep: room below them for the
 * fish and the crabs. Wide views cap "404" at 28% of the height and half the width; tall views let
 * it take 78% of the width, which still leaves the solver a few cells of water at each wall, and
 * fill nearly half the screen with water so the tank is not a strip under empty page.
 *
 * The grid is as fine as the water's depth and the digits want, and no finer than the particle
 * budget pays for, but never coarser than MIN_CELLS_PER_DIGIT.
 */
export function layoutFor(cssWidth: number, cssHeight: number, budget: number = PARTICLE_BUDGET.desktop): Layout {
  const aspect = cssWidth / cssHeight
  const width = HEIGHT * aspect
  const tall = aspect < 1
  const floorBase = HEIGHT * 0.06
  const digitHeight = Math.min(HEIGHT * 0.28, (width * (tall ? 0.78 : 0.5)) / SPAN)
  const waterLevel = floorBase + Math.max(1.4 * digitHeight, HEIGHT * (tall ? 0.46 : 0.3))
  const depth = waterLevel - floorBase
  const strokes = (HEIGHT * CELLS_PER_DIGIT) / digitHeight
  const wanted = Math.max((HEIGHT * CELLS_DEEP) / depth, strokes)
  // The fill packs latticeDensity(h) particles per unit area: rows the budget affords.
  const affordable = HEIGHT * Math.sqrt(budget / (width * depth * latticeDensity(1)))
  const fewest = (HEIGHT * MIN_CELLS_PER_DIGIT) / digitHeight
  const rows = Math.round(Math.max(Math.min(MAX_ROWS, Math.max(MIN_ROWS, wanted), affordable), Math.min(MAX_ROWS, fewest)))
  return { width, height: HEIGHT, rows, floorBase, digitHeight, waterLevel }
}

const follower = { x: 0, v: 0 }
const stillSample = { x: 0, y: 0 }

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1)
  return t * t * (3 - 2 * t)
}

/**
 * One step of a critically damped spring (frequency w, rad/s) toward a target held over the step,
 * in closed form, so it is stable at any w dt. Stepped explicitly it diverged past w dt = 0.83:
 * in a hard stir the drawn surface grew needles, then overflowed into black bars across the page.
 */
export function springStep(s: { x: number; v: number }, target: number, w: number, dt: number): void {
  const e = s.x - target
  const c = s.v + w * e
  const fade = Math.exp(-w * dt)
  s.x = target + (e + c * dt) * fade
  s.v = (s.v - w * c * dt) * fade
}

/** Normalized Gaussian weights out to three sigma. */
function gaussianWeights(sigma: number): Float32Array {
  const r = Math.ceil(3 * sigma)
  const w = new Float32Array(2 * r + 1)
  let sum = 0
  for (let k = -r; k <= r; k++) {
    w[k + r] = Math.exp(-(k * k) / (2 * sigma * sigma))
    sum += w[k + r]
  }
  for (let k = 0; k < w.length; k++) w[k] /= sum
  return w
}

/** A gentle sand dune: the floor height at x. */
export function floorCurve(layout: Layout): (x: number) => number {
  const { floorBase, width } = layout
  return (x: number) => {
    const t = x / width
    return floorBase + 0.03 * Math.sin(t * 7.1 + 0.6) + 0.018 * Math.sin(t * 17.3 + 2.1) - 0.02 * Math.cos(t * Math.PI * 2)
  }
}

export interface PointerState {
  x: number
  y: number
  vx: number
  vy: number
  /** Inside the view and moving. */
  active: boolean
}

export class World {
  readonly layout: Layout
  readonly fluid: FlipFluid
  readonly digits: Digit[]
  /** Particle positions before the last step, for drawing between steps. */
  readonly prevPos: Float32Array
  /** 0..1: how far the drawn frame sits between the last two steps. */
  alpha = 0
  /** Smoothed: 1 when the water is still. */
  calm = 1
  time = 0
  /** Gravity's angle from straight down (rad), positive toward +x, as the tank holds it. */
  tilt = 0
  /** The most tilt this layout holds (rad); see TILT_RISE. */
  readonly maxTilt: number

  private accumulator = 0
  private readonly pointer: PointerState = { x: 0, y: 0, vx: 0, vy: 0, active: false }
  private readonly stir: Stir = { x: 0, y: 0, vx: 0, vy: 0, radius: STIR_RADIUS }
  private shakeX = 0
  private shakeY = 0
  private held: Digit | null = null

  constructor(layout: Layout, masks: ReadonlyMap<string, Mask>, chars: readonly string[]) {
    this.layout = layout
    this.maxTilt = Math.atan((TILT_RISE * (layout.waterLevel - layout.floorBase)) / (layout.width / 2))
    const floor = floorCurve(layout)
    const cellSize = layout.height / layout.rows
    // Enough room for the water plus a margin; the fill decides the real count.
    const waterArea = layout.width * (layout.waterLevel - layout.floorBase + 0.1)
    this.fluid = new FlipFluid({
      width: layout.width,
      height: layout.height,
      cellSize,
      floor,
      maxParticles: Math.ceil(waterArea * latticeDensity(cellSize) * 1.15),
    })

    // Digits float at the centre, spaced by their own ink widths, starting at rest where they float.
    const shapes = new Map<string, GlyphShape>()
    for (const c of new Set(chars)) {
      const mask = masks.get(c)
      if (!mask) throw new Error(`World: no mask for "${c}"`)
      shapes.set(c, buildGlyphShape(mask, layout.digitHeight))
    }
    const shapeOf = (c: string): GlyphShape => {
      const s = shapes.get(c)
      if (!s) throw new Error(`World: no shape for "${c}"`)
      return s
    }
    const gap = layout.digitHeight * DIGIT_GAP
    const widths = chars.map((c) => shapeOf(c).maxX - shapeOf(c).minX)
    const total = widths.reduce((a, b) => a + b, 0) + gap * (chars.length - 1)
    let cursor = (layout.width - total) / 2
    this.digits = chars.map((c, i) => {
      const s = shapeOf(c)
      const x = cursor - s.minX
      cursor += widths[i] + gap
      const d = new Digit(c, s, x, 0)
      d.y = d.homeY = floatHeight(s, d.mass, layout.waterLevel)
      d.trim = floatTrim(s, d.y, layout.waterLevel)
      d.updateTransform()
      return d
    })

    this.fluid.fill(layout.waterLevel, this.digits)
    this.prevPos = new Float32Array(this.fluid.pos.length)
    this.ripple = new Float32Array(this.fluid.nX)
    this.rippleSpeed = new Float32Array(this.fluid.nX)
    this.prevPos.set(this.fluid.pos)
  }

  /**
   * Steps to the current moment; physics runs at a fixed 60 Hz whatever the display does.
   * `beforeStep` runs ahead of each step (the worker records the digits' poses for drawing between
   * steps). Returns the number of steps taken.
   */
  advance(delta: number, beforeStep?: () => void): number {
    // The tank's clock runs PACE times faster than the page's (see PACE).
    this.accumulator += Math.min(delta * PACE, MAX_STEPS * STEP)
    let steps = 0
    while (this.accumulator >= STEP && steps < MAX_STEPS) {
      beforeStep?.()
      this.step()
      this.accumulator -= STEP
      steps++
    }
    this.alpha = this.accumulator / STEP
    return steps
  }

  /** Runs the physics without drawing, so a page that starts still shows settled water. */
  settle(seconds: number): void {
    const steps = Math.round(seconds / STEP)
    for (let i = 0; i < steps; i++) this.step()
    this.prevPos.set(this.fluid.pos)
    this.alpha = 0
  }

  private readonly blurWeights = gaussianWeights(SURFACE_BLUR_SIGMA)
  /** The drawn rows (see SURFACE_ROWS) and their rates of change, followed per column. */
  private drawn: Float32Array | null = null
  private drawnSpeed: Float32Array | null = null
  private drawnTime = 0
  /** The ripple layer, per grid column: height (units) and its rate of change (units/s). */
  private readonly ripple: Float32Array
  private readonly rippleSpeed: Float32Array

  /** One step of the ripple layer: the cursor's push, then the wave equation (see RIPPLE_SPEED). */
  private stepRipples(): void {
    const f = this.fluid
    const n = f.nX
    const h = f.h
    const r = this.ripple
    const v = this.rippleSpeed
    const p = this.pointer
    if (p.active && !this.held) {
      const above = p.y - f.surfaceAt(p.x)
      const reach = above > 0 ? 1 - above / REACH_ABOVE : 1 + above / REACH_BELOW
      const speed = Math.hypot(p.vx, p.vy)
      if (reach > 0 && speed > 0.05) {
        // The hand's speed in tank time (the tank's clock runs PACE times faster), capped.
        const k = Math.min(1 / PACE, STIR_MAX_SPEED / speed)
        const vx = p.vx * k
        const vy = p.vy * k
        const i0 = Math.max(1, Math.floor((p.x - RIPPLE_RADIUS) / h))
        const i1 = Math.min(n - 2, Math.ceil((p.x + RIPPLE_RADIUS) / h))
        for (let i = i0; i <= i1; i++) {
          const d = ((i + 0.5) * h - p.x) / RIPPLE_RADIUS
          if (d <= -1 || d >= 1) continue
          // Ahead up and behind down (sin), and the whole patch with a vertical push (raised cosine).
          const push = Math.sin(Math.PI * d) * vx + 0.5 * (1 + Math.cos(Math.PI * d)) * vy
          v[i] += RIPPLE_PUSH * reach * push * STEP
        }
      }
    }
    const c2 = (RIPPLE_SPEED * RIPPLE_SPEED) / (h * h)
    let mean = 0
    for (let i = 1; i < n - 1; i++) {
      // The glass reflects: each wall column mirrors its neighbour.
      const left = i > 1 ? r[i - 1] : r[i]
      const right = i < n - 2 ? r[i + 1] : r[i]
      v[i] = (v[i] + c2 * (left - 2 * r[i] + right) * STEP) * RIPPLE_DAMPING
    }
    for (let i = 1; i < n - 1; i++) {
      r[i] = Math.max(-RIPPLE_MAX, Math.min(RIPPLE_MAX, r[i] + v[i] * STEP))
      mean += r[i]
    }
    // A push that is not quite balanced must not raise or sink the water over time.
    mean /= n - 2
    for (let i = 1; i < n - 1; i++) r[i] -= mean * 0.05
    r[0] = r[1]
    r[n - 1] = r[n - 2]
  }

  /**
   * The surface to draw, SURFACE_ROWS rows of `out`: the volume line, the top of the water above
   * it and how much water lies above it, each filtered in space and time (see SURFACE_FOLLOW). The
   * line and the top carry the ripples and a gentle swell in proportion to how calm the water is.
   * The physics keeps the raw surface.
   */
  displaySurface(out: Float32Array): void {
    const f = this.fluid
    const n = f.surface.length
    const h = f.h
    const calm = this.calm
    let first = false
    if (!this.drawn || !this.drawnSpeed || this.drawn.length !== SURFACE_ROWS * n) {
      this.drawn = new Float32Array(SURFACE_ROWS * n)
      this.drawnSpeed = new Float32Array(SURFACE_ROWS * n)
      first = true
    }
    // The spring advances in steps no longer than the physics step, so it stays stable.
    const elapsed = first ? 0 : Math.max(0, this.time - this.drawnTime)
    const substeps = Math.ceil(elapsed / STEP - 1e-6)
    const dt = substeps > 0 ? elapsed / substeps : 0
    this.drawnTime = this.time
    const rows = [f.surface, f.top, f.above]
    for (let k = 0; k < SURFACE_ROWS; k++) {
      this.followLine(rows[k], this.drawn.subarray(k * n, (k + 1) * n), this.drawnSpeed.subarray(k * n, (k + 1) * n), first, substeps, dt)
    }
    for (let i = 0; i < n; i++) {
      const x = (i + 0.5) * h
      let swell = 0
      for (const s of SWELL) swell += s.share * Math.sin((2 * Math.PI * x) / s.wavelength - (2 * Math.PI * this.time) / s.period + s.phase)
      const lift = this.ripple[i] + SWELL_AMPLITUDE * calm * swell
      out[i] = this.drawn[i] + lift
      out[n + i] = Math.max(this.drawn[n + i] + lift, out[i])
      out[2 * n + i] = Math.max(this.drawn[2 * n + i], 0)
    }
  }

  /** Each column of `drawn` follows the Gaussian-blurred `src` as a critically damped spring (see SURFACE_FOLLOW). */
  private followLine(src: Float32Array, drawn: Float32Array, speed: Float32Array, first: boolean, substeps: number, dt: number): void {
    const n = src.length
    const w = this.blurWeights
    const r = (w.length - 1) / 2
    const h = this.fluid.h
    const omega = SURFACE_FOLLOW
    for (let i = 0; i < n; i++) {
      let target = 0
      for (let k = -r; k <= r; k++) target += w[k + r] * src[Math.min(n - 1, Math.max(0, i + k))]
      if (first) {
        drawn[i] = target
        continue
      }
      for (let s = 0; s < substeps; s++) {
        // Faster the further behind it falls (see SURFACE_FOLLOW), so it never trails moving water.
        const behind = Math.abs(target - drawn[i]) / h
        follower.x = drawn[i]
        follower.v = speed[i]
        springStep(follower, target, Math.min(SURFACE_FOLLOW_MAX, omega * (1 + SURFACE_CATCH_UP * behind)), dt)
        drawn[i] = follower.x
        speed[i] = follower.v
      }
    }
  }

  /**
   * The particle positions to draw, now and before the last step (x, y pairs), under the drawn
   * surface `drawn` (see displaySurface).
   *
   * A particle inside a digit is dropped. The part of a digit standing out of the water is open to
   * the grid, so drops fall through a lifted digit, and one can come to rest there: in the tank
   * that would be water inside the digit.
   *
   * Still water is flat (see STILL_SPEED): a particle near the line, where the water moves slower
   * than a stir, is drawn sunk under the line by as much as the water there is still, down to where
   * a resting layer's own surface (Zhu and Bridson's, see composite.frag) lies more than the smooth
   * union's width under the line, so the union is the line exactly. The particles' jostle and their
   * biases against the line never reach still water, and settling water sinks into the line whole
   * rather than thinning away. Moving water and water clear of the line keep every particle.
   */
  drawnParticles(drawn: Float32Array, pos: Float32Array, prev: Float32Array): void {
    const f = this.fluid
    const n = f.numParticles
    const columns = f.nX
    const h = f.h
    pos.set(f.pos.subarray(0, 2 * n))
    prev.set(this.prevPos.subarray(0, 2 * n))
    const deep = 2 * DROP_RADIUS * f.particleRadius + UNION_SMOOTH * h
    const low = STILL_BAND[0] * h
    const high = STILL_BAND[1] * h
    for (let i = 0; i < n; i++) {
      const x = pos[2 * i]
      const y = pos[2 * i + 1]
      let inside = false
      for (const d of this.digits) {
        if (x >= d.minX && x <= d.maxX && y >= d.minY && y <= d.maxY && d.distance(x, y) < 0) {
          inside = true
          break
        }
      }
      if (inside) {
        pos[2 * i + 1] = DROPPED_Y
        prev[2 * i + 1] = DROPPED_Y
        continue
      }
      const g = Math.min(Math.max(x / h - 0.5, 0), columns - 1.001)
      const c = Math.floor(g)
      const line = drawn[c] + (drawn[c + 1] - drawn[c]) * (g - c)
      const floor = line - deep
      if (y <= floor || y >= line + high) continue
      f.velocityAt(x, y, stillSample)
      const still = (1 - smoothstep(STILL_SPEED[0], STILL_SPEED[1], Math.hypot(stillSample.x, stillSample.y))) * (1 - smoothstep(low, high, y - line))
      if (still <= 0) continue
      const sink = still * (y - floor)
      pos[2 * i + 1] -= sink
      prev[2 * i + 1] -= sink
    }
  }

  /** Mean kinetic energy per particle over the last step, from real displacement. */
  agitation = 0

  private step(): void {
    this.prevPos.set(this.fluid.pos)
    const p = this.pointer
    let stir: Stir | null = null
    if (p.active && !this.held) {
      const speed = Math.hypot(p.vx, p.vy)
      if (speed > 0.05) {
        // The hand's speed in tank time (the tank's clock runs PACE times faster), capped.
        const k = Math.min(1 / PACE, STIR_MAX_SPEED / speed)
        this.stir.x = p.x
        this.stir.y = p.y
        this.stir.vx = p.vx * k
        this.stir.vy = p.vy * k
        stir = this.stir
      }
    }

    // The shake decays: it is the window's acceleration, felt for a moment.
    const ax = this.shakeX
    const ay = this.shakeY
    this.shakeX *= 0.6
    this.shakeY *= 0.6
    // A tilt turns gravity; its sideways part acts like a steady shake.
    const gravity = GRAVITY * Math.cos(this.tilt)
    const sideways = -GRAVITY * Math.sin(this.tilt)

    stepDigits(this.digits, this.fluid, {
      dt: STEP,
      gravity,
      accelX: ax + sideways,
      accelY: ay,
      upright: this.tilt,
      calm: this.calm,
      width: this.layout.width,
      height: this.layout.height,
      wall: this.fluid.h,
    })
    this.fluid.step({
      dt: STEP,
      gravity,
      accelX: ax + sideways,
      accelY: ay,
      colliders: this.digits,
      stir,
      pressureIters: 40,
      flipRatio: FLIP_LIVELY + (FLIP_CALM - FLIP_LIVELY) * this.calm,
      separationIters: 2,
    })

    // Calm returns slowly after a stir, so the digits do not snap home mid-wave.
    const agitation = this.fluid.agitation(this.prevPos, STEP)
    this.agitation = agitation
    const target = agitation < CALM_BELOW ? 1 : agitation > CHURN_ABOVE ? 0 : 1 - (agitation - CALM_BELOW) / (CHURN_ABOVE - CALM_BELOW)
    this.calm += (target - this.calm) * (target > this.calm ? 0.01 : 0.2)
    this.stepRipples()
    this.time += STEP
  }

  /** The pointer in sim units, with its velocity. Grabs a digit on press if one is under it. */
  setPointer(x: number, y: number, vx: number, vy: number, active: boolean): void {
    const p = this.pointer
    p.x = x
    p.y = y
    p.vx = vx
    p.vy = vy
    p.active = active
    if (this.held?.grab) {
      this.held.grab.tx = x
      this.held.grab.ty = y
    }
  }

  /** Returns true if the press picked up a digit. */
  press(x: number, y: number): boolean {
    const d = digitAt(this.digits, x, y, GRAB_SLACK)
    if (!d) return false
    const local = { x: 0, y: 0 }
    d.toLocal(x, y, local)
    d.grab = { lx: local.x, ly: local.y, tx: x, ty: y, angle: d.angle }
    this.held = d
    return true
  }

  release(): void {
    if (this.held) this.held.grab = null
    this.held = null
  }

  get holding(): boolean {
    return this.held !== null
  }

  /** True if a digit sits under the point: the cursor turns into a hand there. */
  hoversDigit(x: number, y: number): boolean {
    return digitAt(this.digits, x, y, GRAB_SLACK) !== null
  }

  /**
   * The phone's tilt: gravity's angle from straight down (rad), positive toward +x. Small tilts
   * pass as they are; larger ones ease toward the most this layout holds.
   */
  setTilt(angle: number): void {
    this.tilt = this.maxTilt * Math.tanh(angle / this.maxTilt)
  }

  /** The window moved: its acceleration (sim units / s^2) sloshes everything the other way. */
  shake(ax: number, ay: number): void {
    // Measured in the page's time; in the tank's, which runs PACE times faster, it is PACE^2 smaller.
    const len = Math.hypot(ax, ay) / (PACE * PACE)
    const k = (len > SHAKE_MAX ? SHAKE_MAX / len : 1) / (PACE * PACE)
    this.shakeX -= ax * k
    this.shakeY -= ay * k
  }
}
