import { ClipboardCheck, PackageCheck, Truck, Wallet } from 'lucide-react'
import { moneyCurrency } from '../data/helpers'
import { businessDate } from '../data/workspace'
import type { RecordItem } from '../types'

export default function PurchaseMetrics({ orders, loading, error }: { orders: RecordItem[]; loading: boolean; error?: string }) {
  const month = businessDate(new Date().toISOString()).slice(0, 7)
  const monthly = orders.filter(order => order.createdAt && businessDate(order.createdAt).slice(0, 7) === month && order.status !== 'Rechazada')
  const metrics = [
    { label: 'Pendientes de aprobación', value: String(orders.filter(order => ['Pendiente', 'Solicitud'].includes(order.status)).length), detail: 'Estados Pendiente / Solicitud', icon: ClipboardCheck },
    { label: 'Compras del mes', value: (['PEN', 'USD'] as const).map(currency => moneyCurrency(monthly.filter(order => (order.moneda ?? 'PEN') === currency).reduce((sum, order) => sum + (order.amount ?? 0), 0), currency)).join(' · '), detail: `${month} · por fecha de registro, sin rechazadas`, icon: Wallet },
    { label: 'Por recepcionar', value: String(orders.filter(order => order.requiereRecepcion !== false && order.estadoRecepcion !== 'completa' && order.status !== 'Rechazada').length), detail: 'Órdenes con recepción pendiente o parcial', icon: Truck },
    { label: 'Recepciones completadas', value: String(orders.filter(order => order.requiereRecepcion !== false && order.estadoRecepcion === 'completa').length), detail: 'Órdenes con ingreso completo', icon: PackageCheck },
  ]
  return <section className="ec-purchase-metrics" aria-label="Indicadores de órdenes cargadas">{metrics.map(({ label, value, detail, icon: Icon }) => <article className="ec-card" key={label}><span><Icon size={18} />{label}</span><strong>{loading ? '—' : error ? 'No disponible' : value}</strong><small>{detail}</small></article>)}</section>
}
