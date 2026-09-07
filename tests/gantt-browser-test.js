const { chromium } = require('playwright');
const path = require('node:path');
const http = require('node:http');
const fs = require('node:fs');
const assert = require('node:assert/strict');

const TESTS_DIR = __dirname;
const SITE_ROOT = path.join(__dirname, '..', 'docs');
const PORT = 8992;

function serve() {
  const server = http.createServer((req, res) => {
    let requestPath = decodeURIComponent(req.url.split('?')[0]);
    if (requestPath === '/') { requestPath = '/gantt.html'; }
    const filePath = path.join(SITE_ROOT, requestPath);
    fs.readFile(filePath, (error, data) => {
      if (error) { res.writeHead(404); res.end('not found'); return; }
      const ext = path.extname(filePath);
      const contentType = ext === '.html' ? 'text/html' : ext === '.js' ? 'application/javascript' : ext === '.css' ? 'text/css' : 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(PORT, () => resolve(server)));
}

(async () => {
  const server = await serve();
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.route('**/firebasejs/**/firebase-app-compat.js', (route) => route.fulfill({ path: path.join(TESTS_DIR, 'mock-firebase.js'), contentType: 'application/javascript' }));
  await page.route('**/firebasejs/**/firebase-database-compat.js', (route) => route.fulfill({ body: '', contentType: 'application/javascript' }));
  await page.route('**/firebasejs/**/firebase-auth-compat.js', (route) => route.fulfill({ body: '', contentType: 'application/javascript' }));
  await page.route('**://fonts.googleapis.com/**', (route) => route.fulfill({ body: '', contentType: 'text/css' }));
  await page.route('**://fonts.gstatic.com/**', (route) => route.abort());
  await page.addInitScript(() => {
    window.__mockAuthUser = { uid: 'ganttUid', email: 'gantt@test.com', emailVerified: true };
    window.__mockUserProfile = { role: 'admin', firstName: 'Gantt', lastName: 'Test', email: 'gantt@test.com' };
    window.__mockData = {
      haberProjeleri: {
        proje1: {
          ad: 'Kampüs belgeseli', tur: 'ozel', durum: 'cekim', oncelik: 'kritik',
          baslangicTarihi: '2026-09-03', bitisTarihi: '2026-09-24', ilerleme: 55,
          sorumlu: 'Gantt Test', notlar: '', arsiv: false,
          adimlar: {
            adim1: { ad: 'Röportaj çekimi', durum: 'tamamlandi', baslangicTarihi: '2026-09-03', bitisTarihi: '2026-09-08', ilerleme: 100, sira: 0 },
            adim2: { ad: 'Video kurgusu', durum: 'yapiliyor', baslangicTarihi: '2026-09-09', bitisTarihi: '2026-09-20', ilerleme: 50, sira: 1 }
          }
        }
      },
      etkinlikler: {
        ev1: { ad: 'Belgesel yayını', tarih: '2026-09-30', durum: 'planlandi', arsiv: false }
      }
    };
  });

  try {
    await page.goto(`http://localhost:${PORT}/gantt.html`, { waitUntil: 'load', timeout: 30000 });
    await page.waitForSelector('.gantt-project-row', { timeout: 10000 });
    assert.equal(await page.locator('.gantt-parent-row').count(), 1);
    assert.equal(await page.locator('.gantt-step-row').count(), 2);
    assert.equal(await page.locator('.gantt-project-title').first().textContent().then((text) => text.trim()), 'Kampüs belgeseli');
    assert.equal(await page.locator('.nav-link.active[data-nav-key="gantt"]').count(), 1);
    assert.equal(await page.locator('.gantt-bar').count(), 3);
    await page.locator('[data-toggle-project="proje1"]').click();
    assert.equal(await page.locator('.gantt-step-row').count(), 0);
    assert.equal(await page.locator('[data-toggle-project="proje1"]').getAttribute('aria-expanded'), 'false');
    await page.locator('[data-toggle-project="proje1"]').click();
    assert.equal(await page.locator('.gantt-step-row').count(), 2);
    if (process.env.GANTT_SCREENSHOT) {
      await page.screenshot({ path: process.env.GANTT_SCREENSHOT, fullPage: false });
    }
    await page.evaluate(() => { window.__mockUpdates = []; });
    const stepBarBox = await page.locator('.gantt-bar--step').first().boundingBox();
    await page.mouse.move(stepBarBox.x + stepBarBox.width / 2, stepBarBox.y + stepBarBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(stepBarBox.x + stepBarBox.width / 2 + 38, stepBarBox.y + stepBarBox.height / 2, { steps: 3 });
    await page.mouse.up();
    await page.waitForFunction(() => Array.isArray(window.__mockUpdates) && window.__mockUpdates.length > 0);
    const stepMove = await page.evaluate(() => window.__mockUpdates.at(-1));
    assert.equal(stepMove.data['haberProjeleri/proje1/adimlar/adim1/baslangicTarihi'], '2026-09-04');
    assert.equal(stepMove.data['haberProjeleri/proje1/adimlar/adim1/bitisTarihi'], '2026-09-09');

    await page.locator('.gantt-parent-row .gantt-project-main[data-edit-project="proje1"]').click();
    await page.waitForSelector('#gantt-modal:not([hidden])');
    assert.equal(await page.locator('#gantt-title').inputValue(), 'Kampüs belgeseli');
    await page.locator('[data-gantt-close]').last().click();

    // Kalıcı silme: window.confirm onayı + haberProjeleri düğümünün null'a
    // yazılması + modalın kapanması.
    await page.evaluate(() => { window.__mockUpdates = []; });
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('.gantt-parent-row .gantt-project-main[data-edit-project="proje1"]').click();
    await page.waitForSelector('#gantt-modal:not([hidden])');
    await page.locator('#gantt-remove').click();
    await page.waitForFunction(() => Array.isArray(window.__mockUpdates) && window.__mockUpdates.length > 0);
    const deleteUpdate = await page.evaluate(() => window.__mockUpdates.at(-1));
    assert.equal(deleteUpdate.data['haberProjeleri/proje1'], null);
    assert.ok(Object.keys(deleteUpdate.data).some((key) => /^logs\/haberProje\//.test(key)));
    assert.equal(await page.locator('#gantt-modal').isHidden(), true);

    await page.locator('#gantt-new').click();
    await page.locator('#gantt-title').fill('Yeni özel haber');
    await page.locator('#gantt-start').fill('2026-09-10');
    await page.locator('#gantt-end').fill('2026-09-18');
    await page.locator('#gantt-owner').fill('Haber Ekibi');
    await page.locator('#gantt-add-step').click();
    await page.locator('[data-step-name]').last().fill('Metin yazımı');
    await page.locator('[data-step-status]').last().selectOption('yapiliyor');
    await page.locator('#gantt-event').selectOption('ev1');
    await page.locator('#gantt-form').evaluate((form) => form.requestSubmit());
    await page.waitForFunction(() => Array.isArray(window.__mockUpdates) && window.__mockUpdates.length > 0);
    const update = await page.evaluate(() => window.__mockUpdates.at(-1));
    assert.equal(update.path, '/');
    const keys = Object.keys(update.data);
    assert.ok(keys.some((key) => /^haberProjeleri\/mockKey/.test(key)));
    assert.ok(keys.includes('etkinlikler/ev1/tarih'));
    assert.ok(keys.some((key) => /^logs\/haberProje\//.test(key)));
    const projectValue = Object.entries(update.data).find(([key]) => /^haberProjeleri\/mockKey/.test(key))[1];
    assert.equal(Object.keys(projectValue.adimlar).length, 1);
    assert.equal(Object.values(projectValue.adimlar)[0].durum, 'yapiliyor');
    assert.equal(projectValue.ilerleme, 50);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(150);
    const mobile = await page.evaluate(() => ({
      columns: getComputedStyle(document.querySelector('.gantt-summary')).gridTemplateColumns.split(' ').length,
      viewportOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      boardScrollable: document.querySelector('.gantt-grid').scrollWidth > document.querySelector('#gantt-board').clientWidth,
      offenders: [...document.querySelectorAll('body *')]
        .filter((element) => element.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
        .slice(0, 8)
        .map((element) => `${element.tagName}.${element.className}`),
      metrics: ['.main', '.page-wrapper', '.gantt-summary', '.gantt-shell', '.topbar']
        .map((selector) => {
          const element = document.querySelector(selector);
          const rect = element?.getBoundingClientRect();
          return [selector, rect?.left, rect?.right, rect?.width, element?.scrollWidth];
        })
    }));
    assert.equal(mobile.columns, 2);
    assert.equal(mobile.viewportOverflow, false, `mobil taşan öğeler: ${mobile.offenders.join(', ')} ölçüler: ${JSON.stringify(mobile.metrics)}`);
    assert.equal(mobile.boardScrollable, true);
    assert.deepEqual(pageErrors, []);
    console.log('PASS: Gantt masaüstü/mobil görünüm, modal ve atomik takvim bağlantısı');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
