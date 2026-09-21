export type DirectoryKind = 'email' | 'phone'

export interface ContactRecord {
  ad?: string
  kurum?: string
  telefon?: string
  eposta?: string
  yildizli?: boolean
  guncellemeTs?: number
}

export type Contact = ContactRecord & { id: string }

export const DIRECTORY_PATHS: Record<DirectoryKind, string> = {
  email: 'basinRehberi',
  phone: 'telefonRehberi',
}

export const DIRECTORY_LABELS: Record<DirectoryKind, { title: string; searchPlaceholder: string; orgLabel: string; hint: string }> = {
  email: {
    title: 'E-posta Listesi',
    searchPlaceholder: 'Ara: isim, kurum, telefon, e-posta',
    orgLabel: 'Kurum / yayın (opsiyonel)',
    hint: 'Yıldız ikonuna basarak sık kullandığınız kişileri işaretleyin — yıldızlılar listenin başında görünür.',
  },
  phone: {
    title: 'Telefon Rehberi',
    searchPlaceholder: 'Ara: isim, ajans/haber sitesi, telefon',
    orgLabel: 'Ajans / haber sitesi',
    hint: 'Bu listedeki kişilere e-posta gönderilmez — yalnızca telefon ve ajans bilgisi tutulur.',
  },
}

/** tel: linki yalnızca rakam ve + kabul eder; kullanıcı numarayı serbest biçimde yazabilir. */
export function telHref(phone?: string): string {
  const digits = String(phone ?? '').replace(/[^\d+]/g, '')
  return digits ? `tel:${digits}` : ''
}

export function sortContacts(contacts: Contact[], query: string, kind: DirectoryKind): Contact[] {
  const q = query.trim().toLocaleLowerCase('tr')
  return contacts
    .filter((contact) => {
      if (!q) return true
      const haystack = [contact.ad, contact.kurum, contact.telefon, kind === 'email' ? contact.eposta : '']
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase('tr')
      return haystack.includes(q)
    })
    .sort((a, b) => Number(!!b.yildizli) - Number(!!a.yildizli) || String(a.ad ?? '').localeCompare(String(b.ad ?? ''), 'tr'))
}
