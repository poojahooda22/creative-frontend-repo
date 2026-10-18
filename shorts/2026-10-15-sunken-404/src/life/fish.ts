// The fish: one instanced mesh for all of them. Each is a procedural body with its fins, painted by
// species in the shader (clownfish, blue tang, a silver minnow), swimming with a wave that travels
// down the body. On the CPU they steer: wander, school, keep clear of the surface and the sand,
// startle from a stirring hand, and drift with the current.
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { patchMaterial, vivid } from './patch'
import { between, random } from './random'
import { LANES, type Life, type Tank, type Vec2 } from './tank'

// ---- Shape (model space: nose toward +x, about one unit long) ----

const NOSE_X = 0.5
/** Nose to the root of the tail. */
const BODY_LENGTH = 0.8
/** The tail fin's tips, behind the root. */
const TAIL_X = NOSE_X - BODY_LENGTH - 0.23
/** Nose to tail tip: the swim wave's 0..1 runs over this. */
const SPAN = NOSE_X - TAIL_X
const RINGS = 30
const SIDES = 18
/** Half-height of the body from the nose (0) to the root of the tail (1). */
const PROFILE: ReadonlyArray<readonly [number, number]> = [
  [0, 0.012],
  [0.05, 0.08],
  [0.14, 0.145],
  [0.3, 0.19],
  [0.48, 0.195],
  [0.65, 0.16],
  [0.82, 0.1],
  [0.94, 0.06],
  [1, 0.05],
]

function halfHeight(u: number): number {
  for (let k = 1; k < PROFILE.length; k++) {
    const [u1, h1] = PROFILE[k]
    if (u <= u1) {
      const [u0, h0] = PROFILE[k - 1]
      const t = (u - u0) / (u1 - u0)
      return h0 + (h1 - h0) * t * t * (3 - 2 * t)
    }
  }
  return PROFILE[PROFILE.length - 1][1]
}

/** The back sits a little higher than the belly is low. */
function arch(u: number): number {
  return 0.012 * Math.sin(Math.PI * u)
}

/** Fraction along the fish (nose 0, tail tip 1) of a point at x. */
function along(x: number): number {
  return Math.min(1, Math.max(0, (NOSE_X - x) / SPAN))
}

/** Parts, for the shader: which piece of the fish a vertex belongs to. */
const PART = { body: 0, tail: 1, dorsal: 2, pectoral: 3, anal: 4 } as const

function withBody(geometry: THREE.BufferGeometry, part: number): THREE.BufferGeometry {
  geometry.deleteAttribute('uv')
  const pos = geometry.getAttribute('position')
  const body = new Float32Array(2 * pos.count)
  for (let i = 0; i < pos.count; i++) {
    body[2 * i] = along(pos.getX(i))
    body[2 * i + 1] = part
  }
  geometry.setAttribute('aBody', new THREE.BufferAttribute(body, 2))
  return geometry
}

function bodyGeometry(): THREE.BufferGeometry {
  const positions: number[] = []
  const indices: number[] = []
  // Nose tip.
  positions.push(NOSE_X + 0.012, arch(0), 0)
  for (let r = 0; r <= RINGS; r++) {
    const u = r / RINGS
    const x = NOSE_X - BODY_LENGTH * u
    const h = halfHeight(u)
    const w = 0.5 * h
    const c = arch(u)
    for (let k = 0; k < SIDES; k++) {
      const a = (k / SIDES) * Math.PI * 2
      positions.push(x, c + h * Math.sin(a), w * Math.cos(a))
    }
  }
  // Root of the tail, closed.
  const cap = positions.length / 3
  positions.push(NOSE_X - BODY_LENGTH - 0.005, arch(1), 0)
  const ring = (r: number, k: number) => 1 + r * SIDES + (k % SIDES)
  for (let k = 0; k < SIDES; k++) indices.push(0, ring(0, k), ring(0, k + 1))
  for (let r = 0; r < RINGS; r++) {
    for (let k = 0; k < SIDES; k++) {
      const a = ring(r, k)
      const b = ring(r, k + 1)
      const c = ring(r + 1, k)
      const d = ring(r + 1, k + 1)
      indices.push(a, c, b, b, c, d)
    }
  }
  for (let k = 0; k < SIDES; k++) indices.push(cap, ring(RINGS, k + 1), ring(RINGS, k))
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  g.setIndex(indices)
  g.computeVertexNormals()
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((positions.length / 3) * 2), 2))
  return withBody(g, PART.body)
}

function finGeometry(points: ReadonlyArray<readonly [number, number]>, part: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)))
  return withBody(new THREE.ShapeGeometry(shape, 4), part)
}

