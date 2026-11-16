import { businessDate } from './businessCalendar.ts'
export { peruDateBounds } from './businessCalendar.ts'

export type DateRange = { from: string; to: string }

export type TreasuryMovementRow = {
  id: string
  codigo: string
  tipo: 'cobro' | 'pago'
  monto: number
  moneda: 'PEN' | 'USD' | null
  medio_pago: string | null
  referencia: string | null
  created_at: string
  anulado_en: string | null
}

export type TreasuryReportInput = {
  rows: TreasuryMovementRow[]
  range: DateRange
  complete: boolean
  totalCount: number | null
}

export function treasuryMovementCsvRows(
  rows: TreasuryMovementRow[],
  periodLabel: string,
  generatedAt: string,
): { header: string[]; rows: Array<Array<string | number>> } {
  return {
    header: ['Fecha de negocio (Perú)', 'Fecha y hora UTC', 'Tipo', 'Código', 'Moneda', 'Referencia', 'Medio de pago', 'Importe', 'Estado', 'Período consultado', 'Generado en UTC'],
    rows: rows.map(row => [
      businessDate(row.created_at),
      row.created_at,
      row.tipo === 'cobro' ? 'Cobro' : 'Pago',
      row.codigo,
      row.moneda ?? 'Sin moneda conciliada',
      row.referencia ?? '',
      row.medio_pago?.trim() || 'Sin medio registrado',
      row.monto,
      row.anulado_en ? 'Anulado' : 'Aplicado',
      periodLabel,
      generatedAt,
    ]),
  }
}

export function isCompleteMovementSet(totalCount: number | null, rowsReceived: number, maxRows: number): boolean {
  return totalCount !== null && Number.isInteger(totalCount) && totalCount >= 0
    && Number.isInteger(rowsReceived) && rowsReceived >= 0
    && totalCount <= maxRows && rowsReceived === totalCount
}

export function buildTreasuryMovementReport(input: TreasuryReportInput) {
  const rows = input.rows.filter(row => {
    const date = businessDate(row.created_at)
    return Boolean(date && (!input.range.from || date >= input.range.from) && (!input.range.to || date <= input.range.to))
  })
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))
  const active = rows.filter(row => !row.anulado_en)
  const anulados = rows.filter(row => Boolean(row.anulado_en))
  const cobros = active.filter(row => row.tipo === 'cobro')
  const pagos = active.filter(row => row.tipo === 'pago')
  const byMethodMap = new Map<string, { metodo: string; cobros: number; pagos: number; cantidad: number }>()
  for (const row of active) {
    const metodo = row.medio_pago?.trim() || 'Sin medio registrado'
    const summary = byMethodMap.get(metodo) ?? { metodo, cobros: 0, pagos: 0, cantidad: 0 }
    if (row.tipo === 'cobro') summary.cobros += 1
    else summary.pagos += 1
    summary.cantidad += 1
    byMethodMap.set(metodo, summary)
  }
  const byCurrencyMap = new Map<'PEN' | 'USD', { moneda: 'PEN' | 'USD'; cobros: number; pagos: number; neto: number; cantidad: number }>()
  let monedaDesconocida = 0
  for (const row of active) {
    if (row.moneda !== 'PEN' && row.moneda !== 'USD') {
      monedaDesconocida += 1
      continue
    }
    const summary = byCurrencyMap.get(row.moneda) ?? { moneda: row.moneda, cobros: 0, pagos: 0, neto: 0, cantidad: 0 }
    const amount = Math.round(Number(row.monto) * 100) / 100
    if (!Number.isFinite(amount) || amount < 0) continue
    if (row.tipo === 'cobro') {
      summary.cobros = Math.round((summary.cobros + amount) * 100) / 100
      summary.neto = Math.round((summary.neto + amount) * 100) / 100
    } else {
      summary.pagos = Math.round((summary.pagos + amount) * 100) / 100
      summary.neto = Math.round((summary.neto - amount) * 100) / 100
    }
    summary.cantidad += 1
    byCurrencyMap.set(row.moneda, summary)
  }
  const complete = input.complete
  const totalCount = input.totalCount ?? rows.length
  const counts = complete ? {
    cobros: cobros.length,
    pagos: pagos.length,
    anulados: anulados.length,
    activos: active.length,
    monedaDesconocida,
    porMedio: [...byMethodMap.values()].map(row => ({
      metodo: row.metodo,
      cobros: row.cobros,
      pagos: row.pagos,
      cantidad: row.cantidad,
    })).sort((a, b) => (b.cobros + b.pagos) - (a.cobros + a.pagos) || a.metodo.localeCompare(b.metodo, 'es')),
    porMoneda: [...byCurrencyMap.values()].sort((a, b) => a.moneda.localeCompare(b.moneda)),
  } : null

  return {
    rows,
    muestra: rows.slice(0, 200),
    totalCount,
    complete,
    counts,
    dateLabel: input.range.from || input.range.to
      ? `${input.range.from || 'Desde el inicio'} a ${input.range.to || businessDate(new Date())}`
      : 'Todos los movimientos cargados',
  }
}

export type TreasuryMovementReport = ReturnType<typeof buildTreasuryMovementReport>
