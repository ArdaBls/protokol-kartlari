// Editör görünümü + harita + kayıt formu testi.
//
// Kullanıcı istekleri:
//  1. "Operasyonlar sekmesindeki Editör Aktivitesi kısmını editörlerin de görmesini
//     istiyorum -- burada küçük bir yarış yapılıyor, görmek motivasyon verir."
//  2. "Harita sekmesinde 'Etkinlikler yüklenemedi.' hatası var, daireler gözükmüyor."
//  3. "Bildirimler sekmesi editöre gözükmeye devam ediyor ve basınca 403'e atıyor --
//     hem sekmeyi hem de sağ üstteki zil simgesini kaldıralım."
//  4. "Kayıt ekranında isim, soyisim ayrı şekilde yazılsın ve sisteme doğru entegre
//     edilsin" (tek 'Ad soyad' kutusu yüzünden kişi isimsiz kaydediliyordu).
const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');

const TESTS_DIR = __dirname;
const SITE_ROOT = path.join(__dirname, '..', 'docs');
const PORT = 8983;

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

// Etkinlikler: iki editörün adı gorevli/haberYazanlari alanlarında geçiyor.
const ETKINLIKLER = {
	e1: { ad: 'Açılış', tarih: new Date().getFullYear() + '-03-10', saat: '10:00', durum: 'planlandi', gorevli: 'Berk Can Dereci', birim: 'Fen Fakültesi' },
	e2: { ad: 'Panel', tarih: new Date().getFullYear() + '-04-12', saat: '14:00', durum: 'planlandi', gorevli: 'Arda Bilasa', haberYazanlari: 'Berk Can Dereci', birim: 'Tıp Fakültesi' }
};

async function ac(browser, rol, hedef, usersOkunabilir) {
	const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
	const page = await ctx.newPage();
	const hatalar = [];
	page.on('pageerror', (e) => hatalar.push(e.message));
	await page.route('**/firebasejs/**/firebase-app-compat.js', (r) => r.fulfill({ path: path.join(TESTS_DIR, 'mock-firebase.js'), contentType: 'application/javascript' }));
	await page.route('**/firebasejs/**/firebase-database-compat.js', (r) => r.fulfill({ body: '', contentType: 'application/javascript' }));
	await page.route('**/firebasejs/**/firebase-auth-compat.js', (r) => r.fulfill({ body: '', contentType: 'application/javascript' }));
	await page.route('**Sortable.min.js', (r) => r.fulfill({ path: path.join(TESTS_DIR, 'mock-sortable.js'), contentType: 'application/javascript' }));
	await page.route('**://fonts.googleapis.com/**', (r) => r.fulfill({ body: '', contentType: 'text/css' }));
	await page.addInitScript(({ rol, usersOkunabilir, etkinlikler }) => {
		window.__mockAuthUser = { uid: 'u1', email: 'editor@test.com', emailVerified: true };
		const kendi = { firstName: 'Berk Can', lastName: 'Dereci', email: 'editor@test.com', role: rol };
		window.__mockUserProfile = kendi;
		window.__mockOnceSnapshot = kendi;
		window.__mockData = { etkinlikler: etkinlikler, logs: {} };
		// users/ okunamıyorsa (editör) mock o yolda HATA döndürsün -- gerçek kural davranışı.
		if (!usersOkunabilir) { window.__mockDenyPaths = ['users']; }
		else { window.__mockData.users = { u1: kendi }; }
	}, { rol, usersOkunabilir, etkinlikler: ETKINLIKLER });
	await page.goto(`http://localhost:${PORT}/${hedef}`, { waitUntil: 'load', timeout: 30000 });
	await page.waitForTimeout(3000);
	return { page, ctx, hatalar };
}

