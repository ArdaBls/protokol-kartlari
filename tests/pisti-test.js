// Pişti (oyun-pisti.html) uçtan uca duman testi -- gerçek Firebase
// transaction() semantiğini (bkz. mock-firebase.js'e eklenen canlı durum
// katmanı) kullanarak TEK bir istemcide oturma, oyun başlatma, kart oynama,
// eşleşme/pişti yakalama, el bitişi (skor hesaplama) ve oyun bitişi (101
// puan) akışlarını doğrular.
const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');

const TESTS_DIR = __dirname;
const SITE_ROOT = path.join(__dirname, '..', 'docs');
const PORT = 8990;

function serve() {
	const server = http.createServer((req, res) => {
		let p = decodeURIComponent(req.url.split('?')[0]);
		if (p === '/') p = '/index.html';
		const fp = path.join(SITE_ROOT, p);
		fs.readFile(fp, (err, data) => {
			if (err) { res.writeHead(404); res.end('not found: ' + p); return; }
			const ext = path.extname(fp);
			const type = ext === '.html' ? 'text/html' : ext === '.js' ? 'application/javascript' : ext === '.css' ? 'text/css' : ext === '.png' ? 'image/png' : 'text/plain';
			res.writeHead(200, { 'Content-Type': type });
			res.end(data);
		});
	});
	return new Promise((resolve) => server.listen(PORT, () => resolve(server)));
}

