import type { ExecutiveReport } from './executiveReport.ts'
import { recordAmount } from './dashboard.ts'
import { displayDate } from './workspace.ts'

export type ExecutiveReportBrand = {
  name: string
  ruc?: string
  address?: string
  logoUrl?: string
  author?: string
  periodLabel: string
  dataNotes?: string[]
  autoPrint?: boolean
}

// Deja espacio para razones sociales y conceptos de varias líneas sin cortar filas.
const SALES_PER_PAGE = 8
const colors = ['#087f86', '#b27c28', '#6772b8', '#348b67', '#708195']
const money = (value: number) => new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN', maximumFractionDigits: 2 }).format(value)
const number = (value: number) => new Intl.NumberFormat('es-PE', { maximumFractionDigits: 1 }).format(value)
const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)

const reportStyles = `
  :root { color-scheme: light; --ink: #182b40; --muted: #697c8e; --teal: #087f86; --line: #e0e8ed; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #e8edf2; color: var(--ink); font-family: 'Segoe UI', Arial, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  h1, h2, h3, p { margin: 0; }
  .preview-bar { position: sticky; top: 0; z-index: 5; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 24px; background: #11283d; color: #fff; font-size: 12px; box-shadow: 0 3px 18px #11283d30; }
  .preview-bar small { display: block; color: #b2cbd9; margin-top: 3px; }
  .preview-bar button { border: 0; border-radius: 7px; padding: 11px 18px; background: #89ece2; color: #11283d; cursor: pointer; font-weight: 700; white-space: nowrap; }
  .report-sheet { width: 297mm; min-height: 210mm; margin: 24px auto; padding: 8mm 10mm 7mm; background: #fff; display: flex; flex-direction: column; box-shadow: 0 12px 50px #152b4020; break-after: page; }
  .report-sheet:last-child { break-after: auto; }
  .masthead { position: relative; overflow: hidden; padding: 15px 20px; border-radius: 12px; color: #fff; background: linear-gradient(115deg, #12283d 0%, #15374b 65%, #0b6269 100%); }
  .masthead::after { content: ''; position: absolute; right: -45px; top: -85px; width: 270px; height: 270px; border: 35px solid #ffffff06; border-radius: 50%; pointer-events: none; }
  .brand-row, .title-row, .panel-heading, .report-footer { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
  .brand { display: flex; align-items: center; gap: 11px; min-width: 0; }
  .logo-box { width: 43px; height: 43px; display: grid; place-items: center; flex-shrink: 0; background: #fff; border-radius: 9px; padding: 4px; }
  .logo-box img { max-width: 100%; max-height: 100%; object-fit: contain; }
  .logo-monogram { color: #087f86; font-weight: 900; font-size: 19px; }
  .brand-name { font-weight: 700; font-size: 13px; max-width: 570px; overflow-wrap: anywhere; }
  .brand-sub { margin-top: 4px; color: #c3d5df; font-size: 8px; letter-spacing: .5px; max-width: 570px; }
  .edition { text-align: right; font-size: 8px; text-transform: uppercase; letter-spacing: 1.5px; color: #a7d9df; flex-shrink: 0; }
  .edition strong { display: block; margin-top: 5px; color: #fff; letter-spacing: .4px; font-size: 10px; }
  .title-row { margin-top: 10px; align-items: flex-end; position: relative; z-index: 1; }
  .title-row h1 { font-size: 26px; line-height: 1.1; letter-spacing: -.8px; font-weight: 750; }
  .title-row p { margin-top: 5px; color: #c3d5df; font-size: 9px; }
  .period { text-align: right; font-size: 10px; font-weight: 650; }
  .period small { display: block; font-size: 7px; letter-spacing: 1.5px; text-transform: uppercase; color: #a7d9df; margin-bottom: 5px; }
  .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 11px; margin-top: 12px; }
  .kpi { padding: 10px 14px; border: 1px solid var(--line); border-top: 3px solid var(--teal); border-radius: 9px; background: #f9fcfc; }
  .kpi.gold { border-top-color: #b27c28; background: #fdfbf6; }
  .kpi.navy { border-top-color: #294760; background: #f8fafc; }
  .kpi.violet { border-top-color: #6772b8; background: #fafafe; }
  .kpi-label { color: var(--muted); font-size: 8px; text-transform: uppercase; letter-spacing: .75px; font-weight: 700; }
  .kpi-value { display: block; margin-top: 5px; font-size: 23px; line-height: 1.1; font-weight: 750; letter-spacing: -.8px; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
  .kpi-detail { font-size: 8px; margin-top: 5px; color: var(--muted); }
  .positive { color: #187254; } .negative { color: #b34840; }
  .analytics-grid { display: grid; grid-template-columns: 1.7fr 1fr; gap: 12px; margin-top: 10px; }
  .panel { min-width: 0; padding: 12px 15px; border: 1px solid var(--line); border-radius: 10px; background: #fff; break-inside: avoid; }
  .panel-heading { align-items: flex-start; gap: 10px; }
  .panel h2 { font-size: 12px; letter-spacing: -.2px; }
  .caption { margin-top: 3px; color: var(--muted); font-size: 8px; line-height: 1.4; }
  .section-no { font-size: 8px; color: #91a3b3; letter-spacing: 1px; }
  .legend { display: flex; gap: 12px; font-size: 8px; color: var(--muted); white-space: nowrap; }
  .dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: var(--dot, #087f86); margin-right: 5px; }
  .trend-svg { width: 100%; height: 116px; display: block; margin-top: 7px; }
  .chart-note { display: flex; justify-content: space-between; gap: 8px; margin-top: 3px; color: var(--muted); font-size: 7px; }
  .status-layout { display: flex; align-items: center; gap: 9px; margin-top: 8px; }
  .donut { flex: 0 0 116px; width: 116px; height: 116px; }
  .status-list { flex: 1; min-width: 0; }
  .status-entry + .status-entry { margin-top: 13px; }
  .status-entry span { display: block; font-size: 8px; color: var(--muted); }
  .status-entry strong { display: block; font-size: 14px; margin: 4px 0 2px; font-variant-numeric: tabular-nums; }
  .status-entry small { font-size: 7px; color: var(--muted); }
  .detail-grid { display: grid; grid-template-columns: 1.05fr 1fr 1fr; gap: 12px; margin-top: 10px; }
  .rank-list { margin-top: 8px; }
  .rank + .rank { margin-top: 5px; }
  .rank-line { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; font-size: 8px; }
  .rank-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rank-line b { font-variant-numeric: tabular-nums; font-weight: 650; white-space: nowrap; }
  .rank-track { margin-top: 4px; height: 4px; background: #edf2f5; border-radius: 4px; overflow: hidden; }
  .rank-fill { height: 100%; background: var(--teal); border-radius: inherit; }
  .rank-note { margin-top: 9px; font-size: 7px; color: var(--muted); }
  .pulse-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 9px; margin-top: 11px; }
  .pulse-grid div { padding: 8px; background: #f3f7f9; border-radius: 6px; min-width: 0; }
  .pulse-grid small { display: block; font-size: 7px; color: var(--muted); }
  .pulse-grid strong { display: block; font-size: 13px; margin-top: 4px; font-variant-numeric: tabular-nums; }
  .pulse-grid .attention { background: #fff3dd; }
  .pulse-grid .attention strong { color: #946020; }
  .executive-insight { display: flex; gap: 13px; margin-top: 10px; padding: 8px 12px; background: #edf8f6; border: 1px solid #d1eae5; border-left: 3px solid #087f86; border-radius: 7px; align-items: flex-start; }
  .executive-insight strong { flex-shrink: 0; color: #096a71; font-size: 8px; text-transform: uppercase; letter-spacing: .6px; }
  .executive-insight p { font-size: 8px; line-height: 1.5; }
  .report-footer { padding-top: 8px; margin-top: auto; font-size: 7px; color: var(--muted); border-top: 1px solid var(--line); }
  .footer-left { line-height: 1.6; max-width: 87%; }
  .page-number { color: var(--ink); white-space: nowrap; font-weight: 700; letter-spacing: 1px; }
  .footer-space { height: 8px; }
  .annex-header { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding-bottom: 13px; border-bottom: 3px solid #087f86; }
  .annex-header .brand-name { color: var(--ink); }
  .annex-header .brand-sub { color: var(--muted); }
  .annex-header .logo-box { border: 1px solid var(--line); }
  .annex-title { display: flex; align-items: flex-end; justify-content: space-between; gap: 15px; margin: 17px 0 12px; }
  .annex-title h2 { font-size: 22px; letter-spacing: -.5px; }
  .annex-title p { font-size: 9px; color: var(--muted); margin-top: 5px; }
  .annex-total { text-align: right; flex-shrink: 0; }
  .annex-total small { display: block; font-size: 8px; color: var(--muted); }
  .annex-total strong { display: block; font-size: 21px; color: var(--teal); margin-top: 4px; }
  .sales-table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 10px; }
  .sales-table th { padding: 9px 8px; text-align: left; background: #182f44; color: #fff; font-size: 7px; letter-spacing: .7px; text-transform: uppercase; }
  .sales-table td { padding: 10px 8px; border-bottom: 1px solid var(--line); line-height: 1.5; overflow-wrap: anywhere; vertical-align: middle; }
  .sales-table tbody tr:nth-child(even) { background: #f5f9fa; }
  .sales-table tr { break-inside: avoid; }
  .sales-table .right { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .ref { color: var(--teal); font-weight: 750; font-size: 9px; }
  .sale-detail { color: var(--muted); font-size: 8px; }
  .badge { display: inline-block; padding: 3px 6px; font-size: 7px; font-weight: 700; border-radius: 4px; color: #815c25; background: #fcf0da; white-space: nowrap; }
  .badge.done { color: #187254; background: #e2f2e9; }
  .badge.progress { color: #286d96; background: #e5f0f8; }
  .annex-subtotal { display: flex; justify-content: flex-end; gap: 22px; padding: 12px 9px; background: #eef6f6; color: var(--teal); font-size: 10px; border-bottom: 2px solid #c6e0df; }
  .annex-notes { margin-top: 18px; padding: 12px 14px; background: #f5f8fa; border-radius: 7px; color: var(--muted); font-size: 8px; line-height: 1.7; }
  .annex-notes strong { color: var(--ink); }
  .empty { display: flex; align-items: center; justify-content: center; text-align: center; color: var(--muted); font-size: 9px; border: 1px dashed var(--line); border-radius: 7px; padding: 12px; background: #fafcfd; }
  .empty-chart { height: 142px; margin-top: 8px; }
  .empty-rank { height: 90px; margin-top: 10px; }
  @page { size: A4 landscape; margin: 0; }
  @media print {
    body { background: #fff; }
    .preview-bar { display: none; }
    .report-sheet { margin: 0; box-shadow: none; }
  }
`

