// Admin paneli — ECharts entegrasyonu
// Dynamic-imports ECharts only when a [data-chart] element is present on the
// page, keeping pages without charts free of the ~400kB cost.

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

function dashboardNetwork(echarts, el, t) {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const sessions = [420, 580, 510, 720, 680, 790, 752];
  const pageviews = [320, 460, 410, 580, 540, 660, 620];
  const chart = echarts.init(el);
  chart.setOption({
    ...baseOption(t),
    tooltip: { ...baseOption(t).tooltip, trigger: 'axis', axisPointer: { type: 'line', lineStyle: { color: t.borderLight } } },
    legend: { show: false },
    xAxis: {
      type: 'category',
      data: days,
      boundaryGap: false,
      axisLine: { lineStyle: { color: t.borderLight } },
      axisTick: { show: false },
      axisLabel: { color: t.textMuted, fontSize: 10 }
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: t.borderLight, type: [4, 3] } },
      axisLabel: { color: t.textMuted, fontSize: 10 },
      axisLine: { show: false },
      axisTick: { show: false }
    },
    series: [
      {
        name: 'Sessions',
        type: 'line',
        smooth: true,
        symbol: 'circle',
        symbolSize: 5,
        showSymbol: false,
        data: sessions,
        lineStyle: { color: t.primary, width: 2 },
        itemStyle: { color: t.primary, borderColor: t.bgSurface, borderWidth: 2 },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: t.primary + '33' },
            { offset: 1, color: t.primary + '00' }
          ])
        }
      },
      {
        name: 'Page views',
        type: 'line',
        smooth: true,
        showSymbol: false,
        data: pageviews,
        lineStyle: { color: t.azure, width: 1.5, type: 'dashed' },
        itemStyle: { color: t.azure }
      }
    ]
  });
  return chart;
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

    chart.setOption({
      ...baseOption(t),
      tooltip: { ...baseOption(t).tooltip, trigger: 'axis' },
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
  if (!firebase.apps.length) { firebase.initializeApp(EDITOR_ACTIVITY_FIREBASE_CONFIG); }
  firebase.database().ref('users').on('value', (snap) => { latestUsers = snap.val() || {}; draw(); }, () => {
    // "users" düğümü sadece admin/owner'a açık -- editör PERMISSION_DENIED alır.
    // ESKİDEN burada grafik boş gösteriliyordu. Artık boş bir liste ile devam
    // ediliyor: draw() isimleri etkinliklerden türetip grafiği yine çiziyor,
    // böylece editör de kendi aktivitesini görebiliyor (kullanıcı isteği).
    latestUsers = {};
    draw();
  });
  firebase.database().ref('etkinlikler').on('value', (snap) => { latestEvents = snap.val() || {}; draw(); }, (err) => {
    console.error('editorEventActivity grafiği yüklenemedi:', err);
    renderEmpty('Etkinlikler yüklenemedi.');
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
  'Nurdan Gürbüz': 400
};

function initPhotoCounter() {
  const el = document.querySelector('[data-photo-counter]');
  if (!el) {return;}

  if (!window.firebase) {return;}
  if (!firebase.apps.length) {firebase.initializeApp(EDITOR_ACTIVITY_FIREBASE_CONFIG);}

  // Kullanıcı isteği: takvimdeki etkinlikler değiştikçe bu sayaç da eş zamanlı
  // güncellensin -- canlı on('value') dinleyicisi (once('value') değil).
  firebase.database().ref('etkinlikler').on('value', (snap) => {
    const events = snap.val() || {};
    let total = 0;
    Object.keys(events).forEach((id) => {
      gorevliNamesForEvent(events[id]).forEach((name) => {
        if (PHOTO_RATE_TABLE[name] !== undefined) {total += PHOTO_RATE_TABLE[name];}
      });
    });
    el.textContent = total > 0 ? total.toLocaleString('tr-TR') + '+' : '—';
  }, (err) => {
    console.error('Fotoğraf sayacı yüklenemedi:', err);
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

function revenueLine(echarts, el, t) {
  const months = ['May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr'];
  const rev = [12400, 14200, 15600, 17800, 19200, 21500, 23100, 24800, 26200, 27900, 29400, 30100];
  const chart = echarts.init(el);
  chart.setOption({
    ...baseOption(t),
    tooltip: { ...baseOption(t).tooltip, trigger: 'axis', valueFormatter: (v) => '$' + v.toLocaleString() },
    xAxis: {
      type: 'category',
      data: months,
      boundaryGap: false,
      axisLine: { lineStyle: { color: t.borderLight } },
      axisTick: { show: false },
      axisLabel: { color: t.textMuted, fontSize: 10 }
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: t.borderLight, type: [4, 3] } },
      axisLabel: { color: t.textMuted, fontSize: 10, formatter: (v) => '$' + (v / 1000) + 'k' },
      axisLine: { show: false },
      axisTick: { show: false }
    },
    series: [{
      type: 'line',
      smooth: true,
      showSymbol: false,
      data: rev,
      lineStyle: { color: t.primary, width: 2 },
      itemStyle: { color: t.primary },
      areaStyle: {
        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: t.primary + '40' },
          { offset: 1, color: t.primary + '00' }
        ])
      }
    }]
  });
  return chart;
}

function salesBar(echarts, el, t) {
  const channels = ['Web', 'Mobile', 'Email', 'Social', 'Direct', 'Partner'];
  const values = [82, 96, 64, 45, 88, 58];
  const colors = [t.primary, t.azure, t.yellow, t.green, t.purple, t.red];
  const chart = echarts.init(el);
  chart.setOption({
    ...baseOption(t),
    grid: { ...baseOption(t).grid, left: 28 },
    tooltip: { ...baseOption(t).tooltip, trigger: 'axis', axisPointer: { type: 'shadow' } },
    xAxis: {
      type: 'category',
      data: channels,
      axisLine: { lineStyle: { color: t.borderLight } },
      axisTick: { show: false },
      axisLabel: { color: t.textMuted, fontSize: 10 }
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: t.borderLight, type: [4, 3] } },
      axisLabel: { color: t.textMuted, fontSize: 10 },
      axisLine: { show: false },
      axisTick: { show: false }
    },
    series: [{
      type: 'bar',
      data: values.map((v, i) => ({ value: v, itemStyle: { color: colors[i], borderRadius: [4, 4, 0, 0] } })),
      barWidth: '52%'
    }]
  });
  return chart;
}

