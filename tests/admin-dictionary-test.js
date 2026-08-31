const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');
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
const SITE_ROOT = path.join(__dirname, '..');
const PORT = 8966;
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
	const page = await browser.newPage();
	const pageErrors = [];
	page.on('pageerror', (e) => pageErrors.push(e.message));
	// Öneri silme onayı native confirm() kullanıyor -- Playwright varsayılan olarak dialog'ları
	// OTOMATİK REDDEDER (Cancel), bu yüzden "onaylandı" yolunu test edebilmek için elle kabul ediyoruz.
	page.on('dialog', (d) => d.accept());
	await page.route('**/firebasejs/**/firebase-app-compat.js', (route) => route.fulfill({ path: path.join(TESTS_DIR, 'mock-firebase.js'), contentType: 'application/javascript' }));
	await page.route('**/firebasejs/**/firebase-database-compat.js', (route) => route.fulfill({ body: '' }));
	await page.route('**/firebasejs/**/firebase-auth-compat.js', (route) => route.fulfill({ body: '' }));
	await page.route('**Sortable.min.js', (route) => route.fulfill({ path: path.join(TESTS_DIR, 'mock-sortable.js') }));
	await page.route('**://fonts.googleapis.com/**', (route) => route.fulfill({ body: '' }));
	await page.route('**://fonts.gstatic.com/**', (route) => route.abort());
	// admin.html'in KENDİ koruma mantığı (resolveAuthUser -> routeForCurrentPage) misafir
	// girişinde (mock auth varsayılan currentUser=null) location.replace ile index.html'e
	// yönlendirir -- context navigasyonla yok olur. __mockSimulateOfflineHang bayrağı
	// (admin-tabs-test.js'teki AYNI teknik) bu yönlendirmeyi engeller.
	await page.addInitScript(() => { window.__mockSimulateOfflineHang = true; });
	await page.goto(`http://localhost:${PORT}/admin.html`, { waitUntil: 'load' });
	await page.waitForTimeout(300);

	await page.evaluate(() => {
		currentUser = { uid: 'admin1', role: 'admin', firstName: 'Admin', lastName: 'Kullanıcı', email: 'admin@test.com' };
		applyPermissions();
		openAdminPanel();
	});
	await page.waitForTimeout(150);

	// =====================================================================
	// SENARYO 1: liste doğru render ediliyor mu (İl + Üniversite, Birimler + Unvanlar).
	// Mock .once() yol ayrımı yapmaz (bkz. admin-tabs-test.js'teki AYNI not) -- il VE
	// üniversite fetch'i AYNI veriyi alır, bu yüzden her öğe İKİ bölümde de görünür.
	// =====================================================================
	const listTest = await page.evaluate(async () => {
		window.__mockOnceSnapshot = {
			birimler: { k1: { deger: 'Fen Fakültesi' }, k2: { deger: 'Tıp Fakültesi' } },
			unvanlar: { k3: { deger: 'Dekan' } }
		};
		switchAdminTab('dictionary');
		await new Promise((r) => setTimeout(r, 100));
		const body = document.getElementById('adminDictionaryBody').innerHTML;
		return {
			showsIlSection: /İl Protokol · Birimler/.test(body),
			showsUniSection: /Üniversite Protokol · Birimler/.test(body),
			showsFenFakultesi: /Fen Fakültesi/.test(body),
			showsDekan: /Dekan/.test(body),
			rowCount: document.querySelectorAll('.dict-row').length, // 2 birim + 1 unvan, İL+ÜNİ = (2+1)*2 = 6
			delBtnHasDataAttrs: !!document.querySelector('.dict-del-btn[data-oneri-id="k1"][data-list-key="il"][data-kind="birimler"]')
		};
	});

	// =====================================================================
	// SENARYO 2: silme -- confirm() kabul edilince doğru path'e remove() + logs/dictionary'e
	// push() gitmeli, tekrar requireAdmin() kontrolü (editor engellenmeli) doğrulanmalı.
	// =====================================================================
	const deleteTest = await page.evaluate(async () => {
		window.__mockRemoves = []; window.__mockPushes = [];
		const btn = document.querySelector('.dict-del-btn[data-oneri-id="k1"][data-list-key="il"][data-kind="birimler"]');
		await deleteDictionaryEntry(btn);
		await new Promise((r) => setTimeout(r, 50));
		const removed = (window.__mockRemoves || []).find((r) => r.path.indexOf('oneriler/il/birimler/k1') !== -1);
		const logged = (window.__mockPushes || []).find((p) => p.path.indexOf('logs/dictionary') !== -1 && p.data && p.data.target === 'Fen Fakültesi');
		return { removedCorrectPath: !!removed, loggedToDictionaryBucket: !!logged };
	});

	// =====================================================================
	// SENARYO 3: editor rolü -- requireAdmin() engellemeli, hiçbir remove() gitmemeli.
	// =====================================================================
	const editorGuardTest = await page.evaluate(async () => {
		currentUser = { uid: 'ed1', role: 'editor', firstName: 'Editor', lastName: 'K', email: 'ed@test.com' };
		applyPermissions();
		window.__mockRemoves = [];
		const btn = document.querySelector('.dict-del-btn[data-oneri-id="k2"][data-list-key="il"][data-kind="birimler"]');
		await deleteDictionaryEntry(btn);
		await new Promise((r) => setTimeout(r, 50));
		return { blockedForEditor: (window.__mockRemoves || []).length === 0 };
	});

	const combined = { listTest, deleteTest, editorGuardTest };
	console.log(JSON.stringify(combined, null, 2));
	console.log('PAGE ERRORS:', pageErrors.length);
	pageErrors.forEach((e) => console.log(' -', e));

	const __boolFails = collectBooleanFailures(combined, []);
	const rowCountOk = combined.listTest.rowCount === 6;
	const __allPassed = pageErrors.length === 0 && __boolFails.length === 0 && rowCountOk;
	console.log('rowCount:', combined.listTest.rowCount, '(expected 6)');
	console.log('ALL_TESTS_PASSED:', __allPassed);
	if (__boolFails.length) console.log('BASARISIZ ALANLAR:', JSON.stringify(__boolFails));

	await browser.close();
	server.close();
	process.exitCode = __allPassed ? 0 : 1;
})();
