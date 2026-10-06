import { personKey } from '../calendar/eventMutations.ts'
import { MissingRecordError, mutateExistingRecord } from '../calendar/recordTransactions.ts'
import type { RecordStore } from '../calendar/recordTransactions.ts'

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
  reviewDecision?: 'approve' | 'reject'
  reviewedByUid?: string
  reviewedByName?: string
  reviewedAt?: number
  rejectReason?: string
}

export interface AttendanceEvent {
  gorevli?: string
  haberYazanlari?: string
  guncellemeTs?: number
}

export function addApprovedAttendee<T extends AttendanceEvent>(event: T, request: AttendanceRequest, timestamp: number): T {
  if (!request.attendeeName?.trim() || !['gorevli', 'haberYazanlari'].includes(request.role ?? '')) throw new Error('Geçersiz katılım talebi.')
  const field = request.role!
  const names = String(event[field] ?? '').split(',').map((name) => name.trim()).filter(Boolean)
  if (names.some((name) => personKey(name) === personKey(request.attendeeName!))) return event
  names.push(request.attendeeName.trim())
  return { ...event, [field]: names.sort((a, b) => a.localeCompare(b, 'tr')).join(', '), guncellemeTs: timestamp }
}

/** Karar önce talepte atomik olarak sahiplenilir. Yarıda kalan aynı karar güvenle tekrar denenebilir. */
export async function reviewAttendance(
  requestStore: RecordStore<AttendanceRequest>,
  eventStore: (eventId: string) => RecordStore<AttendanceEvent>,
  decision: 'approve' | 'reject',
  reviewer: { uid: string; name: string },
  timestamp: () => number,
): Promise<{ request: AttendanceRequest; newlyFinalized: boolean }> {
  const request = await mutateExistingRecord(requestStore, (current) => {
    if (current.reviewDecision && current.reviewDecision !== decision) throw new Error('Bu talep için farklı bir karar işleme alındı.')
    if (current.status !== 'pending') {
      if (current.status !== (decision === 'approve' ? 'approved' : 'rejected')) throw new Error('Bu talep zaten sonuçlandırıldı.')
      return current
    }
    return { ...current, reviewDecision: decision, reviewedByUid: current.reviewedByUid || reviewer.uid, reviewedByName: current.reviewedByName || reviewer.name }
  })
  if (!request) throw new MissingRecordError()
  if (request.status !== 'pending') return { request, newlyFinalized: false }
  let rejectReason: string | undefined
  if (decision === 'approve') {
    if (!request.eventId) throw new Error('Talebin etkinlik kimliği eksik.')
    try {
      await mutateExistingRecord(eventStore(request.eventId), (event) => addApprovedAttendee(event, request, timestamp()))
    } catch (err) {
      if (!(err instanceof MissingRecordError)) throw err
      rejectReason = 'event_deleted'
    }
  }
  let newlyFinalized = false
  const result = await mutateExistingRecord(requestStore, (current): AttendanceRequest => {
    newlyFinalized = false
    if (current.reviewDecision !== decision) throw new Error('Talebin inceleme kararı değişti.')
    if (current.status !== 'pending') return current
    newlyFinalized = true
    return { ...current, status: decision === 'approve' && !rejectReason ? 'approved' : 'rejected', reviewedAt: timestamp(), ...(rejectReason ? { rejectReason } : {}) }
  })
  if (!result) throw new MissingRecordError()
  return { request: result, newlyFinalized }
}
