import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { UploadItem } from '../types'
import { extensionOf, formatBytes } from '../validate'
import { startDevelopLoop } from './developLoop'
import { createPrintSource } from './printSource'
import { acquirePrintSurface, releasePrintSurface, replaceFailedSurface, type PrintSurface } from './surfacePool'

function seedFrom(id: string): number {
  let hash = 0
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) % 997
  return hash / 997
}

type CaptionTone = 'pencil' | 'pen' | 'error'

function captionFor(item: UploadItem, previewMissing: boolean): { text: string; tone: CaptionTone } {
  if (item.status === 'failed') {
    if (item.failure?.kind === 'network') return { text: `lost at ${Math.round(item.progress * 100)}%`, tone: 'error' }
    if (item.failure?.kind === 'size') return { text: `${formatBytes(item.size)}, too big`, tone: 'error' }
    const extension = extensionOf(item.name)
    return { text: extension ? `can't develop .${extension}` : `can't develop this`, tone: 'error' }
  }
  if (item.revealed) return { text: previewMissing ? `${item.name} (no preview)` : item.name, tone: 'pen' }
  // Uploaded but still developing: the margin waits for the name.
  if (item.status === 'uploaded') return { text: '', tone: 'pen' }
  return { text: `${Math.round(item.progress * 100)}%`, tone: 'pencil' }
}

interface DevelopingPrintProps {
  item: UploadItem
  /** Other files are waiting on the camera, so the reveal should be quick. */
  hurried: boolean
  reducedMotion: boolean
  onRevealed: (id: string) => void
}

/** The print in the camera: it ejects from the slot, then develops as the upload progresses. */
export function DevelopingPrint({ item, hurried, reducedMotion, onRevealed }: DevelopingPrintProps) {
  const printRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLDivElement>(null)
  const glintRef = useRef<HTMLSpanElement>(null)
  const itemRef = useRef(item)
  const hurriedRef = useRef(hurried)
  const onRevealedRef = useRef(onRevealed)
  const wakeRef = useRef<() => void>(() => {})
  const [previewMissing, setPreviewMissing] = useState(false)

  useLayoutEffect(() => {
    itemRef.current = item
    hurriedRef.current = hurried
    onRevealedRef.current = onRevealed
    wakeRef.current()
  })

  useLayoutEffect(() => {
    const print = printRef.current
    const glint = glintRef.current
    if (!print || !glint || reducedMotion) return
    const eject = print.animate([{ transform: 'translateY(-104%)' }, { transform: 'translateY(0)' }], {
      duration: 820,
      easing: 'cubic-bezier(0.23, 1, 0.32, 1)',
    })
    // Once the film is mostly out, a highlight crosses it, then rests off the edge.
    const sweep = glint.animate([{ transform: 'translateX(-70%)' }, { transform: 'translateX(70%)' }], {
      delay: 260,
      duration: 1300,
      easing: 'cubic-bezier(0.77, 0, 0.175, 1)',
      fill: 'both',
    })
    return () => {
      eject.cancel()
      sweep.cancel()
    }
  }, [item.id, reducedMotion])

  useEffect(() => {
    const host = imageRef.current
    if (!host) return
    let disposed = false
    let source: ImageBitmap | null = null
    let surface: PrintSurface | null = null
    let stopLoop = () => {}

    createPrintSource(itemRef.current).then(
      (bitmap) => {
        if (!bitmap) return
        if (disposed) {
          bitmap.close()
          return
        }
        source = bitmap
        surface?.renderer.setSource(bitmap)
      },
      (error: unknown) => {
        console.warn(`Instant film: no preview for ${itemRef.current.name}.`, error)
        if (!disposed) setPreviewMissing(true)
      },
    )

    const attach = (next: PrintSurface) => {
      surface = next
      const { canvas, renderer } = next
      if (source) renderer.setSource(source)
      canvas.className = 'print__canvas'
      const side = Math.max(1, Math.round(host.clientWidth * Math.min(window.devicePixelRatio || 1, 2)))
      canvas.width = side
      canvas.height = side
      host.prepend(canvas)

      const loop = startDevelopLoop({
        renderer,
        seed: seedFrom(itemRef.current.id),
        reducedMotion,
        read: () => itemRef.current,
        hurried: () => hurriedRef.current,
        onRevealed: () => onRevealedRef.current(itemRef.current.id),
        // A shader that fails to build after the fact: carry on developing on a 2D surface.
        // Deferred, because the first frame is drawn while this attach is still running.
        onRendererFailed: () =>
          queueMicrotask(() => {
            if (!disposed && surface === next) attach(replaceFailedSurface(next))
          }),
      })
      wakeRef.current = loop.wake
      stopLoop = loop.stop
    }

    // The surface is attached a frame after mount, so mounting the print and preparing the GPU
    // are separate tasks. The image window's opacifier colour covers the gap.
    const setupFrame = requestAnimationFrame(() => attach(acquirePrintSurface()))

    return () => {
      disposed = true
      cancelAnimationFrame(setupFrame)
      wakeRef.current = () => {}
      stopLoop()
      if (surface) releasePrintSurface(surface)
      source?.close()
    }
  }, [item.id, reducedMotion])

  const caption = captionFor(item, previewMissing)

  return (
    <div className="print print--stage" ref={printRef} aria-hidden="true">
      <div className="print__image" ref={imageRef}>
        <span className="print__gloss" />
        <span className="print__glint" ref={glintRef} />
      </div>
      <p className="print__caption" data-tone={caption.tone} data-written={item.revealed || undefined}>
        {caption.text}
      </p>
    </div>
  )
}
