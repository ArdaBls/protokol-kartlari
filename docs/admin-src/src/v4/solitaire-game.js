// Pasyans (Klondike Solitaire) -- kullanıcı isteği: "Oyunlar klasörüne
// GitHub'da ücretsiz, tam bir oyun (iframe değil, kendi sitemizde) Solitaire
// koyalım". Oyun mantığı/CSS'i rjanjic/js-solitaire (MIT lisans) projesinden
// PORTLANDI, verbatim kopya DEĞİL -- iki değişiklik dışında birebir:
//   1. Mobil dokunma desteği: orijinali SADECE mouse event'leri (onmousedown/
//      onmousemove/onmouseup) kullanıyordu, telefonda sürükleme çalışmıyordu.
//      Burada Pointer Events'e çevrildi (satranç tahtasındaki chessground'un
//      kendi yaklaşımıyla tutarlı) -- mouse/dokunma/kalem tek API'den.
//   2. Duyarlı (responsive) ölçekleme: orijinali sabit 671px genişlikti, dar
//      ekranda taşardı (bu oturumda birkaç "sayfa dışına taşıyor" hatası
//      düzeltildi, aynı hatayı yeni oyunla tekrar eklemek istemedik) --
//      fitToViewport() ile pencere gerektiğinde küçültülüyor.
// Kaynak: https://github.com/rjanjic/js-solitaire (Radovan Janjic, MIT).
// CSS sınıfları admin panelinin KENDİ genel sınıflarıyla (özellikle ".card"
// -- bu panelde her yerde kart bileşeni için kullanılıyor) çakışmasın diye
// tamamı "pas-" öneki ile yeniden adlandırıldı (bkz. _solitaire.scss).
import { SOLITAIRE_SPRITE } from './solitaire-sprite.js';

