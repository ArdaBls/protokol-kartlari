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
const PORT = 8977;
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
	// serviceWorkers:'block' -- bkz. admin-test-panel-test.js'teki AYNI not (SW aktifleşince
	// bazı fetch'ler page.route() mock'unu atlayabiliyor; bu testte dış istek yok ama proje
	// genelinde artık standart hale getirildi).
	const page = await browser.newPage({ serviceWorkers: 'block', viewport: { width: 1400, height: 900 } });
	const pageErrors = [];
	page.on('pageerror', (e) => pageErrors.push(e.message));
	await page.route('**/firebasejs/**/firebase-app-compat.js', (route) => route.fulfill({ path: path.join(TESTS_DIR, 'mock-firebase.js'), contentType: 'application/javascript' }));
	await page.route('**/firebasejs/**/firebase-database-compat.js', (route) => route.fulfill({ body: '' }));
	await page.route('**/firebasejs/**/firebase-auth-compat.js', (route) => route.fulfill({ body: '' }));
	await page.route('**Sortable.min.js', (route) => route.fulfill({ path: path.join(TESTS_DIR, 'mock-sortable.js') }));
	await page.route('**://fonts.googleapis.com/**', (route) => route.fulfill({ body: '' }));
	await page.route('**://fonts.gstatic.com/**', (route) => route.abort());
	// takvim.html -- openCalendar() index.html'de (PAGE!=="takvim") gerçek bir location.href
	// yönlendirmesi yapıyor (bkz. diğer takvim testlerindeki AYNI not).
	// Pre-paint oturum kapısı (bkz. vite.config.js) localStorage'da Firebase izi
	// arıyor; yoksa sayfa boyanmadan giris.html'e gidiyor. Testte gerçek SDK
	// olmadığı için izi elle bırakıyoruz.
	await page.addInitScript(() => {
		try { window.localStorage.setItem('firebase:authUser:testKey:[DEFAULT]', '{"uid":"testUid"}'); } catch (e) { /* yok say */ }
	});
	await page.goto(`http://localhost:${PORT}/takvim.html`, { waitUntil: 'load' });
	await page.waitForTimeout(300);

	await page.evaluate(() => {
		currentUser = { uid: 'ed1', role: 'editor', firstName: 'Test', lastName: 'Kullanıcı', email: 'test@test.com' };
		applyPermissions();
		calAnchor = parseKey('2026-01-12'); calView = 'week';
		calEvents = {};
		renderCalendar();
	});
	await page.waitForTimeout(100);

	// =====================================================================
	// SENARYO 1: formdan çok günlü etkinlik oluşturma -- bitisTarihi doğru kaydediliyor,
	// saat/bitisSaat boş kalıyor (v1 kapsam kararı: çok günlü = her zaman tüm gün).
	// =====================================================================
	const createTest = await page.evaluate(async () => {
		openEventModal(null, '2026-01-13');
		document.getElementById('ev_ad').value = 'Konferans';
		document.getElementById('ev_cokGunlu').checked = true;
		toggleMultiDayFields(true);
		document.getElementById('ev_bitisTarihi').value = '2026-01-15';
		await saveEvent();
		const id = Object.keys(calEvents).find((k) => calEvents[k].ad === 'Konferans');
		const ev = calEvents[id];
		return { id, tarih: ev.tarih, bitisTarihi: ev.bitisTarihi, saatEmpty: ev.saat === '', bitisSaatEmpty: ev.bitisSaat === '' };
	});
	const multiId = createTest.id;

	// =====================================================================
	// SENARYO 1b: geçersiz aralık (bitiş < başlangıç) reddedilmeli.
	// =====================================================================
	const invalidRangeTest = await page.evaluate(async () => {
		openEventModal(null, '2026-02-01');
		document.getElementById('ev_ad').value = 'Kötü Aralık';
		document.getElementById('ev_cokGunlu').checked = true;
		toggleMultiDayFields(true);
		document.getElementById('ev_bitisTarihi').value = '2026-01-30';
		const before = Object.keys(calEvents).length;
		await saveEvent();
		return { rejected: Object.keys(calEvents).length === before };
	});

	// =====================================================================
	// SENARYO 2: tek-günlü etkinlik hâlâ eskisi gibi çalışıyor (regresyon) -- bitisTarihi hiç
	// yazılmıyor, checkbox işaretsiz açılıyor.
	// =====================================================================
	const singleDayTest = await page.evaluate(async () => {
		openEventModal(null, '2026-01-20');
		document.getElementById('ev_ad').value = 'Tek Günlük';
		document.getElementById('ev_saat').value = '10:00';
		await saveEvent();
		const id = Object.keys(calEvents).find((k) => calEvents[k].ad === 'Tek Günlük');
		const ev = calEvents[id];
		openEventModal(id);
		return {
			bitisTarihiNeverSet: ev.bitisTarihi === undefined,
			checkboxUnchecked: document.getElementById('ev_cokGunlu').checked === false,
			timeFieldsVisible: getComputedStyle(document.querySelector('.ev-datetime-row .ev-time')).display !== 'none'
		};
	});
	await page.evaluate(() => closeEventModal());

	// =====================================================================
	// SENARYO 3: haftalık görünümde çubuk doğru grid-column'da render ediliyor, hafta sınırını
	// aşan bir etkinlik kelepçeleniyor ("devam ediyor" ipucuyla), tek-günlü "tüm gün" etkinliği
	// normal chip listesinde kalmaya devam ediyor.
	// =====================================================================
	const renderTest = await page.evaluate((id) => {
		// Yeni oluşturulan etkinlikler varsayılan olarak KİLİTLİ gelir (saveEventImpl, app.js) --
		// sürükleme senaryolarının (4/5) test edebilmesi için burada elle kilit açılır.
		calEvents[id].locked = false;
		calEvents['evAllDaySingle'] = { ad: 'Tek Gün Tüm Gün', tur: 'panel', durum: 'planlandi', tarih: '2026-01-13', saat: '', bitisSaat: '', locked: false, yer: '', birim: '', planlayan: '', gorevli: '', not: '' };
		calEvents['evSpill'] = { ad: 'Taşan', tur: 'diger', durum: 'planlandi', tarih: '2026-01-08', bitisTarihi: '2026-01-13', saat: '', bitisSaat: '', locked: false, yer: '', birim: '', planlayan: '', gorevli: '', not: '' };
		renderCalendar();
		const bar = document.querySelector('.cal-multiday-bar[data-evid="' + id + '"]');
		const spillBar = document.querySelector('.cal-multiday-bar[data-evid="evSpill"]');
		const dailyChips = document.querySelector('.cal-allday-col[data-date="2026-01-13"]').querySelectorAll('.cal-allday-chip');
		return {
			barFound: !!bar,
			gridColumnRight: bar ? (bar.style.gridColumn.indexOf('/') !== -1) : false,
			multiExcludedFromDailyChips: Array.from(dailyChips).every((c) => c.dataset.evid !== id),
			singleDayAllDayStillShown: Array.from(dailyChips).some((c) => c.dataset.evid === 'evAllDaySingle'),
			spillContinuesLeft: spillBar ? spillBar.classList.contains('continues-left') : false
		};
	}, multiId);

	// =====================================================================
	// SENARYO 4: sürükleyerek taşıma -- hem tarih hem bitisTarihi AYNI delta kadar kayıyor,
	// undo geri alıyor.
	// =====================================================================
	const moveTest = await page.evaluate(async (id) => {
		const before = { tarih: calEvents[id].tarih, bitisTarihi: calEvents[id].bitisTarihi };
		const bar = document.querySelector('.cal-multiday-bar[data-evid="' + id + '"]');
		const r = bar.getBoundingClientRect();
		const dayW = (document.querySelector('.cal-allday-multiday').getBoundingClientRect().width - CAL_GUTTER) / calVisibleWeekDays().length;
		function fire(type, x, target) {
			const ev = new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: r.top + r.height / 2, pointerId: 1, pointerType: 'mouse' });
			(target || bar).dispatchEvent(ev);
		}
		const startX = r.left + r.width / 2;
		fire('pointerdown', startX, bar);
		fire('pointermove', startX + dayW, window);
		fire('pointerup', startX + dayW, window);
		await new Promise((res) => setTimeout(res, 80));
		const after = calEvents[id];
		const s0 = new Date(before.tarih), s1 = new Date(after.tarih);
		const e0 = new Date(before.bitisTarihi), e1 = new Date(after.bitisTarihi);
		const startDelta = Math.round((s1 - s0) / 86400000), endDelta = Math.round((e1 - e0) / 86400000);
		const entry = undoStack[undoStack.length - 1];
		await undoLastCalendarAction();
		return {
			movedByOneDay: startDelta === 1,
			bothEndsMovedSameDelta: startDelta === endDelta,
			undoTypeIsMove: entry.type === 'move',
			undoRestoredStart: calEvents[id].tarih === before.tarih,
			undoRestoredEnd: calEvents[id].bitisTarihi === before.bitisTarihi
		};
	}, multiId);

	// =====================================================================
	// SENARYO 5: kenardan yeniden boyutlandırma -- SADECE ilgili uç değişiyor, karşı uç sabit
	// kalıyor; en az 2 günlük aralık korunuyor (sol kenarı sağ kenarın ÇOK ötesine sürükleme).
	// =====================================================================
	const resizeTest = await page.evaluate(async (id) => {
		const before = { tarih: calEvents[id].tarih, bitisTarihi: calEvents[id].bitisTarihi };
		const bar = document.querySelector('.cal-multiday-bar[data-evid="' + id + '"]');
		const handle = bar.querySelector('.cal-multiday-handle-l');
		const r = handle.getBoundingClientRect();
		const dayW = (document.querySelector('.cal-allday-multiday').getBoundingClientRect().width - CAL_GUTTER) / calVisibleWeekDays().length;
		function fire(type, x, target) {
			const ev = new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: r.top + r.height / 2, pointerId: 1, pointerType: 'mouse' });
			(target || handle).dispatchEvent(ev);
		}
		const startX = r.left + 2;
		// AŞIRI uzağa sürükle (10 gün sağa) -- en az 2 günlük aralık kelepçesine takılmalı.
		fire('pointerdown', startX, handle);
		fire('pointermove', startX + dayW * 10, window);
		fire('pointerup', startX + dayW * 10, window);
		await new Promise((res) => setTimeout(res, 80));
		const after = calEvents[id];
		return {
			endUnchanged: after.bitisTarihi === before.bitisTarihi,
			startChanged: after.tarih !== before.tarih,
			minSpanRespected: (new Date(after.bitisTarihi) - new Date(after.tarih)) / 86400000 >= 1
		};
	}, multiId);

	// =====================================================================
	// SENARYO 6: kilitli çok günlü etkinlikte jest tamamen engellenmeli.
	// =====================================================================
	const lockedTest = await page.evaluate(async () => {
		calEvents['evLocked'] = { ad: 'Kilitli Çok Günlü', tur: 'diger', durum: 'planlandi', tarih: '2026-01-13', bitisTarihi: '2026-01-14', locked: true, saat: '', bitisSaat: '', yer: '', birim: '', planlayan: '', gorevli: '', not: '' };
		renderCalendar();
		const before = JSON.stringify(calEvents['evLocked']);
		const bar = document.querySelector('.cal-multiday-bar[data-evid="evLocked"]');
		const r = bar.getBoundingClientRect();
		function fire(type, x, target) {
			const ev = new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: r.top + r.height / 2, pointerId: 1, pointerType: 'mouse' });
			(target || bar).dispatchEvent(ev);
		}
		fire('pointerdown', r.left + r.width / 2, bar);
		fire('pointermove', r.left + r.width / 2 + 150, window);
		fire('pointerup', r.left + r.width / 2 + 150, window);
		await new Promise((res) => setTimeout(res, 80));
		return { unchanged: JSON.stringify(calEvents['evLocked']) === before };
	});

	// =====================================================================
	// SENARYO 7: ay ve liste görünümünde tarih aralığı metni doğru ("13–15 Oca" gibi).
	// =====================================================================
	const monthListTest = await page.evaluate((id) => {
		calSetView('month');
		const chip = document.querySelector('.cal-block[data-evid="' + id + '"]');
		const monthRangeText = chip ? chip.querySelector('.bh').textContent : null;
		calSetView('list');
		const listRow = document.querySelector('.cal-ev[data-evid="' + id + '"]');
		const listTimeText = listRow ? listRow.querySelector('.cal-ev-time').textContent : null;
		calSetView('week');
		return { monthRangeText, listTimeText, bothLookLikeRange: /–/.test(monthRangeText || '') && /–/.test(listTimeText || '') };
	}, multiId);

	const combined = { createTest, invalidRangeTest, singleDayTest, renderTest, moveTest, resizeTest, lockedTest, monthListTest };
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
