// A 2D FLIP fluid: particles carry the water, a MAC grid enforces incompressibility.
// Copied forward from the Fluid-simulation-experiment port of Matthias Müller's Ten Minute Physics
// FLIP demo (tutorial 18), then extended with floating digits as moving solids (with a separating
// boundary: water may leave a digit, never enter it), venting for the pockets they seal, a stirring
// brush and a per-column surface profile drawn from the water's volume.
//
// Conventions: y is up, the grid is x-major (index = i * nY + j), cell (i, j) spans
// [i h, (i + 1) h] x [j h, (j + 1) h]. u[i, j] sits on the left face of cell (i, j) and v[i, j] on
// its bottom face.

const FLUID = 0
const AIR = 1
const SOLID = 2

/** A particle's radius, as a fraction of the cell size. */
export const PARTICLE_RADIUS = 0.3

/** Particles per unit area that `fill` packs (a hexagonal lattice) at cell size h. */
export function latticeDensity(h: number): number {
  const r = PARTICLE_RADIUS * h
  return 1 / (2 * Math.sqrt(3) * r * r)
}

/** A moving solid the water flows around: a digit. */
export interface Collider {
  /** World-space bounds, already padded by the caller's margin. */
  minX: number
  minY: number
  maxX: number
  maxY: number
  /** Signed distance at a world point, negative inside. */
  distance(x: number, y: number): number
  /** Outward unit normal at a world point (only asked for on contact: it costs four lookups). */
  normal(x: number, y: number, out: ColliderSample): void
  /** Velocity of the body at a world point. */
  velocityAt(x: number, y: number, out: { x: number; y: number }): void
}

export interface ColliderSample {
  nx: number
  ny: number
}

export interface Stir {
  x: number
  y: number
  vx: number
  vy: number
  radius: number
}

export interface FlipConfig {
  width: number
  height: number
  cellSize: number
  /** Floor height (sim units) at x. Cells below it are solid. */
  floor: (x: number) => number
  maxParticles: number
}

export interface StepOptions {
  dt: number
  gravity: number
  /** Extra acceleration on every particle: the inertial force of a shaken window. */
  accelX: number
  accelY: number
  colliders: readonly Collider[]
  stir: Stir | null
  pressureIters: number
  separationIters: number
  /** Share of FLIP in the particle update (the rest is PIC). Defaults to 0.9. */
  flipRatio?: number
  /** Strength of the drift compensation that keeps the density even. Defaults to 1. */
  driftCompensation?: number
  /** XSPH velocity smoothing between touching particles, per separation pass. */
  smoothing?: number
}

const OVER_RELAXATION = 1.9
const FLIP_RATIO = 0.9
/**
 * The tank's pace: its clock runs this much faster than the page's. The view is 3 units tall, and
 * with gravity at 9.81 units/s^2 the water moved like a 3 m pool's: waves and sloshes took pool
 * time on a screen-sized tank, and the owner found it slow. Each frame advances the tank by PACE
 * times the frame's time, in steps of 1/60 s of tank time (World.advance), so the solver keeps
 * the gravity and step it was tuned at; the hand's speeds and the shake's accelerations are
 * converted into tank time where they enter. Scaling gravity by PACE^2 instead looked the same on
 * screen but packed the particle lattice PACE^2 harder each step, and the resting jostle rose
 * seven times (0.005 to 0.035 at 1440x900), too much for still water to ever read as calm.
 */
export const PACE = 1.4

const STIR_STRENGTH = 0.6
/** Empty cells in a row that end a column's body of water: above them is spray. */
const BODY_GAP = 2
/** A digit this many cells above the end of a column's water still rests in it (see updateSurface). */
const DIGIT_VOID = 3
/**
 * A cell at this share of the rest density or more counts as full. Cells against a wall or a
 * digit hold fewer particles than open water (about 0.82 of it at a wall, less where a digit cuts the cell) yet are full of water;
 * churned water well below it is mostly air and counts for what it holds.
 */
const SATURATED = 0.6
/** A cell above the body at this share of SATURATED or more, on another such cell, is water two cells deep (see `top`). */
const TOP_SHARE = 0.4
// FLIP keeps a little noise alive (particle separation, drift correction). Resting water must look
// still, so slow particles are damped hard and everything else very gently, as in the experiment.
const DRIFT_DEAD_ZONE = 0.1
const XSPH = 0.05
/**
 * Per-step damping of every particle (0.3 per second of tank time), for the losses a 2D tank
 * lacks. Measured at 1440x900 over hard drags at three speeds: a second after letting go the
 * surface still swings 16 px on average, and a cursor sweep moves it 32 px. Three times this held
 * the swing to 9 px but the sweep to 28, and the owner wanted livelier water. The reference's own
 * waves keep a fifth of the frame's height for seconds after a splash.
 */
const DAMPING = 0.005
const SETTLED_SPEED = 0.35
const SETTLED_DAMPING = 0.08

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x
}

export class FlipFluid {
  readonly width: number
  readonly height: number
  readonly nX: number
  readonly nY: number
  readonly h: number
  readonly invH: number
  readonly numCells: number
  readonly particleRadius: number
  readonly maxParticles: number

