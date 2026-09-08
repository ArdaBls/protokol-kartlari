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

// Kullanıcı isteği: numaraya basınca DİREKT aramak yerine önce onay istensin.
function confirmCall(id) {
  const c = CONTACTS[id];
  const tel = c && telHref(c.telefon);
  if (!tel) { return; }
  showModal({
    title: 'Aramak istiyor musunuz?',
    body: '<p>' + escapeHtml(c.ad || 'Bu kişi') + ' (' + escapeHtml(c.telefon) + ') aranacak.</p>',
    actions: [
      { label: 'Vazgeç', variant: 'ghost' },
      { label: 'Ara', variant: 'primary', action: () => { window.location.href = tel; } }
    ]
  });
}

// Kullanıcı isteği: press-directory.js'teki E-posta Listesi'nde olduğu gibi
// burada da sık aranan kişiler yıldızlanabilsin -- AYNI davranış (takım
// genelinde paylaşılan, kişiye özel değil), listede en üste çıkar.
function toggleStar(id) {
  const c = CONTACTS[id];
  if (!c || !canWrite) { return; }
  if (isReadOnly()) { showToast('Salt-okunur kilit açık, düzenleme yapılamaz.', { variant: 'error' }); return; }
  database.ref(dbPath('telefonRehberi/' + id)).update({
    yildizli: !c.yildizli,
    guncellemeTs: firebase.database.ServerValue.TIMESTAMP
  }).catch((err) => { console.error('Yıldız güncellenemedi:', err); showToast('Yıldız güncellenemedi.', { variant: 'error' }); });
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
    .sort((a, b) => {
      const ya = a[1].yildizli ? 1 : 0, yb = b[1].yildizli ? 1 : 0;
      if (ya !== yb) { return yb - ya; }
      return String(a[1].ad || '').localeCompare(String(b[1].ad || ''), 'tr');
    });
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
      <div class="press-contact-row${c.yildizli ? ' is-starred' : ''}" data-contact-id="${escapeHtml(id)}">
        <button type="button" class="press-star-btn${c.yildizli ? ' is-active' : ''}" data-phone-star="${escapeHtml(id)}" aria-pressed="${c.yildizli ? 'true' : 'false'}" aria-label="${c.yildizli ? 'Yıldızı kaldır' : 'Yıldızla'}" title="${c.yildizli ? 'Yıldızı kaldır' : 'Sık kullanılanlara ekle'}">
          <svg viewBox="0 0 24 24"><path d="M9.362,9.158c0,0-3.16,0.35-5.268,0.584c-0.19,0.023-0.358,0.15-0.421,0.343s0,0.394,0.14,0.521c1.566,1.429,3.919,3.569,3.919,3.569c-0.002,0-0.646,3.113-1.074,5.19c-0.036,0.188,0.032,0.387,0.196,0.506c0.163,0.119,0.373,0.121,0.538,0.028c1.844-1.048,4.606-2.624,4.606-2.624s2.763,1.576,4.604,2.625c0.168,0.092,0.378,0.09,0.541-0.029c0.164-0.119,0.232-0.318,0.195-0.505c-0.428-2.078-1.071-5.191-1.071-5.191s2.353-2.14,3.919-3.566c0.14-0.131,0.202-0.332,0.14-0.524s-0.23-0.319-0.42-0.341c-2.108-0.236-5.269-0.586-5.269-0.586s-1.31-2.898-2.183-4.83c-0.082-0.173-0.254-0.294-0.456-0.294s-0.375,0.122-0.453,0.294C10.671,6.26,9.362,9.158,9.362,9.158z"></path></svg>
        </button>
        <div class="press-contact-main">
          <div class="press-contact-name">${escapeHtml(c.ad || '(isim yok)')}</div>
          <div class="press-contact-meta">${escapeHtml(c.kurum || '')}</div>
        </div>
        ${tel ? `<button type="button" class="press-contact-tel" data-phone-call="${escapeHtml(id)}" title="Ara: ${escapeHtml(c.telefon)}"><svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 2h2.5l1 3.5-1.5 1.5a9 9 0 004.5 4.5l1.5-1.5 3.5 1V14a1 1 0 01-1 1C7.5 15 1 8.5 1 3a1 1 0 011-1z"/></svg><span>${escapeHtml(c.telefon)}</span></button>` : ''}
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
    const star = e.target.closest('[data-phone-star]');
    if (star) { toggleStar(star.dataset.phoneStar); return; }
    const call = e.target.closest('[data-phone-call]');
    if (call) { confirmCall(call.dataset.phoneCall); return; }
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
