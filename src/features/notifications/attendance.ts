// Geçmiş etkinliğe sonradan kişi ekleme onay akışı -- eski admin-src/src/v4/attendance.js'in karşılığı.
import { get, push, ref, serverTimestamp, update } from 'firebase/database'
import { db } from '../../lib/firebase'
import { dbPathFor } from '../../lib/dbMode'

export interface AttendanceRequest {
  eventId?: string
  eventName?: string
  eventDate?: string
  attendeeUid?: string | null
  attendeeName?: string
  role?: 'gorevli' | 'haberYazanlari'
  requestedByUid?: string
  requestedByName?: string
  requestedAt?: number
  status?: 'pending' | 'approved' | 'rejected'
}

interface EventRecord {
  gorevli?: string
  haberYazanlari?: string
  [key: string]: unknown
}

const normalizePersonKey = (name?: string) => String(name ?? '').trim().toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ')

function notificationPatch(basePath: string, uid: string | undefined, notif: Record<string, unknown>): Record<string, unknown> {
  if (!uid) return {}
  const key = `notif_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  return { [`${basePath}/${uid}/${key}`]: { createdAt: serverTimestamp(), read: false, ...notif } }
}

export async function approveAttendanceRequest(requestId: string, reviewerUid: string, reviewerName: string, isTestMode: boolean): Promise<void> {
  const path = (base: string) => dbPathFor(base, isTestMode)
  const snap = await get(ref(db, path(`attendanceRequests/${requestId}`)))
  const req = snap.val() as AttendanceRequest | null
  if (!req) throw new Error('Talep bulunamadı.')
  if (req.status === 'approved') return
  if (req.status !== 'pending') throw new Error(`Bu talep zaten işleme alınmış (${req.status}).`)

  const notifBase = path('notifications')
  const eventSnap = await get(ref(db, path(`etkinlikler/${req.eventId}`)))
  const event = eventSnap.val() as EventRecord | null
  const updates: Record<string, unknown> = {}

  if (!event) {
    updates[path(`attendanceRequests/${requestId}/status`)] = 'rejected'
    updates[path(`attendanceRequests/${requestId}/reviewedByUid`)] = reviewerUid
    updates[path(`attendanceRequests/${requestId}/reviewedByName`)] = reviewerName
    updates[path(`attendanceRequests/${requestId}/reviewedAt`)] = serverTimestamp()
    updates[path(`attendanceRequests/${requestId}/rejectReason`)] = 'event_deleted'
    Object.assign(updates, notificationPatch(notifBase, req.requestedByUid, {
      type: 'attendance_request_result', title: 'Katılım talebi reddedildi',
      message: `${req.attendeeName ?? 'Kişi'} için gönderdiğiniz katılım talebi işlenemedi: etkinlik artık mevcut değil.`,
      relatedEventId: req.eventId ?? null, relatedRequestId: requestId,
    }))
    await update(ref(db), updates)
    throw new Error('Etkinlik artık mevcut değil, talep reddedildi.')
  }

  const field = req.role === 'haberYazanlari' ? 'haberYazanlari' : 'gorevli'
  const existing = String(event[field] ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const already = existing.some((n) => normalizePersonKey(n) === normalizePersonKey(req.attendeeName))
  if (!already && req.attendeeName) {
    existing.push(req.attendeeName)
    existing.sort((a, b) => a.localeCompare(b, 'tr'))
    updates[path(`etkinlikler/${req.eventId}/${field}`)] = existing.join(', ')
    updates[path(`etkinlikler/${req.eventId}/guncellemeTs`)] = serverTimestamp()
  }
  updates[path(`attendanceRequests/${requestId}/status`)] = 'approved'
  updates[path(`attendanceRequests/${requestId}/reviewedByUid`)] = reviewerUid
  updates[path(`attendanceRequests/${requestId}/reviewedByName`)] = reviewerName
  updates[path(`attendanceRequests/${requestId}/reviewedAt`)] = serverTimestamp()
  Object.assign(updates, notificationPatch(notifBase, req.requestedByUid, {
    type: 'attendance_request_result', title: 'Katılım talebiniz onaylandı',
    message: `${req.attendeeName ?? 'Kişi'}, ${req.eventName ?? 'etkinlik'} etkinliğine ${req.eventDate ?? ''} tarihinde gitti olarak eklendi.`,
    relatedEventId: req.eventId ?? null, relatedRequestId: requestId,
  }))
  await update(ref(db), updates)
}

export async function rejectAttendanceRequest(requestId: string, reviewerUid: string, reviewerName: string, isTestMode: boolean): Promise<void> {
  const path = (base: string) => dbPathFor(base, isTestMode)
  const snap = await get(ref(db, path(`attendanceRequests/${requestId}`)))
  const req = snap.val() as AttendanceRequest | null
  if (!req) throw new Error('Talep bulunamadı.')
  if (req.status !== 'pending') return
  const updates: Record<string, unknown> = {
    [path(`attendanceRequests/${requestId}/status`)]: 'rejected',
    [path(`attendanceRequests/${requestId}/reviewedByUid`)]: reviewerUid,
    [path(`attendanceRequests/${requestId}/reviewedByName`)]: reviewerName,
    [path(`attendanceRequests/${requestId}/reviewedAt`)]: serverTimestamp(),
  }
  Object.assign(updates, notificationPatch(path('notifications'), req.requestedByUid, {
    type: 'attendance_request_result', title: 'Katılım talebiniz reddedildi',
    message: `${req.attendeeName ?? 'Kişi'}, ${req.eventName ?? 'etkinlik'} etkinliğine eklenmedi.`,
    relatedEventId: req.eventId ?? null, relatedRequestId: requestId,
  }))
  await update(ref(db), updates)
}

export interface NewAttendanceRequest {
  eventId: string
  eventName: string
  eventDate: string
  attendeeUid?: string | null
  attendeeName: string
  role: 'gorevli' | 'haberYazanlari'
  requestedByUid: string
  requestedByName: string
}

/** Geçmiş (bitmiş) bir etkinliğe editörün sonradan "gitti" olarak eklemek istediği kişi için
 * admin/owner onayı bekleyen bir talep açar -- onaylanana kadar hiçbir istatistiğe girmez. */
export async function createAttendanceRequest(request: NewAttendanceRequest, isTestMode: boolean): Promise<void> {
  const path = (base: string) => dbPathFor(base, isTestMode)
  const requestsPath = path('attendanceRequests')
  const key = push(ref(db, requestsPath)).key
  if (!key) throw new Error('Talep kimliği oluşturulamadı.')
  await update(ref(db), {
    [`${requestsPath}/${key}`]: {
      eventId: request.eventId, eventName: request.eventName, eventDate: request.eventDate,
      attendeeUid: request.attendeeUid ?? null, attendeeName: request.attendeeName, role: request.role,
      requestedByUid: request.requestedByUid, requestedByName: request.requestedByName,
      requestedAt: serverTimestamp(), status: 'pending', reviewedByUid: null, reviewedByName: null, reviewedAt: null,
    },
  })
}
