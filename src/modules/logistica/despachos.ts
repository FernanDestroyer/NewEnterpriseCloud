// Reglas de la planificación de despachos y rutas. Lógica pura: sin React, sin Supabase y sin acceso a datos.
import type { RecordItem } from '../../types'
import { fechaReal, formatoFecha, type Errores } from './rules.ts'
import type { Despacho, DespachoInput, EstadoDespacho, LineaParada, Parada, PrioridadDespacho, Vehiculo } from './types.ts'

/** Estados de venta que pueden despacharse. Decisión de negocio: una venta a crédito (Pendiente) también se entrega. */
export const ESTADOS_VENTA_DESPACHABLES: string[] = ['Completada', 'Pendiente', 'En curso']

export const PRIORIDADES: Array<{ value: PrioridadDespacho; label: string }> = [
  { value: 'normal', label: 'Normal' },
  { value: 'alta', label: 'Alta' },
  { value: 'urgente', label: 'Urgente' },
]

export const ESTADOS_DESPACHO: Record<EstadoDespacho, { label: string; tone: 'blue' | 'amber' | 'green' | 'red' }> = {
  borrador: { label: 'Borrador', tone: 'amber' },
  programado: { label: 'Programado', tone: 'blue' },
  en_ruta: { label: 'En ruta', tone: 'blue' },
  completado: { label: 'Completado', tone: 'green' },
  cancelado: { label: 'Cancelado', tone: 'red' },
}

/** Transiciones permitidas. El seguimiento las ejecuta: programado → en ruta → completado. */
const TRANSICIONES: Record<EstadoDespacho, EstadoDespacho[]> = {
  borrador: ['programado', 'cancelado'],
  programado: ['en_ruta', 'cancelado'],
  en_ruta: ['completado'],
  completado: [],
  cancelado: [],
}

export function puedeTransicionar(desde: EstadoDespacho, hacia: EstadoDespacho) {
  return TRANSICIONES[desde].includes(hacia)
}

export const esActivo = (despacho: Despacho) => despacho.estado !== 'cancelado'

// ---------- Ventas por despachar ----------
export type VentaDespachable = {
  /** ventas.id (UUID). */
  ventaId: string
  codigo: string
  clienteId: string | null
  clienteNombre: string
  direccion: string
  telefono: string
  zonaId: string | null
  zonaNombre: string
  fecha: string
  monto: number
  estado: string
}

export type LineaVenta = { productoId: string; codigo: string; nombre: string; cantidad: number }
export type ZonaCliente = { id: string; nombre: string }

/** Convierte las ventas y clientes ya cargados en la lista de ventas que se pueden despachar. */
export function ventasDespachables(ventas: RecordItem[], clientes: RecordItem[], zonaPorCliente: Record<string, ZonaCliente>): VentaDespachable[] {
  const clientePorId = new Map<string, RecordItem>()
  for (const cliente of clientes) if (cliente.rowId) clientePorId.set(cliente.rowId, cliente)
  const resultado: VentaDespachable[] = []
  for (const venta of ventas) {
    if (!venta.rowId || !ESTADOS_VENTA_DESPACHABLES.includes(venta.status)) continue
    const cliente = venta.cliente_id ? clientePorId.get(venta.cliente_id) : undefined
    const zona = venta.cliente_id ? zonaPorCliente[venta.cliente_id] : undefined
    resultado.push({
      ventaId: venta.rowId, codigo: venta.id, clienteId: venta.cliente_id ?? null, clienteNombre: venta.name,
      direccion: cliente?.direccion?.trim() ?? '', telefono: cliente?.telefono?.trim() ?? '',
      zonaId: zona?.id ?? null, zonaNombre: zona?.nombre ?? '', fecha: venta.date, monto: venta.amount ?? 0, estado: venta.status,
    })
  }
  return resultado
}

// ---------- Cobertura: cuánto de cada venta ya está en un despacho ----------
export type CoberturaVenta = 'sin_despacho' | 'parcial' | 'completa'

function paradasDeVenta(ventaId: string, despachos: Despacho[], ignorarId?: string) {
  return despachos.filter(item => esActivo(item) && item.id !== ignorarId).flatMap(item => item.paradas).filter(parada => parada.ventaId === ventaId)
}

/** Unidades de una línea que el seguimiento marcó como NO entregadas (vuelven al almacén). */
export function unidadesNoEntregadas(parada: Parada, linea: LineaParada): number {
  if (!parada.entrega) return 0
  return Math.max(0, linea.cantidad - Math.min(linea.cantidad, parada.entrega.entregadas[linea.productoId] ?? 0))
}

