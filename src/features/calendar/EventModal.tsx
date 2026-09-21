import { Button, Modal, toast } from '@heroui/react'
import { Building2, CalendarClock, Info, Newspaper, StickyNote, Trash2, Users } from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '../../auth/useAuth'
import { FormModal } from '../../components/FormModal'
import { ModalScrollBody, ModalShell, ModalTitle } from '../../components/ModalShell'
import { FieldLabel, FormSection, SelectField, TextAreaField, TextInputField } from '../../components/formControls'
import { useDbMode } from '../../lib/dbMode'
import { FACULTY_GROUPS, hierarchyWeight, institutionWeight } from '../protocol/protocolRules'
import { createAttendanceRequest } from '../notifications/attendance'
import { AttendeePicker } from './AttendeePicker'
import { NewsPanel } from './NewsPanel'
import { PressRolePicker } from './PressRolePicker'
import type { Attendee, CalendarEventWithId } from './calendarTypes'
import { EVENT_BADGES, EVENT_STATUS, EVENT_TYPES, QUICK_DRAFT_NAME, calHasEventEnded, hmToMin, parseGorevliString, parseKey } from './calendarTypes'
import { IL_PROTOCOL_UNIT_GROUPS, isFacultyUnit, isIlProtocolUnit } from './unitGroups'
import { useCalendarWriter, describeChanges, evLogName } from './useCalendarWriter'

interface EventModalProps {
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
  entry: [string, CalendarEventWithId] | null
  presetDate?: string
  presetTime?: string
  presetEndTime?: string
}

const DIGER = '__diger__'
const HABER_KAYNAKLARI = ['İHA', 'AA', 'DHA', 'ANKA']

function GroupedUnitSelect({ ilMode, value, onChange, otherActive }: { ilMode: boolean; value: string; onChange: (value: string) => void; otherActive: boolean }) {
  const groups = ilMode ? IL_PROTOCOL_UNIT_GROUPS : FACULTY_GROUPS
  return (
    <select
      value={otherActive ? DIGER : value}
      onChange={(event) => onChange(event.target.value)}
      className="h-10 w-full rounded-[var(--field-radius)] border border-[var(--field-border)] bg-[var(--field-background)] px-3 text-sm outline-none hover:border-[var(--field-border-hover)]"
    >
      <option value="">—</option>
      {groups.map((group) => (
        <optgroup key={group.title} label={group.title}>
          {group.items.map((item) => (
            <option key={item} value={item}>{item}</option>
          ))}
        </optgroup>
      ))}
      <option value={DIGER}>Diğer…</option>
    </select>
  )
}

