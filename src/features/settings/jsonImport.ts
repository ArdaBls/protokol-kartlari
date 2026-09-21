// JSON içe aktarma doğrulaması — eski ayarlar.html ile aynı kurallar. Yedekten gelen veri güvenilmezdir:
// yalnızca bilinen alanlar, doğrulanmış biçimleriyle yazılır.
import { safePhotoUrl } from '../protocol/protocolRules'

const VALID_STATUS = new Set(['aktif', 'pasif', 'silindi'])
const NEWS_SOURCES = ['İHA', 'AA', 'DHA', 'ANKA']

type Loose = Record<string, unknown>
export type ImportEntry = [string, unknown]

const text = (value: unknown) => (value === undefined || value === null ? '' : String(value))
const isObject = (value: unknown): value is Loose => !!value && typeof value === 'object' && !Array.isArray(value)

/** rank:null → 0 olup kişiyi Rektör'ün üstüne çıkarmasın, "abc" → NaN tüm içe aktarmayı bozmasın. */
function cleanRank(value: unknown, fallback: number | string = ''): number | string {
  if (value === undefined || value === null || value === '') return fallback
  const n = Number(value)
  return Number.isNaN(n) || n < 0 ? fallback : n
}

const cleanDate = (value: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(text(value).trim()) ? text(value).trim() : '')

/** Firebase anahtarı olarak güvenli mi? __proto__ gibi anahtarlar nesnenin prototipini bozar ve kayıt sessizce kaybolur. */
export const isSafeDbKey = (key: string) => /^[A-Za-z0-9_-]+$/.test(key) && !['__proto__', 'constructor', 'prototype'].includes(key)

function sanitizeHistory(entries: unknown[]) {
  return entries.flatMap((entry) => {
    if (!isObject(entry)) return []
    const unvan = text(entry.unvan).trim()
    return unvan ? [{ unvan, baslangic: cleanDate(entry.baslangic), bitis: cleanDate(entry.bitis) }] : []
  })
}

export function sanitizePerson(item: Loose): Loose {
  const record: Loose = {
    prefix: item.prefix ? text(item.prefix) : '',
    name: text(item.name).trim(),
    title: text(item.title).trim(),
    unit: item.unit ? text(item.unit) : '',
    status: VALID_STATUS.has(text(item.status)) ? item.status : 'aktif',
    rank: cleanRank(item.rank),
    photo: safePhotoUrl(text(item.photo)),
    start: cleanDate(item.start),
    end: cleanDate(item.end),
    note: item.note ? text(item.note) : '',
  }
  const order = cleanRank(item.order)
  if (order !== '') record.order = order
  if (Array.isArray(item.faculties)) record.faculties = item.faculties.map(String)
  if (Array.isArray(item.gorevGecmisi)) record.gorevGecmisi = sanitizeHistory(item.gorevGecmisi)
  if (item.ekGorevAciklamasi !== undefined) record.ekGorevAciklamasi = text(item.ekGorevAciklamasi)
  if (VALID_STATUS.has(text(item.prevStatus))) record.prevStatus = item.prevStatus
  if (Number.isFinite(Number(item.sonDogrulamaTs)) && Number(item.sonDogrulamaTs) >= 0 && item.sonDogrulamaTs !== null && item.sonDogrulamaTs !== '') {
    record.sonDogrulamaTs = Number(item.sonDogrulamaTs)
  }
  if (item.dogrulamaKaynak !== undefined) record.dogrulamaKaynak = text(item.dogrulamaKaynak)
  if (item.dogrulayan !== undefined) record.dogrulayan = text(item.dogrulayan)
  return record
}

const isValidPerson = (item: unknown): item is Loose => isObject(item) && !!item.name && !!item.title

/** Hem eski dizi tabanlı yedeği hem push-ID'li nesne biçimini kabul eder. */
export function parsePeopleFile(raw: string): ImportEntry[] | null {
  const parsed: unknown = JSON.parse(raw)
  if (Array.isArray(parsed)) return parsed.map((item) => ['', item])
  return isObject(parsed) ? Object.entries(parsed) : null
}

export function buildFullRestore(entries: ImportEntry[], newKey: () => string) {
  const records: Record<string, Loose> = {}
  let skipped = 0
  entries.forEach(([rawId, item]) => {
    if (!isValidPerson(item)) {
      skipped += 1
      return
    }
    records[isSafeDbKey(rawId) ? rawId : newKey()] = sanitizePerson(item)
  })
  return { records, skipped }
}

