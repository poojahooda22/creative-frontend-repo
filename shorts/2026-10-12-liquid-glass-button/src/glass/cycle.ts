import type { LabelLayout } from './labels'
import { PILL } from './labels'
import {
  clamp01,
  inCubic,
  inOutCubic,
  inQuad,
  linear,
  mix,
  mulberry32,
  outCubic,
  outQuad,
  outQuart,
  ring,
  smoothstep,
  track,
  type Key,
} from './motion'

/**
 * The ten-second life of the button, timed from the reference:
 *
 * | Time (s)   | Beat |
 * |------------|------|
 * | 0 to 1.0   | The last label's pill and the next one glide in from either side and fuse into one |
 * | 1.25 to 2.95 | A light wakes by the arrow; a groove runs through the glass from the left cap to the right |
 * | 2.9 to 4.7 | The groove reaches the right cap and the split begins: the waist necks, the word's lobe swells, the arrow's lobe shrinks; the camera drops |
 * | 4.7        | The thread breaks into satellite droplets |
 * | 4.7 to 6.2 | Two drops float apart, bobbing |
 * | 6.2 to 6.8 | The small drop swings back in front and meets the big one: a collar of liquid and a spray |
 * | 6.8 to 8.9 | The merged body stretches back into the pill; the camera rises and settles |
 * | 9.0 to 10  | Rest |
 *
 * Everything is a pure function of cycle time, so any instant can be rendered and compared.
 */
export const CYCLE_SECONDS = 10
export const MAX_DROPS = 16
/** The groove reaches the right cap here, and its arrival starts the split. */
export const SPLIT_START = 2.9
/**
 * The light wakes here. Until now the state is the resting pill, so a press at rest replays the
 * whole wake (light, groove, split) from this instant without a pop, and a press during the merge
 * fast-forwards to it.
 */
export const WAKE_FROM = 1.25
// Starts once the last track (camera, floor, warmth: 8.9 s) has settled, so a press at rest can
// jump to WAKE_FROM without a pop. The cycle tests hold this.
export const REST_FROM = 9.0
/** A representative resting instant, used for the reduced-motion still. */
export const STILL_TIME = 9.4
/** Camera elevation at rest, in degrees. */
export const REST_ELEVATION = 24

// The resting outline sags about 6% of its height between the lobes, in one gentle curve from cap
// to cap (measured on the reference's re-formed pill, 8.75 to 9.5 s).
const REST_WAIST = 0.47
/** At rest the join's ends stand this much prouder than the lobe radius, so the sag starts at the caps. */
export const PILL_ENDS = 1.06
// Below this waist the join is a neck and takes the pinching profile.
const NECK_WAIST = 0.3
const REST_K = 0.25
// Nearly round in section, like the reference's thick blob of water.
const REST_DEPTH = 0.95
// The front face magnifies the label about 1.33 times vertically (single-surface refraction, index
// 1.38, label on the mid plane 0.475 behind a front of curvature radius 0.53); this cancels it.
const REST_TEXT_SQUASH = 0.75
// A round drop magnifies about 1.38 times; this keeps the word near 60% of the drop's width,
// as in the reference.
const DROP_TEXT_SCALE = 0.7
// Ball-lens magnification of a round drop (index 1.38, label through its centre).
const DROP_MAGNIFICATION = 1.38
// Where the two pills start, either side of centre (world units), and when they have fused.
const MERGE_FROM = 2.6
const MERGE_DONE = 0.95
const PINCH_T = 4.64
const SPLASH_T = 6.56
const SPLASH_LIFE = 0.8
const GRAVITY = -0.22
const DEG = Math.PI / 180
// Volume of the reference pill (half-length 0.82, radius 0.5) as capsule plus sphere.
const REFERENCE_VOLUME = pillVolume(0.82, PILL.radius)

export interface Lobe {
  x: number
  y: number
  z: number
  r: number
  /** Volume-preserving stretch along x; y and z shrink by its square root. */
  stretch: number
}

export interface Placement {
  x: number
  y: number
  z: number
  alpha: number
}

