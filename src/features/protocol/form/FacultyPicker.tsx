import { Input, TextField } from '@heroui/react'
import { ChevronRight, X } from 'lucide-react'
import { useState } from 'react'
import { FieldLabel } from '../../../components/formControls'
import { FilterCheckbox } from '../FacultyFilter'
import { FACULTY_GROUPS } from '../protocolRules'

interface FacultyPickerProps {
  selected: string[]
  onChange: (next: string[]) => void
  /** Kendi başlıklı bölümünde kullanılırken üstteki etiket gizlenebilir. */
  showLabel?: boolean
}

export function FacultyPicker({ selected, onChange, showLabel = true }: FacultyPickerProps) {
  const [query, setQuery] = useState('')
  const normalized = query.trim().toLocaleLowerCase('tr')

  const toggle = (item: string) =>
    onChange(selected.includes(item) ? selected.filter((value) => value !== item) : [...selected, item])

  return (
    <div className="flex flex-col gap-2">
      {showLabel && (
        <div>
          <FieldLabel>Bağlı olduğu birim(ler) / ek görev(ler)</FieldLabel>
          <p className="text-xs text-muted">Opsiyonel · birden fazla seçilebilir (örn. Rektör Yardımcısı + bir koordinatörlük)</p>
        </div>
      )}

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((item) => (
            <span key={item} className="inline-flex items-center gap-1 rounded-full bg-accent-soft py-1 pl-3 pr-1 text-xs font-medium text-accent">
              {item}
              <button type="button" aria-label={`${item} seçimini kaldır`} onClick={() => toggle(item)} className="flex size-5 items-center justify-center rounded-full hover:bg-accent/20">
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      <TextField value={query} onChange={setQuery} aria-label="Birim ara">
        <Input placeholder="Birim ara…" autoComplete="off" />
      </TextField>

      <div className="max-h-56 overflow-y-auto rounded-2xl border border-separator bg-surface p-1.5">
        {FACULTY_GROUPS.map((group) => {
          const items = group.items.filter((item) => !normalized || item.toLocaleLowerCase('tr').includes(normalized))
          if (!items.length) return null
          const selectedCount = group.items.filter((item) => selected.includes(item)).length
          return (
            <details key={group.title} className="group" open={normalized !== '' || selectedCount > 0 || undefined}>
              <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl px-2 py-2 text-sm font-medium hover:bg-default-soft [&::-webkit-details-marker]:hidden">
                <ChevronRight size={14} className="shrink-0 text-muted transition-transform group-open:rotate-90" />
                <span className="flex-1">{group.title}</span>
                {selectedCount > 0 && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent">{selectedCount}</span>}
              </summary>
              <div className="pb-1 pl-4">
                {items.map((item) => (
                  <FilterCheckbox key={item} isSelected={selected.includes(item)} onChange={() => toggle(item)}>
                    {item}
                  </FilterCheckbox>
                ))}
              </div>
            </details>
          )
        })}
      </div>
    </div>
  )
}
