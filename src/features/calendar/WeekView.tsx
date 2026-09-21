import { Lock } from 'lucide-react'
import { Tooltip, toast } from '@heroui/react'
import { useMemo, useRef, useState } from 'react'
import { dateKey } from '../../lib/dates'
import type { CalendarEventWithId, MultiDayBar } from './calendarTypes'
import { CAL_DOW, evType, fmtTrDate, isSameDay, layoutDay, layoutMultiDayRow, minToHm, parseKey, todayDate } from './calendarTypes'
import { EventTooltipContent } from './EventTooltipContent'
import { useCalendarWriter } from './useCalendarWriter'

const HOUR_H = 48
const GUTTER = 54
const MOVE_THRESHOLD = 4
const CREATE_SNAP = 15
const RESIZE_SNAP = 5
const MOVE_SNAP = 15

interface WeekViewProps {
  days: Date[]
  eventsByDate: Map<string, CalendarEventWithId[]>
  allEvents: CalendarEventWithId[]
  canWrite: boolean
  onEdit: (id: string) => void
  onCreate: (dateKey: string, time?: string, endTime?: string) => void
}

type MovePreview = { id: string; ev: CalendarEventWithId; dayIdx: number; startMin: number; durationMin: number }
type ResizePreview = { id: string; ev: CalendarEventWithId; edge: 'start' | 'end'; min: number; otherMin: number }
type CreatePreview = { dayIdx: number; startMin: number; endMin: number }
type BarPreview = { id: string; ev: CalendarEventWithId; startIdx: number; endIdx: number }

function snapTo(value: number, step: number): number {
  return Math.round(value / step) * step
}

const clampMin = (min: number) => Math.max(0, Math.min(23 * 60 + 45, min))

