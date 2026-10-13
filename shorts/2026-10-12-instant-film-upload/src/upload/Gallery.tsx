import { memo, useLayoutEffect, useRef, useState } from 'react'
import type { UploadItem } from './types'
import './instant-upload.css'

function tiltFor(id: string): number {
  let hash = 0
  for (const character of id) hash = (hash * 33 + character.charCodeAt(0)) % 1009
  return (hash / 1009) * 5 - 2.5
}

interface GalleryPrintProps {
  item: UploadItem
  origins: Map<string, DOMRect>
  reducedMotion: boolean
  onRemove: (item: UploadItem) => void
}

function inViewport(rect: DOMRect): boolean {
  return rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth
}

// Memoised: the queue re-renders on every progress tick, and filed prints never change.
const GalleryPrint = memo(function GalleryPrint({ item, origins, reducedMotion, onRemove }: GalleryPrintProps) {
  const printRef = useRef<HTMLElement>(null)
  const tilt = tiltFor(item.id)
  // Captured once; state survives the effect re-run React performs in development.
  const [origin] = useState(() => origins.get(item.id))
  // A file that uploads but cannot be shown (a corrupt image) keeps a plain paper window, not a broken icon.
  const [unreadable, setUnreadable] = useState(false)

  // Fly in from where the print stood in the camera, centre to centre.
  useLayoutEffect(() => {
    const print = printRef.current
    if (!print) return
    origins.delete(item.id)
    if (!origin || reducedMotion) {
      const fade = print.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' })
      return () => fade.cancel()
    }
    const target = print.getBoundingClientRect()
    // A landing spot off screen (the gallery below the camera on a phone) gets a fade, not a flight out of view.
    if (!inViewport(target)) {
      const fade = print.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' })
      return () => fade.cancel()
    }
    const dx = origin.left + origin.width / 2 - (target.left + target.width / 2)
    const dy = origin.top + origin.height / 2 - (target.top + target.height / 2)
    const scale = origin.width / target.width
    // It travels flat, then lands: a touch past its resting angle, and settles back.
    const flight = print.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) scale(${scale}) rotate(0deg)` },
        { transform: `translate(${dx * 0.04}px, ${dy * 0.04}px) scale(1.015) rotate(${tilt * 2}deg)`, offset: 0.78 },
        { transform: `translate(0, 0) scale(1) rotate(${tilt}deg)` },
      ],
      { duration: 680, easing: 'cubic-bezier(0.77, 0, 0.175, 1)' },
    )
    return () => flight.cancel()
  }, [item.id, origin, origins, reducedMotion, tilt])

  return (
    <li className="gallery__item">
      <figure className="print print--small" ref={printRef} style={{ transform: `rotate(${tilt}deg)` }}>
        <div className="print__image">
          {/* The figcaption names the image, so the image itself needs no alt text of its own. */}
          {item.preview && !unreadable && <img src={item.preview} alt="" onError={() => setUnreadable(true)} />}
          <span className="print__gloss" />
        </div>
        <figcaption className="print__caption" data-tone="pen">
          {item.name}
        </figcaption>
      </figure>
      <button type="button" className="gallery__remove" aria-label={`Remove ${item.name}`} onClick={() => onRemove(item)}>
        <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
          <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
    </li>
  )
})

interface GalleryProps {
  items: UploadItem[]
  origins: Map<string, DOMRect>
  reducedMotion: boolean
  /** Receives the item, including the id the server returned, so the host can delete the stored file. */
  onRemove: (item: UploadItem) => void
}

export function Gallery({ items, origins, reducedMotion, onRemove }: GalleryProps) {
  const filed = items.filter((item) => item.status === 'uploaded' && item.filed)

  return (
    <section className="gallery" aria-labelledby="gallery-title">
      <div className="gallery__head">
        <h2 id="gallery-title">On the product page</h2>
        <span className="gallery__count">
          {filed.length} {filed.length === 1 ? 'file' : 'files'}
        </span>
      </div>
      {filed.length === 0 ? (
        <div className="gallery__empty">
          <div className="gallery__marks" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <p>Nothing here yet. Each upload lands here once it has developed.</p>
        </div>
      ) : (
        <ul className="gallery__grid">
          {filed.map((item) => (
            <GalleryPrint
              key={item.id}
              item={item}
              origins={origins}
              reducedMotion={reducedMotion}
              onRemove={onRemove}
            />
          ))}
        </ul>
      )}
    </section>
  )
}