/** Top (+1) or bottom (-1) of the body at x, a little inside it so a fin's root is hidden. */
function edge(x: number, side: 1 | -1): number {
  const u = (NOSE_X - x) / BODY_LENGTH
  return arch(u) + side * (halfHeight(u) - 0.012)
}

export function fishGeometry(): THREE.BufferGeometry {
  const root = NOSE_X - BODY_LENGTH
  const tail = finGeometry(
    [
      [root + 0.02, 0.045],
      [root - 0.1, 0.12],
      [TAIL_X, 0.2],
      [TAIL_X + 0.07, 0.04],
      [TAIL_X + 0.09, 0],
      [TAIL_X + 0.07, -0.04],
      [TAIL_X, -0.2],
      [root - 0.1, -0.12],
      [root + 0.02, -0.045],
    ],
    PART.tail,
  )
  const dorsal = finGeometry(
    [
      [0.22, edge(0.22, 1)],
      [0.24, edge(0.24, 1) + 0.04],
      [0.06, edge(0.06, 1) + 0.12],
      [-0.14, edge(-0.14, 1) + 0.1],
      [-0.27, edge(-0.27, 1) + 0.05],
      [-0.25, edge(-0.25, 1)],
      [0.0, edge(0.0, 1)],
    ],
    PART.dorsal,
  )
  const anal = finGeometry(
    [
      [-0.02, edge(-0.02, -1)],
      [-0.25, edge(-0.25, -1)],
      [-0.27, edge(-0.27, -1) - 0.05],
      [-0.1, edge(-0.1, -1) - 0.08],
    ],
    PART.anal,
  )
  const parts = [bodyGeometry(), tail, dorsal, anal]
  // Pectoral fins: small paddles on each flank behind the gills, swept back and down.
  for (const side of [1, -1]) {
    const fin = finGeometry(
      [
        [0, 0],
        [-0.12, 0.03],
        [-0.15, -0.01],
        [-0.1, -0.05],
      ],
      PART.pectoral,
    )
    fin.rotateY(side * 0.35)
    fin.translate(0.26, -0.04, side * (0.5 * halfHeight(0.3) + 0.004))
    parts.push(fin)
  }
  const merged = mergeGeometries(parts)
  for (const p of parts) p.dispose()
  if (!merged) throw new Error('fishGeometry: parts do not share attributes')
  return merged
}

// ---- Material ----

/**
 * Where along the body the turning arc pivots (model x), and the body wave's length in units of
 * the swim coordinate (nose 0, tail tip 1): about one body length, as in carangiform swimmers.
 */
const BEND_CENTER = 0.05
const WAVELENGTH = 0.95

const VERTEX_HEAD = /* glsl */ `
attribute vec2 aBody;
attribute vec4 iSwim;
attribute vec2 iFin;
attribute vec4 iLook;
varying vec3 vFish;
varying vec2 vBody;
varying vec4 vLook;
${vivid.vertexHead}
`

// The midline. iSwim holds the body wave's phase, the tail's amplitude (model units), the
// turning arc (curvature, positive for a counterclockwise turn seen from above) and nothing.
// The wave's envelope is Videler and Hess's for saithe, A(s) = 0.02 - 0.0825 s + 0.1625 s^2 body
// lengths, scaled so the tail reaches the given amplitude: the head yaws a little, the body is
// stillest a quarter of the way back, and the tail sweeps widest.
const SWIM = /* glsl */ `
float swimS = aBody.x;
float swimEnv = (0.02 - 0.0825 * swimS + 0.1625 * swimS * swimS) * 10.0;
float swimArg = iSwim.x - 6.2831853 * swimS / ${WAVELENGTH.toFixed(3)};
float swimX = position.x - ${BEND_CENTER.toFixed(3)};
`

const VERTEX = /* glsl */ `
vFish = position;
vBody = aBody;
vLook = iLook;
${SWIM}
// The wave, and the arc of the body around a turn (both ends swing to the inside of the turn).
transformed.z += iSwim.y * swimEnv * sin(swimArg) - iSwim.z * swimX * swimX;
// Pectoral fins: iFin is their beat's phase and strength, a flap out from the body and back.
if (aBody.y > 2.5 && aBody.y < 3.5) {
  float root = clamp((0.26 - position.x) / 0.15, 0.0, 1.0);
  transformed.z += sign(position.z) * iFin.y * 0.05 * (0.5 + 0.5 * sin(iFin.x)) * root;
  transformed.y += iFin.y * 0.02 * cos(iFin.x) * root;
}
${vivid.vertexWorld}
`