  readonly u: Float32Array
  readonly v: Float32Array
  private readonly du: Float32Array
  private readonly dv: Float32Array
  private readonly prevU: Float32Array
  private readonly prevV: Float32Array
  /** 1 where fluid may flow, 0 for solid (walls, floor, digits). */
  readonly s: Float32Array
  /** Static solids (walls and floor); the digits are added on top each step. */
  private readonly staticS: Float32Array
  /** Velocity of the solid in each solid cell, for the faces it shares with fluid. */
  private readonly solidU: Float32Array
  private readonly solidV: Float32Array
  readonly cellType: Int32Array
  readonly cellDensity: Float32Array
  private readonly smoothDensity: Float32Array
  /** 1 where a cell and its eight neighbours all hold water (set each pressure solve). */
  private readonly deep: Uint8Array
  restDensity = 0

  readonly pos: Float32Array
  readonly vel: Float32Array
  numParticles = 0

  /** Water surface height per grid column, for the renderer, the digits and the fish. */
  readonly surface: Float32Array
  /**
   * Per column, the top of the highest water at least two cells deep above the body (a crest, a
   * slab of water over a pocket of air trapped in a slosh), smoothed as `surface` is and never
   * below it; `surface` where there is none. A drop or a one-cell sheet does not count.
   */
  readonly top: Float32Array
  /** Per column, how much water lies above the body (sim units of height): crests, sheets, spray. */
  readonly above: Float32Array
  private readonly rawSurface: Float32Array
  private readonly rawTop: Float32Array
  private readonly rawAbove: Float32Array
  private readonly blurSurface: Float32Array
  private readonly surfaceKnown: Uint8Array

  private readonly floor: (x: number) => number
  private readonly floorAt: Float32Array

  // Spatial hash for particle separation.
  private readonly pInvSpacing: number
  private readonly pNumX: number
  private readonly pNumY: number
  private readonly cellCount: Int32Array
  private readonly firstCell: Int32Array
  private readonly cellIds: Int32Array

  private readonly sample: ColliderSample = { nx: 0, ny: 0 }
  private readonly bodyVel = { x: 0, y: 0 }

  constructor(config: FlipConfig) {
    this.width = config.width
    this.height = config.height
    this.nX = Math.floor(config.width / config.cellSize) + 1
    this.nY = Math.floor(config.height / config.cellSize) + 1
    this.h = Math.max(config.width / this.nX, config.height / this.nY)
    this.invH = 1 / this.h
    this.numCells = this.nX * this.nY
    this.particleRadius = PARTICLE_RADIUS * this.h
    this.maxParticles = config.maxParticles
    this.floor = config.floor

    const n = this.numCells
    this.u = new Float32Array(n)
    this.v = new Float32Array(n)
    this.du = new Float32Array(n)
    this.dv = new Float32Array(n)
    this.prevU = new Float32Array(n)
    this.prevV = new Float32Array(n)
    this.s = new Float32Array(n)
    this.staticS = new Float32Array(n)
    this.solidU = new Float32Array(n)
    this.solidV = new Float32Array(n)
    this.reached = new Uint8Array(n)
    this.queue = new Int32Array(n)
    this.cellType = new Int32Array(n)
    this.cellDensity = new Float32Array(n)
    this.smoothDensity = new Float32Array(n)
    this.deep = new Uint8Array(n)
    this.pressure = new Float32Array(n)

    this.pos = new Float32Array(2 * config.maxParticles)
    this.vel = new Float32Array(2 * config.maxParticles)

    this.surface = new Float32Array(this.nX)
    this.rawSurface = new Float32Array(this.nX)
    this.top = new Float32Array(this.nX)
    this.rawTop = new Float32Array(this.nX)
    this.above = new Float32Array(this.nX)
    this.rawAbove = new Float32Array(this.nX)
    this.blurSurface = new Float32Array(this.nX)
    this.surfaceKnown = new Uint8Array(this.nX)

    this.floorAt = new Float32Array(this.nX)
    for (let i = 0; i < this.nX; i++) this.floorAt[i] = this.floor((i + 0.5) * this.h)
    for (let i = 0; i < this.nX; i++) {
      for (let j = 0; j < this.nY; j++) {
        const wall = i === 0 || i === this.nX - 1 || j === 0
        const belowFloor = (j + 0.5) * this.h < this.floorAt[i]
        this.staticS[i * this.nY + j] = wall || belowFloor ? 0 : 1
      }
    }
    this.s.set(this.staticS)

    const spacing = 2.2 * this.particleRadius
    this.pInvSpacing = 1 / spacing
    this.pNumX = Math.floor(config.width * this.pInvSpacing) + 1
    this.pNumY = Math.floor(config.height * this.pInvSpacing) + 1
    this.cellCount = new Int32Array(this.pNumX * this.pNumY)
    this.firstCell = new Int32Array(this.pNumX * this.pNumY + 1)
    this.cellIds = new Int32Array(config.maxParticles)
  }

  /** Pressure from the last solve (diagnostics). */
  readonly pressure: Float32Array

  /** Floor height at x, as the solver sees it. */
  floorHeight(x: number): number {
    return this.floor(x)
  }

