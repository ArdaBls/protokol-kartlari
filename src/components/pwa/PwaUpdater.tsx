import { Button, toast } from '@heroui/react'
import { RefreshCw } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { EASE_OUT } from '../../lib/ease'

// Uzun süre açık kalan sekmeler de yeni sürümü fark etsin diye saatte bir kontrol edilir.
const UPDATE_CHECK_MS = 60 * 60 * 1000

export function PwaUpdater() {
  const registrationRef = useRef<ServiceWorkerRegistration | undefined>(undefined)
  const fallbackReloadRef = useRef<number | undefined>(undefined)
  const [isUpdating, setIsUpdating] = useState(false)
  // GitHub Pages /sw.js için kısa bir HTTP önbelleği gönderir. Kayıt güncellemesini
  // bu önbelleği atlayarak yapmak, "Yeni sürüm hazır" uyarısının eski worker'a
  // takılı kalmasını önler.
  const registerWithoutHttpCache = useCallback(async () => {
    if (!('serviceWorker' in navigator)) return undefined
    const registration = await navigator.serviceWorker.register('/sw.js', {
      scope: '/',
      type: 'classic',
      updateViaCache: 'none',
    })
    registrationRef.current = registration
    await registration.update()
    return registration
  }, [])
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      registrationRef.current = registration
      void registerWithoutHttpCache().catch((err) => console.error('İlk sürüm kontrolü başarısız:', err))
    },
    onRegisterError(error) {
      console.error('Service worker kaydedilemedi:', error)
    },
  })

  useEffect(() => {
    const checkForUpdate = () => {
      const registration = registrationRef.current
      if (registration) {
        registration.update().catch((err) => console.error('Sürüm kontrolü başarısız:', err))
        return
      }
      void registerWithoutHttpCache().catch((err) => console.error('Sürüm kontrolü başarısız:', err))
    }
    const interval = window.setInterval(checkForUpdate, UPDATE_CHECK_MS)
    window.addEventListener('focus', checkForUpdate)
    document.addEventListener('visibilitychange', checkForUpdate)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', checkForUpdate)
      document.removeEventListener('visibilitychange', checkForUpdate)
      if (fallbackReloadRef.current !== undefined) window.clearTimeout(fallbackReloadRef.current)
    }
  }, [registerWithoutHttpCache])

  const refreshToLatest = useCallback(async () => {
    if (isUpdating) return
    setIsUpdating(true)
    try {
      await registerWithoutHttpCache()
      await updateServiceWorker(true)
      // Bazı iOS/PWA sürümlerinde waiting worker mesajı alır fakat sayfayı
      // otomatik yenilemez. Bu geri dönüş, butonun gerçekten etkili olmasını sağlar.
      fallbackReloadRef.current = window.setTimeout(() => window.location.reload(), 2500)
    } catch (err) {
      console.error('Yeni sürüm etkinleştirilemedi:', err)
      window.location.reload()
    }
  }, [isUpdating, registerWithoutHttpCache, updateServiceWorker])

  useEffect(() => {
    if (!offlineReady) return
    toast.success('Uygulama çevrimdışı kullanıma hazır.')
    setOfflineReady(false)
  }, [offlineReady, setOfflineReady])

  return (
    <AnimatePresence>
      {needRefresh && (
        <motion.div
          initial={{ y: 60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 60, opacity: 0 }}
          transition={{ duration: 0.35, ease: EASE_OUT }}
          role="status"
          className="fixed bottom-4 left-4 right-4 z-50 mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-overlay p-3 pl-4 text-overlay-foreground shadow-[var(--overlay-shadow)] sm:left-auto sm:right-6"
        >
          <RefreshCw size={18} className="shrink-0 text-accent" />
          <span className="flex-1 text-sm">Yeni sürüm hazır.</span>
          <Button size="sm" variant="ghost" onPress={() => setNeedRefresh(false)}>Sonra</Button>
          <Button size="sm" variant="primary" isPending={isUpdating} onPress={() => void refreshToLatest()}>Yenile</Button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
