import { isValidDni, isValidRuc, normalizeDni, normalizeRuc } from './peruLookup.ts'

type HandlerDependencies = {
  getEnv: (name: string) => string | undefined
  fetchImpl?: typeof fetch
  corsHeaders: Record<string, string>
}

type LookupModule = 'clientes' | 'proveedores' | 'configuracion'
type PermissionAction = 'ver' | 'editar'

function providerConfig(getEnv: HandlerDependencies['getEnv']): { provider: 'apis-net'; baseUrl: string; token: string } | null {
  const token = getEnv('PERU_API_TOKEN')?.trim()
  const baseUrl = (getEnv('PERU_API_URL')?.trim() || 'https://api.apis.net.pe').replace(/\/+$/, '')
  if (!token) return null

  try {
    const url = new URL(baseUrl)
    if (url.protocol !== 'https:' || url.hostname !== 'api.apis.net.pe' || url.port || url.username || url.password || url.search || url.hash) return null
    if (url.pathname === '/') return { provider: 'apis-net', baseUrl: url.origin, token }
  } catch {
    return null
  }
  return null
}

export function createPeruDocumentLookupHandler({ getEnv, fetchImpl = fetch, corsHeaders }: HandlerDependencies) {
  const responseHeaders = { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' }
  const json = (body: Record<string, unknown>, status = 200): Response =>
    Response.json(body, { status, headers: responseHeaders })

  async function isAuthenticatedUser(request: Request): Promise<boolean> {
    const supabaseUrl = getEnv('SUPABASE_URL')?.replace(/\/+$/, '')
    const authorization = request.headers.get('authorization')
    const apiKey = request.headers.get('apikey')
    if (!supabaseUrl || !authorization?.startsWith('Bearer ') || !apiKey) return false

    try {
      const response = await fetchImpl(`${supabaseUrl}/auth/v1/user`, {
        headers: { Authorization: authorization, apikey: apiKey },
        signal: AbortSignal.timeout(8_000),
      })
      if (!response.ok) return false
      const user = await response.json() as { id?: unknown }
      return typeof user.id === 'string' && user.id.length > 0
    } catch {
      return false
    }
  }

  async function hasPermission(request: Request, module: LookupModule, action: PermissionAction = 'ver'): Promise<boolean> {
    const supabaseUrl = getEnv('SUPABASE_URL')?.replace(/\/+$/, '')
    const authorization = request.headers.get('authorization')
    const apiKey = request.headers.get('apikey')
    if (!supabaseUrl || !authorization || !apiKey) return false

    try {
      const response = await fetchImpl(`${supabaseUrl}/rest/v1/rpc/tiene_permiso`, {
        method: 'POST',
        headers: { Authorization: authorization, apikey: apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_modulo: module, p_accion: action }),
        signal: AbortSignal.timeout(8_000),
      })
      if (!response.ok) return false
      return await response.json() === true
    } catch {
      return false
    }
  }

  const providerFailure = (status: number): Response => {
    if (status === 404) return json({ error: 'Documento no encontrado.' }, 422)
    if (status === 422) return json({ error: 'El proveedor rechazó el formato del documento.' }, 400)
    if (status === 429) return json({ error: 'Límite de consultas alcanzado.' }, 429)
    if (status === 401 || status === 403) return json({ error: 'La consulta documental no está configurada correctamente.' }, 503)
    return json({ error: 'El servicio de consulta no está disponible.' }, 502)
  }

  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') return new Response('ok', { headers: responseHeaders })
    if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405)
    if (!await isAuthenticatedUser(request)) return json({ error: 'Se requiere una sesión autenticada.' }, 401)

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return json({ error: 'La solicitud no contiene JSON válido.' }, 400)
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return json({ error: 'Indica un tipo y número de documento válidos.' }, 400)
    }

    const input = body as { action?: unknown; tipo_documento?: unknown; numero?: unknown }
    if (input.action === 'status') {
      if (!await hasPermission(request, 'configuracion', 'editar')) {
        return json({ error: 'No tienes permiso para comprobar la configuración de esta integración.' }, 403)
      }
      const tokenConfigured = Boolean(getEnv('PERU_API_TOKEN')?.trim())
      const config = providerConfig(getEnv)
      const state = config ? 'configured' : tokenConfigured ? 'invalid_configuration' : 'missing_secret'
      return json({
        state,
        provider: config?.provider ?? null,
        verified: false,
        checked_at: new Date().toISOString(),
      })
    }
    if (input.action !== undefined && input.action !== 'lookup') {
      return json({ error: 'La acción solicitada no está admitida.' }, 400)
    }

    const kind = input.tipo_documento
    const module = (body as { modulo?: unknown }).modulo
    const numero = typeof input.numero === 'string' ? input.numero.trim() : ''
    if ((kind !== 'DNI' && kind !== 'RUC') || (module !== 'clientes' && module !== 'proveedores') || (kind === 'DNI' && module !== 'clientes') || !/^\d+$/.test(numero)) {
      return json({ error: 'Indica un tipo y número de documento válidos.' }, 400)
    }
    if (kind === 'DNI' && !isValidDni(numero)) return json({ error: 'El DNI debe tener 8 dígitos.' }, 400)
    if (kind === 'RUC' && !isValidRuc(numero)) return json({ error: 'El RUC no pasa la validación del dígito verificador.' }, 400)
    if (!await hasPermission(request, module)) return json({ error: 'No tienes permiso para consultar documentos de este módulo.' }, 403)

    const config = providerConfig(getEnv)
    if (!config) return json({ error: 'La consulta RENIEC/SUNAT aún no está configurada.' }, 503)

    const endpoint = kind === 'DNI' ? '/v2/renec/dni' : '/v2/sunat/ruc'
    const target = new URL(endpoint, config.baseUrl)
    target.searchParams.set('numero', numero)

    let providerResponse: Response
    try {
      providerResponse = await fetchImpl(target, {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${config.token}`,
          Referer: kind === 'DNI' ? 'https://apis.net.pe/api-consulta-dni' : 'https://apis.net.pe/api-consulta-ruc',
        },
        signal: AbortSignal.timeout(12_000),
      })
    } catch {
      return json({ error: 'El servicio de consulta no está disponible.' }, 502)
    }
    if (!providerResponse.ok) return providerFailure(providerResponse.status)

    let providerData: Record<string, unknown>
    try {
      const parsed = await providerResponse.json()
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid provider payload')
      providerData = parsed as Record<string, unknown>
    } catch {
      return json({ error: 'El servicio de consulta devolvió una respuesta inválida.' }, 502)
    }
    if (providerData.success === false) return providerFailure(404)

    try {
      const result = kind === 'DNI'
        ? normalizeDni(numero, providerData)
        : normalizeRuc(numero, providerData)
      return json(result as unknown as Record<string, unknown>)
    } catch {
      return json({ error: 'El servicio de consulta no devolvió los datos esperados.' }, 502)
    }
  }
}
