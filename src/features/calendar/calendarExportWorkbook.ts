import ExcelJS from 'exceljs'
import type { CellValue, PaperSize, Worksheet } from 'exceljs'
import type { CalendarEventWithId } from './calendarTypes'
import { CAL_MONTHS, EVENT_BADGES, EVENT_STATUS } from './calendarTypes'
import type { CalendarExportOptions } from './calendarExportData'
import { calendarExportData, exportDateTime, exportEndDate, exportStatusLabel, exportTimeMinutes, exportTypeLabel } from './calendarExportData'

const COLOR = { ink: 'FF282333', muted: 'FF72687E', purple: 'FF65418E', pale: 'FFF3EDF9', line: 'FFE5DDEB', white: 'FFFFFFFF' }
const DATE_FORMAT = 'dd.mm.yyyy'
const DATE_TIME_FORMAT = 'dd.mm.yyyy hh:mm'
const DETAILS = 'Etkinlik Detayları'
const MONTH_HEADERS = ['Başlangıç', 'Bitiş', 'Etkinlik', 'Yer', 'Düzenleyen birim', 'Basın görevlisi', 'Haber yazarı', 'Durum']
const MONTH_WIDTHS = [23, 23, 39, 27, 28, 25, 25, 19]

function setupSheet(sheet: Worksheet, widths: number[], title: string, subtitle: string) {
  sheet.columns = widths.map((width) => ({ width }))
  sheet.views = [{ showGridLines: false, zoomScale: 90 }]
  sheet.properties.defaultRowHeight = 21
  sheet.pageSetup = {
    // OOXML A3 is 8; ExcelJS's exported enum omits this documented paper size.
    orientation: 'landscape', paperSize: 8 as PaperSize, fitToPage: true, fitToWidth: 1, fitToHeight: 0,
    margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.15, footer: 0.15 },
  }
  sheet.headerFooter.oddFooter = '&LProtokol&C&A&R&P / &N'
  sheet.getCell('A2').value = title
  sheet.getCell('A2').font = { name: 'Arial', size: 16, bold: true, color: { argb: COLOR.purple } }
  sheet.getRow(2).height = 28
  sheet.getCell('A3').value = subtitle
  sheet.getCell('A3').font = { name: 'Arial', size: 10, italic: true, color: { argb: COLOR.muted } }
  sheet.getRow(3).height = 24
  for (let column = 1; column <= widths.length; column++) sheet.getCell(4, column).border = { bottom: { style: 'thin', color: { argb: COLOR.line } } }
}

function header(sheet: Worksheet, rowIndex: number, labels: string[]) {
  const row = sheet.getRow(rowIndex)
  labels.forEach((label, index) => {
    const cell = row.getCell(index + 1)
    cell.value = label
    cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: COLOR.white } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.purple } }
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    cell.border = { right: { style: 'thin', color: { argb: COLOR.white } } }
  })
  row.height = 32
}

function dataRow(sheet: Worksheet, index: number, values: CellValue[], widths: number[], stripe: boolean) {
  const row = sheet.getRow(index)
  row.values = values
  let lines = 1
  values.forEach((value, column) => {
    const cell = row.getCell(column + 1)
    cell.font = { name: 'Arial', size: 10, color: { argb: COLOR.ink } }
    cell.alignment = { vertical: 'middle', horizontal: typeof value === 'number' || value instanceof Date ? 'right' : 'left', wrapText: true }
    if (stripe) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.pale } }
    if (typeof value === 'string') lines = Math.max(lines, value.split('\n').reduce((count, part) => count + Math.max(1, Math.ceil(part.length / Math.max(8, widths[column] - 3))), 0))
    if (value instanceof Date) { cell.numFmt = DATE_FORMAT; lines = Math.max(lines, 2) }
  })
  row.height = Math.min(409, Math.max(32, lines * 14 + 10))
  return row
}

function statusColors(sheet: Worksheet, first: number, last: number, column: string) {
  if (last < first) return
  EVENT_STATUS.forEach((status, index) => sheet.addConditionalFormatting({
    ref: `${column}${first}:${column}${last}`,
    rules: [{ type: 'expression', priority: index + 1, formulae: [`${column}${first}="${status.ad}"`], style: { font: { color: { argb: `FF${status.renk.slice(1).toUpperCase()}` }, bold: true } } }],
  }))
}

