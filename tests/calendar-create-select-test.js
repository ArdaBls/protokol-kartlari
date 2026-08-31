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
const PORT = 8965;
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
	// index.html DEĞİL, doğrudan takvim.html (calendar-resize-test.js'teki AYNI gerekçe --
	// openAdminPanel/openCalendar sayfa-bazlı yönlendirme guard'ları var, ama protokol.html/
	// takvim.html misafir de dahil giriş İSTEMEDİĞİ için burada redirect sorunu YOK).
	await page.goto(`http://localhost:${PORT}/takvim.html`, { waitUntil: 'load' });
	await page.waitForTimeout(300);

	await page.evaluate(() => {
		currentUser = { uid: 'testUid1', role: 'editor', firstName: 'Test', lastName: 'Kullanıcı', email: 'test@test.com' };
		applyPermissions();
		calAnchor = parseKey('2026-01-12');
		calView = 'week';
		calEvents = {};
		renderCalendar();
	});
	await page.waitForTimeout(150);

	// =====================================================================
	// SENARYO 1: gerçek sürükleme -- boş ızgarada 10:00'dan 11:30'a çekilirse
	// modal doğru presetTime/presetEndTime ile açılmalı, silüet kaybolmalı,
	// canlı yayın (mock set()) tetiklenmeli.
	// =====================================================================
	const daycolRect = await page.evaluate(() => document.querySelector('.cal-daycol[data-date="2026-01-12"]').getBoundingClientRect());
	const dragResult = await page.evaluate(({ top }) => {
		const daycol = document.querySelector('.cal-daycol[data-date="2026-01-12"]');
		function fire(type, y, target) {
			const ev = new PointerEvent(type, { bubbles: true, cancelable: true, clientX: 50, clientY: y, pointerId: 1, pointerType: 'mouse' });
			(target || daycol).dispatchEvent(ev);
		}
		const y10 = top + (10 * 60 / 60) * 48; // CAL_HOUR_H=48
		const y1130 = top + (11.5 * 60 / 60) * 48;
		fire('pointerdown', y10, daycol);
		fire('pointermove', y1130, window);
		const ghostExistedDuringDrag = !!document.querySelector('.cal-create-select');
		fire('pointerup', y1130, window);
		// Kullanici istegi (31 Ağustos oturumu sonrası): "etkinlik oluştur ekranı arka planda...
		// seçilen saat aralığını göremedim" -- ghost artık pointerup'ta KALDIRILMIYOR, modal
		// açık kaldığı sürece takvimde (bulanık arka planda) görünmeye devam ediyor.
		const ghostExistsWhileModalOpen = !!document.querySelector('.cal-create-select');
		return { ghostExistedDuringDrag, ghostExistsWhileModalOpen };
	}, { top: daycolRect.top });
	await page.waitForTimeout(80);
	const createTest = await page.evaluate(() => ({
		modalOpen: document.getElementById('eventModalBg').classList.contains('open'),
		dateOk: document.getElementById('ev_tarih').value === '2026-01-12',
		startOk: document.getElementById('ev_saat').value === '10:00',
		endOk: document.getElementById('ev_bitisSaat').value === '11:30',
		broadcastFired: (window.__mockSets || []).some((s) => s.path.indexOf('canliTakvimSecim/testUid1') !== -1 && s.data && s.data.saat === '10:00')
	}));
	// closeEventModal() çağrılınca ghost'un GERÇEKTEN kaldırıldığını da doğrula.
	const afterCloseTest = await page.evaluate(() => {
		closeEventModal();
		return { ghostRemovedAfterModalClose: !document.querySelector('.cal-create-select') };
	});
	const dragScenario = { ...dragResult, ...createTest, ...afterCloseTest };

	// =====================================================================
	// SENARYO 2: kısa tıklama (<3px) -- eski calGridClick davranışı BOZULMAMALI
	// (30dk varsayılan süre, bitisSaat BOŞ).
	// =====================================================================
	await page.evaluate(() => {
		document.getElementById('eventModalBg').classList.remove('open');
		// SENARYO 1'in bıraktığı suppress bayrağı gerçek tarayıcıda pointerup'ı HEMEN izleyen
		// native click ile tüketilirdi -- synthetic PointerEvent'ler böyle bir click TETİKLEMEZ,
		// bu yüzden test ortamında elle sıfırlanır (kod hatası değil, test-ortamı farkı).
		calGridSelectSuppressClick = false;
	});
	const clickResult = await page.evaluate(({ top }) => {
		const daycol = document.querySelector('.cal-daycol[data-date="2026-01-12"]');
		function fire(type, y, target) {
			const ev = new PointerEvent(type, { bubbles: true, cancelable: true, clientX: 50, clientY: y, pointerId: 1, pointerType: 'mouse' });
			(target || daycol).dispatchEvent(ev);
		}
		const y14 = top + (14 * 60 / 60) * 48;
		fire('pointerdown', y14, daycol);
		fire('pointerup', y14, window); // hareket yok -- kısa tıklama
		// Gerçek tarayıcıda pointerup'ı bir 'click' event izler -- doğrudan daycol'da dispatch
		// edilir ki e.target dogal olarak daycol olsun (calGridClick #calendarOverlay'e delege
		// edilmiş click dinleyicisiyle çalışıyor, bubble eder).
		const clickEv = new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 50, clientY: y14 });
		daycol.dispatchEvent(clickEv);
		return {};
	}, { top: daycolRect.top });
	await page.waitForTimeout(80);
	const clickTest = await page.evaluate(() => ({
		modalOpenFromClick: document.getElementById('eventModalBg').classList.contains('open'),
		startIs14: document.getElementById('ev_saat').value === '14:00',
		endIsEmpty: document.getElementById('ev_bitisSaat').value === '' // eski davranış: click'te bitiş HİÇ set edilmez
	}));

	const combined = { dragScenario, clickTest };
	console.log(JSON.stringify(combined, null, 2));
	console.log('PAGE ERRORS:', pageErrors.length);
	pageErrors.forEach((e) => console.log(' -', e));

	const __boolFails = collectBooleanFailures(combined, []);
	const __allPassed = pageErrors.length === 0 && __boolFails.length === 0;
	console.log('ALL_TESTS_PASSED:', __allPassed);
	if (__boolFails.length) console.log('BASARISIZ ALANLAR:', JSON.stringify(__boolFails));

	await browser.close();
	server.close();
	process.exitCode = __allPassed ? 0 : 1;
})();
