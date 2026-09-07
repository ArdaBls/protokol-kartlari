// Geçmiş etkinliğe sonradan kişi ekleme onay akışı -- attendanceRequests/{id}.
// Bir kişi, ZATEN BİTMİŞ bir etkinliğe "basın görevlisi/haber yazarı olarak
// gitti" şeklinde eklenmek istendiğinde DOĞRUDAN etkinliğe/istatistiklere
// yazılmaz (bkz. calendar.js'teki cal-ev-role-basin/haber checkbox handler,
// calHasEventEnded ile geçmiş kontrolü) -- admin/owner onayı bekleyen bir
// kayıt oluşturulur. Onaylanana kadar hiçbir istatistiğe girmez (charts.js
// zaten sadece gerçek etkinlik.gorevli/haberYazanlari alanlarını okuyor,
// pending talepler o alanlara hiç yazılmadığı için otomatik olarak dışarıda
// kalıyor -- ayrı bir filtre gerekmiyor).
//
// Durumlar SADECE: pending | approved | rejected.

import { dbPath } from './db-mode.js';

// Türkçe-güvenli kişi anahtarı -- İ/ı, ş/ç/ğ/ö/ü büyük/küçük harf farklarını
// tolere eder, aynı kişinin iki farklı yazımla iki kez eklenmesini önler.
export function normalizePersonKey(name) {
  return String(name || '').trim().toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ');
}

export async function createAttendanceRequest(database, opts) {
  const {
    eventId, eventName, eventDate, attendeeUid, attendeeName, role,
    requestedByUid, requestedByName
  } = opts || {};
  if (!eventId || !attendeeName || !requestedByUid) {
    throw new Error('Katılım talebi için etkinlik, kişi ve istek sahibi zorunlu.');
  }
  const requestsPath = dbPath('attendanceRequests');
  const requestKey = database.ref(requestsPath).push().key;
  const request = {
    eventId, eventName: eventName || '', eventDate: eventDate || '',
    attendeeUid: attendeeUid || null, attendeeName,
    role: role === 'haberYazanlari' ? 'haberYazanlari' : 'gorevli',
    requestedByUid, requestedByName: requestedByName || '',
    requestedAt: firebase.database.ServerValue.TIMESTAMP,
    status: 'pending', reviewedByUid: null, reviewedByName: null, reviewedAt: null
  };
  await database.ref(requestsPath + '/' + requestKey).set(request);
  return requestKey;
}

function notificationPatch(uid, notif) {
  const patch = {};
  if (!uid) { return patch; }
  const key = 'notif_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  patch[dbPath('notifications/' + uid + '/' + key)] = Object.assign({
    createdAt: firebase.database.ServerValue.TIMESTAMP, read: false
  }, notif);
  return patch;
}

