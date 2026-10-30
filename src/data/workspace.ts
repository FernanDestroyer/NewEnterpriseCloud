import { ArrowLeftRight, Award, Banknote, BarChart3, Bell, Boxes, Building2, ClipboardCheck, ClipboardList, FileCheck2, FileText, KeyRound, Landmark, LayoutDashboard, MapPinned, Package, PackageCheck, Percent, ReceiptText, ScanSearch, Settings, ShieldCheck, Ship, ShoppingCart, Target, TrendingUp, Truck, Users, Wallet, Workflow, Wrench } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { DataPage, RecordItem } from '../types'

export type PermissionModuleKey = DataPage | 'analizador' | 'audit'

export type WorkspaceEntry = { label: string; path: string; page?: DataPage; permission?: PermissionModuleKey; icon: LucideIcon; group: string }
export const workspaceEntries: WorkspaceEntry[] = [
  { label: 'Panel de control', path: '/dashboard', icon: LayoutDashboard, group: 'REPORTES E INTELIGENCIA' },
  { label: 'Órdenes de compra', path: '/purchases', page: 'purchases', icon: ShoppingCart, group: 'COMPRAS' },
  { label: 'Ingreso al Kardex', path: '/ingreso-kardex', page: 'purchases', icon: PackageCheck, group: 'COMPRAS' },
  { label: 'Proveedores', path: '/suppliers', page: 'suppliers', icon: Building2, group: 'MAESTROS' },
  { label: 'Cotizaciones', path: '/quotes', page: 'quotes', icon: ClipboardList, group: 'VENTAS' },
  { label: 'Ventas', path: '/sales', page: 'sales', icon: ReceiptText, group: 'VENTAS' },
  { label: 'Clientes', path: '/customers', page: 'customers', icon: Users, group: 'MAESTROS' },
  { label: 'Existencias', path: '/inventario/existencias', permission: 'inventory', icon: Boxes, group: 'INVENTARIO' },
  { label: 'Kardex', path: '/inventario/kardex', permission: 'inventory', icon: ArrowLeftRight, group: 'INVENTARIO' },
  { label: 'Transferencias entre almacenes', path: '/inventario/transferencias', permission: 'inventory', icon: Truck, group: 'INVENTARIO' },
  { label: 'Ajustes de inventario', path: '/inventario/ajustes', permission: 'inventory', icon: Wrench, group: 'INVENTARIO' },
  { label: 'Inventario físico', path: '/inventario/fisico', permission: 'inventory', icon: ClipboardCheck, group: 'INVENTARIO' },
  { label: 'Lotes y series', path: '/inventario/lotes-series', permission: 'inventory', icon: Package, group: 'INVENTARIO' },
  { label: 'Productos y clasificación', path: '/inventory#productos', page: 'inventory', icon: Package, group: 'MAESTROS' },
  { label: 'Tesorería', path: '/finance', page: 'finance', icon: Wallet, group: 'TESORERÍA' },
  { label: 'Caja', path: '/caja', page: 'finance', icon: Banknote, group: 'TESORERÍA' },
  { label: 'Reportes', path: '/reports', page: 'reports', icon: TrendingUp, group: 'REPORTES E INTELIGENCIA' },
  { label: 'Mantenimiento', path: '/mantenimientos', page: 'settings', icon: Wrench, group: 'CONFIGURACIÓN' },
  { label: 'Permisos', path: '/permisos', page: 'settings', icon: KeyRound, group: 'SEGURIDAD' },
  { label: 'Bitácora de auditoría', path: '/auditoria', permission: 'audit', icon: FileCheck2, group: 'SEGURIDAD' },
  { label: 'Analizador de proyectos', path: '/analizador', permission: 'analizador', icon: ScanSearch, group: 'HERRAMIENTAS' },
]

