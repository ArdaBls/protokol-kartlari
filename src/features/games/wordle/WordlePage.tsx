import { Card, toast } from '@heroui/react'
import { ref, update } from 'firebase/database'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../../../auth/useAuth'
import { useDbValue } from '../../../hooks/useDbValue'
import { fullName } from '../../../lib/roles'
import { useDbMode } from '../../../lib/dbMode'
import { db } from '../../../lib/firebase'
import type { Guess, LetterState, WordleStats } from './wordleLogic'
import {
  EMPTY_STATS, KEYBOARD_ROWS, MAX_TRIES, WORD_LEN,
  ardisikGunMu, bugununTarihiIstanbul, geriBildirimHesapla, harfDurumunuGuncelle, harfleriAyir, seedliIndeks,
} from './wordleLogic'

const STORAGE_KEY = 'omuWordleDurum'

interface SavedState {
  tarih: string
  tahminler: Guess[]
  oyunBitti: boolean
  kazandi: boolean
}

function loadSaved(bugunTarih: string): SavedState | null {
  try {
    const kayit = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as SavedState | null
    if (kayit && kayit.tarih === bugunTarih && Array.isArray(kayit.tahminler)) return kayit
  } catch {
    // bozuk kayıt varsa sessizce yok say
  }
  return null
}

function saveState(state: SavedState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // localStorage kapalıysa oyun yine oynanabilir, sadece yenilemede sıfırlanır
  }
}

const CELL_STATE_CLASS: Record<LetterState, string> = {
  dogru: 'border-success bg-success text-success-foreground',
  var: 'border-warning bg-warning text-warning-foreground',
  yok: 'border-separator bg-default text-muted',
}
const KEY_STATE_CLASS: Record<LetterState, string> = {
  dogru: 'bg-success text-success-foreground',
  var: 'bg-warning text-warning-foreground',
  yok: 'bg-default/60 text-muted',
}

