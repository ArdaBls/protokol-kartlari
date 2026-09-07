const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const page = read('docs/admin-src/production/gantt.html');
const source = read('docs/admin-src/src/v4/gantt.js');
const shell = read('docs/admin-src/src/v4/shell-render.js');
const settings = read('docs/admin-src/production/ayarlar.html');

assert.match(page, /data-page="gantt"/);
assert.match(page, /id="gantt-board"/);
assert.match(page, /id="gantt-form"/);
assert.match(shell, /key: 'gantt'.*href: 'gantt\.html'/);
assert.match(shell, /'gantt',\s+\/\/ Haber Üretim Takvimi/);
assert.match(settings, /'basinGorevlileri', 'haberProjeleri'/,
  'Test Modu açılırken haber projeleri de test dalına kopyalanmalıdır');
assert.match(settings, /haberProjeleri: projeSnap\.val\(\)/,
  'tam veri yedeği haber projelerini de içermelidir');

assert.match(source, /dbPath\('haberProjeleri'\)/,
  'Gantt kayıtları Test Modu veri yolundan geçmelidir');
assert.match(source, /dbPath\(`haberProjeleri\/\$\{id\}/,
  'Proje güncellemeleri Test Modu veri yolundan geçmelidir');
assert.match(source, /database\.ref\('\/'\)\.update\(updates\)/,
  'proje ve takvim bağlantısı atomik çok-yollu güncellemeyle yazılmalıdır');
assert.match(source, /linkedEventDatePatch\(nextEvent, next\.bitisTarihi\)/,
  'bağlı takvim etkinliğinin teslim tarihi süre korunarak eşlenmelidir');
assert.match(source, /etkinlikler\/\$\{nextEventId\}\/\$\{key\}/,
  'bağlı takvim etkinliğinin tarih alanları atomik güncellemeye eklenmelidir');
assert.match(source, /isReadOnly\(\)/,
  'salt-okunur kilit Gantt yazmalarını engellemelidir');
assert.match(source, /haberProjeleri\/\$\{id\}\/guncellemeTs/,
  'eşzamanlı değişiklikler sürüm alanıyla kontrol edilmelidir');
assert.match(source, /data-toggle-project=/,
  'ana proje satırında alt adımları açıp kapatan akordeon bulunmalıdır');
assert.match(source, /project\.adimlar/,
  'alt üretim adımları proje hiyerarşisinden okunmalıdır');
assert.match(source, /data-step-status/,
  'üretim adımları kendi durum alanıyla düzenlenebilmelidir');
assert.match(source, /loadPressOfficerPool/,
  'sorumlu seçimi ortak basın görevlisi havuzundan yüklenmelidir');
assert.match(page, /id="gantt-owner-picker"/,
  'sorumlu alanı serbest metin yerine seçim bileşeni olmalıdır');
assert.match(source, /sorumlu: ownerValue/,
  'seçilen sorumlu form kaydına yazılmalıdır');
assert.doesNotMatch(source, /innerHTML\s*=.*project\.ad/,
  'Firebase kullanıcı metni doğrudan innerHTML içine yazılmamalıdır');

const localRulesPath = path.join(root, 'yerel-notlar/firebase-database-rules.json');
if (fs.existsSync(localRulesPath)) {
  const rules = JSON.parse(fs.readFileSync(localRulesPath, 'utf8')).rules;
  for (const projectRules of [rules.haberProjeleri, rules.test.haberProjeleri]) {
    assert.ok(projectRules, 'canlı ve test haberProjeleri kuralları bulunmalıdır');
    assert.match(projectRules.$projectId['.validate'], /baslangicTarihi/);
    assert.match(projectRules.$projectId.bitisTarihi['.validate'], />= newData\.parent\(\)\.child\('baslangicTarihi'\)/);
    assert.match(projectRules.$projectId.ilerleme['.validate'], /<= 100/);
    assert.match(projectRules.$projectId.adimlar.$stepId['.validate'], /bitisTarihi/);
    assert.match(projectRules.$projectId.adimlar.$stepId.durum['.validate'], /tamamlandi/);
  }
}

console.log('PASS: ayrı Gantt sekmesi, veri modeli ve takvim bağlantısı');
