// Admin paneli — ECharts entegrasyonu
// Dynamic-imports ECharts only when a [data-chart] element is present on the
// page, keeping pages without charts free of the ~400kB cost.
import { dbPath, initDbMode, onDbModeChange } from './db-mode.js';

const tokens = () => {
  const cs = getComputedStyle(document.documentElement);
  return {
    primary: cs.getPropertyValue('--primary').trim(),
    primaryDk: cs.getPropertyValue('--primary-dk').trim(),
    azure: cs.getPropertyValue('--azure').trim(),
    blue: cs.getPropertyValue('--blue').trim(),
    yellow: cs.getPropertyValue('--yellow').trim(),
    green: cs.getPropertyValue('--green').trim(),
    red: cs.getPropertyValue('--red').trim(),
    purple: cs.getPropertyValue('--purple').trim(),
    text: cs.getPropertyValue('--text').trim(),
    textMuted: cs.getPropertyValue('--text-muted').trim(),
    borderLight: cs.getPropertyValue('--border-color-light').trim(),
    bgSurface: cs.getPropertyValue('--bg-surface').trim()
  };
};

const fontFamily = "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif";

function baseOption(t) {
  return {
    textStyle: { fontFamily, fontSize: 11, color: t.textMuted },
    grid: { left: 36, right: 12, top: 16, bottom: 28, containLabel: false },
    tooltip: {
      backgroundColor: t.bgSurface,
      borderColor: t.borderLight,
      borderWidth: 1,
      padding: [8, 10],
      textStyle: { color: t.text, fontSize: 12, fontFamily },
      extraCssText: 'box-shadow: 0 2px 8px rgba(30,38,51,0.08); border-radius: 6px;'
    }
  };
}

// ────────────────────────
//  Editör/Admin/Owner etkinlik aktivitesi — Operasyonlar sayfası
// ────────────────────────
// Kullanıcı isteği: eski "Network Activities" (sahte demo verisi) grafiğinin
// yerine, Analitik sayfasındaki "Plan growth" yığılmış alan grafiğinin AYNI
// görsel dilini kullanan, GERÇEK bir grafik -- editor/admin/owner rolündeki
// her kullanıcının, o ay "Basın Görevlisi" olarak işaretlendiği (bkz.
// app.js'teki gorevli alanı -- kullanıcı isteği: "zaten basın görevlisi
// olarak işaretlendiyse etkinliğe gitmiştir") etkinlik sayısını gösterir.
// Aylar Ocak'tan Aralık'a SABİT (kayan 12 ay penceresi DEĞİL), sadece İÇİNDE
// BULUNULAN yılın etkinlikleri sayılır. Kişi sayısı arttıkça renk sayısı da
// otomatik artar (bkz. colorForIndex).
const EDITOR_ACTIVITY_FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDOfhq3aYW6sg2_zj0sFsRzXeGziGtLxCk',
  authDomain: 'omu-protokol.firebaseapp.com',
  databaseURL: 'https://omu-protokol-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'omu-protokol'
};
const TR_MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

// İlk N renk mevcut tasarım tokenlarından (tutarlı görünüm) -- kişi sayısı
// bunu aşarsa altın açı (golden angle) HSL döngüsüyle sonsuz, birbirinden
// hep AYIRT EDİLEBİLİR yeni renkler üretilir.
function colorForIndex(i, basePalette) {
  if (i < basePalette.length) {return basePalette[i];}
  const hue = (i * 137.508) % 360; // altın açı -- ardışık renkler asla birbirine yakın düşmez
  return 'hsl(' + Math.round(hue) + ', 62%, 52%)';
}

// colorForIndex() 7+ kişide 'hsl(...)' string'i döndürüyor -- basePalette'teki
// '#rrggbb' tonlarının aksine, buna doğrudan hex alfa eki (+ '55') eklemek
// GEÇERSİZ bir CSS rengi üretir (ör. 'hsl(243, 62%, 52%)55') ve ECharts'ın
// canvas gradient'i bunu parse edemeyip sayfayı kırar. Her iki biçimi de
// güvenle alfa'lı hale getiren tek noktadan bir yardımcı.
function withAlpha(color, hexAlpha) {
  if (color[0] === '#') {return color + hexAlpha;}
  if (color.indexOf('hsl(') === 0) {
    const alpha = (parseInt(hexAlpha, 16) / 255).toFixed(2);
    return color.replace('hsl(', 'hsla(').replace(/\)$/, ', ' + alpha + ')');
  }
  return color;
}

// Bir etkinlikte "aktif" sayılan kişiler: basın görevlisi (gorevli) VEYA haber
// yazan (haberYazanlari) -- kullanıcı isteği: "haber yazan yada basın görevlisi
// olarak" ikisi de sayılsın. Aynı kişi ikisinde birden geçiyorsa TEK sayılır.
// Grafiklerdeki kişi listesi normalde users/ düğümünden (rolü editor/admin/owner
// olanlar) çıkarılıyor. Ama users/ SADECE admin/owner'a açık; editör bu grafiği
// açtığında PERMISSION_DENIED alıp grafiği hiç göremiyordu. Kullanıcı isteği:
// "Editör Aktivitesi kısmını editörlerin de görmesini istiyorum, burada küçük bir
// yarış yapılıyor ve bunu görmek herkese motivasyon verir."
//
// Çözüm kural gevşetmek DEĞİL (o, editörlere tüm e-postaları açardı): isimler
// zaten etkinliklerin içinde (gorevli / haberYazanlari). users/ okunamadığında
// liste doğrudan etkinliklerden türetiliyor -- grafik aynı, ek veri erişimi yok.
function isimleriEtkinliklerdenCikar(events) {
  const set = new Set();
  Object.keys(events || {}).forEach((id) => {
    namesForEvent(events[id]).forEach((n) => set.add(n));
  });
  return Array.from(set);
}

