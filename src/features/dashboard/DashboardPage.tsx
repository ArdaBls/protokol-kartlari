import { Camera, Flame } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../auth/useAuth'
import { NumberTicker } from '../../components/motion/NumberTicker'
import { useDbValue } from '../../hooks/useDbValue'
import { useNow } from '../../hooks/useNow'
import { eligibleForStats, photoEstimate, rosterNames } from '../../lib/activityStats'
import { getEventEndDate, toEventList } from '../../lib/eventOverview'
import type { CalendarEventRecord } from '../../lib/eventOverview'
import type { UserProfile } from '../../lib/roles'
import { CountdownCard } from './CountdownCard'
import { ConcertTicketPopup } from './ConcertTicketPopup'
import { EditorActivityCard } from './EditorActivityCard'
import { EventOverviewCard } from './EventOverviewCard'
import { StatCard } from './StatCard'
import { TasksCard } from './TasksCard'

// Etkinliğin zamanı hiçbir alan değişmeden dolar ("Şu anda" → "Bitti"); dakikada bir yeniden hesaplanır.
const RECLASSIFY_MS = 60_000

const formatTr = (n: number) => n.toLocaleString('tr-TR')

const localDayKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

export function DashboardPage() {
  const { streak, state } = useAuth()
  const now = useNow(RECLASSIFY_MS)
  const events = useDbValue<Record<string, CalendarEventRecord | null>>('etkinlikler')
  // users/ yalnızca admin/kurucuya açık; editörde hata döner ve isimler etkinliklerden türetilir.
  const users = useDbValue<Record<string, UserProfile | null>>('users', { shadow: false })

  const eventList = useMemo(() => toEventList(events.data), [events.data])
  const statsEvents = useMemo(() => eligibleForStats(eventList, now), [eventList, now])
  const names = useMemo(() => rosterNames(users.data, statsEvents), [users.data, statsEvents])
  const photos = useMemo(() => photoEstimate(statsEvents), [statsEvents])
  const activeConcert = useMemo(() => {
    const today = localDayKey(now)
    return eventList.find((event) => {
      if (event.tur !== 'konser' || event.durum === 'iptal' || event.tarih !== today) return false
      const end = getEventEndDate(event)
      return !!end && end.getTime() > now.getTime()
    }) ?? null
  }, [eventList, now])
  const ticketUserId = state.status === 'ready' ? state.user.uid : 'anon'
  const ticketUserName = state.status === 'ready' ? state.displayName : ''
  const ticketStorageKey = activeConcert ? `concertTicketShown:${ticketUserId}:${activeConcert._id}:${localDayKey(now)}` : ''
  const [isTicketOpen, setIsTicketOpen] = useState(false)

  useEffect(() => {
    if (!activeConcert || !ticketStorageKey) {
      setIsTicketOpen(false)
      return
    }
    try {
      if (window.localStorage.getItem(ticketStorageKey) !== '1') {
        window.localStorage.setItem(ticketStorageKey, '1')
        setIsTicketOpen(true)
      }
    } catch {
      setIsTicketOpen(true)
    }
  }, [activeConcert, ticketStorageKey])

  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-6">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wider text-muted">Genel Bakış</div>
        <h1 className="mt-1 text-2xl font-semibold">Operasyonlar</h1>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <StatCard
          icon={Flame}
          iconClass="bg-warning/15 text-warning"
          label="Giriş serisi"
          value={streak ? <NumberTicker value={streak.count} suffix=" gün" /> : '—'}
          sub={streak ? `En uzun seri: ${streak.longest} gün` : 'Yükleniyor…'}
        />
        <CountdownCard />
        <StatCard
          icon={Camera}
          iconClass="bg-success/15 text-success"
          label="Tahmini çekilen fotoğraf"
          value={events.isLoading || photos <= 0 ? '—' : <NumberTicker value={photos} suffix="+" format={formatTr} />}
        />
      </div>

      <div className="grid min-w-0 gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
          <EditorActivityCard names={names} events={statsEvents} isLoading={events.isLoading || users.isLoading} now={now} />
          <TasksCard hasConcertTicket={!!activeConcert} onOpenConcertTicket={() => setIsTicketOpen(true)} />
        </div>
        <div className="min-w-0">
          <EventOverviewCard events={eventList} isLoading={events.isLoading} hasError={!!events.error} now={now} />
        </div>
      </div>
      {activeConcert && (
        <ConcertTicketPopup
          event={activeConcert}
          userName={ticketUserName}
          isOpen={isTicketOpen}
          onClose={() => setIsTicketOpen(false)}
        />
      )}
    </div>
  )
}
