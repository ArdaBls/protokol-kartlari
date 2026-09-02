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
			res.writeHead(200, { 'Content-Type': path.extname(fp) === '.html' ? 'text/html' : path.extname(fp) === '.css' ? 'text/css' : path.extname(fp) === '.js' ? 'application/javascript' : 'text/plain' });
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
	await page.goto(`http://localhost:${PORT}/protokol.html`, { waitUntil: 'load' });
	await page.waitForTimeout(300);

	await page.evaluate(() => {
		currentUser = { uid: 'admin1', role: 'admin', firstName: 'Test', lastName: 'Admin', email: 'admin@test.com' };
		applyPermissions();
		currentListKey = 'universite';
		people = [{ name: 'Test Kişi', title: 'Rektör', unit: 'OMÜ', prefix: 'Prof. Dr.', status: 'aktif' }];
		calEvents = { ev1: { ad: 'Test Etkinlik', tur: 'diger', durum: 'planlandi', tarih: '2026-09-10', katilimcilar: [] } };
	});

	// =====================================================================
	// SENARYO 1: dbPath() -- mod kapalıyken gerçek yol, açıkken test/ önekli yol döner
	// =====================================================================
	const dbPathTest = await page.evaluate(() => {
		testModeEnabled = false;
		const off1 = dbPath('etkinlikler') === 'etkinlikler';
		const off2 = dbPath('logs/il') === 'logs/il';
		testModeEnabled = true;
		const on1 = dbPath('etkinlikler') === 'test/etkinlikler';
		const on2 = dbPath('logs/il') === 'test/logs/il';
		testModeEnabled = false;
		return { off1, off2, on1, on2 };
	});

	// =====================================================================
	// SENARYO 2: cloneRealDataToTestMode() -- 5 gerçek yol okunup test/ öneki ile yazılıyor mu
	// =====================================================================
	const cloneTest = await page.evaluate(async () => {
		window.__mockSets = [];
		const readPaths = [];
		const origRef = database.ref.bind(database);
		database.ref = function (p) {
			const real = origRef(p);
			const wrapped = Object.assign({}, real);
			wrapped.once = function (evt) { readPaths.push(p); return real.once(evt); };
			return wrapped;
		};
		await cloneRealDataToTestMode();
		database.ref = origRef;
		const expectedSources = ['ilProtokolVerileri', 'universiteProtokolVerileri', 'etkinlikler', 'basinGorevlileri'];
		const expectedTargets = expectedSources.map((p) => 'test/' + p);
		return {
			allSourcesRead: expectedSources.every((p) => readPaths.indexOf(p) !== -1),
			allTargetsWritten: expectedTargets.every((p) => window.__mockSets.some((s) => s.path === p))
		};
	});

	// =====================================================================
	// SENARYO 3: setTestMode(true) -- ÖNCE klonlama, SONRA ayarlar/testModuAcik=true yazılıyor;
	// editor rolü çağıramıyor (requireAdmin kapısı)
	// =====================================================================
	const setOnTest = await page.evaluate(async () => {
		window.__mockSets = [];
		await setTestMode(true);
		const cloneWrites = window.__mockSets.filter((s) => s.path.indexOf('test/') === 0);
		const flagWrite = window.__mockSets.find((s) => s.path === 'ayarlar/testModuAcik');
		const flagIndex = window.__mockSets.indexOf(flagWrite);
		const lastCloneIndex = Math.max.apply(null, cloneWrites.map((s) => window.__mockSets.indexOf(s)));
		return {
			cloneHappened: cloneWrites.length === 4,
			flagWroteTrue: !!flagWrite && flagWrite.data === true,
			cloneBeforeFlag: !!flagWrite && flagIndex > lastCloneIndex
		};
	});
	const editorGateTest = await page.evaluate(async () => {
		window.__mockSets = [];
		currentUser = { uid: 'ed1', role: 'editor', firstName: 'Test', lastName: 'Editor', email: 'editor@test.com' };
		applyPermissions();
		await setTestMode(true);
		const blocked = window.__mockSets.length === 0;
		currentUser = { uid: 'admin1', role: 'admin', firstName: 'Test', lastName: 'Admin', email: 'admin@test.com' };
		applyPermissions();
		return { blocked };
	});

	// =====================================================================
	// SENARYO 4: testModeEnabled açıkken -- kişi/etkinlik/DEBUG kaydı VE loglarının
	// HEPSİ test/ altına gidiyor, gerçek yola HİÇBİR ŞEY yazılmıyor
	// =====================================================================
	const redirectOnTest = await page.evaluate(async () => {
		testModeEnabled = true; updateStatusBanner();
		// saveData() artik veri+log'u TEK atomik database.ref("/").update({...}) cagrisiyla yaziyor
		// (audit #6) -- .set() DEGIL, bu yuzden yol kontrolu __mockUpdates icindeki payload
		// anahtarlarindan yapilir (bkz. audit-fixes-test.js/status-transition-test.js'teki ayni desen).
		window.__mockPushes = []; window.__mockSets = []; window.__mockUpdates = [];
		await saveData('Test kişi kaydı', 'Test Kişi');
		logEventAction('Test etkinlik işlemi', 'Test Etkinlik');
		logDebugAction('Test debug işlemi', 'Test Hedef');
		const lastUpd = window.__mockUpdates[window.__mockUpdates.length - 1];
		const updKeys = lastUpd ? Object.keys(lastUpd.data) : [];
		const personSet = updKeys.indexOf('test/universiteProtokolVerileri') !== -1;
		const realPersonSet = updKeys.indexOf('universiteProtokolVerileri') !== -1;
		const eventLog = window.__mockPushes.find((p) => p.data && p.data.action === 'Test etkinlik işlemi');
		const debugLog = window.__mockPushes.find((p) => p.data && p.data.action === 'Test debug işlemi');
		return {
			bannerVisible: document.getElementById('testModeBanner').style.display === 'flex',
			switchChecked: document.getElementById('testModeSwitch').checked === true,
			personWentToTest: !!personSet,
			personDidNotTouchReal: !realPersonSet,
			eventLogWentToTest: !!eventLog && eventLog.path === 'test/logs/etkinlik',
			debugLogWentToTest: !!debugLog && debugLog.path === 'test/logs/debug'
		};
	});

	// =====================================================================
	// SENARYO 5: testModeEnabled kapanınca -- her şey gerçek yoluna döner, test/ verisine dokunulmaz
	// =====================================================================
	const redirectOffTest = await page.evaluate(async () => {
		testModeEnabled = false; updateStatusBanner();
		window.__mockPushes = []; window.__mockSets = []; window.__mockUpdates = [];
		await saveData('Test kişi kaydı 2', 'Test Kişi');
		logEventAction('Test etkinlik işlemi 2', 'Test Etkinlik');
		const lastUpd = window.__mockUpdates[window.__mockUpdates.length - 1];
		const updKeys = lastUpd ? Object.keys(lastUpd.data) : [];
		const personSet = updKeys.indexOf('universiteProtokolVerileri') !== -1;
		const eventLog = window.__mockPushes.find((p) => p.data && p.data.action === 'Test etkinlik işlemi 2');
		return {
			bannerHidden: document.getElementById('testModeBanner').style.display === 'none',
			switchUnchecked: document.getElementById('testModeSwitch').checked === false,
			personWentToReal: !!personSet,
			eventLogWentToReal: !!eventLog && eventLog.path === 'logs/etkinlik'
		};
	});

	const results = { dbPathTest, cloneTest, setOnTest, editorGateTest, redirectOnTest, redirectOffTest, pageErrorsCount: pageErrors.length };
	console.log(JSON.stringify(results, null, 2));
	if (pageErrors.length) { console.log('PAGE ERRORS:'); pageErrors.forEach((e) => console.log(' - ' + e)); }

	const __boolFails = collectBooleanFailures({ dbPathTest, cloneTest, setOnTest, editorGateTest, redirectOnTest, redirectOffTest }, []);
	const __allPassed = pageErrors.length === 0 && __boolFails.length === 0;
	console.log('ALL_TESTS_PASSED:', __allPassed);
	if (__boolFails.length) console.log('BASARISIZ ALANLAR:', JSON.stringify(__boolFails));

	await browser.close();
	server.close();
	process.exitCode = __allPassed ? 0 : 1;
})();
