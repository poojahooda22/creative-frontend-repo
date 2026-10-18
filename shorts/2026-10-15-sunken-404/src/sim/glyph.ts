// A glyph as a rigid body's shape: a signed distance field for collisions and buoyancy, outline
// loops for the 3D mesh, and interior and boundary samples for the forces. Everything here is pure
// and runs on a coverage mask, in the page or the physics worker; the mask itself comes from the
// page (render/raster.ts), which has the font and a canvas.

export interface Loop {
  points: Float32Array
  /** True for a counter (the hole in a 0 or a 4). */
  hole: boolean
}

export interface GlyphShape {
  /** Bounds of the ink in local units (origin at the centre of mass, y up). */
  minX: number
  minY: number
  maxX: number
  maxY: number
  /** Signed distance grid in local units: negative inside. */
  sdf: Float32Array
  sdfW: number
  sdfH: number
  sdfX0: number
  sdfY0: number
  sdfCell: number
  loops: Loop[]
  /**
   * Interior sample points (x, y pairs) and the area each one stands for. For physics the counters
   * are filled (water sealed in a counter would have nowhere to go), so a sample is either ink or
   * counter water the digit carries.
   */
  interior: Float32Array
  interiorInk: Uint8Array
  interiorArea: number
  /** Boundary samples (x, y pairs), their outward normals and the arc length each covers. */
  boundary: Float32Array
  boundaryNormal: Float32Array
  boundaryLength: number
  /** Filled area (ink plus counters), the ink alone, and the filled second moment about the origin. */
  area: number
  inkArea: number
  polarMoment: number
}

/** The mask with its counters filled: pixels not reachable from the border through empty pixels. */
export function fillCounters(mask: Mask): Mask {
  const { width, height, data } = mask
  const outside = new Uint8Array(width * height)
  const stack: number[] = []
  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return
    const i = y * width + x
    if (outside[i] || data[i] >= 0.5) return
    outside[i] = 1
    stack.push(i)
  }
  for (let x = 0; x < width; x++) {
    push(x, 0)
    push(x, height - 1)
  }
  for (let y = 0; y < height; y++) {
    push(0, y)
    push(width - 1, y)
  }
  while (stack.length > 0) {
    const i = stack.pop() as number
    const x = i % width
    const y = (i - x) / width
    push(x + 1, y)
    push(x - 1, y)
    push(x, y + 1)
    push(x, y - 1)
  }
  const filled = new Float32Array(width * height)
  for (let i = 0; i < filled.length; i++) filled[i] = outside[i] ? data[i] : Math.max(data[i], 1)
  return { width, height, data: filled }
}

export interface Mask {
  width: number
  height: number
  /** Coverage 0..1, row-major, row 0 at the top. */
  data: Float32Array
}

const INF = 1e20

/** Felzenszwalb and Huttenlocher's 1D squared distance transform (lower envelope of parabolas). */
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0
  v[0] = 0
  z[0] = -INF
  z[1] = INF
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    while (s <= z[k]) {
      k--
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    }
    k++
    v[k] = q
    z[k] = s
    z[k + 1] = INF
  }
  k = 0
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++
    const dq = q - v[k]
    d[q] = dq * dq + f[v[k]]
  }
}

/** Exact squared Euclidean distance (in pixels) from each pixel to the nearest pixel where `seed` is true. */
export function squaredDistance(width: number, height: number, seed: (i: number) => boolean): Float64Array {
  const grid = new Float64Array(width * height)
  for (let i = 0; i < grid.length; i++) grid[i] = seed(i) ? 0 : INF
  const n = Math.max(width, height)
  const f = new Float64Array(n)
  const d = new Float64Array(n)
  const v = new Int32Array(n)
  const z = new Float64Array(n + 1)
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) f[y] = grid[y * width + x]
    edt1d(f, height, d, v, z)
    for (let y = 0; y < height; y++) grid[y * width + x] = d[y]
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) f[x] = grid[y * width + x]
    edt1d(f, width, d, v, z)
    for (let x = 0; x < width; x++) grid[y * width + x] = d[x]
  }
  return grid
}

/** Signed distance in pixels: negative inside the ink (coverage above one half). */
export function signedDistance(mask: Mask): Float32Array {
  const { width, height, data } = mask
  const toInside = squaredDistance(width, height, (i) => data[i] >= 0.5)
  const toOutside = squaredDistance(width, height, (i) => data[i] < 0.5)
  const out = new Float32Array(width * height)
  for (let i = 0; i < out.length; i++) {
    // Half a pixel either way puts the zero crossing on the pixel boundary, not on a pixel centre.
    out[i] = data[i] >= 0.5 ? -(Math.sqrt(toOutside[i]) - 0.5) : Math.sqrt(toInside[i]) - 0.5
  }
  return out
}