/** Unidades de cada producto de la venta que ya viajan en otros despachos activos (las no entregadas no cuentan: vuelven a «Por despachar»). */
export function despachadoPorProducto(ventaId: string, despachos: Despacho[], ignorarId?: string) {
  const total: Record<string, number> = {}
  for (const parada of paradasDeVenta(ventaId, despachos, ignorarId)) for (const linea of parada.lineas) total[linea.productoId] = (total[linea.productoId] ?? 0) + linea.cantidad - unidadesNoEntregadas(parada, linea)
  return total
}

export function coberturaVenta(ventaId: string, despachos: Despacho[], ignorarId?: string): CoberturaVenta {
  const paradas = paradasDeVenta(ventaId, despachos, ignorarId)
  if (!paradas.length) return 'sin_despacho'
  const vendido: Record<string, number> = {}
  for (const parada of paradas) for (const linea of parada.lineas) vendido[linea.productoId] = Math.max(vendido[linea.productoId] ?? 0, linea.cantidadVendida)
  const despachado = despachadoPorProducto(ventaId, despachos, ignorarId)
  return Object.keys(vendido).every(id => (despachado[id] ?? 0) >= vendido[id]) ? 'completa' : 'parcial'
}

/** Arma la parada con lo que aún falta despachar de la venta; null si ya no queda nada. */
export function construirParada(venta: VentaDespachable, lineas: LineaVenta[], despachos: Despacho[], id: string, ignorarId?: string): Parada | null {
  const hecho = despachadoPorProducto(venta.ventaId, despachos, ignorarId)
  const pendientes: LineaParada[] = []
  for (const linea of lineas) {
    const pendiente = Math.floor(linea.cantidad) - (hecho[linea.productoId] ?? 0)
    if (pendiente > 0) pendientes.push({ productoId: linea.productoId, codigo: linea.codigo, nombre: linea.nombre, cantidadVendida: Math.floor(linea.cantidad), cantidad: pendiente })
  }
  if (!pendientes.length) return null
  return {
    id, orden: 0, ventaId: venta.ventaId, ventaCodigo: venta.codigo, clienteId: venta.clienteId, clienteNombre: venta.clienteNombre,
    direccion: venta.direccion, telefono: venta.telefono, zonaId: venta.zonaId, zonaNombre: venta.zonaNombre, lineas: pendientes,
  }
}

// ---------- Ruta: orden de las paradas ----------
export function renumerar(paradas: Parada[]): Parada[] {
  return paradas.map((parada, index) => ({ ...parada, orden: index + 1 }))
}

export function moverParada(paradas: Parada[], indice: number, delta: -1 | 1): Parada[] {
  const destino = indice + delta
  if (indice < 0 || indice >= paradas.length || destino < 0 || destino >= paradas.length) return renumerar(paradas)
  const copia = [...paradas]
  ;[copia[indice], copia[destino]] = [copia[destino], copia[indice]]
  return renumerar(copia)
}

export function quitarParada(paradas: Parada[], indice: number): Parada[] {
  return renumerar(paradas.filter((_, posicion) => posicion !== indice))
}

/** Agrupa las paradas por zona (las que no tienen zona van al final), conservando el orden relativo dentro de cada zona. */
export function ordenarPorZona(paradas: Parada[]): Parada[] {
  const clave = (parada: Parada) => parada.zonaNombre.trim()
  const ordenadas = paradas
    .map((parada, index) => ({ parada, index }))
    .sort((a, b) => {
      const za = clave(a.parada), zb = clave(b.parada)
      if (!za !== !zb) return za ? -1 : 1
      return za.localeCompare(zb, 'es') || a.index - b.index
    })
    .map(item => item.parada)
  return renumerar(ordenadas)
}

/** Zonas distintas de la ruta, en orden de aparición. */
export function zonasDeRuta(paradas: Parada[]): string[] {
  const zonas: string[] = []
  for (const parada of paradas) {
    const zona = parada.zonaNombre.trim() || 'Sin zona'
    if (!zonas.includes(zona)) zonas.push(zona)
  }
  return zonas
}

export function unidadesDeParada(parada: Parada) {
  return parada.lineas.reduce((total, linea) => total + linea.cantidad, 0)
}

export function unidadesDeDespacho(despacho: Pick<Despacho, 'paradas'>) {
  return despacho.paradas.reduce((total, parada) => total + unidadesDeParada(parada), 0)
}

