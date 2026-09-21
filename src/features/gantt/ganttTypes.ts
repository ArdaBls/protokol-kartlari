import { dateKey } from '../../lib/dates'

export interface GanttStep {
  ad?: string
  durum?: string
  baslangicTarihi?: string
  bitisTarihi?: string
  sorumlu?: string
  ilerleme?: number
  sira?: number
  arsiv?: boolean
}

export interface GanttProject {
  ad?: string
  tur?: 'ozel' | 'normal'
  durum?: string
  baslangicTarihi?: string
  bitisTarihi?: string
  sorumlu?: string
  oncelik?: 'normal' | 'yuksek' | 'kritik'
  ilerleme?: number
  adimlar?: Record<string, GanttStep>
  takvimEtkinlikId?: string
  renk?: string
  arsiv?: boolean
  olusturan?: string
  olusturmaTs?: number
  guncelleyen?: string
  guncellemeTs?: number
}

export interface CalendarEventRef {
  ad?: string
  tarih?: string
  bitisTarihi?: string
  projeId?: string
  locked?: boolean
  guncellemeTs?: number
}

export const STATUSES: Record<string, string> = {
  fikir: 'Fikir', arastirma: 'Araştırma', hazirlik: 'Hazırlık', cekim: 'Çekim',
  kurgu: 'Kurgu', onay: 'Onay', yayinlandi: 'Yayınlandı', iptal: 'İptal',
}

export const STEP_STATUSES: Record<string, string> = {
  yapilacak: 'Yapılacak', yapiliyor: 'Yapılıyor', incelemede: 'İncelemede',
  tamamlandi: 'Tamamlandı', iptal: 'İptal',
}

// reui.io/preview/base/gantt-1 tonları -- ham renkler beyaz metinle WCAG AA'yı geçemiyor,
// bu yüzden çubuklarda soluk dolgu + solid sol kenarlık + koyu metin kullanılır (bkz. GanttBar).
export const PALETTE: Record<string, string> = {
  mavi: '#2b7fff', indigo: '#615fff', mor: '#8e51ff', camgobegi: '#00b8db',
  turkuaz: '#00bba7', zumrut: '#00bc7d', amber: '#f0b100', turuncu: '#ff6900',
  kirmizi: '#ff2056', pembe: '#f6339a',
}
export const PALETTE_ORDER = ['mavi', 'indigo', 'mor', 'camgobegi', 'turkuaz', 'zumrut', 'amber', 'turuncu', 'kirmizi', 'pembe']

const STATUS_COLOR: Record<string, string> = {
  fikir: 'indigo', arastirma: 'mavi', hazirlik: 'mor', cekim: 'pembe', kurgu: 'turuncu',
  onay: 'amber', yayinlandi: 'zumrut', iptal: 'kirmizi',
  yapilacak: 'indigo', yapiliyor: 'mavi', incelemede: 'mor', tamamlandi: 'zumrut',
}

/** İptal her zaman kırmızı; elle seçilmiş proje rengi (adımlarda yok) bunu geçersiz kılmaz. */
export function barColorHex(status: string, manualColor?: string, isProjectLevel = false): string {
  if (status === 'iptal') return PALETTE.kirmizi
  if (isProjectLevel && manualColor && PALETTE[manualColor]) return PALETTE[manualColor]
  return PALETTE[STATUS_COLOR[status]] ?? PALETTE.indigo
}

export function stepProgress(status: string): number {
  if (status === 'tamamlandi') return 100
  if (status === 'incelemede') return 80
  if (status === 'yapiliyor') return 50
  return 0
}

export function parseDateKey(value?: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ''))
  if (!match) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return dateKey(date) === value ? date : null
}

export function addDays(date: Date, amount: number): Date {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  next.setDate(next.getDate() + amount)
  return next
}

const DAY_MS = 86400000
export function dayDiff(a: Date, b: Date): number {
  const utcA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())
  const utcB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())
  return Math.round((utcB - utcA) / DAY_MS)
}

export interface BarGeometry {
  left: number
  width: number
}

/** Çubuğun görünür şeritteki piksel konumu/genişliği — şerit dışına taşan uçlar kırpılır. */
export function barGeometry(item: GanttStep | GanttProject, rangeStart: Date, rangeDays: number, dayWidth: number): BarGeometry | null {
  const start = parseDateKey(item.baslangicTarihi)
  const end = parseDateKey(item.bitisTarihi)
  if (!start || !end) return null
  const rawLeft = dayDiff(rangeStart, start)
  const rawRight = dayDiff(rangeStart, end)
  if (rawRight < 0 || rawLeft >= rangeDays) return null
  const left = Math.max(0, rawLeft)
  const right = Math.min(rangeDays - 1, rawRight)
  return { left: left * dayWidth, width: Math.max(dayWidth, (right - left + 1) * dayWidth) }
}

// reui.io/preview/base/gantt-1 referansındaki kademeler: ctrl+tekerlek veya +/- ile geçilen,
// gün başına piksel genişliği. Sabit kademeler -- sürekli/analog ölçekte yuvarlama sürüklenmesi olmaz.
export const ZOOM_LEVELS = [14, 20, 28, 38, 50, 66, 86]
export const DEFAULT_ZOOM_INDEX = 3

export const MONTHS_LONG = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık']
export const MONTHS_SHORT_TR = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']
export const WEEKDAYS_TR = ['Pt', 'Sa', 'Ça', 'Pe', 'Cu', 'Ct', 'Pa']

/** Pazartesi hizalı başlangıçtan Pazar hizalı bitişe -- yılın tamamını kapsayan sürekli zaman çizelgesi. */
export function computeYearRange(year: number): { start: Date; days: number } {
  const yearFirst = new Date(year, 0, 1)
  const yearLast = new Date(year, 11, 31)
  const start = addDays(yearFirst, -((yearFirst.getDay() + 6) % 7))
  const end = addDays(yearLast, 6 - ((yearLast.getDay() + 6) % 7))
  return { start, days: dayDiff(start, end) + 1 }
}

export function isoWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const weekday = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - weekday)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil(((d.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7)
}

/** Bağlı etkinliğin tarihi projenin teslim tarihiyle birlikte kayar; etkinlik süresi korunur. */
export function linkedEventDatePatch(linkedEvent: CalendarEventRef | null, projectEndKey: string): Partial<CalendarEventRef> {
  const oldStart = parseDateKey(linkedEvent?.tarih)
  const oldEnd = parseDateKey(linkedEvent?.bitisTarihi)
  const nextEnd = parseDateKey(projectEndKey)
  if (oldStart && oldEnd && nextEnd && oldEnd >= oldStart) {
    const duration = dayDiff(oldStart, oldEnd)
    return { tarih: dateKey(addDays(nextEnd, -duration)), bitisTarihi: projectEndKey }
  }
  return { tarih: projectEndKey }
}

export function eventDatesWouldChange(linkedEvent: CalendarEventRef | null, patch: Partial<CalendarEventRef>): boolean {
  return Object.entries(patch).some(([key, value]) => (linkedEvent?.[key as keyof CalendarEventRef] ?? null) !== (value ?? null))
}

export function projectSteps(project: GanttProject): Array<[string, GanttStep]> {
  return Object.entries(project.adimlar ?? {})
    .filter(([, step]) => step && step.arsiv !== true)
    .sort(([, a], [, b]) => (Number(a.sira) || 0) - (Number(b.sira) || 0))
}
