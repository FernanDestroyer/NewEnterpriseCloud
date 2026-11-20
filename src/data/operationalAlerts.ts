import type { DataPage, RecordItem } from '../types'

export type OperationalNotificationSource = 'inventory' | 'finance' | 'purchases'
export type NotificationSource = OperationalNotificationSource | 'approvals' | 'predictive'
export type NotificationSeverity = 'critical' | 'warning' | 'info'
export type OperationalAlertInput = {
  fuente: OperationalNotificationSource
  clave_fuente: string
  referencia: string
  titulo: string
  detalle: string
  severidad: NotificationSeverity
}

export type OperationalAlertRecords = Pick<Record<DataPage, RecordItem[]>, OperationalNotificationSource>
export type OperationalAlertErrors = Partial<Record<OperationalNotificationSource, string>>
export type OperationalAlertFormatters = {
  isStockAlert: (record: RecordItem) => boolean
  money: (amount: number) => string
}

export const MAX_ALERTS_PER_SOURCE = 600

export function buildOperationalAlertSnapshot(
  records: OperationalAlertRecords,
  can: (module: OperationalNotificationSource) => boolean,
  errors: OperationalAlertErrors,
  loading: boolean,
  today: string,
  formatters: OperationalAlertFormatters,
) {
  const alertsBySource: Record<OperationalNotificationSource, OperationalAlertInput[]> = {
    inventory: can('inventory') ? records.inventory.filter(formatters.isStockAlert).map(record => ({
      fuente: 'inventory',
      clave_fuente: String(record.rowId ?? record.id),
      referencia: record.id,
      titulo: record.name,
      detalle: `${record.quantity ?? 0} unidades · ${record.id}`,
      severidad: record.status === 'Crítico' ? 'critical' : 'warning',
    })) : [],
    finance: can('finance') ? records.finance.filter(record => record.status !== 'Completada').map(record => {
      const overdue = Boolean(record.dueAt && record.dueAt < today)
      return {
        fuente: 'finance',
        clave_fuente: String(record.rowId ?? record.id),
        referencia: record.id,
        titulo: record.name,
        detalle: `${formatters.money(record.amount ?? 0)} · ${record.id}${record.dueAt ? ` · vence ${record.dueAt}` : ''}`,
        severidad: overdue ? 'critical' : 'warning',
      }
    }) : [],
    purchases: can('purchases') ? records.purchases.filter(record => ['Pendiente', 'Solicitud', 'Orden', 'Recibida'].includes(record.status)).map(record => ({
      fuente: 'purchases',
      clave_fuente: String(record.rowId ?? record.id),
      referencia: record.id,
      titulo: record.id,
      detalle: `${record.name} · ${record.status}`,
      severidad: record.status === 'Pendiente' || record.status === 'Solicitud' ? 'warning' : 'info',
    })) : [],
  }

  const readableSources: OperationalNotificationSource[] = []
  if (!loading) {
    if (can('inventory') && !errors.inventory) readableSources.push('inventory')
    if (can('finance') && !errors.finance) readableSources.push('finance')
    if (can('purchases') && !errors.purchases) readableSources.push('purchases')
  }
  const overflowSources = readableSources.filter(source => alertsBySource[source].length > MAX_ALERTS_PER_SOURCE)
  const sources = readableSources.filter(source => !overflowSources.includes(source))
  const alerts = sources.flatMap(source => alertsBySource[source])
  const key = JSON.stringify({ sources, alerts })

  return { alertsBySource, readableSources, overflowSources, sources, alerts, key }
}
