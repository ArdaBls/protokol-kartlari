// Basın Rehberi testi (basin-rehberi.html / press-directory.js).
//
// Kullanıcı isteği: rektörlükte basına haber geçerken kullanılan Samsun yerel
// basını listesi için bir telefon/e-posta rehberi -- tıkla-ara (tel: linki),
// takım genelinde PAYLAŞILAN yıldızlama, ve "Gizli Gönder" (seçilen kişilerin
// e-postalarını BCC'ye koyan mailto: linki -- alıcılar birbirini görmez,
// Outlook dahil varsayılan e-posta programını açar). Editör/admin/owner
// hepsi ekleyip düzenleyebilir.
const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');
const assert = require('node:assert/strict');

const TESTS_DIR = __dirname;
const SITE_ROOT = path.join(__dirname, '..', 'docs');
const PORT = 8984;

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

const CONTACTS = {
	c1: { ad: 'Ayşe Yılmaz', kurum: 'Samsun Haber', telefon: '0555 111 22 33', eposta: 'ayse@samsunhaber.test', yildizli: true },
	c2: { ad: 'Mehmet Kaya', kurum: 'Karadeniz Gazetesi', telefon: '0555 444 55 66', eposta: 'mehmet@karadeniz.test', yildizli: false },
	c3: { ad: 'Telefonsuz Kişi', kurum: '', eposta: '', yildizli: false }
};

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
	await page.addInitScript(({ rol, contacts }) => {
		window.__mockAuthUser = { uid: 'kUid', email: 'kullanici@test.com', emailVerified: true };
		const kendi = { firstName: 'Test', lastName: 'Kullanıcı', email: 'kullanici@test.com', role: rol };
		window.__mockUserProfile = kendi;
		window.__mockOnceSnapshot = kendi;
		window.__mockData = { users: { kUid: kendi }, basinRehberi: contacts };
	}, { rol, contacts: CONTACTS });
	await page.goto(`http://localhost:${PORT}/${hedef}`, { waitUntil: 'load', timeout: 30000 });
	await page.waitForTimeout(1500);
	return { page, ctx, hatalar };
}