export function WordlePage() {
  const { state } = useAuth()
  const { isReadOnly } = useDbMode()
  const uid = state.status === 'ready' ? state.user.uid : ''
  const displayName = state.status === 'ready' ? fullName(state.profile) || state.user.email || 'İsimsiz' : ''

  const bugunTarih = useMemo(bugununTarihiIstanbul, [])
  const [wordSet, setWordSet] = useState<Set<string> | null>(null)
  const [hedefKelime, setHedefKelime] = useState('')
  const [tahminler, setTahminler] = useState<Guess[]>([])
  const [mevcutGiris, setMevcutGiris] = useState('')
  const [oyunBitti, setOyunBitti] = useState(false)
  const [kazandi, setKazandi] = useState(false)
  const [harfDurumu, setHarfDurumu] = useState<Record<string, LetterState>>({})
  const [shakeRow, setShakeRow] = useState(false)
  const [flipRow, setFlipRow] = useState(-1)
  const statsWritten = useRef(false)

  const statsAll = useDbValue<Record<string, WordleStats | null>>('oyunBasarimlari/wordle')

  // Kelime listesi + günün kelimesi + varsa bugüne ait kayıtlı ilerleme.
  useEffect(() => {
    fetch('/data/kelime-5.json')
      .then((r) => r.json() as Promise<string[]>)
      .then((liste) => {
        setWordSet(new Set(liste))
        const idx = seedliIndeks(bugunTarih, liste.length)
        setHedefKelime(liste[idx])
        const saved = loadSaved(bugunTarih)
        if (saved) {
          setTahminler(saved.tahminler)
          setOyunBitti(saved.oyunBitti)
          setKazandi(saved.kazandi)
          let durum: Record<string, LetterState> = {}
          saved.tahminler.forEach((t) => { durum = harfDurumunuGuncelle(durum, t.sonuc, t.kelime) })
          setHarfDurumu(durum)
        }
      })
      .catch((err) => {
        console.error('Kelime listesi yüklenemedi:', err)
        toast.danger('Kelime listesi yüklenemedi.')
      })
  }, [bugunTarih])

  const kendiIstatistik = uid ? statsAll.data?.[uid] ?? EMPTY_STATS : EMPTY_STATS

  const yazIstatistik = async () => {
    if (!uid || statsWritten.current) return
    const eski = statsAll.data?.[uid] ?? EMPTY_STATS
    if (eski.sonTarih === bugunTarih) return
    statsWritten.current = true
    const dunOynandiMi = ardisikGunMu(eski.sonTarih, bugunTarih)
    const yeniSeri = kazandi ? (dunOynandiMi ? (eski.seri || 0) + 1 : 1) : 0
    const dagitim = { ...eski.dagitim }
    if (kazandi) { const k = String(tahminler.length); dagitim[k] = (dagitim[k] ?? 0) + 1 }
    const yeni: WordleStats = {
      isim: displayName || 'İsimsiz',
      oynanan: (eski.oynanan || 0) + 1,
      kazanilan: (eski.kazanilan || 0) + (kazandi ? 1 : 0),
      seri: yeniSeri,
      enUzunSeri: Math.max(eski.enUzunSeri || 0, yeniSeri),
      sonTarih: bugunTarih,
      sonKazandi: kazandi,
      dagitim,
    }
    try {
      await update(ref(db, `oyunBasarimlari/wordle/${uid}`), yeni)
    } catch (err) {
      console.error('Wordle istatistiği kaydedilemedi:', err)
    }
  }

  const harfGir = (h: string) => {
    if (oyunBitti || mevcutGiris.length >= WORD_LEN) return
    setMevcutGiris((g) => g + h)
  }
  const geriSil = () => { if (!oyunBitti) setMevcutGiris((g) => g.slice(0, -1)) }

  const tetikleTitreme = () => {
    setShakeRow(true)
    setTimeout(() => setShakeRow(false), 500)
  }

  const tahminGonder = () => {
    if (oyunBitti) return
    if (mevcutGiris.length !== WORD_LEN) { toast.danger(`Kelime ${WORD_LEN} harf olmalı.`); tetikleTitreme(); return }
    if (!wordSet?.has(mevcutGiris)) { toast.danger('Bu kelime listede yok.'); tetikleTitreme(); return }
    const sonuc = geriBildirimHesapla(mevcutGiris, hedefKelime)
    const yeniTahminler = [...tahminler, { kelime: mevcutGiris, sonuc }]
    setFlipRow(yeniTahminler.length - 1)
    setTahminler(yeniTahminler)
    setHarfDurumu((durum) => harfDurumunuGuncelle(durum, sonuc, mevcutGiris))
    const kazandiMi = mevcutGiris === hedefKelime
    setMevcutGiris('')
    let bitti = false
    let kazandiSonuc = false
    if (kazandiMi) {
      bitti = true; kazandiSonuc = true
      toast.success('Tebrikler, buldun! 🎉')
    } else if (yeniTahminler.length >= MAX_TRIES) {
      bitti = true; kazandiSonuc = false
      toast.info(`Bugünün kelimesi: ${hedefKelime.toLocaleUpperCase('tr-TR')}`)
    }
    setOyunBitti(bitti)
    setKazandi(kazandiSonuc)
    saveState({ tarih: bugunTarih, tahminler: yeniTahminler, oyunBitti: bitti, kazandi: kazandiSonuc })
  }

  // Oyun bittiğinde (kazanma/kaybetme anında) istatistik bir kez yazılır.
  useEffect(() => {
    if (oyunBitti && !isReadOnly) void yazIstatistik()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oyunBitti])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement) return
      if (e.key === 'Enter') { tahminGonder(); return }
      if (e.key === 'Backspace') { geriSil(); return }
      const h = e.key.toLocaleLowerCase('tr-TR')
      if (h.length === 1 && /[abcçdefgğhıijklmnoöprsştuüvyz]/.test(h)) harfGir(h)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oyunBitti, mevcutGiris, wordSet, hedefKelime, tahminler])

  const leaderboard = useMemo(
    () =>
      Object.entries(statsAll.data ?? {})
        .flatMap(([id, s]) => (s ? [{ uid: id, ...s }] : []))
        .sort((a, b) => (b.oynanan || 0) - (a.oynanan || 0) || (b.seri || 0) - (a.seri || 0)),
    [statsAll.data],
  )

  return (
    <div className="mx-auto flex max-w-[620px] flex-col items-center gap-6">
      <div className="w-full">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted">Oyunlar</div>
        <h1 className="mt-1 text-2xl font-semibold">Wordle</h1>
        <p className="mt-1 text-sm text-muted">Günün 5 harfli Türkçe kelimesini {MAX_TRIES} hakta bul.</p>
      </div>

      <div className="flex flex-col gap-1.5">
        {Array.from({ length: MAX_TRIES }, (_, row) => {
          const tahmin = tahminler[row]
          const aktif = row === tahminler.length && !oyunBitti
          const flip = row === flipRow
          return (
            <div key={row} className={`flex gap-1.5 ${row === tahminler.length && shakeRow ? 'animate-[shake_0.5s]' : ''}`}>
              {Array.from({ length: WORD_LEN }, (_, col) => {
                const harf = tahmin ? harfleriAyir(tahmin.kelime)[col] : aktif ? harfleriAyir(mevcutGiris)[col] ?? '' : ''
                const durum = tahmin?.sonuc[col]
                return (
                  <div
                    key={col}
                    style={flip ? { animationDelay: `${(col * 0.12).toFixed(2)}s` } : undefined}
                    className={`flex size-12 items-center justify-center rounded-lg border-2 text-xl font-bold uppercase sm:size-14 ${
                      durum ? CELL_STATE_CLASS[durum] : harf ? 'border-muted' : 'border-separator'
                    } ${flip ? 'animate-[flip_0.5s_ease]' : ''}`}
                  >
                    {harf}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>

      <div className="flex w-full flex-col gap-1.5">
        {KEYBOARD_ROWS.map((row, i) => (
          <div key={i} className="flex justify-center gap-1.5">
            {row.map((key) => {
              const durum = harfDurumu[key]
              const wide = key === 'ENTER' || key === 'BACK'
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => (key === 'ENTER' ? tahminGonder() : key === 'BACK' ? geriSil() : harfGir(key))}
                  className={`h-12 rounded-lg text-xs font-semibold uppercase transition-colors sm:text-sm ${wide ? 'px-3' : 'w-8 sm:w-10'} ${durum ? KEY_STATE_CLASS[durum] : 'bg-default hover:bg-default-hover'}`}
                >
                  {key === 'ENTER' ? 'Gönder' : key === 'BACK' ? '⌫' : key}
                </button>
              )
            })}
          </div>
        ))}
      </div>

      {oyunBitti && (
        <Card className="w-full">
          <Card.Content className="flex flex-col items-center gap-3 text-center">
            {kazandi ? (
              <>
                <div className="text-lg font-semibold">Kazandın!</div>
                <div className="flex gap-1.5">
                  {Array.from({ length: MAX_TRIES }, (_, i) => i + 1).map((n) => (
                    <span
                      key={n}
                      className={`flex size-8 items-center justify-center rounded-full text-sm font-semibold ${n === tahminler.length ? 'bg-accent text-accent-foreground' : 'bg-default text-muted'}`}
                    >
                      {n}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <>
                <div className="text-lg font-semibold">Bu sefer olmadı</div>
                <div className="text-sm text-muted">Kelime: <strong className="text-foreground">{hedefKelime.toLocaleUpperCase('tr-TR')}</strong></div>
              </>
            )}

            <div className="mt-1 w-full border-t border-separator pt-3 text-left">
              <div className="mb-2 text-center text-xs text-muted">
                Oynanan: {kendiIstatistik.oynanan} · Kazanılan: {kendiIstatistik.kazanilan} · Güncel seri: {kendiIstatistik.seri} 🔥 · En uzun seri: {kendiIstatistik.enUzunSeri}
              </div>
              <div className="flex flex-col gap-1">
                {Array.from({ length: MAX_TRIES }, (_, i) => i + 1).map((deneme) => {
                  const dagitim = kendiIstatistik.dagitim ?? {}
                  const sayi = dagitim[String(deneme)] ?? 0
                  const enYuksek = Math.max(1, ...Array.from({ length: MAX_TRIES }, (_, i) => dagitim[String(i + 1)] ?? 0))
                  const yuzde = Math.max(6, Math.round((sayi / enYuksek) * 100))
                  const bugunMu = kendiIstatistik.sonTarih === bugunTarih && kendiIstatistik.sonKazandi && tahminler.length === deneme
                  return (
                    <div key={deneme} className="flex items-center gap-2 text-xs">
                      <span className="w-3 shrink-0 text-muted">{deneme}</span>
                      <div className="h-4 flex-1 overflow-hidden rounded bg-default">
                        <div
                          className={`flex h-full items-center justify-end rounded px-1.5 text-[10px] font-semibold text-accent-foreground ${bugunMu ? 'bg-accent' : 'bg-muted/60'}`}
                          style={{ width: `${yuzde}%` }}
                        >
                          {sayi}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </Card.Content>
        </Card>
      )}

      <Card className="w-full">
        <Card.Header>
          <Card.Title>Lider tablosu</Card.Title>
          <Card.Description>Toplam oynama sayısına göre</Card.Description>
        </Card.Header>
        <Card.Content className="flex flex-col gap-1">
          {statsAll.isLoading && <p className="py-3 text-center text-sm text-muted">Yükleniyor…</p>}
          {!statsAll.isLoading && leaderboard.length === 0 && <p className="py-3 text-center text-sm text-muted">Henüz kimse oynamadı — ilk bulmacayı sen çöz!</p>}
          {leaderboard.map((s, i) => (
            <div key={s.uid} className={`flex items-center gap-3 rounded-xl px-2 py-1.5 text-sm ${s.uid === uid ? 'bg-accent-soft' : ''}`}>
              <span className="w-5 shrink-0 text-center text-xs text-muted">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate">{s.isim || 'İsimsiz'}</span>
              <span className="shrink-0 text-xs text-muted">{s.oynanan || 0} kez oynadı</span>
              <span className="shrink-0 text-xs text-muted">{s.seri || 0} 🔥</span>
            </div>
          ))}
        </Card.Content>
      </Card>
    </div>
  )
}
