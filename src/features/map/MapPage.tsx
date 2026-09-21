import 'leaflet/dist/leaflet.css'
import { Card } from '@heroui/react'
import L from 'leaflet'
import { useEffect, useMemo, useRef, useState } from 'react'
import { SelectField } from '../../components/formControls'
import { useDbValue } from '../../hooks/useDbValue'
import { toEventList } from '../../lib/eventOverview'
import type { CalendarEventRecord } from '../../lib/eventOverview'
import { UNIT_COORDS, resolveUnitName } from './unitCoords'

const CAMPUS_CENTER: [number, number] = [41.3641, 36.1946]
const CAMPUS_ZOOM = 13
const MARKER_RADIUS = 15

// Sabit boyutlu daire (piksel, zoom'dan bağımsız) + sayı arttıkça kırmızıya giden renk skalası --
// fakülteler kampüste birbirine yakın olduğu için büyüyen daireler üst üste biner, renk skalası
// çakışmadan yoğunluğu gösterir.
function colorForCount(count: number, max: number): string {
  if (!count) return '#9ca3af'
  const t = max > 0 ? count / max : 0
  const from = [253, 230, 138]
  const to = [185, 28, 28]
  const [r, g, b] = from.map((c, i) => Math.round(c + (to[i] - c) * t))
  return `rgb(${r}, ${g}, ${b})`
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c)
}

/** Leaflet kutusu gerçek boyutuna oturmadan (clientHeight>0) harita oluşturulursa kaçık bir
 * transform ile "bozuk" görünür ve invalidateSize() bunu sonradan düzeltemez -- birkaç kare beklenir. */
function waitForRealSize(el: HTMLElement, cb: () => void, tries = 0) {
  if (el.clientHeight > 40 || tries > 40) { cb(); return }
  requestAnimationFrame(() => waitForRealSize(el, cb, tries + 1))
}

