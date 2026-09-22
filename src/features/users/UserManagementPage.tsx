import { Avatar, Button, Card, Input, TextField, toast } from '@heroui/react'
import { ref, serverTimestamp, update } from 'firebase/database'
import { Download, Search, ShieldCheck, Trash2, UserCheck, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import { FormModal } from '../../components/FormModal'
import { SelectField } from '../../components/formControls'
import { SwitchButton } from '../../components/SwitchButton'
import { downloadJson } from '../../lib/browserFiles'
import { dbPathFor, useDbMode } from '../../lib/dbMode'
import { db } from '../../lib/firebase'
import { collectLogDeleteUpdates } from '../../lib/logCleanup'
import type { Role, UserProfile } from '../../lib/roles'
import { ROLE_LABEL, initials, isSafeAvatarUrl } from '../../lib/roles'
import { useDbValue } from '../../hooks/useDbValue'

interface UserRecord extends UserProfile {
  createdAt?: number
}

interface StaffProfile {
  displayName?: string
  avatarUrl?: string
}

interface PresenceRecord {
  cevrimici?: boolean
}

// 'owner' bu ekrandan kimseye atanamaz; yalnızca pending/editor/admin arası geçiş yapılır.
const ASSIGNABLE_ROLES: Role[] = ['pending', 'editor', 'admin']
const ROLE_OPTIONS = ASSIGNABLE_ROLES.map((role) => ({ value: role, label: ROLE_LABEL[role] }))
const FILTER_OPTIONS = [{ value: '', label: 'Tüm roller' }, ...(['pending', 'editor', 'admin', 'owner'] as Role[]).map((role) => ({ value: role, label: ROLE_LABEL[role] }))]

const fullNameOf = (user: UserRecord) => `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || '(isim yok)'

function StatCard({ icon: Icon, iconClass, label, value, sub }: { icon: typeof Users; iconClass: string; label: string; value: number | string; sub: string }) {
  return (
    <Card>
      <Card.Content className="flex flex-row items-center gap-4">
        <span className={`flex size-11 shrink-0 items-center justify-center rounded-2xl ${iconClass}`}>
          <Icon size={22} strokeWidth={1.75} />
        </span>
        <div className="min-w-0">
          <div className="text-sm text-muted">{label}</div>
          <div className="text-2xl font-semibold tabular-nums">{value}</div>
          <div className="truncate text-xs text-muted">{sub}</div>
        </div>
      </Card.Content>
    </Card>
  )
}

export function UserManagementPage() {
  const { state } = useAuth()
  const { isTestMode, isReadOnly } = useDbMode()
  const [searchParams] = useSearchParams()
  const [query, setQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState(() => searchParams.get('filtre') ?? '')
  const [busyUid, setBusyUid] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ uid: string; user: UserRecord } | null>(null)
  const [isDeleteOpen, setIsDeleteOpen] = useState(false)

  const users = useDbValue<Record<string, UserRecord | null>>('users', { shadow: false })
  const pressOfficers = useDbValue<Record<string, string | null>>('basinGorevlileri')
  const staffProfiles = useDbValue<Record<string, StaffProfile | null>>('staffProfiles', { shadow: false })
  const presence = useDbValue<Record<string, PresenceRecord | null>>('presence', { shadow: false })

  const entries = useMemo(
    () => Object.entries(users.data ?? {}).flatMap(([uid, user]) => (user ? [[uid, user] as const] : [])),
    [users.data],
  )
  const stats = useMemo(() => ({
    total: entries.length,
    admins: entries.filter(([, user]) => user.role === 'admin' || user.role === 'owner').length,
    pending: entries.filter(([, user]) => (user.role ?? 'pending') === 'pending').length,
  }), [entries])

  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('tr')
    return entries
      .filter(([, user]) => {
        const matchesQuery = !q || fullNameOf(user).toLocaleLowerCase('tr').includes(q) || (user.email ?? '').toLocaleLowerCase('tr').includes(q)
        return matchesQuery && (!roleFilter || (user.role ?? 'pending') === roleFilter)
      })
      .sort(([, a], [, b]) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
  }, [entries, query, roleFilter])

  if (state.status !== 'ready') return null
  const isAdmin = state.role === 'admin' || state.role === 'owner'
  if (!isAdmin) {
    return (
      <Card className="mx-auto max-w-lg text-center">
        <Card.Header className="items-center">
          <Card.Title>Erişim yok</Card.Title>
          <Card.Description>Kullanıcı yönetimi yalnızca admin ve kurucu rolündeki kullanıcılara açıktır.</Card.Description>
        </Card.Header>
      </Card>
    )
  }
  const currentUid = state.user.uid

  const setRole = async (uid: string, nextRole: string) => {
    const user = users.data?.[uid]
    const oldRole = user?.role ?? 'pending'
    if (uid === currentUid) return toast.danger('Kendi rolünüzü değiştiremezsiniz.')
    if (!ASSIGNABLE_ROLES.includes(nextRole as Role)) return toast.danger('Geçersiz rol.')
    if (oldRole === 'owner') return toast.danger('Kurucu rolü bu ekrandan değiştirilemez.')
    // Son yetkili koruması: tek admin/kurucu kaldıysa rolü düşürülemez (kurucu zaten yukarıda eleniyor).
    if (oldRole === 'admin' && nextRole !== 'admin' && stats.admins <= 1) {
      return toast.danger('Son yönetici kullanıcının rolü düşürülemez. Önce başka bir admin atayın.')
    }
    setBusyUid(uid)
    try {
      await update(ref(db, `users/${uid}`), { role: nextRole })
      toast.success(`${fullNameOf(user ?? {})}: rol ${ROLE_LABEL[oldRole as Role]} → ${ROLE_LABEL[nextRole as Role]}`)
    } catch (err) {
      console.error('Yetki güncellenemedi:', err)
      toast.danger('Yetki güncellenemedi.')
    } finally {
      setBusyUid(null)
    }
  }

  const togglePressOfficer = async (uid: string, isChecked: boolean) => {
    if (isReadOnly) return toast.danger('Salt-okunur kilit açık, basın görevlisi değiştirilemez.')
    const user = users.data?.[uid] ?? {}
    setBusyUid(uid)
    try {
      // users/ hesap verisidir, test modunda gölgelenmez; rehber kaydı ise aktif dala yazılır.
      const updates: Record<string, unknown> = { [dbPathFor(`basinGorevlileri/${uid}`, isTestMode)]: isChecked ? fullNameOf(user) : null }
      if (!isTestMode) updates[`users/${uid}/basinGorevlisi`] = isChecked
      await update(ref(db), updates)
      toast.success(isChecked ? 'Basın görevlisi olarak işaretlendi.' : 'Basın görevlisi işareti kaldırıldı.')
    } catch (err) {
      console.error('İşlem gerçekleştirilemedi:', err)
      toast.danger('İşlem gerçekleştirilemedi.')
    } finally {
      setBusyUid(null)
    }
  }

  const toggleBlocked = async (uid: string, nextBlocked: boolean) => {
    const user = users.data?.[uid]
    if (uid === currentUid) return toast.danger('Kendi erişiminizi buradan kısıtlayamazsınız.')
    if (user?.role === 'owner') return toast.danger('Kurucunun erişimi bu ekrandan kısıtlanamaz.')
    setBusyUid(uid)
    try {
      await update(ref(db, `users/${uid}`), { blocked: nextBlocked })
      toast.success(nextBlocked ? `${fullNameOf(user ?? {})}: erişimi kısıtlandı.` : `${fullNameOf(user ?? {})}: erişimi geri verildi.`)
    } catch (err) {
      console.error('Erişim durumu güncellenemedi:', err)
      toast.danger('Erişim durumu güncellenemedi.')
    } finally {
      setBusyUid(null)
    }
  }

  const deleteUser = async () => {
    if (!deleteTarget || state.status !== 'ready') return
    const { uid, user } = deleteTarget
    const role = user.role ?? 'pending'
    if (uid === currentUid) return toast.danger('Kendi hesabınızı silemezsiniz.')
    if (role === 'owner') return toast.danger('Kurucu hesabı silinemez.')
    if (role === 'admin' && stats.admins <= 1) return toast.danger('Son yönetici hesabı silinemez.')
    setBusyUid(uid)
    try {
      const email = (user.email ?? '').trim().toLocaleLowerCase('tr')
      const name = fullNameOf(user).trim()
      const logDeletes = await collectLogDeleteUpdates(isTestMode, (entry) => {
        const matchesEmail = !!email && entry.email?.trim().toLocaleLowerCase('tr') === email
        const matchesName = !!name && entry.by?.trim() === name
        return matchesEmail || matchesName
      })
      await update(ref(db), {
        [`users/${uid}`]: null,
        [`deletedAccounts/${uid}`]: { deletedAt: serverTimestamp(), deletedByUid: currentUid },
        [`staffProfiles/${uid}`]: null,
        [dbPathFor(`basinGorevlileri/${uid}`, isTestMode)]: null,
        [`presence/${uid}`]: null,
        [dbPathFor(`notifications/${uid}`, isTestMode)]: null,
        ...logDeletes,
      })
      toast.warning(`${fullNameOf(user)} kullanıcısı ve kullanıcı logları silindi. Etkinlik ve protokol kartları korundu.`)
      setDeleteTarget(null)
    } catch (err) {
      console.error('Kullanıcı silinemedi:', err)
      toast.danger('Kullanıcı silinemedi. Firebase kurallarını kontrol edin.')
    } finally {
      setBusyUid(null)
    }
  }

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-muted">Yönetim</div>
          <h1 className="mt-1 text-2xl font-semibold">Kullanıcı yönetimi</h1>
        </div>
        <Button variant="secondary" onPress={() => { downloadJson(users.data ?? {}, 'kullanicilar.json'); toast.success('Kullanıcı listesi indirildi.') }}>
          <Download size={16} />
          Dışa aktar
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard icon={Users} iconClass="bg-accent/15 text-accent" label="Toplam kullanıcı" value={users.isLoading ? '—' : stats.total} sub="Kayıtlı tüm hesaplar" />
        <StatCard icon={ShieldCheck} iconClass="bg-success/15 text-success" label="Yöneticiler" value={users.isLoading ? '—' : stats.admins} sub="Admin ve kurucu" />
        <StatCard icon={UserCheck} iconClass="bg-warning/15 text-warning" label="Onay bekleyenler" value={users.isLoading ? '—' : stats.pending} sub="Kayıt oldu, henüz onaylanmadı" />
      </div>

      <Card>
        <Card.Header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <TextField value={query} onChange={setQuery} aria-label="Kullanıcılarda ara" className="relative w-full sm:w-72">
            <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 z-10 -translate-y-1/2 text-muted" />
            <Input placeholder="İsim veya e-postaya göre ara…" className="pl-10" autoComplete="off" />
          </TextField>
          <SelectField label="" value={roleFilter} onChange={setRoleFilter} options={FILTER_OPTIONS} className="w-full sm:w-44" />
        </Card.Header>
        <Card.Content className="flex flex-col gap-2">
          {users.isLoading && <p className="py-6 text-center text-sm text-muted">Yükleniyor…</p>}
          {users.error && <p className="py-6 text-center text-sm text-danger">Kullanıcılar yüklenemedi. Yetkiniz varsa sayfayı yenileyin.</p>}
          {!users.isLoading && !users.error && visible.length === 0 && <p className="py-6 text-center text-sm text-muted">Eşleşen kullanıcı yok.</p>}

          {visible.map(([uid, user]) => {
            const role = (user.role ?? 'pending') as Role
            const isSelf = uid === currentUid
            const isLocked = isSelf || role === 'owner'
            const name = fullNameOf(user)
            const avatarUrl = staffProfiles.data?.[uid]?.avatarUrl
            const isOnline = !!presence.data?.[uid]?.cevrimici
            const isPressOfficer = !!pressOfficers.data?.[uid]

            return (
              <div key={uid} className="grid grid-cols-1 items-center gap-3 rounded-2xl border border-separator bg-surface-secondary/40 p-3 sm:grid-cols-[1fr_11rem_9rem_6rem_7rem]">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="relative shrink-0">
                    <Avatar size="sm" color="accent" className="size-10">
                      {isSafeAvatarUrl(avatarUrl) && <Avatar.Image src={avatarUrl} alt="" draggable={false} />}
                      <Avatar.Fallback>{initials(name)}</Avatar.Fallback>
                    </Avatar>
                    <span
                      title={isOnline ? 'Çevrimiçi' : 'Çevrimdışı'}
                      className={`absolute -bottom-0.5 -right-0.5 size-3 rounded-full ring-2 ring-surface ${isOnline ? 'bg-success' : 'bg-muted/50'}`}
                    />
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {name}
                      {isSelf && <span className="ml-1 font-normal text-accent">(Siz)</span>}
                    </div>
                    <div className="truncate text-xs text-muted">{user.email}</div>
                  </div>
                </div>

                <div>
                  {isLocked ? (
                    <span className="inline-flex rounded-full bg-default px-3 py-1 text-xs font-medium" title={role === 'owner' ? 'Kurucu rolü bu ekrandan değiştirilemez.' : 'Kendi rolünüzü buradan değiştiremezsiniz.'}>
                      {ROLE_LABEL[role]}
                    </span>
                  ) : (
                    <SelectField label="" value={role} onChange={(next) => setRole(uid, next)} options={ROLE_OPTIONS} />
                  )}
                </div>

                <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
                  <input
                    type="checkbox"
                    checked={isPressOfficer}
                    disabled={busyUid === uid}
                    onChange={(event) => togglePressOfficer(uid, event.target.checked)}
                    className="size-4 accent-[var(--accent)]"
                    aria-label={`${name} — basın görevlisi`}
                  />
                  Basın görevlisi
                </label>

                <div className="flex items-center gap-2 sm:justify-end">
                  <span className="text-xs text-muted sm:hidden">Erişim</span>
                  <SwitchButton
                    isOn={!!user.blocked}
                    isDangerWhenOn
                    isDisabled={isLocked || busyUid === uid}
                    label={`${name} erişimini kısıtla`}
                    title={isLocked ? 'Bu hesabın erişimi bu ekrandan değiştirilemez.' : user.blocked ? 'Erişimi geri ver' : 'Erişimi kısıtla'}
                    onToggle={() => toggleBlocked(uid, !user.blocked)}
                  />
                </div>

                <div className="flex items-center gap-2 sm:justify-end">
                  <span className="text-xs text-muted sm:hidden">Kullanıcı</span>
                  <Button
                    isIconOnly
                    size="sm"
                    variant="danger-soft"
                    aria-label={`${name} kullanıcısını sil`}
                    isDisabled={isSelf || role === 'owner' || (role === 'admin' && stats.admins <= 1) || busyUid === uid}
                    onPress={() => { setDeleteTarget({ uid, user }); setIsDeleteOpen(true) }}
                  >
                    <Trash2 size={16} />
                  </Button>
                </div>
              </div>
            )
          })}
        </Card.Content>
      </Card>

      <FormModal
        isOpen={isDeleteOpen}
        onOpenChange={(isOpen) => { setIsDeleteOpen(isOpen); if (!isOpen) setDeleteTarget(null) }}
        title="Kullanıcıyı sil"
        submitLabel="Evet, sil"
        isDanger
        onSubmit={() => { void deleteUser() }}
      >
        <p className="text-sm text-muted">
          {deleteTarget ? `${fullNameOf(deleteTarget.user)} kullanıcısı ile bu kullanıcıya ait loglar kalıcı olarak silinecek. Etkinlik ve protokol kartları korunacak.` : 'Bu kullanıcı kaydı ve logları kalıcı olarak silinecek.'}
        </p>
      </FormModal>
    </div>
  )
}
