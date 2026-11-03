import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useRecords } from '../context/RecordsContext'
import { businessDate, shiftDate } from '../data/workspace'
import { cancelSalesOrder, createSalesOrder, creditSalesOrder, fetchSalesCreditBalance, guideSalesOrder, invoiceSalesOrder, loadSalesOperations, saveSalesQuote, convertSalesQuote, type SaleLine, type SalesOrder, type SalesQuote, type SalesReceipt } from '../services/salesOperations'
import { SalesReceiptPrint } from './SalesReceiptPrint'
import '../sales-operations.css'

type Data = Awaited<ReturnType<typeof loadSalesOperations>>
type Action = { kind: 'invoice' | 'guide' | 'credit' | 'convert' | 'cancel'; order?: SalesOrder; quote?: SalesQuote }
type Tab = 'orders' | 'quotes' | 'receipts' | 'guides' | 'credits' | 'sunat'
const paths: Record<Tab, string> = { orders: '/sales', quotes: '/quotes', receipts: '/sales/receipts', guides: '/sales/guides', credits: '/sales/credits', sunat: '/sales/sunat' }
const key = () => crypto.randomUUID()
const initialLine = (): SaleLine => ({ producto_id: '', cantidad: 1, precio: 0, afectacion: '10' })
const errorText = (error: unknown) => error instanceof Error ? error.message : 'No se pudo completar la operación.'
const amount = (value: number, currency = 'PEN') => new Intl.NumberFormat('es-PE', { style: 'currency', currency }).format(value)

