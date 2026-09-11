// Kullanıcı isteği: "bir kişi sitede çevrimiçiyken onu nasıl görebiliriz" --
// Firebase'in standart "presence" (çevrimiçi durumu) deseni: `.info/connected`
// özel yolu istemcinin Firebase'e o an gerçekten bağlı olup olmadığını söyler;
// bağlantı kesildiğinde (sekme kapatma, internet gitmesi, hatta tarayıcı
// çökmesi) sunucu tarafında ÇALIŞAN bir onDisconnect() kaydı devreye girer --
// istemci tarafı kod hiç çalışmasa bile "çevrimdışı" yazılır. Bu yüzden JS
// hata verse/sayfa aniden kapansa bile durum güvenilir kalır.
//
// KASITLI: dbPath() KULLANILMIYOR (staffProfiles.js'teki AYNI gerekçe) --
// çevrimiçi olmak "gerçek kişinin gerçek siteye bağlı olması" demek, Test
// Modu'nda gölgelenecek bir veri değil.
const PRESENCE_PATH = 'presence';

let presenceListenerRef = null;
let bagliMi = false;

// Herkes her admin sayfasında (shell.js üzerinden) çağırır -- oturum boyunca
// TEK sefer kurulur, sayfa değişse de aynı Firebase bağlantısı sürer.
export function presenceBaslat(database, uid, isim) {
  if (!database || !uid) { return; }
  if (presenceListenerRef) { presenceListenerRef.off('value'); }
  const presenceRef = database.ref(PRESENCE_PATH + '/' + uid);
  const baglantiRef = database.ref('.info/connected');
  presenceListenerRef = baglantiRef;
  baglantiRef.on('value', (snap) => {
    bagliMi = !!snap.val();
    if (!bagliMi) { return; }
    // onDisconnect HER bağlantı kurulduğunda YENİDEN kaydedilmeli -- Firebase
    // bağlantı koptuğunda bu kaydı bir kere kullanıp unutur, yeniden bağlanınca
    // (ör. wifi kesintisi sonrası) tekrar kurulmazsa bir sonraki kopuşta
    // çevrimdışı yazılmaz.
    presenceRef.onDisconnect().set({
      cevrimici: false,
      isim,
      sonGorulme: firebase.database.ServerValue.TIMESTAMP
    }).then(() => {
      presenceRef.set({ cevrimici: true, isim, sonGorulme: firebase.database.ServerValue.TIMESTAMP });
    });
  });
}

// kullanici-yonetimi.html gibi tüketiciler: presence/ düğümünün TAMAMINI canlı
// dinler, { uid: {cevrimici, isim, sonGorulme} } haritası döner.
export function presenceAbone(database, callback) {
  if (!database) { return () => {}; }
  const ref = database.ref(PRESENCE_PATH);
  const dinleyici = ref.on('value', (snap) => { callback(snap.val() || {}); });
  return () => ref.off('value', dinleyici);
}
