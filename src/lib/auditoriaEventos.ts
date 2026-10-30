// Registro en la bitácora de las operaciones que la base RECHAZA (permiso denegado) o que FALLAN.
// Los triggers de la base solo guardan lo que se logra escribir; un rechazo no deja rastro por sí solo,
// así que la aplicación lo informa con public.registrar_evento_auditoria (script base, sección 2.4).
// No importa lib/supabase: recibe el cliente por parámetro para poder probarse con un cliente simulado.

export type ResultadoEvento = 'denegado' | 'fallido'
type ClienteRpc = { rpc?: (nombre: string, args: Record<string, unknown>) => PromiseLike<unknown> }
type ErrorBD = { code?: string; message?: string; details?: string } | null | undefined

/** Un 42501 o un rechazo de RLS es «denegado»; cualquier otro error de la base es «fallido». */
export function clasificarFallo(razon: unknown): ResultadoEvento {
  const error = razon as ErrorBD
  const texto = `${error?.message ?? ''} ${error?.details ?? ''}`
  if (error?.code === '42501' || /row-level security|permission denied|no tiene permiso/i.test(texto)) return 'denegado'
  return 'fallido'
}

/**
 * Registra el intento sin interrumpir ni retrasar la operación: si no hay sesión, el RPC no existe
 * o la red falla, se ignora (la bitácora nunca debe romper el flujo del usuario).
 */
export function registrarEventoFallido(cliente: ClienteRpc | null | undefined, accion: string, modulo: string, registro: string | null | undefined, razon: unknown): void {
  try {
    if (!cliente || typeof cliente.rpc !== 'function') return
    const error = razon as ErrorBD
    const resultado = clasificarFallo(razon)
    const detalle = { mensaje: (error?.message ?? 'Sin mensaje').slice(0, 300), ...(error?.code ? { codigo: error.code } : {}) }
    void Promise.resolve(cliente.rpc('registrar_evento_auditoria', {
      p_accion: accion, p_modulo: modulo, p_registro: registro ?? null, p_resultado: resultado, p_detalle: detalle,
    })).catch(() => { /* la bitácora no debe romper la operación */ })
  } catch { /* idem */ }
}