function namesForEvent(e) {
  if (!e) {return [];}
  const set = new Set();
  String(e.gorevli || '').split(',').map((s) => s.trim()).filter(Boolean).forEach((n) => set.add(n));
  String(e.haberYazanlari || '').split(',').map((s) => s.trim()).filter(Boolean).forEach((n) => set.add(n));
  return Array.from(set);
}

// Yalnızca "gorevli" (basın görevlisi olarak atanan) alanını döner --
// namesForEvent'in aksine haberYazanlari'nı KATMAZ. Kullanıcı isteği:
// tahmini fotoğraf sayacı yalnızca basın görevlisi olarak gidilen
// etkinliklerde artsın; bir kişi yalnızca haber yazarı olarak atandıysa
// (fotoğraf makinesiyle gitmemiş sayılır) o etkinlik sayaca dahil edilmez.
function gorevliNamesForEvent(e) {
  if (!e) {return [];}
  const set = new Set();
  String(e.gorevli || '').split(',').map((s) => s.trim()).filter(Boolean).forEach((n) => set.add(n));
  return Array.from(set);
}

// ────────────────────────
//  Etkinlik bitiş kontrolü — istatistiklere sadece BİTMİŞ etkinlikler girsin
// ────────────────────────
// Kullanıcı bildirimi: gelecekteki bir etkinliğe basın görevlisi/haber yazarı
// eklenince kişi HEMEN "gitmiş" gibi istatistiklere yansıyordu. calendar.js'teki
// dKey/parseKey/hmToMin ile AYNI yerel-saat mantığı (küçük yardımcılar bu
// projede dosyalar arası kasıtlı olarak kopyalanır, bkz. roster.js üstündeki not).
function chartsParseKey(s) {
  const a = String(s || '').split('-');
  if (a.length !== 3) { return null; }
  const y = Number(a[0]), m = Number(a[1]), day = Number(a[2]);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(day)) { return null; }
  const d = new Date(y, m - 1, day);
  if (isNaN(d.getTime()) || d.getFullYear() !== y || d.getMonth() !== m - 1 || d.getDate() !== day) { return null; }
  return d;
}
function chartsHmToMin(s) {
  const a = String(s || '').split(':');
  if (a.length < 2) { return null; }
  const h = Number(a[0]), m = Number(a[1]);
  if (isNaN(h) || isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) { return null; }
  return h * 60 + m;
}
// Bitiş zamanı kuralları:
// - Tek günlük saatli etkinlik: tarih + bitisSaat (yoksa başlangıç+60dk).
// - Hiç saat yoksa günün sonu (23:59:59.999).
// - Çok günlük etkinlik: bitisTarihi gününün sonu (saatler yok sayılır).
// - bitisSaat <= başlangıç saati ise gece yarısını aşan etkinlik kabul edilir
//   (dakika 1440'ı geçebilir -- Date constructor bunu doğru şekilde ertesi
//   güne taşır, elle gün ekleme gerekmez).
export function hasEventEnded(event, now) {
  if (!event) { return false; }
  const start = chartsParseKey(event.tarih);
  if (!start) { return false; }
  const isMultiDay = !!event.bitisTarihi && event.bitisTarihi !== event.tarih;
  if (isMultiDay) {
    const end = chartsParseKey(event.bitisTarihi) || start;
    const endOfDay = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59, 999);
    return now.getTime() >= endOfDay.getTime();
  }
  const startMin = chartsHmToMin(event.saat);
  if (startMin === null) {
    const endOfDay = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 23, 59, 59, 999);
    return now.getTime() >= endOfDay.getTime();
  }
  let endMin = chartsHmToMin(event.bitisSaat);
  if (endMin === null) { endMin = startMin + 60; }
  else if (endMin <= startMin) { endMin += 24 * 60; }
  const endMoment = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 0, endMin, 0, 0);
  return now.getTime() >= endMoment.getTime();
}
// İstatistiklerin TAMAMI (editorEventActivity/editorDailyActivity/editorActivityShare/
// fotoğraf sayacı) bu TEK fonksiyondan geçmeli -- farklı filtreler oluşmasın diye.
// İptal edilmiş etkinlikler zaman kuralından bağımsız olarak hiçbir zaman girmez.
function filterEligibleEventsForStats(events, now) {
  if (!events) { return events; }
  const out = {};
  Object.keys(events).forEach((id) => {
    const e = events[id];
    if (e && e.durum !== 'iptal' && hasEventEnded(e, now)) { out[id] = e; }
  });
  return out;
}

// ────────────────────────
//  Paylaşılan users/etkinlikler önbelleği — Operasyonlar sayfasındaki
//  editorEventActivity, editorDailyActivity, editorActivityShare ve
//  initPhotoCounter'ın HEPSİ aynı iki düğümü (users, etkinlikler) canlı
//  dinliyordu -- 4 ayrı .on('value') = aynı veri için 4 kat gereksiz trafik.
//  Artık tek bir dinleyici çifti burada açılıyor, her tüketici sadece
//  abone oluyor (subscribeSharedActivityData); veri her değiştiğinde TÜM
//  abonelere aynı anda haber verilir. Grafiklerin kendi çizim mantığı
//  (draw/renderEmpty) DEĞİŞMEDİ, sadece veri kaynağı ortaklaştı.
let sharedUsersCache = null;
let sharedEventsCache = null;
let sharedActivityListenersStarted = false;
let sharedEventsRef = null;
let sharedEventsPath = null;
let sharedEventsGeneration = 0;
const sharedActivitySubscribers = new Set();

