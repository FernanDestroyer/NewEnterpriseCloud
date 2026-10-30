import { useEffect, useState, type FormEvent } from 'react'
import { Fingerprint, Package, RefreshCw } from 'lucide-react'
import { inventoryQueryError } from '../services/inventoryQueries'
import { configureTrace, identifyLot, identifySerial, inventoryKey, loadLotBalances, loadPendingLots, loadPendingSerials, loadTraceModes, type LotBalance, type PendingLot, type PendingSerial, type TraceMode } from '../services/inventoryOperations'
import { InventoryGate, InventoryHeader, InventoryMessage, localDateTime, units, useInventoryReference } from './inventoryShared'

type LotDraft = { code: string; expiry: string; key: string }
type SerialDraft = { number: string; key: string }
const PAGE_SIZE = 100

function PendingPager({ page, total, loading, onPage }: { page: number; total: number; loading: boolean; onPage: (page: number) => void }) {
  if (total <= PAGE_SIZE) return null
  return <div className="inv-pagination"><span>Página {page + 1} de {Math.ceil(total / PAGE_SIZE)} · {total} pendientes</span><div>
    <button type="button" className="ws-button ws-button-secondary" disabled={loading || page === 0} onClick={() => onPage(page - 1)}>Anterior</button>
    <button type="button" className="ws-button ws-button-secondary" disabled={loading || (page + 1) * PAGE_SIZE >= total} onClick={() => onPage(page + 1)}>Siguiente</button>
  </div></div>
}

