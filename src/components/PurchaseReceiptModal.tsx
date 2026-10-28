import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { PackageCheck, RefreshCw } from 'lucide-react'
import type { DocumentLine, RecordItem } from '../types'
import { fetchActiveWarehouses, fetchDocumentLines, fetchPurchaseReceiptProgress, friendlyError, type ActiveWarehouse, type PurchaseReceiptInputLine } from '../services/records'
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
  const [received, setReceived] = useState<Map<string, number>>(new Map())
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
        const [documentLines, progress, activeWarehouses] = await Promise.all([
          fetchDocumentLines('purchases', order.rowId),
          fetchPurchaseReceiptProgress(order.rowId),
          fetchActiveWarehouses(),
        ])
        if (!active) return
        setLines(documentLines)
        setReceived(progress)
        setWarehouses(activeWarehouses)
        setWarehouseId(activeWarehouses[0]?.id ?? '')
        setQuantities(Object.fromEntries(documentLines.map(line => [line.rowId ?? line.producto_id, String(Math.max(0, line.cantidad - (progress.get(line.rowId ?? '') ?? 0)))])))
      } catch (loadError) {
        if (active) setError(friendlyError(loadError))
      } finally { if (active) setLoading(false) }
    }
    void load()
    return () => { active = false }
  }, [order.rowId])

  const remaining = (line: DocumentLine) => Math.max(0, line.cantidad - (received.get(line.rowId ?? '') ?? 0))
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
        <div className="ws-receipt-lines">
          {lines.map(line => {
            const id = line.rowId ?? line.producto_id
            const already = received.get(line.rowId ?? '') ?? 0
            const left = remaining(line)
            return <label className="ws-receipt-line" key={id}>
              <span><strong>{line.nombre ?? line.codigo ?? 'Artículo de proveedor'}</strong><small>Ordenadas {line.cantidad} · Recibidas {already} · Faltan {left}</small></span>
              <input aria-label={`Cantidad a recibir de ${line.nombre ?? line.codigo ?? 'artículo'}`} type="number" min="0" max={left} step="1" value={quantities[id] ?? '0'} disabled={!left} onChange={event => change(() => setQuantities(current => ({ ...current, [id]: event.target.value })))} />
            </label>
          })}
          {!lines.length && <div className="ws-notice ws-notice-warning">Esta orden no tiene líneas recibibles. Agrega sus artículos antes de confirmar.</div>}
        </div>
      </>}
      <div className="modal-actions">
        <button className="cancel-button" type="button" disabled={busy} onClick={onClose}>Cancelar</button>
        <button className="primary-button" type="submit" disabled={busy || loading || !lines.length || !warehouseId || !selected.length}><PackageCheck size={15} />{busy ? 'Registrando…' : 'Confirmar recepción'}</button>
      </div>
    </form>
  </div>
}
