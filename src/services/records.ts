import { requireSupabase } from '../lib/supabase'
import { salePayableTotal } from '../data/payments'
import { DATA_PAGES } from '../data/catalog'
import { formatWhen, purchaseHasStock, totalWithIgv } from '../data/helpers'
import type { CustomerImportRow, PurchaseImportRow, SalesImportRow, SupplierImportReport, SupplierImportRow } from './import'
import type { DataPage, DocumentLine, RecordItem, RecordStatus } from '../types'

type Row = Record<string, unknown>

// Datos que captura el formulario (RecordModal).
export type RecordInput = {
  /** Código de origen conservado en importaciones; se prefija para no colisionar con códigos internos. */
  reference?: string
  /** Fecha de origen para importación de registros históricos. */
  created_at?: string
  name: string
  detail: string
  status: RecordStatus
  amount?: number
  quantity?: number
  /** Productos: precio de venta referencial. undefined = no tocar la columna. */
  precio?: number
  /** UUID del cliente (ventas) o proveedor (compras/productos). null = sin vínculo. */
  cliente_id?: string | null
  proveedor_id?: string | null
  /** Proveedores: RUC de 11 dígitos. null = sin registrar. */
  ruc?: string | null
  /** Proveedores: dirección, correo, teléfono y condición de pago. undefined = no tocar. */
  direccion?: string | null
  correo?: string | null
  telefono?: string | null
  forma_pago?: string | null
  /** Clientes: tipo de documento (DNI o RUC). undefined = no tocar la columna. */
  tipo_doc?: 'DNI' | 'RUC' | null
  /** Clientes: número de documento. undefined = no tocar la columna. */
  documento?: string | null
  /** Compras: fecha límite o aproximada (YYYY-MM-DD). null = sin fecha. */
  fecha_limite?: string | null
  /** Ventas: descuento % sobre el subtotal (0-100). undefined = no tocar. */
  descuento?: number
  /** Finanzas: medio con que se canceló la cuenta. undefined = no tocar. */
  medio_pago?: string | null
  /** Compras: comprobante de recepción (Factura, Boleta, Guía de Remisión, Nota de Venta). */
  comprobante_tipo?: string | null
  /** Compras: número del comprobante de recepción. */
  comprobante_numero?: string | null
  financeType?: 'cobrar' | 'pagar' | null
}

// Cómo cada módulo de la interfaz se corresponde con una tabla de Supabase.
type PageConfig = {
  table: string
  name: string      // columna que guarda el "nombre" principal
  amount?: string   // columna monetaria (si el módulo tiene valor)
  quantity?: string // columna de existencias (inventario)
  price?: string    // columna de precio (productos)
  taxId?: string    // columna de RUC (proveedores)
  /** Columna FK opcional hacia clientes/proveedores. */
  relationColumn?: 'cliente_id' | 'proveedor_id'
  /** Módulo origen para resolver el nombre del vinculado. */
  relationTarget?: DataPage
}

export const pageConfig: Record<DataPage, PageConfig> = {
  sales: { table: 'ventas', name: 'cliente_nombre', amount: 'monto', relationColumn: 'cliente_id', relationTarget: 'customers' },
  quotes: { table: 'cotizaciones', name: 'cliente_nombre', amount: 'monto', relationColumn: 'cliente_id', relationTarget: 'customers' },
  purchases: { table: 'compras', name: 'proveedor_nombre', amount: 'monto', relationColumn: 'proveedor_id', relationTarget: 'suppliers' },
  inventory: { table: 'productos', name: 'nombre', quantity: 'stock', price: 'precio' },
  customers: { table: 'clientes', name: 'razon_social', amount: 'linea_credito' },
  suppliers: { table: 'proveedores', name: 'razon_social', taxId: 'ruc' },
  finance: { table: 'pagos', name: 'contraparte', amount: 'monto' },
  documents: { table: 'documentos', name: 'nombre_archivo' },
  reports: { table: 'reportes', name: 'nombre' },
  settings: { table: 'configuracion', name: 'nombre' },
}

export function emptyRecords(): Record<DataPage, RecordItem[]> {
  return Object.fromEntries(DATA_PAGES.map((page) => [page, [] as RecordItem[]])) as Record<DataPage, RecordItem[]>
}

function dueLabel(value: string) {
  const date = new Date(`${value}T12:00:00`)
  return `Vence el ${date.toLocaleDateString('es-PE', { day: 'numeric', month: 'short' })}`
}

function toRecord(page: DataPage, row: Row): RecordItem {
  const config = pageConfig[page]
  const createdAt = String(row.created_at ?? '')
  let date = formatWhen(String(row.updated_at ?? createdAt))
  if (page === 'finance' && typeof row.fecha_vencimiento === 'string') date = dueLabel(row.fecha_vencimiento)
  if (page === 'customers' && createdAt) date = `Cliente desde ${new Date(createdAt).getFullYear()}`

  const item: RecordItem = {
    id: String(row.codigo),
    rowId: typeof row.id === 'string' ? row.id : undefined,
    name: String(row[config.name] ?? ''),
    detail: String(row.detalle ?? ''),
    date,
    createdAt: createdAt || undefined,
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : undefined,
    status: String(row.estado) as RecordStatus,
  }
  if (page === 'finance') {
    item.financeType = row.tipo === 'cobrar' || row.tipo === 'pagar' ? row.tipo : null
    item.saleId = typeof row.venta_id === 'string' ? row.venta_id : null
    item.purchaseId = typeof row.compra_id === 'string' ? row.compra_id : null
    item.dueAt = typeof row.fecha_vencimiento === 'string' ? row.fecha_vencimiento : null
    item.medio = typeof row.medio_pago === 'string' && row.medio_pago ? row.medio_pago : null
  }
  // Medio de pago de la venta (si su migración ya se ejecutó).
  if (page === 'sales') {
    item.medio = typeof row.medio_pago === 'string' && row.medio_pago ? row.medio_pago : null
  }
  // Descuento de la venta (si su migración ya se ejecutó).
  if (page === 'sales') {
    if (typeof row.descuento === 'number') item.descuento = row.descuento
    else if ('descuento' in row) item.descuento = Number((row.descuento as number | null) ?? 0) || 0
  }
  if (config.amount && row[config.amount] !== null && row[config.amount] !== undefined) item.amount = Number(row[config.amount])
  if (config.quantity && row[config.quantity] !== null && row[config.quantity] !== undefined) item.quantity = Number(row[config.quantity])
  if (page === 'purchases') {
    if (typeof row.fecha_limite === 'string') item.fechaLimite = row.fecha_limite
    else if (row.fecha_limite === null) item.fechaLimite = null
    if (typeof row.comprobante_tipo === 'string') item.comprobanteTipo = row.comprobante_tipo
    else if (row.comprobante_tipo === null) item.comprobanteTipo = null
    if (typeof row.comprobante_numero === 'string') item.comprobanteNumero = row.comprobante_numero
    else if (row.comprobante_numero === null) item.comprobanteNumero = null
  }
  // Precio del producto (si la migración de precio ya se ejecutó).
  if (config.price && row[config.price] !== null && row[config.price] !== undefined) item.precio = Number(row[config.price])
  // RUC del proveedor (si su migración ya se ejecutó).
  if (config.taxId && config.taxId in row) item.ruc = (row[config.taxId] as string | null) ?? null
  // Contacto del proveedor (si su migración ya se ejecutó).
  if (page === 'suppliers') {
    if (typeof row.direccion === 'string') item.direccion = row.direccion
    else if ('direccion' in row) item.direccion = (row.direccion as string | null) ?? null
    if (typeof row.correo === 'string') item.correo = row.correo
    else if ('correo' in row) item.correo = (row.correo as string | null) ?? null
    if (typeof row.telefono === 'string') item.telefono = row.telefono
    else if ('telefono' in row) item.telefono = (row.telefono as string | null) ?? null
    if (typeof row.forma_pago === 'string') item.formaPago = row.forma_pago
    else if ('forma_pago' in row) item.formaPago = (row.forma_pago as string | null) ?? null
  }
  // Documento del cliente (si su migración ya se ejecutó).
  if (page === 'customers') {
    if (row.tipo_doc === 'DNI' || row.tipo_doc === 'RUC') item.tipoDoc = row.tipo_doc
    else if ('tipo_doc' in row) item.tipoDoc = (row.tipo_doc as 'DNI' | 'RUC' | null) ?? null
    if (typeof row.documento === 'string') item.documento = row.documento
    else if ('documento' in row) item.documento = (row.documento as string | null) ?? null
  }
  // FKs en crudo (pueden venir null o no existir si la migración aún no se ejecutó).
  if (typeof row.cliente_id === 'string' || row.cliente_id === null) item.cliente_id = row.cliente_id as string | null
  else if ('cliente_id' in row) item.cliente_id = (row.cliente_id as string | null) ?? null
  if (typeof row.proveedor_id === 'string' || row.proveedor_id === null) item.proveedor_id = row.proveedor_id as string | null
  else if ('proveedor_id' in row) item.proveedor_id = (row.proveedor_id as string | null) ?? null
  // Joins embebidos de PostgREST (si algún día se usan selects con embed).
  const embeddedClient = row.clientes as { codigo?: unknown; razon_social?: unknown } | null | undefined
  if (embeddedClient && typeof embeddedClient.razon_social === 'string') {
    item.relatedName = embeddedClient.razon_social
    if (typeof embeddedClient.codigo === 'string') item.relatedCode = embeddedClient.codigo
  }
  const embeddedSupplier = row.proveedores as { codigo?: unknown; razon_social?: unknown } | null | undefined
  if (embeddedSupplier && typeof embeddedSupplier.razon_social === 'string') {
    item.relatedName = embeddedSupplier.razon_social
    if (typeof embeddedSupplier.codigo === 'string') item.relatedCode = embeddedSupplier.codigo
  }
  return item
}

