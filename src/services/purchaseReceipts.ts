import { requireSupabase } from '../lib/supabase'

export type PurchaseReceiptProgress = {
  detalle_compra_id: string
  descripcion: string | null
  cantidad_ordenada: number
  recibido_bruto: number
  devuelto: number
  neto_recibido: number
}

export type ReceiptHistoryLine = {
  detalle_recepcion_id: string
  detalle_compra_id: string
  producto_id: string
  descripcion: string | null
  cantidad: number
  costo_unitario: number
}

export type PurchaseReceiptEvent = {
  id: string
  codigo: string
  almacen_id: string
  almacen: string
  actor_id: string | null
  actor: string | null
  recibido_en: string
  comprobante_tipo: string | null
  comprobante_numero: string | null
  referencia: string | null
  lineas: ReceiptHistoryLine[]
}

export type PurchaseReturnLine = {
  id: string
  detalle_compra_id: string
  cantidad: number
  recibido_en_evento: number
  producto_id: string
  costo_unitario: number
  descripcion: string | null
  recibido_bruto: number
  devuelto: number
  neto_recibido: number
  stock_disponible: number
  maximo_retornable: number
  recepcion_id: string
  recepcion_codigo: string
  almacen_id: string
  almacen: string
  recibido_en: string
  cantidad_repuesta: number
  pendiente_reposicion: number
}

export type PurchaseReturnHistoryLine = {
  detalle_devolucion_id: string
  detalle_recepcion_id: string
  recepcion_codigo: string
  producto_id: string
  descripcion: string | null
  almacen_id: string
  almacen: string
  cantidad: number
  costo_unitario: number
  movimiento_kardex_id: string | null
  movimiento_kardex_fecha: string | null
  movimiento_kardex_tipo: string | null
}

export type PurchaseReturnEvent = {
  id: string
  codigo: string
  motivo: string
  actor_id: string | null
  actor: string | null
  created_at: string
  referencia_documental: string | null
  estado_credito: 'Pendiente' | 'Aplicado' | 'Repuesto'
  seguimiento_actualizado_por?: string | null
  seguimiento_actualizado_en?: string | null
  lineas: PurchaseReturnHistoryLine[]
}

export type PurchaseCloseSummary = {
  recibido_bruto: number
  devuelto: number
  neto_recibido: number
  financiera_visible: boolean
  pagos: Array<{
    cuenta_id: string
    codigo: string
    estado: string
    moneda: string
    monto_original: number
    monto_aplicado: number
    saldo_pendiente: number
  }>
}

export type PendingPurchaseReplenishment = {
  detalle_devolucion_id: string
  detalle_compra_id: string
  devolucion_id: string
  devolucion_codigo: string
  referencia_documental: string | null
  descripcion: string | null
  producto_id: string
  almacen_id: string
  almacen: string
  cantidad_devuelta: number
  cantidad_compensada: number
  cantidad_repuesta: number
  pendiente_reposicion: number
}

export type PurchaseReturnCompensation = {
  id: string
  codigo: string
  motivo: string
  created_at: string
  actor_id: string | null
  actor: string | null
  lineas: Array<{
    detalle_devolucion_id: string
    cantidad: number
    producto_id: string
    almacen_id: string
    almacen: string
    movimiento_kardex_id: string | null
    movimiento_kardex_fecha: string | null
  }>
}

export type PagedResult<T> = { items: T[]; total: number; limit: number; offset: number }

function page<T>(data: unknown): PagedResult<T> {
  const result = (data ?? {}) as Partial<PagedResult<T>>
  return { items: result.items ?? [], total: Number(result.total ?? 0), limit: Number(result.limit ?? 20), offset: Number(result.offset ?? 0) }
}

export async function fetchPurchaseReceiptProgress(compraId: string): Promise<Map<string, PurchaseReceiptProgress>> {
  const { data, error } = await requireSupabase().rpc('obtener_resumen_recepcion_compra_v1', { p_compra_id: compraId })
  if (error) throw error
  return new Map(((data ?? []) as PurchaseReceiptProgress[]).map(line => [line.detalle_compra_id, {
    ...line,
    cantidad_ordenada: Number(line.cantidad_ordenada),
    recibido_bruto: Number(line.recibido_bruto),
    devuelto: Number(line.devuelto),
    neto_recibido: Number(line.neto_recibido),
  }]))
}

