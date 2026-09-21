// Protokol listeleri: veri tipleri, fakülte grupları ve sıralama kuralları (eski app.js ile birebir).

export type ListKey = 'il' | 'universite'
export type PersonStatus = 'aktif' | 'pasif' | 'silindi'
export type StatusView = PersonStatus

export interface Person {
  _id: string
  prefix?: string
  name?: string
  title?: string
  unit?: string
  status?: string
  rank?: number | string | null
  order?: number | string | null
  photo?: string
  start?: string
  end?: string
  note?: string
  faculties?: string[]
  sonDogrulamaTs?: number
  dogrulamaKaynak?: string
  dogrulayan?: string
  prevStatus?: string
  ekGorevAciklamasi?: string
  gorevGecmisi?: HistoryEntry[]
}

export interface HistoryEntry {
  unvan: string
  baslangic: string
  bitis: string
}

export type PersonRecord = Omit<Person, '_id'>

export const LIST_PATHS: Record<ListKey, string> = {
  il: 'ilProtokolVerileri',
  universite: 'universiteProtokolVerileri',
}

export const LIST_LABELS: Record<ListKey, string> = {
  il: 'İl Protokolü',
  universite: 'Üniversite Protokolü',
}

export const STATUS_LABELS: Record<StatusView, string> = {
  aktif: 'Aktif',
  pasif: 'Arşiv',
  silindi: 'Silinenler',
}

export const FACULTY_GROUPS: ReadonlyArray<{ title: string; items: readonly string[] }> = [
  { title: 'Rektörlük', items: ['Rektör', 'Rektör Yardımcısı'] },
  {
    title: 'Fakülteler',
    items: [
      'Ali Fuad Başgil Hukuk Fakültesi', 'Çarşamba İnsan ve Toplum Bilimleri Fakültesi', 'Diş Hekimliği Fakültesi',
      'Eczacılık Fakültesi', 'Eğitim Fakültesi', 'Fen Fakültesi', 'Güzel Sanatlar Fakültesi',
      'İktisadi ve İdari Bilimler Fakültesi', 'İlahiyat Fakültesi', 'İletişim Fakültesi',
      'İnsan ve Toplum Bilimleri Fakültesi', 'Mimarlık Fakültesi', 'Mühendislik Fakültesi',
      'Sağlık Bilimleri Fakültesi', 'Tıp Fakültesi', 'Turizm Fakültesi', 'Veteriner Fakültesi',
      'Yaşar Doğu Spor Bilimleri Fakültesi', 'Ziraat Fakültesi',
    ],
  },
  { title: 'Yüksekokul ve Konservatuvar', items: ['Devlet Konservatuvarı', 'Yabancı Diller Yüksekokulu'] },
  {
    title: 'Enstitüler',
    items: ['Lisansüstü Eğitim Enstitüsü', 'Kenevir Araştırmaları Enstitüsü', 'Yaban Hayatı Araştırmaları Enstitüsü'],
  },
  {
    title: 'Meslek Yüksekokulları',
    items: [
      'Alaçam Meslek Yüksekokulu', 'Bafra Meslek Yüksekokulu', 'Bafra Turizm Meslek Yüksekokulu',
      'Bilişim Teknolojileri Meslek Yüksekokulu', 'Çarşamba Ticaret Borsası Meslek Yüksekokulu',
      'Havelsan Siber Güvenlik Meslek Yüksekokulu', 'Havza Meslek Yüksekokulu', 'Ladik Meslek Yüksekokulu',
      'Sağlık Hizmetleri Meslek Yüksekokulu', 'Samsun Meslek Yüksekokulu', 'Terme Meslek Yüksekokulu',
      'Vezirköprü Meslek Yüksekokulu', 'Yeşilyurt Demir Çelik Meslek Yüksekokulu',
    ],
  },
  { title: 'Ofisler ve Merkezler', items: ['Teknoloji Transfer Ofisi'] },
  {
    title: 'Koordinatörlükler',
    items: [
      'Araştırma ve Geliştirme Koordinatörlüğü (AR-GE)', 'Eğitim Öğretim Koordinatörlüğü', 'Kalite Koordinatörlüğü',
      'Meslek Yüksekokulları Koordinatörlüğü', 'Mezunlar Koordinatörlüğü',
      'Öğretim Üyesi Yetiştirme Programı Koordinatörlüğü', 'Temel Bilimler Dersleri Koordinatörlüğü',
      'Uluslararası İlişkiler Koordinatörlüğü', 'Uygulama ve Araştırma Merkezleri Koordinatörlüğü',
      'Yayın Koordinatörlüğü', 'Toplumsal Katkı Koordinatörlüğü',
    ],
  },
]

