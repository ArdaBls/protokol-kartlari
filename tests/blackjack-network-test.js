// Firebase test çiftine gecikmeli onay ve izin reddi ekler. Canlı servise
// bağlanmaz; ekranın tahmini sonuçla değişmediğini ve reddin döngü yaratmadığını sınar.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const tablePath = 'oyunBasarimlari/blackjack/masalar/ana-masa';
const site = path.join(__dirname, '..', 'docs');

function delayedServer() {
	const originalDatabase = firebase.database;
	window.__network = { attempts: [], denied: false, delay: 180, active: 0, maxActive: 0 };
	firebase.database = Object.assign(function () {
		const db = originalDatabase();
		const originalRef = db.ref;
		db.ref = function (path) {
			const ref = originalRef(path);
			const originalTransaction = ref.transaction;
			if (path === 'oyunBasarimlari/blackjack/masalar/ana-masa') {
				ref.transaction = (update, complete, applyLocally) => {
					const net = window.__network;
					net.attempts.push({ applyLocally, phase: window.__mockLiveState.oyunBasarimlari.blackjack.masalar['ana-masa'].durum });
					net.active++;
					net.maxActive = Math.max(net.maxActive, net.active);
					return new Promise((resolve, reject) => setTimeout(() => {
						if (net.denied) { reject(Object.assign(new Error('permission_denied'), { code: 'PERMISSION_DENIED' })); return; }
						originalTransaction((value) => {
							const next = update(JSON.parse(JSON.stringify(value)));
							const allowed = { bahis_bekleniyor: ['oyunculuk', 'kurpiyer_sirasi'], oyunculuk: ['kurpiyer_sirasi'], kurpiyer_sirasi: ['el_sonucu'], el_sonucu: ['bahis_bekleniyor'] };
							if (next && next.durum !== value.durum && !(allowed[value.durum] || []).includes(next.durum)) { throw new Error('Atlanan oyun aşaması'); }
							return next;
						}).then(resolve, reject);
					}, net.delay)).finally(() => { net.active--; });
				};
			}
			return ref;
		};
		return db;
	}, originalDatabase);
}

function table(pair = false) {
	return {
		durum: 'oyunculuk', elNo: 7, guncellemeTs: Date.now(), aktifKoltuk: 2, aksiyonSuresiBitis: Date.now() + 60000,
		koltuklar: { 2: { uid: 'oyuncu1', isim: 'Test Oyuncu', bahis: 100, katilimDurumu: 'hazir', eller: [{ kartlar: [{ r: '4', s: 'kupa' }, { r: pair ? '4' : '5', s: 'maca' }], bahisMiktari: 100, durum: 'oynuyor' }] } },
		kurpiyerEli: { kartlar: [{ r: '7', s: 'kupa' }, { r: '10', s: 'maca' }], acikMi: false },
		deste: [{ r: '2', s: 'karo' }, { r: '3', s: 'sinek' }, { r: '5', s: 'kupa' }], desteIndex: 0
	};
}