  /**
   * Fills the region between the floor and `level` with particles on a hexagonal lattice, skipping
   * points inside any collider. Returns the number of particles placed.
   */
  fill(level: number, colliders: readonly Collider[]): number {
    const r = this.particleRadius
    const dx = 2 * r
    const dy = (Math.sqrt(3) / 2) * dx
    let count = 0
    // The lattice is centred between the walls: started at the left wall, all of the width it
    // does not divide into was left at the right, and the column against that wall stayed
    // half-empty for good.
    const xMax = (this.nX - 1) * this.h - r
    const xMin = this.h + r + ((xMax - this.h - r) % dx) / 2
    for (let row = 0; ; row++) {
      const y = this.h + r + row * dy
      if (y > level) break
      for (let x = xMin + (row % 2 === 0 ? 0 : r); x <= xMax; x += dx) {
        if (y < this.floor(x) + r) continue
        let blocked = false
        for (const c of colliders) {
          if (x < c.minX || x > c.maxX || y < c.minY || y > c.maxY) continue
          if (c.distance(x, y) < r) {
            blocked = true
            break
          }
        }
        if (blocked) continue
        if (count >= this.maxParticles) break
        this.pos[2 * count] = x
        this.pos[2 * count + 1] = y
        this.vel[2 * count] = 0
        this.vel[2 * count + 1] = 0
        count++
      }
    }
    this.numParticles = count
    this.restDensity = 0
    this.u.fill(0)
    this.v.fill(0)
    return count
  }

  step(o: StepOptions): void {
    this.integrate(o.dt, o.gravity, o.accelX, o.accelY)
    if (o.stir) this.applyStir(o.stir, o.dt)
    this.separate(o.separationIters, o.smoothing ?? XSPH)
    this.collide(o.colliders)
    this.markSolids(o.colliders)
    this.particlesToGrid()
    // The grid as the particles left it: FLIP adds to each particle what the solve does from here.
    this.prevU.set(this.u)
    this.prevV.set(this.v)
    this.ventSealedPockets()
    this.updateDensity()
    this.solveIncompressibility(o.pressureIters, o.dt, o.driftCompensation ?? 1)
    this.gridToParticles(o.flipRatio ?? FLIP_RATIO)
    this.damp()
    this.updateSurface()
  }

  /** Gentle damping everywhere, and strong damping of slow particles. */
  private damp(): void {
    const vel = this.vel
    const keep = 1 - DAMPING
    const settled2 = SETTLED_SPEED * SETTLED_SPEED
    for (let i = 0; i < this.numParticles; i++) {
      let vx = vel[2 * i] * keep
      let vy = vel[2 * i + 1] * keep
      const s2 = vx * vx + vy * vy
      if (s2 < settled2) {
        const k = 1 - SETTLED_DAMPING * (1 - Math.sqrt(s2) / SETTLED_SPEED)
        vx *= k
        vy *= k
      }
      vel[2 * i] = vx
      vel[2 * i + 1] = vy
    }
  }

  private integrate(dt: number, gravity: number, ax: number, ay: number): void {
    const pos = this.pos
    const vel = this.vel
    for (let i = 0; i < this.numParticles; i++) {
      vel[2 * i] += dt * ax
      vel[2 * i + 1] += dt * (gravity + ay)
      pos[2 * i] += vel[2 * i] * dt
      pos[2 * i + 1] += vel[2 * i + 1] * dt
    }
  }

  /**
   * The cursor as a soft paddle: particles near it take on part of its velocity, with a smooth
   * falloff. Unlike a solid obstacle it never carves a hole in the water.
   */
  private applyStir(stir: Stir, dt: number): void {
    const pos = this.pos
    const vel = this.vel
    const r2 = stir.radius * stir.radius
    // Frame-rate independent: the blend a 60 Hz step would give.
    const k = 1 - Math.pow(1 - STIR_STRENGTH, dt * 60)
    for (let i = 0; i < this.numParticles; i++) {
      const dx = pos[2 * i] - stir.x
      const dy = pos[2 * i + 1] - stir.y
      const d2 = dx * dx + dy * dy
      if (d2 >= r2) continue
      const f = 1 - d2 / r2
      const w = k * f * f
      vel[2 * i] += (stir.vx - vel[2 * i]) * w
      vel[2 * i + 1] += (stir.vy - vel[2 * i + 1]) * w
    }
  }

