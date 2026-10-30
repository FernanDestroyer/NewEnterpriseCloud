import { requireSupabase } from '../lib/supabase'

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
}): Promise<{ rows: InventoryMovement[]; total: number }> {
  const from = (filters.page - 1) * filters.pageSize
  const { data, error, count } = await requireSupabase().rpc('ec_consultar_kardex', {
    p_producto_id: filters.productId,
    p_almacen_id: filters.warehouseId,
  }, { count: 'exact' }).order('fecha', { ascending: false }).order('movimiento_id', { ascending: false })
    .range(from, from + filters.pageSize - 1)
  if (error) throw error
  return { rows: (data ?? []) as InventoryMovement[], total: count ?? 0 }
}

export function inventoryQueryError(error: unknown): string {
  const detail = error as { code?: string; message?: string } | null
  if (detail?.code === '42501') return 'No tienes permiso para consultar Inventario.'
  if (detail?.code === 'PGRST202' || detail?.code === '42883') return 'El RPC de Inventario no está disponible en Supabase. Comprueba que se ejecutó la Fase 1 y recarga el esquema.'
  return detail?.message || (error instanceof Error ? error.message : 'No se pudo consultar Supabase. Inténtalo de nuevo.')
}
