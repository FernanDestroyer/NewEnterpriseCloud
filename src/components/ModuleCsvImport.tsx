import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Download, FileUp, X } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useRecords } from '../context/RecordsContext'
import { useTheme } from '../context/ThemeContext'
import { downloadCsv } from '../data/exports'
import { friendlyError } from '../services/records'
import { CUSTOMER_CSV_EXAMPLE, CUSTOMER_CSV_HEADER, PURCHASES_CSV_EXAMPLE, PURCHASES_CSV_HEADER, SALES_CSV_EXAMPLE, SALES_CSV_HEADER, parseCustomersCsv, parsePurchasesCsv, parseSalesCsv, type CustomerImportRow, type PurchaseImportRow, type SalesImportRow, type SimpleImportParse } from '../services/import'
import { importCustomers, importPurchases, importSales, type ModuleImportReport } from '../services/records'
import type { DataPage } from '../types'
import { useDialog } from './useDialog'

type ImportRow = CustomerImportRow | SalesImportRow | PurchaseImportRow
type ImportParse = SimpleImportParse<ImportRow>
type ImportPage = Extract<DataPage, 'customers' | 'sales' | 'purchases'>

const CONFIG = {
  customers: { title: 'clientes', heading: 'Importar clientes', template: 'plantilla-clientes.csv', columns: CUSTOMER_CSV_HEADER, example: CUSTOMER_CSV_EXAMPLE, note: 'Columnas: razon_social, tipo_doc, documento, detalle, linea_credito, estado.' },
  sales: { title: 'ventas', heading: 'Importar ventas', template: 'plantilla-ventas.csv', columns: SALES_CSV_HEADER, example: SALES_CSV_EXAMPLE, note: 'Una fila por venta. Monto en soles; no incluye líneas de productos.' },
  purchases: { title: 'compras', heading: 'Importar compras', template: 'plantilla-compras.csv', columns: PURCHASES_CSV_HEADER, example: PURCHASES_CSV_EXAMPLE, note: 'Una fila por compra. Monto como subtotal sin IGV; no incluye productos ni movimientos de inventario.' },
} satisfies Record<ImportPage, { title: string; heading: string; template: string; columns: string[]; example: string[]; note: string }>

function parse(page: ImportPage, text: string): ImportParse {
  if (page === 'customers') return parseCustomersCsv(text) as ImportParse
  if (page === 'sales') return parseSalesCsv(text) as ImportParse
  return parsePurchasesCsv(text) as ImportParse
}

function template(page: ImportPage) {
  const config = CONFIG[page]
  downloadCsv(config.template, config.columns, [config.example])
}

function previewLabel(row: ImportRow) {
  if ('razonSocial' in row) return { primary: row.razonSocial, secondary: row.documento ? `${row.tipoDoc} ${row.documento}` : `Línea ${row.line}` }
  if ('clienteNombre' in row) return { primary: row.codigo, secondary: `${row.clienteNombre} · S/ ${row.monto.toFixed(2)}` }
  return { primary: row.codigo, secondary: `${row.proveedorNombre} · S/ ${row.monto.toFixed(2)}` }
}

