import { requireSupabase } from '../lib/supabase'
import { isCompleteMovementSet, peruDateBounds, type TreasuryMovementRow } from '../data/treasuryReport'
import type { DateRange } from '../data/workspace'

const PAGE_SIZE = 500
const MAX_ROWS = 10_000

export type TreasuryMovementReportSource = {
  rows: TreasuryMovementRow[]
  totalCount: number | null
  complete: boolean
}

export async function fetchTreasuryMovementReport(range: DateRange): Promise<TreasuryMovementReportSource> {
  const bounds = peruDateBounds(range)
  const client = requireSupabase()
  const rows: TreasuryMovementRow[] = []
  const seenIds = new Set<string>()
  let totalCount: number | null = null
  let cursor: Pick<TreasuryMovementRow, 'created_at' | 'id'> | null = null
  let stable = true

  while (rows.length < MAX_ROWS) {
    const countOption = cursor ? undefined : { count: 'exact' as const }
    let query = client.from('movimientos_tesoreria')
      .select('id,codigo,tipo,monto,moneda,medio_pago,referencia,created_at,anulado_en', countOption)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(Math.min(PAGE_SIZE, MAX_ROWS - rows.length))
    if (bounds.fromInclusive) query = query.gte('created_at', bounds.fromInclusive)
    if (bounds.toExclusive) query = query.lt('created_at', bounds.toExclusive)
    if (cursor) {
      query = query.or(`created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`)
    }
    const { data, error, count } = await query
    if (error) throw new Error('No se pudo consultar el flujo de cobros y pagos de Tesorería.')
    totalCount ??= count
    const page = (data ?? []) as TreasuryMovementRow[]
    for (const row of page) {
      if (seenIds.has(row.id)) {
        stable = false
        continue
      }
      seenIds.add(row.id)
      rows.push(row)
    }
    if (!page.length) break
    const last = page[page.length - 1]
    if (!last) break
    if (cursor && last.created_at === cursor.created_at && last.id === cursor.id) {
      stable = false
      break
    }
    cursor = { created_at: last.created_at, id: last.id }
    if (page.length < PAGE_SIZE) break
  }

  return {
    rows,
    totalCount,
    complete: stable && isCompleteMovementSet(totalCount, rows.length, MAX_ROWS),
  }
}
