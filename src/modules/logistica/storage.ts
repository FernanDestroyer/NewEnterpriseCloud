// Capa de datos de Logística. Las pantallas y el servicio solo conocen estas interfaces:
// conectar Supabase más adelante es reemplazar este archivo, no las pantallas.
import type { Asignacion, Conductor, Despacho, Vehiculo } from './types.ts'

export interface Coleccion<T extends { id: string }> {
  listar(): Promise<T[]>
  /** Crea o reemplaza por id. */
  guardar(item: T): Promise<T>
}

export interface AlmacenLogistica {
  vehiculos: Coleccion<Vehiculo>
  conductores: Coleccion<Conductor>
  asignaciones: Coleccion<Asignacion>
  despachos: Coleccion<Despacho>
  /** Dónde viven los datos; la pantalla avisa cuando son locales. */
  readonly origen: 'navegador' | 'base-de-datos'
  /** Flota en la base de datos pero despachos aún en el navegador (falta la tabla despachos). */
  readonly despachosEnNavegador?: boolean
}

export function nuevoId() {
  const c = globalThis.crypto as Crypto | undefined
  if (c?.randomUUID) return c.randomUUID()
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

// Respaldo en memoria: se usa si localStorage no existe (pruebas) o falla (modo privado, cuota).
const respaldo = new Map<string, string>()
const soloMemoria = new Set<string>()

function leer<T>(clave: string): T[] {
  let raw: string | null = null
  if (!soloMemoria.has(clave)) {
    try { raw = localStorage.getItem(clave) } catch { raw = null }
  }
  raw ??= respaldo.get(clave) ?? null
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed as T[] : []
  } catch { return [] }
}

function escribir(clave: string, items: unknown[]) {
  const raw = JSON.stringify(items)
  respaldo.set(clave, raw)
  try {
    localStorage.setItem(clave, raw)
    soloMemoria.delete(clave)
  } catch { soloMemoria.add(clave) }
}

function coleccion<T extends { id: string }>(clave: string): Coleccion<T> {
  return {
    async listar() { return leer<T>(clave) },
    async guardar(item) {
      const items = leer<T>(clave)
      const index = items.findIndex(actual => actual.id === item.id)
      if (index >= 0) items[index] = item
      else items.push(item)
      escribir(clave, items)
      return item
    },
  }
}

/** Almacén local por ámbito (id de usuario), para que dos cuentas del mismo navegador no compartan datos. */
export function crearAlmacenLocal(ambito: string): AlmacenLogistica {
  const prefijo = `enterprisecloud:logistica:${ambito}`
  return {
    origen: 'navegador',
    vehiculos: coleccion<Vehiculo>(`${prefijo}:vehiculos`),
    conductores: coleccion<Conductor>(`${prefijo}:conductores`),
    asignaciones: coleccion<Asignacion>(`${prefijo}:asignaciones`),
    despachos: coleccion<Despacho>(`${prefijo}:despachos`),
  }
}

let actual: { ambito: string; almacen: AlmacenLogistica } | null = null

/** Punto único para elegir la implementación. Hoy es local; mañana, Supabase. */
export function obtenerAlmacen(ambito: string): AlmacenLogistica {
  if (actual?.ambito !== ambito) actual = { ambito, almacen: crearAlmacenLocal(ambito) }
  return actual.almacen
}
