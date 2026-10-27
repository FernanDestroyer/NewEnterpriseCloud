import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { RefreshCw } from 'lucide-react'
import {
  fetchMeasurementUnits,
  fetchProductCategories,
  friendlyError,
  saveMeasurementUnit,
  saveProductCategory,
  setMeasurementUnitActive,
  setProductCategoryActive,
  type MeasurementUnit,
  type ProductCategory,
} from '../services/records'

type CatalogTab = 'categorias' | 'unidades'

export default function ProductCatalogSetup({ canCreate, canEdit }: { canCreate: boolean; canEdit: boolean }) {
  const [tab, setTab] = useState<CatalogTab>('categorias')
  const [categories, setCategories] = useState<ProductCategory[]>([])
  const [units, setUnits] = useState<MeasurementUnit[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [nextCategories, nextUnits] = await Promise.all([fetchProductCategories(), fetchMeasurementUnits()])
      setCategories(nextCategories)
      setUnits(nextUnits)
    } catch (cause) {
      setError(friendlyError(cause))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy || !canCreate) return
    const form = event.currentTarget
    const values = new FormData(form)
    setBusy(true)
    setError('')
    setMessage('')
    try {
      if (tab === 'categorias') {
        await saveProductCategory({ nombre: String(values.get('nombre') ?? ''), descripcion: String(values.get('descripcion') ?? '') })
        setMessage('Categoría guardada.')
      } else {
        await saveMeasurementUnit({ codigo: String(values.get('codigo') ?? ''), nombre: String(values.get('nombre') ?? ''), simbolo: String(values.get('simbolo') ?? '') })
        setMessage('Unidad de medida guardada.')
      }
      form.reset()
      await load()
    } catch (cause) {
      setError(friendlyError(cause))
    } finally {
      setBusy(false)
    }
  }

  const toggleCategory = async (item: ProductCategory) => {
    if (busy || !canEdit) return
    setBusy(true); setError(''); setMessage('')
    try {
      await setProductCategoryActive(item.id, !item.activo)
      await load()
      setMessage(`Categoría ${item.activo ? 'desactivada' : 'activada'}.`)
    } catch (cause) { setError(friendlyError(cause)) }
    finally { setBusy(false) }
  }

  const toggleUnit = async (item: MeasurementUnit) => {
    if (busy || !canEdit) return
    setBusy(true); setError(''); setMessage('')
    try {
      await setMeasurementUnitActive(item.id, !item.activo)
      await load()
      setMessage(`Unidad ${item.activo ? 'desactivada' : 'activada'}.`)
    } catch (cause) { setError(friendlyError(cause)) }
    finally { setBusy(false) }
  }

  return <div className="ws-product-catalog-setup">
    <div className="ws-tabs" role="tablist" aria-label="Catálogos de productos">
      <button type="button" role="tab" aria-selected={tab === 'categorias'} onClick={() => setTab('categorias')}>Categorías</button>
      <button type="button" role="tab" aria-selected={tab === 'unidades'} onClick={() => setTab('unidades')}>Unidades de medida</button>
    </div>
    <p className="relation-hint">Desactivar conserva el historial y los productos vinculados. Las cantidades de V1 son enteras; las unidades fraccionarias requieren una migración coordinada de inventario y documentos.</p>
    {loading ? <div className="ws-empty-compact"><RefreshCw size={24} className="ws-spin" /><strong>Cargando catálogos…</strong></div> : tab === 'categorias' ? <>
      <div className="supplier-product-list">{categories.map(item => <div className="supplier-product-row" key={item.id}>
        <span className="supplier-product-copy"><strong>{item.nombre}</strong><small>{item.descripcion || 'Sin descripción'} · {item.activo ? 'Activa' : 'Desactivada'}</small></span>
        {canEdit && <span className="supplier-product-actions"><button className="export-button" type="button" disabled={busy} onClick={() => void toggleCategory(item)}>{item.activo ? 'Desactivar' : 'Activar'}</button></span>}
      </div>)}{!categories.length && <div className="ws-empty-compact">Aún no hay categorías.</div>}</div>
      {canCreate && <form className="ws-product-catalog-form" onSubmit={submit}>
        <label>Nombre<input name="nombre" required minLength={2} maxLength={80} placeholder="Ej. Materia prima" /></label>
        <label>Descripción<input name="descripcion" maxLength={240} placeholder="Uso o clasificación" /></label>
        <button className="primary-button" type="submit" disabled={busy}>{busy ? 'Guardando…' : 'Agregar categoría'}</button>
      </form>}
    </> : <>
      <div className="supplier-product-list">{units.map(item => <div className="supplier-product-row" key={item.id}>
        <span className="supplier-product-copy"><strong>{item.nombre} · {item.simbolo}</strong><small>{item.codigo} · {item.precisionDecimales} decimales · {item.activo ? 'Activa' : 'Desactivada'}</small></span>
        {canEdit && <span className="supplier-product-actions"><button className="export-button" type="button" disabled={busy} onClick={() => void toggleUnit(item)}>{item.activo ? 'Desactivar' : 'Activar'}</button></span>}
      </div>)}{!units.length && <div className="ws-empty-compact">Aún no hay unidades de medida.</div>}</div>
      {canCreate && <form className="ws-product-catalog-form" onSubmit={submit}>
        <label>Código<input name="codigo" required minLength={2} maxLength={12} pattern="[A-Za-z0-9_-]+" placeholder="UND" /></label>
        <label>Nombre<input name="nombre" required minLength={2} maxLength={80} placeholder="Unidad" /></label>
        <label>Símbolo<input name="simbolo" required maxLength={12} placeholder="und" /></label>
        <button className="primary-button" type="submit" disabled={busy}>{busy ? 'Guardando…' : 'Agregar unidad'}</button>
      </form>}
    </>}
    {message && <div className="ws-notice ws-notice-success" role="status">{message}</div>}
    {error && <div className="ws-notice ws-notice-warning" role="alert">{error}</div>}
  </div>
}
