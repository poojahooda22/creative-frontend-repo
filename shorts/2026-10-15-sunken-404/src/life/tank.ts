// What the creatures can see of the tank: its size, the sand, the live water and the visitor's hand.
import type * as THREE from 'three'
import type { Layout } from '../sim/world'

export interface Vec2 {
  x: number
  y: number
}

export interface Hand {
  x: number
  y: number
  vx: number
  vy: number
  /** In the view and stirring (not holding a digit). */
  active: boolean
}

export interface Tank {
  layout: Layout
  /** Sand height at (x, z). */
  sand(x: number, z: number): number
  /** Water surface height at x, from the latest physics state. */
  surfaceAt(x: number): number
  /** Water velocity at (x, y), from the latest physics state (the 2D flow, the same at every z). */
  flowAt(x: number, y: number, out: Vec2): void
  hand: Hand
  /** Straight up through the water, unit length: (0, 1) unless the phone is tilted. Bubbles rise along it, seaweed reaches along it. */
  up: Vec2
  /**
   * Creature size against the wide layout (1 there, less in a narrow tank), so a phone's tank is
   * not crowded by fish sized for a desktop.
   */
  scale: number
  /** Shared uniforms the creature materials read: the surface profile and the clock. */
  uniforms: {
    tSurface: THREE.IUniform<THREE.Texture>
    uColumns: THREE.IUniform<number>
    uCell: THREE.IUniform<number>
    uTime: THREE.IUniform<number>
  }
}

/** One kind of life in the tank. \`update\` runs every frame with the step in seconds (0 when still). */
export interface Life {
  readonly object: THREE.Object3D
  update(dt: number): void
  dispose(): void
}

/** The near and far edges of where swimmers stay, in z: clear of the digits' slab around z = 0. */
export const LANES = {
  front: { min: 0.18, max: 0.38 },
  back: { min: -0.85, max: -0.24 },
} as const
