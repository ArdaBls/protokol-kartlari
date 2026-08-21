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
			if (typeof v === 'boolean') { if (v === false && excludePaths.indexOf(p) === -1) fails.push(p); }
			else if (v && typeof v === 'object') { fails = fails.concat(collectBooleanFailures(v, excludePaths, p)); }
		}
	}
	return fails;
}

const TESTS_DIR = __dirname;
const SITE_ROOT = path.join(__dirname, '..');
const PORT = 8968;
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

async function newPage(browser, width, height, mobile) {
	const page = await browser.newPage({ viewport: { width: width, height: height }, isMobile: !!mobile, hasTouch: !!mobile });
	await page.route('**/firebasejs/**/firebase-app-compat.js', (r) => r.fulfill({ path: path.join(TESTS_DIR, 'mock-firebase.js'), contentType: 'application/javascript' }));
	await page.route('**/firebasejs/**/firebase-database-compat.js', (r) => r.fulfill({ body: '' }));
	await page.route('**/firebasejs/**/firebase-auth-compat.js', (r) => r.fulfill({ body: '' }));
	await page.route('**Sortable.min.js', (r) => r.fulfill({ path: path.join(TESTS_DIR, 'mock-sortable.js') }));
	await page.route('**://fonts.googleapis.com/**', (r) => r.fulfill({ body: '' }));
	await page.route('**://fonts.gstatic.com/**', (r) => r.abort());
	await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });
	await page.waitForTimeout(250);
	return page;
}

