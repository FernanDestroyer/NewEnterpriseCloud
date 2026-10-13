import { Fragment, useEffect, useMemo, useState } from 'react'
import { Navigate, useParams, useSearchParams } from 'react-router-dom'
import { AlertTriangle, ArrowDownUp, ArrowRight, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ClipboardCheck, ClipboardList, Download, FileText, Filter, Info, Layers3, PackageCheck, Pencil, Plus, Receipt, RefreshCw, Search, ShoppingCart, Trash2, Wallet } from 'lucide-react'
import { DATA_PAGES, pageMeta } from '../data/catalog'
import { financialSnapshot } from '../data/dashboard'
import { money, purchaseHasStock, statusTone, stockStatus } from '../data/helpers'
import { businessDate, displayDate, inDateRange, matchesSearch } from '../data/workspace'
import { useAuth } from '../context/AuthContext'
import { useRecords } from '../context/RecordsContext'
import { fetchKardex, fetchPaymentMethods, friendlyError, type KardexEntry } from '../services/records'
import ConfirmModal from '../components/ConfirmModal'
import PurchaseOrderDetail from '../components/PurchaseOrderDetail'
import SupplierCatalog from '../components/SupplierCatalog'
import SupplierImport from '../components/SupplierImport'
import VoucherModal from '../components/VoucherModal'
import type { DataPage, ExportFormat, RecordItem } from '../types'

export type ModuleView = 'records' | 'receipts' | 'billing' | 'accounts' | 'kardex'

export default function ModuloPage({ page: suppliedPage, view = 'records', embedded = false, allowCreate = true }: { page?: DataPage; view?: ModuleView; embedded?: boolean; allowCreate?: boolean }) {
  const { pageId } = useParams()
  const page = suppliedPage ?? DATA_PAGES.find(candidate => candidate === pageId)
  if (!page) return <Navigate to="/dashboard" replace />
  return <ModuleContent key={`${page}-${view}`} page={page} view={view} embedded={embedded} allowCreate={allowCreate} />
}

