import { useState, type FormEvent } from 'react'
import { ArrowLeftRight, Plus, Trash2, Wrench } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { findAdjustmentByKey, findTransferByKey, inventoryKey, processTransfer, registerAdjustment } from '../services/inventoryOperations'
import { InventoryGate, InventoryHeader, InventoryMessage, units, useInventoryReference, useInventorySubmission } from './inventoryShared'

type DraftLine = { id: string; productId: string; quantity: string }
const blankLine = (): DraftLine => ({ id: inventoryKey(), productId: '', quantity: '' })

function TransferForm() {
  const reference = useInventoryReference()
  const { activeWarehouses, products, stockAt, can, loading, error, refresh, reloadReferences } = reference
  const navigate = useNavigate()
  const [origin, setOrigin] = useState('')
  const [destination, setDestination] = useState('')
  const [reason, setReason] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([blankLine()])
  const [key, setKey] = useState(inventoryKey)
  const { busy, unresolved, message, success, refreshError, setMessage, run } = useInventorySubmission()
  const changeLine = (id: string, patch: Partial<DraftLine>) => { setLines(current => current.map(line => line.id === id ? { ...line, ...patch } : line)); setKey(inventoryKey()) }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy || (!unresolved && (loading || error))) return
    const entries = lines.map(line => ({ producto_id: line.productId, cantidad: Number(line.quantity) }))
    if (!unresolved) {
      if (!origin || !destination || origin === destination || !activeWarehouses.some(item => item.id === origin) || !activeWarehouses.some(item => item.id === destination)) return setMessage('Selecciona dos almacenes activos distintos.')
      if (reason.trim().length < 3 || reason.trim().length > 1000) return setMessage('El motivo debe tener entre 3 y 1000 caracteres.')
      if (!entries.length || entries.some(line => !line.producto_id || !Number.isSafeInteger(line.cantidad) || line.cantidad <= 0)) return setMessage('Completa cada producto y una cantidad entera mayor que cero.')
      if (new Set(entries.map(line => line.producto_id)).size !== entries.length) return setMessage('No repitas productos en la transferencia.')
      if (entries.some(line => line.cantidad > Number(stockAt(line.producto_id, origin)?.stock_libre ?? 0))) return setMessage('Hay líneas que exceden el stock libre del origen. Actualiza los saldos y revisa las reservas.')
    }
    await run({
      find: () => findTransferByKey(key),
      write: () => processTransfer({ origin, destination, reason: reason.trim(), lines: entries, key }),
      saved: () => { setLines([blankLine()]); setReason(''); setKey(inventoryKey()) },
      success: id => `Transferencia ${id} registrada: salida y entrada atómicas en Kardex.`,
      reload: reloadReferences,
    })
  }

  return <InventoryGate canView={can('inventory', 'ver')}><section className="inv-page">
    <InventoryHeader title="Transferencias entre almacenes" description="Traslada productos con salida y entrada en una sola transacción." onRefresh={refresh} loading={loading} />
    {error && <InventoryMessage>{error}</InventoryMessage>}{message && <InventoryMessage>{message}</InventoryMessage>}{refreshError && <InventoryMessage>{refreshError}</InventoryMessage>}{success && <InventoryMessage tone="success">{success} <button type="button" className="ws-text-button" onClick={() => navigate('/inventario/kardex')}>Ver Kardex</button></InventoryMessage>}
    {!can('inventory', 'crear') && !can('inventory', 'editar') ? <InventoryMessage>Tu rol solo puede consultar inventario; no puede registrar transferencias.</InventoryMessage> : <form className="inv-card" onSubmit={event => void submit(event)}>
      <div className="inv-card-heading"><ArrowLeftRight size={18} /><div><strong>Nueva transferencia</strong><small>El stock libre incluye las reservas de Ventas. El servidor vuelve a validarlo al confirmar.</small></div></div>
      <fieldset className="inv-fieldset" disabled={busy || unresolved}>
      <div className="inv-form-grid"><label>Almacén de origen<select className="ws-control" required value={origin} onChange={event => { setOrigin(event.target.value); setKey(inventoryKey()) }}><option value="">Seleccionar origen</option>{activeWarehouses.map(item => <option key={item.id} value={item.id}>{item.nombre}</option>)}</select></label><label>Almacén de destino<select className="ws-control" required value={destination} onChange={event => { setDestination(event.target.value); setKey(inventoryKey()) }}><option value="">Seleccionar destino</option>{activeWarehouses.filter(item => item.id !== origin).map(item => <option key={item.id} value={item.id}>{item.nombre}</option>)}</select></label></div>
      <div className="inv-table-wrap"><table className="inv-table"><thead><tr><th scope="col">Producto</th><th scope="col" className="ws-num">Libre en origen</th><th scope="col">Cantidad a trasladar</th><th scope="col"><span className="inv-sr-only">Quitar línea</span></th></tr></thead><tbody>{lines.map(line => <tr key={line.id}><td><select className="ws-control" aria-label="Producto a trasladar" required value={line.productId} onChange={event => changeLine(line.id, { productId: event.target.value })}><option value="">Seleccionar producto</option>{products.map(item => <option key={item.rowId} value={item.rowId}>{item.id} · {item.name}</option>)}</select></td><td className="ws-num">{line.productId && origin ? units(Number(stockAt(line.productId, origin)?.stock_libre ?? 0)) : '—'}</td><td><input className="ws-control inv-number" aria-label="Cantidad a trasladar" type="number" min="1" step="1" required value={line.quantity} onChange={event => changeLine(line.id, { quantity: event.target.value })} /></td><td><button type="button" className="inv-icon" aria-label="Quitar producto" disabled={lines.length === 1} onClick={() => { setLines(current => current.filter(item => item.id !== line.id)); setKey(inventoryKey()) }}><Trash2 size={15} /></button></td></tr>)}</tbody></table></div>
      <button type="button" className="ws-text-button inv-add" onClick={() => { setLines(current => [...current, blankLine()]); setKey(inventoryKey()) }}><Plus size={14} />Añadir producto</button>
      <div className="inv-form-grid"><label className="inv-wide">Motivo<textarea className="ws-control" rows={2} minLength={3} maxLength={1000} required value={reason} onChange={event => { setReason(event.target.value); setKey(inventoryKey()) }} placeholder="Justificación del traslado" /></label></div>
      </fieldset>
      <div className="inv-actions"><button type="submit" className="ws-button" disabled={busy || (!unresolved && (loading || Boolean(error) || activeWarehouses.length < 2))}>{busy ? 'Procesando…' : unresolved ? 'Reintentar y reconciliar' : 'Registrar transferencia'}</button></div>
    </form>}
  </section></InventoryGate>
}