function trafficDonut(echarts, el, t) {
  const chart = echarts.init(el);
  chart.setOption({
    textStyle: { fontFamily, color: t.textMuted },
    tooltip: {
      ...baseOption(t).tooltip,
      trigger: 'item',
      formatter: '{b}: {d}%'
    },
    legend: { show: false },
    series: [{
      type: 'pie',
      radius: ['62%', '88%'],
      center: ['50%', '50%'],
      avoidLabelOverlap: false,
      label: { show: false },
      labelLine: { show: false },
      data: [
        { value: 40, name: 'Organic', itemStyle: { color: t.primary, borderColor: t.bgSurface, borderWidth: 2 } },
        { value: 20, name: 'Direct',  itemStyle: { color: t.azure,   borderColor: t.bgSurface, borderWidth: 2 } },
        { value: 15, name: 'Referral',itemStyle: { color: t.yellow,  borderColor: t.bgSurface, borderWidth: 2 } },
        { value: 12, name: 'Social',  itemStyle: { color: t.purple,  borderColor: t.bgSurface, borderWidth: 2 } },
        { value: 13, name: 'Email',   itemStyle: { color: t.green,   borderColor: t.bgSurface, borderWidth: 2 } }
      ]
    }]
  });
  return chart;
}

function donut(echarts, el, t, segments, _totalLabel) {
  const chart = echarts.init(el);
  chart.setOption({
    textStyle: { fontFamily, color: t.textMuted },
    tooltip: {
      ...baseOption(t).tooltip,
      trigger: 'item',
      formatter: '{b}: {d}%'
    },
    legend: { show: false },
    series: [{
      type: 'pie',
      radius: ['62%', '88%'],
      center: ['50%', '50%'],
      avoidLabelOverlap: false,
      label: { show: false },
      labelLine: { show: false },
      data: segments.map(([name, value, color]) => ({
        name,
        value,
        itemStyle: { color: t[color] || color, borderColor: t.bgSurface, borderWidth: 2 }
      }))
    }]
  });
  return chart;
}

const deviceUsage = (echarts, el, t) => donut(echarts, el, t, [
  ['iOS',     30, 'primary'],
  ['Android', 25, 'azure'],
  ['Desktop', 20, 'yellow'],
  ['Tablet',  15, 'purple'],
  ['Other',   10, 'red']
]);

