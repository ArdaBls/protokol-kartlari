import type { LucideIcon } from 'lucide-react'
import { FileJson, FlaskConical, TriangleAlert, UserRound } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useAuth } from '../../auth/useAuth'
import { AccountSection } from './AccountSection'
import { DangerSection } from './DangerSection'
import { JsonSection } from './JsonSection'
import { TestModeSection } from './TestModeSection'

interface SectionLink {
  id: string
  label: string
  icon: LucideIcon
  adminOnly?: boolean
  isDanger?: boolean
}

// Test Modu ve JSON kurumsal veriyi toplu değiştirebildiği için yalnızca admin/kurucuya açıktır (eski panelle aynı kural).
const SECTIONS: SectionLink[] = [
  { id: 'hesap', label: 'Hesap', icon: UserRound },
  { id: 'test-modu', label: 'Test Modu', icon: FlaskConical, adminOnly: true },
  { id: 'json', label: 'JSON', icon: FileJson, adminOnly: true },
  { id: 'tehlikeli', label: 'Tehlikeli bölge', icon: TriangleAlert, isDanger: true },
]

const OBSERVER_MARGIN = '-30% 0px -60% 0px'

export function SettingsPage() {
  const { state } = useAuth()
  const isAdmin = state.status === 'ready' && (state.role === 'admin' || state.role === 'owner')
  const visible = SECTIONS.filter((section) => !section.adminOnly || isAdmin)
  const visibleIds = visible.map((section) => section.id).join(',')
  const [activeId, setActiveId] = useState(visible[0].id)

  // Kaydırırken hangi bölümde olunduğu soldaki menüde vurgulanır.
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => entries.forEach((entry) => { if (entry.isIntersecting) setActiveId(entry.target.id) }),
      { rootMargin: OBSERVER_MARGIN, threshold: 0 },
    )
    visibleIds.split(',').forEach((id) => {
      const element = document.getElementById(id)
      if (element) observer.observe(element)
    })
    return () => observer.disconnect()
  }, [visibleIds])

  const goTo = (id: string) => {
    setActiveId(id)
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-6">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wider text-muted">Çalışma alanı</div>
        <h1 className="mt-1 text-2xl font-semibold">Ayarlar</h1>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <nav aria-label="Ayar bölümleri" className="hidden lg:sticky lg:top-20 lg:flex lg:w-56 lg:shrink-0 lg:flex-col lg:gap-1">
          {visible.map(({ id, label, icon: Icon, isDanger }) => (
            <button
              key={id}
              type="button"
              aria-current={activeId === id ? 'true' : undefined}
              onClick={() => goTo(id)}
              className={`flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm transition-colors ${
                activeId === id ? 'bg-accent-soft font-medium text-accent' : isDanger ? 'text-danger hover:bg-danger-soft' : 'text-foreground/80 hover:bg-default-soft'
              }`}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </nav>

        <div className="flex min-w-0 flex-1 flex-col gap-6">
          <AccountSection />
          {isAdmin && <TestModeSection />}
          {isAdmin && <JsonSection />}
          <DangerSection />
        </div>
      </div>
    </div>
  )
}