function trendChart(report: ExecutiveReport) {
  const { buckets, interval } = report.trend
  const dated = report.sales.length > report.undatedCount || buckets.some(bucket => bucket.purchases > 0)
  if (!dated) return '<div class="empty empty-chart">Sin operaciones con fecha en este período.</div>'
  const maximum = Math.max(1, ...buckets.flatMap(bucket => [bucket.sales, bucket.purchases]))
  const unit = 10 ** Math.floor(Math.log10(maximum / 4))
  const ceiling = Math.ceil(maximum / 4 / unit) * unit * 4
  const x = (index: number) => buckets.length === 1 ? 330 : 48 + index / (buckets.length - 1) * 540
  const y = (value: number) => 106 - value / ceiling * 90
  const points = (kind: 'sales' | 'purchases') => buckets.map((bucket, index) => `${index ? 'L' : 'M'}${x(index).toFixed(2)},${y(bucket[kind]).toFixed(2)}`).join(' ')
  const compact = (value: number) => new Intl.NumberFormat('es-PE', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
  const tickLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: 'short' })
  const grid = [0, 1, 2, 3, 4].map(index => `<line x1="48" x2="588" y1="${y(ceiling * index / 4)}" y2="${y(ceiling * index / 4)}" stroke="#e5ecef" stroke-dasharray="3 4"/><text x="38" y="${y(ceiling * index / 4) + 3}" text-anchor="end" font-size="9" fill="#697c8e">${compact(ceiling * index / 4)}</text>`).join('')
  const ticks = buckets.map((bucket, index) => index === 0 || index === buckets.length - 1 || index % Math.max(1, Math.ceil(buckets.length / 5)) === 0
    ? `<text x="${x(index)}" y="128" text-anchor="middle" font-size="10" fill="#697c8e">${escape(tickLabel(bucket.date))}</text>` : '').join('')
  const dots = buckets.map((bucket, index) => `<circle cx="${x(index)}" cy="${y(bucket.sales)}" r="${buckets.length > 25 ? 1.8 : 3}" fill="#087f86" stroke="#fff" stroke-width="1"/>`).join('')
  return `<svg class="trend-svg" viewBox="0 0 615 140" role="img" aria-label="Evolución de ventas y compras"><defs><linearGradient id="sales-fill" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#087f86" stop-opacity=".18"/><stop offset="100%" stop-color="#087f86" stop-opacity=".01"/></linearGradient></defs>${grid}<path d="${points('sales')} L${x(buckets.length - 1)},106 L${x(0)},106 Z" fill="url(#sales-fill)"/>${report.purchasesTotal === null ? '' : `<path d="${points('purchases')}" fill="none" stroke="#b27c28" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`}<path d="${points('sales')}" fill="none" stroke="#087f86" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>${dots}${ticks}</svg><div class="chart-note"><span>Importes en soles (PEN) · ${interval === 1 ? 'Agrupación diaria' : `Bloques de ${interval} días`}</span><span>${report.undatedCount ? `${report.undatedCount} ventas sin fecha fuera del gráfico` : 'Fechas originales de registro'}</span></div>`
}

