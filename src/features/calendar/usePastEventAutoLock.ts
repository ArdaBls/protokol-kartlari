import { useEffect, useMemo, useRef, useState } from 'react'
import { onValue, ref } from 'firebase/database'
import { useAuth } from '../../auth/useAuth'
import { useDbValue } from '../../hooks/useDbValue'
import { useDbMode } from '../../lib/dbMode'
import { db } from '../../lib/firebase'
import { isApprovedRole } from '../../lib/roles'
import type { CalendarEvent } from './calendarTypes'
import { shouldAutoLockPastEvent, toEventListWithId } from './calendarTypes'
import { useCalendarWriter } from './useCalendarWriter'

const CALENDAR_TIME_ZONE = 'Europe/Istanbul'

const zoneDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: CALENDAR_TIME_ZONE,
  year: 'numeric', month: '2-digit', day: '2-digit',
})
const zoneDateTimeFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: CALENDAR_TIME_ZONE,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
})

function dateParts(timestamp: number): Record<string, number> {
  return Object.fromEntries(
    zoneDateTimeFormatter.formatToParts(new Date(timestamp))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  )
}

function serverDayKey(timestamp: number): string {
  const parts = Object.fromEntries(
    zoneDateFormatter.formatToParts(new Date(timestamp))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  )
  return `${parts.year}-${parts.month}-${parts.day}`
}

/** Belirli bir anda İstanbul'un UTC farkını hesaplar. Firebase saati UTC olduğundan,
 * bu fark sonraki Türkiye gece yarısının sunucu zaman damgasını bulmak için kullanılır. */
function zoneOffsetMs(timestamp: number): number {
  const parts = dateParts(timestamp)
  return Date.UTC(parts.year, (parts.month ?? 1) - 1, parts.day, parts.hour % 24, parts.minute, parts.second) - timestamp
}

function nextServerMidnight(timestamp: number): number {
  const current = dateParts(timestamp)
  const localMidnightAsUtc = Date.UTC(current.year, (current.month ?? 1) - 1, (current.day ?? 1) + 1)
  // Saat dilimi kuralları gece yarısı değişse bile doğru anı bulmak için kısa sabit-nokta çözümü.
  let next = localMidnightAsUtc
  for (let i = 0; i < 3; i += 1) next = localMidnightAsUtc - zoneOffsetMs(next)
  return next
}

/** Firebase RTDB'nin `.info/serverTimeOffset` verisiyle, cihaz saatinden bağımsız şekilde
 * İstanbul takvim gününü üretir ve sunucu saatine göre sonraki gece yarısını zamanlar. */
function useFirebaseDayKey(): { dayKey: string; isServerClockReady: boolean } {
  const [serverOffset, setServerOffset] = useState<number | null>(null)
  const [currentDay, setCurrentDay] = useState(() => serverDayKey(Date.now()))

  useEffect(() => onValue(
    ref(db, '.info/serverTimeOffset'),
    (snapshot) => setServerOffset(Number(snapshot.val()) || 0),
    (error) => console.error('Firebase sunucu saati okunamadı:', error),
  ), [])

  useEffect(() => {
    if (serverOffset === null) return
    let timer: number | undefined
    const serverNow = () => Date.now() + serverOffset
    const refresh = () => setCurrentDay(serverDayKey(serverNow()))
    const scheduleMidnight = () => {
      const now = serverNow()
      timer = window.setTimeout(() => {
        refresh()
        scheduleMidnight()
      }, Math.max(1, nextServerMidnight(now) - now + 50))
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refresh()
    }

    scheduleMidnight()
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      if (timer !== undefined) window.clearTimeout(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [serverOffset])

  return { dayKey: currentDay, isServerClockReady: serverOffset !== null }
}

/** Uygulama açıkken geçmiş takvim günlerini otomatik kilitler. Bu hook AppShell'de çalışır;
 * böylece kullanıcı takvim sekmesinde olmasa bile Firebase saatine göre Türkiye gece yarısı kuralı uygulanır. */
export function usePastEventAutoLock() {
  const { state } = useAuth()
  const { isReadOnly } = useDbMode()
  const writer = useCalendarWriter()
  const events = useDbValue<Record<string, CalendarEvent | null>>('etkinlikler')
  const { dayKey: currentDayKey, isServerClockReady } = useFirebaseDayKey()
  const inFlight = useRef(false)

  const dueEvents = useMemo(
    () => toEventListWithId(events.data).filter((event) => shouldAutoLockPastEvent(event, currentDayKey)),
    [currentDayKey, events.data],
  )
  const canAutoLock = state.status === 'ready' && isApprovedRole(state.role) && !isReadOnly && writer.canWrite

  useEffect(() => {
    if (!isServerClockReady || !canAutoLock || events.isLoading || events.error || !dueEvents.length || inFlight.current) return
    inFlight.current = true
    void writer.autoLockPastEvents(dueEvents, currentDayKey).finally(() => {
      inFlight.current = false
    })
  }, [canAutoLock, currentDayKey, dueEvents, events.error, events.isLoading, isServerClockReady, writer])
}
