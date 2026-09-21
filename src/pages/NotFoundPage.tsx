import { Button } from '@heroui/react'
import { useNavigate } from 'react-router-dom'

/** Uygulama dışındaki yollar için herkese açık, mauve temalı 404 ekranı. */
export function NotFoundPage() {
  const navigate = useNavigate()

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-8">
      <div className="flex w-full max-w-md flex-col items-center text-center">
        <span className="mb-3 text-7xl font-semibold leading-none text-accent">404</span>
        <h1 className="text-xl font-semibold">Sayfa bulunamadı</h1>
        <p className="mt-2 text-sm text-muted">
          Aradığınız sayfa mevcut değil veya taşınmış olabilir.
        </p>
        <Button className="mt-6" onPress={() => navigate('/')}>Ana sayfaya dön</Button>
      </div>
    </div>
  )
}
