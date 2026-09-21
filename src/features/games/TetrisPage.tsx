import { ref, serverTimestamp, set } from 'firebase/database'
import { useEffect, useMemo, useRef } from 'react'
import { useAuth } from '../../auth/useAuth'
import { useDbValue } from '../../hooks/useDbValue'
import { dbPathFor, useDbMode } from '../../lib/dbMode'
import { db } from '../../lib/firebase'
import { isApprovedRole } from '../../lib/roles'

interface ScoreEntry {
  name?: string
  score?: number
  ts?: number
}

/** Tetris (chvin/react-tetris, Apache-2.0, Türkçeleştirilmiş -- bkz. THIRD_PARTY_NOTICES.md)
 * kendi sunucumuzda gömülü çalışır, iframe kendi dokümanında olduğu için skoru doğrudan
 * okuyamayız. Oyun bittiğinde iframe içi kod window.parent.postMessage({type:'tetris-gameover',
 * score}) gönderir; burada dinlenip yalnızca kişisel rekor kırılırsa Firebase'e yazılır. */
export function TetrisPage() {
  const { state } = useAuth()
  const { isReadOnly, isTestMode } = useDbMode()
  const scores = useDbValue<Record<string, ScoreEntry | null>>('oyunBasarimlari/tetris')
  const iframeRef = useRef<HTMLIFrameElement>(null)

  const canSave = state.status === 'ready' && isApprovedRole(state.role) && !isReadOnly

  const rows = useMemo(
    () =>
      Object.entries(scores.data ?? {})
        .flatMap(([uid, s]) => (s ? [{ uid, name: s.name || '', score: s.score || 0 }] : []))
        .sort((a, b) => b.score - a.score)
        .slice(0, 20),
    [scores.data],
  )

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!event.data || event.data.type !== 'tetris-gameover') return
      if (!canSave || state.status !== 'ready') return
      const newScore = Number(event.data.score) || 0
      if (newScore <= 0) return
      const uid = state.user.uid
      const prev = scores.data?.[uid]?.score ?? 0
      if (newScore <= prev) return
      set(ref(db, dbPathFor(`oyunBasarimlari/tetris/${uid}`, isTestMode)), {
        name: state.displayName || state.user.email || 'İsimsiz',
        score: newScore,
        ts: serverTimestamp(),
      }).catch((err) => console.error('Tetris skoru kaydedilemedi:', err))
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [canSave, state, isTestMode, scores.data])

  // Kullanıcı bulgusu (eski site): iframe dışına bir kez tıklanınca ok tuşları/SPACE odağı
  // kalıcı olarak kayboluyordu. Fare iframe üzerine her geldiğinde (mouseenter, tıklamadan farklı
  // olarak üst dokümanda güvenilir tetiklenir) programatik odak veriliyor.
  useEffect(() => {
    const el = iframeRef.current
    if (!el) return
    const focusFrame = () => {
      try { el.contentWindow?.focus() } catch { /* aynı origin, sorun olmaz */ }
    }
    el.addEventListener('load', focusFrame)
    el.addEventListener('mouseenter', focusFrame)
    const onVisible = () => { if (!document.hidden) focusFrame() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      el.removeEventListener('load', focusFrame)
      el.removeEventListener('mouseenter', focusFrame)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wider text-muted">Oyunlar</div>
        <h1 className="mt-1 text-2xl font-semibold">Tetris</h1>
      </div>
      <p className="-mt-1 text-xs text-muted">
        Bu oyun kendi sunucumuzda barındırılıyor (dış siteye bağımlı değil). Kaynak:{' '}
        <a href="https://github.com/chvin/react-tetris" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">
          chvin/react-tetris
        </a>{' '}
        (Apache-2.0 lisansı), Türkçeleştirildi.
      </p>

      <div className="flex min-h-0 flex-1 flex-col gap-3 sm:flex-row">
        <div className="min-h-[360px] flex-1 overflow-hidden rounded-2xl border border-separator bg-surface">
          <iframe ref={iframeRef} src="/oyun-tetris/index.html" title="Tetris" loading="lazy" className="size-full border-0" />
        </div>
        <div className="flex max-h-56 w-full shrink-0 flex-col overflow-hidden rounded-2xl border border-separator bg-surface sm:h-auto sm:max-h-none sm:w-64">
          <div className="border-b border-separator px-4 py-3 text-sm font-semibold">🏆 En Yüksek Skorlar</div>
          <div className="flex-1 overflow-y-auto p-2">
            {scores.isLoading && <p className="px-2 py-3 text-xs text-muted">Yükleniyor…</p>}
            {!scores.isLoading && rows.length === 0 && (
              <p className="px-2 py-3 text-xs text-muted">Henüz kimse oynamadı — ilk skoru sen bırak!</p>
            )}
            {rows.map((r, i) => (
              <div
                key={r.uid}
                className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${state.status === 'ready' && r.uid === state.user.uid ? 'bg-accent-soft' : ''}`}
              >
                <span className="w-5 shrink-0 text-xs text-muted tabular-nums">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate">{r.name}</span>
                <span className="shrink-0 font-semibold tabular-nums">{r.score}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
