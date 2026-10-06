import type { CalendarEventWithId } from './calendarTypes'
import { EVENT_STATUS, EVENT_TYPES, parseKey } from './calendarTypes'

export interface CalendarExportOptions {
  year: number
  includeCancelled: boolean
  includeDrafts: boolean
  isTestMode: boolean
  generatedAt?: Date
}

export const canExportCalendar = (role?: string) => role === 'admin' || role === 'owner'

export const exportTypeLabel = (event: CalendarEventWithId) =>
  EVENT_TYPES.find((type) => type.key === event.tur)?.ad || event.tur?.trim() || 'Diğer'

export const exportStatusLabel = (event: CalendarEventWithId) =>
  EVENT_STATUS.find((status) => status.key === (event.durum || 'planlandi'))?.ad ?? event.durum ?? 'Planlandı'

export function calendarExportData(events: readonly CalendarEventWithId[], options: CalendarExportOptions) {
  if (!Number.isInteger(options.year) || options.year < 1900 || options.year > 9999) throw new Error('Geçerli bir yıl seçin.')
  const included = events.filter((event) => (options.includeCancelled || event.durum !== 'iptal') && (options.includeDrafts || !event.taslak))
  const invalid = included.filter((event) => !parseKey(event.tarih))
  const selected = included.filter((event) => parseKey(event.tarih)?.getFullYear() === options.year)
    .sort((a, b) => (a.tarih ?? '').localeCompare(b.tarih ?? '') || (a.saat ?? '').localeCompare(b.saat ?? '') || (a.ad ?? '').localeCompare(b.ad ?? '', 'tr'))
  const months = Array.from({ length: 12 }, (_, month) => selected.filter((event) => Number(event.tarih?.slice(5, 7)) === month + 1))
  const types = [...new Set(selected.map(exportTypeLabel))].sort((a, b) => a.localeCompare(b, 'tr'))
  return { selected, invalid, months, types }
}

/** Use UTC components so an Excel date keeps its local calendar day on every device. */
export function exportDateTime(key?: string | null, time?: string): Date | null {
  if (!key || !parseKey(key)) return null
  const [year, month, day] = key.split('-').map(Number)
  const minutes = exportTimeMinutes(time)
  return new Date(Date.UTC(year, month - 1, day, 0, minutes ?? 0))
}

export function exportTimeMinutes(time?: string): number | null {
  if (!time || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

export function exportEndDate(event: CalendarEventWithId): Date | null {
  const explicitEnd = event.bitisTarihi && parseKey(event.bitisTarihi) && event.bitisTarihi >= (event.tarih ?? '') ? event.bitisTarihi : null
  const endMinutes = exportTimeMinutes(event.bitisSaat)
  if (!explicitEnd && endMinutes === null) return null
  const end = exportDateTime(explicitEnd || event.tarih, event.bitisSaat)
  const startMinutes = exportTimeMinutes(event.saat)
  if (end && !explicitEnd && startMinutes !== null && endMinutes !== null && endMinutes <= startMinutes) end.setUTCDate(end.getUTCDate() + 1)
  return end
}
