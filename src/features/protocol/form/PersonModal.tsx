import { Button, Input, Label, Modal, Tabs, TextField, toast } from '@heroui/react'
import { get, ref, serverTimestamp } from 'firebase/database'
import { BadgeCheck, Building2, ImageIcon, ListOrdered, StickyNote, Trash2, UserRound } from 'lucide-react'
import { useEffect, useId, useMemo, useState } from 'react'
import { ModalScrollBody, ModalShell, ModalTitle } from '../../../components/ModalShell'
import { Datalist, FormSection, SelectField, TextAreaField, TextInputField } from '../../../components/formControls'
import { dateKey, formatShortDateKey } from '../../../lib/dates'
import { db } from '../../../lib/firebase'
import { STATUS_LOG_PREFIX, SIMPLE_STATUS_REASON_LABELS, describeRecordChanges, reasonKind } from '../personChanges'
import type { HistoryEntry, ListKey, Person, PersonRecord } from '../protocolRules'
import {
  COORDINATION_ITEMS, PREFIX_OPTIONS, UNIVERSITY_DEFAULT_UNIT, UNIVERSITY_PROTOCOL_TITLES, VERIFICATION_SOURCES, safePhotoUrl,
} from '../protocolRules'
import { useProtocolWriter } from '../useProtocolWriter'
import { FacultyPicker } from './FacultyPicker'
import { HistoryEditor } from './HistoryEditor'
import { PhotoField } from './PhotoField'
import { StatusReasonSection } from './StatusReasonSection'
import { SuccessorModal } from './SuccessorModal'

export interface PersonModalProps {
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
  listKey: ListKey
  person: Person | null
  people: Person[]
  onRequestTrash: (person: Person) => void
  onRequestDeleteForever: (person: Person) => void
}

interface PersonDraft {
  prefix: string; name: string; title: string; unit: string; status: 'aktif' | 'pasif'; rank: string
  start: string; end: string; note: string; photo: string; faculties: string[]; ekGorevAciklamasi: string
  gorevGecmisi: HistoryEntry[]; dogrulamaKaynak: string
}

const PREFIX_SELECT = [{ value: '', label: '(Yok)' }, ...PREFIX_OPTIONS.map((prefix) => ({ value: prefix, label: prefix }))]
const STATUS_SELECT = [{ value: 'aktif', label: 'Aktif' }, { value: 'pasif', label: 'Pasif (arşiv)' }]
const SOURCE_SELECT = Object.entries(VERIFICATION_SOURCES).map(([value, label]) => ({ value, label }))
const identityOf = (person?: Person | null) => (person ? `${person.name ?? ''}|${person.title ?? ''}` : null)

function draftFor(person: Person | null, listKey: ListKey): PersonDraft {
  return {
    prefix: person?.prefix ?? '',
    name: person?.name ?? '',
    title: person?.title ?? '',
    unit: person ? (person.unit ?? '') : listKey === 'universite' ? UNIVERSITY_DEFAULT_UNIT : '',
    status: person?.status === 'pasif' ? 'pasif' : 'aktif',
    rank: person?.rank === '' || person?.rank === null || person?.rank === undefined ? '' : String(person.rank),
    start: person?.start ?? '',
    end: person?.end ?? '',
    note: person?.note ?? '',
    photo: person?.photo ?? '',
    faculties: Array.isArray(person?.faculties) ? [...person.faculties] : [],
    ekGorevAciklamasi: person?.ekGorevAciklamasi ?? '',
    gorevGecmisi: (person?.gorevGecmisi ?? []).map((g) => ({ unvan: g.unvan ?? '', baslangic: g.baslangic ?? '', bitis: g.bitis ?? '' })),
    dogrulamaKaynak: person?.dogrulamaKaynak || 'omu_web',
  }
}

