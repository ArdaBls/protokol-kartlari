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
console.log('ALL_TESTS_PASSED: true');
