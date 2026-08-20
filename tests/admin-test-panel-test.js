const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');
const TESTS_DIR = __dirname;
const SITE_ROOT = path.join(__dirname, '..'); // index.html repo kokunde, tests/ altinda degil
const PORT = 8965;
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
	const page = await browser.newPage();
	const pageErrors = [];
	page.on('pageerror', (e) => pageErrors.push(e.message));
	await page.route('**/firebasejs/**/firebase-app-compat.js', (route) => route.fulfill({ path: path.join(TESTS_DIR, 'mock-firebase.js'), contentType: 'application/javascript' }));
	await page.route('**/firebasejs/**/firebase-database-compat.js', (route) => route.fulfill({ body: '' }));
	await page.route('**/firebasejs/**/firebase-auth-compat.js', (route) => route.fulfill({ body: '' }));
	await page.route('**Sortable.min.js', (route) => route.fulfill({ path: path.join(TESTS_DIR, 'mock-sortable.js') }));
	await page.route('**://fonts.googleapis.com/**', (route) => route.fulfill({ body: '' }));
	await page.route('**://fonts.gstatic.com/**', (route) => route.abort());

	// GitHub API'sini kontrollu yanitlarla mockluyoruz - senaryo basina degisecek.
	let mockApiResponse = { status: 200, body: { workflow_runs: [] } };
	await page.route('**api.github.com/repos/**/actions/workflows/**/runs**', (route) => {
		route.fulfill({ status: mockApiResponse.status, contentType: 'application/json', body: JSON.stringify(mockApiResponse.body) });
	});

	await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });
	await page.waitForTimeout(300);

	// --- Yetkisiz (editor) kullanici: sekmeye gecemez, fonksiyonlar sessizce no-op olmali ---
	const nonAdminGuardTest = await page.evaluate(() => {
		currentUser = { role: 'editor', firstName: 'Editor', lastName: 'Kullanici', email: 'ed@test.com' };
		applyPermissions();
		let opened = false;
		const origOpen = window.open;
		window.open = () => { opened = true; };
		openRegressionTestRunner();
		window.open = origOpen;
		return { openBlockedForEditor: !opened };
	});

	// --- Admin: sekme acilip DOM dogru gosteriliyor mu ---
	const tabSwitchTest = await page.evaluate(() => {
		currentUser = { role: 'admin', firstName: 'Admin', lastName: 'Kullanici', email: 'admin@test.com' };
		applyPermissions();
		openAdminPanel();
		switchAdminTab('test');
		return {
			viewVisible: document.getElementById('adminTestView').style.display === 'block',
			otherViewsHidden: document.getElementById('adminUsersView').style.display === 'none' && document.getElementById('adminLogsView').style.display === 'none' && document.getElementById('adminEventsBackupView').style.display === 'none',
			tabBtnActive: document.getElementById('adminTabTestBtn').classList.contains('btn-primary')
		};
	});

	// --- openRegressionTestRunner: dogru URL ile window.open cagriliyor mu ---
	const openRunnerTest = await page.evaluate(() => {
		let openedUrl = null;
		const origOpen = window.open;
		window.open = (url) => { openedUrl = url; };
		openRegressionTestRunner();
		window.open = origOpen;
		return {
			openedUrl,
			correctUrl: openedUrl === 'https://github.com/ArdaBls/protokol-kartlari/actions/workflows/regresyon-testi.yml'
		};
	});

	// --- Senaryo: hic calistirilmamis (workflow_runs bos) ---
	mockApiResponse = { status: 200, body: { workflow_runs: [] } };
	const neverRunTest = await page.evaluate(async () => {
		await loadAdminTestPanel();
		return { text: document.getElementById('adminTestResult').innerHTML };
	});

	// --- Senaryo: basarili son calistirma ---
	mockApiResponse = { status: 200, body: { workflow_runs: [{ status: 'completed', conclusion: 'success', created_at: '2026-08-20T12:00:00Z', run_number: 7, html_url: 'https://github.com/ArdaBls/protokol-kartlari/actions/runs/123' }] } };
	const successRunTest = await page.evaluate(async () => {
		await loadAdminTestPanel();
		const html = document.getElementById('adminTestResult').innerHTML;
		return {
			mentionsSuccess: html.includes('Başarılı'),
			hasRunNumber: html.includes('#7'),
			hasLink: html.includes('https://github.com/ArdaBls/protokol-kartlari/actions/runs/123')
		};
	});

	// --- Senaryo: basarisiz son calistirma ---
	mockApiResponse = { status: 200, body: { workflow_runs: [{ status: 'completed', conclusion: 'failure', created_at: '2026-08-20T13:00:00Z', run_number: 8, html_url: 'https://github.com/ArdaBls/protokol-kartlari/actions/runs/124' }] } };
	const failureRunTest = await page.evaluate(async () => {
		await loadAdminTestPanel();
		return { mentionsFailure: document.getElementById('adminTestResult').innerHTML.includes('Başarısız') };
	});

	// --- Senaryo: hala calisiyor (in_progress) ---
	mockApiResponse = { status: 200, body: { workflow_runs: [{ status: 'in_progress', conclusion: null, created_at: '2026-08-20T14:00:00Z', run_number: 9, html_url: 'https://github.com/ArdaBls/protokol-kartlari/actions/runs/125' }] } };
	const inProgressTest = await page.evaluate(async () => {
		await loadAdminTestPanel();
		return { mentionsRunning: document.getElementById('adminTestResult').innerHTML.includes('Çalışıyor') };
	});

	// --- Senaryo: API hatasi (HTTP 403 - rate limit vb.) zarifce ele alinmali, sayfa cokmemeli ---
	mockApiResponse = { status: 403, body: { message: 'rate limited' } };
	const apiErrorTest = await page.evaluate(async () => {
		await loadAdminTestPanel();
		const text = document.getElementById('adminTestResult').textContent;
		return { showsHttpErrorGracefully: text.includes('403'), noCrash: true };
	});

	// --- XSS regresyonu: html_url icine kotu amacli metin gelirse escapeHtml onu etkisiz kilmali ---
	mockApiResponse = { status: 200, body: { workflow_runs: [{ status: 'completed', conclusion: 'success', created_at: '2026-08-20T15:00:00Z', run_number: 10, html_url: '"><img src=x onerror=window.__xssRan2=true>' }] } };
	const xssTest = await page.evaluate(async () => {
		window.__xssRan2 = false;
		await loadAdminTestPanel();
		await new Promise(r => setTimeout(r, 50));
		return { xssDidNotExecute: window.__xssRan2 === false, outputEscaped: !document.getElementById('adminTestResult').innerHTML.includes('<img') };
	});

	const combined = { nonAdminGuardTest, tabSwitchTest, openRunnerTest, neverRunTest, successRunTest, failureRunTest, inProgressTest, apiErrorTest, xssTest };
	console.log(JSON.stringify(combined, null, 2));
	console.log('PAGE ERRORS:', pageErrors.length);
	pageErrors.forEach(e => console.log(' -', e));

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
	const __boolFails = collectBooleanFailures(combined, []);
	const __allPassed = pageErrors.length === 0 && __boolFails.length === 0;
	console.log('ALL_TESTS_PASSED:', __allPassed);
	if (__boolFails.length) console.log('BASARISIZ ALANLAR:', JSON.stringify(__boolFails));

	await browser.close();
	server.close();
	process.exitCode = __allPassed ? 0 : 1;
})();
