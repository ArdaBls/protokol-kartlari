// Yüz Tanıma ve Protokol Sıralama (Faz 16) — "Sistem durumu" sekmesinin yerini aldı.
//
// Kullanıcı isteği: bir etkinlik/grup fotoğrafı yüklenince, protokol kartlarına daha
// önce yüz vektörü (descriptor) çıkarılmış kayıtlı kişileri tanı, kutu çiz, ve
// tanınanları protokol sırasına (rank) göre listeleyen kartlar bas.
//
// Performans/kota kısıtı (kritik): TÜM kişilerin Base64 fotoğrafları ASLA toplu
// indirilmez. FaceMatcher, "yuzVerileri/{il|universite}/{id}" adlı FOTOĞRAFSIZ bir
// ayna düğümünden kurulur (ad/unvan/rank/faceDescriptor — bkz. app.js savePerson()).
// Sadece fotoğrafta GERÇEKTEN tanınan kişilerin fotoğrafı, kart render edildikten
// SONRA, tek tek ve isteğe bağlı olarak çekilir.
import { showToast } from './toast.js';

const firebaseConfig = {
  apiKey: 'AIzaSyDOfhq3aYW6sg2_zj0sFsRzXeGziGtLxCk',
  authDomain: 'omu-protokol.firebaseapp.com',
  databaseURL: 'https://omu-protokol-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'omu-protokol'
};

// face-api.js UMD build + model ağırlıkları -- ikisi de TEMBEL yüklenir (bu sayfaya
// girilmeden hiçbir kullanıcıya indirtilmez). Kullanıcının istediği 3 model: SSD
// MobileNet v1 (yüz tespiti), 68-nokta yüz işaretleri, yüz tanıma (128 boyutlu vektör).
const FACE_API_SCRIPT_URL = 'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js';
const FACE_API_MODELS_URL = 'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights';
// Kullanıcının belirttiği aralık (0.55-0.6) -- ne kadar düşükse o kadar SIKI eşleştirme.
// 0.6'da denendi ama kalabalık/grup fotoğraflarında protokolde OLMAYAN sivil kişiler bile
// yanlışlıkla kayıtlı birinin ismiyle etiketleniyordu -- kayıtlı kişi sayısı arttıkça (~170)
// rastgele bir yüzün BİRİNE tesadüfen yakın çıkma ihtimali artar, üstüne kalabalık fotoğrafta
// küçük/uzak yüzlerin vektörü zaten daha az güvenilir. Yanlış isim koymak, tanımamaktan
// (Bilinmiyor demekten) çok daha kötü bir hata -- eşik sıkılaştırıldı (bkz. MIN_FACE_PX de).
const MATCH_TOLERANCE = 0.5;
// Bu genişlikten (piksel, EKRANDA gösterilen boyutta) küçük yüzler HİÇ eşleştirilmez --
// kalabalık fotoğraftaki uzak/küçük yüzlerin 128 boyutlu vektörü güvenilmez olur, bunlar
// hep "Bilinmiyor" kalır (kutuları yine çizilir, sadece isim denenmez).
const MIN_FACE_PX = 70;

const LIST_PATHS = { il: 'ilProtokolVerileri', universite: 'universiteProtokolVerileri' };

let faceMatcher = null;
// label ("il:-Nx1a2b3c") -> { listKey, id, ad, unvan, rank }
let personIndex = new Map();
let canWrite = false;

function loadFaceApiScript() {
  return new Promise((resolve, reject) => {
    if (window.faceapi) { resolve(window.faceapi); return; }
    const script = document.createElement('script');
    script.src = FACE_API_SCRIPT_URL;
    script.onload = () => resolve(window.faceapi);
    script.onerror = () => reject(new Error('face-api.js yüklenemedi (ağ hatası).'));
    document.head.appendChild(script);
  });
}

