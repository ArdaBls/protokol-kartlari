// Kişiler sayfası profil fotoğrafı testi (kisiler.html).
//
// Kullanıcı bulgusu: "kişiler sayfasında avatarlar boş gözükmekte ancak sadece
// resim ekleyenler boş gözüküyor, diğerleri baş harfle devam ediyor". Kök sebep:
// style="..." çift tırnakla sarılı bir HTML NİTELİĞİ içine LİTERAL " konulmuştu
// (background-image:url("...")) -- tarayıcı ilk " karakterinde niteliği erken
// kapatıyor, base64 veri ve niteliğin geri kalanı bozuluyor, arka plan resmi HİÇ
// uygulanmıyor. &quot; kullanılmalı (bkz. staff-profiles.js renderStaffAvatar'daki
// AYNI, doğru çözüm). Statik kaynak kontrolü -- gantt-test.js ile aynı yaklaşım.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const source = fs.readFileSync(path.join(__dirname, '..', 'docs', 'admin-src', 'production', 'kisiler.html'), 'utf8');

assert.doesNotMatch(source, /background-image:url\("/,
  'avatarUrl doğrudan style="..." niteliği içine literal çift tırnakla yazılmamalı (niteliği erken kapatıp arka plan resmini bozar)');
assert.match(source, /background-image:url\(&quot;/,
  'avatarUrl style="..." niteliği içine &quot; (HTML varlığı) ile yazılmalı, literal " ile DEĞİL');

// avatarUrl'in kendisi de escape edilmeli -- kullanıcı verisi (base64/https URL)
// hem admin/owner (users/{uid}.avatarUrl) hem editör (staffProfiles.avatarUrl)
// görünümünde aynı güvenli kalıpla render edilmeli.
const urlUsages = source.match(/background-image:url\(&quot;/g) || [];
assert.ok(urlUsages.length >= 2, 'hem admin/owner hem editör görünümü avatarUrl\'i güvenli şekilde render etmeli');

console.log('PASS: kisiler.html avatarUrl\'i style niteliğini bozmadan (&quot; ile) render ediyor');

// Kullanıcı bulgusu: "editörler adminin/kurucunun fotoğrafını göremiyor". Kök
// sebep: shell.js her sayfada (Kişiler'den ÖNCE) yalnızca displayName ile
// staffProfiles kaydı oluşturuyordu; kisiler.html'in geri-doldurması da "zaten
// var" deyip TAMAMEN eksik kayıtları atlıyordu -- fotoğrafı eksik ama kaydı
// var olanlar hiç tamamlanmıyordu.
assert.doesNotMatch(source, /if \(existing\[uid\]\) \{ return; \}/,
  'geri doldurma yalnızca TAMAMEN eksik kayıtları değil, fotoğrafı eksik olanları da tamamlamalı');
assert.match(source, /isSafeAvatarUrl\(mevcut\.avatarUrl\)/,
  'geri doldurma, var olan ama fotoğrafsız staffProfiles kayıtlarını da tamamlamalı');

const shellSource = fs.readFileSync(path.join(__dirname, '..', 'docs', 'admin-src', 'src', 'v4', 'shell.js'), 'utf8');
assert.match(shellSource, /syncPatch\.avatarUrl = u\.avatarUrl/,
  'shell.js giriş-anı senkronu SADECE displayName değil, varsa avatarUrl\'i de göndermeli (aksi halde ilk girişte fotoğrafsız kayıt oluşup geri doldurmayı engeller)');

console.log('PASS: shell.js giriş senkronu ve kisiler.html geri doldurması eksik fotoğrafları da tamamlıyor');

// Kullanıcı isteği: "div stats lar da editörlerde kişiler klasöründe gözüksün
// istatistikler gizli olmasın" -- editör görünümü (renderStaffDirectory)
// admin/owner ile AYNI Etkinlik/Haber istatistik kutularını göstermeli.
// etkinlikler zaten editöre açık (dbPath ile) -- PII sızıntısı yok.
assert.match(source, /function renderStaffDirectory\(profiles, events\)/,
  'renderStaffDirectory events parametresi almalı (istatistik hesaplamak için)');
assert.match(source, /gorevliCounts\[name\]/,
  'editör görünümü de Etkinlik sayısını göstermeli');
assert.match(source, /haberCounts\[name\]/,
  'editör görünümü de Haber sayısını göstermeli');
assert.match(source, /database\.ref\(dbPath\('etkinlikler'\)\)\.once\('value'\)/g,
  'editör görünümü istatistik için etkinlikler verisini de okumalı');

console.log('PASS: editör görünümünde de Etkinlik/Haber istatistikleri gösteriliyor');

// Kullanıcı kararı: editör görünümü artık admin/owner ile BİREBİR AYNI --
// rol ve e-posta da gösteriliyor. Ama role/email SADECE admin/owner tarafından
// yazılabilmeli (kişi kendi rolünü/e-postasını kendi kendine yazamasın) --
// bkz. yerel kurallardaki .validate. kisiler.html'in admin/owner geri
// doldurması bu iki alanı HER ZAMAN (yalnızca eksikse değil, güncel tutmak
// için) senkronlamalı.
assert.match(source, /<div class="role">\$\{escapeHtml\(ROLE_LABEL\[role\] \|\| role\)\}<\/div>/,
  'editör görünümü de rol rozetini göstermeli (admin/owner ile aynı kart tasarımı)');
const emailLineCount = (source.match(/word-break:break-word;margin-bottom:12px">\$\{escapeHtml\(/g) || []).length;
assert.ok(emailLineCount >= 2, 'hem admin/owner hem editör görünümü e-posta satırını aynı şekilde göstermeli');
assert.match(source, /updates\['staffProfiles\/' \+ uid \+ '\/role'\] = u\.role/,
  'admin/owner geri doldurması rolü users/ ile güncel tutmalı');
assert.match(source, /updates\['staffProfiles\/' \+ uid \+ '\/email'\] = u\.email/,
  'admin/owner geri doldurması e-postayı users/ ile güncel tutmalı');

const rulesPath = path.join(__dirname, '..', 'yerel-notlar', 'firebase-database-rules.json');
if (fs.existsSync(rulesPath)) {
  const rules = JSON.parse(fs.readFileSync(rulesPath, 'utf8')).rules;
  const staffRules = rules.staffProfiles.$staffUid;
  assert.ok(staffRules.role, 'staffProfiles kuralları role alanını doğrulamalı');
  assert.ok(staffRules.email, 'staffProfiles kuralları email alanını doğrulamalı');
  assert.match(staffRules.role['.validate'], /admin|owner/,
    'role alanı SADECE admin/owner tarafından yazılabilmeli (kendi kendine rol yazamama)');
  assert.match(staffRules.email['.validate'], /admin|owner/,
    'email alanı SADECE admin/owner tarafından yazılabilmeli (kendi kendine e-posta yazamama)');
  console.log('PASS: yerel kurallarda staffProfiles role/email yalnızca admin/owner tarafından yazılabiliyor');
} else {
  console.log('ATLANDI: yerel kurallar dosyası bulunamadı (yerel-notlar/ .gitignore ile izole)');
}

console.log('PASS: editör görünümü rol ve e-postayı admin/owner ile aynı şekilde gösteriyor');
console.log('ALL_TESTS_PASSED: true');
