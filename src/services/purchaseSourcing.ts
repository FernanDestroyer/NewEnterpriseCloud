import { requireSupabase } from '../lib/supabase'

export type SourcingLine = { id: string; producto_id: string | null; unidad_medida_id: string | null; descripcion: string; cantidad: number; unidad: string }
export type SourcingOfferLine = {
  solicitud_linea_id: string
  precio_unitario: number
  tratamiento_tributario: 'Gravado' | 'Exonerado' | 'Inafecto'
  tasa_tributaria: number
}
export type SourcingOffer = {
  id: string
  codigo: string
  proveedor_id: string
  vigencia_hasta: string | null
  plazo_entrega_dias: number | null
  condiciones: string
  estado: string
  version: number
  version_anterior_id: string | null
  es_version_actual: boolean
  seleccionado_por: string | null
  seleccionado_en: string | null
  moneda: 'PEN' | 'USD'
  exchange_rate: number
  proveedores: { razon_social: string } | null
  detalle_ofertas_compra: SourcingOfferLine[]
}
export type SourcingRequest = {
  id: string
  codigo: string
  estado: string
  version: number
  fecha_necesidad: string | null
  detalle: string
  created_at: string
  seleccion_oferta_id: string | null
  seleccion_motivo: string | null
  seleccionado_por: string | null
  seleccionado_en: string | null
  cancelacion_motivo: string | null
  cancelado_por: string | null
  cancelado_en: string | null
  updated_by: string | null
  orden_compra_id: string | null
  orden_codigo: string | null
  line_count?: number
  offer_count?: number
  solicitud_compra_lineas: SourcingLine[]
  ofertas_compra: SourcingOffer[]
}

export type SourcingPage = { requests: SourcingRequest[]; total: number; limit: number; offset: number }
export type SupplierOption = { id: string; codigo: string; razon_social: string }
export type SupplierPage = { items: SupplierOption[]; total: number; limit: number; offset: number }
export type SourcingCurrency = { codigo: 'PEN' | 'USD'; nombre: string; simbolo: string }

export async function fetchPurchaseSourcing(input: {
  estado?: string; desde?: string; hasta?: string; referencia?: string; limit?: number; offset?: number
} = {}): Promise<SourcingPage> {
  const { data, error } = await requireSupabase().rpc('listar_solicitudes_compra_paginado_v1', {
    p_estado: input.estado || null,
    p_desde: input.desde || null,
    p_hasta: input.hasta || null,
    p_referencia: input.referencia?.trim() || null,
    p_limit: input.limit ?? 20,
    p_offset: input.offset ?? 0,
  })
  if (error) throw error
  const result = data as { items?: SourcingRequest[]; total?: number; limit?: number; offset?: number }
  return { requests: result.items ?? [], total: Number(result.total ?? 0), limit: Number(result.limit ?? 20), offset: Number(result.offset ?? 0) }
}

export async function fetchPurchaseSourcingDetail(requestId: string): Promise<SourcingRequest> {
  const { data, error } = await requireSupabase().rpc('obtener_detalle_solicitud_compra_v1', { p_solicitud_id: requestId })
  if (error) throw error
  return data as unknown as SourcingRequest
}

export async function fetchPurchaseSuppliers(input: { search?: string; limit?: number; offset?: number } = {}): Promise<SupplierPage> {
  const { data, error } = await requireSupabase().rpc('listar_proveedores_compra_paginado_v1', {
    p_busqueda: input.search?.trim() || null,
    p_limit: input.limit ?? 10,
    p_offset: input.offset ?? 0,
  })
  if (error) throw error
  const result = data as { items?: SupplierOption[]; total?: number; limit?: number; offset?: number }
  return { items: result.items ?? [], total: Number(result.total ?? 0), limit: Number(result.limit ?? 10), offset: Number(result.offset ?? 0) }
}

