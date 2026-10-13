import { Governor, IGNORED_INTERVAL_MS } from './governor'

export interface Frame {
  /** Seconds since the first frame. Stays 0 when the viewer prefers reduced motion. */
  time: number
  delta: number
}

export interface SceneHandle {
  render(frame: Frame): void
  /** True once the scene can draw its real picture (its shader has linked). */
  ready(): boolean
  /** CSS size of the view and the pixel ratio the canvas is drawn at. */
  resize?(width: number, height: number, pixelRatio: number): void
  /** Asked first when frames are slow. Returns true if the scene made itself cheaper. */
  degrade?(): boolean
  /** Asked last when frames have room again. Returns true if the scene made itself richer. */
  upgrade?(): boolean
  /** Rebuilds GPU resources after a lost context comes back. */
  restore?(): void
  /** The viewer's reduced-motion preference changed while the scene was running. */
  motionPreference?(reduced: boolean): void
  dispose(): void
}

/** The two members of EXT_disjoint_timer_query_webgl2 used here; TypeScript's DOM types omit it. */
interface GpuTimerExtension {
  readonly TIME_ELAPSED_EXT: GLenum
  readonly GPU_DISJOINT_EXT: GLenum
}

const MAX_PIXEL_RATIO = 2
// Below 1 the canvas draws fewer pixels than CSS pixels and the browser scales it up: the last
// lever on a 1x display or a weak phone GPU, softer but steady.
const MIN_PIXEL_RATIO = 0.5
const PIXEL_RATIO_STEP = 0.25

/**
 * Owns the canvas, the WebGL2 context, the frame loop and container resizing for one short.
 *
 * With reduced motion there is no running loop: a still frame is drawn on resize and on
 * `requestRender`, and also every frame until the scene reports ready, so the first still waits
 * for the shader instead of showing an empty backdrop.
 *
 * The scene is a full-screen raymarch, so cost scales with pixel count. The governor
 * (see governor.ts) judges each window; the scene sheds or restores its own cost on one side of
 * the pixel ratio: down it degrades first, up the pixel ratio returns first.
 */
export class Stage {
  readonly gl: WebGL2RenderingContext
  readonly canvas: HTMLCanvasElement
  private readonly container: HTMLElement
  private readonly observer: ResizeObserver
  private readonly motionQuery: MediaQueryList
  private readonly governor = new Governor()
  private timer: GpuTimerExtension | null
  private pendingQueries: WebGLQuery[] = []
  private handle: SceneHandle | null = null
  private reduced: boolean
  private frameId = 0
  private stillId = 0
  private startTime = -1
  private lastTime = -1
  private pixelRatio: number
  // The governor's ceiling: a display change never raises the ratio past what the GPU earned.
  private ratioCap = MAX_PIXEL_RATIO
  private dprQuery: MediaQueryList | null = null
  private smoothedMs = 1000 / 60
  private lost = false

