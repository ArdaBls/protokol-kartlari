const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const html = fs.readFileSync(path.join(__dirname, '../docs/admin-src/production/sifremi-unuttum.html'), 'utf8');
assert.match(html, /firebase-app-compat\.js/);
assert.match(html, /firebase-auth-compat\.js/);
assert.match(html, /auth\.sendPasswordResetEmail\(email\)/, 'form gerçek Firebase parola sıfırlama çağrısını yapmalı');
assert.match(html, /id="reset-error"[^>]*role="alert"[^>]*aria-live="assertive"/);
assert.match(html, /id="email"[^>]*aria-describedby="reset-error"/);
assert.match(html, /id="reset-success"[^>]*role="status"[^>]*aria-live="polite"/);
assert.doesNotMatch(html, /The link expires in 30 minutes/, 'Firebase tarafından garanti edilmeyen süre sözü verilmemeli');
console.log('PASS: şifre sıfırlama formu gerçek Firebase Auth akışını kullanıyor');
