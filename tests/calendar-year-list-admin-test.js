const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');
const ROOT = __dirname;
const SITE_ROOT = path.join(__dirname, '..', 'docs'); // index.html repo kokunde, tests/ altinda degil - ROOT sadece mock dosyalari icin
const PORT = 8967;

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
	await page.route('**/firebasejs/**/firebase-app-compat.js', (route) => route.fulfill({ path: path.join(ROOT, 'mock-firebase.js'), contentType: 'application/javascript' }));
	await page.route('**/firebasejs/**/firebase-database-compat.js', (route) => route.fulfill({ body: '' }));
	await page.route('**/firebasejs/**/firebase-auth-compat.js', (route) => route.fulfill({ body: '' }));
	await page.route('**Sortable.min.js', (route) => route.fulfill({ path: path.join(ROOT, 'mock-sortable.js') }));
	await page.route('**://fonts.googleapis.com/**', (route) => route.fulfill({ body: '' }));
	await page.route('**://fonts.gstatic.com/**', (route) => route.abort());
	await page.goto(`http://localhost:${PORT}/protokol.html`, { waitUntil: 'load' });
	await page.waitForTimeout(300);

	// --- Ortak kurulum: editor olarak oturum ac, takvimi ac, sabit bir tarih etrafinda
	// (2026-03-15) haftaya/aya/yila gore ayrisan etkinlikler kur. Tarihler uygulamanin
	// KENDI startOfWeek/addDays yardimcilariyla hesaplaniyor, elle hafta matematigi yok.
	const setup = await page.evaluate(() => {
		currentUser = { role: 'editor', firstName: 'Test', lastName: 'Kullanıcı', email: 'test@test.com' };
		applyPermissions();
		const anchor = parseKey('2026-03-15');
		const weekStart = startOfWeek(anchor);
		const inWeek1 = dKey(addDays(weekStart, 1));
		const inWeek2 = dKey(addDays(weekStart, 3));
		const nextWeekSameMonth = dKey(addDays(weekStart, 9));
		const nextMonth = dKey(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 5));
		const prevYear = dKey(new Date(anchor.getFullYear() - 1, anchor.getMonth(), 15));
		const emptyDay = dKey(new Date(anchor.getFullYear(), anchor.getMonth(), 2));
		calEvents = {
			'evA': { ad: 'Hafta1', tur: 'konferans', durum: 'planlandi', tarih: inWeek1, saat: '', bitisSaat: '', locked: false, yer: '', birim: '', planlayan: '', gorevli: '', not: '' },
			'evB': { ad: 'Hafta2', tur: 'konferans', durum: 'planlandi', tarih: inWeek2, saat: '', bitisSaat: '', locked: false, yer: '', birim: '', planlayan: '', gorevli: '', not: '' },
			'evC': { ad: 'AynıAyBaşkaHafta', tur: 'konferans', durum: 'planlandi', tarih: nextWeekSameMonth, saat: '', bitisSaat: '', locked: false, yer: '', birim: '', planlayan: '', gorevli: '', not: '' },
			'evD': { ad: 'BaşkaAy', tur: 'panel', durum: 'planlandi', tarih: nextMonth, saat: '', bitisSaat: '', locked: false, yer: '', birim: '', planlayan: '', gorevli: '', not: '' },
			'evE': { ad: 'GeçenYıl', tur: 'panel', durum: 'planlandi', tarih: prevYear, saat: '', bitisSaat: '', locked: false, yer: '', birim: '', planlayan: '', gorevli: '', not: '' }
		};
		calAnchor = anchor;
		return { inWeek1, inWeek2, nextWeekSameMonth, nextMonth, prevYear, emptyDay, anchorYear: anchor.getFullYear(), anchorMonth: anchor.getMonth() };
	});

	function legendCount(html, label) {
		const m = html.match(new RegExp('>' + label + '<[\\s\\S]*?cal-legend-count">(\\d+)<'));
		return m ? Number(m[1]) : null;
	}

	// =====================================================================
	// SENARYO 1: Legend sayaçları görünüme göre değişiyor (gün/hafta/ay/yıl)
	// =====================================================================
	const legendTest = await page.evaluate((d) => { calAnchor = parseKey(d.inWeek1); calView = 'day'; renderCalendar(); return true; }, setup);
	const dayLegend = await page.evaluate(() => document.getElementById('calTypeLegend').innerHTML);
	const weekLegendRaw = await page.evaluate(() => { calView = 'week'; renderCalendar(); return document.getElementById('calTypeLegend').innerHTML; });
	const monthLegendRaw = await page.evaluate(() => { calView = 'month'; renderCalendar(); return document.getElementById('calTypeLegend').innerHTML; });
	const yearLegendRaw = await page.evaluate(() => { calView = 'year'; renderCalendar(); return document.getElementById('calTypeLegend').innerHTML; });

	const dayKonferans = legendCount(dayLegend, 'Konferans');
	const weekKonferans = legendCount(weekLegendRaw, 'Konferans');
	const monthKonferans = legendCount(monthLegendRaw, 'Konferans');
	const yearKonferans = legendCount(yearLegendRaw, 'Konferans');
	const yearPanel = legendCount(yearLegendRaw, 'Panel');
	const monthPanel = legendCount(monthLegendRaw, 'Panel');
	const weekPanel = legendCount(weekLegendRaw, 'Panel');

	// =====================================================================
	// SENARYO 2: Yıl görünümü - 12 ay bloğu, renkli nokta, gün/ay tıklama, calShift
	// =====================================================================
	const yearViewTest = await page.evaluate((d) => {
		calAnchor = parseKey('2026-03-15');
		calSetView('year');
		const monthBlocks = document.querySelectorAll('.cal-year-month').length;
		const monthTitles = Array.from(document.querySelectorAll('.cal-year-month-title')).map(function(b){ return b.textContent; });
		const dotDay = document.querySelector('.cal-year-day[onclick*="' + d.inWeek1 + '"]');
		const hasDotOnEventDay = !!(dotDay && dotDay.querySelector('.cal-year-dot'));
		const emptyDayBtn = document.querySelector('.cal-year-day[onclick*="' + d.emptyDay + '"]');
		const hasDotOnEmptyDay = !!(emptyDayBtn && emptyDayBtn.querySelector('.cal-year-dot'));
		const topbarLabel = document.getElementById('calMonthLabel').innerHTML;
		// güne tıklama -> gün görünümüne gider
		dotDay.click();
		const afterDayClick = { view: calView, anchor: dKey(calAnchor) };
		// ay görünümüne dön, ay başlığına tıklama -> ay görünümüne gider
		calAnchor = parseKey('2026-03-15'); calSetView('year');
		const marchTitle = document.querySelector('.cal-year-month-title[onclick*="calGoToMonth(2026,2)"]');
		marchTitle.click();
		const afterMonthTitleClick = { view: calView, anchorYear: calAnchor.getFullYear(), anchorMonth: calAnchor.getMonth() };
		// calShift yıl görünümünde 1 yıl kaydırmalı
		calAnchor = parseKey('2026-03-15'); calSetView('year');
		calShift(1);
		const afterShift = { view: calView, year: calAnchor.getFullYear(), month: calAnchor.getMonth(), day: calAnchor.getDate() };
		return { monthBlocks, monthTitles, hasDotOnEventDay, hasDotOnEmptyDay, topbarLabel, afterDayClick, afterMonthTitleClick, afterShift };
	}, setup);

	// =====================================================================
	// SENARYO 3: Liste görünümü - başlık/durum çakışması düzeldi, durum
	// etiketi peek panel boyutunda
	// =====================================================================
	const listCssTest = await page.evaluate(() => {
		calEvents = { 'evList': { ad: 'Liste Testi Etkinliği', tur: 'konferans', durum: 'yayinlandi', tarih: dKey(addDays(todayDate(), 1)), saat: '10:00', bitisSaat: '', locked: false, yer: '', birim: '', planlayan: '', gorevli: '', not: '' } };
		calSetView('list');
		const nameEl = document.querySelector('.cal-ev-name');
		const metaEl = document.querySelector('.cal-ev-meta');
		const nameRect = nameEl.getBoundingClientRect();
		const metaRect = metaEl.getBoundingClientRect();
		const nameDisplay = getComputedStyle(nameEl).display;
		const metaDisplay = getComputedStyle(metaEl).display;
		const tagEl = document.querySelector('.cal-ev-meta .cal-tag');
		const tagFontSize = getComputedStyle(tagEl).fontSize;
		return {
			nameDisplay, metaDisplay,
			noOverlap: metaRect.top >= (nameRect.bottom - 1), // 1px tolerans
			nameBottom: nameRect.bottom, metaTop: metaRect.top,
			tagFontSize
		};
	});

	// =====================================================================
	// SENARYO 4: Admin düzenleme kalemi - sadece admin görür, tıklayınca
	// openEventModal açılır, openEventPeek TETİKLENMEZ (event.stopPropagation)
	// =====================================================================
	const editorPencilTest = await page.evaluate(() => {
		currentUser = { role: 'editor', firstName: 'Ed', lastName: 'Itor', email: 'ed@test.com' };
		applyPermissions();
		calSetView('list');
		return { pencilVisible: !!document.querySelector('.cal-ev-edit-ico') };
	});
	const adminPencilTest = await page.evaluate(() => {
		currentUser = { role: 'admin', firstName: 'Ad', lastName: 'Min', email: 'admin@test.com' };
		applyPermissions();
		calSetView('list');
		const ico = document.querySelector('.cal-ev-edit-ico');
		const opacity = ico ? getComputedStyle(ico).opacity : null;
		let peekCalls = 0;
		const origPeek = window.openEventPeek;
		window.openEventPeek = function () { peekCalls++; return origPeek.apply(this, arguments); };
		ico.click();
		window.openEventPeek = origPeek;
		return {
			pencilVisible: !!ico,
			opacityIsPartial: opacity !== null && Number(opacity) > 0 && Number(opacity) < 1,
			peekCalls,
			calEditingId,
			modalOpen: document.getElementById('eventModalBg').classList.contains('open')
		};
	});

	console.log(JSON.stringify({ dayKonferans, weekKonferans, monthKonferans, yearKonferans, yearPanel, monthPanel, weekPanel, yearViewTest, listCssTest, editorPencilTest, adminPencilTest }, null, 2));
	console.log('PAGE ERRORS:', pageErrors.length);
	if (pageErrors.length) console.log(pageErrors);

	const checks = [
		['dayKonferans===1 (gün: sadece evA)', dayKonferans === 1],
		['weekKonferans===2 (hafta: evA+evB, evC haric)', weekKonferans === 2],
		['monthKonferans===3 (ay: evA+evB+evC)', monthKonferans === 3],
		['yearKonferans===3 (yıl: evA+evB+evC, evD panel, evE geçen yıl)', yearKonferans === 3],
		['weekPanel===0', weekPanel === 0],
		['monthPanel===0 (evD başka ayda)', monthPanel === 0],
		['yearPanel===1 (evD; evE geçen yıl hariç)', yearPanel === 1],
		['yıl görünümü 12 ay bloğu', yearViewTest.monthBlocks === 12],
		['yıl görünümü ay başlıkları Ocak..Aralık', yearViewTest.monthTitles.length === 12 && yearViewTest.monthTitles[0] === 'Ocak' && yearViewTest.monthTitles[11] === 'Aralık'],
		['etkinlik olan günde renkli nokta var', yearViewTest.hasDotOnEventDay === true],
		['etkinlik olmayan günde nokta yok', yearViewTest.hasDotOnEmptyDay === false],
		['üst başlıkta sadece yıl (2026)', yearViewTest.topbarLabel === '2026'],
		['güne tıklama -> gün görünümüne gider', yearViewTest.afterDayClick.view === 'day' && yearViewTest.afterDayClick.anchor === setup.inWeek1],
		['ay başlığına tıklama -> ay görünümüne gider (Mart)', yearViewTest.afterMonthTitleClick.view === 'month' && yearViewTest.afterMonthTitleClick.anchorYear === 2026 && yearViewTest.afterMonthTitleClick.anchorMonth === 2],
		['calShift(1) yıl görünümünde 1 yıl ileri alır', yearViewTest.afterShift.view === 'year' && yearViewTest.afterShift.year === 2027 && yearViewTest.afterShift.month === 2 && yearViewTest.afterShift.day === 15],
		['.cal-ev-name display:block', listCssTest.nameDisplay === 'block'],
		['.cal-ev-meta display:block', listCssTest.metaDisplay === 'block'],
		['başlık ve durum çakışmıyor (alt alta)', listCssTest.noOverlap === true],
		['durum etiketi peek panel boyutunda (13px)', listCssTest.tagFontSize === '13px'],
		['editör listede kalem GÖRMEZ', editorPencilTest.pencilVisible === false],
		['admin listede kalem GÖRÜR', adminPencilTest.pencilVisible === true],
		['kalem varsayılan kısmi opak (her zaman keşfedilebilir)', adminPencilTest.opacityIsPartial === true],
		['kaleme tıklama openEventPeek TETİKLEMEZ (stopPropagation çalışıyor)', adminPencilTest.peekCalls === 0],
		['kaleme tıklama doğru etkinliği düzenlemeye açar', adminPencilTest.calEditingId === 'evList'],
		['kaleme tıklama düzenleme modalını açar', adminPencilTest.modalOpen === true],
		['no pageerrors', pageErrors.length === 0]
	];
	let allOk = true;
	for (const [label, ok] of checks) {
		console.log((ok ? 'OK  ' : 'FAIL') + ' - ' + label);
		if (!ok) allOk = false;
	}

	await browser.close();
	server.close();
	process.exit(allOk ? 0 : 1);
})();
