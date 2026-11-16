import JSZip from 'jszip'
import { requireSupabase } from '../lib/supabase'
import type { AnalyzerFile, AnalyzerReport } from '../data/analyzer'
import { renderAnalyzerReport } from '../data/analyzerHtml'
import { friendlyError, isMissingTableError } from './records'
import logoRecorte from '../assets/enterprisecloud-logo-recorte.png'

const MAX_ZIP_BYTES = 60 * 1024 * 1024
const MAX_TEXT_BYTES = 128 * 1024
const MAX_TEXT_FILES = 250
const MAX_REMOTE_FILES = 240
const MAX_REQUEST_FILES = 2_000
const MAX_REQUEST_TEXT_BYTES = 700_000
const MAX_REQUEST_BODY_BYTES = 1_650_000
const SKIP_PATH = /(?:^|\/)(?:\.git|node_modules|\.venv|__pycache__|dist|build|\.next|\.cache|vendor|coverage)(?:\/|$)/i

const TEXT_EXTENSIONS = new Set([
  'astro', 'bash', 'bat', 'c', 'cfg', 'cjs', 'conf', 'cpp', 'cs', 'css', 'csv', 'dart', 'env', 'gradle', 'go', 'h',
  'hcl', 'hpp', 'htm', 'html', 'ini', 'java', 'js', 'json', 'jsonc', 'jsx', 'kt', 'less', 'lock', 'log', 'lua', 'makefile',
  'md', 'mjs', 'perl', 'php', 'pl', 'properties', 'ps1', 'py', 'r', 'rb', 'rs', 'rst', 'sbt', 'scala', 'scss', 'sh',
  'sol', 'sql', 'svelte', 'svg', 'swift', 'tf', 'tfvars', 'toml', 'ts', 'tsx', 'txt', 'vue', 'xml', 'yaml', 'yml',
])

const TEXT_FILE_NAMES = /(?:^|\/)(?:dockerfile[\w.-]*|makefile|procfile|gemfile|codeowners|license|licence|notice|readme[\w.-]*|changelog[\w.-]*|\.env[\w.-]*|\.gitignore|\.dockerignore|\.editorconfig|\.eslintignore|\.prettierignore|\.npmrc|\.nvmrc|\.python-version|\.terraform-version|\.gitattributes)$/i

export class AnalyzerSourceError extends Error {}

export type AnalysisRow = {
  id: string
  nombre: string
  fuente: 'zip' | 'enlace'
  origen: string
  archivos: number
  puntuacion_seguridad: number
  puntuacion_escalabilidad: number
  puntuacion_cloud: number
  hallazgos: unknown[]
  servicios: unknown[]
  detalle: Record<string, unknown>
  creado_por: string | null
  created_at: string
}

const SELECT_HISTORY = 'id, nombre, fuente, origen, archivos, puntuacion_seguridad, puntuacion_escalabilidad, puntuacion_cloud, hallazgos, servicios, detalle, creado_por, created_at'

export const MIGRATION_HINT = 'La base de datos no tiene la estructura del analizador que esta pantalla necesita. Revisa el historial y aplica solo la migración aprobada antes de reintentar.'

export const ANALYSIS_CSV_HEADER = ['Referencia', 'Área', 'Severidad / prioridad', 'Hallazgo o servicio', 'Detalle', 'Recomendación', 'Archivos o señales']

export function analyzerCsvRows(analysis: AnalyzerReport): (string | number)[][] {
  return [
    ...analysis.findings.map(finding => [
      finding.id,
      finding.area,
      finding.severity,
      finding.title,
      finding.detail,
      finding.recommendation,
      finding.files.join(' | '),
    ]),
    ...analysis.awsRecommendations.map(recommendation => [
      recommendation.service,
      'AWS',
      recommendation.priority,
      recommendation.service,
      recommendation.category,
      recommendation.reason,
      recommendation.signals.join(' | '),
    ]),
  ]
}

