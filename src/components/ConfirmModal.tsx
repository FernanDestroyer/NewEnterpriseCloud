import { useState, type ReactNode } from 'react'
import { useDialog } from './useDialog'

export default function ConfirmModal({
  title,
  message,
  confirmLabel,
  onCancel,
  onConfirm,
  busy = false,
  tone = 'danger',
  children,
}: {
  title: string
  message: string
  confirmLabel: string
  onCancel: () => void
  onConfirm: () => void | Promise<void>
  busy?: boolean
  tone?: 'danger' | 'primary'
  children?: ReactNode
}) {
  const [working, setWorking] = useState(false)
  const blocked = busy || working
  const dialogRef = useDialog<HTMLDivElement>(onCancel, blocked)
  const confirm = async () => {
    if (blocked) return
    setWorking(true)
    try { await onConfirm() } finally { setWorking(false) }
  }
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => !blocked && event.target === event.currentTarget && onCancel()}>
      <div ref={dialogRef} className="confirm-modal" role="alertdialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        <p>{message}</p>
        {children}
        <div className="modal-actions">
          <button className="cancel-button" type="button" disabled={blocked} onClick={onCancel}>Cancelar</button>
          <button className={tone === 'primary' ? 'primary-button' : 'danger-button'} type="button" disabled={blocked} onClick={() => void confirm()}>{blocked ? 'Guardando…' : confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}
