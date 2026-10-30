// Lógica pura de la bitácora: etiquetas, filtros por fecha, comparación antes/después,
// ocultamiento de datos sensibles y exportación. No depende de React ni de Supabase.

export type AuditAction = 'INSERT' | 'UPDATE' | 'DELETE' | 'GUARDAR'

export const AUDIT_ACTIONS: Array<{ value: '' | AuditAction; label: string; tone: 'green' | 'amber' | 'red' }> = [
  { value: '', label: 'Todas las acciones', tone: 'amber' },
  { value: 'INSERT', label: 'Creación', tone: 'green' },
  { value: 'UPDATE', label: 'Edición', tone: 'amber' },
  { value: 'DELETE', label: 'Eliminación', tone: 'red' },
  { value: 'GUARDAR', label: 'Guardado (alta o edición)', tone: 'amber' },
]

export function auditActionLabel(value: string) {
  return AUDIT_ACTIONS.find(action => action.value === value)?.label ?? value
}

export const AUDIT_RESULTS: Array<{ value: '' | 'exitoso' | 'denegado' | 'fallido'; label: string; tone: 'green' | 'amber' | 'red' }> = [
  { value: '', label: 'Todos los resultados', tone: 'amber' },
  { value: 'exitoso', label: 'Exitoso', tone: 'green' },
  { value: 'denegado', label: 'Denegado (sin permiso)', tone: 'amber' },
  { value: 'fallido', label: 'Fallido (error)', tone: 'red' },
]

export function auditResultLabel(value: string) {
  return AUDIT_RESULTS.find(item => item.value === value)?.label.split(' (')[0] ?? value
}

export function auditResultTone(value: string): 'green' | 'amber' | 'red' {
  return AUDIT_RESULTS.find(item => item.value === value)?.tone ?? 'amber'
}

export function auditActionTone(value: string): 'green' | 'amber' | 'red' {
  return AUDIT_ACTIONS.find(action => action.value === value)?.tone ?? 'amber'
}

// Cada trigger de auditoría guarda el nombre de la tabla como "módulo".
// Esta lista cubre las tablas auditadas conocidas; una tabla nueva se muestra con un nombre legible.
export const AUDIT_MODULE_LABELS: Record<string, string> = {
  almacenes: 'Almacenes',
  analisis_proyectos: 'Analizador de proyectos',
  asignaciones_vehiculo: 'Asignaciones de vehículo',
  conductores: 'Conductores',
  despachos: 'Despachos y rutas',
  metas: 'Metas',
  metas_asignaciones: 'Asignaciones de metas',
  metas_cortes: 'Cortes de avance de metas',
  vehiculos: 'Vehículos',
  aperturas_inventario: 'Apertura de inventario',
  aplicaciones_pago: 'Aplicaciones de pago',
  caja_turnos: 'Turnos de caja',
  cajas: 'Cajas',
  categorias: 'Categorías de producto',
  clientes: 'Clientes',
  compras: 'Compras',
  configuracion: 'Configuración',
  cotizaciones: 'Cotizaciones',
  detalle_compras: 'Detalle de compras',
  detalle_cotizaciones: 'Detalle de cotizaciones',
  detalle_recepciones_compra: 'Detalle de recepciones',
  detalle_ventas: 'Detalle de ventas',
  documentos: 'Documentos',
  empresas: 'Empresa',
  inventarios: 'Existencias por almacén',
  metodos_pago: 'Medios de pago',
  monedas: 'Monedas',
  movimientos_inventario: 'Kardex',
  movimientos_tesoreria: 'Movimientos de tesorería',
  pagos: 'Pagos y tesorería',
  permisos: 'Catálogo de permisos',
  productos: 'Productos',
  proveedor_productos: 'Catálogo de proveedores',
  proveedores: 'Proveedores',
  recepciones_compra: 'Recepciones de compra',
  reportes: 'Reportes',
  rol_permisos: 'Permisos por rol',
  roles: 'Roles',
  sucursales: 'Sucursales',
  unidades_medida: 'Unidades de medida',
  usuario_permisos: 'Permisos personalizados',
  usuarios: 'Usuarios',
  ventas: 'Ventas',
  zonas: 'Zonas',
  zonas_clientes: 'Clientes por zona',
  zonas_sucursales: 'Sucursales por zona',
}

function humanize(key: string) {
  const text = key.replace(/_/g, ' ').trim()
  return text ? text[0].toLocaleUpperCase('es') + text.slice(1) : key
}

export function auditModuleLabel(key: string) {
  return AUDIT_MODULE_LABELS[key] ?? humanize(key)
}

