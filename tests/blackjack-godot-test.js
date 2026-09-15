// Blackjack (oyun-blackjack.html, ?godot=1) uçtan uca duman testi -- gerçek
// Firebase transaction() semantiğini (bkz. mock-firebase.js) kullanarak
// oturma, bahis, dağıtım, kart çekme (battı/batmadı), katlama, bölme ve
// krupiyerin kapalı kart mekaniğini doğrular.
//
// Pişti'nin tests/pisti-test.js'inde kurulan AYNI desen: sayfada DOM/HTML
// masa değil SADECE Godot (iframe + postMessage köprüsü) var, bu yüzden
// testler iframe'in (frame.html) KENDİ bağlamından gerçek postMessage
// mesajları gönderiyor (Godot'un window.bjXxx(...) fonksiyonlarının TAM
// OLARAK yaptığı şey) -- gerçek kod yolu (masaIslemi/bakiyeGuncelle/
// transaction) hâlâ çalışıyor. Godot motoru bu ortamda yüklenmese bile
// frame.html'in postMessage köprüsü motor yüklenmeden ÖNCE tanımlanıyor.
const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');

const TESTS_DIR = __dirname;
const SITE_ROOT = path.join(__dirname, '..', 'docs');
const PORT = 8992;
const MASA_YOLU = 'oyunBasarimlari/blackjack/masalar/ana-masa';
const CUZDAN_YOLU = 'cipBakiyeleri/oyuncu1';

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

	await page.goto('http://localhost:' + PORT + '/oyun-blackjack.html?godot=1', { waitUntil: 'networkidle' });
	await page.waitForSelector('#bj-godot-iframe', { timeout: 5000 });
	results.lobiPageErrors = pageErrors.length;

	function godotFrame() {
		const f = page.frame({ url: /\/godot\/blackjack\/frame\.html/ });
		if (!f) { throw new Error('godot iframe (frame.html) henüz yüklenmedi'); }
		return f;
	}
	while (!page.frame({ url: /\/godot\/blackjack\/frame\.html/ })) { await page.waitForTimeout(50); }

	async function gonder(type, extra) {
		await godotFrame().evaluate(({ type, extra }) => parent.postMessage(Object.assign({ type: type }, extra || {}), location.origin), { type, extra });
	}
	async function masa() {
		return page.evaluate((yol) => (window.__mockLiveState ? Object.assign({}, yol.split('/').reduce((o, k) => (o || {})[k], window.__mockLiveState)) : null), MASA_YOLU);
	}
	async function masaYaz(veri) {
		await page.evaluate(({ yol, veri }) => firebase.database().ref(yol).set(veri), { yol: MASA_YOLU, veri });
	}
	async function alanYaz(altYol, deger) {
		await page.evaluate(({ yol, deger }) => firebase.database().ref(yol).set(deger), { yol: MASA_YOLU + '/' + altYol, deger });
	}
	async function cuzdan() {
		return page.evaluate((yol) => (window.__mockLiveState ? yol.split('/').reduce((o, k) => (o || {})[k], window.__mockLiveState) : null), CUZDAN_YOLU);
	}

	// 0) İlk oturan HER ZAMAN masanın ORTA koltuğuna (MAX_KOLTUK=5 -> index 2)
	// oturtulur -- kullanıcı isteği: "oyuna ilk gelen kişi her daim hangi
	// seçeneği seçerse seçsin ortaya oturtulsun" (bkz. otur()'daki MERKEZ_KOLTUK).
	await gonder('bjOtur', { koltukIndex: 0 });
	await page.waitForTimeout(200);
	const ilkOturus = await masa();
	results.ilkOturanOrtayaOturtuldu = Boolean(ilkOturus && ilkOturus.koltuklar && ilkOturus.koltuklar[2] && ilkOturus.koltuklar[2].uid === 'oyuncu1');

	// 0b) Kalk -- bahis_bekleniyor'da koltuğu boşaltmalı.
	await gonder('bjKalk', { koltukIndex: 2 });
	await page.waitForTimeout(200);
	results.kalkincaKoltukBosaldi = !(await masa()).koltuklar[2];
	await gonder('bjOtur', { koltukIndex: 0 }); // yine ortaya oturur
	await page.waitForTimeout(200);

	// 2. oyuncuyu (mock'ta sekmeler arası paylaşım olmadığından) doğrudan
	// Firebase'e yazıyoruz -- gerçek kod yolu (masaIslemi) yalnızca oyuncu1
	// tarafında çalışıyor, oyuncu2 sentetik bir katılımcı.
	await alanYaz('koltuklar/0', { uid: 'oyuncu2', isim: 'Rakip', bahis: null, katilimDurumu: 'hazir' });
	await page.waitForTimeout(150);

	// Cüzdan bootstrap'inin (BASLANGIC_BAKIYESI=1000) tamamlanmasını bekle.
	for (let i = 0; i < 20; i++) {
		const c = await cuzdan();
		if (c && c.bakiye >= 0) break;
		await page.waitForTimeout(150);
	}
	results.cuzdanBaslangicBakiyesiOlusturuldu = (await cuzdan()).bakiye === 1000;

	// 1) Bahis -- oyuncu1 (koltuk 2) 100 çip yatırır, oyuncu2 (koltuk 0)
	// doğrudan yazılır. Bahis penceresi süresini (BAHIS_SURESI_MS=30000ms)
	// beklemek yerine (deterministik olsun diye) doğrudan geçmişe alıyoruz --
	// gerçek geçiş mantığı (bahisSuresiDolunca/belkiSonrakiFazaGec) hâlâ çalışıyor.
	await gonder('bjBahis', { koltukIndex: 2, miktar: 100 });
	await page.waitForTimeout(250);
	results.bahisCuzdandanDusuldu = (await cuzdan()).bakiye === 900;
	await alanYaz('koltuklar/0/bahis', 100);
	await page.waitForTimeout(150);
	results.herIkiBahisYazildi = (await masa()).koltuklar[2].bahis === 100 && (await masa()).koltuklar[0].bahis === 100;
	await alanYaz('bahisSuresiBitis', Date.now() - 1);
	await page.waitForTimeout(1300); // phaseWatchdog 1sn'lik izleyici
	const dagitimSonrasi = await masa();
	results.bahisKapaninca4erKartDagitildi = dagitimSonrasi.durum === 'oyunculuk'
		&& dagitimSonrasi.koltuklar[2].eller[0].kartlar.length === 2
		&& dagitimSonrasi.koltuklar[0].eller[0].kartlar.length === 2;
	results.krupiyerIkiKartAldiKapaliMi = Boolean(dagitimSonrasi.kurpiyerEli)
		&& dagitimSonrasi.kurpiyerEli.kartlar.length === 2 && dagitimSonrasi.kurpiyerEli.acikMi === false;

	// 2) Kart Çek -- güvenli bir toplamdan (5) çekilen bilinen bir kart (4)
	// battırmamalı, elde kalmalı ("oynuyor").
	{
		const m = await masa();
		const yeniKoltuklar = Object.assign({}, m.koltuklar);
		yeniKoltuklar[2] = Object.assign({}, yeniKoltuklar[2], { eller: [{ kartlar: [{ r: '2', s: 'kupa' }, { r: '3', s: 'karo' }], durum: 'oynuyor', bahisMiktari: 100 }] });
		await masaYaz(Object.assign({}, m, {
			koltuklar: yeniKoltuklar, aktifKoltuk: 2,
			deste: [{ r: '4', s: 'maca' }].concat(Array.from({ length: 20 }, () => ({ r: '9', s: 'sinek' }))), desteIndex: 0
		}));
	}
	await page.waitForTimeout(200);
	await gonder('bjKartCek');
	await page.waitForTimeout(250);
	const cekSonrasi = await masa();
	results.guvenliKartCekmeBattirmadi = cekSonrasi.koltuklar[2].eller[0].kartlar.length === 3
		&& cekSonrasi.koltuklar[2].eller[0].durum === 'oynuyor';

	// 3) Kart Çek -- battıran bir senaryo (20 + bilinen 10-değerli kart -> 30)
	// deterministik olarak "batti" sonucu üretmeli, ödeme 0 olmalı.
	{
		const m = await masa();
		const yeniKoltuklar = Object.assign({}, m.koltuklar);
		yeniKoltuklar[2] = Object.assign({}, yeniKoltuklar[2], { eller: [{ kartlar: [{ r: '10', s: 'kupa' }, { r: '10', s: 'karo' }], durum: 'oynuyor', bahisMiktari: 100 }] });
		yeniKoltuklar[0] = Object.assign({}, yeniKoltuklar[0], { eller: [{ kartlar: [{ r: '10', s: 'maca' }, { r: '9', s: 'sinek' }], durum: 'kaldi', bahisMiktari: 100 }] });
		await masaYaz(Object.assign({}, m, {
			koltuklar: yeniKoltuklar, aktifKoltuk: 2,
			deste: [{ r: 'papaz', s: 'sinek' }].concat(Array.from({ length: 20 }, () => ({ r: '9', s: 'sinek' }))), desteIndex: 0
		}));
	}
	await page.waitForTimeout(200);
	await gonder('bjKartCek');
	await page.waitForTimeout(250);
	const battiSonrasi = await masa();
	results.battiranKartDogruIsaretlendi = battiSonrasi.koltuklar[2].eller[0].durum === 'batti';
	// Herkes battı/kaldı -- sıra otomatik krupiyere geçmeli (sonrakiSirayiAyarla).
	results.herkesBitirinceKurpiyerSirasiGeldi = battiSonrasi.durum === 'kurpiyer_sirasi';

	// 4) Krupiyer sırası -- kapalı kart AÇILMALI (acikMi: true) ve el
	// sonuçları (batan oyuncu "kaybetti", odeme 0) yazılmalı. Krupiyer elini
	// deterministik yap: 10+7=17 (sert dur kuralı, kart çekmeden durur).
	await masaYaz(Object.assign({}, battiSonrasi, {
		durum: 'kurpiyer_sirasi', aktifKoltuk: null,
		kurpiyerEli: { kartlar: [{ r: '10', s: 'karo' }, { r: '7', s: 'maca' }], acikMi: false },
		deste: Array.from({ length: 10 }, () => ({ r: '9', s: 'sinek' })), desteIndex: 0
	}));
	// Artık krupiyer eli TEK adımda değil, gerçekçi gecikmeli adımlarla ilerliyor:
	// 1) kapalı kart açılır (KRUPIYER_ADIM_MS=1100ms bekleme), 2) 17'de durduğu için
	// bir adım sonra sonuç yazılır. phaseWatchdog'un 1000ms'lik yoklama aralığını da
	// hesaba katarak iki adımın da kesin tamamlanması için bolca pay bırakıyoruz.
	await page.waitForTimeout(4500);
	const krupiyerSonrasi = await masa();
	results.krupiyerKapaliKartiActi = Boolean(krupiyerSonrasi.kurpiyerEli) && krupiyerSonrasi.kurpiyerEli.acikMi === true;
	results.durumElSonucunaGecti = krupiyerSonrasi.durum === 'el_sonucu';
	results.battiranOyuncuKaybettiOdemeSifir = krupiyerSonrasi.koltuklar[2].eller[0].sonuc === 'kaybetti' && krupiyerSonrasi.koltuklar[2].eller[0].odeme === 0;

	// 5) Katla (double down) -- 2 kartlı bir elden katlarsak: bahis düşer,
	// tek kart daha gelir, el 3 kartla kilitlenir (katlandi:true).
	await masaYaz(Object.assign({}, krupiyerSonrasi, {
		durum: 'oyunculuk', aktifKoltuk: 2,
		koltuklar: Object.assign({}, krupiyerSonrasi.koltuklar, {
			2: Object.assign({}, krupiyerSonrasi.koltuklar[2], { eller: [{ kartlar: [{ r: '5', s: 'kupa' }, { r: '6', s: 'karo' }], durum: 'oynuyor', bahisMiktari: 100 }] }),
			0: Object.assign({}, krupiyerSonrasi.koltuklar[0], { eller: [{ kartlar: [{ r: '10', s: 'maca' }, { r: '9', s: 'sinek' }], durum: 'kaldi', bahisMiktari: 100 }] })
		}),
		deste: [{ r: '4', s: 'maca' }].concat(Array.from({ length: 10 }, () => ({ r: '9', s: 'sinek' }))), desteIndex: 0
	}));
	await page.waitForTimeout(200);
	const bakiyeKatlaOncesi = (await cuzdan()).bakiye;
	await gonder('bjKatla');
	await page.waitForTimeout(300);
	const katlaSonrasi = await masa();
	results.katlaBahsiCuzdandanDustu = (await cuzdan()).bakiye === bakiyeKatlaOncesi - 100;
	results.katlaUcuncuKartiEkledi = katlaSonrasi.koltuklar[2].eller[0].kartlar.length === 3
		&& katlaSonrasi.koltuklar[2].eller[0].katlandi === true
		&& katlaSonrasi.koltuklar[2].eller[0].bahisMiktari === 200;

	// 6) Böl (split) -- aynı rütbeden iki kart iki ayrı ele bölünmeli, ikinci
	// bir kart (ödünç bahis) tekrar cüzdandan düşmeli.
	await masaYaz(Object.assign({}, katlaSonrasi, {
		durum: 'oyunculuk', aktifKoltuk: 2,
		koltuklar: Object.assign({}, katlaSonrasi.koltuklar, {
			2: Object.assign({}, katlaSonrasi.koltuklar[2], { eller: [{ kartlar: [{ r: '8', s: 'kupa' }, { r: '8', s: 'karo' }], durum: 'oynuyor', bahisMiktari: 100 }] })
		}),
		deste: [{ r: '3', s: 'maca' }, { r: '4', s: 'sinek' }].concat(Array.from({ length: 10 }, () => ({ r: '9', s: 'sinek' }))), desteIndex: 0
	}));
	await page.waitForTimeout(200);
	const bakiyeBolOncesi = (await cuzdan()).bakiye;
	await gonder('bjBol');
	await page.waitForTimeout(300);
	const bolSonrasi = await masa();
	results.bolBahsiCuzdandanDustu = (await cuzdan()).bakiye === bakiyeBolOncesi - 100;
	results.bolIkiElOlusturdu = bolSonrasi.koltuklar[2].eller.length === 2
		&& bolSonrasi.koltuklar[2].eller[0].kartlar.length === 2
		&& bolSonrasi.koltuklar[2].eller[1].kartlar.length === 2;

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
