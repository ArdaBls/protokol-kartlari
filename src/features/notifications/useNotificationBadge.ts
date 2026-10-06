import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../auth/useAuth'
import { useDbValue } from '../../hooks/useDbValue'
import { useDbMode } from '../../lib/dbMode'
import type { LogEntry } from './notificationTypes'

const APPROVED_ROLES = new Set(['editor', 'admin', 'owner'])

const lastSeenKey = (uid: string, isTestMode: boolean) => `protokol-notif-seen-${isTestMode ? 'test' : 'live'}-${uid}`

/** Bu cihazda "Bildirimler" sayfasının en son ne zaman açıldığı -- localStorage'da tutulur
 *  (Firebase kuralları bu ortamdan değiştirilemediği için yeni bir DB yoluna yazılamıyor;
 *  cihaza özel olması rozetin doğruluğunu etkilemez, sadece diğer cihazlarla senkron olmaz). */
export function readNotificationsLastSeen(uid: string, isTestMode = false): number {
  try {
    return Number(localStorage.getItem(lastSeenKey(uid, isTestMode))) || 0
  } catch {
    return 0
  }
}

export function markNotificationsSeenNow(uid: string, isTestMode = false): void {
  try {
    localStorage.setItem(lastSeenKey(uid, isTestMode), String(Date.now()))
  } catch {
    // localStorage kapalıysa (gizli sekme vb.) sessizce yok say -- rozet sadece bir sonraki oturumda düzelir.
  }
}

/**
 * Topbar zilindeki rozet sayısı -- admin/owner için: onay bekleyen hesaplar + bekleyen katılım
 * talepleri + "son görüldü"nden sonraki tüm log kayıtları (kişi/etkinlik/sözlük düzenlemeleri vb.).
 * Herkes için: kendi okunmamış kişisel bildirimleri.
 */
export function useNotificationBadge(): number {
  const { state } = useAuth()
  const { isTestMode } = useDbMode()
  const isAdmin = state.status === 'ready' && (state.role === 'admin' || state.role === 'owner')
  const uid = state.status === 'ready' ? state.user.uid : ''

  const users = useDbValue<Record<string, { role?: string } | null>>('users', { shadow: false, enabled: isAdmin })
  const personal = useDbValue<Record<string, { read?: boolean } | null>>(`notifications/${uid}`, { enabled: !!uid })
  const attendance = useDbValue<Record<string, { status?: string } | null>>('attendanceRequests', { enabled: isAdmin })

  // Takvim (logs/etkinlik) kayıtları rozete DAHİL EDİLMEZ -- kullanıcı isteği: her etkinlik
  // düzenlemesi/taşıması zil rozetini şişirmesin (bu loglar Bildirimler sayfasında görünmeye devam eder,
  // sadece rozet sayacına girmezler). Diğer düşük sıklıklı log türleri (kişi, hesap, sözlük) sayılmaya devam eder.
  const logIl = useDbValue<Record<string, LogEntry | null>>('logs/il', { enabled: isAdmin })
  const logUniversite = useDbValue<Record<string, LogEntry | null>>('logs/universite', { enabled: isAdmin })
  const logHesap = useDbValue<Record<string, LogEntry | null>>('logs/hesap', { enabled: isAdmin })
  const logDictionary = useDbValue<Record<string, LogEntry | null>>('logs/dictionary', { enabled: isAdmin })
  const logBuckets = [logIl, logUniversite, logHesap, logDictionary]

  const [seenTick, setSeenTick] = useState(0)
  useEffect(() => {
    const onSeen = () => setSeenTick((n) => n + 1)
    window.addEventListener('protokol-notif-seen', onSeen)
    return () => window.removeEventListener('protokol-notif-seen', onSeen)
  }, [])

  return useMemo(() => {
    const pendingAccounts = isAdmin ? Object.values(users.data ?? {}).filter((u) => u && !APPROVED_ROLES.has(u.role ?? '')).length : 0
    const pendingAttendance = isAdmin ? Object.values(attendance.data ?? {}).filter((r) => r && r.status === 'pending').length : 0
    const unreadPersonal = Object.values(personal.data ?? {}).filter((n) => n && n.read !== true).length
    const since = uid ? readNotificationsLastSeen(uid, isTestMode) : 0
    const newLogs = isAdmin
      ? logBuckets.reduce((sum, bucket) => sum + Object.values(bucket.data ?? {}).filter((e) => e && (e.timestamp ?? 0) > since).length, 0)
      : 0
    return pendingAccounts + pendingAttendance + unreadPersonal + newLogs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, uid, isTestMode, users.data, attendance.data, personal.data, logIl.data, logUniversite.data, logHesap.data, logDictionary.data, seenTick])
}
