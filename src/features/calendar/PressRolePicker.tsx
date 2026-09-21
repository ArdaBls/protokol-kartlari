import { useState } from 'react'
import { useOwnerPool } from '../gantt/useOwnerPool'

interface PressRolePickerProps {
  gorevli: string[]
  haberYazanlari: string[]
  onToggle: (name: string, role: 'gorevli' | 'haberYazanlari', checked: boolean) => void
}

/** "Basın Görevlisi" / "Haberi Yazan(lar)" -- admin tarafından işaretlenmiş kişiler havuzundan,
 * her kişi için iki bağımsız kutu. Aynı havuzu Üretim Takvimi'ndeki "Sorumlu" seçicisiyle paylaşır. */
export function PressRolePicker({ gorevli, haberYazanlari, onToggle }: PressRolePickerProps) {
  const pool = useOwnerPool()
  const [query, setQuery] = useState('')

  const q = query.trim().toLocaleLowerCase('tr')
  const filtered = pool.filter((p) => p.name.toLocaleLowerCase('tr').includes(q))
  const extraNames = [...new Set([...gorevli, ...haberYazanlari])].filter((name) => !filtered.some((p) => p.name === name))
  const rows = [...extraNames, ...filtered.map((p) => p.name)]

  return (
    <div className="flex flex-col gap-2">
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="İsim ara…"
        autoComplete="off"
        className="h-9 rounded-xl border border-[var(--field-border)] bg-[var(--field-background)] px-3 text-sm outline-none placeholder:text-[var(--field-placeholder)] hover:border-[var(--field-border-hover)] focus-visible:border-[var(--focus)]"
      />
      <div className="flex max-h-52 flex-col gap-1 overflow-y-auto rounded-xl border border-separator p-1.5">
        {!rows.length && <p className="px-2 py-3 text-center text-xs text-muted">{pool.length ? 'Kişi bulunamadı.' : 'Henüz admin tarafından işaretlenmiş basın görevlisi yok.'}</p>}
        {rows.map((name) => (
          <div key={name} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-default">
            <span className="min-w-0 flex-1 truncate">{name}</span>
            <label className="flex shrink-0 items-center gap-1 text-xs text-muted">
              <input type="checkbox" checked={gorevli.includes(name)} onChange={(event) => onToggle(name, 'gorevli', event.target.checked)} className="accent-[var(--accent)]" />
              Basın görevlisi
            </label>
            <label className="flex shrink-0 items-center gap-1 text-xs text-muted">
              <input type="checkbox" checked={haberYazanlari.includes(name)} onChange={(event) => onToggle(name, 'haberYazanlari', event.target.checked)} className="accent-[var(--accent)]" />
              Haberi yazdı
            </label>
          </div>
        ))}
      </div>
    </div>
  )
}
