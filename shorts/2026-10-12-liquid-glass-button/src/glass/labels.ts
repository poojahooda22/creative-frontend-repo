/**
 * Pill proportions measured from the reference at rest, in world units where a lobe radius is 0.5.
 * Reading left to right: padding, word, gap, divider, gap, arrow, padding.
 */
export const PILL = {
  radius: 0.5,
  padLeft: 0.52,
  gapToDivider: 0.32,
  gapToArrow: 0.25,
  arrowWidth: 0.26,
  padRight: 0.46,
  capHeight: 0.185,
  dividerHalfHeight: 0.24,
} as const

export const LABEL_FONT = '"Geist Variable", "Geist", ui-sans-serif, system-ui, sans-serif'
const FONT_WEIGHT = 580
const FONT_PX = 220
const CELL_PX = 384
const ATLAS_WIDTH = 2048
// Room around each glyph run: inside a drop the label is sampled about three mip levels blurrier,
// and the haze must fade out inside its own cell rather than stop at the cell edge.
const PAD_PX = 96

/** Atlas rectangle in texture space (v grows downward, row 0 at v = 0) plus its size in world units. */
export interface AtlasCell {
  u: number
  v: number
  du: number
  dv: number
  width: number
  height: number
}

export interface LabelLayout {
  text: string
  /** Distance from the pill centre to each lobe centre at rest. */
  halfLength: number
  /** Width of the word itself in world units, without the atlas padding. */
  wordWidth: number
  /** Word, divider and arrow centres along x at rest, relative to the pill centre. */
  wordX: number
  dividerX: number
  arrowX: number
  word: AtlasCell
}

export interface LabelAtlas {
  /** Single-channel coverage, row 0 at the top. Kept so the texture can be rebuilt after context loss. */
  coverage: Uint8Array
  width: number
  height: number
  labels: LabelLayout[]
  arrow: AtlasCell
  /** World size of one texel, for choosing a mip level in the shader. */
  texelWorld: number
}

export function fontSpec(): string {
  return `${FONT_WEIGHT} ${FONT_PX}px ${LABEL_FONT}`
}

/**
 * Draws every label and the arrow once into a single-channel atlas. The words are white on
 * black, so the red channel is coverage and the shader picks the ink colour.
 */
export function buildLabelAtlas(texts: readonly string[]): LabelAtlas {
  if (texts.length === 0) throw new Error('buildLabelAtlas: at least one label is required')
  const rows = texts.length + 1
  const height = rows * CELL_PX
  const canvas = document.createElement('canvas')
  canvas.width = ATLAS_WIDTH
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('buildLabelAtlas: 2D canvas is unavailable')

  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, ATLAS_WIDTH, height)
  ctx.fillStyle = '#fff'
  ctx.strokeStyle = '#fff'
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  ctx.font = fontSpec()

  const capPx = ctx.measureText('E').actualBoundingBoxAscent
  if (!(capPx > 0)) throw new Error('buildLabelAtlas: could not measure the cap height')
  const worldPerPx = PILL.capHeight / capPx
  const cellWorld = CELL_PX * worldPerPx

  const labels = texts.map((text, row) => {
    const top = row * CELL_PX
    const measured = ctx.measureText(text).width
    // A label too long for the atlas is drawn narrower rather than clipped.
    const fit = Math.min(1, (ATLAS_WIDTH - 2 * PAD_PX) / measured)
    const runPx = measured * fit
    ctx.save()
    ctx.translate(PAD_PX, top + CELL_PX / 2 + capPx / 2)
    ctx.scale(fit, 1)
    ctx.fillText(text, 0, 0)
    ctx.restore()

    const cellPx = runPx + 2 * PAD_PX
    const word: AtlasCell = {
      u: 0,
      v: top / height,
      du: cellPx / ATLAS_WIDTH,
      dv: CELL_PX / height,
      width: cellPx * worldPerPx,
      height: cellWorld,
    }
    const wordWidth = runPx * worldPerPx
    const outer = PILL.padLeft + wordWidth + PILL.gapToDivider + PILL.gapToArrow + PILL.arrowWidth + PILL.padRight
    const halfOuter = outer / 2
    const wordX = -halfOuter + PILL.padLeft + wordWidth / 2
    const dividerX = -halfOuter + PILL.padLeft + wordWidth + PILL.gapToDivider
    const arrowX = halfOuter - PILL.padRight - PILL.arrowWidth / 2
    return { text, halfLength: halfOuter - PILL.radius, wordWidth, wordX, dividerX, arrowX, word }
  })

  const arrow = drawArrow(ctx, (rows - 1) * CELL_PX, worldPerPx, height, cellWorld)

  const image = ctx.getImageData(0, 0, ATLAS_WIDTH, height).data
  const coverage = new Uint8Array(ATLAS_WIDTH * height)
  for (let i = 0; i < coverage.length; i++) coverage[i] = image[i * 4]

  return { coverage, width: ATLAS_WIDTH, height, labels, arrow, texelWorld: worldPerPx }
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  top: number,
  worldPerPx: number,
  atlasHeight: number,
  cellWorld: number,
): AtlasCell {
  const lengthPx = PILL.arrowWidth / worldPerPx
  const stroke = FONT_PX * 0.085
  const head = lengthPx * 0.4
  const cellPx = lengthPx + 2 * PAD_PX
  const cx = cellPx / 2
  const cy = top + CELL_PX / 2
  const x0 = cx - lengthPx / 2 + stroke / 2
  const x1 = cx + lengthPx / 2 - stroke / 2

  ctx.save()
  ctx.lineWidth = stroke
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(x0, cy)
  ctx.lineTo(x1, cy)
  ctx.moveTo(x1 - head * Math.SQRT1_2, cy - head * Math.SQRT1_2)
  ctx.lineTo(x1, cy)
  ctx.lineTo(x1 - head * Math.SQRT1_2, cy + head * Math.SQRT1_2)
  ctx.stroke()
  ctx.restore()

  return {
    u: 0,
    v: top / atlasHeight,
    du: cellPx / ATLAS_WIDTH,
    dv: CELL_PX / atlasHeight,
    width: cellPx * worldPerPx,
    height: cellWorld,
  }
}
