// scripts/migrate-people-to-object.js
//
// "people" (ilProtokolVerileri / universiteProtokolVerileri) dizisini, "etkinlikler" dalında
// zaten kullanılan push-ID'li NESNE modeline çevirir: [ {...}, {...} ] -> { "-Oabc...": {...} }
//
// KULLANIM:
//   node scripts/migrate-people-to-object.js <girdi.json> <cikti.json>
//
// Girdi: exportJSON() formatındaki DÜZ BİR DİZİ (array) JSON dosyası.
// Çıktı: her elemanın TÜM alanları (fotoğraf dahil) birebir korunmuş, sadece dizi
// pozisyonunun yerini GERÇEKÇİ bir Firebase push-ID'nin aldığı bir NESNE.
//
// NOT: Bu script SADECE OKUMA amaçlıdır -- girdi dosyasını asla değiştirmez/silmez,
// üretilen çıktı ayrı bir dosyaya yazılır. Firebase'e HİÇBİR BAĞLANTI kurmaz, tamamen
// yerel/çevrimdışı çalışır -- üretilen ID'ler GERÇEKÇİDİR (Firebase'in push-ID algoritmasıyla
// birebir aynı biçimde üretilir) ama gerçek bir Firebase sunucusuna hiç yazılmamıştır.
// Gerçek bir Firebase sırasında (`database.ref(path).push().key`) bu tür bir ID kesinlikle
// TEKRARLANMAZ; bu script'in ürettiği ID'ler de aynı çarpışma-önleme mantığını (zaman damgası +
// kriptografik rastgelelik) kullanır, bu yüzden pratik olarak asla çakışmaz.

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ---- Firebase'in push-ID algoritmasının yeniden uygulanması ----
// Kaynak: Firebase'in resmi "push id generation" algoritması (8 byte'lık milisaniye zaman
// damgası + 12 karakterlik kriptografik rastgelelik, özel bir 64 karakterlik base64 benzeri
// alfabeyle kodlanır). Bu SADECE dış görünüş/sıralanabilirlik açısından GERÇEK push-ID'lerle
// AYNI BİÇİMDEDİR -- gerçek bir yazma işlemi olmadığı için Firebase sunucusunun ürettiği
// ID'lerle asla çakışmaz (ayrı bir rastgelelik havuzu kullanılır).
const PUSH_CHARS = "-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz";

function makePushIdGenerator() {
	// Aynı milisaniye içinde üretilen ID'lerin SIRALI kalması için (Firebase'in kendi
	// davranışı), bir önceki çağrının rastgele kısmı saklanıp bir sonraki ID için "bir artırılır".
	let lastPushTime = 0;
	const lastRandChars = new Array(12);

	return function generatePushId() {
		let now = Date.now();
		const duplicateTime = (now === lastPushTime);
		lastPushTime = now;

		const timeStampChars = new Array(8);
		for (let i = 7; i >= 0; i--) {
			timeStampChars[i] = PUSH_CHARS.charAt(now % 64);
			now = Math.floor(now / 64);
		}
		if (now !== 0) throw new Error("push-id zaman damgası taşması (beklenmiyordu)");

		let id = timeStampChars.join("");

		if (!duplicateTime) {
			for (let i = 0; i < 12; i++) {
				lastRandChars[i] = Math.floor(Math.random() * 64);
			}
		} else {
			// Aynı milisaniyede ikinci bir ID isteniyorsa, önceki rastgele bloğu 1 artır
			// (taşma olursa bir önceki hâneye devreder) -- Firebase'in orijinal algoritması.
			let i;
			for (i = 11; i >= 0 && lastRandChars[i] === 63; i--) {
				lastRandChars[i] = 0;
			}
			lastRandChars[i]++;
		}
		for (let i = 0; i < 12; i++) {
			id += PUSH_CHARS.charAt(lastRandChars[i]);
		}
		if (id.length !== 20) throw new Error("push-id uzunluk hatası (beklenmiyordu)");
		return id;
	};
}

function migrateArrayToObject(arr) {
	if (!Array.isArray(arr)) throw new Error("Girdi bir DİZİ (array) olmalı -- exportJSON() formatı bekleniyor.");
	const generatePushId = makePushIdGenerator();
	const obj = {};
	let skipped = 0;
	arr.forEach(function (item) {
		if (!item || typeof item !== "object") { skipped++; return; }
		const id = generatePushId();
		// TÜM alanlar (fotoğraf/base64 dahil) BİREBİR korunur -- sadece dizi pozisyonunun
		// yerini bu ID alıyor. rank/order zaten kişide açık alanlar olduğu için (bkz. CLAUDE.md
		// Person şeması) sıralamayı yeniden hesaplamaya GEREK YOK.
		obj[id] = item;
	});
	return { obj: obj, total: arr.length, migrated: arr.length - skipped, skipped: skipped };
}

function main() {
	const args = process.argv.slice(2);
	if (args.length < 2) {
		console.error("Kullanım: node scripts/migrate-people-to-object.js <girdi.json> <cikti.json>");
		process.exit(1);
	}
	const inputPath = path.resolve(args[0]);
	const outputPath = path.resolve(args[1]);

	console.log("Okunuyor (SALT OKUNUR, bu dosya asla değiştirilmez):", inputPath);
	const raw = fs.readFileSync(inputPath, "utf8");
	const data = JSON.parse(raw);

	const result = migrateArrayToObject(data);
	fs.writeFileSync(outputPath, JSON.stringify(result.obj, null, 2), "utf8");

	console.log("Toplam kayıt:      " + result.total);
	console.log("Dönüştürülen:      " + result.migrated);
	console.log("Atlanan (geçersiz): " + result.skipped);
	console.log("Yazıldı:           " + outputPath);
}

if (require.main === module) {
	main();
}

module.exports = { migrateArrayToObject, makePushIdGenerator };
