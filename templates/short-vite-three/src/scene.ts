import * as THREE from 'three'
import type { SceneHandle, Stage } from './stage'
import vertexShader from './shaders/quad.vert'
import fragmentShader from './shaders/quad.frag'

// Starting point: a full-screen shader. Replace this file with the short's concept.
export function createScene(stage: Stage): SceneHandle {
  const scene = new THREE.Scene()
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const uniforms = {
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
  }
  const geometry = new THREE.PlaneGeometry(2, 2)
  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader,
    fragmentShader,
    uniforms,
  })
  scene.add(new THREE.Mesh(geometry, material))

  return {
    scene,
    camera,
    update({ time }) {
      uniforms.uTime.value = time
    },
    resize(width, height) {
      const pixelRatio = stage.renderer.getPixelRatio()
      uniforms.uResolution.value.set(width * pixelRatio, height * pixelRatio)
    },
    dispose() {
      geometry.dispose()
      material.dispose()
    },
  }
}
