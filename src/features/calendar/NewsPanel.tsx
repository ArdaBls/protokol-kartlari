import { Button, toast } from '@heroui/react'
import { useEffect, useMemo, useState } from 'react'
import { TextAreaField, TextInputField } from '../../components/formControls'
import type { Person } from '../protocol/protocolRules'
import { NEWS_CATEGORIES, NEWS_TEMPLATES, buildNewsText, templateFields } from '../protocol/newsText'
import type { Attendee } from './calendarTypes'

interface NewsPanelProps {
  attendees: Attendee[]
  defaultLocation: string
  defaultTitle: string
  onClose: () => void
}

const attendeeToPerson = (a: Attendee, index: number): Person => ({ _id: String(index), prefix: a.prefix, name: a.name, title: a.title, rank: a.rank })

/** "Protokol Sırası Al" sonrası açılan haber metni önizlemesi -- Protokol Kartları'ndaki
 * "Haber Çıktısı Al" ile aynı motoru (newsText.ts) kullanır. */
export function NewsPanel({ attendees, defaultLocation, defaultTitle, onClose }: NewsPanelProps) {
  const [templateId, setTemplateId] = useState(NEWS_TEMPLATES[0].id)
  const [location, setLocation] = useState(defaultLocation || defaultTitle)
  const [categories, setCategories] = useState<string[]>([])
  const [fields, setFields] = useState<Record<string, string>>({})
  const [output, setOutput] = useState('')
  const [isEdited, setIsEdited] = useState(false)

  const template = NEWS_TEMPLATES.find((t) => t.id === templateId) ?? NEWS_TEMPLATES[0]
  const visibleFields = useMemo(() => templateFields(template), [template])
  const people = useMemo(() => attendees.map(attendeeToPerson), [attendees])

  useEffect(() => {
    if (isEdited) return
    setOutput(buildNewsText(people, { templateId, location, categories, fields }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people, templateId, location, categories, fields])

  const toggleCategory = (value: string) =>
    setCategories((current) => (current.includes(value) ? current.filter((c) => c !== value) : [...current, value]))

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(output)
      toast.success('Panoya kopyalandı!')
    } catch {
      toast.danger('Kopyalanamadı, elle seçip kopyalayın.')
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-separator bg-surface-secondary/40 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Haber Metni Çıktısı</h3>
        <Button size="sm" variant="ghost" onPress={onClose}>Kapat</Button>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Haber Şablonu</span>
        <select
          value={templateId}
          onChange={(event) => setTemplateId(event.target.value)}
          className="h-10 rounded-[var(--field-radius)] border border-[var(--field-border)] bg-[var(--field-background)] px-3 text-sm outline-none hover:border-[var(--field-border-hover)]"
        >
          {NEWS_TEMPLATES.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </div>

      {visibleFields.map((field) => (
        <TextInputField
          key={field.key}
          label={field.label}
          value={fields[field.key] ?? ''}
          onChange={(value) => setFields((current) => ({ ...current, [field.key]: value }))}
        />
      ))}

      <TextInputField label="Etkinlik / Yer İfadesi" value={location} onChange={setLocation} />

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Katılımcı Grubu</span>
        <div className="flex flex-wrap gap-3">
          {NEWS_CATEGORIES.map((c) => (
            <label key={c.value} className="flex items-center gap-1.5 text-xs text-muted">
              <input type="checkbox" checked={categories.includes(c.value)} onChange={() => toggleCategory(c.value)} className="accent-[var(--accent)]" />
              {c.label}
            </label>
          ))}
        </div>
      </div>

      <TextAreaField label="Metin (elle düzenleyebilirsiniz)" rows={6} value={output} onChange={(value) => { setOutput(value); setIsEdited(true) }} />
      <div className="flex justify-end">
        <Button variant="secondary" onPress={copy}>Panoya Kopyala</Button>
      </div>
    </div>
  )
}
