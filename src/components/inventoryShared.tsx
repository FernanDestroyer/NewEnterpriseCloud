import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { RefreshCw } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useRecords } from '../context/RecordsContext'
import { inventoryQueryError, loadInventoryStocks, loadInventoryWarehouses, type InventoryStock, type InventoryWarehouse } from '../services/inventoryQueries'
import '../inventory-operations.css'

export function useInventoryReference() {
  const { can } = useAuth()
  const { records, errors, reload } = useRecords()
  const [warehouses, setWarehouses] = useState<InventoryWarehouse[]>([])
  const [stocks, setStocks] = useState<InventoryStock[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const loadSequence = useRef(0)

  const refresh = useCallback(async () => {
    const sequence = ++loadSequence.current
    setLoading(true)
    setError('')
    try {
      const [nextWarehouses, nextStocks] = await Promise.all([loadInventoryWarehouses(), loadInventoryStocks()])
      if (sequence === loadSequence.current) { setWarehouses(nextWarehouses); setStocks(nextStocks) }
    } catch (cause) {
      if (sequence !== loadSequence.current) return
      setError(inventoryQueryError(cause))
      throw cause
    } finally {
      if (sequence === loadSequence.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!can('inventory', 'ver')) return
    void refresh().catch(() => {})
    return () => { loadSequence.current++ }
  }, [can, refresh])

  const reloadReferences = useCallback(async () => {
    const [references, catalog] = await Promise.allSettled([refresh(), reload({ throwOnError: true })])
    if (references.status === 'rejected') throw references.reason
    if (catalog.status === 'rejected') throw catalog.reason
  }, [refresh, reload])

  const products = useMemo(() => records.inventory.filter(item => item.rowId).sort((a, b) => a.name.localeCompare(b.name, 'es')), [records.inventory])
  const byProduct = useMemo(() => new Map(products.map(item => [item.rowId!, item])), [products])
  const byWarehouse = useMemo(() => new Map(warehouses.map(item => [item.id, item.nombre])), [warehouses])
  const stocksByLocation = useMemo(() => new Map(stocks.map(row => [`${row.producto_id}:${row.almacen_id}`, row])), [stocks])
  const stockAt = (productId: string, warehouseId: string) => stocksByLocation.get(`${productId}:${warehouseId}`)
  const visibleError = error || (errors.inventory ? `No se pudo cargar el catálogo de productos: ${errors.inventory}` : '')
  return { can, products, byProduct, warehouses, byWarehouse, activeWarehouses: warehouses.filter(item => item.activo), stocks, stockAt, loading, error: visibleError, refresh, reloadReferences }
}

export function InventoryHeader({ title, description, onRefresh, loading }: { title: string; description: string; onRefresh: () => Promise<void> | void; loading: boolean }) {
  return <header className="ws-page-heading inv-heading"><div><span className="ws-eyebrow">INVENTARIO Y KARDEX · OPERACIÓN</span><h1>{title}</h1><p>{description}</p></div><div className="ws-heading-actions"><button type="button" className="ws-button ws-button-secondary" onClick={() => { void Promise.resolve(onRefresh()).catch(() => {}) }} disabled={loading}><RefreshCw size={15} className={loading ? 'ws-spin' : ''} />Actualizar</button></div></header>
}

export function InventoryMessage({ children, tone = 'warning' }: { children: ReactNode; tone?: 'warning' | 'success' }) {
  return <div className={`inv-message ${tone}`} role={tone === 'warning' ? 'alert' : 'status'}>{children}</div>
}

export function InventoryGate({ canView, children }: { canView: boolean; children: ReactNode }) {
  if (!canView) return <section className="ws-card"><div className="ws-empty-compact"><strong>No tienes permiso para consultar Inventario.</strong></div></section>
  return <>{children}</>
}

// La clave y el payload deben permanecer iguales después de una respuesta incierta.
// Se consulta antes de enviar y otra vez tras cualquier error de escritura.
export function useInventorySubmission() {
  const [busy, setBusy] = useState(false)
  const [unresolved, setUnresolved] = useState(false)
  const [message, setMessage] = useState('')
  const [success, setSuccess] = useState('')
  const [refreshError, setRefreshError] = useState('')

  const run = async (input: {
    find: () => Promise<string | null>
    write: () => Promise<string>
    saved: (id: string) => void
    success: (id: string) => string
    reload: () => Promise<void>
  }) => {
    if (busy) return
    setBusy(true); setMessage(''); setSuccess(''); setRefreshError('')
    let id: string
    try {
      try {
        id = await input.find() ?? await input.write()
      } catch (cause) {
        try {
          const existing = await input.find()
          if (!existing) {
            setUnresolved(false)
            setMessage(inventoryQueryError(cause))
            return
          }
          id = existing
        } catch {
          setUnresolved(true)
          setMessage('No se pudo verificar el resultado. No modifiques los datos; reintenta con la misma clave para reconciliar.')
          return
        }
      }
      setUnresolved(false)
      input.saved(id)
      setSuccess(input.success(id))
      try {
        await input.reload()
      } catch (cause) {
        setRefreshError(`Operación guardada, pero no se actualizaron los saldos: ${inventoryQueryError(cause)}`)
      }
    } finally { setBusy(false) }
  }
  return { busy, unresolved, message, success, refreshError, setMessage, run }
}

export const units = (value: number) => new Intl.NumberFormat('es-PE').format(value)
export const localDateTime = (value: string) => new Date(value).toLocaleString('es-PE', { timeZone: 'America/Lima', dateStyle: 'short', timeStyle: 'short' })
