// The floating digits: 2D rigid bodies shaped by their glyph's signed distance field. The water
// lifts them (buoyancy from the shared surface profile), drags them along (relative velocity at the
// outline) and they pull the water inside their outline along with them (FlipFluid.coupleDigits).
import { sampleSdf, sampleSdfGradient, type GlyphShape } from './glyph'

import type { Collider, ColliderSample, FlipFluid } from './flip'

export const WATER_DENSITY = 1
/** A little lighter than water: a digit floats with its top just breaking the surface. */
export const DIGIT_DENSITY = 0.95
/**
 * Added mass: a body moving through water has to push water along with it, so it accelerates as if
 * heavier by about the mass of water it displaces (1 for a circle in 2D). Buoyancy and gravity still
 * act on the real mass, so where it floats does not change; it bobs slower and calms faster.
 */
const ADDED_MASS = 1
/**
 * Heave and roll damping (1/s) for the part of a digit under water. A real tank carries a bobbing
 * slab's energy away around it in three dimensions; a 2D one cannot, and the digits kept rocking
 * in still water. This stands in for that loss. It acts in full on slow motion (the noise the
 * solver keeps alive, as SETTLED_DAMPING does for slow particles) and once the water is calm, and
 * fades out for fast motion, so a tossed digit or one riding a wave keeps its swing. Gated on calm
 * alone, it never engaged: the resting noise held calm down, the undamped digits rocked, and their
 * rocking kept the noise up.
 */
const SETTLE_DAMPING = 4
/** Heave (units/s) and roll (rad/s) counted as fast: the settling damping has faded out by here. */
const SETTLE_HEAVE = 0.3
const SETTLE_ROLL = 0.8
const LINEAR_DRAG = 0.35
const QUADRATIC_DRAG = 0.5
/**
 * A ballasted base: the centre of mass sits this fraction of the digit's height below the glyph's
 * centroid. Gravity acting there rights a tilted digit like a weighted toy; without it a floating
 * glyph is only neutrally stable and the part above water (the 4's stem) tips it onto its side.
 */
const BALLAST = 0.25
/**
 * A loose mooring back to its slot, so the 404 always re-forms. Part of it always acts (still water
 * is never perfectly still in a particle solver, and its slow residual currents would otherwise
 * carry the digits off-centre over a minute); the rest joins in as the water calms, so a stirred
 * digit drifts freely and then glides home.
 */
const HOME_ALWAYS = 0.45
/**
 * Mooring rates (rad/s) for a digit one sim unit tall. Smaller digits get faster ones, by the square
 * root of their height (Froude scaling, as for anything moved by gravity and waves): their mass
 * shrinks with area but the residual currents act along their outline, so a fixed rate would leave
 * the small digits of a phone layout further off their slots.
 */
const HOME_RATE = 1.4
const HOME_ANGLE_RATE = 0.55
const FRICTION = 0.6
/** Digits slide over each other more easily than over sand, so a jam clears itself. */
const DIGIT_FRICTION = 0.25
const RESTITUTION = 0.15
const CONTACT_SLOP = 0.002
const BAUMGARTE = 0.4
/** Solver passes over the step's contacts (Box2D Lite's demos use 10; these bodies are few). */
const CONTACT_PASSES = 8
const MAX_SPEED = 9
const MAX_SPIN = 14
const AIR_DAMPING = 0.05
/** Grab spring: the anchor reaches the pointer with this time constant. */
const GRAB_TIME = 0.05
/** A held digit keeps the orientation it was picked up at, lagging by about this much. */
const GRAB_TURN = 0.12
/** The fastest a hand drags a digit that is half or more under water (units/s). */
const WATER_GRAB_SPEED = 1.5

export interface Grab {
  /** Anchor in body space. */
  lx: number
  ly: number
  /** Target in world space. */
  tx: number
  ty: number
  /** Orientation held while carried. */
  angle: number
}

