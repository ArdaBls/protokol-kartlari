// Settings page interactivity:
// - Persist form input to localStorage by stable key
// - Restore values on next visit
// - Save / Cancel buttons reflect dirty state and roll back on Cancel
// - Danger-zone actions open confirm modals

import { showToast } from './toast.js';
import { showModal } from './modal.js';

const STORAGE_KEY = 'protokol:settings';

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (_e) {
    return {};
  }
}

function save(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (_e) { /* private mode */ }
}

// ────────────────────────
//  PROFILE FORM — Save / Cancel
// ────────────────────────

function initProfileForm() {
  // The settings page wraps profile fields in a <form>. Find the first form
  // inside the settings-content area.
  const profileForm = document.querySelector('.settings-content form');
  if (!profileForm) {return;}

  const inputs = [...profileForm.querySelectorAll('input:not([disabled]), textarea, select')];
  const stored = load();
  inputs.forEach((el) => {
    const k = `field:${el.id || el.name}`;
    if (!k.endsWith(':') && Object.prototype.hasOwnProperty.call(stored, k)) {
      el.value = stored[k];
    }
  });

  const initial = inputs.map((el) => el.value);
  let dirty = false;

  const saveBtn = profileForm.querySelector('button[type="submit"]');
  const cancelBtn = profileForm.querySelector('button[type="reset"]');
  if (saveBtn) {saveBtn.disabled = true;}
  if (cancelBtn) {cancelBtn.disabled = true;}

  const checkDirty = () => {
    const current = inputs.map((el) => el.value);
    dirty = current.some((v, i) => v !== initial[i]);
    if (saveBtn) {saveBtn.disabled = !dirty;}
    if (cancelBtn) {cancelBtn.disabled = !dirty;}
  };

  inputs.forEach((el) => el.addEventListener('input', checkDirty));

  profileForm.addEventListener('submit', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!dirty) {return;}
    const data = load();
    inputs.forEach((el) => {
      const k = `field:${el.id || el.name}`;
      if (!k.endsWith(':')) {data[k] = el.value;}
    });
    save(data);
    inputs.forEach((el, i) => { initial[i] = el.value; });
    dirty = false;
    if (saveBtn) {saveBtn.disabled = true;}
    if (cancelBtn) {cancelBtn.disabled = true;}
    showToast('Profil kaydedildi', { variant: 'success' });
  });

  if (cancelBtn) {
    cancelBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (!dirty) {return;}
      inputs.forEach((el, i) => { el.value = initial[i]; });
      checkDirty();
      showToast('Değişiklikler geri alındı');
    });
  }
}

// ────────────────────────
//  DANGER ZONE
// ────────────────────────

function initDanger() {
  document.querySelectorAll('.danger-row .btn[data-action="export"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const data = load();
      const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), settings: data }, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'protokol-export.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      showToast('Dışa aktarım hazır', { variant: 'success' });
    });
  });

  document.querySelectorAll('.danger-row .btn[data-action="delete"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showModal({
        title: 'Hesap kalıcı olarak silinsin mi?',
        body: `
          <p style="font-size:13px;line-height:1.6;color:var(--text-secondary);margin-bottom:14px">Bu işlem hesabınızı, tüm projelerinizi ve ilişkili tüm verileri <strong>kalıcı olarak siler</strong>. Bu işlem geri alınamaz.</p>
          <div class="form-group">
            <label class="form-label" for="confirm-delete">Onaylamak için <code style="background:var(--bg-surface-secondary);padding:1px 4px;border-radius:3px">SİL</code> yazın</label>
            <input id="confirm-delete" class="form-control" autocomplete="off">
          </div>
        `,
        actions: [
          { label: 'Vazgeç', variant: 'ghost' },
          {
            label: 'Hesabı sil',
            variant: 'danger',
            action: (ctx) => {
              const v = ctx.body.querySelector('#confirm-delete').value;
              if (v !== 'SİL') {
                showToast('Onaylamak için SİL yazın', { variant: 'error' });
                return false;
              }
              showToast('Hesap silme işlemi başlatıldı', { variant: 'error' });
            }
          }
        ]
      });
    });
  });
}

/**
 * Wire up all settings interactions. Idempotent on a single page load.
 */
export function initSettings() {
  if (initSettings._wired) {return;}
  initSettings._wired = true;
  initProfileForm();
  initDanger();
}
