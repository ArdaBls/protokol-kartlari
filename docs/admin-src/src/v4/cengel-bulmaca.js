// Çengel bulmaca (klasik siyah/beyaz kutulu crossword) -- kelime oyunu silsilesinin
// ikinci/üçüncü oyunu (Wordle'dan sonra). Aynı motor HEM büyük (15x15) HEM mini
// (7x7) bulmaca için kullanılıyor, sadece boyut parametresi değişiyor -- bkz.
// initCengelBulmaca(boyut, oyunAdi). Izgara üretimi cengel-bulmaca-uretici.js'te
// (paylaşılan, saf JS -- Node script'inde de kullanılabilir, ör. ileride GitHub
// Actions ile önceden üretim yapılacaksa).
import { dbPath, initDbMode } from './db-mode.js';
import { showToast } from './toast.js';
import { cengelBulmacaUret } from './cengel-bulmaca-uretici.js';

const SEED_VERSION = 2026;

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDOfhq3aYW6sg2_zj0sFsRzXeGziGtLxCk',
  authDomain: 'omu-protokol.firebaseapp.com',
  databaseURL: 'https://omu-protokol-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'omu-protokol'
};

function bugununTarihiIstanbul() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date());
}
function escapeHtml(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function harfleriAyir(kelime) { return Array.from(kelime); }

let BOYUT = 15;
let OYUN_ADI = 'cengelBulmaca';
let STORAGE_KEY = 'omuCengelBulmacaDurum';
let bugunTarih = '';
let placedWords = [];   // { kelime, ipucu, row, col, yon, numara }
let grid = [];          // null (siyah) veya { harf }
let userGrid = [];      // kullanıcının o hücreye yazdığı harf ('' boşsa)
let aktif = null;       // { row, col, yon } -- yon: 0=yatay,1=dikey
let oyunBitti = false;

function hucreninKelimeleriniBul(row, col) {
  return placedWords.filter((w) => {
    if (w.yon === 0) { return w.row === row && col >= w.col && col < w.col + w.kelime.length; }
    return w.col === col && row >= w.row && row < w.row + w.kelime.length;
  });
}

function durumuKaydet() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ tarih: bugunTarih, userGrid, oyunBitti })); } catch (e) { /* localStorage kapalıysa sessizce geç */ }
}
function durumuYukle() {
  try {
    const kayit = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (kayit && kayit.tarih === bugunTarih && Array.isArray(kayit.userGrid)) {
      userGrid = kayit.userGrid;
      oyunBitti = !!kayit.oyunBitti;
    }
  } catch (e) { /* bozuk kayıt varsa yok say */ }
}

function izgaraRender() {
  const kapsayici = document.getElementById('cengel-izgara');
  if (!kapsayici) { return; }
  let aktifKelimeler = aktif ? hucreninKelimeleriniBul(aktif.row, aktif.col) : [];
  let aktifKelime = aktifKelimeler.find((w) => w.yon === (aktif && aktif.yon)) || aktifKelimeler[0];
  let html = `<div class="cengel-grid" style="grid-template-columns:repeat(${BOYUT},1fr)">`;
  for (let r = 0; r < BOYUT; r++) {
    for (let c = 0; c < BOYUT; c++) {
      const hucre = grid[r][c];
      if (!hucre) { html += '<div class="cengel-hucre cengel-hucre--siyah"></div>'; continue; }
      const numara = (placedWords.find((w) => w.row === r && w.col === c) || {}).numara;
      const aktifHucreMi = aktif && aktif.row === r && aktif.col === c;
      const kelimeIcindeMi = aktifKelime && (aktifKelime.yon === 0
        ? aktifKelime.row === r && c >= aktifKelime.col && c < aktifKelime.col + aktifKelime.kelime.length
        : aktifKelime.col === c && r >= aktifKelime.row && r < aktifKelime.row + aktifKelime.kelime.length);
      const yazilan = (userGrid[r] && userGrid[r][c]) || '';
      const dogruMu = oyunBitti && yazilan.toLocaleLowerCase('tr-TR') === hucre.harf;
      const cls = ['cengel-hucre'];
      if (aktifHucreMi) { cls.push('cengel-hucre--aktif'); }
      else if (kelimeIcindeMi) { cls.push('cengel-hucre--vurgulu'); }
      if (oyunBitti) { cls.push(dogruMu ? 'cengel-hucre--dogru' : 'cengel-hucre--yanlis'); }
      html += `<div class="${cls.join(' ')}" data-row="${r}" data-col="${c}">` +
        (numara ? `<span class="cengel-numara">${numara}</span>` : '') +
        `<span class="cengel-harf">${escapeHtml(yazilan.toLocaleUpperCase('tr-TR'))}</span>` +
        '</div>';
    }
  }
  html += '</div>';
  kapsayici.innerHTML = html;
  kapsayici.querySelectorAll('.cengel-hucre:not(.cengel-hucre--siyah)').forEach((el) => {
    el.addEventListener('click', () => hucreyeTikla(Number(el.dataset.row), Number(el.dataset.col)));
  });
}

