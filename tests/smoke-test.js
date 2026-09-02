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
const PORT = 8934;

function serve() {
	const server = http.createServer((req, res) => {
		let p = decodeURIComponent(req.url.split('?')[0]);
		if (p === '/') p = '/index.html';
		const fp = path.join(SITE_ROOT, p);
		fs.readFile(fp, (err, data) => {
			if (err) { res.writeHead(404); res.end('not found: ' + p); return; }
			const ext = path.extname(fp);
			const type = ext === '.html' ? 'text/html' : ext === '.js' ? 'application/javascript' : ext === '.css' ? 'text/css' : ext === '.json' ? 'application/json' : ext === '.png' ? 'image/png' : 'text/plain';
			res.writeHead(200, { 'Content-Type': type });
			res.end(data);
		});
	});
	return new Promise((resolve) => server.listen(PORT, () => resolve(server)));
}

(async () => {
	const server = await serve();
	const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
	const context = await browser.newContext();
	const page = await context.newPage();

	const consoleErrors = [];
	const pageErrors = [];

	page.on('console', (msg) => {
		if (msg.type() === 'error') consoleErrors.push(msg.text());
	});
	page.on('pageerror', (err) => {
		pageErrors.push(err.message + '\n' + (err.stack || ''));
	});
	const failedRequests = [];
	page.on('requestfailed', (req) => {
		failedRequests.push(req.url() + ' :: ' + (req.failure() && req.failure().errorText));
	});
	page.on('response', (res) => {
		if (res.status() >= 400) failedRequests.push(res.url() + ' :: HTTP ' + res.status());
	});
	const allRequests = [];
	page.on('request', (req) => { allRequests.push(req.method() + ' ' + req.url()); });

	// CDN isteklerini yerel mock dosyalara yönlendir
	await page.route('**/firebasejs/**/firebase-app-compat.js', (route) => route.fulfill({ path: path.join(TESTS_DIR, 'mock-firebase.js'), contentType: 'application/javascript' }));
	await page.route('**/firebasejs/**/firebase-database-compat.js', (route) => route.fulfill({ body: '// no-op (mock-firebase.js zaten window.firebase tanımlıyor)', contentType: 'application/javascript' }));
	await page.route('**/firebasejs/**/firebase-auth-compat.js', (route) => route.fulfill({ body: '// no-op (mock-firebase.js zaten window.firebase tanımlıyor)', contentType: 'application/javascript' }));
	await page.route('**Sortable.min.js', (route) => route.fulfill({ path: path.join(TESTS_DIR, 'mock-sortable.js'), contentType: 'application/javascript' }));
	// Google Fonts / preconnect isteklerini boşa çıkar (ağ izolasyonunda takılmasın)
	await page.route('**://fonts.googleapis.com/**', (route) => route.fulfill({ body: '', contentType: 'text/css' }));
	await page.route('**://fonts.gstatic.com/**', (route) => route.abort());

	// index.html artık admin paneline yönlendiren bir kök yönlendirme dosyası (kullanıcı isteği:
	// admin paneli sitenin yeni ana giriş noktası) -- app.js'in gerçek işlevselliğini taşıyan
	// sayfa artık protokol.html (index.html ile birebir aynı app.js/style.css'i paylaşıyordu).
	await page.goto(`http://localhost:${PORT}/protokol.html`, { waitUntil: 'load', timeout: 30000 });

	// Uygulamanın render olması için kısa bekleme
	await page.waitForTimeout(1500);

	const checks = await page.evaluate(() => {
		const out = {};
		out.title = document.title;
		out.hasFirebaseMock = typeof window.firebase !== 'undefined';
		out.bodyReadonly = document.body.classList.contains('is-readonly');
		out.cardGridExists = !!document.querySelector('#grid, #cardGrid, .card-grid');
		out.calendarRailExists = !!document.getElementById('calendarOverlay') || !!document.querySelector('[id*="cal" i]');
		out.hasPeopleArrayFn = typeof window.render === 'function' || typeof render === 'function';
		out.functionsDefined = {};
		['render', 'openEditModal', 'saveForm', 'generateNewsText', 'attachEventsListener', 'renderCalendarRail', 'renderWeekView', 'renderMonthView', 'renderListView', 'openCalendar', 'closeCalendar', 'requireEdit', 'requireAdmin', 'applyPermissions', 'openLegalModal', 'fillNewsTemplateSelect'].forEach((fn) => {
			out.functionsDefined[fn] = typeof window[fn] === 'function';
		});
		out.bodyHTMLLength = document.body.innerHTML.length;
		out.visibleTextSample = document.body.innerText.slice(0, 300);
		return out;
	});

	console.log('=== SONUÇLAR ===');
	console.log(JSON.stringify(checks, null, 2));
	console.log('\n=== CONSOLE ERRORS (' + consoleErrors.length + ') ===');
	consoleErrors.forEach((e) => console.log(' - ' + e));
	console.log('\n=== PAGE ERRORS (' + pageErrors.length + ') ===');
	pageErrors.forEach((e) => console.log(' - ' + e));
	console.log('\n=== FAILED/4xx-5xx REQUESTS (' + failedRequests.length + ') ===');
	failedRequests.forEach((e) => console.log(' - ' + e));
	console.log('\n=== ALL REQUESTS (' + allRequests.length + ') ===');
	allRequests.forEach((e) => console.log(' - ' + e));

	// Takvimi açmayı dene (buton varsa)
	try {
		const calBtn = await page.$('#calendarRail, [onclick*="openCalendar"], button:has-text("Takvim")');
		if (calBtn) {
			await calBtn.click({ timeout: 3000 }).catch(() => {});
			await page.waitForTimeout(800);
		}
	} catch (e) {
		console.log('Takvim açma denemesi hata verdi (kritik değil):', e.message);
	}

	await page.screenshot({ path: path.join(TESTS_DIR, 'smoke-screenshot.png'), fullPage: false });


	const __boolFails = collectBooleanFailures(checks, []);
	const __allPassed = pageErrors.length === 0 && __boolFails.length === 0;
	console.log('ALL_TESTS_PASSED:', __allPassed);
	if (__boolFails.length) console.log('BASARISIZ ALANLAR:', JSON.stringify(__boolFails));

	await browser.close();
	server.close();

	process.exitCode = __allPassed ? 0 : 1;
})();
