import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { AlertTriangle, Banknote, CheckCircle2, CreditCard, Info, Landmark, Lock, LockOpen, RefreshCw, Smartphone, Wallet } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useRecords } from '../context/RecordsContext'
import { closeCashShift, fetchCashShifts, openCashShift, type CashShift } from '../services/caja'
import { fetchPaymentMethods, friendlyError, isMissingTableError } from '../services/records'
import { displayDate } from '../data/workspace'
import { money } from '../data/helpers'

const MIGRATION_HINT = 'Falta la tabla de turnos en Supabase. Ejecuta la migración 20261021000000_centro_mantenimiento.sql y recarga.'

// Color e icono por medio de pago para las tarjetas de conteo.
const METHOD_STYLE: Record<string, { icon: typeof Wallet; color: string }> = {
  Efectivo: { icon: Banknote, color: 'green' },
  Yape: { icon: Smartphone, color: 'violet' },
  Plin: { icon: Smartphone, color: 'violet' },
  Tarjeta: { icon: CreditCard, color: 'blue' },
  'Transferencia bancaria': { icon: Landmark, color: 'amber' },
}
function methodStyle(medio: string) {
  return METHOD_STYLE[medio] ?? { icon: Wallet, color: 'slate' }
}

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
  // Conteo físico por medio: se prellena solo con lo esperado para que cerrar
  // sea un clic (verifica con el dinero en mano y corrige si hay diferencia).
  const [conteo, setConteo] = useState<Record<string, number>>({})

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
  const fillExpected = () => {
    const next: Record<string, number> = {}
    for (const medio of medios) next[medio] = Math.round((expectedByMethod.get(medio) ?? 0) * 100) / 100
    setConteo(next)
  }
  // Al abrir (o cambiar) el turno, el conteo arranca igualado a lo esperado.
  useEffect(() => {
    if (!open) {
      setConteo({})
      return
    }
    const next: Record<string, number> = {}
    for (const medio of medios) next[medio] = Math.round((expectedByMethod.get(medio) ?? 0) * 100) / 100
    setConteo(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open?.id])
  const countedTotal = useMemo(
    () => Math.round(medios.reduce((sum, medio) => sum + (Number(conteo[medio]) || 0), 0) * 100) / 100,
    [conteo, medios],
  )
  const descuadreTotal = Math.round((countedTotal - expectedTotal) * 100) / 100
  // Cobros completados fuera del turno: no cuentan para el esperado.
  const excludedCount = useMemo(
    () => (open
      ? records.finance.filter(item => item.financeType === 'cobrar' && item.status === 'Completada' && movementTime(item) < open.abiertoEn).length
      : 0),
    [records.finance, open],
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
      <>
      <section className="ws-card"><div className="ws-card-heading"><div><h2>Cerrar turno</h2><p>Abierto {displayDate(open.abiertoEn)}{open.abiertoPor ? ` por ${open.abiertoPor}` : ''} · Inicial {money(open.montoInicial)} · {cobros.length} {cobros.length === 1 ? 'cobro' : 'cobros'} en el turno.</p></div><Lock size={19} /></div><form className="ws-form" onSubmit={submitClose}><p className="relation-hint"><Info size={15} />El conteo ya viene llenado con lo esperado. Verifica con el dinero físico y corrige solo donde haya diferencia.</p><div className="cash-methods">{medios.map((medio) => {
          const expected = Math.round((expectedByMethod.get(medio) ?? 0) * 100) / 100
          const counted = Number(conteo[medio]) || 0
          const diff = Math.round((counted - expected) * 100) / 100
          const style = methodStyle(medio)
          const Icon = style.icon
          return <div key={medio} className="cash-method"><span className={`ws-soft-icon ${style.color}`}><Icon size={18} /></span><span className="cash-method-copy"><strong>{medio}</strong><small>Sistema {money(expected)}</small></span><label className="cash-count"><small>Contado</small><input name={`conteo_${medio}`} type="number" min={0} step={0.01} required value={conteo[medio] ?? 0} onChange={(event) => setConteo((current) => ({ ...current, [medio]: Number(event.target.value) || 0 }))} aria-label={`Conteo físico de ${medio}`} /></label><span className={`status-pill ${diff === 0 ? 'green' : 'amber'}`}>{diff === 0 ? 'Cuadra' : money(diff)}</span></div>
        })}</div><div className="cash-totals"><div><small>Sistema</small><strong>{money(expectedTotal)}</strong></div><div><small>Contado</small><strong>{money(countedTotal)}</strong></div><div><small>Descuadre</small><strong className={descuadreTotal === 0 ? 'ok' : 'bad'}>{money(descuadreTotal)}</strong></div></div><label>Notas del cierre<input name="notas" placeholder="Observaciones (opcional)" /></label>{formMsg && <div className="ws-notice ws-notice-warning" role="alert">{formMsg}</div>}<div className="ws-heading-actions"><button className="ws-button ws-button-secondary" type="button" disabled={busy} onClick={fillExpected}>Igualar a lo esperado</button><button className="ws-button" type="submit" disabled={busy || !can('finance', 'editar')}>{busy ? 'Cerrando…' : 'Cerrar turno'}</button></div></form></section>
      <section className="ws-card cash-section"><div className="ws-card-heading"><div><h2>Historial de ventas</h2><p>Cobros completados dentro del turno ({cobros.length}).</p></div><Wallet size={19} /></div><div className="ws-source-note"><Info size={15} /><span>{excludedCount > 0 ? `${excludedCount} ${excludedCount === 1 ? 'cobro completado quedó' : 'cobros completados quedaron'} fuera del turno y no cuentan.` : 'Todos los cobros completados están dentro del turno.'}</span></div>{cobros.length > 0 ? <div className="supplier-product-list">{cobros.map(item => <div className="supplier-product-row" key={item.id}><span className="supplier-product-copy"><strong>{item.id}</strong><small>{item.medio || 'Efectivo'} · {item.createdAt ? displayDate(item.createdAt) : '—'}</small></span><span className="supplier-product-actions"><strong>{money(item.amount ?? 0)}</strong></span></div>)}</div> : <div className="ws-empty-compact"><Wallet size={26} /><strong>Sin cobros en el turno</strong><span>Las ventas completadas aparecerán aquí.</span></div>}</section>
      </>
      )}
    <section className="ws-card cash-section"><div className="ws-card-heading"><div><h2>Historial de turnos</h2><p>Últimos {shifts.length} turnos registrados.</p></div><Banknote size={19} /></div>{loading ? <div className="ws-empty-compact"><RefreshCw size={26} className="ws-spin" /><strong>Consultando turnos…</strong></div> : shifts.length ? <div className="table-scroll"><table className="record-table"><thead><tr><th>Apertura</th><th>Inicial</th><th>Esperado</th><th>Contado</th><th>Descuadre</th><th>Estado</th></tr></thead><tbody>{shifts.map((shift) => {
      const counted = Math.round(Object.values(shift.conteo).reduce((sum, value) => sum + value, 0) * 100) / 100
      const expected = shift.estado === 'Cerrado' ? Math.round(expectedFor(shift) * 100) / 100 : expectedTotal
      return <tr key={shift.id}><td className="record-date">{displayDate(shift.abiertoEn)}<small>{shift.abiertoPor ?? ''}</small></td><td className="record-value">{money(shift.montoInicial)}</td><td className="record-value">{money(expected)}</td><td className="record-value">{shift.estado === 'Cerrado' ? money(counted) : '—'}</td><td>{shift.estado === 'Cerrado' ? <span className={`status-pill ${counted - expected === 0 ? 'green' : 'red'}`}>{money(Math.round((counted - expected) * 100) / 100)}</span> : '—'}</td><td><span className={`status-pill ${shift.estado === 'Abierto' ? 'amber' : 'green'}`}>{shift.estado}</span></td></tr>
    })}</tbody></table></div> : !error && <div className="ws-empty-compact"><Banknote size={26} /><strong>Sin turnos registrados</strong><span>Abre el primer turno para empezar.</span></div>}</section>
  </>
}