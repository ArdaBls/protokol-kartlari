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
				if (window.__mockSimulateOfflineHang && path.indexOf("users/") === 0) return cb;
				// Anında boş veriyle çağır (gerçek Firebase de ilk bağlanışta mevcut veriyi verir)
				try { cb(makeSnapshot(null)); } catch (e) { console.error("mock on() callback error", e); }
				return cb;
			},
			once: function () {
				// Varsayilan: bos (mevcut 16 testin hicbiri bunu set etmiyor, davranis degismez).
				// window.__mockOnceSnapshot set edilmisse onun yerine dondurulur -- saveSuccessor()
				// gibi "yazmadan once fresh() oku" yapan fonksiyonlari test edebilmek icin gerekli:
				// aksi halde her .once() bos donup people'i [] ile eziyordu.
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
				return Promise.resolve();
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
			// Duman testi: oturum açmamış (misafir) durumu simüle et
			setTimeout(function () { cb(null); }, 0);
		},
		signInWithEmailAndPassword: function (email, pass) {
			return Promise.reject({ code: "auth/mock", message: "Mock ortamda giriş devre dışı." });
		},
		createUserWithEmailAndPassword: function (email, pass) {
			return Promise.reject({ code: "auth/mock", message: "Mock ortamda kayıt devre dışı." });
		},
		signOut: function () { return Promise.resolve(); },
		currentUser: null
	};

	window.firebase = {
		initializeApp: function (config) { console.log("[mock] firebase.initializeApp çağrıldı"); },
		database: function () {
			return { ref: function (path) { return makeRef(path); } };
		},
		auth: function () { return mockAuth; }
	};
})();
