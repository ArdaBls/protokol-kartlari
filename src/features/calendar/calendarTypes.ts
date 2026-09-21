// Takvim: veri tipleri, sabitler, tarih/pikselleme yardımcıları -- eski admin-src/src/v4/calendar.js'in
// (birebir aynı) karşılığı. Küçük yardımcılar (addDays vb.) proje kuralı gereği diğer feature'larla
// paylaşılmaz, burada ayrı bir kopya tutulur.
import { dateKey } from '../../lib/dates'

export interface Attendee {
  prefix?: string
  name: string
  title?: string
  rank?: number | string | null
  /** 'il': İl Protokolü havuzundan seçildi; 'universite': üniversite protokol kartlarından. */
  kaynak: 'il' | 'universite'
}

export interface CalendarEvent {
  ad?: string
  tur?: string
  durum?: string
  rozetler?: string[]
  tarih?: string
  bitisTarihi?: string | null
  saat?: string
  bitisSaat?: string
  yer?: string
  birim?: string
  planlayan?: string
  gorevli?: string
  haberYazanlari?: string
  haberKaynagi?: string
  not?: string
  locked?: boolean
  katilimcilar?: Attendee[]
  taslak?: boolean | null
  olusturan?: string
  olusturmaTs?: number
  guncelleyen?: string
  guncellemeTs?: number
  tamamlayan?: string | null
  tamamlayanEmail?: string | null
  tamamlayanUid?: string | null
}

export type CalendarEventWithId = CalendarEvent & { _id: string }

export const EVENT_TYPES = [
  { key: 'acilis', ad: 'Açılış Töreni', renk: '#c2410c' },
  { key: 'konferans', ad: 'Konferans', renk: '#1d4ed8' },
  { key: 'panel', ad: 'Panel', renk: '#a21caf' },
  { key: 'calistay', ad: 'Çalıştay', renk: '#65a30d' },
  { key: 'ziyaret', ad: 'Protokol Ziyareti', renk: '#a16207' },
  { key: 'imza', ad: 'Protokol İmza Töreni', renk: '#7c3aed' },
  { key: 'mezuniyet', ad: 'Mezuniyet Töreni', renk: '#be123c' },
  { key: 'odul', ad: 'Ödül Töreni', renk: '#b45309' },
  { key: 'basin', ad: 'Basın Toplantısı', renk: '#0369a1' },
  { key: 'sergi', ad: 'Sergi / Kültür-Sanat', renk: '#0f766e' },
  { key: 'konser', ad: 'Konser', renk: '#9333ea' },
  { key: 'spor', ad: 'Spor Etkinliği', renk: '#15803d' },
  { key: 'gorevdegisimi', ad: 'Görev Değişimi', renk: '#4338ca' },
  { key: 'akademikbasari', ad: 'Akademik Başarı', renk: '#047857' },
  { key: 'kariyer', ad: 'Kariyer Etkinliği', renk: '#0e7490' },
  { key: 'topluluk', ad: 'Öğrenci Toplulukları', renk: '#be185d' },
  { key: 'saglik', ad: 'Sağlık Etkinliği', renk: '#b91c1c' },
  { key: 'uluslararasi', ad: 'Uluslararası Etkinlik', renk: '#334155' },
  { key: 'yesiluniversite', ad: 'Yeşil Üniversite', renk: '#166534' },
  { key: 'toplanti', ad: 'Toplantı', renk: '#475569' },
  { key: 'bayram', ad: 'Ulusal ve Resmî Bayramlar', renk: '#b91c1c' },
  { key: 'diger', ad: 'Diğer', renk: '#57534e' },
] as const

export const EVENT_STATUS = [
  { key: 'planlandi', ad: 'Planlandı', renk: '#6b7280' },
  { key: 'yaziliyor', ad: 'Haber yazılıyor', renk: '#b45309' },
  { key: 'incelemede', ad: 'İncelemede', renk: '#7c3aed' },
  { key: 'tamamlandi', ad: 'Tamamlandı', renk: '#15803d' },
  { key: 'iptal', ad: 'İptal', renk: '#b03a3a' },
] as const

export const EVENT_BADGES = [
  { key: 'basina_kapali', ad: 'Basına Kapalı', renk: '#b91c1c', bg: '#fee2e2' },
  { key: 'dis_katilimli', ad: 'Dış Katılımlı', renk: '#1d4ed8', bg: '#dbeafe' },
  { key: 'canli_yayin', ad: 'Canlı Yayın', renk: '#b45309', bg: '#fef3c7' },
] as const

export const evType = (key?: string) => EVENT_TYPES.find((t) => t.key === key) ?? EVENT_TYPES[EVENT_TYPES.length - 1]
export const evStatus = (key?: string) => EVENT_STATUS.find((s) => s.key === key) ?? EVENT_STATUS[0]

/** "Bir Etkinliğe Gidiyorum" (TasksCard) ile oluşturulan taslak etkinliklerin varsayılan adı --
 * kullanıcı gerçek bir başlık verene kadar bu adla eşleşen etkinlikler `.cal-taslak` ile öne çıkar. */
export const QUICK_DRAFT_NAME = '(Düzenlenmeye muhtaç)'

export const CAL_DOW = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz']
export const CAL_MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık']

export function addDays(date: Date, amount: number): Date {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  next.setDate(next.getDate() + amount)
  return next
}
export function startOfWeek(date: Date): Date {
  const weekday = (date.getDay() + 6) % 7
  return addDays(date, -weekday)
}
export function calVisibleWeekDays(anchor: Date, dayCount: number): Date[] {
  const start = dayCount === 7 ? startOfWeek(anchor) : new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate())
  return Array.from({ length: dayCount }, (_, i) => addDays(start, i))
}
export function isSameDay(a?: Date | null, b?: Date | null): boolean {
  return !!a && !!b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}