// The midline's sideways slope tilts the normals with it: d(z)/dx of the wave and the arc.
const NORMAL = /* glsl */ `
{
  ${SWIM}
  float dEnv = (-0.0825 + 0.325 * swimS) * 10.0;
  float dWave = iSwim.y * (dEnv * sin(swimArg) - swimEnv * cos(swimArg) * 6.2831853 / ${WAVELENGTH.toFixed(3)});
  float slope = -dWave / ${SPAN.toFixed(3)} - 2.0 * iSwim.z * swimX;
  objectNormal = normalize(vec3(objectNormal.x - slope * objectNormal.z, objectNormal.y, objectNormal.z + slope * objectNormal.x));
}
`

const FRAGMENT_HEAD = /* glsl */ `
varying vec3 vFish;
varying vec2 vBody;
varying vec4 vLook;
${vivid.fragmentHead}

// Linear colours. p is the model-space point (nose toward +x), b is (along, part).
vec3 clownfish(vec3 p, vec2 b) {
  vec3 orange = vec3(0.86, 0.23, 0.025);
  vec3 white = vec3(0.86, 0.86, 0.82);
  vec3 black = vec3(0.012);
  // Three white bars edged in black: behind the eye, mid-body, at the root of the tail.
  float bar = min(min(abs(p.x - 0.31) - 0.045, abs(p.x - 0.02) - 0.055), abs(p.x + 0.27) - 0.028);
  vec3 c = bar < 0.0 ? white : orange;
  c = mix(black, c, smoothstep(0.004, 0.013, abs(bar)));
  // Fins edged in black.
  if (b.y > 0.5) c = mix(c, black, smoothstep(0.24, 0.29, abs(p.y)) + smoothstep(0.9, 0.98, b.x));
  return c;
}

vec3 blueTang(vec3 p, vec2 b) {
  vec3 blue = vec3(0.02, 0.12, 0.62);
  vec3 black = vec3(0.008, 0.01, 0.03);
  vec3 yellow = vec3(0.93, 0.62, 0.02);
  // The black "palette" sweeping from the eye along the upper flank toward the tail.
  float dx = p.x - 0.03;
  float centre = 0.06 - 0.35 * dx * dx;
  float half_ = 0.055 - 0.11 * abs(dx);
  float band = abs(p.y - centre) - half_;
  vec3 c = mix(black, blue, smoothstep(-0.006, 0.006, band));
  if (b.y > 1.5 && b.y < 2.5) c = mix(black, blue, smoothstep(0.24, 0.3, abs(p.y)));
  if (b.y > 0.5 && b.y < 1.5 || p.x < -0.27 || b.y > 2.5 && b.y < 3.5) c = yellow;
  return c;
}

vec3 minnow(vec3 p, vec2 b, vec3 tint) {
  vec3 back = vec3(0.03, 0.075, 0.085) * tint;
  vec3 belly = vec3(0.6, 0.66, 0.66);
  vec3 c = mix(belly, back, smoothstep(-0.03, 0.09, p.y + 0.02 * p.x));
  // A faint lateral line.
  c += vec3(0.06, 0.1, 0.1) * (1.0 - smoothstep(0.004, 0.012, abs(p.y - 0.015)));
  if (b.y > 0.5) c = vec3(0.22, 0.3, 0.3) * tint;
  return c;
}

vec3 fishPaint(vec3 p, vec2 b, vec4 look) {
  vec3 c = look.x < 0.5 ? clownfish(p, b) : look.x < 1.5 ? blueTang(p, b) : minnow(p, b, look.yzw);
  if (b.y < 0.5) {
    // The eye: a pale ring, a dark pupil and a glint.
    float r = length(p.xy - vec2(0.355, 0.05));
    c = mix(c, vec3(0.8, 0.78, 0.7), 1.0 - smoothstep(0.03, 0.036, r));
    c = mix(c, vec3(0.004), 1.0 - smoothstep(0.019, 0.025, r));
    c = mix(c, vec3(1.0), 1.0 - smoothstep(0.004, 0.008, length(p.xy - vec2(0.363, 0.058))));
  }
  return c;
}
`

// ---- Behaviour ----
//
// Numbers from fish biomechanics, in body lengths (BL) per second:
// - Small fish cruise at about 1 to 2 BL/s and burst to 3 to 5. Below about 1 BL/s many swim
//   burst-and-coast: a few tail beats, then a glide (Videler and Weihs 1982; tetra flume work).
// - Tail-beat frequency rises with speed at a Strouhal number St = f A / U of 0.2 to 0.4 (Taylor,
//   Nudds and Thomas 2003); with the tail sweeping about 0.2 BL peak to peak, f = 1.5 U per BL/s.
// - Clownfish (damselfish) and tangs swim labriform at low speed: the pectoral fins row or flap
//   and the body stays nearly straight; the tail joins in for bursts.
// - Schools keep neighbours about a body length apart and spread wider than tall: the zones that
//   pull fish together reach less far vertically (Couzin's zone model, flattened in later work).