export async function fetchSourcingCurrencies(): Promise<SourcingCurrency[]> {
  const { data, error } = await requireSupabase().rpc('listar_monedas_compra_v1')
  if (error) throw error
  return (data ?? []) as SourcingCurrency[]
}

export async function openPurchaseRequest(requestId: string, idempotencyKey: string): Promise<void> {
  const { error } = await requireSupabase().rpc('abrir_solicitud_compra_v2', {
    p_solicitud_id: requestId,
    p_idempotency_key: idempotencyKey,
  })
  if (error) throw error
}

export async function createPurchaseRequest(input: {
  detalle: string
  fechaNecesidad: string | null
  lineas: Array<{ producto_id?: string | null; unidad_medida_id: string; descripcion: string; cantidad: number }>
  idempotencyKey: string
}): Promise<string> {
  const { data, error } = await requireSupabase().rpc('crear_solicitud_compra_v3', {
    p_detalle: input.detalle,
    p_fecha_necesidad: input.fechaNecesidad,
    p_lineas: input.lineas,
    p_idempotency_key: input.idempotencyKey,
  })
  if (error) throw error
  return String(data)
}

export async function editPurchaseRequest(input: {
  solicitudId: string
  expectedVersion: number
  detalle: string
  fechaNecesidad: string | null
  lineas: Array<{ producto_id?: string | null; unidad_medida_id: string; descripcion: string; cantidad: number }>
  idempotencyKey: string
}): Promise<number> {
  const { data, error } = await requireSupabase().rpc('editar_solicitud_compra_v1', {
    p_solicitud_id: input.solicitudId,
    p_expected_version: input.expectedVersion,
    p_detalle: input.detalle,
    p_fecha_necesidad: input.fechaNecesidad,
    p_lineas: input.lineas,
    p_idempotency_key: input.idempotencyKey,
  })
  if (error) throw error
  return Number(data)
}

export async function cancelPurchaseRequest(requestId: string, reason: string, idempotencyKey: string): Promise<void> {
  const { error } = await requireSupabase().rpc('cancelar_solicitud_compra_v1', {
    p_solicitud_id: requestId,
    p_motivo: reason,
    p_idempotency_key: idempotencyKey,
  })
  if (error) throw error
}

export async function registerPurchaseOffer(input: {
  solicitudId: string
  proveedorId: string
  vigenciaHasta: string | null
  plazoEntregaDias: number | null
  condiciones: string
  precios: Array<{ linea_id: string; precio_unitario: number; tratamiento_tributario: 'Gravado' | 'Exonerado' | 'Inafecto'; tasa_tributaria: number }>
  moneda: 'PEN' | 'USD'
  exchangeRate: number
  idempotencyKey: string
}): Promise<string> {
  const { data, error } = await requireSupabase().rpc('registrar_oferta_compra_v4', {
    p_solicitud_id: input.solicitudId,
    p_proveedor_id: input.proveedorId,
    p_vigencia_hasta: input.vigenciaHasta,
    p_plazo_entrega_dias: input.plazoEntregaDias,
    p_condiciones: input.condiciones,
    p_precios: input.precios,
    p_idempotency_key: input.idempotencyKey,
    p_moneda: input.moneda,
    p_exchange_rate: input.exchangeRate,
  })
  if (error) throw error
  return String(data)
}

export async function selectPurchaseOffer(requestId: string, offerId: string, reason: string, idempotencyKey: string): Promise<void> {
  const { error } = await requireSupabase().rpc('seleccionar_oferta_compra_v4', {
    p_solicitud_id: requestId,
    p_oferta_id: offerId,
    p_motivo: reason,
    p_idempotency_key: idempotencyKey,
  })
  if (error) throw error
}

export async function convertSelectedRequest(requestId: string, idempotencyKey: string): Promise<string> {
  const { data, error } = await requireSupabase().rpc('convertir_solicitud_a_orden_v1', {
    p_solicitud_id: requestId,
    p_idempotency_key: idempotencyKey,
  })
  if (error) throw error
  return String(data)
}
