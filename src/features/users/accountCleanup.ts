/** Hesaplar ortaktır; hesap temizliği seçili test/canlı modundan bağımsızdır. */
export function accountDeleteUpdates(uid: string): Record<string, null> {
  if (!uid || /[.#$[\]/]/.test(uid)) throw new Error('Geçersiz kullanıcı kimliği.')
  return Object.fromEntries([
    `users/${uid}`,
    `staffProfiles/${uid}`,
    `presence/${uid}`,
    `basinGorevlileri/${uid}`,
    `test/basinGorevlileri/${uid}`,
    `notifications/${uid}`,
    `test/notifications/${uid}`,
  ].map((path) => [path, null]))
}
