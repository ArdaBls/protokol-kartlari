import { Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useAuth } from '../../auth/useAuth'
import { useDbValue } from '../../hooks/useDbValue'

interface StaffProfile { displayName?: string }

/** Personel havuzundan (staffProfiles) rakip seçme modalı -- Satranç, Amiral Battı gibi
 * davet tabanlı iki kişilik oyunlarda ortak kullanılır. */
export function StaffInvitePicker({ title, onPick, onClose }: { title: string; onPick: (uid: string, name: string) => void; onClose: () => void }) {
  const { state } = useAuth()
  const staffProfiles = useDbValue<Record<string, StaffProfile | null>>('staffProfiles', { shadow: false })
  const [query, setQuery] = useState('')
  const myUid = state.status === 'ready' ? state.user.uid : ''

  const pool = useMemo(
    () =>
      Object.entries(staffProfiles.data ?? {})
        .flatMap(([uid, p]) => (uid !== myUid && p?.displayName?.trim() ? [{ uid, name: p.displayName.trim() }] : []))
        .sort((a, b) => a.name.localeCompare(b.name, 'tr')),
    [staffProfiles.data, myUid],
  )
  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('tr')
    return (q ? pool.filter((p) => p.name.toLocaleLowerCase('tr').includes(q)) : pool).slice(0, 30)
  }, [pool, query])

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="flex max-h-[70vh] w-full max-w-sm flex-col gap-3 overflow-hidden rounded-2xl bg-surface p-4 shadow-[var(--overlay-shadow)]">
        <h3 className="text-sm font-semibold">{title}</h3>
        <div className="relative">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="İsim ara…"
            className="h-10 w-full rounded-[var(--field-radius)] border border-[var(--field-border)] bg-[var(--field-background)] pl-9 pr-3 text-sm outline-none"
          />
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
          {filtered.length === 0 && <p className="px-2 py-3 text-xs text-muted">Kişi bulunamadı.</p>}
          {filtered.map((p) => (
            <button key={p.uid} type="button" onClick={() => onPick(p.uid, p.name)} className="rounded-lg px-3 py-2 text-left text-sm hover:bg-default">
              {p.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
