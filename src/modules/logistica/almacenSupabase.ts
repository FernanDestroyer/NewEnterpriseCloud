// Almacén de datos de Logística sobre Supabase. Recibe el cliente por parámetro (no importa lib/supabase)
// para poder probarlo con un cliente simulado: ver tests/logistica-db.test.mjs. db.ts lo conecta al cliente real.
// Usa las tablas vehiculos / conductores / asignaciones_vehiculo (script base) y despachos
// (migración 20261104010000_despachos.sql). Si Supabase no está configurado o las tablas
// aún no existen, respalda en este navegador para que el módulo siga usable.
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  demapearAsignacion, demapearConductor, demapearDespacho, demapearVehiculo, errorLogistica,
  mapearAsignacion, mapearConductor, mapearDespacho, mapearVehiculo, type Fila,
} from './filas.ts'
import { registrarEventoFallido } from '../../lib/auditoriaEventos.ts'
import { crearAlmacenLocal, type AlmacenLogistica, type Coleccion } from './storage.ts'
import type { Asignacion, Conductor, Despacho, Vehiculo } from './types.ts'

export type Cliente = SupabaseClient

const TABLAS_FLOTA = ['vehiculos', 'conductores', 'asignaciones_vehiculo'] as const
const TABLA_DESPACHOS = 'despachos'

/** Comprueba que las tablas existan y el rol pueda consultarlas (RLS devuelve vacío, no error, si no hay permiso). */
async function tablasDisponibles(cliente: Cliente, tablas: readonly string[]): Promise<boolean> {
  try {
    const resultados = await Promise.all(tablas.map(tabla => cliente.from(tabla).select('id').limit(1)))
    return resultados.every(resultado => !resultado.error)
  } catch {
    return false
  }
}

/**
 * Elige dónde viven los datos:
 * - Tablas de flota disponibles -> base de datos (compartido y con bitácora).
 * - Además falta la tabla despachos -> flota en la base y despachos en el navegador, con aviso.
 * - Sin Supabase o sin tablas de flota -> todo en el navegador, con aviso.
 */
export async function verificarAlmacen(cliente: Cliente | null, ambito: string): Promise<AlmacenLogistica> {
  if (!cliente) return crearAlmacenLocal(ambito)
  if (!(await tablasDisponibles(cliente, TABLAS_FLOTA))) return crearAlmacenLocal(ambito)
  const base = crearAlmacenSupabase(cliente)
  if (await tablasDisponibles(cliente, [TABLA_DESPACHOS])) return base
  return { ...base, despachos: crearAlmacenLocal(ambito).despachos, despachosEnNavegador: true }
}

export function crearAlmacenSupabase(cliente: Cliente): AlmacenLogistica {
  return {
    origen: 'base-de-datos',
    vehiculos: coleccionSupabase<Vehiculo>(cliente, 'vehiculos', demapearVehiculo, mapearVehiculo),
    conductores: coleccionSupabase<Conductor>(cliente, 'conductores', demapearConductor, mapearConductor),
    asignaciones: coleccionSupabase<Asignacion>(cliente, 'asignaciones_vehiculo', demapearAsignacion, mapearAsignacion),
    despachos: coleccionSupabase<Despacho>(cliente, TABLA_DESPACHOS, demapearDespacho, mapearDespacho),
  }
}

function coleccionSupabase<T extends { id: string }>(
  cliente: Cliente,
  tabla: string,
  demapear: (item: T) => Fila,
  mapear: (fila: Fila) => T,
): Coleccion<T> {
  return {
    async listar() {
      const { data, error } = await cliente.from(tabla).select('*')
      if (error) throw errorLogistica(error)
      return (data ?? []).map(fila => mapear(fila as Fila))
    },

    /**
     * Crea o reemplaza por id. Se intenta primero UPDATE y, si no existía la fila, INSERT:
     * así un rol con «crear» pero sin «editar» puede crear, y uno con «editar» puede modificar,
     * cada uno bajo su propia política RLS (un upsert exigiría las dos a la vez).
     */
    async guardar(item) {
      const fila = demapear(item)
      // Referencia legible para la bitácora: número de despacho, placa o, si no hay, el id.
      const referencia = String(fila.numero ?? fila.placa ?? fila.codigo ?? item.id)
      const actualizado = await cliente.from(tabla).update(fila).eq('id', item.id).select().maybeSingle()
      if (actualizado.error) { registrarEventoFallido(cliente, 'UPDATE', tabla, referencia, actualizado.error); throw errorLogistica(actualizado.error) }
      if (actualizado.data) return mapear(actualizado.data as Fila)

      const creado = await cliente.from(tabla).insert(fila).select().single()
      if (creado.error) {
        // Misma clave primaria: la fila existe pero el UPDATE no la tocó, es decir, RLS lo impidió.
        if (creado.error.code === '23505' && /_pkey/.test(`${creado.error.message} ${creado.error.details ?? ''}`)) {
          registrarEventoFallido(cliente, 'UPDATE', tabla, referencia, { code: '42501', message: 'Modificación bloqueada por permisos (RLS).' })
          throw new Error('Tu rol no tiene permiso para modificar este registro.')
        }
        registrarEventoFallido(cliente, 'INSERT', tabla, referencia, creado.error)
        throw errorLogistica(creado.error)
      }
      return mapear(creado.data as Fila)
    },
  }
}
