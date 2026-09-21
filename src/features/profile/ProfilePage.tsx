import { Avatar, Button, Card, toast } from '@heroui/react'
import { ref, update } from 'firebase/database'
import { Trash2, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../auth/useAuth'
import { TextInputField } from '../../components/formControls'
import { useDbValue } from '../../hooks/useDbValue'
import { db } from '../../lib/firebase'
import { resizeImageToSquare } from '../../lib/image'
import { ROLE_LABEL, fullName, initials, isSafeAvatarUrl } from '../../lib/roles'
import { AchievementsCard } from './AchievementsCard'
import { useAccountStats } from './useAccountStats'
import { ACHIEVEMENTS } from './achievements'

const AVATAR_SIZE_PX = 160
const MAX_AVATAR_BYTES = 2 * 1024 * 1024

function syncStaffProfile(uid: string, patch: Record<string, unknown>) {
  update(ref(db, `staffProfiles/${uid}`), patch).catch((err) => console.error('Personel profili eşitlenemedi (hesap kaydedildi):', err))
}

function formatMembershipDate(ts?: number): string {
  if (!ts) return '—'
  const date = new Date(ts)
  if (Number.isNaN(date.getTime())) return '—'
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(date.getDate())}.${p(date.getMonth() + 1)}.${date.getFullYear()}`
}

interface StatTileProps {
  label: string
  value: number | string
}
function StatTile({ label, value }: StatTileProps) {
  return (
    <div className="flex flex-col items-center gap-0.5 rounded-2xl border border-separator bg-surface-secondary/40 py-4 text-center">
      <span className="text-xl font-semibold tabular-nums">{value}</span>
      <span className="text-[11px] uppercase tracking-wide text-muted">{label}</span>
    </div>
  )
}

export function ProfilePage() {
  const { state } = useAuth()
  const fileRef = useRef<HTMLInputElement>(null)
  const grantAttempted = useRef(false)

  const savedFirst = state.status === 'ready' ? state.profile.firstName ?? '' : ''
  const savedLast = state.status === 'ready' ? state.profile.lastName ?? '' : ''
  const [firstName, setFirstName] = useState(savedFirst)
  const [lastName, setLastName] = useState(savedLast)
  const [isSaving, setIsSaving] = useState(false)
  const [isUploading, setIsUploading] = useState(false)

  const displayName = state.status === 'ready' ? fullName(state.profile) : ''
  const stats = useAccountStats(displayName)
  const createdAt = state.status === 'ready' ? (state.profile as { createdAt?: number }).createdAt : undefined

  const earnedSnapshot = useDbValue<Record<string, number | null>>(state.status === 'ready' ? `users/${state.user.uid}/basarimlar` : '__no_user__', { shadow: false })
  const earned = earnedSnapshot.data ?? {}

  // Yeni bir başarım koşulu sağlandığında (rol/haber/etkinlik sayısı) sessizce users/{uid}/basarimlar'a yazılır;
  // zaten kazanılmış olanlara dokunulmaz. Sayfa her yeniden açıldığında bir kez denenir.
  useEffect(() => {
    if (state.status !== 'ready' || stats.isLoading || earnedSnapshot.isLoading || grantAttempted.current) return
    grantAttempted.current = true
    const ctx = { role: state.role, haberSayisi: stats.haber, etkinlikSayisi: stats.gorevli }
    const updates: Record<string, unknown> = {}
    ACHIEVEMENTS.forEach((achievement) => {
      if (earned[achievement.id]) return
      try {
        if (achievement.kosul(ctx)) updates[`users/${state.user.uid}/basarimlar/${achievement.id}`] = Date.now()
      } catch (err) {
        console.error(`Başarım koşulu değerlendirilemedi: ${achievement.id}`, err)
      }
    })
    if (Object.keys(updates).length) update(ref(db), updates).catch((err) => console.error('Başarımlar kaydedilemedi:', err))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status, stats.isLoading, earnedSnapshot.isLoading])

  if (state.status !== 'ready') return null
  const { user, profile, role } = state
  const avatarUrl = isSafeAvatarUrl(profile.avatarUrl) ? profile.avatarUrl : undefined
  const isDirty = firstName.trim() !== savedFirst || lastName.trim() !== savedLast

  const save = async () => {
    if (!isDirty || isSaving) return
    setIsSaving(true)
    try {
      await update(ref(db, `users/${user.uid}`), { firstName: firstName.trim(), lastName: lastName.trim() })
      syncStaffProfile(user.uid, { displayName: `${firstName.trim()} ${lastName.trim()}`.trim() })
      toast.success('Değişiklikler kaydedildi.')
    } catch (err) {
      console.error('Değişiklikler kaydedilemedi:', err)
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
      syncStaffProfile(user.uid, { displayName: fullName(profile) || displayName, avatarUrl: dataUrl })
      toast.success('Avatar güncellendi.')
    } catch (err) {
      console.error('Avatar yüklenemedi:', err)
      toast.danger('Avatar yüklenemedi.')
    } finally {
      setIsUploading(false)
    }
  }

  const removeAvatar = async () => {
    try {
      await update(ref(db, `users/${user.uid}`), { avatarUrl: null })
      syncStaffProfile(user.uid, { avatarUrl: null })
      toast.success('Avatar kaldırıldı.')
    } catch (err) {
      console.error('Avatar kaldırılamadı:', err)
      toast.danger('Avatar kaldırılamadı.')
    }
  }

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-muted">Hesap</div>
          <h1 className="mt-1 text-2xl font-semibold">Profiliniz</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="tertiary" isDisabled={!isDirty} onPress={() => { setFirstName(savedFirst); setLastName(savedLast) }}>Vazgeç</Button>
          <Button variant="primary" isDisabled={!isDirty} isPending={isSaving} onPress={save}>Değişiklikleri kaydet</Button>
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-[minmax(0,280px)_1fr]">
        <Card>
          <Card.Content className="flex flex-col items-center gap-3 text-center">
            <Avatar size="lg" color="accent" className="size-24">
              {avatarUrl && <Avatar.Image src={avatarUrl} alt="" draggable={false} />}
              <Avatar.Fallback className="text-2xl">{initials(displayName || user.email || '?')}</Avatar.Fallback>
            </Avatar>
            <div>
              <div className="text-base font-semibold">{displayName || 'Kullanıcı'}</div>
              <div className="text-xs text-muted">{ROLE_LABEL[role]}</div>
            </div>
            <div className="flex flex-wrap justify-center gap-2 pt-1">
              <Button size="sm" variant="secondary" isPending={isUploading} onPress={() => fileRef.current?.click()}>
                <Upload size={14} />
                Avatarı değiştir
              </Button>
              {avatarUrl && (
                <Button size="sm" variant="ghost" onPress={removeAvatar}>
                  <Trash2 size={14} />
                  Kaldır
                </Button>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(event) => uploadAvatar(event.target.files?.[0])} />
          </Card.Content>
        </Card>

        <Card>
          <Card.Header>
            <Card.Title>Kişisel bilgiler</Card.Title>
            <Card.Description>Ad, soyad ve e-posta bilgilerinizi görüntüleyin ve güncelleyin.</Card.Description>
          </Card.Header>
          <Card.Content className="grid gap-4 sm:grid-cols-2">
            <TextInputField label="Ad" value={firstName} onChange={setFirstName} />
            <TextInputField label="Soyad" value={lastName} onChange={setLastName} />
            <div className="flex flex-col gap-1 sm:col-span-2">
              <TextInputField label="E-posta" value={user.email ?? profile.email ?? ''} onChange={() => undefined} isDisabled />
              <span className="text-xs text-muted">E-posta adresinizi değiştirmek için yöneticinizle iletişime geçin.</span>
            </div>
            <div className="flex flex-col gap-1 sm:col-span-2">
              <TextInputField label="Rol" value={ROLE_LABEL[role]} onChange={() => undefined} isDisabled />
              <span className="text-xs text-muted">Rolünüzü yalnızca bir yönetici Kullanıcı yönetimi sayfasından değiştirebilir.</span>
            </div>
          </Card.Content>
        </Card>
      </div>

      <Card>
        <Card.Header>
          <Card.Title>Hesap istatistikleri</Card.Title>
        </Card.Header>
        <Card.Content className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Oluşturulan Etkinlik" value={stats.isLoading ? '—' : stats.etkinlik} />
          <StatTile label="Basın Görevlisi" value={stats.isLoading ? '—' : stats.gorevli} />
          <StatTile label="Haber Yazdığı" value={stats.isLoading ? '—' : stats.haber} />
          <StatTile label="Üyelik" value={formatMembershipDate(createdAt)} />
        </Card.Content>
      </Card>

      <AchievementsCard earned={earned as Record<string, number>} />
    </div>
  )
}
