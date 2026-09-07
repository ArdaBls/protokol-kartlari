const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const main = read('docs/admin-src/src/main-v4.js');
assert.doesNotMatch(main, /document\.addEventListener\('submit'/,
  'gerçek formları sıfırlayan belge seviyesinde sahte-submit dinleyicisi bulunmamalıdır');

for (const relativePath of [
  'docs/admin-src/production/haber-detayi.html',
  'docs/admin-src/production/tum-haberler.html'
]) {
  const html = read(relativePath);
  assert.match(html, /escapeHtml\(DURUM_LABEL\[durum\] \|\| durum\)/,
    `${relativePath}: Firebase durum etiketi HTML-escape edilmelidir`);
  assert.match(html, /from '\/src\/v4\/db-mode\.js'/,
    `${relativePath}: Test Modu modülünü kullanmalıdır`);
}
assert.match(read('docs/admin-src/production/haber-detayi.html'),
  /const id = safeEventId\(new URLSearchParams\(location\.search\)\.get\('id'\)\)/,
  'haber detayı URL içindeki Firebase etkinlik kimliğini kullanmadan önce doğrulamalıdır');

const modeAwareChecks = {
  'docs/admin-src/production/haber-detayi.html': ["dbPath('etkinlikler/' + id)", "dbPath('logs/etkinlik')"],
  'docs/admin-src/production/tum-haberler.html': ["dbPath('etkinlikler/' + id)", "dbPath('logs/etkinlik')"],
  'docs/admin-src/production/harita.html': ["dbPath('etkinlikler')"],
  'docs/admin-src/production/profil.html': ["dbPath('etkinlikler')"],
  'docs/admin-src/production/kisiler.html': ["dbPath('etkinlikler')"],
  'docs/admin-src/production/bildirimler.html': ["dbPath('logs/etkinlik')"],
  'docs/admin-src/production/kullanici-yonetimi.html': ["dbPath('basinGorevlileri/' + uid)"]
};
for (const [relativePath, needles] of Object.entries(modeAwareChecks)) {
  const source = read(relativePath);
  for (const needle of needles) {
    assert.ok(source.includes(needle), `${relativePath}: ${needle} kullanılmalıdır`);
  }
}

const calendar = read('docs/admin-src/src/v4/calendar.js');
const roster = read('docs/admin-src/src/v4/roster.js');
assert.ok(calendar.includes("dbPath('universiteProtokolVerileri')"));
assert.ok(calendar.includes("dbPath('ilProtokolVerileri')"));
assert.ok(roster.includes("dbPath('basinGorevlileri')"));

const localRulesPath = path.join(root, 'yerel-notlar/firebase-database-rules.json');
if (fs.existsSync(localRulesPath)) {
  const rules = JSON.parse(fs.readFileSync(localRulesPath, 'utf8')).rules;
  for (const logRule of [rules.logs.$listKey.$logId, rules.test.logs.$listKey.$logId]) {
    assert.match(logRule['.write'], /!data\.exists\(\) && newData\.exists\(\)/,
      'işlem günlüğü yalnızca yeni kayıt eklemeye izin vermelidir');
    assert.match(logRule['.validate'], /auth\.token\.email/,
      'işlem günlüğü yazarı oturum e-postasıyla doğrulanmalıdır');
  }
  assert.match(rules.users.$uid['.write'], /newData\.exists\(\)/,
    'kullanıcıların kendi hesap kaydını silmesi engellenmelidir');
  assert.match(rules.users.$uid['.write'], /data\.child\('role'\)\.val\(\) !== 'owner'/,
    'owner kaydının yönetici tarafından silinmesi engellenmelidir');
}

const pkg = JSON.parse(read('docs/admin-src/package.json'));
assert.doesNotMatch(pkg.scripts.build, /^NODE_ENV=/, 'Windows build POSIX ortam değişkenine bağlı olmamalıdır');
assert.match(pkg.scripts.build, /--mode production/);

console.log('PASS: ilk paket güvenlik, Test Modu ve build korumaları');
