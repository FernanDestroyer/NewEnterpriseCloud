export type PeruDocumentKind = 'DNI' | 'RUC'

export type PeruLookupResult = {
  tipoDoc: PeruDocumentKind
  documento: string
  nombre: string
  detalle: string
  direccion?: string
}

export function isValidDni(value: string): boolean {
  return /^\d{8}$/.test(value.trim())
}

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

export function normalizeDni(documento: string, data: Record<string, unknown>): PeruLookupResult {
  const nombre = joinParts(
    data.nombres as string | undefined,
    data.apellidoPaterno as string | undefined,
    data.apellidoMaterno as string | undefined,
  ) || String(data.nombre_completo ?? data.nombreCompleto ?? data.nombre ?? '').trim()
  if (!nombre) throw new Error('La respuesta de RENIEC no trae el nombre. Inténtalo nuevamente.')
  return { tipoDoc: 'DNI', documento, nombre, detalle: 'Persona natural · DNI verificado' }
}

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
