import { createPrintRenderer, type PrintRenderer } from './renderer'

export interface PrintSurface {
  canvas: HTMLCanvasElement
  renderer: PrintRenderer
}

const BLANK_FRAME = { develop: 0, fog: 0, overexpose: 0, dud: 0, time: 0, seed: 0 }
const WARM_ATTEMPTS = 40

/**
 * One surface is kept between prints. Creating a WebGL context, compiling the develop
 * shader and drawing with it for the first time are paid once, while the page is idle,
 * instead of at the moment a file is dropped.
 */
let spare: PrintSurface | null = null
let warming = 0
/** Set once the develop shader fails to build here; every later print uses the 2D path. */
let useFallback = false

const create = (): PrintSurface => createPrintRenderer({ fallback: useFallback })

export function acquirePrintSurface(): PrintSurface {
  const surface = spare ?? create()
  spare = null
  return surface
}

export function releasePrintSurface(surface: PrintSurface): void {
  surface.canvas.remove()
  surface.renderer.setSource(null)
  surface.renderer.onRestored(null)
  if (spare) surface.renderer.dispose()
  else spare = surface
}

/** Swap a surface whose shader failed for a 2D one, and stop offering WebGL to later prints. */
export function replaceFailedSurface(surface: PrintSurface): PrintSurface {
  surface.canvas.remove()
  surface.renderer.dispose()
  useFallback = true
  spare?.renderer.dispose()
  spare = null
  return create()
}

// Safari has no requestIdleCallback; a short timeout keeps the warm-up off the critical path there.
const hasIdleCallback = typeof window.requestIdleCallback === 'function'

const whenIdle = (task: () => void): number =>
  hasIdleCallback ? window.requestIdleCallback(task, { timeout: 2000 }) : window.setTimeout(task, 200)

const cancelIdle = (handle: number) => (hasIdleCallback ? window.cancelIdleCallback(handle) : window.clearTimeout(handle))

/** Build the spare surface and draw one frame with it during idle time, so the first upload starts warm. */
export function warmPrintSurface(): () => void {
  let attempts = 0
  const step = () => {
    spare ??= create()
    // Only a render on a compiled program pays the first-draw cost, so repeat until one has.
    const before = spare.renderer.status()
    spare.renderer.render(BLANK_FRAME)
    attempts += 1
    if (before === 'failed' || spare.renderer.status() === 'failed') {
      spare = replaceFailedSurface(spare)
      return
    }
    if (before !== 'ready' && attempts < WARM_ATTEMPTS) warming = whenIdle(step)
  }
  warming = whenIdle(step)
  return () => cancelIdle(warming)
}

/** Release the spare surface's GPU context, for when the uploader leaves the page. */
export function disposeSparePrintSurface(): void {
  spare?.renderer.dispose()
  spare = null
}
