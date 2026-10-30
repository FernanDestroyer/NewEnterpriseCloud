import { requireSupabase } from '../lib/supabase'

export type TransferLine = { producto_id: string; cantidad: number }
export type CountLineInput = { producto_id: string; cantidad_contada: number; costo_entrada?: number }
export type PhysicalCount = {
  id: string; almacen_id: string; motivo: string; estado: 'abierto' | 'cerrado'
  creado_en: string; cerrado_en: string | null
}
export type PhysicalCountLine = {
  conteo_id: string; producto_id: string; stock_sistema: number
  stock_contado: number; costo_entrada: number | null; ajuste_id: string | null
}
export type TraceMode = { producto_id: string; modo: 'lote' | 'serie' }
export type PendingLot = { id: string; producto_id: string; codigo: string | null; vence_el: string | null; movimiento_entrada_id: string | null; creado_en: string }
export type PendingSerial = { id: string; producto_id: string; numero: string | null; almacen_id: string | null; creado_en: string }
export type LotBalance = { lote_id: string; almacen_id: string; cantidad: number }
export type InventoryPage<T> = { rows: T[]; total: number }
export type CountPage = InventoryPage<PhysicalCount>

export const inventoryKey = () => globalThis.crypto.randomUUID()

async function findKey(table: 'ec_transferencias' | 'ec_ajustes' | 'ec_conteos_fisicos', column: string, key: string): Promise<string | null> {
  const { data, error } = await requireSupabase().from(table).select('id').eq(column, key).maybeSingle()
  if (error) throw error
  return data?.id ?? null
}

export const findTransferByKey = (key: string) => findKey('ec_transferencias', 'clave', key)
export const findAdjustmentByKey = (key: string) => findKey('ec_ajustes', 'clave', key)
export const findOpenCountByKey = (key: string) => findKey('ec_conteos_fisicos', 'clave_apertura', key)
export async function findClosedCountByKey(id: string, key: string): Promise<boolean> {
  const { data, error } = await requireSupabase().from('ec_conteos_fisicos').select('id')
    .eq('id', id).eq('clave_cierre', key).eq('estado', 'cerrado').maybeSingle()
  if (error) throw error
  return Boolean(data)
}

export async function processTransfer(input: { origin: string; destination: string; reason: string; lines: TransferLine[]; key: string }): Promise<string> {
  const { data, error } = await requireSupabase().rpc('ec_procesar_transferencia', {
    p_almacen_origen_id: input.origin, p_almacen_destino_id: input.destination,
    p_lineas: input.lines, p_motivo: input.reason, p_key: input.key,
  })
  if (error) throw error
  return data as string
}

export async function registerAdjustment(input: { productId: string; warehouseId: string; delta: number; reason: string; unitCost: number | null; key: string }): Promise<string> {
  const { data, error } = await requireSupabase().rpc('ec_registrar_ajuste', {
    p_producto_id: input.productId, p_almacen_id: input.warehouseId,
    p_delta: input.delta, p_motivo: input.reason, p_costo_unitario: input.unitCost, p_key: input.key,
  })
  if (error) throw error
  return data as string
}

export async function openPhysicalCount(input: { warehouseId: string; lines: CountLineInput[]; reason: string; key: string }): Promise<string> {
  const { data, error } = await requireSupabase().rpc('ec_abrir_conteo_fisico', {
    p_almacen_id: input.warehouseId, p_lineas: input.lines, p_motivo: input.reason, p_key: input.key,
  })
  if (error) throw error
  return data as string
}

export async function closePhysicalCount(id: string, key: string): Promise<string> {
  const { data, error } = await requireSupabase().rpc('ec_cerrar_inventario_fisico', { p_conteo_id: id, p_key: key })
  if (error) throw error
  return data as string
}

