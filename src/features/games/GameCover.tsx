import {
  Bomb, Crosshair, Crown, Globe2, Layers, Ship, Spade, Type, Users,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useState } from 'react'

// Her oyun görsel olarak ayırt edilsin diye (kullanıcı isteği: "hangi oyuna girdiğimizi
// gösterelim") kendine özgü gradyan + büyük simge + hafif desen -- gerçek ekran görüntüsü/
// çizim varlığımız yok, bu yüzden tamamen CSS/SVG tabanlı bir "kapak" kullanılıyor.
const COVERS: Record<string, { icon: LucideIcon; from: string; to: string }> = {
  wordle: { icon: Type, from: '#22c55e', to: '#0f766e' },
  'mayin-tarlasi': { icon: Bomb, from: '#f59e0b', to: '#b45309' },
  kour: { icon: Crosshair, from: '#ef4444', to: '#7f1d1d' },
  satranc: { icon: Crown, from: '#8b5cf6', to: '#4c1d95' },
  tetris: { icon: Layers, from: '#3b82f6', to: '#1e3a8a' },
  geoguesser: { icon: Globe2, from: '#06b6d4', to: '#155e75' },
  'amiral-batti': { icon: Ship, from: '#0ea5e9', to: '#0c4a6e' },
  blackjack: { icon: Spade, from: '#171717', to: '#404040' },
  holdem: { icon: Spade, from: '#dc2626', to: '#450a0a' },
  pisti: { icon: Users, from: '#f43f5e', to: '#881337' },
}

// public/oyun-kapaklari/<key>.jpg konursa (640x360, bkz. o klasördeki README) kart otomatik
// gerçek görseli gösterir; dosya yoksa (404) aşağıdaki gradyan+ikon kapağa sessizce düşer.
export function GameCover({ gameKey }: { gameKey: string }) {
  const cover = COVERS[gameKey] ?? COVERS.wordle
  const Icon = cover.icon
  const [imageFailed, setImageFailed] = useState(false)

  return (
    <div className="relative h-32 overflow-hidden">
      {!imageFailed && (
        <img
          src={`/oyun-kapaklari/${gameKey}.jpg`}
          alt=""
          draggable={false}
          onError={() => setImageFailed(true)}
          className="absolute inset-0 size-full object-cover"
        />
      )}
      {imageFailed && (
        <div
          className="relative flex h-32 items-center justify-center"
          style={{ background: `linear-gradient(135deg, ${cover.from}, ${cover.to})` }}
        >
          <div
            className="absolute inset-0 opacity-20"
            style={{ backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.6) 1.5px, transparent 1.5px)', backgroundSize: '18px 18px' }}
          />
          <Icon size={52} strokeWidth={1.4} className="relative text-white/90 drop-shadow-sm" />
        </div>
      )}
    </div>
  )
}
