import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { ArrowLeft, Ban, Check, ChevronDown, ChevronLeft, ChevronRight, ClipboardList, PackageCheck, Pencil, Plus, RefreshCw, Search, Send, Trophy } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useRecords } from '../context/RecordsContext'
import { moneyCurrency } from '../data/helpers'
import {
  cancelPurchaseRequest, convertSelectedRequest, fetchPurchaseSourcing, fetchPurchaseSourcingDetail,
  fetchPurchaseSuppliers, fetchSourcingCurrencies, openPurchaseRequest, registerPurchaseOffer,
  selectPurchaseOffer, type SourcingCurrency, type SourcingOffer as Offer,
  type SourcingRequest as Request, type SupplierOption,
} from '../services/purchaseSourcing'
import useDebouncedValue from '../hooks/useDebouncedValue'
import SourcingRequestComposer from './SourcingRequestComposer'
import ConfirmModal from './ConfirmModal'
import SupplierEvaluationRating from './SupplierEvaluationRating'

const PAGE_SIZE = 20
const SUPPLIER_PAGE_SIZE = 10
const newIdempotencyKey = () => globalThis.crypto?.randomUUID?.() ?? `src-${Date.now()}-${Math.random().toString(36).slice(2)}`
type PendingAction = { type: 'select'; request: Request; offer: Offer } | { type: 'cancel'; request: Request }

function readableError(error: unknown) {
  const message = (error as { message?: string } | null)?.message ?? 'No se pudo completar la operación.'
  if (message.includes('does not exist') || message.includes('Could not find the function')) return 'Falta ejecutar la migración local D107–D114 de abastecimiento.'
  return message
}

function penny(value: number) { return Math.round((value + Number.EPSILON) * 100) / 100 }

function compareOffer(request: Request, offer: Offer) {
  const lines = request.solicitud_compra_lineas
  const prices = offer.detalle_ofertas_compra
  if (!lines.length || prices.length !== lines.length || lines.some(line => !prices.some(price => price.solicitud_linea_id === line.id))) return null
  let total = 0
  for (const line of lines) {
    const quote = prices.find(price => price.solicitud_linea_id === line.id)
    if (!quote || !Number.isFinite(Number(quote.precio_unitario)) || Number(quote.precio_unitario) < 0) return null
    const qty = Math.ceil(Number(line.cantidad))
    const base = penny(qty * penny(Number(quote.precio_unitario)))
    const taxRate = Number(quote.tasa_tributaria)
    if (!Number.isFinite(taxRate) || ![0, 18].includes(taxRate)) return null
    const tax = penny(base * taxRate / 100)
    total += base + tax
  }
  const totalPen = penny(total * (offer.moneda === 'PEN' ? 1 : Number(offer.exchange_rate)))
  return Number.isFinite(totalPen) && totalPen > 0 ? totalPen : null
}

