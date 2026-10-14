import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, ArrowDownLeft, ArrowRight, ArrowUpRight, Boxes, CalendarDays, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ClipboardList, Download, Eye, FileText, PackageCheck, Plus, ReceiptText, Search, ShoppingCart, TrendingUp, Wallet } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useRecords } from '../../context/RecordsContext'
import { financialSnapshot, totalAmount } from '../../data/dashboard'
import { isStockAlert, money, statusTone } from '../../data/helpers'
import { businessDate, dailyOperations, displayDate, inDateRange, matchesSearch, periodRange, shiftDate, type Period } from '../../data/workspace'
import { readCompanyProfile } from '../../services/company'
import { exportExecutiveDashboard } from '../../services/dashboardReport'
import type { DataPage, ExportFormat, RecordItem } from '../../types'

function OperationsChart({ sales, purchases, period }: { sales: RecordItem[]; purchases: RecordItem[]; period: Period }) {
  const { can } = useAuth()
  const showSales = can('sales'), showPurchases = can('purchases')
  const { buckets, interval } = useMemo(() => dailyOperations(sales, purchases, periodRange(period)), [sales, purchases, period])
  const [selected, setSelected] = useState<number | null>(null)
  const maximum = Math.max(1, ...buckets.flatMap(bucket => [bucket.sales, bucket.purchases]))
  const ceiling = maximum > 1 ? Math.ceil(maximum / 4 / 10 ** Math.floor(Math.log10(maximum / 4))) * 4 * 10 ** Math.floor(Math.log10(maximum / 4)) : 100
  const x = (index: number) => buckets.length === 1 ? 360 : 54 + index / (buckets.length - 1) * 622
  const y = (value: number) => 205 - value / ceiling * 170
  const path = (kind: 'sales' | 'purchases') => buckets.map((bucket, index) => `${index ? 'L' : 'M'} ${x(index)} ${y(bucket[kind])}`).join(' ')
  const active = selected !== null ? buckets[selected] : undefined
  const compact = (value: number) => new Intl.NumberFormat('es-PE', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
  const label = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString('es-PE', { day: '2-digit', month: 'short' })
  const hasData = [...sales, ...purchases].some(item => item.createdAt && inDateRange(item, periodRange(period)))
  if (!hasData) return <div className="ws-chart-empty"><TrendingUp size={32} /><strong>Tu actividad empieza con una operación</strong><span>El gráfico se construye con las fechas y los importes de tus registros.</span></div>
  return <div className="ws-chart-wrap"><svg className="ws-operations-chart" viewBox="0 0 710 245" role="img" aria-label="Evolución de ventas y compras según los registros de Supabase">
    <defs><linearGradient id="workspace-chart-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--ws-primary)" stopOpacity=".17" /><stop offset="100%" stopColor="var(--ws-primary)" stopOpacity=".01" /></linearGradient></defs>
    {[0, 1, 2, 3, 4].map(index => <g key={index}><line x1="54" x2="676" y1={y(ceiling * index / 4)} y2={y(ceiling * index / 4)} className="ws-chart-grid" /><text x="44" y={y(ceiling * index / 4) + 4} textAnchor="end">{compact(ceiling * index / 4)}</text></g>)}
    {showSales && <path d={`${path('sales')} L ${x(buckets.length - 1)} 205 L ${x(0)} 205 Z`} fill="url(#workspace-chart-fill)" />}
    {showPurchases && <path d={path('purchases')} className="ws-chart-purchases" />}{showSales && <path d={path('sales')} className="ws-chart-sales" />}
    {buckets.map((bucket, index) => <g key={bucket.date}>{(index === 0 || index === buckets.length - 1 || index % Math.max(1, Math.ceil(buckets.length / 7)) === 0) && <text x={x(index)} y="233" textAnchor="middle">{label(bucket.date)}</text>}<circle cx={x(index)} cy={y(bucket.sales)} r={selected === index ? 5 : 3} className="ws-chart-point" tabIndex={0} role="button" aria-label={`${label(bucket.date)}: ventas ${money(bucket.sales)}, compras ${money(bucket.purchases)}`} onMouseEnter={() => setSelected(index)} onFocus={() => setSelected(index)} onClick={() => setSelected(index)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelected(index) } }} /></g>)}
  </svg><div className="ws-chart-detail" aria-live="polite">{active ? <><strong>{label(active.date)}{interval > 1 ? ` · ${interval} días` : ''}</strong><span><i className="sales" />Ventas {money(active.sales)}</span><span><i className="purchases" />Compras {money(active.purchases)}</span></> : <span>Explora un punto para consultar los importes{interval > 1 ? ` · Agrupación cada ${interval} días` : ' diarios'}.</span>}</div></div>
}

