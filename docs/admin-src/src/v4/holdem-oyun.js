// Texas Hold'em saha katmanı. İlk sürüm yalnız masa, ortak kartlar,
// kombinasyon görünümü ve ortak çip bakiyesini okur. Gerçek masa transaction
// ve bot karar motoru ayrı pakette eklenecek; bu yüzden burada cüzdana yazılmaz.
import { dbPath, initDbMode, isReadOnly, renderDbModeBanner } from './db-mode.js';
import { showModal } from './modal.js';
import { showToast } from './toast.js';
import { subscribeStaffProfiles, renderStaffAvatar } from './staff-profiles.js';
import { holdemElDegerlendir } from './holdem-engine.js';
import { HOLDEM_ZORLUKLARI, holdemBotAksiyonSec } from './holdem-bot-strateji.js';
import { holdemAksiyonUygula, holdemAyarlariNormalle, holdemBosCanliMasa, holdemEliBaslat, holdemVarsayilanAyarlaraDon } from './holdem-masa-oyun.js';

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDOfhq3aYW6sg2_zj0sFsRzXeGziGtLxCk',
  authDomain: 'omu-protokol.firebaseapp.com',
  databaseURL: 'https://omu-protokol-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'omu-protokol'
};
const CIP_DEGERLERI = [25, 50, 75, 100, 200, 500, 750, 1000, 5000, 10000];
const CIP_GORSELLERI = ['cip-01-beyaz', 'cip-02-kirmizi', 'cip-03-yesil', 'cip-04-mavi', 'cip-05-siyah', 'cip-06-mor', 'cip-07-turuncu-koyu', 'cip-08-bej', 'cip-09-turuncu', 'cip-10-joker'];
const KOMBINASYONLAR = [
  ['Royal flush', 'A–10 aynı takım'], ['Sıralı renk', 'Aynı takımda ardışık beş kart'],
  ['Kare', 'Aynı rütbeden dört kart'], ['Full', 'Üçlü ve bir çift'],
  ['Renk', 'Aynı takımdan beş kart'], ['Kent', 'Ardışık beş kart'],
  ['Üçlü', 'Aynı rütbeden üç kart'], ['İki çift', 'İki farklı çift'],
  ['Bir çift', 'Aynı rütbeden iki kart'], ['Yüksek kart', 'Başka kombinasyon yoksa en büyük kart']
];
const MASA_AYAR_YOLU = 'oyunBasarimlari/holdem/ayarlar/ana-masa';
const CIP_ISLEM_KAYIT_LIMITI = 80;

let database = null;
let currentUser = null;
let currentUserName = 'Sen';
let skin = { desteStili: 'temel', yuzKartiTemasi: 'varsayilan', desteArkasi: '01' };
let botZorlugu = 'normal';
let previewMasa = null;
let botTuruTimer = null;
let currentUserRole = '';
let masaAyarlari = holdemVarsayilanAyarlaraDon();
let masaAyarRef = null;
let masayaOturdu = false;
let katilimBekliyor = false;
let siraSaati = null;
let masaGirisiOdendi = false;
let masaCuzdanIslemiBekliyor = false;
let masaBaslangicBakiyesi = 0;

// Bu sahne, veri modeli ve görsel akışı doğrulamak için deterministik bir
// örnek el gösterir. Beş oyuncu koltuğu vardır; üst orta kurpiyer ayrı DOM
// elemanıdır ve oyuncu/bot sayısına dahil edilmez.
let demoEl = null;

