// Decodes a photo into the square bitmap a print develops into, off the main thread.
// In Chromium, createImageBitmap applies resize and crop on the thread that called it,
// so calling it here keeps that work away from the page's frames.

export interface DecodeRequest {
  id: number
  blob: Blob
  decodeWidth: number
  size: number
}

export type DecodeResponse = { id: number; bitmap: ImageBitmap } | { id: number; error: string }

self.onmessage = async (event: MessageEvent<DecodeRequest>) => {
  const { id, blob, decodeWidth, size } = event.data
  try {
    // premultiplyAlpha 'none' keeps transparent pixels' colour, so the shader can lay them over paper.
    const decoded = await createImageBitmap(blob, {
      resizeWidth: decodeWidth,
      resizeQuality: 'medium',
      premultiplyAlpha: 'none',
    })
    const side = Math.min(decoded.width, decoded.height)
    const bitmap = await createImageBitmap(decoded, (decoded.width - side) / 2, (decoded.height - side) / 2, side, side, {
      resizeWidth: size,
      resizeHeight: size,
      resizeQuality: 'high',
      premultiplyAlpha: 'none',
    })
    decoded.close()
    const response: DecodeResponse = { id, bitmap }
    self.postMessage(response, { transfer: [bitmap] })
  } catch (error) {
    const response: DecodeResponse = { id, error: error instanceof Error ? error.message : String(error) }
    self.postMessage(response)
  }
}
