// Başarım tanımları -- eski panelin admin-src/src/v4/achievements.js dosyasının birebir karşılığı.
// Bir başarım kazanıldığında tarihi users/{uid}/basarimlar/{id} yoluna yazılır; alanın var olması
// "kazanıldı" anlamına gelir. id KALICI olmalı -- kazanılan kayıtlar buna göre eşleşir.
export interface AchievementContext {
  role?: string
  haberSayisi: number
  etkinlikSayisi: number
}

export interface Achievement {
  id: string
  ad: string
  aciklama: string
  icon: string
  kosul: (ctx: AchievementContext) => boolean
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'kral-taci', ad: 'Kral Tacı', aciklama: 'Kurucu (owner) rolüne sahip olmak.', icon: '/basarimlar/kral-taci.svg', kosul: (ctx) => ctx.role === 'owner' },
  { id: 'eksi-yazari', ad: 'Ekşi Yazarı', aciklama: '10 haber yaz.', icon: '/basarimlar/eksi-yazari.svg', kosul: (ctx) => ctx.haberSayisi >= 10 },
  { id: 'blogger', ad: 'Blogger', aciklama: '15 haber yaz.', icon: '/basarimlar/blogger.svg', kosul: (ctx) => ctx.haberSayisi >= 15 },
  { id: 'wikipedia-yazari', ad: 'Wikipedia Yazarı', aciklama: '20 haber yaz.', icon: '/basarimlar/wikipedia-yazari.svg', kosul: (ctx) => ctx.haberSayisi >= 20 },
  { id: 'onur-sen-sag-kolu', ad: "Onur Şen'in Sağ Kolu", aciklama: '50 haber yaz.', icon: '/basarimlar/onur-sen-sag-kolu.svg', kosul: (ctx) => ctx.haberSayisi >= 50 },
  { id: 'gazete', ad: 'Gazete', aciklama: '100 haber yaz.', icon: '/basarimlar/gazete.svg', kosul: (ctx) => ctx.haberSayisi >= 100 },
  { id: 'koordinator', ad: 'Koordinatör', aciklama: '30 etkinliğe git.', icon: '/basarimlar/koordinator.svg', kosul: (ctx) => ctx.etkinlikSayisi >= 30 },
  { id: 'genel-sekreter', ad: 'Genel Sekreter', aciklama: '50 etkinliğe git.', icon: '/basarimlar/genel-sekreter.svg', kosul: (ctx) => ctx.etkinlikSayisi >= 50 },
  { id: 'rektor-yardimcisi', ad: 'Rektör Yardımcısı', aciklama: '150 etkinliğe git.', icon: '/basarimlar/rektor-yardimcisi.svg', kosul: (ctx) => ctx.etkinlikSayisi >= 150 },
  { id: 'rektor', ad: 'Rektör', aciklama: '150 etkinliğe git ve 20 haber yaz.', icon: '/basarimlar/rektor.png', kosul: (ctx) => ctx.etkinlikSayisi >= 150 && ctx.haberSayisi >= 20 },
]
