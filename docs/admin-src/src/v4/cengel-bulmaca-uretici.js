// Çengel bulmaca (klasik siyah/beyaz kutulu crossword) ızgara üretici -- HEM
// büyük (15x15) HEM mini (7x7) bulmaca için ortak, saf JS (Node script'inde de,
// tarayıcıda da çalışır -- fs/path gibi Node'a özgü hiçbir şey kullanmaz).
//
// Standart bir kelime-kesişim yerleştirme sezgiseli (greedy + rastgele deneme):
// en uzun kelimeden başlanır, sonraki her kelime zaten yerleşmiş bir harfle
// KESİŞECEK şekilde yerleştirilmeye çalışılır; komşu hücrelerde istenmeyen
// harf çakışması oluşmuyorsa kabul edilir. Bu genel bir bilgisayar bilimi
// tekniğidir (herhangi bir üçüncü taraf kodun kopyası değil, buraya özel
// yazıldı).

function harfleriAyir(kelime) { return Array.from(kelime); }

// Basit, hızlı, deterministik string hash + mulberry32 PRNG -- wordle.js'teki
// AYNI teknik (kasıtlı kopya, iki oyun birbirinden bağımsız kalsın diye
// paylaşılan bir yardımcı modül yok, bkz. proje kuralı: küçük yardımcılar
// dosyalar arası paylaşılmaz).
function seedliRng(seedStr) {
  let h = 2166136261;
  for (let i = 0; i < seedStr.length; i++) { h ^= seedStr.charCodeAt(i); h = Math.imul(h, 16777619); }
  h = h >>> 0;
  return function () {
    h = Math.imul(h ^ (h >>> 15), 1 | h);
    h = (h + Math.imul(h ^ (h >>> 7), 61 | h)) ^ h;
    h = (h ^ (h >>> 14)) >>> 0;
    return h / 4294967296;
  };
}
function karistir(dizi, rng) {
  const kopya = dizi.slice();
  for (let i = kopya.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [kopya[i], kopya[j]] = [kopya[j], kopya[i]];
  }
  return kopya;
}

// grid[r][c] = null (kullanılmamış/siyah) veya { harf, uzunlukId } -- uzunlukId
// yerleştirme sırasında hangi kelimeye ait olduğunu izlemek için değil, sadece
// debug amaçlı; asıl referans placedWords dizisinde tutulur.
function bosIzgara(boyut) {
  return Array.from({ length: boyut }, () => new Array(boyut).fill(null));
}

// Bir kelimeyi (row,col) konumundan başlayıp yön (0=yatay,1=dikey) boyunca
// yerleştirmenin GEÇERLİ olup olmadığını kontrol eder: sınır dışına taşmamalı,
// kesişen hücrelerde harf uyuşmalı, kesişmeyen hücreler boş olmalı VE o hücrenin
// DİK yönündeki komşuları da boş olmalı (yoksa istenmeyen bitişik kelime oluşur),
// kelimenin başı ve sonu da (aynı yönde) sınır veya boş hücre olmalı.
function yerlestirmeGecerliMi(grid, boyut, kelime, row, col, yon) {
  const harfler = harfleriAyir(kelime);
  const dr = yon === 1 ? 1 : 0;
  const dc = yon === 0 ? 1 : 0;
  const bitisRow = row + dr * (harfler.length - 1);
  const bitisCol = col + dc * (harfler.length - 1);
  if (row < 0 || col < 0 || bitisRow >= boyut || bitisCol >= boyut) { return false; }

  // Kelimenin hemen öncesi ve sonrası (aynı satır/sütunda) BOŞ olmalı --
  // aksi halde bu kelime bitişik başka bir kelimeyle birleşip anlamsız/uzun
  // bir dizi oluşturur.
  const oncekiRow = row - dr, oncekiCol = col - dc;
  if (oncekiRow >= 0 && oncekiCol >= 0 && grid[oncekiRow][oncekiCol]) { return false; }
  const sonrakiRow = bitisRow + dr, sonrakiCol = bitisCol + dc;
  if (sonrakiRow < boyut && sonrakiCol < boyut && grid[sonrakiRow][sonrakiCol]) { return false; }

  let kesisimVarMi = false;
  for (let i = 0; i < harfler.length; i++) {
    const r = row + dr * i, c = col + dc * i;
    const mevcut = grid[r][c];
    if (mevcut) {
      if (mevcut.harf !== harfler[i]) { return false; }
      kesisimVarMi = true;
    } else {
      // Kesişmeyen (yeni) hücre: DİK yöndeki komşular boş olmalı, yoksa
      // istenmeyen bir yan kelime/harf çakışması oluşur.
      const dikR = yon === 0 ? 1 : 0, dikC = yon === 1 ? 1 : 0;
      const ust = grid[r - dikR] && grid[r - dikR][c - dikC];
      const alt = grid[r + dikR] && grid[r + dikR][c + dikC];
      if (ust || alt) { return false; }
    }
  }
  return kesisimVarMi;
}

function kelimeyiYerlestir(grid, kelime, row, col, yon) {
  const harfler = harfleriAyir(kelime);
  const dr = yon === 1 ? 1 : 0;
  const dc = yon === 0 ? 1 : 0;
  harfler.forEach((h, i) => { grid[row + dr * i][col + dc * i] = { harf: h }; });
}

