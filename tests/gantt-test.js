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
assert.match(source, /etkinlikler\/\$\{next\.takvimEtkinlikId\}\/tarih/,
  'bağlı takvim etkinliğinin teslim tarihi eşlenmelidir');
assert.match(source, /isReadOnly\(\)/,
  'salt-okunur kilit Gantt yazmalarını engellemelidir');
assert.match(source, /haberProjeleri\/\$\{id\}\/guncellemeTs/,
  'eşzamanlı değişiklikler sürüm alanıyla kontrol edilmelidir');
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
  }
}

console.log('PASS: ayrı Gantt sekmesi, veri modeli ve takvim bağlantısı');
