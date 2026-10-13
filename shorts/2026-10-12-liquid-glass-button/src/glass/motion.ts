// Easing, keyframe tracks and damped rings. Every curve is a pure function of time,
// so any moment of the cycle can be rendered on demand.

export type Ease = (x: number) => number

export const linear: Ease = (x) => x
export const inQuad: Ease = (x) => x * x
export const outQuad: Ease = (x) => 1 - (1 - x) * (1 - x)
export const inCubic: Ease = (x) => x * x * x
export const outCubic: Ease = (x) => 1 - (1 - x) ** 3
export const inOutCubic: Ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2)
export const outQuart: Ease = (x) => 1 - (1 - x) ** 4
export const inOutSine: Ease = (x) => -(Math.cos(Math.PI * x) - 1) / 2

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

export function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** [time, value, ease into this key from the previous one]. */
export type Key = readonly [number, number, Ease?]

/** Piecewise curve through the keys; holds the first and last values outside them. */
export function track(t: number, keys: readonly Key[]): number {
  if (t <= keys[0][0]) return keys[0][1]
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1, ease = inOutCubic] = keys[i]
    if (t <= t1) {
      const [t0, v0] = keys[i - 1]
      return v0 + (v1 - v0) * ease((t - t0) / (t1 - t0))
    }
  }
  return keys[keys.length - 1][1]
}

/**
 * A damped sinusoid that starts at t0: the jiggle a liquid body keeps after an impulse.
 * Zero before t0 and zero at t0, so it never pops.
 */
export function ring(t: number, t0: number, amplitude: number, hz: number, decay: number): number {
  if (t <= t0) return 0
  const age = t - t0
  return amplitude * Math.exp(-decay * age) * Math.sin(2 * Math.PI * hz * age)
}

/** Deterministic PRNG so the droplet sprays are identical every cycle. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
