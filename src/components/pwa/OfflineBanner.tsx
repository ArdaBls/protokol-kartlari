import { WifiOff } from 'lucide-react'
import { useSyncExternalStore } from 'react'

function subscribe(onChange: () => void) {
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}

/** Bağlantı koptuğunda görünür uyarı: ekrandaki veri son eşitlenen hâldir ve yazmalar bağlantı gelince gönderilir. */
export function OfflineBanner() {
  const isOnline = useSyncExternalStore(subscribe, () => navigator.onLine)
  if (isOnline) return null
  return (
    <div role="status" className="flex items-center justify-center gap-2 bg-default px-4 py-2 text-center text-xs font-medium">
      <WifiOff size={14} />
      Çevrimdışısınız — gösterilen veriler son eşitlenen hâl; değişiklikler bağlantı gelince gönderilir.
    </div>
  )
}
