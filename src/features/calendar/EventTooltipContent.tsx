import { Building2, Lock, MapPin } from 'lucide-react'
import type { CalendarEventWithId } from './calendarTypes'
import { evStatus, evType } from './calendarTypes'

/** İmleç etkinlik üzerine gelince (modal açmadan) tür/durum/yer/birim özetini gösteren tooltip içeriği. */
export function EventTooltipContent({ ev, timeLabel }: { ev: CalendarEventWithId; timeLabel: string }) {
  const ty = evType(ev.tur)
  const st = evStatus(ev.durum)
  return (
    <div className="flex max-w-64 flex-col gap-1 text-xs">
      <div className="font-semibold">{ev.ad || '(adsız)'}</div>
      <div className="flex items-center gap-1.5 opacity-80">
        <span className="size-2 shrink-0 rounded-full" style={{ background: ty.renk }} />
        {ty.ad} · {st.ad}
      </div>
      <div className="opacity-80">{timeLabel}</div>
      {ev.yer && (
        <div className="flex items-center gap-1.5 opacity-80">
          <MapPin size={11} className="shrink-0" />
          <span className="truncate">{ev.yer}</span>
        </div>
      )}
      {ev.birim && (
        <div className="flex items-center gap-1.5 opacity-80">
          <Building2 size={11} className="shrink-0" />
          <span className="truncate">{ev.birim}</span>
        </div>
      )}
      {ev.locked && (
        <div className="flex items-center gap-1.5 opacity-80">
          <Lock size={11} className="shrink-0" />
          Kilitli
        </div>
      )}
    </div>
  )
}
