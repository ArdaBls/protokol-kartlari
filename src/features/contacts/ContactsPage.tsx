import { Avatar, Card, Chip } from '@heroui/react'
import { ref, update } from 'firebase/database'
import { CalendarCheck, Newspaper } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import { useAuth } from '../../auth/useAuth'
import { useDbValue } from '../../hooks/useDbValue'
import { db } from '../../lib/firebase'
import type { Role } from '../../lib/roles'
import { ROLE_LABEL, initials, isSafeAvatarUrl } from '../../lib/roles'

interface UserRecord {
  firstName?: string
  lastName?: string
  email?: string
  role?: Role
  avatarUrl?: string
}

interface StaffProfile {
  displayName?: string
  email?: string
  role?: Role
  avatarUrl?: string
}

interface EventRecord {
  gorevli?: string
  haberYazanlari?: string
}

const ROLE_CHIP_COLOR: Record<Role, 'warning' | 'accent' | 'danger'> = {
  pending: 'warning',
  editor: 'accent',
  admin: 'danger',
  owner: 'danger',
}

const fullNameOf = (user: UserRecord) => `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || '(isim yok)'

/** "Ad Soyad, Ad Soyad2" biçimindeki alanı isim listesine ayırır. */
const parseNameList = (value?: string) =>
  String(value ?? '').split(',').map((name) => name.trim()).filter(Boolean)

function countByName(events: EventRecord[], field: keyof EventRecord): Map<string, number> {
  const counts = new Map<string, number>()
  events.forEach((event) => parseNameList(event[field]).forEach((name) => counts.set(name, (counts.get(name) ?? 0) + 1)))
  return counts
}

interface ContactCardData {
  key: string
  name: string
  role: Role
  email: string
  avatarUrl?: string
}

function ContactCard({ contact, eventCount, newsCount }: { contact: ContactCardData; eventCount: number; newsCount: number }) {
  return (
    <Card>
      <Card.Content className="flex flex-col items-center gap-3 text-center">
        <Avatar size="lg" color="accent" className="size-16">
          {isSafeAvatarUrl(contact.avatarUrl) && <Avatar.Image src={contact.avatarUrl} alt="" draggable={false} />}
          <Avatar.Fallback className="text-lg">{initials(contact.name)}</Avatar.Fallback>
        </Avatar>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{contact.name}</div>
          <div className="truncate text-xs text-muted">{contact.email}</div>
        </div>
        <Chip size="sm" color={ROLE_CHIP_COLOR[contact.role]} variant="soft">{ROLE_LABEL[contact.role]}</Chip>
        <div className="grid w-full grid-cols-2 gap-2 border-t border-separator pt-3">
          <div className="flex flex-col items-center gap-1">
            <span className="flex items-center gap-1 text-lg font-semibold tabular-nums">
              <CalendarCheck size={15} className="text-muted" />
              {eventCount}
            </span>
            <span className="text-[11px] text-muted">Etkinlik</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <span className="flex items-center gap-1 text-lg font-semibold tabular-nums">
              <Newspaper size={15} className="text-muted" />
              {newsCount}
            </span>
            <span className="text-[11px] text-muted">Haber</span>
          </div>
        </div>
      </Card.Content>
    </Card>
  )
}

/**
 * staffProfiles/{uid}, users/{uid}'in görünüre çıkarılabilir bir kopyasıdır (editörler users/ okuyamaz).
 * Admin/owner sayfayı her açtığında rol/isim/e-posta güncel değerle eşitlenir; fotoğraf yalnızca
 * hedefte eksikse tamamlanır (kişinin kendi yüklediği fotoğrafın üzerine asla yazılmaz).
 */
function useStaffProfileBackfill(users: Record<string, UserRecord | null> | null, staffProfiles: Record<string, StaffProfile | null> | null) {
  const isRunning = useRef(false)
  useEffect(() => {
    if (!users || !staffProfiles || isRunning.current) return
    const updates: Record<string, unknown> = {}
    Object.entries(users).forEach(([uid, user]) => {
      if (!user || (user.role !== 'editor' && user.role !== 'admin' && user.role !== 'owner')) return
      const existing = staffProfiles[uid] ?? {}
      const name = fullNameOf(user)
      if (existing.displayName !== name) updates[`staffProfiles/${uid}/displayName`] = name
      if (existing.role !== user.role) updates[`staffProfiles/${uid}/role`] = user.role
      if ((existing.email ?? '') !== (user.email ?? '')) updates[`staffProfiles/${uid}/email`] = user.email ?? ''
      if (!isSafeAvatarUrl(existing.avatarUrl) && isSafeAvatarUrl(user.avatarUrl)) updates[`staffProfiles/${uid}/avatarUrl`] = user.avatarUrl
    })
    if (!Object.keys(updates).length) return
    isRunning.current = true
    update(ref(db), updates)
      .catch((err) => console.error('staffProfiles geri doldurulamadı:', err))
      .finally(() => { isRunning.current = false })
  }, [users, staffProfiles])
}

export function ContactsPage() {
  const { state } = useAuth()
  const isAdmin = state.status === 'ready' && (state.role === 'admin' || state.role === 'owner')

  const users = useDbValue<Record<string, UserRecord | null>>('users', { shadow: false })
  const staffProfiles = useDbValue<Record<string, StaffProfile | null>>('staffProfiles', { shadow: false })
  const events = useDbValue<Record<string, EventRecord | null>>('etkinlikler')

  useStaffProfileBackfill(isAdmin ? users.data : null, staffProfiles.data)

  const eventList = useMemo(() => Object.values(events.data ?? {}).flatMap((event) => (event ? [event] : [])), [events.data])
  const eventCounts = useMemo(() => countByName(eventList, 'gorevli'), [eventList])
  const newsCounts = useMemo(() => countByName(eventList, 'haberYazanlari'), [eventList])

  const contacts = useMemo<ContactCardData[]>(() => {
    if (isAdmin) {
      return Object.entries(users.data ?? {})
        .flatMap(([uid, user]) => (user ? [{ key: uid, name: fullNameOf(user), role: (user.role ?? 'pending') as Role, email: user.email ?? '', avatarUrl: user.avatarUrl }] : []))
        .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
    }
    return Object.entries(staffProfiles.data ?? {})
      .flatMap(([uid, profile]) => {
        const name = (profile?.displayName ?? '').trim()
        if (!profile || !name) return []
        return [{ key: uid, name, role: (profile.role ?? 'pending') as Role, email: profile.email ?? '', avatarUrl: profile.avatarUrl }]
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
  }, [isAdmin, users.data, staffProfiles.data])

  if (state.status !== 'ready') return null
  if (state.role === 'pending') {
    return (
      <Card className="mx-auto max-w-lg text-center">
        <Card.Header className="items-center">
          <Card.Title>Erişim yok</Card.Title>
          <Card.Description>Kişiler yalnızca onaylı editör, admin ve kurucu rolündeki kullanıcılara açıktır.</Card.Description>
        </Card.Header>
      </Card>
    )
  }

  const source = isAdmin ? users : staffProfiles
  const emptyMessage = isAdmin ? 'Henüz kayıtlı kullanıcı yok.' : 'Henüz profil fotoğrafı/adı paylaşan kimse yok.'

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-5">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wider text-muted">Yönetim</div>
        <h1 className="mt-1 text-2xl font-semibold">Kişiler</h1>
      </div>

      {source.isLoading && <p className="py-10 text-center text-sm text-muted">Yükleniyor…</p>}
      {source.error && <p className="py-10 text-center text-sm text-danger">Kişiler yüklenemedi.</p>}
      {!source.isLoading && !source.error && contacts.length === 0 && <p className="py-10 text-center text-sm text-muted">{emptyMessage}</p>}

      {contacts.length > 0 && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {contacts.map((contact) => (
            <ContactCard key={contact.key} contact={contact} eventCount={eventCounts.get(contact.name) ?? 0} newsCount={newsCounts.get(contact.name) ?? 0} />
          ))}
        </div>
      )}
    </div>
  )
}
