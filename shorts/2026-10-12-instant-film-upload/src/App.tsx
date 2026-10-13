import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Gallery } from './upload/Gallery'
import { InstantUpload } from './upload/InstantUpload'
import { createSimulatedTransport, type SimulatedNetwork } from './upload/transport'
import type { UploadCandidate, UploadItem } from './upload/types'
import { useUploadQueue } from './upload/useUploadQueue'

// One query object for the page; matchMedia allocates a new one on every call.
const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')

function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      reducedMotionQuery.addEventListener('change', onChange)
      return () => reducedMotionQuery.removeEventListener('change', onChange)
    },
    () => reducedMotionQuery.matches,
  )
}

type Speed = 'cafe' | 'fibre'
const SPEEDS: Speed[] = ['cafe', 'fibre']

// Café Wi-Fi is slow enough to watch the develop follow the bytes. On fibre the upload is
// near-instant and the develop is simply its two-second reveal.
const NETWORKS: Record<Speed, { label: string; network: SimulatedNetwork }> = {
  cafe: { label: 'Café Wi-Fi, 0.36 Mbit/s', network: { bytesPerSecond: 45_000, latencyMs: 380, failAt: null } },
  fibre: { label: 'Office fibre, 50 Mbit/s', network: { bytesPerSecond: 6_250_000, latencyMs: 40, failAt: null } },
}

const LOT_DATA = `lot,farm,altitude (m),score
GJ-2411,Hambela Estate,2210,88.5
GJ-2412,Dimtu,2050,87.25
GJ-2413,Buku Abel,2180,88
GJ-2414,Shakiso,1950,86.75
GJ-2415,Uraga,2300,89
GJ-2416,Hambela Estate,2240,87.5
GJ-2417,Odo Shakiso,1990,86.5
GJ-2418,Buku Sayisa,2150,88.25`

type Sample = { label: string; load: () => Promise<UploadCandidate> }

async function fetchSample(url: string, name: string, type: string): Promise<UploadCandidate> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Could not load ${name} (HTTP ${response.status})`)
  const blob = await response.blob()
  return { name, size: blob.size, type, blob }
}

function textSample(text: string, name: string, type: string): Promise<UploadCandidate> {
  const blob = new Blob([text], { type })
  return Promise.resolve({ name, size: blob.size, type, blob })
}

const SAMPLES: Sample[] = [
  { label: 'Pour-over photo', load: () => fetchSample('samples/pour-over.jpg', 'pour-over.jpg', 'image/jpeg') },
  { label: 'Bean photo', load: () => fetchSample('samples/beans.jpg', 'beans.jpg', 'image/jpeg') },
  { label: 'Latte photo', load: () => fetchSample('samples/latte.jpg', 'latte.jpg', 'image/jpeg') },
  { label: 'Lot data CSV', load: () => textSample(LOT_DATA, 'guji-lots.csv', 'text/csv') },
  { label: 'Tasting notes PDF', load: () => textSample('%PDF-1.4\n%%EOF\n', 'tasting-notes.pdf', 'application/pdf') },
  { label: 'Installer .exe', load: () => textSample('MZ', 'roaster-setup.exe', 'application/x-msdownload') },
  {
    label: '48 MB photo',
    // Rejected before upload on size alone, so the demo never allocates the bytes.
    load: () => Promise.resolve({ name: 'harvest-hero.png', size: 48.2 * 1024 * 1024, type: 'image/png' }),
  },
]

export default function App() {
  const reducedMotion = useReducedMotion()
  const [speed, setSpeed] = useState<Speed>('cafe')
  const [dropNext, setDropNext] = useState(false)
  // Read by the transport when each upload starts; the failure is spent on one upload.
  const network = useRef({ speed, dropNext })
  useEffect(() => {
    network.current = { speed, dropNext }
  }, [speed, dropNext])
  const [sampleError, setSampleError] = useState('')
  const origins = useMemo(() => new Map<string, DOMRect>(), [])

  const transport = useMemo(
    () =>
      createSimulatedTransport(() => {
        const { speed: current, dropNext: drop } = network.current
        if (drop) {
          network.current = { speed: current, dropNext: false }
          setDropNext(false)
        }
        return { ...NETWORKS[current].network, failAt: drop ? 0.63 : null }
      }),
    [],
  )
  const queue = useUploadQueue({ transport })
  const { add } = queue


  // A real host deletes item.result.id on its server first; the demo has nothing stored.
  const removeFromPage = (item: UploadItem) => queue.remove(item.id)

  const addSample = (sample: Sample) => {
    setSampleError('')
    sample.load().then(
      (candidate) => add([candidate]),
      (error: unknown) => setSampleError(error instanceof Error ? error.message : 'The sample could not be loaded.'),
    )
  }

  // One orchestrated moment on arrival: the first print ejects and develops on its own.
  const introduced = useRef(false)
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (introduced.current) return
      introduced.current = true
      SAMPLES[0].load().then(
        (candidate) => add([candidate]),
        (error: unknown) => setSampleError(error instanceof Error ? error.message : 'The sample could not be loaded.'),
      )
    }, 700)
    return () => window.clearTimeout(timer)
  }, [add])

  return (
    <>
      <header className="topbar">
        <span className="brand">Northbound Roasters</span>
        <ol className="crumbs" aria-label="Breadcrumb">
          <li>Products</li>
          <li aria-current="page">Ethiopia Guji, washed</li>
        </ol>
      </header>
      <main className="page">
        <div className="page__intro">
          <h1>Media</h1>
          <p>Photos, tasting notes and lot data shown on this coffee's product page.</p>
        </div>
        <div className="workspace">
          <InstantUpload queue={queue} reducedMotion={reducedMotion} origins={origins} acceptDropsAnywhere />
          <Gallery items={queue.items} origins={origins} reducedMotion={reducedMotion} onRemove={removeFromPage} />
        </div>
        <aside className="demo" aria-labelledby="demo-title">
          <h2 id="demo-title" className="demo__title">
            No files to hand? Try these
          </h2>
          <div className="demo__samples">
            {SAMPLES.map((sample) => (
              <button key={sample.label} type="button" className="button" onClick={() => addSample(sample)}>
                {sample.label}
              </button>
            ))}
          </div>
          <label className="switch">
            <input type="checkbox" role="switch" checked={dropNext} onChange={() => setDropNext((value) => !value)} />
            <span className="switch__track" aria-hidden="true" />
            Drop the connection during the next upload
          </label>
          <fieldset className="speeds">
            <legend>Simulated network</legend>
            {SPEEDS.map((key) => (
              <label key={key} className="speeds__option">
                <input type="radio" name="speed" checked={speed === key} onChange={() => setSpeed(key)} />
                {NETWORKS[key].label}
              </label>
            ))}
          </fieldset>
          {sampleError && (
            <p className="demo__error" role="alert">
              {sampleError}
            </p>
          )}
          <p className="demo__note">Uploads on this page are simulated. Files never leave your browser.</p>
        </aside>
      </main>
    </>
  )
}
