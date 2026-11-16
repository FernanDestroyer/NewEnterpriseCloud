import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { AlertTriangle, Bell, Boxes, ChevronDown, ChevronRight, ClipboardCheck, Home, Info, LogOut, Menu, Moon, PanelLeftClose, PanelLeftOpen, RefreshCw, ScanSearch, Search, ShieldCheck, ShoppingCart, Sun, UserRound, Wallet, X } from 'lucide-react'
import ConfirmModal from '../ConfirmModal'
import RecordModal from '../RecordModal'
import SystemGuideButton from '../SystemGuideButton'
import { LogoMark } from '../LogoMark'
import { DATA_PAGES, pageMeta } from '../../data/catalog'
import { isStockAlert, money } from '../../data/helpers'
import { buildOperationalAlertSnapshot, type NotificationSource } from '../../data/operationalAlerts'
import { businessDate } from '../../data/workspace'
import { countMaintenanceIssues } from '../../data/maintenance'
import { matchesSearch, submoduleMatchesLocation, workspaceEntries, workspaceModules } from '../../data/workspace'
import { useAuth } from '../../context/AuthContext'
import { OperationalNotificationsProvider } from '../../context/OperationalNotificationsContext'
import { useRecords } from '../../context/RecordsContext'
import { useTheme } from '../../context/ThemeContext'
import { APPROVAL_QUEUE_CHANGED_EVENT, fetchApprovals } from '../../services/approvals'
import { listOperationalNotifications, syncOperationalNotifications, type OperationalNotification } from '../../services/notifications'
import '../../workspace.css'

function storedCollapsed() {
  try { return localStorage.getItem('enterprisecloud-sidebar') === 'collapsed' } catch { return false }
}

function notificationPath(source: NotificationSource, reference: string) {
  if (source === 'approvals') return '/aprobaciones'
  const path = source === 'inventory' ? '/inventario/existencias' : source === 'finance' ? '/finance' : '/purchases'
  return `${path}?q=${encodeURIComponent(reference)}`
}

