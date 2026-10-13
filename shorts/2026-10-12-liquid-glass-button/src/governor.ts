// Decides when the render should get cheaper or richer. Pure: it sees numbers, not the GPU.
//
// Frame intervals alone cannot tell a slow GPU from a slow display. iOS Low Power Mode and
// Chrome's Energy Saver both hold requestAnimationFrame at 30 Hz, so a loop that assumes 16.7 ms
// frames would read an idle flagship as overloaded. So the baseline is the refresh interval the
// display is actually delivering: the shortest interval seen over the last few windows, but never
// stricter than 60 fps. When the browser exposes GPU timer queries, the GPU's own time per frame is
// compared with that budget instead, which also leaves room to step back up.
//
// One limit remains either way: a device that misses every frame of a 60 Hz display delivers a
// steady 33 ms, exactly like a 30 Hz cap, so the budget becomes 33 ms and it settles at a steady
// 30 fps rather than degrading. A steady 50 fps holds for the same reason.

export type Verdict = 'degrade' | 'upgrade' | 'hold'

/** Length of one judgement window (ms). Short enough to react within a beat of the choreography. */
export const WINDOW_MS = 600
// Intervals above this are tab switches or debugger pauses, not render cost.
export const IGNORED_INTERVAL_MS = 100
// Windows of history the refresh estimate keeps, so a refresh cap engaged mid-session is learned.
const REFRESH_WINDOWS = 4
// The frame budget is the refresh interval but never stricter than 60 fps: a 120 or 240 Hz display
// should not cost quality to chase frame rates beyond the motion's needs.
const TARGET_FRAME_MS = 1000 / 60
// Without GPU timing: slow when the mean interval exceeds the refresh interval by this factor
// (60 Hz: 22.5 ms, so frames are being missed), at refresh when within this one.
const SLOW_INTERVAL = 1.35
const AT_REFRESH = 1.05
// With GPU timing: slow above this share of the refresh interval, comfortably fast below that one.
const GPU_SLOW = 0.9
const GPU_FAST = 0.45
// Consecutive fast windows before stepping up, and how many step-ups may follow a step-down.
const FAST_WINDOWS_TO_UPGRADE = 8
const MAX_UPGRADES = 2

export class Governor {
  private windowStart = -1
  private intervalSum = 0
  private intervalCount = 0
  private windowMin = Infinity
  private gpuSum = 0
  private gpuCount = 0
  private recentMins: number[] = []
  private fastStreak = 0
  private upgrades = 0
  private degradedOnce = false

  /** The refresh interval the display is delivering, or Infinity before the first window. */
  get refreshMs(): number {
    return this.recentMins.length ? Math.min(...this.recentMins) : Infinity
  }

  /** One frame: the interval since the last one, and its GPU time when the browser can measure it. */
  frame(now: number, intervalMs: number): void {
    if (this.windowStart < 0) this.windowStart = now
    if (intervalMs <= 0 || intervalMs > IGNORED_INTERVAL_MS) return
    this.intervalSum += intervalMs
    this.intervalCount++
    this.windowMin = Math.min(this.windowMin, intervalMs)
  }

  /** A GPU timer result, which arrives a few frames after the frame it measured. */
  gpu(ms: number): void {
    this.gpuSum += ms
    this.gpuCount++
  }

  /** Call every frame; returns a verdict once per window, 'hold' in between. */
  judge(now: number): Verdict {
    if (this.windowStart < 0 || now - this.windowStart < WINDOW_MS) return 'hold'
    const verdict = this.decide()
    this.windowStart = now
    this.intervalSum = this.intervalCount = this.gpuSum = this.gpuCount = 0
    this.windowMin = Infinity
    return verdict
  }

  private decide(): Verdict {
    if (this.intervalCount === 0) return 'hold'
    if (Number.isFinite(this.windowMin)) {
      this.recentMins.push(this.windowMin)
      if (this.recentMins.length > REFRESH_WINDOWS) this.recentMins.shift()
    }
    const budget = Math.max(this.refreshMs, TARGET_FRAME_MS)
    const meanInterval = this.intervalSum / this.intervalCount
    let slow: boolean
    let fast: boolean
    if (this.gpuCount > 0) {
      const meanGpu = this.gpuSum / this.gpuCount
      slow = meanGpu > GPU_SLOW * budget
      fast = meanGpu < GPU_FAST * budget
    } else {
      slow = meanInterval > SLOW_INTERVAL * budget
      fast = meanInterval < AT_REFRESH * budget
    }
    if (slow) {
      this.fastStreak = 0
      this.degradedOnce = true
      return 'degrade'
    }
    this.fastStreak = fast ? this.fastStreak + 1 : 0
    // Step up only after a step down, a few times at most: no oscillation between two levels.
    if (this.degradedOnce && this.fastStreak >= FAST_WINDOWS_TO_UPGRADE && this.upgrades < MAX_UPGRADES) {
      this.fastStreak = 0
      this.upgrades++
      return 'upgrade'
    }
    return 'hold'
  }
}
