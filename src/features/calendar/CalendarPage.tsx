import { Button } from '@heroui/react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { dateKey } from '../../lib/dates'
import { useDbValue } from '../../hooks/useDbValue'
import { useDbMode } from '../../lib/dbMode'
import { useAuth } from '../../auth/useAuth'
import { isApprovedRole } from '../../lib/roles'
import { EventModal } from './EventModal'
import { ListView } from './ListView'
import { MonthView } from './MonthView'
import { WeekView } from './WeekView'
import { YearView } from './YearView'
import type { CalendarEvent, CalendarEventWithId } from './calendarTypes'
import { CAL_MONTHS, addDays, calVisibleWeekDays, parseKey, toEventListWithId, todayDate } from './calendarTypes'

type CalView = 'day' | 'week' | 'month' | 'year' | 'list'

const VIEW_TABS: Array<{ key: CalView; label: string }> = [
  { key: 'day', label: 'Gün' },
  { key: 'week', label: 'Hafta' },
  { key: 'month', label: 'Ay' },
  { key: 'year', label: 'Yıl' },
  { key: 'list', label: 'Liste' },
]

function useDayCount(view: CalView): number {
  const [count, setCount] = useState(7)
  useEffect(() => {
    if (view !== 'week') return
    const update = () => {
      if (window.matchMedia('(max-width:700px)').matches) setCount(3)
      else if (window.matchMedia('(max-width:1049px)').matches) setCount(5)
      else setCount(7)
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [view])
  return view === 'day' ? 1 : count
}

export function CalendarPage() {
  const { state } = useAuth()
  const { isReadOnly } = useDbMode()
  const [searchParams, setSearchParams] = useSearchParams()
  const [view, setView] = useState<CalView>('week')
  const [anchor, setAnchor] = useState(() => todayDate())
  const [editing, setEditing] = useState<{ id: string | null; presetDate?: string; presetTime?: string; presetEndTime?: string } | null>(null)
  const [moreDay, setMoreDay] = useState<{ dateKey: string; events: CalendarEventWithId[] } | null>(null)

  const events = useDbValue<Record<string, CalendarEvent | null>>('etkinlikler')
  const dayCount = useDayCount(view)

  const canWrite = state.status === 'ready' && isApprovedRole(state.role) && !isReadOnly

  const allEvents = useMemo(() => {
    const list = toEventListWithId(events.data)
    list.sort((a, b) => {
      if (a.tarih !== b.tarih) return (a.tarih ?? '') < (b.tarih ?? '') ? -1 : 1
      const sa = a.saat ?? null
      const sb = b.saat ?? null
      if (sa === null && sb !== null) return -1
      if (sb === null && sa !== null) return 1
      if (sa !== null && sb !== null && sa !== sb) return sa.localeCompare(sb)
      return (a.ad ?? '').localeCompare(b.ad ?? '', 'tr')
    })
    return list
  }, [events.data])

  // Etkinlik Özeti'ndeki kalem, etkinlik kimliğiyle buraya gelir. Veriler yüklendiğinde
  // doğrudan etkinliğin başlangıç gününü açıp düzenleme modalını gösterir.
  useEffect(() => {
    const eventId = searchParams.get('duzenle')
    if (!eventId || events.isLoading || events.error || !events.data) return
    const event = events.data[eventId]
    const eventDate = parseKey(event?.tarih)
    if (event && eventDate) {
      setAnchor(eventDate)
      setView('day')
      setEditing({ id: eventId })
    }
    setSearchParams({}, { replace: true })
  }, [events.data, events.error, events.isLoading, searchParams, setSearchParams])

  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEventWithId[]>()
    allEvents.forEach((ev) => {
      if (!ev.tarih) return
      if (!map.has(ev.tarih)) map.set(ev.tarih, [])
      map.get(ev.tarih)!.push(ev)
    })
    return map
  }, [allEvents])

  const days = useMemo(() => calVisibleWeekDays(anchor, dayCount), [anchor, dayCount])

  const monthLabel = useMemo(() => {
    if (view === 'day') return `${anchor.getDate()} ${CAL_MONTHS[anchor.getMonth()]} ${anchor.getFullYear()}`
    if (view === 'week') {
      const s = days[0]
      const e = days[days.length - 1]
      if (s.getMonth() === e.getMonth()) return `${CAL_MONTHS[s.getMonth()]} ${s.getFullYear()}`
      if (s.getFullYear() === e.getFullYear()) return `${CAL_MONTHS[s.getMonth()].slice(0, 3)}–${CAL_MONTHS[e.getMonth()].slice(0, 3)} ${s.getFullYear()}`
      return `${CAL_MONTHS[s.getMonth()].slice(0, 3)} ${s.getFullYear()} – ${CAL_MONTHS[e.getMonth()].slice(0, 3)} ${e.getFullYear()}`
    }
    if (view === 'month') return `${CAL_MONTHS[anchor.getMonth()]} ${anchor.getFullYear()}`
    if (view === 'year') return String(anchor.getFullYear())
    return 'Yaklaşan Etkinlikler'
  }, [view, anchor, days])

  // Gün görünümünde parmakla sağa/sola kaydırarak önceki/sonraki güne geçiş -- eski sitedeki davranış.
  // Bubbled (yakalanmamış) pointer olayları dinlenir, grid'in kendi sürükleme jestleriyle (dikey eksen
  // tabanlı) çakışmaz. Sadece belirgin YATAY hareket sayılır, dikey kaydırma/tıklama tetiklemez.
  const swipeStart = useRef<{ x: number; y: number } | null>(null)
  const onSwipeDown = (event: React.PointerEvent) => {
    if (view !== 'day') return
    swipeStart.current = { x: event.clientX, y: event.clientY }
  }
  const onSwipeUp = (event: React.PointerEvent) => {
    if (view !== 'day' || !swipeStart.current) return
    const dx = event.clientX - swipeStart.current.x
    const dy = event.clientY - swipeStart.current.y
    swipeStart.current = null
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 2) shift(dx > 0 ? -1 : 1)
  }

  const shift = (dir: 1 | -1) => {
    if (view === 'day') setAnchor((a) => addDays(a, dir))
    else if (view === 'week') setAnchor((a) => addDays(a, dir * dayCount))
    else if (view === 'month') setAnchor((a) => new Date(a.getFullYear(), a.getMonth() + dir, 1))
    else if (view === 'year') setAnchor((a) => new Date(a.getFullYear() + dir, a.getMonth(), a.getDate()))
    else setAnchor((a) => addDays(a, dir * 30))
  }

  const goToday = () => setAnchor(todayDate())
  const goToDayExact = (key: string) => {
    const [y, m, d] = key.split('-').map(Number)
    setAnchor(new Date(y, m - 1, d))
    setView('day')
  }
  const goToMonth = (month: number) => { setAnchor(new Date(anchor.getFullYear(), month, 1)); setView('month') }

  const openEdit = (id: string) => setEditing({ id })
  const openCreate = (key: string, time?: string, endTime?: string) => setEditing({ id: null, presetDate: key, presetTime: time, presetEndTime: endTime })

  const editingEntry = editing?.id && events.data?.[editing.id] ? ([editing.id, { ...events.data[editing.id]!, _id: editing.id }] as [string, CalendarEventWithId]) : null

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex flex-col gap-2 rounded-2xl border border-separator bg-surface p-2">
        <div className="flex min-w-0 items-center gap-2">
          <Button isIconOnly size="sm" variant="ghost" aria-label="Önceki" onPress={() => shift(-1)}>
            <ChevronLeft size={16} />
          </Button>
          <Button isIconOnly size="sm" variant="ghost" aria-label="Sonraki" onPress={() => shift(1)}>
            <ChevronRight size={16} />
          </Button>
          <Button size="sm" variant="ghost" onPress={goToday}>Bugün</Button>
          <strong className="min-w-0 truncate px-1 text-sm">{monthLabel}</strong>
        </div>
        <div className="flex min-w-0 items-center gap-1 overflow-x-auto pb-0.5">
          <div className="flex shrink-0 gap-1 rounded-xl bg-default p-1">
            {VIEW_TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setView(tab.key)}
                className={`whitespace-nowrap rounded-lg px-2 py-1.5 text-[11px] font-medium transition-colors sm:px-3 sm:text-xs ${view === tab.key ? 'bg-surface shadow-[var(--field-shadow)]' : 'text-muted hover:text-foreground'}`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          {canWrite && (
            <Button size="sm" variant="primary" className="shrink-0 sm:ml-auto" onPress={() => openCreate(dateKey(anchor))}>Yeni Etkinlik</Button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-separator bg-surface" onPointerDown={onSwipeDown} onPointerUp={onSwipeUp}>
        {events.isLoading && <p className="py-16 text-center text-sm text-muted">Yükleniyor…</p>}
        {events.error && <p className="py-16 text-center text-sm text-danger">Etkinlikler yüklenemedi.</p>}
        {!events.isLoading && !events.error && (view === 'day' || view === 'week') && (
          <WeekView days={days} eventsByDate={eventsByDate} allEvents={allEvents} canWrite={canWrite} onEdit={openEdit} onCreate={openCreate} />
        )}
        {!events.isLoading && !events.error && view === 'month' && (
          <MonthView anchor={anchor} eventsByDate={eventsByDate} canWrite={canWrite} onEdit={openEdit} onCreate={openCreate} onShowMore={(key, evs) => setMoreDay({ dateKey: key, events: evs })} />
        )}
        {!events.isLoading && !events.error && view === 'year' && (
          <YearView year={anchor.getFullYear()} eventsByDate={eventsByDate} onGoToDay={goToDayExact} onGoToMonth={goToMonth} />
        )}
        {!events.isLoading && !events.error && view === 'list' && (
          <ListView events={allEvents.filter((ev) => ev.durum !== 'iptal')} onEdit={openEdit} />
        )}
      </div>

      <EventModal
        isOpen={editing !== null}
        onOpenChange={(isOpen) => { if (!isOpen) setEditing(null) }}
        entry={editingEntry}
        presetDate={editing?.presetDate}
        presetTime={editing?.presetTime}
        presetEndTime={editing?.presetEndTime}
      />

      {moreDay && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setMoreDay(null)}>
          <div onClick={(event) => event.stopPropagation()} className="flex max-h-[70vh] w-full max-w-sm flex-col gap-2 overflow-y-auto rounded-2xl bg-surface p-4 shadow-[var(--overlay-shadow)]">
            <h3 className="text-sm font-semibold">{moreDay.dateKey}</h3>
            {moreDay.events.map((ev) => (
              <button key={ev._id} type="button" onClick={() => { setMoreDay(null); openEdit(ev._id) }} className="rounded-lg px-2 py-1.5 text-left text-sm hover:bg-default">
                {ev.saat ? `${ev.saat} · ` : ''}{ev.ad || '(adsız)'}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
