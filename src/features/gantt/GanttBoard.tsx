import { ChevronDown, ChevronLeft, ChevronRight, Sparkles } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { dateKey, formatShortDateKey } from '../../lib/dates'
import type { GanttProject, GanttStep } from './ganttTypes'
import {
  DEFAULT_ZOOM_INDEX, MONTHS_LONG, MONTHS_SHORT_TR, STATUSES, STEP_STATUSES, WEEKDAYS_TR, ZOOM_LEVELS,
  addDays, barColorHex, barGeometry, computeYearRange, dayDiff, isoWeekNumber, parseDateKey, projectSteps,
} from './ganttTypes'

interface GanttBoardProps {
  projects: Array<[string, GanttProject]>
  canWrite: boolean
  onEdit: (id: string, stepId?: string) => void
  onUpdateDates: (id: string, project: GanttProject, startKey: string, endKey: string, stepId: string, expectedUpdateTs: number | undefined) => Promise<boolean>
}

const NAME_COL_WIDTH = 260

interface DragState {
  id: string
  stepId: string
  bar: HTMLButtonElement
  pointerId: number
  originX: number
  delta: number
  mode: 'move' | 'start' | 'end'
  start: Date
  end: Date
  originalWidth: number
  expectedUpdateTs: number | undefined
}

interface PanState {
  pointerId: number
  startX: number
  startScrollLeft: number
}

function TimelineBar({
  itemKey, item, rangeStart, days, dayWidth, isStep, onPointerDownBar,
}: {
  itemKey: string
  item: GanttStep | GanttProject
  rangeStart: Date
  days: number
  dayWidth: number
  isStep: boolean
  onPointerDownBar: (event: React.PointerEvent<HTMLButtonElement>, itemKey: string) => void
}) {
  const geometry = barGeometry(item, rangeStart, days, dayWidth)
  if (!geometry) return null
  const status = item.durum || (isStep ? 'yapilacak' : 'fikir')
  const color = barColorHex(status, !isStep ? (item as GanttProject).renk : undefined, !isStep)
  const progress = Math.min(100, Math.max(0, Number(item.ilerleme) || 0))
  const today = dateKey(new Date())
  const finished = isStep ? ['tamamlandi', 'iptal'].includes(status) : ['yayinlandi', 'iptal'].includes(status)
  const overdue = (item.bitisTarihi ?? '') < today && !finished
  // Uzatma tutamaçları bar genişliğinin en fazla %22'sini kaplar (4-8px arası) -- kısa (tek
  // günlük) çubuklarda tutamaç alanı taşarsa ortadan tutup TAŞIMAK isteyen kullanıcı yanlışlıkla
  // UZATMAYA başlar; orta kısım her zaman en az %56 "taşıma" bölgesi olarak kalır.
  const handleWidth = Math.max(4, Math.min(8, geometry.width * 0.22))

  return (
    <button
      type="button"
      data-key={itemKey}
      onPointerDown={(event) => onPointerDownBar(event, itemKey)}
      style={{ left: geometry.left, width: geometry.width, background: `color-mix(in oklab, ${color} 18%, transparent)`, borderLeft: `3px solid ${color}` }}
      className={`group absolute top-1/2 h-7 -translate-y-1/2 touch-none overflow-visible rounded-md px-2 text-left text-xs font-medium leading-7 text-foreground ${overdue ? 'outline outline-1 outline-danger/60' : ''}`}
    >
      <span data-resize="start" style={{ width: handleWidth, left: -handleWidth / 2 }} className="absolute top-0 h-full cursor-ew-resize" />
      <span className="relative z-10 truncate">{item.ad} · {progress}%</span>
      <span data-resize="end" style={{ width: handleWidth, right: -handleWidth / 2 }} className="absolute top-0 h-full cursor-ew-resize" />
    </button>
  )
}

