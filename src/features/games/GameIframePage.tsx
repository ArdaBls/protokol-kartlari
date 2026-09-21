import { ExternalLink } from 'lucide-react'

interface GameIframePageProps {
  title: string
  src: string
  /** Dış kaynaklı oyunlarda (iframe embed'i reddedebilirler) "yeni sekmede aç" bağlantısı gösterilir. */
  externalUrl?: string
  allow?: string
}

/** Tek bir dış/gömülü oyunu tam yükseklikte iframe içinde gösteren ortak sayfa iskeleti --
 * eski sitedeki oyun-*.html sayfalarının (page-header + not + .game-iframe-wrap) karşılığı. */
export function GameIframePage({ title, src, externalUrl, allow }: GameIframePageProps) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wider text-muted">Oyunlar</div>
        <h1 className="mt-1 text-2xl font-semibold">{title}</h1>
      </div>

      {externalUrl && (
        <p className="-mt-1 flex flex-wrap items-center gap-2.5 text-xs text-muted">
          <span>
            Bu oyun dış kaynaktan ({new URL(externalUrl).hostname}) gösteriliyor; arayüzü İngilizce olabilir. Site kendini panel
            içinde göstermeyi reddederse (üçüncü taraf sitenin kendi güvenlik ayarı, bizim tarafımızdan düzeltilemez) yeni
            sekmede deneyin:
          </span>
          <a
            href={externalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex shrink-0 items-center gap-1.5 rounded-full border border-separator px-3 py-1.5 font-medium hover:bg-default"
          >
            Yeni sekmede aç <ExternalLink size={13} />
          </a>
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-separator bg-surface">
        <iframe src={src} title={title} loading="lazy" allow={allow} className="size-full border-0" />
      </div>
    </div>
  )
}