function ipucuListesiRender() {
  const kapsayici = document.getElementById('cengel-ipuclari');
  if (!kapsayici) { return; }
  const yatay = placedWords.filter((w) => w.yon === 0).sort((a, b) => a.numara - b.numara);
  const dikey = placedWords.filter((w) => w.yon === 1).sort((a, b) => a.numara - b.numara);
  function satir(w) {
    const aktifMi = aktif && hucreninKelimeleriniBul(aktif.row, aktif.col).some((x) => x === w) && aktif.yon === w.yon;
    return `<div class="cengel-ipucu-satir${aktifMi ? ' cengel-ipucu-satir--aktif' : ''}" data-row="${w.row}" data-col="${w.col}" data-yon="${w.yon}">` +
      `<span class="cengel-ipucu-no">${w.numara}.</span> <span class="cengel-ipucu-metin">${escapeHtml(w.ipucu)}</span>` +
      ` <span class="cengel-ipucu-uzunluk">(${w.kelime.length})</span></div>`;
  }
  kapsayici.innerHTML =
    `<div class="cengel-ipucu-blok"><h3>Yatay</h3>${yatay.map(satir).join('')}</div>` +
    `<div class="cengel-ipucu-blok"><h3>Dikey</h3>${dikey.map(satir).join('')}</div>`;
  kapsayici.querySelectorAll('.cengel-ipucu-satir').forEach((el) => {
    el.addEventListener('click', () => {
      aktif = { row: Number(el.dataset.row), col: Number(el.dataset.col), yon: Number(el.dataset.yon) };
      tamRenderVeOdak();
    });
  });
}

function hucreyeTikla(row, col) {
  const kelimeler = hucreninKelimeleriniBul(row, col);
  if (!kelimeler.length) { return; }
  gizliGirisineOdaklan();
  if (aktif && aktif.row === row && aktif.col === col && kelimeler.length > 1) {
    // Aynı hücreye tekrar tıklama: yatay/dikey kelime arasında geçiş yap (kesişim noktası).
    const digerYon = aktif.yon === 0 ? 1 : 0;
    if (kelimeler.some((w) => w.yon === digerYon)) { aktif = { row, col, yon: digerYon }; tamRenderVeOdak(); return; }
  }
  const tercihEdilenYon = kelimeler.some((w) => w.yon === 0) ? 0 : 1;
  aktif = { row, col, yon: tercihEdilenYon };
  tamRenderVeOdak();
}

function tamRenderVeOdak() {
  izgaraRender();
  ipucuListesiRender();
}

function sonrakiHucre(row, col, yon, yon_ileri) {
  const dr = yon === 1 ? yon_ileri : 0;
  const dc = yon === 0 ? yon_ileri : 0;
  const r = row + dr, c = col + dc;
  if (r < 0 || c < 0 || r >= BOYUT || c >= BOYUT || !grid[r][c]) { return null; }
  return { row: r, col: c };
}

