import { toast } from '@heroui/react'

export async function copyToClipboard(text: string): Promise<void> {
  if (!text.trim()) {
    toast.danger('Kopyalanacak metin yok.')
    return
  }
  try {
    await navigator.clipboard.writeText(text)
    toast.success('Panoya kopyalandı.')
  } catch (err) {
    console.error('Panoya kopyalanamadı:', err)
    toast.danger('Kopyalanamadı, metni elle seçip kopyalayın.')
  }
}

export function downloadJson(data: unknown, fileName: string): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}
