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
const PORT = 8966;
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
	await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });
	await page.waitForTimeout(300);

	// --- Ortak kurulum: editor olarak "oturum ac", basinGorevlileri/users yollarini
	// gercek verilerle donen bir database.ref sarmalayicisiyla degistir (mock-firebase.js
	// her once() cagrisinda bos/null dondugu icin, gercek loadPressOfficerPool/loadAdminUsers
	// kod yolunu test edebilmek icin path'e ozel sahte veri gerekiyor).
	const setupResult = await page.evaluate(() => {
		currentUser = { uid: 'ed1', role: 'editor', firstName: 'Test', lastName: 'Kullanici', email: 'test@test.com' };
		applyPermissions();
		calAnchor = parseKey('2026-02-02');
		calView = 'week';
		calEvents = {
			'evOld1': { ad: 'Eski Tekli Kayit', tur: 'konferans', durum: 'planlandi', tarih: '2026-02-02', saat: '09:00', bitisSaat: '10:00', locked: true, yer: '', birim: '', planlayan: '', gorevli: 'Eski Muhabir', not: '' },
			'evOld2': { ad: 'Eski Coklu Kayit', tur: 'panel', durum: 'planlandi', tarih: '2026-02-02', saat: '11:00', bitisSaat: '12:00', locked: true, yer: '', birim: '', planlayan: '', gorevli: 'Ahmet Yilmaz, Zeynep Kaya', not: '' },
			'evLockPreserve': { ad: 'Kilit Korunmali', tur: 'diger', durum: 'planlandi', tarih: '2026-02-02', saat: '13:00', bitisSaat: '14:00', locked: false, yer: 'Eski Yer', birim: '', planlayan: '', gorevli: '', not: '' }
		};

		window.__writes = [];
		const origRef = database.ref.bind(database);
		const fakeBasinGorevlileri = { u1: 'Ahmet Yilmaz', u2: 'Zeynep Kaya', u3: 'Mehmet Demir' };
		const fakeUsers = {
			admin1: { firstName: 'Zeynep', lastName: 'Admin', email: 'zadmin@omu.edu.tr', role: 'admin', basinGorevlisi: false },
			ed2: { firstName: 'Ahmet', lastName: 'Editor', email: 'aeditor@omu.edu.tr', role: 'editor', basinGorevlisi: true }
		};
		database.ref = function (path) {
			const r = origRef(path);
			if (path === 'basinGorevlileri') {
				r.once = function () { return Promise.resolve({ val: function () { return fakeBasinGorevlileri; } }); };
			}
			if (path === 'users') {
				r.once = function () { return Promise.resolve({ val: function () { return fakeUsers; } }); };
			}
			if (path === 'users/admin1') {
				r.once = function () { return Promise.resolve({ val: function () { return fakeUsers.admin1; } }); };
			}
			if (path === 'users/ed2') {
				r.once = function () { return Promise.resolve({ val: function () { return fakeUsers.ed2; } }); };
			}
			if (path.indexOf('users/') === 0 && path.indexOf('/basinGorevlisi') !== -1) {
				const origSet = r.set.bind(r);
				r.set = function (v) { window.__writes.push({ path: path, op: 'set', value: v }); return origSet(v); };
			}
			if (path.indexOf('basinGorevlileri/') === 0) {
				const origSet = r.set.bind(r), origRemove = r.remove.bind(r);
				r.set = function (v) { window.__writes.push({ path: path, op: 'set', value: v }); return origSet(v); };
				r.remove = function () { window.__writes.push({ path: path, op: 'remove' }); return origRemove(); };
			}
			// toggleUserBasinGorevlisi() artik IKI ayri .set()/.remove() DEGIL, TEK atomik
			// database.ref("/").update({...}) cagrisi kullaniyor (audit #9) -- kok referansindaki
			// update() burada ayristirilip ayni {path,op,value} sekline donusturulur ki asagidaki
			// testler DEGISMEDEN calismaya devam etsin.
			if (path === '/') {
				const origUpdate = r.update.bind(r);
				r.update = function (data) {
					Object.keys(data || {}).forEach(function (k) {
						if (k.indexOf('users/') === 0 && k.indexOf('/basinGorevlisi') !== -1) {
							window.__writes.push({ path: k, op: 'set', value: data[k] });
						} else if (k.indexOf('basinGorevlileri/') === 0) {
							window.__writes.push(data[k] === null ? { path: k, op: 'remove' } : { path: k, op: 'set', value: data[k] });
						}
					});
					return origUpdate(data);
				};
			}
			return r;
		};

		openCalendar();
		return { calendarOpen: document.getElementById('calendarOverlay').classList.contains('open') };
	});
	await page.waitForTimeout(150);

	// =====================================================================
	// SENARYO 1: Yeni etkinlik - havuzdan coklu secim, kaydederken alfabetik
	// siraya dizilip virgulle birlestiriliyor mu (secim SIRASI ONEMSIZ olmali).
	// =====================================================================
	const multiSelectTest = await page.evaluate(async () => {
		openEventModal(null, '2026-02-03');
		await new Promise((r) => setTimeout(r, 60)); // loadPressOfficerPool() cozulsun
		const poolLoadedOk = pressOfficerPool.length === 3 && pressOfficerPool[0].name === 'Ahmet Yilmaz';
		document.getElementById('ev_ad').value = 'Coklu Secim Testi';
		// Bilerek ALFABETIK OLMAYAN sirada tikla: once Zeynep, sonra Ahmet.
		const zBox = Array.from(document.querySelectorAll('.ev-gorevli-cb')).find((cb) => cb.dataset.name === 'Zeynep Kaya');
		const aBox = Array.from(document.querySelectorAll('.ev-gorevli-cb')).find((cb) => cb.dataset.name === 'Ahmet Yilmaz');
		zBox.click();
		aBox.click();
		const selectionOrderWas = calPressStaff.slice();
		await saveEvent();
		const newId = undoStack[undoStack.length - 1].id;
		return {
			poolLoadedOk,
			selectionOrderWasZeynepFirst: selectionOrderWas[0] === 'Zeynep Kaya',
			savedSortedCorrectly: calEvents[newId].gorevli === 'Ahmet Yilmaz, Zeynep Kaya',
			newEventLockedByDefault: calEvents[newId].locked === true
		};
	});

	// =====================================================================
	// SENARYO 2: Eski tek-isimli kayit (virgulsuz) picker'da "orphan" olarak
	// secili gorunmeli ve dokunulmadan kaydedilince degismemeli.
	// =====================================================================
	const backwardCompatSingleTest = await page.evaluate(async () => {
		openEventModal('evOld1');
		await new Promise((r) => setTimeout(r, 60));
		const parsedOk = calPressStaff.length === 1 && calPressStaff[0] === 'Eski Muhabir';
		const orphanChecked = Array.from(document.querySelectorAll('.ev-gorevli-cb')).some((cb) => cb.dataset.name === 'Eski Muhabir' && cb.checked);
		await saveEvent();
		return { parsedOk, orphanChecked, unchangedAfterSave: calEvents['evOld1'].gorevli === 'Eski Muhabir' };
	});

	// =====================================================================
	// SENARYO 3: Eski coklu (zaten virgullu) kayit dogru parse ediliyor mu;
	// bir kisi cikarilinca sadece kalan kisi kaydediliyor mu.
	// =====================================================================
	const removeOneTest = await page.evaluate(async () => {
		openEventModal('evOld2');
		await new Promise((r) => setTimeout(r, 60));
		const parsedOk = calPressStaff.length === 2 && calPressStaff.indexOf('Ahmet Yilmaz') !== -1 && calPressStaff.indexOf('Zeynep Kaya') !== -1;
		const ahmetBox = Array.from(document.querySelectorAll('.ev-gorevli-cb')).find((cb) => cb.dataset.name === 'Ahmet Yilmaz');
		ahmetBox.click(); // cikar
		await saveEvent();
		return { parsedOk, onlyZeynepRemains: calEvents['evOld2'].gorevli === 'Zeynep Kaya' };
	});

	// =====================================================================
	// SENARYO 4: Kilit korunuyor mu - VAR OLAN bir etkinlik (locked:false)
	// duzenlenip kaydedildiginde locked degeri degismemeli (sadece YENI
	// kayitlarda varsayilan degisti, duzenlemede DOKUNULMADI).
	// =====================================================================
	const lockPreservedOnEditTest = await page.evaluate(async () => {
		openEventModal('evLockPreserve');
		await new Promise((r) => setTimeout(r, 60));
		document.getElementById('ev_yer').value = 'Yeni Yer';
		await saveEvent();
		return { stillUnlocked: calEvents['evLockPreserve'].locked === false, yerUpdated: calEvents['evLockPreserve'].yer === 'Yeni Yer' };
	});

	// =====================================================================
	// SENARYO 5: Kendini otomatik secme - giris yapan kisi havuzdaysa VE
	// hicbir secim yapilmamissa, yeni etkinlikte otomatik isaretlenmeli.
	// =====================================================================
	const selfDefaultTest = await page.evaluate(async () => {
		currentUser = { uid: 'u2', role: 'editor', firstName: 'Zeynep', lastName: 'Kaya', email: 'zeynep@test.com' };
		openEventModal(null, '2026-02-04');
		await new Promise((r) => setTimeout(r, 60));
		return { selfAutoSelected: calPressStaff.length === 1 && calPressStaff[0] === 'Zeynep Kaya' };
	});

	// =====================================================================
	// SENARYO 6: Kilit ikonu artik TAM KARE (onceki hata: asimetrik padding
	// yuzunden dikdortgendi). Hem koseye sabit hem "kenara" (compact) varyanti.
	// =====================================================================
	const lockSquareTest = await page.evaluate(() => {
		currentUser = { uid: 'ed1', role: 'editor', firstName: 'Test', lastName: 'Kullanici', email: 'test@test.com' };
		calView = 'week'; calAnchor = parseKey('2026-02-02');
		renderCalendar();
		const cornerIco = document.querySelector('.cal-block .cal-lock-ico');
		const cornerBox = cornerIco ? cornerIco.getBoundingClientRect() : null;
		const cs = cornerIco ? getComputedStyle(cornerIco) : null;
		return {
			cornerIconFound: !!cornerIco,
			cornerIsSquareByRect: cornerBox ? Math.abs(cornerBox.width - cornerBox.height) < 0.5 : false,
			cornerIsSquareByComputedStyle: cs ? cs.width === cs.height : false,
			cornerPaddingIsZero: cs ? (cs.paddingLeft === '0px' && cs.paddingTop === '0px') : false
		};
	});

	// =====================================================================
	// SENARYO 7: Admin paneli - "Basin Gorevlisi" isaretleme. Admin KENDINI
	// de isaretleyebilmeli (role secicisinin aksine, burada self-blok YOK).
	// =====================================================================
	const adminPanelTest = await page.evaluate(async () => {
		currentUser = { uid: 'admin1', role: 'admin', firstName: 'Zeynep', lastName: 'Admin', email: 'zadmin@omu.edu.tr' };
		applyPermissions();
		loadAdminUsers();
		await new Promise((r) => setTimeout(r, 60));
		const rows = Array.from(document.querySelectorAll('#adminUserList .admin-user-row'));
		const selfRow = rows.find((r) => r.querySelector('.au-name').textContent.indexOf('Zeynep Admin') !== -1);
		const otherRow = rows.find((r) => r.querySelector('.au-name').textContent.indexOf('Ahmet Editor') !== -1);
		const selfSelectDisabled = selfRow.querySelector('select').disabled === true;
		const selfBasinCb = selfRow.querySelector('.au-basin-toggle input');
		const otherBasinCb = otherRow.querySelector('.au-basin-toggle input');
		const selfCbEnabledAndUnchecked = !selfBasinCb.disabled && selfBasinCb.checked === false;
		const otherCbChecked = otherBasinCb.checked === true;

		window.__writes.length = 0;
		selfBasinCb.click(); // admin KENDINI isaretliyor
		await new Promise((r) => setTimeout(r, 60));
		const selfToggleWrites = window.__writes.slice();

		window.__writes.length = 0;
		otherBasinCb.click(); // baskasinin isaretini kaldiriyor
		await new Promise((r) => setTimeout(r, 60));
		const otherToggleWrites = window.__writes.slice();

		// Yetkisiz cagri: editor rolündeyken dogrudan cagrilirsa hicbir yazma olmamali.
		window.__writes.length = 0;
		const savedRole = currentUser.role;
		currentUser.role = 'editor';
		await toggleUserBasinGorevlisi('ed2', false);
		currentUser.role = savedRole;
		const unauthorizedWriteBlocked = window.__writes.length === 0;

		return {
			selfSelectDisabled,
			selfCbEnabledAndUnchecked,
			otherCbChecked,
			selfToggleWroteRoleFlag: selfToggleWrites.some((w) => w.path === 'users/admin1/basinGorevlisi' && w.op === 'set' && w.value === true),
			selfToggleWroteMirror: selfToggleWrites.some((w) => w.path === 'basinGorevlileri/admin1' && w.op === 'set' && w.value === 'Zeynep Admin'),
			otherToggleWroteRoleFlag: otherToggleWrites.some((w) => w.path === 'users/ed2/basinGorevlisi' && w.op === 'set' && w.value === false),
			otherToggleRemovedMirror: otherToggleWrites.some((w) => w.path === 'basinGorevlileri/ed2' && w.op === 'remove'),
			unauthorizedWriteBlocked
		};
	});

	const combined = { setupResult, multiSelectTest, backwardCompatSingleTest, removeOneTest, lockPreservedOnEditTest, selfDefaultTest, lockSquareTest, adminPanelTest };
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