function harfGir(harf) {
  if (!aktif || oyunBitti) { return; }
  if (!userGrid[aktif.row]) { userGrid[aktif.row] = []; }
  userGrid[aktif.row][aktif.col] = harf;
  const sonraki = sonrakiHucre(aktif.row, aktif.col, aktif.yon, 1);
  if (sonraki) { aktif = Object.assign({ yon: aktif.yon }, sonraki); }
  tamRenderVeOdak();
  durumuKaydet();
  kontrolEt(false);
}
function geriSil() {
  if (!aktif || oyunBitti) { return; }
  const mevcutBos = !(userGrid[aktif.row] && userGrid[aktif.row][aktif.col]);
  if (mevcutBos) {
    const onceki = sonrakiHucre(aktif.row, aktif.col, aktif.yon, -1);
    if (onceki) { aktif = Object.assign({ yon: aktif.yon }, onceki); }
  }
  if (userGrid[aktif.row]) { userGrid[aktif.row][aktif.col] = ''; }
  tamRenderVeOdak();
  durumuKaydet();
}

function fizikselKlavyeDinle() {
  document.addEventListener('keydown', (e) => {
    if (!document.getElementById('cengel-izgara') || !aktif) { return; }
    if (e.key === 'Backspace') { e.preventDefault(); geriSil(); return; }
    if (e.key === 'ArrowRight') { e.preventDefault(); aktif = { row: aktif.row, col: Math.min(BOYUT - 1, aktif.col + 1), yon: 0 }; tamRenderVeOdak(); return; }
    if (e.key === 'ArrowLeft') { e.preventDefault(); aktif = { row: aktif.row, col: Math.max(0, aktif.col - 1), yon: 0 }; tamRenderVeOdak(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); aktif = { row: Math.min(BOYUT - 1, aktif.row + 1), col: aktif.col, yon: 1 }; tamRenderVeOdak(); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); aktif = { row: Math.max(0, aktif.row - 1), col: aktif.col, yon: 1 }; tamRenderVeOdak(); return; }
    const h = e.key.toLocaleLowerCase('tr-TR');
    if (h.length === 1 && /[abcçdefgğhıijklmnoöprsştuüvyz]/.test(h)) { harfGir(h); }
  });
}

function kontrolEt(bildirimGoster) {
  let tamamMi = true;
  for (const w of placedWords) {
    const harfler = harfleriAyir(w.kelime);
    for (let i = 0; i < harfler.length; i++) {
      const r = w.row + (w.yon === 1 ? i : 0), c = w.col + (w.yon === 0 ? i : 0);
      const yazilan = ((userGrid[r] && userGrid[r][c]) || '').toLocaleLowerCase('tr-TR');
      if (yazilan !== harfler[i]) { tamamMi = false; }
    }
  }
  if (tamamMi && !oyunBitti) {
    oyunBitti = true;
    durumuKaydet();
    tamRenderVeOdak();
    if (bildirimGoster !== false) { showToast('Tebrikler, bulmacayı tamamladın! 🎉', { variant: 'success' }); }
    istatistikGuncelle();
  }
  return tamamMi;
}

