import type { AnalyzerFinding, AnalyzerReport, AnalyzerSeverity } from './analyzer'

const esc = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')

const SEVERITY_LABEL: Record<AnalyzerSeverity, string> = { Critica: 'Crítico', Alta: 'Alta', Media: 'Media', Info: 'Informativo' }
const SEVERITY_COLOR: Record<AnalyzerSeverity, string> = { Critica: '#b4322b', Alta: '#9a6a12', Media: '#245f9b', Info: '#166a43' }

function scoreRing(title: string, score: number) {
  const tone = score >= 80 ? '#166a43' : score >= 55 ? '#9a6a12' : '#b4322b'
  const circumference = 2 * Math.PI * 34
  const dash = clamp(score) / 100 * circumference
  return `<div class="ring"><svg viewBox="0 0 84 84" role="img" aria-label="${esc(title)}: ${score}"><circle cx="42" cy="42" r="34" fill="none" stroke="#e2e8ef" stroke-width="9"/><circle cx="42" cy="42" r="34" fill="none" stroke="${tone}" stroke-width="9" stroke-linecap="round" stroke-dasharray="${dash.toFixed(1)} ${circumference.toFixed(1)}" transform="rotate(-90 42 42)"/><text x="42" y="49" text-anchor="middle" font-size="20" font-weight="700" fill="${tone}">${score}</text></svg><strong>${esc(title)}</strong></div>`
}

function clamp(score: number) {
  return Math.max(0, Math.min(100, Math.round(score)))
}

function sortingFindings(findings: AnalyzerFinding[], area: 'Seguridad' | 'Escalabilidad') {
  return findings.filter(finding => finding.area === area)
}

function findingRows(findings: AnalyzerFinding[]) {
  if (!findings.length) return '<p class="empty">No se detectaron observaciones en esta categoría.</p>'
  return `<ol class="findings">${findings.map(finding => `<li><div class="finding-head"><span class="severity" style="color:${SEVERITY_COLOR[finding.severity]}"><b>${SEVERITY_LABEL[finding.severity]}</b></span><strong>${esc(finding.title)}</strong></div><p>${esc(finding.detail)}</p>${finding.files.length ? `<p class="files">${finding.files.map(file => `<code>${esc(file)}</code>`).join(' ')}</p>` : ''}<p class="reco"><b>Recomendación:</b> ${esc(finding.recommendation)}</p></li>`).join('')}</ol>`
}

function awsRows(analysis: AnalyzerReport) {
  if (!analysis.aws.length) return '<p class="empty">No se detectaron evidencias de servicios AWS en los archivos analizados. Consulta la evaluación de preparación cloud para el plan de migración.</p>'
  return `<table class="plain"><thead><tr><th>Servicio</th><th>Categoría</th><th>Evidencias</th></tr></thead><tbody>${analysis.aws.map(insight => `<tr><td><b>${esc(insight.service)}</b></td><td>${esc(insight.category)}</td><td>${insight.evidence.length ? insight.evidence.slice(0, 4).map(file => `<code>${esc(file)}</code>`).join(' ') : 'Uso general del proyecto'}</td></tr>`).join('')}</tbody></table>`
}

function metaRow(analysis: AnalyzerReport) {
  const when = new Date(analysis.generatedAt)
  const label = Number.isNaN(when.getTime())
    ? analysis.generatedAt
    : when.toLocaleDateString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric' })
  return `Fuente: ${esc(analysis.source.kind === 'zip' ? 'Paquete ZIP' : 'Repositorio enlace')} · ${esc(analysis.source.origin)} · Archivos: ${analysis.stats.files} · Generado: ${esc(label)}`
}

