import { useEffect, useState } from 'react'
import { Activity, RefreshCw, Search, ShieldCheck } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { fetchAuditModules, fetchAuditTrail, friendlyError, type AuditEntry } from '../services/records'

const PAGE_SIZE = 50
const ACTIONS = [
  { value: '', label: 'Todas las acciones' },
  { value: 'INSERT', label: 'Creación' },
  { value: 'UPDATE', label: 'Edición' },
  { value: 'DELETE', label: 'Eliminación' },
]
const MODULE_LABELS: Record<string, string> = {
  clientes: 'Clientes',
  compras: 'Compras',
  configuracion: 'Configuración',
  pagos: 'Pagos y tesorería',
  productos: 'Productos',
  proveedor_productos: 'Catálogo de proveedores',
  proveedores: 'Proveedores',
  usuarios: 'Usuarios',
  ventas: 'Ventas',
}

function eventTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Fecha no disponible' : date.toLocaleString('es-PE', { dateStyle: 'medium', timeStyle: 'short' })
}

function actionLabel(value: string) {
  return ACTIONS.find(action => action.value === value)?.label ?? value
}

export default function AuditPage() {
  const { can } = useAuth()
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [modules, setModules] = useState<string[]>([])
  const [total, setTotal] = useState(0)
  const [module, setModule] = useState('')
  const [action, setAction] = useState('')
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const allowed = can('audit', 'ver')
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

  useEffect(() => {
    if (!allowed) return
    let current = true
    void fetchAuditModules().then(result => { if (current) setModules(result) }).catch(reason => { if (current) setError(friendlyError(reason)) })
    return () => { current = false }
  }, [allowed])

  useEffect(() => {
    if (!allowed) { setLoading(false); return }
    let current = true
    setLoading(true)
    setError('')
    void fetchAuditTrail({ limit: PAGE_SIZE, offset: page * PAGE_SIZE, modulo: module || undefined, accion: action || undefined })
      .then(result => {
        if (!current) return
        setEntries(result.entries)
        setTotal(result.total)
      })
      .catch(reason => { if (current) { setEntries([]); setTotal(0); setError(friendlyError(reason)) } })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [allowed, module, action, page, refreshKey])

  if (!allowed) return <section className="ws-card ws-empty-compact"><ShieldCheck size={28} /><strong>Acceso restringido a la bitácora</strong><span>Tu rol necesita el permiso de consulta de auditoría.</span></section>

  const firstRow = total ? page * PAGE_SIZE + 1 : 0
  const lastRow = Math.min((page + 1) * PAGE_SIZE, total)

  return <>
    <section className="ws-page-heading"><div><span className="ws-eyebrow">SEGURIDAD Y AUDITORÍA</span><h1>Bitácora de operaciones</h1><p>Consulta cambios registrados en la base, quién los realizó y cuándo ocurrieron.</p></div><div className="ws-heading-actions"><button className="ws-button ws-button-secondary" disabled={loading} onClick={() => setRefreshKey(value => value + 1)}><RefreshCw size={16} className={loading ? 'ws-spin' : ''} />Actualizar</button></div></section>
    {error && <div className="ws-notice ws-notice-warning" role="alert">{error}<button className="ws-text-button" type="button" onClick={() => setRefreshKey(value => value + 1)}>Reintentar</button></div>}
    <section className="ws-card">
      <div className="ws-module-toolbar">
        <label className="ws-control"><Search size={15} /><select value={module} onChange={event => { setModule(event.target.value); setPage(0) }} aria-label="Filtrar por módulo"><option value="">Todos los módulos</option>{modules.map(item => <option key={item} value={item}>{MODULE_LABELS[item] ?? item}</option>)}</select></label>
        <label className="ws-control"><Activity size={15} /><select value={action} onChange={event => { setAction(event.target.value); setPage(0) }} aria-label="Filtrar por acción">{ACTIONS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <span className="relation-hint">{total} {total === 1 ? 'evento' : 'eventos'} visibles para tu permiso</span>
      </div>
      <div className="table-scroll"><table className="record-table"><thead><tr><th>Fecha y hora</th><th>Usuario</th><th>Módulo</th><th>Acción</th><th>Registro</th><th>Resultado</th></tr></thead><tbody>
        {entries.map(entry => <tr key={entry.id}><td>{eventTime(entry.createdAt)}</td><td>{entry.email ?? 'Usuario no disponible'}</td><td>{MODULE_LABELS[entry.modulo] ?? entry.modulo}</td><td><span className={`status-pill ${entry.accion === 'DELETE' ? 'red' : entry.accion === 'INSERT' ? 'green' : 'amber'}`}>{actionLabel(entry.accion)}</span></td><td><span className="record-id">{entry.registro ?? '—'}</span></td><td>{entry.resultado}</td></tr>)}
        {!entries.length && !loading && !error && <tr><td colSpan={6}><div className="ws-empty-compact"><ShieldCheck size={26} /><strong>No hay eventos para estos filtros</strong><span>Prueba otra acción o módulo, o actualiza la bitácora.</span></div></td></tr>}
        {loading && <tr><td colSpan={6}><div className="ws-empty-compact"><RefreshCw size={20} className="ws-spin" /><strong>Cargando eventos…</strong></div></td></tr>}
      </tbody></table></div>
      <div className="ws-pagination"><span>Mostrando {firstRow}–{lastRow} de {total}</span><div><button className="ws-icon-button" type="button" disabled={page === 0 || loading} onClick={() => setPage(value => Math.max(0, value - 1))} aria-label="Página anterior">‹</button><span>{page + 1} / {pageCount}</span><button className="ws-icon-button" type="button" disabled={page + 1 >= pageCount || loading} onClick={() => setPage(value => Math.min(pageCount - 1, value + 1))} aria-label="Página siguiente">›</button></div></div>
    </section>
    <p className="relation-hint ws-audit-footnote">La bitácora actual cubre cambios en varios maestros y documentos. Las recepciones, movimientos de inventario, aplicaciones de tesorería, sucursales y zonas requieren ampliar la cobertura de auditoría en una etapa de base de datos.</p>
  </>
}
