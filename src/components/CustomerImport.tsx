import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Download, FileUp, X } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useRecords } from '../context/RecordsContext'
import { useTheme } from '../context/ThemeContext'
import { downloadCsv } from '../data/exports'
import { friendlyError, importCustomers } from '../services/records'
import { CUSTOMER_CSV_EXAMPLE, CUSTOMER_CSV_HEADER, parseCustomersCsv, type CustomerImportParse, type CustomerImportReport } from '../services/import'
import { useDialog } from './useDialog'

/** Icono de Google (Material Symbols Outlined). */
function GoogleIcon({ name, className = '' }: { name: string; className?: string }) {
  return (
    <span className={`gicon${className ? ` ${className}` : ''}`} aria-hidden="true">
      {name}
    </span>
  )
}

/**
 * Importación masiva de clientes desde un dataset CSV.
 * Muestra vista previa con validación fila por fila y un reporte final
 * con creados, omitidos y fallidos. Nada se guarda hasta confirmar.
 */
export default function CustomerImport() {
  const { can } = useAuth()
  const { reload, notify } = useRecords()
  const { theme } = useTheme()
  const [open, setOpen] = useState(false)
  const [fileName, setFileName] = useState('')
  const [preview, setPreview] = useState<CustomerImportParse | null>(null)
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<CustomerImportReport | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const dialogRef = useDialog<HTMLDivElement>(() => { if (!busy) setOpen(false) }, busy)

  if (!can('customers', 'importar')) return null

  const close = () => {
    if (busy) return
    setOpen(false)
    setPreview(null)
    setReport(null)
    setFileName('')
  }

  const downloadTemplate = () => {
    downloadCsv('plantilla-clientes.csv', CUSTOMER_CSV_HEADER, [CUSTOMER_CSV_EXAMPLE])
    notify('Plantilla de importación descargada.')
  }

  const chooseFile = async (file: File | undefined) => {
    if (!file || busy) return
    setReport(null)
    setFileName(file.name)
    try {
      setPreview(parseCustomersCsv(await file.text()))
    } catch {
      setPreview({ rows: [], errors: ['No se pudo leer el archivo. Usa un CSV con codificación UTF-8.'] })
    }
    if (fileRef.current) fileRef.current.value = ''
  }

  const confirm = async () => {
    if (!can('customers', 'importar') || !preview || !preview.rows.length || busy) return
    setBusy(true)
    try {
      const result = await importCustomers(preview.rows)
      setReport(result)
      setPreview(null)
      await reload()
      const parts = [`${result.created} ${result.created === 1 ? 'cliente creado' : 'clientes creados'}`]
      if (result.omitted.length) parts.push(`${result.omitted.length} ${result.omitted.length === 1 ? 'omitido' : 'omitidos'}`)
      if (result.failed.length) parts.push(`${result.failed.length} con error`)
      notify(`Importación lista: ${parts.join(', ')}.`)
    } catch (error) {
      notify(friendlyError(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button className="export-button" type="button" onClick={() => setOpen(true)} title="Importar clientes desde un dataset CSV">
        <FileUp size={15} /> Importar CSV
      </button>
      {open && createPortal(
        <div className="erp-shell workspace-shell" data-theme={theme}>
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => !busy && event.target === event.currentTarget && close()}>
          <div ref={dialogRef} className="ws-dialog" role="dialog" aria-modal="true" aria-label="Importar clientes desde CSV">
            <div className="modal-heading">
              <div>
                <span className="section-kicker"><i /> CARGA MASIVA</span>
                <h2>Importar clientes</h2>
                <p>Carga un dataset de clientes desde un archivo CSV. Se valida todo antes de guardar.</p>
              </div>
              <button className="modal-close" type="button" disabled={busy} aria-label="Cerrar importación" onClick={close}><X size={17} /></button>
            </div>
            <div className="ws-form">
              <div className="ws-import-actions">
                <button className="ws-button ws-button-secondary" type="button" disabled={busy} onClick={() => fileRef.current?.click()}>
                  <GoogleIcon name="upload_file" /> {fileName || 'Seleccionar archivo CSV'}
                </button>
                <button className="ws-text-button" type="button" disabled={busy} onClick={downloadTemplate}>
                  <Download size={14} /> Descargar plantilla
                </button>
                <input ref={fileRef} type="file" accept=".csv,text/csv" hidden aria-label="Archivo CSV de clientes" onChange={(event) => void chooseFile(event.target.files?.[0])} />
              </div>
              <p className="relation-hint">
                <GoogleIcon name="info" className="small" />
                Columnas: tipo_doc, documento, razon_social, detalle, linea_credito, estado.
                El documento es un DNI (8 dígitos) o un RUC (11 dígitos); si falta tipo_doc se deduce por su longitud.
              </p>
              {preview && (
                <section className="ws-import-preview" aria-live="polite">
                  <div className="ws-import-summary">
                    <span className="ws-badge green">{preview.rows.length} {preview.rows.length === 1 ? 'listo' : 'listos'}</span>
                    {preview.errors.length > 0 && <span className="ws-badge amber">{preview.errors.length} {preview.errors.length === 1 ? 'observación' : 'observaciones'}</span>}
                  </div>
                  {preview.rows.slice(0, 4).map((row) => (
                    <div key={row.documento} className="ws-import-row">
                      <strong>{row.razonSocial}</strong>
                      <small>{row.tipoDoc} {row.documento} · Línea de crédito S/ {row.lineaCredito.toFixed(2)}</small>
                    </div>
                  ))}
                  {preview.rows.length > 4 && <small className="relation-hint">…y {preview.rows.length - 4} más en el archivo.</small>}
                  {preview.errors.slice(0, 8).map((issue, index) => (
                    <p key={index} className="ws-notice ws-notice-warning ws-import-issue" role="alert">{issue}</p>
                  ))}
                  {preview.errors.length > 8 && <small className="relation-hint">…y {preview.errors.length - 8} observaciones más.</small>}
                </section>
              )}
              {report && (
                <section className="ws-import-preview" aria-live="polite">
                  <div className="ws-import-summary">
                    <span className="ws-badge green">{report.created} {report.created === 1 ? 'creado' : 'creados'}</span>
                    {(report.omitted.length + report.failed.length) > 0 && (
                      <span className="ws-badge amber">con observaciones</span>
                    )}
                  </div>
                  <p className="relation-hint linked"><GoogleIcon name="check_circle" className="small" />Se {report.created === 1 ? 'creó' : 'crearon'} {report.created} {report.created === 1 ? 'cliente' : 'clientes'}.</p>
                  {[...report.omitted.map((item) => `${item.documento}: ${item.reason}`),
                    ...report.failed.map((item) => `${item.documento}: ${item.reason}`)].slice(0, 8).map((issue, index) => (
                    <p key={index} className="ws-notice ws-notice-warning ws-import-issue" role="alert">{issue}</p>
                  ))}
                </section>
              )}
              <div className="ws-heading-actions">
                <button className="ws-button ws-button-secondary" type="button" disabled={busy} onClick={close}>Cerrar</button>
                {!report && (
                  <button className="ws-button" type="button" disabled={busy || !preview || !preview.rows.length} onClick={() => void confirm()}>
                    {busy ? 'Importando…' : `Confirmar importación (${preview?.rows.length ?? 0})`}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
        </div>,
        document.body,
      )}
    </>
  )
}
