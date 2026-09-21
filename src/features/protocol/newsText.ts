// Haber metni üretimi: Türkçe hâl ekleri, şablonlar ve yapay zekâ komutu (hiçbir servise bağlanmaz).
import type { Person } from './protocolRules'
import { compareForNews, personLabel } from './protocolRules'

type NewsContext = Record<string, string>

interface Variant {
  text: string
  condition?: (ctx: NewsContext) => boolean
}

export interface NewsTemplate {
  id: string
  name: string
  text?: string
  paragraphs?: Variant[][]
}

// ---- Türkçe ekler --------------------------------------------------------------------------
// "TBMM" gibi tamamen büyük harfli kısaltmalarda ek, son harfin OKUNUŞUNA göre seçilir (em → TBMM'nin).
const ABBR_LETTER_VOWEL: Record<string, string> = {
  A: 'a', B: 'e', C: 'e', Ç: 'e', D: 'e', E: 'e', F: 'e', G: 'e', Ğ: 'e', H: 'e', I: 'ı', İ: 'i', J: 'e', K: 'e', L: 'e',
  M: 'e', N: 'e', O: 'o', Ö: 'ö', P: 'e', Q: 'e', R: 'e', S: 'e', Ş: 'e', T: 'e', U: 'u', Ü: 'ü', V: 'e', W: 'e', X: 'e', Y: 'e', Z: 'e',
}
const VOWELS = 'aeıioöuü'

const abbreviationVowel = (token: string) =>
  /^[A-ZÇĞİÖŞÜ]{2,}$/.test(token) ? (ABBR_LETTER_VOWEL[token[token.length - 1]] ?? null) : null

const lowerTr = (ch: string) => (ch === 'İ' ? 'i' : ch === 'I' ? 'ı' : ch.toLocaleLowerCase('tr-TR'))

function lastVowelOf(text: string): string {
  for (let i = text.length - 1; i >= 0; i -= 1) {
    const ch = lowerTr(text[i])
    if (VOWELS.includes(ch)) return ch
  }
  return ''
}

function narrowVowel(vowel: string): string {
  if (!vowel || 'aı'.includes(vowel)) return 'ı'
  if ('ei'.includes(vowel)) return 'i'
  if ('ou'.includes(vowel)) return 'u'
  return 'ü'
}

function suffixBase(word: string) {
  const text = word.trim()
  const words = text.split(/\s+/)
  const last = words[words.length - 1]
  const abbr = abbreviationVowel(last)
  const lastCh = lowerTr(last[last.length - 1])
  return {
    text,
    vowel: abbr ?? lastVowelOf(last),
    endsWithVowel: abbr !== null || VOWELS.includes(lastCh),
    // "…Başkanlığı", "…Merkezi" gibi iyelik ekli tamlamalarda kaynaştırma n, düz sözcükte y.
    buffer: words.length > 1 && 'ıiuü'.includes(lastCh) ? 'n' : 'y',
  }
}

/** İlgi hâli: "Rektör Prof. Dr. Ahmet Yılmaz'ın". */
export function genitive(fullName: string): string {
  const name = fullName.trim()
  if (!name) return name
  const words = name.split(/\s+/)
  const abbr = abbreviationVowel(words[words.length - 1])
  const vowel = narrowVowel(abbr ?? lastVowelOf(name))
  const endsWithVowel = abbr !== null || VOWELS.includes(lowerTr(name[name.length - 1]))
  return `${name}'${endsWithVowel ? 'n' : ''}${vowel}n`
}

/** Yönelme hâli (-a/-e). */
export function dative(word: string): string {
  if (!word.trim()) return ''
  const base = suffixBase(word)
  const ending = base.vowel && 'aıou'.includes(base.vowel) ? 'a' : 'e'
  return base.endsWithVowel ? `${base.text}'${base.buffer}${ending}` : `${base.text}'${ending}`
}

/** Belirtme hâli (-ı/-i/-u/-ü). */
export function accusative(word: string): string {
  if (!word.trim()) return ''
  const base = suffixBase(word)
  const ending = narrowVowel(base.vowel)
  return base.endsWithVowel ? `${base.text}'${base.buffer}${ending}` : `${base.text}'${ending}`
}

// ---- Şablonlar -------------------------------------------------------------------------------
const has = (key: string) => (ctx: NewsContext) => !!ctx[key]

