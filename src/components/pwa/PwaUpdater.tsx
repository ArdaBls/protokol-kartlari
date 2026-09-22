import { Button, toast } from '@heroui/react'
import { RefreshCw, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { EASE_OUT } from '../../lib/ease'

export function PwaUpdater() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      // Yeni worker sessizce bekler; kullanıcı sayfayı kendisi yenilediğinde
      // tarayıcı yeni sürümü devreye alır. Bu kontrol yalnızca hatırlatma üretir.
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
          <span className="flex-1 text-sm">Yeni sürüm hazır. Sayfayı yenilediğinde uygulanır.</span>
          <Button
            isIconOnly
            size="sm"
            variant="ghost"
            aria-label="Sürüm bildirimini kapat"
            className="size-8 min-w-8"
            onPress={() => setNeedRefresh(false)}
          >
            <X size={16} />
          </Button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