export interface Body {
  enabled: boolean
  label: LabelLayout | null
  a: Lobe
  b: Lobe
  /** Radius of the join at its middle: a slight waist at rest, zero at the break. */
  waist: number
  /** 1 while the lobes are one body; 0 once the broken thread has pulled back into the drops. */
  connect: number
  /** The join's profile: 1 is the resting pill's gentle sag, 0 a neck that can pinch to a point. */
  pill: number
  k: number
  /** Front-to-back flattening: a lozenge at rest, round once it splits into drops. */
  depth: number
  /** Label scale: the shallow pill barely magnifies, a round drop magnifies like a ball lens. */
  textScaleX: number
  textScaleY: number
  word: Placement
  arrow: Placement
  divider: Placement
}

export interface Drop {
  x: number
  y: number
  z: number
  r: number
  /** Tail offset from the head: drops stretch along their velocity. */
  tx: number
  ty: number
  tz: number
}

/**
 * The collar of liquid thrown up where the small drop meets the big one: a ring around the line of
 * impact (a unit axis), with fingers that rise from it and end in beads. All sizes in world units;
 * a collar of 0 with fingers of 0 means no crown.
 */
export interface Crown {
  x: number
  y: number
  z: number
  ax: number
  ay: number
  az: number
  ring: number
  collar: number
  finger: number
  fingerRadius: number
  tipRadius: number
}

export interface CycleState {
  /** 0 is the current label; 1 is the previous label while it melts into it. */
  bodies: [Body, Body]
  drops: Drop[]
  dropCount: number
  crown: Crown
  wave: { x: number; amplitude: number; width: number; wavenumber: number }
  orb: { x: number; y: number; z: number; intensity: number }
  camElevation: number
  camDistance: number
  floorY: number
  warmth: number
  textBlur: number
}

function lobe(): Lobe {
  return { x: 0, y: 0, z: 0, r: PILL.radius, stretch: 0 }
}

function placement(): Placement {
  return { x: 0, y: 0, z: 0, alpha: 0 }
}

function body(): Body {
  return {
    enabled: false,
    label: null,
    a: lobe(),
    b: lobe(),
    waist: REST_WAIST,
    connect: 1,
    pill: 1,
    k: REST_K,
    depth: REST_DEPTH,
    textScaleX: 1,
    textScaleY: REST_TEXT_SQUASH,
    word: placement(),
    arrow: placement(),
    divider: placement(),
  }
}

export function createCycleState(): CycleState {
  return {
    bodies: [body(), body()],
    drops: Array.from({ length: MAX_DROPS }, () => ({ x: 0, y: 0, z: 0, r: 0, tx: 0, ty: 0, tz: 0 })),
    dropCount: 0,
    crown: {
      x: 0,
      y: 0,
      z: 0,
      ax: IMPACT_AXIS[0],
      ay: IMPACT_AXIS[1],
      az: IMPACT_AXIS[2],
      ring: 0,
      collar: 0,
      finger: 0,
      fingerRadius: 0,
      tipRadius: 0,
    },
    // A narrow groove (a Gaussian dent, wavenumber 0) that rings the pill as it travels.
    wave: { x: 0, amplitude: 0, width: 0.18, wavenumber: 0 },
    orb: { x: 0, y: 0, z: 0, intensity: 0 },
    camElevation: REST_ELEVATION * DEG,
    camDistance: 1,
    floorY: -0.56,
    warmth: 0,
    textBlur: 0,
  }
}

function pillVolume(halfLength: number, radius: number): number {
  return Math.PI * radius * radius * 2 * halfLength + (4 / 3) * Math.PI * radius ** 3
}

// ---- Tracks that do not depend on the label: built once. ----