/**
 * Marching squares on the coverage field at 0.5, with edge crossings interpolated from coverage.
 * Returns closed loops in pixel coordinates (x right, y down).
 */
export function traceContours(mask: Mask): Float32Array[] {
  const { width, height, data } = mask
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= width || y >= height ? 0 : data[y * width + x])
  // Edge ids: horizontal edge (x, y)-(x+1, y) and vertical edge (x, y)-(x, y+1), on a grid padded by one.
  const W = width + 2
  const hEdge = (x: number, y: number) => 2 * ((y + 1) * W + (x + 1))
  const vEdge = (x: number, y: number) => 2 * ((y + 1) * W + (x + 1)) + 1
  const point = new Map<number, [number, number]>()
  const crossing = (id: number, ax: number, ay: number, bx: number, by: number): number => {
    if (!point.has(id)) {
      const a = at(ax, ay)
      const b = at(bx, by)
      const t = a === b ? 0.5 : (0.5 - a) / (b - a)
      point.set(id, [ax + (bx - ax) * t, ay + (by - ay) * t])
    }
    return id
  }
  const next = new Map<number, number>()
  const link = (from: number, to: number) => next.set(from, to)

  for (let y = -1; y < height; y++) {
    for (let x = -1; x < width; x++) {
      const tl = at(x, y) >= 0.5 ? 1 : 0
      const tr = at(x + 1, y) >= 0.5 ? 1 : 0
      const br = at(x + 1, y + 1) >= 0.5 ? 1 : 0
      const bl = at(x, y + 1) >= 0.5 ? 1 : 0
      const code = (tl << 3) | (tr << 2) | (br << 1) | bl
      if (code === 0 || code === 15) continue
      const top = () => crossing(hEdge(x, y), x, y, x + 1, y)
      const right = () => crossing(vEdge(x + 1, y), x + 1, y, x + 1, y + 1)
      const bottom = () => crossing(hEdge(x, y + 1), x, y + 1, x + 1, y + 1)
      const left = () => crossing(vEdge(x, y), x, y, x, y + 1)
      // Segments run with the ink on their left (y down), so loops close consistently.
      switch (code) {
        case 1: link(left(), bottom()); break
        case 2: link(bottom(), right()); break
        case 3: link(left(), right()); break
        case 4: link(right(), top()); break
        case 6: link(bottom(), top()); break
        case 7: link(left(), top()); break
        case 8: link(top(), left()); break
        case 9: link(top(), bottom()); break
        case 11: link(top(), right()); break
        case 12: link(right(), left()); break
        case 13: link(right(), bottom()); break
        case 14: link(bottom(), left()); break
        case 5:
        case 10: {
          // Saddle: the centre decides whether the two ink corners join.
          const centre = (at(x, y) + at(x + 1, y) + at(x + 1, y + 1) + at(x, y + 1)) / 4 >= 0.5
          if (code === 5) {
            if (centre) {
              link(left(), top())
              link(right(), bottom())
            } else {
              link(left(), bottom())
              link(right(), top())
            }
          } else if (centre) {
            link(bottom(), left())
            link(top(), right())
          } else {
            link(top(), left())
            link(bottom(), right())
          }
          break
        }
      }
    }
  }

  const loops: Float32Array[] = []
  const visited = new Set<number>()
  for (const start of next.keys()) {
    if (visited.has(start)) continue
    const pts: number[] = []
    let id: number | undefined = start
    while (id !== undefined && !visited.has(id)) {
      visited.add(id)
      const p = point.get(id)
      if (p) pts.push(p[0], p[1])
      id = next.get(id)
    }
    if (pts.length >= 6) loops.push(new Float32Array(pts))
  }
  return loops
}

/** Ramer-Douglas-Peucker on a closed loop. */
export function simplifyLoop(points: Float32Array, epsilon: number): Float32Array {
  const n = points.length / 2
  if (n < 4) return points
  // Split the loop at point 0 and the point farthest from it (close to its widest span), so both
  // halves are open polylines.
  let far = 0
  let best = -1
  for (let i = 1; i < n; i++) {
    const d = (points[2 * i] - points[0]) ** 2 + (points[2 * i + 1] - points[1]) ** 2
    if (d > best) {
      best = d
      far = i
    }
  }
  const keep = new Uint8Array(n)
  keep[0] = 1
  keep[far] = 1
  const stack: Array<[number, number]> = [
    [0, far],
    [far, n],
  ]
  while (stack.length > 0) {
    const [a, b] = stack.pop() as [number, number]
    const bi = b % n
    const ax = points[2 * a]
    const ay = points[2 * a + 1]
    const bx = points[2 * bi]
    const by = points[2 * bi + 1]
    const len = Math.hypot(bx - ax, by - ay) || 1
    let worst = -1
    let index = -1
    for (let i = a + 1; i < b; i++) {
      const px = points[2 * i]
      const py = points[2 * i + 1]
      const d = Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len
      if (d > worst) {
        worst = d
        index = i
      }
    }
    if (worst > epsilon && index > 0) {
      keep[index] = 1
      stack.push([a, index], [index, b])
    }
  }
  const out: number[] = []
  for (let i = 0; i < n; i++) if (keep[i]) out.push(points[2 * i], points[2 * i + 1])
  return new Float32Array(out)
}

