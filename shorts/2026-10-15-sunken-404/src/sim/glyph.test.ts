import { describe, expect, it } from 'vitest'
import { buildGlyphShape, sampleSdf, sampleSdfGradient, signedArea, signedDistance, simplifyLoop, traceContours } from './glyph'
import { boxMask, ringMask } from './testing'

describe('signedDistance', () => {
  it('is exact for a box: depth inside, Euclidean distance outside', () => {
    const mask = boxMask(40, 20, 10)
    const sdf = signedDistance(mask)
    const at = (x: number, y: number) => sdf[y * mask.width + x]
    // Centre of the box: 10 px from the long edges, minus the half-pixel boundary offset.
    expect(at(30, 20)).toBeCloseTo(-9.5, 5)
    // Outside a corner, diagonally: the distance to the nearest ink pixel centre less half a pixel.
    expect(at(6, 6)).toBeCloseTo(Math.hypot(4, 4) - 0.5, 5)
  })
})

describe('traceContours', () => {
  it('traces one closed loop around a box with the right area', () => {
    const loops = traceContours(boxMask(30, 12))
    expect(loops).toHaveLength(1)
    expect(Math.abs(signedArea(loops[0]))).toBeCloseTo(30 * 12, -1)
  })

  it('traces an outer loop and a counter for a ring', () => {
    const loops = traceContours(ringMask(40, 60, 12))
    expect(loops).toHaveLength(2)
  })

  it('keeps the shape when simplified', () => {
    const [loop] = traceContours(ringMask(50, 50, 50))
    const simple = simplifyLoop(loop, 0.35)
    expect(simple.length).toBeLessThan(loop.length)
    expect(Math.abs(signedArea(simple))).toBeGreaterThan(0.99 * Math.abs(signedArea(loop)))
  })
})

describe('buildGlyphShape', () => {
  it('scales the ink to the requested height and centres it on its mass', () => {
    const shape = buildGlyphShape(boxMask(50, 100), 1)
    expect(shape.maxY - shape.minY).toBeCloseTo(1, 5)
    expect(shape.maxX - shape.minX).toBeCloseTo(0.5, 5)
    expect((shape.minX + shape.maxX) / 2).toBeCloseTo(0, 5)
    expect((shape.minY + shape.maxY) / 2).toBeCloseTo(0, 5)
    // Area from the interior samples, within a sample's worth of the true 0.5.
    expect(shape.area).toBeGreaterThan(0.47)
    expect(shape.area).toBeLessThan(0.53)
  })

  it('keeps the counter of a ring as a hole for the mesh, but fills it for physics as carried water', () => {
    const shape = buildGlyphShape(ringMask(60, 90, 20), 1)
    expect(shape.loops.filter((l) => l.hole)).toHaveLength(1)
    expect(shape.loops.filter((l) => !l.hole)).toHaveLength(1)
    // Water cannot be sealed inside the counter: the physics shape is solid there.
    expect(sampleSdf(shape, 0, 0)).toBeLessThan(0)
    // Samples in the counter are flagged as water, the ring's as ink.
    let ink = 0
    let water = 0
    for (let i = 0, k = 0; i < shape.interior.length; i += 2, k++) {
      const x = shape.interior[i]
      const y = shape.interior[i + 1]
      const inCounter = (x / ((60 - 20) / 180)) ** 2 + (y / ((90 - 20) / 180)) ** 2 < 0.9
      if (inCounter) expect(shape.interiorInk[k]).toBe(0)
      if (shape.interiorInk[k]) ink++
      else water++
    }
    expect(ink).toBeGreaterThan(0)
    expect(water).toBeGreaterThan(0)
    expect(shape.inkArea).toBeLessThan(shape.area)
  })

  it('gives boundary normals that point out of the ink', () => {
    const shape = buildGlyphShape(boxMask(60, 100), 1)
    const n = { nx: 0, ny: 0 }
    for (let i = 0; i < shape.boundary.length; i += 2) {
      const x = shape.boundary[i]
      const y = shape.boundary[i + 1]
      sampleSdfGradient(shape, x, y, n)
      expect(Math.abs(sampleSdf(shape, x, y))).toBeLessThan(0.02)
      // A step along the normal leaves the ink.
      expect(sampleSdf(shape, x + 0.03 * n.nx, y + 0.03 * n.ny)).toBeGreaterThan(0)
    }
  })
})
