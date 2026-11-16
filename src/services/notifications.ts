import { requireSupabase } from '../lib/supabase'
import type { NotificationSource, OperationalAlertInput, OperationalNotificationSource } from '../data/operationalAlerts'
export { MAX_ALERTS_PER_SOURCE } from '../data/operationalAlerts'
export type { NotificationSeverity, NotificationSource, OperationalAlertInput } from '../data/operationalAlerts'
export type NotificationState = 'active' | 'resolved'
export type NotificationView = 'active' | 'history'

export type OperationalNotification = Omit<OperationalAlertInput, 'fuente'> & { fuente: NotificationSource } & {
  id: string
  estado: NotificationState
  created_at: string
  updated_at: string
  last_seen_at: string
  read_at: string | null
  archived_at: string | null
  resolved_at: string | null
}

export type OperationalNotificationList = {
  rows: OperationalNotification[]
  truncated: boolean
}

export async function syncOperationalNotifications(
  sources: OperationalNotificationSource[],
  alerts: OperationalAlertInput[],
): Promise<number> {
  if (sources.length === 0) return 0
  const { data, error } = await requireSupabase().rpc('ec_sincronizar_alertas_operativas_v1', {
    p_fuentes: sources,
    p_alertas: alerts,
  })
  if (error) throw new Error(error.message)
  return Number(data ?? 0)
}

export async function listOperationalNotifications(view: NotificationView): Promise<OperationalNotificationList> {
  const client = requireSupabase()
  const rows: OperationalNotification[] = []
  const pageSize = 500
  const maxRows = 10_000

  for (let offset = 0; offset < maxRows; offset += pageSize) {
    let query = client
      .from('notificaciones')
      .select('id,fuente,clave_fuente,referencia,titulo,detalle,severidad,estado,created_at,updated_at,last_seen_at,read_at,archived_at,resolved_at')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + pageSize - 1)

    query = view === 'active'
      ? query.eq('estado', 'active').is('archived_at', null)
      : query.or('estado.eq.resolved,archived_at.not.is.null')

    const { data, error } = await query
    if (error) throw new Error(error.message)
    const page = (data ?? []) as OperationalNotification[]
    rows.push(...page)
    if (page.length < pageSize) return { rows, truncated: false }
  }

  return { rows, truncated: true }
}

export async function updateOperationalNotification(id: string, action: 'read' | 'archive'): Promise<void> {
  const now = new Date().toISOString()
  const updates = action === 'read'
    ? { read_at: now, updated_at: now }
    : { archived_at: now, updated_at: now }
  const { data, error } = await requireSupabase()
    .from('notificaciones')
    .update(updates)
    .eq('id', id)
    .eq('estado', 'active')
    .is('archived_at', null)
    .select('id')
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) throw new Error('La alerta ya no está disponible o no tienes permiso para modificarla.')
}