// ────────────────────────
//  Kişilere göre etkinlik payı — Operasyonlar sayfası (Device Usage'ın yerinde)
// ────────────────────────
// Kullanıcı isteği: Device Usage'daki donut grafiği güzel bulundu, aynı stil
// (donut + merkez sayı + dinamik liste) kişi başına toplam etkinlik yüzdesi
// için de kullanılsın (aynı gorevli veri kaynağı, bkz. editorEventActivity).
// Legend HTML'de sabit DEĞİL -- kişi sayısı ve isimleri veriye göre değiştiği
// için chart, kendi kapsayıcısındaki .donut-legend ve .donut-center-label
// .num'u da JS'ten dolduruyor. Bu, PAYLAŞILAN 'device-usage' anahtarından
// AYRI bir anahtar (bkz. charts map) -- o anahtarı kullanan başka bir grafik
// (şablonun orijinal sahte iOS/Android/Desktop donut'u) etkilenmesin diye.
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
  if (!firebase.apps.length) { firebase.initializeApp(EDITOR_ACTIVITY_FIREBASE_CONFIG); }
  firebase.database().ref('users').on('value', (snap) => { latestUsers = snap.val() || {}; draw(); }, () => {
    // Yukarıdaki grafikle aynı gerekçe: editörde users/ okunamaz, isimler
    // etkinliklerden türetilir ve grafik yine çizilir.
    latestUsers = {};
    draw();
  });
  firebase.database().ref('etkinlikler').on('value', (snap) => { latestEvents = snap.val() || {}; draw(); }, (err) => {
    console.error('editorActivityShare grafiği yüklenemedi:', err);
    renderEmpty('Etkinlikler yüklenemedi.');
  });

  return chart;
}

const browsers = (echarts, el, t) => donut(echarts, el, t, [
  ['Chrome',  62, 'primary'],
  ['Safari',  25, 'azure'],
  ['Firefox', 13, 'yellow']
]);

// ────────────────────────
//  Stacked area — multi-series stacked with smooth fills
// ────────────────────────
function stackedArea(echarts, el, t) {
  const months = ['May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr'];
  const series = [
    { name: 'Pro',      color: t.primary, data: [12, 14, 15, 18, 19, 22, 23, 25, 26, 28, 29, 30] },
    { name: 'Business', color: t.azure,   data: [8, 9, 10, 12, 13, 14, 16, 18, 19, 20, 22, 24] },
    { name: 'Starter',  color: t.yellow,  data: [4, 5, 5, 6, 7, 7, 8, 8, 9, 9, 10, 11] }
  ];
  const chart = echarts.init(el);
  chart.setOption({
    ...baseOption(t),
    tooltip: { ...baseOption(t).tooltip, trigger: 'axis' },
    legend: {
      data: series.map((s) => s.name),
      bottom: 0,
      itemGap: 16,
      textStyle: { color: t.textMuted, fontSize: 11 },
      icon: 'circle',
      itemWidth: 8,
      itemHeight: 8
    },
    grid: { ...baseOption(t).grid, bottom: 36 },
    xAxis: {
      type: 'category',
      data: months,
      boundaryGap: false,
      axisLine: { lineStyle: { color: t.borderLight } },
      axisTick: { show: false },
      axisLabel: { color: t.textMuted, fontSize: 10 }
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: t.borderLight, type: [4, 3] } },
      axisLabel: { color: t.textMuted, fontSize: 10, formatter: '{value}k' },
      axisLine: { show: false },
      axisTick: { show: false }
    },
    series: series.map((s) => ({
      name: s.name,
      type: 'line',
      stack: 'total',
      smooth: true,
      showSymbol: false,
      lineStyle: { color: s.color, width: 1.5 },
      itemStyle: { color: s.color },
      areaStyle: {
        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: s.color + '55' },
          { offset: 1, color: s.color + '08' }
        ])
      },
      data: s.data
    }))
  });
  return chart;
}

// ────────────────────────
//  Horizontal bar — top categories ranked
// ────────────────────────
function horizontalBar(echarts, el, t) {
  const items = [
    ['United States', 4280, t.primary],
    ['Germany',       3140, t.azure],
    ['United Kingdom', 2680, t.purple],
    ['Japan',         1920, t.yellow],
    ['Brazil',        1430, t.green],
    ['Australia',     1180, t.cyan],
    ['Canada',         960, t.red]
  ];
  const chart = echarts.init(el);
  chart.setOption({
    ...baseOption(t),
    tooltip: { ...baseOption(t).tooltip, trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v) => v.toLocaleString() + ' users' },
    grid: { ...baseOption(t).grid, left: 90, right: 24 },
    xAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: t.borderLight, type: [4, 3] } },
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: t.textMuted, fontSize: 10 }
    },
    yAxis: {
      type: 'category',
      data: items.map((d) => d[0]).reverse(),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: t.text, fontSize: 11.5 }
    },
    series: [{
      type: 'bar',
      barWidth: '52%',
      data: items.map((d) => ({ value: d[1], itemStyle: { color: d[2], borderRadius: [0, 4, 4, 0] } })).reverse()
    }]
  });
  return chart;
}

