import { businessDate } from './businessCalendar.ts'
import type { InventoryMovement } from '../services/inventoryQueries.ts'

export type InventoryKardexReportInput = {
  rows: InventoryMovement[]
  range: { from: string; to: string }
  totalCount: number | null
  complete: boolean
}

export const MAX_KARDEX_REPORT_ROWS = 10_000

export function isCompleteKardexSet(totalCount: number | null, rowsReceived: number, maxRows = MAX_KARDEX_REPORT_ROWS): boolean {
  return totalCount !== null && Number.isInteger(totalCount) && totalCount >= 0
    && Number.isInteger(rowsReceived) && rowsReceived >= 0
    && totalCount <= maxRows && rowsReceived === totalCount
}

export function buildInventoryKardexReport(input: InventoryKardexReportInput) {
  const rows = input.rows.filter(row => {
    const date = businessDate(row.fecha)
    return Boolean(date && (!input.range.from || date >= input.range.from) && (!input.range.to || date <= input.range.to))
  }).sort((a, b) => b.fecha.localeCompare(a.fecha) || b.movimiento_id.localeCompare(a.movimiento_id))
  const complete = input.complete && rows.length === input.rows.length
    && isCompleteKardexSet(input.totalCount, rows.length)
  const countsByType = complete
    ? [...rows.reduce((counts, row) => counts.set(row.tipo, (counts.get(row.tipo) ?? 0) + 1), new Map<string, number>())]
      .map(([tipo, cantidad]) => ({ tipo, cantidad }))
      .sort((a, b) => a.tipo.localeCompare(b.tipo, 'es'))
    : null

  return {
    rows,
    muestra: rows.slice(0, 200),
    totalCount: input.totalCount,
    complete,
    countsByType,
    dateLabel: input.range.from || input.range.to
      ? `${input.range.from || 'Desde el inicio'} a ${input.range.to || businessDate(new Date())}`
      : 'Todos los movimientos disponibles',
  }
}

export function inventoryKardexCsvRows(
  rows: InventoryMovement[],
  periodLabel: string,
  generatedAt: string,
): { header: string[]; rows: Array<Array<string | number | null>> } {
  return {
    header: [
      'Fecha y hora (UTC)', 'Fecha de negocio (Perú)', 'Producto ID', 'Almacén ID', 'Tipo', 'Referencia', 'Motivo',
      'Cantidad', 'Stock anterior', 'Stock nuevo', 'Costo PEPS', 'Costo promedio', 'Saldo PEPS', 'Saldo promedio',
      'Período consultado', 'Generado en UTC',
    ],
    rows: rows.map(row => [
      row.fecha, businessDate(row.fecha), row.producto_id, row.almacen_id, row.tipo, row.referencia, row.motivo,
      row.cantidad, row.stock_anterior, row.stock_nuevo, row.costo_peps, row.costo_promedio, row.saldo_peps,
      row.saldo_promedio, periodLabel, generatedAt,
    ]),
  }
}

export type InventoryKardexReport = ReturnType<typeof buildInventoryKardexReport>
