import type { ReactNode } from 'react'

interface SettingsSectionProps {
  id: string
  title: string
  description: string
  isDanger?: boolean
  children: ReactNode
}

export function SettingsSection({ id, title, description, isDanger, children }: SettingsSectionProps) {
  return (
    <section
      id={id}
      className={`scroll-mt-24 rounded-3xl bg-surface p-5 shadow-[var(--surface-shadow)] sm:p-6 ${isDanger ? 'ring-1 ring-danger/30' : ''}`}
    >
      <h2 className={`text-lg font-semibold ${isDanger ? 'text-danger' : ''}`}>{title}</h2>
      <p className="mt-1 text-sm text-muted">{description}</p>
      <div className="mt-5 flex flex-col gap-3">{children}</div>
    </section>
  )
}

/** Etiket + açıklama solda, eylem sağda duran ayar satırı. */
export function SettingsRow({ label, description, children, isDanger }: { label: string; description?: ReactNode; children: ReactNode; isDanger?: boolean }) {
  return (
    <div className={`flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between ${isDanger ? 'border-danger/30 bg-danger-soft' : 'border-separator bg-surface-secondary/40'}`}>
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {description && <div className="mt-0.5 text-xs leading-relaxed text-muted">{description}</div>}
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">{children}</div>
    </div>
  )
}

export { SwitchButton } from '../../components/SwitchButton'
