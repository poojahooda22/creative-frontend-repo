// The two pictures of the record: the last fourteen days as bars against the bar, and the year as
// a grid of shaded cells. Both are SVG drawn from the day entries, in the page's own shades.
import { counts, formatHours, level, MAX_HOURS, parseKey, shiftKey, yearGrid, type DayEntry } from './model'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function longDate(key: string): string {
  return parseKey(key).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
}

function describe(key: string, entry: DayEntry | undefined, bar: number): string {
  if (!entry) return `${longDate(key)}: nothing logged`
  return `${longDate(key)}: ${formatHours(entry.hours)}, ${formatHours(entry.dsa)} DSA, ${entry.problems} problems, gym ${entry.gym ? 'done' : 'missed'}${counts(entry, bar) ? ', counted' : ''}`
}

interface ChartProps {
  days: Record<string, DayEntry>
  bar: number
  today: string
}

/**
 * Fourteen days of hours as columns, DSA hours inside each, the bar drawn across, today outlined.
 * Laid out in HTML so the columns take the width they are given and the type stays its own size.
 */
export function Bars({ days, bar, today }: ChartProps) {
  const keys = Array.from({ length: 14 }, (_, i) => shiftKey(today, i - 13))
  const share = (hours: number) => `${(100 * hours) / MAX_HOURS}%`
  return (
    <div className="bars" role="img" aria-label={`Hours over the last fourteen days against a bar of ${bar}`}>
      <div className="bars__tracks">
        <div className="bars__line" style={{ bottom: share(bar) }} />
        {keys.map((key) => {
          const entry = days[key]
          const hours = entry?.hours ?? 0
          const dsa = entry?.dsa ?? 0
          const counted = counts(entry, bar) ? ' bars__track--counted' : ''
          return (
            <div key={key} className={`bars__track${counted}${key === today ? ' bars__track--today' : ''}`} title={describe(key, entry, bar)}>
              {hours > 0 && <div className="bars__hours" style={{ height: share(hours) }} />}
              {dsa > 0 && <div className="bars__dsa" style={{ height: share(dsa) }} />}
            </div>
          )
        })}
      </div>
      <div className="bars__row" aria-hidden="true">
        {keys.map((key) => (
          <span key={key} className={days[key]?.gym ? 'bars__gym bars__gym--done' : 'bars__gym'} />
        ))}
      </div>
      <div className="bars__row" aria-hidden="true">
        {keys.map((key) => (
          <span key={key} className="bars__label">
            {parseKey(key).getDate()}
          </span>
        ))}
      </div>
    </div>
  )
}

/** The year as 53 weeks of seven cells, shaded by how full each day was. */
export function Heatmap({ days, bar, today }: ChartProps) {
  const grid = yearGrid(today)
  const cell = 11
  const gap = 3
  const step = cell + gap
  const left = 30
  const topPad = 18
  const width = left + 53 * step - gap
  const height = topPad + 7 * step - gap
  return (
    <svg className="heatmap" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="The last year, one cell a day, shaded by hours worked">
      {grid.months.map((m) => (
        <text key={`${m.label}-${m.column}`} className="heatmap__label" x={left + m.column * step} y={11}>
          {m.label}
        </text>
      ))}
      {[0, 2, 4, 6].map((d) => (
        <text key={d} className="heatmap__label" x={0} y={topPad + d * step + cell - 1.5}>
          {WEEKDAYS[d]}
        </text>
      ))}
      {grid.weeks.map((week, w) =>
        week.map((key, d) => {
          if (key > today) return null
          const entry = days[key]
          return (
            <rect
              key={key}
              className={`heatmap__cell heatmap__cell--${level(entry, bar)}${key === today ? ' heatmap__cell--today' : ''}`}
              x={left + w * step}
              y={topPad + d * step}
              width={cell}
              height={cell}
              rx={2.5}
            >
              <title>{describe(key, entry, bar)}</title>
            </rect>
          )
        }),
      )}
    </svg>
  )
}