function kayitliZorluguAl() {
  try { return HOLDEM_ZORLUKLARI[globalThis.localStorage && globalThis.localStorage.getItem('holdem.botZorlugu')] ? globalThis.localStorage.getItem('holdem.botZorlugu') : 'normal'; } catch { return 'normal'; }
}
function yerelMasaAnahtari() { return 'holdem.yerelMasa.' + (currentUser?.uid || 'misafir'); }
function yerelMasaKaydet() {
  if (!masayaOturdu || !previewMasa) { return; }
  try { globalThis.localStorage.setItem(yerelMasaAnahtari(), JSON.stringify({ surum: 2, masa: previewMasa, masaGirisiOdendi, masaBaslangicBakiyesi })); } catch {}
}
function yerelMasaYukle() {
  try {
    const kayit = JSON.parse(globalThis.localStorage.getItem(yerelMasaAnahtari()) || 'null');
    if (!kayit || ![1, 2].includes(kayit.surum) || !kayit.masa || !Array.isArray(kayit.masa.koltuklar)) { return false; }
    previewMasa = kayit.masa; masayaOturdu = true; katilimBekliyor = false; masaGirisiOdendi = kayit.masaGirisiOdendi === true; masaBaslangicBakiyesi = Math.max(0, Number(kayit.masaBaslangicBakiyesi) || Number(kayit.masa.koltuklar[3]?.masaBakiyesi) || 0); demoEkraniEsitle(); return true;
  } catch { return false; }
}
function lobiGorunumuOlustur() {
  if (botTuruTimer) { clearTimeout(botTuruTimer); botTuruTimer = null; }
  const botlar = ['Rota Bot', 'Mira Bot', 'Nova Bot', 'Atlas Bot', 'Luna Bot'].map((isim, index) => ({ uid: 'izleyici-bot-' + index, isim, bot: true, zorluk: botZorlugu, masaBakiyesi: masaAyarlari.girisBedeli }));
  previewMasa = holdemEliBaslat({ ...holdemBosCanliMasa({ masaId: 'onizleme-masasi', ayarlar: masaAyarlari }), koltuklar: botlar }, Date.now());
  demoEkraniEsitle();
}
function yeniDemoEliOlustur() {
  if (botTuruTimer) { clearTimeout(botTuruTimer); botTuruTimer = null; }
  const oyuncular = [
    { uid: 'bot-rota', isim: 'Rota Bot', bot: true, zorluk: botZorlugu, masaBakiyesi: masaAyarlari.girisBedeli }, { uid: 'bot-mira', isim: 'Mira Bot', bot: true, zorluk: botZorlugu, masaBakiyesi: masaAyarlari.girisBedeli },
    { uid: 'bot-nova', isim: 'Nova Bot', bot: true, zorluk: botZorlugu, masaBakiyesi: masaAyarlari.girisBedeli }, { uid: 'ben', isim: 'Sen', bot: false, masaBakiyesi: masaBaslangicBakiyesi, skin }, { uid: 'bot-luna', isim: 'Luna Bot', bot: true, zorluk: botZorlugu, masaBakiyesi: masaAyarlari.girisBedeli }
  ];
  previewMasa = holdemEliBaslat({ ...holdemBosCanliMasa({ masaId: 'onizleme-masasi', ayarlar: masaAyarlari }), koltuklar: oyuncular }, Date.now());
  demoEkraniEsitle();
}
function demoEkraniEsitle() {
  if (!previewMasa) { return; }
  const isimler = ['Rota Bot', 'Mira Bot', 'Nova Bot', 'Sen', 'Luna Bot'];
  demoEl = {
    asama: previewMasa.durum, pot: previewMasa.koltuklar.reduce((toplam, koltuk) => toplam + koltuk.toplamYatirim, 0), siradaki: previewMasa.aktifKoltuk, desteId: previewMasa.desteId,
    ortakKartlar: previewMasa.communityCards,
    koltuklar: previewMasa.koltuklar.map((oyuncu, index) => ({ isim: oyuncu.isim || isimler[index], bot: oyuncu.bot, bakiye: oyuncu.masaBakiyesi, bahis: oyuncu.sokakYatirimi, rozet: index === previewMasa.smallBlind ? 'Küçük kör bahis' : index === previewMasa.bigBlind ? 'Büyük kör bahis' : '', kartlar: oyuncu.kartlar, pas: oyuncu.pas, skin: oyuncu.skin, sonAksiyon: oyuncu.sonAksiyon }))
  };
  yerelMasaKaydet();
  if (previewMasa.durum === 'el_sonucu') { elSonuCuzdanaAktar(); }
}
function botPozisyonu(masa, index) {
  if (index === masa.smallBlind) { return 'small_blind'; }
  if (index === masa.bigBlind) { return 'big_blind'; }
  const siralama = [];
  for (let adim = 1; adim < masa.koltuklar.length; adim++) {
    const aday = (masa.bigBlind + adim) % masa.koltuklar.length;
    if (aday !== masa.smallBlind && aday !== masa.bigBlind) { siralama.push(aday); }
  }
  const sira = siralama.indexOf(index);
  if (sira < 0) { return 'middle'; }
  if (sira === siralama.length - 1) { return 'late'; }
  return sira === 0 ? 'early' : 'middle';
}
function botTurunuPlanla() {
  if (!previewMasa) { return; }
  if (previewMasa.durum === 'el_sonucu') {
    if (masayaOturdu && !katilimBekliyor) { return; }
    botTuruTimer = setTimeout(() => {
      if (katilimBekliyor) { katilimBekliyor = false; masayaOturdu = true; yeniDemoEliOlustur(); }
      else if (!masayaOturdu) { lobiGorunumuOlustur(); }
      renderMasa(); botTurunuPlanla();
    }, 4000);
    return;
  }
  if (!['preflop', 'flop', 'turn', 'river'].includes(previewMasa.durum)) { return; }
  const index = previewMasa.aktifKoltuk;
  const bot = previewMasa.koltuklar[index];
  if (!bot || !bot.bot) { return; }
  botTuruTimer = setTimeout(() => {
    const toCall = Math.max(0, previewMasa.mevcutBahis - bot.sokakYatirimi);
    const karar = holdemBotAksiyonSec({
      bot, holeCards: bot.kartlar, communityCards: previewMasa.communityCards, stack: bot.masaBakiyesi,
      pot: previewMasa.koltuklar.reduce((toplam, koltuk) => toplam + koltuk.toplamYatirim, 0), toCall,
      bigBlind: previewMasa.ayarlar.buyukKor, currentBet: previewMasa.mevcutBahis, activeOpponents: previewMasa.koltuklar.filter((koltuk) => !koltuk.pas).length,
      position: botPozisyonu(previewMasa, index), actionContext: previewMasa.mevcutBahis > previewMasa.ayarlar.buyukKor ? 'facing_open' : 'unopened'
    });
    try {
      previewMasa = holdemAksiyonUygula(previewMasa, { koltukIndex: index, aksiyon: karar.action, miktar: karar.amount }, Date.now());
      demoEkraniEsitle(); renderMasa(); botTurunuPlanla();
    } catch {
      // Strateji motorundan bir miktar sınır dışı gelirse timer'ın sessizce
      // bitmesi masayı donduruyordu. Güvenli hamle ile sırayı ilerletmek,
      // oynanabilirliği karar kalitesinden her zaman önde tutar.
      try {
        const guvenliAksiyon = toCall > 0 ? 'fold' : 'check';
        previewMasa = holdemAksiyonUygula(previewMasa, { koltukIndex: index, aksiyon: guvenliAksiyon }, Date.now());
        demoEkraniEsitle(); renderMasa(); botTurunuPlanla();
      } catch { lobiGorunumuOlustur(); renderMasa(); botTurunuPlanla(); }
    }
  }, 1500);
}

