// Reglas del seguimiento, entrega y devoluciones. Lógica pura: sin React, sin Supabase y sin acceso a datos.
import { unidadesDeParada, unidadesNoEntregadas } from './despachos.ts'
import type { Errores } from './rules.ts'
import type { Despacho, Entrega, LineaParada, MotivoNoEntrega, Parada, ResultadoEntrega } from './types.ts'

export const RESULTADOS_ENTREGA: Record<ResultadoEntrega, { label: string; tone: 'green' | 'amber' | 'red' }> = {
  entregada: { label: 'Entregada', tone: 'green' },
  parcial: { label: 'Entrega parcial', tone: 'amber' },
  no_entregada: { label: 'No entregada', tone: 'red' },
}

export const MOTIVOS_NO_ENTREGA: Array<{ value: MotivoNoEntrega; label: string }> = [
  { value: 'ausente', label: 'Cliente ausente' },
  { value: 'direccion', label: 'Dirección incorrecta o no encontrada' },
  { value: 'rechazo', label: 'El cliente rechazó la mercadería' },
  { value: 'sin_acceso', label: 'Sin acceso al lugar de entrega' },
  { value: 'otro', label: 'Otro motivo (explícalo en la nota)' },
]

export const motivoLabel = (valor: string) => MOTIVOS_NO_ENTREGA.find(item => item.value === valor)?.label ?? valor

export type EstadoParada = 'pendiente' | ResultadoEntrega
export const estadoParada = (parada: Parada): EstadoParada => parada.entrega?.resultado ?? 'pendiente'

/** Unidades entregadas de la parada (0 mientras está pendiente). */
export function unidadesEntregadas(parada: Parada): number {
  if (!parada.entrega) return 0
  return parada.lineas.reduce((suma, linea) => suma + Math.min(linea.cantidad, parada.entrega?.entregadas[linea.productoId] ?? 0), 0)
}

/** Unidades que volvieron (no se entregaron) en una parada ya resuelta. */
export const unidadesDevueltas = (parada: Parada): number => parada.lineas.reduce((suma, linea) => suma + unidadesNoEntregadas(parada, linea), 0)

/** Líneas con unidades por devolver, con la cantidad exacta. */
export function lineasDevueltas(parada: Parada): Array<{ linea: LineaParada; cantidad: number }> {
  return parada.lineas.map(linea => ({ linea, cantidad: unidadesNoEntregadas(parada, linea) })).filter(item => item.cantidad > 0)
}

export type ResumenSeguimiento = {
  total: number; resueltas: number; pendientes: number; entregadas: number; parciales: number; noEntregadas: number
  unidades: number; unidadesEntregadas: number; unidadesDevueltas: number; porcentaje: number
}

export function resumenSeguimiento(despacho: Pick<Despacho, 'paradas'>): ResumenSeguimiento {
  const estados = despacho.paradas.map(estadoParada)
  const total = estados.length
  const pendientes = estados.filter(estado => estado === 'pendiente').length
  const resueltas = total - pendientes
  return {
    total, resueltas, pendientes,
    entregadas: estados.filter(estado => estado === 'entregada').length,
    parciales: estados.filter(estado => estado === 'parcial').length,
    noEntregadas: estados.filter(estado => estado === 'no_entregada').length,
    unidades: despacho.paradas.reduce((suma, parada) => suma + unidadesDeParada(parada), 0),
    unidadesEntregadas: despacho.paradas.reduce((suma, parada) => suma + unidadesEntregadas(parada), 0),
    unidadesDevueltas: despacho.paradas.reduce((suma, parada) => suma + unidadesDevueltas(parada), 0),
    porcentaje: total ? resueltas / total : 0,
  }
}

/** Motivos por los que el despacho todavía no se puede cerrar (vacío = se puede completar). */
export function motivosParaCompletar(despacho: Despacho): string[] {
  if (despacho.estado !== 'en_ruta') return ['Solo se puede completar un despacho que está en ruta.']
  const pendientes = despacho.paradas.filter(parada => estadoParada(parada) === 'pendiente')
  return pendientes.length ? [`Faltan ${pendientes.length === 1 ? '1 parada' : `${pendientes.length} paradas`} por registrar (${pendientes.map(parada => parada.ventaCodigo).join(', ')}).`] : []
}

// ---------- Registro de una entrega ----------
export type EntradaEntrega = {
  resultado: ResultadoEntrega
  receptor: string
  motivo: MotivoNoEntrega | ''
  nota: string
  /** Texto por producto, tal como lo escribe la persona (solo para entrega parcial). */
  cantidades: Record<string, string>
}

export function validarEntrega(parada: Parada, entrada: EntradaEntrega): { valido: boolean; campos: Errores } {
  const campos: Errores = {}
  if (entrada.resultado !== 'no_entregada' && entrada.receptor.trim().length < 2) campos.receptor = 'Indica quién recibió la mercadería.'
  if (entrada.resultado !== 'entregada' && !entrada.motivo) campos.motivo = 'Elige el motivo.'
  if (entrada.motivo === 'otro' && entrada.nota.trim().length < 3) campos.nota = 'Explica qué ocurrió.'
  if (entrada.resultado === 'parcial') {
    let alguna = false, faltante = false
    for (const linea of parada.lineas) {
      const texto = (entrada.cantidades[linea.productoId] ?? '').trim()
      const valor = Number(texto)
      if (texto === '' || !Number.isInteger(valor) || valor < 0 || valor > linea.cantidad) campos[`cantidad-${linea.productoId}`] = `Entre 0 y ${linea.cantidad}.`
      else { if (valor > 0) alguna = true; if (valor < linea.cantidad) faltante = true }
    }
    if (!Object.keys(campos).some(clave => clave.startsWith('cantidad-'))) {
      if (!alguna) campos.cantidades = 'Si no se entregó nada, elige «No se pudo entregar».'
      else if (!faltante) campos.cantidades = 'Si se entregó todo, elige «Entregada completa».'
    }
  }
  return { valido: Object.keys(campos).length === 0, campos }
}

export function construirEntrega(parada: Parada, entrada: EntradaEntrega, ahora: string): Entrega {
  const entregadas: Record<string, number> = {}
  for (const linea of parada.lineas) {
    entregadas[linea.productoId] = entrada.resultado === 'entregada' ? linea.cantidad : entrada.resultado === 'no_entregada' ? 0 : Math.trunc(Number(entrada.cantidades[linea.productoId]))
  }
  return {
    resultado: entrada.resultado, registradoEn: ahora, receptor: entrada.resultado === 'no_entregada' ? '' : entrada.receptor.trim(),
    motivo: entrada.resultado === 'entregada' ? '' : entrada.motivo, nota: entrada.nota.trim(), entregadas,
  }
}

// ---------- Devoluciones ----------
export type FilaDevolucion = { despacho: Despacho; parada: Parada; unidades: number; estado: 'pendiente' | 'reingresada' }

/** Paradas con unidades devueltas, de cualquier despacho no cancelado. */
export function devolucionesDe(despachos: Despacho[]): FilaDevolucion[] {
  const filas: FilaDevolucion[] = []
  for (const despacho of despachos) {
    if (despacho.estado === 'cancelado') continue
    for (const parada of despacho.paradas) {
      const unidades = unidadesDevueltas(parada)
      if (unidades > 0) filas.push({ despacho, parada, unidades, estado: parada.devolucion?.estado ?? 'pendiente' })
    }
  }
  return filas.sort((a, b) => (a.estado === b.estado ? b.despacho.fecha.localeCompare(a.despacho.fecha) : a.estado === 'pendiente' ? -1 : 1))
}
