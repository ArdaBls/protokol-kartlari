// Admin paneli — çalışma zamanı shell bağlama
// At build/dev time the Vite plugin (vite.config.js) injects sidebar/topbar/
// footer directly into each production/*.html. mountShell() is the runtime
// fallback: if the shell isn't already in the DOM (e.g. opening a raw HTML
// file), render it from the same string templates. Either way, mountShell()
// always wires up runtime behavior (mobile drawer, theme toggle).

import { renderShell } from './shell-render.js';
import { openMenu } from './menus.js';
import { showToast } from './toast.js';
import { showModal } from './modal.js';

function injectShellIfMissing() {
  const body = document.body;
  if (body.querySelector('.sidebar')) {return;}

  const activeKey = body.dataset.page || '';
  const breadcrumb = body.dataset.breadcrumb
    ? body.dataset.breadcrumb.split('>').map((s) => s.trim()).filter(Boolean)
    : ['Home'];

  const { sidebar, topbar, footer } = renderShell({ activeKey, breadcrumb });

  const tpl = document.createElement('template');
  tpl.innerHTML = sidebar.trim();
  body.insertBefore(tpl.content.firstElementChild, body.firstChild);

  const mainEl = body.querySelector('main.main');
  tpl.innerHTML = topbar.trim();
  if (mainEl) {
    body.insertBefore(tpl.content.firstElementChild, mainEl);
    tpl.innerHTML = footer.trim();
    mainEl.appendChild(tpl.content.firstElementChild);
  }
}

// Sidebar submenus — accordion behavior + sessionStorage memory.
//
// On page load, the group containing the active page auto-opens (server-rendered
// markup). User can manually expand/collapse any group; opening one closes all
// others. The chosen state persists across navigation via sessionStorage so
// the sidebar doesn't snap back to "auto-open" when the user moves to a child
// page that's not in their preferred group.
const SUBMENU_STATE_KEY = 'protokol:nav-open';

function getStoredOpenIndex() {
  try {
    const raw = sessionStorage.getItem(SUBMENU_STATE_KEY);
    if (raw === null) {return null;}
    const n = parseInt(raw, 10);
    return Number.isNaN(n) ? null : n;
  } catch (_e) { return null; }
}

function setStoredOpenIndex(idx) {
  try {
    if (idx === null) {sessionStorage.removeItem(SUBMENU_STATE_KEY);}
    else {sessionStorage.setItem(SUBMENU_STATE_KEY, String(idx));}
  } catch (_e) { /* private mode */ }
}

function bindNavSubmenus() {
  const trees = [...document.querySelectorAll('.sidebar .nav-tree')];
  if (!trees.length) {return;}

  const closeAll = (except) => {
    trees.forEach((t) => {
      if (t === except) {return;}
      t.classList.remove('open');
      const btn = t.querySelector('.nav-toggle');
      if (btn) {btn.setAttribute('aria-expanded', 'false');}
    });
  };

  // Restore the user's last manually-toggled group, if any. Otherwise the
  // server-rendered .open (auto-applied to the active page's group) wins.
  const stored = getStoredOpenIndex();
  if (stored !== null && trees[stored]) {
    closeAll(trees[stored]);
    trees[stored].classList.add('open');
    const btn = trees[stored].querySelector('.nav-toggle');
    if (btn) {btn.setAttribute('aria-expanded', 'true');}
  }

  trees.forEach((tree, i) => {
    const btn = tree.querySelector('.nav-toggle');
    if (!btn) {return;}
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const willOpen = !tree.classList.contains('open');
      closeAll(willOpen ? tree : null);
      tree.classList.toggle('open', willOpen);
      btn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
      setStoredOpenIndex(willOpen ? i : null);
    });
  });
}

// Sidebar toggle — desktop collapses to a 64px rail; mobile opens a drawer.
// Same button, viewport-aware behavior. Rail state persists in localStorage.
const RAIL_KEY = 'protokol:sidebar-rail';

function isDesktop() { return window.matchMedia('(min-width: 769px)').matches; }

function applyRailLabels() {
  // Sets data-rail-label on every nav-link so the CSS tooltip has text to show.
  document.querySelectorAll('.sidebar .nav-link').forEach((link) => {
    const text = link.querySelector('.nav-text')?.textContent.trim();
    if (text) {link.setAttribute('data-rail-label', text);}
  });
}

