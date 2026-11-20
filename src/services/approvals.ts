import { requireSupabase } from '../lib/supabase'
import type { ApprovalOutcome, ApprovalRule, ApprovalRuleKey } from '../data/approvalRules'

export type ApprovalKind = 'purchase_manual' | 'purchase_sourcing' | 'purchase_contract' | 'physical_count'
export type ApprovalState = 'pending' | 'approved' | 'rejected' | 'stale'
export type ApprovalFilter = 'pending' | 'history'

export type ApprovalRequest = {
  id: string
  tipo: ApprovalKind
  origen_id: string | null
  solicitante_id: string
  estado: ApprovalState
  snapshot: Record<string, unknown>
  snapshot_hash: string
  resultado_id: string | null
  decision_por: string | null
  decision_en: string | null
  motivo_decision: string | null
  creado_en: string
  actualizado_en: string
}

export type ApprovalEvent = {
  id: string
  solicitud_id: string
  actor_id: string
  evento: 'solicitada' | 'aprobada' | 'rechazada' | 'obsoleta'
  motivo: string | null
  detalle: Record<string, unknown>
  creado_en: string
}

export type ApprovalPage = { rows: ApprovalRequest[]; total: number }
export type ApprovalDecision = { id: string; estado: ApprovalState; resultado_id: string | null }
const PAGE_SIZE = 25
export const APPROVAL_QUEUE_CHANGED_EVENT = 'enterprisecloud:approval-queue-changed'

export function notifyApprovalQueueChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(APPROVAL_QUEUE_CHANGED_EVENT))
}

export function approvalFailure(error: unknown): Error {
  const detail = error as { message?: string; code?: string } | null
  const message = detail?.message ?? 'No se pudo completar la aprobación.'
  if (['PGRST202', 'PGRST205', '42P01', '42883'].includes(detail?.code ?? '')
    || message.includes('ec_solicitudes_aprobacion') || message.includes('ec_decidir_aprobacion_v1')
    || message.includes('ec_solicitar_aprobacion_') || message.includes('ec_reglas_aprobacion') || message.includes('ec_actualizar_regla_aprobacion_v1') || message.includes('Could not find the function')) {
    return new Error('Falta aplicar en Supabase la migración de aprobaciones V1 antes de usar este flujo.')
  }
  return error instanceof Error ? error : new Error(message)
}

export async function fetchApprovals(filter: ApprovalFilter, page = 0): Promise<ApprovalPage> {
  const client = requireSupabase()
  let query = client.from('ec_solicitudes_aprobacion')
    .select('id,tipo,origen_id,solicitante_id,estado,snapshot,snapshot_hash,resultado_id,decision_por,decision_en,motivo_decision,creado_en,actualizado_en', { count: 'exact' })
    .order('creado_en', { ascending: false }).order('id', { ascending: false })
    .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
  query = filter === 'pending' ? query.eq('estado', 'pending') : query.in('estado', ['approved', 'rejected', 'stale'])
  const { data, error, count } = await query
  if (error) throw approvalFailure(error)
  if (count === null) throw new Error('No se pudo obtener el total de solicitudes de aprobación.')
  return { rows: (data ?? []) as ApprovalRequest[], total: count }
}

export async function fetchApprovalEvents(requestId: string): Promise<ApprovalEvent[]> {
  const { data, error } = await requireSupabase().from('ec_aprobacion_eventos')
    .select('id,solicitud_id,actor_id,evento,motivo,detalle,creado_en')
    .eq('solicitud_id', requestId).order('creado_en').order('id')
  if (error) throw approvalFailure(error)
  return (data ?? []) as ApprovalEvent[]
}

export async function decideApproval(requestId: string, approve: boolean, reason = ''): Promise<ApprovalDecision> {
  const { data, error } = await requireSupabase().rpc('ec_decidir_aprobacion_v1', {
    p_solicitud_id: requestId,
    p_aprobar: approve,
    p_motivo: approve ? null : reason.trim(),
  })
  if (error) throw approvalFailure(error)
  notifyApprovalQueueChanged()
  return data as ApprovalDecision
}