export function todayDate(): Date {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}
export function parseKey(value?: string): Date | null {
  const parts = String(value ?? '').split('-')
  if (parts.length !== 3) return null
  const [y, m, d] = parts.map(Number)
  if (![y, m, d].every(Number.isInteger)) return null
  const date = new Date(y, m - 1, d)
  return dateKey(date) === value ? date : null
}
export function hmToMin(value?: string): number | null {
  const parts = String(value ?? '').split(':')
  if (parts.length < 2) return null
  const h = Number(parts[0])
  const m = Number(parts[1])
  if (Number.isNaN(h) || Number.isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) return null
  return h * 60 + m
}
export const pad2 = (n: number) => String(n).padStart(2, '0')
export function minToHm(minutes: number): string {
  return `${pad2(Math.floor(minutes / 60) % 24)}:${pad2(minutes % 60)}`
}
export function fmtTrDate(value?: string): string {
  const date = parseKey(value)
  if (!date) return value ?? ''
  return `${date.getDate()} ${CAL_MONTHS[date.getMonth()]} ${date.getFullYear()}`
}
export function fmtMultiDayRange(tarih?: string, bitisTarihi?: string): string {
  const s = parseKey(tarih)
  const e = parseKey(bitisTarihi)
  if (!s || !e) return ''
  const sm = CAL_MONTHS[s.getMonth()].slice(0, 3)
  const em = CAL_MONTHS[e.getMonth()].slice(0, 3)
  if (s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()) return `${s.getDate()}–${e.getDate()} ${sm}`
  return `${s.getDate()} ${sm}–${e.getDate()} ${em}`
}

/** charts.js'teki hasEventEnded ile aynı kural: geçmiş sayılan etkinlikte editörün basın görevlisi/
 * haber yazarı işaretlemesi doğrudan eklenmez, admin/owner onayı bekleyen bir talep açılır. */
export function calHasEventEnded(ev: CalendarEvent): boolean {
  const start = parseKey(ev.tarih)
  if (!start) return false
  const now = new Date()
  const isMultiDay = !!ev.bitisTarihi && ev.bitisTarihi !== ev.tarih
  if (isMultiDay) {
    const end = parseKey(ev.bitisTarihi ?? undefined) ?? start
    return now.getTime() >= new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59, 999).getTime()
  }
  const startMin = hmToMin(ev.saat)
  if (startMin === null) return now.getTime() >= new Date(start.getFullYear(), start.getMonth(), start.getDate(), 23, 59, 59, 999).getTime()
  let endMin = hmToMin(ev.bitisSaat)
  if (endMin === null) endMin = startMin + 60
  else if (endMin <= startMin) endMin += 24 * 60
  return now.getTime() >= new Date(start.getFullYear(), start.getMonth(), start.getDate(), 0, endMin, 0, 0).getTime()
}

export const parseGorevliString = (value?: string): string[] => String(value ?? '').split(',').map((x) => x.trim()).filter(Boolean)

/** Aynı gündeki zamanlı etkinlikleri çakışmayan sütunlara yerleştirir (ana siteyle birebir). */
export interface DayLayoutItem { ev: CalendarEventWithId; s: number; e: number; col: number; total: number }
export function layoutDay(events: CalendarEventWithId[]): DayLayoutItem[] {
  const items = events
    .map((ev) => {
      const s = hmToMin(ev.saat)
      if (s === null) return null
      let e = hmToMin(ev.bitisSaat)
      if (e === null) e = s + 60
      else if (e <= s) e = 24 * 60
      return { ev, s, e: Math.min(e, 24 * 60), col: 0, total: 1 }
    })
    .filter((x): x is DayLayoutItem => x !== null)
  items.sort((a, b) => a.s - b.s || b.e - a.e)
  const colEnds: number[] = []
  items.forEach((it) => {
    let c = 0
    while (c < colEnds.length && colEnds[c] > it.s) c += 1
    colEnds[c] = it.e
    it.col = c
  })
  let clusterStart = 0
  let clusterMaxEnd = -Infinity
  let clusterMaxCol = 0
  const closeCluster = (from: number, to: number) => {
    const width = clusterMaxCol + 1
    for (let i = from; i < to; i += 1) items[i].total = width
  }
  items.forEach((it, i) => {
    if (i > 0 && it.s >= clusterMaxEnd) {
      closeCluster(clusterStart, i)
      clusterStart = i
      clusterMaxCol = 0
    }
    clusterMaxEnd = Math.max(clusterMaxEnd, it.e)
    clusterMaxCol = Math.max(clusterMaxCol, it.col)
  })
  closeCluster(clusterStart, items.length)
  return items
}

/** Çok günlü etkinlik şeritlerini çakışmayan satırlara yerleştirir. */
export interface MultiDayBar { ev: CalendarEventWithId; startIdx: number; endIdx: number; continuesLeft: boolean; continuesRight: boolean; row: number }
export function layoutMultiDayRow(bars: MultiDayBar[]): number {
  bars.sort((a, b) => a.startIdx - b.startIdx || b.endIdx - a.endIdx)
  const rowEnds: number[] = []
  bars.forEach((bar) => {
    let r = 0
    while (r < rowEnds.length && rowEnds[r] >= bar.startIdx) r += 1
    rowEnds[r] = bar.endIdx
    bar.row = r
  })
  return Math.max(1, rowEnds.length)
}

export function toEventListWithId(records: Record<string, CalendarEvent | null> | null): CalendarEventWithId[] {
  return Object.entries(records ?? {}).flatMap(([id, ev]) => (ev && typeof ev === 'object' ? [{ ...ev, _id: id }] : []))
}
