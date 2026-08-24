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
const PORT = 8996;
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
	await page.route('**fuse.js@*/dist/fuse.min.js', (r) => r.fulfill({ body: 'window.Fuse=function(){};', contentType: 'application/javascript' }));
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

	const page = await newPage(browser, 1400, 900, false);
	page.on('pageerror', (e) => pageErrors.push(e.message));

	await page.evaluate(() => {
		currentUser = { uid: 'ed1', role: 'editor', firstName: 'T', lastName: 'K', email: 't@t.com' };
		applyPermissions();
		currentListKey = 'universite';
		people = [
			{ name: 'Aktif Kisi', title: 'Dekan', prefix: 'Prof. Dr.', unit: 'OMU', status: 'aktif', rank: 5, photo: '', start: '2024-01-01', end: '', note: '' },
			{ name: 'Pasif Kisi', title: 'Eski Dekan', prefix: 'Prof. Dr.', unit: 'OMU', status: 'pasif', rank: 6, photo: '', start: '2020-01-01', end: '2026-01-01', note: '' },
			{ name: 'Successor Kaynak', title: 'Fakülte Sekreteri', prefix: '', unit: 'OMU', status: 'aktif', rank: 7, photo: '', start: '2023-01-01', end: '', note: '' },
			{ name: 'Fallback Kaynak', title: 'Şube Müdürü', prefix: '', unit: 'OMU', status: 'aktif', rank: 8, photo: '', start: '2022-01-01', end: '', note: '' }
		];
		render();
	});

	// --- ST-1: yeni kayit eklerken f_status->pasif -- sorgu blogu hic tetiklenmemeli ---
	const st1 = await page.evaluate(() => {
		openAddModal();
		const sel = document.getElementById('f_status');
		sel.value = 'pasif';
		sel.dispatchEvent(new Event('change'));
		const blockHiddenOnAdd = document.getElementById('statusReasonBlock').style.display === 'none';
		closeModal();
		return { blockHiddenOnAdd };
	});

	// --- ST-2: aktif bir kaydi duzenlerken sorgu blogu VE successor tetikleyicisi baslangicta gizli
	// (REGRESYON testi: eskiden successorTriggerWrap kosulsuz "block" idi) ---
	const st2 = await page.evaluate(() => {
		openEditModal(0);
		const blockHiddenOnActiveEdit = document.getElementById('statusReasonBlock').style.display === 'none';
		const successorHiddenOnActiveEdit = document.getElementById('successorTriggerWrap').style.display === 'none';
		return { blockHiddenOnActiveEdit, successorHiddenOnActiveEdit };
	});

	// --- ST-11/ST-12: Gorev Gecmisi panelinde "Guncel" satiri + canli senkron (ayni oturumda, index 0) ---
	const st11_12 = await page.evaluate(() => {
		openHistoryPanel();
		const html1 = document.getElementById('historyEntryList').innerHTML;
		const hasCurrentBadge = html1.indexOf('hg-row-current') !== -1 && html1.indexOf('Güncel') !== -1;
		const showsOngoing = html1.indexOf('devam ediyor') !== -1;
		const showsCurrentTitle = html1.indexOf('Dekan') !== -1;
		document.getElementById('f_title').value = 'Değişmiş Unvan Testi';
		document.getElementById('f_title').dispatchEvent(new Event('input'));
		const html2 = document.getElementById('historyEntryList').innerHTML;
		const liveUpdatedOnTitleInput = html2.indexOf('Değişmiş Unvan Testi') !== -1;
		document.getElementById('f_title').value = 'Dekan'; document.getElementById('f_title').dispatchEvent(new Event('input')); // geri al
		closeHistoryPanel();
		return { hasCurrentBadge, showsOngoing, showsCurrentTitle, liveUpdatedOnTitleInput };
	});

	// --- ST-4: aktifken f_status->pasif -- sorgu blogu + 3 secenek gorunur ---
	const st4 = await page.evaluate(() => {
		const sel = document.getElementById('f_status');
		sel.value = 'pasif';
		sel.dispatchEvent(new Event('change'));
		const blockVisible = document.getElementById('statusReasonBlock').style.display === 'block';
		const html = document.getElementById('sr_reason').innerHTML;
		const hasAllOptions = html.indexOf('yeni_gorev') !== -1 && html.indexOf('gorev_bitti') !== -1 && html.indexOf('yerine_atama') !== -1;
		return { blockVisible, hasAllOptions };
	});

	// --- ST-5: reason="yeni_gorev" secilince yeni-unvan alt-blogu gorunur, successor GORUNMEZ ---
	const st5 = await page.evaluate(() => {
		const sel = document.getElementById('sr_reason');
		sel.value = 'yeni_gorev';
		sel.dispatchEvent(new Event('change'));
		const applyVisible = document.getElementById('sr_applyRow').style.display === 'block';
		const successorStillHidden = document.getElementById('successorTriggerWrap').style.display === 'none';
		const transitionDatePrefilled = document.getElementById('sr_transitionDate').value !== '';
		return { applyVisible, successorStillHidden, transitionDatePrefilled };
	});

	// --- ST-6: "Uygula" -- eski unvan+tarih tempGorevGecmisi'ye arsivlenir, form Aktif'e doner ---
	const st6 = await page.evaluate(() => {
		const expectedTransitionDate = document.getElementById('sr_transitionDate').value;
		document.getElementById('sr_newTitle').value = 'Öğretim Üyesi';
		applyStatusReason();
		const hist = tempGorevGecmisi;
		const archivedCorrectly = hist.length === 1 && hist[0].unvan === 'Dekan' && hist[0].baslangic === '2024-01-01' && hist[0].bitis === expectedTransitionDate;
		const titleUpdated = document.getElementById('f_title').value === 'Öğretim Üyesi';
		const startMovedToTransitionDate = document.getElementById('f_start').value === expectedTransitionDate;
		const statusBackToAktif = document.getElementById('f_status').value === 'aktif';
		const endCleared = document.getElementById('f_end').value === '';
		const blockHiddenAfterApply = document.getElementById('statusReasonBlock').style.display === 'none';
		return { archivedCorrectly, titleUpdated, startMovedToTransitionDate, statusBackToAktif, endCleared, blockHiddenAfterApply };
	});

	// --- ST-7: Kaydet -- log mesaji sebebe ozgu ibareyi iceriyor, kayit dogru persist oluyor ---
	const st7 = await page.evaluate(async () => {
		window.__mockPushes = [];
		await saveForm();
		const logPush = window.__mockPushes.find((p) => p.path === 'logs/universite');
		const noteInLog = !!(logPush && logPush.data && logPush.data.action && logPush.data.action.indexOf('Yeni göreve atandı') !== -1);
		const savedTitle = people[0].title === 'Öğretim Üyesi';
		const savedStatusAktif = people[0].status === 'aktif';
		const savedHistLen = Array.isArray(people[0].gorevGecmisi) ? people[0].gorevGecmisi.length : 0;
		return { noteInLog, savedTitle, savedStatusAktif, savedHistLen1: savedHistLen === 1 };
	});

	// --- ST-3: ZATEN pasif bir kaydi duzenlerken sorgu blogu GORUNUR (regresyon-onleme:
	// successor'a giden yol hala erisilebilir olmali) ---
	const st3 = await page.evaluate(() => {
		closeModal();
		openEditModal(1);
		const blockVisibleOnAlreadyPasif = document.getElementById('statusReasonBlock').style.display === 'block';
		closeModal();
		return { blockVisibleOnAlreadyPasif };
	});

	// --- ST-8/ST-10/ST-9: reason="yerine_atama" -> successor tetikleyicisi gorunur; f_end
	// bosken kaydetme reddedilir; f_end doldurulunca YENI kisi + ESKI kaydin pasife alinmasi
	// TEK islemde (update()) atomik olarak persist olur ---
	const st8_10_9 = await page.evaluate(async () => {
		openEditModal(2);
		const sel = document.getElementById('f_status');
		sel.value = 'pasif'; sel.dispatchEvent(new Event('change'));
		const reasonSel = document.getElementById('sr_reason');
		reasonSel.value = 'yerine_atama'; reasonSel.dispatchEvent(new Event('change'));
		const successorVisible = document.getElementById('successorTriggerWrap').style.display === 'block';
		const applyRowHidden = document.getElementById('sr_applyRow').style.display === 'none';

		openSuccessorPanel();
		document.getElementById('sf_name').value = 'Yeni Sekreter';

		// ST-10: f_end bos -- kaydetme reddedilmeli, people degismemeli
		const lenBeforeReject = people.length;
		await saveSuccessor();
		const rejectedWhenEndEmpty = people.length === lenBeforeReject;

		// f_end doldur (successor panel acikken sf_start'i da otomatik senkronlar) + tekrar dene
		document.getElementById('f_end').value = '2026-08-24';
		window.__mockOnceSnapshot = JSON.parse(JSON.stringify(people)); // saveSuccessor()'in fresh-read'i people'i EZMESIN diye
		window.__mockUpdates = [];
		await saveSuccessor();

		const newPersonIdx = people.length - 1;
		const newPersonOk = people[newPersonIdx] && people[newPersonIdx].name === 'Yeni Sekreter' && people[newPersonIdx].status === 'aktif';
		const oldPersonOk = people[2].status === 'pasif' && people[2].end === '2026-08-24' && people[2].name === 'Successor Kaynak';

		const upd = window.__mockUpdates[window.__mockUpdates.length - 1];
		const updateKeys = upd ? Object.keys(upd.data).sort() : [];
		const atomicUpdateHadBothIndexes = updateKeys.length === 2 && updateKeys.indexOf(String(newPersonIdx)) !== -1 && updateKeys.indexOf('2') !== -1;
		const updateDataCorrect = upd && upd.data[String(2)] && upd.data[String(2)].status === 'pasif' && upd.data[String(newPersonIdx)] && upd.data[String(newPersonIdx)].status === 'aktif';

		return { successorVisible, applyRowHidden, rejectedWhenEndEmpty, newPersonOk, oldPersonOk, atomicUpdateHadBothIndexes, updateDataCorrect };
	});

	// --- ST-9b: peopleNeedsFullSave=true iken saveSuccessor() -- update() DEGIL, saveData() (tek .set()) kullanilmali ---
	const st9b = await page.evaluate(async () => {
		closeModal();
		openEditModal(3);
		document.getElementById('f_status').value = 'pasif'; document.getElementById('f_status').dispatchEvent(new Event('change'));
		document.getElementById('sr_reason').value = 'yerine_atama'; document.getElementById('sr_reason').dispatchEvent(new Event('change'));
		openSuccessorPanel();
		document.getElementById('sf_name').value = 'Fallback Yeni Kisi';
		document.getElementById('f_end').value = '2026-08-24';
		// normalizePeopleSnapshot() peopleNeedsFullSave'i KENDISI hesaplar (once() donusunden
		// hemen sonra) -- elle onceden true atamak yeterli DEGIL, fresh-read bunu eziyor. Gercek
		// Firebase'in bosluklu diziyi nesne olarak donmesini simule etmek icin snapshot'i
		// dizi degil {index:kisi} nesnesi olarak veriyoruz -- bu, !Array.isArray(data) dalindan
		// gecerek peopleNeedsFullSave'i GERCEK kod yoluyla true yapar.
		const snapshotObj = {}; people.forEach((p, i) => { snapshotObj[i] = p; });
		window.__mockOnceSnapshot = JSON.parse(JSON.stringify(snapshotObj));
		window.__mockSets = [];
		const updatesBefore = (window.__mockUpdates || []).length;
		await saveSuccessor();
		const usedSaveDataNotUpdate = (window.__mockUpdates || []).length === updatesBefore && window.__mockSets.length > 0;
		const lastSet = window.__mockSets[window.__mockSets.length - 1];
		const fullArrayHasBoth = lastSet && Array.isArray(lastSet.data) && lastSet.data.some((p) => p && p.name === 'Fallback Yeni Kisi' && p.status === 'aktif') && lastSet.data[3] && lastSet.data[3].status === 'pasif';
		return { usedSaveDataNotUpdate, fullArrayHasBoth };
	});

	await page.close();

	const results = { st1, st2, st11_12, st4, st5, st6, st7, st3, st8_10_9, st9b };
	console.log(JSON.stringify(results, null, 2));
	console.log('PAGE ERRORS:', pageErrors.length);
	pageErrors.forEach((e) => console.log(' -', e));

	const checks = {
		st1_blockHiddenOnAdd: st1.blockHiddenOnAdd,
		st2_blockHiddenOnActiveEdit: st2.blockHiddenOnActiveEdit, st2_successorHiddenOnActiveEdit: st2.successorHiddenOnActiveEdit,
		st11_hasCurrentBadge: st11_12.hasCurrentBadge, st11_showsOngoing: st11_12.showsOngoing, st11_showsCurrentTitle: st11_12.showsCurrentTitle,
		st12_liveUpdatedOnTitleInput: st11_12.liveUpdatedOnTitleInput,
		st4_blockVisible: st4.blockVisible, st4_hasAllOptions: st4.hasAllOptions,
		st5_applyVisible: st5.applyVisible, st5_successorStillHidden: st5.successorStillHidden, st5_transitionDatePrefilled: st5.transitionDatePrefilled,
		st6_archivedCorrectly: st6.archivedCorrectly, st6_titleUpdated: st6.titleUpdated, st6_startMovedToTransitionDate: st6.startMovedToTransitionDate,
		st6_statusBackToAktif: st6.statusBackToAktif, st6_endCleared: st6.endCleared, st6_blockHiddenAfterApply: st6.blockHiddenAfterApply,
		st7_noteInLog: st7.noteInLog, st7_savedTitle: st7.savedTitle, st7_savedStatusAktif: st7.savedStatusAktif, st7_savedHistLen1: st7.savedHistLen1,
		st3_blockVisibleOnAlreadyPasif: st3.blockVisibleOnAlreadyPasif,
		st8_successorVisible: st8_10_9.successorVisible, st8_applyRowHidden: st8_10_9.applyRowHidden,
		st10_rejectedWhenEndEmpty: st8_10_9.rejectedWhenEndEmpty,
		st9_newPersonOk: st8_10_9.newPersonOk, st9_oldPersonOk: st8_10_9.oldPersonOk,
		st9_atomicUpdateHadBothIndexes: st8_10_9.atomicUpdateHadBothIndexes, st9_updateDataCorrect: st8_10_9.updateDataCorrect,
		st9b_usedSaveDataNotUpdate: st9b.usedSaveDataNotUpdate, st9b_fullArrayHasBoth: st9b.fullArrayHasBoth,
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
