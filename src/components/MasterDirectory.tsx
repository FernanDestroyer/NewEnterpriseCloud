import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowDownUp, Boxes, Building2, ChevronLeft, ChevronRight, Download, History, LayoutGrid, List, Pencil, Plus, RefreshCw, Search, Trash2, Users, X } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useRecords } from '../context/RecordsContext'
import { money, statusTone, stockStatus } from '../data/helpers'
import { customerCredit, displayDate, inDateRange, matchesSearch } from '../data/workspace'
import type { RecordItem } from '../types'
import { PageHeader } from './ui/PageHeader'
import { SegmentedControl } from './ui/SegmentedControl'
import CustomerHistory from './CustomerHistory'
import SupplierCatalog from './SupplierCatalog'
import SupplierImport from './SupplierImport'
import ModuleCsvImport from './ModuleCsvImport'
import '../masters-ui.css'

export type MasterPage = 'customers' | 'inventory' | 'suppliers'
const config = {
  customers: { title: 'Clientes', description: 'Relaciones comerciales, documentos y crédito en una vista conectada.', action: 'Nuevo cliente', icon: Users },
  inventory: { title: 'Productos y clasificación', description: 'Tu catálogo comercial: existencias, precios y disponibilidad.', action: 'Nuevo producto', icon: Boxes },
  suppliers: { title: 'Proveedores', description: 'Centraliza contactos, datos fiscales y catálogos de abastecimiento.', action: 'Nuevo proveedor', icon: Building2 },
}