/** Birleştir: aynı ad+unvan eşleşirse yalnızca sıra/durum/ön ek/birim/fakülteler güncellenir, yoksa yeni kayıt eklenir. */
export function buildMerge(entries: ImportEntry[], existing: Record<string, Loose>, newKey: () => string) {
  const patch: Record<string, unknown> = {}
  let skipped = 0
  let matchCount = 0
  let newCount = 0
  entries.forEach(([, item]) => {
    if (!isValidPerson(item)) {
      skipped += 1
      return
    }
    const name = text(item.name).trim()
    const title = text(item.title).trim()
    const existingId = Object.keys(existing).find((id) => text(existing[id]?.name).trim() === name && text(existing[id]?.title).trim() === title)
    if (!existingId) {
      newCount += 1
      patch[newKey()] = sanitizePerson(item)
      return
    }
    matchCount += 1
    const rank = cleanRank(item.rank, existing[existingId].rank as number | string)
    patch[`${existingId}/rank`] = rank === '' ? null : rank
    patch[`${existingId}/status`] = VALID_STATUS.has(text(item.status)) ? item.status : 'aktif'
    if (item.prefix) patch[`${existingId}/prefix`] = text(item.prefix)
    if (item.unit !== undefined && item.unit !== null) patch[`${existingId}/unit`] = text(item.unit)
    if (Array.isArray(item.faculties)) patch[`${existingId}/faculties`] = item.faculties.map(String)
  })
  return { patch, skipped, matchCount, newCount }
}

const isDateKey = (value: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(text(value))

/** Takvim yedeği: { etkinlikler: {...} } sarmalı ya da doğrudan etkinlik nesnesi. */
export function sanitizeEvents(raw: string, newKey: () => string, timestamp: unknown) {
  const parsed: unknown = JSON.parse(raw)
  const source = isObject(parsed) && isObject(parsed.etkinlikler) ? parsed.etkinlikler : parsed
  if (!isObject(source)) return null

  const clean: Record<string, Loose> = {}
  let kept = 0
  let skipped = 0
  Object.entries(source).forEach(([rawKey, item]) => {
    if (!isObject(item) || !item.ad || !isDateKey(item.tarih)) {
      skipped += 1
      return
    }
    const tarih = text(item.tarih)
    clean[isSafeDbKey(rawKey) ? rawKey : newKey()] = {
      ad: text(item.ad).trim(), tur: item.tur ? text(item.tur) : 'diger', durum: item.durum ? text(item.durum) : 'planlandi',
      tarih, saat: text(item.saat), bitisSaat: text(item.bitisSaat),
      bitisTarihi: isDateKey(item.bitisTarihi) && text(item.bitisTarihi) >= tarih ? text(item.bitisTarihi) : null,
      yer: text(item.yer), birim: text(item.birim), planlayan: text(item.planlayan), gorevli: text(item.gorevli),
      haberYazanlari: text(item.haberYazanlari), haberMetni: text(item.haberMetni),
      katilimcilar: (Array.isArray(item.katilimcilar) ? item.katilimcilar : []).filter(isObject).map((a) => ({
        prefix: text(a.prefix), name: text(a.name), title: text(a.title),
        rank: a.rank !== undefined && a.rank !== null ? a.rank : '', kaynak: a.kaynak === 'il' ? 'il' : 'universite',
      })),
      locked: !!item.locked,
      projeId: isSafeDbKey(text(item.projeId)) ? text(item.projeId) : null,
      renk: item.renk !== undefined ? text(item.renk) : null,
      taslak: item.taslak === true ? true : null,
      rozetler: Array.isArray(item.rozetler) ? item.rozetler.map(String) : [],
      haberKaynagi: NEWS_SOURCES.includes(text(item.haberKaynagi)) ? item.haberKaynagi : '',
      arsiv: text(item.arsiv), not: text(item.not),
      tamamlayan: item.tamamlayan ? text(item.tamamlayan) : null,
      tamamlayanEmail: item.tamamlayanEmail ? text(item.tamamlayanEmail) : null,
      guncelleyen: item.guncelleyen ? text(item.guncelleyen) : null,
      olusturan: text(item.olusturan),
      olusturmaTs: Number.isFinite(Number(item.olusturmaTs)) && item.olusturmaTs !== null && item.olusturmaTs !== '' ? Number(item.olusturmaTs) : timestamp,
      guncellemeTs: timestamp,
    }
    kept += 1
  })
  return { clean, kept, skipped }
}