export async function fetchPurchaseReceiptHistory(compraId: string, limit = 10, offset = 0): Promise<PagedResult<PurchaseReceiptEvent>> {
  const { data, error } = await requireSupabase().rpc('listar_historial_recepciones_compra_v1', {
    p_compra_id: compraId, p_limit: limit, p_offset: offset,
  })
  if (error) throw error
  return page<PurchaseReceiptEvent>(data)
}

export async function fetchPurchaseReturnLines(compraId: string): Promise<PurchaseReturnLine[]> {
  const { data, error } = await requireSupabase().rpc('listar_lineas_devolucion_compra_v1', { p_compra_id: compraId })
  if (error) throw error
  return (data ?? []) as PurchaseReturnLine[]
}

export async function fetchPurchaseReturnHistory(compraId: string, limit = 10, offset = 0): Promise<PagedResult<PurchaseReturnEvent>> {
  const { data, error } = await requireSupabase().rpc('listar_historial_devoluciones_compra_v1', {
    p_compra_id: compraId, p_limit: limit, p_offset: offset,
  })
  if (error) throw error
  const result = page<PurchaseReturnEvent>(data)
  if (!result.items.length) return result
  const { data: tracking, error: trackingError } = await requireSupabase().rpc('obtener_seguimiento_creditos_devolucion_v1', {
    p_devolucion_ids: result.items.map(event => event.id),
  })
  if (trackingError) throw trackingError
  const byId = new Map(((tracking ?? []) as Array<Pick<PurchaseReturnEvent, 'id' | 'referencia_documental' | 'estado_credito' | 'seguimiento_actualizado_por' | 'seguimiento_actualizado_en'>>).map(item => [item.id, item]))
  return { ...result, items: result.items.map(event => ({ ...event, ...(byId.get(event.id) ?? {}), estado_credito: byId.get(event.id)?.estado_credito ?? 'Pendiente' })) }
}

export async function registerPurchaseReturn(input: {
  compraId: string
  motivo: string
  lineas: Array<{ detalle_recepcion_id: string; cantidad: number }>
  idempotencyKey: string
}): Promise<string> {
  const { data, error } = await requireSupabase().rpc('registrar_devolucion_compra', {
    p_compra_id: input.compraId,
    p_motivo: input.motivo,
    p_lineas: input.lineas,
    p_idempotency_key: input.idempotencyKey,
  })
  if (error) throw error
  return String(data)
}

export async function updatePurchaseCreditTracking(input: {
  devolucionId: string
  referenciaDocumental: string | null
  estado: 'Pendiente' | 'Aplicado' | 'Repuesto'
}): Promise<void> {
  const { error } = await requireSupabase().rpc('actualizar_seguimiento_credito_devolucion_v1', {
    p_devolucion_id: input.devolucionId,
    p_referencia_documental: input.referenciaDocumental,
    p_estado_credito: input.estado,
  })
  if (error) throw error
}

export async function compensatePurchaseReturn(input: {
  devolucionId: string
  motivo: string
  lineas: Array<{ detalle_devolucion_id: string; cantidad: number }>
  idempotencyKey: string
}): Promise<string> {
  const { data, error } = await requireSupabase().rpc('compensar_devolucion_compra_v1', {
    p_devolucion_id: input.devolucionId,
    p_motivo: input.motivo,
    p_lineas: input.lineas,
    p_idempotency_key: input.idempotencyKey,
  })
  if (error) throw error
  return String(data)
}

export async function fetchPurchaseCloseSummary(compraId: string): Promise<PurchaseCloseSummary> {
  const { data, error } = await requireSupabase().rpc('obtener_resumen_cierre_compra_v1', { p_compra_id: compraId })
  if (error) throw error
  return data as PurchaseCloseSummary
}

export async function fetchPendingPurchaseReplenishments(compraId: string): Promise<PendingPurchaseReplenishment[]> {
  const { data, error } = await requireSupabase().rpc('listar_pendientes_reposicion_compra_v1', { p_compra_id: compraId })
  if (error) throw error
  return (data ?? []) as PendingPurchaseReplenishment[]
}

export async function fetchPurchaseReturnCompensations(devolucionId: string): Promise<PurchaseReturnCompensation[]> {
  const { data, error } = await requireSupabase().rpc('listar_compensaciones_devolucion_compra_v1', { p_devolucion_id: devolucionId })
  if (error) throw error
  return (data ?? []) as PurchaseReturnCompensation[]
}
