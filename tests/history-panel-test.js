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
const PORT = 8995;
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
	await page.route('**fuse.js@*/dist/fuse.min.js', (r) => r.fulfill({ body: 'window.Fuse=function(){};', contentType: 'application/javascript' }));
	await page.route('**://fonts.googleapis.com/**', (r) => r.fulfill({ body: '' }));
	await page.route('**://fonts.gstatic.com/**', (r) => r.abort());
	// protokol.html artık halka açık DEĞİL: eski bağımsız sayfa kaldırıldı, adı
	// panelin içindeki sayfaya geçti ve giriş ZORUNLU oldu (kullanıcı isteği).
	// app.js'in fonksiyonlarına erişebilmek için giriş yapmış bir kullanıcı şart;
	// aksi halde shell.js giris.html'e yönlendirir ve app.js hiç yüklenmez.
	await page.addInitScript(() => {
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
	// BOLUM A: Masaustu (>=900px)
	// ==================================================================
	const page = await newPage(browser, 1400, 900, false);
	page.on('pageerror', (e) => pageErrors.push('desktop: ' + e.message));

	await page.evaluate(() => {
		currentUser = { uid: 'ed1', role: 'editor', firstName: 'T', lastName: 'K', email: 't@t.com' };
		applyPermissions();
		currentListKey = 'universite';
		people = [{ name: 'Test Kisi', title: 'Rektor', prefix: '', unit: 'OMU', status: 'aktif', rank: 1, photo: '', start: '', end: '', note: '' }];
		render();
	});

	// --- H-1: tetikleyici gorunurlugu ---
	const h1 = await page.evaluate(() => {
		openAddModal();
		const hiddenOnAdd = document.getElementById('historyToggleBtn').style.display === 'none';
		closeModal();
		openEditModal(0);
		const visibleOnEdit = document.getElementById('historyToggleBtn').style.display !== 'none';
		return { hiddenOnAdd, visibleOnEdit };
	});

	// --- H-2: masaustunde panel .modal'in SOLUNDA (gercek geometriyle); sekme .modal'dan
	// disari tastigi icin panel ACIKKEN cakismasin diye GIZLENIR, kapaninca GERI GELIR ---
	const h2 = await page.evaluate(() => {
		openHistoryPanel();
		const panelRect = document.getElementById('historyPanel').getBoundingClientRect();
		const modalRect = document.querySelector('#modalBg .modal').getBoundingClientRect();
		const cs = getComputedStyle(document.getElementById('historyPanel'));
		// NOT: getComputedStyle() CANLI (live) bir nesne dondurur -- deger ".position" OKUNDUGU ANDA
		// hesaplanir, cs OLUSTURULDUGU anda degil. Bu yuzden closeHistoryPanel() cagrilmadan ONCE
		// deger somut bir degiskene alinmali, yoksa asagida return icinde okundugunda panel zaten
		// kapanmis (.open sinifi kalkmis, position tekrar 'static'e donmus) olur.
		const isAbsoluteWhileOpen = cs.position === 'absolute';
		// NOT: panel artik #modalBg'nin degil #modalCenterWrap'in position:absolute cocugu (.modal
		// TEK basina ortalansin diye) -- eskiden 'static' bekleniyordu, artik 'absolute' beklenmeli.
		const toggleHiddenWhileOpen = document.getElementById('historyToggleBtn').style.display === 'none';
		closeHistoryPanel();
		const toggleVisibleAfterClose = document.getElementById('historyToggleBtn').style.display !== 'none';
		return { isAbsolute: isAbsoluteWhileOpen, panelIsLeftOfModal: panelRect.right <= modalRect.left + 1, toggleHiddenWhileOpen, toggleVisibleAfterClose };
	});

	// --- H-3: masaustunde history + successor panelleri AYNI ANDA acik kalabilir (kisitlama YOK) ---
	const h3 = await page.evaluate(() => {
		openHistoryPanel();
		openSuccessorPanel();
		const bothOpen = document.getElementById('historyPanel').classList.contains('open') && document.getElementById('successorPanel').classList.contains('open');
		closeSuccessorPanel(); closeHistoryPanel();
		return { bothOpenOnDesktop: bothOpen };
	});

	// --- H-4: ekle/sil -> tempGorevGecmisi + DOM ---
	const h4 = await page.evaluate(() => {
		openEditModal(0); openHistoryPanel();
		document.getElementById('hg_unvan').value = 'Vekâleten Dekan';
		document.getElementById('hg_baslangic').value = '2025-01-01';
		document.getElementById('hg_bitis').value = '2026-01-01';
		addHistoryEntry();
		const afterAdd = { count: tempGorevGecmisi.length, domHasText: document.getElementById('historyEntryList').textContent.indexOf('Vekâleten Dekan') !== -1 };
		removeHistoryEntry(0);
		const afterRemove = { count: tempGorevGecmisi.length };
		return { afterAdd, afterRemove };
	});

	// --- H-5: bos unvan reddedilir ---
	const h5 = await page.evaluate(() => {
		const before = tempGorevGecmisi.length;
		document.getElementById('hg_unvan').value = '';
		addHistoryEntry();
		return { rejectedEmpty: tempGorevGecmisi.length === before };
	});

	// --- H-6: Kaydet -> people[editIndex].gorevGecmisi dogru yaziliyor ---
	const h6 = await page.evaluate(async () => {
		document.getElementById('hg_unvan').value = 'Dekanlık Görevi';
		document.getElementById('hg_baslangic').value = '2025-06-01';
		document.getElementById('hg_bitis').value = '2026-06-01';
		addHistoryEntry();
		document.getElementById('f_name').value = 'Test Kisi';
		await saveForm();
		const saved = people[0].gorevGecmisi;
		return { savedCount: Array.isArray(saved) ? saved.length : 0, savedUnvan: Array.isArray(saved) && saved[0] ? saved[0].unvan : null };
	});

	// --- H-7: personAttendedEvents -- SADECE isim eslesir (unvan farkli olsa bile), en yeni once ---
	const h7 = await page.evaluate(() => {
		calEvents = {
			e1: { ad: 'Eski Etkinlik', tur: 'panel', durum: 'planlandi', tarih: '2024-01-10', katilimcilar: [{ prefix: '', name: 'Test Kisi', title: 'Eski Unvan' }] },
			e2: { ad: 'Yeni Etkinlik', tur: 'toplanti', durum: 'planlandi', tarih: '2025-05-20', katilimcilar: [{ prefix: '', name: 'Test Kisi', title: 'Rektor' }] },
			e3: { ad: 'Alakasiz Etkinlik', tur: 'panel', durum: 'planlandi', tarih: '2025-01-01', katilimcilar: [{ prefix: '', name: 'Baska Kisi', title: 'X' }] }
		};
		const evs = personAttendedEvents(people[0]);
		return { count: evs.length, mostRecentFirst: evs.length >= 2 && evs[0].ad === 'Yeni Etkinlik' && evs[1].ad === 'Eski Etkinlik', excludesUnrelated: !evs.some((e) => e.ad === 'Alakasiz Etkinlik') };
	});

	// --- H-8: EVENT_TYPES icinde "toplanti" var, etkinlik formunda secenek olarak gorunuyor ---
	const h8 = await page.evaluate(() => {
		closeModal();
		const hasType = EVENT_TYPES.some((t) => t.key === 'toplanti');
		openEventModal(null);
		const selectHasOption = document.getElementById('ev_tur').innerHTML.indexOf('Toplantı') !== -1;
		closeEventModal();
		return { hasType, selectHasOption };
	});

	// --- H-13: Gorev Gecmisi'ne baslangic tarihli bir kayit eklenince ana f_start da senkron olur ---
	const h13 = await page.evaluate(() => {
		openEditModal(0); openHistoryPanel();
		document.getElementById('f_start').value = '2020-01-01';
		document.getElementById('hg_unvan').value = 'Yeni Vekâlet';
		document.getElementById('hg_baslangic').value = '2026-03-15';
		document.getElementById('hg_bitis').value = '';
		addHistoryEntry();
		const fStartSynced = document.getElementById('f_start').value === '2026-03-15';
		// bitis tarihi girilmezse de sorun cikmamali, baslangic bos birakilirsa f_start DEGISMEMELI
		document.getElementById('hg_unvan').value = 'Baslangicsiz Kayit';
		document.getElementById('hg_baslangic').value = '';
		addHistoryEntry();
		const fStartUnchangedWhenNoStart = document.getElementById('f_start').value === '2026-03-15';
		return { fStartSynced, fStartUnchangedWhenNoStart };
	});

	await page.close();

	// ==================================================================
	// BOLUM B: Mobil (<900px)
	// ==================================================================
	const mp = await newPage(browser, 393, 852, true);
	mp.on('pageerror', (e) => pageErrors.push('mobile: ' + e.message));
	await mp.evaluate(() => {
		currentUser = { uid: 'ed1', role: 'editor', firstName: 'T', lastName: 'K', email: 't@t.com' };
		applyPermissions();
		currentListKey = 'universite';
		people = [{ name: 'Test Kisi', title: 'Rektor', prefix: '', unit: 'OMU', status: 'aktif', rank: 1, photo: '', start: '', end: '', note: '' }];
		render();
		openEditModal(0);
	});

	// --- H-9: mobilde acilinca .modal gizlenir, panel tam ekran ---
	const h9 = await mp.evaluate(() => {
		openHistoryPanel();
		const modalDisplay = getComputedStyle(document.querySelector('#modalBg .modal')).display;
		const panelPos = getComputedStyle(document.getElementById('historyPanel')).position;
		const hasHideClass = document.getElementById('modalBg').classList.contains('hide-behind-panel');
		return { modalHidden: modalDisplay === 'none', panelIsFixed: panelPos === 'fixed', hasHideClass };
	});
	// --- H-10: kapatinca geri doner ---
	const h10 = await mp.evaluate(() => {
		closeHistoryPanel();
		const modalDisplay = getComputedStyle(document.querySelector('#modalBg .modal')).display;
		const hasHideClass = document.getElementById('modalBg').classList.contains('hide-behind-panel');
		return { modalVisibleAgain: modalDisplay !== 'none', hideClassRemoved: !hasHideClass };
	});
	// --- H-11: mobilde iki panel UST USTE acilmaz -- biri acilinca digeri kapanir ---
	const h11 = await mp.evaluate(() => {
		openSuccessorPanel();
		openHistoryPanel(); // successor'i otomatik kapatmali (mobilde)
		const successorStillOpen = document.getElementById('successorPanel').classList.contains('open');
		const historyOpen = document.getElementById('historyPanel').classList.contains('open');
		openSuccessorPanel(); // simdi history'yi kapatmali
		const historyClosedAfter = !document.getElementById('historyPanel').classList.contains('open');
		closeSuccessorPanel(); closeHistoryPanel();
		return { successorClosedWhenHistoryOpened: !successorStillOpen, historyOpenedOk: historyOpen, historyClosedWhenSuccessorOpened: historyClosedAfter };
	});

	await mp.close();

	const results = { h1, h2, h3, h4, h5, h6, h7, h8, h9, h10, h11, h13 };
	console.log(JSON.stringify(results, null, 2));
	console.log('PAGE ERRORS:', pageErrors.length);
	pageErrors.forEach((e) => console.log(' -', e));

	const checks = {
		h1_hiddenOnAdd: h1.hiddenOnAdd, h1_visibleOnEdit: h1.visibleOnEdit,
		h2_isAbsolute: h2.isAbsolute, h2_panelIsLeftOfModal: h2.panelIsLeftOfModal, h2_toggleHiddenWhileOpen: h2.toggleHiddenWhileOpen, h2_toggleVisibleAfterClose: h2.toggleVisibleAfterClose,
		h3_bothOpenOnDesktop: h3.bothOpenOnDesktop,
		h4_addWorked: h4.afterAdd.count === 1, h4_domUpdated: h4.afterAdd.domHasText, h4_removeWorked: h4.afterRemove.count === 0,
		h5_rejectedEmpty: h5.rejectedEmpty,
		h6_savedCount: h6.savedCount === 1, h6_savedUnvan: h6.savedUnvan === 'Dekanlık Görevi',
		h7_count: h7.count === 2, h7_mostRecentFirst: h7.mostRecentFirst, h7_excludesUnrelated: h7.excludesUnrelated,
		h8_hasType: h8.hasType, h8_selectHasOption: h8.selectHasOption,
		h9_modalHidden: h9.modalHidden, h9_panelIsFixed: h9.panelIsFixed, h9_hasHideClass: h9.hasHideClass,
		h10_modalVisibleAgain: h10.modalVisibleAgain, h10_hideClassRemoved: h10.hideClassRemoved,
		h11_successorClosedWhenHistoryOpened: h11.successorClosedWhenHistoryOpened, h11_historyOpenedOk: h11.historyOpenedOk, h11_historyClosedWhenSuccessorOpened: h11.historyClosedWhenSuccessorOpened,
		h13_fStartSynced: h13.fStartSynced, h13_fStartUnchangedWhenNoStart: h13.fStartUnchangedWhenNoStart,
		pageErrorsCount: pageErrors.length === 0
	};

	const boolFails = collectBooleanFailures(checks, []);
	const allPassed = pageErrors.length === 0 && boolFails.length === 0;
	console.log('ALL_TESTS_PASSED:', allPassed);
	if (boolFails.length) console.log('BASARISIZ ALANLAR:', JSON.stringify(boolFails));

	await browser.close();
	server.close();
	process.exitCode = allPassed ? 0 : 1;
})();
