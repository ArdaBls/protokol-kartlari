// Başarım tanımları -- Profiliniz'deki "Başarılar" kartı ve tum-basarimlar.html
// (Tümünü gör) BU listeden okur. Kazanma KOŞULLARI (hangi eylem hangi başarımı
// tetikler) burada YOK -- o mantık ayrıca eklenecek (kullanıcı isteği: "ben şimdi
// başarımları yapıyorum, sen de sayfayı tamamla"). Bu dosya sadece VİTRİN: her
// başarımın kimliği, adı, açıklaması, ikonu ve gizli olup olmadığı.
//
// Bir kullanıcı bir başarımı kazandığında, kazanma tarihi
// users/{uid}/basarimlar/{id} yoluna (ServerValue.TIMESTAMP olarak) yazılır --
// alan var olan tek başına "kazanıldı" anlamına gelir, ayrı bir boolean gerekmez.
//
// secret:true olan başarımlar kazanılana kadar tum-basarimlar.html'de HİÇ
// görünmez (kullanıcı isteği: "gizli olacak ve görünmeycek, ta ki kişi o
// başarımı tetikleyen şeyi yapıncaya kadar") -- listede sırayla dururlar,
// kazanılınca normal bir başarım gibi belirirler.
//
// Yeni bir başarım eklemek için: bu diziye {id, ad, aciklama, icon, secret}
// şeklinde bir girdi eklemek yeterli -- id KALICI olmalı (bir kez kazanılan
// kayıtlar bu id'ye göre eşleşir, sonradan değiştirilmemeli).
export const ACHIEVEMENTS = [];
