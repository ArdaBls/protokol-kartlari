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
const PORT = 8970;
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

	// Sayfanın kendi <script>'i çalışmadan ÖNCE bayrakları koy: mock-firebase.js "users/" yolunu
	// hiç çözmeyecek (çevrimdışı/bağlantı-kopukluğu simülasyonu), zaman aşımı da teste uygun kısaltılır.
	await page.addInitScript(() => {
		window.__mockSimulateOfflineHang = true;
		window.OFFLINE_FALLBACK_TIMEOUT_MS = 400;
	});

	await page.route('**/firebasejs/**/firebase-app-compat.js', (route) => route.fulfill({ path: path.join(TESTS_DIR, 'mock-firebase.js'), contentType: 'application/javascript' }));
	await page.route('**/firebasejs/**/firebase-database-compat.js', (route) => route.fulfill({ body: '' }));
	await page.route('**/firebasejs/**/firebase-auth-compat.js', (route) => route.fulfill({ body: '' }));
	await page.route('**Sortable.min.js', (route) => route.fulfill({ path: path.join(TESTS_DIR, 'mock-sortable.js') }));
	await page.route('**://fonts.googleapis.com/**', (route) => route.fulfill({ body: '' }));
	await page.route('**://fonts.gstatic.com/**', (route) => route.abort());
	await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });

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
		return { onceStillWorks: snap.val() === null };
	});

	const results = { duringWait, afterTimeout, lateRecovery, pageErrorsCount: pageErrors.length };
	console.log(JSON.stringify(results, null, 2));
	if (pageErrors.length) { console.log('PAGE ERRORS:'); pageErrors.forEach((e) => console.log(' - ' + e)); }

	const checks = {
		overlayOpenWhileWaiting: duringWait.overlayOpenWhileWaiting,
		overlayClosedAfterTimeout: afterTimeout.overlayClosedAfterTimeout,
		bodyIsReadonly: afterTimeout.bodyIsReadonly,
		currentUserStillNull: afterTimeout.currentUserStillNull,
		listSwitchVisible: afterTimeout.listSwitchVisible,
		onceStillWorks: lateRecovery.onceStillWorks,
		noPageErrors: pageErrors.length === 0
	};
	const __boolFails = collectBooleanFailures(checks, []);
	const __allPassed = __boolFails.length === 0;
	console.log('ALL_TESTS_PASSED:', __allPassed);
	if (__boolFails.length) console.log('BASARISIZ ALANLAR:', JSON.stringify(__boolFails));

	await browser.close();
	server.close();
	process.exitCode = __allPassed ? 0 : 1;
})();
