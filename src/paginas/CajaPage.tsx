import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { AlertTriangle, Banknote, CheckCircle2, Lock, LockOpen, RefreshCw } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useRecords } from '../context/RecordsContext'
import { closeCashShift, fetchCashShifts, openCashShift, type CashShift } from '../services/caja'
import { fetchPaymentMethods, friendlyError, isMissingTableError } from '../services/records'
import { displayDate } from '../data/workspace'
import { money } from '../data/helpers'

const MIGRATION_HINT = 'Falta la tabla de turnos en Supabase. Ejecuta la migración 20261021000000_centro_mantenimiento.sql y recarga.'

export default function CajaPage() {
  const { can, session } = useAuth()
  const { records, notify } = useRecords()
  const [shifts, setShifts] = useState<CashShift[]>([])
  const [methods, setMethods] = useState<string[]>(['Efectivo'])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [formMsg, setFormMsg] = useState('')
  const [lastClose, setLastClose] = useState<{ esperado: number; contado: number } | null>(null)

  const load = async () => {
    setLoading(true); setError('')
    try {
      const [nextShifts, nextMethods] = await Promise.all([fetchCashShifts(20), fetchPaymentMethods()])
      setShifts(nextShifts)
      setMethods(nextMethods.map((method) => method.nombre))
    } catch (error) {
      setError(isMissingTableError(error) ? MIGRATION_HINT : friendlyError(error))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { if (can('finance')) void load() }, [can])

  const open = shifts.find((shift) => shift.estado === 'Abierto')
  // Momento del movimiento: lo último entre creación y última edición
  // (al cobrar se toca updated_at, así el cobro cae en el turno vigente).
  const movementTime = (item: { createdAt?: string; updatedAt?: string }) => {
    const created = item.createdAt ?? ''
    return item.updatedAt && item.updatedAt > created ? item.updatedAt : created
  }
  const cobros = useMemo(
    () => (open
      ? records.finance.filter((item) => item.financeType === 'cobrar' && item.status === 'Completada' && movementTime(item) >= open.abiertoEn)
      : []),
    [records.finance, open],
  )
  const medios = useMemo(() => {
    const names = new Set(methods)
    for (const item of cobros) names.add(item.medio || 'Efectivo')
    return [...names]
  }, [methods, cobros])
  const expectedByMethod = useMemo(() => {
    const map = new Map<string, number>([['Efectivo', open?.montoInicial ?? 0]])
    for (const item of cobros) {
      const medio = item.medio || 'Efectivo'
      map.set(medio, (map.get(medio) ?? 0) + (item.amount ?? 0))
    }
    return map
  }, [cobros, open])
  const expectedTotal = useMemo(
    () => [...expectedByMethod.values()].reduce((sum, value) => sum + value, 0),
    [expectedByMethod],
  )
  // Esperado de cualquier turno (abierto o cerrado): inicial + cobros completados en su ventana.
  const expectedFor = (shift: CashShift) => {
    let total = shift.montoInicial
    for (const item of records.finance) {
      if (item.financeType !== 'cobrar' || item.status !== 'Completada') continue
      const when = movementTime(item)
      if (!when || when < shift.abiertoEn) continue
      if (shift.cerradoEn && when > shift.cerradoEn) continue
      total += item.amount ?? 0
    }
    return Math.round(total * 100) / 100
  }

  if (!can('finance')) {
    return <section className="ws-card ws-empty-compact"><Banknote size={28} /><strong>Acceso restringido a caja</strong><span>Tu rol no tiene permiso de tesorería.</span></section>
  }

  const submitOpen = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy || !can('finance', 'crear')) return
    const monto = Number(new FormData(event.currentTarget).get('monto_inicial') ?? 0)
    setBusy(true); setFormMsg('')
    try {
      await openCashShift(monto, session?.user.email ?? null)
      await load()
      notify('Turno de caja abierto.')
    } catch (error) { setFormMsg(friendlyError(error)) }
    finally { setBusy(false) }
  }

  const submitClose = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy || !open || !can('finance', 'editar')) return
    const form = new FormData(event.currentTarget)
    const conteo: Record<string, number> = {}
    for (const medio of medios) conteo[medio] = Number(form.get(`conteo_${medio}`) ?? 0)
    setBusy(true); setFormMsg('')
    try {
      const closed = await closeCashShift(open.id, conteo, String(form.get('notas') ?? ''))
      const counted = Object.values(closed.conteo).reduce((sum, value) => sum + value, 0)
      setLastClose({ esperado: expectedTotal, contado: Math.round(counted * 100) / 100 })
      await load()
      notify(`Turno cerrado. Descuadre: ${money(Math.round((counted - expectedTotal) * 100) / 100)}.`)
    } catch (error) { setFormMsg(friendlyError(error)) }
    finally { setBusy(false) }
  }

  return <>
    <section className="ws-page-heading"><div><span className="ws-eyebrow">TESORERÍA / TURNO</span><h1>Caja</h1><p>Apertura y cierre de turno con descuadre: lo esperado sale de los cobros registrados.</p></div><div className="ws-heading-actions"><button className="ws-button ws-button-secondary" disabled={loading} onClick={() => void load()}><RefreshCw size={16} />Actualizar</button></div></section>
    {error && <div className="ws-notice ws-notice-warning" role="alert"><AlertTriangle size={18} /><span>{error}</span><button className="ws-text-button" onClick={() => void load()}>Reintentar</button></div>}
    {lastClose && <div className="ws-notice" role="status"><CheckCircle2 size={18} /><span>Último cierre: esperado {money(lastClose.esperado)} · contado {money(lastClose.contado)} · descuadre {money(Math.round((lastClose.contado - lastClose.esperado) * 100) / 100)}.</span></div>}
    {!open ? (
      <section className="ws-card"><div className="ws-card-heading"><div><h2>Abrir turno</h2><p>Solo puede haber un turno abierto a la vez.</p></div><LockOpen size={19} /></div>{can('finance', 'crear') ? <form className="ws-form" onSubmit={submitOpen}><label>Monto inicial en caja (S/)<input name="monto_inicial" type="number" min={0} step={0.01} required defaultValue={0} /></label>{formMsg && <div className="ws-notice ws-notice-warning" role="alert">{formMsg}</div>}<div className="ws-heading-actions"><button className="ws-button" type="submit" disabled={busy || loading}>{busy ? 'Abriendo…' : 'Abrir turno'}</button></div></form> : <div className="ws-empty-compact"><Lock size={26} /><strong>Sin turno abierto</strong><span>Tu rol no puede abrir turnos.</span></div>}</section>
    ) : (
      <section className="ws-card"><div className="ws-card-heading"><div><h2>Cerrar turno</h2><p>Abierto {displayDate(open.abiertoEn)}{open.abiertoPor ? ` por ${open.abiertoPor}` : ''} · Inicial {money(open.montoInicial)} · {cobros.length} {cobros.length === 1 ? 'cobro' : 'cobros'} en el turno.</p></div><Lock size={19} /></div><form className="ws-form" onSubmit={submitClose}><div className="ws-summary-list">{medios.map((medio) => <div key={medio}><small>{medio} · esperado {money(expectedByMethod.get(medio) ?? 0)}</small><strong><input name={`conteo_${medio}`} type="number" min={0} step={0.01} required defaultValue={0} aria-label={`Conteo de ${medio}`} style={{ maxWidth: 140, textAlign: 'right' }} /></strong></div>)}</div><label>Notas del cierre<input name="notas" placeholder="Observaciones (opcional)" /></label>{formMsg && <div className="ws-notice ws-notice-warning" role="alert">{formMsg}</div>}<div className="ws-heading-actions"><span className="ws-form-hint">Esperado total: {money(expectedTotal)}</span><button className="ws-button" type="submit" disabled={busy || !can('finance', 'editar')}>{busy ? 'Cerrando…' : 'Cerrar turno'}</button></div></form></section>
    )}
    <section className="ws-card"><div className="ws-card-heading"><div><h2>Historial de turnos</h2><p>Últimos {shifts.length} turnos registrados.</p></div><Banknote size={19} /></div>{loading ? <div className="ws-empty-compact"><RefreshCw size={26} className="ws-spin" /><strong>Consultando turnos…</strong></div> : shifts.length ? <div className="table-scroll"><table className="record-table"><thead><tr><th>Apertura</th><th>Inicial</th><th>Esperado</th><th>Contado</th><th>Descuadre</th><th>Estado</th></tr></thead><tbody>{shifts.map((shift) => {
      const counted = Object.values(shift.conteo).reduce((sum, value) => sum + value, 0)
      const closedExpected = shift.estado === 'Cerrado' ? counted : null
      return <tr key={shift.id}><td className="record-date">{displayDate(shift.abiertoEn)}<small>{shift.abiertoPor ?? ''}</small></td><td className="record-value">{money(shift.montoInicial)}</td><td className="record-value">{shift.estado === 'Cerrado' ? '—' : money(expectedTotal)}</td><td className="record-value">{shift.estado === 'Cerrado' ? money(counted) : '—'}</td><td className="record-value">{closedExpected === null ? '—' : money(0)}</td><td><span className={`status-pill ${shift.estado === 'Abierto' ? 'amber' : 'green'}`}>{shift.estado}</span></td></tr>
    })}</tbody></table></div> : !error && <div className="ws-empty-compact"><Banknote size={26} /><strong>Sin turnos registrados</strong><span>Abre el primer turno para empezar.</span></div>}</section>
  </>
}