function ownerMi() { return currentUserRole === 'owner' || currentUserRole === 'admin'; }
function masaAyariButonunuGuncelle() {
  const button = document.querySelector('[data-holdem-masa-ayarlari]');
  if (button) { button.hidden = !ownerMi(); }
}
function sayiGirdisi(dialog, selector) { return Number(dialog.querySelector(selector)?.value); }
function masaAyarlariniAc() {
  if (!database || !ownerMi()) { return; }
  const ayar = masaAyarlari;
  showModal({
    title: 'Hold’em masa ayarları',
    body: '<p class="hint">Bu ayarlar yalnız yeni elde uygulanır. Oyuncu masaya site bakiyesinin tamamıyla oturur; giriş ücreti alınmaz.</p>' +
      '<div class="form-group"><label>Küçük kör bahis<input class="form-control" data-he-ayar-sb type="number" min="1" max="10000" step="1" value="' + ayar.kucukKor + '"></label></div>' +
      '<div class="form-group"><label>Büyük kör bahis<input class="form-control" data-he-ayar-bb type="number" min="2" max="20000" step="1" value="' + ayar.buyukKor + '"></label></div>' +
      '<p class="hint">Oyuncu sırası: 60 saniye. Site bağlantısı kesilirse, sıra geldiğinde süre 10 saniyeye iner.</p>',
    actions: [
      { label: 'Varsayılana dön', variant: 'outline', closeOnAction: false, action: ({ dialog }) => {
        const varsayilan = holdemVarsayilanAyarlaraDon();
        dialog.querySelector('[data-he-ayar-sb]').value = varsayilan.kucukKor;
        dialog.querySelector('[data-he-ayar-bb]').value = varsayilan.buyukKor;
        return false;
      } },
      { label: 'Kaydet', variant: 'primary', action: ({ dialog }) => {
        if (isReadOnly()) { showToast('Salt-okunur modda masa ayarı değiştirilemez.', { variant: 'error' }); return false; }
        const sonraki = holdemAyarlariNormalle({ girisBedeli: ayar.girisBedeli, kucukKor: sayiGirdisi(dialog, '[data-he-ayar-sb]'), buyukKor: sayiGirdisi(dialog, '[data-he-ayar-bb]') });
        return database.ref(dbPath(MASA_AYAR_YOLU)).set({ ...sonraki, guncellemeTs: globalThis.firebase.database.ServerValue.TIMESTAMP }).then(() => showToast('Masa ayarları yeni el için kaydedildi.', { variant: 'success' })).catch(() => { showToast('Masa ayarları kaydedilemedi.', { variant: 'error' }); return false; });
      } },
      { label: 'Vazgeç', variant: 'outline' }
    ]
  });
}
const HOLDEM_AKTIF_DURUMLAR = new Set(['preflop', 'flop', 'turn', 'river']);
function masaAyarlariniDinle() {
  if (!database || masaAyarRef) { return; }
  masaAyarRef = database.ref(dbPath(MASA_AYAR_YOLU));
  masaAyarRef.on('value', (snap) => {
    masaAyarlari = holdemAyarlariNormalle(snap.val() || {});
    // Modal metni "Bu ayarlar yalnız yeni elde uygulanır" diyor ama önceden
    // owner ayarı değiştirdiği anda previewMasa.ayarlar da hemen değişiyordu
    // -- kör bahisler/aksiyon süresi DEVAM EDEN elde anlık değişip mevcut
    // minArtirma/sayaç hesaplarıyla tutarsız kalabiliyordu. Artık aktif bir
    // el sürerken yalnız modül seviyesindeki masaAyarlari güncellenir; bu,
    // bir sonraki elin kurulumunda (holdemEliBaslat) zaten kullanılır.
    const elAktifMi = previewMasa && HOLDEM_AKTIF_DURUMLAR.has(previewMasa.durum);
    if (masayaOturdu && previewMasa && !elAktifMi) {
      previewMasa = { ...previewMasa, ayarlar: masaAyarlari };
      demoEkraniEsitle();
    } else if (!masayaOturdu) { lobiGorunumuOlustur(); }
    renderMasa();
  });
}

