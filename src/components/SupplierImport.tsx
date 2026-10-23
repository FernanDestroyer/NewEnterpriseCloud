import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Download, FileUp, X } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useRecords } from '../context/RecordsContext'
import { useTheme } from '../context/ThemeContext'
import { downloadCsv } from '../data/exports'
import { friendlyError, importSuppliersWithProducts } from '../services/records'
import { parseSuppliersCsv, SUPPLIER_CSV_EXAMPLE, SUPPLIER_CSV_HEADER, type SupplierImportParse, type SupplierImportReport } from '../services/import'
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
 * Importación masiva de proveedores con sus productos desde un CSV.
 * Muestra vista previa con validación fila por fila y un reporte final
 * con creados, omitidos y fallidos. Nada se guarda hasta confirmar.
 */
export default function SupplierImport() {
  const { can } = useAuth()
  const { reload, notify } = useRecords()
  const { theme } = useTheme()
  const [open, setOpen] = useState(false)
  const [fileName, setFileName] = useState('')
  const [preview, setPreview] = useState<SupplierImportParse | null>(null)
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<SupplierImportReport | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const dialogRef = useDialog<HTMLDivElement>(() => { if (!busy) setOpen(false) }, busy)

  if (!can('suppliers', 'importar')) return null

  const close = () => {
    if (busy) return
    setOpen(false)
    setPreview(null)
    setReport(null)
    setFileName('')
  }

  const downloadTemplate = () => {
    downloadCsv('plantilla-proveedores.csv', SUPPLIER_CSV_HEADER, [SUPPLIER_CSV_EXAMPLE])
    notify('Plantilla de importación descargada.')
  }

  const chooseFile = async (file: File | undefined) => {
    if (!file || busy) return
    setReport(null)
    setFileName(file.name)
    try {
      setPreview(parseSuppliersCsv(await file.text()))
    } catch {
      setPreview({ rows: [], errors: ['No se pudo leer el archivo. Usa un CSV con codificación UTF-8.'], productIssues: [] })
    }
    if (fileRef.current) fileRef.current.value = ''
  }

  const confirm = async () => {
    if (!can('suppliers', 'importar') || !preview || !preview.rows.length || busy) return
    setBusy(true)
    try {
      const result = await importSuppliersWithProducts(preview.rows)
      setReport(result)
      setPreview(null)
      await reload()
      const parts = [`${result.created} ${result.created === 1 ? 'proveedor creado' : 'proveedores creados'}`]
      if (result.updated) parts.push(`${result.updated} ${result.updated === 1 ? 'actualizado' : 'actualizados'}`)
      parts.push(`${result.products} ${result.products === 1 ? 'producto' : 'productos'}`)
      notify(`Importación lista: ${parts.join(', ')}.`)
    } catch (error) {
      notify(friendlyError(error))
    } finally {
      setBusy(false)
    }
  }

  const totalIssues = (preview?.errors.length ?? 0) + (preview?.productIssues.length ?? 0)

  return (
    <>
      <button className="export-button" type="button" onClick={() => setOpen(true)} title="Importar proveedores con sus productos desde un CSV">
        <FileUp size={15} /> Importar CSV
      </button>
      {open && createPortal(
        <div className="erp-shell workspace-shell" data-theme={theme}>
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => !busy && event.target === event.currentTarget && close()}>
          <div ref={dialogRef} className="ws-dialog" role="dialog" aria-modal="true" aria-label="Importar proveedores desde CSV">
            <div className="modal-heading">
              <div>
                <span className="section-kicker"><i /> CARGA MASIVA</span>
                <h2>Importar proveedores</h2>
                <p>Proveedores con los productos que ofrecen, desde un archivo CSV. Se valida todo antes de guardar.</p>
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
                <input ref={fileRef} type="file" accept=".csv,text/csv" hidden aria-label="Archivo CSV de proveedores" onChange={(event) => void chooseFile(event.target.files?.[0])} />
              </div>
              <p className="relation-hint">
                <GoogleIcon name="info" className="small" />
                Columnas: ruc, razon_social, direccion, correo, telefono, forma_pago, estado, productos.
                Los productos van como "nombre | costo | detalle" separados por //.
              </p>
              {preview && (
                <section className="ws-import-preview" aria-live="polite">
                  <div className="ws-import-summary">
                    <span className="ws-badge green">{preview.rows.length} {preview.rows.length === 1 ? 'listo' : 'listos'}</span>
                    {totalIssues > 0 && <span className="ws-badge amber">{totalIssues} {totalIssues === 1 ? 'observación' : 'observaciones'}</span>}
                    <span className="ws-import-products">{preview.rows.reduce((sum, row) => sum + row.productos.length, 0)} productos en total</span>
                  </div>
                  {preview.rows.slice(0, 4).map((row) => (
                    <div key={row.ruc} className="ws-import-row">
                      <strong>{row.razonSocial}</strong>
                      <small>RUC {row.ruc} · {row.productos.length} {row.productos.length === 1 ? 'producto' : 'productos'}</small>
                    </div>
                  ))}
                  {preview.rows.length > 4 && <small className="relation-hint">…y {preview.rows.length - 4} más en el archivo.</small>}
                  {[...preview.errors, ...preview.productIssues].slice(0, 8).map((issue, index) => (
                    <p key={index} className="ws-notice ws-notice-warning ws-import-issue" role="alert">{issue}</p>
                  ))}
                </section>
              )}
              {report && (
                <section className="ws-import-preview" aria-live="polite">
                  <div className="ws-import-summary">
                    <span className="ws-badge green">{report.created} {report.created === 1 ? 'creado' : 'creados'}</span>
                    {(report.updated ?? 0) > 0 && <span className="ws-badge green">{report.updated} {report.updated === 1 ? 'actualizado' : 'actualizados'}</span>}
                    <span className="ws-badge green">{report.products} {report.products === 1 ? 'producto' : 'productos'}</span>
                    {(report.omitted.length + report.failed.length + report.skippedProducts.length) > 0 && (
                      <span className="ws-badge amber">con observaciones</span>
                    )}
                  </div>
                  <p className="relation-hint linked"><GoogleIcon name="check_circle" className="small" />Se crearon {report.created} {report.created === 1 ? 'proveedor' : 'proveedores'}{report.updated ? ` y se actualizaron ${report.updated}` : ''} con {report.products} {report.products === 1 ? 'producto' : 'productos'} en sus catálogos.</p>
                  {[...report.omitted.map((item) => `${item.ruc}: ${item.reason}`),
                    ...report.failed.map((item) => `${item.ruc}: ${item.reason}`),
                    ...report.skippedProducts.map((item) => `${item.proveedor} · ${item.producto}: ${item.reason}`)].slice(0, 8).map((issue, index) => (
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