  /** Pushes overlapping particles apart, keeping the particle density even. */
  private separate(iterations: number, xsph: number): void {
    const pos = this.pos
    const vel = this.vel
    const minDist = 2 * this.particleRadius
    const minDist2 = minDist * minDist
    const pInv = this.pInvSpacing
    const pNumX = this.pNumX
    const pNumY = this.pNumY
    const count = this.cellCount
    const first = this.firstCell
    const ids = this.cellIds
    const numCells = pNumX * pNumY

    // The hash is built once: particles move a fraction of their radius per pass, so it stays good.
    {
      count.fill(0)
      for (let i = 0; i < this.numParticles; i++) {
        const xi = clamp(Math.floor(pos[2 * i] * pInv), 0, pNumX - 1)
        const yi = clamp(Math.floor(pos[2 * i + 1] * pInv), 0, pNumY - 1)
        count[xi * pNumY + yi]++
      }
      let f = 0
      for (let c = 0; c < numCells; c++) {
        f += count[c]
        first[c] = f
      }
      first[numCells] = f
      for (let i = 0; i < this.numParticles; i++) {
        const xi = clamp(Math.floor(pos[2 * i] * pInv), 0, pNumX - 1)
        const yi = clamp(Math.floor(pos[2 * i + 1] * pInv), 0, pNumY - 1)
        const c = xi * pNumY + yi
        first[c]--
        ids[first[c]] = i
      }
    }

    for (let iter = 0; iter < iterations; iter++) {
      for (let i = 0; i < this.numParticles; i++) {
        const px = pos[2 * i]
        const py = pos[2 * i + 1]
        const pxi = Math.floor(px * pInv)
        const pyi = Math.floor(py * pInv)
        const x0 = Math.max(pxi - 1, 0)
        const y0 = Math.max(pyi - 1, 0)
        const x1 = Math.min(pxi + 1, pNumX - 1)
        const y1 = Math.min(pyi + 1, pNumY - 1)
        for (let xi = x0; xi <= x1; xi++) {
          for (let yi = y0; yi <= y1; yi++) {
            const c = xi * pNumY + yi
            const end = first[c + 1]
            for (let k = first[c]; k < end; k++) {
              const id = ids[k]
              // Each pair once: the first visit already moves both halves apart.
              if (id <= i) continue
              let dx = pos[2 * id] - px
              let dy = pos[2 * id + 1] - py
              const d2 = dx * dx + dy * dy
              if (d2 > minDist2 || d2 === 0) continue
              const d = Math.sqrt(d2)
              const s = (0.5 * (minDist - d)) / d
              dx *= s
              dy *= s
              pos[2 * i] -= dx
              pos[2 * i + 1] -= dy
              pos[2 * id] += dx
              pos[2 * id + 1] += dy
              // XSPH smoothing: touching neighbours drift toward a shared velocity. It removes
              // particle-scale jitter and leaves coherent flow (waves, sloshing) alone.
              const avx = 0.5 * (vel[2 * i] + vel[2 * id])
              const avy = 0.5 * (vel[2 * i + 1] + vel[2 * id + 1])
              vel[2 * i] += (avx - vel[2 * i]) * xsph
              vel[2 * i + 1] += (avy - vel[2 * i + 1]) * xsph
              vel[2 * id] += (avx - vel[2 * id]) * xsph
              vel[2 * id + 1] += (avy - vel[2 * id + 1]) * xsph
            }
          }
        }
      }
    }
  }

  /** Keeps particles inside the tank, above the floor and outside the digits. */
  private collide(colliders: readonly Collider[]): void {
    const pos = this.pos
    const vel = this.vel
    const h = this.h
    const r = this.particleRadius
    const minX = h + r
    const maxX = (this.nX - 1) * h - r
    const maxY = (this.nY - 1) * h - r
    const sample = this.sample
    const body = this.bodyVel

    for (let i = 0; i < this.numParticles; i++) {
      let x = pos[2 * i]
      let y = pos[2 * i + 1]

      for (let c = 0; c < colliders.length; c++) {
        const col = colliders[c]
        if (x < col.minX || x > col.maxX || y < col.minY || y > col.maxY) continue
        // Above the water line the digit is open (see markSolids).
        if (y > this.surfaceAt(x) + h) break
        const d = col.distance(x, y)
        if (d >= r) continue
        col.normal(x, y, sample)
        // Out along the surface normal, then take the solid's normal velocity.
        const push = r - d
        x += sample.nx * push
        y += sample.ny * push
        col.velocityAt(x, y, body)
        const rvx = vel[2 * i] - body.x
        const rvy = vel[2 * i + 1] - body.y
        const vn = rvx * sample.nx + rvy * sample.ny
        if (vn < 0) {
          vel[2 * i] -= vn * sample.nx
          vel[2 * i + 1] -= vn * sample.ny
        }
      }

      if (x < minX) {
        x = minX
        if (vel[2 * i] < 0) vel[2 * i] = 0
      }
      if (x > maxX) {
        x = maxX
        if (vel[2 * i] > 0) vel[2 * i] = 0
      }
      const fy = this.floor(x) + r
      if (y < fy) {
        y = fy
        if (vel[2 * i + 1] < 0) vel[2 * i + 1] = 0
      }
      if (y > maxY) {
        y = maxY
        if (vel[2 * i + 1] > 0) vel[2 * i + 1] = 0
      }
      pos[2 * i] = x
      pos[2 * i + 1] = y
    }
  }

  /**
   * Static solids, plus every cell whose centre lies inside a digit and under the water line, with
   * that digit's velocity. The part of a digit standing out of the water is no solid to the grid:
   * a 0 lifted out would otherwise carry the water in its counter up with it, a cup in 2D where the
   * real counter is a hole through a slab, and drops fall through it as they would past a slab.
   */
  private markSolids(colliders: readonly Collider[]): void {
    this.s.set(this.staticS)
    this.solidU.fill(0)
    this.solidV.fill(0)
    const h = this.h
    const n = this.nY
    const body = this.bodyVel
    const surface = this.surface
    for (const col of colliders) {
      const i0 = clamp(Math.floor(col.minX * this.invH), 1, this.nX - 2)
      const i1 = clamp(Math.floor(col.maxX * this.invH), 1, this.nX - 2)
      const j0 = clamp(Math.floor(col.minY * this.invH), 1, this.nY - 1)
      const j1 = clamp(Math.floor(col.maxY * this.invH), 1, this.nY - 1)
      for (let i = i0; i <= i1; i++) {
        const lift = surface[i] + h
        for (let j = j0; j <= j1; j++) {
          const x = (i + 0.5) * h
          const y = (j + 0.5) * h
          if (y > lift || col.distance(x, y) > 0) continue
          const idx = i * n + j
          this.s[idx] = 0
          col.velocityAt(x, y, body)
          this.solidU[idx] = body.x
          this.solidV[idx] = body.y
        }
      }
    }
  }

