import { Boxes, Building2, ClipboardList, LayoutDashboard, PackageCheck, ReceiptText, ShoppingCart, TrendingUp, Users, Wallet, ArrowLeftRight, Wrench, Banknote, KeyRound } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { DataPage, RecordItem } from '../types'

export type WorkspaceEntry = { label: string; path: string; page?: DataPage; icon: LucideIcon; group: string }
export const workspaceEntries: WorkspaceEntry[] = [
  { label: 'Panel de control', path: '/dashboard', icon: LayoutDashboard, group: 'INICIO' },
  { label: 'Órdenes de compra', path: '/purchases', page: 'purchases', icon: ShoppingCart, group: 'COMPRAS' },
  { label: 'Ingreso al Kardex', path: '/ingreso-kardex', page: 'purchases', icon: PackageCheck, group: 'COMPRAS' },
  { label: 'Proveedores', path: '/suppliers', page: 'suppliers', icon: Building2, group: 'COMPRAS' },
  { label: 'Cotizaciones', path: '/quotes', page: 'quotes', icon: ClipboardList, group: 'VENTAS' },
  { label: 'Ventas', path: '/sales', page: 'sales', icon: ReceiptText, group: 'VENTAS' },
  { label: 'Clientes', path: '/customers', page: 'customers', icon: Users, group: 'VENTAS' },
  { label: 'Stock de productos', path: '/inventory', page: 'inventory', icon: Boxes, group: 'INVENTARIO' },
  { label: 'Movimientos de Kardex', path: '/movimiento-kardex', page: 'inventory', icon: ArrowLeftRight, group: 'INVENTARIO' },
  { label: 'Tesorería', path: '/finance', page: 'finance', icon: Wallet, group: 'FINANZAS' },
  { label: 'Caja', path: '/caja', page: 'finance', icon: Banknote, group: 'FINANZAS' },
  { label: 'Reportes', path: '/reports', page: 'reports', icon: TrendingUp, group: 'ADMINISTRACIÓN' },
  { label: 'Mantenimiento', path: '/mantenimientos', page: 'settings', icon: Wrench, group: 'ADMINISTRACIÓN' },
  { label: 'Permisos', path: '/permisos', page: 'settings', icon: KeyRound, group: 'ADMINISTRACIÓN' },
]

export const permissionModule: Record<DataPage, string> = {
  sales: 'ventas', quotes: 'cotizaciones', purchases: 'compras', inventory: 'inventario',
  customers: 'clientes', suppliers: 'proveedores', finance: 'finanzas', documents: 'documentos',
  reports: 'reportes', settings: 'configuracion',
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
