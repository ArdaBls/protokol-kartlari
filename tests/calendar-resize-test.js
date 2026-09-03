const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');
// --- CI icin: sonuc nesnesindeki TUM boolean yapraklari gez, false olanlari topla ---
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
const PORT = 8963;
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

// Sayfa icinde gercek bir PointerEvent dizisi (down->move->up) uretip .cal-resize-handle
// uzerinde dagitir -- calStartResizeGesture()'in window'a ekledigi pointermove/pointerup
// dinleyicilerini de tetiklemesi icin move/up window'a gonderilir (koddaki gercek davranisla
// birebir ayni, bkz. app.js calStartResizeGesture). pointerId sabit 1 kullanilir: gercek bir
// tarayici oturumunda tek aktif fare pointer'i budur, senkron dispatchEvent (CDP degil) bu
// yuzden setPointerCapture'i sikayet ETMEZ (Playwright'in kendi sayfa-ici JS calistirmasi,
// tarayicinin "aktif pointer" takibini gercek bir donanim olayi gibi kisitlamiyor).
async function dragResizeHandle(page, evid, targetClientY, edge) {
	return page.evaluate(({ evid, targetClientY, edge }) => {
		const block = document.querySelector('[data-evid="' + evid + '"]');
		const sel = edge === 'top' ? '.cal-resize-handle-top' : '.cal-resize-handle:not(.cal-resize-handle-top)';
		const handle = block ? block.querySelector(sel) : null;
		if (!handle) return { started: false };
		const hRect = handle.getBoundingClientRect();
		function fire(type, y, target) {
			const ev = new PointerEvent(type, { bubbles: true, cancelable: true, clientX: hRect.left + 4, clientY: y, pointerId: 1, pointerType: 'mouse' });
			(target || handle).dispatchEvent(ev);
		}
		fire('pointerdown', hRect.top + 2, handle);
		fire('pointermove', targetClientY, window);
		fire('pointerup', targetClientY, window);
		return { started: true };
	}, { evid, targetClientY, edge });
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
	// index.html DEĞİL, doğrudan takvim.html: openCalendar() artık çok-sayfalı mimaride
	// PAGE!=="takvim" ise buildTakvimUrl()'e yönlendiriyor (app.js:3780) -- index.html'den
	// çağrılırsa context navigasyonla yok olur (calendar-lock-undo-test.js'te de AYNI
	// önceden-var-olan sorun gözlemlendi, bu dosyaya özel değil).
	// Pre-paint oturum kapısı (bkz. vite.config.js) localStorage'da Firebase izi
	// arıyor; yoksa sayfa boyanmadan giris.html'e gidiyor. Testte gerçek SDK
	// olmadığı için izi elle bırakıyoruz.
	await page.addInitScript(() => {
		try { window.localStorage.setItem('firebase:authUser:testKey:[DEFAULT]', '{"uid":"testUid"}'); } catch (e) { /* yok say */ }
	});
	await page.goto(`http://localhost:${PORT}/takvim.html`, { waitUntil: 'load' });
	await page.waitForTimeout(300);

	// --- Ortak kurulum: editor olarak "oturum aç", 2026-01-12 (Pazartesi) haftasında hafta görünümü ---
	await page.evaluate(() => {
		currentUser = { role: 'editor', firstName: 'Test', lastName: 'Kullanıcı', email: 'test@test.com' };
		applyPermissions();
		calAnchor = parseKey('2026-01-12');
		calView = 'week';
		calEvents = {
			'evR1': { ad: 'Resize Testi', tur: 'konferans', durum: 'planlandi', tarih: '2026-01-12', saat: '10:00', bitisSaat: '12:00', locked: false, yer: '', birim: '', planlayan: '', gorevli: '', not: '' },
			'evR2': { ad: 'Kilitli Resize Testi', tur: 'panel', durum: 'planlandi', tarih: '2026-01-12', saat: '15:00', bitisSaat: '16:00', locked: true, yer: '', birim: '', planlayan: '', gorevli: '', not: '' }
		};
		// takvim.html kendi PAGE==="takvim" otomatik-acilisiyla openCalendar()'i sayfa
		// yuklenirken (bugunun tarihiyle) ZATEN cagirmis oluyor -- overlay acik oldugu icin
		// openCalendar()'in kendi "zaten acik, no-op" koruma satiri (app.js:3782) burada
		// devreye girer. renderCalendar() dogrudan cagrilarak yeni calAnchor/calEvents ile
		// yeniden cizdiriliyor.
		renderCalendar();
	});
	await page.waitForTimeout(150);

	// =====================================================================
	// SENARYO 1: calSortableFilter -- resize koluna dokunmak SortableJS'in kendi
	// suruklemesini hic baslatmamali (aksi halde 150ms-delay'li Sortable, kolun
	// KENDI pointer jestiyle yarisir -- bkz. app.js calSortableFilter).
	// =====================================================================
	const filterTest = await page.evaluate(() => {
		const handleTarget = { closest: (sel) => (sel === '.cal-resize-handle' ? {} : null) };
		return { blocksSortableDrag: calSortableFilter({ target: handleTarget }, { dataset: { evid: 'evR1' } }) === true };
	});

	// =====================================================================
	// SENARYO 2: Normal surukleme -- kilitsiz etkinlik, alt kenar asagi cekilir,
	// canli onizleme + kaydetme + log etiketi + undo girisi dogru mu.
	// =====================================================================
	const handleRect1 = await page.evaluate(() => document.querySelector('[data-evid="evR1"] .cal-resize-handle:not(.cal-resize-handle-top)').getBoundingClientRect());
	const daycolRect = await page.evaluate(() => document.querySelector('.cal-daycol[data-date="2026-01-12"]').getBoundingClientRect());
	const targetY_13 = daycolRect.top + (13 * 60 / 60) * 48; // 13:00 hedefi (CAL_HOUR_H=48)
	const stackBeforeResize = await page.evaluate(() => undoStack.length);
	await dragResizeHandle(page, 'evR1', targetY_13);
	await page.waitForTimeout(80);
	const resizeTest = await page.evaluate((stackBefore) => {
		const entry = undoStack[undoStack.length - 1];
		return {
			bitisUpdated: calEvents['evR1'].bitisSaat === '13:00',
			startUnchanged: calEvents['evR1'].saat === '10:00',
			undoPushed: undoStack.length === stackBefore + 1,
			entryType: entry ? entry.type : null,
			entryTypeIsResize: entry && entry.type === 'resize',
			entryBeforeBitis: entry && entry.before.bitisSaat === '12:00',
			entryAfterBitis: entry && entry.after.bitisSaat === '13:00'
		};
	}, stackBeforeResize);

	// =====================================================================
	// SENARYO 3: Kilitli etkinlik -- surukleme hic baslamamali, hicbir kayit
	// degismemeli, kilit toast'i cikmali (calLockNotify -> "cal-lock" etiketli).
	// =====================================================================
	await page.evaluate(() => { document.querySelectorAll('#toastContainer .toast').forEach((t) => t.remove()); });
	const handleRect2 = await page.evaluate(() => document.querySelector('[data-evid="evR2"] .cal-resize-handle:not(.cal-resize-handle-top)').getBoundingClientRect());
	const stackBeforeLocked = await page.evaluate(() => undoStack.length);
	await dragResizeHandle(page, 'evR2', handleRect2.top + 80);
	await page.waitForTimeout(80);
	const lockedTest = await page.evaluate((stackBefore) => ({
		bitisUnchanged: calEvents['evR2'].bitisSaat === '16:00',
		undoNotPushed: undoStack.length === stackBefore,
		lockToastShown: document.querySelectorAll('#toastContainer [data-toast-tag="cal-lock"]').length === 1
	}), stackBeforeLocked);

	// =====================================================================
	// SENARYO 4: Gece yarisi kelepcesi -- cok asagi surukleme 23:59'da durmali,
	// TAM 24:00/00:00'a YUVARLANMAMALI (minToHm(1440) gun-basi gibi gorunur).
	// =====================================================================
	const handleRect1b = await page.evaluate(() => document.querySelector('[data-evid="evR1"] .cal-resize-handle:not(.cal-resize-handle-top)').getBoundingClientRect());
	const daycolRect2 = await page.evaluate(() => document.querySelector('.cal-daycol[data-date="2026-01-12"]').getBoundingClientRect());
	const targetY_beyondMidnight = daycolRect2.top + (26 * 60 / 60) * 48; // 26. "saat" -- gunun cok otesi
	await dragResizeHandle(page, 'evR1', targetY_beyondMidnight);
	await page.waitForTimeout(80);
	const midnightClampTest = await page.evaluate(() => ({
		clampedAt2359: calEvents['evR1'].bitisSaat === '23:59'
	}));

	// =====================================================================
	// SENARYO 5: 3px'in altinda hareket -- yanlislikla tiklama sayilir, HICBIR
	// kayit/undo tetiklenmemeli (calStartResizeGesture'daki moved esigi).
	// =====================================================================
	await page.evaluate(() => {
		calEvents['evR1'].bitisSaat = '13:00'; // taninabilir bir baslangic durumuna sifirla
		renderCalendar();
	});
	const handleRect1c = await page.evaluate(() => document.querySelector('[data-evid="evR1"] .cal-resize-handle:not(.cal-resize-handle-top)').getBoundingClientRect());
	const stackBeforeTiny = await page.evaluate(() => undoStack.length);
	await dragResizeHandle(page, 'evR1', handleRect1c.top + 1); // 1px -- esik (3px) altinda
	await page.waitForTimeout(80);
	const tinyMoveTest = await page.evaluate((stackBefore) => ({
		bitisUnchanged: calEvents['evR1'].bitisSaat === '13:00',
		undoNotPushed: undoStack.length === stackBefore
	}), stackBeforeTiny);

	// =====================================================================
	// SENARYO 6: UST kenardan surukleme -- baslangic saati degisir, bitis SABIT kalir.
	// =====================================================================
	await page.evaluate(() => {
		calEvents['evR1'] = { ad: 'Resize Testi', tur: 'konferans', durum: 'planlandi', tarih: '2026-01-12', saat: '10:00', bitisSaat: '13:00', locked: false, yer: '', birim: '', planlayan: '', gorevli: '', not: '' };
		renderCalendar();
	});
	const daycolRect3 = await page.evaluate(() => document.querySelector('.cal-daycol[data-date="2026-01-12"]').getBoundingClientRect());
	const targetY_09 = daycolRect3.top + (9 * 60 / 60) * 48; // 09:00 hedefi -- baslangici 1 saat geriye cek
	const stackBeforeTop = await page.evaluate(() => undoStack.length);
	await dragResizeHandle(page, 'evR1', targetY_09, 'top');
	await page.waitForTimeout(80);
	const topEdgeTest = await page.evaluate((stackBefore) => {
		const entry = undoStack[undoStack.length - 1];
		return {
			startUpdated: calEvents['evR1'].saat === '09:00',
			endUnchanged: calEvents['evR1'].bitisSaat === '13:00',
			undoPushed: undoStack.length === stackBefore + 1,
			entryBeforeSaat: entry && entry.before.saat === '10:00',
			entryAfterSaat: entry && entry.after.saat === '09:00'
		};
	}, stackBeforeTop);

	// =====================================================================
	// SENARYO 7: Silüet -- surukleme SIRASINDA eski konumu gösteren .cal-resize-ghost
	// DOM'da olmalı, bırakınca (pointerup) kaybolmalı.
	// =====================================================================
	const daycolRect4 = await page.evaluate(() => document.querySelector('.cal-daycol[data-date="2026-01-12"]').getBoundingClientRect());
	const ghostDuringDrag = await page.evaluate(({ daycolTop }) => {
		const block = document.querySelector('[data-evid="evR1"]');
		const handle = block.querySelector('.cal-resize-handle:not(.cal-resize-handle-top)');
		const hRect = handle.getBoundingClientRect();
		function fire(type, y, target) {
			const ev = new PointerEvent(type, { bubbles: true, cancelable: true, clientX: hRect.left + 4, clientY: y, pointerId: 1, pointerType: 'mouse' });
			(target || handle).dispatchEvent(ev);
		}
		fire('pointerdown', hRect.top + 2, handle);
		fire('pointermove', daycolTop + (16 * 60 / 60) * 48, window); // suruklerken (henuz birakmadan)
		const ghost = document.querySelector('.cal-resize-ghost');
		const existedDuringDrag = !!ghost;
		const ghostShowsOldTime = ghost ? /13:00/.test(ghost.textContent) : false; // eski bitis 13:00
		const blockOpacityDuringDrag = block.style.opacity;
		fire('pointerup', daycolTop + (16 * 60 / 60) * 48, window);
		const existsAfterDrop = !!document.querySelector('.cal-resize-ghost');
		const blockOpacityAfterDrop = block.style.opacity;
		return { existedDuringDrag, ghostShowsOldTime, existsAfterDrop, blockOpacityDuringDrag, blockOpacityAfterDrop };
	}, { daycolTop: daycolRect4.top });
	await page.waitForTimeout(80);
	const ghostTest = {
		ghostExistsDuringDrag: ghostDuringDrag.existedDuringDrag,
		ghostShowsOldTime: ghostDuringDrag.ghostShowsOldTime,
		ghostRemovedAfterDrop: !ghostDuringDrag.existsAfterDrop,
		// Kullanıcı bildirdi: block opak olduğu için altındaki hayalet görünmüyordu -- sürükleme
		// sırasında block yarı saydam olmalı, bırakınca eski (tam opak) haline dönmeli.
		blockSemiTransparentDuringDrag: blockOpacityDuringDragIsLessThanOne(ghostDuringDrag.blockOpacityDuringDrag),
		blockOpacityRestoredAfterDrop: ghostDuringDrag.blockOpacityAfterDrop === ''
	};
	function blockOpacityDuringDragIsLessThanOne(v) { const n = parseFloat(v); return !isNaN(n) && n < 1; }

	// =====================================================================
	// SENARYO 7b: Taşıma sürüklemesinde de (gün/saat değiştirme, SortableJS) AYNI silüet --
	// calOnDragStart/calOnDragEnd, sahte bir Sortable evt'siyle (calendar-lock-undo-test.js'teki
	// timeRecomputeTest ile AYNI desen -- gerçek bir Sortable örneği kurmaya gerek yok).
	// =====================================================================
	const moveGhostTest = await page.evaluate(() => {
		const block = document.querySelector('[data-evid="evR1"]');
		const daycol = document.querySelector('.cal-daycol[data-date="2026-01-12"]');
		const fakeStartEvt = { item: block, from: daycol, originalEvent: { clientY: 300 } };
		calOnDragStart(fakeStartEvt);
		const ghost = document.querySelector('.cal-resize-ghost');
		const existedDuringDrag = !!ghost;
		const blockOpacityDuringDrag = block.style.opacity;
		const fakeEndEvt = { item: block, to: daycol, from: daycol, originalEvent: { clientY: 300 } };
		calOnDragEnd(fakeEndEvt);
		const existsAfterDrop = !!document.querySelector('.cal-resize-ghost');
		const blockOpacityAfterDrop = block.style.opacity;
		return { existedDuringDrag, existsAfterDrop, blockOpacityDuringDrag, blockOpacityAfterDrop };
	});
	const moveGhostTestResult = {
		ghostExistsDuringMoveDrag: moveGhostTest.existedDuringDrag,
		ghostRemovedAfterMoveDrop: !moveGhostTest.existsAfterDrop,
		blockSemiTransparentDuringMoveDrag: (function () { const n = parseFloat(moveGhostTest.blockOpacityDuringDrag); return !isNaN(n) && n < 1; })(),
		blockOpacityRestoredAfterMoveDrop: moveGhostTest.blockOpacityAfterDrop === ''
	};

	// =====================================================================
	// SENARYO 8: CSS -- resize kolu .cal-block sinirinin ICINDE (negatif inset
	// YOK, .cal-lock-ico'daki inset-clipping hatasinin ayni sinifina dusmemek
	// icin), pointer:coarse'da buyuyor, cross-preview'da gizleniyor.
	// =====================================================================
	const cssTest = await page.evaluate(() => {
		const sheets = Array.from(document.styleSheets);
		let allRules = [];
		sheets.forEach((s) => { try { allRules = allRules.concat(Array.from(s.cssRules).map((r) => r.cssText || '')); } catch (e) {} });
		const text = allRules.join('\n');
		const baseRuleMatch = text.match(/\.cal-resize-handle\s*\{[^}]*\}/);
		const baseRule = baseRuleMatch ? baseRuleMatch[0] : '';
		return {
			noNegativeInset: !/inset:\s*-/.test(baseRule),
			hasCrossPreviewHideRule: /\.cal-block\.cal-block-cross-preview\s+\.cal-resize-handle\s*\{[^}]*display:\s*none/.test(text),
			hasCoarsePointerRule: /pointer:\s*coarse[^{]*\{[^}]*\.cal-resize-handle/.test(text.replace(/\n/g, ' ')) || /\.cal-resize-handle\s*\{\s*height:\s*14px/.test(text)
		};
	});

	// =====================================================================
	// Log icerigi dogrulamasi
	// =====================================================================
	const logTest = await page.evaluate(() => {
		const logs = (window.__mockUpdates || []).reduce((acc, upd) => {
			Object.keys(upd.data || {}).forEach((k) => {
				if (k.indexOf('logs/etkinlik/') === 0 && upd.data[k] && upd.data[k].action) acc.push(upd.data[k].action);
			});
			return acc;
		}, []);
		return {
			hasResizeLog: logs.some((a) => a.includes('süresi ayarlandı')),
			hasBitisFieldChange: logs.some((a) => /Bitiş.*12:00.*13:00/.test(a))
		};
	});

	const combined = { filterTest, resizeTest, lockedTest, midnightClampTest, tinyMoveTest, topEdgeTest, ghostTest, moveGhostTestResult, cssTest, logTest };
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
