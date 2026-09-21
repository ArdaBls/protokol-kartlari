import { Card, Tabs } from '@heroui/react'
import ReactECharts from 'echarts-for-react'
import { useMemo, useState } from 'react'
import { activityShare, dailyActivity, monthlyActivity, seriesColor } from '../../lib/activityStats'
import { MONTHS_LONG, MONTHS_SHORT } from '../../lib/dates'
import type { CalendarEvent } from '../../lib/eventOverview'

type ActivityView = 'line' | 'daily' | 'share'

interface EditorActivityCardProps {
  names: string[]
  events: CalendarEvent[]
  isLoading: boolean
  now: Date
}

const MUTED = '#9b93a8'
const GRID_LINE = 'rgba(155, 147, 168, 0.16)'
const FONT = "'Inter', system-ui, sans-serif"
const MOBILE_QUERY = '(max-width: 768px)'
const MONTH_WINDOW = 5
const DAY_WINDOW = 7

const LEGEND = {
  type: 'scroll', bottom: 0, icon: 'circle', itemWidth: 8, itemHeight: 8, itemGap: 16,
  textStyle: { color: MUTED, fontSize: 11 }, pageTextStyle: { color: MUTED }, inactiveColor: '#5f596a',
}

const CHART_TOOLTIP = {
  backgroundColor: 'var(--surface)',
  borderColor: 'var(--border)',
  borderWidth: 1,
  textStyle: { color: 'var(--surface-foreground)' },
  extraCssText: 'border-radius: 12px; box-shadow: var(--surface-shadow);',
}

function emptyOption(message: string) {
  return {
    graphic: [{ type: 'text', left: 'center', top: 'middle', style: { text: message, fill: MUTED, fontSize: 12, fontFamily: FONT } }],
    xAxis: { show: false },
    yAxis: { show: false },
    series: [],
  }
}

// Dar ekranda tüm etiketler sığmıyor: bugünü ortalayan, kaydırılabilir bir pencere açılır.
function mobileZoom(center: number, size: number, count: number) {
  if (!window.matchMedia(MOBILE_QUERY).matches) return undefined
  const end = Math.min(count - 1, Math.max(0, center - Math.floor(size / 2)) + size - 1)
  return [{ type: 'inside', xAxisIndex: 0, zoomLock: true, startValue: Math.max(0, end - size + 1), endValue: end }]
}

function lineOption(names: string[], labels: string[], rows: number[][], dataZoom: unknown) {
  return {
    textStyle: { fontFamily: FONT },
    tooltip: { ...CHART_TOOLTIP, trigger: 'axis', axisPointer: { type: 'line', lineStyle: { color: 'var(--accent)', width: 1 } } },
    dataZoom,
    legend: LEGEND,
    grid: { top: 24, left: 8, right: 16, bottom: 40, containLabel: true },
    xAxis: {
      type: 'category', data: labels, boundaryGap: false, axisTick: { show: false },
      axisLine: { lineStyle: { color: GRID_LINE } }, axisLabel: { color: MUTED, fontSize: 10 },
    },
    yAxis: {
      type: 'value', minInterval: 1, axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { color: MUTED, fontSize: 10 }, splitLine: { lineStyle: { color: GRID_LINE, type: [4, 3] } },
    },
    series: names.map((name, i) => ({
      name,
      type: 'line',
      smooth: true,
      showSymbol: false,
      data: rows[i],
      lineStyle: { width: 1.5, color: seriesColor(i) },
      itemStyle: { color: seriesColor(i) },
      emphasis: {
        focus: 'series',
        lineStyle: { width: 2, color: seriesColor(i) },
        itemStyle: { color: seriesColor(i) },
      },
      areaStyle: {
        color: {
          type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [{ offset: 0, color: seriesColor(i, 0.33) }, { offset: 1, color: seriesColor(i, 0.03) }],
        },
      },
    })),
  }
}

function buildOption(view: ActivityView, names: string[], events: CalendarEvent[], now: Date) {
  if (!names.length) return emptyOption('Henüz görevli atanmış kişi yok.')

  if (view === 'line') {
    const rows = monthlyActivity(names, events, now.getFullYear())
    return lineOption(names, MONTHS_SHORT, rows, mobileZoom(now.getMonth(), MONTH_WINDOW, 12))
  }

  if (view === 'daily') {
    const { labels, rows } = dailyActivity(names, events, now)
    return lineOption(names, labels, rows, mobileZoom(now.getDate() - 1, DAY_WINDOW, labels.length))
  }

  const share = activityShare(names, events)
  if (!share.length) return emptyOption('Henüz görevli atanmış etkinlik yok.')
  return {
    textStyle: { fontFamily: FONT },
    tooltip: { ...CHART_TOOLTIP, trigger: 'item', formatter: '{b}: {c} (%{d})' },
    legend: LEGEND,
    series: [{
      type: 'pie', radius: ['52%', '76%'], center: ['50%', '45%'], label: { show: false },
      itemStyle: { borderRadius: 6 },
      data: share.map((item, i) => ({
        ...item,
        itemStyle: { color: seriesColor(i) },
        emphasis: { itemStyle: { color: seriesColor(i) } },
      })),
    }],
  }
}

export function EditorActivityCard({ names, events, isLoading, now }: EditorActivityCardProps) {
  const [view, setView] = useState<ActivityView>('line')
  const option = useMemo(
    () => (isLoading ? emptyOption('Yükleniyor…') : buildOption(view, names, events, now)),
    [isLoading, view, names, events, now],
  )

  const subtitles: Record<ActivityView, string> = {
    line: `Basın görevlisi veya haber yazarı olarak atandıkları etkinlikler, aylık · ${now.getFullYear()}`,
    daily: `Aynı sayım, günlük · ${MONTHS_LONG[now.getMonth()]}`,
    share: 'Tüm bitmiş etkinliklerdeki pay',
  }

  return (
    <Card className="h-[402px]">
      <Card.Header className="flex flex-row items-start justify-between gap-4">
        <div className="min-w-0">
          <Card.Title>Editör Aktivitesi</Card.Title>
          <Card.Description className="hidden sm:block">{subtitles[view]}</Card.Description>
        </div>
        <Tabs selectedKey={view} onSelectionChange={(key) => setView(key as ActivityView)} className="shrink-0">
          <Tabs.ListContainer>
            <Tabs.List aria-label="Grafik görünümü">
              <Tabs.Tab id="line">Ay<Tabs.Indicator /></Tabs.Tab>
              <Tabs.Tab id="daily">Gün<Tabs.Indicator /></Tabs.Tab>
              <Tabs.Tab id="share">%<Tabs.Indicator /></Tabs.Tab>
            </Tabs.List>
          </Tabs.ListContainer>
        </Tabs>
      </Card.Header>
      <Card.Content className="min-h-0 flex-1">
        <ReactECharts option={option} notMerge style={{ height: '100%', width: '100%' }} />
      </Card.Content>
    </Card>
  )
}
