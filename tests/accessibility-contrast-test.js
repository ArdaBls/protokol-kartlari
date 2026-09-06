const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '../docs/admin-src');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const authPages = [
  ['production/giris.html', 'login-error', ['email', 'password']],
  ['production/kayit-ol.html', 'signup-error', ['firstName', 'lastName', 'email', 'password']],
  ['production/kilit-ekrani.html', 'lock-error', ['password']]
];

for (const [file, errorId, inputIds] of authPages) {
  const html = read(file);
  const alert = html.match(new RegExp(`<div[^>]*id="${errorId}"[^>]*>`))?.[0] || '';
  assert.match(alert, /role="alert"/);
  assert.match(alert, /aria-live="assertive"/);
  assert.doesNotMatch(alert, /display\s*:\s*none/);
  for (const inputId of inputIds) {
    const input = html.match(new RegExp(`<input[^>]*id="${inputId}"[^>]*>`))?.[0] || '';
    assert.match(input, new RegExp(`aria-describedby="[^"]*${errorId}[^"]*"`));
  }
}

function luminance(hex) {
  return hex.match(/../g).map(pair => parseInt(pair, 16) / 255)
    .map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
}
function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}
const tokens = read('src/scss/v4/_tokens.scss');
const light = tokens.slice(0, tokens.indexOf('[data-theme="dark"]'));
const dark = tokens.slice(tokens.indexOf('[data-theme="dark"]'));
const token = (source, name) => source.match(new RegExp(`--${name}:\\s*#([0-9a-f]{6})`, 'i'))[1];
for (const bg of ['ffffff', 'f9fafb', 'f5f7fb']) {
  assert.ok(contrast(token(light, 'text-muted'), bg) >= 4.5, `açık tema muted/${bg} kontrastı AA olmalı`);
  assert.ok(contrast(token(light, 'focus-ring'), bg) >= 3, `açık tema focus/${bg} kontrastı 3:1 olmalı`);
}
for (const bg of ['1a2332', '141d2b', '0f1623']) {
  assert.ok(contrast(token(dark, 'text-muted'), bg) >= 4.5, `koyu tema muted/${bg} kontrastı AA olmalı`);
  assert.ok(contrast(token(dark, 'focus-ring'), bg) >= 3, `koyu tema focus/${bg} kontrastı 3:1 olmalı`);
}
const scss = fs.readdirSync(path.join(root, 'src/scss/v4')).filter(f => f.endsWith('.scss'))
  .map(f => read('src/scss/v4/' + f)).join('\n');
assert.doesNotMatch(scss, /[^{}]*focus[^{}]*\{[^{}]*box-shadow:[^;}]*var\(--primary-lt\)/i,
  'odak seçicisinde soluk primary-lt halkası kalmamalı');
console.log('PASS: form hata duyuruları ile açık/koyu tema odak ve metin kontrastı');