// ────────────────────────
//  Mixed bar+line — bars with a trend line on a secondary axis
// ────────────────────────
function mixedBarLine(echarts, el, t) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'];
  const orders = [240, 312, 285, 360, 420, 395, 460, 510];
  const aov = [82, 88, 86, 92, 95, 94, 99, 104];
  const chart = echarts.init(el);
  chart.setOption({
    ...baseOption(t),
    tooltip: { ...baseOption(t).tooltip, trigger: 'axis' },
    legend: {
      data: ['Orders', 'Avg order value'],
      bottom: 0, itemGap: 16, icon: 'circle', itemWidth: 8, itemHeight: 8,
      textStyle: { color: t.textMuted, fontSize: 11 }
    },
    grid: { ...baseOption(t).grid, right: 44, bottom: 36 },
    xAxis: {
      type: 'category', data: months,
      axisLine: { lineStyle: { color: t.borderLight } },
      axisTick: { show: false },
      axisLabel: { color: t.textMuted, fontSize: 10 }
    },
    yAxis: [
      {
        type: 'value', name: 'Orders',
        nameTextStyle: { color: t.textMuted, fontSize: 10 },
        splitLine: { lineStyle: { color: t.borderLight, type: [4, 3] } },
        axisLabel: { color: t.textMuted, fontSize: 10 },
        axisLine: { show: false }, axisTick: { show: false }
      },
      {
        type: 'value', name: 'AOV $',
        nameTextStyle: { color: t.textMuted, fontSize: 10 },
        splitLine: { show: false },
        axisLabel: { color: t.textMuted, fontSize: 10, formatter: '${value}' },
        axisLine: { show: false }, axisTick: { show: false }
      }
    ],
    series: [
      {
        name: 'Orders', type: 'bar', yAxisIndex: 0, data: orders,
        barWidth: '40%',
        itemStyle: { color: t.azure, borderRadius: [4, 4, 0, 0] }
      },
      {
        name: 'Avg order value', type: 'line', yAxisIndex: 1, data: aov,
        smooth: true, symbol: 'circle', symbolSize: 6,
        lineStyle: { color: t.primary, width: 2 },
        itemStyle: { color: t.primary, borderColor: t.bgSurface, borderWidth: 2 }
      }
    ]
  });
  return chart;
}

// ────────────────────────
//  Radar — multi-axis comparison of two series
// ────────────────────────
function radar(echarts, el, t) {
  const chart = echarts.init(el);
  chart.setOption({
    textStyle: { fontFamily, color: t.textMuted },
    tooltip: { ...baseOption(t).tooltip, trigger: 'item' },
    legend: {
      data: ['v3', 'v4'],
      bottom: 0, itemGap: 16, icon: 'circle', itemWidth: 8, itemHeight: 8,
      textStyle: { color: t.textMuted, fontSize: 11 }
    },
    radar: {
      indicator: [
        { name: 'Performance', max: 100 },
        { name: 'Bundle size', max: 100 },
        { name: 'A11y',        max: 100 },
        { name: 'DX',          max: 100 },
        { name: 'Polish',      max: 100 },
        { name: 'Coverage',    max: 100 }
      ],
      center: ['50%', '46%'],
      radius: '64%',
      splitNumber: 4,
      axisName: { color: t.textMuted, fontSize: 11 },
      splitLine: { lineStyle: { color: t.borderLight } },
      splitArea: { areaStyle: { color: ['transparent'] } },
      axisLine: { lineStyle: { color: t.borderLight } }
    },
    series: [{
      type: 'radar',
      symbol: 'circle', symbolSize: 5,
      data: [
        {
          name: 'v3',
          value: [72, 58, 65, 70, 60, 80],
          lineStyle: { color: t.azure, width: 1.5, type: 'dashed' },
          itemStyle: { color: t.azure },
          areaStyle: { color: t.azure + '22' }
        },
        {
          name: 'v4',
          value: [94, 90, 86, 92, 89, 95],
          lineStyle: { color: t.primary, width: 2 },
          itemStyle: { color: t.primary, borderColor: t.bgSurface, borderWidth: 2 },
          areaStyle: { color: t.primary + '33' }
        }
      ]
    }]
  });
  return chart;
}

