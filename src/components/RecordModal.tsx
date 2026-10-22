import { useEffect, useMemo, useRef, useState, Fragment } from 'react'
import type { FormEvent } from 'react'
import { pageMeta } from '../data/catalog'
import { defaultStatus, LOW_STOCK_THRESHOLD, money, statusesForPage, totalWithIgv } from '../data/helpers'
import { useRecords } from '../context/RecordsContext'
import { useAuth } from '../context/AuthContext'
import { fetchDocumentLines, fetchPaymentMethods, friendlyError } from '../services/records'
import { customerCredit } from '../data/workspace'
import { isPeruLookupConfigured, lookupDni, lookupRuc, type DocType } from '../services/peru'
import { SUPPLIER_PAYMENT_TERMS } from '../services/import'
import { salePayableTotal, walletForMethod, type YapeSettings } from '../data/payments'
import { fetchWalletSettings } from '../services/yape'
import YapePaymentPanel from './YapePaymentPanel'
import type { DataPage, DocumentLine, RecordItem, RecordStatus } from '../types'
import { useDialog } from './useDialog'

/** Comprobante de venta: tipos con su serie y correlativo automático (editable). */
const SALE_DOC_TYPES = ['Factura', 'Boleta', 'Cotización', 'Nota de venta'] as const
type SaleDocType = (typeof SALE_DOC_TYPES)[number] | 'Manual'
const SALE_CITIES = ['Lima', 'Arequipa', 'Cusco', 'Trujillo', 'Piura', 'Chiclayo', 'Huancayo', 'Iquitos', 'Tacna']

function nextSaleDocNumber(sales: RecordItem[], tipo: string): string {
  const patterns: Record<string, RegExp> = {
    Factura: /F\d+-(\d+)/,
    Boleta: /B\d+-(\d+)/,
    Cotización: /COT-(\d+)/,
    'Nota de venta': /NV-(\d+)/,
  }
  const rx = patterns[tipo]
  let max = 0
  if (rx) {
    for (const sale of sales) {
      const match = sale.detail.match(rx)
      if (match) max = Math.max(max, Number(match[1]))
    }
  }
  const next = max + 1
  if (tipo === 'Factura') return `F001-${String(next).padStart(4, '0')}`
  if (tipo === 'Boleta') return `B001-${String(next).padStart(4, '0')}`
  if (tipo === 'Cotización') return `COT-${String(next).padStart(4, '0')}`
  return `NV-${String(next).padStart(3, '0')}`
}

function parseSaleDetail(detail: string): { tipo: SaleDocType; ciudad: string } {
  const match = detail.match(/^(Factura|Boleta|Cotización|Nota de venta)\s+\S+\s*·\s*(.+)$/)
  if (match) return { tipo: match[1] as SaleDocType, ciudad: match[2].trim() }
  return { tipo: 'Manual', ciudad: 'Lima' }
}

/** Icono de Google (Material Symbols Outlined). Requiere el <link> de index.html. */
function GoogleIcon({ name, className = '' }: { name: string; className?: string }) {
  return (
    <span className={`gicon${className ? ` ${className}` : ''}`} aria-hidden="true">
      {name}
    </span>
  )
}

type LineDraft = { selected: boolean; qty: number; price: number }

