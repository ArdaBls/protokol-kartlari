			// Clickjacking koruması (frame-busting): GitHub Pages statik host olduğu için
			// X-Frame-Options/CSP frame-ancestors HTTP başlığı eklenemiyor -- bu yüzden
			// istemci tarafında telafi ediliyor. Sayfa bir <iframe> içinde açılırsa üst
			// çerçeveyi kendi konumuna yönlendirir. IIFE olarak dosyanın EN BAŞINDA,
			// DOMContentLoaded beklemeden hemen çalışır.
			(function () {
			if (window.top !== window.self) {
			window.top.location = window.self.location;
			}
			})();

			// Firebase Ayarları
			const firebaseConfig = {
			apiKey: "AIzaSyDOfhq3aYW6sg2_zj0sFsRzXeGziGtLxCk",
			authDomain: "omu-protokol.firebaseapp.com",
			databaseURL: "https://omu-protokol-default-rtdb.europe-west1.firebasedatabase.app",
			projectId: "omu-protokol"
			};

			let database = null;
			let auth = null;
			if (firebaseConfig.apiKey) { firebase.initializeApp(firebaseConfig); database = firebase.database(); auth = firebase.auth(); }

			let currentUser = null; // { uid, email, firstName, lastName, role }
			let testModeEnabled = false; // Firebase'de paylaşımlı (ayarlar/testModuAcik) -- açıkken TÜM kayıt loglarının hedefi logs/test olur
			// Faz 10 (Admin > Yedekleme & Çöp): Firebase'de paylaşımlı (ayarlar/saltOkunur) --
			// "acil durum kilidi": admin açtığında HİÇ KİMSE (editörler dahil, admin'in KENDİSİ
			// dahil) kart/etkinlik ekleyip düzenleyemez, sadece görüntüleme yapılabilir. testModuAcik
			// ile AYNI desen (ayarlar/ altında, admin-only yazma), ama etkisi ZIT: veriyi değil,
			// DÜZENLEME YETKİSİNİ kilitler. canEditData()'ya bağlandığı için (aşağıda) tek bir
			// merkezi noktadan TÜM 34+ requireEdit()/edit-only çağrı noktasını otomatik kapsar --
			// her yazma fonksiyonuna ayrı ayrı guard eklemeye GEREK KALMADI.
			let saltOkunurEnabled = false;

			// Çok sayfalı mimari (30 Ağustos 2026): index.html/protokol.html/takvim.html/admin.html
			// HEPSİ aynı app.js'i yükler (tek kod tabanı, dört ayrı sayfa). Her HTML dosyası
			// <body data-page="..."> ile hangi sayfa olduğunu bildirir; PAGE sabiti buna göre
			// yönlendirme/bootstrap kararlarını verir. Eksikse "protokol" varsayılır (geriye dönük
			// güvenlik ağı, ama her 4 dosyada da attribute gerçekte set edilmiş olmalı).
			const PAGE = document.body.getAttribute("data-page") || "protokol";
			function buildTakvimUrl(dateKey, evId) {
				const params = new URLSearchParams();
				if (dateKey) params.set("date", dateKey);
				if (evId) params.set("event", evId);
				const qs = params.toString();
				return "takvim.html" + (qs ? "?" + qs : "");
			}
			// Auth durumu her çözüldüğünde (giriş/çıkış/sayfa yüklenişi) hangi sayfada olduğumuza
			// göre ya yönlendirir ya da o sayfaya özel tek seferlik bootstrap'i tetikler. Misafirler
			// protokol.html/takvim.html'i salt-okunur görebilir (kullanıcı isteği: "giriş yapmadan
			// devam et seçeneği olsun"); sadece admin.html giriş + admin rolü ister.
			function routeForCurrentPage() {
				if (PAGE === "login") {
					if (currentUser) { location.replace("protokol.html"); return; }
					if (!window.__loginFormBooted) { window.__loginFormBooted = true; switchAuthForm("login"); }
					return;
				}
				// protokol.html/takvim.html giriş İSTEMEZ -- misafirler salt-okunur görebilir
				// (kullanıcı: "giriş yapmadan devam et seçeneği olsun ama editör gibi bir
				// genişlikte değişim yapamasınlar"), canEditData()/is-readonly zaten bunu sağlıyor.
				// Sadece admin.html giriş + admin rolü ister.
				if (PAGE === "admin") {
					if (!currentUser) { location.replace("index.html"); return; }
					if (currentUser.role !== "admin" && currentUser.role !== "owner") {
						showToast("Bu bölüm sadece yöneticilere açık.", "error");
						location.replace("protokol.html");
						return;
					}
				}
				if (PAGE === "admin" && !window.__adminBooted) {
					window.__adminBooted = true;
					openAdminPanel();
				}
			}

			function showLoading(msg) { document.getElementById("loadingLabel").textContent = msg || "Yükleniyor…"; document.getElementById("loadingOverlay").classList.add("open"); }
			function hideLoading() { document.getElementById("loadingOverlay").classList.remove("open"); }

			function openAuthForm(view) { document.getElementById("authFormBg").classList.add("open"); switchAuthForm(view || "login"); }
			function closeAuthForm() { document.getElementById("authFormBg").classList.remove("open"); document.getElementById("loginError").textContent = ""; document.getElementById("signupError").textContent = ""; }
			function switchAuthForm(view) {
				document.getElementById("loginForm").style.display = (view === "login") ? "flex" : "none";
				document.getElementById("signupForm").style.display = (view === "signup") ? "flex" : "none";
			}

			async function handleLogin() {
				const email = document.getElementById("li_email").value.trim();
				const pass = document.getElementById("li_password").value;
				const btn = document.getElementById("loginSubmitBtn"); const errEl = document.getElementById("loginError");
				errEl.textContent = ""; btn.disabled = true; btn.textContent = "Giriş yapılıyor…";
				try { await auth.signInWithEmailAndPassword(email, pass); if (document.getElementById("authFormBg")) closeAuthForm(); showToast("Giriş başarılı.", "success"); }
				catch (err) { errEl.textContent = "E-posta veya şifre hatalı."; }
				finally { btn.disabled = false; btn.textContent = "Giriş Yap"; }
			}

			async function handleSignup() {
				const firstName = document.getElementById("su_firstname").value.trim();
				const lastName = document.getElementById("su_lastname").value.trim();
				const email = document.getElementById("su_email").value.trim();
				const pass = document.getElementById("su_password").value;
				const pass2 = document.getElementById("su_password2").value;
				const btn = document.getElementById("signupSubmitBtn"); const errEl = document.getElementById("signupError");
				errEl.textContent = "";
				if (pass !== pass2) { errEl.textContent = "Şifreler eşleşmiyor."; return; }
				if (pass.length < 6) { errEl.textContent = "Şifre en az 6 karakter olmalı."; return; }
				btn.disabled = true; btn.textContent = "Kaydediliyor…";
				try {
					const cred = await auth.createUserWithEmailAndPassword(email, pass);
					await database.ref("users/" + cred.user.uid).set({ firstName: firstName, lastName: lastName, email: email, role: "pending", createdAt: firebase.database.ServerValue.TIMESTAMP });
					if (document.getElementById("authFormBg")) closeAuthForm(); showToast("Kayıt alındı. Admin onayı bekleniyor.", "success");
								} catch (err) {
					console.error("Signup error:", err.code, err.message);
					if (err.code === "auth/email-already-in-use") errEl.textContent = "Bu e-posta zaten kayıtlı.";
					else if (err.code === "auth/weak-password") errEl.textContent = "Şifre çok zayıf, en az 6 karakter olmalı.";
					else if (err.code === "auth/invalid-email") errEl.textContent = "E-posta adresi geçersiz.";
					else if (err.code === "auth/operation-not-allowed") errEl.textContent = "Kayıt sistemi henüz açık değil (Firebase ayarı eksik).";
					else errEl.textContent = "Kayıt oluşturulamadı: " + (err.message || err.code || "bilinmeyen hata");
				}
				finally { btn.disabled = false; btn.textContent = "Kayıt Ol"; }
			}

			function handleLogout() { auth.signOut(); showToast("Çıkış yapıldı.", "success"); }

			// saltOkunurEnabled kontrolü BURADA (rol kontrolüyle AYNI fonksiyonda) -- applyPermissions()
			// zaten canEditData()'ya göre body.is-readonly + .edit-only görünürlüğünü belirliyor,
			// requireEdit() de canEditData()'dan geçiyor -- kilit açılınca admin DAHİL kimse
			// (rolü ne olursa olsun) veri düzenleyemez, tek satırlık bu kontrol otomatik olarak
			// TÜM mevcut yazma yollarına yayılır.
			function canEditData() { return !!(currentUser && (currentUser.role === "editor" || currentUser.role === "admin" || currentUser.role === "owner") && !saltOkunurEnabled); }
			function isAdminUser() { return !!(currentUser && (currentUser.role === "admin" || currentUser.role === "owner")); }

			// .edit-only sınıfı butonları sadece GİZLİYOR; fonksiyonlar global olduğu için konsoldan veya
			// klavyeyle hâlâ çağrılabiliyordu. Yazma yapan her fonksiyon artık bu kapıdan geçiyor.
			function requireEdit() {
				if (saltOkunurEnabled) { showToast("Sistem şu anda salt-okunur modda -- düzenleme geçici olarak kapalı.", "error"); return false; }
				if (canEditData()) return true;
				showToast("Bu işlem için düzenleme yetkiniz yok.", "error");
				return false;
			}
			function requireAdmin() {
				if (isAdminUser()) return true;
				showToast("Bu bölüm sadece yöneticilere açık.", "error");
				return false;
			}

			// ESKIDEN header sagi iki ayri satirdi (rozet+Admin ustte, Cikis altta) -- dar ekranda
			// 2 satira bolunup kalabalik/tutarsiz gorunuyordu (kullanici: header'i bastan
			// tasarla, ergonomik ve kullanici dostu olsun). Artik TEK bir "profil" butonu
			// (avatar + isim) tum admin/cikis secenklerini acilir bir menude toplar -- hem
			// webde hem mobilde AYNI kompakt tek satirlik alan, dropdown ise tikla-ac/disari
			// tikla-kapa (bkz. setupHeaderMenu()).
			function renderAuthUI() {
				const wrap = document.getElementById("headerAuth");
				// Mobil liquid-glass tepsisindeki 3. dugme (admin-fab) sadece admin rolunde
				// gorunur -- faculty-fab'daki .active-list deseniyle ayni, currentUser her
				// degistiginde (giris/cikis/rol degisimi) burada tek noktadan guncellenir.
				const adminFab = document.getElementById("adminFab");
				if (adminFab) adminFab.classList.toggle("active-list", !!(currentUser && (currentUser.role === "admin" || currentUser.role === "owner")));
				if (!currentUser) {
					// Kullanıcı isteği: ana site artık kendi giriş modalını (authFormBg/openAuthForm)
					// KULLANMIYOR -- tek giriş noktası yeni admin panelindeki giris.html. returnTo
					// ile geldiği sayfaya (index/takvim/protokol/admin fark etmez) geri dönüyor.
					wrap.innerHTML = '<button class="btn-auth" onclick="location.href=\'giris.html?returnTo=\'+encodeURIComponent(location.href)">Giriş Yap</button>';
					return;
				}
				const roleLabel = { pending: "Onay Bekliyor", editor: "Editör", admin: "Admin", owner: "Kurucu" }[currentUser.role] || "Onay Bekliyor";
				const displayName = currentUser.firstName || currentUser.email;
				const initial = escapeHtml((displayName || "?").trim().charAt(0).toUpperCase());
				// admin-menu-item: mobilde CSS ile gizlenir (bkz. style.css) -- mobilde bu
				// islevi artik ortadaki admin-fab tasiyor, masaustunde dropdown'da kalmaya devam eder.
				const adminItem = (currentUser.role === "admin" || currentUser.role === "owner") ? '<button type="button" class="header-menu-item admin-menu-item" onclick="closeHeaderMenu(); openAdminPanel();">🛠️ Admin Paneli</button>' : "";
				// Yeni Vite/Gentelella tabanlı admin paneli (admin/ alt klasörü) -- ayrı bir statik
				// site olduğu için openAdminPanel()'in SPA-içi yönlendirmesinden geçmiyor, düz bir
				// sayfa navigasyonu. Eski panel (admin.html) tamamen kaldırılıp bu yeni panel tek
				// giriş noktası olana kadar İKİSİ birden burada listelenir.
				// admin-menu-item DEĞİL: o sınıf mobilde gizleniyor (mobilde eski panele erişimi
				// admin-fab karşılıyor) -- yeni panelin mobilde henüz kendi fab'ı yok, dropdown'da
				// her ekran boyutunda görünür kalmalı.
				const newAdminItem = (currentUser.role === "admin" || currentUser.role === "owner") ? '<button type="button" class="header-menu-item" onclick="closeHeaderMenu(); location.href=\'index.html\';">🆕 Yeni Admin Paneli</button>' : "";
				wrap.innerHTML =
				'<div class="header-profile-wrap">' +
				'<button type="button" class="header-profile-btn ' + (currentUser.role || "pending") + '" id="headerProfileBtn" onclick="toggleHeaderMenu()" aria-haspopup="true" aria-expanded="false" title="Hesap menüsü">' +
					'<span class="hp-avatar">' + initial + '</span>' +
					'<span class="hp-name">' + escapeHtml(displayName) + '</span>' +
					'<span class="hp-caret" aria-hidden="true">▾</span>' +
				'</button>' +
				'<div class="header-menu" id="headerMenu">' +
					'<div class="header-menu-user"><span class="role-dot ' + (currentUser.role || "pending") + '"></span><span class="hm-name">' + escapeHtml(displayName) + '</span><span class="hm-role">' + roleLabel + '</span></div>' +
					adminItem +
					newAdminItem +
					'<button type="button" class="header-menu-item" onclick="closeHeaderMenu(); handleLogout();">↩ Çıkış</button>' +
				'</div>' +
				'</div>';
			}
			let headerMenuOutsideHandler = null;
			function toggleHeaderMenu() {
				const menu = document.getElementById("headerMenu");
				if (!menu) return;
				menu.classList.contains("open") ? closeHeaderMenu() : openHeaderMenu();
			}
			function openHeaderMenu() {
				const menu = document.getElementById("headerMenu"); const btn = document.getElementById("headerProfileBtn");
				if (!menu || !btn) return;
				// renderAuthUI() menu ACIKKEN yeniden cagrilirsa (ör. auth durumu tazelenirse) eski
				// header-menu/buton DOM'dan silinip yenisiyle degistiriliyordu, ama eski dokumana
				// eklenmis mousedown/touchstart/vb dinleyiciler kapatilmadan asili kaliyordu --
				// guvenlik agi olarak her acilista once kapatiliyor.
				closeHeaderMenu();
				// position:fixed oldugu icin (bkz. style.css .header-menu notu -- header{overflow:
				// hidden} kirpmasindan kacinmak icin) konumu butonun GERCEK ekran koordinatina
				// gore burada JS ile hesaplanip satir ici yazilir; CSS'teki top/right'a guvenilemez.
				const r = btn.getBoundingClientRect();
				menu.style.top = (r.bottom + 8) + "px";
				menu.style.right = (window.innerWidth - r.right) + "px";
				menu.classList.add("open"); btn.setAttribute("aria-expanded", "true");
				// Disari tiklama/Escape/kaydirma/yeniden-boyutlandirma ile kapatma -- YALNIZCA menu
				// acikken dinlenir, kapaninca hemen kaldirilir (gereksiz global dinleyici birikmesin).
				// Kaydirma/resize'da KAPATILIR (yeniden konumlandirmak yerine) -- basit ve guvenli,
				// acik bir menuyu sayfa kaydirirken ekranda "yapiskan" birakmak zaten istenmeyen
				// bir davranis olurdu.
				headerMenuOutsideHandler = function (e) {
					if (e.type === "keydown") { if (e.key === "Escape") closeHeaderMenu(); return; }
					if (e.type === "scroll" || e.type === "resize") { closeHeaderMenu(); return; }
					if (!menu.contains(e.target) && !btn.contains(e.target)) closeHeaderMenu();
				};
				document.addEventListener("mousedown", headerMenuOutsideHandler);
				document.addEventListener("touchstart", headerMenuOutsideHandler);
				document.addEventListener("keydown", headerMenuOutsideHandler);
				window.addEventListener("scroll", headerMenuOutsideHandler, { passive: true, capture: true });
				window.addEventListener("resize", headerMenuOutsideHandler, { passive: true });
			}
			function closeHeaderMenu() {
				const menu = document.getElementById("headerMenu"); const btn = document.getElementById("headerProfileBtn");
				if (menu) menu.classList.remove("open");
				if (btn) btn.setAttribute("aria-expanded", "false");
				if (headerMenuOutsideHandler) {
					document.removeEventListener("mousedown", headerMenuOutsideHandler);
					document.removeEventListener("touchstart", headerMenuOutsideHandler);
					document.removeEventListener("keydown", headerMenuOutsideHandler);
					window.removeEventListener("scroll", headerMenuOutsideHandler, { capture: true });
					window.removeEventListener("resize", headerMenuOutsideHandler);
					headerMenuOutsideHandler = null;
				}
			}

			function applyPermissions() {
				const editable = canEditData();
				document.body.classList.toggle("is-readonly", !editable);
				document.body.classList.toggle("is-admin", isAdminUser());
				// Yetki gelmeden önce açılmış bir modal veya seçim modu, yetki düşünce ekranda kalmasın.
				if (!editable) {
					closeModal();
					if (isBulkMode) toggleBulkDeleteMode();
					if (isReorderMode) toggleReorderMode();
					if (mode === "silindi") { mode = "aktif"; applyModeToolbar(); }
					render();
					return;
				}
				if (!isBulkMode && !isNewsMode) render();
			}

			let userProfileRef = null; let userProfileCallback = null;
			if (auth) {
				var OFFLINE_FALLBACK_TIMEOUT_MS = window.OFFLINE_FALLBACK_TIMEOUT_MS || 5000; // test'te page.addInitScript ile window.OFFLINE_FALLBACK_TIMEOUT_MS onceden set edilip kisaltilabilir
				function enterOfflineReadonlyMode(){
					hideLoading();
					showToast("İnternet bağlantısı yok — sınırlı (salt okunur) modda görüntüleniyor.", "warn");
					applyPermissions();
				}
				// Adi verilip disariya cikarildi ki hem onAuthStateChanged'in normal tetiklenmesinde
				// hem de asagidaki "online" dinleyicisinde AYNI mantik tekrar cagirilabilsin.
				function resolveAuthUser(user) {
					if (userProfileRef && userProfileCallback) { userProfileRef.off("value", userProfileCallback); userProfileRef = null; }
					if (!user) { currentUser = null; renderAuthUI(); applyPermissions(); routeForCurrentPage(); return; }
					// navigator.onLine, ucak modunda tarayici/OS tarafindan guvenilir sekilde false
					// yapiliyor -- Firebase'in .on("value") yanitini hic beklemeden SENKRON karar
					// verilebilir. Onceki (sadece 8sn setTimeout'a dayanan) surum gercek iPhone'da
					// hala takiliyordu -- muhtemel sebep: ucak modunu acmak Kontrol Merkezi'ni acip
					// PWA'yi arka plana atiyor, iOS arka plandaki setTimeout'lari duraklatabiliyor.
					if (navigator.onLine === false) { enterOfflineReadonlyMode(); return; }
					showLoading("Yetkiler kontrol ediliyor…");
					// OS "bagliyim" dese de Firebase'e hic ulasilamayabilir (zayif sinyal, walled
					// garden vb.) -- bu durumlar icin YEDEK bir zaman asimi. Baglanti beklerken
					// aniden koparsa (offline event) zamanlayiciyi beklemeden aninda devreye girer.
					var profileResolved = false;
					var offlineFallbackTimer = setTimeout(function(){ if (!profileResolved) enterOfflineReadonlyMode(); }, OFFLINE_FALLBACK_TIMEOUT_MS);
					function onGoOffline(){ if (!profileResolved) { clearTimeout(offlineFallbackTimer); enterOfflineReadonlyMode(); } }
					window.addEventListener("offline", onGoOffline, { once: true });
					userProfileRef = database.ref("users/" + user.uid);
					userProfileCallback = function(snap) {
						profileResolved = true;
						clearTimeout(offlineFallbackTimer);
						window.removeEventListener("offline", onGoOffline);
						if (!snap.exists()) {
							// "Yetim hesap" onarimi: Auth kaydi basarili olup users/{uid} yazimi (signup
							// sirasinda aginin kopmasi, ya da veritabaninin tamamen silinmesi gibi) hic
							// gerceklesmemis/kaybolmussa, kullanici sonsuza kadar rolsuz/GORUNMEZ kalirdi --
							// admin panelindeki kullanici listesi bile users/ dugumunun cocuklarindan
							// olusuyor, yani admin bu kisiyi role atamak icin GOREMEZDI bile. Rules zaten
							// bu yazima izin veriyor (auth.uid===$uid && !data.exists() && newData.val()
							// ==='pending') -- signup'taki AYNI kosul, sadece "kayit aninda" degil "ilk
							// basarili girisin herhangi bir aninda" calisacak sekilde genisletiliyor.
							database.ref("users/" + user.uid).set({ firstName: "", lastName: "", email: user.email || "", role: "pending", createdAt: firebase.database.ServerValue.TIMESTAMP })
								.catch(function(err) {
									console.error("Yetim hesap onarimi basarisiz:", err);
									// Onarim yazimi basarisiz olsa bile kullanici SONSUZA kadar yukleme
									// ekraninda kalmasin -- yerel/kalicilastirilmamis "pending" ile devam eder,
									// bir sonraki basarili girishte tekrar denenir.
									currentUser = { uid: user.uid, email: user.email, firstName: "", lastName: "", role: "pending" };
									renderAuthUI(); applyPermissions(); hideLoading(); routeForCurrentPage();
								});
							return; // basarili olursa bu callback zaten YENI veriyle tekrar tetiklenir
						}
						const profile = snap.val() || {};
						currentUser = { uid: user.uid, email: user.email, firstName: profile.firstName || "", lastName: profile.lastName || "", role: profile.role || "pending" };
						renderAuthUI(); applyPermissions(); hideLoading(); routeForCurrentPage();
					};
					userProfileRef.on("value", userProfileCallback);
				}
				auth.onAuthStateChanged(resolveAuthUser);
				// Cevrimdisi salt-okunur moddan (enterOfflineReadonlyMode -> currentUser=null kalir)
				// baglanti geri gelince KENDILIGINDEN cikilsin -- eskiden kullanici sayfayi ELLE
				// yenilemek zorundaydi, cunku Firebase Auth durumu zaten "giris yapilmis" kaldigi icin
				// onAuthStateChanged baglanti kesilip-donmesinde YENIDEN tetiklenmiyor.
				window.addEventListener("online", function () {
					if (!currentUser && auth.currentUser) resolveAuthUser(auth.currentUser);
				});
			}

			function openAdminPanel() {
				if (!currentUser || (currentUser.role !== "admin" && currentUser.role !== "owner")) return;
				if (PAGE !== "admin") { location.href = "admin.html"; return; }
				document.getElementById("adminPanelBg").classList.add("open");
				updateStatusBanner();
				loadTestModeLog();
				switchAdminTab("dashboard");
				loadAdminOverview();
			}
			// Sekmeler arasında HER ZAMAN görünen özet şeridi -- switchAdminTab() sekme içeriğini
			// değiştirirken bu şeridE dokunmaz, o yüzden ayrı çağrılır (panel açılışında ve Test
			// Modu her değiştiğinde -- bkz. setTestMode()). users/il/üniversite fetch'i
			// loadAdminUsers()'dan bağımsız, KPI şeridi kendi hafif sorgusunu yapar.
			function loadAdminOverview() {
				if (!database || !requireAdmin()) return;
				const pendingEl = document.getElementById("akPendingUsers");
				const totalEl = document.getElementById("akTotalPeople");
				const neverEl = document.getElementById("akNeverVerified");
				const testEl = document.getElementById("akTestMode");
				const testKpiEl = document.getElementById("akTestModeKpi");
				if (!pendingEl) return;
				testEl.textContent = testModeEnabled ? "Açık" : "Kapalı";
				testKpiEl.classList.toggle("ak-warn", testModeEnabled);
				Promise.all([
					database.ref("users").once("value"),
					database.ref(dbPath("ilProtokolVerileri")).once("value"),
					database.ref(dbPath("universiteProtokolVerileri")).once("value")
				]).then(function(snaps){
					const users = Object.values(snaps[0].val() || {});
					pendingEl.textContent = users.filter(function(u){ return (u.role || "pending") === "pending"; }).length;
					const ilList = Object.values(snaps[1].val() || {});
					const uniList = Object.values(snaps[2].val() || {});
					const allPeople = ilList.concat(uniList);
					totalEl.textContent = allPeople.length;
					neverEl.textContent = allPeople.filter(function(p){ return !p.sonDogrulamaTs; }).length;
				}).catch(function(){ pendingEl.textContent = totalEl.textContent = neverEl.textContent = "?"; });
			}
			function closeAdminPanel() {
				if (PAGE === "admin") { location.href = "protokol.html"; return; }
				document.getElementById("adminPanelBg").classList.remove("open");
			}

			// Faz 9: sidebar 4 akordeon gruba bölündü (Genel/Saha/Protokol/Sistem), 4 sekme
			// 11'e çıktı. ADMIN_TAB_GROUPS her sekmenin hangi grupta olduğunu tutar --
			// switchAdminTab() sekme değişince o grubu otomatik açar (openAdminNavGroup()).
			const ADMIN_TAB_TITLES = {
				dashboard: "Kontrol Paneli",
				hierarchy: "Hiyerarşi & Kadro", integrity: "Kart Sağlığı", dictionary: "Veri Sözlüğü",
				users: "Kullanıcılar & PIN", logs: "Denetim Günlüğü", test: "Test & Sistem", backup: "Yedekleme & Çöp"
			};
			const ADMIN_TAB_GROUPS = {
				dashboard: "Genel",
				hierarchy: "Protokol", integrity: "Protokol", dictionary: "Protokol",
				users: "Sistem", logs: "Sistem", test: "Sistem", backup: "Sistem"
			};
			// view id'si "field-ops" -> "adminFieldOpsView" gibi kebab-case'i camelCase'e çevirir --
			// tek noktadan üretildiği için yeni sekme eklerken burada elle eşleme tutmaya gerek yok.
			function adminTabViewId(tab) {
				return "admin" + tab.split("-").map(function(w){ return w.charAt(0).toUpperCase() + w.slice(1); }).join("") + "View";
			}
			function adminTabBtnId(tab) {
				return "adminTab" + tab.split("-").map(function(w){ return w.charAt(0).toUpperCase() + w.slice(1); }).join("") + "Btn";
			}
			function switchAdminTab(tab) {
				if (!requireAdmin()) return;
				Object.keys(ADMIN_TAB_TITLES).forEach(function(t) {
					const view = document.getElementById(adminTabViewId(t));
					if (view) view.style.display = (t === tab) ? "block" : "none";
					const btn = document.getElementById(adminTabBtnId(t));
					if (btn) btn.classList.toggle("active", t === tab);
				});
				const titleEl = document.getElementById("adminMainTitle");
				if (titleEl) titleEl.textContent = ADMIN_TAB_TITLES[tab] || "";
				if (ADMIN_TAB_GROUPS[tab]) openAdminNavGroup(ADMIN_TAB_GROUPS[tab]);
				if (tab === "users") loadAdminUsers();
				else if (tab === "test") loadAdminTestPanel();
				else if (tab === "logs") { loadAdminLogs(); loadTestModeLog(); }
				else if (tab === "dashboard") loadAdminDashboard();
				else if (tab === "hierarchy") loadHierarchy();
				else if (tab === "integrity") loadIntegrity();
				else if (tab === "dictionary") loadDictionary();
				// backup: henüz yükleyici fonksiyonu yok (sonraki aşama, en riskli parça --
				// global salt-okunur kilit tüm yazma yollarını etkileyecek), view "yakında"
				// placeholder gösteriyor.
				// Mobilde bir sekme seçilince çekmece kapanır -- masaüstünde drawer zaten hiç
				// açılmadığı (CSS'te display:none) için burada no-op, ekstra bir genişlik
				// kontrolüne gerek yok.
				closeAdminDrawer();
			}
			// Faz 11: mobil sidebar çekmecesi (nav drawer) -- namethatui.com/web/hamburger-menu
			// deseninden aria-expanded/aria-controls + Escape/dışarı-tıklama ile kapanma +
			// odak-geri-dönüşü korundu. .admin-sidebar.open artık position:fixed bir slide-over
			// (bkz. style.css) -- .admin-main'i itmiyor (önceki PUSH modeli dar telefon
			// ekranlarında içeriği sıkıştırıyordu), üstüne kayıyor + CSS'te ::before ile hafif bir
			// scrim geliyor (pointer-events:none, tıklamayı yakalamıyor).
			let adminDrawerEscHandler = null;
			function openAdminDrawer() {
				const sidebar = document.getElementById("adminSidebarDrawer");
				const toggle = document.getElementById("adminDrawerToggle");
				if (!sidebar || !toggle) return;
				sidebar.classList.add("open");
				const dashboard = sidebar.closest(".admin-dashboard");
				if (dashboard) dashboard.classList.add("drawer-open");
				toggle.setAttribute("aria-expanded", "true");
				// Capture fazında (3. parametre true) + stopPropagation: admin panelinin KENDİ
				// genel Escape dinleyicisi (aşağıda, MODAL_CLOSE_FNS -- .modal-bg.open'ı hedefler,
				// adminPanelBg da bir .modal-bg) bubble fazında document'e bağlı -- ikisi de
				// tetiklenirse Escape TÜM admin panelini de kapatıyordu (drawer'ın DIŞINDA,
				// istenmeyen bir yan etki). Capture + stopPropagation, bubble fazına hiç
				// ULAŞMADAN olayı burada durdurur -- SADECE çekmece kapanır.
				adminDrawerEscHandler = function(e) { if (e.key === "Escape") { e.stopPropagation(); closeAdminDrawer(); } };
				document.addEventListener("keydown", adminDrawerEscHandler, true);
			}
			function closeAdminDrawer() {
				const sidebar = document.getElementById("adminSidebarDrawer");
				const toggle = document.getElementById("adminDrawerToggle");
				if (!sidebar || !sidebar.classList.contains("open")) return; // zaten kapalı -- odağı GEREKSİZ YERE tetikleyiciye çekme
				sidebar.classList.remove("open");
				const dashboard = sidebar.closest(".admin-dashboard");
				if (dashboard) dashboard.classList.remove("drawer-open");
				if (toggle) { toggle.setAttribute("aria-expanded", "false"); toggle.focus(); }
				if (adminDrawerEscHandler) { document.removeEventListener("keydown", adminDrawerEscHandler, true); adminDrawerEscHandler = null; }
			}
			function toggleAdminDrawer() {
				const sidebar = document.getElementById("adminSidebarDrawer");
				if (sidebar && sidebar.classList.contains("open")) closeAdminDrawer(); else openAdminDrawer();
			}
			// Scrim olmadığı için "dışarı tıklayınca kapan" davranışı ayrı, hep-bağlı (attach/
			// detach gerektirmeyen) delegated bir dinleyiciyle sağlanır -- sadece çekmece açıkken
			// ve tıklama sidebar/toggle'ın DIŞINDAYSA devreye girer (nav öğesi tıklamaları zaten
			// switchAdminTab() içindeki closeAdminDrawer() çağrısıyla kapanıyor, burası SADECE
			// "boş alana/içeriğe tıklama" durumunu yakalar).
			document.addEventListener("click", function(e) {
				const sidebar = document.getElementById("adminSidebarDrawer");
				const toggle = document.getElementById("adminDrawerToggle");
				if (!sidebar || !sidebar.classList.contains("open")) return;
				if (sidebar.contains(e.target) || (toggle && toggle.contains(e.target))) return;
				closeAdminDrawer();
			});
			// Sidebar akordeon: AdminLTE'nin treeview.ts'indeki "accordion:true" davranışının vanilla
			// portu -- Bootstrap/TS alınmadı, sadece mantık: bir grup açılınca diğerleri kapanır.
			function openAdminNavGroup(groupId) {
				document.querySelectorAll(".admin-nav-group").forEach(function(g) {
					const isTarget = g.id === "admGroup" + groupId;
					g.classList.toggle("open", isTarget);
					const header = g.querySelector(".admin-nav-header");
					if (header) header.setAttribute("aria-expanded", String(isTarget));
				});
			}
			function toggleAdminNavGroup(groupId) {
				const group = document.getElementById("admGroup" + groupId);
				if (group && group.classList.contains("open")) {
					group.classList.remove("open");
					const header = group.querySelector(".admin-nav-header");
					if (header) header.setAttribute("aria-expanded", "false");
					return;
				}
				openAdminNavGroup(groupId);
			}

			// GitHub Actions ile regresyon testi: repo/workflow adi tek yerden - baska bir repoya
			// tasinirsa sadece burasi degismeli.
			const REGRESSION_TEST_REPO = "ArdaBls/protokol-kartlari";
			const REGRESSION_TEST_WORKFLOW_FILE = "regresyon-testi.yml";
			// Tetikleme GitHub'in KENDI sayfasinda oluyor (guvenlik nedeniyle - bir yetki anahtarini
			// sitenin JS koduna gomup herkese acik etmek istemedik). Admin burada tek tikla
			// "Run workflow" diyor, sonuc ise GitHub'in genel-erisimli (herkese acik repo icin kimlik
			// dogrulama gerektirmeyen) API'siyle asagida otomatik okunup gosteriliyor.
			function openRegressionTestRunner() {
				if (!requireAdmin()) return;
				window.open("https://github.com/" + REGRESSION_TEST_REPO + "/actions/workflows/" + REGRESSION_TEST_WORKFLOW_FILE, "_blank", "noopener,noreferrer");
			}
			async function loadAdminTestPanel() {
				if (!requireAdmin()) return;
				const box = document.getElementById("adminTestResult");
				box.textContent = "Yükleniyor…";
				try {
					const res = await fetch("https://api.github.com/repos/" + REGRESSION_TEST_REPO + "/actions/workflows/" + REGRESSION_TEST_WORKFLOW_FILE + "/runs?per_page=1");
					if (!res.ok) { box.textContent = "GitHub'dan sonuç alınamadı (HTTP " + res.status + ")."; return; }
					const data = await res.json();
					const run = data.workflow_runs && data.workflow_runs[0];
					if (!run) { box.innerHTML = '<p>Bu test hiç çalıştırılmamış. Yukarıdaki "Testi Çalıştır" butonuna basıp GitHub sayfasında "Run workflow" de.</p>'; return; }
					const when = new Date(run.created_at).toLocaleString("tr-TR");
					let statusLabel, statusColor;
					if (run.status !== "completed") { statusLabel = "⏳ Çalışıyor… (" + run.status + ")"; statusColor = "#a8631a"; }
					else if (run.conclusion === "success") { statusLabel = "✅ Başarılı"; statusColor = "#2a7d3f"; }
					else { statusLabel = "❌ Başarısız (" + (run.conclusion || "bilinmeyen") + ")"; statusColor = "#a33"; }
					box.innerHTML =
						'<p style="font-weight:600; color:' + statusColor + ';">' + statusLabel + '</p>' +
						'<p>Çalıştırma zamanı: ' + escapeHtml(when) + ' · #' + run.run_number + '</p>' +
						'<p><a href="' + escapeHtml(run.html_url) + '" target="_blank" rel="noopener noreferrer">GitHub\'da detayları gör ↗</a></p>';
				} catch (err) {
					box.textContent = "Sonuç alınamadı: " + (err && err.message ? err.message : "bilinmeyen hata") + " (internet bağlantısını kontrol et)";
				}
			}


			// ---- Faz 9 Part B adım 3: salt-okuma sekmeleri (dashboard/field-ops/editorial/
			// hierarchy/integrity) ortak yardımcıları ----
			// `people` global'i TEK bir listeye (currentListKey) bağlı (attachListener()), il+
			// üniversite ikisini BİRDEN taramak isteyen sekmeler loadAdminOverview()'daki gibi
			// kendi ayrı fetch'ini yapmak zorunda. id'ler korunur (Object.keys), çünkü ileride bir
			// kayda link vermek/aksiyon almak için gerekebilir.
			function fetchAllPeople() {
				if (!database) return Promise.resolve({ il: [], universite: [] });
				return Promise.all([
					database.ref(dbPath("ilProtokolVerileri")).once("value"),
					database.ref(dbPath("universiteProtokolVerileri")).once("value")
				]).then(function(snaps) {
					function toArr(snap, listKey) {
						const v = snap.val() || {};
						return Object.keys(v).map(function(id) { return Object.assign({ _id: id, _list: listKey }, v[id]); });
					}
					return { il: toArr(snaps[0], "il"), universite: toArr(snaps[1], "universite") };
				});
			}
			// ReUI referansı (görsel desen, kod alınmadı): tek çubuk, kategori sayısı kadar renkli
			// segment + altında nokta+etiket+yüzde lejantı.
			function statSegmentedBarHtml(segments, colors) {
				const total = segments.reduce(function(s, seg) { return s + seg.n; }, 0) || 1;
				const bar = segments.map(function(seg, i) {
					const pct = (seg.n / total) * 100;
					if (!pct) return "";
					return '<span style="flex:' + pct + ' 0 0; background:' + (colors[i] || "var(--muted)") + ';"></span>';
				}).join("");
				const legend = segments.map(function(seg, i) {
					return '<span class="stat-bar-legend-item"><span class="stat-bar-legend-dot" style="background:' + (colors[i] || "var(--muted)") + ';"></span>' + escapeHtml(seg.k) + ': ' + seg.n + '</span>';
				}).join("");
				return '<div class="stat-bar">' + bar + '</div><div class="stat-bar-legend">' + legend + '</div>';
			}

			// ---- dashboard: "acil" kart grid'i ----
			async function loadAdminDashboard() {
				if (!requireAdmin()) return;
				const box = document.getElementById("adminDashboardBody");
				if (!box) return;
				box.innerHTML = '<p class="admin-user-empty">Yükleniyor…</p>';
				const [peopleData] = await Promise.all([fetchAllPeople()]);
				const uniActive = peopleData.universite.filter(function(p) { return p.status === "aktif"; });
				const unitNames = FACULTY_GROUPS.filter(function(g) { return g.title !== "Rektörlük"; }).reduce(function(a, g) { return a.concat(g.items); }, []);
				const occupiedUnits = new Set();
				uniActive.forEach(function(p) { (p.faculties || []).forEach(function(f) { occupiedUnits.add(f); }); });
				const vacantUnits = unitNames.filter(function(u) { return !occupiedUnits.has(u); });

				function cardHtml(icon, count, label, tone) {
					return '<div class="dash-alert-card' + (tone ? " " + tone : "") + '"><span class="dash-alert-num">' + count + '</span><span class="dash-alert-label">' + escapeHtml(label) + '</span></div>';
				}
				box.innerHTML = '<div class="dash-alert-grid">' +
					cardHtml("🏛️", vacantUnits.length, "Boş Kadro (Birim)", vacantUnits.length ? "ak-warn" : "") +
					'</div>';
			}

			// ---- hierarchy: boş kadro + vekil taraması + rank çelişkisi ----
			async function loadHierarchy() {
				if (!requireAdmin()) return;
				const box = document.getElementById("adminHierarchyBody");
				if (!box) return;
				box.innerHTML = '<p class="admin-user-empty">Yükleniyor…</p>';
				const peopleData = await fetchAllPeople();
				const uniActive = peopleData.universite.filter(function(p) { return p.status === "aktif"; });
				const unitNames = FACULTY_GROUPS.filter(function(g) { return g.title !== "Rektörlük"; }).reduce(function(a, g) { return a.concat(g.items); }, []);
				const occupied = {};
				uniActive.forEach(function(p) { (p.faculties || []).forEach(function(f) { occupied[f] = (occupied[f] || 0) + 1; }); });
				const vacant = unitNames.filter(function(u) { return !occupied[u]; });

				const vekilRe = /vekil|\bv\.\s*$/i;
				const vekilList = uniActive.filter(function(p) { return vekilRe.test(p.title || ""); });

				// Rank çok üst (1-5) ama unvan METNİ TITLE_HIERARCHY'de junior okunuyorsa (ör.
				// "Araştırma Görevlisi") ya rank hatalı girilmiş ya unvan güncellenmemiş demektir.
				const mismatches = uniActive.filter(function(p) {
					const r = Number(p.rank);
					if (!r || r > 5 || isCentralAdminPerson(p)) return false;
					const tw = getTitleWeight(p.title);
					return tw === null || tw >= 13;
				});

				box.innerHTML =
					'<div class="dash-alert-grid">' +
					'<div class="dash-alert-card' + (vacant.length ? " ak-warn" : "") + '"><span class="dash-alert-num">' + vacant.length + '</span><span class="dash-alert-label">Boş Kadro</span></div>' +
					'<div class="dash-alert-card' + (vekilList.length ? " ak-warn" : "") + '"><span class="dash-alert-num">' + vekilList.length + '</span><span class="dash-alert-label">Vekâleten Görev</span></div>' +
					'<div class="dash-alert-card' + (mismatches.length ? " ak-warn" : "") + '"><span class="dash-alert-num">' + mismatches.length + '</span><span class="dash-alert-label">Rank/Unvan Uyuşmazlığı</span></div>' +
					'</div>' +
					'<h4 class="dash-alert-subhead">Boş Kadrolar (' + vacant.length + ')</h4>' +
					(vacant.length ? '<div class="stat-expiry-list">' + vacant.map(function(u) { return '<div class="stat-expiry-row"><span class="stat-expiry-name">' + escapeHtml(u) + '</span></div>'; }).join("") + '</div>' : '<p class="admin-user-empty">Tüm birimlerde en az bir aktif kayıt var.</p>') +
					'<h4 class="dash-alert-subhead">Vekâleten Görevler</h4>' +
					(vekilList.length ? '<div class="stat-expiry-list">' + vekilList.map(function(p) { return '<div class="stat-expiry-row"><span class="stat-expiry-name">' + escapeHtml(p.name || "") + ' — ' + escapeHtml(p.title || "") + '</span></div>'; }).join("") + '</div>' : '<p class="admin-user-empty">Yok.</p>') +
					'<h4 class="dash-alert-subhead">Rank/Unvan Uyuşmazlığı</h4>' +
					(mismatches.length ? '<div class="stat-expiry-list">' + mismatches.map(function(p) { return '<div class="stat-expiry-row"><span class="stat-expiry-name">' + escapeHtml(p.name || "") + ' — sıra ' + escapeHtml(String(p.rank)) + ', unvan: ' + escapeHtml(p.title || "(boş)") + '</span></div>'; }).join("") + '</div>' : '<p class="admin-user-empty">Yok.</p>');
			}

			// ---- integrity: eksik fotoğraf + mükerrer isim + doğrulama tazeliği ----
			async function loadIntegrity() {
				if (!requireAdmin()) return;
				const box = document.getElementById("adminIntegrityBody");
				if (!box) return;
				box.innerHTML = '<p class="admin-user-empty">Yükleniyor…</p>';
				const peopleData = await fetchAllPeople();
				const allActive = peopleData.il.concat(peopleData.universite).filter(function(p) { return p.status === "aktif"; });

				const missingPhoto = allActive.filter(function(p) { return !p.photo; });

				const byName = {};
				allActive.forEach(function(p) { const key = (p.name || "").trim().toLocaleLowerCase("tr-TR"); if (!key) return; (byName[key] = byName[key] || []).push(p); });
				const duplicates = Object.keys(byName).map(function(k) { return byName[k]; }).filter(function(arr) { return arr.length > 1; });

				const freshCounts = { green: 0, yellow: 0, red: 0 };
				allActive.forEach(function(p) { freshCounts[getFreshnessInfo(p).level]++; });
				const freshSegments = [{ k: "Güncel", n: freshCounts.green }, { k: "90+ Gün", n: freshCounts.yellow }, { k: "Hiç/1 Yıl+", n: freshCounts.red }];
				const freshColors = ["#15803d", "#b45309", "#b03a3a"];

				box.innerHTML =
					'<div class="dash-alert-grid">' +
					'<div class="dash-alert-card' + (missingPhoto.length ? " ak-warn" : "") + '"><span class="dash-alert-num">' + missingPhoto.length + '</span><span class="dash-alert-label">Fotoğrafsız Kayıt</span></div>' +
					'<div class="dash-alert-card' + (duplicates.length ? " ak-warn" : "") + '"><span class="dash-alert-num">' + duplicates.length + '</span><span class="dash-alert-label">Mükerrer İsim</span></div>' +
					'</div>' +
					'<h4 class="dash-alert-subhead">Doğrulama Tazeliği</h4>' + statSegmentedBarHtml(freshSegments, freshColors) +
					'<h4 class="dash-alert-subhead">Fotoğrafsız Kayıtlar (' + missingPhoto.length + ')</h4>' +
					(missingPhoto.length ? '<div class="stat-expiry-list">' + missingPhoto.slice(0, 30).map(function(p) { return '<div class="stat-expiry-row"><span class="stat-expiry-name">' + escapeHtml(p.name || "") + ' (' + (p._list === "il" ? "İl" : "Üniversite") + ')</span></div>'; }).join("") + '</div>' : '<p class="admin-user-empty">Yok.</p>') +
					'<h4 class="dash-alert-subhead">Mükerrer İsimler (' + duplicates.length + ')</h4>' +
					(duplicates.length ? '<div class="stat-expiry-list">' + duplicates.map(function(arr) { return '<div class="stat-expiry-row"><span class="stat-expiry-name">' + escapeHtml(arr[0].name || "") + ' — ' + arr.length + ' kayıt (' + arr.map(function(p) { return p._list === "il" ? "İl" : "Üniversite"; }).join(", ") + ')</span></div>'; }).join("") + '</div>' : '<p class="admin-user-empty">Yok.</p>');
			}

			// Faz 10 (Part B'nin son ölçülü aşaması): "Veri Sözlüğü" -- kişi formundaki birim/unvan
			// öneri (otomatik tamamlama) havuzunu (oneriler/{il|universite}/{birimler|unvanlar})
			// yönetir. Bilinçli kapsam kararı: sadece SİLME var, "birleştirme" (merge) YOK --
			// birleştirme mevcut TÜM kişi kayıtlarındaki eski değeri yeniyle değiştirmeyi
			// gerektirir (çok daha riskli, ayrı bir iş kalemi). Silme SADECE öneri listesinden
			// kaldırır, hiçbir kişi kaydına dokunmaz -- bu yüzden düşük risklidir.
			async function loadDictionary() {
				if (!database || !requireAdmin()) return;
				const box = document.getElementById("adminDictionaryBody");
				if (!box) return;
				box.innerHTML = '<p class="admin-user-empty">Yükleniyor…</p>';
				const [ilSnap, uniSnap] = await Promise.all([
					database.ref(dbPath("oneriler/il")).once("value"),
					database.ref(dbPath("oneriler/universite")).once("value")
				]);
				const sections = [
					{ listKey: "il", label: "İl Protokol", val: ilSnap.val() || {} },
					{ listKey: "universite", label: "Üniversite Protokol", val: uniSnap.val() || {} }
				];
				const kindLabels = { birimler: "Birimler", unvanlar: "Unvanlar" };
				let html = "";
				sections.forEach(function(sec) {
					["birimler", "unvanlar"].forEach(function(kind) {
						const entries = Object.keys(sec.val[kind] || {})
							.map(function(id) { return { id: id, deger: (sec.val[kind][id] || {}).deger }; })
							.filter(function(e) { return e.deger; })
							.sort(function(a, b) { return a.deger.localeCompare(b.deger, "tr"); });
						html += '<div class="dict-section"><h3 class="dict-section-title">' + escapeHtml(sec.label) + ' · ' + kindLabels[kind] + ' <span class="dict-count">' + entries.length + '</span></h3>';
						html += !entries.length
							? '<p class="admin-user-empty">Kayıt yok.</p>'
							: '<div class="dict-list">' + entries.map(function(e) {
								// Deger, onclick STRING'İNE gömülmek yerine data-* özniteliğinden okunur
								// (proje kuralı -- bkz. card.dataset.pid deseni, tırnak/özel karakter
								// içeren kişi verisi inline onclick'te kaçış sorunlarına yol açıyordu).
								return '<div class="dict-row"><span class="dict-val">' + escapeHtml(e.deger) + '</span><button type="button" class="dict-del-btn" data-list-key="' + sec.listKey + '" data-kind="' + kind + '" data-oneri-id="' + e.id + '" data-deger="' + escapeHtml(e.deger) + '" onclick="deleteDictionaryEntry(this)" title="Öneriyi sil">🗑</button></div>';
							}).join("") + '</div>';
						html += '</div>';
					});
				});
				box.innerHTML = html;
			}
			async function deleteDictionaryEntry(btn) {
				if (!requireAdmin()) return;
				const listKey = btn.dataset.listKey, kind = btn.dataset.kind, id = btn.dataset.oneriId, deger = btn.dataset.deger;
				if (!confirm('"' + deger + '" önerisi silinsin mi?\n\nBu SADECE otomatik tamamlama listesinden kaldırır, mevcut kişi kayıtlarına dokunmaz.')) return;
				await guardOp("dict-del-" + id, async function() {
					try {
						await database.ref(dbPath("oneriler/" + listKey + "/" + kind + "/" + id)).remove();
						database.ref(dbPath("logs/dictionary")).push({
							by: ((currentUser.firstName || "") + " " + (currentUser.lastName || "")).trim() || currentUser.email,
							email: currentUser.email, action: "Öneri silindi (" + (kind === "birimler" ? "birim" : "unvan") + ")",
							target: deger, timestamp: firebase.database.ServerValue.TIMESTAMP
						}).catch(function() {});
						showToast("Öneri silindi.", "success");
						loadDictionary();
					} catch (err) {
						console.error("Öneri silinemedi:", err);
						showToast("Öneri silinemedi (yetki sorunu olabilir).", "error");
					}
				});
			}

			function loadAdminLogs() {
				if (!database || !requireAdmin()) return;
				const listEl = document.getElementById("adminLogList");
				listEl.innerHTML = '<p class="admin-user-empty">Yükleniyor…</p>';
				Promise.all([
				database.ref("logs/il").limitToLast(50).once("value"),
				database.ref("logs/universite").limitToLast(50).once("value"),
				database.ref("logs/etkinlik").limitToLast(50).once("value"),
				database.ref("logs/hesap").limitToLast(50).once("value"),
				database.ref("logs/dictionary").limitToLast(50).once("value")
				]).then(function(snaps) {
				const ilLogs = Object.values(snaps[0].val() || {}).map(function(e){ e._list = "il"; return e; });
				const uniLogs = Object.values(snaps[1].val() || {}).map(function(e){ e._list = "universite"; return e; });
				const evLogs = Object.values(snaps[2].val() || {}).map(function(e){ e._list = "etkinlik"; return e; });
				const hesapLogs = Object.values(snaps[3].val() || {}).map(function(e){ e._list = "hesap"; return e; });
				const dictLogs = Object.values(snaps[4].val() || {}).map(function(e){ e._list = "dictionary"; return e; });
				const entries = ilLogs.concat(uniLogs).concat(evLogs).concat(hesapLogs).concat(dictLogs).sort(function(a,b){ return (b.timestamp||0) - (a.timestamp||0); }).slice(0, 50);
				if (!entries.length) { listEl.innerHTML = '<p class="admin-user-empty">Henüz kayıt yok.</p>'; return; }
				listEl.innerHTML = entries.map(function(e) {
				const timeStr = new Date(e.timestamp || 0).toLocaleString("tr-TR");
				const listLabel = LIST_LABELS[e._list] || e._list;
				// Mesaj " · " ile parçalanır: ilk parça başlık, kalan parçalar "hangi alan değişti" detaylarıdır.
				const parts = String(e.action || "").split(" · ");
				let headline = parts.shift() || "";
				// Eski log kayıtlarında "target" alanı yok — o zaman rozet gösterilmez, eski görünüm aynen kalır.
				let targetHtml = "";
				if (e.target) {
					targetHtml = '<span class="al-target">' + escapeHtml(e.target) + '</span> ';
					// İsim hem rozette hem cümlenin başında tekrar etmesin diye cümleden çıkarılır.
					if (headline.indexOf(e.target) === 0) headline = headline.slice(e.target.length).replace(/^\s+/, "");
				}
				const detailHtml = parts.map(function(part) {
					const sepIdx = part.indexOf(":");
					if (sepIdx > 0) return '<span class="al-detail"><b>' + escapeHtml(part.slice(0, sepIdx)) + '</b>' + escapeHtml(part.slice(sepIdx)) + '</span>';
					return '<span class="al-detail">' + escapeHtml(part) + '</span>';
				}).join("");
				return '<div class="admin-log-row"><div class="al-top"><span class="al-by">' + escapeHtml(e.by || e.email || "?") + '</span><span class="al-time">' + timeStr + '</span></div><div class="al-action">' + targetHtml + escapeHtml(headline) + ' <span style="color:var(--muted); font-size:11px;">· ' + escapeHtml(listLabel) + '</span>' + detailHtml + '</div></div>';
				}).join("");
				}).catch(function() { listEl.innerHTML = '<p class="admin-user-empty">Kayıtlar yüklenemedi.</p>'; });
				}

			function loadAdminUsers() {
				if (!database || !requireAdmin()) return;
				const listEl = document.getElementById("adminUserList");
				listEl.innerHTML = '<p class="admin-user-empty">Yükleniyor…</p>';
				database.ref("users").once("value").then(function(snap) {
					const usersObj = snap.val() || {};
					const uids = Object.keys(usersObj);
					if (!uids.length) { listEl.innerHTML = '<p class="admin-user-empty">Henüz kayıtlı kullanıcı yok.</p>'; return; }
					uids.sort(function(a,b){ return (usersObj[b].createdAt||0) - (usersObj[a].createdAt||0); });
					const roleLabelsForList = { pending: "Onay Bekliyor", editor: "Editör", admin: "Admin", owner: "Kurucu" };
					listEl.innerHTML = uids.map(function(uid) {
						const u = usersObj[uid];
						const fullName = ((u.firstName||"") + " " + (u.lastName||"")).trim() || "(isim yok)";
						const role = u.role || "pending";
						const isSelf = currentUser && uid === currentUser.uid;
						// owner rolu bu ekrandan KIMSE tarafindan degistirilemez (kendisi dahil) --
						// tek yol docs/firebase-database-rules.json'daki bootstrap/devir kurali,
						// bkz. o dosyadaki "role" validate acikllamasi.
						const selectHtml = (isSelf || role === "owner")
							? '<select disabled title="' + (role === "owner" ? "Kurucu rolü bu ekrandan değiştirilemez." : "Kendi yetkini burada değiştiremezsin (güvenlik için).") + '">' +
								'<option selected>' + (roleLabelsForList[role] || role) + (isSelf ? " (Siz)" : "") + '</option>' +
							'</select>'
							: '<select onchange="setUserRole(\'' + uid + '\', this.value)">' +
								'<option value="pending"' + (role==="pending"?' selected':'') + '>Onay Bekliyor</option>' +
								'<option value="editor"' + (role==="editor"?' selected':'') + '>Editör</option>' +
								'<option value="admin"' + (role==="admin"?' selected':'') + '>Admin</option>' +
							'</select>';
						const basinHtml = '<label class="au-basin-toggle" title="İşaretlenirse bu kişi, etkinlik formundaki Basın Görevlisi seçicisinde görünür."><input type="checkbox" ' + (u.basinGorevlisi ? "checked" : "") + ' onchange="toggleUserBasinGorevlisi(\'' + uid + '\', this.checked)">Basın Görevlisi</label>';
						return '<div class="admin-user-row">' +
							'<div class="au-info"><span class="au-name">' + escapeHtml(fullName) + (isSelf ? ' <span style="color:var(--brass-text); font-weight:600;">(Siz)</span>' : '') + '</span><span class="au-email">' + escapeHtml(u.email || "") + '</span></div>' +
							'<div style="display:flex; align-items:center; gap:10px;">' + basinHtml + selectHtml + '</div>' +
						'</div>';
					}).join("");
				}).catch(function() { listEl.innerHTML = '<p class="admin-user-empty">Kullanıcılar yüklenemedi.</p>'; });
			}

			async function setUserRole(uid, newRole) {
				if (!requireAdmin()) return;
				// Kendi yetkisini yükseltmeyi engelleyen <select disabled> sadece görseldi, gerçek kontrol burada.
				if (currentUser && uid === currentUser.uid) { showToast("Kendi yetkinizi değiştiremezsiniz.", "error"); return; }
				// Rules'daki whitelist'in istemci tarafi aynasi -- <select> zaten sadece bu 3 degeri
				// urettigi icin normal akista tetiklenmez, ama fonksiyon global oldugundan konsoldan
				// keyfi bir string ile cagrilabilir; bu kapi burada da ZORUNLUDUR.
				if (!["pending","editor","admin"].includes(newRole)) { showToast("Geçersiz rol.", "error"); return; }
				try {
					// Eski rolü loga yazabilmek için üzerine yazmadan önce okunur.
					const snap = await database.ref("users/" + uid).once("value");
					const u = snap.val() || {};
					const oldRole = u.role || "pending";
					// owner rolu bu fonksiyondan asla degistirilemez (UI'da zaten kilitli <select>
					// ile hicbir zaman buraya newRole gonderilmiyor, ama global fonksiyon konsoldan
					// keyfi cagrilabildigi icin bu kapi da ZORUNLU).
					if (oldRole === "owner") { showToast("Kurucu rolü bu ekrandan değiştirilemez.", "error"); return; }
					const roleLabels = { pending: "Onay Bekliyor", editor: "Editör", admin: "Admin", owner: "Kurucu" };
					const fullName = ((u.firstName || "") + " " + (u.lastName || "")).trim() || u.email || uid;
					// SON YETKILI KORUMASI: Rules seviyesinde "en az bir admin/owner kalmali" kisitini
					// ifade etmek pratik degil (tum users dugumunu saymak gerekir, kirilgan/pahali
					// olur) -- bkz. docs/firebase-database-rules.json notu. Bunun yerine burada,
					// istemci tarafinda, mevcut TUM admin+owner sayisi kontrol edilir; bu kisi
					// son admin/owner ise rolu düşürülemez.
					if ((oldRole === "admin" || oldRole === "owner") && newRole !== "admin") {
						const allSnap = await database.ref("users").once("value");
						const allUsers = allSnap.val() || {};
						const adminCount = Object.keys(allUsers).filter(function(k){ return allUsers[k] && (allUsers[k].role === "admin" || allUsers[k].role === "owner"); }).length;
						if (adminCount <= 1) { showToast("Son yönetici kullanıcının rolü düşürülemez. Önce başka bir admin atayın.", "error"); loadAdminUsers(); return; }
					}
					await database.ref("users/" + uid + "/role").set(newRole);
					await logDebugAction(logValueOrEmpty(fullName) + " kullanıcısının rolü değiştirildi · Rol: " + (roleLabels[oldRole] || oldRole) + " → " + (roleLabels[newRole] || newRole), fullName);
					showToast("Yetki güncellendi.", "success"); loadAdminUsers();
				}
				catch (err) { console.error("Yetki güncellenemedi:", err); showToast("Yetki güncellenemedi.", "error"); }
			}

			// "basinGorevlisi" ROLDEN bagimsiz bir bayraktir: editor/admin olmayan biri bile
			// basin gorevlisi isaretlenebilir. setUserRole fonksiyonunun aksine BURADA kendi
			// kendini isaretlemeyi ENGELLEMIYORUZ (kullanici istegi: admin kendini de isaretleyebilsin).
			// basinGorevlileri/{uid} ayri bir yol: tum users dugumunu (e-posta, rol, vb.)
			// editorlere acmadan, sadece "kimler basin gorevlisi" listesini herkese okutmak icin.
			async function toggleUserBasinGorevlisi(uid, checked) {
				if (!requireAdmin()) return;
				if (testModeEnabled) { showToast("Paylaşımlı Test Ortamı açıkken bu işlem yapılamaz.", "error"); loadAdminUsers(); return; }
				try {
					// Log mesajı için isim her iki durumda (işaretlense de kaldırılsa da) gerekiyor.
					const snap = await database.ref("users/" + uid).once("value");
					const u = snap.val() || {};
					const fullName = ((u.firstName || "") + " " + (u.lastName || "")).trim() || u.email || "(isim yok)";
					// users/{uid}/basinGorevlisi VE basinGorevlileri/{uid} eskiden IKI AYRI .set()/.remove()
					// cagrisiydi -- biri basarili biri basarisiz olabiliyordu (ornegin ikinci istekte
					// baglanti kopması). Firebase'in cok-yollu update()'i ile TEK istekte, atomik yazilir.
					const updates = {};
					updates["users/" + uid + "/basinGorevlisi"] = checked;
					updates[dbPath("basinGorevlileri/" + uid)] = checked ? fullName : null;
					await database.ref("/").update(updates);
					await logDebugAction(logValueOrEmpty(fullName) + " kullanıcısının Basın Görevlisi bayrağı " + (checked ? "işaretlendi" : "kaldırıldı"), fullName);
					showToast(checked ? "Basın görevlisi olarak işaretlendi." : "Basın görevlisi işareti kaldırıldı.", "success");
				} catch (err) {
					console.error("İşlem gerçekleştirilemedi:", err);
					showToast("İşlem gerçekleştirilemedi.", "error");
					loadAdminUsers();
				}
			}

			const LIST_PATHS = { il: 'ilProtokolVerileri', universite: 'universiteProtokolVerileri' };
			const LIST_LABELS = { il: 'İl Protokol Sırası', universite: 'Üniversite Protokol Sırası', etkinlik: 'Etkinlik Takvimi', hesap: 'Hesap', dictionary: 'Veri Sözlüğü' };
			// Site açılışında sekme HER ZAMAN Üniversite ile açılır (kullanıcı talebi). Daha önce burada
			// localStorage'da kayıtlı son sekme (ör. 'il') okunup başlangıç değeri yapılıyordu; artık
			// açılışta okunmuyor — switchList() elle sekme değişiminde localStorage'a yazmaya devam
			// ediyor (bkz. aşağı), sadece açılışta bir daha okunmuyor.
			let currentListKey = 'universite';
			let activeListenerRef = null; let activeListenerCallback = null;

			// Üniversite Protokol Sırası'na özel fakülte/enstitü/yüksekokul/koordinatörlük listesi.
			// Sadece bu listeden seçim yapılır (serbest metin değil), böylece filtreleme her zaman tutarlı çalışır.
			const FACULTY_GROUPS = [
				{ title: "Rektörlük", items: [
					"Rektör", "Rektör Yardımcısı"
				] },
				{ title: "Fakülteler", items: [
					"Ali Fuad Başgil Hukuk Fakültesi", "Çarşamba İnsan ve Toplum Bilimleri Fakültesi", "Diş Hekimliği Fakültesi",
					"Eczacılık Fakültesi", "Eğitim Fakültesi", "Fen Fakültesi", "Güzel Sanatlar Fakültesi",
					"İktisadi ve İdari Bilimler Fakültesi", "İlahiyat Fakültesi", "İletişim Fakültesi",
					"İnsan ve Toplum Bilimleri Fakültesi", "Mimarlık Fakültesi", "Mühendislik Fakültesi",
					"Sağlık Bilimleri Fakültesi", "Tıp Fakültesi", "Turizm Fakültesi", "Veteriner Fakültesi",
					"Yaşar Doğu Spor Bilimleri Fakültesi", "Ziraat Fakültesi"
				] },
				{ title: "Yüksekokul ve Konservatuvar", items: [
					"Devlet Konservatuvarı", "Yabancı Diller Yüksekokulu"
				] },
				{ title: "Enstitüler", items: [
					"Lisansüstü Eğitim Enstitüsü", "Kenevir Araştırmaları Enstitüsü", "Yaban Hayatı Araştırmaları Enstitüsü"
				] },
				{ title: "Meslek Yüksekokulları", items: [
					"Alaçam Meslek Yüksekokulu", "Bafra Meslek Yüksekokulu", "Bafra Turizm Meslek Yüksekokulu",
					"Bilişim Teknolojileri Meslek Yüksekokulu", "Çarşamba Ticaret Borsası Meslek Yüksekokulu",
					"Havelsan Siber Güvenlik Meslek Yüksekokulu", "Havza Meslek Yüksekokulu", "Ladik Meslek Yüksekokulu",
					"Sağlık Hizmetleri Meslek Yüksekokulu", "Samsun Meslek Yüksekokulu", "Terme Meslek Yüksekokulu",
					"Vezirköprü Meslek Yüksekokulu", "Yeşilyurt Demir Çelik Meslek Yüksekokulu"
				] },
				{ title: "Ofisler ve Merkezler", items: [
					"Teknoloji Transfer Ofisi"
				] },
				{ title: "Koordinatörlükler", items: [
					"Araştırma ve Geliştirme Koordinatörlüğü (AR-GE)", "Eğitim Öğretim Koordinatörlüğü", "Kalite Koordinatörlüğü",
					"Meslek Yüksekokulları Koordinatörlüğü", "Mezunlar Koordinatörlüğü",
					"Öğretim Üyesi Yetiştirme Programı Koordinatörlüğü", "Temel Bilimler Dersleri Koordinatörlüğü",
					"Uluslararası İlişkiler Koordinatörlüğü", "Uygulama ve Araştırma Merkezleri Koordinatörlüğü",
					"Yayın Koordinatörlüğü", "Toplumsal Katkı Koordinatörlüğü"
				] }
			];

			// Etkinlik Takvimi "Düzenleyen Birim" alanı için: üniversite birimlerinin yanına konan
			// tikle açılan İL PROTOKOLÜ kurum listesi (admin-src/src/v4/roster.js'deki AYNI listenin
			// kopyası -- bkz. o dosyadaki not, küçük veri kümeleri dosyalar arası bilerek kopyalanır).
			// Kaynak: Samsun Valiliği "Tebrikata Giriş Sırası" protokol listesi. Gruplar VE grup içi
			// sıra protokol sırasını izler, sadece üst düzey kurumlar var (dernek/şube/vakıf yok).
			const IL_PROTOCOL_UNIT_GROUPS = [
				{ title: "Mülki İdare ve Yerel Yönetim", items: [
					"Samsun Valiliği", "Samsun Büyükşehir Belediyesi"
				] },
				{ title: "Garnizon ve Güvenlik", items: [
					"Samsun Garnizon Komutanlığı", "Samsun İl Emniyet Müdürlüğü", "Samsun İl Jandarma Komutanlığı",
					"Sahil Güvenlik Karadeniz Bölge Komutanlığı"
				] },
				{ title: "Adliye", items: [
					"Samsun Cumhuriyet Başsavcılığı", "Samsun Adli Yargı Adalet Komisyonu Başkanlığı",
					"Samsun Bölge Adliye Mahkemesi", "Samsun Bölge İdare Mahkemesi", "Samsun Barosu"
				] },
				{ title: "Üniversiteler", items: [
					"Ondokuz Mayıs Üniversitesi", "Samsun Üniversitesi"
				] },
				{ title: "Kaymakamlıklar", items: [
					"Alaçam Kaymakamlığı", "Asarcık Kaymakamlığı", "Atakum Kaymakamlığı", "Ayvacık Kaymakamlığı",
					"Bafra Kaymakamlığı", "Canik Kaymakamlığı", "Çarşamba Kaymakamlığı", "Havza Kaymakamlığı",
					"İlkadım Kaymakamlığı", "Kavak Kaymakamlığı", "Ladik Kaymakamlığı", "19 Mayıs Kaymakamlığı",
					"Salıpazarı Kaymakamlığı", "Tekkeköy Kaymakamlığı", "Terme Kaymakamlığı",
					"Vezirköprü Kaymakamlığı", "Yakakent Kaymakamlığı"
				] },
				{ title: "İlçe Belediyeleri", items: [
					"Alaçam Belediyesi", "Asarcık Belediyesi", "Atakum Belediyesi", "Ayvacık Belediyesi",
					"Bafra Belediyesi", "Canik Belediyesi", "Çarşamba Belediyesi", "Havza Belediyesi",
					"İlkadım Belediyesi", "Kavak Belediyesi", "Ladik Belediyesi", "19 Mayıs Belediyesi",
					"Salıpazarı Belediyesi", "Tekkeköy Belediyesi", "Terme Belediyesi",
					"Vezirköprü Belediyesi", "Yakakent Belediyesi"
				] },
				{ title: "İl Müdürlükleri ve Bölge Teşkilatı", items: [
					"Samsun İl Milli Eğitim Müdürlüğü", "Samsun İl Sağlık Müdürlüğü",
					"Samsun İl Kültür ve Turizm Müdürlüğü", "Samsun İl Tarım ve Orman Müdürlüğü",
					"Samsun İl Afet ve Acil Durum Müdürlüğü (AFAD)",
					"Samsun Çevre, Şehircilik ve İklim Değişikliği İl Müdürlüğü",
					"Samsun Gençlik ve Spor İl Müdürlüğü", "Samsun Aile ve Sosyal Hizmetler İl Müdürlüğü",
					"Samsun Ticaret İl Müdürlüğü", "Samsun Sanayi ve Teknoloji İl Müdürlüğü",
					"Samsun Çalışma ve İş Kurumu İl Müdürlüğü (İŞKUR)", "Samsun SGK İl Müdürlüğü",
					"Samsun Defterdarlığı", "Samsun İl Göç İdaresi Müdürlüğü",
					"Samsun İl Nüfus ve Vatandaşlık Müdürlüğü",
					"Cumhurbaşkanlığı İletişim Başkanlığı Samsun Bölge Müdürlüğü",
					"Orta Karadeniz Kalkınma Ajansı (OKA)"
				] },
				{ title: "Meslek Kuruluşları", items: [
					"Samsun Ticaret ve Sanayi Odası", "Samsun Ticaret Borsası",
					"Samsun Esnaf ve Sanatkârları Odaları Birliği", "Samsun Ziraat Odası",
					"Samsun Tabip Odası", "19 Mayıs Gazeteciler Cemiyeti"
				] }
			];
			const IL_PROTOCOL_UNIT_SET = new Set(IL_PROTOCOL_UNIT_GROUPS.reduce(function(a,g){ return a.concat(g.items); },[]));

			// Sol filtre panelinde seçilen fakülte/birim adları (çoklu seçim)
			let selectedFaculties = new Set();
			// Sol paneldeki "Rektörlük / Merkez" kutusunda tek tek işaretlenen kişilerin push-ID'leri
			// (eskiden dizi indeksi (_realIdx) tutulurdu -- başka bir editör kayıt ekleyip/silince
			// indeksler kayar, yanlış kişi işaretli görünürdü; ID'ler kalıcı olduğu için artık kaymaz).
			let selectedCentralAdminIdx = new Set();
			// Sol paneldeki hangi fakülte/birim grubu (akordiyon) başlığının açık olduğu
			let openedFacultyGroups = new Set();

			// Rektör / Rektör Yardımcıları / Genel Sekreter / Daire Başkanları — bu kişiler belirli bir fakülteye
			// bağlı olmadıklarından "Protokol Sırası (Referans)" panelindeki 1, 2, 3 ve 12. katmanlara (rank) göre belirlenir.
			// (Genel Sekreter 3. sıraya taşındı, Daire Başkanları listenin en altında 12. sıraya kaldı --
			// bkz. UNIVERSITY_PROTOCOL_TITLES.)
			function isCentralAdminPerson(p) {
				const r = Number(p.rank);
				return r === 1 || r === 2 || r === 3 || r === 12;
			}

			const PREFIX_WEIGHTS = { "Prof. Dr.": 1, "Doç. Dr.": 2, "Dr. Öğr. Üyesi": 3, "Dr.": 4, "Öğr. Gör.": 5, "Arş. Gör.": 6, "Av.": 7, "Uzm.": 7, "": 8 };

			// Görev unvanı (title, serbest metin) hiyerarşisi — T.C. Samsun Valiliği Tebrikata Giriş
			// Sırası (protokol listesi PDF'i) esas alınarak, hem il/devlet hem üniversite unvanlarını
			// TEK bir sıraya oturtur. En spesifik anahtar kelime önce kontrol edilir (örn. "rektör
			// yardımcısı" "rektör"den önce), aksi halde alt string eşleşmesi yanlış katmanı seçerdi.
			// Valilik listesindeki madde numaraları (yorumlarda) referans için korunmuştur; derin
			// yargı/askeri alt listeleri (madde 8-10, 13-18) bu uygulamada karşılığı olmadığı için
			// atlanmıştır.
			// Kullanıcı isteği (31 Ağustos 2026): sıralama 0'dan değil 1'den başlasın -- Vali=1,
			// Milletvekili=2, ... eskiden Vali=0'dan başlıyordu, tüm ağırlıklar +1 kaydırıldı
			// (göreli sıra AYNI kaldı, sadece görünen sayı değişti). tier*100+prefixW formülü
			// (aşağıda getHierarchyWeight) 100'e kadar güvenli, en yüksek ağırlık 14 oldu.
			const TITLE_HIERARCHY = [
				{ key: "vali yardımcısı", weight: 6 },          // madde 5
				{ key: "vali", weight: 1 },                      // Samsun Valisi (tek kişi, en üst -- 1'den başlar)
				{ key: "milletvekili", weight: 2 },               // madde 1 (TBMM Üyeleri)
				{ key: "garnizon komutanı", weight: 3 },          // madde 2
				{ key: "büyükşehir belediye başkanı", weight: 4 },// madde 3
				{ key: "ilçe belediye başkanı", weight: 6 },      // madde 5
				{ key: "belediye başkanı", weight: 4 },           // madde 3 (il belediye başkanı)
				{ key: "cumhuriyet başsavcısı", weight: 5 },      // madde 4
				{ key: "baro başkanı", weight: 5 },               // madde 4
				{ key: "kaymakam", weight: 6 },                   // madde 5
				{ key: "rektör yardımcısı", weight: 7 },          // madde 6
				{ key: "rektör", weight: 5 },                     // madde 4 (Üniversite Rektörleri)
				{ key: "dekan yardımcısı", weight: 12 },          // madde 11
				{ key: "dekan vekili", weight: 7 },               // madde 6
				{ key: "dekan v.", weight: 7 },
				{ key: "dekan", weight: 7 },
				{ key: "enstitü müdür yardımcısı", weight: 12 },  // madde 11
				{ key: "yüksekokul müdür yardımcısı", weight: 12 },// madde 11
				{ key: "müdür yardımcısı", weight: 12 },          // madde 11 (genel)
				{ key: "enstitü müdürü", weight: 7 },             // madde 6
				{ key: "yüksekokul müdürü", weight: 7 },          // madde 6
				{ key: "müdür", weight: 7 },
				{ key: "genel sekreter", weight: 8 },             // madde 7 (üst düzey idari yönetici)
				{ key: "daire başkanı", weight: 13 },             // madde 12 (il teşkilatı müdür/başkan seviyesi)
				{ key: "bölüm başkanı", weight: 13 },
				{ key: "öğretim görevlisi", weight: 14 },
				{ key: "araştırma görevlisi", weight: 14 }
			];

			function getTitleWeight(title) {
				const t = (title || "").trim().toLocaleLowerCase("tr-TR");
				if (!t) return null;
				for (let i = 0; i < TITLE_HIERARCHY.length; i++) { if (t.includes(TITLE_HIERARCHY[i].key)) return TITLE_HIERARCHY[i].weight; }
				return null;
			}

			function getHierarchyWeight(p) {
				const titleW = getTitleWeight(p.title);
				const prefixW = (PREFIX_WEIGHTS[p.prefix || ""] !== undefined) ? PREFIX_WEIGHTS[p.prefix || ""] : 8;
				const tier = (titleW !== null) ? titleW : 100;
				return tier * 100 + prefixW;
			}

			// Aynı unvan katmanında OMÜ her zaman diğer üniversitelerin önünde olsun
			function getInstitutionWeight(p) {
				const u = (p.unit || "").trim().toLocaleLowerCase("tr-TR");
				if (!u) return 1;
				if (u.includes("ondokuz mayıs") || u.includes("omü")) return 1;
				return 2;
			}

			// Etkinlik katılımcı listesi + haber metni ORTAK protokol sıralaması. TITLE_HIERARCHY
			// artık T.C. Samsun Valiliği Tebrikata Giriş Sırası'na göre hem il/devlet hem üniversite
			// unvanlarını TEK bir ölçekte tutuyor (Vali < Milletvekili < Rektör < Kaymakam < Rektör
			// Yardımcısı/Dekan < ...), bu yüzden unvan ağırlığı BİRİNCİL kriterdir -- "kaynak" (il/
			// üniversite) alanına göre kör bir öncelik ARTIK KULLANILMIYOR (yanlış sonuç verirdi,
			// örn. bir Kaymakam bir Rektör'den SONRA gelmeli ama ikisi de "il"den farklı listelerden
			// gelebilir). "rank" sadece AYNI unvan katmanındaki kişiler arasında (ör. iki Milletvekili)
			// ince ayrım için ikincil bir tie-breaker olarak kalır.
			function sortAttendeesByProtocol(list) {
				return list.slice().sort(function(a, b) {
					const ha = getHierarchyWeight(a); const hb = getHierarchyWeight(b); if (ha !== hb) return ha - hb;
					const ia = getInstitutionWeight(a); const ib = getInstitutionWeight(b); if (ia !== ib) return ia - ib;
					const ra = (a.rank === undefined || a.rank === null || a.rank === "" || isNaN(Number(a.rank))) ? Infinity : Number(a.rank);
					const rb = (b.rank === undefined || b.rank === null || b.rank === "" || isNaN(Number(b.rank))) ? Infinity : Number(b.rank);
					if (ra !== rb) return ra - rb;
					return (a.name || "").localeCompare(b.name || "", "tr");
				});
			}

			// ---- KİŞİ DEPOLAMA MODELİ: push-ID'li NESNE ----
			// Eskiden "people" Firebase'de DÜZ BİR DİZİ (array-index) olarak tutulurdu ve kod
			// dizi indeksini (_realIdx/editIndex) kalıcı kimlik gibi kullanırdı. İki editör aynı anda
			// kişi eklerse/silerse indeksler kayar, kaydetme/silme/sıralama YANLIŞ kişiyi hedeflerdi.
			// Artık "etkinlikler" dalındaki ile AYNI desen kullanılıyor: people = { "-Oabc...": {...} }.
			// idx/editIndex/singlePermDeleteIdx/successorEditingIndex/bulkSelection/newsSelection gibi
			// değişken adları TARİHSEL nedenlerle korunmuştur ama artık SAYISAL İNDEKS DEĞİL, kalıcı
			// push-ID (string) TUTARLAR -- isimler değişmedi, İÇERİKLERİ değişti.
			let people = {};
			// Belirli bir id'ye ait kayıt + o kaydın kimliğini (_id) taşıyan düz bir dizi döndürür --
			// render/arama/filtre gibi dizi tabanlı işlemler bunun üzerinden çalışır.
			function peopleIds() { return Object.keys(people); }
			function peopleList() { return peopleIds().map(function(id) { return Object.assign({}, people[id], { _id: id }); }); }
			// Denetim maddesi #1: Fuse.js her tuş vuruşunda (render() -> oninput) yeniden kurulmasın diye
			// oncekinden farkli bir "people" referansi gorulunce indeks yeniden kurulur, ayni referans
			// icin (yani sadece arama kutusuna yazarken) onceki indeks tekrar kullanilir. people; hem
			// attachListener()'in on("value") callback'inde hem de undo/geri-alma/tazeleme noktalarinda
			// HER SEFERINDE yeni/degisen bir referansla degistirildigi icin, tek tek o noktalari
			// yakalamak yerine referans karsilastirmasi ayni sonucu daha guvenli verir -- veri degisen
			// HER yerde otomatik gecersiz olur (nesne İÇİ mutasyonlarda -- orn. tek bir kaydin order
			// alanini degistirmek -- referans AYNI kaldigi icin ilgili fonksiyonlar globalFuseSourceRef'i
			// ACIKCA null'a cekmek ZORUNDADIR, tipki eski dizi modelinde oldugu gibi).
			let globalFuse = null;
			let globalFuseSourceRef = null;
			let mode = "aktif";
			let editIndex = null; // ARTIK bir push-ID (string) tutar, sayisal indeks DEGIL
			// Duzenleme modali acildiginda hedef kaydin kimlik imzasi (ad+unvan). ID'ler artik kalici
			// olsa da AYNI ID'ye baska bir editor arada farkli bir kayit yazmis olabilir (silinip ayni
			// anahtarla... hayir, Firebase push-ID'leri pratikte hic tekrar etmez, ama YINE DE ayni ID
			// uzerinde ES ZAMANLI iki duzenleme olabilir) -- bu imza o durumu yakalar.
			let editIdentity = null;
			let singlePermDeleteIdx = null; // ARTIK bir push-ID (string) tutar
			let sortableInstances = [];
			let openedRanks = new Set();

			let isReorderMode = false; let isBulkMode = false; let isNewsMode = false;
			let bulkSelection = []; let newsSelection = []; // ARTIK push-ID (string) DİZİLERİ, sayısal indeks değil
			// "silindi" (çöp) sekmesindeyken render()'ın EKRANDA GÖSTERDİĞİ (arama/fuzzy-search
			// filtresinden geçmiş) kayıtların id listesi -- executeEmptyTrash() bunu kullanır, ham
			// people nesnesindeki TÜM silinmiş kayıtları değil (bkz. executeEmptyTrash yorumu).
			let visibleTrashIds = null;
			// "aktif" sekmesindeyken render()'ın EKRANDA GÖSTERDİĞİ (arama/fuzzy-search + fakülte
			// filtresinden geçmiş) kayıtların id listesi -- bulkVerifyList() bunu kullanır, ham
			// people nesnesindeki TÜM aktif kayıtları değil (aksi halde arama/filtre yapıp
			// "Hepsini Doğrula" dediğinde ekranda GÖRÜNMEYEN kayıtlar da sessizce güncellenirdi).
			let visibleActiveIds = [];

			// Firebase seyrek diziyi nesneye çevirebilir ve silinen çocukların yerine null bırakabilir;
			// bu hâliyle Object.keys/values çağrıları isimsiz/bozuk "hayalet" kartlar üretebilir.
			// Ayrıca ESKİ (dizi tabanlı) bir JSON yedeği veya henüz migrasyona uğramamış bir üretim
			// kaydı okunursa, dizi öğelerine YEREL olarak (yazmadan) gerçek Firebase push-ID'leri
			// atanır -- database.ref(...).push() sadece bir anahtar üretir, .set() çağrılana kadar
			// hiçbir şey yazmaz. Bu durumda peopleNeedsFullSave=true olur ki bir sonraki kayıt işlemi
			// (savePerson yerine saveData) yeni ID'leri sunucuya KALICI olarak yazsın.
			let peopleNeedsFullSave = false;
			function normalizePeopleSnapshot(data) {
				if (!data) { peopleNeedsFullSave = false; return {}; }
				if (Array.isArray(data)) {
					const obj = {};
					data.forEach(function(item) {
						if (!item || typeof item !== "object") return;
						const id = (database && LIST_PATHS[currentListKey]) ? database.ref(dbPath(LIST_PATHS[currentListKey])).push().key : ("-local" + Math.random().toString(36).slice(2) + Date.now().toString(36));
						obj[id] = item;
					});
					peopleNeedsFullSave = true; // yeni uretilen ID'ler kaliciliginda ilk firsatta tum liste yazilmali
					return obj;
				}
				if (typeof data !== "object") { peopleNeedsFullSave = false; return {}; }
				const obj = {}; let sawInvalid = false;
				Object.keys(data).forEach(function(k) {
					const v = data[k];
					if (v && typeof v === "object") obj[k] = v; else sawInvalid = true;
				});
				peopleNeedsFullSave = sawInvalid;
				return obj;
			}

			// normalizePeopleSnapshot ile AYNI dizi/nesne sekil-normalizasyonunu yapar ama
			// global peopleNeedsFullSave bayragina DOKUNMAZ -- o bayrak SADECE aktif listenin
			// kayit davranisi icin, ilgisiz bir okuma (orn. takvimde Il Protokolu onbellegi)
			// onu yanlislikla ezmemeli.
			function normalizeSnapshotArray(data) {
				if (!data) return [];
				let arr;
				if (Array.isArray(data)) { arr = data; }
				else { arr = Object.keys(data).sort(function(a, b){ return Number(a) - Number(b); }).map(function(k){ return data[k]; }); }
				return arr.filter(function(x){ return x && typeof x === "object"; });
			}

			function attachListener() {
				if (!database) return;
				if (!LIST_PATHS[currentListKey]) { showToast("Liste yolu geçersiz.", "error"); return; }
				if (activeListenerRef && activeListenerCallback) { activeListenerRef.off('value', activeListenerCallback); }
				document.getElementById("countLabel").textContent = "Veriler İndiriliyor...";
				
				activeListenerRef = database.ref(dbPath(LIST_PATHS[currentListKey]));
				activeListenerCallback = function(snapshot) {
					people = normalizePeopleSnapshot(snapshot.val());
					// ID'ler kalıcı olduğu için başka bir editörün EKLEDİĞİ/SİLDİĞİ başka bir kayıt artık
					// seçimleri BOZMAZ (eski dizi-indeksli modelde tüm mod iptal edilirdi). Sadece seçili/
					// sıralanan kaydın KENDİSİ uzaktan silinmişse o kayıt seçimden düşürülür.
					if (isBulkMode) {
						const before = bulkSelection.length;
						bulkSelection = bulkSelection.filter(function(id) { return !!people[id]; });
						if (bulkSelection.length !== before) {
							const btn = document.getElementById("executeBulkDeleteBtn"); if (btn) btn.textContent = "Seçilenleri Çöpe At (" + bulkSelection.length + ")";
							showToast("Seçili kayıtlardan biri başka bir kullanıcı tarafından değiştirildi, seçimden çıkarıldı.", "error");
						}
					}
					if (isNewsMode) newsSelection = newsSelection.filter(function(id) { return !!people[id]; });
					renderFacultySidebar();
					// Sürükleme sırasında yeniden çizmek Sortable örneklerini altından çeker; o modda çizim ertelenir.
					if (!isBulkMode && !isNewsMode && !isReorderMode) render();
				};
				activeListenerRef.on('value', activeListenerCallback, function() {
					document.getElementById("countLabel").textContent = "Verilere ulaşılamadı"; showToast("Veritabanına bağlanılamadı!", "error");
				});
			}

			function switchList(key) {
				if (key === currentListKey) return; currentListKey = key; localStorage.setItem('omuProtokolListKey', key);
				document.querySelectorAll('#listSwitch button').forEach(b => b.classList.toggle('active', b.dataset.list === key));
				mode = "aktif"; document.querySelectorAll('#statusToggle button').forEach(b => b.classList.toggle('active', b.dataset.mode === 'aktif'));
			applyModeToolbar();
				document.getElementById("search").value = "";
				
				openedRanks.clear();
				selectedFaculties.clear(); selectedCentralAdminIdx.clear();
				if (isBulkMode) toggleBulkDeleteMode(); if (isReorderMode) toggleReorderMode(); if (isNewsMode) toggleNewsMode();
				closeModal(); people = {}; renderFacultySidebar(); render(); attachListener();
			}

			document.getElementById('listSwitch').addEventListener('click', function(e) {
				const btn = e.target.closest('button'); if (!btn) return; switchList(btn.dataset.list);
			});

			// Kart aksiyon butonlari (Duzenle/Geri Yukle/Kalici Sil) -- id, inline onclick string'ine
			// gomulmek yerine karta zaten atanmis card.dataset.pid'den okunur (bkz. render()'daki not).
			document.getElementById('grid').addEventListener('click', function(e) {
				const btn = e.target.closest('.card-edit, .btn-restore-card, .btn-permdel-card'); if (!btn) return;
				const card = btn.closest('.card'); if (!card) return;
				e.stopPropagation();
				const pid = card.dataset.pid;
				if (btn.classList.contains('card-edit')) openEditModal(pid);
				else if (btn.classList.contains('btn-restore-card')) restoreSingle(pid);
				else if (btn.classList.contains('btn-permdel-card')) openSinglePermDelete(pid);
			});


			function clearFacultyFilter() {
				selectedFaculties.clear(); selectedCentralAdminIdx.clear(); renderFacultySidebar(); render();
			}

			// Aynı filtre içeriği hem masaüstündeki sabit sol panelde (#facultySidebar) hem de
			// mobildeki alttan açılan çekmecede (#facultySheetBody) birebir aynı şekilde gösterilir.
			function renderFacultySidebar() {
				const layout = document.getElementById("mainLayout");
				const wrap = document.getElementById("facultySidebar");
				const sheetBody = document.getElementById("facultySheetBody");
				const fab = document.getElementById("facultyFab");
				if (!layout || !wrap) return;
				const isUni = currentListKey === "universite";
				layout.classList.toggle("with-sidebar", isUni);
				if (fab) fab.classList.toggle("active-list", isUni);

				if (!isUni) {
					wrap.innerHTML = ""; if (sheetBody) sheetBody.innerHTML = "";
					closeFacultySheet();
					updateFacultyFabCount();
					return;
				}

				const centralCandidates = peopleList()
					.filter(function(p) { return (!p.status || p.status === "aktif") && isCentralAdminPerson(p); })
					.sort(function(a, b) { return (Number(a.rank) - Number(b.rank)) || (a.name || "").localeCompare(b.name || "", "tr"); });

				let html = '<div class="fs-title">Rektörlük / Merkez</div>';
				if (!centralCandidates.length) {
					html += '<p class="hint" style="margin:0 0 12px;">Merkezi idare kaydı yok.</p>';
				} else {
					html += '<div class="fs-central-list">' + centralCandidates.map(function(p) {
						const checked = selectedCentralAdminIdx.has(p._id) ? "checked" : "";
						return '<label class="fs-item"><input type="checkbox" class="fs-central-cb" data-idx="' + escapeHtml(p._id) + '" ' + checked + '><span><b>' + escapeHtml(p.name) + '</b><br><span class="fs-item-sub">' + escapeHtml(p.title) + '</span></span></label>';
					}).join("") + '</div>';
				}

				html += '<div class="fs-title" style="margin-top:14px;">Fakülte / Birim Filtresi</div>';
				html += '<button type="button" class="fs-clear-btn" onclick="clearFacultyFilter()">Filtreyi Temizle</button>';
				html += FACULTY_GROUPS.map(function(g) {
					// Grup içinde seçili birim varsa, veriler yenilendiğinde kapanıp kaybolmasın diye otomatik açık tutulur.
					const hasSelected = g.items.some(function(item) { return selectedFaculties.has(item); });
					const isOpen = (openedFacultyGroups.has(g.title) || hasSelected) ? " open" : "";
					return '<details class="fs-group"' + isOpen + '><summary class="fs-group-title">' + escapeHtml(g.title) + '</summary>' +
						g.items.map(function(item) {
							const checked = selectedFaculties.has(item) ? "checked" : "";
							return '<label class="fs-item"><input type="checkbox" class="fs-faculty-cb" data-faculty="' + escapeHtml(item) + '" ' + checked + '><span>' + escapeHtml(item) + '</span></label>';
						}).join("") +
					'</details>';
				}).join("");

				[wrap, sheetBody].forEach(function(container) {
					if (!container) return;
					container.innerHTML = html;
					container.querySelectorAll("details.fs-group").forEach(function(det) {
						det.addEventListener("toggle", function() {
							const title = det.querySelector("summary").textContent;
							if (det.open) openedFacultyGroups.add(title); else openedFacultyGroups.delete(title);
						});
					});
				});

				updateFacultyFabCount();
			}

			function updateFacultyFabCount() {
				const countEl = document.getElementById("facultyFabCount");
				if (!countEl) return;
				const n = selectedFaculties.size + selectedCentralAdminIdx.size;
				if (n > 0) { countEl.style.display = "flex"; countEl.textContent = n; }
				else { countEl.style.display = "none"; }
			}

			function handleFacultyFilterChange(e) {
				const t = e.target;
				if (t.classList.contains('fs-central-cb')) {
					const idx = t.dataset.idx; // push-ID (string), sayısal indeks DEĞİL
					if (t.checked) selectedCentralAdminIdx.add(idx); else selectedCentralAdminIdx.delete(idx);
					renderFacultySidebar(); render();
				} else if (t.classList.contains('fs-faculty-cb')) {
					const val = t.dataset.faculty;
					if (t.checked) selectedFaculties.add(val); else selectedFaculties.delete(val);
					renderFacultySidebar(); render();
				}
			}
			document.getElementById('facultySidebar').addEventListener('change', handleFacultyFilterChange);
			document.getElementById('facultySheetBody').addEventListener('change', handleFacultyFilterChange);

			// Mobil çekmece (bottom sheet): aç/kapat + tutamaçtan aşağı sürükleyerek kapatma
			function openFacultySheet() {
				document.getElementById("facultySheetBackdrop").classList.add("open");
				document.getElementById("facultySheet").classList.add("open");
			}
			function closeFacultySheet() {
				const backdrop = document.getElementById("facultySheetBackdrop");
				const sheet = document.getElementById("facultySheet");
				if (backdrop) backdrop.classList.remove("open");
				if (sheet) { sheet.classList.remove("open"); sheet.classList.remove("dragging"); sheet.style.transform = ""; }
			}
			(function setupFacultySheetDrag() {
				const sheet = document.getElementById("facultySheet");
				const handle = document.getElementById("fsheetHandleWrap");
				if (!sheet || !handle) return;
				let startY = 0, currentY = 0, dragging = false;

				function pointY(e) { return (e.touches && e.touches.length) ? e.touches[0].clientY : e.clientY; }
				function onStart(e) { dragging = true; startY = pointY(e); currentY = 0; sheet.classList.add("dragging"); }
				function onMove(e) {
					if (!dragging) return;
					currentY = Math.max(0, pointY(e) - startY);
					sheet.style.transform = "translateY(" + currentY + "px)";
				}
				function onEnd() {
					if (!dragging) return;
					dragging = false; sheet.classList.remove("dragging");
					if (currentY > 110) { closeFacultySheet(); } else { sheet.style.transform = ""; }
				}

				handle.addEventListener("touchstart", onStart, { passive: true });
				handle.addEventListener("touchmove", onMove, { passive: true });
				handle.addEventListener("touchend", onEnd);
				handle.addEventListener("mousedown", onStart);
				document.addEventListener("mousemove", onMove);
				document.addEventListener("mouseup", onEnd);
			})();

			// ---- Test Modu: Firebase'de paylaşımlı (ayarlar/testModuAcik) bir anahtar. Açıkken
			// GERÇEK içerik verisine (protokol listeleri/etkinlikler/basın görevlileri) VE
			// loglara dokunulmaz -- her şey ayrı bir "test/" dalına okunur/yazılır. dbPath()
			// TEK yerden bu yönlendirmeyi yapar; içerik veya log fark etmez, her database.ref(...)
			// çağrısı buradan geçer. users/ (hesap/rol) HİÇ gölgelenmez.
			// Kapatınca gerçek veri hiç değişmediği için otomatik olarak eski hâline dönülmüş olur.
			function dbPath(basePath) { return testModeEnabled ? "test/" + basePath : basePath; }
			// Test Modu ilk açıldığında test/ dalı boş olursa site boş görünür -- açılış anında
			// GERÇEK verinin TAZE bir kopyası test/'e yazılır (varsa üzerine yazarak).
			async function cloneRealDataToTestMode() {
				const paths = ["ilProtokolVerileri", "universiteProtokolVerileri", "etkinlikler", "basinGorevlileri"];
				const snaps = await Promise.all(paths.map(function(p) { return database.ref(p).once("value"); }));
				await Promise.all(paths.map(function(p, i) { return database.ref("test/" + p).set(snaps[i].val()); }));
			}
			function attachTestModeListener() {
				if (!database) return;
				database.ref("ayarlar/testModuAcik").on("value", function(snap) {
					testModeEnabled = !!snap.val();
					updateStatusBanner();
					// Zaten açık dinleyiciler yeni yola (test/ ya da gerçek) kendiliğinden geçmez --
					// mod her değiştiğinde yeniden bağlanır (attachListener kendi eski referansını
					// off() ile bırakıp yenisine geçer, sayfa yenilenmez).
					attachListener();
				}, function(err) { console.error("Test modu durumu okunamadı:", err); });
			}
			// Faz 10: testModuAcik ile AYNI desen -- ayarlar/saltOkunur, admin-only yazma, tüm
			// bağlı istemcilere anında yayılır (canlı kilit). applyPermissions() çağrısı KRİTİK --
			// kilit açılır/kapanırken .edit-only butonlar ve body.is-readonly ANINDA (sayfa
			// yenilenmeden) güncellensin diye.
			function attachSaltOkunurListener() {
				if (!database) return;
				database.ref("ayarlar/saltOkunur").on("value", function(snap) {
					saltOkunurEnabled = !!snap.val();
					updateStatusBanner();
					applyPermissions();
				}, function(err) { console.error("Salt-okunur durumu okunamadı:", err); });
			}
			// Tek şerit (#testModeBanner) hem Test Modu hem Salt-Okunur Kilit'i gösterir -- ikisi
			// AYNI ANDA açık olabilir, bu yüzden metin diziye eklenip " · " ile birleştirilir.
			// Kilit varsa şerit tehlike (kırmızı) rengine döner -- .banner-lock class'ı ile,
			// bkz. style.css -- daha ACİL bir durum olduğu için Test Modu'nun nötr rengini ezer.
			function updateStatusBanner() {
				const sw = document.getElementById("testModeSwitch"); if (sw) sw.checked = testModeEnabled;
				const lockSw = document.getElementById("saltOkunurSwitch"); if (lockSw) lockSw.checked = saltOkunurEnabled;
				const banner = document.getElementById("testModeBanner");
				if (banner) {
					const parts = [];
					if (testModeEnabled) parts.push("Paylaşımlı Test Ortamı Açık — Şuanda sahte bir veri seti kullanılıyor.");
					if (saltOkunurEnabled) parts.push("🔒 Salt-Okunur Kilit Açık — Düzenleme geçici olarak kapalı.");
					banner.textContent = parts.join(" · ");
					banner.style.display = parts.length ? "flex" : "none";
					banner.classList.toggle("banner-lock", saltOkunurEnabled);
				}
				document.body.classList.toggle("test-mode-active", testModeEnabled || saltOkunurEnabled); // şerit sabit konumlu, header'ın üstüne binmesin diye body'ye üst boşluk eklenir
				const testEl = document.getElementById("akTestMode");
				if (testEl) { testEl.textContent = testModeEnabled ? "Açık" : "Kapalı"; document.getElementById("akTestModeKpi").classList.toggle("ak-warn", testModeEnabled); }
				const lockEl = document.getElementById("akSaltOkunur");
				if (lockEl) { lockEl.textContent = saltOkunurEnabled ? "Açık" : "Kapalı"; document.getElementById("akSaltOkunurKpi").classList.toggle("ak-warn", saltOkunurEnabled); }
			}
			async function setTestMode(on) {
				if (!requireAdmin()) { updateStatusBanner(); return; }
				if (!database) { showToast("Veritabanı bağlı değil!", "error"); updateStatusBanner(); return; }
				try {
					if (on) { showLoading("Test ortamı hazırlanıyor…"); await cloneRealDataToTestMode(); hideLoading(); }
					await database.ref("ayarlar/testModuAcik").set(!!on);
				}
				catch (err) { hideLoading(); console.error("Test modu değiştirilemedi:", err); showToast("Paylaşımlı Test Ortamı değiştirilemedi.", "error"); updateStatusBanner(); }
			}
			// Kullanıcı isteği: "acil durum anahtarı" -- admin açtığında hiç kimse (editör/admin
			// fark etmez) veri düzenleyemez. canEditData() zaten saltOkunurEnabled'i kontrol ediyor
			// (bkz. yukarıda) -- bu fonksiyon SADECE anahtarı Firebase'e yazar, gerçek kilitleme
			// mantığı merkezi olarak orada.
			async function setSaltOkunur(on) {
				if (!requireAdmin()) { updateStatusBanner(); return; }
				if (!database) { showToast("Veritabanı bağlı değil!", "error"); updateStatusBanner(); return; }
				try { await database.ref("ayarlar/saltOkunur").set(!!on); }
				catch (err) { console.error("Salt-okunur kilit değiştirilemedi:", err); showToast("Salt-okunur kilit değiştirilemedi.", "error"); updateStatusBanner(); }
			}

			// targetName ayrı tutulur ki log listesinde "kim yaptı" (by) ile "kime yapıldı" (target)
			// birbirine karışmasın — ikisi de kalın yazınca ayırt edilemiyordu, artık target ayrı renkte bir etiket.
			// PROMISE DONER: eskiden "ates et ve unut" (push().catch(...)) idi -- veri basariyla
			// yazilsa bile log yazimi sessizce basarisiz olabiliyordu. Artik cagiran taraf
			// (mumkunse) await ile logun da tamamlandigindan emin olabilir; basarisizlik hem
			// konsola hem de kullaniciya (toast ile) bildirilir, sessizce yutulmaz.
			function logAction(actionLabel, targetName) {
				if (!requireEdit()) return Promise.resolve(false);
				if (!database || !currentUser) return Promise.resolve(false);
				const who = ((currentUser.firstName||"") + " " + (currentUser.lastName||"")).trim() || currentUser.email;
				return database.ref(dbPath("logs/" + currentListKey)).push({ by: who, email: currentUser.email, action: actionLabel, target: targetName || "", timestamp: firebase.database.ServerValue.TIMESTAMP })
					.then(function(){ return true; })
					.catch(function(err){ console.error("Log kaydı yazılamadı:", err); showToast("Kayıt yapıldı ancak işlem günlüğüne yazılamadı.", "warn"); return false; });
			}

			// ---- Debug sistemi: log/logs/{il,universite,etkinlik} ile KARIŞMASIN diye ayrı bir
			// dal (logs/debug) kullanılır. Böylece admin panelindeki test butonlarını denerken
			// gerçek değişiklik geçmişi kirlenmez ve debug günlüğü ayrıca, tek tuşla temizlenebilir.
			// dbPath() ile sarmalanır: Test Modu açıkken debug butonları da (kullanıcı isteğiyle)
			// gerçek veriye/gerçek debug logına dokunmaz, hepsi test/ altında kalır.
			function logDebugAction(actionLabel, targetName) {
				if (!requireAdmin()) return Promise.resolve(false);
				if (!database || !currentUser) return Promise.resolve(false);
				const who = ((currentUser.firstName||"") + " " + (currentUser.lastName||"")).trim() || currentUser.email;
				return database.ref(dbPath("logs/debug")).push({ by: who, email: currentUser.email, action: actionLabel, target: targetName || "", timestamp: firebase.database.ServerValue.TIMESTAMP })
					.then(function(){ return true; })
					.catch(function(err){ console.error("Debug log kaydı yazılamadı:", err); showToast("İşlem yapıldı ancak debug günlüğüne yazılamadı.", "warn"); return false; });
			}
			// Test Modu anahtarı admin panelinde her sekmede görünür (bkz. adminPanelBg HTML'i);
			// bu yüzden günlüğü de switchAdminTab'a bağlı değil, panel her açıldığında yüklenir.
			// Loglar artık düz bir logs/test yerine, gerçek yapı birebir test/ altında yansıdığı
			// için test/logs/{il,universite,etkinlik,debug} olarak dağılıyor -- hepsi
			// birleştirilip tek bir zaman sıralı listede gösterilir (loadAdminLogs ile aynı kalıp).
			function loadTestModeLog() {
				const listEl = document.getElementById("adminTestModeLogList"); if (!listEl) return;
				listEl.innerHTML = '<p class="admin-user-empty">Yükleniyor…</p>';
				if (!database) { listEl.innerHTML = '<p class="admin-user-empty">Veritabanı bağlı değil.</p>'; return; }
				Promise.all([
					database.ref("test/logs/il").limitToLast(50).once("value"),
					database.ref("test/logs/universite").limitToLast(50).once("value"),
					database.ref("test/logs/etkinlik").limitToLast(50).once("value"),
					database.ref("test/logs/debug").limitToLast(50).once("value")
				]).then(function(snaps) {
					const entries = snaps.reduce(function(acc, snap) { return acc.concat(Object.values(snap.val() || {})); }, [])
						.sort(function(a, b) { return (b.timestamp||0) - (a.timestamp||0); }).slice(0, 50);
					if (!entries.length) { listEl.innerHTML = '<p class="admin-user-empty">Test günlüğü boş.</p>'; return; }
					listEl.innerHTML = entries.map(function(e) {
						const timeStr = new Date(e.timestamp || 0).toLocaleString("tr-TR");
						const targetHtml = e.target ? ('<span class="al-target">' + escapeHtml(e.target) + '</span> ') : "";
						return '<div class="admin-log-row"><div class="al-top"><span class="al-by">' + escapeHtml(e.by || e.email || "?") + '</span><span class="al-time">' + timeStr + '</span></div><div class="al-action">' + targetHtml + escapeHtml(e.action || "") + '</div></div>';
					}).join("");
				}).catch(function() { listEl.innerHTML = '<p class="admin-user-empty">Günlük yüklenemedi.</p>'; });
			}
			// actionLabel/targetName standart tam kayıt; opsiyonel "patch" verilirse (id veya
			// "id/alan" -> deger, silme için null) TÜM listeyi değil, sadece dokunulan yol(lar)ı
			// .update() ile yazar -- eş zamanlı olarak başka bir editörün eklediği kayıt kaybolmaz.
			async function saveData(actionLabel, targetName, patch) {
				if (!requireEdit()) return false;
				if (!database) { showToast("Veritabanı bağlı değil!", "error"); return false; }
				if (!LIST_PATHS[currentListKey]) { showToast("Liste yolu geçersiz, kaydedilmedi.", "error"); return false; }
				// people bu noktaya kadar caginin dogrudan mutasyonuyla degismis olabilir, referansi
				// AYNI kalabilir -- Fuse onbellegi bu yuzden burada da acikca gecersiz kilinir
				// (bkz. "globalFuseSourceRef" tanimindaki uzun yorum).
				globalFuseSourceRef = null;
				try {
					// Veri + log TEK cok-yollu update() ile ATOMIK yazilir -- eskiden log ayri (ates-et-
					// unut) bir push() idi, veri basariyla yazilip log yazimi sessizce basarisiz
					// olabiliyordu. root().update() ile ayni istekte iki farkli dal birden yazilir;
					// Firebase her dali kendi .write kuraliyla ayri ayri degerlendirir, ikisi de
					// editor/admin icin zaten acik oldugundan ek bir Rules degisikligi gerekmez.
					const updates = {};
					if (patch) { Object.keys(patch).forEach(function(k){ updates[dbPath(LIST_PATHS[currentListKey]) + "/" + k] = patch[k]; }); }
					else { updates[dbPath(LIST_PATHS[currentListKey])] = people; }
					let logKey = null;
					if (currentUser) {
						logKey = database.ref(dbPath("logs/" + currentListKey)).push().key;
						const who = ((currentUser.firstName||"") + " " + (currentUser.lastName||"")).trim() || currentUser.email;
						updates[dbPath("logs/" + currentListKey) + "/" + logKey] = { by: who, email: currentUser.email, action: actionLabel || "Liste güncellendi", target: targetName || "", timestamp: firebase.database.ServerValue.TIMESTAMP };
					}
					await database.ref("/").update(updates);
					peopleNeedsFullSave = false;
				if (!logKey) { console.error("Log kaydı yazılamadı: currentUser tanımsız."); showToast("Kayıt yapıldı ancak işlem günlüğüne yazılamadı.", "warn"); }
					return true;
				}
				catch (err) { console.error("Kaydedilemedi:", err); showToast("Buluta kaydedilemedi.", "error"); return false; }
			}

			// Tüm listeyi değil, sadece TEK kişiyi (kendi push-ID'sinin altına) gönderir —
			// hem çok daha hızlı hem de başka bir kaydı asla etkilemez.
			async function savePerson(id, actionLabel, targetName) {
				if (!requireEdit()) return false;
				if (!database) { showToast("Veritabanı bağlı değil!", "error"); return false; }
				if (!LIST_PATHS[currentListKey]) { showToast("Liste yolu geçersiz, kaydedilmedi.", "error"); return false; }
				if (!people[id]) { showToast("Kayıt bulunamadı, sayfayı yenileyin.", "error"); return false; }
				globalFuseSourceRef = null; // bkz. saveData() -- ayni sebep, tek kayit guncellense bile arama alaninda degisiklik olabilir
				// Snapshot ESKİ (dizi tabanlı) bir yedekten yerel olarak ID'lere çevrildiyse, o ID'lerin
				// sunucuya KALICI olarak yazılması gerekir -- bu yüzden tek-yol yazımı yerine tüm nesne yazılır.
				if (peopleNeedsFullSave) { const ok = await saveData(actionLabel, targetName); if (ok) peopleNeedsFullSave = false; return ok; }
				try {
					const name = (people[id] && people[id].name) ? people[id].name : "Kayıt";
					// saveData() ile ayni gerekce: kayit + log TEK atomik update() ile yazilir.
					const updates = {};
					updates[dbPath(LIST_PATHS[currentListKey] + "/" + id)] = people[id];
					let logKey = null;
					if (currentUser) {
						logKey = database.ref(dbPath("logs/" + currentListKey)).push().key;
						const who = ((currentUser.firstName||"") + " " + (currentUser.lastName||"")).trim() || currentUser.email;
						updates[dbPath("logs/" + currentListKey) + "/" + logKey] = { by: who, email: currentUser.email, action: actionLabel || (name + " güncellendi"), target: targetName || name, timestamp: firebase.database.ServerValue.TIMESTAMP };
					}
					await database.ref("/").update(updates);
				if (!logKey) { console.error("Log kaydı yazılamadı: currentUser tanımsız."); showToast("Kayıt yapıldı ancak işlem günlüğüne yazılamadı.", "warn"); }
					return true;
				}
				catch (err) { console.error("Kaydedilemedi:", err); showToast("Buluta kaydedilemedi.", "error"); return false; }
			}

			// Diğer form alanlarına dokunmadan sadece "bu bilgi hâlâ doğru" damgası basar --
			// tam düzenleme akışına girmeden hızlı doğrulama için (saveForm ile aynı stale-id koruması).
			async function verifyPerson(idx) {
				if (!requireEdit()) return;
				const p = people[idx];
				if (!p) { showToast("Kayıt bulunamadı.", "error"); return; }
				const curIdentity = String(p.name || "") + "|" + String(p.title || "");
				if (editIdentity !== null && curIdentity !== editIdentity) {
					showToast("Liste başka bir kullanıcı tarafından değiştirildi, doğrulama yapılmadı. Lütfen tekrar deneyin.", "error");
					closeModal(); render(); return;
				}
				const kaynakSel = document.getElementById("f_dogrulamaKaynak");
				const kaynak = kaynakSel ? kaynakSel.value : "manuel";
				const who = ((currentUser.firstName || "") + " " + (currentUser.lastName || "")).trim() || currentUser.email;
				const oldRecord = Object.assign({}, p);
				// savePerson() tum people[idx] nesnesini oldugu gibi Firebase'e yazdigindan, sunucu
				// saatini DB'ye tasimak icin sonDogrulamaTs burada ServerValue.TIMESTAMP olarak
				// yazilir; yazim basarili olur olmaz yerel gorunum icin Date.now() ile degistirilir
				// (aksi halde ekranda sentinel nesnesi gorunurdu -- listener zaten bir sonraki
				// senkronizasyonda gercek sunucu degerini getirecek).
				people[idx] = Object.assign({}, p, { dogrulamaKaynak: kaynak, sonDogrulamaTs: firebase.database.ServerValue.TIMESTAMP, dogrulayan: who });
				const actionLabel = (p.name || "Kayıt") + " kişisi doğrulandı · Kaynak: " + (VERIFICATION_SOURCES[kaynak] || kaynak);
				const saved = await savePerson(idx, actionLabel, p.name);
				if (!saved) { people[idx] = oldRecord; return; }
				people[idx].sonDogrulamaTs = Date.now();
				showToast("Doğrulama kaydedildi: " + (p.name || ""));
				updateVerifyInfo(people[idx]);
				render();
			}

			// Toplu doğrulama: şu an ekranda görünen (arama/filtre uygulanmış) aktif kayıtların
			// TÜMÜNÜ tek bir atomik update() ile doğrulanmış/doğrulanmamış işaretler + tek bir
			// log satırı yazar (verifyPerson()'ın tekil sürümünün toplu hâli).
			async function bulkVerifyList(verified){
				if (!requireEdit()) return;
				const ids = visibleActiveIds.slice();
				if (!ids.length) { showToast("Doğrulanacak görünür kayıt yok.", "error"); return; }
				if (!database || !LIST_PATHS[currentListKey]) { showToast("Veritabanı bağlı değil.", "error"); return; }
				const who = ((currentUser.firstName || "") + " " + (currentUser.lastName || "")).trim() || currentUser.email;
				const basePath = LIST_PATHS[currentListKey];
				const updates = {};
				let count = 0;
				ids.forEach(function(id){
					if (!people[id]) return;
					count++;
					if (verified) {
						updates[dbPath(basePath + "/" + id + "/sonDogrulamaTs")] = firebase.database.ServerValue.TIMESTAMP;
						updates[dbPath(basePath + "/" + id + "/dogrulamaKaynak")] = "manuel";
						updates[dbPath(basePath + "/" + id + "/dogrulayan")] = who;
					} else {
						updates[dbPath(basePath + "/" + id + "/sonDogrulamaTs")] = null;
						updates[dbPath(basePath + "/" + id + "/dogrulamaKaynak")] = null;
						updates[dbPath(basePath + "/" + id + "/dogrulayan")] = null;
					}
				});
				if (!count) { showToast("Doğrulanacak kayıt yok.", "error"); return; }
				const logKey = database.ref(dbPath("logs/" + currentListKey)).push().key;
				updates[dbPath("logs/" + currentListKey) + "/" + logKey] = {
					by: who, email: currentUser.email,
					action: (verified ? "Toplu doğrulama: " : "Toplu doğrulanmadı olarak işaretleme: ") + count + " kayıt",
					target: "", timestamp: firebase.database.ServerValue.TIMESTAMP
				};
				try {
					await database.ref("/").update(updates);
					ids.forEach(function(id){
						const p = people[id]; if (!p) return;
						if (verified) { p.sonDogrulamaTs = Date.now(); p.dogrulamaKaynak = "manuel"; p.dogrulayan = who; }
						else { delete p.sonDogrulamaTs; delete p.dogrulamaKaynak; delete p.dogrulayan; }
					});
					render();
					showToast(count + " kayıt " + (verified ? "doğrulandı." : "doğrulanmadı olarak işaretlendi."), "success");
				} catch(err) {
					console.error("Toplu doğrulama başarısız:", err);
					showToast("Toplu doğrulama kaydedilemedi.", "error");
				}
			}

			document.querySelectorAll('#listSwitch button').forEach(b => b.classList.toggle('active', b.dataset.list === currentListKey));
			attachListener();

			document.getElementById("mobileLayoutToggle").addEventListener("click", function(e) {
				const btn = e.target.closest("button"); if (!btn) return; const cols = btn.dataset.col;
				document.querySelectorAll("#mobileLayoutToggle button").forEach(b => b.classList.remove("active"));
				btn.classList.add("active");
				
				const grid = document.getElementById("grid");
				grid.classList.remove("grid-cols-2", "grid-cols-3", "grid-cols-4");
				grid.classList.add("grid-cols-" + cols); 
				grid.style.setProperty('--mobile-cols', cols);
			});

			function clearSearch() { 
				if (isReorderMode) return; 
				document.getElementById("search").value = ""; 
				document.getElementById("search").focus(); 
				render(); 
			}

			// --- Arama kutusuna otomatik doldurma engeli (son katman) ---
			// Sorun: tarayici/parola yoneticisi eklentileri (1Password, LastPass, Bitwarden, Chrome'un
			// kendi doldurucusu) sayfadaki gizli giris formunu gorup EN YAKIN metin kutusunu
			// "kullanici adi" sanip kullanicinin e-postasini arama kutusuna yaziyordu. Isaretleyici
			// tarafinda alinan onlemler (type="search", autocomplete="off", data-lpignore/1p-ignore/
			// bwignore, ayri bir name) cogu durumu kesiyor ama HICBIRI garanti degil -- bazi eklentiler
			// bu ipuclarini bilerek yok sayiyor. Bu yuzden son katman olarak: kullanici kutuya kendisi
			// bir sey YAZANA kadar, disaridan gelen her deger sessizce temizlenir.
			// Kullanici ilk tusa bastigi (veya yapistirdigi) anda bu koruma tamamen devre disi kalir,
			// yani gercek aramaya asla karismaz.
			function guardSearchAutofill() {
				const el = document.getElementById("search");
				if (!el) return;
				let userTyped = false;
				// Gercek kullanici etkilesimi: klavye, yapistirma veya guvenilir (isTrusted) input olayi.
				["keydown", "paste"].forEach(function(ev) {
					el.addEventListener(ev, function() { userTyped = true; }, { once: true });
				});
				el.addEventListener("input", function(e) { if (e.isTrusted) userTyped = true; });
				function wipeIfAutofilled() {
					if (userTyped || !el.value) return;
					el.value = "";
					if (typeof render === "function") render();
				}
				// Otomatik doldurma senkron degil: yukleme aninda, birkac kare sonra ve eklentilerin
				// gec calisma ihtimaline karsi 1sn'e kadar birkac kez kontrol edilir.
				[0, 120, 400, 1000].forEach(function(ms) { setTimeout(wipeIfAutofilled, ms); });
			}
			guardSearchAutofill();

			function toggleFieldClear(id) { const input = document.getElementById(id); const btn = document.getElementById("clear_" + id); if(btn) { btn.style.display = input.value.length > 0 ? "flex" : "none"; } }
			function clearFieldInput(id) { const input = document.getElementById(id); input.value = ""; input.focus(); toggleFieldClear(id); }

			// tag: ayni "konuya" ait bildirimleri tekilleştirmek icin opsiyonel bir etiket. Ayni
			// tag ile yeni bir bildirim gelirse ONCEKI hemen kaldirilir -- ekranda o konudan
			// EN FAZLA TEK bildirim kalir. Kilit sistemi bunu "cal-lock" etiketiyle kullanir
			// (bkz. calLockNotify): eskiden ekranda ayni anda 3 celiskili kilit uyarisi
			// birikebiliyordu. Etiketsiz cagrilar (varsayilan) eskisi gibi yigilir.
			function showToast(msg, type, tag) {
				type = type || "success"; const container = document.getElementById("toastContainer");
				if (tag) container.querySelectorAll('[data-toast-tag="' + tag + '"]').forEach(function(t){ t.remove(); });
				const toast = document.createElement("div");
				toast.className = "toast " + type; toast.textContent = msg;
				if (tag) toast.dataset.toastTag = tag;
				container.appendChild(toast);
				requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add("show")));
				setTimeout(() => { toast.classList.remove("show"); setTimeout(() => toast.remove(), 300); }, 4000);
				return toast;
			}
			// --- Cift gonderim (double-submit) korumasi ---------------------------------------
			// Kaydetme/silme akislari async: kullanici "Kaydet"e basip yazma BITMEDEN tekrar
			// basarsa fonksiyon bastan calisiyordu. Yeni kayit dallarinda her cagri KENDI
			// push()-ID'sini urettigi icin sonuc AYNI kaydin IKI KEZ olusmasiydi (test edildi:
			// hem kisi hem etkinlik formunda iki ayri kayit olusuyordu). Modal ancak await
			// bittikten SONRA kapandigi icin bu pencere gercek kullanimda kolayca yakalanabiliyor
			// (yavas ag = daha genis pencere).
			const inFlightOps = new Set();
			async function guardOp(key, fn) {
				if (inFlightOps.has(key)) return; // ayni islem zaten sürüyor -- ikinci cagri yok sayilir
				inFlightOps.add(key);
				try { return await fn(); }
				finally { inFlightOps.delete(key); }
			}
			// Belirli bir etikete ait TUM bildirimleri aninda kaldirir (bkz. toggleEventLock --
			// kilit durumu degisince ekranda kalmis eski kilit uyarilari artik GECERSIZDIR ve
			// yeni mesajla celiskili gorunur; ama ILGISIZ bildirimlere -- "kayit kaydedildi" gibi --
			// DOKUNULMAZ, eskiden hepsi birden siliniyordu).
			function clearToastsByTag(tag) {
				const container = document.getElementById("toastContainer"); if (!container) return;
				container.querySelectorAll('[data-toast-tag="' + tag + '"]').forEach(function(t){ t.remove(); });
			}


			/* ================= YASAL METİNLER (Kullanım Şartları / Gizlilik) ================= */
			const LEGAL_OWNER = "Arda Bilasa";
			const LEGAL_CONTACT = "bilasaarda@gmail.com";
			const LEGAL_TEXTS = {
				terms: {
					baslik: "Kullanım Şartları",
					html:
						'<h3>1. Kapsam</h3>' +
						'<p>Bu uygulama ("Protokol Kartları"), Ondokuz Mayıs Üniversitesi Basın ve Halkla İlişkiler ekibinin protokol sırası takibi, etkinlik planlaması ve haber metni üretimi işlerinde kullanılmak üzere geliştirilmiş bir iç çalışma aracıdır. Uygulamaya erişen herkes aşağıdaki şartları kabul etmiş sayılır.</p>' +
						'<h3>2. Fikri Mülkiyet ve Telif</h3>' +
						'<p>Uygulamanın <b>kaynak kodu, HTML yapısı, CSS tasarımı, JavaScript mantığı, arayüz düzeni, renk paleti, metinleri ve tüm görsel unsurları</b> ' + LEGAL_OWNER + ' adlı hak sahibine aittir ve 5846 sayılı Fikir ve Sanat Eserleri Kanunu kapsamında korunmaktadır.</p>' +
						'<p>Hak sahibinin <b>yazılı izni olmaksızın</b> aşağıdakiler yasaktır:</p>' +
						'<ul>' +
						'<li>Kaynak kodun tamamının veya bir bölümünün kopyalanması, çoğaltılması, indirilmesi ve başka bir projede kullanılması,</li>' +
						'<li>Tasarımın, arayüz düzeninin veya CSS stillerinin taklit edilmesi ya da uyarlanması,</li>' +
						'<li>Uygulamanın türev bir çalışmaya dönüştürülmesi, yeniden adlandırılarak dağıtılması veya satılması,</li>' +
						'<li>Otomatik araçlarla (bot, crawler, scraper) içerik veya veri toplanması,</li>' +
						'<li>Tersine mühendislik yapılması veya güvenlik önlemlerinin aşılmaya çalışılması.</li>' +
						'</ul>' +
						'<h3>3. Hesap ve Yetki</h3>' +
						'<ul>' +
						'<li>Hesaplar kişiye özeldir; kullanıcı adı ve şifre üçüncü kişilerle paylaşılamaz.</li>' +
						'<li>Düzenleme yetkisi (editör/yönetici) yalnızca yönetici onayıyla verilir ve her an geri alınabilir.</li>' +
						'<li>Hesabıyla yapılan tüm işlemlerden hesap sahibi sorumludur.</li>' +
						'</ul>' +
						'<h3>4. İçerik Sorumluluğu</h3>' +
						'<p>Uygulamaya girilen kişi bilgileri, etkinlik kayıtları ve notların doğruluğundan bunları giren kullanıcı sorumludur. Kişisel veri niteliğindeki bilgiler yalnızca kurumsal iş amacıyla ve ilgili mevzuata uygun şekilde işlenmelidir.</p>' +
						'<h3>5. İhlal Hâlinde</h3>' +
						'<p>Bu şartların ihlali hâlinde ilgili hesabın erişimi bildirimsiz olarak kapatılır. Telif ihlali tespit edilmesi durumunda hak sahibi, 5846 sayılı Kanun ve ilgili mevzuat uyarınca <b>hukuki ve cezai yollara başvurma hakkını saklı tutar.</b></p>' +
						'<h3>6. Değişiklikler ve İletişim</h3>' +
						'<p>Bu şartlar önceden bildirilmeksizin güncellenebilir. İzin talepleri ve sorular için: <b>' + LEGAL_CONTACT + '</b></p>' +
						'<p class="lg-meta">Son güncelleme: 18 Ağustos 2026 · Hak sahibi: ' + LEGAL_OWNER + '</p>'
				},
				privacy: {
					baslik: "Gizlilik Politikası",
					html:
						'<h3>1. İşlenen Veriler</h3>' +
						'<ul>' +
						'<li><b>Hesap bilgileri:</b> ad, soyad, e-posta adresi ve yetki rolü (bekliyor / editör / yönetici).</li>' +
						'<li><b>İçerik verileri:</b> protokol kartlarına girilen kişi bilgileri (unvan, görev, birim, tarih, fotoğraf, not) ve etkinlik takvimi kayıtları.</li>' +
						'<li><b>İşlem kayıtları (log):</b> her ekleme, düzenleme ve silme işleminde işlemi yapan kullanıcı, zaman damgası ve hangi alanın ne şekilde değiştiği.</li>' +
						'</ul>' +
						'<h3>2. Saklama Yeri</h3>' +
						'<p>Veriler Google Firebase altyapısında, <b>Avrupa (europe-west1)</b> bölgesindeki sunucularda saklanır. Yazma erişimi veritabanı güvenlik kurallarıyla sınırlandırılmıştır; yalnızca editör ve yönetici rolündeki oturum açmış kullanıcılar kayıt değiştirebilir.</p>' +
						'<h3>3. İşleme Amacı</h3>' +
						'<p>Veriler yalnızca kimlik doğrulama, yetkilendirme, protokol sırası takibi, etkinlik planlaması, haber metni üretimi ve değişiklik geçmişinin denetlenmesi amacıyla işlenir.</p>' +
						'<h3>4. Paylaşım</h3>' +
						'<p>Veriler üçüncü kişilere satılmaz, pazarlama veya reklam amacıyla kullanılmaz. Barındırma hizmeti dışında hiçbir üçüncü tarafla paylaşılmaz. İşlem kayıtlarını yalnızca yönetici rolündeki kullanıcılar görüntüleyebilir.</p>' +
						'<h3>5. Çerezler ve Yerel Depolama</h3>' +
						'<p>Reklam veya takip çerezi kullanılmaz. Oturumun açık kalabilmesi için Firebase Authentication tarayıcının yerel depolama alanını kullanır; uygulama ayrıca çevrimdışı çalışabilmek için sayfa dosyalarını tarayıcı önbelleğinde tutar.</p>' +
						'<h3>6. Haklarınız</h3>' +
						'<p>6698 sayılı Kişisel Verilerin Korunması Kanunu (KVKK) kapsamında; verilerinize erişme, düzeltilmesini veya silinmesini isteme hakkına sahipsiniz. Talebinizi <b>' + LEGAL_CONTACT + '</b> adresine iletebilir ya da uygulama yöneticisine başvurabilirsiniz.</p>' +
						'<p class="lg-meta">Son güncelleme: 18 Ağustos 2026 · Veri sorumlusu: ' + LEGAL_OWNER + '</p>'
				}
			};
			let legalTab = "terms";
			function openLegalModal(which){
				legalTab = LEGAL_TEXTS[which] ? which : "terms";
				const t = LEGAL_TEXTS[legalTab];
				document.getElementById("legalModalTitle").textContent = t.baslik;
				document.getElementById("legalBody").innerHTML = t.html;
				document.getElementById("legalBody").scrollTop = 0;
				document.getElementById("legalTabTerms").className = "btn " + (legalTab === "terms" ? "btn-primary" : "btn-ghost");
				document.getElementById("legalTabPrivacy").className = "btn " + (legalTab === "privacy" ? "btn-primary" : "btn-ghost");
				document.getElementById("legalModalBg").classList.add("open");
			}
			function closeLegalModal(){ document.getElementById("legalModalBg").classList.remove("open"); }

			function togglePhotoHelp(){ var el = document.getElementById("photoHelpBox"); if (el) el.style.display = (el.style.display === "none") ? "block" : "none"; }

			// Birim/Unvan aranabilir dropdown: mevcut kayıtlardaki değerler + Firebase'deki
			// öneri havuzu (oneriler/{liste}/birimler|unvanlar) datalist'i besler. Yeni bir
			// değer kaydedilince havuza eklenir, sonraki kayıtlarda önerilir.
			let suggestionPool = { birimler: {}, unvanlar: {} };
			function loadSuggestionPool(){
				if (!database) return Promise.resolve();
				return database.ref(dbPath("oneriler/" + currentListKey)).once("value").then(function(snap){
					const val = snap.val() || {};
					suggestionPool = { birimler: {}, unvanlar: {} };
					["birimler", "unvanlar"].forEach(function(kind){
						Object.values(val[kind] || {}).forEach(function(e){ if (e && e.deger) suggestionPool[kind][e.deger] = true; });
					});
				}).catch(function(){});
			}
			function populateSuggestionDatalists(){
				const unitSet = new Set(Object.keys(suggestionPool.birimler));
				const titleSet = new Set(Object.keys(suggestionPool.unvanlar));
				Object.values(people).forEach(function(p){
					if (p && p.unit) unitSet.add(p.unit);
					if (p && p.title) titleSet.add(p.title);
				});
				const unitList = document.getElementById("f_unit_list");
				const titleList = document.getElementById("f_title_list");
				if (unitList) unitList.innerHTML = Array.from(unitSet).sort().map(function(v){ return '<option value="' + escapeHtml(v) + '">'; }).join("");
				if (titleList) titleList.innerHTML = Array.from(titleSet).sort().map(function(v){ return '<option value="' + escapeHtml(v) + '">'; }).join("");
			}
			function saveSuggestion(kind, value){
				if (!database || !value) return;
				if (suggestionPool[kind] && suggestionPool[kind][value]) return;
				suggestionPool[kind] = suggestionPool[kind] || {}; suggestionPool[kind][value] = true;
				database.ref(dbPath("oneriler/" + currentListKey + "/" + kind)).push({ deger: value }).catch(function(){});
			}

			// PIN ile Hızlı Hesap Değiştir özelliği kaldırıldı (kullanıcı isteği, güvenlik
			// denetimi): Firebase şifresi PIN'den türetilen bir anahtarla localStorage'da
			// şifreli tutuluyordu -- paylaşılan/ödünç cihazlarda risk taşıyordu. Eski
			// kullanıcılarda kalmış olabilecek şifreli kayıtları bir kerelik temizler.
			try { localStorage.removeItem("omuProtokolQuickAccounts"); } catch(e) {}

			// Telif yılı her yıl elle güncellenmesin diye otomatik yazılır.
			(function setFooterYear(){
				const el = document.getElementById("footYear");
				if (el) el.textContent = String(new Date().getFullYear());
			})();
			// Surum numarasi elle iki yerde (sw.js + burada) tekrarlanip birbirinden sasmasin diye,
			// sw.js dosyasindaki CACHE_NAME degerinden calisma zamaninda okunur.
			(function setFooterVersion(){
				const el = document.getElementById("footVersion");
				if (!el) return;
				fetch("sw.js").then(function(r){ return r.ok ? r.text() : ""; }).then(function(txt){
					const m = txt.match(/CACHE_NAME\s*=\s*"[^"]*?(v[\d]+(?:\.[\d]+)*)"/);
					if (m) el.textContent = m[1];
				}).catch(function(){});
			})();

			/* ================= İÇERİK KORUMA (caydırıcı katman) ================= */
			// DÜRÜST NOT: Tarayıcıya inen HTML/CSS/JS teknik olarak tamamen gizlenemez.
			// Bu katman sıradan kopyalamayı zorlaştırır; asıl koruma yasal bildirim,
			// Firebase güvenlik kuralları ve deponun gizli tutulmasıdır.
			// Ekibin çalışma akışı bozulmasın diye form alanları ve haber metni kutusu muaf tutulur.
			const COPY_GUARD_ENABLED = true;
			let copyGuardToastTs = 0;
			function copyGuardWarn(msg){
				const now = Date.now();
				if (now - copyGuardToastTs < 3000) return;   // arka arkaya uyarı yağmuru olmasın
				copyGuardToastTs = now;
				showToast(msg, "error");
			}
			function copyGuardExempt(el){
				if (!el || !el.closest) return false;
				// Yazı yazılan/kopyalanan her yer serbest: formlar, arama, haber çıktısı, etkinlik detayı.
				return !!el.closest("input, textarea, select, [contenteditable='true'], .cal-peek-body, .legal-body");
			}
			if (COPY_GUARD_ENABLED) {
				document.addEventListener("contextmenu", function(e){
					if (copyGuardExempt(e.target)) return;
					e.preventDefault();
					copyGuardWarn("Bu içerik telif hakkıyla korunmaktadır (© " + LEGAL_OWNER + ").");
				});
				document.addEventListener("keydown", function(e){
					if (copyGuardExempt(e.target)) return;
					const k = (e.key || "").toLowerCase();
					// Ctrl+U (kaynağı görüntüle) ve Ctrl+S (sayfayı kaydet)
					if ((e.ctrlKey || e.metaKey) && (k === "u" || k === "s")) {
						e.preventDefault();
						copyGuardWarn("Bu sayfanın kaynağı telif hakkıyla korunmaktadır.");
					}
				});
				// Fotoğrafların masaüstüne sürüklenerek indirilmesi engellenir; sıralama sürüklemesi bundan etkilenmez.
				document.addEventListener("dragstart", function(e){
					if (isReorderMode) return;
					if (e.target && e.target.tagName === "IMG") e.preventDefault();
				});
			}

			function openBulkConfirmModal() {
				if (bulkSelection.length === 0) { showToast("Seçim yapılmadı.", "error"); return; }
				document.getElementById("bulkConfirmText").textContent = bulkSelection.length + " kaydı çöp kutusuna taşımak istediğinize emin misiniz?";
				document.getElementById("bulkConfirmModalBg").classList.add("open");
			}
			function closeBulkConfirmModal() { document.getElementById("bulkConfirmModalBg").classList.remove("open"); }

			function toggleBulkDeleteMode() {
				if (!isBulkMode && !requireEdit()) return;
				if (isReorderMode) toggleReorderMode(); if (isNewsMode) toggleNewsMode();
				isBulkMode = !isBulkMode; bulkSelection = [];
				
				const btnToplu = document.getElementById("bulkDeleteModeBtn"); const btnExec = document.getElementById("executeBulkDeleteBtn"); const btnCancel = document.getElementById("cancelBulkDeleteBtn");
				const actionsLeft = document.getElementById("actionsLeftWrap"); const tabs = document.querySelectorAll("#statusToggle button");
				const search = document.getElementById("search");

				if (isBulkMode) {
					btnToplu.style.display = "none"; btnExec.style.display = "inline-flex"; btnCancel.style.display = "inline-flex";
					actionsLeft.style.display = "none"; 
					tabs.forEach(t => t.disabled = true);
					showToast("Çöpe atmak istediğiniz kişileri seçin (Arama yapabilirsiniz).", "error");
				} else {
					btnToplu.style.display = "inline-flex"; btnExec.style.display = "none"; btnCancel.style.display = "none";
					// "flex" SABIT DEGERI YAZMAK YANLISTI: mobilde .actions-left CSS'te display:grid (2 sutunlu
					// duzen, bkz. ~satir 823) kullanir; buraya inline "flex" yazmak o grid'i eziyor ve butonlar
					// mobilde (ozellikle Il listesine gecince, applyModeToolbar() de ayni hatayi yapiyordu)
					// tek sutun/alt alta diziliyordu. removeProperty ile inline stili tamamen kaldirip
					// CSS media query'nin (masaustunde flex, mobilde grid) karar vermesine birakiyoruz.
					actionsLeft.style.removeProperty("display");
					tabs.forEach(t => t.disabled = false);
					search.value = "";
				}
				render();
			}

			function updateBulkSelection(idx, isChecked, cardElement) {
				if (isChecked) { if (!bulkSelection.includes(idx)) bulkSelection.push(idx); cardElement.classList.add("bulk-selected"); } 
				else { bulkSelection = bulkSelection.filter(i => i !== idx); cardElement.classList.remove("bulk-selected"); }
				document.getElementById("executeBulkDeleteBtn").textContent = "Seçilenleri Çöpe At (" + bulkSelection.length + ")";
			}

			async function executeBulkDelete() {
				if (!requireEdit()) return;
				// Sadece gerçekten var olan ID'ler işlenir; kayıt uzaktan silinmişse people[id] undefined olup hata veriyordu.
				const valid = bulkSelection.filter(function(id) { return !!people[id]; });
				if (!valid.length) { closeBulkConfirmModal(); toggleBulkDeleteMode(); showToast("Seçim geçersiz, liste yenilendi.", "error"); return; }
				const names = valid.map(function(id) { return people[id].name || "İsimsiz kayıt"; });
				// Yazma basarisiz olursa geri alinabilmesi icin dokunulan kayitlarin eski durumu saklanir.
				const prevStates = valid.map(function(id) { return { id: id, status: people[id].status, prevStatus: people[id].prevStatus }; });
				// Sadece dokunulan kayıtların "status"/"prevStatus" alanları .update() ile yazılır --
				// TÜM listeyi .set() ile yeniden yazmak, aynı anda başka bir editörün eklediği yeni bir
				// kaydı üzerine yazıp kaybettirebilirdi.
				const patch = {};
				valid.forEach(function(id) {
					const prevStatus = people[id].status || "aktif";
					people[id].prevStatus = prevStatus; people[id].status = "silindi";
					patch[id + "/prevStatus"] = prevStatus; patch[id + "/status"] = "silindi";
				});
				const label = names.length === 1 ? (names[0] + " kişisi çöpe atıldı") : (names.length + " kişi çöpe atıldı: " + names.join(", "));
				// Sayı toggleBulkDeleteMode() ÖNCESİNDE alınır; o fonksiyon bulkSelection'ı boşalttığı için bildirim hep "0" yazıyordu.
				const movedCount = valid.length;
				const ok = await saveData(label, names.length === 1 ? names[0] : undefined, patch);
				closeBulkConfirmModal(); toggleBulkDeleteMode();
				if (!ok) {
					prevStates.forEach(function(s) { if (people[s.id]) { people[s.id].status = s.status; if (s.prevStatus === undefined) delete people[s.id].prevStatus; else people[s.id].prevStatus = s.prevStatus; } });
					render();
					return;
				}
				showToast(movedCount + " kayıt çöpe taşındı.", "warn");
			}

			// Haber çıktısı seçim hafızası: "Haber Çıktısı Al" modu AÇIKKEN yaptığınız seçim,
			// aynı oturumda taslak oluşturup modalı kapatsanız bile korunur (aynı kişilere art
			// arda haber üretebilesiniz diye). Ama moddan TAMAMEN ÇIKILDIĞINDA (İptal veya
			// tekrar "Haber Çıktısı Al" moduna kapatma) hafıza da silinir -- bir etkinlik için
			// seçtiğiniz isimler bir sonraki, alakasız etkinlikte seçili kalmasın diye.
			const NEWS_SELECTION_KEY = "omuProtokolNewsSelection";
			function saveNewsSelection(){ try { localStorage.setItem(NEWS_SELECTION_KEY, JSON.stringify(newsSelection)); } catch(e) {} }
			function loadNewsSelection(){ try { const arr = JSON.parse(localStorage.getItem(NEWS_SELECTION_KEY) || "[]"); return Array.isArray(arr) ? arr.filter(id => people[id]) : []; } catch(e) { return []; } }
			function clearNewsSelection(){
				newsSelection = []; saveNewsSelection();
				document.querySelectorAll(".news-cb").forEach(cb => { cb.checked = false; cb.closest(".card").classList.remove("news-selected"); });
				const btnExec = document.getElementById("executeNewsBtn"); if (btnExec) btnExec.textContent = "Taslağı Oluştur (0)";
				showToast("Seçim temizlendi.", "success");
			}
			function toggleNewsMode() {
				if (isReorderMode) toggleReorderMode(); if (isBulkMode) toggleBulkDeleteMode();
				if (mode !== "aktif") document.querySelector('[data-mode="aktif"]').click();

				isNewsMode = !isNewsMode; newsSelection = isNewsMode ? loadNewsSelection() : []; newsPeopleOverride = null; newsEventContext = null;
				if (!isNewsMode) saveNewsSelection();
				const btnNews = document.getElementById("newsModeBtn"); const btnExec = document.getElementById("executeNewsBtn"); const btnCancel = document.getElementById("cancelNewsBtn"); const btnClear = document.getElementById("clearNewsSelectionBtn");
				const addBtn = document.getElementById("addBtn"); const reorderBtn = document.getElementById("reorderBtn"); const expBtn = document.getElementById("exportBtn"); const impBtn = document.getElementById("importBtn");
				const btnToplu = document.getElementById("bulkDeleteModeBtn"); const tabs = document.querySelectorAll("#statusToggle button");
				const search = document.getElementById("search");

				if (isNewsMode) {
					btnNews.style.display = "none"; btnExec.style.display = "inline-flex"; btnCancel.style.display = "inline-flex"; if (btnClear) btnClear.style.display = "inline-flex";
					btnExec.textContent = "Taslağı Oluştur (" + newsSelection.length + ")";
					[addBtn, reorderBtn, expBtn, impBtn, btnToplu].forEach(b => { if(b) b.style.display = "none"; });
					tabs.forEach(t => t.disabled = true);
					showToast(newsSelection.length ? ("Önceki seçiminiz hatırlandı (" + newsSelection.length + " kişi). Değiştirebilirsiniz.") : "Metinde geçecek isimleri seçin (Arama yapabilirsiniz).", "success");
				} else {
					btnNews.style.display = "inline-flex"; btnExec.style.display = "none"; btnCancel.style.display = "none"; if (btnClear) btnClear.style.display = "none";
					[addBtn, reorderBtn, expBtn, impBtn, btnToplu].forEach(b => { if(b) b.style.display = "inline-flex"; });
					tabs.forEach(t => t.disabled = false);
					search.value = "";
				}
				render();
			}

			function updateNewsSelection(idx, isChecked, cardElement) {
				if (isChecked) { if (!newsSelection.includes(idx)) newsSelection.push(idx); cardElement.classList.add("news-selected"); }
				else { newsSelection = newsSelection.filter(i => i !== idx); cardElement.classList.remove("news-selected"); }
				document.getElementById("executeNewsBtn").textContent = "Taslağı Oluştur (" + newsSelection.length + ")";
				saveNewsSelection();
			}

			// Denetim maddesi #2: "OMÜ"/"TBMM"/"AVM" gibi TAMAMEN BUYUK harfli kisaltmalarda ek uyumu,
			// YAZILI son harfe gore degil, o harfin TURKCE ADININ (okunusunun) son sesine gore secilir.
			// Ornek: "TBMM" yazi olarak unsuz "M" ile biter ama soylenisi "...em" oldugu icin ek ince/on
			// sese gore secilir: dogrusu "TBMM'nin"/"TBMM'ye", "TBMM'ın"/"TBMM'a" DEGIL. Turkce alfabede
			// neredeyse her unsuz harfin adi bir unluyle BITER (be/ce/de/ke/me/... gibi), bu yuzden asil
			// yazi bir unsuzle bitse de kisaltmalar ekler acisindan HER ZAMAN bir unluyle bitiyormus gibi
			// davranir -- asagidaki tablo her harfin Turkce adindaki o unluyu tutar.
			const ABBR_LETTER_VOWEL = { A:"a", B:"e", C:"e", "Ç":"e", D:"e", E:"e", F:"e", G:"e", "Ğ":"e", H:"e", I:"ı", "İ":"i", J:"e", K:"e", L:"e", M:"e", N:"e", O:"o", "Ö":"ö", P:"e", Q:"e", R:"e", S:"e", "Ş":"e", T:"e", U:"u", "Ü":"ü", V:"e", W:"e", X:"e", Y:"e", Z:"e" };
			function abbrevPronunciationVowel(token) {
				const t = String(token || "");
				// En az 2 harf, TAMAMI buyuk harf olmali -- tek harf ya da kucuk harf iceren kelimeler kisaltma sayilmaz.
				if (!/^[A-ZÇĞİÖŞÜ]{2,}$/.test(t)) return null;
				return ABBR_LETTER_VOWEL[t[t.length - 1]] || null;
			}

			function turkishGenitiveSuffix(fullName) {
				const name = (fullName || "").trim(); if(!name) return name;
				const toLowerTr = ch => { if(ch === "İ") return "i"; if(ch === "I") return "ı"; return ch.toLocaleLowerCase("tr-TR"); };
				const vowelSet = "aıoueiöü";
				const words = name.split(/\s+/); const lastWord = words[words.length - 1];
				const abbrevVowel = abbrevPronunciationVowel(lastWord);
				let lastVowel = abbrevVowel;
				if (!abbrevVowel) { lastVowel = null; for(let i = name.length - 1; i >= 0; i--){ const ch = toLowerTr(name[i]); if(vowelSet.includes(ch)){ lastVowel = ch; break; } } }
				let sVowel = "ı";
				if(lastVowel){ if("aı".includes(lastVowel)) sVowel = "ı"; else if("ei".includes(lastVowel)) sVowel = "i"; else if("ou".includes(lastVowel)) sVowel = "u"; else if("öü".includes(lastVowel)) sVowel = "ü"; }
				const lastChar = toLowerTr(name[name.length - 1]); const endsWithVowel = abbrevVowel ? true : vowelSet.includes(lastChar);
				return name + "'" + (endsWithVowel ? "n" : "") + sVowel + "n";
			}

			// Yonelme hali (-a/-e): duz sozcuklerde 'y' kaynastirma; iyelik ekiyle biten tamlamalarda (…Başkanlığı, …Merkezi) 'n' kaynastirma.
			function turkishDativeSuffix(word){
				const s=String(word||"").trim(); if(!s) return "";
				const words=s.split(/\s+/); const last=words[words.length-1];
				const lower=function(ch){ if(ch==="İ") return "i"; if(ch==="I") return "ı"; return ch.toLocaleLowerCase("tr-TR"); };
				const vowels="aeıioöuü";
				const abbrevVowel = abbrevPronunciationVowel(last);
				let lastVowel = abbrevVowel || "";
				if (!abbrevVowel) { for(let i=last.length-1;i>=0;i--){ const c=lower(last[i]); if(vowels.indexOf(c)>-1){ lastVowel=c; break; } } }
				const back="aıou".indexOf(lastVowel)>-1;
				const lastCh=lower(last[last.length-1]); const endsWithVowel = abbrevVowel ? true : vowels.indexOf(lastCh)>-1;
				const needsN = words.length>1 && "ıiuü".indexOf(lastCh)>-1;
				const ek=back?"a":"e";
				if(!endsWithVowel) return s+"'"+ek;
				return s+"'"+(needsN?"n":"y")+ek;
			}
			// Belirtme hali (-ı/-i/-u/-ü): duz sozcuklerde 'y' kaynastirma; iyelik ekiyle biten tamlamalarda 'n' kaynastirma.
			function turkishAccusativeSuffix(word){
				const s=String(word||"").trim(); if(!s) return "";
				const words=s.split(/\s+/); const last=words[words.length-1];
				const lower=function(ch){ if(ch==="İ") return "i"; if(ch==="I") return "ı"; return ch.toLocaleLowerCase("tr-TR"); };
				const vowels="aeıioöuü";
				const abbrevVowel = abbrevPronunciationVowel(last);
				let lastVowel = abbrevVowel || "";
				if (!abbrevVowel) { for(let i=last.length-1;i>=0;i--){ const c=lower(last[i]); if(vowels.indexOf(c)>-1){ lastVowel=c; break; } } }
				let ek="ı";
				if(lastVowel){ if("aı".indexOf(lastVowel)>-1) ek="ı"; else if("ei".indexOf(lastVowel)>-1) ek="i"; else if("ou".indexOf(lastVowel)>-1) ek="u"; else if("öü".indexOf(lastVowel)>-1) ek="ü"; }
				const lastCh=lower(last[last.length-1]); const endsWithVowel = abbrevVowel ? true : vowels.indexOf(lastCh)>-1;
				const needsN = words.length>1 && "ıiuü".indexOf(lastCh)>-1;
				if(!endsWithVowel) return s+"'"+ek;
				return s+"'"+(needsN?"n":"y")+ek;
			}

			function generateNewsText() {
				// Kaynak ya takvimdeki etkinliğin katılımcı listesi, ya da ekrandan tek tek seçilen kişiler.
				let selectedPeople;
				if (newsPeopleOverride && newsPeopleOverride.length) { selectedPeople = newsPeopleOverride.slice(); }
				else {
					if(newsSelection.length === 0) { showToast("Kişi seçmediniz.", "error"); return; }
					selectedPeople = newsSelection.map(idx => people[idx]).filter(Boolean);
					if(!selectedPeople.length) { showToast("Seçim geçersiz, liste yenilendi.", "error"); return; }
				}

				selectedPeople.sort((a,b) => {
					// TITLE_HIERARCHY artık gerçek T.C. Samsun Valiliği protokol sırasına göre hem
					// il/devlet hem üniversite unvanlarını tek ölçekte tutuyor -- unvan ağırlığı
					// BİRİNCİL kriterdir, "kaynak" (il/üniversite) alanına göre kör öncelik kaldırıldı.
					const ha = getHierarchyWeight(a); const hb = getHierarchyWeight(b); if(ha !== hb) return ha - hb;
					const ia = getInstitutionWeight(a); const ib = getInstitutionWeight(b); if(ia !== ib) return ia - ib;
					const ra = (a.rank === undefined || a.rank === null || a.rank === "" || isNaN(Number(a.rank))) ? Infinity : Number(a.rank); const rb = (b.rank === undefined || b.rank === null || b.rank === "" || isNaN(Number(b.rank))) ? Infinity : Number(b.rank); if(ra !== rb) return ra - rb;
					const oa = (a.order === undefined || a.order === null || a.order === "") ? Infinity : Number(a.order); const ob = (b.order === undefined || b.order === null || b.order === "") ? Infinity : Number(b.order); if(oa !== ob) return oa - ob;
					return (a.name||"").localeCompare(b.name||"", "tr");
				});

				let textArray = selectedPeople.map(p => {
					let str = p.title ? p.title.trim() + " " : ""; if(p.prefix) str += p.prefix.trim() + " "; str += p.name ? p.name.trim() : ""; return str.trim();
				});

				const kisilerDuz = textArray.join(", ");
				const ilkKisi = textArray[0] || "";
				let peoplePart = ilkKisi;
				if (textArray.length > 1) peoplePart = turkishGenitiveSuffix(ilkKisi) + " yanı sıra " + textArray.slice(1).join(", ");

				const yer = (document.getElementById("newsLocationInput").value || "Törene").trim();
				const categories = Array.from(document.querySelectorAll(".newsCatCb:checked")).map(cb => cb.value);
				let categoryList = "";
				if (categories.length === 1) { categoryList = categories[0]; }
				else if (categories.length > 1) { const lastCat = categories.pop(); categoryList = categories.join(", ") + " ve " + lastCat; }
				const categoryPart = categoryList ? " ile çok sayıda " + categoryList : "";

				// Cümle iskeleti koda gömülü değil, DEFAULT_NEWS_TEMPLATES listesinden geliyor (artık admin panelinden düzenlenmiyor, sabit).
				const tpl = currentTemplate();
				const etkEl = document.getElementById("newsEtkinlikInput"); const brmEl = document.getElementById("newsBirimInput");
				const aciklamaEl = document.getElementById("newsAciklamaInput"); const evSahibiEl = document.getElementById("newsEvSahibiInput");
				const yeniGorevliEl = document.getElementById("newsYeniGorevliInput"); const eskiGorevliEl = document.getElementById("newsEskiGorevliInput"); const gorevEl = document.getElementById("newsGorevInput");
				const birim = (brmEl ? brmEl.value.trim() : "") || (newsEventContext ? newsEventContext.birim : "") || "";
				const aciklama = aciklamaEl ? aciklamaEl.value.trim() : ""; const evSahibi = evSahibiEl ? evSahibiEl.value.trim() : "";
				const yeniGorevli = yeniGorevliEl ? yeniGorevliEl.value.trim() : ""; const eskiGorevli = eskiGorevliEl ? eskiGorevliEl.value.trim() : ""; const gorev = gorevEl ? gorevEl.value.trim() : "";
				const ctx = {
					kisiler: peoplePart, kisilerDuz: kisilerDuz, ilkKisi: ilkKisi, ilkKisiIn: turkishGenitiveSuffix(ilkKisi),
					digerKisiler: textArray.slice(1).join(", "),
					yer: yer, gruplar: categoryPart,
					etkinlik: (etkEl ? etkEl.value.trim() : "") || (newsEventContext ? newsEventContext.etkinlik : "") || "",
					birim: birim, birimIn: birim ? turkishGenitiveSuffix(birim) : "",
					tarih: newsEventContext ? newsEventContext.tarih : "",
					aciklama: aciklama, evSahibi: evSahibi,
					yeniGorevli: yeniGorevli, yeniGorevliIn: yeniGorevli ? turkishGenitiveSuffix(yeniGorevli) : "", yeniGorevliDat: yeniGorevli ? turkishDativeSuffix(yeniGorevli) : "",
					eskiGorevli: eskiGorevli, eskiGorevliIn: eskiGorevli ? turkishGenitiveSuffix(eskiGorevli) : "", eskiGorevliDat: eskiGorevli ? turkishDativeSuffix(eskiGorevli) : "", eskiGorevliAcc: eskiGorevli ? turkishAccusativeSuffix(eskiGorevli) : "",
					gorev: gorev, gorevDat: gorev ? turkishDativeSuffix(gorev) : ""
				};
				document.getElementById("newsOutputText").value = tpl.paragraphs ? applyRichTemplate(tpl, ctx) : applyTemplate(tpl.metin, ctx);
				document.getElementById("newsModalBg").classList.add("open");
			}

			function closeNewsModal() { document.getElementById("newsModalBg").classList.remove("open"); newsPeopleOverride = null; newsEventContext = null; setNewsOutputMode("template"); const rawEl=document.getElementById("newsRawInput"); if(rawEl) rawEl.value=""; const poEl=document.getElementById("newsPromptOutput"); if(poEl) poEl.value=""; }
			// Denetim maddesi #6: Clipboard API destekleniyorsa (https bağlam, GitHub Pages'te
			// zaten öyle) onunla kopyalanır -- eski document.execCommand("copy") bazı mobil
			// tarayıcılarda güvenilmez. API yoksa/başarısız olursa eski yönteme geri düşülür.
			function copyToClipboardWithToast(text) {
				if (navigator.clipboard && navigator.clipboard.writeText) {
					navigator.clipboard.writeText(text).then(function(){ showToast("Panoya kopyalandı!", "success"); }).catch(function(){ showToast("Kopyalanamadı, elle seçip kopyalayın.", "error"); });
				} else {
					showToast("Kopyalanamadı, elle seçip kopyalayın.", "error");
				}
			}
			function copyNewsText() {
				const el = document.getElementById("newsOutputText");
				if (navigator.clipboard && navigator.clipboard.writeText) { copyToClipboardWithToast(el.value); return; }
				el.select(); document.execCommand("copy"); showToast("Panoya kopyalandı!", "success");
			}

			// Yapay zekaya hazirlama modu: uygulama HICBIR AI servisine baglanmaz, sadece kopyalanabilir bir komut metni uretir.
			const NEWS_PROMPT_COMMON_RULES = [
				"Yalnızca aşağıda verilen bilgileri kullan; belirtilmeyen hiçbir ayrıntıyı (kişi, tarih, sayı, konu vb.) uydurma veya varsayma.",
				"Bir bilgi verilmemişse o konudan hiç bahsetme; genel geçer/klişe ifadelerle doldurma yapma.",
				"Resmî kurum haberi diline uygun, sade ve nesnel bir üslup kullan.",
				"Kişi isim ve unvanlarını verildiği şekliyle birebir koru."
			];
			const NEWS_PROMPT_RULES = {
				mezuniyet: "Bu bir mezuniyet töreni haberi. Konuşma yapan kişilerin isim/unvanlarını ve varsa alıntılanan sözlerini olduğu gibi koru; uydurma alıntı ekleme. Varsa tören sırasını (konuşmalar, diploma töreni vb.) kronolojik anlat.",
				genel: "Bu, taslak hâlinde bir haber metnidir. Verilen taslağın anlamını ve içeriğini koruyarak resmî/kurumsal haber diline uygun şekilde yeniden düzenle; taslakta olmayan hiçbir bilgiyi ekleme.",
				diger: "Verilen notlardan resmî/kurumsal üslupta bir haber metni oluştur."
			};
			function setNewsOutputMode(mode) {
				const tplBtn=document.getElementById("newsModeTemplateBtn"); const promptBtn=document.getElementById("newsModePromptBtn");
				const tplPanel=document.getElementById("newsTemplateModePanel"); const promptPanel=document.getElementById("newsPromptPanel");
				const isPrompt = mode === "prompt";
				if(tplPanel) tplPanel.style.display = isPrompt ? "none" : "";
				if(promptPanel) promptPanel.style.display = isPrompt ? "" : "none";
				if(tplBtn){ tplBtn.style.background = isPrompt ? "#fff" : "var(--news)"; tplBtn.style.color = isPrompt ? "var(--news)" : "#fff"; }
				if(promptBtn){ promptBtn.style.background = isPrompt ? "var(--news)" : "#fff"; promptBtn.style.color = isPrompt ? "#fff" : "var(--news)"; }
			}
			// Ham notlardan, kurallar + baglam iceren, kopyalanabilir bir komut metni uretir. AG CAGRISI YAPMAZ.
			function buildNewsPrompt(){
				const catSel=document.getElementById("newsPromptCategorySelect"); const cat=catSel?catSel.value:"genel";
				const rawEl=document.getElementById("newsRawInput"); const raw=rawEl?rawEl.value:"";
				if(!raw.trim()){ showToast("Önce ham notlarınızı yapıştırın.", "error"); return; }
				const promptLines=["Aşağıdaki bilgilerden, üniversitemiz basın ofisi için resmî bir haber metni oluştur.", "", "KURALLAR:"];
				NEWS_PROMPT_COMMON_RULES.forEach(function(r){ promptLines.push("- " + r); });
				const catRule=NEWS_PROMPT_RULES[cat]; if(catRule) promptLines.push("- " + catRule);
				promptLines.push(""); promptLines.push("BAĞLAM:");
				const etkinlik=(newsEventContext&&newsEventContext.etkinlik)||""; const yer=(newsEventContext&&newsEventContext.yer)||""; const tarih=(newsEventContext&&newsEventContext.tarih)||"";
				if(etkinlik) promptLines.push("- Etkinlik: " + etkinlik);
				if(yer) promptLines.push("- Yer: " + yer);
				if(tarih) promptLines.push("- Tarih: " + tarih);
				let selectedPeople=[];
				if(newsPeopleOverride && newsPeopleOverride.length) selectedPeople=newsPeopleOverride.slice();
				else if(newsSelection.length) selectedPeople=newsSelection.map(function(idx){ return people[idx]; }).filter(Boolean);
				if(selectedPeople.length){
					const names=selectedPeople.map(function(p){ let str=p.title?p.title.trim()+" ":""; if(p.prefix) str+=p.prefix.trim()+" "; str+=p.name?p.name.trim():""; return str.trim(); });
					promptLines.push("- Katılımcılar: " + names.join(", "));
				}
				promptLines.push(""); promptLines.push("HAM NOTLAR:"); promptLines.push(raw.trim());
				document.getElementById("newsPromptOutput").value = promptLines.join("\n");
			}
			function copyNewsPrompt() {
				const el=document.getElementById("newsPromptOutput"); if(!el.value.trim()){ showToast("Önce komut oluşturun.", "error"); return; }
				if (navigator.clipboard && navigator.clipboard.writeText) { copyToClipboardWithToast(el.value); return; }
				el.select(); document.execCommand("copy"); showToast("Panoya kopyalandı!", "success");
			}

			async function restoreSingle(idx) {
				if (!requireEdit()) return;
				const p = people[idx]; if (!p) { showToast("Kayıt bulunamadı.", "error"); return; }
				// Çöpe atılmadan önce hangi durumdaysa (aktif ya da pasif/arşiv) o duruma geri döner;
				// bu alan eklenmeden önce çöpe atılmış eski kayıtlarda bilgi yoksa varsayılan olarak aktif'e döner.
				const oldRecord = Object.assign({}, p);
				const restoredStatus = p.prevStatus || "aktif";
				p.status = restoredStatus; delete p.prevStatus;
				const hasRank = p.rank !== undefined && p.rank !== null && p.rank !== "";
				const destLabel = restoredStatus === "pasif" ? "arşive (pasif)" : "aktif listeye";
				const label = (p.name || "Kayıt") + " kişisi yeniden " + destLabel + " katıldı" + (hasRank ? (", " + p.rank + ". sıraya") : "");
				// Tüm listeyi değil, SADECE bu kaydı yazar -- geri yükleme başka bir kaydı asla etkilemez.
				const rOk = await savePerson(idx, label, p.name);
				if (!rOk) { people[idx] = oldRecord; render(); return; }
				render(); showToast(restoredStatus === "pasif" ? "Kayıt arşive (pasif) geri alındı." : "Kayıt aktif klasörüne geri alındı.");
			}

			function openSinglePermDelete(idx) { singlePermDeleteIdx = idx; closeModal(); document.getElementById("singlePermDeleteModalBg").classList.add("open"); }
			function closeSinglePermDelete() { document.getElementById("singlePermDeleteModalBg").classList.remove("open"); singlePermDeleteIdx = null; }
			async function executeSinglePermDelete() {
				if (!requireEdit()) return;
				if (!database || !LIST_PATHS[currentListKey]) { showToast("Veritabanı bağlı değil!", "error"); return; }
				if (singlePermDeleteIdx !== null && people[singlePermDeleteIdx]) {
					const id = singlePermDeleteIdx;
					const name = (people[id] && people[id].name) ? people[id].name : "Kayıt";
					const prevRecord = people[id];
					delete people[id];
					// ID'ler kalıcı olduğu için diğer seçimler etkilenmez; sadece silinen kaydın kendisi
					// "Rektörlük / Merkez" filtresinde seçiliyse temizlenir.
					selectedCentralAdminIdx.delete(id);
					globalFuseSourceRef = null;
					let spOk = false;
					try {
						// SADECE bu kaydın kendi düğümü silinir (update() içinde null = remove) -- log ile
						// AYNI atomik update() isteğinde gider, tüm listeyi yeniden yazmadığı için başka
						// bir kaydı etkilemez.
						const updates = {}; updates[dbPath(LIST_PATHS[currentListKey] + "/" + id)] = null;
						let logKey = null;
						if (currentUser) {
							logKey = database.ref(dbPath("logs/" + currentListKey)).push().key;
							const who = ((currentUser.firstName||"") + " " + (currentUser.lastName||"")).trim() || currentUser.email;
							updates[dbPath("logs/" + currentListKey) + "/" + logKey] = { by: who, email: currentUser.email, action: name + " kişisi kalıcı olarak silindi", target: name, timestamp: firebase.database.ServerValue.TIMESTAMP };
						}
						await database.ref("/").update(updates);
					if (!logKey) { console.error("Log kaydı yazılamadı: currentUser tanımsız."); showToast("Kişi kalıcı olarak silindi ancak işlem günlüğüne yazılamadı.", "warn"); }
						spOk = true;
					} catch (err) { console.error("Kaydedilemedi:", err); showToast("Buluta kaydedilemedi.", "error"); }
					closeSinglePermDelete();
					if (!spOk) { people[id] = prevRecord; render(); return; }
					render(); showToast("Kayıt kalıcı olarak silindi.", "warn");
				}
			}

			function openEmptyTrashModal() { document.getElementById("emptyTrashModalBg").classList.add("open"); }
			function closeEmptyTrashModal() { document.getElementById("emptyTrashModalBg").classList.remove("open"); }
			async function executeEmptyTrash() {
				if (!requireEdit()) return;
				// Arama kutusunda bir sorgu varken (ör. "Ahmet" yazılıp ekranda 1 kişi kalmışken)
				// bu buton ESKİDEN people nesnesindeki TÜM "silindi" kayıtlarını (filtreyi
				// görmezden gelerek) kalıcı siliyordu -- kullanıcı ekranda görmediği kayıtları da
				// yok ediyordu. Artık SADECE render()'ın en son "silindi" sekmesinde EKRANDA
				// GÖSTERDİĞİ kayıtlar (visibleTrashIds) silinir.
				const idsToRemove = Object.keys(people).filter(function(id) { return people[id].status === "silindi" && (!visibleTrashIds || visibleTrashIds.includes(id)); });
				const removedCount = idsToRemove.length;
				if (!removedCount) { closeEmptyTrashModal(); showToast("Çöp kutusu zaten boş.", "success"); return; }
				const prevRecords = {}; idsToRemove.forEach(function(id) { prevRecords[id] = people[id]; });
				// Her silinecek ID için .update() patch'inde deger "null" verilir -- Firebase bunu
				// o TEK düğümü silmek olarak yorumlar, tüm listeyi yeniden yazmaz (bkz. saveData()).
				const patch = {}; idsToRemove.forEach(function(id) { patch[id] = null; delete people[id]; });
				selectedCentralAdminIdx.clear();
				const etOk = await saveData("Çöp kutusu boşaltıldı (" + removedCount + " kayıt kalıcı olarak silindi)", undefined, patch);
				closeEmptyTrashModal();
				if (!etOk) { idsToRemove.forEach(function(id) { people[id] = prevRecords[id]; }); render(); return; }
				render(); showToast("Çöp kutusu tamamen boşaltıldı.", "warn");
			}

			async function sortRankGroupByName(evt, key) {
				evt.preventDefault(); evt.stopPropagation();
				if (!requireEdit()) return;
				const groupPeople = peopleList().map(function(p) { return { p: p, idx: p._id }; })
					.filter(o => (!o.p.status || o.p.status === "aktif") && ((o.p.rank === "" || o.p.rank == null) ? "__none__" : String(o.p.rank)) === key);

				groupPeople.sort((a, b) => {
					const ha = getHierarchyWeight(a.p); const hb = getHierarchyWeight(b.p); if (ha !== hb) return ha - hb;
					const ia = getInstitutionWeight(a.p); const ib = getInstitutionWeight(b.p); if (ia !== ib) return ia - ib;
					return (a.p.name || "").localeCompare(b.p.name || "", "tr");
				});

				const prevOrders = groupPeople.map(o => ({ idx: o.idx, order: o.p.order }));
				// Sadece değişen "order" alanı, her kişinin KENDİ id'si altında ("id/order") .update()
				// ile yazılır -- tüm listeyi yeniden yazmak, bu sırada başka bir editörün eklediği bir
				// kaydı kaybettirebilirdi (bkz. CLAUDE.md #4 -- reorder her zaman hedefli update olmalı).
				const patch = {};
				groupPeople.forEach((o, i) => { people[o.idx].order = i + 1; patch[o.idx + "/order"] = i + 1; });
				const groupLabel = key === "__none__" ? "Sırasız" : ("Sıra " + key);
				const srtOk = await saveData(groupLabel + " grubu (" + groupPeople.length + " kişi) isme göre A-Z sıralandı", undefined, patch);
				if (!srtOk) { prevOrders.forEach(function(o) { if (people[o.idx]) people[o.idx].order = o.order; }); render(); return; }
				showToast("İsim sırasına göre düzenlendi.", "success");
				render();
			}

			function toggleReorderMode() {
				if (!isReorderMode && !requireEdit()) return;
				if (isBulkMode) toggleBulkDeleteMode(); if (isNewsMode) toggleNewsMode();
				if (mode !== "aktif") document.querySelector('[data-mode="aktif"]').click();
				
				isReorderMode = !isReorderMode;
				const btn = document.getElementById("reorderBtn"); const search = document.getElementById("search"); const tabs = document.querySelectorAll("#statusToggle button");

				if (isReorderMode) {
					btn.innerHTML = "✓ Sıralamayı Kaydet"; btn.classList.replace("btn-ghost", "btn-primary");
					search.value = ""; search.disabled = true; tabs.forEach(t => t.disabled = true); 
					showToast("Sıralama modu aktif.", "success");
				} else {
					btn.innerHTML = "Sıralamayı Düzenle"; btn.classList.replace("btn-primary", "btn-ghost");
					search.disabled = false; tabs.forEach(t => t.disabled = false);
				}
				
				if (!isReorderMode) { sortableInstances.forEach(inst => inst.destroy()); sortableInstances = []; }
				render();
			}

			// "Silinenler" sekmesinde açılan kırmızı "Çöp Kutusunu Boşalt" butonu, liste değiştirilince ekranda kalıyordu:
			// kullanıcı Aktif listeye bakarken o butona basıp, hiç görmediği diğer listenin çöpünü kalıcı silebiliyordu.
			function applyModeToolbar() {
				const emptyTrashBtn = document.getElementById("emptyTrashBtn");
				const bulkDelBtn = document.getElementById("bulkDeleteModeBtn");
				const actionsLeft = document.getElementById("actionsLeftWrap");
				const trashView = (mode === "silindi");
				if (emptyTrashBtn) emptyTrashBtn.style.display = trashView ? "inline-flex" : "none";
				if (bulkDelBtn) bulkDelBtn.style.display = trashView ? "none" : "inline-flex";
				// bkz. toggleBulkDeleteMode() yorumu -- sabit "flex" mobildeki grid duzenini eziyordu
				// (Il/Universite listeleri arasinda gecince butonlar tek sutuna dusuyordu). switchList()
				// her liste degisiminde bunu cagirdigi icin sorun ozellikle liste degistirince ortaya cikiyordu.
				if (actionsLeft) { if (trashView) actionsLeft.style.display = "none"; else actionsLeft.style.removeProperty("display"); }
			}

			document.getElementById("statusToggle").addEventListener("click", function(e){
			if(isReorderMode || isBulkMode || isNewsMode) return; 
			const btn = e.target.closest("button"); if(!btn) return;
			mode = btn.dataset.mode; 
			document.querySelectorAll("#statusToggle button").forEach(b => b.classList.remove("active"));
			btn.classList.add("active"); 
			applyModeToolbar();
			render();
			});

			function initials(name) { return name ? name.split(" ").filter(Boolean).map(w=>w[0]).slice(0,2).join("").toUpperCase() : "?"; }
			function escapeHtml(str) { return String((str === undefined || str === null) ? "" : str).replace(/[&<>"']/g, function (c) { return {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]; }); }
			// Fotoğraf değeri doğrudan <img src="..."> içine yazıldığı için, sadece güvenli şemalara izin verilir.
			// Aksi hâlde kayda yazılmış bir metin, tırnaktan kaçıp herkesin tarayıcısında kod çalıştırabilir.
			// Dosya SEÇEREK yüklenen fotoğraflar zaten previewPhoto()/previewSuccessorPhoto() içinde canvas ile
			// 480px'e ve JPEG 0.75'e sıkıştırılıyor (küçük kalır) -- ama JSON İÇE AKTARMA bu adımı ATLAYIP
			// harici bir kaynaktan (ör. başka bir cihazda hiç sıkıştırılmamış orijinal bir fotoğraf) gelen
			// data: URI'yi doğrudan buraya verebilir. Firebase RTDB'de tek bir düğüm ~10MB ile sınırlı ve büyük
			// bir kayıt TÜM listeyi indiren her istemcinin performansını etkiler -- bu yüzden burada da bir
			// üst sınır uygulanır (2MB base64 metin ~1.5MB gerçek görsel veriye denk gelir, sıkıştırılmış bir
			// portre fotoğrafı için bolca yeterli).
			const MAX_PHOTO_DATA_URL_LENGTH = 2 * 1024 * 1024;
			function safePhotoUrl(u) {
				const s = String(u === undefined || u === null ? "" : u).trim();
				if (!s) return "";
				if (/^https?:\/\//i.test(s)) return s;
				if (/^data:image\//i.test(s)) return s.length <= MAX_PHOTO_DATA_URL_LENGTH ? s : "";
				return "";
			}
			function fmtDate(d) { if(!d) return "—"; const parts = d.split("-"); return parts.length === 3 ? parts[2] + "." + parts[1] + "." + parts[0] : d; }

			function render() {
			const q = document.getElementById("search").value.trim().toLocaleLowerCase("tr");
			
			if (!isReorderMode) { 
				const clrBtn = document.getElementById("clearSearchBtn"); 
				if(clrBtn) clrBtn.style.display = q.length > 0 ? "flex" : "none"; 
			}

			let listAll = peopleList();
			let list;
			if (!q) {
				list = listAll;
			} else {
				// Bulanik (fuzzy) arama: yazim hatasi/eksik harfte de eslesme bulunsun diye Fuse.js
				// kullanilir. Hem sorgu (q) hem indekslenen _search alani AYNI sekilde onceden
				// Turkce-duyarli kucuk harfe cevrilir -- Fuse'un kendi kucuk-harf donusumu
				// Turkce İ/ı harflerini yanlis isler, ona guvenilmez. Siralama (protokol rutbesi)
				// asagida AYRI yapiliyor, Fuse'un alaka sirasi onemsiz -- sadece ESLESEN KUME lazim.
				if (globalFuseSourceRef !== people) {
					const searchable = listAll.map(p => ({ p: p, _search: ((p.name||"")+" "+(p.prefix||"")+" "+(p.title||"")+" "+(p.unit||"")).toLocaleLowerCase("tr") }));
					globalFuse = new Fuse(searchable, { keys: ["_search"], threshold: 0.35, ignoreLocation: true });
					globalFuseSourceRef = people;
				}
				list = globalFuse.search(q).map(r => r.item.p);
				// Birebir (alt string) eşleşen en az bir kayıt varsa, SADECE onlar gösterilir --
				// bulanık toleransla eşleşen ama aslında alakasız kayıtlar (örn. "Fen Fakültesi"
				// aranınca "İktisadi ve İdari Bilimler Fakültesi" gibi) listeden düşer. Birebir
				// eşleşen HİÇ yoksa (yazım hatası ihtimali), bulanık sonuçlar aynen korunur.
				const exactMatches = list.filter(p => ((p.name||"")+" "+(p.prefix||"")+" "+(p.title||"")+" "+(p.unit||"")).toLocaleLowerCase("tr").includes(q));
				if (exactMatches.length) list = exactMatches;
			}

			// Beklenmeyen/gecersiz bir status degeri (ör. Firebase Console'dan elle girilmis bir
			// yazim hatasi) kaydi HICBIR sekmede gostermeyip "kayip" gibi gorunmesine yol acmasin diye,
			// "pasif"/"silindi" DISINDAKI her sey aktif sekmesinde gorunur.
			if(mode === "aktif") list = list.filter(p => p.status !== "pasif" && p.status !== "silindi");
			else if(mode === "pasif") list = list.filter(p => p.status === "pasif");
			else if(mode === "silindi") list = list.filter(p => p.status === "silindi");

			// Üniversite listesinde soldaki fakülte/birim filtresi (reorder modunda tam tabloyu görmek için uygulanmaz)
			// Çöp görünümünde filtre uygulanmaz: ekranda "Kayıt Yok" yazarken "Çöp Kutusunu Boşalt"
			// yine de filtrelenmemiş TÜM kayıtları sildiği için kullanıcı görmediği veriyi yok ediyordu.
			if (currentListKey === "universite" && !isReorderMode && mode !== "silindi" && (selectedFaculties.size > 0 || selectedCentralAdminIdx.size > 0)) {
				list = list.filter(p => {
					if (selectedCentralAdminIdx.has(p._id)) return true;
					if (selectedFaculties.size && Array.isArray(p.faculties) && p.faculties.some(f => selectedFaculties.has(f))) return true;
					return false;
				});
			}

			visibleTrashIds = (mode === "silindi") ? list.map(p => p._id) : null;
			visibleActiveIds = (mode === "aktif") ? list.map(p => p._id) : [];

			list.sort((a,b) => {
				// Arama sorgusu varsa: birebir (alt string) eşleşenler, sadece bulanık (Fuse
				// toleransıyla) eşleşenlerin ÖNÜNE geçer -- "Fen Fakültesi" gibi spesifik bir
				// ifade arandığında, o metni GERÇEKTEN içeren kayıtlar alakasız bulanık
				// eşleşmelerin altında kalmasın diye. Sadece arama sırasında devrede (q boşsa
				// hepsi "exact" sayılır, davranış değişmez).
				if (q) {
					const aExact = ((a.name||"")+" "+(a.prefix||"")+" "+(a.title||"")+" "+(a.unit||"")).toLocaleLowerCase("tr").includes(q) ? 0 : 1;
					const bExact = ((b.name||"")+" "+(b.prefix||"")+" "+(b.title||"")+" "+(b.unit||"")).toLocaleLowerCase("tr").includes(q) ? 0 : 1;
					if (aExact !== bExact) return aExact - bExact;
				}
				// Sırasız kayıtlar önceden -Infinity ile EN ÜSTE, yani Rektör'ün de önüne çıkıyordu.
			// Haber çıktısı zaten Infinity kullanıyordu; ikisi artık aynı: sırasızlar en sonda.
			const ra = (a.rank === "" || a.rank == null || isNaN(Number(a.rank))) ? Infinity : Number(a.rank); const rb = (b.rank === "" || b.rank == null || isNaN(Number(b.rank))) ? Infinity : Number(b.rank); if(ra !== rb) return ra - rb;
				const ha = getHierarchyWeight(a); const hb = getHierarchyWeight(b); if(ha !== hb) return ha - hb;
				const ia = getInstitutionWeight(a); const ib = getInstitutionWeight(b); if(ia !== ib) return ia - ib;
				const oa = (a.order === "" || a.order == null) ? Infinity : Number(a.order); const ob = (b.order === "" || b.order == null) ? Infinity : Number(b.order); if(oa !== ob) return oa - ob;
				return (a.name||"").localeCompare(b.name||"", "tr");
			});

			const grid = document.getElementById("grid");
			grid.innerHTML = ""; document.getElementById("countLabel").textContent = list.length + " Kayıt";
			if(list.length === 0){ document.getElementById("emptyState").style.display = "block"; return; } document.getElementById("emptyState").style.display = "none";

			// DOM thrashing onlenir: kartlar/gruplar tek tek zaten DOM'a EKLENMIS "grid"e degil,
			// once bagimsiz (detached) bir DocumentFragment'e eklenir -- tarayici her appendChild'da
			// ayri bir reflow/layout hesabi yapmak yerine, asagida TEK bir grid.appendChild(frag)
			// ile hepsini birden, tek reflow'da yerlestirir. Buyuk listelerde (120+ kayit) etkisi
			// daha belirgindir.
			const frag = document.createDocumentFragment();

			if (isReorderMode) {
				grid.classList.add("is-reorder");

				const topBar = document.createElement("div"); topBar.className = "reorder-header-bar";
				topBar.innerHTML = `<p class="rank-lock-hint"><b>SABİT KAT:</b> Her kişi <u>sadece</u> kendi protokol sırası içinde sürüklenip taşınabilir. Kişinin asıl sıra numarası değişmez, sadece o sıradaki yatay dizilim değişir. <b>Ayrıca</b> her sıranın içinde de unvan katmanına göre bir kilit vardır: örn. bir "Dr." unvanlı kişi, aynı sıradaki bir "Prof. Dr." veya "Rektör Yardımcısı" gibi daha üst unvanlı birinin önüne geçemez, sadece kendi unvan katmanı içinde yer değiştirebilir. Sırayı açmak için başlığına tıkla.</p>
					<div class="reorder-toolbar"><button type="button" onclick="document.querySelectorAll('details.rank-group').forEach(d=>d.open=true)">Hepsini Aç</button> <button type="button" onclick="document.querySelectorAll('details.rank-group').forEach(d=>d.open=false)">Hepsini Kapat</button></div>`;
				frag.appendChild(topBar);

				const groupsOrder = []; const groupsMap = {};
				list.forEach(p => { const key = (p.rank === "" || p.rank == null) ? "__none__" : String(p.rank); if (!groupsMap[key]) { groupsMap[key] = { key: key, rank: p.rank, items: [] }; groupsOrder.push(key); } groupsMap[key].items.push(p); });

				groupsOrder.forEach(key => {
				const g = groupsMap[key]; const section = document.createElement("details"); section.className = "rank-group";
				if (openedRanks.has(key)) section.open = true;
				section.addEventListener("toggle", function() { if (section.open) openedRanks.add(key); else openedRanks.delete(key); });

				const summary = document.createElement("summary"); summary.innerHTML = ((key === "__none__") ? "Sırasız" : ("Sıra " + escapeHtml(g.rank))) + ' <span class="count-pill">' + g.items.length + ' kişi</span>' + ' <button type="button" class="az-sort-btn" onclick="sortRankGroupByName(event, \'' + escapeHtml(key) + '\')">A-Z İsme Göre Sırala</button>'; section.appendChild(summary);
				const subgrid = document.createElement("div"); subgrid.className = "rank-subgrid"; subgrid.dataset.rankKey = key;

				g.items.forEach((p, idx) => {
					const row = document.createElement("div"); row.className = "reorder-row"; row.dataset.pid = p._id;
					const rowPhoto = safePhotoUrl(p.photo);
						const imgHtml = rowPhoto ? '<img src="' + escapeHtml(rowPhoto) + '" alt="" loading="lazy">' : "";
					row.innerHTML = `<div class="internal-order-badge">${idx + 1}</div> <span class="drag-handle-mini">⋮⋮</span> <span class="row-thumb">${imgHtml || escapeHtml(initials(p.name))}</span>
					<span class="row-text"><span class="row-name">${p.prefix ? '<span style="color:var(--off);font-size:11px;">'+escapeHtml(p.prefix)+'</span><br>' : ''}${escapeHtml(p.name)}</span><span class="row-title">${escapeHtml(p.title)}</span></span>`;
					subgrid.appendChild(row);
				});
				section.appendChild(subgrid); frag.appendChild(section);
				});
				grid.appendChild(frag); // tek reflow: butun reorder DOM'u burada BIRDEN yerlesir

				sortableInstances.forEach(inst => inst.destroy()); sortableInstances = [];
				document.querySelectorAll(".rank-subgrid").forEach(subgrid => {
				const inst = new Sortable(subgrid, {
					animation: 200, handle: '.drag-handle-mini', ghostClass: 'dragging', delay: 150, delayOnTouchOnly: true,
					onMove: function (evt) {
					const draggedId = evt.dragged.dataset.pid; const relatedId = evt.related.dataset.pid;
					const dp = people[draggedId], rp = people[relatedId];
					if (!dp || !rp) return false;
					if (getHierarchyWeight(dp) !== getHierarchyWeight(rp)) return false;
					if (getInstitutionWeight(dp) !== getInstitutionWeight(rp)) return false;
					return true;
					},
					onEnd: async function (evt) {
					if (evt.oldIndex === evt.newIndex) return; const rowEls = Array.from(subgrid.children);
					// Sürükleme sırasında liste uzaktan değişmiş olabilir; silinmiş bir kayda yazmaya çalışmayı önler.
					if (rowEls.some(function(el){ return !people[el.dataset.pid]; })) { showToast("Liste değişti, sıralama kaydedilmedi.", "error"); render(); return; }
					// Sadece değişen "order" alanları id/order yoluyla .update() ile yazılır -- tüm listeyi
					// yeniden yazmak, aynı anda başka bir editörün eklediği bir kaydı kaybettirebilirdi.
					const patch = {};
					rowEls.forEach((el, idx) => { const pid = el.dataset.pid; people[pid].order = idx + 1; patch[pid + "/order"] = idx + 1; el.querySelector('.internal-order-badge').textContent = idx + 1; });
					const draggedId = evt.item.dataset.pid;
					const draggedName = (people[draggedId] && people[draggedId].name) ? people[draggedId].name : "Kayıt";
					const rankKey = subgrid.dataset.rankKey === "__none__" ? "Sırasız" : ("Sıra " + subgrid.dataset.rankKey);
					// Surukleme kaydedilemezse ekrandaki yeni dizilim yaniltici olur; liste geri cizilir.
					const dragOk = await saveData(draggedName + " kişisi " + rankKey + " içinde " + (evt.newIndex + 1) + ". konuma sürüklendi", draggedName, patch);
					if (!dragOk) render();
					}
				}); sortableInstances.push(inst);
				});

			} else {
				grid.classList.remove("is-reorder");

				list.forEach(p => {
					const card = document.createElement("div"); let cClass = "card";
					if (p.status === "pasif") cClass += " pasif"; if (p.status === "silindi") cClass += " silindi";
					
					// ARAMA YAPILDIĞINDA SEÇİMLERİN KORUNMASI İÇİN "checked" DURUMUNU SEÇİM DİZİSİNDEN (Array) KONTROL EDİYORUZ
					if (isBulkMode) { cClass += " bulk-mode"; if (bulkSelection.includes(p._id)) cClass += " bulk-selected"; }
					else if (isNewsMode) { cClass += " news-mode"; if (newsSelection.includes(p._id)) cClass += " news-selected"; }

					card.className = cClass; card.dataset.pid = p._id;
					const safePhoto = safePhotoUrl(p.photo);
					const imgHtml = safePhoto ? '<img src="' + escapeHtml(safePhoto) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">' : "";
					const hasRank = (p.rank !== undefined && p.rank !== ""); const cbLeft = hasRank ? '42px' : '10px';

					const bulkHtml = isBulkMode ? '<input type="checkbox" class="bulk-cb" style="left:'+cbLeft+';" ' + (bulkSelection.includes(p._id) ? 'checked' : '') + '>' : "";
					const newsHtml = isNewsMode ? '<input type="checkbox" class="news-cb" style="left:'+cbLeft+';" ' + (newsSelection.includes(p._id) ? 'checked' : '') + '>' : "";

					let actionHtml = "";
					const fresh = getFreshnessInfo(p);
					const freshTitle = p.sonDogrulamaTs ? ("Son doğrulama: " + fmtDate(dKey(new Date(p.sonDogrulamaTs))) + " · " + (VERIFICATION_SOURCES[p.dogrulamaKaynak] || p.dogrulamaKaynak || "") + (p.dogrulayan ? " · " + p.dogrulayan : "")) : "Bu kayıt hiç doğrulanmadı.";
					if (isBulkMode || isNewsMode) {
						const selectionHint = isBulkMode ? "Silmek istediğiniz kayıtları seçin." : "Habere dahil etmek istediğiniz kişileri seçin.";
						actionHtml = '<div style="text-align:center; font-size:11px; font-weight:600; color:var(--muted); margin-top:auto; padding:7px; background:var(--surface-hover); border-radius:7px;">' + selectionHint + '</div>';
					}
					else if (mode === "silindi") {
						// Kimlik (push-ID) inline JS string'e degil, karta zaten atanmis card.dataset.pid'e
						// gore delegated listener'da okunur (bkz. #grid click listener'i) -- escapeHtml()
						// HTML-attribut baglaminda kacisi cozer ama inline JS-string baglaminda kacisi
						// COZMEZ (tarayici HTML-decode ETTIKTEN SONRA JS parse eder), bu yuzden id'yi hic
						// inline handler string'ine gomulmemek asil guvenli yol.
						actionHtml = canEditData() ? `
							<div style="display:flex; gap:8px; margin-top:auto;">
								<button class="card-action-btn btn-restore-card">Geri Yükle</button>
								<button class="card-action-btn btn-permdel-card">Kalıcı Sil</button>
							</div>
						` : "";
					}
					else { actionHtml = canEditData() ? '<button class="card-edit">Düzenle</button>' : ""; }

					card.innerHTML = bulkHtml + newsHtml +
					'<div class="photo-wrap"><div class="avatar-fallback">' + escapeHtml(initials(p.name)) + '</div>' + imgHtml +
						'<div class="rank-badge">' + (hasRank ? escapeHtml(p.rank) : '?') + '</div>' +
						'<span class="status-chip ' + escapeHtml(p.status || 'aktif') + '">' + (p.status === "pasif" ? "Arşiv" : p.status === "silindi" ? "Silindi" : "Aktif") + '</span>' +
					'</div>' +
					'<div class="info">' +
						'<p class="name">' + (p.prefix ? '<span class="prefix">' + escapeHtml(p.prefix) + '</span> ' : '') + escapeHtml(p.name) + '</p>' +
						'<p class="title">' + escapeHtml(p.title) + '</p>' +
						'<p class="unit">' + escapeHtml(p.unit) + '</p>' +
						'<div class="meta"><span>' + escapeHtml(fmtDate(p.start)) + '</span><span>' + (p.end ? escapeHtml(fmtDate(p.end)) : "devam ediyor") + '</span></div>' +
						'<span class="freshness-badge ' + fresh.level + '" title="' + escapeHtml(freshTitle) + '">' + fresh.icon + ' ' + fresh.label + '</span>' +
						(p.note ? '<p class="note">' + escapeHtml(p.note) + '</p>' : '') + actionHtml +
					'</div>';

					if (isBulkMode) { card.onclick = (function(personIdx, crd) { return function(e) { if(e.target.type === "checkbox") { updateBulkSelection(personIdx, e.target.checked, crd); return; } const cb = crd.querySelector('.bulk-cb'); cb.checked = !cb.checked; updateBulkSelection(personIdx, cb.checked, crd); };})(p._id, card); }
					else if (isNewsMode) { card.onclick = (function(personIdx, crd) { return function(e) { if(e.target.type === "checkbox") { updateNewsSelection(personIdx, e.target.checked, crd); return; } const cb = crd.querySelector('.news-cb'); cb.checked = !cb.checked; updateNewsSelection(personIdx, cb.checked, crd); };})(p._id, card); }

					frag.appendChild(card);
				});
				grid.appendChild(frag); // tek reflow: butun kart listesi burada BIRDEN yerlesir
			}
			}

			function resetForm(){
				document.getElementById("personForm").reset(); document.getElementById("f_status").value = "aktif"; document.getElementById("f_prefix").value = "";
				document.getElementById("f_rank").value = "";
				// Üniversite Protokol Sırası'nda "Kurum" her zaman OMÜ'dür; yeni kayıt açılışında hazır gelsin (istenirse değiştirilebilir).
				// Düzenleme sırasında openEditModal() bu alanı hemen ardından kişinin gerçek/eski değeriyle eziyor, yani mevcut kayıtlar hiç bozulmuyor.
				document.getElementById("f_unit").value = currentListKey === "universite" ? "Ondokuz Mayıs Üniversitesi" : "";
				document.getElementById("f_start").value = ""; document.getElementById("photoPreview").style.display = "none"; document.getElementById("photoPreview").dataset.value = ""; document.getElementById("f_photo_url").value = ""; document.getElementById("endDateField").style.display = "none";
				document.getElementById("statusReasonBlock").style.display = "none"; document.getElementById("sr_applyRow").style.display = "none"; document.getElementById("successorTriggerWrap").style.display = "none"; lastStatusTransitionNote = "";
				document.getElementById("f_note").style.height = "54px";
				['f_name', 'f_title', 'f_unit', 'f_rank'].forEach(toggleFieldClear);
				updateSaveButtonLock(); // openAddModal() refreshStatusReasonBlock() cagirmiyor -- onceki bir pasif+yerine_atama oturumundan kalan disabled=true burada temizlenir
			}

			const UNIVERSITY_PROTOCOL_TITLES = [
				"Rektör",
				"Rektör Yardımcıları",
				"Genel Sekreter",
				"Fakülte Dekanları",
				"Enstitü ve Yüksekokul Müdürleri",
				"Dekan Yardımcıları ve Müdür Yardımcıları",
				"Profesörler",
				"Doçentler",
				"Doktor Öğretim Üyeleri",
				"Bölüm Başkanları ve Anabilim Dalı Başkanları",
				"Öğretim Görevlileri ve Araştırma Görevlileri",
				"Daire Başkanları"
			];
			function renderRankReferencePanel() {
				const panel = document.getElementById("rankReference");
				const el = document.getElementById("rankReferenceList");
				if (!panel || !el) return;
				if (currentListKey !== "universite") { panel.style.display = "none"; return; }
				panel.style.display = "";
				el.innerHTML = UNIVERSITY_PROTOCOL_TITLES.map(function(title, i){
				return '<div class="rr-row"><span class="rr-num">' + (i + 1) + '</span><div class="rr-info"><span class="rr-t">' + escapeHtml(title) + '</span></div></div>';
				}).join("");
			}

function renderFacultyPickerField(selected) {
				const fieldWrap = document.getElementById("facultyField");
				const wrap = document.getElementById("facultyMultiSelect");
				const searchInput = document.getElementById("facultyMultiSearch");
				if (!fieldWrap || !wrap) return;
				if (searchInput) searchInput.value = ""; // form her açıldığında önceki oturumdan kalan arama metni temizlensin
				if (currentListKey !== "universite") { fieldWrap.style.display = "none"; wrap.innerHTML = ""; const pw=document.getElementById("facultyMultiPills"); if(pw) pw.innerHTML=""; return; }
				fieldWrap.style.display = "";
				const sel = new Set(selected || []);
				wrap.innerHTML = FACULTY_GROUPS.map(function(g) {
					// Kişinin zaten seçili olduğu birim(ler) hangi gruptaysa, o grup otomatik açık gelir.
					const hasSelected = g.items.some(function(item) { return sel.has(item); });
					return '<details class="fm-group"' + (hasSelected ? " open" : "") + '><summary class="fm-group-title">' + escapeHtml(g.title) + '</summary>' +
						g.items.map(function(item) {
							const checked = sel.has(item) ? "checked" : "";
							return '<label class="fm-item"><input type="checkbox" class="fm-cb" value="' + escapeHtml(item) + '" ' + checked + '><span>' + escapeHtml(item) + '</span></label>';
						}).join("") +
					'</details>';
				}).join("");
				// Kişinin işaretli olduğu birim(ler) varsa, kutuyu elle kaydırmaya gerek kalmadan
				// listede EN ÜSTTE duran işaretli seçenek otomatik görünür alana (kutunun üstüne) getirilir.
				// Birden fazla işaretli birim varsa da yine sadece listede daha önce gelen (en üstteki) esas alınır;
				// alttaki ikinci işaretli seçeneğe göre kaydırma yapılmaz.
				const firstCheckedItem = wrap.querySelector(".fm-cb:checked");
				if (firstCheckedItem) {
					const row = firstCheckedItem.closest(".fm-item");
					wrap.scrollTop += row.getBoundingClientRect().top - wrap.getBoundingClientRect().top;
				} else {
					wrap.scrollTop = 0;
				}
				syncCoordExtraRoleField();
				renderFacultyMultiPills();
			}

			// Aşağıdaki birim/ek görev kutusunda işaretlenenler değiştikçe, "Birim / Kurum" alanı
			// "Ondokuz Mayıs Üniversitesi - Fen Fakültesi" şeklinde canlı olarak güncellenir.
			// Görev unvanı (Dekan, Rektör Yrd. vb.) zaten ayrı bir alanda elle yazıldığı için buraya eklenmez.
			function syncUnitFromFaculties() {
				if (currentListKey !== "universite") return;
				const wrap = document.getElementById("facultyMultiSelect");
				const unitInput = document.getElementById("f_unit");
				if (!wrap || !unitInput) return;
				const selected = Array.from(wrap.querySelectorAll(".fm-cb:checked")).map(function(cb) { return cb.value; });
				unitInput.value = "Ondokuz Mayıs Üniversitesi" + (selected.length ? " - " + selected.join(", ") : "");
				toggleFieldClear("f_unit");
			}
			// Koordinatörlük seçilince altta "bu kişinin X'teki ek görevi nedir?" serbest metin alanı açılır.
			function syncCoordExtraRoleField() {
				const wrap = document.getElementById("facultyMultiSelect");
				const field = document.getElementById("coordExtraRoleField");
				const label = document.getElementById("coordExtraRoleLabel");
				if (!wrap || !field || !label) return;
				const coordGroup = FACULTY_GROUPS.find(function(g){ return g.title === "Koordinatörlükler"; });
				const coordItems = coordGroup ? coordGroup.items : [];
				const selectedCoord = Array.from(wrap.querySelectorAll(".fm-cb:checked")).map(function(cb){ return cb.value; }).filter(function(v){ return coordItems.indexOf(v) !== -1; });
				if (!selectedCoord.length) { field.style.display = "none"; return; }
				field.style.display = "";
				label.textContent = "Bu kişinin " + selectedCoord.join(", ") + "'teki ek görevi nedir?";
			}
			// Seçili birim(ler)in canlı pill/etiket önizlemesi -- her pill'in × butonu ilgili
			// checkbox'ı kaldırıp aynı senkron zincirini (unit alanı + koordinatörlük alanı) tetikler.
			function renderFacultyMultiPills() {
				const pillsWrap = document.getElementById("facultyMultiPills");
				const wrap = document.getElementById("facultyMultiSelect");
				if (!pillsWrap || !wrap) return;
				const checked = Array.from(wrap.querySelectorAll(".fm-cb:checked")).map(function(cb) { return cb.value; });
				pillsWrap.innerHTML = checked.map(function(v) {
					return '<span class="fm-pill">' + escapeHtml(v) + '<button type="button" data-value="' + escapeHtml(v) + '" aria-label="' + escapeHtml(v) + ' seçimini kaldır">✕</button></span>';
				}).join("");
			}
			document.getElementById("facultyMultiPills").addEventListener("click", function(e) {
				const btn = e.target.closest("button[data-value]");
				if (!btn) return;
				const cb = document.querySelector('#facultyMultiSelect .fm-cb[value="' + CSS.escape(btn.dataset.value) + '"]');
				if (cb) { cb.checked = false; syncUnitFromFaculties(); syncCoordExtraRoleField(); renderFacultyMultiPills(); }
			});
			document.getElementById("facultyMultiSelect").addEventListener("change", function(e) {
				if (e.target.classList.contains("fm-cb")) { syncUnitFromFaculties(); syncCoordExtraRoleField(); renderFacultyMultiPills(); }
			});
			// Arama kutusu: fm-item metniyle basit (Türkçe locale-aware) substring karşılaştırması.
			// Eşleşen öge kalmayan grup (fm-group/details) tamamen gizlenir; en az bir eşleşmesi olan
			// grup arama sırasında otomatik açılır ki kullanıcı sonucu görmek için tıklamak zorunda kalmasın.
			document.getElementById("facultyMultiSearch").addEventListener("input", function(e) {
				const q = e.target.value.trim().toLocaleLowerCase("tr");
				const wrap = document.getElementById("facultyMultiSelect");
				if (!wrap) return;
				wrap.querySelectorAll(".fm-group").forEach(function(group) {
					let anyVisible = false;
					group.querySelectorAll(".fm-item").forEach(function(item) {
						const text = item.textContent.trim().toLocaleLowerCase("tr");
						const match = !q || text.indexOf(q) !== -1;
						item.classList.toggle("fm-hidden", !match);
						if (match) anyVisible = true;
					});
					group.classList.toggle("fm-hidden", !anyVisible);
					// Arama temizlenince gruplar zorla kapatılmaz -- kullanıcının kendi açtığı veya
					// işaretli-öge yüzünden zaten açık gelen grup öylece kalır, sürpriz kapanma olmaz.
					if (q && anyVisible) group.setAttribute("open", "");
				});
			});

function openAddModal(){ if (!requireEdit()) return; closeFacultySheet(); editIndex = null; resetForm(); document.getElementById("modalTitle").textContent = "Yeni Kişi Ekle"; document.getElementById("modalHint").textContent = "Bilgileri doldur, fotoğraf otomatik kareye sığdırılır."; document.getElementById("editDeleteActions").style.display = "none"; document.getElementById("verifyField").style.display = "none"; document.getElementById("successorTriggerWrap").style.display = "none"; document.getElementById("historyToggleBtn").style.display = "none"; tempGorevGecmisi = []; renderRankReferencePanel(); renderFacultyPickerField([]); document.getElementById("modalBg").classList.add("open"); loadSuggestionPool().then(populateSuggestionDatalists); }
			function openEditModal(idx){
			if (!requireEdit()) return;
			const p = people[idx]; if (!p) { showToast("Kayıt bulunamadı.", "error"); return; }
			closeFacultySheet();
			editIndex = idx; editIdentity = String(p.name || "") + "|" + String(p.title || ""); resetForm();
			document.getElementById("f_prefix").value = p.prefix || ""; document.getElementById("f_name").value = p.name || ""; document.getElementById("f_title").value = p.title || "";
			document.getElementById("f_unit").value = p.unit || ""; document.getElementById("f_status").value = p.status || "aktif"; document.getElementById("f_rank").value = (p.rank !== undefined && p.rank !== null && p.rank !== "") ? p.rank : "";
			document.getElementById("f_start").value = p.start || ""; document.getElementById("f_end").value = p.end || ""; document.getElementById("f_note").value = p.note || "";
			document.getElementById("endDateField").style.display = p.status === "pasif" ? "block" : "none";
			refreshStatusReasonBlock(); // f_status.value az once p.status'a ayarlandi; zaten-pasif bir kayit acilinca da sorgu gorunsun diye burada da cagrilir
			if(p.photo){ document.getElementById("photoPreview").src = p.photo; document.getElementById("photoPreview").style.display = "block"; document.getElementById("photoPreview").dataset.value = p.photo; if(p.photo.startsWith("http")) document.getElementById("f_photo_url").value = p.photo; }
			document.getElementById("verifyField").style.display = "block"; document.getElementById("f_dogrulamaKaynak").value = p.dogrulamaKaynak || "omu_web"; updateVerifyInfo(p);
			tempGorevGecmisi = Array.isArray(p.gorevGecmisi) ? p.gorevGecmisi.map(function(g){ return { unvan: g.unvan || "", baslangic: g.baslangic || "", bitis: g.bitis || "" }; }) : [];
			document.getElementById("historyToggleBtn").style.display = "block";
			document.getElementById("modalTitle").textContent = "Kaydı Düzenle"; document.getElementById("modalHint").textContent = "Mevcut kaydı güncelliyorsun, değişiklikler kaydedince yayına alınır."; document.getElementById("editDeleteActions").style.display = "flex"; /* successorTriggerWrap artik refreshStatusReasonBlock()/onStatusReasonChange() tarafindan yonetiliyor, burada kosulsuz acilmiyor */ renderRankReferencePanel(); renderFacultyPickerField(p.faculties || []);
			var coordExtraEl = document.getElementById("f_coordExtraRole"); if (coordExtraEl) coordExtraEl.value = p.ekGorevAciklamasi || "";
			document.getElementById("modalBg").classList.add("open");
			loadSuggestionPool().then(populateSuggestionDatalists);
			['f_name', 'f_title', 'f_unit', 'f_rank'].forEach(toggleFieldClear);
			}

			function closeModal(){ document.getElementById("modalBg").classList.remove("open"); closeSuccessorPanel(); closeHistoryPanel(); }

			// ---- Görevden alma / yerine yeni kişi atama paneli ----
			// Soldaki (mevcut) düzenleme ekranı açıkken sağda ikinci, küçük bir "yeni kişi ekle"
			// paneli açılır; unvan/birim/sıra soldaki kayıttan kopyalanır, isim ve fotoğraf boş
			// bırakılır. Kaydedilince YENİ bir kişi kaydı oluşturur, soldaki kaydı değiştirmez.
			let successorEditingIndex = null;
			// Duzenlenen kisinin gecmis gorevleri (Kaydet'e kadar sunucuya yazilmaz, bkz. history paneli).
			let tempGorevGecmisi = [];
			// Sebebe ozgu log notu (applyStatusReason() set eder, saveForm() tuketir) --
			// describeRecordChanges() jenerik bir once/sonra diff'i, HANGI sebeple
			// degistigini bilemez (reason1/reason2 ayni unvan degisikligini uretir).
			let lastStatusTransitionNote = "";
			function openSuccessorPanel(){
				if (!requireEdit()) return;
				if (editIndex === null || !people[editIndex]) { showToast("Önce mevcut bir kaydı düzenleyin.", "error"); return; }
				closeFacultySheet(); // mobil fakulte cekmecesi acik/yarim suruklenmis kalmasin diye guvenli sifirlama
				if (window.innerWidth < 900) closeHistoryPanel();
				successorEditingIndex = editIndex;
				const old = people[editIndex];
				document.getElementById("sf_prefix").value = old.prefix || "";
				document.getElementById("sf_name").value = "";
				document.getElementById("sf_title").value = old.title || "";
				document.getElementById("sf_unit").value = old.unit || "";
				document.getElementById("sf_rank").value = (old.rank !== undefined && old.rank !== null && old.rank !== "") ? old.rank : "";
				// "active" turde (yeni_gorev/gorev_bitti) f_end genelde BOS kalir (kisi pasife
				// dusmuyor) -- bu durumda sr_transitionDate (Uygula'nin gecis tarihi) veya bugune
				// dusulur, "passive" turde oldugu gibi f_end'e guvenilemez.
				document.getElementById("sf_start").value = document.getElementById("f_end").value || document.getElementById("sr_transitionDate").value || dKey(new Date());
				document.getElementById("sf_note").value = "";
				document.getElementById("sf_photo_url").value = ""; document.getElementById("sf_photoPreview").style.display = "none"; document.getElementById("sf_photoPreview").dataset.value = "";
				// Bu paneli acmanin butun amaci yerine gecme: soldaki kayit otomatik "Pasif"e
				// alinir (elle de degistirilebilir), boylece bitis tarihi girmeyi unutmak zorlasir.
				document.getElementById("f_status").value = "pasif";
				document.getElementById("endDateField").style.display = "block";
				document.getElementById("successorPanel").classList.add("open");
				// Mobilde iki formu ayni anda gostermek karisiklik yaratiyordu (kullanici geri
				// bildirimi): dar ekranda soldaki form GORSEL olarak gizlenir; durum (editIndex,
				// girilen degerler) korunur, "Vazgec" ile geri donulunce ayni yerden devam edilir.
				if (window.innerWidth < 900) document.getElementById("modalBg").classList.add("hide-behind-successor");
			}
			function closeSuccessorPanel(){
				const panel = document.getElementById("successorPanel");
				if (panel) panel.classList.remove("open");
				document.getElementById("modalBg").classList.remove("hide-behind-successor");
				successorEditingIndex = null;
			}

			// ---- Görev Geçmişi paneli ----
			// successor-panel'in AYNADAKİ (solda açılan) hâli: mevcut düzenleme ekranının
			// SOLUNDA, geçmiş görevleri (vekâleten dahil, tarih araligiyla) eklemeyi sağlar.
			function openHistoryPanel(){
				if (!requireEdit()) return;
				if (editIndex === null || !people[editIndex]) { showToast("Önce mevcut bir kaydı düzenleyin.", "error"); return; }
				closeFacultySheet(); // mobil fakulte cekmecesi acik/yarim suruklenmis kalmasin diye guvenli sifirlama
				if (window.innerWidth < 900) closeSuccessorPanel();
				renderHistoryPanel();
				document.getElementById("historyPanel").classList.add("open");
				// Sekme .modal'dan disari tastigi icin panel acikken ayni yerde CAKISIR --
				// bu yuzden panel acikken sekme gizlenir, kapatma isini panelin kendi ✕'i gorur.
				document.getElementById("historyToggleBtn").style.display = "none";
				if (window.innerWidth < 900) document.getElementById("modalBg").classList.add("hide-behind-panel");
			}
			function closeHistoryPanel(){
				const panel = document.getElementById("historyPanel");
				if (panel) panel.classList.remove("open");
				document.getElementById("modalBg").classList.remove("hide-behind-panel");
				if (editIndex !== null) document.getElementById("historyToggleBtn").style.display = "block";
			}
			function addHistoryEntry(){
				const unvan = document.getElementById("hg_unvan").value.trim();
				const baslangic = document.getElementById("hg_baslangic").value;
				const bitis = document.getElementById("hg_bitis").value;
				if (!unvan) { showToast("Görev adı zorunlu.", "error"); return; }
				tempGorevGecmisi.push({ unvan: unvan, baslangic: baslangic, bitis: bitis });
				// Yeni eklenen gorev genelde kisinin GUNCEL durumunu yansitir -- ana kayittaki
				// "Baslangic Tarihi" de ayni tarihle senkron edilir (Kaydet'e kadar hicbir sey
				// sunucuya gitmiyor, yanlissa kullanici f_start'i elle duzeltebilir).
				if (baslangic) document.getElementById("f_start").value = baslangic;
				document.getElementById("hg_unvan").value = ""; document.getElementById("hg_baslangic").value = ""; document.getElementById("hg_bitis").value = "";
				renderHistoryPanel();
			}
			function removeHistoryEntry(i){
				tempGorevGecmisi.splice(i, 1);
				renderHistoryPanel();
			}
			function renderHistoryPanel(){
				const list = document.getElementById("historyEntryList");
				// Guncel-gorev satiri: people[editIndex]'ten DEGIL, DOM alanlarindan (f_title/
				// f_start/f_end) anlik okunur -- addHistoryEntry()'nin zaten kullandigi kaynak
				// deseniyle tutarli, boylece henuz Kaydet'e basilmamis degisiklikler de yansir.
				// Salt-okunur (Sil butonu yok) -- tempGorevGecmisi'nin gercek bir elemani DEGIL,
				// sadece formun o anki durumunun bir yansimasi.
				const curTitle = (editIndex !== null) ? document.getElementById("f_title").value.trim() : "";
				const curStart = (editIndex !== null) ? document.getElementById("f_start").value : "";
				const curEnd = (editIndex !== null) ? document.getElementById("f_end").value : "";
				const currentRow = curTitle ? (
					'<div class="hg-row hg-row-current"><div class="hg-row-text"><b>' + escapeHtml(curTitle) + '</b><span class="hint" style="margin:0;">' +
					(curStart ? escapeHtml(fmtTrDate(curStart)) : "?") + ' – ' + (curEnd ? escapeHtml(fmtTrDate(curEnd)) : "devam ediyor") + '</span></div>' +
					'<span class="hg-current-badge">Güncel</span></div>'
				) : "";
				list.innerHTML = currentRow + (tempGorevGecmisi.map(function(g, i){
					return '<div class="hg-row">' +
						'<div class="hg-row-text"><b>' + escapeHtml(g.unvan) + '</b><span class="hint" style="margin:0;">' +
						(g.baslangic ? escapeHtml(fmtTrDate(g.baslangic)) : "?") + ' – ' + (g.bitis ? escapeHtml(fmtTrDate(g.bitis)) : "?") + '</span></div>' +
						'<button class="btn btn-danger-outline" type="button" onclick="removeHistoryEntry(' + i + ')">Sil</button></div>';
				}).join("") || (currentRow ? "" : '<p class="hint">Henüz görev eklenmedi.</p>'));
			}

			function previewSuccessorPhoto(e){
				const file = e.target.files[0]; if(!file) return; const reader = new FileReader();
				reader.onload = function(ev){
					const img = new Image(); img.onload = function(){
					const MAX = 480; let w = img.width, h = img.height; if(w >= h && w > MAX){ h = Math.round(h * (MAX / w)); w = MAX; } else if(h > w && h > MAX){ w = Math.round(w * (MAX / h)); h = MAX; }
					const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h; canvas.getContext("2d").drawImage(img, 0, 0, w, h); const compressed = canvas.toDataURL("image/jpeg", 0.75);
					document.getElementById("sf_photoPreview").src = compressed; document.getElementById("sf_photoPreview").style.display = "block"; document.getElementById("sf_photoPreview").dataset.value = compressed; document.getElementById("sf_photo_url").value = "";
					}; img.src = ev.target.result;
				}; reader.readAsDataURL(file);
			}
			function updateSuccessorPhotoPreviewFromUrl() {
				const url = document.getElementById("sf_photo_url").value.trim();
				if(url && url.startsWith("http")) { document.getElementById("sf_photoPreview").src = url; document.getElementById("sf_photoPreview").style.display = "block"; document.getElementById("sf_photoPreview").dataset.value = url; }
			}
			// Soldaki "Bitiş Tarihi" değiştikçe sağdaki "Başlangıç Tarihi"ni aynı güne çeker.
			// TEK YÖNLÜ: sağdakini elle değiştirmek soldakini etkilemez; ama sol tekrar
			// değişirse sağı yine ezer (kullanıcı isteğiyle bilinçli olarak böyle).
			document.getElementById("f_end").addEventListener("input", function(){
				if (document.getElementById("successorPanel").classList.contains("open")) {
					document.getElementById("sf_start").value = this.value;
				}
				if (document.getElementById("historyPanel").classList.contains("open")) renderHistoryPanel();
			});
			// >=900px'de Gorev Gecmisi paneli formun yaninda SABIT/her-zaman-gorunur (overlay
			// degil) -- editor panel acikken ana formu da degistirebiliyor, panelin "Guncel"
			// satiri (bkz. renderHistoryPanel) bayatlamasin diye yeniden render tetiklenir.
			// Mobilde risk yok (panel acikken form zaten hide-behind-panel ile tamamen gizli).
			document.getElementById("f_title").addEventListener("input", function(){
				if (document.getElementById("historyPanel").classList.contains("open")) renderHistoryPanel();
			});
			document.getElementById("f_start").addEventListener("input", function(){
				if (document.getElementById("historyPanel").classList.contains("open")) renderHistoryPanel();
			});
			// Cift tiklamada AYNI halefi iki kez olusturmasin diye guardOp ile sarmalanir (bkz. guardOp).
			async function saveSuccessor(){ return guardOp("saveSuccessor", saveSuccessorImpl); }
			async function saveSuccessorImpl(){
				if (!requireEdit()) return;
				if (successorEditingIndex === null) { showToast("Kaynak kayıt bulunamadı.", "error"); closeSuccessorPanel(); return; }
				const name = document.getElementById("sf_name").value.trim();
				const title = document.getElementById("sf_title").value.trim();
				if (!name || !title) { showToast("Yeni kişi için isim ve unvan zorunlu!", "error"); return; }
				const rankRaw = document.getElementById("sf_rank").value.trim();
				if (rankRaw !== "" && !/^\d+$/.test(rankRaw)) { showToast("Protokol sırası sadece rakam olmalı.", "error"); return; }
				// "passive" turde (gercek ayrilis) eski kaydin pasife alinmasi icin bitis tarihi
				// SART; "active" turde (yeni_gorev/gorev_bitti) eski kayit bu akista HIC
				// GUNCELLENMIYOR (kisi "Uygula" ile kendi unvanini AYRICA degistirip normal Kaydet
				// ile persist edecek), o yuzden bitis tarihi burada gerekmiyor.
				const kind = reasonKind(document.getElementById("sr_reason").value);
				if (kind === "passive" && !document.getElementById("f_end").value) { showToast("Eski kaydın bitiş tarihini girin (soldaki formda).", "error"); return; }
				// Diğer editörler arada kayıt eklemiş/silmiş olabilir; yazmadan hemen önce güncel liste okunur.
				if (database && LIST_PATHS[currentListKey]) {
					try { const fresh = await database.ref(dbPath(LIST_PATHS[currentListKey])).once("value"); people = normalizePeopleSnapshot(fresh.val()); }
					catch (err) { console.warn("Güncel liste okunamadı, yerel listeye göre kaydediliyor:", err); }
				}
				const oldP = people[successorEditingIndex];
				const oldIdentity = oldP ? (String(oldP.name || "") + "|" + String(oldP.title || "")) : null;
				if (!oldP || (editIdentity !== null && oldIdentity !== editIdentity)) {
					showToast("Kaynak kayıt başka bir kullanıcı tarafından değiştirildi, işlem iptal edildi.", "error");
					closeSuccessorPanel(); return;
				}
				const record = {
					prefix: document.getElementById("sf_prefix").value, name: name, title: title,
					unit: document.getElementById("sf_unit").value.trim(), status: "aktif",
					rank: rankRaw === "" ? "" : Number(rankRaw), photo: safePhotoUrl(document.getElementById("sf_photoPreview").dataset.value),
					start: document.getElementById("sf_start").value, end: "",
					note: document.getElementById("sf_note").value.trim()
				};
				if (currentListKey === "universite" && Array.isArray(oldP.faculties)) record.faculties = oldP.faculties.slice();
				// Yeni kayıt için GERÇEK bir Firebase push-ID üretilir -- push() sadece bir anahtar
				// verir, .set()/.update() çağrılana kadar hiçbir şey yazmaz, bu yüzden anahtarı burada
				// almak güvenlidir ve iki editör aynı anda halef atasa bile ÇAKIŞMAZ.
				const newId = (database && LIST_PATHS[currentListKey]) ? database.ref(dbPath(LIST_PATHS[currentListKey])).push().key : ("-local" + Date.now().toString(36));
				people[newId] = record;
				const actionLabel = name + " kişisi, " + (oldP.name || "eski kayıt") + " yerine atandı" + (record.rank !== "" ? ", " + record.rank + ". sıra" : "");

				// "passive" turde eski kaydi (successorEditingIndex) AYNI islemde pasife cekiyoruz --
				// aksi halde yeni kisi eklenip eski kayit sunucuda "aktif" kalabiliyordu (bilinen
				// tutarlilik acigi: eskiden bu sadece f_status'un DOM degerini degistiriyordu,
				// veritabanina yazilmasi icin ayrica sol formda Kaydet'e basilmasi gerekiyordu).
				// oldP fresh() okumadan gelen DOGRULANMIS kopya -- DOM'daki olasi kaydedilmemis
				// diger alan degisikliklerini (unit/not/gorevGecmisi vb.) KASITLI OLARAK almiyoruz,
				// sadece status+end degisiyor; boylece stale-write riski yok, editor diger
				// degisiklikleri istiyorsa ayrica sol formda Kaydet'e basar.
				// "active" turde eski kayit bu akista HIC guncellenmiyor (bkz. yukaridaki not) --
				// oldUpdated/oldActionLabel sadece "passive" icin hesaplanir.
				const oldUpdated = kind === "passive" ? Object.assign({}, oldP, { status: "pasif", end: document.getElementById("f_end").value }) : null;
				const oldActionLabel = kind === "passive" ? ((oldP.name || "Kayıt") + " kişisi pasife alındı (yerine " + name + " atandı)") : null;

				let saved = false;
				if (peopleNeedsFullSave || !database || !LIST_PATHS[currentListKey]) {
					// Kacis yolu: savePerson()'un da kullandigi ayni bayrak -- snapshot ESKİ (dizi
					// tabanlı) bir yedekten yerel ID'lere cevrildiyse tek-yol yazimi guvenli degil,
					// tum nesneyi tek .set() ile yaz (saveData() zaten atomik).
					if (kind === "passive") people[successorEditingIndex] = oldUpdated;
					saved = await saveData(kind === "passive" ? (actionLabel + " · " + oldActionLabel) : actionLabel, name);
					if (!saved && kind === "passive") people[successorEditingIndex] = oldP;
				} else {
					// Firebase'in cok-yollu update()'i: TEK istekte (kind==="passive" ise) iki ID'ye
					// (yeni push-ID + eski kaydin push-ID'si), "active" ise SADECE yeni push-ID'ye
					// yazar, native olarak atomik -- iki ayri savePerson() cagrisinin arasinda kalan
					// tutarsizlik penceresini tamamen kapatir.
					try {
						// Kayit + log satir(lar)i TEK atomik root().update() istegine tasindi -- once
						// ayri ayri (ates-et-unut) push() cagrilariydi, veri basariyla yazilsa bile
						// loglardan biri sessizce kaybolabiliyordu.
						const listPath = dbPath(LIST_PATHS[currentListKey]);
						const updates = {};
						updates[listPath + "/" + newId] = record;
						if (kind === "passive") updates[listPath + "/" + successorEditingIndex] = oldUpdated;
						let logKey1 = null;
						if (currentUser) {
							const who = ((currentUser.firstName||"") + " " + (currentUser.lastName||"")).trim() || currentUser.email;
							const logsPath = dbPath("logs/" + currentListKey);
							logKey1 = database.ref(logsPath).push().key;
							updates[logsPath + "/" + logKey1] = { by: who, email: currentUser.email, action: actionLabel, target: name, timestamp: firebase.database.ServerValue.TIMESTAMP };
							if (kind === "passive") {
								const logKey2 = database.ref(logsPath).push().key;
								updates[logsPath + "/" + logKey2] = { by: who, email: currentUser.email, action: oldActionLabel, target: oldP.name || "", timestamp: firebase.database.ServerValue.TIMESTAMP };
							}
						}
						globalFuseSourceRef = null; // saveData()/savePerson() disinda kalan tek yazma yolu -- bkz. tanim yorumu
						await database.ref("/").update(updates);
						if (kind === "passive") people[successorEditingIndex] = oldUpdated;
					if (!logKey1) { console.error("Log kaydı yazılamadı: currentUser tanımsız."); showToast("Kaydedildi ancak işlem günlüğüne yazılamadı.", "warn"); }
						saved = true;
					} catch (err) {
						console.error("Kaydedilemedi:", err);
						showToast(kind === "passive" ? "Buluta kaydedilemedi (yeni kişi ve eski kayıt birlikte yazılamadı)." : "Buluta kaydedilemedi.", "error");
						saved = false;
					}
				}
				if (!saved) { delete people[newId]; if (kind === "passive") people[successorEditingIndex] = oldP; return; }
				showToast("Yeni kişi eklendi: " + name);
				if (kind === "passive") {
					// Halef basariyla kaydedildi -- ana Kaydet'i kilitleyen kosul artik gecmis, kilit acilir.
					document.getElementById("sr_reason").value = ""; onStatusReasonChange();
				}
				// "active" turde sr_reason BILEREK SIFIRLANMAZ -- admin "Uygula"ya (kendi unvan
				// degisikligi) henuz basmamis olabilir, secim kalsin ki hem Uygula hem (gerekirse)
				// tekrar halef eklemek hala mumkun olsun.
				closeSuccessorPanel();
				render();
			}
			// f_status "pasif" oldugunda sorgu blogunu gosterir; "aktif"e donulunce sorguyu
			// VE ona bagli alt-UI'lari (yeni unvan girisi, successor tetikleyicisi) sifirlar.
			// NOT: successorTriggerWrap'in KENDI gorunurlugu SADECE sr_reason=="yerine_atama"
			// iken acilir (onStatusReasonChange() yonetir) -- burada sadece "aktif"e donulunce
			// KAPATMA sorumlulugu var. Hem f_status "change" event'inden hem openEditModal()'dan
			// (zaten-pasif bir kayit acilisinda) cagrilir -- boylece zaten pasif bir kaydi sadece
			// notunu guncellemek icin acan editor de sorguyu (ve dolayisiyla successor'a giden
			// yolu) gorebiliyor; sadece "change" event'ine baglansaydi bu erisim kaybolurdu.
			// Halef atanmadan pasife alinmayi ana Kaydet uzerinden engeller: "yerine_atama"
			// sebebi secili oldugu surece Kaydet kilitli kalir, sadece successor-panel'in
			// KENDI Kaydet'i (saveSuccessor()) ile devam edilebilir. Kosul dogrudan 3 kaynak
			// degerden hesaplanir (successorTriggerWrap'in DOM gorunurlugunden DEGIL) ki is
			// kurali tek yerde acik kalsin.
			function updateSaveButtonLock() {
				const locked = editIndex !== null && document.getElementById("f_status").value === "pasif" && reasonKind(document.getElementById("sr_reason").value) === "passive";
				const btn = document.getElementById("saveFormBtn");
				if (btn) { btn.disabled = locked; btn.title = locked ? "Önce yerine atanacak kişiyi kaydedin." : ""; }
				const hint = document.getElementById("saveLockHint");
				if (hint) {
					// KAPALIYDI->ACILDI gecisinde ipucunu gorunur alana kaydir -- kullanici "Yerine
					// Yeni Kisi Ata" panelini gormeden Kaydet'in neden pasif oldugunu anlayamayip
					// sayfanin donduguna karar verebiliyordu (mobil sorunlar.docx bulgusu). Her
					// cagrida degil, SADECE gizliden-gorunur GECISINDE kaydirilir (tekrar tekrar
					// sicramasin diye).
					const wasHidden = hint.style.display === "none" || hint.style.display === "";
					hint.style.display = locked ? "block" : "none";
					if (locked && wasHidden) hint.scrollIntoView({ behavior: "smooth", block: "nearest" });
				}
			}
			function refreshStatusReasonBlock() {
				// SADECE mevcut bir kaydi duzenlerken (editIndex!==null) -- yeni kayit eklerken
				// henuz sunucuya hic yazilmamis bir kaydin "eski unvani" arsivlemek/yerine
				// birini atamak anlamsiz, sadece endDateField (mevcut/degismeyen davranis) yeter.
				const isPasif = editIndex !== null && document.getElementById("f_status").value === "pasif";
				document.getElementById("statusReasonBlock").style.display = isPasif ? "block" : "none";
				if (!isPasif) {
					document.getElementById("sr_reason").value = "";
					document.getElementById("sr_applyRow").style.display = "none";
					document.getElementById("successorTriggerWrap").style.display = "none";
				}
				updateSaveButtonLock();
			}
			// "yeni_gorev"/"gorev_bitti" (Uygula akisi) ve "yerine_atama" (halef paneli) DISINDAKI
			// sebepler herhangi bir alt-form ACMAZ -- kisi normal Kaydet ile pasife alinir, TEK
			// farkli davranislari secilen sebebin GUNLUGE (log'a) dusmesidir. Bu, applyStatusReason()'in
			// zaten kullandigi lastStatusTransitionNote mekanizmasindan (bkz. saveForm() actionLabel
			// insasi, ~satir 2498) faydalanir -- ayrica bir persist/alan gerekmez.
			const SIMPLE_STATUS_REASON_LABELS = { istifa: "İstifa etti", emekli: "Emekli oldu", gorevden_alindi: "Görevden alındı", vefat: "Vefat etti", diger: "Pasife alındı (diğer sebep)" };
			// HER sebep (bos secim haric) bir BOSLUK (vekalet/kadro bosalmasi) yaratir -- kisi ya
			// AYNI kurumda baska bir role geciyor ("active") ya da gercekten ayriliyor ("passive").
			// Ikisinde de "kim yerine geldi" bilgisi (halef paneli) faydali, ama SADECE "passive"de
			// ZORUNLU (ana Kaydet kilitlenir) -- kullanici: "pasife yani arsive cikma durumu cok
			// elzem ... olmali", yani zorunluluk sadece gercek ayrilislarda, ic-kurum gecislerinde
			// (yeni_gorev/gorev_bitti) halef atamasi OPSIYONEL kalir.
			function reasonKind(val) {
				if (!val) return null;
				return (val === "yeni_gorev" || val === "gorev_bitti") ? "active" : "passive";
			}
			function onStatusReasonChange() {
				const val = document.getElementById("sr_reason").value;
				const isArchiveReason = (val === "yeni_gorev" || val === "gorev_bitti");
				document.getElementById("sr_applyRow").style.display = isArchiveReason ? "block" : "none";
				if (isArchiveReason) {
					document.getElementById("sr_transitionDate").value = document.getElementById("f_end").value || dKey(new Date());
				}
				const showSuccessor = reasonKind(val) !== null;
				document.getElementById("successorTriggerWrap").style.display = showSuccessor ? "block" : "none";
				if (!showSuccessor) closeSuccessorPanel(); // masaustunde acik kalmis olabilir, savunmaci kapatma
				// Basit sebepler (Uygula/halef akisina girmeyenler): secilince hemen not olarak
				// hazirlanir, Kaydet'e basildiginda actionLabel'a otomatik eklenir. Baska bir sebebe
				// (veya bos secime) gecilirse eski not gecerliligini yitirir, temizlenir.
				lastStatusTransitionNote = SIMPLE_STATUS_REASON_LABELS[val] || "";
				updateSaveButtonLock();
			}
			// Reason1/2 ("Uygula"): eski unvan+tarih araligi otomatik Gorev Gecmisi'ne
			// arsivlenir, form yeni unvanla "Aktif" durumuna geri doner -- kisi gercekte
			// pasife dusmuyor, sadece unvani degisiyor. Kaydetme normal saveForm() ile olur,
			// burada ayri bir persist YOK (tempGorevGecmisi/f_title/f_start zaten Kaydet'e
			// kadar sunucuya yazilmayan alanlar, addHistoryEntry() ile ayni desen).
			function applyStatusReason() {
				if (!requireEdit()) return;
				const reason = document.getElementById("sr_reason").value;
				if (reason !== "yeni_gorev" && reason !== "gorev_bitti") return;
				const oldTitle = document.getElementById("f_title").value.trim();
				const newTitle = document.getElementById("sr_newTitle").value.trim();
				if (!oldTitle) { showToast("Mevcut unvan boş, önce unvan girin.", "error"); return; }
				if (!newTitle) { showToast("Yeni unvan zorunlu.", "error"); return; }
				const oldStart = document.getElementById("f_start").value;
				const transitionDate = document.getElementById("sr_transitionDate").value || dKey(new Date());

				tempGorevGecmisi.push({ unvan: oldTitle, baslangic: oldStart, bitis: transitionDate });

				document.getElementById("f_title").value = newTitle;
				document.getElementById("f_start").value = transitionDate;
				document.getElementById("f_status").value = "aktif";
				document.getElementById("f_end").value = ""; // ONEMLI: temizlenmezse "aktif" kiside eski bitis tarihi kart uzerinde yanlis gorunur
				document.getElementById("endDateField").style.display = "none";

				lastStatusTransitionNote = (reason === "yeni_gorev" ? "Yeni göreve atandı" : "Görevden geri çekildi") + ": " + oldTitle + " → " + newTitle;

				document.getElementById("sr_reason").value = "";
				document.getElementById("sr_applyRow").style.display = "none";
				document.getElementById("sr_newTitle").value = "";
				document.getElementById("statusReasonBlock").style.display = "none";
				document.getElementById("successorTriggerWrap").style.display = "none";

				toggleFieldClear("f_title");
				renderHistoryPanel();
				updateSaveButtonLock();
				showToast("Uygulandı: " + newTitle + ". Değişiklikleri kaydetmeyi unutmayın.");
			}
			document.getElementById("f_status").addEventListener("change", function(e){
				document.getElementById("endDateField").style.display = e.target.value === "pasif" ? "block" : "none";
				refreshStatusReasonBlock();
			});

			function previewPhoto(e){
			const file = e.target.files[0]; if(!file) return; const reader = new FileReader();
			reader.onload = function(ev){
				const img = new Image(); img.onload = function(){
				const MAX = 480; let w = img.width, h = img.height; if(w >= h && w > MAX){ h = Math.round(h * (MAX / w)); w = MAX; } else if(h > w && h > MAX){ w = Math.round(w * (MAX / h)); h = MAX; }
				const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h; canvas.getContext("2d").drawImage(img, 0, 0, w, h); const compressed = canvas.toDataURL("image/jpeg", 0.75);
				document.getElementById("photoPreview").src = compressed; document.getElementById("photoPreview").style.display = "block"; document.getElementById("photoPreview").dataset.value = compressed; document.getElementById("f_photo_url").value = "";
				}; img.src = ev.target.result;
			}; reader.readAsDataURL(file);
			}

			function updatePhotoPreviewFromUrl() {
				const url = document.getElementById("f_photo_url").value.trim();
				if(url && url.startsWith("http")) { document.getElementById("photoPreview").src = url; document.getElementById("photoPreview").style.display = "block"; document.getElementById("photoPreview").dataset.value = url; }
			}

			function handleFormKeydown(e) {
				// Eskiden form içindeki HER öğede (Vazgeç, Çöpe At, ✕ butonları dâhil) Enter kaydediyordu.
				if (e.key !== "Enter") return;
				const el = e.target;
				if (el.tagName === "TEXTAREA" || el.tagName === "BUTTON" || el.type === "button" || el.type === "submit" || el.type === "file") return;
				e.preventDefault(); saveForm();
			}

			// Kayıt düzenlemede tam olarak HANGİ alanın değiştiğini bulur (eski değer → yeni değer).
			// Log mesajında " · " ile ayrılmış detaylar hâline gelir, panelde alt satırlar olarak gösterilir.
			const LOG_FIELD_LABELS = {
				prefix: "Unvan Ön Eki", name: "İsim Soyisim", title: "Görev Unvanı", unit: "Birim / Kurum",
				status: "Durum", rank: "Protokol Sırası", start: "Başlangıç Tarihi", end: "Bitiş Tarihi",
				note: "Not", photo: "Fotoğraf", faculties: "Bağlı Birim / Ek Görev"
			};
			const LOG_STATUS_LABELS = { aktif: "Aktif", pasif: "Pasif (arşiv)", silindi: "Çöp kutusunda" };

			// ---- Veri güncellik / doğrulama sistemi ----
			// Amaç: eski unvanların fark edilmeden kartlarda kalması protokol sistemlerindeki en yaygın
			// hatalardan biri; her kişi kaydı en son NE ZAMAN, HANGİ kaynaktan ve KİM tarafından
			// doğrulandığını taşır (dogrulamaKaynak, sonDogrulamaTs, dogrulayan alanları).
			const VERIFICATION_SOURCES = {
				omu_web: "OMÜ Web Sitesi",
				kullanici_girisi: "Kullanıcı Girişi",
				resmi_yazi: "Resmî Yazı",
				manuel: "Manuel Doğrulama"
			};
			function getFreshnessInfo(p) {
				if (!p || !p.sonDogrulamaTs) return { level: "red", icon: "🔴", label: "Hiç Doğrulanmadı" };
				const days = Math.floor((Date.now() - p.sonDogrulamaTs) / 86400000);
				if (days < 90) return { level: "green", icon: "🟢", label: "Güncel" };
				if (days < 365) return { level: "yellow", icon: "🟡", label: days + " Gündür Kontrol Edilmedi" };
				return { level: "red", icon: "🔴", label: "1 Yıldan Uzun Süredir Kontrol Edilmedi" };
			}
			function updateVerifyInfo(p) {
				const el = document.getElementById("verifyInfo");
				if (!el) return;
				if (!p || !p.sonDogrulamaTs) { el.textContent = "Bu kayıt hiç doğrulanmadı."; return; }
				const dateStr = fmtDate(dKey(new Date(p.sonDogrulamaTs)));
				const kaynakLabel = VERIFICATION_SOURCES[p.dogrulamaKaynak] || p.dogrulamaKaynak || "—";
				el.textContent = "Son doğrulama: " + dateStr + " · " + kaynakLabel + (p.dogrulayan ? " · " + p.dogrulayan : "");
			}

			// Uzun metinler (not, birim vb.) logu şişirmesin diye kısaltılır; boş değerler "(boş)" yazılır.
			function logValueOrEmpty(v) {
				// " · " log mesajının satır ayıracı olduğu için, kullanıcı metninde geçerse zararsız hâle getirilir.
				const s = ((v === undefined || v === null) ? "" : String(v).trim()).split(" · ").join(" - ");
				if (!s) return "(boş)";
				return s.length > 60 ? s.slice(0, 60) + "…" : s;
			}

			function describeRecordChanges(oldRec, newRec) {
				const changes = [];
				const oldRank = (oldRec.rank === undefined || oldRec.rank === null || oldRec.rank === "") ? null : Number(oldRec.rank);
				const newRank = (newRec.rank === undefined || newRec.rank === null || newRec.rank === "") ? null : Number(newRec.rank);
				if (oldRank !== newRank) {
					if (oldRank !== null && newRank !== null) {
						// Protokolde küçük sayı daha üst sırayı ifade eder: 2'den 4'e geçmek "düşürüldü" demektir.
						changes.push(LOG_FIELD_LABELS.rank + ": " + oldRank + ". sıradan " + newRank + ". sıraya " + (newRank < oldRank ? "yükseltildi" : "düşürüldü"));
					} else if (newRank !== null) {
						changes.push(LOG_FIELD_LABELS.rank + ": (boş) → " + newRank + ". sıra");
					} else {
						changes.push(LOG_FIELD_LABELS.rank + ": " + oldRank + ". sıra → (boş)");
					}
				}
				const oldStatus = oldRec.status || "aktif"; const newStatus = newRec.status || "aktif";
				if (oldStatus !== newStatus) {
					changes.push(LOG_FIELD_LABELS.status + ": " + (LOG_STATUS_LABELS[oldStatus] || oldStatus) + " → " + (LOG_STATUS_LABELS[newStatus] || newStatus));
				}
				["prefix", "name", "title", "unit", "start", "end", "note"].forEach(function(key) {
					const oldVal = (oldRec[key] === undefined || oldRec[key] === null) ? "" : String(oldRec[key]).trim();
					const newVal = (newRec[key] === undefined || newRec[key] === null) ? "" : String(newRec[key]).trim();
					if (oldVal !== newVal) changes.push(LOG_FIELD_LABELS[key] + ": " + logValueOrEmpty(oldVal) + " → " + logValueOrEmpty(newVal));
				});
				const oldPhoto = oldRec.photo || ""; const newPhoto = newRec.photo || "";
				if (oldPhoto !== newPhoto) {
					// Fotoğraf base64 olabildiği için değerin kendisi değil, sadece ne yapıldığı yazılır.
					changes.push(LOG_FIELD_LABELS.photo + ": " + (!oldPhoto ? "eklendi" : (!newPhoto ? "kaldırıldı" : "değiştirildi")));
				}
				// Fakülte/ek görev bir dizi olduğu için eklenen ve çıkarılan birimler ayrı ayrı yazılır.
				if (Array.isArray(newRec.faculties) || Array.isArray(oldRec.faculties)) {
					const newFac = Array.isArray(newRec.faculties) ? newRec.faculties : [];
					const oldFac = Array.isArray(oldRec.faculties) ? oldRec.faculties : [];
					const added = newFac.filter(function(f) { return oldFac.indexOf(f) === -1; });
					const removed = oldFac.filter(function(f) { return newFac.indexOf(f) === -1; });
					if (added.length || removed.length) {
						const parts = [];
						if (added.length) parts.push("+ " + added.join(", "));
						if (removed.length) parts.push("− " + removed.join(", "));
						changes.push(LOG_FIELD_LABELS.faculties + ": " + parts.join("; "));
					}
				}
				// Görev geçmişi bir nesne dizisi olduğu için (tek alan farkı gibi degil) add/remove
				// yerine basit bir "degisti mi" karsilastirmasi yeterli -- faculties'teki gibi bir
				// diff algoritmasi burada gereksiz karmasiklik olurdu.
				const oldHist = JSON.stringify(Array.isArray(oldRec.gorevGecmisi) ? oldRec.gorevGecmisi : []);
				const newHist = JSON.stringify(Array.isArray(newRec.gorevGecmisi) ? newRec.gorevGecmisi : []);
				if (oldHist !== newHist) changes.push("Görev geçmişi güncellendi");
				return changes;
			}

			// Cift tiklamada AYNI kisiyi iki kez olusturmasin diye guardOp ile sarmalanir (bkz. guardOp).
			async function saveForm(){ return guardOp("saveForm", saveFormImpl); }
			async function saveFormImpl(){
				if (!requireEdit()) return;
			// Buton disabled olsa bile handleFormKeydown() Enter tusuyla bu fonksiyonu dogrudan
			// cagirabiliyor (disabled sadece tiklama/focus'u engeller) -- ayni kilit kosulu burada
			// da tekrar kontrol edilir.
			if (editIndex !== null && document.getElementById("f_status").value === "pasif" && reasonKind(document.getElementById("sr_reason").value) === "passive") {
				showToast("Bu kayıt yerine biri atanmadan pasife alınamaz. Önce 'Yerine Yeni Kişi Ata' panelini kaydedin.", "error");
				return;
			}
			const name = document.getElementById("f_name").value.trim(); const title = document.getElementById("f_title").value.trim();
			if(!name || !title){ showToast("İsim ve unvan zorunlu!", "error"); return; }
			const status = document.getElementById("f_status").value; if(status === "pasif" && !document.getElementById("f_end").value){ showToast("Pasif kayıtlar için bitiş tarihi girilmelidir.", "error"); return; }
			// Sıra alanı metin girişi olduğu için "1a" gibi bir değer Number() ile NaN oluyordu.
			// NaN Firebase tarafından reddedilir; eskiden bu sessizce yutulup "kaydedildi" deniyordu ve
			// NaN yerel listede kaldığı için sonraki TÜM kayıt işlemleri de sessizce başarısız oluyordu.
			const rankRaw = document.getElementById("f_rank").value.trim();
			if (rankRaw !== "" && !/^\d+$/.test(rankRaw)) { showToast("Protokol sırası sadece rakam olmalı.", "error"); return; }

			const record = {
				prefix: document.getElementById("f_prefix").value, name: name, title: title, unit: document.getElementById("f_unit").value.trim(), status: status,
				rank: rankRaw === "" ? "" : Number(rankRaw),
				photo: safePhotoUrl(document.getElementById("photoPreview").dataset.value), start: document.getElementById("f_start").value, end: document.getElementById("f_end").value, note: document.getElementById("f_note").value.trim()
			};
			if (currentListKey === "universite") {
				record.faculties = Array.from(document.querySelectorAll("#facultyMultiSelect .fm-cb:checked")).map(function(cb) { return cb.value; });
				const coordEl = document.getElementById("f_coordExtraRole");
				record.ekGorevAciklamasi = coordEl ? coordEl.value.trim() : "";
			}
			record.gorevGecmisi = tempGorevGecmisi.slice();
			saveSuggestion("birimler", record.unit); saveSuggestion("unvanlar", record.title);
			let targetIdx; let actionLabel; let oldRecord = null;
			if(editIndex === null) {
				// Eskiden iki editör aynı anda kişi eklerse ikisi de "people.length-1" ile AYNI dizi
				// indeksine yazıp birbirini siliyordu. Artık her yeni kayıt için GERÇEK, benzersiz bir
				// Firebase push-ID üretilir ve savePerson() SADECE o tek düğümü yazar -- tüm liste
				// yeniden yazılmadığı için başka bir editörün eş zamanlı eklemesiyle asla çakışmaz,
				// bu yüzden ekleme öncesi ayrıca "güncel listeyi oku" adımına da gerek kalmadı.
				if (!database || !LIST_PATHS[currentListKey]) { showToast("Veritabanı bağlı değil, kayıt yapılamadı.", "error"); return; }
				targetIdx = database.ref(dbPath(LIST_PATHS[currentListKey])).push().key;
				people[targetIdx] = record;
				const newRank = (record.rank !== "" && record.rank !== undefined && record.rank !== null) ? Number(record.rank) : null;
				actionLabel = name + " kişisi eklendi" + (newRank !== null ? ", " + newRank + ". sıra" : "");
			} else {
				// Modal acildigindan beri indeksin hala AYNI kisiyi gosterdigi dogrulanir.
				// Eslesmiyorsa (baska bir editor kayit silmis/eklemis) yazma iptal edilir --
				// aksi halde bambaska birinin adi/unvani/fotografi sessizce ezilirdi.
				const curP = people[editIndex];
				const curIdentity = curP ? (String(curP.name || "") + "|" + String(curP.title || "")) : null;
				if (!curP || (editIdentity !== null && curIdentity !== editIdentity)) {
					showToast("Liste başka bir kullanıcı tarafından değiştirildi, kayıt yapılmadı. Lütfen tekrar deneyin.", "error");
					closeModal(); render(); return;
				}
				oldRecord = Object.assign({}, people[editIndex]);
				people[editIndex] = Object.assign({}, people[editIndex], record);
				targetIdx = editIndex;
				const changes = describeRecordChanges(oldRecord, people[editIndex]);
				if (oldRecord.status === "silindi" && record.status !== "silindi") {
					// Çöpten geri dönüş özel bir durum: kuru "Durum: ... → ..." yerine açıkça belirtilir.
					const backRank = (record.rank !== "" && record.rank !== undefined && record.rank !== null) ? Number(record.rank) : null;
					actionLabel = name + " kişisi çöp kutusundan geri alındı" + (backRank !== null ? ", " + backRank + ". sıra" : "");
					const rest = changes.filter(function(c) { return c.indexOf(LOG_FIELD_LABELS.status + ":") !== 0; });
					if (rest.length) actionLabel += " · " + rest.join(" · ");
				} else if (changes.length) {
					// lastStatusTransitionNote doluysa (applyStatusReason() ile bir gecis uygulandiysa)
					// jenerik diff'in BASINA eklenir -- describeRecordChanges() salt bir once/sonra
					// karsilastirmasi oldugu icin HANGI sebeple degistigini (yeni gorev / geri cekilme)
					// bilemez, ikisi de ayni "Gorev Unvani: X -> Y" satirini uretir.
					actionLabel = name + " kişisi güncellendi · " + (lastStatusTransitionNote ? lastStatusTransitionNote + " · " : "") + changes.join(" · ");
				} else {
					actionLabel = name + " kişisi kaydedildi (içerikte değişiklik yok)";
				}
			}
			// Yazma başarısızsa modal kapatılıp "başarıyla kaydedildi" denmemeli — kullanıcı kaydettiğini sanıyordu.
			const saved = await savePerson(targetIdx, actionLabel, name);
			// Duzenleme sirasinda yazma basarisiz olursa yerel kopyayi da eski haline dondur; aksi halde
			// ekranda "kaydedilmis" gorunen ama sunucuya hic ulasmamis veri, bir sonraki gercek guncellemeye kadar fark edilmez.
			if (!saved) { if (oldRecord === null) delete people[targetIdx]; else people[targetIdx] = oldRecord; return; }
			closeModal(); showToast("Kayıt başarıyla kaydedildi.");
			lastStatusTransitionNote = ""; // tuketildi -- sadece basari yolunda temizlenir, basarisiz yazmada editor tekrar deneyebilsin diye not korunur
			}

			function openConfirmModal() { closeModal(); document.getElementById("confirmModalBg").classList.add("open"); }
			function closeConfirmModal() { document.getElementById("confirmModalBg").classList.remove("open"); if (editIndex !== null) openEditModal(editIndex); }
			async function executeDelete() {
				if (!requireEdit()) return;
				if(editIndex === null) return;
				// Bir onceki satir people[editIndex]'in yok olabilecegini kabul ediyordu ama
				// devami korumasizdi: uzaktan silinen bir kayitta TypeError firlatip sessizce
				// duruyordu (modal acik kalir, kullanici sildigini sanirdi).
				const delP = people[editIndex];
				if (!delP) { showToast("Kayıt bulunamadı, liste yenilendi.", "error"); document.getElementById("confirmModalBg").classList.remove("open"); closeModal(); render(); return; }
				const name = delP.name || "Kayıt";
				const prevStatus = delP.status || "aktif";
				delP.prevStatus = prevStatus;
				delP.status = "silindi";
				// Tüm listeyi değil, SADECE bu kaydı yazar -- çöpe atma başka bir kaydı asla etkilemez.
				const delOk = await savePerson(editIndex, name + " kişisi çöpe atıldı", name);
				document.getElementById("confirmModalBg").classList.remove("open");
				if (!delOk) { delP.status = prevStatus; delete delP.prevStatus; render(); return; }
				showToast("Kayıt çöpe atıldı.", "warn");
			}

			function downloadFile(content, fileName, mimeType) { const blob = new Blob([content], {type: mimeType}); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = fileName; a.click(); URL.revokeObjectURL(url); }

			// Tarih yardımcıları (eskiden Etkinlik Takvimi modülünün bir parçasıydı, kullanıcı
			// isteğiyle takvim tamamen kaldırıldı -- ama Görev Geçmişi paneli ve Yerine Yeni Kişi
			// Ata formu hâlâ bunlara bağımlı olduğu için buraya, genel yardımcılar arasına taşındı).
			// Hepsi YEREL saatle çalışır, UTC kayması olmaz.
			const CAL_MONTHS = ["Ocak","Şubat","Mart","Nisan","Mayıs","Haziran","Temmuz","Ağustos","Eylül","Ekim","Kasım","Aralık"];
			function pad2(n){ return (n<10?"0":"")+n; }
			function dKey(d){ return d.getFullYear()+"-"+pad2(d.getMonth()+1)+"-"+pad2(d.getDate()); }
			// Sadece Date() ile parse etmek yetmez: JS "2026-02-31" gibi takvimsel olarak GECERSIZ bir
			// tarihi sessizce Mart'a tasir (overflow). Parse ettikten sonra yil/ay/gun geri okunup
			// istenenle birebir eslesiyor mu diye kontrol edilir, eslesmezse null donulur.
			function parseKey(s){
				const a=String(s||"").split("-");
				if(a.length!==3) return null;
				const y=Number(a[0]), m=Number(a[1]), day=Number(a[2]);
				if(!Number.isInteger(y)||!Number.isInteger(m)||!Number.isInteger(day)) return null;
				const d=new Date(y,m-1,day);
				if(isNaN(d.getTime())) return null;
				if(d.getFullYear()!==y || d.getMonth()!==m-1 || d.getDate()!==day) return null;
				return d;
			}
			function fmtTrDate(s){ const d=parseKey(s); if(!d) return s||""; return d.getDate()+" "+CAL_MONTHS[d.getMonth()]+" "+d.getFullYear(); }

			// Faz 10 (Admin > Yedekleme & Çöp): İl+Üniversite JSON'larını (eskiden ayrı
			// buton/indirme) TEK dosyada birleştirir -- felaket kurtarma/arşiv amaçlı. Bilinçli
			// kapsam kararı: SADECE indirme, geri yükleme YOK -- mevcut importJSON()
			// ayrı çalışmaya devam ediyor, bu birleşik dosyayı geri
			// yüklemek isteyen admin onu elle ikiye ayırıp mevcut "JSON Yükle" akışlarını kullanır
			// (otomatik birleşik geri yükleme çok daha riskli, ayrı bir iş kalemi).
			async function exportFullBackup(){
				if (!requireAdmin()) return;
				if (!database) { showToast("Veritabanı bağlı değil!", "error"); return; }
				try {
					showLoading("Tam yedek hazırlanıyor…");
					const [ilSnap, uniSnap] = await Promise.all([
						database.ref(dbPath("ilProtokolVerileri")).once("value"),
						database.ref(dbPath("universiteProtokolVerileri")).once("value")
					]);
					const payload = {
						yedekTarihi: new Date().toISOString(),
						ilProtokolVerileri: ilSnap.val() || {},
						universiteProtokolVerileri: uniSnap.val() || {}
					};
					downloadFile(JSON.stringify(payload, null, 2), "Tam-Yedek-" + dKey(new Date()) + ".json", "application/json");
					showToast("Tam yedek indirildi.", "success");
				} catch (err) {
					console.error("Tam yedek alınamadı:", err);
					showToast("Tam yedek alınamadı.", "error");
				} finally {
					hideLoading();
				}
			}


// Modal focus-trap (erisilebilirlik): acik bir modal varken Tab tusu modal DISINA cikmamali --
// klavye kullanicisi Tab'a basip basip arka plandaki (gorunmez/karartilmis) sayfa icerigine
// odaklanamaz. TUM .modal-bg ailesi (kisi/etkinlik/admin/hukuki metin modalleri, onay modalleri)
// tek bir delegated dinleyiciyle kapsanir -- ic ice acilan onay modallerinde (ornegin duzenleme
// modali acikken uzerine "Kalici Sil" onay modali) sadece EN USTTEKI (en yuksek z-index'li) modal
// hedef alinir, alttaki modal'a Tab ile kacilmaz.
document.addEventListener("keydown", function(e){
	if(e.key!=="Tab") return;
	const topModal=topmostOpenModal();
	if(!topModal) return;
	const focusables=Array.from(topModal.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'))
		.filter(function(el){ return el.offsetParent!==null; });
	if(!focusables.length) return;
	const first=focusables[0], last=focusables[focusables.length-1];
	if(e.shiftKey && document.activeElement===first){ e.preventDefault(); last.focus(); }
	else if(!e.shiftKey && document.activeElement===last){ e.preventDefault(); first.focus(); }
	else if(!topModal.contains(document.activeElement)){ e.preventDefault(); first.focus(); }
});

/* ================= HABER ŞABLONLARI ================= */
// Şablonlar artık admin panelinden düzenlenmiyor; sabit (aşağıdaki) varsayılan liste kullanılır.
// Yer tutucular: {kisiler} {kisilerDuz} {ilkKisi} {ilkKisiIn} {etkinlik} {yer} {tarih} {birim} {gruplar}
const DEFAULT_NEWS_TEMPLATES = [
	{ id:"serbest",   ad:"Serbest / Genel",        tur:"diger",     metin:"{yer} {kisiler}{gruplar} katıldı." },
	{ id:"acilis",    ad:"Açılış Töreni",          tur:"acilis",    metin:"{yer} düzenlenen {etkinlik} açılış törenine {kisiler}{gruplar} katıldı." },
	{ id:"konferans", ad:"Konferans",              tur:"konferans", metin:"{yer} gerçekleştirilen “{etkinlik}” başlıklı konferansa {kisiler}{gruplar} katıldı." },
	{ id:"panel",     ad:"Panel",                  tur:"panel",     metin:"{yer} gerçekleştirilen “{etkinlik}” başlıklı panele {kisiler}{gruplar} katıldı." },
	{ id:"calistay",  ad:"Çalıştay",                tur:"calistay",  metin:"{yer} gerçekleştirilen “{etkinlik}” başlıklı çalıştaya {kisiler}{gruplar} katıldı." },
	{ id:"ziyaret", ad:"Protokol Ziyareti", tur:"ziyaret", paragraphs:[
		[
			{ text:"{yer} gerçekleştirilen ziyarette {kisiler} hazır bulundu." },
			{ text:"{kisiler}, {yer} bir ziyaret gerçekleştirdi." },
			{ text:"{ilkKisiIn} başkanlığındaki heyet {yer} bir araya geldi.", condition:function(ctx){ return !!ctx.digerKisiler; } }
		],
		[
			{ text:"Ziyarette {aciklama} konusu ele alındı.", condition:function(ctx){ return !!ctx.aciklama; } },
			{ text:"Görüşmede {aciklama} gündeme geldi.", condition:function(ctx){ return !!ctx.aciklama; } },
			{ text:"Taraflar, {aciklama} hakkında görüş alışverişinde bulundu.", condition:function(ctx){ return !!ctx.aciklama; } }
		],
		[
			{ text:"Ziyareti {evSahibi} kabul etti.", condition:function(ctx){ return !!ctx.evSahibi; } },
			{ text:"Heyeti makamında kabul eden {evSahibi}, misafirlerine ilgisinden dolayı teşekkür etti.", condition:function(ctx){ return !!ctx.evSahibi; } },
			{ text:"{evSahibi}, ziyaretten duyduğu memnuniyeti dile getirdi.", condition:function(ctx){ return !!ctx.evSahibi; } }
		]
	] },
	{ id:"imza",      ad:"Protokol İmza Töreni",            tur:"imza",      metin:"{yer} düzenlenen protokol imza töreninde {kisiler} bir araya geldi." },
	{ id:"mezuniyet", ad:"Mezuniyet Töreni",       tur:"mezuniyet", metin:"{yer} düzenlenen {etkinlik} mezuniyet törenine {kisiler}{gruplar} katıldı." },
	{ id:"odul",      ad:"Ödül Töreni",            tur:"odul",      metin:"{yer} düzenlenen ödül törenine {kisiler}{gruplar} katıldı." },
	{ id:"basin",     ad:"Basın Toplantısı",       tur:"basin",     metin:"{yer} düzenlenen basın toplantısına {kisiler} katıldı." },
	{ id:"sergi",     ad:"Sergi / Kültür-Sanat",   tur:"sergi",     metin:"{yer} açılan “{etkinlik}” başlıklı sergiye {kisiler}{gruplar} katıldı." },
	{ id:"konser",    ad:"Konser",                 tur:"konser",    metin:"{yer} düzenlenen {etkinlik} konserine {kisiler}{gruplar} katıldı." },
	{ id:"spor",      ad:"Spor Etkinliği",         tur:"spor",      metin:"{yer} düzenlenen {etkinlik} spor etkinliğine {kisiler}{gruplar} katıldı." },
	{ id:"akademikbasari", ad:"Akademik Başarı",   tur:"akademikbasari", metin:"{kisiler}{gruplar}, {etkinlik} kapsamında elde ettiği akademik başarıyla gurur yaşattı." },
	{ id:"kariyer",   ad:"Kariyer Etkinliği",      tur:"kariyer",   metin:"{yer} düzenlenen {etkinlik} kariyer etkinliğine {kisiler}{gruplar} katıldı." },
	{ id:"topluluk",  ad:"Öğrenci Toplulukları",   tur:"topluluk",  metin:"{yer} düzenlenen {etkinlik} öğrenci toplulukları etkinliğine {kisiler}{gruplar} katıldı." },
	{ id:"saglik",    ad:"Sağlık Etkinliği",       tur:"saglik",    metin:"{yer} düzenlenen {etkinlik} sağlık etkinliğine {kisiler}{gruplar} katıldı." },
	{ id:"uluslararasi", ad:"Uluslararası Etkinlik", tur:"uluslararasi", metin:"{yer} düzenlenen “{etkinlik}” başlıklı uluslararası etkinliğe {kisiler}{gruplar} katıldı." },
	{ id:"yesiluniversite", ad:"Yeşil Üniversite", tur:"yesiluniversite", metin:"Yeşil Üniversite kapsamında {yer} düzenlenen {etkinlik} etkinliğine {kisiler}{gruplar} katıldı." },
	{ id:"toplanti",  ad:"Toplantı",               tur:"toplanti",  metin:"{yer} gerçekleştirilen {etkinlik} toplantısına {kisiler}{gruplar} katıldı." },
	{ id:"bayram",    ad:"Ulusal ve Resmî Bayramlar", tur:"bayram", metin:"{yer} düzenlenen {etkinlik} kutlamasına {kisiler}{gruplar} katıldı." },
	{ id:"altyazi",   ad:"Fotoğraf Alt Yazısı",    tur:"",          metin:"Fotoğrafta soldan sağa; {kisilerDuz} yer alıyor." },
	{ id:"gorevdegisimi", ad:"Görev Değişimi", tur:"gorevdegisimi", paragraphs:[
		[
			// NOT: birim ve gorev genelde AYNI/orustesen degerler olabilir (ör. "BAPKOB" hem birim hem gorev adi).
			// Bu yuzden hicbir varyant ikisini AYNI cumlede birlestirmez; tekrar riski boylece tamamen ortadan kalkar.
			{ text:"{yeniGorevli}, {gorevDat} atandı.", condition:function(ctx){ return !!ctx.gorev; } },
			{ text:"{yeniGorevli}, {gorevDat} getirildi.", condition:function(ctx){ return !!ctx.gorev; } },
			{ text:"{birimIn} kadrosuna katılan {yeniGorevli}, yeni görevine başladı.", condition:function(ctx){ return !!ctx.birim; } },
			{ text:"{yeniGorevli} yeni görevine başladı." }
		],
		[
			{ text:"{yeniGorevliIn} yeni görevinde başarılı olması temenni edildi." },
			{ text:"{yeniGorevli}, yeni görevinde üniversitemize katkılar sunmaya devam edecek." },
			{ text:"{yeniGorevliDat} yeni görevinde başarılar dilendi." }
		],
		[
			{ text:"Önceki dönemde bu görevi yürüten {eskiGorevliDat} yeni görevinde başarılar dilendi.", condition:function(ctx){ return !!ctx.eskiGorevli; } },
			{ text:"{eskiGorevliIn} ardından bu göreve {yeniGorevli} atandı.", condition:function(ctx){ return !!ctx.eskiGorevli; } },
			{ text:"{birim} bünyesinde uzun süre görev yapan {eskiGorevliAcc} uğurlandı.", condition:function(ctx){ return !!ctx.eskiGorevli && !!ctx.birim; } }
		]
	] }
];
let newsTemplates = DEFAULT_NEWS_TEMPLATES.slice();
let newsPeopleOverride = null;   // takvimden üretilirken etkinliğin katılımcıları
let newsEventContext = null;     // { etkinlik, yer, tarih, birim }

// Sablon metninde {ph} (veya turetilmis {ph}In/{ph}Dat/{ph}Acc hali) gecen her alan icin otomatik giris kutusu uretir (tek genel mekanizma).
const NEWS_PLACEHOLDER_FIELDS = [
	{ ph:"etkinlik",    label:"Etkinlik Adı" },
	{ ph:"birim",       label:"Birim" },
	{ ph:"aciklama",    label:"Görüşme Konusu / Açıklama (opsiyonel)" },
	{ ph:"evSahibi",    label:"Ev Sahibi (opsiyonel)" },
	{ ph:"yeniGorevli", label:"Yeni Görevli" },
	{ ph:"eskiGorevli", label:"Önceki Görevli (varsa)" },
	{ ph:"gorev",       label:"Görev / Unvan" }
];

function fillNewsTemplateSelect(keepId){
	const sel=document.getElementById("newsTemplateSelect"); if(!sel) return;
	const cur = keepId || sel.value;
	sel.innerHTML=newsTemplates.map(function(t,i){ return '<option value="'+i+'">'+escapeHtml(t.ad)+'</option>'; }).join("");
	if(cur!==undefined && cur!=="" && newsTemplates[Number(cur)]) sel.value=cur;
}
function currentTemplate(){
	const sel=document.getElementById("newsTemplateSelect");
	const i=sel?Number(sel.value):0;
	return newsTemplates[i] || newsTemplates[0] || DEFAULT_NEWS_TEMPLATES[0];
}
function onNewsTemplateChange(){ renderNewsPlaceholderFields(); generateNewsText(); }

// Seçilen şablon {etkinlik} veya {birim} kullanıyorsa, o alanlar için kutu gösterilir.
function newsPlaceholderInputId(ph){ return "news" + ph.charAt(0).toUpperCase() + ph.slice(1) + "Input"; }
function renderNewsPlaceholderFields(){
	const wrap=document.getElementById("newsPlaceholderFields"); if(!wrap) return;
	const allText=templateAllText(currentTemplate());
	const tokens=(allText.match(/\{(\w+)\}/g)||[]).map(function(t){ return t.slice(1,-1); });
	let html="";
	NEWS_PLACEHOLDER_FIELDS.forEach(function(f){
		const used=tokens.some(function(t){ return t===f.ph || t.indexOf(f.ph)===0; }); if(!used) return;
		html+=`<label style="font-weight:600; font-size:13px; color:var(--muted); display:block; margin-bottom:4px;">${f.label}</label><input type="text" id="${newsPlaceholderInputId(f.ph)}" oninput="generateNewsText()" style="width:100%; padding:9px 12px; border-radius:8px; border:1px solid var(--border); font-size:14px; margin-bottom:12px; box-sizing:border-box;">`;
	});
	wrap.innerHTML=html;
	if(newsEventContext){
		const ctxMap={ etkinlik:newsEventContext.etkinlik||"", birim:newsEventContext.birim||"", aciklama:newsEventContext.not||"" };
		Object.keys(ctxMap).forEach(function(ph){ const el=document.getElementById(newsPlaceholderInputId(ph)); if(el) el.value=ctxMap[ph]; });
	}
}
function applyTemplate(tpl, ctx){
	return String(tpl||"").replace(/\{(\w+)\}/g, function(_,k){
		return (ctx[k]!==undefined && ctx[k]!==null) ? String(ctx[k]) : "";
	}).replace(/[ \t]{2,}/g," ").replace(/ +([,.;:])/g,"$1").trim();
}

// Varyant secimini her tus vurusunda rastgele degistirmemek icin basit deterministik string hash.
function strHash(str){
	let h = 0; const s = String(str||"");
	for(let i=0;i<s.length;i++){ h = ((h<<5)-h+s.charCodeAt(i))|0; }
	return Math.abs(h);
}
// "variants" icindeki {text,condition} seceneklerinden condition(ctx) gecenleri filtreler, aralarindan seedStr'e
// gore DETERMINISTIK biri secilir. Hicbiri gecmezse null doner (paragraf tamamen atlanir; AI'nin bilinmeyen
// ayrintiyi uydurmasina karsilik gelen sorunu, kodun kendisinin asla uydurmamasiyla cozer).
function pickVariant(variants, ctx, seedStr){
	const usable = (variants||[]).filter(function(v){ return !v.condition || v.condition(ctx); });
	if(!usable.length) return null;
	return usable[strHash(seedStr) % usable.length].text;
}
// Bir sablonun (eski "metin" ya da yeni "paragraphs" bicimi) icerdigi TUM {xxx} yer tutucularini tek noktadan
// taramak icin: renderNewsPlaceholderFields() hangi giris kutularini gosterecegini boyle bulur.
function templateAllText(tpl){
	if(tpl.metin) return tpl.metin;
	if(!Array.isArray(tpl.paragraphs)) return "";
	let all="";
	tpl.paragraphs.forEach(function(group){ (group||[]).forEach(function(v){ all += " " + (v.text||""); }); });
	return all;
}
// Zengin (coklu paragraf, kosullu) sablonlari render eder; "paragraphs" yoksa eski applyTemplate() yoluna duser.
function applyRichTemplate(tpl, ctx){
	if(!Array.isArray(tpl.paragraphs)) return applyTemplate(tpl.metin, ctx);
	const paras = tpl.paragraphs.map(function(group, gi){
		const seed = (ctx.ilkKisi||"") + "|" + (ctx.yer||"") + "|" + gi;
		const text = pickVariant(group, ctx, seed);
		return text ? applyTemplate(text, ctx) : "";
	}).filter(Boolean);
	return paras.join("\n\n");
}

// "Atatürk Kongre Merkezi" + bulunma hâli = "Atatürk Kongre Merkezi'nde" (düz "'de" yanlış olur).
// Kurallar: ünlü uyumu (a,ı,o,u→da / e,i,ö,ü→de), sert ünsüz benzeşmesi (fstkçşhp→ta/te)
// ve tamlama eki alan sözlerde (…Merkezi, …Salonu) araya kaynaştırma n'si girer.
function turkishLocative(place){
	const s=String(place||"").trim(); if(!s) return "";
	const words=s.split(/\s+/); const last=words[words.length-1];
	const lower=function(ch){ if(ch==="İ") return "i"; if(ch==="I") return "ı"; return ch.toLocaleLowerCase("tr-TR"); };
	const vowels="aeıioöuü";
	// Denetim maddesi #2: "OMÜ"/"TBMM" gibi TAMAMEN BUYUK harfli kisaltmalarda ek uyumu yazili son
	// harfe degil, o harfin Turkce okunusuna gore secilir (bkz. abbrevPronunciationVowel() tanimi).
	const abbrevVowel = (typeof abbrevPronunciationVowel === "function") ? abbrevPronunciationVowel(last) : null;
	let lastVowel = abbrevVowel || "";
	if (!abbrevVowel) { for(let i=last.length-1;i>=0;i--){ const c=lower(last[i]); if(vowels.indexOf(c)>-1){ lastVowel=c; break; } } }
	const back="aıou".indexOf(lastVowel)>-1;
	const lastCh=lower(last[last.length-1]);
	// Kisaltmanin yazili son harfi sert unsuz OLSA BILE (ör. TBMM'nin son harfi "M" yumusak), sert
	// unsuz benzesmesi YAZIYA degil OKUNUSA bakar -- kisaltmalarda gercek harf esas alinir (M sert degil).
	const hard=!abbrevVowel && "fstkçşhp".indexOf(lastCh)>-1;
	// Çok kelimeli ve son kelimesi i/ı/u/ü ile biten adlar genelde tamlamadır: Merkezi, Salonu, Fakültesi…
	const needsN = words.length>1 && "ıiuü".indexOf(lastCh)>-1;
	const ek=(hard?"t":"d")+(back?"a":"e");
	return s+"'"+(needsN?"n":"")+ek;
}

		// Haber şablonları artık admin panelinden düzenlenmiyor; doğrudan DEFAULT_NEWS_TEMPLATES kullanılır.
		attachTestModeListener();
		attachSaltOkunurListener();
		fillNewsTemplateSelect();
		renderNewsPlaceholderFields();

		// ---- Arka plan kaydırma kilidi ----
		// Herhangi bir panel açıkken (.modal-bg'lerin TÜMÜ: kişi ekle/düzenle, admin, haber çıktısı, onay
		// pencereleri, silinenler/çöp boşaltma vb. + takvim + giriş formu + mobil fakülte çekmecesi) arka
		// plandaki kart listesinin kaymasını engeller. Tek tek her open/close fonksiyonuna dokunmak yerine
		// bu panellerin hepsi zaten aynı "open" sınıfını kullandığından, o sınıftaki değişikliği izleyip
		// body'yi otomatik kilitleyip açan tek, merkezi bir gözlemci yeterli.
		var scrollLockY = 0, scrollLockActive = false;
		function lockBodyScroll(){
			if (scrollLockActive) return;
			scrollLockActive = true;
			scrollLockY = window.scrollY || window.pageYOffset || 0;
			document.body.style.top = (-scrollLockY) + "px";
			document.body.classList.add("scroll-locked");
		}
		function unlockBodyScroll(){
			if (!scrollLockActive) return;
			scrollLockActive = false;
			document.body.classList.remove("scroll-locked");
			document.body.style.top = "";
			window.scrollTo(0, scrollLockY);
		}
		(function setupScrollLock(){
			var watched = Array.prototype.slice.call(document.querySelectorAll(".modal-bg, #authFormBg, #facultySheetBackdrop, #loadingOverlay"));
			function recomputeLock(){
				var anyOpen = watched.some(function(el){ return el.classList.contains("open"); });
				if (anyOpen) lockBodyScroll(); else unlockBodyScroll();
			}
			var observer = new MutationObserver(recomputeLock);
			watched.forEach(function(el){ observer.observe(el, { attributes: true, attributeFilter: ["class"] }); });
			recomputeLock();
		})();

		// ---- Modal kayıt defteri + Escape tuşu ile kapatma (merkezi) ----
		// Su ana kadar HICBIR .modal-bg (10 modal) Escape ile kapanmiyordu. Her modalin kendi
		// close*() fonksiyonu FARKLI ek islemler yapabildigi icin (ornegin closeConfirmModal()
		// duzenleme modaline GERI DONER, closeModal() successor/history panellerini de kapatir,
		// closeSinglePermDelete() singlePermDeleteIdx'i temizler) burada asla dogrudan
		// classList.remove("open") YAPILMAZ -- ilgili modalin KENDI close fonksiyonu cagrilir,
		// boylece TUM yan etkiler korunur, bu sadece mevcut sistemin UZERINE ek bir yetenek katar.
		// Bu kayit defteri (id -> close fonksiyonu), "hangi modal su an acik" sorusunun DOM'un
		// kendisinden (source of truth) okunabilmesi (querySelector('.modal-bg.open')) sayesinde
		// ayrica bir JS state degiskeni TUTMUYOR -- yukaridaki scroll-lock gozlemcisiyle ayni
		// felsefe: durumu DOM'da tekrarlamak yerine DOM'dan okumak.
		const MODAL_CLOSE_FNS = {
			modalBg: closeModal,
			confirmModalBg: closeConfirmModal,
			bulkConfirmModalBg: closeBulkConfirmModal,
			emptyTrashModalBg: closeEmptyTrashModal,
			singlePermDeleteModalBg: closeSinglePermDelete,
			newsModalBg: closeNewsModal,
			adminPanelBg: closeAdminPanel,
			legalModalBg: closeLegalModal
		};
		// En USTTEKI (en yuksek z-index'li) acik modal hedef alinir -- ayni tespit mantigi zaten
		// Tab focus-trap dinleyicisinde kullaniliyor (bkz. asagida), ic ice acilma ihtimaline karsi.
		function topmostOpenModal(){
			const openModals = Array.from(document.querySelectorAll(".modal-bg.open"));
			if (!openModals.length) return null;
			return openModals.reduce(function(top, m){
				const z = parseInt(getComputedStyle(m).zIndex) || 0;
				const topZ = top ? (parseInt(getComputedStyle(top).zIndex) || 0) : -1;
				return z >= topZ ? m : top;
			}, null);
		}
		document.addEventListener("keydown", function(e){
			if (e.key !== "Escape") return;
			const top = topmostOpenModal();
			if (!top) return;
			const fn = MODAL_CLOSE_FNS[top.id];
			if (fn) fn();
		});

		// ---- --vh: iOS Safari'de adres/arac cubugu acilip kapaninca GERCEK gorunur
		// yuksekligi takip eden degisken (bkz. :root'taki --vh yorumu). position:fixed;inset:0
		// tek basina bunu takip etmiyor, .modal-bg/.successor-panel'in alt kenarinda sayfanin
		// gercek arka planini aciga cikarabiliyordu (kullanici bildirimi). visualViewport API
		// arac cubugu her acilip kapandiginda "resize" fırlatır -- bunu dinleyip height'i
		// GERCEK zamanli guncelliyoruz.
		(function setupViewportHeightVar(){
			function sync(){
				var h = (window.visualViewport ? window.visualViewport.height : window.innerHeight);
				document.documentElement.style.setProperty("--vh", (h * 0.01) + "px");
			}
			sync();
			if (window.visualViewport) {
				window.visualViewport.addEventListener("resize", sync);
			} else {
				window.addEventListener("resize", sync);
			}
			window.addEventListener("orientationchange", sync);
		})();

		// Not: eski "themeToggleBtn" düğmesi ve buna bağlı setupTheme()/toggleTheme() (kendi
		// "omuProtokolTema" localStorage anahtarıyla) kaldırıldı -- düğme artık hiçbir sayfanın
		// DOM'unda yok. Tema değiştirme artık tamamen v4 admin kabuğunun kendi mekanizmasında
		// (bkz. admin-src/src/v4/shell.js ve command-palette.js, "theme" localStorage anahtarı,
		// her sayfanın <head>'indeki FOUC-engelleme script'i) -- burada tekrar etmeye gerek yok.

		// Service Worker Kaydı (Offline / PWA desteği)
			if ("serviceWorker" in navigator) {
				window.addEventListener("load", function() {
					navigator.serviceWorker.register("./sw.js")
						.catch(function(err) { console.error("Service Worker kaydı başarısız:", err); });
				});
			}
