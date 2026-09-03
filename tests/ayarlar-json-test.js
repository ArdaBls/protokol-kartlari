/*
  Ayarlar > JSON bölümü testleri.

  Bu dosya, app.js'teki importJSON()'un 4 Eylül 2026'da ayarlar.html > JSON
  bölümüne taşınmasıyla ortaya çıkan iki riski doğrular:

  1) GÖREV GEÇMİŞİ KAYBI: importJSON()'un kendisi 2026-08-26'da bu tam regresyonu
     yaşamıştı (bkz. data-integrity-test.js'in eski 3. senaryosu) -- taşıma
     sırasında aynı hatanın YENİDEN üretilmediğini doğrulamak, taşımanın
     kendisi kadar önemli. "Tamamen Geri Yükle" modunda görev geçmişi
     korunmalı.

  2) BİRLEŞTİR modunda YENİ eklenen kayıtların görev geçmişi de alınmalı,
     MEVCUT kayıtlara dokunulmamalı (app.js'teki AYNI kural).
*/
const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');

const TESTS_DIR = __dirname;
const SITE_ROOT = path.join(__dirname, '..', 'docs');
const PORT = 8977;

function serve() {
	const server = http.createServer((req, res) => {
		let p = decodeURIComponent(req.url.split('?')[0]);
		if (p === '/') p = '/index.html';
		const fp = path.join(SITE_ROOT, p);
		fs.readFile(fp, (err, data) => {
			if (err) { res.writeHead(404); res.end('not found: ' + p); return; }
			const ext = path.extname(fp);
			const type = ext === '.html' ? 'text/html' : ext === '.js' ? 'application/javascript'
				: ext === '.css' ? 'text/css' : 'text/plain';
			res.writeHead(200, { 'Content-Type': type });
			res.end(data);
		});
	});
	return new Promise((resolve) => server.listen(PORT, () => resolve(server)));
}

async function openAyarlar(browser) {
	const ctx = await browser.newContext();
	const page = await ctx.newPage();
	const hatalar = [];
	page.on('pageerror', (e) => hatalar.push(e.message));
	await page.route('**/firebasejs/**/firebase-app-compat.js', (r) => r.fulfill({ path: path.join(TESTS_DIR, 'mock-firebase.js'), contentType: 'application/javascript' }));
	await page.route('**/firebasejs/**/firebase-database-compat.js', (r) => r.fulfill({ body: '', contentType: 'application/javascript' }));
	await page.route('**/firebasejs/**/firebase-auth-compat.js', (r) => r.fulfill({ body: '', contentType: 'application/javascript' }));
	await page.route('**://fonts.googleapis.com/**', (r) => r.fulfill({ body: '', contentType: 'text/css' }));
	await page.route('**://fonts.gstatic.com/**', (r) => r.abort());
	await page.addInitScript(() => {
		window.__mockAuthUser = { uid: 'admin1', email: 'admin@test.com', emailVerified: true };
		window.__mockUserProfile = { role: 'admin', firstName: 'Test', lastName: 'Admin' };
		window.__mockOnceSnapshot = { role: 'admin', firstName: 'Test', lastName: 'Admin' };
	});
	await page.goto(`http://localhost:${PORT}/ayarlar.html`, { waitUntil: 'load', timeout: 30000 });
	await page.waitForTimeout(400);
	return { ctx, page, hatalar };
}