export function WeekView({ days, eventsByDate, allEvents, canWrite, onEdit, onCreate }: WeekViewProps) {
  const writer = useCalendarWriter()
  const today = todayDate()
  const viewFrom = dateKey(days[0])
  const viewTo = dateKey(days[days.length - 1])

  const gridRef = useRef<HTMLDivElement>(null)
  const barRowRef = useRef<HTMLDivElement>(null)
  const didDragRef = useRef(false)

  const [movePreview, setMovePreview] = useState<MovePreview | null>(null)
  const [resizePreview, setResizePreview] = useState<ResizePreview | null>(null)
  const [createPreview, setCreatePreview] = useState<CreatePreview | null>(null)
  const [barPreview, setBarPreview] = useState<BarPreview | null>(null)
  // Sürükleme/boyutlandırma/oluşturma sırasında açık hover tooltip'i imleç etkinliğin üzerinde
  // kalsa bile GİZLENMELİ -- kullanıcı hangi saate taşıdığını görmeli, tooltip'in altında kalmamalı.
  const isDragActive = !!movePreview || !!resizePreview || !!createPreview || !!barPreview
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  const multiDayBars = useMemo(() => {
    const bars: MultiDayBar[] = allEvents
      .filter((ev) => ev.bitisTarihi && ev.bitisTarihi !== ev.tarih && (ev.tarih ?? '') <= viewTo && (ev.bitisTarihi ?? '') >= viewFrom)
      .map((ev) => {
        const s = parseKey(ev.tarih)
        const e = parseKey(ev.bitisTarihi ?? undefined)
        if (!s || !e) return null
        const rawStart = Math.round((s.getTime() - days[0].getTime()) / 86400000)
        const rawEnd = Math.round((e.getTime() - days[0].getTime()) / 86400000)
        return {
          ev, startIdx: Math.max(0, rawStart), endIdx: Math.min(days.length - 1, rawEnd),
          continuesLeft: (ev.tarih ?? '') < viewFrom, continuesRight: (ev.bitisTarihi ?? '') > viewTo, row: 0,
        }
      })
      .filter((x): x is MultiDayBar => x !== null)
    const rowCount = layoutMultiDayRow(bars)
    return { bars, rowCount }
  }, [allEvents, viewFrom, viewTo, days])

  const dayColumns = useMemo(
    () => days.map((day) => ({ day, key: dateKey(day), items: layoutDay((eventsByDate.get(dateKey(day)) ?? []).filter((ev) => hasTime(ev))) })),
    [days, eventsByDate],
  )

  const handleGridClick = (event: React.MouseEvent<HTMLDivElement>, dayIdx: number) => {
    if (didDragRef.current) { didDragRef.current = false; return }
    if (!canWrite || (event.target as HTMLElement).closest('button')) return
    // Web ve mobilde tek tıklama doğrudan modal açmamalı. Önce seçilen saati
    // 1 saatlik geçici alan olarak göster; kullanıcı onaylarsa formu aç.
    if (createPreview) return
    const rect = event.currentTarget.getBoundingClientRect()
    const y = event.clientY - rect.top
    let mins = Math.round(((y / HOUR_H) * 60) / 30) * 30
    mins = Math.max(0, Math.min(23 * 60, mins))
    setCreatePreview({ dayIdx, startMin: mins, endMin: Math.min(24 * 60, mins + 60) })
  }

  // --- Boş ızgarada sürükleyerek yeni etkinlik oluşturma ---
  const beginGridCreate = (event: React.PointerEvent<HTMLDivElement>, dayIdx: number) => {
    if (!canWrite || createPreview || (event.target as HTMLElement).closest('button')) return
    const column = event.currentTarget
    const startClientY = event.clientY
    const startRect = column.getBoundingClientRect()
    const startMin = snapTo(clampMin(((startClientY - startRect.top) / HOUR_H) * 60), CREATE_SNAP)
    let dragging = false
    let longPressTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      // Basılı tutma kopyalama/metin seçimi olarak yorumlanmasın; bu jest doğrudan
      // 1 saatlik yeni etkinlik ghost'u başlatır.
      dragging = true
      didDragRef.current = true
      const longPressStart = snapTo(startMin, 30)
      setCreatePreview({ dayIdx, startMin: longPressStart, endMin: Math.min(24 * 60, longPressStart + 60) })
      longPressTimer = null
    }, 350)

    const clearLongPress = () => {
      if (longPressTimer !== null) {
        clearTimeout(longPressTimer)
        longPressTimer = null
      }
    }

    column.setPointerCapture(event.pointerId)

    const onMove = (moveEvent: PointerEvent) => {
      const dy = moveEvent.clientY - startClientY
      if (!dragging && Math.abs(dy) < MOVE_THRESHOLD) return
      clearLongPress()
      dragging = true
      didDragRef.current = true
      const rect = column.getBoundingClientRect()
      const currentMin = snapTo(clampMin(((moveEvent.clientY - rect.top) / HOUR_H) * 60), CREATE_SNAP)
      const start = Math.min(startMin, currentMin)
      const end = Math.max(startMin, currentMin, start + CREATE_SNAP)
      setCreatePreview({ dayIdx, startMin: start, endMin: Math.min(24 * 60, end) })
    }
    const onUp = () => {
      clearLongPress()
      column.removeEventListener('pointermove', onMove)
      column.removeEventListener('pointerup', onUp)
      column.removeEventListener('pointercancel', onCancel)
      if (dragging) {
        setCreatePreview((current) => {
          if (!current) return null
          // Sürükleyerek oluşturma da tıklama ile aynı güvenli onay adımından geçer.
          return current
        })
      }
    }
    const onCancel = () => {
      clearLongPress()
      column.removeEventListener('pointermove', onMove)
      column.removeEventListener('pointerup', onUp)
      column.removeEventListener('pointercancel', onCancel)
    }
    column.addEventListener('pointermove', onMove)
    column.addEventListener('pointerup', onUp)
    column.addEventListener('pointercancel', onCancel)
  }

  // --- Etkinliği sürükleyerek taşıma (gün/saat değiştirme) ---
  const beginMove = (event: React.PointerEvent<HTMLElement>, ev: CalendarEventWithId, startMinOfItem: number, durationMin: number) => {
    if (ev.locked) return
    event.stopPropagation()
    const target = event.currentTarget
    const startClientX = event.clientX
    const startClientY = event.clientY
    const origDayIdx = days.findIndex((d) => dateKey(d) === ev.tarih)
    const gridEl = gridRef.current
    let dragging = false
    target.setPointerCapture(event.pointerId)

    const onMove = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - startClientX
      const dy = moveEvent.clientY - startClientY
      if (!dragging && Math.abs(dx) < MOVE_THRESHOLD && Math.abs(dy) < MOVE_THRESHOLD) return
      dragging = true
      didDragRef.current = true
      const colWidth = gridEl ? gridEl.getBoundingClientRect().width / days.length : 0
      const dayDelta = colWidth ? Math.round(dx / colWidth) : 0
      const newDayIdx = Math.max(0, Math.min(days.length - 1, origDayIdx + dayDelta))
      const minDelta = Math.round((dy / HOUR_H) * 60)
      const newStartMin = snapTo(clampMin(startMinOfItem + minDelta), MOVE_SNAP)
      setMovePreview({ id: ev._id, ev, dayIdx: newDayIdx, startMin: newStartMin, durationMin })
    }
    const onUp = () => {
      target.removeEventListener('pointermove', onMove)
      target.removeEventListener('pointerup', onUp)
      if (dragging) {
        setMovePreview((current) => {
          if (current) void writer.moveEvent(ev._id, ev, dateKey(days[current.dayIdx]), current.startMin)
          return null
        })
      }
    }
    target.addEventListener('pointermove', onMove)
    target.addEventListener('pointerup', onUp)
  }

  // --- Üst/alt kenar tutamağından sürükleyerek saat ayarlama ---
  const beginResize = (event: React.PointerEvent<HTMLElement>, ev: CalendarEventWithId, edge: 'start' | 'end', startMinOfItem: number, endMinOfItem: number) => {
    if (ev.locked) return
    event.stopPropagation()
    const target = event.currentTarget
    const columnEl = target.closest('[data-cal-column]') as HTMLElement | null
    const startClientY = event.clientY
    let dragging = false
    target.setPointerCapture(event.pointerId)

    const onMove = (moveEvent: PointerEvent) => {
      const dy = moveEvent.clientY - startClientY
      if (!dragging && Math.abs(dy) < MOVE_THRESHOLD) return
      dragging = true
      didDragRef.current = true
      const minDelta = Math.round((dy / HOUR_H) * 60)
      if (edge === 'start') {
        const newMin = snapTo(clampMin(Math.min(startMinOfItem + minDelta, endMinOfItem - RESIZE_SNAP)), RESIZE_SNAP)
        setResizePreview({ id: ev._id, ev, edge, min: newMin, otherMin: endMinOfItem })
      } else {
        const newMin = snapTo(Math.max(startMinOfItem + RESIZE_SNAP, Math.min(24 * 60, endMinOfItem + minDelta)), RESIZE_SNAP)
        setResizePreview({ id: ev._id, ev, edge, min: newMin, otherMin: startMinOfItem })
      }
    }
    const onUp = () => {
      target.removeEventListener('pointermove', onMove)
      target.removeEventListener('pointerup', onUp)
      void columnEl
      if (dragging) {
        setResizePreview((current) => {
          if (current) void writer.resizeEvent(ev._id, ev, current.edge, current.min)
          return null
        })
      }
    }
    target.addEventListener('pointermove', onMove)
    target.addEventListener('pointerup', onUp)
  }

  // --- Çok günlü etkinlik şeridini sürükleme (gövde) / kenarından uzatma ---
  const beginBarDrag = (event: React.PointerEvent<HTMLElement>, bar: MultiDayBar, mode: 'move' | 'resize-start' | 'resize-end') => {
    if (bar.ev.locked) return
    event.stopPropagation()
    const target = event.currentTarget
    const rowEl = barRowRef.current
    const startClientX = event.clientX
    let dragging = false
    target.setPointerCapture(event.pointerId)

    const onMove = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - startClientX
      if (!dragging && Math.abs(dx) < MOVE_THRESHOLD) return
      dragging = true
      didDragRef.current = true
      const colWidth = rowEl ? rowEl.getBoundingClientRect().width / days.length : 0
      const dayDelta = colWidth ? Math.round(dx / colWidth) : 0
      if (mode === 'move') {
        const span = bar.endIdx - bar.startIdx
        const newStart = Math.max(0, Math.min(days.length - 1 - span, bar.startIdx + dayDelta))
        setBarPreview({ id: bar.ev._id, ev: bar.ev, startIdx: newStart, endIdx: newStart + span })
      } else if (mode === 'resize-start') {
        const newStart = Math.max(0, Math.min(bar.endIdx, bar.startIdx + dayDelta))
        setBarPreview({ id: bar.ev._id, ev: bar.ev, startIdx: newStart, endIdx: bar.endIdx })
      } else {
        const newEnd = Math.max(bar.startIdx, Math.min(days.length - 1, bar.endIdx + dayDelta))
        setBarPreview({ id: bar.ev._id, ev: bar.ev, startIdx: bar.startIdx, endIdx: newEnd })
      }
    }
    const onUp = () => {
      target.removeEventListener('pointermove', onMove)
      target.removeEventListener('pointerup', onUp)
      if (dragging) {
        setBarPreview((current) => {
          if (current) void writer.moveMultiDayEvent(bar.ev._id, bar.ev, dateKey(days[current.startIdx]), dateKey(days[current.endIdx]))
          return null
        })
      }
    }
    target.addEventListener('pointermove', onMove)
    target.addEventListener('pointerup', onUp)
  }

  const handleLockedClick = (name?: string) => toast.warning(`"${name || 'Bu etkinlik'}" kilitli. Taşımak/yeniden boyutlandırmak için önce kilidi açın.`)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="sticky top-0 z-10 flex shrink-0 bg-surface" style={{ paddingLeft: GUTTER }}>
        {days.map((day) => {
          const weekday = (day.getDay() + 6) % 7
          return (
            <div key={dateKey(day)} className={`flex flex-1 flex-col items-center border-b border-l border-separator py-1.5 ${isSameDay(day, today) ? 'bg-accent-soft' : ''} ${weekday >= 5 ? 'bg-default/10' : ''}`}>
              <span className="text-xs text-muted">{CAL_DOW[weekday]}</span>
              <span className={`text-sm font-semibold ${isSameDay(day, today) ? 'text-accent' : ''}`}>{day.getDate()}</span>
            </div>
          )
        })}
      </div>

      {multiDayBars.bars.length > 0 && (
        <div className="flex shrink-0 border-b border-separator" style={{ paddingLeft: GUTTER }}>
          <div ref={barRowRef} className="relative flex-1" style={{ height: multiDayBars.rowCount * 26 + 4 }}>
            <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${days.length}, 1fr)` }}>
              {days.map((day) => <div key={dateKey(day)} className="border-l border-separator" />)}
            </div>
            {multiDayBars.bars.map((bar) => {
              const ty = evType(bar.ev.tur)
              const isDraggingBar = barPreview?.id === bar.ev._id
              const widthPct = ((bar.endIdx - bar.startIdx + 1) / days.length) * 100
              const leftPct = (bar.startIdx / days.length) * 100
              return (
                <Tooltip.Root
                  key={bar.ev._id}
                  delay={0}
                  closeDelay={0}
                  isOpen={hoveredId === bar.ev._id && !isDragActive}
                  onOpenChange={(open) => setHoveredId(open ? bar.ev._id : null)}
                >
                  <Tooltip.Trigger style={{ position: 'absolute', left: `${leftPct}%`, width: `${widthPct}%`, top: bar.row * 26 + 2, height: 24 }}>
                    <button
                      type="button"
                      onClick={() => { if (didDragRef.current) { didDragRef.current = false; return } onEdit(bar.ev._id) }}
                      onPointerDown={(pe) => (bar.ev.locked ? handleLockedClick(bar.ev.ad) : beginBarDrag(pe, bar, 'move'))}
                      style={{ background: `${ty.renk}d9`, cursor: bar.ev.locked ? 'not-allowed' : 'grab' }}
                      className={`relative flex size-full items-center truncate rounded-md px-2 text-left text-[11px] leading-6 text-white ${isDraggingBar ? 'opacity-40' : ''}`}
                    >
                      {!bar.ev.locked && (
                        <span onPointerDown={(pe) => beginBarDrag(pe, bar, 'resize-start')} className="absolute inset-y-0 left-0 w-2 cursor-ew-resize" />
                      )}
                      {bar.ev.locked && <Lock size={9} className="mr-1 shrink-0" />}
                      <span className="truncate">{bar.ev.ad}</span>
                      {!bar.ev.locked && (
                        <span onPointerDown={(pe) => beginBarDrag(pe, bar, 'resize-end')} className="absolute inset-y-0 right-0 w-2 cursor-ew-resize" />
                      )}
                    </button>
                  </Tooltip.Trigger>
                  <Tooltip.Content showArrow>
                    <EventTooltipContent ev={bar.ev} timeLabel={`${bar.ev.tarih} → ${bar.ev.bitisTarihi}`} />
                  </Tooltip.Content>
                </Tooltip.Root>
              )
            })}
            {barPreview && (
              <div
                style={{ left: `${(barPreview.startIdx / days.length) * 100}%`, width: `${((barPreview.endIdx - barPreview.startIdx + 1) / days.length) * 100}%`, top: (multiDayBars.bars.find((b) => b.ev._id === barPreview.id)?.row ?? 0) * 26 + 2 }}
                className="pointer-events-none absolute z-10 flex h-6 items-center truncate rounded-md border-2 border-dashed border-accent bg-accent-soft/70 px-2 text-left text-[11px] font-medium leading-6 text-accent"
              >
                {barPreview.ev.ad}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="relative flex min-h-0 flex-1 overflow-y-auto">
        <div className="sticky left-0 z-[1] shrink-0 bg-surface" style={{ width: GUTTER }}>
          {Array.from({ length: 24 }, (_, hour) => (
            <div key={hour} style={{ height: HOUR_H }} className="border-b border-separator pr-1.5 text-right text-[10px] text-muted">
              {hour > 0 && `${String(hour).padStart(2, '0')}:00`}
            </div>
          ))}
        </div>
        <div ref={gridRef} className="flex flex-1">
          {dayColumns.map(({ key, items }, dayIdx) => (
            <div
              key={key}
              data-cal-column
              onClick={(event) => handleGridClick(event, dayIdx)}
              onPointerDown={(event) => beginGridCreate(event, dayIdx)}
              className="relative flex-1 cursor-pointer select-none border-l border-separator"
            >
              {Array.from({ length: 24 }, (_, hour) => (
                <div key={hour} style={{ height: HOUR_H }} className="border-b border-separator" />
              ))}
              {createPreview && createPreview.dayIdx === dayIdx && (
                <div
                  style={{ top: (createPreview.startMin / 60) * HOUR_H, height: Math.max(18, ((createPreview.endMin - createPreview.startMin) / 60) * HOUR_H) }}
                  className="pointer-events-none absolute inset-x-0.5 z-10 rounded-md border-2 border-dashed border-accent bg-accent-soft/70 px-1.5 py-0.5 text-[11px] font-medium text-accent"
                >
                  {minToHm(createPreview.startMin)}–{minToHm(createPreview.endMin)}
                </div>
              )}
              {movePreview && movePreview.dayIdx === dayIdx && (
                <div
                  style={{ top: (movePreview.startMin / 60) * HOUR_H, height: Math.max(18, (movePreview.durationMin / 60) * HOUR_H) }}
                  className="pointer-events-none absolute inset-x-0.5 z-10 overflow-hidden rounded-md border-2 border-dashed border-accent bg-accent-soft/70 px-1.5 py-0.5 text-[11px] font-medium text-accent"
                >
                  <span className="block truncate">{minToHm(movePreview.startMin)}–{minToHm(movePreview.startMin + movePreview.durationMin)} · {movePreview.ev.ad || '(adsız)'}</span>
                </div>
              )}
              {resizePreview && resizePreview.ev.tarih === key && (
                <div
                  style={{
                    top: (Math.min(resizePreview.edge === 'start' ? resizePreview.min : resizePreview.otherMin, resizePreview.edge === 'end' ? resizePreview.min : resizePreview.otherMin) / 60) * HOUR_H,
                    height: Math.max(18, (Math.abs(resizePreview.min - resizePreview.otherMin) / 60) * HOUR_H),
                  }}
                  className="pointer-events-none absolute inset-x-0.5 z-10 overflow-hidden rounded-md border-2 border-dashed border-accent bg-accent-soft/70 px-1.5 py-0.5 text-[11px] font-medium text-accent"
                >
                  <span className="block truncate">{minToHm(resizePreview.edge === 'start' ? resizePreview.min : resizePreview.otherMin)}–{minToHm(resizePreview.edge === 'end' ? resizePreview.min : resizePreview.otherMin)} · {resizePreview.ev.ad || '(adsız)'}</span>
                </div>
              )}
              {items.map((item) => {
                const ty = evType(item.ev.tur)
                const isMoving = movePreview?.id === item.ev._id
                const isResizing = resizePreview?.id === item.ev._id
                const top = (item.s / 60) * HOUR_H
                const height = Math.max(18, ((item.e - item.s) / 60) * HOUR_H)
                const widthPct = 100 / item.total
                return (
                  <Tooltip.Root
                    key={item.ev._id}
                    delay={0}
                    closeDelay={0}
                    isOpen={hoveredId === item.ev._id && !isDragActive}
                    onOpenChange={(open) => setHoveredId(open ? item.ev._id : null)}
                  >
                    <Tooltip.Trigger style={{ position: 'absolute', top, height, left: `${item.col * widthPct}%`, width: `${widthPct}%` }}>
                      <button
                        type="button"
                        onClick={(event) => { event.stopPropagation(); if (didDragRef.current) { didDragRef.current = false; return } onEdit(item.ev._id) }}
                        onPointerDown={(pe) => { if (item.ev.locked) { handleLockedClick(item.ev.ad); return } beginMove(pe, item.ev, item.s, item.e - item.s) }}
                        style={{ background: `${ty.renk}d9`, cursor: item.ev.locked ? 'not-allowed' : 'grab' }}
                        className={`group relative block size-full overflow-hidden rounded-md px-1.5 py-0.5 text-left text-[11px] leading-tight text-white ${item.ev.durum === 'tamamlandi' ? 'opacity-70' : ''} ${item.ev.durum === 'iptal' ? 'line-through opacity-60' : ''} ${isMoving || isResizing ? 'opacity-40' : ''} ${item.ev.taslak ? 'cal-taslak' : ''}`}
                      >
                        <span className="flex items-center gap-1 font-medium">
                          {item.ev.locked && <Lock size={9} />}
                          {minToHm(item.s)}–{minToHm(item.e)}
                        </span>
                        <span className="block truncate">{item.ev.ad || '(adsız)'}</span>
                        {!item.ev.locked && (
                          <>
                            <span onPointerDown={(pe) => beginResize(pe, item.ev, 'start', item.s, item.e)} className="absolute inset-x-0 top-0 h-1.5 cursor-ns-resize opacity-0 group-hover:opacity-100" />
                            <span onPointerDown={(pe) => beginResize(pe, item.ev, 'end', item.s, item.e)} className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize opacity-0 group-hover:opacity-100" />
                          </>
                        )}
                      </button>
                    </Tooltip.Trigger>
                    <Tooltip.Content showArrow>
                      <EventTooltipContent ev={item.ev} timeLabel={`${minToHm(item.s)}–${minToHm(item.e)}`} />
                    </Tooltip.Content>
                  </Tooltip.Root>
                )
              })}
            </div>
          ))}
        </div>
        {(() => {
          const todayIdx = days.findIndex((day) => isSameDay(day, today))
          if (todayIdx === -1) return null
          const lineTop = (todayMinutes() / 60) * HOUR_H
          return (
            <>
              <div
                className="pointer-events-none absolute left-0 z-[4] flex items-center justify-end pr-1"
                style={{ top: lineTop - 7, width: GUTTER }}
              >
                <span className="rounded bg-danger px-1 py-0.5 text-[9px] font-semibold leading-none text-danger-foreground">{minToHm(todayMinutes())}</span>
              </div>
              <div
                className="pointer-events-none absolute z-[3] border-t-2 border-danger"
                style={{ top: lineTop, left: `calc(${GUTTER}px + (100% - ${GUTTER}px) * ${todayIdx} / ${days.length})`, width: `calc((100% - ${GUTTER}px) / ${days.length})` }}
              >
                <span className="absolute -left-1 -top-1 size-2 rounded-full bg-danger" />
              </div>
            </>
          )
        })()}
      </div>
      {createPreview && (
        <div className="fixed inset-x-3 bottom-3 z-40 flex items-center gap-2 rounded-2xl border border-separator bg-[#1e2633] p-2 pl-3 text-white shadow-[var(--overlay-shadow)] sm:inset-x-auto sm:bottom-4 sm:left-1/2 sm:-translate-x-1/2">
          <span className="min-w-0 flex-1 truncate font-mono text-xs font-semibold">
            {fmtTrDate(dateKey(days[createPreview.dayIdx]))} · {minToHm(createPreview.startMin)}–{minToHm(createPreview.endMin)}
          </span>
          <button
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => setCreatePreview(null)}
            className="shrink-0 rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold hover:bg-white/20"
          >
            Vazgeç
          </button>
          <button
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => {
              const current = createPreview
              setCreatePreview(null)
              onCreate(dateKey(days[current.dayIdx]), minToHm(current.startMin), minToHm(current.endMin))
            }}
            className="shrink-0 rounded-xl bg-accent px-3 py-2 text-xs font-semibold text-accent-foreground hover:opacity-90"
          >
            Onayla
          </button>
        </div>
      )}
    </div>
  )
}

function hasTime(ev: CalendarEventWithId): boolean {
  return !!ev.saat && !(ev.bitisTarihi && ev.bitisTarihi !== ev.tarih)
}

function todayMinutes(): number {
  const now = new Date()
  return now.getHours() * 60 + now.getMinutes()
}
