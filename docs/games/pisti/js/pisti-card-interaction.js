const DRAG_INTENT_DISTANCE = 8;
const CENTER_DROP_PADDING = 38;
const ANIMATION_MS = 720;

let activeDrag = null;
let suppressTrustedClick = null;
let suppressTrustedClickTimer = null;

function cardButton(target) {
  return target instanceof Element ? target.closest('[data-pisti-oyna]') : null;
}

function isPlayable(button) {
  return button instanceof HTMLButtonElement && !button.disabled;
}

function cssNumber(value) {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? number : 0;
}

function centerPoint(rect) {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function armTrustedClickSuppression(button) {
  suppressTrustedClick = button;
  if (suppressTrustedClickTimer) window.clearTimeout(suppressTrustedClickTimer);
  suppressTrustedClickTimer = window.setTimeout(() => {
    suppressTrustedClick = null;
  }, 900);
}

function applyDragPosition(drag) {
  const deltaX = drag.lastX - drag.startX;
  const deltaY = drag.lastY - drag.startY;
  drag.distance = Math.hypot(deltaX, deltaY);
  drag.button.style.setProperty('--pisti-drag-x', `${deltaX}px`);
  drag.button.style.setProperty('--pisti-drag-y', `${deltaY}px`);
  // Kart, CSS yelpazesinden bağımsız olarak hem yatay hem dikey eksende
  // parmağı/imleci takip eder. !important, hover kuralının sürüklemeyi
  // yalnızca yatay eksene geri çekmesini engeller.
  drag.button.style.setProperty(
    'transform',
    `translate3d(${drag.baseX + deltaX}px, ${drag.baseY + deltaY}px, 0) rotate(${drag.rotation}deg)`,
    'important',
  );
}

function resetDrag(button) {
  button.classList.remove('pisti-el-kart-suruklenen');
  button.style.removeProperty('--pisti-drag-x');
  button.style.removeProperty('--pisti-drag-y');
  button.style.removeProperty('transform');
}

function isCenterDrop(drag) {
  if (drag.distance < DRAG_INTENT_DISTANCE) return false;
  const target = document.querySelector('[data-pisti-masa-kartlari]');
  const rect = target?.getBoundingClientRect();
  if (!rect?.width || !rect.height) return false;

  return drag.lastX >= rect.left - CENTER_DROP_PADDING
    && drag.lastX <= rect.right + CENTER_DROP_PADDING
    && drag.lastY >= rect.top - CENTER_DROP_PADDING
    && drag.lastY <= rect.bottom + CENTER_DROP_PADDING;
}

function animateCardToCenter(button) {
  const card = button.querySelector('.pisti-kart');
  const target = document.querySelector('[data-pisti-masa-kartlari]');
  if (!card || !target) return;

  const startRect = card.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  if (!startRect.width || !targetRect.width) return;

  const clone = card.cloneNode(true);
  const start = centerPoint(startRect);
  const finish = centerPoint(targetRect);
  clone.classList.add('pisti-kart-ucusu');
  clone.style.left = `${start.x - startRect.width / 2}px`;
  clone.style.top = `${start.y - startRect.height / 2}px`;
  clone.style.width = `${startRect.width}px`;
  clone.style.transform = 'translate3d(0, 0, 0) rotate(0deg)';
  clone.style.opacity = '1';
  document.body.appendChild(clone);

  window.requestAnimationFrame(() => {
    clone.style.transform = `translate3d(${finish.x - start.x}px, ${finish.y - start.y}px, 0) rotate(0deg)`;
  });
  window.setTimeout(() => clone.remove(), ANIMATION_MS);
}

function finishDrag(event, cancelled = false) {
  const drag = activeDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  activeDrag = null;

  const { button } = drag;
  button.releasePointerCapture?.(drag.pointerId);
  const play = !cancelled && isCenterDrop(drag);
  const moved = drag.distance >= DRAG_INTENT_DISTANCE;

  // pointerdown'da tarayıcının varsayılan click'i engellendiği için, hareket
  // eşiğinin altında kalan normal bir dokunuşu burada kendimiz çalıştırırız.
  // Böylece kartın alt/üst kısmına basmak aynı sonucu verir.
  if (!cancelled && !moved) {
    armTrustedClickSuppression(button);
    resetDrag(button);
    button.click();
    return;
  }

  if (play) {
    animateCardToCenter(button);
    armTrustedClickSuppression(button);
    resetDrag(button);
    // Firebase işlemini mevcut oyun modülü yapar; bu katman yalnızca serbest
    // sürüklemenin ne zaman kart oynatacağını belirler.
    button.click();
    return;
  }

  resetDrag(button);
  if (moved) armTrustedClickSuppression(button);
}

document.addEventListener('click', (event) => {
  const button = cardButton(event.target);
  if (!button || button !== suppressTrustedClick || !event.isTrusted) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  suppressTrustedClick = null;
}, true);

document.addEventListener('dragstart', (event) => {
  if (cardButton(event.target)) event.preventDefault();
}, true);

document.addEventListener('pointerdown', (event) => {
  const button = cardButton(event.target);
  if (!isPlayable(button) || (event.pointerType === 'mouse' && event.button !== 0)) return;

  const styles = window.getComputedStyle(button);
  activeDrag = {
    button,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    lastX: event.clientX,
    lastY: event.clientY,
    baseX: cssNumber(styles.getPropertyValue('--pisti-x')),
    baseY: cssNumber(styles.getPropertyValue('--pisti-y')),
    rotation: cssNumber(styles.getPropertyValue('--pisti-rot')),
    distance: 0,
  };
  button.setPointerCapture?.(event.pointerId);
  button.classList.add('pisti-el-kart-suruklenen');
  event.preventDefault();
}, true);

document.addEventListener('pointermove', (event) => {
  const drag = activeDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  drag.lastX = event.clientX;
  drag.lastY = event.clientY;
  applyDragPosition(drag);
  event.preventDefault();
}, true);

document.addEventListener('pointerup', finishDrag, true);
document.addEventListener('pointercancel', (event) => finishDrag(event, true), true);
