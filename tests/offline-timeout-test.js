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
const SITE_ROOT = path.join(__dirname, '..', 'docs');
const PORT = 8970;
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

	// Sayfanın kendi <script>'i çalışmadan ÖNCE bayrakları koy: mock-firebase.js "users/" yolunu
	// hiç çözmeyecek (çevrimdışı/bağlantı-kopukluğu simülasyonu), zaman aşımı da teste uygun kısaltılır.
	await page.addInitScript(() => {
		// shell.js onay kapisi users/{uid}.once() ile rolu okuyor; bu test cevrimdisi
		// AKISINI olcuyor, onay akisini degil -- onaylanmis bir rol verilmezse kullanici
		// onay-bekliyor.html'e yonlendirilir ve test etmek istedigi ekran hic acilmaz.
		window.__mockOnceSnapshot = { role: 'admin', firstName: 'Test', lastName: 'Kullanici', email: 't@t.c' };
		window.__mockSimulateOfflineHang = true;
		window.OFFLINE_FALLBACK_TIMEOUT_MS = 400;
	});

	await page.route('**/firebasejs/**/firebase-app-compat.js', (route) => route.fulfill({ path: path.join(TESTS_DIR, 'mock-firebase.js'), contentType: 'application/javascript' }));
	await page.route('**/firebasejs/**/firebase-database-compat.js', (route) => route.fulfill({ body: '' }));
	await page.route('**/firebasejs/**/firebase-auth-compat.js', (route) => route.fulfill({ body: '' }));
	await page.route('**Sortable.min.js', (route) => route.fulfill({ path: path.join(TESTS_DIR, 'mock-sortable.js') }));
	await page.route('**://fonts.googleapis.com/**', (route) => route.fulfill({ body: '' }));
	await page.route('**://fonts.gstatic.com/**', (route) => route.abort());
	await page.goto(`http://localhost:${PORT}/protokol.html`, { waitUntil: 'load' });

	// Overlay açılana kadar kısa bir bekleme (onAuthStateChanged setTimeout(0) ile tetiklenip
	// showLoading() çağırıyor), sonra zaman aşımının GERÇEKTEN dolmasını bekle.
	await page.waitForTimeout(150);
	const duringWait = await page.evaluate(() => ({
		overlayOpenWhileWaiting: document.getElementById('loadingOverlay').classList.contains('open'),
		overlayLabelWhileWaiting: document.getElementById('loadingLabel').textContent
	}));

	await page.waitForTimeout(500); // 400ms zaman aşımının kesin dolması için

	const afterTimeout = await page.evaluate(() => ({
		overlayClosedAfterTimeout: !document.getElementById('loadingOverlay').classList.contains('open'),
		bodyIsReadonly: document.body.classList.contains('is-readonly'),
		currentUserStillNull: currentUser === null,
		// Ana veri dinleyicisi auth'tan bağımsız zaten çalışıyor olmalı -- overlay kapanınca kart listesi görünür olmalı.
		listSwitchVisible: !!document.getElementById('listSwitch')
	}));

	// Bağlantı "sonradan gelirse" (profil callback'i geç de olsa tetiklenirse) sistem doğru rolü
	// yükleyip normal moda dönebilmeli -- zaman aşımı sonrasında callback'in hâlâ işe yaradığını doğrula.
	const lateRecovery = await page.evaluate(async () => {
		currentUser = null; applyPermissions();
		// userProfileCallback modül kapsamında (closure) -- doğrudan erişilemez, bunun yerine
		// gerçek akışı tekrar tetikleyip (yeni bir kullanıcı objesiyle) callback'in normal
		// senaryoda (offline bayrağı KAPALIYKEN) hâlâ çalıştığını göstermek yeterli.
		window.__mockSimulateOfflineHang = false;
		const snap = await database.ref('users/lateUid').once('value');
		// Testin niyeti: cevrimdisi bayragi kalkinca once() ARTIK ASILMIYOR, cozuluyor.
		// Eskiden 'snap.val() === null' diye olculuyordu cunku mock her zaman null
		// donduruyordu; artik __mockOnceSnapshot ile gercek bir profil donebiliyor
		// (shell.js'in onay kapisi rolu once() ile okuyor). O yuzden olcut 'null mi'
		// degil, 'cagri cozuldu mu' olarak duzeltildi.
		return { onceStillWorks: snap !== undefined && typeof snap.val === 'function' };
	});

	await page.close();

	// =====================================================================
	// SENARYO 2: navigator.onLine === false (uçak modunda tarayıcının verdiği SENKRON sinyal) --
	// hiç zaman aşımı beklemeden, ANINDA salt-okunur moda düşülmeli. Bu, gerçek iPhone'da
	// düzeltmeden SONRA bile hâlâ takılma bildirilince eklendi -- muhtemel sebep iOS'un arka
	// planda setTimeout'u duraklatması; navigator.onLine kontrolü buna hiç ihtiyaç duymuyor.
	// =====================================================================
	const page2 = await browser.newPage({ viewport: { width: 1400, height: 900 } });
	const pageErrors2 = [];
	page2.on('pageerror', (e) => pageErrors2.push(e.message));
	await page2.addInitScript(() => {
		// shell.js onay kapisi users/{uid}.once() ile rolu okuyor; bu test cevrimdisi
		// AKISINI olcuyor, onay akisini degil -- onaylanmis bir rol verilmezse kullanici
		// onay-bekliyor.html'e yonlendirilir ve test etmek istedigi ekran hic acilmaz.
		window.__mockOnceSnapshot = { role: 'admin', firstName: 'Test', lastName: 'Kullanici', email: 't@t.c' };
		window.__mockSimulateOfflineHang = true; // profil callback'i yine hiç tetiklenmesin
		window.OFFLINE_FALLBACK_TIMEOUT_MS = 20000; // KASITLI çok uzun -- hızlı yol bunu hiç beklememeli
		Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true });
	});
	await page2.route('**/firebasejs/**/firebase-app-compat.js', (route) => route.fulfill({ path: path.join(TESTS_DIR, 'mock-firebase.js'), contentType: 'application/javascript' }));
	await page2.route('**/firebasejs/**/firebase-database-compat.js', (route) => route.fulfill({ body: '' }));
	await page2.route('**/firebasejs/**/firebase-auth-compat.js', (route) => route.fulfill({ body: '' }));
	await page2.route('**Sortable.min.js', (route) => route.fulfill({ path: path.join(TESTS_DIR, 'mock-sortable.js') }));
	await page2.route('**://fonts.googleapis.com/**', (route) => route.fulfill({ body: '' }));
	await page2.route('**://fonts.gstatic.com/**', (route) => route.abort());
	const t0 = Date.now();
	await page2.goto(`http://localhost:${PORT}/protokol.html`, { waitUntil: 'load' });
	// Overlay'in kapanmasını bekle (poll) -- 20sn'lik yedek zamanlayıcıyı ASLA beklemeden kapanmalı.
	await page2.waitForFunction(() => !document.getElementById('loadingOverlay').classList.contains('open'), { timeout: 3000 });
	const elapsedMs = Date.now() - t0;
	const fastPath = await page2.evaluate(() => ({
		bodyIsReadonly: document.body.classList.contains('is-readonly'),
		currentUserStillNull: currentUser === null
	}));
	await page2.close();

	const results = { duringWait, afterTimeout, lateRecovery, fastPath, elapsedMs, pageErrorsCount: pageErrors.length + pageErrors2.length };
	console.log(JSON.stringify(results, null, 2));
	if (pageErrors.length || pageErrors2.length) { console.log('PAGE ERRORS:'); pageErrors.concat(pageErrors2).forEach((e) => console.log(' - ' + e)); }

	const checks = {
		overlayOpenWhileWaiting: duringWait.overlayOpenWhileWaiting,
		overlayClosedAfterTimeout: afterTimeout.overlayClosedAfterTimeout,
		bodyIsReadonly: afterTimeout.bodyIsReadonly,
		currentUserStillNull: afterTimeout.currentUserStillNull,
		listSwitchVisible: afterTimeout.listSwitchVisible,
		onceStillWorks: lateRecovery.onceStillWorks,
		fastPathBodyIsReadonly: fastPath.bodyIsReadonly,
		fastPathCurrentUserStillNull: fastPath.currentUserStillNull,
		fastPathWasActuallyFast: elapsedMs < 3000, // 20sn yedek zamanlayıcıya kıyasla çok hızlı
		noPageErrors: (pageErrors.length + pageErrors2.length) === 0
	};
	const __boolFails = collectBooleanFailures(checks, []);
	const __allPassed = __boolFails.length === 0;
	console.log('ALL_TESTS_PASSED:', __allPassed);
	if (__boolFails.length) console.log('BASARISIZ ALANLAR:', JSON.stringify(__boolFails));

	await browser.close();
	server.close();
	process.exitCode = __allPassed ? 0 : 1;
})();