const CONNECT: Key[] = [
  [PINCH_T - 0.08, 1],
  [PINCH_T + 0.14, 0, outQuad],
  [6.62, 0],
  [6.9, 1],
]
const ROUND: Key[] = [
  [3.1, 0],
  [4.3, 1],
  [6.9, 1],
  [8.2, 0],
]
// A wide smooth union while the waist necks makes the neck a smooth saddle, not a rod.
const SMOOTH_UNION: Key[] = [
  [SPLIT_START, REST_K],
  [3.6, 0.32],
  [4.3, 0.3],
  [PINCH_T, 0.24],
  [5.0, 0.14],
  [6.3, 0.3],
  [8.3, REST_K],
]
const DIVIDER: Key[] = [
  [3.25, 1],
  [3.85, 0],
  [8.0, 0],
  [8.6, 1],
]
const ORB_INTENSITY: Key[] = [
  [WAKE_FROM, 0],
  [1.5, 1, outCubic],
  [2.6, 1],
  [2.95, 0],
]
// The groove is born as a dent in the left cap at 1.45 s, runs right, and is spent as it reaches
// the right cap at 2.95 s. Negative: it dents inward.
const WAVE_AMPLITUDE: Key[] = [
  [1.35, 0],
  [1.5, -0.085, outQuad],
  [2.75, -0.08],
  [3.0, 0],
]
const CAM_ELEVATION: Key[] = [
  [3.0, REST_ELEVATION],
  [4.1, 6],
  [7.4, 5],
  [8.9, REST_ELEVATION],
]
const CAM_DISTANCE: Key[] = [
  [3.0, 1],
  [4.1, 1.1],
  [7.4, 1.1],
  [8.9, 1],
]
const FLOOR_Y: Key[] = [
  [3.0, -0.56],
  [4.1, -1.05],
  [7.4, -1.05],
  [8.9, -0.56],
]
const WARMTH: Key[] = [
  [3.2, 0],
  [4.6, 1],
  [7.4, 1],
  [8.9, 0],
]
const TEXT_BLUR: Key[] = [
  [3.7, 0],
  [4.7, 1],
  [6.9, 1],
  [8.2, 0],
]
const SPLIT_CENTRE: Key[] = [
  [3.3, 0],
  [PINCH_T, 1],
  [6.9, 1],
  [8.2, 0],
]
// The small drop passes in front of the big one as it comes back.
const B_Z: Key[] = [
  [6.0, 0],
  [6.7, 0.45],
  [7.8, 0],
]
// The waist pinches as soon as the groove arrives, then thins to a thread.
const WAIST: Key[] = [
  [SPLIT_START, REST_WAIST],
  [3.3, 0.3],
  [3.65, 0.2],
  [4.45, 0.12],
  [PINCH_T + 0.02, 0, inQuad],
  [6.85, 0],
  [8.2, REST_WAIST, outCubic],
]
// The leaving pill's word fades as the two fuse; its lobes shrink inside the new pill so the
// smooth union can let go of it without a pop.
const OLD_WORD: Key[] = [
  [0.3, 1],
  [0.7, 0],
]
const OLD_MELT: Key[] = [
  [0.4, 0],
  [MERGE_DONE, 1, inOutCubic],
]

// ---- Tracks that scale with the pill's length: built once per label. ----

interface LabelTracks {
  ax: Key[]
  bx: Key[]
  ar: Key[]
  br: Key[]
  orbX: Key[]
  waveX: Key[]
  dropScale: number
}

const labelTracks = new WeakMap<LabelLayout, LabelTracks>()

