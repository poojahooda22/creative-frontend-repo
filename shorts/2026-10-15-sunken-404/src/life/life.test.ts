import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { layoutFor } from '../sim/world'
import { createBubbles } from './bubbles'
import { createCrabs } from './crabs'
import { createFish } from './fish'
import { createPlants } from './plants'
import { LANES, type Tank, type Vec2 } from './tank'

const STEP = 1 / 60

/** A still tank: flat sand, a flat surface, an optional uniform current. */
function tank(w = 1920, h = 1080, flow: Vec2 = { x: 0, y: 0 }): Tank {
  const layout = layoutFor(w, h)
  const surface = layout.waterLevel - 0.06
  return {
    layout,
    sand: () => layout.floorBase,
    surfaceAt: () => surface,
    flowAt: (_x, _y, out) => {
      out.x = flow.x
      out.y = flow.y
    },
    hand: { x: 0, y: 0, vx: 0, vy: 0, active: false },
    up: { x: 0, y: 1 },
    scale: Math.min(1, Math.max(0.55, layout.digitHeight / (0.28 * layout.height))),
    uniforms: { tSurface: { value: new THREE.Texture() }, uColumns: { value: 1 }, uCell: { value: 1 }, uTime: { value: 0 } },
  }
}

function positions(mesh: THREE.InstancedMesh): THREE.Vector3[] {
  const m = new THREE.Matrix4()
  return Array.from({ length: mesh.count }, (_, i) => {
    mesh.getMatrixAt(i, m)
    return new THREE.Vector3().setFromMatrixPosition(m)
  })
}

function run(update: (dt: number) => void, seconds: number, each?: () => void): void {
  for (let t = 0; t < seconds; t += STEP) {
    each?.()
    update(STEP)
  }
}

describe('fish', () => {
  it('stay in the water, inside the glass and in their lanes, at desktop and phone sizes', () => {
    for (const [w, h] of [
      [1920, 1080],
      [390, 844],
    ]) {
      const t = tank(w, h)
      const fish = createFish(t, 1)
      const mesh = fish.object as THREE.InstancedMesh
      let worst = 0
      run(fish.update, 40, () => {
        for (const p of positions(mesh)) {
          // A soft boundary: allow a fraction of a fish length of overshoot while it turns back.
          const out = Math.max(p.y - t.surfaceAt(p.x), t.layout.floorBase - p.y, -p.x, p.x - t.layout.width, LANES.back.min - 0.1 - p.z, p.z - LANES.front.max - 0.1)
          worst = Math.max(worst, out)
        }
      })
      expect(worst).toBeLessThan(0.02)
      fish.dispose()
    }
  })

  // Troughs pass faster than a fish can dive: a wave twice a fish length high sweeping the tank
  // every second, and the whole surface dropping by half the depth (a tilt draining that side).
  // Every corner of every fish's box, as drawn, must stay under the surface, not just its centre.
  it('never leave the water, even when the surface drops out from under them', () => {
    const t = tank(1440, 900)
    const L = t.layout
    const level = L.waterLevel - 0.06
    let time = 0
    const depthDrop = () => 0.5 * (L.waterLevel - L.floorBase) * Math.min(1, Math.max(0, time - 4) / 0.5)
    t.surfaceAt = (x) => level - depthDrop() + 0.15 * Math.sin((2 * Math.PI * x) / 1.5 - 2 * Math.PI * time)
    const fish = createFish(t, 5)
    const mesh = fish.object as THREE.InstancedMesh
    let worst = -Infinity
    run(
      (dt) => {
        time += dt
        fish.update(dt)
      },
      8,
      () => {
        // From the first swim on: at birth the fish only stand where they were placed.
        if (time === 0) return
        const box = mesh.geometry.boundingBox
        if (!box) throw new Error('fish geometry without bounds')
        const m = new THREE.Matrix4()
        const c = new THREE.Vector3()
        for (let i = 0; i < mesh.count; i++) {
          mesh.getMatrixAt(i, m)
          for (let k = 0; k < 8; k++) {
            c.set(k & 1 ? box.max.x : box.min.x, k & 2 ? box.max.y : box.min.y, k & 4 ? box.max.z : box.min.z).applyMatrix4(m)
            worst = Math.max(worst, c.y - t.surfaceAt(c.x))
          }
        }
      },
    )
    expect(worst).toBeLessThan(0)
    fish.dispose()
  })

  // Against fish biomechanics (see the notes in fish.ts): cruising at about 1 to 2 body lengths per
  // second and rarely still, tail beats at a Strouhal number near 0.3 (2 to 4 Hz at these
  // speeds), schools a body length apart and wider than tall, courses that curve rather than zigzag.
  it('swim the way fish do: speed, tail beat, schooling and turning', () => {
    const t = tank(1440, 900)
    const fish = createFish(t, 3)
    const mesh = fish.object as THREE.InstancedMesh
    const swim = mesh.geometry.getAttribute('iSwim')
    const look = mesh.geometry.getAttribute('iLook')
    const m = new THREE.Matrix4()
    const pos = new THREE.Vector3()
    const rot = new THREE.Quaternion()
    const size = new THREE.Vector3()
    const sample = () =>
      Array.from({ length: mesh.count }, (_, i) => {
        mesh.getMatrixAt(i, m)
        m.decompose(pos, rot, size)
        return { x: pos.x, y: pos.y, z: pos.z, length: size.x, phase: swim.getX(i), arc: swim.getZ(i), minnow: look.getX(i) === 2, school: look.getW(i) }
      })
    run(fish.update, 2)
    let before = sample()
    const speeds: number[] = []
    const beats: number[] = []
    const spacing: number[] = []
    let wide = 0
    let tall = 0
    let reversals = 0
    const lastArc = before.map((b) => b.arc)
    const seconds = 30
    run(fish.update, seconds, () => {
      const now = sample()
      now.forEach((c, i) => {
        const b = before[i]
        speeds.push(Math.hypot(c.x - b.x, c.y - b.y, c.z - b.z) / STEP / c.length)
        beats.push((c.phase - b.phase) / (2 * Math.PI * STEP))
        // A visible change of turning direction: more than about 17 degrees a second either way.
        if (Math.abs(c.arc) > 0.05) {
          if (Math.sign(c.arc) !== Math.sign(lastArc[i]) && Math.abs(lastArc[i]) > 0.05) reversals++
          lastArc[i] = c.arc
        }
      })
      const school = now.filter((c) => c.minnow && c.school === now.filter((o) => o.minnow)[0].school)
      for (const a of school) spacing.push(Math.min(...school.filter((o) => o !== a).map((o) => Math.hypot(a.x - o.x, a.y - o.y, a.z - o.z))) / a.length)
      wide += Math.max(...school.map((c) => c.x)) - Math.min(...school.map((c) => c.x))
      tall += Math.max(...school.map((c) => c.y)) - Math.min(...school.map((c) => c.y))
      before = now
    })
    const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]
    expect(median(speeds)).toBeGreaterThan(1)
    expect(median(speeds)).toBeLessThan(2.5)
    expect(speeds.filter((v) => v < 0.3).length / speeds.length).toBeLessThan(0.05)
    expect(median(beats)).toBeGreaterThan(2)
    expect(median(beats)).toBeLessThan(4)
    expect(median(spacing)).toBeGreaterThan(0.5)
    expect(median(spacing)).toBeLessThan(1.5)
    expect(wide / tall).toBeGreaterThan(1.5)
    expect(reversals / mesh.count / seconds).toBeLessThan(1.5)
    fish.dispose()
  }, 60000)

  it('dart away from a hand stirring through them', () => {
    const t = tank()
    const fish = createFish(t, 2)
    const mesh = fish.object as THREE.InstancedMesh
    run(fish.update, 2)
    const target = positions(mesh)[0]
    const nearest = (at: THREE.Vector3) => Math.min(...positions(mesh).map((p) => Math.hypot(p.x - at.x, p.y - at.y)))
    const hand = { x: target.x, y: target.y }
    const before = nearest(target)
    t.hand.active = true
    run(fish.update, 0.6, () => {
      t.hand.x = hand.x
      t.hand.y = hand.y
      t.hand.vx = 2
      t.hand.vy = 0
    })
    expect(nearest(new THREE.Vector3(hand.x, hand.y, 0))).toBeGreaterThan(before + 0.1)
    fish.dispose()
  })
})

