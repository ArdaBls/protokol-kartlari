// Wordle (Türkçe) — kullanıcı isteği: "kelime oyunu silsilesi" ilk oyunu. Kelime havuzu
// TDK Güncel Türkçe Sözlük'ünden (ogun/guncel-turkce-sozluk, MIT) çıkarılmış temiz bir
// liste (sadece kelimeler, tanım/örnek YOK) -- docs/data/kelime-5.json, admin-src/public/
// altından build'e giriyor. Günün kelimesi SUNUCUSUZ: tarih + yıllık "seed sürümü"
// birleşip deterministik bir PRNG ile havuzdan seçiliyor -- her istemci bağımsız aynı
// sonuca ulaşıyor, Firebase'e günlük kelime için hiç gerek yok. Sadece kişisel
// istatistik (seri, kazanma oranı) Firebase'de (oyunBasarimlari/wordle/{uid}).
import { dbPath, initDbMode } from './db-mode.js';
import { showToast } from './toast.js';

const WORD_LEN = 5;
const MAX_TRIES = 6;
// Yılbaşında bu sayı bir artırılır -- aynı tarih formülü yıldan yıla FARKLI bir kelime
// dizisi üretir, geçen yılın sırası ezberlenip tahmin edilemez.
const SEED_VERSION = 2026;

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDOfhq3aYW6sg2_zj0sFsRzXeGziGtLxCk',
  authDomain: 'omu-protokol.firebaseapp.com',
  databaseURL: 'https://omu-protokol-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'omu-protokol'
};

const KEYBOARD_ROWS = [
  ['e', 'r', 't', 'y', 'u', 'ı', 'o', 'p', 'ğ', 'ü'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'ş', 'i'],
  ['BACK', 'z', 'c', 'v', 'b', 'n', 'm', 'ö', 'ç', 'ENTER']
];

function bugununTarihiIstanbul() {
  // Kullanıcının cihaz saati yanlış/farklı saat diliminde olsa bile herkese AYNI gün
  // aynı bulmaca gelsin diye cihazın kendi yerel tarihi değil, Türkiye saat dilimindeki
  // "bugün" kullanılıyor.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date());
}

// Basit, hızlı, deterministik string hash (djb2 varyasyonu) + mulberry32 PRNG --
// kriptografik güvenlik gerekmiyor, sadece "aynı girdi -> aynı sayı, istemciler arası
// tutarlı" gerekiyor.
function seedliIndeks(tarihStr, havuzBoyu) {
  const girdi = tarihStr + ':' + SEED_VERSION;
  let h = 2166136261;
  for (let i = 0; i < girdi.length; i++) {
    h ^= girdi.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h = h >>> 0;
  // mulberry32 tek adım karıştırma -- ham hash'in düşük bitleri çok düzenli olabiliyor,
  // bir tur daha karıştırıp modulo'ya öyle sokuyoruz.
  h = Math.imul(h ^ (h >>> 15), 1 | h);
  h = (h + Math.imul(h ^ (h >>> 7), 61 | h)) ^ h;
  h = (h ^ (h >>> 14)) >>> 0;
  return h % havuzBoyu;
}

function harfleriAyir(kelime) {
  // Array.from / spread, Türkçe harfler dahil TEK code point'lik karakterlerde doğru
  // çalışır (ı/i/ğ/ü/ş/ö/ç hepsi BMP'de tek code unit, sürpriz yok).
  return Array.from(kelime);
}

// Klasik Wordle geri bildirim algoritması: ÖNCE tam eşleşenler işaretlenir, SONRA
// kalanlar için "var ama yanlış yerde" sayımı yapılır -- tek geçişli naif yaklaşım
// tekrarlı harflerde (ör. hedef "elma", tahmin "lale") yanlış sayıda "sarı" üretirdi.
function geriBildirimHesapla(tahmin, hedef) {
  const tahminH = harfleriAyir(tahmin);
  const hedefH = harfleriAyir(hedef);
  const sonuc = new Array(tahminH.length).fill('yok');
  const kalanHedef = hedefH.slice();
  tahminH.forEach((h, i) => {
    if (h === hedefH[i]) { sonuc[i] = 'dogru'; kalanHedef[i] = null; }
  });
  tahminH.forEach((h, i) => {
    if (sonuc[i] === 'dogru') { return; }
    const idx = kalanHedef.indexOf(h);
    if (idx !== -1) { sonuc[i] = 'var'; kalanHedef[idx] = null; }
  });
  return sonuc;
}

function escapeHtml(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

let wordList = [];
let wordSet = new Set();
let hedefKelime = '';
let bugunTarih = '';
let tahminler = []; // { kelime, sonuc: ['dogru'|'var'|'yok', ...] }[]
let mevcutGiris = '';
let oyunBitti = false;
let kazandi = false;
let harfDurumu = {}; // harf -> en iyi görülen durum ('dogru' > 'var' > 'yok')

const STORAGE_KEY = 'omuWordleDurum';

function harfDurumunuGuncelle(sonuc, kelime) {
  const oncelik = { dogru: 3, var: 2, yok: 1 };
  harfleriAyir(kelime).forEach((h, i) => {
    const yeni = sonuc[i];
    const eski = harfDurumu[h];
    if (!eski || oncelik[yeni] > oncelik[eski]) { harfDurumu[h] = yeni; }
  });
}

function durumuKaydet() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ tarih: bugunTarih, tahminler, oyunBitti, kazandi }));
  } catch (e) { /* localStorage kapalıysa sessizce geç -- oyun yine oynanabilir, sadece yenilemede sıfırlanır */ }
}
function durumuYukle() {
  try {
    const kayit = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (kayit && kayit.tarih === bugunTarih && Array.isArray(kayit.tahminler)) {
      tahminler = kayit.tahminler;
      oyunBitti = !!kayit.oyunBitti;
      kazandi = !!kayit.kazandi;
      tahminler.forEach((t) => harfDurumunuGuncelle(t.sonuc, t.kelime));
    }
  } catch (e) { /* bozuk kayıt varsa yok say, sıfırdan başla */ }
}

