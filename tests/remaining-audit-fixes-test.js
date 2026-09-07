const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const calendar = read('docs/admin-src/src/v4/calendar.js');
const modal = read('docs/admin-src/src/v4/modal.js');
const gantt = read('docs/admin-src/src/v4/gantt.js');
const settings = read('docs/admin-src/production/ayarlar.html');
const quickEvent = read('docs/admin-src/src/v4/quick-event.js');
const dbMode = read('docs/admin-src/src/v4/db-mode.js');
const palette = read('docs/admin-src/src/v4/command-palette.js');
const packageJson = JSON.parse(read('docs/admin-src/package.json'));

assert.match(calendar, /openedUpdateTs = ev\?\.guncellemeTs \?\? null/);
assert.match(calendar, /persistEvent\(id, patch, logLabel, id \? openedUpdateTs : undefined\)/);
assert.match(calendar, /action: async \(\{ body \}\)/);
assert.match(calendar, /if \(!res\) \{ return false; \}/);
assert.match(calendar, /patch\.bitisTarihi = dKey\(addDays\(newStart, dayDiff\(oldStart, oldEnd\)\)\)/);
assert.match(calendar, /ev\?\.durum === 'tamamlandi'/);
assert.match(modal, /await a\.action\(ctx\)/);

assert.match(gantt, /openedProjectSnapshot = project \? JSON\.parse/);
assert.match(gantt, /nextEvent\?\.projeId && nextEvent\.projeId !== id/);
assert.match(gantt, /nextEvent\?\.locked && eventDatesWouldChange/);
assert.match(gantt, /return \{ tarih: localDateKey\(addDays\(nextEnd, -duration\)\), bitisTarihi: projectEndKey \}/);
assert.match(gantt, /targetDate\.getFullYear\(\) !== anchor\.getFullYear\(\)/);

for (const dataPath of ['ilProtokolVerileri', 'universiteProtokolVerileri', 'etkinlikler', 'haberProjeleri']) {
  assert.match(settings, new RegExp("database\\.ref\\(dbPath\\('" + dataPath + "'\\)\\)"));
}
for (const preservedField of ['prevStatus', 'sonDogrulamaTs', 'dogrulamaKaynak', 'dogrulayan', 'bitisTarihi', 'projeId', 'taslak', 'tamamlayanEmail']) {
  assert.match(settings, new RegExp(preservedField));
}
assert.match(settings, /Salt-okunur kilit açıkken JSON içe aktarılamaz/);
assert.match(quickEvent, /await initDbMode\(database\)/);
assert.match(dbMode, /auth\.onAuthStateChanged/);
assert.match(palette, /await auth\.signOut\(\)/);

for (const removedScript of ['new', 'screenshots', 'smoke', 'deploy:preview']) {
  assert.equal(packageJson.scripts[removedScript], undefined);
}
assert.equal(fs.existsSync(path.join(root, 'docs/admin-src/src/v4/data-adapter.js')), false);
assert.equal(fs.existsSync(path.join(root, 'tests/package-lock.json')), true);

console.log('PASS: kalan denetim bulguları için kaynak ve yapılandırma korumaları');
