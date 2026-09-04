// Gerçek takvim — ana sitedeki (app.js) Gün/Hafta/Ay/Yıl/Liste motorunun admin
// paneline portu. Aynı Firebase `etkinlikler` düğümüne bağlıdır, aynı piksel
// matematiğini (CAL_HOUR_H/CAL_GUTTER) ve aynı 3 sürükleme jestini (ızgara-
// seç-oluştur, kenar-sürükle-boyutlandır, çok-günlü-bar-sürükle) kullanır; tekil
// etkinlik taşıma SortableJS ile (ana sitedeki AYNI kütüphane). Sol filtre rayı
// (cal-rail-left) YOK — bkz. plan. Düzenleme modalı v1'de sadece çekirdek
// alanları kapsar (gorevli/haberYazanlari/haberMetni/katılımcılar bir sonraki
// iterasyona bırakıldı) — kaydederken var olan kaydın diğer alanları KORUNUR
// (okunup üstüne sadece formdaki alanlar yazılır, tam obje üzerine yazılmaz).

import Sortable from 'sortablejs';
import { showToast } from './toast.js';
import { showModal } from './modal.js';
import { facultyOptionsHtml, loadPressOfficerPool as loadPressOfficerPoolShared, renderPersonRolesPickerHtml } from './roster.js';
import { dbPath, isReadOnly, initDbMode, renderDbModeBanner, onDbModeChange } from './db-mode.js';

const firebaseConfig = {
  apiKey: 'AIzaSyDOfhq3aYW6sg2_zj0sFsRzXeGziGtLxCk',
  authDomain: 'omu-protokol.firebaseapp.com',
  databaseURL: 'https://omu-protokol-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'omu-protokol'
};

const CAL_HOUR_H = 48;
const CAL_GUTTER = 54;
// Dokunmatikte ızgara-seç-oluştur jesti artık ANINDA değil, kısa bir basılı-tutma sonrası
// başlıyor (bkz. calStartGridSelectGesture) -- kullanıcı isteği: aşağı kaydırmak için her
// dokunuşun yeni bir etkinlik oluşturmasını istemiyordu. 350ms basılı tutmaya "kasıtlı"
// davranış; bu süre içinde parmak 10px'ten fazla kayarsa kaydırma sayılır, jest iptal edilir.
const CAL_TOUCH_HOLD_MS = 350;
const CAL_TOUCH_MOVE_TOLERANCE = 10;

const CAL_DOW = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
const CAL_MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

const EVENT_TYPES = [
  { key: 'acilis',    ad: 'Açılış Töreni',            renk: '#c2410c' },
  { key: 'konferans', ad: 'Konferans',                 renk: '#1d4ed8' },
  { key: 'panel',     ad: 'Panel',                     renk: '#a21caf' },
  { key: 'calistay',  ad: 'Çalıştay',                  renk: '#65a30d' },
  { key: 'ziyaret',   ad: 'Protokol Ziyareti',         renk: '#a16207' },
  { key: 'imza',      ad: 'Protokol İmza Töreni',      renk: '#7c3aed' },
  { key: 'mezuniyet', ad: 'Mezuniyet Töreni',          renk: '#be123c' },
  { key: 'odul',      ad: 'Ödül Töreni',               renk: '#b45309' },
  { key: 'basin',     ad: 'Basın Toplantısı',          renk: '#0369a1' },
  { key: 'sergi',     ad: 'Sergi / Kültür-Sanat',      renk: '#0f766e' },
  { key: 'spor',      ad: 'Spor Etkinliği',            renk: '#15803d' },
  { key: 'gorevdegisimi', ad: 'Görev Değişimi',        renk: '#4338ca' },
  { key: 'akademikbasari', ad: 'Akademik Başarı',      renk: '#047857' },
  { key: 'kariyer',        ad: 'Kariyer Etkinliği',    renk: '#0e7490' },
  { key: 'topluluk',       ad: 'Öğrenci Toplulukları', renk: '#be185d' },
  { key: 'saglik',         ad: 'Sağlık Etkinliği',     renk: '#b91c1c' },
  { key: 'uluslararasi',   ad: 'Uluslararası Etkinlik', renk: '#334155' },
  { key: 'yesiluniversite',ad: 'Yeşil Üniversite',     renk: '#166534' },
  { key: 'toplanti',  ad: 'Toplantı',                  renk: '#475569' },
  { key: 'bayram',    ad: 'Ulusal ve Resmî Bayramlar', renk: '#b91c1c' },
  { key: 'diger',     ad: 'Diğer',                     renk: '#57534e' }
];
const EVENT_STATUS = [
  { key: 'planlandi',  ad: 'Planlandı',       renk: '#6b7280' },
  { key: 'yaziliyor',  ad: 'Haber yazılıyor', renk: '#b45309' },
  { key: 'incelemede', ad: 'İncelemede',      renk: '#7c3aed' },
  { key: 'tamamlandi', ad: 'Tamamlandı',      renk: '#15803d' },
  { key: 'iptal',      ad: 'İptal',           renk: '#b03a3a' }
];
// Ana sitedeki (app.js) EVENT_BADGES ile BİREBİR aynı — rozetler bu listeden okunur/yazılır.
const EVENT_BADGES = [
  { key: 'basina_kapali', ad: 'Basına Kapalı', renk: '#b91c1c', bg: '#fee2e2' },
  { key: 'dis_katilimli', ad: 'Dış Katılımlı', renk: '#1d4ed8', bg: '#dbeafe' },
  { key: 'canli_yayin',   ad: 'Canlı Yayın',   renk: '#b45309', bg: '#fef3c7' }
];

function escapeHtml(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function evType(k) { return EVENT_TYPES.find((t) => t.key === k) || EVENT_TYPES[EVENT_TYPES.length - 1]; }
function evStatus(k) { return EVENT_STATUS.find((s) => s.key === k) || EVENT_STATUS[0]; }
// Arşiv bağlantısı <a href> yerine sadece metin olarak kaydediliyor olsa da (admin panelinde
// henüz bağlantı olarak render edilmiyor), ana siteyle AYNI şema/güvenlik davranışı için
// javascript: gibi şemalar burada da baştan elenir (ana sitedeki safeLinkUrl ile birebir aynı).
function safeLinkUrl(u) { const s = String(u === undefined || u === null ? '' : u).trim(); return /^https?:\/\//i.test(s) ? s : ''; }
// "Basın Görevlisi" / "Haberi Yazan(lar)" alanları Firebase'de virgülle ayrılmış tek bir string
// olarak tutulur (ana sitedeki parseGorevliString ile birebir aynı ters/düz dönüşüm).
function parseGorevliString(s) { return String(s || '').split(',').map((x) => x.trim()).filter(Boolean); }

function pad2(n) { return (n < 10 ? '0' : '') + n; }
function dKey(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
function parseKey(s) {
  const a = String(s || '').split('-');
  if (a.length !== 3) { return null; }
  const y = Number(a[0]), m = Number(a[1]), day = Number(a[2]);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(day)) { return null; }
  const d = new Date(y, m - 1, day);
  if (isNaN(d.getTime())) { return null; }
  if (d.getFullYear() !== y || d.getMonth() !== m - 1 || d.getDate() !== day) { return null; }
  return d;
}
function addDays(d, n) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; }
function startOfWeek(d) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); const wd = (x.getDay() + 6) % 7; return addDays(x, -wd); }
function isSameDay(a, b) { return a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function todayDate() { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); }
function hmToMin(s) { const a = String(s || '').split(':'); if (a.length < 2) { return null; } const h = Number(a[0]), m = Number(a[1]); if (isNaN(h) || isNaN(m)) { return null; } if (h < 0 || h > 23 || m < 0 || m > 59) { return null; } return h * 60 + m; }
function minToHm(m) { return pad2(Math.floor(m / 60) % 24) + ':' + pad2(m % 60); }
function fmtTrDate(s) { const d = parseKey(s); if (!d) { return s || ''; } return d.getDate() + ' ' + CAL_MONTHS[d.getMonth()] + ' ' + d.getFullYear(); }
function fmtMultiDayRange(tarih, bitisTarihi) {
  const s = parseKey(tarih), e = parseKey(bitisTarihi);
  if (!s || !e) { return ''; }
  const sm = CAL_MONTHS[s.getMonth()].slice(0, 3), em = CAL_MONTHS[e.getMonth()].slice(0, 3);
  if (s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()) { return s.getDate() + '–' + e.getDate() + ' ' + sm; }
  return s.getDate() + ' ' + sm + '–' + e.getDate() + ' ' + em;
}

// ── State ──

let database = null;
let auth = null;
let eventsListenerRef = null;
let currentUserName = '';
let currentUserEmail = '';
let canWrite = false;

let EVENTS = {}; // id -> event
let calView = 'week';
let calAnchor = new Date();
let sortableInstances = [];

// Düzenleme modalındaki "Basın Görevlisi"/"Haberi Yazan(lar)" ve "Katılımcılar" pickerlarının
// veri havuzları. Ana sitedeki (app.js) gorevliLoadToken deseninin admin-src karşılığı:
// pressOfficerPool oturum boyunca modül seviyesinde önbelleklenir (her modal açılışında
// TEKRAR Firebase'den okunup tazelenir, ama iki açılış arasında eski değer ekranda kalabilir
// diye önce eski değerle render edilir); ilPoolCache ise ana sitedeki gibi kalıcı bir ikinci
// dinleyici AÇMADAN, "İl Protokolünü de dahil et" kutusu ilk işaretlendiğinde tek seferlik
// okunup önbelleğe alınır. calAttendees/calPressStaff/calNewsWriters ise (ana sitedeki gibi
// global DEĞİL) her openEventModal() çağrısında o modale özel yerel değişkenler olarak tutulur.
let pressOfficerPool = [];
let peoplePoolCache = null;
let ilPoolCache = null;
let openEventModalToken = 0;

function calDayCount() {
  if (calView === 'day') { return 1; }
  // Ana sitedeki (app.js calDayCount) tek eşikli 7→3 davranışının kademeli
  // hali: 700px'in altında hâlâ 3 gün (ana siteyle aynı alt sınır korunuyor),
  // ama 700-1049px arası (sidebar açıkken tablet genişlikleri) 7 gün sıkışık
  // kalmasın diye ara adım olarak 5 gün gösterilir.
  if (!window.matchMedia) { return 7; }
  if (window.matchMedia('(max-width:700px)').matches) { return 3; }
  if (window.matchMedia('(max-width:1049px)').matches) { return 5; }
  return 7;
}

// calView haftalık/günlük ızgara açıkken pencere yavaşça daraltılıp
// genişletildiğinde calDayCount()'un ürettiği gün sayısı canlı güncellensin
// diye -- initCalendar()'da bir kez bağlanır. Sayfa yenilenmeden tepki
// vermesi istendi (bkz. görev tanımı madde 1); debounce'lu, sık resize
// event'lerinde renderCalendar()'ı gereksiz yere onlarca kez tetiklemez.
let calResizeDebounceTimer = null;
let calLastDayCount = null;
function calOnWindowResize() {
  if (calView !== 'week' && calView !== 'day') { return; }
  clearTimeout(calResizeDebounceTimer);
  calResizeDebounceTimer = setTimeout(() => {
    // ESKİDEN her resize KOŞULSUZ renderCalendar() çağırıyordu. renderCalendar()'ın ilk işi
    // calCancelPendingCreate() olduğu için: mobilde parmakla saat aralığı seçtikten sonra
    // tarayıcı URL çubuğunun gizlenip görünmesi bile bir resize üretip bekleyen
    // "Oluştur/Vazgeç" onayını ve ghost'u sessizce siliyordu (ayrıca render tüm Sortable
    // örneklerini destroy ettiği için süren bir sürükleme de bozuluyordu).
    // Artık yalnızca gösterilecek GÜN SAYISI gerçekten değiştiyse ve bekleyen bir onay
    // yokken yeniden çizilir -- yeniden çizmenin tek amacı zaten buydu.
    if (calPendingCreate) { return; }
    const n = calDayCount();
    if (n === calLastDayCount) { return; }
    calLastDayCount = n;
    renderCalendar();
  }, 150);
}
function calVisibleWeekDays() {
  const n = calDayCount();
  const start = (n === 7 && calView !== 'day') ? startOfWeek(calAnchor) : new Date(calAnchor.getFullYear(), calAnchor.getMonth(), calAnchor.getDate());
  const days = [];
  for (let i = 0; i < n; i++) { days.push(addDays(start, i)); }
  return days;
}
function eventList() {
  const out = [];
  for (const id in EVENTS) {
    const e = EVENTS[id];
    if (!e || typeof e !== 'object' || !e.tarih) { continue; }
    out.push(Object.assign({}, e, { _id: id }));
  }
  out.sort((a, b) => {
    if (a.tarih !== b.tarih) { return a.tarih < b.tarih ? -1 : 1; }
    const sa = hmToMin(a.saat), sb = hmToMin(b.saat);
    if (sa === null && sb !== null) { return -1; }
    if (sb === null && sa !== null) { return 1; }
    if (sa !== null && sb !== null && sa !== sb) { return sa - sb; }
    return String(a.ad || '').localeCompare(String(b.ad || ''), 'tr');
  });
  return out;
}
// ESKİDEN burada "iptal" durumundakiler gizleniyordu (liste görünümü için bir istisnayla),
// ama renderListView o istisnayı ikinci bir filtreyle geri kapatıyordu -- sonuç: bir etkinliği
// İptal yapan editör onu takvimde HİÇBİR görünümde bir daha bulamıyordu (geri açmak, tarihini
// görmek, silmek imkânsızdı). Ana sitede (app.js calVisibleEvents) böyle bir gizleme YOK;
// iptaller görünür kalır, sadece .cancelled stiliyle (üstü çizili) ayırt edilir.
function visibleEvents() { return eventList(); }
function eventsOn(dateKey) { return visibleEvents().filter((e) => e.tarih === dateKey); }

// ── Firebase read/write ──