function toRow(page: DataPage, input: RecordInput): Row {
  const config = pageConfig[page]
  const row: Row = { [config.name]: input.name, detalle: input.detail, estado: input.status }
  if ((page === 'sales' || page === 'purchases') && input.reference) row.codigo = `IMP-${input.reference.trim()}`
  if ((page === 'sales' || page === 'purchases') && input.created_at) row.created_at = input.created_at
  if (page === 'finance' && input.financeType !== undefined) row.tipo = input.financeType
  if (page === 'finance' && input.medio_pago !== undefined) row.medio_pago = input.medio_pago || null
  // Medio de pago de la venta (solo ese módulo lo usa).
  if (page === 'sales' && input.medio_pago !== undefined) row.medio_pago = input.medio_pago || null
  // Descuento de la venta (solo ese módulo lo usa).
  if (page === 'sales' && input.descuento !== undefined) row.descuento = Math.min(100, Math.max(0, Number(input.descuento) || 0))
  if (config.amount && input.amount !== undefined) row[config.amount] = input.amount
  if (config.quantity && input.quantity !== undefined) row[config.quantity] = input.quantity
  if (config.price && input.precio !== undefined) row[config.price] = input.precio
  if (config.taxId && input.ruc !== undefined) row[config.taxId] = input.ruc
  // Contacto del proveedor (solo ese módulo los usa).
  if (page === 'suppliers') {
    if (input.direccion !== undefined) row.direccion = input.direccion || null
    if (input.correo !== undefined) row.correo = input.correo || null
    if (input.telefono !== undefined) row.telefono = input.telefono || null
    if (input.forma_pago !== undefined) row.forma_pago = input.forma_pago || null
  }
  // Documento del cliente (solo ese módulo los usa).
  if (page === 'customers') {
    if (input.tipo_doc !== undefined) row.tipo_doc = input.tipo_doc
    if (input.documento !== undefined) row.documento = input.documento || null
  }
  // Solo se envía la FK si el formulario la definió (incluye null para desvincular).
  if (config.relationColumn === 'cliente_id' && input.cliente_id !== undefined) row.cliente_id = input.cliente_id
  if (config.relationColumn === 'proveedor_id' && input.proveedor_id !== undefined) row.proveedor_id = input.proveedor_id
  // Seguimiento de la orden de compra (solo ese módulo los usa).
  if (page === 'purchases') {
    if (input.fecha_limite !== undefined) row.fecha_limite = input.fecha_limite || null
    if (input.comprobante_tipo !== undefined) row.comprobante_tipo = input.comprobante_tipo || null
    if (input.comprobante_numero !== undefined) row.comprobante_numero = input.comprobante_numero?.trim() || null
  }
  return row
}

/** Si la BD aún no tiene una tabla nueva (migración pendiente). */
export function isMissingTableError(error: unknown): boolean {
  const err = error as { code?: string; message?: string; details?: string; hint?: string } | null
  if (err?.code !== '42P01' && err?.code !== 'PGRST205') return false
  return true
}

/** Si la BD aún no tiene una columna nueva (migración pendiente), la quita y reintenta. Así el push no rompe. */
function isMissingColumnError(error: unknown, column: string): boolean {
  const err = error as { code?: string; message?: string; details?: string; hint?: string } | null
  if (err?.code !== '42703' && err?.code !== 'PGRST204') return false
  const haystack = `${err?.message ?? ''} ${err?.details ?? ''} ${err?.hint ?? ''}`.toLowerCase()
  return haystack.includes(column.toLowerCase()) || haystack.includes('schema cache')
}

/** Quita del payload solo la columna que la BD remota aún no conoce (migración pendiente). */
function withoutColumn(row: Row, column: string): Row {
  const next = { ...row }
  delete next[column]
  return next
}

/** Columnas nuevas que pueden faltar si su migración aún no se ejecutó. */
const PENDING_COLUMNS = ['ruc', 'precio', 'proveedor_id', 'tipo_doc', 'documento', 'direccion', 'correo', 'telefono', 'forma_pago', 'descuento', 'medio_pago']

async function insertWithColumnFallback(table: string, payload: Row, required: string[] = []) {
  const client = requireSupabase()
  let current = payload
  for (let attempt = 0; attempt <= PENDING_COLUMNS.length; attempt++) {
    const result = await client.from(table).insert(current).select('*').single()
    if (!result.error) return result
    const missing = PENDING_COLUMNS.find((column) => column in current && isMissingColumnError(result.error, column))
    if (!missing) return result
    // Una columna obligatoria (como el RUC) no se descarta en silencio:
    // se devuelve el error para exigir la migración con un mensaje claro.
    if (required.includes(missing)) return result
    current = withoutColumn(current, missing)
  }
  return client.from(table).insert(current).select('*').single()
}

async function updateWithColumnFallback(table: string, payload: Row, code: string, required: string[] = []) {
  const client = requireSupabase()
  let current = payload
  for (let attempt = 0; attempt <= PENDING_COLUMNS.length; attempt++) {
    const result = await client.from(table).update(current).eq('codigo', code).select('*').single()
    if (!result.error) return result
    const missing = PENDING_COLUMNS.find((column) => column in current && isMissingColumnError(result.error, column))
    if (!missing) return result
    // Una columna obligatoria (como el RUC) no se descarta en silencio:
    // se devuelve el error para exigir la migración con un mensaje claro.
    if (required.includes(missing)) return result
    current = withoutColumn(current, missing)
  }
  return client.from(table).update(current).eq('codigo', code).select('*').single()
}

// Traduce los errores de Postgres/PostgREST a mensajes comprensibles.
export function friendlyError(error: unknown): string {
  const err = error as { code?: string; message?: string; details?: string; hint?: string } | null
  const haystack = `${err?.message ?? ''} ${err?.details ?? ''} ${err?.hint ?? ''}`
  if (err?.code === '42501' || err?.code === 'PGRST116') return 'Tu rol no tiene permiso para realizar esta acción.'
  if (err?.code === '23505') return 'Ya existe un registro con esos datos.'
  if (err?.code === '23514') return 'Alguno de los valores no es válido (revisa montos y estado).'
  if (err?.code === '42703' || err?.code === 'PGRST204' || (/proveedor_id|precio|\bruc\b|tipo_doc|documento|direccion|correo|telefono|forma_pago|descuento|medio_pago/i.test(haystack) && /column|schema cache/i.test(haystack))) {
    if (/precio/i.test(haystack)) return 'Falta la columna precio en productos. Ejecuta en Supabase la migración 20261011000000_producto_precio.sql y recarga.'
    if (/\bruc\b/i.test(haystack)) return 'Falta la columna RUC en proveedores. Ejecuta en Supabase la migración 20261015000000_proveedor_ruc.sql y recarga.'
    if (/tipo_doc|documento/i.test(haystack)) return 'Falta la columna de documento en clientes. Ejecuta en Supabase la migración 20261017000000_cliente_documento.sql y recarga.'
    if (/direccion|correo|telefono|forma_pago/i.test(haystack)) return 'Faltan las columnas de contacto en proveedores. Ejecuta en Supabase la migración 20261018000000_proveedor_contacto.sql y recarga.'
    if (/descuento|medio_pago/i.test(haystack)) return 'Faltan columnas nuevas en Supabase. Ejecuta en Supabase las migraciones 20261021000000_centro_mantenimiento.sql y 20261025000000_venta_medio_pago.sql y recarga.'
    return 'Falta una columna nueva en Supabase. Ejecuta las migraciones pendientes y recarga.'
  }
  if (err?.code === '23503') return 'El cliente o proveedor seleccionado ya no existe. Elige otro de la lista.'
  if ((err?.code === '42P01' || err?.code === 'PGRST205') && /proveedor_productos|cotizacion/i.test(haystack)) {
    return 'Falta una tabla nueva en Supabase. Ejecuta las migraciones pendientes (20261012000000_cotizaciones.sql, 20261013000000_catalogo_proveedores.sql) y recarga.'
  }
  if ((err?.code === '42P01' || err?.code === 'PGRST205') && /metodos_pago|caja_turnos/i.test(haystack)) {
    return 'Falta una tabla nueva en Supabase. Ejecuta la migración 20261021000000_centro_mantenimiento.sql y recarga.'
  }
  if (err?.message && /fetch|network/i.test(err.message)) return 'No se pudo conectar con la base de datos. Revisa tu conexión.'
  return err?.message || 'Ocurrió un error inesperado con la base de datos.'
}

// -----------------------------------------------------------------------------
// Catálogo de proveedores: lo que ofrece cada proveedor, independiente de mi
// inventario. La compra lo trae y al completarse ingresa a inventario.
// -----------------------------------------------------------------------------

export type CatalogInput = { nombre: string; detalle: string; costo: number }

