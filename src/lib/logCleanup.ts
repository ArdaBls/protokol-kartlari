import { get, ref } from 'firebase/database'
import { dbPathFor } from './dbMode'
import { db } from './firebase'

export const CLEANUP_LOG_LISTS = ['il', 'universite', 'etkinlik', 'hesap', 'dictionary'] as const

export interface CleanupLogEntry {
  target?: string
  by?: string
  email?: string
}

/** Eşleşen log satırlarını çok yollu silme güncellemesine dönüştürür. */
export async function collectLogDeleteUpdates(
  isTestMode: boolean,
  matches: (entry: CleanupLogEntry) => boolean,
): Promise<Record<string, null>> {
  const snapshots = await Promise.all(
    CLEANUP_LOG_LISTS.map((list) => get(ref(db, dbPathFor(`logs/${list}`, isTestMode)))),
  )
  const updates: Record<string, null> = {}
  snapshots.forEach((snapshot, index) => {
    const values = snapshot.val() as Record<string, CleanupLogEntry | null> | null
    Object.entries(values ?? {}).forEach(([id, entry]) => {
      if (entry && matches(entry)) updates[`${dbPathFor(`logs/${CLEANUP_LOG_LISTS[index]}`, isTestMode)}/${id}`] = null
    })
  })
  return updates
}