function tracksFor(layout: LabelLayout): LabelTracks {
  const cached = labelTracks.get(layout)
  if (cached) return cached
  const L = layout.halfLength
  const scale = volumeScale(L)
  // Bigger pills split into bigger drops.
  const rBig = 0.66 * scale
  const rSmall = 0.42 * scale
  const tracks: LabelTracks = {
    ax: [
      [SPLIT_START, -L],
      [3.5, -L - 0.1],
      [PINCH_T + 0.06, -0.6 * L],
      [6.05, -0.67 * L, outQuad],
      [6.6, -0.55 * L],
      [7.1, -0.58 * L],
      [8.2, -L, outQuart],
    ],
    bx: [
      [SPLIT_START, L],
      [3.3, L + 0.22],
      [PINCH_T + 0.06, 1.2 * L],
      [5.55, 1.34 * L, outQuad],
      [6.1, 1.3 * L, inOutCubic],
      [6.72, 0.1 * L, inCubic],
      // Held inside the big drop, as a lens, before it draws back out into the pill.
      [7.35, 0.2 * L],
      [8.2, L, outQuart],
    ],
    ar: [
      [SPLIT_START, PILL.radius],
      [3.9, PILL.radius * 1.03],
      [PINCH_T + 0.06, rBig],
      [6.9, rBig],
      [8.3, PILL.radius],
    ],
    br: [
      [SPLIT_START, PILL.radius],
      // The groove's mass lands in the right lobe: it swells first.
      [3.2, PILL.radius * 1.15],
      [PINCH_T + 0.06, rSmall],
      [6.9, rSmall],
      [8.3, PILL.radius],
    ],
    orbX: [
      [WAKE_FROM, layout.dividerX + 0.05],
      [2.2, layout.arrowX - 0.2],
      [2.95, L + 0.22],
    ],
    // From the left cap to the right one: the pill's ends sit at L + 0.5.
    waveX: [
      [1.45, -L - 0.42],
      [2.95, L + 0.42, linear],
    ],
    dropScale: Math.min(DROP_TEXT_SCALE, (0.62 * 2 * rBig) / (layout.wordWidth * DROP_MAGNIFICATION)),
  }
  labelTracks.set(layout, tracks)
  return tracks
}

/** Bigger pills split into bigger drops: radii scale with the cube root of the volume. */
function volumeScale(halfLength: number): number {
  return Math.cbrt(pillVolume(halfLength, PILL.radius) / REFERENCE_VOLUME)
}

// ---- Droplet sprays: fixed seeds, so every cycle splashes the same way. ----

interface DropSpec {
  /** Position along the spray's anchor (0..1) or ring angle. */
  u: number
  r: number
  vx: number
  vy: number
  vz: number
  life: number
  drag: number
}

const pinchSpray: DropSpec[] = (() => {
  const rand = mulberry32(7)
  return Array.from({ length: 6 }, (_, i) => {
    const up = i % 2 === 0 ? 1 : -1
    return {
      u: 0.15 + 0.7 * rand(),
      r: 0.02 + 0.026 * rand(),
      vx: (rand() - 0.5) * 0.3,
      vy: up * (0.3 + 0.5 * rand()),
      vz: 0.15 + 0.35 * rand(),
      life: 1.3 + 0.5 * rand(),
      drag: 1.8,
    }
  })
})()

// The small drop comes back from the right and in front, so the impact runs along this axis.
// Tilted toward the camera, the crown reads as a ring rather than a line seen edge-on.
const IMPACT_AXIS: readonly [number, number, number] = (() => {
  const v = [1, 0.08, 0.9]
  const n = Math.hypot(v[0], v[1], v[2])
  return [v[0] / n, v[1] / n, v[2] / n] as const
})()

const splashSpray: DropSpec[] = (() => {
  const rand = mulberry32(19)
  const count = 12
  // A basis around the impact axis: the spray leaves in the plane of the crown.
  const [ax, ay, az] = IMPACT_AXIS
  const ul = Math.hypot(az, ax)
  const u = [-az / ul, 0, ax / ul]
  const v = [ay * u[2] - az * u[1], az * u[0] - ax * u[2], ax * u[1] - ay * u[0]]
  return Array.from({ length: count }, (_, i) => {
    const angle = ((i + 0.9 * rand()) / count) * Math.PI * 2
    const speed = 1.0 + 1.6 * rand() ** 2
    const lift = -0.1 + 0.7 * rand()
    const dx = Math.cos(angle) * u[0] + Math.sin(angle) * v[0] + lift * ax
    const dy = Math.cos(angle) * u[1] + Math.sin(angle) * v[1] + lift * ay
    const dz = Math.cos(angle) * u[2] + Math.sin(angle) * v[2] + lift * az
    const n = Math.hypot(dx, dy, dz)
    return {
      u: angle,
      r: 0.024 + 0.03 * rand(),
      vx: (dx / n) * speed,
      vy: (dy / n) * speed,
      vz: (dz / n) * speed,
      life: 1.0 + 0.8 * rand(),
      drag: 1.7,
    }
  })
})()

