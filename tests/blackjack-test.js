// Blackjack (oyun-blackjack.html) uctan uca duman testi -- gercek Firebase
// transaction() semantigini (bkz. mock-firebase.js'e eklenen canli durum
// katmani) kullanarak TEK bir istemcide TUM el dongusunu (otur -> bahis ->
// dagit -> vur/kal -> krupiyer -> odeme -> yeni el) surer. Coklu istemci
// senkronunu simule ETMIYOR (mock tek sayfa) ama ZINCIRLEME transaction
// mantiginin doğru calistigini (asil risk burada) dogruluyor.
const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');

const TESTS_DIR = __dirname;
const SITE_ROOT = path.join(__dirname, '..', 'docs');
const PORT = 8985;

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

	await page.goto('http://localhost:' + PORT + '/oyun-blackjack.html', { waitUntil: 'networkidle' });
	await page.waitForSelector('[data-bj-otur]', { timeout: 5000 });
	results.lobiPageErrors = pageErrors.length;
	results.tamBesKoltukVar = await page.locator('[data-bj-koltuklar] > *').count() === 5;

	// 1) Otur -- boş koltuğa tıkla.
	await page.click('[data-bj-otur="0"]');
	await page.waitForTimeout(200);
	results.oturuncaKendiKoltuguGorunur = await page.locator('.bj-koltuk-ben').count() === 1;
	results.oyunBaslarkenPaneliGorunur = (await page.locator('[data-bj-bahis-panel]').textContent() || '').includes('Oyun Başlarken');
	results.besliMasaGridiOrtayiKorur = await page.locator('[data-bj-koltuklar]').evaluate((masa) => {
		const slotlar = Array.from(masa.children).map((el) => el.getBoundingClientRect());
		if (slotlar.length !== 5) return false;
		const masaRect = masa.getBoundingClientRect();
		const orta = slotlar[2].left + (slotlar[2].width / 2);
		return Math.abs(orta - (masaRect.left + (masaRect.width / 2))) < 1;
	});

	// 1b) Başka bir koltuğa "+" ile tekrar oturmaya ÇALIŞ -- kullanıcı bildirimi:
	// "ben tek başıma tüm koltuklara oturabiliyorum". Zaten oturuyorken diğer
	// koltuklarda "+" butonu hiç GÖRÜNMEMELİ (aynı zamanda otur() da reddediyor).
	results.digerKoltuklardaOturButonuYok = await page.locator('[data-bj-otur]').count() === 0;

	// 2) Bahis yap (100 çip) -- 1000 başlangıç bakiyesiyle karşılanabilir.
	await page.waitForSelector('[data-bj-bahis][data-miktar="100"]', { timeout: 5000 });
	await page.click('[data-bj-bahis][data-miktar="100"]');
	await page.waitForTimeout(200);
	results.bahisYazildi = (await page.locator('.bj-bahis-mevcut').first().textContent() || '').includes('100');

	// 2b) İkinci kez 100'e bas -- TOPLANMALI (200 olmalı), üzerine yazılmamalı
	// (bkz. kullanıcı bildirimi: "2 kere 100'e basınca 200 olması lazım").
	await page.click('[data-bj-bahis][data-miktar="100"]');
	await page.waitForTimeout(200);
	results.bahisToplaniyor = (await page.locator('.bj-bahis-mevcut').first().textContent() || '').includes('200');
	// Gerçek çip görselleri kullanılıyor mu (bahis seçim düğmeleri + yerleştirilmiş
	// bahis yığını) -- kullanıcı isteği: "bizim çipleri kullanacağız".
	results.cipGorselleriKullaniliyor = await page.locator('.bj-cip-gorsel').count() > 0;

	const bakiyeMetniOku = async () => {
		const t = await page.locator('[data-bj-bakiye]').textContent();
		return Number((t || '').replace(/[^\d]/g, ''));
	};
	const bakiyeBahisRezervSonrasi = await bakiyeMetniOku();
	// Bahis dağıtımdan sonra değil, konduğu anda rezerve edilir. Böylece sayfa
	// kapanması/çoklu sekme yüzünden ücretsiz bahis oluşmaz.
	results.bahisAnindaRezerveEdildi = bakiyeBahisRezervSonrasi === 800;

	// 3) 6 saniyelik bahis süresini bekle -- otomatik dağıtım tetiklenmeli.
	// + kademeli dağıtım animasyonu (~7 adım * 300ms ≈ 2.1sn) bitene kadar bekle.
	await page.waitForTimeout(6500 + 2500);
	const kartSayisi = await page.locator('[data-bj-koltuklar] .bj-kart').count();
	results.dagitimdanSonraKartGorunur = kartSayisi >= 2;
	const krupiyerKartSayisi = await page.locator('[data-bj-krupiyer] .bj-kart').count();
	results.krupiyerIkiKartAldi = krupiyerKartSayisi === 2;
	// Krupiyerin kapalı kartı açılmadan sadece AÇIK kartın değeri görünmeli
	// (kullanıcı bildirimi: "kurpiyerin toplamı yok").
	results.krupiyerKismiToplamGorunur = await page.locator('.bj-el-toplam-kismi').count() === 1;
	// Kalan kart yığını (deste-arkası görselleri) kenarda görünüyor mu.
	results.desteYiginiGorunur = await page.locator('[data-bj-deste-yigini] img').count() > 0;

	// 4) Aksiyon çubuğu görünüyor mu (sıra bende ise).
	const aksiyonlarVar = await page.locator('[data-bj-aksiyonlar] button').count();
	results.aksiyonButonlariVarsaGorunur = aksiyonlarVar > 0 || kartSayisi === 0; // blackjack gelmiş olabilir, o zaman aksiyon yok -- kabul edilir
	// 10 saniyelik sıra sayacı görünüyor mu -- kullanıcı bildirimi: "sonsuz
	// bekleme oluyor, 10 saniye geri saysın".
	if (aksiyonlarVar > 0) {
		const sayacMetni = await page.locator('[data-bj-aksiyon-sayac]').textContent();
		results.aksiyonSayaciGorunur = /\d+\s*sn/.test(sayacMetni || '');
	}

	// 5) Eğer aksiyon varsa "Kal" ile eli bitir, krupiyer sırasına geçmeli.
	if (aksiyonlarVar > 0) {
		await page.click('[data-bj-kal]');
		await page.waitForTimeout(1500);
	}
	await page.waitForTimeout(2000);
	const durumMetni = await page.evaluate(() => document.body.innerHTML.includes('Battı') || document.querySelectorAll('.bj-el-sonuc').length > 0);
	results.elSonucuGoruldu = durumMetni;

	// 6) Bahis (200) zaten rezervde; sonuç toplam ödemeyi yalnızca bir kez
	// eklemeli. Sonuç metnine göre beklenen bakiyeyi
	// hesapla: Kaybetti -> 800, Berabere -> 1000, Kazandı -> 1200, Blackjack -> 1300.
	const sonucMetni = await page.evaluate(() => (document.querySelector('.bj-el-sonuc') || {}).textContent || '');
	const beklenenBakiye =
		sonucMetni.indexOf('Blackjack') !== -1 ? 1300 :
			sonucMetni.indexOf('Kazandı') !== -1 ? 1200 :
				sonucMetni.indexOf('Berabere') !== -1 ? 1000 : 800;
	const bakiyeSonrasi = await bakiyeMetniOku();
	results.bakiyeRezervasyonuKaybolmadi = sonucMetni.indexOf('Kaybetti') === -1 || bakiyeSonrasi === bakiyeBahisRezervSonrasi;
	results.bakiyeSonucaGoreDogruHesaplandi = bakiyeSonrasi === beklenenBakiye;

	// 7) Kazanma/kaybetme çemberi -- kullanıcı isteği: "kazanınca yeşil çember
	// kaybedince kırmızı". Berabere durumunda hiçbiri beklenmez (o yüzden atla).
	if (sonucMetni.indexOf('Berabere') === -1) {
		const beklenenSinif = (sonucMetni.indexOf('Kazandı') !== -1 || sonucMetni.indexOf('Blackjack') !== -1) ? '.bj-cember-kazandi' : '.bj-cember-kaybetti';
		results.avatarCemberDogruRenkte = await page.locator(beklenenSinif).count() > 0;
	}

	// 8) Deste, el bitip yeni bahis penceresi açılınca SIFIRLANMAMALI --
	// kullanıcı bildirimi: "208 olan kart sayısı giderek aşağı düşmüyor her
	// oyunda yeniden yükseliyor". Kök neden: bahisPenceresiniBaslat Firebase
	// transaction'ından TAMAMEN YENİ bir nesne döndürüyordu (deste/desteIndex
	// dahil edilmeden) -- transaction dönen değerle düğümün TAMAMINI
	// değiştirdiği için bu alanlar her el kayboluyordu.
	const masaOku = () => page.evaluate(() => {
		const s = window.__mockLiveState;
		return s && s.oyunBasarimlari && s.oyunBasarimlari.blackjack && s.oyunBasarimlari.blackjack.masalar && s.oyunBasarimlari.blackjack.masalar['ana-masa'];
	});
	const elBitmedenOnceDesteIndex = (await masaOku()).desteIndex;
	await page.waitForTimeout(4500); // EL_SONUCU_BEKLEME_MS (4000) + pay
	const yeniElMasasi = await masaOku();
	results.desteSifirlanmadanKorundu = yeniElMasasi.durum === 'bahis_bekleniyor' && yeniElMasasi.desteIndex === elBitmedenOnceDesteIndex;

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
