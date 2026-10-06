import { toast } from '@heroui/react'
import { get, push, ref, serverTimestamp, update } from 'firebase/database'
import { useWriter } from '../../hooks/useWriter'
import { db } from '../../lib/firebase'
import type { CalendarEvent, CalendarEventWithId } from './calendarTypes'
import { CAL_MONTHS, eventAutoLockDateKey, evStatus, evType, minToHm, parseKey, shouldAutoLockPastEvent } from './calendarTypes'
import { applyEventPatch, assertEventRevision, detachDeletedEvent, savedEventSnapshot } from './eventMutations'
import { firebaseRecordStore } from './firebaseRecordStore'
import { mutateExistingRecord } from './recordTransactions'
import type { GanttProject } from '../gantt/ganttTypes'

const FIELD_LABELS: Record<string, string> = {
  ad: 'Etkinlik Adı', tur: 'Tür', durum: 'Durum', tarih: 'Tarih', saat: 'Başlangıç Saati',
  bitisSaat: 'Bitiş Saati', bitisTarihi: 'Bitiş Tarihi (çok günlü)', yer: 'Yer / Mekân',
  birim: 'Düzenleyen Birim', planlayan: 'Planlayan / Sorumlu', gorevli: 'Basın Görevlisi',
  haberYazanlari: 'Haberi Yazan(lar)', haberKaynagi: 'Haber Kaynağı', not: 'Not', locked: 'Kilit',
}

function logDate(value?: string | null): string {
  const date = parseKey(value ?? undefined)
  return date ? `${date.getDate()} ${CAL_MONTHS[date.getMonth()]} ${date.getFullYear()}` : value || '(boş)'
}

/** Alan bazlı değişiklik özeti -- log satırını insan okuyacak (ana siteyle aynı). */
export function describeChanges(oldEv: CalendarEvent, newEv: CalendarEvent): string[] {
  const changes: string[] = []
  if ((oldEv.tur || 'diger') !== (newEv.tur || 'diger')) changes.push(`${FIELD_LABELS.tur}: ${evType(oldEv.tur).ad} → ${evType(newEv.tur).ad}`)
  if ((oldEv.durum || 'planlandi') !== (newEv.durum || 'planlandi')) changes.push(`${FIELD_LABELS.durum}: ${evStatus(oldEv.durum).ad} → ${evStatus(newEv.durum).ad}`)
  ;(['tarih', 'bitisTarihi'] as const).forEach((key) => {
    const o = String(oldEv[key] ?? '').trim()
    const n = String(newEv[key] ?? '').trim()
    if (o !== n) changes.push(`${FIELD_LABELS[key]}: ${o ? logDate(o) : '(boş)'} → ${n ? logDate(n) : '(boş)'}`)
  })
  ;(['ad', 'saat', 'bitisSaat', 'yer', 'birim', 'planlayan', 'gorevli', 'haberYazanlari', 'haberKaynagi', 'not'] as const).forEach((key) => {
    const o = String(oldEv[key] ?? '').trim()
    const n = String(newEv[key] ?? '').trim()
    if (o !== n) changes.push(`${FIELD_LABELS[key]}: ${o || '(boş)'} → ${n || '(boş)'}`)
  })
  if (!!oldEv.locked !== !!newEv.locked) changes.push(`${FIELD_LABELS.locked}: ${newEv.locked ? '🔒 kilitlendi' : 'kilit açıldı'}`)
  return changes
}

export const evLogName = (name?: string) => String(name || 'Etkinlik').split(' · ').join(' - ')