export const NEWS_TEMPLATES: NewsTemplate[] = [
  { id: 'serbest', name: 'Serbest / Genel', text: '{yer} {kisiler}{gruplar} katıldı.' },
  { id: 'acilis', name: 'Açılış Töreni', text: '{yer} düzenlenen {etkinlik} açılış törenine {kisiler}{gruplar} katıldı.' },
  { id: 'konferans', name: 'Konferans', text: '{yer} gerçekleştirilen “{etkinlik}” başlıklı konferansa {kisiler}{gruplar} katıldı.' },
  { id: 'panel', name: 'Panel', text: '{yer} gerçekleştirilen “{etkinlik}” başlıklı panele {kisiler}{gruplar} katıldı.' },
  { id: 'calistay', name: 'Çalıştay', text: '{yer} gerçekleştirilen “{etkinlik}” başlıklı çalıştaya {kisiler}{gruplar} katıldı.' },
  {
    id: 'ziyaret',
    name: 'Protokol Ziyareti',
    paragraphs: [
      [
        { text: '{yer} gerçekleştirilen ziyarette {kisiler} hazır bulundu.' },
        { text: '{kisiler}, {yer} bir ziyaret gerçekleştirdi.' },
        { text: '{ilkKisiIn} başkanlığındaki heyet {yer} bir araya geldi.', condition: has('digerKisiler') },
      ],
      [
        { text: 'Ziyarette {aciklama} konusu ele alındı.', condition: has('aciklama') },
        { text: 'Görüşmede {aciklama} gündeme geldi.', condition: has('aciklama') },
        { text: 'Taraflar, {aciklama} hakkında görüş alışverişinde bulundu.', condition: has('aciklama') },
      ],
      [
        { text: 'Ziyareti {evSahibi} kabul etti.', condition: has('evSahibi') },
        { text: 'Heyeti makamında kabul eden {evSahibi}, misafirlerine ilgisinden dolayı teşekkür etti.', condition: has('evSahibi') },
        { text: '{evSahibi}, ziyaretten duyduğu memnuniyeti dile getirdi.', condition: has('evSahibi') },
      ],
    ],
  },
  { id: 'imza', name: 'Protokol İmza Töreni', text: '{yer} düzenlenen protokol imza töreninde {kisiler} bir araya geldi.' },
  { id: 'mezuniyet', name: 'Mezuniyet Töreni', text: '{yer} düzenlenen {etkinlik} mezuniyet törenine {kisiler}{gruplar} katıldı.' },
  { id: 'odul', name: 'Ödül Töreni', text: '{yer} düzenlenen ödül törenine {kisiler}{gruplar} katıldı.' },
  { id: 'basin', name: 'Basın Toplantısı', text: '{yer} düzenlenen basın toplantısına {kisiler} katıldı.' },
  { id: 'sergi', name: 'Sergi / Kültür-Sanat', text: '{yer} açılan “{etkinlik}” başlıklı sergiye {kisiler}{gruplar} katıldı.' },
  { id: 'konser', name: 'Konser', text: '{yer} düzenlenen {etkinlik} konserine {kisiler}{gruplar} katıldı.' },
  { id: 'spor', name: 'Spor Etkinliği', text: '{yer} düzenlenen {etkinlik} spor etkinliğine {kisiler}{gruplar} katıldı.' },
  { id: 'akademikbasari', name: 'Akademik Başarı', text: '{kisiler}{gruplar}, {etkinlik} kapsamında elde ettiği akademik başarıyla gurur yaşattı.' },
  { id: 'kariyer', name: 'Kariyer Etkinliği', text: '{yer} düzenlenen {etkinlik} kariyer etkinliğine {kisiler}{gruplar} katıldı.' },
  { id: 'topluluk', name: 'Öğrenci Toplulukları', text: '{yer} düzenlenen {etkinlik} öğrenci toplulukları etkinliğine {kisiler}{gruplar} katıldı.' },
  { id: 'saglik', name: 'Sağlık Etkinliği', text: '{yer} düzenlenen {etkinlik} sağlık etkinliğine {kisiler}{gruplar} katıldı.' },
  { id: 'uluslararasi', name: 'Uluslararası Etkinlik', text: '{yer} düzenlenen “{etkinlik}” başlıklı uluslararası etkinliğe {kisiler}{gruplar} katıldı.' },
  { id: 'yesiluniversite', name: 'Yeşil Üniversite', text: 'Yeşil Üniversite kapsamında {yer} düzenlenen {etkinlik} etkinliğine {kisiler}{gruplar} katıldı.' },
  { id: 'toplanti', name: 'Toplantı', text: '{yer} gerçekleştirilen {etkinlik} toplantısına {kisiler}{gruplar} katıldı.' },
  { id: 'bayram', name: 'Ulusal ve Resmî Bayramlar', text: '{yer} düzenlenen {etkinlik} kutlamasına {kisiler}{gruplar} katıldı.' },
  { id: 'altyazi', name: 'Fotoğraf Alt Yazısı', text: 'Fotoğrafta soldan sağa; {kisilerDuz} yer alıyor.' },
  {
    id: 'gorevdegisimi',
    name: 'Görev Değişimi',
    paragraphs: [
      [
        // Birim ve görev çoğu zaman aynı değerdir; tekrar olmasın diye hiçbir varyant ikisini birlikte kullanmaz.
        { text: '{yeniGorevli}, {gorevDat} atandı.', condition: has('gorev') },
        { text: '{yeniGorevli}, {gorevDat} getirildi.', condition: has('gorev') },
        { text: '{birimIn} kadrosuna katılan {yeniGorevli}, yeni görevine başladı.', condition: has('birim') },
        { text: '{yeniGorevli} yeni görevine başladı.' },
      ],
      [
        { text: '{yeniGorevliIn} yeni görevinde başarılı olması temenni edildi.' },
        { text: '{yeniGorevli}, yeni görevinde üniversitemize katkılar sunmaya devam edecek.' },
        { text: '{yeniGorevliDat} yeni görevinde başarılar dilendi.' },
      ],
      [
        { text: 'Önceki dönemde bu görevi yürüten {eskiGorevliDat} yeni görevinde başarılar dilendi.', condition: has('eskiGorevli') },
        { text: '{eskiGorevliIn} ardından bu göreve {yeniGorevli} atandı.', condition: has('eskiGorevli') },
        { text: '{birim} bünyesinde uzun süre görev yapan {eskiGorevliAcc} uğurlandı.', condition: (ctx) => !!ctx.eskiGorevli && !!ctx.birim },
      ],
    ],
  },
]

