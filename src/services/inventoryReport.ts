import { peruDateBounds } from '../data/businessCalendar'
import { isCompleteKardexSet, MAX_KARDEX_REPORT_ROWS } from '../data/inventoryReport'
import { requireSupabase } from '../lib/supabase'
import type { DateRange } from '../data/workspace'
import type { InventoryMovement } from './inventoryQueries'

const PAGE_SIZE = 500

export type InventoryKardexReportSource = {
  rows: InventoryMovement[]
  totalCount: number | null
  complete: boolean
}

export async function fetchInventoryKardexReport(range: DateRange): Promise<InventoryKardexReportSource> {
  const bounds = peruDateBounds(range)
  const client = requireSupabase()
  const rows: InventoryMovement[] = []
  const seenIds = new Set<string>()
  let totalCount: number | null = null
  let cursor: Pick<InventoryMovement, 'fecha' | 'movimiento_id'> | null = null
  let stable = true

  while (rows.length < MAX_KARDEX_REPORT_ROWS) {
    const countOption = cursor ? undefined : { count: 'exact' as const }
    let query = client.rpc('ec_consultar_kardex', {
      p_producto_id: null,
      p_almacen_id: null,
    }, countOption)
      .order('fecha', { ascending: false })
      .order('movimiento_id', { ascending: false })
      .limit(Math.min(PAGE_SIZE, MAX_KARDEX_REPORT_ROWS - rows.length))

    if (bounds.fromInclusive) query = query.gte('fecha', bounds.fromInclusive)
    if (bounds.toExclusive) query = query.lt('fecha', bounds.toExclusive)
    if (cursor) {
      query = query.or(`fecha.lt.${cursor.fecha},and(fecha.eq.${cursor.fecha},movimiento_id.lt.${cursor.movimiento_id})`)
    }

    const { data, error, count } = await query
    if (error) throw new Error('No se pudo consultar el Kardex actual de Inventario.')
    totalCount ??= count
    const page = (data ?? []) as InventoryMovement[]
    for (const row of page) {
      if (seenIds.has(row.movimiento_id)) {
        stable = false
        continue
      }
      seenIds.add(row.movimiento_id)
      rows.push(row)
    }
    if (!page.length) break
    const last = page[page.length - 1]
    if (!last) break
    if (cursor && last.fecha === cursor.fecha && last.movimiento_id === cursor.movimiento_id) {
      stable = false
      break
    }
    cursor = { fecha: last.fecha, movimiento_id: last.movimiento_id }
    if (page.length < PAGE_SIZE) break
  }

  return {
    rows,
    totalCount,
    complete: stable && isCompleteKardexSet(totalCount, rows.length),
  }
}