type Gait = 'paddle' | 'burst' | 'coast'

interface Kind {
  species: number
  /** Body length, sim units. */
  length: number
  /** Height and width relative to length. */
  sy: number
  sz: number
  /** Cruising and burst speeds, BL/s. */
  cruise: number
  burst: number
  /** Rows with its pectoral fins at cruising speed instead of beating its tail. */
  labriform: boolean
  /** Tail amplitude while paddling (model units; a full beat is about 0.1). */
  waggle: number
  /** Chance per second of a burst while paddling. */
  burstRate: number
  /** How strongly its course meanders: clownfish dart about, tangs glide. */
  meander: number
}

const CLOWN: Kind = { species: 0, length: 0.19, sy: 1.15, sz: 1.25, cruise: 1.2, burst: 3.5, labriform: true, waggle: 0.045, burstRate: 0.16, meander: 1.3 }
const TANG: Kind = { species: 1, length: 0.25, sy: 1.5, sz: 0.85, cruise: 1.1, burst: 3, labriform: true, waggle: 0.03, burstRate: 0.1, meander: 0.55 }
const MINNOW: Kind = { species: 2, length: 0.2, sy: 0.72, sz: 0.85, cruise: 1.7, burst: 3.2, labriform: false, waggle: 0.02, burstRate: 0, meander: 0.8 }

/** A full tail beat's amplitude at the tail tip, model units (about 0.1 body length). */
const TAIL_AMPLITUDE = 0.1
/** f = TAIL_RATE * U for U in BL/s (Strouhal 0.3 over a 0.2 BL sweep), never below MIN_BEAT Hz. */
const TAIL_RATE = 1.5
const MIN_BEAT = 2.2
/**
 * Turning: the turning rate aims at TURN_GAIN times the heading error and follows that aim at
 * TURN_RESPONSE. Together they make a second-order loop, critically damped when RESPONSE is four
 * times GAIN (natural rate 2.4 rad/s, damping ratio 1): a fish swings onto its new course without
 * overshooting and wagging back, the zigzag an underdamped loop gives. Then the most it turns
 * (rad/s), cruising and fleeing.
 */
const TURN_GAIN = 1.2
const TURN_CRUISE = 2.4
const TURN_FLEE = 9
/** Body arc per unit of turning rate, model units. */
const ARC_PER_TURN = 0.16
/** How far ahead (s) a fish looks for the surface, the sand and the glass. */
const LOOK_AHEAD = 0.8
/**
 * A turn that needs more than this (rad) is made as a pivot: the fish brakes to this share of its
 * speed and turns at the pivot rate, the way fish turn tightly on the spot instead of in a wide arc.
 */
const PIVOT_ANGLE = 1
/** A turn needing more than this (rad) keeps its current direction rather than choosing again. */
const COMMIT_ANGLE = 2.4
const PIVOT_SPEED = 0.35
const TURN_PIVOT = 5
const SURFACE_MARGIN = 0.1
/** Every part of a fish (its box, as drawn) stays at least this far under the surface (units). */
const FISH_CLEARANCE = 0.01
const SAND_MARGIN = 0.07
const FLEE_RADIUS = 0.45
const FLEE_BURST = 5.5
/** Meandering: an Ornstein-Uhlenbeck drift on the heading (pull back per second, strength). */
const WANDER_PULL = 0.3
const WANDER_STRENGTH = 0.55
const TURN_RESPONSE = 4.8
/** Schooling zones, BL: keep apart, swim alike, keep together. */
const SCHOOL_APART = 1
const SCHOOL_ALIGN = 3
const SCHOOL_TOGETHER = 6

interface Goal {
  gx: number
  gy: number
  gz: number
  goalLeft: number
  lane: { min: number; max: number }
}

interface Fish extends Goal {
  kind: Kind
  school: number
  /** Body length for this tank's scale, sim units. */
  length: number
  x: number
  y: number
  z: number
  /** Heading: yaw about the vertical (0 faces +x) and pitch. */
  yaw: number
  pitch: number
  yawRate: number
  roll: number
  speed: number
  gait: Gait
  gaitLeft: number
  /** Paddling speed this fish is drifting toward, BL/s. */
  pace: number
  bodyPhase: number
  tailAmp: number
  beat: number
  pectPhase: number
  pectAmp: number
  /** 0 to 1: how much a pivot turn is slowing the fish. */
  braking: number
  wanderYaw: number
  wanderPitch: number
  panic: number
  tint: THREE.Color
}

