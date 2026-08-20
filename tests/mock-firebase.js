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
				// Anında boş veriyle çağır (gerçek Firebase de ilk bağlanışta mevcut veriyi verir)
				try { cb(makeSnapshot(null)); } catch (e) { console.error("mock on() callback error", e); }
				return cb;
			},
			once: function () {
				return Promise.resolve(makeSnapshot(null));
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
				return Promise.resolve();
			},
			update: function (data) {
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
