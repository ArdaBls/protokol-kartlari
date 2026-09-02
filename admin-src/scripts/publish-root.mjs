// Vite'ı repo köküne DOĞRUDAN build ettirmek tehlikeli (outDir=repo kökü + emptyOutDir:true
// tüm repoyu -- .git dahil -- silmeye çalışır). Bunun yerine vite.config.js her zamanki gibi
// GÜVENLİ, izole bir klasöre (../../admin, yani repo kökündeki admin/) build ediyor; bu script
// build'den SONRA çalışıp o klasörün içeriğini repo köküne TAŞIR ve admin/ klasörünü siler.
//
// Kullanıcı isteği: site artık /admin/production/ önekiyle değil, doğrudan repo kökünden
// (protokol.sbs/index.html, protokol.sbs/giris.html, ...) yayınlanıyor. Kökte SADECE elle
// yazılmış statik dosyalar (protokol.html + onun app.js/style.css'i) ve bu izin listesindeki
// klasörler kalmalı -- geri kalan HER ŞEY (eski derleme çıktıları, artık kullanılmayan eski
// admin.html/takvim.html/index.html) her build'de silinip admin/'in güncel içeriğiyle
// değiştiriliyor. Böylece kökte asla eski/öksüz dosya birikmez.
import { readdirSync, rmSync, cpSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');
const STAGING = resolve(REPO_ROOT, 'admin');

// Kökte DOKUNULMAYACAK dosya/klasörler -- protokol.html'in kendi statik dosyaları +
// proje altyapısı. Bunların DIŞINDAKİ her şey her build'de silinip yeniden üretiliyor.
const KEEP = new Set([
  'protokol.html', 'app.js', 'style.css', 'manifest.json',
  'icon-192.png', 'icon-512.png', 'CNAME', 'README.md', 'SECURITY.md', 'CLAUDE.md',
  '.gitignore', '.git', '.github', '.claude', 'admin-src', 'docs', 'scripts', 'tests',
  'node_modules', 'admin' // 'admin' (staging) -- kendisi taşınıp sonda ayrıca silinecek
]);

if (!existsSync(STAGING)) {
  console.error('publish-root: ../../admin (staging) bulunamadı -- önce `npm run build` çalışmalı.');
  process.exit(1);
}

for (const entry of readdirSync(REPO_ROOT)) {
  if (KEEP.has(entry)) continue;
  rmSync(resolve(REPO_ROOT, entry), { recursive: true, force: true });
  console.log('silindi:', entry);
}

cpSync(STAGING, REPO_ROOT, { recursive: true });
rmSync(STAGING, { recursive: true, force: true });

console.log('publish-root: admin/ içeriği repo köküne taşındı, admin/ klasörü kaldırıldı.');
