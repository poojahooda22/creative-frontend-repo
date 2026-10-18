// Seaweed: tall stalks with alternating, folded leaves, some in front of the digits and more
// behind them, where the water fades them out. Each sways on its own and bends with the simulated
// current: a damped spring per plant on the CPU, driven by the flow where it stands, and the bend
// applied in the vertex shader, growing with height.
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { patchMaterial } from './patch'
import { between, random } from './random'
import type { Life, Tank, Vec2 } from './tank'

// ---- Shape (plant space: rooted at the origin, one unit tall) ----

const STALK_SIDES = 5
const STALK_SEGMENTS = 18

const STALK_BASE = new THREE.Color(0.06, 0.16, 0.05)
const STALK_TOP = new THREE.Color(0.14, 0.33, 0.09)
const LEAF_BASE = new THREE.Color(0.1, 0.27, 0.07)
const LEAF_TIP = new THREE.Color(0.3, 0.55, 0.15)

function stalk(radius: number): THREE.BufferGeometry {
  const positions: number[] = []
  const colors: number[] = []
  const plant: number[] = []
  const indices: number[] = []
  const c = new THREE.Color()
  for (let j = 0; j <= STALK_SEGMENTS; j++) {
    const h = j / STALK_SEGMENTS
    const r = radius * (1 - 0.55 * h)
    c.copy(STALK_BASE).lerp(STALK_TOP, h)
    for (let k = 0; k < STALK_SIDES; k++) {
      const a = (k / STALK_SIDES) * Math.PI * 2
      positions.push(r * Math.cos(a), h, r * Math.sin(a))
      colors.push(c.r, c.g, c.b)
      plant.push(h, 0)
    }
  }
  for (let j = 0; j < STALK_SEGMENTS; j++) {
    for (let k = 0; k < STALK_SIDES; k++) {
      const a = j * STALK_SIDES + k
      const b = j * STALK_SIDES + ((k + 1) % STALK_SIDES)
      indices.push(a, b, a + STALK_SIDES, b, b + STALK_SIDES, a + STALK_SIDES)
    }
  }
  return build(positions, colors, plant, indices)
}

/**
 * A lanceolate leaf along +y from its root, folded along the midrib, its tip curling away from the
 * stalk (+z before it is placed).
 */
function leaf(length: number, width: number): THREE.BufferGeometry {
  const segments = 8
  const positions: number[] = []
  const colors: number[] = []
  const plant: number[] = []
  const indices: number[] = []
  const c = new THREE.Color()
  for (let j = 0; j <= segments; j++) {
    const t = j / segments
    const w = width * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.08)), 0.8) * (1 - 0.25 * t)
    const y = length * t
    const curl = 0.18 * length * t * t
    c.copy(LEAF_BASE).lerp(LEAF_TIP, Math.pow(t, 0.7))
    // Left edge, midrib (raised: the fold), right edge.
    positions.push(-w, y, curl, 0, y, curl + 0.22 * w, w, y, curl)
    for (let k = 0; k < 3; k++) {
      const shade = k === 1 ? 0.75 : 1
      colors.push(c.r * shade, c.g * shade, c.b * shade)
      plant.push(0, Math.max(t, 1e-3))
    }
  }
  for (let j = 0; j < segments; j++) {
    const a = 3 * j
    indices.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 1, a + 4, a + 2, a + 2, a + 4, a + 5)
  }
  return build(positions, colors, plant, indices)
}

function build(positions: number[], colors: number[], plant: number[], indices: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  g.setAttribute('aPlant', new THREE.Float32BufferAttribute(plant, 2))
  g.setIndex(indices)
  g.computeVertexNormals()
  return g
}

/** One seaweed: a stalk and leaves alternating up it, smaller toward the top. */
export function seaweedGeometry(seed: number, leafy: boolean): THREE.BufferGeometry {
  const rand = random(seed)
  const parts = [stalk(0.012)]
  const step = leafy ? 0.06 : 0.08
  let side = rand() < 0.5 ? 1 : -1
  for (let h = 0.1; h < 0.97; h += step * between(rand, 0.85, 1.15)) {
    const length = (leafy ? 0.15 : 0.19) * (1 - 0.45 * h)
    const width = (leafy ? 0.05 : 0.042) * (1 - 0.3 * h)
    const g = leaf(length, width)
    // Tilt out from the stalk toward its side, turn about the stalk, and fix at its height.
    g.rotateX(-0.25)
    g.rotateZ(-side * between(rand, 0.65, 0.95))
    g.rotateY(between(rand, -0.9, 0.9))
    g.translate(0, h, 0)
    const plant = g.getAttribute('aPlant')
    for (let i = 0; i < plant.count; i++) plant.setX(i, h)
    parts.push(g)
    side = -side
  }
  const merged = mergeGeometries(parts)
  for (const g of parts) g.dispose()
  if (!merged) throw new Error('seaweedGeometry: parts do not share attributes')
  return merged
}

// ---- Material ----

const VERTEX_HEAD = /* glsl */ `
attribute vec2 aPlant;
attribute vec4 iSway;
uniform float uTime;
`