export class Digit implements Collider {
  readonly shape: GlyphShape
  readonly char: string
  x: number
  y: number
  angle = 0
  vx = 0
  vy = 0
  w = 0
  readonly mass: number
  readonly invMass: number
  readonly inertia: number
  readonly invInertia: number
  homeX: number
  homeY: number
  /** How far below the body origin the centre of mass sits. */
  readonly ballast: number
  /** How far to the side of the origin it sits: set by `floatTrim` so the digit floats level. */
  trim = 0
  /** Mooring rates for this digit's size (rad/s). */
  readonly homeRate: number
  readonly homeAngleRate: number
  grab: Grab | null = null
  /** Fraction of the body under water after the last step. */
  submerged = 0

  minX = 0
  minY = 0
  maxX = 0
  maxY = 0
  /** Padding added to the bounds for the solver's broad phase. */
  margin = 0.05

  private cos = 1
  private sin = 0
  private readonly local = { nx: 0, ny: 0 }

  constructor(char: string, shape: GlyphShape, x: number, y: number, density = DIGIT_DENSITY) {
    this.char = char
    this.shape = shape
    this.x = x
    this.y = y
    this.homeX = x
    this.homeY = y
    // Ink at the digit's density; the water in the counters rides along at the water's.
    let mass = 0
    let inertia = 0
    const pts = shape.interior
    for (let i = 0, k = 0; i < pts.length; i += 2, k++) {
      const m = (shape.interiorInk[k] ? density : WATER_DENSITY) * shape.interiorArea
      mass += m
      inertia += m * (pts[i] * pts[i] + pts[i + 1] * pts[i + 1])
    }
    this.mass = mass
    this.invMass = 1 / mass
    const height = shape.maxY - shape.minY
    this.ballast = BALLAST * height
    this.homeRate = HOME_RATE / Math.sqrt(height)
    this.homeAngleRate = HOME_ANGLE_RATE / Math.sqrt(height)
    this.inertia = inertia
    this.invInertia = 1 / inertia
    this.updateTransform()
  }

  updateTransform(): void {
    this.cos = Math.cos(this.angle)
    this.sin = Math.sin(this.angle)
    // Bounds of the rotated ink box.
    const s = this.shape
    const corners = [s.minX, s.minY, s.maxX, s.minY, s.maxX, s.maxY, s.minX, s.maxY]
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (let i = 0; i < 8; i += 2) {
      const wx = this.x + this.cos * corners[i] - this.sin * corners[i + 1]
      const wy = this.y + this.sin * corners[i] + this.cos * corners[i + 1]
      x0 = Math.min(x0, wx)
      y0 = Math.min(y0, wy)
      x1 = Math.max(x1, wx)
      y1 = Math.max(y1, wy)
    }
    this.minX = x0 - this.margin
    this.minY = y0 - this.margin
    this.maxX = x1 + this.margin
    this.maxY = y1 + this.margin
  }

  /** World to body space. */
  toLocal(wx: number, wy: number, out: { x: number; y: number }): void {
    const dx = wx - this.x
    const dy = wy - this.y
    out.x = this.cos * dx + this.sin * dy
    out.y = -this.sin * dx + this.cos * dy
  }

  /** Body to world space. */
  toWorld(lx: number, ly: number, out: { x: number; y: number }): void {
    out.x = this.x + this.cos * lx - this.sin * ly
    out.y = this.y + this.sin * lx + this.cos * ly
  }

  normal(wx: number, wy: number, out: ColliderSample): void {
    const dx = wx - this.x
    const dy = wy - this.y
    sampleSdfGradient(this.shape, this.cos * dx + this.sin * dy, -this.sin * dx + this.cos * dy, this.local)
    out.nx = this.cos * this.local.nx - this.sin * this.local.ny
    out.ny = this.sin * this.local.nx + this.cos * this.local.ny
  }

  distance(wx: number, wy: number): number {
    const dx = wx - this.x
    const dy = wy - this.y
    return sampleSdf(this.shape, this.cos * dx + this.sin * dy, -this.sin * dx + this.cos * dy)
  }

  velocityAt(wx: number, wy: number, out: { x: number; y: number }): void {
    out.x = this.vx - this.w * (wy - this.y)
    out.y = this.vy + this.w * (wx - this.x)
  }

  applyImpulse(px: number, py: number, jx: number, jy: number): void {
    this.vx += jx * this.invMass
    this.vy += jy * this.invMass
    this.w += ((px - this.x) * jy - (py - this.y) * jx) * this.invInertia
  }
}

