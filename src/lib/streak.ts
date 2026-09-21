// Günlük giriş serisi — users/{uid}/streak (eski streak.js ile aynı şema ve kurallar).
import { get, ref, set } from 'firebase/database'
import { dateKey } from './dates'
import { db } from './firebase'

export interface StreakResult {
  count: number
  longest: number
  justBroken: boolean
}

interface StreakRecord {
  count?: number
  lastDate?: string
  longest?: number
  brokenNoticeShown?: string | null
}

const MEANINGFUL_STREAK = 2

const yesterdayKey = (now: Date) => dateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))

/** Motivasyon özelliği: hiçbir hata sayfayı etkilemez, sessizce 0 döner. */
export async function initStreak(uid: string): Promise<StreakResult> {
  const now = new Date()
  const today = dateKey(now)
  const streakRef = ref(db, `users/${uid}/streak`)

  try {
    const streak = (await get(streakRef)).val() as StreakRecord | null

    if (!streak) {
      await set(streakRef, { count: 1, lastDate: today, longest: 1, brokenNoticeShown: null })
      return { count: 1, longest: 1, justBroken: false }
    }

    if (streak.lastDate === today) {
      const count = streak.count || 1
      return { count, longest: streak.longest || count, justBroken: false }
    }

    const brokenNoticeShown = streak.brokenNoticeShown ?? null

    if (streak.lastDate === yesterdayKey(now)) {
      const count = (streak.count || 0) + 1
      const longest = Math.max(streak.longest || 0, count)
      await set(streakRef, { count, lastDate: today, longest, brokenNoticeShown })
      return { count, longest, justBroken: false }
    }

    const justBroken = (streak.count || 0) >= MEANINGFUL_STREAK && brokenNoticeShown !== today
    const longest = streak.longest || streak.count || 0
    await set(streakRef, { count: 1, lastDate: today, longest, brokenNoticeShown: justBroken ? today : brokenNoticeShown })
    return { count: 1, longest, justBroken }
  } catch (err) {
    console.error('Streak okunamadı/güncellenemedi (sayfayı etkilemez):', err)
    return { count: 0, longest: 0, justBroken: false }
  }
}
