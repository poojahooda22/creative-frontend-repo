import { extensionOf, formatBytes, kindOf } from '../validate'

/** Cards are drawn square at this size; the print and the gallery both use them. */
export const CARD_SIZE = 640
const SOURCE_SIZE = CARD_SIZE

const UI_FONT = '"Schibsted Grotesk", ui-sans-serif, system-ui, sans-serif'
const MONO_FONT = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace'

/** A CSV becomes a contact print of its first rows, and a PDF a document card. */
export async function renderDocumentCard(blob: Blob, name: string, size: number): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas')
  canvas.width = CARD_SIZE
  canvas.height = CARD_SIZE
  const context = canvas.getContext('2d')
  if (!context) throw new Error('A 2D canvas is needed to draw the document card')
  await document.fonts.load(`600 32px ${UI_FONT}`)
  if (kindOf(name) === 'csv') drawSpreadsheet(context, name, await blob.slice(0, 16_384).text())
  else drawDocument(context, name, size)
  return canvas
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < line.length; index++) {
    const character = line[index]
    if (quoted) {
      if (character === '"' && line[index + 1] === '"') {
        cell += '"'
        index++
      } else if (character === '"') {
        quoted = false
      } else {
        cell += character
      }
    } else if (character === '"') {
      quoted = true
    } else if (character === ',') {
      cells.push(cell)
      cell = ''
    } else {
      cell += character
    }
  }
  cells.push(cell)
  return cells
}

function fitText(context: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (context.measureText(text).width <= maxWidth) return text
  let fitted = text
  while (fitted.length > 1 && context.measureText(`${fitted}…`).width > maxWidth) fitted = fitted.slice(0, -1)
  return `${fitted}…`
}

function drawSpreadsheet(context: CanvasRenderingContext2D, name: string, text: string) {
  const rows = text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .slice(0, 12)
    .map(parseCsvLine)
  const columns = Math.min(4, Math.max(1, ...rows.map((row) => row.length)))
  const margin = 44
  const columnWidth = (SOURCE_SIZE - margin * 2) / columns
  const rowHeight = 40

  context.fillStyle = '#efece4'
  context.fillRect(0, 0, SOURCE_SIZE, SOURCE_SIZE)

  context.fillStyle = '#5b6170'
  context.font = `500 22px ${UI_FONT}`
  context.textBaseline = 'alphabetic'
  context.fillText(fitText(context, name, SOURCE_SIZE - margin * 2), margin, 70)

  rows.forEach((row, rowIndex) => {
    const y = 126 + rowIndex * rowHeight
    if (rowIndex === 0) {
      context.fillStyle = '#1d2129'
      context.font = `600 23px ${UI_FONT}`
    } else {
      context.fillStyle = '#2e3440'
      context.font = `400 22px ${MONO_FONT}`
    }
    for (let column = 0; column < columns; column++) {
      const value = row[column]?.trim() ?? ''
      context.fillText(fitText(context, value, columnWidth - 14), margin + column * columnWidth, y)
    }
    context.fillStyle = rowIndex === 0 ? '#1d2129' : 'rgba(29, 33, 41, 0.14)'
    context.fillRect(margin, y + 14, SOURCE_SIZE - margin * 2, rowIndex === 0 ? 2 : 1)
  })
}

function drawDocument(context: CanvasRenderingContext2D, name: string, size: number) {
  context.fillStyle = '#d9d4c9'
  context.fillRect(0, 0, SOURCE_SIZE, SOURCE_SIZE)

  const page = { x: 132, y: 70, width: 376, height: 500 }
  context.shadowColor = 'rgba(40, 32, 20, 0.28)'
  context.shadowBlur = 28
  context.shadowOffsetY = 10
  context.fillStyle = '#fbfaf6'
  context.fillRect(page.x, page.y, page.width, page.height)
  context.shadowColor = 'transparent'

  context.fillStyle = '#1d2129'
  context.font = `600 64px ${UI_FONT}`
  context.fillText(extensionOf(name).toUpperCase(), page.x + 34, page.y + 104)

  context.fillStyle = '#2e3440'
  context.font = `500 22px ${UI_FONT}`
  context.fillText(fitText(context, name.replace(/\.[^.]+$/, ''), page.width - 68), page.x + 34, page.y + 150)

  context.fillStyle = 'rgba(29, 33, 41, 0.13)'
  const lines = [0.92, 0.84, 0.9, 0.62, 0.88, 0.8, 0.86, 0.54]
  lines.forEach((length, index) => {
    context.fillRect(page.x + 34, page.y + 200 + index * 30, (page.width - 68) * length, 10)
  })

  context.fillStyle = '#5b6170'
  context.font = `400 20px ${UI_FONT}`
  context.fillText(formatBytes(size), page.x + 34, page.y + page.height - 34)
}