function dispatchSharedActivityData() {
  sharedActivitySubscribers.forEach((cb) => {
    try { cb(sharedUsersCache, sharedEventsCache); } catch (err) { console.error('Paylaşılan aktivite verisi işlenemedi:', err); }
  });
}

function ensureSharedActivityListeners() {
  if (sharedActivityListenersStarted) {return;}
  if (!window.firebase) {return;}
  sharedActivityListenersStarted = true;
  if (!firebase.apps.length) {firebase.initializeApp(EDITOR_ACTIVITY_FIREBASE_CONFIG);}
  const database = firebase.database();
  // Hesap/rol verisi test dalına kopyalanmaz; yalnızca içerik dalı değişir.
  database.ref('users').on('value', (snap) => {
    sharedUsersCache = snap.val() || {};
    dispatchSharedActivityData();
  }, () => {
    // "users" düğümü sadece admin/owner'a açık -- editör PERMISSION_DENIED alır.
    // Boş listeyle devam edilir, tüketiciler isimleri etkinliklerden türetir.
    sharedUsersCache = {};
    dispatchSharedActivityData();
  });
  let modeReady = false;
  function attachEvents() {
    if (!modeReady) {return;}
    const path = dbPath('etkinlikler');
    if (sharedEventsPath === path) {return;}
    if (sharedEventsRef) {sharedEventsRef.off('value');}
    sharedEventsPath = path;
    const generation = ++sharedEventsGeneration;
    // Yeni dal yüklenirken eski dalın kayıtları hiçbir widget'ta kalmasın.
    sharedEventsCache = {};
    dispatchSharedActivityData();
    sharedEventsRef = database.ref(path);
    sharedEventsRef.on('value', (snap) => {
      if (generation !== sharedEventsGeneration) {return;}
      sharedEventsCache = snap.val() || {};
      dispatchSharedActivityData();
    }, (err) => {
      if (generation !== sharedEventsGeneration) {return;}
      sharedEventsCache = {};
      dispatchSharedActivityData();
      console.error('Paylaşılan etkinlik verisi yüklenemedi:', err);
    });
  }
  onDbModeChange(attachEvents);
  initDbMode(database).then(() => { modeReady = true; attachEvents(); });
  // Etkinliğin zamanı Firebase'de HİÇBİR alan değişmeden dolabilir (ör. saat
  // 14:00'ü geçti) -- istatistikler bunu yakalamak için dakikada bir aynı
  // (değişmemiş) veriyle yeniden dağıtılır; her tüketici hasEventEnded'i
  // TAZE bir `now` ile yeniden değerlendirir. Tek zamanlayıcı, TÜM abonelere.
  const refreshTimer = setInterval(() => {
    if (sharedEventsCache !== null) { dispatchSharedActivityData(); }
  }, 60000);
  // Tarayıcıda setInterval bir sayı döner (unref yok); Node'da (testler bu
  // modülü doğrudan import ettiğinde) bir Timeout nesnesi döner ve unref()
  // çağrılmazsa süreç asla kapanmaz -- yalnızca varsa çağır.
  if (refreshTimer && typeof refreshTimer.unref === 'function') { refreshTimer.unref(); }
}

export function subscribeSharedActivityData(cb) {
  sharedActivitySubscribers.add(cb);
  ensureSharedActivityListeners();
  if (sharedUsersCache !== null || sharedEventsCache !== null) {cb(sharedUsersCache, sharedEventsCache);}
  return () => { sharedActivitySubscribers.delete(cb); };
}

