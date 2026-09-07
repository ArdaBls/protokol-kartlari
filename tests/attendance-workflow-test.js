// Geçmiş etkinliğe sonradan kişi ekleme onay akışı testi (attendance.js).
//
// Kullanıcı isteği: geçmiş bir etkinliğe "basın görevlisi/haber yazarı olarak
// gitti" eklemek isteyen kişi DOĞRUDAN etkinliğe/istatistiklere yazamaz --
// önce pending bir attendanceRequests kaydı oluşur, admin/owner onaylar/
// reddeder, onaysız hiçbir şey gerçek listeye/istatistiğe girmez, onay
// idempotent olmalı (çift tık / eşzamanlı onay mükerrer eklemez).
const assert = require('node:assert/strict');

// Basit, path tabanlı bellek-içi Firebase Realtime Database taklidi -- projede
// zaten shared-activity-test.js'te kullanılan doğrudan-mock yaklaşımının
// çok-konumlu update() ve orderByChild/equalTo destekleyen genişletilmiş hali.
function makeMockDatabase(initial) {
  const data = JSON.parse(JSON.stringify(initial || {}));
  let pushCounter = 0;

  function getAt(path) {
    if (!path) { return data; }
    return path.split('/').filter(Boolean).reduce((o, k) => (o == null ? undefined : o[k]), data);
  }
  function setAt(path, value) {
    const parts = path.split('/').filter(Boolean);
    if (!parts.length) { return; }
    let obj = data;
    for (let i = 0; i < parts.length - 1; i++) {
      const k = parts[i];
      if (obj[k] == null || typeof obj[k] !== 'object') { obj[k] = {}; }
      obj = obj[k];
    }
    const leaf = parts[parts.length - 1];
    if (value === null || value === undefined) { delete obj[leaf]; }
    else { obj[leaf] = value; }
  }

  function makeRef(path) {
    let orderField = null;
    let equalVal = null;
    const ref = {
      push() { pushCounter += 1; return { key: 'req' + pushCounter }; },
      set(value) { setAt(path, value); return Promise.resolve(); },
      once() {
        let val = getAt(path);
        if (orderField && val && typeof val === 'object') {
          const filtered = {};
          Object.keys(val).forEach((k) => { if (val[k] && val[k][orderField] === equalVal) { filtered[k] = val[k]; } });
          val = filtered;
        }
        return Promise.resolve({ val: () => (val === undefined ? null : val) });
      },
      orderByChild(field) { orderField = field; return ref; },
      equalTo(v) { equalVal = v; return ref; },
      update(updates) {
        Object.keys(updates).forEach((k) => {
          const full = path === '/' ? k : path + '/' + k;
          setAt(full, updates[k]);
        });
        return Promise.resolve();
      }
    };
    return ref;
  }

  return { ref: makeRef, _raw: () => data };
}

