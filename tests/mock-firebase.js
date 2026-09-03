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
			if (path.indexOf(keys[i]) !== -1) return data[keys[i]];
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
				try { cb(makeSnapshot(mockValueFor(path))); } catch (e) { console.error("mock on() callback error", e); }
				return cb;
			},
			once: function () {
				if (yolReddedildiMi(path)) { return Promise.reject(reddetHatasi(path)); }
				// Once YOLA GORE cozmeyi dene (__mockData / __mockUserProfile). Boylece
				// ayni sayfada farkli yollar farkli veri dondurebiliyor -- ornegin
				// bildirimler.html hem users/ hem logs/* okuyor, kullanici-yonetimi.html
				// users/ listesini okuyor. Eskiden once() yolu HIC dikkate almayip her
				// zaman ayni __mockOnceSnapshot'i donduruyordu.
				var yolaGore = mockValueFor(path);
				if (yolaGore !== null && yolaGore !== undefined) {
					return Promise.resolve(makeSnapshot(yolaGore));
				}
				// Geri donus: window.__mockOnceSnapshot (mevcut testlerin dayandigi davranis --
				// hicbiri __mockData set etmedigi icin yukaridaki dal onlarda calismaz).
				return Promise.resolve(makeSnapshot(window.__mockOnceSnapshot !== undefined ? window.__mockOnceSnapshot : null));
			},
			off: function () { listeners = []; },
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
				return Promise.resolve();
			},
			update: function (data) {
				window.__mockUpdates = window.__mockUpdates || [];
				window.__mockUpdates.push({ path: path, data: data });
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