function ModuleContent({ page, view, embedded, allowCreate = true }: { page: DataPage; view: ModuleView; embedded: boolean; allowCreate?: boolean }) {
  const { can } = useAuth()
  const { records, loading, errors, saving, refreshing, lastSyncedAt, openComposer, openEditor, requestDelete, exportTable, convertQuote, reload, settleAccount, receivePurchase, registerPurchaseIngress, notify } = useRecords()
  const [params, setParams] = useSearchParams()
  const query = params.get('q') ?? ''
  const status = params.get('status') ?? 'Todos'
  const from = params.get('from') ?? ''
  const to = params.get('to') ?? ''
  const [receiptTab, setReceiptTab] = useState<'all' | 'pending' | 'received'>('all')
  const [financeTab, setFinanceTab] = useState<'todos' | 'cobrar' | 'pagar' | 'caja'>(view === 'accounts' ? 'cobrar' : 'todos')
  const [inventoryTab] = useState<'records' | 'kardex'>(view === 'kardex' ? 'kardex' : 'records')
  const [pageIndex, setPageIndex] = useState(0)
  const [pageSize, setPageSize] = useState(10)
  const [sort, setSort] = useState<{ field: 'createdAt' | 'id' | 'name' | 'value'; ascending: boolean }>({ field: 'createdAt', ascending: false })
  const [exportOpen, setExportOpen] = useState(false)
  const [purchaseId, setPurchaseId] = useState<string | null>(null)
  const [supplierId, setSupplierId] = useState<string | null>(null)
  const [voucher, setVoucher] = useState<RecordItem | null>(null)
  const [quote, setQuote] = useState<RecordItem | null>(null)
  const [account, setAccount] = useState<RecordItem | null>(null)
  const [kardex, setKardex] = useState<KardexEntry[]>([])
  const [kardexProduct, setKardexProduct] = useState('')
  const [kardexType, setKardexType] = useState('Todos')
  const [kardexLoading, setKardexLoading] = useState(false)
  const [kardexError, setKardexError] = useState('')
  const [kardexRefresh, setKardexRefresh] = useState(0)
  const [payMethods, setPayMethods] = useState<string[]>(['Efectivo'])
  const [payMedio, setPayMedio] = useState('Efectivo')
  useEffect(() => {
    if (!account) return
    setPayMedio('Efectivo')
    let active = true
    fetchPaymentMethods()
      .then((methods) => active && setPayMethods(methods.map((method) => method.nombre)))
      .catch(() => active && setPayMethods(['Efectivo']))
    return () => {
      active = false
    }
  }, [account])
  const meta = pageMeta[page]
  const title = view === 'receipts' ? 'Ingreso al Kardex' : view === 'billing' ? 'Comprobantes de venta' : view === 'accounts' ? 'Estado de cuenta' : view === 'kardex' ? 'Movimientos de Kardex' : meta.title
  const description = view === 'receipts' ? 'Registra el ingreso de las compras recibidas: confirma su entrada al inventario.' : view === 'billing' ? 'Consulta e imprime los comprobantes de tus ventas registradas.' : view === 'accounts' ? 'Da seguimiento a las cuentas por cobrar y registra su cancelación.' : view === 'kardex' ? 'Entradas y salidas registradas automáticamente por los cambios de stock.' : meta.description
  const invalidRange = Boolean(from && to && from > to)
  const finance = useMemo(() => financialSnapshot(records.finance), [records.finance])

  const base = useMemo(() => {
    let items = records[page]
    // Órdenes de compra: se visualiza todo lo comprado (pendiente y recibido).
    if (page === 'purchases' && view === 'receipts') {
      // Ingreso al Kardex: solo lo recibido (Recibida por registrar + En inventario).
      // Lo pendiente (Pendiente, Solicitud u Orden) vive en Órdenes de compra.
      items = items.filter(item => item.status === 'Recibida' || purchaseHasStock(item.status))
      if (receiptTab === 'received') items = items.filter(item => purchaseHasStock(item.status))
      else if (receiptTab === 'pending') items = items.filter(item => !purchaseHasStock(item.status))
    }
    if (page === 'finance' && financeTab !== 'todos') {
      const source = financeTab === 'cobrar' ? [...finance.receivables, ...finance.completedReceivables] : financeTab === 'pagar' ? [...finance.payables, ...finance.completedPayables] : [...finance.completedReceivables, ...finance.completedPayables]
      const ids = new Set(source.map(item => item.id))
      items = items.filter(item => ids.has(item.id))
    }
    return items
  }, [records, page, view, receiptTab, financeTab, finance])
  const filtered = useMemo(() => base.filter(item => !invalidRange && matchesSearch(item, query) && (status === 'Todos' || (page === 'inventory' ? stockStatus(item.quantity ?? 0) : item.status) === status) && inDateRange(item, { from, to })), [base, query, status, from, to, invalidRange])
  const sorted = useMemo(() => [...filtered].sort((a, b) => {
    const value = (item: RecordItem) => sort.field === 'value' ? item.quantity ?? item.amount ?? 0 : sort.field === 'createdAt' ? item.createdAt ?? '' : item[sort.field]
    const av = value(a), bv = value(b)
    const result = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv), 'es', { numeric: true })
    return result * (sort.ascending ? 1 : -1)
  }), [filtered, sort])
  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize))
  const current = Math.min(pageIndex, pageCount - 1)
  const visible = sorted.slice(current * pageSize, (current + 1) * pageSize)
  const statuses = [...new Set(base.map(item => page === 'inventory' ? stockStatus(item.quantity ?? 0) : item.status))]
  const purchase = records.purchases.find(item => item.id === purchaseId)
  const isKardex = page === 'inventory' && inventoryTab === 'kardex'
  const total = filtered.reduce((sum, item) => sum + (item.amount ?? 0), 0)
  const stock = filtered.reduce((sum, item) => sum + (item.quantity ?? 0), 0)
  const valuation = filtered.reduce((sum, item) => sum + (item.quantity ?? 0) * (item.precio ?? 0), 0)
  const filteredFinance = financialSnapshot(filtered)

  useEffect(() => { setPageIndex(0) }, [query, status, from, to, receiptTab, financeTab, pageSize])
  useEffect(() => {
    if (!isKardex || !can('inventory')) return
    let active = true
    setKardexLoading(true)
    setKardexError('')
    fetchKardex(kardexProduct || null, 500).then(rows => active && setKardex(rows)).catch(error => active && setKardexError(friendlyError(error))).finally(() => active && setKardexLoading(false))
    return () => { active = false }
  }, [isKardex, kardexProduct, kardexRefresh, lastSyncedAt, can])
  useEffect(() => {
    if (!exportOpen) return
    const close = (event: MouseEvent) => { if (!(event.target as HTMLElement)?.closest('.export-wrap')) setExportOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setExportOpen(false) }
    document.addEventListener('mousedown', close); document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', escape) }
  }, [exportOpen])

  const parameter = (key: string, value: string) => setParams(previous => { const next = new URLSearchParams(previous); if (value && value !== 'Todos') next.set(key, value); else next.delete(key); return next }, { replace: true })
  const sortBy = (field: typeof sort.field) => setSort(previous => ({ field, ascending: previous.field === field ? !previous.ascending : true }))
  const chooseFormat = (format: ExportFormat) => { setExportOpen(false); exportTable(page, format, sorted) }
  const kardexFiltered = kardex.filter(row => {
    const date = businessDate(row.created_at)
    return (kardexType === 'Todos' || row.tipo === kardexType) && (!from || date >= from) && (!to || date <= to) && `${row.productoNombre ?? ''} ${row.productoCodigo ?? ''} ${row.referencia ?? ''}`.toLocaleLowerCase('es').includes(query.toLocaleLowerCase('es'))
  })
  const summary = page === 'inventory' ? [
    ['Productos', String(filtered.length)], ['Unidades', stock.toLocaleString('es-PE')], ['Con alertas', String(filtered.filter(item => item.status !== 'Estable').length)], ['Valor referencial de venta', money(valuation)],
  ] : page === 'finance' ? [
    ['Por cobrar', money(filteredFinance.receivable)], ['Por pagar', money(filteredFinance.payable)], ['Cuentas abiertas', String(filteredFinance.open.length)], ['Completadas', String(filtered.filter(item => item.status === 'Completada').length)],
  ] : [['Registros', String(filtered.length)], ['Pendientes', String(filtered.filter(item => item.status === 'Pendiente' || item.status === 'Solicitud' || item.status === 'Orden').length)], ['Completados', String(filtered.filter(item => item.status === 'Completada' || item.status === 'Pagada').length)], [meta.kind === 'money' ? page === 'purchases' ? 'Subtotal de compras' : 'Importe registrado' : 'Vigentes', meta.kind === 'money' ? money(total) : String(filtered.filter(item => item.status === 'Activo' || item.status === 'Vigente').length)]]

  if (!can(page)) return <div className="ws-card ws-empty-compact"><ShieldNotice /><strong>Acceso restringido</strong><span>Tu rol no tiene permiso de consulta para {meta.title.toLocaleLowerCase()}.</span></div>

  return <>
    {!embedded && <section className="module-header"><div><span className="section-kicker">{view === 'records' ? meta.eyebrow : 'OPERACIÓN CONECTADA'}</span><h1>{title}</h1><p>{description}</p></div>{view !== 'receipts' && view !== 'kardex' && can(page, 'crear') && <button className="primary-button" disabled={loading || Boolean(errors[page])} onClick={() => openComposer(page)}><Plus size={17} />{meta.action}</button>}</section>}
    {invalidRange && <div className="ws-notice ws-notice-warning" role="alert"><AlertTriangle size={17} />La fecha inicial debe ser anterior o igual a la fecha final.</div>}
    {page === 'purchases' && view === 'receipts' && <div className="ws-view-tabs"><div className="ws-tabs" role="tablist" aria-label="Recepciones"><button role="tab" aria-selected={receiptTab === 'all'} onClick={() => setReceiptTab('all')}>Todas</button><button role="tab" aria-selected={receiptTab === 'pending'} onClick={() => setReceiptTab('pending')}>Por registrar</button><button role="tab" aria-selected={receiptTab === 'received'} onClick={() => setReceiptTab('received')}>En inventario</button></div></div>}
    {page === 'purchases' && view === 'receipts' && !loading && !errors[page] && records.purchases.some(item => item.status === 'Recibida') && <div className="ws-notice ws-notice-warning" role="status"><AlertTriangle size={17} /><span>{records.purchases.filter(item => item.status === 'Recibida').length} {records.purchases.filter(item => item.status === 'Recibida').length === 1 ? 'orden recibida pendiente de registrar' : 'órdenes recibidas pendientes de registrar'}: aún no generan movimiento de Kardex.</span></div>}
    {page === 'finance' && <div className="ws-view-tabs"><div className="ws-tabs" role="tablist" aria-label="Vistas de finanzas">{([{ value: 'todos', label: 'Todos' }, { value: 'cobrar', label: 'Por cobrar' }, { value: 'pagar', label: 'Por pagar' }, { value: 'caja', label: 'Cobros y pagos completados' }] as const).map(tab => <button key={tab.value} role="tab" aria-selected={financeTab === tab.value} onClick={() => setFinanceTab(tab.value)}>{tab.label}</button>)}</div></div>}
    {purchase ? <PurchaseOrderDetail order={purchase} onBack={() => setPurchaseId(null)} /> : isKardex ? <section className="ws-card"><div className="ws-card-heading"><div><h2>Historial de inventario</h2><p>Hasta 500 movimientos recientes consultados en Supabase</p></div><button className="ws-icon-button" onClick={() => setKardexRefresh(value => value + 1)} disabled={kardexLoading} aria-label="Recargar Kardex"><RefreshCw size={17} className={kardexLoading ? 'ws-spin' : ''} /></button></div><div className="ws-module-toolbar"><label className="ws-table-search"><Search size={16} /><input value={query} onChange={event => parameter('q', event.target.value)} placeholder="Buscar producto o referencia…" aria-label="Buscar movimientos" /></label><select className="ws-control" value={kardexProduct} onChange={event => setKardexProduct(event.target.value)} aria-label="Producto del Kardex"><option value="">Todos los productos</option>{records.inventory.map(item => <option key={item.id} value={item.rowId}>{item.name}</option>)}</select><select className="ws-control" value={kardexType} onChange={event => setKardexType(event.target.value)} aria-label="Tipo de movimiento"><option>Todos</option><option value="entrada">Entradas</option><option value="salida">Salidas</option><option value="ajuste">Ajustes</option><option value="transferencia">Transferencias</option></select><DateFilters from={from} to={to} onChange={parameter} /></div><div className="kardex-summary"><span className="kardex-chip in">Entradas: {kardexFiltered.filter(row => row.tipo === 'entrada').reduce((sum, row) => sum + row.cantidad, 0)} und.</span><span className="kardex-chip out">Salidas: {kardexFiltered.filter(row => row.tipo === 'salida').reduce((sum, row) => sum + row.cantidad, 0)} und.</span></div>{kardexError && <div className="ws-notice ws-notice-warning" role="alert">{kardexError}</div>}<div className="table-scroll"><table className="record-table"><thead><tr><th>Fecha</th><th>Producto</th><th>Movimiento</th><th>Cantidad</th><th>Stock anterior → nuevo</th><th>Referencia</th></tr></thead><tbody>{kardexFiltered.map(row => <tr key={row.id}><td>{displayDate(row.created_at)}</td><td><strong>{row.productoNombre ?? 'Producto eliminado'}</strong><small>{row.productoCodigo ?? '—'}</small></td><td><span className={`status-pill ${row.tipo === 'entrada' ? 'green' : 'amber'}`}>{row.tipo}</span></td><td className="record-value">{row.tipo === 'salida' ? '−' : '+'}{row.cantidad} und.</td><td>{row.stock_anterior ?? '—'} → {row.stock_nuevo ?? '—'}</td><td><span className="record-id">{row.referencia ?? '—'}</span></td></tr>)}{!kardexFiltered.length && <tr><td colSpan={6}><EmptyRecords loading={kardexLoading} error={kardexError} title="Sin movimientos para estos filtros" /></td></tr>}</tbody></table></div><div className="ws-pagination"><span>{kardexFiltered.length} movimientos mostrados · Registro automático de PostgreSQL</span></div></section> : <div className="ws-module-layout"><section className="ws-card"><div className="ws-module-intro"><div><strong>{view === 'billing' ? 'Comprobantes y ventas registradas' : view === 'accounts' ? 'Cuentas y contrapartes' : 'Lista de registros'}</strong><small>EnterpriseCloud · Información consultada en Supabase</small></div><div className="table-actions">{page === 'suppliers' && <SupplierImport />}<div className="export-wrap"><button className="export-button" aria-haspopup="menu" aria-expanded={exportOpen} disabled={loading || Boolean(errors[page]) || invalidRange} onClick={() => setExportOpen(value => !value)}><Download size={15} />Exportar<ChevronDown size={13} /></button>{exportOpen && <div className="export-menu open" role="menu" aria-label="Formatos de exportación">{(['csv', 'excel', 'pdf'] as const).map(format => <button key={format} role="menuitem" onClick={() => chooseFormat(format)}><FileText size={16} /><span><strong>{format === 'excel' ? 'Excel' : format.toUpperCase()}</strong><small>{sorted.length} registros filtrados</small></span></button>)}</div>}</div></div></div>
      <div className="ws-module-toolbar"><label className="ws-table-search"><Search size={16} /><input value={query} onChange={event => parameter('q', event.target.value)} placeholder={`Buscar en ${title.toLocaleLowerCase('es')}…`} aria-label={`Buscar en ${title}`} /></label><select className="ws-control" value={status} onChange={event => parameter('status', event.target.value)} aria-label="Filtrar por estado"><option>Todos</option>{statuses.map(value => <option key={value}>{value}</option>)}</select><DateFilters from={from} to={to} onChange={parameter} /></div>
      {errors[page] && <div className="ws-notice ws-notice-warning" role="alert"><AlertTriangle size={17} /><span>{errors[page]}</span><button className="ws-text-button" onClick={() => void reload()}>Reintentar</button></div>}
      <div className="table-scroll"><table className="record-table"><thead><tr><th><SortHeading label="Referencia" onClick={() => sortBy('id')} /></th><th><SortHeading label={page === 'documents' ? 'Documento' : page === 'inventory' ? 'Producto' : 'Nombre / contraparte'} onClick={() => sortBy('name')} /></th><th><SortHeading label="Fecha de registro" onClick={() => sortBy('createdAt')} /></th><th className="ws-align-right"><SortHeading label={page === 'inventory' ? 'Stock / precio' : meta.kind === 'money' ? 'Importe' : 'Detalle'} onClick={() => sortBy('value')} /></th><th>Estado</th><th><span className="sr-only">Acciones</span></th></tr></thead><tbody>{visible.map(item => <Fragment key={item.id}><tr><td><span className="record-id">{item.id}</span></td><td>{page === 'suppliers' && (!embedded || !can(page, 'editar'))
  ? <strong>{item.name}</strong>
  : page === 'suppliers'
    ? <button type="button" className="ws-rowlink" title="Abrir ficha y editar" aria-label={`Ver y editar ${item.name}`} onClick={() => openEditor(page, item)}><strong>{item.name}</strong></button>
    : <strong>{item.name}</strong>}<small>{item.detail}</small>{item.relatedName && <span className="linked-badge">{item.relatedCode} · {item.relatedName}</span>}{page === 'suppliers' && <span className={`linked-badge${item.ruc ? '' : ' muted'}`}>{item.ruc ? `RUC ${item.ruc}` : 'RUC pendiente'}</span>}{page === 'customers' && <span className={`linked-badge${item.documento ? '' : ' muted'}`}>{item.documento ? `${item.tipoDoc ?? 'DOC'} ${item.documento}` : 'Sin documento'}</span>}{page === 'finance' && item.dueAt && <small>Vence: {displayDate(`${item.dueAt}T12:00:00Z`)}</small>}</td><td className="record-date">{displayDate(item.createdAt)}<small>{item.date}</small></td><td className="record-value ws-align-right">{page === 'inventory' ? <>{item.quantity ?? 0} und.<small>{item.precio !== undefined ? money(item.precio) : 'Precio pendiente'}</small></> : meta.kind === 'money' ? money(item.amount) : item.detail.split('·')[0]}</td><td><span className={`status-pill ${statusTone(page === 'inventory' ? stockStatus(item.quantity ?? 0) : item.status)}`}>{page === 'inventory' ? stockStatus(item.quantity ?? 0) : item.status}</span></td><td><div className="row-actions">{(page === 'sales' || page === 'purchases') && <button className="row-action" title="Ver comprobante" aria-label={`Ver comprobante de ${item.id}`} onClick={() => setVoucher(item)}><Receipt size={15} /></button>}{page === 'purchases' && ['Pendiente', 'Solicitud', 'Orden'].includes(item.status) && can('purchases', 'editar') && <button className="primary-button row-action-text" title="Recibir: ingresa lo comprado al inventario (+ kardex)" aria-label={`Recibir ${item.id}`} disabled={saving} onClick={() => void receivePurchase(item)}><PackageCheck size={14} /> Recibir</button>}{page === 'purchases' && item.status === 'Recibida' && can('purchases', 'editar') && <button className="export-button row-action-text" title="Registrar ingreso: aplica lo comprado al inventario (+ kardex)" aria-label={`Registrar ingreso de ${item.id}`} disabled={saving} onClick={() => void registerPurchaseIngress(item)}><ClipboardCheck size={14} /> Registrar ingreso</button>}{page === 'quotes' && ['Pendiente', 'En curso', 'Aprobada'].includes(item.status) && can('sales', 'crear') && can('quotes', 'editar') && <button className="row-action" title="Convertir en venta" aria-label={`Convertir ${item.id} en venta`} disabled={saving} onClick={() => setQuote(item)}><ShoppingCart size={15} /></button>}{page === 'finance' && item.status !== 'Completada' && can('finance', 'editar') && <button className="row-action" title={item.financeType === 'pagar' ? 'Registrar pago total' : 'Registrar cobro total'} aria-label={`Completar cuenta ${item.id}`} disabled={saving} onClick={() => setAccount(item)}><Wallet size={15} /></button>}{page === 'suppliers' && <button className="row-action" title="Catálogo del proveedor" aria-expanded={supplierId === item.id} aria-label={`Ver catálogo de ${item.name}`} onClick={() => setSupplierId(value => value === item.id ? null : item.id)}>{supplierId === item.id ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</button>}{((page !== 'suppliers' && page !== 'purchases' && page !== 'customers' && page !== 'inventory' && page !== 'finance' && (page !== 'sales' || item.status !== 'Completada')) || ((page === 'suppliers' || page === 'customers') && embedded)) && can(page, 'editar') && <button className="row-action" title="Editar" aria-label={`Editar ${item.name}`} onClick={() => openEditor(page, item)}><Pencil size={15} /></button>}{can(page, 'eliminar') && <button className="row-action delete" title="Eliminar" aria-label={`Eliminar ${item.name}`} onClick={() => requestDelete(page, item)}><Trash2 size={15} /></button>}</div></td></tr>{page === 'suppliers' && supplierId === item.id && <tr><td colSpan={6}><SupplierCatalog supplier={item} allowEdit={embedded} /></td></tr>}</Fragment>)}{!visible.length && <tr><td colSpan={6}><EmptyRecords loading={loading} error={errors[page]} title={query || status !== 'Todos' || from || to ? 'Sin coincidencias con estos filtros' : 'Todavía no hay registros'} /></td></tr>}</tbody></table></div><div className="ws-pagination"><span>{sorted.length ? current * pageSize + 1 : 0}–{Math.min((current + 1) * pageSize, sorted.length)} de {sorted.length} registros</span><label>Filas<select value={pageSize} onChange={event => setPageSize(Number(event.target.value))} aria-label="Filas por página"><option>10</option><option>25</option><option>50</option></select></label><div><button className="ws-icon-button" aria-label="Página anterior" disabled={!current} onClick={() => setPageIndex(current - 1)}><ChevronLeft size={16} /></button><span>{current + 1} / {pageCount}</span><button className="ws-icon-button" aria-label="Página siguiente" disabled={current + 1 >= pageCount} onClick={() => setPageIndex(current + 1)}><ChevronRight size={16} /></button></div></div></section>
      <aside className="ws-module-aside"><section className="ws-card"><h2 className="ws-summary-title"><ClipboardList size={15} />Resumen de la consulta</h2><div className="ws-summary-list">{summary.map(([label, value]) => <div key={label}><small>{label}</small><strong>{loading ? '—' : errors[page] ? 'No disponible' : value}</strong></div>)}</div></section>{can('finance') && <section className="ws-card"><h2 className="ws-summary-title"><Wallet size={15} />Situación financiera</h2><div className="ws-summary-list"><div><small>Por cobrar</small><strong>{errors.finance ? 'No disponible' : money(finance.receivable)}</strong></div><div><small>Por pagar</small><strong>{errors.finance ? 'No disponible' : money(finance.payable)}</strong></div></div></section>}<div className="ws-source-note"><Info size={15} /><span>Los filtros, los totales y la exportación usan los mismos registros de Supabase. {page === 'inventory' ? 'La valorización utiliza el precio de venta, no el costo de adquisición.' : page === 'purchases' ? 'El ingreso de stock ocurre en Recepción; la cuenta por pagar incluye IGV.' : page === 'finance' ? 'Completar una cuenta registra su cancelación total.' : 'Los cambios se conservan al volver a iniciar sesión.'}</span></div>{embedded && allowCreate !== false && can(page, 'crear') && <button className="primary-button" onClick={() => openComposer(page)}><Plus size={16} />{meta.action}</button>}</aside></div>}
    {quote && <ConfirmModal title="Convertir cotización en venta" message={`${quote.id}: se creará una venta, se actualizará el stock y se generará la cuenta por cobrar correspondiente.`} confirmLabel="Convertir en venta" busy={saving} onCancel={() => setQuote(null)} onConfirm={async () => { await convertQuote(quote.id); setQuote(null) }} />}
    {account && <ConfirmModal title={account.financeType === 'pagar' ? 'Registrar pago' : 'Registrar cobro'} message={`Registrar la cancelación total de ${account.id} por ${money(account.amount)}. La cuenta quedará completada en Supabase y la operación vinculada también.`} confirmLabel="Registrar cancelación" busy={saving} onCancel={() => setAccount(null)} onConfirm={async () => { await settleAccount(account, payMedio); setAccount(null) }}><label className="ws-confirm-field">Medio de pago<select value={payMedio} onChange={(event) => setPayMedio(event.target.value)} aria-label="Medio de pago">{payMethods.map((method) => <option key={method} value={method}>{method}</option>)}</select></label></ConfirmModal>}
    {voucher && (page === 'sales' || page === 'purchases') && <VoucherModal page={page} record={voucher} onClose={() => setVoucher(null)} />}
  </>
}

function SortHeading({ label, onClick }: { label: string; onClick: () => void }) { return <button className="ws-sort-button" onClick={onClick}>{label}<ArrowDownUp size={11} /></button> }
function DateFilters({ from, to, onChange }: { from: string; to: string; onChange: (key: string, value: string) => void }) { return <div className="ws-filter-date"><input type="date" value={from} onChange={event => onChange('from', event.target.value)} aria-label="Fecha inicial" /><span>→</span><input type="date" value={to} onChange={event => onChange('to', event.target.value)} aria-label="Fecha final" /></div> }
function EmptyRecords({ loading, error, title }: { loading: boolean; error?: string; title: string }) { return <div className="ws-empty-compact">{error ? <AlertTriangle size={26} /> : <Search size={26} />}<strong>{loading ? 'Consultando Supabase…' : error ? 'No se pudieron cargar los registros' : title}</strong><span>{error || 'Ajusta los filtros o registra una nueva operación.'}</span></div> }
function ShieldNotice() { return <Info size={28} /> }
