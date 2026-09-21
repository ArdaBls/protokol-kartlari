// Eski panelin event-overview.js dosyasının tiplenmiş karşılığı: Bugün/Şimdi,
// Bu hafta ve Yaklaşan (30 gün) kovaları. Tarihler her zaman YEREL saatle işlenir.

export interface CalendarEvent {
  _id: string
  ad?: string
  tur?: string
  durum?: string
  tarih?: string
  bitisTarihi?: string
  saat?: string
  bitisSaat?: string
  yer?: string
  birim?: string
  gorevli?: string
  haberYazanlari?: string
  arsiv?: unknown
}

export type CalendarEventRecord = Omit<CalendarEvent, '_id'>

export function toEventList(records: Record<string, CalendarEventRecord | null> | null): CalendarEvent[] {
  return Object.entries(records ?? {}).flatMap(([id, event]) =>
    event && typeof event === 'object' ? [{ ...event, _id: id }] : [],
  )
}

export interface OverviewBuckets {
  today: CalendarEvent[]
  week: CalendarEvent[]
  upcoming: CalendarEvent[]
}

const UPCOMING_DAYS = 30
const DEFAULT_DURATION_MIN = 60

export function parseKey(value: string | undefined): Date | null {
  const parts = String(value ?? '').split('-')
  if (parts.length !== 3) return null
  const [y, m, d] = parts.map(Number)
  if (![y, m, d].every(Number.isInteger)) return null
  const date = new Date(y, m - 1, d)
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null
  return date
}

function hmToMin(value: string | undefined): number | null {
  const parts = String(value ?? '').split(':')
  if (parts.length < 2) return null
  const [h, m] = parts.map(Number)
  if (Number.isNaN(h) || Number.isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) return null
  return h * 60 + m
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

function startOfWeek(date: Date): Date {
  const weekday = (date.getDay() + 6) % 7
  return addDays(date, -weekday)
}

export function getEventStartDate(event: CalendarEvent): Date | null {
  const start = parseKey(event.tarih)
  if (!start) return null
  const startMin = hmToMin(event.saat) ?? 0
  return new Date(start.getFullYear(), start.getMonth(), start.getDate(), 0, startMin)
}

export function getEventEndDate(event: CalendarEvent): Date | null {
  const start = parseKey(event.tarih)
  if (!start) return null
  if (event.bitisTarihi && event.bitisTarihi !== event.tarih) {
    const end = parseKey(event.bitisTarihi) ?? start
    return new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59, 999)
  }
  const startMin = hmToMin(event.saat)
  if (startMin === null) {
    return new Date(start.getFullYear(), start.getMonth(), start.getDate(), 23, 59, 59, 999)
  }
  const rawEnd = hmToMin(event.bitisSaat)
  const endMin =
    rawEnd === null ? startMin + DEFAULT_DURATION_MIN : rawEnd <= startMin ? rawEnd + 24 * 60 : rawEnd
  return new Date(start.getFullYear(), start.getMonth(), start.getDate(), 0, endMin)
}

function overlaps(event: CalendarEvent, rangeStart: Date, rangeEnd: Date): boolean {
  const s = getEventStartDate(event)
  const e = getEventEndDate(event)
  return !!s && !!e && s <= rangeEnd && e >= rangeStart
}

export function isOngoing(event: CalendarEvent, now: Date): boolean {
  return overlaps(event, now, now)
}

function byOngoingThenStart(now: Date) {
  return (a: CalendarEvent, b: CalendarEvent) => {
    const diffOngoing = Number(isOngoing(b, now)) - Number(isOngoing(a, now))
    if (diffOngoing !== 0) return diffOngoing
    const diffStart = (getEventStartDate(a)?.getTime() ?? 0) - (getEventStartDate(b)?.getTime() ?? 0)
    if (diffStart !== 0) return diffStart
    return String(a.ad ?? '').localeCompare(String(b.ad ?? ''), 'tr')
  }
}

export function getOverviewBuckets(events: CalendarEvent[], now: Date): OverviewBuckets {
  const active = events.filter((e) => e.durum !== 'iptal' && e.arsiv !== true && e.tarih)
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)
  const weekEndDay = addDays(startOfWeek(now), 6)
  const weekEnd = new Date(weekEndDay.getFullYear(), weekEndDay.getMonth(), weekEndDay.getDate(), 23, 59, 59, 999)
  const upcomingEndDay = addDays(weekEndDay, UPCOMING_DAYS)
  const upcomingEnd = new Date(
    upcomingEndDay.getFullYear(), upcomingEndDay.getMonth(), upcomingEndDay.getDate(), 23, 59, 59, 999,
  )

  const ranges: Array<[keyof OverviewBuckets, Date, Date]> = [
    ['today', dayStart, dayEnd],
    ['week', new Date(dayEnd.getTime() + 1), weekEnd],
    ['upcoming', new Date(weekEnd.getTime() + 1), upcomingEnd],
  ]

  const sort = byOngoingThenStart(now)
  const seen = new Set<string>()
  const pick = (predicate: (e: CalendarEvent) => boolean) =>
    active.filter((e) => !seen.has(e._id) && predicate(e)).map((e) => {
      seen.add(e._id)
      return e
    })

  const ongoing = pick((e) => isOngoing(e, now))
  const [today, week, upcoming] = ranges.map(([, start, end]) => pick((e) => overlaps(e, start, end)))

  return {
    today: [...ongoing, ...today].sort(sort),
    week: [...week].sort(sort),
    upcoming: [...upcoming].sort(sort),
  }
}