  constructor(container: HTMLElement) {
    this.container = container
    this.motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    this.reduced = this.motionQuery.matches
    this.canvas = document.createElement('canvas')
    // The shader resolves its own silhouettes and writes opaque, display-encoded colour.
    const gl = this.canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      powerPreference: 'high-performance',
    })
    if (!gl) throw new Error('WebGL2 is unavailable')
    this.gl = gl
    // GPU time per frame where the browser allows it (not Safari); the governor works without it.
    this.timer = gl.getExtension('EXT_disjoint_timer_query_webgl2')
    this.pixelRatio = Math.min(window.devicePixelRatio, this.ratioCap)
    this.canvas.addEventListener('webglcontextlost', this.onLost)
    this.canvas.addEventListener('webglcontextrestored', this.onRestored)
    this.motionQuery.addEventListener('change', this.onMotionPreference)
    container.appendChild(this.canvas)
    this.observer = new ResizeObserver(() => this.resize())
    this.watchPixelRatio()
  }

  get reducedMotion(): boolean {
    return this.reduced
  }

  start(handle: SceneHandle): void {
    this.handle = handle
    this.resize()
    this.observer.observe(this.container)
    this.run()
  }

  /** Smoothed frame interval (ms) and the pixel ratio the canvas is drawn at, for the stats overlay. */
  stats(): { frameMs: number; pixelRatio: number } {
    return { frameMs: this.smoothedMs, pixelRatio: this.pixelRatio }
  }

  /** Redraws the still. Under reduced motion this is the only way a change reaches the screen. */
  requestRender(): void {
    if (!this.reduced || this.lost || !this.handle) return
    this.handle.render({ time: 0, delta: 0 })
    // Rendering can end the scene (a shader that fails to link falls back and disposes the stage),
    // so the handle is read again before asking whether it is ready.
    const handle = this.handle
    // Until the shader is ready the still is only the backdrop: keep asking each frame.
    if (handle && !handle.ready()) {
      cancelAnimationFrame(this.stillId)
      this.stillId = requestAnimationFrame(() => this.requestRender())
    }
  }

  dispose(): void {
    cancelAnimationFrame(this.frameId)
    cancelAnimationFrame(this.stillId)
    this.observer.disconnect()
    this.canvas.removeEventListener('webglcontextlost', this.onLost)
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored)
    this.motionQuery.removeEventListener('change', this.onMotionPreference)
    this.dprQuery?.removeEventListener('change', this.onPixelRatio)
    this.dropQueries()
    this.handle?.dispose()
    this.handle = null
    // Free the context now rather than at garbage collection: browsers cap live contexts, and
    // remounts (hot reload, StrictMode) would otherwise stack them up.
    this.gl.getExtension('WEBGL_lose_context')?.loseContext()
    this.canvas.remove()
  }

  /** The loop, or the still under reduced motion. */
  private run(): void {
    cancelAnimationFrame(this.frameId)
    cancelAnimationFrame(this.stillId)
    this.lastTime = -1
    if (this.reduced) this.requestRender()
    else this.frameId = requestAnimationFrame(this.frame)
  }

  /** Dragging the window to a display with another density changes devicePixelRatio. */
  private watchPixelRatio(): void {
    this.dprQuery?.removeEventListener('change', this.onPixelRatio)
    this.dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
    this.dprQuery.addEventListener('change', this.onPixelRatio)
  }

  private readonly onPixelRatio = (): void => {
    this.pixelRatio = Math.min(window.devicePixelRatio, this.ratioCap)
    this.watchPixelRatio()
    this.resize()
  }

  private readonly onMotionPreference = (): void => {
    this.reduced = this.motionQuery.matches
    this.handle?.motionPreference?.(this.reduced)
    if (!this.lost) this.run()
  }

  private readonly onLost = (event: Event): void => {
    // Without preventDefault the browser never restores the context.
    event.preventDefault()
    this.lost = true
    cancelAnimationFrame(this.frameId)
    cancelAnimationFrame(this.stillId)
    // Query objects die with the context.
    this.pendingQueries = []
  }

  private readonly onRestored = (): void => {
    this.lost = false
    // A restored context starts with no extensions enabled; ask for the timer again.
    this.timer = this.gl.getExtension('EXT_disjoint_timer_query_webgl2')
    this.handle?.restore?.()
    this.resize()
    this.run()
  }

  private readonly frame = (now: number): void => {
    this.frameId = requestAnimationFrame(this.frame)
    if (this.startTime < 0) this.startTime = now
    const deltaMs = this.lastTime < 0 ? 0 : now - this.lastTime
    this.lastTime = now
    if (deltaMs > 0 && deltaMs <= IGNORED_INTERVAL_MS) this.smoothedMs += (deltaMs - this.smoothedMs) * 0.1
    this.governor.frame(now, deltaMs)
    this.collectGpuTimes()
    this.applyVerdict(this.governor.judge(now))

    const timing = this.beginGpuTiming()
    // Clamp so a long pause resumes the choreography instead of jumping through it.
    this.handle?.render({ time: (now - this.startTime) / 1000, delta: Math.min(deltaMs, IGNORED_INTERVAL_MS) / 1000 })
    if (timing) this.gl.endQuery(timing)
  }

  private applyVerdict(verdict: 'degrade' | 'upgrade' | 'hold'): void {
    if (verdict === 'degrade') {
      // The scene sheds its own cost first; only then does the pixel ratio come down.
      if (this.handle?.degrade?.() || this.pixelRatio <= MIN_PIXEL_RATIO) return
      this.pixelRatio = Math.max(MIN_PIXEL_RATIO, this.pixelRatio - PIXEL_RATIO_STEP)
      this.ratioCap = this.pixelRatio
      this.resize()
    } else if (verdict === 'upgrade') {
      // Sharpness returns first, then the scene's richer tier.
      const target = Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO)
      if (this.pixelRatio < target) {
        this.pixelRatio = Math.min(target, this.pixelRatio + PIXEL_RATIO_STEP)
        this.ratioCap = this.pixelRatio
        this.resize()
      } else {
        this.handle?.upgrade?.()
      }
    }
  }

  /** Starts a GPU timer around this frame's draw, one query in flight per frame at most. */
  private beginGpuTiming(): number | null {
    if (!this.timer || this.pendingQueries.length > 4) return null
    const query = this.gl.createQuery()
    if (!query) return null
    this.gl.beginQuery(this.timer.TIME_ELAPSED_EXT, query)
    this.pendingQueries.push(query)
    return this.timer.TIME_ELAPSED_EXT
  }

  /** Feeds finished GPU timings to the governor. Results arrive a few frames late, in order. */
  private collectGpuTimes(): void {
    if (!this.timer) return
    const gl = this.gl
    // A disjoint event (power change, GPU reset) invalidates every timing in flight.
    const disjoint: boolean = gl.getParameter(this.timer.GPU_DISJOINT_EXT)
    while (this.pendingQueries.length) {
      const query = this.pendingQueries[0]
      const available: boolean = gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)
      if (!disjoint && !available) break
      if (!disjoint) {
        const nanoseconds: number = gl.getQueryParameter(query, gl.QUERY_RESULT)
        this.governor.gpu(nanoseconds / 1e6)
      }
      gl.deleteQuery(query)
      this.pendingQueries.shift()
    }
  }

  private dropQueries(): void {
    for (const query of this.pendingQueries) this.gl.deleteQuery(query)
    this.pendingQueries = []
  }

  private resize(): void {
    const width = this.container.clientWidth
    const height = this.container.clientHeight
    if (width === 0 || height === 0 || this.lost) return
    this.canvas.width = Math.round(width * this.pixelRatio)
    this.canvas.height = Math.round(height * this.pixelRatio)
    this.canvas.style.width = `${width}px`
    this.canvas.style.height = `${height}px`
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    this.handle?.resize?.(width, height, this.pixelRatio)
    if (this.reduced) this.requestRender()
  }
}
