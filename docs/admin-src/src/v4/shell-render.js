// Admin paneli — shell render (pure)
// String-only renderers. No DOM, no window/document access.
// Imported by:
//   1. The Vite plugin (vite.config.js) to inject shell HTML at build/dev time.
//   2. src/v4/shell.js as a runtime fallback for pages that bypass the plugin.

// NAV items are either flat — { key, href, text, icon, badge? } —
// or a parent with `children: [{ key, href, text, badge? }]` for a submenu.
// The parent is `key`-less; its children carry their own keys for the
// `data-page` highlight match. The parent stays expanded if any child matches.
/**
 * Editörün (ve rolü admin/owner OLMAYAN diğer herkesin) yan menüde görebileceği
 * sekmeler. Kullanıcı isteği: "admine, kurucuya yani bana soldaki sekmelerin
 * hepsi görülebilecek; editöre şunlar gözüksün: operasyonlar, protokol kartları,
 * takvim, harita, yapılacaklar listesi, tüm haberler, haber detayı, profiliniz,
 * ayarlar, yardım merkezi."
 *
 * Buradaki değerler NAV öğelerinin `key` alanlarıdır; menü DOM'una
 * data-nav-key olarak basılır ve shell.js çalışma anında (rol Firebase'den
 * çözüldükten sonra) bu listeye göre süzer.
 *
 * NOT: Bu bir GÖRÜNÜRLÜK ayarıdır, güvenlik sınırı DEĞİL. Asıl koruma Firebase
 * güvenlik kurallarında; menüde gizlenen bir sayfanın adresi elle yazılırsa
 * shell.js erisim-engellendi.html'e yönlendirir, ama veriye erişimi asıl
 * engelleyen yine kurallardır.
 */
export const EDITOR_NAV_KEYS = [
  'dashboard',      // Operasyonlar
  'dashboard-2',    // Protokol Kartları
  'calendar',       // Takvim
  'map',            // Harita
  'kanban',         // Yapılacaklar Listesi
  'projects',       // Tüm haberler
  'project-detail', // Haber detayı
  'profile',        // Profiliniz
  'settings',       // Ayarlar
  'faq',            // Yardım merkezi
  'games'           // Oyunlar
];

export const NAV = [
  {
    label: 'Genel',
    items: [
      // Kullanıcı isteği: "Panolar" akordeon sekmesi kaldırıldı, içindekiler
      // düz (tek tıkla açılan) sekmeler olarak yan yana kondu -- Operasyonlar
      // (index.html, ana ekran) en üstte.
      { key: 'dashboard',   href: 'index.html',  text: 'Operasyonlar', icon: 'dashboard' },
      // Kullanıcı isteği: ayrı duran halka açık protokol.html sayfası TAMAMEN
      // kaldırıldı; yerini panelin içindeki bu sayfa aldı (aynı app.js/style.css ile
      // protokol kartlarının tamamını çalıştırıyor). Bu yüzden hem eskiden yeni
      // sekmede /protokol.html açan ayrı "Protokol Kartları" sekmesi silindi
      // (artık gideceği ayrı bir sayfa yok), hem de bu sekmenin adı
      // "Analitik" -> "Protokol Kartları", adresi analitik.html -> protokol.html oldu.
      // İç anahtar (key / data-page) BİLEREK 'dashboard-2' kaldı: hem sekme
      // vurgulaması hem de _pages.scss'teki sayfaya özel tüm kurallar bu anahtara
      // bağlı; gereksiz yere hepsini değiştirmemek için dokunulmadı.
      { key: 'dashboard-2', href: 'protokol.html', text: 'Protokol Kartları', icon: 'files' },
      { key: 'calendar', href: 'takvim.html', text: 'Takvim', icon: 'calendar' },
      { key: 'map',      href: 'harita.html',      text: 'Harita', icon: 'map' }
    ]
  },
  {
    label: 'Uygulamalar',
    items: [
      { key: 'kanban',        href: 'yapilacaklar.html',        text: 'Yapılacaklar Listesi',       icon: 'kanban' },
      { key: 'notifications', href: 'bildirimler.html', text: 'Bildirimler',  icon: 'bell' },
      { key: 'games',         href: 'oyunlar.html',     text: 'Oyunlar',      icon: 'gamepad' }
    ]
  },
  {
    label: 'Haberler',
    items: [
      { key: 'projects',       href: 'tum-haberler.html',       text: 'Tüm haberler', icon: 'projects' },
      { key: 'project-detail', href: 'haber-detayi.html', text: 'Haber detayı', icon: 'pages' }
    ]
  },
  {
    label: 'Yönetim',
    items: [
      { key: 'users',           href: 'kisiler.html',         text: 'Kişiler',            icon: 'users' },
      { key: 'user_management', href: 'kullanici-yonetimi.html',  text: 'Kullanıcı yönetimi', icon: 'profile' },
      { key: 'profile',         href: 'profil.html',          text: 'Profiliniz',         icon: 'profile' },
      { key: 'settings',        href: 'ayarlar.html',         text: 'Ayarlar',            icon: 'settings' },
      { key: 'faq',             href: 'yardim-merkezi.html',              text: 'Yardım merkezi',     icon: 'help' }
    ]
  }
];

