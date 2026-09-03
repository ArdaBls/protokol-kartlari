/*
  Mobil "dokunma hedefi" testleri (2026-08-26).

  Bu dosya iki GERCEK, kullanicinin bildirdigi hatayi kalici olarak kilitler:

  1) KILIT IKONU EKRANI KAPATIYOR: .cal-lock-ico'nun dokunma alanini genisleten ::after
     position:absolute. Ikon bazi baglamlarda (.cal-allday-chip / .cal-block.compact)
     position:static yapiliyordu; static oge kapsayici blok OLUSTURMADIGI icin ::after
     ikona degil, agacta yukaridaki ilk konumlandirilmis ataya gore yayiliyor ve
     inset:-6px ile TUM EKRANI kaplayan gorunmez bir katmana donusuyordu. Sonuc:
     "tam gün kısmında bir etkinlik varsa kilit işareti sayfayı kilitliyor, sağa sola
     hareket etmiyor, çarpı ile çıkamıyorsun."
     Test: takvimin ortasindaki ve ust bardaki noktalarda elementFromPoint GERCEKTEN
     o noktadaki ogeyi dondurmeli -- kilit ikonunu DEGIL.

  2) GOREV GECMISI OKU MOBILDE KAYBOLUYOR: .modal DOM'da .history-toggle'dan SONRA
     geliyor ve ikisi de z-index:auto ile konumlandirilmis -- boyama sirasi DOM sirasi
     oldugu icin .modal butonun uzerine biniyordu. Masaustunde buton modalin DISINDA
     (left:-32px) durdugu icin fark edilmiyordu, mobilde (left:14px) tam ustune geliyor.
     Test: butonun merkezinde elementFromPoint butonun KENDISINI dondurmeli.
*/
const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');

