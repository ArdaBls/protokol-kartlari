import { Button, Modal, toast } from '@heroui/react'
import { get, push, ref, serverTimestamp, update } from 'firebase/database'
import { useState } from 'react'
import { FormModal } from '../../components/FormModal'
import { ModalScrollBody, ModalShell, ModalTitle } from '../../components/ModalShell'
import { FieldLabel, SelectField, TextInputField } from '../../components/formControls'
import { useWriter } from '../../hooks/useWriter'
import { db } from '../../lib/firebase'
import { dateKey } from '../../lib/dates'
import type { CalendarEventRef, GanttProject } from './ganttTypes'
import { PALETTE, PALETTE_ORDER, STATUSES, addDays, eventDatesWouldChange, linkedEventDatePatch, parseDateKey, stepProgress } from './ganttTypes'
import { OwnerPicker } from './OwnerPicker'
import type { StepDraft } from './StepsEditor'
import { StepsEditor } from './StepsEditor'
import type { OwnerPoolEntry } from './useOwnerPool'

interface ProjectModalProps {
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
  entry: [string, GanttProject] | null
  events: Record<string, CalendarEventRef | null>
  ownerPool: OwnerPoolEntry[]
}

const STATUS_OPTIONS = Object.entries(STATUSES).map(([value, label]) => ({ value, label }))
const TYPE_OPTIONS = [{ value: 'ozel', label: 'Özel haber' }, { value: 'normal', label: 'Normal haber' }]
const PRIORITY_OPTIONS = [{ value: 'normal', label: 'Normal' }, { value: 'yuksek', label: 'Yüksek' }, { value: 'kritik', label: 'Kritik' }]

function stepsToDraft(project: GanttProject | null): StepDraft[] {
  return Object.entries(project?.adimlar ?? {})
    .filter(([, step]) => step && step.arsiv !== true)
    .sort(([, a], [, b]) => (Number(a.sira) || 0) - (Number(b.sira) || 0))
    .map(([id, step]) => ({ id, ...step }))
}

function ColorPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <FieldLabel>Renk</FieldLabel>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Zaman çizelgesi çubuğu rengi">
        {PALETTE_ORDER.map((key) => (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={value === key}
            aria-label={key}
            onClick={() => onChange(value === key ? '' : key)}
            style={{ background: PALETTE[key] }}
            className={`size-7 rounded-full transition-transform ${value === key ? 'ring-2 ring-offset-2 ring-offset-surface ring-[var(--focus)] scale-110' : ''}`}
          />
        ))}
      </div>
    </div>
  )
}