export interface DigitStepOptions {
  dt: number
  gravity: number
  accelX: number
  accelY: number
  /** The angle a digit floats upright at: gravity's tilt from straight down, so it sits level with the water. */
  upright: number
  /** 0 while the water is churning, 1 once it is calm: scales the pull home. */
  calm: number
  /** Domain size and the floor, for contacts. */
  width: number
  height: number
  wall: number
}

const tmp = { x: 0, y: 0 }
const fluidVel = { x: 0, y: 0 }
const bodyVel = { x: 0, y: 0 }
const normal = { nx: 0, ny: 0 }

/** One step for every digit: forces from the water, contacts, then integration. */
export function stepDigits(digits: readonly Digit[], fluid: FlipFluid, o: DigitStepOptions): void {
  const { dt } = o
  for (const d of digits) applyWaterForces(d, fluid, o)
  for (const d of digits) {
    if (d.grab) applyGrab(d, dt)
  }
  // Contacts against the floor, the walls and each other, then sequential-impulse passes over them.
  contactCount = 0
  for (const d of digits) collectBounds(d, fluid, o)
  for (let a = 0; a < digits.length; a++) {
    for (let b = a + 1; b < digits.length; b++) {
      collectPair(digits[a], digits[b], dt)
      collectPair(digits[b], digits[a], dt)
    }
  }
  for (let pass = 0; pass < CONTACT_PASSES; pass++) {
    for (let k = 0; k < contactCount; k++) solveContact(contactPool[k])
  }
  for (const d of digits) {
    const speed = Math.hypot(d.vx, d.vy)
    if (speed > MAX_SPEED) {
      d.vx *= MAX_SPEED / speed
      d.vy *= MAX_SPEED / speed
    }
    d.w = Math.max(-MAX_SPIN, Math.min(MAX_SPIN, d.w))
    d.x += d.vx * dt
    d.y += d.vy * dt
    d.angle += d.w * dt
    d.updateTransform()
  }
}

function applyWaterForces(d: Digit, fluid: FlipFluid, o: DigitStepOptions): void {
  const s = d.shape
  const dt = o.dt
  let fx = d.mass * o.accelX
  let fy = d.mass * (o.gravity + o.accelY)
  let torque = 0

  // Buoyancy: every interior sample below the surface displaces its share of water.
  let wet = 0
  const pts = s.interior
  const area = s.interiorArea
  for (let i = 0; i < pts.length; i += 2) {
    d.toWorld(pts[i], pts[i + 1], tmp)
    const depth = fluid.surfaceAt(tmp.x) - tmp.y
    if (depth <= 0) continue
    // Partial cover over the top sliver of a sample, so the lift changes smoothly.
    const cover = Math.min(1, depth / Math.sqrt(area))
    const lift = WATER_DENSITY * -o.gravity * area * cover
    // Gravity and the window's shake act on the displaced water too.
    const bx = -WATER_DENSITY * o.accelX * area * cover
    fx += bx
    fy += lift - WATER_DENSITY * o.accelY * area * cover
    torque += (tmp.x - d.x) * (lift - WATER_DENSITY * o.accelY * area * cover) - (tmp.y - d.y) * bx
    wet += cover
  }
  d.submerged = pts.length > 0 ? wet / (pts.length / 2) : 0

  // Drag at the outline against the water just outside it.
  const b = s.boundary
  const bn = s.boundaryNormal
  const ds = s.boundaryLength
  const probe = 3 * fluid.h
  for (let i = 0; i < b.length; i += 2) {
    d.toWorld(b[i], b[i + 1], tmp)
    const px = tmp.x
    const py = tmp.y
    if (fluid.surfaceAt(px) < py) continue
    const wnx = Math.cos(d.angle) * bn[i] - Math.sin(d.angle) * bn[i + 1]
    const wny = Math.sin(d.angle) * bn[i] + Math.cos(d.angle) * bn[i + 1]
    fluid.velocityAt(px + wnx * probe, py + wny * probe, fluidVel)
    d.velocityAt(px, py, bodyVel)
    const rx = fluidVel.x - bodyVel.x
    const ry = fluidVel.y - bodyVel.y
    const speed = Math.hypot(rx, ry)
    const k = ds * (LINEAR_DRAG + QUADRATIC_DRAG * speed)
    const dfx = k * rx
    const dfy = k * ry
    fx += dfx
    fy += dfy
    torque += (px - d.x) * dfy - (py - d.y) * dfx
  }

  // Gravity and the window's shake act at the ballasted centre of mass, below the origin: the
  // torque rights the digit, and a shaken window swings it like a pendulum. The mooring pulls it
  // back to its slot, wherever it is, so a digit left lying across the others still slides home.
  // Never against a hand.
  if (!d.grab) {
    const wrapped = Math.atan2(Math.sin(d.angle - o.upright), Math.cos(d.angle - o.upright))
    torque += d.mass * d.ballast * (Math.sin(d.angle) * (o.gravity + o.accelY) + Math.cos(d.angle) * o.accelX)
    torque += d.mass * d.trim * (Math.cos(d.angle) * (o.gravity + o.accelY) - Math.sin(d.angle) * o.accelX)
    const home = HOME_ALWAYS + (1 - HOME_ALWAYS) * o.calm
    fx += d.mass * d.homeRate * d.homeRate * (d.homeX - d.x) * home
    torque += -d.inertia * d.homeAngleRate * d.homeAngleRate * wrapped * home
    // Half-critically damp the pull home so the digits glide into place instead of swinging.
    fx += -d.mass * d.homeRate * d.vx * home
    torque += -d.inertia * d.homeAngleRate * d.w * home
    const slowHeave = Math.max(o.calm, 1 - Math.abs(d.vy) / SETTLE_HEAVE)
    const slowRoll = Math.max(o.calm, 1 - Math.abs(d.w) / SETTLE_ROLL)
    fy += -d.mass * SETTLE_DAMPING * d.vy * d.submerged * slowHeave
    torque += -d.inertia * SETTLE_DAMPING * d.w * d.submerged * slowRoll
  }

  // Air resistance is tiny; water drag above does the real damping.
  const air = 1 - AIR_DAMPING * dt
  const added = ADDED_MASS * WATER_DENSITY * area * wet
  const invMass = 1 / (d.mass + added)
  const invInertia = 1 / (d.inertia * (1 + added / d.mass))
  d.vx = (d.vx + fx * invMass * dt) * air
  d.vy = (d.vy + fy * invMass * dt) * air
  d.w = (d.w + torque * invInertia * dt) * air
}