export function GanttBoard({ projects, canWrite, onEdit, onUpdateDates }: GanttBoardProps) {
  const [year, setYear] = useState(() => new Date().getFullYear())
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_ZOOM_INDEX)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [periodLabel, setPeriodLabel] = useState('')

  const boardRef = useRef<HTMLDivElement>(null)
  const dragStateRef = useRef<DragState | null>(null)
  const panStateRef = useRef<PanState | null>(null)
  const didInitialScroll = useRef(false)
  const scrollRaf = useRef<number | null>(null)
  // document.body'ye portallanan TEK paylaşımlı etiket -- sabit (sticky) başlıklar/sütunlar
  // position:sticky nedeniyle kendi katman (stacking context) bağlamlarını kurduğu için normal
  // z-index karşılaştırması güvenilir değildi (kullanıcı bulgusu: "tutunca tarih altta kalıyor").
  // fixed konumlu bir portal, hangi satırda olursa olsun tüm katmanların kesin üstünde kalır.
  const floatingTooltipRef = useRef<HTMLDivElement>(null)

  const dayWidth = ZOOM_LEVELS[zoomIndex]
  const { start: rangeStart, days: rangeDays } = useMemo(() => computeYearRange(year), [year])

  const toggleCollapse = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const nameColWidth = () => NAME_COL_WIDTH

  const updatePeriodLabel = useCallback(() => {
    const board = boardRef.current
    if (!board) return
    const contentCenterX = board.scrollLeft + (board.clientWidth - nameColWidth()) / 2
    const dayIndex = Math.max(0, Math.min(rangeDays - 1, Math.round(contentCenterX / dayWidth)))
    const date = addDays(rangeStart, dayIndex)
    setPeriodLabel(`${MONTHS_LONG[date.getMonth()]} ${date.getFullYear()}`)
  }, [rangeStart, rangeDays, dayWidth])

  const scrollToToday = useCallback((smooth: boolean) => {
    const board = boardRef.current
    if (!board) return
    const todayYear = new Date().getFullYear()
    if (year !== todayYear) { setYear(todayYear); return }
    const { start } = computeYearRange(todayYear)
    const offset = dayDiff(start, new Date()) * dayWidth
    board.scrollTo({ left: Math.max(0, offset - (board.clientWidth - nameColWidth()) / 2), behavior: smooth ? 'smooth' : 'auto' })
  }, [year, dayWidth])

  const scrollByDays = (amount: number) => {
    const board = boardRef.current
    if (!board) return
    const visibleCenter = board.scrollLeft + (board.clientWidth - nameColWidth()) / 2
    const visibleDayIndex = Math.max(0, Math.min(rangeDays - 1, Math.round(visibleCenter / dayWidth)))
    const targetDate = addDays(rangeStart, visibleDayIndex + amount)
    if (targetDate.getFullYear() !== year) { setYear(targetDate.getFullYear()); return }
    board.scrollBy({ left: amount * dayWidth, behavior: 'smooth' })
  }

  useEffect(() => {
    if (didInitialScroll.current) return
    didInitialScroll.current = true
    requestAnimationFrame(() => scrollToToday(false))
  }, [scrollToToday])

  useEffect(() => { updatePeriodLabel() }, [updatePeriodLabel])

  const setZoom = (nextIndex: number, clientX: number | null) => {
    const board = boardRef.current
    if (!board) return
    const clamped = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, nextIndex))
    if (clamped === zoomIndex) return
    const oldWidth = ZOOM_LEVELS[zoomIndex]
    const newWidth = ZOOM_LEVELS[clamped]
    const rect = board.getBoundingClientRect()
    const colWidth = nameColWidth()
    const pointerOffset = clientX === null ? colWidth + (rect.width - colWidth) / 2 : clientX - rect.left
    const contentX = board.scrollLeft + pointerOffset - colWidth
    const dayIndex = contentX / oldWidth
    setZoomIndex(clamped)
    requestAnimationFrame(() => { board.scrollLeft = Math.max(0, dayIndex * newWidth - pointerOffset + colWidth) })
  }

  const findItem = (id: string, stepId: string): { project: GanttProject; item: GanttStep | GanttProject } | null => {
    const project = projects.find(([pid]) => pid === id)?.[1]
    if (!project) return null
    const item = stepId ? project.adimlar?.[stepId] : project
    return item ? { project, item } : null
  }

  const isPannableTarget = (el: HTMLElement) => !el.closest('.gantt-bar, button, input, select, a')

  const beginPan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !isPannableTarget(event.target as HTMLElement)) return
    const board = boardRef.current
    if (!board) return
    panStateRef.current = { pointerId: event.pointerId, startX: event.clientX, startScrollLeft: board.scrollLeft }
    board.setPointerCapture(event.pointerId)
    board.classList.add('cursor-grabbing')
  }
  const movePan = (event: React.PointerEvent<HTMLDivElement>) => {
    const pan = panStateRef.current
    const board = boardRef.current
    if (!pan || !board || event.pointerId !== pan.pointerId) return
    board.scrollLeft = pan.startScrollLeft - (event.clientX - pan.startX)
  }
  const endPan = (event: React.PointerEvent<HTMLDivElement>) => {
    const pan = panStateRef.current
    if (!pan || event.pointerId !== pan.pointerId) return
    panStateRef.current = null
    boardRef.current?.classList.remove('cursor-grabbing')
  }

  /** Sürüklenen çubuğun o anki delta'sına göre hedef tarih aralığını hesaplar (canlı önizleme + son kayıt aynı hesabı paylaşır). */
  const dragTargetDates = (drag: DragState): { start: Date; end: Date } => {
    let start = drag.start
    let end = drag.end
    if (drag.mode === 'move') { start = addDays(start, drag.delta); end = addDays(end, drag.delta) }
    if (drag.mode === 'start') start = addDays(start, Math.min(dayDiff(start, end), drag.delta))
    if (drag.mode === 'end') end = addDays(end, Math.max(-dayDiff(start, end), drag.delta))
    return { start, end }
  }

  /** Sürüklenen çubuğun tam üstünde, ekran koordinatlarında (fixed) konumlanan ortak etiketi günceller. */
  const showTooltip = (bar: HTMLButtonElement, start: Date, end: Date) => {
    const tooltip = floatingTooltipRef.current
    if (!tooltip) return
    const rect = bar.getBoundingClientRect()
    tooltip.textContent = `${formatShortDateKey(dateKey(start))} → ${formatShortDateKey(dateKey(end))}`
    tooltip.style.left = `${rect.left}px`
    tooltip.style.top = `${rect.top - 8}px`
    tooltip.style.transform = 'translateY(-100%)'
    tooltip.classList.remove('hidden')
  }

  const hideTooltip = () => floatingTooltipRef.current?.classList.add('hidden')

  const onPointerDownBar = (event: React.PointerEvent<HTMLButtonElement>, itemKey: string) => {
    if (event.button !== 0) return
    const [id, stepId] = itemKey.split('::')
    if (!canWrite) { onEdit(id, stepId); return }
    const found = findItem(id, stepId)
    if (!found) return
    const start = parseDateKey(found.item.baslangicTarihi)
    const end = parseDateKey(found.item.bitisTarihi)
    if (!start || !end) return
    const bar = event.currentTarget
    const handle = (event.target as HTMLElement).closest('[data-resize]') as HTMLElement | null
    dragStateRef.current = {
      id, stepId, bar, pointerId: event.pointerId, originX: event.clientX, delta: 0,
      mode: (handle?.dataset.resize as DragState['mode']) || 'move',
      start, end, originalWidth: bar.offsetWidth, expectedUpdateTs: found.project.guncellemeTs,
    }
    bar.setPointerCapture(event.pointerId)
    bar.classList.add('opacity-70', 'z-10')
    showTooltip(bar, start, end)
    event.preventDefault()
  }

  const onPointerMoveBoard = (event: React.PointerEvent<HTMLDivElement>) => {
    movePan(event)
    const drag = dragStateRef.current
    if (!drag || event.pointerId !== drag.pointerId) return
    drag.delta = Math.round((event.clientX - drag.originX) / dayWidth)
    if (drag.mode === 'move') drag.bar.style.transform = `translateX(${drag.delta * dayWidth}px)`
    if (drag.mode === 'start') {
      const maxDelta = dayDiff(drag.start, drag.end)
      const delta = Math.min(maxDelta, drag.delta)
      drag.bar.style.transform = `translateX(${delta * dayWidth}px)`
      drag.bar.style.width = `${Math.max(dayWidth, drag.originalWidth - delta * dayWidth)}px`
    }
    if (drag.mode === 'end') {
      const minDelta = -dayDiff(drag.start, drag.end)
      const delta = Math.max(minDelta, drag.delta)
      drag.bar.style.width = `${Math.max(dayWidth, drag.originalWidth + delta * dayWidth)}px`
    }
    const { start, end } = dragTargetDates(drag)
    showTooltip(drag.bar, start, end)
  }

  const onPointerUpBoard = (event: React.PointerEvent<HTMLDivElement>) => {
    endPan(event)
    const drag = dragStateRef.current
    if (!drag || event.pointerId !== drag.pointerId) return
    dragStateRef.current = null
    drag.bar.classList.remove('opacity-70', 'z-10')
    // transform React'in style prop'unda hiç yönetilmiyor, sıfırlamak güvenli. width/left ise
    // JSX style={{...}} ile React tarafından yönetiliyor -- bunları '' yaparsak React'in kendi
    // "son yazdığım değer" kaydı bozulur: yeni tarihler AYNI süreye denk gelirse (ör. sadece
    // taşıma) React "değer değişmedi" sanıp DOM'u hiç düzeltmez ve buton, açık genişlik kalmadığı
    // için içeriğine (başlığın metni kadar) küçülür. Bunun yerine hedef geometriyi burada NET
    // piksel değerleriyle yazıyoruz; Firebase'in canlı yankısı geldiğinde React zaten aynı
    // değerleri üretir, görünürde bir sıçrama olmaz.
    drag.bar.style.transform = ''
    hideTooltip()
    if (!drag.delta) {
      drag.bar.style.width = `${drag.originalWidth}px`
      onEdit(drag.id, drag.stepId)
      return
    }
    const { start, end } = dragTargetDates(drag)
    const committedGeometry = barGeometry({ baslangicTarihi: dateKey(start), bitisTarihi: dateKey(end) }, rangeStart, rangeDays, dayWidth)
    if (committedGeometry) {
      drag.bar.style.left = `${committedGeometry.left}px`
      drag.bar.style.width = `${committedGeometry.width}px`
    }
    const found = findItem(drag.id, drag.stepId)
    if (found) void onUpdateDates(drag.id, found.project, dateKey(start), dateKey(end), drag.stepId, drag.expectedUpdateTs)
  }

  useEffect(() => {
    const board = boardRef.current
    if (!board) return
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      setZoom(zoomIndex + (event.deltaY < 0 ? 1 : -1), event.clientX)
    }
    const onScroll = () => {
      if (scrollRaf.current) return
      scrollRaf.current = requestAnimationFrame(() => { scrollRaf.current = null; updatePeriodLabel() })
    }
    board.addEventListener('wheel', onWheel, { passive: false })
    board.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      board.removeEventListener('wheel', onWheel)
      board.removeEventListener('scroll', onScroll)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomIndex, updatePeriodLabel])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (event.key === '+' || event.key === '=') { event.preventDefault(); setZoom(zoomIndex + 1, null) }
      else if (event.key === '-' || event.key === '_') { event.preventDefault(); setZoom(zoomIndex - 1, null) }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomIndex])

  const weekCells = useMemo(() => {
    const cells: { key: number; label: string }[] = []
    for (let index = 0; index < rangeDays; index += 7) {
      const weekStart = addDays(rangeStart, index)
      const weekEnd = addDays(rangeStart, index + 6)
      const sameMonth = weekStart.getMonth() === weekEnd.getMonth()
      const label = sameMonth
        ? `Hf ${isoWeekNumber(weekStart)} · ${weekStart.getDate()}-${weekEnd.getDate()} ${MONTHS_SHORT_TR[weekStart.getMonth()]}`
        : `Hf ${isoWeekNumber(weekStart)} · ${weekStart.getDate()} ${MONTHS_SHORT_TR[weekStart.getMonth()]} - ${weekEnd.getDate()} ${MONTHS_SHORT_TR[weekEnd.getMonth()]}`
      cells.push({ key: index, label })
    }
    return cells
  }, [rangeStart, rangeDays])

  const dayCells = useMemo(() => {
    const today = dateKey(new Date())
    return Array.from({ length: rangeDays }, (_, index) => {
      const date = addDays(rangeStart, index)
      const key = dateKey(date)
      return { index, day: date.getDate(), weekday: WEEKDAYS_TR[(date.getDay() + 6) % 7], isWeekend: date.getDay() === 0 || date.getDay() === 6, isToday: key === today, isFirstOfMonth: date.getDate() === 1, monthShort: MONTHS_SHORT_TR[date.getMonth()] }
    })
  }, [rangeStart, rangeDays])

  const gridWidth = rangeDays * dayWidth
  const todayYear = new Date().getFullYear()
  const todayLineLeft = todayYear === year ? NAME_COL_WIDTH + dayDiff(rangeStart, new Date()) * dayWidth + dayWidth / 2 : null

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1">
        <button type="button" onClick={() => scrollByDays(-28)} aria-label="Önceki dönem" className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-default hover:text-foreground">
          <ChevronLeft size={16} />
        </button>
        <button type="button" onClick={() => scrollToToday(true)} className="rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-default hover:text-foreground">Bugün</button>
        <button type="button" onClick={() => scrollByDays(28)} aria-label="Sonraki dönem" className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-default hover:text-foreground">
          <ChevronRight size={16} />
        </button>
        <strong className="ml-1 text-sm">{periodLabel}</strong>
        <span className="ml-auto text-xs text-muted">Ctrl+tekerlek veya +/− ile yakınlaştırın · boş alanı sürükleyerek kaydırın</span>
      </div>

      <div
        ref={boardRef}
        onPointerMove={onPointerMoveBoard}
        onPointerUp={onPointerUpBoard}
        onPointerCancel={onPointerUpBoard}
        onPointerDown={beginPan}
        className="relative max-h-[65vh] cursor-grab overflow-auto rounded-2xl border border-separator select-none"
      >
        <div className="relative" style={{ width: gridWidth + NAME_COL_WIDTH }}>
          {/* Bugün çizgisi: gün başlığındaki soluk vurgu tek başına takvimde "bugün"ü bulmayı zorlaştırıyordu
              (kullanıcı bulgusu) -- tüm satırların üzerinden geçen ince, sabit bir dikey çizgi eklendi. */}
          {todayLineLeft !== null && (
            // z-10: sabit (sticky) başlıklar z-20 olduğu için çizginin üst ucu onların ALTINDA kalır,
            // tam yükseklik hesaplamaya gerek kalmaz -- başlıklar kendiliğinden üstünü örter.
            <div className="pointer-events-none absolute top-0 bottom-0 z-10 w-px bg-danger/70" style={{ left: todayLineLeft }} />
          )}
          <div className="sticky top-0 z-20 flex bg-surface">
            <div style={{ width: NAME_COL_WIDTH }} className="sticky left-0 z-10 shrink-0 border-b border-r border-separator bg-surface" />
            <div className="relative flex" style={{ width: gridWidth }}>
              {weekCells.map((cell) => (
                <div key={cell.key} style={{ width: 7 * dayWidth }} className="shrink-0 truncate border-b border-r border-separator px-2 py-1 text-[11px] text-muted">{cell.label}</div>
              ))}
            </div>
          </div>
          <div className="sticky top-[26px] z-20 flex bg-surface">
            <div style={{ width: NAME_COL_WIDTH }} className="sticky left-0 z-10 shrink-0 border-b border-r border-separator bg-surface px-3 py-1.5 text-xs font-semibold text-muted">Proje</div>
            <div className="flex" style={{ width: gridWidth }}>
              {dayCells.map((cell) => (
                <div key={cell.index} style={{ width: dayWidth }} className={`flex shrink-0 flex-col items-center border-b border-r border-separator py-1 text-[10px] ${cell.isWeekend ? 'bg-default/40' : ''} ${cell.isToday ? 'bg-accent-soft' : ''}`}>
                  <span className="text-muted">{cell.weekday}</span>
                  <strong>{cell.day}</strong>
                  {cell.isFirstOfMonth && <span className="text-[9px] text-accent">{cell.monthShort}</span>}
                </div>
              ))}
            </div>
          </div>

          {projects.length === 0 && (
            <p className="px-4 py-10 text-center text-sm text-muted">Bu görünümde proje yok. Yeni proje ekleyin veya filtreleri temizleyin.</p>
          )}

          {projects.map(([id, project]) => {
            const steps = projectSteps(project)
            const isExpanded = !collapsed.has(id)
            return (
              <div key={id}>
                <div className="flex items-center border-b border-separator">
                  <div style={{ width: NAME_COL_WIDTH }} className="sticky left-0 z-10 flex shrink-0 items-center gap-1 bg-surface px-2 py-1.5">
                    {steps.length ? (
                      <button type="button" onClick={() => toggleCollapse(id)} aria-expanded={isExpanded} aria-label={`${project.ad} adımlarını ${isExpanded ? 'daralt' : 'genişlet'}`} className="flex size-5 shrink-0 items-center justify-center text-muted">
                        <ChevronDown size={14} className={`transition-transform ${isExpanded ? '' : '-rotate-90'}`} />
                      </button>
                    ) : (
                      <span className="size-5 shrink-0" />
                    )}
                    <button type="button" onClick={() => onEdit(id)} className="flex min-w-0 flex-1 flex-col items-start rounded-md px-1 py-0.5 text-left hover:bg-default">
                      <span className="flex items-center gap-1 truncate text-sm font-medium">
                        {project.tur === 'ozel' && <Sparkles size={12} className="shrink-0 text-accent" />}
                        <span className="truncate">{project.ad || 'Adsız proje'}</span>
                      </span>
                      <span className="truncate text-[11px] text-muted">{STATUSES[project.durum ?? 'fikir'] ?? 'Fikir'}{project.sorumlu ? ` · ${project.sorumlu}` : ''}</span>
                    </button>
                  </div>
                  <div className="relative h-10 shrink-0" style={{ width: gridWidth }}>
                    <TimelineBar
                      itemKey={`${id}::`} item={project} rangeStart={rangeStart} days={rangeDays} dayWidth={dayWidth} isStep={false}
                      onPointerDownBar={onPointerDownBar}
                    />
                  </div>
                </div>

                {isExpanded && steps.map(([stepId, step]) => (
                  <div key={stepId} className="flex items-center border-b border-separator">
                    <div style={{ width: NAME_COL_WIDTH }} className="sticky left-0 z-10 flex shrink-0 items-center bg-surface py-1.5 pl-8 pr-2">
                      <button type="button" onClick={() => onEdit(id, stepId)} className="flex min-w-0 flex-1 flex-col items-start rounded-md px-1 py-0.5 text-left hover:bg-default">
                        <span className="truncate text-xs font-medium">{step.ad || 'Adsız adım'}</span>
                        <span className="truncate text-[11px] text-muted">{STEP_STATUSES[step.durum ?? 'yapilacak']}{step.sorumlu ? ` · ${step.sorumlu}` : ''}</span>
                      </button>
                    </div>
                    <div className="relative h-8 shrink-0" style={{ width: gridWidth }}>
                      <TimelineBar
                        itemKey={`${id}::${stepId}`} item={step} rangeStart={rangeStart} days={rangeDays} dayWidth={dayWidth} isStep
                        onPointerDownBar={onPointerDownBar}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      </div>

      {createPortal(
        <div
          ref={floatingTooltipRef}
          className="pointer-events-none fixed z-[999] hidden whitespace-nowrap rounded-lg bg-overlay px-2 py-1 text-[11px] font-semibold text-overlay-foreground shadow-[var(--overlay-shadow)]"
        />,
        document.body,
      )}
    </div>
  )
}
