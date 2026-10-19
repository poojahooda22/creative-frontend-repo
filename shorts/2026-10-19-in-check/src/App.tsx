import { useEffect, useRef, useState } from 'react'
import { Bars, Heatmap } from './charts'
import {
  dayKey,
  EMPTY_DAY,
  formatHours,
  loadStore,
  MAX_HOURS,
  normalizeStore,
  parseKey,
  serialize,
  shiftKey,
  STORAGE_KEY,
  streaks,
  summary,
  verdict,
  type DayEntry,
  type Store,
  type SystemSlot,
  type SystemStatus,
} from './model'

const STATUS_LABEL: Record<SystemStatus, string> = { planned: 'Planned', building: 'Building', shipped: 'Shipped' }
const NEXT_STATUS: Record<SystemStatus, SystemStatus> = { planned: 'building', building: 'shipped', shipped: 'planned' }

function readStorage(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    // Storage blocked (a private window with it off): the tracker runs for the session only.
    return null
  }
}

function headingDate(key: string): string {
  return parseKey(key).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
}

export default function App() {
  const [loaded] = useState(() => loadStore(readStorage()))
  const [store, setStore] = useState<Store>(loaded.store)
  const [notice, setNotice] = useState<string | null>(loaded.problem ? `Saved data could not be read (${loaded.problem}). Starting fresh; the old text is still in this browser's storage.` : null)
  const [now, setNow] = useState(() => new Date())
  // The day being logged: today, or a day stepped back to.
  const [editing, setEditing] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const yearRef = useRef<HTMLDivElement>(null)
  const firstSave = useRef(true)

  // The year grid is wider than a phone: open it at its end, where today is.
  useEffect(() => {
    const el = yearRef.current
    if (el) el.scrollLeft = el.scrollWidth
  }, [])

  // The day can change while the page stays open (past the day's start hour).
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    if (firstSave.current) {
      firstSave.current = false
      if (loaded.problem) return
    }
    try {
      localStorage.setItem(STORAGE_KEY, serialize(store))
    } catch (error: unknown) {
      setNotice(`Could not save: ${error instanceof Error ? error.message : String(error)}`)
    }
  }, [store, loaded.problem])

  const { bar, dayStart } = store.settings
  const today = dayKey(now, dayStart)
  const day = editing ?? today
  const entry = store.days[day] ?? EMPTY_DAY
  const yesterday = store.days[shiftKey(day, -1)]
  const run = streaks(store.days, bar, today)
  const sums = summary(store.days, bar, today)
  const said = verdict(entry, yesterday, bar)

  const setEntry = (patch: Partial<DayEntry>) =>
    setStore((s) => {
      const next = { ...(s.days[day] ?? EMPTY_DAY), ...patch }
      if (next.dsa > next.hours) next.dsa = next.hours
      return { ...s, days: { ...s.days, [day]: next } }
    })
  const setSystem = (i: number, patch: Partial<SystemSlot>) => setStore((s) => ({ ...s, systems: s.systems.map((slot, k) => (k === i ? { ...slot, ...patch } : slot)) }))

  const exportData = () => {
    const blob = new Blob([serialize(store)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `in-check-${today}.json`
    a.click()
    URL.revokeObjectURL(url)
    setNotice(`Exported ${Object.keys(store.days).length} days.`)
  }
  const importData = (file: File | undefined) => {
    if (!file) return
    file.text().then(
      (text) => {
        try {
          const next = normalizeStore(JSON.parse(text))
          setStore(next)
          setEditing(null)
          setNotice(`Imported ${Object.keys(next.days).length} days from ${file.name}. The data that was here before is replaced.`)
        } catch (error: unknown) {
          setNotice(`Import failed: ${error instanceof Error ? error.message : String(error)}`)
        }
      },
      (error: unknown) => setNotice(`Could not read ${file.name}: ${error instanceof Error ? error.message : String(error)}`),
    )
  }

  const missing = (bar - entry.hours > 0 ? [`${formatHours(bar - entry.hours)} to the bar`] : []).concat(entry.gym ? [] : ['gym'])

  return (
    <main className="page">
      <header className="top">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true" />
          <span className="brand__name">In Check</span>
        </div>
        <p className="top__date">{headingDate(today)}</p>
        <div className={run.current > 0 ? 'streak streak--alive' : 'streak'} aria-label={`Streak ${run.current} days, best ${run.best}`}>
          <Flame />
          <span className="streak__count">{run.current}</span>
          <span className="streak__label">day streak</span>
          <span className="streak__best">best {run.best}</span>
        </div>
      </header>

      {notice && (
        <p className="notice" role="status">
          {notice}
          <button type="button" className="btn btn--ghost btn--small" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </p>
      )}

      <div className="columns">
        <section className="card card--today" aria-labelledby="today-title">
          <div className="card__head">
            <div>
              <h1 id="today-title" className="card__title">
                {day === today ? 'Today' : headingDate(day)}
              </h1>
              <p className="card__sub">{day === today ? (missing.length ? `Still to go: ${missing.join(' and ')}.` : 'Counted.') : day > today ? 'Not yet.' : missing.length ? `Missed: ${missing.join(' and ')}.` : 'Counted.'}</p>
            </div>
            <div className="day-nav">
              <button type="button" className="btn btn--ghost btn--icon" onClick={() => setEditing(shiftKey(day, -1))} aria-label="Previous day">
                <Chevron back />
              </button>
              <button type="button" className="btn btn--ghost btn--icon" onClick={() => setEditing(day === shiftKey(today, -1) ? null : shiftKey(day, 1))} disabled={day >= today} aria-label="Next day">
                <Chevron />
              </button>
              {day !== today && (
                <button type="button" className="btn btn--ghost btn--small" onClick={() => setEditing(null)}>
                  Today
                </button>
              )}
            </div>
          </div>

          <div className={entry.hours >= bar ? 'bar-meter bar-meter--reached' : 'bar-meter'} aria-hidden="true">
            <div className="bar-meter__fill" style={{ width: `${Math.min(100, (100 * entry.hours) / MAX_HOURS)}%` }} />
            <div className="bar-meter__dsa" style={{ width: `${Math.min(100, (100 * entry.dsa) / MAX_HOURS)}%` }} />
            <div className="bar-meter__bar" style={{ left: `${(100 * bar) / MAX_HOURS}%` }} />
          </div>

          <div className="fields">
            <Toggle id="gym" label="Gym" hint="Goal one. Every day." checked={entry.gym} onChange={(gym) => setEntry({ gym })} />
            <Stepper id="hours" label="Hours worked" hint={`The bar is ${bar} h.`} value={entry.hours} min={0} max={MAX_HOURS} step={0.5} unit="h" onChange={(hours) => setEntry({ hours })} />
            <Stepper id="dsa" label="DSA hours" hint="Inside the hours. The most important part." value={entry.dsa} min={0} max={entry.hours} step={0.5} unit="h" onChange={(dsa) => setEntry({ dsa })} />
            <Stepper id="problems" label="Problems solved" hint="Brute force, better, optimal. Count the ones taken to optimal." value={entry.problems} min={0} max={1000} step={1} onChange={(problems) => setEntry({ problems })} />
            <Toggle id="systems" label="Built on a system" hint="The course-selling app, or one of the five." checked={entry.systems} onChange={(systems) => setEntry({ systems })} />
            <Toggle id="product" label="Product lesson" hint="PM course: a concept or a category." checked={entry.product} onChange={(product) => setEntry({ product })} />
          </div>

          <div className="field field--note">
            <label className="field__label" htmlFor="note">
              What did you do?
            </label>
            <p className="field__hint">Numbers first, then what was hard. Tomorrow reads this.</p>
            <textarea id="note" className="note" rows={6} value={entry.note} onChange={(e) => setEntry({ note: e.target.value })} placeholder="7 problems: arrays and two pointers, 5 to optimal. 2 h on the course-selling app: wrote the purchase schema." />
          </div>
        </section>

        <aside className="side">
          <section className="card card--verdict" aria-labelledby="verdict-title">
            <h2 id="verdict-title" className={said.ok ? 'card__title card__title--done' : 'card__title'}>
              {said.headline}
            </h2>
            <ul className="verdict">
              {said.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            {yesterday?.note ? (
              <blockquote className="yesterday">
                <p className="yesterday__label">Yesterday, in your words</p>
                <p className="yesterday__note">{yesterday.note}</p>
              </blockquote>
            ) : (
              <p className="yesterday__empty">No note from yesterday.</p>
            )}
          </section>

          <section className="card" aria-labelledby="week-title">
            <h2 id="week-title" className="card__title card__title--small">
              Last seven days
            </h2>
            <dl className="stats">
              <Stat label="Hours" value={formatHours(sums.weekHours)} />
              <Stat label="DSA" value={formatHours(sums.weekDsa)} />
              <Stat label="Problems" value={String(sums.weekProblems)} />
              <Stat label="At the bar" value={`${sums.weekAtBar} of 7`} />
            </dl>
            <p className="card__foot">
              This month: {sums.monthAtBar} of {sums.monthDays} logged {sums.monthDays === 1 ? 'day' : 'days'} counted.
            </p>
          </section>
        </aside>
      </div>

      <section className="card" aria-labelledby="bars-title">
        <div className="card__head">
          <h2 id="bars-title" className="card__title card__title--small">
            Last fourteen days
          </h2>
          <p className="legend" aria-hidden="true">
            <span className="legend__swatch legend__swatch--hours" /> hours <span className="legend__swatch legend__swatch--dsa" /> DSA <span className="legend__swatch legend__swatch--counted" /> counted <span className="legend__dot" /> gym <span className="legend__line" /> the bar, {bar} h
          </p>
        </div>
        <Bars days={store.days} bar={bar} today={today} />
      </section>

      <section className="card" aria-labelledby="year-title">
        <div className="card__head">
          <h2 id="year-title" className="card__title card__title--small">
            The year
          </h2>
          <p className="legend" aria-hidden="true">
            less
            {[0, 1, 2, 3, 4].map((l) => (
              <span key={l} className={`legend__cell heatmap__cell--${l}`} />
            ))}
            the bar
          </p>
        </div>
        <div ref={yearRef} className="scroll">
          <Heatmap days={store.days} bar={bar} today={today} />
        </div>
      </section>

      <section className="card" aria-labelledby="systems-title">
        <h2 id="systems-title" className="card__title card__title--small">
          Systems
        </h2>
        <p className="card__sub">The course-selling app, then five of your own. Schema, where the data lives, the APIs.</p>
        <ol className="systems">
          {store.systems.map((slot, i) => (
            <li key={i} className="systems__row">
              <span className="systems__index" aria-hidden="true">
                {i + 1}
              </span>
              <input className="systems__name" type="text" value={slot.name} placeholder={i === 0 ? 'Course-selling app' : `System ${i + 1}`} aria-label={`System ${i + 1} name`} onChange={(e) => setSystem(i, { name: e.target.value })} />
              <button type="button" className={`btn btn--status btn--status-${slot.status}`} onClick={() => setSystem(i, { status: NEXT_STATUS[slot.status] })} aria-label={`System ${i + 1}: ${STATUS_LABEL[slot.status]}. Change`}>
                {STATUS_LABEL[slot.status]}
              </button>
            </li>
          ))}
        </ol>
      </section>

      <section className="card card--settings" aria-labelledby="data-title">
        <h2 id="data-title" className="card__title card__title--small">
          Settings and data
        </h2>
        <div className="fields fields--settings">
          <Stepper id="bar" label="The bar" hint="Hours a day needs to count." value={bar} min={1} max={MAX_HOURS} step={0.5} unit="h" onChange={(value) => setStore((s) => ({ ...s, settings: { ...s.settings, bar: value } }))} />
          <Stepper id="day-start" label="Day starts at" hint="Work after midnight stays with the day before." value={dayStart} min={0} max={12} step={1} unit=":00" onChange={(value) => setStore((s) => ({ ...s, settings: { ...s.settings, dayStart: value } }))} />
        </div>
        <p className="card__sub">The record lives in this browser. Export it now and then; import a file to restore it.</p>
        <div className="actions">
          <button type="button" className="btn" onClick={exportData}>
            Export JSON
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => fileRef.current?.click()}>
            Import JSON
          </button>
          <input ref={fileRef} type="file" accept="application/json,.json" className="visually-hidden" aria-label="Import a tracker file" onChange={(e) => importData(e.target.files?.[0])} />
        </div>
      </section>

      <footer className="foot">Two goals. Count the work, not the hours.</footer>
    </main>
  )
}

/** The streak's flame: lit in green while the streak is alive. */
function Flame() {
  return (
    <svg className="flame" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 2c.5 3.3 2.3 5.2 4.2 7.2C18 11.1 19 13 19 15.1A7 7 0 0 1 5 15.1c0-1.7.5-3.1 1.5-4.3.3 1.5 1.2 2.4 2.4 2.8-.4-2.9.2-5.3 2-7.1C11.8 5.6 12 3.9 12 2z" />
      <path className="flame__core" d="M12 11c.4 1.7 1.4 2.6 2.3 3.6.7.8 1.2 1.6 1.2 2.6a3.5 3.5 0 0 1-7 0c0-.8.3-1.5.8-2.1.2.7.7 1.2 1.3 1.4-.2-1.5.1-2.7 1-3.7.3-.5.4-1.2.4-1.8z" />
    </svg>
  )
}

function Chevron({ back = false }: { back?: boolean }) {
  return (
    <svg className="chevron" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
      <path d={back ? 'M7.5 2.5 4 6l3.5 3.5' : 'M4.5 2.5 8 6l-3.5 3.5'} />
    </svg>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <dt className="stat__label">{label}</dt>
      <dd className="stat__value">{value}</dd>
    </div>
  )
}

interface ToggleProps {
  id: string
  label: string
  hint: string
  checked: boolean
  onChange(checked: boolean): void
}

function Toggle({ id, label, hint, checked, onChange }: ToggleProps) {
  return (
    <div className="field field--row">
      <div className="field__text">
        <label className="field__label" htmlFor={id}>
          {label}
        </label>
        <p className="field__hint">{hint}</p>
      </div>
      <button id={id} type="button" role="switch" aria-checked={checked} className="toggle" onClick={() => onChange(!checked)}>
        <span className="toggle__knob" />
        <span className="toggle__state">{checked ? 'Done' : 'Not yet'}</span>
      </button>
    </div>
  )
}

interface StepperProps {
  id: string
  label: string
  hint: string
  value: number
  min: number
  max: number
  step: number
  /** Shown after the number: h, or :00 for an hour of the day. */
  unit?: string
  onChange(value: number): void
}

/** A number with a button either side; the number itself can be typed into. */
function Stepper({ id, label, hint, value, min, max, step, unit, onChange }: StepperProps) {
  const clamp = (n: number) => Math.min(max, Math.max(min, Math.round(n / step) * step))
  return (
    <div className="field field--row">
      <div className="field__text">
        <label className="field__label" htmlFor={id}>
          {label}
        </label>
        <p className="field__hint">{hint}</p>
      </div>
      <div className="stepper">
        <button type="button" className="btn btn--icon" onClick={() => onChange(clamp(value - step))} disabled={value <= min} aria-label={`Less ${label.toLowerCase()}`}>
          <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
            <path d="M2.5 6h7" />
          </svg>
        </button>
        <span className="stepper__value">
          <input
            id={id}
            className="stepper__input"
            type="number"
            inputMode="decimal"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => {
              const n = Number(e.target.value)
              if (Number.isFinite(n)) onChange(clamp(n))
            }}
          />
          {unit && (
            <span className={unit.startsWith(':') ? 'stepper__unit stepper__unit--tight' : 'stepper__unit'} aria-hidden="true">
              {unit}
            </span>
          )}
        </span>
        <button type="button" className="btn btn--icon" onClick={() => onChange(clamp(value + step))} disabled={value >= max} aria-label={`More ${label.toLowerCase()}`}>
          <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
            <path d="M2.5 6h7M6 2.5v7" />
          </svg>
        </button>
      </div>
    </div>
  )
}