function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function cipYolu(miktar) { const i = CIP_DEGERLERI.indexOf(miktar); return '/assets/blackjack/cipler/' + (CIP_GORSELLERI[i] || CIP_GORSELLERI[0]) + '.png'; }
function rutbeNo(r) { return r === 'as' ? '01' : r === 'joker' ? '11' : r === 'kiz' ? '12' : r === 'papaz' ? '13' : String(r).padStart(2, '0'); }
function kartAdi(r) { return r === 'as' ? 'as' : r === 'joker' ? 'joker' : r === 'kiz' ? 'kiz' : r === 'papaz' ? 'papaz' : String(r); }
function guvenliTema(cardSkin = skin) { return /^koleksiyon-(ac|au|bug|c7|cl|cr|cyp|d2|dbd|ds|dtd|eg|fo|pc|r|sk|stp|sts|sv|tboi|tw|vs|wf|xr)-(1|2)$/.test(cardSkin.yuzKartiTemasi || '') ? cardSkin.yuzKartiTemasi : ''; }
function kartYolu(kart, kapali = false, cardSkin = skin) {
  if (kapali) { return '/assets/blackjack/deste-arkalari/deste-arkasi-' + (/^(0[1-9]|1[0-8])$/.test(cardSkin.desteArkasi || '') ? cardSkin.desteArkasi : '01') + '.png'; }
  const tema = guvenliTema(cardSkin);
  if (tema && ['joker', 'kiz', 'papaz'].includes(kart.r)) { return '/assets/blackjack/yuz-kartlari-koleksiyon/' + tema + '-' + kart.r + '.png'; }
  const stil = ['temel', 'altin', 'celik'].includes(cardSkin.desteStili) ? cardSkin.desteStili : 'temel';
  return '/assets/blackjack/kartlar/varsayilan/' + stil + '/' + rutbeNo(kart.r) + '-' + kartAdi(kart.r) + '-' + kart.s + '.png';
}
function kartHtml(kart, kapali = false, cardSkin = skin) { return '<img class="holdem-kart" draggable="false" src="' + kartYolu(kart, kapali, cardSkin) + '" alt="' + (kapali ? 'Kapalı kart' : escapeHtml(kartAdi(kart.r) + ' ' + kart.s)) + '">'; }
function cüzdanYolu(uid) { return dbPath('cipBakiyeleri/' + uid); }
function cüzdanDegeri(value) { return typeof value === 'number' ? value : Number(value && value.bakiye) || 0; }
function cüzdanNormalle(value, uid = currentUser?.uid || '') {
  if (typeof value === 'number') {
    const migrasyonId = 'blackjack:migrasyon:' + uid;
    return { bakiye: Math.max(0, value), sonIslemId: migrasyonId, islemler: { [migrasyonId]: { delta: value, kaynak: 'migrasyon', ts: Date.now() } }, legacyMi: true };
  }
  return {
    bakiye: Math.max(0, Number(value?.bakiye) || 0),
    sonIslemId: typeof value?.sonIslemId === 'string' ? value.sonIslemId : '',
    islemler: value?.islemler && typeof value.islemler === 'object' ? { ...value.islemler } : {},
    legacyMi: false
  };
}
// Çip cüzdanı Blackjack ile ortaktır. Yeni kullanıcıda önce onun izin verilen
// bootstrap kaydı açılır; Hold'em doğrudan boş bir cüzdandan ücret çekmez.
function cüzdanHazirla(uid) {
  if (!database || !uid) { return Promise.reject(new Error('Cüzdan bağlantısı kurulamadı.')); }
  const bootstrapId = 'blackjack:bootstrap:' + uid;
  return database.ref(cüzdanYolu(uid)).transaction((mevcut) => {
    if (mevcut === null || mevcut === undefined) {
      return { bakiye: 1000, sonIslemId: bootstrapId, islemler: { [bootstrapId]: { delta: 1000, kaynak: 'baslangic', ts: Date.now() } } };
    }
    const cüzdan = cüzdanNormalle(mevcut, uid);
    if (cüzdan.legacyMi) {
      const { legacyMi: _legacyMi, ...migrasyon } = cüzdan;
      return migrasyon;
    }
  }, undefined, false);
}
function cüzdanGuncelle(delta, islemId, kaynak) {
  if (!database || !currentUser || !Number.isInteger(delta)) { return Promise.resolve({ committed: false }); }
  let yetersiz = false;
  const uid = currentUser.uid;
  const ref = database.ref(cüzdanYolu(uid));
  return cüzdanHazirla(uid).then(() => ref.transaction((mevcut) => {
    const cüzdan = cüzdanNormalle(mevcut, uid);
    if (cüzdan.islemler[islemId]) { return; }
    const bakiye = cüzdan.bakiye + delta;
    if (bakiye < 0) { yetersiz = true; return; }
    const islemler = { ...cüzdan.islemler };
    const anahtarlar = Object.keys(islemler);
    if (anahtarlar.length >= CIP_ISLEM_KAYIT_LIMITI) {
      anahtarlar.sort((a, b) => (islemler[a].ts || 0) - (islemler[b].ts || 0));
      delete islemler[anahtarlar[0]];
    }
    islemler[islemId] = { delta, kaynak, ts: Date.now() };
    return { bakiye, sonIslemId: islemId, islemler };
  }, undefined, false)).then((sonuc) => {
    const tekrar = Boolean(cüzdanNormalle(sonuc.snapshot?.val(), uid).islemler[islemId]);
    return { committed: sonuc.committed || tekrar, yetersiz };
  }).catch((hata) => {
    console.error('Hold’em çip işlemi tamamlanamadı:', hata);
    return { committed: false, yetersiz, hata };
  });
}
function masaGirisiniOde(sonrasi) {
  if (masaGirisiOdendi) { sonrasi(); return; }
  if (masaCuzdanIslemiBekliyor) { return; }
  if (!currentUser) { showToast('Masaya oturmak için giriş yapmalısın.', { variant: 'error' }); return; }
  masaCuzdanIslemiBekliyor = true;
  // Buy-in yok: oyuncunun gerçek site bakiyesi masadaki stack'idir. Cüzdandan
  // girişte para ayrılmaz; el sonunda yalnız net kazanç veya kayıp yazılır.
  cüzdanHazirla(currentUser.uid).then(() => database.ref(cüzdanYolu(currentUser.uid)).once('value')).then((snap) => {
    masaBaslangicBakiyesi = cüzdanDegeri(snap.val());
    if (masaBaslangicBakiyesi < masaAyarlari.buyukKor) { showToast('Masaya oturmak için büyük kör bahis kadar çipin olmalı.', { variant: 'error' }); return; }
    masaGirisiOdendi = true;
    sonrasi();
  }).catch((hata) => {
    console.error('Hold’em cüzdanı okunamadı:', hata);
    const mesaj = hata?.code === 'PERMISSION_DENIED' ? 'Çip cüzdanı için yazma izni yok. Hesap rolünü ve Firebase kuralını kontrol edin.' : 'Site çip bakiyene erişilemedi.';
    showToast(mesaj, { variant: 'error' });
  }).finally(() => { masaCuzdanIslemiBekliyor = false; renderMasa(); });
}
function elSonuCuzdanaAktar() {
  if (!masayaOturdu || !masaGirisiOdendi || !previewMasa || previewMasa.durum !== 'el_sonucu' || masaCuzdanIslemiBekliyor) { return; }
  const masaSonu = Math.max(0, Number(previewMasa.koltuklar[3]?.masaBakiyesi) || 0);
  const net = masaSonu - masaBaslangicBakiyesi;
  const islemId = 'holdem:' + (currentUser?.uid || 'misafir') + ':el:' + previewMasa.desteId + ':net';
  if (!net) { masaGirisiOdendi = false; yerelMasaKaydet(); return; }
  masaCuzdanIslemiBekliyor = true;
  cüzdanGuncelle(net, islemId, 'holdem-el-sonucu').then((sonuc) => {
    if (sonuc.committed) { masaGirisiOdendi = false; yerelMasaKaydet(); showToast((net > 0 ? '+' : '') + net.toLocaleString('tr-TR') + ' çip site bakiyene işlendi.', { variant: net > 0 ? 'success' : 'info' }); }
    else { showToast('El sonu çip aktarımı tamamlanamadı; sayfayı açık tutun.', { variant: 'error' }); }
  }).finally(() => { masaCuzdanIslemiBekliyor = false; renderMasa(); });
}

