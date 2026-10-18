// The visitor's hand on the tank: the pointer in sim units with a smoothed velocity, a grab on a
// digit, and the window's own acceleration when it is shaken. The physics and the creatures read
// the same hand.
import type { Hand, Vec2 } from './life/tank'

/** Window acceleration below this (CSS px / s^2) is hand tremor or rounding, not a shake. */
const SHAKE_FLOOR = 400
/** The pointer's velocity follows its motion with this rate (1/s), and fades this fast once still. */
const FOLLOW_RATE = 30
const STILL_RATE = 10
/** A pointer that has not moved for this long (ms) is still. */
const STILL_AFTER = 60

export interface HandOptions {
  canvas: HTMLCanvasElement
  /** CSS client position to sim units; false while the tank has no layout. */
  toSim(clientX: number, clientY: number, out: Vec2): boolean
  /** True if a digit lies under this sim-space point. */
  digitUnder(x: number, y: number): boolean
  /** A digit was pressed at this point, and later let go. */
  grab(x: number, y: number): void
  letGo(): void
}

export class HandInput {
  /** Where the hand is and how it moves (sim units); active while it stirs, not while it holds. */
  readonly hand: Hand = { x: 0, y: 0, vx: 0, vy: 0, active: false }
  private inside = false
  private held = false
  private lastMove = 0
  private pointerId = -1
  private readonly at: Vec2 = { x: 0, y: 0 }
  private readonly frame = { x: 0, y: 0, vx: 0, vy: 0, primed: false }
  private readonly o: HandOptions

  constructor(o: HandOptions) {
    this.o = o
    const c = o.canvas
    c.style.touchAction = 'none'
    c.addEventListener('pointermove', this.onMove)
    c.addEventListener('pointerdown', this.onDown)
    c.addEventListener('pointerup', this.onUp)
    c.addEventListener('pointercancel', this.onUp)
    c.addEventListener('pointerleave', this.onLeave)
  }

  get holding(): boolean {
    return this.held
  }

  /**
   * The physics found no digit where the page thought one was (the digit moved between the frame
   * that was drawn and the step that took the press): let go, so stirring works again.
   */
  cancelHold(): void {
    if (!this.held) return
    this.held = false
    this.hand.active = this.inside
    const c = this.o.canvas
    if (this.pointerId >= 0 && c.hasPointerCapture(this.pointerId)) c.releasePointerCapture(this.pointerId)
    c.style.cursor = ''
  }

  /** Once a frame: a pointer that has stopped lets its velocity fade. */
  settle(dt: number): void {
    if (performance.now() - this.lastMove > STILL_AFTER) {
      const k = Math.exp(-dt * STILL_RATE)
      this.hand.vx *= k
      this.hand.vy *= k
    }
  }

  /**
   * The window's acceleration over the last frame, in sim units / s^2 (unitsPerPx converts CSS
   * px), or zero when it was not shaken. Screen y points down, sim y up.
   */
  windowShake(dt: number, unitsPerPx: number): Vec2 {
    const w = this.frame
    const x = window.screenX
    const y = window.screenY
    if (!w.primed || dt <= 0) {
      w.x = x
      w.y = y
      w.primed = true
      return { x: 0, y: 0 }
    }
    const vx = (x - w.x) / dt
    const vy = (y - w.y) / dt
    const ax = (vx - w.vx) / dt
    const ay = (vy - w.vy) / dt
    w.x = x
    w.y = y
    w.vx = vx
    w.vy = vy
    if (Math.hypot(ax, ay) < SHAKE_FLOOR) return { x: 0, y: 0 }
    return { x: ax * unitsPerPx, y: -ay * unitsPerPx }
  }

  dispose(): void {
    const c = this.o.canvas
    c.removeEventListener('pointermove', this.onMove)
    c.removeEventListener('pointerdown', this.onDown)
    c.removeEventListener('pointerup', this.onUp)
    c.removeEventListener('pointercancel', this.onUp)
    c.removeEventListener('pointerleave', this.onLeave)
  }

  private readonly onMove = (event: PointerEvent): void => {
    if (!this.o.toSim(event.clientX, event.clientY, this.at)) return
    const h = this.hand
    const now = performance.now()
    const dt = (now - this.lastMove) / 1000
    if (this.inside && dt > 0 && dt < 0.1) {
      const k = Math.min(1, dt * FOLLOW_RATE)
      h.vx += ((this.at.x - h.x) / dt - h.vx) * k
      h.vy += ((this.at.y - h.y) / dt - h.vy) * k
    }
    h.x = this.at.x
    h.y = this.at.y
    this.lastMove = now
    this.inside = true
    h.active = !this.held
    if (!this.held) this.o.canvas.style.cursor = this.o.digitUnder(h.x, h.y) ? 'grab' : ''
  }

  private readonly onDown = (event: PointerEvent): void => {
    this.onMove(event)
    if (!this.inside || !this.o.digitUnder(this.hand.x, this.hand.y)) return
    this.held = true
    this.hand.active = false
    this.pointerId = event.pointerId
    this.o.canvas.setPointerCapture(event.pointerId)
    this.o.canvas.style.cursor = 'grabbing'
    this.o.grab(this.hand.x, this.hand.y)
  }

  private readonly onUp = (event: PointerEvent): void => {
    if (!this.held) return
    this.held = false
    this.hand.active = this.inside
    this.o.letGo()
    const c = this.o.canvas
    if (c.hasPointerCapture(event.pointerId)) c.releasePointerCapture(event.pointerId)
    c.style.cursor = this.o.digitUnder(this.hand.x, this.hand.y) ? 'grab' : ''
  }

  private readonly onLeave = (): void => {
    if (this.held) return
    this.inside = false
    this.hand.active = false
  }
}