const TESTS_DIR = __dirname;
const SITE_ROOT = path.join(__dirname, '..', 'docs');
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
	// hasTouch + isMobile => @media (pointer: coarse) kurallari GERCEKTEN etkin olur;
	// ::after dokunma alani genisletmesi sadece o media query icinde tanimli.
	const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
	const page = await context.newPage();
	const pageErrors = [];
	page.on('pageerror', (e) => pageErrors.push(e.message));
	await page.route('**/firebasejs/**/firebase-app-compat.js', (route) => route.fulfill({ path: path.join(TESTS_DIR, 'mock-firebase.js'), contentType: 'application/javascript' }));
	await page.route('**/firebasejs/**/firebase-database-compat.js', (route) => route.fulfill({ body: '' }));
	await page.route('**/firebasejs/**/firebase-auth-compat.js', (route) => route.fulfill({ body: '' }));
	await page.route('**://fonts.googleapis.com/**', (route) => route.fulfill({ body: '' }));
	await page.route('**://fonts.gstatic.com/**', (route) => route.abort());
	// index.html DEĞİL, takvim.html -- 30 Ağustos 2026'daki çok sayfalı mimari geçişinden
	// (index.html artık SADECE giriş/kayıt ekranı) SONRA openCalendar() PAGE!=="takvim" iken
	// gerçek bir location.href yönlendirmesi yapıyor (bkz. app.js:4182), bu test o zaman
	// güncellenmemişti. Modal/kişi düzenleme testi (Senaryo 2) DOM'u her sayfada aynı olduğu
	// için (sadece CSS ile gizleniyor) takvim.html'de de sorunsuz çalışır.
	await page.goto(`http://localhost:${PORT}/takvim.html`, { waitUntil: 'load' });
	await page.waitForTimeout(500);

	// pointer:coarse gercekten aktif mi? (aktif degilse bu testin tamami anlamsiz olurdu)
	const coarseActive = await page.evaluate(() => window.matchMedia('(pointer: coarse)').matches);

	// --- SENARYO 1: tum-gun etkinligi olan takvimde kilit ikonu ekrani kapatmamali ---
	await page.evaluate(() => {
		currentUser = { role: 'editor', firstName: 'Test', lastName: 'Kullanici', email: 'test@test.com' };
		applyPermissions();
		calAnchor = parseKey('2026-01-12');
		calView = 'week';
		calEvents = {
			'evAllDay': { ad: 'Tum Gun Etkinlik', tur: 'diger', durum: 'planlandi', tarih: '2026-01-12', saat: '', bitisSaat: '', locked: false, yer: '', birim: '', planlayan: '', gorevli: '', not: '' }
		};
		// openCalendar() DEGIL, dogrudan renderCalendar() -- takvim.html kendi otomatik
		// acilisiyla openCalendar()'i SAYFA YUKLENIRKEN zaten cagirmis oluyor (routeForCurrentPage),
		// ikinci cagri "zaten acik" guard'ina takilip no-op olur ve yeni calEvents hic cizilmez
		// (calendar-resize-test.js'teki AYNI cozum).
		renderCalendar();
	});
	await page.waitForTimeout(400);

	const lockHitTest = await page.evaluate(() => {
		const chip = document.querySelector('.cal-allday-chip[data-evid="evAllDay"]');
		const ico = chip ? chip.querySelector('.cal-lock-ico') : null;
		const icoRect = ico ? ico.getBoundingClientRect() : null;

		// Ikonun ::after'i dogru calisiyorsa, ikonun KENDI kutusundan uzaktaki noktalar
		// asla ikonu dondurmemeli. Takvimin ortasi + alt kismi + ust bar orneklenir.
		const probes = [
			{ name: 'izgara-ortasi', x: 195, y: 500 },
			{ name: 'izgara-alti', x: 195, y: 700 },
			{ name: 'sol-kenar', x: 30, y: 600 },
			{ name: 'sag-kenar', x: 360, y: 600 }
		];
		const results = probes.map((p) => {
			const el = document.elementFromPoint(p.x, p.y);
			return {
				name: p.name,
				hitsLockIcon: !!(el && el.closest && el.closest('.cal-lock-ico'))
			};
		});

		// Ikonun KENDI merkezine dokunmak ise ikonu (veya ::after'i) dondurmeli -- yani
		// dokunma alani genisletmesi tamamen kaybolmamis olmali.
		let iconOwnCenterHits = false;
		if (icoRect && icoRect.width > 0) {
			const el = document.elementFromPoint(icoRect.x + icoRect.width / 2, icoRect.y + icoRect.height / 2);
			iconOwnCenterHits = !!(el && el.closest && el.closest('.cal-lock-ico'));
		}

		return {
			chipFound: !!chip,
			iconFound: !!ico,
			iconComputedPosition: ico ? getComputedStyle(ico).position : null,
			anyProbeHitsLockIcon: results.some((r) => r.hitsLockIcon),
			probes: results,
			iconOwnCenterHits
		};
	});

	// Takvimi kapat (sonraki senaryo modal aciyor)
	// closeCalendar() DEGIL -- takvim.html'de PAGE==="takvim" oldugu icin gercek bir
	// location.href="protokol.html" yonlendirmesi yapar (bkz. app.js), bu da context'i yok
	// eder. Sadece gorsel olarak kapatmak icin alt-seviye _hideCalendarOverlay() kullanilir.
	await page.evaluate(() => { if (typeof _hideCalendarOverlay === 'function') _hideCalendarOverlay(); });
	await page.waitForTimeout(400);

	// --- SENARYO 2: mobilde Gorev Gecmisi oku modalin ustunde ve tiklanabilir olmali ---
	const historyToggleTest = await page.evaluate(async () => {
		people = {
			pid1: { name: 'Test Kisi', title: 'Unvan', prefix: '', unit: '', status: 'aktif', rank: 1, photo: '', start: '', end: '', note: '', gorevGecmisi: [] }
		};
		render();
		openEditModal('pid1');
		await new Promise((r) => setTimeout(r, 250));
		const btn = document.getElementById('historyToggleBtn');
		const shown = btn && getComputedStyle(btn).display !== 'none';
		if (!shown) return { shown: false };
		const r = btn.getBoundingClientRect();
		const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
		const topEl = document.elementFromPoint(cx, cy);
		return {
			shown: true,
			hasSize: r.width > 0 && r.height > 0,
			// Butonun merkezinde EN USTTEKI oge butonun kendisi olmali -- .modal degil.
			topmostIsButton: !!(topEl && topEl.closest && topEl.closest('#historyToggleBtn')),
			topmostClass: topEl ? (topEl.className || topEl.tagName) : null,
			zIndex: getComputedStyle(btn).zIndex
		};
	});

	const out = { coarseActive, lockHitTest, historyToggleTest };
	console.log(JSON.stringify(out, null, 2));

	const failures = [];
	if (!coarseActive) failures.push('pointer:coarse etkin degil -- test ortami hatali');
	if (!lockHitTest.chipFound || !lockHitTest.iconFound) failures.push('tum-gun chip/kilit ikonu bulunamadi');
	if (lockHitTest.iconComputedPosition === 'static') failures.push('kilit ikonu HALA position:static -- ::after ekrani kaplar');
	if (lockHitTest.anyProbeHitsLockIcon) failures.push('kilit ikonu kendi disindaki noktalari yakaliyor (ekrani kapatiyor): ' + JSON.stringify(lockHitTest.probes));
	if (!lockHitTest.iconOwnCenterHits) failures.push('kilit ikonu KENDI merkezinde bile yakalanamiyor -- dokunma alani tamamen kayboldu');
	if (!historyToggleTest.shown) failures.push('Gorev Gecmisi oku gorunmuyor');
	else if (!historyToggleTest.topmostIsButton) failures.push('Gorev Gecmisi oku modalin ALTINDA kaliyor (ustteki oge: ' + historyToggleTest.topmostClass + ')');

	console.log('PAGE ERRORS:', pageErrors.length);
	pageErrors.forEach((e) => console.log(' -', e));
	const ok = failures.length === 0 && pageErrors.length === 0;
	console.log('ALL_TESTS_PASSED:', ok);
	if (failures.length) console.log('BASARISIZ:', JSON.stringify(failures, null, 2));

	await browser.close();
	server.close();
	process.exitCode = ok ? 0 : 1;
})();
