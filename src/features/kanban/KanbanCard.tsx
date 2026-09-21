import { Avatar, Tooltip } from '@heroui/react'
import { ArrowUpDown } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { formatShortDateKey } from '../../lib/dates'
import { initials, isSafeAvatarUrl } from '../../lib/roles'
import { AttendeeAvatars } from './AttendeeAvatars'
import type { KanbanItem, KanbanStatus } from './kanbanTypes'
import { KANBAN_COLUMNS, weekRangeLabel } from './kanbanTypes'

interface StaffProfile {
  displayName?: string
  avatarUrl?: string
}

interface KanbanCardProps {
  item: KanbanItem
  canWrite: boolean
  profilesByName: Map<string, StaffProfile>
  onDragStart: (event: React.DragEvent<HTMLElement>) => void
  onDragEnd: (event: React.DragEvent<HTMLElement>) => void
  onMoveTo: (status: KanbanStatus) => void
}

/** Sürükle-bırağın klavye/erişilebilirlik alternatifi -- eski sitedeki gibi küçük bir açılır
 * menü, kartın altında kalıcı bir alan kaplamaz; seçim/dışarı tıklama/Escape ile kapanır. */
function MoveMenu({ title, otherColumns, onMoveTo }: { title: string; otherColumns: typeof KANBAN_COLUMNS; onMoveTo: (status: KanbanStatus) => void }) {
  const [isOpen, setIsOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return
    const onPointerDown = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false) }
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setIsOpen(false) }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [isOpen])

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={`${title} kartını başka bir sütuna taşı`}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        title="Sütuna taşı"
        onClick={() => setIsOpen((current) => !current)}
        className="flex size-6 items-center justify-center rounded-lg text-muted hover:bg-default hover:text-foreground"
      >
        <ArrowUpDown size={13} />
      </button>
      {isOpen && (
        <div role="menu" className="absolute right-0 top-full z-20 mt-1 w-40 rounded-xl border border-separator bg-surface p-1 shadow-[var(--overlay-shadow)]">
          {otherColumns.map((col) => (
            <button
              key={col.id}
              type="button"
              role="menuitem"
              onClick={() => { onMoveTo(col.id); setIsOpen(false) }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs hover:bg-default"
            >
              <span className={`size-1.5 shrink-0 rounded-full ${col.dotClass}`} />
              {col.title}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function KanbanCard({ item, canWrite, profilesByName, onDragStart, onDragEnd, onMoveTo }: KanbanCardProps) {
  const isOverdue = item.durum !== 'tamamlandi' && item.overdue
  const completerName = item.durum === 'tamamlandi' ? item.raw.tamamlayan : undefined
  const completerProfile = completerName ? profilesByName.get(completerName.trim().toLocaleLowerCase('tr-TR')) : undefined
  const otherColumns = KANBAN_COLUMNS.filter((c) => c.id !== item.durum)

  return (
    <article
      draggable={canWrite}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`relative flex flex-col gap-2 rounded-2xl border bg-surface p-3 text-sm shadow-[var(--field-shadow)] ${canWrite ? 'cursor-grab active:cursor-grabbing' : ''} ${isOverdue ? 'border-warning/50' : 'border-separator'}`}
    >
      {/* Tamamlayan rozeti: rol avatarlarıyla karışmasın diye kartın sağ üst köşesinde ayrı gösterilir --
          takvimden veya buradan "Tamamlandı"ya taşınan her kart için aynı. */}
      {completerName && (
        <Tooltip.Root delay={0} closeDelay={0}>
          <Tooltip.Trigger>
            <Avatar size="sm" color="success" className="absolute -right-1.5 -top-1.5 size-6 ring-2 ring-surface">
              {isSafeAvatarUrl(completerProfile?.avatarUrl) && <Avatar.Image src={completerProfile!.avatarUrl} alt="" draggable={false} />}
              <Avatar.Fallback className="text-[10px]">{initials(completerName)}</Avatar.Fallback>
            </Avatar>
          </Tooltip.Trigger>
          <Tooltip.Content showArrow>{completerName} tamamladı</Tooltip.Content>
        </Tooltip.Root>
      )}
      <div className="pr-4 font-medium leading-snug">{item.title}</div>
      {item.subtitle && <div className="text-xs text-muted">{item.subtitle}</div>}
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {item.dateKey && <span className="text-xs text-muted tabular-nums">{formatShortDateKey(item.dateKey)}</span>}
          {isOverdue && <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-medium text-warning">{weekRangeLabel(item.originWeek)} haftasından</span>}
        </div>
        <div className="flex items-center gap-1.5">
          {item.source === 'etkinlik' && (
            <AttendeeAvatars
              gorevli={item.raw.gorevli}
              haberYazanlari={item.raw.haberYazanlari}
              excludeName={item.durum === 'tamamlandi' ? completerName : undefined}
              profilesByName={profilesByName}
              size={24}
            />
          )}
          {canWrite && <MoveMenu title={item.title} otherColumns={otherColumns} onMoveTo={onMoveTo} />}
        </div>
      </div>
    </article>
  )
}
