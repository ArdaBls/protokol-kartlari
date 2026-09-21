import { Avatar, Tooltip } from '@heroui/react'
import { initials, isSafeAvatarUrl } from '../../lib/roles'

interface StaffProfile {
  displayName?: string
  avatarUrl?: string
}

const normalizeKey = (name: string) => name.trim().toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ')

function findProfile(name: string, profilesByName: Map<string, StaffProfile>): StaffProfile | undefined {
  return profilesByName.get(normalizeKey(name))
}

function parseNames(value?: string): string[] {
  return String(value ?? '').split(',').map((name) => name.trim()).filter(Boolean)
}

/** Aynı kişi hem basın görevlisi hem haber yazarıysa TEK avatar -- rolleri birleştirip gösterir. */
export function AttendeeAvatars({
  gorevli, haberYazanlari, excludeName, profilesByName, size = 24,
}: {
  gorevli?: string
  haberYazanlari?: string
  excludeName?: string
  profilesByName: Map<string, StaffProfile>
  size?: number
}) {
  const excludeKey = excludeName ? normalizeKey(excludeName) : ''
  const byKey = new Map<string, { name: string; roles: string[] }>()
  const add = (list: string | undefined, role: string) => {
    parseNames(list).forEach((name) => {
      const key = normalizeKey(name)
      if (!key || key === excludeKey) return
      const existing = byKey.get(key)
      if (existing) { if (!existing.roles.includes(role)) existing.roles.push(role) }
      else byKey.set(key, { name, roles: [role] })
    })
  }
  add(gorevli, 'Basın görevlisi')
  add(haberYazanlari, 'Haber yazarı')

  if (!byKey.size) return null

  return (
    // Avatarlar üst üste bindirilmiyor (kasıtlı): dairesel görünüm dikdörtgen isabet alanının
    // komşu avatarın üzerine taşmasını engellemez -- kullanıcı bulgusu: "hangisine gelirsem
    // geleyim hep aynısını gösteriyordu". Küçük bir boşlukla yan yana, her biri tam bağımsız.
    <div className="flex gap-1">
      {[...byKey.values()].map(({ name, roles }) => {
        const profile = findProfile(name, profilesByName)
        return (
          <Tooltip.Root key={name} delay={0} closeDelay={0}>
            <Tooltip.Trigger>
              <Avatar size="sm" color="accent" className="ring-2 ring-surface" style={{ width: size, height: size }}>
                {isSafeAvatarUrl(profile?.avatarUrl) && <Avatar.Image src={profile!.avatarUrl} alt="" draggable={false} />}
                <Avatar.Fallback className="text-[10px]">{initials(name)}</Avatar.Fallback>
              </Avatar>
            </Tooltip.Trigger>
            <Tooltip.Content showArrow>{name} · {roles.join(' · ')}</Tooltip.Content>
          </Tooltip.Root>
        )
      })}
    </div>
  )
}