export default function ModuleCsvImport({ page }: { page: ImportPage }) {
  const { can } = useAuth()
  const { reload, notify } = useRecords()
  const { theme } = useTheme()
  const [open, setOpen] = useState(false)
  const [fileName, setFileName] = useState('')
  const [preview, setPreview] = useState<ImportParse | null>(null)
  const [report, setReport] = useState<ModuleImportReport | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const dialogRef = useDialog<HTMLDivElement>(() => { if (!busy) setOpen(false) }, busy)
  const config = CONFIG[page]

  if (!can(page, 'importar')) return null

  const close = () => {
    if (busy) return
    setOpen(false); setPreview(null); setReport(null); setFileName('')
  }
  const chooseFile = async (file?: File) => {
    if (!file || busy) return
    setFileName(file.name); setReport(null)
    if (file.size > 2 * 1024 * 1024) {
      setPreview({ rows: [], errors: ['El archivo supera el límite de 2 MB.'] })
    } else {
      try { setPreview(parse(page, await file.text())) }
      catch { setPreview({ rows: [], errors: ['No se pudo leer el archivo. Usa formato CSV con codificación UTF-8.'] }) }
    }
    if (fileRef.current) fileRef.current.value = ''
  }
  const confirm = async () => {
    if (!can(page, 'importar') || !preview?.rows.length || busy) return
    setBusy(true)
    try {
      const result = page === 'customers'
        ? await importCustomers(preview.rows as CustomerImportRow[])
        : page === 'sales'
          ? await importSales(preview.rows as SalesImportRow[])
          : await importPurchases(preview.rows as PurchaseImportRow[])
      setReport(result); setPreview(null)
      await reload()
      notify(`Importación de ${config.title}: ${result.created} creados, ${result.skipped.length} omitidos y ${result.failed.length} fallidos.`)
    } catch (error) { notify(friendlyError(error)) }
    finally { setBusy(false) }
  }
  const issues = preview?.errors ?? []

  return <>
    <button className="export-button" type="button" onClick={() => setOpen(true)} title={`Importar ${config.title} desde CSV`}><FileUp size={15} />Importar CSV</button>
    {open && createPortal(<div className="erp-shell workspace-shell" data-theme={theme}>
      <div className="modal-backdrop" role="presentation" onMouseDown={event => !busy && event.target === event.currentTarget && close()}>
        <div ref={dialogRef} className="ws-dialog module-import-dialog" role="dialog" aria-modal="true" aria-label={config.heading}>
          <div className="modal-heading"><div><span className="section-kicker"><i /> CARGA MASIVA</span><h2>{config.heading}</h2><p>Revisa una vista previa antes de guardar. El archivo puede pesar hasta 2 MB.</p></div><button className="modal-close" type="button" disabled={busy} aria-label="Cerrar importación" onClick={close}><X size={17} /></button></div>
          <div className="ws-form">
            <div className="ws-import-actions"><button className="ws-button ws-button-secondary" type="button" disabled={busy} onClick={() => fileRef.current?.click()}><FileUp size={15} />{fileName || 'Seleccionar archivo CSV'}</button><button className="ws-text-button" type="button" disabled={busy} onClick={() => template(page)}><Download size={14} />Descargar plantilla</button><input ref={fileRef} type="file" accept=".csv,text/csv" hidden aria-label={`Archivo CSV de ${config.title}`} onChange={event => void chooseFile(event.target.files?.[0])} /></div>
            <p className="relation-hint">{config.note}</p>
            {preview && <section className="ws-import-preview" aria-live="polite"><div className="ws-import-summary"><span className="ws-badge green">{preview.rows.length} válidos</span>{issues.length > 0 && <span className="ws-badge amber">{issues.length} observaciones</span>}</div>{preview.rows.slice(0, 5).map(row => { const label = previewLabel(row); return <div key={`${row.line}-${label.primary}`} className="ws-import-row"><strong>{label.primary}</strong><small>{label.secondary}</small></div> })}{preview.rows.length > 5 && <small className="relation-hint">…y {preview.rows.length - 5} más.</small>}{issues.slice(0, 8).map((issue, index) => <p key={index} className="ws-notice ws-notice-warning ws-import-issue" role="alert">{issue}</p>)}</section>}
            {report && <section className="ws-import-preview" aria-live="polite"><div className="ws-import-summary"><span className="ws-badge green">{report.created} creados</span>{report.skipped.length > 0 && <span className="ws-badge amber">{report.skipped.length} omitidos</span>}{report.failed.length > 0 && <span className="ws-badge amber">{report.failed.length} fallidos</span>}</div>{[...report.skipped, ...report.failed].slice(0, 10).map((issue, index) => <p key={`${issue.line}-${index}`} className="ws-notice ws-notice-warning ws-import-issue" role="status">Línea {issue.line} · {issue.reference}: {issue.reason}</p>)}</section>}
            <div className="ws-heading-actions"><button className="ws-button ws-button-secondary" type="button" disabled={busy} onClick={close}>Cerrar</button>{!report && <button className="ws-button" type="button" disabled={busy || !preview?.rows.length} onClick={() => void confirm()}>{busy ? 'Importando…' : `Confirmar importación (${preview?.rows.length ?? 0})`}</button>}</div>
          </div>
        </div>
      </div>
    </div>, document.body)}
  </>
}