export type WorkspaceSubmodule = {
  label: string
  path?: string
  permission?: PermissionModuleKey
  icon?: LucideIcon
  action?: 'notifications'
  availability?: 'partial' | 'optional'
  implemented: boolean
}

export type WorkspaceModule = {
  id: string
  label: string
  icon: LucideIcon
  children: WorkspaceSubmodule[]
}

// Los catálogos del PDF se agrupan por responsabilidad para mantener el menú compacto.
// Las opciones sin pantalla se muestran como referencia y no permiten navegación.
export const workspaceModules: WorkspaceModule[] = [
  {
    id: 'maestros', label: 'Maestros', icon: Building2,
    children: [
      { label: 'Clientes', path: '/customers', permission: 'customers', icon: Users, implemented: true },
      { label: 'Proveedores', path: '/suppliers', permission: 'suppliers', icon: Building2, implemented: true },
      { label: 'Productos y clasificación', path: '/inventory#productos', permission: 'inventory', icon: Boxes, availability: 'partial', implemented: true },
      { label: 'Ficha de empresa', path: '/mantenimientos#empresa', permission: 'settings', icon: Building2, availability: 'partial', implemented: true },
      { label: 'Sucursales y almacenes', path: '/mantenimientos#organizacion', permission: 'settings', icon: Building2, availability: 'partial', implemented: true },
      { label: 'Zonas comerciales y de reparto', path: '/mantenimientos#zonas-comerciales', permission: 'settings', icon: MapPinned, availability: 'partial', implemented: true },
      { label: 'Transportistas y vendedores', icon: Truck, implemented: false },
      { label: 'Catálogos comerciales y tributarios', path: '/mantenimientos#catalogos', permission: 'settings', icon: Wrench, availability: 'partial', implemented: true },
    ],
  },
  {
    id: 'compras', label: 'Compras', icon: ShoppingCart,
    children: [
      { label: 'Órdenes nacionales', path: '/purchases', permission: 'purchases', icon: ShoppingCart, availability: 'partial', implemented: true },
      { label: 'Solicitud interna y comparativo de ofertas', path: '/solicitudes-compra', permission: 'purchases', icon: ClipboardList, implemented: true },
      { label: 'Recepción de mercadería', path: '/ingreso-kardex', permission: 'purchases', icon: PackageCheck, implemented: true },
      { label: 'Devoluciones a proveedor', path: '/devoluciones-proveedor', permission: 'purchases', icon: ArrowLeftRight, implemented: true },
      { label: 'Contratos marco', path: '/contratos-compra', permission: 'purchases', icon: FileText, implemented: true },
      { label: 'Importaciones', path: '/importaciones', permission: 'purchases', icon: Ship, implemented: true },
      { label: 'Evaluación de proveedores', path: '/evaluaciones-proveedores', permission: 'purchases', icon: Award, availability: 'optional', implemented: true },
    ],
  },
  {
    id: 'ventas', label: 'Ventas', icon: ReceiptText,
    children: [
      { label: 'Cotizaciones', path: '/quotes', permission: 'quotes', icon: ClipboardList, implemented: true },
      { label: 'Pedidos y ventas', path: '/sales', permission: 'sales', icon: ShoppingCart, implemented: true },
      { label: 'Comprobantes imprimibles', path: '/sales/receipts', permission: 'sales', icon: FileCheck2, implemented: true },
      { label: 'Guías de remisión', path: '/sales/guides', permission: 'sales', icon: FileText, implemented: true },
      { label: 'Emisión electrónica SUNAT', path: '/sales/sunat', permission: 'sales', icon: ReceiptText, implemented: true },
      { label: 'Notas de crédito y devoluciones', path: '/sales/credits', permission: 'sales', icon: ArrowLeftRight, implemented: true },
    ],
  },
  {
    id: 'inventario', label: 'Inventario y Kardex', icon: Boxes,
    children: [
      { label: 'Existencias', path: '/inventario/existencias', permission: 'inventory', icon: Package, implemented: true },
      { label: 'Kardex', path: '/inventario/kardex', permission: 'inventory', icon: ArrowLeftRight, implemented: true },
      { label: 'Transferencias entre almacenes', path: '/inventario/transferencias', permission: 'inventory', icon: Truck, implemented: true },
      { label: 'Ajustes de inventario', path: '/inventario/ajustes', permission: 'inventory', icon: Wrench, implemented: true },
      { label: 'Inventario físico', path: '/inventario/fisico', permission: 'inventory', icon: ClipboardCheck, implemented: true },
      { label: 'Lotes y series', path: '/inventario/lotes-series', permission: 'inventory', icon: Package, implemented: true },
    ],
  },
  {
    id: 'tesoreria', label: 'Tesorería', icon: Wallet,
    children: [
      { label: 'Cuentas por cobrar y pagar', path: '/finance', permission: 'finance', icon: Wallet, availability: 'partial', implemented: true },
      { label: 'Cajas y turnos', path: '/caja', permission: 'finance', icon: Banknote, implemented: true },
      { label: 'Bancos, flujo y conciliación', permission: 'finance', icon: Landmark, implemented: false },
    ],
  },
  {
    id: 'logistica', label: 'Logística y Transporte', icon: Truck,
    children: [
      { label: 'Planificación de despachos y rutas', icon: MapPinned, implemented: false },
      { label: 'Vehículos y asignación de conductores', icon: Truck, implemented: false },
      { label: 'Seguimiento, entrega y devoluciones', icon: PackageCheck, implemented: false },
    ],
  },
  {
    id: 'comisiones', label: 'Comisiones de Vendedores', icon: Percent,
    children: [
      { label: 'Reglas, escalas y excepciones', icon: Settings, implemented: false },
      { label: 'Cálculo y ajustes de comisión', icon: Percent, implemented: false },
      { label: 'Liquidaciones y pagos', icon: Banknote, implemented: false },
      { label: 'Historial y reportes', icon: FileText, implemented: false },
    ],
  },
  {
    id: 'metas', label: 'Metas y Objetivos', icon: Target,
    children: [
      { label: 'Definición y asignación de metas', icon: Target, implemented: false },
      { label: 'Avance por vendedor, sucursal o producto', icon: TrendingUp, implemented: false },
      { label: 'Ranking y alertas de cumplimiento', icon: Award, implemented: false },
    ],
  },
  {
    id: 'inteligencia', label: 'Reportes e Inteligencia de Negocios', icon: TrendingUp,
    children: [
      { label: 'Panel ejecutivo', path: '/dashboard', icon: LayoutDashboard, implemented: true },
      { label: 'Reportes operativos', path: '/reports', permission: 'reports', icon: BarChart3, implemented: true },
    ],
  },
  {
    id: 'seguridad', label: 'Seguridad y Auditoría', icon: ShieldCheck,
    children: [
      { label: 'Usuarios, roles y permisos', path: '/permisos', permission: 'settings', icon: KeyRound, implemented: true },
      { label: 'Bitácora y auditoría de operaciones', path: '/auditoria', permission: 'audit', icon: FileCheck2, availability: 'partial', implemented: true },
    ],
  },
  {
    id: 'configuracion', label: 'Configuración e Integraciones', icon: Settings,
    children: [
      { label: 'Parámetros, series y plantillas', permission: 'settings', icon: Settings, implemented: false },
      { label: 'Integraciones de cobro', path: '/mantenimientos#integraciones', permission: 'settings', icon: Workflow, availability: 'partial', implemented: true },
      { label: 'Descarga de respaldos', path: '/mantenimientos#respaldos', permission: 'settings', icon: FileText, availability: 'partial', implemented: true },
      { label: 'API y webhooks', permission: 'settings', icon: Landmark, implemented: false },
    ],
  },
  {
    id: 'notificaciones', label: 'Notificaciones y Aprobaciones', icon: Bell,
    children: [
      { label: 'Centro de alertas', action: 'notifications', icon: Bell, implemented: true },
      { label: 'Workflows y reglas de aprobación', icon: Workflow, implemented: false },
      { label: 'Bandeja de aprobaciones', icon: ClipboardCheck, implemented: false },
      { label: 'Canales e historial de notificaciones', icon: FileText, implemented: false },
    ],
  },
]

