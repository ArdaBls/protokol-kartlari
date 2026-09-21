import { Camera, Flame } from 'lucide-react'
import { useMemo } from 'react'
import { useAuth } from '../../auth/useAuth'
import { NumberTicker } from '../../components/motion/NumberTicker'
import { useDbValue } from '../../hooks/useDbValue'
import { useNow } from '../../hooks/useNow'
import { eligibleForStats, photoEstimate, rosterNames } from '../../lib/activityStats'
import { toEventList } from '../../lib/eventOverview'
import type { CalendarEventRecord } from '../../lib/eventOverview'
import type { UserProfile } from '../../lib/roles'
import { CountdownCard } from './CountdownCard'
import { EditorActivityCard } from './EditorActivityCard'
import { EventOverviewCard } from './EventOverviewCard'
import { StatCard } from './StatCard'
import { TasksCard } from './TasksCard'

// Etkinliğin zamanı hiçbir alan değişmeden dolar ("Şu anda" → "Bitti"); dakikada bir yeniden hesaplanır.
const RECLASSIFY_MS = 60_000

const formatTr = (n: number) => n.toLocaleString('tr-TR')

export function DashboardPage() {
  const { streak } = useAuth()
  const now = useNow(RECLASSIFY_MS)
  const events = useDbValue<Record<string, CalendarEventRecord | null>>('etkinlikler')
  // users/ yalnızca admin/kurucuya açık; editörde hata döner ve isimler etkinliklerden türetilir.
  const users = useDbValue<Record<string, UserProfile | null>>('users', { shadow: false })

  const eventList = useMemo(() => toEventList(events.data), [events.data])
  const statsEvents = useMemo(() => eligibleForStats(eventList, now), [eventList, now])
  const names = useMemo(() => rosterNames(users.data, statsEvents), [users.data, statsEvents])
  const photos = useMemo(() => photoEstimate(statsEvents), [statsEvents])

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
          <TasksCard />
        </div>
        <div className="min-w-0">
          <EventOverviewCard events={eventList} isLoading={events.isLoading} hasError={!!events.error} now={now} />
        </div>
      </div>
    </div>
  )
}
