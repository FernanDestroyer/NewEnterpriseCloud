import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { AlertTriangle, ArrowLeft, ArrowRight, Ban, Check, ChevronLeft, ChevronRight, CircleCheck, Clock3, FilePlus2, Info, PackageCheck, Plus, RefreshCw, Search, Ship, Truck, Warehouse, X } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useRecords } from '../context/RecordsContext'
import { fetchActiveWarehouses, type ActiveWarehouse } from '../services/records'
import {
  createImportFolder, fetchAvailableImportOrders, fetchImportFolderDetail, fetchImportFolders,
  linkImportOrder, nationalizeImportFolder, registerImportExpense, unlinkImportOrder, updateImportFolderState,
  type AvailableImportOrder, type ImportFolderDetail, type ImportFolderSummary,
} from '../services/importFolders'
import type { ImportExpenseType, ImportFolderStatus } from '../types/imports'

const PAGE_SIZE = 10
const newKey = () => globalThis.crypto?.randomUUID?.() ?? `import-${Date.now()}-${Math.random().toString(36).slice(2)}`
const expenseTypes: ImportExpenseType[] = ['Flete','Seguro','Arancel/Advalorem','Agente de Aduanas','Otros']
const currency = (value: number, code: 'PEN'|'USD' = 'USD') => new Intl.NumberFormat('es-PE',{style:'currency',currency:code,minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(value)||0)

function friendlyError(error: unknown) {
  const message = (error as {message?:string}|null)?.message ?? 'No se pudo completar la operación.'
  if (message.includes('Could not find the function') || message.includes('does not exist')) return 'No se encontró un RPC de importaciones. Verifica que las migraciones 20261115000000 y 20261116000000 estén aplicadas en el proyecto configurado.'
  if (message.includes('permission') || message.includes('permiso')) return message
  return message
}

function statusTone(state: ImportFolderStatus) {
  if (state==='Nacionalizado') return 'is-active'
  if (state==='En Aduanas') return 'is-paused'
  if (state==='En Tránsito') return 'is-transit'
  if (state==='Cerrada') return 'is-closed'
  return 'is-draft'
}

function CreateFolderDialog({onClose,onCreated}:{onClose:()=>void;onCreated:(id:string)=>void}) {
  const [name,setName]=useState('')
  const [reference,setReference]=useState('')
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const key=useRef(newKey())
  const submit=async(event:FormEvent)=>{
    event.preventDefault();setError('')
    if(name.trim().length<3)return setError('El nombre requiere al menos 3 caracteres.')
    setBusy(true)
    try { const id=await createImportFolder({nombre:name.trim(),referencia:reference.trim(),idempotencyKey:key.current});onCreated(id) }
    catch(cause){setError(friendlyError(cause))} finally{setBusy(false)}
  }
  return <div className="ws-modal-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget&&!busy)onClose()}}><form className="ws-dialog ws-import-dialog" role="dialog" aria-modal="true" aria-labelledby="import-create-title" onSubmit={event=>void submit(event)}>
    <header><div><span className="ws-eyebrow">IMPORTACIONES · NUEVA CARPETA</span><h2 id="import-create-title">Crear carpeta de importación</h2><p>La moneda de la carpeta y del prorrateo es USD.</p></div><button className="ws-icon-button" type="button" onClick={onClose} disabled={busy} aria-label="Cerrar"><X size={18}/></button></header>
    <div className="ws-import-dialog-body"><label>Nombre de carpeta<input className="ws-control" required minLength={3} maxLength={180} autoFocus value={name} onChange={event=>{setName(event.target.value);key.current=newKey()}} placeholder="Importación de maquinaria Q4"/></label><label>Referencia o descripción<textarea className="ws-control" rows={3} maxLength={500} value={reference} onChange={event=>{setReference(event.target.value);key.current=newKey()}} placeholder="Factura proforma, proveedor, embarque…"/></label>{error&&<p className="ws-notice ws-notice-warning" role="alert"><AlertTriangle size={15}/>{error}</p>}</div>
    <footer><button className="ws-button ws-button-secondary" type="button" disabled={busy} onClick={onClose}>Cancelar</button><button className="ws-button" type="submit" disabled={busy}>{busy?'Creando…':'Crear carpeta'}</button></footer>
  </form></div>
}

function LinkOrdersDialog({folderId, suppliers, onClose, onLinked}:{
  folderId:string;suppliers:Array<{id:string;name:string}>;onClose:()=>void;onLinked:()=>void
}) {
  const [orders,setOrders]=useState<AvailableImportOrder[]>([])
  const [loading,setLoading]=useState(true)
  const [busyId,setBusyId]=useState<string|null>(null)
  const [error,setError]=useState('')
  const [providerId,setProviderId]=useState('')
  const [search,setSearch]=useState('')
  const keys=useRef(new Map<string,string>())
  useEffect(()=>{let active=true;fetchAvailableImportOrders().then(rows=>{if(active)setOrders(rows)}).catch(cause=>{if(active)setError(friendlyError(cause))}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[])
  const filtered=useMemo(()=>orders.filter(order=>(!providerId||order.proveedor_id===providerId)&&(!search||`${order.codigo} ${order.proveedor_nombre}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()))),[orders,providerId,search])
  const add=async(order:AvailableImportOrder)=>{
    setBusyId(order.id);setError('')
    if(!keys.current.has(order.id))keys.current.set(order.id,newKey())
    try{await linkImportOrder(folderId,order.id,keys.current.get(order.id)!);keys.current.delete(order.id);setOrders(current=>current.filter(row=>row.id!==order.id));onLinked()}
    catch(cause){setError(friendlyError(cause))}finally{setBusyId(null)}
  }
  return <div className="ws-modal-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget&&!busyId)onClose()}}><section className="ws-dialog ws-import-link-dialog" role="dialog" aria-modal="true" aria-labelledby="import-link-title">
    <header><div><span className="ws-eyebrow">G11 · VINCULAR ÓRDENES</span><h2 id="import-link-title">Órdenes disponibles</h2><p>Solo aparecen órdenes confirmadas en USD, pendientes y sin recepción ni carpeta previa.</p></div><button className="ws-icon-button" type="button" onClick={onClose} aria-label="Cerrar"><X size={18}/></button></header>
    <div className="ws-import-dialog-body"><div className="ws-import-toolbar"><label className="ws-table-search"><Search size={15}/><input value={search} onChange={event=>setSearch(event.target.value)} placeholder="Buscar código o proveedor…" aria-label="Buscar órdenes"/></label><label>Proveedor<select className="ws-control" value={providerId} onChange={event=>setProviderId(event.target.value)}><option value="">Todos</option>{suppliers.map(supplier=><option value={supplier.id} key={supplier.id}>{supplier.name}</option>)}</select></label></div>
      {error&&<p className="ws-notice ws-notice-warning" role="alert"><AlertTriangle size={15}/>{error}</p>}
      <div className="table-scroll"><table className="record-table"><thead><tr><th>Orden</th><th>Proveedor</th><th className="ws-num">Importe</th><th className="ws-num">Tipo de cambio</th><th></th></tr></thead><tbody>{filtered.map(order=><tr key={order.id}><td><strong>{order.codigo}</strong></td><td>{order.proveedor_nombre}</td><td className="ws-num">{currency(Number(order.monto))}</td><td className="ws-num">{Number(order.exchange_rate).toFixed(6)}</td><td><button className="ws-button ws-button-compact" type="button" disabled={busyId!==null} onClick={()=>void add(order)}><Plus size={14}/>{busyId===order.id?'Vinculando…':'Vincular'}</button></td></tr>)}
        {!filtered.length&&<tr><td colSpan={5}><div className="ws-empty-compact">{loading?<RefreshCw size={22} className="ws-spin"/>:<PackageCheck size={22}/>}<strong>{loading?'Buscando órdenes elegibles…':'No hay órdenes elegibles con este filtro'}</strong><span>Las órdenes con recepción iniciada no se pueden vincular.</span></div></td></tr>}</tbody></table></div>
    </div><footer><button className="ws-button ws-button-secondary" type="button" disabled={busyId!==null} onClick={onClose}>Cerrar</button></footer>
  </section></div>
}

function ExpenseForm({folderId,onSaved}:{folderId:string;onSaved:()=>void}) {
  const [type,setType]=useState<ImportExpenseType>('Flete')
  const [description,setDescription]=useState('')
  const [amount,setAmount]=useState('')
  const [currencyCode,setCurrencyCode]=useState<'USD'|'PEN'>('USD')
  const [exchangeRate,setExchangeRate]=useState('')
  const [reference,setReference]=useState('')
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const key=useRef(newKey())
  const editKey=()=>{key.current=newKey()}
  const normalized=currencyCode==='USD'?Number(amount):Number(amount)/Number(exchangeRate)
  const submit=async(event:FormEvent)=>{
    event.preventDefault();setError('')
    if(!description.trim()||!Number.isFinite(Number(amount))||Number(amount)<=0)return setError('Completa la descripción y un importe mayor que cero.')
    if(currencyCode==='PEN'&&(!Number.isFinite(Number(exchangeRate))||Number(exchangeRate)<=0))return setError('El tipo de cambio debe indicar PEN por USD y ser mayor que cero.')
    setBusy(true)
    try{await registerImportExpense({carpeta_id:folderId,tipo:type,descripcion:description.trim(),monto:Number(amount),moneda:currencyCode,tipo_cambio:currencyCode==='PEN'?Number(exchangeRate):1,referencia:reference.trim(),idempotency_key:key.current});onSaved();setDescription('');setAmount('');setExchangeRate('');setReference('');key.current=newKey()}
    catch(cause){setError(friendlyError(cause))}finally{setBusy(false)}
  }
  return <form className="ws-import-expense-form" onSubmit={event=>void submit(event)}><div className="ws-import-expense-fields">
    <label>Tipo de gasto<select className="ws-control" value={type} onChange={event=>{setType(event.target.value as ImportExpenseType);editKey()}}>{expenseTypes.map(value=><option key={value}>{value}</option>)}</select></label>
    <label>Descripción<input className="ws-control" maxLength={500} required value={description} onChange={event=>{setDescription(event.target.value);editKey()}} placeholder="Flete marítimo…"/></label>
    <label>Importe<input className="ws-control" type="number" min="0.01" step="0.01" required value={amount} onChange={event=>{setAmount(event.target.value);editKey()}}/></label>
    <label>Moneda<select className="ws-control" value={currencyCode} onChange={event=>{setCurrencyCode(event.target.value as 'USD'|'PEN');editKey()}}><option value="USD">USD</option><option value="PEN">PEN</option></select></label>
    {currencyCode==='PEN'&&<label>Tipo de cambio (PEN por USD)<input className="ws-control" type="number" min="0.000001" step="0.000001" required value={exchangeRate} onChange={event=>{setExchangeRate(event.target.value);editKey()}}/></label>}
    <label>Referencia<input className="ws-control" maxLength={300} value={reference} onChange={event=>{setReference(event.target.value);editKey()}} placeholder="Factura / comprobante"/></label>
    </div><div className="ws-import-expense-submit"><span>Al prorrateo: <strong>{currency(Number.isFinite(normalized)?normalized:0)}</strong></span><button className="ws-button ws-button-compact" type="submit" disabled={busy}>{busy?'Registrando…':<><Plus size={14}/>Registrar gasto</>}</button></div>{error&&<p className="ws-notice ws-notice-warning" role="alert"><AlertTriangle size={15}/>{error}</p>}</form>
}

function StateDialog({folder,onClose,onSubmit}:{folder:ImportFolderSummary;onClose:()=>void;onSubmit:(target:'En Tránsito'|'En Aduanas',reason:string,key:string)=>Promise<void>}) {
  const target=folder.estado==='Abierta'?'En Tránsito':'En Aduanas'
  const [reason,setReason]=useState('')
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const key=useRef(newKey())
  const submit=async(event:FormEvent)=>{event.preventDefault();if(reason.trim().length<5)return setError('Indica un motivo de al menos 5 caracteres.');setBusy(true);setError('');try{await onSubmit(target,reason.trim(),key.current)}catch(cause){setError(friendlyError(cause))}finally{setBusy(false)}}
  return <div className="ws-modal-backdrop"><form className="ws-dialog ws-import-dialog" role="dialog" aria-modal="true" aria-labelledby="import-state-title" onSubmit={event=>void submit(event)}><header><div><span className="ws-eyebrow">TRACKING DE IMPORTACIÓN</span><h2 id="import-state-title">Avanzar a {target}</h2><p>La transición se registra con actor, fecha y motivo y no se puede omitir la etapa.</p></div><button className="ws-icon-button" type="button" disabled={busy} onClick={onClose} aria-label="Cerrar"><X size={18}/></button></header><div className="ws-import-dialog-body"><label>Motivo obligatorio<textarea className="ws-control" rows={3} minLength={5} maxLength={500} required value={reason} onChange={event=>{setReason(event.target.value);key.current=newKey()}} placeholder="Describe el avance logístico…"/></label>{error&&<p className="ws-notice ws-notice-warning" role="alert">{error}</p>}</div><footer><button className="ws-button ws-button-secondary" type="button" disabled={busy} onClick={onClose}>Cancelar</button><button className="ws-button" type="submit" disabled={busy||reason.trim().length<5}><ArrowRight size={15}/>{busy?'Actualizando…':`Confirmar ${target}`}</button></footer></form></div>
}

function NationalizeDialog({folder,warehouses,onClose,onSubmit}:{folder:ImportFolderSummary;warehouses:ActiveWarehouse[];onClose:()=>void;onSubmit:(warehouseId:string,reason:string,key:string)=>Promise<void>}) {
  const [warehouseId,setWarehouseId]=useState('')
  const [reason,setReason]=useState('')
  const [confirmed,setConfirmed]=useState(false)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const key=useRef(newKey())
  const submit=async(event:FormEvent)=>{event.preventDefault();if(!warehouseId)return setError('Selecciona el almacén de destino.');if(reason.trim().length<5)return setError('Indica el motivo de nacionalización (mínimo 5 caracteres).');if(!confirmed)return setError('Confirma expresamente la recepción de todas las líneas.');setBusy(true);setError('');try{await onSubmit(warehouseId,reason.trim(),key.current)}catch(cause){setError(friendlyError(cause))}finally{setBusy(false)}}
  return <div className="ws-modal-backdrop"><form className="ws-dialog ws-import-dialog ws-import-critical-dialog" role="dialog" aria-modal="true" aria-labelledby="import-nationalize-title" onSubmit={event=>void submit(event)}><header><div><span className="ws-eyebrow">ACCIÓN CRÍTICA · G14</span><h2 id="import-nationalize-title">Nacionalizar {folder.codigo}</h2><p>Se recibirán todas las líneas de todas las órdenes en una sola transacción.</p></div><button className="ws-icon-button" type="button" disabled={busy} onClick={onClose} aria-label="Cerrar"><X size={18}/></button></header><div className="ws-import-dialog-body"><div className="ws-notice ws-notice-warning" role="note"><AlertTriangle size={16}/>El inventario y Kardex ingresarán con costo Landed Cost; la CxP seguirá basada en el importe FOB original. La operación no se puede deshacer desde esta pantalla.</div><label>Almacén de destino<select className="ws-control" required value={warehouseId} onChange={event=>{setWarehouseId(event.target.value);key.current=newKey()}}><option value="">Seleccionar almacén activo…</option>{warehouses.map(warehouse=><option key={warehouse.id} value={warehouse.id}>{warehouse.nombre}</option>)}</select></label><label>Motivo de nacionalización<textarea className="ws-control" rows={3} minLength={5} maxLength={500} required value={reason} onChange={event=>{setReason(event.target.value);key.current=newKey()}} placeholder="Documento y motivo de ingreso al almacén…"/></label><label className="ws-import-explicit-confirm"><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/><span>Confirmo que quiero recibir todas las órdenes vinculadas y nacionalizar esta carpeta.</span></label>{error&&<p className="ws-notice ws-notice-warning" role="alert">{error}</p>}</div><footer><button className="ws-button ws-button-secondary" type="button" disabled={busy} onClick={onClose}>Cancelar</button><button className="ws-button ws-button-danger" type="submit" disabled={busy||!warehouseId||!confirmed||reason.trim().length<5}><PackageCheck size={15}/>{busy?'Nacionalizando…':'Nacionalizar y recibir'}</button></footer></form></div>
}

export default function ImportFoldersPage() {
  const {can}=useAuth()
  const {records,notify,reload}=useRecords()
  const [items,setItems]=useState<ImportFolderSummary[]>([])
  const [loading,setLoading]=useState(true)
  const [page,setPage]=useState(0)
  const [total,setTotal]=useState(0)
  const [stateFilter,setStateFilter]=useState('')
  const [supplierFilter,setSupplierFilter]=useState('')
  const [error,setError]=useState('')
  const [detail,setDetail]=useState<ImportFolderDetail|null>(null)
  const [detailLoading,setDetailLoading]=useState(false)
  const [detailError,setDetailError]=useState('')
  const [detailTargetId,setDetailTargetId]=useState('')
  const [showCreate,setShowCreate]=useState(false)
  const [showLink,setShowLink]=useState(false)
  const [stateTarget,setStateTarget]=useState<ImportFolderSummary|null>(null)
  const [nationalizeTarget,setNationalizeTarget]=useState<ImportFolderSummary|null>(null)
  const [warehouses,setWarehouses]=useState<ActiveWarehouse[]>([])
  const [busy,setBusy]=useState(false)
  const actionKeys=useRef(new Map<string,string>())
  const suppliers=useMemo(()=>records.suppliers.flatMap(supplier=>supplier.rowId?[{id:supplier.rowId,name:supplier.name}]:[]),[records.suppliers])
  const supplierName=(id:string)=>suppliers.find(supplier=>supplier.id===id)?.name??id
  const pageCount=Math.max(1,Math.ceil(total/PAGE_SIZE))
  const load=useCallback(async()=>{setLoading(true);setError('');try{const result=await fetchImportFolders({estado:stateFilter,proveedorId:supplierFilter,limit:PAGE_SIZE,offset:page*PAGE_SIZE});setItems(result.items);setTotal(result.total)}catch(cause){setError(friendlyError(cause))}finally{setLoading(false)}},[stateFilter,supplierFilter,page])
  const loadDetail=useCallback(async(folderId:string)=>{setDetailTargetId(folderId);setDetailLoading(true);setDetailError('');try{setDetail(await fetchImportFolderDetail(folderId))}catch(cause){setDetailError(friendlyError(cause))}finally{setDetailLoading(false)}},[])
  useEffect(()=>{void load()},[load])
  const permissionRead=can('purchases','ver')
  const canCreate=can('purchases','crear')
  const canEdit=can('purchases','editar')
  const canReceive=can('inventory','crear')||can('inventory','editar')
  const pageSuppliers=useMemo(()=>suppliers.filter(supplier=>!supplierFilter||supplier.id===supplierFilter),[suppliers,supplierFilter])

  const refreshDetail=async(folderId=detail?.folder.id)=>{await load();if(folderId)await loadDetail(folderId)}
  const created=async(folderId:string)=>{setShowCreate(false);await load();await loadDetail(folderId);notify('Carpeta de importación creada en USD.')}
  const linked=async()=>{if(!detail)return;await refreshDetail(detail.folder.id);notify('Orden vinculada a la carpeta.')}
  const unlink=async(order:AvailableImportOrder|{id:string;codigo:string})=>{
    if(!detail)return
    const mapKey=`unlink:${order.id}`;if(!actionKeys.current.has(mapKey))actionKeys.current.set(mapKey,newKey())
    setBusy(true);setDetailError('')
    try{await unlinkImportOrder(detail.folder.id,order.id,actionKeys.current.get(mapKey)!);actionKeys.current.delete(mapKey);await refreshDetail(detail.folder.id);notify(`Orden ${order.codigo} desvinculada.`)}catch(cause){setDetailError(friendlyError(cause))}finally{setBusy(false)}
  }
  const advance=async(target:'En Tránsito'|'En Aduanas',reason:string,key:string)=>{
    if(!stateTarget)return
    setBusy(true)
    try{await updateImportFolderState(stateTarget.id,target,reason,key);setStateTarget(null);await refreshDetail(stateTarget.id);notify(`${stateTarget.codigo} avanzó a ${target}.`)}catch(cause){throw cause}finally{setBusy(false)}
  }
  const startNationalize=async(folder:ImportFolderSummary)=>{
    setDetailError('')
    try{const rows=await fetchActiveWarehouses();setWarehouses(rows);if(!rows.length){setDetailError('No hay almacenes activos disponibles para nacionalizar.');return}setNationalizeTarget(folder)}catch(cause){setDetailError(friendlyError(cause))}
  }
  const nationalize=async(warehouseId:string,reason:string,key:string)=>{
    if(!nationalizeTarget)return
    setBusy(true)
    try{await nationalizeImportFolder(nationalizeTarget.id,warehouseId,reason,key);const id=nationalizeTarget.id;setNationalizeTarget(null);await refreshDetail(id);await reload();notify(`${nationalizeTarget.codigo} nacionalizada: órdenes recibidas y costos Landed Cost ingresados al Kardex.`)}catch(cause){throw cause}finally{setBusy(false)}
  }
  const updateExpense=async()=>{if(detail)await refreshDetail(detail.folder.id);await reload();notify('Gasto registrado; se actualizó la previsualización USD.')}

  if(!permissionRead)return <section className="ws-card"><div className="ws-empty-compact"><Ban size={24}/><strong>No tienes permiso para consultar importaciones.</strong></div></section>

  if(detail){
    const folder=detail.folder
    const activeSummary:ImportFolderSummary={...folder,order_count:detail.orders.length,proveedor_ids:[...new Set(detail.orders.map(order=>order.proveedor_id))],expense_total_usd:detail.expenses.reduce((sum,expense)=>sum+(expense.moneda==='USD'?Number(expense.monto):Number(expense.monto)/Number(expense.tipo_cambio)),0)}
    const canLink=folder.estado==='Abierta'&&canEdit
    const canUnlink=folder.estado==='Abierta'&&canEdit
    const canAddExpense=['Abierta','En Tránsito','En Aduanas'].includes(folder.estado)&&canCreate
    const nextState=folder.estado==='Abierta'?'En Tránsito':folder.estado==='En Tránsito'?'En Aduanas':null
    const closeDetail=()=>setDetail(null)
    return <>
      <section className="ws-page-heading"><div><button className="ws-text-button ws-import-back" type="button" onClick={closeDetail}><ArrowLeft size={15}/>Carpetas de importación</button><span className="ws-eyebrow">IMPORTACIONES · DOSSIER USD</span><h1>{folder.codigo} · {folder.nombre}</h1><p>{folder.referencia||'Sin referencia registrada'}</p></div><div className="ws-heading-actions"><span className={`ws-contract-status ${statusTone(folder.estado)}`}>{folder.estado}</span><button className="ws-button ws-button-secondary" type="button" disabled={detailLoading} onClick={()=>void loadDetail(folder.id)}><RefreshCw size={15} className={detailLoading?'ws-spin':''}/>Actualizar</button>{nextState&&canEdit&&<button className="ws-button" type="button" onClick={()=>setStateTarget(activeSummary)}><ArrowRight size={15}/>Avanzar a {nextState}</button>}{folder.estado==='En Aduanas'&&canEdit&&canReceive&&<button className="ws-button ws-button-danger" type="button" disabled={!detail.orders.length||!detail.preview.length} onClick={()=>void startNationalize(activeSummary)}><PackageCheck size={15}/>Nacionalizar</button>}</div></section>
      {(detailError||error)&&<div className="ws-notice ws-notice-warning" role="alert"><AlertTriangle size={16}/>{detailError||error}<button className="ws-text-button" type="button" onClick={()=>void loadDetail(folder.id)}>Reintentar</button></div>}
      {detail.previewError&&<div className="ws-notice ws-notice-warning" role="alert"><AlertTriangle size={16}/>El dossier se abrió, pero la API no expone el cálculo de prorrateo ({detail.previewError}). Se pueden revisar y vincular datos; la nacionalización permanecerá bloqueada hasta corregir la función/API.</div>}
      <section className="ws-import-metrics"><article className="ws-card"><span>Órdenes vinculadas</span><strong>{detail.orders.length}</strong><small>{[...new Set(detail.orders.map(order=>order.proveedor_id))].length} proveedores · USD</small></article><article className="ws-card"><span>Gastos normalizados</span><strong>{currency(activeSummary.expense_total_usd)}</strong><small>{detail.expenses.length} gastos registrados</small></article><article className="ws-card"><span>Valor de mercancía</span><strong>{currency(detail.preview.reduce((sum,line)=>sum+Number(line.valor_linea_usd),0))}</strong><small>Base bruta para prorrateo</small></article><article className="ws-card"><span>Costo Landed proyectado</span><strong>{currency(detail.preview.reduce((sum,line)=>sum+Number(line.costo_real_linea_usd),0))}</strong><small>Previsualización, aún no liquidada</small></article></section>
      <div className="ws-import-detail-grid"><section className="ws-card ws-import-panel"><div className="ws-card-heading"><div><h2>Órdenes vinculadas</h2><p>Órdenes USD confirmadas; la nacionalización las recibirá completas.</p></div>{canLink&&<button className="ws-button ws-button-compact" type="button" onClick={()=>setShowLink(true)}><Plus size={14}/>Vincular órdenes</button>}</div><div className="table-scroll"><table className="record-table"><thead><tr><th>Orden</th><th>Proveedor</th><th>Moneda / TC</th><th className="ws-num">Valor FOB</th><th>Estado</th><th></th></tr></thead><tbody>{detail.orders.map(order=><tr key={order.id}><td><strong>{order.codigo_orden}</strong></td><td>{supplierName(order.proveedor_id)}</td><td>{order.moneda} · {Number(order.tipo_cambio).toFixed(6)}</td><td className="ws-num">{currency(Number(order.compra_id?detail.preview.filter(line=>line.compra_id===order.compra_id).reduce((s,line)=>s+Number(line.valor_linea_usd),0):0))}</td><td>Confirmada</td><td>{canUnlink&&<button className="ws-button ws-button-secondary ws-button-compact" type="button" disabled={busy} onClick={()=>void unlink({id:order.compra_id,codigo:order.codigo_orden})}><X size={13}/>Desvincular</button>}</td></tr>)}{!detail.orders.length&&<tr><td colSpan={6}><div className="ws-empty-compact"><PackageCheck size={22}/><strong>No hay órdenes vinculadas</strong><span>Vincula órdenes confirmadas, USD y sin recepciones previas.</span></div></td></tr>}</tbody></table></div></section>
        <section className="ws-card ws-import-panel"><div className="ws-card-heading"><div><h2>Gastos de importación</h2><p>Gastos PEN se convierten a USD con su tipo de cambio snapshot.</p></div></div>{canAddExpense&&<ExpenseForm folderId={folder.id} onSaved={()=>void updateExpense()}/>}<div className="table-scroll"><table className="record-table"><thead><tr><th>Gasto</th><th className="ws-num">Moneda origen</th><th className="ws-num">Tipo cambio</th><th className="ws-num">Prorrateable USD</th></tr></thead><tbody>{detail.expenses.map(expense=>{const usd=expense.moneda==='USD'?Number(expense.monto):Number(expense.monto)/Number(expense.tipo_cambio);return <tr key={expense.id}><td><strong>{expense.tipo}</strong><small>{expense.descripcion}{expense.referencia?` · ${expense.referencia}`:''}</small></td><td className="ws-num">{currency(Number(expense.monto),expense.moneda)}</td><td className="ws-num">{expense.moneda==='PEN'?Number(expense.tipo_cambio).toFixed(6):'1.000000'}</td><td className="ws-num">{currency(usd)}</td></tr>})}{!detail.expenses.length&&<tr><td colSpan={4}>Aún no se registran gastos.</td></tr>}</tbody></table></div></section></div>
      {detail.preview.length > 0 && (detail.expenses.length === 0 || activeSummary.expense_total_usd <= 0) && <div className="ws-notice" role="note"><Info size={16}/><span>El costo Landed proyectado coincide con el valor FOB porque la carpeta aún no registra gastos de importación. Agrega fletes, seguros o aranceles para prorratearlos.</span></div>}
      <section className="ws-card ws-import-preview"><div className="ws-card-heading"><div><h2>Previsualización de prorrateo · Landed Cost</h2><p>Asignación proporcional por valor bruto de línea; el residuo de centavos se concilia en la última línea.</p></div><span className="ws-import-preview-total">Gastos: {currency(activeSummary.expense_total_usd)}</span></div><div className="table-scroll"><table className="record-table"><thead><tr><th>Orden / línea</th><th className="ws-num">Cantidad</th><th className="ws-num">Valor FOB USD</th><th className="ws-num">Peso del valor</th><th className="ws-num">Gasto asignado USD</th><th className="ws-num">Costo real línea USD</th><th className="ws-num">Costo unitario real</th></tr></thead><tbody>{detail.preview.map(line=><tr key={line.detalle_compra_id}><td><strong>{line.codigo_orden}</strong><small>{line.descripcion}</small></td><td className="ws-num">{line.cantidad}</td><td className="ws-num">{currency(Number(line.valor_linea_usd))}</td><td className="ws-num">{(Number(line.peso_valor)*100).toFixed(2)}%</td><td className="ws-num">{currency(Number(line.gasto_asignado_usd))}</td><td className="ws-num">{currency(Number(line.costo_real_linea_usd))}</td><td className="ws-num"><strong>{currency(Number(line.costo_unitario_real_usd))}</strong></td></tr>)}{!detail.preview.length&&<tr><td colSpan={7}><div className="ws-empty-compact"><Truck size={22}/><strong>Prorrateo disponible al vincular líneas elegibles</strong><span>Se requiere al menos una línea de producto con valor total registrado.</span></div></td></tr>}</tbody></table></div></section>
       <section className="ws-card ws-import-history"><div className="ws-card-heading"><div><h2>Tracking y auditoría</h2><p>Transiciones y operaciones registradas con actor y motivo.</p></div></div><div className="ws-import-timeline">{detail.history.map(event=><article key={event.id}><span className="ws-import-timeline-dot"><Clock3 size={13}/></span><div><strong>{event.evento}</strong><small>{new Date(event.created_at).toLocaleString('es-PE')}{event.actor_id?` · ${event.actor_id}`:''}</small>{event.motivo&&<p>{event.motivo}</p>}{typeof event.datos.estado_nuevo==='string'&&<span>{String(event.datos.estado_anterior)} → {event.datos.estado_nuevo}</span>}</div></article>)}{!detail.history.length&&<span>Sin eventos adicionales.</span>}</div></section>
      {showLink&&canLink&&<LinkOrdersDialog folderId={folder.id} suppliers={suppliers} onClose={()=>setShowLink(false)} onLinked={()=>void linked()}/>}
      {stateTarget&&<StateDialog folder={stateTarget} onClose={()=>setStateTarget(null)} onSubmit={advance}/>}
      {nationalizeTarget&&<NationalizeDialog folder={nationalizeTarget} warehouses={warehouses} onClose={()=>setNationalizeTarget(null)} onSubmit={nationalize}/>}
    </>
  }

  return <>
    <section className="ws-page-heading"><div><span className="ws-eyebrow">COMPRAS · COMERCIO INTERNACIONAL</span><h1>Importaciones</h1><p>Gestiona carpetas, gastos y prorrateo Landed Cost de órdenes USD.</p></div><div className="ws-heading-actions"><button className="ws-button ws-button-secondary" type="button" disabled={loading} onClick={()=>void load()}><RefreshCw size={15} className={loading?'ws-spin':''}/>Actualizar</button>{canCreate&&<button className="ws-button" type="button" onClick={()=>setShowCreate(true)}><Plus size={15}/>Nueva carpeta</button>}</div></section>
    <section className="ws-card ws-import-filters"><label>Estado<select className="ws-control" value={stateFilter} onChange={event=>{setStateFilter(event.target.value);setPage(0)}}><option value="">Todos los estados</option><option>Abierta</option><option>En Tránsito</option><option>En Aduanas</option><option>Nacionalizado</option><option>Cerrada</option></select></label><label>Proveedor<select className="ws-control" value={supplierFilter} onChange={event=>{setSupplierFilter(event.target.value);setPage(0)}}><option value="">Todos los proveedores</option>{suppliers.map(supplier=><option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label><span>{total} carpetas</span></section>
     {error&&<div className="ws-notice ws-notice-warning" role="alert"><AlertTriangle size={16}/>{error}<button className="ws-text-button" type="button" onClick={()=>void load()}>Reintentar</button></div>}
     {!detail&&detailError&&<div className="ws-notice ws-notice-warning" role="alert"><AlertTriangle size={16}/>{detailError}<button className="ws-text-button" type="button" disabled={detailLoading||!detailTargetId} onClick={()=>void loadDetail(detailTargetId)}>{detailLoading?'Cargando…':'Reintentar detalle'}</button></div>}
    <section className="ws-card ws-import-list"><div className="table-scroll"><table className="record-table"><thead><tr><th>Carpeta</th><th>Estado</th><th>Proveedores</th><th>Órdenes</th><th className="ws-num">Gastos USD</th><th>Creada</th><th></th></tr></thead><tbody>{items.map(folder=><tr key={folder.id}><td><button className="ws-import-folder-link" type="button" onClick={()=>void loadDetail(folder.id)}><strong>{folder.codigo} · {folder.nombre}</strong><small>{folder.referencia||'Sin referencia'}</small></button></td><td><span className={`ws-contract-status ${statusTone(folder.estado)}`}>{folder.estado}</span></td><td>{folder.proveedor_ids.length?folder.proveedor_ids.map(supplierName).join(', '):'—'}</td><td>{folder.order_count}</td><td className="ws-num">{currency(folder.expense_total_usd)}</td><td>{new Date(folder.creado_en).toLocaleDateString('es-PE')}</td><td><button className="ws-button ws-button-secondary ws-button-compact" type="button" onClick={()=>void loadDetail(folder.id)}>Ver detalle<ArrowRight size={13}/></button></td></tr>)}{!items.length&&<tr><td colSpan={7}><div className="ws-empty-compact">{loading?<RefreshCw size={23} className="ws-spin"/>:<Ship size={23}/>}<strong>{loading?'Cargando carpetas…':error?'No se pudieron consultar las carpetas':'No hay carpetas con estos filtros'}</strong><span>Crea una carpeta USD para vincular órdenes confirmadas.</span></div></td></tr>}</tbody></table></div>{total>PAGE_SIZE&&<div className="ws-pagination"><span>Mostrando {page*PAGE_SIZE+1}–{Math.min((page+1)*PAGE_SIZE,total)} de {total}</span><div><button className="ws-icon-button" type="button" aria-label="Página anterior" disabled={page===0||loading} onClick={()=>setPage(current=>Math.max(0,current-1))}><ChevronLeft size={15}/></button><span>{page+1} / {pageCount}</span><button className="ws-icon-button" type="button" aria-label="Página siguiente" disabled={page+1>=pageCount||loading} onClick={()=>setPage(current=>Math.min(pageCount-1,current+1))}><ChevronRight size={15}/></button></div></div>}</section>
    {showCreate&&<CreateFolderDialog onClose={()=>setShowCreate(false)} onCreated={id=>void created(id)}/>}
    {detailLoading&&<div className="ws-import-detail-loading" role="status"><RefreshCw size={15} className="ws-spin"/>Cargando carpeta…</div>}
  </>
}