function salesStatus(report: ExecutiveReport) {
  const complete = report.statuses[0]
  const circumference = 2 * Math.PI * 50
  const filled = circumference * Math.min(100, complete.share) / 100
  return `<div class="status-layout"><svg class="donut" viewBox="0 0 144 144" role="img" aria-label="${complete.share}% del importe de ventas completado"><circle cx="72" cy="72" r="50" fill="none" stroke="#edf2f5" stroke-width="13"/><circle cx="72" cy="72" r="50" fill="none" stroke="#087f86" stroke-width="13" stroke-dasharray="${filled} ${circumference}" transform="rotate(-90 72 72)"/><text x="72" y="72" text-anchor="middle" font-size="25" font-weight="750" fill="#182b40">${report.salesTotal > 0 ? `${number(complete.share)}%` : '—'}</text><text x="72" y="89" text-anchor="middle" font-size="8" fill="#697c8e">importe completado</text></svg><div class="status-list">${report.statuses.map((status, index) => `<div class="status-entry"><span><i class="dot" style="--dot:${index ? '#b27c28' : '#087f86'}"></i>${status.label}</span><strong>${money(status.amount)}</strong><small>${status.count} ${status.count === 1 ? 'venta' : 'ventas'} · ${number(status.share)}%</small></div>`).join('')}</div></div>`
}

