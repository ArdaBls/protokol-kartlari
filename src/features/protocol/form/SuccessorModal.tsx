import { Button, Modal, toast } from '@heroui/react'
import { useState } from 'react'
import { ModalScrollBody, ModalShell, ModalTitle } from '../../../components/ModalShell'
import { SelectField, TextAreaField, TextInputField } from '../../../components/formControls'
import { dateKey } from '../../../lib/dates'
import type { ReasonKind } from '../personChanges'
import type { ListKey, Person, PersonRecord } from '../protocolRules'
import { PREFIX_OPTIONS, safePhotoUrl } from '../protocolRules'
import { useProtocolWriter } from '../useProtocolWriter'
import { PhotoField } from './PhotoField'

interface SuccessorModalProps {
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
  listKey: ListKey
  source: Person
  people: Person[]
  kind: ReasonKind
  /** Soldaki formdaki bitiş tarihi — gerçek ayrılışta eski kayıt bu tarihle pasife alınır. */
  sourceEnd: string
  transitionDate: string
  onSaved: (kind: ReasonKind) => void
}

const PREFIX_SELECT = [{ value: '', label: '(Yok)' }, ...PREFIX_OPTIONS.map((prefix) => ({ value: prefix, label: prefix }))]
const identityOf = (person?: Person) => (person ? `${person.name ?? ''}|${person.title ?? ''}` : null)

function SuccessorForm({ onOpenChange, listKey, source, people, kind, sourceEnd, transitionDate, onSaved }: Omit<SuccessorModalProps, 'isOpen'>) {
  const writer = useProtocolWriter(listKey)
  const [isSaving, setIsSaving] = useState(false)
  const [draft, setDraft] = useState({
    prefix: source.prefix ?? '',
    name: '',
    title: source.title ?? '',
    unit: source.unit ?? '',
    rank: source.rank === '' || source.rank === null || source.rank === undefined ? '' : String(source.rank),
    start: sourceEnd || transitionDate || dateKey(new Date()),
    photo: '',
    note: '',
  })
  const set = <K extends keyof typeof draft>(key: K) => (value: (typeof draft)[K]) => setDraft((current) => ({ ...current, [key]: value }))

  const save = async () => {
    if (isSaving) return
    const name = draft.name.trim()
    const title = draft.title.trim()
    if (!name || !title) return toast.danger('Yeni kişi için isim ve unvan zorunlu.')
    const rankRaw = draft.rank.trim()
    if (rankRaw && !/^\d+$/.test(rankRaw)) return toast.danger('Protokol sırası sadece rakam olmalı.')
    if (kind === 'passive' && !sourceEnd) return toast.danger('Önce eski kaydın bitiş tarihini girin.')

    const live = people.find((person) => person._id === source._id)
    if (!live || identityOf(live) !== identityOf(source)) {
      toast.danger('Kaynak kayıt başka bir kullanıcı tarafından değiştirildi, işlem iptal edildi.')
      onOpenChange(false)
      return
    }

    const record: PersonRecord = {
      prefix: draft.prefix, name, title, unit: draft.unit.trim(), status: 'aktif',
      rank: rankRaw === '' ? '' : Number(rankRaw), photo: safePhotoUrl(draft.photo),
      start: draft.start, end: '', note: draft.note.trim(),
      ...(listKey === 'universite' && Array.isArray(live.faculties) ? { faculties: [...live.faculties] } : {}),
    }
    const newId = writer.newPersonId()
    const updates: Record<string, unknown> = { [writer.personPath(newId)]: record }
    const logs = [{ action: `${name} kişisi, ${live.name || 'eski kayıt'} yerine atandı${record.rank !== '' ? `, ${record.rank}. sıra` : ''}`, target: name }]

    // Gerçek ayrılışta eski kayıt AYNI atomik istekte pasife alınır; yalnızca durum ve bitiş değişir.
    if (kind === 'passive') {
      const { _id, ...liveRecord } = live
      updates[writer.personPath(_id)] = { ...liveRecord, status: 'pasif', end: sourceEnd }
      logs.push({ action: `${live.name || 'Kayıt'} kişisi pasife alındı (yerine ${name} atandı)`, target: live.name ?? '' })
    }

    setIsSaving(true)
    const ok = await writer.commit(updates, logs)
    setIsSaving(false)
    if (!ok) return
    toast.success(`Yeni kişi eklendi: ${name}`)
    onOpenChange(false)
    onSaved(kind)
  }

  return (
    <form onSubmit={(event) => { event.preventDefault(); save() }} className="flex min-h-0 flex-1 flex-col">
      <ModalTitle title="Yerine atanan kişi" description={`${source.name ?? 'Kayıt'} yerine göreve gelen kişinin bilgileri`} />
      <ModalScrollBody>
        <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
          <SelectField label="Unvan ön eki" value={draft.prefix} onChange={set('prefix')} options={PREFIX_SELECT} />
          <TextInputField label="İsim soyisim" value={draft.name} onChange={set('name')} isRequired autoFocus />
        </div>
        <TextInputField label="Görev unvanı" value={draft.title} onChange={set('title')} isRequired />
        <TextInputField label="Birim / kurum" value={draft.unit} onChange={set('unit')} />
        <div className="grid grid-cols-2 gap-3">
          <TextInputField label="Protokol sırası" value={draft.rank} onChange={set('rank')} inputMode="numeric" placeholder="?" />
          <TextInputField label="Başlangıç tarihi" type="date" value={draft.start} onChange={set('start')} />
        </div>
        <PhotoField value={draft.photo} onChange={set('photo')} />
        <TextAreaField label="Not (opsiyonel)" value={draft.note} onChange={set('note')} rows={2} />
      </ModalScrollBody>
      <Modal.Footer>
        <Button variant="tertiary" slot="close">Vazgeç</Button>
        <Button type="submit" variant="primary" isPending={isSaving}>Kaydet</Button>
      </Modal.Footer>
    </form>
  )
}

export function SuccessorModal({ isOpen, ...props }: SuccessorModalProps) {
  return (
    <ModalShell isOpen={isOpen} onOpenChange={props.onOpenChange} size="md">
      <SuccessorForm {...props} />
    </ModalShell>
  )
}
