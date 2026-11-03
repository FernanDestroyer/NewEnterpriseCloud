import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { AlertTriangle, ArrowDownToLine, Ban, ChevronDown, ChevronLeft, ChevronRight, CircleCheck, FilePlus2, Plus, RefreshCw, Search, ShieldCheck, X } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useRecords } from '../context/RecordsContext'
import { moneyCurrency } from '../data/helpers'
import {
  activatePurchaseContract, closePurchaseContract, createPurchaseContract, createPurchaseContractVersion, createPurchaseOrderFromContract,
  fetchPurchaseContractCatalog, fetchPurchaseContracts, suspendPurchaseContract,
  type PurchaseContractCatalogItem, type PurchaseContractSummary,
} from '../services/purchaseContracts'
import type { CreatePurchaseContractInput, CreatePurchaseContractVersionInput, PurchaseContractCurrency, PurchaseContractLineInput, PurchaseContractTaxTreatment } from '../types/purchaseContracts'

const PAGE_SIZE = 10
const newKey = () => globalThis.crypto?.randomUUID?.() ?? `contract-${Date.now()}-${Math.random().toString(36).slice(2)}`
type SupplierChoice = { id: string; name: string }
type DraftLine = PurchaseContractLineInput & { localId: string }
type ContractFormMode = { kind: 'create' } | { kind: 'version'; contract: PurchaseContractSummary }

function errorMessage(error: unknown) {
  const message = (error as { message?: string } | null)?.message ?? 'No se pudo completar la operación.'
  if (message.includes('Could not find the function') || message.includes('does not exist')) return 'No se encontró un RPC de contratos. Verifica que las migraciones F y F06–F09 estén aplicadas en el proyecto configurado.'
  return message
}
function currency(value: number, code: PurchaseContractCurrency) { return moneyCurrency(Number(value) || 0, code) }
function taxRate(treatment: PurchaseContractTaxTreatment) { return treatment === 'Gravado' ? 18 : 0 }
function lineGross(line: Pick<DraftLine, 'cantidad_tope' | 'costo_unitario' | 'tratamiento_tributario'>) {
  const base = Math.round(line.cantidad_tope * line.costo_unitario * 100) / 100
  return base + Math.round(base * taxRate(line.tratamiento_tributario)) / 100
}
function linePayload(lines: DraftLine[]): PurchaseContractLineInput[] {
  return lines.map(({ localId: _localId, ...line }) => line)
}

