import type { Frame, SceneHandle, Stage } from './stage'
import vertexShader from './shaders/quad.vert'
import fragmentShader from './shaders/glass.frag'
import { applyUniforms, createCoverageTexture, finishProgram, isReady, startProgram, type Program, type Uniforms } from './gl'
import { buildLabelAtlas, PILL, type AtlasCell, type LabelAtlas } from './glass/labels'
import {
  createCycleState,
  CYCLE_SECONDS,
  MAX_DROPS,
  PILL_ENDS,
  REST_ELEVATION,
  REST_FROM,
  sampleCycle,
  SPLIT_START,
  STILL_TIME,
  WAKE_FROM,
  type Body,
  type CycleState,
  type Lobe,
} from './glass/cycle'
import { clamp01, mix, smoothstep } from './glass/motion'

const FOV_Y = 30 * (Math.PI / 180)
const TAN_HALF_FOV = Math.tan(FOV_Y / 2)
const IOR = 1.38
const DISPERSION = 0.035
const FAST_FORWARD = 7
// Fraction of the half view width the resting pill fills, landscape and portrait.
const FILL_LANDSCAPE = 0.7
const FILL_PORTRAIT = 0.86
// The resting backdrop (#d6deed), shown while the shader compiles.
const BACKDROP = [0.839, 0.871, 0.929] as const

export interface GlassOptions {
  labels: readonly string[]
  /** Inspection: hold the cycle at this time (seconds) instead of playing. */
  freezeAt?: number
  /** Inspection: start on this label. */
  labelIndex?: number
  onLabelChange?(label: string): void
  /** Screen rectangle (CSS px, relative to the container) of the resting pill, for the hit target. */
  onLayout?(rect: { x: number; y: number; width: number; height: number }): void
  /** The shader failed to build: the caller should fall back. */
  onFatal?(error: Error): void
}

export interface GlassInteraction {
  pointerMove(x: number, y: number): void
  pointerLeave(): void
  press(x: number, y: number): void
  release(): void
  /** Click or keyboard activation. */
  activate(): void
  /** While the button has focus the label never changes, so its accessible name stays put. */
  setFocused(focused: boolean): void
  /** The visible pause control: the choreography stops where it is. */
  setPaused(paused: boolean): void
}

export type GlassScene = SceneHandle & {
  interaction: GlassInteraction
  /** Which shading tier is running: full, or lite after the stage asked it to degrade. */
  quality(): 'full' | 'lite'
}

interface Spring {
  value: number
  velocity: number
}

interface Vec3 {
  x: number
  y: number
  z: number
}

function stepSpring(s: Spring, target: number, stiffness: number, damping: number, dt: number): void {
  // Semi-implicit Euler in fixed substeps: stable for any frame delta the stage hands us.
  const steps = Math.max(1, Math.ceil(dt / (1 / 240)))
  const h = dt / steps
  for (let i = 0; i < steps; i++) {
    s.velocity += (stiffness * (target - s.value) - damping * s.velocity) * h
    s.value += s.velocity * h
  }
}

function approach(current: number, target: number, rate: number, dt: number): number {
  return target + (current - target) * Math.exp(-rate * dt)
}

// Typed writes without temporary arrays: these run every frame.
function put2(a: Float32Array, i: number, x: number, y: number): void {
  a[i] = x
  a[i + 1] = y
}

function put3(a: Float32Array, i: number, x: number, y: number, z: number): void {
  a[i] = x
  a[i + 1] = y
  a[i + 2] = z
}

function put4(a: Float32Array, i: number, x: number, y: number, z: number, w: number): void {
  a[i] = x
  a[i + 1] = y
  a[i + 2] = z
  a[i + 3] = w
}

function normalize(v: Vec3): Vec3 {
  const n = Math.hypot(v.x, v.y, v.z) || 1
  v.x /= n
  v.y /= n
  v.z /= n
  return v
}