(async () => {
	const mock = await fs.readFile(path.join(__dirname, 'mock-firebase.js'), 'utf8');
	const server = http.createServer(async (req, res) => {
		try {
			const filename = path.join(site, decodeURIComponent(req.url.split('?')[0]));
			const content = await fs.readFile(filename);
			res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png' })[path.extname(filename)] || 'application/octet-stream');
			res.end(content);
		} catch { res.writeHead(404); res.end(); }
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	let browser;
	try {
		browser = await chromium.launch();
		for (const scenario of ['hit-stand', 'denied-timeout', 'double', 'split']) {
			const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
			const errors = [];
			page.on('pageerror', (error) => errors.push(error.message));
			await page.route('**/firebasejs/**/firebase-app-compat.js', (route) => route.fulfill({ body: mock + '\n(' + delayedServer.toString() + ')();', contentType: 'application/javascript' }));
			await page.route('**/firebasejs/**/firebase-database-compat.js', (route) => route.fulfill({ body: '' }));
			await page.route('**/firebasejs/**/firebase-auth-compat.js', (route) => route.fulfill({ body: '' }));
			await page.route('**://fonts.googleapis.com/**', (route) => route.fulfill({ body: '' }));
			await page.route('**://fonts.gstatic.com/**', (route) => route.abort());
			await page.addInitScript((state) => {
				window.__mockAuthUser = { uid: 'oyuncu1', email: 'test@example.com' };
				window.__mockUserProfile = window.__mockOnceSnapshot = { role: 'editor', firstName: 'Test', lastName: 'Oyuncu' };
				window.__mockLiveState = { oyunBasarimlari: { blackjack: { masalar: { 'ana-masa': state } } }, cipBakiyeleri: { oyuncu1: { bakiye: 900, sonIslemId: 'seed', islemler: {} } } };
			}, table(scenario === 'split'));
			await page.goto('http://127.0.0.1:' + server.address().port + '/oyun-blackjack.html', { waitUntil: 'networkidle' });
			await page.waitForSelector('[data-bj-kartcek]');
			if (scenario === 'denied-timeout') {
				await page.evaluate((path) => { window.__network.denied = true; return firebase.database().ref(path + '/aksiyonSuresiBitis').set(Date.now() - 100); }, tablePath);
				await page.waitForFunction(() => document.querySelector('[data-bj-durum]').textContent.includes('yazma izni'));
				const attempts = await page.evaluate(() => window.__network.attempts.length);
				await page.waitForTimeout(2200);
				assert.equal(await page.evaluate(() => window.__network.attempts.length), attempts, 'Ret sonsuz işlem üretmemeli');
				assert.equal(await page.locator('[data-bj-kartcek]').count(), 1, 'Ret kart çek düğümünü silmemeli');
				await page.evaluate(() => { window.__network.denied = false; });
				await page.click('[data-bj-yeniden-dene]');
			} else if (scenario === 'hit-stand') {
				await page.locator('[data-bj-kartcek]').evaluate((button) => { window.__originalHit = button; button.click(); button.click(); });
				await page.waitForTimeout(30);
				assert(await page.locator('[data-bj-kartcek]').isDisabled(), 'Onay beklerken tekrar tıklama kapanmalı');
				assert.equal(await page.evaluate(() => window.__mockLiveState.oyunBasarimlari.blackjack.masalar['ana-masa'].desteIndex), 0, 'Sunucu onayından önce kart değişmemeli');
				await page.waitForFunction(() => window.__mockLiveState.oyunBasarimlari.blackjack.masalar['ana-masa'].desteIndex === 1);
				assert.equal(await page.evaluate(() => window.__network.attempts.length), 1, 'Çift tıklama tek kart çekmeli');
				await page.click('[data-bj-kal]');
			} else if (scenario === 'double') {
				await page.click('[data-bj-katla]');
				await page.waitForFunction(() => window.__mockLiveState.oyunBasarimlari.blackjack.masalar['ana-masa'].durum === 'kurpiyer_sirasi');
				assert.equal(await page.evaluate(() => window.__mockLiveState.oyunBasarimlari.blackjack.masalar['ana-masa'].koltuklar[2].eller[0].bahisMiktari), 200);
			} else {
				await page.click('[data-bj-bol]');
				await page.waitForFunction(() => window.__mockLiveState.oyunBasarimlari.blackjack.masalar['ana-masa'].koltuklar[2].eller.length === 2);
				await page.click('[data-bj-kal]');
				await page.waitForFunction(() => window.__mockLiveState.oyunBasarimlari.blackjack.masalar['ana-masa'].koltuklar[2].eller[0].durum === 'kaldi');
				assert.equal(await page.locator('[data-bj-kal]').count(), 1, 'İkinci bölünmüş el oynanabilmeli');
				await page.click('[data-bj-kal]');
			}
			await page.waitForFunction(() => window.__mockLiveState.oyunBasarimlari.blackjack.masalar['ana-masa'].durum === 'el_sonucu');
			assert.equal(await page.evaluate(() => window.__network.maxActive), 1, 'Aynı istemci çakışan masa işlemi üretmemeli');
			assert(await page.evaluate(() => window.__network.attempts.every((x) => x.applyLocally === false)), 'Yalnız onaylı masa yayınlanmalı');
			assert.deepEqual(errors, []);
			console.log(scenario + ': OK');
			await page.close();
		}
		console.log('ALL_TESTS_PASSED: true');
	} finally {
		if (browser) await browser.close();
		server.closeAllConnections();
		await new Promise((resolve) => server.close(resolve));
	}
})().catch((error) => { console.error(error); process.exitCode = 1; });
