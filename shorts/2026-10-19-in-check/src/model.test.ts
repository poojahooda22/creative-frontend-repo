import { describe, expect, it } from 'vitest'
import { counts, dayKey, defaultStore, level, loadStore, normalizeStore, serialize, shiftKey, streaks, summary, verdict, yearGrid, type DayEntry } from './model'

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

  it('grades a day from nothing to the bar', () => {
    expect(level(undefined, 22)).toBe(0)
    expect(level(day({ hours: 2 }), 22)).toBe(1)
    expect(level(day({ hours: 11 }), 22)).toBe(3)
    expect(level(day({ hours: 22 }), 22)).toBe(4)
    expect(level(full, 22)).toBe(5)
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
    expect(v.lines).toEqual(['Yesterday: 22 h, 10 h of it DSA, 8 problems, gym done.', 'Today: 4 h, 18 h under the bar, gym not done.', '3 problems fewer than yesterday.', 'DSA is 75% of the day.'])
  })

  it('says on the bar when the day counts', () => {
    const v = verdict(day({ gym: true, hours: 22.5, dsa: 12, problems: 9 }), full, 22)
    expect(v.headline).toBe('On the bar.')
    expect(v.lines[1]).toBe('Today: 22.5 h, at the bar, gym done.')
    expect(v.lines[2]).toBe('1 problem more than yesterday.')
  })

  it('handles a first day', () => {
    const v = verdict(day({}), undefined, 22)
    expect(v.headline).toBe('Nothing logged yet.')
    expect(v.lines[0]).toBe('No entry for yesterday.')
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
