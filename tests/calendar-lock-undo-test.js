const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');
// --- CI icin: sonuc nesnesindeki TUM boolean yapraklari gez, false olanlari
// (haric-listesi disinda) topla. Sayisal/metin alanlar bilerek atlanir -
// bu dosyalar zaten insan gozüyle okunmak icin JSON basiyor, bu fonksiyon
// sadece "hangi boolean beklenenden farkli" sorusuna otomatik cevap verir.
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
const SITE_ROOT = path.join(__dirname, '..'); // index.html repo kokunde, tests/ altinda degil
const PORT = 8962;
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

	// --- Ortak kurulum: editor olarak "oturum aç", takvimi 2026-01-12 (Pazartesi) haftasında aç ---
	const setupResult = await page.evaluate(() => {
		currentUser = { role: 'editor', firstName: 'Test', lastName: 'Kullanıcı', email: 'test@test.com' };
		applyPermissions();
		calAnchor = parseKey('2026-01-12');
		calView = 'week';
		calEvents = {
			'evLock': { ad: 'Kilit Testi', tur: 'konferans', durum: 'planlandi', tarih: '2026-01-12', saat: '10:00', bitisSaat: '11:00', locked: true, yer: '', birim: '', planlayan: '', gorevli: '', not: '' },
			'evDel2': { ad: 'Silme Testi', tur: 'panel', durum: 'planlandi', tarih: '2026-01-13', saat: '09:00', bitisSaat: '10:00', locked: false, yer: 'Eski Yer', birim: '', planlayan: '', gorevli: '', not: '' },
			'evMove': { ad: 'Tasima Testi', tur: 'calistay', durum: 'planlandi', tarih: '2026-01-12', saat: '14:00', bitisSaat: '15:00', locked: false, yer: '', birim: '', planlayan: '', gorevli: '', not: '' },
			'evEdit': { ad: 'Duzenleme Testi', tur: 'konferans', durum: 'planlandi', tarih: '2026-01-14', saat: '09:00', bitisSaat: '10:00', locked: false, yer: 'Eski Yer', birim: '', planlayan: '', gorevli: '', not: '' },
			'evConc': { ad: 'Eszamanlilik Testi', tur: 'diger', durum: 'planlandi', tarih: '2026-01-15', saat: '11:00', bitisSaat: '12:00', locked: false, yer: 'Baslangic Yer', birim: '', planlayan: '', gorevli: '', not: '' }
		};
		openCalendar();
		return { overlayOpen: document.getElementById('calendarOverlay').classList.contains('open'), canEdit: canEditData() };
	});

	// =====================================================================
	// SENARYO 1: Kilit -> surukleme engelleniyor, ikon DOM'da dogru gorunuyor
	// =====================================================================
	const lockTest = await page.evaluate(() => {
		const lockBlock = document.querySelector('[data-evid="evLock"]');
		const lockIco = lockBlock ? lockBlock.querySelector('.cal-lock-ico') : null;
		const iconLockedClass = lockIco ? lockIco.classList.contains('is-locked') : null;
		// calSortableFilter: kilitli bir etkinlik icin true (surukleme BASLAMAZ) donmeli --
		// SortableJS'in kendi "filter" mekanizmasi, eski calDragStart'taki e.preventDefault() ile ayni is.
		const blockedWhileLocked = calSortableFilter({}, { dataset: { evid: 'evLock' } }) === true;
		return { iconFound: !!lockIco, iconLockedClass, blockedWhileLocked };
	});
	const unlockTest = await page.evaluate(async () => {
		await toggleEventLock('evLock');
		const nowUnlocked = calEvents['evLock'].locked === false;
		const allowedAfterUnlock = calSortableFilter({}, { dataset: { evid: 'evLock' } }) === false;
		// Geri kilitle: hem "kilitlendi" log satirini de uretsin (asagida dogrulanacak) hem de
		// tekrar-kilitlemenin de calisir kaldigini teyit etsin (sadece acmanin degil).
		await toggleEventLock('evLock');
		const relockedOk = calEvents['evLock'].locked === true;
		return { nowUnlocked, allowedAfterUnlock, relockedOk };
	});

	// =====================================================================
	// SENARYO 1c: calSortableOnFilter -- ayni JEST (parmak/mouse KALDIRILMADAN) icinde
	// tekrar tekrar tetiklenirse toast SPAMLANMAMALI (ne kadar UZUN basili tutulursa tutulsun --
	// sabit bir zaman asimina degil GERCEK touchend/mouseup'a bagli), ama AYRI (araya
	// touchend giren) 6. denemede daha israrci bir mesaja gecmeli. evLock bu noktada
	// tekrar KILITLI (unlockTest sonunda relockedOk=true).
	// =====================================================================
	const lockToastTest = await page.evaluate(async () => {
		const fakeEvt = { item: { dataset: { evid: 'evLock' } } };
		function endGesture() { document.dispatchEvent(new Event('mouseup')); }
		// Sayac, GERCEKTEN kac uyari uretildigini olcer. DOM'daki toast SAYISINI saymak artik
		// gecerli bir olcut degil: kilit bildirimleri "cal-lock" etiketli oldugu icin yenisi
		// eskisinin YERINE geciyor, yani ekrandaki adet her zaman <=1 kaliyor.
		calLockGestureEnd(); delete calLock.attempts['evLock'];
		const before = document.querySelectorAll('#toastContainer .toast').length;
		calSortableOnFilter(fakeEvt); // deneme 1
		calSortableOnFilter(fakeEvt); // AYNI jest icinde ANINDA tekrar (parmak hala basili) -- engellenmeli
		await new Promise((r) => setTimeout(r, 900)); // uzun sure basili tutulsa BILE (sabit zaman asimi YOK artik) hala TEK uyari
		calSortableOnFilter(fakeEvt); // hala AYNI jest -- yine engellenmeli
		const warningsAfterSameGesture = calLock.attempts['evLock'];
		endGesture(); // parmak KALKTI -- bir sonraki deneme YENI bir jest sayilmali
		for (let i = 0; i < 4; i++) {
			calSortableOnFilter(fakeEvt); // deneme 2,3,4,5
			endGesture();
		}
		calSortableOnFilter(fakeEvt); // deneme 6 -- esik asilmali
		// AYRI denemelerde bile ekranda EN FAZLA TEK kilit bildirimi kalir -- yeni bildirim,
		// bir oncekinin (hala ekranda olan 4sn'lik) YERINE gecer. Bu artik showToast'un
		// "cal-lock" etiketiyle garanti ediliyor (bkz. CAL_LOCK_TOAST_TAG).
		const toasts = Array.from(document.querySelectorAll('#toastContainer .toast'));
		const lastToast = toasts[toasts.length - 1];
		const lockTagged = document.querySelectorAll('#toastContainer [data-toast-tag="cal-lock"]').length;
		return {
			// AYNI jest icinde ne kadar cok tetiklenirse tetiklensin SADECE TEK uyari uretilmeli.
			sameGestureThrottled: warningsAfterSameGesture === 1,
			atMostOneVisibleAfterSeparateAttempts: (toasts.length - before) <= 1,
			exactlyOneLockTaggedToast: lockTagged === 1,
			escalatedMessageShown: lastToast ? /kilidi aç/i.test(lastToast.textContent) : false
		};
	});

	// =====================================================================
	// SENARYO 1d: Kilit IKONUNA dokunmak asla "kilitli, tasinamaz" uyarisi
	// cikarmamali (kullanici kilidi ACMAYA calisiyor). Ayrica ilgisiz
	// bildirimler kilit degisiminde SILINMEMELI.
	// =====================================================================
	const lockIconBehaviourTest = await page.evaluate(async () => {
		document.querySelectorAll('#toastContainer .toast').forEach((t) => t.remove());
		calLockGestureEnd(); // temiz jest durumu
		// (a) Ikona dokunma: filter true dondurur AMA uyari CIKMAZ.
		const iconTarget = { closest: (sel) => (sel === '.cal-lock-ico' ? {} : null) };
		const filterBlocked = calSortableFilter({ target: iconTarget }, { dataset: { evid: 'evLock' } }) === true;
		calSortableOnFilter({ item: { dataset: { evid: 'evLock' } } });
		const noWarnOnIconTap = document.querySelectorAll('#toastContainer [data-toast-tag="cal-lock"]').length === 0;

		// (b) Govdeden surukleme denemesi: uyari CIKAR.
		calLockGestureEnd();
		calSortableFilter({ target: { closest: () => null } }, { dataset: { evid: 'evLock' } });
		calSortableOnFilter({ item: { dataset: { evid: 'evLock' } } });
		const warnsOnBodyDrag = document.querySelectorAll('#toastContainer [data-toast-tag="cal-lock"]').length === 1;

		// (c) Ilgisiz bir bildirim ekranda dururken kilit degistir -- O bildirim KALMALI,
		//     sadece kilit bildirimi tazelenmeli (eskiden hepsi birden siliniyordu).
		showToast('Alakasız bir bildirim', 'success');
		await toggleEventLock('evLock'); // kilidi ac
		const unrelatedSurvived = Array.from(document.querySelectorAll('#toastContainer .toast'))
			.some((t) => t.textContent === 'Alakasız bir bildirim');
		const lockToastsAfterToggle = document.querySelectorAll('#toastContainer [data-toast-tag="cal-lock"]').length;
		await toggleEventLock('evLock'); // geri kilitle (sonraki senaryolar kilitli bekliyor)
		return {
			filterBlocked, noWarnOnIconTap, warnsOnBodyDrag,
			unrelatedSurvived,
			exactlyOneLockToastAfterToggle: lockToastsAfterToggle === 1,
			attemptCounterResetOnUnlock: !calLock.attempts['evLock']
		};
	});

	// =====================================================================
	// SENARYO 1b: Kilit ikonu CSS - konum (sağ ALT, sağ ÜST değil) ve
	// açık/kapalı durumun renkli halka ile (emoji şekline ek olarak) net ayrılması
	// =====================================================================
	const lockCssTest = await page.evaluate(() => {
		const sheets = Array.from(document.styleSheets);
		let allRules = [];
		sheets.forEach(s => { try { allRules = allRules.concat(Array.from(s.cssRules).map(r => r.cssText || '')); } catch (e) {} });
		const text = allRules.join('\n');
		// NOT: CSSOM cssText, kaynaktan farkli olarak "selector { bildirim: deger; }" seklinde
		// (parantezden once ve iki noktadan sonra bosluklu) normalize edip yeniden yazar; regex'ler
		// bunu tolere etmeli, yoksa gercek kural dogru olsa bile yanlis-negatif verir.
		const baseRuleMatch = text.match(/\.cal-lock-ico\s*\{[^}]*\}/);
		const lockedRuleMatch = text.match(/\.cal-lock-ico\.is-locked\s*\{[^}]*\}/);
		const baseRule = baseRuleMatch ? baseRuleMatch[0] : '';
		const lockedRule = lockedRuleMatch ? lockedRuleMatch[0] : '';
		return {
			isBottomPositioned: /bottom:\s*2px/.test(baseRule),
			isNotTopPositioned: !/(?<!-)top:\s*2px/.test(baseRule),
			// CSSOM #a33 hex'i "rgb(170, 51, 51)" olarak normalize edip geri veriyor.
			lockedStateHasColorRing: /#a33|rgb\(170,\s*51,\s*51\)/.test(lockedRule) && /box-shadow/.test(lockedRule)
		};
	});
	// unlockTest az once evLock'u tekrar kilitledi (relockedOk); DOM'u yeniden ciz ve dogrula.
	const lockIconDomTest = await page.evaluate(() => {
		renderCalendar();
		const lockBlock = document.querySelector('[data-evid="evLock"]');
		const ico = lockBlock ? lockBlock.querySelector('.cal-lock-ico') : null;
		const cs = ico ? getComputedStyle(ico) : null;
		return {
			iconFound: !!ico,
			hasIsLockedClass: ico ? ico.classList.contains('is-locked') : null,
			glyph: ico ? ico.textContent.trim() : null,
			computedPosition: cs ? cs.position : null,
			computedBottom: cs ? cs.bottom : null,
			computedTop: cs ? cs.top : null
		};
	});

	// =====================================================================
	// SENARYO 2: Peek panelde Sil -> onay modali -> executeEventDelete
	// =====================================================================
	const deleteFlowTest = await page.evaluate(async () => {
		openEventPeek('evDel2');
		const peekedOk = calPeekedId === 'evDel2';
		deleteEvent(); // calEditingId bos, calPeekedId dolu -> openEventDeleteConfirm yonlendirmeli
		const modalOpen = document.getElementById('eventDeleteConfirmModalBg').classList.contains('open');
		const targetOk = eventDeleteTargetId === 'evDel2';
		const confirmTextHasName = document.getElementById('eventDeleteConfirmText').textContent.includes('Silme Testi');
		const stackBefore = undoStack.length;
		await executeEventDelete();
		return {
			peekedOk, modalOpen, targetOk, confirmTextHasName,
			deletedFromState: calEvents['evDel2'] === undefined,
			undoPushed: undoStack.length === stackBefore + 1,
			lastType: undoStack[undoStack.length - 1] && undoStack[undoStack.length - 1].type,
			lastBeforeYer: undoStack[undoStack.length - 1] && undoStack[undoStack.length - 1].before && undoStack[undoStack.length - 1].before.yer,
			modalClosedAfter: !document.getElementById('eventDeleteConfirmModalBg').classList.contains('open')
		};
	});

	// =====================================================================
	// SENARYO 3: 4 undo tipi ayri ayri (create, delete-geri-alma, move, edit)
	// =====================================================================
	const createUndoTest = await page.evaluate(async () => {
		openEventModal(null, '2026-01-16');
		document.getElementById('ev_ad').value = 'Olusturma Testi';
		const beforeCount = Object.keys(calEvents).length;
		await saveEvent();
		const afterCreateCount = Object.keys(calEvents).length;
		const lastEntry = undoStack[undoStack.length - 1];
		const newId = lastEntry.id;
		const createdOk = afterCreateCount === beforeCount + 1 && lastEntry.type === 'create' && calEvents[newId] && calEvents[newId].ad === 'Olusturma Testi';
		await undoLastCalendarAction();
		const afterUndoCount = Object.keys(calEvents).length;
		return { createdOk, undoOfCreateRemovedIt: calEvents[newId] === undefined, countRestored: afterUndoCount === beforeCount };
	});

	const deleteUndoTest = await page.evaluate(async () => {
		// SENARYO 2'de 'evDel2' silinmisti; simdi o silmeyi geri aliyoruz (yigindaki son eleman o olmali).
		const entry = undoStack[undoStack.length - 1];
		const isRightEntry = entry.type === 'delete' && entry.id === 'evDel2';
		await undoLastCalendarAction();
		return {
			isRightEntry,
			restoredWithSameKey: !!calEvents['evDel2'],
			restoredYer: calEvents['evDel2'] && calEvents['evDel2'].yer
		};
	});

	const moveUndoTest = await page.evaluate(async () => {
		const before = Object.assign({}, calEvents['evMove']);
		// calMoveEvent: SortableJS onEnd adaptorunun (calOnDragEnd) devrettigi cekirdek fonksiyon,
		// sahte bir Sortable evt'si kurmaya gerek kalmadan dogrudan test edilebilir.
		await calMoveEvent('evMove', '2026-01-16', null);
		const movedOk = calEvents['evMove'].tarih === '2026-01-16';
		const entry = undoStack[undoStack.length - 1];
		const entryOk = entry.type === 'move' && entry.id === 'evMove' && entry.before.tarih === '2026-01-12';
		await undoLastCalendarAction();
		return { movedOk, entryOk, undoneOk: calEvents['evMove'].tarih === before.tarih };
	});

	// =====================================================================
	// SENARYO 3b: calOnDragEnd -- SortableJS'in gercek onEnd sekliyle (evt.item/evt.to/
	// evt.originalEvent) saat-izgarasina birakma, isaretci konumundan saat hesabini dogru yapiyor mu.
	// CAL_HOUR_H=48, rectTop=0, clientY=180 icin beklenen: round((180/48)*60/30)*30 = 240dk = "04:00".
	// =====================================================================
	const timeRecomputeTest = await page.evaluate(async () => {
		calEvents['evMove'] = { ad: 'Saat Testi', tur: 'diger', durum: 'planlandi', tarih: '2026-01-12', saat: '10:00', bitisSaat: '11:00', locked: false, yer: '', birim: '', planlayan: '', gorevli: '', not: '' };
		const fakeEvt = {
			item: { dataset: { evid: 'evMove' } },
			to: { dataset: { date: '2026-01-13' }, classList: { contains: (c) => c === 'cal-daycol' }, getBoundingClientRect: () => ({ top: 0 }) },
			originalEvent: { clientY: 180 }
		};
		calOnDragEnd(fakeEvt);
		// calOnDragEnd async calMoveEvent'i AWAIT ETMEDEN cagirir (Sortable onEnd sync bir callback) -- test de ayni sekilde bekler.
		await new Promise((r) => setTimeout(r, 50));
		return { newTarih: calEvents['evMove'].tarih, newSaat: calEvents['evMove'].saat, newBitis: calEvents['evMove'].bitisSaat };
	});

	const editUndoTest = await page.evaluate(async () => {
		openEventModal('evEdit');
		document.getElementById('ev_yer').value = 'Yeni Yer';
		await saveEvent();
		const editedOk = calEvents['evEdit'].yer === 'Yeni Yer';
		const entry = undoStack[undoStack.length - 1];
		const entryOk = entry.type === 'edit' && entry.before.yer === 'Eski Yer' && entry.after.yer === 'Yeni Yer';
		await undoLastCalendarAction();
		return { editedOk, entryOk, undoneOk: calEvents['evEdit'].yer === 'Eski Yer' };
	});

	// eventQuickStamp da "edit" alt-tipiyle pushUndo cagirmali (ayri enjeksiyon noktasi, hafif kontrol).
	const quickStampUndoTest = await page.evaluate(async () => {
		calEvents['evEdit'].saat = ''; calEvents['evEdit'].bitisSaat = '';
		openEventPeek('evEdit');
		const stackBefore = undoStack.length;
		await eventQuickStamp(); // saat bos oldugu icin "simdi baslat" dalina girer
		const entry = undoStack[undoStack.length - 1];
		return { pushed: undoStack.length === stackBefore + 1, isEdit: entry.type === 'edit', hasSaat: !!calEvents['evEdit'].saat };
	});

	// =====================================================================
	// SENARYO 4: Eszamanlilik kontrolu -> undo entry olusturulduktan SONRA
	// kayit baska biri tarafindan (ör. Firebase listener) degistirilirse iptal.
	// =====================================================================
	const concurrentAbortTest = await page.evaluate(async () => {
		const before = Object.assign({}, calEvents['evConc']);
		await calMoveEvent('evConc', '2026-01-16', null); // undo yigina "move" entry'si eklenir
		const stackBefore = undoStack.length;
		// Baska bir kullanicinin bu arada kaydi degistirdigini simule et:
		calEvents['evConc'] = Object.assign({}, calEvents['evConc'], { yer: 'Baskasi Degistirdi' });
		const toastsBefore = document.querySelectorAll('#toastContainer .toast').length;
		await undoLastCalendarAction();
		const toasts = Array.from(document.querySelectorAll('#toastContainer .toast'));
		const lastToast = toasts[toasts.length - 1];
		return {
			stackConsumed: undoStack.length === stackBefore - 1,
			dataUntouched: calEvents['evConc'].yer === 'Baskasi Degistirdi',
			warnToastShown: toasts.length === toastsBefore + 1,
			toastMentionsChange: lastToast ? lastToast.textContent.includes('değiştirilmiş') : false,
			toastType: lastToast ? lastToast.className : null
		};
	});

	// =====================================================================
	// SENARYO 5: Input/textarea odaktayken Ctrl+Z, undoStack'e dokunmamali
	// =====================================================================
	const inputFocusGuardTest = await page.evaluate(async () => {
		// Zararsiz, tutarli bir "dummy" entry ekleyelim: dinleyici tetiklenirse pop() KESIN yapar,
		// tetiklenmezse stack boyu degismez - dolayli ama kesin bir sinyal.
		undoStack.push({ type: 'edit', id: 'evEdit', before: Object.assign({}, calEvents['evEdit']), after: Object.assign({}, calEvents['evEdit']), ts: 0 });
		const stackBefore = undoStack.length;
		const inp = document.createElement('input');
		inp.type = 'text'; inp.id = '__testFocusInput';
		document.body.appendChild(inp);
		inp.focus();
		const ev = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
		inp.dispatchEvent(ev);
		await new Promise(r => setTimeout(r, 50));
		const stackAfter = undoStack.length;
		inp.remove();
		undoStack.pop(); // test artigini temizle
		return { ignoredWhileFocused: stackAfter === stackBefore };
	});

	// =====================================================================
	// Log icerigi dogrulamasi (reload'dan ONCE - reload __mockPushes'i sifirlar)
	// =====================================================================
	const logTest = await page.evaluate(() => {
		// persistEvent()/executeEventDelete()/undoLastCalendarAction() artik veri+log'u TEK atomik
		// database.ref("/").update({...}) cagrisiyla yaziyor (audit #6) -- log verisi artik ayri bir
		// push(data) DEGIL, update() payload'i icinde "logs/etkinlik/<key>" anahtarinda bulunur
		// (anahtari almak icin yapilan push() ise veri ICERMEZ, sadece key uretir).
		const logs = (window.__mockUpdates || []).reduce((acc, upd) => {
			Object.keys(upd.data || {}).forEach((k) => {
				if (k.indexOf('logs/etkinlik/') === 0 && upd.data[k] && upd.data[k].action) acc.push(upd.data[k].action);
			});
			return acc;
		}, []);
		return {
			totalLogCount: logs.length,
			hasLockLog: logs.some(a => a.includes('kilitlendi')),
			hasUnlockLog: logs.some(a => a.includes('kilidi açıldı')),
			hasUndoSessionMarker1: logs.some(a => a.includes('(Ctrl+Z, oturumda #1)')),
			hasCreateUndoLog: logs.some(a => a.includes('eklenmesi geri alındı')),
			hasDeleteUndoLog: logs.some(a => a.includes('silinmesi geri alındı')),
			hasMoveUndoLog: logs.some(a => a.includes('taşınması geri alındı')),
			hasEditUndoLog: logs.some(a => a.includes('düzenlemesi geri alındı')),
			sampleLogs: logs.slice(0, 6)
		};
	});

	// =====================================================================
	// SENARYO 6: Varsayilan sekme - localStorage'da 'il' kayitliyken bile
	// sayfa yeniden yuklendiginde 'universite' ile acilmali.
	// =====================================================================
	await page.evaluate(() => { localStorage.setItem('omuProtokolListKey', 'il'); });
	await page.reload({ waitUntil: 'load' });
	await page.waitForTimeout(300);
	const defaultTabTest = await page.evaluate(() => {
		return {
			currentListKey,
			storedValueStillIl: localStorage.getItem('omuProtokolListKey') === 'il',
			activeButtonList: document.querySelector('#listSwitch button.active')?.dataset.list,
			ilButtonHasActive: document.querySelector('#listSwitch button[data-list="il"]').classList.contains('active'),
			uniButtonHasActive: document.querySelector('#listSwitch button[data-list="universite"]').classList.contains('active')
		};
	});

	const combined = {
		setupResult, lockTest, unlockTest, lockToastTest, lockIconBehaviourTest, lockCssTest, lockIconDomTest, deleteFlowTest,
		createUndoTest, deleteUndoTest, moveUndoTest, timeRecomputeTest, editUndoTest, quickStampUndoTest,
		concurrentAbortTest, inputFocusGuardTest, logTest, defaultTabTest
	};
	console.log(JSON.stringify(combined, null, 2));
	console.log('PAGE ERRORS:', pageErrors.length);
	pageErrors.forEach(e => console.log(' -', e));

	const __boolFails = collectBooleanFailures(combined, ['defaultTabTest.ilButtonHasActive']);
	// timeRecomputeTest string alanlari dondurdugu icin collectBooleanFailures'a yakalanmaz, elle kontrol edilir.
	const __timeOk = timeRecomputeTest.newTarih === '2026-01-13' && timeRecomputeTest.newSaat === '04:00' && timeRecomputeTest.newBitis === '05:00';
	if (!__timeOk) __boolFails.push('timeRecomputeTest (beklenen tarih=2026-01-13 saat=04:00 bitis=05:00, gelen: ' + JSON.stringify(timeRecomputeTest) + ')');
	const __allPassed = pageErrors.length === 0 && __boolFails.length === 0;
	console.log('ALL_TESTS_PASSED:', __allPassed);
	if (__boolFails.length) console.log('BASARISIZ ALANLAR:', JSON.stringify(__boolFails));

	await browser.close();
	server.close();
	process.exitCode = __allPassed ? 0 : 1;
})();