export function createScene(stage: Stage, options: GlassOptions): GlassScene {
  const gl = stage.gl
  const atlas: LabelAtlas = buildLabelAtlas(options.labels)
  const labelCount = atlas.labels.length

  const f = (n: number, fill = 0) => new Float32Array(n).fill(fill)
  const u = {
    uResolution: f(2, 1),
    uTime: f(1),
    uCamPos: f(3),
    uCamBasis: f(9),
    uTanHalfFov: f(1, TAN_HALF_FOV),
    uLobe: f(16),
    uLobeScale: f(12, 1),
    uBody: f(8),
    uJoin: f(4, 1),
    uWave: f(4),
    uBulge: f(4),
    uTilt: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]),
    uDrop: f(4 * MAX_DROPS),
    uDropTail: f(3 * MAX_DROPS),
    uDropCount: f(1),
    uCrown: f(4),
    uCrownAxis: new Float32Array([1, 0, 0]),
    uCrownShape: f(4),
    uOrb: f(4),
    uBoundsMin: f(3),
    uBoundsMax: f(3),
    uAtlas: f(1, 0),
    uTextRect: f(16),
    uTextPlace: f(16),
    uTextSize: f(8),
    uDivider: f(8),
    uTextNormal: new Float32Array([0, 0, 1]),
    uTextUp: new Float32Array([0, 1, 0]),
    uTexelWorld: f(1, atlas.texelWorld),
    uTextBlur: f(1),
    uFloorY: f(1, -0.56),
    uWarmth: f(1),
    uExposure: f(1, 1.04),
    uQuality: f(1, 1),
  } satisfies Uniforms

  // ---- GPU resources (rebuilt after a lost context) ----
  const header = `#version 300 es\n#define MAX_DROPS ${MAX_DROPS}\n#define IOR ${IOR.toFixed(4)}\n#define DISPERSION ${DISPERSION.toFixed(4)}\n#define PILL_ENDS ${PILL_ENDS.toFixed(4)}\n`
  const vertexSource = `#version 300 es\n${vertexShader}`
  const fragmentSource = header + fragmentShader
  let parallel: KHR_parallel_shader_compile | null = null
  let pending: WebGLProgram | null = null
  let program: Program | null = null
  let texture: WebGLTexture | null = null
  let vao: WebGLVertexArrayObject | null = null
  let failed = false

  function build(): void {
    parallel = gl.getExtension('KHR_parallel_shader_compile')
    pending = startProgram(gl, vertexSource, fragmentSource)
    program = null
    texture = createCoverageTexture(gl, atlas.coverage, atlas.width, atlas.height)
    vao = gl.createVertexArray()
  }
  build()

  /** True once the program has linked; reports a failed link once and stops trying. */
  function ensureProgram(): boolean {
    if (program) return true
    if (failed || !pending || !isReady(gl, pending, parallel)) return false
    try {
      program = finishProgram(gl, pending)
    } catch (error: unknown) {
      failed = true
      gl.deleteProgram(pending)
      pending = null
      const reason = error instanceof Error ? error : new Error(String(error))
      console.error('Liquid glass:', reason.message)
      options.onFatal?.(reason)
      return false
    }
    pending = null
    // User Timing mark: how long the first frame waited on the shader (visible in DevTools).
    performance.mark('liquid-glass:ready')
    return true
  }

  // ---- Clock and label sequence ----
  const freezeAt = options.freezeAt
  const frozen = freezeAt !== undefined
  let cycleT = freezeAt ?? (stage.reducedMotion ? STILL_TIME : 0)
  let labelIndex = (((options.labelIndex ?? 0) % labelCount) + labelCount) % labelCount
  let fastForwardTo = -1
  const state: CycleState = createCycleState()

  // ---- Interaction state ----
  const pointer = { x: 0, y: 0, inside: false, active: false }
  let hover = 0
  const smoothPointer = { x: 0, y: 0 }
  const tilt = { x: 0, y: 0 }
  const press: Spring = { value: 0, velocity: 0 }
  let pressed = false
  const pressPoint = { x: 0, y: 0 }
  let focused = false
  let paused = false

  // ---- Layout ----
  let viewWidth = 1
  let viewHeight = 1
  let fitHalfWidth = atlas.labels[labelIndex].halfLength + PILL.radius
  const camPos: Vec3 = { x: 0, y: 0, z: 1 }
  const forward: Vec3 = { x: 0, y: 0, z: -1 }
  const right: Vec3 = { x: 1, y: 0, z: 0 }
  const up: Vec3 = { x: 0, y: 1, z: 0 }

  function fill(aspect: number): number {
    return mix(FILL_PORTRAIT, FILL_LANDSCAPE, smoothstep(0.75, 1.25, aspect))
  }

  function cameraDistance(halfWidth: number): number {
    const aspect = viewWidth / viewHeight
    const byWidth = halfWidth / (fill(aspect) * TAN_HALF_FOV * aspect)
    // Keep the split drops (about 0.7 in radius) inside three quarters of a short view.
    const byHeight = 0.72 / (0.72 * TAN_HALF_FOV)
    return Math.max(byWidth, byHeight)
  }

  function placeCamera(elevation: number, distance: number): void {
    const s = Math.sin(elevation)
    const c = Math.cos(elevation)
    camPos.x = 0
    camPos.y = s * distance
    camPos.z = c * distance
    // Looking at the origin; right stays horizontal.
    forward.x = 0
    forward.y = -s
    forward.z = -c
    right.x = 1
    right.y = 0
    right.z = 0
    up.x = 0
    up.y = c
    up.z = -s
    put3(u.uCamPos, 0, camPos.x, camPos.y, camPos.z)
    // Columns: right, up, forward.
    put3(u.uCamBasis, 0, right.x, right.y, right.z)
    put3(u.uCamBasis, 3, up.x, up.y, up.z)
    put3(u.uCamBasis, 6, forward.x, forward.y, forward.z)
    put3(u.uTextNormal, 0, 0, s, c)
    put3(u.uTextUp, 0, 0, c, -s)
  }

  /** Projects a world point to CSS pixels in the container. */
  function project(x: number, y: number, z: number): { x: number; y: number } {
    const dx = x - camPos.x
    const dy = y - camPos.y
    const dz = z - camPos.z
    const cz = dx * forward.x + dy * forward.y + dz * forward.z
    const cx = dx * right.x + dy * right.y + dz * right.z
    const cy = dx * up.x + dy * up.y + dz * up.z
    const aspect = viewWidth / viewHeight
    const nx = cx / (cz * TAN_HALF_FOV * aspect)
    const ny = cy / (cz * TAN_HALF_FOV)
    return { x: (nx * 0.5 + 0.5) * viewWidth, y: (0.5 - ny * 0.5) * viewHeight }
  }

  /** Where the pointer's ray meets the body's mid plane (z = 0). */
  function pointerOnPlane(px: number, py: number): { x: number; y: number } {
    const aspect = viewWidth / viewHeight
    const nx = (px / viewWidth) * 2 - 1
    const ny = 1 - (py / viewHeight) * 2
    const ray = normalize({
      x: forward.x + right.x * nx * TAN_HALF_FOV * aspect + up.x * ny * TAN_HALF_FOV,
      y: forward.y + right.y * nx * TAN_HALF_FOV * aspect + up.y * ny * TAN_HALF_FOV,
      z: forward.z + right.z * nx * TAN_HALF_FOV * aspect + up.z * ny * TAN_HALF_FOV,
    })
    const t = Math.abs(ray.z) > 1e-5 ? -camPos.z / ray.z : 0
    return { x: camPos.x + ray.x * t, y: camPos.y + ray.y * t }
  }

  function reportLayout(): void {
    if (!options.onLayout) return
    // The current label's rest pill at rest elevation: project its outline to place the DOM hit
    // target. The next frame places the animated camera again.
    const L = atlas.labels[labelIndex].halfLength
    const R = PILL.radius
    placeCamera(REST_ELEVATION * (Math.PI / 180), cameraDistance(L + R))
    // The silhouette: the crest on the mid plane, the lowest edge on the front of the lozenge.
    const front = R * 0.78
    const corners = [project(-L - R, R, 0), project(L + R, R, 0), project(-L - R, -R, front), project(L + R, -R, front)]
    const xs = corners.map((c) => c.x)
    const ys = corners.map((c) => c.y)
    const x0 = Math.min(...xs)
    const y0 = Math.min(...ys)
    options.onLayout({ x: x0, y: y0, width: Math.max(...xs) - x0, height: Math.max(...ys) - y0 })
  }

  // ---- Per-frame uniform packing ----

  function packLobe(slot: number, lobe: Lobe, dy: number, extraStretch: number): void {
    const s = 1 + lobe.stretch + extraStretch
    const across = 1 / Math.sqrt(Math.max(s, 0.2))
    put4(u.uLobe, slot * 4, lobe.x, lobe.y + dy, lobe.z, lobe.r)
    put3(u.uLobeScale, slot * 3, s, across, across)
  }

  function packCell(slot: number, cell: AtlasCell, bd: Body, x: number, y: number, z: number, alpha: number): void {
    put4(u.uTextRect, slot * 4, cell.u, cell.v, cell.du, cell.dv)
    put4(u.uTextPlace, slot * 4, x, y, z, alpha)
    put2(u.uTextSize, slot * 2, cell.width * bd.textScaleX, cell.height * bd.textScaleY)
  }

  function packBody(index: number, bd: Body, dy: number, squash: number): void {
    put4(u.uBody, index * 4, bd.waist, bd.k, bd.enabled ? 1 : 0, bd.depth)
    put2(u.uJoin, index * 2, bd.connect, bd.pill)
    if (!bd.enabled || !bd.label) {
      u.uTextPlace[index * 8 + 3] = 0
      u.uTextPlace[index * 8 + 7] = 0
      u.uDivider[index * 4 + 3] = 0
      return
    }
    packLobe(index * 2, bd.a, dy, squash)
    packLobe(index * 2 + 1, bd.b, dy, squash)
    packCell(index * 2, bd.label.word, bd, bd.word.x, bd.word.y + dy, bd.word.z, bd.word.alpha)
    packCell(index * 2 + 1, atlas.arrow, bd, bd.arrow.x, bd.arrow.y + dy, bd.arrow.z, bd.arrow.alpha)
    put4(u.uDivider, index * 4, bd.divider.x, bd.divider.y + dy, bd.divider.z, bd.divider.alpha)
  }

  const lo = { x: 0, y: 0, z: 0 }
  const hi = { x: 0, y: 0, z: 0 }
  function grow(x: number, y: number, z: number, r: number): void {
    lo.x = Math.min(lo.x, x - r)
    lo.y = Math.min(lo.y, y - r)
    lo.z = Math.min(lo.z, z - r)
    hi.x = Math.max(hi.x, x + r)
    hi.y = Math.max(hi.y, y + r)
    hi.z = Math.max(hi.z, z + r)
  }

  /** A box around everything the SDF can reach, so rays that miss it skip the march entirely. */
  function packBounds(tiltAngle: number): void {
    lo.x = lo.y = lo.z = Infinity
    hi.x = hi.y = hi.z = -Infinity
    for (let i = 0; i < 4; i++) {
      if (u.uBody[(i >> 1) * 4 + 2] < 0.5) continue
      // A resting join's ends stand proud of the lobe by PILL_ENDS.
      const join = 1 + (PILL_ENDS - 1) * u.uJoin[(i >> 1) * 2 + 1]
      const r = u.uLobe[i * 4 + 3] * Math.max(u.uLobeScale[i * 3], u.uLobeScale[i * 3 + 1], u.uLobeScale[i * 3 + 2], join)
      grow(u.uLobe[i * 4], u.uLobe[i * 4 + 1], u.uLobe[i * 4 + 2], r)
    }
    for (let i = 0; i < state.dropCount; i++) {
      const x = u.uDrop[i * 4]
      const y = u.uDrop[i * 4 + 1]
      const z = u.uDrop[i * 4 + 2]
      const r = u.uDrop[i * 4 + 3]
      grow(x, y, z, r)
      grow(x + u.uDropTail[i * 3], y + u.uDropTail[i * 3 + 1], z + u.uDropTail[i * 3 + 2], r)
    }
    if (u.uCrownShape[0] > 0.003 || u.uCrownShape[1] > 0.002) {
      // The ring radius plus a finger and its bead, or the collar tube.
      grow(u.uCrown[0], u.uCrown[1], u.uCrown[2], u.uCrown[3] + u.uCrownShape[1] + Math.max(u.uCrownShape[0], u.uCrownShape[3]))
    }
    // Smooth unions, the swell and the bulge can push the surface out past the primitives.
    const margin = 0.08 + Math.abs(u.uWave[1]) + Math.abs(u.uBulge[3])
    const span = Math.max(hi.x - lo.x, hi.y - lo.y) / 2
    const pad = margin + Math.abs(tiltAngle) * span
    put3(u.uBoundsMin, 0, lo.x - pad, lo.y - pad, lo.z - pad)
    put3(u.uBoundsMax, 0, hi.x + pad, hi.y + pad, hi.z + pad)
  }

  /** World to body space: the inverse (transpose) of Rx(tilt.x) * Ry(tilt.y), column-major. */
  function packTilt(): void {
    const ca = Math.cos(tilt.x)
    const sa = Math.sin(tilt.x)
    const cb = Math.cos(tilt.y)
    const sb = Math.sin(tilt.y)
    // Columns of the transpose are the rows of Rx * Ry.
    put3(u.uTilt, 0, cb, 0, sb)
    put3(u.uTilt, 3, sa * sb, ca, -sa * cb)
    put3(u.uTilt, 6, -ca * sb, sa, ca * cb)
  }

  function currentLabel(): string {
    return atlas.labels[labelIndex].text
  }

  function advanceLabel(): void {
    labelIndex = (labelIndex + 1) % labelCount
    options.onLabelChange?.(currentLabel())
    // Each pill is sized to its word, so the hit target follows the new label.
    reportLayout()
  }

  function update(time: number, delta: number): void {
    // Clock: fast-forward through the idle beats after a press; wrap to the next label. It waits
    // for the shader, so the entrance plays in full however long the first compile takes.
    if (!frozen && !stage.reducedMotion && program && !paused) {
      const speed = fastForwardTo >= 0 ? FAST_FORWARD : 1
      // Over the button at rest, the cycle holds: the label never changes under the hand.
      const holding = pointer.inside && pointer.active && fastForwardTo < 0 && cycleT >= REST_FROM
      if (!holding) cycleT += delta * speed
      if (fastForwardTo >= 0 && cycleT >= fastForwardTo) {
        cycleT = fastForwardTo
        fastForwardTo = -1
      }
      if (cycleT >= CYCLE_SECONDS) {
        if (focused) {
          // Hold the last resting instant: the focused button keeps its name.
          cycleT = CYCLE_SECONDS - 1e-3
        } else {
          cycleT -= CYCLE_SECONDS
          advanceLabel()
        }
      }
    }

    const current = atlas.labels[labelIndex]
    // Every cycle, the first included, opens with the previous label's pill melting into this one.
    const previous = labelCount > 1 ? atlas.labels[(labelIndex - 1 + labelCount) % labelCount] : null
    sampleCycle(cycleT, current, previous, state)

    // During the merge the camera holds both pills (cut by the frame edges), then pushes in on the one.
    const glide = Math.abs(state.bodies[0].a.x + state.bodies[0].b.x) / 2
    fitHalfWidth = current.halfLength + PILL.radius + (cycleT < SPLIT_START ? 0.22 * glide : 0)
    placeCamera(state.camElevation, cameraDistance(fitHalfWidth) * state.camDistance)

    // Interaction: hover only steers the resting pill; the split owns the body.
    const restness = 1 - smoothstep(SPLIT_START, SPLIT_START + 0.35, cycleT) + smoothstep(REST_FROM - 0.4, REST_FROM, cycleT)
    const dt = Math.min(delta, 0.05)
    hover = approach(hover, pointer.inside && pointer.active ? 1 : 0, 7, dt)
    const target = pointer.active ? pointerOnPlane(pointer.x, pointer.y) : { x: 0, y: 0 }
    smoothPointer.x = approach(smoothPointer.x, target.x, 10, dt)
    smoothPointer.y = approach(smoothPointer.y, target.y, 10, dt)
    const span = current.halfLength + PILL.radius
    const nx = Math.max(-1, Math.min(1, smoothPointer.x / span))
    const ny = Math.max(-1, Math.min(1, smoothPointer.y / PILL.radius))
    const engage = hover * restness
    tilt.x = approach(tilt.x, -0.1 * ny * engage, 6, dt)
    tilt.y = approach(tilt.y, 0.16 * nx * engage, 6, dt)
    stepSpring(press, pressed ? 1 : 0, 240, 10, dt)

    // A press dents the glass under the finger and squashes the body; release springs it back.
    const squash = 0.1 * press.value
    const dy = -0.04 * press.value
    packBody(0, state.bodies[0], dy, squash)
    packBody(1, state.bodies[1], 0, 0)

    const pressing = pressed || press.value > 0.05
    const bulgeX = pressing ? pressPoint.x : smoothPointer.x
    const bulgeY = pressing ? pressPoint.y : smoothPointer.y
    put4(u.uBulge, 0, Math.max(-span, Math.min(span, bulgeX)), Math.max(-0.3, Math.min(0.3, bulgeY)), 0.42, 0.03 * engage - 0.1 * press.value)

    put4(u.uWave, 0, state.wave.x, state.wave.amplitude, state.wave.width, state.wave.wavenumber)

    // The light follows the pointer when it is over the resting pill.
    const orbFollow = clamp01(engage * 1.2)
    const ox = mix(state.orb.x, Math.max(-span + 0.35, Math.min(span - 0.35, smoothPointer.x)), orbFollow)
    const oy = mix(state.orb.y, Math.max(-0.2, Math.min(0.2, smoothPointer.y)), orbFollow)
    put4(u.uOrb, 0, ox, oy + dy, state.orb.z, Math.max(state.orb.intensity, 0.9 * engage))

    for (let i = 0; i < state.dropCount; i++) {
      const d = state.drops[i]
      put4(u.uDrop, i * 4, d.x, d.y, d.z, d.r)
      put3(u.uDropTail, i * 3, d.tx, d.ty, d.tz)
    }
    u.uDropCount[0] = state.dropCount
    const crown = state.crown
    put4(u.uCrown, 0, crown.x, crown.y, crown.z, crown.ring)
    put4(u.uCrownShape, 0, crown.collar, crown.finger, crown.fingerRadius, crown.tipRadius)
    put3(u.uCrownAxis, 0, state.crown.ax, state.crown.ay, state.crown.az)

    packTilt()
    packBounds(Math.max(Math.abs(tilt.x), Math.abs(tilt.y)))

    u.uFloorY[0] = state.floorY
    u.uWarmth[0] = state.warmth
    u.uTextBlur[0] = state.textBlur
    u.uTime[0] = time
  }

  function draw(): void {
    if (!ensureProgram() || !program) {
      gl.clearColor(BACKDROP[0], BACKDROP[1], BACKDROP[2], 1)
      gl.clear(gl.COLOR_BUFFER_BIT)
      return
    }
    gl.useProgram(program.program)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    applyUniforms(gl, program, u)
    gl.bindVertexArray(vao)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  function activate(): void {
    if (stage.reducedMotion) {
      // No liquid under reduced motion: the press swaps to the next label in one still frame.
      advanceLabel()
      stage.requestRender()
      return
    }
    if (frozen) return
    // A press wakes the button: the light, the groove, then the split.
    if (cycleT < WAKE_FROM) fastForwardTo = WAKE_FROM
    else if (cycleT >= REST_FROM) cycleT = WAKE_FROM
    // A press mid-split only adds a jiggle.
    press.velocity -= 6
  }

  const interaction: GlassInteraction = {
    pointerMove(x, y) {
      pointer.x = x
      pointer.y = y
      pointer.active = true
      const p = pointerOnPlane(x, y)
      const L = atlas.labels[labelIndex].halfLength
      pointer.inside = Math.abs(p.x) < L + PILL.radius + 0.1 && Math.abs(p.y) < PILL.radius + 0.15
    },
    pointerLeave() {
      pointer.active = false
      pointer.inside = false
    },
    press(x, y) {
      this.pointerMove(x, y)
      const p = pointerOnPlane(x, y)
      pressPoint.x = p.x
      pressPoint.y = p.y
      pressed = true
    },
    release() {
      pressed = false
    },
    activate,
    setFocused(value) {
      focused = value
    },
    setPaused(value) {
      paused = value
    },
  }

  options.onLabelChange?.(currentLabel())

  function releaseGpu(): void {
    if (pending) gl.deleteProgram(pending)
    if (program) gl.deleteProgram(program.program)
    gl.deleteTexture(texture)
    gl.deleteVertexArray(vao)
    pending = null
    program = null
    texture = null
    vao = null
  }

  return {
    interaction,
    render({ time, delta }: Frame) {
      update(time, delta)
      draw()
    },
    resize(width, height) {
      viewWidth = width
      viewHeight = height
      put2(u.uResolution, 0, stage.canvas.width, stage.canvas.height)
      reportLayout()
    },
    ready() {
      return program !== null
    },
    motionPreference(reduced) {
      if (frozen) return
      // Reduced motion shows the resting still; turning it off plays on from there.
      fastForwardTo = -1
      if (reduced) cycleT = STILL_TIME
    },
    upgrade() {
      if (u.uQuality[0] > 0.5) return false
      u.uQuality[0] = 1
      return true
    },
    quality() {
      return u.uQuality[0] > 0.5 ? 'full' : 'lite'
    },
    degrade() {
      if (u.uQuality[0] < 0.5) return false
      u.uQuality[0] = 0
      return true
    },
    restore() {
      // Handles from the lost context are already dead; drop them and build afresh.
      pending = null
      program = null
      failed = false
      build()
    },
    dispose() {
      releaseGpu()
    },
  }
}
