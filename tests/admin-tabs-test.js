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
const SITE_ROOT = path.join(__dirname, '..', 'docs');
const PORT = 8964;
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
	const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
	const pageErrors = [];
	page.on('pageerror', (e) => pageErrors.push(e.message));
	await page.route('**/firebasejs/**/firebase-app-compat.js', (route) => route.fulfill({ path: path.join(TESTS_DIR, 'mock-firebase.js'), contentType: 'application/javascript' }));
	await page.route('**/firebasejs/**/firebase-database-compat.js', (route) => route.fulfill({ body: '' }));
	await page.route('**/firebasejs/**/firebase-auth-compat.js', (route) => route.fulfill({ body: '' }));
	await page.route('**Sortable.min.js', (route) => route.fulfill({ path: path.join(TESTS_DIR, 'mock-sortable.js') }));
	await page.route('**://fonts.googleapis.com/**', (route) => route.fulfill({ body: '' }));
	await page.route('**://fonts.gstatic.com/**', (route) => route.abort());
	// admin.html'in kendi koruma mantığı (resolveAuthUser -> routeForCurrentPage, app.js:44-49)
	// misafir girişinde (mock auth varsayılan olarak currentUser=null döndürür) location.replace
	// ile index.html'e yönlendiriyor -- context navigasyonla yok olurdu (location.replace
	// Chromium'da configurable:false, override edilemiyor -- denendi). mock-firebase.js'in
	// __mockSimulateOfflineHang bayrağı TAM ihtiyacımız olan yan etkiyi veriyor: mock'un on()
	// metodu bu bayrak açıkken "users/" yoluna kayıtlı callback'i HİÇ TETİKLEMİYOR (offline
	// simülasyonu), yani resolveAuthUser() users/{uid} cevabını sonsuza dek beklemede kalır,
	// routeForCurrentPage() hiç çağrılmaz, admin.html DOM'u bozulmadan kalır. currentUser'ı
	// SONRA elle admin yapıp switchAdminTab()'in KENDİ requireAdmin() kontrolüyle test ediyoruz.
	await page.addInitScript(() => { window.__mockSimulateOfflineHang = true; });
	await page.goto(`http://localhost:${PORT}/admin.html`, { waitUntil: 'load' });
	await page.waitForTimeout(300);

	// --- Ortak kurulum: admin olarak "oturum aç" ---
	await page.evaluate(() => {
		currentUser = { role: 'admin', firstName: 'Test', lastName: 'Admin', email: 'admin@test.com' };
		applyPermissions();
	});

	// =====================================================================
	// SENARYO 1: field-ops -- bekleyen taslak + personel iş yükü, calEvents üzerinden.
	// =====================================================================
	const fieldOpsTest = await page.evaluate(() => {
		const now = Date.now();
		calEvents = {
			ev1: { ad: '(Düzenlenmeye muhtaç)', tarih: '2026-09-01', saat: '10:00', olusturmaTs: now - 2 * 86400000, gorevli: 'Ayşe Yılmaz, Mehmet Kaya' },
			ev2: { ad: '(Düzenlenmeye muhtaç)', tarih: '2026-09-02', saat: '11:00', olusturmaTs: now - 3600000, gorevli: 'Ayşe Yılmaz' },
			ev3: { ad: 'Gerçek Etkinlik', tarih: '2026-09-01', saat: '09:00', gorevli: 'Mehmet Kaya' }
		};
		switchAdminTab('field-ops');
		const body = document.getElementById('adminFieldOpsBody').innerHTML;
		return {
			showsTwoDrafts: (body.match(/stat-expiry-row/g) || []).length === 2,
			staleDraftMarkedWarn: /warn">2g/.test(body),
			freshDraftNotWarn: !/warn">0g/.test(body),
			workloadShowsAyse: /Ayşe Yılmaz/.test(body) && />2</.test(body.split('Ayşe Yılmaz')[1] || ''),
			tabActive: document.getElementById('adminTabFieldOpsBtn').classList.contains('active')
		};
	});

	// =====================================================================
	// SENARYO 2: editorial -- SLA listesi + ajans dağılımı.
	// =====================================================================
	const editorialTest = await page.evaluate(() => {
		const now = Date.now();
		calEvents = {
			ev1: { ad: 'Basın Toplantısı', tarih: '2026-08-20', durum: 'cekildi', guncellemeTs: now - 5 * 86400000, haberKaynagi: 'AA' },
			ev2: { ad: 'Panel', tarih: '2026-08-22', durum: 'cekildi', guncellemeTs: now - 1 * 86400000, haberKaynagi: 'İHA' },
			ev3: { ad: 'Yayınlanan', tarih: '2026-08-15', durum: 'yayinlandi', haberKaynagi: 'AA' }
		};
		switchAdminTab('editorial');
		const body = document.getElementById('adminEditorialBody').innerHTML;
		return {
			showsTwoPending: (body.match(/stat-expiry-row/g) || []).length === 2,
			oldestFirst: body.indexOf('Basın Toplantısı') < body.indexOf('Panel'),
			oldOneWarn: /warn">5g/.test(body),
			hasAgencyLegend: /AA: 2/.test(body) && /İHA: 1/.test(body)
		};
	});

	// =====================================================================
	// SENARYO 3: hierarchy -- boş kadro + vekil + rank/unvan uyuşmazlığı.
	// Mock .once() YOL AYRIMI YAPMAZ (window.__mockOnceSnapshot tek/global) --
	// bu yüzden fetchAllPeople()'daki il VE üniversite fetch'i AYNI veriyi alır.
	// =====================================================================
	const hierarchyTest = await page.evaluate(async () => {
		window.__mockOnceSnapshot = {
			p1: { name: 'Prof. Dr. Ayşe Vekil', title: 'Dekan Vekili', status: 'aktif', rank: 20, faculties: ['Fen Fakültesi'] },
			p2: { name: 'Doç. Dr. Mehmet Rankhatali', title: 'Araştırma Görevlisi', status: 'aktif', rank: 3, faculties: ['Tıp Fakültesi'] },
			p3: { name: 'Prof. Dr. Sağlam Kayıt', title: 'Dekan', status: 'aktif', rank: 4, faculties: ['Mühendislik Fakültesi'] }
		};
		switchAdminTab('hierarchy');
		await new Promise((r) => setTimeout(r, 100));
		const body = document.getElementById('adminHierarchyBody').innerHTML;
		return {
			hasVacantUnits: /Boş Kadrolar \([1-9][0-9]\)/.test(body), // FACULTY_GROUPS'ta 49 birim var (Rektörlük hariç), 3'ü dolu -> 46 boş
			showsVekil: /Ayşe Vekil/.test(body),
			showsMismatch: /Mehmet Rankhatali/.test(body) && /Araştırma Görevlisi/.test(body),
			doesNotFlagSaglamKayit: !/Sağlam Kayıt/.test(body.split('Rank/Unvan Uyuşmazlığı')[1] || body)
		};
	});

	// =====================================================================
	// SENARYO 4: integrity -- eksik fotoğraf + mükerrer isim + doğrulama tazeliği.
	// =====================================================================
	const integrityTest = await page.evaluate(async () => {
		window.__mockOnceSnapshot = {
			p1: { name: 'Fotoğrafsız Kişi', photo: '', status: 'aktif', sonDogrulamaTs: Date.now() },
			p2: { name: 'Tam Kayıt', photo: 'x.jpg', status: 'aktif', sonDogrulamaTs: Date.now() },
			p3: { name: 'Hiç Doğrulanmamış', photo: 'y.jpg', status: 'aktif' }
		};
		switchAdminTab('integrity');
		await new Promise((r) => setTimeout(r, 100));
		const body = document.getElementById('adminIntegrityBody').innerHTML;
		return {
			showsMissingPhoto: /Fotoğrafsız Kişi/.test(body),
			// il+üniversite AYNI veriyi aldığı için her aktif kişi kendi kopyasıyla "mükerrer" sayılır.
			showsDuplicates: /Mükerrer İsimler \(3\)/.test(body),
			// il+üniversite ikisi de aynı 3 kişiyi taşıyor: p1/p2 "şimdi" doğrulanmış (Güncel x2'şer
			// kopya=4), p3 hiç doğrulanmamış (Hiç/1 Yıl+ x2 kopya=2).
			showsFreshnessSegments: /Güncel:4/.test(body.replace(/\s/g, '')) && /Hiç\/1Yıl\+:2/.test(body.replace(/\s/g, ''))
		};
	});

	// =====================================================================
	// SENARYO 5: dashboard -- 3 KPI kartı, hepsi hesaplanıyor.
	// =====================================================================
	const dashboardTest = await page.evaluate(async () => {
		const now = Date.now();
		calEvents = {
			ev1: { ad: '(Düzenlenmeye muhtaç)', tarih: '2026-09-01', olusturmaTs: now - 2 * 86400000 },
			ev2: { ad: 'Geçmiş Habersiz', tarih: '2020-01-01', durum: 'cekildi', arsiv: '' }
		};
		window.__mockOnceSnapshot = { p1: { name: 'Tek Kişi', status: 'aktif', faculties: ['Fen Fakültesi'] } };
		switchAdminTab('dashboard');
		await new Promise((r) => setTimeout(r, 100));
		const body = document.getElementById('adminDashboardBody').innerHTML;
		return {
			hasThreeCards: (body.match(/dash-alert-card/g) || []).length === 3,
			showsDraftCount: /24s\+ Bekleyen Taslak/.test(body),
			showsVacantCount: /Boş Kadro \(Birim\)/.test(body),
			showsArchiveMissing: /Arşiv Linki Eksik Etkinlik/.test(body)
		};
	});

	const combined = { fieldOpsTest, editorialTest, hierarchyTest, integrityTest, dashboardTest };
	console.log(JSON.stringify(combined, null, 2));
	console.log('PAGE ERRORS:', pageErrors.length);
	pageErrors.forEach((e) => console.log(' -', e));

	const __boolFails = collectBooleanFailures(combined, []);
	const __allPassed = pageErrors.length === 0 && __boolFails.length === 0;
	console.log('ALL_TESTS_PASSED:', __allPassed);
	if (__boolFails.length) console.log('BASARISIZ ALANLAR:', JSON.stringify(__boolFails));

	await browser.close();
	server.close();
	process.exitCode = __allPassed ? 0 : 1;
})();