export const NEWS_PLACEHOLDER_FIELDS = [
  { key: 'etkinlik', label: 'Etkinlik adı' },
  { key: 'birim', label: 'Birim' },
  { key: 'aciklama', label: 'Görüşme konusu / açıklama (opsiyonel)' },
  { key: 'evSahibi', label: 'Ev sahibi (opsiyonel)' },
  { key: 'yeniGorevli', label: 'Yeni görevli' },
  { key: 'eskiGorevli', label: 'Önceki görevli (varsa)' },
  { key: 'gorev', label: 'Görev / unvan' },
] as const

export const NEWS_CATEGORIES = [
  { value: 'öğrenci', label: 'Öğrenci' },
  { value: 'akademisyen', label: 'Akademisyen' },
  { value: 'idari personel', label: 'İdari Personel' },
  { value: 'vatandaş', label: 'Vatandaş' },
  { value: 'davetli', label: 'Davetli' },
] as const

const templateSource = (template: NewsTemplate) =>
  template.text ?? (template.paragraphs ?? []).flat().map((variant) => variant.text).join(' ')

/** Şablonun kullandığı giriş alanları ({birimIn} gibi türetilmiş hâller de sayılır). */
export function templateFields(template: NewsTemplate) {
  const tokens = (templateSource(template).match(/\{(\w+)\}/g) ?? []).map((token) => token.slice(1, -1))
  return NEWS_PLACEHOLDER_FIELDS.filter((field) => tokens.some((token) => token.startsWith(field.key)))
}