export default function RecordModal({ page, record, saving = false, onClose, onSave }: { page: DataPage; record: RecordItem | null; saving?: boolean; onClose: () => void; onSave: (event: FormEvent<HTMLFormElement>) => void }) {
  const meta = pageMeta[page]
  const editing = Boolean(record)
  const { records, catalog, lastSyncedAt } = useRecords()
  const { can } = useAuth()
  // Descuento % en ventas (solo roles con finanzas; se aplica al subtotal).
  const [discountPct, setDiscountPct] = useState(record?.descuento ?? 0)
  // Medios de pago para elegir cómo pagará el cliente (llega solo).
  const [saleMethods, setSaleMethods] = useState<string[]>(['Efectivo'])
  const [saleMethod, setSaleMethod] = useState(record?.medio || 'Efectivo')
  const [manualAmount, setManualAmount] = useState(record?.amount === undefined ? '' : String(record.amount))
  const [yapeSettings, setYapeSettings] = useState<YapeSettings | null>(null)
  const [yapeLoading, setYapeLoading] = useState(false)
  const [yapeError, setYapeError] = useState('')
  const [yapeReload, setYapeReload] = useState(0)
  useEffect(() => {
    if (page !== 'sales') return
    let active = true
    fetchPaymentMethods()
      .then((methods) => {
        if (!active) return
        const names = methods.map(method => method.nombre)
        // Conserva el medio de una venta antigua aunque haya sido desactivado.
        if (record?.medio && !names.includes(record.medio)) names.unshift(record.medio)
        if (!names.length) names.push('Efectivo')
        setSaleMethods(names)
        setSaleMethod(current => names.includes(current) ? current : names[0])
      })
      .catch(() => active && setSaleMethods(['Efectivo']))
    return () => {
      active = false
    }
  }, [page, record?.medio])
  useEffect(() => {
    if (page !== 'sales' || !walletForMethod(saleMethod)) {
      setYapeSettings(null)
      setYapeError('')
      setYapeLoading(false)
      return
    }
    let active = true
    setYapeSettings(null)
    setYapeLoading(true)
    setYapeError('')
    fetchWalletSettings(walletForMethod(saleMethod)!).then(settings => { if (active) setYapeSettings(settings) })
      .catch(error => { if (active) setYapeError(friendlyError(error)) })
      .finally(() => { if (active) setYapeLoading(false) })
    return () => { active = false }
  }, [page, saleMethod, lastSyncedAt, yapeReload])
  const dialogRef = useDialog<HTMLFormElement>(onClose, saving)

  const hasClientRelation = page === 'sales' || page === 'quotes'
  const hasSupplierRelation = page === 'purchases'
  const hasDocumentLines = page === 'sales' || page === 'purchases' || page === 'quotes'

  const initialRelated =
    hasClientRelation ? (record?.cliente_id ?? '') : hasSupplierRelation ? (record?.proveedor_id ?? '') : ''

  const [relatedId, setRelatedId] = useState<string>(initialRelated ?? '')
  const [nameValue, setNameValue] = useState<string>(record?.name ?? '')
  const [statusValue, setStatusValue] = useState(record?.status ?? defaultStatus(page))
  // Comprobante automático (solo ventas): tipo + ciudad generan el detalle con
  // el siguiente correlativo de la serie. Escribir a mano pasa a modo Manual.
  const initialDoc = page === 'sales'
    ? (record ? parseSaleDetail(record.detail) : { tipo: 'Factura' as SaleDocType, ciudad: 'Lima' })
    : { tipo: 'Manual' as SaleDocType, ciudad: 'Lima' }
  const [docType, setDocType] = useState<SaleDocType>(initialDoc.tipo)
  const [docCity, setDocCity] = useState<string>(initialDoc.ciudad)
  const [detailTouched, setDetailTouched] = useState(false)
  const [detailValue, setDetailValue] = useState<string>(
    record?.detail ?? (page === 'sales' ? `Factura ${nextSaleDocNumber(records.sales, 'Factura')} · Lima` : ''),
  )
  const [lines, setLines] = useState<Record<string, LineDraft>>({})
  // Documento para consulta RENIEC/SUNAT: clientes eligen DNI o RUC, proveedores usan RUC.
  const [docKind, setDocKind] = useState<DocType>(record?.tipoDoc ?? 'RUC')
  const [docNumber, setDocNumber] = useState<string>(record?.documento ?? '')
  const [rucValue, setRucValue] = useState<string>(record?.ruc ?? '')
  // Contacto del proveedor (nuevo registro o edición).
  const [direccionValue, setDireccionValue] = useState<string>(record?.direccion ?? '')
  const [correoValue, setCorreoValue] = useState<string>(record?.correo ?? '')
  const [telefonoValue, setTelefonoValue] = useState<string>(record?.telefono ?? '')
  const [formaPagoValue, setFormaPagoValue] = useState<string>(record?.formaPago ?? '')
  // Productos que ofrece el proveedor, agregados a mano antes de guardar.
  const [draftName, setDraftName] = useState('')
  const [draftCosto, setDraftCosto] = useState('')
  const [draftDetail, setDraftDetail] = useState('')
  const [drafts, setDrafts] = useState<Array<{ nombre: string; costo: number; detalle: string }>>([])
  const [lookup, setLookup] = useState<{ busy: boolean; message: string; ok: boolean }>({ busy: false, message: '', ok: false })
  const lookupButtonRef = useRef<HTMLButtonElement>(null)
  const [linesLoading, setLinesLoading] = useState(false)
  const [lineError, setLineError] = useState('')
  const [lineReload, setLineReload] = useState(0)
  const [originalQuantities, setOriginalQuantities] = useState<Record<string, number>>({})
  const [originalLineTotals, setOriginalLineTotals] = useState({ count: 0, subtotal: 0 })
  // Buscador del proveedor (compras) o del cliente (ventas): filtra la lista.
  const [supplierQuery, setSupplierQuery] = useState('')
  const [customerQuery, setCustomerQuery] = useState('')
  // Paginación de la lista de proveedores: los 3 primeros, el resto con flechas.
  const [supplierPage, setSupplierPage] = useState(0)
  const [supplierPageSize, setSupplierPageSize] = useState(3)
  useEffect(() => {
    setSupplierPage(0)
  }, [page, supplierQuery])
  // Paginación de la lista de clientes: los 3 primeros, el resto con flechas.
  const [customerPage, setCustomerPage] = useState(0)
  const [customerPageSize, setCustomerPageSize] = useState(3)
  useEffect(() => {
    setCustomerPage(0)
  }, [page, customerQuery])
  // Buscador de productos del catálogo (compras): filtrado visual, sin
  // desmontar filas para no perder lo ya marcado al guardar.
  const [productQuery, setProductQuery] = useState('')
  const [productFilter, setProductFilter] = useState<'all' | 'new' | 'linked'>('all')

  const customers = records.customers
  const suppliers = records.suppliers
  const inventory = records.inventory
  // Ventas/cotizaciones eligen de MI inventario; compras del CATÁLOGO del proveedor.
  const lineSource = page === 'purchases' ? catalog : inventory
  const lineUnitPrice = (item: RecordItem) => (page === 'purchases' ? (item.amount ?? 0) : (item.precio ?? 0))
  const availableStock = (item?: RecordItem) => (item?.quantity ?? 0) + (page === 'sales' && record && item?.rowId ? originalQuantities[item.rowId] ?? 0 : 0)
  const options = hasClientRelation ? customers : hasSupplierRelation ? suppliers : []

  const linkedTarget = relatedId ? options.find((item) => item.rowId === relatedId) : undefined

  const handleRelatedChange = (value: string) => {
    setRelatedId(value)
    if (!value) return
    // El nombre se hereda del registro elegido para mantener coherencia con la FK.
    const target = options.find((item) => item.rowId === value)
    if (target) setNameValue(target.name)
  }

  // Compras: al hacer clic en un proveedor se vincula y su razón social se
  // hereda en el nombre; su ficha (RUC, contacto y dirección) queda visible.
  const selectSupplier = (value: string) => {
    handleRelatedChange(value)
    setSupplierQuery('')
    setSupplierPage(0)
  }

  // Ventas: al hacer clic en un cliente se vincula y su razón social se
  // hereda en el nombre; su ficha (documento y detalle) queda visible.
  const selectCustomer = (value: string) => {
    handleRelatedChange(value)
    setCustomerQuery('')
    setCustomerPage(0)
  }

  // Proveedores con catálogo cargado (para el filtro del buscador).
  const catalogSupplierIds = useMemo(
    () => new Set(catalog.map((item) => item.proveedor_id).filter(Boolean)),
    [catalog],
  )

  // Buscador de proveedores (compras): texto libre sobre la lista completa.
  const filteredSuppliers = useMemo(() => {
    if (page !== 'purchases') return options
    const query = supplierQuery.trim().toLowerCase()
    if (!query) return options
    return options.filter((item) => [item.name, item.id, item.ruc ?? '', item.correo ?? '', item.telefono ?? '']
      .join(' ')
      .toLowerCase()
      .includes(query))
  }, [page, options, supplierQuery])
  const supplierPageCount = Math.max(1, Math.ceil(filteredSuppliers.length / supplierPageSize))
  const safeSupplierPage = Math.min(supplierPage, supplierPageCount - 1)
  const pagedSuppliers = filteredSuppliers.slice(safeSupplierPage * supplierPageSize, safeSupplierPage * supplierPageSize + supplierPageSize)

  // Buscador de clientes (ventas y cotizaciones): razón social, código, documento o detalle.
  const filteredCustomers = useMemo(() => {
    if (page !== 'sales' && page !== 'quotes') return options
    const query = customerQuery.trim().toLowerCase()
    if (!query) return options
    return options.filter((item) => [item.name, item.id, item.documento ?? '', item.detail ?? '']
      .join(' ')
      .toLowerCase()
      .includes(query))
  }, [page, options, customerQuery])
  const customerPageCount = Math.max(1, Math.ceil(filteredCustomers.length / customerPageSize))
  const safeCustomerPage = Math.min(customerPage, customerPageCount - 1)
  const pagedCustomers = filteredCustomers.slice(safeCustomerPage * customerPageSize, safeCustomerPage * customerPageSize + customerPageSize)

  const handleDocTypeChange = (tipo: SaleDocType) => {
    setDocType(tipo)
    if (tipo === 'Manual' || page !== 'sales') return
    // Al elegir tipo se propone el siguiente correlativo de su serie.
    setDetailTouched(false)
    setDetailValue(`${tipo} ${nextSaleDocNumber(records.sales, tipo)} · ${docCity}`)
  }

  const handleCityChange = (ciudad: string) => {
    setDocCity(ciudad)
    if (docType === 'Manual') return
    // La ciudad solo cambia el sufijo: conserva el número ya propuesto.
    setDetailValue((current) => {
      const base = current.includes('·') ? current.split('·')[0].trim() : current.trim()
      if (!base) return `${docType} ${nextSaleDocNumber(records.sales, docType)} · ${ciudad}`
      return `${base} · ${ciudad}`
    })
  }

  const readDocNumber = (button: HTMLButtonElement | null, kind: 'customer' | 'supplier') => {
    const form = button?.form
    if (!form) return ''
    return String(new FormData(form).get(kind === 'supplier' ? 'ruc' : 'documento') ?? '')
  }

  const addDraftProduct = () => {
    const nombre = draftName.trim()
    const costo = Number(draftCosto)
    if (nombre.length < 2) {
      setLookup({ busy: false, message: 'El producto necesita un nombre de al menos 2 caracteres.', ok: false })
      return
    }
    if (!Number.isFinite(costo) || costo < 0) {
      setLookup({ busy: false, message: 'El costo del producto debe ser cero o mayor.', ok: false })
      return
    }
    setDrafts((current) => [...current, { nombre, costo: Math.round(costo * 100) / 100, detalle: draftDetail.trim() }])
    setDraftName('')
    setDraftCosto('')
    setDraftDetail('')
    setLookup({ busy: false, message: `"${nombre}" agregado a la lista. Se guardará con el proveedor.`, ok: true })
  }

  // Consulta el DNI en RENIEC o el RUC en SUNAT y completa nombre + detalle.
  // Lee el número vivo del formulario (no del estado) para evitar leer un
  // valor anterior si el clic llega antes de que React asiente el último cambio.
  const runLookup = async (kind: 'customer' | 'supplier', numeroRaw: string) => {
    if (lookup.busy) return
    const tipo: DocType = kind === 'supplier' ? 'RUC' : docKind
    const numero = numeroRaw.replace(/\D/g, '')
    setLookup({ busy: true, message: `Consultando en ${tipo === 'DNI' ? 'RENIEC' : 'SUNAT'}…`, ok: false })
    try {
      const result = tipo === 'DNI' ? await lookupDni(numero) : await lookupRuc(numero)
      setNameValue(result.nombre)
      setDetailValue(result.detalle)
      if (kind === 'supplier') {
        setRucValue(result.documento)
        if (result.direccion) setDireccionValue(result.direccion)
      }
      else {
        setDocNumber(result.documento)
        setDocKind(result.tipoDoc)
      }
      setLookup({ busy: false, message: `${result.tipoDoc} ${result.documento} verificado. Datos completados, revísalos y guarda.`, ok: true })
    } catch (error) {
      setLookup({ busy: false, message: error instanceof Error ? error.message : 'No se pudo completar la consulta.', ok: false })
    } finally {
      // El botón se deshabilita durante la búsqueda y el foco se pierde.
      // Se devuelve tras el re-render (cuando vuelve a habilitarse) para que
      // el teclado (Escape/Tab) siga funcionando dentro del diálogo.
      requestAnimationFrame(() => lookupButtonRef.current?.focus({ preventScroll: true }))
    }
  }

  // Si la lista de ventas aún cargaba al abrir, recalcula el correlativo al llegar.
  useEffect(() => {
    if (page !== 'sales' || record || detailTouched || docType === 'Manual') return
    setDetailValue(`${docType} ${nextSaleDocNumber(records.sales, docType)} · ${docCity}`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, record, detailTouched, records.sales])

  // Precarga las líneas guardadas al editar una venta/compra.
  useEffect(() => {
    if (!hasDocumentLines || !record?.rowId) return
    let active = true
    setLinesLoading(true)
    setLineError('')
    fetchDocumentLines(page as 'sales' | 'purchases' | 'quotes', record.rowId)
      .then((previous: DocumentLine[]) => {
        if (!active) return
        const draft: Record<string, LineDraft> = {}
        const quantities: Record<string, number> = {}
        for (const line of previous) {
          draft[line.producto_id] = { selected: true, qty: line.cantidad, price: line.precio }
          quantities[line.producto_id] = (quantities[line.producto_id] ?? 0) + line.cantidad
        }
        setLines(draft)
        setOriginalQuantities(quantities)
        setOriginalLineTotals({ count: previous.length, subtotal: previous.reduce((sum, line) => sum + line.cantidad * line.precio, 0) })
      })
      .catch(error => { if (active) { setLines({}); setLineError(friendlyError(error)) } })
      .finally(() => active && setLinesLoading(false))
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasDocumentLines, record?.rowId, lineReload])

  // En compras solo se compra del CATÁLOGO del proveedor elegido (su oferta).
  // Sin proveedor no hay base: lo ya marcado se conserva aparte (edición segura).
  const purchaseBase = useMemo(() => {
    if (page !== 'purchases' || !relatedId) return []
    return catalog.filter((item) => item.proveedor_id === relatedId)
  }, [page, relatedId, catalog])

  const baseProducts = page === 'purchases' ? purchaseBase : inventory

  // No perder lo ya marcado al cambiar el filtro (edición segura): lo
  // seleccionado siempre queda visible aunque el filtro lo oculte.
  const visibleProducts = useMemo(() => {
    const selectedIds = new Set(
      Object.entries(lines)
        .filter(([, draft]) => draft.selected)
        .map(([id]) => id),
    )
    if (!selectedIds.size) return baseProducts
    const baseIds = new Set(baseProducts.map((product) => product.rowId))
    const extras = lineSource.filter((product) => product.rowId && selectedIds.has(product.rowId) && !baseIds.has(product.rowId))
    return extras.length ? [...baseProducts, ...extras] : baseProducts
  }, [baseProducts, lines, lineSource])

  // Productos que pasan la búsqueda + filtro (compras) o solo búsqueda
  // (ventas y cotizaciones). Lo ya marcado nunca se oculta para poder
  // desmarcarlo; las filas ocultas siguen montadas para no perder sus
  // inputs al guardar.
  const productMatches = useMemo(() => {
    if (page !== 'purchases' && page !== 'sales' && page !== 'quotes') return null
    const query = productQuery.trim().toLowerCase()
    const ids = new Set<string>()
    for (const product of visibleProducts) {
      const uuid = product.rowId
      if (!uuid) continue
      if (lines[uuid]?.selected) {
        ids.add(uuid)
        continue
      }
      if (page === 'purchases') {
        if (productFilter === 'new' && product.productoId) continue
        if (productFilter === 'linked' && !product.productoId) continue
      }
      if (query && ![product.name, product.id, product.detail ?? ''].join(' ').toLowerCase().includes(query)) continue
      ids.add(uuid)
    }
    return ids
  }, [page, visibleProducts, lines, productQuery, productFilter])

  const productCounts = useMemo(() => {
    if (page !== 'purchases') return { total: 0, fresh: 0, linked: 0 }
    let fresh = 0
    for (const product of baseProducts) if (!product.productoId) fresh += 1
    return { total: baseProducts.length, fresh, linked: baseProducts.length - fresh }
  }, [page, baseProducts])

  const supplierHasRelated = page === 'purchases' && relatedId
    ? purchaseBase.length > 0
    : true

  // Compras, ventas y cotizaciones: lista paginada (3 por página); el resto
  // se encuentra con el buscador. Lo ya marcado siempre va primero para no
  // perderlo al guardar.
  const [productPage, setProductPage] = useState(0)
  const [productPageSize, setProductPageSize] = useState(3)
  useEffect(() => {
    setProductPage(0)
  }, [page, productQuery, productFilter, relatedId])
  const matchingProducts = useMemo(() => {
    if (page !== 'purchases' && page !== 'sales' && page !== 'quotes') return visibleProducts
    const chosen: RecordItem[] = []
    const rest: RecordItem[] = []
    for (const product of visibleProducts) {
      const uuid = product.rowId
      if (!uuid) continue
      if (productMatches && !productMatches.has(uuid)) continue
      (lines[uuid]?.selected ? chosen : rest).push(product)
    }
    return [...chosen, ...rest]
  }, [page, visibleProducts, lines, productMatches])
  const productPageCount = Math.max(1, Math.ceil(matchingProducts.length / productPageSize))
  const safeProductPage = Math.min(productPage, productPageCount - 1)
  const displayProducts = useMemo(() => {
    if (page !== 'purchases' && page !== 'sales' && page !== 'quotes') return visibleProducts
    const start = safeProductPage * productPageSize
    return matchingProducts.slice(start, start + productPageSize)
  }, [page, visibleProducts, matchingProducts, safeProductPage, productPageSize])
  // Marcados que quedan fuera de la página: inputs ocultos para no perderlos.
  const offPageSelected = useMemo(() => {
    if (page !== 'purchases' && page !== 'sales' && page !== 'quotes') return []
    const shown = new Set(displayProducts.map((product) => product.rowId))
    return visibleProducts.filter((product) => product.rowId && lines[product.rowId]?.selected && !shown.has(product.rowId))
  }, [page, visibleProducts, lines, displayProducts])

  const toggleLine = (uuid: string) => {
    // Al marcar se toma el precio fijo (del producto en mi inventario o del
    // catálogo del proveedor en compras; no se edita por línea).
    const product = lineSource.find((item) => item.rowId === uuid)
    // En ventas no se puede marcar un producto sin stock.
    if (page === 'sales' && availableStock(product) <= 0) {
      const already = Object.prototype.hasOwnProperty.call(lines, uuid) && lines[uuid]?.selected
      if (!already) return
    }
    const suggested = product ? lineUnitPrice(product) : 0
    const stock = availableStock(product)
    setLines((current) => {
      if (current[uuid]?.selected) return { ...current, [uuid]: { ...current[uuid], selected: false } }
      const qty = current[uuid]?.qty ?? 1
      return {
        ...current,
        [uuid]: {
          selected: true,
          qty: page === 'sales' ? Math.min(qty, Math.max(1, stock)) : qty,
          price: current[uuid]?.price ?? suggested,
        },
      }
    })
  }

  const changeLine = (uuid: string, patch: Partial<LineDraft>) => {
    setLines((current) => ({
      ...current,
      [uuid]: { selected: true, qty: current[uuid]?.qty ?? 1, price: current[uuid]?.price ?? 0, ...patch },
    }))
  }

  const selectedLines = useMemo(
    () =>
      visibleProducts
        .filter((product) => product.rowId && lines[product.rowId]?.selected)
        .map((product) => {
          const uuid = product.rowId as string
          const draft = lines[uuid]
          return { product, qty: draft.qty, price: draft.price, subtotal: draft.qty * draft.price }
        }),
    [visibleProducts, lines],
  )
  const linesTotal = selectedLines.reduce((sum, line) => sum + line.subtotal, 0)
  // El guardado conserva las líneas anteriores si una edición no marca ninguna.
  const saleHasLines = selectedLines.length > 0 || Boolean(record?.rowId && originalLineTotals.count)
  const saleSubtotal = selectedLines.length ? linesTotal : originalLineTotals.subtotal
  const saleTotal = salePayableTotal(saleSubtotal, discountPct, Number(manualAmount), saleHasLines)

  // Completada en cotizaciones solo se alcanza con «Convertir en venta».
  // Si el registro trae un estado antiguo (En curso), se conserva en la lista.
  const statusOptions = page === 'quotes'
    ? record?.status === 'Completada'
      ? ['Completada']
      : record && !statusesForPage(page).includes(record.status)
        ? [record.status, ...statusesForPage(page)]
        : statusesForPage(page)
    : statusesForPage(page)

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => !saving && event.target === event.currentTarget && onClose()}>
      <form ref={dialogRef} className={`record-modal record-modal--wide${page === 'purchases' || page === 'sales' || page === 'quotes' ? ' record-modal--split' : ''}`} onSubmit={onSave} role="dialog" aria-modal="true" aria-label={editing ? `Editar ${meta.title}` : meta.action}>
        <div className="modal-heading"><div><span className="section-kicker"><i /> {meta.eyebrow}</span><h2>{editing ? `Editar registro de ${meta.title.toLocaleLowerCase()}` : meta.action}</h2><p>{editing ? 'Los cambios se guardarán en la base de datos.' : 'El registro se guardará en la base de datos.'}</p></div><button className="modal-close" type="button" aria-label="Cerrar" onClick={onClose}><GoogleIcon name="close" /></button></div>
        <div className="modal-fields">
          {(hasClientRelation || hasSupplierRelation) && (page === 'purchases' ? (
            <div className="relation-field">
              <label>Proveedor de la orden</label>
              <input type="hidden" name="related_id" value={relatedId} />
              {linkedTarget ? (
                <>
                  <div className="supplier-product-row supplier-selected">
                    <span className="supplier-product-copy">
                      <strong>{linkedTarget.name}</strong>
                      <small>RUC {linkedTarget.ruc ?? '—'} · {linkedTarget.id}</small>
                      <small>{[linkedTarget.correo, linkedTarget.telefono].filter(Boolean).join(' · ') || linkedTarget.detail || 'Sin contacto registrado'}</small>
                      <small>{linkedTarget.direccion || 'Sin dirección registrada'}</small>
                    </span>
                    <span className="supplier-product-actions">
                      <button className="export-button" type="button" onClick={() => { setRelatedId(''); setSupplierPage(0) }}>Cambiar</button>
                    </span>
                  </div>
                  <small className="relation-hint linked">
                    <GoogleIcon name="link" className="small" />
                    Vinculado a {linkedTarget.name} ({linkedTarget.id}). RUC, contacto y dirección.
                  </small>
                </>
              ) : !options.length ? (
                <small className="relation-hint">
                  <GoogleIcon name="person_add" className="small" />
                  Aún no hay proveedores registrados. Escribe el nombre manualmente o crea primero el registro en su módulo.
                </small>
              ) : (
                <>
                  <span className="relation-control">
                    <GoogleIcon name="search" />
                    <input
                      id="supplier_search"
                      value={supplierQuery}
                      onChange={(event) => setSupplierQuery(event.target.value)}
                      placeholder="Buscar por razón social, RUC o código…"
                      aria-label="Buscar proveedor"
                    />
                  </span>
                  {filteredSuppliers.length ? (
                    <>
                      <div className="supplier-results" role="listbox" aria-label="Proveedores registrados">
                        {pagedSuppliers.map((item) => (
                          <button key={item.rowId ?? item.id} type="button" role="option" aria-selected={false} className="supplier-product-row supplier-result" onClick={() => selectSupplier(item.rowId ?? '')}>
                            <span className="supplier-product-copy">
                              <strong>{item.name}</strong>
                              <small>{item.ruc ? `RUC ${item.ruc} · ` : ''}{item.id}{item.rowId && catalogSupplierIds.has(item.rowId) ? ' · Con catálogo' : ''}</small>
                            </span>
                            <GoogleIcon name="chevron_right" className="small" />
                          </button>
                        ))}
                      </div>
                      <div className="lines-pagination">
                        <span>{safeSupplierPage * supplierPageSize + 1}–{Math.min(safeSupplierPage * supplierPageSize + supplierPageSize, filteredSuppliers.length)} de {filteredSuppliers.length}</span>
                        <label>Filas
                          <select value={supplierPageSize} onChange={(event) => { setSupplierPageSize(Number(event.target.value)); setSupplierPage(0) }} aria-label="Filas de proveedores por página">
                            <option value={3}>3</option>
                            <option value={5}>5</option>
                            <option value={10}>10</option>
                          </select>
                        </label>
                        <div>
                          <button className="ws-icon-button" type="button" aria-label="Proveedores anteriores" disabled={safeSupplierPage === 0} onClick={() => setSupplierPage(safeSupplierPage - 1)}><GoogleIcon name="chevron_left" className="small" /></button>
                          <span>{safeSupplierPage + 1} / {supplierPageCount}</span>
                          <button className="ws-icon-button" type="button" aria-label="Proveedores siguientes" disabled={safeSupplierPage + 1 >= supplierPageCount} onClick={() => setSupplierPage(safeSupplierPage + 1)}><GoogleIcon name="chevron_right" className="small" /></button>
                        </div>
                      </div>
                    </>
                  ) : (
                    <small className="relation-hint">
                      <GoogleIcon name="search_off" className="small" />
                      Sin coincidencias: ajusta la búsqueda, o deja sin vincular y escribe el nombre.
                    </small>
                  )}
                  <small className="relation-hint">
                    <GoogleIcon name="link_off" className="small" />
                    Haz clic en un proveedor para agregarlo con su RUC, contacto y dirección, o deja sin vincular y escribe el nombre.
                  </small>
                </>
              )}
            </div>
          ) : page === 'sales' || page === 'quotes' ? (
            <div className="relation-field">
              <label>{page === 'sales' ? 'Cliente de la venta' : 'Cliente de la cotización'}</label>
              <input type="hidden" name="related_id" value={relatedId} />
              {linkedTarget ? (
                <>
                  <div className="supplier-product-row supplier-selected">
                    <span className="supplier-product-copy">
                      <strong>{linkedTarget.name}</strong>
                      <small>{linkedTarget.documento ? `${linkedTarget.tipoDoc ?? 'DOC'} ${linkedTarget.documento} · ` : ''}{linkedTarget.id}</small>
                      <small>{linkedTarget.detail || 'Sin detalle registrado'}</small>
                    </span>
                    <span className="supplier-product-actions">
                      <button className="export-button" type="button" onClick={() => { setRelatedId(''); setCustomerPage(0) }}>Cambiar</button>
                    </span>
                  </div>
                  <small className="relation-hint linked">
                    <GoogleIcon name="link" className="small" />
                    Vinculado a {linkedTarget.name} ({linkedTarget.id}). Datos del cliente agregados a la {page === 'sales' ? 'venta' : 'cotización'}.
                  </small>
                  {page === 'sales' && Number(linkedTarget.amount ?? 0) > 0 && (() => {
                    const credit = customerCredit(linkedTarget, records.sales, records.finance, record?.rowId ?? null)
                    return (
                      <small className={`relation-hint${credit.disponible > 0 ? ' linked' : ''}`}>
                        <GoogleIcon name="payments" className="small" />
                        Línea {money(credit.linea)} · Consumido con tarjeta {money(credit.consumidoTarjeta)} · Disponible {money(credit.disponible)}
                        {credit.disponible <= 0 ? ' · Sin cupo en tarjeta: solo efectivo/Yape.' : ' · Solo Tarjeta descuenta de la línea.'}
                      </small>
                    )
                  })()}
                </>
              ) : !options.length ? (
                <small className="relation-hint">
                  <GoogleIcon name="person_add" className="small" />
                  Aún no hay clientes registrados. Escribe el nombre manualmente o crea primero el registro en su módulo.
                </small>
              ) : (
                <>
                  <span className="relation-control">
                    <GoogleIcon name="search" />
                    <input
                      id="customer_search"
                      value={customerQuery}
                      onChange={(event) => setCustomerQuery(event.target.value)}
                      placeholder="Buscar por razón social, documento o código…"
                      aria-label="Buscar cliente"
                    />
                  </span>
                  {filteredCustomers.length ? (
                    <>
                      <div className="supplier-results" role="listbox" aria-label="Clientes registrados">
                        {pagedCustomers.map((item) => (
                          <button key={item.rowId ?? item.id} type="button" role="option" aria-selected={false} className="supplier-product-row supplier-result" onClick={() => selectCustomer(item.rowId ?? '')}>
                            <span className="supplier-product-copy">
                              <strong>{item.name}</strong>
                              <small>{item.documento ? `${item.tipoDoc ?? 'DOC'} ${item.documento} · ` : ''}{item.id}</small>
                            </span>
                            <GoogleIcon name="chevron_right" className="small" />
                          </button>
                        ))}
                      </div>
                      <div className="lines-pagination">
                        <span>{safeCustomerPage * customerPageSize + 1}–{Math.min(safeCustomerPage * customerPageSize + customerPageSize, filteredCustomers.length)} de {filteredCustomers.length}</span>
                        <label>Filas
                          <select value={customerPageSize} onChange={(event) => { setCustomerPageSize(Number(event.target.value)); setCustomerPage(0) }} aria-label="Filas de clientes por página">
                            <option value={3}>3</option>
                            <option value={5}>5</option>
                            <option value={10}>10</option>
                          </select>
                        </label>
                        <div>
                          <button className="ws-icon-button" type="button" aria-label="Clientes anteriores" disabled={safeCustomerPage === 0} onClick={() => setCustomerPage(safeCustomerPage - 1)}><GoogleIcon name="chevron_left" className="small" /></button>
                          <span>{safeCustomerPage + 1} / {customerPageCount}</span>
                          <button className="ws-icon-button" type="button" aria-label="Clientes siguientes" disabled={safeCustomerPage + 1 >= customerPageCount} onClick={() => setCustomerPage(safeCustomerPage + 1)}><GoogleIcon name="chevron_right" className="small" /></button>
                        </div>
                      </div>
                    </>
                  ) : (
                    <small className="relation-hint">
                      <GoogleIcon name="search_off" className="small" />
                      Sin coincidencias: ajusta la búsqueda, o deja sin vincular y escribe el nombre.
                    </small>
                  )}
                  <small className="relation-hint">
                    <GoogleIcon name="link_off" className="small" />
                    Haz clic en un cliente para agregarlo con sus datos, o deja sin vincular y escribe el nombre.
                  </small>
                </>
              )}
            </div>
          ) : null)}
          <label>{meta.entityLabel}<input data-autofocus name="name" required minLength={2} value={nameValue} onChange={(event) => setNameValue(event.target.value)} placeholder={meta.entityLabel} /></label>
          {page === 'finance' && <label>Tipo de cuenta<select name="financeType" defaultValue={record?.financeType ?? (record?.id.startsWith('CXC') ? 'cobrar' : record?.id.startsWith('CXP') ? 'pagar' : '')} required><option value="">Selecciona el tipo</option><option value="cobrar">Cuenta por cobrar</option><option value="pagar">Cuenta por pagar</option></select></label>}
          {page === 'sales' && (
            <div className="relation-field">
              <label htmlFor="doc_type">Tipo de comprobante</label>
              <span className="relation-control">
                <GoogleIcon name="receipt_long" />
                <select id="doc_type" value={docType} onChange={(event) => handleDocTypeChange(event.target.value as SaleDocType)}>
                  {SALE_DOC_TYPES.map((tipo) => <option key={tipo} value={tipo}>{tipo}</option>)}
                </select>
              </span>
              {docType !== 'Manual' ? (
                <>
                  <label htmlFor="doc_city">Ciudad / sede</label>
                  <span className="relation-control">
                    <GoogleIcon name="location_on" />
                    <select id="doc_city" value={SALE_CITIES.includes(docCity) ? docCity : 'Lima'} onChange={(event) => handleCityChange(event.target.value)}>
                      {SALE_CITIES.map((ciudad) => <option key={ciudad} value={ciudad}>{ciudad}</option>)}
                    </select>
                  </span>
                  <small className="relation-hint linked">
                    <GoogleIcon name="autorenew" className="small" />
                    Correlativo automático: se propone el siguiente número de la serie. Puedes editarlo abajo.
                  </small>
                </>
              ) : (
                <small className="relation-hint">
                  <GoogleIcon name="edit" className="small" />
                  Comprobante manual heredado: se conserva como está.
                </small>
              )}
            </div>
          )}
          {page === 'sales' && (
            <div className="relation-field yape-method-field">
              <label>Medio de pago
                <select name="medio_pago" value={saleMethod} onChange={event => setSaleMethod(event.target.value)}>
                  {saleMethods.map((method) => <option key={method} value={method}>{method}</option>)}
                </select>
              </label>
              {walletForMethod(saleMethod) && <YapePaymentPanel wallet={walletForMethod(saleMethod)!} settings={yapeSettings} total={saleTotal} loading={yapeLoading} totalLoading={linesLoading} error={yapeError} onRetry={() => setYapeReload(value => value + 1)} />}
            </div>
          )}
          {page === 'sales' ? (
            <div className="split-duo">
              <label>{meta.detailLabel}<input name="detail" required value={detailValue} readOnly title="Comprobante automático: cambia el tipo o la ciudad para generarlo" placeholder={meta.detailLabel} /></label>
              <label>Estado
                <select name="status" value={statusValue} onChange={(event) => setStatusValue(event.target.value as RecordStatus)}>
                  {statusOptions.map((status) => <option key={status}>{status}</option>)}
                </select>
              </label>
            </div>
          ) : (
            <label>{meta.detailLabel}<input name="detail" required={page !== 'suppliers'} value={detailValue} onChange={(event) => setDetailValue(event.target.value)} placeholder={page === 'suppliers' ? '(opcional)' : meta.detailLabel} /></label>
          )}

          {hasDocumentLines ? (
            <div className="lines-section">
              <div className="lines-head">
                <span className="lines-title">
                  <GoogleIcon name={page === 'purchases' ? 'factory' : 'shopping_cart'} className="small" />
                  {page === 'sales' ? 'Productos de la venta' : page === 'quotes' ? 'Productos cotizados' : 'Productos del proveedor'}
                </span>
                {(page === 'purchases' || page === 'sales' || page === 'quotes') && (
                  <span className="relation-control lines-search">
                    <GoogleIcon name="search" />
                    <input
                      value={productQuery}
                      onChange={(event) => setProductQuery(event.target.value)}
                      placeholder="Buscar producto…"
                      aria-label={page === 'purchases' ? 'Buscar productos del proveedor' : page === 'sales' ? 'Buscar productos para la venta' : 'Buscar productos para cotizar'}
                    />
                  </span>
                )}
                {page !== 'purchases' && <span className="lines-total">{money(linesTotal)}</span>}
              </div>
              <small className="relation-hint">
                <GoogleIcon name="info" className="small" />
                {page === 'sales'
                  ? 'Vendes de MI inventario: la cantidad nunca supera el stock y el sin stock no se puede marcar. El total calcula el monto y descuenta stock.'
                  : page === 'quotes'
                    ? 'Cotizas de MI inventario con precio fijo. No mueve stock hasta convertir en venta.'
                    : relatedId
                      ? supplierHasRelated
                        ? 'Solo los productos de este proveedor, con su costo fijo. Al completar, lo comprado ingresa a tu inventario.'
                        : 'Este proveedor aún no tiene catálogo: cárgalo desde Proveedores y vuelve aquí.'
                      : 'Selecciona un proveedor arriba para ver sus productos.'}
                </small>
              {page === 'purchases' && (
                <div className="ws-tabs" role="tablist" aria-label="Filtrar productos">
                  <button type="button" role="tab" aria-selected={productFilter === 'all'} onClick={() => setProductFilter('all')}>Todos ({productCounts.total})</button>
                  <button type="button" role="tab" aria-selected={productFilter === 'new'} onClick={() => setProductFilter('new')}>Por ingresar ({productCounts.fresh})</button>
                  <button type="button" role="tab" aria-selected={productFilter === 'linked'} onClick={() => setProductFilter('linked')}>En inventario ({productCounts.linked})</button>
                </div>
              )}
              {lineError && <div className="ws-notice ws-notice-warning" role="alert">{lineError}<button className="ws-text-button" type="button" onClick={() => setLineReload(value => value + 1)}>Reintentar</button></div>}
              {linesLoading ? (
                <p className="relation-hint"><GoogleIcon name="progress_activity" className="small login-spin" /> Cargando líneas guardadas…</p>
              ) : !visibleProducts.length ? (
                page === 'purchases' && relatedId && !supplierHasRelated ? (
                  <p className="relation-hint"><GoogleIcon name="link_off" className="small" /> Este proveedor aún no tiene catálogo. Cárgalo desde Proveedores y vuelve aquí.</p>
                ) : page === 'purchases' && !relatedId ? null : (
                  <p className="relation-hint"><GoogleIcon name="inventory_2" className="small" /> {page === 'purchases' ? 'Aún no hay catálogo cargado.' : 'Aún no hay productos en inventario.'}</p>
                )
              ) : (
                <>
                  {page === 'purchases' && (
                    <div className="line-head" aria-hidden="true">
                      <span>Producto</span><span>Cant.</span><span>P. unit.</span><span>Subtotal</span>
                    </div>
                  )}
                  <div className="lines-list">
                  {displayProducts.map((product) => {
                    const uuid = product.rowId ?? ''
                    if (!uuid) return null
                    const draft = lines[uuid]
                    const checked = Boolean(draft?.selected)
                    const isCatalogLine = page === 'purchases'
                    const stock = availableStock(product)
                    const suggested = lineUnitPrice(product)
                    const hasNoPrice = !(draft?.price ?? suggested)
                    const noStock = page === 'sales' && stock <= 0
                    const qty = draft?.qty ?? 1
                    const unit = draft?.price ?? 0
                    const overStock = page === 'sales' && checked && qty > stock
                    const isNewArrival = isCatalogLine && !product.productoId
                    // Compras y ventas: el filtro de búsqueda solo oculta visualmente;
                    // la fila sigue montada para no perder sus inputs al guardar.
                    const rowHidden = productMatches && uuid ? !productMatches.has(uuid) : false
                    return (
                      <div key={uuid} className={`line-row${checked ? ' checked' : ''}${overStock ? ' over' : ''}`} style={rowHidden ? { display: 'none' } : undefined}>
                        <label className="line-check">
                          <input
                            type="checkbox"
                            name={`sel_${uuid}`}
                            checked={checked}
                            disabled={(noStock && !checked) || (page === 'quotes' && record?.status === 'Completada')}
                            title={noStock && !checked ? 'Sin stock disponible para vender' : `Seleccionar ${product.name}`}
                            onChange={() => toggleLine(uuid)}
                          />
                          <span className="line-copy">
                            <strong>{product.name}</strong>
                            {!isCatalogLine && (
                              <small>
                                {product.id} · {`${stock} und. · P. fijo ${money(suggested)}`}
                                {product.relatedName ? ` · ${product.relatedName}` : ''}
                              </small>
                            )}
                            {noStock && <small className="line-warn"><GoogleIcon name="block" className="small" /> Sin stock: no se puede vender.</small>}
                            {checked && hasNoPrice && <small className="line-warn"><GoogleIcon name="sell" className="small" /> Sin {isCatalogLine ? 'costo' : 'precio'} definido: no se puede guardar. Defínelo {isCatalogLine ? 'en el catálogo del proveedor' : 'en Inventario'}.</small>}
                            {overStock && <small className="line-warn"><GoogleIcon name="warning" className="small" /> Máximo {stock} und. disponibles.</small>}
                          </span>
                        </label>
                        <label className="line-qty">{isCatalogLine ? null : 'Cant.'}
                          <input
                            type="number"
                            name={`qty_${uuid}`}
                            min={1}
                            max={page === 'sales' ? Math.max(1, stock) : undefined}
                            step={1}
                            value={draft?.qty ?? 1}
                            disabled={!checked || (page === 'quotes' && record?.status === 'Completada')}
                            aria-label={isCatalogLine ? `Cantidad de ${product.name}` : undefined}
                            onChange={(event) => {
                              const raw = Math.max(1, Math.floor(Number(event.target.value) || 1))
                              const capped = page === 'sales' ? Math.min(raw, Math.max(1, stock)) : raw
                              changeLine(uuid, { qty: capped })
                            }}
                          />
                        </label>
                        <label className="line-qty">{isCatalogLine ? null : 'P. unitario'}
                          <input
                            type="number"
                            name={`price_${uuid}`}
                            min={0}
                            step={0.01}
                            value={draft?.price ?? suggested ?? 0}
                            disabled={!checked}
                            readOnly
                            aria-label={isCatalogLine ? `Precio de ${product.name}` : undefined}
                            title={page === 'purchases'
                              ? 'Costo fijo del catálogo: se define en Proveedores y no se edita aquí'
                              : 'Precio fijo del producto: se define en Inventario y no se edita aquí'}
                          />
                        </label>
                        <span className="line-subtotal" title={checked ? `${money(unit)} × ${qty} = ${money(qty * unit)}` : 'Marca el producto para sumar'}>
                          {isCatalogLine ? null : <small>{checked ? `${money(unit)} × ${qty}` : '—'}</small>}
                          <strong>{money(checked ? qty * unit : 0)}</strong>
                        </span>
                      </div>
                    )
                  })}
                  {offPageSelected.length > 0 && (
                    <div style={{ display: 'none' }} aria-hidden="true">
                      {offPageSelected.map((product) => {
                        const hiddenId = product.rowId as string
                        const hiddenDraft = lines[hiddenId]
                        return (
                          <Fragment key={hiddenId}>
                            <input type="checkbox" name={`sel_${hiddenId}`} checked readOnly />
                            <input type="number" name={`qty_${hiddenId}`} value={hiddenDraft?.qty ?? 1} readOnly />
                            <input type="number" name={`price_${hiddenId}`} value={hiddenDraft?.price ?? 0} readOnly />
                          </Fragment>
                        )
                      })}
                    </div>
                  )}
                </div>
                </>
              )}
              {(page === 'purchases' || page === 'sales' || page === 'quotes') && matchingProducts.length > 0 && (() => {
                const rangeStart = safeProductPage * productPageSize + 1
                const rangeEnd = Math.min(rangeStart + productPageSize - 1, matchingProducts.length)
                return (
                  <div className="lines-pagination">
                    <span>{rangeStart}–{rangeEnd} de {matchingProducts.length}</span>
                    <label>Filas
                      <select value={productPageSize} onChange={(event) => { setProductPageSize(Number(event.target.value)); setProductPage(0) }} aria-label="Filas por página">
                        <option value={3}>3</option>
                        <option value={5}>5</option>
                        <option value={10}>10</option>
                      </select>
                    </label>
                    <div>
                      <button className="ws-icon-button" type="button" aria-label="Página anterior" disabled={safeProductPage === 0} onClick={() => setProductPage(safeProductPage - 1)}><GoogleIcon name="chevron_left" className="small" /></button>
                      <span>{safeProductPage + 1} / {productPageCount}</span>
                      <button className="ws-icon-button" type="button" aria-label="Página siguiente" disabled={safeProductPage + 1 >= productPageCount} onClick={() => setProductPage(safeProductPage + 1)}><GoogleIcon name="chevron_right" className="small" /></button>
                    </div>
                  </div>
                )
              })()}
              {(page === 'purchases' || page === 'sales' || page === 'quotes') && productMatches && visibleProducts.length > 0 && visibleProducts.every((product) => !product.rowId || !productMatches.has(product.rowId)) && (
                <p className="relation-hint"><GoogleIcon name="search_off" className="small" /> Sin coincidencias en productos: ajusta la búsqueda o el filtro.</p>
              )}
              {page === 'purchases' ? (() => {
                const untaxed = Math.round(linesTotal / 1.18 * 100) / 100
                const igvAmount = Math.round((linesTotal - untaxed) * 100) / 100
                return (
                  <div className="lines-summary purchase-totals">
                    <div><span>Subtotal</span><span>{money(linesTotal)}</span></div>
                    <div><span>Op. gravada</span><span>{money(untaxed)}</span></div>
                    <div><span>IGV (18%)</span><span>{money(igvAmount)}</span></div>
                    <div className="grand"><span>Total a pagar</span><strong>{money(totalWithIgv(linesTotal))}</strong></div>
                  </div>
                )
              })() : (() => {
                const totalUnits = selectedLines.reduce((sum, line) => sum + line.qty, 0)
                const discounted = page === 'sales' ? saleTotal : linesTotal
                return (
                  <div className="lines-summary">
                    <span className="lines-summary-title"><GoogleIcon name="receipt_long" className="small" /> Resumen</span>
                    <span>{selectedLines.length} {selectedLines.length === 1 ? 'producto' : 'productos'} · {totalUnits} und.</span>
                    {page === 'sales' && discountPct > 0 && <span>Desc. {discountPct}%</span>}
                    <strong>Total {money(discounted)}</strong>
                  </div>
                )
              })()}
              {page === 'sales' && can('finance') && (
                <label className="discount-field">Descuento (%) — solo finanzas
                  <input name="descuento" type="number" min={0} max={100} step={0.5} value={discountPct} onChange={(event) => setDiscountPct(Math.min(100, Math.max(0, Number(event.target.value) || 0)))} />
                </label>
              )}
              {!(page === 'purchases' && !selectedLines.length) && (
              <p className="relation-hint">
                <GoogleIcon name="payments" className="small" />
                {selectedLines.length
                  ? page === 'sales'
                    ? 'La cantidad nunca supera el stock. Al guardar descuenta stock y genera cuenta por cobrar si no está completada.'
                    : page === 'quotes'
                      ? 'La cotización no mueve stock. Al convertirla en venta descuenta stock y genera la cobranza.'
                      : 'El inventario se actualiza al llegar a Recepción. La cuenta por pagar incluye IGV y se completa al marcar Pagada.'
                  : 'Sin productos marcados: se guardará solo la cabecera con el monto manual (si lo indicas abajo).'}
              </p>
              )}
              {!selectedLines.length && (
                <label>{meta.amountLabel}<input name="amount" min="0" step="0.01" type="number" value={manualAmount} onChange={event => setManualAmount(event.target.value)} placeholder="0.00" /></label>
              )}
            </div>
          ) : (
            <>
              {page === 'suppliers' && (
                <>
                  <label>RUC de la empresa (11 dígitos)
                    <div className="ws-doc-row">
                      <input name="ruc" inputMode="numeric" maxLength={11} required value={rucValue} onChange={(event) => setRucValue(event.target.value.replace(/\D/g, ''))} placeholder="20123456789" />
                      <button ref={lookupButtonRef} className="ws-button ws-button-secondary" type="button" disabled={lookup.busy} onClick={(event) => void runLookup('supplier', readDocNumber(event.currentTarget, 'supplier'))} title="Autocompletar razón social y dirección desde SUNAT"><GoogleIcon name="search" className="small" />{lookup.busy ? 'Buscando…' : 'SUNAT'}</button>
                    </div>
                  </label>
                  <label>Dirección<input name="direccion" value={direccionValue} onChange={(event) => setDireccionValue(event.target.value)} placeholder="Av. Industrial 123" /></label>
                  <div className="ws-form-grid">
                    <label>Correo<input name="correo" type="email" value={correoValue} onChange={(event) => setCorreoValue(event.target.value)} placeholder="contacto@empresa.pe" /></label>
                    <label>Teléfono<input name="telefono" inputMode="tel" value={telefonoValue} onChange={(event) => setTelefonoValue(event.target.value)} placeholder="987654321" /></label>
                  </div>
                  <label>Condición de pago
                    <select name="forma_pago" value={formaPagoValue} onChange={(event) => setFormaPagoValue(event.target.value)}>
                      <option value="">Sin definir</option>
                      {SUPPLIER_PAYMENT_TERMS.map((term) => <option key={term} value={term}>{term}</option>)}
                    </select>
                  </label>
                  {lookup.message
                    ? <small className={`relation-hint${lookup.ok ? ' linked' : ''}`}><GoogleIcon name={lookup.ok ? 'check_circle' : 'info'} className="small" />{lookup.message}</small>
                    : !isPeruLookupConfigured()
                      ? <small className="relation-hint"><GoogleIcon name="info" className="small" />Autocompletado desactivado: configura VITE_PERU_API_TOKEN en tu .env para consultar SUNAT.</small>
                      : <small className="relation-hint"><GoogleIcon name="badge" className="small" />Escribe el RUC y pulsa SUNAT para traer razón social y dirección. Identifica la empresa en cada orden de compra.</small>}
                  {!editing && (
                  <div className="lines-section">
                    <div className="lines-head">
                      <span className="lines-title"><GoogleIcon name="storefront" className="small" /> Productos que ofrece{drafts.length ? ` (${drafts.length})` : ''}</span>
                    </div>
                    <small className="relation-hint"><GoogleIcon name="info" className="small" />Agrega a mano lo que ofrece este proveedor. Se guardará en su catálogo junto con el registro.</small>
                    {drafts.length > 0 && (
                      <div className="supplier-product-list">
                        {drafts.map((draft, index) => (
                          <div key={`${draft.nombre}-${index}`} className="supplier-product-row">
                            <span className="supplier-product-copy"><strong>{draft.nombre}</strong><small>Costo {money(draft.costo)}{draft.detalle ? ` · ${draft.detalle}` : ''}</small></span>
                            <span className="supplier-product-actions">
                              <button className="export-button danger" type="button" onClick={() => setDrafts((current) => current.filter((_, i) => i !== index))}>Quitar</button>
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="supplier-link-bar">
                      <input aria-label="Nombre del producto ofrecido" value={draftName} onChange={(event) => setDraftName(event.target.value)} placeholder="Nombre del producto" />
                      <input aria-label="Costo del producto ofrecido" type="number" min={0} step={0.01} value={draftCosto} onChange={(event) => setDraftCosto(event.target.value)} placeholder="Costo S/" />
                      <input aria-label="Detalle del producto ofrecido" value={draftDetail} onChange={(event) => setDraftDetail(event.target.value)} placeholder="Detalle (opcional)" />
                      <button className="primary-button" type="button" onClick={addDraftProduct}>Agregar</button>
                    </div>
                    <input type="hidden" name="catalogo_json" value={JSON.stringify(drafts)} />
                  </div>
                  )}
                </>
              )}
              {page === 'customers' && (
                <>
                  <label>Tipo de documento
                    <select name="tipo_doc" value={docKind} onChange={(event) => setDocKind(event.target.value as DocType)}>
                      <option value="DNI">DNI · persona natural (RENIEC)</option>
                      <option value="RUC">RUC · empresa (SUNAT)</option>
                    </select>
                  </label>
                  <label>{docKind} del cliente (opcional)
                    <div className="ws-doc-row">
                        <input name="documento" inputMode="numeric" maxLength={docKind === 'DNI' ? 8 : 11} value={docNumber} onChange={(event) => setDocNumber(event.target.value.replace(/\D/g, ''))} placeholder={docKind === 'DNI' ? '12345678' : '20123456789'} />
                        <button ref={lookupButtonRef} className="ws-button ws-button-secondary" type="button" disabled={lookup.busy} onClick={(event) => void runLookup('customer', readDocNumber(event.currentTarget, 'customer'))} title={`Autocompletar nombre y detalle desde ${docKind === 'DNI' ? 'RENIEC' : 'SUNAT'}`}><GoogleIcon name="search" className="small" />{lookup.busy ? 'Buscando…' : docKind}</button>
                    </div>
                  </label>
                  {lookup.message
                    ? <small className={`relation-hint${lookup.ok ? ' linked' : ''}`}><GoogleIcon name={lookup.ok ? 'check_circle' : 'info'} className="small" />{lookup.message}</small>
                    : !isPeruLookupConfigured()
                      ? <small className="relation-hint"><GoogleIcon name="info" className="small" />Autocompletado desactivado: configura VITE_PERU_API_TOKEN en tu .env para consultar RENIEC/SUNAT.</small>
                      : <small className="relation-hint"><GoogleIcon name="badge" className="small" />Escribe el documento y pulsa {docKind} para traer los datos oficiales. Se guardan con el cliente para reutilizarlos en ventas.</small>}
                </>
              )}
              {meta.kind === 'money' && <label>{meta.amountLabel}<input name="amount" min="0" step="0.01" type="number" defaultValue={record?.amount} placeholder="0.00" /></label>}
              {meta.kind === 'stock' && (
                <>
                  <label>Unidades iniciales<input name="quantity" min="0" step="1" type="number" defaultValue={record?.quantity} placeholder="0" /></label>
                  {page === 'inventory' && (
                    <>
                      <label>Precio de venta con IGV (S/)<input name="precio" min="0" step="0.01" type="number" required defaultValue={record?.precio ?? ''} placeholder="0.00" /></label>
                      <small className="relation-hint">
                        <GoogleIcon name="payments" className="small" />
                        {record?.precio !== undefined
                          ? `Precio actual: ${money(record.precio)}. Se usará fijo en ventas y cotizaciones (no editable por línea).`
                          : 'Define el precio de venta del producto. Se utilizará en ventas y cotizaciones.'}
                      </small>
                    </>
                  )}
                </>
              )}
            </>
          )}
          {page === 'purchases' && (
            <>
              <label>Fecha límite o aproximada<input type="date" name="fecha_limite" defaultValue={record?.fechaLimite ?? ''} /></label>
              <small className="relation-hint">
                <GoogleIcon name="event" className="small" />
                La defines tú al crear la solicitud: fecha máxima o aproximada para concretar la compra.
              </small>
            </>
          )}
          {page === 'purchases' && !editing ? (
            <input type="hidden" name="status" value="Pendiente" />
          ) : page === 'sales' ? null : page === 'inventory' ? (
            <small className="relation-hint">
              <GoogleIcon name="monitoring" className="small" />
              El estado se calcula solo por el stock: 0 = Crítico, 1–{LOW_STOCK_THRESHOLD} = Bajo stock, más = Estable.
            </small>
          ) : (
            <label>Estado
              <select name="status" value={statusValue} onChange={(event) => setStatusValue(event.target.value as RecordStatus)}>
                {statusOptions.map((status) => <option key={status}>{status}</option>)}
              </select>
            </label>
          )}
        </div>
        <div className="modal-actions"><button className="cancel-button" type="button" disabled={saving} onClick={onClose}>Cancelar</button><button className="primary-button" type="submit" disabled={saving || linesLoading || Boolean(lineError)}>{saving ? <GoogleIcon name="progress_activity" className="login-spin" /> : <GoogleIcon name="check" />} {saving ? 'Guardando en Supabase…' : editing ? 'Guardar cambios' : 'Guardar registro'}</button></div>
      </form>
    </div>
  )
}
