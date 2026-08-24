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
const PORT = 8971;
function serve() {
	const server = http.createServer((req, res) => {
		let p = decodeURIComponent(req.url.split('?')[0]);
		if (p === '/') p = '/index.html';
		const fp = path.join(SITE_ROOT, p);
		fs.readFile(fp, (err, data) => {
			if (err) { res.writeHead(404); res.end('not found'); return; }
			res.writeHead(200, { 'Content-Type': path.extname(fp) === '.html' ? 'text/html' : 'text/plain' });
			res.end(data);
		});
	});
	return new Promise((resolve) => server.listen(PORT, () => resolve(server)));
}

(async () => {
	const server = await serve();
	const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
	const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
	const pageErrors = [];
	page.on('pageerror', (e) => pageErrors.push(e.message));
	await page.route('**/firebasejs/**/firebase-app-compat.js', (route) => route.fulfill({ path: path.join(TESTS_DIR, 'mock-firebase.js'), contentType: 'application/javascript' }));
	await page.route('**/firebasejs/**/firebase-database-compat.js', (route) => route.fulfill({ body: '' }));
	await page.route('**/firebasejs/**/firebase-auth-compat.js', (route) => route.fulfill({ body: '' }));
	await page.route('**Sortable.min.js', (route) => route.fulfill({ path: path.join(TESTS_DIR, 'mock-sortable.js') }));
	await page.route('**://fonts.googleapis.com/**', (route) => route.fulfill({ body: '' }));
	await page.route('**://fonts.gstatic.com/**', (route) => route.abort());
	await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });
	await page.waitForTimeout(300);

	await page.evaluate(() => {
		currentUser = { uid: 'admin1', role: 'admin', firstName: 'Test', lastName: 'Admin', email: 'admin@test.com' };
		applyPermissions();
		currentListKey = 'universite';
		people = [{ name: 'Test Kişi', title: 'Rektör', unit: 'OMÜ', prefix: 'Prof. Dr.', status: 'aktif' }];
		calEvents = { ev1: { ad: 'Test Etkinlik', tur: 'diger', durum: 'planlandi', tarih: '2026-09-10', katilimcilar: [] } };
		window.__testModeSets = [];
		const origRef = database.ref.bind(database);
		database.ref = function (p) {
			if (p === 'ayarlar/testModuAcik') {
				return { set: (v) => { window.__testModeSets.push(v); return Promise.resolve(); } };
			}
			return origRef(p);
		};
	});

	// =====================================================================
	// SENARYO 1: admin setTestMode(true) çağırabiliyor mu (doğru path'e doğru değer yazılıyor mu)
	// =====================================================================
	const adminSetTest = await page.evaluate(async () => {
		await setTestMode(true);
		return { wroteTrue: window.__testModeSets.length === 1 && window.__testModeSets[0] === true };
	});

	// =====================================================================
	// SENARYO 2: editor rolü setTestMode() çağıramıyor (requireAdmin kapısı)
	// =====================================================================
	const editorGateTest = await page.evaluate(async () => {
		window.__testModeSets = [];
		currentUser = { uid: 'ed1', role: 'editor', firstName: 'Test', lastName: 'Editor', email: 'editor@test.com' };
		applyPermissions();
		await setTestMode(true);
		const blocked = window.__testModeSets.length === 0;
		currentUser = { uid: 'admin1', role: 'admin', firstName: 'Test', lastName: 'Admin', email: 'admin@test.com' };
		applyPermissions();
		return { blocked };
	});

	// =====================================================================
	// SENARYO 3: testModeEnabled açıkken kişi/etkinlik/özel liste logları logs/test'e gidiyor,
	// logs/debug bundan ETKİLENMİYOR (ayrı kalması onaylanmıştı)
	// =====================================================================
	const redirectOnTest = await page.evaluate(() => {
		testModeEnabled = true; updateTestModeBanner();
		window.__mockPushes = [];
		logAction('Test kişi işlemi', 'Test Kişi');
		logEventAction('Test etkinlik işlemi', 'Test Etkinlik');
		logSublistAction('Test özel liste işlemi', 'Test Liste');
		logDebugAction('Test debug işlemi', 'Test Hedef');
		const personLog = window.__mockPushes.find((p) => p.data && p.data.action === 'Test kişi işlemi');
		const eventLog = window.__mockPushes.find((p) => p.data && p.data.action === 'Test etkinlik işlemi');
		const sublistLog = window.__mockPushes.find((p) => p.data && p.data.action === 'Test özel liste işlemi');
		const debugLog = window.__mockPushes.find((p) => p.data && p.data.action === 'Test debug işlemi');
		return {
			bannerVisible: document.getElementById('testModeBanner').style.display === 'flex',
			switchChecked: document.getElementById('testModeSwitch').checked === true,
			personWentToTest: !!personLog && personLog.path === 'logs/test',
			eventWentToTest: !!eventLog && eventLog.path === 'logs/test',
			sublistWentToTest: !!sublistLog && sublistLog.path === 'logs/test',
			debugStayedSeparate: !!debugLog && debugLog.path === 'logs/debug'
		};
	});

	// =====================================================================
	// SENARYO 4: testModeEnabled kapanınca loglar tekrar normal yollarına dönüyor
	// =====================================================================
	const redirectOffTest = await page.evaluate(() => {
		testModeEnabled = false; updateTestModeBanner();
		window.__mockPushes = [];
		logAction('Test kişi işlemi 2', 'Test Kişi');
		const personLog = window.__mockPushes.find((p) => p.data && p.data.action === 'Test kişi işlemi 2');
		return {
			bannerHidden: document.getElementById('testModeBanner').style.display === 'none',
			switchUnchecked: document.getElementById('testModeSwitch').checked === false,
			personWentToNormal: !!personLog && personLog.path === 'logs/universite'
		};
	});

	const results = { adminSetTest, editorGateTest, redirectOnTest, redirectOffTest, pageErrorsCount: pageErrors.length };
	console.log(JSON.stringify(results, null, 2));
	if (pageErrors.length) { console.log('PAGE ERRORS:'); pageErrors.forEach((e) => console.log(' - ' + e)); }

	const __boolFails = collectBooleanFailures({ adminSetTest, editorGateTest, redirectOnTest, redirectOffTest }, []);
	const __allPassed = pageErrors.length === 0 && __boolFails.length === 0;
	console.log('ALL_TESTS_PASSED:', __allPassed);
	if (__boolFails.length) console.log('BASARISIZ ALANLAR:', JSON.stringify(__boolFails));

	await browser.close();
	server.close();
	process.exitCode = __allPassed ? 0 : 1;
})();
