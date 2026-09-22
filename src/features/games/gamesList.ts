export interface GameDef {
  key: string
  path: string
  title: string
  description: string
  /** Henüz portlanmamış oyunlar tıklanamaz, "Yakında" rozeti gösterir. */
  implemented: boolean
}

export const GAMES: GameDef[] = [
  { key: 'wordle', path: '/oyunlar/wordle', title: 'Wordle', description: "Günün 5 harfli Türkçe kelimesini bul, 6 hakkın var.", implemented: true },
  { key: 'mayin-tarlasi', path: '/oyunlar/mayin-tarlasi', title: 'Mayın Tarlası', description: 'Klasik bulmaca oyunu.', implemented: true },
  { key: 'kour', path: '/oyunlar/kour', title: 'Kour.io', description: 'Çevrimiçi çok oyunculu FPS.', implemented: true },
  { key: 'satranc', path: '/oyunlar/satranc', title: 'Satranç', description: 'Arkadaşınla siteden davet gönder, oyna.', implemented: true },
  { key: 'tetris', path: '/oyunlar/tetris', title: 'Tetris', description: 'Klasik blok düşürme oyunu.', implemented: true },
  { key: 'geoguesser', path: '/oyunlar/geoguesser', title: 'WorldGuessr', description: "Street View'dan konum tahmin et.", implemented: true },
  { key: 'amiral-batti', path: '/oyunlar/amiral-batti', title: 'Amiral Battı', description: 'Arkadaşınla siteden davet gönder, filoları batır.', implemented: true },
  { key: 'blackjack', path: '/oyunlar/blackjack', title: 'Blackjack (21)', description: 'Tek paylaşılan masa, 5 koltuk, çip ile oyna.', implemented: true },
  { key: 'pisti', path: '/oyunlar/pisti', title: 'Pişti', description: 'Gerçek zamanlı paylaşılan masa, 101 puana kadar.', implemented: true },
]
