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
const MATCH_TOLERANCE = 0.55;

const LIST_PATHS = { il: 'ilProtokolVerileri', universite: 'universiteProtokolVerileri' };

let faceMatcher = null;
// label ("il:-Nx1a2b3c") -> { listKey, id, ad, unvan, rank }
let personIndex = new Map();

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

export function initFaceScan() {
  const fileInput = document.getElementById('fsFileInput');
  const img = document.getElementById('fsImage');
  const canvas = document.getElementById('fsCanvas');
  const statusEl = document.getElementById('fsStatus');
  const resultsEl = document.getElementById('fsResults');
  const wrap = document.getElementById('fsImageWrap');
  if (!fileInput || !img || !canvas || !statusEl || !resultsEl || !wrap) {return;}

  let faceapiRef = null;
  const ready = loadModelsAndPeople(statusEl).then((fa) => { faceapiRef = fa; }).catch((err) => {
    console.error('Yüz tanıma sistemi başlatılamadı:', err);
    statusEl.textContent = 'Yüklenemedi: ' + (err && err.message ? err.message : 'bilinmeyen hata') + ' — sayfayı yenileyip tekrar deneyin.';
    statusEl.classList.add('fs-status-error');
  });

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
        const match = faceMatcher ? faceMatcher.findBestMatch(det.descriptor) : null;
        const isKnown = !!(match && match.label !== 'unknown');
        const info = isKnown ? personIndex.get(match.label) : null;
        const box = det.detection.box;
        const label = info ? (info.ad + (info.unvan ? ' (' + info.unvan + ')' : '')) : 'Bilinmiyor';

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