/**
 * The height at which a digit of this shape and mass floats upright in still water at `level`:
 * where the water its interior samples displace weighs as much as it does. Bisection over y.
 */
export function floatHeight(shape: GlyphShape, mass: number, level: number): number {
  const pts = shape.interior
  const area = shape.interiorArea
  const displaced = (y: number) => {
    let a = 0
    for (let i = 1; i < pts.length; i += 2) {
      const depth = level - (y + pts[i])
      if (depth > 0) a += area * Math.min(1, depth / Math.sqrt(area))
    }
    return WATER_DENSITY * a
  }
  // Fully under: y low enough that the top is below the level. Fully out: the bottom above it.
  let lo = level - shape.maxY - 0.01
  let hi = level - shape.minY + 0.01
  if (displaced(lo) < mass) return lo
  for (let k = 0; k < 40; k++) {
    const mid = 0.5 * (lo + hi)
    if (displaced(mid) > mass) lo = mid
    else hi = mid
  }
  return 0.5 * (lo + hi)
}

/**
 * The ballast's sideways offset that floats a digit level at `y` in still water at `level`: the x
 * (body space) of the centre of the water it displaces there. A glyph with more of itself above
 * water on one side (the 4's stem and apex) is lifted off-centre and lists; with its weight set
 * under that centre, as a ship is trimmed, it floats level.
 */
export function floatTrim(shape: GlyphShape, y: number, level: number): number {
  const pts = shape.interior
  const side = Math.sqrt(shape.interiorArea)
  let sum = 0
  let weight = 0
  for (let i = 0; i < pts.length; i += 2) {
    const depth = level - (y + pts[i + 1])
    if (depth <= 0) continue
    // The same partial cover the buoyancy uses.
    const cover = Math.min(1, depth / side)
    sum += pts[i] * cover
    weight += cover
  }
  return weight > 0 ? sum / weight : 0
}

