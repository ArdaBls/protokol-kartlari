import { Card } from '@heroui/react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

interface StatCardProps {
  icon: LucideIcon
  iconClass: string
  label: ReactNode
  value: ReactNode
  sub?: ReactNode
  children?: ReactNode
}

export function StatCard({ icon: Icon, iconClass, label, value, sub, children }: StatCardProps) {
  return (
    <Card>
      <Card.Content className="flex flex-row items-start gap-4">
        <span className={`flex size-11 shrink-0 items-center justify-center rounded-2xl ${iconClass}`}>
          <Icon size={22} strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-h-6 items-center gap-1 text-sm text-muted">{label}</div>
          <div className="mt-0.5 truncate text-2xl font-semibold tabular-nums">{value}</div>
          {sub && <div className="mt-0.5 truncate text-xs text-muted">{sub}</div>}
          {children}
        </div>
      </Card.Content>
    </Card>
  )
}
