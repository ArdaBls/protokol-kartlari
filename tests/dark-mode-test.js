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
const PORT = 8990;
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

async function routeCommon(page) {
	await page.route('**/firebasejs/**/firebase-app-compat.js', (route) => route.fulfill({ path: path.join(TESTS_DIR, 'mock-firebase.js'), contentType: 'application/javascript' }));
	await page.route('**/firebasejs/**/firebase-database-compat.js', (route) => route.fulfill({ body: '' }));
	await page.route('**/firebasejs/**/firebase-auth-compat.js', (route) => route.fulfill({ body: '' }));
	await page.route('**Sortable.min.js', (route) => route.fulfill({ path: path.join(TESTS_DIR, 'mock-sortable.js') }));
	await page.route('**fuse.js@*/dist/fuse.min.js', (route) => route.fulfill({ body: 'window.Fuse = function(){};', contentType: 'application/javascript' }));
	await page.route('**://fonts.googleapis.com/**', (route) => route.fulfill({ body: '' }));
	await page.route('**://fonts.gstatic.com/**', (route) => route.abort());
}

// WCAG bagil parlaklik/kontrast orani -- tam bir denetim araci degil, secili birkac
// eleman icin acik/koyu temada minimum okunabilirligi dogrulayan hafif bir kontrol.
// Tarayici tarafinda (page.evaluate icinde) calisacak, kendi kendine yeten JS metni.
const CONTRAST_HELPERS_SRC = `
	function luminance(rgb) {
		const a = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
		return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
	}
	function parseColor(str) {
		const m = (str || '').match(/rgba?\\(([^)]+)\\)/);
		if (!m) return [255, 255, 255];
		return m[1].split(',').slice(0, 3).map((s) => parseFloat(s));
	}
	function contrastRatio(c1, c2) {
		const l1 = luminance(parseColor(c1)) + 0.05;
		const l2 = luminance(parseColor(c2)) + 0.05;
		return l1 > l2 ? l1 / l2 : l2 / l1;
	}
`;

