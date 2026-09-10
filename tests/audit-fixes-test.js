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
			if (typeof v === 'boolean') { if (v === false && excludePaths.indexOf(p) === -1) fails.push(p); }
			else if (v && typeof v === 'object') { fails = fails.concat(collectBooleanFailures(v, excludePaths, p)); }
		}
	}
	return fails;
}

const TESTS_DIR = __dirname;
const SITE_ROOT = path.join(__dirname, '..', 'docs');
const PORT = 8968;
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

async function newPage(browser, width, height, mobile) {
	const page = await browser.newPage({ viewport: { width: width, height: height }, isMobile: !!mobile, hasTouch: !!mobile });
	await page.route('**/firebasejs/**/firebase-app-compat.js', (r) => r.fulfill({ path: path.join(TESTS_DIR, 'mock-firebase.js'), contentType: 'application/javascript' }));
	await page.route('**/firebasejs/**/firebase-database-compat.js', (r) => r.fulfill({ body: '' }));
	await page.route('**/firebasejs/**/firebase-auth-compat.js', (r) => r.fulfill({ body: '' }));
	await page.route('**Sortable.min.js', (r) => r.fulfill({ path: path.join(TESTS_DIR, 'mock-sortable.js') }));
	await page.route('**://fonts.googleapis.com/**', (r) => r.fulfill({ body: '' }));
	await page.route('**://fonts.gstatic.com/**', (r) => r.abort());
	// index.html DEĞİL, protokol.html -- çok sayfalı mimari geçişinden (index.html artık
	// SADECE giriş/kayıt) sonra kart ızgarası/header index.html'de CSS ile gizli, ayrıca
	// openCalendar()/openAdminPanel() de PAGE!=="takvim"/"admin" iken gerçek bir
	// location.href yönlendirmesi yapıyor. protokol.html'de kart ızgarası+header GÖRÜNÜR
	// kalıyor, takvim/admin ise (bu dosyada aşağıda) doğrudan DOM manipülasyonuyla (gate
	// fonksiyonlarını bypass ederek) açılıyor -- tek bir sayfa örneğinde hepsi test edilebiliyor.
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
	await page.waitForTimeout(250);
	return page;
}

