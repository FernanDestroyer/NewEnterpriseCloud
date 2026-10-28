import { requireSupabase } from '../lib/supabase'
import { salePayableTotal } from '../data/payments'
import { consumesCreditLine } from '../data/workspace'
import { DATA_PAGES } from '../data/catalog'
import { formatWhen, totalWithIgv } from '../data/helpers'
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
  categoria_id?: string | null
  unidad_medida_id?: string | null
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
  /** Ventas: almacén origen cuando la operación tiene líneas. */
  almacen_id?: string | null
  /** Ventas: turno asociado al cobro inmediato en efectivo. */
  cajaTurnoId?: string | null
  /** Metadatos de las operaciones transaccionales, no columnas editables. */
  idempotencyKey?: string
  quote_id?: string | null
  source?: 'manual' | 'import'
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
    item.almacenId = typeof row.almacen_id === 'string' ? row.almacen_id : null
    item.medio = typeof row.medio_pago === 'string' && row.medio_pago ? row.medio_pago : null
  }
  // Descuento de la venta (si su migración ya se ejecutó).
  if (page === 'sales') {
    if (typeof row.descuento === 'number') item.descuento = row.descuento
    else if ('descuento' in row) item.descuento = Number((row.descuento as number | null) ?? 0) || 0
  }
  if (config.amount && row[config.amount] !== null && row[config.amount] !== undefined) item.amount = Number(row[config.amount])
  if (page === 'finance' && row.monto !== null && row.monto !== undefined) item.obligationAmount = Number(row.monto)
  if (config.quantity && row[config.quantity] !== null && row[config.quantity] !== undefined) item.quantity = Number(row[config.quantity])
  if (page === 'purchases') {
    if (row.estado_recepcion === 'pendiente' || row.estado_recepcion === 'parcial' || row.estado_recepcion === 'completa') item.estadoRecepcion = row.estado_recepcion
    if (typeof row.requiere_recepcion === 'boolean') item.requiereRecepcion = row.requiere_recepcion
    if (typeof row.fecha_limite === 'string') item.fechaLimite = row.fecha_limite
    else if (row.fecha_limite === null) item.fechaLimite = null
    if (typeof row.comprobante_tipo === 'string') item.comprobanteTipo = row.comprobante_tipo
    else if (row.comprobante_tipo === null) item.comprobanteTipo = null
    if (typeof row.comprobante_numero === 'string') item.comprobanteNumero = row.comprobante_numero
    else if (row.comprobante_numero === null) item.comprobanteNumero = null
  }
  // Precio del producto (si la migración de precio ya se ejecutó).
  if (config.price && row[config.price] !== null && row[config.price] !== undefined) item.precio = Number(row[config.price])
  if (page === 'inventory') {
    item.categoriaId = typeof row.categoria_id === 'string' ? row.categoria_id : null
    item.unidadMedidaId = typeof row.unidad_medida_id === 'string' ? row.unidad_medida_id : null
  }
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
  if (page === 'sales' && input.almacen_id !== undefined) row.almacen_id = input.almacen_id
  if (config.amount && input.amount !== undefined) row[config.amount] = input.amount
  if (config.quantity && input.quantity !== undefined) row[config.quantity] = input.quantity
  if (config.price && input.precio !== undefined) row[config.price] = input.precio
  if (page === 'inventory') {
    if (input.categoria_id !== undefined) row.categoria_id = input.categoria_id
    if (input.unidad_medida_id !== undefined) row.unidad_medida_id = input.unidad_medida_id
  }
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
const PENDING_COLUMNS = ['ruc', 'precio', 'proveedor_id', 'tipo_doc', 'documento', 'direccion', 'correo', 'telefono', 'forma_pago', 'descuento', 'medio_pago', 'categoria_id', 'unidad_medida_id']

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
    if (/precio/i.test(haystack)) return 'La base de datos no tiene la columna de precio que necesita productos. Revisa el historial y aplica solo la migración aprobada antes de reintentar.'
    if (/\bruc\b/i.test(haystack)) return 'La base de datos no tiene la columna RUC que necesita proveedores. Revisa el historial y aplica solo la migración aprobada antes de reintentar.'
    if (/tipo_doc|documento/i.test(haystack)) return 'La base de datos no tiene las columnas de documento que necesita clientes. Revisa el historial y aplica solo la migración aprobada antes de reintentar.'
    if (/direccion|correo|telefono|forma_pago/i.test(haystack)) return 'La base de datos no tiene las columnas de contacto que necesita proveedores. Revisa el historial y aplica solo la migración aprobada antes de reintentar.'
    if (/descuento|medio_pago/i.test(haystack)) return 'La base de datos no tiene todas las columnas que necesita este flujo. Revisa el historial y aplica solo la migración aprobada antes de reintentar.'
    return 'La base de datos no tiene una columna que necesita este flujo. Revisa el historial y aplica solo la migración aprobada antes de reintentar.'
  }
  if (err?.code === '23503') return 'El cliente o proveedor seleccionado ya no existe. Elige otro de la lista.'
  if ((err?.code === '42P01' || err?.code === 'PGRST205') && /proveedor_productos|cotizacion/i.test(haystack)) {
    return 'La base de datos no tiene una tabla que necesita este flujo. Revisa el historial y aplica solo la migración aprobada antes de reintentar.'
  }
  if ((err?.code === '42P01' || err?.code === 'PGRST205') && /metodos_pago|caja_turnos/i.test(haystack)) {
    return 'La base de datos no tiene una tabla de Tesorería que necesita este flujo. Revisa el historial y aplica solo la migración aprobada antes de reintentar.'
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
  if (pages.includes('finance') && records.finance.length) {
    try {
      const accountIds = records.finance.flatMap(item => item.rowId ? [item.rowId] : [])
      const balances = await fetchAccountBalances(accountIds)
      records.finance = records.finance.map(item => {
        const balance = item.rowId ? balances.get(item.rowId) : undefined
        if (!balance) return item
        // Las cuentas cerradas antes del libro de tesorería siguen siendo históricas;
        // no se convierten en deuda nueva por no tener movimientos retroactivos.
        if (item.status === 'Completada' && balance.montoAplicado === 0) return item
        return { ...item, amount: balance.saldoPendiente, status: balance.saldoPendiente === 0 ? 'Completada' : balance.montoAplicado > 0 ? 'En curso' : item.status }
      })
    } catch (error) {
      errors.finance = friendlyError(error)
    }
  }
  return { records: enrichRelations(records), errors }
}

