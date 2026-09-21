import { Input, Label, TextField } from '@heroui/react'
import type { LucideIcon } from 'lucide-react'
import { ChevronDown } from 'lucide-react'
import type { HTMLAttributes, ReactNode } from 'react'
import { useId } from 'react'

const CONTROL =
  'w-full border border-[var(--field-border)] bg-[var(--field-background)] text-sm text-[var(--field-foreground)] shadow-[var(--field-shadow)] outline-none transition-colors placeholder:text-[var(--field-placeholder)] hover:border-[var(--field-border-hover)] focus-visible:border-[var(--focus)] disabled:cursor-not-allowed disabled:opacity-50'

export function FieldLabel({ htmlFor, children }: { htmlFor?: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="text-sm font-medium">
      {children}
    </label>
  )
}

interface FormSectionProps {
  title: string
  icon?: LucideIcon
  description?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}

/** Formlarda başlıklı, ikonlu bölüm kartı: ilgili alanları görsel olarak gruplar. */
export function FormSection({ title, icon: Icon, description, action, children, className = '' }: FormSectionProps) {
  return (
    <section className={`flex flex-col gap-4 rounded-2xl border border-separator bg-surface-secondary/40 p-4 ${className}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          {Icon && (
            <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
              <Icon size={16} />
            </span>
          )}
          <div>
            <h3 className="text-sm font-semibold leading-tight">{title}</h3>
            {description && <p className="text-xs text-muted">{description}</p>}
          </div>
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

interface TextInputFieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  type?: 'text' | 'date' | 'url' | 'email'
  placeholder?: string
  isRequired?: boolean
  isDisabled?: boolean
  autoFocus?: boolean
  list?: string
  inputMode?: HTMLAttributes<HTMLInputElement>['inputMode']
  maxLength?: number
  className?: string
}

export function TextInputField({ label, value, onChange, type = 'text', placeholder, isRequired, isDisabled, autoFocus, list, inputMode, maxLength, className }: TextInputFieldProps) {
  return (
    <TextField type={type} value={value} onChange={onChange} isRequired={isRequired} isDisabled={isDisabled} autoFocus={autoFocus} maxLength={maxLength} className={className}>
      <Label>{label}</Label>
      <Input placeholder={placeholder} list={list} inputMode={inputMode} autoComplete="off" />
    </TextField>
  )
}

interface SelectFieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  options: ReadonlyArray<{ value: string; label: string }>
  className?: string
}

export function SelectField({ label, value, onChange, options, className = '' }: SelectFieldProps) {
  const id = useId()
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className="relative">
        <select id={id} value={value} onChange={(event) => onChange(event.target.value)} className={`${CONTROL} h-10 appearance-none rounded-[var(--field-radius)] pl-4 pr-10`}>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown size={16} className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-muted" />
      </div>
    </div>
  )
}

interface TextAreaFieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  rows?: number
  placeholder?: string
  readOnly?: boolean
  className?: string
}

export function TextAreaField({ label, value, onChange, rows = 3, placeholder, readOnly, className = '' }: TextAreaFieldProps) {
  const id = useId()
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <textarea
        id={id}
        rows={rows}
        value={value}
        readOnly={readOnly}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className={`${CONTROL} resize-y rounded-2xl px-4 py-3 leading-relaxed`}
        data-copy-allowed
      />
    </div>
  )
}

export function Datalist({ id, values }: { id: string; values: Iterable<string> }) {
  return (
    <datalist id={id}>
      {[...values].sort((a, b) => a.localeCompare(b, 'tr')).map((value) => (
        <option key={value} value={value} />
      ))}
    </datalist>
  )
}