/**
 * @param {Object} havuz - { "3": [{k,i}], "4": [...], ... } uzunluğa göre kelime+ipucu havuzu
 * @param {number} boyut - ızgara kenar uzunluğu (15 veya 7)
 * @param {string} seedStr - deterministik üretim için tohum (tarih+versiyon)
 * @param {number} hedefKelimeSayisi - üretimi durdurma hedefi (yaklaşık)
 */
export function cengelBulmacaUret(havuz, boyut, seedStr, hedefKelimeSayisi) {
  const rng = seedliRng(seedStr);
  const grid = bosIzgara(boyut);
  const placedWords = [];
  const kullanilanKelimeler = new Set();

  // Aday havuzu: boyuta sığan uzunluklar (2'den kısa kelime bulmacada kullanılmaz),
  // uzundan kısaya doğru, her uzunluk grubu kendi içinde karıştırılmış.
  const uzunluklar = Object.keys(havuz).map(Number).filter((u) => u >= 3 && u <= boyut).sort((a, b) => b - a);
  let adaylar = [];
  uzunluklar.forEach((u) => { adaylar = adaylar.concat(karistir(havuz[String(u)], rng)); });

  // İlk kelime: en uzun adaylardan biri, ortadaki satıra yatay yerleştirilir.
  const ilkAday = adaylar.find((a) => a.k.length <= boyut);
  if (!ilkAday) { return { boyut, grid: [], placedWords: [] }; }
  const ortaRow = Math.floor(boyut / 2);
  const baslangicCol = Math.floor((boyut - ilkAday.k.length) / 2);
  kelimeyiYerlestir(grid, ilkAday.k, ortaRow, baslangicCol, 0);
  placedWords.push({ kelime: ilkAday.k, ipucu: ilkAday.i, row: ortaRow, col: baslangicCol, yon: 0 });
  kullanilanKelimeler.add(ilkAday.k);

  for (const aday of adaylar) {
    if (placedWords.length >= hedefKelimeSayisi) { break; }
    if (kullanilanKelimeler.has(aday.k)) { continue; }
    const harfler = harfleriAyir(aday.k);
    let yerlesti = false;
    // Izgaradaki her dolu hücreyi kesişim adayı olarak dene -- kelimenin
    // içindeki AYNI harfle eşleşen her pozisyonda, DİK yönde yerleştirmeyi sına.
    for (let r = 0; r < boyut && !yerlesti; r++) {
      for (let c = 0; c < boyut && !yerlesti; c++) {
        const hucre = grid[r][c];
        if (!hucre) { continue; }
        for (let i = 0; i < harfler.length && !yerlesti; i++) {
          if (harfler[i] !== hucre.harf) { continue; }
          // Mevcut hücrenin hangi yönde (yatay/dikey) bir kelimenin parçası
          // olduğunu bilmiyoruz ama DİK yönde yerleştirmeyi deniyoruz -- eğer
          // bu hücre zaten sadece TEK yönde kullanılmışsa, YENİ kelime DİĞER
          // yönde denenmeli. İki yönü de deniyoruz, geçerlilik kontrolü zaten
          // çakışmayı engeller.
          for (const yon of [0, 1]) {
            const row = yon === 1 ? r - i : r;
            const col = yon === 0 ? c - i : c;
            if (yerlestirmeGecerliMi(grid, boyut, aday.k, row, col, yon)) {
              kelimeyiYerlestir(grid, aday.k, row, col, yon);
              placedWords.push({ kelime: aday.k, ipucu: aday.i, row, col, yon });
              kullanilanKelimeler.add(aday.k);
              yerlesti = true;
              break;
            }
          }
        }
      }
    }
  }

  return { boyut, grid, placedWords: numaralandir(grid, boyut, placedWords) };
}

// Standart crossword numaralandırması: bir hücre, YATAY bir kelimenin başlangıcıysa
// (solunda dolu hücre yok, sağında var) veya DİKEY bir kelimenin başlangıcıysa
// (üstünde dolu hücre yok, altında var) numara alır -- iki kelime aynı hücrede
// başlıyorsa TEK numara paylaşırlar (gerçek crossword kuralı).
function numaralandir(grid, boyut, placedWords) {
  const numaraHaritasi = {};
  let sayac = 1;
  for (let r = 0; r < boyut; r++) {
    for (let c = 0; c < boyut; c++) {
      if (!grid[r][c]) { continue; }
      const solDolu = c > 0 && grid[r][c - 1];
      const sagDolu = c < boyut - 1 && grid[r][c + 1];
      const ustDolu = r > 0 && grid[r - 1][c];
      const altDolu = r < boyut - 1 && grid[r + 1][c];
      const yatayBaslangic = !solDolu && sagDolu;
      const dikeyBaslangic = !ustDolu && altDolu;
      if (yatayBaslangic || dikeyBaslangic) {
        numaraHaritasi[r + ',' + c] = sayac++;
      }
    }
  }
  return placedWords.map((w) => Object.assign({}, w, { numara: numaraHaritasi[w.row + ',' + w.col] }));
}
