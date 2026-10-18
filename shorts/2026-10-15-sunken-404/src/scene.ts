// The aquarium on screen: talks to the physics worker, draws the tank in three passes (the 3D
// diorama, the particle splats the water is shaped from, the water composite) and turns the
// visitor's hand into input.
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import type { Frame, SceneHandle, Stage } from './stage'
import quadVertex from './shaders/quad.vert'
import compositeFragment from './shaders/composite.frag'
import densityVertex from './shaders/density.vert'
import densityFragment from './shaders/density.frag'
import sandVertex from './shaders/sand.vert'
import sandFragment from './shaders/sand.frag'
import { sampleSdf, type GlyphShape, type Mask } from './sim/glyph'
import { rasterizeGlyph } from './render/raster'
import { DIGIT_DEPTH, DROP_RADIUS, floorCurve, PARTICLE_BUDGET, SPLAT_RADIUS, SURFACE_ROWS, TANK_BACK, TANK_FRONT, UNION_SMOOTH, type Layout } from './sim/world'
import { FLOW_COLUMNS, FLOW_ROWS, type FromWorker, type ReadyMessage, type StateMessage, type ToWorker } from './sim/protocol'
import { digitGeometry, sandGeometry, sandHeight } from './render/geometry'
import { createLife, type Aquarium, type Tank } from './life'
import type { Vec2 } from './life/tank'
import { HandInput } from './input'
import type { TiltInput } from './tilt'

const FOV = 20
const CHARS = ['4', '0', '4']
const FONT_FAMILY = '"Geist Variable", Geist, ui-sans-serif, system-ui, sans-serif'
const FONT_WEIGHT = 560
const GLYPH_PIXELS = 420
/** Open water behind everything: where a pixel with nothing drawn is taken to be. */
const BACK_OF_TANK = -3.5
/** Bevel of a digit, as a fraction of its height (its depth is DIGIT_DEPTH). */
const DIGIT_BEVEL = 0.022
const HOVER_SLACK = 0.04
const FIRST_FRAME_MARK = 'sunken-404:tank-ready'
const REVEAL_SECONDS = 0.6
/** A lost context gets this long to come back before the page shows its still fallback. */
const LOST_GRACE_MS = 3000

export interface AquariumStats {
  fps: number
  physicsMs: number
  particles: number
}

export interface AquariumOptions {
  /** The worker could not start or the GPU path failed: the page should show its still fallback. */
  onFatal?(error: Error): void
  onStats?(stats: AquariumStats): void
  /** A digit was picked up (true) or let go (false): the page can make room for it. */
  onHolding?(holding: boolean): void
  /** The phone's tilt and shake, where the page reads them. */
  tilt?: TiltInput
  /** A tank was laid out for the view (on start and after each rebuild). */
  onLayout?(layout: Layout): void
}

/**
 * The phone's own acceleration (m/s^2) to the tank's (sim units / s^2). The tank's gravity is 9.81
 * units / s^2, so equal numbers keep a shake's ratio to gravity; World.shake keeps a decaying memory
 * of what it is given (2.5 times a steady input), which this takes back out.
 */
const PHONE_SHAKE_GAIN = 0.4

/**
 * The page's spotlight, as the reference lights it: it comes in past the top edge at SPOT_ENTRY of
 * the width, between the headline and the header's buttons, and falls down and to the left,
 * SPOT_TILT from vertical. Measured from the beam's centre in two of the reference's frames: 0.74
 * and 0.76 of the width, 35 and 38.5 degrees. The key light on the digits comes from the same side
 * at the same angle, so they are lit by the beam you see.
 */
const SPOT_ENTRY = 0.75
const SPOT_TILT = THREE.MathUtils.degToRad(36.5)