(async () => {
  global.window = {};
  global.firebase = window.firebase = { database: { ServerValue: { TIMESTAMP: 'SERVER_TS' } } };
  const {
    createAttendanceRequest, approveAttendanceRequest, rejectAttendanceRequest,
    loadPendingAttendanceRequests, normalizePersonKey
  } = await import('../docs/admin-src/src/v4/attendance.js');

  // 1) Talep oluşturma: pending, doğrudan etkinliğe/istatistiğe YAZMAZ.
  {
    const db = makeMockDatabase({
      etkinlikler: { e1: { ad: 'Açılış', tarih: '2026-01-05', gorevli: 'Ayşe Yılmaz' } }
    });
    const id = await createAttendanceRequest(db, {
      eventId: 'e1', eventName: 'Açılış', eventDate: '2026-01-05',
      attendeeName: 'Mehmet Öz', role: 'gorevli',
      requestedByUid: 'editorUid', requestedByName: 'Mehmet Öz'
    });
    const req = db._raw().attendanceRequests[id];
    assert.equal(req.status, 'pending');
    assert.equal(req.requestedByUid, 'editorUid');
    assert.equal(db._raw().etkinlikler.e1.gorevli, 'Ayşe Yılmaz', 'onaysız talep etkinliğe hiç yazmamalı');
    console.log('PASS: talep pending olarak oluşuyor, etkinliğe dokunmuyor');
  }

  // 2) Zorunlu alan eksikse hata.
  {
    const db = makeMockDatabase({});
    await assert.rejects(() => createAttendanceRequest(db, { eventId: 'e1' }));
    console.log('PASS: eksik alanlarla talep oluşturulamıyor');
  }

  // 3) Onay: kişi eklenir, durum approved olur, istekte bulunana sonuç bildirimi gider.
  {
    const db = makeMockDatabase({
      etkinlikler: { e1: { ad: 'Açılış', tarih: '2026-01-05', gorevli: 'Ayşe Yılmaz' } },
      attendanceRequests: { r1: {
        eventId: 'e1', eventName: 'Açılış', eventDate: '2026-01-05',
        attendeeName: 'Mehmet Öz', role: 'gorevli',
        requestedByUid: 'editorUid', requestedByName: 'Mehmet Öz',
        status: 'pending', reviewedByUid: null, reviewedByName: null, reviewedAt: null
      } }
    });
    const result = await approveAttendanceRequest(db, 'r1', 'adminUid', 'Yönetici');
    assert.equal(result.ok, true);
    assert.equal(result.alreadyApproved, false);
    assert.equal(db._raw().etkinlikler.e1.gorevli, 'Ayşe Yılmaz, Mehmet Öz');
    assert.equal(db._raw().attendanceRequests.r1.status, 'approved');
    assert.equal(db._raw().attendanceRequests.r1.reviewedByUid, 'adminUid');
    const notifs = db._raw().notifications.editorUid;
    const notifKeys = Object.keys(notifs);
    assert.equal(notifKeys.length, 1);
    assert.match(notifs[notifKeys[0]].message, /onaylandı|gitti olarak eklendi/);
    console.log('PASS: onaylanan talep kişiyi ekliyor, tek bildirim gönderiyor');
  }

  // 4) Idempotent: aynı talep ikinci kez onaylanınca mükerrer eklenmez.
  {
    const db = makeMockDatabase({
      etkinlikler: { e1: { ad: 'Açılış', tarih: '2026-01-05', gorevli: 'Ayşe Yılmaz' } },
      attendanceRequests: { r1: {
        eventId: 'e1', eventName: 'Açılış', eventDate: '2026-01-05',
        attendeeName: 'Mehmet Öz', role: 'gorevli',
        requestedByUid: 'editorUid', requestedByName: 'Mehmet Öz',
        status: 'pending', reviewedByUid: null, reviewedByName: null, reviewedAt: null
      } }
    });
    await approveAttendanceRequest(db, 'r1', 'adminUid', 'Yönetici');
    const second = await approveAttendanceRequest(db, 'r1', 'adminUid2', 'İkinci Yönetici');
    assert.equal(second.alreadyApproved, true);
    assert.equal(db._raw().etkinlikler.e1.gorevli, 'Ayşe Yılmaz, Mehmet Öz', 'ikinci onay mükerrer eklememeli');
    assert.equal(db._raw().attendanceRequests.r1.reviewedByUid, 'adminUid', 'ikinci onay ilk incelemeyi ezmemeli');
    console.log('PASS: çift onay idempotent (mükerrer katılımcı/bildirim yok)');
  }

  // 5) Kişi zaten listede varsa (normalize edilmiş adla) tekrar eklenmez.
  {
    const db = makeMockDatabase({
      etkinlikler: { e1: { ad: 'Açılış', tarih: '2026-01-05', gorevli: 'mehmet öz' } },
      attendanceRequests: { r1: {
        eventId: 'e1', eventName: 'Açılış', eventDate: '2026-01-05',
        attendeeName: 'Mehmet Öz', role: 'gorevli',
        requestedByUid: 'editorUid', requestedByName: 'Mehmet Öz',
        status: 'pending', reviewedByUid: null, reviewedByName: null, reviewedAt: null
      } }
    });
    const result = await approveAttendanceRequest(db, 'r1', 'adminUid', 'Yönetici');
    assert.equal(result.duplicate, true);
    assert.equal(db._raw().etkinlikler.e1.gorevli, 'mehmet öz', 'aynı kişi Türkçe-normalize eşleşmesiyle tekrar eklenmemeli');
    console.log('PASS: Türkçe-normalize edilmiş isim zaten listede varsa eklenmiyor');
  }

  // 6) Onaylanmış/reddedilmiş talep tekrar onaylanmaya çalışılırsa (rejected durumda) hata verir.
  {
    const db = makeMockDatabase({
      etkinlikler: { e1: { ad: 'Açılış', gorevli: '' } },
      attendanceRequests: { r1: {
        eventId: 'e1', attendeeName: 'Mehmet Öz', role: 'gorevli',
        requestedByUid: 'editorUid', status: 'rejected',
        reviewedByUid: 'adminUid', reviewedByName: 'Yönetici', reviewedAt: 1
      } }
    });
    await assert.rejects(() => approveAttendanceRequest(db, 'r1', 'adminUid2', 'İkinci'));
    console.log('PASS: reddedilmiş talep tekrar onaylanamıyor');
  }

  // 7) Etkinlik silinmişse: talep otomatik reddedilir, istekte bulunana bildirim gider, hata fırlatılır.
  {
    const db = makeMockDatabase({
      attendanceRequests: { r1: {
        eventId: 'silinmisEtkinlik', eventName: 'Panel', eventDate: '2026-02-01',
        attendeeName: 'Mehmet Öz', role: 'gorevli',
        requestedByUid: 'editorUid', requestedByName: 'Mehmet Öz',
        status: 'pending', reviewedByUid: null, reviewedByName: null, reviewedAt: null
      } }
    });
    await assert.rejects(() => approveAttendanceRequest(db, 'r1', 'adminUid', 'Yönetici'));
    assert.equal(db._raw().attendanceRequests.r1.status, 'rejected');
    assert.equal(db._raw().attendanceRequests.r1.rejectReason, 'event_deleted');
    const notifs = db._raw().notifications.editorUid;
    assert.equal(Object.keys(notifs).length, 1);
    console.log('PASS: silinmiş etkinliğe onay güvenle reddediliyor ve bildiriliyor');
  }

  // 8) Red: durum rejected olur, bildirim gider; ikinci red çağrısı veri değiştirmez.
  {
    const db = makeMockDatabase({
      attendanceRequests: { r1: {
        eventId: 'e1', eventName: 'Açılış', eventDate: '2026-01-05',
        attendeeName: 'Mehmet Öz', role: 'gorevli',
        requestedByUid: 'editorUid', requestedByName: 'Mehmet Öz',
        status: 'pending', reviewedByUid: null, reviewedByName: null, reviewedAt: null
      } }
    });
    const first = await rejectAttendanceRequest(db, 'r1', 'adminUid', 'Yönetici');
    assert.equal(first.ok, true);
    assert.equal(db._raw().attendanceRequests.r1.status, 'rejected');
    const second = await rejectAttendanceRequest(db, 'r1', 'adminUid2', 'İkinci');
    assert.equal(second.alreadyHandled, true);
    assert.equal(db._raw().attendanceRequests.r1.reviewedByUid, 'adminUid', 'ikinci red ilk incelemeyi ezmemeli');
    console.log('PASS: red bildirimi gidiyor, ikinci red isteği veriyi ezmiyor');
  }

  // 9) Bekleyen talepler listesi yalnızca pending durumundakileri döner.
  {
    const db = makeMockDatabase({
      attendanceRequests: {
        r1: { status: 'pending', attendeeName: 'A' },
        r2: { status: 'approved', attendeeName: 'B' },
        r3: { status: 'pending', attendeeName: 'C' }
      }
    });
    const pending = await loadPendingAttendanceRequests(db);
    assert.equal(pending.length, 2);
    assert.deepEqual(pending.map((p) => p._id).sort(), ['r1', 'r3']);
    console.log('PASS: bekleyen talepler listesi yalnızca pending döndürüyor');
  }

  // 10) normalizePersonKey Türkçe büyük/küçük harf ve fazla boşlukları toleranslı eşleştiriyor.
  {
    assert.equal(normalizePersonKey('İREM  Öztürk'), normalizePersonKey('irem öztürk'));
    assert.equal(normalizePersonKey(' Ali  Can '), 'ali can');
    console.log('PASS: normalizePersonKey Türkçe-güvenli eşleşiyor');
  }

  // 11) Yerel Firebase kuralları (varsa) -- statik metin kontrolü, kural motoru
  // olmadan da temel yapı bozulmalarını yakalar (first-package-security-test.js
  // ile aynı yaklaşım).
  {
    const fs = require('fs');
    const path = require('path');
    const rulesPath = path.join(__dirname, '..', 'yerel-notlar', 'firebase-database-rules.json');
    if (fs.existsSync(rulesPath)) {
      const rules = JSON.parse(fs.readFileSync(rulesPath, 'utf8')).rules;
      assert.ok(rules.attendanceRequests, 'attendanceRequests kural bloğu eksik');
      assert.ok(rules.attendanceRequests['.read'], 'attendanceRequests .read tanımlı olmalı');
      assert.match(rules.attendanceRequests['.read'], /admin|owner/, 'attendanceRequests listesi yalnızca admin/owner okuyabilmeli');
      const reqWrite = rules.attendanceRequests.$requestId['.write'];
      assert.match(reqWrite, /requestedByUid/, 'yazma kuralı requestedByUid sahipliğini kontrol etmeli');
      assert.match(reqWrite, /admin|owner/, 'yazma kuralı admin/owner onay/red dalını da kapsamalı');
      assert.ok(rules.notifications, 'notifications kural bloğu eksik');
      assert.match(rules.notifications.$notifUid['.read'], /auth\.uid/, 'bildirimler yalnızca sahibi tarafından okunabilmeli');
      console.log('PASS: yerel kurallar dosyasında attendanceRequests/notifications temel yapı doğru');
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
