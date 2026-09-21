// Türkçe Wordle -- eski admin-src/src/v4/wordle.js'nin oyun mantığı (Firebase/DOM'suz, saf fonksiyonlar).
// Günün kelimesi SUNUCUSUZ: tarih + yıllık "seed sürümü" birleşip deterministik bir PRNG ile
// havuzdan seçiliyor -- her istemci bağımsız aynı sonuca ulaşır, günlük kelime için Firebase'e gerek yok.
export const WORD_LEN = 5
export const MAX_TRIES = 6
// Yılbaşında bu sayı bir artırılır -- aynı tarih formülü yıldan yıla FARKLI bir kelime dizisi üretir.
export const SEED_VERSION = 2026

export type LetterState = 'dogru' | 'var' | 'yok'

export interface Guess {
  kelime: string
  sonuc: LetterState[]
}

export const KEYBOARD_ROWS = [
  ['e', 'r', 't', 'y', 'u', 'ı', 'o', 'p', 'ğ', 'ü'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'ş', 'i'],
  ['ENTER', 'z', 'c', 'v', 'b', 'n', 'm', 'ö', 'ç', 'BACK'],
]

/** Kullanıcının cihaz saati yanlış olsa bile herkese AYNI gün aynı bulmaca gelsin diye Türkiye saat dilimi kullanılır. */
export function bugununTarihiIstanbul(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date())
}

/** djb2 varyasyonu + mulberry32: kriptografik güvenlik gerekmiyor, sadece istemciler arası tutarlı bir sayı. */
export function seedliIndeks(tarihStr: string, havuzBoyu: number): number {
  const girdi = `${tarihStr}:${SEED_VERSION}`
  let h = 2166136261
  for (let i = 0; i < girdi.length; i++) {
    h ^= girdi.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  h = h >>> 0
  h = Math.imul(h ^ (h >>> 15), 1 | h)
  h = (h + Math.imul(h ^ (h >>> 7), 61 | h)) ^ h
  h = (h ^ (h >>> 14)) >>> 0
  return h % havuzBoyu
}

export function harfleriAyir(kelime: string): string[] {
  return Array.from(kelime)
}

/** Klasik Wordle geri bildirimi: önce tam eşleşenler, sonra kalanlar için "var ama yanlış yerde" -- tekrarlı harflerde yanlış sayıda "sarı" üretmemek için iki geçişli. */
export function geriBildirimHesapla(tahmin: string, hedef: string): LetterState[] {
  const tahminH = harfleriAyir(tahmin)
  const hedefH = harfleriAyir(hedef)
  const sonuc: LetterState[] = new Array(tahminH.length).fill('yok')
  const kalanHedef: Array<string | null> = hedefH.slice()
  tahminH.forEach((h, i) => {
    if (h === hedefH[i]) { sonuc[i] = 'dogru'; kalanHedef[i] = null }
  })
  tahminH.forEach((h, i) => {
    if (sonuc[i] === 'dogru') return
    const idx = kalanHedef.indexOf(h)
    if (idx !== -1) { sonuc[i] = 'var'; kalanHedef[idx] = null }
  })
  return sonuc
}

const PRIORITY: Record<LetterState, number> = { dogru: 3, var: 2, yok: 1 }

export function harfDurumunuGuncelle(harfDurumu: Record<string, LetterState>, sonuc: LetterState[], kelime: string): Record<string, LetterState> {
  const next = { ...harfDurumu }
  harfleriAyir(kelime).forEach((h, i) => {
    const yeni = sonuc[i]
    const eski = next[h]
    if (!eski || PRIORITY[yeni] > PRIORITY[eski]) next[h] = yeni
  })
  return next
}

export function ardisikGunMu(oncekiTarih: string | undefined, buguTarih: string): boolean {
  if (!oncekiTarih) return false
  const a = new Date(`${oncekiTarih}T00:00:00Z`).getTime()
  const b = new Date(`${buguTarih}T00:00:00Z`).getTime()
  return b - a === 86400000
}

export interface WordleStats {
  isim?: string
  oynanan: number
  kazanilan: number
  seri: number
  enUzunSeri: number
  sonTarih: string
  sonKazandi?: boolean
  dagitim: Record<string, number>
}

export const EMPTY_STATS: WordleStats = { oynanan: 0, kazanilan: 0, seri: 0, enUzunSeri: 0, sonTarih: '', dagitim: {} }