function attachEventsListener() {
  // Test Modu/Salt-Okunur Kilit açılıp kapanınca dbPath()'in döndürdüğü yol değişir --
  // önceki dinleyici (eski yolda) kapatılmazsa iki dala birden bağlı kalınır (bkz.
  // db-mode.js initDbMode dokümantasyonu).
  if (eventsListenerRef) { eventsListenerRef.off('value'); }
  eventsListenerRef = database.ref(dbPath('etkinlikler'));
  eventsListenerRef.on('value', (snap) => {
    const v = snap.val();
    EVENTS = (v && typeof v === 'object') ? v : {};
    renderCalendar();
  }, (err) => {
    console.error('Etkinlikler okunamadı:', err);
    EVENTS = {};
    renderCalendar();
  });
}

async function persistEvent(id, patch, logLabel) {
  if (!canWrite) { showToast('Bu işlem için düzenleme yetkiniz yok.', { variant: 'error' }); return null; }
  if (isReadOnly()) { showToast('Salt-okunur kilit açık, düzenleme yapılamaz.', { variant: 'error' }); return null; }
  const isNew = !id;
  const current = isNew ? {} : (EVENTS[id] || {});
  // İyimser kilit: kaydetmeden hemen önce sunucudaki GERÇEK guncellemeTs okunur. Modal
  // açıkken (ya da bu oturumda son bilinen) değerden farklıysa aradan başka bir editör
  // yazmış demektir -- sessizce üzerine yazmak yerine kullanıcı uyarılır.
  if (!isNew) {
    try {
      const freshSnap = await database.ref(dbPath('etkinlikler/' + id + '/guncellemeTs')).once('value');
      const freshTs = freshSnap.val();
      if (current.guncellemeTs && freshTs && freshTs !== current.guncellemeTs) {
        showToast('Bu etkinlik siz düzenlerken başka biri tarafından değiştirildi, sayfa yenilenip tekrar denenecek.', { variant: 'error' });
        return null;
      }
    } catch (err) {
      console.error('Çakışma kontrolü başarısız:', err);
    }
  }
  const finalId = id || database.ref(dbPath('etkinlikler')).push().key;
  const merged = Object.assign({}, current, patch);
  const updates = {};
  const toWrite = Object.assign({}, merged);
  if (isNew) { toWrite.olusturmaTs = firebase.database.ServerValue.TIMESTAMP; toWrite.olusturan = currentUserName || currentUserEmail; }
  toWrite.guncellemeTs = firebase.database.ServerValue.TIMESTAMP;
  updates[dbPath('etkinlikler/' + finalId)] = toWrite;
  const logKey = database.ref(dbPath('logs/etkinlik')).push().key;
  updates[dbPath('logs/etkinlik/' + logKey)] = {
    by: currentUserName || currentUserEmail, email: currentUserEmail,
    action: logLabel || 'Etkinlik güncellendi', target: merged.ad || '',
    timestamp: firebase.database.ServerValue.TIMESTAMP
  };
  try {
    await database.ref('/').update(updates);
    EVENTS[finalId] = merged;
    return { ok: true, id: finalId };
  } catch (err) {
    console.error('Etkinlik kaydedilemedi:', err);
    showToast('Etkinlik kaydedilemedi. Yetkinizi kontrol edin.', { variant: 'error' });
    return null;
  }
}

async function deleteEvent(id) {
  if (!canWrite) { showToast('Bu işlem için yetkiniz yok.', { variant: 'error' }); return; }
  if (isReadOnly()) { showToast('Salt-okunur kilit açık, düzenleme yapılamaz.', { variant: 'error' }); return; }
  const e = EVENTS[id]; if (!e) { return; }
  const updates = {};
  updates[dbPath('etkinlikler/' + id)] = null;
  const logKey = database.ref(dbPath('logs/etkinlik')).push().key;
  updates[dbPath('logs/etkinlik/' + logKey)] = {
    by: currentUserName || currentUserEmail, email: currentUserEmail,
    action: (e.ad || 'Etkinlik') + ' etkinliği takvimden silindi', target: e.ad || '',
    timestamp: firebase.database.ServerValue.TIMESTAMP
  };
  try {
    await database.ref('/').update(updates);
    delete EVENTS[id];
    showToast('Etkinlik silindi.', { variant: 'success' });
    renderCalendar();
  } catch (err) {
    console.error('Etkinlik silinemedi:', err);
    showToast('Etkinlik silinemedi.', { variant: 'error' });
  }
}

// Basit alan-bazlı değişiklik özeti — ana sitedeki describeEventChanges'in çekirdek alan alt kümesi.
const FIELD_LABELS = {
  ad: 'Etkinlik Adı', tur: 'Tür', durum: 'Durum', tarih: 'Tarih', saat: 'Başlangıç Saati',
  bitisSaat: 'Bitiş Saati', bitisTarihi: 'Bitiş Tarihi (çok günlü)', yer: 'Yer / Mekân',
  birim: 'Düzenleyen Birim', planlayan: 'Planlayan / Sorumlu', gorevli: 'Basın Görevlisi',
  haberYazanlari: 'Haberi Yazan(lar)', haberKaynagi: 'Haber Kaynağı', not: 'Not', locked: 'Kilit'
};
// Tarih alanları logda ham YYYY-MM-DD yerine ana sitedeki gibi (app.js fmtTrDate) okunur
// biçimde yazılır -- log satırını insan okuyacak.
function logDate(v) { const d = parseKey(v); return d ? (d.getDate() + ' ' + CAL_MONTHS[d.getMonth()] + ' ' + d.getFullYear()) : (v || '(boş)'); }
function describeChanges(oldE, newE) {
  oldE = oldE || {}; newE = newE || {};
  const changes = [];
  if ((oldE.tur || 'diger') !== (newE.tur || 'diger')) { changes.push(FIELD_LABELS.tur + ': ' + evType(oldE.tur).ad + ' → ' + evType(newE.tur).ad); }
  if ((oldE.durum || 'planlandi') !== (newE.durum || 'planlandi')) { changes.push(FIELD_LABELS.durum + ': ' + evStatus(oldE.durum).ad + ' → ' + evStatus(newE.durum).ad); }
  ['tarih', 'bitisTarihi'].forEach((k) => {
    const o = (oldE[k] === null || oldE[k] === undefined) ? '' : String(oldE[k]).trim();
    const n = (newE[k] === null || newE[k] === undefined) ? '' : String(newE[k]).trim();
    if (o !== n) { changes.push(FIELD_LABELS[k] + ': ' + (o ? logDate(o) : '(boş)') + ' → ' + (n ? logDate(n) : '(boş)')); }
  });
  ['ad', 'saat', 'bitisSaat', 'yer', 'birim', 'planlayan', 'gorevli', 'haberYazanlari', 'haberKaynagi', 'not'].forEach((k) => {
    const o = (oldE[k] === null || oldE[k] === undefined) ? '' : String(oldE[k]).trim();
    const n = (newE[k] === null || newE[k] === undefined) ? '' : String(newE[k]).trim();
    if (o !== n) { changes.push(FIELD_LABELS[k] + ': ' + (o || '(boş)') + ' → ' + (n || '(boş)')); }
  });
  // ESKİDEN bu metin TERSTİ: etkinlik KİLİTLENDİĞİNDE loga "Kilit: açıldı" yazıyordu.
  if (!!oldE.locked !== !!newE.locked) { changes.push(FIELD_LABELS.locked + ': ' + (newE.locked ? '🔒 kilitlendi' : 'kilit açıldı')); }
  return changes;
}
function evLogName(s) { return String(s || 'Etkinlik').split(' · ').join(' - '); }

// ── Block styling helpers ──

function calBlockStyle(ev) { const ty = evType(ev.tur); return 'background:' + ty.renk + '; color:#fff;'; }
function calBlockClasses(ev, dayDate) {
  let c = 'cal-block';
  const st = ev.durum || 'planlandi';
  if (st === 'tamamlandi') { c += ' done'; }
  if (st === 'iptal') { c += ' cancelled'; }
  if (dayDate && dayDate < todayDate()) { c += ' past'; }
  if (ev.locked) { c += ' locked'; }
  // Operasyonlar'daki "Bir Etkinliğe Gidiyorum" (quick-event.js) taslak
  // etkinlikleri "taslak:true" ile işaretliyor -- burada görsel olarak öne
  // çıkarılır (bkz. _real-calendar.scss .cal-taslak), form üzerinden
  // kaydedilince otomatik temizlenir (bkz. openEventModal patch.taslak=null).
  if (ev.taslak) { c += ' cal-taslak'; }
  return c;
}
// Rozetler (Basına Kapalı / Dış Katılımlı / Canlı Yayın) -- ana sitedeki badgeHtml
// ile birebir aynı. Modalde seçilip Firebase'e yazılıyorlardı ama takvim bloklarında
// HİÇ gösterilmiyordu (port sırasında atlanmış); artık ana sitedeki gibi kilit
// simgesinin hemen öncesinde, her görünümde çiziliyor.
function badgeHtml(ev) {
  const keys = Array.isArray(ev.rozetler) ? ev.rozetler : [];
  if (!keys.length) { return ''; }
  return '<span class="cal-badge-wrap">' + keys.map((k) => {
    const b = EVENT_BADGES.find((x) => x.key === k);
    if (!b) { return ''; }
    return '<span class="cal-badge" style="background:' + b.bg + '; color:' + b.renk + ';">' + escapeHtml(b.ad) + '</span>';
  }).join('') + '</span>';
}
// Ana sitedeki lockIconHtml/toggleEventLock ile birebir aynı: kilit, düzenleme
// modalının İÇİNDE bir alan DEĞİL, etkinliğin kendi üzerinde her zaman görünen,
// dokunulabilir bir simge -- tıklanınca (event.stopPropagation() ile bloğun
// kendi tıklama/sürükleme davranışına sızmadan) doğrudan kilit durumunu değiştirir.
const LOCK_SVG_CLOSED = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
const LOCK_SVG_OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V9a4 4 0 0 1 7.65-1.65"/></svg>';
function lockIconHtml(ev) {
  const locked = !!ev.locked;
  // Yetkisiz kullanıcıda kilit AÇMA/KAPAMA anlamsız (tıklayınca sadece hata toast'ı
  // çıkıyordu); kilitli etkinliklerde durum yine görünsün diye salt-okunur bir rozet
  // olarak gösterilir, kilitsizlerde hiç çizilmez.
  if (!canWrite) {
    return locked ? '<span class="cal-lock-ico is-locked is-static" title="Kilitli">' + LOCK_SVG_CLOSED + '</span>' : '';
  }
  const title = locked ? 'Kilitli · sürüklenemez (açmak için dokun)' : 'Kilitle (sürüklenmesini/boyutunu değiştirmeyi engelle)';
  return '<span class="cal-lock-ico' + (locked ? ' is-locked' : '') + '" data-lock-evid="' + escapeHtml(ev._id) + '" title="' + title + '">' + (locked ? LOCK_SVG_CLOSED : LOCK_SVG_OPEN) + '</span>';
}
async function toggleEventLock(id) {
  if (!canWrite) { showToast('Bu işlem için düzenleme yetkiniz yok.', { variant: 'error' }); return; }
  const ev = EVENTS[id]; if (!ev) { return; }
  const wasLocked = !!ev.locked;
  const patch = { locked: !wasLocked };
  const label = evLogName(ev.ad) + ' etkinliği ' + (wasLocked ? 'kilidi açıldı' : 'kilitlendi');
  const res = await persistEvent(id, patch, label);
  if (res) { renderCalendar(); }
}

// ── Layout algorithms (ported verbatim from app.js) ──

function layoutDay(evs) {
  const items = evs.map((e) => {
    let s = hmToMin(e.saat); let en = hmToMin(e.bitisSaat);
    if (s === null) { return null; }
    if (en === null) { en = s + 60; } else if (en <= s) { en = 24 * 60; }
    return { ev: e, s, e: Math.min(en, 24 * 60) };
  }).filter(Boolean);
  items.sort((a, b) => a.s - b.s || b.e - a.e);
  const colEnds = [];
  items.forEach((it) => {
    let c = 0; while (c < colEnds.length && colEnds[c] > it.s) { c++; }
    colEnds[c] = it.e; it.col = c;
  });
  let clusterStart = 0, clusterMaxEnd = -Infinity, clusterMaxCol = 0;
  function closeCluster(from, to) { const width = clusterMaxCol + 1; for (let i = from; i < to; i++) { items[i].total = width; } }
  items.forEach((it, i) => {
    if (i > 0 && it.s >= clusterMaxEnd) { closeCluster(clusterStart, i); clusterStart = i; clusterMaxCol = 0; }
    clusterMaxEnd = Math.max(clusterMaxEnd, it.e); clusterMaxCol = Math.max(clusterMaxCol, it.col);
  });
  closeCluster(clusterStart, items.length);
  return items;
}
function layoutMultiDayRow(bars) {
  bars.sort((a, b) => a.startIdx - b.startIdx || b.endIdx - a.endIdx);
  const rowEnds = [];
  bars.forEach((b) => {
    let r = 0; while (r < rowEnds.length && rowEnds[r] >= b.startIdx) { r++; }
    rowEnds[r] = b.endIdx; b.row = r;
  });
  return Math.max(1, rowEnds.length);
}

// ── Render dispatcher ──

function renderCalendar() {
  calCancelPendingCreate();
  // calOnWindowResize "gün sayısı değişti mi" karşılaştırmasını buradaki değere göre yapar.
  calLastDayCount = calDayCount();
  sortableInstances.forEach((inst) => inst.destroy()); sortableInstances = [];
  renderTopbar();
  const body = document.getElementById('calMainBody'); if (!body) { return; }
  if (calView === 'week' || calView === 'day') { renderWeekView(body); }
  else if (calView === 'month') { renderMonthView(body); }
  else if (calView === 'year') { renderYearView(body); }
  else { renderListView(body); }
}

