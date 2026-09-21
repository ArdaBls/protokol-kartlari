import type { LucideIcon } from 'lucide-react'
import {
  Bell,
  CalendarDays,
  CalendarRange,
  CircleHelp,
  Columns3,
  FolderOpen,
  Gamepad2,
  LayoutDashboard,
  Mail,
  Map,
  Settings,
  UserCog,
  UserRound,
  Users,
} from 'lucide-react'

export interface NavItem {
  key: string
  path: string
  text: string
  icon: LucideIcon
}

export interface NavGroup {
  label: string
  items: NavItem[]
}

// Eski panelin (admin-src/src/v4/shell-render.js) NAV yapısının birebir karşılığı.
export const NAV: NavGroup[] = [
  {
    label: 'Genel',
    items: [
      { key: 'dashboard', path: '/', text: 'Operasyonlar', icon: LayoutDashboard },
      { key: 'dashboard-2', path: '/protokol', text: 'Protokol Kartları', icon: FolderOpen },
      { key: 'calendar', path: '/takvim', text: 'Takvim', icon: CalendarDays },
      { key: 'map', path: '/harita', text: 'Harita', icon: Map },
    ],
  },
  {
    label: 'Uygulamalar',
    items: [
      { key: 'kanban', path: '/yapilacaklar', text: 'Yapılacaklar Listesi', icon: Columns3 },
      { key: 'notifications', path: '/bildirimler', text: 'Bildirimler', icon: Bell },
      { key: 'games', path: '/oyunlar', text: 'Oyunlar', icon: Gamepad2 },
    ],
  },
  {
    label: 'Haberler',
    items: [
      { key: 'gantt', path: '/gantt', text: 'Üretim Takvimi', icon: CalendarRange },
    ],
  },
  {
    label: 'Yönetim',
    items: [
      { key: 'users', path: '/kisiler', text: 'Kişiler', icon: Users },
      { key: 'press-directory', path: '/basin-rehberi', text: 'Basın Rehberi', icon: Mail },
      { key: 'user_management', path: '/kullanici-yonetimi', text: 'Kullanıcı yönetimi', icon: UserCog },
      { key: 'profile', path: '/profil', text: 'Profiliniz', icon: UserRound },
      { key: 'settings', path: '/ayarlar', text: 'Ayarlar', icon: Settings },
      { key: 'faq', path: '/yardim-merkezi', text: 'Yardım merkezi', icon: CircleHelp },
    ],
  },
]

export const NAV_ITEMS: NavItem[] = NAV.flatMap((group) => group.items)

export function findNavItem(pathname: string): NavItem | undefined {
  return NAV_ITEMS.find((item) => item.path === pathname)
}
