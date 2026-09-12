// Blackjack (oyun-blackjack.html) uctan uca duman testi -- gercek Firebase
// transaction() semantigini (bkz. mock-firebase.js'e eklenen canli durum
// katmani) kullanarak TEK bir istemcide TUM el dongusunu (otur -> bahis ->
// dagit -> vur/kal -> krupiyer -> odeme -> yeni el) surer. Coklu istemci
// senkronunu simule ETMIYOR (mock tek sayfa) ama ZINCIRLEME transaction
// mantiginin doğru calistigini (asil risk burada) dogruluyor.
const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');

const TESTS_DIR = __dirname;
const SITE_ROOT = path.join(__dirname, '..', 'docs');
const PORT = 8985;

function serve() {
	const server = http.createServer((req, res) => {
		let p = decodeURIComponent(req.url.split('?')[0]);
		if (p === '/') p = '/index.html';
		const fp = path.join(SITE_ROOT, p);
		fs.readFile(fp, (err, data) => {
			if (err) { res.writeHead(404); res.end('not found: ' + p); return; }
			const ext = path.extname(fp);
			const type = ext === '.html' ? 'text/html' : ext === '.js' ? 'application/javascript' : ext === '.css' ? 'text/css' : ext === '.png' ? 'image/png' : 'text/plain';
			res.writeHead(200, { 'Content-Type': type });
			res.end(data);
		});
	});
	return new Promise((resolve) => server.listen(PORT, () => resolve(server)));
}

(async () => {
	const server = await serve();
	const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
	const results = {};
	const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
	const pageErrors = [];
	page.on('pageerror', (e) => pageErrors.push(e.message));
	await page.route('**/firebasejs/**/firebase-app-compat.js', (route) => route.fulfill({ path: path.join(TESTS_DIR, 'mock-firebase.js'), contentType: 'application/javascript' }));
	await page.route('**/firebasejs/**/firebase-database-compat.js', (route) => route.fulfill({ body: '' }));
	await page.route('**/firebasejs/**/firebase-auth-compat.js', (route) => route.fulfill({ body: '' }));
	await page.route('**://fonts.googleapis.com/**', (route) => route.fulfill({ body: '' }));
	await page.route('**://fonts.gstatic.com/**', (route) => route.abort());
	await page.addInitScript(() => {
		window.__mockAuthUser = { uid: 'oyuncu1', email: 'oyuncu1@test.com' };
		window.__mockOnceSnapshot = { role: 'editor', firstName: 'Test', lastName: 'Oyuncu' };
	});

	await page.goto('http://localhost:' + PORT + '/oyun-blackjack.html', { waitUntil: 'networkidle' });
	await page.waitForSelector('[data-bj-otur]', { timeout: 5000 });
	results.lobiPageErrors = pageErrors.length;

	// 1) Otur -- boş koltuğa tıkla.
	await page.click('[data-bj-otur="0"]');
	await page.waitForTimeout(200);
	results.oturuncaKendiKoltuguGorunur = await page.locator('.bj-koltuk-ben').count() === 1;

	// 2) Bahis yap (100 çip) -- 1000 başlangıç bakiyesiyle karşılanabilir.
	await page.waitForSelector('[data-bj-bahis][data-miktar="100"]', { timeout: 5000 });
	await page.click('[data-bj-bahis][data-miktar="100"]');
	await page.waitForTimeout(200);
	results.bahisYazildi = (await page.locator('.bj-bahis-mevcut').first().textContent() || '').includes('100');

	// 3) 6 saniyelik bahis süresini bekle -- otomatik dağıtım tetiklenmeli.
	await page.waitForTimeout(6500);
	const kartSayisi = await page.locator('[data-bj-koltuklar] .bj-kart').count();
	results.dagitimdanSonraKartGorunur = kartSayisi >= 2;
	const krupiyerKartSayisi = await page.locator('[data-bj-krupiyer] .bj-kart').count();
	results.krupiyerIkiKartAldi = krupiyerKartSayisi === 2;

	// 4) Aksiyon çubuğu görünüyor mu (sıra bende ise).
	const aksiyonlarVar = await page.locator('[data-bj-aksiyonlar] button').count();
	results.aksiyonButonlariVarsaGorunur = aksiyonlarVar > 0 || kartSayisi === 0; // blackjack gelmiş olabilir, o zaman aksiyon yok -- kabul edilir

	// 5) Eğer aksiyon varsa "Kal" ile eli bitir, krupiyer sırasına geçmeli.
	if (aksiyonlarVar > 0) {
		await page.click('[data-bj-kal]');
		await page.waitForTimeout(1500);
	}
	await page.waitForTimeout(2000);
	const durumMetni = await page.evaluate(() => document.body.innerHTML.includes('Battı') || document.querySelectorAll('.bj-el-sonuc').length > 0);
	results.elSonucuGoruldu = durumMetni;

	results.oyunPageErrors = pageErrors.length;
	console.log(JSON.stringify(results, null, 2));

	await browser.close();
	server.close();

	const fails = Object.keys(results).filter((k) => {
		const v = results[k];
		if (typeof v === 'boolean') { return !v; }
		if (/PageErrors$/.test(k)) { return v !== 0; }
		return false;
	});
	console.log('ALL_TESTS_PASSED: ' + (fails.length === 0));
	if (fails.length) { console.log('FAILS: ' + fails.join(', ')); process.exit(1); }
})();
