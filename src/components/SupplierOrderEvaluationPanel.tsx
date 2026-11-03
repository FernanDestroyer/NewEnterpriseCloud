import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { AlertTriangle, Check, RefreshCw, Star } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useRecords } from '../context/RecordsContext'
import { fetchSupplierOrderEvaluation, saveSupplierOrderEvaluation } from '../services/supplierEvaluations'
import type { SupplierEvaluationScore, SupplierOrderEvaluation } from '../types/supplierEvaluations'

const criterionFields: Array<{ key: 'calidad_producto' | 'cumplimiento_plazos' | 'nivel_servicio'; label: string }> = [
  { key: 'calidad_producto', label: 'Calidad del Producto' },
  { key: 'cumplimiento_plazos', label: 'Cumplimiento de Plazos' },
  { key: 'nivel_servicio', label: 'Nivel de Servicio' },
]

const scoreLabels: Record<number, string> = {
  1: 'Deficiente',
  2: 'Bajo',
  3: 'Regular',
  4: 'Bueno',
  5: 'Excelente',
}

function messageOf(error: unknown) {
  const message = (error as { message?: string } | null)?.message ?? 'No se pudo consultar o guardar la evaluación.'
  if (message.includes('Could not find the function') || message.includes('does not exist')) return 'No se encontró el RPC de evaluación. Verifica que la migración 20261117000000 esté aplicada.'
  if (message.includes('Could not find the table') || message.includes('schema cache')) return 'No se encontró la tabla de evaluaciones. Verifica la migración 20261117000000.'
  return message
}

export default function SupplierOrderEvaluationPanel({ compraId, proveedorId, estadoRecepcion, requiereRecepcion }: {
  compraId: string
  proveedorId: string | null
  estadoRecepcion?: 'pendiente' | 'parcial' | 'completa'
  requiereRecepcion: boolean
}) {
  const { can } = useAuth()
  const { notify } = useRecords()
  const [evaluation, setEvaluation] = useState<SupplierOrderEvaluation | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState('')
  const [scores, setScores] = useState<Record<string, string>>({ calidad_producto: '', cumplimiento_plazos: '', nivel_servicio: '' })
  const eligible = requiereRecepcion && (estadoRecepcion === 'parcial' || estadoRecepcion === 'completa') && Boolean(proveedorId)
  const canEdit = can('purchases', 'editar')
  const scoresComplete = criterionFields.every(field => scores[field.key])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const value = await fetchSupplierOrderEvaluation(compraId)
      setEvaluation(value)
      if (value) setScores({
        calidad_producto: String(value.calidad_producto),
        cumplimiento_plazos: String(value.cumplimiento_plazos),
        nivel_servicio: String(value.nivel_servicio),
      })
      else setScores({ calidad_producto: '', cumplimiento_plazos: '', nivel_servicio: '' })
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setLoading(false)
    }
  }, [compraId])

  useEffect(() => { void load() }, [load])

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!proveedorId || !eligible || !canEdit || busy) return
    if (!scoresComplete) {
      setError('Selecciona un puntaje para los tres criterios antes de guardar.')
      return
    }
    const values = criterionFields.map(field => Number(scores[field.key]))
    if (values.some(value => !Number.isInteger(value) || value < 1 || value > 5)) {
      setError('Cada criterio debe ser un puntaje entero del 1 al 5.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await saveSupplierOrderEvaluation({
        compra_id: compraId,
        calidad_producto: values[0] as SupplierEvaluationScore,
        cumplimiento_plazos: values[1] as SupplierEvaluationScore,
        nivel_servicio: values[2] as SupplierEvaluationScore,
      }, proveedorId)
      setEditing(false)
      await load()
      notify('Evaluación del proveedor guardada para esta orden.')
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setBusy(false)
    }
  }

  return <section className="po-close-summary panel ws-order-evaluation" aria-labelledby="supplier-order-evaluation-title">
    <div className="table-header"><div><span className="panel-label">COMPRAS · CALIDAD DE PROVEEDOR</span><h2 id="supplier-order-evaluation-title">Evaluación del Proveedor</h2></div>{loading && <RefreshCw size={15} className="ws-spin" aria-label="Cargando"/>}</div>
    {error && <div className="ws-notice ws-notice-warning" role="alert"><AlertTriangle size={15}/>{error}<button className="ws-text-button" type="button" onClick={() => void load()}>Reintentar</button></div>}
    {!proveedorId ? <div className="ws-notice ws-notice-info">La orden no tiene un proveedor vinculado; no se puede evaluar.</div> : loading ? <p className="ws-muted">Consultando evaluación de esta orden…</p> : evaluation && !editing ? <>
      <div className="ws-order-evaluation-scores">{criterionFields.map(field => <div key={field.key}><span>{field.label}</span><strong><Star size={14} fill="currentColor"/>{evaluation[field.key]}<small>/ 5</small></strong></div>)}</div>
      <small className="ws-order-evaluation-meta">Actualizada {new Date(evaluation.actualizado_en).toLocaleString('es-PE')}</small>
      {eligible && canEdit && <button className="ws-button ws-button-secondary ws-button-compact" type="button" onClick={() => setEditing(true)}>Editar evaluación</button>}
      {!eligible && <small className="ws-muted">Esta orden ya no cumple el estado requerido para modificar la evaluación.</small>}
    </> : !eligible ? <div className="ws-notice ws-notice-info">La evaluación estará disponible cuando exista al menos una recepción registrada.</div> : !canEdit ? <div className="ws-notice ws-notice-info">Tu rol puede consultar, pero no registrar ni actualizar evaluaciones.</div> : <form className="ws-order-evaluation-form" onSubmit={event => void save(event)}>
      {criterionFields.map(field => <label key={field.key}>{field.label}<select className="ws-control" required value={scores[field.key]} onChange={event => setScores(current => ({ ...current, [field.key]: event.target.value }))}><option value="">Seleccionar puntaje</option>{[1,2,3,4,5].map(score => <option key={score} value={score}>{score} · {scoreLabels[score]}</option>)}</select></label>)}
      <div className="ws-order-evaluation-actions">{evaluation && <button className="ws-button ws-button-secondary" type="button" disabled={busy} onClick={() => { setEditing(false); setScores({ calidad_producto: String(evaluation.calidad_producto), cumplimiento_plazos: String(evaluation.cumplimiento_plazos), nivel_servicio: String(evaluation.nivel_servicio) }) }}>Cancelar</button>}<button className="ws-button" type="submit" disabled={busy || !scoresComplete}>{busy ? <><RefreshCw size={14} className="ws-spin"/>Guardando…</> : <><Check size={14}/>{evaluation ? 'Actualizar evaluación' : 'Registrar evaluación'}</>}</button></div>
    </form>}
  </section>
}
