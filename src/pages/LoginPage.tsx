import { Button, Card, Input, Label, TextField } from '@heroui/react'
import { FirebaseError } from 'firebase/app'
import { signInWithEmailAndPassword } from 'firebase/auth'
import type { FormEvent } from 'react'
import { useState } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { FullScreenSpinner } from '../auth/RequireAuth'
import { restoreMissingAccount } from '../auth/restoreMissingAccount'
import { useAuth } from '../auth/useAuth'
import { auth } from '../lib/firebase'

const CREDENTIAL_ERRORS = ['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found', 'auth/invalid-email']

function loginErrorMessage(err: unknown): string {
  const code = err instanceof FirebaseError ? err.code : ''
  if (CREDENTIAL_ERRORS.includes(code)) return 'E-posta veya şifre hatalı.'
  if (code === 'auth/too-many-requests') return 'Çok fazla başarısız deneme. Bir süre sonra tekrar deneyin.'
  if (code === 'auth/network-request-failed') return 'Bağlantı kurulamadı. İnternet bağlantınızı kontrol edin.'
  return 'Giriş yapılamadı. Lütfen tekrar deneyin.'
}

// Açık yönlendirmeye karşı yalnızca uygulama içi yollara dönülür.
function safeReturnPath(from: unknown): string {
  return typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') ? from : '/'
}

export function LoginPage() {
  const { state } = useAuth()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  if (state.status === 'loading') return <FullScreenSpinner />
  if (state.status !== 'guest') {
    return <Navigate to={safeReturnPath((location.state as { from?: unknown } | null)?.from)} replace />
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setIsSubmitting(true)
    try {
      const credential = await signInWithEmailAndPassword(auth, email.trim(), password)
      await restoreMissingAccount(credential.user)
    } catch (err) {
      console.error('Giriş başarısız:', err)
      setError(loginErrorMessage(err))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <Card.Header className="items-center text-center">
          <img src="/icons/icon-192.png" alt="Protokol" className="mb-2 size-11 object-contain" />
          <Card.Title className="text-xl">Protokol'e giriş yap</Card.Title>
          <Card.Description>OMÜ Basın ve Halkla İlişkiler paneli</Card.Description>
        </Card.Header>
        <Card.Content>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <TextField type="email" name="email" autoComplete="email" isRequired value={email} onChange={setEmail}>
              <Label>E-posta</Label>
              <Input placeholder="ornek@omu.edu.tr" />
            </TextField>
            <TextField type="password" name="password" autoComplete="current-password" isRequired value={password} onChange={setPassword}>
              <Label>Şifre</Label>
              <Input />
            </TextField>
            {error && (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
            <Button type="submit" fullWidth isPending={isSubmitting}>
              Giriş yap
            </Button>
          </form>
        </Card.Content>
        <Card.Footer className="justify-center pt-0 text-sm text-muted">
          Hesabın yok mu? <Link to="/kayit" className="font-semibold text-accent hover:underline">Kayıt ol</Link>
        </Card.Footer>
      </Card>
    </div>
  )
}
