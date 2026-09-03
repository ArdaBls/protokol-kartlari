/*
  Veri butunlugu testleri (2026-08-26 denetiminde bulunan UC gercek hata).

  1) CIFT GONDERIM: Kaydetme akislari async; kullanici "Kaydet"e basip yazma BITMEDEN
     tekrar basarsa fonksiyon bastan calisiyor ve yeni-kayit dalinda her cagri KENDI
     push()-ID'sini urettigi icin AYNI kayit IKI KEZ olusuyordu. guardOp() ile kilitlendi.

  2) GECE YARISINI ASAN ETKINLIK: saveEvent() kullaniciya "gece yarısını geçiyor mu?" diye
     sorup onayiyla kaydediyor (orn. 23:00-02:00), ama layoutDay() "en<=s" durumunu
     "bitis girilmemis" ile ayni sayip 1 saatlik gibi ciziyordu -- kullanicinin onayladigi
     bilgi ekranda sessizce kayboluyordu. Artik gun sonuna kadar uzatilir.

  3) YEDEKTEN GERI YUKLEMEDE GOREV GECMISI KAYBI: exportJSON() tum "people" nesnesini
     (gorevGecmisi dahil) yaziyor, ama importJSON() hicbir dalda geri koymuyordu -- yani
     felaket kurtarma yolunda, tam da en cok ihtiyac duyulan anda her kisinin gorev
     gecmisi kaliciyor siliniyordu.
*/
const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');

