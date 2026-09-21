import { Button, Card, Input, TextField } from '@heroui/react'
import { Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useAuth } from '../../auth/useAuth'
import { SelectField } from '../../components/formControls'
import { useDbValue } from '../../hooks/useDbValue'
import { dateKey } from '../../lib/dates'
import { useDbMode } from '../../lib/dbMode'
import { isApprovedRole } from '../../lib/roles'
import { GanttBoard } from './GanttBoard'
import type { CalendarEventRef, GanttProject } from './ganttTypes'
import { STATUSES, projectSteps } from './ganttTypes'
import { ProjectModal } from './ProjectModal'
import { useGanttWriter } from './useGanttWriter'
import { useOwnerPool } from './useOwnerPool'

const STATUS_FILTER_OPTIONS = [{ value: '', label: 'Tüm durumlar' }, ...Object.entries(STATUSES).map(([value, label]) => ({ value, label }))]

interface StatProps {
  label: string
  value: number
  danger?: boolean
}
function Stat({ label, value, danger }: StatProps) {
  return (
    <div className="flex flex-col gap-0.5 rounded-2xl border border-separator bg-surface-secondary/40 px-4 py-3">
      <span className="text-xs text-muted">{label}</span>
      <strong className={`text-xl tabular-nums ${danger ? 'text-danger' : ''}`}>{value}</strong>
    </div>
  )
}

export function GanttPage() {
  const { state } = useAuth()
  const { isReadOnly } = useDbMode()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [editing, setEditing] = useState<{ id: string; stepId?: string } | 'new' | null>(null)

  const projects = useDbValue<Record<string, GanttProject | null>>('haberProjeleri')
  const events = useDbValue<Record<string, CalendarEventRef | null>>('etkinlikler')
  const ownerPool = useOwnerPool()
  const { canWrite: writerCanWrite, updateProjectDates } = useGanttWriter()

  const canWrite = state.status === 'ready' && isApprovedRole(state.role) && !isReadOnly

  const visible = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('tr')
    return Object.entries(projects.data ?? {})
      .filter((entry): entry is [string, GanttProject] => !!entry[1] && entry[1].arsiv !== true)
      .filter(([, project]) => !statusFilter || project.durum === statusFilter)
      .filter(([, project]) => {
        if (!q) return true
        const stepText = projectSteps(project).map(([, step]) => `${step.ad ?? ''} ${step.sorumlu ?? ''}`).join(' ')
        return `${project.ad ?? ''} ${project.sorumlu ?? ''} ${stepText}`.toLocaleLowerCase('tr').includes(q)
      })
      .sort(([, a], [, b]) => String(a.bitisTarihi ?? '').localeCompare(String(b.bitisTarihi ?? '')))
  }, [projects.data, search, statusFilter])

  const stats = useMemo(() => {
    const today = dateKey(new Date())
    const monthPrefix = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`
    const list = Object.values(projects.data ?? {}).filter((project): project is GanttProject => !!project && project.arsiv !== true)
    return {
      active: list.filter((project) => !['yayinlandi', 'iptal'].includes(project.durum ?? '')).length,
      month: list.filter((project) => String(project.bitisTarihi ?? '').startsWith(monthPrefix)).length,
      overdue: list.filter((project) => (project.bitisTarihi ?? '') < today && !['yayinlandi', 'iptal'].includes(project.durum ?? '')).length,
      special: list.filter((project) => project.tur === 'ozel').length,
    }
  }, [projects.data])

  const editingId = editing === 'new' ? null : editing?.id ?? null
  const editingEntry = editingId && projects.data?.[editingId] ? ([editingId, projects.data[editingId]!] as [string, GanttProject]) : null

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-muted">Haberler</div>
          <h1 className="mt-1 text-2xl font-semibold">Haber üretim takvimi</h1>
          <p className="mt-1 text-sm text-muted">Özel haberleri ve üretim aşamalarını tek zaman çizelgesinde planlayın.</p>
        </div>
        {canWrite && (
          <Button variant="primary" onPress={() => setEditing('new')}>
            <Plus size={16} />
            Yeni proje
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Aktif" value={stats.active} />
        <Stat label="Bu ay teslim" value={stats.month} />
        <Stat label="Geciken" value={stats.overdue} danger />
        <Stat label="Özel haber" value={stats.special} />
      </div>

      <Card>
        <Card.Header className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <SelectField label="" value={statusFilter} onChange={setStatusFilter} options={STATUS_FILTER_OPTIONS} className="w-full lg:w-44" />
          <TextField value={search} onChange={setSearch} aria-label="Proje veya sorumlu ara" className="w-full lg:w-64">
            <Input placeholder="Proje veya sorumlu ara…" autoComplete="off" />
          </TextField>
        </Card.Header>
        <Card.Content>
          {projects.isLoading && <p className="py-10 text-center text-sm text-muted">Projeler yükleniyor…</p>}
          {projects.error && <p className="py-10 text-center text-sm text-danger">Projeler yüklenemedi.</p>}
          {!projects.isLoading && !projects.error && (
            <GanttBoard
              projects={visible}
              canWrite={writerCanWrite}
              onEdit={(id, stepId) => setEditing({ id, stepId })}
              onUpdateDates={updateProjectDates}
            />
          )}
        </Card.Content>
      </Card>

      <ProjectModal
        isOpen={editing !== null}
        onOpenChange={(isOpen) => { if (!isOpen) setEditing(null) }}
        entry={editingEntry}
        events={events.data ?? {}}
        ownerPool={ownerPool}
      />
    </div>
  )
}