function renderTopbar() {
  document.querySelectorAll('#calViewTabs .cal-viewbtn').forEach((b) => b.classList.toggle('active', b.dataset.view === calView));
  const lab = document.getElementById('calMonthLabel'); if (!lab) { return; }
  if (calView === 'day') {
    const d = calAnchor;
    lab.textContent = d.getDate() + ' ' + CAL_MONTHS[d.getMonth()] + ' ' + d.getFullYear() + ' · ' + CAL_DOW[(d.getDay() + 6) % 7];
  } else if (calView === 'week') {
    const dn = calDayCount();
    const s = (dn === 7) ? startOfWeek(calAnchor) : new Date(calAnchor.getFullYear(), calAnchor.getMonth(), calAnchor.getDate());
    const e = addDays(s, dn - 1);
    if (s.getMonth() === e.getMonth()) { lab.textContent = CAL_MONTHS[s.getMonth()] + ' ' + s.getFullYear(); }
    else if (s.getFullYear() === e.getFullYear()) { lab.textContent = CAL_MONTHS[s.getMonth()].slice(0, 3) + '–' + CAL_MONTHS[e.getMonth()].slice(0, 3) + ' ' + s.getFullYear(); }
    else { lab.textContent = CAL_MONTHS[s.getMonth()].slice(0, 3) + ' ' + s.getFullYear() + ' – ' + CAL_MONTHS[e.getMonth()].slice(0, 3) + ' ' + e.getFullYear(); }
  } else if (calView === 'month') {
    lab.textContent = CAL_MONTHS[calAnchor.getMonth()] + ' ' + calAnchor.getFullYear();
  } else if (calView === 'year') {
    lab.textContent = String(calAnchor.getFullYear());
  } else {
    lab.textContent = 'Yaklaşan Etkinlikler';
  }
}

function calSetView(v) { calView = v; renderCalendar(); }
function calShift(dir) {
  if (calView === 'day') { calAnchor = addDays(calAnchor, dir); }
  else if (calView === 'week') { calAnchor = addDays(calAnchor, dir * calDayCount()); }
  else if (calView === 'month') { calAnchor = new Date(calAnchor.getFullYear(), calAnchor.getMonth() + dir, 1); }
  else if (calView === 'year') { calAnchor = new Date(calAnchor.getFullYear() + dir, calAnchor.getMonth(), calAnchor.getDate()); }
  else { calAnchor = addDays(calAnchor, dir * 30); }
  renderCalendar();
}
function calToday() { calAnchor = todayDate(); renderCalendar(); }
function calGoToDay(dateKey) { const d = parseKey(dateKey); if (!d) { return; } calAnchor = d; calSetView('day'); }
function calGoToMonth(y, m) { calAnchor = new Date(y, m, 1); calSetView('month'); }

// ── Week/Day view ──

let calWeekScrollKey = null;
let calWeekScrollTopPreserved = null;
let calDidInitialMobileScroll = false;

function renderWeekView(body) {
  const n = calDayCount();
  const today = todayDate();
  const cols = 'grid-template-columns:' + CAL_GUTTER + 'px repeat(' + n + ',minmax(0,1fr));';
  const days = calVisibleWeekDays();

  let head = '<div class="cal-tg-head" style="' + cols + '"><div class="cal-gutter-cell"></div>';
  days.forEach((d) => {
    const wd = (d.getDay() + 6) % 7;
    const cls = 'cal-dhead' + (isSameDay(d, today) ? ' is-today' : '') + (wd >= 5 ? ' is-weekend' : '');
    head += '<div class="' + cls + '"><span class="dw">' + CAL_DOW[wd] + '</span><span class="dn">' + d.getDate() + '</span></div>';
  });
  head += '</div>';

  const viewFrom = dKey(days[0]), viewTo = dKey(days[days.length - 1]);
  const multiDayBars = visibleEvents().filter((e) => e.bitisTarihi && e.bitisTarihi !== e.tarih && e.tarih <= viewTo && e.bitisTarihi >= viewFrom).map((e) => {
    const s = parseKey(e.tarih), en = parseKey(e.bitisTarihi);
    const rawStart = Math.round((s - days[0]) / 86400000), rawEnd = Math.round((en - days[0]) / 86400000);
    return { ev: e, startIdx: Math.max(0, rawStart), endIdx: Math.min(days.length - 1, rawEnd), continuesLeft: e.tarih < viewFrom, continuesRight: e.bitisTarihi > viewTo };
  });
  const multiDayRowCount = layoutMultiDayRow(multiDayBars);
  let multiday = '';
  if (multiDayBars.length) {
    multiday = '<div class="cal-allday-multiday" style="' + cols + ' grid-template-rows:repeat(' + multiDayRowCount + ',24px);">';
    multiday += multiDayBars.map((b) => {
      const e = b.ev; const ty = evType(e.tur);
      const gc = 'grid-column:' + (b.startIdx + 2) + ' / ' + (b.endIdx + 3) + '; grid-row:' + (b.row + 1) + ';';
      const cls = 'cal-multiday-bar' + (b.continuesLeft ? ' continues-left' : '') + (b.continuesRight ? ' continues-right' : '') + ((e.durum === 'tamamlandi') ? ' done' : '') + (e.locked ? ' locked' : '');
      // Kilitli çok-günlü etkinlikte kenar-sürükle-boyutlandır kolları hiç
      // render edilmez (calStartMultiDayGesture zaten .cal-multiday-handle
      // arıyor, kol yoksa jest hiç başlamaz).
      return '<button type="button" class="' + cls + '" data-evid="' + escapeHtml(e._id) + '" data-act="edit" style="' + gc + ' background:' + ty.renk + '; border-color:' + ty.renk + '; color:#fff;">' +
        '<span class="t">' + escapeHtml(e.ad || '(adsız)') + '</span>' + badgeHtml(e) + lockIconHtml(e) +
        (e.locked ? '' : '<span class="cal-multiday-handle cal-multiday-handle-l" data-act="multiday-resize-l" aria-hidden="true"></span>' +
        '<span class="cal-multiday-handle cal-multiday-handle-r" data-act="multiday-resize-r" aria-hidden="true"></span>') + '</button>';
    }).join('');
    multiday += '</div>';
  }

  let allday = '<div class="cal-allday" style="' + cols + '"><div class="cal-allday-label">tüm gün</div>';
  days.forEach((d) => {
    const k = dKey(d);
    const evs = eventsOn(k).filter((e) => hmToMin(e.saat) === null && !(e.bitisTarihi && e.bitisTarihi !== e.tarih));
    allday += '<div class="cal-allday-col" data-date="' + k + '">' + evs.map((e) => {
      const ty = evType(e.tur);
      // Rozet + kilit ESKİDEN burada YOKTU (ana sitede var, app.js:4646): saatsiz (tüm gün)
      // bir etkinlik SADECE bu çip olarak çizildiği için, ana sitede kilitlenmiş bir tüm-gün
      // etkinliğinin kilidi admin panelinden açılamıyordu -- sürüklenmiyordu (calSortableFilter
      // engelliyor) ama kilidi görünmediği için nedeni de anlaşılmıyordu.
      return '<button type="button" class="cal-allday-chip' + ((e.durum === 'tamamlandi') ? ' done' : '') + ((e.durum === 'iptal') ? ' cancelled' : '') + '" data-evid="' + escapeHtml(e._id) + '" data-act="edit" style="background:' + ty.renk + '; border-left-color:' + ty.renk + '; color:#fff;"><span class="t">' + escapeHtml(e.ad || '(adsız)') + '</span>' + badgeHtml(e) + lockIconHtml(e) + '</button>';
    }).join('') + '</div>';
  });
  allday += '</div>';

  const H = 24 * CAL_HOUR_H;
  let nowLabel = ''; let nowTop = null;
  if (days.some((d) => isSameDay(d, today))) {
    const nw = new Date(); const nmins = nw.getHours() * 60 + nw.getMinutes(); nowTop = (nmins / 60) * CAL_HOUR_H;
    nowLabel = '<div class="cal-nowlabel" style="top:' + nowTop + 'px; right:4px;">' + pad2(nw.getHours()) + ':' + pad2(nw.getMinutes()) + '</div>';
  }
  let gutter = '<div class="cal-gutter" style="height:' + H + 'px;">';
  for (let h = 1; h < 24; h++) { gutter += '<div class="cal-hourlab" style="top:' + (h * CAL_HOUR_H) + 'px;">' + pad2(h) + ':00</div>'; }
  gutter += nowLabel + '</div>';

  let cells = '';
  days.forEach((d) => {
    const k = dKey(d); const wd = (d.getDay() + 6) % 7;
    const isToday = isSameDay(d, today);
    let inner = '';
    for (let h = 1; h < 24; h++) { inner += '<div class="cal-hrline" style="top:' + (h * CAL_HOUR_H) + 'px;"></div>'; }
    layoutDay(eventsOn(k)).forEach((it) => {
      const e = it.ev; const top = (it.s / 60) * CAL_HOUR_H; const hgt = Math.max(18, ((it.e - it.s) / 60) * CAL_HOUR_H - 2);
      const w = 100 / it.total; const left = w * it.col;
      const compact = hgt < 34 ? ' compact' : '';
      const stBar = evStatus(e.durum).renk;
      inner += '<button type="button" class="' + calBlockClasses(e, d) + compact + '" data-evid="' + escapeHtml(e._id) + '" data-act="edit" ' +
        'style="' + calBlockStyle(e) + ' top:' + top + 'px; height:' + hgt + 'px; left:calc(' + left + '% + 2px); width:calc(' + w + '% - 4px);">' +
        '<span class="bt">' + escapeHtml(e.ad || '(adsız)') + '</span><span class="bh">' + escapeHtml(e.saat || '') + (e.bitisSaat ? '–' + escapeHtml(e.bitisSaat) : '') + '</span>' + badgeHtml(e) + lockIconHtml(e) +
        '<span class="cal-status-bar" style="background:' + stBar + ';"></span>' +
        // Kollar yalnızca GERÇEKTEN boyutlandırabilecek kullanıcıya çizilir: yetkisiz
        // kullanıcı eskiden ns-resize imleci ve hover "grip" ipucu görüyor, sürükleyince
        // hiçbir şey olmuyordu (calStartResizeGesture canWrite'ta sessizce dönüyor).
        // Ana site aynı şeyi .edit-only + body.is-readonly CSS'iyle yapıyor.
        ((e.locked || !canWrite) ? '' :
        '<span class="cal-resize-handle cal-resize-handle-top" data-act="resize-handle" aria-hidden="true"></span>' +
        '<span class="cal-resize-handle" data-act="resize-handle" aria-hidden="true"></span>') + '</button>';
    });
    if (isToday && nowTop !== null) { inner += '<div class="cal-nowline-full" style="top:' + nowTop + 'px;"></div>'; }
    cells += '<div class="cal-daycol' + (wd >= 5 ? ' is-weekend' : '') + (isToday ? ' is-today' : '') + '" data-date="' + k + '" style="height:' + H + 'px;">' + inner + '</div>';
  });

  const prevSc = document.getElementById('calTgScroll');
  calWeekScrollTopPreserved = prevSc ? prevSc.scrollTop : null;

  body.innerHTML = '<div class="cal-tg">' + head + multiday + allday +
    '<div class="cal-tg-scroll" id="calTgScroll"><div class="cal-tg-body" style="' + cols + '">' + gutter + cells + '</div></div></div>';

  if (canWrite) {
    body.querySelectorAll('.cal-allday-col, .cal-daycol').forEach((col) => {
      sortableInstances.push(new Sortable(col, calSortableOptions('calWeek')));
    });
  }

  const scrollKey = calView + '|' + dKey(days[0]);
  const isFreshView = scrollKey !== calWeekScrollKey;
  calWeekScrollKey = scrollKey;
  const sc = document.getElementById('calTgScroll');
  // Başlık satırı ve tüm-gün şeridi kaydırma çubuğunun DIŞINDA kalıyor, saat ızgarası ise
  // onun İÇİNDE -- telafi edilmezse (klasik kaydırma çubuğu kullanan masaüstü tarayıcılarda)
  // gün başlıkları sütunlardan çubuk genişliği kadar kayıyor. Ana sitedeki app.js:4738-4744
  // ile aynı telafi; çubuk kaplamalı (overlay) olan platformlarda sbw=0 çıkar, hiçbir şey olmaz.
  if (sc) {
    const sbw = sc.offsetWidth - sc.clientWidth;
    if (sbw > 0) {
      const headEl = body.querySelector('.cal-tg-head');
      const alldayEl = body.querySelector('.cal-allday');
      const multidayEl = body.querySelector('.cal-allday-multiday');
      if (headEl) { headEl.style.paddingRight = sbw + 'px'; }
      if (alldayEl) { alldayEl.style.paddingRight = sbw + 'px'; }
      if (multidayEl) { multidayEl.style.paddingRight = sbw + 'px'; }
    }
  }
  if (sc) {
    if (!isFreshView && calWeekScrollTopPreserved !== null) {
      sc.scrollTop = calWeekScrollTopPreserved;
    } else {
      const hasToday = days.some((d) => isSameDay(d, today));
      const target = hasToday ? Math.max(0, (new Date().getHours() - 2) * CAL_HOUR_H) : 7 * CAL_HOUR_H;
      sc.scrollTop = Math.max(0, target - 12);
      // Kullanıcı isteği: mobil/iOS'ta sayfa AÇILDIĞINDA o anki saat (kırmızı çizgi) görünsün,
      // sayfanın en tepesinden (başlık/araç çubuğu) başlamasın -- iç ızgaranın scrollTop'ı
      // yukarıda zaten doğru satıra ayarlanıyor ama SAYFA (viewport) yine de en üstte
      // kalıyordu, kullanıcı ızgarayı görmek için elle aşağı kaydırmak zorunda kalıyordu.
      // Önceki sürüm scrollIntoView + requestAnimationFrame kullanıyordu ama bu, Firebase
      // verisi/yetki kontrolü asenkron geldiği için sayfa yüksekliği HENÜZ oturmadan
      // çalışıp etkisiz kalabiliyordu -- artık window.scrollTo ile MUTLAK hedef konum
      // hesaplanıyor ve ilk render'dan biraz sonra (asenkron içerik oturana kadar) çalışıyor.
      // SADECE İLK açılışta (her yeniden çizimde DEĞİL) ve SADECE dar ekranda (masaüstünde
      // istenmedi) uygulanır.
      if (hasToday && !calDidInitialMobileScroll && window.matchMedia && window.matchMedia('(max-width:700px)').matches) {
        calDidInitialMobileScroll = true;
        setTimeout(() => {
          const card = body.closest('.cal-card') || body;
          const topbarH = document.querySelector('.topbar')?.offsetHeight || 0;
          const targetY = window.scrollY + card.getBoundingClientRect().top - topbarH - 8;
          window.scrollTo({ top: Math.max(0, targetY) });
        }, 300);
      }
    }
  }
}

