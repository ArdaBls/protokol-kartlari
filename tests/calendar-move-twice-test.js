// Regression for: "bir etkinliği farklı bir güne koyduktan sonra tekrar yerini
// değiştiremiyorum" -- persistEvent() eskiden yazdıktan sonra yerel önbelleğe
// (EVENTS[id]) sunucunun ürettiği GERÇEK guncellemeTs yerine istemcideki ESKİ
// değeri koyuyordu; bir sonraki taşımada iyimser-kilit kontrolü kendi az önceki
// yazmasını "başka biri değiştirmiş" sanıp engelliyordu (yanlış pozitif).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '../docs/admin-src');
const plain = (file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/export /g, '');

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setContent('<div id="calMainBody"></div>');
    await page.addScriptTag({ path: path.join(root, 'node_modules/sortablejs/Sortable.min.js') });
    await page.addScriptTag({ content: plain('src/v4/modal.js') });
    await page.addScriptTag({ content: `
      const notices = [];
      function showToast(message) { notices.push(message); }
      const dbPath = p => p, isReadOnly = () => false;
      const initDbMode = () => Promise.resolve(), renderDbModeBanner = () => {}, onDbModeChange = () => {};
      const facultyOptionsHtml = () => '', renderPersonRolesPickerHtml = () => '';
      const loadPressOfficerPoolShared = () => Promise.resolve([]);
      const state = { etkinlikler: {
        x: { ad:'Test etkinliği', tarih:'2026-09-07', saat:'09:00', bitisSaat:'10:00', tur:'toplanti', guncellemeTs: 50 }
      }, users: { qa: { role:'admin' } } };
      let tick = 100;
      const snap = p => ({ val: () => { const parts=p.split('/').filter(Boolean); let v=state; for(const k of parts) v=v?.[k]; return structuredClone(v ?? null); } });
      const db = { ref(p) { return {
        once: async () => snap(p),
        on: (_, fn) => fn(snap(p)), off: () => {}, push: () => ({key:'new'}),
        update: async updates => {
          for (const [key,value] of Object.entries(updates)) {
            const parts=key.split('/').filter(Boolean), leaf=parts.pop();
            let dest=state; for(const k of parts) dest=dest[k] ||= {};
            dest[leaf]=JSON.parse(JSON.stringify(value).replaceAll('"SERVER_TIMESTAMP"', String(++tick)));
          }
        }
      }; } };
      window.firebase = { apps:[{}], database: Object.assign(() => db,{ServerValue:{TIMESTAMP:'SERVER_TIMESTAMP'}}), auth: () => ({onAuthStateChanged: cb => cb({uid:'qa'})}) };
    ` });
    await page.addScriptTag({ content: plain('src/v4/calendar.js') + '\ninitCalendar();' });
    await page.waitForFunction(() => typeof canWrite !== 'undefined' && canWrite === true);

    // Birinci taşıma: Pazartesi -> Salı.
    await page.evaluate(async () => { await calMoveEvent('x', '2026-09-08', null); });
    assert.equal(await page.evaluate(() => state.etkinlikler.x.tarih), '2026-09-08', 'ilk taşıma başarısız olmamalı');
    assert.deepEqual(await page.evaluate(() => notices.filter((n) => n.includes('başka'))), [], 'ilk taşımada sahte çakışma uyarısı olmamalı');

    // İkinci taşıma -- BUG'DA burası sessizce engelleniyordu ("başka biri değiştirdi").
    await page.evaluate(async () => { await calMoveEvent('x', '2026-09-09', null); });
    assert.equal(await page.evaluate(() => state.etkinlikler.x.tarih), '2026-09-09', 'ikinci taşıma da başarılı olmalı (regresyon: eskiden engelleniyordu)');
    assert.deepEqual(await page.evaluate(() => notices.filter((n) => n.includes('başka'))), [], 'ikinci taşımada yanlış-pozitif çakışma uyarısı çıkmamalı');

    // Üçüncü taşıma -- zincirleme çalıştığını da doğrula.
    await page.evaluate(async () => { await calMoveEvent('x', '2026-09-10', null); });
    assert.equal(await page.evaluate(() => state.etkinlikler.x.tarih), '2026-09-10', 'üçüncü taşıma da başarılı olmalı');

    assert.deepEqual(errors, []);
    console.log('PASS: bir etkinlik art arda birden fazla kez taşınabiliyor (yanlış-pozitif çakışma yok)');
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
