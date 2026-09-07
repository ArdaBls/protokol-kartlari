// Kanban "Tamamlandı" kartları + Yapılacaklar widget'ı ortak avatar mantığı testi.
//
// Kullanıcı isteği: Kanban ve to-do widget'ı AYNI avatar mantığını kullansın
// -- "iki farklı ve zamanla ayrışacak uygulama yazma"; aynı kişi hem basın
// görevlisi hem haber yazarıysa tek avatar; tamamlayan kişi ayrı gösterilsin,
// kartlara yeni durum değişiminde tamamlayanUid de yazılsın.
//
// gantt-test.js ile aynı yaklaşım: kaynak metin üzerinde statik doğrulama --
// kanban.js ve tasks-widget.js gerçek DOM/Firebase bağımlılıkları taşıdığı
// için doğrudan import yerine kaynağın kendisi denetleniyor (asıl avatar/
// birleştirme MANTIĞI staff-profiles-test.js'te doğrudan içe aktarılıp
// fonksiyon düzeyinde test ediliyor).
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const kanban = read('docs/admin-src/src/v4/kanban.js');
const tasksWidget = read('docs/admin-src/src/v4/tasks-widget.js');
const staffProfiles = read('docs/admin-src/src/v4/staff-profiles.js');
const appsScss = read('docs/admin-src/src/scss/v4/_apps.scss');
const widgetsScss = read('docs/admin-src/src/scss/v4/_widgets.scss');

// 1) İkisi de AYNI paylaşımlı modülden avatar üretiyor -- diverging implementasyon yok.
assert.match(kanban, /import\s*\{[^}]*renderAttendeeAvatarsHtml[^}]*\}\s*from\s*'\.\/staff-profiles\.js'/,
  'kanban.js rol avatarlarını staff-profiles.js paylaşılan modülünden almalı');
assert.match(kanban, /import\s*\{[^}]*renderCompleterAvatarHtml[^}]*\}\s*from\s*'\.\/staff-profiles\.js'/,
  'kanban.js tamamlayan avatarını staff-profiles.js paylaşılan modülünden almalı');
assert.match(tasksWidget, /import\s*\{[^}]*renderCompleterAvatarHtml[^}]*\}\s*from\s*'\.\/staff-profiles\.js'/,
  'tasks-widget.js tamamlayan avatarını staff-profiles.js paylaşılan modülünden almalı');
console.log('PASS: Kanban ve Yapılacaklar widget\'ı aynı paylaşılan avatar modülünü kullanıyor');

// 2) Kanban kendi ayrı bir isim-birleştirme/avatar üretme mantığı YAZMAMALI
//    (eskiden var olan parseNameList kaldırıldı, tekrar eklenmemeli).
assert.doesNotMatch(kanban, /function\s+parseNameList/,
  'kanban.js kendi ayrı isim-listesi ayrıştırma mantığı yazmamalı, staff-profiles.js\'in mergeAttendeeRoles\'unu kullanmalı');
console.log('PASS: Kanban ayrışan/tekrarlanan avatar mantığı içermiyor');

// 3) Durum "tamamlandi" olunca tamamlayanUid de yazılıyor (yeni kayıtlar için).
assert.match(kanban, /tamamlayanUid.*currentUserUid/, 'Kanban kart taşınınca tamamlayanUid yazmalı');
assert.match(tasksWidget, /tamamlayanUid.*currentUserUid/, 'Yapılacaklar widget\'ı görev tamamlanınca tamamlayanUid yazmalı');
console.log('PASS: Kanban ve Yapılacaklar tamamlanma anında tamamlayanUid alanını dolduruyor');

// 4) Legacy geriye dönük uyumluluk: tamamlayanEmail hâlâ okunuyor (staff-profiles.js'te).
assert.match(staffProfiles, /tamamlayanEmail/, 'eski kayıtlarda isim yoksa tamamlayanEmail\'e düşülmeli');
console.log('PASS: staff-profiles.js legacy tamamlayanEmail alanına geriye dönük uyumlu düşüyor');

// 5) Tamamlayan rozeti kartın sağ üst köşesinde, rol avatarlarından ayrı konumlanıyor
//    (yalnızca Kanban'a özel -- paylaşılan .staff-avatar--done taban kuralı akış-içi kalmalı).
assert.match(appsScss, /\.kanban-card-avatars\s+\.staff-avatar--done\s*\{[^}]*position:\s*absolute/,
  'Kanban\'da tamamlayan rozeti sağ üst köşede mutlak konumlanmalı');
console.log('PASS: Kanban tamamlayan rozeti rol avatarlarından ayrı, köşede konumlanmış');

// 6) HTML-injection güvenliği: kişi adları asla ham innerHTML ile yazılmamalı --
//    her iki dosya da staff-profiles.js'in ESCAPE EDİLMİŞ render fonksiyonlarını
//    kullanıyor (staff-profiles-test.js bu fonksiyonların escape ettiğini
//    doğrudan doğruluyor), burada yalnızca çağrı noktalarının güvenli fonksiyona
//    gittiği, ham string birleştirmeyle innerHTML'e yazılmadığı kontrol ediliyor.
assert.doesNotMatch(kanban, /innerHTML\s*=[^;]*\be\.gorevli\b/, 'gorevli alanı doğrudan innerHTML\'e yazılmamalı');
assert.doesNotMatch(kanban, /innerHTML\s*=[^;]*\be\.haberYazanlari\b/, 'haberYazanlari alanı doğrudan innerHTML\'e yazılmamalı');
console.log('PASS: Kanban kişi adlarını doğrudan innerHTML\'e yazmıyor, escape eden ortak fonksiyonu kullanıyor');

console.log('ALL_TESTS_PASSED: true');
