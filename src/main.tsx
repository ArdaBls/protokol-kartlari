import { Toast } from '@heroui/react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import './styles/status-pages.css'
import App from './App.tsx'
import { AuthProvider } from './auth/AuthProvider'
import { PwaUpdater } from './components/pwa/PwaUpdater'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
        {/* Üstte: alt kenardaki seçim çubuğu ve filtre düğmesiyle çakışmasın. */}
        <Toast.Provider placement="top" />
        <PwaUpdater />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
