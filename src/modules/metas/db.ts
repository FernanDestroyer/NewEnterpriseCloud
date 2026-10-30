// Capa de datos de Metas y Objetivos.
// Si Supabase está configurado usa las tablas metas / metas_asignaciones / metas_cortes
// (migración 20261103000000_metas_objetivos.sql); si no, respalda en este navegador.
import { supabase } from '../../lib/supabase'
import { registrarEventoFallido } from '../../lib/auditoriaEventos'
import { crearAlmacenLocal, type AlmacenMetas, type Coleccion } from './storage.ts'
import { agruparAportes, agruparUbicaciones, cortesDesdeVentas, type Aporte, type FilaAporte, type FilaLogrado, type FilaUbicacion, type Ubicacion } from './ventas'
import type { Asignacion, Corte, IndicadorMeta, Meta } from './types'

/** Punto único para elegir la implementación: Supabase si está configurado, navegador si no. */
export function obtenerAlmacen(): AlmacenMetas {
  return supabase ? crearAlmacenSupabase(supabase) : crearAlmacenLocal('local')
}

/**
 * Verifica que las tablas del módulo existan y sean accesibles. Si Supabase no está
 * configurado, o las tablas faltan (migración 20261103000000 no aplicada) o el rol no
 * tiene metas:ver, usa el respaldo local para que el módulo siga usable.
 */
export async function obtenerAlmacenVerificado(): Promise<AlmacenMetas> {
  if (!supabase) return crearAlmacenLocal('local')
  try {
    const { error } = await supabase.from('metas').select('id').limit(1)
    if (!error) return crearAlmacenSupabase(supabase)
  } catch { /* red o permisos: se usa el respaldo local */ }
  return crearAlmacenLocal('local')
}

export function crearAlmacenSupabase(cliente: Cliente): AlmacenMetas {
  return {
    origen: 'base-de-datos',
    metas: coleccionSupabase<Meta>(cliente, 'metas', demapearMeta, mapearMeta),
    asignaciones: coleccionSupabase<Asignacion>(cliente, 'metas_asignaciones', demapearAsignacion, mapearAsignacion),
    cortes: coleccionSupabase<Corte>(cliente, 'metas_cortes', demapearCorte, mapearCorte),
  }
}

// ---------- Implementación Supabase ----------

type FilaMeta = Record<string, unknown>

function errorAlGuardar(reason: unknown): Error {
  const mensaje = (reason as { message?: string } | null)?.message
  return new Error(mensaje?.trim() || 'No se pudo guardar el registro en Supabase.')
}

function demapearMeta(item: Meta): FilaMeta {
  return {
    id: item.id,
    codigo: item.codigo,
    nombre: item.nombre,
    indicador: item.indicador,
    valor_objetivo: item.valorObjetivo,
    fecha_inicio: item.desde,
    fecha_fin: item.hasta,
    responsable: item.responsable || null,
    estado: item.estado,
  }
}

function mapearMeta(row: FilaMeta): Meta {
  return {
    id: String(row.id),
    codigo: String(row.codigo ?? ''),
    nombre: String(row.nombre ?? ''),
    indicador: (row.indicador === 'unidades' ? 'unidades' : 'importe') as IndicadorMeta,
    valorObjetivo: Number(row.valor_objetivo ?? 0),
    desde: String(row.fecha_inicio ?? ''),
    hasta: String(row.fecha_fin ?? ''),
    responsable: String(row.responsable ?? ''),
    estado: (row.estado === 'cerrada' || row.estado === 'inactiva' ? row.estado : 'vigente') as Meta['estado'],
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
  }
}

function demapearAsignacion(item: Asignacion): FilaMeta {
  return {
    id: item.id,
    meta_id: item.metaId,
    alcance: item.alcance,
    objetivo: item.objetivo,
    valor_objetivo: item.valorObjetivo,
    estado: item.estado,
    // Solo se envía cuando hay enlace: así sigue funcionando aunque falte la columna (migración pendiente).
    ...(item.referenciaId ? { referencia_id: item.referenciaId } : {}),
  }
}

