// Persistencia de estacionamientos base y repertorio de rutas en Supabase con respaldo controlado en el navegador.
import { supabase } from '../../lib/supabase'
import { friendlyError } from '../../services/records'
import {
  ESTACIONAMIENTO_BASE_DEFAULT,
  type Estacionamiento,
  type ParadaRuta,
  type RutaGuardada,
} from './rutasGeo.ts'

const KEY_ESTACIONAMIENTO = 'ec_logistica_estacionamiento_v1'
const KEY_RUTAS = 'ec_logistica_rutas_repertorio_v1'

type EstacionamientoRow = {
  id: string
  nombre: string
  direccion: string
  distrito: string
  referencia: string
  lat: number
  lng: number
  activo: boolean
  updated_at?: string
}

type RutaRow = {
  id: string
  nombre: string
  fecha: string
  almacen_id: string | null
  almacen_nombre: string
  estacionamiento_id: string | null
  estacionamiento_nombre: string
  estacionamiento_lat: number
  estacionamiento_lng: number
  conductor_id: string | null
  conductor_nombre: string
  vehiculo_id: string | null
  vehiculo_placa: string
  despacho_id: string | null
  paradas: ParadaRuta[]
  retornar_base: boolean
  distancia_total_km: number
  tiempo_estimado_min: number
  observaciones: string
  created_at: string
}

function nuevoUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `ruta-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function esTablaFaltante(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const err = error as { code?: string; message?: string; details?: string }
  const code = String(err.code ?? '')
  const msg = `${err.message ?? ''} ${err.details ?? ''}`.toLowerCase()
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache')
  )
}

function leerLocal<T>(clave: string, fallback: T): T {
  try {
    const raw = globalThis.localStorage?.getItem(clave)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function escribirLocal(clave: string, valor: unknown): void {
  try {
    globalThis.localStorage?.setItem(clave, JSON.stringify(valor))
  } catch {
    // Sin espacio o entorno sin localStorage
  }
}

function mapEstacionamiento(row: EstacionamientoRow): Estacionamiento {
  return {
    id: row.id,
    nombre: row.nombre,
    direccion: row.direccion ?? '',
    distrito: row.distrito ?? '',
    referencia: row.referencia ?? '',
    lat: Number(row.lat),
    lng: Number(row.lng),
    activo: Boolean(row.activo),
    updatedAt: row.updated_at,
  }
}

function mapRuta(row: RutaRow): RutaGuardada {
  return {
    id: row.id,
    nombre: row.nombre,
    fecha: String(row.fecha).slice(0, 10),
    almacenId: row.almacen_id ?? null,
    almacenNombre: row.almacen_nombre ?? '',
    estacionamientoId: row.estacionamiento_id ?? null,
    estacionamientoNombre: row.estacionamiento_nombre ?? '',
    estacionamientoLat: Number(row.estacionamiento_lat),
    estacionamientoLng: Number(row.estacionamiento_lng),
    conductorId: row.conductor_id ?? null,
    conductorNombre: row.conductor_nombre ?? '',
    vehiculoId: row.vehiculo_id ?? null,
    vehiculoPlaca: row.vehiculo_placa ?? '',
    despachoId: row.despacho_id ?? null,
    paradas: Array.isArray(row.paradas) ? row.paradas : [],
    retornarBase: Boolean(row.retornar_base),
    distanciaTotalKm: Number(row.distancia_total_km ?? 0),
    tiempoEstimadoMin: Number(row.tiempo_estimado_min ?? 0),
    observaciones: row.observaciones ?? '',
    createdAt: row.created_at,
  }
}

function esUuidValido(valor?: string | null): valor is string {
  return Boolean(valor && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(valor))
}

export function crearRutasService() {
  return {
    async obtenerEstacionamiento(): Promise<{ item: Estacionamiento; enNavegador: boolean }> {
      if (!supabase) {
        return { item: leerLocal<Estacionamiento>(KEY_ESTACIONAMIENTO, ESTACIONAMIENTO_BASE_DEFAULT), enNavegador: true }
      }

      const { data, error } = await supabase
        .from('logistica_estacionamientos')
        .select('*')
        .eq('activo', true)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (error) {
        if (esTablaFaltante(error)) {
          return { item: leerLocal<Estacionamiento>(KEY_ESTACIONAMIENTO, ESTACIONAMIENTO_BASE_DEFAULT), enNavegador: true }
        }
        throw new Error(friendlyError(error))
      }

      if (!data) {
        return { item: ESTACIONAMIENTO_BASE_DEFAULT, enNavegador: false }
      }

      return { item: mapEstacionamiento(data as EstacionamientoRow), enNavegador: false }
    },

    async guardarEstacionamiento(
      input: Omit<Estacionamiento, 'id' | 'activo'> & { id?: string },
    ): Promise<{ item: Estacionamiento; enNavegador: boolean }> {
      const payloadLocal: Estacionamiento = {
        id: input.id && input.id !== ESTACIONAMIENTO_BASE_DEFAULT.id ? input.id : ESTACIONAMIENTO_BASE_DEFAULT.id,
        nombre: input.nombre.trim(),
        direccion: input.direccion.trim(),
        distrito: input.distrito.trim(),
        referencia: input.referencia.trim(),
        lat: Number(input.lat),
        lng: Number(input.lng),
        activo: true,
        updatedAt: new Date().toISOString(),
      }

      if (!supabase) {
        escribirLocal(KEY_ESTACIONAMIENTO, payloadLocal)
        return { item: payloadLocal, enNavegador: true }
      }

      const existenteUuid = esUuidValido(input.id) ? input.id : null
      const camposDb = {
        nombre: payloadLocal.nombre,
        direccion: payloadLocal.direccion,
        distrito: payloadLocal.distrito,
        referencia: payloadLocal.referencia,
        lat: payloadLocal.lat,
        lng: payloadLocal.lng,
        activo: true,
      }

      const consulta = existenteUuid
        ? supabase.from('logistica_estacionamientos').update(camposDb).eq('id', existenteUuid).select('*').single()
        : supabase.from('logistica_estacionamientos').insert(camposDb).select('*').single()

      const { data, error } = await consulta

      if (error) {
        if (esTablaFaltante(error)) {
          escribirLocal(KEY_ESTACIONAMIENTO, payloadLocal)
          return { item: payloadLocal, enNavegador: true }
        }
        throw new Error(friendlyError(error))
      }

      const guardado = mapEstacionamiento(data as EstacionamientoRow)
      escribirLocal(KEY_ESTACIONAMIENTO, guardado)
      return { item: guardado, enNavegador: false }
    },

    async listarRutas(): Promise<{ items: RutaGuardada[]; enNavegador: boolean }> {
      if (!supabase) {
        const items = leerLocal<RutaGuardada[]>(KEY_RUTAS, [])
        return { items, enNavegador: true }
      }

      const { data, error } = await supabase
        .from('logistica_rutas')
        .select('*')
        .order('fecha', { ascending: false })
        .order('created_at', { ascending: false })

      if (error) {
        if (esTablaFaltante(error)) {
          return { items: leerLocal<RutaGuardada[]>(KEY_RUTAS, []), enNavegador: true }
        }
        throw new Error(friendlyError(error))
      }

      return { items: ((data ?? []) as RutaRow[]).map(mapRuta), enNavegador: false }
    },

    async guardarRuta(
      input: Omit<RutaGuardada, 'id' | 'createdAt'> & { id?: string },
    ): Promise<{ item: RutaGuardada; enNavegador: boolean }> {
      const ahora = new Date().toISOString()
      const localItem: RutaGuardada = {
        ...input,
        id: input.id || nuevoUuid(),
        nombre: input.nombre.trim(),
        createdAt: ahora,
      }

      const guardarLocal = () => {
        const actuales = leerLocal<RutaGuardada[]>(KEY_RUTAS, [])
        const restantes = actuales.filter(item => item.id !== localItem.id)
        const siguientes = [localItem, ...restantes]
        escribirLocal(KEY_RUTAS, siguientes)
        return localItem
      }

      if (!supabase) {
        return { item: guardarLocal(), enNavegador: true }
      }

      const payloadDb = {
        nombre: localItem.nombre,
        fecha: localItem.fecha,
        almacen_id: esUuidValido(localItem.almacenId) ? localItem.almacenId : null,
        almacen_nombre: localItem.almacenNombre,
        estacionamiento_id: esUuidValido(localItem.estacionamientoId) ? localItem.estacionamientoId : null,
        estacionamiento_nombre: localItem.estacionamientoNombre,
        estacionamiento_lat: localItem.estacionamientoLat,
        estacionamiento_lng: localItem.estacionamientoLng,
        conductor_id: esUuidValido(localItem.conductorId) ? localItem.conductorId : null,
        conductor_nombre: localItem.conductorNombre,
        vehiculo_id: esUuidValido(localItem.vehiculoId) ? localItem.vehiculoId : null,
        vehiculo_placa: localItem.vehiculoPlaca,
        despacho_id: esUuidValido(localItem.despachoId) ? localItem.despachoId : null,
        paradas: localItem.paradas,
        retornar_base: localItem.retornarBase,
        distancia_total_km: localItem.distanciaTotalKm,
        tiempo_estimado_min: localItem.tiempoEstimadoMin,
        observaciones: localItem.observaciones,
      }

      const existenteUuid = esUuidValido(input.id) ? input.id : null
      const consulta = existenteUuid
        ? supabase.from('logistica_rutas').update(payloadDb).eq('id', existenteUuid).select('*').single()
        : supabase.from('logistica_rutas').insert(payloadDb).select('*').single()

      const { data, error } = await consulta

      if (error) {
        if (esTablaFaltante(error)) {
          return { item: guardarLocal(), enNavegador: true }
        }
        throw new Error(friendlyError(error))
      }

      return { item: mapRuta(data as RutaRow), enNavegador: false }
    },

    async eliminarRuta(id: string): Promise<void> {
      const eliminarLocal = () => {
        const actuales = leerLocal<RutaGuardada[]>(KEY_RUTAS, [])
        escribirLocal(
          KEY_RUTAS,
          actuales.filter(item => item.id !== id),
        )
      }

      if (!supabase || !esUuidValido(id)) {
        eliminarLocal()
        return
      }

      const { error } = await supabase.from('logistica_rutas').delete().eq('id', id)
      if (error) {
        if (esTablaFaltante(error)) {
          eliminarLocal()
          return
        }
        throw new Error(friendlyError(error))
      }
      eliminarLocal()
    },
  }
}