async function loadModelsAndPeople(statusEl) {
  statusEl.textContent = 'Yüz tanıma modelleri yükleniyor…';
  const faceapi = await loadFaceApiScript();
  await Promise.all([
    faceapi.nets.ssdMobilenetv1.loadFromUri(FACE_API_MODELS_URL),
    faceapi.nets.faceLandmark68Net.loadFromUri(FACE_API_MODELS_URL),
    faceapi.nets.faceRecognitionNet.loadFromUri(FACE_API_MODELS_URL)
  ]);

  statusEl.textContent = 'Kayıtlı kişi listesi indiriliyor (fotoğrafsız)…';
  if (!firebase.apps.length) { firebase.initializeApp(firebaseConfig); }
  // BİLEREK "yuzVerileri" -- ana kişi düğümleri (ilProtokolVerileri/universiteProtokolVerileri)
  // DEĞİL, onların Base64 fotoğraf İÇERMEYEN aynası. Bkz. dosya başı yorumu.
  const snap = await firebase.database().ref('yuzVerileri').once('value');
  const data = snap.val() || {};

  const labeled = [];
  personIndex = new Map();
  Object.keys(data).forEach((listKey) => {
    const bucket = data[listKey] || {};
    Object.keys(bucket).forEach((id) => {
      const rec = bucket[id];
      if (!rec || !Array.isArray(rec.faceDescriptor) || rec.faceDescriptor.length !== 128) {return;}
      const label = listKey + ':' + id;
      personIndex.set(label, { listKey, id, ad: rec.ad || '', unvan: rec.unvan || '', rank: (rec.rank === undefined ? null : rec.rank) });
      labeled.push(new faceapi.LabeledFaceDescriptors(label, [new Float32Array(rec.faceDescriptor)]));
    });
  });

  if (!labeled.length) {
    faceMatcher = null;
    statusEl.textContent = 'Kayıtlı hiç yüz vektörü yok — önce kişi kartlarına fotoğraf ekleyip kaydedin.';
    return faceapi;
  }
  faceMatcher = new faceapi.FaceMatcher(labeled, MATCH_TOLERANCE);
  statusEl.textContent = labeled.length + ' kişi tanınabilir hâle geldi. Bir etkinlik/grup fotoğrafı yükleyin.';
  return faceapi;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Dosya okunamadı.'));
    reader.readAsDataURL(file);
  });
}

