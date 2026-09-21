import { Button, Checkbox } from '@heroui/react'
import { ChevronRight } from 'lucide-react'
import type { Person } from './protocolRules'
import { FACULTY_GROUPS } from './protocolRules'

interface FacultyFilterProps {
  centralAdmins: Person[]
  selectedFaculties: ReadonlySet<string>
  selectedCentral: ReadonlySet<string>
  onToggleFaculty: (faculty: string) => void
  onToggleCentral: (personId: string) => void
  onClear: () => void
}

export function FilterCheckbox({ isSelected, onChange, children }: { isSelected: boolean; onChange: () => void; children: React.ReactNode }) {
  return (
    <Checkbox isSelected={isSelected} onChange={onChange} className="w-full">
      <Checkbox.Content className="flex w-full items-start gap-2.5 rounded-xl px-2 py-1.5 text-sm transition-colors hover:bg-default-soft">
        <Checkbox.Control className="mt-0.5 shrink-0 border border-border">
          <Checkbox.Indicator />
        </Checkbox.Control>
        <span className="min-w-0 flex-1">{children}</span>
      </Checkbox.Content>
    </Checkbox>
  )
}

const SECTION_TITLE = 'px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted'

export function FacultyFilter({ centralAdmins, selectedFaculties, selectedCentral, onToggleFaculty, onToggleCentral, onClear }: FacultyFilterProps) {
  const selectedCount = selectedFaculties.size + selectedCentral.size

  return (
    <div className="flex flex-col gap-4">
      <section>
        <h3 className={SECTION_TITLE}>Rektörlük / Merkez</h3>
        {centralAdmins.length === 0 ? (
          <p className="px-2 text-sm text-muted">Merkezi idare kaydı yok.</p>
        ) : (
          centralAdmins.map((person) => (
            <FilterCheckbox key={person._id} isSelected={selectedCentral.has(person._id)} onChange={() => onToggleCentral(person._id)}>
              <span className="block font-medium leading-snug">{person.name}</span>
              <span className="block text-xs text-muted">{person.title}</span>
            </FilterCheckbox>
          ))
        )}
      </section>

      <section>
        <div className="flex items-center justify-between pb-1">
          <h3 className={SECTION_TITLE}>Fakülte / Birim</h3>
          {selectedCount > 0 && (
            <Button size="sm" variant="ghost" className="h-7 text-xs" onPress={onClear}>
              Temizle ({selectedCount})
            </Button>
          )}
        </div>
        <div className="flex flex-col gap-1">
          {FACULTY_GROUPS.map((group) => {
            const groupSelected = group.items.filter((item) => selectedFaculties.has(item)).length
            return (
              <details key={group.title} className="group rounded-xl" open={groupSelected > 0 || undefined}>
                <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl px-2 py-2 text-sm font-medium transition-colors hover:bg-default-soft [&::-webkit-details-marker]:hidden">
                  <ChevronRight size={14} className="shrink-0 text-muted transition-transform group-open:rotate-90" />
                  <span className="flex-1">{group.title}</span>
                  {groupSelected > 0 && (
                    <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent">{groupSelected}</span>
                  )}
                </summary>
                <div className="pb-1 pl-4">
                  {group.items.map((item) => (
                    <FilterCheckbox key={item} isSelected={selectedFaculties.has(item)} onChange={() => onToggleFaculty(item)}>
                      {item}
                    </FilterCheckbox>
                  ))}
                </div>
              </details>
            )
          })}
        </div>
      </section>
    </div>
  )
}