export const ICONS = {
  dashboard: '<svg class="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="4" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="10" width="7" height="11" rx="1.5"/></svg>',
  calendar:  '<svg class="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M8 4v6M16 4v6"/></svg>',
  pages:     '<svg class="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="20" height="18" rx="2"/><path d="M2 8h20"/></svg>',
  media:     '<svg class="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>',
  users:     '<svg class="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="8" r="4"/><path d="M5 20c0-3.9 3.1-7 7-7s7 3.1 7 7"/></svg>',
  profile:   '<svg class="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  settings:  '<svg class="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/></svg>',
  chat:      '<svg class="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/></svg>',
  bell:      '<svg class="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 3a6 6 0 00-6 6c0 6-3 7-3 7h18s-3-1-3-7a6 6 0 00-6-6z"/><path d="M10.5 21a1.5 1.5 0 003 0"/></svg>',
  kanban:    '<svg class="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="6" height="14" rx="1.5"/><rect x="11" y="3" width="6" height="9" rx="1.5"/><rect x="19" y="3" width="2" height="6" rx="0.5"/></svg>',
  files:     '<svg class="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 7a2 2 0 012-2h4l2 2h7a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/></svg>',
  shop:      '<svg class="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 9l1-5h16l1 5M3 9v10a2 2 0 002 2h14a2 2 0 002-2V9M3 9h18"/><path d="M9 13a3 3 0 006 0"/></svg>',
  tag:       '<svg class="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20 13l-7 7a2 2 0 01-2.83 0L3 12.83V4h8.83L20 12.17a2 2 0 010 2.83z"/><circle cx="7.5" cy="7.5" r="1.5"/></svg>',
  cart:      '<svg class="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="9" cy="21" r="1.5"/><circle cx="20" cy="21" r="1.5"/><path d="M1 1h4l2.7 13.4a2 2 0 002 1.6h9.7a2 2 0 002-1.6L23 6H6"/></svg>',
  help:      '<svg class="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 015.8 1c0 2-3 3-3 3"/><circle cx="12" cy="17" r="0.5" fill="currentColor"/></svg>',
  mail:      '<svg class="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="4" width="20" height="16" rx="3"/><path d="M2 7l10 6 10-6"/></svg>',
  map:       '<svg class="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>',
  receipt:   '<svg class="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M5 21V3h14v18l-3-2-3 2-3-2-3 2-2-2z"/><path d="M9 8h6M9 12h6M9 16h4"/></svg>',
  price:     '<svg class="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="12" y1="2" x2="12" y2="22"/><path d="M16 6H9.5a3.5 3.5 0 100 7h5a3.5 3.5 0 010 7H7"/></svg>',
  projects:  '<svg class="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
  type:      '<svg class="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>',
  icons:     '<svg class="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/></svg>',
  layout:    '<svg class="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 9v12"/></svg>',
  code:      '<svg class="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/></svg>',
  paint:     '<svg class="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M19 11H5a2 2 0 00-2 2v2a2 2 0 002 2h2v3a1 1 0 001 1h3a1 1 0 001-1v-3h7a2 2 0 002-2v-2a2 2 0 00-2-2z"/><path d="M19 11V5a2 2 0 00-2-2h-2a2 2 0 00-2 2v6"/></svg>',
  gamepad:   '<svg class="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="7" width="20" height="11" rx="5.5"/><path d="M7 10v4M5 12h4"/><circle cx="16" cy="11" r="1"/><circle cx="18.5" cy="13.5" r="1"/></svg>'
};