const PREFIX_WEIGHTS: Record<string, number> = {
  'Prof. Dr.': 1, 'Doç. Dr.': 2, 'Dr. Öğr. Üyesi': 3, 'Dr.': 4, 'Öğr. Gör.': 5, 'Arş. Gör.': 6, 'Av.': 7, 'Uzm.': 7, '': 8,
}
const DEFAULT_PREFIX_WEIGHT = 8
const UNKNOWN_TITLE_TIER = 100

// Samsun Valiliği Tebrikata Giriş Sırası esaslı unvan katmanları; en spesifik anahtar önce gelir.
const TITLE_HIERARCHY: ReadonlyArray<{ key: string; weight: number }> = [
  { key: 'vali yardımcısı', weight: 6 }, { key: 'vali', weight: 1 }, { key: 'milletvekili', weight: 2 },
  { key: 'garnizon komutanı', weight: 3 }, { key: 'büyükşehir belediye başkanı', weight: 4 },
  { key: 'ilçe belediye başkanı', weight: 6 }, { key: 'belediye başkanı', weight: 4 },
  { key: 'cumhuriyet başsavcısı', weight: 5 }, { key: 'baro başkanı', weight: 5 }, { key: 'kaymakam', weight: 6 },
  { key: 'rektör yardımcısı', weight: 7 }, { key: 'rektör', weight: 5 }, { key: 'dekan yardımcısı', weight: 12 },
  { key: 'dekan vekili', weight: 7 }, { key: 'dekan v.', weight: 7 }, { key: 'dekan', weight: 7 },
  { key: 'enstitü müdür yardımcısı', weight: 12 }, { key: 'yüksekokul müdür yardımcısı', weight: 12 },
  { key: 'müdür yardımcısı', weight: 12 }, { key: 'enstitü müdürü', weight: 7 }, { key: 'yüksekokul müdürü', weight: 7 },
  { key: 'müdür', weight: 7 }, { key: 'genel sekreter', weight: 8 }, { key: 'daire başkanı', weight: 13 },
  { key: 'bölüm başkanı', weight: 13 }, { key: 'öğretim görevlisi', weight: 14 }, { key: 'araştırma görevlisi', weight: 14 },
]

const lower = (value?: string) => (value ?? '').trim().toLocaleLowerCase('tr-TR')

export function hierarchyWeight(person: Person): number {
  const title = lower(person.title)
  const tier = title ? (TITLE_HIERARCHY.find((entry) => title.includes(entry.key))?.weight ?? UNKNOWN_TITLE_TIER) : UNKNOWN_TITLE_TIER
  return tier * 100 + (PREFIX_WEIGHTS[person.prefix ?? ''] ?? DEFAULT_PREFIX_WEIGHT)
}

/** Aynı unvan katmanında OMÜ her zaman diğer kurumların önünde. */
export function institutionWeight(person: Person): number {
  const unit = lower(person.unit)
  return !unit || unit.includes('ondokuz mayıs') || unit.includes('omü') ? 1 : 2
}

const numericOrInfinity = (value: unknown) =>
  value === '' || value === null || value === undefined || Number.isNaN(Number(value)) ? Infinity : Number(value)

/** Ana liste sırası: protokol sırası (rank) → unvan katmanı → kurum → elle sıra (order) → isim. */
export function compareByProtocol(a: Person, b: Person): number {
  return (
    numericOrInfinity(a.rank) - numericOrInfinity(b.rank) ||
    hierarchyWeight(a) - hierarchyWeight(b) ||
    institutionWeight(a) - institutionWeight(b) ||
    numericOrInfinity(a.order) - numericOrInfinity(b.order) ||
    (a.name ?? '').localeCompare(b.name ?? '', 'tr')
  )
}

/** Haber metni ve katılımcı sırası: unvan katmanı birincil, protokol sırası yalnızca eşitlikte ayırır. */
export function compareForNews(a: Person, b: Person): number {
  return (
    hierarchyWeight(a) - hierarchyWeight(b) ||
    institutionWeight(a) - institutionWeight(b) ||
    numericOrInfinity(a.rank) - numericOrInfinity(b.rank) ||
    numericOrInfinity(a.order) - numericOrInfinity(b.order) ||
    (a.name ?? '').localeCompare(b.name ?? '', 'tr')
  )
}

