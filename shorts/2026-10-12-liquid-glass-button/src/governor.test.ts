import { describe, expect, it } from 'vitest'
import { Governor, WINDOW_MS, type Verdict } from './governor'

/** Feeds frames at the given intervals (cycling) for `ms`, with optional GPU times; returns the verdicts. */
function run(gov: Governor, ms: number, intervals: number[], gpuMs?: number, start = 0): { verdicts: Verdict[]; end: number } {
  const verdicts: Verdict[] = []
  let now = start
  let i = 0
  while (now - start < ms) {
    const interval = intervals[i++ % intervals.length]
    now += interval
    gov.frame(now, interval)
    if (gpuMs !== undefined) gov.gpu(gpuMs)
    const v = gov.judge(now)
    if (v !== 'hold') verdicts.push(v)
  }
  return { verdicts, end: now }
}

describe('Governor', () => {
  it('reads a 30 Hz refresh cap as the baseline, not as overload', () => {
    // iOS Low Power Mode and Chrome Energy Saver: requestAnimationFrame at 30 Hz.
    const { verdicts } = run(new Governor(), 10_000, [1000 / 30])
    expect(verdicts).not.toContain('degrade')
  })

  it('degrades when a 60 Hz display misses every other frame', () => {
    const { verdicts } = run(new Governor(), 3 * WINDOW_MS, [1000 / 60, 2000 / 60])
    expect(verdicts).toContain('degrade')
  })

  it('degrades on GPU time near the refresh budget, before frames are even missed', () => {
    const { verdicts } = run(new Governor(), 3 * WINDOW_MS, [1000 / 60], 15.5)
    expect(verdicts).toContain('degrade')
  })

  it('holds a fast GPU steady and never upgrades without a step down first', () => {
    const { verdicts } = run(new Governor(), 20_000, [1000 / 60], 3)
    expect(verdicts).toEqual([])
  })

  it('steps back up after recovering, at most twice', () => {
    const gov = new Governor()
    const slow = run(gov, 2 * WINDOW_MS, [1000 / 60], 16)
    expect(slow.verdicts).toContain('degrade')
    const fast = run(gov, 60_000, [1000 / 60], 3, slow.end)
    // The window that straddles the change still averages in slow frames, so it may degrade once.
    expect(fast.verdicts.slice(1)).not.toContain('degrade')
    expect(fast.verdicts.filter((v) => v === 'upgrade')).toHaveLength(2)
  })

  it('does not chase frame rates above 60 on a 144 Hz display', () => {
    // 144 Hz refresh, GPU at 9 ms: well inside 60 fps, so nothing should degrade.
    const { verdicts } = run(new Governor(), 10_000, [1000 / 144], 9)
    expect(verdicts).not.toContain('degrade')
  })

  it('ignores tab switches and pauses', () => {
    const gov = new Governor()
    run(gov, 2 * WINDOW_MS, [1000 / 60])
    gov.frame(5000, 4000)
    expect(gov.refreshMs).toBeCloseTo(1000 / 60, 5)
  })
})
