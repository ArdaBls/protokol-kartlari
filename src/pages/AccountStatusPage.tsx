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

function AccessTv() {
  return (
    <div className="access-tv" aria-hidden="true">
      <div className="main_wrapper">
        <div className="tv-main">
          <div className="antenna">
            <div className="antenna_shadow" />
            <div className="a1" />
            <div className="a1d" />
            <div className="a2" />
            <div className="a2d" />
          </div>
          <div className="tv">
            <div className="display_div">
              <div className="screen_out">
                <div className="screen_out1">
                  <div className="screen">
                    <span className="access-denied-text">Erişiminiz kısıtlandı</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="buttons_div">
              <div className="b1"><div /></div>
              <div className="b2" />
              <div className="speakers">
                <div className="g1"><div className="g11" /><div className="g12" /><div className="g13" /></div>
                <div className="g" />
                <div className="g" />
                <div className="g" />
              </div>
            </div>
          </div>
          <div className="bottom">
            <div className="base1" />
            <div className="base2" />
            <div className="base3" />
          </div>
        </div>
        <div className="text_404" aria-hidden="true">
          <span className="text_4041">4</span>
          <span className="text_4042">0</span>
          <span className="text_4043">4</span>
        </div>
      </div>
    </div>
  )
}

export function AccountStatusPage({ kind }: { kind: keyof typeof CONTENT }) {
  const { state, signOutUser } = useAuth()

  if (state.status === 'loading') return <FullScreenSpinner />
  if (state.status === 'guest') return <Navigate to="/giris" replace />
  if (state.status !== kind) return <Navigate to="/" replace />

  if (kind === 'blocked') {
    return (
      <div className="flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-8">
        <div className="flex w-full max-w-md flex-col items-center text-center">
          <div className="access-tv-wrap opacity-35">
            <AccessTv />
          </div>
          <h1 className="text-xl font-semibold">{CONTENT.blocked.title}</h1>
          <p className="mt-2 text-sm text-muted">{CONTENT.blocked.description}</p>
          <Button className="mt-6" variant="tertiary" onPress={() => signOutUser()}>
            Çıkış yap
          </Button>
        </div>
      </div>
    )
  }

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
