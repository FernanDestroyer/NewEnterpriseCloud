import { useEffect, useMemo, useState } from 'react'
import { Archive, AlertTriangle, Bell, Boxes, Check, ChevronRight, ClipboardCheck, Clock3, RefreshCw, ShoppingCart, Wallet } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useOperationalNotifications } from '../context/OperationalNotificationsContext'
import { useRecords } from '../context/RecordsContext'
import { businessDate, type PermissionModuleKey } from '../data/workspace'
import { isStockAlert, money } from '../data/helpers'
import { buildOperationalAlertSnapshot, MAX_ALERTS_PER_SOURCE, type NotificationSource, type OperationalAlertInput, type OperationalNotificationSource } from '../data/operationalAlerts'
import { friendlyError } from '../services/records'
import { listOperationalNotifications, updateOperationalNotification, type NotificationView, type OperationalNotification } from '../services/notifications'
import { PageHeader } from './ui/PageHeader'

const sourceLabels: Record<NotificationSource, string> = {
  inventory: 'Inventario',
  finance: 'Tesorería',
  purchases: 'Compras',
  approvals: 'Aprobaciones',
}

const sourceIcons = {
  inventory: Boxes,
  finance: Wallet,
  purchases: ShoppingCart,
  approvals: ClipboardCheck,
} satisfies Record<NotificationSource, typeof Bell>

const sourcePages: Record<NotificationSource, PermissionModuleKey> = {
  inventory: 'inventory',
  finance: 'finance',
  purchases: 'purchases',
  approvals: 'approvals',
}

function notificationPath(notification: OperationalNotification) {
  if (notification.fuente === 'approvals') return '/aprobaciones'
  const path = notification.fuente === 'inventory' ? '/inventario/existencias' : `/${sourcePages[notification.fuente]}`
  return `${path}?q=${encodeURIComponent(notification.referencia)}`
}

function severityLabel(severity: OperationalNotification['severidad']) {
  if (severity === 'critical') return 'Crítica'
  if (severity === 'warning') return 'Atención'
  return 'Información'
}