  private particlesToGrid(): void {
    const n = this.nY
    const h = this.h
    const h1 = this.invH
    const h2 = 0.5 * h
    const pos = this.pos
    const vel = this.vel
    const s = this.s
    const type = this.cellType

    this.u.fill(0)
    this.v.fill(0)
    this.du.fill(0)
    this.dv.fill(0)

    for (let c = 0; c < this.numCells; c++) type[c] = s[c] === 0 ? SOLID : AIR
    let top = 0
    for (let i = 0; i < this.numParticles; i++) {
      const xi = clamp(Math.floor(pos[2 * i] * h1), 0, this.nX - 1)
      const yi = clamp(Math.floor(pos[2 * i + 1] * h1), 0, this.nY - 1)
      const c = xi * n + yi
      if (type[c] === AIR) type[c] = FLUID
      if (yi > top) top = yi
    }
    this.topRow = top

    for (let component = 0; component < 2; component++) {
      const dx = component === 0 ? 0 : h2
      const dy = component === 0 ? h2 : 0
      const f = component === 0 ? this.u : this.v
      const d = component === 0 ? this.du : this.dv
      for (let i = 0; i < this.numParticles; i++) {
        const x = clamp(pos[2 * i], h, (this.nX - 1) * h)
        const y = clamp(pos[2 * i + 1], h, (this.nY - 1) * h)
        const x0 = Math.min(Math.floor((x - dx) * h1), this.nX - 2)
        const tx = (x - dx - x0 * h) * h1
        const x1 = Math.min(x0 + 1, this.nX - 2)
        const y0 = Math.min(Math.floor((y - dy) * h1), this.nY - 2)
        const ty = (y - dy - y0 * h) * h1
        const y1 = Math.min(y0 + 1, this.nY - 2)
        const sx = 1 - tx
        const sy = 1 - ty
        const w0 = sx * sy
        const w1 = tx * sy
        const w2 = tx * ty
        const w3 = sx * ty
        const pv = vel[2 * i + component]
        f[x0 * n + y0] += pv * w0
        d[x0 * n + y0] += w0
        f[x1 * n + y0] += pv * w1
        d[x1 * n + y0] += w1
        f[x1 * n + y1] += pv * w2
        d[x1 * n + y1] += w2
        f[x0 * n + y1] += pv * w3
        d[x0 * n + y1] += w3
      }
      for (let c = 0; c < this.numCells; c++) if (d[c] > 0) f[c] /= d[c]
    }

    // Faces touching a solid: water may not flow into the solid faster than the solid moves, but it
    // may leave it (a separating boundary). Holding the face to the solid's velocity both ways would
    // make a digit lifted out of the water suck a column of water up after it. Walls move at zero.
    const u = this.u
    const v = this.v
    for (let i = 0; i < this.nX; i++) {
      for (let j = 0; j < this.nY; j++) {
        const c = i * n + j
        if (i > 0) {
          const l = c - n
          if (s[c] === 0 && s[l] === 0) u[c] = 0
          else if (s[l] === 0) u[c] = Math.max(u[c], this.solidU[l])
          else if (s[c] === 0) u[c] = Math.min(u[c], this.solidU[c])
        }
        if (j > 0) {
          const b = c - 1
          if (s[c] === 0 && s[b] === 0) v[c] = 0
          else if (s[b] === 0) v[c] = Math.max(v[c], this.solidV[b])
          else if (s[c] === 0) v[c] = Math.min(v[c], this.solidV[c])
        }
      }
    }
  }

  /**
   * Water sealed off from the air (between two digits and the floor, say) changes volume whenever
   * the solids around it move a cell, and an incompressible solve cannot absorb that: the pressure
   * runs away. Each sealed pocket gets one vent at its top so it stays solvable.
   */
  private ventSealedPockets(): void {
    const n = this.nY
    const type = this.cellType
    const seen = this.reached
    const queue = this.queue
    seen.fill(0)
    let head = 0
    let tail = 0
    for (let c = 0; c < this.numCells; c++) {
      if (type[c] === AIR) {
        seen[c] = 1
        queue[tail++] = c
      }
    }
    const visit = (c: number) => {
      if (c < 0 || c >= this.numCells || seen[c] || type[c] !== FLUID) return
      seen[c] = 1
      queue[tail++] = c
    }
    while (head < tail) {
      const c = queue[head++]
      visit(c - n)
      visit(c + n)
      visit(c - 1)
      visit(c + 1)
    }
    // Whatever fluid is left unreached is sealed: flood each pocket and open its highest cell.
    for (let start = 0; start < this.numCells; start++) {
      if (seen[start] || type[start] !== FLUID) continue
      head = 0
      tail = 0
      seen[start] = 1
      queue[tail++] = start
      let top = start
      while (head < tail) {
        const c = queue[head++]
        if (c % n > top % n) top = c
        for (const nb of [c - n, c + n, c - 1, c + 1]) {
          if (nb < 0 || nb >= this.numCells || seen[nb] || type[nb] !== FLUID) continue
          seen[nb] = 1
          queue[tail++] = nb
        }
      }
      type[top] = AIR
      this.vents++
    }
  }

  /** Highest grid row holding a particle after the last transfer. */
  private topRow = 0

  /** Pockets vented since construction (diagnostics). */
  vents = 0
  private readonly reached: Uint8Array
  private readonly queue: Int32Array