function bindRailFlyouts() {
  // In rail mode, clicking a parent (.nav-toggle) opens its children as a
  // flyout menu instead of expanding inline. Click again to dismiss.
  // Captures clicks before bindNavSubmenus' handler so the inline-expand
  // behavior never fires when we're collapsed.
  document.querySelectorAll('.sidebar .nav-toggle').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      if (!document.body.classList.contains('sidebar-rail')) {return;}
      if (!isDesktop()) {return;}
      e.preventDefault();
      e.stopPropagation();
      const tree = btn.closest('.nav-tree');
      if (!tree) {return;}
      const items = [...tree.querySelectorAll('.nav-sublink')].map((a) => ({
        label: a.textContent.trim(),
        action: () => { window.location.href = a.getAttribute('href'); }
      }));
      openMenu(btn, items);
    }, true); // capture phase — runs before bindNavSubmenus
  });
}

function bindSidebarToggle() {
  const sidebar = document.querySelector('.sidebar');
  const toggle = document.querySelector('.sidebar-toggle');
  if (!sidebar || !toggle) {return;}

  let backdrop = document.querySelector('.sidebar-backdrop');
  if (!backdrop) {
    backdrop = document.createElement('div');
    backdrop.className = 'sidebar-backdrop';
    backdrop.hidden = true;
    document.body.appendChild(backdrop);
  }

  // ── Mobile drawer ──
  const drawerClose = () => {
    sidebar.classList.remove('open');
    backdrop.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('sidebar-open');
  };
  const drawerOpen = () => {
    sidebar.classList.add('open');
    backdrop.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    document.body.classList.add('sidebar-open');
  };

  // ── Desktop rail ──
  const setRail = (on) => {
    document.body.classList.toggle('sidebar-rail', on);
    toggle.setAttribute('aria-pressed', on ? 'true' : 'false');
    toggle.setAttribute('aria-label', on ? 'Expand sidebar' : 'Collapse sidebar');
    try { localStorage.setItem(RAIL_KEY, on ? '1' : '0'); } catch (_e) { /* ignore */ }
    if (on) {applyRailLabels();}
  };

  // Restore stored rail preference (desktop only). Mobile ignores it so the
  // drawer/sidebar isn't shown rail-style on small screens.
  let stored = '0';
  try { stored = localStorage.getItem(RAIL_KEY) || '0'; } catch (_e) { /* ignore */ }
  if (stored === '1' && isDesktop()) {setRail(true);}

  toggle.addEventListener('click', () => {
    if (isDesktop()) {
      setRail(!document.body.classList.contains('sidebar-rail'));
    } else {
      sidebar.classList.contains('open') ? drawerClose() : drawerOpen();
    }
  });
  backdrop.addEventListener('click', drawerClose);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sidebar.classList.contains('open')) {drawerClose();}
  });

  // Viewport changes: desktop ↔ mobile. Reset state coherently.
  const mq = window.matchMedia('(min-width: 769px)');
  mq.addEventListener('change', (e) => {
    if (e.matches) {
      // Now desktop — close any drawer, restore rail state.
      drawerClose();
      let v = '0';
      try { v = localStorage.getItem(RAIL_KEY) || '0'; } catch (_err) { /* ignore */ }
      setRail(v === '1');
    } else {
      // Now mobile — drop rail mode (drawer takes over).
      document.body.classList.remove('sidebar-rail');
    }
  });

  bindRailFlyouts();
}

function bindThemeToggle() {
  const btn = document.querySelector('.theme-toggle');
  if (!btn) {return;}

  const apply = (theme) => {
    document.documentElement.setAttribute('data-theme', theme);
    btn.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
  };

  // Sync aria-pressed with the theme set by the pre-paint script.
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  btn.setAttribute('aria-pressed', current === 'dark' ? 'true' : 'false');

  btn.addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('theme', next); } catch (_e) { /* private mode */ }
    apply(next);
  });

  // Follow OS theme changes when the user hasn't explicitly chosen.
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', (e) => {
    let stored;
    try { stored = localStorage.getItem('theme'); } catch (_e) { /* ignore */ }
    if (stored) {return;}
    apply(e.matches ? 'dark' : 'light');
  });
}

// ────────────────────────
//  TOPBAR DROPDOWNS
// ────────────────────────

function openSignOutModal() {
  showModal({
    title: 'Çıkış yapılsın mı?',
    size: 'sm',
    body: '<p style="font-size:13px;color:var(--text-secondary);line-height:1.6;margin:0">Tekrar giriş yapmanız gerekecek. Kaydedilmemiş değişiklikler kaybolur.</p>',
    actions: [
      { label: 'Vazgeç', variant: 'ghost' },
      {
        label: 'Çıkış yap',
        variant: 'primary',
        action: () => {
          // GERÇEK Firebase oturumunu kapat. window.firebase yoksa (henüz yüklenmediyse)
          // ya da signOut() reddedilirse bile kullanıcıyı giriş sayfasına yönlendir --
          // sayfa hiçbir koşulda kırılmasın.
          const goToLogin = () => { window.location.href = 'giris.html'; };
          try {
            if (window.firebase && firebase.auth) {
              firebase.auth().signOut().catch(() => {}).finally(() => {
                showToast('Çıkış yapıldı', { variant: 'success' });
                setTimeout(goToLogin, 500);
              });
            } else {
              showToast('Çıkış yapıldı', { variant: 'success' });
              setTimeout(goToLogin, 500);
            }
          } catch (_e) {
            goToLogin();
          }
        }
      }
    ]
  });
}

