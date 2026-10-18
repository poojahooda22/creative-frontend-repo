// Everything alive in the tank, built for one layout and stepped every frame.
import * as THREE from 'three'
import { createBubbles, type BubbleLife } from './bubbles'
import { createCrabs } from './crabs'
import { createFish } from './fish'
import { createPebbles } from './pebbles'
import { createPlants } from './plants'
import type { Life, Tank } from './tank'

export type { Hand, Tank } from './tank'

export interface Aquarium {
  /** The creatures, plants and stones: drawn in the 3D pass, under the water. */
  readonly scene: THREE.Group
  /** The bubbles: drawn after the water, over the composite. */
  readonly bubbles: BubbleLife
  update(dt: number): void
  dispose(): void
}

/** The same seed for every visit and size, so the tank always looks like itself. */
const SEED = 404

export function createLife(tank: Tank, glassZ: number): Aquarium {
  const lives: Life[] = [createPebbles(tank, SEED), createPlants(tank, SEED + 1), createCrabs(tank, SEED + 2), createFish(tank, SEED + 3)]
  const scene = new THREE.Group()
  for (const life of lives) scene.add(life.object)
  const bubbles = createBubbles(tank, glassZ, SEED + 4)
  return {
    scene,
    bubbles,
    update(dt: number) {
      for (const life of lives) life.update(dt)
      bubbles.update(dt)
    },
    dispose() {
      for (const life of lives) life.dispose()
      bubbles.dispose()
    },
  }
}
