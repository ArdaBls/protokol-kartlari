// Streak (üst üste giriş) UI'ı — VERİYİ streak.js'ten (backend/hesaplama, bu modüle
// DOKUNULMADI) tüketir, shell.js'in yayınladığı sözleşmeyi kullanır:
//   window.__streakState = { count, longest, justBroken }
//   document.dispatchEvent(new CustomEvent('streak:ready', { detail: result }))
//
// İKİ görevi var:
//   1) Operasyonlar (Dashboard) sayfasındaki [data-streak-widget] göstergesini
//      (7 daire + alev ikonu) doldurur.
//   2) `justBroken:true` geldiğinde, HANGİ admin sayfasında olursa olsun (main-v4.js
//      HER admin sayfasında yükleniyor), ekranın ortasında hamster tekerleği
//      animasyonlu bir "streak bitti" bildirimi gösterir -- profil.html'deki
//      showAchievementPopup ile AYNI etkileşim deseni (tıklayınca/birkaç saniye
///     sonra kapanır) ama BAĞIMSIZ bir bileşen (achievements.js/profil.html'e dokunulmadı).
//
// Race condition notu: shell.js'in streak:ready event'ini HANGİ script önce yüklerse
// yüklesin kaçırmamak için hem `window.__streakState` zaten varsa hemen kullanılıyor
// HEM DE event dinleniyor (ikisi de yazılır, kullanıcı isteği).

const HAMSTER_WHEEL_HTML = `
<div aria-label="Orange and tan hamster running in a metal wheel" role="img" class="wheel-and-hamster">
    <div class="wheel"></div>
    <div class="hamster">
        <div class="hamster__body">
            <div class="hamster__head">
                <div class="hamster__ear"></div>
                <div class="hamster__eye"></div>
                <div class="hamster__nose"></div>
            </div>
            <div class="hamster__limb hamster__limb--fr"></div>
            <div class="hamster__limb hamster__limb--fl"></div>
            <div class="hamster__limb hamster__limb--br"></div>
            <div class="hamster__limb hamster__limb--bl"></div>
            <div class="hamster__tail"></div>
        </div>
    </div>
    <div class="spoke"></div>
</div>
`;

const FLAME_SVG = `
<svg class="streak-flame" viewBox="0 0 24 24" fill="none">
  <defs>
    <linearGradient id="streakFlameGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#fde047"/>
      <stop offset="100%" stop-color="#f97316"/>
    </linearGradient>
  </defs>
  <path fill="url(#streakFlameGrad)" d="M12 2c1 3-2 4-2 7a2 2 0 0 0 4 0c0-1-.5-1.7-.5-1.7 2 1 3.5 3.5 3.5 6.2A5 5 0 0 1 7 13.5c0-3.5 2-5 3-7.5.5-1.2 1.3-2.6 2-4z"/>
</svg>
`;

function renderStreakWidget(state) {
  const wrap = document.querySelector('[data-streak-widget]');
  if (!wrap) { return; }

  const count = (state && state.count) || 0;
  // 7 günlük hafta döngüsü: 0 dolu daire "henüz seri yok" durumu, 7'yi geçince
  // baştan dolmaya başlar (kullanıcı isteği: "bu haftaki ilerleme" mantığı).
  const filled = count > 0 ? (count % 7 === 0 ? 7 : count % 7) : 0;
  const circles = Array.from({ length: 7 }, (_, i) => `<span class="streak-circle${i < filled ? ' filled' : ''}"></span>`).join('');

  const label = count > 0 ? `${count} gün üst üste` : 'Henüz seri yok';

  wrap.innerHTML = `
    <div class="stat-icon yellow">${FLAME_SVG}</div>
    <div class="stat-content">
      <div class="stat-label">Giriş Serisi</div>
      <div class="stat-value-row"><span class="stat-value" style="font-size:16px">${label}</span></div>
      <div class="streak-circles" aria-hidden="true">${circles}</div>
    </div>
  `;
}

// Erişilebilirlik düzeltmesi (denetim bulgusu, KRİTİK): bu popup modal.js'i
// KULLANMIYOR (kasıtlı -- modal.js'in başlık çubuğu/kapat-X/footer butonları bu
// "ortada beliren kart" tasarımına uymuyor), ama bu yüzden modal.js'in ÜCRETSİZ
// sağladığı temel dialog erişilebilirliğinden (role, odak yönetimi, Escape) de
// mahrum kalmıştı -- ekran okuyucu popup'ın açıldığını hiç duyurmuyordu, klavye
// kullanıcısı Escape ile kapatamıyordu, kapanınca odak tetikleyici elemana
// dönmüyordu. Görsel tasarıma DOKUNMADAN aynı üç şey burada elle uygulanıyor.
function showStreakBrokenPopup() {
  const previousFocus = document.activeElement;
  const backdrop = document.createElement('div');
  backdrop.className = 'streak-popup-backdrop';
  backdrop.innerHTML = `
    <div class="streak-popup" role="alertdialog" aria-modal="true" aria-labelledby="streak-popup-title" aria-describedby="streak-popup-desc" tabindex="-1">
      <div class="streak-popup-eyebrow">Seri bitti</div>
      ${HAMSTER_WHEEL_HTML}
      <div class="streak-popup-title" id="streak-popup-title">Giriş serin sona erdi</div>
      <div class="streak-popup-desc" id="streak-popup-desc">Sitede daha çok vakit geçirmelisin.</div>
      <div class="streak-popup-hint">Kapatmak için dokunun veya Escape'e basın</div>
    </div>
  `;
  document.body.appendChild(backdrop);
  requestAnimationFrame(() => backdrop.classList.add('open'));
  backdrop.querySelector('.streak-popup')?.focus();
  let done = false;
  function onKeydown(e) { if (e.key === 'Escape') { close(); } }
  function close() {
    if (done) { return; }
    done = true;
    backdrop.removeEventListener('click', close);
    document.removeEventListener('keydown', onKeydown);
    clearTimeout(autoTimer);
    backdrop.classList.remove('open');
    setTimeout(() => backdrop.remove(), 220);
    if (previousFocus && typeof previousFocus.focus === 'function') { previousFocus.focus(); }
  }
  backdrop.addEventListener('click', close);
  document.addEventListener('keydown', onKeydown);
  const autoTimer = setTimeout(close, 5500);
}

let handled = false;
function handleStreakState(state) {
  // Aynı state birden fazla kez gelirse (ör. hem window.__streakState hem event
  // yakalanırsa) bildirim/render tekrarlanmasın.
  if (handled) { return; }
  handled = true;
  renderStreakWidget(state);
  if (state && state.justBroken) { showStreakBrokenPopup(); }
}

export function initStreakUi() {
  if (window.__streakState) { handleStreakState(window.__streakState); }
  document.addEventListener('streak:ready', (e) => handleStreakState(e.detail));
}