export async function findApprovalByKey(key: string): Promise<string | null> {
  const { data, error } = await requireSupabase().from('ec_solicitudes_aprobacion')
    .select('id').eq('idempotency_key', key).maybeSingle()
  if (error) throw approvalFailure(error)
  return data?.id ?? null
}

export async function fetchPendingApprovalOrigins(kind: ApprovalKind, originIds: string[]): Promise<string[]> {
  if (!originIds.length) return []
  const { data, error } = await requireSupabase().from('ec_solicitudes_aprobacion')
    .select('origen_id').eq('tipo', kind).eq('estado', 'pending').in('origen_id', originIds)
  if (error) throw approvalFailure(error)
  return [...new Set((data ?? []).map(row => row.origen_id).filter((id): id is string => Boolean(id)))]
}

export async function requestSourcingApproval(requestId: string, idempotencyKey: string): Promise<string> {
  const { data, error } = await requireSupabase().rpc('ec_solicitar_aprobacion_conversion_compra_v1', {
    p_solicitud_id: requestId,
    p_idempotency_key: idempotencyKey,
  })
  if (error) throw approvalFailure(error)
  notifyApprovalQueueChanged()
  return String(data)
}

export async function requestContractOrderApproval(input: {
  contractId: string
  versionId: string
  detail: string
  dueDate: string | null
  lines: Array<{ producto_id: string; cantidad: number; precio: number; tratamiento_tributario: 'Gravado' | 'Exonerado' | 'Inafecto'; tasa_tributaria: number }>
  idempotencyKey: string
  exchangeRate: number | null
  currency: 'PEN' | 'USD'
}): Promise<string> {
  const { data, error } = await requireSupabase().rpc('ec_solicitar_aprobacion_orden_contrato_v1', {
    p_contrato_id: input.contractId,
    p_version_id: input.versionId,
    p_detalle: input.detail,
    p_fecha_limite: input.dueDate,
    p_lineas: input.lines,
    p_idempotency_key: input.idempotencyKey,
    p_exchange_rate: input.currency === 'PEN' ? 1 : input.exchangeRate,
  })
  if (error) throw approvalFailure(error)
  notifyApprovalQueueChanged()
  return String(data)
}

export async function requestPhysicalCountApproval(countId: string, idempotencyKey: string): Promise<string> {
  const { data, error } = await requireSupabase().rpc('ec_solicitar_aprobacion_conteo_fisico_v1', {
    p_conteo_id: countId,
    p_idempotency_key: idempotencyKey,
  })
  if (error) throw approvalFailure(error)
  notifyApprovalQueueChanged()
  return String(data)
}

export type { ApprovalOutcome, ApprovalRule, ApprovalRuleKey } from '../data/approvalRules'

export async function fetchApprovalRules(): Promise<ApprovalRule[]> {
  const { data, error } = await requireSupabase().from('ec_reglas_aprobacion')
    .select('clave,titulo,descripcion,unidad,valor,activa,actualizado_por,actualizado_en')
    .order('clave')
  if (error) throw approvalFailure(error)
  return (data ?? []).map(row => ({ ...row, valor: Number(row.valor) })) as ApprovalRule[]
}

export async function updateApprovalRule(key: ApprovalRuleKey, value: number, active: boolean): Promise<void> {
  const { error } = await requireSupabase().rpc('ec_actualizar_regla_aprobacion_v1', {
    p_clave: key, p_valor: value, p_activa: active,
  })
  if (error) throw approvalFailure(error)
}

/** Estado de una solicitud recién enviada: permite saber si un umbral la emitió sin aprobación manual. */
export async function fetchApprovalOutcome(id: string): Promise<ApprovalOutcome | null> {
  const { data, error } = await requireSupabase().from('ec_solicitudes_aprobacion')
    .select('estado,solicitante_id,decision_por').eq('id', id).maybeSingle()
  if (error || !data) return null
  return { estado: data.estado as ApprovalOutcome['estado'], auto: data.estado === 'approved' && data.decision_por === data.solicitante_id }
}
