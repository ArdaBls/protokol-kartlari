// Texas Hold'em saha katmanı -- Blackjack/Pişti ile AYNI mimari (Firebase
// Realtime Database transaction'ı, "kim dağıtıyor" yarışını çözen tek
// paylaşılan masa, terk edilmiş masa kurtarma). Önceki sürüm yerel/bot
// simülasyonuydu (kullanıcı yalnız botlara karşı oynuyordu, zorluk ayarı
// sadece o tarayıcıda geçerliydi); kullanıcı isteği üzerine GERÇEK çok
// oyunculu bir masaya çevrildi -- bot YOK, en az 2 gerçek oyuncu gerekir.
// Poker motoru (kart değerlendirme, bahis turu, side-pot, kör bahis
// döngüsü) zaten DOM/Firebase'den bağımsız saf fonksiyonlar olarak
// holdem-masa-oyun.js'de vardı (hiç kullanılmıyordu) -- burada sadece
// gerçek bir paylaşılan masaya bağlanıyor.
import { dbPath, isReadOnly, initDbMode, renderDbModeBanner } from './db-mode.js';
import { showModal } from './modal.js';
import { showToast } from './toast.js';
import { subscribeStaffProfiles, renderStaffAvatar } from './staff-profiles.js';
import { holdemElDegerlendir } from './holdem-engine.js';
import {
  holdemAksiyonUygula, holdemAyarlariNormalle, holdemBosCanliMasa, holdemEliBaslat,
  holdemVarsayilanAyarlaraDon, holdemKatilimTalebi, holdemElSonuKuyruguUygula
} from './holdem-masa-oyun.js';

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
// Masa ayarları (kör bahisler/aksiyon süresi) hâlâ bu admin yoluyla -- bu,
// oyunBasarimlari/$oyunAdi joker kuralının İÇİNDE $oyunAdi==='holdem' özel
// durumuyla zaten yazılabiliyor, canlı masadan TAMAMEN bağımsız bir dal.
const MASA_AYAR_YOLU = 'oyunBasarimlari/holdem/ayarlar/ana-masa';
const CIP_ISLEM_KAYIT_LIMITI = 80;
const MASA_ID = 'ana-masa';
// NOT: Pişti'de öğrenilen ders -- oyunBasarimlari/$oyunAdi altındaki
// masalar/$masaId kuralı BAŞKA bir oyuna (Blackjack) özel şemayla yazılı;
// aynı yoldaki joker+literal .validate kuralları BİRLEŞİP hepsi geçmek
// zorunda kalırdı. Kendi tepe-seviye dalımızı kullanıyoruz.
const MASA_YOLU = 'holdem/masalar/' + MASA_ID;
const AKTIF_DURUMLAR = new Set(['preflop', 'flop', 'turn', 'river']);
const EL_SONU_BEKLEME_MS = 4000;
// Firebase kuralındaki (masalar/$masaId .write) "guncellemeTs 120 saniyeden
// eskiyse koltukta oturmayan biri de yazabilir" kurtarma cümlesiyle eşleşir.
const TERK_EDILME_MS = 130000;
// Görüntüleme sırası: 3 numaralı slot HER ZAMAN "ben" (alt orta) -- diğerleri
// saat yönünde 4,0,1,2. Gerçek koltuk indeksleri (dagitici/aktifKoltuk/vs.)
// bundan bağımsız, sadece EKRANDA nereye çizileceğini belirler.
const GOSTERIM_SIRASI = [3, 4, 0, 1, 2];

let database = null;
let currentUser = null;
let currentUserUid = '';
let currentUserName = 'Sen';
let currentUserRole = '';
let skin = { desteStili: 'temel', yuzKartiTemasi: 'varsayilan', desteArkasi: '01' };
let canPlay = false;
let modeReady = false;

let currentTable = null;
let masaVerisiGeldi = false;
let tableRef = null;
let tableListener = null;
let attachedTablePath = '';
let phaseWatchdog = null;
let pendingTableOperation = null;
let playerActionPending = false;
let tableError = '';

let masaAyarlari = holdemVarsayilanAyarlaraDon();
let masaAyarRef = null;

let masaCuzdanIslemiBekliyor = false;
// Her elin sonunda BENİM masaBakiyesi'mdeki net değişim site cüzdanıma
// yazılır (Blackjack'teki gibi el-bazlı, idempotent işlem kimliğiyle).
// Baz değer, en son ayarlandığım andaki bakiyem -- bir sonraki elin net'i
// bu bazdan hesaplanır.
let sonAyarlananBakiye = 0;
let sonAyarlananElNo = -1;
let turnCountdownTimer = null;

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
function aksiyonMetni(aksiyon) { return ({ fold: 'Pas', check: 'Check', call: 'Gördü', raise: 'Artırdı', bet: 'Bahis yaptı', all_in: 'All-in' }[aksiyon] || ''); }

