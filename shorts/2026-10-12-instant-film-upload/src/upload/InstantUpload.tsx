import { useEffect, useRef, useState, type ChangeEvent, type DragEvent as ReactDragEvent } from 'react'
import { DevelopingPrint } from './develop/DevelopingPrint'
import { disposeSparePrintSurface, warmPrintSurface } from './develop/surfacePool'
import type { UploadCandidate, UploadItem } from './types'
import { UploadStatus, type DragState } from './UploadStatus'
import type { UploadQueue } from './useUploadQueue'
import { ACCEPT_ATTRIBUTE, mimeMightBeAccepted } from './validate'
import './instant-upload.css'

type Light = 'idle' | 'ready' | 'invalid' | 'busy' | 'done' | 'error'

/** How long a developed print rests in the camera before it is filed, alone and with files waiting. */
const REST_MS = 1100
const HURRIED_REST_MS = 250

function toCandidates(files: FileList): UploadCandidate[] {
  return Array.from(files, (file) => ({ name: file.name, size: file.size, type: file.type, blob: file }))
}

function carriesFiles(transfer: DataTransfer | null): boolean {
  return Array.from(transfer?.types ?? []).includes('Files')
}

function onlyUnsupported(transfer: DataTransfer | null): boolean {
  const files = Array.from(transfer?.items ?? []).filter((item) => item.kind === 'file')
  return files.length > 0 && files.every((item) => !mimeMightBeAccepted(item.type))
}

/**
 * Which print occupies the camera: the oldest file still uploading or not yet filed, so a
 * print keeps the camera through its develop and its rest. Failures only take an idle camera.
 */
function pickStaged(items: UploadItem[]): UploadItem | undefined {
  const inFlight = items.find((item) => !item.filed && (item.status === 'uploading' || item.status === 'uploaded'))
  if (inFlight) return inFlight
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index]
    if (!item.filed && item.status === 'failed') return item
  }
  return items.find((item) => item.status === 'queued')
}

function lightFor(drag: DragState, staged: UploadItem | undefined): Light {
  if (drag === 'invalid') return 'invalid'
  if (drag !== 'none') return 'ready'
  if (!staged) return 'idle'
  if (staged.status === 'failed') return 'error'
  if (staged.status === 'uploaded') return 'done'
  return 'busy'
}

function listNames(items: UploadItem[]): string {
  return items.map((item) => item.name).join(', ')
}

interface InstantUploadProps {
  queue: UploadQueue
  reducedMotion: boolean
  /** Where each print stood when it left the camera, so the gallery can bring it in from there. */
  origins: Map<string, DOMRect>
  /**
   * Accept files dropped anywhere on the page, not only on the camera. Leave it off when
   * the host page has other drop targets; a drop another handler claimed is never taken.
   */
  acceptDropsAnywhere?: boolean
}

