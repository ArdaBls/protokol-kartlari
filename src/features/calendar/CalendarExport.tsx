import { Button, Modal, toast } from '@heroui/react'
import { get, ref } from 'firebase/database'
import { Download, FileSpreadsheet } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../auth/useAuth'
import { ModalScrollBody, ModalShell, ModalTitle } from '../../components/ModalShell'
import { getDbModeState, useDbMode } from '../../lib/dbMode'
import { auth, db } from '../../lib/firebase'
import type { CalendarEventWithId } from './calendarTypes'
import { parseKey } from './calendarTypes'
import { calendarExportData, canExportCalendar } from './calendarExportData'

interface CalendarExportProps {
  events: CalendarEventWithId[]
  initialYear: number
  isLoading: boolean
  hasError: boolean
}

export function CalendarExport({ events, initialYear, isLoading, hasError }: CalendarExportProps) {
  const { state } = useAuth()
  const mode = useDbMode()
  const [isOpen, setIsOpen] = useState(false)
  const [year, setYear] = useState(initialYear)
  const [includeCancelled, setIncludeCancelled] = useState(true)
  const [includeDrafts, setIncludeDrafts] = useState(true)
  const [isExporting, setIsExporting] = useState(false)
  const [download, setDownload] = useState<{ url: string; filename: string } | null>(null)
  const exportContext = useRef({ role: state.status === 'ready' ? state.role : null, uid: state.status === 'ready' ? state.user.uid : null, isLoading, hasError })
  useEffect(() => {
    exportContext.current = { role: state.status === 'ready' ? state.role : null, uid: state.status === 'ready' ? state.user.uid : null, isLoading, hasError }
  }, [state, isLoading, hasError])
  useEffect(() => () => { if (download) URL.revokeObjectURL(download.url) }, [download])

  if (state.status !== 'ready' || !canExportCalendar(state.role)) return null

  const years = [...new Set([initialYear, ...events.flatMap((event) => { const date = parseKey(event.tarih); return date ? [date.getFullYear()] : [] })])].sort((a, b) => b - a)
  const options = { year, includeCancelled, includeDrafts, isTestMode: mode.isTestMode }
  const preview = calendarExportData(events, options)
  const unavailable = isLoading || hasError || !mode.isReady || mode.hasError

  const exportExcel = async () => {
    if (isExporting || unavailable || !canExportCalendar(exportContext.current.role ?? undefined)) return
    const uid = state.user.uid
    const exportMode = mode.isTestMode
    setIsExporting(true)
    setDownload(null)
    try {
      // Recheck the server-backed role at the action boundary, including sessions left open.
      const role = (await get(ref(db, `users/${uid}/role`))).val()
      if (!canExportCalendar(role)) throw new Error('Excel raporu yalnızca admin ve owner hesapları için kullanılabilir.')
      const { createCalendarWorkbook } = await import('./calendarExportWorkbook')
      const workbook = createCalendarWorkbook(events, options)
      const buffer = await workbook.xlsx.writeBuffer()
      const currentMode = getDbModeState()
      if (auth.currentUser?.uid !== uid || exportContext.current.uid !== uid || !canExportCalendar(exportContext.current.role ?? undefined)) throw new Error('Oturum yetkisi değişti. Rapor indirilemedi.')
      if (!currentMode.isReady || currentMode.hasError || currentMode.isTestMode !== exportMode || exportContext.current.isLoading || exportContext.current.hasError) throw new Error('Veritabanı modu değişti. Raporu yeniden hazırlayın.')
      const filename = `Protokol-Etkinlik-Takvimi-${year}${exportMode ? '-Test' : ''}.xlsx`
      const url = URL.createObjectURL(new Blob([new Uint8Array(buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
      setDownload({ url, filename })
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      document.body.appendChild(link)
      link.click()
      link.remove()
      toast.success('Excel raporu hazır. İndirme başlamazsa “Dosyayı indir”e dokunun.')
    } catch (error) {
      console.error('Takvim Excel raporu hazırlanamadı:', error)
      toast.danger(error instanceof Error ? error.message : 'Excel raporu hazırlanamadı. Yeniden deneyin.')
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <>
      <Button size="sm" variant="secondary" className="ml-auto shrink-0" isDisabled={unavailable} onPress={() => { setYear(initialYear); setDownload(null); setIsOpen(true) }} aria-label="Takvim Excel raporu">
        <FileSpreadsheet size={16} />Excel
      </Button>
      <ModalShell isOpen={isOpen} onOpenChange={(open) => { if (!isExporting) { setIsOpen(open); if (!open) setDownload(null) } }} size="md">
        <ModalTitle title="Takvim Excel raporu" description="Yıllık özet, aylık kategori bölümleri ve tüm etkinlik detayları." />
        <ModalScrollBody>
          <label className="flex flex-col gap-2 text-sm font-medium">
            Rapor yılı
            <select value={year} disabled={isExporting} onChange={(event) => { setYear(Number(event.target.value)); setDownload(null) }} className="h-11 w-full rounded-[var(--field-radius)] border border-[var(--field-border)] bg-[var(--field-background)] px-3 text-base">
              {years.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <div className="flex flex-col gap-3 text-sm">
            <label className="flex items-center gap-3"><input type="checkbox" checked={includeCancelled} disabled={isExporting} onChange={(event) => { setIncludeCancelled(event.target.checked); setDownload(null) }} className="size-4 accent-accent" />İptal edilen etkinlikleri dahil et</label>
            <label className="flex items-center gap-3"><input type="checkbox" checked={includeDrafts} disabled={isExporting} onChange={(event) => { setIncludeDrafts(event.target.checked); setDownload(null) }} className="size-4 accent-accent" />Taslak etkinlikleri dahil et</label>
          </div>
          <div className="rounded-2xl border border-separator bg-default/40 p-4 text-sm">
            <p className="font-semibold">{preview.selected.length} etkinlik · 12 aylık sayfa</p>
            <p className="mt-1 text-muted">Etkinlikler başlangıç ayına göre ayrılır; her ay içinde türüne göre gruplandırılır.</p>
            {mode.isTestMode && <p className="mt-2 text-warning">Rapor test ortamındaki kayıtları içerir.</p>}
            {preview.invalid.length > 0 && <p className="mt-2 text-warning">Tarihi eksik veya geçersiz {preview.invalid.length} kayıt, “Tarih Kontrolü” sayfasına eklenir.</p>}
          </div>
          {download && <a href={download.url} download={download.filename} className="flex items-center justify-center gap-2 rounded-[var(--field-radius)] bg-accent px-4 py-3 text-sm font-semibold text-accent-foreground"><Download size={17} />Dosyayı indir</a>}
        </ModalScrollBody>
        <Modal.Footer className="flex flex-nowrap justify-end gap-2">
          <Button variant="tertiary" isDisabled={isExporting} onPress={() => { setIsOpen(false); setDownload(null) }}>Kapat</Button>
          <Button variant="primary" isPending={isExporting} isDisabled={unavailable} onPress={exportExcel}><FileSpreadsheet size={17} />Excel hazırla</Button>
        </Modal.Footer>
      </ModalShell>
    </>
  )
}
