/** A small seeded generator (mulberry32): the tank is laid out the same way on every visit. */
export function random(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A value between a and b. */
export function between(rand: () => number, a: number, b: number): number {
  return a + (b - a) * rand()
}
