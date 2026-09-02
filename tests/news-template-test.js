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
const PORT = 8954;
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
	await page.route('**/firebasejs/**/firebase-app-compat.js', (route) => route.fulfill({ path: path.join(TESTS_DIR, 'mock-firebase.js'), contentType: 'application/javascript' }));
	await page.route('**/firebasejs/**/firebase-database-compat.js', (route) => route.fulfill({ body: '' }));
	await page.route('**/firebasejs/**/firebase-auth-compat.js', (route) => route.fulfill({ body: '' }));
	await page.route('**Sortable.min.js', (route) => route.fulfill({ path: path.join(TESTS_DIR, 'mock-sortable.js') }));
	await page.route('**://fonts.googleapis.com/**', (route) => route.fulfill({ body: '' }));
	await page.route('**://fonts.gstatic.com/**', (route) => route.abort());
	await page.goto(`http://localhost:${PORT}/protokol.html`, { waitUntil: 'load' });
	await page.waitForTimeout(300);

	const result = await page.evaluate(() => {
		const out = {};
		out.defaultTemplateCount = Array.isArray(DEFAULT_NEWS_TEMPLATES) ? DEFAULT_NEWS_TEMPLATES.length : null;
		out.newsTemplatesCount = Array.isArray(newsTemplates) ? newsTemplates.length : null;

		// Dropdown'u doldur ve seçenek sayısını kontrol et
		fillNewsTemplateSelect();
		const sel = document.getElementById('newsTemplateSelect');
		out.selectExists = !!sel;
		out.selectOptionCount = sel ? sel.options.length : 0;
		out.selectOptionLabels = sel ? Array.from(sel.options).map(o => o.textContent) : [];

		// currentTemplate() geçerli bir şablon döndürüyor mu
		const tpl = currentTemplate();
		out.currentTemplateOk = !!(tpl && typeof tpl.metin === 'string' && tpl.metin.length > 0);
		out.currentTemplateSample = tpl ? tpl.metin.slice(0, 80) : null;

		// applyTemplate ile gerçek metin üretimi
		const ctx = { kisiler: 'Rektör Prof. Dr. Test Kişi', kisilerDuz: 'Test Kişi', ilkKisi: 'Test Kişi', ilkKisiIn: "'nin",
			digerKisiler: '', yer: 'Senato Salonu', gruplar: '', etkinlik: 'Test Etkinliği', birim: 'Rektörlük', tarih: '2026-09-01' };
		out.appliedText = applyTemplate(tpl.metin, ctx);
		out.appliedTextOk = typeof out.appliedText === 'string' && out.appliedText.length > 0 && !out.appliedText.includes('undefined');

		// generateNewsText uçtan uca: kişi seçili değilken hata toast'ı, seçiliyken haber modalı açılıyor mu
		newsPeopleOverride = [{ prefix: 'Prof. Dr.', name: 'Test Kişi', title: 'Rektör' }];
		document.getElementById('newsEtkinlikInput') && (document.getElementById('newsEtkinlikInput').value = 'Test Etkinliği');
		document.getElementById('newsLocationInput') && (document.getElementById('newsLocationInput').value = 'Senato Salonu');
		generateNewsText();
		out.newsModalOpenAfterGenerate = document.getElementById('newsModalBg').classList.contains('open');
		out.newsOutputText = document.getElementById('newsOutputText') ? document.getElementById('newsOutputText').value : null;

		// generateNewsFromEvent (takvim etkinliğinden haber) fonksiyonu var mı ve çağrılabiliyor mu
		out.generateNewsFromEventIsFn = typeof generateNewsFromEvent === 'function';

		return out;
	});

	console.log(JSON.stringify(result, null, 2));
	console.log('PAGE ERRORS:', pageErrors.length);
	pageErrors.forEach(e => console.log(' -', e));

	const __boolFails = collectBooleanFailures(result, []);
	const __allPassed = pageErrors.length === 0 && __boolFails.length === 0;
	console.log('ALL_TESTS_PASSED:', __allPassed);
	if (__boolFails.length) console.log('BASARISIZ ALANLAR:', JSON.stringify(__boolFails));

	await browser.close();
	server.close();
	process.exitCode = __allPassed ? 0 : 1;
})();