/** Lee el catálogo completo (sin enriquecer stock: lo hace enrichCatalog). */
export async function fetchSupplierCatalogRaw(): Promise<RecordItem[]> {
  const data = await fetchTableRows('proveedor_productos')
  return data.map((row) => {
    const item: RecordItem = {
      id: String(row.codigo),
      rowId: typeof row.id === 'string' ? row.id : undefined,
      name: String(row.nombre ?? ''),
      detail: String(row.detalle ?? ''),
      date: formatWhen(String(row.updated_at ?? row.created_at ?? '')),
      status: 'Activo',
      proveedor_id: (row.proveedor_id as string | null) ?? null,
      productoId: (row.producto_id as string | null) ?? null,
    }
    if (row.costo !== null && row.costo !== undefined) item.amount = Number(row.costo)
    return item
  })
}

/** Cruza el catálogo con MI inventario: stock actual y nombre del equivalente. */
export function enrichCatalog(catalog: RecordItem[], inventory: RecordItem[]): RecordItem[] {
  const stockById = new Map<string, RecordItem>()
  for (const product of inventory) {
    if (product.rowId) stockById.set(product.rowId, product)
  }
  return catalog.map((item) => {
    if (!item.productoId) return item
    const target = stockById.get(item.productoId)
    if (!target) return item
    return { ...item, quantity: target.quantity ?? 0, relatedName: target.name, relatedCode: target.id }
  })
}

export async function insertCatalogItem(proveedor_id: string, input: CatalogInput): Promise<RecordItem> {
  const name = input.nombre.trim()
  if (name.length < 2) throw new Error('El producto del proveedor necesita un nombre.')
  if (!Number.isFinite(input.costo) || input.costo < 0) throw new Error('El costo debe ser cero o mayor.')
  const { data, error } = await requireSupabase()
    .from('proveedor_productos')
    .insert({ proveedor_id, nombre: name, detalle: input.detalle.trim(), costo: input.costo })
    .select('*')
    .single()
  if (error) throw error
  const row = data as Row
  return {
    id: String(row.codigo),
    rowId: typeof row.id === 'string' ? row.id : undefined,
    name: String(row.nombre ?? ''),
    detail: String(row.detalle ?? ''),
    date: formatWhen(String(row.updated_at ?? row.created_at ?? '')),
    status: 'Activo',
    proveedor_id: (row.proveedor_id as string | null) ?? null,
    productoId: (row.producto_id as string | null) ?? null,
    amount: Number(row.costo ?? 0),
  }
}

export async function updateCatalogItem(id: string, input: CatalogInput): Promise<RecordItem> {
  const name = input.nombre.trim()
  if (name.length < 2) throw new Error('El producto del proveedor necesita un nombre.')
  if (!Number.isFinite(input.costo) || input.costo < 0) throw new Error('El costo debe ser cero o mayor.')
  const { data, error } = await requireSupabase()
    .from('proveedor_productos')
    .update({ nombre: name, detalle: input.detalle.trim(), costo: input.costo })
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw error
  const row = data as Row
  return {
    id: String(row.codigo),
    rowId: typeof row.id === 'string' ? row.id : undefined,
    name: String(row.nombre ?? ''),
    detail: String(row.detalle ?? ''),
    date: formatWhen(String(row.updated_at ?? row.created_at ?? '')),
    status: 'Activo',
    proveedor_id: (row.proveedor_id as string | null) ?? null,
    productoId: (row.producto_id as string | null) ?? null,
    amount: Number(row.costo ?? 0),
  }
}

export async function deleteCatalogItem(id: string): Promise<void> {
  const { data, error } = await requireSupabase().from('proveedor_productos').delete().eq('id', id).select('id')
  if (error) throw error
  if (!data || data.length === 0) throw { code: '42501', message: 'No se pudo eliminar del catálogo.' }
}

/**
 * Alta masiva de proveedores con sus productos (importación CSV).
 * Omite RUC duplicados (dentro del archivo o ya registrados) y productos
 * inválidos, reportando cada caso sin abortar el resto.
 */
export async function importSuppliersWithProducts(rows: SupplierImportRow[]): Promise<SupplierImportReport> {
  const client = requireSupabase()
  const omitted: SupplierImportReport['omitted'] = []
  const failed: SupplierImportReport['failed'] = []
  const skippedProducts: SupplierImportReport['skippedProducts'] = []
  const seenFile = new Set<string>()
  const fresh = rows.filter((row) => {
    if (seenFile.has(row.ruc)) {
      omitted.push({ line: row.line, ruc: row.ruc, reason: 'RUC duplicado dentro del archivo' })
      return false
    }
    seenFile.add(row.ruc)
    return true
  })
  if (!fresh.length) return { created: 0, updated: 0, products: 0, omitted, failed, skippedProducts }
  const { data: existing, error: existingError } = await client.from('proveedores').select('id,ruc')
  if (existingError) throw existingError
  const existingByRuc = new Map(((existing ?? []) as Array<{ id: string; ruc: string | null }>).filter((row) => row?.ruc).map((row) => [row.ruc as string, row.id]))
  // RUC nuevo -> se crea el proveedor. RUC existente -> NO se omite:
  // se le agregan los productos a su catálogo.
  const toCreate = fresh.filter((row) => !existingByRuc.has(row.ruc))
  const toUpdate = fresh.filter((row) => existingByRuc.has(row.ruc))
  const createdIds = new Map<string, string>()
  let createdList: Array<{ id: string; ruc: string }> = []
  if (toCreate.length) {
    const { data: created, error: insertError } = await client
      .from('proveedores')
      .insert(toCreate.map((row) => ({
        razon_social: row.razonSocial,
        detalle: '',
        ruc: row.ruc,
        direccion: row.direccion || null,
        correo: row.correo || null,
        telefono: row.telefono || null,
        forma_pago: row.formaPago || null,
        estado: row.estado,
      })))
      .select('id,ruc')
    if (insertError) throw insertError
    createdList = ((created ?? []) as Array<{ id: string; ruc: string }>)
    for (const supplier of createdList) createdIds.set(supplier.ruc, supplier.id)
  }
  const byRuc = new Map(fresh.map((row) => [row.ruc, row]))
  // Nombres ya ofrecidos por cada proveedor existente: se omiten duplicados.
  const existingNames = new Set<string>()
  const updateIds = toUpdate.map((row) => existingByRuc.get(row.ruc) as string).filter(Boolean)
  if (updateIds.length) {
    const { data: catalogExisting, error: catalogError } = await client
      .from('proveedor_productos')
      .select('proveedor_id,nombre')
      .in('proveedor_id', updateIds)
    if (catalogError) throw catalogError
    for (const item of ((catalogExisting ?? []) as Array<{ proveedor_id: string; nombre: string }>)) {
      existingNames.add(`${item.proveedor_id}::${String(item.nombre ?? '').trim().toLocaleLowerCase('es')}`)
    }
  }
  const catalogRows: Row[] = []
  const pushProducts = (ruc: string, supplierId: string, isNew: boolean) => {
    const row = byRuc.get(ruc)
    if (!row) return
    const seenInFile = new Set<string>()
    for (const product of row.productos) {
      const name = product.nombre.trim()
      if (name.length < 2 || !Number.isFinite(product.costo) || product.costo < 0) {
        skippedProducts.push({ proveedor: row.razonSocial, producto: product.nombre || '(sin nombre)', reason: 'Producto inválido' })
        continue
      }
      const key = name.toLocaleLowerCase('es')
      if (seenInFile.has(key)) {
        skippedProducts.push({ proveedor: row.razonSocial, producto: name, reason: 'Producto duplicado dentro del archivo' })
        continue
      }
      seenInFile.add(key)
      if (!isNew && existingNames.has(`${supplierId}::${key}`)) {
        skippedProducts.push({ proveedor: row.razonSocial, producto: name, reason: 'Ya existe en el catálogo del proveedor' })
        continue
      }
      catalogRows.push({ proveedor_id: supplierId, nombre: name, detalle: product.detalle.trim(), costo: product.costo })
    }
  }
  for (const supplier of createdList) pushProducts(supplier.ruc, supplier.id, true)
  for (const row of toUpdate) pushProducts(row.ruc, existingByRuc.get(row.ruc) as string, false)
  if (catalogRows.length) {
    const { error: catalogError } = await client.from('proveedor_productos').insert(catalogRows).select('id')
    if (catalogError) throw catalogError
  }
  return { created: createdList.length, updated: toUpdate.length, products: catalogRows.length, omitted, failed, skippedProducts }
}

/** Enriquece ventas/compras/productos con el nombre del cliente/proveedor vinculado. */
function enrichRelations(records: Record<DataPage, RecordItem[]>): Record<DataPage, RecordItem[]> {
  const customersById = new Map<string, RecordItem>()
  for (const customer of records.customers) {
    if (customer.rowId) customersById.set(customer.rowId, customer)
  }
  const suppliersById = new Map<string, RecordItem>()
  for (const supplier of records.suppliers) {
    if (supplier.rowId) suppliersById.set(supplier.rowId, supplier)
  }
  const withRelation = (items: RecordItem[], lookup: Map<string, RecordItem>): RecordItem[] =>
    items.map((item) => {
      const fk = item.cliente_id ?? item.proveedor_id
      if (!fk) return item
      const target = lookup.get(fk)
      if (!target) return item
      // No pisar un embed que ya traía nombre.
      if (item.relatedName) return item
      return { ...item, relatedName: target.name, relatedCode: target.id }
    })
  return {
    ...records,
    sales: withRelation(records.sales, customersById),
    quotes: withRelation(records.quotes, customersById),
    purchases: withRelation(records.purchases, suppliersById),
  }
}

let sessionCheck: Promise<void> | null = null

