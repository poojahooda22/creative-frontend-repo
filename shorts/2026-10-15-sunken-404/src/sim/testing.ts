// Coverage masks drawn without a canvas, for the unit tests.
import type { Mask } from './glyph'
import geist from './fixtures/geist-digits.json'

/** The page's real digits: Geist at weight 560, captured from the browser (see the fixture's note). */
export function geistMasks(): Map<string, Mask> {
  const masks = new Map<string, Mask>()
  for (const [char, g] of Object.entries(geist.glyphs)) {
    const bits = Uint8Array.from(atob(g.bits), (c) => c.charCodeAt(0))
    const data = new Float32Array(g.width * g.height)
    for (let k = 0; k < data.length; k++) data[k] = (bits[k >> 3] >> (k & 7)) & 1
    masks.set(char, { width: g.width, height: g.height, data })
  }
  return masks
}

/** A filled rectangle with a margin of empty pixels around it. */
export function boxMask(inkW: number, inkH: number, pad = 8): Mask {
  const width = inkW + 2 * pad
  const height = inkH + 2 * pad
  const data = new Float32Array(width * height)
  for (let y = pad; y < pad + inkH; y++) {
    for (let x = pad; x < pad + inkW; x++) data[y * width + x] = 1
  }
  return { width, height, data }
}

/** An elliptical ring, like a zero: outer radii rx, ry and a stroke of the given thickness. */
export function ringMask(rx: number, ry: number, stroke: number, pad = 8): Mask {
  const width = 2 * rx + 2 * pad
  const height = 2 * ry + 2 * pad
  const data = new Float32Array(width * height)
  const cx = width / 2
  const cy = height / 2
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const px = x + 0.5 - cx
      const py = y + 0.5 - cy
      const outer = (px / rx) ** 2 + (py / ry) ** 2 <= 1
      const inner = (px / (rx - stroke)) ** 2 + (py / (ry - stroke)) ** 2 <= 1
      data[y * width + x] = outer && !inner ? 1 : 0
    }
  }
  return { width, height, data }
}
