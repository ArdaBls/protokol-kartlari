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

	// --- K-6: saveForm sirasinda editIndex DEGISIRSE rollback yanlis kayda YAZMAMALI ---
	// (K-5'ten farkli: burada dizi kaymiyor, ayni await penceresinde editIndex baska
	// bir kaydi gostermeye baslıyor -- eski kod bu durumda global editIndex'i okuyup
	// YANLIS kaydin uzerine eski veriyi yaziyordu, targetIdx'i yakalayip kullanmiyordu)
	const k6 = await page.evaluate(async () => {
		currentUser = { uid: 'ed1', role: 'editor', firstName: 'T', lastName: 'K', email: 't@t.com' };
		applyPermissions();
		people = [
			{ name: 'Kayit A', title: 'Unvan', prefix: '', unit: '', status: 'aktif', rank: 1, photo: '', start: '', end: '', note: '' },
			{ name: 'Kayit B', title: 'Unvan', prefix: '', unit: '', status: 'aktif', rank: 2, photo: '', start: '', end: '', note: '' }
		];
		render();
		openEditModal(0);                                   // "Kayit A" duzenleniyor
		document.getElementById('f_name').value = 'Kayit A Guncellendi';
		const origRef = database.ref.bind(database);
		database.ref = function (p) {
			const r = origRef(p);
			r.set = function () { return new Promise((_, reject) => setTimeout(() => reject(new Error('mock-fail')), 30)); };
			return r;
		};
		const p = saveForm();                               // await ETME
		openEditModal(1);                                    // yazma beklerken baska kaydi actı -> editIndex artik 1
		await p;
		database.ref = origRef;
		return {
			recordARolledBack: people[0].name === 'Kayit A',          // eski haline donmeli
			recordBUntouched: people[1].name === 'Kayit B'            // editIndex=1'in kaydina YANLISLIKLA yazilmamali
		};
	});

	// --- K-7: restoreSingle basarisizsa geri alinan durum GERI DONMELI ---
	const k7 = await page.evaluate(async () => {
		people = [{ name: 'Cop Kayit', title: '', prefix: '', unit: '', status: 'silindi', prevStatus: 'pasif', rank: '', photo: '', start: '', end: '', note: '' }];
		render();
		const origRef = database.ref.bind(database);
		database.ref = function (p) { const r = origRef(p); r.set = function () { return Promise.reject(new Error('mock-fail')); }; return r; };
		await restoreSingle(0);
		database.ref = origRef;
		return { statusRolledBack: people[0].status === 'silindi', prevStatusRestored: people[0].prevStatus === 'pasif' };
	});

	// --- K-8: executeSinglePermDelete basarisizsa kayit dizide KALMALI (silinmemis gibi geri donmeli) ---
	const k8 = await page.evaluate(async () => {
		people = [
			{ name: 'Kalici Silinecek', title: '', prefix: '', unit: '', status: 'silindi', rank: '', photo: '', start: '', end: '', note: '' },
			{ name: 'Diger Kayit', title: '', prefix: '', unit: '', status: 'aktif', rank: 1, photo: '', start: '', end: '', note: '' }
		];
		render();
		singlePermDeleteIdx = 0;
		const origRef = database.ref.bind(database);
		database.ref = function (p) { const r = origRef(p); r.set = function () { return Promise.reject(new Error('mock-fail')); }; return r; };
		await executeSinglePermDelete();
		database.ref = origRef;
		return { recordStillPresent: people.length === 2 && people[0].name === 'Kalici Silinecek', otherRecordIntact: people[1].name === 'Diger Kayit' };
	});

	// --- K-9: executeEmptyTrash basarisizsa cop kutusu BOSALTILMAMIS gibi geri donmeli ---
	const k9 = await page.evaluate(async () => {
		people = [
			{ name: 'Coptekiler', title: '', prefix: '', unit: '', status: 'silindi', rank: '', photo: '', start: '', end: '', note: '' },
			{ name: 'Aktif Kayit', title: '', prefix: '', unit: '', status: 'aktif', rank: 1, photo: '', start: '', end: '', note: '' }
		];
		render();
		const origRef = database.ref.bind(database);
		database.ref = function (p) { const r = origRef(p); r.set = function () { return Promise.reject(new Error('mock-fail')); }; return r; };
		await executeEmptyTrash();
		database.ref = origRef;
		return { trashRestored: people.length === 2 && people.some((p) => p.status === 'silindi') };
	});

	// --- K-10: executeBulkDelete basarisizsa secilen kayitlarin durumu GERI ALINMALI ve ekran YENIDEN CIZILMELI ---
	// (eski kodda bu fonksiyon hic render() cagirmiyordu -- basarisizlikta ekran hicbir zaman duzelmiyordu)
	const k10 = await page.evaluate(async () => {
		people = [
			{ name: 'Toplu 1', title: '', prefix: '', unit: '', status: 'aktif', rank: 1, photo: '', start: '', end: '', note: '' },
			{ name: 'Toplu 2', title: '', prefix: '', unit: '', status: 'pasif', prevStatus: 'pasif', rank: 2, photo: '', start: '', end: '', note: '' }
		];
		render();
		bulkSelection = [0, 1];
		const origRef = database.ref.bind(database);
		database.ref = function (p) { const r = origRef(p); r.set = function () { return Promise.reject(new Error('mock-fail')); }; return r; };
		await executeBulkDelete();
		database.ref = origRef;
		return {
			firstRolledBack: people[0].status === 'aktif' && people[0].prevStatus === undefined,
			secondRolledBack: people[1].status === 'pasif' && people[1].prevStatus === 'pasif'
		};
	});

	// --- K-11: sortRankGroupByName basarisizsa .order alanlari ESKI HALINE donmeli ---
	const k11 = await page.evaluate(async () => {
		people = [
			{ name: 'B Kisi', title: '', prefix: '', unit: '', status: 'aktif', rank: 1, order: 5, photo: '', start: '', end: '', note: '' },
			{ name: 'A Kisi', title: '', prefix: '', unit: '', status: 'aktif', rank: 1, order: 9, photo: '', start: '', end: '', note: '' }
		];
		render();
		const origRef = database.ref.bind(database);
		database.ref = function (p) { const r = origRef(p); r.set = function () { return Promise.reject(new Error('mock-fail')); }; return r; };
		const fakeEvt = { preventDefault() {}, stopPropagation() {} };
		await sortRankGroupByName(fakeEvt, '1');
		database.ref = origRef;
		return { firstOrderRolledBack: people[0].order === 5, secondOrderRolledBack: people[1].order === 9 };
	});

	// --- K-12: logAction/logDebugAction push basarisiz olursa artik SESSIZ kalmamali (console.error) ---
	const k12 = await page.evaluate(() => {
		return {
			logActionLogsError: logAction.toString().indexOf('console.error') !== -1,
			logDebugActionLogsError: logDebugAction.toString().indexOf('console.error') !== -1
		};
	});

	// --- K-13: checkbox isaretli DEGILKEN Il Protokolu kayitlari secicide GORUNMEMELI ---
	const k13 = await page.evaluate(async () => {
		currentUser = { uid: 'ed1', role: 'editor', firstName: 'T', lastName: 'K', email: 't@t.com' };
		applyPermissions();
		currentListKey = 'universite';
		people = [{ name: 'Universite Kisi', title: 'Rektor', prefix: '', unit: 'OMU', status: 'aktif', rank: 1, photo: '', start: '', end: '', note: '' }];
		ilPoolCache = [{ name: 'Valilik Kisisi', title: 'Vali Yardimcisi', prefix: '', unit: 'Valilik', status: 'aktif', rank: 1 }];
		openEventModal(null);
		document.getElementById('ev_attIncludeIl').checked = false;
		document.getElementById('ev_attSearch').value = 'valilik kisisi';
		renderEventAttendeePicker();
		const box = document.getElementById('ev_attendeeBox');
		return { ilPersonHidden: box.textContent.indexOf('Valilik Kisisi') === -1 };
	});

	// --- K-14: checkbox isaretliyken Il Protokolu kayitlari da secicide GORUNMELI ---
	const k14 = await page.evaluate(async () => {
		document.getElementById('ev_attIncludeIl').checked = true;
		document.getElementById('ev_attSearch').value = 'valilik kisisi';
		renderEventAttendeePicker();
		const box = document.getElementById('ev_attendeeBox');
		return { ilPersonShown: box.textContent.indexOf('Valilik Kisisi') !== -1 };
	});

	// --- K-15: AYNI isim+birim iki listede de varsa TEK kisiye insin ve IL kaydi KAZANSIN ---
	const k15 = await page.evaluate(async () => {
		people = [{ name: 'Ayni Kisi', title: 'Universite Unvani', prefix: '', unit: 'Ortak Birim', status: 'aktif', rank: 1, photo: '', start: '', end: '', note: '' }];
		ilPoolCache = [{ name: 'Ayni Kisi', title: 'Il Unvani', prefix: '', unit: 'Ortak Birim', status: 'aktif', rank: 1 }];
		document.getElementById('ev_attIncludeIl').checked = true;
		document.getElementById('ev_attSearch').value = 'ayni kisi';
		renderEventAttendeePicker();
		const box = document.getElementById('ev_attendeeBox');
		const items = box.querySelectorAll('.ev-att-item');
		return {
			collapsedToOne: items.length === 1,
			ilVersionWon: box.textContent.indexOf('Il Unvani') !== -1,
			universityVersionGone: box.textContent.indexOf('Universite Unvani') === -1
		};
	});

	// --- K-16: onAttIncludeIlToggle() GERCEK .once('value') akisini de dogru tetiklemeli (tek seferlik, onbelleklenen) ---
	const k16 = await page.evaluate(async () => {
		ilPoolCache = null;
		let fetchCount = 0;
		const origRef = database.ref.bind(database);
		database.ref = function (p) {
			const r = origRef(p);
			if (p === 'ilProtokolVerileri' || p === dbPath('ilProtokolVerileri')) {
				const oo = r.once.bind(r);
				r.once = function (ev) { fetchCount++; return Promise.resolve({ val: () => [{ name: 'Taze Il Kisi', title: 'X', prefix: '', unit: 'Y', status: 'aktif', rank: 1 }] }); };
			}
			return r;
		};
		document.getElementById('ev_attIncludeIl').checked = true;
		await onAttIncludeIlToggle();
		document.getElementById('ev_attIncludeIl').checked = false; // kapat-ac -- yeniden fetch OLMAMALI (onbellek)
		onAttIncludeIlToggle();
		document.getElementById('ev_attIncludeIl').checked = true;
		await onAttIncludeIlToggle();
		database.ref = origRef;
		return { fetchedOnce: fetchCount === 1, cachePopulated: Array.isArray(ilPoolCache) && ilPoolCache.some((p) => p.name === 'Taze Il Kisi') };
	});
	await page.evaluate(() => closeEventModal());

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
			// Kart izgarasi: 2'li/3'lu/4'lu modlarda farkli uzunlukta isim/unvan/birim
			// icerigiyle yukseklik tutarliligi + .meta ("devam ediyor"/tarih) cakismamasi.
			people = [
				{ name: 'A', title: 'Kisa', unit: 'Kisa Birim', prefix: '', status: 'aktif', rank: 1, photo: '', start: '2020-01-01', end: '', note: '' },
				{ name: 'Çok Uzun Bir İsim Soyisim Buraya', title: 'Çok Uzun Bir Görev Unvanı Buraya Sığmaz', unit: 'Çok Uzun Bir Birim Adı Fakültesi Buraya', prefix: 'Prof. Dr.', status: 'aktif', rank: 1, photo: '', start: '2020-01-01', end: '', note: 'Uzun bir not metni burada da devam ediyor gidiyor.' },
				{ name: 'B Kısa', title: 'Orta Unvan', unit: 'Orta Birim', prefix: '', status: 'aktif', rank: 1, photo: '', start: '2020-01-01', end: '', note: '' },
				{ name: 'C Kısa', title: 'Orta Unvan 2', unit: 'Orta Birim 2', prefix: '', status: 'aktif', rank: 1, photo: '', start: '2020-01-01', end: '', note: '' }
			];
			r.cardGrid = {};
			[2, 3, 4].forEach(function (cols) {
				const grid = document.getElementById('grid');
				grid.classList.remove('grid-cols-2', 'grid-cols-3', 'grid-cols-4');
				grid.classList.add('grid-cols-' + cols);
				grid.style.setProperty('--mobile-cols', cols);
				render();
				const cards = Array.from(document.querySelectorAll('.card'));
				const heights = cards.map(function (c) { return c.getBoundingClientRect().height; });
				const maxH = Math.max.apply(null, heights); const minH = Math.min.apply(null, heights);
				// Line-clamp KESIN esitlik saglamiyor (kisa kart 1 satir, uzun kart clamp'lenmis
				// 2 satir kullanabilir -- bu kabul edilen bir fark, yapay min-height'la
				// bastirilmiyor). Asil dogrulanmasi gereken: clamp GERCEKTEN calisiyor mu --
				// yani uzun icerikli karttaki .name/.title/.unit TASMIYOR (scrollHeight,
				// clientHeight'i asmiyor), sinirsiz sarip kart yuksekligini sismemesini
				// engelliyor. Once clamp'siz eski davranista bu deger cok daha buyuk olurdu.
				const longCard = cards[1]; // 2. kisi = kasitli en uzun isim/unvan/birim/not
				const clampCheck = function (sel) {
					const el = longCard.querySelector(sel); if (!el) return true;
					return el.scrollHeight <= el.clientHeight + 2;
				};
				const clampWorking = clampCheck('.name') && clampCheck('.title') && clampCheck('.unit');
				// Kaba bir ust sinir da tutuluyor: clamp gercekten isliyorsa fark makul kalmali
				// (name/title/unit'te en fazla 1'er ekstra satir + varsa bir not bloğu).
				const heightVarianceOk = (maxH - minH) <= 140;
				let metaOverlapFound = false;
				document.querySelectorAll('.meta').forEach(function (meta) {
					const spans = Array.from(meta.querySelectorAll('span'));
					for (let i = 0; i < spans.length; i++) {
						for (let j = i + 1; j < spans.length; j++) {
							const a = spans[i].getBoundingClientRect(); const b = spans[j].getBoundingClientRect();
							if (a.width === 0 || b.width === 0) continue;
							const overlaps = !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
							if (overlaps) metaOverlapFound = true;
						}
					}
				});
				r.cardGrid['cols' + cols] = { clampWorking: clampWorking, heightVarianceOk: heightVarianceOk, noMetaOverlap: !metaOverlapFound, maxHeight: Math.round(maxH), minHeight: Math.round(minH) };
			});
			// iOS otomatik yakinlastirma: form alanlari >= 16px
			openAddModal();
			r.inputFontIs16 = parseFloat(getComputedStyle(document.getElementById('f_name')).fontSize) >= 16;
			r.nameFieldWide = document.getElementById('f_name').getBoundingClientRect().width >= 150;
			closeModal();
			return r;
		});
		await mp.close();
	}

	const combined = { k1, k1undo, k2, o12, persistGuard, o7, k5, o6, k6, k7, k8, k9, k10, k11, k12, k13, k14, k15, k16, mobile };
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
