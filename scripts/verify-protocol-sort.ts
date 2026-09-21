// Eski panelin (protokol-kartlari/docs/app.js) protokol sıralama fonksiyonlarını KAYNAK DOSYADAN birebir
// okuyup yeni koddaki karşılıklarıyla karşılaştırır. Çalıştırma: node scripts/verify-protocol-sort.ts
import { readFileSync } from 'node:fs'
import {
  compareByProtocol, compareForNews, hierarchyWeight, institutionWeight, type Person,
} from '../src/features/protocol/protocolRules.ts'

const OLD_APP_JS = 'C:/Users/bilas/Documents/GitHub/protokol-kartlari/docs/app.js'
const DATABASE_URL = 'https://omu-protokol-default-rtdb.europe-west1.firebasedatabase.app'
const FUZZ_LISTS = 400
const FUZZ_LIST_SIZE = 60

const source = readFileSync(OLD_APP_JS, 'utf8')

function sliceBetween(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start)
  if (start === -1 || end === -1) throw new Error(`Eski kodda işaret bulunamadı: ${startMarker}`)
  return source.slice(start, end)
}

// PREFIX_WEIGHTS … sortAttendeesByProtocol: unvan katmanı, kurum ağırlığı ve katılımcı sırası (değiştirilmeden alınır).
const weightsCode = sliceBetween('const PREFIX_WEIGHTS', '// ---- KİŞİ DEPOLAMA MODELİ')
// render() içindeki ana liste karşılaştırıcısı.
const renderSortBody = sliceBetween('list.sort((a,b) => {', 'const grid = document.getElementById("grid");')
// generateNewsText() içindeki haber sırası karşılaştırıcısı.
const newsSortBody = sliceBetween('selectedPeople.sort((a,b) => {', 'let textArray = selectedPeople.map')

const old = new Function(`
  ${weightsCode}
  const q = "";
  function renderSort(list) { ${renderSortBody}; return list; }
  function newsSort(selectedPeople) { ${newsSortBody}; return selectedPeople; }
  return { getHierarchyWeight, getInstitutionWeight, renderSort, newsSort };
`)() as {
  getHierarchyWeight: (p: Person) => number
  getInstitutionWeight: (p: Person) => number
  renderSort: (list: Person[]) => Person[]
  newsSort: (list: Person[]) => Person[]
}

const ids = (list: Person[]) => list.map((p) => p._id).join(',')
let failures = 0
let checks = 0

function assertSameOrder(label: string, input: Person[]) {
  checks += 1
  const expectedMain = ids(old.renderSort([...input]))
  const actualMain = ids([...input].sort(compareByProtocol))
  if (expectedMain !== actualMain) {
    failures += 1
    console.error(`✗ ANA LİSTE sırası farklı: ${label}\n  eski: ${expectedMain}\n  yeni: ${actualMain}`)
  }
  const expectedNews = ids(old.newsSort([...input]))
  const actualNews = ids([...input].sort(compareForNews))
  if (expectedNews !== actualNews) {
    failures += 1
    console.error(`✗ HABER sırası farklı: ${label}\n  eski: ${expectedNews}\n  yeni: ${actualNews}`)
  }
  input.forEach((person) => {
    if (old.getHierarchyWeight(person) !== hierarchyWeight(person) || old.getInstitutionWeight(person) !== institutionWeight(person)) {
      failures += 1
      console.error(`✗ Ağırlık farklı (${label}): ${JSON.stringify(person)}`)
    }
  })
}

// ---- 1) Gerçek veri: oturum açık tarayıcıdan alınmış dışa aktarım dosyası (argüman) ya da herkese açık GET ----
const exportFile = process.argv[2]
const exported = exportFile ? (JSON.parse(readFileSync(exportFile, 'utf8')) as Record<string, Person[]>) : null

