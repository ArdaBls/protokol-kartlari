interface SwitchButtonProps {
  isOn: boolean
  isDisabled?: boolean
  onToggle: () => void
  label: string
  title?: string
  /** Açıkken tehlike rengi (ör. erişim kısıtlama). */
  isDangerWhenOn?: boolean
}

export function SwitchButton({ isOn, isDisabled, onToggle, label, title, isDangerWhenOn }: SwitchButtonProps) {
  const onColor = isDangerWhenOn ? 'bg-danger' : 'bg-accent'
  return (
    <button
      type="button"
      role="switch"
      aria-checked={isOn}
      aria-label={label}
      title={title ?? label}
      disabled={isDisabled}
      onClick={onToggle}
      className={`inline-flex h-7 w-12 shrink-0 items-center rounded-full p-1 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)] disabled:cursor-not-allowed disabled:opacity-50 ${
        isOn ? onColor : 'bg-default-hover'
      }`}
    >
      {/* Topuz akış içinde durur: yol 48px, iç boşluk 4px, topuz 20px → açıkken tam 20px kayar, dışarı taşmaz. */}
      <span className={`size-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${isOn ? 'translate-x-5' : 'translate-x-0'}`} />
    </button>
  )
}
