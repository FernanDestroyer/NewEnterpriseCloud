import { useEffect, useState, type FormEvent } from 'react'
import { ClipboardCheck, Plus, Trash2 } from 'lucide-react'
import { inventoryQueryError } from '../services/inventoryQueries'
import { closePhysicalCount, findClosedCountByKey, findOpenCountByKey, inventoryKey, loadPhysicalCountLines, loadPhysicalCounts, openPhysicalCount, type PhysicalCount, type PhysicalCountLine } from '../services/inventoryOperations'
import { InventoryGate, InventoryHeader, InventoryMessage, localDateTime, units, useInventoryReference, useInventorySubmission } from './inventoryShared'

type CountDraft = { productId: string; system: number; counted: string; cost: string }

export default function PhysicalInventoryPage() {
  const reference = useInventoryReference()
  const { can, products, byProduct, activeWarehouses, byWarehouse, stocks, loading, error, refresh, reloadReferences } = reference
  const [warehouseId, setWarehouseId] = useState('')
  const [reason, setReason] = useState('')
  const [draft, setDraft] = useState<CountDraft[]>([])
  const [addId, setAddId] = useState('')
  const [openKey, setOpenKey] = useState(inventoryKey)
  const [closeKey, setCloseKey] = useState(inventoryKey)
  const [counts, setCounts] = useState<PhysicalCount[]>([])
  const [countTotal, setCountTotal] = useState(0)
  const [countPage, setCountPage] = useState(0)
  const [selectedId, setSelectedId] = useState('')
  const [lines, setLines] = useState<PhysicalCountLine[]>([])
  const openWrite = useInventorySubmission()
  const closeWrite = useInventorySubmission()
  const busy = openWrite.busy || closeWrite.busy
  const [loadingLines, setLoadingLines] = useState(false)
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState('')
  const [lineError, setLineError] = useState('')
  const [validationError, setValidationError] = useState('')
  const [confirmClose, setConfirmClose] = useState(false)
  const [listVersion, setListVersion] = useState(0)
  const selected = counts.find(item => item.id === selectedId)

  useEffect(() => {
    if (!can('inventory', 'ver')) return
    let active = true
    setListLoading(true)
    void loadPhysicalCounts(countPage).then(data => { if (active) { setCounts(data.rows); setCountTotal(data.total); setListError('') } })
      .catch(cause => { if (active) setListError(inventoryQueryError(cause)) })
      .finally(() => { if (active) setListLoading(false) })
    return () => { active = false }
  }, [can, listVersion, countPage])

  useEffect(() => {
    if (!selectedId || !can('inventory', 'ver')) { setLines([]); return }
    let active = true
    setLoadingLines(true); setLineError('')
    void loadPhysicalCountLines(selectedId).then(data => { if (active) setLines(data) })
      .catch(cause => { if (active) setLineError(inventoryQueryError(cause)) })
      .finally(() => { if (active) setLoadingLines(false) })
    return () => { active = false }
  }, [selectedId, can, listVersion])

  const selectWarehouse = (id: string) => {
    setWarehouseId(id); setOpenKey(inventoryKey()); setAddId('')
    setDraft(stocks.filter(item => item.almacen_id === id && Number(item.stock_fisico) > 0)
      .map(item => ({ productId: item.producto_id, system: Number(item.stock_fisico), counted: '', cost: '' })))
  }
  const update = (id: string, patch: Partial<CountDraft>) => {
    setDraft(current => current.map(row => row.productId === id ? { ...row, ...patch } : row))
    setOpenKey(inventoryKey())
  }
  const addProduct = () => {
    if (!addId || draft.some(row => row.productId === addId)) return
    const system = Number(stocks.find(item => item.almacen_id === warehouseId && item.producto_id === addId)?.stock_fisico ?? 0)
    setDraft(current => [...current, { productId: addId, system, counted: '', cost: '' }]); setAddId(''); setOpenKey(inventoryKey())
  }

  const open = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy || (!openWrite.unresolved && (loading || error))) return
    setValidationError('')
    const parsed = draft.map(row => ({ ...row, quantity: Number(row.counted), unitCost: row.cost.trim() === '' ? null : Number(row.cost) }))
    if (!openWrite.unresolved) {
      if (!activeWarehouses.some(item => item.id === warehouseId) || reason.trim().length < 3 || reason.trim().length > 1000) return setValidationError('Selecciona un almacén activo y un motivo de 3 a 1000 caracteres.')
      if (!draft.length) return setValidationError('Agrega al menos un producto al conteo.')
      if (parsed.some(row => row.counted.trim() === '' || !Number.isSafeInteger(row.quantity) || row.quantity < 0)) return setValidationError('Digita el stock contado de cada línea (entero igual o mayor que cero).')
      if (parsed.some(row => row.unitCost !== null && (!Number.isFinite(row.unitCost) || row.unitCost < 0 || row.quantity <= row.system))) return setValidationError('El costo opcional solo se permite en líneas con sobrante y debe ser no negativo.')
    }
    await openWrite.run({
      find: () => findOpenCountByKey(openKey),
      write: () => openPhysicalCount({ warehouseId, reason: reason.trim(), key: openKey,
        lines: parsed.map(row => ({ producto_id: row.productId, cantidad_contada: row.quantity, ...(row.unitCost !== null ? { costo_entrada: row.unitCost } : {}) })) }),
      saved: id => {
        setLines([]); setLoadingLines(true); setSelectedId(id); setCloseKey(inventoryKey()); setConfirmClose(false)
        setDraft([]); setReason(''); setWarehouseId(''); setOpenKey(inventoryKey()); setCountPage(0)
        setListVersion(value => value + 1)
      },
      success: id => `Conteo ${id} abierto. Comprueba las cifras guardadas antes de cerrarlo.`,
      reload: async () => {
        await reloadReferences()
        const next = await loadPhysicalCounts(0)
        setCounts(next.rows); setCountTotal(next.total)
      },
    })
  }

  const close = async () => {
    if ((!selected && !closeWrite.unresolved) || (selected && selected.estado !== 'abierto' && !closeWrite.unresolved) || !selectedId || busy || (!closeWrite.unresolved && (loadingLines || lineError))) return
    setValidationError('')
    await closeWrite.run({
      find: async () => await findClosedCountByKey(selectedId, closeKey) ? selectedId : null,
      write: () => closePhysicalCount(selectedId, closeKey),
      saved: () => { setConfirmClose(false); setListVersion(value => value + 1) },
      success: () => 'Inventario cerrado. Las diferencias generaron ajustes de conciliación automáticamente en una transacción.',
      reload: async () => {
        await reloadReferences()
        const next = await loadPhysicalCounts(countPage)
        setCounts(next.rows); setCountTotal(next.total)
      },
    })
  }

  return <InventoryGate canView={can('inventory', 'ver')}><section className="inv-page">
    <InventoryHeader title="Inventario físico" description="Digita las cantidades, abre el conteo y concilia diferencias al cerrarlo." onRefresh={() => { setListVersion(value => value + 1); return refresh() }} loading={loading} />
    <InventoryMessage>Los conteos se guardan completos al abrirse; el backend no permite modificar líneas abiertas. Si el stock cambia antes del cierre, el cierre se rechaza y tendrás que repetir el conteo.</InventoryMessage>
    {error && <InventoryMessage>{error}</InventoryMessage>}{listError && <InventoryMessage>{listError}</InventoryMessage>}
    {[validationError, openWrite.message, closeWrite.message, openWrite.refreshError, closeWrite.refreshError].filter(Boolean).map((text, index) => <InventoryMessage key={`${index}-${text}`}>{text}</InventoryMessage>)}
    {[openWrite.success, closeWrite.success].filter(Boolean).map((text, index) => <InventoryMessage tone="success" key={`${index}-${text}`}>{text}</InventoryMessage>)}
    {(can('inventory', 'crear') || can('inventory', 'editar')) && <form className="inv-card" onSubmit={event => void open(event)}>
      <div className="inv-card-heading"><ClipboardCheck size={18} /><div><strong>Abrir auditoría</strong><small>El stock del sistema es una vista previa; Supabase registra la instantánea oficial al abrir.</small></div></div>
      <fieldset className="inv-fieldset" disabled={busy || openWrite.unresolved}>
      <div className="inv-form-grid"><label>Almacén<select className="ws-control" required value={warehouseId} onChange={event => selectWarehouse(event.target.value)}><option value="">Seleccionar almacén</option>{activeWarehouses.map(item => <option key={item.id} value={item.id}>{item.nombre}</option>)}</select></label><label>Motivo<input className="ws-control" required minLength={3} maxLength={1000} value={reason} onChange={event => { setReason(event.target.value); setOpenKey(inventoryKey()) }} placeholder="Ej. conteo periódico" /></label></div>
      {warehouseId && <><div className="inv-table-wrap"><table className="inv-table"><thead><tr><th scope="col">Producto</th><th scope="col" className="ws-num">Stock sistema · previo</th><th scope="col">Stock contado</th><th scope="col" className="ws-num">Diferencia · previa</th><th scope="col">Costo unitario sobrante</th><th scope="col"><span className="inv-sr-only">Quitar</span></th></tr></thead><tbody>{draft.map(row => { const quantity = row.counted.trim() === '' ? null : Number(row.counted); return <tr key={row.productId}><td><strong>{byProduct.get(row.productId)?.name ?? row.productId}</strong><small>{byProduct.get(row.productId)?.id ?? row.productId}</small></td><td className="ws-num">{units(row.system)}</td><td><input type="number" className="ws-control inv-number" min="0" step="1" required aria-label={`Stock contado de ${byProduct.get(row.productId)?.name ?? row.productId}`} value={row.counted} onChange={event => update(row.productId, { counted: event.target.value, cost: event.target.value.trim() !== '' && Number(event.target.value) > row.system ? row.cost : '' })} /></td><td className="ws-num">{quantity !== null && Number.isFinite(quantity) ? units(quantity - row.system) : '—'}</td><td><input type="number" className="ws-control inv-number" min="0" step="0.000001" disabled={quantity === null || quantity <= row.system} aria-label={`Costo de sobrante de ${byProduct.get(row.productId)?.name ?? row.productId}`} value={row.cost} onChange={event => update(row.productId, { cost: event.target.value })} placeholder="Opcional" /></td><td><button type="button" className="inv-icon" aria-label="Quitar producto" onClick={() => { setDraft(current => current.filter(item => item.productId !== row.productId)); setOpenKey(inventoryKey()) }}><Trash2 size={15} /></button></td></tr> })}</tbody></table></div><div className="inv-add-row"><select className="ws-control" aria-label="Producto adicional" value={addId} onChange={event => setAddId(event.target.value)}><option value="">Añadir producto con stock cero…</option>{products.filter(item => !draft.some(row => row.productId === item.rowId)).map(item => <option key={item.rowId} value={item.rowId}>{item.id} · {item.name}</option>)}</select><button type="button" className="ws-button ws-button-secondary" disabled={!addId} onClick={addProduct}><Plus size={14} />Añadir</button></div></>}
      </fieldset>
      <div className="inv-actions"><span>Antes de abrir, verifica cada cifra. El costo de sobrantes es opcional.</span><button className="ws-button" type="submit" disabled={busy || (!openWrite.unresolved && (loading || Boolean(error) || !draft.length))}>{openWrite.busy ? 'Abriendo…' : openWrite.unresolved ? 'Reintentar y reconciliar' : 'Abrir conteo'}</button></div>
    </form>}
    <div className="inv-card"><div className="inv-card-heading"><ClipboardCheck size={18} /><div><strong>Auditorías</strong><small>Selecciona un conteo para ver su instantánea y sus ajustes.</small></div></div><div className="inv-form-grid"><label>Conteo<select className="ws-control" value={selectedId} disabled={busy || listLoading || Boolean(listError) || closeWrite.unresolved} onChange={event => { setLines([]); setLoadingLines(Boolean(event.target.value)); setSelectedId(event.target.value); setCloseKey(inventoryKey()); setConfirmClose(false) }}><option value="">Seleccionar conteo</option>{counts.map(item => <option key={item.id} value={item.id}>{localDateTime(item.creado_en)} · {byWarehouse.get(item.almacen_id) ?? item.almacen_id} · {item.estado}</option>)}</select></label>{selected && <div className="inv-inline-stat"><span>Estado</span><span className={`inv-badge ${selected.estado === 'cerrado' ? 'green' : 'amber'}`}>{selected.estado}</span><span>Motivo</span><strong>{selected.motivo}</strong></div>}</div>
      {lineError && <InventoryMessage>{lineError}</InventoryMessage>}{loadingLines && <div className="inv-inline-note">Consultando líneas del conteo…</div>}
      {closeWrite.unresolved && (loadingLines || Boolean(lineError) || !selected) && <div className="inv-actions"><span>El resultado del cierre sigue sin verificarse. Conserva la misma clave.</span><button type="button" className="ws-button" disabled={busy} onClick={() => void close()}>Reintentar y reconciliar</button></div>}
      {selected && !loadingLines && !lineError && <><div className="inv-table-wrap"><table className="inv-table"><thead><tr><th scope="col">Producto</th><th scope="col" className="ws-num">Sistema al abrir</th><th scope="col" className="ws-num">Contado</th><th scope="col" className="ws-num">Diferencia</th><th scope="col">Conciliación</th></tr></thead><tbody>{lines.map(row => <tr key={row.producto_id}><td><strong>{byProduct.get(row.producto_id)?.name ?? row.producto_id}</strong></td><td className="ws-num">{units(row.stock_sistema)}</td><td className="ws-num">{units(row.stock_contado)}</td><td className="ws-num">{units(row.stock_contado - row.stock_sistema)}</td><td><span className={`inv-badge ${row.ajuste_id ? 'green' : row.stock_contado === row.stock_sistema ? 'neutral' : 'amber'}`}>{row.ajuste_id ? 'Ajustado' : row.stock_contado === row.stock_sistema ? 'Sin diferencia' : 'Pendiente'}</span>{row.ajuste_id && <small>{row.ajuste_id}</small>}</td></tr>)}</tbody></table></div>{(selected.estado === 'abierto' || closeWrite.unresolved) && (can('inventory', 'crear') || can('inventory', 'editar')) && <div className="inv-actions"><span>El cierre es irreversible y genera ajustes automáticos para cada diferencia. Las reservas y los cambios de stock pueden impedirlo.</span>{confirmClose ? <div className="inv-confirm"><button type="button" className="ws-button ws-button-secondary" disabled={busy || closeWrite.unresolved} onClick={() => setConfirmClose(false)}>Cancelar</button><button type="button" className="ws-button" disabled={busy || (!closeWrite.unresolved && !lines.length)} onClick={() => void close()}>{closeWrite.busy ? 'Cerrando…' : closeWrite.unresolved ? 'Reintentar y reconciliar' : 'Confirmar conciliación'}</button></div> : <button type="button" className="ws-button" disabled={busy || !lines.length} onClick={() => setConfirmClose(true)}>Cerrar inventario</button>}</div>}</>}
      <div className="inv-pagination"><span>Página {countPage + 1} de {Math.max(1, Math.ceil(countTotal / 50))} · {countTotal} conteos</span><div><button type="button" className="ws-button ws-button-secondary" disabled={countPage === 0 || busy || listLoading || Boolean(listError) || closeWrite.unresolved} onClick={() => { setSelectedId(''); setCountPage(page => page - 1) }}>Anterior</button><button type="button" className="ws-button ws-button-secondary" disabled={(countPage + 1) * 50 >= countTotal || busy || listLoading || Boolean(listError) || closeWrite.unresolved} onClick={() => { setSelectedId(''); setCountPage(page => page + 1) }}>Siguiente</button></div></div>
    </div>
  </section></InventoryGate>
}
