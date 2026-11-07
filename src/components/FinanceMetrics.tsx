import { financialSnapshot } from '../data/dashboard'
import { moneyCurrency } from '../data/helpers'
import { businessDate } from '../data/workspace'
import type { RecordItem } from '../types'
import '../treasury-ui.css'

export function financeDueDays(item: RecordItem) {
  if (!item.dueAt) return null
  const difference = Date.parse(`${item.dueAt.slice(0, 10)}T12:00:00Z`) - Date.parse(`${businessDate(new Date())}T12:00:00Z`)
  return Number.isFinite(difference) ? Math.round(difference / 86400000) : null
}
export function FinanceDueBadge({ item }: { item: RecordItem }) {
  if (item.status === 'Completada') return <span className="status-pill green">Cuenta completada</span>
  const days = financeDueDays(item)
  return <span className={`status-pill ${days === null ? '' : days < 0 ? 'red' : days <= 7 ? 'amber' : 'green'}`}>{days === null ? 'Sin vencimiento' : days < 0 ? `${Math.abs(days)} días vencida` : days === 0 ? 'Vence hoy' : days <= 7 ? `Vence en ${days} días` : `Al día · ${days} días`}</span>
}
export function financeCurrencyTotals(items: RecordItem[]) {
  return (['PEN', 'USD'] as const).map(currency => moneyCurrency(items.filter(item => (item.moneda ?? 'PEN') === currency).reduce((sum, item) => sum + (item.amount ?? 0), 0), currency)).join(' · ')
}
export default function FinanceMetrics({ items, loading, error }: { items: RecordItem[]; loading: boolean; error?: string }) {
  const snapshot = financialSnapshot(items)
  const overdue = snapshot.receivables.filter(item => (financeDueDays(item) ?? 0) < 0)
  const metrics = [
    ['CxC pendiente total', financeCurrencyTotals(snapshot.receivables), 'Saldo abierto, incluye vencidas'],
    ['CxC vencida', financeCurrencyTotals(overdue), `${overdue.length} cuentas con plazo vencido`],
    ['CxP pendiente total', financeCurrencyTotals(snapshot.payables), 'Obligaciones abiertas por moneda'],
    ['Cuentas completadas', String(snapshot.completedReceivables.length + snapshot.completedPayables.length), 'La emisión no acredita un cobro'],
  ]
  return <section className="ec-finance-metrics" aria-label="Resumen de cuentas financieras">{metrics.map(([label, value, detail]) => <article className="ec-card" key={label}><span>{label}</span><strong>{loading ? '—' : error ? 'No disponible' : value}</strong><small>{detail}</small></article>)}</section>
}
