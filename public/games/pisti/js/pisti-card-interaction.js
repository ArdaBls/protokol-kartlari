const DRAG_PLAY_DISTANCE = 58;
const CENTER_DROP_DISTANCE = 112;
const ANIMATION_MS = 340;

let activeDrag = null;
let suppressTrustedClick = null;
let suppressTrustedClickTimer = null;

function cardButton(target) {
  return target instanceof Element ? target.closest('[data-pisti-oyna]') : null;
}

function isPlayable(button) {
  return button instanceof HTMLButtonElement && !button.disabled;
}

function centerPoint(rect) {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
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
  clone.style.opacity = '0.96';
  document.body.appendChild(clone);

  const deltaX = finish.x - start.x;
  const deltaY = finish.y - start.y;
  requestAnimationFrame(() => {
    clone.style.transform = `translate3d(${deltaX}px, ${deltaY}px, 0) rotate(${(Math.random() * 14 - 7).toFixed(2)}deg)`;
    clone.style.opacity = '0.18';
  });
  window.setTimeout(() => clone.remove(), ANIMATION_MS + 80);
}

function resetDrag(button) {
  button.classList.remove('pisti-el-kart-suruklenen');
  button.style.removeProperty('--pisti-drag-x');
  button.style.removeProperty('--pisti-drag-y');
}

function shouldPlay(drag) {
  const dx = drag.lastX - drag.startX;
  const dy = drag.lastY - drag.startY;
  const distance = Math.hypot(dx, dy);
  const target = document.querySelector('[data-pisti-masa-kartlari]');
  const targetRect = target?.getBoundingClientRect();
  const nearCenter = targetRect &&
    drag.lastX >= targetRect.left - CENTER_DROP_DISTANCE &&
    drag.lastX <= targetRect.right + CENTER_DROP_DISTANCE &&
    drag.lastY >= targetRect.top - CENTER_DROP_DISTANCE &&
    drag.lastY <= targetRect.bottom + CENTER_DROP_DISTANCE;
  return dy < -DRAG_PLAY_DISTANCE || (distance > DRAG_PLAY_DISTANCE && nearCenter);
}

function finishDrag(event, cancelled = false) {
  const drag = activeDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  activeDrag = null;
  const button = drag.button;
  button.releasePointerCapture?.(drag.pointerId);
  const play = !cancelled && shouldPlay(drag);

  if (play) {
    animateCardToCenter(button);
    suppressTrustedClick = button;
    if (suppressTrustedClickTimer) window.clearTimeout(suppressTrustedClickTimer);
    suppressTrustedClickTimer = window.setTimeout(() => {
      suppressTrustedClick = null;
    }, 900);
    resetDrag(button);
    // The existing game handler remains the single source of truth for the
    // Firebase transaction; dragging only decides when to invoke that action.
    button.click();
    return;
  }

  resetDrag(button);
}

document.addEventListener('click', (event) => {
  const button = cardButton(event.target);
  if (!button || button !== suppressTrustedClick) return;
  if (event.isTrusted) {
    event.preventDefault();
    event.stopImmediatePropagation();
    suppressTrustedClick = null;
  }
}, true);

document.addEventListener('pointerdown', (event) => {
  const button = cardButton(event.target);
  if (!isPlayable(button)) return;
  activeDrag = {
    button,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    lastX: event.clientX,
    lastY: event.clientY,
  };
  button.setPointerCapture?.(event.pointerId);
  button.classList.add('pisti-el-kart-suruklenen');
}, true);

document.addEventListener('pointermove', (event) => {
  const drag = activeDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  drag.lastX = event.clientX;
  drag.lastY = event.clientY;
  drag.button.style.setProperty('--pisti-drag-x', `${event.clientX - drag.startX}px`);
  drag.button.style.setProperty('--pisti-drag-y', `${event.clientY - drag.startY}px`);
  event.preventDefault();
}, true);

document.addEventListener('pointerup', finishDrag, true);
document.addEventListener('pointercancel', (event) => finishDrag(event, true), true);