function renderKombinasyonlar() {
  const list = document.querySelector('[data-holdem-kombinasyon-listesi]');
  if (!list) {return;}
  list.innerHTML = KOMBINASYONLAR.map(([ad, aciklama]) => '<div class="holdem-kombinasyon-satir"><strong>' + ad + '</strong><span>' + aciklama + '</span></div>').join('');
}
function renderCanliKombinasyon(hand) {
  const panel = document.querySelector('[data-holdem-canli-kombinasyon]');
  if (!panel) { return; }
  if (!hand) {
    panel.innerHTML = '<span class="holdem-canli-kombinasyon-baslik">Kombinasyonlar</span><p>Yerde en az üç kart açıldığında en iyi elin burada vurgulanır.</p>';
    return;
  }
  panel.innerHTML = '<span class="holdem-canli-kombinasyon-baslik">Kombinasyonlar</span><div class="holdem-canli-kombinasyon-listesi">' +
    KOMBINASYONLAR.map(([ad]) => '<button class="holdem-canli-kombinasyon-satir' + (ad === hand.turAdi ? ' is-active' : '') + '" type="button" data-holdem-kombinasyon-ac' + (ad === hand.turAdi ? ' aria-current="true"' : '') + '>' + escapeHtml(ad) + '</button>').join('') +
    '</div>';
}
function aksiyonMetni(aksiyon) {
  return ({ fold: 'Pas', check: 'Check', call: 'Gördü', raise: 'Artırdı', bet: 'Bahis yaptı', all_in: 'All-in' }[aksiyon] || '');
}
function elSonucuMetni() {
  const odeme = previewMasa?.sonuclar?.odemeler?.[3] || 0;
  const ben = previewMasa?.koltuklar?.[3];
  if (!masayaOturdu) { return 'El bitti · Kartlar açıldı'; }
  if (ben?.pas) { return 'El bitti · Bu eli pas geçtin'; }
  return odeme > 0 ? 'Kazandın · ' + odeme.toLocaleString('tr-TR') + ' çip pot aldın' : 'Kaybettin · Rakibin potu aldı';
}
function renderMasa() {
  if (!demoEl) { lobiGorunumuOlustur(); }
  const root = document.querySelector('[data-holdem-root]');
  if (root && demoEl.desteId) { root.dataset.holdemDesteId = demoEl.desteId; }
  const ownSeat = demoEl.koltuklar[3];
  if (masayaOturdu) { ownSeat.isim = currentUserName; }
  const all = ownSeat.kartlar.concat(demoEl.ortakKartlar);
  // İzleyici modunda botun kapalı kartlarından kullanıcıya kombinasyon
  // çıkarılmaz; panel yalnız masaya oturan kişinin gerçek eli için çalışır.
  const hand = masayaOturdu && all.length >= 5 ? holdemElDegerlendir(all) : null;
  renderCanliKombinasyon(hand);
  const pot = document.querySelector('[data-holdem-pot]');
  if (pot) {pot.innerHTML = '<small>Pot</small><span>' + demoEl.pot + ' çip</span>';}
  const board = document.querySelector('[data-holdem-ortak-kartlar]');
  if (board) {board.innerHTML = demoEl.ortakKartlar.map((k) => kartHtml(k)).join('') + Array.from({ length: 5 - demoEl.ortakKartlar.length }, () => '<span class="holdem-kart-yuva" aria-hidden="true"></span>').join('');}
  const showdown = previewMasa?.durum === 'el_sonucu';
  const aktifSure = previewMasa?.aksiyonBitis ? Math.max(0, Math.min(1, (previewMasa.aksiyonBitis - Date.now()) / previewMasa.ayarlar.aksiyonSuresiMs)) : 0;
  const seats = document.querySelector('[data-holdem-koltuklar]');
  if (seats) {seats.innerHTML = demoEl.koltuklar.map((seat, index) => {
    const mine = masayaOturdu && index === 3;
    const avatar = mine ? renderStaffAvatar(currentUserName, currentUser && currentUser.uid, currentUserName, 56) : '<span class="staff-avatar staff-avatar--initial" aria-hidden="true">' + escapeHtml(seat.isim.charAt(0)) + '</span>';
    const pasGecti = seat.pas && !mine;
    const kartlariAc = mine || (showdown && masayaOturdu && !pasGecti);
    const cards = pasGecti ? '' : kartlariAc ? seat.kartlar.map((k) => kartHtml(k, false, seat.skin || skin)).join('') : kartHtml({ r: 'as', s: 'kupa' }, true, seat.skin || skin) + kartHtml({ r: 'as', s: 'kupa' }, true, seat.skin || skin);
    const cardsBlock = '<div class="holdem-kartlarim' + (pasGecti ? ' holdem-kartlarim-pas' : '') + '">' + cards + '</div>';
    const betBlock = seat.bahis ? '<span class="holdem-yatirim"><img src="' + cipYolu(seat.bahis) + '" alt="">' + seat.bahis + '</span>' : '';
    const identityBlock = '<div class="holdem-avatar">' + avatar + '</div><strong>' + escapeHtml(seat.isim) + '</strong>' +
      '<span>' + seat.bakiye.toLocaleString('tr-TR') + ' çip</span>' +
      (seat.rozet && !mine ? '<span class="holdem-rol-rozet">' + escapeHtml(seat.rozet) + '</span>' : '');
    const playerHand = mine && hand ? '<span class="holdem-aktif-el">' + escapeHtml(hand.turAdi) + '</span>' : '';
    const kazanan = showdown && (previewMasa?.sonuclar?.odemeler?.[index] || 0) > 0;
    const aksiyon = pasGecti ? '<span class="holdem-pas-rozet">Pas geçti</span>' : !showdown && seat.sonAksiyon ? '<span class="holdem-son-aksiyon">' + aksiyonMetni(seat.sonAksiyon) + '</span>' : '';
    const sonuc = kazanan ? '<span class="holdem-kazanan-rozet">Pot aldı</span>' : '';
    const aktif = demoEl.siradaki === index;
    const sureStili = aktif ? ' style="--holdem-tur-orani:' + aktifSure.toFixed(4) + '"' : '';
    return '<article class="holdem-koltuk' + (mine ? ' holdem-koltuk-ben' : '') + (aktif ? ' holdem-koltuk-aktif' : '') + (kazanan ? ' holdem-koltuk-kazanan' : '') + (showdown ? ' holdem-koltuk-showdown' : '') + '" data-slot="' + index + '"' + sureStili + '>' +
      (mine ? cardsBlock + playerHand + identityBlock + aksiyon + sonuc : identityBlock + cardsBlock + betBlock + aksiyon + sonuc) + '</article>';
  }).join('');}
  const handInfo = document.querySelector('[data-holdem-el-bilgisi]');
  if (handInfo) {handInfo.innerHTML = hand ? escapeHtml(hand.turAdi) + '<small>Şu anki en iyi elin</small>' : '<small>Kombinasyon için flop bekleniyor</small>';}
  const turn = document.querySelector('[data-holdem-sira-bildirimi]');
  if (turn) {turn.textContent = !masayaOturdu ? (katilimBekliyor ? 'El bitince masaya oturacaksın' : showdown ? elSonucuMetni() : 'Botlar oynuyor · Masaya oturabilirsin') : showdown ? elSonucuMetni() : demoEl.siradaki === 3 ? 'Sıra sende · Gör ya da artır' : demoEl.koltuklar[demoEl.siradaki]?.isim + ' düşünüyor';}
  const actions = document.querySelector('[data-holdem-aksiyonlar]');
  const benimSiram = previewMasa && previewMasa.aktifKoltuk === 3 && ['preflop', 'flop', 'turn', 'river'].includes(previewMasa.durum);
  const kendi = previewMasa?.koltuklar[3];
  const toCall = kendi ? Math.max(0, previewMasa.mevcutBahis - kendi.sokakYatirimi) : 0;
  if (actions) {actions.innerHTML = '<button class="btn" type="button" data-holdem-aksiyon="fold"' + (benimSiram ? '' : ' disabled') + '>Pas</button><button class="btn" type="button" data-holdem-aksiyon="' + (toCall ? 'call' : 'check') + '"' + (benimSiram ? '' : ' disabled') + '>' + (toCall ? 'Gör · ' + toCall : 'Check') + '</button><button class="btn" type="button" data-holdem-aksiyon="raise"' + (benimSiram ? '' : ' disabled') + '>Artır</button><button class="btn" type="button" data-holdem-aksiyon="all_in"' + (benimSiram ? '' : ' disabled') + '>All-in</button>';}
  const raise = document.querySelector('[data-holdem-artirma-alani]');
  const minRaise = kendi ? Math.min(kendi.sokakYatirimi + kendi.masaBakiyesi, previewMasa.mevcutBahis + previewMasa.minArtirma) : 0;
  const maxRaise = kendi ? kendi.sokakYatirimi + kendi.masaBakiyesi : 0;
  if (raise) {raise.innerHTML = '<label><span class="sr-only">Artırma miktarı</span><input data-holdem-raise type="range" min="' + minRaise + '" max="' + maxRaise + '" value="' + minRaise + '"' + (benimSiram ? '' : ' disabled') + '></label><label class="holdem-raise-number"><span>Artırma</span><input data-holdem-raise-number type="number" min="' + minRaise + '" max="' + maxRaise + '" step="1" value="' + minRaise + '"' + (benimSiram ? '' : ' disabled') + '></label><output data-holdem-raise-output>' + minRaise + ' çip</output>';}
  const durum = document.querySelector('[data-holdem-durum]');
  if (durum) {
    const saniye = previewMasa?.aksiyonBitis ? Math.max(0, Math.ceil((previewMasa.aksiyonBitis - Date.now()) / 1000)) : 0;
    durum.textContent = !masayaOturdu ? (katilimBekliyor ? 'El bitince masaya oturacaksın.' : showdown ? elSonucuMetni() : 'Botlar oynuyor · Katılmak için masaya otur.') : showdown ? elSonucuMetni() : (demoEl.siradaki === 3 ? 'Sıra sende · ' + saniye + ' sn' : demoEl.koltuklar[demoEl.siradaki]?.isim + ' düşünüyor · ' + saniye + ' sn');
  }
  const join = document.querySelector('[data-holdem-masaya-otur]');
  const yeniEl = document.querySelector('[data-holdem-yeni-el]');
  if (join) { join.hidden = masayaOturdu || katilimBekliyor; }
  if (yeniEl) {
    yeniEl.hidden = !masayaOturdu || previewMasa?.durum !== 'el_sonucu';
    // El sonucu cüzdana yazılırken ikinci bir elin başlaması, yeni elin
    // masa-girişi durumunu eski ödemenin finally bloğuyla ezebiliyordu.
    // Ödeme motoru tamamlanana kadar düğme yalnız arayüzden pasiftir.
    yeniEl.disabled = masaCuzdanIslemiBekliyor;
    yeniEl.setAttribute('aria-busy', masaCuzdanIslemiBekliyor ? 'true' : 'false');
  }
}

