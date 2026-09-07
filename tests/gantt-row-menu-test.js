const { chromium } = require('playwright');
const path = require('node:path');
const http = require('node:http');
const fs = require('node:fs');
const assert = require('node:assert/strict');

const TESTS_DIR = __dirname;
const SITE_ROOT = path.join(__dirname, '..', 'docs');
const PORT = 8997;

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
  page.on('pageerror', (e) => pageErrors.push(e.message));
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
          sorumlu: 'Gantt Test', arsiv: false,
          adimlar: { adim1: { ad: 'Röportaj çekimi', durum: 'tamamlandi', baslangicTarihi: '2026-09-03', bitisTarihi: '2026-09-08', ilerleme: 100, sira: 0 } }
        }
      },
      etkinlikler: {}
    };
  });
  try {
    await page.goto(`http://localhost:${PORT}/gantt.html`, { waitUntil: 'load', timeout: 30000 });
    await page.waitForSelector('.gantt-project-row', { timeout: 10000 });
    const parentMenuBtn = page.locator('.gantt-parent-row [data-row-menu]');
    await parentMenuBtn.click();
    await page.waitForSelector('.menu-popover');
    const items = await page.locator('.menu-popover .menu-item').allTextContents();
    assert.deepEqual(items, ['Düzenle', 'Arşivle', 'Sil']);
    assert.equal(await page.locator('.menu-popover .menu-item-danger').textContent(), 'Sil');
    await page.locator('.menu-popover .menu-item', { hasText: 'Düzenle' }).click();
    await page.waitForSelector('#gantt-modal:not([hidden])');
    assert.equal(await page.locator('#gantt-title').inputValue(), 'Kampüs belgeseli');
    await page.locator('[data-gantt-close]').last().click();

    const stepMenuBtn = page.locator('.gantt-step-row [data-row-menu]');
    await stepMenuBtn.click();
    await page.waitForSelector('.menu-popover');
    const stepItems = await page.locator('.menu-popover .menu-item').allTextContents();
    assert.deepEqual(stepItems, ['Düzenle']);
    await page.keyboard.press('Escape');

    assert.deepEqual(pageErrors, []);
    console.log('PASS: satır menüsü (⋮) doğru öğeleri gösteriyor ve Düzenle çalışıyor');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