export function createAquarium(stage: Stage, options: AquariumOptions): SceneHandle {
  const renderer = stage.renderer
  const canvas = stage.canvas
  const reduced = stage.reducedMotion

  // ---- Passes and their targets ----
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 40)
  const world3d = new THREE.Scene()
  const sprayScene = new THREE.Scene()
  // The composite reads this pass's depth to know how far each pixel's light crossed the water.
  // Multisampling for the 3D pass, from full to none: the governor steps down it before it lowers
  // the pixel ratio. Where the browser offers multisampled render-to-texture (tile-based mobile
  // GPUs), none: that path with a depth texture attached is not reliable (three's own source says
  // so of it with an external depth buffer, and the GLES extension allows colour attachments only).
  const sampleLevels = renderer.extensions.has('WEBGL_multisampled_render_to_texture') ? [0] : [4, 2, 0]
  let sampleLevel = 0
  const sceneDepth = new THREE.DepthTexture(1, 1)
  const sceneTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: sampleLevels[0], depthTexture: sceneDepth })
  function setSampleLevel(level: number): void {
    sampleLevel = level
    // A target's sample count is fixed when it is allocated: free it, and three allocates it again.
    sceneTarget.dispose()
    sceneTarget.samples = sampleLevels[level]
  }
  const densityTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false })
  // The bubbles' light, one byte per pixel at full size: they are only a few pixels across.
  const bubbleTarget = new THREE.WebGLRenderTarget(1, 1, { format: THREE.RedFormat, type: THREE.UnsignedByteType, depthBuffer: false })
  const bubbleScene = new THREE.Scene()
  renderer.setClearColor(0x000000, 0)

  const pmrem = new THREE.PMREMGenerator(renderer)
  /** The soft studio light the lit materials reflect, rendered into a prefiltered map. */
  function bakeEnvironment(): THREE.WebGLRenderTarget {
    const room = new RoomEnvironment()
    const target = pmrem.fromScene(room, 0.04)
    room.dispose()
    world3d.environment = target.texture
    return target
  }
  // Baked on the first init, while the worker settles the water: it is the costliest start-up step
  // on the main thread (its blur shader compiles), and the lit materials compile against it.
  let envTarget: THREE.WebGLRenderTarget | null = null
  world3d.environmentIntensity = 0.35

  // Light from above, to the right and in front, as the page's spotlight falls: it lights the faces
  // the camera sees, the way the reference's digits glow.
  const lightDir = new THREE.Vector3(0.83 * Math.sin(SPOT_TILT), 0.83 * Math.cos(SPOT_TILT), 0.56).normalize()
  const key = new THREE.DirectionalLight('#fff0dc', 3.2)
  const hemi = new THREE.HemisphereLight('#9fc0bd', '#241c12', 0.45)
  world3d.add(key, key.target, hemi)

  // Shared water-surface texture: one texel per grid column, SURFACE_ROWS rows (see World.displaySurface).
  let surfaceData = new Float32Array(SURFACE_ROWS)
  let surfaceTexture = new THREE.DataTexture(surfaceData, 1, SURFACE_ROWS, THREE.RedFormat, THREE.FloatType)
  const surfaceUniforms: Omit<Tank['uniforms'], 'uTime'> = {
    tSurface: { value: surfaceTexture },
    uColumns: { value: 1 },
    uCell: { value: 1 },
  }

  const time = { value: 0 }
  const sim = { value: new THREE.Vector2(1, 1) }
  const spot = { value: new THREE.Vector2(0, 0) }
  const spotAxis = { value: new THREE.Vector2(-Math.sin(SPOT_TILT), -Math.cos(SPOT_TILT)) }

  const composite = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: quadVertex,
    fragmentShader: compositeFragment,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      ...surfaceUniforms,
      tScene: { value: sceneTarget.texture },
      tDensity: { value: densityTarget.texture },
      tBubbles: { value: bubbleTarget.texture },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uSim: sim,
      uPixelRatio: { value: 1 },
      uTime: time,
      uDensityScale: { value: 1 },
      uSpot: spot,
      uSpotAxis: spotAxis,
      uOrigin: { value: 0 },
      uExposure: { value: 1 },
      tDepth: { value: sceneDepth },
      uCamera: { value: new THREE.Vector3() },
      uTanHalf: { value: new THREE.Vector2(1, 1) },
      uClip: { value: new THREE.Vector2(0.1, 40) },
      uGlassZ: { value: TANK_FRONT },
      uBackZ: { value: BACK_OF_TANK },
      uLightDir: { value: lightDir },
      uReveal: { value: 0 },
      // The particles' surface (see SPLAT_RADIUS), in sim units; set per tank and size.
      uSplatRadius: { value: 1 },
      uDropRadius: { value: 0 },
      uUnionSmooth: { value: 1 },
      // ?view=mask draws the water's fill, meniscus and band as red, green and blue, for inspection.
      uView: { value: new URLSearchParams(window.location.search).get('view') === 'mask' ? 1 : 0 },
    },
  })
  const screenScene = new THREE.Scene()
  const screenCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), composite)
  quad.frustumCulled = false
  screenScene.add(quad)

  const sandMaterial = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: sandVertex,
    fragmentShader: sandFragment,
    uniforms: {
      ...surfaceUniforms,
      uLightDir: { value: lightDir },
      // The key light's colour times its intensity, and roughly what the hemisphere light and the
      // environment add, so the sand sits in the same light as the lit materials.
      uKey: { value: new THREE.Vector3().setFromColor(key.color).multiplyScalar(key.intensity) },
      uAmbient: { value: new THREE.Vector3(0.75, 0.8, 0.8) },
    },
  })
  const digitMaterial = new THREE.MeshPhysicalMaterial({
    color: '#e6eeea',
    roughness: 0.42,
    metalness: 0,
    clearcoat: 0.45,
    clearcoatRoughness: 0.3,
  })
  const sprayMaterial = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: densityVertex,
    fragmentShader: densityFragment,
    // Plain sums in all four channels. three's AdditiveBlending without premultiplied alpha is
    // SRC_ALPHA, ONE for colour, which would weight each particle's sums by the speed it writes
    // to alpha.
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    uniforms: { ...surfaceUniforms, uAlpha: { value: 0 }, uPointSize: { value: 8 } },
  })

  // ---- World-dependent objects, rebuilt whenever the layout changes ----
  let layout: Layout | null = null
  let shapes = new Map<string, GlyphShape>()
  let sand: THREE.Mesh | null = null
  const digitMeshes: THREE.Mesh[] = []
  const digitGeometries = new Map<string, THREE.ExtrudeGeometry>()
  let spray: THREE.Points | null = null
  let life: Aquarium | null = null
  /** The spray's particle positions now and before the last step, with typed views of their data. */
  let sprayBuffers: { pos: THREE.BufferAttribute; prev: THREE.BufferAttribute; posData: Float32Array; prevData: Float32Array } | null = null
  let particleRadius = 0.01
  // Phones get fewer particles; once the worker has found this device slower still, every later
  // build (a rotation, a resize) keeps the lower budget instead of measuring again.
  let budget: number = window.matchMedia('(pointer: coarse)').matches ? PARTICLE_BUDGET.phone : PARTICLE_BUDGET.desktop

  // Latest physics snapshot, copied out of the worker's buffers on arrival.
  const digitsNow = new Float32Array(9)
  const digitsPrev = new Float32Array(9)
  let alpha = 0
  let haveState = false
  /** The tank's shaders are compiled, so its first draw does not stall the page. */
  let warm = false
  let builds = 0
  let holding = false
  let particles = 0
  let physicsMs = 0

  function clearWorld(): void {
    if (life) {
      world3d.remove(life.scene)
      bubbleScene.remove(life.bubbles.object)
      life.dispose()
      life = null
    }
    if (sand) {
      world3d.remove(sand)
      sand.geometry.dispose()
      sand = null
    }
    for (const m of digitMeshes) world3d.remove(m)
    digitMeshes.length = 0
    for (const g of digitGeometries.values()) g.dispose()
    digitGeometries.clear()
    if (spray) {
      sprayScene.remove(spray)
      spray.geometry.dispose()
      spray = null
    }
  }

  /**
   * Points the camera at the tank for a view of this aspect. The camera sees the z = 0 plane
   * exactly top to bottom, centred on the tank. A view wider or narrower than the tank's layout
   * (a resize, before the tank is rebuilt for it) shows more or less of the sides, never a stretch.
   */
  function fitView(aspect: number): void {
    if (!layout) return
    const L = layout
    camera.aspect = aspect
    camera.updateProjectionMatrix()
    camera.updateMatrixWorld()
    const viewWidth = L.height * aspect
    sim.value.set(viewWidth, L.height)
    const u = composite.uniforms
    u.uOrigin.value = (L.width - viewWidth) / 2
    const tanY = Math.tan(THREE.MathUtils.degToRad(FOV / 2))
    u.uTanHalf.value.set(tanY * aspect, tanY)
    life?.bubbles.setView(camera, sceneDepth)
  }

  function buildWorld(m: ReadyMessage, rebuild: boolean): void {
    clearWorld()
    layout = m.layout
    options.onLayout?.(m.layout)
    shapes = new Map(m.shapes)
    const L = m.layout
    // Its source sits above the top edge, on the line that crosses the edge at SPOT_ENTRY.
    spot.value.set(L.width * SPOT_ENTRY + Math.tan(SPOT_TILT) * 0.12 * L.height, L.height * 1.12)

    camera.fov = FOV
    const distance = L.height / 2 / Math.tan(THREE.MathUtils.degToRad(FOV / 2))
    camera.position.set(L.width / 2, L.height / 2, distance)
    camera.near = distance - 4
    camera.far = distance + 6
    camera.lookAt(L.width / 2, L.height / 2, 0)
    const u = composite.uniforms
    u.uCamera.value.copy(camera.position)
    u.uClip.value.set(camera.near, camera.far)
    key.target.position.set(L.width / 2, L.height / 3, 0)
    key.position.copy(key.target.position).addScaledVector(lightDir, 10)

    sand = new THREE.Mesh(sandGeometry(floorCurve(L), L.width, TANK_BACK, TANK_FRONT), sandMaterial)
    world3d.add(sand)

    const depth = L.digitHeight * DIGIT_DEPTH
    for (const [c, shape] of shapes) digitGeometries.set(c, digitGeometry(shape, depth, L.digitHeight * DIGIT_BEVEL))
    for (const c of m.chars) {
      const mesh = new THREE.Mesh(digitGeometries.get(c), digitMaterial)
      digitMeshes.push(mesh)
      world3d.add(mesh)
    }

    surfaceTexture.dispose()
    surfaceData = new Float32Array(SURFACE_ROWS * m.gridColumns)
    surfaceTexture = new THREE.DataTexture(surfaceData, m.gridColumns, SURFACE_ROWS, THREE.RedFormat, THREE.FloatType)
    surfaceTexture.needsUpdate = true
    surfaceUniforms.tSurface.value = surfaceTexture
    surfaceUniforms.uColumns.value = m.gridColumns
    surfaceUniforms.uCell.value = m.cell
    u.uUnionSmooth.value = UNION_SMOOTH * m.cell
    particleRadius = m.particleRadius
    budget = m.budget

    const geometry = new THREE.BufferGeometry()
    const posData = new Float32Array(2 * m.maxParticles)
    const prevData = new Float32Array(2 * m.maxParticles)
    sprayBuffers = { pos: new THREE.BufferAttribute(posData, 2), prev: new THREE.BufferAttribute(prevData, 2), posData, prevData }
    sprayBuffers.pos.setUsage(THREE.DynamicDrawUsage)
    sprayBuffers.prev.setUsage(THREE.DynamicDrawUsage)
    geometry.setAttribute('position', sprayBuffers.pos)
    geometry.setAttribute('prev', sprayBuffers.prev)
    geometry.setDrawRange(0, 0)
    // Positions are 2D, so three cannot compute bounds from them; the tank is the bound.
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(L.width / 2, L.height / 2, 0), Math.hypot(L.width, L.height))
    spray = new THREE.Points(geometry, sprayMaterial)
    spray.frustumCulled = false
    sprayScene.add(spray)
    sizeSplats()

    life = createLife(tankFor(L, m.cell), TANK_FRONT)
    world3d.add(life.scene)
    bubbleScene.add(life.bubbles.object)
    fitView(cssW > 0 ? cssW / cssH : L.width / L.height)

    // A rebuild reuses the programs already compiled; the first build compiles the tank's shaders
    // in parallel (KHR_parallel_shader_compile where the browser has it) while the worker settles
    // the water, instead of stalling on the first draw.
    if (rebuild) return
    warm = false
    const build = ++builds
    Promise.all([renderer.compileAsync(world3d, camera), renderer.compileAsync(sprayScene, camera)]).then(
      () => {
        if (build !== builds) return
        warm = true
        if (reduced) stage.requestRender()
      },
      (error: unknown) => options.onFatal?.(error instanceof Error ? error : new Error(String(error))),
    )
  }

  function applyState(s: StateMessage): void {
    particles = s.count
    if (sprayBuffers && spray) {
      const b = sprayBuffers
      b.posData.set(s.pos)
      b.prevData.set(s.prev)
      for (const a of [b.pos, b.prev]) {
        a.clearUpdateRanges()
        a.addUpdateRange(0, 2 * s.count)
        a.needsUpdate = true
      }
      spray.geometry.setDrawRange(0, s.count)
    }
    if (s.surface.length === surfaceData.length) {
      surfaceData.set(s.surface)
      surfaceTexture.needsUpdate = true
    }
    flowData.set(s.flow)
    digitsNow.set(s.digits)
    digitsPrev.set(s.digitsPrev)
    alpha = s.alpha
    up.x = -Math.sin(s.tilt)
    up.y = Math.cos(s.tilt)
    if (input && s.pressed === presses && !s.holding && input.holding) input.cancelHold()
    if (s.holding !== holding) {
      holding = s.holding
      options.onHolding?.(holding)
    }
    physicsMs += (s.stepMs - physicsMs) * 0.1
    haveState = true
    recycle.push(s.pos.buffer, s.prev.buffer, s.digits.buffer, s.digitsPrev.buffer, s.surface.buffer, s.flow.buffer)
  }

  // ---- What the creatures see of the tank ----
  const flowData = new Float32Array(2 * FLOW_COLUMNS * FLOW_ROWS)
  /** Straight up through the water, turned by the tilt the tank holds. */
  const up: Vec2 = { x: 0, y: 1 }

  /** The creatures' view of the tank for one layout: sand, live surface, live current, the hand. */
  function tankFor(L: Layout, cell: number): Tank {
    const sandAt = sandHeight(floorCurve(L))
    const flowTop = L.waterLevel + 0.3
    return {
      layout: L,
      sand: sandAt,
      surfaceAt(x) {
        // The first row: the volume line.
        const n = surfaceData.length / SURFACE_ROWS
        const g = Math.min(Math.max(x / cell - 0.5, 0), n - 1.001)
        const i = Math.floor(g)
        const t = g - i
        return surfaceData[i] * (1 - t) + surfaceData[Math.min(i + 1, n - 1)] * t
      },
      flowAt(x, y, out) {
        // The worker samples the flow at cell centres from the floor to a little above the water.
        const gx = Math.min(Math.max((x / L.width) * FLOW_COLUMNS - 0.5, 0), FLOW_COLUMNS - 1.001)
        const gy = Math.min(Math.max(((y - L.floorBase) / (flowTop - L.floorBase)) * FLOW_ROWS - 0.5, 0), FLOW_ROWS - 1.001)
        const c = Math.floor(gx)
        const r = Math.floor(gy)
        const tx = gx - c
        const ty = gy - r
        const i00 = 2 * (r * FLOW_COLUMNS + c)
        const i10 = i00 + 2
        const i01 = i00 + 2 * FLOW_COLUMNS
        const i11 = i01 + 2
        const w00 = (1 - tx) * (1 - ty)
        const w10 = tx * (1 - ty)
        const w01 = (1 - tx) * ty
        const w11 = tx * ty
        out.x = flowData[i00] * w00 + flowData[i10] * w10 + flowData[i01] * w01 + flowData[i11] * w11
        out.y = flowData[i00 + 1] * w00 + flowData[i10 + 1] * w10 + flowData[i01 + 1] * w01 + flowData[i11 + 1] * w11
      },
      hand,
      up,
      scale: Math.min(1, Math.max(0.55, L.digitHeight / (0.28 * L.height))),
      uniforms: { ...surfaceUniforms, uTime: time },
    }
  }

  // ---- The physics worker ----
  const worker = new Worker(new URL('./sim/worker.ts', import.meta.url), { type: 'module' })
  let pending = false
  let nextWorld: ReadyMessage | null = null
  let elapsed = 0
  const recycle: ArrayBuffer[] = []
  worker.onmessage = (event: MessageEvent<FromWorker>) => {
    const m = event.data
    if (m.type === 'ready') {
      // The first tank is built at once. A rebuild for a new shape waits for its first state, so
      // the old tank stays on screen until the new one can replace it in the same frame.
      if (layout) nextWorld = m
      else buildWorld(m, false)
    } else {
      if (nextWorld) {
        buildWorld(nextWorld, true)
        nextWorld = null
      }
      applyState(m)
      pending = false
      if (reduced) stage.requestRender()
    }
  }
  worker.onerror = (event) => {
    options.onFatal?.(new Error(`Physics worker failed: ${event.message}`))
  }
  const post = (message: ToWorker, transfer: Transferable[] = []) => worker.postMessage(message, transfer)

  let masks: Array<[string, Mask]> | null = null
  function init(cssWidth: number, cssHeight: number): void {
    if (!masks) masks = [...new Set(CHARS)].map((c) => [c, rasterizeGlyph(c, FONT_FAMILY, FONT_WEIGHT, GLYPH_PIXELS)])
    pending = true
    // A still page shows its one frame once the water has settled; 2.5 s of physics gets there.
    post({ type: 'init', cssWidth, cssHeight, chars: CHARS, masks, settle: reduced ? 2.5 : 1, budget })
    envTarget ??= bakeEnvironment()
  }

  // ---- Input ----
  /** The digit under a sim-space point, where it was drawn this frame. */
  function digitUnder(x: number, y: number): boolean {
    if (!layout || !haveState) return false
    for (let i = 0; i < digitMeshes.length; i++) {
      const shape = shapes.get(CHARS[i])
      if (!shape) continue
      const mesh = digitMeshes[i]
      const dx = x - mesh.position.x
      const dy = y - mesh.position.y
      const a = mesh.rotation.z
      const c = Math.cos(a)
      const s = Math.sin(a)
      if (sampleSdf(shape, c * dx + s * dy, -s * dx + c * dy) < HOVER_SLACK) return true
    }
    return false
  }

  // With reduced motion the tank is a picture: nothing to stir or grab.
  const input = reduced
    ? null
    : new HandInput({
        canvas,
        toSim(clientX, clientY, out) {
          const L = layout
          if (!L) return false
          const rect = canvas.getBoundingClientRect()
          out.x = ((clientX - rect.left) / rect.width) * L.width
          out.y = (1 - (clientY - rect.top) / rect.height) * L.height
          return true
        },
        digitUnder,
        grab: (x, y) => post({ type: 'press', id: ++presses, x, y }),
        letGo: () => post({ type: 'release' }),
      })
  let presses = 0
  /** What the physics and the creatures see of the hand (never active on a still page). */
  const hand = input?.hand ?? { x: 0, y: 0, vx: 0, vy: 0, active: false }

  // A lost GL context takes every GPU resource with it. three uploads geometry and data textures
  // again by itself, but the environment map was rendered, not uploaded, so it is rendered again.
  // The old map died with the old context: disposing it would delete objects no live context owns.
  // A still (reduced-motion) page has no loop to redraw itself.
  let lostTimer = 0
  function onContextLost(): void {
    lostTimer = window.setTimeout(() => options.onFatal?.(new Error('The WebGL context was lost and not restored')), LOST_GRACE_MS)
  }
  canvas.addEventListener('webglcontextlost', onContextLost)
  function onContextRestored(): void {
    window.clearTimeout(lostTimer)
    envTarget = bakeEnvironment()
    surfaceTexture.needsUpdate = true
    if (reduced) stage.requestRender()
  }
  canvas.addEventListener('webglcontextrestored', onContextRestored)

  // ---- Sizing ----
  let cssW = 0
  let cssH = 0
  let reinitTimer = 0
  function sizeSplats(): void {
    if (!layout) return
    const height = densityTarget.height
    const pxPerUnit = height / layout.height
    const dx = 2 * particleRadius * pxPerUnit
    const dy = Math.sqrt(3) * particleRadius * pxPerUnit
    const radius = Math.max(1.5, SPLAT_RADIUS * particleRadius * pxPerUnit)
    sprayMaterial.uniforms.uPointSize.value = 2 * radius
    // The field a resting lattice adds up to: kernel integral over the area per particle.
    const expected = (Math.PI * radius * radius) / 4 / (dx * dy)
    const u = composite.uniforms
    u.uDensityScale.value = 1 / expected
    u.uSplatRadius.value = radius / pxPerUnit
    u.uDropRadius.value = DROP_RADIUS * particleRadius
  }

  // ---- Frame ----
  let statsTimer = 0
  const phoneShake: Vec2 = { x: 0, y: 0 }
  const phoneShakeSum: Vec2 = { x: 0, y: 0 }
  let phoneShakeFrames = 0
  function update(frame: Frame): void {
    time.value = frame.time
    // The tank fades in once its shaders are compiled and the water has a first state; a standard
    // mark records when, so load time can be read from the Performance timeline.
    const ready = haveState && warm
    const reveal = composite.uniforms.uReveal
    if (ready && reveal.value === 0 && performance.getEntriesByName(FIRST_FRAME_MARK).length === 0) performance.mark(FIRST_FRAME_MARK)
    reveal.value = ready ? (reduced ? 1 : Math.min(1, reveal.value + frame.delta / REVEAL_SECONDS)) : 0
    elapsed += frame.delta
    const tilt = options.tilt
    if (tilt) {
      // Every frame, so the tilt eases at the display's pace; the shake waits for the next post.
      tilt.update(frame.delta, phoneShake)
      phoneShakeSum.x += phoneShake.x
      phoneShakeSum.y += phoneShake.y
      phoneShakeFrames++
    }
    if (input && layout && !pending) {
      input.settle(frame.delta)
      const shake = input.windowShake(frame.delta, layout.height / window.innerHeight)
      const phone = phoneShakeFrames > 0 ? PHONE_SHAKE_GAIN / phoneShakeFrames : 0
      const transfer = recycle.splice(0, recycle.length)
      post(
        {
          type: 'frame',
          delta: elapsed,
          pointer: hand,
          shake: { ax: shake.x + phoneShakeSum.x * phone, ay: shake.y + phoneShakeSum.y * phone },
          tilt: tilt?.angle ?? 0,
          recycle: transfer,
        },
        transfer,
      )
      pending = true
      elapsed = 0
      phoneShakeSum.x = 0
      phoneShakeSum.y = 0
      phoneShakeFrames = 0
    }

    // Digits between their last two steps.
    for (let i = 0; i < digitMeshes.length; i++) {
      const a0 = digitsPrev[3 * i + 2]
      const a1 = digitsNow[3 * i + 2]
      const da = Math.atan2(Math.sin(a1 - a0), Math.cos(a1 - a0))
      const mesh = digitMeshes[i]
      mesh.position.set(
        digitsPrev[3 * i] + (digitsNow[3 * i] - digitsPrev[3 * i]) * alpha,
        digitsPrev[3 * i + 1] + (digitsNow[3 * i + 1] - digitsPrev[3 * i + 1]) * alpha,
        0,
      )
      mesh.rotation.z = a0 + da * alpha
      mesh.visible = haveState
    }
    sprayMaterial.uniforms.uAlpha.value = alpha

    // The creatures: a long stall (a hidden tab) is not a long swim, and nothing moves before the
    // first physics state, when there is no surface yet to swim under.
    if (ready) life?.update(reduced ? 0 : Math.min(frame.delta, 0.05))

    renderer.setRenderTarget(sceneTarget)
    renderer.clear()
    if (ready) renderer.render(world3d, camera)
    renderer.setRenderTarget(densityTarget)
    renderer.clear()
    if (ready) renderer.render(sprayScene, camera)
    renderer.setRenderTarget(bubbleTarget)
    renderer.clear()
    if (ready) renderer.render(bubbleScene, screenCamera)
    renderer.setRenderTarget(null)

    statsTimer += frame.delta
    if (options.onStats && statsTimer > 0.5) {
      statsTimer = 0
      options.onStats({ fps: 1000 / stage.frameMs, physicsMs, particles })
    }
  }

  const drawingBuffer = new THREE.Vector2()
  function resize(width: number, height: number): void {
    const ratio = renderer.getPixelRatio()
    // The targets match the canvas exactly (three floors CSS size times pixel ratio), so the
    // composite and the bubbles' depth test read the 3D pass texel for pixel.
    renderer.getDrawingBufferSize(drawingBuffer)
    const w = drawingBuffer.x
    const h = drawingBuffer.y
    sceneTarget.setSize(w, h)
    densityTarget.setSize(Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2)))
    bubbleTarget.setSize(w, h)
    composite.uniforms.uResolution.value.set(w, h)
    composite.uniforms.uPixelRatio.value = ratio
    sizeSplats()
    cssW = width
    cssH = height
    fitView(width / height)
    // The tank is laid out for an aspect ratio: rebuild it once the size settles, measured against
    // the layout it was built for (a slow drag moves less than any threshold between two events).
    const built = layout ? layout.width / layout.height : 0
    if (layout && Math.abs(width / height - built) <= 0.01 * built) return
    window.clearTimeout(reinitTimer)
    if (!layout) init(width, height)
    else reinitTimer = window.setTimeout(() => init(cssW, cssH), 200)
  }

  return {
    scene: screenScene,
    camera: screenCamera,
    update,
    resize,
    degrade() {
      if (sampleLevel >= sampleLevels.length - 1) return false
      setSampleLevel(sampleLevel + 1)
      return true
    },
    upgrade() {
      if (sampleLevel === 0) return false
      setSampleLevel(sampleLevel - 1)
      return true
    },
    dispose() {
      window.clearTimeout(reinitTimer)
      worker.terminate()
      input?.dispose()
      canvas.removeEventListener('webglcontextrestored', onContextRestored)
      canvas.removeEventListener('webglcontextlost', onContextLost)
      window.clearTimeout(lostTimer)
      clearWorld()
      sceneTarget.dispose()
      densityTarget.dispose()
      bubbleTarget.dispose()
      envTarget?.dispose()
      pmrem.dispose()
      surfaceTexture.dispose()
      quad.geometry.dispose()
      composite.dispose()
      sandMaterial.dispose()
      digitMaterial.dispose()
      sprayMaterial.dispose()
    },
  }
}
