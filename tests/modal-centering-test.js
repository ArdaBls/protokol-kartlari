const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');
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
const SITE_ROOT = path.join(__dirname, '..');
const PORT = 8972;
function serve() {
	const server = http.createServer((req, res) => {
		let p = decodeURIComponent(req.url.split('?')[0]);
		if (p === '/') p = '/index.html';
		const fp = path.join(SITE_ROOT, p);
		fs.readFile(fp, (err, data) => {
			if (err) { res.writeHead(404); res.end('not found'); return; }
			res.writeHead(200, { 'Content-Type': path.extname(fp) === '.html' ? 'text/html' : 'text/plain' });
			res.end(data);
		});
	});
	return new Promise((resolve) => server.listen(PORT, () => resolve(server)));
}

(async () => {
	const server = await serve();
	const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
	// iPhone 16 Pro mantıksal çözünürlük ~393x852, hasTouch:true
	const context = await browser.newContext({ viewport: { width: 393, height: 852 }, hasTouch: true, isMobile: true });
	const page = await context.newPage();
	const pageErrors = [];
	page.on('pageerror', (e) => pageErrors.push(e.message));
	await page.route('**/firebasejs/**/firebase-app-compat.js', (route) => route.fulfill({ path: path.join(TESTS_DIR, 'mock-firebase.js'), contentType: 'application/javascript' }));
	await page.route('**/firebasejs/**/firebase-database-compat.js', (route) => route.fulfill({ body: '' }));
	await page.route('**/firebasejs/**/firebase-auth-compat.js', (route) => route.fulfill({ body: '' }));
	await page.route('**Sortable.min.js', (route) => route.fulfill({ path: path.join(TESTS_DIR, 'mock-sortable.js') }));
	await page.route('**://fonts.googleapis.com/**', (route) => route.fulfill({ body: '' }));
	await page.route('**://fonts.gstatic.com/**', (route) => route.abort());
	await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });
	await page.waitForTimeout(300);

	await page.evaluate(() => {
		currentUser = { role: 'editor', firstName: 'Test', lastName: 'Kullanıcı', email: 'test@test.com' };
		applyPermissions();
	});

	async function checkModalCentering(openExpr, modalBgId) {
		await page.evaluate(openExpr);
		await page.waitForTimeout(250); // .modal-bg .open geçiş animasyonu
		return page.evaluate((id) => {
			const bg = document.getElementById(id);
			const modal = bg.querySelector('.modal');
			const alignItems = getComputedStyle(bg).alignItems;
			const r = modal.getBoundingClientRect();
			const topGap = r.top;
			const bottomGap = window.innerHeight - r.bottom;
			return { alignItems, topGap, bottomGap, viewportHeight: window.innerHeight, modalHeight: r.height };
		}, modalBgId);
	}

	const personModal = await checkModalCentering('openAddModal()', 'modalBg');
	await page.evaluate(() => closeModal());

	const eventModal = await checkModalCentering('openEventModal(null)', 'eventModalBg');
	await page.evaluate(() => closeEventModal());

	// Kısa bir içerik (onay penceresi) viewport'a rahat sığar -- GERÇEK ortalamayı (üst/alt boşluk
	// pozitif ve birbirine yakın) burada doğrulamak gerekiyor, oversized modallerde "safe" devreye
	// girip başa yaslıyor, o yüzden onlarda bu eşitlik aranmıyordu.
	const shortModal = await checkModalCentering("openEventDeleteConfirm('yok')", 'eventDeleteConfirmModalBg');
	await page.evaluate(() => closeEventDeleteConfirm());

	// env(safe-area-inset-top) headless Chromium'da (gerçek çentik/Dynamic Island olmadığı için)
	// hep 0 çözümlenir -- piksel bazlı ölçüm bu yüzden bunu KANITLAYAMAZ. Bunun yerine kaynak
	// CSS kuralının metnini okuyup env(safe-area-inset-top) ifadesinin gerçekten .modal-bg'ye
	// yazıldığını doğruluyoruz (gerçek çentikli cihazda tarayıcı bunu otomatik hesaba katacak).
	const safeAreaCssCheck = await page.evaluate(() => {
		for (const sheet of document.styleSheets) {
			try {
				for (const rule of sheet.cssRules) {
					if (rule.selectorText === '.modal-bg' && /env\(safe-area-inset-top/.test(rule.cssText)) return true;
				}
			} catch (e) { /* cross-origin stylesheet olabilir, atla */ }
		}
		return false;
	});

	// --- Ek kaynak-metin kontrolleri: --vh (iOS arac cubugu takibi) ve dokunma alani
	// genisletmesi (@media(pointer:coarse) icinde) -- bu ikisi de @media blogu icinde
	// oldugu icin duz sheet.cssRules taramasi yetmiyor, cssRules'u REKURSIF gezmek gerekiyor.
	const extraCssChecks = await page.evaluate(() => {
		function collectRuleTexts() {
			const texts = [];
			function walk(rules) {
				for (const rule of rules) {
					texts.push({ selector: rule.selectorText || '', text: rule.cssText || '' });
					if (rule.cssRules) walk(rule.cssRules);
				}
			}
			for (const sheet of document.styleSheets) {
				try { walk(sheet.cssRules); } catch (e) { /* cross-origin, atla */ }
			}
			return texts;
		}
		const all = collectRuleTexts();
		function ruleFor(selector) { return all.find((r) => r.selector === selector); }
		const authformBg = ruleFor('.authform-bg');
		const calOverlay = ruleFor('.cal-overlay');
		const loadingOverlay = ruleFor('.loading-overlay');
		const tapTargetPos = all.find((r) => r.selector && r.selector.indexOf('.header-auth .btn-auth') !== -1 && /position\s*:\s*relative/.test(r.text) && r.text.indexOf('::after') === -1);
		const tapTargetAfter = all.find((r) => r.selector && r.selector.indexOf('.header-auth .btn-auth::after') !== -1);
		return {
			authformBgHasVh: !!(authformBg && /height:\s*calc\(var\(--vh/.test(authformBg.text)),
			authformBgHasSafeAreaTop: !!(authformBg && /env\(safe-area-inset-top/.test(authformBg.text)),
			authformBgHasSafeAreaBottom: !!(authformBg && /env\(safe-area-inset-bottom/.test(authformBg.text)),
			calOverlayHasVh: !!(calOverlay && /height:\s*calc\(var\(--vh/.test(calOverlay.text)),
			loadingOverlayHasVh: !!(loadingOverlay && /height:\s*calc\(var\(--vh/.test(loadingOverlay.text)),
			headerAuthBtnHasRelative: !!tapTargetPos,
			headerAuthBtnHasTapExpansion: !!(tapTargetAfter && /inset:\s*-10px/.test(tapTargetAfter.text))
		};
	});

	const results = {
		personModal: {
			alignItemsIsCenter: personModal.alignItems === 'center' || personModal.alignItems === 'safe center',
			// Kısa içerikte üst/alt boşluk kabaca eşit olmalı (tam 0 olmayan bir tolerans:
			// modal-bg'nin kendi padding'i + tarayıcı yuvarlaması için 40px pay bırakıldı).
			roughlyCentered: Math.abs(personModal.topGap - personModal.bottomGap) < 40 || personModal.modalHeight > personModal.viewportHeight - 48,
			notPinnedToTop: personModal.topGap > 10
		},
		eventModal: {
			alignItemsIsCenter: eventModal.alignItems === 'center' || eventModal.alignItems === 'safe center',
			roughlyCentered: Math.abs(eventModal.topGap - eventModal.bottomGap) < 40 || eventModal.modalHeight > eventModal.viewportHeight - 48,
			notPinnedToTop: eventModal.topGap > 10
		},
		shortModal: {
			alignItemsIsCenter: shortModal.alignItems === 'center' || shortModal.alignItems === 'safe center',
			trulyCentered: Math.abs(shortModal.topGap - shortModal.bottomGap) < 20,
			bothGapsPositive: shortModal.topGap > 0 && shortModal.bottomGap > 0
		},
		safeAreaInsetTopInCss: safeAreaCssCheck,
		extraCssChecks,
		pageErrorsCount: pageErrors.length
	};
	console.log(JSON.stringify({ personModal, eventModal, shortModal, results }, null, 2));
	if (pageErrors.length) { console.log('PAGE ERRORS:'); pageErrors.forEach((e) => console.log(' - ' + e)); }

	const __boolFails = collectBooleanFailures(results, []);
	const __allPassed = pageErrors.length === 0 && __boolFails.length === 0;
	console.log('ALL_TESTS_PASSED:', __allPassed);
	if (__boolFails.length) console.log('BASARISIZ ALANLAR:', JSON.stringify(__boolFails));

	await browser.close();
	server.close();
	process.exitCode = __allPassed ? 0 : 1;
})();
