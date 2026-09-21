import { Avatar, Button } from '@heroui/react'
import { LogOut, X } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import { NAV } from '../../config/nav'
import { ROLE_LABEL, canSeeNavItem, initials, isSafeAvatarUrl } from '../../lib/roles'

interface SidebarProps {
  isMobileOpen: boolean
  isCollapsed: boolean
  onClose: () => void
}

export function Sidebar({ isMobileOpen, isCollapsed, onClose }: SidebarProps) {
  const { state, signOutUser } = useAuth()
  if (state.status !== 'ready') return null

  const groups = NAV.map((group) => ({ ...group, items: group.items.filter((item) => canSeeNavItem(state.role, item.key)) }))
    .filter((group) => group.items.length > 0)

  return (
    <>
      {isMobileOpen && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={onClose} aria-hidden="true" />}
      <aside
        aria-label="Ana menü"
        style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
        className={`fixed inset-y-0 left-0 z-40 flex flex-col border-r border-separator bg-surface transition-[width,transform] duration-200 lg:translate-x-0 ${isCollapsed ? 'w-64 lg:w-20' : 'w-64'} ${
          isMobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className={`flex h-16 items-center justify-between px-5 ${isCollapsed ? 'lg:justify-center lg:px-0' : ''}`}>
          <NavLink to="/" className={`flex items-center gap-2.5 ${isCollapsed ? 'lg:justify-center' : ''}`} onClick={onClose}>
            <img src="/icons/icon-192.png" alt="" className="size-8" />
            <span className={isCollapsed ? 'lg:hidden' : 'text-base font-semibold'}>Protokol</span>
          </NavLink>
          <Button isIconOnly size="sm" variant="ghost" className="lg:hidden" aria-label="Menüyü kapat" onPress={onClose}>
            <X size={18} />
          </Button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 pb-4">
          {groups.map((group) => (
            <div key={group.label} className="mt-4 first:mt-1">
              <div className={`px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted ${isCollapsed ? 'lg:hidden' : ''}`}>{group.label}</div>
              {group.items.map(({ key, path, text, icon: Icon }) => (
                <NavLink
                  key={key}
                  to={path}
                  end
                  onClick={onClose}
                  title={isCollapsed ? text : undefined}
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors ${isCollapsed ? 'lg:justify-center' : ''} ${
                      isActive ? 'bg-accent-soft font-medium text-accent' : 'text-foreground/80 hover:bg-default hover:text-foreground'
                    }`
                  }
                >
                  <Icon size={18} strokeWidth={1.75} />
                  <span className={`truncate ${isCollapsed ? 'lg:hidden' : ''}`}>{text}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="border-t border-separator p-3">
          <div className={`flex items-center gap-3 rounded-xl px-2 py-2 ${isCollapsed ? 'lg:justify-center lg:px-0' : ''}`}>
            <Avatar size="sm" color="accent">
              {isSafeAvatarUrl(state.profile.avatarUrl) && <Avatar.Image src={state.profile.avatarUrl} alt="" draggable={false} />}
              <Avatar.Fallback>{initials(state.displayName)}</Avatar.Fallback>
            </Avatar>
            <div className={`min-w-0 flex-1 ${isCollapsed ? 'lg:hidden' : ''}`}>
              <div className="truncate text-sm font-medium">{state.displayName}</div>
              <div className="text-xs text-muted">{ROLE_LABEL[state.role]}</div>
            </div>
            <Button isIconOnly size="sm" variant="ghost" aria-label="Çıkış yap" onPress={() => signOutUser()}>
              <LogOut size={16} />
            </Button>
          </div>
        </div>
      </aside>
    </>
  )
}
