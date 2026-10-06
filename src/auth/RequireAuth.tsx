import { Spinner } from '@heroui/react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from './useAuth'
import { AccountAccessIssue } from './AccountAccessIssue'

export function FullScreenSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Spinner />
    </div>
  )
}

export function RequireAuth() {
  const { state } = useAuth()
  const location = useLocation()

  switch (state.status) {
    case 'loading':
      return <FullScreenSpinner />
    case 'guest':
      return <Navigate to="/giris" replace state={{ from: location.pathname + location.search }} />
    case 'pending':
      return <Navigate to="/onay-bekliyor" replace />
    case 'blocked':
      return <Navigate to="/erisim-kisitlandi" replace />
    case 'error':
    case 'missing':
      return <AccountAccessIssue />
    case 'ready':
      return <Outlet />
  }
}