(async () => {
	const server = await serve();
	const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
	const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
	const page = await context.newPage();
	const pageErrors = [];
	page.on('pageerror', (e) => pageErrors.push(e.message));
	await routeCommon(page);
	await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });
	await page.waitForTimeout(300);

	// --- 1. Varsayilan: data-theme yok, body acik --paper zemininde ---
	const initial = await page.evaluate(() => ({
		noThemeAttr: document.documentElement.getAttribute('data-theme') === null,
		bodyBgLight: getComputedStyle(document.body).backgroundColor.indexOf('243, 239, 230') !== -1
	}));

	// --- 2. toggleTheme() -> data-theme=dark, localStorage guncellenir, body koyulasir ---
	const toggled = await page.evaluate(() => {
		toggleTheme();
		return {
			attrIsDark: document.documentElement.getAttribute('data-theme') === 'dark',
			localStorageIsDark: localStorage.getItem('omuProtokolTema') === 'dark',
			bodyBgDark: getComputedStyle(document.body).backgroundColor.indexOf('33, 31, 28') !== -1
		};
	});

	// --- 3. Sayfa YENIDEN yuklenince erken <head> scripti data-theme'i DOM hazir olur
	// olmaz (domcontentloaded, ana <script> daha calismadan) zaten uygulamis olmali -- FOUC yok kaniti ---
	await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
	const earlyApplied = await page.evaluate(() => document.documentElement.getAttribute('data-theme') === 'dark');
	await page.waitForTimeout(300);

	// --- 4. Kontrast kontrolu: secili elemanlar HEM acik HEM koyu temada okunur olmali ---
	await page.evaluate(() => {
		currentUser = { uid: 'a1', role: 'admin', firstName: 'Test', lastName: 'Admin', email: 'a@a.com' };
		applyPermissions();
		people = [{ name: 'Kontrast Testi', title: 'Unvan', prefix: '', unit: '', status: 'aktif', rank: 1, photo: '', start: '', end: '', note: '' }];
		render();
	});

	async function measureContrasts() {
		return page.evaluate((helpersSrc) => {
			(new Function(helpersSrc + '; window.__contrastRatio = contrastRatio;'))();
			const contrastRatio = window.__contrastRatio;
			function pairRatio(elSel, bgFromSelf) {
				const el = document.querySelector(elSel);
				if (!el) return null;
				const cs = getComputedStyle(el);
				const ancestor = bgFromSelf ? el : el.closest('.card, .modal, body');
				const bg = getComputedStyle(ancestor).backgroundColor;
				return contrastRatio(cs.color, bg);
			}
			openAddModal();
			// NOT: genel ".modal h2" secici DOM'daki BASKA (kapali) bir modal'in h2'sini
			// bulabiliyordu (querySelector ilk eslesmeyi alir, gorunurluk onemsiz) --
			// #modalTitle ile GERCEKTEN acik olan Ekle/Duzenle modalini hedefliyoruz.
			const modalTitleRatio = pairRatio('#modalTitle', false);
			closeModal();
			return {
				searchInput: pairRatio('#search', true),
				btnPrimary: pairRatio('.btn-primary', true),
				cardName: pairRatio('.card .name', false),
				modalTitle: modalTitleRatio,
				emptyOrPageText: pairRatio('.empty-title', false) || pairRatio('#countLabel', false)
			};
		}, CONTRAST_HELPERS_SRC);
	}

	// Suan dark (2. adimdan beri), sonra light'a gecip tekrar olculecek
	const darkContrasts = await measureContrasts();
	await page.evaluate(() => toggleTheme());
	const lightContrasts = await measureContrasts();

	function passContrast(v) { return typeof v === 'number' && v >= 3.0; } // baslik/buyuk metin icin 3:1 alt sinir, kucuk metin 4.5:1 idealdir ama burada tolerans birakildi

	const SCRATCH = 'C:\\Users\\bilas\\AppData\\Local\\Temp\\claude\\C--WINDOWS-system32\\f46c7e67-c13d-4235-8db2-02595a96a68f\\scratchpad\\';
	await page.screenshot({ path: SCRATCH + 'dark-mode-light-screenshot.png' }).catch(() => {});
	await page.evaluate(() => toggleTheme());
	await page.screenshot({ path: SCRATCH + 'dark-mode-dark-screenshot.png' }).catch(() => {});

	const results = {
		initial,
		toggled,
		earlyApplied,
		darkContrastOk: {
			searchInput: passContrast(darkContrasts.searchInput),
			btnPrimary: passContrast(darkContrasts.btnPrimary),
			cardName: passContrast(darkContrasts.cardName),
			modalTitle: passContrast(darkContrasts.modalTitle),
			emptyOrPageText: passContrast(darkContrasts.emptyOrPageText)
		},
		lightContrastOk: {
			searchInput: passContrast(lightContrasts.searchInput),
			btnPrimary: passContrast(lightContrasts.btnPrimary),
			cardName: passContrast(lightContrasts.cardName),
			modalTitle: passContrast(lightContrasts.modalTitle),
			emptyOrPageText: passContrast(lightContrasts.emptyOrPageText)
		},
		pageErrorsCount: pageErrors.length
	};

	console.log(JSON.stringify({ darkContrasts, lightContrasts, results }, null, 2));
	if (pageErrors.length) { console.log('PAGE ERRORS:'); pageErrors.forEach((e) => console.log(' - ' + e)); }

	const boolFails = collectBooleanFailures(results, []);
	const allPassed = pageErrors.length === 0 && boolFails.length === 0;
	console.log('ALL_TESTS_PASSED:', allPassed);
	if (boolFails.length) console.log('BASARISIZ ALANLAR:', JSON.stringify(boolFails));

	await browser.close();
	server.close();
	process.exitCode = allPassed ? 0 : 1;
})();