export function submoduleMatchesLocation(path: string | undefined, pathname: string, hash: string) {
  if (!path) return false
  const separator = path.indexOf('#')
  const route = separator < 0 ? path : path.slice(0, separator)
  const targetHash = separator < 0 ? '' : path.slice(separator)
  return route === pathname && (!targetHash || targetHash === hash)
}

export const permissionModule: Record<PermissionModuleKey, string> = {
  sales: 'ventas', quotes: 'cotizaciones', purchases: 'compras', inventory: 'inventario',
  customers: 'clientes', suppliers: 'proveedores', finance: 'finanzas', documents: 'documentos',
  reports: 'reportes', settings: 'configuracion', analizador: 'analizador', audit: 'auditoria',
}

export type Period = 'all' | 'month' | '30' | '7' | 'today'
export type DateRange = { from: string; to: string }
const businessCalendar = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' })

// La aplicación utiliza el calendario de negocio peruano, independientemente del dispositivo.
export function businessDate(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const parts = businessCalendar.formatToParts(date)
  const get = (type: string) => parts.find(part => part.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

export function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function periodRange(period: Period, now = new Date()): DateRange {
  const to = businessDate(now)
  if (period === 'all') return { from: '', to: '' }
  if (period === 'month') return { from: `${to.slice(0, 7)}-01`, to }
  return { from: shiftDate(to, period === 'today' ? 0 : period === '7' ? -6 : -29), to }
}

export function inDateRange(item: RecordItem, range: DateRange) {
  if (!range.from && !range.to) return true
  const date = item.createdAt ? businessDate(item.createdAt) : ''
  if (!date) return false
  return (!range.from || date >= range.from) && (!range.to || date <= range.to)
}

export function matchesSearch(item: RecordItem, query: string) {
  const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es')
  return normalize(`${item.id} ${item.name} ${item.detail} ${item.ruc ?? ''} ${item.documento ?? ''} ${item.relatedName ?? ''}`).includes(normalize(query.trim()))
}

export function dailyOperations(sales: RecordItem[], purchases: RecordItem[], range: DateRange, now = new Date()) {
  const dates = [...sales, ...purchases].flatMap(item => item.createdAt ? [businessDate(item.createdAt)] : []).filter(Boolean).sort()
  const end = range.to || businessDate(now)
  const start = range.from || (dates[0] ? dates[0] : shiftDate(end, -6))
  const span = Math.max(1, Math.round((Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86400000) + 1)
  const interval = span > 45 ? Math.ceil(span / 30) : 1
  const buckets = Array.from({ length: Math.ceil(span / interval) }, (_, index) => ({ date: shiftDate(start, index * interval), sales: 0, purchases: 0 }))
  const add = (items: RecordItem[], kind: 'sales' | 'purchases') => {
    for (const item of items) {
      if (!item.createdAt || !inDateRange(item, { from: start, to: end })) continue
      const date = businessDate(item.createdAt)
      const index = Math.floor((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86400000 / interval)
      if (buckets[index]) buckets[index][kind] += Number.isFinite(item.amount) ? item.amount ?? 0 : 0
    }
  }
  add(sales, 'sales')
  add(purchases, 'purchases')
  return { buckets, interval }
}

export function displayDate(iso?: string) {
  if (!iso) return '—'
  const value = new Date(iso)
  if (Number.isNaN(value.getTime())) return '—'
  return value.toLocaleDateString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric' })
}

export type CustomerCredit = {
  /** Línea de crédito del cliente (clientes.linea_credito): cupo de su tarjeta. 0 = sin tope. */
  linea: number
  /** true si el cliente tiene tope (línea mayor a cero). */
  hasLimit: boolean
  /** Suma de compras pagadas con Tarjeta: es lo que consume la línea. */
  consumidoTarjeta: number
  /** Suma de cuentas por cobrar abiertas vinculadas a sus ventas (cobranza). */
  deuda: number
  /** Cupo disponible para una nueva compra con Tarjeta. */
  disponible: number
  /** Ventas vinculadas (por cliente_id). */
  compras: RecordItem[]
  /** Total comprado (suma de montos de sus ventas). */
  totalComprado: number
  /** Descuento acumulado otorgado en sus ventas. */
  descuentoOtorgado: number
  /** Fecha de creación de su última compra (ISO) o undefined. */
  ultimaCompra?: string
}

/** true si el medio de pago consume la línea de crédito (solo Tarjeta). */
export function consumesCreditLine(medio?: string | null): boolean {
  return (medio ?? '').trim().toLocaleLowerCase('es') === 'tarjeta'
}

// Ventas del cliente + consumo vigente de su línea (solo Tarjeta con CxC abierta).
// excludeSaleRowId descuenta la venta que se está editando para no contarla dos veces.
export function customerCredit(
  customer: RecordItem,
  sales: RecordItem[],
  finance: RecordItem[],
  excludeSaleRowId?: string | null,
): CustomerCredit {
  const linea = Number(customer.amount ?? 0) || 0
  const mine = sales.filter((sale) => customer.rowId
    && sale.cliente_id === customer.rowId
    && sale.rowId !== (excludeSaleRowId ?? ''))
  const ids = new Set(mine.filter((sale) => sale.rowId).map((sale) => sale.rowId as string))
  const paymentBySale = new Map<string, RecordItem>()
  for (const item of finance) {
    if (item.saleId && !paymentBySale.has(item.saleId)) paymentBySale.set(item.saleId, item)
  }
  const consumidoTarjeta = mine
    .filter((sale) => consumesCreditLine(sale.medio))
    .reduce((sum, sale) => {
      const payment = sale.rowId ? paymentBySale.get(sale.rowId) : undefined
      // Sin CxC vinculada se conserva el consumo por precaución; una CxC
      // completada libera el cupo que ocupó la venta.
      if (payment?.status === 'Completada') return sum
      return sum + (Number(payment?.amount ?? sale.amount) || 0)
    }, 0)
  const deuda = finance
    .filter((item) => item.saleId && ids.has(item.saleId) && item.status !== 'Completada')
    .reduce((sum, item) => sum + (Number(item.amount) || 0), 0)
  const totalComprado = mine.reduce((sum, sale) => sum + (Number(sale.amount) || 0), 0)
  const descuentoOtorgado = mine.reduce((sum, sale) => {
    const total = Number(sale.amount) || 0
    const pct = Number(sale.descuento) || 0
    if (!(pct > 0) || !(total > 0) || pct >= 100) return sum
    return sum + Math.round(total * pct / (100 - pct) * 100) / 100
  }, 0)
  const ultimaCompra = mine
    .map((sale) => sale.createdAt ?? '')
    .filter(Boolean)
    .sort()
    .pop()
  return {
    linea: Math.round(linea * 100) / 100,
    hasLimit: linea > 0,
    consumidoTarjeta: Math.round(consumidoTarjeta * 100) / 100,
    deuda: Math.round(deuda * 100) / 100,
    disponible: Math.round((linea - consumidoTarjeta) * 100) / 100,
    compras: [...mine].sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? ''))),
    totalComprado: Math.round(totalComprado * 100) / 100,
    descuentoOtorgado: Math.round(descuentoOtorgado * 100) / 100,
    ultimaCompra,
  }
}