/** Evita enviar consultas del ERP cuando Auth perdió o aún no recuperó la sesión. */
async function ensureAuthenticatedSession(): Promise<void> {
  if (!sessionCheck) {
    sessionCheck = (async () => {
      const { data, error } = await requireSupabase().auth.getSession()
      if (error) throw error
      if (!data.session?.access_token) throw new Error('Tu sesión expiró o dejó de ser válida. Vuelve a iniciar sesión para consultar los datos.')
    })().finally(() => { sessionCheck = null })
  }
  await sessionCheck
}

async function fetchTableRows(table: string): Promise<Row[]> {
  await ensureAuthenticatedSession()
  const rows: Row[] = []
  const size = 500
  for (let offset = 0; ; offset += size) {
    const result = await requireSupabase().from(table).select('*').order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + size - 1)
    if (result.error) throw result.error
    rows.push(...result.data as Row[])
    if (result.data.length < size) break
  }
  return rows
}

export async function fetchRecordsSnapshot(pages: DataPage[] = DATA_PAGES) {
  const records = emptyRecords()
  const errors: Partial<Record<DataPage, string>> = {}
  await Promise.all(pages.map(async page => {
    try { records[page] = (await fetchTableRows(pageConfig[page].table)).map(row => toRecord(page, row)) }
    catch (error) { errors[page] = friendlyError(error) }
  }))
  return { records: enrichRelations(records), errors }
}

export async function fetchAllRecords(): Promise<Record<DataPage, RecordItem[]>> {
  const snapshot = await fetchRecordsSnapshot()
  const error = Object.values(snapshot.errors)[0]
  if (error) throw new Error(error)
  return snapshot.records
}

export async function insertRecord(page: DataPage, input: RecordInput): Promise<RecordItem> {
  const payload = toRow(page, input)
  // Inventario (precio), proveedores (ruc) y clientes (documento) tienen
  // columnas nuevas: ahí se aplica el fallback. El RUC es obligatorio en el
  // formulario, así que si falta su columna no se descarta: se exige migrar.
  const attempt = page === 'inventory' || page === 'suppliers' || page === 'customers'
    ? await insertWithColumnFallback(pageConfig[page].table, payload, page === 'suppliers' ? ['ruc'] : [])
    : await requireSupabase().from(pageConfig[page].table).insert(payload).select('*').single()
  if (attempt.error) throw attempt.error
  return toRecord(page, attempt.data as Row)
}

export type ModuleImportIssue = { line: number; reference: string; reason: string }
export type ModuleImportReport = { created: number; skipped: ModuleImportIssue[]; failed: ModuleImportIssue[] }

/** Importa clientes en modo append-only y evita duplicar documentos existentes. */
export async function importCustomers(rows: CustomerImportRow[]): Promise<ModuleImportReport> {
  const client = requireSupabase()
  const report: ModuleImportReport = { created: 0, skipped: [], failed: [] }
  const documents = [...new Set(rows.map(row => row.documento).filter(Boolean))]
  const existingDocuments = new Set<string>()
  if (documents.length) {
    const { data, error } = await client.from('clientes').select('documento').in('documento', documents)
    if (error) throw error
    for (const row of (data ?? []) as Array<{ documento: string | null }>) if (row.documento) existingDocuments.add(row.documento)
  }
  for (const row of rows) {
    if (row.documento && existingDocuments.has(row.documento)) {
      report.skipped.push({ line: row.line, reference: row.documento, reason: 'El documento ya está registrado.' })
      continue
    }
    try {
      await insertRecord('customers', { name: row.razonSocial, detail: row.detalle, status: row.estado, tipo_doc: row.tipoDoc, documento: row.documento || null, amount: row.lineaCredito })
      if (row.documento) existingDocuments.add(row.documento)
      report.created++
    } catch (error) { report.failed.push({ line: row.line, reference: row.documento || row.razonSocial, reason: friendlyError(error) }) }
  }
  return report
}

/** Importa ventas históricas de cabecera; los códigos de origen se conservan como IMP-<código>. */
export async function importSales(rows: SalesImportRow[]): Promise<ModuleImportReport> {
  const client = requireSupabase()
  const report: ModuleImportReport = { created: 0, skipped: [], failed: [] }
  const codes = [...new Set(rows.map(row => `IMP-${row.codigo.trim()}`))]
  const { data: existing, error: existingError } = await client.from('ventas').select('codigo').in('codigo', codes)
  if (existingError) throw existingError
  const existingCodes = new Set(((existing ?? []) as Array<{ codigo: string }>).map(row => row.codigo))
  const relationCodes = [...new Set(rows.map(row => row.clienteCodigo).filter(Boolean))]
  const clientIds = new Map<string, string>()
  if (relationCodes.length) {
    const { data, error } = await client.from('clientes').select('id,codigo').in('codigo', relationCodes)
    if (error) throw error
    for (const row of (data ?? []) as Array<{ id: string; codigo: string }>) clientIds.set(row.codigo, row.id)
  }
  for (const row of rows) {
    const reference = `IMP-${row.codigo.trim()}`
    if (existingCodes.has(reference)) { report.skipped.push({ line: row.line, reference: row.codigo, reason: 'El código ya fue importado.' }); continue }
    if (row.clienteCodigo && !clientIds.has(row.clienteCodigo)) { report.failed.push({ line: row.line, reference: row.codigo, reason: `No existe el cliente ${row.clienteCodigo}.` }); continue }
    try {
      await insertSaleWithLines({ reference: row.codigo, created_at: row.fecha ? `${row.fecha}T12:00:00.000Z` : undefined, name: row.clienteNombre, detail: row.detalle, status: row.estado, amount: row.monto, medio_pago: row.medioPago || null, cliente_id: row.clienteCodigo ? clientIds.get(row.clienteCodigo) : null }, [])
      existingCodes.add(reference)
      report.created++
    } catch (error) { report.failed.push({ line: row.line, reference: row.codigo, reason: friendlyError(error) }) }
  }
  return report
}

/** Importa compras históricas de cabecera; no genera movimientos de stock sin líneas de producto. */
export async function importPurchases(rows: PurchaseImportRow[]): Promise<ModuleImportReport> {
  const client = requireSupabase()
  const report: ModuleImportReport = { created: 0, skipped: [], failed: [] }
  const codes = [...new Set(rows.map(row => `IMP-${row.codigo.trim()}`))]
  const { data: existing, error: existingError } = await client.from('compras').select('codigo').in('codigo', codes)
  if (existingError) throw existingError
  const existingCodes = new Set(((existing ?? []) as Array<{ codigo: string }>).map(row => row.codigo))
  const relationCodes = [...new Set(rows.map(row => row.proveedorCodigo).filter(Boolean))]
  const supplierIds = new Map<string, string>()
  if (relationCodes.length) {
    const { data, error } = await client.from('proveedores').select('id,codigo').in('codigo', relationCodes)
    if (error) throw error
    for (const row of (data ?? []) as Array<{ id: string; codigo: string }>) supplierIds.set(row.codigo, row.id)
  }
  for (const row of rows) {
    const reference = `IMP-${row.codigo.trim()}`
    if (existingCodes.has(reference)) { report.skipped.push({ line: row.line, reference: row.codigo, reason: 'El código ya fue importado.' }); continue }
    if (row.proveedorCodigo && !supplierIds.has(row.proveedorCodigo)) { report.failed.push({ line: row.line, reference: row.codigo, reason: `No existe el proveedor ${row.proveedorCodigo}.` }); continue }
    try {
      await insertPurchaseWithLines({ reference: row.codigo, created_at: row.fecha ? `${row.fecha}T12:00:00.000Z` : undefined, name: row.proveedorNombre, detail: row.detalle, status: row.estado, amount: row.monto, proveedor_id: row.proveedorCodigo ? supplierIds.get(row.proveedorCodigo) : null, fecha_limite: row.fechaLimite || null, comprobante_tipo: row.comprobanteTipo || null, comprobante_numero: row.comprobanteNumero || null }, [])
      existingCodes.add(reference)
      report.created++
    } catch (error) { report.failed.push({ line: row.line, reference: row.codigo, reason: friendlyError(error) }) }
  }
  return report
}

export async function updateRecord(page: DataPage, code: string, input: RecordInput): Promise<RecordItem> {
  const payload = toRow(page, input)
  // La edición siempre refresca updated_at (trazabilidad y ventanas de caja).
  payload.updated_at = new Date().toISOString()
  const attempt = page === 'inventory' || page === 'suppliers' || page === 'customers'
    ? await updateWithColumnFallback(pageConfig[page].table, payload, code, page === 'suppliers' ? ['ruc'] : [])
    : await requireSupabase().from(pageConfig[page].table).update(payload).eq('codigo', code).select('*').single()
  if (attempt.error) throw attempt.error
  return toRecord(page, attempt.data as Row)
}

export async function deleteRecord(page: DataPage, code: string): Promise<void> {
  if (page === 'sales' || page === 'purchases') {
    const header = await requireSupabase().from(pageConfig[page].table).select('id').eq('codigo', code).single()
    if (header.error) throw header.error
    const detailTable = page === 'sales' ? 'detalle_ventas' : 'detalle_compras'
    const column = page === 'sales' ? 'venta_id' : 'compra_id'
    const [lines, payments] = await Promise.all([
      requireSupabase().from(detailTable).select('id').eq(column, header.data.id).limit(1),
      requireSupabase().from('pagos').select('id').eq(column, header.data.id).limit(1),
    ])
    if (lines.error) throw lines.error
    if (payments.error) throw payments.error
    if (lines.data.length || payments.data.length) throw new Error('Esta operación tiene productos o cuentas vinculadas. Edita su seguimiento para conservar la trazabilidad del inventario y las finanzas.')
  }
  const { data, error } = await requireSupabase().from(pageConfig[page].table).delete().eq('codigo', code).select('codigo')
  if (error) throw error
  // Si las políticas de seguridad impiden borrar, Supabase responde sin error pero sin filas.
  if (!data || data.length === 0) throw { code: '42501', message: 'No se pudo eliminar el registro.' }
}