function ContractEditor({ mode, suppliers, responsibleId, onClose, onSaved }: {
  mode: ContractFormMode
  suppliers: SupplierChoice[]
  responsibleId: string
  onClose: () => void
  onSaved: () => void
}) {
  const isVersion = mode.kind === 'version'
  const original = isVersion ? mode.contract : null
  const [supplierId, setSupplierId] = useState(original?.proveedor_id ?? '')
  const [catalog, setCatalog] = useState<PurchaseContractCatalogItem[]>([])
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [catalogError, setCatalogError] = useState('')
  const [name, setName] = useState(original?.nombre ?? '')
  const [detail, setDetail] = useState(original?.detalle ?? '')
  const [start, setStart] = useState(original?.version?.fecha_inicio ?? new Date().toISOString().slice(0, 10))
  const [end, setEnd] = useState(original?.version?.fecha_fin ?? '')
  const [currencyCode, setCurrencyCode] = useState<PurchaseContractCurrency>(original?.version?.moneda ?? 'PEN')
  const [cap, setCap] = useState(String(original?.version?.monto_tope ?? ''))
  const [terms, setTerms] = useState(original?.version?.condiciones ?? '')
  const [reason, setReason] = useState('')
  const [lines, setLines] = useState<DraftLine[]>(() => original?.lineas.map(line => ({
    proveedor_producto_id: line.proveedor_producto_id, unidad_medida_id: line.unidad_medida_id,
    unidad: line.unidad, descripcion: line.descripcion, cantidad_tope: Number(line.cantidad_tope),
    costo_unitario: Number(line.costo_unitario), tratamiento_tributario: line.tratamiento_tributario,
    tasa_tributaria: Number(line.tasa_tributaria), condiciones: line.condiciones, localId: newKey(),
  })) ?? [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const key = useRef(newKey())
  const setEdited = <T,>(setter: (value: T) => void, value: T) => { key.current = newKey(); setter(value) }

  useEffect(() => {
    if (!supplierId) { setCatalog([]); return }
    let active = true
    setCatalogLoading(true); setCatalogError('')
    fetchPurchaseContractCatalog(supplierId).then(items => { if (active) setCatalog(items) })
      .catch(cause => { if (active) setCatalogError(errorMessage(cause)) })
      .finally(() => { if (active) setCatalogLoading(false) })
    return () => { active = false }
  }, [supplierId])

  const capacity = useMemo(() => lines.reduce((total, line) => total + lineGross(line), 0), [lines])
  const selectedIds = new Set(lines.map(line => line.proveedor_producto_id))
  const updateLine = (localId: string, patch: Partial<DraftLine>) => {
    key.current = newKey()
    setLines(current => current.map(line => line.localId === localId ? { ...line, ...patch } : line))
  }
  const addLine = (catalogId: string) => {
    const product = catalog.find(item => item.id === catalogId)
    if (!product || selectedIds.has(product.id)) return
    key.current = newKey()
    setLines(current => [...current, {
      proveedor_producto_id: product.id, unidad_medida_id: null, unidad: 'Unidad',
      descripcion: product.nombre, cantidad_tope: 1, costo_unitario: Number(product.costo) || 0,
      tratamiento_tributario: 'Gravado', tasa_tributaria: 18, condiciones: '', localId: newKey(),
    }])
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError('')
    const capValue = Number(cap)
    if (!isVersion && !name.trim()) return setError('Indica el nombre del contrato.')
    if (!isVersion && !responsibleId) return setError('No se pudo identificar al responsable activo de la sesión.')
    if (!supplierId || !start || !end || end < start || new Date(`${end}T23:59:59`) < new Date()) return setError('Selecciona proveedor y una vigencia válida, no vencida.')
    if (!Number.isFinite(capValue) || capValue <= 0) return setError('El tope monetario debe ser mayor que cero.')
    if (!lines.length) return setError('Agrega al menos una línea del catálogo de este proveedor.')
    if (lines.some(line => !line.proveedor_producto_id || !line.unidad.trim() || !line.descripcion.trim() || !Number.isFinite(line.cantidad_tope) || !Number.isInteger(line.cantidad_tope) || line.cantidad_tope <= 0 || !Number.isFinite(line.costo_unitario) || line.costo_unitario < 0 || Math.round(line.costo_unitario*100)!==line.costo_unitario*100)) return setError('Completa las líneas con cantidad entera y precio en céntimos; el RPC de órdenes opera cantidades enteras y precios a 2 decimales.')
    if (lines.some(line => !catalog.some(product => product.id === line.proveedor_producto_id))) return setError('Hay una línea que ya no pertenece al catálogo cargado del proveedor.')
    if (capacity > capValue + 0.00001) return setError(`El bruto máximo de líneas (${currency(capacity, currencyCode)}) excede el tope del contrato (${currency(capValue, currencyCode)}).`)
    if (isVersion && reason.trim().length < 5) return setError('Explica el motivo del versionado (mínimo 5 caracteres).')
    setBusy(true)
    try {
      const payloadLines = linePayload(lines)
      if (isVersion && original) {
        const input: CreatePurchaseContractVersionInput = {
          contrato_id: original.id, fecha_inicio: start, fecha_fin: end, moneda: currencyCode,
          monto_tope: capValue, condiciones: terms, lineas: payloadLines, motivo: reason.trim(), idempotency_key: key.current,
        }
        await createPurchaseContractVersion(input)
      } else {
        const input: CreatePurchaseContractInput = {
          proveedor_id: supplierId, responsable_id: responsibleId, nombre: name.trim(), detalle: detail.trim(),
          fecha_inicio: start, fecha_fin: end, moneda: currencyCode, monto_tope: capValue,
          condiciones: terms, lineas: payloadLines, idempotency_key: key.current,
        }
        await createPurchaseContract(input)
      }
      onSaved()
    } catch (cause) { setError(errorMessage(cause)) }
    finally { setBusy(false) }
  }

  return <div className="ws-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <form className="ws-dialog ws-contract-editor" role="dialog" aria-modal="true" aria-labelledby="contract-editor-title" onSubmit={event => void submit(event)}>
      <header><div><span className="ws-eyebrow">COMPRAS · CONTRATOS MARCO</span><h2 id="contract-editor-title">{isVersion ? `Nueva versión · ${original?.codigo}` : 'Crear contrato marco'}</h2><p>Las condiciones y líneas guardadas quedan como snapshot inmutable.</p></div><button className="ws-icon-button" type="button" disabled={busy} onClick={onClose} aria-label="Cerrar"><X size={18}/></button></header>
      <div className="ws-contract-editor-body">
        {!isVersion && <div className="ws-contract-form-grid"><label>Nombre del contrato<input className="ws-control" required minLength={3} maxLength={180} value={name} onChange={event => setEdited(setName,event.target.value)}/></label><label>Responsable<input className="ws-control" readOnly value={responsibleId ? 'Usuario de la sesión' : 'Sin responsable activo'} title={responsibleId}/></label><label className="ws-contract-span">Detalle<textarea className="ws-control" rows={2} maxLength={2000} value={detail} onChange={event => setEdited(setDetail,event.target.value)}/></label></div>}
        <div className="ws-contract-form-grid">
          <label>Proveedor<select className="ws-control" required disabled={isVersion || busy} value={supplierId} onChange={event => { setSupplierId(event.target.value); setLines([]); key.current = newKey() }}><option value="">Seleccionar proveedor activo</option>{suppliers.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>Moneda<select className="ws-control" value={currencyCode} disabled={busy} onChange={event => setEdited(setCurrencyCode,event.target.value as PurchaseContractCurrency)}><option value="PEN">PEN · Sol peruano</option><option value="USD">USD · Dólar estadounidense</option></select></label>
          <label>Vigencia desde<input className="ws-control" type="date" required value={start} onChange={event => setEdited(setStart,event.target.value)}/></label>
          <label>Vigencia hasta<input className="ws-control" type="date" required value={end} onChange={event => setEdited(setEnd,event.target.value)}/></label>
          <label>Tope monetario bruto ({currencyCode})<input className="ws-control" type="number" min="0.01" step="0.01" required value={cap} onChange={event => setEdited(setCap,event.target.value)}/></label>
          <label className="ws-contract-span">Condiciones generales<textarea className="ws-control" rows={2} maxLength={4000} value={terms} onChange={event => setEdited(setTerms,event.target.value)}/></label>
        </div>
        {isVersion && <label>Motivo del versionado<textarea className="ws-control" rows={2} maxLength={500} minLength={5} required value={reason} onChange={event => setEdited(setReason,event.target.value)} placeholder="Actualización de precio, vigencia o condiciones…"/></label>}
        <section className="ws-contract-lines-editor"><div className="ws-card-heading"><div><h3>Líneas del catálogo</h3><p>Solo se puede agregar artículos del proveedor elegido; máximo bruto estimado: {currency(capacity,currencyCode)}.</p></div>
          <select className="ws-control" aria-label="Agregar artículo del catálogo" disabled={!supplierId || catalogLoading || busy} value="" onChange={event => addLine(event.target.value)}><option value="">{catalogLoading ? 'Cargando catálogo…' : 'Agregar artículo'}</option>{catalog.filter(item => item.producto_id && !selectedIds.has(item.id)).map(item => <option key={item.id} value={item.id}>{item.nombre} · {currency(Number(item.costo),currencyCode)}</option>)}</select></div>
          {catalogError && <p className="ws-notice ws-notice-warning" role="alert">{catalogError}</p>}
          {!catalogLoading && supplierId && !catalog.some(item => item.producto_id) && <p className="ws-contract-muted">El proveedor no tiene artículos vinculados a productos maestros para una orden.</p>}
          {lines.map(line => <div className="ws-contract-line-editor" key={line.localId}>
            <div className="ws-contract-line-heading"><strong>{line.descripcion}</strong><button className="ws-text-button" type="button" disabled={busy} onClick={() => { key.current = newKey(); setLines(current => current.filter(item => item.localId !== line.localId)) }}>Quitar</button></div>
            <div className="ws-contract-line-fields"><label>Descripción<input className="ws-control" maxLength={500} value={line.descripcion} onChange={event => updateLine(line.localId,{descripcion:event.target.value})}/></label><label>Unidad<input className="ws-control" maxLength={40} value={line.unidad} onChange={event => updateLine(line.localId,{unidad:event.target.value})}/></label><label>Cantidad tope<input className="ws-control" type="number" min="1" step="1" value={line.cantidad_tope} onChange={event => updateLine(line.localId,{cantidad_tope:Number(event.target.value)})}/></label><label>Precio unitario<input className="ws-control" type="number" min="0" step="0.01" value={line.costo_unitario} onChange={event => updateLine(line.localId,{costo_unitario:Number(event.target.value)})}/></label><label>Impuesto<select className="ws-control" value={line.tratamiento_tributario} onChange={event => { const treatment=event.target.value as PurchaseContractTaxTreatment; updateLine(line.localId,{tratamiento_tributario:treatment,tasa_tributaria:taxRate(treatment)}) }}><option value="Gravado">Gravado · 18%</option><option value="Exonerado">Exonerado · 0%</option><option value="Inafecto">Inafecto · 0%</option></select></label><label>Condición de línea<input className="ws-control" maxLength={1000} value={line.condiciones ?? ''} onChange={event => updateLine(line.localId,{condiciones:event.target.value})}/></label></div>
            <small>Tope bruto estimado de esta línea: {currency(lineGross(line),currencyCode)} · Producto de proveedor: {line.proveedor_producto_id}</small>
          </div>)}
          {!lines.length && <div className="ws-empty-compact"><FilePlus2 size={24}/><strong>Agrega productos para definir sus límites</strong></div>}
        </section>
        {error && <p className="ws-notice ws-notice-warning" role="alert"><AlertTriangle size={15}/>{error}</p>}
      </div>
      <footer><button className="ws-button ws-button-secondary" type="button" disabled={busy} onClick={onClose}>Cancelar</button><button className="ws-button" type="submit" disabled={busy || !lines.length}>{busy ? 'Guardando…' : isVersion ? 'Guardar versión borrador' : 'Crear contrato'}</button></footer>
    </form>
  </div>
}

function OrderFromContractDialog({ contract, onClose, onCreated }: {
  contract: PurchaseContractSummary
  onClose: () => void
  onCreated: () => void
}) {
  const [quantities, setQuantities] = useState<Record<string,string>>({})
  const [dueDate, setDueDate] = useState('')
  const [exchangeRate, setExchangeRate] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const key = useRef(newKey())
  const currencyCode = contract.version?.moneda ?? 'PEN'
  const amountLeft = Math.max(0, Number(contract.version?.monto_tope ?? 0) - contract.monto_comprometido)
  const selected = contract.lineas.flatMap(line => {
    const qty = Number(quantities[line.id] ?? 0)
    return qty > 0 ? [{ line, qty }] : []
  })
  const total = selected.reduce((sum, item) => {
    const base = Math.round(item.qty * Number(item.line.costo_unitario) * 100) / 100
    const tax = item.line.tratamiento_tributario === 'Gravado' ? Math.round(base * 0.18 * 100) / 100 : 0
    return sum + base + tax
  }, 0)
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError('')
    if (!selected.length) return setError('Indica una cantidad en al menos una línea.')
    if (selected.some(({line,qty}) => qty > Number(line.cantidad_tope)-Number(line.cantidad_comprometida) || !Number.isInteger(qty))) return setError('La cantidad debe ser entera y no superar el saldo de cada línea.')
    if (total > amountLeft + 0.00001) return setError(`El total bruto ${currency(total,currencyCode)} excede el saldo ${currency(amountLeft,currencyCode)}.`)
    const rate = currencyCode === 'USD' ? Number(exchangeRate) : 1
    if (!Number.isFinite(rate) || rate <= 0) return setError('El tipo de cambio debe ser positivo para órdenes en USD.')
    setBusy(true)
    try {
      await createPurchaseOrderFromContract({
        contractId: contract.id, versionId: contract.version!.id, detail: `Liberación del contrato ${contract.codigo}`,
        dueDate: dueDate || null,
        lines: selected.map(({line,qty}) => ({ proveedor_producto_id: line.proveedor_producto_id, cantidad: qty,
          precio: Number(line.costo_unitario), tratamiento_tributario: line.tratamiento_tributario,
          tasa_tributaria: Number(line.tasa_tributaria) })),
        idempotencyKey: key.current, exchangeRate: rate, currency: currencyCode,
      })
      onCreated()
    } catch (cause) { setError(errorMessage(cause)) }
    finally { setBusy(false) }
  }
  return <div className="ws-modal-backdrop" onMouseDown={event => { if (event.target===event.currentTarget && !busy) onClose() }}><form className="ws-dialog ws-contract-order-dialog" role="dialog" aria-modal="true" aria-labelledby="contract-order-title" onSubmit={event => void submit(event)}>
    <header><div><span className="ws-eyebrow">F13 · LIBERACIÓN DE CUPO</span><h2 id="contract-order-title">Orden desde {contract.codigo}</h2><p>Versión {contract.version?.numero_version} · tope libre {currency(amountLeft,currencyCode)}</p></div><button className="ws-icon-button" type="button" disabled={busy} onClick={onClose} aria-label="Cerrar"><X size={18}/></button></header>
    <div className="ws-contract-editor-body"><label>Fecha límite de pago<input className="ws-control" type="date" value={dueDate} onChange={event => {setDueDate(event.target.value);key.current=newKey()}}/></label>{currencyCode==='USD' && <label>Tipo de cambio<input className="ws-control" type="number" min="0.000001" step="0.000001" value={exchangeRate} onChange={event => {setExchangeRate(event.target.value);key.current=newKey()}} required/></label>}
      <div className="table-scroll"><table className="record-table"><thead><tr><th>Artículo</th><th>Disponible</th><th>Precio</th><th>Solicitar</th></tr></thead><tbody>{contract.lineas.map(line => {const available=Math.max(0,Number(line.cantidad_tope)-Number(line.cantidad_comprometida));return <tr key={line.id}><td><strong>{line.descripcion}</strong><small>{line.unidad} · {line.tratamiento_tributario} · máximo {line.cantidad_tope}</small></td><td>{available}</td><td>{currency(Number(line.costo_unitario),currencyCode)}</td><td><input className="ws-control ws-contract-quantity" type="number" min="0" max={available} step="1" value={quantities[line.id] ?? '0'} disabled={!available || busy} onChange={event => {setQuantities(current => ({...current,[line.id]:event.target.value}));key.current=newKey()}} aria-label={`Cantidad a ordenar para ${line.descripcion}`}/></td></tr>})}</tbody></table></div>
      <div className="ws-contract-order-total"><span>Orden bruto estimado</span><strong>{currency(total,currencyCode)}</strong><small>Disponible luego de esta orden: {currency(Math.max(0,amountLeft-total),currencyCode)}</small></div>
      {error && <p className="ws-notice ws-notice-warning" role="alert"><AlertTriangle size={15}/>{error}</p>}
    </div><footer><button className="ws-button ws-button-secondary" type="button" disabled={busy} onClick={onClose}>Cancelar</button><button className="ws-button" type="submit" disabled={busy || !selected.length}><ArrowDownToLine size={15}/>{busy?'Creando orden…':'Generar orden'}</button></footer>
  </form></div>
}

export default function PurchaseContractsPage() {
  const { can, profile } = useAuth()
  const { records, notify, reload } = useRecords()
  const [items, setItems] = useState<PurchaseContractSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [stateFilter, setStateFilter] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [editor, setEditor] = useState<ContractFormMode | null>(null)
  const [orderContract, setOrderContract] = useState<PurchaseContractSummary | null>(null)
  const [suspendTarget, setSuspendTarget] = useState<PurchaseContractSummary | null>(null)
  const [suspensionReason, setSuspensionReason] = useState('')
  const [closeTarget, setCloseTarget] = useState<PurchaseContractSummary | null>(null)
  const [closureReason, setClosureReason] = useState('')
  const transitionKeys = useRef(new Map<string,string>())
  const suppliers: SupplierChoice[] = useMemo(() => records.suppliers.flatMap(supplier => supplier.rowId && supplier.status==='Activo' ? [{id:supplier.rowId,name:supplier.name}] : []), [records.suppliers])
  const pageCount = Math.max(1,Math.ceil(total/PAGE_SIZE))
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const result = await fetchPurchaseContracts({estado:stateFilter,search,limit:PAGE_SIZE,offset:page*PAGE_SIZE})
      setItems(result.items); setTotal(result.total)
    } catch (cause) { setError(errorMessage(cause)) }
    finally { setLoading(false) }
  }, [stateFilter,search,page])
  useEffect(() => { void load() },[load])

  const actionKey = (id: string, action: string) => {
    const key=`${action}:${id}`
    if (!transitionKeys.current.has(key)) transitionKeys.current.set(key,newKey())
    return transitionKeys.current.get(key)!
  }
  const refreshAfterAction = async (message: string) => { await load(); await reload(); notify(message) }
  const activate = async (contract: PurchaseContractSummary) => {
    if (!contract.version || !can('purchases','editar')) return
    setBusyId(contract.id); setError('')
    try { await activatePurchaseContract(contract.id,contract.version.id,actionKey(contract.id,'activate')); transitionKeys.current.delete(`activate:${contract.id}`); await refreshAfterAction(`${contract.codigo} activado. La activación no genera CxP ni inventario.`) }
    catch (cause) { setError(errorMessage(cause)) }
    finally { setBusyId(null) }
  }
  const suspend = async (event: FormEvent) => {
    event.preventDefault()
    const contract=suspendTarget
    const reason=suspensionReason.trim()
    if (!contract || reason.length<5) return
    setBusyId(contract.id); setError('')
    try { await suspendPurchaseContract(contract.id,reason,actionKey(contract.id,'suspend')); transitionKeys.current.delete(`suspend:${contract.id}`); setSuspendTarget(null);setSuspensionReason(''); await refreshAfterAction(`${contract.codigo} suspendido; no admite nuevas liberaciones.`) }
    catch (cause) { setError(errorMessage(cause)) }
    finally { setBusyId(null) }
  }
  const closeContract = async (event: FormEvent) => {
    event.preventDefault()
    const contract=closeTarget
    const reason=closureReason.trim()
    if (!contract || reason.length<5 || !canEdit) return
    setBusyId(contract.id); setError('')
    try {
      await closePurchaseContract(contract.id,reason,actionKey(contract.id,'close'))
      transitionKeys.current.delete(`close:${contract.id}`)
      setCloseTarget(null); setClosureReason('')
      await refreshAfterAction(`${contract.codigo} cerrado permanentemente. Sus órdenes existentes siguen su curso.`)
    } catch (cause) { setError(errorMessage(cause)) }
    finally { setBusyId(null) }
  }
  const saved = () => { setEditor(null); void refreshAfterAction('Contrato actualizado; sus snapshots se conservaron por versión.') }
  const orderCreated = () => { setOrderContract(null); void refreshAfterAction('Orden creada y cupo contractual comprometido de forma transaccional.') }
  const canCreate = can('purchases','crear')
  const canEdit = can('purchases','editar')

  return <>
    <section className="ws-page-heading"><div><span className="ws-eyebrow">COMPRAS · CONTRATOS MARCO</span><h1>Contratos Marco</h1><p>Consulta vigencias, versiones y cupo comprometido. Los excesos se bloquean en servidor con tolerancia 0%.</p></div><div className="ws-heading-actions"><button className="ws-button ws-button-secondary" type="button" disabled={loading} onClick={() => void load()}><RefreshCw size={16}/>Actualizar</button>{canCreate && <button className="ws-button" type="button" onClick={() => setEditor({kind:'create'})}><Plus size={16}/>Nuevo contrato</button>}</div></section>
    <section className="ws-card ws-contract-filters"><label className="ws-table-search"><Search size={16}/><input value={search} onChange={event => {setSearch(event.target.value);setPage(0)}} placeholder="Buscar código o nombre…" aria-label="Buscar contratos"/></label><label>Estado<select className="ws-control" value={stateFilter} onChange={event => {setStateFilter(event.target.value);setPage(0)}}><option value="">Todos los estados</option><option value="Borrador">Borrador</option><option value="Activo">Activo</option><option value="Suspendido">Suspendido</option><option value="Cerrado">Cerrado</option></select></label><span>{total} contratos</span></section>
    {error && <div className="ws-notice ws-notice-warning" role="alert"><AlertTriangle size={17}/>{error}<button className="ws-text-button" type="button" onClick={() => void load()}>Reintentar</button></div>}
    <section className="ws-card ws-contract-list"><div className="table-scroll"><table className="record-table"><thead><tr><th>Contrato / proveedor</th><th>Estado</th><th>Vigencia</th><th>Tope bruto</th><th>Consumo</th><th>Disponible</th><th>Acciones</th></tr></thead><tbody>
      {items.map(contract => {
        const supplier=suppliers.find(item=>item.id===contract.proveedor_id)?.name ?? contract.proveedor_id
        const version=contract.version
        const used=contract.monto_comprometido
        const cap=Number(version?.monto_tope ?? 0)
        const remaining=Math.max(0,cap-used)
        const percent=contract.porcentaje_consumido
        const critical=percent>=95
        const high=percent>=80
        const statusClass=contract.estado==='Activo'?'is-active':contract.estado==='Suspendido'?'is-paused':contract.estado==='Borrador'?'is-draft':'is-closed'
        return <tr key={contract.id} className="ws-contract-row"><td><button className="ws-contract-title" type="button" onClick={()=>setExpanded(current=>current===contract.id?null:contract.id)}><span><strong>{contract.codigo} · {contract.nombre}</strong><small>{supplier} · responsable {contract.responsable_id===profile?.id?profile?.nombre:contract.responsable_id}</small></span><ChevronDown size={15} className={expanded===contract.id?'is-open':''}/></button></td><td><span className={`ws-contract-status ${statusClass}`}>{contract.estado}</span>{contract.estado==='Cerrado'&&<small>Terminal · {contract.cerrado_en ? new Date(contract.cerrado_en).toLocaleDateString('es-PE') : ''}</small>}</td><td>{version ? <>{version.fecha_inicio} – {version.fecha_fin}<small>Versión {version.numero_version}</small></> : '—'}</td><td>{version?currency(cap,version.moneda):'—'}</td><td><div className={`ws-contract-usage ${critical?'is-critical':high?'is-high':''}`}><div><strong>{percent.toFixed(1)}%</strong><small>{currency(used,version?.moneda??'PEN')}</small></div><div className="ws-contract-progress"><i style={{width:`${Math.max(0,Math.min(percent,100))}%`}}/></div>{high&&<small className="ws-contract-alert"><AlertTriangle size={12}/>{critical?'Cupo en el límite':'Cupo próximo al límite'}</small>}</div></td><td>{version?currency(remaining,version.moneda):'—'}</td><td><div className="ws-contract-actions">
          {(contract.estado==='Borrador'||contract.estado==='Suspendido') && version?.estado==='Borrador' && canEdit && <button className="ws-button ws-button-secondary ws-button-compact" type="button" disabled={busyId===contract.id} onClick={()=>void activate(contract)}><CircleCheck size={14}/>Activar</button>}
          {contract.estado==='Activo' && canEdit && <button className="ws-button ws-button-secondary ws-button-compact" type="button" disabled={busyId===contract.id} onClick={()=>{setSuspendTarget(contract);setSuspensionReason('')}}><Ban size={14}/>Suspender</button>}
          {(contract.estado==='Suspendido'||contract.estado==='Borrador') && canEdit && <button className="ws-button ws-button-secondary ws-button-compact" type="button" disabled={busyId===contract.id} onClick={()=>setEditor({kind:'version',contract})}><FilePlus2 size={14}/>Versionar</button>}
          {contract.estado==='Activo' && canCreate && <button className="ws-button ws-button-compact" type="button" disabled={!version || !contract.lineas.length || busyId===contract.id} onClick={()=>setOrderContract(contract)}><ArrowDownToLine size={14}/>Generar orden</button>}
          {contract.estado!=='Cerrado' && canEdit && <button className="ws-button ws-button-danger ws-button-compact" type="button" disabled={busyId===contract.id} onClick={()=>{setCloseTarget(contract);setClosureReason('')}}><X size={14}/>Cerrar contrato</button>}
        </div></td></tr>})}
      {!items.length && <tr><td colSpan={7}><div className="ws-empty-compact">{loading?<RefreshCw size={24} className="ws-spin"/>:<ShieldCheck size={24}/>}<strong>{loading?'Consultando contratos…':error?'No se pudieron cargar los contratos':'No hay contratos con estos filtros'}</strong></div></td></tr>}
      {expanded && items.find(item=>item.id===expanded) && (()=>{const contract=items.find(item=>item.id===expanded)!;return <tr className="ws-contract-expanded" key={`${expanded}-detail`}><td colSpan={7}><div className="ws-contract-expanded-body"><div className="ws-contract-expanded-heading"><div><strong>Versión {contract.version?.numero_version ?? '—'} · {contract.version?.condiciones || 'Sin condiciones generales'}</strong><small>Responsable: {contract.responsable_id===profile?.id?profile?.nombre:contract.responsable_id} · Moneda {contract.version?.moneda ?? '—'}</small></div><div>{contract.suspension_motivo&&<span>Suspensión: {contract.suspension_motivo}</span>}{contract.cierre_motivo&&<span>Cierre: {contract.cierre_motivo} · actor {contract.cerrado_por===profile?.id?profile?.nombre:contract.cerrado_por}</span>}</div></div><div className="table-scroll"><table className="record-table"><thead><tr><th>Línea</th><th>Cantidad comprometida</th><th>Tope de cantidad</th><th>Disponible</th><th>Precio unitario</th><th>Impuesto</th></tr></thead><tbody>{contract.lineas.map(line=><tr key={line.id}><td><strong>{line.descripcion}</strong><small>{line.unidad} · {line.condiciones||'Sin condición específica'}</small></td><td>{line.cantidad_comprometida}</td><td>{line.cantidad_tope}</td><td>{Math.max(0,Number(line.cantidad_tope)-line.cantidad_comprometida)}</td><td>{currency(Number(line.costo_unitario),contract.version?.moneda??'PEN')}</td><td>{line.tratamiento_tributario} · {line.tasa_tributaria}%</td></tr>)}{!contract.lineas.length&&<tr><td colSpan={6}>No hay líneas para la versión actual.</td></tr>}</tbody></table></div></div></td></tr>})()}
      </tbody></table></div>
      {total>PAGE_SIZE&&<div className="ws-pagination"><span>Mostrando {page*PAGE_SIZE+1}–{Math.min((page+1)*PAGE_SIZE,total)} de {total}</span><div><button className="ws-icon-button" type="button" disabled={page===0||loading} onClick={()=>setPage(value=>Math.max(0,value-1))} aria-label="Página anterior"><ChevronLeft size={15}/></button><span>{page+1} / {pageCount}</span><button className="ws-icon-button" type="button" disabled={page+1>=pageCount||loading} onClick={()=>setPage(value=>Math.min(pageCount-1,value+1))} aria-label="Página siguiente"><ChevronRight size={15}/></button></div></div>}
    </section>
    {editor && <ContractEditor key={editor.kind==='create'?'new':`version-${editor.contract.id}`} mode={editor} suppliers={suppliers} responsibleId={profile?.id ?? ''} onClose={()=>setEditor(null)} onSaved={saved}/>}
    {orderContract&&<OrderFromContractDialog contract={orderContract} onClose={()=>setOrderContract(null)} onCreated={orderCreated}/>}
    {suspendTarget&&<div className="ws-modal-backdrop"><form className="ws-dialog ws-contract-suspend-dialog" role="dialog" aria-modal="true" aria-labelledby="contract-suspend-title" onSubmit={event=>void suspend(event)}><header><div><span className="ws-eyebrow">CONTROL DE CONTRATO</span><h2 id="contract-suspend-title">Suspender {suspendTarget.codigo}</h2><p>La suspensión bloqueará nuevas liberaciones, sin modificar órdenes existentes.</p></div><button className="ws-icon-button" type="button" disabled={busyId===suspendTarget.id} onClick={()=>setSuspendTarget(null)} aria-label="Cerrar"><X size={18}/></button></header><div className="ws-contract-editor-body"><label>Motivo obligatorio<textarea className="ws-control" rows={4} minLength={5} maxLength={500} required value={suspensionReason} onChange={event=>{setSuspensionReason(event.target.value);transitionKeys.current.delete(`suspend:${suspendTarget.id}`)}} placeholder="Describe la causa de suspensión…"/></label>{error&&<p className="ws-notice ws-notice-warning" role="alert">{error}</p>}</div><footer><button className="ws-button ws-button-secondary" type="button" disabled={busyId===suspendTarget.id} onClick={()=>setSuspendTarget(null)}>Cancelar</button><button className="ws-button" type="submit" disabled={busyId===suspendTarget.id||suspensionReason.trim().length<5}><Ban size={15}/>{busyId===suspendTarget.id?'Suspendiendo…':'Confirmar suspensión'}</button></footer></form></div>}
    {closeTarget&&<div className="ws-modal-backdrop"><form className="ws-dialog ws-contract-suspend-dialog" role="dialog" aria-modal="true" aria-labelledby="contract-close-title" onSubmit={event=>void closeContract(event)}><header><div><span className="ws-eyebrow">ACCIÓN TERMINAL · F14</span><h2 id="contract-close-title">Cerrar {closeTarget.codigo}</h2><p>El cierre es irreversible: bloquea nuevas órdenes y cualquier cambio o reactivación. Las órdenes existentes siguen su curso.</p></div><button className="ws-icon-button" type="button" disabled={busyId===closeTarget.id} onClick={()=>setCloseTarget(null)} aria-label="Cerrar diálogo"><X size={18}/></button></header><div className="ws-contract-editor-body"><div className="ws-notice ws-notice-warning" role="note"><AlertTriangle size={15}/>Confirma que el contrato debe quedar cerrado permanentemente.</div><label>Motivo obligatorio<textarea className="ws-control" rows={4} minLength={5} maxLength={500} required value={closureReason} onChange={event=>{setClosureReason(event.target.value);transitionKeys.current.delete(`close:${closeTarget.id}`)}} placeholder="Explica por qué se cierra el contrato…"/></label>{error&&<p className="ws-notice ws-notice-warning" role="alert">{error}</p>}</div><footer><button className="ws-button ws-button-secondary" type="button" disabled={busyId===closeTarget.id} onClick={()=>setCloseTarget(null)}>Cancelar</button><button className="ws-button ws-button-danger" type="submit" disabled={busyId===closeTarget.id||closureReason.trim().length<5}><X size={15}/>{busyId===closeTarget.id?'Cerrando…':'Cerrar permanentemente'}</button></footer></form></div>}
  </>
}
