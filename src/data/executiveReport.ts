import { financialSnapshot, recordAmount, totalAmount } from './dashboard.ts'
import { businessDate, dailyOperations, inDateRange, shiftDate, type DateRange } from './workspace.ts'
import type { RecordItem } from '../types'

export type ExecutiveReportInput = {
  sales: RecordItem[]
  /** undefined = fuente no disponible para esta sesión. Un array vacío sí es una fuente válida. */
  purchases?: RecordItem[]
  inventory?: RecordItem[]
  finance?: RecordItem[]
  range: DateRange
  now?: Date
}

type RankedAmount = { label: string; amount: number; count: number; share: number }

const round = (value: number) => Math.round(value * 100) / 100
const share = (value: number, total: number) => total > 0 ? round(value / total * 100) : 0

function rankSales(sales: RecordItem[], keyFor: (sale: RecordItem) => string, labelFor: (sale: RecordItem) => string): RankedAmount[] {
  const groups = new Map<string, { label: string; amount: number; count: number }>()
  for (const sale of sales) {
    const key = keyFor(sale)
    const entry = groups.get(key) ?? { label: labelFor(sale), amount: 0, count: 0 }
    entry.amount += recordAmount(sale)
    entry.count++
    groups.set(key, entry)
  }
  const total = totalAmount(sales)
  return [...groups.values()]
    .map(entry => ({ ...entry, amount: round(entry.amount), share: share(entry.amount, total) }))
    .sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label, 'es'))
}

function periodComparison(source: RecordItem[], range: DateRange, current: number) {
  if (!range.from || !range.to) return null
  const days = Math.round((Date.parse(range.to) - Date.parse(range.from)) / 86400000) + 1
  const previousRange = { from: shiftDate(range.from, -days), to: shiftDate(range.from, -1) }
  const previous = totalAmount(source.filter(item => inDateRange(item, previousRange)))
  return previous > 0 ? round((current - previous) / previous * 100) : null
}

/** Instantánea del mismo período del dashboard; finanzas e inventario son saldos actuales. */
export function buildExecutiveReport(input: ExecutiveReportInput) {
  const now = input.now ?? new Date()
  const range = { ...input.range }
  const sales = input.sales.filter(item => inDateRange(item, range))
    .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? ''))
      || b.id.localeCompare(a.id, 'es', { numeric: true }))
  const purchases = input.purchases?.filter(item => inDateRange(item, range))
  const salesTotal = totalAmount(sales)
  const purchasesTotal = purchases === undefined ? null : totalAmount(purchases)
  const completed = sales.filter(item => item.status === 'Completada' || item.status === 'Pagada')
  const completedTotal = totalAmount(completed)
  const statuses = [
    { label: 'Completadas', amount: completedTotal, count: completed.length, share: share(completedTotal, salesTotal) },
    { label: 'Por completar', amount: round(salesTotal - completedTotal), count: sales.length - completed.length, share: share(salesTotal - completedTotal, salesTotal) },
  ]
  const customers = rankSales(sales,
    sale => sale.cliente_id || `nombre:${sale.name.trim().toLocaleLowerCase('es')}`,
    sale => sale.relatedName || sale.name || 'Sin nombre',
  )
  const paymentMethods = rankSales(sales,
    sale => sale.medio?.trim().toLocaleLowerCase('es') || 'sin-registrar',
    sale => {
      const label = sale.medio?.trim()
      return label ? label[0].toLocaleUpperCase('es') + label.slice(1) : 'Sin registrar'
    },
  )
  const dates = [...sales, ...(purchases ?? [])]
    .flatMap(item => item.createdAt ? [businessDate(item.createdAt)] : []).filter(Boolean).sort()
  // Incluye cualquier fecha registrada, incluso si es posterior al día de emisión.
  const chartRange = range.from || range.to ? range : { from: dates[0] ?? '', to: dates[dates.length - 1] ?? businessDate(now) }
  const trend = dailyOperations(sales, purchases ?? [], chartRange, now)
  const inventory = input.inventory === undefined ? null : {
    count: input.inventory.length,
    units: input.inventory.reduce((sum, item) => sum + Math.max(0, Number(item.quantity) || 0), 0),
    saleValue: round(input.inventory.reduce((sum, item) => sum + Math.max(0, Number(item.quantity) || 0) * Math.max(0, Number(item.precio) || 0), 0)),
    alerts: input.inventory.filter(item => item.status === 'Bajo stock' || item.status === 'Crítico')
      .sort((a, b) => (a.quantity ?? 0) - (b.quantity ?? 0) || a.name.localeCompare(b.name, 'es')),
  }
  const finance = input.finance === undefined ? null : financialSnapshot(input.finance)
  const overdue = finance?.open.filter(item => item.dueAt && item.dueAt < businessDate(now)) ?? []

  return {
    generatedAt: now.toISOString(), range, sales, salesTotal,
    purchasesTotal, purchasesCount: purchases?.length ?? null,
    operationBalance: purchasesTotal === null ? null : round(salesTotal - purchasesTotal),
    averageTicket: sales.length ? round(salesTotal / sales.length) : 0,
    salesChange: periodComparison(input.sales, range, salesTotal),
    statuses, customers, paymentMethods, trend, inventory, finance,
    overdueCount: overdue.length, overdueAmount: totalAmount(overdue),
    undatedCount: sales.filter(item => !item.createdAt || !businessDate(item.createdAt)).length,
    sources: ['Ventas', ...(purchases === undefined ? [] : ['Compras']), ...(inventory ? ['Inventario'] : []), ...(finance ? ['Finanzas'] : [])],
  }
}

export type ExecutiveReport = ReturnType<typeof buildExecutiveReport>