export default function MasterDirectory({ page, embedded = false, allowCreate = true }: { page: MasterPage; embedded?: boolean; allowCreate?: boolean }) {
  const { can } = useAuth()
  const { records, loading, errors, refreshing, saving, openComposer, openEditor, requestDelete, exportTable, reload } = useRecords()
  const [params, setParams] = useSearchParams()
  const [mode, setMode] = useState<'table' | 'grid'>('table')
  const [pageIndex, setPageIndex] = useState(0)
  const [size, setSize] = useState('12')
  const [sort, setSort] = useState<{ field: 'name' | 'id' | 'createdAt' | 'value'; ascending: boolean }>({ field: 'createdAt', ascending: false })
  const [customer, setCustomer] = useState<RecordItem | null>(null)
  const [supplierId, setSupplierId] = useState<string | null>(null)
  const meta = config[page]
  const Icon = meta.icon
  const query = params.get('q') ?? '', status = params.get('status') ?? 'Todos'
  const from = params.get('from') ?? '', to = params.get('to') ?? ''
  const invalidRange = Boolean(from && to && from > to)
  const items = records[page]
  const stateOf = (item: RecordItem) => page === 'inventory' ? stockStatus(item.quantity ?? 0) : item.status
  const scoped = useMemo(() => items.filter(item => !invalidRange && matchesSearch(item, query) && inDateRange(item, { from, to })), [items, query, from, to, invalidRange])
  const filtered = scoped.filter(item => status === 'Todos' || stateOf(item) === status)
  const sorted = [...filtered].sort((a, b) => {
    const value = (item: RecordItem) => sort.field === 'value' ? item.quantity ?? item.amount ?? 0 : item[sort.field] ?? ''
    const av = value(a), bv = value(b)
    return (typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv), 'es', { numeric: true })) * (sort.ascending ? 1 : -1)
  })
  const states = [...new Set(items.map(stateOf))]
  const pages = Math.max(1, Math.ceil(sorted.length / Number(size)))
  const current = Math.min(pageIndex, pages - 1)
  const visible = sorted.slice(current * Number(size), (current + 1) * Number(size))
  const supplier = items.find(item => item.id === supplierId)
  const parameter = (key: string, value: string) => { setPageIndex(0); setParams(previous => { const next = new URLSearchParams(previous); if (value && value !== 'Todos') next.set(key, value); else next.delete(key); return next }, { replace: true }) }
  const sortBy = (field: typeof sort.field) => { setPageIndex(0); setSort(old => ({ field, ascending: old.field === field ? !old.ascending : true })) }
  const amount = (item: RecordItem) => page === 'inventory' ? money(item.precio ?? 0) : money(customerCredit(item, records.sales, records.finance).disponible)
  const badge = (item: RecordItem) => <span className={`status-pill ${statusTone(stateOf(item))}`}>{stateOf(item)}</span>
  const actions = (item: RecordItem) => <div className="ec-master-actions">
    {page === 'customers' && <button type="button" className="ws-icon-button" aria-label={`Historial de ${item.name}`} title="Historial" onClick={() => setCustomer(item)}><History size={16} /></button>}
    {page === 'suppliers' && <button type="button" className="ws-icon-button" aria-label={`Catálogo de ${item.name}`} title="Catálogo" onClick={() => setSupplierId(supplierId === item.id ? null : item.id)}><Boxes size={16} /></button>}
    {can(page, 'editar') && <button type="button" className="ws-icon-button" disabled={saving} aria-label={`Editar ${item.name}`} title="Editar" onClick={() => openEditor(page, item)}><Pencil size={16} /></button>}
    {can(page, 'eliminar') && <button type="button" className="ws-icon-button ec-danger-action" disabled={saving} aria-label={`Eliminar ${item.name}`} title="Eliminar" onClick={() => requestDelete(page, item)}><Trash2 size={16} /></button>}
  </div>
  if (!can(page)) return <section className="ws-card ws-empty-compact">Acceso restringido.</section>
  return <div className="ec-masters" id={page === 'inventory' ? 'productos' : undefined}>
    {!embedded && <PageHeader title={meta.title} description={meta.description} section="Maestros" icon={Icon} actions={allowCreate && can(page, 'crear') && <button type="button" className="ws-button" disabled={loading || Boolean(errors[page])} onClick={() => openComposer(page)}><Plus size={16} />{meta.action}</button>} />}
    <div className="ec-master-metrics">
      <section className="ec-card"><span>Registros en la consulta</span><strong>{errors[page] ? '—' : filtered.length}</strong><small>{items.length} en el catálogo</small></section>
      <section className="ec-card"><span>{page === 'inventory' ? 'Unidades de stock global' : 'Con documento registrado'}</span><strong>{errors[page] ? '—' : page === 'inventory' ? filtered.reduce((sum, item) => sum + (item.quantity ?? 0), 0).toLocaleString('es-PE') : filtered.filter(item => page === 'customers' ? item.documento : item.ruc).length}</strong><small>{page === 'inventory' ? 'Saldo del maestro de productos' : 'Identificación comercial'}</small></section>
      <section className="ec-card"><span>{page === 'inventory' ? 'Precio × stock' : page === 'customers' ? 'Crédito disponible' : 'Con contacto registrado'}</span><strong>{errors[page] ? '—' : page === 'inventory' ? money(filtered.reduce((sum, item) => sum + (item.quantity ?? 0) * (item.precio ?? 0), 0)) : page === 'customers' ? errors.sales || errors.finance ? 'No disponible' : money(filtered.reduce((sum, item) => sum + customerCredit(item, records.sales, records.finance).disponible, 0)) : filtered.filter(item => item.correo || item.telefono).length}</strong><small>{page === 'inventory' ? 'Valor referencial de venta, no costo' : page === 'customers' ? 'Línea menos consumo con tarjeta' : 'Correo o teléfono informado'}</small></section>
    </div>
    <section className="ec-card ec-master-list">
      <div className="ec-master-toolbar">
        {page !== 'suppliers' && <button type="button" className="ws-icon-button" onClick={() => sortBy('value')} title={page === 'inventory' ? 'Ordenar por stock' : 'Ordenar por línea de crédito'} aria-label={page === 'inventory' ? 'Ordenar por stock' : 'Ordenar por línea de crédito'}><ArrowDownUp size={16} /></button>}
        <label className="ec-master-search"><Search size={17} /><input value={query} onChange={event => parameter('q', event.target.value)} placeholder="Buscar por nombre, código o documento…" aria-label={`Buscar ${meta.title}`} /></label>
        <div className="ec-master-view" role="group" aria-label="Vista del catálogo"><button type="button" aria-pressed={mode === 'table'} onClick={() => setMode('table')}><List size={16} />Tabla</button><button type="button" aria-pressed={mode === 'grid'} onClick={() => setMode('grid')}><LayoutGrid size={16} />Tarjetas</button></div>
        <button type="button" className="ws-icon-button" disabled={refreshing} onClick={() => void reload()} aria-label="Actualizar catálogo"><RefreshCw size={17} className={refreshing ? 'ws-spin' : ''} /></button>
        {page === 'customers' && <ModuleCsvImport page="customers" />}{page === 'suppliers' && <SupplierImport />}
        {embedded && allowCreate && can(page, 'crear') && <button type="button" className="ws-button" onClick={() => openComposer(page)}><Plus size={16} />{meta.action}</button>}
      </div>
      <div className="ec-master-filter-row"><div className="ec-filter-chips" role="group" aria-label="Filtrar por estado">{['Todos', ...states].map(value => <button type="button" key={value} aria-pressed={value === status} onClick={() => parameter('status', value)}>{value}<span>{scoped.filter(item => value === 'Todos' || stateOf(item) === value).length}</span></button>)}</div><div className="ec-master-dates"><label>Desde<input type="date" value={from} onChange={event => parameter('from', event.target.value)} /></label><label>Hasta<input type="date" value={to} onChange={event => parameter('to', event.target.value)} /></label></div></div>
      <div className="ec-master-export"><span>{filtered.length} resultados · exportar consulta</span>{(['csv','excel','pdf'] as const).map(format => <button type="button" key={format} disabled={loading || Boolean(errors[page])} onClick={() => exportTable(page, format, sorted)}><Download size={13} />{format.toUpperCase()}</button>)}{(query || status !== 'Todos' || from || to) && <button type="button" onClick={() => { setPageIndex(0); setParams(previous => { const next = new URLSearchParams(previous); for (const key of ['q','status','from','to']) next.delete(key); return next }, { replace: true }) }}><X size={13} />Limpiar filtros</button>}</div>
      {invalidRange && <p className="ws-notice ws-notice-warning" role="alert">La fecha inicial debe ser anterior o igual a la fecha final.</p>}
      {errors[page] ? <div className="ws-empty-compact" role="alert"><strong>No se pudo cargar el catálogo</strong><p>{errors[page]}</p><button type="button" className="ws-button" onClick={() => void reload()}>Reintentar</button></div> : loading ? <div role="status" aria-label="Cargando catálogo">{[0,1,2].map(i => <div key={i} className="ec-skeleton" />)}</div> : !visible.length ? <div className="ws-empty-compact"><Icon size={32} /><h3>Sin registros en esta vista</h3><p>Ajusta los filtros o registra {page === 'inventory' ? 'un producto' : page === 'customers' ? 'un cliente' : 'un proveedor'}.</p></div> : mode === 'grid' ? <div className="ec-master-grid">{visible.map(item => <article className="ec-card ec-master-tile" key={item.id}><div className="ec-master-tile-top"><span className="ec-master-avatar"><Icon size={23} /></span>{badge(item)}</div><small className="ec-master-code">{item.id}</small><h3>{item.name}</h3><p>{item.detail || 'Sin descripción'}</p><div className="ec-master-tile-data">{page === 'inventory' ? <><div><small>Stock global</small><strong>{item.quantity ?? 0} und.</strong></div><div><small>Precio de venta</small><strong>{item.precio === undefined ? 'Sin precio' : amount(item)}</strong></div></> : page === 'customers' ? <><div><small>{item.tipoDoc ?? 'Documento'}</small><strong>{item.documento || 'No informado'}</strong></div><div><small>Disponible</small><strong>{errors.sales || errors.finance ? 'No disponible' : amount(item)}</strong></div></> : <><div><small>RUC</small><strong>{item.ruc || 'No informado'}</strong></div><div><small>Contacto</small><strong>{item.telefono || item.correo || 'No informado'}</strong></div></>}</div><footer>{actions(item)}<small>{displayDate(item.createdAt)}</small></footer></article>)}</div> : <div className="table-scroll"><table className="record-table"><thead><tr>{([{field:'id',label:'Referencia'},{field:'name',label:page === 'inventory' ? 'Producto' : 'Nombre / razón social'},{field:'createdAt',label:'Registro'}] as const).map(col => <th key={col.field} aria-sort={sort.field === col.field ? sort.ascending ? 'ascending' : 'descending' : 'none'}><button type="button" className="ws-sort-button" onClick={() => sortBy(col.field)}>{col.label}<ArrowDownUp size={12} /></button></th>)}<th>{page === 'inventory' ? 'Stock / precio' : page === 'customers' ? 'Disponible / línea' : 'Contacto'}</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{visible.map(item => <tr key={item.id}><td><span className="record-id">{item.id}</span></td><td><strong>{item.name}</strong><small>{item.detail}</small>{page !== 'inventory' && <small>{page === 'customers' ? `${item.tipoDoc ?? 'Documento'} ${item.documento ?? 'no informado'}` : `RUC ${item.ruc ?? 'no informado'}`}</small>}</td><td>{displayDate(item.createdAt)}</td><td className="ec-master-numeric">{page === 'inventory' ? <><strong>{item.quantity ?? 0} und.</strong><small>{item.precio === undefined ? 'Sin precio' : amount(item)}</small></> : page === 'customers' ? <><strong>{errors.sales || errors.finance ? 'No disponible' : amount(item)}</strong><small>Línea {money(item.amount ?? 0)}</small></> : <><strong>{item.telefono || '—'}</strong><small>{item.correo || 'Sin correo'}</small></>}</td><td>{badge(item)}</td><td>{actions(item)}</td></tr>)}</tbody></table></div>}
      <footer className="ec-master-pagination"><span>{sorted.length ? current * Number(size) + 1 : 0}–{Math.min((current + 1) * Number(size), sorted.length)} de {sorted.length}</span><SegmentedControl ariaLabel="Registros por página" value={size} onChange={value => { setSize(value); setPageIndex(0) }} options={['12','24','48'].map(value => ({value,label:value}))} /><div><button type="button" className="ws-icon-button" disabled={current === 0} aria-label="Página anterior" onClick={() => setPageIndex(current - 1)}><ChevronLeft size={16} /></button><span>{current + 1} / {pages}</span><button type="button" className="ws-icon-button" disabled={current + 1 >= pages} aria-label="Página siguiente" onClick={() => setPageIndex(current + 1)}><ChevronRight size={16} /></button></div></footer>
    </section>
    {supplier && page === 'suppliers' && <section className="ec-card ec-master-supplier"><button type="button" className="ws-button ws-button-secondary" onClick={() => setSupplierId(null)}><X size={14} />Cerrar catálogo</button><SupplierCatalog supplier={supplier} allowEdit={embedded} /></section>}
    {customer && <CustomerHistory customer={customer} onClose={() => setCustomer(null)} />}
  </div>
}
