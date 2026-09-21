import { Avatar, Button } from '@heroui/react'
import { Bell, ChevronRight, Menu, Moon, Sun } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import { findNavItem } from '../../config/nav'
import { useNotificationBadge } from '../../features/notifications/useNotificationBadge'
import { GAMES } from '../../features/games/gamesList'
import { useTheme } from '../../hooks/useTheme'
import { initials, isSafeAvatarUrl } from '../../lib/roles'

interface TopbarProps {
  onOpenMenu: () => void
}

export function Topbar({ onOpenMenu }: TopbarProps) {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { theme, toggleTheme } = useTheme()
  // Oyun alt sayfaları (/oyunlar/wordle vb.) NAV_ITEMS'ta yok -- breadcrumb'ta jenerik
  // "Sayfa" yerine oyunun kendi adı görünsün diye ayrıca GAMES listesinden aranıyor.
  const navItem = findNavItem(pathname)
  const game = !navItem && pathname.startsWith('/oyunlar/') ? GAMES.find((g) => g.path === pathname) : undefined
  const breadcrumbLabel = navItem?.text ?? game?.title ?? 'Sayfa'
  const { state } = useAuth()
  const displayName = state.status === 'ready' ? state.displayName : ''
  const avatarUrl = state.status === 'ready' ? state.profile.avatarUrl : undefined
  const badgeCount = useNotificationBadge()

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-separator bg-background/80 px-4 backdrop-blur sm:px-6 lg:px-8">
      <Button isIconOnly variant="ghost" className="lg:hidden" aria-label="Menüyü aç" onPress={onOpenMenu}>
        <Menu size={20} />
      </Button>

      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
        <Link to="/" className="text-muted hover:text-foreground">
          Anasayfa
        </Link>
        <ChevronRight size={14} className="shrink-0 text-muted" aria-hidden="true" />
        <span aria-current="page" className="truncate font-medium">
          {breadcrumbLabel}
        </span>
      </nav>

      <div className="ml-auto flex items-center gap-1">
        <Button
          isIconOnly
          variant="ghost"
          aria-label={theme === 'dark' ? 'Açık temaya geç' : 'Koyu temaya geç'}
          onPress={toggleTheme}
        >
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </Button>
        <Button isIconOnly variant="ghost" aria-label={badgeCount > 0 ? `Bildirimler (${badgeCount} okunmamış)` : 'Bildirimler'} className="relative" onPress={() => navigate('/bildirimler')}>
          <Bell size={21} />
          {badgeCount > 0 && (
            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-danger-foreground">
              {badgeCount > 99 ? '99+' : badgeCount}
            </span>
          )}
        </Button>
        <Avatar size="sm" color="accent" className="ml-1">
          {isSafeAvatarUrl(avatarUrl) && <Avatar.Image src={avatarUrl} alt="" draggable={false} />}
          <Avatar.Fallback>{initials(displayName)}</Avatar.Fallback>
        </Avatar>
      </div>
    </header>
  )
}