export function renderAnalyzerReport(analysis: AnalyzerReport, logoUrl?: string | null): string {
  const critical = analysis.findings.filter(finding => finding.severity === 'Critica').length
  const summary = critical > 0
    ? `Atención: ${critical} hallazgo${critical === 1 ? '' : 's'} crítico${critical === 1 ? '' : 's'} requieren rotación de credenciales y revisión inmediata.`
    : 'No se detectaron hallazgos críticos; revisa los hallazgos de severidad alta antes del despliegue.'
  return `<!doctype html><html lang="es"><head><meta charset="utf-8" /><title>Analizador de proyectos · ${esc(analysis.name)}</title><style>
:root { color-scheme: light; }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font: 12px/1.55 'Segoe UI', Arial, sans-serif; color: #17202b; background: #f4f6f9; padding: 24px; }
.sheet { max-width: 210mm; margin: 0 auto; background: #fff; padding: 32px 34px; border-radius: 14px; box-shadow: 0 10px 34px rgba(15, 24, 40, .12); }
.brand { display: flex; justify-content: space-between; align-items: center; gap: 16px; border-bottom: 2px solid #e5eaf1; padding-bottom: 14px; }
.logo-box { width: 52px; height: 52px; flex-shrink: 0; display: grid; place-items: center; background: #fff; border: 1px solid #e5eaf1; border-radius: 10px; padding: 6px; }
.logo-box img { width: 100%; height: 100%; max-width: 100%; max-height: 100%; object-fit: contain; }
.logo-monogram { color: #087f86; font-weight: 900; font-size: 20px; letter-spacing: -0.02em; }
.brand h1 { font-size: 19px; letter-spacing: -.01em; }
.brand small { color: #5c6a7d; display: block; font-size: 11px; }
.kicker { font-size: 10px; letter-spacing: .14em; color: #6a7788; font-weight: 700; }
.rings { display: flex; gap: 24px; margin: 22px 0 6px; flex-wrap: wrap; }
.ring { width: 150px; text-align: center; }
.ring svg { width: 84px; height: 84px; }
.ring strong { display: block; margin-top: 4px; font-size: 11.5px; color: #404f63; }
.headline { margin: 10px 0 4px; font-size: 12.5px; color: #404f63; }
.meta { color: #5c6a7d; font-size: 10.5px; }
h2 { font-size: 14px; margin: 26px 0 10px; padding-top: 12px; border-top: 1px solid #e5eaf1; }
table.plain { width: 100%; border-collapse: collapse; font-size: 11px; }
table.plain th { text-align: left; background: #eef2f7; padding: 7px 9px; font-size: 9.5px; letter-spacing: .06em; text-transform: uppercase; color: #566679; }
table.plain td { border-bottom: 1px solid #edf0f5; padding: 7px 9px; vertical-align: top; }
code { background: #eef2f7; border-radius: 4px; padding: 1px 5px; font: 9.5px 'DM Mono', Consolas, monospace; color: #2c3a4d; }
ol.findings { list-style: none; display: grid; gap: 10px; }
ol.findings li { border: 1px solid #e5eaf1; border-radius: 9px; padding: 10px 12px; }
.finding-head { display: flex; gap: 10px; align-items: baseline; }
.severity b { font-size: 9.5px; letter-spacing: .07em; text-transform: uppercase; }
ol.findings p { margin: 4px 0 0; color: #3c4a5d; }
ol.findings .files { font-size: 10px; }
ol.findings .reco { color: #1f2c3d; }
.empty { color: #5c6a7d; background: #f6f8fb; border: 1px dashed #d5dde8; border-radius: 9px; padding: 10px 12px; }
.stack { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 2px; }
.stack span { background: #eef2f7; border-radius: 999px; padding: 3px 10px; font-size: 10.5px; color: #2c3a4d; }
.footer { margin-top: 26px; font-size: 9.5px; color: #7b8798; border-top: 1px solid #e5eaf1; padding-top: 10px; }
.actions { text-align: center; margin-top: 18px; }
.actions button { border: 1px solid #2c3a4d; background: #fff; color: #2c3a4d; border-radius: 999px; padding: 8px 22px; font-size: 11px; font-weight: 700; cursor: pointer; }
@media print { body { background: #fff; padding: 0; } .sheet { box-shadow: none; border-radius: 0; padding: 10mm 12mm; max-width: none; } .actions { display: none; } @page { margin: 10mm 12mm; } }
</style></head><body><div class="sheet">
<header class="brand"><div class="logo-box">${logoUrl ? `<img src="${logoUrl}" alt="Logotipo de EnterpriseCloud" />` : '<span class="logo-monogram">EC</span>'}</div><div style="text-align:right"><span class="kicker">ANALIZADOR DE PROYECTOS · ENTERPRISECLOUD</span><small>${esc(metaRow(analysis))}</small></div></header>
<div class="rings">${scoreRing('Puntuación general', analysis.scores.total)}${scoreRing('Seguridad', analysis.scores.security)}${scoreRing('Escalabilidad', analysis.scores.scalability)}${scoreRing('Preparación cloud', analysis.scores.cloudReadiness)}</div>
<p class="headline" style="margin-top:14px"><b>Proyecto:</b> ${esc(analysis.name)}</p>
<p class="headline">${esc(summary)}</p>
${analysis.stack.length ? `<p class="meta" style="margin-top:2px">Stack detectado:</p><div class="stack">${analysis.stack.map(item => `<span>${esc(item)}</span>`).join('')}</div>` : ''}
<p class="meta" style="margin:10px 0 0">Carpeta de referencia: ${esc(metaRow(analysis))} · Idiomas principales: ${esc(analysis.stats.languages.join(', ') || 'no identificados')}</p>
<h2>Seguridad · hallazgos y recomendaciones</h2>${findingRows(sortingFindings(analysis.findings, 'Seguridad'))}
<h2>Escalabilidad · hallazgos y recomendaciones</h2>${findingRows(sortingFindings(analysis.findings, 'Escalabilidad'))}
<h2>Servicios AWS detectados</h2>${awsRows(analysis)}
<h2>Lectura de la preparación cloud</h2><p style="color:#3c4a5d">La puntuación de preparación cloud combina contenerización (Docker), infraestructura como código (SAM/Serverless/Terraform), integración continua, pruebas y uso de servicios administrados AWS. Un proyecto con manifiestos reproducibles y secretos en gestores de secretos obtiene mejor resultado al migrar a ECS/Fargate o Lambda según la carga.</p>
<footer class="footer">EnterpriseCloud · Analizador de proyectos · Informe generado automáticamente sobre los archivos compartidos; los hallazgos son heurísticas y requieren revisión humana antes de actuar.</footer>
<div class="actions"><button onclick="window.print()">Imprimir o guardar PDF</button></div>
<script>window.addEventListener('load', () => { setTimeout(() => window.focus(), 150) })</script>
</div></body></html>`
}
