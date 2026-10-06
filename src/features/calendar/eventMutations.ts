import type { CalendarEvent, CalendarEventWithId } from './calendarTypes.ts'
import { addDays, eventAutoLockDateKey, parseKey } from './calendarTypes.ts'
import { dateKey } from '../../lib/dates.ts'

export function assertEventRevision(current: CalendarEvent, expected: number | null | undefined) {
  if (expected !== undefined && (current.guncellemeTs ?? null) !== expected) {
    throw new Error('Bu etkinlik başka biri tarafından değiştirildi. Pencereyi kapatıp yeniden açın.')
  }
}

export function savedEventSnapshot(id: string, value: CalendarEvent | null): CalendarEventWithId {
  if (!value || typeof value.guncellemeTs !== 'number') throw new Error('Kaydedilen etkinlik yeniden yüklenemedi. Takvimden açıp deneyin.')
  return { ...value, _id: id }
}

export function applyEventPatch(current: CalendarEvent, patch: CalendarEvent, expected: number | null | undefined, timestamp: number): CalendarEvent {
  assertEventRevision(current, expected)
  const lockOnly = Object.keys(patch).length === 1 && typeof patch.locked === 'boolean'
  if (current.locked && !lockOnly) throw new Error('Bu etkinlik kilitli. Önce takvimden kilidi açın.')
  const next = { ...current, ...patch, guncellemeTs: timestamp }
  if (eventAutoLockDateKey(current) !== eventAutoLockDateKey(next)) next.autoLockedForDate = null
  return next
}

export type MultiDayDragMode = 'move' | 'resize-start' | 'resize-end'
export function multiDayDragDates(event: CalendarEvent, mode: MultiDayDragMode, delta: number): { tarih: string; bitisTarihi: string } | null {
  const start = parseKey(event.tarih)
  const end = parseKey(event.bitisTarihi ?? undefined)
  if (!start || !end || end < start) return null
  let nextStart = mode === 'resize-end' ? start : addDays(start, delta)
  let nextEnd = mode === 'resize-start' ? end : addDays(end, delta)
  if (nextStart > nextEnd) {
    if (mode === 'resize-start') nextStart = nextEnd
    else nextEnd = nextStart
  }
  return { tarih: dateKey(nextStart), bitisTarihi: dateKey(nextEnd) }
}

export const personKey = (name: string) => name.trim().toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ')

export function attendanceAtSave(original: string | undefined, selected: string[], needsApproval: boolean) {
  const existing = new Set(String(original ?? '').split(',').map(personKey))
  const names = [...new Map(selected.map((name) => [personKey(name), name.trim()])).values()].filter(Boolean)
  return {
    accepted: names.filter((name) => !needsApproval || existing.has(personKey(name))),
    requested: names.filter((name) => needsApproval && !existing.has(personKey(name))),
  }
}

/** Proje başka bir etkinliğe bağlanmışsa eski etkinliğin silinmesi yeni bağlantıyı bozmaz. */
export function detachDeletedEvent<T extends { takvimEtkinlikId?: string; guncellemeTs?: number }>(project: T, eventId: string, timestamp: number): T {
  return project.takvimEtkinlikId === eventId ? { ...project, takvimEtkinlikId: '', guncellemeTs: timestamp } : project
}
