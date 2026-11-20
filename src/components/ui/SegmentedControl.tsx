import { type CSSProperties, useId } from 'react'
import '../../enterprise-ui.css'

/** Native radios provide keyboard navigation and form participation. */
export function SegmentedControl<T extends string>({ value, onChange, options, ariaLabel, name, disabled = false, className = '' }: {
  value: T; onChange: (value: T) => void; options: readonly { value: T; label: string; disabled?: boolean }[]; ariaLabel: string; name?: string; disabled?: boolean; className?: string
}) {
  const id = useId()
  const activeIndex = Math.max(0, options.findIndex(option => option.value === value))
  const count = Math.max(1, options.length)
  return (
    <div
      className={`ec-segments ${className}`.trim()}
      role="radiogroup"
      aria-label={ariaLabel}
      style={{ '--seg-count': count, '--seg-index': activeIndex } as CSSProperties}
    >
      <span className="ec-segment-thumb" aria-hidden="true" />
      {options.map(option => (
        <label className={`ec-segment ${value === option.value ? 'is-active' : ''}`.trim()} key={option.value}>
          <input
            type="radio"
            name={name ?? id}
            value={option.value}
            checked={value === option.value}
            disabled={disabled || option.disabled}
            onChange={() => onChange(option.value)}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  )
}
