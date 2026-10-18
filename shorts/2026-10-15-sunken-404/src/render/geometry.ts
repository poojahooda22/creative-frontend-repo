// Meshes built from the simulation's shapes: the digits from their glyph outlines, the sand bed
// from the floor curve the water rests on.
import * as THREE from 'three'
import type { GlyphShape, Loop } from '../sim/glyph'

function toPoints(points: Float32Array): THREE.Vector2[] {
  const out: THREE.Vector2[] = []
  for (let i = 0; i < points.length; i += 2) out.push(new THREE.Vector2(points[i], points[i + 1]))
  return out
}

function contains(loop: Loop, x: number, y: number): boolean {
  const p = loop.points
  const n = p.length / 2
  let inside = false
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = p[2 * i]
    const yi = p[2 * i + 1]
    const xj = p[2 * j]
    const yj = p[2 * j + 1]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/**
 * The glyph extruded to `depth`, centred on z = 0, with a rounded bevel. The bevel is inset so the
 * outline the camera sees matches the outline the physics uses.
 */
export function digitGeometry(shape: GlyphShape, depth: number, bevel: number): THREE.ExtrudeGeometry {
  const outers = shape.loops.filter((l) => !l.hole)
  const holes = shape.loops.filter((l) => l.hole)
  const shapes = outers.map((outer) => {
    const s = new THREE.Shape(toPoints(outer.points))
    for (const hole of holes) {
      if (contains(outer, hole.points[0], hole.points[1])) s.holes.push(new THREE.Path(toPoints(hole.points)))
    }
    return s
  })
  const geometry = new THREE.ExtrudeGeometry(shapes, {
    depth: depth - 2 * bevel,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: -bevel,
    bevelSegments: 4,
    curveSegments: 1,
  })
  geometry.translate(0, 0, -depth / 2 + bevel)
  geometry.computeVertexNormals()
  return geometry
}

/**
 * The sand's height at (x, z). On the line z = 0 it is exactly the floor the water and the digits
 * rest on. Behind that line it falls away, so the crest hides the far sand and the camera sees a
 * strip of sand as in the reference, with the back plants rising from behind it; toward the glass
 * it slopes gently down. Ripples grow away from the line.
 */
export function sandHeight(floor: (x: number) => number): (x: number, z: number) => number {
  return (x: number, z: number) => {
    const away = Math.min(1, Math.abs(z) / 0.25)
    const ripples = away * (0.012 * Math.sin(x * 9.3 + z * 4.1) + 0.008 * Math.sin(x * 21.7 - z * 6.3))
    const slope = z < 0 ? -0.35 * Math.pow(-z, 1.5) : -0.08 * z
    return floor(x) + ripples + slope
  }
}

/** The sand bed from `sandHeight`, from the back of the tank to the glass, plus its front face. */
export function sandGeometry(floor: (x: number) => number, width: number, zBack: number, zFront: number): THREE.BufferGeometry {
  const segX = 220
  const segZ = 24
  const height = sandHeight(floor)
  const positions: number[] = []
  const indices: number[] = []
  for (let j = 0; j <= segZ; j++) {
    const z = zBack + ((zFront - zBack) * j) / segZ
    for (let i = 0; i <= segX; i++) {
      const x = -0.2 + ((width + 0.4) * i) / segX
      positions.push(x, height(x, z), z)
    }
  }
  const row = segX + 1
  for (let j = 0; j < segZ; j++) {
    for (let i = 0; i < segX; i++) {
      const a = j * row + i
      const b = a + 1
      const c = a + row
      const d = c + 1
      indices.push(a, c, b, b, c, d)
    }
  }
  // Front face, straight down from the front edge.
  const front = positions.length / 3
  for (let i = 0; i <= segX; i++) {
    const x = -0.2 + ((width + 0.4) * i) / segX
    positions.push(x, height(x, zFront), zFront, x, -1, zFront)
  }
  for (let i = 0; i < segX; i++) {
    const a = front + 2 * i
    indices.push(a, a + 1, a + 2, a + 2, a + 1, a + 3)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}
