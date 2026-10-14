import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowRight, Boxes, Calculator, FileText, PackageCheck, ShoppingCart, TrendingUp, Wallet } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useRecords } from '../context/RecordsContext'
import { fetchInventoryValuation } from '../services/records'
import { inDateRange } from '../data/workspace'
import { money } from '../data/helpers'
import { financialSnapshot, totalAmount } from '../data/dashboard'
import ModuloPage, { type ModuleView } from './ModuloPage'
import type { DataPage } from '../types'

function ValuationDetail({ rows, total, pending, errorText }: {
  rows: Array<{ key: string; code: string; name: string; stock: number; avg: number; value: number }>
  total: number
  pending: boolean
  errorText: string
}) {
  if (errorText) return <div className="ws-notice ws-notice-warning" role="alert">{errorText}</div>
  if (pending) return <div className="ws-empty-compact"><strong>Calculando costo promedio…</strong></div>
  if (!rows.length) return <div className="ws-empty-compact"><strong>Sin costo registrado</strong><span>Recibe compras para calcular el costo promedio.</span></div>
  return <div className="ws-card"><div className="table-scroll"><table className="record-table"><thead><tr><th>Producto</th><th className="ws-align-right">Stock</th><th className="ws-align-right">Costo prom.</th><th className="ws-align-right">Valor</th></tr></thead><tbody>{rows.map(row => <tr key={row.key}><td><strong>{row.name}</strong><small>{row.code}</small></td><td className="ws-align-right">{row.stock} und.</td><td className="ws-align-right">{money(row.avg)}</td><td className="ws-align-right ws-amount">{money(row.value)}</td></tr>)}</tbody></table></div><div className="ws-card-heading"><div><h2>Total en estantería</h2></div><strong>{money(total)}</strong></div></div>
}