function looksTextual(path: string): boolean {
  if (TEXT_FILE_NAMES.test(path)) return true
  const dot = path.lastIndexOf('.')
  if (dot < 0) return false
  return TEXT_EXTENSIONS.has(path.slice(dot + 1).toLocaleLowerCase('en'))
}

function normalizeZipName(fileName: string): string {
  return fileName.replace(/\.zip$/i, '')
}

function filePriority(path: string): number {
  const normalized = path.replace(/\\/g, '/').toLowerCase()
  const name = normalized.slice(normalized.lastIndexOf('/') + 1)
  if (/^(package\.json|pyproject\.toml|requirements(?:\.txt)?|go\.mod|cargo\.toml|pom\.xml|build\.gradle(?:\.kts)?|composer\.json|gemfile|mix\.exs)$/.test(name)) return 0
  if (/^(dockerfile|docker-compose(?:\.[\w-]+)?\.ya?ml|compose\.ya?ml|serverless\.ya?ml|template\.ya?ml|samconfig\.toml|terraform\.tf|main\.tf|wrangler\.toml|vercel\.json|netlify\.toml|supabase\.toml)$/.test(name)) return 1
  if (/^(\.env(?:\.[\w-]+)?|\.gitignore|\.dockerignore|\.npmrc|\.nvmrc|readme(?:\.[\w-]+)?|makefile|procfile)$/.test(name)) return 2
  if (/(^|\/)(\.github\/workflows|\.gitlab-ci|infra|infrastructure|terraform|deploy|deployment|migrations?)(\/|$)/.test(normalized)) return 3
  if (/(^|\/)(src|app|api|functions|supabase|backend|server|tests?)(\/|$)/.test(normalized)) return 4
  if (/\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|cs|php|sql|tf|ya?ml|toml|json|xml|sh|ps1)$/.test(name)) return 5
  if (/\.(?:md|rst|txt)$/.test(name)) return 7
  return 6
}

function rankFiles<T extends { path: string }>(files: T[]): T[] {
  return files.map((file, index) => ({ file, index, priority: filePriority(file.path) }))
    .sort((a, b) => a.priority - b.priority || a.index - b.index)
    .map(item => item.file)
}

type AnalysisCoverageInput = { filesAvailable: number; bytesAvailable: number; textFilesAvailable: number; inventoryComplete: boolean; bytesTotalKnown: boolean }

