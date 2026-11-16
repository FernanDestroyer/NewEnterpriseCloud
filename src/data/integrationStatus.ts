export type PeruIntegrationState = 'configured' | 'missing_secret' | 'invalid_configuration' | 'not_deployed' | 'session_required' | 'unavailable'
export type PeruIntegrationProvider = 'apis-net' | null

export type PeruIntegrationStatus = {
  state: PeruIntegrationState
  provider: PeruIntegrationProvider
  verified: false
  checked_at: string
}

const states = new Set<PeruIntegrationState>([
  'configured', 'missing_secret', 'invalid_configuration', 'not_deployed', 'session_required', 'unavailable',
])

export function parsePeruIntegrationStatus(value: unknown): PeruIntegrationStatus | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  if (typeof row.state !== 'string' || !states.has(row.state as PeruIntegrationState)) return null
  if (row.provider !== null && row.provider !== 'apis-net') return null
  if (typeof row.checked_at !== 'string' || !Number.isFinite(Date.parse(row.checked_at))) return null
  return {
    state: row.state as PeruIntegrationState,
    provider: row.provider as PeruIntegrationProvider,
    verified: false,
    checked_at: new Date(row.checked_at).toISOString(),
  }
}

export function integrationErrorState(error: unknown): PeruIntegrationState {
  if (!error || typeof error !== 'object' || !('context' in error)) return 'unavailable'
  const context = (error as { context?: unknown }).context
  if (!context || typeof context !== 'object' || !('status' in context)) return 'unavailable'
  const status = (context as { status?: unknown }).status
  if (status === 404) return 'not_deployed'
  if (status === 401 || status === 403) return 'session_required'
  return 'unavailable'
}

export function integrationStatusLabel(state: PeruIntegrationState): string {
  switch (state) {
    case 'configured': return 'Secreto presente; conexión no verificada'
    case 'missing_secret': return 'Falta configurar el secreto'
    case 'invalid_configuration': return 'Configuración no válida'
    case 'not_deployed': return 'Función aún no desplegada'
    case 'session_required': return 'Sesión no autorizada'
    case 'unavailable': return 'No se pudo comprobar'
  }
}

export function integrationStatusDetail(state: PeruIntegrationState): string {
  switch (state) {
    case 'configured': return 'Supabase encontró una credencial y un proveedor permitido. Esto no valida la clave con RENIEC/SUNAT; una consulta real comprobará el acceso.'
    case 'missing_secret': return 'Configura PERU_API_TOKEN como secreto del servidor. La captura manual de datos continúa disponible.'
    case 'invalid_configuration': return 'El proveedor o la URL no coincide con los destinos HTTPS permitidos.'
    case 'not_deployed': return 'Despliega la Edge Function peru-document-lookup en el proyecto conectado.'
    case 'session_required': return 'Inicia sesión de nuevo y repite la comprobación.'
    case 'unavailable': return 'Comprueba el despliegue y la disponibilidad de Supabase. No se guardaron credenciales.'
  }
}
