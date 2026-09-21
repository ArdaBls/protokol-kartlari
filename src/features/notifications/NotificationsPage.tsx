import { Button, Card, toast } from '@heroui/react'
import { ref, update } from 'firebase/database'
import { Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import { FormModal } from '../../components/FormModal'
import { useDbValue } from '../../hooks/useDbValue'
import { dbPathFor, useDbMode } from '../../lib/dbMode'
import { db } from '../../lib/firebase'
import { approveAttendanceRequest, rejectAttendanceRequest } from './attendance'
import type { AttendanceRequestEntry, LogEntry, LogList, PendingAccountEntry, PersonalNotification } from './notificationTypes'
import { LOG_LISTS, LOG_LIST_LABEL, groupLogsByTarget } from './notificationTypes'
import { markNotificationsSeenNow } from './useNotificationBadge'
import { LogGroupCard } from './LogGroupCard'

type TabKey = 'all' | LogList | 'katilim' | 'kisisel'

const formatTime = (ts?: number) => (ts ? new Date(ts).toLocaleString('tr-TR') : '')

function EmptyState({ text }: { text: string }) {
  return <p className="px-4 py-10 text-center text-sm text-muted">{text}</p>
}

function AttendanceRow({ request, onApprove, onReject, isBusy }: { request: AttendanceRequestEntry; onApprove: () => void; onReject: () => void; isBusy: boolean }) {
  const roleLabel = request.role === 'haberYazanlari' ? 'haber yazarı' : 'basın görevlisi'
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-separator px-4 py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="text-sm"><span className="font-medium">{request.requestedByName || '?'}</span> <span className="text-muted">talep etti</span></div>
        <div className="text-xs text-muted">
          <strong className="text-foreground">{request.attendeeName}</strong>, {request.eventName || 'etkinlik'} etkinliğine {request.eventDate} tarihinde {roleLabel} olarak gitti olarak eklenmek istiyor.
        </div>
      </div>
      <span className="shrink-0 text-xs text-muted">{formatTime(request.requestedAt)}</span>
      <div className="flex shrink-0 gap-2">
        <Button size="sm" variant="secondary" isDisabled={isBusy} onPress={onApprove}>Onayla</Button>
        <Button size="sm" variant="ghost" className="text-danger" isDisabled={isBusy} onPress={onReject}>Reddet</Button>
      </div>
    </div>
  )
}

function PendingAccountRow({ entry }: { entry: PendingAccountEntry }) {
  const navigate = useNavigate()
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-separator px-4 py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{entry.by}</div>
        <div className="text-xs text-muted">Yeni kayıt talebi · onay bekliyor · {entry.email}</div>
      </div>
      <span className="shrink-0 text-xs text-muted">{formatTime(entry.timestamp)}</span>
      <Button size="sm" variant="secondary" className="shrink-0" onPress={() => navigate('/kullanici-yonetimi?filtre=pending')}>Onayla</Button>
    </div>
  )
}

function PersonalRow({ n }: { n: PersonalNotification }) {
  return (
    <div className={`flex items-center gap-3 border-b border-separator px-4 py-3 last:border-b-0 ${n.read ? '' : 'bg-accent-soft/40'}`}>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{n.title || 'Bildirim'}</div>
        <div className="text-xs text-muted">{n.message}</div>
      </div>
      <span className="shrink-0 text-xs text-muted">{formatTime(n.createdAt)}</span>
    </div>
  )
}