// Sadece BİR KEZ, yeni gönderilen tahmin satırında (yüklemede/eski kayıtlarda DEĞİL)
// harf harf gecikmeli "flip" animasyonu oynatılsın diye -- gridRender() her tuşta da
// çağrıldığından, animasyon hedefini burada işaretleyip render sonunda sıfırlıyoruz.
let yeniAnimasyonSatiri = -1;

function gridRender() {
  const grid = document.getElementById('wordle-grid');
  if (!grid) { return; }
  let html = '';
  for (let satir = 0; satir < MAX_TRIES; satir++) {
    const tahmin = tahminler[satir];
    const aktif = satir === tahminler.length && !oyunBitti;
    const flipSatiri = tahmin && satir === yeniAnimasyonSatiri;
    html += '<div class="wordle-row">';
    for (let sutun = 0; sutun < WORD_LEN; sutun++) {
      let harf = '';
      let durum = '';
      if (tahmin) { harf = harfleriAyir(tahmin.kelime)[sutun]; durum = tahmin.sonuc[sutun]; }
      else if (aktif) { harf = harfleriAyir(mevcutGiris)[sutun] || ''; }
      const flipStil = flipSatiri ? ` style="animation-delay:${(sutun * 0.12).toFixed(2)}s"` : '';
      html += `<div class="wordle-cell${durum ? ' wordle-cell--' + durum : ''}${harf && !durum ? ' wordle-cell--dolu' : ''}${flipSatiri ? ' wordle-cell--flip' : ''}"${flipStil}>${escapeHtml(harf)}</div>`;
    }
    html += '</div>';
  }
  grid.innerHTML = html;
  yeniAnimasyonSatiri = -1;
}

function klavyeRender() {
  const kb = document.getElementById('wordle-keyboard');
  if (!kb) { return; }
  kb.innerHTML = KEYBOARD_ROWS.map((satir) => {
    return '<div class="wordle-kb-row">' + satir.map((tus) => {
      if (tus === 'ENTER') { return '<button type="button" class="wordle-key wordle-key--wide" data-key="ENTER">Gönder</button>'; }
      if (tus === 'BACK') { return '<button type="button" class="wordle-key wordle-key--wide" data-key="BACK">⌫</button>'; }
      const durum = harfDurumu[tus];
      return `<button type="button" class="wordle-key${durum ? ' wordle-key--' + durum : ''}" data-key="${tus}">${tus}</button>`;
    }).join('') + '</div>';
  }).join('');
}

