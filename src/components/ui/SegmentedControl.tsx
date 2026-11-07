import { useId } from 'react'
import '../../enterprise-ui.css'

/** Native radios provide keyboard navigation and form participation. */
export function SegmentedControl<T extends string>({ value, onChange, options, ariaLabel, name, disabled = false }: {
  value: T; onChange: (value: T) => void; options: readonly { value: T; label: string; disabled?: boolean }[]; ariaLabel: string; name?: string; disabled?: boolean
}) {
  const id = useId()
  return <div className="ec-segments" role="radiogroup" aria-label={ariaLabel}>
    {options.map(option => <label className="ec-segment" key={option.value}>
      <input type="radio" name={name ?? id} value={option.value} checked={value === option.value} disabled={disabled || option.disabled} onChange={() => onChange(option.value)} />
      <span>{option.label}</span>
    </label>)}
  </div>
}
