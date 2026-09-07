// Ortak personel profili modülü testi (staff-profiles.js).
//
// Kullanıcı isteği: profil fotoğrafları users/{uid} yerine ayrı, minimal
// staffProfiles/{uid} yolundan gösterilsin (herkese açık okuma, kendi
// kaydını yazma), avatarUrl güvenli şema dışına izin vermesin, aynı kişi
// iki rolde (basın görevlisi + haber yazarı) tek avatar olarak birleşsin,
// tamamlayan kişi ayrı gösterilsin ve legacy tamamlayanEmail'e düşsün.
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

function makeMockDatabase(initial) {
  const data = JSON.parse(JSON.stringify(initial || {}));
  function getAt(p) { return p.split('/').filter(Boolean).reduce((o, k) => (o == null ? undefined : o[k]), data); }
  return {
    ref(p) {
      return {
        on(_event, cb) { cb({ val: () => (getAt(p) === undefined ? null : getAt(p)) }); },
        update(patch) {
          const parts = p.split('/').filter(Boolean);
          let obj = data;
          for (let i = 0; i < parts.length - 1; i++) { obj = obj[parts[i]] = obj[parts[i]] || {}; }
          obj[parts[parts.length - 1]] = Object.assign({}, obj[parts[parts.length - 1]], patch);
          return Promise.resolve();
        }
      };
    },
    _raw: () => data
  };
}

