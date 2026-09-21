import { Spinner } from '@heroui/react'
import { Suspense, lazy } from 'react'
import { Route, Routes } from 'react-router-dom'
import { RequireAuth } from './auth/RequireAuth'
import { AppShell } from './components/layout/AppShell'
import { PlaceholderPage } from './components/PlaceholderPage'
import { NAV_ITEMS } from './config/nav'
import { AccountStatusPage } from './pages/AccountStatusPage'
import { LoginPage } from './pages/LoginPage'

// Sayfalar ayrı parçalar hâlinde yüklenir: ilk açılış hızlanır, grafik/sürükle-bırak kodu yalnızca gerekince iner.
const DashboardPage = lazy(() => import('./features/dashboard/DashboardPage').then((m) => ({ default: m.DashboardPage })))
const ProtocolPage = lazy(() => import('./features/protocol/ProtocolPage').then((m) => ({ default: m.ProtocolPage })))
const SettingsPage = lazy(() => import('./features/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })))
const UserManagementPage = lazy(() => import('./features/users/UserManagementPage').then((m) => ({ default: m.UserManagementPage })))
const PressDirectoryPage = lazy(() => import('./features/press/PressDirectoryPage').then((m) => ({ default: m.PressDirectoryPage })))
const ContactsPage = lazy(() => import('./features/contacts/ContactsPage').then((m) => ({ default: m.ContactsPage })))
const GanttPage = lazy(() => import('./features/gantt/GanttPage').then((m) => ({ default: m.GanttPage })))
const ProfilePage = lazy(() => import('./features/profile/ProfilePage').then((m) => ({ default: m.ProfilePage })))
const NotificationsPage = lazy(() => import('./features/notifications/NotificationsPage').then((m) => ({ default: m.NotificationsPage })))
const KanbanPage = lazy(() => import('./features/kanban/KanbanPage').then((m) => ({ default: m.KanbanPage })))
const MapPage = lazy(() => import('./features/map/MapPage').then((m) => ({ default: m.MapPage })))
const GamesPage = lazy(() => import('./features/games/GamesPage').then((m) => ({ default: m.GamesPage })))
const WordlePage = lazy(() => import('./features/games/wordle/WordlePage').then((m) => ({ default: m.WordlePage })))
const KourPage = lazy(() => import('./features/games/KourPage').then((m) => ({ default: m.KourPage })))
const MayinTarlasiPage = lazy(() => import('./features/games/MayinTarlasiPage').then((m) => ({ default: m.MayinTarlasiPage })))
const GeoguesserPage = lazy(() => import('./features/games/GeoguesserPage').then((m) => ({ default: m.GeoguesserPage })))
const TetrisPage = lazy(() => import('./features/games/TetrisPage').then((m) => ({ default: m.TetrisPage })))
const ChessPage = lazy(() => import('./features/games/chess/ChessPage').then((m) => ({ default: m.ChessPage })))
const AmiralBattiPage = lazy(() => import('./features/games/amiralbatti/AmiralBattiPage').then((m) => ({ default: m.AmiralBattiPage })))
const BlackjackPage = lazy(() => import('./features/games/blackjack/BlackjackPage').then((m) => ({ default: m.BlackjackPage })))
const CalendarPage = lazy(() => import('./features/calendar/CalendarPage').then((m) => ({ default: m.CalendarPage })))

const IMPLEMENTED_PATHS = new Set(['/', '/protokol', '/ayarlar', '/kullanici-yonetimi', '/basin-rehberi', '/kisiler', '/gantt', '/profil', '/bildirimler', '/yapilacaklar', '/harita', '/oyunlar', '/takvim'])

function PageFallback() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <Spinner />
    </div>
  )
}

function App() {
  return (
    <Routes>
      <Route path="/giris" element={<LoginPage />} />
      <Route path="/onay-bekliyor" element={<AccountStatusPage kind="pending" />} />
      <Route path="/erisim-kisitlandi" element={<AccountStatusPage kind="blocked" />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route index element={<Suspense fallback={<PageFallback />}><DashboardPage /></Suspense>} />
          <Route path="/protokol" element={<Suspense fallback={<PageFallback />}><ProtocolPage /></Suspense>} />
          <Route path="/ayarlar" element={<Suspense fallback={<PageFallback />}><SettingsPage /></Suspense>} />
          <Route path="/kullanici-yonetimi" element={<Suspense fallback={<PageFallback />}><UserManagementPage /></Suspense>} />
          <Route path="/basin-rehberi" element={<Suspense fallback={<PageFallback />}><PressDirectoryPage /></Suspense>} />
          <Route path="/kisiler" element={<Suspense fallback={<PageFallback />}><ContactsPage /></Suspense>} />
          <Route path="/gantt" element={<Suspense fallback={<PageFallback />}><GanttPage /></Suspense>} />
          <Route path="/profil" element={<Suspense fallback={<PageFallback />}><ProfilePage /></Suspense>} />
          <Route path="/bildirimler" element={<Suspense fallback={<PageFallback />}><NotificationsPage /></Suspense>} />
          <Route path="/yapilacaklar" element={<Suspense fallback={<PageFallback />}><KanbanPage /></Suspense>} />
          <Route path="/harita" element={<Suspense fallback={<PageFallback />}><MapPage /></Suspense>} />
          <Route path="/oyunlar" element={<Suspense fallback={<PageFallback />}><GamesPage /></Suspense>} />
          <Route path="/oyunlar/wordle" element={<Suspense fallback={<PageFallback />}><WordlePage /></Suspense>} />
          <Route path="/oyunlar/kour" element={<Suspense fallback={<PageFallback />}><KourPage /></Suspense>} />
          <Route path="/oyunlar/mayin-tarlasi" element={<Suspense fallback={<PageFallback />}><MayinTarlasiPage /></Suspense>} />
          <Route path="/oyunlar/geoguesser" element={<Suspense fallback={<PageFallback />}><GeoguesserPage /></Suspense>} />
          <Route path="/oyunlar/tetris" element={<Suspense fallback={<PageFallback />}><TetrisPage /></Suspense>} />
          <Route path="/oyunlar/satranc" element={<Suspense fallback={<PageFallback />}><ChessPage /></Suspense>} />
          <Route path="/oyunlar/amiral-batti" element={<Suspense fallback={<PageFallback />}><AmiralBattiPage /></Suspense>} />
          <Route path="/oyunlar/blackjack" element={<Suspense fallback={<PageFallback />}><BlackjackPage /></Suspense>} />
          <Route path="/takvim" element={<Suspense fallback={<PageFallback />}><CalendarPage /></Suspense>} />
          {NAV_ITEMS.filter((item) => !IMPLEMENTED_PATHS.has(item.path)).map((item) => (
            <Route key={item.key} path={item.path} element={<PlaceholderPage title={item.text} />} />
          ))}
          <Route path="*" element={<PlaceholderPage title="Sayfa bulunamadı" />} />
        </Route>
      </Route>
    </Routes>
  )
}

export default App