export function MapPage() {
  const events = useDbValue<Record<string, CalendarEventRecord | null>>('etkinlikler')
  const eventList = useMemo(() => toEventList(events.data), [events.data])

  const years = useMemo(() => {
    const set = new Set(eventList.map((e) => (e.tarih ?? '').slice(0, 4)).filter(Boolean))
    set.add(String(new Date().getFullYear()))
    return [...set].sort().reverse()
  }, [eventList])
  const [year, setYear] = useState('')
  const activeYear = years.includes(year) ? year : years[0] ?? String(new Date().getFullYear())

  const counts = useMemo(() => {
    const map = new Map<string, number>()
    eventList.forEach((e) => {
      if ((e.tarih ?? '').slice(0, 4) !== activeYear) return
      const unit = resolveUnitName(e.birim)
      if (!unit) return
      map.set(unit, (map.get(unit) ?? 0) + 1)
    })
    return map
  }, [eventList, activeYear])
  const maxCount = Math.max(0, ...counts.values())

  const rows = useMemo(
    () =>
      Object.keys(UNIT_COORDS)
        .map((unit) => ({ unit, count: counts.get(unit) ?? 0 }))
        .sort((a, b) => b.count - a.count || a.unit.localeCompare(b.unit, 'tr')),
    [counts],
  )
  const unknownUnits = useMemo(
    () => [...counts.keys()].filter((unit) => !UNIT_COORDS[unit]).sort((a, b) => a.localeCompare(b, 'tr')),
    [counts],
  )

  const mapElRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markersRef = useRef<Record<string, L.CircleMarker>>({})

  useEffect(() => {
    const el = mapElRef.current
    if (!el || mapRef.current) return
    let disposed = false
    waitForRealSize(el, () => {
      if (disposed || mapRef.current) return
      const map = L.map(el).setView(CAMPUS_CENTER, CAMPUS_ZOOM)
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 18,
      }).addTo(map)
      mapRef.current = map
      const fixSize = () => map.invalidateSize()
      requestAnimationFrame(fixSize)
      setTimeout(fixSize, 250)
      const observer = new ResizeObserver(fixSize)
      observer.observe(el)
      ;(map as unknown as { __resizeObserver?: ResizeObserver }).__resizeObserver = observer
    })
    return () => {
      disposed = true
      const map = mapRef.current
      if (map) {
        ;(map as unknown as { __resizeObserver?: ResizeObserver }).__resizeObserver?.disconnect()
        map.remove()
        mapRef.current = null
        markersRef.current = {}
      }
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    Object.values(markersRef.current).forEach((marker) => map.removeLayer(marker))
    const nextMarkers: Record<string, L.CircleMarker> = {}
    Object.entries(UNIT_COORDS).forEach(([unit, coords]) => {
      const count = counts.get(unit) ?? 0
      const color = colorForCount(count, maxCount)
      const marker = L.circleMarker(coords, { radius: MARKER_RADIUS, color, fillColor: color, fillOpacity: 0.75, weight: 2 })
        .addTo(map)
        .bindPopup(`<strong>${escapeHtml(unit)}</strong><br>${activeYear}: ${count} etkinlik`)
      nextMarkers[unit] = marker
    })
    markersRef.current = nextMarkers
  }, [counts, maxCount, activeYear])

  const flyToUnit = (unit: string) => {
    const map = mapRef.current
    const coords = UNIT_COORDS[unit]
    const marker = markersRef.current[unit]
    if (!map || !coords || !marker) return
    map.flyTo(coords, 16, { duration: 0.6 })
    marker.openPopup()
  }

  return (
    <div className="mx-auto flex w-full max-w-[1700px] flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-muted">Etkinlikler</div>
          <h1 className="mt-1 text-2xl font-semibold">Birim etkinlik haritası</h1>
        </div>
        <SelectField
          label=""
          value={activeYear}
          onChange={setYear}
          options={years.map((y) => ({ value: y, label: y }))}
          className="w-28"
        />
      </div>

      {/* items-start: HeroUI Card, ızgara hücresi kadar uzamaya çalışıyor -- yükseklikleri
          farklı iki kart aksi halde birbirini aşağı doğru sonsuz gibi geriyordu (kullanıcı bulgusu). */}
      <div className="grid items-start gap-4 lg:grid-cols-[1fr_420px]">
        <Card className="isolate overflow-hidden p-0">
          <div ref={mapElRef} className="h-[380px] w-full lg:h-[680px]" />
        </Card>

        <Card className="flex h-[380px] flex-col lg:h-[680px]">
          <Card.Header>
            <Card.Title>Birimler</Card.Title>
            <Card.Description>{activeYear} · Etkinlik sayısına göre</Card.Description>
          </Card.Header>
          <Card.Content className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
            {events.isLoading && <p className="py-6 text-center text-sm text-muted">Yükleniyor…</p>}
            {events.error && <p className="py-6 text-center text-sm text-danger">Etkinlikler yüklenemedi.</p>}
            {!events.isLoading && !events.error && rows.map(({ unit, count }) => (
              <button
                key={unit}
                type="button"
                onClick={() => flyToUnit(unit)}
                className="flex flex-col gap-1.5 rounded-xl px-2.5 py-2.5 text-left hover:bg-default"
              >
                <div className="flex items-start justify-between gap-3 text-sm">
                  <span className="leading-snug">{unit}</span>
                  <span className="shrink-0 tabular-nums text-muted">{count}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-default">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${maxCount ? Math.round((count / maxCount) * 100) : 0}%`, background: colorForCount(count, maxCount) }}
                  />
                </div>
              </button>
            ))}
            {!events.isLoading && !events.error && unknownUnits.length > 0 && (
              <p className="mt-2 border-t border-separator pt-2.5 text-[11px] text-muted">
                Konumu bilinmeyen: {unknownUnits.join(', ')}
              </p>
            )}
          </Card.Content>
        </Card>
      </div>
    </div>
  )
}