/** A stiff spring from the grab anchor to the pointer, solved as a velocity target. */
function applyGrab(d: Digit, dt: number): void {
  const g = d.grab
  if (!g) return
  d.toWorld(g.lx, g.ly, tmp)
  const ax = tmp.x
  const ay = tmp.y
  d.velocityAt(ax, ay, bodyVel)
  let targetVx = (g.tx - ax) / GRAB_TIME
  let targetVy = (g.ty - ay) / GRAB_TIME
  // The water holds a slab back: a hand drags it through the water no faster than this, while
  // out of the water it follows the pointer freely. Dragged at speed v, a digit throws water about
  // v^2 / 2g high: 0.2 units here, where 9 units/s threw it past the top of the view. It holds
  // from first contact, since a digit skimming the top of the water still plows it. Measured on
  // a hard drag at 1440x900: the water peaks at 62% of the view at 2 units/s, 72% at 3.
  const contact = Math.min(1, d.submerged / 0.15)
  const limit = MAX_SPEED + (WATER_GRAB_SPEED - MAX_SPEED) * contact * (2 - contact)
  const speed = Math.hypot(targetVx, targetVy)
  if (speed > limit) {
    targetVx *= limit / speed
    targetVy *= limit / speed
  }
  const rx = ax - d.x
  const ry = ay - d.y
  // Effective mass along x and y at the anchor (ignoring the cross term, close enough for a hand).
  const kx = d.invMass + ry * ry * d.invInertia
  const ky = d.invMass + rx * rx * d.invInertia
  const blend = Math.min(1, dt / GRAB_TIME)
  d.applyImpulse(ax, ay, ((targetVx - bodyVel.x) / kx) * blend, ((targetVy - bodyVel.y) / ky) * blend)
  // Held firmly: the digit turns back toward the orientation it was picked up at instead of
  // swinging from the grip like a pendulum. A fast drag still tilts it for a moment.
  const turn = Math.atan2(Math.sin(g.angle - d.angle), Math.cos(g.angle - d.angle))
  d.w += (turn / GRAB_TURN - d.w) * Math.min(1, dt / 0.03)
}

/**
 * One contact for this step: a boundary point of body `a` pushed out of the floor, a wall or body
 * `b` along n. Its point, normal, effective masses and target are fixed for the step; the normal
 * and friction impulses accumulate over the passes and are clamped as totals, as in Box2D Lite
 * (Arbiter::ApplyImpulse), so a pass that pushed too hard is taken back by the next instead of
 * leaving energy in a jammed stack.
 */
interface Contact {
  a: Digit
  b: Digit | null
  px: number
  py: number
  nx: number
  ny: number
  friction: number
  massN: number
  massT: number
  /** Normal velocity to reach: a little bounce, plus pushing out the penetration. */
  target: number
  pn: number
  pt: number
}

/** Contacts are reused from step to step; `contactCount` of them are live. */
const contactPool: Contact[] = []
let contactCount = 0

/** Relative velocity of a against b (or the static world) at a point. */
function relativeVelocity(a: Digit, b: Digit | null, px: number, py: number, out: { x: number; y: number }): void {
  a.velocityAt(px, py, out)
  if (b) {
    b.velocityAt(px, py, tmp)
    out.x -= tmp.x
    out.y -= tmp.y
  }
}

function addContact(a: Digit, b: Digit | null, px: number, py: number, nx: number, ny: number, depth: number, dt: number, friction: number): void {
  if (contactCount === contactPool.length) {
    contactPool.push({ a, b, px: 0, py: 0, nx: 0, ny: 0, friction: 0, massN: 0, massT: 0, target: 0, pn: 0, pt: 0 })
  }
  const c = contactPool[contactCount++]
  const tx = -ny
  const ty = nx
  const rax = px - a.x
  const ray = py - a.y
  const rnA = rax * ny - ray * nx
  const rtA = rax * ty - ray * tx
  let kn = a.invMass + rnA * rnA * a.invInertia
  let kt = a.invMass + rtA * rtA * a.invInertia
  if (b) {
    const rbx = px - b.x
    const rby = py - b.y
    const rnB = rbx * ny - rby * nx
    const rtB = rbx * ty - rby * tx
    kn += b.invMass + rnB * rnB * b.invInertia
    kt += b.invMass + rtB * rtB * b.invInertia
  }
  relativeVelocity(a, b, px, py, bodyVel)
  const vn = bodyVel.x * nx + bodyVel.y * ny
  c.a = a
  c.b = b
  c.px = px
  c.py = py
  c.nx = nx
  c.ny = ny
  c.friction = friction
  c.massN = 1 / kn
  c.massT = 1 / kt
  c.target = Math.max(-RESTITUTION * vn, 0) + (BAUMGARTE / dt) * Math.max(0, depth - CONTACT_SLOP)
  c.pn = 0
  c.pt = 0
}