function siraSaatiniBaslat() {
  if (siraSaati) { return; }
  siraSaati = setInterval(() => {
    if (!previewMasa || !masayaOturdu || !previewMasa.aksiyonBitis) { return; }
    if (Date.now() >= previewMasa.aksiyonBitis && previewMasa.aktifKoltuk === 3) {
      const own = previewMasa.koltuklar[3];
      const action = previewMasa.mevcutBahis > own.sokakYatirimi ? 'fold' : 'check';
      previewMasa = holdemAksiyonUygula(previewMasa, { koltukIndex: 3, aksiyon: action }, Date.now());
      demoEkraniEsitle(); renderMasa(); botTurunuPlanla();
    } else {
      // Sürgüyü/number input'u yeniden oluşturmadan sadece sayaç ve avatar
      // halkasını güncelle. Aksi halde kullanıcı artırma tutarını sürüklerken
      // DOM her saniye yenileniyor ve kontrol hareket etmiyordu.
      const oran = Math.max(0, Math.min(1, (previewMasa.aksiyonBitis - Date.now()) / previewMasa.ayarlar.aksiyonSuresiMs));
      const aktif = document.querySelector('.holdem-koltuk-aktif');
      if (aktif) { aktif.style.setProperty('--holdem-tur-orani', oran.toFixed(4)); }
      const durum = document.querySelector('[data-holdem-durum]');
      if (durum && previewMasa.aktifKoltuk === 3) { durum.textContent = 'Sıra sende · ' + Math.max(0, Math.ceil((previewMasa.aksiyonBitis - Date.now()) / 1000)) + ' sn'; }
    }
  }, 1000);
}

