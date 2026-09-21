import { Button, Checkbox, Modal, Tabs } from '@heroui/react'
import { Copy, Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import { ModalScrollBody, ModalShell, ModalTitle } from '../../components/ModalShell'
import { SelectField, TextAreaField, TextInputField } from '../../components/formControls'
import { copyToClipboard } from '../../lib/browserFiles'
import { NEWS_CATEGORIES, NEWS_TEMPLATES, PROMPT_CATEGORIES, buildNewsPrompt, buildNewsText, templateFields } from './newsText'
import type { Person } from './protocolRules'

interface NewsModalProps {
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
  people: Person[]
}

const TEMPLATE_SELECT = NEWS_TEMPLATES.map((template) => ({ value: template.id, label: template.name }))

function NewsForm({ people }: { people: Person[] }) {
  const [mode, setMode] = useState<'template' | 'prompt'>('template')
  const [templateId, setTemplateId] = useState(NEWS_TEMPLATES[0].id)
  const [location, setLocation] = useState('Törene')
  const [categories, setCategories] = useState<string[]>([])
  const [fields, setFields] = useState<Record<string, string>>({})
  // Kullanıcı üretilen metni elle düzenleyebilir; girdilerden biri değişince yeniden üretilir.
  const [editedText, setEditedText] = useState<string | null>(null)
  const [promptCategory, setPromptCategory] = useState('genel')
  const [rawNotes, setRawNotes] = useState('')
  const [promptOutput, setPromptOutput] = useState('')

  const template = NEWS_TEMPLATES.find((item) => item.id === templateId) ?? NEWS_TEMPLATES[0]
  const generated = useMemo(
    () => buildNewsText(people, { templateId, location, categories, fields }),
    [people, templateId, location, categories, fields],
  )
  const text = editedText ?? generated

  const withReset = <T,>(setter: (value: T) => void) => (value: T) => { setter(value); setEditedText(null) }
  const toggleCategory = (value: string) =>
    withReset(setCategories)(categories.includes(value) ? categories.filter((c) => c !== value) : [...categories, value])

  return (
    <>
      <ModalTitle title="Haber metni" description={`${people.length} kişi · protokol sırasına göre dizilir`} />
      <div className="px-6">
        <Tabs selectedKey={mode} onSelectionChange={(key) => setMode(key as 'template' | 'prompt')}>
          <Tabs.ListContainer>
            <Tabs.List aria-label="Üretim yöntemi">
              <Tabs.Tab id="template">Şablonla oluştur<Tabs.Indicator /></Tabs.Tab>
              <Tabs.Tab id="prompt">Yapay zekâya hazırla<Tabs.Indicator /></Tabs.Tab>
            </Tabs.List>
          </Tabs.ListContainer>
        </Tabs>
      </div>

      <ModalScrollBody className="pt-4">
        {mode === 'template' ? (
          <>
            <SelectField label="Haber şablonu" value={templateId} onChange={withReset(setTemplateId)} options={TEMPLATE_SELECT} />
            {templateFields(template).map((field) => (
              <TextInputField
                key={field.key}
                label={field.label}
                value={fields[field.key] ?? ''}
                onChange={withReset((value: string) => setFields((current) => ({ ...current, [field.key]: value })))}
              />
            ))}
            <TextInputField label="Etkinlik / yer ifadesi" value={location} onChange={withReset(setLocation)} />
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">Katılımcı grubu</span>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {NEWS_CATEGORIES.map((category) => (
                  <Checkbox key={category.value} isSelected={categories.includes(category.value)} onChange={() => toggleCategory(category.value)}>
                    <Checkbox.Content className="flex items-center gap-2 py-1 text-sm">
                      <Checkbox.Control className="border border-border"><Checkbox.Indicator /></Checkbox.Control>
                      {category.label}
                    </Checkbox.Content>
                  </Checkbox>
                ))}
              </div>
            </div>
            <TextAreaField label="Oluşturulan metin" value={text} onChange={setEditedText} rows={6} />
          </>
        ) : (
          <>
            <p className="text-sm text-muted">Yapay zekâya yapıştıracağınız, kurallar ve bağlam içeren hazır bir komut oluşturulur. Uygulama bu metni hiçbir servise göndermez.</p>
            <SelectField label="Haber türü" value={promptCategory} onChange={setPromptCategory} options={PROMPT_CATEGORIES} />
            <TextAreaField label="Ham notlarınız" value={rawNotes} onChange={setRawNotes} rows={6} placeholder="Konuşma metni, katılımcı listesi, etkinlik açıklaması…" />
            <Button variant="secondary" className="self-start" onPress={() => setPromptOutput(buildNewsPrompt(people, promptCategory, rawNotes))} isDisabled={!rawNotes.trim()}>
              <Sparkles size={16} />
              Komut oluştur
            </Button>
            <TextAreaField label="Oluşturulan komut" value={promptOutput} onChange={setPromptOutput} rows={8} readOnly />
          </>
        )}
      </ModalScrollBody>

      <Modal.Footer>
        <Button variant="tertiary" slot="close">Kapat</Button>
        <Button variant="primary" onPress={() => copyToClipboard(mode === 'template' ? text : promptOutput)}>
          <Copy size={16} />
          Panoya kopyala
        </Button>
      </Modal.Footer>
    </>
  )
}

export function NewsModal({ isOpen, onOpenChange, people }: NewsModalProps) {
  return (
    <ModalShell isOpen={isOpen} onOpenChange={onOpenChange} size="lg">
      <NewsForm people={people} />
    </ModalShell>
  )
}
