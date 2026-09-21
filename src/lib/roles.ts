export type Role = 'pending' | 'editor' | 'admin' | 'owner'

export interface UserProfile {
  firstName?: string
  lastName?: string
  email?: string
  role?: Role
  blocked?: boolean
  avatarUrl?: string
}

const APPROVED_ROLES: readonly string[] = ['editor', 'admin', 'owner']

export const ROLE_LABEL: Record<Role, string> = {
  pending: 'Onay Bekliyor',
  editor: 'Editör',
  admin: 'Admin',
  owner: 'Kurucu',
}

// Admin/kurucu dışındakilerin menüde görebildiği sekmeler (eski shell-render.js EDITOR_NAV_KEYS).
// Bu bir GÖRÜNÜRLÜK ayarıdır; asıl koruma Firebase güvenlik kurallarındadır.
const EDITOR_NAV_KEYS: readonly string[] = [
  'dashboard', 'dashboard-2', 'calendar', 'map', 'kanban', 'notifications', 'users',
  'press-directory', 'gantt', 'projects', 'project-detail', 'profile', 'settings', 'faq', 'games',
]

export const isApprovedRole = (role?: string): role is Role => !!role && APPROVED_ROLES.includes(role)

export const canSeeNavItem = (role: Role, key: string) =>
  role === 'admin' || role === 'owner' || EDITOR_NAV_KEYS.includes(key)

export const fullName = (profile: Pick<UserProfile, 'firstName' | 'lastName'>) =>
  `${profile.firstName ?? ''} ${profile.lastName ?? ''}`.trim()

// data: yalnızca kendi yüklediğimiz (resizeImageToSquare) base64 JPEG için; https: dış kaynaklar için.
// javascript:/vbscript: gibi başka şemalar img src'ye asla sızmamalı (XSS).
export const isSafeAvatarUrl = (url?: string): url is string => !!url && (/^data:image\//i.test(url) || /^https:\/\//i.test(url))

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toLocaleUpperCase('tr-TR')
}
