// Test Modu + Salt-Okunur Kilit — ana sitedeki (app.js) mekanizmanın admin paneli karşılığı.
//
// NEDEN: Ana site TÜM içerik okuma/yazmalarını `dbPath()`'ten geçiriyor (app.js:1470);
// `ayarlar/testModuAcik` açıkken hedef `test/etkinlikler`, `test/logs/etkinlik` vb. oluyor.
// Ayrıca `ayarlar/saltOkunur` açıkken `canEditData()` (app.js:126) rol ne olursa olsun
// düzenlemeyi kapatıyor. Admin paneli bu ikisini HİÇ tanımıyordu:
//   - Test modu açıkken ana site güvenle `test/` dalında çalışırken admin paneli CANLI
//     veriyi gösterip CANLI veriye yazıyordu — test modunun tüm koruma amacı boşa çıkıyordu.
//   - Salt-okunur kilit açıkken (yedekleme/bakım için konan acil kilit) ana site kilitliyken
//     admin panelinden yazmaya devam edilebiliyordu.
// Bu modül ikisini de tek yerden yönetir; her admin sayfası buradan geçer.
//
// `users/` (hesap/rol) ana sitedeki gibi ASLA gölgelenmez — test modunda da gerçek yoldan
// okunur, yoksa kimse giriş yapamazdı.

let testModeEnabled = false;
let readOnlyEnabled = false;
let startedPromise = null;
const listeners = new Set();

/** Test modundayken yolu `test/` dalına yönlendirir (app.js dbPath ile birebir aynı). */
export function dbPath(basePath) { return testModeEnabled ? 'test/' + basePath : basePath; }

/** Salt-okunur kilit açık mı? Açıkken rol ne olursa olsun yazma yapılmamalı. */
export function isReadOnly() { return readOnlyEnabled; }

/** Test modu açık mı? (Sayfa üstündeki uyarı şeridi için.) */
export function isTestMode() { return testModeEnabled; }

/**
 * Rol tabanlı yazma yetkisini salt-okunur kilidiyle birleştirir — ana sitedeki
 * `canEditData()`'nın (app.js:126) aynısı: rol yeterli OLSA BİLE kilit açıksa false.
 */
export function canWriteWithRole(role) {
  const roleOk = role === 'editor' || role === 'admin' || role === 'owner';
  return roleOk && !readOnlyEnabled;
}

/**
 * Mod değiştiğinde (başka bir admin test modunu/kilidi açıp kapattığında, sayfa
 * yenilenmeden) haber verilir. Sayfalar bu geri çağırmada veriyi YENİDEN bağlamalı:
 * zaten açık `.on()` dinleyicileri yeni yola kendiliğinden geçmez (app.js:1489-1493'teki
 * aynı not).
 */
export function onDbModeChange(cb) { listeners.add(cb); return () => listeners.delete(cb); }

function notify() { listeners.forEach((cb) => { try { cb(); } catch (err) { console.error('db-mode dinleyicisi hata verdi:', err); } }); }

/**
 * İki ayarı da canlı dinlemeye başlar ve İLK değerleri okunduğunda çözülen bir promise
 * döner. Sayfalar veriyi çekmeden ÖNCE bunu beklemeli — aksi halde ilk okuma yanlış
 * dalda (test modu açıkken canlı, ya da tersi) yapılır.
 * `ayarlar/testModuAcik` ve `ayarlar/saltOkunur` kuralları `.read: true` olduğu için
 * girişsiz kullanıcıda da sorunsuz okunur.
 */
export function initDbMode(database) {
  // Aynı sayfada birden fazla widget/modül kendi initDbMode() çağrısını yapabilir (ör.
  // Operasyonlar sayfasında Görevler + Hızlı Etkinlik + Sayaç aynı anda yükleniyor).
  // Modül tekil (Vite tek kopya bundler) olduğu için `startedPromise` PAYLAŞILIR --
  // sonraki çağrılar YENİ dinleyici açmadan, İLK çağrının promise'ini bekler. Öncesinde
  // burada `started` bir boolean'dı ve ikinci çağrı anında çözülen bir promise dönüyordu
  // -- bu da ikinci widget'ın testModoEnabled/readOnlyEnabled henüz Firebase'den
  // okunmadan (varsayılan false ile) veri çekmeye başlamasına yol açabiliyordu.
  if (startedPromise) { return startedPromise; }
  if (!database) { return Promise.resolve(); }

  let resolveTest, resolveRead;
  const firstTest = new Promise((r) => { resolveTest = r; });
  const firstRead = new Promise((r) => { resolveRead = r; });

  database.ref('ayarlar/testModuAcik').on('value', (snap) => {
    const next = !!snap.val();
    const changed = next !== testModeEnabled;
    testModeEnabled = next;
    resolveTest();
    if (changed) { notify(); }
  }, (err) => { console.error('Test modu durumu okunamadı:', err); resolveTest(); });

  database.ref('ayarlar/saltOkunur').on('value', (snap) => {
    const next = !!snap.val();
    const changed = next !== readOnlyEnabled;
    readOnlyEnabled = next;
    resolveRead();
    if (changed) { notify(); }
  }, (err) => { console.error('Salt-okunur durumu okunamadı:', err); resolveRead(); });

  startedPromise = Promise.all([firstTest, firstRead]);
  return startedPromise;
}

/**
 * Sayfanın üstüne, ana sitedeki #testModeBanner'ın karşılığı bir uyarı şeridi basar/kaldırır.
 * Admin panelinde hangi dalda çalışıldığının GÖRÜNÜR olması kritik: aksi halde kullanıcı
 * test verisini canlı sanıp yanlış karar verir.
 */
export function renderDbModeBanner() {
  const id = 'dbModeBanner';
  let el = document.getElementById(id);
  const parts = [];
  if (testModeEnabled) { parts.push('🧪 TEST MODU — değişiklikler test/ dalına yazılır, canlı veriye dokunulmaz'); }
  if (readOnlyEnabled) { parts.push('🔒 SALT-OKUNUR KİLİT — veri değişikliği kapalı'); }
  if (!parts.length) { if (el) { el.remove(); } return; }
  if (!el) {
    el = document.createElement('div');
    el.id = id;
    el.className = 'db-mode-banner';
    document.body.prepend(el);
  }
  el.classList.toggle('is-locked', readOnlyEnabled);
  el.textContent = parts.join(' · ');
}