function encodedSize(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isAnalyzerReport(value: unknown, kind: 'zip' | 'enlace'): value is AnalyzerReport {
  if (!isRecord(value) || value.analysisVersion !== 1 || typeof value.name !== 'string' || typeof value.generatedAt !== 'string') return false
  if (!isRecord(value.source) || value.source.kind !== kind || typeof value.source.origin !== 'string') return false
  if (!isRecord(value.stats) || !Number.isSafeInteger(value.stats.files) || (value.stats.files as number) < 0 || !Number.isSafeInteger(value.stats.bytes) || (value.stats.bytes as number) < 0) return false
  if (!Array.isArray(value.stats.languages) || !value.stats.languages.every(item => typeof item === 'string')) return false
  if (!Array.isArray(value.stack) || !value.stack.every(item => typeof item === 'string')) return false
  const scores = value.scores
  if (!isRecord(scores) || !['security', 'scalability', 'cloudReadiness', 'total'].every(key => Number.isInteger(scores[key]) && (scores[key] as number) >= 0 && (scores[key] as number) <= 100)) return false
  if (!Array.isArray(value.findings) || !value.findings.every(item => isRecord(item) && typeof item.id === 'string' && typeof item.title === 'string' && typeof item.detail === 'string' && typeof item.recommendation === 'string' && Array.isArray(item.files) && item.files.every(file => typeof file === 'string'))) return false
  if (!Array.isArray(value.awsRecommendations) || !value.awsRecommendations.every(item => isRecord(item) && typeof item.service === 'string' && typeof item.category === 'string' && typeof item.reason === 'string' && Array.isArray(item.signals) && item.signals.every(signal => typeof signal === 'string'))) return false
  if (value.coverage !== undefined) {
    const coverage = value.coverage
    if (!isRecord(coverage) || !['filesAvailable', 'filesSent', 'textFilesAvailable', 'textFilesSent'].every(key => Number.isSafeInteger(coverage[key]) && (coverage[key] as number) >= 0) || typeof coverage.bytesTotalKnown !== 'boolean') return false
  }
  return true
}

async function submitAnalysisToApi(
  name: string,
  kind: 'zip' | 'enlace',
  origin: string,
  sourceFiles: AnalyzerFile[],
  coverage: AnalysisCoverageInput,
  onStep?: (message: string) => void,
): Promise<AnalyzerReport> {
  const ordered = rankFiles(sourceFiles).slice(0, MAX_REQUEST_FILES)
  let remainingTextBytes = MAX_REQUEST_TEXT_BYTES
  let files = ordered.map(file => {
    if (typeof file.text !== 'string') return { path: file.path.slice(0, 400), bytes: file.bytes }
    const textBytes = new TextEncoder().encode(file.text).byteLength
    if (textBytes > MAX_TEXT_BYTES || textBytes > remainingTextBytes) return { path: file.path.slice(0, 400), bytes: file.bytes }
    remainingTextBytes -= textBytes
    return { path: file.path.slice(0, 400), bytes: file.bytes, text: file.text }
  })
  const request = () => ({
    name: name.slice(0, 120),
    kind,
    origin: origin.slice(0, 1000),
    coverage,
    files,
  })
  let requestBytes = encodedSize(request())
  while (requestBytes > MAX_REQUEST_BODY_BYTES) {
    let lastText = -1
    for (let index = files.length - 1; index >= 0; index -= 1) {
      if (typeof files[index].text === 'string') {
        lastText = index
        break
      }
    }
    if (lastText >= 0) {
      const previous = files[lastText]
      const { path, bytes } = previous
      files[lastText] = { path, bytes }
      requestBytes -= encodedSize(previous) - encodedSize(files[lastText])
    } else if (files.length > 0) {
      const removed = files[files.length - 1]
      files = files.slice(0, -1)
      requestBytes -= encodedSize(removed) + (files.length > 0 ? 1 : 0)
    } else {
      throw new AnalyzerSourceError('El inventario del proyecto supera el tamaño permitido. Comparte un ZIP más pequeño o un subconjunto del repositorio.')
    }
  }

  onStep?.('Enviando los archivos seleccionados a la API segura de Supabase…')
  const { data, error } = await requireSupabase().functions.invoke<AnalyzerReport>('project-analyzer', { body: request() })
  if (error) {
    const context = (error as { context?: unknown }).context
    if (context instanceof Response) {
      try {
        const detail = await context.clone().json() as { error?: unknown }
        if (typeof detail.error === 'string') throw new AnalyzerSourceError(detail.error)
      } catch (cause) {
        if (cause instanceof AnalyzerSourceError) throw cause
      }
    }
    throw new AnalyzerSourceError('La API de análisis no respondió correctamente. Comprueba tu sesión y vuelve a intentarlo.')
  }
  if (!isAnalyzerReport(data, kind)) {
    throw new AnalyzerSourceError('La API devolvió un informe incompleto. Vuelve a intentarlo; no se guardó el código fuente.')
  }
  return data
}

function addInventoryCounts<T extends { size?: number }>(items: T[]): number {
  let total = 0
  for (const item of items) {
    const size = item.size ?? 0
    if (Number.isSafeInteger(size) && size > 0) total += size
    if (!Number.isSafeInteger(total)) return Number.MAX_SAFE_INTEGER
  }
  return total
}

async function mapWithLimit<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = []
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await worker(items[index])
    }
  })
  await Promise.all(runners)
  return results
}

