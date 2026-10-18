// Small additions to three's standard material, so the creatures get its lighting, environment and
// instancing and only add their own motion and paint.
import type * as THREE from 'three'
import surfaceGlsl from '../shaders/surface.glsl'
import waterGlsl from '../shaders/water.glsl'

export interface Patch {
  /** Materials with the same key share one compiled program. */
  key: string
  uniforms?: Record<string, THREE.IUniform>
  /** Declarations for the vertex shader: attributes, uniforms, varyings, functions. */
  vertexHead?: string
  /** Runs once \`transformed\` holds the vertex in model space: bend or move it there. */
  vertex?: string
  /** Runs once \`objectNormal\` holds the normal in model space. */
  normal?: string
  /** Declarations for the fragment shader. */
  fragmentHead?: string
  /** Runs once \`diffuseColor\` is set: paint the surface. */
  color?: string
  /** Runs just before the colour is written: adjust \`outgoingLight\`. */
  output?: string
}

function insertAfter(source: string, include: string, code: string | undefined): string {
  if (!code) return source
  const marker = `#include <${include}>`
  if (!source.includes(marker)) throw new Error(`patch: ${marker} not found`)
  return source.replace(marker, `${marker}\n${code}`)
}

function insertBefore(source: string, include: string, code: string | undefined): string {
  if (!code) return source
  const marker = `#include <${include}>`
  if (!source.includes(marker)) throw new Error(`patch: ${marker} not found`)
  return source.replace(marker, `${code}\n${marker}`)
}

export function patchMaterial<T extends THREE.Material>(material: T, patch: Patch): T {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, patch.uniforms)
    let v = shader.vertexShader
    v = insertAfter(v, 'common', patch.vertexHead)
    v = insertAfter(v, 'begin_vertex', patch.vertex)
    v = insertAfter(v, 'beginnormal_vertex', patch.normal)
    shader.vertexShader = v
    let f = shader.fragmentShader
    f = insertAfter(f, 'common', patch.fragmentHead)
    f = insertAfter(f, 'color_fragment', patch.color)
    f = insertBefore(f, 'opaque_fragment', patch.output)
    shader.fragmentShader = f
  }
  material.customProgramCacheKey = () => patch.key
  return material
}

/**
 * Pieces for a creature that stays vivid under water (see VIVID in water.glsl): the world position
 * as a varying, and an output step that gives back part of the light the composite will take for
 * depth. Needs the shared surface uniforms (tSurface, uColumns, uCell) in the patch's uniforms.
 */
export const vivid = {
  vertexHead: 'varying vec3 vSeaWorld;',
  // Append to the patch's vertex step, after the creature's own bend.
  vertexWorld: `
vec4 seaWorld = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
  seaWorld = instanceMatrix * seaWorld;
#endif
vSeaWorld = (modelMatrix * seaWorld).xyz;`,
  fragmentHead: `varying vec3 vSeaWorld;\n${surfaceGlsl}\n${waterGlsl}`,
  output: 'outgoingLight *= exp(LIGHT_LOSS * VIVID * max(surfaceAtX(vSeaWorld.x) - vSeaWorld.y, 0.0));',
}
