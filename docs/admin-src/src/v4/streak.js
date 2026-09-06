// Günlük giriş "streak"i (üst üste gün) — users/{uid}/streak altında tutulur.
//
// NEDEN: Kullanıcı isteği: "sisteme girilen gün için bir streak tutma özelliği
// eklemeliyiz... eğer streak biterse bir bildirim gelmeli". Bu modül SADECE veri
// mantığını (okuma/hesaplama/yazma) içerir; hangi UI'ın nasıl göstereceğine
// karışmaz -- shell.js sonucu `window.__streakState` + `streak:ready` event'i
// olarak yayınlar, ilgilenen her sayfa kendi göstergesini/bildirimini oradan kurar.
//
// BİLİNÇLİ TERCİH: calendar.js'teki dKey()/pad2() ile AYNI mantığı burada
// AYRICA yazıyoruz, import ETMİYORUZ -- bu modül bağımsız kalmalı (calendar.js
// takvim sayfasına özgü başka state/importlar taşıyor, streak her sayfada
// (dashboard dahil) çalışmalı).
//
// ŞEMA (users/{uid}/streak):
//   count             : number       -- güncel üst üste gün sayısı
//   lastDate          : "YYYY-MM-DD" -- en son sayılan gün
//   longest           : number       -- şimdiye kadar ulaşılan en yüksek streak
//   brokenNoticeShown : "YYYY-MM-DD" | null -- "streak bitti" bildirimi en son
//                        hangi GÜN gösterildi (aynı gün içinde tekrar tekrar
//                        çıkmasın diye; sayfa yenilense bile).

function pad2(n) { return (n < 10 ? '0' : '') + n; }
function dKey(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }

/** `today` bir gün öncesinin YYYY-MM-DD karşılığını üretir (yerel saatle). */
function yesterdayOf(today) {
  const [y, m, d] = today.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - 1);
  return dKey(dt);
}

/**
 * Kullanıcının günlük giriş streak'ini okur, günceller ve sonucu döner.
 * Bu fonksiyon HİÇBİR ZAMAN sayfayı kilitlememeli/çökertmemeli -- salt görsel/
 * motivasyon amaçlı bir özellik olduğu için her hata sessizce yutulur.
 *
 * @param {*} database `firebase.database()` örneği.
 * @param {string} uid Giriş yapmış kullanıcının uid'i.
 * @returns {Promise<{count:number, longest:number, justBroken:boolean}>}
 *   `justBroken`: bu çağrıda streak'in YENİ kırıldığı (ve daha önce bu güne ait
 *   bildirim gösterilmediği) tespit edildiyse `true`.
 */
export async function initStreak(database, uid) {
  const today = dKey(new Date());
  const ref = database.ref('users/' + uid + '/streak');

  try {
    const snap = await ref.once('value');
    const streak = snap.val();

    // 1) Hiç kayıt yok -- ilk giriş.
    if (!streak) {
      const fresh = { count: 1, lastDate: today, longest: 1, brokenNoticeShown: null };
      await ref.set(fresh);
      return { count: 1, longest: 1, justBroken: false };
    }

    // 2) Bugün zaten sayılmış -- tekrar sayma, hiçbir şey YAZMA.
    if (streak.lastDate === today) {
      return { count: streak.count || 1, longest: streak.longest || streak.count || 1, justBroken: false };
    }

    // 3) Dün girmiş -- streak devam ediyor.
    if (streak.lastDate === yesterdayOf(today)) {
      const nextCount = (streak.count || 0) + 1;
      const nextLongest = Math.max(streak.longest || 0, nextCount);
      await ref.set({
        count: nextCount,
        lastDate: today,
        longest: nextLongest,
        brokenNoticeShown: streak.brokenNoticeShown ?? null
      });
      return { count: nextCount, longest: nextLongest, justBroken: false };
    }

    // 4) Bir veya daha fazla gün atlanmış -- streak KIRILDI.
    // Bildirim SADECE eski streak anlamlıysa (>=2 gün) VE bugün için daha önce
    // gösterilmediyse tetiklenir -- aksi halde sayfa her yenilendiğinde yeniden çıkardı.
    const hadMeaningfulStreak = (streak.count || 0) >= 2;
    const alreadyNotifiedToday = streak.brokenNoticeShown === today;
    const justBroken = hadMeaningfulStreak && !alreadyNotifiedToday;

    const nextLongest = streak.longest || streak.count || 0;
    await ref.set({
      count: 1,
      lastDate: today,
      longest: nextLongest,
      brokenNoticeShown: justBroken ? today : (streak.brokenNoticeShown ?? null)
    });
    return { count: 1, longest: nextLongest, justBroken };
  } catch (err) {
    console.error('Streak okunamadı/güncellenemedi (motivasyon özelliği, sayfayı etkilemez):', err);
    return { count: 0, longest: 0, justBroken: false };
  }
}
