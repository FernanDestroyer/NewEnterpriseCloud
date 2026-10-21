// -----------------------------------------------------------------------------
// Consulta de documentos peruanos: DNI (RENIEC) y RUC (SUNAT).
// Autocompleta clientes y proveedores para no digitar razón social ni dirección.
//
// Soporta dos formatos de proveedor (se detecta por la URL base):
//   dniruc.apisperu.com: GET {base}/dni/{dni} y GET {base}/ruc/{ruc}
//   apis.net.pe:         GET {base}/dni?numero={dni} y GET {base}/ruc?numero={ruc}
// El token se configura en VITE_PERU_API_TOKEN.
// Sin token, las funciones avisan cómo configurarlo en lugar de fallar raro.
// -----------------------------------------------------------------------------

export type DocType = 'DNI' | 'RUC'

export type PeruLookupResult = {
  tipoDoc: DocType
  documento: string
  /** Razón social o nombres completos, listos para el campo nombre. */
  nombre: string
  /** Dirección / estado / condición, listos para el campo detalle. */
  detalle: string
  /** Dirección fiscal sola (solo RUC), lista para el campo dirección. */
  direccion?: string
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

const DEFAULT_API_URL = 'https://api.apis.net.pe/v1'
const TIMEOUT_MS = 12000

/** Lee variables tanto en el navegador (Vite) como en Node (tests). */
function envValue(name: 'VITE_PERU_API_URL' | 'VITE_PERU_API_TOKEN'): string {
  const fromProcess = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[name]?.trim()
  if (fromProcess) return fromProcess
  return import.meta.env?.[name]?.trim() ?? ''
}

function apiUrl(): string {
  const base = envValue('VITE_PERU_API_URL') || DEFAULT_API_URL
  return base.replace(/\/+$/, '')
}

function apiToken(): string {
  return envValue('VITE_PERU_API_TOKEN')
}

/** true si hay token configurado para consultar RENIEC/SUNAT. */
export function isPeruLookupConfigured(): boolean {
  return apiToken().length > 0
}

/** DNI: exactamente 8 dígitos. */
export function isValidDni(value: string): boolean {
  return /^\d{8}$/.test(value.trim())
}

/** RUC: 11 dígitos con dígito verificador válido (módulo 11 de SUNAT). */
export function isValidRuc(value: string): boolean {
  const digits = value.trim()
  if (!/^\d{11}$/.test(digits)) return false
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
  const sum = weights.reduce((total, weight, index) => total + Number(digits[index]) * weight, 0)
  const check = 11 - (sum % 11)
  const expected = check === 11 ? 1 : check === 10 ? 0 : check
  return expected === Number(digits[10])
}

function joinParts(...parts: Array<string | null | undefined>): string {
  return parts.map((part) => String(part ?? '').trim()).filter(Boolean).join(' ')
}

/** Normaliza respuestas con distintos nombres de campo a un resultado único. */
export function normalizeDni(documento: string, data: Record<string, unknown>): PeruLookupResult {
  const nombre = joinParts(
    data.nombres as string | undefined,
    data.apellidoPaterno as string | undefined,
    data.apellidoMaterno as string | undefined,
  ) || String(data.nombre_completo ?? data.nombreCompleto ?? data.nombre ?? '').trim()
  if (!nombre) throw new Error('La respuesta de RENIEC no trae el nombre. Inténtalo nuevamente.')
  return { tipoDoc: 'DNI', documento, nombre, detalle: 'Persona natural · DNI verificado' }
}

/** Normaliza respuestas con distintos nombres de campo a un resultado único. */
export function normalizeRuc(documento: string, data: Record<string, unknown>): PeruLookupResult {
  const nombre = String(data.razonSocial ?? data.razon_social ?? data.nombre ?? '').trim()
  if (!nombre) throw new Error('La respuesta de SUNAT no trae la razón social. Inténtalo nuevamente.')
  const direccion = String(data.direccion ?? '').trim()
  const extra = joinParts(
    direccion,
    data.estado ? `Estado: ${data.estado}` : '',
    data.condicion ? `Condición: ${data.condicion}` : '',
  )
  const result: PeruLookupResult = { tipoDoc: 'RUC', documento, nombre, detalle: extra || 'Empresa · RUC verificado' }
  if (direccion) result.direccion = direccion
  return result
}

function translateLookupError(status: number, kind: string): Error {
  if (status === 401 || status === 403) {
    return new Error('El token de consulta es inválido. Revisa VITE_PERU_API_TOKEN en tu .env y reinicia el servidor.')
  }
  if (status === 404) {
    return new Error(`El ${kind} no existe en ${kind === 'DNI' ? 'RENIEC' : 'SUNAT'}. Revisa el número.`)
  }
  if (status === 429) {
    return new Error('Límite de consultas alcanzado. Espera unos minutos e inténtalo otra vez.')
  }
  if (status >= 500) {
    return new Error('El servicio de consulta no responde. Inténtalo nuevamente en unos minutos.')
  }
  return new Error(`No se pudo consultar el ${kind} (error ${status}). Inténtalo nuevamente.`)
}

async function request(kind: 'dni' | 'ruc', numero: string, fetchFn: FetchLike): Promise<Record<string, unknown>> {
  const token = apiToken()
  if (!token) {
    throw new Error('Falta configurar la consulta de documentos. Crea tu token gratuito en apis.net.pe, guárdalo en VITE_PERU_API_TOKEN y reinicia el servidor.')
  }
  const label = kind === 'dni' ? 'DNI' : 'RUC'
  const source = kind === 'dni' ? 'RENIEC' : 'SUNAT'
  const base = apiUrl()
  const usePathToken = /apisperu\.com/i.test(base)
  // dniruc.apisperu.com recibe número y token en la URL: su CORS no autoriza
  // la cabecera Authorization y el navegador bloquearía la petición (preflight).
  // Otros proveedores usan query (?numero=) con Bearer.
  const url = usePathToken
    ? `${base}/${kind}/${encodeURIComponent(numero)}?token=${encodeURIComponent(token)}`
    : `${base}/${kind}?numero=${encodeURIComponent(numero)}`
  let response: Response
  try {
    response = await fetchFn(url, {
      headers: { Accept: 'application/json', ...(usePathToken ? {} : { Authorization: `Bearer ${token}` }) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    throw new Error('No se pudo conectar con el servicio de consulta. Revisa tu conexión e inténtalo otra vez.')
  }
  if (!response.ok) throw translateLookupError(response.status, label)
  let body: Record<string, unknown>
  try {
    body = (await response.json()) as Record<string, unknown>
  } catch {
    throw new Error('El servicio de consulta devolvió una respuesta inválida. Inténtalo nuevamente.')
  }
  // Algunos proveedores responden 200 con success:false cuando no hay resultados.
  if (body.success === false) {
    throw new Error(`El ${label} no existe en ${source}. Revisa el número.`)
  }
  return body
}

/** Consulta un DNI en RENIEC y devuelve nombre listo para el formulario. */
export async function lookupDni(dni: string, fetchFn: FetchLike = fetch): Promise<PeruLookupResult> {
  const numero = dni.trim()
  if (!isValidDni(numero)) throw new Error('El DNI debe tener 8 dígitos.')
  return normalizeDni(numero, await request('dni', numero, fetchFn))
}

/** Consulta un RUC en SUNAT y devuelve razón social + dirección listas. */
export async function lookupRuc(ruc: string, fetchFn: FetchLike = fetch): Promise<PeruLookupResult> {
  const numero = ruc.trim()
  if (!/^\d{11}$/.test(numero)) throw new Error('El RUC debe tener 11 dígitos.')
  if (!isValidRuc(numero)) throw new Error('El RUC no pasa la validación del dígito verificador. Revisa el número.')
  return normalizeRuc(numero, await request('ruc', numero, fetchFn))
}