/** How many of each, scaled to the tank's width (about 5 units on a desktop). */
function population(width: number): Array<{ kind: Kind; count: number; lane: 'front' | 'back'; school: number; tint: string }> {
  const k = width / 5
  const n = (base: number) => Math.max(1, Math.round(base * k))
  return [
    { kind: TANG, count: 1, lane: 'front', school: -1, tint: '#ffffff' },
    { kind: TANG, count: n(1), lane: 'back', school: -1, tint: '#ffffff' },
    { kind: CLOWN, count: n(2), lane: 'front', school: -1, tint: '#ffffff' },
    { kind: CLOWN, count: n(1), lane: 'back', school: -1, tint: '#ffffff' },
    { kind: MINNOW, count: n(7), lane: 'back', school: 0, tint: '#ffffff' },
    { kind: MINNOW, count: n(4), lane: 'front', school: 1, tint: '#b8d4ff' },
  ]
}

/** A standard normal sample from the seeded generator (Box-Muller). */
function gaussian(rand: () => number): number {
  return Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-9))) * Math.cos(2 * Math.PI * rand())
}

function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a))
}

export function createFish(tank: Tank, seed: number): Life {
  const L = tank.layout
  const sc = tank.scale
  const rand = random(seed)
  const fish: Fish[] = []
  const pickGoal = (g: Goal) => {
    g.gx = between(rand, 0.08, 0.92) * L.width
    const floor = tank.sand(g.gx, 0) + (SAND_MARGIN + 0.08) * sc
    const top = L.waterLevel - (SURFACE_MARGIN + 0.1) * sc
    g.gy = between(rand, floor, Math.max(floor + 0.05, top))
    g.gz = between(rand, g.lane.min, g.lane.max)
    g.goalLeft = between(rand, 6, 14)
  }
  for (const group of population(L.width)) {
    for (let i = 0; i < group.count; i++) {
      const length = group.kind.length * sc
      const f: Fish = {
        kind: group.kind,
        lane: LANES[group.lane],
        school: group.school,
        length,
        x: 0,
        y: 0,
        z: 0,
        yaw: rand() < 0.5 ? 0 : Math.PI,
        pitch: 0,
        yawRate: 0,
        roll: 0,
        speed: group.kind.cruise * length,
        gait: group.kind.labriform ? 'paddle' : 'coast',
        gaitLeft: rand(),
        pace: group.kind.cruise,
        bodyPhase: rand() * 10,
        tailAmp: group.kind.waggle,
        beat: MIN_BEAT,
        pectPhase: rand() * 10,
        pectAmp: 0,
        braking: 0,
        wanderYaw: 0,
        wanderPitch: 0,
        gx: 0,
        gy: 0,
        gz: 0,
        goalLeft: 0,
        panic: 0,
        tint: new THREE.Color(group.tint),
      }
      pickGoal(f)
      f.x = f.gx
      f.y = f.gy
      f.z = f.gz
      pickGoal(f)
      fish.push(f)
    }
  }
  // A school roams toward one shared goal, so its members travel together.
  const schools: Goal[] = [LANES.back, LANES.front].map((lane) => ({ gx: 0, gy: 0, gz: 0, goalLeft: 0, lane }))
  for (const school of schools) pickGoal(school)

  const geometry = fishGeometry()
  const swim = new THREE.InstancedBufferAttribute(new Float32Array(4 * fish.length), 4)
  swim.setUsage(THREE.DynamicDrawUsage)
  const fins = new THREE.InstancedBufferAttribute(new Float32Array(2 * fish.length), 2)
  fins.setUsage(THREE.DynamicDrawUsage)
  const look = new THREE.InstancedBufferAttribute(new Float32Array(4 * fish.length), 4)
  fish.forEach((f, i) => look.setXYZW(i, f.kind.species, f.tint.r, f.tint.g, f.tint.b))
  geometry.setAttribute('iSwim', swim)
  geometry.setAttribute('iFin', fins)
  geometry.setAttribute('iLook', look)
  const material = patchMaterial(new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.42, metalness: 0.04 }), {
    key: 'fish',
    uniforms: { ...tank.uniforms },
    vertexHead: VERTEX_HEAD,
    vertex: VERTEX,
    normal: NORMAL,
    fragmentHead: FRAGMENT_HEAD,
    color: 'diffuseColor.rgb = fishPaint(vFish, vBody, vLook);',
    output: vivid.output,
  })
  const mesh = new THREE.InstancedMesh(geometry, material, fish.length)
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  mesh.frustumCulled = false

  const flow: Vec2 = { x: 0, y: 0 }
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const e = new THREE.Euler(0, 0, 0, 'YZX')
  const p = new THREE.Vector3()
  const scale = new THREE.Vector3()
  // The fish's box as drawn (the swim wave and the turning bend move it side to side, in z).
  geometry.computeBoundingBox()
  const bounds = geometry.boundingBox
  if (!bounds) throw new Error('createFish: the fish geometry has no bounds')
  const box: THREE.Box3 = bounds
  const corner = new THREE.Vector3()

  /** How far the highest part of a fish rises above the surface where it is (units; negative when under). */
  function overSurface(f: Fish): number {
    e.set(f.roll, f.yaw, f.pitch)
    q.setFromEuler(e)
    p.set(f.x, f.y, f.z)
    scale.set(f.length, f.length * f.kind.sy, f.length * f.kind.sz)
    m.compose(p, q, scale)
    let worst = -Infinity
    for (let k = 0; k < 8; k++) {
      corner.set(k & 1 ? box.max.x : box.min.x, k & 2 ? box.max.y : box.min.y, k & 4 ? box.max.z : box.min.z).applyMatrix4(m)
      // A column with no water over the sand (no surface known yet) sets no ceiling.
      const surface = tank.surfaceAt(corner.x)
      if (surface <= tank.sand(corner.x, corner.z)) continue
      worst = Math.max(worst, corner.y - surface + FISH_CLEARANCE)
    }
    return worst
  }
  // The steering sum for one fish, reused.
  const want = { x: 0, y: 0, z: 0 }

  /** Adds a unit vector along (dx, dy, dz), weighted. */
  function toward(dx: number, dy: number, dz: number, weight: number): void {
    const d = Math.hypot(dx, dy, dz)
    if (d < 1e-6) return
    want.x += (dx / d) * weight
    want.y += (dy / d) * weight
    want.z += (dz / d) * weight
  }

  function steer(f: Fish, dt: number): void {
    const bl = f.length
    const k = f.kind
    want.x = want.y = want.z = 0
    // Where it is heading now, and the same heading bent by its meander.
    const cp = Math.cos(f.pitch)
    const hx = cp * Math.cos(f.yaw)
    const hy = Math.sin(f.pitch)
    const hz = -cp * Math.sin(f.yaw)
    toward(hx, hy, hz, 1)
    const meander = WANDER_STRENGTH * k.meander * Math.sqrt(dt)
    f.wanderYaw += -f.wanderYaw * WANDER_PULL * dt + meander * gaussian(rand)
    f.wanderPitch += -f.wanderPitch * WANDER_PULL * dt + 0.5 * meander * gaussian(rand)
    const wy = f.yaw + f.wanderYaw
    const wp = Math.max(-0.5, Math.min(0.5, f.pitch + f.wanderPitch))
    toward(Math.cos(wp) * Math.cos(wy), Math.sin(wp), -Math.cos(wp) * Math.sin(wy), 0.8)
    // Its roaming goal (a school's is shared).
    const goal = f.school >= 0 ? schools[f.school] : f
    toward(goal.gx - f.x, goal.gy - f.y, Math.min(f.lane.max, Math.max(f.lane.min, goal.gz)) - f.z, 0.7)
    if (f.school < 0) {
      f.goalLeft -= dt
      if (f.goalLeft < 0 || Math.hypot(f.gx - f.x, f.gy - f.y) < 0.4) pickGoal(f)
    }
    // Neighbours: everyone keeps a body length away; school mates also swim alike and stay
    // together, pulled harder to the school's depth than along it, so the school spreads wide.
    let ax = 0
    let ay = 0
    let az = 0
    let cx = 0
    let cy = 0
    let cz = 0
    let mates = 0
    let aligned = 0
    for (const o of fish) {
      if (o === f) continue
      const dx = o.x - f.x
      const dy = o.y - f.y
      const dz = o.z - f.z
      const d = Math.hypot(dx, dy, dz) / bl
      const room = SCHOOL_APART * 0.5 * (1 + o.length / bl)
      if (d < room && d > 1e-4) toward(-dx, -dy, -dz, 2.5 * (1 - d / room))
      if (f.school < 0 || o.school !== f.school) continue
      if (d < SCHOOL_ALIGN) {
        const ocp = Math.cos(o.pitch)
        ax += ocp * Math.cos(o.yaw)
        ay += Math.sin(o.pitch)
        az += -ocp * Math.sin(o.yaw)
        aligned++
      }
      if (d < SCHOOL_TOGETHER) {
        cx += dx
        cy += dy
        cz += dz
        mates++
      }
    }
    if (aligned > 0) toward(ax, ay, az, 1.1)
    if (mates > 0) {
      const mx = cx / mates
      const my = cy / mates
      const mz = cz / mates
      // Toward the mates' centre, twice as firmly in depth as along the school.
      if (Math.hypot(mx, my, mz) > SCHOOL_APART * bl) toward(mx * 0.4, my * 0.8, mz * 0.4, 0.9)
    }
    // Look ahead: turn away from the surface, the sand, the side glass and the edges of its lane
    // before reaching them, harder the closer it is (at the current point or the one ahead).
    const ahead = f.speed * LOOK_AHEAD
    const px = f.x + hx * ahead
    const py = f.y + hy * ahead
    const pz = f.z + hz * ahead
    const wall = 0.03 * L.width
    const zone = 0.06 * L.width + 2 * bl
    const laneZone = 0.5 * (f.lane.max - f.lane.min)
    const vertical = 0.05 * sc + 0.6 * bl
    let urgency = 0
    const avoid = (gap: number, reach: number, nx: number, ny: number, nz: number) => {
      if (gap >= reach) return
      const push = (1 - gap / reach) ** 2
      urgency = Math.max(urgency, push)
      want.x += nx * 6 * push
      want.y += ny * 6 * push
      want.z += nz * 6 * push
    }
    const surfaceGap = Math.min(tank.surfaceAt(f.x) - f.y, tank.surfaceAt(px) - py) - SURFACE_MARGIN * sc
    const floorGap = Math.min(f.y - tank.sand(f.x, f.z), py - tank.sand(px, pz)) - SAND_MARGIN * sc
    avoid(surfaceGap, vertical, 0, -1, 0)
    avoid(floorGap, vertical, 0, 1, 0)
    avoid(Math.min(f.x, px) - wall, zone, 1, 0, 0)
    avoid(L.width - wall - Math.max(f.x, px), zone, -1, 0, 0)
    avoid(Math.min(f.z, pz) - f.lane.min, laneZone, 0, 0, 1)
    avoid(f.lane.max - Math.max(f.z, pz), laneZone, 0, 0, -1)
    // A hand moving fast through the water nearby: a C-start away from it, and a burst.
    const h = tank.hand
    if (h.active && h.y < tank.surfaceAt(h.x)) {
      const dx = f.x - h.x
      const dy = f.y - h.y
      const d = Math.hypot(dx, dy)
      const radius = FLEE_RADIUS * sc
      const handSpeed = Math.hypot(h.vx, h.vy)
      if (d < radius && handSpeed > 0.25) {
        const fear = (1 - d / radius) * Math.min(1, handSpeed / 1.5)
        toward(dx, dy, 0, 8 * fear)
        if (fear > f.panic) {
          f.panic = fear
          f.gait = 'burst'
          f.gaitLeft = between(rand, 0.35, 0.6)
        }
      }
    }
    f.panic = Math.max(0, f.panic - dt * 0.9)

    // Turn toward the sum: yaw about the vertical, pitch within half a radian. A big turn is a
    // pivot (braked, fast); a fleeing fish turns fastest of all.
    const goalYaw = Math.atan2(-want.z, want.x)
    const goalPitch = Math.max(-0.5, Math.min(0.5, Math.atan2(want.y, Math.hypot(want.x, want.z))))
    let error = wrapAngle(goalYaw - f.yaw)
    // Nearly opposite: left and right are equally short, and picking afresh every frame would flip
    // the turn back and forth. Keep turning the way the fish already is.
    if (Math.abs(error) > COMMIT_ANGLE && f.yawRate * error < 0) error -= Math.sign(error) * 2 * Math.PI
    const pivot = Math.min(1, Math.max(0, (Math.abs(error) - PIVOT_ANGLE) / PIVOT_ANGLE) + urgency * 0.5)
    const maxTurn = f.panic > 0.05 ? TURN_FLEE : TURN_CRUISE + (TURN_PIVOT - TURN_CRUISE) * pivot
    const rate = Math.max(-maxTurn, Math.min(maxTurn, error * TURN_GAIN * (1 + 3 * f.panic + 2 * pivot)))
    f.braking = pivot * (1 - f.panic)
    f.yawRate += (rate - f.yawRate) * Math.min(1, dt * (TURN_RESPONSE + 6 * Math.max(f.panic, urgency)))
    f.yaw = wrapAngle(f.yaw + f.yawRate * dt)
    f.pitch += (goalPitch - f.pitch) * Math.min(1, dt * 2.5)
    // Bank into the turn a little.
    f.roll += (Math.max(-0.45, Math.min(0.45, -f.yawRate * 0.12)) - f.roll) * Math.min(1, dt * 4)

    // Gait: speed, tail and fins.
    f.gaitLeft -= dt
    const u = f.speed / bl
    let targetAmp = k.waggle
    let targetBeat = MIN_BEAT
    let pect = 0
    switch (f.gait) {
      case 'burst': {
        const fastest = k.burst + (FLEE_BURST - k.burst) * f.panic
        f.speed += (fastest * bl - f.speed) * Math.min(1, dt * 4)
        targetAmp = TAIL_AMPLITUDE
        targetBeat = Math.max(MIN_BEAT + 1, TAIL_RATE * u)
        if (f.gaitLeft <= 0) {
          f.gait = k.labriform ? 'paddle' : 'coast'
          f.gaitLeft = k.labriform ? between(rand, 1, 3) : between(rand, 0.45, 1.3)
        }
        break
      }
      case 'coast': {
        // Gliding: the tail straightens and drag slows the fish.
        f.speed *= Math.exp(-dt / 1.3)
        targetAmp = 0.012
        targetBeat = 1
        if (f.gaitLeft <= 0 || u < 0.7 * k.cruise) {
          f.gait = 'burst'
          f.gaitLeft = between(rand, 0.3, 0.65)
        }
        break
      }
      case 'paddle': {
        // Rowing with the pectoral fins toward a pace that drifts; the tail waggles gently.
        if (f.gaitLeft <= 0) {
          f.pace = k.cruise * between(rand, 0.55, 1.3)
          f.gaitLeft = between(rand, 1, 3)
        }
        f.speed += (f.pace * bl - f.speed) * Math.min(1, dt * 1.5)
        targetBeat = MIN_BEAT + 0.8 * u
        pect = 1
        if (rand() < k.burstRate * dt) {
          f.gait = 'burst'
          f.gaitLeft = between(rand, 0.3, 0.5)
        }
        break
      }
    }
    f.tailAmp += (targetAmp - f.tailAmp) * Math.min(1, dt * 6)
    f.beat += (targetBeat - f.beat) * Math.min(1, dt * 5)
    f.pectAmp += (pect - f.pectAmp) * Math.min(1, dt * 4)
  }

  function place(f: Fish, i: number, dt: number): void {
    f.bodyPhase += 2 * Math.PI * f.beat * dt
    // Pectoral beats speed up with swimming speed: 2.5 Hz hovering, about 4 to 5 Hz at cruise.
    f.pectPhase += 2 * Math.PI * (2.5 + 1.5 * (f.speed / f.length)) * dt
    swim.setXYZW(i, f.bodyPhase, f.tailAmp, ARC_PER_TURN * f.yawRate, 0)
    fins.setXY(i, f.pectPhase, f.pectAmp)
    e.set(f.roll, f.yaw, f.pitch)
    q.setFromEuler(e)
    p.set(f.x, f.y, f.z)
    scale.set(f.length, f.length * f.kind.sy, f.length * f.kind.sz)
    mesh.setMatrixAt(i, m.compose(p, q, scale))
  }

  function update(dt: number): void {
    for (const school of schools) {
      school.goalLeft -= dt
      if (school.goalLeft <= 0) pickGoal(school)
    }
    fish.forEach((f, i) => {
      if (dt > 0) {
        steer(f, dt)
        const cp = Math.cos(f.pitch)
        // A pivoting fish moves on slower than it swims: the turn spends the stroke.
        const forward = f.speed * (1 - (1 - PIVOT_SPEED) * f.braking)
        tank.flowAt(f.x, f.y, flow)
        f.x += (cp * Math.cos(f.yaw) * forward + 0.8 * flow.x) * dt
        f.y += (Math.sin(f.pitch) * forward + 0.8 * flow.y) * dt
        f.z += -cp * Math.sin(f.yaw) * forward * dt
        // Never out of the water, nose, tail or back. Steering keeps clear of the surface, but a
        // trough can fall faster than a fish dives (a wave passing, a tilt draining the high
        // side): the water carries it down with it, into the sand's edge if the water is that
        // shallow, where the sand hides it, rather than out into the air. Only while swimming:
        // when the fish are made the page has no water yet, and every fish was sent under the sand.
        const over = overSurface(f)
        if (over > 0) f.y -= over
      }
      place(f, i, dt)
    })
    mesh.instanceMatrix.needsUpdate = true
    swim.needsUpdate = true
    fins.needsUpdate = true
  }

  update(0)
  return {
    object: mesh,
    update,
    dispose() {
      // An instanced mesh owns GPU buffers of its own (instance matrices, attribute bindings).
      mesh.dispose()
      geometry.dispose()
      material.dispose()
    },
  }
}
