import { useState } from 'react'
import { BookOpenCheck } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useRecords } from '../context/RecordsContext'
import { exportSystemGuide } from '../services/systemGuide'

/** Botón llamativo "Guía del sistema": descarga el manual formal y ejecutivo con el logo. */
export default function SystemGuideButton({ variant = 'default' }: { variant?: 'sidebar' | 'heading' | 'topbar' | 'default' }) {
  const { profile } = useAuth()
  const { company, notify } = useRecords()
  const [busy, setBusy] = useState(false)

  const download = async () => {
    if (busy) return
    setBusy(true)
    try {
      await exportSystemGuide({ company, author: profile?.nombre })
      notify('Guía del sistema preparada. Elige Guardar como PDF en la ventana de impresión.')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'No se pudo preparar la guía del sistema.')
    } finally {
      setBusy(false)
    }
  }

  if (variant === 'sidebar') {
    return (
      <button type="button" className="ws-guide-card" onClick={() => void download()} disabled={busy} title="Descargar la guía formal del sistema en PDF">
        <span className="ws-guide-glow" aria-hidden="true" />
        <span className="ws-guide-icon"><BookOpenCheck size={20} /></span>
        <span className="ws-guide-copy"><strong>{busy ? 'Preparando guía…' : 'Guía del sistema'}</strong><small>Manual oficial · PDF ejecutivo</small></span>
        <span className="ws-guide-pill">{busy ? '…' : 'PDF'}</span>
      </button>
    )
  }

  if (variant === 'topbar') {
    return (
      <button type="button" className="ws-icon-button ws-guide-topbar" onClick={() => void download()} disabled={busy} aria-label="Guía del sistema — descargar manual oficial en PDF" data-tip="Guía del sistema — descargar manual oficial en PDF">
        <BookOpenCheck size={18} />
      </button>
    )
  }

  if (variant === 'heading') {
    return (
      <button type="button" className="ws-button ws-guide-heading" onClick={() => void download()} disabled={busy} title="Descargar la guía formal del sistema en PDF">
        <BookOpenCheck size={16} />{busy ? 'Preparando…' : 'Guía del sistema'}
      </button>
    )
  }

  return (
    <button type="button" className="ws-button ws-guide-heading" onClick={() => void download()} disabled={busy}>
      <BookOpenCheck size={16} />{busy ? 'Preparando…' : 'Guía del sistema'}
    </button>
  )
}