export function useCalendarWriter() {
  const writer = useWriter()

  const logEvent = async (label: string, name: string) => {
    // Kayıt başarılı olduktan sonraki log hatası kaydı başarısız gibi göstermemeli.
    if (!writer.ensureWritable()) return
    try { await writer.log('etkinlik', label, name) }
    catch (err) { console.error('Etkinlik kaydedildi fakat log yazılamadı:', err) }
  }

  /** Kontrol ile birleştirme aynı transaction'da; hata veya silinmiş kayıt boş nesneye dönüşmez. */
  const persistEvent = async (
    id: string | null,
    patch: CalendarEvent,
    logLabel: string,
    expectedUpdateTs: number | null | undefined,
  ): Promise<string | null> => {
    const actor = writer.ensureWritable()
    if (!actor) return null
    const finalId = id ?? push(ref(db, writer.path('etkinlikler'))).key
    if (!finalId) { toast.danger('Etkinlik kimliği oluşturulamadı.'); return null }
    try {
      if (id) {
        const saved = await mutateExistingRecord(firebaseRecordStore<CalendarEvent>(writer.path(`etkinlikler/${id}`), writer.ensureWritable),
          (current) => applyEventPatch(current, patch, expectedUpdateTs, serverTimestamp() as unknown as number))
        await logEvent(logLabel, saved?.ad ?? '')
      } else {
        if (!writer.ensureWritable()) return null
        const logPath = writer.path('logs/etkinlik')
        const logKey = push(ref(db, logPath)).key
        if (!logKey) throw new Error('Log kimliği oluşturulamadı.')
        await update(ref(db), {
          [writer.path(`etkinlikler/${finalId}`)]: { ...patch, guncellemeTs: serverTimestamp(), olusturmaTs: serverTimestamp(), olusturan: actor.name || actor.email },
          [`${logPath}/${logKey}`]: { by: actor.name || actor.email, email: actor.email, action: logLabel, target: patch.ad ?? '', timestamp: serverTimestamp() },
        })
      }
      return finalId
    } catch (err) {
      writer.reportError(err instanceof Error ? err.message : 'Etkinlik kaydedilemedi.')(err)
      return null
    }
  }

  const deleteEvent = async (id: string, ev: CalendarEventWithId): Promise<boolean> => {
    const actor = writer.ensureWritable()
    if (!actor) return false
    try {
      let projectId: string | null | undefined
      await mutateExistingRecord(firebaseRecordStore<CalendarEvent>(writer.path(`etkinlikler/${id}`), writer.ensureWritable), (current) => {
        assertEventRevision(current, ev.guncellemeTs ?? null)
        if (current.locked) throw new Error('Bu etkinlik kilitli. Önce kilidi açın.')
        projectId = current.projeId
        return null
      })
      if (projectId) {
        try {
          const store = firebaseRecordStore<GanttProject>(writer.path(`haberProjeleri/${projectId}`), writer.ensureWritable)
          if (await store.read()) await mutateExistingRecord(store, (project) => detachDeletedEvent(project, id, serverTimestamp() as unknown as number))
        } catch (err) {
          console.error('Silinen etkinliğin proje bağlantısı temizlenemedi:', err)
          toast.warning('Etkinlik silindi. Proje bağlantısı bir sonraki proje kaydında temizlenecek.')
        }
      }
      await logEvent(`${ev.ad || 'Etkinlik'} etkinliği takvimden silindi`, ev.ad ?? '')
      toast.success('Etkinlik silindi.')
      return true
    } catch (err) {
      writer.reportError(err instanceof Error ? err.message : 'Etkinlik silinemedi.')(err)
      return false
    }
  }

  const toggleLock = async (id: string, ev: CalendarEventWithId): Promise<boolean> => {
    const wasLocked = !!ev.locked
    const label = `${evLogName(ev.ad)} etkinliği ${wasLocked ? 'kilidi açıldı' : 'kilitlendi'}`
    const result = await persistEvent(id, { locked: !wasLocked }, label, ev.guncellemeTs ?? null)
    return !!result
  }

  /** Geçmiş takvim günlerinin etkinliklerini toplu ve sessiz biçimde bir kez kilitler.
   * Kilidi kullanıcı sonradan açarsa `autoLockedForDate` aynı kaldığından bu işlem yeniden
   * kilit uygulamaz. */
  const autoLockPastEvents = async (events: CalendarEventWithId[], todayKey: string): Promise<number> => {
    if (!writer.ensureWritable()) return 0
    const dueEvents = events.filter((event) => shouldAutoLockPastEvent(event, todayKey))
    if (!dueEvents.length) return 0

    const results = await Promise.allSettled(dueEvents.map(async (event) => {
      let changed = false
      await mutateExistingRecord(firebaseRecordStore<CalendarEvent>(writer.path(`etkinlikler/${event._id}`), writer.ensureWritable), (current) => {
        changed = shouldAutoLockPastEvent(current, todayKey)
        return changed ? { ...current, locked: true, autoLockedForDate: eventAutoLockDateKey(current), guncellemeTs: serverTimestamp() as unknown as number } : current
      })
      return changed ? 1 : 0
    }))
    return results.reduce((count, result) => count + (result.status === 'fulfilled' ? result.value : 0), 0)
  }

  /** Etkinliği (saat korunarak) başka bir güne, veya aynı gün içinde başka bir başlangıç saatine sürükleyerek taşır. */
  const moveEvent = async (id: string, ev: CalendarEventWithId, newDateKey: string, newStartMin: number): Promise<boolean> => {
    const oldStart = ev.saat ? Number(ev.saat.split(':')[0]) * 60 + Number(ev.saat.split(':')[1]) : 0
    const oldEnd = ev.bitisSaat ? Number(ev.bitisSaat.split(':')[0]) * 60 + Number(ev.bitisSaat.split(':')[1]) : oldStart + 60
    const duration = Math.max(15, oldEnd <= oldStart ? oldEnd + 1440 - oldStart : oldEnd - oldStart)
    const clampedStart = Math.max(0, Math.min(23 * 60 + 45, newStartMin))
    const newEnd = clampedStart + duration
    const label = `${evLogName(ev.ad)} etkinliği ${ev.tarih === newDateKey ? 'saati değiştirildi' : 'başka bir güne taşındı'} (${ev.tarih} ${ev.saat} → ${newDateKey} ${minToHm(clampedStart)})`
    const result = await persistEvent(id, { tarih: newDateKey, saat: minToHm(clampedStart), bitisSaat: minToHm(newEnd) }, label, ev.guncellemeTs ?? null)
    return !!result
  }

  /** Etkinliğin üst veya alt kenarından sürükleyerek başlangıç/bitiş saatini ayarlar. */
  const resizeEvent = async (id: string, ev: CalendarEventWithId, edge: 'start' | 'end', newMin: number): Promise<boolean> => {
    const patch = edge === 'start' ? { saat: minToHm(newMin) } : { bitisSaat: minToHm(newMin) }
    const label = `${evLogName(ev.ad)} etkinliği saat ayarlandı (${edge === 'start' ? 'başlangıç' : 'bitiş'}: ${minToHm(newMin)})`
    const result = await persistEvent(id, patch, label, ev.guncellemeTs ?? null)
    return !!result
  }

  /** Çok günlü etkinlik şeridini sürükleyerek taşır (gövde) veya kenarından uzatır/kısaltır. */
  const moveMultiDayEvent = async (id: string, ev: CalendarEventWithId, newStartKey: string, newEndKey: string): Promise<boolean> => {
    const label = `${evLogName(ev.ad)} etkinliği tarihleri değiştirildi (${newStartKey} → ${newEndKey})`
    const result = await persistEvent(id, { tarih: newStartKey, bitisTarihi: newEndKey !== newStartKey ? newEndKey : null }, label, ev.guncellemeTs ?? null)
    return !!result
  }

  const readEvent = async (id: string): Promise<CalendarEventWithId> => {
    const value = (await get(ref(db, writer.path(`etkinlikler/${id}`)))).val() as CalendarEvent | null
    return savedEventSnapshot(id, value)
  }

  return { canWrite: writer.canWrite, ensureWritable: writer.ensureWritable, persistEvent, readEvent, deleteEvent, toggleLock, autoLockPastEvents, moveEvent, resizeEvent, moveMultiDayEvent }
}
