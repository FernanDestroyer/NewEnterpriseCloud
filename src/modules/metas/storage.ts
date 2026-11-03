// Interfaces de la capa de datos de Metas y Objetivos + respaldo local en el navegador.
// La implementación con Supabase vive en db.ts (obtenerAlmacen).
import type { Asignacion, Corte, Meta } from './types.ts'

export interface Coleccion<T extends { id: string }> {
  listar(): Promise<T[]>
  /** Crea o reemplaza por id. */
  guardar(item: T): Promise<T>
  eliminar(id: string): Promise<void>
}

export interface AlmacenMetas {
  metas: Coleccion<Meta>
  asignaciones: Coleccion<Asignacion>
  cortes: Coleccion<Corte>
  /** Dónde viven los datos; la pantalla avisa cuando son locales. */
  readonly origen: 'navegador' | 'base-de-datos'
}

export function nuevoId() {
  const c = globalThis.crypto as Crypto | undefined
  if (c?.randomUUID) return c.randomUUID()
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function crearAlmacenLocal(ambito: string): AlmacenMetas {
  const prefijo = `enterprisecloud:metas:${ambito}`
  adoptarDatosPrevios(prefijo)
  return {
    origen: 'navegador',
    metas: coleccionLocal<Meta>(`${prefijo}:metas`),
    asignaciones: coleccionLocal<Asignacion>(`${prefijo}:asignaciones`),
    cortes: coleccionLocal<Corte>(`${prefijo}:cortes`),
  }
}

/**
 * Los datos locales pueden haber quedado con un ámbito distinto (por ejemplo el id de
 * usuario de una versión anterior). Si la colección está vacía con el ámbito actual,
 * se adopta el contenido de otra colección homónima para no perder registros.
 */
function adoptarDatosPrevios(prefijo: string) {
  const tipos = ['metas', 'asignaciones', 'cortes'] as const
  for (const tipo of tipos) {
    const clave = `${prefijo}:${tipo}`
    try {
      if (leerLocal<unknown>(clave).length) continue
      const encontre = Object.keys(localStorage)
        .filter(k => k.startsWith('enterprisecloud:metas:') && k.endsWith(`:${tipo}`) && k !== clave)
        .map(k => leerLocal<unknown>(k))
        .find(items => items.length)
      if (encontre) escribirLocal(clave, encontre)
    } catch { /* localStorage puede no estar disponible */ }
  }
}

function leerLocal<T>(clave: string): T[] {
  try {
    const raw = localStorage.getItem(clave)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed as T[] : []
  } catch { return [] }
}

function escribirLocal(clave: string, items: unknown[]) {
  try { localStorage.setItem(clave, JSON.stringify(items)) } catch { /* modo privado o cuota llena */ }
}

function coleccionLocal<T extends { id: string }>(clave: string): Coleccion<T> {
  return {
    async listar() { return leerLocal<T>(clave) },
    async guardar(item) {
      const items = leerLocal<T>(clave)
      const index = items.findIndex(actual => actual.id === item.id)
      if (index >= 0) items[index] = item
      else items.push(item)
      escribirLocal(clave, items)
      return item
    },
    async eliminar(id) {
      escribirLocal(clave, leerLocal<T>(clave).filter(item => item.id !== id))
    },
  }
}
