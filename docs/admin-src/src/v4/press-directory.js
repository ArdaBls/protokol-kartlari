// Basın Rehberi — Samsun yerel basınının telefon/e-posta rehberi.
//
// Kullanıcı isteği: rektörlükte etkinlik/özel haberleri basına iletirken
// Outlook'a (eski masaüstü sürümü) yapıştırılan bir liste kullanılıyordu,
// ama HERKESE AÇIK (To/Cc) gidiyordu -- oysa alıcıların birbirini GÖRMEMESİ
// gerekiyor. Bu sayfa: (1) aranabilir bir kişi rehberi -- telefon tıkla-ara
// (tel: linki), e-posta; (2) sık kullanılanları YILDIZLAMA (takım genelinde
// PAYLAŞILAN, kişiye özel değil); (3) "Gizli Gönder" -- seçilen (veya tümü)
// kişilerin e-postalarını BCC'ye koyan bir mailto: linki açar, bu da
// varsayılan e-posta programını (Outlook dahil) BCC dolu yeni bir mesajla
// açar -- alıcılar birbirini GÖRMEZ, ayrı bir entegrasyon/eklenti gerekmez.
//
// Veri: basinRehberi/{id} = { ad, kurum, telefon, eposta, yildizli, guncellemeTs }.
// Editör/admin/owner hepsi ekleyip düzenleyebilir (kullanıcı isteği).
import { showModal, closeModal } from './modal.js';
import { showToast } from './toast.js';
import { dbPath, isReadOnly, initDbMode, renderDbModeBanner, onDbModeChange } from './db-mode.js';

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDOfhq3aYW6sg2_zj0sFsRzXeGziGtLxCk',
  authDomain: 'omu-protokol.firebaseapp.com',
  databaseURL: 'https://omu-protokol-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'omu-protokol'
};

let database = null;
let listEl = null;
let countEl = null;
let CONTACTS = {};
let canWrite = false;
let currentUserName = '';
let currentUserEmail = '';
let filterText = '';
let selected = new Set();
let contactsListenerRef = null;

