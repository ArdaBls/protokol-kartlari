// Basın Rehberi sayfasının İKİNCİ "klasörü" -- Telefon Rehberi. Kullanıcı
// isteği: "mail atılmayacak kişilerin telefon numaraları ve isimlerinin
// tutulduğu bir klasör olsun, hangi ajans oldukları ya da hangi haber
// sitesinden oldukları yazılacak". press-directory.js'teki E-posta Listesi
// ile AYNI sayfada, sekme (tab) ile geçişli, ama TAMAMEN AYRI bir Firebase
// koleksiyonu (telefonRehberi) -- bu kişiler asla "Gizli Gönder" listesine
// girmez, e-posta alanı hiç yok. CRUD deseni press-directory.js'in
// openContactModal/deleteContact'ıyla kasıtlı olarak aynı (küçük yardımcılar
// dosyalar arası paylaşılmaz -- roster.js'teki proje kuralı).
//
// Veri: telefonRehberi/{id} = { ad, kurum, telefon, guncellemeTs }. "kurum"
// burada ajans/haber sitesi adı. Editör/admin/owner hepsi ekleyip
// düzenleyebilir (basinRehberi ile aynı yetki kuralı).
import { showModal, closeModal } from './modal.js';
import { showToast } from './toast.js';
import { dbPath, isReadOnly } from './db-mode.js';

let database = null;
let listEl = null;
let countEl = null;
let CONTACTS = {};
let canWrite = false;
let filterText = '';
let listenerRef = null;

function escapeHtml(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

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
      const hay = [c.ad, c.kurum, c.telefon].filter(Boolean).join(' ').toLocaleLowerCase('tr');
      return hay.includes(q);
    })
    .sort((a, b) => String(a[1].ad || '').localeCompare(String(b[1].ad || ''), 'tr'));
}

function render() {
  const entries = sortedEntries();
  if (countEl) { countEl.textContent = entries.length + ' kişi'; }
  if (!listEl) { return; }
  if (!entries.length) {
    listEl.innerHTML = '<p class="hint" style="margin:16px;color:var(--text-muted)">Kayıtlı kişi yok.</p>';
    return;
  }
  listEl.innerHTML = entries.map(([id, c]) => {
    const tel = telHref(c.telefon);
    return `
      <div class="press-contact-row" data-contact-id="${escapeHtml(id)}">
        <div class="press-contact-main">
          <div class="press-contact-name">${escapeHtml(c.ad || '(isim yok)')}</div>
          <div class="press-contact-meta">${escapeHtml(c.kurum || '')}</div>
        </div>
        ${tel ? `<a class="press-contact-tel" href="${escapeHtml(tel)}" title="Ara: ${escapeHtml(c.telefon)}"><svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 2h2.5l1 3.5-1.5 1.5a9 9 0 004.5 4.5l1.5-1.5 3.5 1V14a1 1 0 01-1 1C7.5 15 1 8.5 1 3a1 1 0 011-1z"/></svg><span>${escapeHtml(c.telefon)}</span></a>` : ''}
        ${canWrite ? `
          <button type="button" class="press-icon-btn" data-phone-edit="${escapeHtml(id)}" aria-label="Düzenle"><svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9.5 2l2.5 2.5-7 7-3 .5.5-3 7-7z"/></svg></button>
          <button type="button" class="press-icon-btn press-icon-btn--danger" data-phone-delete="${escapeHtml(id)}" aria-label="Sil"><svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7"/></svg></button>
        ` : ''}
      </div>
    `;
  }).join('');
}

function deleteContact(id) {
  const c = CONTACTS[id];
  if (!c || !canWrite) { return; }
  if (isReadOnly()) { showToast('Salt-okunur kilit açık, düzenleme yapılamaz.', { variant: 'error' }); return; }
  showModal({
    title: 'Kişiyi sil?',
    size: 'sm',
    body: '<p style="font-size:13px;color:var(--text-secondary);line-height:1.6;margin:0">"' + escapeHtml(c.ad || '') + '" telefon rehberinden kalıcı olarak silinecek.</p>',
    actions: [
      { label: 'Vazgeç', variant: 'ghost' },
      {
        label: 'Sil',
        variant: 'danger',
        action: () => {
          database.ref(dbPath('telefonRehberi/' + id)).remove()
            .catch((err) => { console.error('Kişi silinemedi:', err); showToast('Kişi silinemedi.', { variant: 'error' }); });
        }
      }
    ]
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
        <input type="text" class="form-control" data-phone-input-ad maxlength="200" value="${escapeHtml(existing ? existing.ad : '')}" placeholder="Ör. Ayşe Yılmaz">
      </div>
      <div class="form-group" style="margin-top:12px">
        <label class="form-label">Ajans / Haber Sitesi</label>
        <input type="text" class="form-control" data-phone-input-kurum maxlength="200" value="${escapeHtml(existing ? existing.kurum : '')}" placeholder="Ör. Samsun Haber Gazetesi">
      </div>
      <div class="form-group" style="margin-top:12px">
        <label class="form-label">Telefon</label>
        <input type="tel" class="form-control" data-phone-input-telefon maxlength="40" value="${escapeHtml(existing ? existing.telefon : '')}" placeholder="0555 123 45 67">
      </div>
    `,
    actions: [
      { label: 'Vazgeç', variant: 'ghost' },
      {
        label: existing ? 'Kaydet' : 'Ekle',
        variant: 'primary',
        closeOnAction: false,
        action: () => {
          const adEl = body.querySelector('[data-phone-input-ad]');
          const ad = (adEl.value || '').trim();
          if (!ad) { adEl.focus(); return false; }
          const kurum = (body.querySelector('[data-phone-input-kurum]').value || '').trim();
          const telefon = (body.querySelector('[data-phone-input-telefon]').value || '').trim();
          const patch = { ad, kurum: kurum || null, telefon: telefon || null, guncellemeTs: firebase.database.ServerValue.TIMESTAMP };
          const ref = existingId ? database.ref(dbPath('telefonRehberi/' + existingId)) : database.ref(dbPath('telefonRehberi')).push();
          ref.set(patch)
            .then(() => showToast(existing ? 'Kişi güncellendi.' : 'Kişi eklendi.', { variant: 'success' }))
            .catch((err) => { console.error('Kişi kaydedilemedi:', err); showToast('Kişi kaydedilemedi.', { variant: 'error' }); });
          closeModal();
          return undefined;
        }
      }
    ]
  });
}