function calGridClick(e, dateKey, col) {
  if (calGridSelectSuppressClick) { calGridSelectSuppressClick = false; return; }
  if (!canWrite) { return; }
  if (e.target.closest('.cal-block')) { return; }
  // Bekleyen ghost'un GÖVDESİ pointer-events:none olduğu için üzerine yapılan bir dokunuş
  // ALTINDAKİ .cal-daycol'a "düşüp" buraya kadar geliyordu -- kullanıcı sürükleme kolunu
  // tam yakalayamayınca (özellikle mobilde) beklenmedik biçimde YENİ bir etkinlik açılıyordu.
  // calPendingCreate varken bu tık tamamen yok sayılır, ghost titretilerek uyarılır.
  if (calPendingCreate) { calShakePendingCreate(); return; }
  const rect = col.getBoundingClientRect();
  const y = e.clientY - rect.top;
  let mins = Math.round((y / CAL_HOUR_H) * 60 / 30) * 30;
  mins = Math.max(0, Math.min(23 * 60 + 30, mins));
  // Kullanıcı isteği: mobilde tek dokunuş da masaüstündeki gibi DOĞRUDAN düzenleme ekranını
  // açmasın -- sürükleyerek oluşturmayla AYNI 1 saatlik onay silüetini gösterir, kullanıcı
  // isterse kollarla saati ince ayar edip "Oluştur"a basar. Masaüstünde (fare) davranış
  // DEĞİŞMEDİ: tek tık hâlâ doğrudan düzenleme ekranını açar.
  if (window.matchMedia && window.matchMedia('(max-width:700px)').matches) {
    const ghost = document.createElement('div');
    ghost.className = 'cal-create-select';
    col.appendChild(ghost);
    calShowPendingCreateBar(ghost, dateKey, mins, Math.min(24 * 60, mins + 60));
    return;
  }
  openEventModal(null, dateKey, minToHm(mins));
}

// ── Month view ──

function renderMonthView(body) {
  const first = new Date(calAnchor.getFullYear(), calAnchor.getMonth(), 1);
  const start = startOfWeek(first); const today = todayDate();
  let dow = '<div class="cal-m-dow">' + CAL_DOW.map((d) => '<span>' + d + '</span>').join('') + '</div>';
  let cells = '';
  for (let i = 0; i < 42; i++) {
    const d = addDays(start, i); const k = dKey(d); const wd = (d.getDay() + 6) % 7;
    let cls = 'cal-mday';
    if (d.getMonth() !== calAnchor.getMonth()) { cls += ' other'; }
    if (wd >= 5) { cls += ' weekend'; }
    if (isSameDay(d, today)) { cls += ' today'; }
    const evs = eventsOn(k);
    const shown = evs.slice(0, 3);
    let chips = shown.map((e) => {
      return '<button type="button" class="cal-block compact' + ((e.durum === 'tamamlandi') ? ' done' : '') + ((e.durum === 'iptal') ? ' cancelled' : '') + (e.locked ? ' locked' : '') + (e.taslak ? ' cal-taslak' : '') + '" data-evid="' + escapeHtml(e._id) + '" data-act="edit" style="position:relative; ' + calBlockStyle(e) + '">' +
        ((e.bitisTarihi && e.bitisTarihi !== e.tarih) ? '<span class="bh">' + escapeHtml(fmtMultiDayRange(e.tarih, e.bitisTarihi)) + '</span>' : (e.saat ? '<span class="bh">' + escapeHtml(e.saat) + '</span>' : '')) + '<span class="bt">' + escapeHtml(e.ad || '(adsız)') + '</span>' + lockIconHtml(e) + '</button>';
    }).join('');
    if (evs.length > shown.length) { chips += '<button type="button" class="cal-more" data-date="' + k + '" data-act="more">+' + (evs.length - shown.length) + ' tane daha</button>'; }
    cells += '<div class="' + cls + '" data-date="' + k + '">' +
      '<div class="cal-mdayhead"><span class="cal-mdaynum">' + d.getDate() + '</span>' +
      (canWrite ? '<button type="button" class="cal-mdayadd" data-date="' + k + '" data-act="add" title="Bu güne etkinlik ekle">+</button>' : '') + '</div>' +
      '<div class="cal-mday-chips" data-date="' + k + '">' + chips + '</div></div>';
  }
  body.innerHTML = '<div class="cal-m">' + dow + '<div class="cal-m-grid">' + cells + '</div></div>';
  if (canWrite) {
    body.querySelectorAll('.cal-mday-chips').forEach((wrap) => {
      sortableInstances.push(new Sortable(wrap, calSortableOptions('calMonth')));
    });
  }
}

// ── Year view ──

function renderYearView(body) {
  const year = calAnchor.getFullYear();
  const today = todayDate();
  let html = '<div class="cal-year-grid">';
  for (let m = 0; m < 12; m++) {
    const start = startOfWeek(new Date(year, m, 1));
    let cells = '';
    for (let i = 0; i < 42; i++) {
      const d = addDays(start, i);
      if (d.getMonth() !== m) { cells += '<span class="cal-year-day empty">' + d.getDate() + '</span>'; continue; }
      const k = dKey(d);
      const evs = eventsOn(k);
      const dot = evs.length ? '<span class="cal-year-dot" style="background:' + evType(evs[0].tur).renk + ';"></span>' : '';
      cells += '<button type="button" class="cal-year-day' + (isSameDay(d, today) ? ' today' : '') + '" data-date="' + k + '" data-act="goto-day" title="' + escapeHtml(fmtTrDate(k) + (evs.length ? (' · ' + evs.length + ' etkinlik') : '')) + '">' + d.getDate() + dot + '</button>';
    }
    html += '<div class="cal-year-month"><button type="button" class="cal-year-month-title" data-year="' + year + '" data-month="' + m + '" data-act="goto-month">' + CAL_MONTHS[m] + '</button>' +
      '<div class="cal-mini-grid">' + CAL_DOW.map((d) => '<span class="cal-mini-dow">' + d.charAt(0) + '</span>').join('') + cells + '</div></div>';
  }
  html += '</div>';
  body.innerHTML = html;
}

// ── List view ──

function renderListView(body) {
  const today = todayDate();
  const evs = visibleEvents();
  if (!evs.length) { body.innerHTML = '<div class="cal-list-wrap"><div class="cal-empty">Etkinlik yok.</div></div>'; return; }
  let html = '<div class="cal-list">'; let lastDay = null;
  evs.forEach((e) => {
    if (e.tarih !== lastDay) {
      lastDay = e.tarih; const d = parseKey(e.tarih); const isT = isSameDay(d, today);
      html += '<div class="cal-list-daysep' + (isT ? ' is-today' : '') + '">' + fmtTrDate(e.tarih) + '<span class="dow">' + CAL_DOW[(d.getDay() + 6) % 7] + (isT ? ' · BUGÜN' : '') + '</span></div>';
    }
    const ty = evType(e.tur), st = evStatus(e.durum);
    const evD = parseKey(e.tarih), isPast = evD && evD < today;
    const meta = []; if (e.yer) { meta.push(escapeHtml(e.yer)); } if (e.birim) { meta.push(escapeHtml(e.birim)); }
    html += '<button type="button" class="cal-ev' + (e.taslak ? ' cal-taslak' : '') + '" data-evid="' + escapeHtml(e._id) + '" data-act="edit">' +
      '<span class="cal-ev-dot" style="background:' + ty.renk + ';"></span>' +
      '<span class="cal-ev-time">' + escapeHtml((e.bitisTarihi && e.bitisTarihi !== e.tarih) ? fmtMultiDayRange(e.tarih, e.bitisTarihi) : (e.saat || '—')) + '</span>' +
      '<span class="cal-ev-main"><span class="cal-ev-name' + ((e.durum === 'tamamlandi' || e.durum === 'iptal' || isPast) ? ' done' : '') + '">' + escapeHtml(e.ad || '(adsız)') + '</span>' + badgeHtml(e) + lockIconHtml(e) +
      '<span class="cal-ev-meta"><span class="cal-tag" style="background:' + st.renk + ';">' + escapeHtml(st.ad) + '</span>' + meta.join(' · ') + '</span></span></button>';
  });
  body.innerHTML = '<div class="cal-list-wrap">' + html + '</div>';
}

// ── SortableJS move (day/week grid + month cells) ──

function pointerXY(nativeEvt) {
  if (!nativeEvt) { return null; }
  if (nativeEvt.touches && nativeEvt.touches.length) { return { x: nativeEvt.touches[0].clientX, y: nativeEvt.touches[0].clientY }; }
  if (nativeEvt.changedTouches && nativeEvt.changedTouches.length) { return { x: nativeEvt.changedTouches[0].clientX, y: nativeEvt.changedTouches[0].clientY }; }
  if (typeof nativeEvt.clientY === 'number') { return { x: nativeEvt.clientX, y: nativeEvt.clientY }; }
  return null;
}
let calDragLastXY = null;
let calDragGrabOffsetY = 0;
let calDragMoveGhost = null;

function calOnDragStart(evt) {
  calDragGrabOffsetY = 0;
  const xy = pointerXY(evt.originalEvent);
  if (xy && evt.item) { const r = evt.item.getBoundingClientRect(); calDragGrabOffsetY = xy.y - r.top; }
  const id = evt.item && evt.item.dataset ? evt.item.dataset.evid : null;
  const ev = id ? EVENTS[id] : null;
  if (ev && evt.from && evt.from.classList && evt.from.classList.contains('cal-daycol')) {
    const ghost = document.createElement('div');
    ghost.className = 'cal-block cal-resize-ghost' + (evt.item.classList.contains('compact') ? ' compact' : '');
    ghost.setAttribute('style', evt.item.getAttribute('style'));
    ghost.innerHTML = '<span class="bt">' + escapeHtml(ev.ad || '(adsız)') + '</span><span class="bh">' + escapeHtml(ev.saat || '') + (ev.bitisSaat ? '–' + escapeHtml(ev.bitisSaat) : '') + '</span>';
    evt.from.appendChild(ghost);
    calDragMoveGhost = ghost;
  }
  if (evt.item) { evt.item.style.opacity = '0.55'; }
}
function calOnDragMove(evt) {
  const xy = pointerXY(evt.originalEvent); if (xy) { calDragLastXY = xy; }
  return true;
}
function calOnDragEnd(evt) {
  calDragLastXY = null;
  if (calDragMoveGhost) { calDragMoveGhost.remove(); calDragMoveGhost = null; }
  if (evt.item) { evt.item.style.opacity = ''; }
  const id = evt.item && evt.item.dataset.evid;
  const to = evt.to; if (!id || !to) { return; }
  const dateKey = to.dataset.date; if (!dateKey) { return; }
  const isDayCol = to.classList.contains('cal-daycol');
  const isAllDayCol = to.classList.contains('cal-allday-col');
  const xy = pointerXY(evt.originalEvent) || calDragLastXY;
  const timeInfo = { isDayCol, isAllDayCol, xy, rectTop: isDayCol ? to.getBoundingClientRect().top : 0, grabOffsetY: calDragGrabOffsetY };
  calDragGrabOffsetY = 0;
  calMoveEvent(id, dateKey, timeInfo);
}
async function calMoveEvent(id, dateKey, timeInfo) {
  if (!id || !EVENTS[id] || !canWrite) { renderCalendar(); return; }
  const ev = EVENTS[id];
  if (ev.locked) { showToast('Bu etkinlik kilitli, taşınamaz. Önce kilidi açın.', { variant: 'error' }); renderCalendar(); return; }
  const patch = { tarih: dateKey };
  if (timeInfo && timeInfo.isDayCol && timeInfo.xy) {
    const grabOffset = timeInfo.grabOffsetY || 0;
    const mins0 = Math.round(((timeInfo.xy.y - timeInfo.rectTop - grabOffset) / CAL_HOUR_H) * 60 / 30) * 30;
    const mins = Math.max(0, Math.min(23 * 60 + 30, mins0));
    const dur = (hmToMin(ev.saat) !== null && hmToMin(ev.bitisSaat) !== null && hmToMin(ev.bitisSaat) > hmToMin(ev.saat)) ? hmToMin(ev.bitisSaat) - hmToMin(ev.saat) : 60;
    patch.saat = minToHm(mins);
    patch.bitisSaat = minToHm(Math.min(24 * 60 - 1, mins + dur));
  } else if (timeInfo && timeInfo.isAllDayCol) {
    patch.saat = ''; patch.bitisSaat = '';
  }
  if (ev.tarih === patch.tarih && patch.saat === undefined) { renderCalendar(); return; }
  const moved = Object.assign({}, ev, patch);
  const changes = describeChanges(ev, moved);
  const res = await persistEvent(id, patch, evLogName(ev.ad) + ' etkinliği takvimde taşındı (' + fmtTrDate(dateKey) + ')' + (changes.length ? ' · ' + changes.join(' · ') : ''));
  renderCalendar();
  if (res) { showToast('Etkinlik taşındı.', { variant: 'success' }); }
}
async function calResizeEvent(id, patch) {
  if (!id || !EVENTS[id] || !canWrite) { renderCalendar(); return; }
  const ev = EVENTS[id];
  if (ev.locked) { showToast('Bu etkinlik kilitli, süresi değiştirilemez. Önce kilidi açın.', { variant: 'error' }); renderCalendar(); return; }
  const moved = Object.assign({}, ev, patch);
  const changes = describeChanges(ev, moved);
  const res = await persistEvent(id, patch, evLogName(ev.ad) + ' etkinliğinin süresi ayarlandı' + (changes.length ? ' · ' + changes.join(' · ') : ''));
  renderCalendar();
  if (res) { showToast('Etkinlik güncellendi.', { variant: 'success' }); }
}
async function calMoveMultiDayEvent(id, newTarih, newBitisTarihi) {
  if (!id || !EVENTS[id] || !canWrite) { renderCalendar(); return; }
  const ev = EVENTS[id];
  if (ev.locked) { showToast('Bu etkinlik kilitli, taşınamaz. Önce kilidi açın.', { variant: 'error' }); renderCalendar(); return; }
  const patch = { tarih: newTarih, bitisTarihi: newBitisTarihi };
  const res = await persistEvent(id, patch, evLogName(ev.ad) + ' etkinliği takvimde taşındı (' + fmtTrDate(newTarih) + '–' + fmtTrDate(newBitisTarihi) + ')');
  renderCalendar();
  if (res) { showToast('Etkinlik taşındı.', { variant: 'success' }); }
}