export default function DashboardOverview() {
  const { profile, can } = useAuth()
  const { records, loading, errors: queryErrors, openComposer, exportTable, notify } = useRecords()
  const errors: Partial<Record<DataPage, string>> = { ...queryErrors }
  for (const page of ['sales', 'purchases', 'inventory'] as const) if (!can(page)) errors[page] = 'Tu rol no tiene permiso para consultar este módulo.'
  const navigate = useNavigate()
  const [period, setPeriod] = useState<Period>('all')
  const [requestedActivity, setActivity] = useState<'sales' | 'purchases' | 'quotes'>('sales')
  const allowedActivities = (['sales', 'purchases', 'quotes'] as const).filter(key => can(key))
  const activity = allowedActivities.find(key => key === requestedActivity) ?? allowedActivities[0] ?? 'sales'
  const activeActivity = activity
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const range = periodRange(period)
  const sales = records.sales.filter(item => inDateRange(item, range))
  const purchases = records.purchases.filter(item => inDateRange(item, range))
  const accounts = financialSnapshot(records.finance)
  const stockAlerts = records.inventory.filter(isStockAlert)
  const units = records.inventory.reduce((sum, item) => sum + (item.quantity ?? 0), 0)
  const salesTotal = totalAmount(sales)
  const purchasesTotal = totalAmount(purchases)
  const margin = Math.round((salesTotal - purchasesTotal) * 100) / 100
  const marginRate = salesTotal > 0 ? Math.round(margin / salesTotal * 1000) / 10 : null
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches'
  const today = businessDate(new Date())
  const overdue = accounts.open.filter(item => item.dueAt && item.dueAt < today)
  const activities = records[activeActivity].filter(item => inDateRange(item, range) && matchesSearch(item, query))
  const pages = Math.max(1, Math.ceil(activities.length / 5))
  const currentPage = Math.min(page, pages - 1)
  const visible = activities.slice(currentPage * 5, currentPage * 5 + 5)
  const periodLabel = period === 'all' ? 'Todos los registros' : `${displayDate(`${range.from}T12:00:00Z`)} – ${displayDate(`${range.to}T12:00:00Z`)}`
  useEffect(() => setPage(0), [period, activeActivity, query])
  // Ventas del período ordenadas (recientes primero) para CSV y Excel.
  const orderedSales = useMemo(
    () => [...sales].sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')) || String(b.id).localeCompare(String(a.id), 'es', { numeric: true })),
    [sales],
  )
  const [exportOpen, setExportOpen] = useState(false)
  const [exportingPdf, setExportingPdf] = useState(false)
  useEffect(() => {
    if (!exportOpen) return
    const close = (event: MouseEvent) => { if (!(event.target as HTMLElement)?.closest('.export-wrap')) setExportOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setExportOpen(false) }
    document.addEventListener('mousedown', close); document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', escape) }
  }, [exportOpen])
  const chooseFormat = (format: ExportFormat) => {
    setExportOpen(false)
    if (exportingPdf) return
    if (format !== 'pdf') {
      exportTable('sales', format, orderedSales)
      return
    }
    setExportingPdf(true)
    const optionalSources = [
      { page: 'purchases' as const, label: 'Compras' },
      { page: 'inventory' as const, label: 'Inventario' },
      { page: 'finance' as const, label: 'Finanzas' },
    ]
    void exportExecutiveDashboard({
      sales: records.sales,
      purchases: can('purchases') && !queryErrors.purchases ? records.purchases : undefined,
      inventory: can('inventory') && !queryErrors.inventory ? records.inventory : undefined,
      finance: can('finance') && !queryErrors.finance ? records.finance : undefined,
      range,
      periodLabel,
      company: readCompanyProfile(records.settings),
      author: profile?.nombre,
      dataNotes: optionalSources.filter(source => can(source.page) && queryErrors[source.page]).map(source => source.label),
    }).then(() => notify('Dashboard ejecutivo preparado. Selecciona Guardar como PDF en la ventana de impresión.'))
      .catch(error => notify(error instanceof Error ? error.message : 'No se pudo preparar el informe ejecutivo.'))
      .finally(() => setExportingPdf(false))
  }

  const change = (items: RecordItem[]) => {
    if (!range.from || !range.to) return null
    const days = Math.round((Date.parse(range.to) - Date.parse(range.from)) / 86400000) + 1
    const previous = totalAmount(items.filter(item => inDateRange(item, { from: shiftDate(range.from, -days), to: shiftDate(range.from, -1) })))
    const current = totalAmount(items.filter(item => inDateRange(item, range)))
    return previous ? Math.round((current - previous) / previous * 1000) / 10 : null
  }
  const metricValue = (source: DataPage, value: string) => loading ? '—' : errors[source] ? 'No disponible' : value
  const metrics = [
    { page: 'sales' as DataPage, label: 'Ventas registradas', value: metricValue('sales', money(totalAmount(sales))), detail: `${sales.length} ${sales.length === 1 ? 'venta' : 'ventas'} en el período`, icon: Wallet, color: 'blue', trend: change(records.sales) },
    { page: 'purchases' as DataPage, label: 'Compras registradas', value: metricValue('purchases', money(totalAmount(purchases))), detail: `${purchases.length} ${purchases.length === 1 ? 'orden' : 'órdenes'} · subtotal sin IGV`, icon: ShoppingCart, color: 'green', trend: change(records.purchases) },
    { page: 'inventory' as DataPage, label: 'Productos en inventario', value: metricValue('inventory', records.inventory.length.toLocaleString('es-PE')), detail: `${units.toLocaleString('es-PE')} unidades registradas`, icon: Boxes, color: 'slate', trend: null },
    { page: 'sales' as DataPage, label: 'Margen del período', value: loading ? '—' : errors.sales || errors.purchases ? 'No disponible' : money(margin), detail: marginRate === null ? 'Sin ventas en el período' : `${marginRate}% sobre ventas · Ventas menos compras`, icon: TrendingUp, color: margin < 0 ? 'amber' : 'green', trend: null },
  ].filter(metric => can(metric.page))
  const quickActions = [
    { page: 'sales' as DataPage, label: 'Registrar una venta', icon: Plus, color: 'blue' },
    { page: 'purchases' as DataPage, label: 'Nueva orden de compra', icon: ShoppingCart, color: 'green' },
    { page: 'quotes' as DataPage, label: 'Preparar una cotización', icon: ClipboardList, color: 'violet' },
    { page: 'inventory' as DataPage, label: 'Agregar un producto', icon: Boxes, color: 'amber' },
  ].filter(action => can(action.page, 'crear'))

  return <div className="enterprise-dashboard">
    <section className="ws-page-heading">
      <div><span className="ws-eyebrow">VISIÓN GENERAL</span><h2>Panel de control</h2><p>{greeting}, {profile?.nombre.split(' ')[0]}. Este es el resumen de tu operación.</p></div>
      <div className="ws-heading-actions">
        <label className="ws-period"><CalendarDays size={16} /><select value={period} onChange={event => setPeriod(event.target.value as Period)} aria-label="Período del resumen"><option value="all">Todos los registros</option><option value="month">Este mes</option><option value="30">Últimos 30 días</option><option value="7">Últimos 7 días</option><option value="today">Hoy</option></select></label>
        {can('sales') && <div className="export-wrap">
          <button className="ws-button ws-button-secondary" aria-haspopup="menu" aria-expanded={exportOpen} disabled={loading || Boolean(errors.sales) || exportingPdf} onClick={() => setExportOpen(value => !value)}><Download size={16} />{exportingPdf ? 'Preparando PDF…' : 'Exportar'}<ChevronDown size={13} /></button>
          {exportOpen && <div className="export-menu open" role="menu" aria-label="Formatos de exportación">
            <button role="menuitem" onClick={() => chooseFormat('csv')}><FileText size={14} />CSV · datos ordenados</button>
            <button role="menuitem" onClick={() => chooseFormat('excel')}><FileText size={14} />Excel · datos ordenados</button>
            <button role="menuitem" onClick={() => chooseFormat('pdf')}><FileText size={14} />PDF · dashboard ejecutivo</button>
          </div>}
        </div>}
      </div>
    </section>

    <section className={`ws-metrics${loading ? ' is-loading' : ''}`} aria-label="Indicadores de Supabase">{metrics.map(metric => <button className="ws-metric" key={metric.label} onClick={() => navigate(`/${metric.page}`)}><div className="ws-metric-top"><span>{metric.label}</span><span className={`ws-soft-icon ${metric.color}`}><metric.icon size={19} /></span></div><strong>{metric.value}</strong><div className="ws-metric-foot">{metric.trend !== null && <span className={`ws-badge ${metric.trend < 0 ? 'amber' : 'green'}`}>{metric.trend > 0 ? '+' : ''}{metric.trend}% vs período anterior</span>}<span>{loading ? 'Consultando base de datos…' : metric.detail}</span></div></button>)}</section>

    <div className="ws-dashboard-grid"><section className="ws-card ws-chart-card"><div className="ws-card-heading"><div><h2>Ventas y compras</h2><p>Evolución de tus operaciones · {periodLabel}</p></div><div className="ws-chart-legend"><span><i />Ventas</span><span><i className="purchases" />Compras</span></div></div>{loading ? <div className="ws-chart-empty ws-skeleton" /> : <OperationsChart sales={records.sales} purchases={records.purchases} period={period} />}<div className="ws-chart-totals"><span>Ventas <strong>{errors.sales ? 'No disponible' : money(totalAmount(sales))}</strong></span><span>Compras <strong>{errors.purchases ? 'No disponible' : money(totalAmount(purchases))}</strong></span><span>Margen <strong className={margin < 0 ? 'margin-down' : 'margin-up'}>{errors.sales || errors.purchases ? 'No disponible' : money(margin)}</strong></span><span className="ws-real-data"><i />Datos de Supabase</span></div></section>
      <section className="ws-card ws-alert-card"><div className="ws-card-heading"><div><h2>Alertas de inventario</h2><p>Productos que requieren atención</p></div><span className={`ws-badge ${stockAlerts.length ? 'amber' : 'green'}`}>{stockAlerts.length} alertas</span></div><div className="ws-stock-alerts">{stockAlerts.slice(0, 4).map(item => <button key={item.id} onClick={() => navigate(`/inventory?q=${encodeURIComponent(item.id)}`)}><span className="ws-soft-icon slate"><Boxes size={19} /></span><span className="ws-alert-copy"><strong>{item.name}</strong><small>{item.id}</small></span><span className="ws-alert-quantity"><strong>{item.quantity ?? 0} und.</strong><small>{item.status}</small></span></button>)}{!stockAlerts.length && <div className="ws-empty-compact"><CheckCircle2 size={28} /><strong>{loading ? 'Consultando inventario…' : errors.inventory ? 'Inventario no disponible' : 'Inventario sin alertas registradas'}</strong><span>{errors.inventory || 'Los estados se consultan directamente de tus productos.'}</span></div>}</div><button className="ws-card-link" onClick={() => navigate('/inventory')}><AlertTriangle size={14} /><span>Revisar disponibilidad y reposición</span><ArrowRight size={16} /></button></section>
    </div>

    <div className="ws-dashboard-bottom"><section className="ws-card"><div className="ws-card-heading"><div><h2>Operaciones recientes</h2><p>El detalle detrás de cada movimiento</p></div><button className="ws-text-button" onClick={() => navigate(`/${activity}`)}>Ver todas<ArrowUpRight size={15} /></button></div><div className="ws-activity-toolbar"><div className="ws-tabs" role="tablist" aria-label="Tipo de operación">{(['sales', 'purchases', 'quotes'] as const).filter(key => can(key)).map(key => <button key={key} role="tab" aria-selected={activity === key} onClick={() => setActivity(key)}>{key === 'sales' ? 'Ventas' : key === 'purchases' ? 'Compras' : 'Cotizaciones'}</button>)}</div><label className="ws-table-search"><Search size={16} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar referencia o contraparte…" aria-label="Buscar operaciones recientes" /></label></div><div className="table-scroll"><table className="record-table ws-record-table"><thead><tr><th>Referencia</th><th>Cliente / proveedor</th><th>Fecha</th><th className="ws-align-right">Importe</th><th>Estado</th><th><span className="sr-only">Detalle</span></th></tr></thead><tbody>{visible.map(item => <tr key={item.id}><td><span className="record-id">{item.id}</span></td><td><strong>{item.name}</strong><small>{item.detail}</small></td><td>{displayDate(item.createdAt)}</td><td className="ws-align-right ws-amount">{money(item.amount)}</td><td><span className={`status-pill ${statusTone(item.status)}`}>{item.status}</span></td><td><button className="ws-icon-button" aria-label={`Ver ${item.id}`} onClick={() => navigate(`/${activity}?q=${encodeURIComponent(item.id)}`)}><Eye size={16} /></button></td></tr>)}{!visible.length && <tr><td colSpan={6}><div className="ws-empty-compact"><ReceiptText size={26} /><strong>{loading ? 'Cargando operaciones…' : errors[activity] ? 'No se pudieron consultar las operaciones' : query ? 'Sin coincidencias' : 'No hay operaciones en este período'}</strong><span>{errors[activity] || 'Selecciona otro período o registra una operación.'}</span></div></td></tr>}</tbody></table></div><div className="ws-pagination"><span>{activities.length ? currentPage * 5 + 1 : 0}–{Math.min((currentPage + 1) * 5, activities.length)} de {activities.length} registros</span><div><button className="ws-icon-button" disabled={!currentPage} onClick={() => setPage(currentPage - 1)} aria-label="Página anterior"><ChevronLeft size={16} /></button><span>{currentPage + 1} / {pages}</span><button className="ws-icon-button" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)} aria-label="Página siguiente"><ChevronRight size={16} /></button></div></div></section>
      <section className="ws-card ws-quick-actions"><div className="ws-card-heading"><div><h2>Accesos rápidos</h2><p>Conecta cada parte de tu negocio</p></div></div>{quickActions.map(action => <button key={action.page} onClick={() => openComposer(action.page)}><span className={`ws-soft-icon ${action.color}`}><action.icon size={18} /></span><span>{action.label}</span><ArrowRight size={16} /></button>)}{can('purchases') && <button onClick={() => navigate('/ingreso-kardex')}><span className="ws-soft-icon green"><PackageCheck size={18} /></span><span>Ingreso al Kardex</span><ArrowRight size={16} /></button>}<div className="ws-quick-foot"><ShieldIcon />Operaciones guardadas en la nube</div></section>
    </div>

    {can('finance') && <section className="ws-financial-overview"><div className="ws-section-heading"><div><h2>Tu situación financiera</h2><p>Saldos actuales de las cuentas registradas, independientes del filtro de ventas.</p></div><button className="ws-text-button" onClick={() => navigate('/finance')}>Abrir tesorería<ArrowRight size={15} /></button></div><div className="ws-financial-grid">{[{ label: 'Por cobrar', amount: accounts.receivable, detail: `${accounts.receivables.length} cuentas abiertas`, icon: ArrowDownLeft, color: 'blue' }, { label: 'Por pagar', amount: accounts.payable, detail: `${accounts.payables.length} obligaciones`, icon: ArrowUpRight, color: 'amber' }, { label: 'Cobrado registrado', amount: accounts.cajaIngresos, detail: 'Cuentas por cobrar completadas', icon: Wallet, color: 'green' }, { label: 'Pagado registrado', amount: accounts.cajaEgresos, detail: 'Cuentas por pagar completadas', icon: Wallet, color: 'slate' }].map(metric => <article className="ws-card ws-finance-metric" key={metric.label}><span className={`ws-soft-icon ${metric.color}`}><metric.icon size={18} /></span><div><small>{metric.label}</small><strong>{loading ? '—' : errors.finance ? 'No disponible' : money(metric.amount)}</strong><span>{metric.detail}</span></div></article>)}</div>{overdue.length > 0 && <div className="ws-notice ws-notice-warning"><AlertTriangle size={18} /><span>{overdue.length} cuentas abiertas tienen su fecha de vencimiento superada.</span><button className="ws-text-button" onClick={() => navigate('/finance')}>Revisar cuentas</button></div>}</section>}
  </div>
}

function ShieldIcon() { return <CheckCircle2 size={14} /> }