function mapearAsignacion(row: FilaMeta): Asignacion {
  return {
    id: String(row.id),
    metaId: String(row.meta_id ?? ''),
    alcance: (row.alcance === 'sucursal' || row.alcance === 'producto' ? row.alcance : 'vendedor') as Asignacion['alcance'],
    objetivo: String(row.objetivo ?? ''),
    valorObjetivo: Number(row.valor_objetivo ?? 0),
    referenciaId: row.referencia_id ? String(row.referencia_id) : null,
    estado: row.estado === 'inactiva' ? 'inactiva' : 'activa',
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
  }
}

function demapearCorte(item: Corte): FilaMeta {
  return {
    id: item.id,
    asignacion_id: item.asignacionId,
    fecha: item.fecha,
    valor_acumulado: item.valorAcumulado,
    fuente: item.fuente || null,
  }
}

function mapearCorte(row: FilaMeta): Corte {
  return {
    id: String(row.id),
    asignacionId: String(row.asignacion_id ?? ''),
    fecha: String(row.fecha ?? ''),
    valorAcumulado: Number(row.valor_acumulado ?? 0),
    fuente: String(row.fuente ?? ''),
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
  }
}

type Cliente = NonNullable<typeof supabase>

function coleccionSupabase<T extends { id: string }>(
  cliente: Cliente,
  tabla: string,
  demapear: (item: T) => FilaMeta,
  mapear: (row: FilaMeta) => T,
): Coleccion<T> {
  return {
    async listar() {
      const { data, error } = await cliente.from(tabla).select('*')
      if (error) throw errorAlGuardar(error)
      return (data ?? []).map(row => mapear(row as FilaMeta))
    },
    async guardar(item) {
      const fila = demapear(item)
      const { data, error } = await cliente.from(tabla).upsert(fila).select().single()
      if (error) { registrarEventoFallido(cliente, 'GUARDAR', tabla, String(fila.codigo ?? item.id), error); throw errorAlGuardar(error) }
      return mapear(data as FilaMeta)
    },
    async eliminar(id) {
      const { error } = await cliente.from(tabla).delete().eq('id', id)
      if (error) { registrarEventoFallido(cliente, 'DELETE', tabla, id, error); throw errorAlGuardar(error) }
    },
  }
}


// ---------- Avance calculado con las ventas ----------
export type ResultadoLogrado = { cortes: Corte[]; disponible: boolean }

/**
 * Pide a la base el acumulado de ventas completadas por asignación (función metas_logrado). Si Supabase no
 * está configurado o la migración 20261104040000 aún no se aplicó, devuelve `disponible: false` y la
 * pantalla sigue usando los cortes manuales.
 */
export async function cargarLogradoVentas(): Promise<ResultadoLogrado> {
  if (!supabase) return { cortes: [], disponible: false }
  const { data, error } = await supabase.rpc('metas_logrado', { p_meta: null })
  if (error) return { cortes: [], disponible: false }
  return { cortes: cortesDesdeVentas((data ?? []) as FilaLogrado[]), disponible: true }
}

export type OpcionCatalogo = { id: string; nombre: string }

/** Usuarios, sucursales o productos para elegir al asignar. Lista vacía si no está disponible. */
export async function cargarCatalogo(alcance: Asignacion['alcance']): Promise<OpcionCatalogo[]> {
  if (!supabase) return []
  const { data, error } = await supabase.rpc('metas_catalogo', { p_alcance: alcance })
  if (error) return []
  return ((data ?? []) as Array<{ id: string; nombre: string }>).map(fila => ({ id: String(fila.id), nombre: String(fila.nombre) }))
}

/** Aporte de cada vendedor a las metas por sucursal (función metas_aportes). Vacío si no está disponible. */
export async function cargarAportes(): Promise<Map<string, Aporte[]>> {
  if (!supabase) return new Map()
  const { data, error } = await supabase.rpc('metas_aportes', { p_meta: null })
  if (error) return new Map()
  return agruparAportes((data ?? []) as FilaAporte[])
}

/** Sucursal y caja de cada vendedor de las metas (función metas_ubicaciones). Vacío si no está disponible. */
export async function cargarUbicaciones(): Promise<Map<string, Ubicacion>> {
  if (!supabase) return new Map()
  const { data, error } = await supabase.rpc('metas_ubicaciones', { p_meta: null })
  if (error) return new Map()
  return agruparUbicaciones((data ?? []) as FilaUbicacion[])
}