export default function ReportsPage() {
  const { records, loading, errors } = useRecords()
  const { can } = useAuth()
  const [params, setParams] = useSearchParams()
  const [selected, setSelected] = useState<string | null>(null)
  const [valuation, setValuation] = useState<Map<string, { cantidad: number; costoPromedio: number }> | null>(null)
  const [valuationError, setValuationError] = useState('')
  useEffect(() => {
    if (!can('inventory')) return
    let active = true
    fetchInventoryValuation()
      .then((map) => active && setValuation(map))
      .catch(() => active && setValuationError('No se pudo calcular el costo del inventario.'))
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const range = { from: params.get('from') ?? '', to: params.get('to') ?? '' }
  const sales = records.sales.filter(item => inDateRange(item, range))
  const purchases = records.purchases.filter(item => inDateRange(item, range))
  const inventory = records.inventory.filter(item => inDateRange(item, range))
  const finance = records.finance.filter(item => inDateRange(item, range))
  const valuationRows = useMemo(() => {
    if (!valuation) return []
    return [...valuation.entries()]
      .map(([productoId, entry]) => {
        const product = inventory.find(item => item.rowId === productoId)
        const stock = product?.quantity ?? 0
        return { key: productoId, code: product?.id ?? productoId.slice(0, 8), name: product?.name ?? 'Producto no disponible', stock, avg: entry.costoPromedio, value: stock * entry.costoPromedio }
      })
      .filter(row => row.stock > 0)
      .sort((a, b) => b.value - a.value)
  }, [valuation, inventory])
  const valuationTotal = valuationRows.reduce((sum, row) => sum + row.value, 0)
  const reports: { id: string; page: DataPage; title: string; detail: string; value: string; icon: typeof TrendingUp; color: string; view?: ModuleView }[] = [
    { id: 'sales', page: 'sales', title: 'Ventas del período', detail: `${sales.length} ventas · Importes registrados`, value: money(totalAmount(sales)), icon: TrendingUp, color: 'blue' },
    { id: 'purchases', page: 'purchases', title: 'Compras por proveedor', detail: `${purchases.length} órdenes · Subtotales sin IGV`, value: money(totalAmount(purchases)), icon: ShoppingCart, color: 'green' },
    { id: 'inventory', page: 'inventory', title: 'Valorización de inventario', detail: 'Existencias actuales × precio de venta', value: money(inventory.reduce((sum, item) => sum + (item.quantity ?? 0) * (item.precio ?? 0), 0)), icon: Boxes, color: 'violet' },
    { id: 'costo', page: 'inventory', title: 'Costo del inventario', detail: 'Existencias actuales × costo promedio de compra', value: valuation ? money(valuationTotal) : valuationError ? 'No disponible' : 'Consultando…', icon: Calculator, color: 'green' },
    { id: 'finance', page: 'finance', title: 'Cuentas por cobrar', detail: `${financialSnapshot(finance).receivables.length} cuentas abiertas`, value: money(financialSnapshot(finance).receivable), icon: Wallet, color: 'amber', view: 'accounts' },
    { id: 'kardex', page: 'inventory', title: 'Movimientos de Kardex', detail: 'Historial de entradas y salidas de stock', value: 'Consultar historial', icon: PackageCheck, color: 'blue', view: 'kardex' },
  ].filter(report => can(report.page as DataPage)) as typeof reports
  const active = reports.find(report => report.id === selected)
  const parameter = (key: string, value: string) => setParams(previous => { const next = new URLSearchParams(previous); if (value) next.set(key, value); else next.delete(key); return next }, { replace: true })
  if (!can('reports')) return <div className="ws-card ws-empty-compact"><FileText size={28} /><strong>Tu rol no tiene permiso de reportes.</strong></div>
  return <>
    <section className="ws-page-heading"><div><span className="ws-eyebrow">ANALÍTICA EMPRESARIAL</span><h1>Reportes</h1><p>Una visión consistente, calculada sobre tus registros de Supabase.</p></div><div className="ws-heading-actions"><div className="ws-filter-date"><input type="date" value={range.from} onChange={event => parameter('from', event.target.value)} aria-label="Fecha inicial de reportes" /><span>→</span><input type="date" value={range.to} onChange={event => parameter('to', event.target.value)} aria-label="Fecha final de reportes" /></div></div></section>
    {range.from && range.to && range.from > range.to && <div className="ws-notice ws-notice-warning" role="alert">Revisa el intervalo de fechas: la fecha inicial supera la final.</div>}
    <section className="ws-report-grid" aria-label="Reportes disponibles">{reports.map(report => <button key={report.id} className="ws-card ws-report-card" aria-pressed={selected === report.id} onClick={() => { setSelected(report.id); setParams(previous => { const next = new URLSearchParams(previous); next.delete('q'); next.delete('status'); return next }, { replace: true }) }}><span className={`ws-soft-icon ${report.color}`}><report.icon size={21} /></span><h2>{report.title}</h2><p>{report.detail}</p><strong>{loading ? 'Consultando…' : errors[report.page] ? 'No disponible' : report.value}</strong><span>{selected === report.id ? 'Reporte seleccionado' : 'Consultar reporte'}<ArrowRight size={15} /></span></button>)}</section>
    {active && <section><div className="ws-section-heading"><div><h2>{active.title}</h2><p>Los filtros y la exportación del detalle usan la misma consulta.</p></div><button className="ws-text-button" onClick={() => setSelected(null)}>Cerrar detalle</button></div>{active.id === 'costo' ? <ValuationDetail rows={valuationRows} total={valuationTotal} pending={!valuation && !valuationError} errorText={valuationError} /> : <ModuloPage page={active.page} view={active.view} embedded />}</section>}
    {!active && <section className="ws-card"><div className="ws-card-heading"><div><h2>Cómo se calculan tus reportes</h2><p>Cifras obtenidas de tus registros empresariales.</p></div></div><div className="ws-form"><p className="relation-hint">Las ventas y compras usan su fecha original de registro. Los saldos se obtienen de las cuentas financieras. La valorización refleja el precio de venta actual de los productos seleccionados; no representa un costo contable ni un inventario histórico.</p></div></section>}
  </>
}
