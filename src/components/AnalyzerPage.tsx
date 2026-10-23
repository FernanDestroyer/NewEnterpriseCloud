import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent, type ReactNode } from 'react'
import { AlertTriangle, Boxes, CheckCircle2, Cloud, Gauge, Info, Link2, Printer, RefreshCw, Save, ScanSearch, ShieldCheck, Trash2, Upload } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useRecords } from '../context/RecordsContext'
import { formatBytes, scoreTone, severityTone, type AnalyzerArea, type AnalyzerReport } from '../data/analyzer'
import { fetchAnalysisHistory, analyzerCsvRows, ANALYSIS_CSV_HEADER, analyzeRepositoryLink, analyzeZipArchive, deleteAnalysisById, exportAnalyzerReport, saveAnalysisReport, type AnalysisRow } from '../services/analyzer'
import { displayDate } from '../data/workspace'
import { csvContent, downloadCsv } from '../data/exports'

type AnalysisTab = 'todo' | AnalyzerArea

type HistoryDetail = {
  total?: number
  stack?: string[]
  idiomas?: string[]
  tamano?: number
}

function sourceLabel(kind: AnalysisRow['fuente']) {
  return kind === 'zip' ? 'ZIP' : 'Enlace'
}

function rebuildReport(row: AnalysisRow): AnalyzerReport {
  const detail = (row.detalle ?? {}) as HistoryDetail
  return {
    name: row.nombre,
    source: { kind: row.fuente, origin: row.origen },
    generatedAt: row.created_at,
    stats: { files: row.archivos, bytes: detail.tamano ?? 0, languages: detail.idiomas ?? [] },
    stack: detail.stack ?? [],
    findings: (row.hallazgos ?? []) as AnalyzerReport['findings'],
    aws: (row.servicios ?? []) as AnalyzerReport['aws'],
    scores: {
      security: row.puntuacion_seguridad,
      scalability: row.puntuacion_escalabilidad,
      cloudReadiness: row.puntuacion_cloud,
      total: detail.total ?? Math.round(row.puntuacion_seguridad * 0.4 + row.puntuacion_escalabilidad * 0.3 + row.puntuacion_cloud * 0.3),
    },
  }
}

function ScoreCard({ title, score, detail, icon }: { title: string; score: number; detail: string; icon: typeof ShieldCheck }) {
  const tone = scoreTone(score)
  const Icon = icon
  return <div className="an-score"><span className={`an-score-icon ${tone}`}><Icon size={19} /></span><div><small>{title}</small><strong>{score}</strong><span>{detail}</span></div><span className={`status-pill ${tone}`}>{score >= 80 ? 'Sólido' : score >= 55 ? 'Atención' : 'Riesgo'}</span></div>
}

