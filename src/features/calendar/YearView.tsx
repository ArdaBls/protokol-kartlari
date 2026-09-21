import { dateKey } from '../../lib/dates'
import type { CalendarEventWithId } from './calendarTypes'
import { CAL_DOW, CAL_MONTHS, addDays, evType, fmtTrDate, isSameDay, startOfWeek, todayDate } from './calendarTypes'

interface YearViewProps {
  year: number
  eventsByDate: Map<string, CalendarEventWithId[]>
  onGoToDay: (dateKey: string) => void
  onGoToMonth: (month: number) => void
}

export function YearView({ year, eventsByDate, onGoToDay, onGoToMonth }: YearViewProps) {
  const today = todayDate()
  return (
    <div className="grid grid-cols-1 gap-4 overflow-y-auto p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 12 }, (_, month) => {
        const start = startOfWeek(new Date(year, month, 1))
        const days = Array.from({ length: 42 }, (_, i) => addDays(start, i))
        return (
          <div key={month} className="flex flex-col gap-2 rounded-2xl border border-separator bg-surface-secondary/40 p-3">
            <button type="button" onClick={() => onGoToMonth(month)} className="w-fit text-sm font-semibold hover:text-accent">
              {CAL_MONTHS[month]}
            </button>
            <div className="grid grid-cols-7 gap-y-1 text-center text-[10px]">
              {CAL_DOW.map((d) => (
                <span key={d} className="pb-1 font-medium text-muted">{d.charAt(0)}</span>
              ))}
              {days.map((day, i) => {
                if (day.getMonth() !== month) return <span key={i} className="flex size-7 items-center justify-center justify-self-center text-[11px] text-muted/30">{day.getDate()}</span>
                const key = dateKey(day)
                const events = eventsByDate.get(key) ?? []
                const colors = [...new Set(events.map((ev) => evType(ev.tur).renk))].slice(0, 3)
                const isToday = isSameDay(day, today)
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => onGoToDay(key)}
                    title={`${fmtTrDate(key)}${events.length ? ` · ${events.length} etkinlik` : ''}`}
                    style={!isToday && colors.length ? { background: `${colors[0]}26` } : undefined}
                    className={`relative flex size-7 flex-col items-center justify-center justify-self-center rounded-full hover:bg-default ${isToday ? 'bg-accent-soft font-semibold text-accent' : ''}`}
                  >
                    <span className="text-[11px] leading-none">{day.getDate()}</span>
                    {colors.length > 0 && (
                      <span className="mt-0.5 flex gap-0.5">
                        {colors.map((c) => (
                          <span key={c} className="size-1 rounded-full" style={{ background: isToday ? '#fff' : c }} />
                        ))}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