export function InstantUpload({ queue, reducedMotion, origins, acceptDropsAnywhere = false }: InstantUploadProps) {
  const { items, add, cancel, retry, reveal, file } = queue
  const inputRef = useRef<HTMLInputElement>(null)
  const bayRef = useRef<HTMLDivElement>(null)
  const addRef = useRef<HTMLButtonElement>(null)
  const lastFocused = useRef<HTMLElement | null>(null)
  const dragDepth = useRef(0)
  const announced = useRef(new Set<string>())
  const [drag, setDrag] = useState<DragState>('none')
  const [politeMessage, setPoliteMessage] = useState('')
  const [alertMessage, setAlertMessage] = useState('')

  // Sticky: the print in the camera keeps it until it is filed, even if an older file is retried.
  const holder = useRef<string | undefined>(undefined)
  const staged =
    items.find((item) => item.id === holder.current && !item.filed && (item.status === 'uploading' || item.status === 'uploaded')) ??
    pickStaged(items)
  useEffect(() => {
    holder.current = staged?.id
  })
  const behind = items.filter((item) => item.id !== staged?.id && (item.status === 'queued' || item.status === 'uploading'))
  const hurried = behind.length > 0
  const otherProblems = items.filter((item) => item.status === 'failed' && !item.filed && item.id !== staged?.id)

  // Prepare the GPU surface while the page is idle, and release it when the uploader goes away.
  useEffect(() => {
    const cancelWarmUp = warmPrintSurface()
    return () => {
      cancelWarmUp()
      disposeSparePrintSurface()
    }
  }, [])

  useEffect(() => {
    const reset = () => {
      dragDepth.current = 0
      setDrag('none')
    }
    const onEnter = (event: DragEvent) => {
      if (!carriesFiles(event.dataTransfer)) return
      dragDepth.current += 1
      setDrag((current) => (current === 'none' ? 'page' : current))
    }
    const onLeave = (event: DragEvent) => {
      if (!carriesFiles(event.dataTransfer)) return
      dragDepth.current = Math.max(0, dragDepth.current - 1)
      if (dragDepth.current === 0) reset()
    }
    // Capture phase, so a drop zone elsewhere that stops propagation cannot leave the camera armed.
    const onDropCapture = (event: DragEvent) => {
      if (carriesFiles(event.dataTransfer)) reset()
    }
    // A missed drop must never open the file in the tab. Drops another handler claimed are left alone.
    const onOver = (event: DragEvent) => {
      if (!carriesFiles(event.dataTransfer) || event.defaultPrevented) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = acceptDropsAnywhere ? 'copy' : 'none'
    }
    const onDrop = (event: DragEvent) => {
      if (!carriesFiles(event.dataTransfer) || event.defaultPrevented) return
      event.preventDefault()
      if (acceptDropsAnywhere && event.dataTransfer && event.dataTransfer.files.length > 0) {
        add(toCandidates(event.dataTransfer.files))
      }
    }
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target
      if (event.defaultPrevented) return
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select'))) return
      const files = event.clipboardData?.files
      if (!files || files.length === 0) return
      event.preventDefault()
      add(toCandidates(files))
    }
    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('drop', onDropCapture, true)
    window.addEventListener('dragover', onOver)
    window.addEventListener('drop', onDrop)
    window.addEventListener('paste', onPaste)
    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('drop', onDropCapture, true)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('drop', onDrop)
      window.removeEventListener('paste', onPaste)
    }
  }, [add, acceptDropsAnywhere])

  // A developed print rests for a moment, then is filed from exactly where it stands.
  const stagedId = staged?.id
  const stagedResting = staged?.status === 'uploaded' && staged.revealed
  useEffect(() => {
    if (!stagedId || !stagedResting) return
    const timer = window.setTimeout(
      () => {
        const print = bayRef.current?.querySelector('.print')
        if (print) origins.set(stagedId, print.getBoundingClientRect())
        file(stagedId)
      },
      hurried ? HURRIED_REST_MS : REST_MS,
    )
    return () => window.clearTimeout(timer)
  }, [stagedId, stagedResting, hurried, file, origins])

  // Files that finish while another print holds the camera go straight to the gallery,
  // so a batch moves at the speed of the network, not of the develop.
  useEffect(() => {
    for (const item of items) {
      if (item.status === 'uploaded' && !item.filed && item.id !== stagedId) file(item.id)
    }
  }, [items, stagedId, file])

  // Every outcome reaches assistive technology through two regions that are always present.
  useEffect(() => {
    const fresh = (status: UploadItem['status']) =>
      items.filter((item) => item.status === status && !announced.current.has(`${status}:${item.id}`))
    const started = fresh('uploading')
    const finished = fresh('uploaded')
    const failed = fresh('failed')
    for (const item of [...started, ...finished, ...failed]) announced.current.add(`${item.status}:${item.id}`)
    // A retry starts the cycle again, so its earlier outcome may be announced afresh.
    for (const item of started) {
      announced.current.delete(`failed:${item.id}`)
      announced.current.delete(`uploaded:${item.id}`)
    }

    const polite: string[] = []
    if (started.length === 1) polite.push(`Uploading ${started[0].name}`)
    if (started.length > 1) polite.push(`Uploading ${started.length} files`)
    if (finished.length === 1) polite.push(`${finished[0].name} uploaded`)
    if (finished.length > 1) polite.push(`${finished.length} files uploaded: ${listNames(finished)}`)
    if (polite.length > 0) setPoliteMessage(polite.join('. '))

    if (failed.length === 1 && failed[0].failure) setAlertMessage(`${failed[0].failure.title}. ${failed[0].failure.detail}`)
    if (failed.length > 1) setAlertMessage(`${failed.length} files weren't uploaded: ${listNames(failed)}.`)
  }, [items])

  // If the focused button disappears with a state change, keep keyboard focus in the camera.
  useEffect(() => {
    const previous = lastFocused.current
    if (previous && !previous.isConnected && (document.activeElement === document.body || document.activeElement === null)) {
      addRef.current?.focus()
    }
  })

  const browse = () => inputRef.current?.click()
  const onInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) add(toCandidates(event.target.files))
    event.target.value = ''
  }
  const onCameraDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!carriesFiles(event.dataTransfer)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    const next = onlyUnsupported(event.dataTransfer) ? 'invalid' : 'over'
    setDrag((current) => (current === next ? current : next))
  }
  const onCameraDragLeave = (event: ReactDragEvent<HTMLDivElement>) => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
    setDrag((current) => (current === 'over' || current === 'invalid' ? 'page' : current))
  }
  const onCameraDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!carriesFiles(event.dataTransfer)) return
    event.preventDefault()
    if (event.dataTransfer.files.length > 0) add(toCandidates(event.dataTransfer.files))
  }

  const rejected = staged?.status === 'failed' && staged.failure?.kind !== 'network'
  const addLabel = !staged ? 'Choose files' : rejected ? 'Choose another file' : 'Add files'
  const addIsPrimary = !staged || rejected

  return (
    <section className="instant" aria-label="Upload files">
      <div
        className="camera"
        data-drag={drag}
        data-light={lightFor(drag, staged)}
        onDragOver={onCameraDragOver}
        onDragLeave={onCameraDragLeave}
        onDrop={onCameraDrop}
      >
        <div className="camera__head" aria-hidden="true">
          <span className="camera__slot" />
        </div>
        <div className="camera__bay" ref={bayRef}>
          {staged ? (
            <DevelopingPrint key={staged.id} item={staged} hurried={hurried} reducedMotion={reducedMotion} onRevealed={reveal} />
          ) : (
            <div className="camera__ghost" aria-hidden="true">
              <span className="camera__peek" />
            </div>
          )}
        </div>
        <div className="camera__readout">
          <span className="camera__led" aria-hidden="true" />
          <UploadStatus drag={drag} acceptsPageDrops={acceptDropsAnywhere} staged={staged} inProgress={behind.length} />
          {/* Keyed so React never turns one button into another under the user's focus. */}
          <div
            className="camera__actions"
            onFocus={(event) => {
              lastFocused.current = event.target
            }}
            onBlur={(event) => {
              if (event.relatedTarget) lastFocused.current = null
            }}
          >
            {staged?.status === 'uploading' && (
              <button key="cancel" type="button" className="button" onClick={() => cancel(staged.id)}>
                Cancel
              </button>
            )}
            {staged?.status === 'failed' && staged.failure?.kind === 'network' && (
              <>
                <button key="retry" type="button" className="button button--primary" onClick={() => retry(staged.id)}>
                  Retry
                </button>
                <button key="discard" type="button" className="button" onClick={() => file(staged.id)}>
                  Discard
                </button>
              </>
            )}
            <button
              key="add"
              ref={addRef}
              type="button"
              className={addIsPrimary ? 'button button--primary' : 'button'}
              onClick={browse}
            >
              {addLabel}
            </button>
            {rejected && staged && (
              <button key="dismiss" type="button" className="button" onClick={() => file(staged.id)}>
                Dismiss
              </button>
            )}
          </div>
        </div>
        {otherProblems.length > 0 && (
          <ul className="camera__problems" aria-label="Files that were not uploaded">
            {otherProblems.map((item) => (
              <li key={item.id}>
                <span>
                  <strong>{item.name}</strong> {item.failure?.detail}
                </span>
                <span className="camera__problem-actions">
                  {item.failure?.kind === 'network' && (
                    <button type="button" className="button button--quiet" onClick={() => retry(item.id)}>
                      Retry
                    </button>
                  )}
                  <button type="button" className="button button--quiet" onClick={() => file(item.id)}>
                    Dismiss
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <input
          ref={inputRef}
          className="visually-hidden"
          type="file"
          multiple
          accept={ACCEPT_ATTRIBUTE}
          tabIndex={-1}
          aria-hidden="true"
          onChange={onInputChange}
        />
      </div>
      <p className="visually-hidden" aria-live="polite">
        {politeMessage}
      </p>
      <p className="visually-hidden" role="alert">
        {alertMessage}
      </p>
    </section>
  )
}
