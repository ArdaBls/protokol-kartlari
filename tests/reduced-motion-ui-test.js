const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '../docs/admin-src');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const dashboard = read('src/scss/v4/_dashboard.scss');
const profile = read('production/profil.html');
const streakUi = read('src/v4/streak-ui.js');
const forms = read('src/scss/v4/_forms.scss');

assert.match(dashboard, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.streak-popup[\s\S]*?transition: none !important/);
assert.match(profile, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.achievement-popup[\s\S]*?transition: none !important/);
assert.match(streakUi, /class="streak-circles" aria-hidden="true"/);
const presets = forms.match(/\.dr-presets\s*\{[\s\S]*?\}/)?.[0] || '';
assert.match(presets, /border-inline-end:\s*1px solid var\(--border-color\)/);
assert.doesNotMatch(presets, /--border-color-light/);
console.log('PASS: popup hareket azaltma, dekoratif streak ve tarih ayırıcısı');
