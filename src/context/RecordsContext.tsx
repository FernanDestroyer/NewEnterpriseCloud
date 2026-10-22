import { createContext, useCallback, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { pageMeta } from '../data/catalog'
import { brandLogoUrl, defaultStatus, escapeCell, isStockAlert, money, stockStatus } from '../data/helpers'
import { customerCredit, consumesCreditLine } from '../data/workspace'
import { readCompanyProfile } from '../services/company'
import { convertQuoteToSale, completeLinkedDocument, deleteRecord, emptyRecords, enrichCatalog, fetchRecordsSnapshot, fetchDocumentLines, fetchSupplierCatalogRaw, friendlyError, insertCatalogItem, insertPurchaseWithLines, insertQuoteWithLines, insertRecord, insertSaleWithLines, isMissingTableError, updatePurchaseWithLines, updateQuoteWithLines, updateRecord, updateSaleWithLines, updateStatuses, type LineInput } from '../services/records'
import { getOpenCashShift } from '../services/caja'
import { DATA_PAGES } from '../data/catalog'
import { csvContent } from '../data/exports'
import { purchaseHasStock } from '../data/helpers'
import { useAuth } from './AuthContext'
import type { DataPage, ExportFormat, PendingDelete, RecordItem, RecordModalState, RecordStatus } from '../types'

type RecordsContextValue = {
  records: Record<DataPage, RecordItem[]>
  /** Catálogo de productos por proveedor (independiente de mi inventario). */
  catalog: RecordItem[]
  loading: boolean
  saving: boolean
  refreshing: boolean
  lastSyncedAt: Date | null
  errors: Partial<Record<DataPage, string>>
  catalogError: string
  reload: () => Promise<void>
  toast: string
  notify: (message: string) => void
  recordModal: RecordModalState | null
  openComposer: (page: DataPage) => void
  openEditor: (page: DataPage, record: RecordItem) => void
  closeRecordModal: () => void
  saveRecord: (page: DataPage, record: RecordItem | null, event: FormEvent<HTMLFormElement>) => Promise<void>
  convertQuote: (code: string) => Promise<void>
  pendingDelete: PendingDelete | null
  requestDelete: (page: DataPage, record: RecordItem) => void
  cancelDelete: () => void
  confirmDelete: () => Promise<void>
  exportTable: (page: DataPage, format: ExportFormat, items?: RecordItem[]) => void
  settleAccount: (record: RecordItem, medio?: string) => Promise<void>
  /** Marca una orden pendiente como recibida: ingresa lo comprado al inventario (+ kardex). */
  receivePurchase: (record: RecordItem) => Promise<void>
  /** Registra el ingreso de una orden recibida: aplica lo comprado al inventario (+ kardex). */
  registerPurchaseIngress: (record: RecordItem) => Promise<void>
}

const RecordsContext = createContext<RecordsContextValue | null>(null)

export function RecordsProvider({ children }: { children: ReactNode }) {
  const { session, profile, can } = useAuth()
  const userId = session?.user.id
  const allowedPages = DATA_PAGES.filter(page => can(page)).join(',')
  const [records, setRecords] = useState<Record<DataPage, RecordItem[]>>(emptyRecords)
  const [catalog, setCatalog] = useState<RecordItem[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null)
  const [errors, setErrors] = useState<Partial<Record<DataPage, string>>>({})
  const [catalogError, setCatalogError] = useState('')
  const loadSequence = useRef(0)
  const [recordModal, setRecordModal] = useState<RecordModalState | null>(null)
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null)
  const [toast, setToast] = useState('')
  const toastTimer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(toastTimer.current), [])

  const notify = useCallback((message: string) => {
    window.clearTimeout(toastTimer.current)
    setToast(message)
    toastTimer.current = window.setTimeout(() => setToast(''), 3200)
  }, [])

  // Carga todos los módulos + catálogo de proveedores cada vez que entra una persona.
  const loadAll = useCallback(async () => {
    const pages = allowedPages.split(',').filter(Boolean) as DataPage[]
    let catalogError = ''
    const [snapshot, raw] = await Promise.all([
      fetchRecordsSnapshot(pages),
      pages.includes('purchases') ? fetchSupplierCatalogRaw().catch(error => { catalogError = friendlyError(error); return [] }) : Promise.resolve([]),
    ])
    return { base: snapshot.records, errors: snapshot.errors, catalogError, catalog: enrichCatalog(raw, snapshot.records.inventory) }
  }, [allowedPages])

  const reload = useCallback(async () => {
    if (!userId || !profile) return
    const sequence = ++loadSequence.current
    setRefreshing(true)
    try {
      const { base, catalog: next, errors, catalogError } = await loadAll()
      if (sequence !== loadSequence.current) return
      setRecords(base)
      setCatalog(next)
      setErrors(errors)
      setCatalogError(catalogError)
      setLastSyncedAt(new Date())
    } catch (error) {
      notify(friendlyError(error))
    } finally { if (sequence === loadSequence.current) setRefreshing(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, profile, loadAll, notify])

  useEffect(() => {
    if (!userId || !profile) {
      loadSequence.current++
      setRecords(emptyRecords())
      setCatalog([])
      setLoading(false)
      setErrors({})
      setCatalogError('')
      setLastSyncedAt(null)
      setRecordModal(null)
      setPendingDelete(null)
      setRefreshing(false)
      return
    }
    let active = true
    const sequence = ++loadSequence.current
    setRecords(emptyRecords())
    setCatalog([])
    setLoading(true)
    loadAll()
      .then(({ base, catalog: next, errors, catalogError }) => {
        if (!active || sequence !== loadSequence.current) return
        setRecords(base)
        setCatalog(next)
        setErrors(errors)
        setCatalogError(catalogError)
        setLastSyncedAt(new Date())
      })
      .catch((error) => active && notify(friendlyError(error)))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, profile?.id, loadAll])

  // Si otra persona cambió datos mientras la pestaña estaba en segundo plano, se actualiza al volver.
  useEffect(() => {
    if (!userId) return
    const refresh = () => {
      if (document.visibilityState === 'visible') void reload()
    }
    document.addEventListener('visibilitychange', refresh)
    return () => document.removeEventListener('visibilitychange', refresh)
  }, [userId, reload])

  const openComposer = (page: DataPage) => {
    if (!can(page, 'crear')) return notify('Tu rol no tiene permiso para crear en este módulo.')
    setRecordModal({ page, record: null })
  }
  const openEditor = (page: DataPage, record: RecordItem) => {
    if (!can(page, 'editar')) return notify('Tu rol no tiene permiso para editar en este módulo.')
    setRecordModal({ page, record })
  }
  const closeRecordModal = () => { if (!saving) setRecordModal(null) }

  // Ventas y compras nuevas exigen turno de caja abierto (las ediciones no).
  // Si la tabla de caja aún no existe (migración pendiente), no se bloquea.
  const requireOpenShift = async (): Promise<boolean> => {
    try {
      if (await getOpenCashShift()) return true
    } catch (error) {
      if (isMissingTableError(error)) return true
      notify(friendlyError(error))
      return false
    }
    notify('Abre un turno en Caja antes de registrar ventas o compras.')
    return false
  }

  const saveRecord = async (page: DataPage, record: RecordItem | null, event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (saving) return
    if (!can(page, record ? 'editar' : 'crear')) return notify('Tu rol no tiene permiso para guardar este registro.')
    const form = new FormData(event.currentTarget)
    if (!record && (page === 'sales' || page === 'purchases') && !(await requireOpenShift())) return
    const meta = pageMeta[page]
    const amountInput = String(form.get('amount') ?? '')
    const quantityInput = String(form.get('quantity') ?? '')
    const amount = Number(amountInput)
    const quantity = Number(quantityInput)
    const rawRelated = String(form.get('related_id') ?? '')
    // '' = sin vínculo (opcional). UUID = vínculo a cliente/proveedor registrado.
    // undefined = el módulo no tiene relación (no se envía la columna).
    const relatedId: string | null | undefined =
      page === 'sales' || page === 'purchases' || page === 'quotes'
        ? (rawRelated ? rawRelated : null)
        : undefined
    let name = String(form.get('name') ?? '').trim()
    const detail = String(form.get('detail') ?? '').trim()
    let selectedStatus = String(form.get('status') ?? defaultStatus(page)) as RecordStatus
    // Descuento % en ventas: solo roles con acceso a finanzas (no vendedores).
    const discountRaw = page === 'sales' ? Number(String(form.get('descuento') ?? '')) : 0
    const discount = page === 'sales' && Number.isFinite(discountRaw) && discountRaw > 0 ? Math.min(100, discountRaw) : 0
    if (discount > 0 && !can('finance')) {
      notify('Solo un rol con acceso a finanzas puede aplicar descuentos.')
      return
    }
    const savedAmount = meta.kind === 'money' && amountInput !== '' && Number.isFinite(amount) && amount >= 0 ? amount : record?.amount
    const savedQuantity = meta.kind === 'stock' && quantityInput !== '' && Number.isFinite(quantity) && quantity >= 0 ? Math.floor(quantity) : record?.quantity
    // En productos el estado es automático según el stock (ignora el selector).
    if (page === 'inventory') selectedStatus = stockStatus(savedQuantity ?? record?.quantity ?? 0)
    // Precio del producto (inventario). Si viene vacío se conserva el anterior; si no hay anterior, queda undefined (no toca la columna).
    const precioInput = String(form.get('precio') ?? '')
    const precioNumber = Number(precioInput)
    const savedPrecio = page === 'inventory' && precioInput !== '' && Number.isFinite(precioNumber) && precioNumber >= 0
      ? Math.round(precioNumber * 100) / 100
      : record?.precio
    // Fecha límite de la compra: la define el comprador al crear la solicitud.
    // Vacío = sin fecha (en edición conserva la anterior).
    const fechaInput = String(form.get('fecha_limite') ?? '')
    let savedFechaLimite = record?.fechaLimite
    if (page === 'purchases' && fechaInput !== '') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaInput)) {
        notify('La fecha límite no es válida.')
        return
      }
      savedFechaLimite = fechaInput
    }
    // RUC del proveedor: 11 dígitos obligatorios (identifica la empresa en cada orden).
    const rucDigits = String(form.get('ruc') ?? '').replace(/\D/g, '')
    if (page === 'suppliers' && !/^\d{11}$/.test(rucDigits)) {
      notify('El RUC del proveedor debe tener 11 dígitos.')
      return
    }
    // Contacto del proveedor (opcional, pero validado si se indica).
    const direccionInput = String(form.get('direccion') ?? '').trim()
    const correoInput = String(form.get('correo') ?? '').trim()
    const telefonoInput = String(form.get('telefono') ?? '').replace(/[^\d+\s-]/g, '').trim()
    const formaPagoInput = String(form.get('forma_pago') ?? '').trim()
    if (page === 'suppliers') {
      if (correoInput && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correoInput)) {
        notify('El correo del proveedor no es válido.')
        return
      }
      if (telefonoInput && telefonoInput.replace(/\D/g, '').length < 6) {
        notify('El teléfono del proveedor debe tener al menos 6 dígitos.')
        return
      }
    }
    // Productos agregados a mano en el formulario del proveedor.
    let catalogDrafts: Array<{ nombre: string; costo: number; detalle: string }> = []
    if (page === 'suppliers') {
      try {
        const raw = JSON.parse(String(form.get('catalogo_json') ?? '[]'))
        if (Array.isArray(raw)) {
          catalogDrafts = raw
            .filter((item) => item && typeof item.nombre === 'string' && item.nombre.trim().length >= 2
              && Number.isFinite(Number(item.costo)) && Number(item.costo) >= 0)
            .map((item) => ({ nombre: item.nombre.trim(), costo: Math.round(Number(item.costo) * 100) / 100, detalle: String(item.detalle ?? '').trim() }))
        }
      } catch {
        catalogDrafts = []
      }
    }
    // Documento del cliente (DNI vía RENIEC o RUC vía SUNAT). Opcional, pero si
    // se indica debe tener el formato correcto para poder reutilizarlo.
    let savedTipoDoc: 'DNI' | 'RUC' | null = record?.tipoDoc ?? null
    let savedDocumento: string | null = record?.documento ?? null
    if (page === 'customers') {
      const rawTipoDoc = String(form.get('tipo_doc') ?? '')
      const rawDocumento = String(form.get('documento') ?? '').replace(/\D/g, '')
      if (!rawDocumento) {
        savedTipoDoc = null
        savedDocumento = null
      } else if (rawTipoDoc === 'DNI' && /^\d{8}$/.test(rawDocumento)) {
        savedTipoDoc = 'DNI'
        savedDocumento = rawDocumento
      } else if (rawTipoDoc === 'RUC' && /^\d{11}$/.test(rawDocumento)) {
        savedTipoDoc = 'RUC'
        savedDocumento = rawDocumento
      } else {
        notify('El documento del cliente no es válido: DNI de 8 dígitos o RUC de 11 dígitos.')
        return
      }
    }
    // Si se eligió un cliente/proveedor registrado, el nombre se hereda de ese
    // registro para que cliente_nombre/proveedor_nombre y la FK queden coherentes.
    // El trigger vincular_cliente/vincular_proveedor queda como respaldo.
    if (relatedId) {
      if (page === 'sales' || page === 'quotes') {
        const target = records.customers.find((item) => item.rowId === relatedId)
        if (target) name = target.name
      } else if (page === 'purchases') {
        const target = records.suppliers.find((item) => item.rowId === relatedId)
        if (target) name = target.name
      }
    }
    // Líneas: ventas/cotizaciones eligen de MI inventario; compras del CATÁLOGO
    // del proveedor (independiente). Inputs qty_<uuid> + price_<uuid> con sel_<uuid>.
    const lines: LineInput[] = []
    const parseLines = (source: RecordItem[], priceHint: string) => {
      for (const product of source) {
        const uuid = product.rowId
        if (!uuid) continue
        if (!form.get(`sel_${uuid}`)) continue
        const qty = Math.floor(Number(String(form.get(`qty_${uuid}`) ?? '')))
        const price = Number(String(form.get(`price_${uuid}`) ?? ''))
        if (!Number.isFinite(qty) || qty <= 0) throw new Error(`Cantidad inválida para ${product.name}.`)
        if (!Number.isFinite(price) || price <= 0) throw new Error(`"${product.name}" no tiene precio definido. ${priceHint}`)
        lines.push({ producto_id: uuid, cantidad: qty, precio: price })
      }
    }
    try {
      if (page === 'sales' || page === 'quotes') {
        parseLines(records.inventory, 'Defínelo en Inventario antes de guardar.')
      } else if (page === 'purchases') {
        parseLines(catalog, 'Defínelo en el catálogo del proveedor antes de guardar.')
      }
    } catch (error) {
      notify(friendlyError(error))
      return
    }
    if (page === 'sales' || page === 'purchases') {
      const paymentAction = record ? 'editar' : 'crear'
      if (!can('finance', paymentAction)) return notify(`Tu rol necesita permiso de ${paymentAction} finanzas para guardar esta operación y su cuenta vinculada.`)
      if (lines.length && (page === 'sales' || purchaseHasStock(selectedStatus)) && !can('inventory', 'editar')) return notify('Tu rol necesita permiso de editar inventario para guardar una operación con movimiento de stock.')
      if (page === 'purchases' && purchaseHasStock(selectedStatus) && lines.some(line => !catalog.find(item => item.rowId === line.producto_id)?.productoId) && !can('inventory', 'crear')) return notify('Tu rol necesita permiso de crear productos para recibir artículos nuevos en inventario.')
    }
    const input = {
      name,
      detail,
      status: selectedStatus,
      ...(page === 'finance' ? { financeType: (String(form.get('financeType') ?? '') || null) as 'cobrar' | 'pagar' | null } : {}),
      ...(meta.kind === 'money' && savedAmount !== undefined ? { amount: savedAmount } : {}),
      ...(meta.kind === 'stock' && savedQuantity !== undefined ? { quantity: savedQuantity } : {}),
      ...(page === 'inventory' && savedPrecio !== undefined ? { precio: savedPrecio } : {}),
      ...(page === 'purchases' && savedFechaLimite !== undefined ? { fecha_limite: savedFechaLimite } : {}),
      ...(page === 'sales' ? { descuento: discount } : {}),
      ...(page === 'sales' ? { medio_pago: String(form.get('medio_pago') ?? '').trim() || null } : {}),
      ...(page === 'sales' && String(form.get('tarjeta_id') ?? '').trim() ? {
        tarjeta_id: String(form.get('tarjeta_id')).trim(),
        tarjeta_marca: String(form.get('tarjeta_marca') ?? '').trim() || null,
        tarjeta_ultimos4: String(form.get('tarjeta_ultimos4') ?? '').trim() || null,
      } : {}),
      ...(page === 'suppliers' ? {
        ruc: rucDigits,
        direccion: direccionInput || null,
        correo: correoInput || null,
        telefono: telefonoInput || null,
        forma_pago: formaPagoInput || null,
      } : {}),
      ...(page === 'customers' ? { tipo_doc: savedTipoDoc, documento: savedDocumento } : {}),
      ...((page === 'sales' || page === 'quotes') && relatedId !== undefined ? { cliente_id: relatedId } : {}),
      ...(page === 'purchases' && relatedId !== undefined ? { proveedor_id: relatedId } : {}),
    }
    // Si hay líneas, el total manda sobre el monto manual.
    if (lines.length) {
      const total = lines.reduce((sum, line) => sum + line.cantidad * line.precio, 0)
      ;(input as { amount?: number }).amount = total
    }

    setSaving(true)
    try {
      let saved: RecordItem
      if (page === 'sales') {
        // En ventas siempre se usa la ruta con líneas para recalcular stock/cobranza.
        // Si se edita sin marcar líneas, se conservan las anteriores.
        let effective: LineInput[] = lines
        if (!effective.length && record?.rowId) {
          const previous = await fetchDocumentLines('sales', record.rowId)
          effective = previous.map((line) => ({ producto_id: line.producto_id, cantidad: line.cantidad, precio: line.precio }))
        }
        // Tope de tarjeta: si paga con Tarjeta, la compra consume la línea de
        // crédito del cliente. Efectivo/Yape no descuentan (solo se registran).
        // Línea en cero o sin vincular = sin tope. Aplica en cualquier estado.
        const saleMedio = ((input as { medio_pago?: string | null }).medio_pago ?? record?.medio ?? null) as string | null
        if (consumesCreditLine(saleMedio)) {
          const customerId = relatedId ?? record?.cliente_id ?? null
          const customer = customerId ? records.customers.find((item) => item.rowId === customerId) : undefined
          const linea = Number(customer?.amount ?? 0) || 0
          if (customer && linea > 0) {
            const subtotal = effective.reduce((sum, line) => sum + line.cantidad * line.precio, 0)
            const newTotal = effective.length
              ? Math.round(subtotal * (1 - discount / 100) * 100) / 100
              : (savedAmount ?? record?.amount ?? 0)
            const credit = customerCredit(customer, records.sales, records.finance, record?.rowId ?? null)
            if (newTotal > credit.disponible) {
              notify(`Sin crédito suficiente para ${customer.name}: paga con Tarjeta y su disponible es ${money(credit.disponible)} (línea ${money(linea)} − consumido ${money(credit.consumidoTarjeta)}). Esta compra es ${money(newTotal)}. Cobra en efectivo/Yape o amplía su línea.`)
              return
            }
          }
        }
        // Pago con tarjeta: exige un cliente vinculado y una de las tarjetas agregadas a su cuenta
        // (las ventas antiguas con Tarjeta sin tarjeta registrada se pueden seguir editando).
        const chosenMedio = (input as { medio_pago?: string | null }).medio_pago ?? null
        const chosenCard = (input as { tarjeta_id?: string | null }).tarjeta_id ?? null
        const legacyCardSale = Boolean(record && consumesCreditLine(record.medio) && !record.tarjetaId)
        if (consumesCreditLine(chosenMedio) && !chosenCard && !legacyCardSale) {
          notify(!(relatedId ?? record?.cliente_id) ? 'Vincula un cliente a la venta para pagar con tarjeta: la tarjeta se agrega a su cuenta.' : 'Agrega o elige una tarjeta de la cuenta del cliente para pagar con tarjeta.')
          return
        }
        saved = record
          ? await updateSaleWithLines(record.id, input, effective)
          : await insertSaleWithLines(input, effective)
      } else if (page === 'quotes') {
        if (!lines.length && record?.rowId) {
          const previous = await fetchDocumentLines('quotes', record.rowId)
          const previousInput: LineInput[] = previous.map((line) => ({ producto_id: line.producto_id, cantidad: line.cantidad, precio: line.precio }))
          saved = record
            ? await updateQuoteWithLines(record.id, input, previousInput)
            : await insertQuoteWithLines(input, [])
        } else {
          saved = record
            ? await updateQuoteWithLines(record.id, input, lines)
            : await insertQuoteWithLines(input, lines)
        }
      } else if (page === 'purchases') {
        if (!lines.length && record?.rowId) {
          const previous = await fetchDocumentLines('purchases', record.rowId)
          const previousInput: LineInput[] = previous.map((line) => ({ producto_id: line.producto_id, cantidad: line.cantidad, precio: line.precio }))
          saved = record
            ? await updatePurchaseWithLines(record.id, input, previousInput)
            : await insertPurchaseWithLines(input, [])
        } else {
          saved = record
            ? await updatePurchaseWithLines(record.id, input, lines)
            : await insertPurchaseWithLines(input, lines)
        }
      } else {
        saved = record ? await updateRecord(page, record.id, input) : await insertRecord(page, input)
      }
      // Productos agregados a mano en el formulario del proveedor: se guardan
      // en su catálogo una vez que el proveedor ya existe en la base de datos.
      let draftNote = ''
      if (page === 'suppliers' && catalogDrafts.length && saved.rowId) {
        let draftOk = 0
        for (const draft of catalogDrafts) {
          try {
            await insertCatalogItem(saved.rowId, draft)
            draftOk++
          } catch {
            // Se reporta abajo cuántos no pudieron guardarse.
          }
        }
        if (draftOk < catalogDrafts.length) {
          draftNote = ` Solo ${draftOk} de ${catalogDrafts.length} productos del catálogo pudieron guardarse.`
        }
      }
      // Ventas/compras/cotizaciones mueven inventario o generan CxC/CxP: recarga todo para verlo.
      setRecords(current => ({ ...current, [page]: record ? current[page].map(item => item.id === record.id ? saved : item) : [saved, ...current[page]] }))
      await reload()
      setRecordModal(null)
      const linesNote = lines.length ? ` (${lines.length} ${lines.length === 1 ? 'producto' : 'productos'})` : ''
      const catalogNote = page === 'suppliers' && catalogDrafts.length ? ` (${catalogDrafts.length} ${catalogDrafts.length === 1 ? 'producto al catálogo' : 'productos al catálogo'})` : ''
      // Si la BD aún no tiene las columnas nuevas, el guardado las descarta en
      // silencio (push-safety): se avisa para que se ejecuten las migraciones.
      let migrationNote = ''
      if (page === 'inventory') {
        const wantedPrecio = (input as { precio?: number }).precio !== undefined
        if (wantedPrecio && saved.precio === undefined) {
          migrationNote = ' Sin precio: falta ejecutar la migración 20261011000000_producto_precio.sql en Supabase.'
        }
      } else if (page === 'suppliers' && saved.ruc === undefined) {
        migrationNote = ' Sin RUC: falta ejecutar la migración 20261015000000_proveedor_ruc.sql en Supabase.'
      } else if (page === 'customers' && (input as { documento?: string | null }).documento && saved.documento === undefined) {
        migrationNote = ' Sin documento: falta ejecutar la migración 20261017000000_cliente_documento.sql en Supabase.'
      } else if (page === 'suppliers' && (input as { direccion?: string | null }).direccion && saved.direccion === undefined) {
        migrationNote = ' Sin contacto: falta ejecutar la migración 20261018000000_proveedor_contacto.sql en Supabase.'
      }
      notify(record ? `${meta.title}: registro actualizado${linesNote}${catalogNote}.${migrationNote}${draftNote}` : `${meta.title}: registro guardado en la base de datos${linesNote}${catalogNote}.${migrationNote}${draftNote}`)
    } catch (error) {
      notify(friendlyError(error))
    } finally {
      setSaving(false)
    }
  }

  const requestDelete = (page: DataPage, record: RecordItem) => setPendingDelete({ page, record })
  const cancelDelete = () => setPendingDelete(null)

  const confirmDelete = async () => {
    if (!pendingDelete) return
    const { page, record } = pendingDelete
    try {
      await deleteRecord(page, record.id)
      await reload()
      notify(`${pageMeta[page].title}: registro eliminado.`)
    } catch (error) {
      notify(friendlyError(error))
    } finally {
      setPendingDelete(null)
    }
  }

  const convertQuote = async (code: string) => {
    if (saving) return
    if (!can('sales', 'crear') || !can('quotes', 'editar') || !can('inventory', 'editar') || !can('finance', 'crear')) return notify('Convertir una cotización requiere crear ventas y cuentas financieras, editar cotizaciones y mover inventario.')
    if (!(await requireOpenShift())) return
    // La conversión genera una venta sin medio de pago (no consume tarjeta).
    setSaving(true)
    try {
      const { sale } = await convertQuoteToSale(code)
      await reload()
      notify(`Cotización ${code} convertida en venta ${sale.id}. Stock y cobranza actualizados.`)
    } catch (error) {
      notify(friendlyError(error))
    } finally {
      setSaving(false)
    }
  }

  const downloadBlob = (file: Blob, filename: string) => {
    const href = URL.createObjectURL(file)
    const link = document.createElement('a')
    link.href = href
    link.download = filename
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(href), 0)
  }

  const exportTable = async (page: DataPage, format: ExportFormat, items = records[page]) => {
    const title = pageMeta[page].title
    const baseName = `${title.toLocaleLowerCase()}-enterprisecloud`
    const header = page === 'suppliers'
      ? ['Referencia', 'Nombre', 'Fecha', 'RUC', 'Estado']
      : ['Referencia', 'Nombre', 'Detalle', 'Fecha', page === 'inventory' ? 'Existencias' : page === 'customers' ? 'Disponible' : 'Importe', 'Estado', ...(page === 'inventory' ? ['Precio de venta'] : []), ...(page === 'customers' ? ['Línea de crédito'] : [])]
    const rows = items.map((item) => page === 'suppliers'
      ? [
        item.id,
        item.name,
        item.createdAt ? new Date(item.createdAt).toLocaleDateString('es-PE', { timeZone: 'America/Lima' }) : item.date,
        (item.ruc ?? ''),
        item.status,
      ]
      : [
      item.id,
      item.name,
      item.detail,
      item.createdAt ? new Date(item.createdAt).toLocaleDateString('es-PE', { timeZone: 'America/Lima' }) : item.date,
      page === 'inventory' ? `${item.quantity ?? 0} unidades` : page === 'customers' ? String(customerCredit(item, records.sales, records.finance).disponible) : item.amount !== undefined ? String(item.amount) : '',
      page === 'inventory' ? stockStatus(item.quantity ?? 0) : item.status,
      ...(page === 'inventory' ? [item.precio !== undefined ? String(item.precio) : ''] : []),
      ...(page === 'customers' ? [item.amount !== undefined ? String(item.amount) : ''] : []),
    ])

    if (format === 'csv') {
      downloadBlob(new Blob([csvContent(header, rows)], { type: 'text/csv;charset=utf-8' }), `${baseName}.csv`)
      notify(`Exportación de ${title.toLocaleLowerCase()} en CSV preparada.`)
      return
    }

    if (format === 'excel') {
      const table = `<table><thead><tr>${header.map((cell) => `<th>${escapeCell(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeCell(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
      const workbook = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="UTF-8" /></head><body>${table}</body></html>`
      downloadBlob(new Blob([`\ufeff${workbook}`], { type: 'application/vnd.ms-excel' }), `${baseName}.xls`)
      notify(`Exportación de ${title.toLocaleLowerCase()} en Excel preparada.`)
      return
    }

    const printWindow = window.open('', '_blank')
    if (!printWindow) {
      notify('El navegador bloqueó la ventana de impresión.')
      return
    }
    // Reporte ejecutivo: marca, banda corporativa y tabla formal con cebra.
    // La ventana se abre en el clic (sin bloqueo) y el logo va incrustado.
    const logoUrl = await brandLogoUrl()
    const company = readCompanyProfile(records.settings)
    const brandName = company?.razonSocial || 'EnterpriseCloud'
    const brandSub = company?.ruc ? `RUC ${company.ruc}${company.direccion ? ` · ${company.direccion}` : ''}` : ''
    const issuedAt = new Date().toLocaleString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    printWindow.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8" /><title>${escapeCell(title)} · EnterpriseCloud</title>`
      + `<style>body{font-family:Arial,Helvetica,sans-serif;color:#1a2638;margin:0;padding:28px}.head{display:flex;align-items:center;gap:14px;border-bottom:3px solid #0b6b70;padding-bottom:14px;margin-bottom:12px}.logo{height:80px;width:auto}.brand h1{font-size:22px;margin:0;color:#0b6b70;letter-spacing:-.02em}.brand p{margin:3px 0 0;font-size:11px;color:#5e6f84}.meta{display:flex;justify-content:space-between;gap:10px;margin:0 0 14px;font-size:11px;color:#5e6f84}.meta strong{color:#1a2638}table{width:100%;border-collapse:collapse;font-size:11px}th{background:#0b6b70;color:#fff;padding:9px 8px;text-align:left;font-size:10px;letter-spacing:.04em;text-transform:uppercase}td{padding:8px;border-bottom:1px solid #dfe7ef}tbody tr:nth-child(even){background:#f1f7f7}.foot{margin-top:16px;padding-top:10px;border-top:2px solid #0b6b70;display:flex;justify-content:space-between;gap:10px;font-size:10px;color:#5e6f84}</style></head><body>`
      + `<div class="head"><img class="logo" src="${logoUrl}" alt="EnterpriseCloud" /><div class="brand"><h1>${escapeCell(brandName)}</h1><p>${escapeCell(title)} · Reporte ejecutivo</p>${brandSub ? `<p>${escapeCell(brandSub)}</p>` : ''}</div></div>`
      + `<div class="meta"><span><strong>${rows.length}</strong> ${rows.length === 1 ? 'registro' : 'registros'} · Generado desde el panel</span><span>${escapeCell(issuedAt)}</span></div>`
      + `<table><thead><tr>${header.map((cell) => `<th>${escapeCell(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeCell(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
      + `<p class="foot"><span>Documento generado desde EnterpriseCloud · Sistema ERP</span><span>Página 1/1</span></p>`
      + `<script>window.onload=function(){var logo=document.querySelector('img.logo');var done=false;function print(){if(done)return;done=true;window.print()}if(logo&&!logo.complete){logo.onload=print;logo.onerror=print;setTimeout(print,2000)}else{print()}}<\/script></body></html>`)
    printWindow.document.close()
    notify(`Exportación de ${title.toLocaleLowerCase()} en PDF preparada.`)
  }

  const settleAccount = async (record: RecordItem, medio?: string) => {
    if (saving || !can('finance', 'editar')) return
    setSaving(true)
    try {
      await updateRecord('finance', record.id, { name: record.name, detail: record.detail, status: 'Completada', amount: record.amount, financeType: record.financeType, medio_pago: medio?.trim() ? medio.trim() : null })
      // La operación vinculada también queda completada (venta) o pagada (compra).
      const kind = record.financeType ?? null
      const action = kind === 'pagar' ? 'pago' : 'cobro'
      let mirrored: string | null = null
      try {
        mirrored = await completeLinkedDocument(record.id, kind)
      } catch (error) {
        await reload()
        notify(`${record.id}: ${action} registrado en Supabase. ${friendlyError(error)}`)
        return
      }
      await reload()
      notify(`${record.id}: ${action} registrado en Supabase.${mirrored ? ` ${mirrored} también quedó ${kind === 'pagar' ? 'pagada' : 'completada'}.` : ''}`)
    } catch (error) { notify(friendlyError(error)) }
    finally { setSaving(false) }
  }

  const receivePurchase = async (record: RecordItem) => {
    if (saving || !can('purchases', 'editar')) return
    if (!record.rowId) return notify('La orden no tiene identificador para recibir.')
    if (purchaseHasStock(record.status)) return notify(`${record.id} ya está recibida.`)
    setSaving(true)
    try {
      // Recibir aplica de una vez: la orden pasa a Recepción y lo comprado
      // ingresa al inventario (+ kardex). Aparece en Ingreso al Kardex.
      const previous = await fetchDocumentLines('purchases', record.rowId)
      const lines: LineInput[] = previous.map((line) => ({ producto_id: line.producto_id, cantidad: line.cantidad, precio: line.precio }))
      if (lines.length && !can('inventory', 'editar')) return notify('Tu rol necesita permiso de editar inventario para recibir la compra.')
      if (lines.some((line) => !catalog.find((item) => item.rowId === line.producto_id)?.productoId) && !can('inventory', 'crear')) return notify('Tu rol necesita permiso de crear productos para recibir artículos nuevos en inventario.')
      await updatePurchaseWithLines(record.id, { name: record.name, detail: record.detail, status: 'Recepción', amount: record.amount }, lines)
      await reload()
      notify(`${record.id} recibida: lo comprado ingresó al inventario (+ kardex).`)
    } catch (error) { notify(friendlyError(error)) }
    finally { setSaving(false) }
  }

  const registerPurchaseIngress = async (record: RecordItem) => {
    if (saving || !can('purchases', 'editar')) return
    if (!record.rowId) return notify('La orden no tiene identificador para registrar su ingreso.')
    if (record.status !== 'Recibida') return notify(`${record.id} no está pendiente de ingreso.`)
    setSaving(true)
    try {
      const previous = await fetchDocumentLines('purchases', record.rowId)
      const lines: LineInput[] = previous.map((line) => ({ producto_id: line.producto_id, cantidad: line.cantidad, precio: line.precio }))
      if (lines.length && !can('inventory', 'editar')) return notify('Tu rol necesita permiso de editar inventario para registrar el ingreso.')
      if (lines.some((line) => !catalog.find((item) => item.rowId === line.producto_id)?.productoId) && !can('inventory', 'crear')) return notify('Tu rol necesita permiso de crear productos para ingresar artículos nuevos al inventario.')
      await updatePurchaseWithLines(record.id, { name: record.name, detail: record.detail, status: 'Recepción', amount: record.amount }, lines)
      await reload()
      notify(`${record.id}: ingreso registrado, lo comprado está en el inventario (+ kardex).`)
    } catch (error) { notify(friendlyError(error)) }
    finally { setSaving(false) }
  }

  const value: RecordsContextValue = {
    records,
    catalog,
    loading,
    saving,
    refreshing,
    lastSyncedAt,
    errors,
    catalogError,
    settleAccount,
    reload,
    toast,
    notify,
    recordModal,
    openComposer,
    openEditor,
    closeRecordModal,
    saveRecord,
    convertQuote,
    pendingDelete,
    requestDelete,
    cancelDelete,
    confirmDelete,
    exportTable,
    receivePurchase,
    registerPurchaseIngress,
  }

  return <RecordsContext.Provider value={value}>{children}</RecordsContext.Provider>
}

export function useRecords() {
  const context = useContext(RecordsContext)
  if (!context) throw new Error('useRecords debe usarse dentro de RecordsProvider')
  return context
}
