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
import { fireShot, resolveShots, startBattle, hasPendingShot, nextAmiralStats, key, oyuncuNo, oyuncuUid, type AbGame, type AtisSonucu, type Durum, type Hucre, type GemiYerlesim } from './amiralLogic'
import { StaffInvitePicker } from '../StaffInvitePicker'

const SIZE = 10
const FLEET = [
  { id: 'ucak-gemisi', ad: 'Uçak Gemisi', boy: 5 },
  { id: 'zirhli', ad: 'Zırhlı', boy: 4 },
  { id: 'kruvazor', ad: 'Kruvazör', boy: 3 },
  { id: 'denizalti', ad: 'Denizaltı', boy: 3 },
  { id: 'muhrip', ad: 'Muhrip', boy: 2 },
] as const
const DURUM_LABEL: Record<Durum, string> = { davet_edildi: 'Davet bekleniyor', yerlestirme: 'Gemiler yerleştiriliyor', oynaniyor: 'Oynanıyor', bitti: 'Bitti', iptal: 'İptal edildi' }

function gemiHucreleri(r0: number, c0: number, yon: 'h' | 'v', boy: number): Hucre[] {
  return Array.from({ length: boy }, (_, i) => (yon === 'h' ? { r: r0, c: c0 + i } : { r: r0 + i, c: c0 }))
}
function hucrelerGecerliMi(hucreler: Hucre[], yerlesim: Map<string, GemiYerlesim>, haricGemiId: string | null): boolean {
  const dolu = new Set<string>()
  yerlesim.forEach((v, gemiId) => { if (gemiId !== haricGemiId) v.hucreler.forEach((h) => dolu.add(key(h.r, h.c))) })
  return hucreler.every((h) => h.r >= 0 && h.r < SIZE && h.c >= 0 && h.c < SIZE && !dolu.has(key(h.r, h.c)))
}
function otomatikYerlestir(): Map<string, GemiYerlesim> {
  const sonuc = new Map<string, GemiYerlesim>()
  for (const gemi of FLEET) {
    for (let deneme = 0; deneme < 200; deneme++) {
      const yon: 'h' | 'v' = Math.random() < 0.5 ? 'h' : 'v'
      const r = Math.floor(Math.random() * SIZE)
      const c = Math.floor(Math.random() * SIZE)
      const hucreler = gemiHucreleri(r, c, yon, gemi.boy)
      if (hucrelerGecerliMi(hucreler, sonuc, gemi.id)) { sonuc.set(gemi.id, { id: gemi.id, hucreler }); break }
    }
  }
  return sonuc
}