function mesajGoster(msg) { showToast(msg, { variant: 'error' }); }

function harfGir(h) {
  if (oyunBitti) { return; }
  if (mevcutGiris.length >= WORD_LEN) { return; }
  mevcutGiris += h;
  gridRender();
}
function geriSil() {
  if (oyunBitti) { return; }
  mevcutGiris = mevcutGiris.slice(0, -1);
  gridRender();
}
function gecersizGirisiTitret() {
  const grid = document.getElementById('wordle-grid');
  const satir = grid && grid.children[tahminler.length];
  if (!satir) { return; }
  // Kullanıcı bulgusu: aynı geçersiz kelimeyle art arda Enter'a basınca ikinci basışta
  // titreme hiç oynamıyordu -- classList.remove + offsetWidth reflow ZORLAMASI, tarayıcının
  // animasyonu GERÇEKTEN sıfırlaması için yeterli gelmiyordu (tek senkron görev içinde
  // kalıyor, hiç boyama/frame arası geçmiyor). Çift requestAnimationFrame, kaldırmanın
  // GERÇEKTEN bir kare boyanıp işlendiğini garanti eder, ondan SONRA sınıf geri eklenir --
  // ne kadar art arda basılırsa basılsın her seferinde animasyon baştan başlar.
  satir.classList.remove('wordle-row--titrek');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => { satir.classList.add('wordle-row--titrek'); });
  });
}
function tahminGonder() {
  if (oyunBitti) { return; }
  if (mevcutGiris.length !== WORD_LEN) { mesajGoster('Kelime ' + WORD_LEN + ' harf olmalı.'); gecersizGirisiTitret(); return; }
  if (!wordSet.has(mevcutGiris)) { mesajGoster('Bu kelime listede yok.'); gecersizGirisiTitret(); return; }
  const sonuc = geriBildirimHesapla(mevcutGiris, hedefKelime);
  tahminler.push({ kelime: mevcutGiris, sonuc });
  yeniAnimasyonSatiri = tahminler.length - 1;
  harfDurumunuGuncelle(sonuc, mevcutGiris);
  const kazandiMi = mevcutGiris === hedefKelime;
  mevcutGiris = '';
  if (kazandiMi) {
    oyunBitti = true; kazandi = true;
    showToast('Tebrikler, buldun! 🎉', { variant: 'success' });
  } else if (tahminler.length >= MAX_TRIES) {
    oyunBitti = true; kazandi = false;
    showToast('Bugünün kelimesi: ' + hedefKelime.toLocaleUpperCase('tr-TR'), { variant: 'info' });
  }
  gridRender();
  klavyeRender();
  durumuKaydet();
  if (oyunBitti) { istatistikGuncelle(); sonucPaneliGoster(); }
}

// Kullanıcı isteği: "oyun bitti eğer kazandıysa ekrana önce 1 2 3 4 5 6 hangi
// sırada yaptıysa o gelsin sonra da altta istatistik tablosu çıksın" -- kazanınca
// kaçıncı denemede olduğunu 1-6 şeklinde vurgulayan bir şerit, ALTINDA da kişisel
// dağıtım tablosu (sol sütun mobilde gizlendiği için, sonuç bu bilgiyi ORADA da
// göstermek zorunda -- bkz. dagitimHtmlOlustur, hem burada hem kisiselIstatistikYukle'de).
function denemeSeridiHtmlOlustur(kazanilanDeneme) {
  const pilller = Array.from({ length: MAX_TRIES }, (_, i) => i + 1).map((n) => {
    return `<span class="wordle-deneme-pil${n === kazanilanDeneme ? ' wordle-deneme-pil--kazanan' : ''}">${n}</span>`;
  }).join('');
  return `<div class="wordle-deneme-seridi">${pilller}</div>`;
}

function sonucPaneliGoster() {
  const panel = document.getElementById('wordle-sonuc');
  if (!panel) { return; }
  panel.hidden = false;
  if (kazandi) {
    panel.innerHTML = `
      <div class="wordle-sonuc-baslik">Kazandın!</div>
      ${denemeSeridiHtmlOlustur(tahminler.length)}
      <div id="wordle-sonuc-dagitim"></div>
    `;
    kisiselIstatistikYukle('wordle-sonuc-dagitim');
  } else {
    panel.innerHTML = `
      <div class="wordle-sonuc-baslik">Bu sefer olmadı</div>
      <div class="wordle-sonuc-kelime">Kelime: <strong>${escapeHtml(hedefKelime.toLocaleUpperCase('tr-TR'))}</strong></div>
    `;
  }
}

