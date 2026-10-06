import { Button, Card } from '@heroui/react'
import { useState } from 'react'
import { useAuth } from './useAuth'

export function AccountAccessIssue() {
  const { state, retryProfile, signOutUser } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const isMissing = state.status === 'missing'

  const leave = async () => {
    try {
      await signOutUser()
    } catch {
      setError('Çıkış yapılamadı. Lütfen tekrar deneyin.')
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md text-center">
        <Card.Header className="items-center">
          <Card.Title>{isMissing ? 'Hesap profili bulunamadı' : 'Hesap bilgileri okunamadı'}</Card.Title>
          <Card.Description>
            {isMissing
              ? 'Profilin silinmiş veya kaydın yarım kalmış olabilir. Çıkış yapıp aynı e-posta ve şifreyle yeniden giriş yaparak hesabını yönetici onayına gönderebilirsin.'
              : 'Hesabının onay durumu doğrulanamadı. Bağlantını kontrol edip tekrar dene.'}
          </Card.Description>
        </Card.Header>
        {error && <Card.Content><p role="alert" className="text-sm text-danger">{error}</p></Card.Content>}
        <Card.Footer className="justify-center gap-2">
          {!isMissing && <Button onPress={retryProfile}>Tekrar dene</Button>}
          <Button variant="tertiary" onPress={() => { void leave() }}>Çıkış yap</Button>
        </Card.Footer>
      </Card>
    </div>
  )
}
