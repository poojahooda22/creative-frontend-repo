import { describe, expect, it } from 'vitest'
import { createCycleState, CYCLE_SECONDS, MAX_DROPS, REST_FROM, sampleCycle, WAKE_FROM, type CycleState } from './cycle'
import type { AtlasCell, LabelLayout } from './labels'

const cell: AtlasCell = { u: 0, v: 0, du: 0.5, dv: 0.25, width: 1, height: 0.5 }

// Layouts as buildLabelAtlas makes them, for a short word and a long one.
function layout(text: string, wordWidth: number): LabelLayout {
  const halfOuter = (0.52 + wordWidth + 0.32 + 0.25 + 0.26 + 0.46) / 2
  return {
    text,
    halfLength: halfOuter - 0.5,
    wordWidth,
    wordX: -halfOuter + 0.52 + wordWidth / 2,
    dividerX: -halfOuter + 0.52 + wordWidth + 0.32,
    arrowX: halfOuter - 0.46 - 0.13,
    word: cell,
  }
}

const explore = layout('Explore', 0.83)
const getStarted = layout('Get started', 1.45)

function sample(t: number, current = explore, previous: LabelLayout | null = getStarted): CycleState {
  const state = createCycleState()
  sampleCycle(t, current, previous, state)
  return state
}

/** Everything that shapes the frame, flattened, so two instants can be compared. */
function signature(s: CycleState): number[] {
  const [b] = s.bodies
  return [
    b.a.x, b.a.y, b.a.z, b.a.r, b.a.stretch,
    b.b.x, b.b.y, b.b.z, b.b.r, b.b.stretch,
    b.waist, b.k, b.depth, b.connect, b.pill, b.textScaleX, b.textScaleY,
    b.word.x, b.arrow.x, b.divider.alpha,
    s.orb.intensity, s.wave.amplitude, s.dropCount, s.crown.collar, s.crown.finger,
    s.camElevation, s.camDistance, s.floorY, s.warmth, s.textBlur,
  ]
}

describe('sampleCycle', () => {
  it('is a pure function of time', () => {
    for (const t of [0.3, 2.2, 4.7, 6.6, 9.1]) {
      expect(signature(sample(t))).toEqual(signature(sample(t)))
    }
  })

  it('rests exactly where a press jumps to, so a click at rest cannot pop', () => {
    // activate() sets the clock from anywhere in [REST_FROM, CYCLE_SECONDS) to WAKE_FROM.
    const jumpTo = signature(sample(WAKE_FROM))
    for (let t = REST_FROM; t < CYCLE_SECONDS; t += 0.05) {
      const rest = signature(sample(t))
      rest.forEach((v, i) => expect(Math.abs(v - jumpTo[i])).toBeLessThan(0.01))
    }
  })

  it('never produces NaN, a negative radius or more drops than the shader holds', () => {
    for (const current of [explore, getStarted]) {
      for (let t = 0; t < CYCLE_SECONDS; t += 0.002) {
        const s = sample(t, current)
        expect(signature(s).every(Number.isFinite)).toBe(true)
        expect(s.dropCount).toBeLessThanOrEqual(MAX_DROPS)
        for (let i = 0; i < s.dropCount; i++) {
          const d = s.drops[i]
          expect([d.x, d.y, d.z, d.r, d.tx, d.ty, d.tz].every(Number.isFinite)).toBe(true)
          expect(d.r).toBeGreaterThanOrEqual(0)
        }
        for (const b of s.bodies) {
          if (!b.enabled) continue
          expect(b.a.r).toBeGreaterThan(0)
          expect(b.b.r).toBeGreaterThan(0)
          expect(b.waist).toBeGreaterThanOrEqual(0)
        }
      }
    }
  })

  it('never jumps: lobes move continuously between 1 ms samples', () => {
    // The fastest move is the swipe, about 15 world units per second at its start
    // (4.8 units over 0.95 s on a cubic ease-out), so 20 per second bounds every real move
    // while any discontinuity (a jump of 0.05 or more) still fails.
    const perMs = 0.02
    let prev = sample(0)
    for (let t = 0.001; t < CYCLE_SECONDS; t += 0.001) {
      const next = sample(t)
      const [a, b] = [prev.bodies[0], next.bodies[0]]
      expect(Math.abs(b.a.x - a.a.x)).toBeLessThan(perMs)
      expect(Math.abs(b.b.x - a.b.x)).toBeLessThan(perMs)
      expect(Math.abs(b.a.r - a.a.r)).toBeLessThan(perMs)
      prev = next
    }
  })

  it('keeps the word inside its drop once split', () => {
    for (const current of [explore, getStarted]) {
      const s = sample(5.2, current)
      const [b] = s.bodies
      // The word is centred in the big drop and narrower than it (before ball-lens magnification).
      expect(Math.abs(b.word.x - b.a.x)).toBeLessThan(1e-9)
      expect(current.wordWidth * b.textScaleX * 1.38).toBeLessThan(2 * b.a.r)
    }
  })
})