export default function PurchaseSourcingPage() {
  const { can } = useAuth()
  const { records, notify } = useRecords()
  const navigate = useNavigate()
  const canCreatePurchase = can('purchases', 'crear')
  const [items, setItems] = useState<Request[]>([])
  const [details, setDetails] = useState<Record<string, Request>>({})
  const [loadingDetails, setLoadingDetails] = useState<Record<string, boolean>>({})
  const [detailErrors, setDetailErrors] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [stateFilter, setStateFilter] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [reference, setReference] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingRequest, setEditingRequest] = useState<Request | null>(null)
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const [actionReason, setActionReason] = useState('')
  const [supplierSearch, setSupplierSearch] = useState('')
  const [supplierOffset, setSupplierOffset] = useState(0)
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([])
  const [supplierTotal, setSupplierTotal] = useState(0)
  const [supplierId, setSupplierId] = useState('')
  const [supplierLoading, setSupplierLoading] = useState(false)
  const [currencies, setCurrencies] = useState<SourcingCurrency[]>([])
  const [currency, setCurrency] = useState<'PEN' | 'USD'>('PEN')
  const [exchangeRate, setExchangeRate] = useState('1')
  const [currencyError, setCurrencyError] = useState('')
  const transitionKeys = useRef(new Map<string, string>())
  const offerKeys = useRef(new Map<string, string>())
  const offerFingerprints = useRef(new Map<string, string>())
  const loadRevision = useRef(0)
  const debouncedReference = useDebouncedValue(reference, 300)
  const debouncedSupplierSearch = useDebouncedValue(supplierSearch, 300)

  const load = useCallback(async () => {
    const revision = ++loadRevision.current
    setLoading(true)
    setError('')
    try {
      const result = await fetchPurchaseSourcing({ estado: stateFilter, desde: fromDate, hasta: toDate, referencia: debouncedReference, limit: PAGE_SIZE, offset: page * PAGE_SIZE })
      if (revision !== loadRevision.current) return
      setItems(result.requests)
      setTotal(result.total)
      setDetails(current => Object.fromEntries(Object.entries(current).filter(([id]) => result.requests.some(request => request.id === id))))
    } catch (cause) { if (revision === loadRevision.current) setError(readableError(cause)) }
    finally { if (revision === loadRevision.current) setLoading(false) }
  }, [stateFilter, fromDate, toDate, debouncedReference, page])

  useEffect(() => { void load(); return () => { loadRevision.current++ } }, [load])

  useEffect(() => {
    if (!canCreatePurchase) { setSuppliers([]); setSupplierTotal(0); return }
    let active = true
    setSupplierLoading(true)
    fetchPurchaseSuppliers({ search: debouncedSupplierSearch, limit: SUPPLIER_PAGE_SIZE, offset: supplierOffset })
      .then(result => { if (active) { setSuppliers(result.items); setSupplierTotal(result.total) } })
      .catch(cause => { if (active) notify(readableError(cause)) })
      .finally(() => { if (active) setSupplierLoading(false) })
    return () => { active = false }
  }, [debouncedSupplierSearch, supplierOffset, notify, canCreatePurchase])

  useEffect(() => {
    if (!canCreatePurchase) { setCurrencies([]); return }
    let active = true
    fetchSourcingCurrencies().then(result => { if (active) { setCurrencies(result); setCurrencyError('') } })
      .catch(cause => { if (active) setCurrencyError(readableError(cause)) })
    return () => { active = false }
  }, [canCreatePurchase])

  const openDetail = async (requestId: string, force = false) => {
    if ((!force && details[requestId]) || loadingDetails[requestId]) return
    setLoadingDetails(current => ({ ...current, [requestId]: true }))
    setDetailErrors(current => ({ ...current, [requestId]: '' }))
    try {
      const detail = await fetchPurchaseSourcingDetail(requestId)
      setDetails(current => ({ ...current, [requestId]: detail }))
    } catch (cause) { setDetailErrors(current => ({ ...current, [requestId]: readableError(cause) })) }
    finally { setLoadingDetails(current => ({ ...current, [requestId]: false })) }
  }

  const toggleRequest = (requestId: string) => {
    const next = expanded === requestId ? null : requestId
    setExpanded(next)
    if (next) void openDetail(next)
  }

  const invalidateDetail = (requestId: string) => setDetails(current => {
    const next = { ...current }
    delete next[requestId]
    return next
  })

  const ranked = (request: Request) => request.ofertas_compra
    .filter(offer => offer.estado === 'Vigente' && offer.es_version_actual && (!offer.vigencia_hasta || offer.vigencia_hasta >= new Date().toISOString().slice(0, 10)))
    .map(offer => ({ offer, total: compareOffer(request, offer) }))
    .filter((entry): entry is { offer: Offer; total: number } => entry.total !== null)
    .sort((a, b) => a.total - b.total)

  const reasonMinimumFor = (action: PendingAction) => {
    if (action.type === 'cancel') return 5
    const rankedOffers = ranked(action.request)
    const selectedTotal = rankedOffers.find(entry => entry.offer.id === action.offer.id)?.total
    const lowestTotal = rankedOffers[0]?.total
    return selectedTotal != null && lowestTotal != null && selectedTotal === lowestTotal ? 4 : 12
  }
  const reasonMinimum = pendingAction ? reasonMinimumFor(pendingAction) : 5

  const closeRequestForm = () => { setShowForm(false); setEditingRequest(null) }

  const openRequest = async (request: Request) => {
    setBusy(true)
    try {
      const keyId = `open:${request.id}`
      const key = transitionKeys.current.get(keyId) ?? newIdempotencyKey()
      transitionKeys.current.set(keyId, key)
      await openPurchaseRequest(request.id, key)
      transitionKeys.current.delete(keyId)
      invalidateDetail(request.id)
      await load(); await openDetail(request.id, true); notify('Solicitud abierta para recibir ofertas.')
    } catch (cause) { notify(readableError(cause)) }
    finally { setBusy(false) }
  }

  const saveOffer = async (event: FormEvent<HTMLFormElement>, request: Request) => {
    event.preventDefault()
    if (busy) return
    const form = new FormData(event.currentTarget)
    if (!supplierId) return notify('Busca y selecciona un proveedor activo.')
    const rate = currency === 'PEN' ? 1 : Number(exchangeRate)
    if (!Number.isFinite(rate) || rate <= 0 || (currency === 'USD' && !exchangeRate.trim())) return notify('Registra el tipo de cambio manual en PEN por unidad de moneda.')
    const prices = request.solicitud_compra_lineas.map(line => {
      const treatment = String(form.get(`tratamiento_${line.id}`) || 'Gravado') as 'Gravado' | 'Exonerado' | 'Inafecto'
      return { linea_id: line.id, precio_unitario: Number(form.get(`precio_${line.id}`)), tratamiento_tributario: treatment,
        tasa_tributaria: treatment === 'Gravado' ? 18 : 0 }
    })
    if (prices.some(line => {
      const raw = String(form.get(`precio_${line.linea_id}`) ?? '').trim()
      const decimals = raw.split('.')[1]?.length ?? 0
      return !Number.isFinite(line.precio_unitario) || line.precio_unitario < 0 || line.precio_unitario > 9999999999.9999 || decimals > 4
    })) return notify('Revisa los precios: finitos, no negativos y hasta 4 decimales.')
    setBusy(true)
    try {
      const offerPayload = { request: request.id, supplier: supplierId, currency, rate,
        expiry: String(form.get('vigencia_hasta') ?? '') || null,
        lead: String(form.get('plazo_entrega_dias') ?? '') ? Number(form.get('plazo_entrega_dias')) : null,
        terms: String(form.get('condiciones') ?? '').trim(), prices }
      const fingerprint = JSON.stringify(offerPayload)
      if (offerFingerprints.current.get(request.id) !== fingerprint) {
        offerKeys.current.set(request.id, newIdempotencyKey())
        offerFingerprints.current.set(request.id, fingerprint)
      }
      const idempotencyKey = offerKeys.current.get(request.id) ?? newIdempotencyKey()
      await registerPurchaseOffer({ solicitudId: request.id, proveedorId: supplierId, vigenciaHasta: offerPayload.expiry,
        plazoEntregaDias: offerPayload.lead, condiciones: offerPayload.terms, precios: prices,
        moneda: currency, exchangeRate: rate, idempotencyKey })
      offerKeys.current.delete(request.id); offerFingerprints.current.delete(request.id)
      invalidateDetail(request.id)
      await load(); await openDetail(request.id, true); notify('Oferta registrada; queda versionada y comparada en PEN con impuestos.')
    } catch (cause) { notify(readableError(cause)) }
    finally { setBusy(false) }
  }

  const chooseOffer = (request: Request, offer: Offer) => { setActionReason(''); setPendingAction({ type: 'select', request, offer }) }

  const confirmAction = async () => {
    if (!pendingAction || busy) return
    const minimum = reasonMinimumFor(pendingAction)
    if (actionReason.trim().length < minimum) { notify(`El motivo requiere al menos ${minimum} caracteres${minimum >= 12 ? ' porque la oferta no es la de menor total' : ''}.`); return }
    setBusy(true)
    try {
      const request = pendingAction.request
      const keyId = pendingAction.type === 'select' ? `select:${request.id}:${pendingAction.offer.id}:${actionReason.trim()}` : `cancel:${request.id}:${actionReason.trim()}`
      const key = transitionKeys.current.get(keyId) ?? newIdempotencyKey()
      transitionKeys.current.set(keyId, key)
      if (pendingAction.type === 'select') await selectPurchaseOffer(request.id, pendingAction.offer.id, actionReason.trim(), key)
      else await cancelPurchaseRequest(request.id, actionReason.trim(), key)
      transitionKeys.current.delete(keyId)
      setDetails(current => { const next = { ...current }; delete next[request.id]; return next })
      await load(); await openDetail(request.id, true); notify(pendingAction.type === 'select' ? 'Oferta seleccionada; ya puedes convertirla en una orden.' : `Solicitud ${request.codigo} cancelada.`)
      setPendingAction(null); setActionReason('')
    } catch (cause) { notify(readableError(cause)) }
    finally { setBusy(false) }
  }

  const createOrder = async (request: Request) => {
    if (busy) return
    setBusy(true)
    try {
      const keyId = `convert:${request.id}`
      const key = transitionKeys.current.get(keyId) ?? newIdempotencyKey()
      transitionKeys.current.set(keyId, key)
      const orderId = await convertSelectedRequest(request.id, key)
      transitionKeys.current.delete(keyId)
      setDetails(current => { const next = { ...current }; delete next[request.id]; return next })
      await load(); await openDetail(request.id, true)
      notify(`Orden ${orderId} creada con vínculos de trazabilidad a solicitud y oferta.`)
    } catch (cause) { notify(readableError(cause)) }
    finally { setBusy(false) }
  }

  const supplierPageCount = Math.max(1, Math.ceil(supplierTotal / SUPPLIER_PAGE_SIZE))
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const canRead = can('purchases', 'ver')
  const activeCurrencies = useMemo(() => currencies.filter(item => item.codigo === 'PEN' || item.codigo === 'USD'), [currencies])
  if (!canRead) return <section className="ws-card"><div className="ws-empty-compact"><strong>Sin permiso para consultar solicitudes</strong></div></section>

  return <>
    <section className="ws-page-heading"><div><span className="ws-eyebrow">COMPRAS · ABASTECIMIENTO</span><h1>Solicitudes y comparativo</h1><p>Compara cotizaciones completas con impuestos en PEN y convierte la oferta ganadora en una orden trazable.</p></div><div className="ws-heading-actions"><button className="ws-button ws-button-secondary" onClick={() => void load()} disabled={loading}><RefreshCw size={16} />Actualizar</button><button className="ws-button" onClick={() => { setEditingRequest(null); setShowForm(value => !value) }} disabled={!can('purchases', 'crear')}><Plus size={16} />Nueva solicitud</button></div></section>
    <div className="ws-notice ws-notice-info" role="note"><ClipboardList size={17} /><span>Adjudicación total: una oferta seleccionada puede generar exactamente una orden. La conversión no genera CxP ni recepción; conserva la moneda, los impuestos y los vínculos origen.</span></div>
    <section className="ws-card sourcing-filters"><div className="ws-activity-toolbar"><label className="ws-table-search"><Search size={16} /><input value={reference} onChange={event => { setReference(event.target.value); setPage(0) }} placeholder="Referencia, detalle o proveedor…" aria-label="Buscar solicitudes" /></label><label>Estado<select className="ws-control" value={stateFilter} onChange={event => { setStateFilter(event.target.value); setPage(0) }}><option value="">Todos</option><option>Borrador</option><option>Abierta</option><option>Cerrada</option><option>Cancelada</option></select></label><label>Necesidad desde<input className="ws-control" type="date" value={fromDate} onChange={event => { setFromDate(event.target.value); setPage(0) }} /></label><label>Hasta<input className="ws-control" type="date" value={toDate} onChange={event => { setToDate(event.target.value); setPage(0) }} /></label></div></section>
    {error && <div className="ws-notice ws-notice-warning" role="alert">{error}</div>}
    {(showForm || editingRequest) && <SourcingRequestComposer key={editingRequest?.id ?? 'new-request'} request={editingRequest} products={records.inventory} notify={notify} onClose={closeRequestForm} onSaved={async () => { closeRequestForm(); await load() }} />}
    {loading ? <section className="ws-card"><div className="ws-empty-compact"><RefreshCw size={22} className="ws-spin" /><strong>Cargando solicitudes…</strong></div></section> : items.length ? <div className="sourcing-list">{items.map(summary => {
      const request = details[summary.id] ?? summary
      const hasDetail = Boolean(details[summary.id])
      const offers = hasDetail ? ranked(request) : []
      const selected = hasDetail ? request.ofertas_compra.find(offer => offer.id === request.seleccion_oferta_id) : undefined
      const hasOrder = Boolean(request.orden_compra_id)
      return <section className="ws-card sourcing-card" key={request.id}>
        <button className="sourcing-card-head" type="button" aria-expanded={expanded === request.id} onClick={() => toggleRequest(request.id)}><span><strong>{request.codigo} · {request.detalle || 'Solicitud interna'}</strong><small>{request.line_count ?? request.solicitud_compra_lineas.length} líneas · Necesidad: {request.fecha_necesidad || 'Sin fecha'} · {request.offer_count ?? request.ofertas_compra.length} ofertas</small></span><span className={`status-pill ${request.estado === 'Abierta' ? 'amber' : request.estado === 'Cerrada' ? 'green' : ''}`}>{request.estado}<ChevronDown size={15} /></span></button>
        {expanded === request.id && <div className="sourcing-card-body">{loadingDetails[request.id] && !hasDetail ? <div className="ws-empty-compact"><RefreshCw size={20} className="ws-spin" /><strong>Cargando líneas y ofertas…</strong></div> : detailErrors[request.id] && !hasDetail ? <div className="ws-notice ws-notice-warning" role="alert">{detailErrors[request.id]} <button className="ws-text-button" onClick={() => void openDetail(request.id)}>Reintentar</button></div> : hasDetail && <>
          <div className="table-scroll"><table className="record-table"><thead><tr><th>Artículo</th><th>Cantidad solicitada</th><th>Unidad</th><th>Producto</th></tr></thead><tbody>{request.solicitud_compra_lineas.map(line => <tr key={line.id}><td>{line.descripcion}</td><td>{line.cantidad}{Number(line.cantidad) % 1 ? ` · orden ceil ${Math.ceil(Number(line.cantidad))}` : ''}</td><td>{line.unidad}</td><td>{line.producto_id || 'Sin producto maestro'}</td></tr>)}</tbody></table></div>
           {offers.length > 0 ? <div className="table-scroll sourcing-comparison"><table className="record-table"><thead><tr><th>Proveedor / moneda</th>{request.solicitud_compra_lineas.map(line => <th key={line.id}>{line.descripcion}<small>Precio antes de impuesto</small></th>)}<th>Total con impuestos (PEN)</th><th>Entrega</th><th>Vigencia</th>{request.estado === 'Abierta' && can('purchases', 'editar') && <th>Acción</th>}</tr></thead><tbody>{offers.map(({ offer, total: totalPen }, index) => <tr key={offer.id}><td><strong>{offer.proveedores?.razon_social ?? offer.codigo}</strong><small>{offer.moneda}{offer.moneda !== 'PEN' ? ` · FX ${offer.exchange_rate} PEN/${offer.moneda}` : ''}</small><SupplierEvaluationRating proveedorId={offer.proveedor_id} compact/>{index === 0 && <small className="sourcing-lowest"><Trophy size={13} />Menor total</small>}</td>{request.solicitud_compra_lineas.map(line => { const quote = offer.detalle_ofertas_compra.find(price => price.solicitud_linea_id === line.id); return <td key={line.id}>{quote ? <>{moneyCurrency(Number(quote.precio_unitario), offer.moneda)}<small>{quote.tratamiento_tributario} · {quote.tasa_tributaria}%</small></> : 'Incompleta'}</td>})}<td><strong>{moneyCurrency(totalPen, 'PEN')}</strong></td><td>{offer.plazo_entrega_dias == null ? '—' : `${offer.plazo_entrega_dias} días`}</td><td>{offer.vigencia_hasta || 'Sin fecha'}</td>{request.estado === 'Abierta' && can('purchases', 'editar') && <td><button className="ws-text-button" disabled={busy} onClick={() => chooseOffer(request, offer)}><Check size={15} />Seleccionar</button></td>}</tr>)}</tbody></table></div> : request.estado === 'Abierta' && request.ofertas_compra.some(offer => offer.es_version_actual && offer.estado === 'Vigente') ? <div className="ws-notice ws-notice-warning">Las ofertas vigentes están incompletas, vencidas o suman cero; no pueden ganar por defecto.</div> : null}
          {selected && <div className="ws-notice ws-notice-info"><Check size={16} /><span>Seleccionada: {selected.proveedores?.razon_social ?? selected.codigo}. Motivo: {request.seleccion_motivo || '—'}.</span></div>}
          {request.estado === 'Cancelada' && <div className="ws-notice ws-notice-warning"><Ban size={16} /><span>Cancelada por motivo: {request.cancelacion_motivo || '—'}</span></div>}
          {hasOrder && <div className="ws-notice ws-notice-info"><PackageCheck size={16} /><span>Orden creada: <strong>{request.orden_codigo ?? request.orden_compra_id}</strong>. <button className="ws-inline-button" onClick={() => navigate(`/purchases?q=${encodeURIComponent(request.orden_codigo ?? request.orden_compra_id ?? '')}`)}>Abrir órdenes nacionales</button></span></div>}
          {request.estado === 'Borrador' && can('purchases', 'editar') && <div className="ws-heading-actions"><button className="ws-button ws-button-secondary" disabled={busy || request.ofertas_compra.length > 0} onClick={() => { setEditingRequest(request); setShowForm(false) }}><Pencil size={15}/>Editar borrador · v{request.version}</button><button className="ws-button" disabled={busy || !request.solicitud_compra_lineas.length} onClick={() => void openRequest(request)}><Send size={15} />Abrir para cotizar</button><button className="ws-text-button" disabled={busy} onClick={() => { setActionReason(''); setPendingAction({ type: 'cancel', request }) }}><Ban size={15} />Cancelar solicitud</button></div>}
          {request.estado === 'Abierta' && can('purchases', 'editar') && <button className="ws-text-button" disabled={busy} onClick={() => { setActionReason(''); setPendingAction({ type: 'cancel', request }) }}><Ban size={15} />Cancelar solicitud</button>}
          {request.ofertas_compra.length > 0 && <details className="sourcing-history"><summary>Historial de ofertas y versiones ({request.ofertas_compra.length})</summary><div className="table-scroll"><table className="record-table"><thead><tr><th>Proveedor</th><th>Versión</th><th>Estado</th><th>Vigencia</th><th>Moneda / FX</th><th>Condiciones</th></tr></thead><tbody>{[...request.ofertas_compra].sort((a, b) => a.proveedor_id.localeCompare(b.proveedor_id) || a.version - b.version).map(offer => <tr key={offer.id}><td>{offer.proveedores?.razon_social ?? offer.codigo}</td><td>v{offer.version}{offer.es_version_actual ? ' · actual' : ''}</td><td>{offer.estado}</td><td>{offer.vigencia_hasta || 'Sin fecha'}</td><td>{offer.moneda}{offer.moneda !== 'PEN' ? ` · ${offer.exchange_rate}` : ''}</td><td>{offer.condiciones || '—'}</td></tr>)}</tbody></table></div></details>}
          {request.estado === 'Cerrada' && selected && !hasOrder && can('purchases', 'crear') && <div className="sourcing-form-foot"><small>La conversión actual admite órdenes de bienes: cada línea necesita producto maestro y vínculo único al catálogo del proveedor. Cantidades fraccionarias se redondean hacia arriba.</small><button className="ws-button" disabled={busy || request.solicitud_compra_lineas.some(line => !line.producto_id)} onClick={() => void createOrder(request)}><PackageCheck size={16} />{busy ? 'Creando orden…' : 'Crear orden'}</button></div>}
          {request.estado === 'Abierta' && can('purchases', 'crear') && <form className="sourcing-offer-form" onSubmit={event => void saveOffer(event, request)}><h3>Registrar oferta o nueva versión</h3>
            <label className="sourcing-wide">Proveedor activo<select className="ws-control" value={supplierId} required onChange={event => setSupplierId(event.target.value)}><option value="">{supplierLoading ? 'Buscando proveedores…' : 'Seleccionar proveedor paginado'}</option>{suppliers.map(supplier => <option key={supplier.id} value={supplier.id}>{supplier.codigo} · {supplier.razon_social}{request.ofertas_compra.some(offer => offer.proveedor_id === supplier.id) ? ' · siguiente versión' : ''}</option>)}</select></label>
            <div className="sourcing-wide sourcing-supplier-pager"><label className="ws-table-search"><Search size={15} /><input value={supplierSearch} onChange={event => { setSupplierSearch(event.target.value); setSupplierOffset(0); setSupplierId('') }} placeholder="Buscar proveedor activo…" /></label><div className="ws-pagination"><span>{supplierTotal} proveedores autorizados</span><button className="ws-icon-button" type="button" aria-label="Página anterior de proveedores" disabled={supplierOffset===0} onClick={() => { setSupplierOffset(value => Math.max(0,value-SUPPLIER_PAGE_SIZE)); setSupplierId('') }}><ChevronLeft size={14}/></button><span>{Math.floor(supplierOffset/SUPPLIER_PAGE_SIZE)+1} / {supplierPageCount}</span><button className="ws-icon-button" type="button" aria-label="Página siguiente de proveedores" disabled={supplierOffset+SUPPLIER_PAGE_SIZE>=supplierTotal} onClick={() => { setSupplierOffset(value => value+SUPPLIER_PAGE_SIZE); setSupplierId('') }}><ChevronRight size={14}/></button></div></div>
            <label>Moneda<select className="ws-control" value={currency} onChange={event => { const value = event.target.value === 'USD' ? 'USD' : 'PEN'; setCurrency(value); if (value === 'PEN') setExchangeRate('1') }}><option value="PEN" disabled={!activeCurrencies.some(item => item.codigo==='PEN')}>PEN · Sol peruano</option><option value="USD" disabled={!activeCurrencies.some(item => item.codigo==='USD')}>USD · Dólar estadounidense</option></select></label>
            <label>Tipo de cambio (PEN por 1 {currency})<input className="ws-control" type="number" min="0.000001" step="0.000001" value={currency==='PEN'?'1':exchangeRate} disabled={currency==='PEN'} required={currency==='USD'} onChange={event => setExchangeRate(event.target.value)}/></label>
            {request.solicitud_compra_lineas.map(line => <div className="sourcing-line" key={line.id}><label>{line.descripcion} · {line.cantidad} {line.unidad}<span className="sourcing-price-input"><span>{currency}</span><input className="ws-control" name={`precio_${line.id}`} required type="number" min="0" step="0.0001" defaultValue="0" /></span></label><label>Tributación<select className="ws-control" name={`tratamiento_${line.id}`} defaultValue="Gravado"><option value="Gravado">Gravado · 18%</option><option value="Exonerado">Exonerado · 0%</option><option value="Inafecto">Inafecto · 0%</option></select></label></div>)}
            <label>Fecha de vigencia<input className="ws-control" type="date" name="vigencia_hasta" /></label><label>Plazo de entrega (días)<input className="ws-control" type="number" name="plazo_entrega_dias" min="0" step="1" /></label><label className="sourcing-wide">Condiciones<textarea className="ws-control" name="condiciones" rows={2} maxLength={1000} placeholder="Condiciones informadas por el proveedor" /></label>
            {currencyError && <div className="ws-notice ws-notice-warning sourcing-wide" role="alert">{currencyError}</div>}
            <div className="sourcing-wide sourcing-form-foot"><small>La comparación añade los impuestos configurados y normaliza el total a PEN con este tipo de cambio snapshot.</small><button className="ws-button" type="submit" disabled={busy || supplierLoading || !supplierId || !activeCurrencies.some(item => item.codigo===currency)}>{busy ? 'Guardando…' : 'Registrar versión'}</button></div>
          </form>}
        </>}</div>}
      </section>
    })}</div> : !error && <section className="ws-card"><div className="ws-empty-compact"><ClipboardList size={26}/><strong>{total ? 'Sin solicitudes en esta página' : 'No hay solicitudes para estos filtros'}</strong><span>Ajusta los filtros o crea una nueva solicitud.</span></div></section>}
    {!loading && total > 0 && <div className="ws-pagination"><span>Mostrando {page*PAGE_SIZE+1}–{Math.min((page+1)*PAGE_SIZE,total)} de {total}</span><div><button className="ws-icon-button" type="button" aria-label="Página anterior" disabled={page===0} onClick={() => setPage(value => Math.max(0,value-1))}><ChevronLeft size={15}/></button><span>{page+1} / {pageCount}</span><button className="ws-icon-button" type="button" aria-label="Página siguiente" disabled={page+1>=pageCount} onClick={() => setPage(value => Math.min(pageCount-1,value+1))}><ChevronRight size={15}/></button></div></div>}
    <div className="sourcing-back"><button className="ws-text-button" onClick={() => navigate('/purchases')}><ArrowLeft size={15}/>Volver a Órdenes nacionales</button></div>
    {pendingAction && <ConfirmModal
      title={pendingAction.type === 'select' ? 'Seleccionar oferta' : 'Cancelar solicitud'}
      message={pendingAction.type === 'select'
        ? `La oferta se comparó con impuestos y en PEN. El motivo quedará persistido y debe tener al menos ${reasonMinimum} caracteres${reasonMinimum >= 12 ? ' porque no es la oferta de menor total' : ''}.`
        : `La solicitud ${pendingAction.request.codigo} se cancelará; las solicitudes seleccionadas o convertidas no se pueden cancelar.`}
      confirmLabel={pendingAction.type === 'select' ? 'Seleccionar oferta' : 'Cancelar solicitud'}
      tone={pendingAction.type === 'select' ? 'primary' : 'danger'}
      busy={busy}
      onCancel={() => { if (!busy) { setPendingAction(null); setActionReason('') } }}
      onConfirm={confirmAction}
    >
      <label className="sourcing-wide">Motivo
        <textarea className="ws-control" rows={4} maxLength={500} minLength={reasonMinimum} value={actionReason} onChange={event => setActionReason(event.target.value)} placeholder="Motivo" required />
        <small className="ws-muted">Mínimo {reasonMinimum} caracteres{reasonMinimum >= 12 ? ' · la oferta no es la de menor total' : ''}.</small>
      </label>
    </ConfirmModal>}
  </>
}
