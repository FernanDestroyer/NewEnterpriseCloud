import type { LucideIcon } from 'lucide-react'

export type PageKey =
  | 'dashboard'
  | 'sales'
  | 'quotes'
  | 'purchases'
  | 'inventory'
  | 'customers'
  | 'suppliers'
  | 'finance'
  | 'documents'
  | 'reports'
  | 'settings'

export type DataPage = Exclude<PageKey, 'dashboard'>
export type Theme = 'dark' | 'light'
export type RecordStatus =
  | 'Activo'
  | 'Aprobada'
  | 'Bajo stock'
  | 'Completada'
  | 'Crítico'
  | 'En curso'
  | 'En tránsito'
  | 'Estable'
  | 'Factura'
  | 'Orden'
  | 'Pagada'
  | 'Pendiente'
  | 'Recepción'
  | 'Recibida'
  | 'Rechazada'
  | 'Solicitud'
  | 'Vencida'
  | 'Vigente'

export type RecordItem = {
  id: string
  /** UUID interno de Supabase (row.id). Necesario para usarlo como FK. */
  rowId?: string
  name: string
  detail: string
  date: string
  /** Fechas originales de PostgreSQL, utilizadas para filtros y analítica. */
  createdAt?: string
  updatedAt?: string
  dueAt?: string | null
  amount?: number
  quantity?: number
  /** Productos: precio de venta referencial. undefined = columna aún no migrada o sin definir. */
  precio?: number
  status: RecordStatus
  /** Ventas/Cotizaciones: UUID del cliente vinculado (clientes.id). NULL = sin vincular. */
  cliente_id?: string | null
  /** Compras: UUID del proveedor vinculado (proveedores.id). Catálogo: proveedor dueño. NULL = sin vincular. */
  proveedor_id?: string | null
  /** Catálogo: UUID de MI producto equivalente en inventario (null = aún no ingresa). */
  productoId?: string | null
  /** Proveedores: RUC de 11 dígitos. NULL = sin registrar. */
  ruc?: string | null
  /** Proveedores: dirección, correo, teléfono y condición de pago. NULL = sin registrar. */
  direccion?: string | null
  correo?: string | null
  telefono?: string | null
  formaPago?: string | null
  /** Clientes: tipo de documento (DNI o RUC). NULL = sin registrar. */
  tipoDoc?: 'DNI' | 'RUC' | null
  /** Clientes: número de documento (8 dígitos DNI u 11 dígitos RUC). NULL = sin registrar. */
  documento?: string | null
  /** Compras: fecha límite o aproximada (YYYY-MM-DD). */
  fechaLimite?: string | null
  /** Compras: comprobante de recepción (Factura, Boleta, Guía de Remisión, Nota de Venta). */
  comprobanteTipo?: string | null
  /** Compras: número del comprobante de recepción. */
  comprobanteNumero?: string | null
  /** Etiqueta legible del registro vinculado (razón social). Solo lectura. */
  relatedName?: string
  /** Código legible del registro vinculado (CLI-001 / PRV-082). Solo lectura. */
  relatedCode?: string
  financeType?: 'cobrar' | 'pagar' | null
  saleId?: string | null
  purchaseId?: string | null
  /** Finanzas: medio con que se canceló la cuenta. */
  medio?: string | null
  /** Ventas: descuento % aplicado al subtotal (0-100). */
  descuento?: number
  /** Ventas: tarjeta del cliente con la que se pagó (solo marca y últimos 4). */
  tarjetaId?: string | null
  tarjetaMarca?: string | null
  tarjetaUltimos4?: string | null
}

/** Línea de venta/compra: un producto del inventario en X cantidad y precio. */
export type DocumentLine = {
  /** UUID del producto (productos.id). */
  producto_id: string
  /** Código legible (PRD-001). Solo lectura. */
  codigo?: string
  /** Nombre del producto. Solo lectura. */
  nombre?: string
  /** Stock actual al momento de cargar el formulario. Solo lectura. */
  stock?: number
  cantidad: number
  /** Precio unitario (venta) o costo unitario (compra). */
  precio: number
}

export type RecordModalState = {
  page: DataPage
  record: RecordItem | null
}

export type PendingDelete = {
  page: DataPage
  record: RecordItem
}

export type ExportFormat = 'csv' | 'excel' | 'pdf'

export type PageMeta = {
  action: string
  amountLabel?: string
  description: string
  detailLabel: string
  eyebrow: string
  entityLabel: string
  icon: LucideIcon
  kind: 'file' | 'money' | 'settings' | 'stock'
  prefix: string
  title: string
}
