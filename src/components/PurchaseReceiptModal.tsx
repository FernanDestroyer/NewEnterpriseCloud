import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { ChevronLeft, ChevronRight, PackageCheck, RefreshCw } from 'lucide-react'
import type { DocumentLine, RecordItem } from '../types'
import { fetchActiveWarehouses, fetchDocumentLines, friendlyError, type ActiveWarehouse, type PurchaseReceiptInputLine } from '../services/records'
import { fetchPurchaseReceiptHistory, fetchPurchaseReceiptProgress, type PurchaseReceiptEvent, type PurchaseReceiptProgress } from '../services/purchaseReceipts'
import { useDialog } from './useDialog'

function newRequestKey() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export default function PurchaseReceiptModal({ order, busy, onClose, onSubmit }: {
  order: RecordItem
  busy: boolean
  onClose: () => void
  onSubmit: (warehouseId: string, lines: PurchaseReceiptInputLine[], idempotencyKey: string) => Promise<boolean>
}) {
  const [lines, setLines] = useState<DocumentLine[]>([])
  const [received, setReceived] = useState<Map<string, PurchaseReceiptProgress>>(new Map())
  const [history, setHistory] = useState<PurchaseReceiptEvent[]>([])
  const [historyTotal, setHistoryTotal] = useState(0)
  const [historyPage, setHistoryPage] = useState(0)
  const [historyError, setHistoryError] = useState('')
  const [historyLoading, setHistoryLoading] = useState(false)
  const [warehouses, setWarehouses] = useState<ActiveWarehouse[]>([])
  const [warehouseId, setWarehouseId] = useState('')
  const [quantities, setQuantities] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [requestKey, setRequestKey] = useState(newRequestKey)
  const dialogRef = useDialog<HTMLFormElement>(onClose, busy)

  useEffect(() => {
    let active = true
    const load = async () => {
      if (!order.rowId) { setError('La orden no tiene identificador interno.'); setLoading(false); return }
      setLoading(true)
      try {
        const [documentLines, progress, activeWarehouses, receiptHistory] = await Promise.all([
          fetchDocumentLines('purchases', order.rowId),
          fetchPurchaseReceiptProgress(order.rowId),
          fetchActiveWarehouses(),
          fetchPurchaseReceiptHistory(order.rowId, 5, 0),
        ])
        if (!active) return
        setLines(documentLines)
        setReceived(progress)
        setHistory(receiptHistory.items)
        setHistoryTotal(receiptHistory.total)
        setWarehouses(activeWarehouses)
        setWarehouseId(activeWarehouses[0]?.id ?? '')
        setQuantities(Object.fromEntries(documentLines.map(line => [line.rowId ?? line.producto_id, '0'])))
      } catch (loadError) {
        if (active) setError(friendlyError(loadError))
      } finally { if (active) setLoading(false) }
    }
    void load()
    return () => { active = false }
  }, [order.rowId])

  const loadHistoryPage = async (nextPage: number) => {
    if (!order.rowId || historyLoading) return
    setHistoryLoading(true); setHistoryError('')
    try {
      const result = await fetchPurchaseReceiptHistory(order.rowId, 5, nextPage * 5)
      setHistory(result.items); setHistoryTotal(result.total); setHistoryPage(nextPage)
    } catch (cause) { setHistoryError(friendlyError(cause)) }
    finally { setHistoryLoading(false) }
  }

  const remaining = (line: DocumentLine) => Math.max(0, line.cantidad - (received.get(line.rowId ?? '')?.recibido_bruto ?? 0))
  const selected = useMemo(() => lines.flatMap(line => {
    const id = line.rowId
    if (!id) return []
    const quantity = Number(quantities[id] ?? 0)
    return Number.isInteger(quantity) && quantity > 0 ? [{ detalle_compra_id: id, cantidad: quantity }] : []
  }), [lines, quantities])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    if (!warehouseId) return setError('Crea y activa un almacén antes de registrar la recepción.')
    if (!selected.length) return setError('Indica al menos una cantidad por recibir.')
    const exceeds = selected.find(line => line.cantidad > remaining(lines.find(item => item.rowId === line.detalle_compra_id)!))
    if (exceeds) return setError('Alguna cantidad supera lo que falta por recibir.')
    if (await onSubmit(warehouseId, selected, requestKey)) onClose()
  }

  const change = (fn: () => void) => { fn(); setRequestKey(newRequestKey()) }
  const fillPending = () => change(() => setQuantities(Object.fromEntries(lines.map(line => [line.rowId ?? line.producto_id, String(remaining(line))]))))

  return <div className="modal-backdrop" role="presentation" onMouseDown={event => !busy && event.target === event.currentTarget && onClose()}>
    <form ref={dialogRef} className="record-modal ws-receipt-modal" role="dialog" aria-modal="true" aria-labelledby="purchase-receipt-title" onSubmit={event => void submit(event)}>
      <div className="modal-heading"><div><span className="record-id">{order.id}</span><h2 id="purchase-receipt-title">Registrar recepción</h2><p>La recepción parcial crea el movimiento de almacén y su Kardex en una sola transacción.</p></div></div>
      {error && <div className="ws-notice ws-notice-warning" role="alert">{error}</div>}
      {loading ? <div className="ws-empty-compact"><RefreshCw size={18} className="ws-spin" /> Cargando líneas, avance y almacenes…</div> : <>
        <label className="ws-confirm-field">Almacén destino
          <select value={warehouseId} onChange={event => change(() => setWarehouseId(event.target.value))} required>
            <option value="">Selecciona un almacén</option>
            {warehouses.map(warehouse => <option key={warehouse.id} value={warehouse.id}>{warehouse.nombre}</option>)}
          </select>
        </label>
        {warehouses.length === 0 && <div className="ws-notice ws-notice-warning">No hay almacenes activos. Configura primero Sucursales y almacenes en Maestros.</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
          <button className="ws-text-button" type="button" disabled={!lines.some(line => remaining(line) > 0)} onClick={fillPending}><PackageCheck size={14} />Completar pendientes</button>
        </div>
       <div className="ws-receipt-lines">
          {lines.map(line => {
            const id = line.rowId ?? line.producto_id
            const progress = received.get(line.rowId ?? '')
            const already = progress?.recibido_bruto ?? 0
            const left = remaining(line)
            const overflow = Number(quantities[id] ?? 0) > left
            return <label className="ws-receipt-line" key={id}>
              <span><strong>{line.nombre ?? line.codigo ?? 'Artículo de proveedor'}</strong><small>Ordenadas {line.cantidad} · Recibido bruto {already} · Devuelto {progress?.devuelto ?? 0} · Neto recibido {progress?.neto_recibido ?? 0} · Pendiente por recibir {left}</small></span>
              <input className={overflow ? 'is-invalid' : undefined} aria-invalid={overflow || undefined} aria-label={`Cantidad a recibir de ${line.nombre ?? line.codigo ?? 'artículo'}`} type="number" min="0" max={left} step="1" value={quantities[id] ?? '0'} disabled={!left} onChange={event => change(() => setQuantities(current => ({ ...current, [id]: event.target.value })))} />
            </label>
          })}
          {!lines.length && <div className="ws-notice ws-notice-warning">Esta orden no tiene líneas recibibles. Agrega sus artículos antes de confirmar.</div>}
        </div>
        <section className="ws-receipt-history" aria-label="Historial de recepciones">
          <h3>Historial de recepciones</h3>
          {historyError && <div className="ws-notice ws-notice-warning" role="alert">{historyError}</div>}
          {historyLoading ? <small>Consultando historial…</small> : history.length ? history.map(receipt => <article className="ws-receipt-history-item" key={receipt.id}>
            <div><strong>{receipt.codigo}</strong><small>{new Date(receipt.recibido_en).toLocaleString('es-PE')} · {receipt.almacen} · {receipt.actor ?? receipt.actor_id ?? 'Usuario'}</small>
              {(receipt.comprobante_tipo || receipt.comprobante_numero || receipt.referencia) && <small>{[receipt.comprobante_tipo, receipt.comprobante_numero, receipt.referencia].filter(Boolean).join(' · ')}</small>}</div>
            <ul>{receipt.lineas.map(line => <li key={line.detalle_recepcion_id}>{line.descripcion ?? line.producto_id}: {line.cantidad}</li>)}</ul>
          </article>) : <small>No hay recepciones anteriores.</small>}
          {historyTotal > 5 && <div className="ws-pagination"><span>{historyPage * 5 + 1}–{Math.min((historyPage + 1) * 5, historyTotal)} de {historyTotal}</span><div>
            <button className="ws-icon-button" type="button" aria-label="Recepciones anteriores" disabled={historyPage === 0 || historyLoading} onClick={() => void loadHistoryPage(historyPage - 1)}><ChevronLeft size={14}/></button>
            <span>{historyPage + 1}/{Math.ceil(historyTotal / 5)}</span>
            <button className="ws-icon-button" type="button" aria-label="Recepciones siguientes" disabled={(historyPage + 1) * 5 >= historyTotal || historyLoading} onClick={() => void loadHistoryPage(historyPage + 1)}><ChevronRight size={14}/></button>
          </div></div>}
        </section>
      </>}
      <div className="modal-actions">
        <button className="cancel-button" type="button" disabled={busy} onClick={onClose}>Cancelar</button>
        <button className="primary-button" type="submit" disabled={busy || loading || !lines.length || !warehouseId || !selected.length}><PackageCheck size={15} />{busy ? 'Registrando…' : 'Confirmar recepción'}</button>
      </div>
    </form>
  </div>
}
