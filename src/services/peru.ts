import {
  isValidDni,
  isValidRuc,
  normalizeDni,
  normalizeRuc,
  type PeruDocumentKind,
  type PeruLookupResult,
} from '../../supabase/functions/_shared/peruLookup.ts'

export type DocType = PeruDocumentKind
export type { PeruLookupResult }
export { isValidDni, isValidRuc, normalizeDni, normalizeRuc }

export type PeruLookupModule = 'clientes' | 'proveedores'
type LookupRequest = { tipo_documento: DocType; numero: string; modulo: PeruLookupModule }
type LookupResponse = { data: unknown; error?: unknown | null }
export type LookupInvoker = (body: LookupRequest) => Promise<LookupResponse>

const invokeLookup: LookupInvoker = async (body) => {
  const { requireSupabase } = await import('../lib/supabase')
  return requireSupabase().functions.invoke('peru-document-lookup', { body })
}

function errorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object' || !('context' in error)) return undefined
  const context = (error as { context?: unknown }).context
  if (!context || typeof context !== 'object' || !('status' in context)) return undefined
  const status = (context as { status?: unknown }).status
  return typeof status === 'number' ? status : undefined
}

function translateFunctionError(error: unknown, kind: DocType): Error {
  switch (errorStatus(error)) {
    case 401:
      return new Error('Tu sesión no está autorizada para consultar documentos. Inicia sesión nuevamente.')
    case 403:
      return new Error('No tienes permiso para consultar documentos de este módulo.')
    case 400:
      return new Error('El proveedor rechazó el formato del documento. Revisa el número o complétalo manualmente.')
    case 422:
      return new Error(`El ${kind} no existe en ${kind === 'DNI' ? 'RENIEC' : 'SUNAT'}. Revisa el número.`)
    case 429:
      return new Error('Límite de consultas alcanzado. Espera unos minutos e inténtalo otra vez.')
    case 502:
      return new Error('El servicio de consulta no responde. Inténtalo nuevamente en unos minutos.')
    case 503:
      return new Error('La consulta RENIEC/SUNAT aún no está configurada. Puedes completar los datos manualmente.')
    default:
      return new Error('No se pudo conectar con la consulta segura de documentos. Revisa que Supabase esté disponible e inténtalo otra vez.')
  }
}

function parseResult(data: unknown, kind: DocType, numero: string): PeruLookupResult {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('El servicio de consulta devolvió una respuesta inválida. Inténtalo nuevamente.')
  }
  const value = data as Record<string, unknown>
  if (value.tipoDoc !== kind || value.documento !== numero || typeof value.nombre !== 'string' || !value.nombre.trim() || typeof value.detalle !== 'string') {
    throw new Error('El servicio de consulta devolvió una respuesta inválida. Inténtalo nuevamente.')
  }
  const result: PeruLookupResult = {
    tipoDoc: kind,
    documento: numero,
    nombre: value.nombre.trim(),
    detalle: value.detalle.trim(),
  }
  if (typeof value.direccion === 'string' && value.direccion.trim()) result.direccion = value.direccion.trim()
  return result
}

async function request(kind: DocType, numero: string, modulo: PeruLookupModule, invoke: LookupInvoker): Promise<PeruLookupResult> {
  let response: LookupResponse
  try {
    response = await invoke({ tipo_documento: kind, numero, modulo })
  } catch (error) {
    throw translateFunctionError(error, kind)
  }
  if (response.error) throw translateFunctionError(response.error, kind)
  return parseResult(response.data, kind, numero)
}

/** Consulta un DNI por la Edge Function autenticada y lo deja listo para el formulario. */
export async function lookupDni(dni: string, invoke: LookupInvoker = invokeLookup): Promise<PeruLookupResult> {
  const numero = dni.trim()
  if (!isValidDni(numero)) throw new Error('El DNI debe tener 8 dígitos.')
  return request('DNI', numero, 'clientes', invoke)
}

/** Consulta un RUC por la Edge Function autenticada y devuelve razón social/dirección. */
export async function lookupRuc(ruc: string, modulo: PeruLookupModule = 'clientes', invoke: LookupInvoker = invokeLookup): Promise<PeruLookupResult> {
  const numero = ruc.trim()
  if (!/^\d{11}$/.test(numero)) throw new Error('El RUC debe tener 11 dígitos.')
  if (!isValidRuc(numero)) throw new Error('El RUC no pasa la validación del dígito verificador. Revisa el número.')
  return request('RUC', numero, modulo, invoke)
}
