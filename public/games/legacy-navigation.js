const routes = {
  'index.html': '/', 'protokol.html': '/protokol', 'takvim.html': '/takvim',
  'harita.html': '/harita', 'yapilacaklar.html': '/yapilacaklar', 'bildirimler.html': '/bildirimler',
  'oyunlar.html': '/oyunlar', 'gantt.html': '/gantt', 'tum-haberler.html': '/tum-haberler',
  'haber-detayi.html': '/tum-haberler', 'kisiler.html': '/kisiler', 'basin-rehberi.html': '/basin-rehberi',
  'kullanici-yonetimi.html': '/kullanici-yonetimi', 'profil.html': '/profil', 'ayarlar.html': '/ayarlar',
  'yardim-merkezi.html': '/yardim-merkezi', 'kilit-ekrani.html': '/giris', 'giris.html': '/giris',
  'oyun-satranc.html': '/oyunlar/satranc', 'erisim-kisitlandi.html': '/erisim-kisitlandi',
  'onay-bekliyor.html': '/onay-bekliyor', 'erisim-engellendi.html': '/erisim-kisitlandi',
}
export function legacyUrl(value, base) {
  const url = new URL(value, base)
  if (url.origin !== new URL(base).origin) return null
  const embedded = /^\/games\/(pisti|blackjack)\/index\.html$/.exec(url.pathname)
  const name = url.pathname.split('/').pop()
  url.pathname = embedded ? `/oyunlar/${embedded[1]}` : routes[name] || url.pathname
  const returnTo = url.searchParams.get('returnTo')
  if (returnTo) {
    try {
      const target = new URL(returnTo, base)
      const game = /^\/games\/(pisti|blackjack)\/index\.html$/.exec(target.pathname)
      if (game && target.origin === url.origin) url.searchParams.set('returnTo', `/oyunlar/${game[1]}`)
      else if (target.origin !== url.origin) url.searchParams.delete('returnTo')
    } catch { url.searchParams.delete('returnTo') }
  }
  return url.pathname + url.search + url.hash
}
function navigate(value, replace = false) {
  const target = legacyUrl(value, window.location.href)
  if (!target) return
  let host = window
  try { if (window.top.location.origin === window.location.origin) host = window.top } catch { /* cross-origin embed */ }
  if (replace) host.location.replace(target)
  else host.location.assign(target)
}
export const legacyLocation = {
  set href(value) { navigate(value) },
  replace(value) { navigate(value, true) },
}
if (typeof document !== 'undefined') document.addEventListener('click', (event) => {
  const anchor = event.target.closest?.('a[href]')
  if (!anchor || event.defaultPrevented || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
  const url = new URL(anchor.href)
  if (!routes[url.pathname.split('/').pop()] || url.origin !== window.location.origin) return
  event.preventDefault()
  navigate(url.href)
}, true)