const USER_MENU = [
  { label: 'Profil',            action: () => { window.location.href = 'profil.html'; } },
  { label: 'Hesap ayarları',    action: () => { window.location.href = 'ayarlar.html'; } },
  '-',
  { label: 'Yardım ve destek',  action: () => { window.location.href = 'yardim-merkezi.html'; } },
  { label: 'Ekranı kilitle',    action: () => { window.location.href = 'kilit-ekrani.html'; } },
  { label: 'Çıkış yap',         action: openSignOutModal }
];

function bindTopbarPanels() {
  const avatar = document.querySelector('.tb-avatar');
  if (avatar) {
    avatar.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      openMenu(avatar, USER_MENU);
    });
  }

  const sidebarMore = document.querySelector('.sidebar-user .more-btn');
  if (sidebarMore) {
    sidebarMore.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      openMenu(sidebarMore, USER_MENU);
    });
  }
}

// ────────────────────────
//  GERÇEK KULLANICI SENKRONİZASYONU
// ────────────────────────
// Sidebar/topbar'daki demo "Aigars Silkalns" gibi build-zamanı yer tutucuları
// çalışma zamanında GERÇEK giriş yapmış kullanıcıyla değiştirir. profil.html
// ve ayarlar.html AYNI users/{uid} okumasını kendi başlarına tekrar yapar --
// bilerek: her sayfa zaten kendi Firebase mantığını taşıyor (proje deseni),
// burada ortak bir modül/store'a bağımlı kılmak gereksiz kaplama olurdu.

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDOfhq3aYW6sg2_zj0sFsRzXeGziGtLxCk',
  authDomain: 'omu-protokol.firebaseapp.com',
  databaseURL: 'https://omu-protokol-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'omu-protokol'
};

const ROLE_LABEL = { pending: 'Onay Bekliyor', editor: 'Editör', admin: 'Admin', owner: 'Kurucu' };

const FIREBASE_SCRIPTS = [
  'https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/9.23.0/firebase-database-compat.js',
  'https://www.gstatic.com/firebasejs/9.23.0/firebase-auth-compat.js'
];

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('script yüklenemedi: ' + src));
    document.head.appendChild(s);
  });
}

// Firebase compat SDK'sının hazır olmasını bekler. Çoğu sayfa zaten kendi
// <head>'ine 3 firebase-*-compat script'ini ekliyor -- burada ÇİFT YÜKLEMEYİ
// önlemek için önce window.firebase'e, sonra DOM'da zaten var olan bir
// firebase-app-compat <script> etiketine bakılır (varsa onun yüklenmesini
// bekleriz, yeniden eklemeyiz). Hiçbiri yoksa (shell'i bypass eden çıplak
// sayfalar için) 3 script'i sırayla kendimiz enjekte ederiz.
let firebaseReadyPromise = null;
function ensureFirebase() {
  if (firebaseReadyPromise) {return firebaseReadyPromise;}
  firebaseReadyPromise = new Promise((resolve) => {
    if (window.firebase) { resolve(); return; }
    const existing = document.querySelector('script[src*="firebase-app-compat"]');
    if (existing) {
      // Sayfa kendi script'ini zaten eklemiş -- yüklenmesini bekle (yarışı
      // kaçırmamak için hem 'load' event'ini dinle hem de kısa aralıklarla
      // window.firebase'i yokla, script yükleme sırası main-v4.js'ten önce
      // bitmiş olabilir).
      let settled = false;
      const done = () => { if (!settled) { settled = true; resolve(); } };
      existing.addEventListener('load', done, { once: true });
      const poll = setInterval(() => {
        if (window.firebase) { clearInterval(poll); done(); }
      }, 30);
      setTimeout(() => { clearInterval(poll); done(); }, 4000); // savunmacı üst sınır
      return;
    }
    loadScript(FIREBASE_SCRIPTS[0])
      .then(() => loadScript(FIREBASE_SCRIPTS[1]))
      .then(() => loadScript(FIREBASE_SCRIPTS[2]))
      .then(() => resolve())
      .catch(() => resolve()); // yüklenemezse bile devam et -- syncShellUser Ziyaretçi'ye düşer
  });
  return firebaseReadyPromise;
}

