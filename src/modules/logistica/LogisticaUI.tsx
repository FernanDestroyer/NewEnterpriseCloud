import { Phone, Truck, UserRound } from 'lucide-react'
import { ahoraLima } from './rules'
import { ESTADOS_DESPACHO } from './despachos'
import type { Conductor, Despacho, Vehiculo } from './types'
import './logistica-ui.css'

export function LogisticaMetrics({ despachos, loading, error }: { despachos: Despacho[]; loading: boolean; error: string }) {
  const ahora = ahoraLima()
  const paradas = despachos.filter(d => d.estado !== 'cancelado').flatMap(d => d.paradas)
  const incidencias = paradas.filter(p => p.entrega && p.entrega.resultado !== 'entregada').length
  const demoras = despachos.filter(d => (d.estado === 'programado' || d.estado === 'en_ruta') && d.hasta && d.hasta < ahora).length
  const metricas = [
    ['Programados', despachos.filter(d => d.estado === 'programado').length, 'Rutas pendientes de salida'],
    ['En tránsito activo', despachos.filter(d => d.estado === 'en_ruta').length, 'Rutas con salida registrada'],
    ['Entregas completas hoy', paradas.filter(p => p.entrega?.resultado === 'entregada' && new Date(p.entrega.registradoEn).toLocaleDateString('en-CA', { timeZone: 'America/Lima' }) === ahora.slice(0, 10)).length, 'Paradas entregadas íntegramente · Lima'],
    ['Incidencias de entrega', incidencias, `Parciales / no entregadas · ${demoras} rutas fuera del horario previsto`],
  ] as const
  return <section className="ec-log-metrics" aria-label="Resumen de despachos consultados">{metricas.map(([label, value, detail]) => <article key={label}><span>{label}</span><strong>{loading ? '—' : error ? 'No disponible' : value}</strong><small>{loading || error ? 'Consulta en proceso o no disponible' : detail}</small></article>)}</section>
}

export function AsignacionFicha({ vehiculo, conductor, peso }: { vehiculo?: Vehiculo; conductor?: Conductor; peso?: number }) {
  const conocido = peso !== undefined && Number.isFinite(peso) && peso > 0
  const exceso = conocido && vehiculo && peso > vehiculo.capacidadKg
  return <div className="ec-log-assignment">
    {vehiculo && <article><Truck size={19} /><div><strong>{vehiculo.placa} · {vehiculo.marca} {vehiculo.modelo}</strong><small>{vehiculo.propiedad === 'propio' ? 'Transporte propio' : vehiculo.transportista} · Capacidad {vehiculo.capacidadKg} kg</small>{conocido ? <><progress aria-label="Capacidad ocupada estimada" value={Math.min(peso, vehiculo.capacidadKg)} max={Math.max(1, vehiculo.capacidadKg)} /><span className={exceso ? 'ec-log-danger' : ''}>{peso} kg asignados · {exceso ? `${peso - vehiculo.capacidadKg} kg de exceso` : `${vehiculo.capacidadKg - peso} kg disponibles`}</span></> : <small>Peso de carga sin informar</small>}</div></article>}
    {conductor && <article><UserRound size={19} /><div><strong>{conductor.nombre}</strong><small>DNI {conductor.documento} · Licencia {conductor.licenciaNumero} / {conductor.licenciaCategoria}</small>{conductor.telefono ? <a href={`tel:${conductor.telefono}`}><Phone size={14} />{conductor.telefono}</a> : <small>Teléfono sin registrar</small>}</div></article>}
  </div>
}

export function EstadoRuta({ despacho }: { despacho: Despacho }) {
  const paso = ['borrador', 'programado', 'en_ruta', 'completado'].indexOf(despacho.estado)
  return <div className="ec-log-route"><span className={`status-pill ${ESTADOS_DESPACHO[despacho.estado].tone}`}>{ESTADOS_DESPACHO[despacho.estado].label}</span><ol aria-label="Progreso de la ruta">{['Borrador', 'Programado', 'En ruta', 'Ruta cerrada'].map((label, index) => <li key={label} data-done={index <= paso} aria-current={index === paso ? 'step' : undefined}><span>{index + 1}</span>{label}</li>)}</ol></div>
}

export function exportarDespachos(despachos: Despacho[]) {
  const cell = (value: unknown) => { const text = String(value ?? ''); return `"${(/^[=+\-@\t\r]/.test(text) ? "'" + text : text).replace(/"/g, '""')}"` }
  const rows = [['Despacho', 'Pedido', 'Cliente', 'Dirección', 'Fecha', 'Estado', 'Peso total despacho (kg)', 'Unidades parada'], ...despachos.flatMap(d => d.paradas.map(p => [d.numero, p.ventaCodigo, p.clienteNombre, p.direccion, d.fecha, ESTADOS_DESPACHO[d.estado].label, d.pesoEstimadoKg ?? '', p.lineas.reduce((s, l) => s + l.cantidad, 0)]))]
  const url = URL.createObjectURL(new Blob(['\uFEFF' + rows.map(row => row.map(cell).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a'); link.href = url; link.download = 'despachos-consultados.csv'; link.click(); URL.revokeObjectURL(url)
}
