// Messages between the page and the physics worker.
import type { GlyphShape, Mask } from './glyph'
import type { Layout } from './world'

/** The coarse water-velocity grid the worker samples for the plants and fish. */
export const FLOW_COLUMNS = 48
export const FLOW_ROWS = 14

export interface InitMessage {
  type: 'init'
  cssWidth: number
  cssHeight: number
  chars: string[]
  masks: Array<[string, Mask]>
  /** Seconds to run before the first frame, so the water starts settled. */
  settle: number
  /** The most particles to simulate (see PARTICLE_BUDGET); the worker may use fewer. */
  budget: number
}

export interface FrameMessage {
  type: 'frame'
  delta: number
  pointer: { x: number; y: number; vx: number; vy: number; active: boolean }
  shake: { ax: number; ay: number }
  /** Gravity's angle from straight down the view (rad), positive toward +x: the phone's tilt. */
  tilt: number
  /** Buffers from an earlier state, handed back for reuse. */
  recycle: ArrayBuffer[]
}

export interface PressMessage {
  type: 'press'
  /** Counts presses, so the page can tell which one a state answers. */
  id: number
  x: number
  y: number
}

export interface ReleaseMessage {
  type: 'release'
}

export type ToWorker = InitMessage | FrameMessage | PressMessage | ReleaseMessage

export interface ReadyMessage {
  type: 'ready'
  layout: Layout
  /** Each digit's character, in order, and the shapes they use. */
  chars: string[]
  shapes: Array<[string, GlyphShape]>
  gridColumns: number
  /** The solver's cell size and particle radius (sim units): the surface columns are this far apart. */
  cell: number
  particleRadius: number
  maxParticles: number
  /** The particle budget this tank was built for; lower than asked when the first steps ran slow. */
  budget: number
}

export interface StateMessage {
  type: 'state'
  count: number
  /** Particle positions (x, y pairs) now and before the last step. */
  pos: Float32Array<ArrayBuffer>
  prev: Float32Array<ArrayBuffer>
  /** How far the drawn moment sits between `prev` and `pos`. */
  alpha: number
  /** x, y, angle per digit, now and before the last step. */
  digits: Float32Array<ArrayBuffer>
  digitsPrev: Float32Array<ArrayBuffer>
  /** The drawn surface per grid column, in SURFACE_ROWS rows (see World.displaySurface). */
  surface: Float32Array<ArrayBuffer>
  /** Water velocity on a FLOW_COLUMNS x FLOW_ROWS grid over the tank (x, y pairs, row-major from the floor). */
  flow: Float32Array<ArrayBuffer>
  holding: boolean
  /** The last press the worker handled; with holding false, that press missed every digit. */
  pressed: number
  /** Gravity's angle from straight down (rad), as the tank holds the phone's tilt. */
  tilt: number
  calm: number
  agitation: number
  /** Physics cost of this frame, milliseconds. */
  stepMs: number
  steps: number
}

export type FromWorker = ReadyMessage | StateMessage