function PersonForm({ onOpenChange, listKey, person, people, onRequestTrash, onRequestDeleteForever }: Omit<PersonModalProps, 'isOpen'>) {
  const writer = useProtocolWriter(listKey)
  const isEditing = person !== null
  const isUniversity = listKey === 'universite'
  const [draft, setDraft] = useState(() => draftFor(person, listKey))
  const [tab, setTab] = useState<'details' | 'history'>('details')
  const [reason, setReason] = useState('')
  const [newTitle, setNewTitle] = useState('')
  const [transitionDate, setTransitionDate] = useState('')
  const [transitionNote, setTransitionNote] = useState('')
  const [isSuccessorOpen, setIsSuccessorOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isVerifying, setIsVerifying] = useState(false)
  const [pool, setPool] = useState<{ birimler: Set<string>; unvanlar: Set<string> }>({ birimler: new Set(), unvanlar: new Set() })
  const unitListId = useId()
  const titleListId = useId()

  const set = <K extends keyof PersonDraft>(key: K) => (value: PersonDraft[K]) => setDraft((current) => ({ ...current, [key]: value }))
  const live = person ? people.find((item) => item._id === person._id) : undefined
  const kind = reasonKind(reason)
  const isSaveLocked = isEditing && draft.status === 'pasif' && kind === 'passive'
  const selectedCoordination = draft.faculties.filter((faculty) => COORDINATION_ITEMS.includes(faculty))

  useEffect(() => {
    get(ref(db, writer.suggestionsPath))
      .then((snap) => {
        const value = (snap.val() ?? {}) as Record<string, Record<string, { deger?: string }>>
        const collect = (kindKey: string) => new Set(Object.values(value[kindKey] ?? {}).map((entry) => entry?.deger).filter((v): v is string => !!v))
        setPool({ birimler: collect('birimler'), unvanlar: collect('unvanlar') })
      })
      .catch((err) => console.error('Öneri havuzu okunamadı (form çalışmaya devam eder):', err))
  }, [writer.suggestionsPath])

  const suggestions = useMemo(() => ({
    units: new Set([...pool.birimler, ...people.map((p) => p.unit ?? '').filter(Boolean)]),
    titles: new Set([...pool.unvanlar, ...people.map((p) => p.title ?? '').filter(Boolean)]),
  }), [pool, people])

  const changeFaculties = (faculties: string[]) =>
    setDraft((current) => ({ ...current, faculties, unit: `${UNIVERSITY_DEFAULT_UNIT}${faculties.length ? ` - ${faculties.join(', ')}` : ''}` }))

  const changeStatus = (status: string) => {
    set('status')(status === 'pasif' ? 'pasif' : 'aktif')
    if (status !== 'pasif') { setReason(''); setTransitionNote('') }
  }

  const changeReason = (value: string) => {
    setReason(value)
    setTransitionNote(SIMPLE_STATUS_REASON_LABELS[value] ?? '')
    if (reasonKind(value) === 'active') setTransitionDate(draft.end || dateKey(new Date()))
  }

  // Kurum içi geçiş: eski unvan görev geçmişine arşivlenir, kişi yeni unvanıyla aktif kalır (Kaydet'e kadar yazılmaz).
  const applyReason = () => {
    const oldTitle = draft.title.trim()
    const nextTitle = newTitle.trim()
    if (!oldTitle) return toast.danger('Mevcut unvan boş, önce unvan girin.')
    if (!nextTitle) return toast.danger('Yeni unvan zorunlu.')
    const date = transitionDate || dateKey(new Date())
    setDraft((current) => ({
      ...current,
      gorevGecmisi: [...current.gorevGecmisi, { unvan: oldTitle, baslangic: current.start, bitis: date }],
      title: nextTitle, start: date, status: 'aktif', end: '',
    }))
    setTransitionNote(`${reason === 'yeni_gorev' ? 'Yeni göreve atandı' : 'Görevden geri çekildi'}: ${oldTitle} → ${nextTitle}`)
    setReason('')
    setNewTitle('')
    toast.success(`Uygulandı: ${nextTitle}. Değişiklikleri kaydetmeyi unutmayın.`)
  }

  const verifyNow = async () => {
    if (!person || !live || isVerifying) return
    if (identityOf(live) !== identityOf(person)) return toast.danger('Kayıt başka bir kullanıcı tarafından değiştirildi, doğrulama yapılmadı.')
    const actorName = writer.actor?.name || writer.actor?.email || ''
    const base = writer.personPath(person._id)
    setIsVerifying(true)
    const ok = await writer.commit(
      { [`${base}/dogrulamaKaynak`]: draft.dogrulamaKaynak, [`${base}/sonDogrulamaTs`]: serverTimestamp(), [`${base}/dogrulayan`]: actorName },
      [{ action: `${live.name || 'Kayıt'} kişisi doğrulandı · Kaynak: ${VERIFICATION_SOURCES[draft.dogrulamaKaynak] ?? draft.dogrulamaKaynak}`, target: live.name }],
    )
    setIsVerifying(false)
    if (ok) toast.success(`Doğrulama kaydedildi: ${live.name ?? ''}`)
  }

  const save = async () => {
    if (isSaving) return
    if (isSaveLocked) return toast.danger("Bu kayıt yerine biri atanmadan pasife alınamaz. Önce 'Yerine yeni kişi ata' ile kaydedin.")
    const name = draft.name.trim()
    const title = draft.title.trim()
    if (!name || !title) return toast.danger('İsim ve unvan zorunlu.')
    if (draft.status === 'pasif' && !draft.end) return toast.danger('Pasif kayıtlar için bitiş tarihi girilmelidir.')
    const rankRaw = draft.rank.trim()
    if (rankRaw && !/^\d+$/.test(rankRaw)) return toast.danger('Protokol sırası sadece rakam olmalı.')

    const record: PersonRecord = {
      prefix: draft.prefix, name, title, unit: draft.unit.trim(), status: draft.status,
      rank: rankRaw === '' ? '' : Number(rankRaw), photo: safePhotoUrl(draft.photo),
      start: draft.start, end: draft.status === 'pasif' ? draft.end : '', note: draft.note.trim(),
      gorevGecmisi: draft.gorevGecmisi,
      ...(isUniversity ? { faculties: draft.faculties, ekGorevAciklamasi: draft.ekGorevAciklamasi.trim() } : {}),
    }
    const rankSuffix = record.rank !== '' ? `, ${record.rank}. sıra` : ''

    let id: string
    let data: PersonRecord
    let action: string
    if (!person) {
      id = writer.newPersonId()
      data = record
      action = `${name} kişisi eklendi${rankSuffix}`
    } else {
      // Modal açıldığından beri aynı kişinin hâlâ yerinde olduğu doğrulanır; yoksa başkasının kaydı ezilirdi.
      if (!live || identityOf(live) !== identityOf(person)) {
        toast.danger('Liste başka bir kullanıcı tarafından değiştirildi, kayıt yapılmadı. Lütfen tekrar deneyin.')
        onOpenChange(false)
        return
      }
      const { _id, ...liveRecord } = live
      id = _id
      data = { ...liveRecord, ...record }
      const changes = describeRecordChanges(liveRecord, data)
      if (liveRecord.status === 'silindi') {
        const rest = changes.filter((change) => !change.startsWith(STATUS_LOG_PREFIX))
        action = `${name} kişisi çöp kutusundan geri alındı${rankSuffix}${rest.length ? ` · ${rest.join(' · ')}` : ''}`
      } else if (changes.length) {
        action = `${name} kişisi güncellendi · ${transitionNote ? `${transitionNote} · ` : ''}${changes.join(' · ')}`
      } else {
        action = `${name} kişisi kaydedildi (içerikte değişiklik yok)`
      }
    }

    setIsSaving(true)
    const ok = await writer.commit({ [writer.personPath(id)]: data }, [{ action, target: name }])
    setIsSaving(false)
    if (!ok) return
    if (record.unit && !pool.birimler.has(record.unit)) writer.saveSuggestion('birimler', record.unit)
    if (!pool.unvanlar.has(title)) writer.saveSuggestion('unvanlar', title)
    toast.success('Kayıt başarıyla kaydedildi.')
    onOpenChange(false)
  }

  const verifiedInfo = live?.sonDogrulamaTs
    ? `Son doğrulama: ${formatShortDateKey(dateKey(new Date(live.sonDogrulamaTs)))} ${new Date(live.sonDogrulamaTs).getFullYear()} · ${VERIFICATION_SOURCES[live.dogrulamaKaynak ?? ''] ?? live.dogrulamaKaynak ?? '—'}${live.dogrulayan ? ` · ${live.dogrulayan}` : ''}`
    : 'Bu kayıt hiç doğrulanmadı.'

  const identitySection = (
    <FormSection title="Kimlik" icon={UserRound}>
      <div className="grid gap-3 sm:grid-cols-[9.5rem_1fr]">
        <SelectField label="Unvan ön eki" value={draft.prefix} onChange={set('prefix')} options={PREFIX_SELECT} />
        <TextInputField label="İsim soyisim" value={draft.name} onChange={set('name')} isRequired />
      </div>
      <TextInputField label="Görev unvanı" value={draft.title} onChange={set('title')} isRequired list={titleListId} placeholder="Örn. Rektör" />
      <TextInputField label="Birim / kurum" value={draft.unit} onChange={set('unit')} list={unitListId} />
      <Datalist id={titleListId} values={suggestions.titles} />
      <Datalist id={unitListId} values={suggestions.units} />
    </FormSection>
  )

  const unitsSection = isUniversity && (
    <FormSection title="Bağlı birimler" icon={Building2} description="Opsiyonel · birden fazla seçilebilir">
      <FacultyPicker selected={draft.faculties} onChange={changeFaculties} showLabel={false} />
      {selectedCoordination.length > 0 && (
        <TextField value={draft.ekGorevAciklamasi} onChange={set('ekGorevAciklamasi')}>
          <Label>{`${selectedCoordination.join(', ')} birimindeki ek görevi`}</Label>
          <Input placeholder="Örn. Koordinatör, Koordinatör Yardımcısı, Üye" autoComplete="off" />
        </TextField>
      )}
    </FormSection>
  )

  const statusSection = (
    <FormSection title="Protokol ve durum" icon={ListOrdered}>
      <div className="grid grid-cols-2 gap-3">
        <SelectField label="Durum" value={draft.status} onChange={changeStatus} options={STATUS_SELECT} />
        <TextInputField label="Protokol sırası" value={draft.rank} onChange={set('rank')} inputMode="numeric" placeholder="?" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <TextInputField label="Başlangıç tarihi" type="date" value={draft.start} onChange={set('start')} />
        {draft.status === 'pasif' && <TextInputField label="Bitiş tarihi" type="date" value={draft.end} onChange={set('end')} />}
      </div>
      {isEditing && draft.status === 'pasif' && (
        <StatusReasonSection
          reason={reason}
          onReasonChange={changeReason}
          newTitle={newTitle}
          onNewTitleChange={setNewTitle}
          transitionDate={transitionDate}
          onTransitionDateChange={setTransitionDate}
          onApply={applyReason}
          onOpenSuccessor={() => setIsSuccessorOpen(true)}
        />
      )}
      {isUniversity && (
        <details className="rounded-xl bg-surface px-3 py-2.5 text-sm">
          <summary className="cursor-pointer text-muted">Protokol sırası referansı</summary>
          <ol className="mt-2 grid gap-1 text-muted sm:grid-cols-2">
            {UNIVERSITY_PROTOCOL_TITLES.map((title, index) => (
              <li key={title} className="flex gap-2"><span className="w-5 font-semibold text-accent tabular-nums">{index + 1}</span>{title}</li>
            ))}
          </ol>
        </details>
      )}
    </FormSection>
  )

  const verifySection = isEditing && (
    <FormSection title="Veri doğrulama" icon={BadgeCheck} description={verifiedInfo}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <SelectField label="Doğrulama kaynağı" value={draft.dogrulamaKaynak} onChange={set('dogrulamaKaynak')} options={SOURCE_SELECT} className="flex-1" />
        <Button variant="secondary" isPending={isVerifying} onPress={verifyNow}>
          <BadgeCheck size={16} />
          Şimdi doğrula
        </Button>
      </div>
    </FormSection>
  )

  return (
    <>
      <form onSubmit={(event) => { event.preventDefault(); save() }} className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ModalTitle
          title={isEditing ? 'Kaydı düzenle' : 'Yeni kişi ekle'}
          description={isEditing ? 'Değişiklikler kaydedince yayına alınır.' : 'Bilgileri doldurun; fotoğraf otomatik sığdırılır.'}
        />
        {isEditing && (
          <div className="px-6">
            <Tabs selectedKey={tab} onSelectionChange={(key) => setTab(key as 'details' | 'history')} variant="secondary">
              <Tabs.ListContainer>
                <Tabs.List aria-label="Form bölümleri">
                  <Tabs.Tab id="details">Bilgiler<Tabs.Indicator /></Tabs.Tab>
                  <Tabs.Tab id="history">Görev geçmişi{draft.gorevGecmisi.length ? ` (${draft.gorevGecmisi.length})` : ''}<Tabs.Indicator /></Tabs.Tab>
                </Tabs.List>
              </Tabs.ListContainer>
            </Tabs>
          </div>
        )}

        <ModalScrollBody className="pt-4">
          {tab === 'history' && isEditing ? (
            <HistoryEditor
              entries={draft.gorevGecmisi}
              onChange={set('gorevGecmisi')}
              current={{ title: draft.title.trim(), start: draft.start, end: draft.end }}
              onEntryAdded={set('start')}
            />
          ) : (
            <div className="grid items-start gap-4 lg:grid-cols-2">
              <div className="flex flex-col gap-4">
                {identitySection}
                <FormSection title="Fotoğraf" icon={ImageIcon}>
                  <PhotoField value={draft.photo} onChange={set('photo')} />
                </FormSection>
                {unitsSection}
              </div>
              <div className="flex flex-col gap-4">
                {statusSection}
                <FormSection title="Not" icon={StickyNote} description="Kartın altında görünür">
                  <TextAreaField label="Not (opsiyonel)" value={draft.note} onChange={set('note')} rows={3} />
                </FormSection>
                {verifySection}
              </div>
            </div>
          )}
        </ModalScrollBody>

        <Modal.Footer className="flex flex-col-reverse gap-2 border-t border-separator pt-4 sm:flex-row sm:items-center sm:justify-between">
          {isEditing && person ? (
            <div className="flex gap-2">
              <Button variant="danger-soft" size="sm" onPress={() => onRequestTrash(person)}>
                <Trash2 size={14} />
                Çöpe at
              </Button>
              <Button variant="ghost" size="sm" className="text-danger" onPress={() => onRequestDeleteForever(person)}>
                Kalıcı sil
              </Button>
            </div>
          ) : <span />}
          <div className="flex justify-end gap-2">
            <Button variant="tertiary" slot="close">Vazgeç</Button>
            <Button type="submit" variant="primary" isPending={isSaving} isDisabled={isSaveLocked}>Kaydet</Button>
          </div>
        </Modal.Footer>
      </form>

      {person && live && isSuccessorOpen && (
        <SuccessorModal
          isOpen={isSuccessorOpen}
          onOpenChange={setIsSuccessorOpen}
          listKey={listKey}
          source={person}
          people={people}
          kind={kind}
          sourceEnd={draft.end}
          transitionDate={transitionDate}
          onSaved={(savedKind) => {
            // Gerçek ayrılışta eski kayıt pasife alınarak zaten yazıldı; açık formun eski hâli ezmesin diye kapatılır.
            if (savedKind === 'passive') onOpenChange(false)
          }}
        />
      )}
    </>
  )
}

export function PersonModal({ isOpen, ...props }: PersonModalProps) {
  return (
    <ModalShell isOpen={isOpen} onOpenChange={props.onOpenChange} size="xl">
      <PersonForm key={props.person?._id ?? 'new'} {...props} />
    </ModalShell>
  )
}
