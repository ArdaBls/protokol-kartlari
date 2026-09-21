import { Button, Modal, toast } from '@heroui/react'
import { push, ref, serverTimestamp, set, update } from 'firebase/database'
import { useState } from 'react'
import { ModalScrollBody, ModalShell, ModalTitle } from '../../components/ModalShell'
import { TextInputField } from '../../components/formControls'
import { db } from '../../lib/firebase'
import type { Contact, DirectoryKind } from './pressTypes'
import { DIRECTORY_LABELS } from './pressTypes'

interface ContactModalProps {
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
  kind: DirectoryKind
  /** Test modunda gölgelenmiş tam yol (ör. test/basinRehberi). */
  basePath: string
  contact: Contact | null
}

const MAX_TEXT = 200
const MAX_PHONE = 40

function ContactForm({ onOpenChange, kind, basePath, contact }: Omit<ContactModalProps, 'isOpen'>) {
  const labels = DIRECTORY_LABELS[kind]
  const [draft, setDraft] = useState({
    ad: contact?.ad ?? '',
    kurum: contact?.kurum ?? '',
    telefon: contact?.telefon ?? '',
    eposta: contact?.eposta ?? '',
  })
  const [isSaving, setIsSaving] = useState(false)
  const set2 = <K extends keyof typeof draft>(key: K) => (value: string) => setDraft((current) => ({ ...current, [key]: value }))

  const save = async () => {
    const ad = draft.ad.trim()
    if (!ad) return toast.danger('Ad soyad zorunlu.')
    const patch: Record<string, unknown> = {
      ad,
      kurum: draft.kurum.trim() || null,
      telefon: draft.telefon.trim() || null,
      guncellemeTs: serverTimestamp(),
    }
    if (kind === 'email') patch.eposta = draft.eposta.trim() || null

    setIsSaving(true)
    try {
      if (contact) {
        await update(ref(db, `${basePath}/${contact.id}`), patch)
        toast.success('Kişi güncellendi.')
      } else {
        await set(push(ref(db, basePath)), { yildizli: false, ...patch })
        toast.success('Kişi eklendi.')
      }
      onOpenChange(false)
    } catch (err) {
      console.error('Kişi kaydedilemedi:', err)
      toast.danger('Kişi kaydedilemedi.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <form onSubmit={(event) => { event.preventDefault(); save() }} className="flex min-h-0 flex-1 flex-col">
      <ModalTitle title={contact ? 'Kişiyi düzenle' : 'Yeni kişi'} description={labels.title} />
      <ModalScrollBody>
        <TextInputField label="Ad soyad" value={draft.ad} onChange={set2('ad')} isRequired autoFocus placeholder="Ör. Ayşe Yılmaz" maxLength={MAX_TEXT} />
        <TextInputField label={labels.orgLabel} value={draft.kurum} onChange={set2('kurum')} placeholder="Ör. Samsun Haber Gazetesi" maxLength={MAX_TEXT} />
        <TextInputField label={kind === 'email' ? 'Telefon (opsiyonel)' : 'Telefon'} value={draft.telefon} onChange={set2('telefon')} placeholder="0555 123 45 67" maxLength={MAX_PHONE} />
        {kind === 'email' && (
          <TextInputField label="E-posta (opsiyonel)" type="email" value={draft.eposta} onChange={set2('eposta')} placeholder="ornek@gazete.com" maxLength={MAX_TEXT} />
        )}
      </ModalScrollBody>
      <Modal.Footer>
        <Button variant="tertiary" slot="close">Vazgeç</Button>
        <Button type="submit" variant="primary" isPending={isSaving}>{contact ? 'Kaydet' : 'Ekle'}</Button>
      </Modal.Footer>
    </form>
  )
}

export function ContactModal({ isOpen, ...props }: ContactModalProps) {
  return (
    <ModalShell isOpen={isOpen} onOpenChange={props.onOpenChange} size="sm">
      <ContactForm key={props.contact?.id ?? 'new'} {...props} />
    </ModalShell>
  )
}
