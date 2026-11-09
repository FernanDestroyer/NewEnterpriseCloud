import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useRecords } from '../context/RecordsContext'
import { businessDate, shiftDate } from '../data/workspace'
import { cancelSalesOrder, collectSalesOrder, createSalesOrder, creditSalesOrder, fetchSalesCreditBalance, guideSalesOrder, invoiceSalesOrder, loadSalesOperations, saveSalesQuote, convertSalesQuote, type SaleLine, type SalesOrder, type SalesQuote, type SalesReceipt } from '../services/salesOperations'
import { SalesReceiptPrint } from './SalesReceiptPrint'
import PaymentCollectionFields from './PaymentCollectionFields'
import { SearchablePicker, type PickerOption } from './SearchablePicker'
import { SegmentedControl } from './ui/SegmentedControl'
import { PageHeader } from './ui/PageHeader'
import { ClipboardList, ReceiptText, Truck, RotateCcw, FileCheck2, RefreshCw, ShoppingBag, ArrowUpRight } from 'lucide-react'
import '../sales-operations.css'

type Data = Awaited<ReturnType<typeof loadSalesOperations>>
type Action = { kind: 'invoice' | 'guide' | 'credit' | 'convert' | 'cancel' | 'collect'; order?: SalesOrder; quote?: SalesQuote }
type Tab = 'orders' | 'quotes' | 'receipts' | 'guides' | 'credits' | 'sunat'
const paths: Record<Tab, string> = { orders: '/sales', quotes: '/quotes', receipts: '/sales/receipts', guides: '/sales/guides', credits: '/sales/credits', sunat: '/sales/sunat' }
const tabMeta = {
  orders: { label: 'Pedidos y ventas', icon: ShoppingBag }, quotes: { label: 'Cotizaciones', icon: ClipboardList },
  receipts: { label: 'Comprobantes', icon: ReceiptText }, guides: { label: 'Guías de remisión', icon: Truck },
  credits: { label: 'Notas de crédito', icon: RotateCcw }, sunat: { label: 'Emisión SUNAT', icon: FileCheck2 },
}
const key = () => crypto.randomUUID()
const initialLine = (): SaleLine => ({ producto_id: '', cantidad: 1, precio: 0, afectacion: '10' })
const errorText = (error: unknown) => error instanceof Error ? error.message : 'No se pudo completar la operación.'
const amount = (value: number, currency = 'PEN') => new Intl.NumberFormat('es-PE', { style: 'currency', currency }).format(value)

