import type { UploadItem } from '../types'
import type { PrintRenderer } from './renderer'

/**
 * The develop follows confirmed bytes, but never finishes faster than this, so the reveal
 * is visible even on a fast connection. It is a floor, not a fake: the status line reports
 * "uploaded" the moment the server confirms, while the print is still clearing.
 */
const MIN_REVEAL_SECONDS = 2
/** With other files waiting, a print clears quickly so the camera never holds up the queue. */
const BACKLOG_REVEAL_SECONDS = 0.6
const FAILURE_SECONDS = 0.9

interface DevelopState {
  develop: number
  fog: number
  overexpose: number
  dud: number
}

function goalFor(item: UploadItem, current: DevelopState): DevelopState {
  switch (item.status) {
    case 'queued':
      return { develop: 0, fog: 0, overexpose: 0, dud: 0 }
    case 'uploading':
      // Hold back the last stretch until the server confirms the file.
      return { develop: item.progress * 0.92, fog: 0, overexpose: 0, dud: 0 }
    case 'uploaded':
      return { develop: 1, fog: 0, overexpose: 0, dud: 0 }
    case 'failed':
      if (item.failure?.kind === 'network') return { develop: current.develop, fog: 1, overexpose: 0, dud: 0 }
      if (item.failure?.kind === 'size') return { develop: 0, fog: 0, overexpose: 1, dud: 0 }
      return { develop: 0, fog: 0, overexpose: 0, dud: 1 }
  }
}

function approachDevelop(value: number, goal: number, seconds: number, floorSeconds: number): number {
  if (goal <= value) return Math.max(goal, value - seconds * 2)
  const eased = value + (goal - value) * (1 - Math.exp(-seconds * 4))
  return floorSeconds > 0 ? Math.min(eased, value + seconds / floorSeconds) : eased
}

function toward(value: number, goal: number, seconds: number): number {
  const step = seconds / FAILURE_SECONDS
  return value < goal ? Math.min(goal, value + step) : Math.max(goal, value - step)
}

function isSettled(item: UploadItem, state: DevelopState): boolean {
  if (item.status === 'uploaded') return state.develop === 1
  if (item.status !== 'failed') return false
  const goal = goalFor(item, state)
  return state.fog === goal.fog && state.overexpose === goal.overexpose && state.dud === goal.dud && state.develop === goal.develop
}

export interface DevelopLoop {
  /** Start drawing again if the item has somewhere new to go. Safe to call on every render. */
  wake: () => void
  stop: () => void
}

interface DevelopLoopOptions {
  renderer: PrintRenderer
  seed: number
  /** For viewers who prefer reduced motion: still grain and no minimum reveal. */
  reducedMotion: boolean
  read: () => UploadItem
  /** True while other files are waiting on the camera. */
  hurried: () => boolean
  onRevealed: () => void
  /** The shader failed to build; the owner should move the print to a 2D surface. */
  onRendererFailed: () => void
}

/**
 * Drives one print from the latest item state. Frames run only while the print is
 * changing, and the loop sleeps once an uploaded or failed print has settled.
 */
export function startDevelopLoop({ renderer, seed, reducedMotion, read, hurried, onRevealed, onRendererFailed }: DevelopLoopOptions): DevelopLoop {
  const state: DevelopState = { develop: 0, fog: 0, overexpose: 0, dud: 0 }
  const started = performance.now()
  let frame = 0
  let last = 0
  let running = false
  let revealed = false
  let stopped = false

  const draw = (now: number) => renderer.render({ ...state, time: reducedMotion ? 0 : (now - started) / 1000, seed })

  const step = (now: number) => {
    if (renderer.status() === 'failed') {
      running = false
      onRendererFailed()
      return
    }
    const seconds = last ? Math.min(0.05, (now - last) / 1000) : 0
    last = now
    const item = read()
    const goal = goalFor(item, state)
    const floor = reducedMotion ? 0 : hurried() ? BACKLOG_REVEAL_SECONDS : MIN_REVEAL_SECONDS
    state.develop = approachDevelop(state.develop, goal.develop, seconds, floor)
    state.fog = toward(state.fog, goal.fog, seconds)
    state.overexpose = toward(state.overexpose, goal.overexpose, seconds)
    state.dud = toward(state.dud, goal.dud, seconds)
    if (item.status === 'uploaded' && state.develop > 0.997) state.develop = 1

    draw(now)

    if (item.status === 'uploaded' && state.develop === 1 && !revealed) {
      revealed = true
      onRevealed()
    }
    if (isSettled(item, state)) {
      running = false
      return
    }
    frame = requestAnimationFrame(step)
  }

  const wake = () => {
    if (running || stopped || isSettled(read(), state)) return
    running = true
    last = 0
    frame = requestAnimationFrame(step)
  }

  // After a lost context is rebuilt, a settled print must be drawn again or it stays blank.
  renderer.onRestored(() => {
    if (stopped) return
    draw(performance.now())
    wake()
  })

  // Draw the first frame now, so a reused surface never shows the previous print.
  running = true
  step(performance.now())
  return {
    wake,
    stop: () => {
      stopped = true
      cancelAnimationFrame(frame)
      renderer.onRestored(null)
    },
  }
}
