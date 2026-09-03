// Onay bekleyen kayıt bildirimi testi.
//
// Kullanıcı isteği: "yeni kullanıcı onay bekliyor diye bana bildirim gelmeli --
// sağ üstteki bildirim butonundan ve uygulamalar kısmındaki bildirim yerinden;
// kişinin tüm bilgileri: ismi, hangi e-postayla, hangi saatte kayıt yapıp
// onay beklediği." Ayrıca: "Kullanıcı yönetimi kısmında onay bekleyen hesabı
// göremiyorum, hesabı onaylayamadım."
//
// Doğrulananlar:
//   1. Sağ üstteki zil butonunda onay bekleyen SAYISI rozet olarak çıkıyor
//   2. Bekleyen yokken rozet gizli
//   3. Editörde rozet hiç kurulmuyor (users/ listesi zaten ona kapalı)
//   4. Bildirimler sayfasında kayıt talebi; isim, e-posta ve saat ile listeleniyor
//   5. Kullanıcı yönetimi listesinde onay bekleyen kayıt görünüyor
const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');

const TESTS_DIR = __dirname;
const SITE_ROOT = path.join(__dirname, '..', 'docs');
const PORT = 8981;

// 26.08.2026 13:49 civarı sabit bir zaman -- saat gösterimi doğrulanabilsin.
const KAYIT_ZAMANI = new Date('2026-08-26T13:49:53').getTime();

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

async function ac(browser, rol, hedef, bekleyenVar) {
	const ctx = await browser.newContext();
	const page = await ctx.newPage();
	const hatalar = [];
	page.on('pageerror', (e) => hatalar.push(e.message));
	await page.route('**/firebasejs/**/firebase-app-compat.js', (r) => r.fulfill({ path: path.join(TESTS_DIR, 'mock-firebase.js'), contentType: 'application/javascript' }));
	await page.route('**/firebasejs/**/firebase-database-compat.js', (r) => r.fulfill({ body: '', contentType: 'application/javascript' }));
	await page.route('**/firebasejs/**/firebase-auth-compat.js', (r) => r.fulfill({ body: '', contentType: 'application/javascript' }));
	await page.route('**Sortable.min.js', (r) => r.fulfill({ path: path.join(TESTS_DIR, 'mock-sortable.js'), contentType: 'application/javascript' }));
	await page.route('**://fonts.googleapis.com/**', (r) => r.fulfill({ body: '', contentType: 'text/css' }));
	await page.addInitScript(({ rol, bekleyenVar, zaman }) => {
		window.__mockAuthUser = { uid: 'yoneticiUid', email: 'yonetici@test.com', emailVerified: true };
		const kendi = { firstName: 'Yönetici', lastName: 'Test', email: 'yonetici@test.com', role: rol };
		window.__mockUserProfile = kendi;
		window.__mockOnceSnapshot = kendi;
		const users = { yoneticiUid: kendi };
		if (bekleyenVar) {
			users.yeniUid = {
				firstName: 'Berk Can', lastName: 'Dereci',
				email: 'berkcand55@gmail.com', role: 'pending', createdAt: zaman
			};
		}
		window.__mockData = { users: users, logs: {} };
	}, { rol, bekleyenVar, zaman: KAYIT_ZAMANI });
	await page.goto(`http://localhost:${PORT}/${hedef}`, { waitUntil: 'load', timeout: 30000 });
	await page.waitForTimeout(2200);
	return { page, ctx, hatalar };
}

async function rozet(page) {
	return page.evaluate(() => {
		const el = document.getElementById('tb-onay-rozeti');
		if (!el) return { yok: true };
		return { gorunur: !el.hidden, sayi: el.textContent, baslik: (el.closest('.tb-btn') || {}).title };
	});
}

(async () => {
	const server = await serve();
	const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
	const sonuc = {};

	// 1) admin + bekleyen var -> rozet görünür ve 1 yazar
	{
		const { page, ctx, hatalar } = await ac(browser, 'admin', 'index.html', true);
		const r = await rozet(page);
		sonuc.adminRozet = {
			rozetVar: !r.yok,
			gorunuyor: r.gorunur === true,
			sayiDogru: r.sayi === '1',
			baslikBilgilendirici: /onay bekliyor/.test(r.baslik || ''),
			hatasiz: hatalar.length === 0
		};
		await ctx.close();
	}

	// 2) admin + bekleyen yok -> rozet gizli
	{
		const { page, ctx } = await ac(browser, 'admin', 'index.html', false);
		const r = await rozet(page);
		sonuc.bekleyenYok = { rozetGizli: r.gorunur === false };
		await ctx.close();
	}

	// 3) editör -> rozet hiç kurulmaz (gizli kalır)
	{
		const { page, ctx } = await ac(browser, 'editor', 'index.html', true);
		const r = await rozet(page);
		sonuc.editor = { rozetGizli: r.gorunur === false };
		await ctx.close();
	}

	// 4) Bildirimler sayfası -> isim + e-posta + saat
	{
		const { page, ctx, hatalar } = await ac(browser, 'admin', 'bildirimler.html', true);
		const metin = await page.evaluate(() => (document.getElementById('notif-list') || {}).innerText || '');
		sonuc.bildirimlerSayfasi = {
			isimVar: metin.includes('Berk Can Dereci'),
			epostaVar: metin.includes('berkcand55@gmail.com'),
			talepYazisiVar: metin.includes('Yeni kayıt talebi'),
			onayBekliyorYazisiVar: metin.includes('onay bekliyor'),
			saatVar: /26\.08\.2026/.test(metin),
			onaylaBaglantisiVar: await page.evaluate(() => !!document.querySelector('#notif-list a[href*="kullanici-yonetimi"]')),
			hatasiz: hatalar.length === 0
		};
		await ctx.close();
	}

	// 5) Kullanıcı yönetimi -> onay bekleyen listede
	{
		const { page, ctx, hatalar } = await ac(browser, 'admin', 'kullanici-yonetimi.html', true);
		const bilgi = await page.evaluate(() => ({
			tabloMetni: document.body.innerText,
			bekleyenSayaci: (document.getElementById('stat-pending') || {}).textContent
		}));
		sonuc.kullaniciYonetimi = {
			kayitListelendi: bilgi.tabloMetni.includes('berkcand55@gmail.com'),
			bekleyenSayaciDogru: bilgi.bekleyenSayaci === '1',
			hatasiz: hatalar.length === 0
		};
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
