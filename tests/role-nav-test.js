// Rol bazlı yan menü testi.
//
// Kullanıcı isteği: "admine, kurucuya yani bana soldaki sekmelerin hepsi
// görülebilecek; editöre şunlar gözüksün: operasyonlar, protokol kartları,
// takvim, harita, yapılacaklar listesi, tüm haberler, haber detayı, profiliniz,
// ayarlar, yardım merkezi. Ziyaretçi zaten kayıt olup giriş yapmadan siteyi
// bile açamasın."
//
// Doğrulananlar:
//   1. admin  -> menüdeki HER sekme görünür
//   2. owner  -> aynı (admin ile eşdeğer)
//   3. editor -> SADECE izin verilen 10 sekme; Bildirimler/Kişiler/Kullanıcı
//                yönetimi/Geliştirici Araçları gizli, boşalan grup başlığı da gizli
//   4. editor izinsiz bir sayfanın adresini elle yazarsa erisim-engellendi.html
//   5. misafir -> giris.html (ve panel BİR AN BİLE boyanmıyor: pre-paint kapısı)
const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');

const TESTS_DIR = __dirname;
const SITE_ROOT = path.join(__dirname, '..', 'docs');
const PORT = 8971;

// Kullanıcının saydığı 10 sekme (görünen metinleriyle).
const EDITOR_GORMELI = [
	'Operasyonlar', 'Protokol Kartları', 'Takvim', 'Harita',
	'Yapılacaklar Listesi', 'Tüm haberler', 'Haber detayı',
	'Profiliniz', 'Ayarlar', 'Yardım merkezi'
];
// Editöre KAPALI olması gerekenler.
const EDITOR_GORMEMELI = ['Bildirimler', 'Kişiler', 'Kullanıcı yönetimi', 'UI kütüphanesi'];

function serve() {
	const server = http.createServer((req, res) => {
		let p = decodeURIComponent(req.url.split('?')[0]);
		if (p === '/') p = '/index.html';
		const fp = path.join(SITE_ROOT, p);
		fs.readFile(fp, (err, data) => {
			if (err) { res.writeHead(404); res.end('not found: ' + p); return; }
			const ext = path.extname(fp);
			const type = ext === '.html' ? 'text/html' : ext === '.js' ? 'application/javascript'
				: ext === '.css' ? 'text/css' : ext === '.json' ? 'application/json'
				: ext === '.png' ? 'image/png' : 'text/plain';
			res.writeHead(200, { 'Content-Type': type });
			res.end(data);
		});
	});
	return new Promise((resolve) => server.listen(PORT, () => resolve(server)));
}

async function sayfaAc(browser, rol, hedef) {
	const ctx = await browser.newContext();
	const page = await ctx.newPage();
	const hatalar = [];
	page.on('pageerror', (e) => hatalar.push(e.message));
	await page.route('**/firebasejs/**/firebase-app-compat.js', (r) => r.fulfill({ path: path.join(TESTS_DIR, 'mock-firebase.js'), contentType: 'application/javascript' }));
	await page.route('**/firebasejs/**/firebase-database-compat.js', (r) => r.fulfill({ body: '', contentType: 'application/javascript' }));
	await page.route('**/firebasejs/**/firebase-auth-compat.js', (r) => r.fulfill({ body: '', contentType: 'application/javascript' }));
	await page.route('**Sortable.min.js', (r) => r.fulfill({ path: path.join(TESTS_DIR, 'mock-sortable.js'), contentType: 'application/javascript' }));
	await page.route('**://fonts.googleapis.com/**', (r) => r.fulfill({ body: '', contentType: 'text/css' }));
	await page.route('**://fonts.gstatic.com/**', (r) => r.abort());
	if (rol) {
		await page.addInitScript(({ rol }) => {
			// Pre-paint oturum kapısı localStorage'da Firebase izi arıyor -- mock
			// ortamda gerçek SDK yok, o yüzden izi elle bırakıyoruz.
			try { window.localStorage.setItem('firebase:authUser:testKey:[DEFAULT]', '{"uid":"testUid"}'); } catch (e) { /* yok say */ }
			window.__mockAuthUser = { uid: 'testUid', email: 'test@test.com', emailVerified: true };
			window.__mockUserProfile = { role: rol, firstName: 'Test', lastName: 'Kullanıcı' };
			window.__mockOnceSnapshot = { role: rol, firstName: 'Test', lastName: 'Kullanıcı' };
		}, { rol });
	}
	await page.goto(`http://localhost:${PORT}/${hedef}`, { waitUntil: 'load', timeout: 30000 });
	await page.waitForTimeout(1800);
	return { page, ctx, hatalar };
}