function escapeHtml(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// tel: linki yalnızca rakam/artı işareti kabul eder -- kullanıcı serbest
// biçimde "0555 123 45 67" gibi yazabilir, arama uygulaması boşluk/parantez
// kabul etmeyebiliyor.
function telHref(telefon) {
  const digits = String(telefon || '').replace(/[^\d+]/g, '');
  return digits ? 'tel:' + digits : '';
}

function sortedEntries() {
  const q = filterText.trim().toLocaleLowerCase('tr');
  return Object.entries(CONTACTS)
    .filter(([, c]) => c)
    .filter(([, c]) => {
      if (!q) { return true; }
      const hay = [c.ad, c.kurum, c.telefon, c.eposta].filter(Boolean).join(' ').toLocaleLowerCase('tr');
      return hay.includes(q);
    })
    .sort((a, b) => {
      const ya = a[1].yildizli ? 1 : 0, yb = b[1].yildizli ? 1 : 0;
      if (ya !== yb) { return yb - ya; }
      return String(a[1].ad || '').localeCompare(String(b[1].ad || ''), 'tr');
    });
}

function updateSendBar() {
  const bar = document.querySelector('[data-press-send-bar]');
  const countLabel = document.querySelector('[data-press-selected-count]');
  if (!bar || !countLabel) { return; }
  countLabel.textContent = selected.size + ' kişi seçildi';
  bar.hidden = selected.size === 0;
}

function render() {
  const entries = sortedEntries();
  if (countEl) { countEl.textContent = entries.length + ' kişi'; }
  const selectAllCb = document.querySelector('[data-press-select-all]');
  if (selectAllCb) {
    selectAllCb.checked = entries.length > 0 && entries.every(([id]) => selected.has(id));
    selectAllCb.indeterminate = !selectAllCb.checked && entries.some(([id]) => selected.has(id));
  }
  if (!listEl) { return; }
  if (!entries.length) {
    listEl.innerHTML = '<p class="hint" style="margin:16px;color:var(--text-muted)">Kayıtlı kişi yok.</p>';
    updateSendBar();
    return;
  }
  listEl.innerHTML = entries.map(([id, c]) => {
    const tel = telHref(c.telefon);
    const checked = selected.has(id);
    return `
      <div class="press-contact-row${c.yildizli ? ' is-starred' : ''}" data-contact-id="${escapeHtml(id)}">
        <input type="checkbox" class="press-contact-cb" data-press-select="${escapeHtml(id)}" ${checked ? 'checked' : ''} ${c.eposta ? '' : 'disabled title="E-posta yok"'}>
        <button type="button" class="press-star-btn${c.yildizli ? ' is-active' : ''}" data-press-star="${escapeHtml(id)}" aria-pressed="${c.yildizli ? 'true' : 'false'}" aria-label="${c.yildizli ? 'Yıldızı kaldır' : 'Yıldızla'}" title="${c.yildizli ? 'Yıldızı kaldır' : 'Sık kullanılanlara ekle'}">
          <svg viewBox="0 0 16 16" width="16" height="16" fill="${c.yildizli ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.4"><path d="M8 1.5l2.02 4.09 4.52.66-3.27 3.18.77 4.5L8 11.77l-4.04 2.16.77-4.5L1.46 6.25l4.52-.66L8 1.5z"/></svg>
        </button>
        <div class="press-contact-main">
          <div class="press-contact-name">${escapeHtml(c.ad || '(isim yok)')}</div>
          <div class="press-contact-meta">${[c.kurum, c.eposta].filter(Boolean).map(escapeHtml).join(' · ')}</div>
        </div>
        ${tel ? `<a class="press-contact-tel" href="${escapeHtml(tel)}" title="Ara: ${escapeHtml(c.telefon)}"><svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 2h2.5l1 3.5-1.5 1.5a9 9 0 004.5 4.5l1.5-1.5 3.5 1V14a1 1 0 01-1 1C7.5 15 1 8.5 1 3a1 1 0 011-1z"/></svg><span>${escapeHtml(c.telefon)}</span></a>` : ''}
        ${canWrite ? `
          <button type="button" class="press-icon-btn" data-press-edit="${escapeHtml(id)}" aria-label="Düzenle"><svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9.5 2l2.5 2.5-7 7-3 .5.5-3 7-7z"/></svg></button>
          <button type="button" class="press-icon-btn press-icon-btn--danger" data-press-delete="${escapeHtml(id)}" aria-label="Sil"><svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7"/></svg></button>
        ` : ''}
      </div>
    `;
  }).join('');
  updateSendBar();
}

function toggleStar(id) {
  const c = CONTACTS[id];
  if (!c || !canWrite) { return; }
  if (isReadOnly()) { showToast('Salt-okunur kilit açık, düzenleme yapılamaz.', { variant: 'error' }); return; }
  database.ref(dbPath('basinRehberi/' + id)).update({
    yildizli: !c.yildizli,
    guncellemeTs: firebase.database.ServerValue.TIMESTAMP
  }).catch((err) => { console.error('Yıldız güncellenemedi:', err); showToast('Yıldız güncellenemedi.', { variant: 'error' }); });
}

function deleteContact(id) {
  const c = CONTACTS[id];
  if (!c || !canWrite) { return; }
  if (isReadOnly()) { showToast('Salt-okunur kilit açık, düzenleme yapılamaz.', { variant: 'error' }); return; }
  showModal({
    title: 'Kişiyi sil?',
    size: 'sm',
    body: '<p style="font-size:13px;color:var(--text-secondary);line-height:1.6;margin:0">"' + escapeHtml(c.ad || '') + '" rehberden kalıcı olarak silinecek.</p>',
    actions: [
      { label: 'Vazgeç', variant: 'ghost' },
      {
        label: 'Sil',
        variant: 'danger',
        action: () => {
          database.ref(dbPath('basinRehberi/' + id)).remove()
            .then(() => { selected.delete(id); })
            .catch((err) => { console.error('Kişi silinemedi:', err); showToast('Kişi silinemedi.', { variant: 'error' }); });
        }
      }
    ]
  });
}

// Kullanıcının Outlook'ta zaten kullandığı biçim: 'Ad' <eposta>; art arda.
// İçe Aktar -- bu metni doğrudan yapıştırıp toplu ekleme. Aynı e-posta birden
// fazla kez geçiyorsa (kullanıcı bulgusu: "tekrar yazılanlar var") SADECE
// BİRİ tutulur -- "(eski...)" etiketli isim varsa etiketsiz/güncel olan tercih
// edilir, yoksa ilk geçen isim kalır. İsim yoksa (yalnızca <eposta>; veya
// '' <eposta>;) e-posta isim olarak kullanılır.
export function parsePastedContacts(text) {
  const entries = String(text || '').split(/;|\r?\n/).map((s) => s.trim()).filter(Boolean);
  const byEmail = new Map();
  entries.forEach((entry) => {
    const emailMatch = entry.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    if (!emailMatch) { return; }
    const eposta = emailMatch[0].toLocaleLowerCase('tr');
    // İsim kısmı e-postadan ÖNCE gelir -- "<eposta>" biçiminde açılış "<"
    // isim parçasının İÇİNDE, SONUNDA kalır (ör. "'Ad' <"), başında değil --
    // bu yüzden ^< değil, sondaki < karakterini kırpmak gerekiyor.
    let ad = entry.slice(0, emailMatch.index);
    ad = ad.replace(/<\s*$/, '').trim();
    ad = ad.replace(/^'+|'+$/g, '').trim();
    const isEski = /\(\s*eski/i.test(ad);
    if (!ad) { ad = eposta; }
    const mevcut = byEmail.get(eposta);
    if (!mevcut) { byEmail.set(eposta, { ad, eposta, eski: isEski }); }
    else if (mevcut.eski && !isEski) { byEmail.set(eposta, { ad, eposta, eski: isEski }); }
  });
  return Array.from(byEmail.values()).map(({ ad, eposta }) => ({ ad, eposta }));
}

function openImportModal() {
  if (!canWrite) { showToast('İçe aktarmak için giriş yapmanız gerekiyor.', { variant: 'error' }); return; }
  if (isReadOnly()) { showToast('Salt-okunur kilit açık, düzenleme yapılamaz.', { variant: 'error' }); return; }
  const { body } = showModal({
    title: 'Listeyi içe aktar',
    size: 'md',
    body: `
      <p style="font-size:12.5px;color:var(--text-secondary);line-height:1.6;margin:0 0 10px">
        Outlook'ta kullandığınız <code>'Ad' &lt;eposta&gt;;</code> biçimindeki listeyi doğrudan aşağıya yapıştırın.
        Aynı e-posta birden fazla kez geçiyorsa yalnızca biri eklenir, zaten rehberde olan e-postalar atlanır.
      </p>
      <textarea class="form-control" data-press-import-text rows="10" style="font-family:monospace;font-size:11.5px" placeholder="'19 MAYIS GAZETESİ' &lt;engizhaber@gmail.com&gt;;&#10;'BAFRA GAZETESİ' &lt;aozdemir555@gmail.com&gt;;"></textarea>
      <p class="hint" data-press-import-preview style="margin:8px 0 0;color:var(--text-muted);font-size:11.5px"></p>
    `,
    actions: [
      { label: 'Vazgeç', variant: 'ghost' },
      {
        label: 'İçe Aktar',
        variant: 'primary',
        closeOnAction: false,
        action: () => {
          const textEl = body.querySelector('[data-press-import-text]');
          const parsed = parsePastedContacts(textEl.value);
          if (!parsed.length) { showToast('Ayrıştırılabilir kişi bulunamadı.', { variant: 'error' }); return false; }
          const existingEmails = new Set(Object.values(CONTACTS).map((c) => String(c && c.eposta || '').toLocaleLowerCase('tr')).filter(Boolean));
          const yeniler = parsed.filter((p) => !existingEmails.has(p.eposta));
          if (!yeniler.length) { showToast('Yapıştırılan kişilerin hepsi zaten rehberde.', { variant: 'error' }); return false; }
          const updates = {};
          yeniler.forEach((c) => {
            const key = database.ref(dbPath('basinRehberi')).push().key;
            updates[dbPath('basinRehberi/' + key)] = { ad: c.ad, eposta: c.eposta, yildizli: false, guncellemeTs: firebase.database.ServerValue.TIMESTAMP };
          });
          database.ref('/').update(updates)
            .then(() => showToast(yeniler.length + ' kişi eklendi' + (parsed.length - yeniler.length ? ' (' + (parsed.length - yeniler.length) + ' zaten vardı, atlandı)' : '') + '.', { variant: 'success' }))
            .catch((err) => { console.error('İçe aktarılamadı:', err); showToast('İçe aktarılamadı.', { variant: 'error' }); });
          closeModal();
          return undefined;
        }
      }
    ]
  });
  const textEl = body.querySelector('[data-press-import-text]');
  const previewEl = body.querySelector('[data-press-import-preview]');
  textEl.addEventListener('input', () => {
    const parsed = parsePastedContacts(textEl.value);
    previewEl.textContent = parsed.length ? parsed.length + ' kişi ayrıştırıldı (tekrar edenler otomatik tekilleştirildi).' : '';
  });
}

function openContactModal(existingId) {
  if (!canWrite) { showToast('Kişi eklemek/düzenlemek için giriş yapmanız gerekiyor.', { variant: 'error' }); return; }
  if (isReadOnly()) { showToast('Salt-okunur kilit açık, düzenleme yapılamaz.', { variant: 'error' }); return; }
  const existing = existingId ? CONTACTS[existingId] : null;
  const { body } = showModal({
    title: existing ? 'Kişiyi düzenle' : 'Yeni kişi',
    size: 'sm',
    body: `
      <div class="form-group">
        <label class="form-label">Ad Soyad</label>
        <input type="text" class="form-control" data-press-input-ad maxlength="200" value="${escapeHtml(existing ? existing.ad : '')}" placeholder="Ör. Ayşe Yılmaz">
      </div>
      <div class="form-group" style="margin-top:12px">
        <label class="form-label">Kurum / Yayın (opsiyonel)</label>
        <input type="text" class="form-control" data-press-input-kurum maxlength="200" value="${escapeHtml(existing ? existing.kurum : '')}" placeholder="Ör. Samsun Haber Gazetesi">
      </div>
      <div class="form-group" style="margin-top:12px">
        <label class="form-label">Telefon (opsiyonel)</label>
        <input type="tel" class="form-control" data-press-input-telefon maxlength="40" value="${escapeHtml(existing ? existing.telefon : '')}" placeholder="0555 123 45 67">
      </div>
      <div class="form-group" style="margin-top:12px">
        <label class="form-label">E-posta (opsiyonel)</label>
        <input type="email" class="form-control" data-press-input-eposta maxlength="200" value="${escapeHtml(existing ? existing.eposta : '')}" placeholder="ornek@gazete.com">
      </div>
    `,
    actions: [
      { label: 'Vazgeç', variant: 'ghost' },
      {
        label: existing ? 'Kaydet' : 'Ekle',
        variant: 'primary',
        closeOnAction: false,
        action: () => {
          const adEl = body.querySelector('[data-press-input-ad]');
          const ad = (adEl.value || '').trim();
          if (!ad) { adEl.focus(); return false; }
          const kurum = (body.querySelector('[data-press-input-kurum]').value || '').trim();
          const telefon = (body.querySelector('[data-press-input-telefon]').value || '').trim();
          const eposta = (body.querySelector('[data-press-input-eposta]').value || '').trim();
          const patch = { ad, kurum: kurum || null, telefon: telefon || null, eposta: eposta || null, guncellemeTs: firebase.database.ServerValue.TIMESTAMP };
          const ref = existingId ? database.ref(dbPath('basinRehberi/' + existingId)) : database.ref(dbPath('basinRehberi')).push();
          (existingId ? ref.update(patch) : ref.set(Object.assign({ yildizli: false }, patch)))
            .then(() => showToast(existing ? 'Kişi güncellendi.' : 'Kişi eklendi.', { variant: 'success' }))
            .catch((err) => { console.error('Kişi kaydedilemedi:', err); showToast('Kişi kaydedilemedi.', { variant: 'error' }); });
          closeModal();
          return undefined;
        }
      }
    ]
  });
}

// "Gizli Gönder" -- seçilen kişilerin e-postalarını BCC'ye koyan bir mailto:
// linki açar. Bu, tarayıcıdan varsayılan e-posta programına (eski Outlook
// dahil) güvenli şekilde veri aktarmanın STANDART yolu -- BCC alıcıları
// birbirini GÖRMEZ, ek bir eklenti/entegrasyon gerekmez. Tek sınır: çok uzun
// listelerde (yüzlerce kişi) bazı Windows/Outlook kombinasyonlarında mailto
// linki karakter sınırına takılabilir -- bu yüzden seçilen sayısı gösterilir,
// kullanıcı gerekirse listeyi bölüp iki ayrı gönderim yapabilir.
function sendHidden() {
  const emails = Array.from(selected)
    .map((id) => CONTACTS[id] && CONTACTS[id].eposta)
    .filter(Boolean);
  if (!emails.length) { showToast('Seçilen kişilerin e-postası yok.', { variant: 'error' }); return; }
  const href = 'mailto:?bcc=' + encodeURIComponent(emails.join(','));
  window.location.href = href;
}

function attachContactsListener() {
  if (contactsListenerRef) { contactsListenerRef.off('value'); }
  contactsListenerRef = database.ref(dbPath('basinRehberi'));
  contactsListenerRef.on('value', (snap) => {
    CONTACTS = snap.val() || {};
    // Silinen/artık e-postası olmayan kişiler seçili kalmasın.
    Array.from(selected).forEach((id) => { if (!CONTACTS[id] || !CONTACTS[id].eposta) { selected.delete(id); } });
    render();
  }, (err) => {
    console.error('Basın rehberi yüklenemedi:', err);
    if (listEl) { listEl.innerHTML = '<p class="hint" style="margin:16px;color:var(--text-muted)">Basın rehberi yüklenemedi.</p>'; }
  });
}

export function initPressDirectory() {
  listEl = document.querySelector('[data-press-list]');
  if (!listEl) { return; }
  countEl = document.querySelector('[data-press-count]');

  if (!firebase.apps.length) { firebase.initializeApp(FIREBASE_CONFIG); }
  database = firebase.database();
  const auth = firebase.auth();

  auth.onAuthStateChanged((user) => {
    if (!user) { canWrite = false; currentUserName = ''; currentUserEmail = ''; render(); return; }
    currentUserEmail = user.email || '';
    database.ref('users/' + user.uid).once('value').then((snap) => {
      const u = snap.val() || {};
      canWrite = (u.role === 'editor' || u.role === 'admin' || u.role === 'owner') && u.blocked !== true;
      currentUserName = ((u.firstName || '') + ' ' + (u.lastName || '')).trim() || currentUserEmail;
      render();
    }).catch(() => { canWrite = false; render(); });
  });

  initDbMode(database).then(() => { renderDbModeBanner(); attachContactsListener(); });
  onDbModeChange(() => { renderDbModeBanner(); attachContactsListener(); });

  document.querySelector('[data-press-add]')?.addEventListener('click', () => openContactModal(null));
  document.querySelector('[data-press-import]')?.addEventListener('click', openImportModal);
  document.querySelector('[data-press-search]')?.addEventListener('input', (e) => { filterText = e.target.value; render(); });
  document.querySelector('[data-press-send-btn]')?.addEventListener('click', sendHidden);
  document.querySelector('[data-press-select-all]')?.addEventListener('change', (e) => {
    const entries = sortedEntries();
    if (e.target.checked) { entries.forEach(([id, c]) => { if (c.eposta) { selected.add(id); } }); }
    else { entries.forEach(([id]) => selected.delete(id)); }
    render();
  });

  listEl.addEventListener('click', (e) => {
    const star = e.target.closest('[data-press-star]');
    if (star) { toggleStar(star.dataset.pressStar); return; }
    const edit = e.target.closest('[data-press-edit]');
    if (edit) { openContactModal(edit.dataset.pressEdit); return; }
    const del = e.target.closest('[data-press-delete]');
    if (del) { deleteContact(del.dataset.pressDelete); }
  });
  listEl.addEventListener('change', (e) => {
    const cb = e.target.closest('[data-press-select]');
    if (!cb) { return; }
    const id = cb.dataset.pressSelect;
    if (cb.checked) { selected.add(id); } else { selected.delete(id); }
    updateSendBar();
    const selectAllCb = document.querySelector('[data-press-select-all]');
    if (selectAllCb) {
      const entries = sortedEntries();
      selectAllCb.checked = entries.length > 0 && entries.every(([eid]) => selected.has(eid));
      selectAllCb.indeterminate = !selectAllCb.checked && entries.some(([eid]) => selected.has(eid));
    }
  });
}