// ---------- Numeración ----------
export function siguienteNumero(despachos: Despacho[], fecha: string) {
  const prefijo = `DSP-${fecha.replace(/-/g, '')}-`
  const usados = despachos.filter(item => item.numero.startsWith(prefijo)).map(item => Number(item.numero.slice(prefijo.length))).filter(Number.isFinite)
  return `${prefijo}${String(Math.max(0, ...usados) + 1).padStart(2, '0')}`
}

// ---------- Validación ----------
export type ResultadoDespacho = { valido: boolean; campos: Errores; motivos: string[]; avisos: string[] }

export function validarDespacho(input: DespachoInput, opciones: { modo: 'borrador' | 'programar'; vehiculo?: Vehiculo }): ResultadoDespacho {
  const campos: Errores = {}
  const motivos: string[] = []
  const avisos: string[] = []
  const programar = opciones.modo === 'programar'

  if (!fechaReal(input.fecha)) campos.fecha = 'Indica la fecha del despacho.'
  if (!input.paradas.length) campos.paradas = 'Agrega al menos una venta al despacho.'
  if (input.pesoEstimadoKg !== null && (!Number.isFinite(input.pesoEstimadoKg) || input.pesoEstimadoKg <= 0)) campos.pesoEstimadoKg = 'El peso debe ser mayor que cero.'

  const vistas = new Set<string>()
  for (const parada of input.paradas) {
    if (vistas.has(parada.ventaId)) motivos.push(`La venta ${parada.ventaCodigo} está repetida en el despacho.`)
    vistas.add(parada.ventaId)
    if (!parada.lineas.some(linea => linea.cantidad > 0)) motivos.push(`La parada ${parada.orden} (${parada.clienteNombre}) no tiene productos para despachar.`)
    for (const linea of parada.lineas) {
      if (!Number.isInteger(linea.cantidad) || linea.cantidad < 0) motivos.push(`${linea.nombre} de ${parada.ventaCodigo}: la cantidad debe ser un número entero.`)
      else if (linea.cantidad > linea.cantidadVendida) motivos.push(`${linea.nombre} de ${parada.ventaCodigo}: no puedes despachar más de lo vendido (${linea.cantidadVendida}).`)
    }
    if (programar && parada.direccion.trim().length < 5) motivos.push(`Falta la dirección de entrega de ${parada.clienteNombre} (${parada.ventaCodigo}).`)
  }

  if (programar) {
    if (!input.vehiculoId) campos.vehiculoId = 'Elige un vehículo.'
    if (!input.conductorId) campos.conductorId = 'Elige un conductor.'
    if (input.desde && input.desde.slice(0, 10) !== input.fecha) campos.desde = 'La asignación debe empezar el día del despacho.'
    if (input.pesoEstimadoKg === null) avisos.push('Sin peso estimado: no se puede comprobar la capacidad del vehículo.')
    else if (opciones.vehiculo && input.pesoEstimadoKg > opciones.vehiculo.capacidadKg) {
      motivos.push(`La carga (${input.pesoEstimadoKg.toLocaleString('es-PE')} kg) supera la capacidad del vehículo ${opciones.vehiculo.placa} (${opciones.vehiculo.capacidadKg.toLocaleString('es-PE')} kg).`)
    }
    if (!input.paradas.some(parada => parada.zonaNombre.trim())) avisos.push('Ninguna parada tiene zona de reparto asignada.')
  }

  return { valido: Object.keys(campos).length === 0 && motivos.length === 0, campos, motivos, avisos }
}

/** Comprueba que las cantidades no excedan lo vendido considerando los demás despachos activos. */
export function validarCantidadesContraOtros(paradas: Parada[], despachos: Despacho[], ignorarId?: string): string[] {
  const motivos: string[] = []
  for (const parada of paradas) {
    const hecho = despachadoPorProducto(parada.ventaId, despachos, ignorarId)
    for (const linea of parada.lineas) {
      const otros = hecho[linea.productoId] ?? 0
      if (otros + linea.cantidad > linea.cantidadVendida) motivos.push(`${linea.nombre} de ${parada.ventaCodigo}: ya hay ${otros} unidad(es) en otros despachos; solo quedan ${Math.max(0, linea.cantidadVendida - otros)}.`)
    }
  }
  return motivos
}

export function descripcionDespacho(despacho: Pick<Despacho, 'numero' | 'fecha'>) {
  return `${despacho.numero} · ${formatoFecha(despacho.fecha)}`
}
