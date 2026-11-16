import { useEffect, useState } from 'react'
import { RefreshCw, ShieldCheck } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { fetchAuditModules, fetchAuditTrail, friendlyError, type AuditEntry } from '../services/records'
import { SearchablePicker } from './SearchablePicker'
import { PageHeader } from './ui/PageHeader'

const PAGE_SIZE = 50
const ACTIONS = [
  { value: '', label: 'Todas las acciones' },
  { value: 'INSERT', label: 'Creación' },
  { value: 'UPDATE', label: 'Edición' },
  { value: 'DELETE', label: 'Eliminación' },
]
const MODULE_LABELS: Record<string, string> = {
  ajustes_comision: 'Ajustes de comisión',
  ajustes_inventario: 'Ajustes de inventario',
  almacenes: 'Almacenes',
  aplicaciones_pago: 'Aplicaciones de pago',
  aprobaciones: 'Aprobaciones',
  auditoria: 'Auditoría',
  caja_turnos: 'Turnos de caja',
  cajas: 'Cajas',
  carpetas_importacion: 'Importaciones',
  carpetas_importacion_historial: 'Historial de importaciones',
  catalogos_negocio: 'Catálogos comerciales',
  categorias: 'Categorías',
  clientes: 'Clientes',
  compras: 'Compras',
  conciliaciones_bancarias: 'Conciliaciones bancarias',
  conductores: 'Conductores',
  configuracion: 'Configuración',
  conteos_inventario: 'Conteos de inventario',
  contratos_compra: 'Contratos marco',
  cotizaciones: 'Cotizaciones',
  cuentas_bancarias: 'Cuentas bancarias',
  despachos: 'Despachos y rutas',
  detalle_compras: 'Detalle de compras',
  detalle_cotizaciones: 'Detalle de cotizaciones',
  detalle_ofertas_compra: 'Detalle de ofertas',
  detalle_recepciones_compra: 'Detalle de recepciones',
  detalle_ventas: 'Detalle de ventas',
  devoluciones_compra: 'Devoluciones a proveedor',
  ec_ajustes: 'Ajustes de inventario',
  ec_aprobacion_eventos: 'Eventos de aprobación',
  ec_comprobantes: 'Comprobantes',
  ec_conteos_fisicos: 'Conteo físico',
  ec_cotizaciones: 'Cotizaciones',
  ec_guias: 'Guías de remisión',
  ec_lotes: 'Lotes',
  ec_notas_credito: 'Notas de crédito',
  ec_pedidos: 'Pedidos',
  ec_reservas: 'Reservas de stock',
  ec_series: 'Series',
  ec_solicitudes_aprobacion: 'Solicitudes de aprobación',
  ec_sunat_documentos: 'Comprobantes SUNAT',
  ec_transferencias: 'Transferencias entre almacenes',
  empresas: 'Ficha de empresa',
  escalas_comision: 'Escalas de comisión',
  evaluaciones_proveedor_orden: 'Evaluación de proveedores',
  excepciones_comision: 'Excepciones de comisión',
  inventarios: 'Existencias e inventario',
  liquidaciones_comision: 'Liquidaciones de comisión',
  metas: 'Metas y objetivos',
  metas_asignaciones: 'Asignaciones de metas',
  monedas: 'Monedas y tipo de cambio',
  movimientos_bancarios: 'Movimientos bancarios',
  movimientos_inventario: 'Movimientos de inventario',
  movimientos_tesoreria: 'Movimientos de tesorería',
  notificaciones: 'Notificaciones',
  ofertas_compra: 'Comparativo de ofertas',
  ordenes_importacion: 'Órdenes de importación',
  pagos: 'Pagos y tesorería',
  pagos_comision: 'Pagos de comisión',
  permisos: 'Permisos',
  productos: 'Productos',
  proveedor_productos: 'Catálogo de proveedores',
  proveedores: 'Proveedores',
  recepciones_compra: 'Recepciones de compra',
  reglas_comision: 'Reglas de comisión',
  requisiciones_compra: 'Requisiciones de compra',
  rol_permisos: 'Permisos por rol',
  roles: 'Roles y accesos',
  solicitud_compra_lineas: 'Líneas de solicitud de compra',
  solicitudes_compra: 'Solicitudes de compra',
  sucursales: 'Sucursales',
  transferencias_almacen: 'Transferencias entre almacenes',
  transportistas: 'Transportistas',
  unidades_medida: 'Unidades de medida',
  usuario_permisos: 'Permisos de usuario',
  usuarios: 'Usuarios',
  vehiculos: 'Vehículos',
  vendedores: 'Vendedores',
  ventas: 'Ventas',
  ventas_vendedor: 'Asignación de ventas',
  zonas: 'Zonas comerciales',
  zonas_clientes: 'Zonas por cliente',
  zonas_sucursales: 'Zonas por sucursal',
}

