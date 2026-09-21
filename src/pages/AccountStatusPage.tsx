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
                    <span className="notfound_text">NO SIGNAL</span>
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

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4">
      {kind === 'blocked' && (
        <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 opacity-35">
          <div className="access-tv-wrap">
            <AccessTv />
          </div>
        </div>
      )}
      <Card className="relative z-10 w-full max-w-md text-center">
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