// ────────────────────────
//  Gauge — single KPI with progress arc
// ────────────────────────
function gauge(echarts, el, t) {
  const chart = echarts.init(el);
  chart.setOption({
    textStyle: { fontFamily, color: t.textMuted },
    series: [{
      type: 'gauge',
      startAngle: 210,
      endAngle: -30,
      min: 0,
      max: 100,
      progress: { show: true, width: 14, itemStyle: { color: t.primary } },
      axisLine: { lineStyle: { width: 14, color: [[1, t.borderLight]] } },
      pointer: { show: false },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: { show: false },
      anchor: { show: false },
      title: { show: false },
      detail: {
        valueAnimation: true,
        offsetCenter: [0, 0],
        formatter: '{value}%',
        color: t.text,
        fontSize: 28,
        fontWeight: 700,
        fontFamily
      },
      data: [{ value: 78 }]
    }]
  });
  return chart;
}

// ────────────────────────
//  Scatter — bubble plot with sized points
// ────────────────────────
function scatter(echarts, el, t) {
  // [hours-spent, retention-pct, MAU-thousands]
  const data = [
    [2.1, 32, 6],   [3.4, 41, 12],  [4.8, 56, 22],  [6.1, 64, 32],
    [7.2, 71, 44],  [8.6, 78, 58],  [10.2, 84, 72], [11.5, 89, 88],
    [4.1, 38, 14],  [5.8, 51, 28],  [7.9, 66, 48],  [9.1, 74, 60]
  ];
  const chart = echarts.init(el);
  chart.setOption({
    ...baseOption(t),
    tooltip: {
      ...baseOption(t).tooltip,
      formatter: (p) => `${p.value[2]}k MAU<br>${p.value[0]}h/wk · ${p.value[1]}% retention`
    },
    grid: { ...baseOption(t).grid, left: 40, right: 24 },
    xAxis: {
      type: 'value',
      name: 'Hours/week',
      nameTextStyle: { color: t.textMuted, fontSize: 10 },
      splitLine: { lineStyle: { color: t.borderLight, type: [4, 3] } },
      axisLabel: { color: t.textMuted, fontSize: 10 },
      axisLine: { show: false }, axisTick: { show: false }
    },
    yAxis: {
      type: 'value',
      name: 'Retention',
      nameTextStyle: { color: t.textMuted, fontSize: 10 },
      splitLine: { lineStyle: { color: t.borderLight, type: [4, 3] } },
      axisLabel: { color: t.textMuted, fontSize: 10, formatter: '{value}%' },
      axisLine: { show: false }, axisTick: { show: false }
    },
    series: [{
      type: 'scatter',
      data,
      symbolSize: (val) => Math.sqrt(val[2]) * 3.4,
      itemStyle: {
        color: new echarts.graphic.RadialGradient(0.4, 0.3, 1, [
          { offset: 0, color: t.primary + 'ff' },
          { offset: 1, color: t.primary + '55' }
        ]),
        borderColor: t.bgSurface,
        borderWidth: 1
      }
    }]
  });
  return chart;
}

// ────────────────────────
//  Heatmap — week × hour activity
// ────────────────────────
function heatmap(echarts, el, t) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const hours = ['0', '3', '6', '9', '12', '15', '18', '21'];
  const data = [];
  for (let d = 0; d < days.length; d += 1) {
    for (let h = 0; h < hours.length; h += 1) {
      // Synthesize a believable activity surface
      const hourPeak = 1 - Math.abs(h - 4) / 6; // peak around index 4 (~12:00)
      const dayWeight = d >= 1 && d <= 5 ? 1 : 0.45; // weekdays > weekends
      const noise = 0.55 + Math.random() * 0.45;
      const v = Math.max(0, Math.round(hourPeak * dayWeight * noise * 100));
      data.push([h, d, v]);
    }
  }
  const chart = echarts.init(el);
  chart.setOption({
    textStyle: { fontFamily, color: t.textMuted },
    tooltip: {
      ...baseOption(t).tooltip,
      formatter: (p) => `${days[p.value[1]]} ${hours[p.value[0]]}:00<br><strong>${p.value[2]}</strong> events`
    },
    grid: { left: 50, right: 18, top: 12, bottom: 30, containLabel: false },
    xAxis: {
      type: 'category', data: hours,
      splitArea: { show: true },
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { color: t.textMuted, fontSize: 10, formatter: '{value}:00' }
    },
    yAxis: {
      type: 'category', data: days,
      splitArea: { show: true },
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { color: t.textMuted, fontSize: 10 }
    },
    visualMap: {
      min: 0, max: 100,
      show: false,
      inRange: { color: [t.borderLight, t.primary] }
    },
    series: [{
      type: 'heatmap',
      data,
      label: { show: false },
      itemStyle: { borderColor: t.bgSurface, borderWidth: 2 },
      emphasis: { itemStyle: { shadowBlur: 6, shadowColor: 'rgba(0,0,0,0.18)' } }
    }]
  });
  return chart;
}

