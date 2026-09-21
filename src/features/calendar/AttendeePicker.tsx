import { useMemo, useState } from 'react'
import { useDbValue } from '../../hooks/useDbValue'
import type { Person, PersonRecord } from '../protocol/protocolRules'
import { toPeopleList } from '../protocol/protocolRules'
import type { Attendee } from './calendarTypes'

interface AttendeePickerProps {
  attendees: Attendee[]
  onChange: (next: Attendee[]) => void
  includeIl: boolean
  onIncludeIlChange: (checked: boolean) => void
}

const mergeKey = (name?: string, unit?: string) => `${(name ?? '').trim().toLocaleLowerCase('tr')}|${(unit ?? '').trim().toLocaleLowerCase('tr')}`
const attendeeKey = (a: { name: string; title?: string }) => `${a.name}|${a.title ?? ''}`

/** Katılımcılar: üniversite protokol kartları + (tik açıksa) İl Protokolü kurumları -- ana
 * sitedeki birleştirme mantığıyla aynı: aktif olmayanlar hariç, aynı ad+birim ikilisinde İl kaydı önceliklidir. */
export function AttendeePicker({ attendees, onChange, includeIl, onIncludeIlChange }: AttendeePickerProps) {
  const [query, setQuery] = useState('')
  const universite = useDbValue<Record<string, PersonRecord | null>>('universiteProtokolVerileri')
  const ilProtokol = useDbValue<Record<string, PersonRecord | null>>('ilProtokolVerileri', { enabled: includeIl })

  const pool = useMemo(() => {
    const universitePeople = toPeopleList(universite.data).filter((p) => (!p.status || p.status === 'aktif') && p.name)
    if (!includeIl) return universitePeople.map((p) => ({ ...p, kaynak: 'universite' as const }))
    const ilPeople = toPeopleList(ilProtokol.data).filter((p) => (!p.status || p.status === 'aktif') && p.name)
    const merged = new Map<string, Person & { kaynak: 'universite' | 'il' }>()
    universitePeople.forEach((p) => merged.set(mergeKey(p.name, p.unit), { ...p, kaynak: 'universite' }))
    ilPeople.forEach((p) => merged.set(mergeKey(p.name, p.unit), { ...p, kaynak: 'il' }))
    return [...merged.values()]
  }, [universite.data, ilProtokol.data, includeIl])

  const q = query.trim().toLocaleLowerCase('tr')
  const filtered = pool
    .filter((p) => `${p.name ?? ''} ${p.title ?? ''} ${p.unit ?? ''}`.toLocaleLowerCase('tr').includes(q))
    .slice(0, 120)
  const filteredKeys = new Set(filtered.map((p) => attendeeKey({ name: p.name ?? '', title: p.title })))
  const selectedElsewhere = attendees.filter((a) => !filteredKeys.has(attendeeKey(a)))

  const toggle = (person: (typeof pool)[number], checked: boolean) => {
    const key = attendeeKey({ name: person.name ?? '', title: person.title })
    if (checked) {
      if (attendees.some((a) => attendeeKey(a) === key)) return
      onChange([...attendees, { prefix: person.prefix ?? '', name: person.name ?? '', title: person.title ?? '', rank: person.rank ?? '', kaynak: person.kaynak }])
    } else {
      onChange(attendees.filter((a) => attendeeKey(a) !== key))
    }
  }
  const removeSelected = (attendee: Attendee) => onChange(attendees.filter((a) => attendeeKey(a) !== attendeeKey(attendee)))

  return (
    <div className="flex flex-col gap-2">
      <label className="flex w-fit items-center gap-1.5 text-xs text-muted">
        <input type="checkbox" checked={includeIl} onChange={(event) => onIncludeIlChange(event.target.checked)} className="accent-[var(--accent)]" />
        İl Protokolünü de dahil et
      </label>
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="İsim veya unvan ara…"
        autoComplete="off"
        className="h-9 rounded-xl border border-[var(--field-border)] bg-[var(--field-background)] px-3 text-sm outline-none placeholder:text-[var(--field-placeholder)] hover:border-[var(--field-border-hover)] focus-visible:border-[var(--focus)]"
      />
      <div className="flex max-h-64 flex-col gap-0.5 overflow-y-auto rounded-xl border border-separator p-1.5">
        {selectedElsewhere.map((a) => (
          <button key={attendeeKey(a)} type="button" onClick={() => removeSelected(a)} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-danger/10">
            <input type="checkbox" checked readOnly className="pointer-events-none accent-[var(--accent)]" />
            <span className="flex-1"><strong>{a.name}</strong> <span className="text-xs text-muted">{a.title}</span></span>
            <span className="text-xs text-muted">kaldır</span>
          </button>
        ))}
        {!filtered.length && !selectedElsewhere.length && <p className="px-2 py-3 text-center text-xs text-muted">Eşleşen kişi yok.</p>}
        {filtered.map((p) => {
          const key = attendeeKey({ name: p.name ?? '', title: p.title })
          const isSelected = attendees.some((a) => attendeeKey(a) === key)
          return (
            <label key={p._id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-default">
              <input type="checkbox" checked={isSelected} onChange={(event) => toggle(p, event.target.checked)} className="accent-[var(--accent)]" />
              <span><strong>{p.name}</strong> <span className="text-xs text-muted">{p.title}</span></span>
            </label>
          )
        })}
      </div>
    </div>
  )
}