// data: URI base64 fotoğraflar hariç, background-image içine gömülecek URL'de
// tırnak/parantez kaçışı için basit bir koruma.
function safeUrlForCss(url) {
  return String(url).replace(/["'()]/g, '');
}

function applyAvatar(el, name, avatarUrl) {
  if (!el) {return;}
  if (avatarUrl) {
    el.textContent = '';
    el.style.backgroundImage = `url("${safeUrlForCss(avatarUrl)}")`;
    el.style.backgroundSize = 'cover';
    el.style.backgroundPosition = 'center';
  } else {
    el.style.backgroundImage = '';
    el.style.backgroundSize = '';
    el.style.backgroundPosition = '';
    el.textContent = (name || '?').charAt(0).toUpperCase() || '?';
  }
}

function applyGuestShellUser() {
  const nameEl = document.querySelector('.sidebar-user-info .name');
  const roleEl = document.querySelector('.sidebar-user-info .role');
  if (nameEl) {nameEl.textContent = 'Ziyaretçi';}
  if (roleEl) {roleEl.textContent = '—';}
  applyAvatar(document.querySelector('.sidebar-user .avatar'), 'Ziyaretçi', null);
  applyAvatar(document.querySelector('.tb-avatar'), 'Ziyaretçi', null);
}

/**
 * Sidebar/topbar'daki kullanıcı bilgisini gerçek Firebase Auth oturumuyla
 * senkron tutar. `data-shell="admin"` sayfalarında mountShell() tarafından
 * çağrılır. Giriş yoksa güvenli bir "Ziyaretçi" varsayılanı gösterir, hatada
 * sayfayı KIRMAZ.
 */
export function syncShellUser() {
  ensureFirebase().then(() => {
    if (!window.firebase || !firebase.auth) { applyGuestShellUser(); return; }
    try {
      if (!firebase.apps.length) { firebase.initializeApp(FIREBASE_CONFIG); }
    } catch (_e) { /* zaten başlatılmış olabilir */ }

    firebase.auth().onAuthStateChanged((user) => {
      if (!user) {
        // Kullanıcı isteği: admin paneli artık sitenin ana giriş noktası -- giriş yapmamış
        // hiç kimse panel içeriğini GÖRMEMELİ, doğrudan tek giriş sayfasına yönlendirilir.
        // returnTo ile giriş sonrası tam istediği admin sayfasına geri döner (giris.html'deki
        // AYNI güvenli-dönüş deseni, sadece aynı origin'e izin verir). Auth sayfalarının
        // (giris.html vb.) body'sinde data-shell="admin" YOK, mountShell() onlarda hiç
        // çalışmıyor -- yönlendirme döngüsü riski yok.
        applyGuestShellUser();
        window.location.href = 'giris.html?returnTo=' + encodeURIComponent(window.location.href);
        return;
      }
      firebase.database().ref('users/' + user.uid).once('value').then((snap) => {
        const u = snap.val() || {};
        const name = ((u.firstName || '') + ' ' + (u.lastName || '')).trim() || 'Kullanıcı';
        const role = u.role || 'pending';
        const nameEl = document.querySelector('.sidebar-user-info .name');
        const roleEl = document.querySelector('.sidebar-user-info .role');
        if (nameEl) {nameEl.textContent = name;}
        if (roleEl) {roleEl.textContent = ROLE_LABEL[role] || role;}
        applyAvatar(document.querySelector('.sidebar-user .avatar'), name, u.avatarUrl);
        applyAvatar(document.querySelector('.tb-avatar'), name, u.avatarUrl);
      }).catch((err) => {
        console.error('Shell: kullanıcı verisi okunamadı:', err);
        applyGuestShellUser();
      });
    });
  }).catch(() => applyGuestShellUser());
}

/**
 * Mount the admin shell (sidebar + topbar + footer + interactivity).
 *
 * Reads three `<body>` data attributes:
 * - `data-shell="admin"` — opt-in. No-op if absent.
 * - `data-page="key"` — matches a {@link import('./shell-render.js').NAV} item to highlight.
 * - `data-breadcrumb="A > B > C"` — `>`-separated; last segment is current.
 *
 * Idempotent: if the build-time Vite plugin already injected the shell HTML
 * (the common case), this only wires up runtime behavior — mobile drawer,
 * theme toggle, notifications/messages/avatar dropdowns.
 */
export function mountShell() {
  const body = document.body;
  if (body.dataset.shell !== 'admin') {return;}

  injectShellIfMissing();
  bindNavSubmenus();
  bindSidebarToggle();
  bindThemeToggle();
  bindTopbarPanels();
  syncShellUser();
}