function loadSkin(uid) {
  if (!database || !uid) {return;}
  database.ref('blackjackAyarlari/' + uid).once('value').then((snap) => {
    const next = snap.val() || {};
    skin = Object.assign(skin, next);
    renderMasa();
  }).catch(() => {});
}
function subscribeWallet(uid) {
  if (!database || !uid) {return;}
  database.ref(cüzdanYolu(uid)).on('value', (snap) => {
    const balance = cüzdanDegeri(snap.val());
    const el = document.querySelector('[data-holdem-bakiye]');
    if (el) {el.textContent = balance.toLocaleString('tr-TR') + ' çip';}
    if (!snap.exists() || cüzdanNormalle(snap.val(), uid).legacyMi) { cüzdanHazirla(uid).catch((hata) => console.error('Hold’em başlangıç cüzdanı açılamadı:', hata)); }
  });
}
function bindUi() {
  document.addEventListener('click', (event) => {
    const open = event.target.closest('[data-holdem-kombinasyon-ac]');
    const close = event.target.closest('[data-holdem-kombinasyon-kapat]');
    const modal = document.querySelector('[data-holdem-kombinasyon-modal]');
    if (open && modal && !modal.open) {modal.showModal();}
    if (close && modal && modal.open) {modal.close();}
    if (event.target.closest('[data-holdem-yeni-el]')) {
      if (previewMasa?.durum !== 'el_sonucu') { return; }
      masaGirisiniOde(() => {
        yeniDemoEliOlustur();
        renderMasa();
        botTurunuPlanla();
      });
    }
    if (event.target.closest('[data-holdem-masaya-otur]') && !masayaOturdu) {
      masaGirisiniOde(() => {
        katilimBekliyor = true;
        renderMasa();
      });
    }
    const aksiyon = event.target.closest('[data-holdem-aksiyon]')?.dataset.holdemAksiyon;
    if (aksiyon && previewMasa && previewMasa.aktifKoltuk === 3) {
      const miktar = Number(document.querySelector('[data-holdem-raise-number]')?.value || document.querySelector('[data-holdem-raise]')?.value || 0);
      try {
        previewMasa = holdemAksiyonUygula(previewMasa, { koltukIndex: 3, aksiyon, miktar }, Date.now());
        demoEkraniEsitle(); renderMasa(); botTurunuPlanla();
      } catch (err) { showToast(err.message || 'Bu hamle yapılamaz.', { variant: 'error' }); }
    }
    if (event.target.closest('[data-holdem-masa-ayarlari]')) { masaAyarlariniAc(); }
  });
  document.addEventListener('change', (event) => {
    const select = event.target.closest('[data-holdem-bot-zorlugu]');
    if (!select || !HOLDEM_ZORLUKLARI[select.value]) { return; }
    botZorlugu = select.value;
    try { globalThis.localStorage.setItem('holdem.botZorlugu', botZorlugu); } catch {}
    // Zorluk seçimi eldeki kartları/sıra akışını sıfırlamamalı. Mevcut
    // botların sonraki kararlarına yeni profil uygulanır; yeni el de zaten
    // bu genel seçimle kurulur. Böylece izleyici masasındaki timer da kesilmez.
    if (previewMasa) {
      previewMasa = {
        ...previewMasa,
        koltuklar: previewMasa.koltuklar.map((koltuk) => koltuk.bot ? { ...koltuk, zorluk: botZorlugu } : koltuk)
      };
      demoEkraniEsitle();
    }
    renderMasa();
  });
  document.addEventListener('input', (event) => {
    const input = event.target.closest('[data-holdem-raise], [data-holdem-raise-number]');
    const output = document.querySelector('[data-holdem-raise-output]');
    if (input && output) {
      const min = Number(input.min); const max = Number(input.max);
      const value = Math.max(min, Math.min(max, Number(input.value) || min));
      const slider = document.querySelector('[data-holdem-raise]');
      const number = document.querySelector('[data-holdem-raise-number]');
      if (slider) { slider.value = String(value); }
      if (number) { number.value = String(value); }
      output.textContent = value + ' çip';
    }
  });
}

