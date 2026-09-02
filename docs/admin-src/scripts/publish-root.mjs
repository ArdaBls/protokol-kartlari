// Vite'ı docs/ köküne DOĞRUDAN build ettirmek tehlikeli (outDir=docs/ + emptyOutDir:true, docs/
// altındaki admin-src/ kaynağını -- yani kendi build'ini tetikleyen script dahil -- silmeye
// çalışırdı). Bunun yerine vite.config.js her zamanki gibi GÜVENLİ, izole bir klasöre
// (../../admin, yani docs/admin/) build ediyor; bu script build'den SONRA çalışıp o klasörün
// içeriğini docs/ köküne TAŞIR ve docs/admin/ klasörünü siler.
//
// Kullanıcı isteği: sitenin TÜM html/css/js dosyaları (hem elle yazılmış protokol.html/app.js/
// style.css hem admin panelinin derleme çıktısı hem admin-src kaynağının kendisi) tek bir
// docs/ klasöründe, düzenli dursun -- ama URL'lerde hâlâ /docs önek yolu GÖRÜNMESİN. Bu, GitHub
// Pages'in native desteklediği iki kaynak seçeneğinden biri (kök veya /docs) kullanılarak
// çözülüyor: Settings → Pages → Folder: /docs seçilince docs/ içeriği protokol.sbs'in KÖKÜNDEN
// yayınlanıyor (protokol.sbs/giris.html, /docs/giris.html DEĞİL).
//
// docs/ İÇİNDE SADECE bu izin listesindeki dosya/klasörler kalmalı -- geri kalan HER ŞEY (eski
// derleme çıktıları, artık kullanılmayan eski sayfalar) her build'de silinip docs/admin/'in
// güncel içeriğiyle değiştiriliyor. Böylece docs/ içinde asla eski/öksüz dosya birikmez.
import { readdirSync, rmSync, cpSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const DOCS_ROOT = resolve(import.meta.dirname, '..', '..');
const STAGING = resolve(DOCS_ROOT, 'admin');

// docs/ kökünde DOKUNULMAYACAK dosya/klasörler -- protokol.html'in kendi statik dosyaları,
// GitHub Pages'in custom domain dosyası, ve admin-src kaynağının KENDİSİ (bu script de onun
// içinde yaşıyor -- silinirse kendi build'ini tamamlayamaz).
const KEEP = new Set([
  'protokol.html', 'app.js', 'style.css', 'manifest.json',
  'icon-192.png', 'icon-512.png', 'CNAME', 'admin-src',
  'admin' // 'admin' (staging) -- kendisi taşınıp sonda ayrıca silinecek
]);

if (!existsSync(STAGING)) {
  console.error('publish-root: ../../admin (staging) bulunamadı -- önce `npm run build` çalışmalı.');
  process.exit(1);
}

for (const entry of readdirSync(DOCS_ROOT)) {
  if (KEEP.has(entry)) continue;
  rmSync(resolve(DOCS_ROOT, entry), { recursive: true, force: true });
  console.log('silindi:', entry);
}

cpSync(STAGING, DOCS_ROOT, { recursive: true });
rmSync(STAGING, { recursive: true, force: true });

console.log('publish-root: docs/admin/ içeriği docs/ köküne taşındı, docs/admin/ klasörü kaldırıldı.');