/** Exponential drag and light gravity, integrated in closed form. */
function flyDrop(spec: DropSpec, age: number, ox: number, oy: number, oz: number, out: Drop): void {
  const decay = Math.exp(-spec.drag * age)
  const travel = (1 - decay) / spec.drag
  out.x = ox + spec.vx * travel
  out.y = oy + spec.vy * travel + 0.5 * GRAVITY * age * age
  out.z = oz + spec.vz * travel
  const vx = spec.vx * decay
  const vy = spec.vy * decay + GRAVITY * age
  const vz = spec.vz * decay
  out.r = spec.r * smoothstep(0, 0.08, age) * (1 - smoothstep(0.7 * spec.life, spec.life, age))
  // Tail length grows with speed (0.06 s of travel), capped at 0.12: round beads with short
  // tapering tails, the way small drops look once surface tension has pulled them in.
  const tail = Math.min(0.06, 0.12 / (Math.hypot(vx, vy, vz) + 1e-3))
  out.tx = -vx * tail
  out.ty = -vy * tail
  out.tz = -vz * tail
}

// ---- Body ----

interface Split {
  /** 0 at rest, 1 once the word and arrow have centred in their own drops. */
  centre: number
}

/** Lobe positions and radii of the current body during the split and its return. Returns the waist radius. */
function splitLobes(t: number, layout: LabelLayout, a: Lobe, b: Lobe, split: Split): number {
  const tr = tracksFor(layout)
  a.x = track(t, tr.ax)
  b.x = track(t, tr.bx)
  a.r = track(t, tr.ar)
  b.r = track(t, tr.br)
  b.z = track(t, B_Z)
  a.z = 0
  const float = smoothstep(4.4, 5.0, t) * (1 - smoothstep(6.2, 6.7, t))
  a.y = 0.035 * Math.sin(2 * Math.PI * 0.42 * (t - 4.4)) * float
  b.y = 0.05 * Math.sin(2 * Math.PI * 0.47 * (t - 4.3) + 1.1) * float
  split.centre = track(t, SPLIT_CENTRE)
  return track(t, WAIST)
}

/** The two pills glide toward each other; they touch at about 0.42 s and share a centre by 0.85 s. */
function mergeOffset(t: number, from: number): number {
  return from * (1 - inOutCubic(clamp01(t / 0.85)))
}

function jiggleA(t: number): number {
  return (
    ring(t, 0.85, 0.07, 2.4, 4.0) +
    ring(t, PINCH_T, -0.05, 2.8, 3.2) +
    ring(t, SPLASH_T, -0.11, 3.0, 3.4) +
    ring(t, 8.0, 0.05, 2.2, 3.0)
  )
}

function jiggleB(t: number): number {
  return (
    ring(t, 0.85, 0.07, 2.4, 4.0) +
    ring(t, PINCH_T, 0.1, 3.4, 3.0) +
    ring(t, SPLASH_T, 0.08, 3.6, 3.6) +
    ring(t, 8.0, 0.05, 2.2, 3.0)
  )
}

function placeLabel(bd: Body, layout: LabelLayout, centre: number, dividerAlpha: number, alpha: number): void {
  const L = layout.halfLength
  bd.word.x = bd.a.x + (layout.wordX + L) * (1 - centre)
  bd.word.y = bd.a.y
  bd.word.z = bd.a.z
  bd.word.alpha = alpha
  bd.arrow.x = bd.b.x + (layout.arrowX - L) * (1 - centre)
  bd.arrow.y = bd.b.y
  bd.arrow.z = bd.b.z
  bd.arrow.alpha = alpha
  bd.divider.x = bd.a.x + layout.dividerX + L
  bd.divider.y = mix(bd.a.y, bd.b.y, 0.5)
  bd.divider.z = 0
  bd.divider.alpha = dividerAlpha * alpha
}

