// Yalnızca Operasyonlar sayfasındaki üç etkinlik grafiğinin kullandığı ECharts
// parçalarını kaydeder. Bu ayrı modül dinamik yüklendiği için grafiksiz sayfalar
// ECharts indirmez; statik named importlar da bundler'ın kullanılmayan grafik
// türlerini güvenle elemesine izin verir.
import * as echarts from 'echarts/core';
import { LineChart, PieChart } from 'echarts/charts';
import {
  GridComponent, TooltipComponent, LegendComponent,
  GraphicComponent, DataZoomComponent
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([
  LineChart, PieChart,
  GridComponent, TooltipComponent, LegendComponent,
  GraphicComponent, DataZoomComponent,
  CanvasRenderer
]);

export default echarts;
