import { describe, expect, it } from 'vitest'
import { DROP_RADIUS, layoutFor, MIN_CELLS_PER_DIGIT, PARTICLE_BUDGET, SPLAT_RADIUS, springStep, STILL_SPEED, SURFACE_ROWS, UNION_SMOOTH, World } from './world'
import { geistMasks } from './testing'

// The page's real digits, so the floating tests see the 4's lopsided stem and the 0's counter.
const masks = geistMasks()

function world(w = 1920, h = 1080): World {
  return new World(layoutFor(w, h), masks, ['4', '0', '4'])
}

function meanSurface(wd: World): number {
  let s = 0
  const n = wd.fluid.nX - 2
  for (let i = 1; i <= n; i++) s += wd.fluid.surface[i]
  return s / n
}

function finite(a: Float32Array, count: number): boolean {
  for (let i = 0; i < count; i++) if (!Number.isFinite(a[i])) return false
  return true
}

describe('World', () => {
  it('lays out a landscape view with the digits side by side in the water', () => {
    const wd = world()
    const { layout } = wd
    expect(layout.width).toBeCloseTo((3 * 1920) / 1080, 5)
    expect(wd.fluid.numParticles).toBeGreaterThan(5000)
    // A few cells of water between the outer digits and the walls.
    for (const d of wd.digits) {
      expect(d.minX).toBeGreaterThan(3 * wd.fluid.h)
      expect(d.maxX).toBeLessThan(layout.width - 3 * wd.fluid.h)
    }
    // Left to right.
    expect(wd.digits[0].x).toBeLessThan(wd.digits[1].x)
    expect(wd.digits[1].x).toBeLessThan(wd.digits[2].x)
  })

  // A phone gets a smaller budget than a desktop; the grid coarsens to fit it, except that the
  // grid never gets coarser than MIN_CELLS_PER_DIGIT, which wins over the budget.
  it('keeps to its particle budget at every size, without a grid coarser than the digits need', () => {
    const sizes: Array<[number, number, number]> = [
      [390, 844, PARTICLE_BUDGET.phone],
      [844, 390, PARTICLE_BUDGET.phone],
      [768, 1024, PARTICLE_BUDGET.phone],
      [1440, 900, PARTICLE_BUDGET.desktop],
      [3440, 1440, PARTICLE_BUDGET.desktop],
      [844, 390, PARTICLE_BUDGET.least],
    ]
    for (const [w, h, budget] of sizes) {
      const layout = layoutFor(w, h, budget)
      const wd = new World(layout, masks, ['4', '0', '4'])
      const fewest = (layout.height * MIN_CELLS_PER_DIGIT) / layout.digitHeight
      expect(layout.rows).toBeGreaterThanOrEqual(Math.floor(fewest))
      if (layout.rows > Math.ceil(fewest)) expect(wd.fluid.numParticles).toBeLessThanOrEqual(budget)
    }
    // A portrait phone, where the digits once held the grid fine, keeps to its budget too.
    expect(new World(layoutFor(390, 844, PARTICLE_BUDGET.phone), masks, ['4', '0', '4']).fluid.numParticles).toBeLessThanOrEqual(PARTICLE_BUDGET.phone)
    // A budget the digits allow is spent, not wasted: the landscape phone has more water than its desktop-sized grid would leave.
    const phone = new World(layoutFor(844, 390, PARTICLE_BUDGET.phone), masks, ['4', '0', '4'])
    expect(phone.fluid.numParticles).toBeGreaterThan(0.6 * PARTICLE_BUDGET.phone)
  })

  it('keeps its water: volume, particles and digits stay finite and in the tank while settling', () => {
    const wd = world()
    wd.settle(1)
    const start = meanSurface(wd)
    wd.settle(4)
    const f = wd.fluid
    expect(finite(f.pos, 2 * f.numParticles)).toBe(true)
    expect(finite(f.vel, 2 * f.numParticles)).toBe(true)
    // The mean surface holds within 3% once settled: the drift compensation conserves volume.
    expect(Math.abs(meanSurface(wd) - start) / start).toBeLessThan(0.03)
    for (let i = 0; i < f.numParticles; i++) {
      const x = f.pos[2 * i]
      const y = f.pos[2 * i + 1]
      expect(x).toBeGreaterThan(0)
      expect(x).toBeLessThan(wd.layout.width)
      expect(y).toBeGreaterThanOrEqual(f.floorHeight(x) - 1e-6)
    }
    for (const d of wd.digits) {
      expect(Number.isFinite(d.x + d.y + d.angle)).toBe(true)
      // Upright and close to home.
      expect(Math.abs(d.angle)).toBeLessThan(0.25)
      expect(Math.abs(d.x - d.homeX)).toBeLessThan(0.2 * wd.layout.digitHeight)
    }
  })

  // The 4 carries more of itself above the water on its right (stem and apex), so it is lifted
  // off-centre; untrimmed, both 4s rested about 0.1 rad clockwise.
  it('floats every digit level at rest, at desktop and phone sizes', () => {
    for (const [w, h] of [[1440, 900], [390, 844]]) {
      const wd = world(w, h)
      wd.settle(4)
      for (const a of watch(wd, 2).angles) expect(Math.abs(a)).toBeLessThan(0.04)
    }
  })

  // Left alone, the water should look still: the drawn surface barely moves from frame to frame
  // and carries no small bumps, while the gentle swell stays smooth. In CSS px at 1440x900.
  it('draws still water at rest: little jitter, no bumps', () => {
    const wd = world(1440, 900)
    wd.settle(4)
    const n = wd.fluid.nX
    const px = 900 / wd.layout.height
    const now = new Float32Array(SURFACE_ROWS * n)
    const before = new Float32Array(SURFACE_ROWS * n)
    wd.displaySurface(before)
    let jitter = 0
    let bumps = 0
    let count = 0
    for (let step = 0; step < 240; step++) {
      wd.advance(1 / 60)
      wd.displaySurface(now)
      for (let i = 2; i < n - 2; i++) {
        jitter += (now[i] - before[i]) ** 2
        bumps += (now[i + 1] - 2 * now[i] + now[i - 1]) ** 2
        count++
      }
      before.set(now)
    }
    expect(wd.calm).toBeGreaterThan(0.8)
    expect(Math.sqrt(jitter / count) * px).toBeLessThan(0.3)
    expect(Math.sqrt(bumps / count) * px).toBeLessThan(0.25)
  })

  it('survives being stirred hard and shaken, and settles back', () => {
    const wd = world()
    wd.settle(1)
    const level = meanSurface(wd)
    for (let i = 0; i < 180; i++) {
      const t = i / 60
      const x = wd.layout.width * (0.5 + 0.4 * Math.sin(t * 4))
      wd.setPointer(x, wd.layout.waterLevel * 0.6, 4 * Math.cos(t * 4) * wd.layout.width * 0.4, 0, true)
      if (i % 20 === 0) wd.shake(i % 40 === 0 ? 30 : -30, 0)
      wd.advance(1 / 60)
    }
    wd.setPointer(0, 0, 0, 0, false)
    const f = wd.fluid
    expect(finite(f.pos, 2 * f.numParticles)).toBe(true)
    wd.settle(6)
    // Stirred water stays a little aerated and compacts back slowly (drift correction removes
    // compression, not expansion), so it may sit a few percent high: never more than 8.
    expect(Math.abs(meanSurface(wd) - level) / level).toBeLessThan(0.08)
    for (const d of wd.digits) expect(Number.isFinite(d.x + d.y + d.angle)).toBe(true)
  }, 30000)

  /** The surface's slope (rad) by least squares, clear of the walls. */
  function surfaceTilt(wd: World): number {
    const f = wd.fluid
    let sx = 0
    let sy = 0
    let sxx = 0
    let sxy = 0
    let n = 0
    for (let i = 3; i < f.nX - 3; i++) {
      const x = (i + 0.5) * f.h
      const y = f.surface[i]
      sx += x
      sy += y
      sxx += x * x
      sxy += x * y
      n++
    }
    return Math.atan((n * sxy - sx * sy) / (n * sxx - sx * sx))
  }

  interface Watch {
    /** The surface's slope (rad): mean over the window, and its swing from lowest to highest. */
    tilt: number
    swing: number
    /** Each digit's mean angle over the window. */
    angles: number[]
    /** The lowest surface at the high wall and the highest at the low wall. */
    highWall: number
    lowWall: number
  }

  /** Settles for `seconds` while watching: the water sloshes, so one moment says little. */
  function watch(wd: World, seconds: number): Watch {
    const f = wd.fluid
    const frames = Math.round(seconds * 15)
    const angles = wd.digits.map(() => 0)
    let sum = 0
    let low = Infinity
    let high = -Infinity
    let highWall = Infinity
    let lowWall = -Infinity
    for (let k = 0; k < frames; k++) {
      wd.settle(1 / 15)
      const t = surfaceTilt(wd)
      sum += t
      low = Math.min(low, t)
      high = Math.max(high, t)
      highWall = Math.min(highWall, f.surface[2])
      lowWall = Math.max(lowWall, f.surface[f.nX - 3])
      wd.digits.forEach((d, i) => (angles[i] += d.angle / frames))
    }
    return { tilt: sum / frames, swing: high - low, angles, highWall, lowWall }
  }

  // A phone tilted to the right, in portrait: the water runs right and settles level with the
  // world, the digits float level with it, and once the phone is upright again so is the water.
  // Water sloshes for a while, as it does in a real tank, so the checks average over seconds.
  it('tilts with the phone: the water runs to the low side, the digits float level, and both come back', () => {
    const wd = world(390, 844)
    wd.settle(2)
    const level = meanSurface(wd)
    // An asymmetric glyph lists a little at rest; the tilt is measured from there.
    const rest = watch(wd, 2).angles
    wd.setTilt(0.4)
    // Passed through, eased a little toward the most this tank holds.
    expect(wd.tilt).toBeGreaterThan(0.3)
    expect(wd.tilt).toBeLessThan(wd.maxTilt)
    const early = watch(wd, 4)
    const tilted = watch(wd, 4)
    expect(Math.abs(tilted.tilt - wd.tilt)).toBeLessThan(0.05)
    expect(tilted.swing).toBeLessThan(early.swing)
    // Water stands at the high wall all along, and never climbs near the top at the low one.
    const depth = wd.layout.waterLevel - wd.layout.floorBase
    expect(Math.min(early.highWall, tilted.highWall) - wd.layout.floorBase).toBeGreaterThan(0.3 * depth)
    expect(Math.max(early.lowWall, tilted.lowWall)).toBeLessThan(wd.layout.height - 0.3)
    tilted.angles.forEach((a, i) => expect(Math.abs(a - rest[i] - wd.tilt)).toBeLessThan(0.06))

    wd.setTilt(0)
    wd.settle(6)
    const back = watch(wd, 4)
    expect(Math.abs(back.tilt)).toBeLessThan(0.02)
    expect(back.swing).toBeLessThan(0.1)
    expect(Math.abs(meanSurface(wd) - level) / level).toBeLessThan(0.05)
    back.angles.forEach((a, i) => expect(Math.abs(a - rest[i])).toBeLessThan(0.05))
    for (const d of wd.digits) expect(Math.abs(d.x - d.homeX)).toBeLessThan(0.2 * wd.layout.digitHeight)
  }, 60000)

  it('holds a landscape tank to a gentler tilt, so the water never leaves its high wall', () => {
    const wd = world(844, 390)
    wd.setTilt(0.6)
    expect(wd.tilt).toBeLessThan(wd.maxTilt)
    // The water rises at most 30% of its depth at either wall once settled.
    const rise = (Math.tan(wd.maxTilt) * wd.layout.width) / 2
    expect(rise / (wd.layout.waterLevel - wd.layout.floorBase)).toBeCloseTo(0.3, 5)
  })

  /** Grabs the middle digit by its ink: its centre of mass sits in the 0's counter. */
  function grabMiddle(wd: World): boolean {
    const d = wd.digits[1]
    const k = d.shape.interiorInk.indexOf(1)
    const grip = { x: 0, y: 0 }
    d.toWorld(d.shape.interior[2 * k], d.shape.interior[2 * k + 1], grip)
    return wd.press(grip.x, grip.y)
  }

  // A visitor drags the 0 hard through the water in a loop, in and out of it, at 4 units/s, then
  // lets go. The drawn water must hold no more water than the tank has, stay under the top of the
  // view, keep nearly all its particles in one body rather than a second layer of spray, and move
  // coherently from frame to frame: a column's motion may accelerate, as a wave's does, but it must
  // not reverse every frame (the saw-tooth a visitor reads as jitter; 1% of moves here, against 8%
  // in the reference's own water at 60 fps). Before the surface was drawn from the water's volume,
  // the same drag drew 1.48 times the water, reached the top of the view and jittered 17.5 px a
  // frame. The digits are solid to the water, as in the reference, whose water reaches the top of
  // its window in a hard drag; ours reaches 72 to 80% of the view and throws 3 to 4% of its
  // particles clear, with one re-entry in ten throwing more.
  it('stays one smooth, honest body of water while a digit is dragged hard through it', () => {
    const wd = world(1440, 900)
    wd.settle(3)
    const L = wd.layout
    const f = wd.fluid
    const n = f.nX
    const px = 900 / L.height
    const rest = new Float32Array(SURFACE_ROWS * n)
    wd.displaySurface(rest)
    let restArea = 0
    for (let i = 1; i < n - 1; i++) restArea += rest[i] - f.floorHeight((i + 0.5) * f.h)
    expect(grabMiddle(wd)).toBe(true)
    const a = new Float32Array(SURFACE_ROWS * n)
    const b = new Float32Array(SURFACE_ROWS * n)
    const c = new Float32Array(SURFACE_ROWS * n)
    let areaMax = 0
    let top = 0
    let sprayMax = 0
    const lastMove = new Float32Array(n)
    let moves = 0
    let reversals = 0
    for (let s = 0; s < 360; s++) {
      const t = s / 60
      const r = 0.25 * L.width
      const om = 4 / r
      if (t < 3) wd.setPointer(L.width / 2 + r * Math.cos(om * t), L.waterLevel - 0.3 * L.digitHeight + 0.6 * L.digitHeight * Math.sin(om * t), 0, 0, true)
      else {
        wd.release()
        wd.setPointer(0, 0, 0, 0, false)
      }
      wd.advance(1 / 60)
      c.set(b)
      b.set(a)
      wd.displaySurface(a)
      let area = 0
      for (let i = 1; i < n - 1; i++) {
        area += a[i] - f.floorHeight((i + 0.5) * f.h)
        top = Math.max(top, a[i] / L.height)
        if (s >= 2) {
          const move = (a[i] - b[i]) * px
          if (Math.abs(move) > 0.9 && Math.abs(lastMove[i]) > 0.9) {
            moves++
            if (move * lastMove[i] < 0) reversals++
          }
          lastMove[i] = move
        }
      }
      areaMax = Math.max(areaMax, area / restArea)
      let above = 0
      for (let p = 0; p < f.numParticles; p++) {
        const x = f.pos[2 * p]
        const g = Math.min(Math.max(x / f.h - 0.5, 0), n - 1.001)
        const i0 = Math.floor(g)
        if (f.pos[2 * p + 1] > a[i0] + (a[i0 + 1] - a[i0]) * (g - i0) + 1.5 * f.h) above++
      }
      sprayMax = Math.max(sprayMax, above / f.numParticles)
    }
    expect(areaMax).toBeLessThan(1.1)
    expect(top).toBeLessThan(0.85)
    expect(sprayMax).toBeLessThan(0.08)
    expect(moves).toBeGreaterThan(1000)
    expect(reversals / moves).toBeLessThan(0.05)
  }, 60000)

  /** The particle positions the worker hands the splat pass (World.drawnParticles), kept current with `update`. */
  function drawnParticles(wd: World): { pos: Float32Array; update(drawn: Float32Array): void } {
    const pos = new Float32Array(wd.fluid.pos.length)
    const prev = new Float32Array(wd.fluid.pos.length)
    return { pos, update: (drawn) => wd.drawnParticles(drawn, pos, prev) }
  }

  const speedSample = { x: 0, y: 0 }

  /**
   * What the splats give the composite at (x, y) from the drawn particles `pos`: the particles' own
   * surface (Zhu and Bridson's eq. 7), and whether any particle is in reach.
   */
  function splatAt(wd: World, pos: Float32Array, x: number, y: number): { surface: number; reached: boolean } {
    const f = wd.fluid
    const R = SPLAT_RADIUS * f.particleRadius
    let w = 0
    let mx = 0
    let my = 0
    for (let i = 0; i < f.numParticles; i++) {
      const dx = (x - pos[2 * i]) / R
      const dy = (y - pos[2 * i + 1]) / R
      const s2 = dx * dx + dy * dy
      if (s2 >= 1) continue
      const k = (1 - s2) ** 3
      w += k
      mx += k * dx
      my += k * dy
    }
    const reached = w > 1e-4
    const r = DROP_RADIUS * f.particleRadius
    return { surface: reached ? (Math.hypot(mx, my) / w) * R - r : R - r, reached }
  }

  /** The drawn water's signed distance at (x, y), as composite.frag's waterField computes it, for a line at S with this slope. */
  function drawnField(wd: World, pos: Float32Array, x: number, y: number, S: number, slope: number): number {
    const k = UNION_SMOOTH * wd.fluid.h
    const particles = splatAt(wd, pos, x, y).surface
    const body = (y - S) / Math.sqrt(1 + slope * slope)
    const h = Math.min(Math.max(0.5 + (0.5 * (body - particles)) / k, 0), 1)
    return body + (particles - body) * h - k * h * (1 - h)
  }

  /** The highest height between `to` and `from` where `inside(y)` turns true, searched down from `from`; NaN if it never does. */
  function crossing(inside: (y: number) => boolean, from: number, to: number, step: number): number {
    for (let y = from; y > to; y -= step) {
      if (!inside(y)) continue
      let hi = y + step
      let lo = y
      for (let k = 0; k < 12; k++) {
        const mid = 0.5 * (hi + lo)
        if (inside(mid)) lo = mid
        else hi = mid
      }
      return 0.5 * (hi + lo)
    }
    return NaN
  }

  // Still water is drawn as its volume line: filtered in space and time, flat and smooth. At rest
  // the particles' own surface wanders a few pixels about that line, and next to the digits sits up
  // to a cell and a half above it; the still-water hold (STILL_SPEED) keeps all of that under the
  // line. So the drawn edge of resting water, read off the same field the composite draws, is the
  // line wherever the water is still. Only moving water may leave it: at 1440x900, one particle
  // that had settled on the 4's crossbar slides off it into the water at 0.6 to 0.7 units/s, drawn
  // partly sunk (see STILL_SPEED) as the drop it is, in 3 of 2,240 column-frames.
  it('draws the edge of still water exactly on its volume line', () => {
    const wd = world(1440, 900)
    wd.settle(4)
    const f = wd.fluid
    const n = f.nX
    const h = f.h
    const px = 900 / wd.layout.height
    const drawn = new Float32Array(SURFACE_ROWS * n)
    const shown = drawnParticles(wd)
    let samples = 0
    let departures = 0
    let stillDepartures = 0
    for (let frame = 0; frame < 20; frame++) {
      wd.advance(1 / 60)
      wd.displaySurface(drawn)
      shown.update(drawn)
      for (let i = 1; i < n - 1; i++) {
        const x = (i + 0.5) * h
        const S = drawn[i]
        const slope = (drawn[i + 1] - drawn[i - 1]) / (2 * h)
        const edge = crossing((y) => drawnField(wd, shown.pos, x, y, S, slope) < 0, S + 4 * h, S - 2 * h, 0.25 * h)
        samples++
        if (Math.abs(edge - S) * px < 0.05) continue
        departures++
        // Still only if every particle drawn in reach of the edge sits in still water.
        let fastest = 0
        for (let q = 0; q < f.numParticles; q++) {
          if (Math.hypot(shown.pos[2 * q] - x, shown.pos[2 * q + 1] - edge) > SPLAT_RADIUS * f.particleRadius) continue
          f.velocityAt(f.pos[2 * q], f.pos[2 * q + 1], speedSample)
          fastest = Math.max(fastest, Math.hypot(speedSample.x, speedSample.y))
        }
        if (fastest < STILL_SPEED[0]) stillDepartures++
      }
    }
    expect(stillDepartures).toBe(0)
    expect(departures / samples).toBeLessThan(0.01)
  }, 120000)

  // A digit fished out fast and let go splashes water above the volume line. There the water is
  // drawn from the particles' own surface, and the rows that shade it report it: the water held
  // above the line rises past a cell, the top never sits under the line, the water held is never
  // negative, and everything stays finite.
  it('draws water thrown above the line from the particles, and the rows that shade it hold together', () => {
    const wd = world(1440, 900)
    wd.settle(3)
    const L = wd.layout
    const f = wd.fluid
    const n = f.nX
    const h = f.h
    const drawn = new Float32Array(SURFACE_ROWS * n)
    const shown = drawnParticles(wd)
    expect(grabMiddle(wd)).toBe(true)
    let maxAbove = 0
    let thrown = 0
    let ordered = true
    for (let s = 0; s < 150; s++) {
      if (s < 30) wd.setPointer(L.width / 2, L.waterLevel + (0.85 * L.height - L.waterLevel) * (s / 30), 0, 0, true)
      else if (s === 30) {
        wd.release()
        wd.setPointer(0, 0, 0, 0, false)
      }
      wd.advance(1 / 60)
      wd.displaySurface(drawn)
      for (let i = 0; i < n; i++) {
        const S = drawn[i]
        const T = drawn[n + i]
        const A = drawn[2 * n + i]
        if (!(Number.isFinite(S) && Number.isFinite(T) && Number.isFinite(A) && T >= S && A >= 0)) ordered = false
        maxAbove = Math.max(maxAbove, A / h)
      }
      if (s % 10 === 5) {
        shown.update(drawn)
        for (let i = 3; i < n - 3; i += 2) if (splatAt(wd, shown.pos, (i + 0.5) * h, drawn[i] + h).surface < 0) thrown++
      }
    }
    expect(ordered).toBe(true)
    expect(maxAbove).toBeGreaterThan(1)
    expect(thrown).toBeGreaterThan(5)
  }, 120000)

  // Three.js's GPU water and Evan Wallace's WebGL Water both answer the cursor with ripples on a
  // height field; here a cursor skimming just over the surface sets them going on the drawn water.
  it('ripples where the cursor skims the surface, and settles flat again', () => {
    const wd = world(1440, 900)
    wd.settle(3)
    const L = wd.layout
    const n = wd.fluid.nX
    const px = 900 / L.height
    const before = new Float32Array(SURFACE_ROWS * n)
    const now = new Float32Array(SURFACE_ROWS * n)
    wd.displaySurface(before)
    // Ripples are what the smoothed particle surface cannot carry: crisp waves, read as the
    // surface's curvature (second difference across columns, px). Measured 3.4 px with ripples and
    // 1.5 px from the cursor's push on the particles alone.
    let crisp = 0
    for (let s = 0; s < 90; s++) {
      const x = L.width * (0.3 + (0.4 * s) / 90)
      wd.setPointer(x, L.waterLevel + 0.04, (0.4 * L.width * 60) / 90, 0, true)
      wd.advance(1 / 60)
      wd.displaySurface(now)
      for (let i = 1; i < n - 1; i++) crisp = Math.max(crisp, Math.abs(now[i + 1] - 2 * now[i] + now[i - 1]) * px)
    }
    expect(crisp).toBeGreaterThan(2.4)
    wd.setPointer(0, 0, 0, 0, false)
    wd.settle(4)
    wd.displaySurface(now)
    let after = 0
    for (let i = 0; i < n; i++) after = Math.max(after, Math.abs(now[i] - before[i]) * px)
    // Loosened water once stood 8 px higher for good, with a 20 px hump where the cursor passed.
    expect(after).toBeLessThan(10)
  }, 30000)

  // The drawn surface follows the simulated one through this spring, sped up to 50 rad/s when it
  // falls behind. Stepped explicitly at 60 Hz that diverged (w dt 0.83 is past the limit of 0.828):
  // needles, then black bars down the page. A jump the size of the whole view, held: no overshoot,
  // no growth, and it arrives.
  it('follows the water with a spring that is stable at any speed', () => {
    for (const w of [25, 50, 200]) {
      const s = { x: 0, v: 0 }
      let lowest = 0
      let highest = 0
      for (let k = 0; k < 120; k++) {
        springStep(s, 3, w, 1 / 60)
        lowest = Math.min(lowest, s.x)
        highest = Math.max(highest, s.x)
      }
      expect(Number.isFinite(s.x)).toBe(true)
      expect(lowest).toBeGreaterThanOrEqual(0)
      expect(highest).toBeLessThanOrEqual(3 + 1e-9)
      expect(s.x).toBeCloseTo(3, 3)
    }
  })

  // The hardest hand: a cursor whipped across the tank four times a second just under the surface,
  // for ten seconds, at desktop and phone sizes. The drawn water stays finite, in the tank and free
  // of single-column needles (the sharpest kink, as the second difference over a cell, measured
  // 0.6 and 1.6 here; the explicit spring reached 4.8 on the phone before it diverged by hand).
  it('keeps the drawn water sane under the hardest stirring', () => {
    for (const [w, h] of [[1440, 900], [390, 844]]) {
      const wd = world(w, h)
      wd.settle(2)
      const L = wd.layout
      const n = wd.fluid.nX
      const a = new Float32Array(SURFACE_ROWS * n)
      let top = 0
      let kink = 0
      for (let s = 0; s < 600; s++) {
        const t = s / 60
        const x = L.width * (0.5 + 0.4 * Math.sin(8 * Math.PI * t))
        const vx = L.width * 0.4 * 8 * Math.PI * Math.cos(8 * Math.PI * t)
        wd.setPointer(x, L.waterLevel - 0.1 + 0.15 * Math.sin(5 * t), vx, 0.75 * Math.cos(5 * t), true)
        wd.advance(1 / 60)
        wd.displaySurface(a)
        for (let i = 0; i < n; i++) {
          expect(Number.isFinite(a[i])).toBe(true)
          top = Math.max(top, a[i] / L.height)
          if (i > 0 && i < n - 1) kink = Math.max(kink, Math.abs(a[i + 1] - 2 * a[i] + a[i - 1]) / wd.fluid.h)
        }
      }
      expect(top).toBeLessThan(0.8)
      expect(kink).toBeLessThan(3)
    }
  }, 60000)

  it('lets a digit be fished out and dropped back in', () => {
    const wd = world()
    wd.settle(1)
    const d = wd.digits[1]
    // Grab it by its ink (the 0's centre of mass sits in its counter).
    const grip = { x: 0, y: 0 }
    const k = d.shape.interiorInk.indexOf(1)
    d.toWorld(d.shape.interior[2 * k], d.shape.interior[2 * k + 1], grip)
    expect(wd.press(grip.x, grip.y)).toBe(true)
    for (let i = 0; i < 60; i++) {
      wd.setPointer(d.homeX, wd.layout.height * 0.8, 0, 0, true)
      wd.advance(1 / 60)
    }
    // Held well above the water.
    expect(d.y).toBeGreaterThan(wd.layout.waterLevel + 0.2)
    wd.release()
    wd.settle(5)
    expect(d.y).toBeLessThan(wd.layout.waterLevel)
    expect(Number.isFinite(d.x + d.y + d.angle)).toBe(true)
  })

  // As in the reference: afloat, tops breaking the surface, water below for the fish and crabs.
  function expectAfloat(wd: World): void {
    for (const d of wd.digits) {
      expect(d.submerged).toBeGreaterThan(0.8)
      const top = d.y + d.shape.maxY
      // Against the settled surface: the water packs down a few percent below its fill level.
      expect(Math.abs(top - wd.fluid.surfaceAt(d.x))).toBeLessThan(0.25 * wd.layout.digitHeight)
      const bottom = d.y + d.shape.minY
      expect(bottom - wd.fluid.floorHeight(d.x)).toBeGreaterThan(0.2 * wd.layout.digitHeight)
      expect(Math.abs(d.angle)).toBeLessThan(0.25)
      expect(Math.abs(d.x - d.homeX)).toBeLessThan(0.25 * wd.layout.digitHeight)
    }
  }

  it('floats the digits with their tops at the surface in a wide view', () => {
    const wd = world(1920, 1080)
    wd.settle(5)
    expectAfloat(wd)
  })

  it('floats the digits the same way in a tall view', () => {
    const wd = world(390, 844)
    wd.settle(5)
    expectAfloat(wd)
  })
})
