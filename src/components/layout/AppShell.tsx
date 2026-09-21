import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { DbModeBanner } from '../DbModeBanner'
import { OfflineBanner } from '../pwa/OfflineBanner'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'

export function AppShell() {
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <Sidebar isMobileOpen={isMobileNavOpen} isCollapsed={isSidebarCollapsed} onClose={() => setIsMobileNavOpen(false)} onToggleCollapse={() => setIsSidebarCollapsed((collapsed) => !collapsed)} />
      <div className={`flex min-w-0 flex-1 flex-col transition-[padding] duration-200 ${isSidebarCollapsed ? 'lg:pl-20' : 'lg:pl-64'}`}>
        <OfflineBanner />
        <DbModeBanner />
        <Topbar onOpenMenu={() => setIsMobileNavOpen(true)} />
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <Outlet />
        </main>
        <footer className="px-4 py-4 text-xs text-muted sm:px-6 lg:px-8">
          <span>© 2026 Arda Bilasa. Tüm hakları saklıdır.</span>
        </footer>
      </div>
    </div>
  )
}