function editorEventActivity(echarts, el, t) {
  const chart = echarts.init(el);
  const basePalette = [t.primary, t.azure, t.yellow, t.green, t.purple, t.red, t.blue];

  function renderEmpty(message) {
    // 'title' bileşeni initCharts()'ta kayıtlı değil (bu proje sadece ihtiyaç duyulan
    // ECharts bileşenlerini içe aktarıyor) -- her zaman kullanılabilen 'graphic' ile
    // aynı görsel sonuç, ekstra bileşen kaydına gerek kalmadan.
    // notMerge:true (ikinci argüman) ŞART -- aksi halde ECharts önceki setOption()'ı
    // (ör. bu "Yükleniyor…" metni) yeni gerçek grafikle BİRLEŞTİRİR, metin kalıcı
    // olarak grafiğin üzerinde asılı kalırdı.
    chart.setOption({
      ...baseOption(t),
      graphic: [{
        type: 'text',
        left: 'center', top: 'middle',
        style: { text: message, fill: t.textMuted, fontSize: 12, fontFamily }
      }],
      xAxis: { show: false }, yAxis: { show: false }, series: []
    }, true);
  }

  renderEmpty('Yükleniyor…');

  // Kullanıcı isteği: takvimde bir etkinlik değiştiğinde bu grafik de eş
  // zamanlı güncellensin -- tek seferlik once('value') yerine, hem users hem
  // etkinlikler üzerinde canlı on('value') dinleyicisi kuruluyor. İkisi de en
  // az bir kez veri getirene kadar çizim yapılmıyor (aksi halde ilk gelen tek
  // başına eksik veriyle çizer).
  let latestUsers = null;
  let latestEvents = null;

  function draw() {
    if (latestUsers === null || latestEvents === null) {return;}
    const users = latestUsers;
    const events = latestEvents;

    let names = [];
    Object.keys(users).forEach((uid) => {
      const u = users[uid];
      if (!u || (u.role !== 'editor' && u.role !== 'admin' && u.role !== 'owner')) {return;}
      const full = ((u.firstName || '') + ' ' + (u.lastName || '')).trim();
      if (full && names.indexOf(full) === -1) {names.push(full);}
    });
    // users/ okunamadıysa (editör rolü) isimleri etkinliklerden türet.
    if (!names.length) { names = isimleriEtkinliklerdenCikar(events); }

    if (!names.length) { renderEmpty('Editor/admin/owner rolünde kullanıcı yok.'); return; }

    const currentYear = String(new Date().getFullYear());
    const counts = {};
    names.forEach((n) => { counts[n] = new Array(12).fill(0); });

    Object.keys(events).forEach((id) => {
      const e = events[id];
      if (!e || !e.tarih) {return;}
      const tarih = String(e.tarih);
      if (tarih.slice(0, 4) !== currentYear) {return;}
      const monthIdx = parseInt(tarih.slice(5, 7), 10) - 1;
      if (monthIdx < 0 || monthIdx > 11) {return;}
      namesForEvent(e).forEach((n) => {
        if (counts[n]) {counts[n][monthIdx]++;}
      });
    });

    const series = names.map((name, i) => {
      const color = colorForIndex(i, basePalette);
      return {
        name,
        type: 'line',
        // NOT: stack:'total' KULLANMA -- bu satırlar birbirinden bağımsız kişi
        // sayıları, kümülatif parçalar değil. Stack'liyken 0 olan biri, bir
        // önceki kişinin toplamının üstüne yığılıp o kişinin çizgisiyle aynı
        // yükseklikte görünüyordu (tooltip doğru ham değeri -- 0 -- gösterse
        // de çizgi yanlış yerde duruyordu). Kullanıcı bulgusu: "Nur ağustosta
        // 0 iken Arda'nın çizgisine biniyor, üstüne gelince 0 yazıyor".
        smooth: true,
        showSymbol: false,
        lineStyle: { color, width: 1.5 },
        itemStyle: { color },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: withAlpha(color, '55') },
            { offset: 1, color: withAlpha(color, '08') }
          ])
        },
        data: counts[name]
      };
    });

    // Kullanıcı bulgusu: mobilde ECharts'ın otomatik çakışma-gizleme
    // davranışı bazı ay etiketlerini düşürüyordu, içinde bulunduğumuz ay
    // hiç görünmeyebiliyordu. Tüm 12 ayı görmeye gerek yok ama şu anki ay
    // HER ZAMAN görünür ve ortada olmalı -- dar ekranda dataZoom ile ~5
    // aylık bir pencere açılır (şu anki ay ortada), zoomLock:true sadece
    // kaydırmaya (swipe) izin verir, pinch-zoom'la bozulmaz. Masaüstünde
    // dataZoom hiç eklenmiyor, mevcut 12 aylık görünüm aynen kalıyor.
    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    const dataZoom = isMobile ? (() => {
      const curMonth = new Date().getMonth();
      let start = curMonth - 2;
      let end = curMonth + 2;
      if (start < 0) { end -= start; start = 0; }
      if (end > 11) { start -= (end - 11); end = 11; }
      start = Math.max(0, start);
      return [{ type: 'inside', xAxisIndex: 0, zoomLock: true, startValue: start, endValue: end }];
    })() : undefined;

    chart.setOption({
      ...baseOption(t),
      tooltip: { ...baseOption(t).tooltip, trigger: 'axis' },
      dataZoom,
      // Kullanıcı isteği: 3'ten fazla kişi eklenince legend iki satıra sarıp
      // (ECharts'ın varsayılan davranışı) sabit "bottom:40" grid boşluğunu aşıyor,
      // ikinci satır grafiğin çizgileriyle üst üste biniyordu. type:'scroll' legend'i
      // TEK satırda tutar (kaç kişi olursa olsun), taşarsa ok tuşlarıyla gezilir --
      // böylece grid boşluğu her zaman yeterli kalır.
      legend: {
        type: 'scroll',
        data: names,
        bottom: 0,
        itemGap: 16,
        textStyle: { color: t.textMuted, fontSize: 11 },
        pageIconColor: t.textMuted,
        pageIconInactiveColor: t.borderLight,
        pageTextStyle: { color: t.textMuted, fontSize: 11 },
        icon: 'circle',
        itemWidth: 8,
        itemHeight: 8
      },
      // Kullanıcı isteği: grafik çok üste yaslıydı, soldaki sayılar görünmüyordu --
      // top artırıldı (grafik kendi div'i içinde aşağı indi), containLabel:true ile
      // sol eksen etiketleri (kaç haneli olursa olsun) ASLA kırpılmıyor, sabit bir
      // piksel tahmini yerine ECharts kendi gerekli genişliği hesaplıyor.
      grid: { ...baseOption(t).grid, top: 28, left: 8, right: 16, bottom: 40, containLabel: true },
      xAxis: {
        type: 'category',
        data: TR_MONTHS,
        boundaryGap: false,
        axisLine: { lineStyle: { color: t.borderLight } },
        axisTick: { show: false },
        axisLabel: { color: t.textMuted, fontSize: 10 }
      },
      yAxis: {
        type: 'value',
        minInterval: 1,
        splitLine: { lineStyle: { color: t.borderLight, type: [4, 3] } },
        axisLabel: { color: t.textMuted, fontSize: 10, formatter: '{value}' },
        axisLine: { show: false },
        axisTick: { show: false }
      },
      series
    }, true); // notMerge:true -- renderEmpty()'in "Yükleniyor…" graphic'ini temizler
  }

  if (!window.firebase) { renderEmpty('Firebase yüklenemedi.'); return chart; }
  // Paylaşılan users/etkinlikler önbeleğine abone olunur -- ayrı .on('value')
  // dinleyicisi açılmaz (bkz. ensureSharedActivityListeners üstteki yorum).
  subscribeSharedActivityData((users, events) => {
    latestUsers = users;
    latestEvents = filterEligibleEventsForStats(events, new Date());
    draw();
  });

  return chart;
}

