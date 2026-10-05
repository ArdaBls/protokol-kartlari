import Fuse from 'fuse.js'
import { Search, X } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { CalendarEventWithId } from './calendarTypes'
import { fmtTrDate, parseKey } from './calendarTypes'

interface CalendarSearchProps {
  events: CalendarEventWithId[]
  onGoToDate: (date: string) => void
}

export function CalendarSearch({ events, onGoToDate }: CalendarSearchProps) {
  const [query, setQuery] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()

  const datedEvents = useMemo(() => events.filter((event) => !!parseKey(event.tarih)), [events])
  const fuse = useMemo(() => new Fuse(datedEvents, {
    keys: ['ad'],
    threshold: 0.35,
    ignoreLocation: true,
  }), [datedEvents])
  const results = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('tr')
    if (!normalized) return []
    const exact = datedEvents.filter((event) => (event.ad ?? '').toLocaleLowerCase('tr').includes(normalized))
    return exact.length ? exact : fuse.search(normalized).map((result) => result.item)
  }, [datedEvents, fuse, query])

  useEffect(() => {
    if (!isOpen) return
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false)
        inputRef.current?.blur()
      }
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [isOpen])

  const choose = (event: CalendarEventWithId) => {
    if (!event.tarih) return
    onGoToDate(event.tarih)
    setQuery('')
    setIsOpen(false)
    inputRef.current?.blur()
  }

  return (
    <div ref={rootRef} className="relative min-w-0 flex-1 sm:w-60 sm:flex-none">
      <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
      <input
        ref={inputRef}
        type="search"
        value={query}
        onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); setIsOpen(true) }}
        onFocus={() => setIsOpen(true)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') { setIsOpen(false); inputRef.current?.blur() }
          if (!isOpen || !results.length) return
          if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex((index) => (index + 1) % results.length) }
          if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((index) => (index - 1 + results.length) % results.length) }
          if (event.key === 'Enter') { event.preventDefault(); choose(results[activeIndex] ?? results[0]) }
        }}
        placeholder="Etkinlik ara…"
        aria-label="Etkinlik ara"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={isOpen && !!query.trim()}
        aria-controls={listId}
        aria-activedescendant={isOpen && results.length ? `${listId}-${activeIndex}` : undefined}
        className="h-9 w-full min-w-0 rounded-xl border border-[var(--field-border)] bg-[var(--field-background)] pl-9 pr-8 text-base text-[var(--field-foreground)] outline-none placeholder:text-[var(--field-placeholder)] focus:border-[var(--field-border-focus)] sm:text-sm"
      />
      {query && (
        <button type="button" aria-label="Aramayı temizle" onClick={() => { setQuery(''); setIsOpen(false); inputRef.current?.focus() }} className="absolute right-2 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted hover:bg-default">
          <X size={14} />
        </button>
      )}
      {isOpen && !!query.trim() && (
        <div id={listId} role="listbox" aria-label="Etkinlik arama sonuçları" className="absolute inset-x-0 top-full z-50 mt-1 max-h-72 min-w-64 overflow-y-auto overscroll-contain rounded-xl border border-separator bg-overlay p-1 shadow-[var(--overlay-shadow)]">
          {results.length ? results.map((event, index) => (
            <button
              key={event._id}
              id={`${listId}-${index}`}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              onPointerEnter={() => setActiveIndex(index)}
              onClick={() => choose(event)}
              className={`flex w-full min-w-0 flex-col rounded-lg px-3 py-2 text-left text-sm ${index === activeIndex ? 'bg-default' : 'hover:bg-default'}`}
            >
              <span className="w-full truncate font-medium">{event.ad || '(adsız)'}</span>
              <span className="text-xs text-muted">{fmtTrDate(event.tarih)}{event.saat ? ` · ${event.saat}` : ''}</span>
            </button>
          )) : <p className="px-3 py-2 text-sm text-muted">Etkinlik bulunamadı.</p>}
        </div>
      )}
    </div>
  )
}