let database = null;
let currentUid = '';
let currentUserName = '';
function istatistikGuncelle() {
  if (!database || !currentUid) { return; }
  const ref = database.ref(dbPath('oyunBasarimlari/' + OYUN_ADI + '/' + currentUid));
  ref.once('value').then((snap) => {
    const eski = snap.val() || { oynanan: 0, kazanilan: 0, seri: 0, enUzunSeri: 0, sonTarih: '' };
    if (eski.sonTarih === bugunTarih) { return; }
    const dunOynandiMi = ardisikGunMu(eski.sonTarih, bugunTarih);
    const yeniSeri = (dunOynandiMi ? (eski.seri || 0) : 0) + 1;
    ref.set({
      isim: currentUserName || 'İsimsiz',
      oynanan: (eski.oynanan || 0) + 1,
      kazanilan: (eski.kazanilan || 0) + 1,
      seri: yeniSeri,
      enUzunSeri: Math.max(eski.enUzunSeri || 0, yeniSeri),
      sonTarih: bugunTarih,
      sonKazandi: true
    }).then(() => liderTablosunuYukle()).catch((err) => console.error('Çengel bulmaca istatistiği kaydedilemedi:', err));
  }).catch((err) => console.error('Çengel bulmaca istatistiği okunamadı:', err));
}
function ardisikGunMu(oncekiTarih, buguTarih) {
  if (!oncekiTarih) { return false; }
  const a = new Date(oncekiTarih + 'T00:00:00Z').getTime();
  const b = new Date(buguTarih + 'T00:00:00Z').getTime();
  return (b - a) === 86400000;
}
function liderTablosunuYukle() {
  if (!database) { return; }
  const box = document.getElementById('cengel-lider-tablosu');
  if (!box) { return; }
  database.ref(dbPath('oyunBasarimlari/' + OYUN_ADI)).once('value').then((snap) => {
    const hepsi = snap.val() || {};
    const satirlar = Object.keys(hepsi).map((uid) => Object.assign({ uid }, hepsi[uid]))
      .sort((a, b) => (b.oynanan || 0) - (a.oynanan || 0) || (b.seri || 0) - (a.seri || 0));
    if (!satirlar.length) { box.innerHTML = '<div class="wordle-lider-bos">Henüz kimse çözmedi -- ilk bulmacayı sen çöz!</div>'; return; }
    box.innerHTML = satirlar.map((s, i) => {
      const ben = s.uid === currentUid ? ' wordle-lider-satir--ben' : '';
      return `<div class="wordle-lider-satir${ben}">` +
        `<span class="wordle-lider-sira">${i + 1}</span>` +
        `<span class="wordle-lider-isim">${escapeHtml(s.isim || 'İsimsiz')}</span>` +
        `<span class="wordle-lider-oynanan">${s.oynanan || 0} kez çözdü</span>` +
        `<span class="wordle-lider-seri">${s.seri || 0} 🔥</span>` +
        '</div>';
    }).join('');
  }).catch((err) => console.error('Çengel bulmaca lider tablosu okunamadı:', err));
}

// Kullanıcı isteği: "zor orta kolay diye bir zorluk sırası olsun". Kolay =
// daha az kelime (daha seyrek ızgara, kesişim daha az -- takılma ihtimali
// düşük) + kısa/yaygın kelimelere ağırlık; Zor = daha çok kelime (daha yoğun
// ızgara) + uzun/az bilinen kelimelere ağırlık. Havuz, üretime girmeden önce
// zorluğa göre yeniden ağırlıklandırılıyor (kısa uzunlukları çoğaltıp/azaltıp
// uzun uzunlukları azaltıp/çoğaltarak) -- üretici algoritmasının kendisi
// değişmiyor, sadece hangi kelimelerin daha sık aday olacağı değişiyor.
const ZORLUK_AYARLARI = {
  kolay: { hedefCarpani: 0.7, kisaAgirlik: 3, uzunAgirlik: 1 },
  orta: { hedefCarpani: 1, kisaAgirlik: 1, uzunAgirlik: 1 },
  zor: { hedefCarpani: 1.25, kisaAgirlik: 1, uzunAgirlik: 3 }
};
function zorlugaGoreHavuz(havuz, boyut, zorluk) {
  const ayar = ZORLUK_AYARLARI[zorluk] || ZORLUK_AYARLARI.orta;
  const ortaUzunluk = boyut >= 15 ? 7 : 5;
  const yeni = {};
  Object.keys(havuz).forEach((uzunlukStr) => {
    const uzunluk = Number(uzunlukStr);
    const carpan = uzunluk <= ortaUzunluk ? ayar.kisaAgirlik : ayar.uzunAgirlik;
    let liste = havuz[uzunlukStr];
    if (carpan > 1) { liste = Array(Math.round(carpan)).fill(liste).flat(); }
    else if (carpan < 1 && carpan > 0) { liste = liste.slice(0, Math.max(1, Math.round(liste.length * carpan))); }
    yeni[uzunlukStr] = liste;
  });
  return yeni;
}

let HAM_HAVUZ = null;
let mevcutZorluk = 'orta';

