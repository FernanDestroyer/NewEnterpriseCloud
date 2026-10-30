import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeftRight, ChevronLeft, ChevronRight, Package, RefreshCw, Search } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useRecords } from '../context/RecordsContext'
import { inventoryQueryError, loadInventoryKardex, loadInventoryStocks, loadInventoryWarehouses, type InventoryMovement, type InventoryStock, type InventoryWarehouse } from '../services/inventoryQueries'
import '../inventory-queries.css'

const formatUnits = (value: number | null | undefined) => value == null ? '—' : new Intl.NumberFormat('es-PE').format(value)
const formatValue = (value: number | null) => value == null ? 'Sin valorizar' : new Intl.NumberFormat('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)
const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es')
const dateTime = (value: string) => new Date(value).toLocaleString('es-PE', { timeZone: 'America/Lima', dateStyle: 'short', timeStyle: 'short' })
const PAGE_SIZE = 50

function movementDirection(row: InventoryMovement): { label: string; tone: string } {
  if (row.stock_anterior != null && row.stock_nuevo != null && row.stock_anterior !== row.stock_nuevo) {
    return row.stock_nuevo > row.stock_anterior ? { label: 'Entrada', tone: 'green' } : { label: 'Salida', tone: 'amber' }
  }
  if (row.tipo === 'entrada') return { label: 'Entrada', tone: 'green' }
  if (row.tipo === 'salida') return { label: 'Salida', tone: 'amber' }
  return { label: row.tipo === 'ajuste' ? 'Ajuste' : row.tipo === 'transferencia' ? 'Transferencia' : 'Sin dirección histórica', tone: 'blue' }
}

export default function InventoryQueriesPage({ view }: { view: 'stocks' | 'kardex' }) {
  const { can } = useAuth()
  const { records } = useRecords()
  const navigate = useNavigate()
  const [warehouses, setWarehouses] = useState<InventoryWarehouse[]>([])
  const [stocks, setStocks] = useState<InventoryStock[]>([])
  const [movements, setMovements] = useState<InventoryMovement[]>([])
  const [total, setTotal] = useState(0)
  const [warehouseId, setWarehouseId] = useState('')
  const [productId, setProductId] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [warehouseError, setWarehouseError] = useState('')
  const [version, setVersion] = useState(0)
  const products = useMemo(() => records.inventory.filter(item => item.rowId).sort((a, b) => a.name.localeCompare(b.name, 'es')), [records.inventory])
  const productNames = useMemo(() => new Map(products.map(item => [item.rowId, item])), [products])
  const warehouseNames = useMemo(() => new Map(warehouses.map(item => [item.id, item.nombre])), [warehouses])

  useEffect(() => {
    if (!can('inventory', 'ver')) return
    let active = true
    void loadInventoryWarehouses().then(data => { if (active) { setWarehouses(data); setWarehouseError('') } })
      .catch(cause => { if (active) setWarehouseError(inventoryQueryError(cause)) })
    return () => { active = false }
  }, [can, version])

  const reload = useCallback(() => setVersion(value => value + 1), [])
  useEffect(() => {
    if (!can('inventory', 'ver')) return
    let active = true
    const load = async () => {
      setLoading(true); setError('')
      try {
        if (view === 'stocks') {
          const data = await loadInventoryStocks()
          if (active) setStocks(data)
        } else {
          const data = await loadInventoryKardex({ productId: productId || null, warehouseId: warehouseId || null, page, pageSize: PAGE_SIZE })
          if (active) { setMovements(data.rows); setTotal(data.total) }
        }
      } catch (cause) { if (active) setError(inventoryQueryError(cause)) }
      finally { if (active) setLoading(false) }
    }
    void load()
    return () => { active = false }
  }, [view, productId, warehouseId, page, version, can])

  const visibleStocks = useMemo(() => stocks.filter(row => {
    if (warehouseId && row.almacen_id !== warehouseId) return false
    if (productId && row.producto_id !== productId) return false
    const product = productNames.get(row.producto_id)
    return !query || normalize(`${product?.name ?? ''} ${product?.id ?? ''} ${warehouseNames.get(row.almacen_id) ?? ''} ${row.producto_id}`).includes(normalize(query.trim()))
  }), [stocks, warehouseId, productId, query, productNames, warehouseNames])
  const summary = useMemo(() => visibleStocks.reduce((acc, row) => ({
    physical: acc.physical + Number(row.stock_fisico), reserved: acc.reserved + Number(row.stock_reservado), free: acc.free + Number(row.stock_libre),
  }), { physical: 0, reserved: 0, free: 0 }), [visibleStocks])
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  if (!can('inventory', 'ver')) return <section className="ws-card"><div className="ws-empty-compact"><strong>No tienes permiso para consultar Inventario.</strong></div></section>

  return <section className="inventory-query">
    <header className="ws-page-heading inventory-query-heading"><div><span className="ws-eyebrow">INVENTARIO Y KARDEX · CONSULTA</span><h1>{view === 'stocks' ? 'Existencias por almacén' : 'Kardex de movimientos'}</h1><p>{view === 'stocks' ? 'Stock físico, reservado y libre según el saldo vigente de Supabase.' : 'Libro de entradas y salidas; la valorización no disponible permanece sin valorizar.'}</p></div><div className="ws-heading-actions"><button type="button" className="ws-button ws-button-secondary" onClick={reload} disabled={loading}><RefreshCw size={15} className={loading ? 'ws-spin' : ''} />Actualizar</button></div></header>
    <nav className="inventory-query-nav" aria-label="Consultas de inventario"><button type="button" className={view === 'stocks' ? 'is-current' : ''} onClick={() => navigate('/inventario/existencias')} aria-current={view === 'stocks' ? 'page' : undefined}><Package size={15} />Existencias</button><button type="button" className={view === 'kardex' ? 'is-current' : ''} onClick={() => navigate('/inventario/kardex')} aria-current={view === 'kardex' ? 'page' : undefined}><ArrowLeftRight size={15} />Kardex</button></nav>
    <div className="inventory-query-filters">
      <label>Almacén<select className="ws-control" value={warehouseId} onChange={event => { setWarehouseId(event.target.value); setPage(1) }}><option value="">Todos los almacenes</option>{warehouses.map(item => <option key={item.id} value={item.id}>{item.nombre}{item.activo ? '' : ' · Inactivo'}</option>)}</select></label>
      <label>Producto<select className="ws-control" value={productId} onChange={event => { setProductId(event.target.value); setPage(1) }}><option value="">Todos los productos</option>{products.map(item => <option key={item.rowId} value={item.rowId}>{item.id} · {item.name}</option>)}</select></label>
      {view === 'stocks' && <label>Buscar producto o almacén<span className="ws-table-search"><Search size={15} /><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Nombre o código…" /></span></label>}
    </div>
    {error && <div className="ws-notice ws-notice-warning" role="alert"><span>{error}</span><button type="button" className="ws-text-button" onClick={reload}>Reintentar</button></div>}
    {warehouseError && <div className="ws-notice ws-notice-warning" role="alert"><span>No se pudieron cargar los nombres de los almacenes: {warehouseError}</span><button type="button" className="ws-text-button" onClick={reload}>Reintentar</button></div>}
    {view === 'stocks' && !error && <div className="inventory-query-summary" aria-label="Resumen de existencias"><div><span>Físico</span><strong>{formatUnits(summary.physical)}</strong></div><div><span>Reservado</span><strong>{formatUnits(summary.reserved)}</strong></div><div><span>Libre</span><strong>{formatUnits(summary.free)}</strong></div><small>{visibleStocks.length} combinación(es) producto–almacén</small></div>}
    <div className="ws-card inventory-query-card">
      <div className="inventory-query-card-title"><strong>{view === 'stocks' ? 'Saldos consolidados' : 'Movimientos registrados'}</strong><span>{view === 'stocks' ? `${visibleStocks.length} registros` : `${total} movimientos · orden más reciente primero`}</span></div>
      {loading ? <div className="ws-empty-compact" role="status"><RefreshCw size={21} className="ws-spin" /><strong>Consultando Supabase…</strong></div>
        : error ? <div className="ws-empty-compact"><strong>No se pudieron cargar los datos.</strong><span>Reintenta la consulta para ver datos actualizados.</span></div>
        : view === 'stocks' ? visibleStocks.length ? <div className="table-scroll"><table className="inventory-query-table"><thead><tr><th scope="col">Producto</th><th scope="col">Almacén</th><th scope="col" className="ws-num">Físico</th><th scope="col" className="ws-num">Reservado</th><th scope="col" className="ws-num">Libre</th><th scope="col">Estado</th></tr></thead><tbody>{visibleStocks.map(row => {
          const product = productNames.get(row.producto_id)
          const state = Number(row.stock_libre) <= 0 ? 'red' : Number(row.stock_reservado) > 0 ? 'amber' : 'green'
          return <tr key={`${row.producto_id}:${row.almacen_id}`}><td><strong>{product?.name ?? 'Producto no disponible'}</strong><small>{product?.id ?? row.producto_id}</small></td><td>{warehouseNames.get(row.almacen_id) ?? row.almacen_id}</td><td className="ws-num">{formatUnits(row.stock_fisico)}</td><td className="ws-num">{formatUnits(row.stock_reservado)}</td><td className="ws-num"><strong>{formatUnits(row.stock_libre)}</strong></td><td><span className={`status-pill ${state}`}>{state === 'red' ? 'Sin libre' : state === 'amber' ? 'Con reservas' : 'Disponible'}</span></td></tr>
        })}</tbody></table></div> : <div className="ws-empty-compact"><Package size={22} /><strong>Sin existencias para estos filtros</strong><span>Prueba otro producto o almacén.</span></div>
        : movements.length ? <><div className="table-scroll"><table className="inventory-query-table inventory-query-kardex"><thead><tr><th scope="col">Fecha</th><th scope="col">Producto / almacén</th><th scope="col">Movimiento</th><th scope="col" className="ws-num">Cantidad</th><th scope="col" className="ws-num">Antes</th><th scope="col" className="ws-num">Después</th><th scope="col" className="ws-num">PEPS</th><th scope="col" className="ws-num">Promedio</th><th scope="col" className="ws-num">Saldo PEPS</th><th scope="col" className="ws-num">Saldo prom.</th></tr></thead><tbody>{movements.map(row => {
          const product = productNames.get(row.producto_id ?? '')
          const direction = movementDirection(row)
          return <tr key={row.movimiento_id}><td><time dateTime={row.fecha}>{dateTime(row.fecha)}</time></td><td><strong>{product?.name ?? row.producto_id ?? 'Producto no disponible'}</strong><small>{warehouseNames.get(row.almacen_id ?? '') ?? row.almacen_id ?? 'Sin almacén'}</small></td><td><span className={`status-pill ${direction.tone}`}>{direction.label}</span><small>{row.tipo}{row.referencia ? ` · ${row.referencia}` : ''}{row.motivo ? ` · ${row.motivo}` : ''}</small></td><td className="ws-num">{formatUnits(row.cantidad)}</td><td className="ws-num">{formatUnits(row.stock_anterior)}</td><td className="ws-num">{formatUnits(row.stock_nuevo)}</td><td className="ws-num">{formatValue(row.costo_peps)}</td><td className="ws-num">{formatValue(row.costo_promedio)}</td><td className="ws-num">{formatValue(row.saldo_peps)}</td><td className="ws-num">{formatValue(row.saldo_promedio)}</td></tr>
        })}</tbody></table></div><div className="inventory-query-pagination"><span>Página {page} de {pages} · {total} movimientos</span><div><button type="button" aria-label="Página anterior" disabled={page <= 1} onClick={() => setPage(value => value - 1)}><ChevronLeft size={16} /></button><button type="button" aria-label="Página siguiente" disabled={page >= pages} onClick={() => setPage(value => value + 1)}><ChevronRight size={16} /></button></div></div></> : <div className="ws-empty-compact"><ArrowLeftRight size={22} /><strong>Sin movimientos para estos filtros</strong><span>Los asientos aparecerán aquí cuando se registre una operación física.</span></div>}
    </div>
    {view === 'kardex' && <p className="inventory-query-note">Los importes PEPS y Promedio son valores del movimiento o saldo (no costos unitarios). “Sin valorizar” indica que Supabase no dispone de un costo histórico comprobable.</p>}
  </section>
}
