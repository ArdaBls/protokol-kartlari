const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');

admin.initializeApp({
  databaseURL: 'https://omu-protokol-default-rtdb.europe-west1.firebasedatabase.app'
});

const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');
const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_SYSTEM_PROMPT = 'Sen OMÜ Protokol Kartları panelinde çalışan, panel kullanıcılarına yardımcı olan bir yapay zeka asistanısın. Her zaman Türkçe cevap ver. Kısa ve öz ol.';
const ONAYLI_ROLLER = ['editor', 'admin', 'owner'];

// Kullanıcı isteği: Gemini key hiçbir zaman tarayıcıya/git'e gitmesin --
// tek güvenli yol olarak bu fonksiyon Secret Manager'daki key'i sunucu
// tarafında kullanıp asistan cevabını doğrudan RTDB'ye yazıyor. Client
// yalnızca kullanıcı mesajını push edip bu fonksiyonu çağırıyor.
exports.geminiChat = onCall({ region: 'europe-west1', secrets: [GEMINI_API_KEY] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Giriş yapmış olmanız gerekir.');
  }
  const uid = request.auth.uid;
  const db = admin.database();

  // RTDB güvenlik kuralıyla AYNI yetki modeli -- bu kontrol olmadan
  // pending/blocked bir hesap RTDB'ye yazamasa bile fonksiyonu doğrudan
  // çağırıp Gemini kotasını tüketebilirdi.
  const userSnap = await db.ref('users/' + uid).once('value');
  const user = userSnap.val() || {};
  if (user.blocked === true) {
    throw new HttpsError('permission-denied', 'Hesabınız engellenmiş.');
  }
  if (ONAYLI_ROLLER.indexOf(user.role) === -1) {
    throw new HttpsError('permission-denied', 'Bu özellik yalnızca onaylı kullanıcılara açıktır.');
  }

  const messagesRef = db.ref('yapayZekaMesajlari/' + uid);
  const messagesSnap = await messagesRef.once('value');
  const mesajlar = messagesSnap.val() || {};

  const contents = Object.keys(mesajlar).sort()
    .map((key) => mesajlar[key])
    .filter((m) => m && m.metin)
    .map((m) => ({ role: m.rol === 'asistan' ? 'model' : 'user', parts: [{ text: m.metin }] }));

  if (!contents.length) {
    throw new HttpsError('failed-precondition', 'Gönderilecek mesaj bulunamadı.');
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY.value()}`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents,
      systemInstruction: { parts: [{ text: GEMINI_SYSTEM_PROMPT }] },
      generationConfig: { temperature: 0.7, maxOutputTokens: 1024 }
    })
  });

  if (!res.ok) {
    const hataGovdesi = await res.json().catch(() => ({}));
    console.error('Gemini API hatası:', res.status, hataGovdesi);
    throw new HttpsError('internal', (hataGovdesi.error && hataGovdesi.error.message) || `Gemini API hatası (${res.status})`);
  }

  const data = await res.json();
  const parcalar = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
  const metin = (parcalar || []).map((p) => p.text || '').join('').trim();
  if (!metin) {
    throw new HttpsError('internal', 'Gemini boş cevap döndü.');
  }

  await messagesRef.push({ rol: 'asistan', metin, zaman: admin.database.ServerValue.TIMESTAMP });
  return { ok: true };
});
