// Amiral Battı (oyun-amiral-batti.html) duman testi -- kullanici isteği:
// "masaütümdeki amiral battı oyununu site içinde satranç gibi iki kişinin
// oynayabileceği bir hale getirelim". Mock-firebase gercek cift-istemci
// senkronunu simule etmiyor (ref.update() sadece window.__mockUpdates'e
// kaydediyor, __mockData'yi degistirmiyor) -- bu yuzden en riskli parca olan
// "bekleyen atisi coz" (isabet/kacti/batti/kazanma) algoritmasi, sunulan
// __mockData'dan uretilen guncelleme PAYLOADINI dogrudan denetleyerek test
// ediliyor; bu da chess/wordle testlerinde olmayan ama burada GEREKLI olan
// bir yontem (cunku sonuc hesaplamasi TAMAMEN istemci tarafinda).
const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');

const TESTS_DIR = __dirname;
const SITE_ROOT = path.join(__dirname, '..', 'docs');
const PORT = 8977;

function serve() {
	const server = http.createServer((req, res) => {
		let p = decodeURIComponent(req.url.split('?')[0]);
		if (p === '/') p = '/index.html';
		const fp = path.join(SITE_ROOT, p);
		fs.readFile(fp, (err, data) => {
			if (err) { res.writeHead(404); res.end('not found: ' + p); return; }
			const ext = path.extname(fp);
			const type = ext === '.html' ? 'text/html' : ext === '.js' ? 'application/javascript' : ext === '.css' ? 'text/css' : 'text/plain';
			res.writeHead(200, { 'Content-Type': type });
			res.end(data);
		});
	});
	return new Promise((resolve) => server.listen(PORT, () => resolve(server)));
}

async function newPage(browser, uid) {
	const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
	const pageErrors = [];
	page.on('pageerror', (e) => pageErrors.push(e.message));
	await page.route('**/firebasejs/**/firebase-app-compat.js', (route) => route.fulfill({ path: path.join(TESTS_DIR, 'mock-firebase.js'), contentType: 'application/javascript' }));
	await page.route('**/firebasejs/**/firebase-database-compat.js', (route) => route.fulfill({ body: '' }));
	await page.route('**/firebasejs/**/firebase-auth-compat.js', (route) => route.fulfill({ body: '' }));
	await page.route('**://fonts.googleapis.com/**', (route) => route.fulfill({ body: '' }));
	await page.route('**://fonts.gstatic.com/**', (route) => route.abort());
	await page.addInitScript((u) => {
		window.__mockAuthUser = { uid: u, email: u + '@test.com' };
		window.__mockOnceSnapshot = { role: 'admin', firstName: 'Test', lastName: u };
	}, uid);
	page.__pageErrors = pageErrors;
	return page;
}

