import { useEffect, useRef, useState } from 'react'
import { SearchablePicker, type PickerOption } from './SearchablePicker'
import { SegmentedControl } from './ui/SegmentedControl'

/** FormData-compatible choice for the existing uncontrolled treasury forms. */
export default function TreasuryFormChoice({ name, label, options, defaultValue, segmented = false, required = false, disabled = false }: {
  name: string; label: string; options: PickerOption[]; defaultValue?: string; segmented?: boolean; required?: boolean; disabled?: boolean
}) {
  const initial = defaultValue ?? options[0]?.id ?? ''
  const [value, setValue] = useState(initial)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const form = root.current?.closest('form')
    const reset = () => setValue(initial)
    form?.addEventListener('reset', reset)
    return () => form?.removeEventListener('reset', reset)
  }, [initial])
  return <div ref={root} className="ec-finance-field"><span>{label}</span>{segmented
    ? <><SegmentedControl name={name} ariaLabel={label} value={value} onChange={setValue} disabled={disabled} options={options.map(option => ({ value: option.id, label: option.label, disabled: option.disabled }))} />{required && <input className="ec-combobox-validation" aria-label={label} tabIndex={-1} required value={value} disabled={disabled} onChange={() => {}} />}</>
    : <SearchablePicker name={name} ariaLabel={label} value={value} onChange={setValue} options={options} required={required} disabled={disabled} />}</div>
}
