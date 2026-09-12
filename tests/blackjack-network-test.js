// Firebase test çiftine gecikmeli onay ve izin reddi ekler. Canlı servise
// bağlanmaz; ekranın tahmini sonuçla değişmediğini ve reddin döngü yaratmadığını sınar.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const tablePath = 'oyunBasarimlari/blackjack/masalar/ana-masa';
const site = path.join(__dirname, '..', 'docs');

function delayedServer() {
	const originalDatabase = firebase.database;
	window.__network = { attempts: [], denied: false, delay: 180, active: 0, maxActive: 0 };
	firebase.database = Object.assign(function () {
		const db = originalDatabase();
		const originalRef = db.ref;
		db.ref = function (path) {
			const ref = originalRef(path);
			const originalTransaction = ref.transaction;
			if (path === 'oyunBasarimlari/blackjack/masalar/ana-masa') {
				ref.transaction = (update, complete, applyLocally) => {
					const net = window.__network;
					net.attempts.push({ applyLocally, phase: window.__mockLiveState.oyunBasarimlari.blackjack.masalar['ana-masa'].durum });
					net.active++;
					net.maxActive = Math.max(net.maxActive, net.active);
					return new Promise((resolve, reject) => setTimeout(() => {
						if (net.denied) { reject(Object.assign(new Error('permission_denied'), { code: 'PERMISSION_DENIED' })); return; }
						originalTransaction((value) => {
							const next = update(JSON.parse(JSON.stringify(value)));
							const allowed = { bahis_bekleniyor: ['oyunculuk', 'kurpiyer_sirasi'], oyunculuk: ['kurpiyer_sirasi'], kurpiyer_sirasi: ['el_sonucu'], el_sonucu: ['bahis_bekleniyor'] };
							if (next && next.durum !== value.durum && !(allowed[value.durum] || []).includes(next.durum)) { throw new Error('Atlanan oyun aşaması'); }
							return next;
						}).then(resolve, reject);
					}, net.delay)).finally(() => { net.active--; });
				};
			}
			return ref;
		};
		return db;
	}, originalDatabase);
}

function table(pair = false) {
	return {
		durum: 'oyunculuk', elNo: 7, guncellemeTs: Date.now(), aktifKoltuk: 2, aksiyonSuresiBitis: Date.now() + 60000,
		koltuklar: { 2: { uid: 'oyuncu1', isim: 'Test Oyuncu', bahis: 100, katilimDurumu: 'hazir', eller: [{ kartlar: [{ r: '4', s: 'kupa' }, { r: pair ? '4' : '5', s: 'maca' }], bahisMiktari: 100, durum: 'oynuyor' }] } },
		kurpiyerEli: { kartlar: [{ r: '7', s: 'kupa' }, { r: '10', s: 'maca' }], acikMi: false },
		deste: [{ r: '2', s: 'karo' }, { r: '3', s: 'sinek' }, { r: '5', s: 'kupa' }], desteIndex: 0
	};
}

