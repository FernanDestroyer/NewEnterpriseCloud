import { requireSupabase } from '../lib/supabase'
import { buildPepsValuationSnapshot, type PepsLedgerSnapshot, type PepsValuationSnapshot } from '../data/inventoryPeps'

export type InventoryStock = {
  producto_id: string
  almacen_id: string
  stock_fisico: number
  stock_reservado: number
  stock_libre: number
}

export type InventoryMovement = {
  movimiento_id: string
  producto_id: string | null
  almacen_id: string | null
  fecha: string
  tipo: string
  cantidad: number
  stock_anterior: number | null
  stock_nuevo: number | null
  referencia: string | null
  motivo: string | null
  costo_peps: number | null
  costo_promedio: number | null
  saldo_peps: number | null
  saldo_promedio: number | null
}

export type InventoryWarehouse = { id: string; nombre: string; activo: boolean }

const PAGE_SIZE = 500

export async function loadInventoryWarehouses(): Promise<InventoryWarehouse[]> {
  const rows: InventoryWarehouse[] = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await requireSupabase().from('almacenes').select('id,nombre,activo')
      .order('nombre').order('id').range(offset, offset + PAGE_SIZE - 1)
    if (error) throw error
    rows.push(...(data ?? []) as InventoryWarehouse[])
    if ((data ?? []).length < PAGE_SIZE) return rows
  }
}

// RPC sin filtros: recorrer todas las páginas para no confundir el límite de PostgREST con un total real.
export async function loadInventoryStocks(): Promise<InventoryStock[]> {
  const rows: InventoryStock[] = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await requireSupabase().rpc('ec_consultar_existencias')
      .order('almacen_id').order('producto_id').range(offset, offset + PAGE_SIZE - 1)
    if (error) throw error
    const batch = (data ?? []) as InventoryStock[]
    rows.push(...batch)
    if (batch.length < PAGE_SIZE) return rows
  }
}

export async function loadInventoryKardex(filters: {
  productId: string | null
  warehouseId: string | null
  page: number
  pageSize: number
  search?: string | null
}): Promise<{ rows: InventoryMovement[]; total: number }> {
  const from = (filters.page - 1) * filters.pageSize
  let request = requireSupabase().rpc('ec_consultar_kardex', {
    p_producto_id: filters.productId,
    p_almacen_id: filters.warehouseId,
  }, { count: 'exact' })
  // PostgREST reserves commas, parentheses and asterisks inside or() filters.
  const term = (filters.search ?? '').replace(/[,()*%\\]/g, ' ').trim()
  if (term) request = request.or(`referencia.ilike.*${term}*,motivo.ilike.*${term}*`)
  const { data, error, count } = await request.order('fecha', { ascending: false }).order('movimiento_id', { ascending: false })
    .range(from, from + filters.pageSize - 1)
  if (error) throw error
  return { rows: (data ?? []) as InventoryMovement[], total: count ?? 0 }
}

/** Snapshot PEPS actual comparado con el stock físico de cada almacén. */
export async function loadInventoryPepsValuation(): Promise<PepsValuationSnapshot> {
  const client = requireSupabase()
  const [warehouses, firstPage] = await Promise.all([
    loadInventoryWarehouses(),
    client.rpc('ec_consultar_valorizacion_peps_actual_v1', {}, { count: 'exact' })
      .order('almacen_id').order('producto_id').range(0, PAGE_SIZE - 1),
  ])
  if (firstPage.error) throw firstPage.error
  const rows = [...(firstPage.data ?? []) as Array<{
    producto_id: string
    almacen_id: string
    stock_fisico: number
    saldo_unidades: number | null
    saldo_peps: number | null
    problema: PepsLedgerSnapshot['problema']
  }>]
  const pages = Math.ceil((firstPage.count ?? rows.length) / PAGE_SIZE)
  for (let page = 1; page < pages; page += 1) {
    const result = await client.rpc('ec_consultar_valorizacion_peps_actual_v1', {}, { count: 'exact' })
      .order('almacen_id').order('producto_id').range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
    if (result.error) throw result.error
    rows.push(...(result.data ?? []) as typeof rows)
  }
  const names = new Map(warehouses.map(warehouse => [warehouse.id, warehouse.nombre]))
  return buildPepsValuationSnapshot(
    rows.map(row => ({ producto_id: row.producto_id, almacen_id: row.almacen_id, stock_fisico: Number(row.stock_fisico), almacen_nombre: names.get(row.almacen_id) ?? 'Almacén sin nombre' })),
    rows.map(row => ({ producto_id: row.producto_id, almacen_id: row.almacen_id, saldo_unidades: row.saldo_unidades === null ? null : Number(row.saldo_unidades), saldo_peps: row.saldo_peps === null ? null : Number(row.saldo_peps), problema: row.problema })),
  )
}

export function inventoryQueryError(error: unknown): string {
  const detail = error as { code?: string; message?: string } | null
  if (detail?.code === '42501') return 'No tienes permiso para consultar Inventario.'
  if (detail?.code === 'PGRST202' || detail?.code === '42883') return 'El RPC de Inventario no está disponible en Supabase. Comprueba que se ejecutó la Fase 1 y recarga el esquema.'
  return detail?.message || (error instanceof Error ? error.message : 'No se pudo consultar Supabase. Inténtalo de nuevo.')
}
