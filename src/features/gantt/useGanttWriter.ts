import { toast } from '@heroui/react'
import { get, ref, serverTimestamp, update } from 'firebase/database'
import { useWriter } from '../../hooks/useWriter'
import { db } from '../../lib/firebase'
import { firebaseRecordStore } from '../calendar/firebaseRecordStore'
import { mutateExistingRecord } from '../calendar/recordTransactions'
import { assertEventRevision } from '../calendar/eventMutations'
import type { CalendarEventRef, GanttProject } from './ganttTypes'
import { eventDatesWouldChange, linkedEventDatePatch } from './ganttTypes'

/** Zaman çizelgesinde bir çubuk sürüklenip bırakıldığında (proje veya adım) tarihleri kaydeder. */
export function useGanttWriter() {
  const writer = useWriter()

  const updateProjectDates = async (
    id: string,
    project: GanttProject,
    startKey: string,
    endKey: string,
    stepId: string,
    expectedUpdateTs: number | undefined,
  ): Promise<boolean> => {
    const actor = writer.ensureWritable()
    if (!actor) return false
    const itemPath = stepId ? `haberProjeleri/${id}/adimlar/${stepId}` : `haberProjeleri/${id}`
    const item = stepId ? project.adimlar?.[stepId] : project
    const updates: Record<string, unknown> = {
      [writer.path(`${itemPath}/baslangicTarihi`)]: startKey,
      [writer.path(`${itemPath}/bitisTarihi`)]: endKey,
      [writer.path(`haberProjeleri/${id}/guncelleyen`)]: writer.actor!.name || writer.actor!.email,
      [writer.path(`haberProjeleri/${id}/guncellemeTs`)]: serverTimestamp(),
    }
    try {
      const fresh = (await get(ref(db, writer.path(`haberProjeleri/${id}`)))).val() as GanttProject | null
      if (!fresh) throw new Error('Proje artık mevcut değil.')
      assertEventRevision(fresh, expectedUpdateTs ?? null)
      if (!stepId && fresh.takvimEtkinlikId) {
        const eventId = fresh.takvimEtkinlikId
        const eventSnap = await get(ref(db, writer.path(`etkinlikler/${eventId}`)))
        const linkedEvent = eventSnap.val() as CalendarEventRef | null
        if (!linkedEvent || linkedEvent.projeId !== id) {
          // Silinmiş veya yeniden bağlanmış etkinlik projeyi taşınamaz hale getirmesin.
          updates[writer.path(`haberProjeleri/${id}/takvimEtkinlikId`)] = null
        } else {
          const datePatch = linkedEventDatePatch(linkedEvent, endKey)
          if (linkedEvent.locked && eventDatesWouldChange(linkedEvent, datePatch)) {
            throw new Error('Bağlı takvim etkinliği kilitli. Önce takvimden kilidi açın.')
          }
          Object.entries(datePatch).forEach(([key, value]) => { updates[writer.path(`etkinlikler/${eventId}/${key}`)] = value })
          if (eventDatesWouldChange(linkedEvent, datePatch)) updates[writer.path(`etkinlikler/${eventId}/autoLockedForDate`)] = null
          updates[writer.path(`etkinlikler/${eventId}/guncellemeTs`)] = serverTimestamp()
        }
        if (!writer.ensureWritable()) return false
        await update(ref(db), updates)
      } else {
        await mutateExistingRecord(firebaseRecordStore<GanttProject>(writer.path(`haberProjeleri/${id}`), writer.ensureWritable), (current) => {
          assertEventRevision(current, expectedUpdateTs ?? null)
          if (stepId && !current.adimlar?.[stepId]) throw new Error('Üretim adımı artık mevcut değil.')
          const dates = { baslangicTarihi: startKey, bitisTarihi: endKey }
          return { ...current, ...(stepId ? { adimlar: { ...current.adimlar, [stepId]: { ...current.adimlar![stepId], ...dates } } } : dates),
            guncelleyen: actor.name || actor.email, guncellemeTs: serverTimestamp() as unknown as number }
        })
      }
      if (writer.ensureWritable()) {
        try { await writer.log('haberProje', `${item?.ad || project.ad || 'Haber projesi'} ${stepId ? 'üretim adımı' : 'haber projesi'} zaman çizelgesinde taşındı · ${startKey} → ${endKey}`, project.ad ?? '') }
        catch (err) { console.error('Proje taşındı ancak log yazılamadı:', err) }
      }
      toast.success('Proje tarihleri güncellendi.')
      return true
    } catch (err) {
      writer.reportError(err instanceof Error ? err.message : 'Proje tarihleri güncellenemedi.')(err)
      return false
    }
  }

  return { canWrite: writer.canWrite, updateProjectDates }
}
