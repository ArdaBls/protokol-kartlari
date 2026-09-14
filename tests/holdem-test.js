// Texas Hold'em (oyun-holdem.html) uçtan uca duman testi -- GERÇEK paylaşımlı
// masa mimarisini (Blackjack/Pişti ile aynı Firebase transaction deseni)
// doğrular: oturma, en az 2 oyuncuyla otomatik el başlatma, kör bahis
// dağıtımı, bir aksiyonun (check) sırayı ilerletmesi, ve el bitiminde net
// kazanç/kaybın site çip cüzdanına yazılması. Eski holdem-ui-test.js, bu
// masanın YEREL/BOT SİMÜLASYONU olduğu döneme aitti -- gerçek çok oyunculu
// mimariye geçilince bu dosyayla değiştirildi.
const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');

const TESTS_DIR = __dirname;
const SITE_ROOT = path.join(__dirname, '..', 'docs');
const PORT = 8992;

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
		window.__mockLiveState = { cipBakiyeleri: { oyuncu1: { bakiye: 2000, sonIslemId: 'seed', islemler: {} } } };
	});

	await page.goto('http://localhost:' + PORT + '/oyun-holdem.html', { waitUntil: 'networkidle' });
	await page.waitForSelector('[data-holdem-masaya-otur]', { timeout: 5000 });
	results.lobiPageErrors = pageErrors.length;

	// 1) Otur -- tek başımayken el başlamamalı (min 2 oyuncu gerekir).
	await page.click('[data-holdem-masaya-otur]');
	await page.waitForTimeout(300);
	results.oturuncaKoltugaGectim = await page.evaluate(() => {
		const masa = window.__mockLiveState.holdem.masalar['ana-masa'];
		return masa.koltuklar.length === 1 && masa.koltuklar[0].uid === 'oyuncu1' && masa.durum === 'lobi';
	});

	// 2) İkinci oyuncuyu DOĞRUDAN masaya ekle (mock'ta sekmeler arası paylaşım
	// yok, gerçek 2. sekme yerine doğrudan yaz) -- watchdog 1sn içinde eli
	// otomatik başlatmalı (min 2 oyuncu şartı artık sağlanıyor).
	await page.evaluate(() => firebase.database().ref('holdem/masalar/ana-masa/koltuklar/1').set({ uid: 'oyuncu2', isim: 'Rakip', bot: false, masaBakiyesi: 1500, bagli: true }));
	await page.waitForTimeout(1500);
	const elBaslangic = await page.evaluate(() => window.__mockLiveState.holdem.masalar['ana-masa']);
	results.elOtomatikBasladi = elBaslangic.durum === 'preflop';
	results.herIkiOyuncuyaIkiserKartDagitildi = elBaslangic.koltuklar.every((k) => Array.isArray(k.kartlar) && k.kartlar.length === 2);
	results.korBahisleriDogruAtildi = elBaslangic.mevcutBahis === elBaslangic.ayarlar.buyukKor;

	// 2b) Sıra bende değilken (ilk oynayan ben olmayabilirim) kontrol alanı
	// tamamen gizli olmalı; sıra bendeyken görünmeli.
	results.siramDegilkenKontrolGizli = elBaslangic.aktifKoltuk !== 0
		? await page.locator('[data-holdem-kontroller]').isHidden()
		: true;

	// 2c) Kalk -- pot'a zaten çip yatırdığım için önce onay istenmeli, onaylayınca
	// "ayrılacak" işaretlenmeli (hemen silmemeli, diğer oyuncunun elini bozmamalı).
	await page.click('[data-holdem-kalk]');
	await page.waitForSelector('.modal-backdrop', { timeout: 3000 });
	await page.click('.modal-backdrop .btn-primary');
	await page.waitForSelector('.modal-backdrop', { state: 'detached', timeout: 3000 });
	await page.waitForTimeout(300);
	results.kalkIsaretlendi = await page.evaluate(() => window.__mockLiveState.holdem.masalar['ana-masa'].koltuklar[0].ayrilacak === true);

	// 3) Deterministik bir preflop durumu kur (kalk işaretini geri al, teste devam) --
	// koltuk 0 (ben) aktif, karşılanacak
	// bahis yok (check edilebilir) -- gerçek kod yolu (holdemAksiyonUygula) hâlâ çalışıyor.
	await page.evaluate(() => {
		const masa = window.__mockLiveState.holdem.masalar['ana-masa'];
		const guncellenmis = Object.assign({}, masa, {
			// Kalk testi bu masayı geçici olarak el_sonucu'na getirip geri
			// aldı -- gerçek oyunda her el elNo'yu artırır, burada da
			// artırıyoruz, aksi halde bir sonraki el_sonucu adımı (4) çip
			// ayarlamasını "zaten bu elNo'yu ayarladım" sanıp atlıyordu.
			durum: 'preflop', sonuclar: null, elNo: (masa.elNo || 0) + 1,
			koltuklar: masa.koltuklar.map((k, i) => Object.assign({}, k, { sokakYatirimi: masa.mevcutBahis, pas: false, allIn: false, ayrilacak: false })),
			aktifKoltuk: 0, bekleyen: [0, 1], aksiyonBitis: Date.now() + 60000
		});
		return firebase.database().ref('holdem/masalar/ana-masa').set(guncellenmis);
	});
	await page.waitForTimeout(200);
	results.checkButonuAktif = await page.evaluate(() => !document.querySelector('[data-holdem-aksiyon="check"]').disabled);
	await page.click('[data-holdem-aksiyon="check"]');
	await page.waitForTimeout(300);
	const checkSonrasi = await page.evaluate(() => window.__mockLiveState.holdem.masalar['ana-masa']);
	results.checkSonrasiSonAksiyonKaydedildi = checkSonrasi.koltuklar[0].sonAksiyon === 'check';
	results.checkSonrasiSiraDigerineGecti = checkSonrasi.aktifKoltuk !== 0;

	// 4) El sonucu deterministik kur (ben kazandım, +300 net) -- watchdog'un
	// çip cüzdanına yazmasını (belkiCuzdanAyarla) doğrula.
	await page.evaluate(() => {
		const masa = window.__mockLiveState.holdem.masalar['ana-masa'];
		// Gerçekten dağıtılan (rastgele) el kartlarıyla ÇAKIŞMAYAN 3 ortak kart
		// seç -- sabit kartlar kullanmak ara sıra oyuncunun gerçek eliyle aynı
		// karta denk gelip holdemElDegerlendir'i "aynı kart iki kez" hatasıyla
		// çökertiyordu (flaky test).
		const elimdeki = new Set(masa.koltuklar.flatMap((k) => k.kartlar.map((kart) => kart.r + kart.s)));
		const takimlar = ['kupa', 'sinek', 'karo', 'maca'];
		const rutbeler = ['as', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'joker', 'kiz', 'papaz'];
		const communityCards = [];
		outer: for (const r of rutbeler) { for (const s of takimlar) { if (!elimdeki.has(r + s)) { communityCards.push({ r, s }); if (communityCards.length === 3) { break outer; } } } }
		const guncellenmis = Object.assign({}, masa, {
			durum: 'el_sonucu', aktifKoltuk: null, aksiyonBitis: null,
			communityCards,
			koltuklar: masa.koltuklar.map((k, i) => Object.assign({}, k, { masaBakiyesi: i === 0 ? 2300 : (k.masaBakiyesi - 300) })),
			sonuclar: { odemeler: [300, 0], potlar: [{ miktar: 300, kazananlar: [0], el: 'pair' }], ts: Date.now() },
			guncellemeTs: Date.now()
		});
		return firebase.database().ref('holdem/masalar/ana-masa').set(guncellenmis);
	});
	await page.waitForTimeout(400);
	results.elSonucuMetniGorunuyor = (await page.locator('[data-holdem-durum]').textContent()).includes('Kazandın');
	results.cuzdanaNetYazildi = await page.evaluate(() => window.__mockLiveState.cipBakiyeleri.oyuncu1.bakiye === 2300);

	// 5) Herkes masadan kalkar (durum HÂLÂ el_sonucu, watchdog'un 4sn'lik
	// bekleme süresi henüz dolmadan) -- kimse oturmadığı için bunu kimse
	// 'lobi'ye çeviremezdi (eski hata); masa boşsa artık herkes çevirebiliyor.
	// Sonra tekrar oturabilmeli.
	await page.click('[data-holdem-kalk]');
	await page.waitForTimeout(200);
	// Koltuk 1'i de çıkar -- gerçek kalk() akışı gibi diziyi KISALTARAK
	// (mock'ta tek bir index'i null'lamak diziyi boşluklu bırakır, gerçek
	// Firebase'in davranışını taklit etmez).
	await page.evaluate(() => {
		const masa = window.__mockLiveState.holdem.masalar['ana-masa'];
		return firebase.database().ref('holdem/masalar/ana-masa').set(Object.assign({}, masa, { koltuklar: masa.koltuklar.filter((k) => k && k.uid !== 'oyuncu2') }));
	});
	await page.waitForTimeout(200);
	results.herkesAyrilinceMasaBosaldi = await page.evaluate(() => !window.__mockLiveState.holdem.masalar['ana-masa'].koltuklar || window.__mockLiveState.holdem.masalar['ana-masa'].koltuklar.length === 0);
	// Watchdog'u zorla tetikle (4sn beklemeden) -- durumu manuel olarak
	// eskitilmiş guncellemeTs ile işaretleyip 1sn'lik interval'ın yakalamasını bekliyoruz.
	await page.evaluate(() => {
		const masa = window.__mockLiveState.holdem.masalar['ana-masa'];
		return firebase.database().ref('holdem/masalar/ana-masa').set(Object.assign({}, masa, { guncellemeTs: Date.now() - 5000 }));
	});
	await page.waitForTimeout(1500);
	results.herkesAyrilincaLobiyeDondu = await page.evaluate(() => window.__mockLiveState.holdem.masalar['ana-masa'].durum === 'lobi');
	results.lobideEskiKartlarTemizlendi = await page.locator('[data-holdem-ortak-kartlar] img').count() === 0;
	await page.click('[data-holdem-masaya-otur]');
	await page.waitForTimeout(300);
	results.tekrarOturabildi = await page.evaluate(() => window.__mockLiveState.holdem.masalar['ana-masa'].koltuklar.some((k) => k && k.uid === 'oyuncu1'));

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
