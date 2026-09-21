import { Button, Card, Chip } from '@heroui/react'
import { Check, Pencil, RotateCcw, Trash2 } from 'lucide-react'
import type { KeyboardEvent } from 'react'
import { memo, useState } from 'react'
import { initials } from '../../lib/roles'
import type { FreshnessLevel, Person } from './protocolRules'
import { formatDateKey, freshnessOf, safePhotoUrl, statusOf } from './protocolRules'

const FRESHNESS_COLOR: Record<FreshnessLevel, 'success' | 'warning' | 'danger'> = { green: 'success', yellow: 'warning', red: 'danger' }

const STATUS_CHIP = {
  aktif: { label: 'Aktif', color: 'success' },
  pasif: { label: 'Arşiv', color: 'warning' },
  silindi: { label: 'Silindi', color: 'danger' },
} as const

interface PersonCardProps {
  person: Person
  isSelectable?: boolean
  isSelected?: boolean
  onToggleSelect?: (personId: string) => void
  onEdit?: (person: Person) => void
  onRestore?: (person: Person) => void
  onDeleteForever?: (person: Person) => void
}

function PersonCardView({ person, isSelectable, isSelected, onToggleSelect, onEdit, onRestore, onDeleteForever }: PersonCardProps) {
  const [hasPhotoError, setHasPhotoError] = useState(false)
  const photo = hasPhotoError ? '' : safePhotoUrl(person.photo)
  const status = statusOf(person)
  const freshness = freshnessOf(person)
  const hasRank = person.rank !== undefined && person.rank !== null && person.rank !== ''

  const toggle = () => onToggleSelect?.(person._id)
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== ' ' && event.key !== 'Enter') return
    event.preventDefault()
    toggle()
  }
  const selectableProps = isSelectable
    ? { role: 'checkbox', 'aria-checked': !!isSelected, tabIndex: 0, onClick: toggle, onKeyDown }
    : {}

  return (
    <Card
      {...selectableProps}
      className={`gap-0 overflow-hidden p-0 transition-shadow ${status === 'aktif' ? '' : 'opacity-80'} ${
        isSelectable ? 'cursor-pointer select-none' : ''
      } ${isSelected ? 'ring-2 ring-accent ring-offset-2 ring-offset-background' : ''}`}
    >
      <div className="relative aspect-[4/5] bg-surface-secondary">
        {photo ? (
          <img src={photo} alt="" loading="lazy" draggable={false} onError={() => setHasPhotoError(true)} className="size-full object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center text-3xl font-semibold text-muted">{initials(person.name ?? '?')}</div>
        )}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-2.5">
          <span className="flex h-8 min-w-8 items-center justify-center rounded-full bg-background/70 px-2 text-sm font-semibold tabular-nums backdrop-blur-md" title="Protokol sırası">
            {hasRank ? person.rank : '?'}
          </span>
          {isSelectable ? (
            <span className={`flex size-7 items-center justify-center rounded-full border-2 backdrop-blur-md ${isSelected ? 'border-accent bg-accent text-accent-foreground' : 'border-foreground/60 bg-background/40'}`}>
              {isSelected && <Check size={16} strokeWidth={3} />}
            </span>
          ) : (
            status !== 'aktif' && <Chip size="sm" color={STATUS_CHIP[status].color} variant="primary">{STATUS_CHIP[status].label}</Chip>
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-1 p-3.5">
        {person.prefix && <span className="text-xs font-medium text-accent">{person.prefix}</span>}
        <h3 className="text-[15px] font-semibold leading-snug">{person.name}</h3>
        <p className="text-sm leading-snug">{person.title}</p>
        {person.unit && <p className="line-clamp-2 text-xs text-muted">{person.unit}</p>}

        <div className="mt-auto flex flex-col gap-2 pt-2.5">
          <div className="flex justify-between text-[11px] text-muted tabular-nums">
            <span>{formatDateKey(person.start)}</span>
            <span>{person.end ? formatDateKey(person.end) : 'devam ediyor'}</span>
          </div>
          <Chip size="sm" variant="soft" color={FRESHNESS_COLOR[freshness.level]} className="self-start">{freshness.label}</Chip>
          {person.note && <p className="line-clamp-2 text-xs italic text-muted">{person.note}</p>}

          {!isSelectable && onEdit && (
            <Button size="sm" variant="tertiary" fullWidth onPress={() => onEdit(person)}>
              <Pencil size={14} />
              Düzenle
            </Button>
          )}
          {!isSelectable && (onRestore || onDeleteForever) && (
            <div className="grid grid-cols-2 gap-2">
              <Button size="sm" variant="secondary" onPress={() => onRestore?.(person)}>
                <RotateCcw size={14} />
                Geri al
              </Button>
              <Button size="sm" variant="danger-soft" onPress={() => onDeleteForever?.(person)}>
                <Trash2 size={14} />
                Sil
              </Button>
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}

export const PersonCard = memo(PersonCardView)
