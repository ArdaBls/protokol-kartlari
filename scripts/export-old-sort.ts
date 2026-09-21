// Eski app.js'teki sıralama kodunu DEĞİŞTİRMEDEN tarayıcıda çalışacak geçici bir modüle çıkarır.
// Gerçek (oturum gerektiren) veriyle karşılaştırma yapılıp dosya hemen silinir.
import { readFileSync, writeFileSync } from 'node:fs'

const source = readFileSync('C:/Users/bilas/Documents/GitHub/protokol-kartlari/docs/app.js', 'utf8')

function sliceBetween(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start)
  if (start === -1 || end === -1) throw new Error(`Eski kodda işaret bulunamadı: ${startMarker}`)
  return source.slice(start, end)
}

const weightsCode = sliceBetween('const PREFIX_WEIGHTS', '// ---- KİŞİ DEPOLAMA MODELİ')
const renderSortBody = sliceBetween('list.sort((a,b) => {', 'const grid = document.getElementById("grid");')
const newsSortBody = sliceBetween('selectedPeople.sort((a,b) => {', 'let textArray = selectedPeople.map')

writeFileSync(
  'public/__old-sort.js',
  `${weightsCode}
const q = "";
export function renderSort(list) { ${renderSortBody}; return list; }
export function newsSort(selectedPeople) { ${newsSortBody}; return selectedPeople; }
export { getHierarchyWeight, getInstitutionWeight };
`,
)
console.log('public/__old-sort.js yazıldı')
