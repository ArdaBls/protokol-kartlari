export const MONTHS_SHORT = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']

export const MONTHS_LONG = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
]

export const pad2 = (n: number) => String(n).padStart(2, '0')

/** YEREL saatle YYYY-MM-DD (toISOString UTC kayması yapar, kullanma). */
export const dateKey = (date: Date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`

/** "2026-03-05" → "5 Mart 2026"; geçersiz anahtar olduğu gibi döner. */
export function formatLongDateKey(key?: string | null): string {
  const [y, m, d] = String(key ?? '').split('-').map(Number)
  const date = new Date(y, m - 1, d)
  if (!key || date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return key ?? ''
  return `${d} ${MONTHS_LONG[m - 1]} ${y}`
}

export function formatShortDateKey(key?: string | null): string {
  if (!key) return ''
  const [, month, day] = key.split('-')
  return `${Number(day)} ${MONTHS_SHORT[Number(month) - 1] ?? month}`
}
