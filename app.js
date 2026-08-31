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
					if (currentUser.role !== "admin") {
						showToast("Bu bölüm sadece yöneticilere açık.", "error");
						location.replace("protokol.html");
						return;
					}
				}
				if (PAGE === "takvim" && !window.__takvimBooted) {
					window.__takvimBooted = true;
					const params = new URLSearchParams(location.search);
					const dateParam = params.get("date"), evParam = params.get("event"), editParam = params.get("edit");
					if (dateParam) openCalendarAt(dateParam, evParam); else openCalendar();
					if (editParam) tryOpenEditFromQuery(editParam, 0);
				}
				if (PAGE === "admin" && !window.__adminBooted) {
					window.__adminBooted = true;
					openAdminPanel();
				}
				if (currentUser) { startReminderTicker(); renderNotifCenter(); }
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

			function canEditData() { return !!(currentUser && (currentUser.role === "editor" || currentUser.role === "admin")); }
			function isAdminUser() { return !!(currentUser && currentUser.role === "admin"); }

			// .edit-only sınıfı butonları sadece GİZLİYOR; fonksiyonlar global olduğu için konsoldan veya
			// klavyeyle hâlâ çağrılabiliyordu. Yazma yapan her fonksiyon artık bu kapıdan geçiyor.
			function requireEdit() {
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
				if (adminFab) adminFab.classList.toggle("active-list", !!(currentUser && currentUser.role === "admin"));
				if (!currentUser) {
					wrap.innerHTML = '<button class="btn-auth btn-pin" type="button" onclick="openPinSwitchModal()" title="PIN ile hızlı hesap değiştir">🔑</button><button class="btn-auth" onclick="openAuthForm(\'login\')">Giriş Yap</button>';
					return;
				}
				const roleLabel = { pending: "Onay Bekliyor", editor: "Editör", admin: "Admin" }[currentUser.role] || "Onay Bekliyor";
				const displayName = currentUser.firstName || currentUser.email;
				const initial = escapeHtml((displayName || "?").trim().charAt(0).toUpperCase());
				// admin-menu-item: mobilde CSS ile gizlenir (bkz. style.css) -- mobilde bu
				// islevi artik ortadaki admin-fab tasiyor, masaustunde dropdown'da kalmaya devam eder.
				const adminItem = (currentUser.role === "admin") ? '<button type="button" class="header-menu-item admin-menu-item" onclick="closeHeaderMenu(); openAdminPanel();">🛠️ Admin Paneli</button>' : "";
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
					'<button type="button" class="header-menu-item" onclick="closeHeaderMenu(); openPinSwitchModal();">🔑 PIN ile Hızlı Hesap Değiştir</button>' +
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
				if (!currentUser || currentUser.role !== "admin") return;
				if (PAGE !== "admin") { location.href = "admin.html"; return; }
				document.getElementById("adminPanelBg").classList.add("open");
				updateTestModeBanner();
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
				const monthEl = document.getElementById("akMonthEvents");
				const testEl = document.getElementById("akTestMode");
				const testKpiEl = document.getElementById("akTestModeKpi");
				if (!pendingEl) return;
				testEl.textContent = testModeEnabled ? "Açık" : "Kapalı";
				testKpiEl.classList.toggle("ak-warn", testModeEnabled);
				const now = new Date();
				const monthCount = Object.values(calEvents || {}).filter(function(e){
					if (!e || !e.tarih) return false;
					const d = parseKey(e.tarih); if (!d) return false;
					return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
				}).length;
				monthEl.textContent = monthCount;
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
				dashboard: "Kontrol Paneli", stats: "Faaliyet & İstatistik",
				"field-ops": "Saha Masası", editorial: "Haber & Ajans",
				hierarchy: "Hiyerarşi & Kadro", integrity: "Kart Sağlığı", dictionary: "Veri Sözlüğü",
				users: "Kullanıcılar & PIN", logs: "Denetim Günlüğü", test: "Test & Sistem", backup: "Yedekleme & Çöp"
			};
			const ADMIN_TAB_GROUPS = {
				dashboard: "Genel", stats: "Genel",
				"field-ops": "Saha", editorial: "Saha",
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
				else if (tab === "stats") loadAdminStats();
				else if (tab === "logs") { loadAdminLogs(); loadTestModeLog(); }
				else if (tab === "dashboard") loadAdminDashboard();
				else if (tab === "field-ops") loadFieldOps();
				else if (tab === "editorial") loadEditorial();
				else if (tab === "hierarchy") loadHierarchy();
				else if (tab === "integrity") loadIntegrity();
				// dictionary/backup: henüz yükleyici fonksiyonları yok (sonraki aşama), view
				// "yakında" placeholder gösteriyor.
			}
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

			// Faaliyet istatistik paneli: calEvents (sayfa yüklenince zaten canlı bağlı, bkz.
			// attachEventsListener()) üzerinden aylık/yıllık/tüm-zamanlar bazında özet çıkarır --
			// ayrı bir Firebase okuması gerekmez. BAPKOB/Kalite raporlarına hızlı veri sağlar.
			function loadAdminStats(){
				if (!requireAdmin()) return;
				const box = document.getElementById("adminStatsResult");
				const range = document.getElementById("statsRangeSelect").value;
				const now = new Date();
				const events = Object.values(calEvents).filter(function(e){
					if (!e || !e.tarih) return false;
					if (range === "all") return true;
					const d = parseKey(e.tarih); if (!d) return false;
					if (range === "year") return d.getFullYear() === now.getFullYear();
					return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
				});
				if (!events.length) { box.innerHTML = '<p class="admin-user-empty">Bu aralıkta etkinlik yok.</p>'; return; }
				function topList(counts, limit){
					return Object.keys(counts).map(function(k){ return { k: k, n: counts[k] }; })
						.sort(function(a,b){ return b.n - a.n; }).slice(0, limit || 10);
				}
				function barsHtml(rows, total){
					return rows.map(function(r){
						const pct = total ? Math.round((r.n/total)*100) : 0;
						return '<div class="stats-bar-row"><span class="stats-bar-label">' + escapeHtml(r.k) + '</span>' +
							'<div class="stats-bar-track"><div class="stats-bar-fill" style="width:' + pct + '%;"></div></div>' +
							'<span class="stats-bar-count">' + r.n + '</span></div>';
					}).join("");
				}
				const turCounts = {}; events.forEach(function(e){ const t = evType(e.tur); turCounts[t.ad] = (turCounts[t.ad]||0)+1; });
				const birimCounts = {}; events.forEach(function(e){ const b = (e.birim||"").trim(); if (b) birimCounts[b] = (birimCounts[b]||0)+1; });
				const gorevliCounts = {}; events.forEach(function(e){ parseGorevliString(e.gorevli).forEach(function(name){ gorevliCounts[name] = (gorevliCounts[name]||0)+1; }); });
				box.innerHTML =
					'<div class="admin-stats-kpi"><span class="ak-num">' + events.length + '</span><span class="ak-label">Toplam Etkinlik</span></div>' +
					'<div class="admin-stats-grid">' +
						'<div class="admin-stats-section"><h4>Etkinlik Türüne Göre</h4>' + barsHtml(topList(turCounts), events.length) + '</div>' +
						'<div class="admin-stats-section"><h4>En Çok Etkinlik Düzenleyen Birimler</h4>' + (Object.keys(birimCounts).length ? barsHtml(topList(birimCounts), events.length) : '<p class="admin-user-empty">Birim bilgisi girilmemiş.</p>') + '</div>' +
						'<div class="admin-stats-section"><h4>Basın Görevlisi Bazında Takip</h4>' + (Object.keys(gorevliCounts).length ? barsHtml(topList(gorevliCounts), events.length) : '<p class="admin-user-empty">Basın görevlisi atanmamış.</p>') + '</div>' +
					'</div>';
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
			function statBarHtml(rows, total) {
				return rows.map(function(r) {
					const pct = total ? Math.round((r.n / total) * 100) : 0;
					return '<div class="stats-bar-row"><span class="stats-bar-label">' + escapeHtml(r.k) + '</span>' +
						'<div class="stats-bar-track"><div class="stats-bar-fill" style="width:' + pct + '%;"></div></div>' +
						'<span class="stats-bar-count">' + r.n + '</span></div>';
				}).join("");
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
			function daysSince(ts) { return ts ? Math.floor((Date.now() - ts) / 86400000) : null; }

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

				const draftEvents = Object.values(calEvents || {}).filter(function(e) { return e && e.ad === QUICK_DRAFT_NAME; });
				const staleDrafts = draftEvents.filter(function(e) { return daysSince(e.olusturmaTs) >= 1; });

				const today = todayDate();
				const archiveMissing = Object.values(calEvents || {}).filter(function(e) {
					if (!e || !e.tarih) return false;
					if (e.durum !== "cekildi" && e.durum !== "haber" && e.durum !== "yayinlandi") return false;
					const d = parseKey(e.tarih); if (!d || d >= today) return false;
					return !e.arsiv;
				});

				function cardHtml(icon, count, label, tone) {
					return '<div class="dash-alert-card' + (tone ? " " + tone : "") + '"><span class="dash-alert-num">' + count + '</span><span class="dash-alert-label">' + escapeHtml(label) + '</span></div>';
				}
				box.innerHTML = '<div class="dash-alert-grid">' +
					cardHtml("📡", staleDrafts.length, "24s+ Bekleyen Taslak", staleDrafts.length ? "ak-warn" : "") +
					cardHtml("🏛️", vacantUnits.length, "Boş Kadro (Birim)", vacantUnits.length ? "ak-warn" : "") +
					cardHtml("📰", archiveMissing.length, "Arşiv Linki Eksik Etkinlik", archiveMissing.length ? "ak-warn" : "") +
					'</div>' +
					(draftEvents.length ? '<h4 class="dash-alert-subhead">Bekleyen Taslaklar</h4><div class="stat-expiry-list">' + draftEvents.map(function(e) {
						const days = daysSince(e.olusturmaTs);
						return '<div class="stat-expiry-row"><span class="stat-expiry-badge' + (days >= 1 ? " warn" : "") + '">' + (days === null ? "?" : days) + 'g</span><span class="stat-expiry-name">' + escapeHtml(fmtTrDate(e.tarih)) + ' ' + escapeHtml(e.saat || "") + '</span><button type="button" class="btn btn-ghost" style="padding:3px 9px; font-size:11px;" onclick="openEventModal(\'' + e._id + '\')">Düzenle</button></div>';
					}).join("") + '</div>' : "");
			}

			// ---- field-ops: bekleyen taslak etkinlikler + personel iş yükü ----
			function loadFieldOps() {
				if (!requireAdmin()) return;
				const box = document.getElementById("adminFieldOpsBody");
				if (!box) return;
				const draftEvents = Object.values(calEvents || {}).filter(function(e) { return e && e.ad === QUICK_DRAFT_NAME; })
					.sort(function(a, b) { return (a.olusturmaTs || 0) - (b.olusturmaTs || 0); });
				const workload = {};
				Object.values(calEvents || {}).forEach(function(e) { parseGorevliString(e && e.gorevli).forEach(function(name) { workload[name] = (workload[name] || 0) + 1; }); });
				const workloadRows = Object.keys(workload).map(function(k) { return { k: k, n: workload[k] }; }).sort(function(a, b) { return b.n - a.n; });
				const workloadTotal = workloadRows.reduce(function(s, r) { return s + r.n; }, 0);
				box.innerHTML =
					'<h4 class="dash-alert-subhead">Bekleyen Taslaklar (' + draftEvents.length + ')</h4>' +
					(draftEvents.length ? '<div class="stat-expiry-list">' + draftEvents.map(function(e) {
						const days = daysSince(e.olusturmaTs);
						return '<div class="stat-expiry-row"><span class="stat-expiry-badge' + (days >= 1 ? " warn" : "") + '">' + (days === null ? "?" : days) + 'g</span><span class="stat-expiry-name">' + escapeHtml(fmtTrDate(e.tarih)) + ' ' + escapeHtml(e.saat || "") + '</span><button type="button" class="btn btn-ghost" style="padding:3px 9px; font-size:11px;" onclick="openEventModal(\'' + e._id + '\')">Düzenle</button></div>';
					}).join("") + '</div>' : '<p class="admin-user-empty">Bekleyen taslak yok.</p>') +
					'<h4 class="dash-alert-subhead">Personel İş Yükü (görevlendirme sayısı)</h4>' +
					(workloadRows.length ? statBarHtml(workloadRows, workloadTotal) : '<p class="admin-user-empty">Görevli ataması yok.</p>');
			}

			// ---- editorial: haber SLA + ajans dağılımı ----
			function loadEditorial() {
				if (!requireAdmin()) return;
				const box = document.getElementById("adminEditorialBody");
				if (!box) return;
				const events = Object.values(calEvents || {});
				const pendingNews = events.filter(function(e) { return e.durum === "cekildi"; })
					.sort(function(a, b) { return (a.guncellemeTs || 0) - (b.guncellemeTs || 0); });
				const agencyCounts = {};
				events.forEach(function(e) { if (e.haberKaynagi) agencyCounts[e.haberKaynagi] = (agencyCounts[e.haberKaynagi] || 0) + 1; });
				const agencyRows = Object.keys(agencyCounts).map(function(k) { return { k: k, n: agencyCounts[k] }; });
				const agencyColors = { "İHA": "#1d4ed8", "AA": "#b45309", "DHA": "#15803d", "ANKA": "#7c3aed" };
				box.innerHTML =
					'<h4 class="dash-alert-subhead">Haber Bekleyen (Gerçekleşti → Haber Yazılmadı), en eski önce</h4>' +
					(pendingNews.length ? '<div class="stat-expiry-list">' + pendingNews.slice(0, 15).map(function(e) {
						const days = daysSince(e.guncellemeTs);
						return '<div class="stat-expiry-row"><span class="stat-expiry-badge' + (days >= 3 ? " warn" : "") + '">' + (days === null ? "?" : days) + 'g</span><span class="stat-expiry-name">' + escapeHtml(e.ad || "(adsız)") + ' · ' + escapeHtml(fmtTrDate(e.tarih)) + '</span><button type="button" class="btn btn-ghost" style="padding:3px 9px; font-size:11px;" onclick="openEventModal(\'' + e._id + '\')">Düzenle</button></div>';
					}).join("") + '</div>' +
					'<p class="hint" style="margin-top:6px;">Süre, kaydın son güncellenme zamanından yaklaşık hesaplanır (durum değişim anı ayrıca tutulmuyor).</p>' : '<p class="admin-user-empty">Bekleyen haber yok.</p>') +
					'<h4 class="dash-alert-subhead">Ajans Dağılımı</h4>' +
					(agencyRows.length ? statSegmentedBarHtml(agencyRows, agencyRows.map(function(r) { return agencyColors[r.k]; })) : '<p class="admin-user-empty">Ajans bilgisi girilmemiş.</p>');
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

			function loadAdminLogs() {
				if (!database || !requireAdmin()) return;
				const listEl = document.getElementById("adminLogList");
				listEl.innerHTML = '<p class="admin-user-empty">Yükleniyor…</p>';
				Promise.all([
				database.ref("logs/il").limitToLast(50).once("value"),
				database.ref("logs/universite").limitToLast(50).once("value"),
				database.ref("logs/etkinlik").limitToLast(50).once("value"),
				database.ref("logs/hesap").limitToLast(50).once("value")
				]).then(function(snaps) {
				const ilLogs = Object.values(snaps[0].val() || {}).map(function(e){ e._list = "il"; return e; });
				const uniLogs = Object.values(snaps[1].val() || {}).map(function(e){ e._list = "universite"; return e; });
				const evLogs = Object.values(snaps[2].val() || {}).map(function(e){ e._list = "etkinlik"; return e; });
				const hesapLogs = Object.values(snaps[3].val() || {}).map(function(e){ e._list = "hesap"; return e; });
				const entries = ilLogs.concat(uniLogs).concat(evLogs).concat(hesapLogs).sort(function(a,b){ return (b.timestamp||0) - (a.timestamp||0); }).slice(0, 50);
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
					listEl.innerHTML = uids.map(function(uid) {
						const u = usersObj[uid];
						const fullName = ((u.firstName||"") + " " + (u.lastName||"")).trim() || "(isim yok)";
						const role = u.role || "pending";
						const isSelf = currentUser && uid === currentUser.uid;
						const selectHtml = isSelf
							? '<select disabled title="Kendi yetkini burada değiştiremezsin (güvenlik için).">' +
								'<option selected>Admin (Siz)</option>' +
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
					const roleLabels = { pending: "Onay Bekliyor", editor: "Editör", admin: "Admin" };
					const fullName = ((u.firstName || "") + " " + (u.lastName || "")).trim() || u.email || uid;
					// SON ADMIN KORUMASI: Rules seviyesinde "en az bir admin kalmali" kisitini ifade
					// etmek pratik degil (tum users dugumunu saymak gerekir, kirilgan/pahali olur) --
					// bkz. docs/firebase-database-rules.json notu. Bunun yerine burada, istemci
					// tarafinda, mevcut TUM admin sayisi kontrol edilir; bu kisi son admin ise
					// rolu düşürülemez.
					if (oldRole === "admin" && newRole !== "admin") {
						const allSnap = await database.ref("users").once("value");
						const allUsers = allSnap.val() || {};
						const adminCount = Object.keys(allUsers).filter(function(k){ return allUsers[k] && allUsers[k].role === "admin"; }).length;
						if (adminCount <= 1) { showToast("Son admin kullanıcının rolü düşürülemez. Önce başka bir admin atayın.", "error"); loadAdminUsers(); return; }
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
			const LIST_LABELS = { il: 'İl Protokol Sırası', universite: 'Üniversite Protokol Sırası', etkinlik: 'Etkinlik Takvimi', hesap: 'Hesap' };
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

			// Sol filtre panelinde seçilen fakülte/birim adları (çoklu seçim)
			let selectedFaculties = new Set();
			// Sol paneldeki "Rektörlük / Merkez" kutusunda tek tek işaretlenen kişilerin push-ID'leri
			// (eskiden dizi indeksi (_realIdx) tutulurdu -- başka bir editör kayıt ekleyip/silince
			// indeksler kayar, yanlış kişi işaretli görünürdü; ID'ler kalıcı olduğu için artık kaymaz).
			let selectedCentralAdminIdx = new Set();
			// Sol paneldeki hangi fakülte/birim grubu (akordiyon) başlığının açık olduğu
			let openedFacultyGroups = new Set();

			// Rektör / Rektör Yardımcıları / Genel Sekreter ve Daire Başkanları — bu kişiler belirli bir fakülteye
			// bağlı olmadıklarından "Protokol Sırası (Referans)" panelindeki 1, 2 ve 11. katmanlara (rank) göre belirlenir.
			function isCentralAdminPerson(p) {
				const r = Number(p.rank);
				return r === 1 || r === 2 || r === 11;
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

			// "Şimdi/Sıradaki" rail'i (renderCalendarRail) -- tarih/etkinlik id'si dataset'ten okunur.
			document.getElementById('calRailNext').addEventListener('click', function(e) {
				const item = e.target.closest('[data-evid]'); if (!item) return;
				openCalendarAt(item.dataset.date, item.dataset.evid);
			});

			// Takvim overlay'i (renderWeekView/renderMonthView/renderListView) -- kucuk bir
			// data-act sozlugu (peek/edit/add/more) tum tikanma noktalarini tek dinleyicide toplar.
			// evid, tiklanan elemanin KENDI data-evid'i yoksa en yakin [data-evid] atasindan okunur
			// (ornegin liste gorunumundeki kalem ikonu, evid'i tasiyan .cal-ev butonunun icinde).
			document.getElementById('calendarOverlay').addEventListener('click', function(e) {
				const actEl = e.target.closest('[data-act]');
				if (actEl) {
					e.stopPropagation();
					const act = actEl.dataset.act;
					const evidEl = actEl.dataset.evid !== undefined ? actEl : e.target.closest('[data-evid]');
					const evid = evidEl ? evidEl.dataset.evid : null;
					const date = actEl.dataset.date;
					if (act === 'peek' && evid) openEventPeek(evid);
					else if (act === 'edit' && evid) openEventModal(evid);
					else if (act === 'add' && date) openEventModal(null, date);
					else if (act === 'more' && date) calGoToDayWeek(date);
					return;
				}
				const dayCol = e.target.closest('.cal-daycol');
				if (dayCol) calGridClick(e, dayCol.dataset.date, dayCol);
			});
			// Faz 9: resize kolu -- ayri, delege edilmis bir pointerdown dinleyicisi. click
			// dinleyicisiyle AYNI elemana (#calendarOverlay) bagli ama farkli olay turunde,
			// cunku surukleme click'ten once (pointerdown) baslamak zorunda.
			document.getElementById('calendarOverlay').addEventListener('pointerdown', function(e) {
				calStartResizeGesture(e);
				calStartGridSelectGesture(e); // Faz 9 Part D -- kendi guard'i (.cal-block/.cal-resize-handle disi) sayesinde resize/move ile CAKISMAZ
			});

			// Gun/hafta gorunumunde sola/saga kaydirarak gune-haftaya gecis -- kullanici usttteki
			// ok butonlarini "efektif degil, hizli aksiyon alamiyorsun" olarak degerlendirdi.
			// Sadece #calTgScroll ICINDE baslayan gercekten YATAY (dikeyden belirgin sekilde daha
			// buyuk) ve yeterince hizli/uzun bir jest calShift() tetikler; SortableJS'in kendi
			// surukleme algilamasiyla (150ms delay + kucuk hareket toleransi) CAKISMAZ -- bir
			// surukleme zaten basladiysa (calDragActive) swipe hic devreye girmez.
			(function(){
				let sx=0, sy=0, st=0, tracking=false;
				const overlay=document.getElementById('calendarOverlay');
				overlay.addEventListener('touchstart', function(e){
					if(calDragActive){ tracking=false; return; }
					const scroller=e.target.closest('#calTgScroll');
					if(!scroller || (calView!=="day" && calView!=="week")){ tracking=false; return; }
					const t=e.touches[0]; if(!t) return;
					sx=t.clientX; sy=t.clientY; st=Date.now(); tracking=true;
				}, { passive:true });
				overlay.addEventListener('touchend', function(e){
					if(!tracking) return; tracking=false;
					if(calDragActive) return;
					const t=e.changedTouches[0]; if(!t) return;
					const dx=t.clientX-sx, dy=t.clientY-sy, dt=Date.now()-st;
					if(dt>700) return; // cok yavas -- kasitli kaydirma degil, birakildi
					if(Math.abs(dx)<60 || Math.abs(dx)<Math.abs(dy)*1.5) return; // yeterince yatay/uzun degil
					calShift(dx<0 ? 1 : -1);
				}, { passive:true });
			})();

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
					updateTestModeBanner();
					// Test Modu ACILDIGINDA veya KAPANDIGINDA Ctrl+Z yigini temizlenir -- aksi halde
					// production'da yapilan bir islemin "before/after" kaydi, mod degistikten sonra
					// test/ (veya gercek) veriye yanlislikla uygulanabilirdi. Bu, testModeEnabled'in
					// TEK degistigi nokta oldugu icin (setTestMode() de bu listener'i tetikleyerek
					// buraya duser) tum client'lar icin ayni sekilde calisir.
					if (typeof undoStack !== "undefined") undoStack = [];
					// Zaten açık dinleyiciler yeni yola (test/ ya da gerçek) kendiliğinden geçmez --
					// mod her değiştiğinde ikisi de yeniden bağlanır (attachListener/attachEventsListener
					// kendi eski referanslarını off() ile bırakıp yenisine geçer, sayfa yenilenmez).
					attachListener();
					attachEventsListener();
					attachLiveSelectionListener();
				}, function(err) { console.error("Test modu durumu okunamadı:", err); });
			}
			function updateTestModeBanner() {
				const sw = document.getElementById("testModeSwitch"); if (sw) sw.checked = testModeEnabled;
				const banner = document.getElementById("testModeBanner"); if (banner) banner.style.display = testModeEnabled ? "flex" : "none";
				document.body.classList.toggle("test-mode-active", testModeEnabled); // şerit sabit konumlu, header'ın üstüne binmesin diye body'ye üst boşluk eklenir
				const testEl = document.getElementById("akTestMode");
				if (testEl) { testEl.textContent = testModeEnabled ? "Açık" : "Kapalı"; document.getElementById("akTestModeKpi").classList.toggle("ak-warn", testModeEnabled); }
			}
			async function setTestMode(on) {
				if (!requireAdmin()) { updateTestModeBanner(); return; }
				if (!database) { showToast("Veritabanı bağlı değil!", "error"); updateTestModeBanner(); return; }
				try {
					if (on) { showLoading("Test ortamı hazırlanıyor…"); await cloneRealDataToTestMode(); hideLoading(); }
					await database.ref("ayarlar/testModuAcik").set(!!on);
				}
				catch (err) { hideLoading(); console.error("Test modu değiştirilemedi:", err); showToast("Paylaşımlı Test Ortamı değiştirilemedi.", "error"); updateTestModeBanner(); }
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
					if (!logKey) console.error("Log kaydı yazılamadı: currentUser tanımsız.");
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
					if (!logKey) console.error("Log kaydı yazılamadı: currentUser tanımsız.");
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

			// PIN ile hızlı hesap geçişi. Şifre Firebase'e YAZILMAZ -- sadece bu tarayıcının
			// localStorage'ında, PIN'den türetilen bir AES-GCM anahtarıyla şifreli tutulur, bu
			// yüzden gerçekten "aynı cihaz" ile sınırlıdır (kullanıcı isteği).
			const QUICK_ACCOUNTS_KEY = "omuProtokolQuickAccounts";
			function getQuickAccounts(){ try { return JSON.parse(localStorage.getItem(QUICK_ACCOUNTS_KEY) || "[]"); } catch(e) { return []; } }
			function saveQuickAccounts(list){ try { localStorage.setItem(QUICK_ACCOUNTS_KEY, JSON.stringify(list)); } catch(e) {} }
			function b64FromBytes(bytes){ return btoa(String.fromCharCode.apply(null, bytes)); }
			function bytesFromB64(b64){ return Uint8Array.from(atob(b64), function(c){ return c.charCodeAt(0); }); }
			async function pinDeriveKey(pin, saltBytes){
				const enc = new TextEncoder();
				const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveKey"]);
				return crypto.subtle.deriveKey(
					{ name: "PBKDF2", salt: saltBytes, iterations: 100000, hash: "SHA-256" },
					keyMaterial, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
				);
			}
			async function pinEncryptPassword(pin, password){
				const salt = crypto.getRandomValues(new Uint8Array(16));
				const iv = crypto.getRandomValues(new Uint8Array(12));
				const key = await pinDeriveKey(pin, salt);
				const cipherBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, new TextEncoder().encode(password));
				return { salt: b64FromBytes(salt), iv: b64FromBytes(iv), cipher: b64FromBytes(new Uint8Array(cipherBuf)) };
			}
			async function pinDecryptPassword(pin, rec){
				const key = await pinDeriveKey(pin, bytesFromB64(rec.salt));
				const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytesFromB64(rec.iv) }, key, bytesFromB64(rec.cipher));
				return new TextDecoder().decode(plainBuf);
			}
			function logAccountEvent(who, email, actionLabel){
				if (!database) return;
				database.ref(dbPath("logs/hesap")).push({ by: who, email: email, action: actionLabel, target: "", timestamp: firebase.database.ServerValue.TIMESTAMP }).catch(function(){});
			}
			function openPinSwitchModal(){
				renderQuickAccountsList();
				const linkSection = document.getElementById("pinLinkSection");
				if (linkSection) linkSection.style.display = currentUser ? "" : "none";
				document.getElementById("pinSwitchModalBg").classList.add("open");
			}
			function closePinSwitchModal(){ document.getElementById("pinSwitchModalBg").classList.remove("open"); }
			function renderQuickAccountsList(){
				const wrap = document.getElementById("pinAccountsList");
				const accounts = getQuickAccounts();
				if (!accounts.length) { wrap.innerHTML = '<p class="hint">Bu cihaza henüz bağlı hesap yok.</p>'; return; }
				wrap.innerHTML = accounts.map(function(a, i){
					return '<div class="pin-account-row">' +
						'<div class="pin-account-name">' + escapeHtml(a.displayName || a.email) + '</div>' +
						'<input type="password" inputmode="numeric" maxlength="6" class="pin-input" id="pinInput_' + i + '" placeholder="PIN">' +
						'<button class="btn btn-primary" type="button" onclick="switchToQuickAccount(' + i + ')">Aç</button>' +
						'<button class="btn btn-danger-outline" type="button" onclick="removeQuickAccount(' + i + ')">Kaldır</button>' +
					'</div>';
				}).join("");
			}
			async function switchToQuickAccount(i){
				const accounts = getQuickAccounts();
				const acc = accounts[i]; if (!acc) return;
				const pinEl = document.getElementById("pinInput_" + i);
				const pin = pinEl ? pinEl.value.trim() : "";
				if (!/^\d{4,6}$/.test(pin)) { showToast("PIN 4-6 haneli rakam olmalı.", "error"); return; }
				try {
					const password = await pinDecryptPassword(pin, acc);
					await auth.signInWithEmailAndPassword(acc.email, password);
					closePinSwitchModal();
					showToast("Hesap değiştirildi: " + (acc.displayName || acc.email), "success");
					logAccountEvent(acc.displayName || acc.email, acc.email, "PIN ile hesap değiştirildi");
				} catch(e) {
					showToast("PIN hatalı veya bu hesap artık geçerli değil.", "error");
				}
			}
			function removeQuickAccount(i){
				const accounts = getQuickAccounts();
				const removed = accounts.splice(i, 1)[0];
				saveQuickAccounts(accounts);
				renderQuickAccountsList();
				if (removed) showToast((removed.displayName || removed.email) + " bu cihazdan kaldırıldı.", "success");
			}
			async function linkPinToCurrentAccount(){
				if (!currentUser) { showToast("Önce giriş yapmalısınız.", "error"); return; }
				const pin1 = document.getElementById("pinNew1").value.trim();
				const pin2 = document.getElementById("pinNew2").value.trim();
				const password = document.getElementById("pinLinkPassword").value;
				if (!/^\d{4,6}$/.test(pin1)) { showToast("PIN 4-6 haneli rakam olmalı.", "error"); return; }
				if (pin1 !== pin2) { showToast("PIN'ler eşleşmiyor.", "error"); return; }
				if (!password) { showToast("Şifrenizi girin (bir kereliğine doğrulama için).", "error"); return; }
				try {
					const cred = firebase.auth.EmailAuthProvider.credential(currentUser.email, password);
					await auth.currentUser.reauthenticateWithCredential(cred);
					const enc = await pinEncryptPassword(pin1, password);
					const who = ((currentUser.firstName || "") + " " + (currentUser.lastName || "")).trim() || currentUser.email;
					const accounts = getQuickAccounts().filter(function(a){ return a.email !== currentUser.email; });
					accounts.push(Object.assign({ email: currentUser.email, displayName: who }, enc));
					saveQuickAccounts(accounts);
					document.getElementById("pinNew1").value = ""; document.getElementById("pinNew2").value = ""; document.getElementById("pinLinkPassword").value = "";
					showToast("PIN tanımlandı.", "success");
					logAccountEvent(who, currentUser.email, "Bu cihaza PIN tanımlandı/güncellendi");
					renderQuickAccountsList();
				} catch(e) {
					showToast("Şifre doğrulanamadı.", "error");
				}
			}

			// Onboarding rehberi -- sadece protokol.html'de mevcut, ilk ziyarette bir kez açılır.
			const ONBOARDING_STEPS = [
				{ icon: "🗂️", title: "Protokol Kartları'na Hoş Geldiniz", text: "Kartlarda kişi/unvan/birim bilgisi var. Üstteki arama kutusu ve sol fakülte filtresiyle hızlıca bulabilirsin." },
				{ icon: "🗓️", title: "Etkinlik Takvimi", text: "Sağdaki takvim kutusuna tıklayınca tam sayfa takvime geçersin. Gün/Hafta/Ay/Yıl/Liste görünümleri var." },
				{ icon: "✏️", title: "Düzenleme Yetkisi", text: "Giriş yapmadan sadece görüntüleyebilirsin. Kayıt olup admin onayı alınca kart ekleme/düzenleme açılır." },
				{ icon: "🛠️", title: "Admin Paneli", text: "Sadece admin rolündeki kullanıcılar admin.html üzerinden kullanıcı yetkisi, log ve test modunu yönetebilir." }
			];
			let onboardingIdx = 0;
			function renderOnboardingStep(){
				const s = ONBOARDING_STEPS[onboardingIdx];
				document.getElementById("onboardingStepIcon").textContent = s.icon;
				document.getElementById("onboardingStepTitle").textContent = s.title;
				document.getElementById("onboardingStepText").textContent = s.text;
				document.getElementById("onboardingPrevBtn").style.display = onboardingIdx === 0 ? "none" : "";
				document.getElementById("onboardingNextBtn").textContent = onboardingIdx === ONBOARDING_STEPS.length - 1 ? "Bitir" : "İleri";
				document.getElementById("onboardingDots").innerHTML = ONBOARDING_STEPS.map(function(_, i){
					return '<span class="onboarding-dot' + (i === onboardingIdx ? ' active' : '') + '"></span>';
				}).join("");
			}
			function onboardingStep(dir){
				const next = onboardingIdx + dir;
				if (next >= ONBOARDING_STEPS.length) { closeOnboarding(true); return; }
				onboardingIdx = Math.max(0, Math.min(ONBOARDING_STEPS.length - 1, next));
				renderOnboardingStep();
			}
			function skipOnboarding(){ closeOnboarding(true); }
			function closeOnboarding(markSeen){
				document.getElementById("onboardingModalBg").classList.remove("open");
				if (markSeen) { try { localStorage.setItem("omuProtokolOnboardingSeen", "1"); } catch(e) {} }
			}
			function openOnboarding(){
				const el = document.getElementById("onboardingModalBg");
				if (!el) return;
				onboardingIdx = 0;
				renderOnboardingStep();
				el.classList.add("open");
			}
			// Footer'daki "rehberi tekrar göster" -- her zaman zorla açar, seen bayrağını değiştirmez.
			function replayOnboarding(){ openOnboarding(); }
			(function maybeShowOnboarding(){
				if (!document.getElementById("onboardingModalBg")) return;
				let seen = false;
				try { seen = localStorage.getItem("omuProtokolOnboardingSeen") === "1"; } catch(e) {}
				if (!seen) setTimeout(openOnboarding, 400);
			})();
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

			// Haber çıktısı seçim hafızası: sayfa yenilense/sekme değiştirilse de son seçilen
			// kişiler kaybolmasın diye localStorage'da tutulur. Sadece "Haber Çıktısı Al" AÇILIRKEN
			// geri yüklenir (o anki listede hâlâ var olan id'lerle sınırlı) -- kapatma/iptal bir
			// sonraki açılışın hafızasını SİLMEZ, kullanıcı yanlışlıkla iptale basarsa seçim kaybolmaz.
			const NEWS_SELECTION_KEY = "omuProtokolNewsSelection";
			function saveNewsSelection(){ try { localStorage.setItem(NEWS_SELECTION_KEY, JSON.stringify(newsSelection)); } catch(e) {} }
			function loadNewsSelection(){ try { const arr = JSON.parse(localStorage.getItem(NEWS_SELECTION_KEY) || "[]"); return Array.isArray(arr) ? arr.filter(id => people[id]) : []; } catch(e) { return []; } }
			function toggleNewsMode() {
				if (isReorderMode) toggleReorderMode(); if (isBulkMode) toggleBulkDeleteMode();
				if (mode !== "aktif") document.querySelector('[data-mode="aktif"]').click();

				isNewsMode = !isNewsMode; newsSelection = isNewsMode ? loadNewsSelection() : []; newsPeopleOverride = null; newsEventContext = null;
				const btnNews = document.getElementById("newsModeBtn"); const btnExec = document.getElementById("executeNewsBtn"); const btnCancel = document.getElementById("cancelNewsBtn");
				const addBtn = document.getElementById("addBtn"); const reorderBtn = document.getElementById("reorderBtn"); const expBtn = document.getElementById("exportBtn"); const impBtn = document.getElementById("importBtn");
				const btnToplu = document.getElementById("bulkDeleteModeBtn"); const tabs = document.querySelectorAll("#statusToggle button");
				const search = document.getElementById("search");

				if (isNewsMode) {
					btnNews.style.display = "none"; btnExec.style.display = "inline-flex"; btnCancel.style.display = "inline-flex";
					btnExec.textContent = "Taslağı Oluştur (" + newsSelection.length + ")";
					[addBtn, reorderBtn, expBtn, impBtn, btnToplu].forEach(b => { if(b) b.style.display = "none"; });
					tabs.forEach(t => t.disabled = true);
					showToast(newsSelection.length ? ("Önceki seçiminiz hatırlandı (" + newsSelection.length + " kişi). Değiştirebilirsiniz.") : "Metinde geçecek isimleri seçin (Arama yapabilirsiniz).", "success");
				} else {
					btnNews.style.display = "inline-flex"; btnExec.style.display = "none"; btnCancel.style.display = "none";
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
						if (!logKey) console.error("Log kaydı yazılamadı: currentUser tanımsız.");
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
						actionHtml = '<div style="text-align:center; font-size:11px; font-weight:600; color:var(--muted); margin-top:auto; padding:7px; background:#f0f0f0; border-radius:7px;">' + selectionHint + '</div>';
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
				"Fakülte Dekanları",
				"Enstitü ve Yüksekokul Müdürleri",
				"Dekan Yardımcıları ve Müdür Yardımcıları",
				"Profesörler",
				"Doçentler",
				"Doktor Öğretim Üyeleri",
				"Bölüm Başkanları ve Anabilim Dalı Başkanları",
				"Öğretim Görevlileri ve Araştırma Görevlileri",
				"Genel Sekreter ve Daire Başkanları"
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

function openAddModal(){ if (!requireEdit()) return; closeFacultySheet(); editIndex = null; resetForm(); document.getElementById("modalTitle").textContent = "Yeni Kişi Ekle"; document.getElementById("editDeleteActions").style.display = "none"; document.getElementById("verifyField").style.display = "none"; document.getElementById("successorTriggerWrap").style.display = "none"; document.getElementById("historyToggleBtn").style.display = "none"; tempGorevGecmisi = []; renderRankReferencePanel(); renderFacultyPickerField([]); document.getElementById("modalBg").classList.add("open"); loadSuggestionPool().then(populateSuggestionDatalists); }
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
			document.getElementById("modalTitle").textContent = "Kaydı Düzenle"; document.getElementById("editDeleteActions").style.display = "flex"; /* successorTriggerWrap artik refreshStatusReasonBlock()/onStatusReasonChange() tarafindan yonetiliyor, burada kosulsuz acilmiyor */ renderRankReferencePanel(); renderFacultyPickerField(p.faculties || []);
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

			// ---- Görev Geçmişi / Etkinlik Geçmişi paneli ----
			// successor-panel'in AYNADAKİ (solda açılan) hâli: mevcut düzenleme ekranının
			// SOLUNDA, geçmiş görevleri (vekâleten dahil, tarih araligiyla) eklemeyi ve o
			// kişinin katıldığı etkinlikleri (salt-okunur, calEvents'ten türetilir) gösterir.
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
			// Bir kisinin katildigi etkinlikleri calEvents'ten tarar -- SADECE ISIM eslesmesiyle
			// (unvan DEGIL): kisinin unvani zaman icinde degismis olabilir, unvanla eslestirme
			// gecmis katilimlari sessizce kaybettirirdi. En yeni etkinlik en basta.
			function personAttendedEvents(p){
				if (!p || !p.name) return [];
				const target = String(p.name).trim().toLocaleLowerCase("tr");
				return calEventList().filter(function(e){
					return Array.isArray(e.katilimcilar) && e.katilimcilar.some(function(a){
						return a && String(a.name || "").trim().toLocaleLowerCase("tr") === target;
					});
				}).reverse();
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

				const evEl = document.getElementById("historyEventList");
				const p = (editIndex !== null) ? people[editIndex] : null;
				const evs = personAttendedEvents(p);
				evEl.innerHTML = evs.length ? evs.map(function(e){
					const ty = evType(e.tur);
					return '<div class="hg-event-row"><span class="hg-event-date">' + escapeHtml(fmtTrDate(e.tarih)) + '</span> ' +
						'<span class="hg-event-tag" style="background:' + ty.bg + '; color:' + ty.renk + ';">' + escapeHtml(ty.ad) + '</span> ' +
						escapeHtml(e.ad || "") + '</div>';
				}).join("") : '<p class="hint">Katıldığı etkinlik bulunamadı.</p>';
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
						if (!logKey1) console.error("Log kaydı yazılamadı: currentUser tanımsız.");
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
			// people artık push-ID -> kayıt şeklinde bir NESNE; dışa aktarım bu nesneyi ID'leriyle
			// BİRLİKTE indirir. Eski (dizi tabanlı) yedeklerle geriye dönük uyumluluk importJSON()'da
			// sağlanır (Array.isArray kontrolü ile hem eski hem yeni format kabul edilir).
			function exportJSON(){ if (!requireAdmin()) return; const fileName = currentListKey === "universite" ? "Üniversite-Protokol-Listesi.json" : "İl-Protokol-Listesi.json"; downloadFile(JSON.stringify(people, null, 2), fileName, "application/json"); showToast("JSON yedeği indirildi."); }
			function importJSON(e){
			if (!requireAdmin()) { e.target.value = ""; return; }
			if (!database || !LIST_PATHS[currentListKey]) { showToast("Veritabanı bağlı değil!", "error"); e.target.value = ""; return; }
			const file = e.target.files[0]; if(!file) return; const reader = new FileReader();
			reader.onload = async function(ev) {
				// Girdi doğrulanmadan kabul edilirse: rank:null → Number(null)=0 olup kişiyi Rektör'ün üstüne çıkarıyor,
				// rank:"abc" → NaN olup TÜM içe aktarmayı sessizce çöpe atıyor, status/tarih alanları ise HTML enjeksiyonuna açık kalıyordu.
				const VALID_STATUS = { aktif: 1, pasif: 1, silindi: 1 };
				function cleanRank(v, fallback) {
					if (v === undefined || v === null || v === "") return (fallback === undefined ? "" : fallback);
					const n = Number(v);
					return (isNaN(n) || n < 0) ? (fallback === undefined ? "" : fallback) : n;
				}
				function cleanDate(v) { const s = String(v === undefined || v === null ? "" : v).trim(); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ""; }
				// Gorev gecmisi de dosyadan geliyor -- diger alanlar gibi DOGRULANARAK alinir:
				// sadece bilinen uc alan (unvan/baslangic/bitis), tarihler formatlanmis, unvani
				// bos olan satirlar atilir. Bilinmeyen alanlar veritabanina sizmaz.
				function sanitizeGorevGecmisi(arr) {
					return arr.map(function (g) {
						if (!g || typeof g !== "object") return null;
						const unvan = String(g.unvan === undefined || g.unvan === null ? "" : g.unvan).trim();
						if (!unvan) return null;
						return { unvan: unvan, baslangic: cleanDate(g.baslangic), bitis: cleanDate(g.bitis) };
					}).filter(Boolean);
				}
				const snapshotBefore = JSON.parse(JSON.stringify(people));
				try{
				const parsed = JSON.parse(ev.target.result);
				// Hem ESKİ dizi-tabanlı bir yedek (exportJSON()'un eski çıktısı / dizi tabanlı
				// Firebase yapısından alınmış bir dışa aktarım) hem de YENİ push-ID'li nesne formatı
				// (bu ekrandan yeni indirilmiş) kabul edilir.
				let data;
				if (Array.isArray(parsed)) { data = parsed; }
				else if (parsed && typeof parsed === "object") { data = Object.keys(parsed).map(function(k){ return parsed[k]; }); }
				else { throw new Error("Format hatalı"); }
				let matchCount = 0; let newCount = 0; let skipped = 0;
				// İçe aktarma modu: varsayılan (ve önerilen) davranış BİRLEŞTİR'dir -- eşleşen
				// kayıtlar güncellenir, yeni olanlar eklenir, listedeki diğer kayıtlara dokunulmaz.
				// "Tamamen Geri Yükle" ise MEVCUT TÜM listeyi SİLİP sadece dosyadakini yazar; geri
				// dönüşü olmadığı için İKİNCİ, ayrı bir onayla korunur.
				const fullRestoreWanted = confirm(
					"İçe Aktarma Modu\n\n" +
					"TAMAM: Tamamen Geri Yükle — mevcut listedeki TÜM kayıtlar SİLİNİR, sadece bu dosyadaki kayıtlar kalır (GERİ ALINAMAZ).\n" +
					"İPTAL: Birleştir (varsayılan) — eşleşen kayıtlar güncellenir, yeni olanlar eklenir, listedeki diğer kayıtlara dokunulmaz."
				);
				if (fullRestoreWanted) {
					if (!confirm("TAMAMEN GERİ YÜKLE seçildi. Mevcut " + Object.keys(people).length + " kayıt SİLİNECEK ve yerine bu dosyadaki kayıtlar yazılacak. Bu işlem GERİ ALINAMAZ. Devam edilsin mi?")) {
						showToast("İçe aktarma iptal edildi.", "warn"); return;
					}
					const freshPeople = {};
					for (var fi = 0; fi < data.length; fi++) {
						const fitem = data[fi]; if (!fitem || typeof fitem !== "object" || !fitem.name || !fitem.title) { skipped++; continue; }
						const fname = String(fitem.name).trim(); const ftitle = String(fitem.title).trim();
						const fstatus = (fitem.status && VALID_STATUS[fitem.status]) ? fitem.status : "aktif";
						const fid = database.ref(dbPath(LIST_PATHS[currentListKey])).push().key;
						const freshRecord = {
							prefix: fitem.prefix ? String(fitem.prefix) : "", name: fname, title: ftitle, unit: fitem.unit ? String(fitem.unit) : "",
							status: fstatus, rank: cleanRank(fitem.rank),
							photo: safePhotoUrl(fitem.photo), start: cleanDate(fitem.start), end: cleanDate(fitem.end), note: fitem.note ? String(fitem.note) : ""
						};
						const ford = cleanRank(fitem.order); if (ford !== "") freshRecord.order = ford;
						if (Array.isArray(fitem.faculties)) freshRecord.faculties = fitem.faculties.map(String);
						// gorevGecmisi ESKIDEN HIC KOPYALANMIYORDU: exportJSON() tum "people" nesnesini
						// (gorev gecmisi dahil) yazdigi icin YEDEK DOSYASINDA veri VARDI, ama "Tamamen
						// Geri Yukle" onu sessizce dusuruyordu -- yani felaket kurtarma yolunda, tam da
						// en cok ihtiyac duyulan anda her kisinin gorev gecmisi kaliciyor kayboluyordu.
						if (Array.isArray(fitem.gorevGecmisi)) freshRecord.gorevGecmisi = sanitizeGorevGecmisi(fitem.gorevGecmisi);
						freshPeople[fid] = freshRecord; newCount++;
					}
					if (!Object.keys(freshPeople).length) { showToast(skipped ? (skipped + " satırın hepsi geçersiz, içe aktarılan kayıt yok.") : "İçe aktarılacak geçerli kayıt yok.", "error"); return; }
					people = freshPeople;
					const restoreLabel = "JSON'dan TAMAMEN GERİ YÜKLENDİ (" + newCount + " kayıt" + (skipped ? ", " + skipped + " geçersiz satır atlandı" : "") + ")";
					// patch verilmez -- saveData() bu durumda tüm "people" nesnesini TEK .set() ile yazar.
					const restoreOk = await saveData(restoreLabel, undefined);
					if (!restoreOk) { people = snapshotBefore; render(); return; }
					showToast(newCount + " kayıtla liste tamamen değiştirildi." + (skipped ? (" " + skipped + " geçersiz satır atlandı.") : ""));
					render();
					return;
				}
				// Tüm listeyi .set() ile yeniden yazmak yerine, sadece dokunulan alanlar/kayıtlar
				// id (veya "id/alan") -> değer şeklinde tek bir .update() patch'inde toplanır --
				// içe aktarma sırasında başka bir editörün eklediği bir kayıt asla kaybolmaz.
				const patch = {};
				for (var i = 0; i < data.length; i++) {
					const item = data[i]; if(!item || typeof item !== "object" || !item.name || !item.title) { skipped++; continue; }
					const name = String(item.name).trim(); const title = String(item.title).trim();
					const existingId = Object.keys(people).find(function(id) { return String(people[id].name || "").trim() === name && String(people[id].title || "").trim() === title; });
					const status = (item.status && VALID_STATUS[item.status]) ? item.status : "aktif";
					if (existingId) {
						matchCount++;
						people[existingId].rank = cleanRank(item.rank, people[existingId].rank);
						people[existingId].status = status;
						patch[existingId + "/rank"] = people[existingId].rank === "" ? null : people[existingId].rank;
						patch[existingId + "/status"] = status;
						if(item.prefix) { people[existingId].prefix = String(item.prefix); patch[existingId + "/prefix"] = people[existingId].prefix; }
						if(item.unit !== undefined && item.unit !== null) { people[existingId].unit = String(item.unit); patch[existingId + "/unit"] = people[existingId].unit; }
						if(Array.isArray(item.faculties)) { people[existingId].faculties = item.faculties.map(String); patch[existingId + "/faculties"] = people[existingId].faculties; }
					} else {
						newCount++;
						// Yeni her kayıt için GERÇEK bir Firebase push-ID üretilir (henüz yazılmadan
						// sadece anahtar alınır) -- iki editör aynı anda içe aktarsa bile ÇAKIŞMAZ.
						const newId = database.ref(dbPath(LIST_PATHS[currentListKey])).push().key;
						const newRecord = {
							prefix: item.prefix ? String(item.prefix) : "", name: name, title: title, unit: item.unit ? String(item.unit) : "",
							status: status, rank: cleanRank(item.rank),
							photo: safePhotoUrl(item.photo), start: cleanDate(item.start), end: cleanDate(item.end), note: item.note ? String(item.note) : "", isNew: true
						};
						// order alanı eskiden atlanıyordu; bu yüzden içe aktarılan kişilerin sıra içi dizilimi kayboluyordu.
						const ord = cleanRank(item.order); if (ord !== "") newRecord.order = ord;
						if (Array.isArray(item.faculties)) newRecord.faculties = item.faculties.map(String);
						// Birlestirme dalinda da YENI eklenen kayitlarin gorev gecmisi aliniyor (mevcut
						// kayitlarinki zaten veritabaninda duruyor, bu dal ona DOKUNMAZ).
						if (Array.isArray(item.gorevGecmisi)) newRecord.gorevGecmisi = sanitizeGorevGecmisi(item.gorevGecmisi);
						people[newId] = newRecord;
						patch[newId] = newRecord;
					}
				}
				if (!Object.keys(patch).length) { showToast(skipped ? (skipped + " satırın hepsi geçersiz, içe aktarılan kayıt yok.") : "İçe aktarılacak geçerli kayıt yok.", "error"); return; }
				const importLabel = "JSON içe aktarıldı (" + matchCount + " kişi güncellendi, " + newCount + " kişi eklendi)";
				// Bulut yazımı başarısızsa yerel kopya geri alınır; aksi hâlde ekranda duran veriler sunucuda yoktu.
				const ok = await saveData(importLabel, undefined, patch);
				if (!ok) { people = snapshotBefore; render(); return; }
				const skipNote = skipped ? (" " + skipped + " geçersiz satır atlandı.") : "";
				if(matchCount > 0) showToast(matchCount + " kişi güncellendi. " + newCount + " kişi eklendi." + skipNote); else showToast(newCount + " yeni kişi başarıyla eklendi." + skipNote);
				}catch(err){ people = snapshotBefore; render(); showToast("Dosya hatalı veya bozuk!", "error"); }
			}; reader.readAsText(file); e.target.value = "";
			}

			// ---- Admin: Etkinlik Takvimi JSON Yedekleme / Geri Yükleme ----
			// Amaç: admin loglarda bir şey denerken (toplu silme/ekleme, hatalı içe aktarma vb.) yanlışlıkla
			// bozulan etkinlik takvimini, önceden indirilmiş bir JSON yedekten eski hâline döndürebilsin.
			// Not: calEvents zaten Firebase'in "etkinlikler" dalıyla birebir aynı şekle sahip (pushKey -> etkinlik),
			// bu yüzden dışa aktarımda doğrudan onu kullanmak, geri yüklemede de birebir onu yazmak yeterli.
			function exportEventsJSON(){
				if (!requireAdmin()) return;
				const payload = { yedekTarihi: new Date().toISOString(), kayitSayisi: Object.keys(calEvents).length, etkinlikler: calEvents };
				downloadFile(JSON.stringify(payload, null, 2), "Etkinlik-Takvimi-Yedek-" + dKey(new Date()) + ".json", "application/json");
				showToast("Etkinlik JSON yedeği indirildi.");
			}
			async function importEventsJSON(e){
				if (!requireAdmin()) { e.target.value = ""; return; }
				const file = e.target.files[0]; if(!file) return; const reader = new FileReader();
				reader.onload = async function(ev){
					try{
						const parsed = JSON.parse(ev.target.result);
						// Hem bu ekrandan indirilen zarflı ({yedekTarihi, etkinlikler}) hem de Firebase Console'dan
						// doğrudan indirilmiş ham "etkinlikler" dalı (pushKey -> etkinlik) kabul edilir.
						const raw = (parsed && typeof parsed === "object" && !Array.isArray(parsed) && parsed.etkinlikler && typeof parsed.etkinlikler === "object") ? parsed.etkinlikler : parsed;
						if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Format hatalı");
						const clean = {}; let kept = 0, skipped = 0;
						Object.keys(raw).forEach(function(key){
							const item = raw[key];
							// Ad ve geçerli bir tarih zorunlu; diğer her şey eksikse boş/varsayılan değerle tamamlanır
							// (evType()/evStatus() zaten bilinmeyen tür/durum anahtarlarında güvenli varsayılana düşüyor).
							if (!item || typeof item !== "object" || !item.ad || !parseKey(item.tarih)) { skipped++; return; }
							clean[key] = {
								ad: String(item.ad).trim(), tur: item.tur ? String(item.tur) : "diger", durum: item.durum ? String(item.durum) : "planlandi",
								tarih: String(item.tarih), saat: item.saat ? String(item.saat) : "", bitisSaat: item.bitisSaat ? String(item.bitisSaat) : "",
								yer: item.yer ? String(item.yer) : "", birim: item.birim ? String(item.birim) : "",
								planlayan: item.planlayan ? String(item.planlayan) : "", gorevli: item.gorevli ? String(item.gorevli) : "",
								// katilimcilar dizisi de digerleri gibi normalize edilir; ham nesne gecirmek
								// bozuk yedeklerde beklenmedik alanlari veritabanina tasiyordu.
								katilimcilar: (Array.isArray(item.katilimcilar) ? item.katilimcilar : []).filter(function(a){ return a && typeof a === "object"; }).map(function(a){ return { prefix: String(a.prefix || ""), name: String(a.name || ""), title: String(a.title || ""), rank: (a.rank !== undefined && a.rank !== null) ? a.rank : "", kaynak: a.kaynak === "il" ? "il" : "universite" }; }),
								// "locked" burada yazilmazsa yedekten geri yuklemede TUM etkinliklerin
								// kilidi sessizce acilir (yanlislikla surukleme korumasi kaybolur).
								locked: !!item.locked,
								rozetler: Array.isArray(item.rozetler) ? item.rozetler.filter(function(k){ return EVENT_BADGES.some(function(b){ return b.key===k; }); }) : [],
							haberKaynagi: ["İHA","AA","DHA","ANKA"].indexOf(item.haberKaynagi) !== -1 ? item.haberKaynagi : "",
								arsiv: safeLinkUrl(item.arsiv), not: item.not ? String(item.not) : "",
								// olusturmaTs yedekte VARSA (tarihsel deger) korunur; yoksa sunucu saatiyle
								// doldurulur. guncellemeTs bu geri yukleme anini yansitir, o yuzden her
								// zaman sunucu saatiyle yazilir.
								olusturan: item.olusturan ? String(item.olusturan) : "", olusturmaTs: item.olusturmaTs || firebase.database.ServerValue.TIMESTAMP, guncellemeTs: firebase.database.ServerValue.TIMESTAMP
							};
							kept++;
						});
						if (!kept) { showToast("Yedekte geçerli etkinlik bulunamadı.", "error"); e.target.value = ""; return; }
						const mevcutSayi = Object.keys(calEvents).length;
						const confirmMsg = kept + " etkinlik içeren bu yedek, veritabanındaki MEVCUT TÜM ETKİNLİKLERİN (" + mevcutSayi + " kayıt) YERİNE GEÇECEK. Bu işlem geri alınamaz. Devam edilsin mi?";
						if (!confirm(confirmMsg)) { e.target.value = ""; return; }
						if (!database) { showToast("Veritabanı bağlı değil!", "error"); e.target.value = ""; return; }
						await database.ref(dbPath("etkinlikler")).set(clean);
						// Log yazımı artık AWAIT edilir -- veri başarıyla yazılsa bile log sessizce
						// kaybolmasın diye (audit #6); hata olursa konsola VE kullanıcıya bildirilir.
						if (currentUser) {
							try {
								await database.ref(dbPath("logs/etkinlik")).push({
									by: ((currentUser.firstName||"")+" "+(currentUser.lastName||"")).trim() || currentUser.email,
									email: currentUser.email, action: "Etkinlik takvimi JSON yedekten geri yüklendi (" + kept + " kayıt" + (skipped ? ", " + skipped + " geçersiz satır atlandı" : "") + ")",
									target: "", timestamp: firebase.database.ServerValue.TIMESTAMP
								});
							} catch (logErr) { console.error("Yedekleme log kaydı yazılamadı:", logErr); showToast("Yedek geri yüklendi ancak işlem günlüğüne yazılamadı.", "warn"); }
						}
						const skipNote = skipped ? (" " + skipped + " geçersiz satır atlandı.") : "";
						showToast(kept + " etkinlik geri yüklendi." + skipNote);
					}catch(err){ showToast("Dosya hatalı veya bozuk!", "error"); }
					e.target.value = "";
				}; reader.readAsText(file);
			}

/* ================= ETKİNLİK TAKVİMİ ================= */
// Etkinlikler Firebase'de "etkinlikler" dalında, push anahtarlarıyla tutulur.
// Dizi indeksi kullanmıyoruz: iki kişi aynı anda etkinlik eklerse birbirini ezmesin diye.
const EVENT_TYPES = [
	{ key:"acilis",    ad:"Açılış Töreni",        renk:"var(--today)", bg:"#ffedd5" },
	{ key:"konferans", ad:"Konferans",              renk:"#1d4ed8", bg:"#dbeafe" },
	{ key:"panel",     ad:"Panel",                  renk:"#a21caf", bg:"#fae8ff" },
	{ key:"calistay",  ad:"Çalıştay",                renk:"#65a30d", bg:"#ecfccb" },
	{ key:"ziyaret",   ad:"Protokol Ziyareti",    renk:"#a16207", bg:"#fef3c7" },
	{ key:"imza",      ad:"Protokol İmza Töreni",          renk:"#7c3aed", bg:"#ede9fe" },
	{ key:"mezuniyet", ad:"Mezuniyet Töreni",     renk:"#be123c", bg:"#ffe4e6" },
	{ key:"odul",      ad:"Ödül Töreni",          renk:"#b45309", bg:"#fef0c7" },
	{ key:"basin",     ad:"Basın Toplantısı",     renk:"#0369a1", bg:"#e0f2fe" },
	{ key:"sergi",     ad:"Sergi / Kültür-Sanat", renk:"#0f766e", bg:"#ccfbf1" },
	{ key:"spor",      ad:"Spor Etkinliği",       renk:"#15803d", bg:"#dcfce7" },
	{ key:"gorevdegisimi", ad:"Görev Değişimi",  renk:"#4338ca", bg:"#e0e7ff" },
	{ key:"akademikbasari", ad:"Akademik Başarı",       renk:"#047857", bg:"#d1fae5" },
	{ key:"kariyer",        ad:"Kariyer Etkinliği",     renk:"#0e7490", bg:"#cffafe" },
	{ key:"topluluk",       ad:"Öğrenci Toplulukları",  renk:"#be185d", bg:"#fce7f3" },
	{ key:"saglik",         ad:"Sağlık Etkinliği",      renk:"#b91c1c", bg:"#fee2e2" },
	{ key:"uluslararasi",   ad:"Uluslararası Etkinlik", renk:"#334155", bg:"#f1f5f9" },
	{ key:"yesiluniversite",ad:"Yeşil Üniversite",      renk:"#166534", bg:"#dcfce7" },
	{ key:"toplanti",  ad:"Toplantı",              renk:"#475569", bg:"#e2e8f0" },
	{ key:"bayram",    ad:"Ulusal ve Resmî Bayramlar", renk:"#b91c1c", bg:"#fee2e2" },
	{ key:"diger",     ad:"Diğer",                renk:"#57534e", bg:"#f1efec" }
];
// Etkinlik rozetleri (çoklu seçilebilir, EVENT_TYPES'tan bağımsız). Takvim kartlarında
// belirgin küçük etiketler olarak gösterilir (bkz. lockIconHtml yanındaki badgeHtml).
const EVENT_BADGES = [
	{ key:"basina_kapali", ad:"Basına Kapalı", renk:"#b91c1c", bg:"#fee2e2" },
	{ key:"dis_katilimli", ad:"Dış Katılımlı", renk:"#1d4ed8", bg:"#dbeafe" },
	{ key:"canli_yayin",   ad:"Canlı Yayın",   renk:"#b45309", bg:"#fef3c7" }
];
function badgeHtml(e){
	const keys = Array.isArray(e.rozetler) ? e.rozetler : [];
	if (!keys.length) return "";
	return '<span class="cal-badge-wrap">' + keys.map(function(k){
		const b = EVENT_BADGES.find(function(x){ return x.key === k; }); if (!b) return "";
		return '<span class="cal-badge" style="background:' + b.bg + '; color:' + b.renk + ';">' + escapeHtml(b.ad) + '</span>';
	}).join("") + '</span>';
}
const EVENT_STATUS = [
	// renk: .cal-tag'de her zaman beyaz metinle (#fff) kullanılıyor (tema farketmez, bkz. .cal-tag{color:#fff}).
	// Eski #8a8f98 beyaz üstünde 3.25:1 idi (WCAG AA metin hedefi 4.5:1'in altında). #6b7280 ~4.83:1 verir,
	// aynı nötr gri tonunu korur (görsel fark minimal).
	{ key:"planlandi",  ad:"Planlandı",     renk:"#6b7280" },
	{ key:"cekildi",    ad:"Gerçekleşti",       renk:"#1d4ed8" },
	{ key:"haber",      ad:"Haber Yazıldı", renk:"#b45309" },
	{ key:"yayinlandi", ad:"Yayınlandı",    renk:"#15803d" },
	{ key:"iptal",      ad:"İptal",         renk:"#b03a3a" }
];
const CAL_DOW = ["Pzt","Sal","Çar","Per","Cum","Cmt","Paz"];
const CAL_DOW_MINI = ["P","S","Ç","P","C","C","P"];
const CAL_MONTHS = ["Ocak","Şubat","Mart","Nisan","Mayıs","Haziran","Temmuz","Ağustos","Eylül","Ekim","Kasım","Aralık"];
const CAL_HOUR_H = 48;   // bir saatlik satırın piksel yüksekliği
const CAL_GUTTER = 54;   // soldaki saat sütununun genişliği
// Telefonda 7 sütun ~48px kalıyor ve etkinlik adları okunmuyordu; dar ekranda 3 güne düşer.
function calDayCount(){
	if(calView==="day") return 1;
	return (window.matchMedia && window.matchMedia("(max-width:700px)").matches) ? 3 : 7;
}

let calEvents = {};              // { pushKey: etkinlik }
let calEventsReadErrorShown = false;
let activeEventsListenerRef = null; let activeEventsListenerCallback = null; let activeEventsListenerErrCallback = null; // Test Modu geçişinde eski yolu bırakıp yeniye bağlanmak için
let calView = "week";
let calAnchor = new Date();      // ana görünümde bakılan tarih
let calMiniAnchor = new Date();  // sol raydaki mini takvimin ayı
let calHiddenTypes = new Set();
let calHiddenStatus = new Set();
let calPeekedId = null;
let calEditingId = null;
let calAttendees = [];           // etkinlik formunda seçili katılımcılar
let calPressStaff = [];          // etkinlik formunda seçili basın görevlileri (isim dizisi)
let pressOfficerPool = [];       // admin tarafından "basın görevlisi" işaretlenmiş kullanıcılar: {uid,name}
let gorevliLoadToken = 0;        // ardışık modal açılışlarında eski bir yüklemenin geç gelip güncel seçimi ezmesini önler
let calSortableInstances = [];  // renderWeekView/renderMonthView'in olusturdugu Sortable orneklerinin yasam dongusu (person-list'teki sortableInstances'tan AYRI -- ayri IIFE kapsaminda)
let calDragLastXY = null;       // Sortable onMove sirasinda surekli guncellenen son bilinen isaretci konumu, onEnd'de yedek kaynak
let calWeekScrollKey = null;    // renderWeekView'in en son "hangi hafta/gun" icin kaydirma konumu uyguladigi -- ayni anahtar tekrar gelirse (ornegin bir surukleme sonrasi renderCalendar() TEKRAR cagrildiginda) konum SIFIRLANMAZ, kullanicinin bulundugu yerde kalir
let calWeekScrollTopPreserved = null; // body.innerHTML ile eski DOM silinmeden HEMEN once yakalanan scrollTop -- ayni gorunum tekrar render edilirse geri yuklenir
let eventDeleteTargetId = null;   // peek + duzenleme formu ortak silme onay modalinin hedef id'si
let undoStack = [];               // { type:'move'|'edit'|'create'|'delete', id, before, after, ts }
let undoCount = 0;                // bu oturumda kacinci Ctrl+Z geri almasi yapildigi (log metnine yazilir)
const UNDO_STACK_LIMIT = 20;

function evType(k){ for(var i=0;i<EVENT_TYPES.length;i++) if(EVENT_TYPES[i].key===k) return EVENT_TYPES[i]; return EVENT_TYPES[EVENT_TYPES.length-1]; }
function evStatus(k){ for(var i=0;i<EVENT_STATUS.length;i++) if(EVENT_STATUS[i].key===k) return EVENT_STATUS[i]; return EVENT_STATUS[0]; }

/* --- Tarih yardımcıları: hepsi YEREL saatle çalışır, UTC kayması olmaz --- */
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
function addDays(d,n){ const x=new Date(d.getFullYear(),d.getMonth(),d.getDate()); x.setDate(x.getDate()+n); return x; }
function startOfWeek(d){ const x=new Date(d.getFullYear(),d.getMonth(),d.getDate()); const wd=(x.getDay()+6)%7; return addDays(x,-wd); }
function isSameDay(a,b){ return a && b && a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate(); }
function todayDate(){ const n=new Date(); return new Date(n.getFullYear(),n.getMonth(),n.getDate()); }
function hmToMin(s){ const a=String(s||"").split(":"); if(a.length<2) return null; const h=Number(a[0]), m=Number(a[1]); if(isNaN(h)||isNaN(m)) return null; if(h<0||h>23||m<0||m>59) return null; return h*60+m; }
function minToHm(m){ return pad2(Math.floor(m/60)%24)+":"+pad2(m%60); }
function fmtTrDate(s){ const d=parseKey(s); if(!d) return s||""; return d.getDate()+" "+CAL_MONTHS[d.getMonth()]+" "+d.getFullYear(); }

/* --- Firebase --- */
function attachEventsListener(){
	if(!database) return;
	if(activeEventsListenerRef && activeEventsListenerCallback) { activeEventsListenerRef.off("value", activeEventsListenerCallback); }
	activeEventsListenerRef = database.ref(dbPath("etkinlikler"));
	activeEventsListenerCallback = function(snap){
		const v = snap.val();
		calEvents = (v && typeof v === "object") ? v : {};
		// "Zombie event": peek paneli acikken kayit baska bir editor tarafindan silinirse, panel
		// eskiden ACIK ve ESKI verilerle kalirdi -- kullanici "Simdi Baslat/Bitir" gibi bir hizli-damga
		// tusuna basarsa persistEvent() o eski veriyi TEKRAR yazip silinen kaydi DIRILTIRDI. Simdi
		// panel/duzenleme formu, arkasindaki kayit kaybolunca kendiliginden kapatilip kullanici bilgilendiriliyor.
		if(calPeekedId && !calEvents[calPeekedId]){
			closeEventPeek();
			showToast("Bu etkinlik başka bir kullanıcı tarafından silindi.", "warn");
		}
		if(calEditingId && !calEvents[calEditingId] && document.getElementById("eventModalBg").classList.contains("open")){
			closeEventModal();
			showToast("Düzenlediğiniz etkinlik başka bir kullanıcı tarafından silindi.", "warn");
		}
		renderCalendarRail();
		if(document.getElementById("calendarOverlay").classList.contains("open")) renderCalendar();
	};
	activeEventsListenerErrCallback = function(err){
		console.error("etkinlikler okunamadı:", err);
		calEvents = {}; renderCalendarRail();
		// Uyarı sadece giriş yapmış kullanıcıya gösterilir; ziyaretçi için takvim sessizce boş kalır.
		if(currentUser && !calEventsReadErrorShown){ calEventsReadErrorShown = true; showToast("Takvim etkinlikleri yüklenemedi (yetki sorunu olabilir).", "error"); }
	};
	activeEventsListenerRef.on("value", activeEventsListenerCallback, activeEventsListenerErrCallback);
}
// Faz 9 Part D: projede İLK ephemeral/canlı-durum (presence) dinleyicisi -- diger
// kullanicilarin O AN suruklemekte oldugu "yeni etkinlik olustur" secimini gosterir.
// attachEventsListener()'in AYNI deseni (off/on, dbPath ile test-modu farkindaligi).
let activeLiveSelectionRef = null, activeLiveSelectionCallback = null;
// uid -> o kullanicinin DOM'daki .cal-create-select.is-remote elemani -- her snapshot'ta
// hangi uid'lerin ARTIK kaybolduğunu (silueti kaldirmak icin) bilmek amacli.
let calRemoteSelectionEls = {};
function attachLiveSelectionListener(){
	if(!database) return;
	if(activeLiveSelectionRef && activeLiveSelectionCallback) { activeLiveSelectionRef.off("value", activeLiveSelectionCallback); }
	activeLiveSelectionRef = database.ref(dbPath("canliTakvimSecim"));
	activeLiveSelectionCallback = function(snap){
		renderRemoteLiveSelections(snap.val() || {});
	};
	activeLiveSelectionRef.on("value", activeLiveSelectionCallback, function(err){ console.error("canliTakvimSecim okunamadı:", err); });
}
// KENDI surukleme jestimizi KESMEMEK icin bu fonksiyon renderCalendar()'in TAMAMINI asla
// tetiklemez -- sadece diger kullanicilarin .cal-daycol'larina izole DOM ekleme/guncelleme/
// kaldirma yapar. calendarOverlay kapaliysa veya gorunum gun/hafta degilse hicbir sey yapmaz
// (Part D'nin "v1: sadece saat izgarasi" kapsam karariyla tutarli).
function renderRemoteLiveSelections(liveMap){
	const overlay = document.getElementById("calendarOverlay");
	const isGridView = overlay && overlay.classList.contains("open") && (calView === "day" || calView === "week");
	const myUid = currentUser && currentUser.uid;
	const seenUids = new Set();
	if(isGridView){
		Object.keys(liveMap).forEach(function(uid){
			if(uid === myUid) return; // kendi surukleme onizlememiz zaten yerel .cal-create-select ile gosteriliyor
			const sel = liveMap[uid];
			if(!sel || !sel.tarih || !sel.saat) return;
			const daycol = document.querySelector('.cal-daycol[data-date="'+sel.tarih+'"]');
			if(!daycol) return; // bu tarih su an gorunen hafta/gun disinda
			seenUids.add(uid);
			const startMin = hmToMin(sel.saat), endMin = hmToMin(sel.bitisSaat) || startMin;
			if(startMin === null) return;
			let el = calRemoteSelectionEls[uid];
			if(!el || el.parentElement !== daycol){
				if(el) el.remove();
				el = document.createElement("div");
				el.className = "cal-create-select is-remote";
				daycol.appendChild(el);
				calRemoteSelectionEls[uid] = el;
			}
			el.style.top = ((startMin/60)*CAL_HOUR_H)+"px";
			el.style.height = Math.max(18, ((endMin-startMin)/60)*CAL_HOUR_H)+"px";
			// textContent zaten guvenli (HTML olarak yorumlanmaz) -- escapeHtml burada GEREKMEZ,
			// aksine cift kacisa (ekranda "&amp;" gibi yanlis karakterlere) yol acardi.
			el.textContent = (sel.ad || "Bir kullanıcı") + " · " + sel.saat + "–" + (sel.bitisSaat||sel.saat);
		});
	}
	// Artik canli listede olmayan (jest bitti/baglanti koptu) uid'lerin silueti kaldirilir.
	Object.keys(calRemoteSelectionEls).forEach(function(uid){
		if(!seenUids.has(uid)){ calRemoteSelectionEls[uid].remove(); delete calRemoteSelectionEls[uid]; }
	});
}

function calEventList(){
	const out=[];
	for(const id in calEvents){
		const e=calEvents[id];
		if(!e || typeof e!=="object" || !e.tarih) continue;
		out.push(Object.assign({}, e, { _id:id }));
	}
	out.sort(function(a,b){
		if(a.tarih!==b.tarih) return a.tarih<b.tarih?-1:1;
		const sa=hmToMin(a.saat), sb=hmToMin(b.saat);
		if(sa===null&&sb!==null) return -1; if(sb===null&&sa!==null) return 1;
		if(sa!==null&&sb!==null&&sa!==sb) return sa-sb;
		return String(a.ad||"").localeCompare(String(b.ad||""),"tr");
	});
	return out;
}
function calVisibleEvents(){
	return calEventList().filter(function(e){
		return !calHiddenTypes.has(e.tur||"diger") && !calHiddenStatus.has(e.durum||"planlandi");
	});
}
function calEventsOn(dateKey){ return calVisibleEvents().filter(function(e){ return e.tarih===dateKey; }); }

/* --- Sağ ray (kapalı hâl) --- */
function renderCalendarRail(){
	const countEl=document.getElementById("calRailCount"); const nextEl=document.getElementById("calRailNext");
	if(!countEl||!nextEl) return;
	const t=todayDate(); const weekEnd=addDays(t,7);
	const now=new Date(); const nowMin=now.getHours()*60+now.getMinutes();
	const all=calEventList().filter(function(e){ return (e.durum||"")!=="iptal"; });
	// Bir etkinliğin "şimdi mi / ilerde mi / bitti mi" durumunu saat bilgisiyle hesaplar.
	// Eski mantık sadece tarihe bakıyordu, bugün saati geçmiş etkinlikler de "Sıradaki"de kalıyordu.
	function calEventTimeState(e){
		const d=parseKey(e.tarih); if(!d) return "past";
		if(d<t) return "past";
		if(d>t) return "future";
		const sMin=hmToMin(e.saat);
		if(sMin===null) return "future"; // saat belirtilmemiş (tüm gün) - eskisi gibi davran
		if(nowMin<sMin) return "future"; // henüz başlamadı
		const eMin=hmToMin(e.bitisSaat);
		if(eMin===null) return "now"; // başladı, bitiş saati girilmemiş -> hâlâ sürüyor kabul edilir
		return nowMin<eMin ? "now" : "past"; // bitiş saati geçtiyse artık gösterme
	}
	const nowItems=[], futureItems=[];
	all.forEach(function(e){
		const st=calEventTimeState(e);
		if(st==="now") nowItems.push(e); else if(st==="future") futureItems.push(e);
	});
	const thisWeek=nowItems.concat(futureItems).filter(function(e){ const d=parseKey(e.tarih); return d<weekEnd; });
	countEl.innerHTML='<b>'+thisWeek.length+'</b> etkinlik · 7 gün';
	const next=futureItems.slice(0,4);
	function renderNextItem(e, first){
		const d=parseKey(e.tarih); const ty=evType(e.tur);
		return '<div class="cal-next-item"'+(first?' style="border-top:none;"':'')+' data-date="'+e.tarih+'" data-evid="'+e._id+'">'+
			'<span class="cal-next-date"><span class="d">'+d.getDate()+'</span><span class="m">'+CAL_MONTHS[d.getMonth()].slice(0,3)+'</span></span>'+
			'<span style="min-width:0;"><span class="cal-next-name">'+escapeHtml(e.ad||"(adsız)")+'</span>'+
			'<span class="cal-next-meta" style="display:block;">'+(e.saat?escapeHtml(e.saat)+' · ':'')+'<span style="color:'+ty.renk+';">●</span> '+escapeHtml(ty.ad)+'</span></span></div>';
	}
	function renderNowItem(e, first){
		const ty=evType(e.tur);
		const saatTxt=e.saat?(escapeHtml(e.saat)+(e.bitisSaat?'–'+escapeHtml(e.bitisSaat):'')+' · '):'';
		return '<div class="cal-next-item cal-next-item-now"'+(first?' style="border-top:none;"':'')+' data-date="'+e.tarih+'" data-evid="'+e._id+'">'+
			'<span class="cal-now-dot" aria-hidden="true"></span>'+
			'<span style="min-width:0;"><span class="cal-next-name">'+escapeHtml(e.ad||"(adsız)")+'</span>'+
			'<span class="cal-next-meta" style="display:block;">'+saatTxt+'<span style="color:'+ty.renk+';">●</span> '+escapeHtml(ty.ad)+'</span></span></div>';
	}
	let html="";
	if(nowItems.length){
		html+='<h4 class="cal-now-heading">Şimdi</h4>'+nowItems.map(function(e,i){ return renderNowItem(e, i===0); }).join("");
	}
	html+='<h4'+(nowItems.length?' style="margin-top:10px;"':'')+'>Sıradaki</h4>';
	html+= next.length ? next.map(function(e,i){ return renderNextItem(e, i===0); }).join("") : '<div class="cal-rail-empty">📭 Planlanmış etkinlik yok.</div>';
	nextEl.innerHTML=html;
}

/* --- Takvimi aç / kapat (küçük karttan tam ekrana büyüyen geçiş) --- */
let calAnimating=false;
// Animasyonun başlayacağı kutu: masaüstünde sağ raydaki takvim kartı, mobilde alttaki düğme.
function calOriginRect(){
	const railBtn=document.querySelector(".cal-rail-btn");
	const fab=document.getElementById("calendarFab");
	let el=null;
	if(railBtn && railBtn.offsetParent!==null) el=railBtn;
	else if(fab && fab.offsetParent!==null) el=fab;
	if(!el) return null;
	const r=el.getBoundingClientRect();
	return (r.width>0 && r.height>0) ? r : null;
}
// "Şu an" çizgisi ve etiketi, takvim açık kaldığı sürece dakika başı kendini günceller.
let calNowTimer=null;
function calUpdateNowLine(){
	const line=document.querySelector(".cal-nowline-full"); const lab=document.querySelector(".cal-nowlabel");
	if(!line && !lab) return;
	const nw=new Date(); const top=((nw.getHours()*60+nw.getMinutes())/60)*CAL_HOUR_H;
	if(line) line.style.top=top+"px";
	if(lab){ lab.style.top=top+"px"; lab.textContent=pad2(nw.getHours())+":"+pad2(nw.getMinutes()); }
}
function calStartNowTicker(){
	if(calNowTimer) clearInterval(calNowTimer);
	calNowTimer=setInterval(function(){
		const ov=document.getElementById("calendarOverlay");
		if(!ov || !ov.classList.contains("open")){ clearInterval(calNowTimer); calNowTimer=null; return; }
		calUpdateNowLine();
	}, 30000);
}
function calReducedMotion(){ return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); }
// clip-path ile açılıyor: scale ile büyütmek metni ezip bulanıklaştırıyordu.
function calInsetFrom(r, radius){
	const t=Math.max(0,r.top), l=Math.max(0,r.left);
	const rr=Math.max(0,window.innerWidth-r.right), bb=Math.max(0,window.innerHeight-r.bottom);
	return "inset("+t+"px "+rr+"px "+bb+"px "+l+"px round "+(radius||16)+"px)";
}
function calClearAnim(ov, shell){
	ov.style.transition=""; ov.style.clipPath=""; ov.style.opacity="";
	shell.style.transition=""; shell.style.transform=""; shell.style.opacity=""; shell.style.transformOrigin="";
}
// Animasyon bitince cb() cagirir -- ONCELIKLE gercek "transitionend" olayini dinler (CSS suresi
// ileride degisirse elle senkronize edilmis bir setTimeout ms degeri gibi SESSIZCE eskimez), ama
// transitionend'in hic tetiklenmedigi nadir durumlara (display degisimi, transition'in kesilmesi
// vb.) karsi biraz daha uzun bir YEDEK setTimeout de tutulur -- ikisinden HANGISI once gelirse cb()
// TAM BIR KEZ calisir, kalici "calAnimating=true" takilmasi olmaz.
function afterCalTransition(el, propName, fallbackMs, cb){
	let done=false;
	function fire(){ if(done) return; done=true; el.removeEventListener("transitionend", onEnd); cb(); }
	function onEnd(e){ if(e.target===el && e.propertyName===propName) fire(); }
	el.addEventListener("transitionend", onEnd);
	setTimeout(fire, fallbackMs);
}

// ---- "Bir Etkinliğe Gidiyorum" hızlı taslak + hatırlatma sistemi ----
// Taslak: şu andan başlayan 1 saatlik, adı "(Düzenlenmeye muhtaç)" olan bir etkinlik.
// 15/30/60 dk sonra site içi hatırlatma (bu tarayıcıda, localStorage tabanlı -- gerçek push
// bildirimi değil). Hatırlatma, kişi taslağı gerçek bir adla düzenleyip kaydedene kadar
// bildirim merkezinde kalır.
const QUICK_DRAFT_NAME = "(Düzenlenmeye muhtaç)";
const REMINDERS_KEY = "omuProtokolPendingReminders";
function getReminders(){ try { return JSON.parse(localStorage.getItem(REMINDERS_KEY) || "[]"); } catch(e) { return []; } }
function saveReminders(list){ try { localStorage.setItem(REMINDERS_KEY, JSON.stringify(list)); } catch(e) {} }

async function startQuickDraftEvent(){
	if (!requireEdit()) return;
	const now = new Date();
	const end = new Date(now.getTime() + 60*60000);
	const pad = function(n){ return String(n).padStart(2,"0"); };
	const obj = {
		ad: QUICK_DRAFT_NAME, tur: "diger", durum: "planlandi",
		tarih: dKey(now), saat: pad(now.getHours())+":"+pad(now.getMinutes()), bitisSaat: pad(end.getHours())+":"+pad(end.getMinutes()),
		yer: "", birim: "", planlayan: "", gorevli: "", katilimcilar: [], arsiv: "", not: "", rozetler: [], haberKaynagi: "",
		olusturan: (currentUser ? (((currentUser.firstName||"")+" "+(currentUser.lastName||"")).trim()||currentUser.email) : ""),
		olusturmaTs: Date.now(), guncellemeTs: Date.now(), locked: false
	};
	const res = await persistEvent(null, obj, "Hızlı taslak etkinlik oluşturuldu (\"Bir Etkinliğe Gidiyorum\")");
	if (!res) return;
	calEvents[res.id] = obj;
	const dueAt = now.getTime();
	[15, 30, 60].forEach(function(mins){
		const list = getReminders();
		list.push({ id: res.id + "_" + mins, eventId: res.id, dueAt: dueAt + mins*60000, fired: false });
		saveReminders(list);
	});
	startReminderTicker();
	showToast("Taslak oluşturuldu, 15 dakikada bir doldurman için hatırlatılacaksın.", "success");
	openEventModal(res.id);
}
// Bir etkinlik için bekleyen tüm hatırlatmalar temizlenir -- taslak gerçek bir isimle
// düzenlenip kaydedildiğinde (saveEvent) veya etkinlik silindiğinde çağrılır.
function clearRemindersForEvent(eventId){
	const list = getReminders().filter(function(r){ return r.eventId !== eventId; });
	saveReminders(list);
	renderNotifCenter();
}
let reminderTickTimer = null;
function startReminderTicker(){
	if (reminderTickTimer) return;
	checkReminders();
	reminderTickTimer = setInterval(checkReminders, 20000);
}
function checkReminders(){
	const list = getReminders();
	if (!list.length) { renderNotifCenter(); return; }
	const now = Date.now();
	let changed = false;
	const kept = list.filter(function(r){
		const ev = calEvents[r.eventId];
		if (!ev) { changed = true; return false; }
		if (ev.ad !== QUICK_DRAFT_NAME) { changed = true; return false; }
		return true;
	});
	kept.forEach(function(r){
		if (!r.fired && r.dueAt <= now) {
			r.fired = true; changed = true;
			const ev = calEvents[r.eventId];
			showToast("Doldurulmayı bekleyen bir etkinlik var: " + (ev ? fmtTrDate(ev.tarih) + " " + (ev.saat||"") : ""), "warn");
		}
	});
	if (changed) saveReminders(kept);
	renderNotifCenter();
}
function renderNotifCenter(){
	const wrap = document.getElementById("notifBellWrap");
	const badge = document.getElementById("notifBadge");
	const dd = document.getElementById("notifDropdown");
	if (!wrap || !badge || !dd) return;
	if (!currentUser) { wrap.style.display = "none"; return; }
	const due = getReminders().filter(function(r){ return r.fired; });
	wrap.style.display = due.length ? "" : (getReminders().length ? "" : "none");
	badge.style.display = due.length ? "" : "none";
	badge.textContent = String(due.length);
	if (!due.length) { dd.innerHTML = '<p class="hint" style="margin:10px;">Bekleyen hatırlatma yok.</p>'; return; }
	dd.innerHTML = due.map(function(r){
		const ev = calEvents[r.eventId];
		const label = ev ? (fmtTrDate(ev.tarih) + " " + (ev.saat||"") + " · Düzenlenmeyi bekliyor") : "Etkinlik";
		return '<button type="button" class="notif-item" onclick="openReminderTarget(\'' + r.eventId + '\')">📍 ' + escapeHtml(label) + '</button>';
	}).join("");
}
function toggleNotifCenter(){
	const dd = document.getElementById("notifDropdown"); if (!dd) return;
	dd.classList.toggle("open");
}
function openReminderTarget(eventId){
	document.getElementById("notifDropdown").classList.remove("open");
	if (PAGE === "takvim") { tryOpenEditFromQuery(eventId, 0); return; }
	location.href = "takvim.html?edit=" + encodeURIComponent(eventId);
}
function tryOpenEditFromQuery(id, attempts){
	if (calEvents[id]) { openEventModal(id); return; }
	if (attempts >= 15) return;
	setTimeout(function(){ tryOpenEditFromQuery(id, attempts+1); }, 300);
}
document.addEventListener("click", function(e){
	const dd = document.getElementById("notifDropdown");
	if (!dd || !dd.classList.contains("open")) return;
	if (!dd.contains(e.target) && e.target.id !== "notifBellBtn") dd.classList.remove("open");
});

function openCalendar(){
	if (PAGE !== "takvim") { location.href = buildTakvimUrl(); return; }
	const ov=document.getElementById("calendarOverlay");
	if(calAnimating || ov.classList.contains("open")) return;
	closeFacultySheet(); // mobil fakulte cekmecesi acik/yarim suruklenmis kalmasin diye guvenli sifirlama
	const shell=ov.querySelector(".cal-shell");
	const bd=document.getElementById("calLaunchBackdrop");
	const origin=calOriginRect();
	calMiniAnchor=new Date(calAnchor.getFullYear(), calAnchor.getMonth(), 1);
	ov.classList.add("open");
	renderCalendar();
	calStartNowTicker();
	if(!origin || calReducedMotion()){ calClearAnim(ov, shell); return; }
	calAnimating=true;
	if(bd) bd.classList.add("show");
	// Başlangıç durumu: tam olarak kartın bulunduğu yer ve boyut
	ov.style.transition="none";
	ov.style.clipPath=calInsetFrom(origin,16);
	ov.style.opacity="0.55";
	shell.style.transition="none";
	shell.style.transformOrigin=(origin.left+origin.width/2)+"px "+(origin.top+origin.height/2)+"px";
	shell.style.transform="scale(.93)";
	shell.style.opacity="0";
	void ov.offsetWidth; // tarayıcı başlangıç durumunu uygulasın, yoksa geçiş atlanır
	requestAnimationFrame(function(){
		if(bd) bd.classList.add("on");
		ov.style.transition="clip-path .46s cubic-bezier(.22,.9,.26,1), opacity .22s ease";
		ov.style.clipPath="inset(0px 0px 0px 0px round 0px)";
		ov.style.opacity="1";
		shell.style.transition="transform .46s cubic-bezier(.22,.9,.26,1), opacity .3s ease .06s";
		shell.style.transform="scale(1)";
		shell.style.opacity="1";
		afterCalTransition(ov, "clip-path", 600, function(){ calClearAnim(ov, shell); calAnimating=false; });
	});
}

// closeCalendar() = "takvim.html'den ÇIK" (gerçek sayfa geçişi). Overlay'i sadece GÖRSEL
// olarak geçici kapatmak (ör. üstüne haber modalı açmak için) gerektiğinde sayfa değiştirmeyen
// _hideCalendarOverlay() kullanılır -- aksi halde etkinlikten haber taslağı akışı yarıda kalırdı.
function closeCalendar(){
	if (PAGE === "takvim") { location.href = "protokol.html"; return; }
	_hideCalendarOverlay();
}
function _hideCalendarOverlay(){
	const ov=document.getElementById("calendarOverlay");
	if(!ov.classList.contains("open") || calAnimating) return;
	const shell=ov.querySelector(".cal-shell");
	const bd=document.getElementById("calLaunchBackdrop");
	closeEventPeek();
	const origin=calOriginRect();
	const finish=function(){
		ov.classList.remove("open");
		if(bd){ bd.classList.remove("on"); bd.classList.remove("show"); }
		calClearAnim(ov, shell);
		calAnimating=false;
	};
	if(!origin || calReducedMotion()){ finish(); return; }
	calAnimating=true;
	if(bd) bd.classList.remove("on");
	ov.style.transition="clip-path .34s cubic-bezier(.5,0,.75,.2), opacity .3s ease .06s";
	ov.style.clipPath=calInsetFrom(origin,16);
	ov.style.opacity="0.4";
	shell.style.transition="transform .34s cubic-bezier(.5,0,.75,.2), opacity .26s ease";
	shell.style.transformOrigin=(origin.left+origin.width/2)+"px "+(origin.top+origin.height/2)+"px";
	shell.style.transform="scale(.94)";
	shell.style.opacity="0";
	afterCalTransition(ov, "clip-path", 500, finish);
}
function openCalendarAt(dateKey, evId){
	if (PAGE !== "takvim") { location.href = buildTakvimUrl(dateKey, evId); return; }
	const d=parseKey(dateKey); if(d) calAnchor=d;
	openCalendar();
	if(evId) setTimeout(function(){ openEventPeek(evId); }, 520);
}
function calSetView(v){
	calView=v;
	document.querySelectorAll("#calViewTabs .cal-viewbtn").forEach(function(b){ b.classList.toggle("active", b.dataset.view===v); });
	renderCalendar();
}
function calShift(dir){
	if(calView==="day") calAnchor=addDays(calAnchor, dir);
	else if(calView==="week") calAnchor=addDays(calAnchor, dir*calDayCount());
	else if(calView==="month") calAnchor=new Date(calAnchor.getFullYear(), calAnchor.getMonth()+dir, 1);
	else if(calView==="year") calAnchor=new Date(calAnchor.getFullYear()+dir, calAnchor.getMonth(), calAnchor.getDate());
	else calAnchor=addDays(calAnchor, dir*30);
	calMiniAnchor=new Date(calAnchor.getFullYear(), calAnchor.getMonth(), 1);
	renderCalendar();
}
function calToday(){ calAnchor=todayDate(); calMiniAnchor=new Date(calAnchor.getFullYear(), calAnchor.getMonth(), 1); renderCalendar(); }
function calMiniShift(dir){ calMiniAnchor=new Date(calMiniAnchor.getFullYear(), calMiniAnchor.getMonth()+dir, 1); renderCalMini(); }
// Ay ay tıklamadan uzak tarihlere gidebilmek için yıl atlama.
function calMiniShiftYear(dir){ calMiniAnchor=new Date(calMiniAnchor.getFullYear()+dir, calMiniAnchor.getMonth(), 1); renderCalMini(); }
// Üstteki tarih kutusundan seçilen güne doğrudan atlar (takvimin ileri/geri sınırı yoktur).
function calJumpTo(v){
	const d=parseKey(v); if(!d) return;
	calAnchor=d;
	calMiniAnchor=new Date(d.getFullYear(), d.getMonth(), 1);
	if(calView==="list") calSetView("day"); else renderCalendar();
}
// Mini takvimden bir güne tıklandığında o günün içine girilir (gün görünümü).
function calGoToDay(dateKey){ const d=parseKey(dateKey); if(!d) return; calAnchor=d; calSetView("day"); }

function renderCalendar(){
	// Her renderCalendar() cagrisi ilgili view'i BASTAN cizer -- eski Sortable ornekleri
	// (varsa) DOM'dan once temizlenir, aksi halde artik var olmayan elemanlara bagli
	// "zombi" Sortable ornekleri birikir (bkz. person-list'teki ayni desen).
	calSortableInstances.forEach(function(inst){ inst.destroy(); }); calSortableInstances=[];
	renderCalMini(); renderCalLegend(); renderCalTopbar();
	const body=document.getElementById("calMainBody"); if(!body) return;
	if(calView==="week" || calView==="day") renderWeekView(body);
	else if(calView==="month") renderMonthView(body);
	else if(calView==="year") renderYearView(body);
	else renderListView(body);
}

function renderCalTopbar(){
	const jump=document.getElementById("calJumpDate"); if(jump) jump.value=dKey(calAnchor);
	const lab=document.getElementById("calMonthLabel"); if(!lab) return;
	if(calView==="day"){
		const d=calAnchor;
		lab.innerHTML=d.getDate()+" "+CAL_MONTHS[d.getMonth()]+' <span class="yr">'+d.getFullYear()+" · "+CAL_DOW[(d.getDay()+6)%7]+"</span>";
	} else if(calView==="week"){
		const dn=calDayCount();
		const s=(dn===7)?startOfWeek(calAnchor):new Date(calAnchor.getFullYear(),calAnchor.getMonth(),calAnchor.getDate()), e=addDays(s,dn-1);
		let txt;
		if(s.getMonth()===e.getMonth()) txt=CAL_MONTHS[s.getMonth()]+' <span class="yr">'+s.getFullYear()+'</span>';
		else if(s.getFullYear()===e.getFullYear()) txt=CAL_MONTHS[s.getMonth()].slice(0,3)+"–"+CAL_MONTHS[e.getMonth()].slice(0,3)+' <span class="yr">'+s.getFullYear()+'</span>';
		else txt=CAL_MONTHS[s.getMonth()].slice(0,3)+" "+s.getFullYear()+" – "+CAL_MONTHS[e.getMonth()].slice(0,3)+" "+e.getFullYear();
		lab.innerHTML=txt;
	} else if(calView==="month"){
		lab.innerHTML=CAL_MONTHS[calAnchor.getMonth()]+' <span class="yr">'+calAnchor.getFullYear()+'</span>';
	} else if(calView==="year"){
		lab.innerHTML=String(calAnchor.getFullYear());
	} else {
		lab.innerHTML='Yaklaşan Etkinlikler';
	}
}

/* --- Sol ray: mini ay --- */
function renderCalMini(){
	const grid=document.getElementById("calMiniGrid"), title=document.getElementById("calMiniTitle");
	if(!grid||!title) return;
	title.textContent=CAL_MONTHS[calMiniAnchor.getMonth()]+" "+calMiniAnchor.getFullYear();
	const first=new Date(calMiniAnchor.getFullYear(), calMiniAnchor.getMonth(), 1);
	const start=startOfWeek(first); const today=todayDate();
	const dayN = calDayCount();
	const viewStart = (calView==="week"||calView==="day") ? ((dayN===7) ? startOfWeek(calAnchor) : new Date(calAnchor.getFullYear(),calAnchor.getMonth(),calAnchor.getDate())) : null;
	const viewEnd = viewStart ? addDays(viewStart, dayN-1) : null;
	const dayCounts={}; calVisibleEvents().forEach(function(e){ dayCounts[e.tarih]=(dayCounts[e.tarih]||0)+1; });
	let html=CAL_DOW_MINI.map(function(d){ return '<span class="cal-mini-dow">'+d+'</span>'; }).join("");
	for(var i=0;i<42;i++){
		const d=addDays(start,i); const k=dKey(d);
		let cls="cal-mini-day";
		if(d.getMonth()!==calMiniAnchor.getMonth()) cls+=" other";
		if(viewStart && d>=viewStart && d<=viewEnd) cls+=" in-view";
		if(isSameDay(d,today)) cls+=" today";
		html+='<button type="button" class="'+cls+'" onclick="calGoToDay(\''+k+'\')">'+d.getDate()+(dayCounts[k]?'<span class="hasdot"></span>':'')+'</button>';
	}
	grid.innerHTML=html;
}

/* --- Sol ray: tür ve durum süzgeçleri --- */
// Sol taraftaki etkinlik türü/durum sayaçları artık TÜM ZAMANLARIN toplamı değil, o an
// baktığımız görünümün (gün/hafta/ay/yıl) tarih aralığıyla sınırlı. "Liste"nin kendi bir
// tarih aralığı yoktur (bugünden ileriye açık uçludur), o yüzden listenin kendisinin de
// kullandığı aynı aralık (dün ve sonrası) kullanılır.
function calLegendRangeDates(){
	if(calView==="day"){ const d0=new Date(calAnchor.getFullYear(),calAnchor.getMonth(),calAnchor.getDate()); return [d0,d0]; }
	if(calView==="week"){
		const dn=calDayCount();
		const s=(dn===7)?startOfWeek(calAnchor):new Date(calAnchor.getFullYear(),calAnchor.getMonth(),calAnchor.getDate());
		return [s, addDays(s,dn-1)];
	}
	if(calView==="month") return [new Date(calAnchor.getFullYear(),calAnchor.getMonth(),1), new Date(calAnchor.getFullYear(),calAnchor.getMonth()+1,0)];
	if(calView==="year") return [new Date(calAnchor.getFullYear(),0,1), new Date(calAnchor.getFullYear(),11,31)];
	return null;
}
function calLegendRangeEvents(){
	const range=calLegendRangeDates();
	const list=calEventList();
	if(!range){ const today=todayDate(); return list.filter(function(e){ const d=parseKey(e.tarih); return d && d>=addDays(today,-1); }); }
	return list.filter(function(e){ const d=parseKey(e.tarih); return d && d>=range[0] && d<=range[1]; });
}
function renderCalLegend(){
	const t=document.getElementById("calTypeLegend"), s=document.getElementById("calStatusLegend");
	if(!t||!s) return;
	const rangeEvents=calLegendRangeEvents();
	const counts={}; rangeEvents.forEach(function(e){ counts[e.tur||"diger"]=(counts[e.tur||"diger"]||0)+1; });
	t.innerHTML=EVENT_TYPES.map(function(ty){
		const off=calHiddenTypes.has(ty.key);
		return '<label class="cal-legend-item'+(off?" off":"")+'"><input type="checkbox" data-type="'+ty.key+'" '+(off?"":"checked")+'>'+
			'<span class="cal-legend-swatch" style="background:'+ty.renk+';"></span><span>'+escapeHtml(ty.ad)+'</span>'+
			'<span class="cal-legend-count">'+(counts[ty.key]||0)+'</span></label>';
	}).join("");
	const sc={}; rangeEvents.forEach(function(e){ sc[e.durum||"planlandi"]=(sc[e.durum||"planlandi"]||0)+1; });
	s.innerHTML=EVENT_STATUS.map(function(st){
		const off=calHiddenStatus.has(st.key);
		return '<label class="cal-legend-item'+(off?" off":"")+'"><input type="checkbox" data-status="'+st.key+'" '+(off?"":"checked")+'>'+
			'<span class="cal-legend-swatch" style="background:'+st.renk+';"></span><span>'+escapeHtml(st.ad)+'</span>'+
			'<span class="cal-legend-count">'+(sc[st.key]||0)+'</span></label>';
	}).join("");
}
document.addEventListener("change", function(e){
	const cb=e.target;
	if(cb && cb.dataset && cb.dataset.type !== undefined && cb.closest(".cal-legend")){
		if(cb.checked) calHiddenTypes.delete(cb.dataset.type); else calHiddenTypes.add(cb.dataset.type);
		renderCalendar();
	} else if(cb && cb.dataset && cb.dataset.status !== undefined && cb.closest(".cal-legend")){
		if(cb.checked) calHiddenStatus.delete(cb.dataset.status); else calHiddenStatus.add(cb.dataset.status);
		renderCalendar();
	}
});

/* --- Hafta görünümü: saat ızgarası (Notion Calendar düzeni) --- */
// Faz 6 tasarım güncellemesi (kullanıcı referans videosu): kart artık pastel değil,
// TÜRÜN kendi doygun rengini arka plan olarak kullanıyor + beyaz metin -- daha canlı,
// "post-it" hissi. Takvimin saat-ızgaralı/sürükle-bırak MİMARİSİ değişmedi, sadece görsel.
function calBlockStyle(ev){
	const ty=evType(ev.tur);
	return "background:"+ty.renk+"; border-left-color:"+ty.renk+"; color:#fff;";
}
function calBlockClasses(ev, dayDate){
	let c="cal-block";
	const st=ev.durum||"planlandi";
	if(st==="yayinlandi"||st==="haber") c+=" done";
	if(st==="iptal") c+=" cancelled";
	if(dayDate && dayDate<todayDate()) c+=" past";
	return c;
}
// Kilit ikonu: hafta/gun, ay ve tum-gun seridi render'larinda ortak kullanilir. NOT: .cal-block
// ve .cal-allday-chip birer <button>'dir; <button> icine <button> KONULAMAZ (tarayici DOM'u
// bozar). Bu yuzden ikon <span>'dir; tiklama event.stopPropagation() ile ustteki butonun
// onclick'ine (openEventPeek / drag) sizmaz.
function lockIconHtml(ev){
	const locked=!!ev.locked;
	const title=locked?"Kilitli · sürüklenemez (açmak için tıkla)":"Kilitle (sürüklenmesini engelle)";
	return '<span class="cal-lock-ico'+(locked?" is-locked":"")+'" title="'+title+'" onclick="event.stopPropagation(); toggleEventLock(\''+ev._id+'\')">'+(locked?"🔒":"🔓")+'</span>';
}
async function toggleEventLock(id){
	if(!requireEdit()) return;
	const e=calEvents[id]; if(!e) return;
	const wasLocked=!!e.locked;
	const patch=Object.assign({}, e, { locked: !wasLocked });
	const label=evLogName(e.ad)+" etkinliği "+(wasLocked?"kilidi açıldı":"kilitlendi");
	const res=await persistEvent(id, patch, label);
	if(!res) return;
	// Durum degisti: ekranda kalmis eski kilit uyarilari ("kilitli, tasinamaz") artik
	// GECERSIZ ve birazdan gosterilecek mesajla celiskili. Sadece kilit etiketli bildiriler
	// temizlenir -- eskiden ekrandaki TUM bildirimler siliniyordu, ilgisiz olanlar dahil.
	clearToastsByTag(CAL_LOCK_TOAST_TAG);
	calEvents[id]=patch;
	// Kilit acilinca deneme sayaci sifirlanir; yoksa bir SONRAKI kilitlemede kullanici daha
	// ilk denemesinde dogrudan esprili/israrci mesaji goruyordu.
	if(wasLocked) delete calLock.attempts[id];
	// Devam eden bir jestin uyari bayragi askida kalmasin -- ikona dokunmak da bir jesttir ve
	// bittiginde bir sonraki gercek surukleme denemesi kendi uyarisini hak eder.
	calLockGestureEnd();
	renderCalendar();
	calLockNotify(wasLocked?"Kilit açıldı, etkinlik artık sürüklenebilir.":"Etkinlik kilitlendi, artık sürüklenemez.", "success");
}
// Aynı saate denk gelen etkinlikler yan yana dizilir.
function layoutDay(evs){
	const items=evs.map(function(e){
		let s=hmToMin(e.saat); let en=hmToMin(e.bitisSaat);
		if(s===null) return null;
		// Iki AYRI durum, eskiden ikisi de "s+60" ile ayni sekilde ele aliniyordu:
		//  - en===null  : bitis saati HIC girilmemis -> varsayilan 1 saat goster.
		//  - en<=s      : bitis baslangictan kucuk -> bu GECE YARISINI ASAN bir etkinlik
		//                 (saveEvent() bunu kullaniciya acikca "gece yarısını geçiyor mu?" diye
		//                 sorup ONAYIYLA kaydediyor). Eskiden 1 saatlik gibi cizilip kullanicinin
		//                 onayladigi bilgi ekranda SESSIZCE kayboluyordu; artik gun sonuna kadar
		//                 uzatilir (tek "tarih" alanli model icinde dogru olan gosterim budur).
		if(en===null) en=s+60;
		else if(en<=s) en=24*60;
		return { ev:e, s:s, e:Math.min(en,24*60) };
	}).filter(Boolean);
	items.sort(function(a,b){ return a.s-b.s || b.e-a.e; });
	const colEnds=[];
	items.forEach(function(it){
		let c=0; while(c<colEnds.length && colEnds[c]>it.s) c++;
		colEnds[c]=it.e; it.col=c;
	});
	// Sutun sayisi (colEnds.length) gunun GENELINDEKI en yuksek cakismayi verir; bunu tum
	// etkinliklere uygulamak, gunun ayri/cakismayan bolumlerindeki etkinlikleri de gereksiz
	// yere dar gosterirdi. Bunun yerine her etkinlige, ait oldugu cakisma kumesindeki
	// (zincirleme kesisen etkinlikler grubu) gercek sutun sayisini atiyoruz.
	let clusterStart=0, clusterMaxEnd=-Infinity, clusterMaxCol=0;
	function closeCluster(from,to){ const width=clusterMaxCol+1; for(let i=from;i<to;i++) items[i].total=width; }
	items.forEach(function(it,i){
		if(i>0 && it.s>=clusterMaxEnd){ closeCluster(clusterStart,i); clusterStart=i; clusterMaxCol=0; }
		clusterMaxEnd=Math.max(clusterMaxEnd,it.e); clusterMaxCol=Math.max(clusterMaxCol,it.col);
	});
	closeCluster(clusterStart,items.length);
	return items;
}

function renderWeekView(body){
	const n=calDayCount();
	const start = (n===7 && calView!=="day") ? startOfWeek(calAnchor) : new Date(calAnchor.getFullYear(),calAnchor.getMonth(),calAnchor.getDate());
	const today=todayDate();
	const cols="grid-template-columns:"+CAL_GUTTER+"px repeat("+n+",minmax(0,1fr));";
	const days=[]; for(var i=0;i<n;i++) days.push(addDays(start,i));

	// başlık satırı
	let head='<div class="cal-tg-head" style="'+cols+'"><div class="cal-gutter-cell"></div>';
	days.forEach(function(d){
		const wd=(d.getDay()+6)%7; const cls="cal-dhead"+(isSameDay(d,today)?" is-today":"")+(wd>=5?" is-weekend":"");
		head+='<div class="'+cls+'"><span class="dw">'+CAL_DOW[wd]+'</span><span class="dn">'+d.getDate()+'</span></div>';
	});
	head+='</div>';

	// tüm gün şeridi (saati girilmemiş etkinlikler)
	let allday='<div class="cal-allday" style="'+cols+'"><div class="cal-allday-label">tüm gün</div>';
	days.forEach(function(d){
		const k=dKey(d);
		const evs=calEventsOn(k).filter(function(e){ return hmToMin(e.saat)===null; });
		allday+='<div class="cal-allday-col" data-date="'+k+'">'+
			evs.map(function(e){
				const ty=evType(e.tur);
				return '<button type="button" class="cal-allday-chip'+((e.durum==="yayinlandi"||e.durum==="haber")?" done":"")+'" data-evid="'+e._id+'" data-act="peek" style="background:'+ty.renk+'; border-left-color:'+ty.renk+'; color:#fff;"><span class="t">'+escapeHtml(e.ad||"(adsız)")+'</span>'+badgeHtml(e)+lockIconHtml(e)+'</button>';
			}).join("")+'</div>';
	});
	allday+='</div>';

	// saat ızgarası
	const H=24*CAL_HOUR_H;
	// Şu anki saat çizgisi: görünen aralıkta bugün varsa, tüm sütunları kesecek şekilde tek çizgi çizilir.
	// Şu-an çizgisi: eskiden .cal-tg-body'nin TAMAMINI (gutter'dan sağ kenara, yani TÜM görünen
	// günler boyunca) kaplayan tek bir overlay'di -- hafta görünümünde geçmiş/gelecek günlerde de
	// aynı hizada "kayıyor" gibi görünüyordu. Artık SADECE bugünün .cal-daycol'u İÇİNE, o sütuna
	// göre konumlanmış olarak ekleniyor (bkz. aşağıda cells döngüsü), diğer sütunlarda hiç yok.
	let nowLabel=''; let nowTop=null;
	if(days.some(function(d){ return isSameDay(d,today); })){
		const nw=new Date(); const nmins=nw.getHours()*60+nw.getMinutes(); nowTop=(nmins/60)*CAL_HOUR_H;
		nowLabel='<div class="cal-nowlabel" style="top:'+nowTop+'px; right:4px;">'+pad2(nw.getHours())+":"+pad2(nw.getMinutes())+'</div>';
	}
	let gutter='<div class="cal-gutter" style="height:'+H+'px;">';
	for(var h=1;h<24;h++) gutter+='<div class="cal-hourlab" style="top:'+(h*CAL_HOUR_H)+'px;">'+pad2(h)+':00</div>';
	gutter+=nowLabel+'</div>';

	let cells="";
	days.forEach(function(d){
		const k=dKey(d); const wd=(d.getDay()+6)%7;
		const isToday=isSameDay(d,today);
		let inner="";
		for(var h=1;h<24;h++) inner+='<div class="cal-hrline" style="top:'+(h*CAL_HOUR_H)+'px;"></div>';
		layoutDay(calEventsOn(k)).forEach(function(it){
			const e=it.ev; const top=(it.s/60)*CAL_HOUR_H; const hgt=Math.max(18,((it.e-it.s)/60)*CAL_HOUR_H-2);
			const w=100/it.total; const left=w*it.col;
			const compact=hgt<34?" compact":"";
			const stBar=evStatus(e.durum).renk;
			inner+='<button type="button" class="'+calBlockClasses(e,d)+compact+'" data-evid="'+e._id+'" data-act="peek" '+
				'style="'+calBlockStyle(e)+' top:'+top+'px; height:'+hgt+'px; left:calc('+left+'% + 2px); width:calc('+w+'% - 4px);">'+
				'<span class="bt">'+escapeHtml(e.ad||"(adsız)")+'</span><span class="bh">'+escapeHtml(e.saat||"")+(e.bitisSaat?"–"+escapeHtml(e.bitisSaat):"")+'</span>'+badgeHtml(e)+lockIconHtml(e)+
				'<span class="cal-status-bar" style="background:'+stBar+';"></span>'+
				// Faz 9: hem UST (baslangic) hem ALT (bitis) kenardan surukleyerek saat ayarlama
				// (bkz. calStartResizeGesture). edit-only: is-readonly govdede otomatik gizlenir
				// (JSON indir/Silinenler butonlarindaki AYNI mekanizma).
				'<span class="cal-resize-handle cal-resize-handle-top edit-only" data-act="resize-handle" aria-hidden="true"></span>'+
				'<span class="cal-resize-handle edit-only" data-act="resize-handle" aria-hidden="true"></span></button>';
		});
		if(isToday && nowTop!==null) inner+='<div class="cal-nowline-full" style="top:'+nowTop+'px;"></div>';
		cells+='<div class="cal-daycol'+(wd>=5?" is-weekend":"")+(isToday?" is-today":"")+'" data-date="'+k+'" style="height:'+H+'px;">'+inner+'</div>';
	});

	// Eski DOM silinmeden HEMEN once mevcut kaydirma konumu yakalanir -- asagida ayni
	// hafta/gun icin tekrar render ediliyorsa (bkz. calWeekScrollKey) geri yuklenecek.
	const prevSc = document.getElementById("calTgScroll");
	calWeekScrollTopPreserved = prevSc ? prevSc.scrollTop : null;

	body.innerHTML='<div class="cal-tg">'+head+allday+
		'<div class="cal-tg-scroll" id="calTgScroll"><div class="cal-tg-body" style="'+cols+'">'+gutter+cells+'</div></div></div>';

	// Tum-gun seridi + saat izgarasi TEK ortak grup -- bir etkinlik ikisi arasinda suruklenebilir
	// (kullanici: "tum güne eklenen bir etkinliği de aşağıya almama izin vermen lazım"). v2.9.39'da
	// bu GECICI olarak IKI ayri gruba bolunup capraz surukleme TAMAMEN kapatilmisti, cunku
	// .cal-block'un saat izgarasi icin hesaplanan position:absolute left/width/top/height (yuzde/
	// piksel, .cal-daycol'un kendi genislik/yuksekligine gore) surukleme SIRASINDA dugum
	// .cal-allday-col'un (kisa, yatay flex satiri) icine tasinirken HALA uygulaniyor, tamamen
	// FARKLI bir kap boyutuna gore hesaplanip ekranda devasa/bozuk bir "hayalet" olusturuyordu.
	// GERCEK duzeltme: calOnDragMove() artik surukleme SIRASINDA hedefin turunu izleyip
	// .cal-block-cross-preview sinifini takiyor/cikariyor (bkz. asagi + style.css) -- bu sinif
	// saat-izgarasina-ozel mutlak konumlandirmayi SADECE tum-gun seridi uzerindeyken gecici
	// olarak etkisiz kilar, boylece capraz surukleme artik GUVENLI ve tekrar MUMKUN.
	body.querySelectorAll(".cal-allday-col, .cal-daycol").forEach(function(col){
		calSortableInstances.push(new Sortable(col, calSortableOptions("calWeek")));
	});

	// açılışta (veya BAŞKA bir haftaya/güne geçince) sabah 07:00 hizasına kaydır; bugün görünüyorsa
	// şu anki saate. AMA renderCalendar() her çağrıldığında (ör. bir etkinlik sürüklenip
	// bırakıldığında, hızlı-damga ile saat işaretlendiğinde, başka bir editörün değişikliği
	// listener'dan geldiğinde) bu fonksiyon YENİDEN çalışır -- eskiden bu kaydırma her seferinde
	// KOŞULSUZ tekrarlanıp kullanıcıyı bulunduğu yerden "şu anki saate" fırlatıyordu (kullanıcı:
	// "taşıma yaptığımda sayfanın üstüne atıyor biraz"). Şimdi sadece GERÇEKTEN farklı bir
	// hafta/gün görünümüne geçildiğinde (scrollKey değiştiğinde) uygulanıyor; aynı görünümün
	// tekrar render edilmesinde kullanıcının o anki kaydırma konumu KORUNUYOR.
	const scrollKey = calView + "|" + dKey(start);
	const isFreshView = scrollKey !== calWeekScrollKey;
	calWeekScrollKey = scrollKey;
	const sc=document.getElementById("calTgScroll");
	if(sc){
		if(!isFreshView && calWeekScrollTopPreserved!==null){
			// Ayni hafta/gun -- korunan konum geri yuklenir (surukleme/hizli-damga sonrasi fircalama YOK).
			sc.scrollTop=calWeekScrollTopPreserved;
		} else {
			// Yeni bir hafta/gune gecildi (veya baska bir gorunumden -- ay/liste/yil -- donuldugu icin
			// korunacak bir konum yoktu): sabah 07:00'a, bugun gorunuyorsa su anki saate kaydir.
			const hasToday=days.some(function(d){ return isSameDay(d,today); });
			const target=hasToday ? Math.max(0,(new Date().getHours()-2)*CAL_HOUR_H) : 7*CAL_HOUR_H;
			sc.scrollTop=Math.max(0,target-12);
		}
		// Izgara, kaydırma çubuğu kadar dar kalıyor; sütunlar hizalansın diye başlık satırları da aynı kadar daraltılır.
		const sbw=sc.offsetWidth-sc.clientWidth;
		if(sbw>0){
			const hd=body.querySelector(".cal-tg-head"); const ad=body.querySelector(".cal-allday");
			if(hd) hd.style.paddingRight=sbw+"px";
			if(ad) ad.style.paddingRight=sbw+"px";
		}
	}
}

// Boş ızgaraya tıklayınca o saate yeni etkinlik açılır (Notion'daki gibi).
// col: gercek .cal-daycol elemani -- delegated listener'dan geldigi icin artik e.currentTarget'a
// GUVENILEMEZ (o, dinleyicinin baglandigi #calendarOverlay olur), col acikca parametre olarak gecilir.
// Faz 9 Part D: gercek bir surukle-secim (calStartGridSelectGesture) TAMAMLANDIYSA bu KISA
// tik-fallback DEVRE DISI kalir -- calGridSelectSuppressClick bayragi (asagida) tek-seferlik
// olarak set edilir, boylece ayni pointerup/click ciftinde iki modal ust uste ACILMAZ.
function calGridClick(e, dateKey, col){
	if(calGridSelectSuppressClick){ calGridSelectSuppressClick=false; return; }
	if(!canEditData()) return;
	if(e.target.closest(".cal-block")) return;
	const rect=col.getBoundingClientRect();
	const y=e.clientY-rect.top+col.parentElement.parentElement.scrollTop*0;
	let mins=Math.round((y/CAL_HOUR_H)*60/30)*30;
	mins=Math.max(0,Math.min(23*60+30,mins));
	openEventModal(null, dateKey, minToHm(mins));
}

/* --- Ay görünümü --- */
function renderMonthView(body){
	const first=new Date(calAnchor.getFullYear(), calAnchor.getMonth(), 1);
	const start=startOfWeek(first); const today=todayDate();
	let dow='<div class="cal-m-dow">'+CAL_DOW.map(function(d){ return '<span>'+d+'</span>'; }).join("")+'</div>';
	let cells="";
	for(var i=0;i<42;i++){
		const d=addDays(start,i); const k=dKey(d); const wd=(d.getDay()+6)%7;
		let cls="cal-mday";
		if(d.getMonth()!==calAnchor.getMonth()) cls+=" other";
		if(wd>=5) cls+=" weekend";
		if(isSameDay(d,today)) cls+=" today";
		const evs=calEventsOn(k);
		const shown=evs.slice(0,3);
		let chips=shown.map(function(e){
			const ty=evType(e.tur);
			return '<button type="button" class="cal-block compact'+((e.durum==="yayinlandi"||e.durum==="haber")?" done":"")+((e.durum==="iptal")?" cancelled":"")+'" data-evid="'+e._id+'" data-act="peek" style="position:relative; '+calBlockStyle(e)+'">'+
				(e.saat?'<span class="bh">'+escapeHtml(e.saat)+'</span>':'')+'<span class="bt">'+escapeHtml(e.ad||"(adsız)")+'</span>'+lockIconHtml(e)+'</button>';
		}).join("");
		if(evs.length>shown.length) chips+='<button type="button" class="cal-more" data-date="'+k+'" data-act="more">+'+(evs.length-shown.length)+' tane daha</button>';
		cells+='<div class="'+cls+'" data-date="'+k+'">'+
			'<div class="cal-mdayhead"><span class="cal-mdaynum">'+d.getDate()+'</span>'+
			'<button type="button" class="cal-mdayadd" data-date="'+k+'" data-act="add" title="Bu güne etkinlik ekle">+</button></div>'+
			'<div class="cal-mday-chips" data-date="'+k+'" style="display:flex; flex-direction:column; gap:2px; overflow:hidden;">'+chips+'</div></div>';
	}
	body.innerHTML='<div class="cal-m">'+dow+'<div class="cal-m-grid">'+cells+'</div></div>';
	// Ay gorunumunde her gun hucresinin KENDI ic chip-sarmalayicisi Sortable konteyneri --
	// .cal-mday'in kendisi degil, cunku o hucre basligi/+ butonunu da iceriyor (sadece chip'ler suruklenebilir olmali).
	body.querySelectorAll(".cal-mday-chips").forEach(function(wrap){
		calSortableInstances.push(new Sortable(wrap, calSortableOptions("calMonth")));
	});
}
function calGoToDayWeek(k){ const d=parseKey(k); if(!d) return; calAnchor=d; calSetView("day"); }

/* --- Yıl görünümü: 12 aylık mini-takvim ızgarası, etkinlik olan güne renkli nokta --- */
function renderYearView(body){
	const year=calAnchor.getFullYear();
	const today=todayDate();
	let html='<div class="cal-year-grid">';
	for(let m=0;m<12;m++){
		const start=startOfWeek(new Date(year,m,1));
		let cells='';
		for(let i=0;i<42;i++){
			const d=addDays(start,i);
			if(d.getMonth()!==m){ cells+='<span class="cal-year-day empty">'+d.getDate()+'</span>'; continue; }
			const k=dKey(d);
			const evs=calEventsOn(k);
			const dot=evs.length ? '<span class="cal-year-dot" style="background:'+evType(evs[0].tur).renk+';"></span>' : '';
			const title=fmtTrDate(k)+(evs.length?(' · '+evs.length+' etkinlik'):'');
			cells+='<button type="button" class="cal-year-day'+(isSameDay(d,today)?" today":"")+'" onclick="calGoToDay(\''+k+'\')" title="'+escapeHtml(title)+'">'+d.getDate()+dot+'</button>';
		}
		html+='<div class="cal-year-month"><button type="button" class="cal-year-month-title" onclick="calGoToMonth('+year+','+m+')">'+CAL_MONTHS[m]+'</button>'+
			'<div class="cal-mini-grid">'+CAL_DOW_MINI.map(function(d){ return '<span class="cal-mini-dow">'+d+'</span>'; }).join("")+cells+'</div></div>';
	}
	html+='</div>';
	body.innerHTML=html;
}
function calGoToMonth(y,m){ calAnchor=new Date(y,m,1); calMiniAnchor=new Date(y,m,1); calSetView("month"); }

/* --- Liste görünümü --- */
function renderListView(body){
	const today=todayDate();
	const evs=calVisibleEvents();
	if(!evs.length){ body.innerHTML='<div class="cal-list-wrap"><div class="cal-empty">Etkinlik yok.<br>Sağ üstteki “+ Etkinlik” ile ekleyebilirsin.</div></div>'; return; }
	let html='<div class="cal-list">'; let lastDay=null;
	evs.forEach(function(e){
		if(e.tarih!==lastDay){
			lastDay=e.tarih; const d=parseKey(e.tarih); const isT=isSameDay(d,today);
			html+='<div class="cal-list-daysep'+(isT?" is-today":"")+'">'+fmtTrDate(e.tarih)+'<span class="dow">'+CAL_DOW[(d.getDay()+6)%7]+(isT?" · BUGÜN":"")+'</span></div>';
		}
		const ty=evType(e.tur), st=evStatus(e.durum);
		const evD=parseKey(e.tarih), isPast=evD&&evD<today;
		const meta=[]; if(e.yer) meta.push(escapeHtml(e.yer)); if(e.birim) meta.push(escapeHtml(e.birim));
		if(e.gorevli) meta.push("📷 "+escapeHtml(e.gorevli));
		if(Array.isArray(e.katilimcilar)&&e.katilimcilar.length) meta.push(e.katilimcilar.length+" katılımcı");
		html+='<button type="button" class="cal-ev" data-evid="'+e._id+'" data-act="peek">'+
			'<span class="cal-ev-dot" style="background:'+ty.renk+';"></span>'+
			'<span class="cal-ev-time">'+escapeHtml(e.saat||"—")+'</span>'+
			'<span class="cal-ev-main"><span class="cal-ev-name'+((e.durum==="yayinlandi"||e.durum==="iptal"||isPast)?" done":"")+'">'+escapeHtml(e.ad||"(adsız)")+'</span>'+badgeHtml(e)+
			'<span class="cal-ev-meta"><span class="cal-tag" style="background:'+st.renk+';">'+escapeHtml(st.ad)+'</span>'+meta.join(" · ")+'</span></span>'+
			(isAdminUser() ? '<span class="cal-ev-edit-ico" title="Düzenle" data-act="edit">✎</span>' : '')+
			'</button>';
	});
	body.innerHTML='<div class="cal-list-wrap">'+html+'</div></div>';
}

/* --- Sürükleyerek başka güne taşıma (SortableJS -- dokunmatik cihazlarda da çalışır, HTML5
   native drag&drop mobilde HİÇ desteklenmiyordu) --- */
// SortableJS'in evt.originalEvent'i, surukleme mouse mi dokunmatik-fallback mi bitirdigine gore
// FARKLI sekildedir: mouse bir MouseEvent'tir (clientX/clientY dogrudan ustte), dokunmatik ise
// TouchEvent'tir (clientX/clientY YOKTUR, changedTouches[0]'dan okunur). Ikisini de kapsar.
function pointerXY(nativeEvt){
	if(!nativeEvt) return null;
	if(nativeEvt.touches && nativeEvt.touches.length) return {x:nativeEvt.touches[0].clientX, y:nativeEvt.touches[0].clientY};
	if(nativeEvt.changedTouches && nativeEvt.changedTouches.length) return {x:nativeEvt.changedTouches[0].clientX, y:nativeEvt.changedTouches[0].clientY};
	if(typeof nativeEvt.clientY === "number") return {x:nativeEvt.clientX, y:nativeEvt.clientY};
	return null;
}
// requireEdit()/canEditData() gorsel olarak "surukle" hi butonunu gizler ama Sortable'in kendi
// engelleme mekanizmasi budur -- filter true donerse surukleme hic BASLAMAZ (calDragStart'taki
// e.preventDefault() ile ayni davranis). Kilitli etkinlikte toast icin onFilter kullanilir.
/* =====================================================================================
   KILIT SISTEMI (2026-08-26'da bastan yazildi)
   -------------------------------------------------------------------------------------
   Onceki hali dort ayri modul degiskenine (calLastFilterWasLockIcon / calLockedToastActive /
   calLockedAttemptCounts / calLockedToastEl) ve el ile eklenip kaldirilan global dinleyicilere
   dagilmisti; her yeni hata icin ustune bir yama daha binmisti ve web/mobil/iOS'ta farkli
   sekillerde bozuluyordu. Tum durum artik TEK bir nesnede (calLock) toplandi ve kurallar
   acikca yazildi:

     1) Kilit ikonuna dokunmak HER ZAMAN sadece kilidi acar/kapatir -- asla surukleme
        baslatmaz, asla "kilitli, tasinamaz" uyarisi cikarmaz.
     2) Kilitli bir etkinligi GOVDESINDEN suruklemeye calismak uyari verir; ama TEK bir
        dokunus/tiklama jesti boyunca yalnizca BIR KEZ (parmak basili tutuldugu surece
        SortableJS onFilter'i defalarca tetikler).
     3) Ekranda ayni anda EN FAZLA TEK kilit bildirimi bulunur (showToast'un "cal-lock"
        etiketi bunu garanti eder) -- eskiden ust uste 3 celiskili bildirim birikebiliyordu.
     4) Kilit durumu degistiginde onceki kilit bildirimleri artik GECERSIZ oldugu icin
        hemen kaldirilir; ilgisiz bildirilere (kayit kaydedildi vb.) DOKUNULMAZ.
     5) Ayni etkinlikte israrla denenirse 6. denemede daha esprili bir mesaja gecilir
        (kullanici istegi); kilit acilinca o sayac sifirlanir.
   ===================================================================================== */
const CAL_LOCK_TOAST_TAG = "cal-lock";
const calLock = {
	iconTapped: false,   // calSortableFilter -> calSortableOnFilter arasinda tek adimlik bayrak
	warnedThisGesture: false, // ayni jest icinde uyari zaten gosterildi mi
	attempts: {},        // etkinlik id -> ayri (parmak kaldirilan) deneme sayisi
	gestureBound: false  // jest-bitisi dinleyicileri su an bagli mi
};
// SortableJS'in filter dispatch'i onFilter'a orijinal olayi (dolayisiyla gercek dokunma
// hedefini) AKTARMIYOR -- sadece evt.item veriyor. "Kilit ikonuna mi dokunuldu" bilgisi bu
// yuzden filter asamasinda yakalanip tek adimlik bir bayrakla onFilter'a tasinmak zorunda.
function calSortableFilter(evt, item){
	// Resize kolu (.cal-resize-handle) de -- ayni sebeple -- SortableJS'in kendi
	// suruklemesine hic girmemeli; kendi ayri pointerdown/move/up jestini kullaniyor
	// (bkz. calStartResizeGesture). Aksi halde 150ms-delay'li Sortable surukleme, kolun
	// KENDI jestiyle YARISIR (ikisi de ayni pointerdown'i dinler).
	if(evt && evt.target && evt.target.closest && evt.target.closest(".cal-resize-handle")) return true;
	// Kilit ikonu suruklenebilir blogun ICINDE oldugu icin SortableJS dokunusu "surukleme
	// olabilir" diye yakalayip delayOnTouchOnly ile 150ms bekletiyor; bu, ikonu mobilde
	// "tiklanamaz" hissettiriyordu. filter true donerek surukleme daha basIamadan kesilir
	// (preventOnFilter:false oldugu icin ikonun kendi click'i normal calismaya devam eder).
	if(evt && evt.target && evt.target.closest && evt.target.closest(".cal-lock-ico")){
		calLock.iconTapped = true;
		return true;
	}
	calLock.iconTapped = false;
	if(!canEditData()) return true;
	const id=item && item.dataset ? item.dataset.evid : null;
	if(id && calEvents[id] && calEvents[id].locked) return true;
	return false;
}
// Bir dokunus/tiklama jestinin GERCEKTEN bittigini yakalar. Sabit bir sureye (debounce)
// guvenmek yetmiyordu: kullanici o sureden uzun basili tutunca ayni jest icinde ikinci bir
// uyari cikiyordu. Uc olay turu de dinlenir -- mobilde jest touchcancel ile de bitebilir.
function calLockGestureEnd(){
	calLock.warnedThisGesture = false;
	if(!calLock.gestureBound) return;
	calLock.gestureBound = false;
	document.removeEventListener("touchend", calLockGestureEnd);
	document.removeEventListener("touchcancel", calLockGestureEnd);
	document.removeEventListener("mouseup", calLockGestureEnd);
}
function calLockBindGestureEnd(){
	if(calLock.gestureBound) return;
	calLock.gestureBound = true;
	document.addEventListener("touchend", calLockGestureEnd);
	document.addEventListener("touchcancel", calLockGestureEnd);
	document.addEventListener("mouseup", calLockGestureEnd);
}
// Tum kilit bildirimleri TEK noktadan gecer -- "cal-lock" etiketi sayesinde yenisi eskisinin
// yerine gecer, ekranda asla iki kilit mesaji birden kalmaz.
function calLockNotify(msg, type){
	return showToast(msg, type, CAL_LOCK_TOAST_TAG);
}
function calSortableOnFilter(evt){
	// Kilit ikonuna dokunulduysa: filter zaten true dondu (surukleme engellendi) ve ikonun
	// kendi onclick'i kilidi degistirecek -- burada UYARI GOSTERILMEZ. Eskiden gosteriliyordu,
	// yani kullanici kilidi ACMAYA calisirken "kilitli, tasinamaz" uyarisi aliyordu.
	if(calLock.iconTapped){ calLock.iconTapped = false; return; }
	const item=evt.item; const id=item && item.dataset ? item.dataset.evid : null;
	if(!id || !calEvents[id] || !calEvents[id].locked) return;
	if(calLock.warnedThisGesture) return;
	calLock.warnedThisGesture = true;
	calLockBindGestureEnd();
	calLock.attempts[id] = (calLock.attempts[id] || 0) + 1;
	calLockNotify(
		calLock.attempts[id] >= 6
			? "Tamam tamam, kilidi aç artık 😄 taşınamaz."
			: "Bu etkinlik kilitli, taşımak için önce kilidi açın.",
		"error"
	);
}
// onMove her surukleme adiminda tekrar tekrar tetiklenir (dragover/touchmove) -- burada hem
// son bilinen isaretci konumu izlenir (onEnd'de asil kaynak (evt.originalEvent) basarisiz
// olursa yedek olsun diye) HEM DE surukelenen dugumun o an HANGI tur sutunun (saat izgarasi mi
// tum-gun seridi mi) uzerinde oldugu takip edilir -- .cal-block'un saat-izgarasina-ozel
// position:absolute yuzdeleri, dugum gecici olarak .cal-allday-col icine tasindiginda TAMAMEN
// yanlis bir kap boyutuna gore hesaplanip devasa/bozuk gorunuyordu (bkz. calSortableOptions
// cagrisindaki uzun not). .cal-block-cross-preview sinifi SADECE bu gecis aninda mutlak
// konumlandirmayi etkisiz kilar (style.css), .cal-daycol'a geri donunce kaldirilir.
function calOnDragMove(evt){
	const xy=pointerXY(evt.originalEvent); if(xy) calDragLastXY=xy;
	if(evt.dragged){
		const overAllDay = evt.to && evt.to.classList.contains("cal-allday-col");
		evt.dragged.classList.toggle("cal-block-cross-preview", !!overAllDay);
	}
	return true; // engelleme yok, sadece izliyoruz
}
// Suruklenen blogun KENDI ust kenari ile isaretcinin o anki dikey konumu arasindaki fark --
// surukleme BASLARKEN (blok henuz eski yerindeyken) bir kere olculur. Bu olculmeden onceki halde
// zaman hesabi DOGRUDAN isaretci konumundan yapiliyordu: kullanici bir etkinligin ORTASINDAN ya da
// ALTINDAN tutup suruklerse, blogun USTU isaretcinin oldugu saate ZIPLIYORDU (kullanicinin
// "elimin altindaki noktayi degil, imlecin bulundugu saati baz aliyor" seklinde bildirdigi hata).
// Simdi bu fark cikarilarak blogun KENDI ust kenarinin nereye tasindigi hesaplaniyor.
let calDragGrabOffsetY = 0;
// calDragActive: bir etkinlik suruklemesi gercekten basladiginda true -- gun/hafta swipe-ile-gezinme
// dinleyicisi (bkz. calendarOverlay touchstart/touchend) bununla cakismamak icin bu bayragi kontrol eder.
let calDragActive = false;
// Kullanici istegi: tasirken de (gun/saat degistirme) resize'daki AYNI silik "hayalet" -- eski
// konumu gosterir, birakinca kaybolur. SortableJS suruklenen dugumu FIZIKSEL olarak hedef listeye
// TASIDIGI icin orijinal konum sadece BURADA (onStart, evt.from hala eski sutunken) yakalanabilir.
let calDragMoveGhost = null;
function calOnDragStart(evt){
	calDragActive = true;
	calDragGrabOffsetY = 0;
	const xy = pointerXY(evt.originalEvent);
	if (xy && evt.item) {
		const r = evt.item.getBoundingClientRect();
		calDragGrabOffsetY = xy.y - r.top;
	}
	// Sadece saat izgarasindan (.cal-daycol) baslayan suruklemelerde -- tum-gun/ay gorunumu
	// bu deseni almiyor (resize'daki "v1: sadece saat izgarasi" kapsam karariyla tutarli).
	const id = evt.item && evt.item.dataset ? evt.item.dataset.evid : null;
	const ev = id ? calEvents[id] : null;
	if (ev && evt.from && evt.from.classList && evt.from.classList.contains("cal-daycol")) {
		const ghost = document.createElement("div");
		ghost.className = "cal-block cal-resize-ghost" + (evt.item.classList.contains("compact") ? " compact" : "");
		ghost.setAttribute("style", evt.item.getAttribute("style"));
		ghost.innerHTML = '<span class="bt">'+escapeHtml(ev.ad||"(adsız)")+'</span><span class="bh">'+escapeHtml(ev.saat||"")+(ev.bitisSaat?"–"+escapeHtml(ev.bitisSaat):"")+'</span>';
		evt.from.appendChild(ghost);
		calDragMoveGhost = ghost;
	}
	// Kullanici istegi: hareket eden blogun kendisi opak oldugu icin altindaki hayaleti (ozellikle
	// buyuyen/genisleyen yonde) tamamen kapatiyordu -- suruklenen/resize edilen blok gecici olarak
	// yari saydam yapilir, hayalet HER ZAMAN gorunur kalir (resize icin calStartResizeGesture'da
	// AYNI duzeltme uygulanir).
	if (evt.item) evt.item.style.opacity = "0.55";
}
async function calMoveEvent(id, dateKey, timeInfo){
	if(!id || !calEvents[id] || !requireEdit()) return;
	// calSortableFilter zaten kilitliyse suruklemeyi baslatmiyor; bu, surukleme basladiktan HEMEN
	// sonra baskasi kilitlerse diye ikinci bir savunma hatti.
	if(calEvents[id].locked){ showToast("Bu etkinlik kilitli, taşınamaz. Önce kilidi açın.", "error"); return; }
	const ev=calEvents[id];
	const before=Object.assign({}, ev);
	const patch={ tarih: dateKey };
	// Hafta görünümünde saat ızgarasına bırakıldıysa saat de güncellenir (yarım saate yuvarlanır).
	// Isaretci konumu (timeInfo.xy) hicbir kaynaktan (native/touch/izlenen son konum) cozulemediyse
	// -- son derece nadir -- saat SESSIZCE degistirilmez, sadece tarih guncellenir (yanlis bir
	// saate tahmin yurutmek, hic degistirmemekten daha kotu).
	if(timeInfo && timeInfo.isDayCol && timeInfo.xy){
		// ev.saat bos ise (tum-gun etkinlik) hmToMin(ev.saat) null donuyordu ve bu blok HIC
		// calismiyordu -- tum-gun etkinlik saat izgarasina birakildiginda saat asla atanmiyor,
		// tarih guncellenip patch.saat tanimsiz kaliyordu, etkinlik yeniden cizilince tekrar
		// tum-gun seridine "firliyor"du (kullanici: "tam gün içinde bir etkinlik var ise sorun
		// çıkıyor"). Suruklenen tum-gun etkinligine varsayilan 60dk sure verilerek duzeltildi.
		const grabOffset = timeInfo.grabOffsetY || 0;
		const mins0=Math.round(((timeInfo.xy.y-timeInfo.rectTop-grabOffset)/CAL_HOUR_H)*60/30)*30;
		const mins=Math.max(0,Math.min(23*60+30,mins0));
		const dur=(hmToMin(ev.saat)!==null && hmToMin(ev.bitisSaat)!==null && hmToMin(ev.bitisSaat)>hmToMin(ev.saat)) ? hmToMin(ev.bitisSaat)-hmToMin(ev.saat) : 60;
		patch.saat=minToHm(mins);
		patch.bitisSaat=minToHm(Math.min(24*60-1, mins+dur));
	} else if(timeInfo && timeInfo.isAllDayCol){
		patch.saat=""; patch.bitisSaat="";
	}
	if(ev.tarih===patch.tarih && patch.saat===undefined) return;
	const moved=Object.assign({}, ev, patch);
	const moveChanges=describeEventChanges(ev, moved);
	const res=await persistEvent(id, moved, evLogName(ev.ad)+" etkinliği takvimde taşındı ("+fmtTrDate(dateKey)+")"+(moveChanges.length?" · "+moveChanges.join(" · "):""));
	if(res){ calEvents[id]=moved; pushUndo({ type:"move", id:id, before:before, after:Object.assign({},moved) }); renderCalendar(); }
}
// Faz 9: etkinligin UST (baslangic) veya ALT (bitis) kenarindan surukleyerek saatini
// ayarlama. calMoveEvent()'in AYNI kaydetme sablonunu (before/patch/moved/
// describeEventChanges/persistEvent/pushUndo) birebir izler -- boylece log metni
// (describeEventChanges "saat"/"bitisSaat" alan adindan otomatik "Başlangıç Saati"/
// "Bitiş Saati" yazar), Ctrl+Z ve "baskasi degistirdi" koruma mantigi (persistEvent icinde)
// hicbir ek kod yazilmadan BEDAVA calisir. patch tek alanli: {saat:...} veya {bitisSaat:...}.
async function calResizeEvent(id, patch){
	if(!id || !calEvents[id] || !requireEdit()){ renderCalendar(); return; }
	// Ikinci savunma hatti: calStartResizeGesture zaten baslangicta kontrol ediyor, ama
	// surukleme SIRASINDA baskasi kilitlemis olabilir (calMoveEvent'teki ayni yorum/desen).
	if(calEvents[id].locked){ calLockNotify("Bu etkinlik kilitli, süresi değiştirilemez. Önce kilidi açın.", "error"); renderCalendar(); return; }
	const ev=calEvents[id];
	const before=Object.assign({}, ev);
	const moved=Object.assign({}, ev, patch);
	const resizeChanges=describeEventChanges(ev, moved);
	const res=await persistEvent(id, moved, evLogName(ev.ad)+" etkinliğinin süresi ayarlandı"+(resizeChanges.length?" · "+resizeChanges.join(" · "):""));
	if(res){ calEvents[id]=moved; pushUndo({ type:"resize", id:id, before:before, after:Object.assign({},moved) }); }
	// Basarisiz olursa calEvents hic degismedi -- renderCalendar() gorsel-sadece onizlemeyi
	// (surukleme sirasinda dogrudan DOM'a yazilan top/height/saat metni) otomatik olarak eski
	// haline dondurur, ayri bir "geri al" kodu gerekmez.
	renderCalendar();
}
// Faz 9 Part D: bos saat izgarasinda basili tutup surukleyerek yeni etkinlik icin saat
// araligi SECME jesti (Windows masaustundeki mavi "rubber-band select" kutusuna kullanici
// isteği benzetmesi). calStartResizeGesture ile AYNI pointerdown dinleyicisine bagli
// (bkz. #calendarOverlay listener) -- kendi guard'i (.cal-block/.cal-resize-handle DISI)
// sayesinde resize/move jestleriyle CAKISMAZ. Kisa bir tiklama (<3px) ise hicbir sey
// yapmadan cikar, mevcut calGridClick() (tek-tikla-olustur, click event'inde tetiklenir)
// eski davranisiyla DEVAM eder -- degisiklik yok, sadece GERCEK bir surukleme onu suppress eder.
let calGridSelectSuppressClick = false;
function calStartGridSelectGesture(e){
	if(e.target.closest(".cal-resize-handle")) return; // resize'a birak
	if(e.target.closest(".cal-block")) return; // mevcut etkinligin uzerinde -- move-drag'e (SortableJS) birak
	const daycol=e.target.closest(".cal-daycol");
	if(!daycol) return;
	if(!canEditData()) return; // calGridClick'teki AYNI sessiz guard (toast yok)
	const dateKey=daycol.dataset.date;
	if(!dateKey) return;
	const pointerId=e.pointerId;
	daycol.setPointerCapture(pointerId);
	const rect=daycol.getBoundingClientRect();
	function minsFromY(y){
		// 15dk snap -- resize'in 5dk'sindan kaba (bu sadece kaba bir ilk secim, ince ayar
		// modalde yapilir), tek-tikin 30dk'sindan ince ("kaba secim, ince ayar modalde" dengesi).
		let m=Math.round(((y-rect.top)/CAL_HOUR_H)*60/15)*15;
		return Math.max(0,Math.min(24*60,m));
	}
	const anchorMin=minsFromY(e.clientY);
	let startMin=anchorMin, endMin=anchorMin;
	let moved=false;
	let lastBroadcastTs=0, liveOnDisconnectSet=false;

	const ghost=document.createElement("div");
	ghost.className="cal-create-select";
	daycol.appendChild(ghost);
	function applyLive(){
		ghost.style.top=((startMin/60)*CAL_HOUR_H)+"px";
		ghost.style.height=Math.max(18, ((endMin-startMin)/60)*CAL_HOUR_H)+"px";
		ghost.textContent=minToHm(startMin)+"–"+minToHm(endMin);
	}
	applyLive();

	function broadcastLive(){
		// Kullanici istegi: "diger kullanicilar da ... silueti gorsunler ben yaparken" -- projede
		// ILK ephemeral/presence yazimi. Throttle'li (>=150ms) -- her pointermove'da yazmak
		// Firebase'i gereksiz yere doldururdu. onDisconnect().remove() SADECE ilk yazimdan sonra
		// BIR KEZ kurulur -- sekme kapanirsa/baglanti koparsa silis OTOMATIK temizlenir.
		if(!database || !currentUser || !currentUser.uid) return;
		const now=Date.now();
		if(now-lastBroadcastTs<150) return;
		lastBroadcastTs=now;
		const liveRef=database.ref(dbPath("canliTakvimSecim/"+currentUser.uid));
		liveRef.set({
			ad: (currentUser.firstName||currentUser.email||"Bir kullanıcı"),
			tarih: dateKey, saat: minToHm(startMin), bitisSaat: minToHm(endMin),
			ts: firebase.database.ServerValue.TIMESTAMP
		}).catch(function(){});
		if(!liveOnDisconnectSet){ liveOnDisconnectSet=true; liveRef.onDisconnect().remove(); }
	}
	function clearLiveBroadcast(){
		if(!database || !currentUser || !currentUser.uid || !liveOnDisconnectSet) return;
		const liveRef=database.ref(dbPath("canliTakvimSecim/"+currentUser.uid));
		liveRef.remove().catch(function(){});
		liveRef.onDisconnect().cancel();
	}

	function onMove(e2){
		if(e2.pointerId!==pointerId) return;
		if(Math.abs(e2.clientY-e.clientY)>3) moved=true;
		const curMin=minsFromY(e2.clientY);
		if(curMin<anchorMin){ startMin=curMin; endMin=Math.max(anchorMin, curMin+15); }
		else { startMin=anchorMin; endMin=Math.max(anchorMin+15, curMin); }
		applyLive();
		if(moved) broadcastLive();
	}
	function onUp(e2){
		if(e2.pointerId!==pointerId) return;
		try{ daycol.releasePointerCapture(pointerId); }catch(err){}
		window.removeEventListener("pointermove", onMove);
		window.removeEventListener("pointerup", onUp);
		window.removeEventListener("pointercancel", onUp);
		ghost.remove();
		clearLiveBroadcast();
		if(!moved) return; // kisa tiklama -- calGridClick'in eski tek-tik davranisi CALISMAYA devam etsin
		calGridSelectSuppressClick=true; // ayni pointerup/click ciftinde calGridClick TEKRAR acmasin
		openEventModal(null, dateKey, minToHm(startMin), minToHm(endMin));
	}
	window.addEventListener("pointermove", onMove);
	window.addEventListener("pointerup", onUp);
	window.addEventListener("pointercancel", onUp);
}
// pointerdown/move/up ile calisan, SortableJS'ten TAMAMEN bagimsiz, kendi kendine yeten bir
// jest. Pointer Events mouse+dokunmatigi tek API'de birlestirdigi icin (setPointerCapture)
// ayri bir touch/mouse dali YAZILMADI -- SortableJS'in touch/mouse'u ayri ele almasi KENDI
// API kisiti, bizim izole/yeni kolumuz buna baglı degil. .cal-resize-handle-top UST kenardan
// (baslangic saatini), duzenli .cal-resize-handle ALT kenardan (bitis saatini) ayarlar --
// ikisi de ayni kodu paylasir, sadece hangi ucun sabit kaldigi degisir.
function calStartResizeGesture(e){
	const handle=e.target.closest(".cal-resize-handle");
	if(!handle) return;
	e.stopPropagation(); // SortableJS/peek tiklamasina sizmasin (calSortableFilter zaten
	                      // Sortable'in KENDI suruklemesini engelliyor, bu ayrica DOM bubble'ini keser)
	const isTop=handle.classList.contains("cal-resize-handle-top");
	const block=handle.closest(".cal-block[data-evid]");
	const id=block && block.dataset ? block.dataset.evid : null;
	const ev=id ? calEvents[id] : null;
	if(!ev) return;
	// Birinci savunma hatti (calSortableFilter'daki .cal-lock-ico kontroluyle ayni desen):
	// kilitli etkinlikte jest hic baslamaz, tek-seferlik kilit uyarisi verilir.
	if(ev.locked){ calLockNotify("Bu etkinlik kilitli, süresi değiştirilemez. Önce kilidi açın.", "error"); return; }
	if(!requireEdit()) return;
	const daycol=block.closest(".cal-daycol");
	const origStartMin=hmToMin(ev.saat);
	if(!daycol || origStartMin===null) return;
	let origEndMin=hmToMin(ev.bitisSaat);
	if(origEndMin===null || origEndMin<=origStartMin) origEndMin=Math.min(24*60, origStartMin+60);
	const pointerId=e.pointerId;
	handle.setPointerCapture(pointerId);
	document.body.style.cursor="ns-resize";
	let moved=false;
	let startMin=origStartMin, endMin=origEndMin;

	// Kullanici istegi: surukleme SIRASINDA eski (degismeden onceki) saat araligi silik bir
	// "hayalet" olarak block'un ALTINDA kalsin -- "hangi saatten hangi saate" degistigi hem
	// hayaletten (eski) hem hareket eden block'tan (yeni, canli) ayni anda gorulsun. Bırakınca
	// (onUp) kaldirilir. block'un KENDI position:absolute stilini (top/height/left/width/renk)
	// aynen kopyalar, ayni .cal-daycol'a eklenir.
	const ghost=document.createElement("div");
	ghost.className="cal-block cal-resize-ghost"+(block.classList.contains("compact")?" compact":"");
	ghost.setAttribute("style", block.getAttribute("style"));
	ghost.innerHTML='<span class="bt">'+escapeHtml(ev.ad||"(adsız)")+'</span><span class="bh">'+escapeHtml(ev.saat||"")+"–"+escapeHtml(minToHm(Math.min(24*60-1,origEndMin)))+'</span>';
	daycol.appendChild(ghost);
	// Kullanici istegi: block opak oldugu icin (ozellikle BUYUYEN yonde) altindaki hayaleti
	// tamamen kapatiyordu -- gecici yari saydamlik, hayalet boyut iliskisinden BAGIMSIZ HER ZAMAN
	// gorunur kalsin diye (calOnDragStart'taki AYNI duzeltme, tasima suruklemesi icin).
	block.style.opacity="0.55";

	function applyLive(){
		block.style.top=((startMin/60)*CAL_HOUR_H)+"px";
		block.style.height=Math.max(18, ((endMin-startMin)/60)*CAL_HOUR_H-2)+"px";
		const bh=block.querySelector(".bh");
		if(bh) bh.textContent=minToHm(startMin)+"–"+minToHm(Math.min(24*60-1, endMin));
	}
	function onMove(e2){
		if(e2.pointerId!==pointerId) return;
		if(Math.abs(e2.clientY-e.clientY)>3) moved=true;
		const rect=daycol.getBoundingClientRect();
		const rawMin=((e2.clientY-rect.top)/CAL_HOUR_H)*60;
		// 5 dakikaya yuvarla -- tasima/tik-olusturmanin 30dk'lik snap'inden (calMoveEvent,
		// calGridClick) BILINCLI olarak daha ince, cunku resize'in amaci ince ayar yapmak.
		let snapped=Math.round(rawMin/5)*5;
		if(isTop){
			// UST kenar: bitis (origEndMin) SABIT kalir, baslangic gun basiyla bitis-5dk arasinda kelepcelenir.
			snapped=Math.max(0, Math.min(origEndMin-5, snapped));
			startMin=snapped;
		} else {
			// ALT kenar: baslangic (origStartMin) SABIT kalir, bitis baslangic+5dk ile gun sonu arasinda kelepcelenir.
			snapped=Math.max(origStartMin+5, Math.min(24*60, snapped));
			endMin=snapped;
		}
		applyLive(); // SADECE gorsel onizleme -- Firebase'e henuz yazilmiyor, bkz. onUp().
	}
	function onUp(e2){
		if(e2.pointerId!==pointerId) return;
		try{ handle.releasePointerCapture(pointerId); }catch(err){}
		document.body.style.cursor="";
		window.removeEventListener("pointermove", onMove);
		window.removeEventListener("pointerup", onUp);
		window.removeEventListener("pointercancel", onUp);
		ghost.remove(); // "ama bırakınca gitsin silüet"
		block.style.opacity="";
		if(!moved) return; // yanlislikla tiklama -- degisiklik yok, kaydetmeye gerek yok
		// 24*60-1 (23:59) ile kelepceleniyor, TAM 24*60 degil -- minToHm(1440) "00:00" donup
		// (Math.floor(1440/60)%24===0) bitis saatini yanlislikla GUN BASI gibi gostermesin diye.
		const patch=isTop ? { saat: minToHm(startMin) } : { bitisSaat: minToHm(Math.min(24*60-1, endMin)) };
		calResizeEvent(id, patch);
	}
	window.addEventListener("pointermove", onMove);
	window.addEventListener("pointerup", onUp);
	window.addEventListener("pointercancel", onUp);
}
// SortableJS onEnd adaptoru -- ince katman, sadece Sortable'in evt seklinden gerekli bilgiyi
// (id/hedef tarih/isaretci konumu) cikarip calMoveEvent()'e devreder. Testler calMoveEvent()'i
// dogrudan cagirabilir, sahte bir Sortable evt'si kurmaya gerek kalmadan.
function calOnDragEnd(evt){
	calDragActive = false;
	calDragLastXY=null; // her surukleme sonunda sifirla, bir sonraki icin yeni izlemeye basla
	// Hayalet/opaklik HER durumda (asagidaki erken return'ler dahil) temizlenir -- kalici
	// yari-saydam blok ya da ekranda unutulmus hayalet birakmamak icin en basta yapilir.
	if (calDragMoveGhost) { calDragMoveGhost.remove(); calDragMoveGhost = null; }
	if (evt.item) evt.item.style.opacity = "";
	// calMoveEvent() bazen ERKEN doner (gercek bir degisiklik yoksa) ve renderCalendar()
	// CAGIRMAZ -- bu durumda calOnDragMove()'un son eklemis olabilecegi .cal-block-cross-preview
	// sinifi kalici kalmasin diye burada da guvenlik agi olarak temizlenir.
	if(evt.item && evt.item.classList) evt.item.classList.remove("cal-block-cross-preview");
	const id=evt.item && evt.item.dataset.evid;
	const to=evt.to; if(!id || !to) return;
	const dateKey=to.dataset.date; if(!dateKey) return;
	const isDayCol=to.classList.contains("cal-daycol");
	const isAllDayCol=to.classList.contains("cal-allday-col");
	const xy=pointerXY(evt.originalEvent) || calDragLastXY;
	const timeInfo={ isDayCol:isDayCol, isAllDayCol:isAllDayCol, xy:xy, rectTop: isDayCol ? to.getBoundingClientRect().top : 0, grabOffsetY: calDragGrabOffsetY };
	calDragGrabOffsetY = 0;
	calMoveEvent(id, dateKey, timeInfo);
}
function calSortableOptions(groupName){
	return {
		group: { name: groupName, pull: true, put: true },
		// draggable KRITIK: .cal-daycol icinde etkinlik butonlarinin YANI SIRA 23 adet
		// .cal-hrline (saat cizgisi) ve .cal-nowline gibi tamamen dekoratif, mutlak
		// konumlandirilmis div de var. draggable belirtilmezse SortableJS bunlarin HEPSINI
		// siralanabilir birer oge sayip birakma konumunu onlara gore hesapliyordu -- sutunun
		// ORTASINDA her zaman bir saat cizgisi oldugu icin surukleme oraya "tutunamiyor",
		// yalnizca ilk cizginin USTU ve son cizginin ALTI calisiyordu (kullanici: "sadece tam
		// en üstten ve tam en alttan etkinlik günü değiştirebiliyorum"). Artik SADECE gercek
		// etkinlik ogeleri suruklenebilir/hedef sayilir: .cal-block (hem saat izgarasi hem de ay
		// gorunumundeki chip'ler bu sinifi kullanir) ve .cal-allday-chip (tum-gun seridi).
		// Ay gorunumundeki ".cal-more" (+N tane daha) butonu da boylece haric kalir -- o bir
		// etkinlik degil, sadece bir genisletme tetikleyicisi.
		draggable: ".cal-block, .cal-allday-chip",
		animation: 150, ghostClass: "dragging",
		delay: 150, delayOnTouchOnly: true, // person-list reorder ile ayni dokunmatik-guvenli kalip (bkz. Sortable kullanimi render()'da)
		// preventOnFilter varsayilani true -- filter eslesince SortableJS otomatik olarak
		// touchstart/mousedown'a preventDefault() cagirir. Kilit ikonu icin bu ISTENMEYEN bir
		// yan etki yaratiyordu: preventDefault() edilen bir touchstart'tan SONRA bazi mobil
		// tarayicilar sentezlenmis "click" olayini HIC ATESLEMIYOR, yani ikonun KENDI onclick'i
		// (toggleEventLock) hicbir zaman calismiyordu -- filter dogru calisip suruklemeyi
		// engellese bile, ikon "tiklanamaz" gibi hissettiriyordu. false yapilarak dokunusun
		// normal click-sonrasi davranisi korunuyor.
		preventOnFilter: false,
		filter: calSortableFilter, onFilter: calSortableOnFilter,
		onStart: calOnDragStart, onMove: calOnDragMove, onEnd: calOnDragEnd
	};
}

/* --- Etkinlik detay paneli (sağdan açılan peek) --- */
function openEventPeek(id){
	const e=calEvents[id]; if(!e) return;
	calPeekedId=id;
	const ty=evType(e.tur), st=evStatus(e.durum);
	document.getElementById("calPeekTitle").textContent=e.ad||"(adsız etkinlik)";
	function row(k,v){ return v ? '<div class="cal-detail-row"><span class="k">'+k+'</span><span class="v">'+v+'</span></div>' : ""; }
	const saatTxt=e.saat ? (escapeHtml(e.saat)+(e.bitisSaat?" – "+escapeHtml(e.bitisSaat):"")) : "Tüm gün";
	const att=sortAttendeesByProtocol(Array.isArray(e.katilimcilar)?e.katilimcilar:[]);
	const attHtml=att.length ? att.map(function(a){
		return '<span class="cal-att-chip">'+escapeHtml(((a.prefix?a.prefix+" ":"")+(a.name||"")).trim())+(a.title?' · '+escapeHtml(a.title):'')+'</span>';
	}).join("") : "";
	document.getElementById("calPeekBody").innerHTML=
		row("Tür",'<span class="cal-tag" style="background:'+ty.renk+';">'+escapeHtml(ty.ad)+'</span>')+
		row("Durum",'<span class="cal-tag" style="background:'+st.renk+';">'+escapeHtml(st.ad)+'</span>')+
		row("Tarih", escapeHtml(fmtTrDate(e.tarih))+' <span style="color:var(--muted);">'+CAL_DOW[((parseKey(e.tarih)||new Date()).getDay()+6)%7]+'</span>')+
		row("Saat", saatTxt)+
		row("Yer", escapeHtml(e.yer||""))+
		row("Birim", escapeHtml(e.birim||""))+
		row("Planlayan", escapeHtml(e.planlayan||""))+
		row("Haber Kaynağı", escapeHtml(e.haberKaynagi||""))+
		row("Basın", escapeHtml(e.gorevli||""))+
		row("Katılımcılar", attHtml)+
		row("Arşiv", e.arsiv ? '<a href="'+escapeHtml(safeLinkUrl(e.arsiv))+'" target="_blank" rel="noopener noreferrer">Klasörü aç ↗</a>' : "")+
		row("Not", escapeHtml(e.not||""));
	document.getElementById("calPeekNewsBtn").style.display = att.length ? "" : "none";
	// Sahadaki kullanım: etkinlik başlamadıysa "başlat", başladıysa "bitir" damgası basar.
	const qb=document.getElementById("calPeekQuickBtn");
	if(qb){
		if(!e.saat) qb.textContent="▶  Şimdi Başlat";
		else if(!e.bitisSaat) qb.textContent="■  Şimdi Bitir";
		else qb.textContent="Bitişi Şimdiye Al";
	}
	document.getElementById("calPeek").classList.add("open");
	document.getElementById("calPeekBackdrop").classList.add("open");
}
function closeEventPeek(){
	calPeekedId=null;
	document.getElementById("calPeek").classList.remove("open");
	document.getElementById("calPeekBackdrop").classList.remove("open");
}
function editPeekedEvent(){ if(calPeekedId) openEventModal(calPeekedId); }

// Etkinlik o an başlıyor/bitiyorsa tek dokunuşla saatini damgalar ve buluta yazar.
async function eventQuickStamp(){
	if(!requireEdit() || !calPeekedId) return;
	const e=calEvents[calPeekedId]; if(!e){ showToast("Etkinlik bulunamadı.", "error"); return; }
	const before=Object.assign({}, e);
	const nw=new Date(); const hm=pad2(nw.getHours())+":"+pad2(nw.getMinutes());
	const patch=Object.assign({}, e);
	let label, toast;
	if(!e.saat){
		patch.saat=hm;
		if(patch.bitisSaat && hmToMin(patch.bitisSaat)<=hmToMin(hm)) patch.bitisSaat="";
		label=(e.ad||"Etkinlik")+" etkinliği "+hm+" olarak başlatıldı";
		toast="Başlangıç "+hm+" olarak işaretlendi.";
	} else {
		// Gece yarısını aşan etkinlikler bu tuşla tutarsız kayıt üretmesin.
		if(hmToMin(hm)<=hmToMin(e.saat)){
			showToast("Şu anki saat başlangıçtan önce, bitiş elle girilmeli.", "error"); return;
		}
		patch.bitisSaat=hm;
		if((patch.durum||"planlandi")==="planlandi") patch.durum="cekildi";
		label=(e.ad||"Etkinlik")+" etkinliği "+hm+" olarak bitirildi";
		toast="Bitiş "+hm+" olarak işaretlendi.";
	}
	patch.guncellemeTs=Date.now();
	const stampChanges=describeEventChanges(e, patch);
	// calPeekedId GLOBAL: await suresince panel kapatilirsa null olur ve asagida
	// calEvents[null] adinda HAYALET bir kayit olusurdu (takvimde cift gorunum +
	// Ctrl+Z'de veritabanina kopya ekleme). Id await'ten ONCE sabitlenir.
	const peekId = calPeekedId;
	const ok=await persistEvent(peekId, patch, evLogName(label)+(stampChanges.length?" · "+stampChanges.join(" · "):""));
	if(!ok) return;
	calEvents[peekId]=patch;
	pushUndo({ type:"edit", id:peekId, before:before, after:Object.assign({},patch) });
	openEventPeek(peekId);
	renderCalendar();
	showToast(toast, "success");
}
// Arşiv bağlantısı da <a href> içine gidiyor; javascript: gibi şemalar engellenir.
function safeLinkUrl(u){
	const s=String(u===undefined||u===null?"":u).trim();
	return /^https?:\/\//i.test(s) ? s : "";
}

/* --- Etkinlik ekle / düzenle --- */
function openEventModal(id, presetDate, presetTime, presetEndTime){
	if(!requireEdit()) return;
	calEditingId=id||null;
	const form=document.getElementById("eventForm"); form.reset();
	// tür ve durum listeleri
	document.getElementById("ev_tur").innerHTML=EVENT_TYPES.map(function(t){ return '<option value="'+t.key+'">'+escapeHtml(t.ad)+'</option>'; }).join("");
	document.getElementById("ev_durum").innerHTML=EVENT_STATUS.map(function(s){ return '<option value="'+s.key+'">'+escapeHtml(s.ad)+'</option>'; }).join("");
	// birim önerileri
	const birimler=FACULTY_GROUPS.reduce(function(a,g){ return a.concat(g.items); },[]);
	document.getElementById("ev_birimList").innerHTML=birimler.map(function(b){ return '<option value="'+escapeHtml(b)+'">'; }).join("");

	const e = id ? calEvents[id] : null;
	document.getElementById("eventModalTitle").textContent = e ? "Etkinliği Düzenle" : "Yeni Etkinlik";
	document.getElementById("ev_deleteBtn").style.display = e ? "" : "none";
	document.getElementById("ev_ad").value = e ? (e.ad||"") : "";
	document.getElementById("ev_tur").value = e ? (e.tur||"diger") : "diger";
	document.getElementById("ev_durum").value = e ? (e.durum||"planlandi") : "planlandi";
	(function(){
		const sel = new Set(e && Array.isArray(e.rozetler) ? e.rozetler : []);
		document.getElementById("ev_badgeBox").innerHTML = EVENT_BADGES.map(function(b){
			return '<label style="display:flex; align-items:center; gap:5px; font-size:13px; cursor:pointer;"><input type="checkbox" class="ev-badge-cb" value="'+b.key+'" '+(sel.has(b.key)?"checked":"")+'> '+escapeHtml(b.ad)+'</label>';
		}).join("");
	})();
	document.getElementById("ev_tarih").value = e ? (e.tarih||"") : (presetDate || dKey(calAnchor));
	document.getElementById("ev_saat").value = e ? (e.saat||"") : (presetTime || "");
	document.getElementById("ev_bitisSaat").value = e ? (e.bitisSaat||"") : (presetEndTime || "");
	document.getElementById("ev_yer").value = e ? (e.yer||"") : "";
	document.getElementById("ev_birim").value = e ? (e.birim||"") : "";
	document.getElementById("ev_planlayan").value = e ? (e.planlayan||"") : "";
	calPressStaff = e ? parseGorevliString(e.gorevli) : [];
	document.getElementById("ev_gorevliSearch").value="";
	renderPressStaffPicker();
	const gorevliToken = ++gorevliLoadToken;
	loadPressOfficerPool().then(function(){
		if(gorevliToken!==gorevliLoadToken) return; // bu arada baska bir etkinlik modali acildi, bu sonuc artik gecersiz
		if(!e && !calPressStaff.length && currentUser){
			const selfName=((currentUser.firstName||"")+" "+(currentUser.lastName||"")).trim();
			if(pressOfficerPool.some(function(p){ return p.name===selfName; })) calPressStaff=[selfName];
		}
		renderPressStaffPicker();
	});
	document.getElementById("ev_arsiv").value = e ? (e.arsiv||"") : "";
	document.getElementById("ev_haberKaynagi").value = e ? (e.haberKaynagi||"") : "";
	document.getElementById("ev_not").value = e ? (e.not||"") : "";
	calAttendees = (e && Array.isArray(e.katilimcilar)) ? e.katilimcilar.map(function(a){ return { prefix:a.prefix||"", name:a.name||"", title:a.title||"", rank:a.rank!==undefined?a.rank:"", kaynak:a.kaynak||"universite" }; }) : [];
	document.getElementById("ev_attSearch").value="";
	renderEventAttendeePicker();
	closeEventPeek();
	document.getElementById("eventModalBg").classList.add("open");
}
// Form içindeki küçük "şimdi" tuşu: o anki saati ilgili kutuya yazar.
function setEventTimeNow(fieldId){
	const el=document.getElementById(fieldId); if(!el) return;
	const nw=new Date();
	el.value=pad2(nw.getHours())+":"+pad2(nw.getMinutes());
	// Bitiş yazılıp başlangıç boşsa, kayıt sırasında tuhaf durum oluşmasın diye uyarılır.
	if(fieldId==="ev_bitisSaat" && !document.getElementById("ev_saat").value){
		showToast("Başlangıç saati de girilmeli.", "error");
	}
}

function closeEventModal(){ document.getElementById("eventModalBg").classList.remove("open"); calEditingId=null; }

// İl Protokolü havuzu: kalıcı bir ikinci Firebase dinleyicisi AÇILMAZ, sadece checkbox
// ilk işaretlendiğinde tek seferlik .once('value') ile okunup burada önbelleğe alınır.
let ilPoolCache = null;
function onAttIncludeIlToggle(){
	const cb = document.getElementById("ev_attIncludeIl");
	if (!cb.checked || ilPoolCache !== null) { renderEventAttendeePicker(); return; }
	if (!database) { renderEventAttendeePicker(); return; }
	database.ref(dbPath("ilProtokolVerileri")).once("value").then(function(snap){
		ilPoolCache = normalizeSnapshotArray(snap.val());
		renderEventAttendeePicker();
	}).catch(function(err){
		console.error("İl Protokolü okunamadı:", err);
		showToast("İl Protokolü okunamadı.", "error");
		cb.checked = false;
		renderEventAttendeePicker();
	});
}

// Katılımcı seçici: kişileri üniversite listesinden okur (yoksa aktif listeden).
// "İl Protokolünü de dahil et" işaretliyse ilPoolCache de havuza katılır; ayni isim+ayni
// calistigi birim ikisinde de varsa TEK kisiye indirgenir ve İl Protokolü kaydı KAZANIR
// (haberde dışarıdan gelen protokol bilgisi İl+Üniversite'yi zaten birlestirdigi icin).
function renderEventAttendeePicker(){
	const box=document.getElementById("ev_attendeeBox"); if(!box) return;
	const q=(document.getElementById("ev_attSearch").value||"").trim().toLocaleLowerCase("tr");
	const includeIl = document.getElementById("ev_attIncludeIl").checked && ilPoolCache;
	let pool;
	if (includeIl) {
		const merged = new Map();
		// kaynak etiketi: sıralama sırasında (bkz. generateNewsText) İl kaynaklı kişiler
		// üniversite kaynaklılardan önce gelsin diye -- orijinal kayıt mutasyona uğramıyor.
		function addAll(list, kaynak){
			list.forEach(function(p){
				if ((p.status && p.status !== "aktif") || !p.name) return;
				const key = (p.name||"").trim().toLocaleLowerCase("tr") + "|" + (p.unit||"").trim().toLocaleLowerCase("tr");
				merged.set(key, Object.assign({}, p, { kaynak: kaynak }));
			});
		}
		addAll(peopleList(), "universite"); addAll(ilPoolCache, "il");
		pool = Array.from(merged.values());
	} else {
		pool=peopleList().filter(function(p){ return (!p.status||p.status==="aktif") && p.name; });
	}
	const filtered=pool.filter(function(p){ return ((p.name||"")+" "+(p.title||"")+" "+(p.unit||"")).toLocaleLowerCase("tr").includes(q); }).slice(0,120);
	const selKeys=new Set(calAttendees.map(function(a){ return (a.name||"")+"|"+(a.title||""); }));
	let html="";
	// Seçili olup listede görünmeyenleri de üstte göster ki kaldırılabilsin.
	calAttendees.forEach(function(a){
		const k=(a.name||"")+"|"+(a.title||"");
		if(filtered.some(function(p){ return (p.name||"")+"|"+(p.title||"")===k; })) return;
		html+='<label class="ev-att-item"><input type="checkbox" class="ev-att-cb" data-key="'+escapeHtml(k)+'" checked><span><b>'+escapeHtml(a.name)+'</b> <span class="sub">'+escapeHtml(a.title||"")+'</span></span></label>';
	});
	html+=filtered.map(function(p){
		const k=(p.name||"")+"|"+(p.title||"");
		return '<label class="ev-att-item"><input type="checkbox" class="ev-att-cb" data-key="'+escapeHtml(k)+'" data-prefix="'+escapeHtml(p.prefix||"")+'" data-name="'+escapeHtml(p.name||"")+'" data-title="'+escapeHtml(p.title||"")+'" data-rank="'+escapeHtml(p.rank!==undefined&&p.rank!==null?String(p.rank):"")+'" data-kaynak="'+escapeHtml(p.kaynak||"universite")+'" '+(selKeys.has(k)?"checked":"")+'><span><b>'+escapeHtml(p.name)+'</b> <span class="sub">'+escapeHtml(p.title||"")+'</span></span></label>';
	}).join("");
	if(!html) html='<p class="hint" style="margin:6px;">Eşleşen kişi yok.</p>';
	box.innerHTML=html;
}
document.addEventListener("change", function(e){
	const cb=e.target;
	if(!cb.classList || !cb.classList.contains("ev-att-cb")) return;
	const key=cb.dataset.key;
	if(cb.checked){
		if(!calAttendees.some(function(a){ return (a.name||"")+"|"+(a.title||"")===key; })){
			calAttendees.push({ prefix:cb.dataset.prefix||"", name:cb.dataset.name||key.split("|")[0], title:cb.dataset.title||key.split("|")[1]||"", rank:cb.dataset.rank||"", kaynak:cb.dataset.kaynak||"universite" });
		}
	} else {
		calAttendees=calAttendees.filter(function(a){ return (a.name||"")+"|"+(a.title||"")!==key; });
	}
});

// "Basın Görevlisi" seçici: admin tarafından işaretlenmiş kullanıcılar arasından
// çoklu seçim yapılır; kaydederken isimler virgülle birleştirilip alfabetik sıraya
// dizilir (eski tek-isimli kayıtlarla da geriye dönük uyumlu, çünkü tek isim de
// virgülle ayrılmış 1 elemanlı bir liste olarak aynı şekilde işlenir).
function parseGorevliString(s){ return String(s||"").split(",").map(function(x){ return x.trim(); }).filter(Boolean); }
function loadPressOfficerPool(){
	if(!database) return Promise.resolve();
	return database.ref(dbPath("basinGorevlileri")).once("value").then(function(snap){
		const obj=snap.val()||{};
		pressOfficerPool=Object.keys(obj).map(function(uid){ return { uid:uid, name:String(obj[uid]||"").trim() }; }).filter(function(p){ return p.name; });
		pressOfficerPool.sort(function(a,b){ return a.name.localeCompare(b.name,"tr"); });
	}).catch(function(){ /* sessizce yut: secici bos gelir ama modal calismaya devam eder */ });
}
function renderPressStaffPicker(){
	const box=document.getElementById("ev_gorevliBox"); if(!box) return;
	const q=(document.getElementById("ev_gorevliSearch").value||"").trim().toLocaleLowerCase("tr");
	const filtered=pressOfficerPool.filter(function(p){ return p.name.toLocaleLowerCase("tr").includes(q); });
	let html="";
	// Seçili olup listede (arama sonucunda) görünmeyenleri de üstte göster ki kaldırılabilsin.
	calPressStaff.forEach(function(name){
		if(filtered.some(function(p){ return p.name===name; })) return;
		html+='<label class="ev-att-item"><input type="checkbox" class="ev-gorevli-cb" data-name="'+escapeHtml(name)+'" checked><span><b>'+escapeHtml(name)+'</b></span></label>';
	});
	html+=filtered.map(function(p){
		return '<label class="ev-att-item"><input type="checkbox" class="ev-gorevli-cb" data-name="'+escapeHtml(p.name)+'" '+(calPressStaff.indexOf(p.name)!==-1?"checked":"")+'><span><b>'+escapeHtml(p.name)+'</b></span></label>';
	}).join("");
	if(!html) html='<p class="hint" style="margin:6px;">'+(pressOfficerPool.length?"Eşleşen kişi yok.":"Henüz admin tarafından işaretlenmiş basın görevlisi yok.")+'</p>';
	box.innerHTML=html;
}
document.addEventListener("change", function(e){
	const cb=e.target;
	if(!cb.classList || !cb.classList.contains("ev-gorevli-cb")) return;
	const name=cb.dataset.name||"";
	if(cb.checked){ if(calPressStaff.indexOf(name)===-1) calPressStaff.push(name); }
	else { calPressStaff=calPressStaff.filter(function(n){ return n!==name; }); }
});

/* --- Etkinlik log detayları --- */
// Etkinliğin KENDİSİ Firebase'de aynı anahtarın üzerine yazılır (geçmiş kopya tutulmaz);
// her düzenleme için logs/etkinlik altına AYRI bir log satırı eklenir. Böylece kaydın son hâli tek,
// ama "kim, ne zaman, hangi alanı ne yaptı" geçmişi eksiksiz durur.
const EVENT_LOG_LABELS = {
	ad:"Etkinlik Adı", tur:"Tür", durum:"Durum", tarih:"Tarih", saat:"Başlangıç Saati",
	bitisSaat:"Bitiş Saati", yer:"Yer / Mekân", birim:"Düzenleyen Birim",
	planlayan:"Planlayan / Sorumlu", gorevli:"Basın Görevlisi",
	arsiv:"Arşiv Bağlantısı", not:"Not", katilimcilar:"Katılımcılar"
};
// " · " log satırlarının ayıracı olduğu için etkinlik adında geçerse zararsızlaştırılır.
function evLogName(s){ return String(s||"Etkinlik").split(" · ").join(" - "); }
function evAttNames(list){
	return (Array.isArray(list)?list:[]).map(function(a){ return String((a&&a.name)||"").trim(); }).filter(Boolean);
}
function describeEventChanges(oldE, newE){
	oldE=oldE||{}; newE=newE||{};
	const changes=[];
	// Tür ve durum anahtar olarak saklanır; loga okunabilir adıyla yazılır.
	if((oldE.tur||"diger")!==(newE.tur||"diger")) changes.push(EVENT_LOG_LABELS.tur+": "+evType(oldE.tur).ad+" → "+evType(newE.tur).ad);
	if((oldE.durum||"planlandi")!==(newE.durum||"planlandi")) changes.push(EVENT_LOG_LABELS.durum+": "+evStatus(oldE.durum).ad+" → "+evStatus(newE.durum).ad);
	if((oldE.tarih||"")!==(newE.tarih||"")) changes.push(EVENT_LOG_LABELS.tarih+": "+(oldE.tarih?fmtTrDate(oldE.tarih):"(boş)")+" → "+(newE.tarih?fmtTrDate(newE.tarih):"(boş)"));
	["ad","saat","bitisSaat","yer","birim","planlayan","gorevli","arsiv","not"].forEach(function(k){
		const o=(oldE[k]===undefined||oldE[k]===null)?"":String(oldE[k]).trim();
		const n=(newE[k]===undefined||newE[k]===null)?"":String(newE[k]).trim();
		if(o!==n) changes.push(EVENT_LOG_LABELS[k]+": "+logValueOrEmpty(o)+" → "+logValueOrEmpty(n));
	});
	// Katılımcılar dizi olduğu için eklenen ve çıkarılan kişiler ayrı ayrı yazılır.
	const oldA=evAttNames(oldE.katilimcilar), newA=evAttNames(newE.katilimcilar);
	const added=newA.filter(function(x){ return oldA.indexOf(x)===-1; });
	const removed=oldA.filter(function(x){ return newA.indexOf(x)===-1; });
	if(added.length||removed.length){
		const parts=[];
		if(added.length) parts.push("+ "+added.join(", "));
		if(removed.length) parts.push("− "+removed.join(", "));
		changes.push(EVENT_LOG_LABELS.katilimcilar+": "+logValueOrEmpty(parts.join("; ")));
	}
	return changes;
}
// Yeni etkinlikte de "ne planlandı" özeti loga geçsin.
function describeEventCreation(e){
	const out=[EVENT_LOG_LABELS.tur+": "+evType(e.tur).ad, EVENT_LOG_LABELS.durum+": "+evStatus(e.durum).ad];
	if(e.saat) out.push(EVENT_LOG_LABELS.saat+": "+e.saat+(e.bitisSaat?" → "+e.bitisSaat:""));
	if(e.yer) out.push(EVENT_LOG_LABELS.yer+": "+logValueOrEmpty(e.yer));
	if(e.birim) out.push(EVENT_LOG_LABELS.birim+": "+logValueOrEmpty(e.birim));
	if(e.planlayan) out.push(EVENT_LOG_LABELS.planlayan+": "+logValueOrEmpty(e.planlayan));
	if(e.gorevli) out.push(EVENT_LOG_LABELS.gorevli+": "+logValueOrEmpty(e.gorevli));
	const att=evAttNames(e.katilimcilar);
	if(att.length) out.push(EVENT_LOG_LABELS.katilimcilar+": "+logValueOrEmpty(att.join(", ")));
	return out;
}

// logs/etkinlik altına ortak bicimde log satiri ekler; persistEvent, executeEventDelete ve
// Ctrl+Z geri alma akislari bunu paylasir (onceden ayni kod birden fazla yerde tekrarlaniyordu).
// PROMISE DONER (bkz. logAction() ile ayni gerekce): fire-and-forget push().catch(...) yerine,
// cagiran taraf isterse await ile logun tamamlandigindan emin olabilir; basarisizlik konsola VE
// kullaniciya (toast) bildirilir.
function logEventAction(action, target){
	if(!currentUser || !database) return Promise.resolve(false);
	return database.ref(dbPath("logs/etkinlik")).push({
		by: ((currentUser.firstName||"")+" "+(currentUser.lastName||"")).trim() || currentUser.email,
		email: currentUser.email, action: action || "Etkinlik güncellendi",
		target: target || "", timestamp: firebase.database.ServerValue.TIMESTAMP
	}).then(function(){ return true; }).catch(function(err){ console.error("Etkinlik log kaydı yazılamadı:", err); showToast("Etkinlik kaydedildi ancak işlem günlüğüne yazılamadı.", "warn"); return false; });
}
// DONUS DEGERI: basarida {ok:true, id:...} (create'te yeni push-key, update'te girilen id'nin
// aynisi - Ctrl+Z "olusturma" geri almasi icin hangi kaydin silinecegini bilmemiz gerekiyor),
// basarisizlikta false. {ok:true,...} bir NESNE oldugundan "truthy"dir; bu yuzden eski
// `if(!ok) return;` tarzi kontroller (eventQuickStamp, saveEvent) KIRILMADAN calismaya devam eder.
async function persistEvent(id, obj, logLabel){
	if(!requireEdit()) return false;
	// id "undefined"/null gelirse asagisi sessizce push() ile YENI kayit olusturur;
	// bu, guncelleme sanilan bir islemin kopya uretmesi demektir. Acikca reddedilir.
	if(id !== null && id !== undefined && typeof id !== "string"){ showToast("Geçersiz etkinlik kimliği.", "error"); return false; }
	if(!database){ showToast("Veritabanı bağlı değil!", "error"); return false; }
	try{
		const isNew = !id;
		const finalId = id || database.ref(dbPath("etkinlikler")).push().key;
		// Firebase'e yazilan olusturmaTs/guncellemeTs SUNUCU saatiyle (ServerValue.TIMESTAMP)
		// damgalanir; `obj` (caller'in calEvents[id]=obj ile ANINDA yerel gosterime aldigi kopya)
		// kendi Date.now() degerini korur -- boylece ekranda sentinel nesnesi degil okunabilir
		// bir zaman gorunur, sonraki listener senkronunda gercek sunucu degeri gelir.
		const toWrite = Object.assign({}, obj);
		if (isNew) toWrite.olusturmaTs = firebase.database.ServerValue.TIMESTAMP;
		toWrite.guncellemeTs = firebase.database.ServerValue.TIMESTAMP;
		// Kayit + log TEK atomik root().update() istegiyle yazilir -- eskiden ayri (ates-et-unut)
		// bir push() idi, veri basariyla yazilsa bile log sessizce kaybolabiliyordu.
		const updates = {};
		updates[dbPath("etkinlikler/"+finalId)] = toWrite;
		let logKey = null;
		if (currentUser) {
			logKey = database.ref(dbPath("logs/etkinlik")).push().key;
			updates[dbPath("logs/etkinlik") + "/" + logKey] = {
				by: ((currentUser.firstName||"")+" "+(currentUser.lastName||"")).trim() || currentUser.email,
				email: currentUser.email, action: logLabel || "Etkinlik güncellendi",
				target: obj.ad || "", timestamp: firebase.database.ServerValue.TIMESTAMP
			};
		}
		await database.ref("/").update(updates);
		if (!logKey) console.error("Log kaydı yazılamadı: currentUser tanımsız.");
		return { ok:true, id:finalId };
	}catch(err){
		console.error("Etkinlik kaydedilemedi:", err);
		const reason = (err && (err.code || err.message)) ? (" (" + (err.code || err.message) + ")") : "";
		showToast("Etkinlik kaydedilemedi" + reason + ".", "error");
		return false;
	}
}

// Cift tiklamada AYNI etkinligi iki kez olusturmasin diye guardOp ile sarmalanir (bkz. guardOp).
async function saveEvent(){ return guardOp("saveEvent", saveEventImpl); }
async function saveEventImpl(){
	if(!requireEdit()) return;
	const ad=document.getElementById("ev_ad").value.trim();
	const tarih=document.getElementById("ev_tarih").value;
	if(!ad){ showToast("Etkinlik adı zorunlu!", "error"); return; }
	if(!parseKey(tarih)){ showToast("Geçerli bir tarih seçin!", "error"); return; }
	const saat=document.getElementById("ev_saat").value;
	const bitis=document.getElementById("ev_bitisSaat").value;
	if(saat && bitis && hmToMin(bitis)!==null && hmToMin(saat)!==null && hmToMin(bitis)<=hmToMin(saat)){
		// Bitis, baslangictan KUCUK/ESIT olabilir -- bu illa hata degil, gece yarisini asan bir
		// etkinlik de (ornegin 22:00 -> 01:00) olabilir. Karmasik bir tarih-araligi modeline
		// gecmek yerine (tek "tarih" alani hala ayni gun kalir) kullaniciya acikca sorulur.
		const geceYarisiOnay = confirm("Bitiş saati (" + bitis + "), başlangıçtan (" + saat + ") önce görünüyor.\n\nBu etkinlik gece yarısını geçiyor mu (bitiş ertesi gün)?\n\n\"Tamam\" derseniz bu şekilde kaydedilir, \"İptal\" ile saatleri düzeltebilirsiniz.");
		if(!geceYarisiOnay){ showToast("Bitiş saati başlangıçtan sonra olmalı.", "error"); return; }
	}
	const obj={
		ad: ad, tur: document.getElementById("ev_tur").value, durum: document.getElementById("ev_durum").value,
		tarih: tarih, saat: saat||"", bitisSaat: bitis||"",
		yer: document.getElementById("ev_yer").value.trim(), birim: document.getElementById("ev_birim").value.trim(),
		planlayan: document.getElementById("ev_planlayan").value.trim(), gorevli: calPressStaff.slice().sort(function(a,b){ return a.localeCompare(b,"tr"); }).join(", "),
		katilimcilar: calAttendees.slice(), arsiv: safeLinkUrl(document.getElementById("ev_arsiv").value),
		not: document.getElementById("ev_not").value.trim(),
		rozetler: Array.from(document.querySelectorAll("#ev_badgeBox .ev-badge-cb:checked")).map(function(cb){ return cb.value; }),
		haberKaynagi: document.getElementById("ev_haberKaynagi").value
	};
	// Duzenleme modali acikken baska bir kullanici bu etkinligi silmis olabilir; o durumda
	// asagidaki "yeni kayit" dali calisip SILINEN etkinligi geri diriltiyordu (olusturan/
	// olusturmaTs alanlari da yanlis kisiye gecerek log ile veri celisir hale geliyordu).
	if(calEditingId && !calEvents[calEditingId]){
		showToast("Bu etkinlik başka bir kullanıcı tarafından silinmiş.", "error");
		closeEventModal(); return;
	}
	const eski = calEditingId ? calEvents[calEditingId] : null;
	// "locked" burada elle tasinmazsa formdan HERHANGI bir alan degistirilip kaydedildiginde
	// sessizce kaybolur (persistEvent .set() ile TAM UZERINE yaziyor, .update() degil).
	if(eski){ obj.olusturan=eski.olusturan||""; obj.olusturmaTs=eski.olusturmaTs||Date.now(); obj.locked=!!eski.locked; }
	// Yeni eklenen etkinlik varsayilan olarak KILITLI gelir: yanlislikla surukleyip
	// tasima riskini sifirlar, gerekirse kilit ikonuyla tek tikla acilabilir.
	else { obj.olusturan=(currentUser? (((currentUser.firstName||"")+" "+(currentUser.lastName||"")).trim()||currentUser.email) : ""); obj.olusturmaTs=Date.now(); obj.locked=true; }
	obj.guncellemeTs=Date.now();
	// Kayıt üzerine yazılır; log ise her seferinde yeni satır olarak eklenir ve hangi alanın
	// ne olduğu tek tek yazılır.
	const adSafe = evLogName(ad);
	let label;
	if(calEditingId){
		const changes = describeEventChanges(eski, obj);
		label = changes.length
			? (adSafe+" etkinliği güncellendi ("+fmtTrDate(tarih)+") · "+changes.join(" · "))
			: (adSafe+" etkinliği kaydedildi (içerikte değişiklik yok)");
	} else {
		label = adSafe+" etkinliği takvime eklendi ("+fmtTrDate(tarih)+(saat?", "+saat:"")+") · "+describeEventCreation(obj).join(" · ");
	}
	// calEditingId GLOBAL: await suresince kullanici "Vazgec"/"X" derse null olur ve
	// asagidaki dal yanlis calisip undo yigina "create" yazardi -> sonraki Ctrl+Z
	// sadece duzenlenen etkinligi SILERDI. Bu yuzden id await'ten ONCE sabitlenir.
	const editingId = calEditingId;
	const res=await persistEvent(editingId, obj, label);
	if(!res) return;
	// Ctrl+Z yigina eklenir: duzenlemede onceki hal saklanir, olusturmada yeni push-key kullanilir.
	if(editingId){ calEvents[editingId]=obj; pushUndo({ type:"edit", id:editingId, before:Object.assign({},eski), after:Object.assign({},obj) }); }
	else { calEvents[res.id]=obj; pushUndo({ type:"create", id:res.id, before:null, after:Object.assign({},obj) }); }
	// Taslak ("Bir Etkinliğe Gidiyorum") gerçek bir adla kaydedildiyse bekleyen hatırlatmalar temizlenir.
	if (editingId && eski && eski.ad === QUICK_DRAFT_NAME && obj.ad !== QUICK_DRAFT_NAME) clearRemindersForEvent(editingId);
	closeEventModal(); showToast("Etkinlik kaydedildi.", "success");
}

// Peek panelinden VE duzenleme formundan (ev_deleteBtn) ORTAK cagrilir: calEditingId modal
// acikken, calPeekedId ise sadece peek paneli acikken (modal kapaliyken) dolu olur.
function deleteEvent(){
	const targetId=calEditingId||calPeekedId;
	if(!requireEdit() || !targetId || !calEvents[targetId]) return;
	openEventDeleteConfirm(targetId);
}
function openEventDeleteConfirm(id){
	eventDeleteTargetId=id;
	const e=calEvents[id];
	document.getElementById("eventDeleteConfirmText").textContent=
		'"'+((e&&e.ad)||"Etkinlik")+'" etkinliği takvimden silinecek. Emin misiniz?';
	document.getElementById("eventDeleteConfirmModalBg").classList.add("open");
}
function closeEventDeleteConfirm(){
	document.getElementById("eventDeleteConfirmModalBg").classList.remove("open");
	eventDeleteTargetId=null;
}
async function executeEventDelete(){
	if(!requireEdit() || !eventDeleteTargetId) return;
	if(!database){ showToast("Veritabanı bağlı değil!", "error"); return; }
	const id=eventDeleteTargetId;
	const e=calEvents[id];
	if(!e){ closeEventDeleteConfirm(); return; }
	const ad=e.ad||"Etkinlik";
	try{
		const before=Object.assign({}, e);   // Ctrl+Z icin tam kopya
		// Silme + log TEK atomik update() ile yazilir (update() icinde null = remove).
		const updates = {}; updates[dbPath("etkinlikler/"+id)] = null;
		let logKey = null;
		if (currentUser) {
			logKey = database.ref(dbPath("logs/etkinlik")).push().key;
			updates[dbPath("logs/etkinlik") + "/" + logKey] = {
				by: ((currentUser.firstName||"")+" "+(currentUser.lastName||"")).trim() || currentUser.email,
				email: currentUser.email,
				action: evLogName(ad)+" etkinliği takvimden silindi"+(e.tarih?" · "+EVENT_LOG_LABELS.tarih+": "+fmtTrDate(e.tarih):"")+(e.yer?" · "+EVENT_LOG_LABELS.yer+": "+logValueOrEmpty(e.yer):""),
				target: ad, timestamp: firebase.database.ServerValue.TIMESTAMP
			};
		}
		await database.ref("/").update(updates);
		if (!logKey) console.error("Log kaydı yazılamadı: currentUser tanımsız.");
		delete calEvents[id];
		pushUndo({ type:"delete", id:id, before:before, after:null });
		closeEventDeleteConfirm(); closeEventModal(); closeEventPeek();
		renderCalendar();
		showToast("Etkinlik silindi. (Ctrl+Z ile geri alınabilir)", "warn");
	}catch(err){
		console.error("Etkinlik silinemedi:", err);
		const reason = (err && (err.code || err.message)) ? (" (" + (err.code || err.message) + ")") : "";
		showToast("Etkinlik silinemedi" + reason + ".", "error");
	}
}

/* --- CTRL+Z: son takvim islemini geri alma --- */
// before/after cagiran taraflarda genelde Object.assign({}, e) ile (SIG) kopyalanir -- bu SIG
// bir kopyadir, katilimcilar gibi ic ice diziler hala AYNI referansi paylasir. O dizi daha
// sonra baska bir yerde mutasyona ugrarsa (ornegin calAttendees.slice() yeniden atanmadan
// once ayni referans uzerinde push/splice yapilirsa) bu undo kaydi da sessizce bozulurdu.
// Tum cagiranlari tek tek duzeltmek yerine tek bir noktada (burada) structuredClone ile
// DERIN kopya alinir -- boylece undoStack'teki her girdi cagiran tarafin daha sonraki
// mutasyonlarindan tamamen izole olur.
function pushUndo(entry){
	entry.ts=Date.now();
	if(entry.before!==undefined && entry.before!==null) entry.before=structuredClone(entry.before);
	if(entry.after!==undefined && entry.after!==null) entry.after=structuredClone(entry.after);
	undoStack.push(entry);
	if(undoStack.length>UNDO_STACK_LIMIT) undoStack.shift();
}

// Geri alma uygulanmadan HEMEN ONCE kaydin hala bekledigimiz durumda olup olmadigini alan alan
// karsilastirir. guncellemeTs'e GUVENILMEZ: calDrop bu alani hic guncellemiyor.
function eventStatesDiffer(a, b){
	a=a||{}; b=b||{};
	const keys=["ad","tur","durum","tarih","saat","bitisSaat","yer","birim","planlayan","gorevli","arsiv","not","locked"];
	for(let i=0;i<keys.length;i++){
		const k=keys[i];
		const av=(a[k]===undefined||a[k]===null)?"":a[k];
		const bv=(b[k]===undefined||b[k]===null)?"":b[k];
		if(String(av)!==String(bv)) return true;
	}
	return evAttNames(a.katilimcilar).join("|")!==evAttNames(b.katilimcilar).join("|");
}

async function undoLastCalendarAction(){
	if(!undoStack.length){ showToast("Geri alınacak bir işlem yok.", "warn"); return; }
	if(!requireEdit()) return;
	const entry=undoStack.pop();
	const current=calEvents[entry.id];
	const adName=evLogName((entry.before&&entry.before.ad)||(entry.after&&entry.after.ad));

	if(entry.type==="delete"){
		if(current){ showToast('"'+adName+'" bu arada zaten geri gelmiş görünüyor, geri alma iptal edildi.', "error"); return; }
	} else if(!current || eventStatesDiffer(current, entry.after)){
		showToast('"'+adName+'" bu arada başka biri tarafından değiştirilmiş, geri alma iptal edildi.', "error");
		return;
	}

	undoCount++;
	let ok=false;
	if(entry.type==="create"){
		try{
			// Silme + log TEK atomik update() ile yazilir (update() icinde null = remove).
			const updates = {}; updates[dbPath("etkinlikler/"+entry.id)] = null;
			let logKey = null;
			if (currentUser) {
				logKey = database.ref(dbPath("logs/etkinlik")).push().key;
				updates[dbPath("logs/etkinlik") + "/" + logKey] = {
					by: ((currentUser.firstName||"")+" "+(currentUser.lastName||"")).trim() || currentUser.email,
					email: currentUser.email,
					action: adName+" etkinliğinin eklenmesi geri alındı (Ctrl+Z, oturumda #"+undoCount+")",
					target: adName, timestamp: firebase.database.ServerValue.TIMESTAMP
				};
			}
			await database.ref("/").update(updates);
			if (!logKey) console.error("Log kaydı yazılamadı: currentUser tanımsız.");
			delete calEvents[entry.id];
			ok=true;
		}catch(err){ console.error("Geri alma başarısız:", err); showToast("Geri alma başarısız oldu.", "error"); }
	} else if(entry.type==="delete"){
		const createSummary=describeEventCreation(entry.before);
		const label=adName+" etkinliğinin silinmesi geri alındı (Ctrl+Z, oturumda #"+undoCount+")"+(createSummary.length?" · "+createSummary.join(" · "):"");
		const res=await persistEvent(entry.id, entry.before, label);
		if(res) calEvents[entry.id]=entry.before;
		ok=!!res;
	} else {
		const changes=describeEventChanges(entry.after, entry.before);
		const label=adName+" etkinliğinin "+(entry.type==="move"?"taşınması":entry.type==="resize"?"süresinin ayarlanması":"düzenlemesi")+" geri alındı (Ctrl+Z, oturumda #"+undoCount+")"+(changes.length?" · "+changes.join(" · "):"");
		const res=await persistEvent(entry.id, entry.before, label);
		if(res) calEvents[entry.id]=entry.before;
		ok=!!res;
	}

	if(ok){
		showToast("Geri alındı. (Ctrl+Z, oturumda #"+undoCount+")", "success");
		renderCalendar();
	} else {
		undoCount--;
		undoStack.push(entry); // gecici hata (ag vb.): tekrar denenebilsin diye yigina geri konur
	}
}

// Kopya-koruma dinleyicisinden (COPY_GUARD_ENABLED blogu) BILEREK ayri tutulur: o katman farkli
// bir amaca (telif caydiriciligi) hizmet ediyor. Takvim kapaliyken devreye girmez; form
// alanlarinda (input/textarea/select/contenteditable) tarayicinin kendi metin-undo'sunu
// bozmaz. Ctrl+Shift+Z (yaygin "redo" kisayolu) bilerek YOK SAYILIR.
document.addEventListener("keydown", function(e){
	const k=(e.key||"").toLowerCase();
	if(!(e.ctrlKey||e.metaKey) || k!=="z" || e.shiftKey) return;
	if(e.repeat) return;
	const el=e.target;
	if(el && el.closest && el.closest("input, textarea, select, [contenteditable='true']")) return;
	const overlay=document.getElementById("calendarOverlay");
	if(!overlay || !overlay.classList.contains("open")) return;
	e.preventDefault();
	undoLastCalendarAction();
});

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
		html+=`<label style="font-family:'Roboto',sans-serif; font-weight:600; font-size:13px; color:var(--muted); display:block; margin-bottom:4px;">${f.label}</label><input type="text" id="${newsPlaceholderInputId(f.ph)}" oninput="generateNewsText()" style="width:100%; padding:9px 12px; border-radius:8px; border:1px solid var(--border); font-family:'Roboto',sans-serif; font-size:14px; margin-bottom:12px; box-sizing:border-box;">`;
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
// "X, Y ve Z" bicimli Turkce liste birlestirici.
function turkishList(arr){
	const items=(arr||[]).filter(Boolean);
	if(items.length===0) return "";
	if(items.length===1) return items[0];
	return items.slice(0,-1).join(", ") + " ve " + items[items.length-1];
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

/* --- Takvimdeki bir etkinlikten haber metni üret --- */
function generateNewsFromEvent(){
	const e = calPeekedId ? calEvents[calPeekedId] : null;
	if(!e){ showToast("Etkinlik bulunamadı.", "error"); return; }
	const att=Array.isArray(e.katilimcilar)?e.katilimcilar:[];
	if(!att.length){ showToast("Bu etkinliğe katılımcı eklenmemiş.", "error"); return; }
	newsPeopleOverride=att.slice();
	newsEventContext={ etkinlik:e.ad||"", yer:e.yer||"", tarih:fmtTrDate(e.tarih), birim:e.birim||"", not:e.not||"" };
	// Etkinlik türüne uyan şablonu otomatik seç
	let idx=newsTemplates.findIndex(function(t){ return t.tur===e.tur; });
	if(idx<0) idx=0;
	fillNewsTemplateSelect(String(idx));
	const sel=document.getElementById("newsTemplateSelect"); if(sel) sel.value=String(idx);
	document.getElementById("newsLocationInput").value = e.yer ? turkishLocative(e.yer) : "Törene";
	renderNewsPlaceholderFields();
	generateNewsText();
	closeEventPeek(); _hideCalendarOverlay();
	// Takvim kapanma animasyonu (z-index 90) haber modalının üstünü örtmesin diye beklenir.
	setTimeout(function(){ document.getElementById("newsModalBg").classList.add("open"); }, 370);
}


		// Takvim dinleyicisi, ilgili let değişkenleri tanımlandıktan SONRA başlatılır.
		// Haber şablonları artık admin panelinden düzenlenmiyor; doğrudan DEFAULT_NEWS_TEMPLATES kullanılır.
		attachEventsListener();
		attachLiveSelectionListener();
		attachTestModeListener();
		fillNewsTemplateSelect();
		renderNewsPlaceholderFields();
		renderCalendarRail();
		// Ekran genişliği değişince hafta görünümü 3 ↔ 7 gün arasında geçmeli.
		if(window.matchMedia){
			const calMq=window.matchMedia("(max-width:700px)");
			const onCalMq=function(){ if(document.getElementById("calendarOverlay").classList.contains("open")) renderCalendar(); };
			if(calMq.addEventListener) calMq.addEventListener("change", onCalMq); else if(calMq.addListener) calMq.addListener(onCalMq);
		}

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
			var watched = Array.prototype.slice.call(document.querySelectorAll(".modal-bg, #calendarOverlay, #authFormBg, #facultySheetBackdrop, #loadingOverlay"));
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
			eventDeleteConfirmModalBg: closeEventDeleteConfirm,
			eventModalBg: closeEventModal,
			modalBg: closeModal,
			confirmModalBg: closeConfirmModal,
			bulkConfirmModalBg: closeBulkConfirmModal,
			emptyTrashModalBg: closeEmptyTrashModal,
			singlePermDeleteModalBg: closeSinglePermDelete,
			newsModalBg: closeNewsModal,
			adminPanelBg: closeAdminPanel,
			legalModalBg: closeLegalModal,
			pinSwitchModalBg: closePinSwitchModal,
			onboardingModalBg: function(){ closeOnboarding(true); }
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

		// Tema anahtari: <head>'deki erken script data-theme'i sayfa boyanmadan ONCE zaten
		// uyguladi (bkz. head, FOUC engelleme) -- burada sadece dugme ikonunu mevcut duruma
		// gore senkronlar ve tiklamayi baglar.
		function setupTheme(){
			var btn = document.getElementById("themeToggleBtn");
			if (!btn) return;
			btn.textContent = document.documentElement.getAttribute("data-theme") === "dark" ? "☀️" : "🌙";
		}
		function toggleTheme(){
			var isDark = document.documentElement.getAttribute("data-theme") === "dark";
			if (isDark) { document.documentElement.removeAttribute("data-theme"); localStorage.setItem("omuProtokolTema", "light"); }
			else { document.documentElement.setAttribute("data-theme", "dark"); localStorage.setItem("omuProtokolTema", "dark"); }
			setupTheme();
		}
		setupTheme();

		// Service Worker Kaydı (Offline / PWA desteği)
			if ("serviceWorker" in navigator) {
				window.addEventListener("load", function() {
					navigator.serviceWorker.register("./sw.js")
						.then(function(reg) { console.log("Service Worker kaydedildi:", reg.scope); })
						.catch(function(err) { console.log("Service Worker kaydı başarısız:", err); });
				});
			}