function restBody(bd: Body, layout: LabelLayout, offsetX: number, stretch: number): void {
  const L = layout.halfLength
  bd.enabled = true
  bd.label = layout
  bd.a.x = -L + offsetX
  bd.b.x = L + offsetX
  bd.a.y = bd.b.y = 0
  bd.a.z = bd.b.z = 0
  bd.a.r = bd.b.r = PILL.radius
  bd.a.stretch = bd.b.stretch = stretch
  bd.waist = REST_WAIST
  bd.connect = 1
  bd.pill = 1
  bd.k = REST_K
  bd.depth = REST_DEPTH
  bd.textScaleX = 1
  bd.textScaleY = REST_TEXT_SQUASH
  placeLabel(bd, layout, 0, 1, 1)
}

/** The join morphs from the pill's sag to the neck's profile as the waist thins, and back. */
function pillProfile(waist: number): number {
  return smoothstep(NECK_WAIST, REST_WAIST, waist)
}

/** Stretch along x from the speed of a glide, capped so a fast move never smears the glass. */
function glideStretch(t: number, from: number): number {
  const speed = Math.abs(mergeOffset(t + 0.01, from) - mergeOffset(t - 0.01, from)) / 0.02
  return Math.min(0.1, speed * 0.012)
}

const scratchA = lobe()
const scratchB = lobe()
const scratchSplit: Split = { centre: 0 }

/**
 * Samples the cycle at time t (seconds, 0..CYCLE_SECONDS) into `out`.
 * `previous` is the label whose pill melts into the current one, or null when there is none.
 */
export function sampleCycle(t: number, current: LabelLayout, previous: LabelLayout | null, out: CycleState): void {
  const L = current.halfLength
  const tr = tracksFor(current)
  const [cur, prev] = out.bodies

  // The merge: the new pill glides in from the right; the old one from the left melts into it.
  restBody(cur, current, mergeOffset(t, MERGE_FROM), glideStretch(t, MERGE_FROM))
  if (previous && t < MERGE_DONE) {
    restBody(prev, previous, mergeOffset(t, -MERGE_FROM), glideStretch(t, -MERGE_FROM))
    const melt = track(t, OLD_MELT)
    // Shrink the old lobes toward the middle of the new pill so nothing is left to let go of.
    const Lp = mix(previous.halfLength, 0.4 * L, melt)
    const centre = mergeOffset(t, -MERGE_FROM)
    prev.a.x = centre - Lp
    prev.b.x = centre + Lp
    prev.a.r = prev.b.r = mix(PILL.radius, 0.28, melt)
    prev.waist = mix(REST_WAIST, 0.25, melt)
    prev.pill = pillProfile(prev.waist)
    prev.k = mix(REST_K, 0.06, melt)
    placeLabel(prev, previous, 0, 1, track(t, OLD_WORD))
  } else {
    prev.enabled = false
  }

  // Split and return.
  const waist = splitLobes(t, current, scratchA, scratchB, scratchSplit)
  if (t > SPLIT_START) {
    cur.a.x = scratchA.x
    cur.a.y = scratchA.y
    cur.a.z = scratchA.z
    cur.a.r = scratchA.r
    cur.b.x = scratchB.x
    cur.b.y = scratchB.y
    cur.b.z = scratchB.z
    cur.b.r = scratchB.r
    cur.waist = waist
    cur.pill = pillProfile(waist)
    cur.connect = track(t, CONNECT)
    cur.depth = mix(REST_DEPTH, 1, track(t, ROUND))
    cur.textScaleX = mix(1, tr.dropScale, scratchSplit.centre)
    cur.textScaleY = mix(REST_TEXT_SQUASH, tr.dropScale, scratchSplit.centre)
  }
  cur.a.stretch += jiggleA(t)
  cur.b.stretch += jiggleB(t)
  cur.k = track(t, SMOOTH_UNION)
  placeLabel(cur, current, scratchSplit.centre, track(t, DIVIDER), 1)

  // The light inside: wakes by the divider, drifts past the arrow into the right lobe.
  out.orb.intensity = track(t, ORB_INTENSITY)
  out.orb.x = track(t, tr.orbX)
  // Close to the label plane, so it sits on the arrow line instead of dropping below it by parallax.
  out.orb.y = 0.03
  out.orb.z = 0.09

  out.wave.x = track(t, tr.waveX)
  out.wave.amplitude = track(t, WAVE_AMPLITUDE)

  sampleDrops(t, current, out)

  // Camera drops toward the floor while the drops are apart; the light warms.
  out.camElevation = track(t, CAM_ELEVATION) * DEG
  out.camDistance = track(t, CAM_DISTANCE)
  out.floorY = track(t, FLOOR_Y)
  out.warmth = track(t, WARMTH)
  out.textBlur = track(t, TEXT_BLUR)
}

