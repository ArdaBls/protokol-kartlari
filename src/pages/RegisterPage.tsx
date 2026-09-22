import { Button, Card, Input, Label, TextField } from '@heroui/react'
import { FirebaseError } from 'firebase/app'
import { createUserWithEmailAndPassword, signOut, updateProfile } from 'firebase/auth'
import { ref, serverTimestamp, set } from 'firebase/database'
import type { FormEvent } from 'react'
import { useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { FullScreenSpinner } from '../auth/RequireAuth'
import { useAuth } from '../auth/useAuth'
import { auth, db } from '../lib/firebase'

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
  const { state } = useAuth()
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordAgain, setPasswordAgain] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  if (state.status === 'loading') return <FullScreenSpinner />
  if (state.status === 'pending') return <Navigate to="/onay-bekliyor" replace />
  if (state.status !== 'guest') return <Navigate to="/" replace />

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const first = firstName.trim()
    const last = lastName.trim()
    const normalizedEmail = email.trim()
    if (!first || !last) return setError('Ad ve soyad alanlarını doldurun.')
    if (password.length < 6) return setError('Şifre en az 6 karakter olmalı.')
    if (password !== passwordAgain) return setError('Şifreler eşleşmiyor.')

    setError(null)
    setIsSubmitting(true)
    try {
      const credential = await createUserWithEmailAndPassword(auth, normalizedEmail, password)
      const displayName = `${first} ${last}`.trim()
      await updateProfile(credential.user, { displayName })
      await set(ref(db, `users/${credential.user.uid}`), {
        firstName: first,
        lastName: last,
        email: normalizedEmail,
        role: 'pending',
        createdAt: serverTimestamp(),
      })
    } catch (err) {
      console.error('Kayıt başarısız:', err)
      await signOut(auth).catch(() => undefined)
      setError(registerErrorMessage(err))
    } finally {
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
            <TextField type="email" name="email" autoComplete="email" isRequired value={email} onChange={setEmail}>
              <Label>E-posta</Label>
              <Input placeholder="ornek@omu.edu.tr" />
            </TextField>
            <TextField type="password" name="password" autoComplete="new-password" isRequired value={password} onChange={setPassword}>
              <Label>Şifre</Label>
              <Input />
            </TextField>
            <TextField type="password" name="passwordAgain" autoComplete="new-password" isRequired value={passwordAgain} onChange={setPasswordAgain}>
              <Label>Şifre tekrar</Label>
              <Input />
            </TextField>
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            <Button type="submit" fullWidth isPending={isSubmitting}>Kayıt ol</Button>
          </form>
        </Card.Content>
        <Card.Footer className="justify-center pt-0 text-sm text-muted">
          Zaten hesabın var mı? <Link to="/giris" className="font-semibold text-accent hover:underline">Giriş yap</Link>
        </Card.Footer>
      </Card>
    </div>
  )
}
