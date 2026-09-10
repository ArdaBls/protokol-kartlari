const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');
// --- CI icin: sonuc nesnesindeki TUM boolean yapraklari gez, false olanlari
// (haric-listesi disinda) topla. Sayisal/metin alanlar bilerek atlanir -
// bu dosyalar zaten insan gozüyle okunmak icin JSON basiyor, bu fonksiyon
// sadece "hangi boolean beklenenden farkli" sorusuna otomatik cevap verir.
function collectBooleanFailures(obj, excludePaths, prefix) {
	excludePaths = excludePaths || []; prefix = prefix || '';
	let fails = [];
	if (obj && typeof obj === 'object') {
		for (const k in obj) {
			const p = prefix ? prefix + '.' + k : k;
			const v = obj[k];
			if (typeof v === 'boolean') {
				if (v === false && excludePaths.indexOf(p) === -1) fails.push(p);
			} else if (v && typeof v === 'object') {
				fails = fails.concat(collectBooleanFailures(v, excludePaths, p));
			}
		}
	}
	return fails;
}

const TESTS_DIR = __dirname;
const SITE_ROOT = path.join(__dirname, '..', 'docs'); // index.html repo kokunde, tests/ altinda degil
const PORT = 8961;
function serve() {
	const server = http.createServer((req, res) => {
		let p = decodeURIComponent(req.url.split('?')[0]);
		if (p === '/') p = '/index.html';
		const fp = path.join(SITE_ROOT, p);
		fs.readFile(fp, (err, data) => {
			if (err) { res.writeHead(404); res.end('not found'); return; }
			res.writeHead(200, { 'Content-Type': path.extname(fp) === '.html' ? 'text/html' : path.extname(fp) === '.css' ? 'text/css' : path.extname(fp) === '.js' ? 'application/javascript' : 'text/plain' });
			res.end(data);
		});
	});
	return new Promise((resolve) => server.listen(PORT, () => resolve(server)));
}
(async () => {
	const server = await serve();
	const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
	const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
	const pageErrors = [];
	page.on('pageerror', (e) => pageErrors.push(e.message));
	await page.route('**/firebasejs/**/firebase-app-compat.js', (route) => route.fulfill({ path: path.join(TESTS_DIR, 'mock-firebase.js'), contentType: 'application/javascript' }));
	await page.route('**/firebasejs/**/firebase-database-compat.js', (route) => route.fulfill({ body: '' }));
	await page.route('**/firebasejs/**/firebase-auth-compat.js', (route) => route.fulfill({ body: '' }));
	await page.route('**Sortable.min.js', (route) => route.fulfill({ path: path.join(TESTS_DIR, 'mock-sortable.js') }));
	await page.route('**://fonts.googleapis.com/**', (route) => route.fulfill({ body: '' }));
	await page.route('**://fonts.gstatic.com/**', (route) => route.abort());
	// protokol.html artık halka açık DEĞİL: eski bağımsız sayfa kaldırıldı, adı
	// panelin içindeki sayfaya geçti ve giriş ZORUNLU oldu (kullanıcı isteği).
	// app.js'in fonksiyonlarına erişebilmek için giriş yapmış bir kullanıcı şart;
	// aksi halde shell.js giris.html'e yönlendirir ve app.js hiç yüklenmez.
	await page.addInitScript(() => {
		window.__mockAuthUser = { uid: 'testUid', email: 'test@test.com', emailVerified: true };
		window.__mockUserProfile = { role: 'admin', firstName: 'Test', lastName: 'Kullanıcı' };
		if (window.__mockOnceSnapshot === undefined) {
			window.__mockOnceSnapshot = { role: 'admin', firstName: 'Test', lastName: 'Kullanıcı' };
		}
	});
	await page.goto(`http://localhost:${PORT}/protokol.html`, { waitUntil: 'load' });
	await page.waitForTimeout(300);

	// --- 1) pickVariant(): determinizm + kosul bazli atlama ---
	const pickVariantTest = await page.evaluate(() => {
		const variants = [
			{ text: "A" }, { text: "B" }, { text: "C" }
		];
		const r1 = pickVariant(variants, {}, "sabit-tohum");
		const r2 = pickVariant(variants, {}, "sabit-tohum");
		const r3 = pickVariant(variants, {}, "farkli-tohum-xyz");

		const condVariants = [
			{ text: "kosullu-var", condition: function(ctx){ return !!ctx.x; } },
			{ text: "kosulsuz" }
		];
		const withX = pickVariant(condVariants, { x: "deger" }, "seed1");
		const withoutX = pickVariant(condVariants, {}, "seed1");

		const allCondFail = [
			{ text: "hicbir-zaman-gorunmez", condition: function(ctx){ return !!ctx.hicOlmayacak; } }
		];
		const noneUsable = pickVariant(allCondFail, {}, "seed2");

		return {
			deterministic: r1 === r2,
			r1, r3,
			withXCanBeCondVariant: withX === "kosullu-var" || withX === "kosulsuz",
			withoutXNeverCondVariant: withoutX === "kosulsuz",
			noneUsableIsNull: noneUsable === null
		};
	});

	// --- 2) turkishDativeSuffix / turkishAccusativeSuffix dogruluk tablosu ---
	const suffixTest = await page.evaluate(() => {
		return {
			dat_AhmetYilmaz: turkishDativeSuffix("Ahmet Yılmaz"),          // "Ahmet Yılmaz'a" (arka unlu, unsuzla biter)
			dat_KadirKeleşoglu: turkishDativeSuffix("Kadir Keleşoğlu"),    // "Kadir Keleşoğlu'na" (iyelik -oglu -> n kaynastirma)
			dat_Baskanligi: turkishDativeSuffix("İdari ve Mali İşler Daire Başkanlığı"), // "...Başkanlığı'na"
			dat_Ankara: turkishDativeSuffix("Ankara"),                    // "Ankara'ya" (duz sozcuk, tek kelime -> y kaynastirma)
			dat_empty: turkishDativeSuffix(""),
			acc_NahitKöseoglu: turkishAccusativeSuffix("Nahit Köseoğlu"),  // "Nahit Köseoğlu'nu"
			acc_AhmetYilmaz: turkishAccusativeSuffix("Ahmet Yılmaz"),      // "Ahmet Yılmaz'ı"
			acc_empty: turkishAccusativeSuffix("")
		};
	});

	// (3 "EVENT_TYPES/evType", 4 "generateNewsFromEvent gorevdegisimi" ve 5
	// "generateNewsFromEvent ziyaret" testleri Etkinlik Takvimi modulune bagimliydi --
	// kullanici istegiyle o modul kaldirildiginda bu testler de silindi.)

	// --- 6) Mod gecisi + buildNewsPrompt() + XSS regresyon kontrolu ---
	await page.evaluate(() => { closeNewsModal(); });
	const promptTest = await page.evaluate(() => {
		setNewsOutputMode("prompt");
		const tplPanelHiddenAfterPrompt = document.getElementById("newsTemplateModePanel").style.display === "none";
		const promptPanelVisible = document.getElementById("newsPromptPanel").style.display !== "none";

		// Once bos notla dene: hata toast'i beklenir, cikti uretilmemeli.
		document.getElementById("newsRawInput").value = "";
		buildNewsPrompt();
		const emptyOutput = document.getElementById("newsPromptOutput").value;

		// XSS regresyonu: ham girdiye <script> iceren metin yapistirilinca ciktida HARFI HARFINE gorunmeli, hicbir sekilde calismamali.
		const xssPayload = '<script>window.__xssRan = true;</script> Deneme notu';
		document.getElementById("newsRawInput").value = xssPayload;
		newsEventContext = { etkinlik: "Test Etkinliği", yer: "Test Yeri", tarih: "11 Eylül 2026", birim: "" };
		buildNewsPrompt();
		const promptOutput = document.getElementById("newsPromptOutput").value;

		setNewsOutputMode("template");
		const tplPanelVisibleAfterTemplate = document.getElementById("newsTemplateModePanel").style.display !== "none";
		const promptPanelHiddenAfterTemplate = document.getElementById("newsPromptPanel").style.display === "none";

		return {
			tplPanelHiddenAfterPrompt, promptPanelVisible,
			emptyOutputStaysEmpty: emptyOutput === "",
			promptContainsRawText: promptOutput.indexOf(xssPayload) > -1,
			promptContainsRules: promptOutput.indexOf("KURALLAR:") > -1 && promptOutput.indexOf("uydurma") > -1,
			promptContainsContext: promptOutput.indexOf("Test Etkinliği") > -1 && promptOutput.indexOf("Test Yeri") > -1,
			xssDidNotExecute: window.__xssRan !== true,
			tplPanelVisibleAfterTemplate, promptPanelHiddenAfterTemplate
		};
	});

	// closeNewsModal() sonrasi prompt durumu gercekten sifirlaniyor mu (ayri bir evaluate: modal tekrar acilip kapatiliyor)
	const closeResetTest = await page.evaluate(() => {
		setNewsOutputMode("prompt");
		document.getElementById("newsRawInput").value = "silinmesi gereken metin";
		closeNewsModal();
		return {
			modeBackToTemplate: document.getElementById("newsTemplateModePanel").style.display !== "none",
			rawInputCleared: document.getElementById("newsRawInput").value === "",
			promptOutputCleared: document.getElementById("newsPromptOutput").value === ""
		};
	});

	const result = { pickVariantTest, suffixTest, promptTest, closeResetTest };
	console.log(JSON.stringify(result, null, 2));
	console.log('PAGE ERRORS:', pageErrors.length);
	pageErrors.forEach(e => console.log(' -', e));

	const __boolFails = collectBooleanFailures(result, []);
	const __allPassed = pageErrors.length === 0 && __boolFails.length === 0;
	console.log('ALL_TESTS_PASSED:', __allPassed);
	if (__boolFails.length) console.log('BASARISIZ ALANLAR:', JSON.stringify(__boolFails));

	await browser.close();
	server.close();
	process.exitCode = __allPassed ? 0 : 1;
})();