let database = null;
let currentUid = '';
let currentUserName = '';
function istatistikGuncelle() {
  if (!database || !currentUid) { return; }
  const ref = database.ref(dbPath('oyunBasarimlari/wordle/' + currentUid));
  ref.once('value').then((snap) => {
    const eski = snap.val() || { oynanan: 0, kazanilan: 0, seri: 0, enUzunSeri: 0, sonTarih: '', dagitim: {} };
    // Aynı günün istatistiği tekrar yazılmasın (sayfa yenilenip oyunBitti=true durumundan
    // tekrar tetiklenebilir) -- sonTarih zaten bugünse dokunma.
    if (eski.sonTarih === bugunTarih) { return; }
    const dunOynandiMi = ardisikGunMu(eski.sonTarih, bugunTarih);
    const yeniSeri = kazandi ? (dunOynandiMi ? (eski.seri || 0) + 1 : 1) : 0;
    const dagitim = Object.assign({}, eski.dagitim);
    if (kazandi) { const k = String(tahminler.length); dagitim[k] = (dagitim[k] || 0) + 1; }
    const yeni = {
      isim: currentUserName || 'İsimsiz',
      oynanan: (eski.oynanan || 0) + 1,
      kazanilan: (eski.kazanilan || 0) + (kazandi ? 1 : 0),
      seri: yeniSeri,
      enUzunSeri: Math.max(eski.enUzunSeri || 0, yeniSeri),
      sonTarih: bugunTarih,
      sonKazandi: kazandi,
      dagitim
    };
    ref.set(yeni).then(() => { liderTablosunuYukle(); kisiselIstatistikYukle(); }).catch((err) => console.error('Wordle istatistiği kaydedilemedi:', err));
  }).catch((err) => console.error('Wordle istatistiği okunamadı:', err));
}

// Kullanıcı isteği: "herkesin kendi kişisel liderlik tablosu da olsun, ilk denemede mi
// buldu, 2. mi, 3. 4. 5. 6. diye" -- herkese açık lider tablosundan AYRI, sadece kendi
// geçmiş sonuçlarının (kaç denemede bulduğu) dağılımını çubuk olarak gösteren panel.
// Veri zaten dagitim alanında tutuluyordu (istatistikGuncelle), sadece görünüm eksikti.
function kisiselIstatistikYukle(kutuId) {
  if (!database || !currentUid) { return; }
  const box = document.getElementById(kutuId || 'wordle-kisisel-istatistik');
  if (!box) { return; }
  database.ref(dbPath('oyunBasarimlari/wordle/' + currentUid)).once('value').then((snap) => {
    const s = snap.val();
    if (!s) { box.innerHTML = '<div class="wordle-lider-bos">Henüz oynamadın -- ilk bulmacanı çöz!</div>'; return; }
    const dagitim = s.dagitim || {};
    const enYuksek = Math.max(1, ...Array.from({ length: MAX_TRIES }, (_, i) => dagitim[String(i + 1)] || 0));
    const cubuklar = Array.from({ length: MAX_TRIES }, (_, i) => {
      const deneme = i + 1;
      const sayi = dagitim[String(deneme)] || 0;
      const yuzde = Math.max(6, Math.round((sayi / enYuksek) * 100));
      const buguntuMu = s.sonTarih === bugunTarih && s.sonKazandi && tahminler.length === deneme;
      return `<div class="wordle-dagitim-satir">` +
        `<span class="wordle-dagitim-no">${deneme}</span>` +
        `<div class="wordle-dagitim-bar-yuva"><div class="wordle-dagitim-bar${buguntuMu ? ' wordle-dagitim-bar--bugun' : ''}" style="width:${yuzde}%">${sayi}</div></div>` +
      `</div>`;
    }).join('');
    box.innerHTML = `<div class="wordle-dagitim-ozet">Oynanan: ${s.oynanan} · Kazanılan: ${s.kazanilan} · Güncel seri: ${s.seri} 🔥 · En uzun seri: ${s.enUzunSeri}</div>` +
      `<div class="wordle-dagitim">${cubuklar}</div>`;
  }).catch((err) => console.error('Wordle kişisel istatistik okunamadı:', err));
}