(async () => {
	const server = await serve();
	const browser = await chromium.launch();
	const sonuc = {};

	// ── 1) TAMAMEN GERİ YÜKLE: görev geçmişi korunmalı ──
	{
		const { ctx, page, hatalar } = await openAyarlar(browser);
		const dosya = JSON.stringify({
			pid1: {
				name: 'Geçmişi Olan Kişi', title: 'Rektör', prefix: 'Prof. Dr.', unit: 'Rektörlük',
				status: 'aktif', rank: 1, photo: '', start: '2020-01-01', end: '', note: 'Önemli not',
				gorevGecmisi: [
					{ unvan: 'Dekan', baslangic: '2015-01-01', bitis: '2019-12-31' },
					{ unvan: 'Bölüm Başkanı', baslangic: '2010-01-01', bitis: '2014-12-31' }
				]
			}
		}, null, 2);
		await page.evaluate(() => { window.confirm = () => true; }); // "Tamamen Geri Yükle" + onayı
		await page.setInputFiles('#json-file-il', { name: 'yedek.json', mimeType: 'application/json', buffer: Buffer.from(dosya, 'utf-8') });
		await page.waitForTimeout(500);
		const veri = await page.evaluate(() => {
			const s = (window.__mockSets || []).find((x) => x.path === 'ilProtokolVerileri');
			const kayit = s ? Object.values(s.data)[0] : null;
			return {
				yazildiMi: !!s,
				kayitSayisi: s ? Object.keys(s.data).length : 0,
				gecmisSayisi: kayit && Array.isArray(kayit.gorevGecmisi) ? kayit.gorevGecmisi.length : 0,
				ilkUnvan: kayit && kayit.gorevGecmisi ? kayit.gorevGecmisi[0].unvan : null,
				ilkBaslangic: kayit && kayit.gorevGecmisi ? kayit.gorevGecmisi[0].baslangic : null
			};
		});
		sonuc.tamGeriYukle = { ...veri, hataSayisi: hatalar.length };
		await ctx.close();
	}

	// ── 2) BİRLEŞTİR: yeni kayda görev geçmişi eklenmeli, mevcut kayıt dokunulmadan kalmalı ──
	{
		const { ctx, page, hatalar } = await openAyarlar(browser);
		await page.evaluate(() => {
			window.confirm = () => false; // İPTAL = Birleştir (varsayılan)
			window.__mockData = window.__mockData || {};
			window.__mockData.ilProtokolVerileri = {
				mevcut1: { name: 'Mevcut Kişi', title: 'Dekan', unit: 'Eski Birim', status: 'aktif', rank: 5 }
			};
		});
		const dosya = JSON.stringify([
			{ name: 'Yeni Kişi', title: 'Öğr. Gör.', status: 'aktif', rank: 9, gorevGecmisi: [{ unvan: 'Araştırmacı', baslangic: '2018-01-01', bitis: '2021-01-01' }] }
		], null, 2);
		await page.setInputFiles('#json-file-il', { name: 'yeni.json', mimeType: 'application/json', buffer: Buffer.from(dosya, 'utf-8') });
		await page.waitForTimeout(500);
		const veri = await page.evaluate(() => {
			const updates = window.__mockUpdates || [];
			const patch = updates.length ? updates[updates.length - 1].data : {};
			const yeniKayitVarMi = Object.keys(patch).some((k) => !k.includes('/') && patch[k] && patch[k].name === 'Yeni Kişi');
			const yeniKayit = Object.values(patch).find((v) => v && typeof v === 'object' && v.name === 'Yeni Kişi');
			const mevcutDokunulduMu = Object.keys(patch).some((k) => k.startsWith('mevcut1/') && (k.endsWith('/name') || k.endsWith('/title') || k.endsWith('/unit')));
			return {
				yeniKayitEklendi: !!yeniKayitVarMi,
				yeniKayitGecmisi: yeniKayit && Array.isArray(yeniKayit.gorevGecmisi) ? yeniKayit.gorevGecmisi.length : 0,
				mevcutKayitDokunulmadi: !mevcutDokunulduMu
			};
		});
		sonuc.birlestir = { ...veri, hataSayisi: hatalar.length };
		await ctx.close();
	}

	await browser.close();
	server.close();

	console.log(JSON.stringify(sonuc, null, 2));
	const basarisiz = [];
	if (!sonuc.tamGeriYukle.yazildiMi) basarisiz.push('Tamamen Geri Yükle: ilProtokolVerileri hiç yazılmadı');
	if (sonuc.tamGeriYukle.kayitSayisi !== 1) basarisiz.push('Tamamen Geri Yükle: kayıt sayısı 1 değil: ' + sonuc.tamGeriYukle.kayitSayisi);
	if (sonuc.tamGeriYukle.gecmisSayisi !== 2) basarisiz.push('Tamamen Geri Yükle: görev geçmişi kayboldu (beklenen 2, gelen ' + sonuc.tamGeriYukle.gecmisSayisi + ')');
	if (sonuc.tamGeriYukle.ilkUnvan !== 'Dekan') basarisiz.push('Tamamen Geri Yükle: görev geçmişi içeriği bozuldu: ' + sonuc.tamGeriYukle.ilkUnvan);
	if (sonuc.tamGeriYukle.ilkBaslangic !== '2015-01-01') basarisiz.push('Tamamen Geri Yükle: görev geçmişi tarihi bozuldu: ' + sonuc.tamGeriYukle.ilkBaslangic);
	if (sonuc.tamGeriYukle.hataSayisi !== 0) basarisiz.push('Tamamen Geri Yükle: sayfa hatası oluştu (' + sonuc.tamGeriYukle.hataSayisi + ')');
	if (!sonuc.birlestir.yeniKayitEklendi) basarisiz.push('Birleştir: yeni kayıt eklenmedi');
	if (sonuc.birlestir.yeniKayitGecmisi !== 1) basarisiz.push('Birleştir: yeni kaydın görev geçmişi eklenmedi');
	if (!sonuc.birlestir.mevcutKayitDokunulmadi) basarisiz.push('Birleştir: mevcut kayda gereksiz yere dokunuldu');
	if (sonuc.birlestir.hataSayisi !== 0) basarisiz.push('Birleştir: sayfa hatası oluştu (' + sonuc.birlestir.hataSayisi + ')');

	console.log('ALL_TESTS_PASSED:', basarisiz.length === 0);
	if (basarisiz.length) console.log('BASARISIZ:', JSON.stringify(basarisiz, null, 2));
	process.exitCode = basarisiz.length === 0 ? 0 : 1;
})();
