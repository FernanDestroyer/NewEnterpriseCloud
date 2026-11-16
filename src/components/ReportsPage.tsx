import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowRight, Boxes, Calculator, Download, FileText, PackageCheck, RefreshCw, ShoppingCart, TrendingUp, Wallet } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useRecords } from '../context/RecordsContext'
import { loadInventoryPepsValuation } from '../services/inventoryQueries'
import type { PepsValuationSnapshot } from '../data/inventoryPeps'
import { businessDate, inDateRange } from '../data/workspace'
import { money, moneyCurrency } from '../data/helpers'
import { financialSnapshot, amountByCurrencyLabel } from '../data/dashboard'
import { buildTreasuryMovementReport, treasuryMovementCsvRows } from '../data/treasuryReport'
import type { TreasuryMovementReport } from '../data/treasuryReport'
import { fetchTreasuryMovementReport } from '../services/treasuryReport'
import { fetchInventoryKardexReport } from '../services/inventoryReport'
import { loadInventoryWarehouses, type InventoryWarehouse } from '../services/inventoryQueries'
import { buildInventoryKardexReport, inventoryKardexCsvRows, type InventoryKardexReport } from '../data/inventoryReport'
import { downloadCsv } from '../data/exports'
import ModuloPage, { type ModuleView } from '../pages/ModuloPage'
import type { DataPage } from '../types'
import { PageHeader } from './ui/PageHeader'

function PepsValuationDetail({ snapshot, products, pending, errorText }: {
  snapshot: PepsValuationSnapshot | null
  products: Array<{ rowId?: string; id: string; name: string }>
  pending: boolean
  errorText: string
}) {
  if (errorText) return <div className="ws-notice ws-notice-warning" role="alert">{errorText}</div>
  if (pending) return <div className="ws-empty-compact"><strong>Conciliando Kardex PEPS con existencias…</strong></div>
  if (!snapshot?.ubicaciones.length) return <div className="ws-empty-compact"><strong>Sin existencias físicas positivas para valorizar.</strong></div>
  const productsById = new Map(products.flatMap(product => product.rowId ? [[product.rowId, product] as const] : []))
  const issueText = {
    'sin-kardex': 'Sin movimiento valorizado',
    'fechas-empatadas': 'Movimientos simultáneos; orden no verificable',
    'stock-no-coincide': 'El saldo del Kardex no coincide con existencias',
    'sin-costo': 'El Kardex no tiene costo PEPS',
  }
  return <div className="ws-card">
    {!snapshot.completo && <div className="ws-notice ws-notice-warning" role="status"><Calculator size={17} /><div><strong>Valorización incompleta</strong><span>{snapshot.ubicaciones_totales - snapshot.ubicaciones_valorizadas} de {snapshot.ubicaciones_totales} ubicaciones requieren conciliación. No se muestra un total parcial como si fuera el valor completo del inventario.</span></div></div>}
    <div className="table-scroll"><table className="record-table"><thead><tr><th>Producto</th><th>Almacén</th><th className="ws-align-right">Stock físico</th><th className="ws-align-right">Saldo PEPS</th></tr></thead><tbody>{snapshot.ubicaciones.map(row => {
      const product = productsById.get(row.producto_id)
      return <tr key={`${row.producto_id}:${row.almacen_id}`}><td><strong>{product?.name ?? 'Producto no disponible'}</strong><small>{product?.id ?? row.producto_id.slice(0, 8)}</small></td><td>{row.almacen_nombre}</td><td className="ws-align-right">{row.stock}</td><td className="ws-align-right ws-amount">{row.problema ? <span className="ws-badge amber">{issueText[row.problema]}</span> : money(row.valor_peps ?? 0)}</td></tr>
    })}</tbody></table></div>
    <div className="ws-card-heading"><div><h2>{snapshot.completo ? 'Valor PEPS total' : 'Ubicaciones conciliadas'}</h2><p>El saldo PEPS incluye existencias físicas reservadas.</p></div><strong>{snapshot.completo ? money(snapshot.valor_total ?? 0) : `${snapshot.ubicaciones_valorizadas} / ${snapshot.ubicaciones_totales}`}</strong></div>
  </div>
}