async function fetchText(url: string, timeoutMs = 15000, notFoundMessage?: string, maxBytes?: number): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) {
      if (response.status === 404) throw new AnalyzerSourceError(notFoundMessage ?? 'No se encontró el archivo o recurso solicitado en el repositorio.')
      if (response.status === 401 || response.status === 403) throw new AnalyzerSourceError('El repositorio exige autenticación o se agotó el límite de consultas; inténtalo en unos minutos.')
      if (response.status === 429) throw new AnalyzerSourceError('Se alcanzó el límite de consultas del proveedor; espera unos minutos e inténtalo otra vez.')
      throw new AnalyzerSourceError(`El repositorio respondió HTTP ${response.status}.`)
    }
    if (maxBytes !== undefined) {
      const declaredSize = Number(response.headers.get('content-length') ?? 0)
      if (Number.isFinite(declaredSize) && declaredSize > maxBytes) {
        await response.body?.cancel()
        throw new AnalyzerSourceError(`Se omitió un archivo de texto que supera ${Math.round(maxBytes / 1024)} KB.`)
      }
      if (!response.body) return ''
      const reader = response.body.getReader()
      const chunks: Uint8Array[] = []
      let size = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > maxBytes) {
          await reader.cancel()
          throw new AnalyzerSourceError(`Se omitió un archivo de texto que supera ${Math.round(maxBytes / 1024)} KB.`)
        }
        chunks.push(value)
      }
      const bytes = new Uint8Array(size)
      let offset = 0
      for (const chunk of chunks) {
        bytes.set(chunk, offset)
        offset += chunk.byteLength
      }
      return new TextDecoder().decode(bytes)
    }
    return await response.text()
  } catch (error) {
    if (error instanceof AnalyzerSourceError) throw error
    if ((error as Error).name === 'AbortError') throw new AnalyzerSourceError('La lectura del repositorio superó el tiempo de espera. Revisa tu conexión e inténtalo otra vez.')
    throw new AnalyzerSourceError('No se pudo conectar con el repositorio. Revisa tu conexión o inténtalo con otro enlace.')
  } finally {
    clearTimeout(timer)
  }
}