(async () => {
	const mock = await fs.readFile(path.join(__dirname, 'mock-firebase.js'), 'utf8');
	const server = http.createServer(async (req, res) => {
		try {
			const filename = path.join(site, decodeURIComponent(req.url.split('?')[0]));
			const content = await fs.readFile(filename);
			res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png' })[path.extname(filename)] || 'application/octet-stream');
			res.end(content);
		} catch { res.writeHead(404); res.end(); }
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	let browser;
	try {
		browser = await chromium.launch();
		for (const scenario of ['hit-stand', 'denied-timeout', 'double', 'split', 'solo-timeout', 'refund-deal', 'zero-chips']) {
			if (process.argv.length > 2 && !process.argv.slice(2).includes(scenario)) { continue; }
			const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
			const errors = [];
			page.on('pageerror', (error) => errors.push(error.message));
			await page.route('**/firebasejs/**/firebase-app-compat.js', (route) => route.fulfill({ body: mock + '\n(' + delayedServer.toString() + ')();', contentType: 'application/javascript' }));
			await page.route('**/firebasejs/**/firebase-database-compat.js', (route) => route.fulfill({ body: '' }));
			await page.route('**/firebasejs/**/firebase-auth-compat.js', (route) => route.fulfill({ body: '' }));
			await page.route('**://fonts.googleapis.com/**', (route) => route.fulfill({ body: '' }));
			await page.route('**://fonts.gstatic.com/**', (route) => route.abort());
			const initialTable = table(scenario === 'split');
			const betting = scenario === 'refund-deal' || scenario === 'zero-chips';
			if (betting) {
				initialTable.durum = 'bahis_bekleniyor';
				initialTable.bahisSuresiBitis = Date.now() + 60000;
				initialTable.aktifKoltuk = null;
				initialTable.kurpiyerEli = null;
				initialTable.koltuklar[2].eller = null;
				initialTable.deste = ['7', '4', '10', '5', ...Array(40).fill('2')].map((r) => ({ r, s: 'kupa' }));
				if (scenario === 'zero-chips') {
					initialTable.koltuklar[2].bahis = null;
					initialTable.koltuklar[0] = { uid: 'oyuncu2', isim: 'Diğer', bahis: 100, katilimDurumu: 'hazir' };
				}
			}
			if (scenario === 'denied-timeout') {
				initialTable.koltuklar[0] = { uid: 'oyuncu2', isim: 'Diğer', bahis: 100, katilimDurumu: 'hazir', eller: [{ kartlar: [{ r: '10', s: 'kupa' }, { r: '8', s: 'kupa' }], bahisMiktari: 100, durum: 'kaldi' }] };
			}
			await page.addInitScript((state) => {
				window.__mockAuthUser = { uid: 'oyuncu1', email: 'test@example.com' };
				window.__mockUserProfile = window.__mockOnceSnapshot = { role: 'editor', firstName: 'Test', lastName: 'Oyuncu' };
				window.__mockLiveState = { oyunBasarimlari: { blackjack: { masalar: { 'ana-masa': state } } }, cipBakiyeleri: { oyuncu1: { bakiye: 900, sonIslemId: 'seed', islemler: {} } } };
			}, initialTable);
			if (scenario === 'zero-chips') {
				await page.addInitScript(() => { window.__mockLiveState.cipBakiyeleri.oyuncu1.bakiye = 0; });
			}
			await page.goto('http://127.0.0.1:' + server.address().port + '/oyun-blackjack.html', { waitUntil: 'networkidle' });
			if (betting) {
				await page.waitForSelector('[data-bj-bahis-panel] .bj-bahis-panel-oyuncu');
				assert.equal(await page.locator('.bj-bahis-panel-baslik').count(), 0);
				if (scenario === 'refund-deal') {
					for (const viewport of [{ width: 375, height: 667 }, { width: 1366, height: 768 }]) {
						await page.setViewportSize(viewport);
						await page.waitForTimeout(400); // Kabuk resize debounce ve sidebar geçişini tamamlasın.
						const bareSurfaces = await page.locator('[data-bj-bahis-panel]').evaluate((panel) => {
							return [panel, ...panel.querySelectorAll('.bj-cip-btn')].every((element) => {
								const style = getComputedStyle(element);
								return style.backgroundColor === 'rgba(0, 0, 0, 0)' && style.backgroundImage === 'none' && style.borderTopWidth === '0px' && style.boxShadow === 'none';
							});
						});
						assert(bareSurfaces, 'Bahis paneli ve çiplerde zemin, kutu veya gölge olmamalı');
						const panelLayout = await page.locator('[data-bj-bahis-panel]').evaluate((panel) => {
							const rect = panel.getBoundingClientRect();
							const table = document.querySelector('[data-bj-root]').getBoundingClientRect();
							return { centered: Math.abs(rect.left + rect.width / 2 - table.left - table.width / 2) < 1, buttons: Array.from(panel.querySelectorAll('button')).map((b) => {
								const r = b.getBoundingClientRect();
								return { label: b.textContent, height: r.height, bottom: r.bottom, visible: r.bottom <= innerHeight && r.top >= 0, hit: b.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)) };
							}) };
						});
						await fs.mkdir(path.join(site, '..', '.impeccable'), { recursive: true });
						await page.screenshot({ path: path.join(site, '..', '.impeccable', 'blackjack-betting-' + viewport.width + '.png') });
						assert(panelLayout.centered && panelLayout.buttons.every((b) => b.height >= 44 && b.visible && b.hit), JSON.stringify(panelLayout));
					}
				}
				if (scenario === 'refund-deal') {
					await page.locator('[data-bj-bahis-panel] [data-bj-bahis-iade]').evaluate((button) => { button.click(); button.click(); });
					await page.waitForFunction(() => window.__mockLiveState.cipBakiyeleri.oyuncu1.bakiye === 1000);
					assert.equal(await page.locator('[data-bj-bahis-iade]').count(), 0);
					assert.equal(await page.evaluate(() => Object.values(window.__mockLiveState.cipBakiyeleri.oyuncu1.islemler).filter((x) => x.kaynak === 'iade').length), 1, 'Çift tıklama bir iade oluşturmalı');
					await page.click('[data-bj-bahis][data-miktar="1000"]');
					await page.waitForFunction(() => window.__mockLiveState.oyunBasarimlari.blackjack.masalar['ana-masa'].koltuklar[2].bahis === 1000);
					assert.equal(await page.evaluate(() => window.__mockLiveState.cipBakiyeleri.oyuncu1.bakiye), 0);
				} else {
					assert.equal(await page.locator('[data-bj-bahis]').count(), 0);
					assert((await page.locator('[data-bj-bahis-panel]').textContent()).includes('pas geçiyorsunuz'));
				}
				await page.evaluate(() => {
					window.__dealFrames = [];
					new MutationObserver(() => {
						const dealer = document.querySelectorAll('[data-bj-krupiyer] .bj-kart').length;
						const player = document.querySelectorAll('.bj-koltuk-ben .bj-kart').length;
						const actions = document.querySelectorAll('[data-bj-aksiyonlar] button').length;
						const frame = [dealer, player, actions > 0];
						if (dealer && JSON.stringify(frame) !== JSON.stringify(window.__dealFrames.at(-1))) { window.__dealFrames.push(frame); }
					}).observe(document.querySelector('[data-bj-root]'), { childList: true, subtree: true });
				});
				await page.evaluate((path) => firebase.database().ref(path + '/bahisSuresiBitis').set(Date.now() - 100), tablePath);
				if (scenario === 'refund-deal') {
					await page.waitForSelector('[data-bj-kartcek]');
					assert.deepEqual(await page.evaluate(() => window.__dealFrames), [[1, 0, false], [1, 1, false], [2, 1, false], [2, 2, false], [2, 2, true]], 'Dağıtım krupiyerden başlamalı, kararlar en sonda açılmalı');
					const dealt = await page.evaluate(() => window.__mockLiveState.oyunBasarimlari.blackjack.masalar['ana-masa']);
					assert.deepEqual(dealt.kurpiyerEli.kartlar.map((k) => k.r), ['7', '10']);
					assert.deepEqual(dealt.koltuklar[2].eller[0].kartlar.map((k) => k.r), ['4', '5']);
					assert.equal(dealt.aksiyonSuresiBitis, null);
					assert.equal(await page.locator('[data-bj-bahis-iade]').count(), 0, 'El başladıktan sonra iade yapılamamalı');
					await page.click('[data-bj-kal]');
					await page.waitForFunction(() => window.__mockLiveState.oyunBasarimlari.blackjack.masalar['ana-masa'].durum === 'el_sonucu');
				} else {
					await page.waitForFunction(() => window.__mockLiveState.oyunBasarimlari.blackjack.masalar['ana-masa'].durum === 'oyunculuk');
					await page.waitForTimeout(1600);
					assert.equal(await page.locator('.bj-koltuk-ben .bj-kart').count(), 0);
					assert.equal(await page.locator('[data-bj-kartcek]').count(), 0);
					assert((await page.locator('.bj-koltuk-ben').textContent()).includes('Bu el pas'));
				}
				assert.deepEqual(errors, []);
				console.log(scenario + ': OK');
				await page.close();
				continue;
			}
			await page.waitForSelector('[data-bj-kartcek]');
			if (scenario === 'solo-timeout') {
				await page.evaluate((path) => firebase.database().ref(path + '/aksiyonSuresiBitis').set(Date.now() - 100), tablePath);
				await page.waitForTimeout(2200);
				assert.equal(await page.evaluate(() => window.__network.attempts.length), 0, 'Tek oyuncu süresi dolsa bile otomatik kalmamalı');
				assert.equal(await page.locator('[data-bj-aksiyon-sayac]').textContent(), '');
				await page.click('[data-bj-kal]');
			} else if (scenario === 'denied-timeout') {
				await page.evaluate((path) => { window.__network.denied = true; return firebase.database().ref(path + '/aksiyonSuresiBitis').set(Date.now() - 100); }, tablePath);
				await page.waitForFunction(() => document.querySelector('[data-bj-durum]').textContent.includes('yazma izni'));
				const attempts = await page.evaluate(() => window.__network.attempts.length);
				await page.waitForTimeout(2200);
				assert.equal(await page.evaluate(() => window.__network.attempts.length), attempts, 'Ret sonsuz işlem üretmemeli');
				assert.equal(await page.locator('[data-bj-kartcek]').count(), 1, 'Ret kart çek düğümünü silmemeli');
				await page.evaluate(() => { window.__network.denied = false; });
				await page.click('[data-bj-yeniden-dene]');
			} else if (scenario === 'hit-stand') {
				await page.locator('[data-bj-kartcek]').evaluate((button) => { window.__originalHit = button; button.click(); button.click(); });
				await page.waitForTimeout(30);
				assert(await page.locator('[data-bj-kartcek]').isDisabled(), 'Onay beklerken tekrar tıklama kapanmalı');
				assert.equal(await page.evaluate(() => window.__mockLiveState.oyunBasarimlari.blackjack.masalar['ana-masa'].desteIndex), 0, 'Sunucu onayından önce kart değişmemeli');
				await page.waitForFunction(() => window.__mockLiveState.oyunBasarimlari.blackjack.masalar['ana-masa'].desteIndex === 1);
				assert.equal(await page.evaluate(() => window.__network.attempts.length), 1, 'Çift tıklama tek kart çekmeli');
				await page.click('[data-bj-kal]');
			} else if (scenario === 'double') {
				await page.click('[data-bj-katla]');
				await page.waitForFunction(() => window.__mockLiveState.oyunBasarimlari.blackjack.masalar['ana-masa'].durum === 'kurpiyer_sirasi');
				assert.equal(await page.evaluate(() => window.__mockLiveState.oyunBasarimlari.blackjack.masalar['ana-masa'].koltuklar[2].eller[0].bahisMiktari), 200);
			} else {
				await page.click('[data-bj-bol]');
				await page.waitForFunction(() => window.__mockLiveState.oyunBasarimlari.blackjack.masalar['ana-masa'].koltuklar[2].eller.length === 2);
				await page.click('[data-bj-kal]');
				await page.waitForFunction(() => window.__mockLiveState.oyunBasarimlari.blackjack.masalar['ana-masa'].koltuklar[2].eller[0].durum === 'kaldi');
				assert.equal(await page.locator('[data-bj-kal]').count(), 1, 'İkinci bölünmüş el oynanabilmeli');
				await page.click('[data-bj-kal]');
			}
			await page.waitForFunction(() => window.__mockLiveState.oyunBasarimlari.blackjack.masalar['ana-masa'].durum === 'el_sonucu');
			assert.equal(await page.evaluate(() => window.__network.maxActive), 1, 'Aynı istemci çakışan masa işlemi üretmemeli');
			assert(await page.evaluate(() => window.__network.attempts.every((x) => x.applyLocally === false)), 'Yalnız onaylı masa yayınlanmalı');
			assert.deepEqual(errors, []);
			console.log(scenario + ': OK');
			await page.close();
		}
		console.log('ALL_TESTS_PASSED: true');
	} finally {
		if (browser) await browser.close();
		server.closeAllConnections();
		await new Promise((resolve) => server.close(resolve));
	}
})().catch((error) => { console.error(error); process.exitCode = 1; });
