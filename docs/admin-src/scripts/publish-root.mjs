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
import { readdirSync, rmSync, cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DOCS_ROOT = resolve(import.meta.dirname, '..', '..');
const STAGING = resolve(DOCS_ROOT, 'admin');

// docs/ kökünde DOKUNULMAYACAK dosya/klasörler -- protokol.html'in kendi statik dosyaları,
// GitHub Pages'in custom domain dosyası, ve admin-src kaynağının KENDİSİ (bu script de onun
// içinde yaşıyor -- silinirse kendi build'ini tamamlayamaz).
const KEEP = new Set([
  'protokol.html', 'app.js', 'style.css',
  'CNAME', 'admin-src',
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

// GÜVENLİK KATMANI (kullanıcının veri kaybı bulgusu üzerine eklendi): cpSync STAGING'i
// DOCS_ROOT'un üzerine kopyalarken varsayılan olarak OVERWRITE eder -- yukarıdaki KEEP
// listesi sadece SİLME aşamasını korur, cpSync'in üzerine YAZMASINI engellemez. admin-src
// içindeki bir Vite sayfası (örn. production/protokol.html) KEEP'teki bir isimle çakışırsa
// (protokol.html/app.js/style.css), STAGING'deki derlenmiş hali ROOT'taki ELLE YAZILMIŞ
// dosyanın üzerine sessizce yazılırdı -- gerçekte yaşandı (bkz. git geçmişi, 10 Eylül 2026).
// STAGING'den bu isimleri kopyalamadan ÖNCE kaldırarak KEEP dosyalarını cpSync'ten de korur.
for (const entry of KEEP) {
  if (entry === 'admin') continue; // STAGING'in kendisi, aşağıda zaten siliniyor
  const staged = resolve(STAGING, entry);
  if (existsSync(staged)) {
    rmSync(staged, { recursive: true, force: true });
    console.log('STAGING\'den korundu (ROOT\'un üzerine yazılmayacak):', entry);
  }
}

cpSync(STAGING, DOCS_ROOT, { recursive: true });
rmSync(STAGING, { recursive: true, force: true });

// KEEP korumasının bilinen bir yan etkisi: protokol.html KEEP'te olduğu için bu build
// asla ONU güncellemiyor, ama admin panelinin main-v4 JS/CSS bundle'ları HER build'de
// içerik-hash'li yeni dosya adlarıyla üretiliyor -- protokol.html içindeki hardcoded
// <script src="/js/main-v4-HASH.js"> ve <link href="/assets/main-v4-HASH.css"> referansları
// eski hash'e bakmaya devam edip 404 verirdi, admin paneli TAMAMEN STİLSİZ görünürdü
// (gerçekte yaşandı 3 kez, en son 10 Eylül 2026 -- bkz. commit eedbadc, 7e759ec).
// Bu adım o senkronu OTOMATİK yapar, elle hatırlamaya bağımlı kalınmaz.
{
  const protokolPath = resolve(DOCS_ROOT, 'protokol.html');
  const jsDir = resolve(DOCS_ROOT, 'js');
  const assetsDir = resolve(DOCS_ROOT, 'assets');
  const guncelMainJs = existsSync(jsDir) ? readdirSync(jsDir).find((f) => /^main-v4-.*\.js$/.test(f)) : null;
  const guncelMainCss = existsSync(assetsDir) ? readdirSync(assetsDir).find((f) => /^main-v4-.*\.css$/.test(f)) : null;
  if (existsSync(protokolPath) && guncelMainJs && guncelMainCss) {
    let html = readFileSync(protokolPath, 'utf8');
    const yeniHtml = html
      .replace(/\/js\/main-v4-[^"']*\.js/, '/js/' + guncelMainJs)
      .replace(/\/assets\/main-v4-[^"']*\.css/, '/assets/' + guncelMainCss);
    if (yeniHtml !== html) {
      writeFileSync(protokolPath, yeniHtml);
      console.log('protokol.html main-v4 bundle referansları güncellendi:', guncelMainJs, guncelMainCss);
    }
  }
}

console.log('publish-root: docs/admin/ içeriği docs/ köküne taşındı, docs/admin/ klasörü kaldırıldı.');