/** Movimiento del kardex: cada entrada/salida de un producto (se genera solo por trigger). */
export type KardexEntry = {
  id: string
  producto_id: string | null
  productoCodigo?: string
  productoNombre?: string
  tipo: 'entrada' | 'salida' | 'ajuste' | 'transferencia'
  cantidad: number
  stock_anterior: number | null
  stock_nuevo: number | null
  referencia?: string | null
  created_at: string
}

/** Historial de movimientos de inventario, del más reciente al más antiguo. */
export async function fetchKardex(productId: string | null = null, limit = 100): Promise<KardexEntry[]> {
  const client = requireSupabase()
  let query = client
    .from('movimientos_inventario')
    .select('id, producto_id, tipo, cantidad, stock_anterior, stock_nuevo, referencia, created_at, productos(codigo, nombre)')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (productId) query = query.eq('producto_id', productId)
  const { data, error } = await query
  if (error) throw error
  return (data as unknown as Array<{
    id: string
    producto_id: string | null
    tipo: KardexEntry['tipo']
    cantidad: number
    stock_anterior: number | null
    stock_nuevo: number | null
    referencia: string | null
    created_at: string
    productos: { codigo: string; nombre: string } | null
  }>).map((row) => ({
    id: String(row.id),
    producto_id: row.producto_id,
    productoCodigo: row.productos?.codigo,
    productoNombre: row.productos?.nombre,
    tipo: row.tipo,
    cantidad: Number(row.cantidad),
    stock_anterior: row.stock_anterior === null ? null : Number(row.stock_anterior),
    stock_nuevo: row.stock_nuevo === null ? null : Number(row.stock_nuevo),
    referencia: row.referencia,
    created_at: String(row.created_at),
  }))
}

export async function updateStatuses(page: DataPage, codes: string[], status: RecordStatus): Promise<RecordItem[]> {
  const { data, error } = await requireSupabase().from(pageConfig[page].table).update({ estado: status }).in('codigo', codes).select('*')
  if (error) throw error
  return (data as Row[]).map((row) => toRecord(page, row))
}

// -----------------------------------------------------------------------------
// Documentos con líneas: ventas ↔ detalle_ventas, compras ↔ detalle_compras.
// Además mueven stock y generan la cuenta por cobrar / por pagar (cobranzas).
// -----------------------------------------------------------------------------

export type LineInput = { producto_id: string; cantidad: number; precio: number }

function lineTotal(lines: LineInput[]) {
  return Math.round(lines.reduce((sum, line) => sum + line.cantidad * line.precio, 0) * 100) / 100
}

function sameLines(left: LineInput[], right: LineInput[]) {
  const normalize = (lines: LineInput[]) => lines.map(line => `${line.producto_id}:${line.cantidad}:${line.precio}`).sort().join('|')
  return left.length === right.length && normalize(left) === normalize(right)
}

function assertValidLines(lines: LineInput[]) {
  for (const line of lines) {
    if (!line.producto_id) throw new Error('Elige un producto válido en cada línea.')
    if (!Number.isInteger(line.cantidad) || line.cantidad <= 0) throw new Error('La cantidad debe ser un entero mayor a cero.')
    if (!Number.isFinite(line.precio) || line.precio < 0) throw new Error('El precio/costo debe ser cero o mayor.')
  }
}

/** Últimos movimientos de auditoría (quién hizo qué, solo lectura). */
export type AuditEntry = { id: number; email: string | null; accion: string; modulo: string; registro: string | null; resultado: string; createdAt: string }

export async function fetchAuditTrail(limit = 20): Promise<AuditEntry[]> {
  const { data, error } = await requireSupabase()
    .from('auditoria')
    .select('id, usuario_email, accion, modulo, registro_id, resultado, created_at')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return ((data ?? []) as Row[]).map((row) => ({
    id: Number(row.id),
    email: typeof row.usuario_email === 'string' ? row.usuario_email : null,
    accion: String(row.accion ?? ''),
    modulo: String(row.modulo ?? ''),
    registro: typeof row.registro_id === 'string' ? row.registro_id : null,
    resultado: String(row.resultado ?? ''),
    createdAt: typeof row.created_at === 'string' ? row.created_at : '',
  }))
}

/** Líneas guardadas de una venta, cotización o compra (para precargar el editor). */
export async function fetchDocumentLines(page: 'sales' | 'purchases' | 'quotes', docRowId: string): Promise<DocumentLine[]> {
  const client = requireSupabase()
  if (page === 'quotes') {
    const { data, error } = await client
      .from('detalle_cotizaciones')
      .select('producto_id, cantidad, precio_unitario, productos(codigo, nombre, stock)')
      .eq('cotizacion_id', docRowId)
    if (error) throw error
    return (data as unknown as Array<{ producto_id: string | null; cantidad: number; precio_unitario: number; productos: { codigo: string; nombre: string; stock: number } | null }>)
      .filter((row) => row.producto_id)
      .map((row) => ({
        producto_id: row.producto_id as string,
        cantidad: Number(row.cantidad),
        precio: Number(row.precio_unitario),
        codigo: row.productos?.codigo,
        nombre: row.productos?.nombre,
        stock: row.productos?.stock,
      }))
  }
  if (page === 'sales') {
    const { data, error } = await client
      .from('detalle_ventas')
      .select('producto_id, cantidad, precio_unitario, productos(codigo, nombre, stock)')
      .eq('venta_id', docRowId)
    if (error) throw error
    return (data as unknown as Array<{ producto_id: string | null; cantidad: number; precio_unitario: number; productos: { codigo: string; nombre: string; stock: number } | null }>)
      .filter((row) => row.producto_id)
      .map((row) => ({
        producto_id: row.producto_id as string,
        cantidad: Number(row.cantidad),
        precio: Number(row.precio_unitario),
        codigo: row.productos?.codigo,
        nombre: row.productos?.nombre,
        stock: row.productos?.stock,
      }))
  }
  const { data, error } = await client
    .from('detalle_compras')
    .select('proveedor_producto_id, cantidad, costo_unitario, proveedor_productos(codigo, nombre)')
    .eq('compra_id', docRowId)
  if (error) throw error
  return (data as unknown as Array<{ proveedor_producto_id: string | null; cantidad: number; costo_unitario: number; proveedor_productos: { codigo: string; nombre: string } | null }>)
    .filter((row) => row.proveedor_producto_id)
    .map((row) => ({
      producto_id: row.proveedor_producto_id as string,
      cantidad: Number(row.cantidad),
      precio: Number(row.costo_unitario),
      codigo: row.proveedor_productos?.codigo,
      nombre: row.proveedor_productos?.nombre,
    }))
}

async function getStocks(productIds: string[]): Promise<Map<string, number>> {
  const client = requireSupabase()
  const unique = [...new Set(productIds)]
  if (!unique.length) return new Map()
  const { data, error } = await client.from('productos').select('id, stock').in('id', unique)
  if (error) throw error
  return new Map((data as Array<{ id: string; stock: number }>).map((row) => [row.id, Number(row.stock)]))
}

async function getProductLabels(productIds: string[]): Promise<Map<string, string>> {
  const client = requireSupabase()
  const unique = [...new Set(productIds)]
  if (!unique.length) return new Map()
  const { data } = await client.from('productos').select('id, codigo, nombre').in('id', unique)
  if (!data) return new Map()
  return new Map(
    (data as Array<{ id: string; codigo: string; nombre: string }>).map((row) => [row.id, `${row.nombre} (${row.codigo})`]),
  )
}

async function setStock(producto_id: string, nuevo: number): Promise<void> {
  if (!Number.isInteger(nuevo) || nuevo < 0) throw new Error('El stock resultante no puede ser negativo.')
  const { error } = await requireSupabase().from('productos').update({ stock: nuevo }).eq('id', producto_id).select('id').single()
  if (error) {
    if ((error as { code?: string }).code === '42501') {
      throw { code: '42501', message: 'Tu rol no tiene permiso para mover inventario (se necesita editar inventario).' }
    }
    throw error
  }
}

/** Completa la venta o compra vinculada a una cuenta cobrada/pagada.
 * Devuelve el código del documento marcado, o null si no había nada que marcar. */
export async function completeLinkedDocument(pagoCodigo: string, tipo: 'cobrar' | 'pagar' | null): Promise<string | null> {
  const client = requireSupabase()
  const { data: pago, error: pagoError } = await client
    .from('pagos')
    .select('venta_id, compra_id')
    .eq('codigo', pagoCodigo)
    .single()
  if (pagoError) throw pagoError
  const link = pago as { venta_id: string | null; compra_id: string | null } | null
  if (tipo === 'cobrar' && link?.venta_id) {
    const { data: venta } = await client.from('ventas').select('codigo, estado').eq('id', link.venta_id).single()
    const header = (venta ?? null) as { codigo: string; estado: string } | null
    if (!header || header.estado === 'Completada') return null
    const { data: updated, error: updateError } = await client.from('ventas').update({ estado: 'Completada' }).eq('id', link.venta_id).select('codigo')
    if (updateError) throw updateError
    if (!(updated as Array<{ codigo: string }> | null)?.length) throw { code: '42501', message: 'Tu rol necesita permiso de editar ventas para marcarla como completada.' }
    return header.codigo
  }
  if (tipo === 'pagar' && link?.compra_id) {
    const { data: compra } = await client.from('compras').select('codigo, estado').eq('id', link.compra_id).single()
    const header = (compra ?? null) as { codigo: string; estado: string } | null
    if (!header || header.estado === 'Pagada') return null
    const { data: updated, error: updateError } = await client.from('compras').update({ estado: 'Pagada' }).eq('id', link.compra_id).select('codigo')
    if (updateError) throw updateError
    if (!(updated as Array<{ codigo: string }> | null)?.length) throw { code: '42501', message: 'Tu rol necesita permiso de editar compras para marcarla como pagada.' }
    return header.codigo
  }
  return null
}

