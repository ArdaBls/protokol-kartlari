// Sahte (mock) Firebase compat SDK - sadece duman testi (smoke test) amaçlı.
(function () {
	function makeSnapshot(val) {
		return {
			val: function () { return val === undefined ? null : val; },
			exists: function () { return val !== undefined && val !== null; },
			forEach: function (cb) {
				if (val && typeof val === "object") {
					Object.keys(val).forEach(function (k) { cb(makeSnapshot(val[k])); });
				}
			}
		};
	}

	// OPT-IN veri kaynagi. window.__mockData bir nesne ise, anahtarlari "yol parcasi"
	// olarak degerlendirilir: istenen yol o parcayi ICERIYORSA karsiligi dondurulur.
	// "users/<uid>" gibi tekil kullanici yollari icin __mockUserProfile ayrica
	// desteklenir. HICBIRI set edilmezse null doner -- yani eski davranis birebir korunur.
	function mockValueFor(path) {
		// .info/connected -- presence.js gibi modüller Firebase'in bu özel yolunu
		// dinleyip "gerçekten bağlı mıyım" sorusuna cevap alır. Mock ortamda
		// testlerin varsayılan olarak "bağlı" sayması bekleniyor -- __mockOffline
		// bilerek ayarlanırsa false döner (kopukluk senaryosu test edilebilsin diye).
		if (path === '.info/connected') { return window.__mockOffline ? false : true; }
		// users/{uid}/<alan> -- ornegin onay-bekliyor.html'in canli dinledigi
		// users/{uid}/role. Profil nesnesinden ilgili alan dondurulur.
		var alan = path.match(/(^|\/)users\/[^/]+\/([^/]+)$/);
		if (alan && window.__mockUserProfile !== undefined && window.__mockUserProfile !== null) {
			return window.__mockUserProfile[alan[2]] !== undefined ? window.__mockUserProfile[alan[2]] : null;
		}
		var m = path.match(/(^|\/)users\/([^/]+)$/);
		if (m && window.__mockUserProfile !== undefined) return window.__mockUserProfile;
		var data = window.__mockData;
		if (!data) return null;
		var keys = Object.keys(data);
		for (var i = 0; i < keys.length; i++) {
			var key = keys[i];
			var marker = path.indexOf(key);
			var bounded = marker >= 0 && (marker === 0 || path[marker - 1] === "/") && (marker + key.length === path.length || path[marker + key.length] === "/");
			if (!bounded) continue;
			var value = data[key];
			var rest = path.slice(marker + key.length).split("/").filter(Boolean);
			for (var j = 0; j < rest.length; j++) {
				if (!value || typeof value !== "object" || value[rest[j]] === undefined) return null;
				value = value[rest[j]];
			}
			return value;
		}
		return null;
	}

	// OPT-IN yetki reddi simulasyonu: window.__mockDenyPaths bir dizi ise, o
	// oneklerle BASLAYAN her yol icin gercek Firebase gibi PERMISSION_DENIED
	// uretilir. Gercek kurallarda "users" yalnizca admin/owner'a acik oldugu icin
	// editor davranisini test etmenin tek dogru yolu bu.
	// Eslesme VARSAYILAN OLARAK TAM YOL uzerinden. Gercek kurallar da boyle:
	// "users" listesi yalnizca admin/owner'a kapali ama "users/{uid}" HERKESE kendi
	// kaydi icin acik. Alt agaci da reddetmek icin girdinin sonuna "/*" eklenir.
	function yolReddedildiMi(path) {
		var liste = window.__mockDenyPaths;
		if (!liste || !liste.length) { return false; }
		for (var i = 0; i < liste.length; i++) {
			var girdi = liste[i];
			if (girdi.slice(-2) === "/*") {
				var kok = girdi.slice(0, -2);
				if (path === kok || path.indexOf(kok + "/") === 0) { return true; }
			} else if (path === girdi) { return true; }
		}
		return false;
	}
	function reddetHatasi(path) {
		var e = new Error("permission_denied at /" + path + ": Client doesn't have permission to access the desired data.");
		e.code = "PERMISSION_DENIED";
		return e;
	}

	// Kayitli TUM canli dinleyiciler. window.__mockRefresh() cagrilinca hepsi
	// GUNCEL mockValueFor(path) degeriyle yeniden tetiklenir -- "yonetici rolu
	// onayladi, canli dinleyici sayfayi gecirdi" gibi akislari test edebilmek icin.
	var tumDinleyiciler = [];
	window.__mockRefresh = function () {
		tumDinleyiciler.forEach(function (d) {
			try { d.cb(makeSnapshot(mockValueFor(d.path))); } catch (e) { console.error(e); }
		});
	};

	// ── CANLI DURUM (blackjack/amiral battı gibi transaction-agirlikli oyunlar
	// icin eklendi) ──────────────────────────────────────────────────────────
	// Yukaridaki mockValueFor() SADECE window.__mockData'daki SABIT fixture'lari
	// okur -- set()/update()/transaction() ile yapilan yazmalari YANSITMAZ. Bu,
	// tek bir islemi denetleyen eski testler icin yeterliydi ama blackjack gibi
	// ZINCIRLEME transaction'lari (bahis penceresi -> dagit -> krupiyer ->
	// yeni el) simule eden testler icin YETERSIZ -- her adim bir onceki yazmayi
	// GORMELI. window.__mockLiveState nested bir agac tutar; set/update/
	// transaction buraya yazar, on()/once()/transaction() buradan okur (sabit
	// fixture'lar sadece o yolda HENUZ canli veri yoksa devreye girer).
	function yolParcalari(path) { return String(path).split("/").filter(Boolean); }
	// "users/" TAMAMEN HARIC -- zaten kendi ozel fixture mekanizmasi var
	// (__mockUserProfile/__mockOnceSnapshot, bkz. mockValueFor). Bir alt alana
	// yapilan yazma (ornegin son giris zaman damgasi) burada canli bir ATA
	// nesnesi olusturursa, o ata TAM OKUNDUGUNDA rol/isim gibi diger alanlari
	// EKSIK gorunur ve fixture'in yerini YANLISLIKLA alir -- bu regresyona
	// (yetkiCozuldu testi) yol acmisti, bu yuzden users/ hic canli izlenmiyor.
	function kullaniciYoluMu(path) { return path === "users" || String(path).indexOf("users/") === 0; }
	function canliOku(path) {
		if (kullaniciYoluMu(path)) { return undefined; }
		var parcalar = yolParcalari(path);
		var deger = window.__mockLiveState;
		for (var i = 0; i < parcalar.length; i++) {
			if (deger === undefined || deger === null || typeof deger !== "object") { return undefined; }
			deger = deger[parcalar[i]];
		}
		return deger;
	}
	function canliYaz(path, deger) {
		if (kullaniciYoluMu(path)) { return; }
		window.__mockLiveState = window.__mockLiveState || {};
		var parcalar = yolParcalari(path);
		if (!parcalar.length) { window.__mockLiveState = deger; bildirCanliDegisiklik(path); return; }
		var kok = window.__mockLiveState;
		for (var i = 0; i < parcalar.length - 1; i++) {
			var p = parcalar[i];
			if (typeof kok[p] !== "object" || kok[p] === null) { kok[p] = {}; }
			kok = kok[p];
		}
		if (deger === null || deger === undefined) { delete kok[parcalar[parcalar.length - 1]]; }
		else { kok[parcalar[parcalar.length - 1]] = deger; }
		bildirCanliDegisiklik(path);
	}
	// mockValueFor() (sabit fixture) ile canliOku()'yu (gercek yazmalar) birlestirir --
	// canli veri varsa o kazanir, yoksa eski davranisa (fixture) duser.
	function mockCanliDeger(path) {
		var canli = canliOku(path);
		if (canli !== undefined) { return canli === null ? null : canli; }
		return mockValueFor(path);
	}
	function ataDegilMiVeyaAyniMi(a, b) { return a === b || a.indexOf(b + "/") === 0 || b.indexOf(a + "/") === 0; }
	function bildirCanliDegisiklik(yazilanYol) {
		tumDinleyiciler.forEach(function (d) {
			if (!ataDegilMiVeyaAyniMi(d.path, yazilanYol)) { return; }
			try { d.cb(makeSnapshot(mockCanliDeger(d.path))); } catch (e) { console.error(e); }
		});
	}

	function makeRef(path) {
		var listeners = [];
		var self = {
			_path: path,
			on: function (eventType, cb) {
				listeners.push(cb);
				// Cevrimdisi/baglanti-kopuklugu simulasyonu (offline-timeout-test.js): sadece
				// window.__mockSimulateOfflineHang acikken VE "users/" yolunda callback'i BILEREK
				// hic cagirma -- gercek Firebase'in internet yokken sessizce beklemede kalmasini
				// taklit eder. Diger tum testler bu bayragi hic set etmedigi icin etkilenmez.
				if (yolReddedildiMi(path)) {
					var hataCb = arguments[2];
					if (typeof hataCb === "function") { setTimeout(function () { hataCb(reddetHatasi(path)); }, 0); }
					return cb;
				}
				tumDinleyiciler.push({ path: path, cb: cb });
				if (window.__mockSimulateOfflineHang && path.indexOf("users/") === 0) return cb;
				// Anında veriyle çağır (gerçek Firebase de ilk bağlanışta mevcut veriyi verir).
				// Varsayilan HALA null -- mevcut testlerin hicbiri window.__mockData set
				// etmedigi icin davranislari degismez. __mockData set edilmisse, yolu
				// ICEREN ilk anahtarin degeri dondurulur (bkz. mockValueFor).
				try { cb(makeSnapshot(mockCanliDeger(path))); } catch (e) { console.error("mock on() callback error", e); }
				return cb;
			},
			once: function () {
				if (yolReddedildiMi(path)) { return Promise.reject(reddetHatasi(path)); }
				// Once YOLA GORE cozmeyi dene (canli yazma > __mockData / __mockUserProfile).
				// Boylece ayni sayfada farkli yollar farkli veri dondurebiliyor -- ornegin
				// bildirimler.html hem users/ hem logs/* okuyor, kullanici-yonetimi.html
				// users/ listesini okuyor. Eskiden once() yolu HIC dikkate almayip her
				// zaman ayni __mockOnceSnapshot'i donduruyordu.
				var yolaGore = mockCanliDeger(path);
				if (yolaGore !== null && yolaGore !== undefined) {
					return Promise.resolve(makeSnapshot(yolaGore));
				}
				// Geri donus: window.__mockOnceSnapshot (mevcut testlerin dayandigi davranis --
				// hicbiri __mockData set etmedigi icin yukaridaki dal onlarda calismaz).
				return Promise.resolve(makeSnapshot(window.__mockOnceSnapshot !== undefined ? window.__mockOnceSnapshot : null));
			},
			off: function () { listeners = []; },
			// Blackjack/amiral battı gibi "kim yönetiyor" yarışını Firebase transaction'ı
			// ile çözen oyunlar için -- gerçek SDK gibi updateFn(mevcutDeger) çağırır,
			// undefined dönerse abort (committed:false), aksi halde o değeri YAZAR
			// (ardışık/sıralı test çağrıları için yeterli, gerçek eşzamanlı yarış
			// SİMÜLE EDİLMİYOR).
			transaction: function (updateFn) {
				var mevcut = canliOku(path);
				if (mevcut === undefined) { mevcut = mockValueFor(path); if (mevcut === null) { mevcut = undefined; } }
				var yeniDeger;
				try { yeniDeger = updateFn(mevcut); } catch (e) { return Promise.reject(e); }
				if (yeniDeger === undefined) { return Promise.resolve({ committed: false, snapshot: makeSnapshot(mevcut === undefined ? null : mevcut) }); }
				canliYaz(path, yeniDeger);
				return Promise.resolve({ committed: true, snapshot: makeSnapshot(yeniDeger) });
			},
			push: function (data) {
				var key = "mockKey" + Math.random().toString(36).slice(2, 10);
				window.__mockPushes = window.__mockPushes || [];
				window.__mockPushes.push({ path: path, data: data, key: key });
				// .key hem eski (await'siz, p.key) hem yeni (await ref.push(...); ref.key) kullanım
				// biçimiyle uyumlu olsun diye HEM promise nesnesine HEM çözülen değere konur.
				var refLike = { key: key };
				var p = Promise.resolve(refLike);
				p.key = key;
				return p;
			},
			set: function (data) {
				window.__mockSets = window.__mockSets || [];
				window.__mockSets.push({ path: path, data: data });
				canliYaz(path, data === undefined ? null : data);
				return Promise.resolve();
			},
			update: function (data) {
				window.__mockUpdates = window.__mockUpdates || [];
				window.__mockUpdates.push({ path: path, data: data });
				// Gercek Firebase semantigi: '/' (kok) ref'inde anahtarlar TAM YOL,
				// diger reflerde anahtarlar KENDI ALTINDAKI goreli alan adi -- her
				// ikisi de bu kod tabanında kullanılıyor (bkz. database.ref('/').update(patch)
				// vs. database.ref(altYol).update({alan: deger})).
				var kokMu = !path || path === "/";
				Object.keys(data || {}).forEach(function (anahtar) {
					var tamYol = kokMu ? anahtar : (path + "/" + anahtar);
					canliYaz(tamYol, data[anahtar]);
				});
				return Promise.resolve();
			},
			remove: function () {
				window.__mockRemoves = window.__mockRemoves || [];
				window.__mockRemoves.push({ path: path });
				return Promise.resolve();
			},
			// calendar-create-select-test.js: canliTakvimSecim (Part D) ilk onDisconnect() kullanımı --
			// gerçek SDK'da her zaman mevcut, mock'ta eksikti (no-op yeterli, ayrılma davranışı test edilmiyor).
			onDisconnect: function () {
				return {
					remove: function () { return Promise.resolve(); },
					cancel: function () { return Promise.resolve(); },
					set: function () { return Promise.resolve(); }
				};
			},
			child: function (childPath) {
				return makeRef(path + "/" + childPath);
			},
			limitToLast: function () { return self; },
			orderByChild: function () { return self; },
			orderByKey: function () { return self; },
			equalTo: function () { return self; }
		};
		return self;
	}

	var authCallbacks = [];
	var mockAuth = {
		onAuthStateChanged: function (cb) {
			authCallbacks.push(cb);
			if (window.__mockSimulateOfflineHang) {
				// Cihazda kalıcı oturum var (daha önce giriş yapılmış) ama profil (users/{uid})
				// hiç çözülmeyecek (yukarıdaki on() yaması) -- offline-timeout-test.js bunu kullanır.
				setTimeout(function () { cb({ uid: "offlineTestUid", email: "offline@test.com" }); }, 0);
				return;
			}
			// Varsayilan: oturum açmamış (misafir). window.__mockAuthUser set edilmisse
			// o kullanici ile giris yapilmis gibi davranilir -- yeni smoke-test'in
			// "giris yapmis kullanici" turu icin (mevcut testler bu bayragi set etmiyor).
			setTimeout(function () { cb(window.__mockAuthUser || null); }, 0);
		},
		signInWithEmailAndPassword: function (email, pass) {
			return Promise.reject({ code: "auth/mock", message: "Mock ortamda giriş devre dışı." });
		},
		createUserWithEmailAndPassword: function (email, pass) {
			return Promise.reject({ code: "auth/mock", message: "Mock ortamda kayıt devre dışı." });
		},
		signOut: function () { return Promise.resolve(); },
		// Getter: __mockAuthUser sonradan (addInitScript ile) set edilse bile dogru deger okunur.
		get currentUser() { return window.__mockAuthUser || null; }
	};

	function mockDatabase() {
		return { ref: function (path) { return makeRef(path); } };
	}
	// Gercek compat SDK'da firebase.database.ServerValue.TIMESTAMP bir "sentinel" nesnedir --
	// index.html artik Date.now() yerine bunu kullaniyor (bkz. audit maddesi #1), bu yuzden mock'ta
	// da tanimli olmasi gerekiyor; aksi halde her yazma yolu "Cannot read properties of undefined"
	// hatasiyla patlardi.
	mockDatabase.ServerValue = { TIMESTAMP: { ".sv": "timestamp" } };

	window.firebase = {
		apps: [],
		initializeApp: function (config) { window.firebase.apps.push({}); console.log("[mock] firebase.initializeApp çağrıldı"); },
		database: mockDatabase,
		auth: function () { return mockAuth; }
	};
})();
