// Operasyonlar sayfasındaki "📍 Bir Etkinliğe Gidiyorum" butonu -- gerçek
// Firebase verisi. Kullanıcı isteği: saha kullanımında (çoklu etkinlik günü,
// 3-4 kişi aynı anda) Takvim sayfasına gitmeden şu andan +1 saatlik, adı
// "(Düzenlenmeye muhtaç)" olan boş bir taslak etkinlik oluşturulsun. taslak
// "taslak:true" alanı sayesinde Takvim'de görsel olarak öne çıkar (bkz.
// calendar.js calBlockClasses, _real-calendar.scss .cal-taslak).
// calendar.js'in persistEvent/EVENT_TYPES gibi fonksiyonları module-private
// ve #calMainBody DOM'una bağımlı olduğu için buradan çağrılamıyor --
// tasks-widget.js'in kanban.js'in desenini tekrar yazdığı gibi (bkz. o
// dosyanın başındaki yorum), aynı atomik update+log deseni burada da
// tekrarlanıyor.
//
// Kullanıcı isteği (2. round): taslak oluşturulduğu anda düzenleme modalı
// AÇILSIN ki hemen düzenlenebilsin -- AMA sayfa değiştirmeden, doğrudan
// Anasayfa/Operasyonlar'ın ÜZERİNDE (kullanıcı: "index html de modal olarak
// önümüze takvimi düzenleme çıksın"). calendar.js'in openEventModal'ı
// module-private + #calMainBody'ye bağımlı olduğu için buradan çağrılamıyor
// (bkz. yukarıdaki not); tam alan paritesi yerine burada HAFİF bir hızlı
// düzenleme modalı kuruluyor (ad/tarih/saat/tür/durum/yer/birim/görevli/not).
// Tam alan seti (haber metni, katılımcılar, rozetler vb.) hâlâ Takvim
// sayfasından düzenlenebilir. Kullanıcı isteği (3. round): modalda hiçbir
// alanı değiştirmeden/başlık girmeden kapatsa BİLE taslak etkinlik zaten
// önce (modal açılmadan) oluşturulduğu için kalıcı olarak kaydedilmiş olur
// -- bu yüzden "ad" burada ZORUNLU DEĞİL (calendar.js'in kendi modalının
// aksine), boş bırakılırsa "(Düzenlenmeye muhtaç)" adı korunur.

import { showModal, closeModal } from './modal.js';
import { showToast } from './toast.js';
import { dbPath, isReadOnly, initDbMode, renderDbModeBanner, onDbModeChange } from './db-mode.js';

// calendar.js'teki EVENT_TYPES/EVENT_STATUS ile birebir aynı -- burada
// yeniden tanımlı çünkü calendar.js module-private (import edilemiyor).
const EVENT_TYPES = [
  { key: 'acilis', ad: 'Açılış Töreni' }, { key: 'konferans', ad: 'Konferans' },
  { key: 'panel', ad: 'Panel' }, { key: 'calistay', ad: 'Çalıştay' },
  { key: 'ziyaret', ad: 'Protokol Ziyareti' }, { key: 'imza', ad: 'Protokol İmza Töreni' },
  { key: 'mezuniyet', ad: 'Mezuniyet Töreni' }, { key: 'odul', ad: 'Ödül Töreni' },
  { key: 'basin', ad: 'Basın Toplantısı' }, { key: 'sergi', ad: 'Sergi / Kültür-Sanat' },
  { key: 'spor', ad: 'Spor Etkinliği' }, { key: 'gorevdegisimi', ad: 'Görev Değişimi' },
  { key: 'akademikbasari', ad: 'Akademik Başarı' }, { key: 'kariyer', ad: 'Kariyer Etkinliği' },
  { key: 'topluluk', ad: 'Öğrenci Toplulukları' }, { key: 'saglik', ad: 'Sağlık Etkinliği' },
  { key: 'uluslararasi', ad: 'Uluslararası Etkinlik' }, { key: 'yesiluniversite', ad: 'Yeşil Üniversite' },
  { key: 'toplanti', ad: 'Toplantı' }, { key: 'bayram', ad: 'Ulusal ve Resmî Bayramlar' },
  { key: 'diger', ad: 'Diğer' }
];
const EVENT_STATUS = [
  { key: 'planlandi', ad: 'Planlandı' }, { key: 'yaziliyor', ad: 'Haber yazılıyor' },
  { key: 'incelemede', ad: 'İncelemede' }, { key: 'tamamlandi', ad: 'Tamamlandı' },
  { key: 'iptal', ad: 'İptal' }
];