export async function fetchAllRecords(): Promise<Record<DataPage, RecordItem[]>> {
  const snapshot = await fetchRecordsSnapshot()
  const error = Object.values(snapshot.errors)[0]
  if (error) throw new Error(error)
  return snapshot.records
}

export async function insertRecord(page: DataPage, input: RecordInput): Promise<RecordItem> {
  if (page === 'inventory' && Number(input.quantity ?? 0) > 0) {
    const client = requireSupabase()
    const [inventory, opening] = await Promise.all([
      client.from('inventarios').select('id', { count: 'exact', head: true }),
      client.from('aperturas_inventario').select('id', { count: 'exact', head: true }),
    ])
    if (inventory.error) throw inventory.error
    if (opening.error) throw opening.error
    if ((inventory.count ?? 0) > 0 || (opening.count ?? 0) > 0) throw new Error('Después de abrir existencias por almacén, las altas con stock inicial se registran mediante un movimiento de inventario.')
  }
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
  if (page === 'inventory' && input.quantity !== undefined) {
    const client = requireSupabase()
    const [{ data: product, error: productError }, { count, error: inventoryError }, { count: openingCount, error: openingError }] = await Promise.all([
      client.from('productos').select('stock').eq('codigo', code).single(),
      client.from('inventarios').select('id', { count: 'exact', head: true }),
      client.from('aperturas_inventario').select('id', { count: 'exact', head: true }),
    ])
    if (productError) throw productError
    if (inventoryError) throw inventoryError
    if (openingError) throw openingError
    if (((count ?? 0) > 0 || (openingCount ?? 0) > 0) && Number((product as { stock: number }).stock) !== Number(input.quantity)) throw new Error('Con existencias por almacén, ajusta stock desde un movimiento de inventario; editar el producto solo cambia sus datos maestros.')
  }
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

/** Bitácora paginada; la política RLS limita la consulta a auditoria:ver. */
export type AuditEntry = { id: number; email: string | null; accion: string; modulo: string; registro: string | null; resultado: string; createdAt: string }
export type AuditTrailPage = { entries: AuditEntry[]; total: number }

export async function fetchAuditTrail(input: { limit?: number; offset?: number; modulo?: string; accion?: string } = {}): Promise<AuditTrailPage> {
  const limit = Math.max(1, Math.min(100, Math.trunc(input.limit ?? 50)))
  const offset = Math.max(0, Math.trunc(input.offset ?? 0))
  let query = requireSupabase()
    .from('auditoria')
    .select('id, usuario_email, accion, modulo, registro_id, resultado, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(offset, offset + limit - 1)
  if (input.modulo) query = query.eq('modulo', input.modulo)
  if (input.accion) query = query.eq('accion', input.accion)
  const { data, error, count } = await query
  if (error) throw error
  return { entries: ((data ?? []) as Row[]).map((row) => ({
    id: Number(row.id),
    email: typeof row.usuario_email === 'string' ? row.usuario_email : null,
    accion: String(row.accion ?? ''),
    modulo: String(row.modulo ?? ''),
    registro: typeof row.registro_id === 'string' ? row.registro_id : null,
    resultado: String(row.resultado ?? ''),
    createdAt: typeof row.created_at === 'string' ? row.created_at : '',
  })), total: count ?? 0 }
}

export async function fetchAuditModules(): Promise<string[]> {
  const { data, error } = await requireSupabase().from('auditoria').select('modulo').order('modulo').limit(1000)
  if (error) throw error
  return [...new Set((data ?? []).map(row => String(row.modulo ?? '')).filter(Boolean))]
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
    .select('id, proveedor_producto_id, cantidad, costo_unitario, proveedor_productos(codigo, nombre)')
    .eq('compra_id', docRowId)
  if (error) throw error
  return (data as unknown as Array<{ id: string; proveedor_producto_id: string | null; cantidad: number; costo_unitario: number; proveedor_productos: { codigo: string; nombre: string } | null }>)
    .filter((row) => row.proveedor_producto_id)
    .map((row) => ({
      rowId: row.id,
      producto_id: row.proveedor_producto_id as string,
      cantidad: Number(row.cantidad),
      precio: Number(row.costo_unitario),
      codigo: row.proveedor_productos?.codigo,
      nombre: row.proveedor_productos?.nombre,
    }))
}

export type PurchaseReceiptInputLine = { detalle_compra_id: string; cantidad: number }
export type ActiveWarehouse = { id: string; nombre: string; sucursal_id: string }

export async function fetchActiveWarehouses(): Promise<ActiveWarehouse[]> {
  const { data, error } = await requireSupabase()
    .from('almacenes').select('id,nombre,sucursal_id').eq('activo', true).order('nombre')
  if (error) throw error
  return (data ?? []) as ActiveWarehouse[]
}

export async function fetchWarehouseStocks(almacenId: string): Promise<Map<string, number>> {
  const { data, error } = await requireSupabase().from('inventarios').select('producto_id,cantidad').eq('almacen_id', almacenId)
  if (error) throw error
  return new Map(((data ?? []) as Array<{ producto_id: string; cantidad: number }>).map(row => [row.producto_id, Number(row.cantidad)]))
}

export async function fetchPurchaseReceiptProgress(compraId: string): Promise<Map<string, number>> {
  const client = requireSupabase()
  const { data: receipts, error: receiptsError } = await client.from('recepciones_compra').select('id').eq('compra_id', compraId)
  if (receiptsError) throw receiptsError
  const ids = (receipts ?? []).map(row => String((row as { id: string }).id))
  if (!ids.length) return new Map()
  const { data, error } = await client.from('detalle_recepciones_compra').select('detalle_compra_id,cantidad').in('recepcion_id', ids)
  if (error) throw error
  const progress = new Map<string, number>()
  for (const row of (data ?? []) as Array<{ detalle_compra_id: string; cantidad: number }>) {
    progress.set(row.detalle_compra_id, (progress.get(row.detalle_compra_id) ?? 0) + Number(row.cantidad))
  }
  return progress
}

export async function registerPurchaseReceipt(input: {
  compraId: string
  almacenId: string
  lineas: PurchaseReceiptInputLine[]
  idempotencyKey: string
  comprobanteTipo?: string | null
  comprobanteNumero?: string | null
}): Promise<string> {
  const { data, error } = await requireSupabase().rpc('registrar_recepcion_compra', {
    p_compra_id: input.compraId,
    p_almacen_id: input.almacenId,
    p_lineas: input.lineas,
    p_idempotency_key: input.idempotencyKey,
    p_comprobante_tipo: input.comprobanteTipo ?? null,
    p_comprobante_numero: input.comprobanteNumero ?? null,
    p_referencia: null,
  })
  if (error) throw error
  return String(data)
}

export type AccountBalance = { montoOriginal: number; montoAplicado: number; saldoPendiente: number }

export async function fetchAccountBalances(accountIds: string[]): Promise<Map<string, AccountBalance>> {
  const ids = [...new Set(accountIds)]
  if (!ids.length) return new Map()
  const { data, error } = await requireSupabase().rpc('obtener_saldos_cuentas', { p_cuenta_ids: ids })
  if (error) throw error
  return new Map(((data ?? []) as Array<{ cuenta_id: string; monto_original: number; monto_aplicado: number; saldo_pendiente: number }>).map(row => [row.cuenta_id, {
    montoOriginal: Number(row.monto_original),
    montoAplicado: Number(row.monto_aplicado),
    saldoPendiente: Number(row.saldo_pendiente),
  }]))
}

export async function fetchAccountOutstanding(pagoId: string): Promise<number> {
  const balances = await fetchAccountBalances([pagoId])
  const balance = balances.get(pagoId)
  if (!balance) throw new Error('No se pudo calcular el saldo pendiente de la cuenta.')
  return balance.saldoPendiente
}

export async function registerTreasuryPayment(input: {
  accountId: string
  type: 'cobro' | 'pago'
  amount: number
  method: string
  idempotencyKey: string
  note?: string
  cashShiftId?: string | null
}): Promise<string> {
  const { data, error } = await requireSupabase().rpc('registrar_pago_parcial_en_turno', {
    p_tipo: input.type,
    p_monto: input.amount,
    p_medio_pago: input.method,
    p_referencia: null,
    p_aplicaciones: [{ cuenta_id: input.accountId, monto: input.amount }],
    p_idempotency_key: input.idempotencyKey,
    p_nota: input.note ?? null,
    p_caja_turno_id: input.cashShiftId ?? null,
  })
  if (error) throw error
  return String(data)
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

export type ProductCategory = { id: string; nombre: string; descripcion: string; activo: boolean }
export type MeasurementUnit = { id: string; codigo: string; nombre: string; simbolo: string; precisionDecimales: number; activo: boolean }

export async function fetchProductCategories(): Promise<ProductCategory[]> {
  const { data, error } = await requireSupabase().from('categorias').select('id,nombre,descripcion,activo').order('nombre')
  if (error) throw error
  return ((data ?? []) as Array<{ id: string; nombre: string; descripcion: string | null; activo: boolean }>).map(row => ({
    id: row.id,
    nombre: row.nombre,
    descripcion: row.descripcion ?? '',
    activo: Boolean(row.activo),
  }))
}

export async function saveProductCategory(input: { nombre: string; descripcion: string }): Promise<void> {
  const nombre = input.nombre.trim()
  if (nombre.length < 2) throw new Error('La categoría necesita al menos 2 caracteres.')
  const { error } = await requireSupabase().from('categorias').insert({ nombre, descripcion: input.descripcion.trim() || null })
  if (error) throw error
}

export async function setProductCategoryActive(id: string, activo: boolean): Promise<void> {
  const { error } = await requireSupabase().from('categorias').update({ activo }).eq('id', id)
  if (error) throw error
}

export async function fetchMeasurementUnits(): Promise<MeasurementUnit[]> {
  const { data, error } = await requireSupabase().from('unidades_medida').select('id,codigo,nombre,simbolo,precision_decimales,activo').order('nombre')
  if (error) throw error
  return ((data ?? []) as Array<{ id: string; codigo: string; nombre: string; simbolo: string; precision_decimales: number; activo: boolean }>).map(row => ({
    id: row.id,
    codigo: row.codigo,
    nombre: row.nombre,
    simbolo: row.simbolo,
    precisionDecimales: Number(row.precision_decimales),
    activo: Boolean(row.activo),
  }))
}

export async function saveMeasurementUnit(input: { codigo: string; nombre: string; simbolo: string }): Promise<void> {
  const codigo = input.codigo.trim().toUpperCase()
  const nombre = input.nombre.trim()
  const simbolo = input.simbolo.trim()
  if (!/^[A-Z0-9_-]{2,12}$/.test(codigo)) throw new Error('El código debe tener 2 a 12 caracteres alfanuméricos.')
  if (nombre.length < 2) throw new Error('La unidad necesita un nombre de al menos 2 caracteres.')
  if (!simbolo || simbolo.length > 12) throw new Error('El símbolo es obligatorio y debe tener hasta 12 caracteres.')
  const { error } = await requireSupabase().from('unidades_medida').insert({ codigo, nombre, simbolo, precision_decimales: 0 })
  if (error) throw error
}

export async function setMeasurementUnitActive(id: string, activo: boolean): Promise<void> {
  const { error } = await requireSupabase().from('unidades_medida').update({ activo }).eq('id', id)
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
  const isCreditSale = isSale && consumesCreditLine(String(header.medio_pago ?? ''))
  const pagoEstado: RecordStatus = isCreditSale ? 'Pendiente' : estado === 'Completada' || estado === 'Pagada' ? 'Completada' : estado === 'En curso' || estado === 'En tránsito' ? 'En curso' : 'Pendiente'
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
  const isCreditSale = kind === 'sale' && consumesCreditLine(medioPago)
  const nextEstado = isCreditSale ? existing.estado : estado === 'Completada' || estado === 'Pagada' ? 'Completada' : existing.estado
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
  const discount = lines.length ? Math.min(100, Math.max(0, Number(input.descuento) || 0)) : 0
  const total = salePayableTotal(lineTotal(lines), discount, input.amount ?? 0, lines.length > 0)
  const idempotencyKey = input.idempotencyKey || `venta:${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`
  if (lines.length && !input.almacen_id) throw new Error('Selecciona el almacén del que saldrá el stock.')

  // Las importaciones sin detalle conservan su código y fecha históricos. No
  // crean movimientos actuales de caja ni pretenden inventar líneas/almacén.
  if (input.source === 'import' && !lines.length) {
    const { data: header, error } = await client.from('ventas').insert(toRow('sales', { ...input, descuento: discount, amount: total })).select('*').single()
    if (error) throw error
    const row = header as Row
    await createRelatedPago('sale', row, total, input.status)
    return toRecord('sales', row)
  }

  let cashShiftId: string | null = null
  if (input.status === 'Completada' && (input.medio_pago ?? '').trim().toLocaleLowerCase('es') === 'efectivo') {
    if (!input.cajaTurnoId) throw new Error('Selecciona una caja con turno abierto para registrar el cobro en efectivo.')
    const { data, error } = await client.from('caja_turnos').select('id').eq('id', input.cajaTurnoId).eq('estado', 'Abierto').maybeSingle()
    if (error) throw error
    if (!data) throw new Error('La caja elegida ya no tiene un turno abierto. Actualiza las cajas y vuelve a intentarlo.')
    cashShiftId = String((data as { id: string }).id)
  }

  const { data: saleId, error: saleError } = await client.rpc('registrar_venta_operativa', {
    p_cliente_id: input.cliente_id ?? null,
    p_cliente_nombre: input.name,
    p_detalle: input.detail,
    p_estado: input.status,
    p_monto_manual: input.amount ?? 0,
    p_descuento: discount,
    p_medio_pago: input.medio_pago ?? null,
    p_almacen_id: input.almacen_id ?? null,
    p_lineas: lines.map(line => ({ producto_id: line.producto_id, cantidad: line.cantidad, precio: line.precio })),
    p_idempotency_key: idempotencyKey,
    p_caja_turno_id: cashShiftId,
    p_cotizacion_id: input.quote_id ?? null,
  })
  if (saleError) throw saleError
  const { data: header, error: headerError } = await client.from('ventas').select('*').eq('id', String(saleId)).single()
  if (headerError) throw headerError
  return toRecord('sales', header as Row)
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

export async function insertPurchaseWithLines(input: RecordInput, lines: LineInput[]): Promise<RecordItem> {
  assertValidLines(lines)
  const client = requireSupabase()
  const total = lines.length ? lineTotal(lines) : (input.amount ?? 0)
  const headerInput: RecordInput = { ...input, amount: total }

  // Las órdenes ingresadas desde el formulario se registran atómicamente.
  // Las importaciones históricas conservan su código y flujo de legado.
  if (input.source !== 'import' && !input.reference) {
    if (!input.proveedor_id) throw new Error('Selecciona un proveedor registrado para crear la orden.')
    if (!input.idempotencyKey) throw new Error('No se pudo identificar esta solicitud. Cierra y vuelve a abrir el formulario.')
    const { data: purchaseId, error } = await client.rpc('crear_orden_compra_operativa', {
      p_proveedor_id: input.proveedor_id,
      p_detalle: input.detail,
      p_fecha_limite: input.fecha_limite || null,
      p_monto_manual: input.amount ?? 0,
      p_lineas: lines.map(line => ({ producto_id: line.producto_id, cantidad: line.cantidad, precio: line.precio })),
      p_idempotency_key: input.idempotencyKey,
    })
    if (error) throw error
    const { data: header, error: readError } = await client.from('compras').select('*').eq('id', String(purchaseId)).single()
    if (readError) throw readError
    return toRecord('purchases', header as Row)
  }

  // Las líneas referencian al CATÁLOGO del proveedor, no a mi inventario.
  await assertCatalogLines(lines)

  const { data: header, error: headerError } = await client.from('compras').insert(toRow('purchases', headerInput)).select('*').single()
  if (headerError) throw headerError
  const headerRow = header as Row

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
  const { count: warehouseStockCount, error: warehouseStockError } = await client.from('inventarios').select('id', { count: 'exact', head: true })
  if (warehouseStockError) throw warehouseStockError
  if ((warehouseStockCount ?? 0) > 0) throw new Error('Las ventas vinculadas a existencias por almacén no se editan hasta habilitar el flujo de reversa. Usa la gestión de devoluciones cuando esté disponible.')
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
  const oldLines = await fetchDocumentLines('purchases', headerId)
  // La recepción es un movimiento separado. Una orden con recepciones no puede
  // cambiar cantidades ni productos y nunca suma stock al editar su estado.
  const { count: receiptCount, error: receiptError } = await client.from('recepciones_compra').select('id', { count: 'exact', head: true }).eq('compra_id', headerId)
  if (receiptError) throw receiptError
  if ((receiptCount ?? 0) > 0 && !sameLines(oldLines, lines)) throw new Error('La orden ya tiene recepciones registradas. Conserva sus líneas y registra los ajustes con una devolución o recepción adicional.')
  if (input.status === 'Pagada' && String((current as Row).estado) !== 'Pagada') throw new Error('No marques la orden como pagada desde Compras. Registra el pago y su aplicación en Tesorería.')
  await assertCatalogLines([...oldLines, ...lines].map((line) => ({ producto_id: line.producto_id, cantidad: 1, precio: 0 })))
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
  if (lines.length && !sameLines(oldLines, lines)) {
    const { error: linesError } = await client.from('detalle_compras').insert(
      lines.map((line) => ({ compra_id: headerId, proveedor_producto_id: line.producto_id, cantidad: line.cantidad, costo_unitario: line.precio })),
    )
    if (linesError) throw linesError
  }
  const previous = current as Row
  if (total !== Number(previous.monto) || input.name !== String(previous.proveedor_nombre)) {
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
export async function convertQuoteToSale(code: string, warehouseId: string, idempotencyKey: string): Promise<{ sale: RecordItem }> {
  const client = requireSupabase()
  const { data: quote, error } = await client.from('cotizaciones').select('id').eq('codigo', code).single()
  if (error) throw error
  const sale = await insertSaleWithLines({
    name: '', detail: '', status: 'Pendiente', amount: 0,
    almacen_id: warehouseId, quote_id: String((quote as { id: string }).id), idempotencyKey,
  }, [])
  return { sale }
}
