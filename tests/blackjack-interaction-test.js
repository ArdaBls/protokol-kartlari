// Gerçek ekran koordinatlarıyla Blackjack kontrolleri. locator.click otomatik
// kaydırarak ekran dışında kalan düğmeleri gizleyebildiğinden burada kullanılmaz.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const path = require('node:path');
const http = require('node:http');
const fs = require('node:fs/promises');

const siteRoot = path.join(__dirname, '..', 'docs');

function initialState() {
	const cards = [{ r: '4', s: 'kupa' }, { r: '5', s: 'maca' }];
	return {
		durum: 'oyunculuk', elNo: 7, guncellemeTs: Date.now(),
		aktifKoltuk: 2, aksiyonSuresiBitis: Date.now() + 60000,
		koltuklar: { 2: { uid: 'oyuncu1', isim: 'Test Oyuncu', bahis: 100, katilimDurumu: 'hazir', eller: [{ kartlar: cards, bahisMiktari: 100, durum: 'oynuyor' }] } },
		kurpiyerEli: { kartlar: [{ r: '7', s: 'kupa' }, { r: '10', s: 'maca' }], acikMi: false },
		deste: [{ r: '2', s: 'karo' }, { r: '3', s: 'sinek' }], desteIndex: 0
	};
}

async function controls(page) {
	return page.evaluate(() => Array.from(document.querySelectorAll('[data-bj-aksiyonlar] button')).map((button) => {
		const rect = button.getBoundingClientRect();
		const x = rect.x + rect.width / 2;
		const y = rect.y + rect.height / 2;
		return { label: button.textContent, x, y, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height,
			inViewport: rect.top >= 0 && rect.left >= 0 && rect.bottom <= innerHeight && rect.right <= innerWidth,
			hit: button.contains(document.elementFromPoint(x, y)) };
	}));
}

