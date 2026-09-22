import { toast } from '@heroui/react'
import { get, push, ref, remove, serverTimestamp, update } from 'firebase/database'
import { useWriter } from '../../hooks/useWriter'
import { db } from '../../lib/firebase'
import type { CalendarEvent, CalendarEventWithId } from './calendarTypes'
import { CAL_MONTHS, evStatus, evType, minToHm, parseKey } from './calendarTypes'

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

  /** İyimser kilit: kaydetmeden önce sunucudaki gerçek guncellemeTs okunur; farklıysa aradan
   * başka biri yazmış demektir. Var olan alanlar korunur, yalnızca patch'teki alanlar üzerine yazılır. */
  const persistEvent = async (
    id: string | null,
    patch: CalendarEvent,
    logLabel: string,
    expectedUpdateTs: number | null | undefined,
  ): Promise<string | null> => {
    const actor = writer.ensureWritable()
    if (!actor) return null
    // ÖNEMLİ: Firebase update() bir path'e verilen değeri TAMAMEN değiştirir, o path'in altındaki
    // diğer alanları SİLER (merge yapmaz) -- bu yüzden var olan kaydı ÖNCE okuyup patch'i onun
    // üzerine uygulamak ZORUNLU, yoksa yalnızca patch'teki alanlarla kayıt üzerine yazılır ve
    // formda/patch'te olmayan tüm alanlar (ad, tarih, saat, katılımcılar...) kalıcı olarak kaybolur.
    let current: CalendarEvent = {}
    if (id) {
      try {
        const fresh = await get(ref(db, writer.path(`etkinlikler/${id}`)))
        current = (fresh.val() as CalendarEvent | null) ?? {}
        if (expectedUpdateTs !== undefined && (current.guncellemeTs ?? null) !== (expectedUpdateTs ?? null)) {
          toast.danger('Bu etkinlik siz düzenlerken başka biri tarafından değiştirildi, sayfa yenilenip tekrar denenecek.')
          return null
        }
      } catch (err) {
        console.error('Çakışma kontrolü başarısız:', err)
      }
    }
    const finalId = id ?? push(ref(db, writer.path('etkinlikler'))).key
    if (!finalId) { toast.danger('Etkinlik kimliği oluşturulamadı.'); return null }

    const toWrite: Record<string, unknown> = { ...current, ...patch, guncellemeTs: serverTimestamp() }
    if (!id) {
      toWrite.olusturmaTs = serverTimestamp()
      toWrite.olusturan = actor.name || actor.email
    }
    const logPath = writer.path('logs/etkinlik')
    const logKey = push(ref(db, logPath)).key
    const updates: Record<string, unknown> = {
      [writer.path(`etkinlikler/${finalId}`)]: toWrite,
      [`${logPath}/${logKey}`]: { by: actor.name || actor.email, email: actor.email, action: logLabel, target: patch.ad ?? '', timestamp: serverTimestamp() },
    }
    try {
      await update(ref(db), updates)
      return finalId
    } catch (err) {
      writer.reportError('Etkinlik kaydedilemedi. Yetkinizi kontrol edin.')(err)
      return null
    }
  }

  const deleteEvent = async (id: string, ev: CalendarEventWithId): Promise<boolean> => {
    const actor = writer.ensureWritable()
    if (!actor) return false
    const logPath = writer.path('logs/etkinlik')
    const logKey = push(ref(db, logPath)).key
    if (!logKey) {
      toast.danger('Etkinlik silinemedi. Log kimliği oluşturulamadı.')
      return false
    }
    try {
      // Silme ile loglamayı aynı çok-yollu güncellemeye bağlama: log kuralları
      // değişse bile etkinlik silme işlemi geri alınmamalı.
      await remove(ref(db, writer.path(`etkinlikler/${id}`)))
      try {
        await update(ref(db), {
          [`${logPath}/${logKey}`]: {
            by: actor.name || actor.email,
            email: actor.email,
            action: `${ev.ad || 'Etkinlik'} etkinliği takvimden silindi`,
            target: ev.ad ?? '',
            timestamp: Date.now(),
          },
        })
      } catch (logError) {
        console.error('Etkinlik silme logu yazılamadı:', logError)
      }
      toast.success('Etkinlik silindi.')
      return true
    } catch (err) {
      writer.reportError('Etkinlik silinemedi.')(err)
      return false
    }
  }

  const toggleLock = async (id: string, ev: CalendarEventWithId): Promise<boolean> => {
    const wasLocked = !!ev.locked
    const label = `${evLogName(ev.ad)} etkinliği ${wasLocked ? 'kilidi açıldı' : 'kilitlendi'}`
    const result = await persistEvent(id, { locked: !wasLocked }, label, ev.guncellemeTs ?? null)
    return !!result
  }

  /** Etkinliği (saat korunarak) başka bir güne, veya aynı gün içinde başka bir başlangıç saatine sürükleyerek taşır. */
  const moveEvent = async (id: string, ev: CalendarEventWithId, newDateKey: string, newStartMin: number): Promise<boolean> => {
    const oldStart = ev.saat ? Number(ev.saat.split(':')[0]) * 60 + Number(ev.saat.split(':')[1]) : 0
    const oldEnd = ev.bitisSaat ? Number(ev.bitisSaat.split(':')[0]) * 60 + Number(ev.bitisSaat.split(':')[1]) : oldStart + 60
    const duration = Math.max(15, oldEnd - oldStart)
    const clampedStart = Math.max(0, Math.min(23 * 60 + 45, newStartMin))
    const newEnd = Math.min(24 * 60, clampedStart + duration)
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

  return { canWrite: writer.canWrite, persistEvent, deleteEvent, toggleLock, moveEvent, resizeEvent, moveMultiDayEvent }
}
