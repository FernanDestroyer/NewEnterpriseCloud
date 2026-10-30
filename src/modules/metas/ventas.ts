// Avance de las metas calculado con las ventas completadas. Lógica pura: sin React ni Supabase.
// La base devuelve, por asignación, el acumulado de ventas por fecha (función metas_logrado). Aquí se
// convierte en «cortes automáticos» para que el cálculo de avance, el gráfico, el ranking y las alertas
// funcionen igual que con los cortes manuales.
import type { Asignacion, Corte } from './types.ts'

export type FilaLogrado = { asignacion_id: string; fecha: string; valor_acumulado: number | string }

export const FUENTE_VENTAS = 'Ventas completadas (automático)'

export function cortesDesdeVentas(filas: FilaLogrado[]): Corte[] {
  return filas.map(fila => ({
    id: `auto-${fila.asignacion_id}-${fila.fecha}`,
    asignacionId: String(fila.asignacion_id),
    fecha: String(fila.fecha).slice(0, 10),
    valorAcumulado: Number(fila.valor_acumulado) || 0,
    fuente: FUENTE_VENTAS,
    automatico: true,
    createdAt: '',
    updatedAt: '',
  }))
}

/** Asignaciones que se calculan con ventas (tienen al menos una fila automática). */
export function asignacionesVinculadas(automaticos: Corte[]): Set<string> {
  return new Set(automaticos.map(corte => corte.asignacionId))
}

/**
 * Cortes que se usan para calcular el avance: las asignaciones enlazadas con ventas usan SOLO el cálculo
 * automático (aunque no tengan ventas todavía, su logrado es 0); las demás conservan sus cortes manuales.
 */
export function fusionarCortes(manuales: Corte[], automaticos: Corte[]): Corte[] {
  const vinculadas = asignacionesVinculadas(automaticos)
  return [...manuales.filter(corte => !vinculadas.has(corte.asignacionId)), ...automaticos]
}

export const sePuedeCortarManual = (asignacion: Pick<Asignacion, 'id'>, vinculadas: Set<string>) => !vinculadas.has(asignacion.id)

// ---------- Aporte de cada vendedor a la meta de una sucursal ----------
export type FilaAporte = { asignacion_id: string; vendedor_id: string | null; vendedor: string; valor: number | string }
export type Aporte = { vendedorId: string | null; vendedor: string; valor: number }

/** Agrupa por asignación de sucursal (ya vienen de mayor a menor) y descarta aportes en cero. */
export function agruparAportes(filas: FilaAporte[]): Map<string, Aporte[]> {
  const mapa = new Map<string, Aporte[]>()
  for (const fila of filas) {
    const valor = Number(fila.valor) || 0
    if (valor <= 0) continue
    const lista = mapa.get(String(fila.asignacion_id)) ?? []
    lista.push({ vendedorId: fila.vendedor_id ? String(fila.vendedor_id) : null, vendedor: String(fila.vendedor), valor })
    mapa.set(String(fila.asignacion_id), lista)
  }
  for (const lista of mapa.values()) lista.sort((a, b) => b.valor - a.valor)
  return mapa
}

// ---------- Dónde está cada vendedor (sucursal y caja) ----------
export type FilaUbicacion = { asignacion_id: string; sucursal_id: string; sucursal: string; caja: string; sucursal_asignacion_id: string | null }
export type Ubicacion = { sucursal: string; caja: string; sucursalAsignacionId: string | null }

export function agruparUbicaciones(filas: FilaUbicacion[]): Map<string, Ubicacion> {
  const mapa = new Map<string, Ubicacion>()
  for (const fila of filas) mapa.set(String(fila.asignacion_id), { sucursal: String(fila.sucursal), caja: String(fila.caja), sucursalAsignacionId: fila.sucursal_asignacion_id ? String(fila.sucursal_asignacion_id) : null })
  return mapa
}