// ── Lobi ──
function AbLobby() {
  const { state } = useAuth()
  const { isTestMode, canWrite, isCurrent } = useGameWriteAccess()
  const games = useDbValue<Record<string, AbGame | null>>('oyunBasarimlari/amiralBatti/oyunlar')
  const scores = useDbValue<Record<string, { isim?: string; oynanan?: number; kazanilan?: number } | null>>('oyunBasarimlari/amiralBatti')
  const [, setSearchParams] = useSearchParams()
  const [showInvite, setShowInvite] = useState(false)

  const canPlay = canWrite
  const myUid = state.status === 'ready' ? state.user.uid : ''
  const myName = state.status === 'ready' ? (state.displayName || state.user.email || '') : ''

  const myGames = useMemo(
    () =>
      Object.entries(games.data ?? {})
        .flatMap(([id, g]) => (g && (g.oyuncu1Uid === myUid || g.oyuncu2Uid === myUid) ? [{ ...g, _id: id }] : []))
        .sort((a, b) => (b.guncellemeTs ?? 0) - (a.guncellemeTs ?? 0)),
    [games.data, myUid],
  )
  const leaderboard = useMemo(
    () =>
      Object.values(scores.data ?? {})
        .filter((r): r is { isim?: string; oynanan?: number; kazanilan?: number } => !!r && typeof r.oynanan === 'number' && typeof r.kazanilan === 'number')
        .sort((a, b) => (b.kazanilan ?? 0) - (a.kazanilan ?? 0) || (b.oynanan ?? 0) - (a.oynanan ?? 0))
        .slice(0, 20),
    [scores.data],
  )

  const createGame = async (opponentUid: string, opponentName: string) => {
    setShowInvite(false)
    const context = { uid: myUid, isTestMode }
    if (!isCurrent(context) || opponentUid === myUid) return
    const id = push(ref(db, dbPathFor('oyunBasarimlari/amiralBatti/oyunlar', isTestMode))).key
    if (!id) return
    const game: AbGame = { oyuncu1Uid: myUid, oyuncu1Ad: myName, oyuncu2Uid: opponentUid, oyuncu2Ad: opponentName, durum: 'davet_edildi', hazir1: false, hazir2: false, sira: null, sonuc: null, sonNot: '' }
    try {
      const changes: Record<string, unknown> = { [`${dbPathFor('oyunBasarimlari/amiralBatti/oyunlar', isTestMode)}/${id}`]: { ...game, olusturmaTs: serverTimestamp(), guncellemeTs: serverTimestamp() } }
      const notifKey = push(ref(db, dbPathFor(`notifications/${opponentUid}`, isTestMode))).key
      if (notifKey) {
        changes[`${dbPathFor(`notifications/${opponentUid}`, isTestMode)}/${notifKey}`] = {
            type: 'amiral_batti_invite', title: 'Amiral Battı daveti', message: `${myName} sizi bir Amiral Battı oyununa davet etti.`, relatedGameId: id,
            createdAt: serverTimestamp(), read: false,
        }
      }
      if (!isCurrent(context)) return
      await update(ref(db), changes)
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
        <h1 className="mt-1 text-2xl font-semibold">Amiral Battı</h1>
      </div>
      {canPlay && <Button variant="primary" className="w-fit" onPress={() => setShowInvite(true)}>Yeni Oyun</Button>}
      <div className="flex flex-col rounded-2xl border border-separator bg-surface">
        <div className="border-b border-separator px-4 py-3 text-sm font-semibold">Oyunlarım {myGames.length > 0 && `(${myGames.length})`}</div>
        {games.isLoading && <p className="px-4 py-6 text-sm text-muted">Yükleniyor…</p>}
        {!games.isLoading && myGames.length === 0 && <p className="px-4 py-6 text-sm text-muted">Henüz oyununuz yok.</p>}
        {myGames.map((g) => {
          const rakip = g.oyuncu1Uid === myUid ? g.oyuncu2Ad : g.oyuncu1Ad
          return (
            <Link key={g._id} to={`/oyunlar/amiral-batti?oyun=${encodeURIComponent(g._id)}`} className="flex items-center justify-between gap-3 border-b border-separator px-4 py-3 text-sm last:border-b-0 hover:bg-default">
              <span>vs {rakip || '(bilinmiyor)'}</span>
              <span className="text-xs text-muted">{DURUM_LABEL[g.durum ?? 'davet_edildi']}</span>
            </Link>
          )
        })}
      </div>
      <div className="flex flex-col rounded-2xl border border-separator bg-surface">
        <div className="border-b border-separator px-4 py-3 text-sm font-semibold">Lider Tablosu</div>
        {leaderboard.length === 0 && <p className="px-4 py-6 text-sm text-muted">Henüz kimse oyun bitirmedi.</p>}
        {leaderboard.map((r, i) => (
          <div key={`${r.isim}-${i}`} className="flex items-center justify-between gap-3 border-b border-separator px-4 py-2.5 text-sm last:border-b-0">
            <span>{r.isim || '?'}</span>
            <span className="text-xs text-muted">{r.kazanilan ?? 0} galibiyet · {r.oynanan ?? 0} oyun</span>
          </div>
        ))}
      </div>
      {showInvite && <StaffInvitePicker title="Kime davet göndereyim?" onPick={createGame} onClose={() => setShowInvite(false)} />}
    </div>
  )
}

// ── Gemi yerleştirme ──
function PlacementBoard({ yerlesim, secili, onPick }: { yerlesim: Map<string, GemiYerlesim>; secili: string | null; onPick: (r: number, c: number) => void }) {
  const dolu = useMemo(() => {
    const s = new Set<string>()
    yerlesim.forEach((v) => v.hucreler.forEach((h) => s.add(key(h.r, h.c))))
    return s
  }, [yerlesim])
  return (
    <div className="grid aspect-square w-full grid-cols-10 gap-0.5 rounded-xl border border-separator bg-default p-1">
      {Array.from({ length: SIZE * SIZE }, (_, i) => {
        const r = Math.floor(i / SIZE), c = i % SIZE
        const dolumu = dolu.has(key(r, c))
        return (
          <button
            key={i}
            type="button"
            onClick={() => onPick(r, c)}
            disabled={!secili && !dolumu}
            className={`aspect-square rounded-sm ${dolumu ? 'bg-accent' : 'bg-surface hover:bg-default-hover'}`}
          />
        )
      })}
    </div>
  )
}

type CellVisual = AtisSonucu | 'ship' | undefined
function CombatBoard({ cells, interactive, onFire }: { cells: CellVisual[]; interactive: boolean; onFire?: (r: number, c: number) => void }) {
  return (
    <div className={`grid aspect-square w-full grid-cols-10 gap-0.5 rounded-xl border p-1 ${interactive ? 'border-accent bg-accent-soft/20' : 'border-separator bg-default'}`}>
      {cells.map((v, i) => {
        const r = Math.floor(i / SIZE), c = i % SIZE
        const cls = v === 'ship' ? 'bg-accent' : v === 'kacti' ? 'bg-default' : v === 'isabet' ? 'bg-warning/60' : v === 'batti' ? 'bg-danger' : v === 'bekliyor' ? 'bg-default/60 opacity-60' : 'bg-surface'
        return (
          <button
            key={i}
            type="button"
            disabled={!interactive || !!v}
            onClick={() => onFire?.(r, c)}
            className={`relative aspect-square rounded-sm ${cls} ${interactive && !v ? 'hover:bg-default-hover' : ''}`}
          >
            {v === 'kacti' && <span className="absolute inset-[32%] rounded-full bg-muted" />}
          </button>
        )
      })}
    </div>
  )
}

// ── Oyun ekranı ──
function AbGameView({ gameId }: { gameId: string }) {
  const { state } = useAuth()
  const { isTestMode, canWrite, isCurrent } = useGameWriteAccess()
  const gameData = useDbValue<AbGame>(`oyunBasarimlari/amiralBatti/oyunlar/${gameId}`)
  const myFleetData = useDbValue<{ gemiler?: GemiYerlesim[] }>(`amiralBattiGizli/${gameId}/${state.status === 'ready' ? state.user.uid : '_'}`, { enabled: state.status === 'ready' })

  const [yerlesim, setYerlesim] = useState<Map<string, GemiYerlesim>>(new Map())
  const [secili, setSecili] = useState<string | null>(null)
  const [yon, setYon] = useState<'h' | 'v'>('h')
  const hazirBildirildi = useRef(false)
  const [writeError, setWriteError] = useState(false)
  const [retry, setRetry] = useState(0)

  const myUid = state.status === 'ready' ? state.user.uid : ''
  const myName = state.status === 'ready' ? (state.displayName || state.user.email || '') : ''
  const game = gameData.data
  const no = oyuncuNo(game, myUid)
  const path = (p: string) => dbPathFor(p, isTestMode)
  const gameRef = ref(db, path(`oyunBasarimlari/amiralBatti/oyunlar/${gameId}`))

  const guard = (fn: () => void) => () => {
    if (!isCurrent({ uid: myUid, isTestMode })) { toast.danger('Oyun şu anda değiştirilemiyor.'); return }
    fn()
  }

  const reportError = (error: unknown) => {
    console.error('Oyun güncellenemedi:', error)
    setWriteError(true)
  }
  const transact = (change: (current: AbGame | null) => AbGame | undefined) => {
    const context = { uid: myUid, isTestMode }
    if (!isCurrent(context)) return
    return runTransaction(gameRef, (current: AbGame | null) =>
      isCurrent(context) ? change(current) : undefined, { applyLocally: false }).catch(reportError)
  }
  const conditionalUpdate = (patch: Record<string, unknown>) => transact((current) =>
    current && oyuncuNo(current, myUid) && sameGameState(current, game) ? patchGame(current, patch) : undefined)

  // Only the defender can resolve a shot; recompute from the transaction's latest state.
  useEffect(() => {
    if (!canWrite || !game || !no || !myFleetData.data?.gemiler || game.durum !== 'oynaniyor') return
    const incoming = no === 1 ? game.atislar2 : game.atislar1
    if (!Object.values(incoming || {}).includes('bekliyor')) return
    void transact((current) => resolveShots(current, myUid, myFleetData.data!.gemiler!, Date.now()))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, no, myFleetData.data, canWrite, retry])

  useEffect(() => {
    if (!canWrite || !game || game.durum !== 'yerlestirme' || !game.hazir1 || !game.hazir2) return
    void transact((current) => startBattle(current, myUid, Date.now()))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.durum, game?.hazir1, game?.hazir2, canWrite, retry])

  // The game ID and counters commit together. Reopening or a second tab is harmless.
  useEffect(() => {
    if (!canWrite || !game || game.durum !== 'bitti' || !game.sonuc || !no) return
    const context = { uid: myUid, isTestMode }
    runTransaction(ref(db, path(`oyunBasarimlari/amiralBatti/${myUid}`)), (previous) =>
      isCurrent(context) ? nextAmiralStats(previous, gameId, game.sonuc === myUid, myName) : undefined,
    { applyLocally: false }).catch(reportError)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.durum, game?.sonuc, no, canWrite, myUid, isTestMode, retry])

  const gemiSec = (r: number, c: number) => {
    if (!secili) return
    const gemi = FLEET.find((g) => g.id === secili)!
    const hucreler = gemiHucreleri(r, c, yon, gemi.boy)
    if (!hucrelerGecerliMi(hucreler, yerlesim, gemi.id)) { toast.danger('Buraya yerleştirilemez.'); return }
    setYerlesim((m) => new Map(m).set(gemi.id, { id: gemi.id, hucreler }))
    setSecili(null)
  }

  const hazirim = () => {
    if (!isCurrent({ uid: myUid, isTestMode }) || game?.durum !== 'yerlestirme' || !no
      || (no === 1 ? game.hazir1 : game.hazir2) || yerlesim.size !== FLEET.length || hazirBildirildi.current) return
    hazirBildirildi.current = true
    const gemiler = Array.from(yerlesim.values())
    update(ref(db), {
      [path(`amiralBattiGizli/${gameId}/${myUid}`)]: { gemiler },
      [`${path(`oyunBasarimlari/amiralBatti/oyunlar/${gameId}`)}/${no === 1 ? 'hazir1' : 'hazir2'}`]: true,
      [`${path(`oyunBasarimlari/amiralBatti/oyunlar/${gameId}`)}/guncellemeTs`]: serverTimestamp(),
    }).catch((err) => { console.error('Filo kaydedilemedi:', err); toast.danger('Filo kaydedilemedi.'); hazirBildirildi.current = false })
  }

  const atesEt = (r: number, c: number) => {
    void transact((current) => fireShot(current, myUid, key(r, c), Date.now()))
  }

  if (gameData.isLoading) return <p className="py-16 text-center text-sm text-muted">Yükleniyor…</p>
  if (!game) return <p className="py-16 text-center text-sm text-danger">Oyun bulunamadı.</p>

  const benimHazir = no === 1 ? game.hazir1 : game.hazir2
  const rakipHazir = no === 1 ? game.hazir2 : game.hazir1

  let statusText = ''
  let actions: React.ReactNode = null
  if (game.durum === 'davet_edildi') {
    if (no === 2) {
      statusText = `${game.oyuncu1Ad || 'Rakip'} sizi Amiral Battı oynamaya davet etti.`
      actions = (
        <>
          <Button variant="primary" size="sm" onPress={guard(() => conditionalUpdate({ durum: 'yerlestirme', guncellemeTs: serverTimestamp() }))}>Kabul Et</Button>
          <Button variant="secondary" size="sm" onPress={guard(() => conditionalUpdate({ durum: 'iptal', sonNot: 'Davet reddedildi', guncellemeTs: serverTimestamp() }))}>Reddet</Button>
        </>
      )
    } else if (no === 1) {
      statusText = `${game.oyuncu2Ad || 'Rakibiniz'} daveti kabul etmesini bekliyor…`
      actions = <Button variant="secondary" size="sm" onPress={guard(() => conditionalUpdate({ durum: 'iptal', sonNot: 'Davet iptal edildi', guncellemeTs: serverTimestamp() }))}>Daveti İptal Et</Button>
    }
  } else if (game.durum === 'yerlestirme') {
    statusText = benimHazir ? 'Filonuz hazır, rakibinizi bekliyorsunuz…' : 'Filonuzu yerleştirin.'
    if (rakipHazir && !benimHazir) statusText = `${(no === 1 ? game.oyuncu2Ad : game.oyuncu1Ad) || 'Rakibiniz'} hazır, sıra sizde.`
  } else if (game.durum === 'oynaniyor') {
    statusText = game.sira === myUid ? 'Sizin sıranız — düşman sularına ateş edin.' : 'Rakibin sırası.'
    if (no) {
      actions = (
        <Button
          variant="danger" size="sm"
          onPress={guard(() => {
            if (!window.confirm('Oyundan çekilmek istediğinize emin misiniz?')) return
            const rakipNo: 1 | 2 = no === 1 ? 2 : 1
            conditionalUpdate({ durum: 'bitti', sonuc: oyuncuUid(game, rakipNo), sonNot: 'Oyundan çekildi', guncellemeTs: serverTimestamp() })
          })}
        >
          Oyundan Çekil
        </Button>
      )
    }
  } else if (game.durum === 'bitti') {
    const kazananAd = game.sonuc === game.oyuncu1Uid ? game.oyuncu1Ad : game.oyuncu2Ad
    statusText = (game.sonuc === myUid ? 'Kazandınız! 🎉' : `${kazananAd || 'Rakip'} kazandı.`) + (game.sonNot ? ` · ${game.sonNot}` : '')
    actions = <Link to="/oyunlar/amiral-batti" className="rounded-full bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground">Yeni Oyun</Link>
  } else if (game.durum === 'iptal') {
    statusText = `Oyun iptal edildi${game.sonNot ? ` · ${game.sonNot}` : ''}.`
  }

  const showPlacement = game.durum === 'yerlestirme' && !!no && !benimHazir
  const showCombat = (game.durum === 'oynaniyor' || game.durum === 'bitti') && !!no

  const kendiHucreler = new Set((myFleetData.data?.gemiler ?? []).flatMap((g) => g.hucreler.map((h) => key(h.r, h.c))))
  const banaGelenAnahtar = no === 1 ? 'atislar2' : 'atislar1'
  const benimAtisAnahtarim = no === 1 ? 'atislar1' : 'atislar2'
  const kendiTahtaHucreler: CellVisual[] = Array.from({ length: SIZE * SIZE }, (_, i) => {
    const r = Math.floor(i / SIZE), c = i % SIZE
    const atisSonuc = no ? game[banaGelenAnahtar]?.[key(r, c)] : undefined
    return kendiHucreler.has(key(r, c)) && !atisSonuc ? 'ship' : atisSonuc
  })
  const dusmanTahtaHucreler: CellVisual[] = Array.from({ length: SIZE * SIZE }, (_, i) => {
    const r = Math.floor(i / SIZE), c = i % SIZE
    return no ? game[benimAtisAnahtarim]?.[key(r, c)] : undefined
  })

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wider text-muted">Oyunlar</div>
        <h1 className="mt-1 text-2xl font-semibold">Amiral Battı</h1>
      </div>
      <div className="flex flex-wrap items-start justify-center gap-6">
        <div className="flex w-full max-w-[560px] flex-col gap-4">
          {showPlacement && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                {FLEET.map((gemi) => {
                  const yerlesti = yerlesim.has(gemi.id)
                  return (
                    <button
                      key={gemi.id}
                      type="button"
                      onClick={() => { if (yerlesti) { setYerlesim((m) => { const n = new Map(m); n.delete(gemi.id); return n }); setSecili(gemi.id) } else setSecili((s) => (s === gemi.id ? null : gemi.id)) }}
                      className={`rounded-full border px-3 py-1.5 text-xs font-medium ${secili === gemi.id ? 'border-accent bg-accent-soft text-accent' : yerlesti ? 'border-success/50 bg-success/10 text-success' : 'border-separator hover:bg-default'}`}
                    >
                      {gemi.ad} ({gemi.boy})
                    </button>
                  )
                })}
                <Button variant="secondary" size="sm" onPress={() => setYon((y) => (y === 'h' ? 'v' : 'h'))}>Döndür ({yon === 'h' ? 'Yatay' : 'Dikey'})</Button>
                <Button variant="secondary" size="sm" onPress={() => setYerlesim(otomatikYerlestir())}>Rastgele Yerleştir</Button>
                <Button variant="primary" size="sm" isDisabled={!canWrite || yerlesim.size !== FLEET.length} onPress={hazirim}>Hazırım</Button>
              </div>
              <PlacementBoard yerlesim={yerlesim} secili={secili} onPick={gemiSec} />
            </>
          )}
          {showCombat && (
            <div className="flex flex-wrap justify-center gap-4">
              <div className="w-full max-w-[260px]">
                <h3 className="mb-1.5 text-center text-sm text-muted">Filon</h3>
                <CombatBoard cells={kendiTahtaHucreler} interactive={false} />
              </div>
              <div className="w-full max-w-[260px]">
                <h3 className="mb-1.5 text-center text-sm text-muted">Düşman Suları</h3>
                <CombatBoard cells={dusmanTahtaHucreler} interactive={canWrite && game.durum === 'oynaniyor' && game.sira === myUid && !hasPendingShot(game)} onFire={atesEt} />
              </div>
            </div>
          )}
        </div>
        <div className="flex w-full max-w-[280px] flex-col gap-2.5">
          <div className="rounded-xl bg-default px-3 py-2 text-sm">{game.oyuncu1Ad}{game.durum === 'oynaniyor' && game.sira === game.oyuncu1Uid ? ' · sırası' : ''}</div>
          <div className="min-h-[18px] text-sm text-muted">{statusText}</div>
          {writeError && <button type="button" disabled={!canWrite} className="text-sm text-danger underline" onClick={() => { setWriteError(false); setRetry((n) => n + 1) }}>Kayıt başarısız. Tekrar dene.</button>}
          <div className="flex flex-wrap gap-2">{actions}</div>
          <div className="rounded-xl bg-default px-3 py-2 text-sm">{game.oyuncu2Ad || '(davet bekleniyor)'}{game.durum === 'oynaniyor' && game.sira === game.oyuncu2Uid ? ' · sırası' : ''}</div>
          <Link to="/oyunlar/amiral-batti" className="mt-2 w-fit rounded-full border border-separator px-3 py-1.5 text-sm hover:bg-default">← Oyunlarıma dön</Link>
        </div>
      </div>
    </div>
  )
}

export function AmiralBattiPage() {
  const [searchParams] = useSearchParams()
  const gameId = searchParams.get('oyun')
  const { uid, isTestMode } = useGameWriteAccess()
  return gameId ? <AbGameView key={`${uid}:${isTestMode}:${gameId}`} gameId={gameId} /> : <AbLobby />
}