(async () => {
	const server = await serve();
	const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
	const pageErrors = [];

	// ==================================================================
	// BOLUM A: JS yaris durumlari ve veri kaybi duzeltmeleri
	// ==================================================================
	const page = await newPage(browser, 1400, 900, false);
	page.on('pageerror', (e) => pageErrors.push(e.message));

	await page.evaluate(() => {
		currentUser = { uid: 'ed1', role: 'editor', firstName: 'Test', lastName: 'Kullanici', email: 't@t.com' };
		applyPermissions();
		calAnchor = parseKey('2026-04-06'); calView = 'week';
		calEvents = {
			evEdit: { ad: 'Duzenlenecek', tur: 'konferans', durum: 'planlandi', tarih: '2026-04-06', saat: '09:00', bitisSaat: '10:00', locked: false, yer: 'Eski Yer', birim: '', planlayan: '', gorevli: '', not: '' },
			evStamp: { ad: 'Damgalanacak', tur: 'panel', durum: 'planlandi', tarih: '2026-04-06', saat: '', bitisSaat: '', locked: false, yer: '', birim: '', planlayan: '', gorevli: '', not: '' },
			evGone: { ad: 'Uzaktan Silinecek', tur: 'diger', durum: 'planlandi', tarih: '2026-04-07', saat: '11:00', bitisSaat: '12:00', locked: false, yer: '', birim: '', planlayan: '', gorevli: '', not: '' }
		};
		openCalendar();
	});
	await page.waitForTimeout(150);

	// --- K-1: saveEvent sirasinda modal kapatilirsa undo yigina "create" YAZILMAMALI ---
	// (yazsaydi sonraki Ctrl+Z, sadece duzenlenen etkinligi veritabanindan SILERDI)
	const k1 = await page.evaluate(async () => {
		openEventModal('evEdit');
		await new Promise((r) => setTimeout(r, 40));
		document.getElementById('ev_yer').value = 'Yeni Yer';
		const before = undoStack.length;
		const p = saveEvent();                 // await ETME
		closeEventModal();                     // tam await penceresinde "Vazgec"
		await p;
		const entry = undoStack[undoStack.length - 1];
		return {
			pushedOne: undoStack.length === before + 1,
			typeIsEditNotCreate: entry.type === 'edit',
			idIsOriginal: entry.id === 'evEdit',
			noGhostKey: calEvents['null'] === undefined && calEvents['undefined'] === undefined,
			savedCorrectly: calEvents['evEdit'] && calEvents['evEdit'].yer === 'Yeni Yer'
		};
	});

	// --- K-1 devami: yukaridaki entry ile Ctrl+Z etkinligi SILMEMELI, geri almali ---
	const k1undo = await page.evaluate(async () => {
		await undoLastCalendarAction();
		return { stillExists: !!calEvents['evEdit'], yerRestored: calEvents['evEdit'] && calEvents['evEdit'].yer === 'Eski Yer' };
	});

	// --- K-2: eventQuickStamp sirasinda peek kapatilirsa HAYALET kayit olusmamali ---
	const k2 = await page.evaluate(async () => {
		openEventPeek('evStamp');
		const beforeKeys = Object.keys(calEvents).length;
		const p = eventQuickStamp();           // await ETME
		closeEventPeek();                      // tam await penceresinde paneli kapat
		await p;
		return {
			noGhostNullKey: calEvents['null'] === undefined,
			keyCountUnchanged: Object.keys(calEvents).length === beforeKeys,
			stampApplied: !!(calEvents['evStamp'] && calEvents['evStamp'].saat),
			undoEntryHasRealId: undoStack[undoStack.length - 1].id === 'evStamp'
		};
	});

	// --- O-12: uzaktan silinen etkinlik "yeni kayit" olarak DIRILTILMEMELI ---
	const o12 = await page.evaluate(async () => {
		openEventModal('evGone');
		await new Promise((r) => setTimeout(r, 40));
		delete calEvents['evGone'];            // baska bir kullanici sildi
		const before = Object.keys(calEvents).length;
		await saveEvent();
		return {
			notResurrected: calEvents['evGone'] === undefined,
			countUnchanged: Object.keys(calEvents).length === before,
			modalClosed: !document.getElementById('eventModalBg').classList.contains('open')
		};
	});

	// --- persistEvent gecersiz id korumasi ---
	const persistGuard = await page.evaluate(async () => {
		const before = Object.keys(calEvents).length;
		const res = await persistEvent(123, { ad: 'Sayisal id' }, 'test');
		return { rejected: res === false, noRecordAdded: Object.keys(calEvents).length === before };
	});

	// --- O-7: importEventsJSON 'locked' alanini KORUMALI ---
	const o7 = await page.evaluate(async () => {
		currentUser = { uid: 'a1', role: 'admin', firstName: 'A', lastName: 'B', email: 'a@b.c' };
		applyPermissions();
		window.__lastSet = null;
		const origRef = database.ref.bind(database);
		database.ref = function (p) {
			const r = origRef(p);
			if (p === 'etkinlikler') { const os = r.set.bind(r); r.set = function (v) { window.__lastSet = v; return os(v); }; }
			return r;
		};
		const backup = { k1: { ad: 'Kilitli Kayit', tur: 'panel', durum: 'planlandi', tarih: '2026-05-05', locked: true, katilimcilar: [{ prefix: 'Dr.', name: 'X', title: 'Y', junk: 'atilmali' }] },
			k2: { ad: 'Acik Kayit', tur: 'panel', durum: 'planlandi', tarih: '2026-05-06', locked: false, katilimcilar: [] } };
		const file = new File([JSON.stringify(backup)], 'y.json', { type: 'application/json' });
		const dt = new DataTransfer(); dt.items.add(file);
		const inp = document.getElementById('eventsRestoreFile');
		inp.files = dt.files;
		window.confirm = () => true;
		await importEventsJSON({ target: inp });
		await new Promise((r) => setTimeout(r, 200));
		const s = window.__lastSet;
		return {
			wroteSomething: !!s,
			lockedPreservedTrue: !!(s && s.k1 && s.k1.locked === true),
			lockedPreservedFalse: !!(s && s.k2 && s.k2.locked === false),
			attendeeNormalized: !!(s && s.k1 && s.k1.katilimcilar[0] && s.k1.katilimcilar[0].junk === undefined && s.k1.katilimcilar[0].name === 'X')
		};
	});

	// --- K-5: bayat editIndex baska kisinin uzerine YAZMAMALI ---
	const k5 = await page.evaluate(async () => {
		currentUser = { uid: 'ed1', role: 'editor', firstName: 'T', lastName: 'K', email: 't@t.com' };
		applyPermissions();
		closeCalendar();
		people = [
			{ name: 'Birinci Kisi', title: 'Unvan1', prefix: '', unit: '', status: 'aktif', rank: 1, photo: '', start: '', end: '', note: '' },
			{ name: 'Ikinci Kisi', title: 'Unvan2', prefix: '', unit: '', status: 'aktif', rank: 2, photo: '', start: '', end: '', note: '' },
			{ name: 'Ucuncu Kisi', title: 'Unvan3', prefix: '', unit: '', status: 'aktif', rank: 3, photo: '', start: '', end: '', note: '' }
		];
		render();
		openEditModal(2);                                   // "Ucuncu Kisi" duzenleniyor
		document.getElementById('f_name').value = 'Degistirilmis Ad';
		people.splice(0, 1);                                // baska editor 1. kaydi sildi -> indeksler kaydi
		render();
		await saveForm();
		return {
			victimUntouched: people[1] && people[1].name === 'Ucuncu Kisi',   // ezilmemeli
			noWrongWrite: !people.some((p) => p.name === 'Degistirilmis Ad'),
			modalClosed: !document.getElementById('modalBg').classList.contains('open')
		};
	});

	// --- O-6: executeDelete uzaktan silinen kayitta COKMEMELI ---
	const o6 = await page.evaluate(async () => {
		const errsBefore = window.__pageErrCount || 0;
		people = [{ name: 'Tek Kisi', title: 'U', prefix: '', unit: '', status: 'aktif', rank: 1, photo: '', start: '', end: '', note: '' }];
		render(); openEditModal(0);
		people.length = 0;                                  // kayit uzaktan yok oldu
		await executeDelete();
		return {
			confirmModalClosed: !document.getElementById('confirmModalBg').classList.contains('open'),
			didNotThrow: true
		};
	});

	await page.close();

	// ==================================================================
	// BOLUM B: Mobil duzeltmeler (gercek olcum)
	// ==================================================================
	const mobile = {};
	for (const W of [320, 360, 414]) {
		const mp = await newPage(browser, W, 740, true);
		mp.on('pageerror', (e) => pageErrors.push('mobil' + W + ': ' + e.message));
		mobile['w' + W] = await mp.evaluate(() => {
			currentUser = { uid: 'a1', role: 'admin', firstName: 'Mehmet Abdulkadir', lastName: 'Yilmazoglu', email: 'uzun@omu.edu.tr' };
			applyPermissions();
			function textRect(el) { const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect(); }
			const ov = (a, b) => !(a.bottom <= b.top || b.bottom <= a.top || a.right <= b.left || b.right <= a.left);
			const r = {};
			// Baslik cakismasi (GERCEK metin sinirlariyla)
			const ha = document.getElementById('headerAuth').getBoundingClientRect();
			r.headerNoOverlapWithTitle = !ov(ha, textRect(document.querySelector('h1')));
			r.headerNoOverlapWithEyebrow = !ov(ha, textRect(document.querySelector('.eyebrow')));
			r.headerIsStatic = getComputedStyle(document.getElementById('headerAuth')).position === 'static';
			// Sayfa yatay tasmasi
			r.noPageOverflow = document.documentElement.scrollWidth <= document.documentElement.clientWidth;
			// Admin sekmeleri ekrana sigiyor mu
			openAdminPanel();
			const tabs = Array.from(document.querySelectorAll('.admin-tabs .btn'));
			r.adminTabCount = tabs.length;
			r.adminTabsOnScreen = tabs.every((b) => { const x = b.getBoundingClientRect(); return x.right <= window.innerWidth + 0.5 && x.left >= -0.5; });
			const am = document.querySelector('#adminPanelBg .modal');
			r.adminModalNoOverflow = am.scrollWidth <= am.clientWidth + 1;
			closeAdminPanel();
			// Yil gorunumu
			calEvents = { e1: { ad: 'Cok Uzun Bir Etkinlik Adi Burada', tur: 'panel', durum: 'planlandi', tarih: '2026-03-10', saat: '10:00', bitisSaat: '11:00', locked: false, yer: '', birim: '', planlayan: '', gorevli: '', not: '' } };
			calAnchor = parseKey('2026-03-10'); openCalendar(); calSetView('year');
			const yg = document.querySelector('.cal-year-grid');
			r.yearGridInViewport = yg.getBoundingClientRect().right <= window.innerWidth + 0.5;
			r.yearMonthsNoOverflow = Array.from(document.querySelectorAll('.cal-year-month')).every((m) => m.scrollWidth <= m.clientWidth + 1);
			r.yearMiniGridsNoOverflow = Array.from(document.querySelectorAll('.cal-year-month .cal-mini-grid')).every((m) => m.scrollWidth <= m.clientWidth + 1);
			const yd = document.querySelector('.cal-year-day:not(.empty)').getBoundingClientRect();
			r.yearDayTouchable = yd.width >= 24 && yd.height >= 24;
			r.yearDaySize = [+yd.width.toFixed(1), +yd.height.toFixed(1)];
			// Ay gorunumu cip metni tek satir olmali
			calSetView('month');
			const bt = document.querySelector('.cal-block.compact .bt');
			r.monthChipFound = !!bt;
			if (bt) { const cs = getComputedStyle(bt); r.monthChipSingleLine = cs.whiteSpace === 'nowrap' && cs.textOverflow === 'ellipsis'; }
			// Ok butonlari cakismamali
			const ib = Array.from(document.querySelectorAll('.cal-topbar .cal-iconbtn'));
			if (ib.length >= 2) {
				const a = ib[0].getBoundingClientRect();
				const el = document.elementFromPoint(Math.round(a.right - 1), Math.round(a.top + a.height / 2));
				r.prevArrowNotHijacked = !!(el && (el === ib[0] || ib[0].contains(el)));
			}
			// mdayadd dokunmatikte gorunur olmali
			const add = document.querySelector('.cal-mdayadd');
			r.mdayAddVisible = !!add && parseFloat(getComputedStyle(add).opacity) > 0.2;
			closeCalendar();
			// iOS otomatik yakinlastirma: form alanlari >= 16px
			openAddModal();
			r.inputFontIs16 = parseFloat(getComputedStyle(document.getElementById('f_name')).fontSize) >= 16;
			r.nameFieldWide = document.getElementById('f_name').getBoundingClientRect().width >= 150;
			closeModal();
			return r;
		});
		await mp.close();
	}

	const combined = { k1, k1undo, k2, o12, persistGuard, o7, k5, o6, mobile };
	console.log(JSON.stringify(combined, null, 2));
	console.log('PAGE ERRORS:', pageErrors.length);
	pageErrors.forEach((e) => console.log(' -', e));

	const boolFails = collectBooleanFailures(combined, []);
	const allPassed = pageErrors.length === 0 && boolFails.length === 0;
	console.log('ALL_TESTS_PASSED:', allPassed);
	if (boolFails.length) console.log('BASARISIZ ALANLAR:', JSON.stringify(boolFails));

	await browser.close();
	server.close();
	process.exitCode = allPassed ? 0 : 1;
})();
