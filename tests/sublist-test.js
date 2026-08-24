const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');
// --- CI icin: sonuc nesnesindeki TUM boolean yapraklari gez, false olanlari
// (haric-listesi disinda) topla.
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
const PORT = 8969;
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
	await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });
	await page.waitForTimeout(300);

	// --- Ortak kurulum: editor olarak "oturum aç", tek bir etkinlik + iki listeden birer kişi ---
	await page.evaluate(() => {
		currentUser = { role: 'editor', firstName: 'Test', lastName: 'Kullanıcı', email: 'test@test.com' };
		applyPermissions();
		currentListKey = 'universite';
		people = [{ name: 'Üni Kişi', title: 'Rektör', unit: 'OMÜ', prefix: 'Prof. Dr.', status: 'aktif' }];
		calEvents = { ev1: { ad: 'BİLİMFEST', tur: 'diger', durum: 'planlandi', tarih: '2026-09-10', katilimcilar: [] } };
		calSublists = {};
		// "İl" listesi için gerçek Firebase yerine sahte tek-seferlik veri döndüren yama.
		// (mock-firebase.js'in once() metodu her zaman null döner; test burada sadece
		// ilgili yolu (ilProtokolVerileri) hedefleyerek üzerine yazar, diğer yollara dokunmaz.)
		const origRef = database.ref.bind(database);
		database.ref = function (p) {
			if (p === 'ilProtokolVerileri') {
				return { once: () => Promise.resolve({ val: () => ({ p1: { name: 'İl Kişi Bir', title: 'Vali', unit: 'İl', status: 'aktif' } }) }) };
			}
			return origRef(p);
		};
	});

	// =====================================================================
	// SENARYO 1: Modal açılışı + birleşik havuz (İl + Üniversite) doğru geliyor mu?
	// =====================================================================
	const openTest = await page.evaluate(async () => {
		openSublistModal('ev1', null);
		await loadSublistPool();
		renderSublistMemberPicker();
		const box = document.getElementById('subl_box');
		return {
			modalOpen: document.getElementById('sublistModalBg').classList.contains('open'),
			defaultTitle: document.getElementById('subl_ad').value,
			hasUniPerson: box.innerHTML.indexOf('Üni Kişi') !== -1,
			hasIlPerson: box.innerHTML.indexOf('İl Kişi Bir') !== -1
		};
	});

	// =====================================================================
	// SENARYO 2: İki kişiyi de işaretleyip seçili üyeler kutusuna eklenmesi
	// =====================================================================
	const selectTest = await page.evaluate(() => {
		document.querySelectorAll('#subl_box .subl-cb').forEach((cb) => {
			cb.checked = true;
			cb.dispatchEvent(new Event('change', { bubbles: true }));
		});
		return {
			memberCount: sublistMembers.length,
			hasIl: sublistMembers.some((m) => m.name === 'İl Kişi Bir' && m.kaynakListe === 'il'),
			hasUni: sublistMembers.some((m) => m.name === 'Üni Kişi' && m.kaynakListe === 'universite'),
			membersBoxRendered: document.querySelectorAll('#subl_membersBox .sublist-member-row').length === 2
		};
	});

	// =====================================================================
	// SENARYO 3: Sürükle-bırak sırasını simüle et (Sortable mock, onEnd elle tetiklenir)
	// =====================================================================
	const reorderTest = await page.evaluate(() => {
		const box = document.getElementById('subl_membersBox');
		const before = sublistMembers.map((m) => m.name);
		box.insertBefore(box.lastElementChild, box.firstElementChild); // DOM sırasını ters çevir
		sublistSortable.options.onEnd();
		const after = sublistMembers.map((m) => m.name);
		return {
			orderReallyChanged: before[0] !== after[0],
			siraIsSequential: sublistMembers[0].sira === 1 && sublistMembers[1].sira === 2
		};
	});

	// =====================================================================
	// SENARYO 4: Kaydet -> etkinlikOzelListeleri'ne push, log yazılıyor, calSublists güncelleniyor
	// =====================================================================
	const saveTest = await page.evaluate(async () => {
		window.__mockPushes = [];
		document.getElementById('subl_ad').value = 'BİLİMFEST Protokolü Testi';
		await saveSublist();
		const push = window.__mockPushes.find((p) => p.path === 'etkinlikOzelListeleri');
		const log = window.__mockPushes.find((p) => p.path === 'logs/ozelListe');
		return {
			pushHappened: !!push,
			pushAd: push && push.data.ad,
			pushEtkinlikId: push && push.data.etkinlikId,
			pushMemberCount: push && Array.isArray(push.data.uyeler) ? push.data.uyeler.length : 0,
			pushSiraOk: push && push.data.uyeler[0].sira === 1 && push.data.uyeler[1].sira === 2,
			logHappened: !!log,
			modalClosed: !document.getElementById('sublistModalBg').classList.contains('open'),
			calSublistsUpdated: Object.keys(calSublists).some((id) => calSublists[id].ad === 'BİLİMFEST Protokolü Testi')
		};
	});

	// =====================================================================
	// SENARYO 5: requireEdit() kapısı -- yetkisiz kullanıcı modalı açamaz
	// =====================================================================
	const gateTest = await page.evaluate(() => {
		document.getElementById('sublistModalBg').classList.remove('open');
		currentUser = { role: 'pending', firstName: 'Yetkisiz', lastName: 'Kullanıcı', email: 'x@test.com' };
		applyPermissions();
		openSublistModal('ev1', null);
		const blocked = !document.getElementById('sublistModalBg').classList.contains('open');
		currentUser = { role: 'editor', firstName: 'Test', lastName: 'Kullanıcı', email: 'test@test.com' };
		applyPermissions();
		return { blocked };
	});

	// =====================================================================
	// SENARYO 6: Silme -- calSublists'ten kaldırılıyor
	// =====================================================================
	const deleteTest = await page.evaluate(async () => {
		const id = Object.keys(calSublists)[0];
		openSublistDeleteConfirm(id);
		const confirmOpen = document.getElementById('sublistDeleteConfirmModalBg').classList.contains('open');
		await executeSublistDelete();
		return { confirmOpen, removedFromState: !calSublists[id] };
	});

	const results = { openTest, selectTest, reorderTest, saveTest, gateTest, deleteTest, pageErrorsCount: pageErrors.length };
	console.log(JSON.stringify(results, null, 2));
	if (pageErrors.length) { console.log('PAGE ERRORS:'); pageErrors.forEach((e) => console.log(' - ' + e)); }

	const __boolFails = collectBooleanFailures(results, []);
	const __allPassed = pageErrors.length === 0 && __boolFails.length === 0;
	console.log('ALL_TESTS_PASSED:', __allPassed);
	if (__boolFails.length) console.log('BASARISIZ ALANLAR:', JSON.stringify(__boolFails));

	await browser.close();
	server.close();
	process.exitCode = __allPassed ? 0 : 1;
})();
