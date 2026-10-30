import { useEffect, useState } from 'react'
import { Star } from 'lucide-react'
import { fetchSupplierEvaluationSummary, subscribeSupplierSummary } from '../services/supplierEvaluations'
import type { SupplierEvaluationSummary } from '../types/supplierEvaluations'

export default function SupplierEvaluationRating({ proveedorId, compact = false }: { proveedorId: string; compact?: boolean }) {
  const [summary, setSummary] = useState<SupplierEvaluationSummary | null>(null)
  const [failed, setFailed] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => subscribeSupplierSummary(() => setReloadKey(value => value + 1)), [])

  useEffect(() => {
    let active = true
    setSummary(null)
    setFailed(false)
    fetchSupplierEvaluationSummary(proveedorId)
      .then(value => { if (active) setSummary(value) })
      .catch(() => { if (active) setFailed(true) })
    return () => { active = false }
  }, [proveedorId, reloadKey])

  if (failed) return <small className="ws-supplier-rating is-unavailable">Evaluación no disponible</small>
  if (!summary) return <small className="ws-supplier-rating is-loading" aria-label="Consultando evaluación histórica">Consultando evaluación…</small>
  if (!summary.cantidad_evaluaciones || summary.promedio_global == null) {
    return <small className="ws-supplier-rating is-empty">Sin evaluaciones</small>
  }

  const score = Number(summary.promedio_global)
  const label = `${score.toFixed(2)} de 5, ${summary.cantidad_evaluaciones} ${summary.cantidad_evaluaciones === 1 ? 'orden evaluada' : 'órdenes evaluadas'}`
  return <span className={`ws-supplier-rating${compact ? ' is-compact' : ''}`} aria-label={`Evaluación histórica: ${label}`} title={`Calidad ${summary.promedio_calidad?.toFixed(2) ?? '—'} · Plazos ${summary.promedio_plazos?.toFixed(2) ?? '—'} · Servicio ${summary.promedio_servicio?.toFixed(2) ?? '—'}`}>
    <Star size={13} fill="currentColor" aria-hidden="true"/><strong>{score.toFixed(2)}</strong><span>/ 5</span><small>{summary.cantidad_evaluaciones} {summary.cantidad_evaluaciones === 1 ? 'orden' : 'órdenes'}</small>
  </span>
}
