// Başarım tanımları -- Profiliniz'deki "Başarılar" kartı ve tum-basarimlar.html
// (Tümünü gör) BU listeden okur. Bir kullanıcı bir başarımı kazandığında, kazanma
// tarihi users/{uid}/basarimlar/{id} yoluna (ServerValue.TIMESTAMP olarak) yazılır --
// alan var olan tek başına "kazanıldı" anlamına gelir, ayrı bir boolean gerekmez.
//
// secret:true olan başarımlar kazanılana kadar tum-basarimlar.html'de HİÇ görünmez
// (kullanıcı isteği: "gizli olacak ve görünmeycek, ta ki kişi o başarımı tetikleyen
// şeyi yapıncaya kadar") -- listede sırayla dururlar, kazanılınca normal bir başarım
// gibi belirirler.
//
// `kosul(ctx)` -- otomatik verme mantığı (bkz. profil.html checkAndGrantAchievements).
// ctx şekli: { role, haberSayisi, etkinlikSayisi, klimaKapatmaSayisi }. Sadece BURADA
// kullanılır, tum-basarimlar.html/profil.html'in vitrin render'ı bunu hiç çağırmaz --
// sadece kazanılmış olup olmadığına (Firebase'deki tarih) bakar.
//
// Yeni bir başarım eklemek için: bu diziye {id, ad, aciklama, icon, secret, kosul}
// şeklinde bir girdi eklemek yeterli -- id KALICI olmalı (bir kez kazanılan kayıtlar
// bu id'ye göre eşleşir, sonradan değiştirilmemeli).
export const ACHIEVEMENTS = [
  {
    id: 'kral-taci',
    ad: 'Kral Tacı',
    aciklama: 'Kurucu (owner) rolüne sahip olmak.',
    icon: '/basarimlar/kral-taci.svg',
    kosul: (ctx) => ctx.role === 'owner'
  },
  {
    id: 'eksi-yazari',
    ad: 'Ekşi Yazarı',
    aciklama: '10 haber yaz.',
    icon: '/basarimlar/eksi-yazari.svg',
    kosul: (ctx) => ctx.haberSayisi >= 10
  },
  {
    id: 'blogger',
    ad: 'Blogger',
    aciklama: '15 haber yaz.',
    icon: '/basarimlar/blogger.svg',
    kosul: (ctx) => ctx.haberSayisi >= 15
  },
  {
    id: 'wikipedia-yazari',
    ad: 'Wikipedia Yazarı',
    aciklama: '20 haber yaz.',
    icon: '/basarimlar/wikipedia-yazari.svg',
    kosul: (ctx) => ctx.haberSayisi >= 20
  },
  {
    id: 'onur-sen-sag-kolu',
    ad: "Onur Şen'in Sağ Kolu",
    aciklama: '50 haber yaz.',
    icon: '/basarimlar/onur-sen-sag-kolu.svg',
    kosul: (ctx) => ctx.haberSayisi >= 50
  },
  {
    id: 'gazete',
    ad: 'Gazete',
    aciklama: '100 haber yaz.',
    icon: '/basarimlar/gazete.svg',
    kosul: (ctx) => ctx.haberSayisi >= 100
  },
  {
    id: 'koordinator',
    ad: 'Koordinatör',
    aciklama: '30 etkinliğe git.',
    icon: '/basarimlar/koordinator.svg',
    kosul: (ctx) => ctx.etkinlikSayisi >= 30
  },
  {
    id: 'genel-sekreter',
    ad: 'Genel Sekreter',
    aciklama: '50 etkinliğe git.',
    icon: '/basarimlar/genel-sekreter.svg',
    kosul: (ctx) => ctx.etkinlikSayisi >= 50
  },
  {
    id: 'rektor-yardimcisi',
    ad: 'Rektör Yardımcısı',
    aciklama: '150 etkinliğe git.',
    icon: '/basarimlar/rektor-yardimcisi.svg',
    kosul: (ctx) => ctx.etkinlikSayisi >= 150
  },
  {
    id: 'rektor',
    ad: 'Rektör',
    aciklama: '150 etkinliğe git ve 20 haber yaz.',
    icon: '/basarimlar/rektor.png',
    kosul: (ctx) => ctx.etkinlikSayisi >= 150 && ctx.haberSayisi >= 20
  },
  {
    id: 'klima-faresi',
    ad: 'Klima Faresi',
    aciklama: 'Ofis de soğuk oldu haa...',
    icon: '/basarimlar/klima-faresi.svg',
    secret: true,
    kosul: (ctx) => ctx.klimaKapatmaSayisi >= 5
  }
];