// Kullanıcı isteği: "herkes birbirinin skorunu görebilsin" -- kişiye özel/gizli istatistik
// değil, Tetris skor tablosuyla AYNI mantıkta herkese açık bir lider tablosu.
function liderTablosunuYukle() {
  if (!database) { return; }
  const box = document.getElementById('wordle-lider-tablosu');
  if (!box) { return; }
  database.ref(dbPath('oyunBasarimlari/wordle')).once('value').then((snap) => {
    const hepsi = snap.val() || {};
    const satirlar = Object.keys(hepsi).map((uid) => Object.assign({ uid }, hepsi[uid]))
      .sort((a, b) => (b.seri || 0) - (a.seri || 0) || (b.kazanilan || 0) - (a.kazanilan || 0));
    if (!satirlar.length) { box.innerHTML = '<div class="wordle-lider-bos">Henüz kimse oynamadı -- ilk bulmacayı sen çöz!</div>'; return; }
    box.innerHTML = satirlar.map((s, i) => {
      const ben = s.uid === currentUid ? ' wordle-lider-satir--ben' : '';
      return `<div class="wordle-lider-satir${ben}">` +
        `<span class="wordle-lider-sira">${i + 1}</span>` +
        `<span class="wordle-lider-isim">${escapeHtml(s.isim || 'İsimsiz')}</span>` +
        `<span class="wordle-lider-seri">${s.seri || 0} 🔥</span>` +
        `<span class="wordle-lider-kazanilan">${s.kazanilan || 0} kazanma</span>` +
        '</div>';
    }).join('');
  }).catch((err) => console.error('Wordle lider tablosu okunamadı:', err));
}
function ardisikGunMu(oncekiTarih, buguTarih) {
  if (!oncekiTarih) { return false; }
  const a = new Date(oncekiTarih + 'T00:00:00Z').getTime();
  const b = new Date(buguTarih + 'T00:00:00Z').getTime();
  return (b - a) === 86400000;
}

function fizikselKlavyeDinle() {
  document.addEventListener('keydown', (e) => {
    if (!document.getElementById('wordle-grid')) { return; }
    if (e.key === 'Enter') { tahminGonder(); return; }
    if (e.key === 'Backspace') { geriSil(); return; }
    const h = e.key.toLocaleLowerCase('tr-TR');
    if (h.length === 1 && /[abcçdefgğhıijklmnoöprsştuüvyz]/.test(h)) { harfGir(h); }
  });
}

export function initWordle() {
  const grid = document.getElementById('wordle-grid');
  if (!grid) { return; }
  bugunTarih = bugununTarihiIstanbul();
  fetch('/data/kelime-5.json').then((r) => r.json()).then((liste) => {
    wordList = liste;
    wordSet = new Set(liste);
    const idx = seedliIndeks(bugunTarih, wordList.length);
    hedefKelime = wordList[idx];
    durumuYukle();
    gridRender();
    klavyeRender();
    if (oyunBitti) { sonucPaneliGoster(); }
    document.getElementById('wordle-keyboard').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-key]');
      if (!btn) { return; }
      const k = btn.dataset.key;
      if (k === 'ENTER') { tahminGonder(); }
      else if (k === 'BACK') { geriSil(); }
      else { harfGir(k); }
    });
    fizikselKlavyeDinle();
  }).catch((err) => {
    console.error('Kelime listesi yüklenemedi:', err);
    showToast('Kelime listesi yüklenemedi.', { variant: 'error' });
  });

  if (window.firebase) {
    try {
      if (!firebase.apps.length) { firebase.initializeApp(FIREBASE_CONFIG); }
      database = firebase.database();
      firebase.auth().onAuthStateChanged((user) => {
        if (!user) { return; }
        currentUid = user.uid;
        database.ref('users/' + user.uid).once('value').then((snap) => {
          const u = snap.val() || {};
          currentUserName = ((u.firstName || '') + ' ' + (u.lastName || '')).trim() || (user.email || 'İsimsiz');
        });
        initDbMode(database).then(() => { liderTablosunuYukle(); kisiselIstatistikYukle(); });
      });
    } catch (e) { console.error('Wordle Firebase başlatılamadı:', e); }
  }
}