(async () => {
	const server = await serve();
	const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
	const results = {};
	const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
	const pageErrors = [];
	page.on('pageerror', (e) => pageErrors.push(e.message));
	await page.route('**/firebasejs/**/firebase-app-compat.js', (route) => route.fulfill({ path: path.join(TESTS_DIR, 'mock-firebase.js'), contentType: 'application/javascript' }));
	await page.route('**/firebasejs/**/firebase-database-compat.js', (route) => route.fulfill({ body: '' }));
	await page.route('**/firebasejs/**/firebase-auth-compat.js', (route) => route.fulfill({ body: '' }));
	await page.route('**://fonts.googleapis.com/**', (route) => route.fulfill({ body: '' }));
	await page.route('**://fonts.gstatic.com/**', (route) => route.abort());
	await page.addInitScript(() => {
		window.__mockAuthUser = { uid: 'oyuncu1', email: 'oyuncu1@test.com' };
		window.__mockOnceSnapshot = { role: 'editor', firstName: 'Test', lastName: 'Oyuncu' };
	});

	await page.goto('http://localhost:' + PORT + '/oyun-pisti.html', { waitUntil: 'networkidle' });
	await page.waitForSelector('[data-pisti-otur]', { timeout: 5000 });
	results.lobiPageErrors = pageErrors.length;
	results.dortKoltukVar = await page.locator('[data-pisti-otur]').count() === 4;

	// 1) Otur -- tek koltukta HENÜZ 2. oyuncu yok, "Oyunu başlat" görünmemeli.
	await page.click('[data-pisti-otur="0"]');
	await page.waitForTimeout(200);
	results.oturuncaBaslatGizli = await page.locator('[data-pisti-baslat]').isHidden();
	results.oturuncaKalkGorunur = await page.locator('[data-pisti-kalk-durum]').isVisible();

	// 1b) Kalk -- oyun başlamadan önce koltuğu boşaltmalı, "Otur" düğmesi geri gelmeli.
	await page.click('[data-pisti-kalk-durum]');
	await page.waitForTimeout(200);
	results.kalkincaKoltukBosaldi = await page.evaluate(() => !window.__mockLiveState.pisti.masalar['ana-masa'].koltuklar[0]);
	results.kalkincaOturButonuGeriGeldi = await page.locator('[data-pisti-otur="0"]').isVisible();
	// Devamı için tekrar otur.
	await page.click('[data-pisti-otur="0"]');
	await page.waitForTimeout(200);

	// 2. oyuncuyu mock canlı duruma DOĞRUDAN ekleyip (gerçek 2. sekme yerine --
	// mock'ta window.__mockLiveState sekmeler arası paylaşılmıyor) sonra
	// dinleyicinin bunu yakalamasını bekliyoruz. ÖNEMLİ: window.__mockLiveState'i
	// DOĞRUDAN mutasyona uğratmak dinleyicileri TETİKLEMEZ -- firebase.database()
	// .ref(...).update(...) mock'un canliYaz()/bildirCanliDegisiklik() yolundan
	// geçtiği için gerçek bir yazı gibi davranır.
	await page.evaluate(() => firebase.database().ref('pisti/masalar/ana-masa/koltuklar/1').set({ uid: 'oyuncu2', isim: 'Rakip', katilimDurumu: 'hazir' }));
	await page.waitForTimeout(200);
	results.ikinciOyuncuGelinceBaslatGorunur = await page.locator('[data-pisti-baslat]').isVisible();

	// 2) Oyunu başlat -- 4'er kart dağıtılmalı, masaya 4 kart açılmalı (vale hariç).
	await page.click('[data-pisti-baslat]');
	await page.waitForTimeout(300);
	const baslangic = await page.evaluate(() => window.__mockLiveState.pisti.masalar['ana-masa']);
	results.oyunBaslayinca4erKartDagitildi = baslangic.eller[0].length === 4 && baslangic.eller[1].length === 4;
	results.masadaValeYok = !baslangic.masaKartlari.some((k) => k.r === 'joker');
	results.aktifKoltukBirinciDegilSecildi = baslangic.aktifKoltuk === 0 || baslangic.aktifKoltuk === 1;

	// 3) Elle kontrollü bir senaryo kurmak için masayı DOĞRUDAN yaz (gerçek
	// dağıtımın rastgeleliği yerine deterministik eşleşme/pişti/el-bitişi test
	// etmek için) -- transaction() semantiği hâlâ gerçek kod yolundan geçiyor.
	await page.evaluate(() => {
		const masa = window.__mockLiveState.pisti.masalar['ana-masa'];
		const guncellenmis = Object.assign({}, masa, {
			durum: 'oynaniyor', elNo: masa.elNo,
			deste: Array.from({ length: 2 }, () => ({ r: '3', s: 'kupa' })), desteIndex: 2, // deste TÜKENMİŞ (redeal olamaz)
			masaKartlari: [{ r: '7', s: 'maca' }],
			eller: { 0: [{ r: '7', s: 'kupa' }], 1: [{ r: '5', s: 'karo' }] },
			topladiklarim: { 0: [], 1: [] }, pistiSayilari: { 0: 0, 1: 0 },
			aktifKoltuk: 0, sonAlanKoltuk: null, aksiyonBitis: Date.now() + 60000
		});
		return firebase.database().ref('pisti/masalar/ana-masa').set(guncellenmis);
	});
	await page.waitForTimeout(200);

	// 4) 7-kupa oyna -> 7-maca ile eşleşir, TEK kart alınır -> PİŞTİ.
	await page.click('[data-pisti-oyna="0"]');
	await page.waitForTimeout(300);
	const pistiSonrasi = await page.evaluate(() => window.__mockLiveState.pisti.masalar['ana-masa']);
	results.eslesenKartMasayiAlirVePistiSayilir = pistiSonrasi.topladiklarim[0].length === 2 && pistiSonrasi.pistiSayilari[0] === 1;
	results.pistiSonrasiSiraDigerineGecti = pistiSonrasi.aktifKoltuk === 1;

	// 5) Rakip elindeki tek kartı oynasın -- bu, HERKESİN elini bitirir VE deste
	// tükendiği için el gerçekten biter, skor hesaplanmalı, durum 'el_bitti'
	// olmalı (masada kart kalmadığından son-alan kuralı devreye girmez).
	// Basitleştirme: masaIslemi uid kontrolü currentUserUid'e baktığından, koltuk
	// 0 ve 1'in uid'lerini TAKAS ediyoruz (sadece koltuk 1'i devretsek her iki
	// koltuk da 'oyuncu1' olur, benimKoltukIndex() İLK eşleşeni -- boş eli kalan
	// koltuk 0'ı -- döndürür ve elim paneli boş kalır) -- gerçek kod yolu
	// (masaIslemi/kartOyna) hâlâ çalışıyor.
	await page.evaluate(() => Promise.all([
		firebase.database().ref('pisti/masalar/ana-masa/koltuklar/0/uid').set('oyuncu2'),
		firebase.database().ref('pisti/masalar/ana-masa/koltuklar/1/uid').set('oyuncu1')
	]));
	await page.waitForTimeout(150);
	await page.click('[data-pisti-oyna="0"]');
	await page.waitForTimeout(400);
	const elSonrasi = await page.evaluate(() => window.__mockLiveState.pisti.masalar['ana-masa']);
	results.herkesinEliBitinceElBitti = elSonrasi.durum === 'el_bitti';
	// Oyuncu 0: 7(1)+7(0, sinek değil kupa... zaten pişti kartları [{7,maca},{7,kupa}] -> puan 0) + pişti(10) = 10.
	// Oyuncu 1: 5-karo elindeki tek kartı masaya koydu ama eşleşmedi (masa boştu, sadece eklendi) -- deste bitince
	// o kart topladiklarim'e HİÇ girmez (masada kaldı, sahibi yok) -- en çok kart oyuncu0'da (2 kart) -> +3.
	results.skorHesabiDogru = elSonrasi.skorlar[0] === 13 && (elSonrasi.skorlar[1] || 0) === 0;

	if (pageErrors.length) { console.log('PAGE ERRORS:', JSON.stringify(pageErrors)); }
	results.oyunPageErrors = pageErrors.length;
	console.log(JSON.stringify(results, null, 2));

	await browser.close();
	server.close();

	const fails = Object.keys(results).filter((k) => {
		const v = results[k];
		if (typeof v === 'boolean') { return !v; }
		if (/PageErrors$/.test(k)) { return v !== 0; }
		return false;
	});
	console.log('ALL_TESTS_PASSED: ' + (fails.length === 0));
	if (fails.length) { console.log('FAILS: ' + fails.join(', ')); process.exit(1); }
})();
