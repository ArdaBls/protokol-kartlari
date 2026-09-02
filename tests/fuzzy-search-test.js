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
const PORT = 8991;
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
	// Gercek Fuse.js -- CDN'e cikmadan, npm'den kurulu yerel kopyadan servis edilir (hermetik test).
	await page.route('**fuse.js@*/dist/fuse.min.js', (route) => route.fulfill({ path: path.join(TESTS_DIR, 'node_modules', 'fuse.js', 'dist', 'fuse.min.js'), contentType: 'application/javascript' }));
	await page.route('**://fonts.googleapis.com/**', (route) => route.fulfill({ body: '' }));
	await page.route('**://fonts.gstatic.com/**', (route) => route.abort());
	await page.goto(`http://localhost:${PORT}/protokol.html`, { waitUntil: 'load' });
	await page.waitForTimeout(300);

	await page.evaluate(() => {
		currentUser = { uid: 'a1', role: 'admin', firstName: 'T', lastName: 'A', email: 'a@a.com' };
		applyPermissions();
		people = [
			{ name: 'Mehmet Yılmaz', title: 'Rektör Yardımcısı', prefix: 'Prof. Dr.', unit: 'OMÜ', status: 'aktif', rank: 1, photo: '', start: '', end: '', note: '' },
			{ name: 'Ayşe Kaya', title: 'Dekan', prefix: 'Doç. Dr.', unit: 'Tıp Fakültesi', status: 'aktif', rank: 2, photo: '', start: '', end: '', note: '' },
			{ name: 'Fatma Demir', title: 'Genel Sekreter', prefix: '', unit: 'Rektörlük', status: 'aktif', rank: 3, photo: '', start: '', end: '', note: '' }
		];
		render();
	});

	function search(q) {
		return page.evaluate((q) => {
			document.getElementById('search').value = q;
			render();
			return Array.from(document.querySelectorAll('.card .name')).map((el) => el.textContent);
		}, q);
	}

	// --- F-1: Fuse tanimli, temel arama calisiyor ---
	const fuseDefined = await page.evaluate(() => typeof window.Fuse === 'function');

	// --- F-2: DOGRU yazim -- eski duz-substring kod da bunu bulurdu, regresyon guvenligi ---
	const exactMatch = await search('mehmet');

	// --- F-3: YANLIS yazim (bulanik esleme) -- eski duz-substring kod BULAMAZDI, yeni kod bulmali ---
	const typoMatch = await search('mehmt yilmz');

	// --- F-4: alakasiz sorgu hicbir seyi YANLIŞLIKLA eslemez (esik cok gevsek degil) ---
	const noiseMatch = await search('zzqqxx000');

	// --- F-5: bos sorgu TUM kayitlari gosterir (eski davranisla ayni) ---
	const emptyMatch = await search('');

	// --- F-6: unvan/birim alaninda da arama calisiyor ---
	const unitMatch = await search('rektörlük');

	await page.close();

	// --- F-7: performans -- ~400 sentetik kayitla tek render() suresi ---
	const perfPage = await browser.newPage({ viewport: { width: 1400, height: 900 } });
	await perfPage.route('**/firebasejs/**/firebase-app-compat.js', (route) => route.fulfill({ path: path.join(TESTS_DIR, 'mock-firebase.js'), contentType: 'application/javascript' }));
	await perfPage.route('**/firebasejs/**/firebase-database-compat.js', (route) => route.fulfill({ body: '' }));
	await perfPage.route('**/firebasejs/**/firebase-auth-compat.js', (route) => route.fulfill({ body: '' }));
	await perfPage.route('**Sortable.min.js', (route) => route.fulfill({ path: path.join(TESTS_DIR, 'mock-sortable.js') }));
	await perfPage.route('**fuse.js@*/dist/fuse.min.js', (route) => route.fulfill({ path: path.join(TESTS_DIR, 'node_modules', 'fuse.js', 'dist', 'fuse.min.js'), contentType: 'application/javascript' }));
	await perfPage.route('**://fonts.googleapis.com/**', (route) => route.fulfill({ body: '' }));
	await perfPage.route('**://fonts.gstatic.com/**', (route) => route.abort());
	await perfPage.goto(`http://localhost:${PORT}/protokol.html`, { waitUntil: 'load' });
	await perfPage.waitForTimeout(300);
	const perfMs = await perfPage.evaluate(() => {
		currentUser = { uid: 'a1', role: 'admin', firstName: 'T', lastName: 'A', email: 'a@a.com' };
		applyPermissions();
		const names = ['Mehmet', 'Ayşe', 'Fatma', 'Ali', 'Zeynep', 'Hüseyin', 'Elif', 'Mustafa', 'Emine', 'Kemal'];
		const surnames = ['Yılmaz', 'Kaya', 'Demir', 'Şahin', 'Çelik', 'Yıldız', 'Aydın', 'Öztürk', 'Arslan', 'Doğan'];
		people = [];
		for (let i = 0; i < 400; i++) {
			people.push({ name: names[i % names.length] + ' ' + surnames[(i * 3) % surnames.length] + ' ' + i, title: 'Unvan ' + i, prefix: '', unit: 'Birim ' + (i % 20), status: 'aktif', rank: (i % 30) + 1, photo: '', start: '', end: '', note: '' });
		}
		document.getElementById('search').value = 'yilmz'; // bulanik sorgu, en agir yol
		const t0 = performance.now();
		render();
		return performance.now() - t0;
	});
	await perfPage.close();

	function containsName(list, needle) { return list.some((n) => n.indexOf(needle) !== -1); }

	const results = {
		fuseDefined,
		exactMatchFindsPerson: containsName(exactMatch, 'Mehmet Yılmaz'),
		typoMatchFindsPerson: containsName(typoMatch, 'Mehmet Yılmaz'),
		noiseMatchFindsNothing: noiseMatch.length === 0,
		emptyMatchFindsAll: emptyMatch.length === 3,
		unitMatchFindsPerson: containsName(unitMatch, 'Fatma Demir'),
		perfUnder150ms: perfMs < 150,
		pageErrorsCount: pageErrors.length
	};

	console.log(JSON.stringify({ exactMatch, typoMatch, noiseMatch, emptyMatch, unitMatch, perfMs, results }, null, 2));
	if (pageErrors.length) { console.log('PAGE ERRORS:'); pageErrors.forEach((e) => console.log(' - ' + e)); }

	const boolFails = collectBooleanFailures(results, []);
	const allPassed = pageErrors.length === 0 && boolFails.length === 0;
	console.log('ALL_TESTS_PASSED:', allPassed);
	if (boolFails.length) console.log('BASARISIZ ALANLAR:', JSON.stringify(boolFails));

	await browser.close();
	server.close();
	process.exitCode = allPassed ? 0 : 1;
})();