function TreasuryMovementDetail({ report, pending, errorText }: {
  report: TreasuryMovementReport | null
  pending: boolean
  errorText: string
}) {
  if (errorText) return <div className="ws-notice ws-notice-warning" role="alert">{errorText}</div>
  if (pending) return <div className="ws-empty-compact"><strong>Consultando cobros y pagos de Tesorería…</strong></div>
  if (!report) return <div className="ws-empty-compact"><strong>No hay un reporte disponible.</strong></div>
  if (!report.complete || !report.counts) {
    const limitExceeded = report.totalCount !== null && report.totalCount > 10_000
    return <div className="ws-notice ws-notice-warning" role="status"><Calculator size={17} /><div>
      <strong>{limitExceeded ? 'El período supera el límite de consulta' : 'No se pudo confirmar el conjunto completo'}</strong>
      <span>{limitExceeded
        ? `Se encontraron ${report.totalCount} movimientos. Acota las fechas para consultar un conjunto completo.`
        : `Se leyeron ${report.rows.length} de ${report.totalCount ?? 'un total no confirmado'} movimientos. No se mostrarán conteos ni exportaciones parciales; vuelve a consultar el reporte.`}</span>
    </div></div>
  }
  if (report.totalCount === 0) return <div className="ws-empty-compact"><Wallet size={25} /><strong>Sin cobros ni pagos en este período.</strong></div>
  return <div className="ws-card">
    <div className="ws-report-grid">
      <article className="ws-card ws-report-card"><h3>Cobros</h3><strong>{report.counts.cobros}</strong><p>Movimientos no anulados</p></article>
      <article className="ws-card ws-report-card"><h3>Pagos</h3><strong>{report.counts.pagos}</strong><p>Movimientos no anulados</p></article>
      <article className="ws-card ws-report-card"><h3>Movimientos anulados</h3><strong>{report.counts.anulados}</strong><p>Excluidos del conteo activo</p></article>
    </div>
    {report.counts.monedaDesconocida > 0 && <div className="ws-notice ws-notice-warning" role="note"><strong>Importes sin moneda conciliada</strong><span>{report.counts.monedaDesconocida} movimientos activos se excluyen de los totales monetarios. La información debe revisarse antes de usarla en un indicador.</span></div>}
    <div className="ws-section-heading"><div><h3>Importes por moneda</h3><p>{report.dateLabel} · Cobros menos pagos dentro de cada moneda; no se convierten ni mezclan.</p></div></div>
    {report.counts.porMoneda.length ? <div className="ws-report-grid">{report.counts.porMoneda.map(row => <article className="ws-card ws-report-card" key={row.moneda}><h3>{row.moneda}</h3><p>{row.cantidad} movimientos conciliados</p><strong>{moneyCurrency(row.neto, row.moneda)}</strong><small>Cobros {moneyCurrency(row.cobros, row.moneda)} · Pagos {moneyCurrency(row.pagos, row.moneda)}</small></article>)}</div> : <div className="ws-empty-compact"><strong>Sin movimientos con moneda conciliada en este período.</strong></div>}
    <div className="ws-section-heading"><div><h3>Por medio de pago</h3><p>{report.dateLabel} · Conteo por fecha de registro</p></div></div>
    <div className="table-scroll"><table className="record-table"><thead><tr><th>Medio</th><th className="ws-align-right">Cobros (cant.)</th><th className="ws-align-right">Pagos (cant.)</th><th className="ws-align-right">Movimientos</th></tr></thead><tbody>{report.counts.porMedio.map(row => <tr key={row.metodo}><td>{row.metodo}</td><td className="ws-align-right">{row.cobros}</td><td className="ws-align-right">{row.pagos}</td><td className="ws-align-right">{row.cantidad}</td></tr>)}</tbody></table></div>
    <div className="ws-section-heading"><div><h3>Movimientos recientes</h3><p>{report.muestra.length < report.totalCount ? `Mostrando los últimos ${report.muestra.length} de ${report.totalCount}.` : `${report.totalCount} movimientos en el período.`} · La moneda se deriva de las cuentas aplicadas.</p></div></div>
    <div className="table-scroll"><table className="record-table"><thead><tr><th>Fecha</th><th>Tipo</th><th>Referencia</th><th>Medio</th><th>Moneda</th><th className="ws-align-right">Importe</th><th>Estado</th></tr></thead><tbody>{report.muestra.map(row => <tr key={row.id}><td>{new Date(row.created_at).toLocaleString('es-PE')}</td><td>{row.tipo === 'cobro' ? 'Cobro' : 'Pago'}</td><td>{row.referencia || row.codigo}</td><td>{row.medio_pago || 'Sin medio'}</td><td>{row.moneda ?? 'Sin conciliar'}</td><td className="ws-align-right ws-amount">{row.moneda ? moneyCurrency(Number(row.monto), row.moneda) : Number(row.monto).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td><td>{row.anulado_en ? 'Anulado' : 'Aplicado'}</td></tr>)}</tbody></table></div>
  </div>
}

function InventoryKardexDetail({ report, pending, errorText, products, warehouses }: {
  report: InventoryKardexReport | null
  pending: boolean
  errorText: string
  products: Array<{ rowId?: string; id: string; name: string }>
  warehouses: InventoryWarehouse[]
}) {
  if (errorText) return <div className="ws-notice ws-notice-warning" role="alert">{errorText}</div>
  if (pending) return <div className="ws-empty-compact" role="status"><RefreshCw size={20} className="ws-spin" /><strong>Consultando Kardex del módulo Inventario…</strong></div>
  if (!report) return <div className="ws-empty-compact"><strong>No hay un reporte disponible.</strong></div>
  if (!report.complete || report.totalCount === null) {
    const limitExceeded = report.totalCount !== null && report.totalCount > 10_000
    return <div className="ws-notice ws-notice-warning" role="status"><Calculator size={17} /><div>
      <strong>{limitExceeded ? 'El período supera el límite de consulta' : 'No se pudo confirmar el conjunto completo'}</strong>
      <span>{limitExceeded
        ? `Se encontraron ${report.totalCount} movimientos. Acota las fechas para consultar un conjunto completo.`
        : `Se leyeron ${report.rows.length} de ${report.totalCount ?? 'un total no confirmado'} movimientos. No se mostrarán resúmenes ni exportaciones parciales; vuelve a consultar el reporte.`}</span>
    </div></div>
  }
  if (report.totalCount === 0) return <div className="ws-empty-compact"><PackageCheck size={23} /><strong>Sin movimientos de Kardex en este período.</strong></div>
  const productNames = new Map(products.flatMap(item => item.rowId ? [[item.rowId, item] as const] : []))
  const warehouseNames = new Map(warehouses.map(item => [item.id, item.nombre]))
  return <div className="ws-card">
    <div className="ws-report-grid">
      <article className="ws-card ws-report-card"><h3>Movimientos conciliados</h3><strong>{report.totalCount}</strong><p>Conjunto completo de ec_consultar_kardex</p></article>
      {(report.countsByType ?? []).map(item => <article className="ws-card ws-report-card" key={item.tipo}><h3>{item.tipo}</h3><strong>{item.cantidad}</strong><p>Movimientos del período</p></article>)}
    </div>
    <div className="ws-section-heading"><div><h3>Movimientos recientes</h3><p>{report.muestra.length < report.totalCount ? `Mostrando los últimos ${report.muestra.length} de ${report.totalCount}.` : `${report.totalCount} movimientos en el período.`} · Fecha del movimiento en hora de Perú.</p></div></div>
    <div className="table-scroll"><table className="record-table"><thead><tr><th>Fecha</th><th>Producto / almacén</th><th>Tipo / referencia</th><th className="ws-align-right">Cantidad</th><th className="ws-align-right">Antes</th><th className="ws-align-right">Después</th><th className="ws-align-right">PEPS</th><th className="ws-align-right">Promedio</th></tr></thead><tbody>{report.muestra.map(row => {
      const product = row.producto_id ? productNames.get(row.producto_id) : undefined
      const warehouseName = row.almacen_id ? warehouseNames.get(row.almacen_id) : undefined
      return <tr key={row.movimiento_id}>
        <td>{new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', dateStyle: 'short', timeStyle: 'short' }).format(new Date(row.fecha))}</td>
        <td><strong>{product?.name ?? row.producto_id ?? 'Producto no disponible'}</strong><small>{warehouseName ?? row.almacen_id ?? 'Sin almacén'}</small></td>
        <td>{row.tipo}<small>{row.referencia || 'Sin referencia'}{row.motivo ? ` · ${row.motivo}` : ''}</small></td>
        <td className="ws-align-right">{row.cantidad}</td><td className="ws-align-right">{row.stock_anterior ?? '—'}</td><td className="ws-align-right">{row.stock_nuevo ?? '—'}</td>
        <td className="ws-align-right">{row.costo_peps == null ? 'Sin valorizar' : money(Number(row.costo_peps))}</td><td className="ws-align-right">{row.costo_promedio == null ? 'Sin valorizar' : money(Number(row.costo_promedio))}</td>
      </tr>
    })}</tbody></table></div>
  </div>
}

export default function ReportsPage() {
  const { records, loading, errors } = useRecords()
  const { can } = useAuth()
  const [params, setParams] = useSearchParams()
  const [selected, setSelected] = useState<string | null>(null)
  const [pepsValuation, setPepsValuation] = useState<PepsValuationSnapshot | null>(null)
  const [pepsError, setPepsError] = useState('')
  const [treasuryReport, setTreasuryReport] = useState<TreasuryMovementReport | null>(null)
  const [treasuryLoading, setTreasuryLoading] = useState(false)
  const [treasuryError, setTreasuryError] = useState('')
  const [kardexReport, setKardexReport] = useState<InventoryKardexReport | null>(null)
  const [kardexWarehouses, setKardexWarehouses] = useState<InventoryWarehouse[]>([])
  const [kardexLoading, setKardexLoading] = useState(false)
  const [kardexError, setKardexError] = useState('')
  const canViewFinance = can('finance') && can('reports')
  useEffect(() => {
    if (!can('inventory')) return
    let active = true
    loadInventoryPepsValuation()
      .then((snapshot) => active && setPepsValuation(snapshot))
      .catch(() => active && setPepsError('No se pudo consultar la valorización PEPS de Supabase.'))
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const range = { from: params.get('from') ?? '', to: params.get('to') ?? '' }
  useEffect(() => {
    if (!canViewFinance || (range.from && range.to && range.from > range.to)) {
      setTreasuryReport(null)
      setTreasuryError('')
      setTreasuryLoading(false)
      return
    }
    let active = true
    setTreasuryLoading(true)
    setTreasuryError('')
    fetchTreasuryMovementReport(range)
      .then(source => active && setTreasuryReport(buildTreasuryMovementReport({ ...source, range })))
      .catch(() => active && setTreasuryError('No se pudo consultar el flujo de cobros y pagos con el permiso actual de Tesorería.'))
      .finally(() => active && setTreasuryLoading(false))
    return () => { active = false }
  }, [canViewFinance, range.from, range.to])
  useEffect(() => {
    if (selected !== 'kardex' || !can('inventory') || (range.from && range.to && range.from > range.to)) {
      setKardexReport(null)
      setKardexError('')
      setKardexLoading(false)
      return
    }
    let active = true
    setKardexLoading(true)
    setKardexError('')
    Promise.all([fetchInventoryKardexReport(range), loadInventoryWarehouses()])
      .then(([source, warehouses]) => {
        if (active) {
          setKardexReport(buildInventoryKardexReport({ ...source, range }))
          setKardexWarehouses(warehouses)
        }
      })
      .catch(() => active && setKardexError('No se pudo consultar el Kardex actual de Inventario con el permiso disponible.'))
      .finally(() => active && setKardexLoading(false))
    return () => { active = false }
  }, [can, range.from, range.to, selected])
  const sales = records.sales.filter(item => inDateRange(item, range))
  const purchases = records.purchases.filter(item => inDateRange(item, range))
  // These are current balance reports, not historical snapshots. The date range
  // applies to period activity (sales, purchases and Kardex), not current stock or open accounts.
  const inventory = records.inventory
  const finance = records.finance
  const reports: { id: string; page: DataPage; title: string; detail: string; value: string; icon: typeof TrendingUp; color: string; view?: ModuleView }[] = [
    { id: 'sales', page: 'sales', title: 'Ventas del período', detail: `${sales.length} ventas · separado por moneda`, value: amountByCurrencyLabel(sales), icon: TrendingUp, color: 'blue' },
    { id: 'purchases', page: 'purchases', title: 'Compras por proveedor', detail: `${purchases.length} órdenes · subtotal sin IGV · separado por moneda`, value: amountByCurrencyLabel(purchases), icon: ShoppingCart, color: 'green' },
    { id: 'inventory', page: 'inventory', title: 'Valorización de inventario', detail: 'Existencias actuales × precio de venta', value: money(inventory.reduce((sum, item) => sum + (item.quantity ?? 0) * (item.precio ?? 0), 0)), icon: Boxes, color: 'violet' },
    { id: 'peps', page: 'inventory', title: 'Valorización PEPS actual', detail: pepsValuation ? `${pepsValuation.ubicaciones_valorizadas}/${pepsValuation.ubicaciones_totales} ubicaciones conciliadas` : 'Saldo por almacén; exige coincidencia con el Kardex PEPS', value: pepsValuation ? pepsValuation.completo ? money(pepsValuation.valor_total ?? 0) : 'Incompleto' : pepsError ? 'No disponible' : 'Consultando…', icon: Calculator, color: pepsValuation && !pepsValuation.completo ? 'amber' : 'green' },
    { id: 'finance', page: 'finance', title: 'Cuentas por cobrar', detail: `${financialSnapshot(finance).receivables.length} cuentas abiertas actuales`, value: money(financialSnapshot(finance).receivable), icon: Wallet, color: 'amber', view: 'accounts' },
    { id: 'cashflow', page: 'finance', title: 'Actividad de Tesorería', detail: treasuryReport ? `${treasuryReport.counts?.activos ?? treasuryReport.totalCount ?? 0} movimientos · importes por moneda` : 'Cobros y pagos registrados', value: treasuryReport?.complete && treasuryReport.counts ? `${treasuryReport.counts.activos} movimientos` : treasuryError ? 'No disponible' : treasuryLoading ? 'Consultando…' : '—', icon: Wallet, color: 'green' },
    { id: 'kardex', page: 'inventory', title: 'Movimientos de Kardex', detail: 'Historial de entradas y salidas de stock', value: 'Consultar historial', icon: PackageCheck, color: 'blue', view: 'kardex' },
  ].filter(report => can(report.page as DataPage) && (report.id !== 'cashflow' || canViewFinance)) as typeof reports
  const active = reports.find(report => report.id === selected)
  const exportTreasuryCsv = () => {
    if (!treasuryReport?.complete || !treasuryReport.counts || !treasuryReport.totalCount) return
    const csv = treasuryMovementCsvRows(treasuryReport.rows, treasuryReport.dateLabel, new Date().toISOString())
    downloadCsv('flujo-tesoreria.csv', csv.header, csv.rows)
  }
  const exportKardexCsv = () => {
    if (!kardexReport?.complete || kardexReport.totalCount === null || kardexReport.totalCount === 0) return
    const csv = inventoryKardexCsvRows(kardexReport.rows, kardexReport.dateLabel, new Date().toISOString())
    downloadCsv('kardex-inventario.csv', csv.header, csv.rows)
  }
  const parameter = (key: string, value: string) => setParams(previous => { const next = new URLSearchParams(previous); if (value) next.set(key, value); else next.delete(key); return next }, { replace: true })
  if (!can('reports')) return <div className="ws-card ws-empty-compact"><FileText size={28} /><strong>Tu rol no tiene permiso de reportes.</strong></div>
  return <>
    <PageHeader
      icon={TrendingUp}
      section="Analítica empresarial"
      title="Reportes"
      description="Una visión consistente, calculada sobre tus registros de Supabase."
      actions={<div className="ws-filter-date"><input type="date" value={range.from} onChange={event => parameter('from', event.target.value)} aria-label="Fecha inicial de reportes" /><span>→</span><input type="date" value={range.to} onChange={event => parameter('to', event.target.value)} aria-label="Fecha final de reportes" /></div>}
    />
    {range.from && range.to && range.from > range.to && <div className="ws-notice ws-notice-warning" role="alert">Revisa el intervalo de fechas: la fecha inicial supera la final.</div>}
    <section className="ws-report-grid" aria-label="Reportes disponibles">{reports.map(report => <button key={report.id} className="ws-card ws-report-card" aria-pressed={selected === report.id} onClick={() => { setSelected(report.id); setParams(previous => { const next = new URLSearchParams(previous); next.delete('q'); next.delete('status'); return next }, { replace: true }) }}><span className={`ws-soft-icon ${report.color}`}><report.icon size={21} /></span><h2>{report.title}</h2><p>{report.detail}</p><strong>{report.id === 'cashflow' ? report.value : loading ? 'Consultando…' : errors[report.page] ? 'No disponible' : report.value}</strong><span>{selected === report.id ? 'Reporte seleccionado' : 'Consultar reporte'}<ArrowRight size={15} /></span></button>)}</section>
    {active && <section><div className="ws-section-heading"><div><h2>{active.title}</h2><p>{['inventory', 'peps', 'finance'].includes(active.id) ? 'Resumen y detalle de saldos actuales; no dependen del filtro de período.' : active.id === 'kardex' ? 'Movimientos del RPC activo de Inventario, filtrados por fecha de Perú.' : 'El filtro de fechas se aplica al período mostrado en este detalle.'}</p></div><div className="ws-heading-actions">{active.id === 'cashflow' && treasuryReport?.complete && treasuryReport.totalCount !== null && treasuryReport.totalCount > 0 && <button type="button" className="ws-button ws-button-secondary" onClick={exportTreasuryCsv}><Download size={15} />Descargar CSV</button>}{active.id === 'kardex' && kardexReport?.complete && kardexReport.totalCount !== null && kardexReport.totalCount > 0 && <button type="button" className="ws-button ws-button-secondary" onClick={exportKardexCsv}><Download size={15} />Descargar CSV</button>}<button className="ws-text-button" onClick={() => setSelected(null)}>Cerrar detalle</button></div></div>{active.id === 'peps' ? <PepsValuationDetail snapshot={pepsValuation} products={inventory} pending={!pepsValuation && !pepsError} errorText={pepsError} /> : active.id === 'cashflow' ? <TreasuryMovementDetail report={treasuryReport} pending={treasuryLoading} errorText={treasuryError} /> : active.id === 'kardex' ? <InventoryKardexDetail report={kardexReport} pending={kardexLoading} errorText={kardexError} products={inventory} warehouses={kardexWarehouses} /> : <ModuloPage page={active.page} view={active.view} embedded applyDateRange={!['inventory', 'finance'].includes(active.id)} />}</section>}
    {!active && <section className="ws-card"><div className="ws-card-heading"><div><h2>Cómo se calculan tus reportes</h2><p>Las fórmulas distinguen actividad del período de saldos actuales.</p></div></div><div className="ws-form"><p className="relation-hint">Ventas y compras suman el importe registrado en sus cabeceras por fecha de creación y no excluyen estados automáticamente. Existencias se valorizan con stock actual × precio de venta actual; no representan costo contable. La valorización PEPS compara el último saldo del Kardex de cada producto y almacén con el stock físico: si falta costo, movimiento o coincidencia, se marca incompleta y no se publica un total parcial. Cuentas por cobrar muestran el saldo abierto actual. Tesorería conserva la moneda de las cuentas aplicadas, muestra cobros y pagos por separado en PEN y USD y excluye de sus sumas los movimientos sin moneda conciliada; estos importes operativos no sustituyen un estado contable de flujo de efectivo.</p></div></section>}
  </>
}
