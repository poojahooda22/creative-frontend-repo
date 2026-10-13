import type { Transport, UploadResult } from './types'

export interface SimulatedNetwork {
  bytesPerSecond: number
  latencyMs: number
  /** Fail once this fraction of the file is sent, or null for a healthy connection. */
  failAt: number | null
}

const TICK_MS = 60
let stored = 0

/**
 * Stands in for a real upload endpoint so the demo runs without a server.
 * Throughput wobbles around the configured rate the way a real uplink does.
 * A production transport keeps the same contract, for example XMLHttpRequest
 * reporting `upload.onprogress`, aborting through the signal, and resolving with
 * the id the server assigned.
 */
export function createSimulatedTransport(readNetwork: () => SimulatedNetwork): Transport {
  return (blob, { onProgress, signal }) =>
    new Promise<UploadResult>((resolve, reject) => {
      const { bytesPerSecond, latencyMs, failAt } = readNetwork()
      let sent = 0
      let timer = 0

      const cleanup = () => {
        window.clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
      }
      const onAbort = () => {
        cleanup()
        reject(new DOMException('Upload cancelled', 'AbortError'))
      }
      const tick = () => {
        const wobble = 0.55 + Math.random() * 0.9
        sent = Math.min(blob.size, sent + bytesPerSecond * wobble * (TICK_MS / 1000))
        const fraction = blob.size === 0 ? 1 : sent / blob.size
        if (failAt !== null && fraction >= failAt) {
          onProgress(failAt)
          cleanup()
          reject(new Error('Network connection lost'))
          return
        }
        onProgress(fraction)
        if (fraction >= 1) {
          cleanup()
          stored += 1
          resolve({ id: `asset-${stored}` })
          return
        }
        timer = window.setTimeout(tick, TICK_MS)
      }

      if (signal.aborted) {
        onAbort()
        return
      }
      signal.addEventListener('abort', onAbort)
      timer = window.setTimeout(tick, latencyMs)
    })
}
