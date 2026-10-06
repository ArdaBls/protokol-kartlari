import { Button, Card, Input, Label, TextField } from '@heroui/react'
import { FirebaseError } from 'firebase/app'
import { createUserWithEmailAndPassword, updateProfile } from 'firebase/auth'
import type { User } from 'firebase/auth'
import type { FormEvent } from 'react'
import { useRef, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { FullScreenSpinner } from '../auth/RequireAuth'
import { useAuth } from '../auth/useAuth'
import { auth } from '../lib/firebase'
import { AccountAccessIssue } from '../auth/AccountAccessIssue'
import { finishRegistration, IncompleteRegistrationError } from '../auth/finishRegistration'
import { restoreMissingAccount } from '../auth/restoreMissingAccount'

function registerErrorMessage(err: unknown): string {
  const code = err instanceof FirebaseError ? err.code : ''
  if (code === 'auth/email-already-in-use') return 'Bu e-posta adresiyle zaten bir hesap var.'
  if (code === 'auth/invalid-email') return 'Geçerli bir e-posta adresi girin.'
  if (code === 'auth/weak-password' || code === 'auth/password-does-not-meet-requirements') return 'Şifre en az 6 karakter olmalı ve yeterince güçlü olmalı.'
  if (code === 'auth/operation-not-allowed') return 'E-posta ile kayıt şu anda etkin değil. Yöneticiyle iletişime geçin.'
  if (code === 'auth/network-request-failed') return 'Bağlantı kurulamadı. İnternet bağlantınızı kontrol edin.'
  return 'Kayıt oluşturulamadı. Lütfen tekrar deneyin.'
}

export function RegisterPage() {
  const { state, retryProfile } = useAuth()
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordAgain, setPasswordAgain] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [incompleteUser, setIncompleteUser] = useState<User | null>(null)
  const submitting = useRef(false)

  if (!isSubmitting && !incompleteUser && !error) {
    if (state.status === 'loading') return <FullScreenSpinner />
    if (state.status === 'error' || state.status === 'missing') return <AccountAccessIssue />
    if (state.status === 'pending') return <Navigate to="/onay-bekliyor" replace />
    if (state.status !== 'guest') return <Navigate to="/" replace />
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submitting.current) return
    const first = firstName.trim()
    const last = lastName.trim()
    const normalizedEmail = email.trim()
    if (!first || !last) return setError('Ad ve soyad alanlarını doldurun.')
    if (password.length < 6) return setError('Şifre en az 6 karakter olmalı.')
    if (password !== passwordAgain) return setError('Şifreler eşleşmiyor.')

    submitting.current = true
    setError(null)
    setIsSubmitting(true)
    try {
      if (incompleteUser && auth.currentUser?.uid !== incompleteUser.uid) {
        setError('Oturum değişti. Mevcut hesabınla giriş yaparak kaydını tamamlayabilirsin.')
        return
      }
      const result = await finishRegistration({
        user: incompleteUser,
        create: async () => (await createUserWithEmailAndPassword(auth, normalizedEmail, password)).user,
        save: (user) => restoreMissingAccount(user, { firstName: first, lastName: last }),
        syncName: (user) => updateProfile(user, { displayName: `${first} ${last}` }),
      })
      if (result.nameSyncError) console.warn('Profil kaydedildi; Auth adı eşitlenemedi:', result.nameSyncError)
      retryProfile()
      setIncompleteUser(null)
    } catch (err) {
      console.error('Kayıt başarısız:', err instanceof IncompleteRegistrationError ? err.cause : err)
      if (err instanceof IncompleteRegistrationError) {
        setIncompleteUser(err.user)
        setError('Giriş hesabın oluşturuldu ancak profilin kaydedilemedi. Kaydı tamamla düğmesiyle aynı hesabı kullanarak tekrar dene; yeniden hesap oluşturmana gerek yok.')
      } else {
        setError(registerErrorMessage(err))
      }
    } finally {
      submitting.current = false
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-8">
      <Card className="w-full max-w-sm">
        <Card.Header className="items-center text-center">
          <img src="/icons/icon-192.png" alt="Protokol" className="mb-2 size-11 object-contain" />
          <Card.Title className="text-xl">Protokol'e kayıt ol</Card.Title>
          <Card.Description>Kayıt olduktan sonra hesabın yönetici onayına gönderilir.</Card.Description>
        </Card.Header>
        <Card.Content>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField name="firstName" autoComplete="given-name" isRequired value={firstName} onChange={setFirstName}>
                <Label>Ad</Label>
                <Input />
              </TextField>
              <TextField name="lastName" autoComplete="family-name" isRequired value={lastName} onChange={setLastName}>
                <Label>Soyad</Label>
                <Input />
              </TextField>
            </div>
            <TextField type="email" name="email" autoComplete="email" isRequired isDisabled={!!incompleteUser} value={email} onChange={setEmail}>
              <Label>E-posta</Label>
              <Input placeholder="ornek@omu.edu.tr" />
            </TextField>
            <TextField type="password" name="password" autoComplete="new-password" isRequired isDisabled={!!incompleteUser} value={password} onChange={setPassword}>
              <Label>Şifre</Label>
              <Input />
            </TextField>
            <TextField type="password" name="passwordAgain" autoComplete="new-password" isRequired isDisabled={!!incompleteUser} value={passwordAgain} onChange={setPasswordAgain}>
              <Label>Şifre tekrar</Label>
              <Input />
            </TextField>
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            <Button type="submit" fullWidth isPending={isSubmitting}>{incompleteUser ? 'Kaydı tamamla' : 'Kayıt ol'}</Button>
          </form>
        </Card.Content>
        <Card.Footer className="justify-center pt-0 text-sm text-muted">
          Zaten hesabın var mı? <Link to="/giris" className="font-semibold text-accent hover:underline">Giriş yap</Link>
        </Card.Footer>
      </Card>
    </div>
  )
}