export default function AppLayout() {
  const { theme, toggleTheme } = useTheme()
  const { profile, signOut, can } = useAuth()
  const { records, toast, notify, loading, refreshing, reload, lastSyncedAt, errors, recordModal, saving, saveRecord, closeRecordModal, pendingDelete, cancelDelete, confirmDelete, catalog } = useRecords()
  const navigate = useNavigate()
  const location = useLocation()
  const [query, setQuery] = useState('')
  const [mobileOpen, setMobileOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(storedCollapsed)
  const [openModule, setOpenModule] = useState<string | null>(() => workspaceModules.find(module => module.children.some(child => submoduleMatchesLocation(child.path, location.pathname, location.hash)))?.id ?? null)
  const [logoutOpen, setLogoutOpen] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [notificationSync, setNotificationSync] = useState<{ key: string; state: 'pending' | 'ok' | 'error'; message?: string }>({ key: '', state: 'pending' })
  const [notificationRevision, setNotificationRevision] = useState(0)
  const [persistedNotifications, setPersistedNotifications] = useState<OperationalNotification[]>([])
  const [notificationListError, setNotificationListError] = useState(false)
  const [approvalQueueRevision, setApprovalQueueRevision] = useState(0)
  const [pendingApprovalCount, setPendingApprovalCount] = useState<number | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const headerRef = useRef<HTMLElement>(null)
  const refreshNotifications = useCallback(() => setNotificationRevision(value => value + 1), [])

  const entries = workspaceEntries.filter(entry => (!entry.page || can(entry.page)) && (!entry.permission || can(entry.permission)))
  const visibleModules = workspaceModules
    .map(module => ({ ...module, children: module.children.filter(child => !child.permission || can(child.permission)) }))
    .filter(module => module.children.length > 0)
  const active = workspaceEntries.find(entry => entry.path === location.pathname)
  const activeModule = visibleModules.find(module => module.children.some(child => submoduleMatchesLocation(child.path, location.pathname, location.hash)))
  const activeSubmodule = activeModule?.children.find(child => submoduleMatchesLocation(child.path, location.pathname, location.hash))
  const title = location.pathname === '/perfil' ? 'Mi perfil' : activeSubmodule?.label ?? active?.label ?? 'Espacio de trabajo'
  const today = businessDate(new Date())
  const notificationSnapshot = useMemo(
    () => buildOperationalAlertSnapshot(records, can, { inventory: errors.inventory, finance: errors.finance, purchases: errors.purchases }, loading, today, { isStockAlert, money }),
    [can, errors.finance, errors.inventory, errors.purchases, loading, records.finance, records.inventory, records.purchases, today],
  )
  const stockAlerts = notificationSnapshot.readableSources.includes('inventory') ? notificationSnapshot.alertsBySource.inventory : []
  const financeAlerts = notificationSnapshot.readableSources.includes('finance') ? notificationSnapshot.alertsBySource.finance : []
  const purchaseAlerts = notificationSnapshot.readableSources.includes('purchases') ? notificationSnapshot.alertsBySource.purchases : []
  const maintenanceIssues = useMemo(
    () => (can('settings') ? countMaintenanceIssues(records, catalog) : 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [records, catalog],
  )
  const errorCount = Object.keys(errors).length
  const fallbackAlertCount = stockAlerts.length + financeAlerts.length + purchaseAlerts.length
  const canViewApprovals = can('approvals', 'ver') || can('approvals', 'aprobar')
  const currentNotificationSync = notificationSync.key === notificationSnapshot.key ? notificationSync : { key: notificationSnapshot.key, state: 'pending' as const }
  const usePersistedNotifications = currentNotificationSync.state === 'ok' && !notificationListError
  const persistedUnread = persistedNotifications.filter(item => !item.read_at && (item.fuente === 'approvals'
    ? can('approvals', 'ver')
    : notificationSnapshot.sources.includes(item.fuente)))
  const overflowAlerts = notificationSnapshot.overflowSources.flatMap(source => notificationSnapshot.alertsBySource[source])
  const alertCount = usePersistedNotifications ? persistedUnread.length + overflowAlerts.length : fallbackAlertCount
  const notificationPreview = useMemo(() => {
    const toPreview = (item: Pick<OperationalNotification, 'id' | 'fuente' | 'referencia' | 'titulo' | 'detalle'>) => ({
      id: item.id,
      fuente: item.fuente,
      titulo: item.titulo,
      detalle: item.detalle,
      path: notificationPath(item.fuente, item.referencia),
    })
    if (usePersistedNotifications) {
      const saved = persistedUnread.map(toPreview)
      const overflow = overflowAlerts.map((item, index) => ({
        id: `temporary:${item.fuente}:${index}:${item.clave_fuente}`,
        fuente: item.fuente,
        titulo: item.titulo,
        detalle: item.detalle,
        path: notificationPath(item.fuente, item.referencia),
      }))
      return [...saved, ...overflow].slice(0, 6)
    }
    return notificationSnapshot.readableSources.flatMap(source => notificationSnapshot.alertsBySource[source].map((item, index) => ({
      id: `temporary:${source}:${index}:${item.clave_fuente}`,
      fuente: source,
      titulo: item.titulo,
      detalle: item.detalle,
      path: notificationPath(source, item.referencia),
    }))).slice(0, 6)
  }, [notificationSnapshot, overflowAlerts, persistedUnread, usePersistedNotifications])
  const fullName = profile?.nombre ?? ''
  const initials = fullName.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toLocaleUpperCase('es')

  const results = useMemo(() => {
    if (!query.trim()) return []
    return DATA_PAGES.filter(page => can(page) && workspaceEntries.some(entry => entry.page === page)).flatMap(page => records[page].filter(item => matchesSearch(item, query)).map(item => ({ page, item }))).slice(0, 6)
  }, [query, records, can])
  const moduleResults = query.trim() ? entries.filter(entry => entry.label.toLocaleLowerCase('es').includes(query.toLocaleLowerCase('es'))).slice(0, 3) : []

  useEffect(() => {
    try { localStorage.setItem('enterprisecloud-sidebar', collapsed ? 'collapsed' : 'expanded') } catch { /* El menú también funciona sin almacenamiento local. */ }
  }, [collapsed])

  useEffect(() => {
    setMobileOpen(false)
    setNotificationsOpen(false)
    setProfileOpen(false)
    setQuery('')
  }, [location.pathname])

  useEffect(() => {
    const currentModule = workspaceModules.find(module => module.children.some(child => submoduleMatchesLocation(child.path, location.pathname, location.hash)))
    if (currentModule) setOpenModule(currentModule.id)
  }, [location.pathname, location.hash])

  // Produce the inbox from the same complete snapshots that power the app, not
  // only when a person opens the notification route.
  useEffect(() => {
    if (loading || !profile?.id) return
    let active = true
    setNotificationSync({ key: notificationSnapshot.key, state: 'pending' })
    void (async () => {
      try {
        if (notificationSnapshot.sources.length) {
          await syncOperationalNotifications(notificationSnapshot.sources, notificationSnapshot.alerts)
        }
        if (!active) return
        setNotificationSync({ key: notificationSnapshot.key, state: 'ok' })
        refreshNotifications()
      } catch (error) {
        if (active) setNotificationSync({
          key: notificationSnapshot.key,
          state: 'error',
          message: error instanceof Error ? error.message : String(error),
        })
      }
    })()
    return () => { active = false }
  }, [loading, notificationSnapshot, profile?.id, refreshNotifications])

  useEffect(() => {
    if (!profile?.id) {
      setPersistedNotifications([])
      setNotificationListError(false)
      return
    }
    let active = true
    setNotificationListError(false)
    void listOperationalNotifications('active')
      .then(result => {
        if (!active) return
        setPersistedNotifications(result.rows)
      })
      .catch(() => {
        if (!active) return
        setPersistedNotifications([])
        setNotificationListError(true)
      })
    return () => { active = false }
  }, [notificationRevision, profile?.id])

  useEffect(() => {
    const refreshApprovalCount = () => setApprovalQueueRevision(value => value + 1)
    window.addEventListener(APPROVAL_QUEUE_CHANGED_EVENT, refreshApprovalCount)
    return () => window.removeEventListener(APPROVAL_QUEUE_CHANGED_EVENT, refreshApprovalCount)
  }, [])

  useEffect(() => {
    if (!profile?.id || !canViewApprovals) {
      setPendingApprovalCount(null)
      return
    }
    let active = true
    void fetchApprovals('pending', 0)
      .then(result => { if (active) setPendingApprovalCount(result.total) })
      .catch(() => { if (active) setPendingApprovalCount(null) })
    return () => { active = false }
  }, [approvalQueueRevision, canViewApprovals, profile?.id])

  const notificationsContextValue = useMemo(() => ({
    sync: currentNotificationSync,
    revision: notificationRevision,
    refresh: refreshNotifications,
  }), [currentNotificationSync, notificationRevision, refreshNotifications])

  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      const typing = target?.closest('input,textarea,select,[contenteditable="true"]')
      if (((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') || (event.key === '/' && !typing)) {
        event.preventDefault()
        searchRef.current?.focus()
      }
      if (event.key === 'Escape') { setQuery(''); setNotificationsOpen(false); setProfileOpen(false); setMobileOpen(false) }
    }
    const outside = (event: MouseEvent) => {
      if (!headerRef.current?.contains(event.target as Node)) { setNotificationsOpen(false); setProfileOpen(false); setQuery('') }
    }
    window.addEventListener('keydown', keyboard)
    window.addEventListener('mousedown', outside)
    return () => { window.removeEventListener('keydown', keyboard); window.removeEventListener('mousedown', outside) }
  }, [])

  const logout = async () => {
    setLoggingOut(true)
    try { await signOut(); navigate('/login', { replace: true }) }
    catch (error) { notify((error as Error).message) }
    finally { setLoggingOut(false); setLogoutOpen(false) }
  }

  return (
    <div className={`erp-shell workspace-shell${collapsed ? ' ws-collapsed' : ''}${mobileOpen ? ' ws-mobile-open' : ''}`} data-theme={theme}>
      <a className="ws-skip" href="#workspace-content">Ir al contenido</a>
      {mobileOpen && <button className="ws-scrim" onClick={() => setMobileOpen(false)} aria-label="Cerrar navegación" />}
      <aside className="sidebar ws-sidebar">
        <NavLink className="ws-brand" to="/dashboard" aria-label="EnterpriseCloud, panel de control">
          <span className="ws-brand-icon"><LogoMark className="ws-brand-mark" /></span>
          <span className="ws-brand-copy"><strong>Enterprise<span>Cloud</span></strong><small>ERP / CLOUD</small></span>
        </NavLink>
        <button className="ws-mobile-close ws-icon-button" onClick={() => setMobileOpen(false)} aria-label="Cerrar menú" data-tip="Cerrar menú"><X size={19} /></button>
        <nav className="ws-navigation" aria-label="Módulos del ERP">
          {visibleModules.map(module => {
            const Icon = module.icon
            const expanded = openModule === module.id
            const containsActivePage = module.children.some(child => submoduleMatchesLocation(child.path, location.pathname, location.hash))
            return <section className="ws-module-group" key={module.id}>
              <button
                type="button"
                className={`ws-module-trigger${expanded ? ' is-open' : ''}${containsActivePage ? ' has-active' : ''}`}
                title={module.label}
                aria-label={module.label}
                aria-expanded={expanded}
                aria-controls={`ws-module-${module.id}`}
                onClick={() => {
                  if (collapsed) {
                    setCollapsed(false)
                    setOpenModule(module.id)
                    return
                  }
                  setOpenModule(current => current === module.id ? null : module.id)
                }}
              >
                <Icon size={18} />
                <span className="ws-module-label">{module.label}</span>
                <ChevronDown className={`ws-module-chevron${expanded ? ' is-open' : ''}`} size={15} />
              </button>
              <div className="ws-module-children" id={`ws-module-${module.id}`} hidden={!expanded}>
                {module.children.map((child, index) => {
                  const ChildIcon = child.icon
                  const key = `${module.id}-${child.label}-${index}`
                  if (child.path) return <NavLink key={key} to={child.path} end title={child.label} aria-label={child.label} className={({ isActive }) => `ws-submodule-link${isActive && submoduleMatchesLocation(child.path, location.pathname, location.hash) ? ' is-active' : ''}`}>
                    {ChildIcon && <ChildIcon size={15} />}
                    <span>{child.label}</span>
                    {child.path === '/inventario/existencias' && stockAlerts.length > 0 && <b>{stockAlerts.length}</b>}
                    {child.path === '/mantenimientos#catalogos' && maintenanceIssues > 0 && <b>{maintenanceIssues}</b>}
                    {child.path === '/notificaciones' && alertCount > 0 && <b>{Math.min(alertCount, 99)}</b>}
                    {child.path === '/aprobaciones' && (pendingApprovalCount ?? 0) > 0 && <b>{Math.min(pendingApprovalCount ?? 0, 99)}</b>}
                    {child.availability === 'partial' && <small className="ws-submodule-status is-partial">Parcial</small>}
                  </NavLink>
                  if (child.action === 'notifications') return <button key={key} type="button" className="ws-submodule-action" onClick={() => { setNotificationsOpen(true); setProfileOpen(false); setMobileOpen(false) }}>
                    {ChildIcon && <ChildIcon size={15} />}<span>{child.label}</span><ChevronRight size={13} />
                  </button>
                  return <div key={key} className="ws-submodule-disabled" aria-label={`${child.label}, ${child.availability === 'optional' ? 'opcional' : 'próximamente'}`}>
                    {ChildIcon && <ChildIcon size={15} />}<span>{child.label}</span><small>{child.availability === 'optional' ? 'Opcional' : 'Próximamente'}</small>
                  </div>
                })}
              </div>
            </section>
          })}
          {can('analizador') && <section className="ws-nav-group"><span className="ws-nav-label">HERRAMIENTAS</span><NavLink to="/analizador" end title="Analizador de proyectos" aria-label="Analizador de proyectos" className={({ isActive }) => `ws-nav-item${isActive ? ' is-active' : ''}`}><ScanSearch size={18} /><span>Analizador de proyectos</span></NavLink></section>}
        </nav>
        <div className="ws-sidebar-footer">
          <button className="ws-sidebar-profile" onClick={() => navigate('/perfil')} aria-label="Mi perfil — ver cuenta y permisos" data-tip="Mi perfil — ver cuenta y permisos"><span className="ws-avatar">{profile?.avatarUrl ? <img src={profile.avatarUrl} alt="" /> : initials}</span><span><strong>{fullName}</strong><small>{profile?.rol}</small></span><ChevronRight size={15} /></button>
          <div className="ws-sidebar-version"><span><i /> Supabase Auth</span><button onClick={() => setLogoutOpen(true)} aria-label="Cerrar sesión" data-tip="Cerrar sesión"><LogOut size={16} /></button></div>
        </div>
      </aside>

      <div className="app-main ws-main">
        <header className="topbar ws-topbar" ref={headerRef}>
          <div className="ws-topbar-location"><button className="ws-icon-button ws-desktop-toggle" onClick={() => setCollapsed(value => !value)} aria-label={collapsed ? 'Expandir menú' : 'Contraer menú'} data-tip={collapsed ? 'Expandir menú' : 'Contraer menú'}>{collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}</button><button className="ws-icon-button ws-mobile-toggle" onClick={() => setMobileOpen(true)} aria-label="Abrir menú" data-tip="Abrir menú"><Menu size={20} /></button><nav className="ws-breadcrumb" aria-label="Ubicación"><Home size={14} /><span>{activeModule?.label ?? (active?.group.toLocaleLowerCase('es') ?? 'Cuenta')}</span><ChevronRight size={13} /><strong>{title}</strong></nav></div>
          <div className="ws-topbar-actions">
            <div className="ws-search"><Search size={16} /><input ref={searchRef} value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar registros o módulos…" aria-label="Buscar en el sistema" role="combobox" aria-expanded={Boolean(query)} aria-controls="workspace-results" autoComplete="off" /><kbd>Ctrl K</kbd>
              {query && <div className="ws-search-results" id="workspace-results" role="listbox" aria-label="Resultados de búsqueda">{moduleResults.map(entry => <button key={entry.path} role="option" aria-selected={false} onClick={() => navigate(entry.path)}><entry.icon size={17} /><span><strong>{entry.label}</strong><small>Módulo · {entry.group.toLocaleLowerCase('es')}</small></span><ChevronRight size={14} /></button>)}{results.map(({ page, item }) => <button key={`${page}-${item.id}`} role="option" aria-selected={false} onClick={() => navigate(`/${page}?q=${encodeURIComponent(item.id)}`)}><Search size={16} /><span><strong>{item.name}</strong><small>{pageMeta[page].title} · {item.id}</small></span><ChevronRight size={14} /></button>)}{!moduleResults.length && !results.length && <p>No encontramos coincidencias en tus datos.</p>}</div>}
            </div>
            <SystemGuideButton variant="topbar" />
            <button className="ws-icon-button" onClick={() => void reload()} disabled={loading || refreshing} aria-label="Actualizar datos desde Supabase" data-tip="Actualizar datos desde Supabase"><RefreshCw size={17} className={loading || refreshing ? 'ws-spin' : ''} /></button>
            <button className="ws-icon-button" onClick={toggleTheme} aria-label={theme === 'dark' ? 'Activar modo claro' : 'Activar modo oscuro'} data-tip={theme === 'dark' ? 'Activar modo claro' : 'Activar modo oscuro'}>{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button>
            <div className="ws-popover-wrap"><button className="ws-icon-button ws-bell" onClick={() => { setNotificationsOpen(value => !value); setProfileOpen(false) }} aria-label="Centro de alertas y pendientes" data-tip="Centro de alertas y pendientes" aria-expanded={notificationsOpen}><Bell size={18} />{(alertCount > 0 || (pendingApprovalCount ?? 0) > 0) && <i />}</button>{notificationsOpen && <div className="ws-popover ws-notifications"><div className="ws-popover-heading"><strong>Centro de alertas</strong><span>{alertCount}</span></div>{notificationPreview.map(item => <button key={item.id} onClick={() => { navigate(item.path); setNotificationsOpen(false) }}>{item.fuente === 'inventory' ? <Boxes size={17} /> : item.fuente === 'finance' ? <Wallet size={16} /> : item.fuente === 'approvals' ? <ClipboardCheck size={17} /> : <ShoppingCart size={16} />}<span><strong>{item.titulo}</strong><small>{item.detalle}</small></span></button>)}{(pendingApprovalCount ?? 0) > 0 && <button onClick={() => { navigate('/aprobaciones'); setNotificationsOpen(false) }}><ClipboardCheck size={17} /><span><strong>Aprobaciones pendientes</strong><small>{pendingApprovalCount} solicitudes pendientes visibles en tu bandeja.</small></span></button>}{!alertCount && !(pendingApprovalCount ?? 0) && <p>Sin alertas ni aprobaciones pendientes.</p>}<button className="ws-notifications-all" onClick={() => { navigate('/notificaciones'); setNotificationsOpen(false) }}>Abrir centro de alertas <ChevronRight size={14} /></button><small className="ws-popover-foot">{usePersistedNotifications ? 'Alertas no leídas en tu bandeja.' : 'Vista temporal mientras se actualiza la bandeja.'}</small></div>}</div>
            <div className="ws-popover-wrap"><button className="ws-account-button" onClick={() => { setProfileOpen(value => !value); setNotificationsOpen(false) }} aria-label="Menú de usuario" data-tip="Menú de usuario" aria-expanded={profileOpen}><span className="ws-avatar">{profile?.avatarUrl ? <img src={profile.avatarUrl} alt="" /> : initials}</span><ChevronDown size={13} /></button>{profileOpen && <div className="ws-popover ws-account"><strong>{fullName}</strong><small>{profile?.email}</small><span className="ws-role"><ShieldCheck size={12} />{profile?.rol}</span><button onClick={() => navigate('/perfil')}><UserRound size={16} />Mi perfil</button><button onClick={() => setLogoutOpen(true)}><LogOut size={16} />Cerrar sesión</button></div>}</div>
          </div>
        </header>
        <main className="content-area ws-content" id="workspace-content" tabIndex={-1}>
          {errorCount > 0 && <div className="ws-notice ws-notice-warning" role="alert"><AlertTriangle size={18} /><div><strong>{errorCount} {errorCount === 1 ? 'módulo requiere' : 'módulos requieren'} atención</strong><span>{Object.entries(errors).map(([page, message]) => `${pageMeta[page as keyof typeof pageMeta].title}: ${message}`).join(' · ')}</span></div><button className="ws-text-button" onClick={() => void reload()}>Reintentar</button></div>}
          <OperationalNotificationsProvider value={notificationsContextValue}>
            <Outlet />
          </OperationalNotificationsProvider>
          <footer className="ws-footer"><span>EnterpriseCloud · Tu operación, en un solo lugar.</span><span className={errorCount ? 'has-error' : ''}><i />{loading ? 'Consultando Supabase…' : lastSyncedAt ? `Última consulta: ${lastSyncedAt.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}` : 'Sin datos cargados'}</span></footer>
        </main>
      </div>
      {recordModal && <RecordModal key={`${recordModal.page}-${recordModal.record?.id ?? 'new'}`} page={recordModal.page} record={recordModal.record} saving={saving} onClose={closeRecordModal} onSave={event => saveRecord(recordModal.page, recordModal.record, event)} />}
      {logoutOpen && <ConfirmModal title="Cerrar sesión" message="Tus operaciones quedan guardadas en Supabase. Volverás a la pantalla de acceso." confirmLabel="Cerrar sesión" busy={loggingOut} onCancel={() => setLogoutOpen(false)} onConfirm={logout} />}
      {pendingDelete && <ConfirmModal title="Eliminar registro" message={`¿Eliminar «${pendingDelete.record.name}» (${pendingDelete.record.id}) de la base de datos?`} confirmLabel="Eliminar registro" onCancel={cancelDelete} onConfirm={confirmDelete} />}
      {toast && <div className="toast ws-toast" role="status"><Info size={18} />{toast}</div>}
    </div>
  )
}