// ── Çip cüzdanı (Blackjack ile ORTAK) ──
function cüzdanYolu(uid) { return dbPath('cipBakiyeleri/' + uid); }
function cüzdanDegeri(value) { return typeof value === 'number' ? value : Number(value && value.bakiye) || 0; }
function cüzdanNormalle(value, uid) {
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

// ── Masa bağlantısı (Pişti/Blackjack ile AYNI desen) ──
function masaBaglami() { return { yol: dbPath(MASA_YOLU), uid: currentUserUid }; }
function masaHatasi(err) {
  // Teşhis: gerçek Firebase'de bu hatanın kesin nedeni konsolsuz
  // görülemiyor -- tam hata loglanıyor, ekrandaki mesaja kod ekleniyor.
  console.error('Hold’em masa hatası:', err);
  const kod = err && (err.code || err.name || '');
  tableError = err && err.code === 'PERMISSION_DENIED'
    ? 'Masa güncellenemedi: oyun için yazma izni bulunmuyor.'
    : 'Masa güncellenemedi. Bağlantınızı kontrol edip tekrar deneyin.' + (kod ? ' (' + kod + ')' : '');
  renderIslemDurumu();
}
function masaIslemi(guncelle, baglam = masaBaglami()) {
  if (pendingTableOperation || tableError || !canPlay || !modeReady || isReadOnly()) {
    return Promise.resolve({ committed: false, beklemede: true });
  }
  const islem = { baglam };
  pendingTableOperation = islem;
  renderIslemDurumu();
  return Promise.resolve().then(() => database.ref(baglam.yol).transaction((mevcut) => {
    if (baglam.uid !== currentUserUid || baglam.yol !== dbPath(MASA_YOLU) || isReadOnly()) { return; }
    return guncelle(mevcut ? JSON.parse(JSON.stringify(mevcut)) : mevcut);
  }, undefined, false)).catch((err) => {
    if (baglam.uid === currentUserUid && baglam.yol === dbPath(MASA_YOLU)) { masaHatasi(err); }
    return { committed: false, hata: err };
  }).finally(() => {
    if (pendingTableOperation === islem) { pendingTableOperation = null; }
    renderIslemDurumu();
  });
}
function oyuncuIslemi(islem) {
  if (playerActionPending || pendingTableOperation || tableError || !canPlay || !modeReady) { return; }
  playerActionPending = true;
  renderIslemDurumu();
  Promise.resolve().then(islem).catch(masaHatasi).finally(() => {
    playerActionPending = false;
    renderIslemDurumu();
  });
}
function benimKoltukIndex(table) {
  if (!table || !Array.isArray(table.koltuklar)) { return -1; }
  return table.koltuklar.findIndex((koltuk) => koltuk && koltuk.uid === currentUserUid);
}

// ── Oturma / kalkma ──
function otur() {
  if (!canPlay) { showToast('Oynamak için giriş yapmalısınız.', { variant: 'error' }); return; }
  if (masaCuzdanIslemiBekliyor) { return; }
  masaCuzdanIslemiBekliyor = true;
  cüzdanHazirla(currentUserUid).then(() => database.ref(cüzdanYolu(currentUserUid)).once('value')).then((snap) => {
    const bakiye = cüzdanDegeri(snap.val());
    const kor = (currentTable && currentTable.ayarlar && currentTable.ayarlar.buyukKor) || masaAyarlari.buyukKor;
    if (bakiye < kor) { showToast('Masaya oturmak için büyük kör bahis kadar çipin olmalı.', { variant: 'error' }); return; }
    return masaIslemi((mevcut) => {
      const taban = mevcut || holdemBosCanliMasa({ ayarlar: masaAyarlari });
      if (benimKoltukIndex(taban) !== -1) { return; }
      const yeniKoltuk = { uid: currentUserUid, isim: currentUserName, bot: false, zorluk: 'normal', skin, masaBakiyesi: bakiye, bagli: true, ayrilacak: false };
      if (taban.durum === 'lobi') {
        const koltuklar = (taban.koltuklar || []).concat([yeniKoltuk]);
        if (koltuklar.length > taban.ayarlar.masaKapasitesi) { return; }
        return Object.assign({}, taban, { koltuklar, guncellemeTs: Date.now() });
      }
      // El sürüyor -- sıraya eklenir, el bitince holdemElSonuKuyruguUygula koltuğa geçirir.
      return Object.assign({}, holdemKatilimTalebi(taban, yeniKoltuk), { guncellemeTs: Date.now() });
    }).then((res) => {
      if (res && res.committed) { sonAyarlananBakiye = bakiye; sonAyarlananElNo = (currentTable && currentTable.elNo) || 0; }
      else if (res && !res.beklemede && !res.hata) { showToast('Masaya oturulamadı, masa dolu olabilir.', { variant: 'error' }); }
    });
  }).catch((hata) => {
    console.error('Hold’em cüzdanı okunamadı:', hata);
    const mesaj = hata?.code === 'PERMISSION_DENIED' ? 'Çip cüzdanı için yazma izni yok. Hesap rolünü ve Firebase kuralını kontrol edin.' : 'Site çip bakiyene erişilemedi.';
    showToast(mesaj, { variant: 'error' });
  }).finally(() => { masaCuzdanIslemiBekliyor = false; renderMasa(); });
}
function kalk() {
  masaIslemi((mevcut) => {
    if (!mevcut) { return; }
    const index = benimKoltukIndex(mevcut);
    if (index === -1) {
      const kuyruk = (mevcut.kuyruk || []).filter((kisi) => kisi.uid !== currentUserUid);
      if (kuyruk.length === (mevcut.kuyruk || []).length) { return; }
      return Object.assign({}, mevcut, { kuyruk, guncellemeTs: Date.now() });
    }
    if (AKTIF_DURUMLAR.has(mevcut.durum)) {
      // El sürüyor -- hemen koltuktan çıkarmak diğer oyuncuların potunu
      // bozar; yalnız "ayrılacak" işaretlenir, el bitince kuyruk mantığı
      // temizler. Sırası bense önce elim otomatik pas geçilir.
      let masa = mevcut;
      if (masa.aktifKoltuk === index) {
        try { masa = holdemAksiyonUygula(masa, { koltukIndex: index, aksiyon: 'fold' }, Date.now()); } catch { /* zaten oynanamaz durumda olabilir */ }
      }
      const koltuklar = masa.koltuklar.slice();
      koltuklar[index] = Object.assign({}, koltuklar[index], { ayrilacak: true, pas: true });
      return Object.assign({}, masa, { koltuklar, guncellemeTs: Date.now() });
    }
    const koltuklar = mevcut.koltuklar.filter((_, i) => i !== index);
    return Object.assign({}, mevcut, { koltuklar, guncellemeTs: Date.now() });
  });
}

// ── El sonu net çip aktarımı -- HER seatli istemci KENDİ uid'ine yazar
// (cipBakiyeleri kuralı auth.uid === $uid şartı koyuyor, başkasının
// cüzdanına yazılamaz). Zero-sum: herkes kendi delta'sını ayarladığından
// toplam ekonomi bozulmaz. ──
function belkiCuzdanAyarla(table) {
  if (!table || !currentUserUid || masaCuzdanIslemiBekliyor) { return; }
  const index = benimKoltukIndex(table);
  if (index === -1 || table.durum !== 'el_sonucu' || table.elNo === sonAyarlananElNo) { return; }
  const koltuk = table.koltuklar[index];
  const net = Math.round((koltuk.masaBakiyesi || 0) - sonAyarlananBakiye);
  const islemId = 'holdem:' + currentUserUid + ':el:' + table.elNo + ':net';
  if (!net) { sonAyarlananBakiye = koltuk.masaBakiyesi || 0; sonAyarlananElNo = table.elNo; return; }
  masaCuzdanIslemiBekliyor = true;
  cüzdanGuncelle(net, islemId, 'holdem-el-sonucu').then((sonuc) => {
    if (sonuc.committed) {
      sonAyarlananBakiye = koltuk.masaBakiyesi || 0; sonAyarlananElNo = table.elNo;
      showToast((net > 0 ? '+' : '') + net.toLocaleString('tr-TR') + ' çip site bakiyene işlendi.', { variant: net > 0 ? 'success' : 'info' });
    } else { showToast('El sonu çip aktarımı tamamlanamadı; sayfayı açık tutun.', { variant: 'error' }); }
  }).finally(() => { masaCuzdanIslemiBekliyor = false; renderMasa(); });
}

// ── Self-healing faz geçişi -- Pişti/Blackjack ile AYNI desen: hangi
// istemcinin transaction'ı önce commit ederse o kazanır, tek bir istemcinin
// zamanlayıcısına bağımlı değildir (.on('value') VE 1sn'lik watchdog'dan
// çağrılır). ──
function belkiSonrakiFazaGec(table) {
  if (!table || !canPlay || !modeReady || isReadOnly() || pendingTableOperation || playerActionPending || tableError) { return; }
  const now = Date.now();
  // Yalnız SEYİRCİLER için koruma: masa 'lobi' değilken (aktif bir el
  // sürüyorken) oturmamış biri bu transaction'ı denerse Firebase kuralı
  // reddeder (PERMISSION_DENIED) -- masayı seyreden herkesin ekranında
  // sürekli "izin yok" hatası görünür. Terk edilmiş masa kurtarma yolu
  // (130sn) istisna, o zaman oturmamış biri de kurtarabilmeli.
  const terkEdilmisMi = Boolean(table.guncellemeTs) && now - table.guncellemeTs > TERK_EDILME_MS;
  if (table.durum !== 'lobi' && benimKoltukIndex(table) === -1 && !terkEdilmisMi) { return; }
  if (table.durum === 'lobi') {
    if ((table.koltuklar || []).length < 2) { return; }
    masaIslemi((mevcut) => {
      if (!mevcut || mevcut.durum !== 'lobi' || (mevcut.koltuklar || []).length < 2) { return; }
      try { return holdemEliBaslat(Object.assign({}, mevcut, { ayarlar: masaAyarlari }), Date.now()); } catch { return; }
    });
    return;
  }
  if (AKTIF_DURUMLAR.has(table.durum) && table.aksiyonBitis && now >= table.aksiyonBitis && Number.isInteger(table.aktifKoltuk) && table.aktifKoltuk >= 0) {
    masaIslemi((mevcut) => {
      if (!mevcut || !AKTIF_DURUMLAR.has(mevcut.durum) || !mevcut.aksiyonBitis || Date.now() < mevcut.aksiyonBitis) { return; }
      const index = mevcut.aktifKoltuk;
      const koltuk = Number.isInteger(index) ? mevcut.koltuklar[index] : null;
      if (!koltuk) { return; }
      const toCall = Math.max(0, mevcut.mevcutBahis - koltuk.sokakYatirimi);
      try { return holdemAksiyonUygula(mevcut, { koltukIndex: index, aksiyon: toCall > 0 ? 'fold' : 'check' }, Date.now()); } catch { return; }
    });
    return;
  }
  if (table.durum === 'el_sonucu' && table.guncellemeTs && now - table.guncellemeTs >= EL_SONU_BEKLEME_MS) {
    masaIslemi((mevcut) => {
      if (!mevcut || mevcut.durum !== 'el_sonucu' || !mevcut.guncellemeTs || Date.now() - mevcut.guncellemeTs < EL_SONU_BEKLEME_MS) { return; }
      const kuyruklanmis = holdemElSonuKuyruguUygula(mevcut);
      if ((kuyruklanmis.koltuklar || []).length < 2) { return Object.assign({}, kuyruklanmis, { durum: 'lobi', guncellemeTs: Date.now() }); }
      try { return holdemEliBaslat(Object.assign({}, kuyruklanmis, { ayarlar: masaAyarlari }), Date.now()); }
      catch { return Object.assign({}, kuyruklanmis, { durum: 'lobi', guncellemeTs: Date.now() }); }
    });
  }
}

// ── Masa ayarları (admin) ──
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
    body: '<p class="hint">Bu ayarlar yalnız YENİ bir el başlarken uygulanır (sürmekte olan eli etkilemez). Oyuncu masaya site bakiyesinin tamamıyla oturur; giriş ücreti alınmaz.</p>' +
      '<div class="form-group"><label>Küçük kör bahis<input class="form-control" data-he-ayar-sb type="number" min="1" max="10000" step="1" value="' + ayar.kucukKor + '"></label></div>' +
      '<div class="form-group"><label>Büyük kör bahis<input class="form-control" data-he-ayar-bb type="number" min="2" max="20000" step="1" value="' + ayar.buyukKor + '"></label></div>' +
      '<p class="hint">Oyuncu sırası: 60 saniye. Süre dolarsa masa otomatik pas geçer/check yapar.</p>',
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
function masaAyarlariniDinle() {
  if (!database || masaAyarRef) { return; }
  masaAyarRef = database.ref(dbPath(MASA_AYAR_YOLU));
  masaAyarRef.on('value', (snap) => { masaAyarlari = holdemAyarlariNormalle(snap.val() || {}); });
}

// ── Görünüm sırası: BEN her zaman 3 numaralı (alt orta) slotta -- diğerleri
// saat yönünde, gerçek koltuk indeksinden bağımsız. ──
function gorunumEslesmesi(table) {
  const kapasite = (table.ayarlar && table.ayarlar.masaKapasitesi) || 5;
  const koltuklar = table.koltuklar || [];
  const benim = benimKoltukIndex(table);
  const sira = GOSTERIM_SIRASI.slice(0, kapasite);
  const sonuc = new Array(kapasite).fill(-1);
  const kalanSlotlar = sira.filter((s) => s !== 3);
  if (benim !== -1) {
    sonuc[3] = benim;
    const digerler = [];
    for (let adim = 1; adim < koltuklar.length; adim++) { digerler.push((benim + adim) % koltuklar.length); }
    digerler.forEach((gercekIndex, i) => { if (kalanSlotlar[i] !== undefined) { sonuc[kalanSlotlar[i]] = gercekIndex; } });
  } else {
    koltuklar.forEach((_, gercekIndex) => { if (kalanSlotlar[gercekIndex] !== undefined) { sonuc[kalanSlotlar[gercekIndex]] = gercekIndex; } });
  }
  return sonuc;
}
function elSonucuMetni(table, kendi, benim) {
  if (benim === -1 || !kendi) { return 'El bitti · Kartlar açıldı'; }
  if (kendi.pas) { return 'El bitti · Bu eli pas geçtin'; }
  const odeme = (table.sonuclar && table.sonuclar.odemeler && table.sonuclar.odemeler[benim]) || 0;
  return odeme > 0 ? 'Kazandın · ' + odeme.toLocaleString('tr-TR') + ' çip pot aldın' : 'Kaybettin · Rakibin potu aldı';
}

function renderKombinasyonlar() {
  const list = document.querySelector('[data-holdem-kombinasyon-listesi]');
  if (!list) { return; }
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
function renderIslemDurumu() {
  const durum = document.querySelector('[data-holdem-durum]');
  if (tableError && durum) { durum.textContent = tableError; }
  const tekrar = document.querySelector('[data-holdem-yeniden-dene]');
  if (tekrar) { tekrar.hidden = !tableError; }
  document.querySelectorAll('[data-holdem-root] button:not([data-holdem-yeniden-dene])').forEach((button) => {
    button.disabled = !!(tableError || pendingTableOperation || playerActionPending || !canPlay || isReadOnly());
  });
}
function renderMasa() {
  const root = document.querySelector('[data-holdem-root]');
  if (!masaVerisiGeldi) {
    const seats = document.querySelector('[data-holdem-koltuklar]');
    if (seats) { seats.innerHTML = ''; }
    const durum = document.querySelector('[data-holdem-durum]');
    if (durum && !tableError) { durum.textContent = 'Masa yükleniyor…'; }
    return;
  }
  // Masa Firebase'de HİÇ yok (ilk kez ziyaret edildi, henüz kimse oturmadı) --
  // 'lobi' durumunda boş bir masa gibi çiziyoruz (henüz yazılmıyor, sadece
  // oturma düğmesinin görünmesi için).
  const table = currentTable || holdemBosCanliMasa({ ayarlar: masaAyarlari });
  if (root && table.desteId) { root.dataset.holdemDesteId = table.desteId; }
  const benim = benimKoltukIndex(table);
  const benimSirada = benim !== -1;
  const kapasite = (table.ayarlar && table.ayarlar.masaKapasitesi) || 5;
  const eslesme = gorunumEslesmesi(table);
  const showdown = table.durum === 'el_sonucu';
  const kendi = benimSirada ? table.koltuklar[benim] : null;
  const all = kendi ? (kendi.kartlar || []).concat(table.communityCards || []) : [];
  const hand = kendi && all.length >= 5 ? holdemElDegerlendir(all) : null;
  renderCanliKombinasyon(hand);

  const pot = document.querySelector('[data-holdem-pot]');
  if (pot) { pot.innerHTML = '<small>Pot</small><span>' + (table.pot || 0) + ' çip</span>'; }
  const board = document.querySelector('[data-holdem-ortak-kartlar]');
  const ortak = table.communityCards || [];
  if (board) { board.innerHTML = ortak.map((k) => kartHtml(k)).join('') + Array.from({ length: 5 - ortak.length }, () => '<span class="holdem-kart-yuva" aria-hidden="true"></span>').join(''); }

  const aktifSure = table.aksiyonBitis && table.ayarlar ? Math.max(0, Math.min(1, (table.aksiyonBitis - Date.now()) / table.ayarlar.aksiyonSuresiMs)) : 0;
  const seats = document.querySelector('[data-holdem-koltuklar]');
  if (seats) {
    seats.innerHTML = eslesme.map((gercekIndex, slot) => {
      if (gercekIndex === -1) {
        if (slot === 3 && !benimSirada) {
          const doluMu = (table.koltuklar || []).length >= kapasite;
          return '<article class="holdem-koltuk holdem-koltuk-bos" data-slot="' + slot + '">' +
            (doluMu ? '<span class="holdem-koltuk-dolu">Masa dolu</span>' : '<button type="button" class="btn btn-primary" data-holdem-masaya-otur>Masaya otur</button>') + '</article>';
        }
        return '<article class="holdem-koltuk holdem-koltuk-bos" data-slot="' + slot + '"></article>';
      }
      const seat = table.koltuklar[gercekIndex];
      const mine = gercekIndex === benim;
      const avatar = mine
        ? renderStaffAvatar(currentUserName, currentUserUid, currentUserName, 56)
        : '<span class="staff-avatar staff-avatar--initial" aria-hidden="true">' + escapeHtml((seat.isim || '?').charAt(0)) + '</span>';
      const pasGecti = seat.pas && !mine;
      const kartlariAc = mine || (showdown && !seat.pas);
      const cards = (seat.pas && !showdown) ? '' : kartlariAc ? (seat.kartlar || []).map((k) => kartHtml(k, false, seat.skin || skin)).join('') : kartHtml({ r: 'as', s: 'kupa' }, true, seat.skin || skin) + kartHtml({ r: 'as', s: 'kupa' }, true, seat.skin || skin);
      const cardsBlock = '<div class="holdem-kartlarim' + (pasGecti ? ' holdem-kartlarim-pas' : '') + '">' + cards + '</div>';
      const betBlock = seat.sokakYatirimi ? '<span class="holdem-yatirim"><img src="' + cipYolu(seat.sokakYatirimi) + '" alt="">' + seat.sokakYatirimi + '</span>' : '';
      const rozet = gercekIndex === table.smallBlind ? 'Küçük kör bahis' : gercekIndex === table.bigBlind ? 'Büyük kör bahis' : '';
      const identityBlock = '<div class="holdem-avatar">' + avatar + '</div><strong>' + escapeHtml(seat.isim || '') + '</strong>' +
        '<span>' + (seat.masaBakiyesi || 0).toLocaleString('tr-TR') + ' çip</span>' +
        (rozet && !mine ? '<span class="holdem-rol-rozet">' + rozet + '</span>' : '');
      const playerHand = mine && hand ? '<span class="holdem-aktif-el">' + escapeHtml(hand.turAdi) + '</span>' : '';
      const kazanan = showdown && table.sonuclar && (table.sonuclar.odemeler[gercekIndex] || 0) > 0;
      const aksiyon = pasGecti ? '<span class="holdem-pas-rozet">Pas geçti</span>' : (!showdown && seat.sonAksiyon ? '<span class="holdem-son-aksiyon">' + aksiyonMetni(seat.sonAksiyon) + '</span>' : '');
      const sonuc = kazanan ? '<span class="holdem-kazanan-rozet">Pot aldı</span>' : '';
      const aktif = table.aktifKoltuk === gercekIndex;
      const sureStili = aktif ? ' style="--holdem-tur-orani:' + aktifSure.toFixed(4) + '"' : '';
      const kalkBtn = mine ? '<button type="button" class="btn btn-outline holdem-kalk-btn" data-holdem-kalk>Kalk</button>' : '';
      return '<article class="holdem-koltuk' + (mine ? ' holdem-koltuk-ben' : '') + (aktif ? ' holdem-koltuk-aktif' : '') + (kazanan ? ' holdem-koltuk-kazanan' : '') + (showdown ? ' holdem-koltuk-showdown' : '') + '" data-slot="' + slot + '"' + sureStili + '>' +
        (mine ? cardsBlock + playerHand + identityBlock + aksiyon + sonuc + kalkBtn : identityBlock + cardsBlock + betBlock + aksiyon + sonuc) + '</article>';
    }).join('');
  }
  const handInfo = document.querySelector('[data-holdem-el-bilgisi]');
  if (handInfo) { handInfo.innerHTML = hand ? escapeHtml(hand.turAdi) + '<small>Şu anki en iyi elin</small>' : '<small>Kombinasyon için flop bekleniyor</small>'; }

  const digerIsim = (Number.isInteger(table.aktifKoltuk) && table.koltuklar && table.koltuklar[table.aktifKoltuk]) ? table.koltuklar[table.aktifKoltuk].isim : 'Rakip';
  const turn = document.querySelector('[data-holdem-sira-bildirimi]');
  if (turn) {
    turn.textContent = !benimSirada
      ? (table.durum === 'lobi' ? (table.koltuklar || []).length + '/2+ oyuncu · masaya oturabilirsin' : showdown ? elSonucuMetni(table, kendi, benim) : 'Bir el sürüyor · masaya oturabilirsin')
      : showdown ? elSonucuMetni(table, kendi, benim) : (table.aktifKoltuk === benim ? 'Sıra sende · Gör ya da artır' : digerIsim + ' düşünüyor');
  }

  const actions = document.querySelector('[data-holdem-aksiyonlar]');
  const benimSiram = benimSirada && table.aktifKoltuk === benim && AKTIF_DURUMLAR.has(table.durum);
  const toCall = kendi ? Math.max(0, table.mevcutBahis - kendi.sokakYatirimi) : 0;
  if (actions) { actions.innerHTML = '<button class="btn" type="button" data-holdem-aksiyon="fold"' + (benimSiram ? '' : ' disabled') + '>Pas</button><button class="btn" type="button" data-holdem-aksiyon="' + (toCall ? 'call' : 'check') + '"' + (benimSiram ? '' : ' disabled') + '>' + (toCall ? 'Gör · ' + toCall : 'Check') + '</button><button class="btn" type="button" data-holdem-aksiyon="raise"' + (benimSiram ? '' : ' disabled') + '>Artır</button><button class="btn" type="button" data-holdem-aksiyon="all_in"' + (benimSiram ? '' : ' disabled') + '>All-in</button>'; }
  const raise = document.querySelector('[data-holdem-artirma-alani]');
  const minRaise = kendi ? Math.min(kendi.sokakYatirimi + kendi.masaBakiyesi, table.mevcutBahis + (table.minArtirma || 0)) : 0;
  const maxRaise = kendi ? kendi.sokakYatirimi + kendi.masaBakiyesi : 0;
  if (raise) { raise.innerHTML = '<label><span class="sr-only">Artırma miktarı</span><input data-holdem-raise type="range" min="' + minRaise + '" max="' + maxRaise + '" value="' + minRaise + '"' + (benimSiram ? '' : ' disabled') + '></label><label class="holdem-raise-number"><span>Artırma</span><input data-holdem-raise-number type="number" min="' + minRaise + '" max="' + maxRaise + '" step="1" value="' + minRaise + '"' + (benimSiram ? '' : ' disabled') + '></label><output data-holdem-raise-output>' + minRaise + ' çip</output>'; }

  const durum = document.querySelector('[data-holdem-durum]');
  if (durum && !tableError) {
    const saniye = table.aksiyonBitis ? Math.max(0, Math.ceil((table.aksiyonBitis - Date.now()) / 1000)) : 0;
    durum.textContent = !benimSirada
      ? (table.durum === 'lobi' ? 'En az 2 oyuncu oturunca el otomatik başlar.' : showdown ? elSonucuMetni(table, kendi, benim) : 'Bir el sürüyor · izleyebilir, masaya oturabilirsin.')
      : showdown ? elSonucuMetni(table, kendi, benim) : (table.aktifKoltuk === benim ? 'Sıra sende · ' + saniye + ' sn' : digerIsim + ' düşünüyor · ' + saniye + ' sn');
  }
}

function siraSaatiniBaslat() {
  if (turnCountdownTimer) { return; }
  turnCountdownTimer = setInterval(() => {
    if (!currentTable || !currentTable.aksiyonBitis || tableError) { return; }
    const benim = benimKoltukIndex(currentTable);
    const durum = document.querySelector('[data-holdem-durum]');
    if (durum && currentTable.aktifKoltuk === benim && benim !== -1) {
      durum.textContent = 'Sıra sende · ' + Math.max(0, Math.ceil((currentTable.aksiyonBitis - Date.now()) / 1000)) + ' sn';
    }
    const aktifEl = document.querySelector('.holdem-koltuk-aktif');
    if (aktifEl && currentTable.ayarlar) {
      const oran = Math.max(0, Math.min(1, (currentTable.aksiyonBitis - Date.now()) / currentTable.ayarlar.aksiyonSuresiMs));
      aktifEl.style.setProperty('--holdem-tur-orani', oran.toFixed(4));
    }
  }, 1000);
}

function loadSkin(uid) {
  if (!database || !uid) { return; }
  database.ref('blackjackAyarlari/' + uid).once('value').then((snap) => {
    skin = Object.assign(skin, snap.val() || {});
    renderMasa();
  }).catch(() => {});
}
function subscribeWallet(uid) {
  if (!database || !uid) { return; }
  database.ref(cüzdanYolu(uid)).on('value', (snap) => {
    const balance = cüzdanDegeri(snap.val());
    const el = document.querySelector('[data-holdem-bakiye]');
    if (el) { el.textContent = balance.toLocaleString('tr-TR') + ' çip'; }
    if (!snap.exists() || cüzdanNormalle(snap.val(), uid).legacyMi) { cüzdanHazirla(uid).catch((hata) => console.error('Hold’em başlangıç cüzdanı açılamadı:', hata)); }
  });
}

function attachTableListener(force) {
  const path = dbPath(MASA_YOLU);
  if (tableRef && attachedTablePath === path && !force) { return; }
  if (tableRef && tableListener) { tableRef.off('value', tableListener); }
  attachedTablePath = path;
  tableRef = database.ref(path);
  tableListener = (snap) => {
    tableError = '';
    currentTable = snap.val() || null;
    masaVerisiGeldi = true;
    belkiCuzdanAyarla(currentTable);
    belkiSonrakiFazaGec(currentTable);
    renderMasa();
    renderIslemDurumu();
  };
  tableRef.on('value', tableListener, masaHatasi);
  if (!phaseWatchdog) { phaseWatchdog = setInterval(() => belkiSonrakiFazaGec(currentTable), 1000); }
}

function eventleriBagla() {
  document.addEventListener('click', (event) => {
    const open = event.target.closest('[data-holdem-kombinasyon-ac]');
    const close = event.target.closest('[data-holdem-kombinasyon-kapat]');
    const modal = document.querySelector('[data-holdem-kombinasyon-modal]');
    if (open && modal && !modal.open) { modal.showModal(); }
    if (close && modal && modal.open) { modal.close(); }
    if (event.target.closest('[data-holdem-yeniden-dene]')) { tableError = ''; renderIslemDurumu(); attachTableListener(true); return; }
    if (event.target.closest('[data-holdem-masaya-otur]')) { if (!isReadOnly()) { oyuncuIslemi(otur); } return; }
    if (event.target.closest('[data-holdem-kalk]')) { if (!isReadOnly()) { oyuncuIslemi(kalk); } return; }
    const aksiyon = event.target.closest('[data-holdem-aksiyon]')?.dataset.holdemAksiyon;
    if (aksiyon) {
      const benim = benimKoltukIndex(currentTable);
      if (benim === -1 || !currentTable || currentTable.aktifKoltuk !== benim) { return; }
      const miktar = Number(document.querySelector('[data-holdem-raise-number]')?.value || document.querySelector('[data-holdem-raise]')?.value || 0);
      let hataMesaji = '';
      oyuncuIslemi(() => masaIslemi((mevcut) => {
        if (!mevcut || mevcut.aktifKoltuk !== benim) { return; }
        try { return holdemAksiyonUygula(mevcut, { koltukIndex: benim, aksiyon, miktar }, Date.now()); }
        catch (err) { hataMesaji = err.message || 'Bu hamle yapılamaz.'; return; }
      }).then(() => { if (hataMesaji) { showToast(hataMesaji, { variant: 'error' }); } }));
    }
    if (event.target.closest('[data-holdem-masa-ayarlari]')) { masaAyarlariniAc(); }
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
  if (!firebase) { return; }
  if (!firebase.apps.length) { firebase.initializeApp(FIREBASE_CONFIG); }
  database = firebase.database();
  renderKombinasyonlar();
  eventleriBagla();
  siraSaatiniBaslat();
  renderMasa();
  firebase.auth().onAuthStateChanged(async (user) => {
    currentUser = user;
    currentUserUid = user ? user.uid : '';
    if (!user) { canPlay = false; currentUserRole = ''; masaAyariButonunuGuncelle(); renderMasa(); return; }
    try {
      await initDbMode(database);
      renderDbModeBanner();
      modeReady = true;
      const profile = await database.ref('users/' + user.uid).once('value');
      const p = profile.val() || {};
      currentUserRole = p.role || '';
      canPlay = currentUserRole === 'editor' || currentUserRole === 'admin' || currentUserRole === 'owner';
      masaAyariButonunuGuncelle();
      currentUserName = ((p.firstName || '') + ' ' + (p.lastName || '')).trim() || user.email || 'Sen';
      subscribeStaffProfiles(database);
      subscribeWallet(user.uid);
      loadSkin(user.uid);
      masaAyarlariniDinle();
      attachTableListener();
      renderMasa();
    } catch (err) {
      console.error('Hold’em başlatılamadı:', err);
      renderMasa();
    }
  });
}
