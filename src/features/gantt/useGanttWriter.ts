import { toast } from '@heroui/react'
import { get, ref, serverTimestamp, update } from 'firebase/database'
import { useWriter } from '../../hooks/useWriter'
import { db } from '../../lib/firebase'
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
    if (!writer.canWrite) {
      toast.danger('Bu işlem için düzenleme yetkiniz yok.')
      return false
    }
    const itemPath = stepId ? `haberProjeleri/${id}/adimlar/${stepId}` : `haberProjeleri/${id}`
    const item = stepId ? project.adimlar?.[stepId] : project
    const updates: Record<string, unknown> = {
      [writer.path(`${itemPath}/baslangicTarihi`)]: startKey,
      [writer.path(`${itemPath}/bitisTarihi`)]: endKey,
      [writer.path(`haberProjeleri/${id}/guncelleyen`)]: writer.actor!.name || writer.actor!.email,
      [writer.path(`haberProjeleri/${id}/guncellemeTs`)]: serverTimestamp(),
    }
    try {
      if (expectedUpdateTs !== undefined) {
        const fresh = await get(ref(db, writer.path(`haberProjeleri/${id}/guncellemeTs`)))
        if ((fresh.val() ?? null) !== (expectedUpdateTs ?? null)) throw new Error('Bu proje başka biri tarafından değiştirildi.')
      }
      if (!stepId && project.takvimEtkinlikId) {
        const eventId = project.takvimEtkinlikId
        const eventSnap = await get(ref(db, writer.path(`etkinlikler/${eventId}`)))
        const linkedEvent = eventSnap.val() as CalendarEventRef | null
        if (linkedEvent?.projeId !== id) throw new Error('Bağlı takvim etkinliği artık bu projeye ait değil.')
        const datePatch = linkedEventDatePatch(linkedEvent, endKey)
        if (linkedEvent.locked && eventDatesWouldChange(linkedEvent, datePatch)) {
          throw new Error('Bağlı takvim etkinliği kilitli. Önce takvimden kilidi açın.')
        }
        Object.entries(datePatch).forEach(([key, value]) => { updates[writer.path(`etkinlikler/${eventId}/${key}`)] = value })
        updates[writer.path(`etkinlikler/${eventId}/guncellemeTs`)] = serverTimestamp()
      }
      await update(ref(db), updates)
      await writer.log('haberProje', `${item?.ad || project.ad || 'Haber projesi'} ${stepId ? 'üretim adımı' : 'haber projesi'} zaman çizelgesinde taşındı · ${startKey} → ${endKey}`, project.ad ?? '')
      toast.success('Proje tarihleri güncellendi.')
      return true
    } catch (err) {
      writer.reportError('Proje tarihleri güncellenemedi.')(err)
      return false
    }
  }

  return { canWrite: writer.canWrite, updateProjectDates }
}