// Kilitli bir etkinlik SortableJS'in kendi sürüklemesine hiç girmemeli --
// filter true dönerse sürükleme daha başlamadan kesilir (bkz. ana sitedeki
// calSortableFilter, app.js). preventOnFilter:false olduğu için etkinliği
// açan tıklama/click jesti normal çalışmaya devam eder.
function calSortableFilter(evt, item) {
  if (evt && evt.target && evt.target.closest && evt.target.closest('.cal-resize-handle')) { return true; }
  // Bekleyen bir oluşturma onayı varken başka bir etkinliği sürükleyip taşımaya da
  // izin verilmez (kullanıcı isteği) -- titretilerek bildirilir.
  if (calPendingCreate) { calShakePendingCreate(); return true; }
  // Kilit ikonu sürüklenebilir bloğun İÇİNDE olduğu için SortableJS dokunuşu "sürükleme
  // olabilir" diye yakalayıp delayOnTouchOnly ile 150ms bekletiyordu -- bu ikonu mobilde
  // "tıklanamaz" hissettiriyordu (bkz. ana sitedeki calSortableFilter, app.js). filter
  // true dönerek sürükleme daha başlamadan kesilir, ikonun kendi click'i etkilenmez.
  if (evt && evt.target && evt.target.closest && evt.target.closest('.cal-lock-ico')) { return true; }
  const id = item && item.dataset ? item.dataset.evid : null;
  if (id && EVENTS[id] && EVENTS[id].locked) { return true; }
  return false;
}
function calSortableOptions(groupName) {
  return {
    group: { name: groupName, pull: true, put: true },
    draggable: '.cal-block, .cal-allday-chip',
    animation: 150, ghostClass: 'dragging',
    delay: 150, delayOnTouchOnly: true,
    filter: calSortableFilter,
    preventOnFilter: false,
    onStart: calOnDragStart, onMove: calOnDragMove, onEnd: calOnDragEnd
  };
}

// ── Pointer gestures: grid-select-create / edge-resize / multi-day drag ──

let calGridSelectSuppressClick = false;
// Kullanıcı isteği: sürükleyerek oluşturma jesti bırakılınca modal HEMEN açılmasın —
// ghost + küçük bir "Oluştur/Vazgeç" onay çubuğu gösterilir, modal SADECE "Oluştur"a
// basılınca açılır (yanlış saat aralığı bırakılırsa modale hiç girmeden düzeltme fırsatı).
let calPendingCreate = null;
function calShowPendingCreateBar(ghost, dateKey, startMin, endMin) {
  calCancelPendingCreate();
  ghost.classList.add('cal-create-select-pending');
  // Kullanıcı isteği: bırakınca ghost artık pasif değil -- gerçek etkinliklerdeki AYNI
  // üst/alt sürükleme kollarını taşıyor (böylece "biraz erken/geç bırakmışım" durumunda
  // jesti baştan yapmaya gerek kalmadan saat ince ayar edilebilir), MASAÜSTÜNDE ayrıca
  // ghost'un GÖVDESİNE tıklayınca doğrudan düzenleme ekranı açılır ("Düzenlemek için
  // tıklayın" ipucuyla, bkz. _real-calendar.scss). MOBİLDE bu tıklanabilirlik CSS ile
  // kapatılır (kullanıcı isteği: "telefonda öyle yapmayalım") -- sürükleme kolunu tam
  // yakalayamayan bir parmağın ghost'un ortasına düşmesi orada yanlışlıkla düzenleme
  // ekranı açmasın diye; mobilde tek yol alttaki "✓ Oluştur" butonu.
  ghost.innerHTML =
    '<span class="ccs-time"></span>' +
    '<span class="ccs-hint">Düzenlemek için tıklayın</span>' +
    '<span class="cal-resize-handle cal-resize-handle-top" data-act="resize-handle" aria-hidden="true"></span>' +
    '<span class="cal-resize-handle" data-act="resize-handle" aria-hidden="true"></span>';
  ghost.addEventListener('click', (e) => {
    if (e.target.closest('.cal-resize-handle')) { return; }
    // stopPropagation ŞART: bu click .cal-daycol'a kadar bubble ederse, calConfirmPendingCreate()
    // zaten calPendingCreate'i null yaptığı için delege edilen calGridClick guard'ı devre dışı
    // kalır ve tıklanan noktada İKİNCİ bir (istenmeyen) yeni etkinlik daha açılır.
    e.stopPropagation();
    calConfirmPendingCreate();
  });
  const bar = document.createElement('div');
  bar.className = 'cal-create-confirm-bar';
  bar.innerHTML =
    '<span class="ccb-time">' + escapeHtml(fmtTrDate(dateKey)) + ' · ' + minToHm(startMin) + '–' + minToHm(endMin) + '</span>' +
    '<button type="button" class="ccb-cancel">✕ Vazgeç</button>' +
    '<button type="button" class="ccb-confirm">✓ Oluştur</button>';
  document.body.appendChild(bar);
  bar.querySelector('.ccb-confirm').addEventListener('click', calConfirmPendingCreate);
  bar.querySelector('.ccb-cancel').addEventListener('click', calCancelPendingCreate);
  calPendingCreate = { ghost, bar, dateKey, startMin, endMin };
  calUpdatePendingCreateLabels();
}
// Ghost'un üstündeki/altındaki metni ve onay çubuğundaki saat metnini TEK yerden
// senkron tutar -- hem sürükleyerek-oluşturma hem de ghost'un kendi kolundan
// yapılan ince ayar bunu çağırır.
function calUpdatePendingCreateLabels() {
  if (!calPendingCreate) { return; }
  const p = calPendingCreate;
  p.ghost.style.top = ((p.startMin / 60) * CAL_HOUR_H) + 'px';
  p.ghost.style.height = Math.max(18, ((p.endMin - p.startMin) / 60) * CAL_HOUR_H) + 'px';
  const timeText = minToHm(p.startMin) + '–' + minToHm(p.endMin);
  const timeSpan = p.ghost.querySelector('.ccs-time');
  if (timeSpan) { timeSpan.textContent = timeText; }
  const timeEl = p.bar.querySelector('.ccb-time');
  if (timeEl) { timeEl.textContent = fmtTrDate(p.dateKey) + ' · ' + timeText; }
}
// Onay çubuğu ekranda görünürken başka bir yerde saat ayarlamaya çalışmak (kullanıcı
// isteği: "başka hiçbir yerde oluşturma yapamayalım") sessizce yok sayılmaz --
// bekleyen ghost ve "Oluştur" butonu kısa bir titreşimle ("önce bunu bitir") uyarır.
function calShakePendingCreate() {
  if (!calPendingCreate) { return; }
  const { ghost, bar } = calPendingCreate;
  const confirmBtn = bar.querySelector('.ccb-confirm');
  [ghost, confirmBtn].forEach((el) => {
    if (!el) { return; }
    el.classList.remove('is-shaking'); el.offsetWidth; // eslint-disable-line no-unused-expressions -- reflow tetikler
    el.classList.add('is-shaking');
    el.addEventListener('animationend', () => el.classList.remove('is-shaking'), { once: true });
  });
}
function calConfirmPendingCreate() {
  if (!calPendingCreate) { return; }
  const p = calPendingCreate;
  // Kullanıcı isteği: ghost'u HEMEN silmiyoruz -- modal açıkken arka planda (bulanık takvimin
  // üzerinde) görünür kalmalı, "kaydet"in dışında bir yolla (X/Vazgeç/arka plana tıklama) modal
  // kapatılırsa ghost YERİNDE kalıp kullanıcı saati elle tekrar girmek zorunda kalmamalı. Onay
  // çubuğu modalla çakışmasın diye gizlenir, iptal edilirse geri gösterilir.
  p.bar.style.display = 'none';
  openEventModal(null, p.dateKey, minToHm(p.startMin), minToHm(p.endMin), (committed) => {
    if (!calPendingCreate) { return; } // zaten başka bir yolla temizlenmiş
    if (committed) {
      // persistEvent başarılıysa renderCalendar() zaten TÜM ızgarayı yeniden çiziyor (ghost'un
      // bağlı olduğu eski .cal-daycol DOM'dan kalkıyor) -- burada sadece çubuğu (document.body'nin
      // doğrudan çocuğu, ızgara yeniden çizilirken ETKİLENMEZ) ve JS durumunu temizlemek yeterli.
      calPendingCreate.bar.remove();
      calPendingCreate = null;
    } else {
      calPendingCreate.bar.style.display = '';
    }
  });
}
function calCancelPendingCreate() {
  if (!calPendingCreate) { return; }
  const p = calPendingCreate; calPendingCreate = null;
  p.ghost.remove();
  p.bar.remove();
}
// Ghost'un kendi üst/alt kolundan yapılan ince ayar -- calStartResizeGesture'ın
// (gerçek etkinlikler için) AYNI piksel/snap mantığı, ama Firebase'e hiç yazmaz,
// sadece calPendingCreate.startMin/endMin'i günceller.
function calStartPendingResizeGesture(e) {
  const handle = e.target.closest('.cal-resize-handle');
  if (!handle || !calPendingCreate || !calPendingCreate.ghost.contains(handle)) { return; }
  e.stopPropagation();
  const isTop = handle.classList.contains('cal-resize-handle-top');
  const p = calPendingCreate;
  const daycol = p.ghost.parentElement;
  if (!daycol) { return; }
  const origStartMin = p.startMin, origEndMin = p.endMin;
  const pointerId = e.pointerId;
  handle.setPointerCapture(pointerId);
  document.body.style.cursor = 'ns-resize';
  function onMove(e2) {
    if (e2.pointerId !== pointerId || !calPendingCreate) { return; }
    const rect = daycol.getBoundingClientRect();
    const rawMin = ((e2.clientY - rect.top) / CAL_HOUR_H) * 60;
    let snapped = Math.round(rawMin / 5) * 5;
    if (isTop) { snapped = Math.max(0, Math.min(origEndMin - 5, snapped)); p.startMin = snapped; }
    else { snapped = Math.max(origStartMin + 5, Math.min(24 * 60, snapped)); p.endMin = snapped; }
    calUpdatePendingCreateLabels();
  }
  function onUp(e2) {
    if (e2.pointerId !== pointerId) { return; }
    try { handle.releasePointerCapture(pointerId); } catch (err) { /* noop */ }
    document.body.style.cursor = '';
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
  }
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
}