// Kullanıcı isteği: "Editör Aktivitesi"nin üçüncü görünümü -- "kim hangi
// gün çalışmış" sorusuna cevap. editorEventActivity ile BİREBİR aynı görsel
// dil (bağımsız kişi çizgileri, aynı renk paleti, aynı legend/grid deseni),
// tek fark: x ekseni ay değil, İÇİNDE BULUNDUĞUMUZ AYIN GÜNLERİ.
// Kullanıcı bulgusu: "iki kişi aynı gün aynı sayıda etkinliğe gidiyorsa Gün
// sekmesinde üst üste çakışıyor" -- iki kişinin bir günkü sayısı eşitse
// çizgileri TAM aynı noktadan geçiyor, aynı renk+düz çizgi ile biri diğerinin
// arkasında tamamen kayboluyordu. Her seri farklı bir sembol şekli + (3'te 1
// oranında) kesikli çizgi deseniyle ayırt edilebiliyor -- iki çizgi aynı
// koordinattan geçse bile üstteki farklı şekildeki nokta işareti alttakinin
// varlığını ele verir.
const DAILY_SYMBOLS = ['circle', 'diamond', 'triangle', 'rect', 'roundRect', 'pin', 'arrow'];
function dailyLineDash(i) { return i % 3 === 1 ? [6, 3] : (i % 3 === 2 ? [2, 3] : undefined); }