export default function InventoryTracePage() {
  const reference = useInventoryReference()
  const { can, products, byProduct, byWarehouse, stocks, loading, error, refresh } = reference
  const [productId, setProductId] = useState('')
  const [mode, setMode] = useState<'lote' | 'serie'>('lote')
  const [modes, setModes] = useState<TraceMode[]>([])
  const [lots, setLots] = useState<PendingLot[]>([])
  const [serials, setSerials] = useState<PendingSerial[]>([])
  const [lotTotal, setLotTotal] = useState(0)
  const [serialTotal, setSerialTotal] = useState(0)
  const [balances, setBalances] = useState<LotBalance[]>([])
  const [lotDrafts, setLotDrafts] = useState<Record<string, LotDraft>>({})
  const [serialDrafts, setSerialDrafts] = useState<Record<string, SerialDraft>>({})
  const [lotPage, setLotPage] = useState(0)
  const [serialPage, setSerialPage] = useState(0)
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [success, setSuccess] = useState('')
  const [traceError, setTraceError] = useState('')
  const [traceLoading, setTraceLoading] = useState(true)
  const [version, setVersion] = useState(0)
  const refreshTrace = () => setVersion(value => value + 1)

  useEffect(() => {
    if (!can('inventory', 'ver')) return
    let active = true
    setTraceLoading(true); setTraceError('')
    void Promise.all([loadTraceModes(), loadPendingLots(lotPage, productId || null), loadPendingSerials(serialPage, productId || null)]).then(async ([nextModes, nextLots, nextSerials]) => {
      const nextBalances = await loadLotBalances(nextLots.rows.map(item => item.id))
      if (active) {
        setModes(nextModes); setLots(nextLots.rows); setSerials(nextSerials.rows); setBalances(nextBalances)
        setLotTotal(nextLots.total); setSerialTotal(nextSerials.total)
        if (lotPage > 0 && !nextLots.rows.length) setLotPage(Math.max(0, Math.ceil(nextLots.total / PAGE_SIZE) - 1))
        if (serialPage > 0 && !nextSerials.rows.length) setSerialPage(Math.max(0, Math.ceil(nextSerials.total / PAGE_SIZE) - 1))
      }
    }).catch(cause => { if (active) setTraceError(inventoryQueryError(cause)) })
      .finally(() => { if (active) setTraceLoading(false) })
    return () => { active = false }
  }, [can, version, lotPage, serialPage, productId])

  const configured = modes.find(item => item.producto_id === productId)
  const physicalStock = stocks.filter(item => item.producto_id === productId).reduce((sum, item) => sum + Number(item.stock_fisico), 0)
  const editable = can('inventory', 'editar')
  const balancesByLot = new Map<string, LotBalance[]>()
  for (const row of balances) balancesByLot.set(row.lote_id, [...(balancesByLot.get(row.lote_id) ?? []), row])

  const saveMode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy || loading || traceLoading || error || traceError) return
    setMessage(''); setSuccess('')
    if (!productId || configured || physicalStock > 0) return setMessage('El producto debe existir, no estar configurado y tener stock físico cero en todos los almacenes.')
    setBusy('config')
    try {
      await configureTrace(productId, mode)
      setSuccess(`Trazabilidad por ${mode} habilitada. Identifica las futuras entradas antes de despacharlas.`)
      refreshTrace(); void refresh().catch(() => {})
    } catch (cause) { setMessage(inventoryQueryError(cause)) }
    finally { setBusy('') }
  }

  const saveLot = async (event: FormEvent<HTMLFormElement>, lot: PendingLot) => {
    event.preventDefault()
    if (busy) return
    const draft = lotDrafts[lot.id]
    if (!draft?.code.trim()) return setMessage('Ingresa un código de lote.')
    setBusy(lot.id); setMessage(''); setSuccess('')
    try {
      await identifyLot(lot.id, draft.code.trim(), draft.expiry || null, draft.key)
      setSuccess(`Lote ${draft.code.trim()} identificado. La entrada conserva su vínculo con el movimiento original.`)
      setLots(current => current.filter(item => item.id !== lot.id)); setLotTotal(current => Math.max(0, current - 1)); refreshTrace()
    } catch (cause) { setMessage(inventoryQueryError(cause)) }
    finally { setBusy('') }
  }

  const saveSerial = async (event: FormEvent<HTMLFormElement>, serial: PendingSerial) => {
    event.preventDefault()
    if (busy) return
    const draft = serialDrafts[serial.id]
    if (!draft?.number.trim()) return setMessage('Ingresa el número de serie.')
    setBusy(serial.id); setMessage(''); setSuccess('')
    try {
      await identifySerial(serial.id, draft.number.trim(), draft.key)
      setSuccess(`Serie ${draft.number.trim()} identificada y disponible para su trazabilidad.`)
      setSerials(current => current.filter(item => item.id !== serial.id)); setSerialTotal(current => Math.max(0, current - 1)); refreshTrace()
    } catch (cause) { setMessage(inventoryQueryError(cause)) }
    finally { setBusy('') }
  }

  return <InventoryGate canView={can('inventory', 'ver')}><section className="inv-page">
    <InventoryHeader title="Lotes y series" description="Activa la trazabilidad desde stock cero e identifica entradas pendientes." onRefresh={() => { refreshTrace(); return refresh() }} loading={loading || traceLoading} />
    {error && <InventoryMessage>{error}</InventoryMessage>}{traceError && <InventoryMessage>{traceError}</InventoryMessage>}{message && <InventoryMessage>{message}</InventoryMessage>}{success && <InventoryMessage tone="success">{success}</InventoryMessage>}
    <InventoryMessage>La trazabilidad solo puede activarse cuando el producto tiene stock cero. Las entradas posteriores quedan pendientes de identificación; los lotes vencidos y las unidades sin identificar no pueden despacharse.</InventoryMessage>
    <form className="inv-card" onSubmit={event => void saveMode(event)}>
      <div className="inv-card-heading"><Fingerprint size={18} /><div><strong>Configurar trazabilidad</strong><small>El modo es permanente: no se puede cambiar de lote a serie después de configurarlo.</small></div></div>
      <div className="inv-form-grid">
        <label>Producto<select className="ws-control" value={productId} onChange={event => { setProductId(event.target.value); setLotPage(0); setSerialPage(0) }}><option value="">Seleccionar producto / ver todas las entradas</option>{products.map(item => <option key={item.rowId} value={item.rowId}>{item.id} · {item.name}</option>)}</select></label>
        <label>Modo<select className="ws-control" value={configured?.modo ?? mode} disabled={Boolean(configured)} onChange={event => setMode(event.target.value as 'lote' | 'serie')}><option value="lote">Lotes · fecha de vencimiento</option><option value="serie">Serie única por unidad</option></select></label>
        <div className="inv-inline-stat"><span>Stock físico total</span><strong>{productId ? units(physicalStock) : '—'}</strong><span>Estado</span><span className={`inv-badge ${configured ? 'green' : physicalStock > 0 ? 'amber' : 'neutral'}`}>{configured ? `Configurado · ${configured.modo}` : productId && physicalStock > 0 ? 'Bloqueado · stock positivo' : 'Sin configurar'}</span></div>
      </div>
      <div className="inv-actions"><span>{configured ? 'Este producto ya tiene un modo de trazabilidad.' : physicalStock > 0 ? 'El stock histórico no puede asignarse a lotes o series desde esta pantalla.' : 'El backend verifica el stock otra vez antes de configurar.'}</span><button className="ws-button" type="submit" disabled={!editable || !productId || Boolean(configured) || physicalStock > 0 || Boolean(busy) || loading || traceLoading || Boolean(error) || Boolean(traceError)}>{busy === 'config' ? 'Configurando…' : 'Habilitar trazabilidad'}</button></div>
    </form>

    <section className="inv-card">
      <div className="inv-card-heading"><Package size={18} /><div><strong>Lotes pendientes <span className="inv-badge amber">{lotTotal}</span></strong><small>Indica código único por producto y, si corresponde, caducidad.</small></div></div>
      {traceLoading ? <div className="inv-inline-note"><RefreshCw size={14} className="ws-spin" />Cargando lotes…</div> : !lots.length ? <div className="inv-inline-note">No hay lotes pendientes para el filtro actual.</div> : <div className="inv-table-wrap"><table className="inv-table"><thead><tr><th scope="col">Producto / entrada</th><th scope="col">Existencias del lote</th><th scope="col">Código de lote</th><th scope="col">Vencimiento</th><th scope="col">Acción</th></tr></thead><tbody>
        {lots.map(lot => {
          const draft = lotDrafts[lot.id] ?? { code: '', expiry: '', key: '' }
          const rows = balancesByLot.get(lot.id) ?? []
          return <tr key={lot.id}>
            <td><strong>{byProduct.get(lot.producto_id)?.name ?? lot.producto_id}</strong><small>{localDateTime(lot.creado_en)} · {lot.movimiento_entrada_id ?? lot.id}</small></td>
            <td>{rows.map(row => <small key={row.almacen_id}>{byWarehouse.get(row.almacen_id) ?? row.almacen_id}: {units(row.cantidad)}</small>)}</td>
            <td><form id={`lot-${lot.id}`} onSubmit={event => void saveLot(event, lot)} /><input form={`lot-${lot.id}`} className="ws-control" aria-label="Código de lote" value={draft.code} onChange={event => setLotDrafts(current => ({ ...current, [lot.id]: { ...draft, code: event.target.value, key: inventoryKey() } }))} required maxLength={120} placeholder="Código único" disabled={!editable || Boolean(busy)} /></td>
            <td><input form={`lot-${lot.id}`} type="date" className="ws-control" aria-label="Vencimiento del lote" value={draft.expiry} onChange={event => setLotDrafts(current => ({ ...current, [lot.id]: { ...draft, expiry: event.target.value, key: inventoryKey() } }))} disabled={!editable || Boolean(busy)} /></td>
            <td><button type="submit" form={`lot-${lot.id}`} className="ws-button ws-button-secondary" disabled={!editable || Boolean(busy) || !draft.code.trim() || traceLoading || Boolean(traceError)}>{busy === lot.id ? 'Guardando…' : 'Identificar'}</button></td>
          </tr>
        })}
      </tbody></table></div>}
      <PendingPager page={lotPage} total={lotTotal} loading={traceLoading || Boolean(busy)} onPage={setLotPage} />
    </section>

    <section className="inv-card">
      <div className="inv-card-heading"><Fingerprint size={18} /><div><strong>Series pendientes <span className="inv-badge amber">{serialTotal}</span></strong><small>Una serie por unidad; el número debe ser único por producto.</small></div></div>
      {traceLoading ? <div className="inv-inline-note"><RefreshCw size={14} className="ws-spin" />Cargando series…</div> : !serials.length ? <div className="inv-inline-note">No hay series pendientes para el filtro actual.</div> : <div className="inv-table-wrap"><table className="inv-table"><thead><tr><th scope="col">Producto</th><th scope="col">Almacén / entrada</th><th scope="col">Número de serie</th><th scope="col">Acción</th></tr></thead><tbody>
        {serials.map(serial => {
          const draft = serialDrafts[serial.id] ?? { number: '', key: '' }
          return <tr key={serial.id}>
            <td><strong>{byProduct.get(serial.producto_id)?.name ?? serial.producto_id}</strong></td>
            <td>{byWarehouse.get(serial.almacen_id ?? '') ?? serial.almacen_id ?? '—'}<small>{localDateTime(serial.creado_en)}</small></td>
            <td><form id={`serial-${serial.id}`} onSubmit={event => void saveSerial(event, serial)} /><input form={`serial-${serial.id}`} className="ws-control" aria-label="Número de serie" required value={draft.number} onChange={event => setSerialDrafts(current => ({ ...current, [serial.id]: { number: event.target.value, key: inventoryKey() } }))} disabled={!editable || Boolean(busy)} placeholder="Número único" /></td>
            <td><button type="submit" form={`serial-${serial.id}`} className="ws-button ws-button-secondary" disabled={!editable || Boolean(busy) || !draft.number.trim() || traceLoading || Boolean(traceError)}>{busy === serial.id ? 'Guardando…' : 'Identificar'}</button></td>
          </tr>
        })}
      </tbody></table></div>}
      <PendingPager page={serialPage} total={serialTotal} loading={traceLoading || Boolean(busy)} onPage={setSerialPage} />
    </section>
  </section></InventoryGate>
}
