// Blackjack saf deste/el mantığı testi -- DOM/Firebase yok, doğrudan modülü
// import edip fonksiyonları çağırıyor. tests/ CommonJS olduğu için (admin-src
// "type":"module" ama repo kökü değil) dynamic import() kullanılıyor.
const path = require('path');
const { pathToFileURL } = require('url');

(async () => {
	const mod = await import(pathToFileURL(path.join(__dirname, '..', 'docs', 'admin-src', 'src', 'v4', 'blackjack-deste.js')).href);
	const {
		tazeDesteOlustur, desteyiKaris, elDegerlendir, bolunebilirMi,
		krupiyerElOyna, desteYeterliMi, elSonucuHesapla, TOPLAM_KART_SAYISI
	} = mod;

	const results = {};

	// 1) Taze deste: tam 208 kart, her rütbe-takım kombinasyonundan tam 4 tane.
	{
		const deste = tazeDesteOlustur();
		results.tamKartSayisi = deste.length === TOPLAM_KART_SAYISI;
		const sayaç = {};
		deste.forEach((k) => { const key = k.r + '-' + k.s; sayaç[key] = (sayaç[key] || 0) + 1; });
		const anahtarlar = Object.keys(sayaç);
		results.her52KombinasyonVar = anahtarlar.length === 52;
		results.herKombinasyonTamDortDefa = anahtarlar.every((k) => sayaç[k] === 4);
	}

	// 2) Karıştırma: aynı 208 kartın bir permütasyonu (kayıp/kopya yok), ve
	// gerçekten sırayı değiştiriyor (aynı diziye eşit olma ihtimali astronomik düşük).
	{
		const deste = tazeDesteOlustur();
		const karisik = desteyiKaris(deste);
		results.karistirmaAyniUzunlukta = karisik.length === deste.length;
		const orijinalDizi = deste.map((k) => k.r + '-' + k.s).sort();
		const karisikDizi = karisik.map((k) => k.r + '-' + k.s).sort();
		results.karistirmaAyniKartSeti = JSON.stringify(orijinalDizi) === JSON.stringify(karisikDizi);
		results.karistirmaSiraDegisti = karisik.some((k, i) => k.r !== deste[i].r || k.s !== deste[i].s);
	}

	// 3) El değerlendirme: temel toplamlar.
	{
		const iki = elDegerlendir([{ r: '10', s: 'kupa' }, { r: '7', s: 'maca' }]);
		results.onYediDogru = iki.toplam === 17 && !iki.battiMi && !iki.blackjackMi;

		const blackjack = elDegerlendir([{ r: 'as', s: 'kupa' }, { r: 'papaz', s: 'maca' }]);
		results.blackjackDogruTespit = blackjack.toplam === 21 && blackjack.blackjackMi;

		const yumusakOnAlti = elDegerlendir([{ r: 'as', s: 'kupa' }, { r: '5', s: 'maca' }]);
		results.yumusakOnAltiDogru = yumusakOnAlti.toplam === 16 && yumusakOnAlti.yumusakMi;

		// İki As + 9: 11+11+9=31 -> bir As 1'e iner (21), hâlâ diğer As 11 sayılıyor (yumuşak 21).
		const ikiAs = elDegerlendir([{ r: 'as', s: 'kupa' }, { r: 'as', s: 'maca' }, { r: '9', s: 'karo' }]);
		results.ikiAsDogruDusurme = ikiAs.toplam === 21 && ikiAs.yumusakMi && !ikiAs.battiMi;

		const batti = elDegerlendir([{ r: '10', s: 'kupa' }, { r: '9', s: 'maca' }, { r: '5', s: 'karo' }]);
		results.battiDogruTespit = batti.toplam === 24 && batti.battiMi;
	}

	// 4) Bölünebilirlik: aynı DEĞER ama farklı rütbe (10 ve papaz) BÖLÜNEMEMELİ
	// (gerçek kurallara göre sadece aynı rütbe bölünür, "10-değerinde" olması yetmez).
	{
		results.ayniRutbeBolunebilir = bolunebilirMi([{ r: '8', s: 'kupa' }, { r: '8', s: 'maca' }]) === true;
		results.farkliRutbeAyniDegerBolunemez = bolunebilirMi([{ r: '10', s: 'kupa' }, { r: 'papaz', s: 'maca' }]) === false;
		results.ucKartBolunemez = bolunebilirMi([{ r: '8', s: 'kupa' }, { r: '8', s: 'maca' }, { r: '2', s: 'karo' }]) === false;
	}

	// 5) Krupiyer oyunu: 17'de durmalı, yumuşak 17'de de durmalı (sert dur kuralı),
	// 16'da çekmeye devam etmeli.
	{
		const deste = [{ r: '5', s: 'kupa' }, { r: '3', s: 'kupa' }]; // krupiyer 16 çekerse 16+5=21 falan olur, sadece akış testi
		const sonuc17 = krupiyerElOyna([{ r: '10', s: 'kupa' }, { r: '7', s: 'maca' }], deste, 0);
		results.krupiyerOnYedideDurur = sonuc17.kartlar.length === 2 && sonuc17.yeniDesteIndex === 0;

		const sonucYumusak17 = krupiyerElOyna([{ r: 'as', s: 'kupa' }, { r: '6', s: 'maca' }], deste, 0);
		results.krupiyerYumusakOnYedideDurur = sonucYumusak17.kartlar.length === 2 && sonucYumusak17.sonuc.toplam === 17;

		const sonuc16 = krupiyerElOyna([{ r: '10', s: 'kupa' }, { r: '6', s: 'maca' }], deste, 0);
		results.krupiyerOnAltidaCeker = sonuc16.kartlar.length === 3 && sonuc16.yeniDesteIndex === 1;
	}

	// 6) Deste yeterlilik kontrolü.
	{
		results.azKalanYetersizGorulur = desteYeterliMi(10, 3) === false;
		results.boldKalanYeterliGorulur = desteYeterliMi(200, 3) === true;
	}

	// 7) Ödeme hesabı.
	{
		const oyuncuBJ = elDegerlendir([{ r: 'as', s: 'kupa' }, { r: 'papaz', s: 'maca' }]);
		const krupiyer20 = elDegerlendir([{ r: '10', s: 'kupa' }, { r: 'kiz', s: 'maca' }]);
		const bjSonuc = elSonucuHesapla(oyuncuBJ, krupiyer20, 100);
		results.blackjackUcIkiOder = bjSonuc.sonuc === 'blackjack' && bjSonuc.odeme === 250;

		const oyuncu20 = elDegerlendir([{ r: '10', s: 'kupa' }, { r: 'kiz', s: 'maca' }]);
		const krupiyer19 = elDegerlendir([{ r: '10', s: 'kupa' }, { r: '9', s: 'maca' }]);
		const kazandiSonuc = elSonucuHesapla(oyuncu20, krupiyer19, 100);
		results.normalKazancBirBirOder = kazandiSonuc.sonuc === 'kazandi' && kazandiSonuc.odeme === 200;

		const oyuncuBatti = elDegerlendir([{ r: '10', s: 'kupa' }, { r: '9', s: 'maca' }, { r: '5', s: 'karo' }]);
		const kaybettiSonuc = elSonucuHesapla(oyuncuBatti, krupiyer19, 100);
		results.battiHicOdemeAlmaz = kaybettiSonuc.sonuc === 'kaybetti' && kaybettiSonuc.odeme === 0;

		const beraberSonuc = elSonucuHesapla(oyuncu20, oyuncu20, 100);
		results.beraberlikBahsiIadeEder = beraberSonuc.sonuc === 'berabere' && beraberSonuc.odeme === 100;
	}

	console.log(JSON.stringify(results, null, 2));
	const fails = Object.keys(results).filter((k) => results[k] !== true);
	console.log('ALL_TESTS_PASSED: ' + (fails.length === 0));
	if (fails.length) { console.log('FAILS: ' + fails.join(', ')); process.exit(1); }
})();