(async () => {
	const server = await serve();
	const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
	const sonuc = {};

	// 1) Editör: Operasyonlar'da Editör Aktivitesi grafiği "yönetici görebilir" demesin
	{
		const { page, ctx, hatalar } = await ac(browser, 'editor', 'index.html', false);
		const metin = await page.evaluate(() => document.body.innerText);
		sonuc.editorAktivitesi = {
			yoneticiUyarisiYok: !metin.includes('yalnızca yönetici/kurucu'),
			etkinliklerYuklenemediYok: !metin.includes('Etkinlikler yüklenemedi'),
			hatasiz: hatalar.length === 0
		};
		await ctx.close();
	}

	// 2) Editör: Bildirimler sekmesi ve zil simgesi görünmemeli
	{
		const { page, ctx } = await ac(browser, 'editor', 'index.html', false);
		sonuc.bildirimGizli = await page.evaluate(() => {
			const gorunur = (el) => {
				if (!el) return false;
				for (let n = el; n && n !== document.body; n = n.parentElement) {
					if (n.hidden) return false;
					const cs = getComputedStyle(n);
					if (cs.display === 'none' || cs.visibility === 'hidden') return false;
				}
				return true;
			};
			const sekme = document.querySelector('.sidebar [data-nav-key="notifications"]');
			const zil = document.querySelector('.topbar-right a.tb-btn[href="bildirimler.html"]');
			return { sekmeGizli: !gorunur(sekme), zilGizli: !gorunur(zil) };
		});
		await ctx.close();
	}

	// 3) Admin: zil GÖRÜNMELİ (gizleme yalnızca editöre özel olmalı)
	{
		const { page, ctx } = await ac(browser, 'admin', 'index.html', true);
		sonuc.adminZil = await page.evaluate(() => {
			const zil = document.querySelector('.topbar-right a.tb-btn[href="bildirimler.html"]');
			return { zilGorunur: !!zil && !zil.hidden && getComputedStyle(zil).display !== 'none' };
		});
		await ctx.close();
	}

	// 4) Harita: etkinlikler yüklenmeli (oturum hazır olduktan sonra okunuyor)
	{
		const { page, ctx, hatalar } = await ac(browser, 'editor', 'harita.html', false);
		const metin = await page.evaluate(() => document.body.innerText);
		sonuc.harita = {
			hataMesajiYok: !metin.includes('Etkinlikler yüklenemedi'),
			hatasiz: hatalar.length === 0
		};
		await ctx.close();
	}

	// 5) Kayıt formu: Ad ve Soyad ayrı alanlar
	{
		const ctx = await browser.newContext();
		const page = await ctx.newPage();
		await page.route('**/firebasejs/**/*', (r) => r.fulfill({ body: '', contentType: 'application/javascript' }));
		await page.route('**://fonts.googleapis.com/**', (r) => r.fulfill({ body: '', contentType: 'text/css' }));
		await page.goto(`http://localhost:${PORT}/kayit-ol.html`, { waitUntil: 'load' });
		sonuc.kayitFormu = await page.evaluate(() => ({
			adAlaniVar: !!document.getElementById('firstName'),
			soyadAlaniVar: !!document.getElementById('lastName'),
			eskiTekAlanYok: !document.getElementById('name'),
			ikisiDeZorunlu: !!(document.getElementById('firstName') || {}).required && !!(document.getElementById('lastName') || {}).required
		}));
		await ctx.close();
	}

	console.log(JSON.stringify(sonuc, null, 2));
	const basarisiz = [];
	const gez = (o, on) => {
		for (const k in o) {
			const v = o[k]; const yol = on ? on + '.' + k : k;
			if (typeof v === 'boolean') { if (!v) basarisiz.push(yol); }
			else if (v && typeof v === 'object') gez(v, yol);
		}
	};
	gez(sonuc, '');
	console.log('ALL_TESTS_PASSED:', basarisiz.length === 0);
	if (basarisiz.length) console.log('BASARISIZ ALANLAR:', JSON.stringify(basarisiz));
	await browser.close();
	server.close();
	process.exitCode = basarisiz.length === 0 ? 0 : 1;
})();