async function checkLiveList(path: string) {
  let people: Person[]
  if (exported) {
    people = exported[path] ?? []
  } else {
    const response = await fetch(`${DATABASE_URL}/${path}.json`)
    if (!response.ok) {
      console.warn(`! ${path} okunamadı (HTTP ${response.status}) — dışa aktarım dosyası verin`)
      return
    }
    const raw = (await response.json()) as Record<string, Omit<Person, '_id'> | null> | null
    people = Object.entries(raw ?? {}).flatMap(([id, p]) => (p && typeof p === 'object' ? [{ ...p, _id: id }] : []))
  }
  assertSameOrder(`${path} (${people.length} kayıt)`, people)
  // Firebase'den gelen sıra deterministik olmayabilir: karıştırılmış kopyalarla da denenir.
  for (let i = 0; i < 20; i += 1) assertSameOrder(`${path} karıştırılmış #${i}`, shuffle(people))
  console.log(`✓ ${path}: ${people.length} gerçek kayıt kontrol edildi`)
}

// ---- 2) Rastgele uç durumlar ----
const TITLES = ['Rektör', 'Rektör Yardımcısı', 'Vali', 'Vali Yardımcısı', 'Milletvekili', 'Garnizon Komutanı', 'Büyükşehir Belediye Başkanı',
  'İlçe Belediye Başkanı', 'Belediye Başkanı', 'Cumhuriyet Başsavcısı', 'Baro Başkanı', 'Kaymakam', 'Dekan', 'Dekan V.', 'Dekan Vekili',
  'Dekan Yardımcısı', 'Enstitü Müdürü', 'Enstitü Müdür Yardımcısı', 'Yüksekokul Müdürü', 'Müdür Yardımcısı', 'Müdür', 'Genel Sekreter',
  'OMÜ Genel Sekreteri', 'Daire Başkanı', 'Bölüm Başkanı', 'Öğretim Görevlisi', 'Araştırma Görevlisi', 'Koordinatör', '', 'REKTÖR', 'İletişim Fakültesi Dekanı']
const PREFIXES = ['Prof. Dr.', 'Doç. Dr.', 'Dr. Öğr. Üyesi', 'Dr.', 'Öğr. Gör.', 'Arş. Gör.', 'Av.', 'Uzm.', '', undefined, 'Bilinmeyen']
const UNITS = ['Ondokuz Mayıs Üniversitesi', 'OMÜ Tıp Fakültesi', 'Samsun Üniversitesi', '', undefined, 'ondokuz mayıs üniversitesi - Fen', 'Valilik']
const RANKS = [1, 2, 3, 4, 5, 12, '', null, undefined, '7', 'abc', 0, 20]
const ORDERS = [1, 2, 3, '', null, undefined, '2', 10]
const NAMES = ['Ahmet Yılmaz', 'ahmet yılmaz', 'Çiğdem Öz', 'Ceren Aksoy', 'İsmail Işık', 'Ismail Isik', 'Şule Ünal', 'Zeynep', '', undefined]

let seed = 20260916
const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
const pick = <T,>(values: T[]): T => values[Math.floor(random() * values.length)]
function shuffle<T>(values: T[]): T[] {
  const copy = [...values]
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

for (let list = 0; list < FUZZ_LISTS; list += 1) {
  const people = Array.from({ length: FUZZ_LIST_SIZE }, (_, i) => ({
    _id: `p${list}-${i}`, title: pick(TITLES), prefix: pick(PREFIXES), unit: pick(UNITS),
    rank: pick(RANKS), order: pick(ORDERS), name: pick(NAMES),
  })) as Person[]
  assertSameOrder(`rastgele liste #${list}`, people)
}
console.log(`✓ ${FUZZ_LISTS} rastgele liste (${FUZZ_LISTS * FUZZ_LIST_SIZE} kişi) kontrol edildi`)

await checkLiveList('universiteProtokolVerileri')
await checkLiveList('ilProtokolVerileri')

console.log(failures === 0 ? `\nSONUÇ: ${checks} karşılaştırmanın hepsi eski kodla BİREBİR aynı.` : `\nSONUÇ: ${failures} FARK bulundu!`)
process.exitCode = failures === 0 ? 0 : 1
