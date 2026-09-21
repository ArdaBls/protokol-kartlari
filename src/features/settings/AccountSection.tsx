import { Avatar, Button, toast } from '@heroui/react'
import { ref, update } from 'firebase/database'
import { Trash2, Upload } from 'lucide-react'
import type { FormEvent } from 'react'
import { useRef, useState } from 'react'
import { useAuth } from '../../auth/useAuth'
import { TextInputField } from '../../components/formControls'
import { db } from '../../lib/firebase'
import { resizeImageToSquare } from '../../lib/image'
import { ROLE_LABEL, fullName, initials, isSafeAvatarUrl } from '../../lib/roles'
import { SettingsSection } from './SettingsSection'

const AVATAR_SIZE_PX = 160
const MAX_AVATAR_BYTES = 2 * 1024 * 1024

/** İlk kelime ad, kalan kelimeler soyad (kullanıcı yönetimindeki birleştirmenin tersi). */
function splitFullName(full: string) {
  const parts = full.trim().split(/\s+/).filter(Boolean)
  return { firstName: parts[0] ?? '', lastName: parts.slice(1).join(' ') }
}

/** Kişiler dizini ve avatarlar staffProfiles/{uid} üzerinden okunur; hesaptaki değişiklik oraya da eşitlenir. */
function syncStaffProfile(uid: string, patch: Record<string, unknown>) {
  update(ref(db, `staffProfiles/${uid}`), patch).catch((err) => console.error('Personel profili eşitlenemedi (hesap kaydedildi):', err))
}

export function AccountSection() {
  const { state } = useAuth()
  const fileRef = useRef<HTMLInputElement>(null)
  const savedName = state.status === 'ready' ? fullName(state.profile) : ''
  const [name, setName] = useState(savedName)
  const [isSaving, setIsSaving] = useState(false)
  const [isUploading, setIsUploading] = useState(false)

  if (state.status !== 'ready') return null
  const { user, profile, role } = state
  const avatarUrl = isSafeAvatarUrl(profile.avatarUrl) ? profile.avatarUrl : undefined
  const isDirty = name.trim() !== savedName

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!isDirty || isSaving) return
    const trimmed = name.trim()
    if (!trimmed) return toast.danger('Ad soyad boş olamaz.')
    setIsSaving(true)
    try {
      await update(ref(db, `users/${user.uid}`), splitFullName(trimmed))
      syncStaffProfile(user.uid, { displayName: trimmed })
      toast.success('Değişiklikler kaydedildi.')
    } catch (err) {
      console.error('Hesap değişiklikleri kaydedilemedi:', err)
      toast.danger('Değişiklikler kaydedilemedi.')
    } finally {
      setIsSaving(false)
    }
  }

  const uploadAvatar = async (file?: File) => {
    if (fileRef.current) fileRef.current.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) return toast.danger('Lütfen bir görsel dosyası seçin.')
    if (file.size > MAX_AVATAR_BYTES) return toast.danger("Görsel 2 MB'tan küçük olmalı.")
    setIsUploading(true)
    try {
      const dataUrl = await resizeImageToSquare(file, AVATAR_SIZE_PX)
      await update(ref(db, `users/${user.uid}`), { avatarUrl: dataUrl })
      syncStaffProfile(user.uid, { displayName: name.trim() || savedName, avatarUrl: dataUrl })
      toast.success('Profil fotoğrafı güncellendi.')
    } catch (err) {
      console.error('Profil fotoğrafı yüklenemedi:', err)
      toast.danger('Profil fotoğrafı yüklenemedi.')
    } finally {
      setIsUploading(false)
    }
  }

  const removeAvatar = async () => {
    try {
      await update(ref(db, `users/${user.uid}`), { avatarUrl: null })
      syncStaffProfile(user.uid, { avatarUrl: null })
      toast.success('Profil fotoğrafı kaldırıldı.')
    } catch (err) {
      console.error('Profil fotoğrafı kaldırılamadı:', err)
      toast.danger('Profil fotoğrafı kaldırılamadı.')
    }
  }

  return (
    <SettingsSection id="hesap" title="Hesap" description="Kişisel bilgilerinizi ve profil detaylarınızı güncelleyin.">
      <form onSubmit={save} className="flex flex-col gap-5">
        <div className="flex items-center gap-4">
          <Avatar size="lg" color="accent" className="size-20">
            {avatarUrl && <Avatar.Image src={avatarUrl} alt="Profil fotoğrafı" draggable={false} />}
            <Avatar.Fallback className="text-xl">{initials(savedName || user.email || '?')}</Avatar.Fallback>
          </Avatar>
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" isPending={isUploading} onPress={() => fileRef.current?.click()}>
                <Upload size={14} />
                Yeni yükle
              </Button>
              {avatarUrl && (
                <Button size="sm" variant="ghost" onPress={removeAvatar}>
                  <Trash2 size={14} />
                  Kaldır
                </Button>
              )}
            </div>
            <span className="text-xs text-muted">JPG, PNG veya GIF · en fazla 2 MB</span>
          </div>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(event) => uploadAvatar(event.target.files?.[0])} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <TextInputField label="Ad soyad" value={name} onChange={setName} isRequired className="sm:col-span-2" />
          <div className="flex flex-col gap-1">
            <TextInputField label="E-posta adresi" value={user.email ?? profile.email ?? ''} onChange={() => undefined} isDisabled />
            <span className="text-xs text-muted">E-posta adresinizi değiştirmek için yöneticinizle iletişime geçin.</span>
          </div>
          <div className="flex flex-col gap-1">
            <TextInputField label="Rol" value={ROLE_LABEL[role]} onChange={() => undefined} isDisabled />
            <span className="text-xs text-muted">Rolünüzü yalnızca bir yönetici değiştirebilir.</span>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-separator pt-4">
          <Button variant="tertiary" isDisabled={!isDirty} onPress={() => setName(savedName)}>Vazgeç</Button>
          <Button type="submit" variant="primary" isDisabled={!isDirty} isPending={isSaving}>Değişiklikleri kaydet</Button>
        </div>
      </form>
    </SettingsSection>
  )
}
