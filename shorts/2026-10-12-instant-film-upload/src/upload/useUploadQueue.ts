import { useCallback, useEffect, useLayoutEffect, useReducer, useRef } from 'react'
import { createPreviewUrl } from './develop/printSource'
import type { Failure, Transport, UploadCandidate, UploadItem, UploadResult } from './types'
import { validate } from './validate'

type Action =
  | { type: 'add'; items: UploadItem[] }
  | { type: 'start'; id: string }
  | { type: 'progress'; id: string; progress: number }
  | { type: 'succeed'; id: string; result: UploadResult }
  | { type: 'fail'; id: string; failure: Failure }
  | { type: 'retry'; id: string }
  | { type: 'preview'; id: string; preview: string }
  | { type: 'reveal'; id: string }
  | { type: 'file'; id: string }
  | { type: 'remove'; id: string }

function patch(items: UploadItem[], id: string, changes: Partial<UploadItem>): UploadItem[] {
  return items.map((item) => (item.id === id ? { ...item, ...changes } : item))
}

function isStaleRejection(item: UploadItem): boolean {
  return item.status === 'failed' && !item.filed && item.failure?.kind !== 'network'
}

function reducer(items: UploadItem[], action: Action): UploadItem[] {
  switch (action.type) {
    case 'add':
      // A new attempt makes earlier type and size rejections stale, so they leave the camera.
      return [...items.map((item) => (isStaleRejection(item) ? { ...item, filed: true } : item)), ...action.items]
    case 'start':
      return patch(items, action.id, { status: 'uploading', progress: 0 })
    case 'progress':
      return patch(items, action.id, { progress: action.progress })
    case 'succeed':
      // The server has the bytes now; only a failed upload keeps them for a retry.
      return patch(items, action.id, { status: 'uploaded', progress: 1, blob: undefined, result: action.result })
    case 'fail':
      return patch(items, action.id, { status: 'failed', failure: action.failure })
    case 'retry':
      return patch(items, action.id, { status: 'queued', progress: 0, failure: undefined, filed: false })
    case 'preview':
      return patch(items, action.id, { preview: action.preview })
    case 'reveal':
      return patch(items, action.id, { revealed: true })
    case 'file':
      // A failed file that is put away will not be retried, so its bytes go too.
      return items.map((item) =>
        item.id !== action.id ? item : item.status === 'failed' ? { ...item, filed: true, blob: undefined } : { ...item, filed: true },
      )
    case 'remove':
      return items.filter((item) => item.id !== action.id)
  }
}

function networkFailure(progress: number): Failure {
  return {
    kind: 'network',
    title: `Connection lost at ${Math.round(progress * 100)}%`,
    detail: 'Check your connection, then retry. The upload starts again from the beginning.',
  }
}

// A page-wide counter, because crypto.randomUUID only exists in secure contexts
// and dashboards are still served over plain http on intranets.
let lastId = 0

function toItem(candidate: UploadCandidate): UploadItem {
  const failure = validate(candidate)
  if (!failure && !candidate.blob) throw new Error(`${candidate.name} passed validation but has no bytes to upload`)
  lastId += 1
  return {
    id: `upload-${lastId}`,
    name: candidate.name,
    size: candidate.size,
    blob: candidate.blob,
    status: failure ? 'failed' : 'queued',
    progress: 0,
    failure: failure ?? undefined,
    revealed: false,
    filed: false,
  }
}

export interface UploadQueue {
  items: UploadItem[]
  add: (candidates: UploadCandidate[]) => void
  cancel: (id: string) => void
  retry: (id: string) => void
  reveal: (id: string) => void
  file: (id: string) => void
  remove: (id: string) => void
}

interface QueueOptions {
  transport: Transport
  /** Uploads in flight at once. Uppy's XHR uploader defaults to 5; 3 keeps a modest uplink responsive. */
  concurrency?: number
}

/** Uploads files in arrival order, a few at a time, and owns the object URLs of their previews. */
export function useUploadQueue({ transport, concurrency = 3 }: QueueOptions): UploadQueue {
  const [items, dispatch] = useReducer(reducer, [])
  const active = useRef(new Map<string, AbortController>())
  const previews = useRef(new Map<string, string>())
  const live = useRef(new Set<string>())

  useEffect(() => {
    for (const next of items) {
      if (active.current.size >= concurrency) break
      if (next.status !== 'queued' || !next.blob || active.current.has(next.id)) continue

      const controller = new AbortController()
      active.current.set(next.id, controller)
      let confirmed = 0
      dispatch({ type: 'start', id: next.id })

      transport(next.blob, {
        signal: controller.signal,
        onProgress: (fraction) => {
          confirmed = fraction
          dispatch({ type: 'progress', id: next.id, progress: fraction })
        },
      }).then(
        (result) => {
          active.current.delete(next.id)
          dispatch({ type: 'succeed', id: next.id, result })
        },
        () => {
          if (controller.signal.aborted) return
          active.current.delete(next.id)
          dispatch({ type: 'fail', id: next.id, failure: networkFailure(confirmed) })
        },
      )
    }
  }, [items, transport, concurrency])

  useEffect(() => {
    const controllers = active.current
    const urls = previews.current
    return () => {
      for (const controller of controllers.values()) controller.abort()
      for (const url of urls.values()) URL.revokeObjectURL(url)
    }
  }, [])

  const forgetPreview = useCallback((id: string) => {
    const url = previews.current.get(id)
    if (url) URL.revokeObjectURL(url)
    previews.current.delete(id)
  }, [])

  const add = useCallback((candidates: UploadCandidate[]) => {
    if (candidates.length === 0) return
    const added = candidates.map(toItem)
    dispatch({ type: 'add', items: added })
    for (const item of added) {
      live.current.add(item.id)
      if (item.status === 'failed' || !item.blob) continue
      createPreviewUrl(item.blob, item.name, item.size).then(
        (url) => {
          if (!url) return
          // The file may have been cancelled or removed while its preview was being made.
          if (!live.current.has(item.id)) return URL.revokeObjectURL(url)
          previews.current.set(item.id, url)
          dispatch({ type: 'preview', id: item.id, preview: url })
        },
        (error: unknown) => console.warn(`Instant film: no gallery preview for ${item.name}.`, error),
      )
    }
  }, [])

  const remove = useCallback(
    (id: string) => {
      live.current.delete(id)
      forgetPreview(id)
      dispatch({ type: 'remove', id })
    },
    [forgetPreview],
  )

  const cancel = useCallback(
    (id: string) => {
      active.current.get(id)?.abort()
      active.current.delete(id)
      remove(id)
    },
    [remove],
  )

  // Read through a ref so `file` keeps one identity; callers hold it in effect dependencies.
  const latest = useRef(items)
  useLayoutEffect(() => {
    latest.current = items
  })

  const file = useCallback(
    (id: string) => {
      // Putting away a failed file discards it, preview included.
      if (latest.current.find((item) => item.id === id)?.status === 'failed') forgetPreview(id)
      dispatch({ type: 'file', id })
    },
    [forgetPreview],
  )

  const retry = useCallback((id: string) => dispatch({ type: 'retry', id }), [])
  const reveal = useCallback((id: string) => dispatch({ type: 'reveal', id }), [])

  return { items, add, cancel, retry, reveal, file, remove }
}