function ranking(entries: ExecutiveReport['customers'], limit: number, palette = false) {
  if (!entries.length) return '<div class="empty empty-rank">Sin ventas en el período.</div>'
  const shown = entries.slice(0, limit)
  if (entries.length > limit && palette) {
    const others = entries.slice(limit)
    shown.push({ label: 'Otros medios', amount: Math.round(others.reduce((sum, entry) => sum + entry.amount, 0) * 100) / 100, count: 0, share: others.reduce((sum, entry) => sum + entry.share, 0) })
  }
  return `<div class="rank-list">${shown.map((entry, index) => `<div class="rank"><div class="rank-line"><span class="rank-label" title="${escape(entry.label)}">${palette ? '' : `${String(index + 1).padStart(2, '0')} · `}${escape(entry.label)}</span><b>${money(entry.amount)}</b></div><div class="rank-track"><div class="rank-fill" style="width:${Math.min(100, entry.share)}%;${palette ? `background:${colors[index % colors.length]}` : ''}"></div></div></div>`).join('')}</div>`
}

function brandMark(brand: ExecutiveReportBrand) {
  const sub = [brand.ruc ? `RUC ${brand.ruc}` : 'ERP / EnterpriseCloud', brand.address].filter(Boolean).join(' · ')
  return `<div class="brand"><div class="logo-box">${brand.logoUrl ? `<img src="${escape(brand.logoUrl)}" alt="Logotipo de la empresa"/>` : '<span class="logo-monogram">EC</span>'}</div><div><div class="brand-name">${escape(brand.name)}</div><div class="brand-sub">${escape(sub)}</div></div></div>`
}

