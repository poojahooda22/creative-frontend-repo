import { useEffect, useRef, useState } from 'react'
import type { WebGLRenderer } from 'three'
import { Stage } from './stage'
import { createAquarium } from './scene'
import type { Layout } from './sim/world'
import { TiltInput } from './tilt'

const FONT_SPEC = '560 64px "Geist Variable"'

declare global {
  interface Window {
    /** Development only: the renderer and the tank's layout, for inspection from tests. */
    __sunken?: { renderer: WebGLRenderer; layout: () => Layout | null }
  }
}

/** `?stats` shows frame rate, physics cost and particle count, for measuring on a real device. */
const showStats = new URLSearchParams(window.location.search).has('stats')

/**
 * The product this 404 belongs to: its name, its site header, and the ways back for a lost visitor.
 * Swap these for any product; index.html's <title> carries the name too.
 */
const PRODUCT = {
  name: 'Plinth',
  home: '/',
  nav: [
    { label: 'Product', href: '/product' },
    { label: 'Pricing', href: '/pricing' },
    { label: 'Docs', href: '/docs' },
    { label: 'Changelog', href: '/changelog' },
  ],
  login: '/login',
  signup: '/signup',
  support: '/support',
} as const

/** A small arrow for the buttons, drawn in the button's own colour; it leans on hover. */
function Arrow({ back = false }: { back?: boolean }) {
  return (
    <svg className={back ? 'arrow arrow--back' : 'arrow'} viewBox="0 0 12 12" aria-hidden="true" focusable="false">
      <path d={back ? 'M10.5 6h-8M5.5 2.5 2 6l3.5 3.5' : 'M1.5 6h8M6.5 2.5 10 6 6.5 9.5'} />
    </svg>
  )
}

function webgl2Available(): boolean {
  try {
    return document.createElement('canvas').getContext('webgl2') !== null
  } catch {
    return false
  }
}

export default function App() {
  const stageRef = useRef<HTMLDivElement>(null)
  const statsRef = useRef<HTMLOutputElement>(null)
  const heroRef = useRef<HTMLElement>(null)
  const [fallback, setFallback] = useState(() => !webgl2Available())
  const [coarse] = useState(() => window.matchMedia('(pointer: coarse)').matches)
  // With reduced motion the tank is a still picture, and without WebGL2 there is no tank: the
  // invitation to stir it would be a promise the page cannot keep.
  const [still] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  // On a phone the water follows its tilt. iOS asks first, from a tap on the tilt chip; the
  // invitation changes once the phone reports a tilt.
  const [tilting, setTilting] = useState(false)
  const [tilt] = useState(() => (coarse && !still && TiltInput.supported() ? new TiltInput(() => setTilting(true)) : null))
  const [tiltAsk, setTiltAsk] = useState(() => tilt !== null && TiltInput.needsPermission())

  useEffect(() => {
    if (!tilt) return
    if (!TiltInput.needsPermission()) tilt.start()
    return () => tilt.dispose()
  }, [tilt])

  const askTilt = () => {
    if (!tilt) return
    setTiltAsk(false)
    tilt.requestPermission().then(
      (granted) => {
        if (!granted) console.warn('Sunken 404: tilt was not allowed; dragging still stirs the water.')
      },
      (error: unknown) => {
        console.warn('Sunken 404: tilt is unavailable.', error instanceof Error ? error.message : error)
      },
    )
  }

  useEffect(() => {
    const container = stageRef.current
    if (!container || fallback) return
    let stage: Stage | null = null
    let cancelled = false

    const start = () => {
      if (cancelled) return
      try {
        stage = new Stage(container)
        const running = stage
        // Development only (dropped from the build): the renderer, for the leak soak test.
        let layout: Layout | null = null
        if (import.meta.env.DEV) window.__sunken = { renderer: running.renderer, layout: () => layout }
        stage.start(
          createAquarium(stage, {
            onFatal(error) {
              console.warn('Sunken 404: showing the still page.', error.message)
              setFallback(true)
            },
            // A digit lifted out of the water rises into the headline: the headline steps back.
            onHolding(holding) {
              heroRef.current?.toggleAttribute('data-dim', holding)
            },
            tilt: tilt ?? undefined,
            onLayout(next) {
              layout = next
            },
            onStats: showStats
              ? ({ fps, physicsMs, particles }) => {
                  const out = statsRef.current
                  const gpu = Number.isNaN(running.gpuMs) ? 'n/a' : `${running.gpuMs.toFixed(1)} ms`
                  if (out) out.textContent = `${fps.toFixed(0)} fps  gpu ${gpu}  physics ${physicsMs.toFixed(1)} ms  ${particles} particles  dpr ${running.renderer.getPixelRatio().toFixed(2)}`
                }
              : undefined,
          }),
        )
      } catch (error: unknown) {
        console.warn('Sunken 404: showing the still page.', error instanceof Error ? error.message : error)
        setFallback(true)
      }
    }
    // The digits are drawn from the real Geist glyphs, so wait for the face. A failed load still
    // starts, with the fallback face.
    document.fonts.load(FONT_SPEC).then(start, start)
    return () => {
      cancelled = true
      stage?.dispose()
    }
  }, [fallback, tilt])

  // The water is a reason to linger, never the way out: its invitation sits apart from the ways
  // back, at the foot of the page, and only where the water can be played with. Screen readers
  // skip it (the tank is a picture to them).
  const hint = fallback || still ? null : tilting ? 'Tilt to slosh the water' : coarse ? 'Drag through the water' : 'Stir the water with your cursor'

  return (
    <main className="page">
      <div ref={stageRef} className={fallback ? 'stage stage--still' : 'stage'} aria-hidden="true" />
      <header className="nav">
        <a className="brand" href={PRODUCT.home}>
          <span className="brand-mark" aria-hidden="true" />
          {PRODUCT.name}
        </a>
        <nav className="links" aria-label="Main">
          {PRODUCT.nav.map((item) => (
            <a key={item.href} href={item.href}>
              {item.label}
            </a>
          ))}
        </nav>
        <div className="account">
          <a className="button button--quiet" href={PRODUCT.login}>
            Log in
          </a>
          <a className="button button--solid" href={PRODUCT.signup}>
            Get started
            <Arrow />
          </a>
        </div>
      </header>
      <section ref={heroRef} className="hero" aria-labelledby="hero-title">
        <h1 id="hero-title">
          <span className="visually-hidden">Error 404. </span>This page went under
        </h1>
        <p className="lede">The link may be broken, or the page has moved.</p>
        <div className="actions">
          <a className="button button--solid button--large" href={PRODUCT.home}>
            <Arrow back />
            Back to home
          </a>
          <a className="button button--glass button--large" href={PRODUCT.support}>
            Get help
          </a>
        </div>
      </section>
      {hint && !tiltAsk && (
        <p className="hint" aria-hidden="true">
          {hint} <span className="hint-sep">·</span> Fish a digit out
        </p>
      )}
      {fallback && (
        <p className="still-404" aria-hidden="true">
          404
        </p>
      )}
      {tiltAsk && !fallback && (
        <button type="button" className="tilt" onClick={askTilt}>
          Turn on tilt
        </button>
      )}
      <output ref={statsRef} className="stats" aria-live="off" />
    </main>
  )
}
