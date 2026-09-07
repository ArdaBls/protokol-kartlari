// Ortak "personel profili" (ad + profil fotoğrafı) modülü.
//
// users/{uid} özel bir kayıttır (e-posta, rol, hesap durumu) ve editörler
// BAŞKA kullanıcıların bu düğümünü okuyamaz (bkz. Firebase kuralları) --
// bu yüzden avatarUrl orada dururken ortak ekranlarda (Kanban/Yapılacaklar
// "Tamamlandı" kartları, Gantt vb.) hiç gösterilemiyordu. staffProfiles/{uid}
// SADECE {displayName, avatarUrl} taşıyan, ayrı ve asgari bir yol -- giriş
// yapmış her editor/admin/owner okuyabilir, kullanıcı sadece KENDİ kaydını
// yazabilir (bkz. kurallar).
//
// profil.html ve ayarlar.html, kullanıcı adını/avatarını her güncellediğinde
// bu yolu da eşzamanlı günceller (syncStaffProfile). Kanban/Yapılacaklar gibi
// tüketiciler subscribeStaffProfiles() ile canlı abone olur, findStaffProfile()
// ile bir kişiyi (uid varsa uid, yoksa normalize edilmiş ada göre) bulur,
// renderStaffAvatar() ile HTML üretir (fotoğraf yoksa/geçersizse baş harf).

// KASITLI: dbPath() KULLANILMIYOR. staffProfiles, users/{uid} gibi gerçek
// kullanıcı KİMLİĞİNE bağlı bir alan (proje kuralı: "users/ hesap/rol hiç
// gölgelenmez") -- Test Modu açıkken bile HER ZAMAN gerçek yoldan okunur/
// yazılır, test/ altına asla kopyalanmaz/kaydırılmaz.
const STAFF_PROFILES_PATH = 'staffProfiles';