export default function SalesOperationsPage({ initialTab = 'orders' }: { initialTab?: Tab }) {
  const { can } = useAuth()
  const { records, company, reload: reloadWorkspace } = useRecords()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>(initialTab)
  const [orderFilter, setOrderFilter] = useState('all')
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [busy, setBusy] = useState(false)
  const [action, setAction] = useState<Action | null>(null)
  const [editing, setEditing] = useState<SalesQuote | null>(null)
  const [customer, setCustomer] = useState('')
  const [warehouse, setWarehouse] = useState('')
  const [currency, setCurrency] = useState<'PEN' | 'USD'>('PEN')
  const [expiry, setExpiry] = useState(() => shiftDate(businessDate(new Date()), 14))
  const [lines, setLines] = useState<SaleLine[]>([initialLine()])
  const [historyId, setHistoryId] = useState<string | null>(null)
  const [docType, setDocType] = useState<'01' | '03'>('03')
  const [convertToSale, setConvertToSale] = useState(true)
  const [series, setSeries] = useState('B001')
  const [number, setNumber] = useState('1')
  const [saleNow, setSaleNow] = useState(false)
  const [saleDocType, setSaleDocType] = useState<'01' | '03'>('03')
  const [saleSeries, setSaleSeries] = useState('B001')
  const [saleNumber, setSaleNumber] = useState('1')
  const [salePayMethod, setSalePayMethod] = useState('Efectivo')
  const [salePayShift, setSalePayShift] = useState('')
  const [invoicePayMethod, setInvoicePayMethod] = useState('')
  const [invoicePayShift, setInvoicePayShift] = useState('')
  const [collectPayMethod, setCollectPayMethod] = useState('')
  const [collectPayShift, setCollectPayShift] = useState('')
  const [collectPending, setCollectPending] = useState<number | null>(null)
  const [collectPendingError, setCollectPendingError] = useState('')
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
  useEffect(() => {
    if (action?.kind !== 'collect' || !action.order?.venta_id) return
    let active = true
    setCollectPending(null)
    setCollectPendingError('')
    void fetchSalesCreditBalance(action.order.venta_id)
      .then(value => { if (active) setCollectPending(value) })
      .catch(cause => { if (active) setCollectPendingError(errorText(cause)) })
    return () => { active = false }
  }, [action])
  const exchangeRate = data?.exchangeRate ?? 0
  const exchangeReady = exchangeRate > 0
  /** Siguiente correlativo visible para la venta directa, según los comprobantes ya emitidos. */
  const nextSaleNumber = (tipo: '01' | '03', serie: string) => {
    const last = (data?.receipts ?? []).filter(item => item.tipo === tipo && item.serie === serie).reduce((max, item) => Math.max(max, item.numero), 0)
    return String(last + 1)
  }
  const roundMoney = (value: number) => Math.round(value * 100) / 100
  /** Los precios del catálogo están en PEN; al vender en USD se convierten con el TC de Maestros. */
  const toCurrency = (penPrice: number) => currency === 'PEN' || !exchangeReady ? roundMoney(penPrice) : roundMoney(penPrice / exchangeRate)
  const changeCurrency = (next: 'PEN' | 'USD') => {
    if (next === currency || (next === 'USD' && !exchangeReady)) return
    const factor = next === 'USD' ? 1 / exchangeRate : currency === 'USD' && exchangeReady ? exchangeRate : 1
    setLines(previous => previous.map(line => ({ ...line, precio: roundMoney(line.precio * factor) })))
    setCurrency(next)
    setRequestKey(key())
  }
  const updateLine = (index: number, changes: Partial<SaleLine>) => setLines(previous => previous.map((line, i) => i === index ? { ...line, ...changes } : line))
  const applyCustomerDocDefault = (customerId: string) => {
    const target = data?.customers.find(item => item.id === customerId)
    if (!target) return
    const tipo: '01' | '03' = target.tipo_doc === 'RUC' && (target.documento ?? '').length === 11 ? '01' : '03'
    const serie = tipo === '01' ? 'F001' : 'B001'
    setSaleDocType(tipo); setSaleSeries(serie); setSaleNumber(nextSaleNumber(tipo, serie))
  }
  const changeCustomer = (customerId: string) => {
    setCustomer(customerId)
    if (saleNow) applyCustomerDocDefault(customerId)
  }
  const startDirectSale = () => {
    setSaleNow(true)
    if (customer) applyCustomerDocDefault(customer)
    else setSaleNumber(nextSaleNumber(saleDocType, saleSeries))
  }
  const begin = (next: Action) => {
    setAction(next); setRequestKey(key()); setError(''); setSuccess(''); setConvertToSale(false)
    setCreditBalance(null); setCreditBalanceError('')
    setInvoicePayMethod(''); setInvoicePayShift('')
    setCollectPayMethod(''); setCollectPayShift(''); setCollectPending(null); setCollectPendingError('')
    if (next.kind === 'invoice' || next.kind === 'convert') {
      const targetId = next.order?.cliente_id ?? next.quote?.cliente_id
      const target = data?.customers.find(item => item.id === targetId)
      const defaultType: '01' | '03' = target?.tipo_doc === 'RUC' && (target.documento ?? '').length === 11 ? '01' : '03'
      const defaultSeries = defaultType === '01' ? 'F001' : 'B001'
      setDocType(defaultType)
      setSeries(defaultSeries)
      setNumber(nextSaleNumber(defaultType, defaultSeries))
    }
    setLines(next.order?.lineas.map(line => ({ ...line, cantidad: 0 })) ?? [initialLine()])
    setReason(''); setReturnStock(false)
  }
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
    if (currency === 'USD' && !exchangeReady) return setError('El tipo de cambio USD no está configurado. Defínelo en Maestros → Catálogos.')
    if (tab === 'quotes' && expiry < businessDate(new Date())) return setError('La fecha de vencimiento no puede estar en el pasado.')
    if (tab === 'quotes') void run(() => saveSalesQuote({ id: editing?.id ?? null, cliente: customer, vence: expiry, moneda: currency, cambio: currency === 'PEN' ? 1 : exchangeRate, lineas: selected, key: requestKey }))
    else if (saleNow) {
      if (!can('finance', 'crear')) return setError('Tu rol no puede registrar cobros. Crea el pedido y factúralo sin cobro.')
      const normalizedSeries = saleSeries.trim().toUpperCase()
      if (!/^[A-Z0-9]{4}$/.test(normalizedSeries)) return setError('La serie debe tener 4 caracteres alfanuméricos.')
      const invoiceNumber = Number(saleNumber)
      if (!Number.isInteger(invoiceNumber) || invoiceNumber <= 0) return setError('El número de comprobante debe ser un entero positivo.')
      if ((data?.receipts ?? []).some(item => item.tipo === saleDocType && item.serie === normalizedSeries && item.numero === invoiceNumber)) {
        return setError(`El comprobante ${normalizedSeries}-${invoiceNumber} ya fue emitido. Correlativo sugerido: ${nextSaleNumber(saleDocType, normalizedSeries)}.`)
      }
      if (saleDocType === '01') {
        const target = data?.customers.find(item => item.id === customer)
        if (!target || target.tipo_doc !== 'RUC' || (target.documento ?? '').length !== 11) return setError('La factura requiere un cliente con RUC de 11 dígitos. Elige boleta o cambia el cliente.')
      }
      const saleCash = salePayMethod.trim().toLocaleLowerCase('es') === 'efectivo'
      if (saleCash && !salePayShift) return setError('Selecciona un turno de caja abierto para cobrar en efectivo.')
      void run(async () => {
        const orderId = await createSalesOrder({ cliente: customer, almacen: warehouse, moneda: currency, cambio: currency === 'PEN' ? 1 : exchangeRate, lineas: selected, key: requestKey })
        try {
          await invoiceSalesOrder(orderId, saleDocType, normalizedSeries, invoiceNumber, `${requestKey}:factura`, salePayMethod ? { method: salePayMethod, cashShiftId: saleCash ? salePayShift : null } : null)
        } catch (cause) {
          setLines([initialLine()])
          setRequestKey(key())
          await reload().catch(() => {})
          void reloadWorkspace()
          throw new Error(`El pedido quedó reservado en la lista inferior, pero no se pudo emitir el comprobante ni registrar el cobro. Usa «Facturar» sobre ese pedido. ${errorText(cause)}`)
        }
        setSaleNumber(String(invoiceNumber + 1))
      })
    } else void run(() => createSalesOrder({ cliente: customer, almacen: warehouse, moneda: currency, cambio: currency === 'PEN' ? 1 : exchangeRate, lineas: selected, key: requestKey }))
  }
  const submitAction = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!action) return
    if (action.kind === 'convert' && action.quote) {
      if (!warehouse) return setError('Selecciona el almacén donde se reservará el stock.')
      const normalizedSeries = series.trim().toUpperCase()
      const invoiceNumber = Number(number)
      if (convertToSale) {
        if (!/^[A-Z0-9]{4}$/.test(normalizedSeries) || !Number.isInteger(invoiceNumber) || invoiceNumber <= 0) return setError('Ingresa una serie de 4 caracteres y un número de comprobante válido.')
        if ((data?.receipts ?? []).some(item => item.tipo === docType && item.serie === normalizedSeries && item.numero === invoiceNumber)) {
          return setError(`El comprobante ${normalizedSeries}-${invoiceNumber} ya fue emitido. Correlativo sugerido: ${nextSaleNumber(docType, normalizedSeries)}.`)
        }
        if (docType === '01') {
          const target = data?.customers.find(item => item.id === action.quote!.cliente_id)
          if (!target || target.tipo_doc !== 'RUC' || (target.documento ?? '').length !== 11) return setError('La factura requiere un cliente con RUC de 11 dígitos.')
        }
      }
      void run(() => convertSalesQuote({ quote: action.quote!.id, almacen: warehouse, tipo: convertToSale ? docType : null, serie: convertToSale ? normalizedSeries : null, numero: convertToSale ? invoiceNumber : null, key: requestKey }))
    }
    if (action.kind === 'invoice' && action.order) {
      const normalizedSeries = series.trim().toUpperCase()
      const invoiceNumber = Number(number)
      if (!/^[A-Z0-9]{4}$/.test(normalizedSeries) || !Number.isInteger(invoiceNumber) || invoiceNumber <= 0) return setError('Ingresa una serie de 4 caracteres y un número de comprobante válido.')
      if ((data?.receipts ?? []).some(item => item.tipo === docType && item.serie === normalizedSeries && item.numero === invoiceNumber)) {
        return setError(`El comprobante ${normalizedSeries}-${invoiceNumber} ya fue emitido. Correlativo sugerido: ${nextSaleNumber(docType, normalizedSeries)}.`)
      }
      if (docType === '01') {
        const target = data?.customers.find(item => item.id === action.order!.cliente_id)
        if (!target || target.tipo_doc !== 'RUC' || (target.documento ?? '').length !== 11) return setError('La factura requiere un cliente con RUC de 11 dígitos. Elige boleta.')
      }
      const method = can('finance', 'crear') ? invoicePayMethod : ''
      const invoiceCash = method.trim().toLocaleLowerCase('es') === 'efectivo'
      if (invoiceCash && !invoicePayShift) return setError('Selecciona un turno de caja abierto para cobrar en efectivo.')
      const payment = method ? { method, cashShiftId: invoiceCash ? invoicePayShift : null } : null
      void run(() => invoiceSalesOrder(action.order!.id, docType, normalizedSeries, invoiceNumber, requestKey, payment))
    }
    if (action.kind === 'collect' && action.order) {
      const saleId = action.order.venta_id
      if (!saleId) return setError('El pedido no tiene una venta facturada asociada.')
      if (!collectPayMethod) return setError('Selecciona un método de pago.')
      if (collectPending === null) return setError('Espera a que se consulte el saldo pendiente antes de confirmar el cobro.')
      if (collectPending <= 0) return setError('Esta venta ya está cobrada: no hay saldo pendiente.')
      const collectCash = collectPayMethod.trim().toLocaleLowerCase('es') === 'efectivo'
      if (collectCash && !collectPayShift) return setError('Selecciona un turno de caja abierto para cobrar en efectivo.')
      void run(() => collectSalesOrder(saleId, collectPayMethod, collectCash ? collectPayShift : null, requestKey))
    }
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
  const startEdit = (quote: SalesQuote) => { setTab('quotes'); setEditing(quote); setCustomer(quote.cliente_id); setExpiry(quote.vence_el < businessDate(new Date()) ? shiftDate(businessDate(new Date()), 14) : quote.vence_el); setCurrency(quote.moneda); setLines(quote.lineas); setRequestKey(key()); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  const customerName = (id: string) => data?.customers.find(item => item.id === id)?.razon_social ?? id
  const productName = (id: string) => data?.products.find(item => item.id === id)?.nombre ?? id
  const remaining = (order: SalesOrder, productId: string) => {
    const original = order.lineas.find(line => line.producto_id === productId)?.cantidad ?? 0
    const credited = data?.credits.filter(note => note.pedido_id === order.id).reduce((sum, note) => sum + note.lineas.filter(line => line.producto_id === productId).reduce((qty, line) => qty + line.cantidad, 0), 0) ?? 0
    return Math.max(0, original - credited)
  }
  const freeStock = useMemo(() => {
    const result = new Map<string, number>()
    if (!data || !warehouse) return result
    const reserved = new Map<string, number>()
    for (const item of data.reservations) {
      const order = data.orders.find(value => value.id === item.pedido_id)
      if (order?.almacen_id !== warehouse || !['reservado', 'facturado'].includes(order.estado)) continue
      reserved.set(item.producto_id, (reserved.get(item.producto_id) ?? 0) + item.cantidad - item.entregado)
    }
    for (const item of data.inventory) {
      if (item.almacen_id !== warehouse || result.has(item.producto_id)) continue
      result.set(item.producto_id, Math.max(0, item.cantidad - (reserved.get(item.producto_id) ?? 0)))
    }
    return result
  }, [data, warehouse])
  const available = (productId: string) => freeStock.get(productId) ?? 0
  const productById = useMemo(() => new Map((data?.products ?? []).map(item => [item.id, item])), [data?.products])
  const customerOptions = useMemo<PickerOption[]>(() => (data?.customers ?? []).map(item => ({
    id: item.id,
    label: item.razon_social,
    detail: item.documento ? `${item.tipo_doc ?? 'Doc.'} ${item.documento}` : 'Sin documento',
  })), [data?.customers])
  const productOptions = useMemo<PickerOption[]>(() => (data?.products ?? []).map(item => ({
    id: item.id,
    label: item.nombre,
    detail: [
      `${amount(item.precio ?? 0, 'PEN')} lista`,
      currency === 'USD' && exchangeReady ? `≈ ${amount((item.precio ?? 0) / exchangeRate, 'USD')}` : '',
      tab === 'orders' && warehouse && can('inventory') ? `Libre aprox. ${freeStock.get(item.id) ?? 0}` : '',
    ].filter(Boolean).join(' · '),
  })), [data?.products, currency, exchangeReady, exchangeRate, tab, warehouse, freeStock, can])
  const status = (value: string) => value === 'vigente' || value === 'despachado' ? 'green' : value === 'anulado' || value === 'vencida' ? 'red' : 'amber'
  const saleEstimate = lines.reduce((sum, line) => sum + (line.producto_id ? line.cantidad * line.precio : 0), 0)
  const creditInvalid = action?.kind === 'credit' && (
    !action.order || creditBalance === null || !lines.some(line => line.cantidad > 0) ||
    lines.some(line => line.cantidad < 0 || !Number.isInteger(line.cantidad) || line.cantidad > remaining(action.order!, line.producto_id)) ||
    Math.round(lines.reduce((sum, line) => sum + Math.max(0, line.cantidad) * line.precio, 0) * 100) / 100 > creditBalance
  )
  const collectInvalid = action?.kind === 'collect' && (
    !action.order?.venta_id || collectPending === null || collectPending <= 0 || !collectPayMethod ||
    (collectPayMethod.trim().toLocaleLowerCase('es') === 'efectivo' && !collectPayShift)
  )
  const invoiceInvalid = action?.kind === 'invoice' && (
    can('finance', 'crear') && invoicePayMethod.trim().toLocaleLowerCase('es') === 'efectivo' && !invoicePayShift
  )
  if (!can(tab === 'quotes' ? 'quotes' : 'sales')) return <section className="ws-card">Acceso restringido.</section>
  return <div className={`ws-sales-page ws-sales-page--${tab}`}>
    <PageHeader section="Gestión comercial" title={tabMeta[tab].label} icon={tabMeta[tab].icon} description="De la propuesta a la entrega. Cada operación, en un mismo lugar." actions={<>
      {tab === 'orders' && can('sales', 'crear') && can('finance', 'crear') && <button type="button" className="ws-button" onClick={() => { startDirectSale(); window.scrollTo({ top: 0, behavior: 'smooth' }) }}><ShoppingBag size={14} /> Registrar venta</button>}
      <button type="button" className="ws-button ws-button-secondary" onClick={() => void reload().catch(cause => setError(errorText(cause)))}><RefreshCw size={14} /> Actualizar</button>
    </>} />
    {can('sales') && <section className="ec-sales-overview" aria-label="Resumen operativo">
      {([{ label: 'Por facturar', state: 'reservado', detail: 'Pedidos con stock reservado', icon: ShoppingBag, path: '/sales' }, { label: 'Por despachar', state: 'facturado', detail: 'Listos para emitir su guía', icon: ReceiptText, path: '/sales/guides' }, { label: 'Despachados', state: 'despachado', detail: 'Salida de almacén registrada', icon: Truck, path: '/sales/guides' }] as const).map(item => <button key={item.state} type="button" className="ec-card ec-sales-metric" onClick={() => navigate(item.path)}><span className="ec-sales-metric-top"><span>{item.label}</span><item.icon size={19} strokeWidth={1.6} /></span><strong>{data ? data.orders.filter(order => order.estado === item.state).length : '—'}</strong><span className="ec-sales-metric-bottom">{item.detail}<ArrowUpRight size={14} /></span></button>)}
    </section>}
    <div className="ws-notice ws-sales-info" role="note">SUNAT: datos UBL 2.1 preparados; imprimir no equivale a enviar ni obtener CDR. Las ventas anteriores a este flujo no se despachan desde aquí para evitar doble salida.</div>
    <nav className="ws-tabs ws-sales-tabs" aria-label="Secciones de Ventas">{(Object.keys(tabMeta) as Tab[]).map(id => { const Icon = tabMeta[id].icon; return <button type="button" key={id} aria-current={tab===id ? 'page' : undefined} aria-selected={tab===id} onClick={() => navigate(paths[id])}><Icon size={15} />{tabMeta[id].label}</button> })}</nav>
    {error && <div className="ws-notice ws-notice-warning ws-sales-warning" role="alert">{error}</div>}
    {success && <div className="ws-notice ws-sales-success" role="status">{success}</div>}
    {(tab === 'orders' || tab === 'quotes') && can(tab === 'quotes' ? 'quotes' : 'sales', editing ? 'editar' : 'crear') && <form className={`ws-card ws-sales-form ws-sales-form--${tab}`} onSubmit={submit}>
      <div className="ws-sales-form-head"><div><span className="ws-sales-kicker">{tab === 'quotes' ? 'PROPUESTA COMERCIAL' : saleNow ? 'COBRO Y COMPROBANTE' : 'RESERVA DE STOCK'}</span><h2>{tab === 'quotes' ? editing ? `Nueva versión de cotización · v${editing.version+1}` : 'Nueva cotización' : saleNow ? 'Venta directa' : 'Nuevo pedido con reserva'}</h2></div>
        {tab === 'orders' && can('finance', 'crear') && <div className="ec-field ws-sales-mode"><span>Tipo de operación</span><SegmentedControl ariaLabel="Tipo de operación de venta" value={saleNow ? 'direct' : 'order'} onChange={value => { if (value === 'direct') startDirectSale(); else setSaleNow(false) }} options={[{ value: 'order', label: 'Pedido con reserva' }, { value: 'direct', label: 'Venta directa' }]} /></div>}
      </div>
      <div className="ws-form-grid ws-sales-fields"><div className="ec-field ws-sales-client-field"><span>Cliente</span><SearchablePicker required mode="modal" ariaLabel="Cliente" value={customer} onChange={changeCustomer} options={customerOptions} placeholder="Buscar cliente…" searchPlaceholder="Buscar por razón social o documento…" emptyMessage="Ningún cliente coincide con la búsqueda." /></div>
      {tab === 'orders' ? <div className="ec-field"><span>Almacén de reserva</span><SearchablePicker required mode="modal" ariaLabel="Almacén de reserva" value={warehouse} onChange={setWarehouse} options={(data?.warehouses ?? []).map(item => ({ id: item.id, label: item.nombre }))} placeholder="Buscar almacén…" searchPlaceholder="Buscar almacén…" /></div> : <label>Vigente hasta<input required min={businessDate(new Date())} type="date" value={expiry} onChange={event => setExpiry(event.target.value)} /></label>}
      <div className="ec-field ws-sales-currency-field"><span>Moneda</span><SegmentedControl value={currency} onChange={changeCurrency} ariaLabel="Moneda" options={[{value:'PEN',label:'S/ PEN'},{value:'USD',label:'$ USD',disabled:!exchangeReady}]} /><small className="ws-sales-rate"><span>{currency === 'USD' ? exchangeReady ? `1 USD = S/ ${exchangeRate.toFixed(4)}` : 'TC USD sin configurar' : 'Moneda base PEN'}</span><Link to="/maestros#catalogos">Maestros</Link></small></div></div>
      {tab === 'orders' && saleNow && <div className="ws-sales-voucher">
        <div className="ws-sales-voucher-head"><div><span className="ws-sales-kicker">COMPROBANTE</span><h3>Datos de emisión</h3></div><small>Se emite al confirmar la venta.</small></div>
        <div className="ws-form-grid ws-sales-voucher-fields">
          <div className="ec-field"><span>Tipo de comprobante</span><SegmentedControl ariaLabel="Tipo de comprobante de la venta" value={saleDocType} onChange={value => { const tipo = value as '01' | '03'; const serie = tipo === '01' ? 'F001' : 'B001'; setSaleDocType(tipo); setSaleSeries(serie); setSaleNumber(nextSaleNumber(tipo, serie)) }} options={[{ value: '03', label: 'Boleta' }, { value: '01', label: 'Factura · RUC' }]} /></div>
          <label>Serie<input required pattern="[A-Z0-9]{4}" maxLength={4} value={saleSeries} onChange={event => { const nextSeries = event.target.value.toUpperCase(); setSaleSeries(nextSeries); if (nextSeries.length === 4) setSaleNumber(nextSaleNumber(saleDocType, nextSeries)) }} /></label>
          <label>Número<input required min="1" step="1" type="number" value={saleNumber} onChange={event => setSaleNumber(event.target.value)} /></label>
        </div>
      </div>}
      <div className="ws-sales-product-section"><div className="ws-sales-product-heading"><h3>Productos</h3><small>Precios con IGV incluido{currency === 'USD' && exchangeReady ? ` · convertidos con TC ${exchangeRate.toFixed(4)}` : ''}</small></div>{lines.map((line,index) => <div className="ws-form-grid ws-sales-line" key={index}>
        <div className="ec-field ec-product-field"><span>Producto {String(index + 1).padStart(2, '0')}</span><SearchablePicker required mode="modal" ariaLabel={`Producto de la línea ${index + 1}`} value={line.producto_id} onChange={id => updateLine(index,{producto_id:id,precio:toCurrency(productById.get(id)?.precio ?? 0)})} options={productOptions} placeholder="Buscar producto…" searchPlaceholder="Buscar por nombre o precio…" emptyMessage="Ningún producto coincide con la búsqueda." />{tab === 'orders' && warehouse && line.producto_id && can('inventory') && <small className={line.cantidad > available(line.producto_id) ? 'ws-sales-over-limit' : 'relation-hint'}>Libre estimado: {available(line.producto_id)} · validado al guardar</small>}</div>
        <label>Cantidad<input required min="1" step="1" type="number" value={line.cantidad} onChange={event=>updateLine(index,{cantidad:Number(event.target.value)})} /></label>
        <label>Precio unitario ({currency})<input required min="0.01" step="0.01" type="number" value={line.precio} onChange={event=>updateLine(index,{precio:Number(event.target.value)})} /></label>
        <div className="ec-field ec-tax-field"><span>Afectación IGV</span><SegmentedControl ariaLabel={`Afectación IGV de la línea ${index + 1}`} value={line.afectacion} onChange={value => updateLine(index,{afectacion:value})} options={[{value:'10',label:'18% IGV'},{value:'20',label:'Exonerado'},{value:'30',label:'Inafecto'}]} /></div>
        <button type="button" className="ws-button ws-button-secondary ws-sales-remove" disabled={lines.length===1} onClick={()=>setLines(previous=>previous.filter((_,i)=>i!==index))}>Quitar</button></div>)}</div>
      {tab === 'orders' && saleNow && <PaymentCollectionFields amount={saleEstimate} currency={currency} exchangeRate={exchangeRate} value={salePayMethod} onChange={setSalePayMethod} cashShiftId={salePayShift} onCashShiftChange={setSalePayShift} />}
      <div className="ws-sales-form-footer"><p className="ws-sales-total">Total estimado: {amount(saleEstimate,currency)}</p>
      <div className="ws-heading-actions"><button type="button" className="ws-button ws-button-secondary" onClick={()=>setLines(previous=>[...previous,initialLine()])}>Añadir línea</button>{editing&&<button type="button" className="ws-button ws-button-secondary" onClick={()=>{setEditing(null);setCustomer('');setLines([initialLine()]);setExpiry(shiftDate(businessDate(new Date()),14));setRequestKey(key())}}>Cancelar edición</button>}<button disabled={busy||!data} className="ws-button" type="submit">{busy?'Guardando…':editing?'Guardar versión':tab==='quotes'?'Guardar cotización':saleNow?'Registrar venta':'Reservar pedido'}</button></div></div>
    </form>}
    <section className={`ws-card ws-sales-list ws-sales-list--${tab}`}><h2>{tab==='quotes'?'Cotizaciones':tab==='orders'?'Pedidos':tab==='receipts'?'Boletas y facturas':tab==='guides'?'Guías de remisión':tab==='sunat'?'Emisión electrónica SUNAT':'Notas de crédito'}</h2>
      {!data && <div role="status" aria-label="Cargando operaciones de ventas" aria-busy="true">{[0,1,2].map(row => <div key={row} className="ec-skeleton" aria-hidden="true" />)}</div>}
      {tab === 'orders' && data && <div className="ec-filter-chips" role="group" aria-label="Filtrar pedidos por estado">{[{value:'all',label:'Todos'},{value:'reservado',label:'Reservados'},{value:'facturado',label:'Facturados'},{value:'despachado',label:'Despachados'},{value:'anulado',label:'Anulados'}].map(filter => <button type="button" key={filter.value} aria-pressed={orderFilter === filter.value} onClick={() => setOrderFilter(filter.value)}>{filter.label}<span>{data.orders.filter(order => filter.value === 'all' || order.estado === filter.value).length}</span></button>)}</div>}
      {tab==='sunat' ? <div className="ws-sales-sunat-state" role="status"><div className="ws-sales-sunat-summary"><span className="ws-sales-kicker">ESTADO DE INTEGRACIÓN</span><h3>Datos UBL 2.1 preparados</h3><p>Los catálogos y snapshots están preparados en Supabase.</p></div><div className="ws-sales-sunat-provider"><span>Proveedor de emisión</span><strong>No conectado</strong><p>No se envían documentos ni se reciben CDR.</p></div><p className="ws-sales-sunat-disclaimer">La impresión tampoco equivale a emisión electrónica.</p></div> : <div className="table-scroll"><table className="record-table ws-sales-table"><thead><tr><th>Referencia</th><th>Cliente / detalle</th><th>Estado</th><th>Importe</th><th>Acciones</th></tr></thead><tbody>
      {tab==='quotes' && data?.quotes.map(q=>{const expired=q.vence_el<businessDate(new Date())&&q.estado==='vigente'; const label=expired?'vencida':q.estado;const linked=data.orders.find(o=>o.cotizacion_id===q.id&&o.estado!=='anulado');return <tr key={q.id}><td><span className="record-id">{q.id.slice(0,8)}</span><small>Versión {q.version}</small></td><td><strong>{customerName(q.cliente_id)}</strong><small>Vence: {q.vence_el} · {q.lineas.length} línea(s)</small></td><td><span className={`ws-sales-status is-${status(label)}`}>{label}</span></td><td className="record-value">{amount(q.total,q.moneda)}</td><td><div className="row-actions"><button type="button" className="ws-button ws-button-secondary" aria-expanded={historyId===q.id} onClick={()=>setHistoryId(current=>current===q.id?null:q.id)}>Versiones</button>{q.estado==='vigente'&&can('quotes','editar')&&<button type="button" className="ws-button ws-button-secondary" onClick={()=>startEdit(q)}>{expired?'Renovar':'Nueva versión'}</button>}{!expired&&q.estado==='vigente'&&can('sales','crear')&&can('quotes','editar')&&<button type="button" className="ws-button" onClick={()=>begin({kind:'convert',quote:q})}>Convertir a pedido</button>}{linked&&<button type="button" className="ws-button ws-button-secondary" onClick={()=>navigate('/sales')}>Ver {linked.codigo}</button>}</div></td></tr>})}
      {tab==='orders' && data?.orders.filter(o => orderFilter === 'all' || o.estado === orderFilter).map(o=>{const sale=o.venta_id?records.sales.find(item=>item.rowId===o.venta_id):undefined;const receivable=o.venta_id?records.finance.find(item=>item.saleId===o.venta_id):undefined;const isPaid=receivable?receivable.status==='Completada':Boolean(sale?.status==='Completada'&&sale?.medio&&sale.medio.toLocaleLowerCase('es')!=='tarjeta');const payLabel=sale?.medio??receivable?.medio;return <tr key={o.id}><td><span className="record-id">{o.codigo}</span></td><td><strong>{customerName(o.cliente_id)}</strong><small>{o.lineas.length} producto(s) · {o.moneda} · TC {o.tipo_cambio}{payLabel?` · ${payLabel}`:''}{o.venta_id?(isPaid?' · Cobrada':' · CxC pendiente'):''}</small></td><td><span className={`ws-sales-status is-${status(o.estado)}`}>{o.estado}</span></td><td className="record-value">{amount(o.total,o.moneda)}</td><td><div className="row-actions">{o.estado==='reservado'&&can('sales','crear')&&<button className="ws-button" onClick={()=>begin({kind:'invoice',order:o})}>Facturar</button>}{o.estado==='reservado'&&can('sales','editar')&&<button className="ws-button ws-button-secondary" onClick={()=>begin({kind:'cancel',order:o})}>Anular pedido</button>}{o.estado==='facturado'&&can('sales','editar')&&<button className="ws-button" onClick={()=>begin({kind:'guide',order:o})}>Emitir guía</button>}{(o.estado==='facturado'||o.estado==='despachado')&&o.venta_id&&!isPaid&&can('finance','crear')&&<button className="ws-button ws-button-secondary" onClick={()=>begin({kind:'collect',order:o})}>Cobrar</button>}{o.estado==='despachado'&&can('sales','editar')&&<button className="ws-button ws-button-secondary" onClick={()=>begin({kind:'credit',order:o})}>Nota de crédito</button>}</div></td></tr>})}
      {tab==='receipts' && data?.receipts.map(r=><tr key={r.id}><td><span className="record-id">{r.serie}-{r.numero}</span><small>{r.tipo==='01'?'Factura':'Boleta'}</small></td><td><strong>{r.snapshot?.cliente ?? 'Cliente no informado'}</strong><small>{new Date(r.created_at).toLocaleDateString('es-PE', { timeZone: 'America/Lima' })}</small></td><td><span className={`ws-sales-status is-${r.estado_sunat==='aceptado'?'green':r.estado_sunat==='rechazado'?'red':'amber'}`}>{r.estado_sunat}</span></td><td className="record-value">{amount(r.total,r.moneda)}</td><td><button className="ws-button ws-button-secondary" onClick={()=>setPrintReceipt(r)}>Detalle · A4 / ticket</button></td></tr>)}
      {tab==='guides' && data?.guides.map(g=><tr key={g.id}><td><span className="record-id">{g.codigo}</span></td><td><strong>{g.origen} → {g.destino}</strong><small>{g.lineas?.length ?? 0} producto(s) · {new Date(g.created_at).toLocaleDateString('es-PE', { timeZone: 'America/Lima' })}</small></td><td><span className="ws-sales-status is-green">despachado</span></td><td>—</td><td>{can('inventory')&&<button type="button" className="ws-button ws-button-secondary" onClick={()=>navigate(`/inventario/kardex?q=${encodeURIComponent(g.id)}`)}>Ver salida en Kardex</button>}</td></tr>)}
      {tab==='credits' && data?.credits.map(n=><tr key={n.id}><td><span className="record-id">{n.codigo}</span></td><td><strong>{n.motivo}</strong><small>{n.lineas.length} producto(s) acreditados</small></td><td><span className="ws-sales-status is-green">registrada</span></td><td className="record-value">{amount(n.total,data?.orders.find(o=>o.id===n.pedido_id)?.moneda??'PEN')}</td><td>{can('inventory')&&<button type="button" className="ws-button ws-button-secondary" onClick={()=>navigate(`/inventario/kardex?q=${encodeURIComponent(n.id)}`)}>Consultar Kardex</button>}</td></tr>)}
      </tbody></table></div>}{tab==='quotes'&&historyId&&<div className="ws-sales-history"><h3>Historial de versiones</h3>{data?.versions.filter(version=>version.cotizacion_id===historyId).sort((a,b)=>b.version-a.version).map(version=><div key={`${version.cotizacion_id}-${version.version}`}><strong>Versión {version.version}</strong><span>{version.vence_el} · {version.lineas.length} líneas · {amount(version.total,version.moneda)}</span></div>)}</div>}
      {data&&tab==='orders'&&!data.orders.length&&<div className="ws-empty-compact">Aún no hay pedidos reservados. Selecciona cliente, almacén y productos para crear el primero.</div>}
      {data&&tab==='orders'&&data.orders.length>0&&!data.orders.some(o=>orderFilter==='all'||o.estado===orderFilter)&&<div className="ws-empty-compact">No hay pedidos con este estado. <button type="button" className="ws-button ws-button-secondary" onClick={()=>setOrderFilter('all')}>Mostrar todos</button></div>}
      {data&&tab==='quotes'&&!data.quotes.length&&<div className="ws-empty-compact">Todavía no hay cotizaciones. Completa el formulario para crear la primera.</div>}
      {data&&tab==='receipts'&&!data.receipts.length&&<div className="ws-empty-compact">Sin comprobantes. Factura primero un pedido reservado.</div>}
      {data&&tab==='guides'&&!data.guides.length&&<div className="ws-empty-compact">Sin guías emitidas. Selecciona un pedido facturado debajo para registrar el despacho.</div>}
      {data&&tab==='credits'&&!data.credits.length&&<div className="ws-empty-compact">Sin notas de crédito. Selecciona un pedido despachado debajo para acreditar o devolver productos.</div>}
    </section>
    {tab==='guides'&&data&&<section className="ws-card ws-sales-pending"><h2>Pedidos facturados pendientes de despacho</h2><p>Emitir la guía consume la reserva y genera la salida física oficial del almacén en Kardex.</p><div className="ws-sales-action-list">{data.orders.filter(order=>order.estado==='facturado').map(order=><div key={order.id}><span><strong>{order.codigo}</strong><small>{customerName(order.cliente_id)} · {data.warehouses.find(w=>w.id===order.almacen_id)?.nombre??'Almacén'} · {order.lineas.length} producto(s)</small></span><button type="button" className="ws-button" disabled={!can('sales','editar')||!(can('inventory','crear')||can('inventory','editar'))} onClick={()=>begin({kind:'guide',order})}>Emitir guía</button></div>)}{!data.orders.some(order=>order.estado==='facturado')&&<div className="ws-empty-compact">No hay pedidos facturados pendientes de guía.</div>}</div></section>}
    {tab==='credits'&&data&&<section className="ws-card ws-sales-pending"><h2>Pedidos disponibles para nota de crédito</h2><p>Solo se admiten pedidos ya despachados y cantidades no acreditadas. La base comprueba también el saldo no cobrado.</p><div className="ws-sales-action-list">{data.orders.filter(order=>order.estado==='despachado'&&order.lineas.some(line=>remaining(order,line.producto_id)>0)).map(order=><div key={order.id}><span><strong>{order.codigo}</strong><small>{customerName(order.cliente_id)} · {order.lineas.map(line=>`${productName(line.producto_id)}: ${remaining(order,line.producto_id)} máx.`).join(' · ')}</small></span><button type="button" className="ws-button" disabled={!can('sales','editar')||!can('finance','editar')} onClick={()=>begin({kind:'credit',order})}>Registrar nota</button></div>)}{!data.orders.some(order=>order.estado==='despachado'&&order.lineas.some(line=>remaining(order,line.producto_id)>0))&&<div className="ws-empty-compact">No hay cantidades pendientes de acreditar.</div>}</div></section>}
    {action&&<div className="modal-backdrop" role="presentation"><form className="voucher-modal ws-sales-dialog" role="dialog" aria-modal="true" aria-label="Operación de venta" onSubmit={submitAction}><div className="modal-heading"><h2>{action.kind==='convert'?'Convertir cotización':action.kind==='invoice'?'Facturar pedido':action.kind==='collect'?'Cobrar venta':action.kind==='guide'?'Emitir guía':action.kind==='cancel'?'Anular pedido':'Nota de crédito / devolución'}</h2></div>
      {action.kind==='cancel'&&<p>Se liberará la reserva. No se emitió comprobante ni se creó cuenta por cobrar.</p>}
      {action.kind==='collect'&&action.order&&<>
        <p>Pedido {action.order.codigo} · {customerName(action.order.cliente_id)} · total {amount(action.order.total,action.order.moneda)}.</p>
        <p>Saldo pendiente de la cuenta por cobrar: <strong>{collectPending===null?(collectPendingError?'No disponible':'Consultando…'):amount(collectPending,action.order.moneda)}</strong>{collectPendingError?` · ${collectPendingError}`:''}</p>
        {collectPending!==null&&collectPending<=0&&<div className="ws-notice ws-notice-warning" role="alert">Esta venta ya está cobrada: no queda saldo pendiente.</div>}
        <PaymentCollectionFields amount={collectPending??0} currency={action.order.moneda} exchangeRate={action.order.tipo_cambio} value={collectPayMethod} onChange={setCollectPayMethod} cashShiftId={collectPayShift} onCashShiftChange={setCollectPayShift} pendingLabel="Selecciona el método de cobro" pendingNote="El cobro se aplicará a la cuenta por cobrar existente de esta venta." disabled={collectPending===null||collectPending<=0} />
      </>}
      {action.kind==='convert'&&<><div className="ec-field"><span>Almacén de reserva</span><SearchablePicker required ariaLabel="Almacén de reserva" value={warehouse} onChange={setWarehouse} options={(data?.warehouses ?? []).map(w=>({id:w.id,label:w.nombre}))} /></div><label className="ws-sales-check"><input type="checkbox" checked={convertToSale} onChange={event=>setConvertToSale(event.target.checked)}/> Facturar ahora (desactiva para crear solo el pedido)</label></>}
      {(action.kind==='invoice'||(action.kind==='convert'&&convertToSale))&&<div className="ws-form-grid"><div className="ec-field"><span>Comprobante</span><SegmentedControl ariaLabel="Tipo de comprobante" value={docType} onChange={value=>{const tipo=value as '01'|'03';const nextSeries=tipo==='01'?'F001':'B001';setDocType(tipo);setSeries(nextSeries);setNumber(nextSaleNumber(tipo,nextSeries))}} options={[{value:'03',label:'Boleta'},{value:'01',label:'Factura · RUC'}]} /></div><label>Serie<input required pattern="[A-Z0-9]{4}" maxLength={4} value={series} onChange={event=>{const nextSeries=event.target.value.toUpperCase();setSeries(nextSeries);if(nextSeries.length===4)setNumber(nextSaleNumber(docType,nextSeries))}}/></label><label>Número<input required min="1" type="number" value={number} onChange={event=>setNumber(event.target.value)}/></label></div>}
      {action.kind==='invoice'&&action.order&&can('finance','crear')&&<PaymentCollectionFields amount={action.order.total} currency={action.order.moneda} exchangeRate={action.order.tipo_cambio} value={invoicePayMethod} onChange={setInvoicePayMethod} cashShiftId={invoicePayShift} onCashShiftChange={setInvoicePayShift} pendingLabel="Facturar sin cobro (CxC pendiente)" />}
      {action.kind==='convert'&&convertToSale&&<p className="relation-hint ws-payment-note">La conversión factura el pedido y deja la cuenta por cobrar pendiente. Después podrás usar «Cobrar» en la lista de pedidos.</p>}
      {action.kind==='guide'&&<><p>Pedido {action.order?.codigo} · almacén {data?.warehouses.find(w=>w.id===action.order?.almacen_id)?.nombre??'seleccionado'}. La guía despachará {action.order?.lineas.reduce((total,line)=>total+line.cantidad,0)} unidades y registrará Kardex una sola vez.</p><div className="ws-form-grid"><label>Dirección de origen<input required minLength={4} value={origin} onChange={event=>setOrigin(event.target.value)} placeholder="Almacén, dirección o punto de partida"/></label><label>Dirección de destino<input required minLength={4} value={destination} onChange={event=>setDestination(event.target.value)} placeholder="Dirección de entrega"/></label></div></>}
      {action.kind==='credit'&&action.order&&<><p>Pedido {action.order.codigo} · {customerName(action.order.cliente_id)}. Elige cuánto acreditar por producto.</p><label>Motivo de anulación o corrección<input required minLength={5} value={reason} onChange={event=>setReason(event.target.value)} placeholder="Explica el motivo de la nota"/></label><label className="ws-sales-check"><input type="checkbox" checked={returnStock} onChange={event=>setReturnStock(event.target.checked)}/> Devolver físicamente los productos al almacén (entrada en Kardex)</label><div className="ws-notice ws-notice-warning" role="note">Si solo corriges el importe, deja desmarcado el retorno. Si recibes mercadería de vuelta, márcalo ahora: una línea acreditada no puede volver a acreditarse después para devolver stock.</div><p>Saldo CxC no cobrado: {!can('finance','ver')?'No disponible sin permiso de consulta de Finanzas':creditBalance===null?creditBalanceError?'No disponible':'Consultando…':amount(creditBalance,action.order.moneda)}. No se puede acreditar dinero ya cobrado sin un reembolso previo.</p>{creditBalanceError&&<small className="ws-sales-over-limit">{creditBalanceError} · La RPC validará el saldo de todos modos.</small>}{lines.map((line,i)=>{const max=remaining(action.order!,line.producto_id);return <label className="ws-sales-credit-line" key={line.producto_id}><span>{productName(line.producto_id)}<small>Vendido: {action.order?.lineas[i].cantidad} · ya acreditado: {(action.order?.lineas[i].cantidad??0)-max} · máximo visible: {max}</small></span><input aria-label={`Cantidad a acreditar de ${productName(line.producto_id)}`} type="number" min="0" max={max} step="1" value={line.cantidad} disabled={!max} onChange={event=>updateLine(i,{cantidad:Number(event.target.value)})}/></label>})}<p>Total estimado de la nota: {amount(lines.reduce((sum,line)=>sum+line.cantidad*line.precio,0),action.order.moneda)} · el servidor calcula el importe exacto y los topes definitivos.</p></>}
      {error&&<div className="ws-notice ws-notice-warning ws-sales-warning" role="alert">{error}</div>}
      <div className="modal-actions"><button type="button" className="ws-button ws-button-secondary" onClick={()=>setAction(null)}>Cancelar</button><button className="ws-button" disabled={busy || creditInvalid || collectInvalid || invoiceInvalid} type="submit">{busy?'Procesando…':'Confirmar'}</button></div></form></div>}
    {printReceipt&&<SalesReceiptPrint receipt={printReceipt} company={company} products={data?.products??[]} onClose={()=>setPrintReceipt(null)}/>}
  </div>
}
