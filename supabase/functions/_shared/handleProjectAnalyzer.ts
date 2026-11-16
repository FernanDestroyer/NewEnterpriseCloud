import { buildAnalysisFromFiles, type AnalyzerFile, type AnalyzerSourceKind } from './analyzerCore.ts'

type Dependencies = {
  getEnv: (name: string) => string | undefined
  fetchImpl?: typeof fetch
  corsHeaders: Record<string, string>
}

type ProjectInput = {
  name: string
  kind: AnalyzerSourceKind
  origin: string
  files: AnalyzerFile[]
  coverage: {
    filesAvailable: number
    bytesAvailable: number
    textFilesAvailable: number
    inventoryComplete?: boolean
    bytesTotalKnown: boolean
  }
}

const MAX_BODY_BYTES = 1_800_000
const MAX_FILE_COUNT = 2_500
const MAX_TEXT_FILE_BYTES = 131_072
const MAX_TOTAL_TEXT_BYTES = 800_000

function normalizeInput(value: unknown): ProjectInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  if (input.kind !== 'zip' && input.kind !== 'enlace') return null
  if (typeof input.name !== 'string' || typeof input.origin !== 'string' || !Array.isArray(input.files)) return null
  if (!input.coverage || typeof input.coverage !== 'object' || Array.isArray(input.coverage)) return null
  const coverage = input.coverage as Record<string, unknown>
  if (input.name.length < 1 || input.name.length > 120 || input.origin.length > 1000 || input.files.length > MAX_FILE_COUNT) return null
  if (!Number.isSafeInteger(coverage.filesAvailable) || (coverage.filesAvailable as number) < input.files.length) return null
  if (!Number.isSafeInteger(coverage.bytesAvailable) || (coverage.bytesAvailable as number) < 0) return null
  if (!Number.isSafeInteger(coverage.textFilesAvailable) || (coverage.textFilesAvailable as number) < 0 || (coverage.textFilesAvailable as number) > (coverage.filesAvailable as number)) return null
  if (coverage.inventoryComplete !== undefined && typeof coverage.inventoryComplete !== 'boolean') return null
  if (typeof coverage.bytesTotalKnown !== 'boolean') return null

  let totalTextBytes = 0
  let includedTextFiles = 0
  let totalIncludedBytes = 0
  const files: AnalyzerFile[] = []
  for (const item of input.files) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null
    const file = item as Record<string, unknown>
    if (typeof file.path !== 'string' || file.path.length < 1 || file.path.length > 400) return null
    const path = file.path.replace(/\\/g, '/').replace(/^\.\//, '')
    if (path.startsWith('/') || path.split('/').some(segment => segment === '..')) return null
    if (typeof file.bytes !== 'number' || !Number.isSafeInteger(file.bytes) || file.bytes < 0) return null
    totalIncludedBytes += file.bytes
    if (!Number.isSafeInteger(totalIncludedBytes)) return null
    if (file.text !== undefined && typeof file.text !== 'string') return null
    if (typeof file.text === 'string') {
      const textBytes = new TextEncoder().encode(file.text).byteLength
      if (textBytes > MAX_TEXT_FILE_BYTES) return null
      totalTextBytes += textBytes
      if (totalTextBytes > MAX_TOTAL_TEXT_BYTES) return null
      includedTextFiles += 1
      files.push({ path, bytes: file.bytes, text: file.text })
    } else {
      files.push({ path, bytes: file.bytes })
    }
  }
  if (includedTextFiles > (coverage.textFilesAvailable as number) || (coverage.bytesTotalKnown && totalIncludedBytes > (coverage.bytesAvailable as number))) return null
  const clean = (text: string) => text.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
  return {
    name: clean(input.name as string).slice(0, 120),
    kind: input.kind,
    origin: clean(input.origin).slice(0, 1000),
    files,
    coverage: {
      filesAvailable: coverage.filesAvailable as number,
      bytesAvailable: coverage.bytesAvailable as number,
      textFilesAvailable: coverage.textFilesAvailable as number,
      inventoryComplete: coverage.inventoryComplete as boolean | undefined,
      bytesTotalKnown: coverage.bytesTotalKnown as boolean,
    },
  }
}

async function readLimitedBody(request: Request): Promise<{ value?: unknown; tooLarge?: boolean }> {
  const declared = Number(request.headers.get('content-length') ?? 0)
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return { tooLarge: true }
  if (!request.body) return {}
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_BODY_BYTES) {
        await reader.cancel()
        return { tooLarge: true }
      }
      chunks.push(value)
    }
  } catch {
    return {}
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return { value: JSON.parse(new TextDecoder().decode(bytes)) as unknown }
  } catch {
    return {}
  }
}

export function createProjectAnalyzerHandler({ getEnv, fetchImpl = fetch, corsHeaders }: Dependencies) {
  const responseHeaders = { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' }
  const json = (body: Record<string, unknown>, status = 200) => Response.json(body, { status, headers: responseHeaders })

  async function hasPermission(request: Request): Promise<boolean> {
    const baseUrl = getEnv('SUPABASE_URL')?.replace(/\/+$/, '')
    const authorization = request.headers.get('authorization')
    const apiKey = request.headers.get('apikey')
    if (!baseUrl || !authorization?.startsWith('Bearer ') || !apiKey) return false
    try {
      const userResponse = await fetchImpl(`${baseUrl}/auth/v1/user`, {
        headers: { Authorization: authorization, apikey: apiKey },
        signal: AbortSignal.timeout(8_000),
      })
      if (!userResponse.ok) return false
      const user = await userResponse.json() as { id?: unknown }
      if (typeof user.id !== 'string' || !user.id) return false

      const permissionResponse = await fetchImpl(`${baseUrl}/rest/v1/rpc/tiene_permiso`, {
        method: 'POST',
        headers: { Authorization: authorization, apikey: apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_modulo: 'analizador', p_accion: 'ver' }),
        signal: AbortSignal.timeout(8_000),
      })
      return permissionResponse.ok && await permissionResponse.json() === true
    } catch {
      return false
    }
  }

  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') return new Response('ok', { headers: responseHeaders })
    if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405)
    if (!await hasPermission(request)) return json({ error: 'Se requiere una sesión con permiso para usar el Analizador.' }, 403)

    const parsed = await readLimitedBody(request)
    if (parsed.tooLarge) return json({ error: 'La solicitud supera el límite de 1.8 MB. Reduce el tamaño del proyecto o prueba con un intervalo menor de archivos.' }, 413)
    const input = normalizeInput(parsed.value)
    if (!input) return json({ error: 'El origen o la lista de archivos no cumple los límites de análisis.' }, 400)

    try {
      const report = buildAnalysisFromFiles(input.name, input.kind, input.origin, input.files)
      report.coverage = {
        filesAvailable: input.coverage.filesAvailable,
        filesSent: input.files.length,
        textFilesAvailable: input.coverage.textFilesAvailable,
        textFilesSent: input.files.filter(file => typeof file.text === 'string').length,
        inventoryComplete: input.coverage.inventoryComplete,
        bytesTotalKnown: input.coverage.bytesTotalKnown,
      }
      report.stats.files = input.coverage.filesAvailable
      if (input.coverage.bytesTotalKnown) report.stats.bytes = input.coverage.bytesAvailable
      return json(report as unknown as Record<string, unknown>)
    } catch {
      return json({ error: 'No se pudo completar el análisis. Vuelve a intentarlo con un paquete más pequeño.' }, 500)
    }
  }
}
