import { useRef, useState } from 'react'
import { ArrowLeft, ArrowLeftRight, ChevronLeft, ChevronRight, FileText, RefreshCw, RotateCcw, Save, Undo2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useRecords } from '../context/RecordsContext'
import { fetchActiveWarehouses, registerPurchaseReceipt, type ActiveWarehouse } from '../services/records'
import {
  compensatePurchaseReturn, fetchPendingPurchaseReplenishments, fetchPurchaseReturnCompensations,
  fetchPurchaseReturnHistory, fetchPurchaseReturnLines, registerPurchaseReturn, updatePurchaseCreditTracking,
  type PendingPurchaseReplenishment, type PurchaseReturnCompensation, type PurchaseReturnEvent, type PurchaseReturnLine,
} from '../services/purchaseReceipts'

const HISTORY_PAGE_SIZE = 5
function errorText(error: unknown) {
  const message = (error as { message?: string } | null)?.message ?? 'No se pudo completar la devolución.'
  if (message.includes('Could not find the function') || message.includes('does not exist')) return 'Falta aplicar en Supabase la migración E06–E10 de créditos y reposiciones.'
  return message
}
function requestKey() { return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}` }
function overMax(value: string | undefined, max: number) { return Number(value ?? 0) > Number(max ?? 0) }
function invalidQty(value: string | undefined, max: number) { return overMax(value, max) ? ' is-invalid' : '' }

export default function PurchaseReturnsPage() {
  const { can } = useAuth()
  const { records, errors, notify, reload } = useRecords()
  const navigate = useNavigate()
  const [opened, setOpened] = useState<string | null>(null)
  const [lines, setLines] = useState<PurchaseReturnLine[]>([])
  const [history, setHistory] = useState<PurchaseReturnEvent[]>([])
  const [compensations, setCompensations] = useState<Record<string, PurchaseReturnCompensation[]>>({})
  const [pendingReplenishments, setPendingReplenishments] = useState<PendingPurchaseReplenishment[]>([])
  const [warehouses, setWarehouses] = useState<ActiveWarehouse[]>([])
  const [warehouseId, setWarehouseId] = useState('')
  const [creditReference, setCreditReference] = useState<Record<string, string>>({})
  const [creditStatus, setCreditStatus] = useState<Record<string, 'Pendiente' | 'Aplicado' | 'Repuesto'>>({})
  const [replenishmentQuantities, setReplenishmentQuantities] = useState<Record<string, string>>({})
  const [compensationQuantities, setCompensationQuantities] = useState<Record<string, string>>({})
  const [compensationReasons, setCompensationReasons] = useState<Record<string, string>>({})
  const [savingDocument, setSavingDocument] = useState<string | null>(null)
  const [replenishmentKey, setReplenishmentKey] = useState(requestKey)
  const [compensationKey, setCompensationKey] = useState(requestKey)
  const [historyTotal, setHistoryTotal] = useState(0)
  const [historyPage, setHistoryPage] = useState(0)
  const [quantities, setQuantities] = useState<Record<string, string>>({})
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [error, setError] = useState('')
  const [key, setKey] = useState(requestKey)
  const openRevision = useRef(0)

  const loadHistory = async (purchaseId: string, page: number) => {
    setHistoryLoading(true)
    try {
      const result = await fetchPurchaseReturnHistory(purchaseId, HISTORY_PAGE_SIZE, page * HISTORY_PAGE_SIZE)
      setHistory(result.items); setHistoryTotal(result.total); setHistoryPage(page)
      setCreditReference(current => ({ ...current, ...Object.fromEntries(result.items.map(event => [event.id, event.referencia_documental ?? ''])) }))
      setCreditStatus(current => ({ ...current, ...Object.fromEntries(result.items.map(event => [event.id, event.estado_credito ?? 'Pendiente'])) }))
    } catch (cause) { setError(errorText(cause)) }
    finally { setHistoryLoading(false) }
  }

  const open = async (purchaseId: string, force = false) => {
    const revision = ++openRevision.current
    if (opened === purchaseId && !force) { setOpened(null); return }
    setOpened(purchaseId); setLoading(true); setError(''); setLines([]); setHistory([]); setHistoryTotal(0)
    setHistoryPage(0); setQuantities({}); setReason('')
    try {
      const [returnLines, returnHistory, pending, activeWarehouses] = await Promise.all([
        fetchPurchaseReturnLines(purchaseId),
        fetchPurchaseReturnHistory(purchaseId, HISTORY_PAGE_SIZE, 0),
        fetchPendingPurchaseReplenishments(purchaseId),
        fetchActiveWarehouses(),
      ])
      if (revision !== openRevision.current) return
      setLines(returnLines); setHistory(returnHistory.items); setHistoryTotal(returnHistory.total)
      setPendingReplenishments(pending); setWarehouses(activeWarehouses)
      const historyCompensations = await Promise.all(returnHistory.items.map(async event => [event.id, await fetchPurchaseReturnCompensations(event.id)] as const))
      if (revision !== openRevision.current) return
      setCompensations(Object.fromEntries(historyCompensations))
      setCreditReference(Object.fromEntries(returnHistory.items.map(event => [event.id, event.referencia_documental ?? ''])))
      setCreditStatus(Object.fromEntries(returnHistory.items.map(event => [event.id, event.estado_credito ?? 'Pendiente'])))
      setQuantities(Object.fromEntries(returnLines.map(line => [line.id, '0'])))
      setReplenishmentQuantities(Object.fromEntries(pending.map(line => [line.detalle_devolucion_id, '0'])))
    } catch (cause) { if (revision === openRevision.current) setError(errorText(cause)) }
    finally { if (revision === openRevision.current) setLoading(false) }
  }

  const saveTracking = async (event: PurchaseReturnEvent) => {
    if (busy) return
    setSavingDocument(event.id); setError('')
    try {
      await updatePurchaseCreditTracking({ devolucionId: event.id, referenciaDocumental: creditReference[event.id]?.trim() || null, estado: creditStatus[event.id] ?? 'Pendiente' })
      notify(`Seguimiento documental de ${event.codigo} actualizado. CxP no modificada.`)
      await loadHistory(opened ?? '', historyPage)
    } catch (cause) { setError(errorText(cause)) }
    finally { setSavingDocument(null) }
  }

  const saveCompensation = async (event: PurchaseReturnEvent) => {
    if (busy) return
    const selected = event.lineas.flatMap(line => {
      const quantity = Number(compensationQuantities[line.detalle_devolucion_id] ?? 0)
      return Number.isInteger(quantity) && quantity > 0 ? [{ detalle_devolucion_id: line.detalle_devolucion_id, cantidad: quantity }] : []
    })
    const reasonText = compensationReasons[event.id]?.trim() ?? ''
    if (reasonText.length < 3 || !selected.length) return setError('Indica motivo y cantidades para la compensación referenciada.')
    setBusy(true); setError('')
    try {
      const reversalId = await compensatePurchaseReturn({ devolucionId: event.id, motivo: reasonText, lineas: selected, idempotencyKey: compensationKey })
      notify(`Compensación ${reversalId} registrada como entrada inversa; la devolución original se conserva.`)
      setCompensationKey(requestKey()); setCompensationReasons(current => ({ ...current, [event.id]: '' }))
      const [updatedHistory, updatedCompensations, updatedLines, pending] = await Promise.all([
        fetchPurchaseReturnHistory(opened ?? '', HISTORY_PAGE_SIZE, historyPage * HISTORY_PAGE_SIZE),
        fetchPurchaseReturnCompensations(event.id),
        fetchPurchaseReturnLines(opened ?? ''),
        fetchPendingPurchaseReplenishments(opened ?? ''),
      ])
      setHistory(updatedHistory.items); setHistoryTotal(updatedHistory.total); setCompensations(current => ({ ...current, [event.id]: updatedCompensations }))
      setLines(updatedLines); setPendingReplenishments(pending)
    } catch (cause) { setError(errorText(cause)) }
    finally { setBusy(false) }
  }

  const registerReplenishment = async (purchaseId: string) => {
    if (busy) return
    const selected = pendingReplenishments.flatMap(line => {
      const quantity = Number(replenishmentQuantities[line.detalle_devolucion_id] ?? 0)
      return Number.isInteger(quantity) && quantity > 0 ? [{ detalle_compra_id: line.detalle_compra_id, cantidad: quantity, devolucion_detalle_id: line.detalle_devolucion_id }] : []
    })
    if (!warehouseId || !selected.length) return setError('Selecciona almacén y cantidad para una reposición pendiente.')
    if (new Set(selected.map(line => line.detalle_compra_id)).size !== selected.length) return setError('Registra por separado las reposiciones que corresponden a la misma línea de orden, para conservar un origen de devolución único por recepción.')
    const exceeds = selected.find(item => item.cantidad > (pendingReplenishments.find(line => line.detalle_devolucion_id === item.devolucion_detalle_id)?.pendiente_reposicion ?? 0))
    if (exceeds) return setError('La reposición supera la cantidad documentada y pendiente.')
    setBusy(true); setError('')
    try {
      await registerPurchaseReceipt({ compraId: purchaseId, almacenId: warehouseId, lineas: selected, idempotencyKey: replenishmentKey })
      notify('Reposición registrada como nueva recepción contra la misma orden. Se reconoció según el flujo estándar, sin compensar automáticamente notas de crédito.')
      setReplenishmentKey(requestKey())
      const [returnLines, pending, updatedHistory] = await Promise.all([
        fetchPurchaseReturnLines(purchaseId), fetchPendingPurchaseReplenishments(purchaseId),
        fetchPurchaseReturnHistory(purchaseId, HISTORY_PAGE_SIZE, historyPage * HISTORY_PAGE_SIZE), reload(),
      ])
      setLines(returnLines); setPendingReplenishments(pending); setHistory(updatedHistory.items); setHistoryTotal(updatedHistory.total)
      setReplenishmentQuantities(Object.fromEntries(pending.map(line => [line.detalle_devolucion_id, '0'])))
    } catch (cause) { setError(errorText(cause)) }
    finally { setBusy(false) }
  }

  const submit = async (purchaseId: string) => {
    if (busy) return
    const selected = lines.flatMap(line => {
      const quantity = Number(quantities[line.id] ?? 0)
      return Number.isInteger(quantity) && quantity > 0 ? [{ detalle_recepcion_id: line.id, cantidad: quantity }] : []
    })
    if (reason.trim().length < 3) { setError('Indica un motivo de al menos 3 caracteres.'); return }
    if (!selected.length) { setError('Ingresa una cantidad en al menos una línea.'); return }
    const exceeds = selected.find(item => item.cantidad > (lines.find(line => line.id === item.detalle_recepcion_id)?.maximo_retornable ?? 0))
    if (exceeds) { setError('La cantidad supera el máximo retornable del servidor (neto recibido y stock físico). Actualiza los datos e inténtalo de nuevo.'); return }
    setBusy(true); setError('')
    try {
      await registerPurchaseReturn({ compraId: purchaseId, motivo: reason.trim(), lineas: selected, idempotencyKey: key })
      notify('Devolución registrada: stock y Kardex actualizados. La nota de crédito queda para conciliación manual de Tesorería; la CxP no se modifica.')
      setKey(requestKey()); setReason('')
      const [returnLines, pending] = await Promise.all([fetchPurchaseReturnLines(purchaseId), fetchPendingPurchaseReplenishments(purchaseId), loadHistory(purchaseId, 0), reload()])
      setLines(returnLines); setQuantities(Object.fromEntries(returnLines.map(line => [line.id, '0'])))
      setPendingReplenishments(pending); setReplenishmentQuantities(Object.fromEntries(pending.map(line => [line.detalle_devolucion_id, '0'])))
    } catch (cause) { setError(errorText(cause)) }
    finally { setBusy(false) }
  }

  const purchases = records.purchases.filter(item => item.rowId)
  if (!can('purchases', 'ver')) return <section className="ws-card"><div className="ws-empty-compact"><strong>No tienes permiso para consultar devoluciones.</strong></div></section>
  if (errors.purchases) return <section className="ws-card"><div className="ws-notice ws-notice-warning" role="alert">No se pudieron cargar las órdenes para devoluciones: {errors.purchases}</div></section>

  return <>
    <section className="ws-page-heading"><div><span className="ws-eyebrow">COMPRAS · DEVOLUCIONES</span><h1>Devoluciones a proveedor</h1><p>Consulta cantidades brutas y netas, stock físico y notas de crédito con trazabilidad a Kardex.</p></div><div className="ws-heading-actions"><button className="ws-button ws-button-secondary" onClick={() => void reload()}><RefreshCw size={16}/>Actualizar</button></div></section>
    <div className="ws-notice" role="note"><ArrowLeftRight size={17}/><span>La devolución descuenta stock físico y crea Kardex. <strong>No reduce la CxP:</strong> Compras conserva el seguimiento documental y Tesorería aplica manualmente la nota de crédito. Las reposiciones son nuevas recepciones contra la misma orden.</span></div>
    {!can('purchases','editar') || !(can('inventory','crear') || can('inventory','editar')) ? <div className="ws-notice ws-notice-warning">Para confirmar devoluciones se requieren permisos de edición de Compras y creación o edición de Inventario.</div> : null}
    {purchases.length ? <div className="sourcing-list">{purchases.map(purchase => <section className="ws-card sourcing-card" key={purchase.rowId}>
      <button type="button" className="sourcing-card-head" aria-expanded={opened === purchase.rowId} onClick={() => void open(purchase.rowId!)}><span><strong>{purchase.id} · {purchase.name}</strong><small>{purchase.estadoRecepcion === 'completa' ? 'Recepción completa' : purchase.estadoRecepcion === 'parcial' ? 'Recepción parcial' : 'Sin recepción registrada'} · {purchase.detail}</small></span><span className="status-pill blue">Ver netos / NC <ArrowLeftRight size={14}/></span></button>
      {opened === purchase.rowId && <div className="sourcing-card-body">
        {error && <div className="ws-notice ws-notice-warning" role="alert">{error}<button className="ws-text-button" type="button" onClick={() => void open(purchase.rowId!, true)}>Actualizar</button></div>}
        {loading ? <div className="ws-empty-compact"><RefreshCw size={20} className="ws-spin"/><strong>Consultando netos, stock e historial…</strong></div> : <>
          {lines.length ? <div className="table-scroll"><table className="record-table"><thead><tr><th>Artículo / recepción</th><th>Recibido bruto</th><th>Devuelto</th><th>Neto recibido</th><th>Stock físico disponible</th><th>Máximo retornable</th><th>Devolver</th></tr></thead><tbody>{lines.map(line => <tr key={line.id}>
            <td>{line.descripcion || line.producto_id}<small>{line.recepcion_codigo} · {line.almacen} · {new Date(line.recibido_en).toLocaleDateString('es-PE')}</small></td>
            <td>{line.recibido_bruto}<small>Evento seleccionado: {line.recibido_en_evento}</small></td><td>{line.devuelto}</td><td><strong>{line.neto_recibido}</strong></td>
            <td>{line.stock_disponible}</td><td><strong>{line.maximo_retornable}</strong><small>Decidido por servidor</small></td>
            <td><input className={`ws-control sourcing-return-qty${invalidQty(quantities[line.id], line.maximo_retornable)}`} aria-invalid={overMax(quantities[line.id], line.maximo_retornable) || undefined} aria-label={`Cantidad a devolver de ${line.descripcion ?? line.producto_id}`} type="number" min="0" max={line.maximo_retornable} step="1" disabled={line.maximo_retornable <= 0 || busy} value={quantities[line.id] ?? '0'} onChange={event => { setQuantities(current => ({ ...current, [line.id]: event.target.value })); setKey(requestKey()) }}/></td>
          </tr>)}</tbody></table></div> : <div className="ws-empty-compact"><strong>No hay recepciones registradas para esta orden.</strong></div>}
          {lines.length > 0 && can('purchases','editar') && (can('inventory','crear') || can('inventory','editar')) && <><label className="sourcing-return-reason">Motivo de devolución<textarea className="ws-control" rows={3} maxLength={1000} value={reason} onChange={event => { setReason(event.target.value); setKey(requestKey()) }} placeholder="Producto dañado, discrepancia, error de despacho…"/></label><div className="sourcing-form-foot"><small>El RPC vuelve a validar neto recibido y stock físico dentro de la transacción. Ninguna devolución actualiza pagos o aplicaciones de CxP.</small><button className="ws-button" type="button" disabled={busy || !lines.some(line => Number(quantities[line.id] ?? 0) > 0)} onClick={() => void submit(purchase.rowId!)}><RotateCcw size={15}/>{busy ? 'Registrando…' : 'Registrar devolución'}</button></div></>}
          {pendingReplenishments.length > 0 && can('purchases','editar') && (can('inventory','crear') || can('inventory','editar')) && <section className="ws-replenishment-panel"><h3><RotateCcw size={15}/> Reposición pendiente · nueva recepción</h3><p>Cada cantidad se enlaza a la devolución documentada. El servidor limita el ingreso a lo pendiente y registra otra recepción estándar contra esta orden.</p><label>Almacén destino<select className="ws-control" value={warehouseId} onChange={e => setWarehouseId(e.target.value)}><option value="">Selecciona almacén</option>{warehouses.map(warehouse => <option key={warehouse.id} value={warehouse.id}>{warehouse.nombre}</option>)}</select></label><div className="table-scroll"><table className="record-table"><thead><tr><th>Devolución / línea</th><th>Devuelto</th><th>Compensado</th><th>Repuesto</th><th>Pendiente</th><th>Reponer ahora</th></tr></thead><tbody>{pendingReplenishments.map(line => <tr key={line.detalle_devolucion_id}><td>{line.devolucion_codigo} · {line.descripcion}<small>Almacén original: {line.almacen}</small></td><td>{line.cantidad_devuelta}</td><td>{line.cantidad_compensada}</td><td>{line.cantidad_repuesta}</td><td><strong>{line.pendiente_reposicion}</strong></td><td><input className={`ws-control sourcing-return-qty${invalidQty(replenishmentQuantities[line.detalle_devolucion_id], line.pendiente_reposicion)}`} aria-invalid={overMax(replenishmentQuantities[line.detalle_devolucion_id], line.pendiente_reposicion) || undefined} type="number" min="0" max={line.pendiente_reposicion} step="1" disabled={!line.pendiente_reposicion || busy} value={replenishmentQuantities[line.detalle_devolucion_id] ?? '0'} onChange={e => { setReplenishmentQuantities(current => ({ ...current, [line.detalle_devolucion_id]: e.target.value })); setReplenishmentKey(requestKey()) }}/></td></tr>)}</tbody></table></div><button className="ws-button" type="button" disabled={busy || !warehouseId || !pendingReplenishments.some(line => Number(replenishmentQuantities[line.detalle_devolucion_id] ?? 0)>0)} onClick={() => void registerReplenishment(purchase.rowId!)}><RotateCcw size={15}/>{busy ? 'Registrando recepción…' : 'Registrar como nueva recepción'}</button></section>}
          <section className="ws-return-history"><h3><FileText size={15}/> Historial de documentos de devolución</h3>
            {historyLoading ? <small>Consultando historial…</small> : history.length ? history.map(event => <article className="ws-return-history-item" key={event.id}>
              <header><strong>{event.codigo}</strong><small>{new Date(event.created_at).toLocaleString('es-PE')} · {event.actor ?? event.actor_id ?? 'Usuario'}</small><p>{event.motivo}</p></header>
              <ul>{event.lineas.map(line => <li key={line.detalle_devolucion_id}><span>{line.descripcion ?? line.producto_id}: {line.cantidad} · {line.recepcion_codigo} · {line.almacen}</span><small>Kardex: {line.movimiento_kardex_id ?? 'movimiento vinculado'}{line.movimiento_kardex_fecha ? ` · ${new Date(line.movimiento_kardex_fecha).toLocaleString('es-PE')}` : ''}</small></li>)}</ul>
              <div className="ws-credit-tracking"><label>Referencia documental (Nota de Crédito)<input className="ws-control" maxLength={120} value={creditReference[event.id] ?? event.referencia_documental ?? ''} onChange={e => setCreditReference(current => ({ ...current, [event.id]: e.target.value }))} placeholder="NC-001-000123"/></label><label>Seguimiento<select className="ws-control" value={creditStatus[event.id] ?? event.estado_credito ?? 'Pendiente'} onChange={e => setCreditStatus(current => ({ ...current, [event.id]: e.target.value as 'Pendiente' | 'Aplicado' | 'Repuesto' }))}><option>Pendiente</option><option>Aplicado</option><option>Repuesto</option></select></label><button className="ws-button ws-button-secondary" type="button" disabled={savingDocument===event.id || !can('purchases','editar')} onClick={() => void saveTracking(event)}><Save size={14}/>{savingDocument===event.id ? 'Guardando…' : 'Guardar seguimiento'}</button></div>
              <small className="ws-return-credit-note">La Nota de Crédito es seguimiento documental. “Aplicado” solo registra la conciliación manual de Tesorería; no cambia CxP desde Compras.</small>
              {compensations[event.id]?.map(compensation => <div className="ws-compensation-item" key={compensation.id}><strong>Compensación inversa {compensation.codigo}</strong><small>{new Date(compensation.created_at).toLocaleString('es-PE')} · {compensation.actor ?? compensation.actor_id ?? 'Usuario'} · {compensation.motivo}</small><ul>{compensation.lineas.map((line,index) => <li key={`${line.detalle_devolucion_id}-${index}`}>Entrada {line.cantidad} · {line.almacen} · Kardex {line.movimiento_kardex_id ?? 'vinculado'}</li>)}</ul></div>)}
              {can('purchases','editar') && (can('inventory','crear') || can('inventory','editar')) && <div className="ws-compensation-form"><h4><Undo2 size={14}/> Compensar devolución errónea</h4><p>Genera una entrada inversa vinculada al documento; no borra la devolución. Solo se admite cantidad no repuesta.</p>{event.lineas.map(line => <label key={line.detalle_devolucion_id}>{line.descripcion ?? line.producto_id} · devuelto {line.cantidad}<input className={`ws-control sourcing-return-qty${invalidQty(compensationQuantities[line.detalle_devolucion_id], line.cantidad)}`} aria-invalid={overMax(compensationQuantities[line.detalle_devolucion_id], line.cantidad) || undefined} type="number" min="0" max={line.cantidad} step="1" value={compensationQuantities[line.detalle_devolucion_id] ?? '0'} onChange={e => { setCompensationQuantities(current => ({ ...current, [line.detalle_devolucion_id]: e.target.value })); setCompensationKey(requestKey()) }}/></label>)}<label>Motivo de compensación<textarea className="ws-control" rows={2} maxLength={1000} value={compensationReasons[event.id] ?? ''} onChange={e => { setCompensationReasons(current => ({ ...current, [event.id]: e.target.value })); setCompensationKey(requestKey()) }}/></label><button className="ws-button ws-button-secondary" type="button" disabled={busy || !event.lineas.some(line => Number(compensationQuantities[line.detalle_devolucion_id] ?? 0)>0)} onClick={() => void saveCompensation(event)}><Undo2 size={14}/>{busy ? 'Procesando…' : 'Registrar compensación inversa'}</button></div>}
            </article>) : <small>No hay documentos de devolución para esta orden.</small>}
            {historyTotal > HISTORY_PAGE_SIZE && <div className="ws-pagination"><span>{historyPage * HISTORY_PAGE_SIZE + 1}–{Math.min((historyPage + 1) * HISTORY_PAGE_SIZE, historyTotal)} de {historyTotal}</span><div><button className="ws-icon-button" type="button" aria-label="Devoluciones anteriores" disabled={historyPage === 0 || historyLoading} onClick={() => void loadHistory(purchase.rowId!, historyPage - 1)}><ChevronLeft size={14}/></button><span>{historyPage + 1}/{Math.ceil(historyTotal / HISTORY_PAGE_SIZE)}</span><button className="ws-icon-button" type="button" aria-label="Devoluciones siguientes" disabled={(historyPage + 1) * HISTORY_PAGE_SIZE >= historyTotal || historyLoading} onClick={() => void loadHistory(purchase.rowId!, historyPage + 1)}><ChevronRight size={14}/></button></div></div>}
          </section>
        </>}
      </div>}
    </section>)}</div> : <section className="ws-card"><div className="ws-empty-compact"><strong>No hay órdenes de compra.</strong></div></section>}
    <div className="sourcing-back"><button className="ws-text-button" onClick={() => navigate('/purchases')}><ArrowLeft size={15}/>Volver a Órdenes nacionales</button></div>
  </>
}
