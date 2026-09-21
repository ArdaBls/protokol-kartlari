import { Button } from '@heroui/react'
import { Plus, X } from 'lucide-react'
import { FieldLabel } from '../../components/formControls'
import type { GanttStep } from './ganttTypes'
import { STEP_STATUSES } from './ganttTypes'

export interface StepDraft extends GanttStep {
  id: string
}

interface StepsEditorProps {
  steps: StepDraft[]
  onChange: (steps: StepDraft[]) => void
  projectStart: string
  projectEnd: string
}

const CONTROL =
  'h-9 rounded-xl border border-[var(--field-border)] bg-[var(--field-background)] px-3 text-sm text-[var(--field-foreground)] outline-none placeholder:text-[var(--field-placeholder)] hover:border-[var(--field-border-hover)] focus-visible:border-[var(--focus)]'

let localStepCounter = 0
export const newStepId = () => `local-${Date.now().toString(36)}-${(localStepCounter += 1)}`

export function StepsEditor({ steps, onChange, projectStart, projectEnd }: StepsEditorProps) {
  const update = (id: string, patch: Partial<StepDraft>) => onChange(steps.map((step) => (step.id === id ? { ...step, ...patch } : step)))
  const remove = (id: string) => onChange(steps.filter((step) => step.id !== id))
  const add = () =>
    onChange([
      ...steps,
      { id: newStepId(), ad: '', durum: 'yapilacak', baslangicTarihi: projectStart, bitisTarihi: projectEnd, sorumlu: '', sira: steps.length },
    ])

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <FieldLabel>Üretim adımları</FieldLabel>
          <p className="text-xs text-muted">Projenin altında açılıp kapanan görev satırları olarak görünür.</p>
        </div>
        <Button size="sm" variant="ghost" onPress={add}>
          <Plus size={14} />
          Adım ekle
        </Button>
      </div>

      {!steps.length && <p className="rounded-xl border border-dashed border-separator p-4 text-center text-sm text-muted">Henüz üretim adımı eklenmedi.</p>}

      {steps.map((step, index) => (
        <div key={step.id} className="flex flex-col gap-2 rounded-2xl border border-separator bg-surface-secondary/40 p-3">
          <div className="flex items-center gap-2">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-default text-xs font-medium">{index + 1}</span>
            <input
              value={step.ad ?? ''}
              onChange={(event) => update(step.id, { ad: event.target.value })}
              placeholder="Örn. Röportaj çekimi"
              maxLength={140}
              required
              className={`${CONTROL} flex-1`}
            />
            <select value={step.durum ?? 'yapilacak'} onChange={(event) => update(step.id, { durum: event.target.value })} className={`${CONTROL} w-36`}>
              {Object.entries(STEP_STATUSES).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <button type="button" onClick={() => remove(step.id)} aria-label="Bu adımı kaldır" className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted hover:bg-default hover:text-danger">
              <X size={15} />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2 pl-8">
            <input type="date" required value={step.baslangicTarihi ?? ''} onChange={(event) => update(step.id, { baslangicTarihi: event.target.value })} className={CONTROL} />
            <input type="date" required value={step.bitisTarihi ?? ''} onChange={(event) => update(step.id, { bitisTarihi: event.target.value })} className={CONTROL} />
            <input
              value={step.sorumlu ?? ''}
              onChange={(event) => update(step.id, { sorumlu: event.target.value })}
              placeholder="Sorumlu"
              maxLength={120}
              className={CONTROL}
            />
          </div>
        </div>
      ))}
    </div>
  )
}
