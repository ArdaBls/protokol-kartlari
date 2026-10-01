import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../../auth/useAuth'
import { useDbValue } from '../../hooks/useDbValue'
import { useDbMode } from '../../lib/dbMode'
import { dateKey } from '../../lib/dates'
import { isApprovedRole } from '../../lib/roles'
import type { CalendarEvent } from './calendarTypes'
import { shouldAutoLockPastEvent, toEventListWithId } from './calendarTypes'
import { useCalendarWriter } from './useCalendarWriter'

/** Yerel gece yarısında günü değiştirir; uyuyan bir sekme görünür olduğunda da günü yeniler. */
function useLocalDayKey(): string {
  const [currentDay, setCurrentDay] = useState(() => dateKey(new Date()))

  useEffect(() => {
    let timer: number | undefined
    const refresh = () => setCurrentDay(dateKey(new Date()))
    const scheduleMidnight = () => {
      const now = new Date()
      const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
      timer = window.setTimeout(() => {
        refresh()
        scheduleMidnight()
      }, Math.max(1, nextMidnight.getTime() - now.getTime() + 50))
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
  }, [])

  return currentDay
}

/** Uygulama açıkken geçmiş takvim günlerini otomatik kilitler. Bu hook AppShell'de çalışır;
 * böylece kullanıcı takvim sekmesinde olmasa bile yerel gece yarısı kuralı uygulanır. */
export function usePastEventAutoLock() {
  const { state } = useAuth()
  const { isReadOnly } = useDbMode()
  const writer = useCalendarWriter()
  const events = useDbValue<Record<string, CalendarEvent | null>>('etkinlikler')
  const currentDayKey = useLocalDayKey()
  const inFlight = useRef(false)

  const dueEvents = useMemo(
    () => toEventListWithId(events.data).filter((event) => shouldAutoLockPastEvent(event, currentDayKey)),
    [currentDayKey, events.data],
  )
  const canAutoLock = state.status === 'ready' && isApprovedRole(state.role) && !isReadOnly && writer.canWrite

  useEffect(() => {
    if (!canAutoLock || events.isLoading || events.error || !dueEvents.length || inFlight.current) return
    inFlight.current = true
    void writer.autoLockPastEvents(dueEvents, currentDayKey).finally(() => {
      inFlight.current = false
    })
  }, [canAutoLock, currentDayKey, dueEvents, events.error, events.isLoading, writer])
}
