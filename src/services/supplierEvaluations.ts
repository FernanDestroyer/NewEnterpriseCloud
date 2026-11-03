import { requireSupabase } from '../lib/supabase'
import type {
  SaveSupplierOrderEvaluationInput,
  SupplierEvaluationSummary,
  SupplierOrderEvaluation,
} from '../types/supplierEvaluations'

type CachedSummary = { expiresAt: number; value: SupplierEvaluationSummary }
type SummaryListener = () => void
const SUMMARY_TTL_MS = 60_000
const summaryCache = new Map<string, CachedSummary>()
const summaryRequests = new Map<string, Promise<SupplierEvaluationSummary>>()
const summaryListeners = new Set<SummaryListener>()
const summaryVersions = new Map<string, number>()

function invalidateSupplierSummary(proveedorId: string) {
  summaryCache.delete(proveedorId)
  summaryRequests.delete(proveedorId)
  summaryVersions.set(proveedorId, (summaryVersions.get(proveedorId) ?? 0) + 1)
  for (const listener of summaryListeners) listener()
}

export function subscribeSupplierSummary(listener: SummaryListener): () => void {
  summaryListeners.add(listener)
  return () => { summaryListeners.delete(listener) }
}

export async function fetchSupplierOrderEvaluation(compraId: string): Promise<SupplierOrderEvaluation | null> {
  const { data, error } = await requireSupabase()
    .from('evaluaciones_proveedor_orden')
    .select('id,compra_id,proveedor_id,calidad_producto,cumplimiento_plazos,nivel_servicio,evaluado_por,creado_en,actualizado_en')
    .eq('compra_id', compraId)
    .maybeSingle()
  if (error) throw error
  return data as SupplierOrderEvaluation | null
}

export async function saveSupplierOrderEvaluation(input: SaveSupplierOrderEvaluationInput, proveedorId?: string): Promise<string> {
  const { data, error } = await requireSupabase().rpc('registrar_evaluacion_proveedor_orden_v1', {
    p_compra_id: input.compra_id,
    p_calidad_producto: input.calidad_producto,
    p_cumplimiento_plazos: input.cumplimiento_plazos,
    p_nivel_servicio: input.nivel_servicio,
  })
  if (error) throw error
  if (proveedorId) invalidateSupplierSummary(proveedorId)
  return String(data)
}

export async function fetchSupplierEvaluationSummary(proveedorId: string): Promise<SupplierEvaluationSummary> {
  const cached = summaryCache.get(proveedorId)
  if (cached && cached.expiresAt > Date.now()) return cached.value
  const pending = summaryRequests.get(proveedorId)
  if (pending) return pending
  const version = summaryVersions.get(proveedorId) ?? 0

  const request = (async () => {
    const { data, error } = await requireSupabase().rpc('obtener_promedio_evaluacion_proveedor_v1', {
      p_proveedor_id: proveedorId,
    })
    if (error) throw error
    const row = (data ?? [])[0] as SupplierEvaluationSummary | undefined
    const value: SupplierEvaluationSummary = row ?? {
      proveedor_id: proveedorId,
      cantidad_evaluaciones: 0,
      promedio_calidad: null,
      promedio_plazos: null,
      promedio_servicio: null,
      promedio_global: null,
    }
    if (version === (summaryVersions.get(proveedorId) ?? 0)) {
      summaryCache.set(proveedorId, { expiresAt: Date.now() + SUMMARY_TTL_MS, value })
    }
    return value
  })()
  summaryRequests.set(proveedorId, request)
  try {
    return await request
  } finally {
    if (summaryRequests.get(proveedorId) === request) summaryRequests.delete(proveedorId)
  }
}
