import { Lock } from 'lucide-react'
import type { CalendarEventWithId } from './calendarTypes'
import { CAL_DOW, evStatus, evType, fmtMultiDayRange, fmtTrDate, isSameDay, parseKey, todayDate } from './calendarTypes'

interface ListViewProps {
  events: CalendarEventWithId[]
  onEdit: (id: string) => void
}

export function ListView({ events, onEdit }: ListViewProps) {
  if (!events.length) return <p className="py-16 text-center text-sm text-muted">Etkinlik yok.</p>

  const today = todayDate()
  let lastDay = ''

  return (
    <div className="flex flex-col">
      {events.map((ev) => {
        const showSeparator = ev.tarih !== lastDay
        if (showSeparator) lastDay = ev.tarih ?? ''
        const date = parseKey(ev.tarih)
        const isToday = isSameDay(date, today)
        const ty = evType(ev.tur)
        const st = evStatus(ev.durum)
        const isMultiDay = !!ev.bitisTarihi && ev.bitisTarihi !== ev.tarih
        const isPast = !!date && date < today
        const meta = [ev.yer, ev.birim].filter(Boolean).join(' · ')
        return (
          <div key={ev._id}>
            {showSeparator && (
              <div className={`flex items-baseline gap-2 border-b border-separator px-3 py-2 text-sm font-semibold ${isToday ? 'text-accent' : ''}`}>
                {fmtTrDate(ev.tarih)}
                <span className="text-xs font-normal text-muted">{date && CAL_DOW[(date.getDay() + 6) % 7]}{isToday && ' · BUGÜN'}</span>
              </div>
            )}
            <button type="button" onClick={() => onEdit(ev._id)} className="flex w-full items-center gap-3 border-b border-separator px-3 py-2.5 text-left hover:bg-default/50">
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: ty.renk }} />
              <span className="w-20 shrink-0 text-xs tabular-nums text-muted">{isMultiDay ? fmtMultiDayRange(ev.tarih, ev.bitisTarihi ?? undefined) : ev.saat || '—'}</span>
              <span className="min-w-0 flex-1">
                <span className={`block truncate text-sm font-medium ${ev.durum === 'tamamlandi' || ev.durum === 'iptal' || isPast ? 'text-muted line-through' : ''}`}>
                  {ev.ad || '(adsız)'}
                  {ev.locked && <Lock size={11} className="ml-1.5 inline text-muted" />}
                </span>
                <span className="flex items-center gap-2 text-xs text-muted">
                  <span className="rounded-full px-1.5 py-0.5 text-[10px] text-white" style={{ background: st.renk }}>{st.ad}</span>
                  {meta}
                </span>
              </span>
            </button>
          </div>
        )
      })}
    </div>
  )
}
