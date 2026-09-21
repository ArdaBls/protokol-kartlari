import { Tooltip } from '@heroui/react'
import { Lock, Plus } from 'lucide-react'
import { dateKey } from '../../lib/dates'
import type { CalendarEventWithId } from './calendarTypes'
import { CAL_DOW, addDays, evType, fmtMultiDayRange, isSameDay, startOfWeek, todayDate } from './calendarTypes'
import { EventTooltipContent } from './EventTooltipContent'

interface MonthViewProps {
  anchor: Date
  eventsByDate: Map<string, CalendarEventWithId[]>
  canWrite: boolean
  onEdit: (id: string) => void
  onCreate: (dateKey: string) => void
  onShowMore: (dateKey: string, events: CalendarEventWithId[]) => void
}

const MAX_CHIPS = 3

export function MonthView({ anchor, eventsByDate, canWrite, onEdit, onCreate, onShowMore }: MonthViewProps) {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
  const start = startOfWeek(first)
  const today = todayDate()
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i))

  return (
    <div className="flex flex-col">
      <div className="grid grid-cols-7 border-b border-separator">
        {CAL_DOW.map((d) => (
          <div key={d} className="px-2 py-1.5 text-center text-xs font-medium text-muted">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const key = dateKey(day)
          const weekday = (day.getDay() + 6) % 7
          const isOtherMonth = day.getMonth() !== anchor.getMonth()
          const events = eventsByDate.get(key) ?? []
          const shown = events.slice(0, MAX_CHIPS)
          return (
            <div
              key={key}
              className={`group flex min-h-[104px] flex-col gap-1 border-b border-r border-separator p-1.5 last:border-r-0 ${isOtherMonth ? 'bg-default/20 text-muted' : ''} ${weekday >= 5 ? 'bg-default/10' : ''}`}
            >
              <div className="flex items-center justify-between">
                <span className={`flex size-6 items-center justify-center rounded-full text-xs ${isSameDay(day, today) ? 'bg-accent font-semibold text-accent-foreground' : ''}`}>{day.getDate()}</span>
                {canWrite && (
                  <button type="button" onClick={() => onCreate(key)} aria-label="Bu güne etkinlik ekle" className="flex size-5 items-center justify-center rounded text-muted opacity-0 hover:bg-default hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100">
                    <Plus size={13} />
                  </button>
                )}
              </div>
              <div className="flex flex-col gap-0.5">
                {shown.map((ev) => {
                  const ty = evType(ev.tur)
                  const isMultiDay = !!ev.bitisTarihi && ev.bitisTarihi !== ev.tarih
                  return (
                    <Tooltip.Root key={ev._id} delay={0} closeDelay={0}>
                      <Tooltip.Trigger>
                        <button
                          type="button"
                          onClick={() => onEdit(ev._id)}
                          style={{ background: `${ty.renk}d9` }}
                          className={`flex w-full items-center gap-1 rounded-md px-1.5 py-0.5 text-left text-[11px] leading-tight text-white ${ev.durum === 'tamamlandi' ? 'opacity-70' : ''} ${ev.durum === 'iptal' ? 'line-through opacity-60' : ''} ${ev.taslak ? 'cal-taslak' : ''}`}
                        >
                          {ev.locked && <Lock size={9} className="shrink-0" />}
                          <span className="min-w-0 truncate">
                            {isMultiDay ? `${fmtMultiDayRange(ev.tarih, ev.bitisTarihi ?? undefined)} · ` : ev.saat ? `${ev.saat} · ` : ''}
                            {ev.ad || '(adsız)'}
                          </span>
                        </button>
                      </Tooltip.Trigger>
                      <Tooltip.Content showArrow>
                        <EventTooltipContent ev={ev} timeLabel={isMultiDay ? fmtMultiDayRange(ev.tarih, ev.bitisTarihi ?? undefined) : ev.saat || '—'} />
                      </Tooltip.Content>
                    </Tooltip.Root>
                  )
                })}
                {events.length > shown.length && (
                  <button type="button" onClick={() => onShowMore(key, events)} className="truncate rounded-md px-1.5 py-0.5 text-left text-[11px] text-muted hover:bg-default">
                    +{events.length - shown.length} tane daha
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
