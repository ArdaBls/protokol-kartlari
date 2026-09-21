import { Button, Chip, toast } from '@heroui/react'
import { Plus, X } from 'lucide-react'
import { useState } from 'react'
import { TextInputField } from '../../../components/formControls'
import { formatLongDateKey } from '../../../lib/dates'
import type { HistoryEntry } from '../protocolRules'

interface HistoryEditorProps {
  entries: HistoryEntry[]
  onChange: (next: HistoryEntry[]) => void
  current: { title: string; start: string; end: string }
  /** Yeni eklenen görev genelde güncel durumu yansıtır; ana kaydın başlangıç tarihi de eşitlenir. */
  onEntryAdded: (start: string) => void
}

const EMPTY_ENTRY: HistoryEntry = { unvan: '', baslangic: '', bitis: '' }
const rangeLabel = (start: string, end: string, openEnded: string) =>
  `${start ? formatLongDateKey(start) : '?'} – ${end ? formatLongDateKey(end) : openEnded}`

export function HistoryEditor({ entries, onChange, current, onEntryAdded }: HistoryEditorProps) {
  const [draft, setDraft] = useState<HistoryEntry>(EMPTY_ENTRY)

  const add = () => {
    const unvan = draft.unvan.trim()
    if (!unvan) {
      toast.danger('Görev adı zorunlu.')
      return
    }
    onChange([...entries, { ...draft, unvan }])
    if (draft.baslangic) onEntryAdded(draft.baslangic)
    setDraft(EMPTY_ENTRY)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        {current.title && (
          <div className="flex items-center gap-3 rounded-2xl bg-accent-soft px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{current.title}</div>
              <div className="text-xs text-muted">{rangeLabel(current.start, current.end, 'devam ediyor')}</div>
            </div>
            <Chip size="sm" color="accent" variant="primary">Güncel</Chip>
          </div>
        )}
        {entries.map((entry, index) => (
          <div key={`${entry.unvan}-${index}`} className="flex items-center gap-3 rounded-2xl bg-surface-secondary px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{entry.unvan}</div>
              <div className="text-xs text-muted">{rangeLabel(entry.baslangic, entry.bitis, '?')}</div>
            </div>
            <Button isIconOnly size="sm" variant="ghost" aria-label={`${entry.unvan} görevini sil`} onPress={() => onChange(entries.filter((_, i) => i !== index))}>
              <X size={14} />
            </Button>
          </div>
        ))}
        {!current.title && entries.length === 0 && <p className="text-sm text-muted">Henüz görev eklenmedi.</p>}
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-dashed border-separator p-4">
        <TextInputField label="Görev adı" value={draft.unvan} onChange={(unvan) => setDraft((d) => ({ ...d, unvan }))} placeholder="Örn. Dekanlık, Vekâleten Dekanlık" />
        <div className="grid grid-cols-2 gap-3">
          <TextInputField label="Başlangıç" type="date" value={draft.baslangic} onChange={(baslangic) => setDraft((d) => ({ ...d, baslangic }))} />
          <TextInputField label="Bitiş" type="date" value={draft.bitis} onChange={(bitis) => setDraft((d) => ({ ...d, bitis }))} />
        </div>
        <Button variant="secondary" onPress={add} className="self-start">
          <Plus size={16} />
          Göreve ekle
        </Button>
      </div>
    </div>
  )
}
