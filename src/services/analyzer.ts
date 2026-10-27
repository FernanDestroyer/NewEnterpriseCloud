import JSZip from 'jszip'
import { requireSupabase } from '../lib/supabase'
import { buildAnalysisFromFiles, type AnalyzerFile, type AnalyzerReport } from '../data/analyzer'
import { renderAnalyzerReport } from '../data/analyzerHtml'
import { friendlyError, isMissingTableError } from './records'
import logoRecorte from '../assets/enterprisecloud-logo-recorte.png'

const MAX_ZIP_BYTES = 60 * 1024 * 1024
const MAX_TEXT_BYTES = 512 * 1024
const MAX_TEXT_FILES = 600
const MAX_REMOTE_FILES = 320
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

async function fetchText(url: string, timeoutMs = 15000, notFoundMessage?: string): Promise<string> {
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
    return await response.text()
  } catch (error) {
    if (error instanceof AnalyzerSourceError) throw error
    if ((error as Error).name === 'AbortError') throw new AnalyzerSourceError('La lectura del repositorio superó el tiempo de espera. Revisa tu conexión e inténtalo otra vez.')
    throw new AnalyzerSourceError('No se pudo conectar con el repositorio. Revisa tu conexión o inténtalo con otro enlace.')
  } finally {
    clearTimeout(timer)
  }
}

async function readGitRepository(url: string): Promise<AnalyzerFile[]> {
  const parsed = new URL(url)
  const isGitHub = /(?:^|\.)github\.com$/i.test(parsed.hostname)
  const isGitLab = /(?:^|\.)gitlab\.com$/i.test(parsed.hostname)
  if (!isGitHub && !isGitLab) {
    throw new AnalyzerSourceError('Por ahora se analizan repositorios públicos de GitHub (github.com/usuario/repo) o GitLab (gitlab.com/usuario/repo). Descarga el ZIP y súbelo para otros orígenes.')
  }
  const segments = parsed.pathname.split('/').filter(Boolean).map(segment => decodeURIComponent(segment))
  if (segments.length < 2) throw new AnalyzerSourceError('Enlace incompleto: usa el formato github.com/usuario/repo o gitlab.com/usuario/repo.')

  const files: AnalyzerFile[] = []
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
    const entries: Array<{ path: string; size?: number }> = (Array.isArray(tree.tree) ? tree.tree : [])
      .filter(entry => entry.type === 'blob' && !SKIP_PATH.test(entry.path) && looksTextual(entry.path) && (entry.size ?? 0) <= MAX_TEXT_BYTES)
      .slice(0, MAX_REMOTE_FILES)
    const contents = await mapWithLimit(entries, 8, async entry => ({
      entry,
      text: await fetchText(
        `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${entry.path.split('/').map(encodeURIComponent).join('/')}`,
        15000,
        `GitHub listó «${entry.path}» en la rama «${branch}», pero no permitió descargarlo. Intenta con el ZIP del repositorio.`,
      ),
    }))
    for (const { entry, text } of contents) files.push({ path: entry.path.slice(0, 400), bytes: entry.size ?? text.length, text })
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
    const entries: Array<{ path: string; type: string }> = []
    while (page <= 6) {
      const response = await fetch(`https://gitlab.com/api/v4/projects/${info.id}/repository/tree?recursive=true&per_page=100&page=${page}&ref=${encodeURIComponent(branch)}`)
      if (!response.ok) throw new AnalyzerSourceError(`GitLab respondió HTTP ${response.status} al listar el árbol.`)
      const batch: Array<{ path: string; type: string }> = await response.json()
      entries.push(...batch)
      if (!response.headers.get('X-Next-Page')) break
      page += 1
    }
    const selected = entries
      .filter(entry => entry.type === 'blob' && !SKIP_PATH.test(entry.path) && looksTextual(entry.path))
      .slice(0, MAX_REMOTE_FILES)
    const contents = await mapWithLimit(selected, 8, async entry => ({
      entry,
      text: await fetchText(`https://gitlab.com/${path}/-/raw/${encodeURIComponent(branch)}/${entry.path.split('/').map(encodeURIComponent).join('/')}`),
    }))
    for (const { entry, text } of contents) files.push({ path: entry.path.slice(0, 400), bytes: text.length, text })
    return files
  }
  return files
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
  const entries = Object.values(zip.files)
    .filter(entry => !entry.dir && !SKIP_PATH.test(entry.name))
    .slice(0, 8000)
  options.onStep?.(`Leyendo ${entries.length} archivos del paquete…`)
  const textEntries = entries
    .filter(entry => looksTextual(entry.name) && rawSize(entry) > 0)
    .slice(0, MAX_TEXT_FILES)
  const contents = await mapWithLimit(textEntries, 12, async entry => {
    let text: string | undefined
    try {
      text = (await entry.async('string')).slice(0, MAX_TEXT_BYTES)
    } catch {
      text = undefined
    }
    return { path: entry.name.slice(0, 400), bytes: rawSize(entry) || text?.length || 0, text }
  })
  const byPath = new Map(contents.map(item => [item.path, item]))
  const files: AnalyzerFile[] = entries.map(entry => {
    const read = byPath.get(entry.name)
    if (read) return { path: read.path, bytes: read.bytes, text: read.text }
    return { path: entry.name.slice(0, 400), bytes: rawSize(entry) }
  })
  options.onStep?.('Evaluando hallazgos…')
  return buildAnalysisFromFiles(normalizeZipName(file.name), 'zip', file.name, files)
}

export async function analyzeRepositoryLink(url: string, options: { onStep?: (message: string) => void } = {}): Promise<AnalyzerReport> {
  const trimmed = url.trim()
  if (!trimmed) throw new AnalyzerSourceError('Escribe el enlace del repositorio (por ejemplo, https://github.com/usuario/repo).')
  const normalized = /^https?:\/\//i.test(trimmed) || /^[^/]+\.[^/]+\/.+/.test(trimmed) ? (trimmed.startsWith('http') ? trimmed : `https://${trimmed}`) : ''
  if (!normalized) throw new AnalyzerSourceError('Enlace no reconocido. Usa https://github.com/usuario/repo o gitlab.com/usuario/repo.')
  options.onStep?.('Consultando el repositorio…')
  const files = await readGitRepository(normalized)
  options.onStep?.(`Evaluando ${files.length} archivos del repositorio…`)
  const last = unifiedLastSegment(normalized.split('?')[0].split('#')[0])
  return buildAnalysisFromFiles(last, 'enlace', normalized, files)
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
      detalle: { total: analysis.scores.total, stack: analysis.stack, idiomas: analysis.stats.languages, tamano: analysis.stats.bytes, versionAnalisis: analysis.recommendationsVersion ?? 2 },
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
