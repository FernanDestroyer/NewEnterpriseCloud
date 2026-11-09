import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, ChevronLeft, ChevronRight, Search, X } from 'lucide-react'
import './picker.css'

export type PickerOption = {
  id: string
  label: string
  detail?: string
  disabled?: boolean
}

type Mode = 'popover' | 'modal'
type Position = { left: number; width: number; top?: number; bottom?: number }

type Props = {
  value: string
  options: PickerOption[]
  onChange: (id: string) => void
  ariaLabel: string
  name?: string
  placeholder?: string
  searchPlaceholder?: string
  emptyMessage?: string
  disabled?: boolean
  required?: boolean
  pageSize?: number
  /** `popover` para filtros y formularios internos; `modal` para selecciones amplias como Ventas. */
  mode?: Mode
}

const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

function computePosition(rect: DOMRect): Position {
  const width = Math.min(Math.max(rect.width, 320), window.innerWidth - 16)
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))
  const fitsBelow = window.innerHeight - rect.bottom >= 300
  return fitsBelow
    ? { left, width, top: rect.bottom + 6 }
    : { left, width, bottom: Math.max(8, window.innerHeight - rect.top + 6) }
}

export function SearchablePicker({
  value,
  options,
  onChange,
  ariaLabel,
  name,
  placeholder = 'Selecciona una opción',
  searchPlaceholder = 'Buscar…',
  emptyMessage = 'No encontramos coincidencias.',
  disabled = false,
  required = false,
  pageSize,
  mode = 'popover',
}: Props) {
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [position, setPosition] = useState<Position | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const limit = pageSize ?? (mode === 'modal' ? 6 : 3)
  const selected = options.find(option => option.id === value)

  const filtered = useMemo(() => {
    const term = normalize(query.trim())
    if (!term) return options
    return options.filter(option => normalize(`${option.label} ${option.detail ?? ''}`).includes(term))
  }, [options, query])

  const pageCount = Math.max(1, Math.ceil(filtered.length / limit))
  const safePage = Math.min(page, pageCount - 1)
  const visible = filtered.slice(safePage * limit, safePage * limit + limit)
  const from = filtered.length ? safePage * limit + 1 : 0
  const to = Math.min(safePage * limit + limit, filtered.length)

  const reposition = () => {
    if (!triggerRef.current) return
    setPosition(computePosition(triggerRef.current.getBoundingClientRect()))
  }

  const openPicker = () => {
    if (disabled) return
    if (mode === 'popover') reposition()
    setQuery('')
    setPage(0)
    setOpen(true)
  }

  const closePicker = (restoreFocus = true) => {
    setOpen(false)
    setQuery('')
    setPage(0)
    if (restoreFocus) triggerRef.current?.focus()
  }

  const select = (option: PickerOption) => {
    if (option.disabled) return
    onChange(option.id)
    closePicker()
  }

  useEffect(() => {
    if (!open) return
    const focusTimer = window.setTimeout(() => searchRef.current?.focus(), 30)
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return
      closePicker(false)
    }
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // Keep Escape scoped to the picker so parent dialogs stay open.
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      closePicker()
    }
    document.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown, true)
    const previousOverflow = document.body.style.overflow
    if (mode === 'modal') document.body.style.overflow = 'hidden'
    const onScroll = (event: Event) => {
      if (panelRef.current?.contains(event.target as Node)) return
      reposition()
    }
    if (mode === 'popover') {
      window.addEventListener('scroll', onScroll, true)
      window.addEventListener('resize', reposition)
    }
    return () => {
      window.clearTimeout(focusTimer)
      document.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown, true)
      if (mode === 'modal') document.body.style.overflow = previousOverflow
      else {
        window.removeEventListener('scroll', onScroll, true)
        window.removeEventListener('resize', reposition)
      }
    }
  }, [open, mode])

  const moveFocus = (current: HTMLElement, direction: 1 | -1) => {
    const items = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)') ?? [])
    const index = items.indexOf(current as HTMLButtonElement)
    const next = items[Math.max(0, Math.min(items.length - 1, index + direction))]
    next?.focus()
  }

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      listRef.current?.querySelector<HTMLButtonElement>('[role="option"]:not(:disabled)')?.focus()
    }
    if (event.key === 'Enter' && filtered.length === 1 && !filtered[0].disabled) {
      event.preventDefault()
      select(filtered[0])
    }
  }

  const onOptionKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); moveFocus(event.currentTarget, 1) }
    if (event.key === 'ArrowUp') { event.preventDefault(); moveFocus(event.currentTarget, -1) }
  }

  const body = <>
    <div className="ws-picker-search">
      <Search size={15} aria-hidden="true" />
      <input
        ref={searchRef}
        value={query}
        onChange={event => { setQuery(event.target.value); setPage(0) }}
        onKeyDown={onSearchKeyDown}
        placeholder={searchPlaceholder}
        aria-label={`Buscar ${ariaLabel}`}
        autoComplete="off"
      />
      {query && <button type="button" aria-label="Limpiar búsqueda" onClick={() => { setQuery(''); setPage(0); searchRef.current?.focus() }}><X size={13} /></button>}
    </div>
    <div ref={listRef} id={listId} className="ws-picker-list" role="listbox" aria-label={ariaLabel}>
      {visible.map(option => <button
        key={option.id}
        type="button"
        role="option"
        aria-selected={option.id === value}
        aria-disabled={option.disabled || undefined}
        disabled={option.disabled}
        className="ws-picker-option"
        onClick={() => select(option)}
        onKeyDown={onOptionKeyDown}
      >
        <span className="ws-picker-option-copy">
          <strong>{option.label}</strong>
          {option.detail && <small>{option.detail}</small>}
        </span>
        {option.id === value && <Check size={14} aria-hidden="true" />}
      </button>)}
      {!filtered.length && <p className="ws-picker-empty">{emptyMessage}</p>}
    </div>
    {filtered.length > 0 && <div className="ws-picker-pagination">
      <span>{from}–{to} de {filtered.length}</span>
      <div>
        <button type="button" aria-label="Resultados anteriores" disabled={safePage === 0} onClick={() => setPage(Math.max(0, safePage - 1))}><ChevronLeft size={13} /></button>
        <span>{safePage + 1} / {pageCount}</span>
        <button type="button" aria-label="Resultados siguientes" disabled={safePage + 1 >= pageCount} onClick={() => setPage(Math.min(pageCount - 1, safePage + 1))}><ChevronRight size={13} /></button>
      </div>
    </div>}
  </>

  const portalTarget = triggerRef.current?.closest('.workspace-shell') ?? document.body

  return <>
    {(name || required) && <input
      className="ec-combobox-validation"
      tabIndex={-1}
      aria-hidden="true"
      name={name}
      value={value}
      required={required}
      disabled={disabled}
      onChange={() => {}}
      onFocus={() => triggerRef.current?.focus()}
    />}
    <button
      ref={triggerRef}
      type="button"
      className={`ws-picker-trigger${mode === 'modal' ? ' is-modal' : ''}${open ? ' is-open' : ''}${selected ? '' : ' is-empty'}`}
      aria-haspopup={mode === 'modal' ? 'dialog' : 'listbox'}
      aria-expanded={open}
      aria-controls={open ? listId : undefined}
      aria-label={ariaLabel}
      aria-required={required || undefined}
      disabled={disabled}
      onClick={() => open ? closePicker() : openPicker()}
    >
      <span className="ws-picker-trigger-copy">
        <strong>{selected?.label ?? placeholder}</strong>
        {selected?.detail && <small>{selected.detail}</small>}
      </span>
      {mode === 'modal' ? <Search size={15} aria-hidden="true" /> : <ChevronDown size={15} aria-hidden="true" />}
    </button>
    {open && mode === 'modal' && createPortal(
      <div className="ws-picker-backdrop">
        <div ref={panelRef} className="ws-picker-dialog" role="dialog" aria-modal="true" aria-label={`Seleccionar ${ariaLabel}`}>
          <div className="ws-picker-dialog-head">
            <div><strong>Seleccionar {ariaLabel.toLocaleLowerCase('es')}</strong><small>Busca y elige un registro.</small></div>
            <button type="button" className="ws-picker-close" aria-label="Cerrar" onClick={() => closePicker()}><X size={17} /></button>
          </div>
          {body}
        </div>
      </div>,
      portalTarget,
    )}
    {open && mode === 'popover' && position && createPortal(
      <div
        ref={panelRef}
        className="ws-picker-popover"
        style={{ left: position.left, top: position.top, bottom: position.bottom, width: position.width }}
      >
        {body}
      </div>,
      portalTarget,
    )}
  </>
}
