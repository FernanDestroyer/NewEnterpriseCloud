// Reglas de cálculo del módulo de Metas y Objetivos: avance, previsto, ranking y alertas.
import { money } from '../../data/helpers'
import type { AlcanceMeta, AvanceFila, Corte, EstadoMeta, IndicadorMeta, Meta } from './types'

/** Fecha de negocio (calendario de Lima) como YYYY-MM-DD. */
export function fechaLima(ahora = new Date()): string {
  return ahora.toLocaleDateString('es-PE', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' }).split('/').reverse().join('-')
}

export const INDICADORES: { value: IndicadorMeta; label: string }[] = [
  { value: 'importe', label: 'Importe de ventas (S/)' },
  { value: 'unidades', label: 'Unidades vendidas' },
]

export const ALCANCES: { value: AlcanceMeta; label: string; placeholder: string }[] = [
  { value: 'vendedor', label: 'Vendedor', placeholder: 'Nombre del vendedor' },
  { value: 'sucursal', label: 'Sucursal', placeholder: 'Nombre de la sucursal' },
  { value: 'producto', label: 'Producto', placeholder: 'Nombre o SKU del producto' },
]

export const ESTADOS_META: Record<EstadoMeta, { label: string; tone: 'green' | 'blue' | 'red' }> = {
  vigente: { label: 'Vigente', tone: 'green' },
  cerrada: { label: 'Cerrada', tone: 'blue' },
  inactiva: { label: 'Inactiva', tone: 'red' },
}

export function alcanceLabel(alcance: AlcanceMeta): string {
  return ALCANCES.find(item => item.value === alcance)?.label ?? alcance
}

export function indicadorLabel(indicador: IndicadorMeta): string {
  return INDICADORES.find(item => item.value === indicador)?.label ?? indicador
}

/** Formatea un valor según el indicador de la meta: S/ para importe, unidades para cantidad. */
export function formatearValor(indicador: IndicadorMeta, valor: number): string {
  return indicador === 'importe' ? money(Math.round(valor * 100) / 100) : `${Math.round(valor).toLocaleString('es-PE')} u`
}

export function porcentaje(valor: number): string {
  return `${Math.round(valor * 1000) / 10}%`
}

/** Proporción del periodo ya transcurrida a la fecha de corte (0 cuando aún no inicia, 1 al cerrar). */
export function proporcionPrevista(meta: Meta, hoy: string): number {
  const inicio = Date.parse(`${meta.desde}T12:00:00Z`)
  const fin = Date.parse(`${meta.hasta}T23:59:59Z`)
  const actual = Date.parse(`${hoy}T12:00:00Z`)
  if (!Number.isFinite(inicio) || !Number.isFinite(fin) || fin <= inicio) return 0
  if (actual <= inicio) return 0
  if (actual >= fin) return 1
  return Math.round((actual - inicio) / (fin - inicio) * 1000) / 1000
}

/** Umbral en puntos porcentuales por debajo del previsto que dispara la alerta de cumplimiento (8.7). */
export const UMBRAL_ALERTA = 10

/** Último corte con fecha dentro del periodo de la meta; el valor real es el valor acumulado de ese corte. */
export function ultimoCorte(asignacionId: string, cortes: Corte[], meta?: Meta): Corte | null {
  const validos = cortes
    .filter(item => item.asignacionId === asignacionId && (!meta || (item.fecha >= meta.desde && item.fecha <= meta.hasta)))
    .sort((a, b) => a.fecha.localeCompare(b.fecha))
  return validos[validos.length - 1] ?? null
}

/** Calcula la fila de avance de una asignación a partir de su meta y los cortes registrados. */
export function calcularAvance(
  asignacion: { id: string; metaId: string; valorObjetivo: number; estado: string },
  meta: Meta | undefined,
  cortes: Corte[],
  hoy: string,
): AvanceFila | null {
  if (!meta || asignacion.estado !== 'activa') return null
  const corte = ultimoCorte(asignacion.id, cortes, meta)
  const valorReal = corte ? Math.max(0, corte.valorAcumulado) : 0
  const objetivo = asignacion.valorObjetivo > 0 ? asignacion.valorObjetivo : 0
  const cumplimiento = objetivo > 0 ? Math.min(valorReal / objetivo, 9.99) : 0
  const previsto = proporcionPrevista(meta, hoy)
  const desfase = Math.round((cumplimiento - previsto) * 1000) / 10
  return {
    asignacion: asignacion as AvanceFila['asignacion'],
    meta,
    corte,
    valorReal,
    cumplimiento,
    previsto,
    desfase,
    alerta: cumplimiento + UMBRAL_ALERTA / 100 < previsto,
  }
}

/** Mensaje humano de la alerta de cumplimiento. */
export function mensajeAlerta(fila: AvanceFila): string {
  const diferencia = fila.previsto - fila.cumplimiento
  return `Va ${porcentaje(diferencia)} por debajo del ritmo esperado al ${porcentaje(fila.previsto)} del periodo.`
}