function sampleDrops(t: number, layout: LabelLayout, out: CycleState): void {
  let n = 0
  const crown = out.crown
  crown.collar = crown.finger = crown.fingerRadius = crown.tipRadius = 0

  // Pinch-off: the thread breaks into satellites between the two drops.
  const pinchAge = t - PINCH_T
  if (pinchAge > 0 && pinchAge < 2.0) {
    splitLobes(PINCH_T, layout, scratchA, scratchB, scratchSplit)
    const x0 = scratchA.x + scratchA.r
    const x1 = scratchB.x - scratchB.r
    for (const spec of pinchSpray) {
      if (pinchAge >= spec.life || n >= MAX_DROPS) continue
      flyDrop(spec, pinchAge, mix(x0, x1, spec.u), 0, 0, out.drops[n++])
    }
    // The fat satellite that stays stuck to the big drop and is slowly swallowed.
    if (pinchAge < 1.7 && n < MAX_DROPS) {
      const d = out.drops[n++]
      const sink = smoothstep(0.5, 1.7, pinchAge)
      splitLobes(t, layout, scratchA, scratchB, scratchSplit)
      d.x = scratchA.x + scratchA.r + 0.035 - 0.13 * sink
      d.y = scratchA.y - 0.04
      d.z = 0.06
      d.r = 0.075 * smoothstep(0, 0.05, pinchAge) * (1 - smoothstep(1.0, 1.7, pinchAge))
      d.tx = d.ty = d.tz = 0
    }
  }

  // Collision: a collar of liquid around the contact, fingers rising from it, and a spray.
  const splashAge = t - SPLASH_T
  if (splashAge > 0 && splashAge < 1.8) {
    splitLobes(SPLASH_T, layout, scratchA, scratchB, scratchSplit)
    const dx = scratchB.x - scratchA.x
    const dz = scratchB.z - scratchA.z
    const len = Math.hypot(dx, dz) || 1
    // The contact point, nudged forward so the crown opens in front of the big drop.
    const cx = scratchA.x + (dx / len) * scratchA.r * 0.95
    const cy = (scratchA.y + scratchB.y) / 2
    const cz = scratchA.z + (dz / len) * scratchA.r * 0.95 + 0.2
    for (const spec of splashSpray) {
      if (splashAge >= spec.life || n >= MAX_DROPS) continue
      flyDrop(spec, splashAge, cx, cy, cz, out.drops[n++])
    }
    if (splashAge < SPLASH_LIFE) {
      const life = splashAge / SPLASH_LIFE
      crown.x = cx
      crown.y = cy
      crown.z = cz
      // The collar spreads fast then slows; the fingers rise and fall back; both thin as they go.
      // It spreads, then falls back onto the drop as it thins, so nothing is left as a bare hoop.
      crown.ring = 0.26 + 0.34 * (1 - Math.exp(-5 * splashAge)) - 0.22 * smoothstep(0.4, 0.85, life)
      crown.collar = 0.065 * smoothstep(0, 0.06, splashAge) * (1 - smoothstep(0.3, 0.72, life))
      crown.finger = 0.26 * Math.sin(Math.PI * life) ** 0.8
      crown.fingerRadius = 0.045 * (1 - smoothstep(0.55, 1, life))
      crown.tipRadius = 0.05 * smoothstep(0, 0.15, life) * (1 - smoothstep(0.6, 1, life))
    }
  }

  out.dropCount = n
}
