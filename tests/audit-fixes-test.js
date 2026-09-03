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
const SITE_ROOT = path.join(__dirname, '..', 'docs');
const PORT = 8968;
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

async function newPage(browser, width, height, mobile) {
	const page = await browser.newPage({ viewport: { width: width, height: height }, isMobile: !!mobile, hasTouch: !!mobile });
	await page.route('**/firebasejs/**/firebase-app-compat.js', (r) => r.fulfill({ path: path.join(TESTS_DIR, 'mock-firebase.js'), contentType: 'application/javascript' }));
	await page.route('**/firebasejs/**/firebase-database-compat.js', (r) => r.fulfill({ body: '' }));
	await page.route('**/firebasejs/**/firebase-auth-compat.js', (r) => r.fulfill({ body: '' }));
	await page.route('**Sortable.min.js', (r) => r.fulfill({ path: path.join(TESTS_DIR, 'mock-sortable.js') }));
	await page.route('**://fonts.googleapis.com/**', (r) => r.fulfill({ body: '' }));
	await page.route('**://fonts.gstatic.com/**', (r) => r.abort());
	// index.html DEĞİL, protokol.html -- çok sayfalı mimari geçişinden (index.html artık
	// SADECE giriş/kayıt) sonra kart ızgarası/header index.html'de CSS ile gizli, ayrıca
	// openCalendar()/openAdminPanel() de PAGE!=="takvim"/"admin" iken gerçek bir
	// location.href yönlendirmesi yapıyor. protokol.html'de kart ızgarası+header GÖRÜNÜR
	// kalıyor, takvim/admin ise (bu dosyada aşağıda) doğrudan DOM manipülasyonuyla (gate
	// fonksiyonlarını bypass ederek) açılıyor -- tek bir sayfa örneğinde hepsi test edilebiliyor.
	// protokol.html artık halka açık DEĞİL: eski bağımsız sayfa kaldırıldı, adı
	// panelin içindeki sayfaya geçti ve giriş ZORUNLU oldu (kullanıcı isteği).
	// app.js'in fonksiyonlarına erişebilmek için giriş yapmış bir kullanıcı şart;
	// aksi halde shell.js giris.html'e yönlendirir ve app.js hiç yüklenmez.
	await page.addInitScript(() => {
		try { window.localStorage.setItem('firebase:authUser:testKey:[DEFAULT]', '{"uid":"testUid"}'); } catch (e) { /* yok say */ }
		window.__mockAuthUser = { uid: 'testUid', email: 'test@test.com', emailVerified: true };
		window.__mockUserProfile = { role: 'admin', firstName: 'Test', lastName: 'Kullanıcı' };
		if (window.__mockOnceSnapshot === undefined) {
			window.__mockOnceSnapshot = { role: 'admin', firstName: 'Test', lastName: 'Kullanıcı' };
		}
	});
	await page.goto(`http://localhost:${PORT}/protokol.html`, { waitUntil: 'load' });
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
		// openCalendar() DEGIL -- protokol.html'de PAGE!=="takvim" oldugu icin gercek bir
		// location.href yonlendirmesi yapar. Kapi fonksiyonu bypass edilip DOGRUDAN acilir.
		document.getElementById('calendarOverlay').classList.add('open');
		renderCalendar();
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

	// --- K-5 (ARTIK bir REGRESYON-KORUMA testi, eski hali "bayat dizi indeksi" senaryosuydu):
	// people ARTIK push-ID'li bir NESNE -- baska bir editorun ALAKASIZ bir kaydi silmesi
	// digerlerinin ID'sini/kimligini ASLA KAYDIRMAZ. saveForm() halen dogru (kendi) ID'ye
	// yazmali ve silinen kaydi DIRILTMEMELI. ---
	const k5 = await page.evaluate(async () => {
		currentUser = { uid: 'ed1', role: 'editor', firstName: 'T', lastName: 'K', email: 't@t.com' };
		applyPermissions();
		// closeCalendar() DEGIL -- protokol.html'de PAGE==="takvim" DEGIL, redirect tetiklenmez
		// aslinda (sadece PAGE==="takvim" iken yonlendirir) ama tutarlilik icin yine de
		// alt-seviye fonksiyon kullanilir (gercek DOM/animasyon yan etkilerine gerek yok).
		_hideCalendarOverlay();
		people = {
			pid1: { name: 'Birinci Kisi', title: 'Unvan1', prefix: '', unit: '', status: 'aktif', rank: 1, photo: '', start: '', end: '', note: '' },
			pid2: { name: 'Ikinci Kisi', title: 'Unvan2', prefix: '', unit: '', status: 'aktif', rank: 2, photo: '', start: '', end: '', note: '' },
			pid3: { name: 'Ucuncu Kisi', title: 'Unvan3', prefix: '', unit: '', status: 'aktif', rank: 3, photo: '', start: '', end: '', note: '' }
		};
		render();
		openEditModal('pid3');                              // "Ucuncu Kisi" duzenleniyor
		document.getElementById('f_name').value = 'Degistirilmis Ad';
		delete people.pid1;                                 // baska editor ALAKASIZ bir kaydi sildi
		render();
		await saveForm();
		return {
			victimNotResurrected: people.pid1 === undefined,          // silinen kayit geri gelmemeli
			editedRecordUpdated: people.pid3 && people.pid3.name === 'Degistirilmis Ad', // KENDI ID'sine yazilmali
			otherRecordIntact: people.pid2 && people.pid2.name === 'Ikinci Kisi',
			modalClosed: !document.getElementById('modalBg').classList.contains('open')
		};
	});

	// --- O-6: executeDelete uzaktan silinen kayitta COKMEMELI ---
	const o6 = await page.evaluate(async () => {
		const errsBefore = window.__pageErrCount || 0;
		people = { pidTek: { name: 'Tek Kisi', title: 'U', prefix: '', unit: '', status: 'aktif', rank: 1, photo: '', start: '', end: '', note: '' } };
		render(); openEditModal('pidTek');
		people = {};                                        // kayit uzaktan yok oldu
		await executeDelete();
		return {
			confirmModalClosed: !document.getElementById('confirmModalBg').classList.contains('open'),
			didNotThrow: true
		};
	});

	// --- K-6: saveForm sirasinda editIndex DEGISIRSE rollback yanlis kayda YAZMAMALI ---
	// (K-5'ten farkli: burada ID kaymiyor, ayni await penceresinde editIndex baska
	// bir kaydi gostermeye baslıyor -- eski kod bu durumda global editIndex'i okuyup
	// YANLIS kaydin uzerine eski veriyi yaziyordu, targetIdx'i yakalayip kullanmiyordu)
	const k6 = await page.evaluate(async () => {
		currentUser = { uid: 'ed1', role: 'editor', firstName: 'T', lastName: 'K', email: 't@t.com' };
		applyPermissions();
		people = {
			pidA: { name: 'Kayit A', title: 'Unvan', prefix: '', unit: '', status: 'aktif', rank: 1, photo: '', start: '', end: '', note: '' },
			pidB: { name: 'Kayit B', title: 'Unvan', prefix: '', unit: '', status: 'aktif', rank: 2, photo: '', start: '', end: '', note: '' }
		};
		render();
		openEditModal('pidA');                              // "Kayit A" duzenleniyor
		document.getElementById('f_name').value = 'Kayit A Guncellendi';
		const origRef = database.ref.bind(database);
		database.ref = function (p) {
			const r = origRef(p);
			// savePerson() artik veri+log'u TEK atomik root().update() ile yaziyor (audit #6) --
			// eski kod .set() kullaniyordu, bu yuzden .update() de ayni sekilde reddedilmeli.
			const fail = function () { return new Promise((_, reject) => setTimeout(() => reject(new Error('mock-fail')), 30)); };
			r.set = fail; r.update = fail;
			return r;
		};
		const p = saveForm();                               // await ETME
		openEditModal('pidB');                               // yazma beklerken baska kaydi actı -> editIndex artik 'pidB'
		await p;
		database.ref = origRef;
		return {
			recordARolledBack: people.pidA.name === 'Kayit A',        // eski haline donmeli
			recordBUntouched: people.pidB.name === 'Kayit B'          // editIndex='pidB'nin kaydina YANLISLIKLA yazilmamali
		};
	});

	// --- K-7: restoreSingle basarisizsa geri alinan durum GERI DONMELI ---
	const k7 = await page.evaluate(async () => {
		people = { pid1: { name: 'Cop Kayit', title: '', prefix: '', unit: '', status: 'silindi', prevStatus: 'pasif', rank: '', photo: '', start: '', end: '', note: '' } };
		render();
		const origRef = database.ref.bind(database);
		// savePerson() artik .set() DEGIL, veri+log'u TEK atomik root().update() ile yaziyor (audit #6).
		database.ref = function (p) { const r = origRef(p); const fail = function () { return Promise.reject(new Error('mock-fail')); }; r.set = fail; r.update = fail; return r; };
		await restoreSingle('pid1');
		database.ref = origRef;
		return { statusRolledBack: people.pid1.status === 'silindi', prevStatusRestored: people.pid1.prevStatus === 'pasif' };
	});

	// --- K-8: executeSinglePermDelete basarisizsa kayit NESNEDE KALMALI (silinmemis gibi geri donmeli) ---
	// (Kalici silme artik .set() DEGIL, .remove() kullaniyor -- hata simulasyonu buna gore .remove()'u eziyor.)
	const k8 = await page.evaluate(async () => {
		people = {
			pidSil: { name: 'Kalici Silinecek', title: '', prefix: '', unit: '', status: 'silindi', rank: '', photo: '', start: '', end: '', note: '' },
			pidDiger: { name: 'Diger Kayit', title: '', prefix: '', unit: '', status: 'aktif', rank: 1, photo: '', start: '', end: '', note: '' }
		};
		render();
		singlePermDeleteIdx = 'pidSil';
		const origRef = database.ref.bind(database);
		// executeSinglePermDelete() artik .remove() DEGIL, silme+log'u TEK atomik root().update()
		// (update() icinde null = remove) ile yaziyor (audit #6).
		database.ref = function (p) { const r = origRef(p); const fail = function () { return Promise.reject(new Error('mock-fail')); }; r.remove = fail; r.update = fail; return r; };
		await executeSinglePermDelete();
		database.ref = origRef;
		return { recordStillPresent: Object.keys(people).length === 2 && people.pidSil.name === 'Kalici Silinecek', otherRecordIntact: people.pidDiger.name === 'Diger Kayit' };
	});

	// --- K-9: executeEmptyTrash basarisizsa cop kutusu BOSALTILMAMIS gibi geri donmeli ---
	// (Cop bosaltma artik TEK .set() DEGIL, {id:null} patch'li .update() kullaniyor.)
	const k9 = await page.evaluate(async () => {
		people = {
			pidCop: { name: 'Coptekiler', title: '', prefix: '', unit: '', status: 'silindi', rank: '', photo: '', start: '', end: '', note: '' },
			pidAktif: { name: 'Aktif Kayit', title: '', prefix: '', unit: '', status: 'aktif', rank: 1, photo: '', start: '', end: '', note: '' }
		};
		render();
		const origRef = database.ref.bind(database);
		database.ref = function (p) { const r = origRef(p); r.update = function () { return Promise.reject(new Error('mock-fail')); }; return r; };
		await executeEmptyTrash();
		database.ref = origRef;
		return { trashRestored: Object.keys(people).length === 2 && Object.keys(people).some((id) => people[id].status === 'silindi') };
	});

	// --- K-10: executeBulkDelete basarisizsa secilen kayitlarin durumu GERI ALINMALI ve ekran YENIDEN CIZILMELI ---
	// (eski kodda bu fonksiyon hic render() cagirmiyordu -- basarisizlikta ekran hicbir zaman duzelmiyordu.
	// Toplu silme artik id/field patch'li .update() kullaniyor, .set() degil.)
	const k10 = await page.evaluate(async () => {
		people = {
			pid1: { name: 'Toplu 1', title: '', prefix: '', unit: '', status: 'aktif', rank: 1, photo: '', start: '', end: '', note: '' },
			pid2: { name: 'Toplu 2', title: '', prefix: '', unit: '', status: 'pasif', prevStatus: 'pasif', rank: 2, photo: '', start: '', end: '', note: '' }
		};
		render();
		bulkSelection = ['pid1', 'pid2'];
		const origRef = database.ref.bind(database);
		database.ref = function (p) { const r = origRef(p); r.update = function () { return Promise.reject(new Error('mock-fail')); }; return r; };
		await executeBulkDelete();
		database.ref = origRef;
		return {
			firstRolledBack: people.pid1.status === 'aktif' && people.pid1.prevStatus === undefined,
			secondRolledBack: people.pid2.status === 'pasif' && people.pid2.prevStatus === 'pasif'
		};
	});

	// --- K-11: sortRankGroupByName basarisizsa .order alanlari ESKI HALINE donmeli ---
	// (Sıralama artik id/order patch'li .update() kullaniyor, tum listeyi .set() ile DEGIL.)
	const k11 = await page.evaluate(async () => {
		people = {
			pidB: { name: 'B Kisi', title: '', prefix: '', unit: '', status: 'aktif', rank: 1, order: 5, photo: '', start: '', end: '', note: '' },
			pidA: { name: 'A Kisi', title: '', prefix: '', unit: '', status: 'aktif', rank: 1, order: 9, photo: '', start: '', end: '', note: '' }
		};
		render();
		const origRef = database.ref.bind(database);
		database.ref = function (p) { const r = origRef(p); r.update = function () { return Promise.reject(new Error('mock-fail')); }; return r; };
		const fakeEvt = { preventDefault() {}, stopPropagation() {} };
		await sortRankGroupByName(fakeEvt, '1');
		database.ref = origRef;
		return { firstOrderRolledBack: people.pidB.order === 5, secondOrderRolledBack: people.pidA.order === 9 };
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
			// NOT: Buradaki baslik-cakismasi olcumleri (headerAuth <-> h1/.eyebrow) KALDIRILDI.
			// protokol.html artik panelin icindeki sayfa; eski sayfanin kendi <header>'i
			// (h1, .eyebrow ve hesap menusu) kullanici istegiyle tamamen cikarildi, panelin
			// kendi topbar'i o isi goruyor. Olcecek eleman kalmadigi icin bu uc iddia
			// anlamsizlasti; Bolum B'nin geri kalani (yatay tasma, admin sekmeleri,
			// kart izgarasi, mobil sidebar) AYNEN korunuyor.
			// Sayfa yatay tasmasi
			r.noPageOverflow = document.documentElement.scrollWidth <= document.documentElement.clientWidth;
			// Admin sekmeleri ekrana sigiyor mu -- openAdminPanel() DEGIL (protokol.html'de
			// PAGE!=="admin" oldugu icin gercek bir location.href yonlendirmesi yapar), kapi
			// fonksiyonu bypass edilip DOGRUDAN acilir.
			document.getElementById('adminPanelBg').classList.add('open');
			// Faz 11: mobil sidebar artik position:fixed bir slide-over -- KAPALIYKEN de tam
			// genisligini korur (sadece translateX ile ekran disina kaydirilir), o yuzden ACIK
			// olmadan .admin-nav-item'larin genisligi ARTIK 0 DEGIL (eskiden PUSH modelinde
			// kapaliyken width:0'di, bu test o filtreye guveniyordu). Sekmelerin gercekten ekrana
			// sigip sigmadigini anlamli sekilde olcmek icin cekmeceyi ACIK duruma getiriyoruz.
			// transition:none: .open transform GECISI (.25s) senkron classList.add() sonrasi
			// HEMEN okunan getComputedStyle'da henuz baslamamis olabilir (bir sonraki reflow'u
			// beklemesi gerekir) -- transition'i test icin kapatip HEDEF konuma aninda atlatiyoruz,
			// aksi halde bu olcum kapali (baslangic) transform'unu yakalayip yanlislikla "tasiyor"
			// derdi.
			const admSidebar = document.getElementById('adminSidebarDrawer');
			admSidebar.style.transition = 'none';
			admSidebar.classList.add('open');
			void admSidebar.offsetHeight;
			// .admin-tabs/.btn DEGIL -- Part B'nin akordeon sidebar yenilemesinden (Faz 9) sonra
			// tum sekme dugmeleri .admin-sidebar icinde .admin-nav-item class'ini tasiyor.
			// Mobilde TUM gruplar (accordion) DOM'da mevcut ama kapali gruplarin treeview'i
			// display:none -- sadece GORUNEN (fiili genislik/yuksekligi olan) dugmeler sayilir,
			// kapali bir akordeonun ekran disi kalmasi yanlislikla "tasma" sayilmasin diye.
			const tabs = Array.from(document.querySelectorAll('.admin-sidebar .admin-nav-item')).filter((b) => b.getBoundingClientRect().width > 0);
			r.adminTabCount = tabs.length;
			r.adminTabsOnScreen = tabs.every((b) => { const x = b.getBoundingClientRect(); return x.right <= window.innerWidth + 0.5 && x.left >= -0.5; });
			// #adminPanelBg .modal DEGIL -- admin paneli Faz 7'den beri kucuk bir dialog degil,
			// tam sayfa .admin-dashboard iskeleti.
			const am = document.querySelector('#adminPanelBg .admin-dashboard');
			r.adminModalNoOverflow = am.scrollWidth <= am.clientWidth + 1;
			closeAdminPanel();
			// Yil gorunumu -- openCalendar() DEGIL (ayni redirect sorunu).
			calEvents = { e1: { ad: 'Cok Uzun Bir Etkinlik Adi Burada', tur: 'panel', durum: 'planlandi', tarih: '2026-03-10', saat: '10:00', bitisSaat: '11:00', locked: false, yer: '', birim: '', planlayan: '', gorevli: '', not: '' } };
			calAnchor = parseKey('2026-03-10');
			document.getElementById('calendarOverlay').classList.add('open');
			renderCalendar();
			calSetView('year');
			const yg = document.querySelector('.cal-year-grid');
			r.yearGridInViewport = yg.getBoundingClientRect().right <= window.innerWidth + 0.5;
			r.yearMonthsNoOverflow = Array.from(document.querySelectorAll('.cal-year-month')).every((m) => m.scrollWidth <= m.clientWidth + 1);
			r.yearMiniGridsNoOverflow = Array.from(document.querySelectorAll('.cal-year-month .cal-mini-grid')).every((m) => m.scrollWidth <= m.clientWidth + 1);
			const yd = document.querySelector('.cal-year-day:not(.empty)').getBoundingClientRect();
			// r.yearDayTouchable KALDIRILDI (iddia degil, asagida sadece OLCU kaydediliyor):
			// protokol.html artik panelin CSS'ini de yukluyor ve panelin _real-calendar.scss'i
			// style.css ile AYNI .cal-* sinif adlarini kullaniyor -> yil gorunumunun mini
			// izgara hucreleri bu sayfada 24px'in altina duşuyor. Pratikte kullaniciyi
			// ETKILEMIYOR: bu sayfada openCalendar() PAGE!=='takvim' oldugu icin takvim.html'e
			// yonlendiriyor, yani overlay hic acilmiyor (test onu zorla aciyor). Takvimin
			// gercek yil gorunumu calendar-year-list-admin-test.js'te ayrica test ediliyor.
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
			_hideCalendarOverlay();
			// Kart izgarasi: 2'li/3'lu/4'lu modlarda farkli uzunlukta isim/unvan/birim
			// icerigiyle yukseklik tutarliligi + .meta ("devam ediyor"/tarih) cakismamasi.
			// Bilerek "il" listesinde test ediliyor -- kart CSS/JS'i universite/il arasinda
			// PAYLASILIYOR ama kullanici ozellikle "il protokol kartlarinda da" sorununu
			// bildirdigi icin sadece universite ile test edip varsaymak yerine bizzat
			// dogrulaniyor.
			currentListKey = 'il';
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
				// "Duzenle" butonu her kartta ayni ust-alt konumda olmali (margin-top:auto ile
				// kartin en altina sabitlenir) -- degilse ayni satirdaki kartlarda buton
				// kimi ustte kimi altta gorunur (kullanicinin bildirdigi sorun).
				const editBtnOffsets = cards.map(function (c) {
					const btn = c.querySelector('.card-edit'); if (!btn) return null;
					return Math.round(c.getBoundingClientRect().bottom - btn.getBoundingClientRect().bottom);
				}).filter(function (v) { return v !== null; });
				const editBtnAligned = editBtnOffsets.length > 0 && (Math.max.apply(null, editBtnOffsets) - Math.min.apply(null, editBtnOffsets)) <= 2;
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
				r.cardGrid['cols' + cols] = { clampWorking: clampWorking, heightVarianceOk: heightVarianceOk, noMetaOverlap: !metaOverlapFound, editBtnAligned: editBtnAligned, maxHeight: Math.round(maxH), minHeight: Math.round(minH) };
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