function editorDailyActivity(echarts, el, t) {
  const chart = echarts.init(el);
  const basePalette = [t.primary, t.azure, t.yellow, t.green, t.purple, t.red, t.blue];

  function renderEmpty(message) {
    chart.setOption({
      ...baseOption(t),
      graphic: [{
        type: 'text',
        left: 'center', top: 'middle',
        style: { text: message, fill: t.textMuted, fontSize: 12, fontFamily }
      }],
      xAxis: { show: false }, yAxis: { show: false }, series: []
    }, true);
  }

  renderEmpty('Yükleniyor…');

  let latestUsers = null;
  let latestEvents = null;
  // Kullanıcı isteği: mobilde ayın tüm günleri (30-31 etiket) çok sıkışık
  // duruyordu -- aylık grafikteki gibi bugünü sabitleyip ~7 günlük bir
  // pencere açılıyor, "önceki/sonraki" butonlarıyla pencere kaydırılabiliyor
  // (dataZoom'un kendisi zoomLock:true, yalnızca pan/kaydırma). Bu iki
  // değişken nav butonlarının (aşağıdaki delegated click handler) hangi
  // pencerede olduğumuzu bilmesi için modül kapsamında tutuluyor.
  const DAILY_WINDOW = 7;
  let winStart = 0;
  let winEnd = 0;
  let curDaysInMonth = 31;

  function draw() {
    if (latestUsers === null || latestEvents === null) {return;}
    const users = latestUsers;
    const events = latestEvents;

    let names = [];
    Object.keys(users).forEach((uid) => {
      const u = users[uid];
      if (!u || (u.role !== 'editor' && u.role !== 'admin' && u.role !== 'owner')) {return;}
      const full = ((u.firstName || '') + ' ' + (u.lastName || '')).trim();
      if (full && names.indexOf(full) === -1) {names.push(full);}
    });
    if (!names.length) { names = isimleriEtkinliklerdenCikar(events); }

    if (!names.length) { renderEmpty('Editor/admin/owner rolünde kullanıcı yok.'); return; }

    const now = new Date();
    const currentYearMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    curDaysInMonth = daysInMonth;
    const dayLabels = Array.from({ length: daysInMonth }, (_, i) => String(i + 1));

    const counts = {};
    names.forEach((n) => { counts[n] = new Array(daysInMonth).fill(0); });

    Object.keys(events).forEach((id) => {
      const e = events[id];
      if (!e || !e.tarih) {return;}
      const tarih = String(e.tarih);
      if (tarih.slice(0, 7) !== currentYearMonth) {return;}
      const dayIdx = parseInt(tarih.slice(8, 10), 10) - 1;
      if (dayIdx < 0 || dayIdx >= daysInMonth) {return;}
      namesForEvent(e).forEach((n) => {
        if (counts[n]) {counts[n][dayIdx]++;}
      });
    });

    const series = names.map((name, i) => {
      const color = colorForIndex(i, basePalette);
      return {
        name,
        type: 'line',
        // NOT: stack:'total' KULLANMA -- editorEventActivity'deki aynı gerekçe,
        // bkz. o fonksiyondaki yorum.
        smooth: true,
        // Eşit değerli günlerde çizgiler tam üst üste bindiğinde hangi
        // isimlerin orada olduğunu ayırt etmek için semboller AÇIK.
        showSymbol: true,
        symbol: DAILY_SYMBOLS[i % DAILY_SYMBOLS.length],
        symbolSize: 6,
        lineStyle: { color, width: 1.5, type: dailyLineDash(i) || 'solid' },
        itemStyle: { color },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: withAlpha(color, '55') },
            { offset: 1, color: withAlpha(color, '08') }
          ])
        },
        data: counts[name]
      };
    });

    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    let dataZoom;
    if (isMobile) {
      const today = now.getDate() - 1;
      winStart = Math.max(0, today - Math.floor(DAILY_WINDOW / 2));
      winEnd = Math.min(daysInMonth - 1, winStart + DAILY_WINDOW - 1);
      winStart = Math.max(0, winEnd - DAILY_WINDOW + 1);
      dataZoom = [{ type: 'inside', xAxisIndex: 0, zoomLock: true, startValue: winStart, endValue: winEnd }];
    } else {
      dataZoom = undefined;
    }

    chart.setOption({
      ...baseOption(t),
      tooltip: { ...baseOption(t).tooltip, trigger: 'axis' },
      dataZoom,
      legend: {
        type: 'scroll',
        data: names,
        bottom: 0,
        itemGap: 16,
        textStyle: { color: t.textMuted, fontSize: 11 },
        pageIconColor: t.textMuted,
        pageIconInactiveColor: t.borderLight,
        pageTextStyle: { color: t.textMuted, fontSize: 11 },
        icon: 'circle',
        itemWidth: 8,
        itemHeight: 8
      },
      grid: { ...baseOption(t).grid, top: 28, left: 8, right: 16, bottom: 40, containLabel: true },
      xAxis: {
        type: 'category',
        data: dayLabels,
        boundaryGap: false,
        axisLine: { lineStyle: { color: t.borderLight } },
        axisTick: { show: false },
        axisLabel: { color: t.textMuted, fontSize: 10 }
      },
      yAxis: {
        type: 'value',
        minInterval: 1,
        splitLine: { lineStyle: { color: t.borderLight, type: [4, 3] } },
        axisLabel: { color: t.textMuted, fontSize: 10, formatter: '{value}' },
        axisLine: { show: false },
        axisTick: { show: false }
      },
      series
    }, true);
  }

  // Kullanıcı isteği: "önceki/sonraki günler" butonları -- Operasyonlar
  // sayfasındaki [data-daily-nav] butonları (bkz. index.html/main-v4.js,
  // sadece "Gün" sekmesi mobilde aktifken görünürler) pencereyi DAILY_WINDOW
  // kadar kaydırır. document üzerinde delegated dinleyici kullanılıyor --
  // butonların bulunduğu .card-subtitle innerHTML'i sekme değişince yeniden
  // yazılıyor (main-v4.js), doğrudan bağlanan bir dinleyici bu yenilemede
  // kaybolurdu.
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-daily-nav]');
    if (!btn) {return;}
    const card = btn.closest('.card');
    if (!card || !card.contains(el)) {return;}
    const dir = btn.dataset.dailyNav === 'prev' ? -1 : 1;
    let newStart = winStart + dir * DAILY_WINDOW;
    let newEnd = newStart + DAILY_WINDOW - 1;
    if (newStart < 0) { newStart = 0; newEnd = DAILY_WINDOW - 1; }
    if (newEnd > curDaysInMonth - 1) { newEnd = curDaysInMonth - 1; newStart = Math.max(0, newEnd - DAILY_WINDOW + 1); }
    winStart = newStart;
    winEnd = newEnd;
    chart.dispatchAction({ type: 'dataZoom', xAxisIndex: 0, startValue: winStart, endValue: winEnd });
  });

  if (!window.firebase) { renderEmpty('Firebase yüklenemedi.'); return chart; }
  // Paylaşılan users/etkinlikler önbeleğine abone olunur (bkz. editorEventActivity'deki
  // aynı desen) -- ayrı .on('value') dinleyicisi açılmaz.
  subscribeSharedActivityData((users, events) => {
    latestUsers = users;
    latestEvents = filterEligibleEventsForStats(events, new Date());
    draw();
  });

  return chart;
}

