import { get, ref } from 'firebase/database'
import type { Database } from 'firebase/database'

export interface CleanupLogEntry {
  actorUid?: string
  target?: string
  by?: string
  email?: string
}

/** Profil e-postası ve ad değişebilir; UID'siz eski loglar otomatik silinmez. */
export function matchesAccountLog(entry: CleanupLogEntry, uid: string): boolean {
  return !!uid && entry.actorUid === uid
}

export function matchingLogDeletes(
  basePath: string,
  data: unknown,
  matches: (entry: CleanupLogEntry) => boolean,
): Record<string, null> {
  const updates: Record<string, null> = {}
  if (!data || typeof data !== 'object') return updates
  for (const [list, entries] of Object.entries(data)) {
    if (!entries || typeof entries !== 'object') continue
    for (const [id, entry] of Object.entries(entries)) {
      if (entry && typeof entry === 'object' && matches(entry as CleanupLogEntry)) {
        updates[`${basePath}/${list}/${id}`] = null
      }
    }
  }
  return updates
}

/** Eşleşen log satırlarını çok yollu silme güncellemesine dönüştürür. */
export async function collectLogDeleteUpdates(
  db: Database,
  scope: boolean | 'both',
  matches: (entry: CleanupLogEntry) => boolean,
): Promise<Record<string, null>> {
  const paths = scope === 'both' ? ['logs', 'test/logs'] : [scope ? 'test/logs' : 'logs']
  const updates = await Promise.all(paths.map(async (path) =>
    matchingLogDeletes(path, (await get(ref(db, path))).val(), matches),
  ))
  return Object.assign({}, ...updates)
}