function escapeHtml(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDOfhq3aYW6sg2_zj0sFsRzXeGziGtLxCk',
  authDomain: 'omu-protokol.firebaseapp.com',
  databaseURL: 'https://omu-protokol-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'omu-protokol'
};

const QUICK_DRAFT_NAME = '(Düzenlenmeye muhtaç)';

let database = null;
let canWrite = false;
let currentUserName = '';
let currentUserEmail = '';

function pad2(n) { return String(n).padStart(2, '0'); }
function dKey(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
function hm(d) { return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }

function createDraft() {
  if (!canWrite) { showToast('Etkinlik eklemek için giriş yapmanız gerekiyor.', { variant: 'error' }); return; }
  if (isReadOnly()) { showToast('Salt-okunur kilit açık, düzenleme yapılamaz.', { variant: 'error' }); return; }
  const now = new Date();
  const end = new Date(now.getTime() + 60 * 60000);
  const id = database.ref(dbPath('etkinlikler')).push().key;
  const event = {
    ad: QUICK_DRAFT_NAME,
    tur: 'diger',
    durum: 'planlandi',
    tarih: dKey(now),
    saat: hm(now),
    bitisSaat: hm(end),
    yer: '', birim: '', planlayan: '', gorevli: '', haberYazanlari: '',
    haberMetni: '', katilimcilar: [], not: '', rozetler: [], haberKaynagi: '',
    taslak: true,
    olusturan: currentUserName || currentUserEmail,
    olusturmaTs: firebase.database.ServerValue.TIMESTAMP,
    guncellemeTs: firebase.database.ServerValue.TIMESTAMP
  };
  const logKey = database.ref(dbPath('logs/etkinlik')).push().key;
  const updates = {};
  updates[dbPath('etkinlikler/' + id)] = event;
  updates[dbPath('logs/etkinlik/' + logKey)] = {
    by: currentUserName || currentUserEmail, email: currentUserEmail,
    action: 'Hızlı taslak etkinlik oluşturuldu ("Bir Etkinliğe Gidiyorum")', target: QUICK_DRAFT_NAME,
    timestamp: firebase.database.ServerValue.TIMESTAMP
  };
  database.ref('/').update(updates)
    .then(() => {
      showToast('Taslak etkinlik oluşturuldu.', { variant: 'success' });
      openQuickEditModal(id, event);
    })
    .catch((err) => {
      console.error('Taslak etkinlik oluşturulamadı:', err);
      showToast('Taslak etkinlik oluşturulamadı.', { variant: 'error' });
    });
}

// Taslak zaten (bu fonksiyon çağrılmadan ÖNCE) Firebase'e yazıldı -- burada
// kullanıcı hiçbir şey değiştirmeden "Vazgeç"e bassa ya da modalı kapatsa
// bile taslak kalıcı olarak kaydedilmiş olur (kullanıcı isteği).
function openQuickEditModal(id, ev) {
  const { body } = showModal({
    title: 'Etkinliği düzenle',
    size: 'md',
    body: `
      <div class="form-group">
        <label class="form-label">Etkinlik Adı</label>
        <input type="text" class="form-control" data-qe-ad maxlength="200" value="${escapeHtml(ev.ad)}" placeholder="${escapeHtml(QUICK_DRAFT_NAME)}">
      </div>
      <div class="form-row cols-3" style="margin-top:12px">
        <div class="form-group">
          <label class="form-label">Tarih</label>
          <input type="date" class="form-control" data-qe-tarih value="${escapeHtml(ev.tarih)}">
        </div>
        <div class="form-group">
          <label class="form-label">Saat</label>
          <input type="time" class="form-control" data-qe-saat value="${escapeHtml(ev.saat)}">
        </div>
        <div class="form-group">
          <label class="form-label">Bitiş Saati</label>
          <input type="time" class="form-control" data-qe-bitis value="${escapeHtml(ev.bitisSaat)}">
        </div>
      </div>
      <div class="form-row cols-2" style="margin-top:12px">
        <div class="form-group">
          <label class="form-label">Tür</label>
          <select class="form-control" data-qe-tur>${EVENT_TYPES.map((t) => `<option value="${t.key}"${ev.tur === t.key ? ' selected' : ''}>${escapeHtml(t.ad)}</option>`).join('')}</select>
        </div>
        <div class="form-group">
          <label class="form-label">Durum</label>
          <select class="form-control" data-qe-durum>${EVENT_STATUS.map((s) => `<option value="${s.key}"${(ev.durum || 'planlandi') === s.key ? ' selected' : ''}>${escapeHtml(s.ad)}</option>`).join('')}</select>
        </div>
      </div>
      <div class="form-row cols-2" style="margin-top:12px">
        <div class="form-group">
          <label class="form-label">Yer (opsiyonel)</label>
          <input type="text" class="form-control" data-qe-yer maxlength="200" value="${escapeHtml(ev.yer)}">
        </div>
        <div class="form-group">
          <label class="form-label">Birim (opsiyonel)</label>
          <input type="text" class="form-control" data-qe-birim maxlength="200" value="${escapeHtml(ev.birim)}">
        </div>
      </div>
      <div class="form-group" style="margin-top:12px">
        <label class="form-label">Görevli (opsiyonel)</label>
        <input type="text" class="form-control" data-qe-gorevli maxlength="200" value="${escapeHtml(ev.gorevli)}">
      </div>
      <div class="form-group" style="margin-top:12px">
        <label class="form-label">Not (opsiyonel)</label>
        <textarea class="form-control" data-qe-not rows="3">${escapeHtml(ev.not)}</textarea>
      </div>
      <p class="hint" style="margin:10px 0 0;color:var(--text-muted);font-size:11.5px">Tam alan seti (haber metni, katılımcılar vb.) için Takvim sayfasını kullanabilirsiniz. Burada hiçbir şey değiştirmeseniz de taslak etkinlik zaten kaydedildi.</p>
    `,
    actions: [
      { label: 'Kapat', variant: 'ghost' },
      {
        label: 'Kaydet',
        variant: 'primary',
        closeOnAction: false,
        action: () => {
          const ad = (body.querySelector('[data-qe-ad]').value || '').trim() || QUICK_DRAFT_NAME;
          const patch = {
            ad,
            tarih: body.querySelector('[data-qe-tarih]').value || ev.tarih,
            saat: body.querySelector('[data-qe-saat]').value || ev.saat,
            bitisSaat: body.querySelector('[data-qe-bitis]').value || ev.bitisSaat,
            tur: body.querySelector('[data-qe-tur]').value,
            durum: body.querySelector('[data-qe-durum]').value,
            yer: body.querySelector('[data-qe-yer]').value.trim(),
            birim: body.querySelector('[data-qe-birim]').value.trim(),
            gorevli: body.querySelector('[data-qe-gorevli]').value.trim(),
            not: body.querySelector('[data-qe-not]').value.trim(),
            // Kullanıcı gerçek bir başlık verince taslak artık "düzenlenmeye
            // muhtaç" değil -- görsel taslak vurgusu (cal-taslak) kalksın.
            taslak: ad === QUICK_DRAFT_NAME,
            guncellemeTs: firebase.database.ServerValue.TIMESTAMP
          };
          database.ref(dbPath('etkinlikler/' + id)).update(patch)
            .then(() => { showToast('Etkinlik güncellendi.', { variant: 'success' }); closeModal(); })
            .catch((err) => {
              console.error('Etkinlik güncellenemedi:', err);
              showToast('Etkinlik güncellenemedi, taslak olarak kalıyor.', { variant: 'error' });
            });
          return false;
        }
      }
    ]
  });
}

export function initQuickEvent() {
  const btn = document.querySelector('[data-quick-event-btn]');
  if (!btn) { return; }

  if (!firebase.apps.length) { firebase.initializeApp(FIREBASE_CONFIG); }
  database = firebase.database();
  const auth = firebase.auth();

  onDbModeChange(renderDbModeBanner);

  auth.onAuthStateChanged(async (user) => {
    if (!user) { canWrite = false; currentUserName = ''; currentUserEmail = ''; return; }
    currentUserEmail = user.email || '';
    try {
      const snap = await database.ref('users/' + user.uid).once('value');
      const u = snap.val() || {};
      await initDbMode(database);
      renderDbModeBanner();
      canWrite = (u.role === 'editor' || u.role === 'admin' || u.role === 'owner') && u.blocked !== true;
      currentUserName = ((u.firstName || '') + ' ' + (u.lastName || '')).trim() || currentUserEmail;
    } catch (err) {
      console.error('Hızlı etkinlik yetkisi çözülemedi:', err);
      canWrite = false;
    }
  });

  btn.addEventListener('click', createDraft);
}
