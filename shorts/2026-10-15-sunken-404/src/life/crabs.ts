// Crabs on the sand in front of the digits: a carapace on eight jointed legs, two raised claws and
// eyes on stalks, built from primitives into one mesh whose limbs the vertex shader moves (a
// walking gait, a claw raise, a pinch). They wander sideways, wave now and then, square up to a
// hand that comes close and scuttle off from a fast one.
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { patchMaterial, vivid } from './patch'
import { between, random } from './random'
import type { Life, Tank } from './tank'

// ---- Shape (crab space: +x to its right, +y up, +z toward the camera; about 0.22 across) ----

const RED = new THREE.Color(0.6, 0.06, 0.035)
const LEG_RED = new THREE.Color(0.66, 0.1, 0.045)
const WHITE = new THREE.Color(0.85, 0.85, 0.82)
const BLACK = new THREE.Color(0.01, 0.01, 0.01)

/** Limb ids, for the shader. */
const BODY = 0
const LEG = 1 // 1..8: four on the right, then four on the left
const CLAW_RIGHT = 9
const CLAW_LEFT = 10
const EYES = 11

function tag(g: THREE.BufferGeometry, color: THREE.Color, limb: number, pivot: THREE.Vector3, joint?: THREE.Vector3): THREE.BufferGeometry {
  g.deleteAttribute('uv')
  const n = g.getAttribute('position').count
  const colors = new Float32Array(3 * n)
  const limbs = new Float32Array(n)
  const pivots = new Float32Array(3 * n)
  const joints = new Float32Array(4 * n)
  for (let i = 0; i < n; i++) {
    colors.set([color.r, color.g, color.b], 3 * i)
    limbs[i] = limb
    pivots.set([pivot.x, pivot.y, pivot.z], 3 * i)
    if (joint) joints.set([joint.x, joint.y, joint.z, 1], 4 * i)
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  g.setAttribute('aLimb', new THREE.BufferAttribute(limbs, 1))
  g.setAttribute('aPivot', new THREE.BufferAttribute(pivots, 3))
  g.setAttribute('aJoint', new THREE.BufferAttribute(joints, 4))
  return g
}

/** A tapered rod from a to b. */
function rod(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number): THREE.BufferGeometry {
  const length = a.distanceTo(b)
  const g = new THREE.CylinderGeometry(r1, r0, length, 6, 1)
  g.translate(0, length / 2, 0)
  const dir = new THREE.Vector3().subVectors(b, a).normalize()
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir))
  g.translate(a.x, a.y, a.z)
  return g
}

function blob(center: THREE.Vector3, radii: THREE.Vector3, detail = 12): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, detail, Math.max(6, Math.round(detail * 0.6)))
  g.scale(radii.x, radii.y, radii.z)
  g.translate(center.x, center.y, center.z)
  return g
}

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)

export function crabGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  // Carapace: wide, low, a little flattened underneath.
  const shell = blob(v(0, 0.05, 0), v(0.062, 0.03, 0.046), 22)
  const p = shell.getAttribute('position')
  for (let i = 0; i < p.count; i++) if (p.getY(i) < 0.05) p.setY(i, 0.05 - (0.05 - p.getY(i)) * 0.55)
  shell.computeVertexNormals()
  parts.push(tag(shell, RED, BODY, v(0, 0, 0)))
  // Legs: four a side, hip up to the knee, then down to the sand.
  for (const side of [1, -1]) {
    for (let k = 0; k < 4; k++) {
      const z = 0.024 - k * 0.016
      const hip = v(side * 0.05, 0.048, z)
      const knee = v(side * 0.09, 0.074, z * 1.35)
      const foot = v(side * 0.114, 0.003, z * 1.6)
      const limb = LEG + k + (side > 0 ? 0 : 4)
      parts.push(tag(rod(hip, knee, 0.0095, 0.008), LEG_RED, limb, hip))
      parts.push(tag(rod(knee, foot, 0.0078, 0.0035), LEG_RED, limb, hip))
    }
  }
  // Claws: raised, as in the reference: arm up and out, a big hand, a pinching finger.
  for (const side of [1, -1]) {
    const shoulder = v(side * 0.046, 0.058, 0.03)
    const elbow = v(side * 0.072, 0.086, 0.044)
    const wrist = v(side * 0.081, 0.112, 0.05)
    const limb = side > 0 ? CLAW_RIGHT : CLAW_LEFT
    parts.push(tag(rod(shoulder, elbow, 0.0105, 0.0095), LEG_RED, limb, shoulder))
    parts.push(tag(rod(elbow, wrist, 0.0095, 0.0105), LEG_RED, limb, shoulder))
    parts.push(tag(blob(v(side * 0.084, 0.134, 0.05), v(0.017, 0.026, 0.014)), RED, limb, shoulder))
    const fingerRoot = v(side * 0.075, 0.13, 0.05)
    parts.push(tag(blob(v(side * 0.07, 0.152, 0.05), v(0.0065, 0.02, 0.0085), 10), RED, limb, shoulder, fingerRoot))
  }
  // Eyes on stalks.
  for (const side of [1, -1]) {
    const base = v(side * 0.016, 0.068, 0.032)
    parts.push(tag(rod(base, v(side * 0.018, 0.088, 0.034), 0.0038, 0.0034), RED, EYES, base))
    parts.push(tag(blob(v(side * 0.018, 0.092, 0.035), v(0.0095, 0.0095, 0.0095), 12), WHITE, EYES, base))
    parts.push(tag(blob(v(side * 0.018, 0.093, 0.043), v(0.0052, 0.0052, 0.0035), 10), BLACK, EYES, base))
  }
  const merged = mergeGeometries(parts)
  for (const g of parts) g.dispose()
  if (!merged) throw new Error('crabGeometry: parts do not share attributes')
  return merged
}