function escapeHtml(s) {
  return String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Tanınan kişileri protokol sırasına (rank, küçükten büyüğe; boş rank en sona) göre
// kart olarak basar, sonra HER KART İÇİN AYRI AYRI (toplu değil) fotoğrafını çeker.
function renderRankedCards(list, container) {
  if (!list.length) {
    container.innerHTML = '<p class="fs-empty">Fotoğrafta kayıtlı hiç kimse tanınmadı.</p>';
    return;
  }
  container.innerHTML = list.map((p, i) => (
    '<div class="fs-card" id="fs-card-' + i + '">' +
      '<div class="fs-card-rank">' + (i + 1) + '</div>' +
      '<div class="fs-card-photo"><div class="fs-card-avatar-fallback">' + escapeHtml((p.ad || '?').trim().charAt(0).toUpperCase()) + '</div><img class="fs-card-img" alt="" style="display:none"></div>' +
      '<div class="fs-card-info"><div class="fs-card-name">' + escapeHtml(p.ad) + '</div>' +
        '<div class="fs-card-title">' + escapeHtml(p.unvan) + (p.rank !== null && p.rank !== undefined && p.rank !== '' ? ' · Sıra ' + escapeHtml(String(p.rank)) : '') + '</div></div>' +
    '</div>'
  )).join('');

  list.forEach((p, i) => {
    const listPath = LIST_PATHS[p.listKey];
    if (!listPath) {return;}
    // Sadece BU tanınan kişinin "photo" alt-yolu -- kişinin diğer alanları bile
    // gelmiyor, tüm listedeki DİĞER kişilerin fotoğrafları hiç indirilmiyor.
    firebase.database().ref(listPath + '/' + p.id + '/photo').once('value').then((photoSnap) => {
      const url = photoSnap.val();
      if (!url) {return;}
      const el = document.querySelector('#fs-card-' + i + ' .fs-card-img');
      const fallback = document.querySelector('#fs-card-' + i + ' .fs-card-avatar-fallback');
      if (el) { el.src = url; el.style.display = 'block'; if (fallback) {fallback.style.display = 'none';} }
    }).catch((err) => console.error('Kişi fotoğrafı çekilemedi (' + p.ad + '):', err));
  });
}

// Fotoğrafı zaten bulutta olan ama descriptor'ı olmayan aktif kayıtları SIRAYLA
// işler -- fotoğraf yeniden seçilmez, zaten kayıtlı Base64/URL üzerinden aynı
// detectFaceDescriptorFromImage mantığı (SsdMobilenetv1) kullanılır. app.js'teki
// bulkExtractFaceDescriptors() ile AYNI iş, admin panelinin kendi sayfasından.
async function bulkExtractFaceDescriptors(faceapi, btn, statusEl, listEl) {
  if (!canWrite) { showToast('Bu işlem için düzenleme yetkiniz yok.', { variant: 'error' }); return; }
  btn.disabled = true;
  const originalLabel = btn.textContent;
  if (listEl) {listEl.innerHTML = '';}
  try {
    statusEl.textContent = 'Fotoğraflı ama vektörsüz kayıtlar taranıyor…';
    const [ilSnap, uniSnap] = await Promise.all([
      firebase.database().ref('ilProtokolVerileri').once('value'),
      firebase.database().ref('universiteProtokolVerileri').once('value')
    ]);
    const buckets = { il: ilSnap.val() || {}, universite: uniSnap.val() || {} };
    const targets = [];
    Object.keys(buckets).forEach((listKey) => {
      Object.keys(buckets[listKey]).forEach((id) => {
        const p = buckets[listKey][id];
        if (p && p.status === 'aktif' && p.photo && !(Array.isArray(p.faceDescriptor) && p.faceDescriptor.length === 128)) {
          targets.push({ listKey, id, ad: p.name || '', unvan: p.title || '', rank: p.rank, photo: p.photo });
        }
      });
    });
    if (!targets.length) { statusEl.textContent = 'İşlenecek kayıt yok -- fotoğrafı olan herkes zaten tanınabilir.'; return; }

    let found = 0; let failed = 0;
    // Kullanıcı isteği: sahada telefonla çalışırken sonucu tek tek kontrol edemiyor --
    // yüzü bulunamayan (muhtemelen düşük çözünürlük/profil fotoğrafı) kayıtların ad+unvanı
    // ekrana bir liste olarak basılır, eve dönünce o kişilerin fotoğrafı elle kontrol edilir.
    const notFoundList = [];
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      btn.textContent = 'İşleniyor ' + (i + 1) + '/' + targets.length + '…';
      try {
        const img = await new Promise((resolve, reject) => {
          const im = new Image();
          im.onload = () => resolve(im);
          im.onerror = () => reject(new Error('Fotoğraf açılamadı.'));
          im.src = t.photo;
        });
        const result = await faceapi.detectSingleFace(img, new faceapi.SsdMobilenetv1Options()).withFaceLandmarks().withFaceDescriptor();
        if (!result) { notFoundList.push(t); continue; }
        const descriptor = Array.from(result.descriptor);
        const updates = {};
        updates[(LIST_PATHS[t.listKey] + '/' + t.id) + '/faceDescriptor'] = descriptor;
        updates['yuzVerileri/' + t.listKey + '/' + t.id] = {
          ad: t.ad, unvan: t.unvan,
          rank: (t.rank === '' || t.rank === undefined || t.rank === null) ? null : Number(t.rank),
          faceDescriptor: descriptor
        };
        await firebase.database().ref('/').update(updates);
        found++;
      } catch (err) {
        console.error('Toplu yüz çıkarma hatası (' + t.ad + '):', err);
        failed++;
      }
    }

    const summary = found + ' kişi tanınabilir hâle geldi, ' + notFoundList.length + ' fotoğrafta yüz bulunamadı' + (failed ? ', ' + failed + ' kayıt hata verdi' : '') + '.';
    statusEl.textContent = summary;
    showToast(summary, { variant: failed ? 'error' : 'success' });

    if (listEl) {
      if (notFoundList.length) {
        listEl.innerHTML = '<p class="fs-status" style="margin-top:8px"><strong>Yüzü tanınamayan ' + notFoundList.length + ' kayıt</strong> (fotoğrafı kontrol edilmeli):</p>' +
          '<ul class="fs-notfound-list">' + notFoundList.map((t) => (
          '<li>' + escapeHtml(t.ad) + (t.unvan ? ' — ' + escapeHtml(t.unvan) : '') + ' <span class="fs-notfound-liste">(' + (t.listKey === 'il' ? 'İl' : 'Üniversite') + ')</span></li>'
        )).join('') + '</ul>';
      } else {
        listEl.innerHTML = '';
      }
    }
  } catch (err) {
    console.error('Toplu yüz çıkarma başlatılamadı:', err);
    statusEl.textContent = 'Hata: ' + (err && err.message ? err.message : 'bilinmeyen hata');
    showToast('Toplu çıkarma başarısız oldu.', { variant: 'error' });
  } finally {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}

export function initFaceScan() {
  const fileInput = document.getElementById('fsFileInput');
  const img = document.getElementById('fsImage');
  const canvas = document.getElementById('fsCanvas');
  const statusEl = document.getElementById('fsStatus');
  const resultsEl = document.getElementById('fsResults');
  const wrap = document.getElementById('fsImageWrap');
  const bulkBtn = document.getElementById('fsBulkExtractBtn');
  const bulkStatusEl = document.getElementById('fsBulkExtractStatus');
  const bulkListEl = document.getElementById('fsBulkExtractList');
  if (!fileInput || !img || !canvas || !statusEl || !resultsEl || !wrap) {return;}

  let faceapiRef = null;
  const ready = loadModelsAndPeople(statusEl).then((fa) => { faceapiRef = fa; }).catch((err) => {
    console.error('Yüz tanıma sistemi başlatılamadı:', err);
    statusEl.textContent = 'Yüklenemedi: ' + (err && err.message ? err.message : 'bilinmeyen hata') + ' — sayfayı yenileyip tekrar deneyin.';
    statusEl.classList.add('fs-status-error');
  });

  // Sadece editor/admin/owner'a yazma izni var -- Firebase kuralı zaten aynı şekilde
  // reddeder, ama butonu baştan gizlemek daha net bir kullanıcı deneyimi.
  if (bulkBtn) {
    if (!firebase.apps.length) { firebase.initializeApp(firebaseConfig); }
    firebase.auth().onAuthStateChanged((user) => {
      if (!user) { canWrite = false; bulkBtn.style.display = 'none'; return; }
      firebase.database().ref('users/' + user.uid).once('value').then((snap) => {
        const role = (snap.val() || {}).role;
        canWrite = role === 'editor' || role === 'admin' || role === 'owner';
        bulkBtn.style.display = canWrite ? '' : 'none';
      }).catch(() => { canWrite = false; bulkBtn.style.display = 'none'; });
    });
    bulkBtn.addEventListener('click', async () => {
      await ready;
      if (!faceapiRef) { showToast('Yüz tanıma sistemi hazır değil, sayfayı yenileyin.', { variant: 'error' }); return; }
      await bulkExtractFaceDescriptors(faceapiRef, bulkBtn, bulkStatusEl || statusEl, bulkListEl);
    });
  }

  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) {return;}
    resultsEl.innerHTML = '';
    statusEl.classList.remove('fs-status-error');
    statusEl.textContent = 'Hazırlanıyor…';

    try {
      await ready;
      if (!faceapiRef) { showToast('Yüz tanıma sistemi hazır değil, sayfayı yenileyin.', { variant: 'error' }); return; }

      const dataUrl = await fileToDataUrl(file);
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error('Görsel açılamadı — dosya bozuk olabilir.'));
        img.src = dataUrl;
      });
      wrap.style.display = 'block';

      statusEl.textContent = 'Yüzler taranıyor…';
      const detections = await faceapiRef
        .detectAllFaces(img, new faceapiRef.SsdMobilenetv1Options())
        .withFaceLandmarks()
        .withFaceDescriptors();

      if (!detections.length) {
        statusEl.textContent = 'Fotoğrafta hiç yüz bulunamadı.';
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        renderRankedCards([], resultsEl);
        return;
      }

      const displaySize = { width: img.clientWidth, height: img.clientHeight };
      faceapiRef.matchDimensions(canvas, displaySize);
      const resized = faceapiRef.resizeResults(detections, displaySize);

      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const matched = [];

      resized.forEach((det) => {
        const box = det.detection.box;
        // Kalabalık/grup fotoğraflarında uzaktaki küçük yüzlerin 128 boyutlu vektörü
        // güvenilmez oluyor -- bunlar hiç eşleştirilmez, kutu yine çizilir ama isim denenmez.
        const tooSmall = box.width < MIN_FACE_PX || box.height < MIN_FACE_PX;
        const match = (faceMatcher && !tooSmall) ? faceMatcher.findBestMatch(det.descriptor) : null;
        const isKnown = !!(match && match.label !== 'unknown');
        const info = isKnown ? personIndex.get(match.label) : null;
        // Hata ayıklama: eşleşme mesafesi (0 = birebir aynı, eşik: MATCH_TOLERANCE) her zaman
        // konsola yazılır; ekrandaki etikette de görünür (tanınan/tanınmayan fark etmez) --
        // kullanıcı sahada DevTools'a girmeden "ne kadar emin" ayrımını görebilsin.
        if (match) { console.log('Yüz eşleşme -- etiket: ' + match.label + ', mesafe: ' + match.distance.toFixed(3) + ' (eşik: ' + MATCH_TOLERANCE + ')'); }
        const label = tooSmall
          ? 'Bilinmiyor (küçük)'
          : info
            ? (info.ad + (info.unvan ? ' (' + info.unvan + ')' : '') + ' · ' + match.distance.toFixed(2))
            : 'Bilinmiyor' + (match ? ' (' + match.distance.toFixed(2) + ')' : '');

        ctx.strokeStyle = isKnown ? '#1ABB9C' : '#e04f4f';
        ctx.lineWidth = 2;
        ctx.strokeRect(box.x, box.y, box.width, box.height);

        ctx.font = '600 13px Inter, system-ui, sans-serif';
        const textW = ctx.measureText(label).width;
        ctx.fillStyle = isKnown ? '#1ABB9C' : '#e04f4f';
        ctx.fillRect(box.x, Math.max(0, box.y - 20), textW + 10, 20);
        ctx.fillStyle = '#fff';
        ctx.fillText(label, box.x + 5, Math.max(14, box.y - 5));

        if (info && !matched.some((m) => m.listKey === info.listKey && m.id === info.id)) {
          matched.push(info);
        }
      });

      statusEl.textContent = detections.length + ' yüz bulundu, ' + matched.length + ' kişi tanındı.';

      matched.sort((a, b) => {
        const ra = (a.rank === null || a.rank === undefined || a.rank === '') ? Infinity : Number(a.rank);
        const rb = (b.rank === null || b.rank === undefined || b.rank === '') ? Infinity : Number(b.rank);
        if (ra !== rb) {return ra - rb;}
        return (a.ad || '').localeCompare(b.ad || '', 'tr');
      });

      renderRankedCards(matched, resultsEl);
    } catch (err) {
      console.error('Yüz tarama hatası:', err);
      statusEl.textContent = 'Hata: ' + (err && err.message ? err.message : 'bilinmeyen hata');
      statusEl.classList.add('fs-status-error');
      showToast('Fotoğraf işlenemedi.', { variant: 'error' });
    } finally {
      // Aynı dosyanın tekrar seçilmesi durumunda 'change' olayının yine tetiklenmesi için.
      fileInput.value = '';
    }
  });
}
