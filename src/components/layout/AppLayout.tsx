import { useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { AlertTriangle, Bell, ChevronDown, ChevronRight, Home, Info, LogOut, Menu, Moon, PanelLeftClose, PanelLeftOpen, RefreshCw, Search, ShieldCheck, Sun, UserRound, X } from 'lucide-react'
import ConfirmModal from '../ConfirmModal'
import RecordModal from '../RecordModal'
import SystemGuideButton from '../SystemGuideButton'
import { LogoMark } from '../LogoMark'
import { DATA_PAGES, pageMeta } from '../../data/catalog'
import { isStockAlert, money } from '../../data/helpers'
import { countMaintenanceIssues } from '../../data/maintenance'
import { matchesSearch, workspaceEntries } from '../../data/workspace'
import { useAuth } from '../../context/AuthContext'
import { useRecords } from '../../context/RecordsContext'
import { useTheme } from '../../context/ThemeContext'
import '../../workspace.css'

function storedCollapsed() {
  try { return localStorage.getItem('enterprisecloud-sidebar') === 'collapsed' } catch { return false }
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
  const [logoutOpen, setLogoutOpen] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const headerRef = useRef<HTMLElement>(null)

  const entries = workspaceEntries.filter(entry => !entry.page || can(entry.page))
  const active = workspaceEntries.find(entry => entry.path === location.pathname)
  const title = location.pathname === '/perfil' ? 'Mi perfil' : active?.label ?? 'Espacio de trabajo'
  const groups = [...new Set(entries.map(entry => entry.group))]
  const stockAlerts = records.inventory.filter(isStockAlert)
  const financeAlerts = records.finance.filter(item => item.status !== 'Completada')
  const purchaseAlerts = records.purchases.filter(item => item.status === 'Pendiente' || item.status === 'Solicitud' || item.status === 'Orden' || item.status === 'Recibida')
  const maintenanceIssues = useMemo(
    () => (can('settings') ? countMaintenanceIssues(records, catalog) : 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [records, catalog],
  )
  const errorCount = Object.keys(errors).length
  const alertCount = stockAlerts.length + financeAlerts.length + purchaseAlerts.length
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
          {groups.map(group => <section className="ws-nav-group" key={group}><span className="ws-nav-label">{group}</span>{entries.filter(entry => entry.group === group).map(entry => {
            const Icon = entry.icon
            return <NavLink key={entry.path} to={entry.path} end title={entry.label} aria-label={entry.label} className={({ isActive }) => `ws-nav-item${isActive ? ' is-active' : ''}`}><Icon size={18} /><span>{entry.label}</span>{entry.path === '/inventory' && stockAlerts.length > 0 && <b>{stockAlerts.length}</b>}{entry.path === '/mantenimientos' && maintenanceIssues > 0 && <b>{maintenanceIssues}</b>}</NavLink>
          })}</section>)}
        </nav>
        <div className="ws-sidebar-footer">
          <button className="ws-sidebar-profile" onClick={() => navigate('/perfil')} aria-label="Mi perfil — ver cuenta y permisos" data-tip="Mi perfil — ver cuenta y permisos"><span className="ws-avatar">{profile?.avatarUrl ? <img src={profile.avatarUrl} alt="" /> : initials}</span><span><strong>{fullName}</strong><small>{profile?.rol}</small></span><ChevronRight size={15} /></button>
          <div className="ws-sidebar-version"><span><i /> Supabase Auth</span><button onClick={() => setLogoutOpen(true)} aria-label="Cerrar sesión" data-tip="Cerrar sesión"><LogOut size={16} /></button></div>
        </div>
      </aside>

      <div className="app-main ws-main">
        <header className="topbar ws-topbar" ref={headerRef}>
          <div className="ws-topbar-location"><button className="ws-icon-button ws-desktop-toggle" onClick={() => setCollapsed(value => !value)} aria-label={collapsed ? 'Expandir menú' : 'Contraer menú'} data-tip={collapsed ? 'Expandir menú' : 'Contraer menú'}>{collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}</button><button className="ws-icon-button ws-mobile-toggle" onClick={() => setMobileOpen(true)} aria-label="Abrir menú" data-tip="Abrir menú"><Menu size={20} /></button><nav className="ws-breadcrumb" aria-label="Ubicación"><Home size={14} /><span>{active?.group.toLocaleLowerCase('es') ?? 'Cuenta'}</span><ChevronRight size={13} /><strong>{title}</strong></nav></div>
          <div className="ws-topbar-actions">
            <div className="ws-search"><Search size={16} /><input ref={searchRef} value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar registros o módulos…" aria-label="Buscar en el sistema" role="combobox" aria-expanded={Boolean(query)} aria-controls="workspace-results" autoComplete="off" /><kbd>Ctrl K</kbd>
              {query && <div className="ws-search-results" id="workspace-results" role="listbox" aria-label="Resultados de búsqueda">{moduleResults.map(entry => <button key={entry.path} role="option" aria-selected={false} onClick={() => navigate(entry.path)}><entry.icon size={17} /><span><strong>{entry.label}</strong><small>Módulo · {entry.group.toLocaleLowerCase('es')}</small></span><ChevronRight size={14} /></button>)}{results.map(({ page, item }) => <button key={`${page}-${item.id}`} role="option" aria-selected={false} onClick={() => navigate(`/${page}?q=${encodeURIComponent(item.id)}`)}><Search size={16} /><span><strong>{item.name}</strong><small>{pageMeta[page].title} · {item.id}</small></span><ChevronRight size={14} /></button>)}{!moduleResults.length && !results.length && <p>No encontramos coincidencias en tus datos.</p>}</div>}
            </div>
            <SystemGuideButton variant="topbar" />
            <button className="ws-icon-button" onClick={() => void reload()} disabled={loading || refreshing} aria-label="Actualizar datos desde Supabase" data-tip="Actualizar datos desde Supabase"><RefreshCw size={17} className={loading || refreshing ? 'ws-spin' : ''} /></button>
            <button className="ws-icon-button" onClick={toggleTheme} aria-label={theme === 'dark' ? 'Activar modo claro' : 'Activar modo oscuro'} data-tip={theme === 'dark' ? 'Activar modo claro' : 'Activar modo oscuro'}>{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button>
            <div className="ws-popover-wrap"><button className="ws-icon-button ws-bell" onClick={() => { setNotificationsOpen(value => !value); setProfileOpen(false) }} aria-label="Centro de alertas — ver notificaciones" data-tip="Centro de alertas — ver notificaciones" aria-expanded={notificationsOpen}><Bell size={18} />{alertCount > 0 && <i />}</button>{notificationsOpen && <div className="ws-popover ws-notifications"><div className="ws-popover-heading"><strong>Centro de alertas</strong><span>{alertCount}</span></div>{stockAlerts.slice(0, 3).map(item => <button key={item.id} onClick={() => navigate(`/inventory?q=${encodeURIComponent(item.id)}`)}><AlertTriangle size={17} /><span><strong>{item.name}</strong><small>{item.quantity ?? 0} unidades · {item.status}</small></span></button>)}{financeAlerts.slice(0, 2).map(item => <button key={item.id} onClick={() => navigate(`/finance?q=${encodeURIComponent(item.id)}`)}><Bell size={16} /><span><strong>{item.name}</strong><small>{money(item.amount)} · {item.status}</small></span></button>)}{purchaseAlerts.slice(0, 1).map(item => <button key={item.id} onClick={() => navigate(`/purchases?q=${encodeURIComponent(item.id)}`)}><AlertTriangle size={16} /><span><strong>{item.id}</strong><small>Compra por recibir · {item.name}</small></span></button>)}{!alertCount && <p>Sin alertas en los registros consultados.</p>}<small className="ws-popover-foot">Calculado sobre tus registros de Supabase.</small></div>}</div>
            <div className="ws-popover-wrap"><button className="ws-account-button" onClick={() => { setProfileOpen(value => !value); setNotificationsOpen(false) }} aria-label="Menú de usuario" data-tip="Menú de usuario" aria-expanded={profileOpen}><span className="ws-avatar">{profile?.avatarUrl ? <img src={profile.avatarUrl} alt="" /> : initials}</span><ChevronDown size={13} /></button>{profileOpen && <div className="ws-popover ws-account"><strong>{fullName}</strong><small>{profile?.email}</small><span className="ws-role"><ShieldCheck size={12} />{profile?.rol}</span><button onClick={() => navigate('/perfil')}><UserRound size={16} />Mi perfil</button><button onClick={() => setLogoutOpen(true)}><LogOut size={16} />Cerrar sesión</button></div>}</div>
          </div>
        </header>
        <main className="content-area ws-content" id="workspace-content" tabIndex={-1}>
          {errorCount > 0 && <div className="ws-notice ws-notice-warning" role="alert"><AlertTriangle size={18} /><div><strong>{errorCount} {errorCount === 1 ? 'módulo requiere' : 'módulos requieren'} atención</strong><span>{Object.entries(errors).map(([page, message]) => `${pageMeta[page as keyof typeof pageMeta].title}: ${message}`).join(' · ')}</span></div><button className="ws-text-button" onClick={() => void reload()}>Reintentar</button></div>}
          <Outlet />
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