// ---- Material ----

const VERTEX_HEAD = /* glsl */ `
attribute float aLimb;
attribute vec3 aPivot;
attribute vec4 aJoint;
uniform float uGait;
uniform float uWalk;
uniform float uClaw;
uniform float uSnap;
uniform float uSeed;
uniform float uTime;
${vivid.vertexHead}

mat3 crabRotZ(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0);
}

mat3 crabRotY(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c);
}

// Moves a point of the crab and returns the rotation its limb turned through (for the normal).
mat3 crabPose(inout vec3 p) {
  mat3 r = mat3(1.0);
  if (aLimb > 0.5 && aLimb < 8.5) {
    // Legs: an alternating gait, each leg lifting its foot and sweeping it along.
    float leg = aLimb - 1.0;
    float side = leg < 3.5 ? 1.0 : -1.0;
    float phase = uGait + mod(leg, 4.0) * 1.5708 + (side > 0.0 ? 0.0 : 3.1416);
    float lift = max(0.0, sin(phase)) * 0.55 * uWalk + 0.04 * sin(uTime * 0.7 + leg + uSeed);
    float sweep = cos(phase) * 0.3 * uWalk;
    r = crabRotY(sweep) * crabRotZ(side * lift);
    p = r * (p - aPivot) + aPivot;
  } else if (aLimb > 8.5 && aLimb < 10.5) {
    float side = aLimb < 9.5 ? 1.0 : -1.0;
    // The finger pinches about its root, then the whole arm raises and waves.
    if (aJoint.w > 0.5) {
      float pinch = (0.2 + 0.25 * sin(uTime * 11.0 + side)) * uSnap;
      mat3 f = crabRotZ(-side * pinch);
      p = f * (p - aJoint.xyz) + aJoint.xyz;
      r = f;
    }
    float raise = side * (0.1 * sin(uTime * 1.3 + uSeed + side) + uClaw * (0.45 + 0.2 * sin(uTime * 5.0 + side)));
    mat3 a = crabRotZ(raise);
    p = a * (p - aPivot) + aPivot;
    r = a * r;
  } else if (aLimb > 10.5) {
    // Eye stalks look about.
    mat3 e = crabRotZ(0.18 * sin(uTime * 0.9 + uSeed * 3.0));
    p = e * (p - aPivot) + aPivot;
    r = e;
  }
  // The body bobs with the steps.
  p.y += 0.004 * abs(sin(uGait)) * uWalk;
  return r;
}
`

const VERTEX = /* glsl */ `
crabPose(transformed);
${vivid.vertexWorld}
`

const NORMAL = /* glsl */ `
{
  vec3 crabPoint = position;
  objectNormal = crabPose(crabPoint) * objectNormal;
}
`

// ---- Behaviour ----

const WALK_SPEED = 0.11
const FLEE_SPEED = 0.42
/** Gait radians per sim unit walked. */
const STRIDE = 70
const NOTICE = 0.38
const SCALE = 0.85

type Mood = 'idle' | 'walk' | 'wave' | 'flee' | 'guard'

interface Crab {
  x: number
  z: number
  target: number
  mood: Mood
  timer: number
  gait: number
  walk: number
  claw: number
  snap: number
  material: THREE.MeshStandardMaterial
  mesh: THREE.Mesh
  uniforms: { uGait: THREE.IUniform<number>; uWalk: THREE.IUniform<number>; uClaw: THREE.IUniform<number>; uSnap: THREE.IUniform<number>; uSeed: THREE.IUniform<number> }
}