// iSway: the plant's bend in x and z (from the current), its phase and how much it gives. A vertex
// bends by the square of its height, so the root stays put; leaves ride the stalk and flutter.
const VERTEX = /* glsl */ `
float plantY = max(position.y, 0.0);
float idle = 0.05 * sin(uTime * 1.1 + iSway.z + plantY * 2.2) + 0.025 * sin(uTime * 2.3 + iSway.z * 1.7 + plantY * 4.0);
vec2 plantBend = (iSway.xy + vec2(idle, 0.5 * idle)) * iSway.w;
transformed.x += plantBend.x * plantY * plantY;
transformed.z += plantBend.y * plantY * plantY;
transformed.y -= 0.5 * dot(plantBend, plantBend) * plantY * plantY * plantY;
if (aPlant.y > 0.0) {
  transformed.z += 0.02 * aPlant.y * sin(uTime * 3.1 + iSway.z * 5.0 + aPlant.x * 9.0);
  transformed.x += 0.012 * aPlant.y * sin(uTime * 2.4 + iSway.z * 3.0 + aPlant.x * 7.0);
}
`

// ---- Behaviour ----

/** How far the current bends a plant per unit of flow speed, and the spring's rate and damping. */
const FLOW_GAIN = 0.55
const SPRING = 7
const DAMPING = 3.2
const MAX_BEND = 0.7

interface Plant {
  x: number
  z: number
  height: number
  bendX: number
  bendZ: number
  speedX: number
  speedZ: number
  phase: number
  /** How much this one gives, around 1. */
  flex: number
}

export function createPlants(tank: Tank, seed: number): Life {
  const L = tank.layout
  const rand = random(seed)
  const group = new THREE.Group()
  const variants = [seaweedGeometry(seed + 1, false), seaweedGeometry(seed + 2, true)]
  const material = patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.62, metalness: 0 }), {
    key: 'seaweed',
    uniforms: { uTime: tank.uniforms.uTime },
    vertexHead: VERTEX_HEAD,
    vertex: VERTEX,
  })

  // Behind the digits across the width, faded by the water; in front only at the sides, clear of
  // the digits and of the crabs' sand in the middle.
  const k = L.width / 5
  const back = Math.max(3, Math.round(8 * k))
  const front = Math.max(2, Math.round(5 * k))
  const plants: Plant[][] = [[], []]
  const place = (x: number, z: number, height: number) => {
    const variant = rand() < 0.5 ? 0 : 1
    plants[variant].push({ x, z, height, bendX: 0, bendZ: 0, speedX: 0, speedZ: 0, phase: rand() * 10, flex: between(rand, 0.8, 1.2) })
  }
  // Heights follow the water's depth: tall ones behind reach toward the surface.
  const depth = L.waterLevel - L.floorBase
  for (let i = 0; i < back; i++) place(((i + between(rand, 0.1, 0.9)) / back) * L.width, between(rand, -0.95, -0.35), between(rand, 0.55, 0.9) * depth)
  for (let i = 0; i < front; i++) {
    const t = (i + between(rand, 0.15, 0.85)) / front
    const x = t < 0.5 ? t * 0.56 * L.width : (0.72 + (t - 0.5) * 0.56) * L.width
    place(x, between(rand, 0.08, 0.42), between(rand, 0.3, 0.58) * depth)
  }

  const meshes = variants.map((geometry, v) => {
    const list = plants[v]
    const sway = new THREE.InstancedBufferAttribute(new Float32Array(4 * Math.max(1, list.length)), 4)
    sway.setUsage(THREE.DynamicDrawUsage)
    geometry.setAttribute('iSway', sway)
    const mesh = new THREE.InstancedMesh(geometry, material, list.length)
    mesh.frustumCulled = false
    const m = new THREE.Matrix4()
    const tint = new THREE.Color()
    list.forEach((p, i) => {
      const y = tank.sand(p.x, p.z) - 0.015
      m.makeRotationY(rand() * Math.PI * 2)
      m.scale(new THREE.Vector3(p.height, p.height, p.height))
      m.setPosition(p.x, y, p.z)
      mesh.setMatrixAt(i, m)
      // From olive to blue-green, a little brighter in front.
      tint.setRGB(between(rand, 0.8, 1.15), between(rand, 0.9, 1.1), between(rand, 0.75, 1.2))
      mesh.setColorAt(i, tint)
    })
    group.add(mesh)
    return { mesh, sway, list }
  })

  const flow: Vec2 = { x: 0, y: 0 }
  function update(dt: number): void {
    for (const { sway, list } of meshes) {
      list.forEach((p, i) => {
        if (dt > 0) {
          tank.flowAt(p.x, tank.sand(p.x, 0) + 0.6 * p.height, flow)
          // Rooted and buoyant: in a tilted tank the stalk curves to reach straight up again.
          const goalX = Math.max(-MAX_BEND, Math.min(MAX_BEND, flow.x * FLOW_GAIN + tank.up.x))
          const goalZ = Math.max(-MAX_BEND, Math.min(MAX_BEND, flow.y * FLOW_GAIN * 0.4))
          p.speedX += ((goalX - p.bendX) * SPRING - p.speedX * DAMPING) * dt
          p.speedZ += ((goalZ - p.bendZ) * SPRING - p.speedZ * DAMPING) * dt
          p.bendX += p.speedX * dt
          p.bendZ += p.speedZ * dt
        }
        sway.setXYZW(i, p.bendX, p.bendZ, p.phase, p.flex)
      })
      sway.needsUpdate = true
    }
  }

  update(0)
  return {
    object: group,
    update,
    dispose() {
      // An instanced mesh owns GPU buffers of its own (instance matrices and colours).
      for (const { mesh } of meshes) mesh.dispose()
      for (const g of variants) g.dispose()
      material.dispose()
    },
  }
}
