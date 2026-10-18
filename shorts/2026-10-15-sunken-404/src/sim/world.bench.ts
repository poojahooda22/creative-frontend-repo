// Physics cost per 60 Hz step at the desktop and phone layouts: `pnpm bench`. A benchmark, not a
// test: wall-clock time depends on the machine, and a phone runs these two to three times slower.
import { test } from 'vitest'
import { layoutFor, World } from './world'
import { geistMasks } from './testing'

function settled(w: number, h: number): World {
  const world = new World(layoutFor(w, h), geistMasks(), ['4', '0', '4'])
  world.settle(1)
  return world
}

test('one physics step', async ({ bench }) => {
  const desktop = settled(1920, 1080)
  const phone = settled(390, 844)
  await bench.compare(
    bench(`desktop, ${desktop.fluid.numParticles} particles`, () => desktop.settle(1 / 60)),
    bench(`phone, ${phone.fluid.numParticles} particles`, () => phone.settle(1 / 60)),
  )
}, 120000)
