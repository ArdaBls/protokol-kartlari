// Editör aktivitesi ve fotoğraf sayacı hesapları — eski charts.js ile aynı kurallar:
// istatistiklere yalnızca BİTMİŞ ve iptal edilmemiş etkinlikler girer.
import { getEventEndDate } from './eventOverview'
import type { CalendarEvent } from './eventOverview'
import { fullName, isApprovedRole } from './roles'
import type { UserProfile } from './roles'

// İlk renk Mouve accent'i; sonrakiler koyu mor zeminde ayırt edilebilir tonlar.
const BASE_PALETTE = ['#AE84F2', '#17C964', '#F7B750', '#5EB6F7', '#F2849E', '#2DD4BF', '#A1A1AA']
const GOLDEN_ANGLE = 137.508
const SHARE_TOP_N = 5

// Kişi başı ortalama fotoğraf; listede olmayanlar sayılmaz (kullanıcı tercihi).
const PHOTO_RATE_TABLE: Record<string, number> = {
  'Arda Bilasa': 350,
  'Berk Can Dereci': 800,
  'Nurdan Gürbüz': 400,
  'Hasan Çelen': 420,
}

const normalizeName = (name: string) => name.trim().toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ')

const PHOTO_RATES = new Map(Object.entries(PHOTO_RATE_TABLE).map(([name, rate]) => [normalizeName(name), rate]))

const splitNames = (value?: string) =>
  String(value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

/** Basın görevlisi VEYA haber yazarı; aynı kişi iki alanda da geçse tek sayılır. */
export const namesForEvent = (event: CalendarEvent) =>
  [...new Set([...splitNames(event.gorevli), ...splitNames(event.haberYazanlari)])]

export function eligibleForStats(events: CalendarEvent[], now: Date): CalendarEvent[] {
  return events.filter((event) => {
    const end = getEventEndDate(event)
    return event.durum !== 'iptal' && !!end && now >= end
  })
}

/** users/ okunamazsa (editör rolü) isimler etkinliklerden türetilir. */
export function rosterNames(users: Record<string, UserProfile | null> | null, events: CalendarEvent[]): string[] {
  const fromUsers = Object.values(users ?? {})
    .filter((user): user is UserProfile => !!user && isApprovedRole(user.role))
    .map(fullName)
    .filter(Boolean)
  const unique = [...new Set(fromUsers)]
  return unique.length ? unique : [...new Set(events.flatMap(namesForEvent))]
}

function countByBucket(
  names: string[],
  events: CalendarEvent[],
  bucketCount: number,
  bucketOf: (event: CalendarEvent) => number | null,
): number[][] {
  const indexByName = new Map(names.map((name, i) => [name, i]))
  const rows = names.map(() => new Array<number>(bucketCount).fill(0))
  for (const event of events) {
    const bucket = bucketOf(event)
    if (bucket === null || bucket < 0 || bucket >= bucketCount) continue
    for (const name of namesForEvent(event)) {
      const row = indexByName.get(name)
      if (row !== undefined) rows[row][bucket] += 1
    }
  }
  return rows
}

export function monthlyActivity(names: string[], events: CalendarEvent[], year: number): number[][] {
  return countByBucket(names, events, 12, (event) => {
    const key = String(event.tarih ?? '')
    return key.slice(0, 4) === String(year) ? Number(key.slice(5, 7)) - 1 : null
  })
}

export function dailyActivity(names: string[], events: CalendarEvent[], now: Date) {
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const rows = countByBucket(names, events, daysInMonth, (event) => {
    const key = String(event.tarih ?? '')
    return key.slice(0, 7) === yearMonth ? Number(key.slice(8, 10)) - 1 : null
  })
  return { labels: Array.from({ length: daysInMonth }, (_, i) => String(i + 1)), rows }
}

export function activityShare(names: string[], events: CalendarEvent[]) {
  const ranked = countByBucket(names, events, 1, () => 0)
    .map((row, i) => ({ name: names[i], value: row[0] }))
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value)
  const rest = ranked.slice(SHARE_TOP_N).reduce((sum, item) => sum + item.value, 0)
  return rest > 0 ? [...ranked.slice(0, SHARE_TOP_N), { name: 'Diğer', value: rest }] : ranked
}

/** Yalnızca basın görevlisi (gorevli) olarak gidilen etkinlikler sayılır. */
export function photoEstimate(events: CalendarEvent[]): number {
  return events.reduce(
    (total, event) =>
      total + splitNames(event.gorevli).reduce((sum, name) => sum + (PHOTO_RATES.get(normalizeName(name)) ?? 0), 0),
    0,
  )
}

export function seriesColor(index: number, alpha = 1): string {
  if (index < BASE_PALETTE.length) {
    const hex = BASE_PALETTE[index]
    const [r, g, b] = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16))
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
  }
  return `hsla(${Math.round((index * GOLDEN_ANGLE) % 360)}, 62%, 52%, ${alpha})`
}