export function createCrabs(tank: Tank, seed: number): Life {
  const L = tank.layout
  const sc = tank.scale
  const rand = random(seed)
  const group = new THREE.Group()
  const geometry = crabGeometry()
  const count = Math.max(1, Math.round((2.4 * L.width) / 5))
  const crabs: Crab[] = []
  for (let i = 0; i < count; i++) {
    const uniforms = {
      uGait: { value: 0 },
      uWalk: { value: 0 },
      uClaw: { value: 0 },
      uSnap: { value: 0 },
      uSeed: { value: rand() * 10 },
    }
    const material = patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0 }), {
      key: 'crab',
      uniforms: { ...tank.uniforms, ...uniforms },
      vertexHead: VERTEX_HEAD,
      vertex: VERTEX,
      normal: NORMAL,
      fragmentHead: vivid.fragmentHead,
      output: vivid.output,
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.scale.setScalar(SCALE * sc)
    group.add(mesh)
    // Spread along the sand in front, each in its own stretch.
    const x = ((i + between(rand, 0.25, 0.75)) / count) * L.width * 0.86 + L.width * 0.07
    crabs.push({ x, z: between(rand, 0.16, 0.34), target: x, mood: 'idle', timer: between(rand, 0.5, 3), gait: 0, walk: 0, claw: 0, snap: 0, material, mesh, uniforms })
  }

  function decide(c: Crab): void {
    const r = rand()
    if (r < 0.55) {
      c.mood = 'walk'
      const reach = between(rand, 0.15, 0.6) * (rand() < 0.5 ? -1 : 1)
      c.target = Math.min(L.width * 0.95, Math.max(L.width * 0.05, c.x + reach))
      c.timer = 8
    } else if (r < 0.75) {
      c.mood = 'wave'
      c.timer = between(rand, 1.2, 2.2)
    } else {
      c.mood = 'idle'
      c.timer = between(rand, 1.5, 4)
    }
  }

  function update(dt: number): void {
    const h = tank.hand
    for (const c of crabs) {
      if (dt > 0) {
        // A hand in the water near the crab: square up to a slow one, run from a fast one.
        const near = h.active && h.y < tank.surfaceAt(h.x) && Math.abs(h.x - c.x) < NOTICE * sc && h.y < tank.sand(c.x, c.z) + 0.5 * sc
        if (near && c.mood !== 'flee') {
          if (Math.hypot(h.vx, h.vy) > 0.6) {
            c.mood = 'flee'
            c.target = Math.min(L.width * 0.96, Math.max(L.width * 0.04, c.x + Math.sign(c.x - h.x || 1) * 0.5))
            c.timer = 1.2
          } else {
            c.mood = 'guard'
            c.timer = 0.6
          }
        }
        c.timer -= dt
        let speed = 0
        if (c.mood === 'walk' || c.mood === 'flee') {
          const dir = Math.sign(c.target - c.x)
          speed = (c.mood === 'flee' ? FLEE_SPEED : WALK_SPEED) * Math.sqrt(sc)
          const step = Math.min(Math.abs(c.target - c.x), speed * dt)
          c.x += dir * step
          // Keep clear of the other crabs.
          for (const o of crabs) {
            if (o !== c && Math.abs(o.x - c.x) < 0.2 * sc && Math.sign(o.x - c.x) === dir) c.target = c.x
          }
          c.gait += (step * STRIDE) / sc
          if (Math.abs(c.target - c.x) < 1e-3) c.timer = 0
        }
        if (c.timer <= 0) decide(c)
        const walking = speed > 0 ? 1 : 0
        const raised = c.mood === 'wave' || c.mood === 'guard' ? 1 : 0
        c.walk += (walking - c.walk) * Math.min(1, dt * 8)
        c.claw += (raised - c.claw) * Math.min(1, dt * 5)
        c.snap += ((c.mood === 'guard' ? 1 : 0) - c.snap) * Math.min(1, dt * 6)
      }
      c.uniforms.uGait.value = c.gait
      c.uniforms.uWalk.value = c.walk
      c.uniforms.uClaw.value = c.claw
      c.uniforms.uSnap.value = c.snap
      // On the sand, tilted with its slope.
      const y = tank.sand(c.x, c.z)
      const slope = (tank.sand(c.x + 0.02, c.z) - tank.sand(c.x - 0.02, c.z)) / 0.04
      c.mesh.position.set(c.x, y - 0.004, c.z)
      c.mesh.rotation.z = Math.atan(slope)
    }
  }

  update(0)
  return {
    object: group,
    update,
    dispose() {
      geometry.dispose()
      for (const c of crabs) c.material.dispose()
    },
  }
}