function addTable(sheet: Worksheet, name: string, row: number, labels: string[], rows: CellValue[][], widths: number[]) {
  sheet.addTable({ name, ref: `A${row}`, headerRow: true, style: { theme: 'TableStyleMedium4', showRowStripes: false }, columns: labels.map((label) => ({ name: label, filterButton: true })), rows })
  header(sheet, row, labels)
  rows.forEach((values, index) => dataRow(sheet, row + index + 1, values, widths, index % 2 === 1))
}

function monthRows(events: CalendarEventWithId[]): CellValue[][] {
  return events.map((event) => [
    exportDateTime(event.tarih, event.saat), exportEndDate(event), `${event.ad || '(Adsız etkinlik)'}${event.taslak ? '\n(Taslak)' : ''}`,
    event.yer || '', event.birim || '', event.gorevli || '', event.haberYazanlari || '', exportStatusLabel(event),
  ])
}

/** Browser-compatible workbook builder; lazy-loaded only when an administrator exports. */
export function createCalendarWorkbook(events: readonly CalendarEventWithId[], options: CalendarExportOptions) {
  const report = calendarExportData(events, options)
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Protokol'
  workbook.title = `${options.year} Etkinlik Takvimi`
  workbook.subject = 'Aylık ve kategori bazında etkinlik raporu'
  workbook.created = options.generatedAt ?? new Date()
  workbook.modified = workbook.created
  workbook.calcProperties.fullCalcOnLoad = true
  const summary = workbook.addWorksheet('Yıllık Özet', { properties: { tabColor: { argb: COLOR.purple } } })
  const monthSheets = CAL_MONTHS.map((month, index) => workbook.addWorksheet(`${String(index + 1).padStart(2, '0')} ${month}`))
  const details = workbook.addWorksheet(DETAILS)
  const modeLabel = options.isTestMode ? 'Test verisi' : 'Takvim kayıtları'
  const scope = `${modeLabel} · ${options.year} · ${report.selected.length} etkinlik`
  const detailHeaders = ['Kayıt kimliği', 'Başlangıç', 'Bitiş', 'Kategori', 'Durum', 'Etkinlik', 'Yer', 'Düzenleyen birim', 'Planlayan', 'Basın görevlisi', 'Haber yazarı', 'Katılımcılar', 'Haber kaynağı', 'Rozetler', 'Notlar', 'Kilitli', 'Taslak', 'Oluşturan']
  const detailWidths = [28, 23, 23, 26, 20, 45, 28, 32, 26, 28, 28, 45, 17, 27, 48, 12, 12, 25]
  setupSheet(details, detailWidths, `${options.year} Etkinlik Detayları`, `${scope} · Başlangıç tarihine göre sıralı`)
  const detailRows: CellValue[][] = report.selected.map((event) => [
    event._id, exportDateTime(event.tarih, event.saat), exportEndDate(event), exportTypeLabel(event), exportStatusLabel(event), event.ad || '(Adsız etkinlik)',
    event.yer || '', event.birim || '', event.planlayan || '', event.gorevli || '', event.haberYazanlari || '',
    (event.katilimcilar ?? []).map((person) => [person.prefix, person.name, person.title].filter(Boolean).join(' ')).join('\n'),
    event.haberKaynagi || '', (event.rozetler ?? []).map((badge) => EVENT_BADGES.find((item) => item.key === badge)?.ad ?? badge).join(', '),
    event.not || '', event.locked ? 'Evet' : 'Hayır', event.taslak ? 'Evet' : 'Hayır', event.olusturan || '',
  ])
  if (detailRows.length) addTable(details, 'EtkinlikDetaylari', 6, detailHeaders, detailRows, detailWidths)
  else header(details, 6, detailHeaders)
  report.selected.forEach((event, index) => {
    details.getCell(index + 7, 2).numFmt = exportTimeMinutes(event.saat) === null ? DATE_FORMAT : DATE_TIME_FORMAT
    details.getCell(index + 7, 3).numFmt = exportTimeMinutes(event.bitisSaat) === null ? DATE_FORMAT : DATE_TIME_FORMAT
  })
  statusColors(details, 7, 6 + report.selected.length, 'E')
  details.views = [{ state: 'frozen', ySplit: 6, xSplit: 2, showGridLines: false, zoomScale: 90 }]
  details.pageSetup.printTitlesRow = '1:6'
  details.pageSetup.printArea = `A1:R${Math.max(7, details.rowCount)}`

  monthSheets.forEach((sheet, monthIndex) => {
    const monthEvents = report.months[monthIndex]
    setupSheet(sheet, MONTH_WIDTHS, `${CAL_MONTHS[monthIndex]} ${options.year}`, `${modeLabel} · ${monthEvents.length} etkinlik · Etkinlik türüne göre gruplandırıldı`)
    sheet.getCell('A5').value = { text: 'Yıllık özete dön', hyperlink: "#'Yıllık Özet'!A1" }
    sheet.getCell('A5').font = { name: 'Arial', size: 10, color: { argb: COLOR.purple }, underline: true }
    let row = 6
    report.types.forEach((type, categoryIndex) => {
      const categoryEvents = monthEvents.filter((event) => exportTypeLabel(event) === type)
      if (!categoryEvents.length) return
      sheet.mergeCells(row, 1, row, 8)
      const band = sheet.getCell(row, 1)
      band.value = `${type} (${categoryEvents.length})`
      band.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.pale } }
      band.font = { name: 'Arial', size: 11, bold: true, color: { argb: COLOR.purple } }
      band.alignment = { vertical: 'middle' }
      sheet.getRow(row).height = 29
      addTable(sheet, `Ay${monthIndex + 1}Kategori${categoryIndex + 1}`, row + 1, MONTH_HEADERS, monthRows(categoryEvents), MONTH_WIDTHS)
      categoryEvents.forEach((event, index) => {
        const dataIndex = row + index + 2
        sheet.getCell(dataIndex, 1).numFmt = exportTimeMinutes(event.saat) === null ? DATE_FORMAT : DATE_TIME_FORMAT
        sheet.getCell(dataIndex, 2).numFmt = exportTimeMinutes(event.bitisSaat) === null ? DATE_FORMAT : DATE_TIME_FORMAT
      })
      statusColors(sheet, row + 2, row + 1 + categoryEvents.length, 'H')
      row += categoryEvents.length + 3
    })
    if (!monthEvents.length) {
      sheet.getCell('A7').value = 'Seçilen kapsamda bu ay için etkinlik bulunmuyor.'
      sheet.getCell('A7').font = { name: 'Arial', size: 10, color: { argb: COLOR.muted } }
    }
    sheet.views = [{ state: 'frozen', ySplit: 5, showGridLines: false, zoomScale: 90 }]
    sheet.pageSetup.printTitlesRow = '1:4'
    sheet.pageSetup.printArea = `A1:H${Math.max(8, row - 1)}`
  })

  setupSheet(summary, [18, 12, 15, 19, 15, 16, 12, 13, 12, 3, 32, 12], `${options.year} Etkinlik Takvimi`, scope)
  summary.getCell('A5').value = 'Toplam etkinlik'
  summary.getCell('B5').value = { formula: `COUNTA('${DETAILS}'!A7:A${Math.max(7, report.selected.length + 6)})`, result: report.selected.length }
  summary.getCell('D5').value = 'Dışa aktarma tarihi'
  summary.getCell('E5').value = workbook.created
  summary.getCell('E5').numFmt = DATE_FORMAT
  header(summary, 7, ['Ay', 'Toplam', ...EVENT_STATUS.map((status) => status.ad), 'Diğer durum', 'Taslak'])
  const last = Math.max(7, report.selected.length + 6)
  const dates = `'${DETAILS}'!$B$7:$B$${last}`
  const statuses = `'${DETAILS}'!$E$7:$E$${last}`
  const types = `'${DETAILS}'!$D$7:$D$${last}`
  const drafts = `'${DETAILS}'!$Q$7:$Q$${last}`
  report.months.forEach((monthEvents, index) => {
    const row = index + 8
    dataRow(summary, row, [CAL_MONTHS[index], ...Array.from({ length: 8 }, () => 0)], [18, 12, 15, 19, 15, 16, 12, 13, 12], index % 2 === 1)
    summary.getCell(row, 1).value = { text: CAL_MONTHS[index], hyperlink: `#'${monthSheets[index].name}'!A1` }
    const dateConditions = `${dates},">="&DATE(${options.year},${index + 1},1),${dates},"<"&DATE(${options.year},${index + 2},1)`
    summary.getCell(row, 2).value = { formula: `COUNTIFS(${dateConditions})`, result: monthEvents.length }
    EVENT_STATUS.forEach((status, statusIndex) => {
      summary.getCell(row, statusIndex + 3).value = { formula: `COUNTIFS(${dateConditions},${statuses},${String.fromCharCode(67 + statusIndex)}$7)`, result: monthEvents.filter((event) => exportStatusLabel(event) === status.ad).length }
    })
    summary.getCell(row, 8).value = { formula: `B${row}-SUM(C${row}:G${row})`, result: monthEvents.filter((event) => !EVENT_STATUS.some((status) => status.ad === exportStatusLabel(event))).length }
    summary.getCell(row, 9).value = { formula: `COUNTIFS(${dateConditions},${drafts},"Evet")`, result: monthEvents.filter((event) => event.taslak).length }
  })
  header(summary, 20, ['Toplam', '', '', '', '', '', '', '', ''])
  for (let column = 2; column <= 9; column++) {
    const letter = String.fromCharCode(64 + column)
    const result = Array.from({ length: 12 }, (_, index) => summary.getCell(index + 8, column).result as number).reduce((total, value) => total + value, 0)
    summary.getCell(20, column).value = { formula: `SUM(${letter}8:${letter}19)`, result }
  }
  const categoryHeader = summary.getRow(7)
  for (const [column, label] of [[11, 'Etkinlik türü'], [12, 'Toplam']] as const) {
    const cell = categoryHeader.getCell(column)
    cell.value = label
    cell.style = { ...categoryHeader.getCell(1).style }
  }
  report.types.forEach((type, index) => {
    const row = index + 8
    summary.getCell(row, 11).value = type
    summary.getCell(row, 12).value = { formula: `COUNTIFS(${types},K${row})`, result: report.selected.filter((event) => exportTypeLabel(event) === type).length }
    summary.getCell(row, 11).alignment = { vertical: 'middle', wrapText: true }
    summary.getRow(row).height = Math.max(summary.getRow(row).height ?? 21, type.length > 30 ? 38 : 28)
  })
  summary.getCell('A23').value = 'Çok günlü etkinlikler başlangıç ayına bir kez dahil edilir.'
  summary.getCell('A24').value = `Kapsam: ${options.includeCancelled ? 'İptaller dahil' : 'İptaller hariç'}, ${options.includeDrafts ? 'taslaklar dahil' : 'taslaklar hariç'}.`
  summary.getCell('A25').value = 'Aylık sayfalar ve Etkinlik Detayları aynı kayıtların farklı görünümleridir.'
  summary.getCell('A26').value = { text: 'Tüm etkinlik detaylarını aç', hyperlink: `#'${DETAILS}'!A1` }
  if (report.invalid.length) {
    summary.getCell('A27').value = `${report.invalid.length} kaydın tarihi geçersiz; yıllık toplama katılmadı. Tarih Kontrolü sayfasına bakın.`
    summary.getCell('A27').font = { name: 'Arial', size: 10, color: { argb: 'FFB45309' } }
    const invalid = workbook.addWorksheet('Tarih Kontrolü')
    setupSheet(invalid, [30, 45, 24, 24], 'Tarih Kontrolü', 'Yılı belirlenemeyen kayıtlar; yıllık ve aylık toplamlara dahil değildir.')
    addTable(invalid, 'TarihKontrolu', 6, ['Kayıt kimliği', 'Etkinlik', 'Kayıtlı tarih', 'Kategori'], report.invalid.map((event) => [event._id, event.ad || '(Adsız etkinlik)', event.tarih || '(Boş)', exportTypeLabel(event)]), [30, 45, 24, 24])
    invalid.views = [{ state: 'frozen', ySplit: 6, showGridLines: false }]
  }
  summary.eachRow((row) => row.eachCell((cell) => {
    if (!cell.font) cell.font = { name: 'Arial', size: 10, color: { argb: COLOR.ink } }
    if (!cell.alignment) cell.alignment = { vertical: 'middle' }
  }))
  summary.pageSetup.paperSize = 9
  summary.pageSetup.printArea = `A1:L${Math.max(27, report.types.length + 8)}`
  return workbook
}