  private updateDensity(): void {
    const n = this.nY
    const h = this.h
    const h1 = this.invH
    const h2 = 0.5 * h
    const d = this.cellDensity
    const pos = this.pos
    d.fill(0)
    for (let i = 0; i < this.numParticles; i++) {
      const x = clamp(pos[2 * i], h, (this.nX - 1) * h)
      const y = clamp(pos[2 * i + 1], h, (this.nY - 1) * h)
      const x0 = Math.floor((x - h2) * h1)
      const tx = (x - h2 - x0 * h) * h1
      const x1 = Math.min(x0 + 1, this.nX - 2)
      const y0 = Math.floor((y - h2) * h1)
      const ty = (y - h2 - y0 * h) * h1
      const y1 = Math.min(y0 + 1, this.nY - 2)
      const sx = 1 - tx
      const sy = 1 - ty
      d[x0 * n + y0] += sx * sy
      d[x1 * n + y0] += tx * sy
      d[x1 * n + y1] += tx * ty
      d[x0 * n + y1] += sx * ty
    }
    if (this.restDensity === 0) {
      // Interior cells only: half-empty surface cells would pull the average down, and the
      // interior would then always read as compressed and be kicked every step.
      const type = this.cellType
      let sum = 0
      let cells = 0
      for (let i = 1; i < this.nX - 1; i++) {
        for (let j = 1; j < this.nY - 1; j++) {
          const c = i * n + j
          if (type[c] !== FLUID) continue
          if (type[c - n] !== FLUID || type[c + n] !== FLUID || type[c - 1] !== FLUID || type[c + 1] !== FLUID) continue
          sum += d[c]
          cells++
        }
      }
      if (cells > 0) this.restDensity = sum / cells
    }
  }

  private solveIncompressibility(iterations: number, dt: number, drift: number): void {
    const n = this.nY
    const u = this.u
    const v = this.v
    const s = this.s
    const type = this.cellType
    const rest = this.restDensity
    const p = this.pressure
    const cp = this.h / dt
    p.fill(0)
    // Compression from a 3x3 average: the particle lattice aliases against the grid, so single
    // cells flicker by 10 to 15 percent at rest, and correcting that flicker is pure noise. Only
    // fluid cells count, as for the rest density: averaging in empty solid or air cells would read
    // the water along the floor, the walls and the digits as a third less packed than it is, and
    // the correction would be weakest exactly where gravity packs it.
    const raw = this.cellDensity
    const density = this.smoothDensity
    // No water above the highest particle: the loops stop one row past it.
    const jEnd = Math.min(this.nY - 1, this.topRow + 2)
    for (let i = 1; i < this.nX - 1; i++) {
      for (let j = 1; j < jEnd; j++) {
        const c = i * n + j
        if (type[c] !== FLUID) continue
        let sum = 0
        let cells = 0
        for (let di = -n; di <= n; di += n) {
          for (let dj = -1; dj <= 1; dj++) {
            const k = c + di + dj
            if (type[k] !== FLUID) continue
            sum += raw[k]
            cells++
          }
        }
        density[c] = sum / cells
        // Deep inside the water: the cell and all eight around it hold water.
        this.deep[c] = cells === 9 ? 1 : 0
      }
    }

    for (let iter = 0; iter < iterations; iter++) {
      for (let i = 1; i < this.nX - 1; i++) {
        for (let j = 1; j < jEnd; j++) {
          const c = i * n + j
          if (type[c] !== FLUID) continue
          const sx0 = s[c - n]
          const sx1 = s[c + n]
          const sy0 = s[c - 1]
          const sy1 = s[c + 1]
          const sum = sx0 + sx1 + sy0 + sy1
          if (sum === 0) continue
          let div = u[c + n] - u[c] + v[c + 1] - v[c]
          // Drift compensation: compressed regions push out and loosened ones draw in, so the water
          // keeps its volume. Particle separation spreads particles apart but nothing pulls them
          // together, so a stir left water fluffy for good: it stood 8 px higher and kept a 20 px
          // hump where the cursor had passed. Only deep water is drawn in; the cells at the
          // surface, the glass and the sand are part-filled by nature.
          if (rest > 0) {
            // A small dead zone: the lattice's own density ripple is not drift.
            const compression = density[c] - rest * (1 + DRIFT_DEAD_ZONE)
            if (compression > 0) div -= drift * compression
            else if (this.deep[c]) {
              const loosening = rest * (1 - DRIFT_DEAD_ZONE) - density[c]
              if (loosening > 0) div += drift * loosening
            }
          }
          const pc = (-div / sum) * OVER_RELAXATION
          p[c] += cp * pc
          u[c] -= sx0 * pc
          u[c + n] += sx1 * pc
          v[c] -= sy0 * pc
          v[c + 1] += sy1 * pc
        }
      }
    }
  }

