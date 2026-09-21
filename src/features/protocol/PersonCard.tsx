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
  mobileColumns?: 2 | 3 | 4
  isSelectable?: boolean
  isSelected?: boolean
  onToggleSelect?: (personId: string) => void
  onEdit?: (person: Person) => void
  onRestore?: (person: Person) => void
  onDeleteForever?: (person: Person) => void
}

function PersonCardView({ person, mobileColumns = 2, isSelectable, isSelected, onToggleSelect, onEdit, onRestore, onDeleteForever }: PersonCardProps) {
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
      className={`min-w-0 gap-0 overflow-hidden p-0 transition-shadow ${status === 'aktif' ? '' : 'opacity-80'} ${
        isSelectable ? 'cursor-pointer select-none' : ''
      } ${isSelected ? 'ring-2 ring-accent ring-offset-2 ring-offset-background' : ''}`}
    >
      <div className="relative aspect-[4/5] min-w-0 bg-surface-secondary">
        {photo ? (
          <img src={photo} alt="" loading="lazy" draggable={false} onError={() => setHasPhotoError(true)} className="size-full object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center text-3xl font-semibold text-muted">{initials(person.name ?? '?')}</div>
        )}
        <div className={`pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-2.5 ${mobileColumns === 3 ? 'max-sm:p-2' : mobileColumns === 4 ? 'max-sm:p-1.5' : ''}`}>
          <span className={`flex h-8 min-w-8 items-center justify-center rounded-full bg-background/70 px-2 text-sm font-semibold tabular-nums backdrop-blur-md ${mobileColumns === 3 ? 'max-sm:h-7 max-sm:min-w-7 max-sm:px-1.5 max-sm:text-xs' : mobileColumns === 4 ? 'max-sm:h-6 max-sm:min-w-6 max-sm:px-1 max-sm:text-[10px]' : ''}`} title="Protokol sırası">
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

      <div className={`flex min-w-0 flex-1 flex-col gap-1 p-3.5 ${mobileColumns === 3 ? 'max-sm:gap-0.5 max-sm:p-2' : mobileColumns === 4 ? 'max-sm:gap-0.5 max-sm:p-1.5' : ''}`}>
        {person.prefix && <span className={`text-xs font-medium text-accent ${mobileColumns === 3 ? 'max-sm:text-[11px]' : mobileColumns === 4 ? 'max-sm:text-[9px]' : ''}`}>{person.prefix}</span>}
        <h3 className={`break-words text-[15px] font-semibold leading-snug ${mobileColumns === 3 ? 'max-sm:line-clamp-2 max-sm:text-xs' : mobileColumns === 4 ? 'max-sm:line-clamp-2 max-sm:text-[11px]' : ''}`}>{person.name}</h3>
        <p className={`break-words text-sm leading-snug ${mobileColumns === 3 ? 'max-sm:line-clamp-2 max-sm:text-[11px]' : mobileColumns === 4 ? 'max-sm:line-clamp-2 max-sm:text-[10px]' : ''}`}>{person.title}</p>
        {person.unit && <p className={`line-clamp-2 text-xs text-muted ${mobileColumns === 3 ? 'max-sm:text-[10px]' : mobileColumns === 4 ? 'max-sm:line-clamp-1 max-sm:text-[9px]' : ''}`}>{person.unit}</p>}

        <div className="mt-auto flex flex-col gap-2 pt-2.5">
          <div className={`flex justify-between text-[11px] text-muted tabular-nums ${mobileColumns === 3 || mobileColumns === 4 ? 'max-sm:hidden' : ''}`}>
            <span>{formatDateKey(person.start)}</span>
            <span>{person.end ? formatDateKey(person.end) : 'devam ediyor'}</span>
          </div>
          <Chip size="sm" variant="soft" color={FRESHNESS_COLOR[freshness.level]} className={`self-start ${mobileColumns === 3 || mobileColumns === 4 ? 'max-sm:hidden' : ''}`}>{freshness.label}</Chip>
          {person.note && <p className="line-clamp-2 text-xs italic text-muted">{person.note}</p>}

          {!isSelectable && onEdit && (
            mobileColumns === 4 ? (
              <>
                <Button size="sm" variant="tertiary" fullWidth onPress={() => onEdit(person)} className="max-sm:hidden">
                  <Pencil size={14} />
                  Düzenle
                </Button>
                <Button size="sm" variant="tertiary" isIconOnly aria-label="Düzenle" onPress={() => onEdit(person)} className="hidden max-sm:inline-flex max-sm:size-8 max-sm:min-w-8 max-sm:self-center">
                  <Pencil size={14} />
                </Button>
              </>
            ) : (
              <Button size="sm" variant="tertiary" fullWidth onPress={() => onEdit(person)} className={mobileColumns === 3 ? 'max-sm:px-1 max-sm:text-[11px]' : ''}>
                <Pencil size={mobileColumns === 3 ? 12 : 14} />
                Düzenle
              </Button>
            )
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