async function readGitRepository(url: string): Promise<{ files: AnalyzerFile[]; coverage: AnalysisCoverageInput }> {
  const parsed = new URL(url)
  const isGitHub = /(?:^|\.)github\.com$/i.test(parsed.hostname)
  const isGitLab = /(?:^|\.)gitlab\.com$/i.test(parsed.hostname)
  if (!isGitHub && !isGitLab) {
    throw new AnalyzerSourceError('Por ahora se analizan repositorios públicos de GitHub (github.com/usuario/repo) o GitLab (gitlab.com/usuario/repo). Descarga el ZIP y súbelo para otros orígenes.')
  }
  const segments = parsed.pathname.split('/').filter(Boolean).map(segment => decodeURIComponent(segment))
  if (segments.length < 2) throw new AnalyzerSourceError('Enlace incompleto: usa el formato github.com/usuario/repo o gitlab.com/usuario/repo.')

  let branch = ''
  if (isGitHub) {
    let [owner, repo, ...rest] = segments
    repo = repo.replace(/\.git$/i, '')
    const treeIndex = rest.findIndex((segment, index) => segment === 'tree' && rest[index + 1])
    if (treeIndex >= 0) branch = rest[treeIndex + 1]
    const info = await fetchJson(
      `https://api.github.com/repos/${owner}/${repo}`,
      'GitHub no permite ver este repositorio. Comprueba el propietario y el nombre, y confirma que sea público; los repositorios privados requieren iniciar sesión en GitHub.',
    )
    branch = branch || String(info.default_branch ?? 'main')
    const tree = await fetchJson(
      `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
      `GitHub no encontró la rama «${branch}» en este repositorio. Abre el enlace sin /tree/... para usar la rama predeterminada, o verifica el nombre de la rama.`,
    )
    const inventory = (Array.isArray(tree.tree) ? tree.tree : [])
      .filter((entry): entry is { path: string; type: string; size?: number } => Boolean(entry && typeof entry === 'object' && typeof (entry as { path?: unknown }).path === 'string'))
      .filter(entry => entry.type === 'blob' && !SKIP_PATH.test(entry.path))
    const textInventory = inventory.filter(entry => looksTextual(entry.path))
    const entries = rankFiles(textInventory.filter(entry => Number.isSafeInteger(entry.size) && (entry.size ?? 0) <= MAX_TEXT_BYTES))
      .slice(0, MAX_REMOTE_FILES)
    const contents = await mapWithLimit(entries, 8, async entry => ({
      entry,
      text: await fetchText(
        `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${entry.path.split('/').map(encodeURIComponent).join('/')}`,
        15000,
        `GitHub listó «${entry.path}» en la rama «${branch}», pero no permitió descargarlo. Intenta con el ZIP del repositorio.`,
        MAX_TEXT_BYTES,
      ),
    }))
    const files = contents.map(({ entry, text }) => ({ path: entry.path.slice(0, 400), bytes: entry.size ?? text.length, text }))
    return {
      files,
      coverage: {
        filesAvailable: inventory.length,
        bytesAvailable: Math.max(addInventoryCounts(inventory), addInventoryCounts(entries)),
        textFilesAvailable: textInventory.length,
        inventoryComplete: tree.truncated !== true,
        bytesTotalKnown: inventory.every(entry => Number.isSafeInteger(entry.size)),
      },
    }
  } else {
    let path = segments.join('/')
    const lastSegments = path.split('/')
    const treeIndex = lastSegments.indexOf('tree')
    if (treeIndex >= 0 && lastSegments[treeIndex + 1]) {
      branch = lastSegments.splice(treeIndex, 2)[1]!
      path = lastSegments.join('/')
    }
    path = path.replace(/\.git$/i, '').replace(/\/-\/.*$/, '')
    if (path.split('/').length < 2) throw new AnalyzerSourceError('Enlace incompleto: usa el formato gitlab.com/usuario/repo.')
    const info = await fetchJson(`https://gitlab.com/api/v4/projects/${encodeURIComponent(path)}`)
    branch = branch || String(info.default_branch ?? 'main')
    let page = 1
    const entries: Array<{ path: string; type: string; size?: number }> = []
    let inventoryComplete = true
    while (page <= 6) {
      const response = await fetch(`https://gitlab.com/api/v4/projects/${info.id}/repository/tree?recursive=true&per_page=100&page=${page}&ref=${encodeURIComponent(branch)}`)
      if (!response.ok) throw new AnalyzerSourceError(`GitLab respondió HTTP ${response.status} al listar el árbol.`)
      const batch: Array<{ path: string; type: string; size?: number }> = await response.json()
      entries.push(...batch)
      if (!response.headers.get('X-Next-Page')) break
      if (page === 6) inventoryComplete = false
      page += 1
    }
    const inventory = entries.filter(entry => entry.type === 'blob' && !SKIP_PATH.test(entry.path))
    const textInventory = inventory.filter(entry => looksTextual(entry.path))
    const selected = rankFiles(textInventory).slice(0, MAX_REMOTE_FILES)
    const contents = await mapWithLimit(selected, 8, async entry => {
      try {
        return {
          entry,
          text: await fetchText(`https://gitlab.com/${path}/-/raw/${encodeURIComponent(branch)}/${entry.path.split('/').map(encodeURIComponent).join('/')}`, 15000, undefined, MAX_TEXT_BYTES),
        }
      } catch (cause) {
        if (cause instanceof AnalyzerSourceError && cause.message.includes('Se omitió un archivo')) return null
        throw cause
      }
    })
    const files = contents.filter((item): item is { entry: typeof selected[number]; text: string } => item !== null)
      .map(({ entry, text }) => ({ path: entry.path.slice(0, 400), bytes: entry.size ?? new TextEncoder().encode(text).byteLength, text }))
    return {
      files,
      coverage: {
        filesAvailable: inventory.length,
        bytesAvailable: Math.max(addInventoryCounts(inventory), addInventoryCounts(selected)),
        textFilesAvailable: textInventory.length,
        inventoryComplete,
        bytesTotalKnown: inventory.every(entry => Number.isSafeInteger(entry.size)),
      },
    }
  }
}

async function fetchJson(url: string, notFoundMessage?: string): Promise<Record<string, unknown>> {
  const text = await fetchText(url, 15000, notFoundMessage)
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new AnalyzerSourceError('La respuesta del proveedor no es válida; inténtalo otra vez más tarde.')
  }
}

