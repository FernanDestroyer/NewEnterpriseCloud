import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { AlertTriangle, Banknote, CheckCircle2, Info, Lock, LockOpen, RefreshCw, Wallet } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useRecords } from '../context/RecordsContext'
import { closeCashShift, createCashBox, fetchCashMovements, fetchCashSetup, fetchCashShifts, openCashShift, type CashBranch, type CashBox, type CashMovement, type CashShift } from '../services/caja'
import { cashCurrencyTotals, expectedCashByCurrency, hasUnreconciledHistoricalCashClose } from '../data/cashAccounting'
import { friendlyError } from '../services/records'
import { displayDate } from '../data/workspace'
import { money, moneyCurrency } from '../data/helpers'
import { PageHeader } from './ui/PageHeader'
import { SearchablePicker } from './SearchablePicker'
import TreasuryFormChoice from './TreasuryFormChoice'
import '../treasury-ui.css'

const MIGRATION_HINT = 'No está disponible la estructura de cajas por sucursal. Revisa el historial y aplica solo la migración aprobada antes de reintentar.'

export default function CajaPage() {
  const { can } = useAuth()
  const { notify } = useRecords()
  const [branches, setBranches] = useState<CashBranch[]>([])
  const [boxes, setBoxes] = useState<CashBox[]>([])
  const [shifts, setShifts] = useState<CashShift[]>([])
  const [movements, setMovements] = useState<CashMovement[]>([])
  const [selectedCajaId, setSelectedCajaId] = useState('')
  const [selectedShiftId, setSelectedShiftId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [formMsg, setFormMsg] = useState('')
  const [boxMsg, setBoxMsg] = useState('')
  const [lastClose, setLastClose] = useState<{ esperadoPen: number; esperadoUsd: number; contadoPen: number; contadoUsd: number; descuadrePen: number; descuadreUsd: number } | null>(null)
  const [conteoPen, setConteoPen] = useState(0)
  const [conteoUsd, setConteoUsd] = useState(0)
  const [shiftFilter, setShiftFilter] = useState('Todos')

  const load = async () => {
    setLoading(true); setError('')
    try {
      const [setup, nextShifts] = await Promise.all([fetchCashSetup(), fetchCashShifts(100)])
      const nextMovements = await fetchCashMovements(nextShifts.map(shift => shift.id))
      setBranches(setup.branches)
      setBoxes(setup.boxes)
      setShifts(nextShifts)
      setMovements(nextMovements)
      setSelectedCajaId(current => setup.boxes.some(box => box.id === current && box.activo) ? current : setup.boxes.find(box => box.activo)?.id ?? '')
      setSelectedShiftId(current => nextShifts.some(shift => shift.id === current && shift.estado === 'Abierto') ? current : nextShifts.filter(shift => shift.estado === 'Abierto').length === 1 ? nextShifts.find(shift => shift.estado === 'Abierto')?.id ?? '' : '')
    } catch (cause) {
      setError(friendlyError(cause))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { if (can('finance')) void load() }, [can])

  const activeBoxes = useMemo(() => boxes.filter(box => box.activo), [boxes])
  const openShifts = useMemo(() => shifts.filter(shift => shift.estado === 'Abierto'), [shifts])
  const open = openShifts.find(shift => shift.id === selectedShiftId) ?? null
  const selectedBox = activeBoxes.find(box => box.id === selectedCajaId) ?? null
  const openForSelectedBox = openShifts.find(shift => shift.cajaId === selectedCajaId) ?? null
  const openMovements = useMemo(() => open ? movements.filter(item => item.cajaTurnoId === open.id && !item.anuladoEn && item.medioPago.trim().toLocaleLowerCase('es') === 'efectivo') : [], [movements, open])
  const expected = useMemo(() => open
    ? expectedCashByCurrency({ pen: open.montoInicial, usd: open.montoInicialUsd }, openMovements)
    : { PEN: 0, USD: 0, monedaDesconocida: 0 }, [open, openMovements])
  const cashTotals = useMemo(() => cashCurrencyTotals(openMovements), [openMovements])
  const countedPen = Math.round((Number(conteoPen) || 0) * 100) / 100
  const countedUsd = Math.round((Number(conteoUsd) || 0) * 100) / 100
  const variancePen = Math.round((countedPen - expected.PEN) * 100) / 100
  const varianceUsd = Math.round((countedUsd - expected.USD) * 100) / 100
  const boxLabel = (shift: CashShift) => {
    if (!shift.cajaId) return 'Turno legado sin caja'
    const box = boxes.find(item => item.id === shift.cajaId)
    return box ? `${box.nombre} · ${box.codigo}` : 'Caja no disponible'
  }
  const branchLabel = (branchId: string) => {
    const branch = branches.find(item => item.id === branchId)
    return branch ? `${branch.nombre} · ${branch.codigo}` : 'Sucursal no disponible'
  }
  const expectedFor = (shift: CashShift) => expectedCashByCurrency(
    { pen: shift.montoInicial, usd: shift.montoInicialUsd },
    movements.filter(item => item.cajaTurnoId === shift.id),
  )
  useEffect(() => {
    setConteoPen(open ? expected.PEN : 0)
    setConteoUsd(open ? expected.USD : 0)
  }, [open?.id, expected.PEN, expected.USD])

  if (!can('finance')) {
    return <section className="ws-card ws-empty-compact"><Banknote size={28} /><strong>Acceso restringido a caja</strong><span>Tu rol no tiene permiso de tesorería.</span></section>
  }

  const submitBox = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy || !can('finance', 'crear')) return
    const form = new FormData(event.currentTarget)
    setBusy(true); setBoxMsg('')
    try {
      const box = await createCashBox({ sucursalId: String(form.get('sucursal_id') ?? ''), codigo: String(form.get('codigo') ?? ''), nombre: String(form.get('nombre') ?? ''), ubicacion: String(form.get('ubicacion') ?? '') })
      setSelectedCajaId(box.id)
      await load()
      notify(`Caja ${box.nombre} registrada.`)
    } catch (cause) { setBoxMsg(friendlyError(cause)) }
    finally { setBusy(false) }
  }

  const submitOpen = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy || !selectedCajaId || !can('finance', 'crear')) return
    const form = new FormData(event.currentTarget)
    const montoPen = Number(form.get('monto_inicial_pen') ?? 0)
    const montoUsd = Number(form.get('monto_inicial_usd') ?? 0)
    setBusy(true); setFormMsg('')
    try {
      const shiftId = await openCashShift(selectedCajaId, montoPen, montoUsd)
      setSelectedShiftId(shiftId)
      await load()
      notify(`Turno abierto en ${selectedBox?.nombre ?? 'la caja seleccionada'}.`)
    } catch (cause) { setFormMsg(friendlyError(cause)) }
    finally { setBusy(false) }
  }

  const submitClose = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy || !open || !can('finance', 'editar')) return
    const form = new FormData(event.currentTarget)
    const amountPen = Number(form.get('conteo_efectivo_pen') ?? 0)
    const amountUsd = Number(form.get('conteo_efectivo_usd') ?? 0)
    setBusy(true); setFormMsg('')
    try {
      const result = await closeCashShift(open.id, amountPen, amountUsd, String(form.get('notas') ?? ''))
      setLastClose(result)
      await load()
      notify(`Turno cerrado. Descuadre PEN ${moneyCurrency(result.descuadrePen, 'PEN')} · USD ${moneyCurrency(result.descuadreUsd, 'USD')}.`)
    } catch (cause) { setFormMsg(friendlyError(cause)) }
    finally { setBusy(false) }
  }

  return <div className="ec-treasury">
    <PageHeader section="Tesorería / Caja" title="Cajas y turnos" description="Apertura, efectivo y arqueo por sucursal y turno." icon={Banknote} actions={<><a className="ws-button" href="#cash-shift-control">{open ? <Lock size={16} /> : <LockOpen size={16} />}{open ? 'Arqueo y cierre' : 'Apertura de turno'}</a><button className="ws-button ws-button-secondary" disabled={loading} onClick={() => void load()}><RefreshCw size={16} />Actualizar</button></>} />
    <section className="ec-finance-metrics" aria-label="Resumen del turno seleccionado">{[
      ['Estado del turno', open ? 'Abierto' : 'Sin turno seleccionado', open ? boxLabel(open) : 'Selecciona una caja y un turno'],
      ['Monto inicial', open ? `${moneyCurrency(open.montoInicial, 'PEN')} · ${moneyCurrency(open.montoInicialUsd, 'USD')}` : '—', 'PEN · USD'],
      ['Ingresos / egresos', open ? `PEN ${moneyCurrency(cashTotals.PEN.cobros, 'PEN')} / ${moneyCurrency(cashTotals.PEN.pagos, 'PEN')} · USD ${moneyCurrency(cashTotals.USD.cobros, 'USD')} / ${moneyCurrency(cashTotals.USD.pagos, 'USD')}` : '—', 'Solo efectivo vigente; monedas separadas'],
      ['Arqueo estimado', open ? `${moneyCurrency(expected.PEN, 'PEN')} · ${moneyCurrency(expected.USD, 'USD')}` : '—', 'Saldo esperado PEN · USD'],
    ].map(([label, value, detail]) => <article className="ec-card" key={label}><span>{label}</span><strong>{loading ? '—' : error ? 'No disponible' : value}</strong><small>{detail}</small></article>)}</section>
    {error && <div className="ws-notice ws-notice-warning" role="alert"><AlertTriangle size={18} /><span>{error === 'fetch failed' ? MIGRATION_HINT : error}</span><button className="ws-text-button" onClick={() => void load()}>Reintentar</button></div>}
    {open && expected.monedaDesconocida > 0 && <div className="ws-notice ws-notice-warning" role="alert"><AlertTriangle size={18} /><span>Hay {expected.monedaDesconocida} movimientos en efectivo sin moneda. El servidor bloqueará el cierre hasta conciliarlos.</span></div>}
    {lastClose && <div className="ws-notice" role="status"><CheckCircle2 size={18} /><span>Último cierre · PEN esperado {moneyCurrency(lastClose.esperadoPen, 'PEN')}, contado {moneyCurrency(lastClose.contadoPen, 'PEN')}, diferencia {moneyCurrency(lastClose.descuadrePen, 'PEN')} · USD esperado {moneyCurrency(lastClose.esperadoUsd, 'USD')}, contado {moneyCurrency(lastClose.contadoUsd, 'USD')}, diferencia {moneyCurrency(lastClose.descuadreUsd, 'USD')}.</span></div>}

    <section className="ws-card">
      <div className="ws-card-heading"><div><h2>Registrar caja</h2><p>Una caja pertenece a una sucursal; su código no se repite dentro de esa sucursal.</p></div><Wallet size={19} /></div>
      {branches.length ? can('finance', 'crear') ? <form className="ws-form" onSubmit={submitBox}>
        <div className="ws-form-grid"><TreasuryFormChoice name="sucursal_id" label="Sucursal" required defaultValue="" options={branches.map(branch => ({ id: branch.id, label: branch.nombre, detail: branch.codigo }))} /><label>Código<input name="codigo" required maxLength={20} placeholder="CAJA-01" /></label></div>
        <div className="ws-form-grid"><label>Nombre<input name="nombre" required minLength={2} maxLength={120} placeholder="Caja principal" /></label><label>Ubicación dentro de la sucursal<input name="ubicacion" maxLength={160} placeholder="Mostrador principal" /></label></div>
        {boxMsg && <div className="ws-notice ws-notice-warning" role="alert">{boxMsg}</div>}<div className="ws-heading-actions"><button className="ws-button" type="submit" disabled={busy || loading}>{busy ? 'Guardando…' : 'Registrar caja'}</button></div>
      </form> : <p>Tu rol puede consultar cajas, pero no registrar nuevas.</p> : <div className="ws-empty-compact"><Info size={24} /><strong>Primero registra la empresa y una sucursal en Maestros</strong><span>Las cajas requieren una ubicación organizacional. No se creó una caja ficticia para la base de datos.</span></div>}
    </section>

    <section className="ws-card cash-section"><div className="ws-card-heading"><div><h2>Cajas registradas</h2><p>{boxes.length} cajas · {openShifts.length} turnos abiertos</p></div><Banknote size={19} /></div>{boxes.length ? <div className="supplier-product-list">{boxes.map(box => <div className="supplier-product-row" key={box.id}><span className="supplier-product-copy"><strong>{box.nombre} · {box.codigo}</strong><small>{branchLabel(box.sucursalId)} · {box.ubicacion || 'Sin ubicación'} · {box.activo ? 'Activa' : 'Inactiva'}</small></span><span className="supplier-product-actions"><span className={`status-pill ${openShifts.some(shift => shift.cajaId === box.id) ? 'amber' : 'green'}`}>{openShifts.some(shift => shift.cajaId === box.id) ? 'Turno abierto' : 'Cerrada'}</span></span></div>)}</div> : !loading && !error && <div className="ws-empty-compact"><Wallet size={26} /><strong>Sin cajas registradas</strong><span>Agrega la primera después de crear la sucursal.</span></div>}</section>

    {activeBoxes.length > 0 && <section className="ws-card" id="cash-shift-control"><div className="ws-card-heading"><div><h2>Caja de trabajo</h2><p>Selecciona la ubicación antes de abrir o cerrar un turno.</p></div><Wallet size={19} /></div><div className="ws-form"><SearchablePicker ariaLabel="Caja de trabajo" value={selectedCajaId} onChange={cajaId => { setSelectedCajaId(cajaId); setSelectedShiftId(openShifts.find(shift => shift.cajaId === cajaId)?.id ?? '') }} options={[{ id: '', label: 'Selecciona una caja' }, ...activeBoxes.map(box => ({ id: box.id, label: box.nombre, detail: `${box.codigo} · ${branchLabel(box.sucursalId)}` }))]} /></div></section>}

    {openShifts.length > 0 && <section className="ws-card"><div className="ws-card-heading"><div><h2>Seleccionar turno abierto</h2><p>Los cobros o pagos en efectivo deben señalar en qué caja ocurrieron.</p></div><Lock size={19} /></div><div className="ws-form"><SearchablePicker ariaLabel="Turno abierto" value={selectedShiftId} onChange={shiftId => { setSelectedShiftId(shiftId); const shift = openShifts.find(item => item.id === shiftId); if (shift?.cajaId) setSelectedCajaId(shift.cajaId) }} options={[{ id: '', label: 'Selecciona un turno' }, ...openShifts.map(shift => ({ id: shift.id, label: boxLabel(shift), detail: `${displayDate(shift.abiertoEn)} · ${shift.abiertoPor ?? ''}` }))]} /></div></section>}

    {!open ? <section className="ws-card"><div className="ws-card-heading"><div><h2>Abrir turno</h2><p>Cada caja admite como máximo un turno abierto. Registra saldo inicial independiente para PEN y USD.</p></div><LockOpen size={19} /></div>{activeBoxes.length ? can('finance', 'crear') ? <form className="ws-form" onSubmit={submitOpen}><SearchablePicker ariaLabel="Caja para apertura" value={selectedCajaId} required onChange={value => { setSelectedCajaId(value); setSelectedShiftId(openShifts.find(shift => shift.cajaId === value)?.id ?? '') }} options={activeBoxes.map(box => ({ id: box.id, label: box.nombre, detail: `${box.codigo} · ${branchLabel(box.sucursalId)}${openShifts.some(shift => shift.cajaId === box.id) ? ' · Ya abierta' : ''}` }))} /><div className="ws-form-grid"><label>Monto inicial PEN (S/)<input name="monto_inicial_pen" type="number" min={0} step={0.01} required defaultValue={0} /></label><label>Monto inicial USD ($)<input name="monto_inicial_usd" type="number" min={0} step={0.01} required defaultValue={0} /></label></div>{formMsg && <div className="ws-notice ws-notice-warning" role="alert">{formMsg}</div>}<div className="ws-heading-actions"><button className="ws-button" type="submit" disabled={busy || loading || !selectedCajaId || openShifts.some(shift => shift.cajaId === selectedCajaId)}>{busy ? 'Abriendo…' : 'Abrir turno'}</button></div></form> : <p>Tu rol no puede abrir turnos.</p> : <div className="ws-empty-compact"><Info size={24} /><strong>No se puede abrir una caja</strong><span>Registra una caja vinculada a una sucursal en esta pantalla.</span></div>}</section> : <section className="ws-card">
      <div className="ws-card-heading"><div><h2>Cerrar turno</h2><p>{boxLabel(open)} · Abierto {displayDate(open.abiertoEn)}{open.abiertoPor ? ` por ${open.abiertoPor}` : ''} · Inicial {moneyCurrency(open.montoInicial, 'PEN')} · {moneyCurrency(open.montoInicialUsd, 'USD')} · {openMovements.length} movimientos en efectivo.</p></div><Lock size={19} /></div>
      <div className="ec-payment-breakdown"><h3>Movimientos registrados por medio y moneda</h3><p>Yape/Plin con QR estático requieren verificación manual. Los registros digitales no forman parte del conteo de efectivo ni implican confirmación automática. Cada moneda se presenta por separado.</p><div className="table-scroll"><table className="record-table"><thead><tr><th>Moneda</th><th>Medio</th><th>Cobros</th><th>Pagos</th><th>Neto registrado</th></tr></thead><tbody>{(() => { const active = movements.filter(item => item.cajaTurnoId === open.id && !item.anuladoEn); const groups = new Map<string, { currency: 'PEN' | 'USD' | null; method: string; incoming: number; outgoing: number }>(); for (const item of active) { const key = `${item.moneda ?? 'unknown'}:${item.medioPago}`; const group = groups.get(key) ?? { currency: item.moneda, method: item.medioPago, incoming: 0, outgoing: 0 }; if (item.moneda) { if (item.tipo === 'cobro') group.incoming += item.monto; else group.outgoing += item.monto } groups.set(key, group) } return [...groups.values()].map(row => <tr key={`${row.currency ?? 'unknown'}:${row.method}`}><td>{row.currency ?? 'Sin moneda conciliada'}</td><td>{row.method}</td><td className="ec-positive record-value">{row.currency ? moneyCurrency(row.incoming, row.currency) : 'No disponible'}</td><td className="ec-negative record-value">{row.currency ? moneyCurrency(row.outgoing, row.currency) : 'No disponible'}</td><td className="record-value">{row.currency ? moneyCurrency(row.incoming - row.outgoing, row.currency) : 'No disponible'}</td></tr>)})()}{!movements.some(item => item.cajaTurnoId === open.id && !item.anuladoEn) && <tr><td colSpan={5}>Sin movimientos vigentes asociados al turno.</td></tr>}</tbody></table></div></div>
      <form className="ws-form" onSubmit={submitClose}><p className="relation-hint"><Info size={15} />El servidor bloquea el turno mientras calcula el saldo esperado y guarda el cierre. No se mezclan monedas y las anulaciones quedan fuera.</p><div className="ws-form-grid"><label>Esperado PEN<input type="text" readOnly value={moneyCurrency(expected.PEN, 'PEN')} /></label><label>Esperado USD<input type="text" readOnly value={moneyCurrency(expected.USD, 'USD')} /></label><label>Contado PEN (S/)<input name="conteo_efectivo_pen" type="number" min={0} step={0.01} required value={conteoPen} onChange={event => setConteoPen(Number(event.target.value) || 0)} /></label><label>Contado USD ($)<input name="conteo_efectivo_usd" type="number" min={0} step={0.01} required value={conteoUsd} onChange={event => setConteoUsd(Number(event.target.value) || 0)} /></label></div><div className="cash-totals"><div><small>Diferencia PEN</small><strong className={variancePen === 0 ? 'ok' : 'bad'}>{moneyCurrency(variancePen, 'PEN')}</strong></div><div><small>Diferencia USD</small><strong className={varianceUsd === 0 ? 'ok' : 'bad'}>{moneyCurrency(varianceUsd, 'USD')}</strong></div></div><label>Notas del cierre<input name="notas" placeholder="Observaciones (opcional)" maxLength={2000} /></label>{formMsg && <div className="ws-notice ws-notice-warning" role="alert">{formMsg}</div>}<div className="ws-heading-actions"><button className="ws-button ws-button-secondary" type="button" disabled={busy || expected.monedaDesconocida > 0} onClick={() => { setConteoPen(expected.PEN); setConteoUsd(expected.USD) }}>Igualar a lo esperado</button><button className="ws-button" type="submit" disabled={busy || expected.monedaDesconocida > 0 || !can('finance', 'editar')}>{busy ? 'Cerrando…' : 'Cerrar turno'}</button></div></form>
    </section>}

    {open && <section className="ws-card cash-section"><div className="ws-card-heading"><div><h2>Movimientos en efectivo del turno</h2><p>{openMovements.length} movimientos activos; los saldos se separan por moneda.</p></div><Wallet size={19} /></div>{openMovements.length ? <div className="supplier-product-list">{openMovements.map(item => <div className="supplier-product-row" key={item.id}><span className="supplier-product-copy"><strong>{item.referencia || (item.tipo === 'cobro' ? 'Cobro' : 'Pago')}</strong><small>{item.tipo === 'cobro' ? 'Entrada' : 'Salida'} · {displayDate(item.createdAt)} · {item.moneda ?? 'Moneda sin conciliar'}</small></span><span className="supplier-product-actions"><strong>{item.moneda ? `${item.tipo === 'pago' ? '−' : '+'}${moneyCurrency(item.monto, item.moneda)}` : 'Importe sin moneda'}</strong></span></div>)}</div> : <div className="ws-empty-compact"><Wallet size={26} /><strong>Sin movimientos en efectivo</strong><span>Los cobros y pagos asociados al turno aparecerán aquí.</span></div>}</section>}

    <section className="ws-card cash-section"><div className="ws-card-heading"><div><h2>Historial de turnos</h2><p>Últimos {shifts.length} turnos registrados; montos separados en PEN y USD.</p></div><Banknote size={19} /></div><div className="ec-filter-chips" role="group" aria-label="Estado del turno">{['Todos', 'Abierto', 'Cerrado'].map(value => <button type="button" key={value} aria-pressed={shiftFilter === value} onClick={() => setShiftFilter(value)}>{value}<span>{loading || error ? '—' : shifts.filter(shift => value === 'Todos' || shift.estado === value).length}</span></button>)}</div>{loading ? <div className="ws-empty-compact"><RefreshCw size={26} className="ws-spin" /><strong>Consultando turnos…</strong></div> : shifts.length ? <div className="table-scroll"><table className="record-table"><thead><tr><th>Caja / sucursal</th><th>Apertura</th><th>Inicial PEN</th><th>Inicial USD</th><th>Esperado PEN</th><th>Esperado USD</th><th>Contado PEN</th><th>Contado USD</th><th>Descuadre PEN</th><th>Descuadre USD</th><th>Estado</th></tr></thead><tbody>{shifts.filter(shift => shiftFilter === 'Todos' || shift.estado === shiftFilter).map(shift => {
      const shiftMovements = movements.filter(item => item.cajaTurnoId === shift.id)
      const computed = expectedFor(shift)
      const legacyMixed = hasUnreconciledHistoricalCashClose(shift.estado, shift.conteoUsd, shiftMovements)
      const expectedPen = shift.saldoEsperadoPen ?? computed.PEN
      const expectedUsd = shift.saldoEsperadoUsd ?? computed.USD
      const countedPen = legacyMixed ? null : shift.conteo.Efectivo == null ? null : Number(shift.conteo.Efectivo)
      const countedUsd = legacyMixed ? null : shift.conteoUsd
      const variancePen = shift.descuadrePen ?? (countedPen === null ? null : Math.round((countedPen - expectedPen) * 100) / 100)
      const varianceUsd = shift.descuadreUsd ?? (countedUsd === null ? null : Math.round((countedUsd - expectedUsd) * 100) / 100)
      return <tr key={shift.id}><td>{boxLabel(shift)}<small>{shift.cajaId ? branchLabel(boxes.find(box => box.id === shift.cajaId)?.sucursalId ?? '') : 'Sin sucursal asociada'}{legacyMixed ? ' · cierre anterior sin desglose de moneda' : ''}</small></td><td className="record-date">{displayDate(shift.abiertoEn)}<small>{shift.abiertoPor ?? ''}</small></td><td className="record-value">{moneyCurrency(shift.montoInicial, 'PEN')}</td><td className="record-value">{moneyCurrency(shift.montoInicialUsd, 'USD')}</td><td className="record-value">{moneyCurrency(expectedPen, 'PEN')}</td><td className="record-value">{moneyCurrency(expectedUsd, 'USD')}</td><td className="record-value">{shift.estado === 'Cerrado' && countedPen !== null ? moneyCurrency(countedPen, 'PEN') : '—'}</td><td className="record-value">{shift.estado === 'Cerrado' && countedUsd !== null ? moneyCurrency(countedUsd, 'USD') : '—'}</td><td>{variancePen === null ? '—' : <span className={`status-pill ${variancePen === 0 ? 'green' : 'red'}`}>{moneyCurrency(variancePen, 'PEN')}</span>}</td><td>{varianceUsd === null ? '—' : <span className={`status-pill ${varianceUsd === 0 ? 'green' : 'red'}`}>{moneyCurrency(varianceUsd, 'USD')}</span>}</td><td><span className={`status-pill ${shift.estado === 'Abierto' ? 'amber' : 'green'}`}>{shift.estado}</span></td></tr>
    })}</tbody></table></div> : !error && <div className="ws-empty-compact"><Banknote size={26} /><strong>Sin turnos registrados</strong><span>Registra una caja y abre el primer turno.</span></div>}</section>
  </div>
}