describe('crabs', () => {
  it('stay on the sand in the tank, and raise their claws at a slow hand nearby', () => {
    const t = tank()
    const crabs = createCrabs(t, 3)
    const group = crabs.object as THREE.Group
    run(crabs.update, 30, () => {
      for (const c of group.children) {
        expect(c.position.x).toBeGreaterThan(0)
        expect(c.position.x).toBeLessThan(t.layout.width)
        expect(Math.abs(c.position.y - t.layout.floorBase)).toBeLessThan(0.01)
      }
    })
    // The claw and pinch reach the shader through the material's patch: compile it against three's
    // own standard shader to get hold of the live uniforms.
    const crab = group.children[0] as THREE.Mesh
    const shader = { uniforms: {} as Record<string, THREE.IUniform<number>>, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader }
    // The patch reads only the shader sources and uniforms, never the renderer or the other
    // compile parameters, so a minimal stand-in is enough here.
    ;(crab.material as THREE.Material).onBeforeCompile(shader as never, null as never)
    t.hand.active = true
    run(crabs.update, 1.5, () => {
      t.hand.x = crab.position.x + 0.05
      t.hand.y = t.layout.floorBase + 0.15
      t.hand.vx = 0.1
      t.hand.vy = 0
    })
    expect(shader.uniforms.uClaw.value).toBeGreaterThan(0.6)
    expect(shader.uniforms.uSnap.value).toBeGreaterThan(0.6)
    crabs.dispose()
  })
})

describe('seaweed', () => {
  it('bends with a current and stands back up when it stops', () => {
    const flow = { x: 0.8, y: 0 }
    const t = tank(1920, 1080, flow)
    const plants = createPlants(t, 4)
    const meshes = (plants.object as THREE.Group).children as THREE.InstancedMesh[]
    const bend = () => Math.max(...meshes.map((m) => Math.abs(m.geometry.getAttribute('iSway').getX(0))))
    run(plants.update, 3)
    const bent = bend()
    expect(bent).toBeGreaterThan(0.3)
    expect(bent).toBeLessThanOrEqual(0.7 + 1e-6)
    flow.x = 0
    run(plants.update, 4)
    expect(bend()).toBeLessThan(0.05)
    plants.dispose()
  })
})

describe('bubbles', () => {
  it('rise from the sand and pop at the surface, never more than the buffer holds', () => {
    const t = tank()
    const bubbles = createBubbles(t, 0.5, 5)
    const geometry = (bubbles.object as THREE.Mesh).geometry as THREE.InstancedBufferGeometry
    let seen = 0
    run(bubbles.update, 20, () => {
      seen = Math.max(seen, geometry.instanceCount)
      const data = geometry.getAttribute('iBubble')
      for (let i = 0; i < geometry.instanceCount; i++) expect(data.getY(i)).toBeLessThan(t.surfaceAt(0))
    })
    expect(seen).toBeGreaterThan(0)
    expect(seen).toBeLessThanOrEqual(96)
    bubbles.dispose()
  })
})
