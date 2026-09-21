const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/

export interface ParsedContact {
  ad: string
  eposta: string
}

/**
 * Outlook'ta kullanılan `'Ad' <eposta>;` biçimindeki listeyi ayrıştırır.
 * Aynı e-posta birden fazla geçiyorsa tek kayıt tutulur; "(eski…)" etiketli isim varsa etiketsiz olan tercih edilir.
 */
export function parsePastedContacts(text: string): ParsedContact[] {
  const byEmail = new Map<string, ParsedContact & { isOld: boolean }>()

  String(text ?? '')
    .split(/;|\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const match = line.match(EMAIL_PATTERN)
      if (!match) return
      // E-posta adresi Türkçe locale ile küçültülmez: "I" harfi "ı"ya dönüşüp adresi bozar.
      const eposta = match[0].toLowerCase()
      // İsim e-postadan önce gelir; "'Ad' <" biçiminde açılış köşeli parantezi ismin SONUNDA kalır.
      const ad = line.slice(0, match.index).replace(/<\s*$/, '').trim().replace(/^'+|'+$/g, '').trim()
      const isOld = /\(\s*eski/i.test(ad)
      const existing = byEmail.get(eposta)
      if (!existing || (existing.isOld && !isOld)) byEmail.set(eposta, { ad: ad || eposta, eposta, isOld })
    })

  return [...byEmail.values()].map(({ ad, eposta }) => ({ ad, eposta }))
}