const TESTS_DIR = __dirname;
const SITE_ROOT = path.join(__dirname, '..', 'docs');
const PORT = 8975;
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
	await page.waitForTimeout(400);

	// Yazmayi yavaslatan yardimci: gercek ag gecikmesini taklit eder, cift-tiklama
	// penceresini test edilebilir hale getirir.
	const slowWrites = () => {
		window.__origRef = database.ref.bind(database);
		database.ref = function (p) {
			const r = window.__origRef(p);
			const origUpdate = r.update ? r.update.bind(r) : null;
			if (origUpdate) r.update = function (v) { return new Promise((res) => setTimeout(res, 150)).then(() => origUpdate(v)); };
			return r;
		};
	};
	const restoreWrites = () => { if (window.__origRef) database.ref = window.__origRef; };

	// --- 1a) Kisi formu cift tiklama ---
	const personDouble = await page.evaluate(async (slowSrc) => {
		currentUser = { role: 'admin', firstName: 'T', lastName: 'K', email: 't@t.com' };
		applyPermissions();
		people = {};
		eval('(' + slowSrc + ')()');
		openAddModal();
		document.getElementById('f_name').value = 'Cift Tiklama Testi';
		document.getElementById('f_title').value = 'Unvan';
		await Promise.all([saveForm(), saveForm()]);
		await new Promise((r) => setTimeout(r, 350));
		return { recordCount: Object.keys(people).length };
	}, slowWrites.toString());

	// --- 1b) Etkinlik formu cift tiklama ---
	const eventDouble = await page.evaluate(async () => {
		calEvents = {};
		openEventModal(null, '2026-01-20');
		document.getElementById('ev_ad').value = 'Cift Etkinlik';
		await Promise.all([saveEvent(), saveEvent()]);
		await new Promise((r) => setTimeout(r, 350));
		return { eventCount: Object.keys(calEvents).length };
	});
	await page.evaluate(restoreWrites);

	// --- 2) Gece yarisini asan etkinlik gun sonuna kadar cizilmeli ---
	const midnight = await page.evaluate(() => {
		// Baslangic BILEREK 22:00: 23:00 secilseydi eski kodun "s+60" sonucu da tam 1440
		// (gece yarisi) olacagi icin test eski/yeni davranisi AYIRT EDEMEZDI.
		// 22:00 -> eski kod 23:00'te bitirir (1380), dogru davranis gun sonudur (1440).
		const crossing = { _id: 'x1', ad: 'Gece Etkinligi', saat: '22:00', bitisSaat: '02:00', tur: 'diger', durum: 'planlandi', tarih: '2026-01-20' };
		const noEnd = { _id: 'x2', ad: 'Bitissiz', saat: '09:00', bitisSaat: '', tur: 'diger', durum: 'planlandi', tarih: '2026-01-20' };
		const laid = layoutDay([crossing, noEnd]);
		const c = laid.find((i) => i.ev._id === 'x1');
		const n = laid.find((i) => i.ev._id === 'x2');
		return {
			crossingStart: c ? c.s : null,
			crossingEnd: c ? c.e : null,      // 1440 (gun sonu) olmali, 1380+60=1440 degil -- 23:00=1380 oldugu icin ayrimi asagida netlestiriyoruz
			crossingDurationMin: c ? c.e - c.s : null,
			noEndDurationMin: n ? n.e - n.s : null // bitis girilmemis -> 60 dk kalmali (regresyon kontrolu)
		};
	});

	// --- 3) Yedekten tam geri yuklemede gorev gecmisi korunmali ---
	const restoreHistory = await page.evaluate(async () => {
		people = {
			pid1: {
				name: 'Gecmisi Olan Kisi', title: 'Rektor', prefix: 'Prof. Dr.', unit: 'Rektorluk',
				status: 'aktif', rank: 1, photo: '', start: '2020-01-01', end: '', note: 'Onemli not',
				gorevGecmisi: [
					{ unvan: 'Dekan', baslangic: '2015-01-01', bitis: '2019-12-31' },
					{ unvan: 'Bolum Baskani', baslangic: '2010-01-01', bitis: '2014-12-31' }
				]
			}
		};
		const exported = JSON.stringify(people, null, 2); // exportJSON() ile ayni icerik
		const origConfirm = window.confirm;
		window.confirm = () => true; // "Tamamen Geri Yukle" + onayi
		importJSON({ target: { files: [new File([exported], 'yedek.json', { type: 'application/json' })], value: '' } });
		await new Promise((r) => setTimeout(r, 900));
		window.confirm = origConfirm;
		const after = Object.values(people)[0] || {};
		return {
			recordCount: Object.keys(people).length,
			historyCount: Array.isArray(after.gorevGecmisi) ? after.gorevGecmisi.length : 0,
			firstUnvan: (after.gorevGecmisi && after.gorevGecmisi[0]) ? after.gorevGecmisi[0].unvan : null,
			firstBaslangic: (after.gorevGecmisi && after.gorevGecmisi[0]) ? after.gorevGecmisi[0].baslangic : null
		};
	});

	const out = { personDouble, eventDouble, midnight, restoreHistory };
	console.log(JSON.stringify(out, null, 2));

	const fails = [];
	if (personDouble.recordCount !== 1) fails.push('Kisi formu cift tiklamada ' + personDouble.recordCount + ' kayit olusturdu (1 olmali)');
	if (eventDouble.eventCount !== 1) fails.push('Etkinlik formu cift tiklamada ' + eventDouble.eventCount + ' kayit olusturdu (1 olmali)');
	if (midnight.crossingEnd !== 1440) fails.push('Gece yarisini asan etkinlik gun sonuna (1440) kadar uzatilmadi: ' + midnight.crossingEnd);
	if (midnight.noEndDurationMin !== 60) fails.push('Bitis saati girilmemis etkinligin varsayilan 60 dk suresi bozuldu: ' + midnight.noEndDurationMin);
	if (restoreHistory.recordCount !== 1) fails.push('Geri yukleme sonrasi kayit sayisi 1 degil: ' + restoreHistory.recordCount);
	if (restoreHistory.historyCount !== 2) fails.push('Geri yuklemede gorev gecmisi kayboldu (beklenen 2, gelen ' + restoreHistory.historyCount + ')');
	if (restoreHistory.firstUnvan !== 'Dekan') fails.push('Gorev gecmisi icerigi bozuldu: ' + restoreHistory.firstUnvan);
	if (restoreHistory.firstBaslangic !== '2015-01-01') fails.push('Gorev gecmisi tarihi bozuldu: ' + restoreHistory.firstBaslangic);

	console.log('PAGE ERRORS:', pageErrors.length);
	pageErrors.forEach((e) => console.log(' -', e));
	const ok = fails.length === 0 && pageErrors.length === 0;
	console.log('ALL_TESTS_PASSED:', ok);
	if (fails.length) console.log('BASARISIZ:', JSON.stringify(fails, null, 2));

	await browser.close();
	server.close();
	process.exitCode = ok ? 0 : 1;
})();