export async function loadPhysicalCounts(page: number, pageSize = 50): Promise<CountPage> {
  const { data, error, count } = await requireSupabase().from('ec_conteos_fisicos')
    .select('id,almacen_id,motivo,estado,creado_en,cerrado_en', { count: 'exact' })
    .order('creado_en', { ascending: false }).order('id', { ascending: false })
    .range(page * pageSize, (page + 1) * pageSize - 1)
  if (error) throw error
  if (count === null) throw new Error('Supabase no devolvió el total de conteos; no se puede paginar con seguridad.')
  return { rows: (data ?? []) as PhysicalCount[], total: count }
}

export async function loadPhysicalCountLines(id: string): Promise<PhysicalCountLine[]> {
  const rows: PhysicalCountLine[] = []
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await requireSupabase().from('ec_conteo_lineas')
      .select('conteo_id,producto_id,stock_sistema,stock_contado,costo_entrada,ajuste_id')
      .eq('conteo_id', id).order('producto_id').range(offset, offset + 499)
    if (error) throw error
    rows.push(...(data ?? []) as PhysicalCountLine[])
    if ((data ?? []).length < 500) return rows
  }
}

export async function loadTraceModes(): Promise<TraceMode[]> {
  const rows: TraceMode[] = []
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await requireSupabase().from('ec_producto_trazabilidad').select('producto_id,modo')
      .order('producto_id').range(offset, offset + 499)
    if (error) throw error
    rows.push(...(data ?? []) as TraceMode[])
    if ((data ?? []).length < 500) return rows
  }
}

export async function configureTrace(productId: string, mode: 'lote' | 'serie'): Promise<void> {
  // Este RPC no admite p_key: el mismo producto/modo es idempotente por su PK y ON CONFLICT.
  const { error } = await requireSupabase().rpc('ec_configurar_trazabilidad', { p_producto_id: productId, p_modo: mode })
  if (error) throw error
}

// El total y las filas usan el mismo filtro; cada vista solicita únicamente su página.
async function pendingRows<T>(table: 'ec_lotes' | 'ec_series', select: string, page: number, productId: string | null, pageSize = 100): Promise<InventoryPage<T>> {
  let query = requireSupabase().from(table).select(select, { count: 'exact' })
    .is(table === 'ec_lotes' ? 'codigo' : 'numero', null)
  if (productId) query = query.eq('producto_id', productId)
  const { data, error, count } = await query.order('creado_en').order('id')
    .range(page * pageSize, (page + 1) * pageSize - 1)
  if (error) throw error
  if (count === null) throw new Error('Supabase no devolvió el total de pendientes; no se puede paginar con seguridad.')
  return { rows: (data ?? []) as T[], total: count }
}

export const loadPendingLots = (page: number, productId: string | null) => pendingRows<PendingLot>('ec_lotes', 'id,producto_id,codigo,vence_el,movimiento_entrada_id,creado_en', page, productId)
export const loadPendingSerials = (page: number, productId: string | null) => pendingRows<PendingSerial>('ec_series', 'id,producto_id,numero,almacen_id,creado_en', page, productId)

export async function loadLotBalances(lotIds: string[]): Promise<LotBalance[]> {
  const rows: LotBalance[] = []
  for (let offset = 0; offset < lotIds.length; offset += 100) {
    const ids = lotIds.slice(offset, offset + 100)
    for (let page = 0; ; page += 500) {
      const { data, error } = await requireSupabase().from('ec_existencias_lote')
        .select('lote_id,almacen_id,cantidad').in('lote_id', ids)
        .order('lote_id').order('almacen_id').range(page, page + 499)
      if (error) throw error
      rows.push(...(data ?? []) as LotBalance[])
      if ((data ?? []).length < 500) break
    }
  }
  return rows
}

export async function identifyLot(id: string, code: string, expires: string | null, key: string): Promise<string> {
  const { data, error } = await requireSupabase().rpc('ec_identificar_lote', {
    p_lote_id: id, p_codigo: code, p_vence_el: expires, p_key: key,
  })
  if (error) throw error
  return data as string
}

export async function identifySerial(id: string, number: string, key: string): Promise<string> {
  const { data, error } = await requireSupabase().rpc('ec_identificar_serie', { p_serie_id: id, p_numero: number, p_key: key })
  if (error) throw error
  return data as string
}