/** Métodos de pago activos (si la migración aún no se ejecutó, usa la lista base). */
export const DEFAULT_PAYMENT_METHODS = ['Efectivo', 'Yape', 'Plin', 'Tarjeta', 'Transferencia bancaria']

export type PaymentMethod = { id: string; nombre: string; activo: boolean }

export async function fetchPaymentMethods(): Promise<PaymentMethod[]> {
  try {
    const { data, error } = await requireSupabase().from('metodos_pago').select('id, nombre, activo').order('nombre')
    if (error) throw error
    const rows = ((data ?? []) as Array<{ id: string; nombre: string; activo: boolean }>)
      .filter((row) => row.activo && row.nombre.trim())
      .map((row) => ({ id: String(row.id), nombre: row.nombre.trim(), activo: true }))
    return rows.length ? rows : DEFAULT_PAYMENT_METHODS.map((nombre) => ({ id: nombre, nombre, activo: true }))
  } catch {
    return DEFAULT_PAYMENT_METHODS.map((nombre) => ({ id: nombre, nombre, activo: true }))
  }
}

/** Todos los métodos (activos e inactivos) para gestionarlos en Mantenimiento. */
export async function fetchAllPaymentMethods(): Promise<PaymentMethod[]> {
  const { data, error } = await requireSupabase().from('metodos_pago').select('id, nombre, activo').order('nombre')
  if (error) throw error
  return ((data ?? []) as Array<{ id: string; nombre: string; activo: boolean }>)
    .filter((row) => row.nombre.trim())
    .map((row) => ({ id: String(row.id), nombre: row.nombre.trim(), activo: Boolean(row.activo) }))
}

export async function savePaymentMethod(nombre: string): Promise<void> {
  const clean = nombre.trim()
  if (clean.length < 2) throw new Error('El método de pago necesita al menos 2 caracteres.')
  const { error } = await requireSupabase().from('metodos_pago').insert({ nombre: clean })
  if (error) throw error
}

export async function setPaymentMethodActive(id: string, activo: boolean): Promise<void> {
  const { error } = await requireSupabase().from('metodos_pago').update({ activo }).eq('id', id)
  if (error) throw error
}

/** Monedas para mostrar importes (la base es el sol peruano). */
export type Currency = { id: string; nombre: string; codigo: string; simbolo: string; activo: boolean }

export async function fetchAllCurrencies(): Promise<Currency[]> {
  const { data, error } = await requireSupabase().from('monedas').select('id, nombre, codigo, simbolo, activo').order('nombre')
  if (error) throw error
  return ((data ?? []) as Array<{ id: string; nombre: string; codigo: string; simbolo: string; activo: boolean }>)
    .filter((row) => row.nombre.trim() && row.codigo.trim())
    .map((row) => ({ id: String(row.id), nombre: row.nombre.trim(), codigo: row.codigo.trim().toUpperCase(), simbolo: row.simbolo.trim() || 'S/', activo: Boolean(row.activo) }))
}

export async function saveCurrency(input: { nombre: string; codigo: string; simbolo: string }): Promise<void> {
  const nombre = input.nombre.trim()
  const codigo = input.codigo.trim().toUpperCase()
  const simbolo = input.simbolo.trim() || 'S/'
  if (nombre.length < 2) throw new Error('La moneda necesita un nombre de al menos 2 caracteres.')
  if (!/^[A-Z]{3}$/.test(codigo)) throw new Error('El código debe tener 3 letras (ej. PEN, USD).')
  const { error } = await requireSupabase().from('monedas').insert({ nombre, codigo, simbolo })
  if (error) throw error
}

export async function setCurrencyActive(id: string, activo: boolean): Promise<void> {
  const { error } = await requireSupabase().from('monedas').update({ activo }).eq('id', id)
  if (error) throw error
}

/** Costo promedio ponderado por producto desde las líneas de compra. */
export async function fetchInventoryValuation(): Promise<Map<string, { cantidad: number; costoPromedio: number }>> {
  const client = requireSupabase()
  const grouped = new Map<string, { cantidad: number; costo: number }>()
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await client
      .from('detalle_compras')
      .select('cantidad, costo_unitario, proveedor_productos(producto_id)')
      .range(offset, offset + 499)
    if (error) throw error
    const rows = ((data ?? []) as Array<Record<string, unknown>>)
    if (!rows.length) break
    for (const row of rows) {
      const join = row.proveedor_productos as { producto_id?: unknown } | Array<{ producto_id?: unknown }> | null
      const rawId = Array.isArray(join) ? join[0]?.producto_id : join?.producto_id
      const productoId = typeof rawId === 'string' ? rawId : null
      if (!productoId || !Number.isFinite(Number(row.cantidad)) || Number(row.cantidad) <= 0) continue
      const entry = grouped.get(productoId) ?? { cantidad: 0, costo: 0 }
      entry.cantidad += Number(row.cantidad)
      entry.costo += Number(row.cantidad) * Number(row.costo_unitario ?? 0)
      grouped.set(productoId, entry)
    }
    if (rows.length < 500) break
  }
  return new Map([...grouped.entries()].map(([productoId, entry]) => [
    productoId,
    { cantidad: entry.cantidad, costoPromedio: entry.cantidad ? Math.round(entry.costo / entry.cantidad * 100) / 100 : 0 },
  ]))
}

/** Crea la cuenta por cobrar (venta) o por pagar (compra). El trigger asigna CXC-/CXP-. */
async function createRelatedPago(kind: 'sale' | 'purchase', header: Row, total: number, estado: RecordStatus): Promise<void> {
  const client = requireSupabase()
  const codigo = String(header.codigo)
  const isSale = kind === 'sale'
  const pagoEstado: RecordStatus = estado === 'Completada' || estado === 'Pagada' ? 'Completada' : estado === 'En curso' || estado === 'En tránsito' ? 'En curso' : 'Pendiente'
  const { error } = await client.from('pagos').insert({
    contraparte: isSale ? String(header.cliente_nombre) : String(header.proveedor_nombre),
    detalle: isSale ? `Cuenta por cobrar · ${codigo}` : `Cuenta por pagar · ${codigo}`,
    monto: total,
    estado: pagoEstado,
    tipo: isSale ? 'cobrar' : 'pagar',
    venta_id: isSale ? String(header.id) : null,
    compra_id: isSale ? null : String(header.id),
    ...(typeof header.created_at === 'string' ? { created_at: header.created_at } : {}),
    ...(isSale && header.medio_pago !== undefined ? { medio_pago: header.medio_pago || null } : {}),
  })
  if (error) throw error
}

async function syncRelatedPago(kind: 'sale' | 'purchase', headerId: string, total: number, estado: RecordStatus, medioPago?: string | null): Promise<void> {
  const client = requireSupabase()
  const column = kind === 'sale' ? 'venta_id' : 'compra_id'
  const { data, error } = await client.from('pagos').select('id, estado').eq(column, headerId).limit(1)
  if (error) throw error
  const existing = (data as Array<{ id: string; estado: string }> | null)?.[0]
  if (!existing) {
    // Recupera el header para heredar contraparte/código.
    const table = kind === 'sale' ? 'ventas' : 'compras'
    const { data: header } = await client.from(table).select('*').eq('id', headerId).single()
    if (header) await createRelatedPago(kind, header as Row, total, estado)
    return
  }
  const nextEstado = estado === 'Completada' || estado === 'Pagada' ? 'Completada' : existing.estado
  const result = await client.from('pagos').update({
    monto: total,
    estado: nextEstado,
    // Una cuenta ya cobrada conserva el medio real registrado en Tesorería.
    ...(kind === 'sale' && medioPago !== undefined && existing.estado !== 'Completada' ? { medio_pago: medioPago || null } : {}),
  }).eq('id', existing.id).select('id').single()
  if (result.error) throw result.error
}

