export type KanbanStatus = 'planlandi' | 'yaziliyor' | 'incelemede' | 'tamamlandi'

export const KANBAN_COLUMNS: Array<{ id: KanbanStatus; title: string; dotClass: string }> = [
  { id: 'planlandi', title: 'Planlandı', dotClass: 'bg-muted' },
  { id: 'yaziliyor', title: 'Haber yazılıyor', dotClass: 'bg-warning' },
  { id: 'incelemede', title: 'İncelemede', dotClass: 'bg-accent' },
  { id: 'tamamlandi', title: 'Tamamlandı', dotClass: 'bg-success' },
]

// Eski kayıtlarda hâlâ geçebilen değerler tek iş akışına eşlenir -- canlı veriye asla yazılmaz,
// yalnızca görüntülemede normalize edilir.
const LEGACY_DURUM: Record<string, KanbanStatus> = { cekildi: 'planlandi', haber: 'yaziliyor', yayinlandi: 'tamamlandi' }
export const normalizeDurum = (d?: string): KanbanStatus => (LEGACY_DURUM[d ?? ''] ?? (d as KanbanStatus)) || 'planlandi'

export const WEEK_MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']

export function addDays(date: Date, amount: number): Date {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  next.setDate(next.getDate() + amount)
  return next
}

export function startOfWeek(date: Date): Date {
  const weekday = (date.getDay() + 6) % 7
  return addDays(date, -weekday)
}

export function weekRangeLabel(weekStart: Date): string {
  const end = addDays(weekStart, 6)
  const startMonth = WEEK_MONTHS[weekStart.getMonth()]
  const endMonth = WEEK_MONTHS[end.getMonth()]
  if (weekStart.getMonth() === end.getMonth()) return `${weekStart.getDate()}–${end.getDate()} ${endMonth} ${end.getFullYear()}`
  return `${weekStart.getDate()} ${startMonth} – ${end.getDate()} ${endMonth} ${end.getFullYear()}`
}

function parseKeyLoose(value?: string): Date | null {
  const parts = String(value ?? '').split('-')
  if (parts.length !== 3) return null
  const [y, m, d] = parts.map(Number)
  if (![y, m, d].every(Number.isInteger)) return null
  const date = new Date(y, m - 1, d)
  return Number.isNaN(date.getTime()) ? null : date
}

export type KanbanSource = 'etkinlik' | 'gorev'

export interface KanbanRecord {
  ad?: string
  metin?: string
  yer?: string
  tarih?: string
  durum?: string
  createdAt?: number
  guncellemeTs?: number
  tamamlayan?: string
  gorevli?: string
  haberYazanlari?: string
}

export interface KanbanItem {
  id: string
  source: KanbanSource
  durum: KanbanStatus
  title: string
  subtitle: string
  dateKey: string
  originWeek: Date
  overdue: boolean
  raw: KanbanRecord
}

function originWeekOf(record: KanbanRecord): Date {
  const parsed = parseKeyLoose(record.tarih) ?? (record.createdAt ? new Date(record.createdAt) : new Date())
  return startOfWeek(parsed)
}

/** Tamamlanmış bir kartın NE ZAMAN tamamlandığı -- görünürlük kuralı bunun üzerinden çalışır ki
 * geçmiş haftadan kalıp az önce tamamlanan bir kart, gerçek zaman bir SONRAKİ haftaya geçene kadar kaybolmasın. */
function trackWeekOf(record: KanbanRecord): Date {
  const ts = record.guncellemeTs ?? record.createdAt
  return typeof ts === 'number' ? startOfWeek(new Date(ts)) : originWeekOf(record)
}

export function toKanbanItem(id: string, source: KanbanSource, record: KanbanRecord): KanbanItem {
  const durum = normalizeDurum(record.durum)
  const originWeek = originWeekOf(record)
  return {
    id, source, durum, originWeek,
    title: source === 'gorev' ? record.metin || '(adsız görev)' : record.ad || '(adsız)',
    subtitle: source === 'gorev' ? '' : record.yer || '',
    dateKey: record.tarih || '',
    overdue: false, // aşağıda visibleItems'ta viewedWeek'e göre hesaplanır
    raw: record,
  }
}

export function isVisibleInWeek(item: KanbanItem, viewedWeek: Date): boolean {
  if (item.durum !== 'tamamlandi') return true
  return trackWeekOf(item.raw).getTime() === viewedWeek.getTime()
}