// ────────────────────────
//  Tahmini çekilen fotoğraf sayacı — Operasyonlar sayfası
// ────────────────────────
// Kullanıcı isteği: "bir kişi bir etkinliğe basın görevlisi olarak gittiyse
// fotoğraf makinesiyle gitmiştir" -- o kişinin yalnızca BASIN GÖREVLİSİ
// (gorevli alanı) olarak atandığı etkinlik sayısı × kişiye özel ortalama
// fotoğraf oranı, TÜM bilinen kişiler için toplanıp TEK bir büyük sayı
// olarak gösterilir (kim ne kadar çekmiş -- panelde AYRI AYRI gösterilmiyor,
// sadece toplam). SADECE haber yazarı olarak atandığı etkinlikler SAYILMAZ
// (3 Eylül 2026'da düzeltildi: eskiden namesForEvent kullanılıyordu, o da
// haberYazanlari'nı katıyordu -- yalnızca haber yazan biri fotoğraf makinesiyle
// gitmemiş sayılır, artık gorevliNamesForEvent kullanılıyor). Listede olmayan
// kişiler sayaca dahil EDİLMEZ (kullanıcı isteği: "sadece bilinenleri say")
// -- yeni biri eklendikçe bu tabloya elle eklenecek. Bu tablo herkese açık
// JS bundle'ında -- kullanıcı
// bunun bilinçli tercihi olduğunu onayladı ("herkes görsün").
const PHOTO_RATE_TABLE = {
  'Arda Bilasa': 350,
  'Berk Can Dereci': 800,
  'Nurdan Gürbüz': 400,
  'Hasan Çelen': 420
};
// Tablo eşleşmesi için Türkçe-güvenli normalizasyon (İ/ı, ş/ç/ğ/ö/ü büyük/küçük
// harf farklarını tolere eder) -- isim tabloya birebir aynı yazılmadıysa
// (baş/son boşluk, farklı harf büyüklüğü) sessizce 0 sayılmasın diye.
function normalizeTrName(s) {
  return String(s || '').trim().toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ');
}
const PHOTO_RATE_TABLE_NORMALIZED = Object.keys(PHOTO_RATE_TABLE).reduce((acc, name) => {
  acc[normalizeTrName(name)] = PHOTO_RATE_TABLE[name];
  return acc;
}, {});

function initPhotoCounter() {
  const el = document.querySelector('[data-photo-counter]');
  if (!el) {return;}

  if (!window.firebase) {return;}

  // Kullanıcı isteği: takvimdeki etkinlikler değiştikçe bu sayaç da eş zamanlı
  // güncellensin. Ayrı bir 'etkinlikler' dinleyicisi açmak yerine, aynı düğümü
  // zaten dinleyen paylaşılan önbeleğe abone olunur (bkz. yukarıdaki
  // ensureSharedActivityListeners) -- users tarafı burada kullanılmıyor.
  subscribeSharedActivityData((_users, events) => {
    if (events === null) {return;}
    const eligible = filterEligibleEventsForStats(events, new Date());
    let total = 0;
    Object.keys(eligible).forEach((id) => {
      gorevliNamesForEvent(eligible[id]).forEach((name) => {
        const rate = PHOTO_RATE_TABLE_NORMALIZED[normalizeTrName(name)];
        if (rate !== undefined) {total += rate;}
      });
    });
    el.textContent = total > 0 ? total.toLocaleString('tr-TR') + '+' : '—';
  });
}

// ────────────────────────
//  Toplam protokol sayacı — Operasyonlar sayfası (eski sahte "Total Users")
// ────────────────────────
// Kullanıcı isteği: kullanıcı hesap sayısı değil, İl Protokol Sırası
// listesindeki (ilProtokolVerileri) toplam kişi kaydı sayısı gösterilsin.
function initProtocolCounter() {
  const el = document.querySelector('[data-protocol-counter]');
  if (!el) {return;}
  const subEl = document.querySelector('[data-protocol-counter-sub]');

  if (!window.firebase) {return;}
  if (!firebase.apps.length) {firebase.initializeApp(EDITOR_ACTIVITY_FIREBASE_CONFIG);}

  firebase.database().ref('ilProtokolVerileri').on('value', (snap) => {
    const data = snap.val() || {};
    const entries = Object.values(data).filter(Boolean);
    // "aktif" filtresi, app.js'teki aynı kuralla tutarlı (pasif/silindi hariç).
    const aktif = entries.filter((p) => p.status !== 'pasif' && p.status !== 'silindi');
    el.textContent = aktif.length.toLocaleString('tr-TR');
    if (subEl) {subEl.textContent = 'İl protokol sırasındaki aktif kayıt';}
  }, (err) => {
    console.error('Protokol sayısı yüklenemedi:', err);
    el.textContent = '—';
    if (subEl) {subEl.textContent = 'Yüklenemedi.';}
  });
}

