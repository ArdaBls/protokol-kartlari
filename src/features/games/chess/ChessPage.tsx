import { Chessground } from 'chessground'
import 'chessground/assets/chessground.base.css'
import 'chessground/assets/chessground.brown.css'
import 'chessground/assets/chessground.cburnett.css'
import type { Api as ChessgroundApi } from 'chessground/api'
import type { Key } from 'chessground/types'
import { Chess } from 'chess.js'
import { Button, toast } from '@heroui/react'
import { push, ref, runTransaction, serverTimestamp, update } from 'firebase/database'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../../auth/useAuth'
import { useDbValue } from '../../../hooks/useDbValue'
import { dbPathFor } from '../../../lib/dbMode'
import { db } from '../../../lib/firebase'
import { useGameWriteAccess } from '../useGameWriteAccess'
import { patchGame, sameGameState } from '../gameMutations'
import { applyChessMove, chessFromGame, claimChessRematch, hamleListesi, myColor, type ChessGame, type Durum, type Renk } from './chessLogic'
import { StaffInvitePicker } from '../StaffInvitePicker'

const colorLabel = (c: Renk) => (c === 'w' ? 'Beyaz' : 'Siyah')

function toDests(chess: Chess): Map<string, string[]> {
  const dests = new Map<string, string[]>()
  chess.moves({ verbose: true }).forEach((m) => {
    const arr = dests.get(m.from) ?? []
    arr.push(m.to)
    dests.set(m.from, arr)
  })
  return dests
}

const DURUM_LABEL: Record<Durum, string> = { davet_edildi: 'Davet bekleniyor', oynaniyor: 'Oynanıyor', bitti: 'Bitti', iptal: 'İptal edildi' }
const PROMO_PIECES: Array<[string, string]> = [['q', '♕'], ['r', '♖'], ['b', '♗'], ['n', '♘']]

