const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');
const ROOT = __dirname;
const SITE_ROOT = path.join(__dirname, '..', 'docs'); // index.html repo kokunde, tests/ altinda degil - ROOT sadece mock dosyalari icin
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
	await page.waitForTimeout(300);

	// Gerçek "şu an" saatine göre göreli test etkinlikleri kur (test hangi saatte
	// çalışırsa çalışsın gerçekçi olsun diye sabit bir saat yerine ofset kullanılıyor).
	const result = await page.evaluate(() => {
		// Once gece yarisina yakin calistirilinca flaky'di: hm() ofseti gun sinirini
		// sarabiliyordu ("23:xx"e donebiliyordu) ama etkinligin tarih alani hep sabit
		// "today" kaliyordu -- gercekte var olmayan (tarih,saat) kombinasyonu olusuyordu.
		// Artik Date, o gunun GERCEK tarihinde ama SABIT ogle 12:00 saatine sabitleniyor
		// -- hem bu test hem uygulamanin (calEventTimeState) kendi `new Date()` cagrilari
		// ayni saati gorur, +-120dk'lik ofsetler asla gun sinirini asmaz, test hangi
		// gercek saatte calistirilirsa calistirilsin deterministik olur.
		const OrigDate = Date;
		const _real = new OrigDate();
		const _fixed = new OrigDate(_real.getFullYear(), _real.getMonth(), _real.getDate(), 12, 0, 0, 0);
		class FixedDate extends OrigDate {
			constructor(...args) { if (args.length === 0) { super(_fixed.getTime()); return; } super(...args); }
			static now() { return _fixed.getTime(); }
		}
		window.Date = FixedDate;

		function fmt(d){ return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }
		function hm(mins){ const m=((mins%1440)+1440)%1440; return String(Math.floor(m/60)).padStart(2,"0")+":"+String(m%60).padStart(2,"0"); }
		const now = new Date();
		const nowMin = now.getHours()*60+now.getMinutes();
		const today = fmt(now);
		const tomorrow = fmt(new Date(now.getFullYear(), now.getMonth(), now.getDate()+1));
		const yesterday = fmt(new Date(now.getFullYear(), now.getMonth(), now.getDate()-1));

		currentUser = { role: 'editor', firstName: 'Test', lastName: 'Kullanıcı', email: 'test@test.com' };
		applyPermissions();

		calEvents = {
			'evPast': { ad: 'Biten Çalıştay', tur: 'calistay', durum: 'planlandi', tarih: today, saat: hm(nowMin-60), bitisSaat: hm(nowMin-5), locked:false, yer:'', birim:'', planlayan:'', gorevli:'', not:'' },
			'evNow': { ad: 'Süren Konferans', tur: 'konferans', durum: 'planlandi', tarih: today, saat: hm(nowMin-30), bitisSaat: hm(nowMin+30), locked:false, yer:'', birim:'', planlayan:'', gorevli:'', not:'' },
			'evNowNoEnd': { ad: 'Bitis Saati Girilmemis', tur: 'panel', durum: 'planlandi', tarih: today, saat: hm(nowMin-10), bitisSaat: '', locked:false, yer:'', birim:'', planlayan:'', gorevli:'', not:'' },
			'evFuture': { ad: 'Yaklasan Panel', tur: 'panel', durum: 'planlandi', tarih: today, saat: hm(nowMin+60), bitisSaat: hm(nowMin+120), locked:false, yer:'', birim:'', planlayan:'', gorevli:'', not:'' },
			'evFutureAllDay': { ad: 'Yarinki Tum Gun Etkinlik', tur: 'diger', durum: 'planlandi', tarih: tomorrow, saat: '', bitisSaat: '', locked:false, yer:'', birim:'', planlayan:'', gorevli:'', not:'' },
			'evYesterday': { ad: 'Dun Biten Etkinlik', tur: 'diger', durum: 'planlandi', tarih: yesterday, saat: '10:00', bitisSaat: '11:00', locked:false, yer:'', birim:'', planlayan:'', gorevli:'', not:'' }
		};
		renderCalendarRail();

		const railHtml = document.getElementById('calRailNext').innerHTML;
		const countHtml = document.getElementById('calRailCount').innerHTML;
		const simdiIdx = railHtml.indexOf('Şimdi');
		const siradakiIdx = railHtml.indexOf('Sıradaki');
		const items = Array.from(document.querySelectorAll('#calRailNext .cal-next-item'));
		const firstItemStyles = items.slice(0,2).map(it => it.getAttribute('style'));
		const nowDotCount = document.querySelectorAll('#calRailNext .cal-now-dot').length;

		return {
			nowMin, today, tomorrow, yesterday,
			countHtml,
			hasSimdiHeading: simdiIdx !== -1,
			simdiBeforeSiradaki: simdiIdx !== -1 && siradakiIdx !== -1 && simdiIdx < siradakiIdx,
			pastEventAbsent: !railHtml.includes('Biten Çalıştay'),
			yesterdayEventAbsent: !railHtml.includes('Dun Biten Etkinlik'),
			nowEventPresentBeforeSiradaki: railHtml.indexOf('Süren Konferans') !== -1 && railHtml.indexOf('Süren Konferans') < siradakiIdx,
			nowNoEndPresentBeforeSiradaki: railHtml.indexOf('Bitis Saati Girilmemis') !== -1 && railHtml.indexOf('Bitis Saati Girilmemis') < siradakiIdx,
			futurePresentAfterSiradaki: railHtml.indexOf('Yaklasan Panel') > siradakiIdx,
			futureAllDayPresentAfterSiradaki: railHtml.indexOf('Yarinki Tum Gun Etkinlik') > siradakiIdx,
			nowDotCount,
			itemCount: items.length,
			firstItemStyles,
			railHtmlSample: railHtml.slice(0, 260)
		};
	});

	console.log(JSON.stringify(result, null, 2));
	console.log('PAGE ERRORS:', pageErrors.length);
	if (pageErrors.length) console.log(pageErrors);

	const checks = [
		['hasSimdiHeading', result.hasSimdiHeading === true],
		['simdiBeforeSiradaki', result.simdiBeforeSiradaki === true],
		['pastEventAbsent (bitmis etkinlik hic gorunmemeli)', result.pastEventAbsent === true],
		['yesterdayEventAbsent', result.yesterdayEventAbsent === true],
		['nowEventPresentBeforeSiradaki', result.nowEventPresentBeforeSiradaki === true],
		['nowNoEndPresentBeforeSiradaki (bitis saati yok = suruyor)', result.nowNoEndPresentBeforeSiradaki === true],
		['futurePresentAfterSiradaki', result.futurePresentAfterSiradaki === true],
		['futureAllDayPresentAfterSiradaki (tum gun = ileride)', result.futureAllDayPresentAfterSiradaki === true],
		['nowDotCount===2 (evNow + evNowNoEnd)', result.nowDotCount === 2],
		['itemCount===4 (evPast ve evYesterday haric)', result.itemCount === 4],
		['countHtml contains <b>4</b>', result.countHtml.includes('<b>4</b>')],
		['firstItem of Simdi section has border-top:none', (result.firstItemStyles[0]||'').includes('border-top:none')],
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
