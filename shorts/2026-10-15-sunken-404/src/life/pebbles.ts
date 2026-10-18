// Pebbles and small shells scattered on the sand in front of the digits.
import * as THREE from 'three'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { patchMaterial, vivid } from './patch'
import { between, random } from './random'
import type { Life, Tank } from './tank'

/** A rounded, slightly lumpy stone of radius about 1. */
function pebbleGeometry(): THREE.BufferGeometry {
  const base = new THREE.IcosahedronGeometry(1, 2)
  base.deleteAttribute('uv')
  base.deleteAttribute('normal')
  const g = mergeVertices(base)
  base.dispose()
  const p = g.getAttribute('position')
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i)
    const y = p.getY(i)
    const z = p.getZ(i)
    const lump = 1 + 0.12 * Math.sin(x * 3.1 + y * 1.7) * Math.cos(z * 2.3 - x)
    p.setXYZ(i, x * lump, y * lump, z * lump)
  }
  g.computeVertexNormals()
  return g
}

/** A scallop lying on the sand: a ribbed fan, hinge at the origin, about 1 across. */
function shellGeometry(): THREE.BufferGeometry {
  const ribs = 11
  const rings = 6
  const positions: number[] = [0, 0.05, 0]
  const indices: number[] = []
  const spread = 1.35
  for (let r = 1; r <= rings; r++) {
    const t = r / rings
    for (let k = 0; k <= 2 * ribs; k++) {
      const a = -spread + (2 * spread * k) / (2 * ribs)
      const ridge = k % 2 === 0 ? 1 : 0.92
      const radius = 0.55 * t * ridge
      positions.push(radius * Math.sin(a), 0.22 * (1 - t * t) * ridge + 0.03, radius * Math.cos(a))
    }
  }
  const row = 2 * ribs + 1
  // Wound so the faces look up (+y): angle grows toward +x.
  for (let k = 0; k < 2 * ribs; k++) indices.push(0, 1 + k, 1 + k + 1)
  for (let r = 0; r < rings - 1; r++) {
    for (let k = 0; k < 2 * ribs; k++) {
      const a = 1 + r * row + k
      const b = a + row
      indices.push(a, b, a + 1, a + 1, b, b + 1)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  g.setIndex(indices)
  g.computeVertexNormals()
  return g
}

const STONES = ['#8f8a80', '#6f6a62', '#a79f90', '#5c5852', '#b8b0a2', '#7b7468']
const SHELLS = ['#efe6da', '#f2d9cc', '#e8dcc8', '#f5ece2']

export function createPebbles(tank: Tank, seed: number): Life {
  const L = tank.layout
  const rand = random(seed)
  const group = new THREE.Group()
  const k = L.width / 5
  const material = (roughness: number, key: string) =>
    patchMaterial(new THREE.MeshStandardMaterial({ roughness, metalness: 0 }), {
      key,
      uniforms: { ...tank.uniforms },
      vertexHead: vivid.vertexHead,
      vertex: vivid.vertexWorld,
      fragmentHead: vivid.fragmentHead,
      output: vivid.output,
    })

  const sets = [
    { geometry: pebbleGeometry(), material: material(0.85, 'pebble'), count: Math.max(8, Math.round(46 * k)), size: [0.008, 0.024], squash: 0.55, colors: STONES },
    { geometry: shellGeometry(), material: material(0.5, 'shell'), count: Math.max(2, Math.round(8 * k)), size: [0.03, 0.045], squash: 1, colors: SHELLS },
  ]
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const p = new THREE.Vector3()
  const s = new THREE.Vector3()
  const c = new THREE.Color()
  const meshes = sets.map((set) => {
    const mesh = new THREE.InstancedMesh(set.geometry, set.material, set.count)
    for (let i = 0; i < set.count; i++) {
      const size = between(rand, set.size[0], set.size[1]) * tank.scale
      const x = between(rand, 0.02, 0.98) * L.width
      const z = between(rand, 0.04, 0.46)
      p.set(x, tank.sand(x, z) + 0.25 * size * set.squash, z)
      q.setFromEuler(new THREE.Euler(between(rand, -0.15, 0.15), rand() * Math.PI * 2, between(rand, -0.15, 0.15)))
      s.set(size, size * set.squash, size * between(rand, 0.7, 1))
      mesh.setMatrixAt(i, m.compose(p, q, s))
      mesh.setColorAt(i, c.set(set.colors[Math.floor(rand() * set.colors.length)]))
    }
    group.add(mesh)
    return mesh
  })

  return {
    object: group,
    update() {},
    dispose() {
      // An instanced mesh owns GPU buffers of its own (instance matrices and colours).
      for (const mesh of meshes) mesh.dispose()
      for (const set of sets) {
        set.geometry.dispose()
        set.material.dispose()
      }
    },
  }
}
