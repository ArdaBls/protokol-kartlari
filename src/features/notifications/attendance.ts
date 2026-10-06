// Katılım onayı: kayıt başına transaction, yinelenebilir karar ve deterministik bildirim.
import { push, ref, serverTimestamp, update } from 'firebase/database'
import { db } from '../../lib/firebase'
import { dbPathFor } from '../../lib/dbMode'
import { assertWritableDbPath, firebaseRecordStore } from '../calendar/firebaseRecordStore'
import { reviewAttendance } from './attendanceReview'
import type { AttendanceEvent, AttendanceRequest } from './attendanceReview'
export type { AttendanceRequest } from './attendanceReview'

async function reviewRequest(requestId: string, reviewerUid: string, reviewerName: string, isTestMode: boolean, decision: 'approve' | 'reject') {
  const path = (base: string) => dbPathFor(base, isTestMode)
  const { request: req, newlyFinalized } = await reviewAttendance(
    firebaseRecordStore<AttendanceRequest>(path(`attendanceRequests/${requestId}`)),
    (eventId) => firebaseRecordStore<AttendanceEvent>(path(`etkinlikler/${eventId}`)),
    decision, { uid: reviewerUid, name: reviewerName }, () => serverTimestamp() as unknown as number,
  )
  if (newlyFinalized && req.requestedByUid) {
    const base = path(`notifications/${req.requestedByUid}/attendance_${requestId}`)
    const approved = req.status === 'approved'
    // Yalnız sonuçlandırma transaction'ını kazanan istemci bildirir; tekrarlar read'i sıfırlamaz.
    const notification = {
      createdAt: req.reviewedAt ?? serverTimestamp(), type: 'attendance_request_result', read: false,
      title: approved ? 'Katılım talebiniz onaylandı' : 'Katılım talebiniz reddedildi',
      message: req.rejectReason === 'event_deleted' ? 'Etkinlik artık mevcut değil, katılım talebi reddedildi.'
        : `${req.attendeeName ?? 'Kişi'}, ${req.eventName ?? 'etkinlik'} etkinliğine ${approved ? 'gitti olarak eklendi' : 'eklenmedi'}.`,
      relatedEventId: req.eventId ?? null, relatedRequestId: requestId,
    }
    try {
      assertWritableDbPath(base)
      await update(ref(db), Object.fromEntries(Object.entries(notification).map(([key, value]) => [`${base}/${key}`, value])))
    } catch (err) {
      console.error('Talep sonuçlandı ancak bildirim gönderilemedi:', err)
      throw new Error(`Talep ${approved ? 'onaylandı' : 'reddedildi'}, ancak kişisel bildirim gönderilemedi.`)
    }
  }
  if (req.rejectReason === 'event_deleted') throw new Error('Etkinlik artık mevcut değil, talep reddedildi.')
}

export async function approveAttendanceRequest(requestId: string, reviewerUid: string, reviewerName: string, isTestMode: boolean): Promise<void> {
  await reviewRequest(requestId, reviewerUid, reviewerName, isTestMode, 'approve')
}

export async function rejectAttendanceRequest(requestId: string, reviewerUid: string, reviewerName: string, isTestMode: boolean): Promise<void> {
  await reviewRequest(requestId, reviewerUid, reviewerName, isTestMode, 'reject')
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

export async function createAttendanceRequests(requests: NewAttendanceRequest[], isTestMode: boolean): Promise<void> {
  if (!requests.length) return
  const requestsPath = dbPathFor('attendanceRequests', isTestMode)
  const updates: Record<string, unknown> = {}
  for (const request of requests) {
    const key = push(ref(db, requestsPath)).key
    if (!key) throw new Error('Talep kimliği oluşturulamadı.')
    updates[`${requestsPath}/${key}`] = { ...request, attendeeUid: request.attendeeUid ?? null, requestedAt: serverTimestamp(), status: 'pending' }
  }
  assertWritableDbPath(requestsPath)
  await update(ref(db), updates)
}

export async function createAttendanceRequest(request: NewAttendanceRequest, isTestMode: boolean): Promise<void> {
  await createAttendanceRequests([request], isTestMode)
}
