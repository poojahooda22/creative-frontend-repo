import { describe, expect, it } from 'vitest'
import { counts, dayKey, defaultStore, formatClock, hoursOf, level, loadStore, msOf, normalizeStore, pauseTimer, serialize, shiftKey, startTimer, streaks, summary, timerElapsed, verdict, yearGrid, type DayEntry } from './model'

const day = (over: Partial<DayEntry>): DayEntry => ({ gym: false, hours: 0, dsa: 0, problems: 0, systems: false, product: false, note: '', ...over })
const full = day({ gym: true, hours: 22, dsa: 10, problems: 8 })

describe('days', () => {
  it('keeps work past midnight with the day it belongs to', () => {
    // 2:30 am on the 20th, with the day starting at 4, is still the 19th.
    expect(dayKey(new Date(2026, 9, 20, 2, 30), 4)).toBe('2026-10-19')
    expect(dayKey(new Date(2026, 9, 20, 4, 0), 4)).toBe('2026-10-20')
    expect(dayKey(new Date(2026, 9, 20, 2, 30), 0)).toBe('2026-10-20')
  })

  it('shifts across month and year ends', () => {
    expect(shiftKey('2026-10-31', 1)).toBe('2026-11-01')
    expect(shiftKey('2027-01-01', -1)).toBe('2026-12-31')
  })

  it('counts a day only with the gym and the bar', () => {
    expect(counts(full, 22)).toBe(true)
    expect(counts(day({ gym: true, hours: 21.5 }), 22)).toBe(false)
    expect(counts(day({ gym: false, hours: 24 }), 22)).toBe(false)
    expect(counts(undefined, 22)).toBe(false)
  })

  it('grades a day from nothing to the bar, in four levels', () => {
    expect(level(undefined, 22)).toBe(0)
    expect(level(day({ gym: true }), 22)).toBe(1)
    expect(level(day({ hours: 2 }), 22)).toBe(1)
    expect(level(day({ hours: 11 }), 22)).toBe(2)
    expect(level(day({ hours: 22 }), 22)).toBe(3)
    expect(level(full, 22)).toBe(4)
  })
})

describe('streaks', () => {
  const run = (keys: string[]) => Object.fromEntries(keys.map((k) => [k, full]))

  it('counts back from today, or from yesterday while today is still open', () => {
    const days = run(['2026-10-16', '2026-10-17', '2026-10-18'])
    expect(streaks(days, 22, '2026-10-19')).toEqual({ current: 3, best: 3, todayCounts: false })
    expect(streaks({ ...days, '2026-10-19': full }, 22, '2026-10-19').current).toBe(4)
  })

  it('breaks on a missed day and remembers the best run', () => {
    const days = { ...run(['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13']), '2026-10-14': day({ gym: true, hours: 20 }), ...run(['2026-10-18']) }
    expect(streaks(days, 22, '2026-10-19')).toEqual({ current: 1, best: 4, todayCounts: false })
  })

  it('is zero with nothing, or with two days off', () => {
    expect(streaks({}, 22, '2026-10-19').current).toBe(0)
    expect(streaks(run(['2026-10-16']), 22, '2026-10-19').current).toBe(0)
  })
})

describe('summary', () => {
  it('adds the last seven days and the month so far', () => {
    const days = {
      '2026-10-12': full, // eight days back: out of the week, in the month
      '2026-10-13': full,
      '2026-10-18': day({ gym: true, hours: 20, dsa: 8, problems: 3 }),
      '2026-10-19': day({ hours: 4, dsa: 4, problems: 2 }),
      '2026-10-20': full, // the future: not yet
    }
    expect(summary(days, 22, '2026-10-19')).toEqual({ weekHours: 46, weekDsa: 22, weekProblems: 13, weekAtBar: 1, monthAtBar: 2, monthDays: 4 })
  })
})

describe('verdict', () => {
  it('says behind, and by how much', () => {
    const v = verdict(day({ hours: 4, dsa: 3, problems: 5 }), full, 22)
    expect(v.headline).toBe('Behind.')
    expect(v.ok).toBe(false)
    expect(v.lines).toEqual(['Yesterday: 22 h, 10 h of it DSA, 8 problems, gym done.', 'Today: 4 h, 18 h under the bar, gym not done.', '3 problems fewer than yesterday.', 'DSA is 75% of the day.'])
  })

  it('says on the bar when the day counts', () => {
    const v = verdict(day({ gym: true, hours: 22.5, dsa: 12, problems: 9 }), full, 22)
    expect(v.headline).toBe('On the bar.')
    expect(v.ok).toBe(true)
    expect(v.lines[1]).toBe('Today: 22.5 h, at the bar, gym done.')
    expect(v.lines[2]).toBe('1 problem more than yesterday.')
  })

  it('handles a first day', () => {
    const v = verdict(day({}), undefined, 22)
    expect(v.headline).toBe('Nothing logged yet.')
    expect(v.lines[0]).toBe('No entry for yesterday.')
  })
})

