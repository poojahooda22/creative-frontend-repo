// The page's side of a glyph: drawing it with the loaded font. The physics worker has no fonts and
// no document, so the page rasterizes and sends the coverage masks.
import type { Mask } from '../sim/glyph'

/** Draws one character with the page's font and returns its coverage mask (browser only). */
export function rasterizeGlyph(char: string, family: string, weight: number, pixelHeight: number): Mask {
  const pad = Math.ceil(pixelHeight * 0.12)
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('rasterizeGlyph: no 2D context')
  const font = `${weight} ${pixelHeight}px ${family}`
  ctx.font = font
  const metrics = ctx.measureText(char)
  const inkW = Math.ceil(metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight)
  const inkH = Math.ceil(metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent)
  canvas.width = inkW + 2 * pad
  canvas.height = inkH + 2 * pad
  // Resizing the canvas resets its state, font included.
  ctx.font = font
  ctx.fillStyle = '#fff'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(char, pad + metrics.actualBoundingBoxLeft, pad + metrics.actualBoundingBoxAscent)
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const data = new Float32Array(canvas.width * canvas.height)
  for (let i = 0; i < data.length; i++) data[i] = image.data[4 * i + 3] / 255
  return { width: canvas.width, height: canvas.height, data }
}
