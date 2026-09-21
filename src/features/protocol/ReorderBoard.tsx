import { Button } from '@heroui/react'
import { ArrowDownAZ, ChevronRight, GripVertical } from 'lucide-react'
import { Reorder, useDragControls } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { initials } from '../../lib/roles'
import type { Person } from './protocolRules'
import { hierarchyWeight, institutionWeight, rankGroupKey, safePhotoUrl } from './protocolRules'

interface ReorderBoardProps {
  people: Person[]
  onSaveOrder: (ordered: Person[], moved: Person, groupLabel: string) => Promise<boolean>
  onSortByName: (members: Person[], groupLabel: string) => void
}

const groupLabelOf = (key: string) => (key === '__none__' ? 'Sırasız' : `Sıra ${key}`)
const lockCompare = (a: Person, b: Person) => hierarchyWeight(a) - hierarchyWeight(b) || institutionWeight(a) - institutionWeight(b)
/** Bir kişi, aynı sıradaki daha üst unvan katmanındaki (veya OMÜ önceliğindeki) birinin önüne geçemez. */
const respectsLocks = (list: Person[]) => list.every((person, i) => i === 0 || lockCompare(list[i - 1], person) <= 0)

function ReorderRow({ person, index, onDragStart, onDragEnd }: { person: Person; index: number; onDragStart: () => void; onDragEnd: () => void }) {
  const controls = useDragControls()
  const photo = safePhotoUrl(person.photo)
  return (
    <Reorder.Item
      value={person}
      dragListener={false}
      dragControls={controls}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      whileDrag={{ scale: 1.02, boxShadow: 'var(--overlay-shadow)', zIndex: 10 }}
      className="relative flex items-center gap-3 rounded-2xl bg-surface-secondary p-2 pr-3"
    >
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent tabular-nums">{index + 1}</span>
      <button
        type="button"
        aria-label={`${person.name ?? 'Kişi'} sürükle`}
        onPointerDown={(event) => controls.start(event)}
        className="cursor-grab touch-none rounded-lg p-1 text-muted hover:bg-default-soft active:cursor-grabbing"
      >
        <GripVertical size={18} />
      </button>
      <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-surface-tertiary text-xs font-semibold text-muted">
        {photo ? <img src={photo} alt="" draggable={false} className="size-full object-cover" /> : initials(person.name ?? '?')}
      </span>
      <span className="min-w-0 flex-1">
        {person.prefix && <span className="block text-[11px] font-medium text-accent">{person.prefix}</span>}
        <span className="block truncate text-sm font-medium">{person.name}</span>
        <span className="block truncate text-xs text-muted">{person.title}</span>
      </span>
    </Reorder.Item>
  )
}

interface RankGroupProps {
  groupKey: string
  members: Person[]
  isOpen: boolean
  onToggle: () => void
  onSaveOrder: ReorderBoardProps['onSaveOrder']
  onSortByName: ReorderBoardProps['onSortByName']
}

function RankGroup({ groupKey, members, isOpen, onToggle, onSaveOrder, onSortByName }: RankGroupProps) {
  const [items, setItems] = useState(members)
  const itemsRef = useRef(members)
  const movedRef = useRef<Person | null>(null)
  const label = groupLabelOf(groupKey)

  useEffect(() => {
    setItems(members)
    itemsRef.current = members
  }, [members])

  const handleReorder = (next: Person[]) => {
    if (!respectsLocks(next)) return
    itemsRef.current = next
    setItems(next)
  }

  const commit = async () => {
    const moved = movedRef.current
    movedRef.current = null
    const next = itemsRef.current
    if (!moved || next.every((person, i) => person._id === members[i]?._id)) return
    const ok = await onSaveOrder(next, moved, label)
    if (!ok) {
      itemsRef.current = members
      setItems(members)
    }
  }

  return (
    <div className="rounded-3xl bg-surface shadow-[var(--surface-shadow)]">
      <div className="flex items-center gap-2 p-2 pl-3">
        <button type="button" onClick={onToggle} aria-expanded={isOpen} className="flex flex-1 items-center gap-2 rounded-xl px-2 py-2 text-left">
          <ChevronRight size={16} className={`text-muted transition-transform ${isOpen ? 'rotate-90' : ''}`} />
          <span className="font-semibold">{label}</span>
          <span className="rounded-full bg-default px-2 py-0.5 text-xs text-muted tabular-nums">{members.length} kişi</span>
        </button>
        <Button size="sm" variant="ghost" onPress={() => onSortByName(members, label)}>
          <ArrowDownAZ size={14} />
          A-Z
        </Button>
      </div>
      {isOpen && (
        <Reorder.Group axis="y" values={items} onReorder={handleReorder} className="flex flex-col gap-2 px-3 pb-3">
          {items.map((person, index) => (
            <ReorderRow key={person._id} person={person} index={index} onDragStart={() => { movedRef.current = person }} onDragEnd={commit} />
          ))}
        </Reorder.Group>
      )}
    </div>
  )
}

export function ReorderBoard({ people, onSaveOrder, onSortByName }: ReorderBoardProps) {
  const groups = useMemo(() => {
    const map = new Map<string, Person[]>()
    people.forEach((person) => {
      const key = rankGroupKey(person)
      map.set(key, [...(map.get(key) ?? []), person])
    })
    return [...map.entries()]
  }, [people])
  const [openKeys, setOpenKeys] = useState<ReadonlySet<string>>(new Set())

  const toggle = (key: string) =>
    setOpenKeys((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 rounded-3xl bg-accent-soft p-4 text-sm sm:flex-row sm:items-center">
        <p className="flex-1 leading-relaxed">
          Kişileri tutamaçtan sürükleyerek <b>kendi protokol sırası içinde</b> dizin. Asıl sıra numarası değişmez; bir kişi aynı sıradaki
          daha üst unvanlı birinin önüne geçemez.
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onPress={() => setOpenKeys(new Set(groups.map(([key]) => key)))}>Hepsini aç</Button>
          <Button size="sm" variant="ghost" onPress={() => setOpenKeys(new Set())}>Hepsini kapat</Button>
        </div>
      </div>
      {groups.map(([key, members]) => (
        <RankGroup
          key={key}
          groupKey={key}
          members={members}
          isOpen={openKeys.has(key)}
          onToggle={() => toggle(key)}
          onSaveOrder={onSaveOrder}
          onSortByName={onSortByName}
        />
      ))}
    </div>
  )
}
