import type { RecordItem } from '../types'

export type SalesFilter = 'all' | 'completed' | 'open'
export type ChartMode = 'cumulative' | 'individual'

export function recordAmount(item: RecordItem) {
  return Number.isFinite(item.amount) ? Math.max(0, item.amount ?? 0) : 0
}

export function totalAmount(items: RecordItem[]) {
  return Math.round(items.reduce((total, item) => total + recordAmount(item), 0) * 100) / 100
}

export function percentage(value: number, total: number) {
  return total > 0 ? Math.min(100, Math.max(0, Math.round(value / total * 100))) : 0
}

function classifyFinance(item: RecordItem): 'receivable' | 'payable' | null {
  if (item.financeType === 'cobrar') return 'receivable'
  if (item.financeType === 'pagar') return 'payable'
  if (item.id.startsWith('CXC')) return 'receivable'
  if (item.id.startsWith('CXP')) return 'payable'
  const detail = item.detail.toLocaleLowerCase('es')
  const isReceivable = detail.includes('por cobrar')
  const isPayable = detail.includes('por pagar')
  if (isReceivable && !isPayable) return 'receivable'
  if (isPayable && !isReceivable) return 'payable'
  return null
}

export function financialSnapshot(finance: RecordItem[]) {
  const open = finance.filter((item) => item.status !== 'Completada')
  const closed = finance.filter((item) => item.status === 'Completada')
  const receivables: RecordItem[] = []
  const payables: RecordItem[] = []
  const unclassified: RecordItem[] = []

  for (const item of open) {
    const kind = classifyFinance(item)
    if (kind === 'receivable') receivables.push(item)
    else if (kind === 'payable') payables.push(item)
    else unclassified.push(item)
  }

  // Caja: lo cobrado (CxC completadas) menos lo pagado (CxP completadas).
  const completedReceivables: RecordItem[] = []
  const completedPayables: RecordItem[] = []
  for (const item of closed) {
    const kind = classifyFinance(item)
    if (kind === 'receivable') completedReceivables.push(item)
    else if (kind === 'payable') completedPayables.push(item)
  }

  const receivable = totalAmount(receivables)
  const payable = totalAmount(payables)
  const cajaIngresos = totalAmount(completedReceivables)
  const cajaEgresos = totalAmount(completedPayables)
  return {
    open, receivables, payables, unclassified, receivable, payable, balance: receivable - payable,
    completedReceivables, completedPayables, cajaIngresos, cajaEgresos, cajaSaldo: cajaIngresos - cajaEgresos,
  }
}

export function buildSalesSeries(sales: RecordItem[], filter: SalesFilter, mode: ChartMode) {
  const filtered = sales.filter((item) => filter === 'all' || (filter === 'completed' ? item.status === 'Completada' : item.status !== 'Completada'))
  // Los registros están guardados del más nuevo al más antiguo. Las fechas de
  // presentación no son timestamps: el gráfico representa el orden de registro.
  const visible = filtered.slice(0, 12).reverse()
  let accumulated = 0
  const series = visible.map((item) => {
    accumulated += recordAmount(item)
    return { item, value: mode === 'cumulative' ? accumulated : recordAmount(item) }
  })
  const maximum = Math.max(0, ...series.map((point) => point.value))
  const step = maximum ? 10 ** Math.floor(Math.log10(maximum / 4)) : 25
  const ceiling = maximum ? Math.ceil(maximum / 4 / step) * step * 4 : 100
  const points = series.map((point, index) => ({
    ...point,
    x: series.length === 1 ? 50 : 4 + index / (series.length - 1) * 92,
    y: 88 - point.value / ceiling * 80,
  }))

  return { points, ceiling, total: totalAmount(visible), count: filtered.length, visibleCount: visible.length }
}
