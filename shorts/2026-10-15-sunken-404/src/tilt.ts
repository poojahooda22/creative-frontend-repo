// The phone's tilt as the tank's gravity. Water keeps level with the world while the screen turns
// around it, as in a glass held in the hand: tilt the phone and the water runs to the low side.
// Shaking the phone splashes it.
//
// The direction comes from deviceorientation's beta and gamma, which iOS and Android report the
// same way (devicemotion's raw accelerations have differed in sign between them). With the W3C
// Z-X'-Y'' angles, the world's down vector in the device's frame is
//   d = (cos(beta) sin(gamma), -sin(beta), -cos(beta) cos(gamma)),
// whatever alpha (the compass heading) is. Its x and y lie in the screen plane; the screen's own
// rotation (landscape, upside down) turns them into the page's axes. Both events need a secure
// context, and iOS asks the visitor first.
import type { Vec2 } from './life/tank'

/** The tilt reported is at most this far from straight down the page (rad); the tank may allow less. */
const MAX_TILT = 0.6
/**
 * The share of gravity in the screen plane: below FLAT_BELOW the phone lies nearly flat and its
 * tilt has no direction worth trusting; above TILTED_ABOVE it counts in full; between them it fades
 * in, so lifting the phone off a table does not snap the water sideways.
 */
const FLAT_BELOW = 0.2
const TILTED_ABOVE = 0.45
/** The tilt follows the sensor with this time constant (s): sensor noise is not tilt. */
const EASE_SECONDS = 0.12
/**
 * Device acceleration (m/s^2) taken off every reading: a hand tilting the phone or holding it moves
 * it this much without meaning to splash.
 */
const SHAKE_FLOOR = 2

/** Safari's permission hook for motion sensors (iOS 13+), which TypeScript's DOM types do not carry. */
function permissionHook(api: object | undefined): (() => Promise<unknown>) | null {
  if (!api || !('requestPermission' in api)) return null
  const hook = api.requestPermission
  return typeof hook === 'function' ? () => Promise.resolve(hook.call(api)) : null
}

function sensorApi(name: 'DeviceOrientationEvent' | 'DeviceMotionEvent'): object | undefined {
  const api: unknown = Reflect.get(globalThis, name)
  return typeof api === 'function' ? api : undefined
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/** Device x, y (screen plane, y toward the top of the device) to the page's x right, y up. */
function rotateToPage(x: number, y: number, out: Vec2): void {
  const angle = ((screen.orientation?.angle ?? 0) * Math.PI) / 180
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  out.x = x * c - y * s
  out.y = x * s + y * c
}

export class TiltInput {
  /** Gravity's angle from straight down the page (rad), positive toward the right; 0 at rest. */
  angle = 0
  /** True once the phone has reported its orientation. */
  active = false
  private target = 0
  private readonly shake = { x: 0, y: 0, readings: 0 }
  private readonly tmp: Vec2 = { x: 0, y: 0 }
  private listening = false
  private readonly onActive: () => void

  /** `onActive` runs once, when the first orientation arrives. */
  constructor(onActive: () => void) {
    this.onActive = onActive
  }

  /** True where the browser can report tilt at all: motion sensors need a secure context. */
  static supported(): boolean {
    return window.isSecureContext && sensorApi('DeviceOrientationEvent') !== undefined
  }

  /** iOS asks the visitor first, from a tap; elsewhere the events simply arrive. */
  static needsPermission(): boolean {
    return permissionHook(sensorApi('DeviceOrientationEvent')) !== null
  }

  /** Call from a tap. Resolves true once the sensors may be read; rejects if the browser refused to ask. */
  async requestPermission(): Promise<boolean> {
    const orientation = permissionHook(sensorApi('DeviceOrientationEvent'))
    const motion = permissionHook(sensorApi('DeviceMotionEvent'))
    // Both asks start inside the tap; Safari shows one prompt for the two.
    const [o] = await Promise.all([orientation ? orientation() : 'granted', motion ? motion() : 'granted'])
    const granted = o === 'granted'
    if (granted) this.start()
    return granted
  }

  start(): void {
    if (this.listening) return
    this.listening = true
    window.addEventListener('deviceorientation', this.onOrientation)
    window.addEventListener('devicemotion', this.onMotion)
  }

  /** Once a frame: eases the tilt toward the sensor's, and hands over the mean shake since the last frame (m/s^2, page axes). */
  update(dt: number, shakeOut: Vec2): void {
    this.angle += (this.target - this.angle) * (1 - Math.exp(-dt / EASE_SECONDS))
    const s = this.shake
    shakeOut.x = s.readings > 0 ? s.x / s.readings : 0
    shakeOut.y = s.readings > 0 ? s.y / s.readings : 0
    s.x = 0
    s.y = 0
    s.readings = 0
  }

  dispose(): void {
    window.removeEventListener('deviceorientation', this.onOrientation)
    window.removeEventListener('devicemotion', this.onMotion)
    this.listening = false
  }

  private readonly onOrientation = (event: DeviceOrientationEvent): void => {
    // Desktop browsers without the sensor send one event with no angles.
    if (event.beta === null || event.gamma === null) return
    if (!this.active) {
      this.active = true
      this.onActive()
    }
    const beta = (event.beta * Math.PI) / 180
    const gamma = (event.gamma * Math.PI) / 180
    rotateToPage(Math.cos(beta) * Math.sin(gamma), -Math.sin(beta), this.tmp)
    const inPlane = Math.hypot(this.tmp.x, this.tmp.y)
    const angle = Math.atan2(this.tmp.x, -this.tmp.y)
    this.target = Math.max(-MAX_TILT, Math.min(MAX_TILT, angle)) * smoothstep(FLAT_BELOW, TILTED_ABOVE, inPlane)
  }

  private readonly onMotion = (event: DeviceMotionEvent): void => {
    const a = event.acceleration
    if (!a || a.x === null || a.y === null) return
    rotateToPage(a.x, a.y, this.tmp)
    const s = this.shake
    s.readings++
    const length = Math.hypot(this.tmp.x, this.tmp.y)
    if (length <= SHAKE_FLOOR) return
    const k = 1 - SHAKE_FLOOR / length
    s.x += this.tmp.x * k
    s.y += this.tmp.y * k
  }
}