export default function AnalyzerPage() {
  const { can, session } = useAuth()
  const { notify } = useRecords()
  const [tab, setTab] = useState<AnalysisTab>('todo')
  const [source, setSource] = useState<'zip' | 'enlace'>('zip')
  const [link, setLink] = useState('')
  const [running, setRunning] = useState(false)
  const [step, setStep] = useState('')
  const [error, setError] = useState('')
  const [report, setReport] = useState<AnalyzerReport | null>(null)
  const [dragging, setDragging] = useState(false)
  const [history, setHistory] = useState<AnalysisRow[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyError, setHistoryError] = useState('')
  const [busyRow, setBusyRow] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const loadHistory = async () => {
    setHistoryLoading(true)
    setHistoryError('')
    try {
      setHistory(await fetchAnalysisHistory(12))
    } catch (cause) {
      setHistoryError((cause as Error).message)
      setHistory([])
    } finally {
      setHistoryLoading(false)
    }
  }

  useEffect(() => {
    if (!can('analizador')) return
    void loadHistory()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const finish = (next: AnalyzerReport) => {
    setReport(next)
    setStep('')
    setRunning(false)
    setTab('todo')
    notify(`Análisis de «${next.name}» listo: ${next.findings.length} hallazgos en ${next.stats.files} archivos.`)
  }

  const runZip = async (file: File) => {
    if (running) return
    setRunning(true)
    setError('')
    setStep('Validando archivo…')
    try {
      finish(await analyzeZipArchive(file, { onStep: setStep }))
    } catch (cause) {
      setError((cause as Error).message || 'No se pudo completar el análisis.')
      setStep('')
      setRunning(false)
    }
  }

  const chooseZip = (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    if (!/\.zip$/i.test(file.name) && file.type !== 'application/zip') {
      setError('El archivo no parece un ZIP: súbelo comprimido (.zip) o usa la pestaña de enlace.')
      return
    }
    void runZip(file)
  }

  const submitLink = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (running || !link.trim()) return
    setError('')
    setRunning(true)
    void analyzeRepositoryLink(link, { onStep: setStep })
      .then(finish)
      .catch(cause => {
        setError((cause as Error).message)
        setStep('')
        setRunning(false)
      })
  }

  const exportCsv = () => {
    if (!report) return
    downloadCsv(`analisis-${report.name.toLocaleLowerCase('en').replace(/[^a-z0-9]+/g, '-')}.csv`, ANALYSIS_CSV_HEADER, analyzerCsvRows(report))
    notify('Los hallazgos se descargaron como CSV.')
  }

  const printReport = () => {
    if (!report || busyRow) return
    setBusyRow('print')
    exportAnalyzerReport(report)
      .catch(cause => notify((cause as Error).message))
      .finally(() => setBusyRow(null))
  }

  const saveToSupabase = async () => {
    if (!report) return
    setBusyRow('save')
    try {
      await saveAnalysisReport(report, session?.user.email ?? null)
      await loadHistory()
      notify('Análisis guardado en Supabase.')
    } catch (cause) {
      notify((cause as Error).message)
    } finally {
      setBusyRow(null)
    }
  }

  const removeRow = async (row: AnalysisRow) => {
    setBusyRow(row.id)
    try {
      await deleteAnalysisById(row.id)
      setHistory(current => current.filter(item => item.id !== row.id))
      notify(`Se eliminó el análisis de «${row.nombre}».`)
    } catch (cause) {
      notify((cause as Error).message)
    } finally {
      setBusyRow(null)
    }
  }

  const openRow = (row: AnalysisRow) => {
    setReport(rebuildReport(row))
    setTab('todo')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    chooseZip(event.dataTransfer.files)
  }

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(true)
  }

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    chooseZip(event.target.files)
    event.target.value = ''
  }

  if (!can('analizador')) {
    return <section className="ws-card ws-empty-compact"><ScanSearch size={28} /><strong>Acceso restringido al analizador</strong><span>Tu rol no tiene permiso del módulo «analizador». Solicítalo a un administrador.</span></section>
  }

  const findings = report
    ? report.findings.filter(finding => tab === 'todo' || finding.area === tab)
    : []
  const criticalCount = report?.findings.filter(finding => finding.severity === 'Critica').length ?? 0

  return <>
    <section className="ws-page-heading"><div><span className="ws-eyebrow">DESARROLLO / TECNOLOGÍA</span><h1>Analizador de proyectos</h1><p>Comparte un ZIP o el enlace de un repositorio y evalúa seguridad, escalabilidad y servicios AWS con recomendaciones accionables.</p></div><div className="ws-heading-actions">{report && <button className="ws-button ws-button-secondary" disabled={running} onClick={exportCsv}><Boxes size={16} />Descargar CSV</button>}{report && <button className="ws-button ws-button-secondary" disabled={running || busyRow === 'print'} onClick={printReport}><Printer size={16} />{busyRow === 'print' ? 'Preparando…' : 'Imprimir informe'}</button>}{report && can('analizador', 'crear') && <button className="ws-button" disabled={running || busyRow === 'save'} onClick={() => void saveToSupabase()}><Save size={16} />{busyRow === 'save' ? 'Guardando…' : 'Guardar análisis'}</button>}</div></section>
    {error && <div className="ws-notice ws-notice-warning" role="alert"><AlertTriangle size={18} /><span>{error}</span></div>}
    <div className="an-layout">
    <section className="ws-card"><div className="ws-card-heading"><div><h2>Origen del análisis</h2><p>Los archivos no salen de tu navegador, salvo la lectura del repositorio público indicado.</p></div><ScanSearch size={19} /></div>
      <div className="ws-form">
      <div className="ws-tabs" role="tablist" aria-label="Origen del análisis">
        <button role="tab" aria-selected={source === 'zip'} onClick={() => setSource('zip')}>Subir ZIP</button>
        <button role="tab" aria-selected={source === 'enlace'} onClick={() => setSource('enlace')}>Analizar enlace</button>
      </div>
      {source === 'zip' ? (
        <div className={`an-uploader${dragging ? ' is-dragging' : ''}`} onDrop={onDrop} onDragOver={onDragOver} onDragLeave={() => setDragging(false)}>
          <input ref={inputRef} type="file" accept=".zip,application/zip" onChange={onFileChange} disabled={running} hidden />
          <span className="an-uploader-icon"><Upload size={26} /></span>
          <strong>Arrastra tu ZIP o elige el archivo</strong>
          <small>Hasta 60 MB · se ignoran dependencias (node_modules, .venv) y contenido binario en profundidad</small>
          <button className="ws-button" type="button" disabled={running} onClick={() => inputRef.current?.click()}>Elegir archivo</button>
        </div>
      ) : (
        <form onSubmit={submitLink}>
          <label>Enlace del repositorio público
            <input value={link} onChange={event => setLink(event.target.value)} placeholder="https://github.com/usuario/repo" inputMode="url" disabled={running} />
          </label>
          <p className="relation-hint"><Info size={15} />Compatible con GitHub y GitLab públicos (rama por defecto). Para otros orígenes, descarga el ZIP y súbelo.</p>
          <div className="ws-heading-actions"><button className="ws-button" type="submit" disabled={running || !link.trim()}><Link2 size={16} />{running ? 'Analizando…' : 'Analizar repositorio'}</button></div>
        </form>
      )}
      {running && <div className="ws-source-note" role="status"><RefreshCw size={16} className="ws-spin" /><span>{step || 'Analizando proyecto…'}</span></div>}
      {!report && !running && !error && <p className="relation-hint"><CheckCircle2 size={15} />El informe incluye puntuaciones, hallazgos por severidad, servicios AWS detectados y un plan de recomendaciones accionables.</p>}
      </div>
    </section>

    {report && <>
      {report.stats.files === 0 ? <section className="ws-card ws-empty-compact"><AlertTriangle size={28} /><strong>No se detectaron archivos analizados</strong><span>El origen compartido puede estar vacío, cifrado o solo con registros binarios. Verifica el contenido e inténtalo otra vez.</span></section> : <>
        <section className="ws-card an-summary" aria-label="Puntuaciones del análisis">
          <div className="an-scores">
            <ScoreCard title="Puntuación general" score={report.scores.total} detail="Media ponderada 40/30/30" icon={Gauge} />
            <ScoreCard title="Seguridad" score={report.scores.security} detail={`${report.findings.filter(finding => finding.area === 'Seguridad').length} hallazgos · ${criticalCount} críticos`} icon={ShieldCheck} />
            <ScoreCard title="Escalabilidad" score={report.scores.scalability} detail={`${report.findings.filter(finding => finding.area === 'Escalabilidad').length} hallazgos`} icon={Boxes} />
            <ScoreCard title="Preparación cloud" score={report.scores.cloudReadiness} detail={report.aws.length ? `${report.aws.length} servicios AWS evidenciados` : 'Sin evidencias AWS'} icon={Cloud} />
          </div>
          <div className="an-summary-foot"><span><strong>{report.stats.files}</strong> archivos · {formatBytes(report.stats.bytes)}</span>{report.stack.length > 0 && <span className="an-stack">{report.stack.map(item => <code key={item}>{item}</code>)}</span>}{report.stats.languages.length > 0 && <span className="an-languages"><Info size={13} />{report.stats.languages.join(' · ')}</span>}</div>
        </section>
        <section className="ws-card"><div className="ws-card-heading"><div><h2>Servicios AWS detectados</h2><p>Evidencias por patrón de uso del código e infraestructura definida.</p></div><Cloud size={19} /></div>
          <div className="ws-form">{report.aws.length ? <div className="an-aws-list">{report.aws.map(insight => <div className="an-aws" key={insight.service}><span className="ws-soft-icon blue"><Cloud size={17} /></span><span className="an-aws-copy"><strong>{insight.service}</strong><small>{insight.category}{insight.evidence.length ? ` · ${insight.evidence.length} coincidencias` : ''}</small></span></div>)}</div> : <p className="relation-hint"><Info size={15} />No se encontraron pistas de servicios AWS. Si el sistema corre en la nube, documenta los manifiestos (SAM, Terraform) para que el analizador mapee la arquitectura.</p>}</div>
        </section>
        <section className="ws-card">
          <div className="ws-card-heading"><div><h2>Hallazgos</h2><p>{report.findings.length} observaciones con severidad y recomendación.</p></div><AlertTriangle size={19} /></div>
          <div className="ws-form">
          <div className="ws-tabs" role="tablist" aria-label="Filtrar hallazgos">{(['todo', 'Seguridad', 'Escalabilidad'] as const).map(option => <button key={option} role="tab" aria-selected={tab === option} onClick={() => setTab(option)}>{option === 'todo' ? `Todas (${report.findings.length})` : `${option} (${report.findings.filter(finding => finding.area === option).length})`}</button>)}</div>
          <div className="an-findings">{findings.map(finding => <article className="an-finding" key={finding.id}>
            <div className="an-finding-head"><span className={`status-pill ${severityTone(finding.severity)}`}>{finding.severity}</span><strong>{finding.title}</strong><small className="an-finding-area">{finding.area} · {finding.id}</small></div>
            <p>{finding.detail}</p>
            {finding.files.length > 0 && <div className="an-files">{finding.files.map(file => <code key={file}>{file}</code>)}</div>}
            <p className="an-reco"><b>Recomendación:</b> {finding.recommendation}</p>
          </article>)}</div>
          {!findings.length && <div className="ws-empty-compact"><CheckCircle2 size={26} /><strong>Sin hallazgos en este filtro</strong><span>Cambia de pestaña o sube otro proyecto para continuar.</span></div>}
          {findings.some(finding => finding.severity === 'Critica') && <div className="ws-notice ws-notice-warning"><AlertTriangle size={18} /><span>Hay hallazgos críticos: prioriza la rotación de credenciales y secretos antes de otro despliegue.</span></div>}
          </div>
        </section>
      </>
      }
    </>}

    <section className="ws-card"><div className="ws-card-heading"><div><h2>Historial de análisis</h2><p>Guardados en Supabase para comparar la evolución del proyecto.</p></div><RefreshCw size={19} /></div>
      <div className="ws-form">
      {historyError && <div className="ws-notice ws-notice-warning" role="alert"><AlertTriangle size={18} /><span>{historyError}</span><button className="ws-text-button" onClick={() => void loadHistory()}>Reintentar</button></div>}
      {historyLoading && !historyError ? <div className="ws-empty-compact"><RefreshCw size={26} className="ws-spin" /><strong>Consultando historial…</strong></div> : history.length ? <div className="table-scroll"><table className="record-table"><thead><tr><th>Proyecto</th><th>Origen</th><th className="ws-align-right">Seguridad</th><th className="ws-align-right">Escalabilidad</th><th className="ws-align-right">Cloud</th><th className="ws-align-right">Hallazgos</th><th className="ws-align-right">Total</th><th>Fecha</th><th><span className="sr-only">Acciones</span></th></tr></thead><tbody>{history.map(row => <tr key={row.id}>
        <td><strong>{row.nombre}</strong><small>{row.origen || 'Origen sin registrar'}</small></td>
        <td><span className="status-pill blue">{sourceLabel(row.fuente)}</span></td>
        <td className="ws-align-right"><span className={`status-pill ${scoreTone(row.puntuacion_seguridad)}`}>{row.puntuacion_seguridad}</span></td>
        <td className="ws-align-right"><span className={`status-pill ${scoreTone(row.puntuacion_escalabilidad)}`}>{row.puntuacion_escalabilidad}</span></td>
        <td className="ws-align-right"><span className={`status-pill ${scoreTone(row.puntuacion_cloud)}`}>{row.puntuacion_cloud}</span></td>
        <td className="ws-align-right">{Array.isArray(row.hallazgos) ? row.hallazgos.length : 0}</td>
        <td className="ws-align-right"><span className={`status-pill ${scoreTone(((row.detalle ?? {}) as HistoryDetail).total ?? 0)}`}>{((row.detalle ?? {}) as HistoryDetail).total ?? '—'}</span></td>
        <td className="record-date">{displayDate(row.created_at)}</td>
        <td><div className="row-actions"><button className="row-action" title="Abrir este análisis" aria-label={`Abrir análisis de ${row.nombre}`} disabled={busyRow === row.id} onClick={() => openRow(row)}><ScanSearch size={15} /></button>{can('analizador', 'eliminar') && <button className="row-action" title="Eliminar análisis" aria-label={`Eliminar análisis de ${row.nombre}`} disabled={busyRow === row.id} onClick={() => void removeRow(row)}><Trash2 size={15} /></button>}</div></td>
      </tr>)}</tbody></table></div> : <div className="ws-empty-compact"><ScanSearch size={26} /><strong>Historial vacío</strong><span>Guarda tu primer análisis con «Guardar análisis».</span></div>}
      </div>
    </section>
    </div>
  </>
}