const CHEVRON = '<svg class="nav-chev" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M6 4l4 4-4 4"/></svg>';

function renderNavItem(item, activeKey) {
  if (item.children) {
    const childActive = item.children.some((c) => c.key === activeKey);
    const sub = item.children.map((c) => {
      const a = c.key === activeKey;
      return `<a class="nav-sublink${a ? ' active' : ''}" href="${c.href}"${c.key ? ` data-nav-key="${c.key}"` : ''}${c.target ? ` target="${c.target}" rel="noopener"` : ''}${a ? ' aria-current="page"' : ''}>${c.text}${c.badge ? `<span class="badge ${c.badge.cls}">${c.badge.text}</span>` : ''}</a>`;
    }).join('');
    const cls = ['nav-tree'];
    if (childActive) {cls.push('open', 'has-active');}
    return `
      <div class="${cls.join(' ')}">
        <button type="button" class="nav-link nav-toggle" aria-expanded="${childActive ? 'true' : 'false'}">
          ${ICONS[item.icon] || ''}
          <span class="nav-text">${item.text}</span>
          ${item.badge ? `<span class="badge ${item.badge.cls}">${item.badge.text}</span>` : ''}
          ${CHEVRON}
        </button>
        <div class="nav-sub"><div class="nav-sub-inner">${sub}</div></div>
      </div>
    `;
  }
  const a = item.key === activeKey;
  return `
    <a class="nav-link${a ? ' active' : ''}" href="${item.href}"${item.key ? ` data-nav-key="${item.key}"` : ''}${item.target ? ` target="${item.target}" rel="noopener"` : ''}${a ? ' aria-current="page"' : ''}>
      ${ICONS[item.icon] || ''}
      <span class="nav-text">${item.text}</span>
      ${item.badge ? `<span class="badge ${item.badge.cls}">${item.badge.text}</span>` : ''}
    </a>
  `;
}

export function renderSidebar(activeKey) {
  const groups = NAV.map((group) => `
    <div class="nav-group">
      <div class="nav-label">${group.label}</div>
      ${group.items.map((item) => renderNavItem(item, activeKey)).join('')}
    </div>
  `).join('');

  return `
    <aside class="sidebar" aria-label="Primary navigation">
      <a class="sidebar-brand" href="index.html">
        <img class="brand-icon" src="/icon-192.png" alt="">
        <div class="brand-name">Protokol</div>
      </a>
      <nav class="sidebar-nav">${groups}</nav>
      <div class="sidebar-footer">
        <div class="sidebar-user">
          <div class="avatar">Z</div>
          <div class="sidebar-user-info">
            <div class="name">Ziyaretçi</div>
            <div class="role">—</div>
          </div>
          <button class="more-btn" aria-label="More options">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="3" r="1.2"/><circle cx="8" cy="8" r="1.2"/><circle cx="8" cy="13" r="1.2"/></svg>
          </button>
        </div>
      </div>
    </aside>
  `;
}

// Label → href lookup for breadcrumb crumbs, derived from NAV so the two can't
// drift. A parent resolves to its first child — the page the sidebar opens when
// you click the group. "Home" is the only hand-seeded entry.
const CRUMB_HREFS = (() => {
  const map = new Map([['Home', 'index.html']]);
  for (const group of NAV) {
    for (const item of group.items) {
      const href = item.href || (item.children && item.children[0].href);
      if (href && !map.has(item.text)) {map.set(item.text, href);}
      for (const child of item.children || []) {
        if (!map.has(child.text)) {map.set(child.text, child.href);}
      }
    }
  }
  return map;
})();

const escapeAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// Every crumb but the last resolves to a link, in this order:
//   1. explicit target in the page's data-breadcrumb — "Forms|form-genel.html"
//   2. exact label match against NAV (see CRUMB_HREFS above)
//   3. no match → plain text, exactly as before
// The last crumb is the current page: never a link, always aria-current.
function resolveCrumb(raw) {
  const s = String(raw);
  const bar = s.indexOf('|');
  const text = (bar === -1 ? s : s.slice(0, bar)).trim();
  return { text, href: bar === -1 ? CRUMB_HREFS.get(text) : s.slice(bar + 1).trim() };
}

export function renderTopbar(breadcrumb) {
  const crumbs = (breadcrumb && breadcrumb.length ? breadcrumb : ['Home']).map((c, i, arr) => {
    const { text, href } = resolveCrumb(c);
    const sep = i > 0 ? '<span class="sep" aria-hidden="true">›</span>' : '';
    const isLast = i === arr.length - 1;
    const crumb = !isLast && href
      ? `<a href="${escapeAttr(href)}">${text}</a>`
      : `<span${isLast ? ' class="current" aria-current="page"' : ''}>${text}</span>`;
    return sep + crumb;
  }).join('');

  return `
    <header class="topbar">
      <div class="topbar-left">
        <button class="sidebar-toggle" type="button" aria-label="Open menu" aria-controls="sidebar" aria-expanded="false">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
        </button>
        <nav class="breadcrumb" aria-label="Breadcrumb">${crumbs}</nav>
      </div>
      <div class="search-box">
        <svg class="s-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="7" cy="7" r="5"/><path d="M11 11l3.5 3.5"/></svg>
        <input type="text" placeholder="Sayfa ara veya komut çalıştır…" aria-label="Komut paletini aç">
        <kbd>⌘K</kbd>
      </div>
      <div class="topbar-right">
        <button class="tb-btn theme-toggle" type="button" title="Toggle theme" aria-label="Toggle theme" aria-pressed="false">
          <svg class="theme-icon-light" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>
          <svg class="theme-icon-dark" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
        </button>
        <a class="tb-btn" href="bildirimler.html" title="Bildirimler" aria-label="Bildirimler">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M12 3a6 6 0 00-6 6c0 6-3 7-3 7h18s-3-1-3-7a6 6 0 00-6-6z"/><path d="M10.5 21a1.5 1.5 0 003 0"/></svg>
          <!-- Onay bekleyen kayıt sayısı. Yalnızca admin/owner'da ve sayı > 0 iken
               görünür; shell.js users/ düğümünü canlı dinleyip günceller. -->
          <span class="tb-count" id="tb-onay-rozeti" hidden></span>
        </a>
        <button class="tb-avatar" type="button" aria-label="Account menu" aria-haspopup="menu" aria-expanded="false">Z</button>
      </div>
    </header>
  `;
}

export function renderFooter() {
  return `
    <footer class="footer">
      <span>© 2026 Arda Bilasa. Tüm hakları saklıdır.</span>
      <span>Firebase v9.23.0</span>
    </footer>
  `;
}

export function renderShell({ activeKey = '', breadcrumb = ['Home'] } = {}) {
  return {
    sidebar: renderSidebar(activeKey),
    topbar: renderTopbar(breadcrumb),
    footer: renderFooter()
  };
}

export function parseShellAttrs(attrs) {
  const shell = /data-shell\s*=\s*["']([^"']*)["']/.exec(attrs);
  if (!shell || shell[1] !== 'admin') {return null;}
  const page = /data-page\s*=\s*["']([^"']*)["']/.exec(attrs);
  const bc = /data-breadcrumb\s*=\s*["']([^"']*)["']/.exec(attrs);
  return {
    activeKey: page ? page[1] : '',
    breadcrumb: bc ? bc[1].split('>').map((s) => s.trim()).filter(Boolean) : ['Home']
  };
}
