import { Card, Input, TextField } from '@heroui/react'
import { ChevronDown, Search, SearchX } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useMemo, useState } from 'react'
import { EASE_OUT } from '../../lib/ease'
import type { FaqCategory } from './faqData'
import { FAQ_CATEGORIES, FAQ_ITEMS } from './faqData'

const normalize = (text: string) => text.toLocaleLowerCase('tr-TR')

export function HelpCenterPage() {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<FaqCategory | 'all'>('all')
  const [openId, setOpenId] = useState<string | null>(null)

  const results = useMemo(() => {
    const q = normalize(query.trim())
    return FAQ_ITEMS.filter((item) => category === 'all' || item.category === category).filter(
      (item) => !q || normalize(item.question).includes(q) || normalize(item.searchText).includes(q),
    )
  }, [query, category])

  const selectCategory = (next: FaqCategory | 'all') => {
    setCategory(next)
    setOpenId(null)
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wider text-muted">Destek</div>
        <h1 className="mt-1 text-2xl font-semibold">Yardım merkezi</h1>
      </div>

      <section className="relative overflow-hidden rounded-3xl bg-surface px-6 py-10 text-center shadow-[var(--surface-shadow)] sm:py-14">
        <div aria-hidden="true" className="pointer-events-none absolute -top-24 left-1/2 size-80 -translate-x-1/2 rounded-full bg-accent/25 blur-3xl" />
        <div className="relative mx-auto flex max-w-xl flex-col items-center gap-3">
          <h2 className="text-2xl font-semibold sm:text-3xl">Nasıl yardımcı olabiliriz?</h2>
          <p className="text-sm text-muted">Sık sorulan sorular arasında arama yapın veya kategorilere göz atın.</p>
          <TextField value={query} onChange={(value) => { setQuery(value); setOpenId(null) }} aria-label="Sık sorulan sorularda ara" className="relative mt-2 w-full">
            <Search size={16} className="pointer-events-none absolute left-4 top-1/2 z-10 -translate-y-1/2 text-muted" />
            <Input placeholder="Örn. 'şifre sıfırlama'…" className="h-12 pl-11" autoComplete="off" />
          </TextField>
        </div>
      </section>

      <Card>
          <Card.Header>
            <Card.Title>Sık sorulan sorular</Card.Title>
          </Card.Header>
          <Card.Content className="flex flex-col gap-4">
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="group" aria-label="Kategoriler">
              {FAQ_CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  aria-pressed={category === cat.id}
                  onClick={() => selectCategory(cat.id)}
                  className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                    category === cat.id ? 'bg-accent text-accent-foreground' : 'bg-default text-foreground/80 hover:bg-default-hover'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            {results.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10 text-center">
                <SearchX size={28} className="text-muted" />
                <div className="font-medium">Sonuç bulunamadı</div>
                <div className="text-sm text-muted">Farklı bir anahtar kelime deneyin veya bir kategoriye göz atın.</div>
              </div>
            ) : (
              <ul className="flex flex-col gap-2">
                {results.map((faq) => {
                  const isOpen = openId === faq.id
                  return (
                    <li key={faq.id} className={`rounded-2xl border transition-colors ${isOpen ? 'border-accent/40 bg-accent-soft' : 'border-separator bg-surface-secondary/40'}`}>
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        onClick={() => setOpenId(isOpen ? null : faq.id)}
                        className="flex w-full items-center gap-3 px-4 py-3.5 text-left text-sm font-medium"
                      >
                        <span className="flex-1">{faq.question}</span>
                        <ChevronDown size={16} className={`shrink-0 text-muted transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} />
                      </button>
                      <AnimatePresence initial={false}>
                        {isOpen && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.3, ease: EASE_OUT }}
                            className="overflow-hidden"
                          >
                            <p className="px-4 pb-4 text-sm leading-relaxed text-foreground/80">{faq.answer}</p>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </li>
                  )
                })}
              </ul>
            )}
          </Card.Content>
        </Card>
    </div>
  )
}