export async function analyzeZipArchive(file: File, options: { onStep?: (message: string) => void } = {}): Promise<AnalyzerReport> {
  if (file.size > MAX_ZIP_BYTES) throw new AnalyzerSourceError(`El ZIP pesa ${Math.round(file.size / 1048576)} MB; el límite del analizador es ${Math.round(MAX_ZIP_BYTES / 1048576)} MB.`)
  options.onStep?.('Leyendo el paquete ZIP…')
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(await file.arrayBuffer())
  } catch {
    throw new AnalyzerSourceError('No se pudo abrir el ZIP: puede estar dañado o protegido con contraseña.')
  }
  const rawSize = (entry: unknown) => (entry as { _data?: { uncompressedSize?: number } } | null)?._data?.uncompressedSize ?? 0
  const inventory = Object.values(zip.files).filter(entry => !entry.dir && !SKIP_PATH.test(entry.name))
  const entries = rankFiles(inventory.map(entry => ({ path: entry.name, entry })))
    .slice(0, MAX_REQUEST_FILES)
    .map(item => item.entry)
  const textInventory = inventory.filter(entry => looksTextual(entry.name))
  let textBudget = MAX_REQUEST_TEXT_BYTES
  let selectedTextCount = 0
  const textEntries = rankFiles(inventory
    .filter(entry => looksTextual(entry.name) && rawSize(entry) > 0 && rawSize(entry) <= MAX_TEXT_BYTES)
    .map(entry => ({ path: entry.name, entry })))
    .filter(({ entry }) => {
      const size = rawSize(entry)
      if (selectedTextCount >= MAX_TEXT_FILES || size > textBudget) return false
      textBudget -= size
      selectedTextCount += 1
      return true
    })
    .map(item => item.entry)
  const contents = await mapWithLimit(textEntries, 12, async entry => {
    let text: string | undefined
    try {
      text = await entry.async('string')
    } catch {
      text = undefined
    }
    return { name: entry.name, path: entry.name.slice(0, 400), bytes: rawSize(entry) || text?.length || 0, text }
  })
  const byPath = new Map(contents.map(item => [item.name, item]))
  const files: AnalyzerFile[] = entries.map(entry => {
    const read = byPath.get(entry.name)
    if (read) return { path: read.path, bytes: read.bytes, text: read.text }
    return { path: entry.name.slice(0, 400), bytes: rawSize(entry) }
  })
  options.onStep?.(`Preparando ${files.length} de ${inventory.length} archivos para el análisis…`)
  return submitAnalysisToApi(normalizeZipName(file.name), 'zip', file.name, files, {
    filesAvailable: inventory.length,
    bytesAvailable: addInventoryCounts(inventory.map(entry => ({ size: rawSize(entry) }))),
    textFilesAvailable: textInventory.length,
    inventoryComplete: true,
    bytesTotalKnown: true,
  }, options.onStep)
}

