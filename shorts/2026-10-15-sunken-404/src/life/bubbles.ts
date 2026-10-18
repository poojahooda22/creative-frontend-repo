// Bubbles: thin bright rings rising from a few spots in the sand, and from a hand moving fast
// through the water. They are drawn as an amount of light into a one-channel target that the
// composite adds to the water in linear light, before its highlight compression and encoding.
// Each tests itself against the tank's depth (hidden behind a digit or a fish) and fades by its
// own distance through the water. They wobble up, ride the current and pop at the surface.
import * as THREE from 'three'
import surfaceGlsl from '../shaders/surface.glsl'
import waterGlsl from '../shaders/water.glsl'
import { between, random } from './random'
import type { Life, Tank, Vec2 } from './tank'

const MAX_BUBBLES = 96

const VERTEX = /* glsl */ `
uniform mat4 uViewProj;
uniform float uGlassZ;
${surfaceGlsl}
in vec4 iBubble;
out vec2 vQuad;
out float vPath;
out float vBelow;

void main() {
  vec3 centre = iBubble.xyz;
  // The camera looks straight down -z, so a billboard is a square in x and y.
  vec3 world = centre + vec3(position.xy * 2.0 * iBubble.w, 0.0);
  gl_Position = uViewProj * vec4(world, 1.0);
  vQuad = position.xy * 2.0;
  vPath = max(uGlassZ - centre.z, 0.0);
  vBelow = max(surfaceAtX(centre.x) - centre.y, 0.0);
}
`

const FRAGMENT = /* glsl */ `
uniform sampler2D tDepth;
${waterGlsl}
in vec2 vQuad;
in float vPath;
in float vBelow;
out vec4 fragColor;

void main() {
  float r = length(vQuad);
  if (r > 1.0) discard;
  // Behind something drawn in the tank.
  if (gl_FragCoord.z > texelFetch(tDepth, ivec2(gl_FragCoord.xy), 0).r) discard;
  float rim = smoothstep(0.6, 0.9, r) * (1.0 - smoothstep(0.9, 1.0, r));
  float glint = 1.0 - smoothstep(0.1, 0.26, length(vQuad - vec2(-0.32, 0.36)));
  float light = 0.5 * rim + 0.8 * glint + 0.05;
  // The composite tints it; the water's green channel stands for its loss here.
  fragColor = vec4(light * exp(-LIGHT_LOSS.g * 0.4 * vBelow) * exp(-EXTINCTION.g * 0.6 * vPath), 0.0, 0.0, 1.0);
}
`

interface Bubble {
  x: number
  y: number
  z: number
  r: number
  rise: number
  wobble: number
}

interface Vent {
  x: number
  z: number
  /** Seconds until its next burst, and how many are left in the current one. */
  timer: number
  burst: number
}

export interface BubbleLife extends Life {
  /** Fills the camera and depth uniforms; call when the camera or the depth target changes. */
  setView(camera: THREE.PerspectiveCamera, depth: THREE.Texture): void
}

export function createBubbles(tank: Tank, glassZ: number, seed: number): BubbleLife {
  const L = tank.layout
  const size = Math.sqrt(tank.scale)
  const rand = random(seed)
  const bubbles: Bubble[] = []
  const vents: Vent[] = []
  const ventCount = Math.max(2, Math.round((3 * L.width) / 5))
  for (let i = 0; i < ventCount; i++) {
    vents.push({ x: ((i + between(rand, 0.2, 0.8)) / ventCount) * L.width, z: between(rand, -0.5, 0.35), timer: between(rand, 0, 3), burst: 0 })
  }

  const geometry = new THREE.InstancedBufferGeometry()
  const quad = new THREE.PlaneGeometry(1, 1)
  geometry.setIndex(quad.index)
  geometry.setAttribute('position', quad.getAttribute('position'))
  const data = new THREE.InstancedBufferAttribute(new Float32Array(4 * MAX_BUBBLES), 4)
  data.setUsage(THREE.DynamicDrawUsage)
  geometry.setAttribute('iBubble', data)
  geometry.instanceCount = 0
  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      ...tank.uniforms,
      uViewProj: { value: new THREE.Matrix4() },
      uGlassZ: { value: glassZ },
      tDepth: { value: null },
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.frustumCulled = false

  const spawn = (x: number, y: number, z: number, r: number) => {
    if (bubbles.length >= MAX_BUBBLES) return
    bubbles.push({ x, y, z, r, rise: 0.12 + r * 14, wobble: rand() * 10 })
  }

  const flow: Vec2 = { x: 0, y: 0 }
  let handCarry = 0
  function update(dt: number): void {
    if (dt > 0) {
      for (const v of vents) {
        v.timer -= dt
        if (v.timer <= 0) {
          if (v.burst <= 0) v.burst = 2 + Math.floor(rand() * 5)
          spawn(v.x + between(rand, -0.01, 0.01), tank.sand(v.x, v.z) + 0.01, v.z, between(rand, 0.004, 0.011) * size)
          v.burst--
          v.timer = v.burst > 0 ? between(rand, 0.08, 0.22) : between(rand, 1.5, 4.5)
        }
      }
      // A hand sweeping through the water drags a trail of small bubbles.
      const h = tank.hand
      if (h.active && h.y < tank.surfaceAt(h.x) - 0.03) {
        handCarry += Math.hypot(h.vx, h.vy) * dt * 14
        while (handCarry > 1) {
          handCarry--
          spawn(h.x + between(rand, -0.02, 0.02), h.y + between(rand, -0.02, 0.02), between(rand, 0.1, 0.4), between(rand, 0.003, 0.009) * size)
        }
      }
      for (let i = bubbles.length - 1; i >= 0; i--) {
        const b = bubbles[i]
        tank.flowAt(b.x, b.y, flow)
        b.wobble += dt * (5 + 30 * b.r)
        b.x += (tank.up.x * b.rise + flow.x + 0.03 * Math.sin(b.wobble)) * dt
        b.y += (tank.up.y * b.rise + 0.5 * flow.y) * dt
        if (b.y > tank.surfaceAt(b.x) - b.r) bubbles.splice(i, 1)
      }
    }
    bubbles.forEach((b, i) => data.setXYZW(i, b.x, b.y, b.z, b.r))
    geometry.instanceCount = bubbles.length
    data.needsUpdate = true
  }

  return {
    object: mesh,
    update,
    setView(camera, depth) {
      material.uniforms.uViewProj.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      material.uniforms.tDepth.value = depth
    },
    dispose() {
      quad.dispose()
      geometry.dispose()
      material.dispose()
    },
  }
}