  private gridToParticles(flipRatio: number): void {
    const n = this.nY
    const h = this.h
    const h1 = this.invH
    const h2 = 0.5 * h
    const pos = this.pos
    const vel = this.vel
    const type = this.cellType

    for (let component = 0; component < 2; component++) {
      const dx = component === 0 ? 0 : h2
      const dy = component === 0 ? h2 : 0
      const f = component === 0 ? this.u : this.v
      const prevF = component === 0 ? this.prevU : this.prevV
      const offset = component === 0 ? n : 1
      for (let i = 0; i < this.numParticles; i++) {
        const x = clamp(pos[2 * i], h, (this.nX - 1) * h)
        const y = clamp(pos[2 * i + 1], h, (this.nY - 1) * h)
        const x0 = Math.min(Math.floor((x - dx) * h1), this.nX - 2)
        const tx = (x - dx - x0 * h) * h1
        const x1 = Math.min(x0 + 1, this.nX - 2)
        const y0 = Math.min(Math.floor((y - dy) * h1), this.nY - 2)
        const ty = (y - dy - y0 * h) * h1
        const y1 = Math.min(y0 + 1, this.nY - 2)
        const sx = 1 - tx
        const sy = 1 - ty
        const n0 = x0 * n + y0
        const n1 = x1 * n + y0
        const n2 = x1 * n + y1
        const n3 = x0 * n + y1
        // A face counts if either cell beside it is not air.
        const v0 = type[n0] !== AIR || type[n0 - offset] !== AIR ? sx * sy : 0
        const v1 = type[n1] !== AIR || type[n1 - offset] !== AIR ? tx * sy : 0
        const v2 = type[n2] !== AIR || type[n2 - offset] !== AIR ? tx * ty : 0
        const v3 = type[n3] !== AIR || type[n3 - offset] !== AIR ? sx * ty : 0
        const denom = v0 + v1 + v2 + v3
        if (denom <= 0) continue
        const pic = (v0 * f[n0] + v1 * f[n1] + v2 * f[n2] + v3 * f[n3]) / denom
        const corr =
          (v0 * (f[n0] - prevF[n0]) + v1 * (f[n1] - prevF[n1]) + v2 * (f[n2] - prevF[n2]) + v3 * (f[n3] - prevF[n3])) / denom
        const flip = vel[2 * i + component] + corr
        vel[2 * i + component] = (1 - flipRatio) * pic + flipRatio * flip
      }
    }
  }

  /**
   * The water surface per column: about the height the column's water fills. From the floor up,
   * the body of water runs until two empty cells in a row; each fluid cell counts as full from
   * SATURATED of the rest density up (cells against the glass or a digit hold fewer particles yet
   * are full of water) and as its share below that, and a digit's cells count as full where water
   * lies above them. So churned, aerated water reads near the height its water fills (a few px
   * high while it is loose), not at its highest particle, and water thrown clear above an air gap
   * is spray, drawn from the particles, not a column propped up to it.
   *
   * Where a digit pokes up through the water (the body ends in its cells) the column is unknown and
   * is filled in from its neighbours, so the surface runs on through the digit. A digit just above
   * the body (water pushed off its underside leaves a thin void) still sits in the water; one held
   * clear, with a real gap under it, ends the body before it and hides nothing.
   */
  private updateSurface(): void {
    const n = this.nY
    const h = this.h
    const type = this.cellType
    const s = this.s
    const staticS = this.staticS
    const raw = this.rawSurface
    const rawTop = this.rawTop
    const rawAbove = this.rawAbove
    const known = this.surfaceKnown
    const full = SATURATED * (this.restDensity > 0 ? this.restDensity : 1)
    for (let i = 1; i < this.nX - 1; i++) {
      const floor = this.floorAt[i]
      let base = -1
      let fill = 0
      let solids = 0
      let gap = 0
      let end = n - 1
      for (let j = 1; j < n - 1; j++) {
        const c = i * n + j
        if (staticS[c] === 0) continue
        if (base < 0) base = j
        if (type[c] === FLUID) {
          // The lowest cell holds water only above the floor running through it.
          const room = j === base ? ((j + 1) * h - floor) / h : 1
          fill += solids + room * clamp(this.cellDensity[c] / full, 0, 1)
          solids = 0
          gap = 0
        } else if (s[c] === 0) {
          solids++
          gap = 0
        } else if (++gap >= BODY_GAP) {
          for (let k = j + 1; k <= j + DIGIT_VOID && k < n - 1; k++) {
            const d = i * n + k
            if (s[d] === 0 && staticS[d] !== 0) {
              solids = 1
              break
            }
          }
          end = j
          break
        }
      }
      // The body ends in a digit's cells: the digit pokes up through the water here.
      known[i] = solids > 0 ? 0 : 1
      raw[i] = base < 0 ? floor : floor + fill * h
      // The water above the body: how much, and the top of the highest of it two cells deep. The
      // composite shades water by the water over it, so a crest, or a slab over a pocket of air,
      // takes the body's shade at the same depth (see `top`).
      let above = 0
      let top = -1
      for (let j = end + 1; j < n - 1; j++) {
        const c = i * n + j
        if (type[c] !== FLUID) continue
        const share = clamp(this.cellDensity[c] / full, 0, 1)
        above += share * h
        if (share >= TOP_SHARE && type[c - 1] === FLUID && this.cellDensity[c - 1] >= TOP_SHARE * full) top = (j + share) * h
      }
      rawAbove[i] = above
      rawTop[i] = top
    }
    // Level at the walls: particles keep a radius off the glass, so the column against it is
    // never quite full; the surface meets the wall at its neighbour's height.
    for (const a of [raw, rawTop, rawAbove]) {
      a[1] = a[2]
      a[this.nX - 2] = a[this.nX - 3]
      a[0] = a[1]
      a[this.nX - 1] = a[this.nX - 2]
    }
    known[1] = known[2]
    known[this.nX - 2] = known[this.nX - 3]
    known[0] = known[1]
    known[this.nX - 1] = known[this.nX - 2]
    this.fillUnknown(raw)
    for (let i = 0; i < this.nX; i++) rawTop[i] = Math.max(rawTop[i], raw[i])
    this.smoothInto(raw, this.surface)
    this.smoothInto(rawTop, this.top)
    this.smoothInto(rawAbove, this.above)
  }

