import type { PersonRecord } from './protocolRules'

export const STATUS_REASONS = [
  { value: 'yeni_gorev', label: 'Yeni bir göreve atandı' },
  { value: 'gorev_bitti', label: 'Görevi sona erdi, başka bir göreve geri çekildi' },
  { value: 'yerine_atama', label: 'Yerine yeni biri atanacak' },
  { value: 'istifa', label: 'İstifa etti' },
  { value: 'emekli', label: 'Emekli oldu' },
  { value: 'gorevden_alindi', label: 'Görevden alındı' },
  { value: 'vefat', label: 'Vefat etti' },
  { value: 'diger', label: 'Diğer' },
] as const

/** Kurum içi geçiş ("active") unvanı değiştirir; gerçek ayrılış ("passive") halef ataması gerektirir. */
export type ReasonKind = 'active' | 'passive' | null

export function reasonKind(reason?: string): ReasonKind {
  if (!reason) return null
  return reason === 'yeni_gorev' || reason === 'gorev_bitti' ? 'active' : 'passive'
}

export const SIMPLE_STATUS_REASON_LABELS: Record<string, string> = {
  istifa: 'İstifa etti',
  emekli: 'Emekli oldu',
  gorevden_alindi: 'Görevden alındı',
  vefat: 'Vefat etti',
  diger: 'Pasife alındı (diğer sebep)',
}

const LOG_FIELD_LABELS = {
  prefix: 'Unvan Ön Eki', name: 'İsim Soyisim', title: 'Görev Unvanı', unit: 'Birim / Kurum',
  status: 'Durum', rank: 'Protokol Sırası', start: 'Başlangıç Tarihi', end: 'Bitiş Tarihi',
  note: 'Not', photo: 'Fotoğraf', faculties: 'Bağlı Birim / Ek Görev',
} as const

const LOG_STATUS_LABELS: Record<string, string> = { aktif: 'Aktif', pasif: 'Pasif (arşiv)', silindi: 'Çöp kutusunda' }
const LOG_VALUE_MAX = 60
const TEXT_FIELDS = ['prefix', 'name', 'title', 'unit', 'start', 'end', 'note'] as const

export const STATUS_LOG_PREFIX = `${LOG_FIELD_LABELS.status}:`

/** " · " log satır ayıracı olduğu için kullanıcı metninden temizlenir; uzun değerler kısaltılır. */
function logValue(value: unknown): string {
  const text = (value === undefined || value === null ? '' : String(value).trim()).split(' · ').join(' - ')
  if (!text) return '(boş)'
  return text.length > LOG_VALUE_MAX ? `${text.slice(0, LOG_VALUE_MAX)}…` : text
}

const rankOf = (value: unknown) => (value === undefined || value === null || value === '' ? null : Number(value))

/** Düzenlemede hangi alanın nasıl değiştiğini log için "Alan: eski → yeni" satırlarına çevirir. */
export function describeRecordChanges(oldRec: PersonRecord, newRec: PersonRecord): string[] {
  const changes: string[] = []

  const oldRank = rankOf(oldRec.rank)
  const newRank = rankOf(newRec.rank)
  if (oldRank !== newRank) {
    if (oldRank !== null && newRank !== null) {
      changes.push(`${LOG_FIELD_LABELS.rank}: ${oldRank}. sıradan ${newRank}. sıraya ${newRank < oldRank ? 'yükseltildi' : 'düşürüldü'}`)
    } else if (newRank !== null) {
      changes.push(`${LOG_FIELD_LABELS.rank}: (boş) → ${newRank}. sıra`)
    } else {
      changes.push(`${LOG_FIELD_LABELS.rank}: ${oldRank}. sıra → (boş)`)
    }
  }

  const oldStatus = oldRec.status || 'aktif'
  const newStatus = newRec.status || 'aktif'
  if (oldStatus !== newStatus) {
    changes.push(`${STATUS_LOG_PREFIX} ${LOG_STATUS_LABELS[oldStatus] ?? oldStatus} → ${LOG_STATUS_LABELS[newStatus] ?? newStatus}`)
  }

  TEXT_FIELDS.forEach((key) => {
    const before = String(oldRec[key] ?? '').trim()
    const after = String(newRec[key] ?? '').trim()
    if (before !== after) changes.push(`${LOG_FIELD_LABELS[key]}: ${logValue(before)} → ${logValue(after)}`)
  })

  const oldPhoto = oldRec.photo || ''
  const newPhoto = newRec.photo || ''
  if (oldPhoto !== newPhoto) {
    changes.push(`${LOG_FIELD_LABELS.photo}: ${!oldPhoto ? 'eklendi' : !newPhoto ? 'kaldırıldı' : 'değiştirildi'}`)
  }

  if (Array.isArray(newRec.faculties) || Array.isArray(oldRec.faculties)) {
    const before = oldRec.faculties ?? []
    const after = newRec.faculties ?? []
    const added = after.filter((f) => !before.includes(f))
    const removed = before.filter((f) => !after.includes(f))
    if (added.length || removed.length) {
      const parts = [added.length && `+ ${added.join(', ')}`, removed.length && `− ${removed.join(', ')}`].filter(Boolean)
      changes.push(`${LOG_FIELD_LABELS.faculties}: ${parts.join('; ')}`)
    }
  }

  if (JSON.stringify(oldRec.gorevGecmisi ?? []) !== JSON.stringify(newRec.gorevGecmisi ?? [])) {
    changes.push('Görev geçmişi güncellendi')
  }
  return changes
}