function moduleLabel(modulo: string) {
  return MODULE_LABELS[modulo]
    ?? modulo
      .replace(/^ec_/, '')
      .split('_')
      .filter(Boolean)
      .map((part, index) => (index === 0 ? part.charAt(0).toUpperCase() + part.slice(1) : part))
      .join(' ')
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
    <PageHeader
      icon={ShieldCheck}
      section="Seguridad y auditoría"
      title="Bitácora de operaciones"
      description="Consulta cambios registrados en la base, quién los realizó y cuándo ocurrieron."
      actions={<button className="ws-button ws-button-secondary" disabled={loading} onClick={() => setRefreshKey(value => value + 1)}><RefreshCw size={16} className={loading ? 'ws-spin' : ''} />Actualizar</button>}
    />
    {error && <div className="ws-notice ws-notice-warning" role="alert">{error}<button className="ws-text-button" type="button" onClick={() => setRefreshKey(value => value + 1)}>Reintentar</button></div>}
    <section className="ws-card">
      <div className="ws-module-toolbar">
        <SearchablePicker
          ariaLabel="Filtrar por módulo"
          value={module}
          onChange={value => { setModule(value); setPage(0) }}
          placeholder="Todos los módulos"
          searchPlaceholder="Buscar módulo…"
          pageSize={6}
          options={[{ id: '', label: 'Todos los módulos' }, ...modules.map(item => ({ id: item, label: moduleLabel(item), detail: item }))]}
        />
        <SearchablePicker
          ariaLabel="Filtrar por acción"
          value={action}
          onChange={value => { setAction(value); setPage(0) }}
          placeholder="Todas las acciones"
          searchPlaceholder="Buscar acción…"
          pageSize={5}
          options={ACTIONS.map(item => ({ id: item.value, label: item.label }))}
        />
        <span className="relation-hint">{total} {total === 1 ? 'evento' : 'eventos'} visibles para tu permiso</span>
      </div>
      <div className="table-scroll"><table className="record-table"><thead><tr><th>Fecha y hora</th><th>Usuario</th><th>Módulo</th><th>Acción</th><th>Registro</th><th>Resultado</th></tr></thead><tbody>
        {entries.map(entry => <tr key={entry.id}><td>{eventTime(entry.createdAt)}</td><td>{entry.email ?? 'Usuario no disponible'}</td><td>{moduleLabel(entry.modulo)}</td><td><span className={`status-pill ${entry.accion === 'DELETE' ? 'red' : entry.accion === 'INSERT' ? 'green' : 'amber'}`}>{actionLabel(entry.accion)}</span></td><td><span className="record-id">{entry.registro ?? '—'}</span></td><td>{entry.resultado}</td></tr>)}
        {!entries.length && !loading && !error && <tr><td colSpan={6}><div className="ws-empty-compact"><ShieldCheck size={26} /><strong>No hay eventos para estos filtros</strong><span>Prueba otra acción o módulo, o actualiza la bitácora.</span></div></td></tr>}
        {loading && <tr><td colSpan={6}><div className="ws-empty-compact"><RefreshCw size={20} className="ws-spin" /><strong>Cargando eventos…</strong></div></td></tr>}
      </tbody></table></div>
      <div className="ws-pagination"><span>Mostrando {firstRow}–{lastRow} de {total}</span><div><button className="ws-icon-button" type="button" disabled={page === 0 || loading} onClick={() => setPage(value => Math.max(0, value - 1))} aria-label="Página anterior">‹</button><span>{page + 1} / {pageCount}</span><button className="ws-icon-button" type="button" disabled={page + 1 >= pageCount || loading} onClick={() => setPage(value => Math.min(pageCount - 1, value + 1))} aria-label="Página siguiente">›</button></div></div>
    </section>
    <p className="relation-hint ws-audit-footnote">La bitácora registra eventos auditados de maestros, operaciones comerciales, inventario, logística, tesorería y aprobaciones visibles según los permisos de tu rol.</p>
  </>
}