// Onayla: idempotent. Aynı talep ikinci kez (çift tık, iki sekme, eşzamanlı
// admin) onaylanmaya çalışılırsa mükerrer katılımcı EKLENMEZ -- talep zaten
// approved ise sessizce {alreadyApproved:true} döner, kişi zaten
// gorevli/haberYazanlari listesindeyse (aynı normalize edilmiş adla) alan
// hiç yazılmaz.
export async function approveAttendanceRequest(database, requestId, reviewerUid, reviewerName) {
  const reqRef = database.ref(dbPath('attendanceRequests/' + requestId));
  const snap = await reqRef.once('value');
  const req = snap.val();
  if (!req) { throw new Error('Talep bulunamadı.'); }
  if (req.status === 'approved') { return { ok: true, alreadyApproved: true }; }
  if (req.status !== 'pending') { throw new Error('Bu talep zaten işleme alınmış (' + req.status + ').'); }
  const eventSnap = await database.ref(dbPath('etkinlikler/' + req.eventId)).once('value');
  const event = eventSnap.val();
  const updates = {};
  if (!event) {
    updates[dbPath('attendanceRequests/' + requestId + '/status')] = 'rejected';
    updates[dbPath('attendanceRequests/' + requestId + '/reviewedByUid')] = reviewerUid;
    updates[dbPath('attendanceRequests/' + requestId + '/reviewedByName')] = reviewerName || '';
    updates[dbPath('attendanceRequests/' + requestId + '/reviewedAt')] = firebase.database.ServerValue.TIMESTAMP;
    updates[dbPath('attendanceRequests/' + requestId + '/rejectReason')] = 'event_deleted';
    Object.assign(updates, notificationPatch(req.requestedByUid, {
      type: 'attendance_request_result', title: 'Katılım talebi reddedildi',
      message: (req.attendeeName || 'Kişi') + ' için gönderdiğiniz katılım talebi işlenemedi: etkinlik artık mevcut değil.',
      relatedEventId: req.eventId, relatedRequestId: requestId
    }));
    await database.ref('/').update(updates);
    throw new Error('Etkinlik artık mevcut değil, talep reddedildi.');
  }
  const field = req.role === 'haberYazanlari' ? 'haberYazanlari' : 'gorevli';
  const existing = String(event[field] || '').split(',').map((s) => s.trim()).filter(Boolean);
  const already = existing.some((n) => normalizePersonKey(n) === normalizePersonKey(req.attendeeName));
  if (!already) {
    existing.push(req.attendeeName);
    existing.sort((a, b) => a.localeCompare(b, 'tr'));
    updates[dbPath('etkinlikler/' + req.eventId + '/' + field)] = existing.join(', ');
    updates[dbPath('etkinlikler/' + req.eventId + '/guncellemeTs')] = firebase.database.ServerValue.TIMESTAMP;
  }
  updates[dbPath('attendanceRequests/' + requestId + '/status')] = 'approved';
  updates[dbPath('attendanceRequests/' + requestId + '/reviewedByUid')] = reviewerUid;
  updates[dbPath('attendanceRequests/' + requestId + '/reviewedByName')] = reviewerName || '';
  updates[dbPath('attendanceRequests/' + requestId + '/reviewedAt')] = firebase.database.ServerValue.TIMESTAMP;
  Object.assign(updates, notificationPatch(req.requestedByUid, {
    type: 'attendance_request_result', title: 'Katılım talebiniz onaylandı',
    message: (req.attendeeName || 'Kişi') + ', ' + (req.eventName || 'etkinlik') + ' etkinliğine ' + (req.eventDate || '') + ' tarihinde gitti olarak eklendi.',
    relatedEventId: req.eventId, relatedRequestId: requestId
  }));
  await database.ref('/').update(updates);
  return { ok: true, alreadyApproved: false, duplicate: already };
}

export async function rejectAttendanceRequest(database, requestId, reviewerUid, reviewerName) {
  const reqRef = database.ref(dbPath('attendanceRequests/' + requestId));
  const snap = await reqRef.once('value');
  const req = snap.val();
  if (!req) { throw new Error('Talep bulunamadı.'); }
  if (req.status !== 'pending') { return { ok: true, alreadyHandled: true }; }
  const updates = {};
  updates[dbPath('attendanceRequests/' + requestId + '/status')] = 'rejected';
  updates[dbPath('attendanceRequests/' + requestId + '/reviewedByUid')] = reviewerUid;
  updates[dbPath('attendanceRequests/' + requestId + '/reviewedByName')] = reviewerName || '';
  updates[dbPath('attendanceRequests/' + requestId + '/reviewedAt')] = firebase.database.ServerValue.TIMESTAMP;
  Object.assign(updates, notificationPatch(req.requestedByUid, {
    type: 'attendance_request_result', title: 'Katılım talebiniz reddedildi',
    message: (req.attendeeName || 'Kişi') + ', ' + (req.eventName || 'etkinlik') + ' etkinliğine eklenmedi.',
    relatedEventId: req.eventId, relatedRequestId: requestId
  }));
  await database.ref('/').update(updates);
  return { ok: true };
}

// Admin/owner bildirim panelinin listesi için: pending taleplerin tümü.
export function loadPendingAttendanceRequests(database) {
  return database.ref(dbPath('attendanceRequests')).orderByChild('status').equalTo('pending').once('value')
    .then((snap) => {
      const val = snap.val() || {};
      return Object.keys(val).map((id) => Object.assign({ _id: id }, val[id]));
    });
}
