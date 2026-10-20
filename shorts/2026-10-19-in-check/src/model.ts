// The tracker's data and the arithmetic on it: which calendar day "now" belongs to, what makes a
// day count, streaks, the week's numbers, the year grid, and the verdict the next day reads.

export const SCHEMA_VERSION = 1

export interface DayEntry {
  /** Gym done. */
  gym: boolean
  /** Hours of work in the day. */
  hours: number
  /** Hours of those spent on DSA. */
  dsa: number
  /** Problems solved. */
  problems: number
  /** Worked on a system: the course-selling app, or one of the five after it. */
  systems: boolean
  /** A product (PM course) lesson done. */
  product: boolean
  /** What was done, in words. The next day reads it. */
  note: string
}

export type SystemStatus = 'planned' | 'building' | 'shipped'

export interface SystemSlot {
  name: string
  status: SystemStatus
}

export interface Settings {
  /** Hours a day has to reach to count. */
  bar: number
  /** The hour (0 to 12) a new day starts at, so work past midnight stays with the day it belongs to. */
  dayStart: number
}

/** The desk timer: one stretch runs at a time; Pause banks it. Its total is the day's hours. */
export interface Timer {
  /** The day the timer counts for. */
  day: string
  /** Milliseconds banked by the stretches already paused. */
  banked: number
  /** When the running stretch started (ms since the epoch), or null while paused. */
  startedAt: number | null
}

export interface Store {
  version: typeof SCHEMA_VERSION
  settings: Settings
  days: Record<string, DayEntry>
  systems: SystemSlot[]
  timer?: Timer
}

export const EMPTY_DAY: DayEntry = { gym: false, hours: 0, dsa: 0, problems: 0, systems: false, product: false, note: '' }
export const DEFAULT_SETTINGS: Settings = { bar: 22, dayStart: 4 }
export const SYSTEM_SLOTS = 6
export const MAX_HOURS = 24

export function defaultStore(): Store {
  return {
    version: SCHEMA_VERSION,
    settings: { ...DEFAULT_SETTINGS },
    days: {},
    systems: [{ name: 'Course-selling app', status: 'building' }, ...Array.from({ length: SYSTEM_SLOTS - 1 }, () => ({ name: '', status: 'planned' as const }))],
  }
}

// ---- Days ----

const pad = (n: number) => String(n).padStart(2, '0')

