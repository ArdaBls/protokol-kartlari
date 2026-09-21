import { Card } from '@heroui/react'
import type { Achievement } from './achievements'
import { ACHIEVEMENTS } from './achievements'

interface AchievementsCardProps {
  earned: Record<string, number>
}

function formatEarnedDate(ts?: number): string {
  if (!ts) return ''
  const date = new Date(ts)
  if (Number.isNaN(date.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(date.getDate())}.${p(date.getMonth() + 1)}.${date.getFullYear()}`
}

function BadgeTile({ achievement, earnedAt }: { achievement: Achievement; earnedAt: number }) {
  return (
    <div title={achievement.aciklama} className="flex flex-col items-center gap-1.5 rounded-2xl border border-separator bg-surface-secondary/40 p-3 text-center">
      <img src={achievement.icon} alt="" loading="lazy" className="size-11 object-contain" />
      <div className="text-xs font-semibold leading-tight">{achievement.ad}</div>
      <div className="text-[10px] text-muted">{formatEarnedDate(earnedAt)}</div>
    </div>
  )
}

export function AchievementsCard({ earned }: AchievementsCardProps) {
  const earnedList = ACHIEVEMENTS.filter((a) => earned[a.id])

  return (
    <Card>
      <Card.Header className="flex items-center justify-between">
        <div>
          <Card.Title>Başarılar</Card.Title>
          <Card.Description>{earnedList.length} / {ACHIEVEMENTS.length} başarım kazanıldı</Card.Description>
        </div>
      </Card.Header>
      <Card.Content>
        {earnedList.length ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {earnedList.map((achievement) => (
              <BadgeTile key={achievement.id} achievement={achievement} earnedAt={earned[achievement.id]} />
            ))}
          </div>
        ) : (
          <p className="py-4 text-center text-sm text-muted">Henüz kazanılmış bir başarım yok.</p>
        )}
      </Card.Content>
    </Card>
  )
}
