import { describe, expect, it } from 'vitest'
import { linear, mulberry32, ring, track, type Key } from './motion'

describe('track', () => {
  const keys: Key[] = [
    [1, 10],
    [2, 20, linear],
    [4, 0],
  ]

  it('holds the first and last values outside the keys', () => {
    expect(track(0, keys)).toBe(10)
    expect(track(9, keys)).toBe(0)
  })

  it('passes through every key exactly', () => {
    for (const [t, v] of keys) expect(track(t, keys)).toBe(v)
  })

  it('uses the ease of the segment it is in', () => {
    expect(track(1.5, keys)).toBeCloseTo(15, 10)
  })

  it('is continuous across keys', () => {
    for (const [t] of keys) {
      expect(Math.abs(track(t - 1e-6, keys) - track(t + 1e-6, keys))).toBeLessThan(1e-3)
    }
  })
})

describe('ring', () => {
  it('is silent before and at its start, so an impulse never pops', () => {
    expect(ring(0.5, 1, 0.2, 3, 4)).toBe(0)
    expect(ring(1, 1, 0.2, 3, 4)).toBe(0)
  })

  it('decays inside its exponential envelope', () => {
    for (let t = 1; t < 4; t += 0.01) {
      expect(Math.abs(ring(t, 1, 0.2, 3, 4))).toBeLessThanOrEqual(0.2 * Math.exp(-4 * (t - 1)) + 1e-12)
    }
  })
})

describe('mulberry32', () => {
  it('repeats exactly for the same seed and stays in [0, 1)', () => {
    const a = mulberry32(7)
    const b = mulberry32(7)
    for (let i = 0; i < 1000; i++) {
      const x = a()
      expect(x).toBe(b())
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThan(1)
    }
  })
})