function TimeField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <FieldLabel>{label}</FieldLabel>
      <div className="flex items-center gap-1.5">
        <input
          type="time"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-10 w-full rounded-[var(--field-radius)] border border-[var(--field-border)] bg-[var(--field-background)] px-3 text-sm outline-none hover:border-[var(--field-border-hover)]"
        />
        <button
          type="button"
          title="Şu anki saati yaz"
          onClick={() => { const now = new Date(); onChange(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`) }}
          className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-default"
        >
          ⏱
        </button>
      </div>
    </div>
  )
}

function EventForm({ onOpenChange, entry, presetDate, presetTime, presetEndTime }: Omit<EventModalProps, 'isOpen'>) {
  const { state } = useAuth()
  const { isTestMode } = useDbMode()
  const writer = useCalendarWriter()
  const ev = entry?.[1] ?? null
  const id = entry?.[0] ?? null
  const isLocked = !!ev?.locked
  const isEditor = state.status === 'ready' && state.role === 'editor'

  const initialTarih = ev?.tarih || presetDate || ''
  const initialBirim = ev?.birim ?? ''
  const initialBirimIl = !!initialBirim && isIlProtocolUnit(initialBirim)
  const initialBirimOther = !!initialBirim && !initialBirimIl && !isFacultyUnit(initialBirim)

  const [ad, setAd] = useState(ev?.ad ?? '')
  const [tur, setTur] = useState(ev?.tur ?? 'diger')
  const [durum, setDurum] = useState(ev?.durum ?? 'planlandi')
  const [rozetler, setRozetler] = useState<string[]>(ev?.rozetler ?? [])
  const [cokGunlu, setCokGunlu] = useState(!!(ev?.bitisTarihi && ev.bitisTarihi !== ev.tarih))
  const [tarih, setTarih] = useState(initialTarih)
  const [saat, setSaat] = useState(ev?.saat || presetTime || '')
  const [bitisSaat, setBitisSaat] = useState(ev?.bitisSaat || presetEndTime || '')
  const [bitisTarihi, setBitisTarihi] = useState(ev?.bitisTarihi || initialTarih)
  const [yer, setYer] = useState(ev?.yer ?? '')
  const [birimIlMode, setBirimIlMode] = useState(initialBirimIl)
  const [birim, setBirim] = useState(initialBirimOther ? DIGER : initialBirim)
  const [birimDiger, setBirimDiger] = useState(initialBirimOther ? initialBirim : '')
  const [planlayan, setPlanlayan] = useState(ev?.planlayan ?? '')
  const [gorevli, setGorevli] = useState<string[]>(ev ? parseGorevliString(ev.gorevli) : [])
  const [haberYazanlari, setHaberYazanlari] = useState<string[]>(ev ? parseGorevliString(ev.haberYazanlari) : [])
  const [attendees, setAttendees] = useState<Attendee[]>(ev?.katilimcilar ?? [])
  const [includeIl, setIncludeIl] = useState(!!ev?.katilimcilar?.some((a) => a.kaynak === 'il'))
  const [haberKaynagi, setHaberKaynagi] = useState(ev?.haberKaynagi ?? '')
  const [not, setNot] = useState(ev?.not ?? '')
  const [showNewsPanel, setShowNewsPanel] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false)
  const [pendingPress, setPendingPress] = useState<string[]>([])
  const [pendingNews, setPendingNews] = useState<string[]>([])

  if (state.status !== 'ready') return null
  const actorUid = state.user.uid
  const actorName = state.displayName

  const birimValue = birim === DIGER ? birimDiger.trim() : birim

  const togglePressRole = async (name: string, role: 'gorevli' | 'haberYazanlari', checked: boolean) => {
    const setList = role === 'gorevli' ? setGorevli : setHaberYazanlari
    const draftEv = { tarih, saat: cokGunlu ? '' : saat, bitisSaat: cokGunlu ? '' : bitisSaat, bitisTarihi: cokGunlu ? bitisTarihi : null }
    if (checked && isEditor && calHasEventEnded(draftEv)) {
      if (!id) {
        const pendingSet = role === 'gorevli' ? setPendingPress : setPendingNews
        pendingSet((current) => (current.includes(name) ? current : [...current, name]))
        toast.success(`${name} için katılım talebi, etkinlik oluşturulunca admin/owner onayına gönderilecek.`)
        return
      }
      try {
        await createAttendanceRequest({ eventId: id, eventName: ad, eventDate: tarih, attendeeName: name, role, requestedByUid: actorUid, requestedByName: actorName }, isTestMode)
        toast.success(`${name} için katılım talebi admin/owner onayına gönderildi.`)
      } catch (err) {
        console.error('Katılım talebi oluşturulamadı:', err)
        toast.danger('Katılım talebi oluşturulamadı.')
      }
      return
    }
    setList((current) => (checked ? (current.includes(name) ? current : [...current, name]) : current.filter((n) => n !== name)))
  }

  const applyProtocolOrder = () => {
    if (!attendees.length) { toast.warning('Katılımcı eklenmemiş.'); return }
    const sorted = [...attendees].sort((a, b) => {
      // Tik açıksa Vali Tebrikat hiyerarşisi (hierarchyWeight/institutionWeight), kapalıysa yalnızca üniversite rank'ı.
      if (includeIl) {
        const pa = { ...a, _id: a.name }; const pb = { ...b, _id: b.name }
        const ha = hierarchyWeight(pa); const hb = hierarchyWeight(pb)
        if (ha !== hb) return ha - hb
        const ia = institutionWeight(pa); const ib = institutionWeight(pb)
        if (ia !== ib) return ia - ib
      }
      const ra = a.rank === '' || a.rank === null || a.rank === undefined || Number.isNaN(Number(a.rank)) ? Infinity : Number(a.rank)
      const rb = b.rank === '' || b.rank === null || b.rank === undefined || Number.isNaN(Number(b.rank)) ? Infinity : Number(b.rank)
      if (ra !== rb) return ra - rb
      return a.name.localeCompare(b.name, 'tr')
    })
    setAttendees(sorted)
    toast.success(`Katılımcılar ${includeIl ? 'Vali Tebrikat protokol' : 'üniversite protokol'} sırasına göre düzenlendi. Kaydetmeyi unutmayın.`)
    setShowNewsPanel(true)
  }

  const save = async () => {
    if (isLocked) { toast.danger('Bu etkinlik kilitli. Kaydetmek için önce kilidi açın.'); return false }
    const title = ad.trim()
    if (!title) { toast.warning('Etkinlik adı zorunlu.'); return false }
    if (!parseKey(tarih)) { toast.warning('Geçerli bir tarih seçin!'); return false }
    if (cokGunlu) {
      if (!parseKey(bitisTarihi)) { toast.warning('Geçerli bir bitiş tarihi seçin!'); return false }
      if (bitisTarihi < tarih) { toast.warning('Bitiş tarihi, başlangıç tarihinden önce olamaz.'); return false }
    }
    const saatVal = cokGunlu ? '' : saat
    const bitisVal = cokGunlu ? '' : bitisSaat
    if (saatVal && bitisVal && hmToMin(bitisVal) !== null && hmToMin(saatVal) !== null && (hmToMin(bitisVal) as number) <= (hmToMin(saatVal) as number)) {
      const confirmed = window.confirm(`Bitiş saati (${bitisVal}), başlangıçtan (${saatVal}) önce görünüyor.\n\nBu etkinlik gece yarısını geçiyor mu (bitiş ertesi gün)?\n\n"Tamam" derseniz bu şekilde kaydedilir, "İptal" ile saatleri düzeltebilirsiniz.`)
      if (!confirmed) { toast.warning('Bitiş saati başlangıçtan sonra olmalı.'); return false }
    }

    let finalGorevli = gorevli
    let finalHaberYazanlari = haberYazanlari
    const draftEv = { tarih, saat: saatVal, bitisSaat: bitisVal, bitisTarihi: cokGunlu ? bitisTarihi : null }
    if (!calHasEventEnded(draftEv)) {
      finalGorevli = [...new Set([...gorevli, ...pendingPress])]
      finalHaberYazanlari = [...new Set([...haberYazanlari, ...pendingNews])]
    }

    setIsSaving(true)
    try {
      const patch = {
        ad: title, tur, durum, rozetler,
        tarih, saat: saatVal || '', bitisSaat: bitisVal || '',
        bitisTarihi: cokGunlu && bitisTarihi && bitisTarihi !== tarih ? bitisTarihi : null,
        yer: yer.trim(), birim: birimValue, planlayan: planlayan.trim(),
        gorevli: [...finalGorevli].sort((a, b) => a.localeCompare(b, 'tr')).join(', '),
        haberYazanlari: [...finalHaberYazanlari].sort((a, b) => a.localeCompare(b, 'tr')).join(', '),
        katilimcilar: attendees, haberKaynagi, not: not.trim(), taslak: title === QUICK_DRAFT_NAME ? true : null,
        tamamlayan: durum === 'tamamlandi' ? (ev?.durum === 'tamamlandi' ? ev.tamamlayan || actorName : actorName) : null,
        tamamlayanEmail: durum === 'tamamlandi' ? (ev?.durum === 'tamamlandi' ? ev.tamamlayanEmail || (state.user.email ?? '') : state.user.email ?? '') : null,
        tamamlayanUid: durum === 'tamamlandi' ? (ev?.durum === 'tamamlandi' ? ev.tamamlayanUid || actorUid : actorUid) : null,
      }
      const logLabel = id
        ? `${evLogName(title)} etkinliği düzenlendi${ev ? (() => { const changes = describeChanges(ev, { ...ev, ...patch }); return changes.length ? ` · ${changes.join(' · ')}` : '' })() : ''}`
        : `${evLogName(title)} etkinliği oluşturuldu`
      const resultId = await writer.persistEvent(id, patch, logLabel, id ? ev?.guncellemeTs ?? null : undefined)
      if (!resultId) return false
      toast.success(id ? 'Etkinlik kaydedildi.' : 'Etkinlik oluşturuldu.')

      const pendingNames = [...pendingPress.map((name) => ({ name, role: 'gorevli' as const })), ...pendingNews.map((name) => ({ name, role: 'haberYazanlari' as const }))]
      if (pendingNames.length) {
        Promise.all(pendingNames.map((p) => createAttendanceRequest({ eventId: resultId, eventName: title, eventDate: tarih, attendeeName: p.name, role: p.role, requestedByUid: actorUid, requestedByName: actorName }, isTestMode)))
          .then(() => toast.success(`${pendingNames.length} kişi için katılım talebi admin/owner onayına gönderildi.`))
          .catch((err) => { console.error('Katılım talepleri oluşturulamadı:', err); toast.danger('Katılım talepleri oluşturulurken bir hata oluştu.') })
      }
      onOpenChange(false)
      return true
    } finally {
      setIsSaving(false)
    }
  }

  const remove = async () => {
    if (!id || !ev) return
    if (isLocked) { toast.danger('Bu etkinlik kilitli. Silmek için önce kilidi açın.'); return }
    await writer.deleteEvent(id, ev)
    onOpenChange(false)
  }

  const unlock = async () => {
    if (!id || !ev) return
    await writer.toggleLock(id, ev)
    onOpenChange(false)
  }

  const readOnly = !writer.canWrite

  return (
    <>
      <form onSubmit={(event) => { event.preventDefault(); void save() }} className="flex min-h-0 flex-1 flex-col">
        <ModalTitle title={id ? 'Etkinliği Düzenle' : 'Yeni Etkinlik'} description={isLocked ? '🔒 Bu etkinlik kilitli — düzenlemek için önce kilidi açın.' : undefined} />
        <ModalScrollBody>
          {isLocked && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-warning">
              <span>🔒 Bu etkinlik kilitli. Düzenlemek için önce kilidi açmanız gerekir.</span>
              {writer.canWrite && <Button type="button" variant="secondary" onPress={unlock}>Kilidi Aç</Button>}
            </div>
          )}
          <fieldset disabled={readOnly || isLocked} className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <FormSection title="Temel Bilgiler" icon={Info} className="lg:col-span-2">
              <TextInputField label="Etkinlik Adı" value={ad} onChange={setAd} isRequired />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <SelectField label="Tür" value={tur} onChange={setTur} options={EVENT_TYPES.map((t) => ({ value: t.key, label: t.ad }))} />
                <SelectField label="Durum" value={durum} onChange={setDurum} options={EVENT_STATUS.map((s) => ({ value: s.key, label: s.ad }))} />
              </div>
              <div className="flex flex-col gap-1.5">
                <FieldLabel>Rozetler <span className="font-normal text-muted">(opsiyonel, birden fazla seçilebilir)</span></FieldLabel>
                <div className="flex flex-wrap gap-2">
                  {EVENT_BADGES.map((b) => {
                    const active = rozetler.includes(b.key)
                    return (
                      <button
                        key={b.key}
                        type="button"
                        onClick={() => setRozetler((current) => (active ? current.filter((k) => k !== b.key) : [...current, b.key]))}
                        style={active ? { background: b.bg, color: b.renk, borderColor: b.renk } : undefined}
                        className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${active ? '' : 'border-separator text-muted hover:border-[var(--field-border-hover)] hover:text-foreground'}`}
                      >
                        {b.ad}
                      </button>
                    )
                  })}
                </div>
              </div>
            </FormSection>

            <FormSection title="Tarih & Saat" icon={CalendarClock}>
              <label className="flex w-fit items-center gap-2 rounded-lg bg-default/60 px-3 py-2 text-sm">
                <input type="checkbox" checked={cokGunlu} onChange={(event) => { setCokGunlu(event.target.checked); if (event.target.checked && (!bitisTarihi || bitisTarihi < tarih)) setBitisTarihi(tarih) }} className="accent-[var(--accent)]" />
                Çok günlü etkinlik (birden fazla gün sürer)
              </label>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <TextInputField label="Tarih" type="date" value={tarih} onChange={setTarih} isRequired />
                {cokGunlu && <TextInputField label="Bitiş Tarihi" type="date" value={bitisTarihi} onChange={setBitisTarihi} />}
                {!cokGunlu && <TimeField label="Başlangıç Saati" value={saat} onChange={setSaat} />}
                {!cokGunlu && <TimeField label="Bitiş Saati" value={bitisSaat} onChange={setBitisSaat} />}
              </div>
              <TextInputField label="Yer / Mekân" value={yer} onChange={setYer} placeholder="Örn. Atatürk Kongre ve Kültür Merkezi" />
            </FormSection>

            <FormSection title="Birim & Sorumlu" icon={Building2}>
              <div className="flex flex-col gap-1.5">
                <FieldLabel>Düzenleyen Birim</FieldLabel>
                <label className="flex w-fit items-center gap-1.5 text-xs text-muted">
                  <input type="checkbox" checked={birimIlMode} onChange={(event) => { setBirimIlMode(event.target.checked); setBirim('') }} className="accent-[var(--accent)]" />
                  İl protokolü kurumlarından seç
                </label>
                <GroupedUnitSelect ilMode={birimIlMode} value={birim} onChange={setBirim} otherActive={birim === DIGER} />
                {birim === DIGER && (
                  <input
                    value={birimDiger}
                    onChange={(event) => setBirimDiger(event.target.value)}
                    placeholder="Birim/kurum adını yazın"
                    className="h-10 rounded-[var(--field-radius)] border border-[var(--field-border)] bg-[var(--field-background)] px-3 text-sm outline-none placeholder:text-[var(--field-placeholder)] hover:border-[var(--field-border-hover)]"
                  />
                )}
              </div>
              <TextInputField label="Planlayan / Sorumlu" value={planlayan} onChange={setPlanlayan} placeholder="Etkinliği planlayan kişi/birim" />
            </FormSection>

            <FormSection title="Basın" icon={Newspaper} description="Admin tarafından işaretlenmiş kişiler arasından" className="lg:col-span-2">
              <PressRolePicker gorevli={gorevli} haberYazanlari={haberYazanlari} onToggle={togglePressRole} />
            </FormSection>

            <FormSection title="Katılımcılar" icon={Users} description="Protokol kartlarından seçilir, haber metni bunlardan üretilir" className="lg:col-span-2">
              <AttendeePicker attendees={attendees} onChange={setAttendees} includeIl={includeIl} onIncludeIlChange={setIncludeIl} />
            </FormSection>

            <FormSection title="Haber Kaynağı & Not" icon={StickyNote} className="lg:col-span-2">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-[240px_1fr]">
                <SelectField label="Haber Kaynağı" value={haberKaynagi} onChange={setHaberKaynagi} options={[{ value: '', label: '(Belirtilmedi)' }, ...HABER_KAYNAKLARI.map((k) => ({ value: k, label: k }))]} />
                <TextAreaField label="Not" value={not} onChange={setNot} rows={2} />
              </div>
            </FormSection>
          </fieldset>

          {showNewsPanel && (
            <NewsPanel attendees={attendees} defaultLocation={yer} defaultTitle={ad} onClose={() => setShowNewsPanel(false)} />
          )}
        </ModalScrollBody>
        <Modal.Footer className="flex-nowrap justify-end gap-2 overflow-x-auto">
          {id && writer.canWrite && (
            <>
              <Button
                type="button"
                isIconOnly
                size="sm"
                variant="ghost"
                aria-label="Etkinliği sil"
                className="shrink-0 text-danger sm:hidden"
                onPress={() => setIsConfirmingDelete(true)}
              >
                <Trash2 size={16} />
              </Button>
              <Button type="button" variant="ghost" className="hidden shrink-0 text-danger sm:inline-flex" onPress={() => setIsConfirmingDelete(true)}>Sil</Button>
            </>
          )}
          <Button type="button" variant="tertiary" className="shrink-0" slot="close">Vazgeç</Button>
          {writer.canWrite && <Button type="button" variant="secondary" className="shrink-0 whitespace-nowrap" onPress={applyProtocolOrder}>Protokol Sırası Al</Button>}
          {writer.canWrite && <Button type="submit" variant="primary" className="shrink-0" isPending={isSaving}>{id ? 'Kaydet' : 'Oluştur'}</Button>}
        </Modal.Footer>
      </form>

      <FormModal isOpen={isConfirmingDelete} onOpenChange={setIsConfirmingDelete} title="Etkinliği sil?" submitLabel="Sil" isDanger onSubmit={() => { void remove() }}>
        <p className="text-sm text-muted">"{ev?.ad}" kalıcı olarak silinecek. Bu işlem geri alınamaz.</p>
      </FormModal>
    </>
  )
}

export function EventModal({ isOpen, ...props }: EventModalProps) {
  return (
    <ModalShell isOpen={isOpen} onOpenChange={props.onOpenChange} size="xl">
      {isOpen && <EventForm key={props.entry?.[0] ?? 'new'} {...props} />}
    </ModalShell>
  )
}