function attachListener() {
  if (listenerRef) { listenerRef.off('value'); }
  listenerRef = database.ref(dbPath('telefonRehberi'));
  listenerRef.on('value', (snap) => {
    CONTACTS = snap.val() || {};
    render();
  }, (err) => {
    console.error('Telefon rehberi yüklenemedi:', err);
    if (listEl) { listEl.innerHTML = '<p class="hint" style="margin:16px;color:var(--text-muted)">Telefon rehberi yüklenemedi.</p>'; }
  });
}

// initPressDirectory() (press-directory.js) zaten aynı sayfada auth/db-mode
// kurulumunu yapıyor -- burası SADECE database referansını ve canWrite'ı
// dışarıdan (basin-rehberi.html'in sekme geçiş kodundan) alır, kendi
// auth/initDbMode akışını TEKRARLAMAZ.
export function initPhoneDirectory(db, writable) {
  listEl = document.querySelector('[data-phone-list]');
  countEl = document.querySelector('[data-phone-count]');
  database = db;
  canWrite = writable;
  attachListener();

  document.querySelector('[data-phone-add]')?.addEventListener('click', () => openContactModal(null));
  document.querySelector('[data-phone-search]')?.addEventListener('input', (e) => { filterText = e.target.value; render(); });

  listEl?.addEventListener('click', (e) => {
    const edit = e.target.closest('[data-phone-edit]');
    if (edit) { openContactModal(edit.dataset.phoneEdit); return; }
    const del = e.target.closest('[data-phone-delete]');
    if (del) { deleteContact(del.dataset.phoneDelete); }
  });
}

// db-mode (Test Modu) değişince press-directory.js kendi dinleyicisini
// yeniden kurarken burası da aynı yolu yeniden dinlemeli.
export function refreshPhoneDirectory() {
  if (!database) { return; }
  attachListener();
}

export function setPhoneDirectoryWritable(writable) {
  canWrite = writable;
  render();
}