function escapeHtml(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// Türkçe-güvenli kişi anahtarı -- İ/ı, ş/ç/ğ/ö/ü büyük/küçük harf farklarını
// tolere eder (attendance.js'teki AYNI mantık, kasıtlı kopya -- dosyalar
// arası küçük yardımcılar bu projede paylaşılmaz, bkz. roster.js'teki not).
export function normalizePersonKey(name) {
  return String(name || '').trim().toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ');
}

// data: (kendi yüklediğimiz base64 JPEG) veya https: dışında hiçbir şemaya
// izin verme -- avatarUrl kullanıcı girdisi, javascript:/vbscript: gibi bir
// şema img src'ye sızarsa XSS'e açık kapı olurdu.
export function isSafeAvatarUrl(url) {
  if (typeof url !== 'string' || !url) { return false; }
  return /^data:image\//i.test(url) || /^https:\/\//i.test(url);
}

let profilesCache = {};
let profilesByName = new Map();
let listenerStarted = false;
const subscribers = new Set();

// etkinlikler/{id}.gorevli ve .haberYazanlari SAF isim metnidir (uid taşımaz);
// picker bu isimleri basinGorevlileri/{uid} rehberinden seçtiriyor (bkz.
// roster.js loadPressOfficerPool), staffProfiles/{uid}.displayName ise KİŞİNİN
// KENDİSİ profil.html/ayarlar.html'de girdiği ayrı bir metin -- ikisi birebir
// aynı yazılmayabilir (ör. rehberde "Ahmet Yılmaz", profilde "Ahmet Y."). Bu
// yüzden basinGorevlileri {uid,name} çiftleri de bir isim->uid köprüsü olarak
// tutulur; profil adı eşleşmezse buradan denenir -- ikisi de aynı uid'ye
// bağlandığı için köprü doğru kişiyi bulur.
let rosterNameIndex = new Map();

// kanban.js/tasks-widget.js sayfa açılışında roster.js'in loadPressOfficerPool()
// çıktısını buraya kaydeder (bkz. çağrı yerleri). Rehber nadiren değiştiği için
// bir kerelik kayıt yeterli.
export function registerRosterNames(pool) {
  rosterNameIndex = new Map();
  (pool || []).forEach((p) => {
    const key = normalizePersonKey(p && p.name);
    if (key && p.uid) { rosterNameIndex.set(key, p.uid); }
  });
}

function rebuildNameIndex() {
  profilesByName = new Map();
  Object.keys(profilesCache).forEach((uid) => {
    const p = profilesCache[uid];
    if (p && p.displayName) { profilesByName.set(normalizePersonKey(p.displayName), uid); }
  });
}

function dispatch() {
  subscribers.forEach((cb) => { try { cb(profilesCache); } catch (err) { console.error('Personel profili işlenemedi:', err); } });
}

// database: çağıran sayfanın kendi firebase.database() örneği. Aynı sayfada
// birden fazla kez çağrılırsa dinleyici yalnızca BİR KEZ açılır.
export function subscribeStaffProfiles(database, cb) {
  subscribers.add(cb);
  if (profilesCache && Object.keys(profilesCache).length) { cb(profilesCache); }
  if (!listenerStarted) {
    listenerStarted = true;
    database.ref(STAFF_PROFILES_PATH).on('value', (snap) => {
      profilesCache = snap.val() || {};
      rebuildNameIndex();
      dispatch();
    }, (err) => {
      console.error('Personel profilleri okunamadı:', err);
      profilesCache = {};
      rebuildNameIndex();
      dispatch();
    });
  }
  return () => { subscribers.delete(cb); };
}

// uid varsa önce uid ile; yoksa önce staffProfiles'ın KENDİ isim indeksiyle,
// bulamazsa roster (basinGorevlileri) isim köprüsüyle dener -- gorevli/
// haberYazanlari alanındaki isim, kişinin profilde kendi girdiği adla değil
// rehberdeki adla birebir eşleşiyor olabilir (bkz. registerRosterNames notu).
export function findStaffProfile(uidOrNull, personName) {
  if (uidOrNull && profilesCache[uidOrNull]) { return Object.assign({ uid: uidOrNull }, profilesCache[uidOrNull]); }
  const key = normalizePersonKey(personName);
  if (!key) { return null; }
  const uid = profilesByName.get(key) || rosterNameIndex.get(key);
  if (!uid || !profilesCache[uid]) { return null; }
  return Object.assign({ uid }, profilesCache[uid]);
}

// title: erişilebilir etiket/tooltip metni (ör. "Basın görevlisi · Haber yazarı").
// size: piksel (kare). Baş harf fallback'i her zaman güvenli (escapeHtml).
export function renderStaffAvatar(personName, uid, title, size) {
  const profile = findStaffProfile(uid || null, personName);
  const s = size || 24;
  const safeTitle = escapeHtml(title || personName || '');
  if (profile && isSafeAvatarUrl(profile.avatarUrl)) {
    const safeUrl = String(profile.avatarUrl).replace(/["'()]/g, '');
    return `<span class="staff-avatar" style="width:${s}px;height:${s}px;background-image:url(&quot;${safeUrl}&quot;)" role="img" aria-label="${safeTitle}" data-tooltip="${safeTitle}"></span>`;
  }
  const initial = String(personName || '?').trim().charAt(0).toUpperCase() || '?';
  return `<span class="staff-avatar staff-avatar--initial" style="width:${s}px;height:${s}px" role="img" aria-label="${safeTitle}" data-tooltip="${safeTitle}">${escapeHtml(initial)}</span>`;
}

const ROLE_LABELS = { gorevli: 'Basın görevlisi', haberYazanlari: 'Haber yazarı' };

// gorevli + haberYazanlari (virgülle ayrılmış iki ayrı metin) -- AYNI kişi
// ikisinde birden geçiyorsa TEK kayıt, roles: ['gorevli','haberYazanlari']
// (Kanban/Yapılacaklar kartlarında kullanıcı isteği: "tek insan = tek avatar").
// excludeName verilirse (tamamlayan kişi) o isim listeden çıkarılır -- ayrı bir
// rozet olarak zaten gösteriliyor, rol avatarında TEKRAR göstermemek için.
export function mergeAttendeeRoles(gorevliStr, haberYazanlariStr, excludeName) {
  const excludeKey = excludeName ? normalizePersonKey(excludeName) : '';
  const byKey = new Map();
  function addAll(str, role) {
    String(str || '').split(',').map((s) => s.trim()).filter(Boolean).forEach((name) => {
      const key = normalizePersonKey(name);
      if (!key || key === excludeKey) { return; }
      if (!byKey.has(key)) { byKey.set(key, { name, roles: [] }); }
      if (byKey.get(key).roles.indexOf(role) === -1) { byKey.get(key).roles.push(role); }
    });
  }
  addAll(gorevliStr, 'gorevli');
  addAll(haberYazanlariStr, 'haberYazanlari');
  return Array.from(byKey.values());
}

// Kanban.js VE tasks-widget.js'in İKİSİNİN de kullandığı TEK render mantığı --
// "iki farklı ve zamanla ayrışacak uygulama yazma" (kullanıcı isteği).
export function renderAttendeeAvatarsHtml(gorevliStr, haberYazanlariStr, excludeName, size) {
  const people = mergeAttendeeRoles(gorevliStr, haberYazanlariStr, excludeName);
  return people.map((p) => {
    const title = p.roles.map((r) => ROLE_LABELS[r]).join(' · ');
    return renderStaffAvatar(p.name, null, title, size);
  }).join('');
}

// "Tamamlayan: [kişi]" rozeti -- kartın sağ üst köşesinde, rol avatarlarından
// AYRI gösterilir (kullanıcı isteği). Yeni kayıtlarda tamamlayanUid var, eski
// kayıtlarda yok -- o zaman tamamlayan (ad) ya da tamamlayanEmail fallback.
export function renderCompleterAvatarHtml(event, size) {
  const name = event && (event.tamamlayan || event.tamamlayanEmail);
  if (!name) { return ''; }
  const label = name + ' tamamladı';
  const html = renderStaffAvatar(name, event.tamamlayanUid || null, label, size);
  return html.replace('class="staff-avatar', 'class="staff-avatar staff-avatar--done');
}

// profil.html / ayarlar.html'den, kullanıcı kendi adını/avatarını her
// güncellediğinde çağrılır -- staffProfiles/{uid} eşzamanlı güncel kalır.
// patch: {displayName} ve/veya {avatarUrl} (avatarUrl: null kaldırmak için).
export function syncStaffProfile(database, uid, patch) {
  if (!uid) { return Promise.resolve(); }
  return database.ref(STAFF_PROFILES_PATH + '/' + uid).update(patch);
}