export async function insertSaleWithLines(input: RecordInput, lines: LineInput[]): Promise<RecordItem> {
  assertValidLines(lines)
  const client = requireSupabase()
  // Descuento % sobre el subtotal de productos (0-100). Sin líneas no aplica.
  const discount = lines.length ? Math.min(100, Math.max(0, Number(input.descuento) || 0)) : 0
  const total = salePayableTotal(lineTotal(lines), discount, input.amount ?? 0, lines.length > 0)
  const headerInput: RecordInput = { ...input, descuento: discount, amount: total }

  // 1. Valida stock antes de tocar nada (evita dejar la venta a medias).
  // Nunca permite vender más del disponible: el formulario lo topa y aquí se revalida.
  const stocks = await getStocks(lines.map((line) => line.producto_id))
  const labels = await getProductLabels(lines.map((line) => line.producto_id))
  for (const line of lines) {
    const available = stocks.get(line.producto_id) ?? 0
    if (line.cantidad > available) {
      const name = labels.get(line.producto_id) ?? line.producto_id
      throw new Error(`Stock insuficiente para ${name}: disponible ${available}, pedido ${line.cantidad}. Reduce la cantidad.`)
    }
  }

  // 2. Cabecera.
  const { data: header, error: headerError } = await client.from('ventas').insert(toRow('sales', headerInput)).select('*').single()
  if (headerError) throw headerError
  const headerRow = header as Row

  try {
    // 3. Líneas.
    if (lines.length) {
      const { error: linesError } = await client.from('detalle_ventas').insert(
        lines.map((line) => ({
          venta_id: String(headerRow.id),
          producto_id: line.producto_id,
          cantidad: line.cantidad,
          precio_unitario: line.precio,
        })),
      )
      if (linesError) throw linesError
      // 4. Descuenta stock (el kardex se genera solo por trigger).
      for (const line of lines) {
        await setStock(line.producto_id, (stocks.get(line.producto_id) ?? 0) - line.cantidad)
      }
    }
    // 5. Cobranza automática (CxC).
    await createRelatedPago('sale', headerRow, total, input.status)
  } catch (error) {
    // Limpieza: si algo falló, no dejar cabecera huérfana.
    await client.from('detalle_ventas').delete().eq('venta_id', String(headerRow.id))
    await client.from('ventas').delete().eq('id', String(headerRow.id))
    throw error
  }
  return toRecord('sales', headerRow)
}

type CatalogRow = { id: string; nombre: string; detalle: string; costo: number; producto_id: string | null }

async function getCatalogRows(ids: string[]): Promise<Map<string, CatalogRow>> {
  const unique = [...new Set(ids)]
  if (!unique.length) return new Map()
  const { data, error } = await requireSupabase()
    .from('proveedor_productos')
    .select('id, nombre, detalle, costo, producto_id')
    .in('id', unique)
  if (error) throw error
  return new Map(
    (data as Array<{ id: string; nombre: string; detalle: string; costo: number; producto_id: string | null }>).map((row) => [
      row.id,
      { id: row.id, nombre: String(row.nombre), detalle: String(row.detalle ?? ''), costo: Number(row.costo), producto_id: row.producto_id },
    ]),
  )
}

async function assertCatalogLines(lines: LineInput[]): Promise<Map<string, CatalogRow>> {
  const catalog = await getCatalogRows(lines.map((line) => line.producto_id))
  for (const line of lines) {
    if (!catalog.has(line.producto_id)) throw new Error('Un producto del catálogo ya no existe. Recarga y vuelve a elegir.')
  }
  return catalog
}

/**
 * Ingresa unidades a MI inventario desde el catálogo del proveedor: si el
 * producto ya existe suma stock; si es nuevo lo crea (precio inicial = costo)
 * y lo vincula para futuras compras. El kardex se genera solo por trigger.
 */
async function ingressCatalogLines(lines: LineInput[], catalog: Map<string, CatalogRow>): Promise<void> {
  for (const line of lines) {
    const entry = catalog.get(line.producto_id)
    if (!entry) throw new Error('Un producto del catálogo ya no existe. Recarga y vuelve a elegir.')
    if (entry.producto_id) {
      const stocks = await getStocks([entry.producto_id])
      await setStock(entry.producto_id, (stocks.get(entry.producto_id) ?? 0) + line.cantidad)
    } else {
      const { data, error } = await requireSupabase()
        .from('productos')
        .insert({
          nombre: entry.nombre,
          detalle: entry.detalle || `Ingresado por compra · ${entry.nombre}`,
          stock: line.cantidad,
          precio: line.precio,
          estado: 'Estable',
        })
        .select('*')
        .single()
      if (error) throw error
      const newId = String((data as Row).id)
      const { error: linkError } = await requireSupabase()
        .from('proveedor_productos')
        .update({ producto_id: newId })
        .eq('id', entry.id)
      if (linkError) throw linkError
      entry.producto_id = newId
    }
  }
}

/** Revierte un ingreso previo (al reabrir una compra completada). */
async function revertCatalogLines(lines: LineInput[], catalog: Map<string, CatalogRow>): Promise<void> {
  const mapped = lines.filter((line) => catalog.get(line.producto_id)?.producto_id)
  const labels = await getProductLabels(mapped.map((line) => catalog.get(line.producto_id)?.producto_id as string))
  for (const line of lines) {
    const entry = catalog.get(line.producto_id)
    if (!entry?.producto_id) continue
    const stocks = await getStocks([entry.producto_id])
    const available = stocks.get(entry.producto_id) ?? 0
    if (line.cantidad > available) {
      const name = labels.get(entry.producto_id) ?? entry.nombre
      throw new Error(`No se puede reabrir: "${name}" solo tiene ${available} und. en inventario (parte ya se vendió).`)
    }
    await setStock(entry.producto_id, available - line.cantidad)
  }
}

export async function insertPurchaseWithLines(input: RecordInput, lines: LineInput[]): Promise<RecordItem> {
  assertValidLines(lines)
  const client = requireSupabase()
  const total = lines.length ? lineTotal(lines) : (input.amount ?? 0)
  const headerInput: RecordInput = { ...input, amount: total }
  // Las líneas referencian al CATÁLOGO del proveedor, no a mi inventario.
  const catalog = await assertCatalogLines(lines)

  const { data: header, error: headerError } = await client.from('compras').insert(toRow('purchases', headerInput)).select('*').single()
  if (headerError) throw headerError
  const headerRow = header as Row

  // El inventario solo se mueve al llegar a Recepción (o más): mientras la orden
  // está en Solicitud u Orden, las unidades están "por ingresar".
  const ingressNow = purchaseHasStock(input.status)
  // La cuenta por pagar incluye IGV (total a pagar al proveedor).
  const pagoTotal = totalWithIgv(total)
  try {
    if (lines.length) {
      const { error: linesError } = await client.from('detalle_compras').insert(
        lines.map((line) => ({
          compra_id: String(headerRow.id),
          proveedor_producto_id: line.producto_id,
          cantidad: line.cantidad,
          costo_unitario: line.precio,
        })),
      )
      if (linesError) throw linesError
      if (ingressNow) await ingressCatalogLines(lines, catalog)
    }
    await createRelatedPago('purchase', headerRow, pagoTotal, input.status)
  } catch (error) {
    await client.from('detalle_compras').delete().eq('compra_id', String(headerRow.id))
    await client.from('compras').delete().eq('id', String(headerRow.id))
    throw error
  }
  return toRecord('purchases', headerRow)
}

export async function updateSaleWithLines(code: string, input: RecordInput, lines: LineInput[]): Promise<RecordItem> {
  assertValidLines(lines)
  const client = requireSupabase()
  const { data: current, error: currentError } = await client.from('ventas').select('*').eq('codigo', code).single()
  if (currentError) throw currentError
  const headerId = String((current as Row).id)
  const oldLines = await fetchDocumentLines('sales', headerId)

  // Restaura el stock anterior antes de validar el nuevo (edición = devolución + nueva salida).
  const oldStocks = await getStocks(oldLines.map((line) => line.producto_id))
  const restored = new Map<string, number>()
  for (const line of oldLines) {
    restored.set(line.producto_id, (oldStocks.get(line.producto_id) ?? 0) + line.cantidad)
  }
  const newStocks = await getStocks(lines.map((line) => line.producto_id))
  const effective = new Map<string, number>()
  for (const [id, stock] of newStocks) effective.set(id, stock)
  for (const [id, stock] of restored) {
    if (!effective.has(id)) {
      const { data } = await client.from('productos').select('stock').eq('id', id).single()
      effective.set(id, Number((data as { stock: number } | null)?.stock ?? stock))
    } else if (!lines.some((line) => line.producto_id === id)) {
      effective.set(id, stock)
    } else {
      // El producto está en ambas listas: parte del stock restaurado.
      const oldQty = oldLines.filter((l) => l.producto_id === id).reduce((s, l) => s + l.cantidad, 0)
      effective.set(id, (newStocks.get(id) ?? 0) + oldQty)
    }
  }
  const editLabels = await getProductLabels(lines.map((line) => line.producto_id))
  for (const line of lines) {
    const available = effective.get(line.producto_id) ?? 0
    if (line.cantidad > available) {
      const name = editLabels.get(line.producto_id) ?? line.producto_id
      throw new Error(`Stock insuficiente para ${name}: disponible ${available}, pedido ${line.cantidad}. Reduce la cantidad.`)
    }
  }

  const discount = lines.length ? Math.min(100, Math.max(0, Number(input.descuento ?? (current as Row).descuento ?? 0) || 0)) : 0
  const total = salePayableTotal(lineTotal(lines), discount, input.amount ?? Number((current as Row).monto ?? 0), lines.length > 0)
  const { data: updated, error: updateError } = await client
    .from('ventas')
    .update(toRow('sales', { ...input, descuento: discount, amount: total }))
    .eq('codigo', code)
    .select('*')
    .single()
  if (updateError) throw updateError

  if (!sameLines(oldLines, lines)) {
    const deleted = await client.from('detalle_ventas').delete().eq('venta_id', headerId).select('id')
    if (deleted.error) throw deleted.error
    if (oldLines.length && deleted.data.length < oldLines.length) throw new Error('Tu rol necesita permiso de eliminar líneas de venta para editar sus productos.')
  }
  // Aplica restauración + descuento como movimientos netos por producto.
  const deltas = new Map<string, number>()
  for (const line of oldLines) deltas.set(line.producto_id, (deltas.get(line.producto_id) ?? 0) + line.cantidad)
  for (const line of lines) deltas.set(line.producto_id, (deltas.get(line.producto_id) ?? 0) - line.cantidad)
  for (const [producto_id, delta] of deltas) {
    if (!delta) continue
    const { data } = await client.from('productos').select('stock').eq('id', producto_id).single()
    const currentStock = Number((data as { stock: number } | null)?.stock ?? 0)
    await setStock(producto_id, currentStock + delta)
  }
  if (lines.length && !sameLines(oldLines, lines)) {
    const { error: linesError } = await client.from('detalle_ventas').insert(
      lines.map((line) => ({ venta_id: headerId, producto_id: line.producto_id, cantidad: line.cantidad, precio_unitario: line.precio })),
    )
    if (linesError) throw linesError
  }
  await syncRelatedPago('sale', headerId, total, input.status, input.medio_pago)
  return toRecord('sales', updated as Row)
}