function ProjectForm({ onOpenChange, entry, events, ownerPool }: Omit<ProjectModalProps, 'isOpen'>) {
  const writer = useWriter()
  const project = entry?.[1] ?? null
  const projectId = entry?.[0] ?? ''
  const today = dateKey(new Date())

  const [ad, setAd] = useState(project?.ad ?? '')
  const [tur, setTur] = useState(project?.tur ?? 'ozel')
  const [durum, setDurum] = useState(project?.durum ?? 'fikir')
  const [baslangicTarihi, setBaslangicTarihi] = useState(project?.baslangicTarihi ?? today)
  const [bitisTarihi, setBitisTarihi] = useState(project?.bitisTarihi ?? dateKey(addDays(new Date(), 7)))
  const [sorumlu, setSorumlu] = useState(project?.sorumlu ?? '')
  const [oncelik, setOncelik] = useState(project?.oncelik ?? 'normal')
  const [renk, setRenk] = useState(project?.renk ?? '')
  const [takvimEtkinlikId, setTakvimEtkinlikId] = useState(project?.takvimEtkinlikId ?? '')
  const [steps, setSteps] = useState<StepDraft[]>(() => stepsToDraft(project))
  const [error, setError] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false)

  const activeSteps = steps.filter((step) => step.durum !== 'iptal')
  const autoProgress = activeSteps.length ? Math.round(activeSteps.reduce((sum, step) => sum + stepProgress(step.durum ?? 'yapilacak'), 0) / activeSteps.length) : null
  const [manualProgress, setManualProgress] = useState(project?.ilerleme ?? 0)
  const progress = autoProgress ?? manualProgress

  const eventOptions = Object.entries(events)
    .filter((entry): entry is [string, CalendarEventRef] => !!entry[1])
    .filter(([id, event]) => !event.projeId || event.projeId === projectId || id === takvimEtkinlikId)
    .sort(([, a], [, b]) => String(a.tarih ?? '').localeCompare(String(b.tarih ?? '')))

  const save = async () => {
    if (!writer.canWrite) { setError('Bu işlem için düzenleme yetkiniz yok.'); return false }
    const title = ad.trim()
    if (!title) { setError('Proje adı zorunludur.'); return false }
    if (!parseDateKey(baslangicTarihi) || !parseDateKey(bitisTarihi)) { setError('Geçerli başlangıç ve bitiş tarihleri girin.'); return false }
    if (bitisTarihi < baslangicTarihi) { setError('Bitiş tarihi başlangıç tarihinden önce olamaz.'); return false }
    for (const [index, step] of steps.entries()) {
      if (!step.ad?.trim()) { setError(`${index + 1}. üretim adımının adı zorunludur.`); return false }
      if (!parseDateKey(step.baslangicTarihi) || !parseDateKey(step.bitisTarihi) || (step.bitisTarihi ?? '') < (step.baslangicTarihi ?? '')) {
        setError(`${index + 1}. üretim adımının tarih aralığı geçersizdir.`)
        return false
      }
    }
    setIsSaving(true)
    setError('')
    try {
      if (projectId && project) {
        const fresh = await get(ref(db, writer.path(`haberProjeleri/${projectId}/guncellemeTs`)))
        if ((fresh.val() ?? null) !== (project.guncellemeTs ?? null)) {
          setError('Bu proje başka biri tarafından değiştirildi. Pencereyi kapatıp yeniden açın.')
          return false
        }
      }
      const nextSteps = Object.fromEntries(
        steps.map((step, index) => [
          step.id,
          {
            ad: step.ad!.trim(),
            durum: step.durum ?? 'yapilacak',
            baslangicTarihi: step.baslangicTarihi,
            bitisTarihi: step.bitisTarihi,
            sorumlu: (step.sorumlu ?? '').trim(),
            ilerleme: stepProgress(step.durum ?? 'yapilacak'),
            sira: index,
            arsiv: false,
          },
        ]),
      )
      const nextProject: GanttProject = {
        ad: title, tur, durum, baslangicTarihi, bitisTarihi, sorumlu, oncelik,
        ilerleme: progress, adimlar: nextSteps, takvimEtkinlikId, renk, arsiv: false,
        olusturan: project?.olusturan || writer.actor!.name || writer.actor!.email,
        olusturmaTs: project?.olusturmaTs ?? (serverTimestamp() as unknown as number),
        guncelleyen: writer.actor!.name || writer.actor!.email,
      }

      const usedId = projectId || push(ref(db, writer.path('haberProjeleri'))).key
      if (!usedId) { setError('Proje kimliği oluşturulamadı.'); return false }
      const previousEventId = project?.takvimEtkinlikId || ''
      const nextEventId = takvimEtkinlikId || ''
      const eventIds = [...new Set([previousEventId, nextEventId].filter(Boolean))]
      const snapshots = await Promise.all(eventIds.map((eventId) => get(ref(db, writer.path(`etkinlikler/${eventId}`)))))
      const latestEvents = Object.fromEntries(eventIds.map((eventId, index) => [eventId, snapshots[index].val() as CalendarEventRef | null]))
      const nextEvent = nextEventId ? latestEvents[nextEventId] : null
      if (nextEventId && !nextEvent) { setError('Bağlanacak takvim etkinliği artık mevcut değil.'); return false }
      if (nextEvent?.projeId && nextEvent.projeId !== usedId) { setError('Bu takvim etkinliği başka bir haber projesine bağlı.'); return false }
      const nextEventDates = nextEvent ? linkedEventDatePatch(nextEvent, bitisTarihi) : null
      if (nextEvent?.locked && nextEventDates && eventDatesWouldChange(nextEvent, nextEventDates)) {
        setError('Bağlı takvim etkinliği kilitli. Tarihleri eşlemek için önce takvimden kilidi açın.')
        return false
      }

      const updates: Record<string, unknown> = { [writer.path(`haberProjeleri/${usedId}`)]: { ...nextProject, guncellemeTs: serverTimestamp() } }
      if (previousEventId && previousEventId !== nextEventId && latestEvents[previousEventId]?.projeId === usedId) {
        updates[writer.path(`etkinlikler/${previousEventId}/projeId`)] = null
      }
      if (nextEventId) {
        updates[writer.path(`etkinlikler/${nextEventId}/projeId`)] = usedId
        Object.entries(nextEventDates ?? {}).forEach(([key, value]) => { updates[writer.path(`etkinlikler/${nextEventId}/${key}`)] = value })
      }

      await update(ref(db), updates)
      await writer.log('haberProje', `${title} haber projesi ${project ? 'güncellendi' : 'oluşturuldu'}`, title)
      toast.success(project ? 'Proje güncellendi.' : 'Proje oluşturuldu.')
      onOpenChange(false)
      return true
    } catch (err) {
      writer.reportError('Proje kaydedilemedi.')(err)
      setError('Proje kaydedilemedi.')
      return false
    } finally {
      setIsSaving(false)
    }
  }

  const archiveOrDelete = async (mode: 'archive' | 'delete') => {
    if (!projectId || !project || !writer.canWrite) return
    try {
      const updates: Record<string, unknown> =
        mode === 'archive'
          ? {
              [writer.path(`haberProjeleri/${projectId}/arsiv`)]: true,
              [writer.path(`haberProjeleri/${projectId}/guncelleyen`)]: writer.actor!.name || writer.actor!.email,
              [writer.path(`haberProjeleri/${projectId}/guncellemeTs`)]: serverTimestamp(),
            }
          : { [writer.path(`haberProjeleri/${projectId}`)]: null }
      if (project.takvimEtkinlikId) {
        const linked = await get(ref(db, writer.path(`etkinlikler/${project.takvimEtkinlikId}`)))
        if ((linked.val() as CalendarEventRef | null)?.projeId === projectId) updates[writer.path(`etkinlikler/${project.takvimEtkinlikId}/projeId`)] = null
      }
      await update(ref(db), updates)
      await writer.log('haberProje', `${project.ad ?? 'Haber projesi'} ${mode === 'archive' ? 'arşivlendi' : 'kalıcı olarak silindi'}`, project.ad ?? '')
      toast.success(mode === 'archive' ? 'Proje arşivlendi.' : 'Proje silindi.')
      onOpenChange(false)
    } catch (err) {
      writer.reportError(mode === 'archive' ? 'Proje arşivlenemedi.' : 'Proje silinemedi.')(err)
    }
  }

  return (
    <>
      <form
        onSubmit={(event) => { event.preventDefault(); void save() }}
        className="flex min-h-0 flex-1 flex-col"
      >
        <ModalTitle title={project ? 'Projeyi düzenle' : 'Yeni proje'} description="Haber projesi" />
        <ModalScrollBody>
          <TextInputField label="Proje adı" value={ad} onChange={setAd} isRequired autoFocus maxLength={180} placeholder="Proje adı" />
          <div className="grid grid-cols-2 gap-4">
            <SelectField label="Haber türü" value={tur} onChange={(v) => setTur(v === 'normal' ? 'normal' : 'ozel')} options={TYPE_OPTIONS} />
            <SelectField label="Durum" value={durum} onChange={setDurum} options={STATUS_OPTIONS} />
            <TextInputField label="Başlangıç" type="date" value={baslangicTarihi} onChange={setBaslangicTarihi} isRequired />
            <TextInputField label="Bitiş / teslim" type="date" value={bitisTarihi} onChange={setBitisTarihi} isRequired />
          </div>
          <OwnerPicker pool={ownerPool} value={sorumlu} onChange={setSorumlu} />
          <SelectField label="Öncelik" value={oncelik} onChange={(v) => setOncelik(v === 'yuksek' || v === 'kritik' ? v : 'normal')} options={PRIORITY_OPTIONS} />
          <div className="flex flex-col gap-1.5">
            <FieldLabel>İlerleme: {progress}%{autoProgress !== null && ' (adımlardan)'}</FieldLabel>
            <input
              type="range" min={0} max={100} step={5} value={progress} disabled={autoProgress !== null}
              onChange={(event) => setManualProgress(Number(event.target.value))}
              className="h-2 w-full accent-[var(--accent)] disabled:opacity-50"
            />
          </div>
          <StepsEditor steps={steps} onChange={setSteps} projectStart={baslangicTarihi} projectEnd={bitisTarihi} />
          <SelectField
            label="Takvim etkinliği"
            value={takvimEtkinlikId}
            onChange={setTakvimEtkinlikId}
            options={[{ value: '', label: 'Bağlantı yok' }, ...eventOptions.map(([id, event]) => ({ value: id, label: `${event.tarih ?? 'Tarihsiz'} — ${event.ad ?? 'Adsız etkinlik'}` }))]}
          />
          <ColorPicker value={renk} onChange={setRenk} />
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        </ModalScrollBody>
        <Modal.Footer className="flex-wrap justify-between gap-2">
          <div className="flex gap-2">
            {project && (
              <>
                <Button type="button" variant="ghost" onPress={() => archiveOrDelete('archive')}>Arşivle</Button>
                <Button type="button" variant="ghost" className="text-danger" onPress={() => setIsConfirmingDelete(true)}>Sil</Button>
              </>
            )}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="tertiary" slot="close">Vazgeç</Button>
            <Button type="submit" variant="primary" isPending={isSaving}>Kaydet</Button>
          </div>
        </Modal.Footer>
      </form>

      <FormModal
        isOpen={isConfirmingDelete}
        onOpenChange={setIsConfirmingDelete}
        title="Projeyi sil?"
        submitLabel="Sil"
        isDanger
        onSubmit={() => { void archiveOrDelete('delete'); setIsConfirmingDelete(false) }}
      >
        <p className="text-sm text-muted">"{project?.ad}" kalıcı olarak silinecek. Bu işlem geri alınamaz.</p>
      </FormModal>
    </>
  )
}

export function ProjectModal({ isOpen, ...props }: ProjectModalProps) {
  return (
    <ModalShell isOpen={isOpen} onOpenChange={props.onOpenChange} size="xl">
      {isOpen && <ProjectForm key={props.entry?.[0] ?? 'new'} {...props} />}
    </ModalShell>
  )
}