// ── Lobi (davet listesi) ──
function ChessLobby() {
  const { state } = useAuth()
  const { isTestMode, canWrite, isCurrent } = useGameWriteAccess()
  const games = useDbValue<Record<string, ChessGame | null>>('satranc')
  const [, setSearchParams] = useSearchParams()
  const [showInvite, setShowInvite] = useState(false)

  const canPlay = canWrite
  const myUid = state.status === 'ready' ? state.user.uid : ''
  const myName = state.status === 'ready' ? (state.displayName || state.user.email || '') : ''

  const myGames = useMemo(
    () =>
      Object.entries(games.data ?? {})
        .flatMap(([id, g]) => (g && (g.beyazUid === myUid || g.siyahUid === myUid) ? [{ ...g, _id: id }] : []))
        .sort((a, b) => (b.guncellemeTs ?? 0) - (a.guncellemeTs ?? 0)),
    [games.data, myUid],
  )

  const createGame = async (opponentUid: string, opponentName: string) => {
    setShowInvite(false)
    const context = { uid: myUid, isTestMode }
    if (!isCurrent(context) || opponentUid === myUid) return
    const id = push(ref(db, dbPathFor('satranc', isTestMode))).key
    if (!id) return
    const game: ChessGame = {
      beyazUid: myUid, beyazAd: myName, siyahUid: opponentUid, siyahAd: opponentName,
      fen: new Chess().fen(), sira: 'w', durum: 'davet_edildi', sonuc: null, sonNot: '', beraberlikTeklifEden: null,
    }
    const updates: Record<string, unknown> = {
      [`${dbPathFor('satranc', isTestMode)}/${id}`]: { ...game, olusturmaTs: serverTimestamp(), guncellemeTs: serverTimestamp() },
    }
    try {
      const key = push(ref(db, dbPathFor(`notifications/${opponentUid}`, isTestMode))).key
      if (key) updates[`${dbPathFor(`notifications/${opponentUid}`, isTestMode)}/${key}`] = {
        type: 'chess_invite', title: 'Satranç daveti', message: `${myName} sizi bir satranç oyununa davet etti.`,
        relatedGameId: id, createdAt: serverTimestamp(), read: false,
      }
      if (!isCurrent(context)) return
      await update(ref(db), updates)
      if (isCurrent(context)) setSearchParams({ oyun: id })
    } catch (err) {
      console.error('Oyun oluşturulamadı:', err)
      toast.danger('Oyun oluşturulamadı.')
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wider text-muted">Oyunlar</div>
        <h1 className="mt-1 text-2xl font-semibold">Satranç</h1>
      </div>
      {canPlay && (
        <Button variant="primary" className="w-fit" onPress={() => setShowInvite(true)}>Yeni Oyun</Button>
      )}
      <div className="flex flex-col rounded-2xl border border-separator bg-surface">
        <div className="border-b border-separator px-4 py-3 text-sm font-semibold">Oyunlarım {myGames.length > 0 && `(${myGames.length})`}</div>
        {games.isLoading && <p className="px-4 py-6 text-sm text-muted">Yükleniyor…</p>}
        {!games.isLoading && myGames.length === 0 && <p className="px-4 py-6 text-sm text-muted">Henüz oyununuz yok.</p>}
        {myGames.map((g) => {
          const rakip = g.beyazUid === myUid ? g.siyahAd : g.beyazAd
          return (
            <Link
              key={g._id}
              to={`/oyunlar/satranc?oyun=${encodeURIComponent(g._id)}`}
              className="flex items-center justify-between gap-3 border-b border-separator px-4 py-3 text-sm last:border-b-0 hover:bg-default"
            >
              <span>vs {rakip || '(bilinmiyor)'}</span>
              <span className="text-xs text-muted">{DURUM_LABEL[g.durum ?? 'davet_edildi']}</span>
            </Link>
          )
        })}
      </div>
      {showInvite && <StaffInvitePicker title="Kime davet göndereyim?" onPick={createGame} onClose={() => setShowInvite(false)} />}
    </div>
  )
}

// ── Oyun ekranı ──
function ChessGameView({ gameId }: { gameId: string }) {
  const { state } = useAuth()
  const { isTestMode, canWrite, isCurrent } = useGameWriteAccess()
  const gameData = useDbValue<ChessGame>(`satranc/${gameId}`)
  const [, setSearchParams] = useSearchParams()

  const boardElRef = useRef<HTMLDivElement>(null)
  const cgRef = useRef<ChessgroundApi | null>(null)
  const chessRef = useRef(new Chess())
  const [promoColor, setPromoColor] = useState<Renk | null>(null)
  const promoResolveRef = useRef<((piece: string) => void) | null>(null)
  const [reviewIndex, setReviewIndex] = useState(0)
  const pendingRef = useRef(false)
  const [pending, setPending] = useState(false)
  const [boardRevision, setBoardRevision] = useState(0)

  const myUid = state.status === 'ready' ? state.user.uid : ''
  const game = gameData.data
  const mine = myColor(game ?? null, myUid)

  const path = (p: string) => dbPathFor(p, isTestMode)
  const gameRef = ref(db, path(`satranc/${gameId}`))

  const submitChange = async (change: (current: ChessGame | null) => ChessGame | undefined) => {
    const context = { uid: myUid, isTestMode }
    if (!isCurrent(context) || !mine || pendingRef.current) return
    pendingRef.current = true
    setPending(true)
    try {
      const result = await runTransaction(gameRef, (current: ChessGame | null) => {
        if (!isCurrent(context)) return
        return change(current)
      }, { applyLocally: false })
      if (!result.committed && isCurrent(context)) toast.info('Oyun değişti; güncel durumdan tekrar deneyin.')
    } catch (err) {
      console.error('Oyun kaydedilemedi:', err)
      toast.danger('Oyun kaydedilemedi.')
    } finally {
      pendingRef.current = false
      setPending(false)
      setBoardRevision((n) => n + 1)
    }
  }

  const conditionalUpdate = (patch: Record<string, unknown>) => submitChange((current) => {
    if (!current || !sameGameState(current, game) || !myColor(current, myUid)) return
    return patchGame(current, patch)
  })

  const finalizeMove = (orig: string, dest: string, promotion?: string) => {
    if (!game) return
    const expected = game
    void submitChange((current) => applyChessMove(current, expected, myUid,
      { from: orig, to: dest, promotion: promotion || null }, Date.now()))
  }

  const onUserMoveRef = useRef((_orig: string, _dest: string) => {})
  onUserMoveRef.current = (orig, dest) => {
    if (!isCurrent({ uid: myUid, isTestMode }) || pendingRef.current || !mine || game?.durum !== 'oynaniyor') {
      setBoardRevision((n) => n + 1)
      return
    }
    const chess = chessRef.current
    const moves = chess.moves({ square: orig as never, verbose: true })
    const match = moves.find((m) => m.to === dest)
    if (!match) { cgRef.current?.set({ fen: chess.fen() }); return }
    if (match.promotion) {
      setPromoColor(chess.turn())
      promoResolveRef.current = (piece) => finalizeMove(orig, dest, piece)
      return
    }
    finalizeMove(orig, dest)
  }

  // Tahtayı bir kez kur.
  useEffect(() => {
    if (!boardElRef.current || cgRef.current) return
    cgRef.current = Chessground(boardElRef.current, {
      coordinates: true,
      highlight: { lastMove: true, check: true },
      movable: { free: false, dests: new Map(), showDests: true, events: { after: (o, d) => onUserMoveRef.current(o, d) } },
      premovable: { enabled: true, showDests: true },
      draggable: { enabled: true, showGhost: true },
    })
    return () => { cgRef.current?.destroy(); cgRef.current = null }
  }, [])

  const reviewData = useMemo(() => {
    if (!game || game.durum !== 'bitti') return null
    const c = new Chess()
    const fens = [c.fen()]
    const lastMoves: Array<[Key, Key] | null> = [null]
    try { hamleListesi(game).forEach((m) => {
      const res = c.move({ from: m.from, to: m.to, promotion: m.promotion || 'q' })
      fens.push(c.fen())
      lastMoves.push(res ? [res.from as Key, res.to as Key] : lastMoves[lastMoves.length - 1])
    }) } catch { return { fens: [game.fen || new Chess().fen()], lastMoves: [null] } }
    return { fens, lastMoves }
  }, [game])

  useEffect(() => { if (reviewData) setReviewIndex(reviewData.fens.length - 1) }, [reviewData])

  // Firebase'den gelen her güncellemede tahtayı senkronla.
  useEffect(() => {
    if (!game || !cgRef.current) return
    const cg = cgRef.current
    if (reviewData) {
      const fen = reviewData.fens[Math.min(reviewIndex, reviewData.fens.length - 1)]
      const c = new Chess(fen)
      cg.set({
        fen, lastMove: reviewData.lastMoves[reviewIndex] ?? undefined,
        check: c.inCheck() ? (c.turn() === 'w' ? 'white' : 'black') : false,
        viewOnly: true, movable: { free: false, color: undefined, dests: new Map() },
      })
      return
    }
    let chess: Chess
    try { chess = chessFromGame(game) } catch { cg.set({ viewOnly: true }); return }
    chessRef.current = chess
    const active = game.durum === 'oynaniyor' && canWrite && !pending
    const isMyTurn = active && !!mine && chess.turn() === mine
    const canInteract = active && !!mine
    const liste = hamleListesi(game)
    const last = liste[liste.length - 1]
    if (!active) { cg.cancelPremove(); setPromoColor(null); promoResolveRef.current = null }
    cg.set({
      premovable: { enabled: active },
      fen: game.fen,
      orientation: mine === 'b' ? 'black' : 'white',
      turnColor: chess.turn() === 'w' ? 'white' : 'black',
      check: chess.inCheck() ? (chess.turn() === 'w' ? 'white' : 'black') : false,
      lastMove: last ? [last.from as Key, last.to as Key] : undefined,
      viewOnly: !canInteract,
      movable: {
        free: false,
        color: canInteract ? (mine === 'w' ? 'white' : 'black') : undefined,
        dests: isMyTurn ? toDests(chess) : new Map(),
        showDests: true,
      },
    })
    if (isMyTurn) cg.playPremove()
  }, [game, mine, reviewData, reviewIndex, canWrite, pending, boardRevision])

  // Claim the child ID first. Concurrent tabs and interrupted creation reuse that ID.
  const rematchData = useDbValue<ChessGame>(`satranc/${game?.yeniOyunId || '_'}`, { enabled: !!game?.yeniOyunId })
  useEffect(() => {
    if (!game || !canWrite || game.durum !== 'bitti' || !game.yenidenOynaBeyaz || !game.yenidenOynaSiyah || mine !== 'b') return
    const context = { uid: myUid, isTestMode }
    void (async () => {
      const candidate = push(ref(db, path('satranc'))).key
      if (!candidate) return
      const claimed = await runTransaction(gameRef, (current: ChessGame | null) =>
        isCurrent(context) ? claimChessRematch(current, myUid, candidate) : undefined, { applyLocally: false })
      const parent = claimed.snapshot.val() as ChessGame | null
      if (!parent?.yeniOyunId || !isCurrent(context) || parent.siyahUid !== myUid) return
      const next: ChessGame = {
        beyazUid: parent.siyahUid, beyazAd: parent.siyahAd || '', siyahUid: parent.beyazUid, siyahAd: parent.beyazAd || '',
        fen: new Chess().fen(), sira: 'w', durum: 'oynaniyor', sonNot: '',
      }
      await runTransaction(ref(db, path(`satranc/${parent.yeniOyunId}`)), (current) =>
        !current && isCurrent(context) ? { ...next, olusturmaTs: serverTimestamp(), guncellemeTs: serverTimestamp() } : undefined,
      { applyLocally: false })
    })().catch((err) => { console.error('Yeniden oyun başlatılamadı:', err); toast.danger('Yeni oyun açılamadı; sayfayı yenileyerek tekrar deneyin.') })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, mine, canWrite, myUid, isTestMode, isCurrent])

  useEffect(() => {
    if (!game?.yeniOyunId || !rematchData.data) return
    const timer = setTimeout(() => setSearchParams({ oyun: game.yeniOyunId! }), 500)
    return () => clearTimeout(timer)
  }, [game?.yeniOyunId, rematchData.data, setSearchParams])

  const guard = (fn: () => void) => () => {
    if (!isCurrent({ uid: myUid, isTestMode }) || pendingRef.current) { toast.danger('Oyun şu anda değiştirilemiyor.'); return }
    fn()
  }

  const chess = chessRef.current
  let statusText = gameData.isLoading ? 'Yükleniyor…' : !game ? 'Oyun bulunamadı.' : ''
  let actions: React.ReactNode = null

  if (game) {
  if (game.durum === 'davet_edildi') {
    if (mine === 'b') {
      statusText = `${game.beyazAd || 'Rakip'} sizi satranç oynamaya davet etti.`
      actions = (
        <>
          <Button variant="primary" size="sm" onPress={guard(() => conditionalUpdate({ durum: 'oynaniyor', guncellemeTs: serverTimestamp() }))}>Kabul Et</Button>
          <Button variant="secondary" size="sm" onPress={guard(() => conditionalUpdate({ durum: 'iptal', sonNot: 'Davet reddedildi', guncellemeTs: serverTimestamp() }))}>Reddet</Button>
        </>
      )
    } else if (mine === 'w') {
      statusText = `${game.siyahAd || 'Rakibiniz'} daveti kabul etmesini bekliyor…`
      actions = <Button variant="secondary" size="sm" onPress={guard(() => conditionalUpdate({ durum: 'iptal', sonNot: 'Davet iptal edildi', guncellemeTs: serverTimestamp() }))}>Daveti İptal Et</Button>
    } else {
      statusText = 'Bu davet size ait değil.'
    }
  } else if (game.durum === 'oynaniyor') {
    if (chess.isCheckmate() || chess.isDraw()) statusText = 'Oyun bitiyor…'
    else if (chess.inCheck()) statusText = `${colorLabel(chess.turn())} ŞAH altında.`
    else statusText = mine ? (chess.turn() === mine ? 'Sizin sıranız.' : 'Rakibin sırası.') : `${colorLabel(chess.turn())} oynuyor (izleyicisiniz).`

    if (mine && game.beraberlikTeklifEden && game.beraberlikTeklifEden !== mine) {
      statusText = `${mine === 'w' ? game.siyahAd : game.beyazAd} beraberlik teklif ediyor.`
      actions = (
        <>
          <Button variant="primary" size="sm" onPress={guard(() => conditionalUpdate({ durum: 'bitti', sonuc: 'beraberlik', sonNot: 'Karşılıklı anlaşma', beraberlikTeklifEden: null, guncellemeTs: serverTimestamp() }))}>Beraberliği Kabul Et</Button>
          <Button variant="secondary" size="sm" onPress={guard(() => conditionalUpdate({ beraberlikTeklifEden: null, guncellemeTs: serverTimestamp() }))}>Reddet</Button>
        </>
      )
    } else if (mine && game.geriAlmaTeklifEden && game.geriAlmaTeklifEden !== mine) {
      statusText = `${mine === 'w' ? game.siyahAd : game.beyazAd} son hamleyi geri almak istiyor.`
      actions = (
        <>
          <Button
            variant="primary" size="sm"
            onPress={guard(() => {
              if (!game.oncekiFen) return
              const anahtarlar = Object.keys(game.hamleler ?? {}).map(Number).sort((a, b) => a - b)
              const sonIndex = anahtarlar[anahtarlar.length - 1]
              const patch: Record<string, unknown> = { fen: game.oncekiFen, sira: game.oncekiSira, geriAlmaTeklifEden: null, oncekiFen: null, oncekiSira: null, guncellemeTs: serverTimestamp() }
              if (sonIndex !== undefined) patch[`hamleler/${sonIndex}`] = null
              conditionalUpdate(patch)
            })}
          >
            Geri Almayı Kabul Et
          </Button>
          <Button variant="secondary" size="sm" onPress={guard(() => conditionalUpdate({ geriAlmaTeklifEden: null, guncellemeTs: serverTimestamp() }))}>Reddet</Button>
        </>
      )
    } else if (mine) {
      const canOfferUndo = !!game.oncekiFen && !game.geriAlmaTeklifEden
      actions = (
        <>
          <Button variant="secondary" size="sm" isDisabled={game.beraberlikTeklifEden === mine} onPress={guard(() => conditionalUpdate({ beraberlikTeklifEden: mine, guncellemeTs: serverTimestamp() }))}>
            {game.beraberlikTeklifEden === mine ? 'Beraberlik teklifiniz bekleniyor…' : 'Beraberlik Teklif Et'}
          </Button>
          <Button variant="secondary" size="sm" isDisabled={!canOfferUndo} onPress={guard(() => conditionalUpdate({ geriAlmaTeklifEden: mine, guncellemeTs: serverTimestamp() }))}>
            {game.geriAlmaTeklifEden === mine ? 'Geri alma teklifiniz bekleniyor…' : 'Hamleyi Geri Al Teklif Et'}
          </Button>
          <Button
            variant="danger" size="sm"
            onPress={guard(() => {
              if (!window.confirm('Oyundan çekilmek istediğinize emin misiniz?')) return
              conditionalUpdate({ durum: 'bitti', sonuc: mine === 'w' ? 'siyah' : 'beyaz', sonNot: 'Oyundan çekildi', guncellemeTs: serverTimestamp() })
            })}
          >
            Oyundan Çekil
          </Button>
        </>
      )
    }
  } else if (game.durum === 'bitti') {
    const sonucText = game.sonuc === 'beraberlik' ? 'Berabere' : game.sonuc === 'beyaz' ? `${game.beyazAd || 'Beyaz'} kazandı` : `${game.siyahAd || 'Siyah'} kazandı`
    statusText = sonucText + (game.sonNot ? ` · ${game.sonNot}` : '')
    if (mine && !game.yeniOyunId) {
      const benIstiyorum = mine === 'w' ? game.yenidenOynaBeyaz : game.yenidenOynaSiyah
      const rakipIstiyor = mine === 'w' ? game.yenidenOynaSiyah : game.yenidenOynaBeyaz
      if (rakipIstiyor && !benIstiyorum) {
        statusText += ` · ${mine === 'w' ? (game.siyahAd || 'Rakibiniz') : (game.beyazAd || 'Rakibiniz')} yeniden oynamak istiyor.`
        actions = (
          <>
            <Button variant="primary" size="sm" onPress={guard(() => conditionalUpdate({ [mine === 'w' ? 'yenidenOynaBeyaz' : 'yenidenOynaSiyah']: true, guncellemeTs: serverTimestamp() }))}>Yeniden Oynamayı Kabul Et</Button>
            <Button variant="secondary" size="sm" onPress={guard(() => conditionalUpdate({ [mine === 'w' ? 'yenidenOynaSiyah' : 'yenidenOynaBeyaz']: false, guncellemeTs: serverTimestamp() }))}>Reddet</Button>
          </>
        )
      } else if (benIstiyorum) {
        actions = <Button variant="secondary" size="sm" isDisabled>Yeniden oyna teklifiniz bekleniyor…</Button>
      } else {
        actions = <Button variant="primary" size="sm" onPress={guard(() => conditionalUpdate({ [mine === 'w' ? 'yenidenOynaBeyaz' : 'yenidenOynaSiyah']: true, guncellemeTs: serverTimestamp() }))}>Yeniden Oyna</Button>
      }
    } else if (game.yeniOyunId) {
      statusText += ' · Yeni oyun başlıyor…'
    }
  } else if (game.durum === 'iptal') {
    statusText = `Oyun iptal edildi${game.sonNot ? ` · ${game.sonNot}` : ''}.`
  }
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wider text-muted">Oyunlar</div>
        <h1 className="mt-1 text-2xl font-semibold">Satranç</h1>
      </div>
      <div className="flex flex-wrap items-start justify-center gap-6">
        <div className="relative w-full max-w-[560px] shrink-0">
          <div ref={boardElRef} className="aspect-square w-full" />
          {promoColor && (
            <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 rounded-xl bg-black/75">
              {PROMO_PIECES.map(([p, glyph]) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => { promoResolveRef.current?.(p); promoResolveRef.current = null; setPromoColor(null) }}
                  className="flex size-14 items-center justify-center rounded-xl bg-surface text-3xl hover:bg-default"
                >
                  {glyph}
                </button>
              ))}
            </div>
          )}
          {reviewData && (
            <div className="mt-2 flex items-center justify-center gap-1.5">
              <Button isIconOnly size="sm" variant="ghost" isDisabled={reviewIndex === 0} onPress={() => setReviewIndex(0)}>⏮</Button>
              <Button isIconOnly size="sm" variant="ghost" isDisabled={reviewIndex === 0} onPress={() => setReviewIndex((i) => Math.max(0, i - 1))}>◀</Button>
              <span className="w-14 text-center text-xs text-muted tabular-nums">{reviewIndex} / {reviewData.fens.length - 1}</span>
              <Button isIconOnly size="sm" variant="ghost" isDisabled={reviewIndex === reviewData.fens.length - 1} onPress={() => setReviewIndex((i) => Math.min(reviewData.fens.length - 1, i + 1))}>▶</Button>
              <Button isIconOnly size="sm" variant="ghost" isDisabled={reviewIndex === reviewData.fens.length - 1} onPress={() => setReviewIndex(reviewData.fens.length - 1)}>⏭</Button>
            </div>
          )}
        </div>
        <div className="flex w-full max-w-[280px] flex-col gap-2.5">
          <div className="rounded-xl bg-default px-3 py-2 text-sm">
            ⚫ {game?.siyahAd || (game?.durum === 'davet_edildi' ? '(davet bekleniyor)' : '')}
            {game?.durum === 'oynaniyor' && game.sira === 'b' ? ' · sırası' : ''}
          </div>
          <div className="min-h-[18px] text-sm text-muted">{statusText}</div>
          <div className="flex flex-wrap gap-2">{actions}</div>
          <div className="rounded-xl bg-default px-3 py-2 text-sm">
            ⚪ {game?.beyazAd || ''}{game?.durum === 'oynaniyor' && game.sira === 'w' ? ' · sırası' : ''}
          </div>
          <Link to="/oyunlar/satranc" className="mt-2 w-fit rounded-full border border-separator px-3 py-1.5 text-sm hover:bg-default">← Oyunlarıma dön</Link>
        </div>
      </div>
    </div>
  )
}

export function ChessPage() {
  const [searchParams] = useSearchParams()
  const gameId = searchParams.get('oyun')
  const { uid, isTestMode } = useGameWriteAccess()
  return gameId ? <ChessGameView key={`${uid}:${isTestMode}:${gameId}`} gameId={gameId} /> : <ChessLobby />
}
