import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { Stage } from './stage'
import { createScene, type GlassInteraction } from './scene'
import { fontSpec } from './glass/labels'

// The words the button cycles through. Change them freely: each pill is sized to its word. The
// page opens on the first, with the last melting into it, as the reference opens on Started
// becoming Explore.
const LABELS = ['Explore', 'Continue', 'Get started'] as const

interface Inspection {
  freezeAt?: number
  labelIndex?: number
  /** `?stats`: frame time, pixel ratio and shading tier, for measuring on a real device. */
  stats?: boolean
}

/** `?t=4.2` holds the cycle at 4.2 s and `&label=1` picks the label, for frame-by-frame review. */
function readInspection(): Inspection {
  const params = new URLSearchParams(window.location.search)
  const t = params.get('t')
  const label = params.get('label')
  const inspection: Inspection = {}
  if (t !== null && Number.isFinite(Number(t))) inspection.freezeAt = Number(t)
  if (label !== null && Number.isInteger(Number(label))) inspection.labelIndex = Number(label)
  if (params.has('stats')) inspection.stats = true
  return inspection
}

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const labelRef = useRef<HTMLSpanElement>(null)
  const statsRef = useRef<HTMLOutputElement>(null)
  const interactionRef = useRef<GlassInteraction | null>(null)
  // A press released outside the pill is cancelled, like a native button's.
  const cancelClickRef = useRef(false)
  const [failed, setFailed] = useState(false)
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    const container = containerRef.current
    const button = buttonRef.current
    const labelEl = labelRef.current
    if (!container || !button || !labelEl) return
    let stage: Stage | null = null
    let cancelled = false
    let statsTimer = 0

    const start = () => {
      if (cancelled) return
      const fallBack = () => {
        interactionRef.current = null
        stage?.dispose()
        stage = null
        setFailed(true)
      }
      try {
        stage = new Stage(container)
        const inspection = readInspection()
        const scene = createScene(stage, {
          labels: LABELS,
          freezeAt: inspection.freezeAt,
          labelIndex: inspection.labelIndex,
          onLabelChange(label) {
            labelEl.textContent = label
          },
          onLayout(rect) {
            button.style.left = `${rect.x}px`
            button.style.top = `${rect.y}px`
            button.style.width = `${rect.width}px`
            button.style.height = `${rect.height}px`
          },
          // The shader would not build on this GPU: the scene already logged why.
          onFatal: fallBack,
        })
        interactionRef.current = scene.interaction
        stage.start(scene)
        if (inspection.stats) {
          // Twice a second, straight into the DOM: per-frame numbers never go through React state.
          const running = stage
          statsTimer = window.setInterval(() => {
            const out = statsRef.current
            if (!out) return
            const { frameMs, pixelRatio } = running.stats()
            out.textContent = `${(1000 / frameMs).toFixed(0)} fps  ${frameMs.toFixed(1)} ms  dpr ${pixelRatio.toFixed(2)}  ${scene.quality()}`
          }, 500)
        }
      } catch (error: unknown) {
        // No WebGL2 here: the plain button is the expected path, so a warning, not an error.
        console.warn('Liquid glass: showing the CSS button.', error instanceof Error ? error.message : error)
        fallBack()
      }
    }

    // The atlas measures the real glyphs, so wait for the face. A failed load still starts,
    // with the fallback face.
    document.fonts.load(fontSpec()).then(start, start)

    return () => {
      cancelled = true
      window.clearInterval(statsTimer)
      interactionRef.current = null
      stage?.dispose()
    }
  }, [])

  const local = (event: PointerEvent<HTMLElement>) => {
    const rect = containerRef.current?.getBoundingClientRect()
    return rect ? { x: event.clientX - rect.left, y: event.clientY - rect.top } : { x: 0, y: 0 }
  }

  const centre = () => {
    const button = buttonRef.current
    if (!button) return { x: 0, y: 0 }
    return { x: button.offsetLeft + button.offsetWidth / 2, y: button.offsetTop + button.offsetHeight / 2 }
  }

  const togglePause = () => {
    const next = !paused
    setPaused(next)
    interactionRef.current?.setPaused(next)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) {
      const c = centre()
      interactionRef.current?.press(c.x, c.y)
    }
  }

  if (failed) {
    return (
      <main className="stage stage--fallback">
        <h1 className="visually-hidden">Liquid glass button</h1>
        <button type="button" className="fallback-pill">
          <span>{LABELS[0]}</span>
          <span className="fallback-divider" aria-hidden="true" />
          <span aria-hidden="true">→</span>
        </button>
        <p className="caption">02 | Liquid glass</p>
      </main>
    )
  }

  return (
    <main
      ref={containerRef}
      className="stage"
      onPointerMove={(event) => {
        const p = local(event)
        interactionRef.current?.pointerMove(p.x, p.y)
      }}
      onPointerLeave={() => interactionRef.current?.pointerLeave()}
    >
      <h1 className="visually-hidden">Liquid glass button</h1>
      <button
        ref={buttonRef}
        type="button"
        className="glass-hit"
        onPointerDown={(event) => {
          // Capture keeps the release coming here even if the pointer leaves the pill first.
          event.currentTarget.setPointerCapture(event.pointerId)
          cancelClickRef.current = false
          const p = local(event)
          interactionRef.current?.press(p.x, p.y)
        }}
        onPointerUp={(event) => {
          const r = event.currentTarget.getBoundingClientRect()
          const inside = event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom
          cancelClickRef.current = !inside
          interactionRef.current?.release()
        }}
        onPointerCancel={() => interactionRef.current?.release()}
        onLostPointerCapture={() => interactionRef.current?.release()}
        onKeyDown={onKeyDown}
        onKeyUp={() => interactionRef.current?.release()}
        onFocus={() => interactionRef.current?.setFocused(true)}
        onBlur={() => {
          interactionRef.current?.setFocused(false)
          interactionRef.current?.release()
        }}
        onClick={() => {
          if (cancelClickRef.current) {
            cancelClickRef.current = false
            return
          }
          // Pressing the glass while paused plays it again.
          if (paused) togglePause()
          interactionRef.current?.activate()
        }}
      >
        <span ref={labelRef} className="visually-hidden">
          {LABELS[0]}
        </span>
      </button>
      <p className="caption">02 | Liquid glass</p>
      {/* A toggle keeps one label; its pressed state says whether the motion is paused. */}
      <button type="button" className="pause" aria-pressed={paused} onClick={togglePause}>
        Pause
      </button>
      <output ref={statsRef} className="stats" aria-live="off" />
    </main>
  )
}
