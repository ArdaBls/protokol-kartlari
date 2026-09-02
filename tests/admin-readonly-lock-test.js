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

(async () => {
	const server = await serve();
	const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
	const page = await browser.newPage();
	const pageErrors = [];
	page.on('pageerror', (e) => pageErrors.push(e.message));
	await page.route('**/firebasejs/**/firebase-app-compat.js', (route) => route.fulfill({ path: path.join(TESTS_DIR, 'mock-firebase.js'), contentType: 'application/javascript' }));
	await page.route('**/firebasejs/**/firebase-database-compat.js', (route) => route.fulfill({ body: '' }));
	await page.route('**/firebasejs/**/firebase-auth-compat.js', (route) => route.fulfill({ body: '' }));
	await page.route('**Sortable.min.js', (route) => route.fulfill({ path: path.join(TESTS_DIR, 'mock-sortable.js') }));
	await page.route('**://fonts.googleapis.com/**', (route) => route.fulfill({ body: '' }));
	await page.route('**://fonts.gstatic.com/**', (route) => route.abort());
	await page.addInitScript(() => { window.__mockSimulateOfflineHang = true; });
	await page.goto(`http://localhost:${PORT}/admin.html`, { waitUntil: 'load' });
	await page.waitForTimeout(300);

	// =====================================================================
	// SENARYO 1: kilit KAPALIYKEN admin normal şekilde düzenleyebilmeli (temel davranış BOZULMAMALI).
	// =====================================================================
	const baselineTest = await page.evaluate(() => {
		currentUser = { uid: 'admin1', role: 'admin', firstName: 'Admin', lastName: 'K', email: 'a@t.com' };
		applyPermissions();
		return { canEditWhenUnlocked: canEditData(), requireEditPassesWhenUnlocked: requireEdit() };
	});

	// =====================================================================
	// SENARYO 2: kilit AÇIKKEN -- admin DAHİL kimse düzenleyemez (canEditData/requireEdit/
	// is-readonly/.edit-only hepsi etkilenmeli). attachSaltOkunurListener'ın gerçek Firebase
	// callback'ini simüle ediyoruz (mock .on() anında boş veri döndürüyor, gerçek bir toggle
	// akışı için doğrudan durumu set edip aynı yan etkileri elle tetikliyoruz).
	// =====================================================================
	const lockedTest = await page.evaluate(() => {
		document.getElementById('addBtn') && document.getElementById('addBtn').classList.add('edit-only'); // güvenlik ağı, zaten HTML'de var
		saltOkunurEnabled = true;
		updateStatusBanner();
		applyPermissions();
		const editBlocked = !requireEdit();
		return {
			canEditFalseEvenForAdmin: canEditData() === false,
			requireEditBlocked: editBlocked,
			bodyIsReadonly: document.body.classList.contains('is-readonly'),
			addBtnHidden: getComputedStyle(document.getElementById('addBtn')).display === 'none',
			bannerVisible: document.getElementById('testModeBanner').style.display === 'flex',
			bannerHasLockClass: document.getElementById('testModeBanner').classList.contains('banner-lock'),
			bannerMentionsLock: document.getElementById('testModeBanner').textContent.indexOf('Salt-Okunur') !== -1,
			lockSwitchChecked: document.getElementById('saltOkunurSwitch').checked === true
		};
	});

	// =====================================================================
	// SENARYO 3: editor kilidi AÇIP/KAPATAMAZ (requireAdmin() engellemeli).
	// =====================================================================
	const editorGuardTest = await page.evaluate(async () => {
		currentUser = { uid: 'ed1', role: 'editor', firstName: 'Editor', lastName: 'K', email: 'ed@test.com' };
		applyPermissions();
		window.__mockSets = [];
		await setSaltOkunur(false);
		return { blockedForEditor: (window.__mockSets || []).every((s) => s.path.indexOf('ayarlar/saltOkunur') === -1) };
	});

	// =====================================================================
	// SENARYO 4: admin kilidi KAPATABİLİR -- doğru path'e doğru değer yazılmalı.
	// =====================================================================
	const adminUnlockTest = await page.evaluate(async () => {
		currentUser = { uid: 'admin1', role: 'admin', firstName: 'Admin', lastName: 'K', email: 'a@t.com' };
		applyPermissions();
		window.__mockSets = [];
		await setSaltOkunur(false);
		const set = (window.__mockSets || []).find((s) => s.path.indexOf('ayarlar/saltOkunur') !== -1);
		return { wroteCorrectPath: !!set, wroteFalse: !!set && set.data === false };
	});

	// =====================================================================
	// SENARYO 5: kilit KAPANINCA canEditData/requireEdit/is-readonly eski haline dönmeli
	// (kalıcı bir yan etki bırakmamalı).
	// =====================================================================
	const unlockedAgainTest = await page.evaluate(() => {
		saltOkunurEnabled = false;
		updateStatusBanner();
		applyPermissions();
		return {
			canEditRestored: canEditData() === true,
			bodyReadonlyCleared: !document.body.classList.contains('is-readonly'),
			bannerHiddenAgain: document.getElementById('testModeBanner').style.display === 'none'
		};
	});

	// =====================================================================
	// SENARYO 6: Tam Yedek İndir -- İl+Üniversite+Etkinlik verisini TEK JSON'da birleştirmeli.
	// downloadFile() gerçek indirmeyi tetiklemesin diye geçici olarak override edilir.
	// =====================================================================
	const backupTest = await page.evaluate(async () => {
		window.__mockOnceSnapshot = { p1: { name: 'Test Kişi' } };
		calEvents = { e1: { ad: 'Test Etkinlik' } };
		let captured = null;
		const origDownload = downloadFile;
		downloadFile = function (content, fileName, mimeType) { captured = { content, fileName, mimeType }; };
		await exportFullBackup();
		downloadFile = origDownload;
		if (!captured) return { backupCaptured: false };
		const parsed = JSON.parse(captured.content);
		return {
			backupCaptured: true,
			fileNameLooksRight: /^Tam-Yedek-.*\.json$/.test(captured.fileName),
			hasIlData: !!parsed.ilProtokolVerileri && !!parsed.ilProtokolVerileri.p1,
			hasUniData: !!parsed.universiteProtokolVerileri && !!parsed.universiteProtokolVerileri.p1,
			hasEventData: !!parsed.etkinlikler && !!parsed.etkinlikler.e1,
			hasTimestamp: typeof parsed.yedekTarihi === 'string'
		};
	});

	const combined = { baselineTest, lockedTest, editorGuardTest, adminUnlockTest, unlockedAgainTest, backupTest };
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
