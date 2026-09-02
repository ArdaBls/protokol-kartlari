const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');
// --- CI icin: sonuc nesnesindeki TUM boolean yapraklari gez, false olanlari
// (haric-listesi disinda) topla. Sayisal/metin alanlar bilerek atlanir -
// bu dosyalar zaten insan gozüyle okunmak icin JSON basiyor, bu fonksiyon
// sadece "hangi boolean beklenenden farkli" sorusuna otomatik cevap verir.
function collectBooleanFailures(obj, excludePaths, prefix) {
	excludePaths = excludePaths || []; prefix = prefix || '';
	let fails = [];
	if (obj && typeof obj === 'object') {
		for (const k in obj) {
			const p = prefix ? prefix + '.' + k : k;
			const v = obj[k];
			if (typeof v === 'boolean') {
				if (v === false && excludePaths.indexOf(p) === -1) fails.push(p);
			} else if (v && typeof v === 'object') {
				fails = fails.concat(collectBooleanFailures(v, excludePaths, p));
			}
		}
	}
	return fails;
}

const TESTS_DIR = __dirname;
const SITE_ROOT = path.join(__dirname, '..', 'docs'); // index.html repo kokunde, tests/ altinda degil
const PORT = 8957;
function serve() {
	const server = http.createServer((req, res) => {
		let p = decodeURIComponent(req.url.split('?')[0]);
		if (p === '/') p = '/index.html';
		const fp = path.join(SITE_ROOT, p);
		fs.readFile(fp, (err, data) => {
			if (err) { res.writeHead(404); res.end('not found'); return; }
			res.writeHead(200, { 'Content-Type': path.extname(fp) === '.html' ? 'text/html' : path.extname(fp) === '.css' ? 'text/css' : path.extname(fp) === '.js' ? 'application/javascript' : 'text/plain' });
			res.end(data);
		});
	});
	return new Promise((resolve) => server.listen(PORT, () => resolve(server)));
}
(async () => {
	const server = await serve();
	const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
	const page = await browser.newPage({ viewport: { width: 1280, height: 850 } });
	const pageErrors = [];
	page.on('pageerror', (e) => pageErrors.push(e.message));
	await page.route('**/firebasejs/**/firebase-app-compat.js', (route) => route.fulfill({ path: path.join(TESTS_DIR, 'mock-firebase.js'), contentType: 'application/javascript' }));
	await page.route('**/firebasejs/**/firebase-database-compat.js', (route) => route.fulfill({ body: '' }));
	await page.route('**/firebasejs/**/firebase-auth-compat.js', (route) => route.fulfill({ body: '' }));
	await page.route('**Sortable.min.js', (route) => route.fulfill({ path: path.join(TESTS_DIR, 'mock-sortable.js') }));
	await page.route('**://fonts.googleapis.com/**', (route) => route.fulfill({ body: '' }));
	await page.route('**://fonts.gstatic.com/**', (route) => route.abort());
	await page.goto(`http://localhost:${PORT}/protokol.html`, { waitUntil: 'load' });
	await page.waitForTimeout(300);

	// --- NOT 1: layoutDay küme bazlı genişlik ---
	const layoutTest = await page.evaluate(() => {
		// Sabah 09:00-10:00 ve 09:30-10:30 çakışıyor (2 sütun); akşam 18:00-19:00 tek başına (1 sütun, tam genişlik olmalı).
		const evs = [
			{ _id: 'a', saat: '09:00', bitisSaat: '10:00' },
			{ _id: 'b', saat: '09:30', bitisSaat: '10:30' },
			{ _id: 'c', saat: '18:00', bitisSaat: '19:00' }
		];
		const laid = layoutDay(evs);
		const byId = {}; laid.forEach(it => byId[it.ev._id] = { col: it.col, total: it.total });
		return byId;
	});

	// Ek senaryo: 3 etkinlikli zincir (A-B çakışır, B-C çakışır, A-C çakışmaz) + ayrık D
	const chainTest = await page.evaluate(() => {
		const evs = [
			{ _id: 'A', saat: '08:00', bitisSaat: '09:00' },
			{ _id: 'B', saat: '08:30', bitisSaat: '09:30' },
			{ _id: 'C', saat: '09:15', bitisSaat: '10:00' },
			{ _id: 'D', saat: '14:00', bitisSaat: '15:00' }
		];
		const laid = layoutDay(evs);
		const byId = {}; laid.forEach(it => byId[it.ev._id] = { col: it.col, total: it.total });
		return byId;
	});

	// Boş liste çökmemeli
	const emptyTest = await page.evaluate(() => { try { return { ok: true, result: layoutDay([]) }; } catch(e) { return { ok: false, err: e.message }; } });

	// --- NOT 2: ölü CSS'in gerçekten kaldırıldığını ve kalan class'ların (bulk-cb/news-cb/cal-hrline) etkilenmediğini doğrula ---
	const cssTest = await page.evaluate(() => {
		const sheets = Array.from(document.styleSheets);
		let allRules = [];
		sheets.forEach(s => { try { allRules = allRules.concat(Array.from(s.cssRules).map(r => r.cssText || '')); } catch(e) {} });
		const text = allRules.join('\n');
		return {
			btnSuccessGone: !text.includes('.btn-success'),
			calHrlineHalfGone: !text.includes('.cal-hrline.half'),
			calHrlineBaseStillThere: text.includes('.cal-hrline'),
			newChipRefGone: !text.includes('.new-chip'),
			restoreCbRefGone: !text.includes('.restore-cb'),
			bulkCbStillThere: text.includes('.bulk-cb'),
			newsCbStillThere: text.includes('.news-cb')
		};
	});

	// --- NOT 3: render() beklenmeyen status değeri artık "aktif" sekmesinde görünüyor mu ---
	const statusTest = await page.evaluate(() => {
		currentListKey = 'il';
		people = [
			{ name: 'Normal Aktif', status: 'aktif' },
			{ name: 'Normal Pasif', status: 'pasif', end: '2030-01-01' },
			{ name: 'Normal Silindi', status: 'silindi' },
			{ name: 'Bozuk Statu', status: 'YanlisYaziMisTypo' },
			{ name: 'Status Yok', status: '' }
		];
		mode = 'aktif';
		render();
		const aktifNames = Array.from(document.querySelectorAll('#grid .name')).map(el => el.textContent.trim());
		mode = 'pasif'; render();
		const pasifNames = Array.from(document.querySelectorAll('#grid .name')).map(el => el.textContent.trim());
		mode = 'silindi'; render();
		const silindiNames = Array.from(document.querySelectorAll('#grid .name')).map(el => el.textContent.trim());
		mode = 'aktif'; render();
		return { aktifNames, pasifNames, silindiNames };
	});

	// --- YENİ İSTEK: takvim mini seçili gün belirteci ---
	const calMiniTest = await page.evaluate(() => {
		openCalendar();
		renderCalMini();
		const inViewEl = document.querySelector('.cal-mini-day.in-view');
		if (!inViewEl) return { found: false };
		const cs = getComputedStyle(inViewEl);
		return { found: true, background: cs.backgroundColor, boxShadow: cs.boxShadow, fontWeight: cs.fontWeight };
	});

	const combined = { layoutTest, chainTest, emptyTest, cssTest, statusTest, calMiniTest };
	console.log(JSON.stringify(combined, null, 2));
	console.log('PAGE ERRORS:', pageErrors.length);
	pageErrors.forEach(e => console.log(' -', e));

	const __boolFails = collectBooleanFailures(combined, []);
	const __allPassed = pageErrors.length === 0 && __boolFails.length === 0;
	console.log('ALL_TESTS_PASSED:', __allPassed);
	if (__boolFails.length) console.log('BASARISIZ ALANLAR:', JSON.stringify(__boolFails));

	await browser.close();
	server.close();
	process.exitCode = __allPassed ? 0 : 1;
})();