export default function SalesOperationsPage({ initialTab = 'orders' }: { initialTab?: Tab }) {
  const { can } = useAuth()
  const { company, reload: reloadWorkspace } = useRecords()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>(initialTab)
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [busy, setBusy] = useState(false)
  const [action, setAction] = useState<Action | null>(null)
  const [editing, setEditing] = useState<SalesQuote | null>(null)
  const [customer, setCustomer] = useState('')
  const [warehouse, setWarehouse] = useState('')
  const [currency, setCurrency] = useState<'PEN' | 'USD'>('PEN')
  const [rate, setRate] = useState('1')
  const [expiry, setExpiry] = useState(() => shiftDate(businessDate(new Date()), 14))
  const [lines, setLines] = useState<SaleLine[]>([initialLine()])
  const [historyId, setHistoryId] = useState<string | null>(null)
  const [docType, setDocType] = useState<'01' | '03'>('03')
  const [convertToSale, setConvertToSale] = useState(true)
  const [series, setSeries] = useState('B001')
  const [number, setNumber] = useState('1')
  const [origin, setOrigin] = useState('')
  const [destination, setDestination] = useState('')
  const [reason, setReason] = useState('')
  const [returnStock, setReturnStock] = useState(false)
  const [creditBalance, setCreditBalance] = useState<number | null>(null)
  const [creditBalanceError, setCreditBalanceError] = useState('')
  const [printReceipt, setPrintReceipt] = useState<SalesReceipt | null>(null)
  const [requestKey, setRequestKey] = useState(key)
  const loadSequence = useRef(0)
  const reload = useCallback(async () => {
    const sequence = ++loadSequence.current
    const next = await loadSalesOperations()
    if (sequence === loadSequence.current) setData(next)
  }, [])
  useEffect(() => { void reload().catch(cause => setError(errorText(cause))) }, [reload])
  useEffect(() => {
    if (action?.kind !== 'credit' || !action.order?.venta_id || !can('finance', 'ver')) return
    let active = true
    setCreditBalance(null)
    setCreditBalanceError('')
    void fetchSalesCreditBalance(action.order.venta_id).then(value => { if (active) setCreditBalance(value) }).catch(cause => { if (active) setCreditBalanceError(errorText(cause)) })
    return () => { active = false }
  }, [action, can])
  const updateLine = (index: number, changes: Partial<SaleLine>) => setLines(previous => previous.map((line, i) => i === index ? { ...line, ...changes } : line))
  const begin = (next: Action) => { setAction(next); setRequestKey(key()); setError(''); setSuccess(''); setConvertToSale(false); setCreditBalance(null); setCreditBalanceError(''); setLines(next.order?.lineas.map(line => ({ ...line, cantidad: 0 })) ?? [initialLine()]); setReason(''); setReturnStock(false) }
  const run = async (operation: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true); setError(''); setSuccess('')
    const resetAfterSave = () => { setAction(null); setEditing(null); setLines([initialLine()]); setRequestKey(key()) }
    try {
      try { await operation() }
      catch (cause) { setError(errorText(cause)); return }
      try { await reload() }
      catch (cause) {
        setError(`Operación guardada con éxito, pero hubo un problema al recargar la lista. ${errorText(cause)}`)
        resetAfterSave()
        void reloadWorkspace()
        return
      }
      resetAfterSave()
      void reloadWorkspace()
      setSuccess('Operación registrada correctamente en Supabase.')
      if (action?.kind === 'convert') { setTab('orders'); navigate('/sales') }
    } finally { setBusy(false) }
  }
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const selected = lines.filter(line => line.producto_id && line.cantidad > 0)
    if (!selected.length || selected.length !== lines.length) return setError('Completa todas las líneas o elimina las vacías.')
    if (new Set(selected.map(line => line.producto_id)).size !== selected.length) return setError('Cada producto debe aparecer solo una vez.')
    if (!customer) return setError('Selecciona un cliente.')
    if (tab === 'orders' && !warehouse) return setError('Selecciona el almacén de reserva.')
    if (currency === 'USD' && (!Number.isFinite(Number(rate)) || Number(rate) <= 0)) return setError('Ingresa un tipo de cambio positivo.')
    if (tab === 'quotes' && expiry < businessDate(new Date())) return setError('La fecha de vencimiento no puede estar en el pasado.')
    if (tab === 'quotes') void run(() => saveSalesQuote({ id: editing?.id ?? null, cliente: customer, vence: expiry, moneda: currency, cambio: Number(rate), lineas: selected, key: requestKey }))
    else void run(() => createSalesOrder({ cliente: customer, almacen: warehouse, moneda: currency, cambio: Number(rate), lineas: selected, key: requestKey }))
  }
  const submitAction = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!action) return
    if (action.kind === 'convert' && action.quote) void run(() => convertSalesQuote({ quote: action.quote!.id, almacen: warehouse, tipo: convertToSale ? docType : null, serie: convertToSale ? series.trim().toUpperCase() : null, numero: convertToSale ? Number(number) : null, key: requestKey }))
    if (action.kind === 'invoice' && action.order) void run(() => invoiceSalesOrder(action.order!.id, docType, series.trim().toUpperCase(), Number(number), requestKey))
    if (action.kind === 'guide' && action.order) {
      if (origin.trim().length < 4 || destination.trim().length < 4) return setError('Ingresa origen y destino con al menos 4 caracteres.')
      void run(() => guideSalesOrder(action.order!.id, origin.trim(), destination.trim(), requestKey))
    }
    if (action.kind === 'credit' && action.order) {
      if (creditBalance === null) return setError('Espera a que se consulte el saldo pendiente antes de confirmar la nota de crédito.')
      const selected = lines.filter(line => line.cantidad > 0)
      if (!selected.length) return setError('Escribe al menos una cantidad a acreditar.')
      if (selected.some(line => !Number.isInteger(line.cantidad) || line.cantidad > remaining(action.order!, line.producto_id))) return setError('Una cantidad supera el máximo aún acreditable de esa línea.')
      const estimated = selected.reduce((sum, line) => sum + line.cantidad * line.precio, 0)
      if (Math.round(estimated * 100) / 100 > creditBalance) return setError('El importe supera el saldo no cobrado. La RPC verificará el saldo definitivo.')
      void run(() => creditSalesOrder(action.order!.id, selected.map(line => ({ producto_id: line.producto_id, cantidad: line.cantidad })), reason.trim(), returnStock, requestKey))
    }
    if (action.kind === 'cancel' && action.order) void run(() => cancelSalesOrder(action.order!.id, requestKey))
  }
  const startEdit = (quote: SalesQuote) => { setTab('quotes'); setEditing(quote); setCustomer(quote.cliente_id); setExpiry(quote.vence_el < businessDate(new Date()) ? shiftDate(businessDate(new Date()), 14) : quote.vence_el); setCurrency(quote.moneda); setRate(String(quote.tipo_cambio)); setLines(quote.lineas); setRequestKey(key()); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  const customerName = (id: string) => data?.customers.find(item => item.id === id)?.razon_social ?? id
  const productName = (id: string) => data?.products.find(item => item.id === id)?.nombre ?? id
  const remaining = (order: SalesOrder, productId: string) => {
    const original = order.lineas.find(line => line.producto_id === productId)?.cantidad ?? 0
    const credited = data?.credits.filter(note => note.pedido_id === order.id).reduce((sum, note) => sum + note.lineas.filter(line => line.producto_id === productId).reduce((qty, line) => qty + line.cantidad, 0), 0) ?? 0
    return Math.max(0, original - credited)
  }
  const available = (productId: string) => {
    if (!data || !warehouse) return 0
    const onHand = data.inventory.find(item => item.almacen_id === warehouse && item.producto_id === productId)?.cantidad ?? 0
    const reserved = data.reservations.reduce((sum, item) => {
      const order = data.orders.find(value => value.id === item.pedido_id)
      return sum + (order?.almacen_id === warehouse && ['reservado', 'facturado'].includes(order.estado) && item.producto_id === productId ? item.cantidad - item.entregado : 0)
    }, 0)
    return Math.max(0, onHand - reserved)
  }
  const status = (value: string) => value === 'vigente' || value === 'despachado' ? 'green' : value === 'anulado' || value === 'vencida' ? 'red' : 'amber'
  const creditInvalid = action?.kind === 'credit' && (
    !action.order || creditBalance === null || !lines.some(line => line.cantidad > 0) ||
    lines.some(line => line.cantidad < 0 || !Number.isInteger(line.cantidad) || line.cantidad > remaining(action.order!, line.producto_id)) ||
    Math.round(lines.reduce((sum, line) => sum + Math.max(0, line.cantidad) * line.precio, 0) * 100) / 100 > creditBalance
  )
  if (!can(tab === 'quotes' ? 'quotes' : 'sales')) return <section className="ws-card">Acceso restringido.</section>
  return <div className={`ws-sales-page ws-sales-page--${tab}`}>
    <section className="ws-page-heading ws-sales-heading"><div className="ws-sales-heading-copy"><span className="ws-eyebrow">VENTAS · OPERACIÓN INTEGRAL</span><h1>Operaciones de ventas</h1><p>Reserva al crear el pedido; CxC al facturar; salida física solo con guía.</p></div><button type="button" className="ws-button ws-button-secondary ws-sales-refresh" onClick={() => void reload().catch(cause => setError(errorText(cause)))}>Actualizar</button></section>
    <div className="ws-notice ws-sales-info" role="note">SUNAT: datos UBL 2.1 preparados; imprimir no equivale a enviar ni obtener CDR. Las ventas anteriores a este flujo no se despachan desde aquí para evitar doble salida.</div>
    <div className="ws-tabs ws-sales-tabs" role="tablist" aria-label="Secciones de Ventas">{([['orders','Pedidos y ventas'],['quotes','Cotizaciones'],['receipts','Comprobantes'],['guides','Guías'],['credits','Notas de crédito'],['sunat','SUNAT']] as const).map(([id,label]) => <button type="button" role="tab" key={id} aria-selected={tab===id} onClick={() => navigate(paths[id])}>{label}</button>)}</div>
    {error && <div className="ws-notice ws-notice-warning ws-sales-warning" role="alert">{error}</div>}
    {success && <div className="ws-notice ws-sales-success" role="status">{success}</div>}
    {(tab === 'orders' || tab === 'quotes') && can(tab === 'quotes' ? 'quotes' : 'sales', editing ? 'editar' : 'crear') && <form className={`ws-card ws-sales-form ws-sales-form--${tab}`} onSubmit={submit}>
      <div className="ws-sales-form-head"><div><span className="ws-sales-kicker">{tab === 'quotes' ? 'PROPUESTA COMERCIAL' : 'RESERVA DE STOCK'}</span><h2>{tab === 'quotes' ? editing ? `Nueva versión de cotización · v${editing.version+1}` : 'Nueva cotización' : 'Nuevo pedido con reserva'}</h2></div></div>
      <div className="ws-form-grid ws-sales-fields"><label>Cliente<select required value={customer} onChange={event => setCustomer(event.target.value)}><option value="">Selecciona cliente</option>{data?.customers.map(item => <option key={item.id} value={item.id}>{item.razon_social} · {item.documento ?? 'Sin documento'}</option>)}</select></label>
      {tab === 'orders' ? <label>Almacén<select required value={warehouse} onChange={event => setWarehouse(event.target.value)}><option value="">Selecciona almacén</option>{data?.warehouses.map(item => <option value={item.id} key={item.id}>{item.nombre}</option>)}</select></label> : <label>Vigente hasta<input required min={businessDate(new Date())} type="date" value={expiry} onChange={event => setExpiry(event.target.value)} /></label>}
      <label>Moneda<select value={currency} onChange={event => { const next=event.target.value as 'PEN' | 'USD'; setCurrency(next); if(next==='PEN')setRate('1') }}><option value="PEN">PEN</option><option value="USD">USD</option></select></label>
      {currency==='USD' && <label>Tipo de cambio (PEN / USD)<input required type="number" min="0.000001" step="0.000001" value={rate} onChange={event => setRate(event.target.value)} /></label>}</div>
      <div className="ws-sales-product-section"><div className="ws-sales-product-heading"><h3>Productos</h3><small>Precios con IGV incluido</small></div>{lines.map((line,index) => <div className="ws-form-grid ws-sales-line" key={index}>
        <label>Producto<select required value={line.producto_id} onChange={event => { const id=event.target.value; updateLine(index,{producto_id:id,precio:data?.products.find(p=>p.id===id)?.precio ?? 0}) }}><option value="">Selecciona</option>{data?.products.map(item => <option value={item.id} key={item.id}>{item.nombre}{tab === 'orders' && warehouse && can('inventory') ? ` · libre aprox. ${available(item.id)}` : ''}</option>)}</select>{tab === 'orders' && warehouse && line.producto_id && can('inventory') && <small className={line.cantidad > available(line.producto_id) ? 'ws-sales-over-limit' : 'relation-hint'}>Libre estimado: {available(line.producto_id)} · la RPC valida el stock al guardar</small>}</label>
        <label>Cantidad<input required min="1" step="1" type="number" value={line.cantidad} onChange={event=>updateLine(index,{cantidad:Number(event.target.value)})} /></label>
        <label>Precio unitario<input required min="0.01" step="0.01" type="number" value={line.precio} onChange={event=>updateLine(index,{precio:Number(event.target.value)})} /></label>
        <label>Afectación IGV<select value={line.afectacion} onChange={event=>updateLine(index,{afectacion:event.target.value as SaleLine['afectacion']})}><option value="10">10 · Gravado 18%</option><option value="20">20 · Exonerado</option><option value="30">30 · Inafecto</option></select></label>
        <button type="button" className="ws-button ws-button-secondary ws-sales-remove" disabled={lines.length===1} onClick={()=>setLines(previous=>previous.filter((_,i)=>i!==index))}>Quitar</button></div>)}</div>
      <div className="ws-sales-form-footer"><p className="ws-sales-total">Total estimado: {amount(lines.reduce((sum,line)=>sum+line.cantidad*line.precio,0),currency)}</p>
      <div className="ws-heading-actions"><button type="button" className="ws-button ws-button-secondary" onClick={()=>setLines(previous=>[...previous,initialLine()])}>Añadir línea</button>{editing&&<button type="button" className="ws-button ws-button-secondary" onClick={()=>{setEditing(null);setCustomer('');setLines([initialLine()]);setExpiry(shiftDate(businessDate(new Date()),14));setRequestKey(key())}}>Cancelar edición</button>}<button disabled={busy||!data} className="ws-button" type="submit">{busy?'Guardando…':editing?'Guardar versión':tab==='quotes'?'Guardar cotización':'Reservar pedido'}</button></div></div>
    </form>}
    <section className={`ws-card ws-sales-list ws-sales-list--${tab}`}><h2>{tab==='quotes'?'Cotizaciones':tab==='orders'?'Pedidos':tab==='receipts'?'Boletas y facturas':tab==='guides'?'Guías de remisión':tab==='sunat'?'Emisión electrónica SUNAT':'Notas de crédito'}</h2>
      {!data && <p>Cargando información…</p>}
      {tab==='sunat' ? <div className="ws-sales-sunat-state" role="status"><div className="ws-sales-sunat-summary"><span className="ws-sales-kicker">ESTADO DE INTEGRACIÓN</span><h3>Datos UBL 2.1 preparados</h3><p>Los catálogos y snapshots están preparados en Supabase.</p></div><div className="ws-sales-sunat-provider"><span>Proveedor de emisión</span><strong>No conectado</strong><p>No se envían documentos ni se reciben CDR.</p></div><p className="ws-sales-sunat-disclaimer">La impresión tampoco equivale a emisión electrónica.</p></div> : <div className="table-scroll"><table className="record-table ws-sales-table"><thead><tr><th>Referencia</th><th>Cliente / detalle</th><th>Estado</th><th>Importe</th><th>Acciones</th></tr></thead><tbody>
      {tab==='quotes' && data?.quotes.map(q=>{const expired=q.vence_el<businessDate(new Date())&&q.estado==='vigente'; const label=expired?'vencida':q.estado;const linked=data.orders.find(o=>o.cotizacion_id===q.id&&o.estado!=='anulado');return <tr key={q.id}><td><span className="record-id">{q.id.slice(0,8)}</span><small>Versión {q.version}</small></td><td><strong>{customerName(q.cliente_id)}</strong><small>Vence: {q.vence_el} · {q.lineas.length} línea(s)</small></td><td><span className={`ws-sales-status is-${status(label)}`}>{label}</span></td><td className="record-value">{amount(q.total,q.moneda)}</td><td><div className="row-actions"><button type="button" className="ws-button ws-button-secondary" aria-expanded={historyId===q.id} onClick={()=>setHistoryId(current=>current===q.id?null:q.id)}>Versiones</button>{q.estado==='vigente'&&can('quotes','editar')&&<button type="button" className="ws-button ws-button-secondary" onClick={()=>startEdit(q)}>{expired?'Renovar':'Nueva versión'}</button>}{!expired&&q.estado==='vigente'&&can('sales','crear')&&can('quotes','editar')&&<button type="button" className="ws-button" onClick={()=>begin({kind:'convert',quote:q})}>Convertir a pedido</button>}{linked&&<button type="button" className="ws-button ws-button-secondary" onClick={()=>navigate('/sales')}>Ver {linked.codigo}</button>}</div></td></tr>})}
      {tab==='orders' && data?.orders.map(o=><tr key={o.id}><td><span className="record-id">{o.codigo}</span></td><td><strong>{customerName(o.cliente_id)}</strong><small>{o.lineas.length} producto(s) · {o.moneda} · TC {o.tipo_cambio}</small></td><td><span className={`ws-sales-status is-${status(o.estado)}`}>{o.estado}</span></td><td className="record-value">{amount(o.total,o.moneda)}</td><td><div className="row-actions">{o.estado==='reservado'&&can('sales','crear')&&<button className="ws-button" onClick={()=>begin({kind:'invoice',order:o})}>Facturar</button>}{o.estado==='reservado'&&can('sales','editar')&&<button className="ws-button ws-button-secondary" onClick={()=>begin({kind:'cancel',order:o})}>Anular pedido</button>}{o.estado==='facturado'&&can('sales','editar')&&<button className="ws-button" onClick={()=>begin({kind:'guide',order:o})}>Emitir guía</button>}{o.estado==='despachado'&&can('sales','editar')&&<button className="ws-button ws-button-secondary" onClick={()=>begin({kind:'credit',order:o})}>Nota de crédito</button>}</div></td></tr>)}
      {tab==='receipts' && data?.receipts.map(r=><tr key={r.id}><td><span className="record-id">{r.serie}-{r.numero}</span><small>{r.tipo==='01'?'Factura':'Boleta'}</small></td><td><strong>{r.snapshot?.cliente ?? 'Cliente no informado'}</strong><small>{new Date(r.created_at).toLocaleDateString('es-PE', { timeZone: 'America/Lima' })}</small></td><td><span className={`ws-sales-status is-${r.estado_sunat==='aceptado'?'green':r.estado_sunat==='rechazado'?'red':'amber'}`}>{r.estado_sunat}</span></td><td className="record-value">{amount(r.total,r.moneda)}</td><td><button className="ws-button ws-button-secondary" onClick={()=>setPrintReceipt(r)}>Detalle · A4 / ticket</button></td></tr>)}
      {tab==='guides' && data?.guides.map(g=><tr key={g.id}><td><span className="record-id">{g.codigo}</span></td><td><strong>{g.origen} → {g.destino}</strong><small>{g.lineas?.length ?? 0} producto(s) · {new Date(g.created_at).toLocaleDateString('es-PE', { timeZone: 'America/Lima' })}</small></td><td><span className="ws-sales-status is-green">despachado</span></td><td>—</td><td>{can('inventory')&&<button type="button" className="ws-button ws-button-secondary" onClick={()=>navigate(`/movimiento-kardex?q=${encodeURIComponent(g.id)}`)}>Ver salida en Kardex</button>}</td></tr>)}
      {tab==='credits' && data?.credits.map(n=><tr key={n.id}><td><span className="record-id">{n.codigo}</span></td><td><strong>{n.motivo}</strong><small>{n.lineas.length} producto(s) acreditados</small></td><td><span className="ws-sales-status is-green">registrada</span></td><td className="record-value">{amount(n.total,data?.orders.find(o=>o.id===n.pedido_id)?.moneda??'PEN')}</td><td>{can('inventory')&&<button type="button" className="ws-button ws-button-secondary" onClick={()=>navigate(`/movimiento-kardex?q=${encodeURIComponent(n.id)}`)}>Consultar Kardex</button>}</td></tr>)}
      </tbody></table></div>}{tab==='quotes'&&historyId&&<div className="ws-sales-history"><h3>Historial de versiones</h3>{data?.versions.filter(version=>version.cotizacion_id===historyId).sort((a,b)=>b.version-a.version).map(version=><div key={`${version.cotizacion_id}-${version.version}`}><strong>Versión {version.version}</strong><span>{version.vence_el} · {version.lineas.length} líneas · {amount(version.total,version.moneda)}</span></div>)}</div>}
      {data&&tab==='orders'&&!data.orders.length&&<div className="ws-empty-compact">Aún no hay pedidos reservados. Selecciona cliente, almacén y productos para crear el primero.</div>}
      {data&&tab==='quotes'&&!data.quotes.length&&<div className="ws-empty-compact">Todavía no hay cotizaciones. Completa el formulario para crear la primera.</div>}
      {data&&tab==='receipts'&&!data.receipts.length&&<div className="ws-empty-compact">Sin comprobantes. Factura primero un pedido reservado.</div>}
      {data&&tab==='guides'&&!data.guides.length&&<div className="ws-empty-compact">Sin guías emitidas. Selecciona un pedido facturado debajo para registrar el despacho.</div>}
      {data&&tab==='credits'&&!data.credits.length&&<div className="ws-empty-compact">Sin notas de crédito. Selecciona un pedido despachado debajo para acreditar o devolver productos.</div>}
    </section>
    {tab==='guides'&&data&&<section className="ws-card ws-sales-pending"><h2>Pedidos facturados pendientes de despacho</h2><p>Emitir la guía consume la reserva y genera la salida física oficial del almacén en Kardex.</p><div className="ws-sales-action-list">{data.orders.filter(order=>order.estado==='facturado').map(order=><div key={order.id}><span><strong>{order.codigo}</strong><small>{customerName(order.cliente_id)} · {data.warehouses.find(w=>w.id===order.almacen_id)?.nombre??'Almacén'} · {order.lineas.length} producto(s)</small></span><button type="button" className="ws-button" disabled={!can('sales','editar')||!(can('inventory','crear')||can('inventory','editar'))} onClick={()=>begin({kind:'guide',order})}>Emitir guía</button></div>)}{!data.orders.some(order=>order.estado==='facturado')&&<div className="ws-empty-compact">No hay pedidos facturados pendientes de guía.</div>}</div></section>}
    {tab==='credits'&&data&&<section className="ws-card ws-sales-pending"><h2>Pedidos disponibles para nota de crédito</h2><p>Solo se admiten pedidos ya despachados y cantidades no acreditadas. La base comprueba también el saldo no cobrado.</p><div className="ws-sales-action-list">{data.orders.filter(order=>order.estado==='despachado'&&order.lineas.some(line=>remaining(order,line.producto_id)>0)).map(order=><div key={order.id}><span><strong>{order.codigo}</strong><small>{customerName(order.cliente_id)} · {order.lineas.map(line=>`${productName(line.producto_id)}: ${remaining(order,line.producto_id)} máx.`).join(' · ')}</small></span><button type="button" className="ws-button" disabled={!can('sales','editar')||!can('finance','editar')} onClick={()=>begin({kind:'credit',order})}>Registrar nota</button></div>)}{!data.orders.some(order=>order.estado==='despachado'&&order.lineas.some(line=>remaining(order,line.producto_id)>0))&&<div className="ws-empty-compact">No hay cantidades pendientes de acreditar.</div>}</div></section>}
    {action&&<div className="modal-backdrop" role="presentation"><form className="voucher-modal ws-sales-dialog" role="dialog" aria-modal="true" aria-label="Operación de venta" onSubmit={submitAction}><div className="modal-heading"><h2>{action.kind==='convert'?'Convertir cotización':action.kind==='invoice'?'Facturar pedido':action.kind==='guide'?'Emitir guía':action.kind==='cancel'?'Anular pedido':'Nota de crédito / devolución'}</h2></div>
      {action.kind==='cancel'&&<p>Se liberará la reserva. No se emitió comprobante ni se creó cuenta por cobrar.</p>}
      {action.kind==='convert'&&<><label>Almacén de reserva<select required value={warehouse} onChange={event=>setWarehouse(event.target.value)}><option value="">Selecciona</option>{data?.warehouses.map(w=><option value={w.id} key={w.id}>{w.nombre}</option>)}</select></label><label className="ws-sales-check"><input type="checkbox" checked={convertToSale} onChange={event=>setConvertToSale(event.target.checked)}/> Facturar ahora (desactiva para crear solo el pedido)</label></>}
      {(action.kind==='invoice'||(action.kind==='convert'&&convertToSale))&&<div className="ws-form-grid"><label>Comprobante<select value={docType} onChange={event=>{const value=event.target.value as '01'|'03';setDocType(value);setSeries(value==='01'?'F001':'B001')}}><option value="03">Boleta</option><option value="01">Factura (RUC obligatorio)</option></select></label><label>Serie<input required pattern="[A-Z0-9]{4}" value={series} onChange={event=>setSeries(event.target.value.toUpperCase())}/></label><label>Número<input required min="1" type="number" value={number} onChange={event=>setNumber(event.target.value)}/></label></div>}
      {action.kind==='guide'&&<><p>Pedido {action.order?.codigo} · almacén {data?.warehouses.find(w=>w.id===action.order?.almacen_id)?.nombre??'seleccionado'}. La guía despachará {action.order?.lineas.reduce((total,line)=>total+line.cantidad,0)} unidades y registrará Kardex una sola vez.</p><div className="ws-form-grid"><label>Dirección de origen<input required minLength={4} value={origin} onChange={event=>setOrigin(event.target.value)} placeholder="Almacén, dirección o punto de partida"/></label><label>Dirección de destino<input required minLength={4} value={destination} onChange={event=>setDestination(event.target.value)} placeholder="Dirección de entrega"/></label></div></>}
      {action.kind==='credit'&&action.order&&<><p>Pedido {action.order.codigo} · {customerName(action.order.cliente_id)}. Elige cuánto acreditar por producto.</p><label>Motivo de anulación o corrección<input required minLength={5} value={reason} onChange={event=>setReason(event.target.value)} placeholder="Explica el motivo de la nota"/></label><label className="ws-sales-check"><input type="checkbox" checked={returnStock} onChange={event=>setReturnStock(event.target.checked)}/> Devolver físicamente los productos al almacén (entrada en Kardex)</label><div className="ws-notice ws-notice-warning" role="note">Si solo corriges el importe, deja desmarcado el retorno. Si recibes mercadería de vuelta, márcalo ahora: una línea acreditada no puede volver a acreditarse después para devolver stock.</div><p>Saldo CxC no cobrado: {!can('finance','ver')?'No disponible sin permiso de consulta de Finanzas':creditBalance===null?creditBalanceError?'No disponible':'Consultando…':amount(creditBalance,action.order.moneda)}. No se puede acreditar dinero ya cobrado sin un reembolso previo.</p>{creditBalanceError&&<small className="ws-sales-over-limit">{creditBalanceError} · La RPC validará el saldo de todos modos.</small>}{lines.map((line,i)=>{const max=remaining(action.order!,line.producto_id);return <label className="ws-sales-credit-line" key={line.producto_id}><span>{productName(line.producto_id)}<small>Vendido: {action.order?.lineas[i].cantidad} · ya acreditado: {(action.order?.lineas[i].cantidad??0)-max} · máximo visible: {max}</small></span><input aria-label={`Cantidad a acreditar de ${productName(line.producto_id)}`} type="number" min="0" max={max} step="1" value={line.cantidad} disabled={!max} onChange={event=>updateLine(i,{cantidad:Number(event.target.value)})}/></label>})}<p>Total estimado de la nota: {amount(lines.reduce((sum,line)=>sum+line.cantidad*line.precio,0),action.order.moneda)} · el servidor calcula el importe exacto y los topes definitivos.</p></>}
      {error&&<div className="ws-notice ws-notice-warning ws-sales-warning" role="alert">{error}</div>}
      <div className="modal-actions"><button type="button" className="ws-button ws-button-secondary" onClick={()=>setAction(null)}>Cancelar</button><button className="ws-button" disabled={busy || creditInvalid} type="submit">{busy?'Procesando…':'Confirmar'}</button></div></form></div>}
    {printReceipt&&<SalesReceiptPrint receipt={printReceipt} company={company} products={data?.products??[]} onClose={()=>setPrintReceipt(null)}/>}
  </div>
}
