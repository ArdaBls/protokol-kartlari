import { Button, Card } from '@heroui/react'
import { Navigate } from 'react-router-dom'
import { FullScreenSpinner } from '../auth/RequireAuth'
import { useAuth } from '../auth/useAuth'

const CONTENT = {
  pending: {
    title: 'Hesabın onay bekliyor',
    description: 'Kaydın alındı. Bir yönetici hesabını onayladığında panel otomatik olarak açılacak.',
  },
  blocked: {
    title: 'Erişimin kısıtlandı',
    description: 'Hesabının panele erişimi bir yönetici tarafından kapatıldı. Engel kaldırıldığında otomatik olarak geri döneceksin.',
  },
} as const

export function AccountStatusPage({ kind }: { kind: keyof typeof CONTENT }) {
  const { state, signOutUser } = useAuth()

  if (state.status === 'loading') return <FullScreenSpinner />
  if (state.status === 'guest') return <Navigate to="/giris" replace />
  if (state.status !== kind) return <Navigate to="/" replace />

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md text-center">
        <Card.Header className="items-center">
          <Card.Title className="text-xl">{CONTENT[kind].title}</Card.Title>
          <Card.Description>{CONTENT[kind].description}</Card.Description>
        </Card.Header>
        <Card.Footer className="justify-center">
          <Button variant="tertiary" onPress={() => signOutUser()}>
            Çıkış yap
          </Button>
        </Card.Footer>
      </Card>
    </div>
  )
}
