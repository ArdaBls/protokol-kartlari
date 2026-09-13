// Texas Hold'em sahnesi: yerel Firebase taklidiyle masa düzenini, 52'lik
// kart dosyalarını ve telefon yönü perdesini doğrular. Canlı veriye bağlanmaz.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

const site = path.join(__dirname, '..', 'docs');

async function createServer() {
  const server = http.createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(request.url.split('?')[0]);
      const file = path.join(site, pathname === '/' ? '/oyun-holdem.html' : pathname);
      const content = await fs.readFile(file);
      const type = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png' }[path.extname(file)] || 'application/octet-stream';
      response.writeHead(200, { 'Content-Type': type });
      response.end(content);
    } catch { response.writeHead(404); response.end('not found'); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}

(async () => {
  const server = await createServer();
  const mock = await fs.readFile(path.join(__dirname, 'mock-firebase.js'), 'utf8');
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    for (const view of [{ name: 'desktop', width: 1366, height: 768 }, { name: 'landscape-phone', width: 844, height: 390 }]) {
      const page = await browser.newPage({ viewport: view });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.route('**/firebasejs/**/firebase-app-compat.js', (route) => route.fulfill({ body: mock, contentType: 'application/javascript' }));
      await page.route('**/firebasejs/**/firebase-database-compat.js', (route) => route.fulfill({ body: '' }));
      await page.route('**/firebasejs/**/firebase-auth-compat.js', (route) => route.fulfill({ body: '' }));
      await page.route('**://fonts.googleapis.com/**', (route) => route.fulfill({ body: '' }));
      await page.route('**://fonts.gstatic.com/**', (route) => route.abort());
      await page.addInitScript(() => {
        window.__mockAuthUser = { uid: 'oyuncu1', email: 'test@example.com' };
        window.__mockUserProfile = window.__mockOnceSnapshot = { role: 'editor', firstName: 'Test', lastName: 'Oyuncu' };
        window.__mockLiveState = {
          users: { oyuncu1: { role: 'editor', firstName: 'Test', lastName: 'Oyuncu' } },
          cipBakiyeleri: { oyuncu1: { bakiye: 2000, sonIslemId: 'seed', islemler: {} } },
          blackjackAyarlari: { oyuncu1: { desteStili: 'temel', yuzKartiTemasi: 'varsayilan', desteArkasi: '01' } }
        };
      });
      await page.goto('http://127.0.0.1:' + server.address().port + '/oyun-holdem.html', { waitUntil: 'networkidle' });
      await page.waitForSelector('[data-holdem-root]');
      assert.equal(await page.locator('.holdem-koltuk').count(), 5, view.name + ': beş oyuncu koltuğu görünmeli');
      assert.equal(await page.locator('.holdem-kurpiyer').count(), 1, view.name + ': üst ortada ayrı kurpiyer görünmeli');
      assert.equal(await page.locator('[data-holdem-bot-zorlugu]').inputValue(), 'normal', view.name + ': varsayılan zorluk dengeli olmalı');
      assert.equal(await page.locator('[data-holdem-ortak-kartlar] img').count(), 0, view.name + ': el preflop başlamalı, ortak kart açılmamalı');
      assert.equal(await page.locator('[data-slot="3"] .holdem-kart').count(), 2, view.name + ': oyuncunun iki kapalı kartı olmalı');
      assert.equal(await page.locator('[data-holdem-kombinasyon-listesi] .holdem-kombinasyon-satir').count(), 10, view.name + ': tüm kombinasyonlar listelenmeli');
      assert.equal(await page.locator('[data-holdem-bakiye]').textContent(), '2.000 çip');
      if (view.name === 'desktop') {
        const initialDeckId = await page.locator('[data-holdem-root]').getAttribute('data-holdem-deste-id');
        await page.locator('[data-holdem-bot-zorlugu]').selectOption('kolay');
        assert.equal(
          await page.locator('[data-holdem-root]').getAttribute('data-holdem-deste-id'),
          initialDeckId,
          'masaüstü: bot zorluğu değişince eldeki deste/sıra sıfırlanmamalı'
        );
      }
      const cardStyle = await page.locator('[data-slot="3"] .holdem-kart').first().evaluate((card) => {
        const style = getComputedStyle(card);
        return { shadow: style.boxShadow, source: card.getAttribute('src') };
      });
      assert.equal(cardStyle.shadow, 'none', view.name + ': kart gölgesiz PNG olmalı');
      assert(!/Jokers|bonus_joker/.test(cardStyle.source), view.name + ': stilize joker görseli kullanılmamalı');
      const dimensions = await page.locator('[data-holdem-root]').evaluate((table) => {
        const rect = table.getBoundingClientRect();
        return { width: rect.width, height: rect.height, background: getComputedStyle(table).backgroundImage };
      });
      assert(dimensions.width > 0 && dimensions.height > 0 && dimensions.background.includes('holdem-masa-v1.png'), view.name + ': masa PNG arka planı görünmeli');
      assert(await page.locator('[data-holdem-masaya-otur]').isVisible(), view.name + ': masaya oturma düğmesi erişilebilir kalmalı');
      if (view.name === 'desktop' || view.name === 'landscape-phone') {
        await page.locator('[data-holdem-masaya-otur]').click();
        await page.waitForFunction(() => document.querySelector('[data-holdem-durum]').textContent.includes('El bitince'));
        assert.equal(await page.evaluate(() => window.__mockLiveState.cipBakiyeleri.oyuncu1.bakiye), 2000, 'masaya oturmak site bakiyesinden giriş ücreti kesmemeli');
        assert(await page.locator('[data-holdem-root]').getAttribute('data-holdem-deste-id'), view.name + ': bot eli benzersiz deste kimliği almalı');
      }
      assert.deepEqual(errors, [], view.name + ': JavaScript hatası olmamalı');
      await page.screenshot({ path: path.join(site, '..', '.impeccable', 'holdem-' + view.name + '.png') });
      await page.close();
    }
    const portrait = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await portrait.route('**/firebasejs/**/firebase-app-compat.js', (route) => route.fulfill({ body: mock, contentType: 'application/javascript' }));
    await portrait.route('**/firebasejs/**/firebase-database-compat.js', (route) => route.fulfill({ body: '' }));
    await portrait.route('**/firebasejs/**/firebase-auth-compat.js', (route) => route.fulfill({ body: '' }));
    await portrait.addInitScript(() => { window.__mockAuthUser = { uid: 'oyuncu1', email: 'test@example.com' }; window.__mockUserProfile = window.__mockOnceSnapshot = { role: 'editor' }; });
    await portrait.goto('http://127.0.0.1:' + server.address().port + '/oyun-holdem.html', { waitUntil: 'networkidle' });
    assert(await portrait.locator('[data-holdem-rotate-overlay]').isVisible(), 'Dikey telefonda yön çevirme perdesi görünmeli');
    await portrait.close();
    console.log('ALL_TESTS_PASSED: true');
  } finally {
    if (browser) await browser.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