/** The local calendar date of a moment, as YYYY-MM-DD. */
export function keyOf(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** The day a moment belongs to: the day starts at `dayStart` o'clock, so 2 am still belongs to the day before. */
export function dayKey(now: Date, dayStart: number): string {
  return keyOf(new Date(now.getTime() - dayStart * 3_600_000))
}

export function parseKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function shiftKey(key: string, days: number): string {
  const date = parseKey(key)
  date.setDate(date.getDate() + days)
  return keyOf(date)
}

export function isKey(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && keyOf(parseKey(value)) === value
}

/** A day counts when the gym was done and the hours reached the bar. */
export function counts(entry: DayEntry | undefined, bar: number): boolean {
  return entry !== undefined && entry.gym && entry.hours >= bar
}

/** How full a day was, 0 (nothing) to 4 (the bar, with the gym): the four levels GitHub's year grid uses. */
export function level(entry: DayEntry | undefined, bar: number): number {
  if (!entry) return 0
  if (counts(entry, bar)) return 4
  if (entry.hours <= 0) return entry.gym ? 1 : 0
  const share = entry.hours / bar
  if (share >= 0.75) return 3
  if (share >= 0.4) return 2
  return 1
}

// ---- Streaks and sums ----

export interface Streaks {
  /** Days in a row that counted, up to today or (while today is still open) up to yesterday. */
  current: number
  best: number
  todayCounts: boolean
}

export function streaks(days: Record<string, DayEntry>, bar: number, today: string): Streaks {
  const todayCounts = counts(days[today], bar)
  let current = 0
  let key = todayCounts ? today : shiftKey(today, -1)
  while (counts(days[key], bar)) {
    current++
    key = shiftKey(key, -1)
  }
  const counted = Object.keys(days)
    .filter((k) => counts(days[k], bar))
    .sort()
  let best = 0
  let run = 0
  let previous: string | null = null
  for (const k of counted) {
    run = previous !== null && shiftKey(previous, 1) === k ? run + 1 : 1
    previous = k
    if (run > best) best = run
  }
  return { current, best: Math.max(best, current), todayCounts }
}

export interface Summary {
  weekHours: number
  weekDsa: number
  weekProblems: number
  weekAtBar: number
  monthAtBar: number
  monthDays: number
}

/** The last seven days (today included) and the calendar month so far. */
export function summary(days: Record<string, DayEntry>, bar: number, today: string): Summary {
  const out: Summary = { weekHours: 0, weekDsa: 0, weekProblems: 0, weekAtBar: 0, monthAtBar: 0, monthDays: 0 }
  for (let i = 0; i < 7; i++) {
    const entry = days[shiftKey(today, -i)]
    if (!entry) continue
    out.weekHours += entry.hours
    out.weekDsa += entry.dsa
    out.weekProblems += entry.problems
    if (counts(entry, bar)) out.weekAtBar++
  }
  const month = today.slice(0, 7)
  for (const key of Object.keys(days)) {
    if (!key.startsWith(month) || key > today) continue
    out.monthDays++
    if (counts(days[key], bar)) out.monthAtBar++
  }
  return out
}

// ---- The desk timer ----

const HOUR_MS = 3_600_000

/** Time on the clock: what is banked, plus the running stretch. */
export function timerElapsed(timer: Timer | undefined, now: number): number {
  if (!timer) return 0
  return timer.banked + (timer.startedAt === null ? 0 : Math.max(0, now - timer.startedAt))
}

/** Starts a stretch. A timer left from another day starts over for today. */
export function startTimer(timer: Timer | undefined, now: number, today: string): Timer {
  const fresh = !timer || timer.day !== today
  return { day: today, banked: fresh ? 0 : timer.banked, startedAt: now }
}

/** Banks the running stretch. A paused timer is returned as it is. */
export function pauseTimer(timer: Timer, now: number): Timer {
  return { ...timer, banked: timerElapsed(timer, now), startedAt: null }
}

/** Hours for a day entry, to the hundredth, never past a day. */
export function hoursOf(ms: number): number {
  return Math.min(MAX_HOURS, Math.round(ms / (HOUR_MS / 100)) / 100)
}

export function msOf(hours: number): number {
  return Math.round(hours * HOUR_MS)
}

/** h:mm:ss. */
export function formatClock(ms: number): string {
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return `${h}:${pad(m)}:${pad(s)}`
}

// ---- The verdict ----

export interface Verdict {
  headline: string
  lines: string[]
  /** The day counts. */
  ok: boolean
}

export function formatHours(hours: number): string {
  const rounded = Math.round(hours * 10) / 10
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)} h`
}

/** What the day says to its own face, next to yesterday's numbers. Plain, and never a pat on the back. */
export function verdict(today: DayEntry, yesterday: DayEntry | undefined, bar: number): Verdict {
  const missing: string[] = []
  if (today.hours < bar) missing.push(`${formatHours(bar - today.hours)} under the bar`)
  if (!today.gym) missing.push('gym not done')
  const lines: string[] = []
  if (yesterday) {
    lines.push(
      `Yesterday: ${formatHours(yesterday.hours)}, ${formatHours(yesterday.dsa)} of it DSA, ${plural(yesterday.problems, 'problem')}, gym ${yesterday.gym ? 'done' : 'missed'}.`,
    )
  } else {
    lines.push('No entry for yesterday.')
  }
  lines.push(`Today: ${formatHours(today.hours)}${missing.length ? `, ${missing.join(', ')}` : ', at the bar, gym done'}.`)
  if (yesterday) {
    const delta = today.problems - yesterday.problems
    if (delta > 0) lines.push(`${plural(delta, 'problem')} more than yesterday.`)
    else if (delta < 0) lines.push(`${plural(-delta, 'problem')} fewer than yesterday.`)
    else if (today.problems > 0) lines.push('Same problems as yesterday.')
  }
  if (today.hours > 0) lines.push(`DSA is ${Math.round((100 * today.dsa) / today.hours)}% of the day.`)
  const nothing = today.hours === 0 && !today.gym && today.problems === 0
  const headline = missing.length === 0 ? 'On the bar.' : nothing ? 'Nothing logged yet.' : 'Behind.'
  return { headline, lines, ok: missing.length === 0 }
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

// ---- The year grid ----

export interface YearGrid {
  /** 53 columns of 7 day keys, Monday first; the last column holds today. */
  weeks: string[][]
  /** Month labels, at the column where that month starts. */
  months: Array<{ label: string; column: number }>
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function yearGrid(today: string): YearGrid {
  const end = parseKey(today)
  // Back to the Monday that starts today's week, then 52 more weeks.
  const monday = (end.getDay() + 6) % 7
  const start = new Date(end)
  start.setDate(end.getDate() - monday - 52 * 7)
  const weeks: string[][] = []
  const months: YearGrid['months'] = []
  let lastMonth = -1
  for (let w = 0; w < 53; w++) {
    const week: string[] = []
    for (let d = 0; d < 7; d++) {
      const date = new Date(start)
      date.setDate(start.getDate() + w * 7 + d)
      week.push(keyOf(date))
    }
    const first = parseKey(week[0])
    if (first.getMonth() !== lastMonth) {
      // Skip a label squeezed into the first column by a month that ends a few days in.
      if (w > 0 || first.getDate() <= 7) months.push({ label: MONTHS[first.getMonth()], column: w })
      lastMonth = first.getMonth()
    }
    weeks.push(week)
  }
  return { weeks, months }
}

// ---- Storage ----

export const STORAGE_KEY = 'in-check:v1'

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function normalizeDay(value: unknown): DayEntry {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const hours = clampNumber(v.hours, 0, MAX_HOURS, 0)
  return {
    gym: v.gym === true,
    hours,
    dsa: clampNumber(v.dsa, 0, hours, 0),
    problems: Math.round(clampNumber(v.problems, 0, 1000, 0)),
    systems: v.systems === true,
    product: v.product === true,
    note: typeof v.note === 'string' ? v.note.slice(0, 20_000) : '',
  }
}

/** Reads a store out of untrusted JSON. Throws, with the reason, on anything that is not a store. */
export function normalizeStore(input: unknown): Store {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Not a tracker file: expected an object.')
  const raw = input as Record<string, unknown>
  if (raw.version !== SCHEMA_VERSION) throw new Error(`Not a tracker file: version ${String(raw.version)} is not ${SCHEMA_VERSION}.`)
  if (!raw.days || typeof raw.days !== 'object') throw new Error('Not a tracker file: no days.')
  const base = defaultStore()
  const settings = (raw.settings && typeof raw.settings === 'object' ? raw.settings : {}) as Record<string, unknown>
  const days: Record<string, DayEntry> = {}
  for (const [key, value] of Object.entries(raw.days as Record<string, unknown>)) {
    if (!isKey(key)) throw new Error(`Not a tracker file: "${key}" is not a date.`)
    days[key] = normalizeDay(value)
  }
  const systems = Array.isArray(raw.systems) ? raw.systems : []
  const slots: SystemSlot[] = base.systems.map((slot, i) => {
    const s = (systems[i] && typeof systems[i] === 'object' ? systems[i] : {}) as Record<string, unknown>
    const status = s.status === 'building' || s.status === 'shipped' || s.status === 'planned' ? s.status : slot.status
    return { name: typeof s.name === 'string' ? s.name.slice(0, 80) : systems[i] ? '' : slot.name, status }
  })
  const store: Store = {
    version: SCHEMA_VERSION,
    settings: {
      bar: clampNumber(settings.bar, 1, MAX_HOURS, DEFAULT_SETTINGS.bar),
      dayStart: Math.round(clampNumber(settings.dayStart, 0, 12, DEFAULT_SETTINGS.dayStart)),
    },
    days,
    systems: slots,
  }
  if (raw.timer !== undefined && raw.timer !== null) {
    const t = raw.timer as Record<string, unknown>
    if (typeof t !== 'object' || !isKey(t.day)) throw new Error('Not a tracker file: the timer has no day.')
    store.timer = {
      day: t.day,
      banked: clampNumber(t.banked, 0, MAX_HOURS * HOUR_MS, 0),
      startedAt: typeof t.startedAt === 'number' && Number.isFinite(t.startedAt) && t.startedAt > 0 ? t.startedAt : null,
    }
  }
  return store
}

export function serialize(store: Store): string {
  return JSON.stringify(store, null, 2)
}

/** The saved store, or a fresh one with the reason the saved one could not be read. */
export function loadStore(raw: string | null): { store: Store; problem: string | null } {
  if (raw === null) return { store: defaultStore(), problem: null }
  try {
    return { store: normalizeStore(JSON.parse(raw)), problem: null }
  } catch (error: unknown) {
    return { store: defaultStore(), problem: error instanceof Error ? error.message : String(error) }
  }
}