function editorActivityShare(echarts, el, t) {
  const chart = echarts.init(el);
  const basePalette = [t.primary, t.azure, t.yellow, t.purple, t.green, t.blue];
  const block = el.closest('.donut-block');
  const legendEl = block ? block.querySelector('.donut-legend') : null;
  const numEl = block ? block.querySelector('.donut-center-label .num') : null;
  const subEl = block ? block.querySelector('.donut-center-label .sub') : null;

  function renderEmpty(message) {
    chart.setOption({
      textStyle: { fontFamily, color: t.textMuted },
      legend: { show: false },
      graphic: [{
        type: 'text', left: 'center', top: 'middle',
        style: { text: message, fill: t.textMuted, fontSize: 11, fontFamily }
      }],
      series: []
    }, true);
    if (numEl) {numEl.textContent = '—';}
    if (legendEl) {legendEl.innerHTML = '';}
  }

  renderEmpty('Yükleniyor…');

  // Kullanıcı isteği: takvimdeki değişikliklerle eş zamanlı güncellensin --
  // canlı on('value') dinleyicisi (bkz. editorEventActivity'deki aynı desen).
  let latestUsers = null;
  let latestEvents = null;

  function draw() {
    if (latestUsers === null || latestEvents === null) {return;}
    const users = latestUsers;
    const events = latestEvents;

    let names = [];
    Object.keys(users).forEach((uid) => {
      const u = users[uid];
      if (!u || (u.role !== 'editor' && u.role !== 'admin' && u.role !== 'owner')) {return;}
      const full = ((u.firstName || '') + ' ' + (u.lastName || '')).trim();
      if (full && names.indexOf(full) === -1) {names.push(full);}
    });
    // users/ okunamadıysa (editör rolü) isimleri etkinliklerden türet.
    if (!names.length) { names = isimleriEtkinliklerdenCikar(events); }

    const counts = {};
    names.forEach((n) => { counts[n] = 0; });

    Object.keys(events).forEach((id) => {
      namesForEvent(events[id]).forEach((n) => {
        if (counts[n] !== undefined) {counts[n]++;}
      });
    });

    const ranked = names
      .map((name) => [name, counts[name]])
      .filter(([, c]) => c > 0)
      .sort((a, b) => b[1] - a[1]);

    if (!ranked.length) { renderEmpty('Henüz görevli atanmış etkinlik yok.'); return; }

    const TOP_N = 5;
    const top = ranked.slice(0, TOP_N);
    const restSum = ranked.slice(TOP_N).reduce((s, [, c]) => s + c, 0);
    const segments = top.map(([name, c], i) => [name, c, colorForIndex(i, basePalette)]);
    if (restSum > 0) {segments.push(['Diğer', restSum, t.red]);}

    const grandTotal = segments.reduce((s, [, c]) => s + c, 0);

    chart.setOption({
      textStyle: { fontFamily, color: t.textMuted },
      tooltip: { ...baseOption(t).tooltip, trigger: 'item', formatter: '{b}: {d}%' },
      legend: { show: false },
      series: [{
        type: 'pie',
        radius: ['62%', '88%'],
        center: ['50%', '50%'],
        avoidLabelOverlap: false,
        label: { show: false },
        labelLine: { show: false },
        data: segments.map(([name, value, color]) => ({
          name, value, itemStyle: { color, borderColor: t.bgSurface, borderWidth: 2 }
        }))
      }]
    }, true);

    if (numEl) {
      // Kullanıcı isteği: ortada sadece "%" işareti olsun, sayı değil.
      numEl.textContent = '%';
    }
    if (subEl) { subEl.textContent = ''; }
    if (legendEl) {
      legendEl.innerHTML = segments.map(([name, value, color]) => {
        const pct = Math.round((value / grandTotal) * 100);
        // Kullanıcı isteği: yüzdenin yanında kaç etkinliğe gittiği (toplam adet) de yazsın.
        return '<div class="donut-legend-item"><span class="dot" style="background:' + color + '"></span><span class="name">' + name + '</span><span class="pct">' + pct + '% · ' + value + ' etkinlik</span></div>';
      }).join('');
    }
  }

  if (!window.firebase) { renderEmpty('Firebase yüklenemedi.'); return chart; }
  // Paylaşılan users/etkinlikler önbeleğine abone olunur (bkz. editorEventActivity'deki
  // aynı desen) -- ayrı .on('value') dinleyicisi açılmaz.
  subscribeSharedActivityData((users, events) => {
    latestUsers = users;
    latestEvents = filterEligibleEventsForStats(events, new Date());
    draw();
  });

  return chart;
}

const charts = {
  'editor-event-activity': editorEventActivity,
  'editor-daily-activity': editorDailyActivity,
  'editor-activity-share': editorActivityShare
};

/**
 * Mount ECharts on every `<div data-chart="…">` on the page. The `data-chart`
 * value selects one of the three activity factories in the `charts` map.
 * Charts auto-resize on window resize and
 * re-init when the document `data-theme` attribute changes so they pick up
 * fresh CSS-custom-property colors.
 *
 * Lazily imports `echarts/core` + the chart types and components actually used;
 * the import never fires on pages without a matching element.
 * @returns {Promise<void>}
 */
export { initPhotoCounter, initProtocolCounter };

export async function initCharts() {
  const elements = document.querySelectorAll('[data-chart]');
  if (!elements.length) {return;}
  // Show skeleton placeholders while ECharts loads. Removed once each chart
  // mounts. Skipped if the page already pre-renders content inside the host.
  elements.forEach((el) => {
    if (!el.children.length && !el.classList.contains('skeleton')) {
      el.classList.add('skeleton', 'chart-skeleton');
    }
  });

  const { default: echartsCore } = await import('./echarts-runtime.js');

  const mounted = []; // { el, factory, instance }

  const buildAll = () => {
    const t = tokens();
    elements.forEach((el) => {
      const factory = charts[el.dataset.chart];
      if (!factory) {return;}
      el.classList.remove('skeleton', 'chart-skeleton');
      mounted.push({ el, factory, instance: factory(echartsCore, el, t) });
    });
  };

  buildAll();

  // Resize all charts on viewport changes.
  let timer;
  window.addEventListener('resize', () => {
    clearTimeout(timer);
    timer = setTimeout(() => mounted.forEach((m) => m.instance.resize()), 120);
  });

  // Rebuild all charts when the theme changes — tokens come from CSS custom
  // properties, so a fresh setOption isn't enough; dispose + re-init picks up
  // new colors cleanly. Listens for both data-theme attribute changes (light/
  // dark toggle) and a 'themechange' custom event (theme generator page).
  const rebuild = () => {
    const t = tokens();
    mounted.forEach((m) => {
      m.instance.dispose();
      m.instance = m.factory(echartsCore, m.el, t);
    });
  };
  const themeObserver = new MutationObserver((records) => {
    if (records.some((r) => r.attributeName === 'data-theme')) {rebuild();}
  });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  document.documentElement.addEventListener('themechange', rebuild);
}
