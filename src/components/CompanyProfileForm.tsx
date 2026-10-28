import { useEffect, useState, type FormEvent } from 'react'
import { Save } from 'lucide-react'
import { EMPTY_COMPANY, fetchCompanyProfile, saveCompanyProfile, type CompanyProfile } from '../services/company'
import { friendlyError } from '../services/records'

export default function CompanyProfileForm({ canCreate, canEdit, onSaved }: { canCreate: boolean; canEdit: boolean; onSaved: () => Promise<void> }) {
  const [company, setCompany] = useState<CompanyProfile>({ ...EMPTY_COMPANY })
  const [exists, setExists] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [success, setSuccess] = useState(false)
  const editable = !loadError && (exists ? canEdit : canCreate)

  useEffect(() => {
    let active = true
    setLoading(true)
    setLoadError(false)
    fetchCompanyProfile()
      .then(value => {
        if (!active) return
        setExists(Boolean(value))
        setCompany(value ?? { ...EMPTY_COMPANY })
        setMessage('')
      })
      .catch(error => { if (active) { setLoadError(true); setMessage(friendlyError(error)) } })
      .finally(() => active && setLoading(false))
    return () => { active = false }
  }, [attempt])

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!editable || loading || busy) return
    setBusy(true)
    setMessage('')
    setSuccess(false)
    try {
      await saveCompanyProfile(company, exists)
      setExists(true)
      await onSaved()
      setSuccess(true)
      setMessage('Ficha de empresa guardada.')
    } catch (error) {
      setMessage(friendlyError(error))
    } finally {
      setBusy(false)
    }
  }

  const field = (key: keyof CompanyProfile, label: string, placeholder: string, options: { required?: boolean; type?: string; maxLength?: number } = {}) => (
    <label key={key}>{label}<input
      type={options.type ?? 'text'}
      value={company[key]}
      required={options.required}
      maxLength={options.maxLength}
      disabled={!editable || loading || busy}
      placeholder={placeholder}
      onChange={event => { setCompany(current => ({ ...current, [key]: event.target.value })); setSuccess(false) }}
    /></label>
  )

  if (loading) return <div className="ws-empty-compact">Cargando ficha de empresa…</div>

  return <form className="ws-form" onSubmit={save}>
    {message && <div className={`ws-notice ${success ? '' : 'ws-notice-warning'}`} role={success ? 'status' : 'alert'}>{message}</div>}
    {loadError && <div className="ws-heading-actions"><button className="ws-button ws-button-secondary" type="button" onClick={() => setAttempt(value => value + 1)}>Reintentar lectura</button></div>}
    <div className="ws-form-grid">
      {field('razonSocial', 'Razón social', 'Nombre legal de la empresa', { required: true, maxLength: 180 })}
      {field('ruc', 'RUC', '11 dígitos', { maxLength: 11 })}
      {field('direccion', 'Dirección fiscal', 'Dirección registrada', { maxLength: 240 })}
      {field('telefono', 'Teléfono', 'Número de contacto', { maxLength: 40 })}
      {field('email', 'Correo', 'contacto@empresa.pe', { type: 'email', maxLength: 180 })}
    </div>
    {!editable && <p className="relation-hint">Tu rol puede consultar los datos, pero no tiene permiso para {exists ? 'editar' : 'crear'} la ficha de empresa.</p>}
    {editable && <div className="ws-heading-actions"><button className="primary-button" type="submit" disabled={busy}><Save size={15} />{busy ? 'Guardando…' : 'Guardar ficha'}</button></div>}
  </form>
}