/** Sıralama modunda aynı kilit grubunda (unvan katmanı + kurum) olmayanlar yer değiştiremez. */
export const reorderLockKey = (person: Person) => `${hierarchyWeight(person)}|${institutionWeight(person)}`

export const rankGroupKey = (person: Person) =>
  person.rank === '' || person.rank === null || person.rank === undefined ? '__none__' : String(person.rank)

/** Rektör / Rektör Yardımcıları / Genel Sekreter / Daire Başkanları: fakülteye bağlı olmayan merkez idare. */
export const isCentralAdmin = (person: Person) => [1, 2, 3, 12].includes(Number(person.rank))

/** "pasif"/"silindi" dışındaki her durum aktif sayılır; geçersiz bir değer kaydı kaybettirmez. */
export function statusOf(person: Person): PersonStatus {
  return person.status === 'pasif' || person.status === 'silindi' ? person.status : 'aktif'
}

export type FreshnessLevel = 'green' | 'yellow' | 'red'

const DAY_MS = 86_400_000
const FRESH_DAYS = 90
const STALE_DAYS = 365

export function freshnessOf(person: Person, now = Date.now()): { level: FreshnessLevel; label: string } {
  if (!person.sonDogrulamaTs) return { level: 'red', label: 'Hiç doğrulanmadı' }
  const days = Math.floor((now - person.sonDogrulamaTs) / DAY_MS)
  if (days < FRESH_DAYS) return { level: 'green', label: 'Güncel' }
  if (days < STALE_DAYS) return { level: 'yellow', label: `${days} gündür kontrol edilmedi` }
  return { level: 'red', label: '1 yıldan uzun süredir kontrol edilmedi' }
}

export const searchText = (person: Person) =>
  `${person.name ?? ''} ${person.prefix ?? ''} ${person.title ?? ''} ${person.unit ?? ''}`.toLocaleLowerCase('tr')

const MAX_PHOTO_DATA_URL_LENGTH = 2 * 1024 * 1024

/** Yalnızca http(s) ve makul boyuttaki data:image adreslerine izin verilir. */
export function safePhotoUrl(url?: string): string {
  const value = (url ?? '').trim()
  if (/^https?:\/\//i.test(value)) return value
  if (/^data:image\//i.test(value) && value.length <= MAX_PHOTO_DATA_URL_LENGTH) return value
  return ''
}

export function formatDateKey(key?: string): string {
  if (!key) return '—'
  const [y, m, d] = key.split('-')
  return y && m && d ? `${d}.${m}.${y}` : key
}

export const PREFIX_OPTIONS = ['Prof. Dr.', 'Doç. Dr.', 'Dr. Öğr. Üyesi', 'Dr.', 'Av.', 'Öğr. Gör.', 'Arş. Gör.', 'Uzm.'] as const

export const VERIFICATION_SOURCES: Record<string, string> = {
  omu_web: 'OMÜ Web Sitesi',
  kullanici_girisi: 'Kullanıcı Girişi',
  resmi_yazi: 'Resmî Yazı',
  manuel: 'Manuel Doğrulama',
}

export const UNIVERSITY_PROTOCOL_TITLES = [
  'Rektör', 'Rektör Yardımcıları', 'Genel Sekreter', 'Fakülte Dekanları', 'Enstitü ve Yüksekokul Müdürleri',
  'Dekan Yardımcıları ve Müdür Yardımcıları', 'Profesörler', 'Doçentler', 'Doktor Öğretim Üyeleri',
  'Bölüm Başkanları ve Anabilim Dalı Başkanları', 'Öğretim Görevlileri ve Araştırma Görevlileri', 'Daire Başkanları',
] as const

export const UNIVERSITY_DEFAULT_UNIT = 'Ondokuz Mayıs Üniversitesi'

export const COORDINATION_ITEMS: readonly string[] =
  FACULTY_GROUPS.find((group) => group.title === 'Koordinatörlükler')?.items ?? []

export const personLabel = (person: Person) =>
  [person.title, person.prefix, person.name].map((part) => (part ?? '').trim()).filter(Boolean).join(' ')

export function toPeopleList(records: Record<string, PersonRecord | null> | PersonRecord[] | null): Person[] {
  if (!records) return []
  const entries = Array.isArray(records) ? records.map((record, i) => [String(i), record] as const) : Object.entries(records)
  return entries.flatMap(([id, record]) => (record && typeof record === 'object' ? [{ ...record, _id: id }] : []))
}
