// Shared by both archived game bundles. Never infer live/write access from a failed read.
let testMode = false
let locked = true
let ready = false
let failed = false
let initialization
const listeners = new Set()
export const isTestMode = () => testMode
export const isReadOnly = () => !ready || failed || locked
export const isReady = () => ready && !failed
export const roleCanEdit = (role) => ['editor', 'admin', 'owner'].includes(role) && !isReadOnly()
export function dbPath(path) {
  if (!isReady()) throw new Error('Veritabanı modu doğrulanamadı. Sayfayı yenileyin.')
  return testMode ? `test/${path}` : path
}
export function onDbModeChange(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
function emit() {
  for (const listener of listeners) {
    try { listener() } catch (error) { console.error('Oyun modu güncellenemedi:', error) }
  }
}
export function initDbMode(db) {
  if (initialization) return initialization
  initialization = new Promise((resolve, reject) => {
    let hasTest = false
    let hasLock = false
    const fail = (error) => {
      failed = true
      ready = false
      locked = true
      emit()
      reject(error || new Error('Veritabanı modu okunamadı'))
    }
    const complete = () => {
      if (failed) return
      ready = hasTest && hasLock
      emit()
      if (ready) resolve()
    }
    try {
      if (!db) throw new Error('Veritabanı bağlantısı yok')
      db.ref('ayarlar/testModuAcik').on('value', (snap) => {
        if (failed) return
        testMode = !!snap.val()
        hasTest = true
        complete()
      }, fail)
      db.ref('ayarlar/saltOkunur').on('value', (snap) => {
        if (failed) return
        locked = !!snap.val()
        hasLock = true
        complete()
      }, fail)
      const auth = globalThis.firebase?.auth?.()
      const uid = auth?.currentUser?.uid
      if (auth?.onAuthStateChanged && uid) auth.onAuthStateChanged((user) => {
        if (user?.uid !== uid) fail(new Error('Oturum değişti; oyun sayfasını yenileyin.'))
      })
    } catch (error) { fail(error) }
  })
  // Legacy shell callers may only consume the successful initialization path.
  initialization.catch(() => {})
  return initialization
}
export function renderBanner() {
  let banner = document.getElementById('dbModeBanner')
  const messages = []
  if (!isReady()) messages.push('🔒 Oyun veritabanı modu doğrulanamadı; yazma kapalı. Sayfayı yenileyin.')
  else {
    if (testMode) messages.push('🧪 TEST MODU — değişiklikler test/ dalına yazılır')
    if (locked) messages.push('🔒 SALT-OKUNUR KİLİT — veri değişikliği kapalı')
  }
  if (!messages.length) { banner?.remove(); return }
  if (!banner) {
    banner = document.createElement('div')
    banner.id = 'dbModeBanner'
    banner.className = 'db-mode-banner'
    document.body.prepend(banner)
  }
  banner.classList.toggle('is-locked', isReadOnly())
  banner.textContent = messages.join(' · ')
}