export function NotificationsPage() {
  const { state } = useAuth()
  const { isTestMode } = useDbMode()
  const [tab, setTab] = useState<TabKey>('all')
  const [busyRequestId, setBusyRequestId] = useState<string | null>(null)
  const [clearTarget, setClearTarget] = useState<TabKey | null>(null)
  const [isClearOpen, setIsClearOpen] = useState(false)
  const [isClearing, setIsClearing] = useState(false)

  const isAdmin = state.status === 'ready' && (state.role === 'admin' || state.role === 'owner')
  const isEditor = state.status === 'ready' && state.role === 'editor'
  const uid = state.status === 'ready' ? state.user.uid : ''

  // Sayfa her açıldığında "son görüldü" an'ı ilerletilir -- Topbar zilindeki rozet bundan
  // ÖNCEKİ logları bir daha saymaz (bkz. useNotificationBadge -- cihaz-yerel, Firebase kuralı gerekmez).
  useEffect(() => {
    if (!uid) return
    markNotificationsSeenNow(uid)
    window.dispatchEvent(new Event('protokol-notif-seen'))
  }, [uid])

  const users = useDbValue<Record<string, { role?: string; blocked?: boolean; firstName?: string; lastName?: string; email?: string; createdAt?: number } | null>>('users', { shadow: false, enabled: isAdmin })
  const logIl = useDbValue<Record<string, LogEntry | null>>('logs/il', { enabled: isAdmin })
  const logUniversite = useDbValue<Record<string, LogEntry | null>>('logs/universite', { enabled: isAdmin })
  const logEtkinlik = useDbValue<Record<string, LogEntry | null>>('logs/etkinlik', { enabled: isAdmin })
  const logHesap = useDbValue<Record<string, LogEntry | null>>('logs/hesap', { enabled: isAdmin })
  const logDictionary = useDbValue<Record<string, LogEntry | null>>('logs/dictionary', { enabled: isAdmin })
  const attendanceRaw = useDbValue<Record<string, AttendanceRequestEntry | null>>('attendanceRequests', { enabled: isAdmin })
  const personal = useDbValue<Record<string, PersonalNotification | null>>(`notifications/${uid}`, { enabled: !!uid })

  const logBuckets: Record<LogList, ReturnType<typeof useDbValue<Record<string, LogEntry | null>>>> = {
    il: logIl, universite: logUniversite, etkinlik: logEtkinlik, hesap: logHesap, dictionary: logDictionary,
  }

  const pendingAccounts = useMemo<PendingAccountEntry[]>(() => {
    const approved = new Set(['editor', 'admin', 'owner'])
    return Object.values(users.data ?? {})
      .flatMap((u) => {
        if (!u || approved.has(u.role ?? '')) return []
        const name = `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || '(isim girilmemiş)'
        return [{ by: name, email: u.email ?? '', target: u.email || name, timestamp: u.createdAt ?? 0 }]
      })
  }, [users.data])

  const groupsByList = useMemo(() => {
    const result = {} as Record<LogList, ReturnType<typeof groupLogsByTarget>>
    LOG_LISTS.forEach((list) => {
      const entries = Object.values(logBuckets[list].data ?? {}).flatMap((e) => (e ? [e] : []))
      result[list] = groupLogsByTarget(list, entries)
    })
    return result
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logIl.data, logUniversite.data, logEtkinlik.data, logHesap.data, logDictionary.data])

  const attendanceList = useMemo<AttendanceRequestEntry[]>(
    () =>
      Object.entries(attendanceRaw.data ?? {})
        .flatMap(([id, req]) => (req && req.requestedAt ? [{ ...req, id }] : []))
        .filter((req) => (req as unknown as { status?: string }).status === 'pending' || !('status' in req))
        .sort((a, b) => (b.requestedAt ?? 0) - (a.requestedAt ?? 0)),
    [attendanceRaw.data],
  )

  const personalList = useMemo<PersonalNotification[]>(
    () => Object.entries(personal.data ?? {}).flatMap(([id, n]) => (n ? [{ ...n, id }] : [])).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)),
    [personal.data],
  )

  const isLoading = isAdmin
    ? users.isLoading || LOG_LISTS.some((l) => logBuckets[l].isLoading) || attendanceRaw.isLoading
    : personal.isLoading

  // Sayfaya girildiğinde görüntülenen kişisel bildirimler okundu işaretlenir -- zil rozetinin düşmesi için.
  useMemo(() => {
    if (!uid || !personal.data) return
    const updates: Record<string, unknown> = {}
    Object.entries(personal.data).forEach(([id, n]) => {
      if (n && n.read !== true) updates[`${dbPathFor(`notifications/${uid}`, isTestMode)}/${id}/read`] = true
    })
    if (Object.keys(updates).length) update(ref(db), updates).catch((err) => console.error('Bildirimler okundu olarak işaretlenemedi:', err))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personal.data, uid])

  const handleAttendance = async (id: string, action: 'approve' | 'reject') => {
    if (state.status !== 'ready') return
    setBusyRequestId(id)
    try {
      if (action === 'approve') await approveAttendanceRequest(id, state.user.uid, state.displayName, isTestMode)
      else await rejectAttendanceRequest(id, state.user.uid, state.displayName, isTestMode)
      toast.success(action === 'approve' ? 'Talep onaylandı.' : 'Talep reddedildi.')
    } catch (err) {
      console.error('Talep işlenemedi:', err)
      toast.danger(err instanceof Error ? err.message : 'Talep işlenemedi.')
    } finally {
      setBusyRequestId(null)
    }
  }

  const clearTabData = async (target: TabKey) => {
    if (!isAdmin || state.status !== 'ready' || isClearing) return
    const updates: Record<string, unknown> = {}
    const addChildren = (basePath: string, values: Record<string, unknown> | null) => {
      Object.keys(values ?? {}).forEach((id) => {
        updates[dbPathFor(`${basePath}/${id}`, isTestMode)] = null
      })
    }
    const addLogList = (list: LogList) => addChildren(`logs/${list}`, logBuckets[list].data as Record<string, unknown> | null)

    if (target === 'all') {
      LOG_LISTS.forEach(addLogList)
      addChildren('attendanceRequests', attendanceRaw.data as Record<string, unknown> | null)
      if (uid) updates[dbPathFor(`notifications/${uid}`, isTestMode)] = null
    } else if (target === 'katilim') {
      addChildren('attendanceRequests', attendanceRaw.data as Record<string, unknown> | null)
    } else if (target === 'kisisel') {
      if (uid) updates[dbPathFor(`notifications/${uid}`, isTestMode)] = null
    } else {
      addLogList(target)
    }

    if (!Object.keys(updates).length) {
      toast.info('Bu sekmede silinecek kayıt yok.')
      return
    }
    setIsClearing(true)
    try {
      await update(ref(db), updates)
      toast.success(target === 'all' ? 'Tüm bildirim ve loglar temizlendi.' : 'Sekmedeki kayıtlar temizlendi.')
    } catch (err) {
      console.error('Bildirim kayıtları silinemedi:', err)
      toast.danger('Kayıtlar silinemedi. Firebase kurallarını kontrol edin.')
    } finally {
      setIsClearing(false)
    }
  }

  if (state.status !== 'ready') return null
  if (state.role === 'pending') {
    return (
      <Card className="mx-auto max-w-lg text-center">
        <Card.Header className="items-center">
          <Card.Title>Erişim yok</Card.Title>
          <Card.Description>Bildirimler yalnızca onaylı editör, admin ve kurucu rolündeki kullanıcılara açıktır.</Card.Description>
        </Card.Header>
      </Card>
    )
  }

  const tabs: Array<{ key: TabKey; label: string }> = isAdmin
    ? [
        { key: 'all', label: 'Tümü' },
        { key: 'il', label: LOG_LIST_LABEL.il },
        { key: 'universite', label: LOG_LIST_LABEL.universite },
        { key: 'etkinlik', label: LOG_LIST_LABEL.etkinlik },
        { key: 'hesap', label: LOG_LIST_LABEL.hesap },
        { key: 'katilim', label: 'Katılım Talepleri' },
        { key: 'kisisel', label: 'Bildirimlerim' },
      ]
    : [{ key: 'all', label: 'Tümü' }]

  const showLogList = (list: LogList) => (tab === 'all' || tab === list) && isAdmin
  const showPending = (tab === 'all' || tab === 'hesap') && isAdmin
  const showAttendance = (tab === 'all' || tab === 'katilim') && isAdmin
  const showPersonal = tab === 'all' || tab === 'kisisel' || isEditor

  const hasAnyContent =
    (showPending && pendingAccounts.length > 0) ||
    LOG_LISTS.some((list) => showLogList(list) && groupsByList[list]?.length > 0) ||
    (showAttendance && attendanceList.length > 0) ||
    (showPersonal && personalList.length > 0)

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-5">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wider text-muted">Etkinlik geçmişi</div>
        <h1 className="mt-1 text-2xl font-semibold">Bildirimler</h1>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div role="tablist" aria-label="Bildirim filtresi" className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0 sm:pb-0">
          {tabs.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                tab === key ? 'bg-accent text-accent-foreground' : 'bg-default text-muted hover:bg-default-hover hover:text-foreground'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {isAdmin && (
          <Button
            size="sm"
            variant="danger-soft"
            className="self-end shrink-0"
            isDisabled={isClearing}
            onPress={() => { setClearTarget(tab); setIsClearOpen(true) }}
          >
            <Trash2 size={15} />
            {tab === 'all' ? 'Tümünü temizle' : tab === 'katilim' ? 'Talepleri temizle' : tab === 'kisisel' ? 'Bildirimleri temizle' : 'Logları temizle'}
          </Button>
        )}
      </div>

      <Card>
        <Card.Content className="p-0">
          {isLoading && <EmptyState text="Yükleniyor…" />}
          {!isLoading && !hasAnyContent && <EmptyState text={isEditor ? 'Henüz bildiriminiz yok.' : 'Bu filtreyle eşleşen bir kayıt bulunamadı.'} />}

          {!isLoading && hasAnyContent && (
            <div className="flex flex-col">
              {showPending && pendingAccounts.map((entry, index) => <PendingAccountRow key={`pending-${index}`} entry={entry} />)}
              {showAttendance && attendanceList.map((request) => (
                <AttendanceRow
                  key={request.id}
                  request={request}
                  isBusy={busyRequestId === request.id}
                  onApprove={() => handleAttendance(request.id, 'approve')}
                  onReject={() => handleAttendance(request.id, 'reject')}
                />
              ))}
              {LOG_LISTS.map((list) => showLogList(list) && groupsByList[list]?.map((group) => <LogGroupCard key={group.key} group={group} />))}
              {showPersonal && personalList.map((n) => <PersonalRow key={n.id} n={n} />)}
            </div>
          )}
        </Card.Content>
      </Card>

      <FormModal
        isOpen={isClearOpen}
        onOpenChange={(isOpen) => { setIsClearOpen(isOpen); if (!isOpen) setClearTarget(null) }}
        title={clearTarget === 'all' ? 'Tüm bildirim ve logları temizle' : 'Sekmeyi temizle'}
        submitLabel="Evet, temizle"
        isDanger
        onSubmit={() => { if (clearTarget) void clearTabData(clearTarget) }}
      >
        <p className="text-sm text-muted">
          {clearTarget === 'all'
            ? 'Tüm loglar, katılım talepleri ve kendi bildirimleriniz Firebase’den kalıcı olarak silinecek.'
            : clearTarget === 'katilim'
              ? 'Bu sekmedeki katılım talepleri Firebase’den kalıcı olarak silinecek.'
              : clearTarget === 'kisisel'
                ? 'Kişisel bildirimleriniz Firebase’den kalıcı olarak silinecek.'
                : `${clearTarget ? LOG_LIST_LABEL[clearTarget] : 'Bu sekmedeki'} logları Firebase’den kalıcı olarak silinecek.`}
        </p>
      </FormModal>
    </div>
  )
}
