import { Button, Card, Checkbox, Input, Modal, Tabs, TextField, toast } from '@heroui/react'
import { push, ref, remove, serverTimestamp, update } from 'firebase/database'
import { Mail, Pencil, Phone, Plus, Star, Upload, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useMemo, useState } from 'react'
import { useAuth } from '../../auth/useAuth'
import { FormModal } from '../../components/FormModal'
import { ModalScrollBody, ModalShell, ModalTitle } from '../../components/ModalShell'
import { TextAreaField } from '../../components/formControls'
import { useDbValue } from '../../hooks/useDbValue'
import { EASE_OUT } from '../../lib/ease'
import { dbPathFor, useDbMode } from '../../lib/dbMode'
import { db } from '../../lib/firebase'
import { isApprovedRole } from '../../lib/roles'
import { ContactModal } from './ContactModal'
import { parsePastedContacts } from './parseContacts'
import type { Contact, ContactRecord, DirectoryKind } from './pressTypes'
import { DIRECTORY_LABELS, DIRECTORY_PATHS, sortContacts, telHref } from './pressTypes'

export function PressDirectoryPage() {
  const { state } = useAuth()
  const { isTestMode, isReadOnly } = useDbMode()
  const [kind, setKind] = useState<DirectoryKind>('email')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [editing, setEditing] = useState<{ isOpen: boolean; contact: Contact | null }>({ isOpen: false, contact: null })
  const [pendingDelete, setPendingDelete] = useState<Contact | null>(null)
  const [pendingCall, setPendingCall] = useState<Contact | null>(null)
  const [isImportOpen, setIsImportOpen] = useState(false)
  const [importText, setImportText] = useState('')

  const emailDir = useDbValue<Record<string, ContactRecord | null>>(DIRECTORY_PATHS.email)
  const phoneDir = useDbValue<Record<string, ContactRecord | null>>(DIRECTORY_PATHS.phone)
  const source = kind === 'email' ? emailDir : phoneDir
  const labels = DIRECTORY_LABELS[kind]
  const basePath = dbPathFor(DIRECTORY_PATHS[kind], isTestMode)

  const canWrite = state.status === 'ready' && isApprovedRole(state.role) && !isReadOnly
  const contacts = useMemo(
    () => Object.entries(source.data ?? {}).flatMap(([id, record]) => (record ? [{ ...record, id }] : [])),
    [source.data],
  )
  const visible = useMemo(() => sortContacts(contacts, query, kind), [contacts, query, kind])
  const selectableIds = useMemo(() => visible.filter((contact) => contact.eposta).map((contact) => contact.id), [visible])
  const selectedEmails = useMemo(
    () => contacts.filter((contact) => selected.has(contact.id) && contact.eposta).map((contact) => contact.eposta as string),
    [contacts, selected],
  )

  const requireWritable = () => {
    if (canWrite) return true
    toast.danger(isReadOnly ? 'Salt-okunur kilit açık, düzenleme yapılamaz.' : 'Bu işlem için düzenleme yetkisi gerekiyor.')
    return false
  }

  const switchKind = (next: DirectoryKind) => {
    setKind(next)
    setQuery('')
    setSelected(new Set())
  }

  const toggleSelect = (id: string) =>
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const toggleStar = async (contact: Contact) => {
    if (!requireWritable()) return
    try {
      await update(ref(db, `${basePath}/${contact.id}`), { yildizli: !contact.yildizli, guncellemeTs: serverTimestamp() })
    } catch (err) {
      console.error('Yıldız güncellenemedi:', err)
      toast.danger('Yıldız güncellenemedi.')
    }
  }

  const deleteContact = async () => {
    const contact = pendingDelete
    if (!contact || !requireWritable()) return
    try {
      await remove(ref(db, `${basePath}/${contact.id}`))
      setSelected((current) => {
        const next = new Set(current)
        next.delete(contact.id)
        return next
      })
      toast.warning('Kişi silindi.')
    } catch (err) {
      console.error('Kişi silinemedi:', err)
      toast.danger('Kişi silinemedi.')
    }
  }

  /** Alıcılar birbirini görmesin diye e-postalar BCC'ye konur; varsayılan e-posta programı açılır. */
  const sendHidden = () => {
    if (!selectedEmails.length) return toast.danger('Seçilen kişilerin e-postası yok.')
    window.location.href = `mailto:?bcc=${encodeURIComponent(selectedEmails.join(','))}`
  }

  const parsedImport = useMemo(() => parsePastedContacts(importText), [importText])

  const runImport = async () => {
    if (!requireWritable()) return
    if (!parsedImport.length) {
      toast.danger('Ayrıştırılabilir kişi bulunamadı.')
      return
    }
    const existingEmails = new Set(contacts.map((contact) => (contact.eposta ?? '').toLowerCase()).filter(Boolean))
    const fresh = parsedImport.filter((contact) => !existingEmails.has(contact.eposta))
    if (!fresh.length) {
      toast.danger('Yapıştırılan kişilerin hepsi zaten rehberde.')
      return
    }
    try {
      const updates = Object.fromEntries(
        fresh.map((contact) => [
          `${basePath}/${push(ref(db, basePath)).key}`,
          { ad: contact.ad, eposta: contact.eposta, yildizli: false, guncellemeTs: serverTimestamp() },
        ]),
      )
      await update(ref(db), updates)
      const skipped = parsedImport.length - fresh.length
      toast.success(`${fresh.length} kişi eklendi${skipped ? ` (${skipped} zaten vardı, atlandı)` : ''}.`)
      setIsImportOpen(false)
      setImportText('')
    } catch (err) {
      console.error('İçe aktarılamadı:', err)
      toast.danger('İçe aktarılamadı.')
    }
  }

  const openEditor = (contact: Contact | null) => {
    if (!requireWritable()) return
    setEditing({ isOpen: true, contact })
  }

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-5 pb-24">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wider text-muted">İletişim</div>
        <h1 className="mt-1 text-2xl font-semibold">Basın Rehberi</h1>
      </div>

      <Tabs selectedKey={kind} onSelectionChange={(key) => switchKind(key as DirectoryKind)}>
        <Tabs.ListContainer>
          <Tabs.List aria-label="Rehber görünümü">
            <Tabs.Tab id="email">E-posta Listesi<Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="phone">Telefon Rehberi<Tabs.Indicator /></Tabs.Tab>
          </Tabs.List>
        </Tabs.ListContainer>
      </Tabs>

      <Card>
        <Card.Header className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <Card.Title>{labels.title}</Card.Title>
            <Card.Description>{source.isLoading ? 'Yükleniyor…' : `${visible.length} kişi`}</Card.Description>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <TextField value={query} onChange={setQuery} aria-label="Rehberde ara" className="w-full sm:w-64">
              <Input placeholder={labels.searchPlaceholder} autoComplete="off" />
            </TextField>
            {kind === 'email' && canWrite && (
              <Button variant="secondary" onPress={() => setIsImportOpen(true)}>
                <Upload size={16} />
                İçe aktar
              </Button>
            )}
            {canWrite && (
              <Button variant="primary" onPress={() => openEditor(null)}>
                <Plus size={16} />
                Yeni kişi
              </Button>
            )}
          </div>
        </Card.Header>

        <Card.Content className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-3 border-b border-separator pb-3 text-xs text-muted">
            {kind === 'email' && (
              <Checkbox
                isSelected={selectableIds.length > 0 && selectableIds.every((id) => selected.has(id))}
                onChange={(isSelected) => setSelected(isSelected ? new Set(selectableIds) : new Set())}
                aria-label="Tümünü seç"
              >
                <Checkbox.Content className="flex items-center gap-2">
                  <Checkbox.Control className="border border-border"><Checkbox.Indicator /></Checkbox.Control>
                  Tümünü seç
                </Checkbox.Content>
              </Checkbox>
            )}
            <span className="flex-1">{labels.hint}</span>
          </div>

          {source.isLoading && <p className="py-6 text-center text-sm text-muted">Yükleniyor…</p>}
          {source.error && <p className="py-6 text-center text-sm text-danger">Rehber yüklenemedi.</p>}
          {!source.isLoading && !source.error && visible.length === 0 && <p className="py-6 text-center text-sm text-muted">Kayıtlı kişi yok.</p>}

          {visible.map((contact) => (
            <div key={contact.id} className="group flex items-center gap-3 border-b border-separator py-2.5 last:border-b-0">
              {kind === 'email' && (
                <Checkbox
                  isSelected={selected.has(contact.id)}
                  isDisabled={!contact.eposta}
                  onChange={() => toggleSelect(contact.id)}
                  aria-label={`${contact.ad ?? 'Kişi'} seç`}
                >
                  <Checkbox.Content>
                    <Checkbox.Control className="border border-border"><Checkbox.Indicator /></Checkbox.Control>
                  </Checkbox.Content>
                </Checkbox>
              )}

              <button
                type="button"
                aria-pressed={!!contact.yildizli}
                aria-label={contact.yildizli ? 'Yıldızı kaldır' : 'Sık kullanılanlara ekle'}
                onClick={() => toggleStar(contact)}
                className={`rounded-lg p-1 transition-colors ${contact.yildizli ? 'text-warning' : 'text-muted hover:text-foreground'}`}
              >
                <Star size={16} fill={contact.yildizli ? 'currentColor' : 'none'} />
              </button>

              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{contact.ad || '(isim yok)'}</div>
                <div className="truncate text-xs text-muted">
                  {[contact.kurum, kind === 'email' ? contact.eposta : ''].filter(Boolean).join(' · ')}
                </div>
              </div>

              {contact.telefon && (
                <Button size="sm" variant="ghost" onPress={() => setPendingCall(contact)}>
                  <Phone size={14} />
                  <span className="hidden sm:inline">{contact.telefon}</span>
                </Button>
              )}

              {canWrite && (
                <div className="flex gap-1 opacity-60 group-hover:opacity-100">
                  <Button isIconOnly size="sm" variant="ghost" aria-label="Düzenle" onPress={() => openEditor(contact)}>
                    <Pencil size={14} />
                  </Button>
                  <Button isIconOnly size="sm" variant="ghost" aria-label="Sil" className="text-danger" onPress={() => setPendingDelete(contact)}>
                    <X size={14} />
                  </Button>
                </div>
              )}
            </div>
          ))}
        </Card.Content>
      </Card>

      <AnimatePresence>
        {kind === 'email' && selected.size > 0 && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ duration: 0.35, ease: EASE_OUT }}
            role="toolbar"
            aria-label="Seçili kişiler"
            className="fixed inset-x-3 bottom-4 z-40 mx-auto flex max-w-xl items-center gap-2 rounded-full bg-overlay p-2 pl-5 text-overlay-foreground shadow-[var(--overlay-shadow)] lg:left-64"
          >
            <span className="flex-1 truncate text-sm"><b className="tabular-nums">{selected.size}</b> kişi seçildi</span>
            <Button size="sm" variant="ghost" onPress={() => setSelected(new Set())}>Temizle</Button>
            <Button size="sm" variant="primary" onPress={sendHidden}>
              <Mail size={14} />
              Gizli gönder
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      <ContactModal
        isOpen={editing.isOpen}
        onOpenChange={(isOpen) => setEditing((current) => ({ ...current, isOpen }))}
        kind={kind}
        basePath={basePath}
        contact={editing.contact}
      />

      <FormModal
        isOpen={pendingDelete !== null}
        onOpenChange={(isOpen) => { if (!isOpen) setPendingDelete(null) }}
        title="Kişiyi sil?"
        submitLabel="Sil"
        isDanger
        onSubmit={() => { void deleteContact() }}
      >
        <p className="text-sm text-muted">"{pendingDelete?.ad}" rehberden kalıcı olarak silinecek.</p>
      </FormModal>

      <FormModal
        isOpen={pendingCall !== null}
        onOpenChange={(isOpen) => { if (!isOpen) setPendingCall(null) }}
        title="Aramak istiyor musunuz?"
        submitLabel="Ara"
        onSubmit={() => { const href = telHref(pendingCall?.telefon); if (href) window.location.href = href }}
      >
        <p className="text-sm text-muted">{pendingCall?.ad} ({pendingCall?.telefon}) aranacak.</p>
      </FormModal>

      <ModalShell isOpen={isImportOpen} onOpenChange={setIsImportOpen} size="md">
        <ModalTitle
          title="Listeyi içe aktar"
          description="Outlook'ta kullandığınız 'Ad' <eposta>; biçimindeki listeyi doğrudan yapıştırın."
        />
        <ModalScrollBody>
          <TextAreaField
            label="Yapıştırılan liste"
            value={importText}
            onChange={setImportText}
            rows={10}
            placeholder={"'19 MAYIS GAZETESİ' <ornek@gmail.com>;\n'BAFRA GAZETESİ' <ornek2@gmail.com>;"}
          />
          <p className="text-xs text-muted">
            {parsedImport.length
              ? `${parsedImport.length} kişi ayrıştırıldı (tekrar edenler otomatik tekilleştirildi). Rehberde zaten olan e-postalar atlanır.`
              : 'Aynı e-posta birden fazla kez geçiyorsa yalnızca biri eklenir, zaten rehberde olanlar atlanır.'}
          </p>
        </ModalScrollBody>
        <Modal.Footer>
          <Button variant="tertiary" slot="close">Vazgeç</Button>
          <Button variant="primary" isDisabled={!parsedImport.length} onPress={runImport}>İçe aktar</Button>
        </Modal.Footer>
      </ModalShell>
    </div>
  )
}