// ────────────────────────
//  Funnel — conversion stages
// ────────────────────────
function funnel(echarts, el, t) {
  const chart = echarts.init(el);
  chart.setOption({
    textStyle: { fontFamily, color: t.textMuted },
    tooltip: { ...baseOption(t).tooltip, trigger: 'item', formatter: '{b}: {c}' },
    series: [{
      type: 'funnel',
      left: 24, right: 24, top: 12, bottom: 12,
      width: 'auto',
      min: 0, max: 100,
      gap: 2,
      label: {
        show: true, position: 'inside', color: '#fff',
        fontSize: 12, fontWeight: 600, fontFamily,
        formatter: '{b}: {c}'
      },
      labelLine: { show: false },
      itemStyle: { borderColor: t.bgSurface, borderWidth: 1 },
      data: [
        { value: 100, name: 'Visitors',  itemStyle: { color: t.primary } },
        { value: 62,  name: 'Sign-ups',  itemStyle: { color: t.azure } },
        { value: 38,  name: 'Activated', itemStyle: { color: t.purple } },
        { value: 18,  name: 'Trial',     itemStyle: { color: t.yellow } },
        { value: 9,   name: 'Paid',      itemStyle: { color: t.green } }
      ]
    }]
  });
  return chart;
}

// ────────────────────────
//  Candlestick — OHLC market data
// ────────────────────────
function candlestick(echarts, el, t) {
  // [open, close, low, high]
  const data = [
    [120, 132, 118, 135], [132, 128, 125, 138], [128, 142, 126, 145],
    [142, 140, 135, 148], [140, 156, 138, 158], [156, 162, 152, 168],
    [162, 158, 154, 166], [158, 172, 156, 175], [172, 168, 164, 178],
    [168, 184, 166, 188], [184, 180, 176, 190], [180, 196, 178, 200],
    [196, 188, 184, 202], [188, 204, 186, 208]
  ];
  const days = data.map((_, i) => `D${i + 1}`);
  const chart = echarts.init(el);
  chart.setOption({
    ...baseOption(t),
    tooltip: { ...baseOption(t).tooltip, trigger: 'axis', axisPointer: { type: 'cross' } },
    grid: { ...baseOption(t).grid, left: 40, right: 24 },
    xAxis: {
      type: 'category', data: days,
      axisLine: { lineStyle: { color: t.borderLight } },
      axisTick: { show: false },
      axisLabel: { color: t.textMuted, fontSize: 10 }
    },
    yAxis: {
      type: 'value', scale: true,
      splitLine: { lineStyle: { color: t.borderLight, type: [4, 3] } },
      axisLabel: { color: t.textMuted, fontSize: 10, formatter: '${value}' },
      axisLine: { show: false }, axisTick: { show: false }
    },
    series: [{
      type: 'candlestick',
      data,
      itemStyle: {
        color: t.green,                 // bullish fill
        color0: t.red,                  // bearish fill
        borderColor: t.green,
        borderColor0: t.red
      }
    }]
  });
  return chart;
}

// ────────────────────────
//  Polar bar — circular bar/categorical
// ────────────────────────
function polarBar(echarts, el, t) {
  const data = [78, 64, 92, 56, 71, 85];
  const labels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
  const colors = [t.primary, t.azure, t.purple, t.yellow, t.green, t.red];
  const chart = echarts.init(el);
  chart.setOption({
    textStyle: { fontFamily, color: t.textMuted },
    tooltip: { ...baseOption(t).tooltip, formatter: '{b}: {c}' },
    polar: { radius: ['28%', '78%'], center: ['50%', '52%'] },
    radiusAxis: { max: 100, axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false }, axisLabel: { show: false } },
    angleAxis: {
      type: 'category', data: labels,
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { color: t.textMuted, fontSize: 11 },
      startAngle: 90
    },
    series: [{
      type: 'bar',
      data: data.map((v, i) => ({ value: v, itemStyle: { color: colors[i % colors.length], borderRadius: [4, 4, 0, 0] } })),
      coordinateSystem: 'polar',
      barCategoryGap: '20%'
    }]
  });
  return chart;
}

