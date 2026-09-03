// Onay kapısı testi.
//
// Kullanıcı isteği: "bir kişi yeni kullanıcı kaydı oluşturduğunda admin/kurucu
// onaylamadan siteye girebiliyor -- ben onay verene kadar siteyi görmesin,
// beklemeye düşsün, talebiniz alındı tarzı bir şey desin."
//
// Doğrulananlar:
//   1. role="pending"  -> panelin HİÇBİR sayfası görünmez, onay-bekliyor.html'e düşer
//   2. rolü hiç olmayan (bozuk/eksik kayıt) -> aynı şekilde beklemeye düşer
//   3. role="editor"   -> panele girer
//   4. role="admin"    -> panele girer
//   5. onay-bekliyor.html "Talebiniz alındı" metnini gösterir ve rol onaylanınca
//      kendiliğinden panele geçer (canlı rol dinleyicisi)
const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');

const TESTS_DIR = __dirname;
const SITE_ROOT = path.join(__dirname, '..', 'docs');
const PORT = 8979;

function serve() {
	const server = http.createServer((req, res) => {
		let p = decodeURIComponent(req.url.split('?')[0]);
		if (p === '/') p = '/index.html';
		const fp = path.join(SITE_ROOT, p);
		fs.readFile(fp, (err, data) => {
			if (err) { res.writeHead(404); res.end('not found: ' + p); return; }
			const ext = path.extname(fp);
			const type = ext === '.html' ? 'text/html' : ext === '.js' ? 'application/javascript'
				: ext === '.css' ? 'text/css' : ext === '.json' ? 'application/json' : 'text/plain';
			res.writeHead(200, { 'Content-Type': type });
			res.end(data);
		});
	});
	return new Promise((resolve) => server.listen(PORT, () => resolve(server)));
}

async function ac(browser, rol, hedef) {
	const ctx = await browser.newContext();
	const page = await ctx.newPage();
	const hatalar = [];
	page.on('pageerror', (e) => hatalar.push(e.message));
	await page.route('**/firebasejs/**/firebase-app-compat.js', (r) => r.fulfill({ path: path.join(TESTS_DIR, 'mock-firebase.js'), contentType: 'application/javascript' }));
	await page.route('**/firebasejs/**/firebase-database-compat.js', (r) => r.fulfill({ body: '', contentType: 'application/javascript' }));
	await page.route('**/firebasejs/**/firebase-auth-compat.js', (r) => r.fulfill({ body: '', contentType: 'application/javascript' }));
	await page.route('**Sortable.min.js', (r) => r.fulfill({ path: path.join(TESTS_DIR, 'mock-sortable.js'), contentType: 'application/javascript' }));
	await page.route('**://fonts.googleapis.com/**', (r) => r.fulfill({ body: '', contentType: 'text/css' }));
	await page.addInitScript(({ rol }) => {
		window.__mockAuthUser = { uid: 'testUid', email: 'yeni@test.com', emailVerified: true };
		const profil = { firstName: 'Yeni', lastName: 'Kayıt', email: 'yeni@test.com' };
		if (rol !== null) { profil.role = rol; }
		window.__mockUserProfile = profil;
		window.__mockOnceSnapshot = profil;
	}, { rol });
	await page.goto(`http://localhost:${PORT}/${hedef}`, { waitUntil: 'load', timeout: 30000 });
	await page.waitForTimeout(2000);
	return { page, ctx, hatalar };
}

(async () => {
	const server = await serve();
	const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
	const sonuc = {};

	// 1) pending -> beklemeye düşmeli
	{
		const { page, ctx, hatalar } = await ac(browser, 'pending', 'index.html');
		sonuc.pending = {
			url: page.url().split('/').pop(),
			beklemeyeDustu: /onay-bekliyor\.html/.test(page.url()),
			panelGormedi: (await page.$$('.sidebar .nav-link')).length === 0,
			hatasiz: hatalar.length === 0
		};
		await ctx.close();
	}

	// 2) rolü hiç olmayan kayıt -> yine beklemeye
	{
		const { page, ctx } = await ac(browser, null, 'index.html');
		sonuc.rolsuz = { beklemeyeDustu: /onay-bekliyor\.html/.test(page.url()) };
		await ctx.close();
	}

	// 3) pending kullanıcı Protokol Kartları'nı ELLE açmaya çalışırsa
	{
		const { page, ctx } = await ac(browser, 'pending', 'protokol.html');
		sonuc.pendingElleSayfaAcma = {
			beklemeyeDustu: /onay-bekliyor\.html/.test(page.url()),
			kartGormedi: (await page.$$('.grid .card')).length === 0
		};
		await ctx.close();
	}

	// 4) editor -> panele girer
	{
		const { page, ctx } = await ac(browser, 'editor', 'index.html');
		sonuc.editor = {
			panelde: /index\.html$/.test(page.url()) || page.url().endsWith('/index.html'),
			beklemedeDegil: !/onay-bekliyor/.test(page.url()),
			menuVar: (await page.$$('.sidebar .nav-link')).length > 0
		};
		await ctx.close();
	}

	// 5) admin -> panele girer
	{
		const { page, ctx } = await ac(browser, 'admin', 'index.html');
		sonuc.admin = {
			beklemedeDegil: !/onay-bekliyor/.test(page.url()),
			menuVar: (await page.$$('.sidebar .nav-link')).length > 0
		};
		await ctx.close();
	}

	// 6) Bekleme sayfasının metni + onaylanınca otomatik geçiş
	{
		const { page, ctx } = await ac(browser, 'pending', 'onay-bekliyor.html');
		const metin = await page.evaluate(() => document.body.innerText);
		sonuc.beklemeSayfasi = {
			talebinizAlindiYaziyor: metin.includes('Talebiniz alındı'),
			onayBekliyorAciklamasi: metin.includes('onayını bekliyor'),
			cikisButonuVar: !!(await page.$('#cikis'))
		};
		// Yönetici onayladı -> canlı dinleyici panele geçirmeli.
		await page.evaluate(() => {
			window.__mockUserProfile = { role: 'editor' };
			// mock'un on() dinleyicisi tek seferlik; __mockRefresh() kayıtlı tüm
			// dinleyicileri güncel değerle yeniden tetikler.
			window.__mockRefresh();
		});
		await page.waitForTimeout(1500);
		sonuc.beklemeSayfasi.onaylayincaGecti = !/onay-bekliyor/.test(page.url());
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