export function initSolitaire() {
  const gameEl = document.getElementById('js-solitaire');
  const dealPileEl = document.getElementById('js-deck-pile');
  const dealEl = document.getElementById('js-deck-deal');
  const finishContainerEl = document.getElementById('js-finish');
  const deskContainerEl = document.getElementById('js-board');
  const deckPileEl = document.getElementById('js-deck-pile');
  const resetEl = document.getElementById('js-reset');
  const scaleWrapEl = document.getElementById('js-pas-scale-wrap');
  const windowEl = document.getElementById('js-pas-window');
  if (!gameEl) { return; }

  const cardWidth = 71;
  const cardHeight = 96;
  const state = {
    types: ['c', 'd', 'h', 's'],
    colors: { c: 0, d: 1, h: 1, s: 0 },
    cards: [],
    deal: {
      pile: { el: null, cards: [] },
      deal: { el: null, cards: [] }
    },
    finish: [],
    desk: [],
    target: null,
    moving: {
      card: {},
      element: null,
      index: -1,
      capture: false,
      container: { cards: [] },
      target: null,
      origin: {},
      offset: { x: 0, y: 0 },
      destinations: [],
      originalParent: null,
      originalNextSibling: null
    }
  };

  // fitToViewport()'un hesapladığı güncel ölçek -- sürüklenen kart
  // document.body'ye taşındığında görsel boyutunu korumak için kullanılıyor.
  let currentScale = 1;

  const getCard = (index) => state.cards[index];

  const faceUp = (card) => {
    state.cards[card].facingUp = true;
    requestAnimationFrame(() => {
      state.cards[card].el.classList.add('pas-card--front');
      state.cards[card].el.classList.remove('pas-card--back');
    });
  };

  const faceDown = (card) => {
    state.cards[card].facingUp = false;
    state.cards[card].el.classList.remove('pas-card--front');
    state.cards[card].el.classList.add('pas-card--back');
  };

  const faceUpLastOnDesk = (index) => {
    const card = getLastOnDesk(index);
    if (card !== null) { faceUp(card); }
  };

  const appendToCard = (target, card) => {
    state.cards[target].el.appendChild(state.cards[card].el);
  };

  const appendToDesk = (desk, card) => {
    state.desk[desk].el.appendChild(state.cards[card].el);
  };

  const getLastOnDesk = (desk) => {
    const l = state.desk[desk].cards.length;
    if (l > 0) { return state.desk[desk].cards[l - 1]; }
    return null;
  };

  const getLastOnPile = (pile, index) => {
    const l = state[pile][index].cards.length;
    if (l > 0) {
      const card = state[pile][index].cards[l - 1];
      return state.cards[card];
    }
    return {};
  };

  const getCardLocation = (card) => {
    for (let i = 0; i < 7; i++) {
      const index = state.desk[i].cards.indexOf(card);
      if (index > -1) { return { location: 'desk', pile: i, index }; }
    }
    for (let i = 0; i < 4; i++) {
      const index = state.finish[i].cards.indexOf(card);
      if (index > -1) { return { location: 'finish', pile: i, index }; }
    }
    for (const i of ['deal', 'pile']) {
      const index = state.deal[i].cards.indexOf(card);
      if (index > -1) { return { location: 'deal', pile: i, index }; }
    }
    return undefined;
  };

  const getSubCards = (card) => {
    const { location, pile, index } = getCardLocation(card);
    return state[location][pile].cards.filter((elem, i, array) => array.indexOf(elem) > index);
  };

  const getPile = (pile, index) => state[pile][index];

  const moveCardTo = (dest, i, card) => {
    const { location, pile, index } = getCardLocation(card);
    const moving = state[location][pile].cards.filter((elem, i2, array) => array.indexOf(elem) >= index);
    state[location][pile].cards = state[location][pile].cards.filter((elem) => moving.indexOf(elem) === -1);
    state[dest][i].cards = state[dest][i].cards.concat(moving);
  };

  const canBePlacedOnCard = (child, parent) => {
    const { type, number } = getCard(child);
    const { type: parentType, number: parentNumber } = getCard(parent);
    return (parentNumber - 1) === number && state.colors[parentType] !== state.colors[type];
  };

  const placeCardTo = (dest, index, card) => {
    function remove(array, element) {
      const idx = array.indexOf(element);
      if (idx !== -1) { array.splice(idx, 1); }
    }
    state[dest][index].cards.push(card);
    remove(state.deal.pile.cards, card);
  };

  function dealCards() {
    let card = 0;
    for (let i = 0; i < 7; i++) {
      for (let j = i; j < 7; j++) {
        const last = getLastOnDesk(j);
        if (last !== null) { appendToCard(last, card); } else { appendToDesk(j, card); }
        placeCardTo('desk', j, card);
        if (j === i) { faceUp(card); }
        card++;
      }
    }
  }

  function resetGame() {
    for (let i = 0; i < 7; i++) { state.desk[i].cards = []; }
    for (let i = 0; i < 4; i++) { state.finish[i].cards = []; }
    state.deal.pile.cards = [];
    state.deal.deal.cards = [];

    state.cards.sort(() => (Math.random() < 0.5 ? -1 : 1));

    requestAnimationFrame(() => {
      for (let i = 0, l = state.cards.length; i < l; i++) {
        const { facingUp, el } = state.cards[i];
        state.deal.pile.cards.push(i);

        el.addEventListener('pointerdown', captureMove(i));
        el.addEventListener('pointerup', releaseMove);
        el.onclick = handleClick(i);

        if (facingUp) { faceDown(i); }
        dealPileEl.appendChild(el);
      }
      dealCards();
    });
  }

  const handleClick = (index) => (event) => {
    event.stopPropagation();
    const { el, facingUp } = getCard(index);

    if (state.moving.capture) { return; }
    releaseMove();

    if (facingUp) {
      const { location, pile } = getCardLocation(index);

      if (location === 'deal' && pile === 'deal') {
        const { el: lastEl } = getLastOnPile('deal', 'deal');
        if (el !== lastEl) { return; }
      }

      const destinations = getAvailableDestinations(index, true);

      if (destinations.length > 0) {
        const { target, el: targetEl } = destinations[0];
        const { dest: destTarget, pile: pileTarget, card: cardTarget } = target;

        moveCardTo(destTarget, pileTarget, cardTarget);

        if (location === 'desk') { faceUpLastOnDesk(pile); }
        targetEl.appendChild(el);
      } else {
        return;
      }
      gameFinish();
    } else {
      const { location, pile } = getCardLocation(index);
      if (location === 'deal' && pile === 'pile') {
        const max = state.deal.pile.cards.length - 1;
        const min = Math.max(-1, max - 3);

        for (let i = max; i > min; i--) {
          const card = state.deal.pile.cards[i];
          const { el: cardEl } = getCard(card);
          faceUp(card);
          moveCardTo('deal', 'deal', card);
          dealEl.appendChild(cardEl);
        }
      }
    }
  };

  function restartDeal() {
    state.deal.pile.cards = state.deal.deal.cards;
    state.deal.deal.cards = [];

    for (const card of state.deal.pile.cards) {
      const { el } = getCard(card);
      faceDown(card);
      deckPileEl.appendChild(el);
    }
  }

  function getPointerPosition(event) {
    // clientX/Y (viewport-göreli) kullanılıyor -- .pas-card--moving position:fixed,
    // ve dropCard() hedefleri getBoundingClientRect() (viewport-göreli) ile
    // karşılaştırıyor; pageX/Y (döküman-göreli) kaydırma varsa tutarsızlık yaratırdı.
    return { x: event.clientX, y: event.clientY };
  }

  const handleMove = (event) => {
    if (state.moving.capture) {
      const el = state.moving.element;
      const { x, y } = getPointerPosition(event);

      el.style.left = `${x - state.moving.offset.x}px`;
      el.style.top = `${y - state.moving.offset.y}px`;
    }
  };

  const startMovingPosition = (event) => {
    const el = state.moving.element;
    const { x, y } = getPointerPosition(event);
    const { top, left } = el.getBoundingClientRect();

    // Kart, .pas-window'un transform:scale() ile küçültülen dalından TAMAMEN
    // document.body'ye taşınıyor -- CSS transform'lu bir atanın, position:fixed
    // torunları için (viewport yerine) YENİ bir containing block oluşturması,
    // pencere mobilde küçültüldüğünde kartın parmaktan kopup sitenin ortasına
    // zıplamasına yol açıyordu. Kart artık kendi transform:scale()'i ile aynı
    // görsel boyutta çiziliyor, alt kartlar (nested pas-card'lar) da parçası
    // olduğu için birlikte taşınıp ölçekleniyor.
    state.moving.originalParent = el.parentNode;
    state.moving.originalNextSibling = el.nextSibling;
    document.body.appendChild(el);

    el.classList.add('pas-card--moving');
    el.style.transformOrigin = 'top left';
    el.style.transform = currentScale < 1 ? `scale(${currentScale})` : '';

    state.moving.offset = { x: x - left, y: y - top };

    el.style.left = `${x - state.moving.offset.x}px`;
    el.style.top = `${y - state.moving.offset.y - 5}px`;
  };

  let moving;
  const captureMove = (index) => (event) => {
    event.preventDefault();
    event.stopPropagation();
    const { el, facingUp } = getCard(index);
    if (facingUp) {
      const { location, pile } = getCardLocation(index);
      if (location === 'deal' && pile === 'deal') {
        const { el: lastEl } = getLastOnPile('deal', 'deal');
        if (el !== lastEl) { return false; }
      }
      moving = setTimeout(() => {
        state.moving.element = event.target;
        state.moving.capture = true;
        state.moving.index = index;
        state.moving.card = getCard(index);
        state.moving.origin = getCardLocation(index);

        startMovingPosition(event);

        const destinations = getAvailableDestinations(index);
        state.moving.destinations = destinations;

        for (const dest of destinations) { dest.el.classList.add('pas-finish-dest'); }

        for (let i = 0, l = destinations.length; i < l; i++) {
          const { top, left, width, height } = destinations[i].el.getBoundingClientRect();
          state.moving.destinations[i].offset = { top, left, width, height };
        }
      }, 200);
    }
    return undefined;
  };

  const dropCard = (x, y) => {
    let moved = false;
    for (const destination of state.moving.destinations) {
      const { width, height, left, top } = destination.offset;
      destination.el.classList.remove('pas-finish-dest');
      if ((x > left && x < left + width) && (y > top && y < top + height)) {
        const { dest, pile, card } = destination.target;
        moveCardTo(dest, pile, card);

        destination.el.appendChild(state.moving.element);
        moved = true;

        gameFinish();

        const { location: originLocation, pile: originPile } = state.moving.origin;
        if (originLocation === 'desk') { faceUpLastOnDesk(originPile); }
      }
    }
    return moved;
  };

  let release;
  const releaseMove = (event) => {
    clearTimeout(moving);
    clearTimeout(release);
    if (state.moving.capture) {
      release = setTimeout(() => {
        const { x, y } = getPointerPosition(event);
        requestAnimationFrame(() => {
          const moved = dropCard(x, y);
          if (!moved) {
            const { originalParent, originalNextSibling } = state.moving;
            if (originalParent) { originalParent.insertBefore(state.moving.element, originalNextSibling); }
          }

          state.moving.element.classList.remove('pas-card--moving');
          state.moving.element.style.left = '';
          state.moving.element.style.top = '';
          state.moving.element.style.transform = '';
          state.moving.element.style.transformOrigin = '';
          state.moving.element = null;
          state.moving.capture = false;
        });
      }, 100);
    }
  };

  const getAvailableDestinations = (index, first = false) => {
    const { type, number } = getCard(index);
    const destinations = [];
    if (number === 1) {
      for (let i = 0; i < 4; i++) {
        const { cards, el } = getPile('finish', i);
        if (cards.length === 0) {
          destinations.push({ el, target: { dest: 'finish', pile: i, card: index } });
          if (first) { return destinations; }
        }
      }
    }
    const subCards = getSubCards(index);
    if (!(subCards.length > 0)) {
      for (let i = 0; i < 4; i++) {
        const l = state.finish[i].cards.length;
        if (l + 1 === number) {
          const { type: lastType } = getLastOnPile('finish', i);
          if (lastType === type) {
            destinations.push({ el: state.finish[i].el, target: { dest: 'finish', pile: i, card: index } });
            if (first) { return destinations; }
            break;
          }
        }
      }
    }
    for (let i = 0; i < 7; i++) {
      const last = getLastOnDesk(i);
      if (last !== null) {
        if (canBePlacedOnCard(index, last)) {
          destinations.push({ el: state.cards[last].el, target: { dest: 'desk', pile: i, card: index } });
          if (first) { return destinations; }
        }
      } else if (number === 13) {
        destinations.push({ el: state.desk[i].el, target: { dest: 'desk', pile: i, card: index } });
        if (first) { return destinations; }
      }
    }
    return destinations;
  };

  const gameFinish = () => {
    for (let i = 3; i >= 0; i--) {
      const l = state.finish[i].cards.length;
      if (l < 13) { return; }
    }
    const { width, height, left, top } = gameEl.getBoundingClientRect();
    win(width, height, left, top);
  };

  const win = (canvasWidth, canvasHeight, canvasLeft, canvasTop) => {
    const image = document.createElement('img');
    image.src = SOLITAIRE_SPRITE;
    const canvas = document.createElement('canvas');
    canvas.style.position = 'absolute';
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    gameEl.appendChild(canvas);

    const context = canvas.getContext('2d');
    let card = 52;
    const particles = [];

    const drawCard = (x, y, spriteX, spriteY) => {
      context.drawImage(image, spriteX, spriteY, cardWidth, cardHeight, x, y, cardWidth, cardHeight);
    };

    const Particle = function (id, x, y, sx, sy) {
      if (sx === 0) { sx = 2; }
      const spriteX = (id % 4) * cardWidth;
      const spriteY = Math.floor(id / 4) * cardHeight;

      drawCard(x, y, spriteX, spriteY);

      this.update = () => {
        x += sx;
        y += sy;

        if (x < -cardWidth || x > (canvas.width + cardWidth)) {
          const index = particles.indexOf(this);
          particles.splice(index, 1);
          return false;
        }

        if (y > canvas.height - cardHeight) {
          y = canvas.height - cardHeight;
          sy = -sy * 0.85;
        }
        sy += 0.98;

        drawCard(Math.floor(x), Math.floor(y), spriteX, spriteY);
        return true;
      };
    };

    const throwCard = (x, y) => {
      if (card < 1) { return; }
      card--;
      const particle = new Particle(card, x, y, Math.floor(Math.random() * 6 - 3) * 2, -Math.random() * 16);
      particles.push(particle);
    };

    const throwInterval = [];
    for (let i = 0; i < 4; i++) {
      const { left, top } = state.finish[i].el.getBoundingClientRect();
      throwInterval[i] = setInterval(() => { throwCard(left - canvasLeft, top - canvasTop); }, 1000);
    }

    const updateInterval = setInterval(() => {
      let i = 0; let l = particles.length;
      while (i < l) {
        particles[i].update() ? i++ : l--;
      }
    }, 1000 / 60);

    function removeAnimation(event) {
      event.preventDefault();
      clearInterval(updateInterval);
      for (let i = 0; i < 4; i++) { clearInterval(throwInterval[i]); }
      canvas.parentNode.removeChild(canvas);
      document.removeEventListener('click', removeAnimation);
    }
    document.addEventListener('click', removeAnimation, false);
  };

  // Kullanıcı isteği: dar ekranda (telefon) 671px'lik sabit pencere sayfayı
  // yatayda taşırmasın -- gerektiğinde küçültülüp (transform: scale) ortalanır.
  // transform layout kutusunu KÜÇÜLTMEZ (sadece boyanır), bu yüzden sarmalayıcının
  // yüksekliği elle scale ile çarpılıp ayarlanıyor (aksi halde altta boşluk kalırdı).
  function fitToViewport() {
    if (!scaleWrapEl || !windowEl) { return; }
    windowEl.style.transform = '';
    const naturalWidth = windowEl.offsetWidth;
    const naturalHeight = windowEl.offsetHeight;
    const available = scaleWrapEl.clientWidth;
    const scale = naturalWidth > 0 ? Math.min(1, available / naturalWidth) : 1;
    currentScale = scale;
    windowEl.style.transform = scale < 1 ? `scale(${scale})` : '';
    scaleWrapEl.style.height = `${naturalHeight * scale}px`;
  }
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(fitToViewport, 100);
  });

  // add sprite
  const css = document.createElement('style');
  const styles = `.pas-card--front { background-image: url("${SOLITAIRE_SPRITE}"); }`;
  css.appendChild(document.createTextNode(styles));
  document.head.appendChild(css);

  // create all cards
  for (let i = 0; i < 4; i++) {
    for (let j = 1; j <= 13; j++) {
      const el = document.createElement('div');
      el.classList.add('pas-card', `pas-card--${state.types[i]}-${j}`, 'pas-card--back');
      state.cards.push({ el, type: state.types[i], number: j, facingUp: false });
    }
  }

  // create aces decks
  for (let i = 0; i < 4; i++) {
    const el = document.createElement('div');
    el.classList.add('pas-aces', `pas-aces--${i}`);
    state.finish.push({ el, cards: [] });
    finishContainerEl.appendChild(el);
  }

  // create desk decks
  for (let i = 0; i < 7; i++) {
    const el = document.createElement('div');
    el.classList.add('pas-seven', `pas-seven--${i}`);
    state.desk.push({ el, cards: [] });
    deskContainerEl.appendChild(el);
  }

  dealPileEl.onclick = restartDeal;
  resetEl.onclick = resetGame;
  window.addEventListener('pointermove', handleMove);
  window.addEventListener('pointerup', releaseMove);

  resetGame();
  requestAnimationFrame(fitToViewport);
}