// ────────────────────────
//  Treemap — hierarchical proportional view
// ────────────────────────
function treemap(echarts, el, t) {
  const chart = echarts.init(el);
  chart.setOption({
    textStyle: { fontFamily, color: t.textMuted },
    tooltip: { ...baseOption(t).tooltip, formatter: (p) => `${p.name}: ${p.value.toLocaleString()}` },
    series: [{
      type: 'treemap',
      roam: false,
      nodeClick: false,
      breadcrumb: { show: false },
      label: { show: true, color: '#fff', fontSize: 11, fontWeight: 600, fontFamily },
      itemStyle: { borderColor: t.bgSurface, borderWidth: 2, gapWidth: 2 },
      levels: [{
        itemStyle: { borderColor: t.bgSurface, borderWidth: 2, gapWidth: 2 }
      }],
      data: [
        { name: 'SaaS · Pro',       value: 4280, itemStyle: { color: t.primary } },
        { name: 'SaaS · Business',  value: 3140, itemStyle: { color: t.primaryDk } },
        { name: 'SaaS · Starter',   value: 1180, itemStyle: { color: t.azure } },
        { name: 'Marketplace',      value: 2680, itemStyle: { color: t.purple } },
        { name: 'Services',         value: 1920, itemStyle: { color: t.yellow } },
        { name: 'Add-ons',          value: 1430, itemStyle: { color: t.green } },
        { name: 'Training',         value: 960,  itemStyle: { color: t.cyan } },
        { name: 'Misc',             value: 540,  itemStyle: { color: t.red } }
      ]
    }]
  });
  return chart;
}

// ────────────────────────
//  Sankey — flow diagram
// ────────────────────────
function sankey(echarts, el, t) {
  const chart = echarts.init(el);
  chart.setOption({
    textStyle: { fontFamily, color: t.textMuted },
    tooltip: { ...baseOption(t).tooltip, trigger: 'item' },
    series: [{
      type: 'sankey',
      left: 12, right: 100, top: 12, bottom: 12,
      nodeWidth: 14,
      nodeGap: 12,
      data: [
        { name: 'Search',   itemStyle: { color: t.primary } },
        { name: 'Direct',   itemStyle: { color: t.azure } },
        { name: 'Social',   itemStyle: { color: t.purple } },
        { name: 'Sign-up',  itemStyle: { color: t.yellow } },
        { name: 'Trial',    itemStyle: { color: t.green } },
        { name: 'Paid',     itemStyle: { color: t.primaryDk } },
        { name: 'Churned',  itemStyle: { color: t.red } }
      ],
      links: [
        { source: 'Search',  target: 'Sign-up', value: 4200 },
        { source: 'Direct',  target: 'Sign-up', value: 1800 },
        { source: 'Social',  target: 'Sign-up', value: 1100 },
        { source: 'Sign-up', target: 'Trial',   value: 4400 },
        { source: 'Sign-up', target: 'Churned', value: 2700 },
        { source: 'Trial',   target: 'Paid',    value: 1850 },
        { source: 'Trial',   target: 'Churned', value: 2550 }
      ],
      label: { color: t.text, fontSize: 11, fontFamily },
      lineStyle: { color: 'gradient', curveness: 0.5, opacity: 0.55 },
      emphasis: { focus: 'adjacency', lineStyle: { opacity: 0.9 } }
    }]
  });
  return chart;
}

// ────────────────────────
//  Calendar heatmap — GitHub-contribution-style year view
// ────────────────────────
function calendarHeatmap(echarts, el, t) {
  // Build a year of synthetic activity ending today.
  const today = new Date();
  const start = new Date(today);
  start.setMonth(start.getMonth() - 11);
  start.setDate(1);
  const data = [];
  for (let d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
    const dow = d.getDay();
    const wd = dow >= 1 && dow <= 5 ? 1 : 0.4;
    const v = Math.max(0, Math.round(wd * (Math.random() * 100)));
    data.push([d.toISOString().slice(0, 10), v]);
  }
  const chart = echarts.init(el);
  chart.setOption({
    textStyle: { fontFamily, color: t.textMuted },
    tooltip: { ...baseOption(t).tooltip, formatter: (p) => `${p.value[0]}: ${p.value[1]} contributions` },
    visualMap: {
      min: 0, max: 100,
      show: false,
      inRange: { color: [t.borderLight, t.primary, t.primaryDk] }
    },
    calendar: {
      top: 30, left: 24, right: 24, bottom: 12,
      cellSize: ['auto', 14],
      range: [start.toISOString().slice(0, 7), today.toISOString().slice(0, 10)],
      itemStyle: { color: t.bgSurfaceSecondary || t.borderLight, borderColor: t.bgSurface, borderWidth: 2 },
      splitLine: { show: false },
      yearLabel: { show: false },
      monthLabel: { color: t.textMuted, fontSize: 10, fontFamily },
      dayLabel: { color: t.textMuted, fontSize: 10, fontFamily, firstDay: 1 }
    },
    series: { type: 'heatmap', coordinateSystem: 'calendar', data }
  });
  return chart;
}