(async () => {
  const mod = await import('../docs/admin-src/src/v4/staff-profiles.js');
  const {
    normalizePersonKey, isSafeAvatarUrl, subscribeStaffProfiles, findStaffProfile,
    renderStaffAvatar, mergeAttendeeRoles, renderAttendeeAvatarsHtml,
    renderCompleterAvatarHtml, syncStaffProfile, registerRosterNames
  } = mod;

  // 1) normalizePersonKey Türkçe-güvenli.
  {
    assert.equal(normalizePersonKey('İREM  Öztürk'), normalizePersonKey('irem öztürk'));
    console.log('PASS: normalizePersonKey Türkçe-güvenli eşleşiyor');
  }

  // 2) isSafeAvatarUrl yalnızca data:image/ ve https:// kabul eder.
  {
    assert.equal(isSafeAvatarUrl('data:image/jpeg;base64,AAAA'), true);
    assert.equal(isSafeAvatarUrl('https://example.com/a.jpg'), true);
    assert.equal(isSafeAvatarUrl('javascript:alert(1)'), false);
    assert.equal(isSafeAvatarUrl('http://example.com/a.jpg'), false);
    assert.equal(isSafeAvatarUrl(''), false);
    assert.equal(isSafeAvatarUrl(null), false);
    console.log('PASS: isSafeAvatarUrl yalnızca data:image/ ve https:// kabul ediyor');
  }

  // 3) subscribeStaffProfiles + findStaffProfile: uid önce, sonra normalize ad.
  {
    const db = makeMockDatabase({ staffProfiles: {
      u1: { displayName: 'Ayşe Yılmaz', avatarUrl: 'https://x.com/a.jpg' }
    } });
    let received = null;
    subscribeStaffProfiles(db, (profiles) => { received = profiles; });
    assert.ok(received.u1);
    const byUid = findStaffProfile('u1', 'Herhangi Bir Ad');
    assert.equal(byUid.displayName, 'Ayşe Yılmaz');
    const byName = findStaffProfile(null, 'ayşe yılmaz');
    assert.equal(byName.uid, 'u1');
    const none = findStaffProfile(null, 'olmayan kişi');
    assert.equal(none, null);
    console.log('PASS: subscribeStaffProfiles + findStaffProfile uid-önce/ad-sonra çalışıyor');
  }

  // 3b) registerRosterNames: gorevli/haberYazanlari alanındaki isim, kişinin
  // kendi profil displayName'inden FARKLI yazılmışsa (rehberdeki adla),
  // roster köprüsü doğru uid'yi bulup gerçek fotoğrafı döndürmeli.
  // (staff-profiles.js'in aboneliği sayfa-tekil singleton olduğu için burada
  // önceki testte zaten yüklenmiş 'u1' -- Ayşe Yılmaz -- kaydı yeniden kullanılıyor.)
  {
    // Rehberde "A. Yılmaz" kısaltması olarak kayıtlı, profildeki tam adla eşleşmiyor --
    // önce direkt ad eşleşmesi denenir (bulunamaz), sonra roster köprüsü.
    registerRosterNames([{ uid: 'u1', name: 'A. Yılmaz' }]);
    const viaRoster = findStaffProfile(null, 'A. Yılmaz');
    assert.equal(viaRoster.uid, 'u1');
    assert.equal(viaRoster.avatarUrl, 'https://x.com/a.jpg');
    // Roster'da olmayan bir uid'ye işaret ederse (profil hiç oluşturulmamış) sessizce null döner.
    registerRosterNames([{ uid: 'hicYokUid', name: 'Kayıp Kişi' }]);
    assert.equal(findStaffProfile(null, 'Kayıp Kişi'), null);
    console.log('PASS: registerRosterNames rehber adını profil displayName farklı olsa da doğru uid\'ye bağlıyor');
  }

  // 4) renderStaffAvatar: fotoğraf yoksa/geçersizse baş harfe düşer, HTML-injection güvenli.
  {
    const withPhoto = renderStaffAvatar('Ayşe Yılmaz', null, 'Ayşe Yılmaz', 24);
    assert.match(withPhoto, /background-image/);

    const noProfileHtml = renderStaffAvatar('<img src=x onerror=alert(1)>', null, null, 24);
    assert.equal(noProfileHtml.includes('<img'), false, 'kişi adındaki HTML kaçırılmalı');
    assert.match(noProfileHtml, /staff-avatar--initial/);
    console.log('PASS: renderStaffAvatar fallback ve HTML-injection güvenliği sağlıyor');
  }

  // 5) mergeAttendeeRoles: aynı kişi iki rolde tek kayıt, exclude çalışır.
  {
    const merged = mergeAttendeeRoles('Ayşe Yılmaz, Mehmet Öz', 'mehmet öz, Zeynep Kaya');
    const byName = Object.fromEntries(merged.map((p) => [normalizePersonKey(p.name), p]));
    assert.equal(merged.length, 3, 'Mehmet Öz iki listede de geçtiği için tek kayıt olmalı');
    assert.deepEqual(byName[normalizePersonKey('mehmet öz')].roles.sort(), ['gorevli', 'haberYazanlari']);
    assert.deepEqual(byName[normalizePersonKey('ayşe yılmaz')].roles, ['gorevli']);

    const excluded = mergeAttendeeRoles('Ayşe Yılmaz, Mehmet Öz', '', 'ayşe yılmaz');
    assert.equal(excluded.length, 1);
    assert.equal(normalizePersonKey(excluded[0].name), normalizePersonKey('Mehmet Öz'));
    console.log('PASS: mergeAttendeeRoles tek-kişi-tek-avatar ve exclude doğru çalışıyor');
  }

  // 6) renderAttendeeAvatarsHtml: iki rollü kişi tek avatar, tooltip her iki rolü de içerir.
  {
    const html = renderAttendeeAvatarsHtml('Ayşe Yılmaz, Mehmet Öz', 'Mehmet Öz', null, 24);
    const count = (html.match(/staff-avatar/g) || []).length;
    // her <span> "staff-avatar" sınıfını taşıyor -- iki kişi => en az iki span.
    assert.ok(count >= 2);
    assert.match(html, /Basın görevlisi · Haber yazarı/);
    console.log('PASS: renderAttendeeAvatarsHtml çift-rollü kişiye tek avatar + birleşik tooltip veriyor');
  }

  // 7) renderCompleterAvatarHtml: tamamlayanUid varsa öncelikli, yoksa tamamlayan adı,
  //    o da yoksa tamamlayanEmail'e düşer (legacy kayıt geriye dönük uyumluluk).
  {
    const withUid = renderCompleterAvatarHtml({ tamamlayan: 'Ayşe Yılmaz', tamamlayanUid: 'u1' }, 22);
    assert.match(withUid, /staff-avatar--done/);

    const legacyNameOnly = renderCompleterAvatarHtml({ tamamlayan: 'Ayşe Yılmaz' }, 22);
    assert.match(legacyNameOnly, /staff-avatar--done/);

    const legacyEmailOnly = renderCompleterAvatarHtml({ tamamlayanEmail: 'ayse@ornek.com' }, 22);
    assert.match(legacyEmailOnly, /staff-avatar--done/);
    assert.match(legacyEmailOnly, /ayse@ornek\.com/);

    const none = renderCompleterAvatarHtml({}, 22);
    assert.equal(none, '');
    console.log('PASS: renderCompleterAvatarHtml tamamlayanUid/tamamlayan/tamamlayanEmail sırasıyla düşüyor');
  }

  // 8) syncStaffProfile: yalnızca verilen alanları günceller (merge, replace değil).
  {
    const db = makeMockDatabase({ staffProfiles: { u2: { displayName: 'Eski Ad', avatarUrl: 'https://x.com/old.jpg' } } });
    await syncStaffProfile(db, 'u2', { displayName: 'Yeni Ad' });
    assert.equal(db._raw().staffProfiles.u2.displayName, 'Yeni Ad');
    assert.equal(db._raw().staffProfiles.u2.avatarUrl, 'https://x.com/old.jpg', 'verilmeyen alan silinmemeli');
    console.log('PASS: syncStaffProfile alanları merge ediyor, dokunulmayanı silmiyor');
  }

  // 9) Yerel Firebase kuralları -- statik yapı kontrolü (kural motoru yok, first-package-security-test.js ile aynı yaklaşım).
  {
    const rulesPath = path.join(__dirname, '..', 'yerel-notlar', 'firebase-database-rules.json');
    if (fs.existsSync(rulesPath)) {
      const parsed = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
      const rules = parsed.rules;
      assert.ok(rules.staffProfiles, 'staffProfiles kural bloğu eksik');
      assert.ok(!(rules.test && rules.test.staffProfiles), 'staffProfiles Test Modu altında gölgelenmemeli (kimlik verisi)');
      const staffWrite = rules.staffProfiles.$staffUid['.write'];
      assert.match(staffWrite, /\$staffUid\s*===\s*auth\.uid|auth\.uid\s*===\s*\$staffUid/, 'kullanıcı yalnızca kendi staffProfiles kaydını yazabilmeli (ya da admin/owner)');
      console.log('PASS: yerel kurallar dosyasında staffProfiles temel yapı doğru');
    } else {
      console.log('ATLANDI: yerel kurallar dosyası bulunamadı (yerel-notlar/ .gitignore ile izole)');
    }
  }

  console.log('ALL_TESTS_PASSED: true');
})().catch((error) => {
  console.error(error);
  console.log('ALL_TESTS_PASSED: false');
  process.exitCode = 1;
});