function AdjustmentForm() {
  const reference = useInventoryReference()
  const { activeWarehouses, products, stockAt, can, loading, error, refresh, reloadReferences } = reference
  const [warehouseId, setWarehouseId] = useState('')
  const [productId, setProductId] = useState('')
  const [direction, setDirection] = useState<'entrada' | 'salida'>('entrada')
  const [quantity, setQuantity] = useState('')
  const [unitCost, setUnitCost] = useState('')
  const [reason, setReason] = useState('')
  const [key, setKey] = useState(inventoryKey)
  const { busy, unresolved, message, success, refreshError, setMessage, run } = useInventorySubmission()
  const change = (update: () => void) => { update(); setKey(inventoryKey()) }
  const stock = stockAt(productId, warehouseId)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy || (!unresolved && (loading || error))) return
    const amount = Number(quantity)
    const cost = unitCost.trim() === '' ? null : Number(unitCost)
    if (!unresolved) {
      if (!activeWarehouses.some(item => item.id === warehouseId) || !productId) return setMessage('Selecciona almacén y producto.')
      if (!Number.isSafeInteger(amount) || amount <= 0) return setMessage('La cantidad debe ser un entero mayor que cero.')
      if (reason.trim().length < 3 || reason.trim().length > 1000) return setMessage('El motivo debe tener entre 3 y 1000 caracteres.')
      if (direction === 'salida' && amount > Number(stock?.stock_libre ?? 0)) return setMessage('La merma excede el stock libre; las reservas de Ventas no pueden consumirse.')
      if (cost !== null && (!Number.isFinite(cost) || cost < 0 || direction !== 'entrada')) return setMessage('El costo solo puede indicarse para sobrantes y debe ser no negativo.')
    }
    await run({
      find: () => findAdjustmentByKey(key),
      write: () => registerAdjustment({ productId, warehouseId, delta: direction === 'entrada' ? amount : -amount, reason: reason.trim(), unitCost: cost, key }),
      saved: () => { setQuantity(''); setUnitCost(''); setReason(''); setKey(inventoryKey()) },
      success: id => `Ajuste ${id} registrado. El stock y Kardex se actualizaron.`,
      reload: reloadReferences,
    })
  }

  return <InventoryGate canView={can('inventory', 'ver')}><section className="inv-page">
    <InventoryHeader title="Ajustes de inventario" description="Registra sobrantes o mermas con justificación y efecto en el Kardex." onRefresh={refresh} loading={loading} />
    {error && <InventoryMessage>{error}</InventoryMessage>}{message && <InventoryMessage>{message}</InventoryMessage>}{refreshError && <InventoryMessage>{refreshError}</InventoryMessage>}{success && <InventoryMessage tone="success">{success}</InventoryMessage>}
    {!can('inventory', 'crear') && !can('inventory', 'editar') ? <InventoryMessage>Tu rol solo puede consultar inventario; no puede registrar ajustes.</InventoryMessage> : <form className="inv-card" onSubmit={event => void submit(event)}>
      <div className="inv-card-heading"><Wrench size={18} /><div><strong>Nuevo ajuste</strong><small>Un delta positivo ingresa unidades; un delta negativo registra la salida.</small></div></div>
      <fieldset className="inv-fieldset" disabled={busy || unresolved}>
      <div className="inv-form-grid"><label>Almacén<select className="ws-control" required value={warehouseId} onChange={event => change(() => setWarehouseId(event.target.value))}><option value="">Seleccionar almacén</option>{activeWarehouses.map(item => <option key={item.id} value={item.id}>{item.nombre}</option>)}</select></label><label>Producto<select className="ws-control" required value={productId} onChange={event => change(() => setProductId(event.target.value))}><option value="">Seleccionar producto</option>{products.map(item => <option key={item.rowId} value={item.rowId}>{item.id} · {item.name}</option>)}</select></label><div className="inv-inline-stat"><span>Físico</span><strong>{productId && warehouseId ? units(Number(stock?.stock_fisico ?? 0)) : '—'}</strong><span>Libre</span><strong>{productId && warehouseId ? units(Number(stock?.stock_libre ?? 0)) : '—'}</strong></div><label>Tipo<select className="ws-control" value={direction} onChange={event => change(() => { setDirection(event.target.value as 'entrada' | 'salida'); setUnitCost('') })}><option value="entrada">Sobrante · entrada</option><option value="salida">Merma / pérdida · salida</option></select></label><label>Cantidad<input className="ws-control" type="number" required min="1" step="1" value={quantity} onChange={event => change(() => setQuantity(event.target.value))} /></label>{direction === 'entrada' && <label>Costo unitario (opcional)<input className="ws-control" type="number" min="0" step="0.000001" value={unitCost} onChange={event => change(() => setUnitCost(event.target.value))} placeholder="Sin costo comprobable" /></label>}<label className="inv-wide">Motivo<textarea className="ws-control" rows={2} required minLength={3} maxLength={1000} value={reason} onChange={event => change(() => setReason(event.target.value))} placeholder="Justificación del sobrante o merma" /></label></div>
      </fieldset>
      <div className="inv-actions"><span>Si dejas el costo vacío, la entrada puede quedar sin valorizar.</span><button className="ws-button" type="submit" disabled={busy || (!unresolved && (loading || Boolean(error)))}>{busy ? 'Procesando…' : unresolved ? 'Reintentar y reconciliar' : 'Registrar ajuste'}</button></div>
    </form>}
  </section></InventoryGate>
}

export default function InventoryOperationsPage({ initialTab = 'transfer' }: { initialTab?: 'transfer' | 'adjustment' }) {
  return initialTab === 'transfer' ? <TransferForm /> : <AdjustmentForm />
}