(async () => {
	const server = await serve();
	const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
	const sonuc = {};

	// 1) Editör: sayfa hatasız yükleniyor, kişiler listeleniyor, yıldızlı önce geliyor.
	{
		const { page, ctx, hatalar } = await ac(browser, 'editor', 'basin-rehberi.html');
		const bilgi = await page.evaluate(() => {
			const rows = Array.from(document.querySelectorAll('.press-contact-row'));
			return {
				sayisi: rows.length,
				ilkYildizli: rows[0] ? rows[0].classList.contains('is-starred') : false,
				telHrefVar: !!document.querySelector('.press-contact-tel[href^="tel:"]'),
				telNumarasiTemiz: (document.querySelector('.press-contact-tel')?.getAttribute('href') || '').includes('0555'),
				telefonsuzCheckboxDisabled: Array.from(document.querySelectorAll('.press-contact-cb')).some((cb) => cb.disabled)
			};
		});
		sonuc.editorListesi = {
			ucKisiGorunuyor: bilgi.sayisi === 3,
			yildizliBasta: bilgi.ilkYildizli,
			telHrefVar: bilgi.telHrefVar,
			telSanitizeEdildi: bilgi.telNumarasiTemiz,
			epostasizCheckboxKapali: bilgi.telefonsuzCheckboxDisabled,
			hatasiz: hatalar.length === 0
		};
		await ctx.close();
	}

	// 2) Kişi seçilince "Gizli Gönder" çubuğu görünür, seçim sayısı doğru.
	{
		const { page, ctx } = await ac(browser, 'editor', 'basin-rehberi.html');
		await page.evaluate(() => {
			const cb = document.querySelector('.press-contact-cb:not([disabled])');
			cb.checked = true;
			cb.dispatchEvent(new Event('change', { bubbles: true }));
		});
		await page.waitForTimeout(200);
		const bar = await page.evaluate(() => {
			const el = document.querySelector('[data-press-send-bar]');
			return { gorunur: el && !el.hidden, metin: (document.querySelector('[data-press-selected-count]') || {}).textContent };
		});
		sonuc.secimCubugu = {
			gorunur: bar.gorunur === true,
			sayiDogru: /1 kişi/.test(bar.metin || '')
		};
		await ctx.close();
	}

	// 3) Yıldız butonuna basınca güncelleme isteği doğru yola gidiyor (mock update).
	{
		const { page, ctx } = await ac(browser, 'admin', 'basin-rehberi.html');
		await page.evaluate(() => {
			document.querySelector('[data-press-star="c2"]').click();
		});
		await page.waitForTimeout(200);
		const guncelleme = await page.evaluate(() => (window.__mockUpdates || []).find((u) => u.path === 'basinRehberi/c2'));
		sonuc.yildizGuncelleme = {
			yapildi: !!guncelleme,
			yildizliAlaniVar: !!(guncelleme && guncelleme.data && Object.prototype.hasOwnProperty.call(guncelleme.data, 'yildizli'))
		};
		await ctx.close();
	}

	// 4) parsePastedContacts -- Outlook formatındaki gerçek listede görülen tüm
	// biçim varyasyonlarını doğru ayrıştırmalı (kullanıcının kendi listesinden
	// türetilmiş sentetik örnekler -- gerçek liste burada saklanmıyor).
	{
		const source = fs.readFileSync(path.join(__dirname, '..', 'docs', 'admin-src', 'src', 'v4', 'press-directory.js'), 'utf8')
			.replace(/^import .*;\r?\n/gm, '')
			.replace(/export /g, '');
		const mod = new Function(source + '\nreturn { parsePastedContacts };')();
		const ornekMetin = [
			"'19 MAYIS GAZETESİ' <engizhaber@gmail.com>;",
			"'GAZETE GERÇEK (eski mail)' <gazetegercek@hotmail.com.tr>;",
			"'GAZETE GERÇEK' <gazetegercek@hotmail.com.tr>;", // aynı e-posta, "eski" etiketsiz olan tercih edilmeli
			"Kalem Medya Haber' <info@kalemmedyahaber.com>;", // eksik açılış tırnağı
			"'TEMPO FM' tempofm55@hotmail.com;", // köşeli parantez yok
			"<habereporter@gmail.com>;", // isim yok
			"'' <busonhaber@gmail.com>;" // boş isim
		].join('\n');
		const sonucParse = mod.parsePastedContacts(ornekMetin);
		const byEmail = Object.fromEntries(sonucParse.map((c) => [c.eposta, c.ad]));
		sonuc.pasteAyristirma = {
			tekilSayiDogru: sonucParse.length === 6, // 7 satır, 1 tekrar (gazetegercek aynı e-posta) tekilleşince 6 benzersiz kişi
			tirnakliIsimDogru: byEmail['engizhaber@gmail.com'] === '19 MAYIS GAZETESİ',
			eskiEtiketliOlanAtlandi: byEmail['gazetegercek@hotmail.com.tr'] === 'GAZETE GERÇEK',
			eksikTirnakDuzeltildi: byEmail['info@kalemmedyahaber.com'] === 'Kalem Medya Haber',
			koseliParantezsizDogru: byEmail['tempofm55@hotmail.com'] === 'TEMPO FM',
			isimsizEpostayaDusuyor: byEmail['habereporter@gmail.com'] === 'habereporter@gmail.com',
			bosIsimEpostayaDusuyor: byEmail['busonhaber@gmail.com'] === 'busonhaber@gmail.com',
			trailingAcikParantezKalmadi: !Object.values(byEmail).some((ad) => ad.includes('<') || ad.includes("'"))
		};
	}

	await browser.close();
	server.close();

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

	// Statik kaynak/kural kontrolleri (gantt-test.js ile aynı yaklaşım).
	const jsSource = fs.readFileSync(path.join(__dirname, '..', 'docs', 'admin-src', 'src', 'v4', 'press-directory.js'), 'utf8');
	assert.match(jsSource, /mailto:\?bcc=/, 'Gizli Gönder mailto:?bcc= linki oluşturmalı (alıcılar birbirini görmemeli)');
	assert.doesNotMatch(jsSource, /mailto:\?(to|cc)=/, 'Gizli Gönder to/cc DEĞİL, sadece bcc kullanmalı');

	const navSource = fs.readFileSync(path.join(__dirname, '..', 'docs', 'admin-src', 'src', 'v4', 'shell-render.js'), 'utf8');
	assert.match(navSource, /'press-directory'/, 'EDITOR_NAV_KEYS Basın Rehberi\'ni içermeli -- editör de erişebilmeli');
	assert.match(navSource, /key: 'press-directory'.*href: 'basin-rehberi\.html'/, 'NAV listesinde Basın Rehberi girdisi olmalı');

	const rulesPath = path.join(__dirname, '..', 'yerel-notlar', 'firebase-database-rules.json');
	if (fs.existsSync(rulesPath)) {
		const rules = JSON.parse(fs.readFileSync(rulesPath, 'utf8')).rules;
		if (!rules.basinRehberi) { basarisiz.push('yerelKurallar.basinRehberiEksik'); }
		else {
			if (!/editor/.test(rules.basinRehberi.$contactId['.write'])) { basarisiz.push('yerelKurallar.editorYazamiyor'); }
			if (!(rules.test && rules.test.basinRehberi)) { basarisiz.push('yerelKurallar.testDalindaYok'); }
		}
	}

	console.log('ALL_TESTS_PASSED:', basarisiz.length === 0);
	if (basarisiz.length) console.log('BASARISIZ ALANLAR:', JSON.stringify(basarisiz));
	process.exitCode = basarisiz.length === 0 ? 0 : 1;
})();