function footer(brand: ExecutiveReportBrand, report: ExecutiveReport, page: number, pageCount: number) {
  return `<div class="footer-space"></div><footer class="report-footer"><div class="footer-left">EnterpriseCloud · Información empresarial desde Supabase${brand.author ? ` · Preparado por ${escape(brand.author)}` : ''}<br/>${escape(brand.periodLabel)} · Fuentes: ${escape(report.sources.join(', '))}</div><div class="page-number">${String(page).padStart(2, '0')} / ${String(pageCount).padStart(2, '0')}</div></footer>`
}

function paginateSales(sales: ExecutiveReport['sales']) {
  const pages: ExecutiveReport['sales'][] = []
  let current: ExecutiveReport['sales'] = []
  let rowHeight = 0
  for (const sale of sales) {
    const lines = Math.max(1,
      Math.ceil((sale.relatedName || sale.name).length / 44),
      Math.ceil(sale.detail.length / 48),
      Math.ceil((sale.medio || 'Sin registrar').length / 20),
    )
    const estimatedHeight = 22 + lines * 15
    if (current.length && (current.length >= SALES_PER_PAGE || rowHeight + estimatedHeight > 420)) {
      pages.push(current)
      current = []
      rowHeight = 0
    }
    current.push(sale)
    rowHeight += estimatedHeight
  }
  if (current.length) pages.push(current)
  return pages
}