(async () => {
	const server = await serve();
	const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
	const results = {};

	// 1) Lobi: sayfa hatasiz aciliyor, temel elemanlar var.
	{
		const page = await newPage(browser, 'oyuncu1');
		await page.goto('http://localhost:' + PORT + '/oyun-amiral-batti.html', { waitUntil: 'networkidle' });
		await page.waitForSelector('[data-ab-new-game]', { timeout: 5000 });
		results.lobbyRendered = await page.locator('[data-ab-new-game]').count() === 1;
		results.myGamesSectionExists = await page.locator('[data-ab-my-games]').count() === 1;
		results.leaderboardSectionExists = await page.locator('[data-ab-leaderboard]').count() === 1;
		results.lobbyPageErrors = page.__pageErrors.length;
		await page.close();
	}

	// 2) Yerlestirme ekrani: gemi secip yerlestirme + hazir butonu calisiyor mu.
	{
		const page = await newPage(browser, 'oyuncu1');
		await page.addInitScript((PORT_) => {
			window.__mockData = {
				amiralBatti: {
					oyunA: {
						oyuncu1Uid: 'oyuncu1', oyuncu1Ad: 'Oyuncu Bir',
						oyuncu2Uid: 'oyuncu2', oyuncu2Ad: 'Oyuncu Iki',
						durum: 'yerlestirme', hazir1: false, hazir2: false, sira: null
					}
				}
			};
		}, PORT);
		await page.goto('http://localhost:' + PORT + '/oyun-amiral-batti.html?oyun=oyunA', { waitUntil: 'networkidle' });
		await page.waitForSelector('[data-ab-random-place]', { timeout: 5000 });
		await page.click('[data-ab-random-place]');
		const readyEnabled = await page.locator('[data-ab-ready]').isEnabled();
		results.randomPlacementEnablesReady = readyEnabled;
		await page.click('[data-ab-ready]');
		await page.waitForTimeout(200);
		const updates = await page.evaluate(() => window.__mockUpdates || []);
		const gizliYazildi = updates.some((u) => u.data && u.data['amiralBattiGizli/oyunA/oyuncu1'] && u.data['amiralBattiGizli/oyunA/oyuncu1'].gemiler && u.data['amiralBattiGizli/oyunA/oyuncu1'].gemiler.length === 5);
		const hazirYazildi = updates.some((u) => u.data && u.data['amiralBatti/oyunA/hazir1'] === true);
		results.placementWritesFleetPrivately = gizliYazildi;
		results.placementMarksReady = hazirYazildi;
		results.placementPageErrors = page.__pageErrors.length;
		await page.close();
	}

	// 3) Savas: rakibin atisina karsi isabet/kacti/batti/kazanma cozumlemesi.
	// Oyuncu2'nin (savunan) filosu: tek gemi 'muhrip' (boy 2) hucre (0,0)-(0,1).
	// Oyuncu1 (saldiran) zaten (0,0)'a atis atmis (bekliyor) -- oyuncu2'nin
	// istemcisi bunu görüp coz mesi gerekiyor.
	{
		const page = await newPage(browser, 'oyuncu2');
		await page.addInitScript((PORT_) => {
			window.__mockData = {
				amiralBattiGizli: {
					oyunB: {
						oyuncu2: { gemiler: [{ id: 'muhrip', hucreler: [{ r: 0, c: 0 }, { r: 0, c: 1 }] }] }
					}
				},
				amiralBatti: {
					oyunB: {
						oyuncu1Uid: 'oyuncu1', oyuncu1Ad: 'Oyuncu Bir',
						oyuncu2Uid: 'oyuncu2', oyuncu2Ad: 'Oyuncu Iki',
						durum: 'oynaniyor', hazir1: true, hazir2: true, sira: 'oyuncu2',
						atislar1: { '0_0': 'bekliyor' },
						atislar2: {}
					}
				}
			};
		}, PORT);
		await page.goto('http://localhost:' + PORT + '/oyun-amiral-batti.html?oyun=oyunB', { waitUntil: 'networkidle' });
		await page.waitForTimeout(300);
		const updates = await page.evaluate(() => window.__mockUpdates || []);
		const isabetYazildi = updates.some((u) => u.data && u.data['amiralBatti/oyunB/atislar1/0_0'] === 'isabet');
		results.singleHitResolvesToIsabet = isabetYazildi;
		results.combatPageErrors = page.__pageErrors.length;
		await page.close();
	}

	// 4) Savas: geminin TUM hucreleri vurulunca 'batti' + oyunun bitmesi
	// (kazanan = saldiran oyuncu1) -- toplam filo 17 hucre oldugu icin tek
	// gemiyle kazanma testi icin TUM diger gemileri de "zaten batmis" varsayip
	// tek eksik hucreyi tamamliyoruz.
	{
		const page = await newPage(browser, 'oyuncu2');
		const tumHucreler = [];
		// 15 hucre zaten batti (17 toplam - 2 muhrip hucresi), muhrip'in ilk
		// hucresi de batti, sadece (0,1) bekliyor -- coz uldugunde oyun biter.
		const digerGemiler = [
			{ id: 'ucak-gemisi', hucreler: Array.from({ length: 5 }, (_, i) => ({ r: 2, c: i })) },
			{ id: 'zirhli', hucreler: Array.from({ length: 4 }, (_, i) => ({ r: 3, c: i })) },
			{ id: 'kruvazor', hucreler: Array.from({ length: 3 }, (_, i) => ({ r: 4, c: i })) },
			{ id: 'denizalti', hucreler: Array.from({ length: 3 }, (_, i) => ({ r: 5, c: i })) },
			{ id: 'muhrip', hucreler: [{ r: 0, c: 0 }, { r: 0, c: 1 }] }
		];
		const atislar1 = { '0_0': 'batti', '0_1': 'bekliyor' };
		digerGemiler.slice(0, 4).forEach((g) => g.hucreler.forEach((h) => { atislar1[h.r + '_' + h.c] = 'batti'; }));
		await page.addInitScript((args) => {
			window.__mockData = {
				amiralBattiGizli: { oyunC: { oyuncu2: { gemiler: args.gemiler } } },
				amiralBatti: {
					oyunC: {
						oyuncu1Uid: 'oyuncu1', oyuncu1Ad: 'Oyuncu Bir',
						oyuncu2Uid: 'oyuncu2', oyuncu2Ad: 'Oyuncu Iki',
						durum: 'oynaniyor', hazir1: true, hazir2: true, sira: 'oyuncu2',
						atislar1: args.atislar1, atislar2: {}
					}
				}
			};
		}, { gemiler: digerGemiler, atislar1 });
		await page.goto('http://localhost:' + PORT + '/oyun-amiral-batti.html?oyun=oyunC', { waitUntil: 'networkidle' });
		await page.waitForTimeout(300);
		const updates = await page.evaluate(() => window.__mockUpdates || []);
		const battiYazildi = updates.some((u) => u.data && u.data['amiralBatti/oyunC/atislar1/0_1'] === 'batti');
		const oyunBitti = updates.some((u) => u.data && u.data['amiralBatti/oyunC/durum'] === 'bitti' && u.data['amiralBatti/oyunC/sonuc'] === 'oyuncu1');
		results.lastCellSunkMarksBatti = battiYazildi;
		results.allShipsSunkEndsGameForAttacker = oyunBitti;
		results.winPageErrors = page.__pageErrors.length;
		await page.close();
	}

	await browser.close();
	server.close();

	console.log(JSON.stringify(results, null, 2));
	function collectFails(obj, prefix) {
		let fails = [];
		for (const k in obj) {
			const p = prefix ? prefix + '.' + k : k;
			const v = obj[k];
			if (typeof v === 'boolean') { if (!v) fails.push(p); }
			else if (typeof v === 'number') { if (/PageErrors$/.test(k) && v !== 0) fails.push(p + '=' + v); }
		}
		return fails;
	}
	const fails = collectFails(results, '');
	console.log('ALL_TESTS_PASSED: ' + (fails.length === 0));
	if (fails.length) { console.log('FAILS: ' + fails.join(', ')); process.exit(1); }
})();
