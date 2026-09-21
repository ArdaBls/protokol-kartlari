import { X } from 'lucide-react'
import { useState } from 'react'
import { FieldLabel } from '../../components/formControls'
import type { OwnerPoolEntry } from './useOwnerPool'

interface OwnerPickerProps {
  pool: OwnerPoolEntry[]
  value: string
  onChange: (value: string) => void
}

/**
 * Havuzdan (basinGorevlileri) tıklayarak seçilen tek kişi -- serbest metin YAZILAMAZ.
 * Eski kayıtlardaki, havuzda artık olmayan bir isim de chip olarak korunur (veri kaybı olmasın).
 */
export function OwnerPicker({ pool, value, onChange }: OwnerPickerProps) {
  const [query, setQuery] = useState('')
  const [isOpen, setIsOpen] = useState(false)

  const q = query.trim().toLocaleLowerCase('tr')
  const matches = (q ? pool.filter((p) => p.name.toLocaleLowerCase('tr').includes(q)) : pool).slice(0, 8)

  return (
    <div className="flex flex-col gap-1.5">
      <FieldLabel>Sorumlu</FieldLabel>
      {value ? (
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1.5 text-sm text-accent">
          {value}
          <button type="button" onClick={() => onChange('')} aria-label={`${value} kişisini kaldır`} className="rounded-full p-0.5 hover:bg-accent/20">
            <X size={13} />
          </button>
        </span>
      ) : (
        <div className="relative">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onFocus={() => setIsOpen(true)}
            onBlur={() => setTimeout(() => setIsOpen(false), 120)}
            placeholder="Kişi ara…"
            autoComplete="off"
            className="h-10 w-full rounded-[var(--field-radius)] border border-[var(--field-border)] bg-[var(--field-background)] px-4 text-sm text-[var(--field-foreground)] shadow-[var(--field-shadow)] outline-none placeholder:text-[var(--field-placeholder)] hover:border-[var(--field-border-hover)] focus-visible:border-[var(--focus)]"
          />
          {isOpen && (
            <div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-2xl border border-separator bg-surface p-1 shadow-[var(--overlay-shadow)]">
              {matches.length ? (
                matches.map((p) => (
                  <button
                    key={p.uid}
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => { onChange(p.name); setQuery('') }}
                    className="block w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-default"
                  >
                    {p.name}
                  </button>
                ))
              ) : (
                <p className="px-3 py-2 text-sm text-muted">{pool.length ? 'Kişi bulunamadı.' : 'Henüz basın görevlisi işaretlenmedi.'}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
