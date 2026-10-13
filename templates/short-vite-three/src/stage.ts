import * as THREE from 'three'

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
  dispose(): void
}

const MAX_PIXEL_RATIO = 2

/**
 * Owns the renderer, the frame loop and container resizing for one short.
 * With reduced motion it renders a single still frame, and again on each resize.
 */
export class Stage {
  readonly renderer: THREE.WebGLRenderer
  readonly reducedMotion: boolean
  private readonly container: HTMLElement
  private readonly observer: ResizeObserver
  private handle: SceneHandle | null = null
  private startTime = -1
  private lastTime = -1

  constructor(container: HTMLElement) {
    this.container = container
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO))
    container.appendChild(this.renderer.domElement)
    this.observer = new ResizeObserver(() => this.resize())
  }

  start(handle: SceneHandle): void {
    this.handle = handle
    this.resize()
    this.observer.observe(this.container)
    if (!this.reducedMotion) this.renderer.setAnimationLoop((now) => this.frame(now))
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null)
    this.observer.disconnect()
    this.handle?.dispose()
    this.handle = null
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }

  private frame(now: number): void {
    if (this.startTime < 0) {
      this.startTime = now
      this.lastTime = now
    }
    this.render({ time: (now - this.startTime) / 1000, delta: (now - this.lastTime) / 1000 })
    this.lastTime = now
  }

  private render(frame: Frame): void {
    if (!this.handle) return
    this.handle.update?.(frame)
    this.renderer.render(this.handle.scene, this.handle.camera)
  }

  private resize(): void {
    const width = this.container.clientWidth
    const height = this.container.clientHeight
    if (width === 0 || height === 0) return
    this.renderer.setSize(width, height)
    this.handle?.resize?.(width, height)
    if (this.reducedMotion) this.render({ time: 0, delta: 0 })
  }
}