/** Opciones del filtro: todas las tablas conocidas más las que aparezcan en los datos. */
export function auditModuleOptions(found: string[] = []) {
  const keys = new Set([...Object.keys(AUDIT_MODULE_LABELS), ...found.filter(Boolean)])
  return [...keys]
    .map(value => ({ value, label: auditModuleLabel(value) }))
    .sort((a, b) => a.label.localeCompare(b.label, 'es'))
}

// ---------------------------------------------------------------- fechas
// Lima no usa horario de verano: UTC-05:00 todo el año.
const LIMA_OFFSET = '-05:00'
const DAY = /^\d{4}-\d{2}-\d{2}$/

function nextDay(value: string) {
  const date = new Date(`${value}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}

/** Convierte días de negocio (YYYY-MM-DD, Lima) en el intervalo [gte, lt) para consultar timestamptz. */
export function auditDayBounds(from?: string, to?: string): { gte?: string; lt?: string } {
  const result: { gte?: string; lt?: string } = {}
  if (from && DAY.test(from)) result.gte = new Date(`${from}T00:00:00${LIMA_OFFSET}`).toISOString()
  if (to && DAY.test(to)) result.lt = new Date(`${nextDay(to)}T00:00:00${LIMA_OFFSET}`).toISOString()
  return result
}

/** Devuelve un mensaje si el rango es inválido, o null si es correcto. */
export function auditRangeError(from?: string, to?: string) {
  if (from && !DAY.test(from)) return 'La fecha inicial no es válida.'
  if (to && !DAY.test(to)) return 'La fecha final no es válida.'
  if (from && to && from > to) return 'La fecha inicial no puede ser posterior a la final.'
  return null
}

/** Escapa los comodines de LIKE para que el texto del usuario se busque literalmente. */
export function escapeLike(term: string) {
  return term.trim().replace(/[\\%_]/g, match => `\\${match}`)
}

// ---------------------------------------------------------------- antes / después
export type AuditJson = Record<string, unknown> | null

export type AuditValueType = 'text' | 'money' | 'date' | 'ref' | 'bool' | 'empty'

export type AuditChange = {
  field: string
  label: string
  before: string
  after: string
  kind: 'added' | 'removed' | 'changed'
  type: AuditValueType
  /** Campos internos (ids, marcas de tiempo, claves de operación): se muestran aparte. */
  technical: boolean
  hidden: boolean
}

const SENSITIVE_KEY = /(pass(word)?|contrase|secret|token|api[_-]?key|clave|authorization|credential)/i
export const HIDDEN_VALUE = '•••• oculto'
const MAX_VALUE_LENGTH = 160

export function isSensitiveField(field: string) {
  return SENSITIVE_KEY.test(field)
}

const FIELD_LABELS: Record<string, string> = {
  id: 'Identificador', codigo: 'Código', nombre: 'Nombre', detalle: 'Detalle', descripcion: 'Descripción',
  estado: 'Estado', activo: 'Activo', cantidad: 'Cantidad', precio: 'Precio', precio_unitario: 'Precio unitario',
  subtotal: 'Subtotal', monto: 'Monto', total: 'Total', costo: 'Costo', saldo: 'Saldo', stock: 'Stock',
  descuento: 'Descuento (%)', tipo: 'Tipo', referencia: 'Referencia', email: 'Correo', correo: 'Correo',
  telefono: 'Teléfono', direccion: 'Dirección', razon_social: 'Razón social', ruc: 'RUC', documento: 'Documento',
  cliente_nombre: 'Cliente', medio_pago: 'Medio de pago', ultimo_acceso: 'Último acceso',
  created_at: 'Creado el', updated_at: 'Actualizado el', created_by: 'Creado por',
  idempotency_key: 'Clave de la operación', payload_hash: 'Huella de la operación',
  cotizacion_id: 'Cotización', venta_id: 'Venta', compra_id: 'Compra', producto_id: 'Producto', cliente_id: 'Cliente',
  proveedor_id: 'Proveedor', almacen_id: 'Almacén', sucursal_id: 'Sucursal', rol_id: 'Rol', usuario_id: 'Usuario',
  zona_id: 'Zona', empresa_id: 'Empresa', permiso_id: 'Permiso', caja_id: 'Caja', recepcion_id: 'Recepción',
  stock_anterior: 'Stock anterior', stock_nuevo: 'Stock nuevo', linea_credito: 'Línea de crédito',
}

export function fieldLabel(field: string) {
  if (FIELD_LABELS[field]) return FIELD_LABELS[field]
  if (field.endsWith('_id')) return humanize(field.slice(0, -3))
  return humanize(field)
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const MONEY_FIELD = /(monto|precio|subtotal|total|costo|saldo|importe|igv|credito)/i
const TECHNICAL_FIELD = /(^id$|_at$|_by$|^idempotency|hash$|^payload)/i

const limaDateTime = new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', dateStyle: 'short', timeStyle: 'short' })
const moneyFormat = new Intl.NumberFormat('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function auditValueType(field: string, value: unknown): AuditValueType {
  if (value === null || value === undefined || value === '') return 'empty'
  if (typeof value === 'boolean') return 'bool'
  if (typeof value === 'string' && UUID.test(value)) return 'ref'
  if (typeof value === 'string' && (ISO_DATETIME.test(value) || ISO_DAY.test(value))) return 'date'
  if (MONEY_FIELD.test(field) && value !== '' && Number.isFinite(Number(value)) && typeof value !== 'object') return 'money'
  return 'text'
}

export function formatAuditValue(value: unknown, field = ''): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? 'Sí' : 'No'
  const type = auditValueType(field, value)
  if (type === 'money') return moneyFormat.format(Number(value))
  if (type === 'date' && typeof value === 'string') {
    if (ISO_DAY.test(value)) { const [y, m, d] = value.split('-'); return `${d}/${m}/${y}` }
    const date = new Date(value)
    if (!Number.isNaN(date.getTime())) return limaDateTime.format(date)
  }
  const text = typeof value === 'string' ? value : typeof value === 'object' ? JSON.stringify(value) : String(value)
  if (!text.length) return '(vacío)'
  if (text.startsWith('data:')) return `[archivo incrustado, ${text.length} caracteres]`
  return text.length > MAX_VALUE_LENGTH ? `${text.slice(0, MAX_VALUE_LENGTH)}…` : text
}

function same(a: unknown, b: unknown) {
  if (a === b) return true
  if (a && b && typeof a === 'object' && typeof b === 'object') return JSON.stringify(a) === JSON.stringify(b)
  return false
}

/**
 * Campos que cambiaron en una operación.
 * INSERT lista los campos creados; DELETE los eliminados; UPDATE solo los modificados.
 * Los campos sensibles nunca devuelven su valor. Los importantes van primero y los técnicos al final.
 */
export function auditChanges(before: AuditJson, after: AuditJson): AuditChange[] {
  const fields = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])]
  const changes: AuditChange[] = []
  for (const field of fields) {
    const hasBefore = !!before && field in before
    const hasAfter = !!after && field in after
    const previous = hasBefore ? before![field] : undefined
    const next = hasAfter ? after![field] : undefined
    if (hasBefore && hasAfter && same(previous, next)) continue
    const hidden = isSensitiveField(field)
    const shown = hasAfter ? next : previous
    const isRef = field.endsWith('_id') && auditValueType(field, shown) === 'ref'
    changes.push({
      field,
      label: fieldLabel(field),
      before: !hasBefore ? '—' : hidden ? HIDDEN_VALUE : formatAuditValue(previous, field),
      after: !hasAfter ? '—' : hidden ? HIDDEN_VALUE : formatAuditValue(next, field),
      kind: !hasBefore ? 'added' : !hasAfter ? 'removed' : 'changed',
      type: hidden ? 'text' : isRef ? 'ref' : auditValueType(field, shown),
      technical: TECHNICAL_FIELD.test(field),
      hidden,
    })
  }
  return changes.sort((a, b) => Number(a.technical) - Number(b.technical) || a.label.localeCompare(b.label, 'es'))
}

// ---------------------------------------------------------------- exportación
export type AuditExportEntry = { createdAt: string; email: string | null; modulo: string; accion: string; registro: string | null; resultado: string }

export const AUDIT_CSV_HEADER = ['Fecha y hora (Lima)', 'Usuario', 'Módulo', 'Acción', 'Registro', 'Resultado']

export function auditCsvRows(entries: AuditExportEntry[]) {
  const formatter = new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', dateStyle: 'short', timeStyle: 'medium' })
  return entries.map(entry => {
    const date = new Date(entry.createdAt)
    return [
      Number.isNaN(date.getTime()) ? '' : formatter.format(date),
      entry.email ?? '',
      auditModuleLabel(entry.modulo),
      auditActionLabel(entry.accion),
      entry.registro ?? '',
      entry.resultado,
    ]
  })
}

// ---------------------------------------------------------------- paginación
/**
 * Números de página a mostrar (base 0) con "…" para los saltos.
 * Siempre incluye la primera, la última y las vecinas de la actual.
 */
export function pageWindow(current: number, count: number, around = 1): Array<number | '…'> {
  if (count <= 0) return []
  const pages = new Set<number>([0, count - 1])
  for (let page = current - around; page <= current + around; page++) if (page >= 0 && page < count) pages.add(page)
  const sorted = [...pages].sort((a, b) => a - b)
  const result: Array<number | '…'> = []
  sorted.forEach((page, index) => {
    const previous = sorted[index - 1]
    if (previous !== undefined && page - previous === 2) result.push(previous + 1)
    else if (previous !== undefined && page - previous > 2) result.push('…')
    result.push(page)
  })
  return result
}
