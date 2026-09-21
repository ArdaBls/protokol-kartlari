import { useEffect, useMemo, useRef } from 'react'
import { useAuth } from '../../../auth/useAuth'
import { useDbValue } from '../../../hooks/useDbValue'

interface TableState { durum?: string; koltuklar?: Record<string, unknown> }

/** Unity WebGL istemcisi için site kabuğu ve Firebase durum köprüsü. */
export function BlackjackPage() {
  const { state } = useAuth()
  const user = 'user' in state ? state.user : null
  const frameRef = useRef<HTMLIFrameElement>(null)
  const table = useDbValue<TableState>('oyunBasarimlari/blackjack/masalar/ana-masa')
  const src = useMemo(() => import.meta.env.VITE_BLACKJACK_WEBGL_URL || '/games/blackjack/index.html', [])

  useEffect(() => {
    const frame = frameRef.current?.contentWindow
    if (!frame || !user) return
    frame.postMessage({ type: 'sbs-blackjack-auth', uid: user.uid, displayName: user.displayName || user.email || 'Oyuncu' }, '*')
  }, [user, table.data])

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wider text-muted">Oyunlar</div>
        <h1 className="mt-1 text-2xl font-semibold">Blackjack (21)</h1>
        <p className="mt-1 text-xs text-muted">Masa: {table.data?.durum || 'bağlanıyor'} · Firebase canlı bağlantı</p>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-separator bg-black">
        <iframe ref={frameRef} src={src} title="Blackjack" allow="fullscreen; autoplay" className="size-full border-0" />
      </div>
    </div>
  )
}