/** HTML autocontenido: SVG vectorial, tipografía local y hojas A4 horizontales. */
export function renderExecutiveReport(report: ExecutiveReport, brand: ExecutiveReportBrand): string {
  const chunks = paginateSales(report.sales)
  const pageCount = 1 + chunks.length
  const issued = new Date(report.generatedAt).toLocaleString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  const completed = report.statuses[0]
  const balance = report.operationBalance
  const pulse = `<div class="pulse-grid"><div><small>Cuentas por cobrar</small><strong>${report.finance ? money(report.finance.receivable) : 'No disponible'}</strong></div><div><small>Cuentas por pagar</small><strong>${report.finance ? money(report.finance.payable) : 'No disponible'}</strong></div><div><small>Unidades en inventario</small><strong>${report.inventory ? number(report.inventory.units) : 'No disponible'}</strong></div><div class="${report.inventory?.alerts.length ? 'attention' : ''}"><small>Alertas de stock</small><strong>${report.inventory ? `${report.inventory.alerts.length} / ${report.inventory.count} productos` : 'No disponible'}</strong></div></div>`
  const insights = report.sales.length
    ? [`${report.sales.length} ventas registradas por ${money(report.salesTotal)}; ticket promedio de ${money(report.averageTicket)}.`,
      ...(report.customers[0] ? [`El principal cliente representa el ${number(report.customers[0].share)}% del importe vendido.`] : []),
      ...(report.overdueCount ? [`${report.overdueCount} cuentas vencidas por ${money(report.overdueAmount)} al corte actual.`] : []),
    ]
    : ['No hay ventas registradas para el período seleccionado.']
  const sourceNotes = brand.dataNotes?.length ? ` Fuentes no disponibles: ${brand.dataNotes.join('; ')}.` : ''

  const dashboard = `<section class="report-sheet dashboard-sheet" aria-label="Dashboard ejecutivo">
    <header class="masthead"><div class="brand-row">${brandMark(brand)}<div class="edition">Inteligencia de negocio<strong>Reporte de gestión</strong></div></div><div class="title-row"><div><h1>Dashboard ejecutivo</h1><p>Visión integrada · Actividad comercial y pulso operativo</p></div><div class="period"><small>Período de análisis</small>${escape(brand.periodLabel)}</div></div></header>
    <div class="kpi-grid">
      <article class="kpi"><div class="kpi-label">Ventas registradas</div><strong class="kpi-value">${money(report.salesTotal)}</strong><div class="kpi-detail">${report.sales.length} operaciones${report.salesChange === null ? '' : ` · <span class="${report.salesChange < 0 ? 'negative' : 'positive'}">${report.salesChange > 0 ? '+' : ''}${number(report.salesChange)}% vs período anterior</span>`}</div></article>
      <article class="kpi gold"><div class="kpi-label">Compras registradas</div><strong class="kpi-value">${report.purchasesTotal === null ? '—' : money(report.purchasesTotal)}</strong><div class="kpi-detail">${report.purchasesCount === null ? 'Fuente no disponible' : `${report.purchasesCount} órdenes · subtotal sin IGV`}</div></article>
      <article class="kpi navy"><div class="kpi-label">Balance de operaciones</div><strong class="kpi-value ${balance !== null && balance < 0 ? 'negative' : ''}">${balance === null ? '—' : money(balance)}</strong><div class="kpi-detail">Ventas menos compras registradas</div></article>
      <article class="kpi violet"><div class="kpi-label">Ticket promedio</div><strong class="kpi-value">${money(report.averageTicket)}</strong><div class="kpi-detail">Importe por venta en el período</div></article>
    </div>
    <div class="analytics-grid">
      <article class="panel"><div class="panel-heading"><div><h2>Evolución comercial</h2><p class="caption">Actividad del período · ventas y abastecimiento</p></div><div class="legend"><span><i class="dot"></i>Ventas</span>${report.purchasesTotal === null ? '' : '<span><i class="dot" style="--dot:#b27c28"></i>Compras</span>'}</div></div>${trendChart(report)}</article>
      <article class="panel"><div class="panel-heading"><div><h2>Estado de ventas</h2><p class="caption">Distribución del importe registrado</p></div><span class="section-no">01</span></div>${salesStatus(report)}</article>
    </div>
    <div class="detail-grid">
      <article class="panel"><div class="panel-heading"><div><h2>Principales clientes</h2><p class="caption">Top 4 · contribución al importe vendido</p></div><span class="section-no">02</span></div>${ranking(report.customers, 4)}<p class="rank-note">${report.customers.length} clientes / contrapartes en el período.</p></article>
      <article class="panel"><div class="panel-heading"><div><h2>Medios de pago</h2><p class="caption">Distribución por importe de venta</p></div><span class="section-no">03</span></div>${ranking(report.paymentMethods, 4, true)}<p class="rank-note">Medio registrado en cada venta; sin datos = Sin registrar.</p></article>
      <article class="panel"><div class="panel-heading"><div><h2>Pulso operativo</h2><p class="caption">Inventario y finanzas · saldos actuales</p></div><span class="section-no">04</span></div>${pulse}<p class="rank-note">Corte ${escape(issued)} · America/Lima.</p></article>
    </div>
    <aside class="executive-insight"><strong>Lectura ejecutiva</strong><p>${escape(insights.join(' '))}</p></aside>
    <p class="caption" style="margin-top:7px;font-size:7px">Balance de operaciones = ventas menos compras; no representa utilidad neta. Ventas: total registrado. Compras: subtotal sin IGV.${escape(sourceNotes)}</p>
    ${footer(brand, report, 1, pageCount)}
  </section>`

  let exportedCount = 0
  const annex = chunks.map((sales, index) => {
    const start = exportedCount + 1
    exportedCount += sales.length
    const pageTotal = Math.round(sales.reduce((sum, sale) => sum + recordAmount(sale), 0) * 100) / 100
    const rows = sales.map(sale => {
      const badge = sale.status === 'Completada' || sale.status === 'Pagada' ? 'done' : sale.status === 'En curso' ? 'progress' : ''
      return `<tr><td><span class="ref">${escape(sale.id)}</span></td><td>${displayDate(sale.createdAt)}</td><td><strong>${escape(sale.relatedName || sale.name)}</strong></td><td class="sale-detail">${escape(sale.detail || '—')}</td><td>${escape(sale.medio || 'Sin registrar')}</td><td><span class="badge ${badge}">${escape(sale.status)}</span></td><td class="right"><strong>${money(recordAmount(sale))}</strong></td></tr>`
    }).join('')
    return `<section class="report-sheet annex-sheet" aria-label="Detalle de ventas, página ${index + 2}">
      <header class="annex-header">${brandMark(brand)}<div class="annex-total"><small>Ventas del período</small><strong>${money(report.salesTotal)}</strong></div></header>
      <div class="annex-title"><div><h2>Detalle de ventas</h2><p>${escape(brand.periodLabel)} · Fecha descendente y referencia · Registros ${start}–${exportedCount} de ${report.sales.length}</p></div><span class="badge done">${completed.count} completadas / ${report.sales.length} ventas</span></div>
      <table class="sales-table"><colgroup><col style="width:8%"/><col style="width:10%"/><col style="width:25%"/><col style="width:21%"/><col style="width:12%"/><col style="width:11%"/><col style="width:13%"/></colgroup><thead><tr><th>Referencia</th><th>Fecha</th><th>Cliente / contraparte</th><th>Comprobante / concepto</th><th>Medio de pago</th><th>Estado</th><th class="right">Importe (S/)</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="annex-subtotal"><span>Subtotal de esta página</span><strong>${money(pageTotal)}</strong></div>
      <aside class="annex-notes"><strong>Contexto del informe.</strong> Emitido ${escape(issued)}. Los importes de las ventas conservan los descuentos registrados y el IGV incluido. Los saldos de finanzas y las existencias corresponden al momento de emisión; el período seleccionado filtra ventas y compras.</aside>
      ${footer(brand, report, index + 2, pageCount)}
    </section>`
  }).join('')

  const printScript = `<script>
    document.getElementById('print-report').addEventListener('click', function(){window.print()});
    ${brand.autoPrint === false ? '' : `window.addEventListener('load', function(){
      var ready = Array.from(document.images).map(function(image){
        if(image.complete)return Promise.resolve();
        return new Promise(function(resolve){image.addEventListener('load',resolve,{once:true});image.addEventListener('error',resolve,{once:true})});
      });
      if(document.fonts)ready.push(document.fonts.ready);
      Promise.race([Promise.all(ready),new Promise(function(resolve){setTimeout(resolve,1800)})]).then(function(){requestAnimationFrame(function(){window.print()})});
    },{once:true});`}
  </script>`
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Dashboard ejecutivo · ${escape(brand.name)} · ${escape(brand.periodLabel)}</title><style>${reportStyles}</style></head><body><div class="preview-bar"><div><strong>Informe ejecutivo · ${escape(brand.name)}</strong><small>En el diálogo de impresión selecciona Guardar como PDF · A4 horizontal.</small></div><button id="print-report" type="button">Imprimir / Guardar PDF</button></div><main>${dashboard}${annex}</main>${printScript}</body></html>`
}
