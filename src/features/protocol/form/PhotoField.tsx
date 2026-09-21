import { Button, toast } from '@heroui/react'
import { ImageIcon, Trash2, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { TextInputField } from '../../../components/formControls'
import { compressImageFile } from '../photo'
import { safePhotoUrl } from '../protocolRules'

const isHttpUrl = (value: string) => /^https?:\/\//i.test(value.trim())

interface PhotoFieldProps {
  value: string
  onChange: (photo: string) => void
}

export function PhotoField({ value, onChange }: PhotoFieldProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [url, setUrl] = useState(() => (isHttpUrl(value) ? value : ''))
  const [isCompressing, setIsCompressing] = useState(false)
  const preview = safePhotoUrl(value)

  const handleUrl = (next: string) => {
    setUrl(next)
    if (isHttpUrl(next)) onChange(next.trim())
  }

  const handleFile = async (file?: File) => {
    if (!file) return
    setIsCompressing(true)
    try {
      onChange(await compressImageFile(file))
      setUrl('')
    } catch (err) {
      console.error('Fotoğraf sıkıştırılamadı:', err)
      toast.danger('Fotoğraf okunamadı, başka bir dosya deneyin.')
    } finally {
      setIsCompressing(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-4 sm:flex-row">
      <div className="flex size-24 shrink-0 self-center items-center justify-center overflow-hidden rounded-2xl bg-surface-secondary text-muted sm:self-start">
        {preview ? <img src={preview} alt="Fotoğraf önizlemesi" className="size-full object-cover" /> : <ImageIcon size={28} strokeWidth={1.5} />}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <TextInputField label="Fotoğraf bağlantısı (URL)" type="url" value={url} onChange={handleUrl} placeholder="https://… (önerilen)" className="w-full" />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" isPending={isCompressing} onPress={() => fileRef.current?.click()}>
            <Upload size={14} />
            Cihazdan yükle
          </Button>
          {preview && (
            <Button size="sm" variant="ghost" onPress={() => { onChange(''); setUrl('') }}>
              <Trash2 size={14} />
              Kaldır
            </Button>
          )}
        </div>
        <p className="text-xs text-muted">Yüz net ve dik olmalı. Yüklenen fotoğraf sıkıştırılır; URL veritabanını şişirmez.</p>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(event) => handleFile(event.target.files?.[0])} />
      </div>
    </div>
  )
}
