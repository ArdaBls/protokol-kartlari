import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import test from 'node:test'
import ExcelJS from 'exceljs'
import type { CalendarEventWithId } from '../src/features/calendar/calendarTypes'
import { calendarExportData, canExportCalendar, exportDateTime, exportEndDate } from '../src/features/calendar/calendarExportData'
import { createCalendarWorkbook } from '../src/features/calendar/calendarExportWorkbook'

const options = { year: 2026, includeCancelled: true, includeDrafts: true, isTestMode: false, generatedAt: new Date('2026-10-06T12:00:00Z') }
const events: CalendarEventWithId[] = [
  { _id: 'jan-conference', ad: 'Bilim ve Toplum Konferansı', tarih: '2026-01-08', saat: '10:30', bitisSaat: '12:00', tur: 'konferans', durum: 'tamamlandi', yer: 'Üniversite Konferans Salonu', birim: 'Kurumsal İletişim Birimi', gorevli: 'Örnek Basın Görevlisi', haberYazanlari: 'Örnek Haber Yazarı', katilimcilar: [{ name: 'Örnek Konuşmacı', title: 'Araştırmacı', kaynak: 'universite' }] },
  { _id: 'jan-meeting', ad: 'Yıl Başı Koordinasyon Toplantısı', tarih: '2026-01-15', saat: '14:00', bitisSaat: '15:30', tur: 'toplanti', durum: 'planlandi', birim: 'İdari Birimler' },
  { _id: 'cross-month', ad: 'Uluslararası Bilim Çalıştayı', tarih: '2026-01-30', bitisTarihi: '2026-02-02', tur: 'calistay', durum: 'tamamlandi', yer: 'Kongre ve Kültür Merkezi' },
  { _id: 'feb-cancelled', ad: 'Kış Konseri', tarih: '2026-02-10', saat: '19:00', tur: 'konser', durum: 'iptal' },
  { _id: 'feb-draft', ad: 'Yeni Dönem Tanıtım Etkinliği', tarih: '2026-02-12', tur: 'acilis', durum: 'planlandi', taslak: true },
  { _id: 'oct-overnight', ad: 'Sanat Gecesi', tarih: '2026-10-31', saat: '23:30', bitisSaat: '00:30', tur: 'konser', durum: 'yaziliyor' },
  { _id: 'unknown', ad: '=HYPERLINK("https://example.invalid")', tarih: '2026-12-31', tur: 'Yeni tür', durum: 'Yeni durum' },
  { _id: 'next-year', ad: 'Gelecek yıl', tarih: '2027-01-01', tur: 'toplanti' },
  { _id: 'invalid', ad: 'Tarihi düzeltilmesi gereken kayıt', tarih: '2026-02-31', tur: 'diger' },
]

test('Excel export is restricted to admin and owner roles', () => {
  for (const role of ['admin', 'owner']) assert.equal(canExportCalendar(role), true)
  for (const role of ['editor', 'pending', undefined, '']) assert.equal(canExportCalendar(role), false)
})

test('year and month grouping neither duplicates multi-day events nor loses invalid dates', () => {
  const report = calendarExportData(events, options)
  assert.equal(report.selected.length, 7)
  assert.equal(report.months[0].length, 3)
  assert.equal(report.months[1].length, 2)
  assert.equal(report.months.flat().length, report.selected.length)
  assert.deepEqual(report.invalid.map((event) => event._id), ['invalid'])
  assert.equal(calendarExportData(events, { ...options, includeCancelled: false, includeDrafts: false }).selected.length, 5)
})

test('export dates preserve local date components and overnight end dates', () => {
  assert.equal(exportDateTime('2026-10-06', '10:30')?.toISOString(), '2026-10-06T10:30:00.000Z')
  assert.equal(exportDateTime('2026-02-31', '10:30'), null)
  assert.equal(exportEndDate(events[5])?.toISOString(), '2026-11-01T00:30:00.000Z')
  assert.equal(exportEndDate(events[2])?.toISOString(), '2026-02-02T00:00:00.000Z')
  assert.equal(exportEndDate(events[4]), null)
})

test('workbook roundtrip retains typed dates, filters, summaries and literal untrusted text', async () => {
  const workbook = createCalendarWorkbook(events, options)
  assert.equal(workbook.worksheets.length, 15)
  assert.equal(workbook.worksheets[0].name, 'Yıllık Özet')
  assert.equal(workbook.worksheets[12].name, '12 Aralık')
  const summary = workbook.getWorksheet('Yıllık Özet')!
  assert.equal(summary.getCell('B5').result, 7)
  assert.equal(summary.getCell('B8').result, 3)
  assert.equal(summary.getCell('B9').result, 2)
  assert.equal(summary.getCell('B20').result, 7)
  assert.equal(summary.getCell('H20').result, 1)
  assert.equal(summary.getCell('I20').result, 1)
  const bytes = await workbook.xlsx.writeBuffer()
  const reloaded = new ExcelJS.Workbook()
  await reloaded.xlsx.load(bytes)
  const details = reloaded.getWorksheet('Etkinlik Detayları')!
  assert.equal((details.getCell('B7').value as Date).toISOString(), '2026-01-08T10:30:00.000Z')
  assert.equal(details.getCell('F13').value, events[6].ad)
  assert.equal(details.getCell('F13').type, ExcelJS.ValueType.String)
  assert.equal(details.getCell('F13').formula, undefined)
  assert.equal(reloaded.getWorksheet('01 Ocak')!.getTables().length, 3)
  assert.equal(details.views[0].state, 'frozen')
  assert.equal(reloaded.getWorksheet('01 Ocak')!.pageSetup.orientation, 'landscape')
  assert.equal(reloaded.getWorksheet('Yıllık Özet')!.getCell('B20').result, 7)
  if (process.env.CALENDAR_EXPORT_PREVIEW === '1') {
    await mkdir('tmp/calendar-export', { recursive: true })
    await workbook.xlsx.writeFile('tmp/calendar-export/calendar-report.xlsx')
  }
})

test('empty year exports a complete usable workbook with zero totals', async () => {
  const workbook = createCalendarWorkbook([], options)
  assert.equal(workbook.worksheets.length, 14)
  assert.equal(workbook.getWorksheet('Yıllık Özet')!.getCell('B20').result, 0)
  assert.match(String(workbook.getWorksheet('01 Ocak')!.getCell('A7').value), /etkinlik bulunmuyor/)
  assert.ok((await workbook.xlsx.writeBuffer()).byteLength > 0)
})
