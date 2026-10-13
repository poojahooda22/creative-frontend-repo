import type { UploadItem } from '../types'
import { kindOf } from '../validate'
import { CARD_SIZE, renderDocumentCard } from './documentCard'
import type { DecodeRequest, DecodeResponse } from './decode.worker'

/** Square source the develop shader samples. Large enough for a 2x display at print size. */
export const SOURCE_SIZE = CARD_SIZE
/**
 * Width the photo is resized to before the crop. Chromium still decodes the full frame
 * first, so this bounds the bitmap kept in memory, not the decoder's peak.
 */
const DECODE_WIDTH = SOURCE_SIZE * 2

let worker: Worker | null = null
let nextRequest = 0
const pending = new Map<number, { resolve: (bitmap: ImageBitmap) => void; reject: (error: Error) => void }>()

function decoder(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('./decode.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (event: MessageEvent<DecodeResponse>) => {
    const request = pending.get(event.data.id)
    pending.delete(event.data.id)
    if (!request) return
    if ('bitmap' in event.data) request.resolve(event.data.bitmap)
    else request.reject(new Error(event.data.error))
  }
  // A worker that fails to load or crashes fails every pending decode; the next one starts fresh.
  worker.onerror = (event) => {
    event.preventDefault()
    for (const request of pending.values()) request.reject(new Error(`Photo decoder failed: ${event.message}`))
    pending.clear()
    worker?.terminate()
    worker = null
  }
  return worker
}

function decodePhoto(blob: Blob): Promise<ImageBitmap> {
  return new Promise((resolve, reject) => {
    nextRequest += 1
    pending.set(nextRequest, { resolve, reject })
    const request: DecodeRequest = { id: nextRequest, blob, decodeWidth: DECODE_WIDTH, size: SOURCE_SIZE }
    decoder().postMessage(request)
  })
}

/**
 * What the print develops into: the photo itself, a contact print of a CSV's first rows,
 * or a document card for a PDF. Null when there is nothing to show. Returned as an
 * ImageBitmap, which uploads to the GPU without a canvas readback.
 */
export async function createPrintSource(item: UploadItem): Promise<ImageBitmap | null> {
  if (!item.blob) return null
  const kind = kindOf(item.name)
  if (!kind) return null
  if (kind === 'image') return decodePhoto(item.blob)
  const card = await renderDocumentCard(item.blob, item.name, item.size)
  return createImageBitmap(card, { premultiplyAlpha: 'none' })
}

/** The gallery image: the uploaded photo itself, or the rendered card for a document. */
export async function createPreviewUrl(blob: Blob, name: string, size: number): Promise<string | null> {
  const kind = kindOf(name)
  if (!kind) return null
  if (kind === 'image') return URL.createObjectURL(blob)
  const card = await renderDocumentCard(blob, name, size)
  const png = await new Promise<Blob | null>((resolve) => card.toBlob(resolve, 'image/png'))
  if (!png) throw new Error(`Could not encode the preview card for ${name}`)
  return URL.createObjectURL(png)
}
