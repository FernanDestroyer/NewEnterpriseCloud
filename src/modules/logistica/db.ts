// Conecta la capa de datos de Logística con el cliente real de Supabase.
// La lógica vive en almacenSupabase.ts (recibe el cliente por parámetro y se prueba con uno simulado).
import { supabase } from '../../lib/supabase'
import { verificarAlmacen } from './almacenSupabase.ts'
import type { AlmacenLogistica } from './storage.ts'

export { crearAlmacenSupabase } from './almacenSupabase.ts'

/** Supabase si está configurado y las tablas existen; navegador si no (ver verificarAlmacen). */
export function obtenerAlmacenVerificado(ambito: string): Promise<AlmacenLogistica> {
  return verificarAlmacen(supabase, ambito)
}