function calStartGridSelectGesture(e) {
  if (e.target.closest('.cal-resize-handle')) { return; }
  if (e.target.closest('.cal-block')) { return; }
  const daycol = e.target.closest('.cal-daycol');
  if (!daycol) { return; }
  if (!canWrite) { return; }
  // Kullanıcı isteği: onay çubuğu ("✓ Oluştur / ✕ Vazgeç") ekrandayken başka bir yerde
  // YENİ bir oluşturma jesti başlatılamaz -- bekleyen etkinlik önce onaylanmalı/vazgeçilmeli.
  // Sessizce yok saymak yerine titretilerek "önce bunu bitir" bildirilir (mobilde de işe yarar).
  // Ghost'un KENDİSİNE basmak bu kuralın DIŞINDA (masaüstünde tıkla-düzenle akışı) --
  // titretmek yerine o click'in kendi işleyicisine (calShowPendingCreateBar'da bağlı) bırakılır.
  if (calPendingCreate) {
    if (calPendingCreate.ghost.contains(e.target)) { return; }
    calShakePendingCreate();
    return;
  }
  const dateKey = daycol.dataset.date;
  if (!dateKey) { return; }
  const pointerId = e.pointerId;
  // Fare/kalemde davranış AYNEN korunur: anında başlar (masaüstünde tıkla-sürükle-oluştur
  // zaten beklenen davranış, kaydırmayla çakışma riski yok).
  if (e.pointerType !== 'touch') {
    beginGridSelect(e.clientX, e.clientY);
    return;
  }
  // Dokunmatikte ESKİDEN touch-action:none ANINDA (pointerdown'da) uygulanıyordu (bkz. eski
  // yorum: bir önceki gecikmeli sürüm, tarayıcının dokunuşu HEMEN kaydırmaya kilitleyip
  // basılı-tutup-sürüklemeyi tamamen kırıyordu). Ama bu da TERS bir sorun yarattı (kullanıcı
  // bildirimi): takvimi aşağı kaydırmak için her dokunuş yeni bir etkinlik oluşturuyordu --
  // kaydırmak için ya "Vazgeç" demek ya da bekleyen ghost'un üstünden kaydırmak gerekiyordu.
  // Çözüm: touch-action'a HİÇ dokunmadan (varsayılan `auto` ile tarayıcı normal dikey kaydırmayı
  // serbestçe yönetsin) kısa bir BASILI TUTMA eşiği bekleriz. Eşik boyunca parmak
  // CAL_TOUCH_MOVE_TOLERANCE px'ten fazla kayarsa bu bir kaydırmadır -- jest tamamen iptal edilir,
  // tarayıcı zaten kendi kaydırmasını yürütüyordur. Eşik parmak (neredeyse) hareketsizken
  // dolarsa ancak O ZAMAN touch-action:none uygulanıp oluşturma jesti başlar (klasik "basılı
  // tut -> sürükleyerek oluştur" -- Google Takvim mobil ile aynı desen).
  const startX = e.clientX, startY = e.clientY;
  let settled = false;
  function onPreHoldMove(e2) {
    if (e2.pointerId !== pointerId) { return; }
    if (Math.hypot(e2.clientX - startX, e2.clientY - startY) > CAL_TOUCH_MOVE_TOLERANCE) {
      cancelPreHold();
    }
  }
  function onPreHoldUp(e2) {
    if (e2.pointerId !== pointerId) { return; }
    cancelPreHold();
  }
  function cancelPreHold() {
    if (settled) { return; }
    settled = true;
    clearTimeout(holdTimer);
    window.removeEventListener('pointermove', onPreHoldMove);
    window.removeEventListener('pointerup', onPreHoldUp);
    window.removeEventListener('pointercancel', onPreHoldUp);
  }
  const holdTimer = setTimeout(() => {
    if (settled) { return; }
    settled = true;
    window.removeEventListener('pointermove', onPreHoldMove);
    window.removeEventListener('pointerup', onPreHoldUp);
    window.removeEventListener('pointercancel', onPreHoldUp);
    beginGridSelect(startX, startY);
  }, CAL_TOUCH_HOLD_MS);
  window.addEventListener('pointermove', onPreHoldMove);
  window.addEventListener('pointerup', onPreHoldUp);
  window.addEventListener('pointercancel', onPreHoldUp);

  function beginGridSelect(clientX, clientY) {
  daycol.setPointerCapture(pointerId);
  const prevTouchAction = daycol.style.touchAction;
  daycol.style.touchAction = 'none';
  const rect = daycol.getBoundingClientRect();
  function minsFromY(y) { let m = Math.round(((y - rect.top) / CAL_HOUR_H) * 60 / 15) * 15; return Math.max(0, Math.min(24 * 60, m)); }
  const anchorMin = minsFromY(clientY);
  let startMin = anchorMin, endMin = anchorMin;
  let moved = false;

  const ghost = document.createElement('div');
  ghost.className = 'cal-create-select';
  daycol.appendChild(ghost);
  function applyLive() {
    ghost.style.top = ((startMin / 60) * CAL_HOUR_H) + 'px';
    ghost.style.height = Math.max(18, ((endMin - startMin) / 60) * CAL_HOUR_H) + 'px';
    ghost.textContent = minToHm(startMin) + '–' + minToHm(endMin);
  }
  applyLive();

  function cleanup() {
    try { daycol.releasePointerCapture(pointerId); } catch (err) { /* noop */ }
    daycol.style.touchAction = prevTouchAction;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
  }
  function onMove(e2) {
    if (e2.pointerId !== pointerId) { return; }
    if (Math.abs(e2.clientY - e.clientY) > 3) { moved = true; }
    const curMin = minsFromY(e2.clientY);
    if (curMin < anchorMin) { startMin = curMin; endMin = Math.max(anchorMin, curMin + 15); }
    else { startMin = anchorMin; endMin = Math.max(anchorMin + 15, curMin); }
    applyLive();
  }
  function onUp(e2) {
    if (e2.pointerId !== pointerId) { return; }
    cleanup();
    if (!moved) { ghost.remove(); return; }
    // Kullanıcı isteği: mobilde (dokunmatikte) parmak neredeyse hiç kaymadan (doğal titreme
    // 3px eşiğini az aşınca) jest "sürüklendi" sayılıp 15dk'lık asgari bloğu bırakıyordu --
    // bu kadar ince bir bloğu parmakla üstünden/altından tutup ayarlamak neredeyse imkansız.
    // Dokunmatikte GERÇEKTEN kasıtlı bir sürükleme olmadıysa (süre hâlâ 15dk asgaride) süre
    // 1 saate yükseltilir; kullanıcı bilerek daha uzun/kısa bir aralık sürüklediyse dokunulmaz.
    if (e2.pointerType === 'touch' && (endMin - startMin) <= 15) {
      endMin = Math.min(24 * 60, startMin + 60);
      applyLive(); // ghost'un görsel boyutu yeni (1 saatlik) süreye göre güncellenir
    }
    calGridSelectSuppressClick = true;
    calShowPendingCreateBar(ghost, dateKey, startMin, endMin);
  }
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  }
}

function calStartResizeGesture(e) {
  const handle = e.target.closest('.cal-resize-handle');
  if (!handle) { return; }
  // Ghost'un KENDİ kolu ise calStartPendingResizeGesture zaten hallediyor -- buraya hiç girme.
  // DOM YAPISINA göre kontrol edilir (calPendingCreate değişkeninin o anki durumuna değil) --
  // mobilde bu ikisi bir tık senkron kaymışsa (kullanıcı bildirimi: kollarla sürüklerken
  // altta koyu bir GERÇEK-etkinlik-tarzı ikinci silüet kalıyordu) bu kontrol yine doğru sonuç verir.
  if (handle.closest('.cal-create-select-pending')) { return; }
  if (calPendingCreate && calPendingCreate.ghost.contains(handle)) { return; }
  // Başka (gerçek) bir etkinliğin saatini ayarlamaya çalışmak: bekleyen onay çubuğu
  // varken izin verilmez (kullanıcı isteği), titretilerek bildirilir.
  if (calPendingCreate) { calShakePendingCreate(); return; }
  e.stopPropagation();
  const isTop = handle.classList.contains('cal-resize-handle-top');
  const block = handle.closest('.cal-block[data-evid]');
  const id = block && block.dataset ? block.dataset.evid : null;
  const ev = id ? EVENTS[id] : null;
  if (!ev || !canWrite || ev.locked) { return; }
  const daycol = block.closest('.cal-daycol');
  const origStartMin = hmToMin(ev.saat);
  if (!daycol || origStartMin === null) { return; }
  let origEndMin = hmToMin(ev.bitisSaat);
  if (origEndMin === null || origEndMin <= origStartMin) { origEndMin = Math.min(24 * 60, origStartMin + 60); }
  const pointerId = e.pointerId;
  handle.setPointerCapture(pointerId);
  document.body.style.cursor = 'ns-resize';
  let moved = false;
  let startMin = origStartMin, endMin = origEndMin;

  const ghost = document.createElement('div');
  ghost.className = 'cal-block cal-resize-ghost' + (block.classList.contains('compact') ? ' compact' : '');
  ghost.setAttribute('style', block.getAttribute('style'));
  ghost.innerHTML = '<span class="bt">' + escapeHtml(ev.ad || '(adsız)') + '</span><span class="bh">' + escapeHtml(ev.saat || '') + '–' + escapeHtml(minToHm(Math.min(24 * 60 - 1, origEndMin))) + '</span>';
  daycol.appendChild(ghost);
  block.style.opacity = '0.55';

  function applyLive() {
    block.style.top = ((startMin / 60) * CAL_HOUR_H) + 'px';
    block.style.height = Math.max(18, ((endMin - startMin) / 60) * CAL_HOUR_H - 2) + 'px';
    const bh = block.querySelector('.bh');
    if (bh) { bh.textContent = minToHm(startMin) + '–' + minToHm(Math.min(24 * 60 - 1, endMin)); }
  }
  function onMove(e2) {
    if (e2.pointerId !== pointerId) { return; }
    if (Math.abs(e2.clientY - e.clientY) > 3) { moved = true; }
    const rect = daycol.getBoundingClientRect();
    const rawMin = ((e2.clientY - rect.top) / CAL_HOUR_H) * 60;
    let snapped = Math.round(rawMin / 5) * 5;
    if (isTop) { snapped = Math.max(0, Math.min(origEndMin - 5, snapped)); startMin = snapped; }
    else { snapped = Math.max(origStartMin + 5, Math.min(24 * 60, snapped)); endMin = snapped; }
    applyLive();
  }
  function onUp(e2) {
    if (e2.pointerId !== pointerId) { return; }
    try { handle.releasePointerCapture(pointerId); } catch (err) { /* noop */ }
    document.body.style.cursor = '';
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    ghost.remove();
    block.style.opacity = '';
    if (!moved) { return; }
    const patch = isTop ? { saat: minToHm(startMin) } : { bitisSaat: minToHm(Math.min(24 * 60 - 1, endMin)) };
    calResizeEvent(id, patch);
  }
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
}

function calStartMultiDayGesture(e) {
  const bar = e.target.closest('.cal-multiday-bar');
  if (!bar) { return; }
  // Kilit simgesine dokunmak bu jesti başlatmamalı: aksi halde setPointerCapture ile
  // dokunuş bara kilitlenip kilit ikonunun kendi tıklaması kaybolabiliyordu.
  if (e.target.closest('.cal-lock-ico')) { return; }
  // Bekleyen bir oluşturma onayı varken başka bir etkinliğin süresini değiştirmeye
  // izin verilmez (kullanıcı isteği) -- titretilerek bildirilir.
  if (calPendingCreate) { calShakePendingCreate(); return; }
  e.stopPropagation();
  const isHandleL = !!e.target.closest('.cal-multiday-handle-l');
  const isHandleR = !!e.target.closest('.cal-multiday-handle-r');
  const id = bar.dataset.evid;
  const ev = id ? EVENTS[id] : null;
  if (!ev || !ev.bitisTarihi || !canWrite) { return; }
  // Kilitliyken ESKİDEN sessizce dönüyordu -- kullanıcı çubuğu sürüklemeye çalışıp
  // hiçbir tepki alamıyor, nedenini anlamıyordu (ana site burada uyarı gösteriyor).
  if (ev.locked) { showToast('Bu etkinlik kilitli, taşınamaz/süresi değiştirilemez. Önce kilidi açın.', { variant: 'error' }); return; }
  const container = bar.closest('.cal-allday-multiday');
  if (!container) { return; }
  const days = calVisibleWeekDays();
  const rect = container.getBoundingClientRect();
  const dayW = (rect.width - CAL_GUTTER) / days.length;
  if (!(dayW > 0)) { return; }
  const pointerId = e.pointerId;
  bar.setPointerCapture(pointerId);
  let moved = false;
  const origStart = parseKey(ev.tarih), origEnd = parseKey(ev.bitisTarihi);
  const origStartIdx = Math.round((origStart - days[0]) / 86400000);
  const origEndIdx = Math.round((origEnd - days[0]) / 86400000);
  let curStartIdx = origStartIdx, curEndIdx = origEndIdx;
  function applyLive() {
    const s = Math.max(0, Math.min(days.length - 1, curStartIdx));
    const en = Math.max(0, Math.min(days.length - 1, curEndIdx));
    bar.style.gridColumn = (s + 2) + ' / ' + (en + 3);
  }
  function onMove(e2) {
    if (e2.pointerId !== pointerId) { return; }
    const dx = e2.clientX - e.clientX;
    if (Math.abs(dx) > 4) { moved = true; }
    const dayDelta = Math.round(dx / dayW);
    if (isHandleL) { curStartIdx = Math.min(origStartIdx + dayDelta, origEndIdx - 1); curEndIdx = origEndIdx; }
    else if (isHandleR) { curStartIdx = origStartIdx; curEndIdx = Math.max(origEndIdx + dayDelta, origStartIdx + 1); }
    else { curStartIdx = origStartIdx + dayDelta; curEndIdx = origEndIdx + dayDelta; }
    applyLive();
  }
  function onUp(e2) {
    if (e2.pointerId !== pointerId) { return; }
    try { bar.releasePointerCapture(pointerId); } catch (err) { /* noop */ }
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    bar.style.gridColumn = '';
    if (!moved) { return; }
    if (isHandleL) { calResizeEvent(id, { tarih: dKey(addDays(origStart, curStartIdx - origStartIdx)) }); }
    else if (isHandleR) { calResizeEvent(id, { bitisTarihi: dKey(addDays(origEnd, curEndIdx - origEndIdx)) }); }
    else { const dayDelta = curStartIdx - origStartIdx; calMoveMultiDayEvent(id, dKey(addDays(origStart, dayDelta)), dKey(addDays(origEnd, dayDelta))); }
  }
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
}

// ── Edit modal (tam parite: ana sitedeki (app.js) openEventModal'ın TÜM alanları) ──

// "Basın Görevlisi" havuzu: admin tarafından işaretlenmiş kullanıcılar (basinGorevlileri
// düğümü, bkz. roster.js). Ana sitedeki loadPressOfficerPool ile birebir aynı — her
// openEventModal() çağrısında yeniden okunur (oturum içi kısa ömürlü önbellek, kalıcı
// dinleyici YOK).
function loadPressOfficerPool() {
  if (!database) { return Promise.resolve(); }
  return loadPressOfficerPoolShared(database).then((pool) => { pressOfficerPool = pool; });
}
// "Katılımcılar" havuzu: ana sitedeki peopleList() ile AYNI kaynak (universiteProtokolVerileri).
// Admin panelinde bu düğüme kalıcı bir dinleyici henüz bağlı olmadığı için (bkz. görev notu),
// basınGörevlisi havuzuyla aynı desende her modal açılışında tek seferlik okunur.
function loadPeoplePool() {
  if (!database) { return Promise.resolve(); }
  return database.ref('universiteProtokolVerileri').once('value').then((snap) => {
    const obj = snap.val() || {};
    peoplePoolCache = Object.keys(obj).map((id) => {
      const p = obj[id];
      return (p && typeof p === 'object') ? Object.assign({ _id: id }, p) : null;
    }).filter(Boolean);
  }).catch(() => { peoplePoolCache = peoplePoolCache || []; });
}