function applyContactImpulse(c: Contact, jx: number, jy: number): void {
  c.a.applyImpulse(c.px, c.py, jx, jy)
  c.b?.applyImpulse(c.px, c.py, -jx, -jy)
}

function solveContact(c: Contact): void {
  relativeVelocity(c.a, c.b, c.px, c.py, bodyVel)
  const vn = bodyVel.x * c.nx + bodyVel.y * c.ny
  const pn = Math.max(c.pn + (c.target - vn) * c.massN, 0)
  const jn = pn - c.pn
  c.pn = pn
  applyContactImpulse(c, c.nx * jn, c.ny * jn)
  // Coulomb friction along the tangent, bounded by the normal impulse accumulated so far.
  relativeVelocity(c.a, c.b, c.px, c.py, bodyVel)
  const tx = -c.ny
  const ty = c.nx
  const vt = bodyVel.x * tx + bodyVel.y * ty
  const limit = c.friction * c.pn
  const pt = Math.max(-limit, Math.min(limit, c.pt - vt * c.massT))
  const jt = pt - c.pt
  c.pt = pt
  applyContactImpulse(c, tx * jt, ty * jt)
}

/** Boundary samples of d below the floor or past a wall. */
function collectBounds(d: Digit, fluid: FlipFluid, o: DigitStepOptions): void {
  const b = d.shape.boundary
  const left = o.wall
  const right = o.width - o.wall
  const top = o.height - o.wall
  for (let i = 0; i < b.length; i += 2) {
    d.toWorld(b[i], b[i + 1], tmp)
    const px = tmp.x
    const py = tmp.y
    const floor = fluid.floorHeight(px)
    if (py < floor) {
      // Floor normal from its slope.
      const e = 0.01
      const slope = (fluid.floorHeight(px + e) - fluid.floorHeight(px - e)) / (2 * e)
      const len = Math.hypot(slope, 1)
      addContact(d, null, px, py, -slope / len, 1 / len, floor - py, o.dt, FRICTION)
    }
    if (px < left) addContact(d, null, px, py, 1, 0, left - px, o.dt, FRICTION)
    if (px > right) addContact(d, null, px, py, -1, 0, px - right, o.dt, FRICTION)
    if (py > top) addContact(d, null, px, py, 0, -1, py - top, o.dt, FRICTION)
  }
}

/** Boundary samples of `a` that have sunk into `b`. */
function collectPair(a: Digit, b: Digit, dt: number): void {
  if (a.maxX < b.minX || b.maxX < a.minX || a.maxY < b.minY || b.maxY < a.minY) return
  const pts = a.shape.boundary
  for (let i = 0; i < pts.length; i += 2) {
    a.toWorld(pts[i], pts[i + 1], tmp)
    const px = tmp.x
    const py = tmp.y
    if (px < b.minX || px > b.maxX || py < b.minY || py > b.maxY) continue
    const dist = b.distance(px, py)
    if (dist >= 0) continue
    b.normal(px, py, normal)
    // b's outward normal points from b toward a's point: push a along it.
    addContact(a, b, px, py, normal.nx, normal.ny, -dist, dt, DIGIT_FRICTION)
  }
}

/** The digit under a world point, if any (for grabbing). */
export function digitAt(digits: readonly Digit[], x: number, y: number, slack: number): Digit | null {
  let best: Digit | null = null
  let bestD = slack
  for (const d of digits) {
    if (x < d.minX - slack || x > d.maxX + slack || y < d.minY - slack || y > d.maxY + slack) continue
    const dist = d.distance(x, y)
    if (dist < bestD) {
      bestD = dist
      best = d
    }
  }
  return best
}