(async () => {
	const server = await serve();
	const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
	const pageErrors = [];

	// ==================================================================
	// BOLUM B: Mobil duzeltmeler (gercek olcum)
	// (BOLUM A -- JS yaris durumlari/veri kaybi -- Etkinlik Takvimi modulune
	// bagimliydi, kullanici istegiyle o modul kaldirildiginda test de silindi.)
	// ==================================================================
	const mobile = {};
	for (const W of [320, 360, 414]) {
		const mp = await newPage(browser, W, 740, true);
		mp.on('pageerror', (e) => pageErrors.push('mobil' + W + ': ' + e.message));
		mobile['w' + W] = await mp.evaluate(() => {
			currentUser = { uid: 'a1', role: 'admin', firstName: 'Mehmet Abdulkadir', lastName: 'Yilmazoglu', email: 'uzun@omu.edu.tr' };
			applyPermissions();
			function textRect(el) { const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect(); }
			const ov = (a, b) => !(a.bottom <= b.top || b.bottom <= a.top || a.right <= b.left || b.right <= a.left);
			const r = {};
			// NOT: Buradaki baslik-cakismasi olcumleri (headerAuth <-> h1/.eyebrow) KALDIRILDI.
			// protokol.html artik panelin icindeki sayfa; eski sayfanin kendi <header>'i
			// (h1, .eyebrow ve hesap menusu) kullanici istegiyle tamamen cikarildi, panelin
			// kendi topbar'i o isi goruyor. Olcecek eleman kalmadigi icin bu uc iddia
			// anlamsizlasti; Bolum B'nin geri kalani (yatay tasma, admin sekmeleri,
			// kart izgarasi, mobil sidebar) AYNEN korunuyor.
			// Sayfa yatay tasmasi
			r.noPageOverflow = document.documentElement.scrollWidth <= document.documentElement.clientWidth;
			// Admin sekmeleri ekrana sigiyor mu -- openAdminPanel() DEGIL (protokol.html'de
			// PAGE!=="admin" oldugu icin gercek bir location.href yonlendirmesi yapar), kapi
			// fonksiyonu bypass edilip DOGRUDAN acilir.
			document.getElementById('adminPanelBg').classList.add('open');
			// Faz 11: mobil sidebar artik position:fixed bir slide-over -- KAPALIYKEN de tam
			// genisligini korur (sadece translateX ile ekran disina kaydirilir), o yuzden ACIK
			// olmadan .admin-nav-item'larin genisligi ARTIK 0 DEGIL (eskiden PUSH modelinde
			// kapaliyken width:0'di, bu test o filtreye guveniyordu). Sekmelerin gercekten ekrana
			// sigip sigmadigini anlamli sekilde olcmek icin cekmeceyi ACIK duruma getiriyoruz.
			// transition:none: .open transform GECISI (.25s) senkron classList.add() sonrasi
			// HEMEN okunan getComputedStyle'da henuz baslamamis olabilir (bir sonraki reflow'u
			// beklemesi gerekir) -- transition'i test icin kapatip HEDEF konuma aninda atlatiyoruz,
			// aksi halde bu olcum kapali (baslangic) transform'unu yakalayip yanlislikla "tasiyor"
			// derdi.
			const admSidebar = document.getElementById('adminSidebarDrawer');
			admSidebar.style.transition = 'none';
			admSidebar.classList.add('open');
			void admSidebar.offsetHeight;
			// .admin-tabs/.btn DEGIL -- Part B'nin akordeon sidebar yenilemesinden (Faz 9) sonra
			// tum sekme dugmeleri .admin-sidebar icinde .admin-nav-item class'ini tasiyor.
			// Mobilde TUM gruplar (accordion) DOM'da mevcut ama kapali gruplarin treeview'i
			// display:none -- sadece GORUNEN (fiili genislik/yuksekligi olan) dugmeler sayilir,
			// kapali bir akordeonun ekran disi kalmasi yanlislikla "tasma" sayilmasin diye.
			const tabs = Array.from(document.querySelectorAll('.admin-sidebar .admin-nav-item')).filter((b) => b.getBoundingClientRect().width > 0);
			r.adminTabCount = tabs.length;
			r.adminTabsOnScreen = tabs.every((b) => { const x = b.getBoundingClientRect(); return x.right <= window.innerWidth + 0.5 && x.left >= -0.5; });
			// #adminPanelBg .modal DEGIL -- admin paneli Faz 7'den beri kucuk bir dialog degil,
			// tam sayfa .admin-dashboard iskeleti.
			const am = document.querySelector('#adminPanelBg .admin-dashboard');
			r.adminModalNoOverflow = am.scrollWidth <= am.clientWidth + 1;
			closeAdminPanel();
			// Kart izgarasi: 2'li/3'lu/4'lu modlarda farkli uzunlukta isim/unvan/birim
			// icerigiyle yukseklik tutarliligi + .meta ("devam ediyor"/tarih) cakismamasi.
			// Bilerek "il" listesinde test ediliyor -- kart CSS/JS'i universite/il arasinda
			// PAYLASILIYOR ama kullanici ozellikle "il protokol kartlarinda da" sorununu
			// bildirdigi icin sadece universite ile test edip varsaymak yerine bizzat
			// dogrulaniyor.
			currentListKey = 'il';
			people = [
				{ name: 'A', title: 'Kisa', unit: 'Kisa Birim', prefix: '', status: 'aktif', rank: 1, photo: '', start: '2020-01-01', end: '', note: '' },
				{ name: 'Çok Uzun Bir İsim Soyisim Buraya', title: 'Çok Uzun Bir Görev Unvanı Buraya Sığmaz', unit: 'Çok Uzun Bir Birim Adı Fakültesi Buraya', prefix: 'Prof. Dr.', status: 'aktif', rank: 1, photo: '', start: '2020-01-01', end: '', note: 'Uzun bir not metni burada da devam ediyor gidiyor.' },
				{ name: 'B Kısa', title: 'Orta Unvan', unit: 'Orta Birim', prefix: '', status: 'aktif', rank: 1, photo: '', start: '2020-01-01', end: '', note: '' },
				{ name: 'C Kısa', title: 'Orta Unvan 2', unit: 'Orta Birim 2', prefix: '', status: 'aktif', rank: 1, photo: '', start: '2020-01-01', end: '', note: '' }
			];
			r.cardGrid = {};
			[2, 3, 4].forEach(function (cols) {
				const grid = document.getElementById('grid');
				grid.classList.remove('grid-cols-2', 'grid-cols-3', 'grid-cols-4');
				grid.classList.add('grid-cols-' + cols);
				grid.style.setProperty('--mobile-cols', cols);
				render();
				const cards = Array.from(document.querySelectorAll('.card'));
				const heights = cards.map(function (c) { return c.getBoundingClientRect().height; });
				const maxH = Math.max.apply(null, heights); const minH = Math.min.apply(null, heights);
				// Line-clamp KESIN esitlik saglamiyor (kisa kart 1 satir, uzun kart clamp'lenmis
				// 2 satir kullanabilir -- bu kabul edilen bir fark, yapay min-height'la
				// bastirilmiyor). Asil dogrulanmasi gereken: clamp GERCEKTEN calisiyor mu --
				// yani uzun icerikli karttaki .name/.title/.unit TASMIYOR (scrollHeight,
				// clientHeight'i asmiyor), sinirsiz sarip kart yuksekligini sismemesini
				// engelliyor. Once clamp'siz eski davranista bu deger cok daha buyuk olurdu.
				const longCard = cards[1]; // 2. kisi = kasitli en uzun isim/unvan/birim/not
				const clampCheck = function (sel) {
					const el = longCard.querySelector(sel); if (!el) return true;
					return el.scrollHeight <= el.clientHeight + 2;
				};
				const clampWorking = clampCheck('.name') && clampCheck('.title') && clampCheck('.unit');
				// "Duzenle" butonu her kartta ayni ust-alt konumda olmali (margin-top:auto ile
				// kartin en altina sabitlenir) -- degilse ayni satirdaki kartlarda buton
				// kimi ustte kimi altta gorunur (kullanicinin bildirdigi sorun).
				const editBtnOffsets = cards.map(function (c) {
					const btn = c.querySelector('.card-edit'); if (!btn) return null;
					return Math.round(c.getBoundingClientRect().bottom - btn.getBoundingClientRect().bottom);
				}).filter(function (v) { return v !== null; });
				const editBtnAligned = editBtnOffsets.length > 0 && (Math.max.apply(null, editBtnOffsets) - Math.min.apply(null, editBtnOffsets)) <= 2;
				// Kaba bir ust sinir da tutuluyor: clamp gercekten isliyorsa fark makul kalmali
				// (name/title/unit'te en fazla 1'er ekstra satir + varsa bir not bloğu).
				const heightVarianceOk = (maxH - minH) <= 140;
				let metaOverlapFound = false;
				document.querySelectorAll('.meta').forEach(function (meta) {
					const spans = Array.from(meta.querySelectorAll('span'));
					for (let i = 0; i < spans.length; i++) {
						for (let j = i + 1; j < spans.length; j++) {
							const a = spans[i].getBoundingClientRect(); const b = spans[j].getBoundingClientRect();
							if (a.width === 0 || b.width === 0) continue;
							const overlaps = !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
							if (overlaps) metaOverlapFound = true;
						}
					}
				});
				r.cardGrid['cols' + cols] = { clampWorking: clampWorking, heightVarianceOk: heightVarianceOk, noMetaOverlap: !metaOverlapFound, editBtnAligned: editBtnAligned, maxHeight: Math.round(maxH), minHeight: Math.round(minH) };
			});
			// iOS otomatik yakinlastirma: form alanlari >= 16px
			openAddModal();
			r.inputFontIs16 = parseFloat(getComputedStyle(document.getElementById('f_name')).fontSize) >= 16;
			r.nameFieldWide = document.getElementById('f_name').getBoundingClientRect().width >= 150;
			closeModal();
			return r;
		});
		await mp.close();
	}

	const combined = { mobile };
	console.log(JSON.stringify(combined, null, 2));
	console.log('PAGE ERRORS:', pageErrors.length);
	pageErrors.forEach((e) => console.log(' -', e));

	const boolFails = collectBooleanFailures(combined, []);
	const allPassed = pageErrors.length === 0 && boolFails.length === 0;
	console.log('ALL_TESTS_PASSED:', allPassed);
	if (boolFails.length) console.log('BASARISIZ ALANLAR:', JSON.stringify(boolFails));

	await browser.close();
	server.close();
	process.exitCode = allPassed ? 0 : 1;
})();
