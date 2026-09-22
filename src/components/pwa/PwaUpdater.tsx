import { Button, toast } from '@heroui/react'
import { RefreshCw } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { EASE_OUT } from '../../lib/ease'

const UPDATE_CHECK_MS = 15 * 1000
const VERSION_INFO_URL = '/build-info.json'
const CURRENT_VERSION = __APP_VERSION__

type BuildInfo = {
  version?: unknown
}

function waitForInstalledWorker(registration: ServiceWorkerRegistration) {
  if (registration.waiting) return Promise.resolve(registration.waiting)

  const installing = registration.installing
  if (!installing) return Promise.resolve<ServiceWorker | undefined>(undefined)

  return new Promise<ServiceWorker | undefined>((resolve) => {
    const finish = () => {
      if (installing.state === 'installed') {
        installing.removeEventListener('statechange', finish)
        resolve(registration.waiting ?? installing)
      }
      if (installing.state === 'redundant') {
        installing.removeEventListener('statechange', finish)
        resolve(undefined)
      }
    }
    installing.addEventListener('statechange', finish)
    finish()
  })
}

export function PwaUpdater() {
  const registrationRef = useRef<ServiceWorkerRegistration | undefined>(undefined)
  const fallbackReloadRef = useRef<number | undefined>(undefined)
  const latestVersionRef = useRef<string | undefined>(undefined)
  const dismissedVersionRef = useRef<string | undefined>(undefined)
  const isCheckingReleaseRef = useRef(false)
  const [isUpdating, setIsUpdating] = useState(false)
  const [publishedUpdateAvailable, setPublishedUpdateAvailable] = useState(false)
  // GitHub Pages, /sw.js dosyasını birkaç dakika HTTP önbelleğinde tutabilir.
  // Sürüm numarası URL'nin parçası olduğunda aynı worker kesin olarak ağdan gelir.
  const registerReleaseWorker = useCallback(async (version = CURRENT_VERSION) => {
    if (!('serviceWorker' in navigator)) return undefined
    const registration = await navigator.serviceWorker.register(`/sw.js?release=${encodeURIComponent(version)}`, {
      scope: '/',
      type: 'classic',
      updateViaCache: 'none',
    })
    registrationRef.current = registration
    await registration.update()
    return registration
  }, [])

  // build-info.json, service worker önbelleğine takılmayan küçük yayın işaretidir.
  // Her sorguda URL değiştiği için GitHub Pages CDN'i de güncel dosyayı verir.
  const checkPublishedRelease = useCallback(async () => {
    if (isCheckingReleaseRef.current) return
    isCheckingReleaseRef.current = true
    try {
      const url = new URL(VERSION_INFO_URL, window.location.origin)
      url.searchParams.set('check', String(Date.now()))
      const response = await fetch(url, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
      })
      if (!response.ok) return

      const info = await response.json() as BuildInfo
      if (typeof info.version !== 'string' || !info.version || info.version === CURRENT_VERSION) {
        latestVersionRef.current = undefined
        setPublishedUpdateAvailable(false)
        return
      }

      latestVersionRef.current = info.version
      if (dismissedVersionRef.current !== info.version) setPublishedUpdateAvailable(true)
    } catch (err) {
      console.error('Yayınlanan sürüm kontrol edilemedi:', err)
    } finally {
      isCheckingReleaseRef.current = false
    }
  }, [])

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      registrationRef.current = registration
      void registerReleaseWorker().catch((err) => console.error('İlk sürüm kontrolü başarısız:', err))
    },
    onRegisterError(error) {
      console.error('Service worker kaydedilemedi:', error)
    },
  })

  useEffect(() => {
    const checkForUpdate = () => {
      void checkPublishedRelease()
      const registration = registrationRef.current
      if (registration) {
        registration.update().catch((err) => console.error('Sürüm kontrolü başarısız:', err))
        return
      }
      void registerReleaseWorker().catch((err) => console.error('Sürüm kontrolü başarısız:', err))
    }

    const checkWhenVisible = () => {
      if (document.visibilityState === 'visible') checkForUpdate()
    }

    checkForUpdate()
    const interval = window.setInterval(checkForUpdate, UPDATE_CHECK_MS)
    window.addEventListener('focus', checkForUpdate)
    document.addEventListener('visibilitychange', checkWhenVisible)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', checkForUpdate)
      document.removeEventListener('visibilitychange', checkWhenVisible)
      if (fallbackReloadRef.current !== undefined) window.clearTimeout(fallbackReloadRef.current)
    }
  }, [checkPublishedRelease, registerReleaseWorker])

  const refreshToLatest = useCallback(async () => {
    if (isUpdating) return
    setIsUpdating(true)
    try {
      const registration = await registerReleaseWorker(latestVersionRef.current)
      const reloadOnControllerChange = () => {
        if (fallbackReloadRef.current !== undefined) window.clearTimeout(fallbackReloadRef.current)
        window.location.reload()
      }
      navigator.serviceWorker.addEventListener('controllerchange', reloadOnControllerChange, { once: true })

      const waitingWorker = registration ? await waitForInstalledWorker(registration) : undefined
      if (waitingWorker) waitingWorker.postMessage({ type: 'SKIP_WAITING' })
      else await updateServiceWorker(true)

      // Bazı iOS/PWA sürümlerinde controllerchange olayı gecikebilir. Butonun
      // mutlaka sonuç vermesi için kısa bir geri dönüş yenilemesi bırakılır.
      fallbackReloadRef.current = window.setTimeout(() => window.location.reload(), 2500)
    } catch (err) {
      console.error('Yeni sürüm etkinleştirilemedi:', err)
      window.location.reload()
    }
  }, [isUpdating, registerReleaseWorker, updateServiceWorker])

  const dismissUpdate = useCallback(() => {
    dismissedVersionRef.current = latestVersionRef.current
    setPublishedUpdateAvailable(false)
    setNeedRefresh(false)
  }, [setNeedRefresh])

  useEffect(() => {
    if (!offlineReady) return
    toast.success('Uygulama çevrimdışı kullanıma hazır.')
    setOfflineReady(false)
  }, [offlineReady, setOfflineReady])

  return (
    <AnimatePresence>
      {(needRefresh || publishedUpdateAvailable) && (
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
          <Button size="sm" variant="ghost" onPress={dismissUpdate}>Sonra</Button>
          <Button size="sm" variant="primary" isPending={isUpdating} onPress={() => void refreshToLatest()}>Yenile</Button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
