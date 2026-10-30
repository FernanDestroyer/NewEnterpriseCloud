export type PurchaseContractStatus = 'Borrador' | 'Activo' | 'Suspendido' | 'Cerrado'
export type PurchaseContractVersionStatus = 'Borrador' | 'Activa' | 'Reemplazada'
export type PurchaseContractCurrency = 'PEN' | 'USD'
export type PurchaseContractTaxTreatment = 'Gravado' | 'Exonerado' | 'Inafecto'

/** Cabecera del contrato marco; la configuración económica vive en sus versiones. */
export interface PurchaseContract {
  id: string
  codigo: string
  proveedor_id: string
  responsable_id: string
  nombre: string
  detalle: string
  estado: PurchaseContractStatus
  version_actual_id: string | null
  creado_por: string
  creado_en: string
  activado_por: string | null
  activado_en: string | null
  suspendido_por: string | null
  suspendido_en: string | null
  suspension_motivo: string | null
  cerrado_por: string | null
  cerrado_en: string | null
  cierre_motivo: string | null
  updated_at: string
}

/** Snapshot inmutable de topes, moneda, vigencia y condiciones de una versión. */
export interface PurchaseContractVersion {
  id: string
  contrato_id: string
  proveedor_id: string
  numero_version: number
  estado: PurchaseContractVersionStatus
  fecha_inicio: string
  fecha_fin: string
  moneda: PurchaseContractCurrency
  /** Tope total bruto (incluye impuestos), en la moneda del contrato. */
  monto_tope: number
  condiciones: string
  creado_por: string
  creado_en: string
  activado_por: string | null
  activado_en: string | null
}

/** Topes y condiciones económicas preservados por versión contractual. */
export interface PurchaseContractLine {
  id: string
  contrato_id: string
  version_id: string
  proveedor_id: string
  proveedor_producto_id: string
  unidad_medida_id: string | null
  unidad: string
  descripcion: string
  /** Máximo de unidades/liberaciones permitido para esta línea (tolerancia 0%). */
  cantidad_tope: number
  costo_unitario: number
  tratamiento_tributario: PurchaseContractTaxTreatment
  tasa_tributaria: number
  condiciones: string
  creado_por: string
  creado_en: string
}

export interface PurchaseContractLineInput {
  proveedor_producto_id: string
  unidad_medida_id?: string | null
  unidad: string
  descripcion: string
  cantidad_tope: number
  costo_unitario: number
  tratamiento_tributario: PurchaseContractTaxTreatment
  tasa_tributaria: number
  condiciones?: string
}

export interface CreatePurchaseContractInput {
  proveedor_id: string
  responsable_id: string
  nombre: string
  detalle?: string
  fecha_inicio: string
  fecha_fin: string
  moneda: PurchaseContractCurrency
  monto_tope: number
  condiciones?: string
  lineas: PurchaseContractLineInput[]
  idempotency_key: string
}

export interface CreatePurchaseContractVersionInput {
  contrato_id: string
  fecha_inicio: string
  fecha_fin: string
  moneda: PurchaseContractCurrency
  monto_tope: number
  condiciones?: string
  lineas: PurchaseContractLineInput[]
  motivo: string
  idempotency_key: string
}

export interface PurchaseContractHistoryEvent {
  id: string
  contrato_id: string
  version_id: string | null
  evento: 'Creado' | 'Nueva versión' | 'Activado' | 'Suspendido' | 'Cerrado'
  actor_id: string
  motivo: string | null
  datos: Record<string, unknown>
  idempotency_key: string | null
  created_at: string
}