function dateLabel(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function localNotification(alert: OperationalAlertInput, index: number): Omit<OperationalNotification, 'fuente'> & { fuente: OperationalNotificationSource } {
  const now = new Date().toISOString()
  return {
    ...alert,
    id: `local:${alert.fuente}:${index}:${alert.clave_fuente}`,
    estado: 'active',
    created_at: now,
    updated_at: now,
    last_seen_at: now,
    read_at: null,
    archived_at: null,
    resolved_at: null,
  }
}

function NotificationGroup({
  source,
  items,
  error,
  loading,
  view,
  readOnly,
  pendingId,
  onOpen,
  onRead,
  onArchive,
}: {
  source: NotificationSource
  items: OperationalNotification[]
  error?: string
  loading: boolean
  view: NotificationView
  readOnly: boolean
  pendingId: string | null
  onOpen: (path: string) => void
  onRead: (notification: OperationalNotification) => void
  onArchive: (notification: OperationalNotification) => void
}) {
  const Icon = sourceIcons[source]
  return <section className="ws-card ws-notification-group">
    <header className="ws-card-heading">
      <div><h2><Icon size={16} />{sourceLabels[source]}</h2><p>{source === 'inventory' ? 'Existencias por revisar.' : source === 'finance' ? 'Cuentas abiertas y vencimientos.' : source === 'purchases' ? 'Solicitudes y órdenes por seguir.' : 'Solicitudes que requieren una decisión o ya se resolvieron.'}</p></div>
      <span className="ws-badge">{items.length}</span>
    </header>
    {error ? <div className="ws-notice ws-notice-warning" role="alert">{error}</div> : loading ? <div className="ws-empty-compact" role="status">Consultando alertas…</div> : items.length ? <div className="ws-notification-list">
      {items.map(item => {
        const busy = pendingId === item.id
        const stateLabel = view === 'history'
          ? item.estado === 'resolved' ? 'Resuelta' : 'Archivada'
          : item.read_at ? 'Leída' : severityLabel(item.severidad)
        return <article key={item.id} className={`ws-notification-row${item.read_at ? ' is-read' : ''}`}>
          <button type="button" className="ws-notification-open" onClick={() => onOpen(notificationPath(item))}>
            <span className={`ws-notification-mark is-${item.severidad}`}><AlertTriangle size={16} /></span>
            <span className="ws-notification-copy"><strong>{item.titulo}</strong><small>{item.detalle || item.referencia}</small><small className="ws-notification-date">{dateLabel(item.updated_at || item.created_at)}</small></span>
          </button>
          <span className={`ws-badge ${item.severidad}`}>{stateLabel}</span>
          {view === 'active' && !readOnly && !item.read_at && <button type="button" className="ws-notification-action" disabled={busy} onClick={() => onRead(item)} aria-label={`Marcar como leída: ${item.titulo}`} title="Marcar como leída"><Check size={15} /></button>}
          {view === 'active' && !readOnly && <button type="button" className="ws-notification-action" disabled={busy} onClick={() => onArchive(item)} aria-label={`Archivar alerta: ${item.titulo}`} title="Archivar"><Archive size={15} /></button>}
          {view === 'active' && readOnly && <span className="ws-notification-temporary">Temporal</span>}
        </article>
      })}
    </div> : <div className="ws-empty-compact"><Clock3 size={22} /><strong>{view === 'active' ? 'Sin alertas activas.' : 'Sin registros en el historial.'}</strong></div>}
  </section>
}

export default function NotificationsPage() {
  const { records, loading, errors, lastSyncedAt } = useRecords()
  const { can, profile } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const today = businessDate(new Date())
  const view: NotificationView = location.hash === '#historial' ? 'history' : 'active'
  const selectView = (nextView: NotificationView) => {
    navigate({ pathname: location.pathname, hash: nextView === 'history' ? '#historial' : '' }, { replace: true })
  }
  const [notifications, setNotifications] = useState<OperationalNotification[]>([])
  const [listLoading, setListLoading] = useState(false)
  const [listError, setListError] = useState('')
  const [actionError, setActionError] = useState('')
  const [truncated, setTruncated] = useState(false)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [refreshVersion, setRefreshVersion] = useState(0)
  const notificationsContext = useOperationalNotifications()
  const globalSync = notificationsContext?.sync ?? { key: '', state: 'pending' as const }
  const globalRevision = notificationsContext?.revision ?? 0
  const accountId = profile?.id ?? ''
  const snapshot = useMemo(
    () => buildOperationalAlertSnapshot(records, can, { inventory: errors.inventory, finance: errors.finance, purchases: errors.purchases }, loading, today, { isStockAlert, money }),
    [can, errors.finance, errors.inventory, errors.purchases, loading, records.finance, records.inventory, records.purchases, today],
  )
  const { alertsBySource: alerts, readableSources, overflowSources, sources: syncSources, key: syncKey } = snapshot
  const localRows = useMemo(
    () => readableSources.flatMap(source => alerts[source].map((alert, index) => localNotification(alert, index))),
    [alerts, readableSources],
  )
  const hasSourceErrors = Boolean(errors.inventory || errors.finance || errors.purchases)
  const currentSync = globalSync.key === syncKey ? globalSync : { key: syncKey, state: 'pending' as const }
  const persistenceReady = currentSync.state === 'ok'
  const persistenceError = currentSync.state === 'error' ? currentSync.message : ''
  const permissionSources = useMemo<NotificationSource[]>(() => [
    ...(can('inventory') ? ['inventory' as const] : []),
    ...(can('finance') ? ['finance' as const] : []),
    ...(can('purchases') ? ['purchases' as const] : []),
    ...(can('approvals', 'ver') ? ['approvals' as const] : []),
  ], [can])

  useEffect(() => {
    if (!accountId) {
      setNotifications([])
      setListError('')
      setListLoading(false)
      setTruncated(false)
      return
    }
    let active = true
    setListLoading(true)
    setListError('')
    void listOperationalNotifications(view)
      .then(result => {
        if (!active) return
        setNotifications(result.rows)
        setTruncated(result.truncated)
      })
      .catch(error => {
        if (!active) return
        setNotifications([])
        setListError(friendlyError(error))
      })
      .finally(() => { if (active) setListLoading(false) })
    return () => { active = false }
  }, [accountId, globalRevision, refreshVersion, view])

  const visibleRows = useMemo(() => {
    const approvalRows = notifications.filter(item => item.fuente === 'approvals'
      && permissionSources.includes('approvals')
      && item.estado === 'active'
      && !item.archived_at)
    if (view === 'active') {
      if (!persistenceReady || listError) return [...localRows, ...approvalRows]
      const persisted = notifications.filter(item => item.fuente !== 'approvals' && syncSources.includes(item.fuente) && item.estado === 'active' && !item.archived_at)
      const localOverflow = localRows.filter(item => overflowSources.includes(item.fuente))
      return [...persisted, ...approvalRows, ...localOverflow]
    }
    return notifications.filter(item => permissionSources.includes(item.fuente) && (item.estado === 'resolved' || item.archived_at !== null))
  }, [listError, localRows, notifications, overflowSources, permissionSources, persistenceReady, syncSources, view])

  const onAction = async (notification: OperationalNotification, action: 'read' | 'archive') => {
    if (listError || notification.id.startsWith('local:')) return
    setPendingId(notification.id)
    setActionError('')
    try {
      await updateOperationalNotification(notification.id, action)
      setRefreshVersion(version => version + 1)
      notificationsContext?.refresh()
    } catch (error) {
      setActionError(friendlyError(error))
    } finally { setPendingId(null) }
  }

  const updated = lastSyncedAt ? new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeStyle: 'short' }).format(lastSyncedAt) : null
  const viewTitle = view === 'active' ? 'Alertas activas' : 'Historial de alertas'
  const pageBusy = loading || listLoading || currentSync.state === 'pending'

  return <>
    <PageHeader
      icon={Bell}
      section="Operación diaria"
      title="Centro de alertas"
      description="Consulta las señales actuales y el historial de alertas de tus módulos."
      actions={<span className="ws-real-data"><i />{pageBusy ? 'Actualizando alertas…' : updated ? `Datos sincronizados ${updated}` : 'Sin sincronización disponible'}</span>}
    />
    <div className="ws-notice" role="note"><Bell size={17} /><div><strong>Bandeja personal y persistente</strong><span>Las alertas operativas se actualizan desde los registros que puedes consultar. Las solicitudes y decisiones de aprobación generan avisos internos. Marcar como leída o archivar solo cambia tu bandeja; aprobar o rechazar se realiza en Aprobaciones.</span></div></div>
    {persistenceError && <div className="ws-notice ws-notice-warning" role="alert"><AlertTriangle size={17} /><div><strong>No se pudo sincronizar la bandeja</strong><span>{persistenceError} Mostramos las alertas actuales como una vista temporal; no se guardarán cambios hasta recuperar la conexión.</span></div></div>}
    {listError && !persistenceError && <div className="ws-notice ws-notice-warning" role="alert"><AlertTriangle size={17} /><div><strong>No se pudo consultar el historial</strong><span>{listError} Las alertas activas se muestran temporalmente desde los módulos disponibles.</span></div></div>}
    {actionError && <div className="ws-notice ws-notice-warning" role="alert"><AlertTriangle size={17} /><div><strong>No se guardó el cambio</strong><span>{actionError}</span></div></div>}
    {overflowSources.length > 0 && <div className="ws-notice ws-notice-warning" role="status"><RefreshCw size={17} /><div><strong>Actualización limitada para {overflowSources.map(source => sourceLabels[source]).join(', ')}</strong><span>Hay más de {MAX_ALERTS_PER_SOURCE} alertas activas en ese módulo. Se muestran en esta sesión, pero no se sincronizan para evitar archivar alertas válidas por un límite de envío.</span></div></div>}
    {hasSourceErrors && <div className="ws-notice ws-notice-warning" role="status"><AlertTriangle size={17} /><div><strong>Algunos módulos no se pudieron consultar</strong><span>Sus alertas no se sincronizaron ni se marcaron como resueltas. Corrige el acceso o actualiza los datos para revisar esa sección.</span></div></div>}
    {truncated && <div className="ws-notice" role="status"><Clock3 size={17} /><div><strong>Historial extenso</strong><span>Se muestran las 10 000 alertas más recientes. Las demás siguen guardadas.</span></div></div>}

    <div className="ws-notification-tabs" role="tablist" aria-label="Vistas del centro de alertas">
      <button type="button" role="tab" aria-selected={view === 'active'} className={view === 'active' ? 'is-active' : ''} onClick={() => selectView('active')}>Activas</button>
      <button type="button" role="tab" aria-selected={view === 'history'} className={view === 'history' ? 'is-active' : ''} onClick={() => selectView('history')}>Archivadas y resueltas</button>
      <span>{viewTitle}{pageBusy ? ' · actualizando' : ''}</span>
    </div>
    {view === 'history' && <div className="ws-notice" role="status"><Clock3 size={17} /><div><strong>Canales e historial de notificaciones</strong><span>Canales activos: bandeja interna persistente y alertas operativas automáticas para Inventario, Tesorería, Compras y Aprobaciones.</span></div></div>}
    <section className="ws-notification-grid" aria-label={viewTitle}>
      {(['inventory', 'finance', 'purchases', 'approvals'] as NotificationSource[]).map(source => {
        const sourceError = source === 'inventory' ? errors.inventory : source === 'finance' ? errors.finance : source === 'purchases' ? errors.purchases : undefined
        const sourceItems = visibleRows.filter(item => item.fuente === source)
        return <NotificationGroup
          key={source}
          source={source}
          items={sourceItems}
          error={can(sourcePages[source]) ? sourceError : undefined}
          loading={loading || listLoading}
          view={view}
          readOnly={(source !== 'approvals' && !persistenceReady) || Boolean(listError) || sourceItems.some(item => item.id.startsWith('local:'))}
          pendingId={pendingId}
          onOpen={path => navigate(path)}
          onRead={item => void onAction(item, 'read')}
          onArchive={item => void onAction(item, 'archive')}
        />
      })}
    </section>
  </>
}