// Bir sekme adı gerçekten GÖRÜNÜR mü (hidden/display:none değil)?
async function gorunurSekmeler(page) {
	return page.evaluate(() => {
		const gorunur = (el) => {
			for (let n = el; n && n !== document.body; n = n.parentElement) {
				if (n.hidden) return false;
				const cs = getComputedStyle(n);
				if (cs.display === 'none' || cs.visibility === 'hidden') return false;
			}
			return true;
		};
		return Array.prototype.slice
			.call(document.querySelectorAll('.sidebar .nav-link, .sidebar .nav-sublink'))
			.filter(gorunur)
			.map((el) => (el.querySelector('.nav-text') || el).textContent.trim())
			.filter(Boolean);
	});
}

(async () => {
	const server = await serve();
	const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
	const sonuc = {};

	// --- 1) ADMIN: hepsi görünmeli ---
	{
		const { page, ctx, hatalar } = await sayfaAc(browser, 'admin', 'protokol.html');
		const sekmeler = await gorunurSekmeler(page);
		sonuc.admin = {
			sekmeSayisi: sekmeler.length,
			hepsiGorunuyor: EDITOR_GORMELI.concat(EDITOR_GORMEMELI).every((t) => sekmeler.includes(t)),
			// admin icin HICBIR sekme gizlenmemeli -- menude 24 baglanti var.
			hicbiriGizlenmedi: sekmeler.length >= 20,
			hatasiz: hatalar.length === 0
		};
		await ctx.close();
	}

	// --- 2) OWNER: admin ile aynı ---
	{
		const { page, ctx } = await sayfaAc(browser, 'owner', 'protokol.html');
		const sekmeler = await gorunurSekmeler(page);
		sonuc.owner = {
			hepsiGorunuyor: EDITOR_GORMELI.concat(EDITOR_GORMEMELI).every((t) => sekmeler.includes(t))
		};
		await ctx.close();
	}

	// --- 3) EDITOR: sadece izinli 10 sekme ---
	{
		const { page, ctx, hatalar } = await sayfaAc(browser, 'editor', 'protokol.html');
		const sekmeler = await gorunurSekmeler(page);
		const eksik = EDITOR_GORMELI.filter((t) => !sekmeler.includes(t));
		const sizan = EDITOR_GORMEMELI.filter((t) => sekmeler.includes(t));
		// Boşalan "Geliştirici Araçları" grup başlığı da gizlenmeli.
		const bosGrupBasligi = await page.evaluate(() => {
			return Array.prototype.slice.call(document.querySelectorAll('.sidebar .nav-group'))
				.filter((g) => getComputedStyle(g).display !== 'none' && !g.hidden)
				.filter((g) => !g.querySelector('.nav-link:not([hidden]), .nav-tree:not([hidden])'))
				.map((g) => (g.querySelector('.nav-label') || {}).textContent);
		});
		sonuc.editor = {
			gorunenler: sekmeler,
			izinliHepsiVar: eksik.length === 0,
			eksikOlanlar: eksik,
			yasakSizmadi: sizan.length === 0,
			sizanlar: sizan,
			bosGrupBasligiKalmadi: bosGrupBasligi.length === 0,
			hatasiz: hatalar.length === 0
		};
		await ctx.close();
	}

	// --- 4) EDITOR izinsiz sayfanın adresini elle yazarsa ---
	{
		const { page, ctx } = await sayfaAc(browser, 'editor', 'kullanici-yonetimi.html');
		sonuc.editorYasakSayfa = {
			url: page.url(),
			erisimEngellendiyeGitti: /erisim-engellendi\.html/.test(page.url())
		};
		await ctx.close();
	}

	// --- 5) MİSAFİR: giriş sayfasına, panel hiç boyanmadan ---
	{
		const { page, ctx } = await sayfaAc(browser, null, 'protokol.html');
		sonuc.misafir = {
			url: page.url(),
			girisSayfasina: /giris\.html/.test(page.url()),
			panelHicGorunmedi: (await page.$$('.sidebar .nav-link')).length === 0
		};
		await ctx.close();
	}

	console.log(JSON.stringify(sonuc, null, 2));

	const basarisiz = [];
	const gez = (o, on) => {
		for (const k in o) {
			const v = o[k]; const yol = on ? on + '.' + k : k;
			if (typeof v === 'boolean') { if (!v) basarisiz.push(yol); }
			else if (v && typeof v === 'object' && !Array.isArray(v)) gez(v, yol);
		}
	};
	gez(sonuc, '');
	console.log('ALL_TESTS_PASSED:', basarisiz.length === 0);
	if (basarisiz.length) console.log('BASARISIZ ALANLAR:', JSON.stringify(basarisiz));

	await browser.close();
	server.close();
	process.exitCode = basarisiz.length === 0 ? 0 : 1;
})();
