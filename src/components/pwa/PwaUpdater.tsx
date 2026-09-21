import { Button, toast } from '@heroui/react'
import { RefreshCw } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { EASE_OUT } from '../../lib/ease'

// Uzun süre açık kalan sekmeler de yeni sürümü fark etsin diye saatte bir kontrol edilir.
const UPDATE_CHECK_MS = 60 * 60 * 1000

export function PwaUpdater() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (registration) setInterval(() => registration.update().catch((err) => console.error('Sürüm kontrolü başarısız:', err)), UPDATE_CHECK_MS)
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
          <Button size="sm" variant="primary" onPress={() => updateServiceWorker(true)}>Yenile</Button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
