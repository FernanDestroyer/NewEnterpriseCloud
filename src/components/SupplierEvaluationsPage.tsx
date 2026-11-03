import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, ClipboardCheck, Search, Star } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useRecords } from '../context/RecordsContext'
import SupplierOrderEvaluationPanel from './SupplierOrderEvaluationPanel'
import SupplierEvaluationRating from './SupplierEvaluationRating'

const PAGE_SIZE = 12

export default function SupplierEvaluationsPage() {
  const { can } = useAuth()
  const { records } = useRecords()
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const eligibleOrders = useMemo(() => {
    const search = query.trim().toLocaleLowerCase()
    return records.purchases
      .filter(order => order.rowId && order.proveedor_id && order.requiereRecepcion !== false
        && (order.estadoRecepcion === 'parcial' || order.estadoRecepcion === 'completa'))
      .filter(order => !search || `${order.id} ${order.name} ${order.proveedor_id}`.toLocaleLowerCase().includes(search))
      .sort((a,b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
  }, [records.purchases, query])
  const pageCount = Math.max(1, Math.ceil(eligibleOrders.length / PAGE_SIZE))
  const visibleOrders = eligibleOrders.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  if (!can('purchases','ver')) return <section className="ws-card"><div className="ws-empty-compact"><ClipboardCheck size={24}/><strong>No tienes permiso para consultar evaluaciones de proveedores.</strong></div></section>

  return <>
    <section className="ws-page-heading"><div><span className="ws-eyebrow">COMPRAS · CALIDAD DE PROVEEDORES</span><h1>Evaluación de proveedores</h1><p>Selecciona una orden con recepción parcial o completa para consultar o registrar su evaluación.</p></div></section>
    <section className="ws-card ws-supplier-evaluation-filter"><label className="ws-table-search"><Search size={15}/><input value={query} onChange={event=>{setQuery(event.target.value);setPage(0);setSelectedId(null)}} placeholder="Buscar orden, proveedor o código…" aria-label="Buscar orden o proveedor"/></label><span>{eligibleOrders.length} órdenes elegibles</span></section>
    <section className="ws-card ws-supplier-evaluation-list"><div className="table-scroll"><table className="record-table"><thead><tr><th>Orden de compra</th><th>Proveedor</th><th>Recepción</th><th>Importe</th><th>Promedio histórico</th><th></th></tr></thead><tbody>
      {visibleOrders.map(order => <tr key={order.rowId} className={selectedId===order.rowId?'is-selected':''}>
        <td><strong>{order.id}</strong><small>{order.detail||'Orden de compra'}</small></td>
        <td><strong>{order.name}</strong></td>
        <td><span className={`ws-contract-status ${order.estadoRecepcion==='completa'?'is-active':'is-transit'}`}>{order.estadoRecepcion==='completa'?'Completa':'Parcial'}</span></td>
        <td>{new Intl.NumberFormat('es-PE',{style:'currency',currency:order.moneda==='USD'?'USD':'PEN'}).format(Number(order.amount??0))}</td>
        <td>{order.proveedor_id&&<SupplierEvaluationRating proveedorId={order.proveedor_id} compact/>}</td>
        <td><button className={`ws-button ${selectedId===order.rowId?'ws-button-secondary':''} ws-button-compact`} type="button" onClick={()=>setSelectedId(current=>current===order.rowId?null:order.rowId??null)}><Star size={14}/>{selectedId===order.rowId?'Cerrar':'Abrir evaluación'}</button></td>
      </tr>)}
      {!visibleOrders.length&&<tr><td colSpan={6}><div className="ws-empty-compact"><ClipboardCheck size={24}/><strong>{query?'No hay órdenes que coincidan':'Aún no hay órdenes elegibles'}</strong><span>La orden debe tener proveedor y al menos una recepción parcial o completa.</span></div></td></tr>}
    </tbody></table></div>
      {selectedId&&visibleOrders.some(order=>order.rowId===selectedId)&&(()=>{const order=visibleOrders.find(item=>item.rowId===selectedId)!;return <SupplierOrderEvaluationPanel compraId={order.rowId!} proveedorId={order.proveedor_id??null} estadoRecepcion={order.estadoRecepcion} requiereRecepcion={order.requiereRecepcion!==false}/>})()}
      {eligibleOrders.length>PAGE_SIZE&&<div className="ws-pagination"><span>Mostrando {page*PAGE_SIZE+1}–{Math.min((page+1)*PAGE_SIZE,eligibleOrders.length)} de {eligibleOrders.length}</span><div><button className="ws-icon-button" type="button" aria-label="Página anterior" disabled={page===0} onClick={()=>{setPage(value=>Math.max(0,value-1));setSelectedId(null)}}><ChevronLeft size={15}/></button><span>{page+1} / {pageCount}</span><button className="ws-icon-button" type="button" aria-label="Página siguiente" disabled={page+1>=pageCount} onClick={()=>{setPage(value=>Math.min(pageCount-1,value+1));setSelectedId(null)}}><ChevronRight size={15}/></button></div></div>}
    </section>
  </>
}
