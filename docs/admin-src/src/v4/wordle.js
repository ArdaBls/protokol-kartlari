// Wordle (Türkçe) — kullanıcı isteği: "kelime oyunu silsilesi" ilk oyunu. Kelime havuzu
// TDK Güncel Türkçe Sözlük'ünden (ogun/guncel-turkce-sozluk, MIT) çıkarılmış temiz bir
// liste (sadece kelimeler, tanım/örnek YOK) -- docs/data/kelime-5.json, admin-src/public/
// altından build'e giriyor. Günün kelimesi SUNUCUSUZ: tarih + yıllık "seed sürümü"
// birleşip deterministik bir PRNG ile havuzdan seçiliyor -- her istemci bağımsız aynı
// sonuca ulaşıyor, Firebase'e günlük kelime için hiç gerek yok. Sadece kişisel
// istatistik (seri, kazanma oranı) Firebase'de (kelimeOyunlariIstatistik/wordle/{uid}).
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
  ['ENTER', 'z', 'c', 'v', 'b', 'n', 'm', 'ö', 'ç', 'BACK']
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
  satir.classList.remove('wordle-row--titrek'); void satir.offsetWidth; satir.classList.add('wordle-row--titrek');
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

function paylasimMetniOlustur() {
  const simge = { dogru: '🟩', var: '🟨', yok: '⬛' };
  const satirlar = tahminler.map((t) => t.sonuc.map((d) => simge[d]).join(''));
  return `Protokol Kelime ${bugunTarih} ${kazandi ? tahminler.length : 'X'}/${MAX_TRIES}\n\n` + satirlar.join('\n');
}

function sonucPaneliGoster() {
  const panel = document.getElementById('wordle-sonuc');
  if (!panel) { return; }
  panel.hidden = false;
  panel.innerHTML = `
    <div class="wordle-sonuc-baslik">${kazandi ? 'Kazandın!' : 'Bu sefer olmadı'}</div>
    <div class="wordle-sonuc-kelime">${!kazandi ? 'Kelime: <strong>' + escapeHtml(hedefKelime.toLocaleUpperCase('tr-TR')) + '</strong>' : ''}</div>
    <button type="button" class="btn btn-outline" id="wordle-paylas-btn">Sonucu Kopyala</button>
  `;
  const btn = document.getElementById('wordle-paylas-btn');
  if (btn) {
    btn.addEventListener('click', () => {
      const metin = paylasimMetniOlustur();
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(metin).then(() => showToast('Kopyalandı.', { variant: 'success' })).catch(() => showToast('Kopyalanamadı.', { variant: 'error' }));
      }
    });
  }
}

let database = null;
let currentUid = '';
let currentUserName = '';
function istatistikGuncelle() {
  if (!database || !currentUid) { return; }
  const ref = database.ref(dbPath('kelimeOyunlariIstatistik/wordle/' + currentUid));
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
    ref.set(yeni).then(() => liderTablosunuYukle()).catch((err) => console.error('Wordle istatistiği kaydedilemedi:', err));
  }).catch((err) => console.error('Wordle istatistiği okunamadı:', err));
}

// Kullanıcı isteği: "herkes birbirinin skorunu görebilsin" -- kişiye özel/gizli istatistik
// değil, Tetris skor tablosuyla AYNI mantıkta herkese açık bir lider tablosu.
function liderTablosunuYukle() {
  if (!database) { return; }
  const box = document.getElementById('wordle-lider-tablosu');
  if (!box) { return; }
  database.ref(dbPath('kelimeOyunlariIstatistik/wordle')).once('value').then((snap) => {
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
        initDbMode(database).then(() => { liderTablosunuYukle(); });
      });
    } catch (e) { console.error('Wordle Firebase başlatılamadı:', e); }
  }
}
