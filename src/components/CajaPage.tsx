import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { AlertTriangle, Banknote, CheckCircle2, Info, Lock, LockOpen, RefreshCw, Wallet } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useRecords } from '../context/RecordsContext'
import { closeCashShift, createCashBox, fetchCashMovements, fetchCashSetup, fetchCashShifts, openCashShift, type CashBranch, type CashBox, type CashMovement, type CashShift, fetchCashSellers, fetchShiftSellers, type CashSeller } from '../services/caja'
import { friendlyError } from '../services/records'
import { displayDate } from '../data/workspace'
import { money } from '../data/helpers'

type CashTab = 'caja' | 'movimientos' | 'historial'
const CASH_TABS: { value: CashTab; label: string }[] = [{ value: 'caja', label: 'Caja y turno' }, { value: 'movimientos', label: 'Movimientos' }, { value: 'historial', label: 'Historial' }]

const MIGRATION_HINT = 'No está disponible la estructura de cajas por sucursal. Revisa el historial y aplica solo la migración aprobada antes de reintentar.'

export default function CajaPage() {
  const { can, session, profile } = useAuth()
  const { notify } = useRecords()
  const [branches, setBranches] = useState<CashBranch[]>([])
  const [boxes, setBoxes] = useState<CashBox[]>([])
  const [shifts, setShifts] = useState<CashShift[]>([])
  const [movements, setMovements] = useState<CashMovement[]>([])
  const [sellers, setSellers] = useState<CashSeller[]>([])
  const [shiftSellers, setShiftSellers] = useState<Map<string, string>>(new Map())
  const [selectedSellerId, setSelectedSellerId] = useState('')
  const [selectedCajaId, setSelectedCajaId] = useState('')
  const [selectedShiftId, setSelectedShiftId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [formMsg, setFormMsg] = useState('')
  const [boxMsg, setBoxMsg] = useState('')
  const [lastClose, setLastClose] = useState<{ esperado: number; contado: number } | null>(null)
  const [conteo, setConteo] = useState(0)
  const [tab, setTab] = useState<CashTab>('caja')

  const load = async () => {
    setLoading(true); setError('')
    try {
      const [setup, nextShifts] = await Promise.all([fetchCashSetup(), fetchCashShifts(100)])
      const nextMovements = await fetchCashMovements(nextShifts.map(shift => shift.id))
      const [nextSellers, nextShiftSellers] = await Promise.all([fetchCashSellers(), fetchShiftSellers(nextShifts.map(shift => shift.id))])
      setSellers(nextSellers)
      setShiftSellers(nextShiftSellers)
      // Si quien abre el turno es un vendedor, se propone su propia cuenta.
      setSelectedSellerId(current => current || (nextSellers.find(item => item.id === session?.user.id)?.id ?? ''))
      setBranches(setup.branches)
      setBoxes(setup.boxes)
      setShifts(nextShifts)
      setMovements(nextMovements)
      // Quien tiene una caja asignada la ve elegida por defecto.
      setSelectedCajaId(current => setup.boxes.some(box => box.id === current && box.activo) ? current : setup.boxes.find(box => box.activo && box.responsableId === session?.user.id)?.id ?? setup.boxes.find(box => box.activo)?.id ?? '')
      setSelectedShiftId(current => nextShifts.some(shift => shift.id === current && shift.estado === 'Abierto') ? current : nextShifts.filter(shift => shift.estado === 'Abierto').length === 1 ? nextShifts.find(shift => shift.estado === 'Abierto')?.id ?? '' : '')
    } catch (cause) {
      setError(friendlyError(cause))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { if (can('finance')) void load() }, [can])

  const activeBoxes = useMemo(() => boxes.filter(box => box.activo), [boxes])
  const isAdmin = profile?.rol === 'Administrador'
  const myBox = boxes.find(box => box.responsableId && box.responsableId === session?.user.id) ?? null
  const sellerName = (shiftId: string) => sellers.find(item => item.id === shiftSellers.get(shiftId))?.nombre ?? ''
  const openShifts = useMemo(() => shifts.filter(shift => shift.estado === 'Abierto'), [shifts])
  const open = openShifts.find(shift => shift.id === selectedShiftId) ?? null
  const selectedBox = activeBoxes.find(box => box.id === selectedCajaId) ?? null
  const selectedSeller = sellers.find(item => item.id === selectedBox?.responsableId) ?? null
  const openForSelectedBox = openShifts.find(shift => shift.cajaId === selectedCajaId) ?? null
  const openMovements = useMemo(() => open ? movements.filter(item => item.cajaTurnoId === open.id && !item.anuladoEn && item.medioPago.trim().toLocaleLowerCase('es') === 'efectivo') : [], [movements, open])
  const expectedTotal = useMemo(() => {
    if (!open) return 0
    return Math.round((open.montoInicial + openMovements.reduce((sum, item) => sum + (item.tipo === 'cobro' ? item.monto : -item.monto), 0)) * 100) / 100
  }, [open, openMovements])
  const countedTotal = Math.round((Number(conteo) || 0) * 100) / 100
  const variance = Math.round((countedTotal - expectedTotal) * 100) / 100
  const assignedName = (box: CashBox) => box.responsableId ? sellers.find(item => item.id === box.responsableId)?.nombre ?? 'Cuenta asignada' : ''
  const boxLabel = (shift: CashShift) => {
    if (!shift.cajaId) return 'Turno legado sin caja'
    const box = boxes.find(item => item.id === shift.cajaId)
    return box ? `${box.codigo}${box.responsableId ? ` · ${assignedName(box)}` : ''}` : 'Caja no disponible'
  }
  const branchLabel = (branchId: string) => {
    const branch = branches.find(item => item.id === branchId)
    return branch ? `${branch.nombre} · ${branch.codigo}` : 'Sucursal no disponible'
  }
  const expectedFor = (shift: CashShift) => {
    const amount = shift.montoInicial + movements
      .filter(item => item.cajaTurnoId === shift.id && !item.anuladoEn && item.medioPago.trim().toLocaleLowerCase('es') === 'efectivo')
      .reduce((sum, item) => sum + (item.tipo === 'cobro' ? item.monto : -item.monto), 0)
    return Math.round(amount * 100) / 100
  }
  useEffect(() => { setConteo(open ? expectedTotal : 0) }, [open?.id, expectedTotal])

  if (!can('finance')) {
    return <section className="ws-card ws-empty-compact"><Banknote size={28} /><strong>Acceso restringido a caja</strong><span>Tu rol no tiene permiso de tesorería.</span></section>
  }

  const submitBox = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy || !can('finance', 'crear')) return
    const form = new FormData(event.currentTarget)
    setBusy(true); setBoxMsg('')
    try {
      const codigo = String(form.get('codigo') ?? '')
      const responsableId = String(form.get('responsable_id') ?? '') || null
      // La caja se llama como la cuenta asignada; sin vendedor, se usa el código.
      const nombre = sellers.find(item => item.id === responsableId)?.nombre ?? codigo.trim()
      const box = await createCashBox({ sucursalId: String(form.get('sucursal_id') ?? ''), codigo, nombre, ubicacion: String(form.get('ubicacion') ?? ''), responsableId })
      setSelectedCajaId(box.id)
      await load()
      notify(`Caja ${box.nombre} registrada.`)
    } catch (cause) { setBoxMsg(friendlyError(cause)) }
    finally { setBusy(false) }
  }

  const submitOpen = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy || !selectedCajaId || !can('finance', 'crear')) return
    const monto = Number(new FormData(event.currentTarget).get('monto_inicial') ?? 0)
    setBusy(true); setFormMsg('')
    try {
      const shift = await openCashShift(selectedCajaId, monto, session?.user.email ?? null, selectedBox?.responsableId ?? (selectedSellerId || null))
      setSelectedShiftId(shift.id)
      await load()
      notify(`Turno abierto en ${selectedBox?.nombre ?? 'la caja seleccionada'}.`)
    } catch (cause) { setFormMsg(friendlyError(cause)) }
    finally { setBusy(false) }
  }

  const submitClose = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy || !open || !can('finance', 'editar')) return
    const form = new FormData(event.currentTarget)
    const amount = Number(form.get('conteo_efectivo') ?? 0)
    setBusy(true); setFormMsg('')
    try {
      const closed = await closeCashShift(open.id, { Efectivo: amount }, String(form.get('notas') ?? ''))
      const counted = Math.round(Object.values(closed.conteo).reduce((sum, value) => sum + value, 0) * 100) / 100
      setLastClose({ esperado: expectedTotal, contado: counted })
      await load()
      notify(`Turno cerrado. Descuadre: ${money(Math.round((counted - expectedTotal) * 100) / 100)}.`)
    } catch (cause) { setFormMsg(friendlyError(cause)) }
    finally { setBusy(false) }
  }

  return <div className="ws-cash-stack">
    <section className="ws-page-heading"><div><span className="ws-eyebrow">TESORERÍA / TURNO</span><h1>Cajas y turnos</h1><p>Configura una caja por sucursal y registra cada apertura, movimiento y cierre en su turno.</p></div><div className="ws-heading-actions"><button className="ws-button ws-button-secondary" disabled={loading} onClick={() => void load()}><RefreshCw size={16} />Actualizar</button></div></section>
    {error && <div className="ws-notice ws-notice-warning" role="alert"><AlertTriangle size={18} /><span>{error === 'fetch failed' ? MIGRATION_HINT : error}</span><button className="ws-text-button" onClick={() => void load()}>Reintentar</button></div>}
    {lastClose && <div className="ws-notice" role="status"><CheckCircle2 size={18} /><span>Último cierre: esperado {money(lastClose.esperado)} · contado {money(lastClose.contado)} · descuadre {money(Math.round((lastClose.contado - lastClose.esperado) * 100) / 100)}.</span></div>}

    <div className="ws-view-tabs" style={{ marginBottom: 0 }}><div className="ws-tabs" role="tablist" aria-label="Secciones de caja">{CASH_TABS.map(item => <button key={item.value} type="button" role="tab" aria-selected={tab === item.value} onClick={() => setTab(item.value)}>{item.label}</button>)}</div></div>

    {tab === 'caja' && <>
    <section className="ws-card">
      <div className="ws-card-heading"><div><h2>Registrar caja</h2><p>Una caja pertenece a una sucursal; su código no se repite dentro de esa sucursal.</p></div><Wallet size={19} /></div>
      {branches.length ? can('finance', 'crear') ? <form className="ws-form" onSubmit={submitBox}>
        <div className="ws-form-grid"><label>Sucursal<select name="sucursal_id" required defaultValue=""><option value="">Selecciona una sucursal activa</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.nombre} · {branch.codigo}</option>)}</select></label><label>Código<input name="codigo" required maxLength={20} placeholder="CAJA-01" /></label></div>
        <div className="ws-form-grid"><label>Ubicación dentro de la sucursal<input name="ubicacion" maxLength={160} placeholder="Mostrador principal" /></label>{isAdmin ? <label>Vendedor asignado<select name="responsable_id" defaultValue=""><option value="">Sin vendedor asignado</option>{sellers.map(item => <option key={item.id} value={item.id}>{item.nombre} · {item.email ?? 'sin correo'}</option>)}</select><small>{sellers.length ? 'La caja se llamará como la cuenta elegida. Sus ventas completadas sumarán a sus metas y a las de la sucursal.' : 'Aún no hay cuentas con rol Vendedor: el administrador debe dárselo a una cuenta.'}</small></label> : <span />}</div>
        {boxMsg && <div className="ws-notice ws-notice-warning" role="alert">{boxMsg}</div>}<div className="ws-heading-actions"><button className="ws-button" type="submit" disabled={busy || loading}>{busy ? 'Guardando…' : 'Registrar caja'}</button></div>
      </form> : <p>Tu rol puede consultar cajas, pero no registrar nuevas.</p> : <div className="ws-empty-compact"><Info size={24} /><strong>Primero registra la empresa y una sucursal en Maestros</strong><span>Las cajas requieren una ubicación organizacional. No se creó una caja ficticia para la base de datos.</span></div>}
    </section>

    <section className="ws-card cash-section"><div className="ws-card-heading"><div><h2>Cajas registradas</h2><p>{boxes.length} cajas · {openShifts.length} turnos abiertos</p></div><Banknote size={19} /></div>{myBox && <div className="ws-notice" role="status"><Wallet size={18} /><span><b>Tu caja asignada:</b> {myBox.nombre} · {myBox.codigo} — {branchLabel(myBox.sucursalId)}. Tus ventas completadas suman a tus metas y a las de esta sucursal.</span></div>}{boxes.length ? <div className="supplier-product-list">{boxes.map(box => <div className="supplier-product-row" key={box.id}><span className="supplier-product-copy"><strong>{box.codigo}</strong></span><span className="supplier-product-actions"><span className={`status-pill ${openShifts.some(shift => shift.cajaId === box.id) ? 'amber' : 'green'}`}>{openShifts.some(shift => shift.cajaId === box.id) ? 'Turno abierto' : 'Cerrada'}</span></span></div>)}</div> : !loading && !error && <div className="ws-empty-compact"><Wallet size={26} /><strong>Sin cajas registradas</strong><span>Agrega la primera después de crear la sucursal.</span></div>}</section>


    {openShifts.length > 1 && <section className="ws-card"><div className="ws-card-heading"><div><h2>Seleccionar turno abierto</h2><p>Los cobros o pagos en efectivo deben señalar en qué caja ocurrieron.</p></div><Lock size={19} /></div><label className="ws-form">Turno<select value={selectedShiftId} onChange={event => { const shiftId = event.target.value; setSelectedShiftId(shiftId); const shift = openShifts.find(item => item.id === shiftId); if (shift?.cajaId) setSelectedCajaId(shift.cajaId) }}><option value="">Selecciona un turno</option>{openShifts.map(shift => <option key={shift.id} value={shift.id}>{boxLabel(shift)} · {displayDate(shift.abiertoEn)}{shift.abiertoPor ? ` · ${shift.abiertoPor}` : ''}{sellerName(shift.id) ? ` · Vendedor: ${sellerName(shift.id)}` : ''}</option>)}</select></label></section>}

    {!open ? <section className="ws-card"><div className="ws-card-heading"><div><h2>Abrir turno</h2><p>Cada caja admite como máximo un turno abierto.</p></div>{openShifts.length === 1 && <button type="button" className="ws-text-button" onClick={() => setSelectedShiftId(openShifts[0].id)}>Volver al turno abierto</button>}<LockOpen size={19} /></div>{activeBoxes.length ? can('finance', 'crear') ? <form className="ws-form" onSubmit={submitOpen}><label>Caja<select value={selectedCajaId} required onChange={event => { setSelectedCajaId(event.target.value); setSelectedShiftId(openShifts.find(shift => shift.cajaId === event.target.value)?.id ?? ''); const picked = activeBoxes.find(box => box.id === event.target.value); if (picked?.responsableId) setSelectedSellerId(picked.responsableId) }}><option value="">Selecciona una caja activa</option>{activeBoxes.map(box => <option key={box.id} value={box.id}>{box.codigo}{openShifts.some(shift => shift.cajaId === box.id) ? ' · Ya abierta' : ''}</option>)}</select></label>{selectedBox && <dl className="ws-cash-info"><div><dt>Caja</dt><dd>{selectedBox.nombre}<small>{selectedBox.codigo}{selectedBox.ubicacion ? ` · ${selectedBox.ubicacion}` : ''}</small></dd></div><div><dt>Cuenta asignada</dt><dd>{selectedSeller ? selectedSeller.nombre : selectedBox.responsableId ? 'Cuenta asignada' : 'Sin vendedor asignado'}</dd></div><div><dt>Correo</dt><dd>{selectedSeller?.email ?? '—'}</dd></div><div><dt>Sucursal</dt><dd>{branchLabel(selectedBox.sucursalId)}</dd></div></dl>}{sellers.length > 0 && selectedBox && !selectedBox.responsableId && <label>Vendedor de este turno (opcional)<select value={selectedSellerId} onChange={event => setSelectedSellerId(event.target.value)}><option value="">Sin vendedor asignado</option>{sellers.map(item => <option key={item.id} value={item.id}>{item.nombre}</option>)}</select><small>Esta caja no tiene vendedor asignado. Si eliges uno, sus ventas durante el turno suman a sus metas y a las de la sucursal.</small></label>}<label>Monto inicial en efectivo (S/)<input name="monto_inicial" type="number" min={0} step={0.01} required defaultValue={0} /></label>{formMsg && <div className="ws-notice ws-notice-warning" role="alert">{formMsg}</div>}<div className="ws-heading-actions"><button className="ws-button" type="submit" disabled={busy || loading || !selectedCajaId || openShifts.some(shift => shift.cajaId === selectedCajaId)}>{busy ? 'Abriendo…' : 'Abrir turno'}</button></div></form> : <p>Tu rol no puede abrir turnos.</p> : <div className="ws-empty-compact"><Info size={24} /><strong>No se puede abrir una caja</strong><span>Registra una caja vinculada a una sucursal en esta pantalla.</span></div>}</section> : <section className="ws-card">
      <div className="ws-card-heading"><div><h2>Cerrar turno</h2><p>{boxLabel(open)} · Abierto {displayDate(open.abiertoEn)}{open.abiertoPor ? ` por ${open.abiertoPor}` : ''}{sellerName(open.id) ? ` · Vendedor: ${sellerName(open.id)}` : ''} · Inicial {money(open.montoInicial)} · {openMovements.length} movimientos en efectivo.</p></div>{activeBoxes.some(box => !openShifts.some(shift => shift.cajaId === box.id)) && can('finance', 'crear') && <button type="button" className="ws-text-button" onClick={() => setSelectedShiftId('')}>Abrir turno en otra caja</button>}<Lock size={19} /></div>
      <form className="ws-form" onSubmit={submitClose}><p className="relation-hint"><Info size={15} />El esperado usa el saldo inicial y los cobros menos los pagos en efectivo asociados a este turno. Las anulaciones no cuentan.</p><div className="cash-methods"><div className="cash-method"><span className="ws-soft-icon green"><Banknote size={18} /></span><span className="cash-method-copy"><strong>Efectivo</strong><small>Sistema {money(expectedTotal)}</small></span><label className="cash-count"><small>Contado</small><input name="conteo_efectivo" type="number" min={0} step={0.01} required value={conteo} onChange={event => setConteo(Number(event.target.value) || 0)} aria-label="Conteo físico de efectivo" /></label><span className={`status-pill ${variance === 0 ? 'green' : 'amber'}`}>{variance === 0 ? 'Cuadra' : money(variance)}</span></div></div><div className="cash-totals"><div><small>Sistema</small><strong>{money(expectedTotal)}</strong></div><div><small>Contado</small><strong>{money(countedTotal)}</strong></div><div><small>Descuadre</small><strong className={variance === 0 ? 'ok' : 'bad'}>{money(variance)}</strong></div></div><label>Notas del cierre<input name="notas" placeholder="Observaciones (opcional)" /></label>{formMsg && <div className="ws-notice ws-notice-warning" role="alert">{formMsg}</div>}<div className="ws-heading-actions"><button className="ws-button ws-button-secondary" type="button" disabled={busy} onClick={() => setConteo(expectedTotal)}>Igualar a lo esperado</button><button className="ws-button" type="submit" disabled={busy || !can('finance', 'editar')}>{busy ? 'Cerrando…' : 'Cerrar turno'}</button></div></form>
    </section>}

    </>}

    {tab === 'movimientos' && <>
    <section className="ws-card cash-section"><div className="ws-card-heading"><div><h2>Movimientos del turno</h2><p>{open ? `${boxLabel(open)} · ${openMovements.length} movimientos en efectivo, vinculados de forma explícita a esta caja.` : 'Cobros y pagos en efectivo del turno abierto.'}</p></div><Wallet size={19} /></div>{!open ? <div className="ws-empty-compact"><Lock size={26} /><strong>No hay un turno seleccionado</strong><span>{openShifts.length ? 'Elige un turno abierto para ver sus movimientos.' : 'Abre un turno para registrar y consultar sus movimientos en efectivo.'}</span><button type="button" className="ws-text-button" onClick={() => setTab('caja')}>Ir a Caja y turno</button></div> : openMovements.length ? <div className="supplier-product-list">{openMovements.map(item => <div className="supplier-product-row" key={item.id}><span className="supplier-product-copy"><strong>{item.referencia || (item.tipo === 'cobro' ? 'Cobro' : 'Pago')}</strong><small>{item.tipo === 'cobro' ? 'Entrada' : 'Salida'} · {displayDate(item.createdAt)}</small></span><span className="supplier-product-actions"><strong>{item.tipo === 'pago' ? '−' : '+'}{money(item.monto)}</strong></span></div>)}</div> : <div className="ws-empty-compact"><Wallet size={26} /><strong>Sin movimientos en efectivo</strong><span>Los cobros y pagos asociados al turno aparecerán aquí.</span></div>}</section>
    </>}

    {tab === 'historial' && <>
    <section className="ws-card cash-section"><div className="ws-card-heading"><div><h2>Historial de turnos</h2><p>Últimos {shifts.length} turnos registrados.</p></div><Banknote size={19} /></div>{loading ? <div className="ws-empty-compact"><RefreshCw size={26} className="ws-spin" /><strong>Consultando turnos…</strong></div> : shifts.length ? <div className="table-scroll"><table className="record-table"><thead><tr><th>Caja / sucursal</th><th>Apertura</th><th>Inicial</th><th>Esperado</th><th>Contado</th><th>Descuadre</th><th>Estado</th></tr></thead><tbody>{shifts.map(shift => {
      const counted = Math.round(Object.values(shift.conteo).reduce((sum, value) => sum + value, 0) * 100) / 100
      const expected = expectedFor(shift)
      return <tr key={shift.id}><td>{boxLabel(shift)}<small>{shift.cajaId ? branchLabel(boxes.find(box => box.id === shift.cajaId)?.sucursalId ?? '') : 'Sin sucursal asociada'}</small></td><td className="record-date">{displayDate(shift.abiertoEn)}<small>{shift.abiertoPor ?? ''}</small></td><td className="record-value">{money(shift.montoInicial)}</td><td className="record-value">{money(expected)}</td><td className="record-value">{shift.estado === 'Cerrado' ? money(counted) : '—'}</td><td>{shift.estado === 'Cerrado' ? <span className={`status-pill ${counted - expected === 0 ? 'green' : 'red'}`}>{money(Math.round((counted - expected) * 100) / 100)}</span> : '—'}</td><td><span className={`status-pill ${shift.estado === 'Abierto' ? 'amber' : 'green'}`}>{shift.estado}</span></td></tr>
    })}</tbody></table></div> : !error && <div className="ws-empty-compact"><Banknote size={26} /><strong>Sin turnos registrados</strong><span>Registra una caja y abre el primer turno.</span></div>}</section>
    </>}
  </div>
}
