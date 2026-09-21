import { Button, Card, Chip, Separator } from '@heroui/react'
import { Pencil } from 'lucide-react'
import { Fragment, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { MONTHS_SHORT } from '../../lib/dates'
import { getEventEndDate, getEventStartDate, getOverviewBuckets, isOngoing } from '../../lib/eventOverview'
import type { CalendarEvent, OverviewBuckets } from '../../lib/eventOverview'

interface EventOverviewCardProps {
  events: CalendarEvent[]
  isLoading: boolean
  hasError: boolean
  now: Date
}

const SECTIONS: Array<{ key: keyof OverviewBuckets; title: string; empty: string; dateClass: string }> = [
  { key: 'today', title: 'Bugün / Şimdiki Etkinlikler', empty: 'Bugün için planlanmış veya devam eden bir etkinlik yok.', dateClass: 'bg-success/15 text-success' },
  { key: 'week', title: 'Bu Haftadaki Etkinlikler', empty: 'Bu hafta başka etkinlik yok.', dateClass: 'bg-warning/15 text-warning' },
  { key: 'upcoming', title: 'Yaklaşan Etkinlikler', empty: 'Önümüzdeki 30 günde başka etkinlik yok.', dateClass: 'bg-accent/15 text-accent' },
]

const shortDate = (d: Date) => `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`

function EventBadge({ event, now }: { event: CalendarEvent; now: Date }) {
  if (isOngoing(event, now)) return <Chip size="sm" color="success" variant="primary">Şu anda</Chip>
  if (getEventStartDate(event)?.toDateString() !== now.toDateString()) return null
  const end = getEventEndDate(event)
  return end && end < now ? <Chip size="sm" variant="soft">Bitti</Chip> : <Chip size="sm" color="accent" variant="soft">Bugün</Chip>
}

function EventRow({ event, now, dateClass }: { event: CalendarEvent; now: Date; dateClass: string }) {
  const navigate = useNavigate()
  const start = getEventStartDate(event)
  const end = getEventEndDate(event)
  const isMultiDay = !!event.bitisTarihi && event.bitisTarihi !== event.tarih
  const meta = [event.saat && `${event.saat}${event.bitisSaat ? `–${event.bitisSaat}` : ''}`, event.yer || event.birim]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="group flex items-center gap-3 py-2">
      <span className={`flex h-11 min-w-11 shrink-0 flex-col items-center justify-center rounded-xl px-1.5 leading-none ${dateClass}`} aria-hidden="true">
        {isMultiDay && start && end ? (
          <span className="text-center text-[10px] font-semibold leading-tight">
            {start.getDate()}–{end.getDate()}
            <br />
            {MONTHS_SHORT[end.getMonth()]}
          </span>
        ) : (
          <>
            <span className="text-base font-bold">{start?.getDate() ?? '?'}</span>
            <span className="mt-0.5 text-[10px] font-medium uppercase">{start ? MONTHS_SHORT[start.getMonth()] : ''}</span>
          </>
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{event.ad || '(adsız)'}</div>
        <div className="truncate text-xs text-muted">{meta || (start ? shortDate(start) : '')}</div>
      </div>
      <EventBadge event={event} now={now} />
      <Button
        isIconOnly
        size="sm"
        variant="ghost"
        aria-label={`${event.ad || 'Etkinliği'} düzenle`}
        className="size-7 min-w-7 opacity-60 group-hover:opacity-100"
        onPress={() => navigate(`/takvim?duzenle=${encodeURIComponent(event._id)}`)}
      >
        <Pencil size={13} />
      </Button>
    </div>
  )
}

export function EventOverviewCard({ events, isLoading, hasError, now }: EventOverviewCardProps) {
  const buckets = useMemo(() => getOverviewBuckets(events, now), [events, now])

  return (
    <Card className="flex flex-col">
      <Card.Header>
        <Card.Title>Etkinlik Özeti</Card.Title>
      </Card.Header>
      <Card.Content className="flex-1 overflow-y-auto">
        {hasError && <p className="text-sm text-danger">Etkinlikler yüklenemedi.</p>}
        {isLoading && <p className="text-sm text-muted">Yükleniyor…</p>}
        {!isLoading && !hasError &&
          SECTIONS.map((section, i) => (
            <Fragment key={section.key}>
              {i > 0 && <Separator className="my-3" />}
              <section>
                <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">{section.title}</h4>
                {buckets[section.key].length === 0 ? (
                  <p className="py-2 text-sm text-muted">{section.empty}</p>
                ) : (
                  buckets[section.key].map((event) => (
                    <EventRow key={event._id} event={event} now={now} dateClass={section.dateClass} />
                  ))
                )}
              </section>
            </Fragment>
          ))}
      </Card.Content>
    </Card>
  )
}
