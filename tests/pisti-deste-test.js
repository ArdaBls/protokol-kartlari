// Pişti saf deste/el mantığı testi -- DOM/Firebase yok, doğrudan modülü import
// edip fonksiyonları çağırıyor. tests/ CommonJS olduğu için (admin-src
// "type":"module" ama repo kökü değil) dynamic import() kullanılıyor.
const path = require('path');
const { pathToFileURL } = require('url');

(async () => {
	const mod = await import(pathToFileURL(path.join(__dirname, '..', 'docs', 'admin-src', 'src', 'v4', 'pisti-deste.js')).href);
	const {
		pistiDestesiOlustur, pistiDesteyiKaris, pistiKartDegeri, pistiHamleUygula,
		pistiSonMasayiDagit, pistiElPuanlariniHesapla, pistiDesteYeterliMi, TOPLAM_KART_SAYISI
	} = mod;

	const results = {};

	// 1) Taze deste: tam 52 kart, her rütbe-takım kombinasyonundan tam 1 tane.
	{
		const deste = pistiDestesiOlustur();
		results.tamKartSayisi = deste.length === TOPLAM_KART_SAYISI && TOPLAM_KART_SAYISI === 52;
		const sayac = {};
		deste.forEach((k) => { const key = k.r + '-' + k.s; sayac[key] = (sayac[key] || 0) + 1; });
		results.her52KombinasyonBirDefa = Object.keys(sayac).length === 52 && Object.values(sayac).every((n) => n === 1);
	}

	// 2) Karıştırma: aynı kartları içerir, sırası (neredeyse kesin) değişir.
	{
		const deste = pistiDestesiOlustur();
		const karisik = pistiDesteyiKaris(deste);
		results.karismaAyniKartlariIcerir = karisik.length === deste.length &&
			karisik.every((k) => deste.some((d) => d.r === k.r && d.s === k.s));
		results.karismaSiraDegistirir = JSON.stringify(karisik) !== JSON.stringify(deste);
		results.karismaOrijinaliBozmaz = deste[0] && JSON.stringify(pistiDestesiOlustur()[0]) === JSON.stringify(deste[0]);
	}

	// 3) Kart değerleri: As/Vale=1, Sinek 2=2, Karo 10=3, diğerleri 0.
	{
		results.asDegeri1 = pistiKartDegeri({ r: 'as', s: 'kupa' }) === 1;
		results.valeDegeri1 = pistiKartDegeri({ r: 'joker', s: 'maca' }) === 1;
		results.sinekIkiDegeri2 = pistiKartDegeri({ r: '2', s: 'sinek' }) === 2;
		results.digerIkilerDegeri0 = pistiKartDegeri({ r: '2', s: 'kupa' }) === 0;
		results.karoOnDegeri3 = pistiKartDegeri({ r: '10', s: 'karo' }) === 3;
		results.digerOnlarDegeri0 = pistiKartDegeri({ r: '10', s: 'sinek' }) === 0;
		results.kizPapazDegeri0 = pistiKartDegeri({ r: 'kiz', s: 'kupa' }) === 0 && pistiKartDegeri({ r: 'papaz', s: 'kupa' }) === 0;
	}

	// 4) Hamle: eşleşmeyen kart masaya eklenir, alınmaz.
	{
		const masa = [{ r: '7', s: 'kupa' }];
		const sonuc = pistiHamleUygula(masa, { r: '3', s: 'maca' });
		results.eslesmeyenKartMasayaEklenir = sonuc.yeniMasaKartlari.length === 2 && sonuc.alinanKartlar.length === 0 && !sonuc.pistiMi;
	}

	// 5) Hamle: aynı rütbe eşleşirse TÜM masa alınır.
	{
		const masa = [{ r: '5', s: 'kupa' }, { r: '9', s: 'maca' }, { r: '9', s: 'karo' }];
		const sonuc = pistiHamleUygula(masa, { r: '9', s: 'sinek' });
		results.eslesenKartTumMasayiAlir = sonuc.yeniMasaKartlari.length === 0 && sonuc.alinanKartlar.length === 4;
		// Masada birden fazla kart varken eşleşme pişti SAYILMAZ.
		results.cokKartliEslesmePistiDegil = !sonuc.pistiMi;
	}

	// 6) Vale HER ZAMAN masadaki tüm kartları alır (rütbe eşleşmesi aranmaz).
	{
		const masa = [{ r: '5', s: 'kupa' }, { r: '9', s: 'maca' }];
		const sonuc = pistiHamleUygula(masa, { r: 'joker', s: 'karo' });
		results.valeTumMasayiAlir = sonuc.yeniMasaKartlari.length === 0 && sonuc.alinanKartlar.length === 3;
	}

	// 7) Vale boş masaya oynanırsa (ilk hamle gibi) hiçbir şey alamaz, masaya eklenir.
	{
		const sonuc = pistiHamleUygula([], { r: 'joker', s: 'karo' });
		results.valeBosMasadaSadeceEklenir = sonuc.yeniMasaKartlari.length === 1 && sonuc.alinanKartlar.length === 0;
	}

	// 8) Pişti: masada TAM OLARAK bir kart varken eşleşme -- 10 puanlık bonusun
	// kaynağı olan bayrak burada true dönmeli.
	{
		const sonucEslesme = pistiHamleUygula([{ r: '6', s: 'kupa' }], { r: '6', s: 'maca' });
		results.tekKartEslesmesiPisti = sonucEslesme.pistiMi === true && sonucEslesme.alinanKartlar.length === 2;
		// Vale ile de (masada tek kart varken) pişti sayılır.
		const sonucVale = pistiHamleUygula([{ r: '6', s: 'kupa' }], { r: 'joker', s: 'maca' });
		results.tekKartValeIlePisti = sonucVale.pistiMi === true;
	}

	// 9) Son kart: deste/eller tükenince masada kalanlar son oynayana gider.
	{
		const masaKalan = [{ r: '4', s: 'kupa' }, { r: '8', s: 'maca' }];
		const topladiklarim = [[{ r: 'as', s: 'kupa' }], []];
		const yeni = pistiSonMasayiDagit(masaKalan, 1, topladiklarim);
		results.sonKartKalanlariSonOynayanaVerir = yeni[1].length === 2 && yeni[0].length === 1;
		results.sonMasaBosSaOrijinaliDegistirmez = pistiSonMasayiDagit([], 0, topladiklarim) === topladiklarim;
	}

	// 10) El puanlaması: kağıt değerleri + pişti bonusu + en çok kart bonusu.
	{
		// Oyuncu 0: as (1) + sinek-2 (2) = 3 kağıt puanı, 1 pişti (10), 3 kart.
		// Oyuncu 1: karo-10 (3) kağıt puanı, 0 pişti, 1 kart.
		const topladiklarim = [
			[{ r: 'as', s: 'kupa' }, { r: '2', s: 'sinek' }, { r: '5', s: 'maca' }],
			[{ r: '10', s: 'karo' }]
		];
		const puanlar = pistiElPuanlariniHesapla(topladiklarim, [1, 0]);
		results.kagitPistiPuanlariDogru = puanlar[0] === 3 + 10 + 3 && puanlar[1] === 3; // oyuncu0 en çok kartla +3
		// Berabere kart sayısında kimse +3 almaz.
		const berabere = pistiElPuanlariniHesapla([[{ r: 'as', s: 'kupa' }], [{ r: 'as', s: 'maca' }]], [0, 0]);
		results.berabereKartSayisindaBonusYok = berabere[0] === 1 && berabere[1] === 1;
	}

	// 11) Deste yeterliliği: oyuncu sayısı * 4 kart kuralı.
	{
		results.desteYeterliDogru = pistiDesteYeterliMi(8, 2) === true && pistiDesteYeterliMi(7, 2) === false;
		results.desteYetersizGecersizOyuncu = pistiDesteYeterliMi(20, 1) === false && pistiDesteYeterliMi(20, 5) === false;
	}

	console.log(JSON.stringify(results, null, 2));
	const fails = Object.keys(results).filter((k) => !results[k]);
	console.log('ALL_TESTS_PASSED: ' + (fails.length === 0));
	if (fails.length) { console.log('FAILS: ' + fails.join(', ')); process.exit(1); }
})();