// Basın görevlisi / haberi yazan(lar) — kullanıcı isteği: AYNI pressOfficerPool
// havuzundan tek bir kişi listesi, her kişi için İKİ bağımsız işaretleme (Basın
// Görevlisi / Haberi Yazdı) — eskiden iki ayrı arama kutulu liste olan bu ikisi
// tek listeye indirgendi.
function renderPersonRolesPicker(bodyEl, calPressStaff, calNewsWriters) {
  const box = bodyEl.querySelector('#cef-personBox'); if (!box) { return; }
  const searchEl = bodyEl.querySelector('#cef-personSearch');
  box.innerHTML = renderPersonRolesPickerHtml(pressOfficerPool, (searchEl && searchEl.value) || '', calPressStaff, calNewsWriters);
}
// Katılımcılar: peoplePoolCache (üniversite) + isteğe bağlı ilPoolCache (İl Protokolü) —
// ana sitedeki renderEventAttendeePicker ile birebir aynı birleştirme/öncelik mantığı.
function renderAttendeePicker(bodyEl, calAttendees) {
  const box = bodyEl.querySelector('#cef-attendeeBox'); if (!box) { return; }
  const searchEl = bodyEl.querySelector('#cef-attSearch');
  const q = ((searchEl && searchEl.value) || '').trim().toLocaleLowerCase('tr');
  const includeIlEl = bodyEl.querySelector('#cef-attIncludeIl');
  const includeIl = !!(includeIlEl && includeIlEl.checked && ilPoolCache);
  let pool;
  if (includeIl) {
    const merged = new Map();
    function addAll(list, kaynak) {
      (list || []).forEach((p) => {
        if ((p.status && p.status !== 'aktif') || !p.name) { return; }
        const key = (p.name || '').trim().toLocaleLowerCase('tr') + '|' + (p.unit || '').trim().toLocaleLowerCase('tr');
        merged.set(key, Object.assign({}, p, { kaynak }));
      });
    }
    addAll(peoplePoolCache, 'universite'); addAll(ilPoolCache, 'il');
    pool = Array.from(merged.values());
  } else {
    pool = (peoplePoolCache || []).filter((p) => (!p.status || p.status === 'aktif') && p.name);
  }
  const filtered = pool.filter((p) => ((p.name || '') + ' ' + (p.title || '') + ' ' + (p.unit || '')).toLocaleLowerCase('tr').includes(q)).slice(0, 120);
  const selKeys = new Set(calAttendees.map((a) => (a.name || '') + '|' + (a.title || '')));
  let html = '';
  calAttendees.forEach((a) => {
    const k = (a.name || '') + '|' + (a.title || '');
    if (filtered.some((p) => (p.name || '') + '|' + (p.title || '') === k)) { return; }
    html += '<label class="cal-ev-att-item"><input type="checkbox" class="cal-ev-att-cb" data-key="' + escapeHtml(k) + '" checked><span><b>' + escapeHtml(a.name) + '</b> <span class="sub">' + escapeHtml(a.title || '') + '</span></span></label>';
  });
  html += filtered.map((p) => {
    const k = (p.name || '') + '|' + (p.title || '');
    return '<label class="cal-ev-att-item"><input type="checkbox" class="cal-ev-att-cb" data-key="' + escapeHtml(k) + '" data-prefix="' + escapeHtml(p.prefix || '') + '" data-name="' + escapeHtml(p.name || '') + '" data-title="' + escapeHtml(p.title || '') + '" data-rank="' + escapeHtml(p.rank !== undefined && p.rank !== null ? String(p.rank) : '') + '" data-kaynak="' + escapeHtml(p.kaynak || 'universite') + '" ' + (selKeys.has(k) ? 'checked' : '') + '><span><b>' + escapeHtml(p.name) + '</b> <span class="sub">' + escapeHtml(p.title || '') + '</span></span></label>';
  }).join('');
  if (!html) { html = '<p class="cal-ev-att-empty">Eşleşen kişi yok.</p>'; }
  box.innerHTML = html;
}