export async function analyzeRepositoryLink(url: string, options: { onStep?: (message: string) => void } = {}): Promise<AnalyzerReport> {
  const trimmed = url.trim()
  if (!trimmed) throw new AnalyzerSourceError('Escribe el enlace del repositorio (por ejemplo, https://github.com/usuario/repo).')
  const normalized = /^https?:\/\//i.test(trimmed) || /^[^/]+\.[^/]+\/.+/.test(trimmed) ? (trimmed.startsWith('http') ? trimmed : `https://${trimmed}`) : ''
  if (!normalized) throw new AnalyzerSourceError('Enlace no reconocido. Usa https://github.com/usuario/repo o gitlab.com/usuario/repo.')
  options.onStep?.('Consultando el repositorio…')
  const repository = await readGitRepository(normalized)
  options.onStep?.(`Preparando ${repository.files.length} archivos del repositorio…`)
  const last = unifiedLastSegment(normalized.split('?')[0].split('#')[0])
  return submitAnalysisToApi(last, 'enlace', normalized, repository.files, repository.coverage, options.onStep)
}

function unifiedLastSegment(url: string): string {
  const parts = url.replace(/\/+$/, '').split('/')
  const name = parts[parts.length - 1] ?? 'proyecto'
  return decodeURIComponent(name) || 'proyecto'
}

export async function fetchAnalysisHistory(limit = 12): Promise<AnalysisRow[]> {
  const result = await requireSupabase()
    .from('analisis_proyectos')
    .select(SELECT_HISTORY)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (result.error) {
    if (isMissingTableError(result.error)) throw new Error(MIGRATION_HINT)
    throw new Error(friendlyError(result.error))
  }
  return result.data as AnalysisRow[]
}

export async function saveAnalysisReport(analysis: AnalyzerReport, createdBy: string | null): Promise<AnalysisRow> {
  const result = await requireSupabase()
    .from('analisis_proyectos')
    .insert({
      nombre: analysis.name,
      fuente: analysis.source.kind,
      origen: analysis.source.origin,
      archivos: analysis.stats.files,
      puntuacion_seguridad: analysis.scores.security,
      puntuacion_escalabilidad: analysis.scores.scalability,
      puntuacion_cloud: analysis.scores.cloudReadiness,
      hallazgos: analysis.findings,
      servicios: analysis.awsRecommendations,
      detalle: { total: analysis.scores.total, stack: analysis.stack, idiomas: analysis.stats.languages, tamano: analysis.stats.bytes, versionMotor: analysis.analysisVersion, versionAnalisis: analysis.recommendationsVersion ?? 2, cobertura: analysis.coverage },
      creado_por: createdBy,
      created_at: analysis.generatedAt,
    })
    .select(SELECT_HISTORY)
    .single()
  if (result.error) {
    if (isMissingTableError(result.error)) throw new Error(MIGRATION_HINT)
    throw new Error(friendlyError(result.error))
  }
  return result.data as AnalysisRow
}

export async function deleteAnalysisById(id: string): Promise<void> {
  const result = await requireSupabase()
    .from('analisis_proyectos')
    .delete()
    .eq('id', id)
  if (result.error) {
    if (isMissingTableError(result.error)) throw new Error(MIGRATION_HINT)
    throw new Error(friendlyError(result.error))
  }
}

let cachedAnalyzerLogo: string | null = null

async function analyzerLogoUrl(): Promise<string | null> {
  if (cachedAnalyzerLogo) return cachedAnalyzerLogo
  try {
    const response = await fetch(logoRecorte)
    if (!response.ok) throw new Error('logo no disponible')
    const blob = await response.blob()
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error ?? new Error('logo no disponible'))
      reader.readAsDataURL(blob)
    })
    cachedAnalyzerLogo = dataUrl
    return dataUrl
  } catch {
    return new URL(logoRecorte, window.location.href).href
  }
}

export async function exportAnalyzerReport(analysis: AnalyzerReport): Promise<void> {
  const popup = window.open('', '_blank')
  if (!popup) throw new Error('El navegador bloqueó la ventana del informe. Habilita las ventanas emergentes y vuelve a intentarlo.')
  const logoUrl = await analyzerLogoUrl()
  popup.document.write(renderAnalyzerReport(analysis, logoUrl))
  popup.document.close()
}
