import { useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Boxes, ChevronLeft, ChevronRight, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useRecords } from '../context/RecordsContext'
import { deleteCatalogItem, friendlyError, insertCatalogItem, updateCatalogItem } from '../services/records'
import { money } from '../data/helpers'
import type { RecordItem } from '../types'
import ConfirmModal from './ConfirmModal'

export default function SupplierCatalog({ supplier, allowEdit = true }: { supplier: RecordItem; allowEdit?: boolean }) {
  const { catalog, catalogError, reload, notify } = useRecords()
  const { can } = useAuth()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<RecordItem | null>(null)
  const [deleting, setDeleting] = useState<RecordItem | null>(null)
  // Buscador + filtros para ubicar productos sin deslizar listas largas.
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'pending' | 'linked'>('all')
  // Paginación: los 4 primeros visibles, el resto con las flechas.
  const [catalogPage, setCatalogPage] = useState(0)
  const [catalogPageSize, setCatalogPageSize] = useState(4)
  const products = catalog.filter(item => item.proveedor_id === supplier.rowId)
  const visible = useMemo(() => {
    const text = query.trim().toLocaleLowerCase('es')
    return products.filter((product) => {
      if (filter === 'pending' && product.productoId) return false
      if (filter === 'linked' && !product.productoId) return false
      if (!text) return true
      return `${product.id} ${product.name} ${product.detail}`.toLocaleLowerCase('es').includes(text)
    })
  }, [products, query, filter])
  const catalogPageCount = Math.max(1, Math.ceil(visible.length / catalogPageSize))
  const safeCatalogPage = Math.min(catalogPage, catalogPageCount - 1)
  const paged = visible.slice(safeCatalogPage * catalogPageSize, safeCatalogPage * catalogPageSize + catalogPageSize)
  const rangeStart = visible.length ? safeCatalogPage * catalogPageSize + 1 : 0
  const rangeEnd = Math.min(rangeStart + catalogPageSize - 1, visible.length)
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy || !supplier.rowId) return
    const form = event.currentTarget
    const values = new FormData(form)
    const nombre = String(values.get('nombre') ?? '').trim()
    const costo = Number(values.get('costo'))
    const detalle = String(values.get('detalle') ?? '').trim()
    if (nombre.length < 2 || !Number.isFinite(costo) || costo < 0) return notify('Revisa el nombre y el costo del producto.')
    setBusy(true)
    try {
      if (editing?.rowId) await updateCatalogItem(editing.rowId, { nombre, costo, detalle })
      else await insertCatalogItem(supplier.rowId, { nombre, costo, detalle })
      await reload()
      setEditing(null)
      form.reset()
      notify('Catálogo del proveedor guardado en Supabase.')
    } catch (error) { notify(friendlyError(error)) }
    finally { setBusy(false) }
  }
  const remove = async () => {
    if (!deleting?.rowId || busy) return
    setBusy(true)
    try { await deleteCatalogItem(deleting.rowId); await reload(); setDeleting(null); notify('Producto retirado del catálogo del proveedor.') }
    catch (error) { notify(friendlyError(error)) }
    finally { setBusy(false) }
  }
  return <div className="supplier-detail"><div className="ws-section-heading"><div><h2>Catálogo de {supplier.name}</h2><p>{products.length} {products.length === 1 ? 'producto ofrecido' : 'productos ofrecidos'} · Independiente de tu inventario</p></div><Boxes size={19} /></div>
    {catalogError && <div className="ws-notice ws-notice-warning" role="alert">{catalogError}</div>}
    {products.length > 0 && (
      <div className="catalog-toolbar">
        <label className="ws-table-search"><Search size={16} /><input value={query} onChange={(event) => { setQuery(event.target.value); setCatalogPage(0) }} placeholder="Buscar producto…" aria-label={`Buscar en el catálogo de ${supplier.name}`} /></label>
        <div className="ws-tabs" role="tablist" aria-label="Filtrar productos del catálogo">
          <button type="button" role="tab" aria-selected={filter === 'all'} onClick={() => { setFilter('all'); setCatalogPage(0) }}>Todos</button>
          <button type="button" role="tab" aria-selected={filter === 'pending'} onClick={() => { setFilter('pending'); setCatalogPage(0) }}>Por ingresar</button>
          <button type="button" role="tab" aria-selected={filter === 'linked'} onClick={() => { setFilter('linked'); setCatalogPage(0) }}>En inventario</button>
        </div>
        <span className="catalog-count">{visible.length} de {products.length}</span>
      </div>
    )}
    {visible.length ? <><div className="supplier-product-list">{paged.map(product => <div className="supplier-product-row" key={product.id}><span className="supplier-product-copy"><strong>{product.name}</strong><small>{product.id} · Costo sin IGV {money(product.amount)} · {product.productoId ? `${product.quantity ?? 0} unidades en inventario` : 'Pendiente de ingreso'}</small></span><span className="supplier-product-actions">{product.productoId && can('inventory') && <button className="ws-text-button" onClick={() => navigate(`/inventory?q=${encodeURIComponent(product.relatedCode ?? product.name)}`)}>Ver stock</button>}{can('purchases', 'editar') && allowEdit && <button className="ws-icon-button" disabled={busy} onClick={() => setEditing(product)} aria-label={`Editar ${product.name}`}><Pencil size={15} /></button>}{can('purchases', 'eliminar') && <button className="ws-icon-button" disabled={busy} onClick={() => setDeleting(product)} aria-label={`Eliminar ${product.name}`}><Trash2 size={15} /></button>}</span></div>)}</div><div className="lines-pagination"><span>{rangeStart}–{rangeEnd} de {visible.length}</span><label>Filas<select value={catalogPageSize} onChange={(event) => { setCatalogPageSize(Number(event.target.value)); setCatalogPage(0) }} aria-label="Filas por página"><option value={4}>4</option><option value={8}>8</option><option value={12}>12</option></select></label><div><button className="ws-icon-button" type="button" aria-label="Página anterior" disabled={safeCatalogPage === 0} onClick={() => setCatalogPage(safeCatalogPage - 1)}><ChevronLeft size={14} /></button><span>{safeCatalogPage + 1} / {catalogPageCount}</span><button className="ws-icon-button" type="button" aria-label="Página siguiente" disabled={safeCatalogPage + 1 >= catalogPageCount} onClick={() => setCatalogPage(safeCatalogPage + 1)}><ChevronRight size={14} /></button></div></div></> : !catalogError && <p className="relation-hint">{products.length ? 'Sin coincidencias: ajusta la búsqueda o el filtro.' : 'Este proveedor todavía no tiene productos registrados en su catálogo.'}</p>}
    {(editing ? can('purchases', 'editar') : can('purchases', 'crear')) && <><span className="lines-title"><Boxes size={15} /> Agregar nuevo producto</span><form key={editing?.id ?? 'new'} className="supplier-link-bar" onSubmit={save}><input className="ws-control" name="nombre" required minLength={2} defaultValue={editing?.name} placeholder="Nombre del producto" aria-label="Nombre del producto del proveedor" /><input className="ws-control" name="detalle" defaultValue={editing?.detail} placeholder="Descripción o referencia" aria-label="Detalle del producto del proveedor" /><input className="ws-control" name="costo" type="number" min="0" step="0.01" required defaultValue={editing?.amount} placeholder="Costo sin IGV S/" aria-label="Costo sin IGV del producto del proveedor" /><button className="primary-button" disabled={busy} type="submit"><Plus size={16} />{busy ? 'Guardando…' : editing ? 'Guardar' : 'Agregar'}</button>{editing && <button className="cancel-button" type="button" onClick={() => setEditing(null)}>Cancelar</button>}</form></>}
    {deleting && <ConfirmModal title="Retirar producto del catálogo" message={`¿Retirar «${deleting.name}» de la oferta de este proveedor?`} confirmLabel="Retirar" busy={busy} onCancel={() => setDeleting(null)} onConfirm={remove} />}
  </div>
}
