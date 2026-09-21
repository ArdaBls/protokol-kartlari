export type LogList = 'il' | 'universite' | 'etkinlik' | 'hesap' | 'dictionary'

export const LOG_LISTS: LogList[] = ['il', 'universite', 'etkinlik', 'hesap', 'dictionary']

export const LOG_LIST_LABEL: Record<LogList, string> = {
  il: 'İl Protokol Sırası',
  universite: 'Üniversite Protokol Sırası',
  etkinlik: 'Etkinlik Takvimi',
  hesap: 'Hesap',
  dictionary: 'Veri Sözlüğü',
}

export interface LogEntry {
  by?: string
  email?: string
  action?: string
  target?: string
  timestamp?: number
}

export interface PendingAccountEntry {
  by: string
  email: string
  target: string
  timestamp: number
}

export interface AttendanceRequestEntry {
  id: string
  requestedByName?: string
  attendeeName?: string
  eventName?: string
  eventDate?: string
  role?: 'gorevli' | 'haberYazanlari'
  requestedAt?: number
}

export interface PersonalNotification {
  id: string
  title?: string
  message?: string
  createdAt?: number
  read?: boolean
  type?: string
  relatedGameId?: string
}

export interface LogGroup {
  key: string
  list: LogList
  target: string
  entries: LogEntry[]
  lastTimestamp: number
  editorCounts: Array<{ name: string; count: number }>
}

/**
 * Aynı hedefe (kişi/proje/kayıt) ait tekil log satırlarını TEK bir gruba toplar --
 * kullanıcı isteği: "bir etkinlik düzenlendi diye bir akordeon açılsın, içinde kimin
 * ne kaç kere düzenlediği yazsın" (eskiden her satır ayrı ayrı, boğucu bir liste hâlinde geliyordu).
 * Hedefi olmayan (serbest) kayıtlar kendi action metnine göre gruplanır.
 */
export function groupLogsByTarget(list: LogList, entries: LogEntry[]): LogGroup[] {
  const groups = new Map<string, LogGroup>()
  entries.forEach((entry) => {
    const target = (entry.target || entry.action || '(bilinmeyen kayıt)').trim()
    const key = `${list}::${target}`
    const existing = groups.get(key)
    if (existing) {
      existing.entries.push(entry)
      existing.lastTimestamp = Math.max(existing.lastTimestamp, entry.timestamp ?? 0)
    } else {
      groups.set(key, { key, list, target, entries: [entry], lastTimestamp: entry.timestamp ?? 0, editorCounts: [] })
    }
  })
  return [...groups.values()]
    .map((group) => {
      const counts = new Map<string, number>()
      group.entries.forEach((entry) => {
        const name = entry.by || entry.email || '?'
        counts.set(name, (counts.get(name) ?? 0) + 1)
      })
      group.entries.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
      group.editorCounts = [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
      return group
    })
    .sort((a, b) => b.lastTimestamp - a.lastTimestamp)
}