  /** Fills the columns a digit hides (surfaceKnown 0) by interpolating between the known columns either side. */
  private fillUnknown(a: Float32Array): void {
    const known = this.surfaceKnown
    let i = 0
    while (i < this.nX) {
      if (known[i]) {
        i++
        continue
      }
      let end = i
      while (end < this.nX && !known[end]) end++
      const left = i > 0 ? a[i - 1] : end < this.nX ? a[end] : this.floorAt[i]
      const right = end < this.nX ? a[end] : left
      for (let k = i; k < end; k++) {
        const t = (k - i + 1) / (end - i + 1)
        a[k] = left + (right - left) * t
      }
      i = end
    }
  }

  /**
   * Smooths a column profile across columns with a 9-tap binomial (four passes of 1-2-1, sigma
   * about 1.4 columns): the partial fill of the top cell carries particle-scale noise that would
   * read as a ragged edge. A wave 20 columns long keeps 90% of its height. Then eases `out`
   * toward it over time so the profile does not flicker. Scratch: `a` is overwritten.
   */
  private smoothInto(a: Float32Array, out: Float32Array): void {
    const last = this.nX - 1
    const b = this.blurSurface
    for (let pass = 0; pass < 2; pass++) {
      for (let k = 0; k <= last; k++) b[k] = 0.25 * a[Math.max(0, k - 1)] + 0.5 * a[k] + 0.25 * a[Math.min(last, k + 1)]
      for (let k = 0; k <= last; k++) a[k] = 0.25 * b[Math.max(0, k - 1)] + 0.5 * b[k] + 0.25 * b[Math.min(last, k + 1)]
    }
    for (let k = 0; k <= last; k++) out[k] = out[k] === 0 ? a[k] : out[k] + (a[k] - out[k]) * 0.5
  }

  /** Water surface height at x (sim units), interpolated between columns. */
  surfaceAt(x: number): number {
    const g = clamp(x * this.invH - 0.5, 0, this.nX - 1.001)
    const i = Math.floor(g)
    const t = g - i
    return this.surface[i] * (1 - t) + this.surface[Math.min(i + 1, this.nX - 1)] * t
  }

  /**
   * The velocity the water actually moved with in the last step: the grid before projection.
   * The projected grid is the wrong field to read: where the drift correction holds the column up
   * against gravity it carries a standing +g dt that the next step's gravity cancels, so still
   * water would read as a steady updraft.
   */
  velocityAt(x: number, y: number, out: { x: number; y: number }): void {
    out.x = this.sampleField(x, y, 0)
    out.y = this.sampleField(x, y, 1)
  }

  private sampleField(x: number, y: number, component: 0 | 1): number {
    const n = this.nY
    const h = this.h
    const h1 = this.invH
    const h2 = 0.5 * h
    const dx = component === 0 ? 0 : h2
    const dy = component === 0 ? h2 : 0
    const f = component === 0 ? this.prevU : this.prevV
    x = clamp(x, h, (this.nX - 1) * h)
    y = clamp(y, h, (this.nY - 1) * h)
    const x0 = Math.min(Math.floor((x - dx) * h1), this.nX - 2)
    const tx = (x - dx - x0 * h) * h1
    const x1 = Math.min(x0 + 1, this.nX - 2)
    const y0 = Math.min(Math.floor((y - dy) * h1), this.nY - 2)
    const ty = (y - dy - y0 * h) * h1
    const y1 = Math.min(y0 + 1, this.nY - 2)
    const sx = 1 - tx
    const sy = 1 - ty
    return sx * sy * f[x0 * n + y0] + tx * sy * f[x1 * n + y0] + tx * ty * f[x1 * n + y1] + sx * ty * f[x0 * n + y1]
  }

  /** True if the grid cell containing (x, y) holds water. */
  isFluid(x: number, y: number): boolean {
    const i = clamp(Math.floor(x * this.invH), 0, this.nX - 1)
    const j = clamp(Math.floor(y * this.invH), 0, this.nY - 1)
    return this.cellType[i * this.nY + j] === FLUID
  }

  /**
   * Mean kinetic energy per particle from how far each particle really moved since `before`, not
   * from the stored velocities (see velocityAt for why those read high in still water). Particles
   * next to a solid (the glass, the sand, a digit) are left out: each step the boundary pushes
   * them back out by a fraction of a cell, and that jitter is not the water moving.
   */
  agitation(before: Float32Array, dt: number): number {
    let e = 0
    let count = 0
    const pos = this.pos
    const s = this.s
    const n = this.nY
    const inv = 1 / dt
    for (let i = 0; i < this.numParticles; i++) {
      const ci = clamp(Math.floor(pos[2 * i] * this.invH), 1, this.nX - 2)
      const cj = clamp(Math.floor(pos[2 * i + 1] * this.invH), 1, this.nY - 2)
      const c = ci * n + cj
      if (s[c - n - 1] * s[c - n] * s[c - n + 1] * s[c - 1] * s[c] * s[c + 1] * s[c + n - 1] * s[c + n] * s[c + n + 1] === 0) continue
      const vx = (pos[2 * i] - before[2 * i]) * inv
      const vy = (pos[2 * i + 1] - before[2 * i + 1]) * inv
      e += vx * vx + vy * vy
      count++
    }
    return count > 0 ? (0.5 * e) / count : 0
  }
}