export function initHoldem() {
  const firebase = globalThis.firebase;
  if (!firebase) {return;}
  if (!firebase.apps.length) {firebase.initializeApp(FIREBASE_CONFIG);}
  database = firebase.database();
  botZorlugu = kayitliZorluguAl();
  const zorlukSecici = document.querySelector('[data-holdem-bot-zorlugu]');
  if (zorlukSecici) { zorlukSecici.value = botZorlugu; }
  renderKombinasyonlar();
  lobiGorunumuOlustur();
  renderMasa();
  bindUi();
  siraSaatiniBaslat();
  botTurunuPlanla();
  firebase.auth().onAuthStateChanged(async (user) => {
    currentUser = user;
    if (!user) { currentUserRole = ''; masaAyariButonunuGuncelle(); renderMasa(); return; }
    try {
      await initDbMode(database);
      renderDbModeBanner();
      const profile = await database.ref('users/' + user.uid).once('value');
      const p = profile.val() || {};
      currentUserRole = p.role || '';
      masaAyariButonunuGuncelle();
      currentUserName = ((p.firstName || '') + ' ' + (p.lastName || '')).trim() || user.email || 'Sen';
      if (yerelMasaYukle()) {
        if (botTuruTimer) { clearTimeout(botTuruTimer); botTuruTimer = null; }
        renderMasa();
        botTurunuPlanla();
      }
      subscribeStaffProfiles(database);
      subscribeWallet(user.uid);
      loadSkin(user.uid);
      masaAyarlariniDinle();
      renderMasa();
    } catch {
      renderMasa();
    }
  });
}
