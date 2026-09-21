import { Button, Input, TextField, toast } from '@heroui/react'
import { ref, serverTimestamp, update } from 'firebase/database'
import { ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useDbValue } from '../../hooks/useDbValue'
import { useWriter } from '../../hooks/useWriter'
import { db } from '../../lib/firebase'
import { KanbanCard } from './KanbanCard'
import type { KanbanItem, KanbanRecord, KanbanSource, KanbanStatus } from './kanbanTypes'
import { KANBAN_COLUMNS, addDays, isVisibleInWeek, normalizeDurum, startOfWeek, toKanbanItem, weekRangeLabel } from './kanbanTypes'

interface StaffProfile {
  displayName?: string
  avatarUrl?: string
}

export function KanbanPage() {
  const writer = useWriter()
  const [viewedWeek, setViewedWeek] = useState(() => startOfWeek(new Date()))
  const [search, setSearch] = useState('')
  const dragIdRef = useRef<string | null>(null)
  const [dragOverColumn, setDragOverColumn] = useState<KanbanStatus | null>(null)

  const events = useDbValue<Record<string, KanbanRecord | null>>('etkinlikler')
  const tasks = useDbValue<Record<string, KanbanRecord | null>>('gorevler')
  const staffProfiles = useDbValue<Record<string, StaffProfile | null>>('staffProfiles', { shadow: false })
  const isLoading = events.isLoading || tasks.isLoading

  const profilesByName = useMemo(() => {
    const map = new Map<string, StaffProfile>()
    Object.values(staffProfiles.data ?? {}).forEach((profile) => {
      if (profile?.displayName) map.set(profile.displayName.trim().toLocaleLowerCase('tr-TR'), profile)
    })
    return map
  }, [staffProfiles.data])

  const items = useMemo(() => {
    const fromEvents: Array<[string, KanbanSource, KanbanRecord]> = Object.entries(events.data ?? {}).flatMap(([id, e]) => (e ? [[id, 'etkinlik', e] as [string, KanbanSource, KanbanRecord]] : []))
    const fromTasks: Array<[string, KanbanSource, KanbanRecord]> = Object.entries(tasks.data ?? {}).flatMap(([id, t]) => (t ? [[id, 'gorev', t] as [string, KanbanSource, KanbanRecord]] : []))
    return [...fromEvents, ...fromTasks].map(([id, source, record]) => {
      const item = toKanbanItem(id, source, record)
      return { ...item, overdue: item.originWeek.getTime() < viewedWeek.getTime() }
    })
  }, [events.data, tasks.data, viewedWeek])

  const visibleItems = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('tr')
    return items
      .filter((item) => normalizeDurum(item.raw.durum) !== ('iptal' as KanbanStatus))
      .filter((item) => !q || item.title.toLocaleLowerCase('tr').includes(q))
      .filter((item) => isVisibleInWeek(item, viewedWeek))
      .sort((a, b) => a.dateKey.localeCompare(b.dateKey))
  }, [items, search, viewedWeek])

  const itemsByColumn = useMemo(() => {
    const map = new Map<KanbanStatus, KanbanItem[]>()
    KANBAN_COLUMNS.forEach((col) => map.set(col.id, []))
    visibleItems.forEach((item) => map.get(item.durum)?.push(item))
    return map
  }, [visibleItems])

  const moveCardTo = async (id: string, newStatus: KanbanStatus) => {
    const item = items.find((entry) => entry.id === id)
    if (!item || item.durum === newStatus) return
    const actor = writer.ensureWritable()
    if (!actor) return
    const oldTitle = KANBAN_COLUMNS.find((c) => c.id === item.durum)?.title ?? item.durum
    const newTitle = KANBAN_COLUMNS.find((c) => c.id === newStatus)?.title ?? newStatus
    const basePath = writer.path(item.source === 'gorev' ? `gorevler/${id}` : `etkinlikler/${id}`)
    const isDone = newStatus === 'tamamlandi'
    const updates: Record<string, unknown> = {
      [`${basePath}/durum`]: newStatus,
      [`${basePath}/guncellemeTs`]: serverTimestamp(),
      [`${basePath}/tamamlayan`]: isDone ? actor.name || actor.email : null,
      [`${basePath}/tamamlayanEmail`]: isDone ? actor.email : null,
      [`${basePath}/tamamlayanUid`]: isDone ? actor.uid : null,
    }
    if (item.source === 'gorev') updates[`${basePath}/tamamlandi`] = isDone
    try {
      await update(ref(db), updates)
      await writer.log(
        item.source === 'gorev' ? 'gorev' : 'etkinlik',
        `${item.title} ${item.source === 'gorev' ? 'görevinin' : 'etkinliğinin'} durumu panodan değiştirildi · Durum: ${oldTitle} → ${newTitle}`,
        item.title,
      )
      toast.success(`"${item.title}" → ${newTitle}`)
    } catch (err) {
      writer.reportError('Durum güncellenemedi.')(err)
    }
  }

  const onDragStart = (event: React.DragEvent<HTMLElement>, id: string) => {
    dragIdRef.current = id
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', id)
  }
  const onDragEnd = () => { dragIdRef.current = null; setDragOverColumn(null) }
  const onColumnDrop = (status: KanbanStatus) => {
    setDragOverColumn(null)
    if (dragIdRef.current) void moveCardTo(dragIdRef.current, status)
    dragIdRef.current = null
  }

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-muted">Uygulamalar</div>
          <h1 className="mt-1 text-2xl font-semibold">Haber üretim panosu</h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1">
            <Button isIconOnly size="sm" variant="ghost" aria-label="Önceki hafta" onPress={() => setViewedWeek((w) => addDays(w, -7))}>
              <ChevronLeft size={16} />
            </Button>
            <span className="min-w-[150px] text-center text-sm font-medium">{weekRangeLabel(viewedWeek)}</span>
            <Button isIconOnly size="sm" variant="ghost" aria-label="Sonraki hafta" onPress={() => setViewedWeek((w) => addDays(w, 7))}>
              <ChevronRight size={16} />
            </Button>
            <Button size="sm" variant="ghost" onPress={() => setViewedWeek(startOfWeek(new Date()))}>Bugün</Button>
          </div>
          <TextField value={search} onChange={setSearch} aria-label="Etkinlik ara" className="relative w-56">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-muted" />
            <Input placeholder="Etkinlik ara…" className="pl-9" autoComplete="off" />
          </TextField>
        </div>
      </div>

      {isLoading && <p className="py-10 text-center text-sm text-muted">Yükleniyor…</p>}

      {!isLoading && (
        <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {KANBAN_COLUMNS.map((col) => {
            const colItems = itemsByColumn.get(col.id) ?? []
            return (
              <section key={col.id} className="flex flex-col gap-2 rounded-2xl border border-separator bg-surface-secondary/30 p-3">
                <header className="flex items-center gap-2 px-1 pb-1">
                  <span className={`size-2 shrink-0 rounded-full ${col.dotClass}`} />
                  <span className="text-sm font-semibold">{col.title}</span>
                  <span className="ml-auto rounded-full bg-default px-2 py-0.5 text-xs text-muted">{colItems.length}</span>
                </header>
                <div
                  onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDragOverColumn(col.id) }}
                  onDragLeave={() => setDragOverColumn((current) => (current === col.id ? null : current))}
                  onDrop={(event) => { event.preventDefault(); onColumnDrop(col.id) }}
                  className={`flex min-h-[64px] flex-col gap-2 rounded-xl p-1 transition-colors ${dragOverColumn === col.id ? 'bg-accent-soft/60' : ''}`}
                >
                  {colItems.length === 0 && <p className="px-2 py-4 text-center text-xs text-muted">Etkinlik yok.</p>}
                  {colItems.map((item) => (
                    <KanbanCard
                      key={item.id}
                      item={item}
                      canWrite={writer.canWrite}
                      profilesByName={profilesByName}
                      onDragStart={(event) => onDragStart(event, item.id)}
                      onDragEnd={onDragEnd}
                      onMoveTo={(status) => void moveCardTo(item.id, status)}
                    />
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
