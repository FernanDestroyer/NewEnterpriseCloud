import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { moneyCurrency, statusTone } from '../data/helpers'
import { useRecords } from '../context/RecordsContext'
import { fetchDocumentLines, friendlyError, updatePurchaseWithLines } from '../services/records'
import VoucherModal from './VoucherModal'
import type { DocumentLine, RecordItem, RecordStatus } from '../types'
import { useAuth } from '../context/AuthContext'
import { fetchPurchaseCloseSummary, type PurchaseCloseSummary } from '../services/purchaseReceipts'
import SupplierOrderEvaluationPanel from './SupplierOrderEvaluationPanel'
import SupplierEvaluationRating from './SupplierEvaluationRating'

/** Icono de Google (Material Symbols Outlined). */
function GoogleIcon({ name, className = '' }: { name: string; className?: string }) {
  return (
    <span className={`gicon${className ? ` ${className}` : ''}`} aria-hidden="true">
      {name}
    </span>
  )
}

const COMPROBANTES = ['Factura', 'Boleta', 'Guía de Remisión', 'Nota de Venta']

function formatLimite(value?: string | null) {
  if (!value) return 'Sin fecha límite'
  const date = new Date(`${value}T12:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('es-PE', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function PurchaseOrderDetail({ order, onBack }: { order: RecordItem; onBack: () => void }) {
  const { records, catalog, reload, notify } = useRecords()
  const { can } = useAuth()
  const navigate = useNavigate()
  const supplier = order.proveedor_id ? records.suppliers.find((item) => item.rowId === order.proveedor_id) : undefined
  const requiereRecepcion = order.requiereRecepcion !== false
  const supplierOffers = supplier?.rowId ? catalog.filter((item) => item.proveedor_id === supplier.rowId).length : 0
  const [lines, setLines] = useState<DocumentLine[]>([])
  const [loadingLines, setLoadingLines] = useState(true)
  const [lineError, setLineError] = useState('')
  const [busy, setBusy] = useState(false)
  const [fecha, setFecha] = useState(order.fechaLimite ?? '')
  const [compTipo, setCompTipo] = useState(order.comprobanteTipo ?? 'Factura')
  const [compNum, setCompNum] = useState(order.comprobanteNumero ?? '')
  const [showVoucher, setShowVoucher] = useState(false)
  const [closeSummary, setCloseSummary] = useState<PurchaseCloseSummary | null>(null)
  const [closeSummaryLoading, setCloseSummaryLoading] = useState(false)
  const [closeSummaryError, setCloseSummaryError] = useState('')
  const lineRequest = useRef(0)

  useEffect(() => {
    setFecha(order.fechaLimite ?? '')
    setCompTipo(order.comprobanteTipo ?? 'Factura')
    setCompNum(order.comprobanteNumero ?? '')
  }, [order.id, order.fechaLimite, order.comprobanteTipo, order.comprobanteNumero])

  const loadLines = useCallback(async () => {
    const request = ++lineRequest.current
    if (!order.rowId) {
      setLines([])
      setLoadingLines(false)
      return
    }
    setLoadingLines(true)
    setLineError('')
    setLines([])
    try {
      const result = await fetchDocumentLines('purchases', order.rowId)
      if (request === lineRequest.current) setLines(result)
    } catch (error) {
      if (request === lineRequest.current) {
        setLineError(friendlyError(error))
        notify(friendlyError(error))
      }
    } finally {
      if (request === lineRequest.current) setLoadingLines(false)
    }
  }, [order.rowId, notify])

  useEffect(() => {
    void loadLines()
    return () => { lineRequest.current++ }
  }, [loadLines])

  useEffect(() => {
    let active = true
    if (!order.rowId) return
    setCloseSummaryLoading(true); setCloseSummaryError('')
    fetchPurchaseCloseSummary(order.rowId)
      .then(result => { if (active) setCloseSummary(result) })
      .catch(error => { if (active) setCloseSummaryError(friendlyError(error)) })
      .finally(() => { if (active) setCloseSummaryLoading(false) })
    return () => { active = false }
  }, [order.rowId, order.updatedAt])

  const currency = order.moneda ?? 'PEN'
  const fiscalComplete = lines.length > 0 && lines.every(line => line.taxTreatment && line.taxBase != null && line.taxAmount != null && line.lineTotal != null)
  const base = fiscalComplete ? lines.reduce((sum, line) => sum + (line.taxBase ?? 0), 0) : null
  const tax = fiscalComplete ? lines.reduce((sum, line) => sum + (line.taxAmount ?? 0), 0) : null
  const total = fiscalComplete ? lines.reduce((sum, line) => sum + (line.lineTotal ?? 0), 0) : order.amount ?? 0

  // La fase se cambia desde "Editar": este detalle solo guarda fecha y comprobante.
  const persist = async (nextStatus: RecordStatus) => {
    if (busy || loadingLines || lineError || !can('purchases', 'editar')) return
    if (nextStatus === 'Pagada' && !can('finance', 'editar')) return notify('Tu rol necesita permiso de editar finanzas para registrar el pago de la compra.')
    setBusy(true)
    try {
      await updatePurchaseWithLines(order.id, {
        name: order.name,
        detail: order.detail,
        status: nextStatus,
        proveedor_id: order.proveedor_id ?? null,
        fecha_limite: fecha || null,
        comprobante_tipo: compTipo || null,
        comprobante_numero: compNum.trim() || null,
      }, lines.map((line) => ({ detalle_compra_id: line.rowId, producto_id: line.producto_id, cantidad: line.cantidad, precio: line.precio, tratamiento_tributario: line.taxTreatment, tasa_tributaria: line.taxRate })), order.updatedAt)
      await reload()
      await loadLines()
      notify(nextStatus === order.status
        ? `Orden ${order.id} actualizada.`
        : `Orden ${order.id} avanzó a ${nextStatus}.`)
    } catch (error) {
      notify(friendlyError(error))
    } finally {
      setBusy(false)
    }
  }

  const supplierContact = supplier ? [supplier.direccion, supplier.telefono, supplier.correo].filter(Boolean).join(' · ') : ''

  return (
    <>
      <div className="po-topbar">
        <button className="text-button" type="button" onClick={onBack}><GoogleIcon name="arrow_back" className="small" /> Volver a compras</button>
        <span style={{ display: 'inline-flex', gap: '8px', alignItems: 'center' }}>
          <button className="export-button" type="button" onClick={() => setShowVoucher(true)}><GoogleIcon name="receipt_long" className="small" /> Ver comprobante</button>
          <span className={`status-pill ${statusTone(order.status)}`}>{order.status}</span>
        </span>
      </div>
      {showVoucher && <VoucherModal page="purchases" record={order} onClose={() => setShowVoucher(false)} />}

      <section className="po-head panel">
        <div>
          <span className="panel-label">ORDEN DE COMPRA · {order.id}</span>
          <h2>{order.name}</h2>
          <p>{order.detail}</p>
        </div>
        <div className="po-head-meta">
          <span><GoogleIcon name="event" className="small" /> Límite: {formatLimite(order.fechaLimite)}</span>
          <span><GoogleIcon name="receipt_long" className="small" /> {order.comprobanteTipo ? `${order.comprobanteTipo}${order.comprobanteNumero ? ` ${order.comprobanteNumero}` : ''}` : 'Sin comprobante'}</span>
        </div>
      </section>

      <section className="po-supplier panel">
        <div>
          <span className="panel-label">EMPRESA PROVEEDORA · VERIFICACIÓN</span>
          {supplier ? (
            <>
              <h2>{supplier.name}</h2>
              <p>RUC {supplier.ruc ?? 'Sin RUC registrado'}{supplier.detail ? ` · ${supplier.detail}` : ''}</p>
              {supplierContact && <p>{supplierContact}</p>}
              {supplier.formaPago && <p>Condición de pago: {supplier.formaPago}</p>}
              <span className="linked-badge"><GoogleIcon name="verified" className="small" /> Proveedor registrado · {supplierOffers} {supplierOffers === 1 ? 'producto en catálogo' : 'productos en catálogo'}</span>
              {supplier.rowId && <SupplierEvaluationRating proveedorId={supplier.rowId} />}
            </>
          ) : (
            <>
              <h2>{order.name}</h2>
              <span className="linked-badge muted"><GoogleIcon name="warning" className="small" /> Sin vincular: verifica el RUC de la empresa y vincúlalo editando la compra.</span>
            </>
          )}
        </div>
        {supplier && (
          <button
            className="export-button"
            type="button"
            onClick={() => navigate(`/suppliers?q=${encodeURIComponent(supplier.ruc ?? supplier.name)}`)}
          >
            <GoogleIcon name="open_in_new" className="small" /> Abrir ficha
          </button>
        )}
      </section>

      {order.rowId && <SupplierOrderEvaluationPanel
        compraId={order.rowId}
        proveedorId={order.proveedor_id ?? null}
        estadoRecepcion={order.estadoRecepcion}
        requiereRecepcion={requiereRecepcion}
      />}

      <section className="po-close-summary panel" aria-labelledby="purchase-close-summary-title">
        <div className="table-header"><div><span className="panel-label">RECEPCIONES Y TESORERÍA · FUENTES INDEPENDIENTES</span><h2 id="purchase-close-summary-title">Resumen de cierre</h2></div></div>
        {closeSummaryError && <div className="ws-notice ws-notice-warning" role="alert">{closeSummaryError}</div>}
        {closeSummaryLoading ? <p>Consultando recepción neta y pagos…</p> : closeSummary && <>
          <div className="po-close-metrics"><div><small>Recibido bruto</small><strong>{closeSummary.recibido_bruto}</strong></div><div><small>Devuelto</small><strong>{closeSummary.devuelto}</strong></div><div><small>Neto recibido</small><strong>{closeSummary.neto_recibido}</strong></div></div>
          <div className="table-scroll"><table className="record-table"><thead><tr><th>CUENTA CxP · TESORERÍA</th><th>MONTO ORIGINAL</th><th>APLICADO</th><th>SALDO PENDIENTE</th><th>ESTADO</th></tr></thead><tbody>
            {!closeSummary.financiera_visible ? <tr><td colSpan={5}>Resumen financiero oculto: requiere permiso de lectura de Finanzas/Tesorería. El resumen de recepción es independiente.</td></tr> : closeSummary.pagos.length ? closeSummary.pagos.map(payment => <tr key={payment.cuenta_id}><td>{payment.codigo}</td><td>{moneyCurrency(payment.monto_original, payment.moneda === 'USD' ? 'USD' : 'PEN')}</td><td>{moneyCurrency(payment.monto_aplicado, payment.moneda === 'USD' ? 'USD' : 'PEN')}</td><td><strong>{moneyCurrency(payment.saldo_pendiente, payment.moneda === 'USD' ? 'USD' : 'PEN')}</strong></td><td>{payment.estado}</td></tr>) : <tr><td colSpan={5}>Tesorería aún no registra cuentas por pagar para esta orden.</td></tr>}
          </tbody></table></div>
          <small>Las devoluciones cambian stock y neto recibido, pero no alteran esta cuenta. Los créditos se aplican manualmente desde Tesorería.</small>
        </>}
      </section>

      <section className="table-panel panel">
        <div className="table-header">
          <div><span className="panel-label">SOLICITUD DE COMPRA</span><h2>{requiereRecepcion ? 'Productos, cantidades e impuestos' : 'Servicio o gasto'}</h2></div>
        </div>
        <div className="po-datos">
          <label>Fecha límite o aproximada<input type="date" value={fecha} onChange={(event) => setFecha(event.target.value)} /></label>
          <label>Tipo de comprobante
            <select value={COMPROBANTES.includes(compTipo) ? compTipo : 'Factura'} onChange={(event) => setCompTipo(event.target.value)}>
              {COMPROBANTES.map((tipo) => <option key={tipo} value={tipo}>{tipo}</option>)}
            </select>
          </label>
          <label>Número de comprobante<input value={compNum} onChange={(event) => setCompNum(event.target.value)} placeholder="F001-0001" /></label>
          <button className="export-button" type="button" disabled={busy || loadingLines || Boolean(lineError) || !can('purchases', 'editar')} onClick={() => void persist(order.status)}><GoogleIcon name="save" className="small" /> Guardar datos</button>
        </div>
        {lineError && <div className="ws-notice ws-notice-warning" role="alert">{lineError}<button className="ws-text-button" onClick={() => void loadLines()}>Reintentar</button></div>}
        <div className="table-scroll">
          <table className="record-table">
            <thead><tr><th>PRODUCTO</th><th>CANT.</th><th>BASE UNIT.</th><th>IMPUESTO</th><th>TOTAL LÍNEA</th></tr></thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.producto_id}>
                  <td><strong>{line.nombre ?? line.producto_id}</strong><small>{line.codigo ?? ''}</small></td>
                  <td className="record-value">{line.cantidad}</td>
                  <td className="record-value">{moneyCurrency(line.precio, currency)}</td>
                  <td className="record-value">{line.taxTreatment ? `${line.taxTreatment} · ${moneyCurrency(line.taxAmount ?? 0, currency)}` : 'No informado (histórico)'}</td>
                  <td className="record-value">{line.lineTotal == null ? moneyCurrency(line.cantidad * line.precio, currency) : moneyCurrency(line.lineTotal, currency)}</td>
                </tr>
              ))}
              {!lines.length && <tr><td colSpan={5}><div className="empty-table"><GoogleIcon name={requiereRecepcion ? 'inventory_2' : 'receipt_long'} />{loadingLines ? <><strong>Cargando detalle…</strong></> : requiereRecepcion ? <><strong>Sin productos</strong><span>Edita la compra para agregar su catálogo.</span></> : <><strong>No requiere ingreso a almacén</strong><span>El importe corresponde a un servicio o gasto y no genera movimientos de inventario.</span></>}</div></td></tr>}
            </tbody>
          </table>
        </div>
        <div className="po-totals">
          <div className="lines-summary">
            <span className="lines-summary-title"><GoogleIcon name="receipt_long" className="small" /> Resumen</span>
            <span>{requiereRecepcion ? `${lines.length} ${lines.length === 1 ? 'producto' : 'productos'}` : 'Sin líneas de inventario'}</span>
            <strong>Total persistido {moneyCurrency(total, currency)}</strong>
          </div>
          <div className="po-tax">
            {fiscalComplete ? <><span>Base imponible <strong>{moneyCurrency(base ?? 0, currency)}</strong></span><span>Impuestos <strong>{moneyCurrency(tax ?? 0, currency)}</strong></span></> : <span>Desglose tributario <strong>No disponible; sin recálculo histórico</strong></span>}
            <span className="po-grand">Total persistido <strong>{moneyCurrency(order.amount ?? total, currency)}</strong></span>
          </div>
        </div>
        <p className="po-foot"><GoogleIcon name="schedule" className="small" /> Actualización: {order.date} · La obligación por pagar nace al registrar la recepción. Esta edición no crea ni actualiza CxP.</p>
      </section>
    </>
  )
}
