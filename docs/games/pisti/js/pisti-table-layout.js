import { n as dbPath, o as onDbModeChange, r as initDbMode } from './db-mode-F_jprkvV.js';

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDOfhq3aYW6sg2_zj0sFsRzXeGziGtLxCk',
  authDomain: 'omu-protokol.firebaseapp.com',
  databaseURL: 'https://omu-protokol-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'omu-protokol',
};
const TABLE_PATH = 'pisti/masalar/ana-masa';
const RANK_CODES = {
  as: '01',
  2: '02',
  3: '03',
  4: '04',
  5: '05',
  6: '06',
  7: '07',
  8: '08',
  9: '09',
  10: '10',
  joker: '11',
  kiz: '12',
  papaz: '13',
};

let database = null;
let tableRef = null;
let tableListener = null;
let activePath = '';
let currentTable = null;
let renderFrame = 0;

function cardsFrom(table) {
  return Array.isArray(table?.masaKartlari) ? table.masaKartlari : [];
}

function pileSignature(table) {
  const cards = cardsFrom(table);
  return `${table?.elNo ?? 0}:${cards.map((card) => `${card?.r ?? ''}-${card?.s ?? ''}`).join('|')}`;
}

function stableNumber(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function stackPosition(card, index, table) {
  const seed = stableNumber(`${table?.elNo ?? 0}:${index}:${card?.r ?? ''}:${card?.s ?? ''}`);
  const horizontal = ((seed & 15) - 7.5) * 0.72 + ((index % 4) - 1.5) * 1.9;
  const vertical = (((seed >>> 4) & 15) - 7.5) * 0.44 + ((index % 3) - 1) * 1.35;
  const rotation = (((seed >>> 8) & 31) - 15.5) * 0.28;
  return { horizontal, vertical, rotation };
}

function cardSource(card) {
  const rank = RANK_CODES[card?.r] || '01';
  return `/assets/blackjack/kartlar/varsayilan/temel/${rank}-${card?.r || 'as'}-${card?.s || 'kupa'}.png`;
}

function renderStablePile() {
  renderFrame = 0;
  const layer = document.querySelector('[data-pisti-masa-kartlari]');
  if (!layer) return;

  const signature = pileSignature(currentTable);
  if (layer.dataset.pistiStablePile === signature) return;

  const cards = cardsFrom(currentTable);
  const fragment = document.createDocumentFragment();
  if (!cards.length) {
    const empty = document.createElement('div');
    empty.className = 'pisti-masa-bos';
    empty.textContent = 'Masa boş';
    fragment.append(empty);
  } else {
    cards.forEach((card, index) => {
      const image = document.createElement('img');
      const position = stackPosition(card, index, currentTable);
      image.className = 'pisti-kart pisti-masa-sabit-kart';
      image.src = cardSource(card);
      image.alt = `${card.r || ''} ${card.s || ''}`.trim();
      image.draggable = false;
      image.decoding = 'async';
      image.style.setProperty('--pisti-stack-x', `${position.horizontal.toFixed(2)}px`);
      image.style.setProperty('--pisti-stack-y', `${position.vertical.toFixed(2)}px`);
      image.style.setProperty('--pisti-stack-rot', `${position.rotation.toFixed(2)}deg`);
      image.style.zIndex = String(index + 1);
      fragment.append(image);
    });
  }

  layer.replaceChildren(fragment);
  layer.dataset.pistiStablePile = signature;
  layer.dataset.pistiKartSayisi = String(cards.length);
}

function scheduleStablePile() {
  if (renderFrame || !currentTable) return;
  renderFrame = window.requestAnimationFrame(renderStablePile);
}

function observeGameRenderer() {
  const layer = document.querySelector('[data-pisti-masa-kartlari]');
  if (!layer) return;

  new MutationObserver(() => {
    if (layer.dataset.pistiStablePile !== pileSignature(currentTable)) {
      scheduleStablePile();
    }
  }).observe(layer, { childList: true, subtree: true });
}

function subscribeToTable() {
  if (!database) return;
  const path = dbPath(TABLE_PATH);
  if (path === activePath) return;

  if (tableRef && tableListener) tableRef.off('value', tableListener);
  activePath = path;
  tableRef = database.ref(path);
  tableListener = (snapshot) => {
    currentTable = snapshot.val() || { elNo: 0, masaKartlari: [] };
    scheduleStablePile();
  };
  tableRef.on('value', tableListener);
}

async function start() {
  const firebase = globalThis.firebase;
  if (!firebase) return;

  if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
  database = firebase.database();
  observeGameRenderer();

  firebase.auth().onAuthStateChanged(async (user) => {
    if (!user) {
      if (tableRef && tableListener) tableRef.off('value', tableListener);
      tableRef = null;
      tableListener = null;
      activePath = '';
      currentTable = { elNo: 0, masaKartlari: [] };
      scheduleStablePile();
      return;
    }

    await initDbMode(database);
    subscribeToTable();
  });
  onDbModeChange(subscribeToTable);
}

start();