(async () => {
	const server = http.createServer(async (req, res) => {
		try {
			const filename = path.join(siteRoot, decodeURIComponent(req.url.split('?')[0]));
			const content = await fs.readFile(filename);
			const type = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png' }[path.extname(filename)] || 'application/octet-stream';
			res.writeHead(200, { 'Content-Type': type }); res.end(content);
		} catch { res.writeHead(404); res.end('not found'); }
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	let browser;
	const reports = [];
	try {
		browser = await chromium.launch({ headless: true });
		for (const device of [{ name: 'desktop', width: 1366, height: 768, touch: false }, { name: 'mobile', width: 390, height: 844, touch: true }, { name: 'small-mobile', width: 375, height: 667, touch: true }]) {
			const context = await browser.newContext({ viewport: { width: device.width, height: device.height }, hasTouch: device.touch, isMobile: device.touch });
			const page = await context.newPage();
			const errors = [];
			page.on('pageerror', (error) => errors.push(error.message));
			await page.route('**/firebasejs/**/firebase-app-compat.js', (route) => route.fulfill({ path: path.join(__dirname, 'mock-firebase.js'), contentType: 'application/javascript' }));
			await page.route('**/firebasejs/**/firebase-database-compat.js', (route) => route.fulfill({ body: '' }));
			await page.route('**/firebasejs/**/firebase-auth-compat.js', (route) => route.fulfill({ body: '' }));
			await page.route('**://fonts.googleapis.com/**', (route) => route.fulfill({ body: '' }));
			await page.route('**://fonts.gstatic.com/**', (route) => route.abort());
			await page.addInitScript((table) => {
				window.__mockAuthUser = { uid: 'oyuncu1', email: 'oyuncu1@test.com' };
				window.__mockOnceSnapshot = { role: 'editor', firstName: 'Test', lastName: 'Oyuncu' };
				window.__mockUserProfile = window.__mockOnceSnapshot;
				window.__mockLiveState = { oyunBasarimlari: { blackjack: { masalar: { 'ana-masa': table } } }, cipBakiyeleri: { oyuncu1: 900 } };
			}, initialState());
			await page.goto('http://127.0.0.1:' + server.address().port + '/oyun-blackjack.html', { waitUntil: 'networkidle' });
			await page.waitForSelector('[data-bj-kartcek]', { timeout: 6000 });
			const initial = await controls(page);
			const layout = await page.evaluate(() => {
				const table = document.querySelector('[data-bj-root]').getBoundingClientRect();
				const actions = document.querySelector('.bj-aksiyonlar-satiri');
				const rect = actions.getBoundingClientRect();
				const style = getComputedStyle(actions);
				return { centered: Math.abs((rect.left + rect.width / 2) - (table.left + table.width / 2)) < 1, background: style.backgroundColor, border: style.borderTopWidth, shadow: style.boxShadow };
			});
			assert(layout.centered, 'Kontroller masanın yatay merkezinde olmalı');
			assert.equal(layout.background, 'rgba(0, 0, 0, 0)');
			assert.equal(layout.border, '0px');
			assert.equal(layout.shadow, 'none');
			const avatarGeometry = await page.evaluate(() => {
				const ring = document.querySelector('.bj-koltuk-ben .bj-avatar-cember');
				return ['', 'bj-cember-kazandi', 'bj-cember-kaybetti'].every((color) => {
					if (color) ring.classList.add(color);
					const outer = ring.getBoundingClientRect();
					const inner = ring.firstElementChild.getBoundingClientRect();
					if (color) ring.classList.remove(color);
					return Math.abs(outer.width - outer.height) < 0.5 && Math.abs(inner.width - inner.height) < 0.5 &&
						Math.abs(outer.left + outer.width / 2 - inner.left - inner.width / 2) < 0.5 &&
						Math.abs(outer.top + outer.height / 2 - inner.top - inner.height / 2) < 0.5;
				});
			});
			assert(avatarGeometry, 'Avatar ve sonuç halkaları eş merkezli tam daire olmalı');
			const report = { device: device.name, initial, errors };
			reports.push(report);
			// Ölçümden sonra ayrıca hover davranışını incele. İlk ölçümün başarısızlığı
			// saklanır; sonraki elle kaydırma ilk-ekran gereksinimini geçmiş sayılmaz.
			if (!initial.every((button) => button.inViewport)) {
				await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
			}
			await page.evaluate(() => {
				window.__interactionReplacements = 0;
				new MutationObserver((events) => { window.__interactionReplacements += events.filter((event) => event.type === 'childList').length; }).observe(document.querySelector('[data-bj-aksiyonlar]'), { childList: true, subtree: true });
			});
			const beforeHover = await controls(page);
			const hitButton = beforeHover.find((button) => button.label === 'Kart Çek');
			await page.mouse.move(hitButton.x, hitButton.y);
			await page.waitForTimeout(1200);
			report.afterHover = await controls(page);
			report.hoverReplacements = await page.evaluate(() => window.__interactionReplacements);
			const screenshots = path.join(__dirname, '..', '.impeccable');
			await fs.mkdir(screenshots, { recursive: true });
			await page.screenshot({ path: path.join(screenshots, 'blackjack-' + device.name + '.png') });
			const hit = report.afterHover.find((button) => button.label === 'Kart Çek');
			if (hit.hit && hit.inViewport) {
				if (device.touch) { await page.touchscreen.tap(hit.x, hit.y); } else { await page.mouse.click(hit.x, hit.y); }
				await page.waitForTimeout(200);
				report.hitCardCount = await page.evaluate(() => window.__mockLiveState.oyunBasarimlari.blackjack.masalar['ana-masa'].koltuklar[2].eller[0].kartlar.length);
				const stand = (await controls(page)).find((button) => button.label === 'Kal');
				if (stand && stand.inViewport && stand.hit) {
					if (device.touch) { await page.touchscreen.tap(stand.x, stand.y); } else { await page.mouse.click(stand.x, stand.y); }
					await page.waitForTimeout(1400);
					report.standFinished = await page.evaluate(() => window.__mockLiveState.oyunBasarimlari.blackjack.masalar['ana-masa'].durum === 'el_sonucu');
				}
			}
			await context.close();
		}
		console.log(JSON.stringify(reports, null, 2));
		for (const report of reports) {
			assert(report.initial.every((button) => button.inViewport && button.hit), report.device + ': kontroller kaydırmadan erişilebilir olmalı');
			assert.equal(report.hoverReplacements, 0, report.device + ': hover sırasında düğümler korunmalı');
			assert.equal(report.hitCardCount, 3, report.device + ': koordinat tıklaması bir kart çekmeli');
			assert.equal(report.standFinished, true, report.device + ': koordinat tıklaması eli bitirmeli');
			assert.deepEqual(report.errors, [], report.device + ': JavaScript hatası olmamalı');
		}
		console.log('ALL_TESTS_PASSED: true');
	} finally {
		if (browser) await browser.close();
		await new Promise((resolve) => server.close(resolve));
	}
})().catch((error) => { console.error(error); process.exitCode = 1; });