function fillTemplate(text: string, ctx: NewsContext): string {
  return text
    .replace(/\{(\w+)\}/g, (_, key: string) => ctx[key] ?? '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +([,.;:])/g, '$1')
    .trim()
}

// Varyant her tuş vuruşunda değişmesin diye deterministik seçilir.
function stringHash(text: string): number {
  let hash = 0
  for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0
  return Math.abs(hash)
}

function renderTemplate(template: NewsTemplate, ctx: NewsContext): string {
  if (!template.paragraphs) return fillTemplate(template.text ?? '', ctx)
  return template.paragraphs
    .map((group, index) => {
      const usable = group.filter((variant) => !variant.condition || variant.condition(ctx))
      if (!usable.length) return ''
      const variant = usable[stringHash(`${ctx.ilkKisi}|${ctx.yer}|${index}`) % usable.length]
      return fillTemplate(variant.text, ctx)
    })
    .filter(Boolean)
    .join('\n\n')
}

export interface NewsOptions {
  templateId: string
  location: string
  categories: string[]
  fields: Record<string, string>
}

function joinCategories(categories: string[]): string {
  if (categories.length <= 1) return categories[0] ?? ''
  return `${categories.slice(0, -1).join(', ')} ve ${categories[categories.length - 1]}`
}

export function buildNewsText(people: Person[], options: NewsOptions): string {
  const labels = [...people].sort(compareForNews).map(personLabel)
  const first = labels[0] ?? ''
  const rest = labels.slice(1).join(', ')
  const field = (key: string) => (options.fields[key] ?? '').trim()
  const categoryList = joinCategories(options.categories)

  const ctx: NewsContext = {
    kisiler: labels.length > 1 ? `${genitive(first)} yanı sıra ${rest}` : first,
    kisilerDuz: labels.join(', '),
    ilkKisi: first,
    ilkKisiIn: genitive(first),
    digerKisiler: rest,
    yer: options.location.trim() || 'Törene',
    gruplar: categoryList ? ` ile çok sayıda ${categoryList}` : '',
    etkinlik: field('etkinlik'),
    birim: field('birim'),
    birimIn: field('birim') ? genitive(field('birim')) : '',
    tarih: '',
    aciklama: field('aciklama'),
    evSahibi: field('evSahibi'),
    yeniGorevli: field('yeniGorevli'),
    yeniGorevliIn: field('yeniGorevli') ? genitive(field('yeniGorevli')) : '',
    yeniGorevliDat: dative(field('yeniGorevli')),
    eskiGorevli: field('eskiGorevli'),
    eskiGorevliIn: field('eskiGorevli') ? genitive(field('eskiGorevli')) : '',
    eskiGorevliDat: dative(field('eskiGorevli')),
    eskiGorevliAcc: accusative(field('eskiGorevli')),
    gorev: field('gorev'),
    gorevDat: dative(field('gorev')),
  }

  const template = NEWS_TEMPLATES.find((item) => item.id === options.templateId) ?? NEWS_TEMPLATES[0]
  return renderTemplate(template, ctx)
}

// ---- Yapay zekâ komutu ------------------------------------------------------------------------
export const PROMPT_CATEGORIES = [
  { value: 'mezuniyet', label: 'Mezuniyet Töreni' },
  { value: 'genel', label: 'Genel Etkinlik (taslak var)' },
  { value: 'diger', label: 'Diğer' },
] as const

const PROMPT_COMMON_RULES = [
  'Yalnızca aşağıda verilen bilgileri kullan; belirtilmeyen hiçbir ayrıntıyı (kişi, tarih, sayı, konu vb.) uydurma veya varsayma.',
  'Bir bilgi verilmemişse o konudan hiç bahsetme; genel geçer/klişe ifadelerle doldurma yapma.',
  'Resmî kurum haberi diline uygun, sade ve nesnel bir üslup kullan.',
  'Kişi isim ve unvanlarını verildiği şekliyle birebir koru.',
]

const PROMPT_RULES: Record<string, string> = {
  mezuniyet: 'Bu bir mezuniyet töreni haberi. Konuşma yapan kişilerin isim/unvanlarını ve varsa alıntılanan sözlerini olduğu gibi koru; uydurma alıntı ekleme. Varsa tören sırasını (konuşmalar, diploma töreni vb.) kronolojik anlat.',
  genel: 'Bu, taslak hâlinde bir haber metnidir. Verilen taslağın anlamını ve içeriğini koruyarak resmî/kurumsal haber diline uygun şekilde yeniden düzenle; taslakta olmayan hiçbir bilgiyi ekleme.',
  diger: 'Verilen notlardan resmî/kurumsal üslupta bir haber metni oluştur.',
}

export function buildNewsPrompt(people: Person[], category: string, rawNotes: string): string {
  const lines = ['Aşağıdaki bilgilerden, üniversitemiz basın ofisi için resmî bir haber metni oluştur.', '', 'KURALLAR:']
  PROMPT_COMMON_RULES.forEach((rule) => lines.push(`- ${rule}`))
  if (PROMPT_RULES[category]) lines.push(`- ${PROMPT_RULES[category]}`)
  lines.push('', 'BAĞLAM:')
  if (people.length) lines.push(`- Katılımcılar: ${[...people].sort(compareForNews).map(personLabel).join(', ')}`)
  lines.push('', 'HAM NOTLAR:', rawNotes.trim())
  return lines.join('\n')
}