export async function updatePurchaseWithLines(code: string, input: RecordInput, lines: LineInput[]): Promise<RecordItem> {
  assertValidLines(lines)
  const client = requireSupabase()
  const { data: current, error: currentError } = await client.from('compras').select('*').eq('codigo', code).single()
  if (currentError) throw currentError
  const headerId = String((current as Row).id)
  const hadStock = purchaseHasStock(String((current as Row).estado))
  const hasStock = purchaseHasStock(input.status)
  const oldLines = await fetchDocumentLines('purchases', headerId)
  // Las líneas (viejas y nuevas) referencian al catálogo del proveedor.
  const catalog = await assertCatalogLines([...oldLines, ...lines].map((line) => ({ producto_id: line.producto_id, cantidad: 1, precio: 0 })))
  const total = lines.length ? lineTotal(lines) : (input.amount ?? Number((current as Row).monto ?? 0))
  const pagoTotal = totalWithIgv(total)

  const { data: updated, error: updateError } = await client
    .from('compras')
    .update(toRow('purchases', { ...input, amount: total }))
    .eq('codigo', code)
    .select('*')
    .single()
  if (updateError) throw updateError

  if (!sameLines(oldLines, lines)) {
    const deleted = await client.from('detalle_compras').delete().eq('compra_id', headerId).select('id')
    if (deleted.error) throw deleted.error
    if (oldLines.length && deleted.data.length < oldLines.length) throw new Error('Tu rol necesita permiso de eliminar líneas de compra para editar sus productos.')
  }
  // Ingreso a MI inventario según transición de fase (las líneas son del catálogo):
  // - sin stock→con stock (ej. Orden→Recepción): ingresa lo nuevo.
  // - con stock→sin stock: revierte lo anterior (valida que no se haya vendido).
  // - con stock→con stock: ajusta la diferencia por ítem del catálogo.
  // - sin stock→sin stock: sin movimiento (seguimiento puro).
  if (!hadStock && hasStock) {
    await ingressCatalogLines(lines, catalog)
  } else if (hadStock && !hasStock) {
    await revertCatalogLines(oldLines, catalog)
  } else if (hadStock && hasStock) {
    const deltas = new Map<string, number>()
    for (const line of oldLines) deltas.set(line.producto_id, (deltas.get(line.producto_id) ?? 0) - line.cantidad)
    for (const line of lines) deltas.set(line.producto_id, (deltas.get(line.producto_id) ?? 0) + line.cantidad)
    for (const [catalogId, delta] of deltas) {
      if (!delta) continue
      const entry = catalog.get(catalogId)
      if (!entry) throw new Error('Un producto del catálogo ya no existe. Recarga y vuelve a elegir.')
      if (entry.producto_id) {
        const stocks = await getStocks([entry.producto_id])
        await setStock(entry.producto_id, (stocks.get(entry.producto_id) ?? 0) + delta)
      } else if (delta > 0) {
        await ingressCatalogLines([{ producto_id: catalogId, cantidad: delta, precio: lines.find((l) => l.producto_id === catalogId)?.precio ?? entry.costo }], catalog)
      } else {
        throw new Error(`No se puede ajustar "${entry.nombre}": aún no ingresa a inventario.`)
      }
    }
  }
  if (lines.length && !sameLines(oldLines, lines)) {
    const { error: linesError } = await client.from('detalle_compras').insert(
      lines.map((line) => ({ compra_id: headerId, proveedor_producto_id: line.producto_id, cantidad: line.cantidad, costo_unitario: line.precio })),
    )
    if (linesError) throw linesError
  }
  const previous = current as Row
  const paymentStateChanged = (input.status === 'Pagada') !== (String(previous.estado) === 'Pagada')
  if (total !== Number(previous.monto) || paymentStateChanged || input.name !== String(previous.proveedor_nombre)) {
    await syncRelatedPago('purchase', headerId, pagoTotal, input.status)
  }
  return toRecord('purchases', updated as Row)
}

// -----------------------------------------------------------------------------
// Cotizaciones: cabecera + líneas con precio fijo. No mueven stock ni generan
// cobranza por sí solas; eso ocurre al convertirlas en venta.
// -----------------------------------------------------------------------------

export async function insertQuoteWithLines(input: RecordInput, lines: LineInput[]): Promise<RecordItem> {
  assertValidLines(lines)
  const client = requireSupabase()
  const total = lines.length ? lineTotal(lines) : (input.amount ?? 0)
  const { data: header, error: headerError } = await client.from('cotizaciones').insert(toRow('quotes', { ...input, amount: total })).select('*').single()
  if (headerError) throw headerError
  const headerRow = header as Row
  try {
    if (lines.length) {
      const { error: linesError } = await client.from('detalle_cotizaciones').insert(
        lines.map((line) => ({
          cotizacion_id: String(headerRow.id),
          producto_id: line.producto_id,
          cantidad: line.cantidad,
          precio_unitario: line.precio,
        })),
      )
      if (linesError) throw linesError
    }
  } catch (error) {
    await client.from('detalle_cotizaciones').delete().eq('cotizacion_id', String(headerRow.id))
    await client.from('cotizaciones').delete().eq('id', String(headerRow.id))
    throw error
  }
  return toRecord('quotes', headerRow)
}

export async function updateQuoteWithLines(code: string, input: RecordInput, lines: LineInput[]): Promise<RecordItem> {
  assertValidLines(lines)
  const client = requireSupabase()
  const { data: current, error: currentError } = await client.from('cotizaciones').select('*').eq('codigo', code).single()
  if (currentError) throw currentError
  const wasCompleted = String((current as Row).estado) === 'Completada'
  // Completada solo se alcanza convirtiendo en venta (genera stock y cobranza).
  if (!wasCompleted && input.status === 'Completada') {
    throw new Error('Para completar una cotización usa «Convertir en venta» desde la tabla.')
  }
  const headerId = String((current as Row).id)
  const total = lines.length ? lineTotal(lines) : (input.amount ?? Number((current as Row).monto ?? 0))
  const oldLines = await fetchDocumentLines('quotes', headerId)
  const { data: updated, error: updateError } = await client
    .from('cotizaciones')
    .update(toRow('quotes', { ...input, amount: total }))
    .eq('codigo', code)
    .select('*')
    .single()
  if (updateError) throw updateError
  if (!sameLines(oldLines, lines)) {
    const deleted = await client.from('detalle_cotizaciones').delete().eq('cotizacion_id', headerId).select('id')
    if (deleted.error) throw deleted.error
    if (oldLines.length && deleted.data.length < oldLines.length) throw new Error('Tu rol necesita permiso de eliminar líneas de cotización para editar sus productos.')
  }
  if (lines.length && !sameLines(oldLines, lines)) {
    const { error: linesError } = await client.from('detalle_cotizaciones').insert(
      lines.map((line) => ({ cotizacion_id: headerId, producto_id: line.producto_id, cantidad: line.cantidad, precio_unitario: line.precio })),
    )
    if (linesError) throw linesError
  }
  return toRecord('quotes', updated as Row)
}

/** Convierte una cotización aprobada/pendiente en venta: descuenta stock, genera CxC y la marca Completada. */
export async function convertQuoteToSale(code: string): Promise<{ sale: RecordItem }> {
  const client = requireSupabase()
  const { data: header, error: headerError } = await client.from('cotizaciones').select('*').eq('codigo', code).single()
  if (headerError) throw headerError
  const headerRow = header as Row
  const estado = String(headerRow.estado)
  if (estado === 'Completada') throw new Error('La cotización ya fue convertida en venta.')
  if (estado === 'Rechazada' || estado === 'Vencida') {
    throw new Error('Solo se pueden convertir cotizaciones pendientes, en curso o aprobadas.')
  }
  const headerId = String(headerRow.id)
  const quoteLines = await fetchDocumentLines('quotes', headerId)
  if (!quoteLines.length) throw new Error('La cotización no tiene productos para convertir.')
  const lines: LineInput[] = quoteLines.map((line) => ({ producto_id: line.producto_id, cantidad: line.cantidad, precio: line.precio }))
  const sale = await insertSaleWithLines(
    {
      name: String(headerRow.cliente_nombre),
      detail: `Convertida de ${code}${headerRow.detalle ? ` · ${String(headerRow.detalle)}` : ''}`,
      status: 'Pendiente',
      cliente_id: (headerRow.cliente_id as string | null) ?? null,
    },
    lines,
  )
  const { error: updateError } = await client.from('cotizaciones').update({ estado: 'Completada' }).eq('id', headerId)
  if (updateError) throw updateError
  return { sale }
}