describe('desk timer', () => {
  const t0 = 1_800_000_000_000

  it('banks each stretch on pause and keeps counting from the clock', () => {
    const started = startTimer(undefined, t0, '2026-10-20')
    expect(started).toEqual({ day: '2026-10-20', banked: 0, startedAt: t0 })
    expect(timerElapsed(started, t0 + 90_000)).toBe(90_000)
    const paused = pauseTimer(started, t0 + 90_000)
    expect(paused).toEqual({ day: '2026-10-20', banked: 90_000, startedAt: null })
    expect(timerElapsed(paused, t0 + 999_999)).toBe(90_000)
    const again = startTimer(paused, t0 + 200_000, '2026-10-20')
    expect(timerElapsed(again, t0 + 260_000)).toBe(150_000)
  })

  it('starts over on a new day, and never counts backwards', () => {
    const yesterday = { day: '2026-10-19', banked: 7_200_000, startedAt: null }
    expect(startTimer(yesterday, t0, '2026-10-20')).toEqual({ day: '2026-10-20', banked: 0, startedAt: t0 })
    expect(timerElapsed({ day: '2026-10-20', banked: 1000, startedAt: t0 }, t0 - 5000)).toBe(1000)
  })

  it('turns milliseconds into hours to the hundredth, and back', () => {
    expect(hoursOf(0)).toBe(0)
    expect(hoursOf(3_600_000)).toBe(1)
    expect(hoursOf(5_400_000)).toBe(1.5)
    expect(hoursOf(4_000_000)).toBe(1.11)
    expect(hoursOf(99 * 3_600_000)).toBe(24)
    expect(msOf(1.11)).toBe(3_996_000)
  })

  it('shows a clock', () => {
    expect(formatClock(0)).toBe('0:00:00')
    expect(formatClock(3_661_000)).toBe('1:01:01')
    expect(formatClock(23 * 3_600_000 + 59 * 60_000 + 59_999)).toBe('23:59:59')
  })

  it('survives a save with the timer, and refuses a timer without a day', () => {
    const store = defaultStore()
    store.timer = { day: '2026-10-20', banked: 90_000, startedAt: t0 }
    expect(loadStore(serialize(store))).toEqual({ store, problem: null })
    expect(normalizeStore({ version: 1, days: {}, timer: { day: '2026-10-20', banked: -5, startedAt: 'now' } }).timer).toEqual({ day: '2026-10-20', banked: 0, startedAt: null })
    expect(() => normalizeStore({ version: 1, days: {}, timer: { banked: 1 } })).toThrow('the timer has no day')
  })
})

describe('year grid', () => {
  it('ends on the week that holds today, Monday first', () => {
    const grid = yearGrid('2026-10-19') // a Monday
    expect(grid.weeks).toHaveLength(53)
    expect(grid.weeks[52][0]).toBe('2026-10-19')
    expect(grid.weeks[52][6]).toBe('2026-10-25')
    expect(grid.weeks[0][0]).toBe('2025-10-20')
    expect(grid.months.map((m) => m.label)).toEqual(['Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'])
  })
})

describe('storage', () => {
  it('round-trips a store', () => {
    const store = defaultStore()
    store.days['2026-10-19'] = day({ gym: true, hours: 23, dsa: 11.5, problems: 7, note: 'Trees: 7 to optimal.' })
    store.systems[1] = { name: 'Payments ledger', status: 'planned' }
    expect(loadStore(serialize(store))).toEqual({ store, problem: null })
  })

  it('starts fresh with nothing saved, and reports what it could not read', () => {
    expect(loadStore(null)).toEqual({ store: defaultStore(), problem: null })
    expect(loadStore('{not json').problem).toMatch(/JSON/)
    expect(loadStore('{"version":2,"days":{}}').problem).toBe('Not a tracker file: version 2 is not 1.')
  })

  it('refuses a file that is not a store, and clamps what is', () => {
    expect(() => normalizeStore({ version: 1, days: { 'not a date': {} } })).toThrow('"not a date" is not a date')
    expect(() => normalizeStore([])).toThrow('expected an object')
    const store = normalizeStore({ version: 1, days: { '2026-10-19': { hours: 40, dsa: 99, problems: '3', gym: 'yes' } }, settings: { bar: 0, dayStart: 30 } })
    expect(store.days['2026-10-19']).toEqual(day({ hours: 24, dsa: 24, problems: 3, gym: false }))
    expect(store.settings).toEqual({ bar: 1, dayStart: 12 })
  })
})
