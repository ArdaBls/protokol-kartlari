import { toast } from '@heroui/react'
import { useEffect } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

export function PwaUpdater() {
  const {
    offlineReady: [offlineReady, setOfflineReady],
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      // Yeni worker sessizce bekler; kullanıcı sayfayı kendisi yenilediğinde
      // tarayıcı yeni sürümü devreye alır. Böylece polling kaynaklı uyarı
      // tekrar tekrar görünmez ve açık çalışma sırasında ekran değişmez.
      registration?.update().catch((err) => console.error('Sürüm kontrolü başarısız:', err))
    },
    onRegisterError(error) {
      console.error('Service worker kaydedilemedi:', error)
    },
  })

  useEffect(() => {
    if (!offlineReady) return
    toast.success('Uygulama çevrimdışı kullanıma hazır.')
    setOfflineReady(false)
  }, [offlineReady, setOfflineReady])

  return null
}
