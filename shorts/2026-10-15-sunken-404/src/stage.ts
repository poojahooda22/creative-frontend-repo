import * as THREE from 'three'
import { Governor, IGNORED_INTERVAL_MS, type Verdict } from './governor'

export interface Frame {
  /** Seconds since the first frame. Stays 0 when the viewer prefers reduced motion. */
  time: number
  delta: number
}

export interface SceneHandle {
  scene: THREE.Scene
  camera: THREE.Camera
  update?(frame: Frame): void
  resize?(width: number, height: number): void
  /** Sheds some of the scene's own cost; false when it has nothing left to shed. */
  degrade?(): boolean
  /** Restores some of it; false when it is already at full quality. */
  upgrade?(): boolean
  dispose(): void
}

/** The two members of EXT_disjoint_timer_query_webgl2 used here; TypeScript's DOM types omit it. */
interface GpuTimerExtension {
  readonly TIME_ELAPSED_EXT: GLenum
  readonly GPU_DISJOINT_EXT: GLenum
}

const MAX_PIXEL_RATIO = 2
/** The lowest the governor takes the pixel ratio: the tank's type and outlines soften below 1. */
const MIN_PIXEL_RATIO = 1
const PIXEL_RATIO_STEP = 0.25
/** GPU timings in flight at most; results arrive a few frames late. */
const MAX_QUERIES = 4

/**
 * Owns the renderer, the frame loop and container resizing for one short.
 * With reduced motion it renders a single still frame, again on each resize and on request.
 *
 * The governor (governor.ts) judges each window of frames, by GPU time where the browser can
 * measure it and by frame interval otherwise. Down, the scene sheds its own cost first and the
 * pixel ratio comes down after; up, the pixel ratio returns first.
 */
export class Stage {
  readonly renderer: THREE.WebGLRenderer
  readonly reducedMotion: boolean
  /** Smoothed interval between frames, milliseconds. */
  frameMs = 16.7
  /** Smoothed GPU time per frame, milliseconds; NaN where the browser has no timer queries. */
  gpuMs = Number.NaN
  private readonly container: HTMLElement
  private readonly observer: ResizeObserver
  private readonly gl: WebGL2RenderingContext
  private readonly governor = new Governor()
  private timer: GpuTimerExtension | null
  private queries: WebGLQuery[] = []
  private pixelRatio: number
  private handle: SceneHandle | null = null
  private startTime = -1
  private lastTime = -1

  constructor(container: HTMLElement) {
    this.container = container
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    // The screen only receives a full-screen composite; the 3D pass multisamples on its own target.
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' })
    // Shader diagnostics in development only: in production they cost a synchronous query per
    // program, and Direct3D's compiler logs harmless precision notes on three's own shaders.
    this.renderer.debug.checkShaderErrors = import.meta.env.DEV
    const gl = this.renderer.getContext()
    // three r183 renders with WebGL2 only; its typings still allow WebGL1.
    if (!(gl instanceof WebGL2RenderingContext)) throw new Error('Stage: WebGL2 is required')
    this.gl = gl
    this.timer = this.gl.getExtension('EXT_disjoint_timer_query_webgl2')
    this.pixelRatio = Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO)
    this.renderer.setPixelRatio(this.pixelRatio)
    container.appendChild(this.renderer.domElement)
    this.canvas.addEventListener('webglcontextlost', this.onLost)
    this.canvas.addEventListener('webglcontextrestored', this.onRestored)
    this.observer = new ResizeObserver(() => this.resize())
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement
  }

  start(handle: SceneHandle): void {
    this.handle = handle
    this.resize()
    this.observer.observe(this.container)
    if (!this.reducedMotion) this.renderer.setAnimationLoop((now) => this.frame(now))
  }

  /** Draws one still frame now (reduced motion has no loop to pick changes up). */
  requestRender(): void {
    this.render({ time: 0, delta: 0 })
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null)
    this.observer.disconnect()
    this.canvas.removeEventListener('webglcontextlost', this.onLost)
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored)
    this.dropQueries()
    this.handle?.dispose()
    this.handle = null
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }

  private readonly onLost = (): void => {
    // Queries belong to the lost context: forget them without deleting.
    this.queries = []
  }

  private readonly onRestored = (): void => {
    // A restored context starts with no extensions enabled; ask for the timer again.
    this.timer = this.gl.getExtension('EXT_disjoint_timer_query_webgl2')
  }

  private frame(now: number): void {
    if (this.startTime < 0) {
      this.startTime = now
      this.lastTime = now
    }
    const interval = now - this.lastTime
    if (interval > 0 && interval < IGNORED_INTERVAL_MS) this.frameMs += (interval - this.frameMs) * 0.05
    this.governor.frame(now, interval)
    this.collectGpuTimes()
    this.apply(this.governor.judge(now))
    const query = this.beginGpuTiming()
    this.render({ time: (now - this.startTime) / 1000, delta: interval / 1000 })
    if (query && this.timer) this.gl.endQuery(this.timer.TIME_ELAPSED_EXT)
    this.lastTime = now
  }

  private render(frame: Frame): void {
    if (!this.handle) return
    this.handle.update?.(frame)
    this.renderer.setRenderTarget(null)
    this.renderer.render(this.handle.scene, this.handle.camera)
  }

  private apply(verdict: Verdict): void {
    if (verdict === 'degrade') {
      if (this.handle?.degrade?.() || this.pixelRatio <= MIN_PIXEL_RATIO) return
      this.pixelRatio = Math.max(MIN_PIXEL_RATIO, this.pixelRatio - PIXEL_RATIO_STEP)
      this.resize()
    } else if (verdict === 'upgrade') {
      const full = Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO)
      if (this.pixelRatio < full) {
        this.pixelRatio = Math.min(full, this.pixelRatio + PIXEL_RATIO_STEP)
        this.resize()
      } else {
        this.handle?.upgrade?.()
      }
    }
  }

  /** Starts a GPU timer around this frame's passes, a few in flight at most. */
  private beginGpuTiming(): WebGLQuery | null {
    if (!this.timer || this.queries.length >= MAX_QUERIES) return null
    const query = this.gl.createQuery()
    if (!query) return null
    this.gl.beginQuery(this.timer.TIME_ELAPSED_EXT, query)
    this.queries.push(query)
    return query
  }

  /** Feeds finished GPU timings to the governor; they finish in order. */
  private collectGpuTimes(): void {
    if (!this.timer) return
    const gl = this.gl
    // A disjoint event (power change, GPU reset) invalidates every timing in flight.
    const disjoint: boolean = gl.getParameter(this.timer.GPU_DISJOINT_EXT)
    while (this.queries.length) {
      const query = this.queries[0]
      const available: boolean = gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)
      if (!disjoint && !available) break
      if (!disjoint) {
        const nanoseconds: number = gl.getQueryParameter(query, gl.QUERY_RESULT)
        const ms = nanoseconds / 1e6
        this.governor.gpu(ms)
        this.gpuMs = Number.isNaN(this.gpuMs) ? ms : this.gpuMs + (ms - this.gpuMs) * 0.1
      }
      gl.deleteQuery(query)
      this.queries.shift()
    }
  }

  private dropQueries(): void {
    for (const query of this.queries) this.gl.deleteQuery(query)
    this.queries = []
  }

  private resize(): void {
    const width = this.container.clientWidth
    const height = this.container.clientHeight
    if (width === 0 || height === 0) return
    this.renderer.setPixelRatio(this.pixelRatio)
    this.renderer.setSize(width, height)
    this.handle?.resize?.(width, height)
    if (this.reducedMotion) this.render({ time: 0, delta: 0 })
  }
}