// onModalClose(committed): opsiyonel, modal HANGİ sebeple kapanırsa kapansın (X/backdrop/Vazgeç/
// Kaydet fark etmez) bir kez çağrılır. committed=true sadece Kaydet/Oluştur eylemi tıklanıp
// yazma başlatıldıysa (calConfirmPendingCreate bekleyen ghost'u temizlemek için kullanır).
function openEventModal(id, presetDate, presetTime, presetEndTime, onModalClose) {
  const ev = id ? EVENTS[id] : null;
  const tarih = ev ? (ev.tarih || '') : (presetDate || dKey(calAnchor));
  const saat = ev ? (ev.saat || '') : (presetTime || '');
  const bitisSaat = ev ? (ev.bitisSaat || '') : (presetEndTime || '');
  // Faz 11 (ana siteyle aynı v1 kapsam kararı): çok günlü etkinlikler HER ZAMAN "tüm gün" kabul
  // edilir, bitisTarihi tarih'ten FARKLIYSA anahtar başlangıçta işaretli gelir.
  const isMultiDay = !!(ev && ev.bitisTarihi && ev.bitisTarihi !== ev.tarih);
  const bitisTarihi = (ev && ev.bitisTarihi) ? ev.bitisTarihi : tarih;
  const selectedBadges = new Set(ev && Array.isArray(ev.rozetler) ? ev.rozetler : []);

  const bodyHtml =
    '<form class="cal-ev-form" id="calEvForm">' +
      '<div class="cal-ev-form-row"><label for="cef-ad">Etkinlik Adı</label><input type="text" id="cef-ad" class="form-control" value="' + escapeHtml(ev ? ev.ad : '') + '" required></div>' +
      '<div class="cal-ev-form-grid">' +
        '<div class="cal-ev-form-row"><label for="cef-tur">Tür</label><select id="cef-tur" class="form-control">' + EVENT_TYPES.map((t) => '<option value="' + t.key + '"' + (ev && ev.tur === t.key ? ' selected' : '') + '>' + escapeHtml(t.ad) + '</option>').join('') + '</select></div>' +
        '<div class="cal-ev-form-row"><label for="cef-durum">Durum</label><select id="cef-durum" class="form-control">' + EVENT_STATUS.map((s) => '<option value="' + s.key + '"' + (ev && ev.durum === s.key ? ' selected' : '') + '>' + escapeHtml(s.ad) + '</option>').join('') + '</select></div>' +
      '</div>' +
      '<div class="cal-ev-form-row"><label>Rozetler <span style="font-weight:400;color:var(--text-muted);font-size:12px;">(opsiyonel, birden fazla seçilebilir)</span></label>' +
        '<div class="cal-ev-badge-box" id="cef-badgeBox">' + EVENT_BADGES.map((b) => '<label><input type="checkbox" class="cal-ev-badge-cb" value="' + b.key + '" ' + (selectedBadges.has(b.key) ? 'checked' : '') + '> ' + escapeHtml(b.ad) + '</label>').join('') + '</div></div>' +
      '<label class="cal-ev-form-check"><input type="checkbox" id="cef-cokgunlu"' + (isMultiDay ? ' checked' : '') + '> Çok günlü etkinlik (birden fazla gün sürer)</label>' +
      '<div class="cal-ev-datetime-row">' +
        '<div class="cal-ev-form-row cal-ev-date"><label for="cef-tarih">Tarih</label><input type="date" id="cef-tarih" class="form-control" value="' + escapeHtml(tarih) + '" required></div>' +
        '<div class="cal-ev-form-row cal-ev-time-field" style="display:' + (isMultiDay ? 'none' : '') + ';"><label for="cef-saat">Başlangıç Saati</label><div class="cal-ev-time-wrap"><input type="time" id="cef-saat" class="form-control" value="' + escapeHtml(saat) + '"><button type="button" class="cal-ev-now-btn" data-now-target="cef-saat" title="Şu anki saati yaz">⏱</button></div></div>' +
        '<div class="cal-ev-form-row cal-ev-time-field" style="display:' + (isMultiDay ? 'none' : '') + ';"><label for="cef-bitis">Bitiş Saati</label><div class="cal-ev-time-wrap"><input type="time" id="cef-bitis" class="form-control" value="' + escapeHtml(bitisSaat) + '"><button type="button" class="cal-ev-now-btn" data-now-target="cef-bitis" title="Şu anki saati yaz">⏱</button></div></div>' +
        '<div class="cal-ev-form-row cal-ev-date" id="cef-bitisTarihiWrap" style="display:' + (isMultiDay ? '' : 'none') + ';"><label for="cef-bitisTarihi">Bitiş Tarihi</label><input type="date" id="cef-bitisTarihi" class="form-control" value="' + escapeHtml(bitisTarihi) + '"></div>' +
      '</div>' +
      '<div class="cal-ev-form-row"><label for="cef-yer">Yer / Mekân</label><input type="text" id="cef-yer" class="form-control" value="' + escapeHtml(ev ? ev.yer : '') + '" placeholder="Örn: Atatürk Kongre ve Kültür Merkezi"></div>' +
      '<div class="cal-ev-form-row"><label for="cef-birim">Düzenleyen Birim</label><select id="cef-birim" class="form-control"><option value="">—</option>' + facultyOptionsHtml(ev ? ev.birim : '') + '</select></div>' +
      '<div class="cal-ev-form-row"><label for="cef-planlayan">Planlayan / Sorumlu</label><input type="text" id="cef-planlayan" class="form-control" value="' + escapeHtml(ev ? ev.planlayan : '') + '" placeholder="Etkinliği planlayan kişi/birim"></div>' +
      '<div class="cal-ev-form-row"><label for="cef-personSearch">Basın Görevlisi / Haberi Yazan <span style="font-weight:400;color:var(--text-muted);font-size:12px;">(admin tarafından işaretlenmiş kişiler arasından — her kişi için ayrı ayrı işaretlenebilir)</span></label>' +
        '<input type="text" class="cal-ev-att-search" id="cef-personSearch" placeholder="İsim ara…"><div class="cal-ev-att-box cal-ev-role-box" id="cef-personBox"></div></div>' +
      '<div class="cal-ev-form-row"><label for="cef-attSearch">Katılımcılar <span style="font-weight:400;color:var(--text-muted);font-size:12px;">(protokol kartlarından seçilir, haber metni bunlardan üretilir)</span></label>' +
        '<label class="cal-ev-il-toggle"><input type="checkbox" id="cef-attIncludeIl"> İl Protokolünü de dahil et</label>' +
        '<input type="text" class="cal-ev-att-search" id="cef-attSearch" placeholder="İsim veya unvan ara…"><div class="cal-ev-att-box" id="cef-attendeeBox"></div></div>' +
      '<div class="cal-ev-form-row"><label for="cef-haberKaynagi">Haber Kaynağı <span style="font-weight:400;color:var(--text-muted);font-size:12px;">(opsiyonel, haberi kim geçtiyse)</span></label><select id="cef-haberKaynagi" class="form-control"><option value="">(Belirtilmedi)</option>' + ['İHA', 'AA', 'DHA', 'ANKA'].map((k) => '<option value="' + k + '"' + (ev && ev.haberKaynagi === k ? ' selected' : '') + '>' + k + '</option>').join('') + '</select></div>' +
      '<div class="cal-ev-form-row"><label for="cef-not">Not</label><textarea id="cef-not" class="form-control" rows="2">' + escapeHtml(ev ? ev.not : '') + '</textarea></div>' +
    '</form>';

  const actions = [];
  // "Sil" ESKİDEN sadece `id` varlığına bağlıydı, canWrite'a değil -- girişsiz ziyaretçi de
  // kırmızı Sil butonunu görüp onay penceresine kadar gidiyor, ancak en sonda "yetkiniz yok"
  // toast'ı alıyordu. (applyReadonly yalnızca form alanlarını disable ediyor, footer
  // butonlarına dokunmuyor.)
  if (id && canWrite) {
    actions.push({ label: 'Sil', variant: 'danger', closeOnAction: false, action: ({ close }) => {
      if (!window.confirm('Bu etkinliği silmek istediğinize emin misiniz?')) { return false; }
      deleteEvent(id); close(); return false;
    } });
  }
  actions.push({ label: 'Vazgeç', variant: 'outline' });

  // calAttendees/calPressStaff/calNewsWriters -- ana sitedeki gibi GLOBAL değil, sadece bu
  // modal açıkken yaşayan yerel değişkenler (bkz. dosya başındaki state açıklaması).
  const calAttendees = (ev && Array.isArray(ev.katilimcilar)) ? ev.katilimcilar.map((a) => ({ prefix: a.prefix || '', name: a.name || '', title: a.title || '', rank: a.rank !== undefined ? a.rank : '', kaynak: a.kaynak || 'universite' })) : [];
  const calPressStaff = ev ? parseGorevliString(ev.gorevli) : [];
  const calNewsWriters = ev ? parseGorevliString(ev.haberYazanlari) : [];

  let saveCommitted = false;
  if (canWrite) {
    actions.push({ label: id ? 'Kaydet' : 'Oluştur', variant: 'primary', action: ({ body }) => {
      const form = body.querySelector('#calEvForm');
      const ad = form.querySelector('#cef-ad').value.trim();
      if (!ad) { showToast('Etkinlik adı zorunlu.', { variant: 'warning' }); return false; }
      const tarihVal = form.querySelector('#cef-tarih').value;
      if (!parseKey(tarihVal)) { showToast('Geçerli bir tarih seçin!', { variant: 'warning' }); return false; }
      const cokGunlu = form.querySelector('#cef-cokgunlu').checked;
      let bitisTarihiVal = '';
      if (cokGunlu) {
        bitisTarihiVal = form.querySelector('#cef-bitisTarihi').value;
        if (!parseKey(bitisTarihiVal)) { showToast('Geçerli bir bitiş tarihi seçin!', { variant: 'warning' }); return false; }
        if (bitisTarihiVal < tarihVal) { showToast('Bitiş tarihi, başlangıç tarihinden önce olamaz.', { variant: 'warning' }); return false; }
      }
      const saatVal = cokGunlu ? '' : form.querySelector('#cef-saat').value;
      const bitisVal = cokGunlu ? '' : form.querySelector('#cef-bitis').value;
      if (saatVal && bitisVal && hmToMin(bitisVal) !== null && hmToMin(saatVal) !== null && hmToMin(bitisVal) <= hmToMin(saatVal)) {
        const geceYarisiOnay = window.confirm('Bitiş saati (' + bitisVal + '), başlangıçtan (' + saatVal + ') önce görünüyor.\n\nBu etkinlik gece yarısını geçiyor mu (bitiş ertesi gün)?\n\n"Tamam" derseniz bu şekilde kaydedilir, "İptal" ile saatleri düzeltebilirsiniz.');
        if (!geceYarisiOnay) { showToast('Bitiş saati başlangıçtan sonra olmalı.', { variant: 'warning' }); return false; }
      }
      const patch = {
        ad,
        tur: form.querySelector('#cef-tur').value,
        durum: form.querySelector('#cef-durum').value,
        rozetler: Array.from(form.querySelectorAll('.cal-ev-badge-cb:checked')).map((cb) => cb.value),
        tarih: tarihVal,
        saat: saatVal || '',
        bitisSaat: bitisVal || '',
        // Sadece GERÇEKTEN çok günlüyse (tarih!==bitisTarihi) set edilir; aksi halde null
        // gönderilir ki persistEvent'in merge'i eski (varsa) bitisTarihi'ni SİLSİN (bkz.
        // persistEvent: nesnenin bir leaf'i null ise Firebase o alanı hiç yazmaz/kaldırır).
        bitisTarihi: (cokGunlu && bitisTarihiVal && bitisTarihiVal !== tarihVal) ? bitisTarihiVal : null,
        yer: form.querySelector('#cef-yer').value.trim(),
        birim: form.querySelector('#cef-birim').value,
        planlayan: form.querySelector('#cef-planlayan').value.trim(),
        gorevli: calPressStaff.slice().sort((a, b) => a.localeCompare(b, 'tr')).join(', '),
        haberYazanlari: calNewsWriters.slice().sort((a, b) => a.localeCompare(b, 'tr')).join(', '),
        katilimcilar: calAttendees.slice(),
        haberKaynagi: form.querySelector('#cef-haberKaynagi').value,
        not: form.querySelector('#cef-not').value.trim(),
        // quick-event.js'in oluşturduğu taslaklar "taslak:true" taşır (bkz.
        // .cal-taslak görsel vurgusu). Form üzerinden kaydedilince -- ad
        // hariç TÜM alanlar boş bile kalsa -- kullanıcı bilinçli kaydetmiş
        // demektir, bitisTarihi'ndeki null-siler deseniyle aynı şekilde
        // taslak alanı temizlenir.
        taslak: null,
        // Kullanıcı isteği: takvimdeki etkinlikler için de tamamlayan kişi belli olsun
        // (kanban panosundaki "Tamamlandı" kartında avatar olarak gösterilir, bkz. kanban.js).
        // Durum tamamlandı DEĞİLSE alanlar temizlenir -- yoksa eski bir tamamlama izi,
        // etkinlik yeniden planlandı/yazılıyor durumuna dönünce yanlışlıkla kalmış olurdu.
        tamamlayan: form.querySelector('#cef-durum').value === 'tamamlandi' ? (currentUserName || currentUserEmail) : null,
        tamamlayanEmail: form.querySelector('#cef-durum').value === 'tamamlandi' ? currentUserEmail : null
      };
      const ref = EVENTS[id];
      const logLabel = id
        ? evLogName(ad) + ' etkinliği düzenlendi' + (ref ? (() => { const c = describeChanges(ref, Object.assign({}, ref, patch)); return c.length ? ' · ' + c.join(' · ') : ''; })() : '')
        : evLogName(ad) + ' etkinliği oluşturuldu';
      saveCommitted = true;
      persistEvent(id, patch, logLabel).then((res) => {
        if (res) { showToast(id ? 'Etkinlik kaydedildi.' : 'Etkinlik oluşturuldu.', { variant: 'success' }); renderCalendar(); }
      });
      return true;
    } });
  }

  const modalHandle = showModal({
    title: id ? 'Etkinliği Düzenle' : 'Yeni Etkinlik', body: bodyHtml, actions, size: 'md',
    onClose: onModalClose ? () => onModalClose(saveCommitted) : undefined
  });
  const bodyEl = modalHandle.body;
  const modalToken = ++openEventModalToken;

  // Yetkisi olmayan (girişsiz ziyaretçi veya rolü "pending" kullanıcı) için form
  // ESKİDEN tamamen düzenlenebilir görünüyordu ama "Kaydet" butonu hiç çıkmıyordu --
  // kullanıcı doldurup kaydedemediğini ancak en sonda anlıyordu. Alanlar artık
  // salt-okunur (disabled) gelir. Pickerlar sonradan (havuzlar yüklendikçe) YENİDEN
  // çizildiği için bu, her çizimden sonra tekrar uygulanmalı.
  const applyReadonly = () => {
    if (canWrite) { return; }
    // Arama kutuları HARİÇ: yetkisiz kullanıcı da katılımcı/basın görevlisi listesinde
    // arama yapıp kimin seçili olduğunu görebilmeli -- arama veri değiştirmez.
    bodyEl.querySelectorAll('input, select, textarea').forEach((el) => {
      if (el.classList.contains('cal-ev-att-search')) { return; }
      el.disabled = true;
    });
  };

  // Pickerlar önce (boş/eski önbellekle) render edilir, havuzlar tazelendikçe (bu modal hâlâ
  // AÇIKSA -- modalToken kontrolü ana sitedeki gorevliLoadToken yarış-durumu korumasının aynısı)
  // yeniden çizilir.
  renderPersonRolesPicker(bodyEl, calPressStaff, calNewsWriters);
  renderAttendeePicker(bodyEl, calAttendees);
  applyReadonly();
  loadPressOfficerPool().then(() => {
    if (modalToken !== openEventModalToken) { return; }
    renderPersonRolesPicker(bodyEl, calPressStaff, calNewsWriters);
    applyReadonly();
  });
  loadPeoplePool().then(() => {
    if (modalToken !== openEventModalToken) { return; }
    renderAttendeePicker(bodyEl, calAttendees);
    applyReadonly();
  });

  bodyEl.addEventListener('input', (e) => {
    if (e.target.id === 'cef-personSearch') { renderPersonRolesPicker(bodyEl, calPressStaff, calNewsWriters); }
    else if (e.target.id === 'cef-attSearch') { renderAttendeePicker(bodyEl, calAttendees); }
  });

  bodyEl.addEventListener('click', (e) => {
    const nowBtn = e.target.closest('.cal-ev-now-btn');
    if (!nowBtn) { return; }
    const target = bodyEl.querySelector('#' + nowBtn.dataset.nowTarget);
    if (!target) { return; }
    const nw = new Date();
    target.value = pad2(nw.getHours()) + ':' + pad2(nw.getMinutes());
    if (nowBtn.dataset.nowTarget === 'cef-bitis' && !bodyEl.querySelector('#cef-saat').value) {
      showToast('Başlangıç saati de girilmeli.', { variant: 'warning' });
    }
  });

  bodyEl.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'cef-cokgunlu') {
      const on = t.checked;
      bodyEl.querySelectorAll('.cal-ev-datetime-row .cal-ev-time-field').forEach((el) => { el.style.display = on ? 'none' : ''; });
      const wrap = bodyEl.querySelector('#cef-bitisTarihiWrap');
      if (wrap) { wrap.style.display = on ? '' : 'none'; }
      if (on) {
        const bt = bodyEl.querySelector('#cef-bitisTarihi');
        const tv = bodyEl.querySelector('#cef-tarih').value;
        if (bt && (!bt.value || bt.value < tv)) { bt.value = tv; }
      }
      return;
    }
    if (t.id === 'cef-attIncludeIl') {
      if (!t.checked || ilPoolCache !== null) { renderAttendeePicker(bodyEl, calAttendees); return; }
      if (!database) { renderAttendeePicker(bodyEl, calAttendees); return; }
      database.ref('ilProtokolVerileri').once('value').then((snap) => {
        const v = snap.val() || {};
        ilPoolCache = Object.keys(v).map((pid) => {
          const p = v[pid];
          return (p && typeof p === 'object') ? Object.assign({ _id: pid }, p) : null;
        }).filter(Boolean);
        if (modalToken === openEventModalToken) { renderAttendeePicker(bodyEl, calAttendees); }
      }).catch((err) => {
        console.error('İl Protokolü okunamadı:', err);
        showToast('İl Protokolü okunamadı.', { variant: 'error' });
        t.checked = false;
        renderAttendeePicker(bodyEl, calAttendees);
      });
      return;
    }
    if (t.classList.contains('cal-ev-role-basin')) {
      const name = t.dataset.name || '';
      if (t.checked) { if (calPressStaff.indexOf(name) === -1) { calPressStaff.push(name); } }
      else { const idx = calPressStaff.indexOf(name); if (idx !== -1) { calPressStaff.splice(idx, 1); } }
      return;
    }
    if (t.classList.contains('cal-ev-role-haber')) {
      const name = t.dataset.name || '';
      if (t.checked) { if (calNewsWriters.indexOf(name) === -1) { calNewsWriters.push(name); } }
      else { const idx = calNewsWriters.indexOf(name); if (idx !== -1) { calNewsWriters.splice(idx, 1); } }
      return;
    }
    if (t.classList.contains('cal-ev-att-cb')) {
      const key = t.dataset.key;
      if (t.checked) {
        if (!calAttendees.some((a) => (a.name || '') + '|' + (a.title || '') === key)) {
          calAttendees.push({ prefix: t.dataset.prefix || '', name: t.dataset.name || key.split('|')[0], title: t.dataset.title || key.split('|')[1] || '', rank: t.dataset.rank || '', kaynak: t.dataset.kaynak || 'universite' });
        }
      } else {
        const idx = calAttendees.findIndex((a) => (a.name || '') + '|' + (a.title || '') === key);
        if (idx !== -1) { calAttendees.splice(idx, 1); }
      }
    }
  });
}

// ── Wiring ──

function bindCalMainBody() {
  const body = document.getElementById('calMainBody');
  if (!body) { return; }

  body.addEventListener('pointerdown', (e) => {
    calStartPendingResizeGesture(e);
    calStartResizeGesture(e);
    calStartGridSelectGesture(e);
    calStartMultiDayGesture(e);
  });

  body.addEventListener('click', (e) => {
    const lockEl = e.target.closest('[data-lock-evid]');
    if (lockEl) { e.stopPropagation(); toggleEventLock(lockEl.dataset.lockEvid); return; }
    const evidEl = e.target.closest('[data-evid]');
    if (evidEl) {
      const act = evidEl.dataset.act;
      if (act === 'edit') { openEventModal(evidEl.dataset.evid); return; }
    }
    const moreBtn = e.target.closest('[data-act="more"]');
    if (moreBtn) { calGoToDay(moreBtn.dataset.date); return; }
    const addBtn = e.target.closest('[data-act="add"]');
    if (addBtn) { openEventModal(null, addBtn.dataset.date); return; }
    const gotoDay = e.target.closest('[data-act="goto-day"]');
    if (gotoDay) { calGoToDay(gotoDay.dataset.date); return; }
    const gotoMonth = e.target.closest('[data-act="goto-month"]');
    if (gotoMonth) { calGoToMonth(Number(gotoMonth.dataset.year), Number(gotoMonth.dataset.month)); return; }
    const daycol = e.target.closest('.cal-daycol');
    if (daycol) { calGridClick(e, daycol.dataset.date, daycol); }
  });
}

function bindToolbar() {
  document.getElementById('calPrevBtn')?.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); calShift(-1); });
  document.getElementById('calNextBtn')?.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); calShift(1); });
  document.getElementById('calTodayBtn')?.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); calToday(); });
  document.getElementById('calNewEventBtn')?.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); openEventModal(null); });
  document.querySelectorAll('#calViewTabs .cal-viewbtn').forEach((btn) => {
    btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); calSetView(btn.dataset.view); });
  });
}

export function initCalendar() {
  const body = document.getElementById('calMainBody');
  if (!body) { return; }

  if (!window.firebase) { console.error('Firebase SDK yüklenemedi.'); return; }
  if (!firebase.apps.length) { firebase.initializeApp(firebaseConfig); }
  database = firebase.database();
  auth = firebase.auth();

  bindToolbar();
  bindCalMainBody();
  window.addEventListener('resize', calOnWindowResize, { passive: true });
  renderCalendar();

  auth.onAuthStateChanged((user) => {
    if (!user) { canWrite = false; currentUserName = ''; currentUserEmail = ''; renderCalendar(); return; }
    currentUserEmail = user.email || '';
    database.ref('users/' + user.uid).once('value').then((snap) => {
      const u = snap.val() || {};
      const role = u.role;
      canWrite = (role === 'editor' || role === 'admin' || role === 'owner') && u.blocked !== true;
      currentUserName = ((u.firstName || '') + ' ' + (u.lastName || '')).trim();
      renderCalendar();
    }).catch(() => { canWrite = false; renderCalendar(); });
  });

  // Test Modu/Salt-Okunur Kilit'in ilk değerleri okunmadan `etkinlikler`e bağlanılırsa
  // ilk okuma yanlış dalda (canlı/test) yapılır -- initDbMode() ilk değerler gelene kadar
  // bekleyen bir promise döner (bkz. db-mode.js). Mod daha sonra CANLI değişirse (başka bir
  // admin ayarlar.html'den değiştirirse) dinleyici yeniden bağlanır ve şerit güncellenir.
  initDbMode(database).then(() => {
    renderDbModeBanner();
    attachEventsListener();
  });
  onDbModeChange(() => {
    renderDbModeBanner();
    attachEventsListener();
  });
}