// ────────────────────────
//  Gantt — project timeline (custom series on a time axis)
// ────────────────────────
function gantt(echarts, el, t) {
  const today = new Date();
  const day = (offset) => { const d = new Date(today); d.setDate(d.getDate() + offset); return d.getTime(); };
  // Each row: [trackIndex, start, end, name, color]
  const rows = [
    [0, day(-12), day(-2),  'Discovery & research', t.azure],
    [1, day(-8),  day(8),   'Design system v4',     t.primary],
    [2, day(-3),  day(14),  'Build inbox',          t.purple],
    [3, day(2),   day(10),  'Build kanban',         t.yellow],
    [4, day(7),   day(20),  'Charts gallery',       t.green],
    [5, day(14),  day(28),  'Theme generator',      t.red],
    [6, day(20),  day(35),  'PWA + screenshots',    t.cyan]
  ];
  const tracks = rows.map((r) => r[3]);

  const chart = echarts.init(el);
  chart.setOption({
    textStyle: { fontFamily, color: t.textMuted },
    tooltip: {
      ...baseOption(t).tooltip,
      formatter: (p) => {
        const [, start, end, name] = p.value;
        const f = (ms) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        return `<strong>${name}</strong><br>${f(start)} → ${f(end)}`;
      }
    },
    grid: { left: 132, right: 24, top: 12, bottom: 28, containLabel: false },
    xAxis: {
      type: 'time',
      splitLine: { lineStyle: { color: t.borderLight, type: [4, 3] } },
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { color: t.textMuted, fontSize: 10 }
    },
    yAxis: {
      type: 'category',
      data: tracks,
      inverse: true,
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { color: t.text, fontSize: 11.5, fontFamily }
    },
    series: [{
      type: 'custom',
      renderItem: (params, api) => {
        const idx = api.value(0);
        const startCoord = api.coord([api.value(1), idx]);
        const endCoord = api.coord([api.value(2), idx]);
        const height = api.size([0, 1])[1] * 0.55;
        const x = startCoord[0];
        const y = startCoord[1] - height / 2;
        const width = endCoord[0] - startCoord[0];
        return {
          type: 'rect',
          shape: { x, y, width, height, r: 4 },
          style: { fill: api.value(4) }
        };
      },
      encode: { x: [1, 2], y: 0, tooltip: [3, 1, 2] },
      data: rows
    }]
  });
  return chart;
}

const charts = {
  'dashboard-network': dashboardNetwork,
  'editor-event-activity': editorEventActivity,
  'revenue-line':      revenueLine,
  'sales-bar':         salesBar,
  'traffic-donut':     trafficDonut,
  'device-usage':      deviceUsage,
  'editor-activity-share': editorActivityShare,
  'browsers':          browsers,
  'stacked-area':      stackedArea,
  'horizontal-bar':    horizontalBar,
  'mixed-bar-line':    mixedBarLine,
  'radar':             radar,
  'gauge':             gauge,
  'scatter':           scatter,
  'heatmap':           heatmap,
  'funnel':            funnel,
  'candlestick':       candlestick,
  'treemap':           treemap,
  'sankey':            sankey,
  'calendar-heatmap':  calendarHeatmap,
  'gantt':             gantt,
  'polar-bar':         polarBar
};

/**
 * Mount ECharts on every `<div data-chart="…">` on the page. The `data-chart`
 * value selects a registered factory (see `charts` map below — e.g.
 * `revenue-line`, `traffic-donut`). Charts auto-resize on window resize and
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

  // Modular import keeps the bundle smaller than the full echarts barrel.
  const [
    echartsCore,
    {
      LineChart, BarChart, PieChart,
      RadarChart, GaugeChart, ScatterChart,
      HeatmapChart, FunnelChart, CandlestickChart,
      TreemapChart, SankeyChart, CustomChart
    },
    {
      GridComponent, TooltipComponent, LegendComponent,
      VisualMapComponent, PolarComponent, CalendarComponent, GraphicComponent
    },
    { CanvasRenderer }
  ] = await Promise.all([
    import('echarts/core'),
    import('echarts/charts'),
    import('echarts/components'),
    import('echarts/renderers')
  ]);
  echartsCore.use([
    LineChart, BarChart, PieChart,
    RadarChart, GaugeChart, ScatterChart,
    HeatmapChart, FunnelChart, CandlestickChart,
    TreemapChart, SankeyChart, CustomChart,
    GridComponent, TooltipComponent, LegendComponent,
    VisualMapComponent, PolarComponent, CalendarComponent, GraphicComponent,
    CanvasRenderer
  ]);

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