function bulmacayiUret(boyut, oyunAdi, zorluk) {
  mevcutZorluk = zorluk;
  const hedefTemel = boyut >= 15 ? 35 : 10;
  const ayar = ZORLUK_AYARLARI[zorluk] || ZORLUK_AYARLARI.orta;
  const hedefKelimeSayisi = Math.round(hedefTemel * ayar.hedefCarpani);
  const havuz = zorlugaGoreHavuz(HAM_HAVUZ, boyut, zorluk);
  const uretim = cengelBulmacaUret(havuz, boyut, bugunTarih + ':' + SEED_VERSION + ':' + oyunAdi + ':' + zorluk, hedefKelimeSayisi);
  grid = uretim.grid;
  placedWords = uretim.placedWords;
  userGrid = Array.from({ length: BOYUT }, () => new Array(BOYUT).fill(''));
  durumuYukle();
  const ilkKelime = placedWords[0];
  aktif = ilkKelime ? { row: ilkKelime.row, col: ilkKelime.col, yon: 0 } : null;
  oyunBitti = false;
  durumuYukle();
  tamRenderVeOdak();
}

// Kullanıcı bulgusu: mobilde harf yazılamıyordu -- fiziksel klavye dinleyicisi
// (document keydown) sadece GERÇEK bir klavyesi olan cihazlarda işe yarar,
// dokunmatik telefonda ekran klavyesini AÇACAK hiçbir odaklanabilir <input>
// yoktu. Görünmez ama odaklanabilir bir metin kutusu (satır/gizli, ama
// display:none DEĞİL -- o zaman odaklanamaz) hücreye tıklanınca focus alıyor,
// mobil klavye açılıyor, input event'i harfi yakalıyor.
function gizliGirisiHazirla() {
  const giris = document.getElementById('cengel-gizli-giris');
  if (!giris) { return; }
  giris.addEventListener('input', () => {
    const deger = giris.value;
    giris.value = '';
    if (!deger) { return; }
    const h = deger.slice(-1).toLocaleLowerCase('tr-TR');
    if (/[abcçdefgğhıijklmnoöprsştuüvyz]/.test(h)) { harfGir(h); }
  });
  giris.addEventListener('keydown', (e) => {
    if (e.key === 'Backspace') { e.preventDefault(); geriSil(); }
  });
}
function gizliGirisineOdaklan() {
  const giris = document.getElementById('cengel-gizli-giris');
  if (giris && document.activeElement !== giris) { giris.focus({ preventScroll: true }); }
}

function zorlukBarRender() {
  const bar = document.getElementById('cengel-zorluk-bar');
  if (!bar) { return; }
  bar.querySelectorAll('[data-zorluk]').forEach((btn) => {
    btn.classList.toggle('btn-primary', btn.dataset.zorluk === mevcutZorluk);
    btn.classList.toggle('btn-outline', btn.dataset.zorluk !== mevcutZorluk);
  });
}

export function initCengelBulmaca(boyut, oyunAdi) {
  BOYUT = boyut;
  OYUN_ADI = oyunAdi;
  STORAGE_KEY = 'omuCengelBulmacaDurum_' + oyunAdi;
  const kapsayici = document.getElementById('cengel-izgara');
  if (!kapsayici) { return; }
  bugunTarih = bugununTarihiIstanbul();
  fetch('/data/cengel-kelime-havuzu.json').then((r) => r.json()).then((havuz) => {
    HAM_HAVUZ = havuz;
    bulmacayiUret(boyut, oyunAdi, 'orta');
    zorlukBarRender();
    document.getElementById('cengel-kontrol-btn') && document.getElementById('cengel-kontrol-btn').addEventListener('click', () => {
      const tamam = kontrolEt();
      if (!tamam) { showToast('Henüz tam değil veya bazı harfler yanlış.', { variant: 'error' }); }
    });
    document.getElementById('cengel-zorluk-bar') && document.getElementById('cengel-zorluk-bar').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-zorluk]');
      if (!btn || btn.dataset.zorluk === mevcutZorluk) { return; }
      bulmacayiUret(boyut, oyunAdi, btn.dataset.zorluk);
      zorlukBarRender();
    });
    gizliGirisiHazirla();
    fizikselKlavyeDinle();
  }).catch((err) => {
    console.error('Çengel bulmaca kelime havuzu yüklenemedi:', err);
    showToast('Bulmaca yüklenemedi.', { variant: 'error' });
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
    } catch (e) { console.error('Çengel bulmaca Firebase başlatılamadı:', e); }
  }
}