/** Twice the signed area (shoelace); positive for counter-clockwise in y-up coordinates. */
export function signedArea(points: Float32Array): number {
  let a = 0
  const n = points.length / 2
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    a += points[2 * i] * points[2 * j + 1] - points[2 * j] * points[2 * i + 1]
  }
  return a / 2
}

function insideLoop(points: Float32Array, x: number, y: number): boolean {
  let inside = false
  const n = points.length / 2
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = points[2 * i]
    const yi = points[2 * i + 1]
    const xj = points[2 * j]
    const yj = points[2 * j + 1]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/**
 * Builds the body shape from a coverage mask. `height` is the size in local units the ink's height
 * maps to; `samplesAcross` sets the interior sample spacing as a fraction of that height.
 */
export function buildGlyphShape(mask: Mask, height: number, samplesAcross = 26, boundarySamples = 44): GlyphShape {
  const { width: w, height: hgt, data } = mask
  // Ink bounds in pixels.
  let px0 = w
  let py0 = hgt
  let px1 = -1
  let py1 = -1
  for (let y = 0; y < hgt; y++) {
    for (let x = 0; x < w; x++) {
      if (data[y * w + x] < 0.5) continue
      if (x < px0) px0 = x
      if (x > px1) px1 = x
      if (y < py0) py0 = y
      if (y > py1) py1 = y
    }
  }
  if (px1 < 0) throw new Error('buildGlyphShape: the mask has no ink')
  const scale = height / (py1 - py0 + 1)

  // Centre of mass of the ink, in pixels.
  let mass = 0
  let mx = 0
  let my = 0
  for (let y = py0; y <= py1; y++) {
    for (let x = px0; x <= px1; x++) {
      const c = data[y * w + x]
      mass += c
      mx += c * (x + 0.5)
      my += c * (y + 0.5)
    }
  }
  mx /= mass
  my /= mass
  // Pixel (x, y down) to local (x, y up) about the centre of mass.
  const lx = (x: number) => (x - mx) * scale
  const ly = (y: number) => (my - y) * scale

  // Physics runs on the filled shape; the outline loops keep the counters for the mesh.
  const solid = fillCounters(mask)
  const sdfPx = signedDistance(solid)
  const inkSdfPx = signedDistance(mask)
  const inkAt = (lxv: number, lyv: number) => {
    const px = Math.round(lxv / scale + mx - 0.5)
    const py = Math.round(my - lyv / scale - 0.5)
    if (px < 0 || py < 0 || px >= w || py >= hgt) return false
    return inkSdfPx[py * w + px] < 0
  }
  // Physics grid: every `step` pixels, flipped to y up.
  const step = Math.max(1, Math.round(hgt / 160))
  const sdfW = Math.ceil(w / step)
  const sdfH = Math.ceil(hgt / step)
  const sdf = new Float32Array(sdfW * sdfH)
  for (let gy = 0; gy < sdfH; gy++) {
    const py = Math.min(hgt - 1, (sdfH - 1 - gy) * step)
    for (let gx = 0; gx < sdfW; gx++) {
      const px = Math.min(w - 1, gx * step)
      sdf[gy * sdfW + gx] = sdfPx[py * w + px] * scale
    }
  }
  // Grid sample (gx, gy) sits at pixel centre (gx step + 0.5, (sdfH - 1 - gy) step + 0.5).
  const sdfX0 = lx(0.5)
  const sdfY0 = ly((sdfH - 1) * step + 0.5)
  const sdfCell = step * scale

  // Outline loops in local units, simplified to a fraction of a pixel.
  const loops: Loop[] = traceContours(mask).map((raw) => {
    const simple = simplifyLoop(raw, 0.35)
    const pts = new Float32Array(simple.length)
    for (let i = 0; i < simple.length; i += 2) {
      pts[i] = lx(simple[i])
      pts[i + 1] = ly(simple[i + 1])
    }
    return { points: pts, hole: false }
  })
  for (const loop of loops) {
    let depth = 0
    for (const other of loops) {
      if (other !== loop && insideLoop(other.points, loop.points[0], loop.points[1])) depth++
    }
    loop.hole = depth % 2 === 1
  }

  const shape: GlyphShape = {
    minX: lx(px0),
    maxX: lx(px1 + 1),
    minY: ly(py1 + 1),
    maxY: ly(py0),
    sdf,
    sdfW,
    sdfH,
    sdfX0,
    sdfY0,
    sdfCell,
    loops,
    interior: new Float32Array(0),
    interiorInk: new Uint8Array(0),
    interiorArea: 0,
    boundary: new Float32Array(0),
    boundaryNormal: new Float32Array(0),
    boundaryLength: 0,
    area: 0,
    inkArea: 0,
    polarMoment: 0,
  }

  // Interior samples on a square lattice over the filled shape.
  const spacing = height / samplesAcross
  const interior: number[] = []
  const ink: number[] = []
  for (let y = shape.minY + spacing / 2; y < shape.maxY; y += spacing) {
    for (let x = shape.minX + spacing / 2; x < shape.maxX; x += spacing) {
      if (sampleSdf(shape, x, y) >= 0) continue
      interior.push(x, y)
      ink.push(inkAt(x, y) ? 1 : 0)
    }
  }
  shape.interior = new Float32Array(interior)
  shape.interiorInk = Uint8Array.from(ink)
  shape.interiorArea = spacing * spacing
  shape.area = (interior.length / 2) * shape.interiorArea
  shape.inkArea = ink.reduce((a, b) => a + b, 0) * shape.interiorArea
  let moment = 0
  for (let i = 0; i < interior.length; i += 2) moment += interior[i] ** 2 + interior[i + 1] ** 2
  shape.polarMoment = moment * shape.interiorArea

  // Boundary samples, evenly spaced along the outer loops (the counters are filled for physics).
  const ds = height / boundarySamples
  const boundary: number[] = []
  const normals: number[] = []
  const grad = { nx: 0, ny: 0 }
  for (const loop of loops) {
    if (loop.hole) continue
    const p = loop.points
    const n = p.length / 2
    let carry = 0
    for (let i = 0; i < n; i++) {
      const ax = p[2 * i]
      const ay = p[2 * i + 1]
      const bx = p[2 * ((i + 1) % n)]
      const by = p[2 * ((i + 1) % n) + 1]
      const len = Math.hypot(bx - ax, by - ay)
      let t = carry
      while (t < len) {
        const x = ax + ((bx - ax) * t) / len
        const y = ay + ((by - ay) * t) / len
        sampleSdfGradient(shape, x, y, grad)
        boundary.push(x, y)
        normals.push(grad.nx, grad.ny)
        t += ds
      }
      carry = t - len
    }
  }
  shape.boundary = new Float32Array(boundary)
  shape.boundaryNormal = new Float32Array(normals)
  shape.boundaryLength = ds
  return shape
}

/** Bilinear signed distance at a local point; outside the grid, a conservative distance to it. */
export function sampleSdf(shape: GlyphShape, x: number, y: number): number {
  const gx = (x - shape.sdfX0) / shape.sdfCell
  const gy = (y - shape.sdfY0) / shape.sdfCell
  const maxX = shape.sdfW - 1
  const maxY = shape.sdfH - 1
  const cx = gx < 0 ? 0 : gx > maxX ? maxX : gx
  const cy = gy < 0 ? 0 : gy > maxY ? maxY : gy
  const i = Math.min(Math.floor(cx), maxX - 1)
  const j = Math.min(Math.floor(cy), maxY - 1)
  const tx = cx - i
  const ty = cy - j
  const s = shape.sdf
  const w = shape.sdfW
  const d =
    (1 - tx) * (1 - ty) * s[j * w + i] + tx * (1 - ty) * s[j * w + i + 1] + (1 - tx) * ty * s[(j + 1) * w + i] + tx * ty * s[(j + 1) * w + i + 1]
  // Beyond the grid the field is at least the distance to its edge plus the edge value.
  const outside = Math.hypot((gx - cx) * shape.sdfCell, (gy - cy) * shape.sdfCell)
  return d + outside
}

/** Unit gradient of the signed distance (the outward normal) at a local point. */
export function sampleSdfGradient(shape: GlyphShape, x: number, y: number, out: { nx: number; ny: number }): void {
  const e = shape.sdfCell
  const gx = sampleSdf(shape, x + e, y) - sampleSdf(shape, x - e, y)
  const gy = sampleSdf(shape, x, y + e) - sampleSdf(shape, x, y - e)
  const len = Math.hypot(gx, gy)
  if (len < 1e-9) {
    out.nx = 0
    out.ny = 1
  } else {
    out.nx = gx / len
    out.ny = gy / len
  }
}
