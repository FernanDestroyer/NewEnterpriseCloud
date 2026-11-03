export type ImportFolderStatus = 'Abierta' | 'En Tránsito' | 'En Aduanas' | 'Nacionalizado' | 'Cerrada'
export type ImportExpenseType = 'Flete' | 'Seguro' | 'Arancel/Advalorem' | 'Agente de Aduanas' | 'Otros'
export type ImportCurrency = 'USD'
export type ImportExpenseCurrency = 'USD' | 'PEN'

/** Dossier de importación. Los importes del primer alcance se expresan en USD. */
export interface ImportFolder {
  id: string
  codigo: string
  nombre: string
  referencia: string
  moneda: ImportCurrency
  estado: ImportFolderStatus
  estado_actualizado_por: string | null
  estado_actualizado_en: string | null
  estado_motivo: string | null
  creado_por: string
  creado_en: string
  updated_at: string
}

/** Vínculo inmutable de origen mientras esté asociado; la desvinculación es vía RPC. */
export interface ImportOrderLink {
  id: string
  carpeta_id: string
  compra_id: string
  codigo_orden: string
  proveedor_id: string
  moneda: ImportCurrency
  tipo_cambio: number
  vinculada_por: string
  vinculada_en: string
}

/** Gasto prorrateable ingresado en la moneda de la carpeta; no crea una CxP. */
export interface ImportExpense {
  id: string
  carpeta_id: string
  tipo: ImportExpenseType
  descripcion: string
  monto: number
  moneda: ImportExpenseCurrency
  /** PEN por USD cuando el gasto está en PEN; USD normaliza con 1. */
  tipo_cambio: number | null
  referencia: string
  idempotency_key: string
  creado_por: string
  creado_en: string
}

export type ImportFolderHistoryEvent = {
  id: string
  carpeta_id: string
  evento: 'Creada' | 'Orden vinculada' | 'Orden desvinculada' | 'Gasto registrado' | 'Estado actualizado' | 'Nacionalizada'
  actor_id: string
  compra_id: string | null
  gasto_id: string | null
  motivo: string | null
  datos: Record<string, unknown>
  idempotency_key: string | null
  created_at: string
}

/** Resultado de vista previa; todavía no es un costo persistido en inventario. */
export interface ImportLandedCostPreviewLine {
  carpeta_id: string
  compra_id: string
  codigo_orden: string
  detalle_compra_id: string
  producto_id: string
  descripcion: string
  cantidad: number
  valor_linea_usd: number
  peso_valor: number
  gasto_asignado_usd: number
  costo_real_linea_usd: number
  costo_unitario_real_usd: number
}

export interface CreateImportFolderInput {
  nombre: string
  referencia?: string
  idempotency_key: string
}

export interface LinkImportOrderInput {
  carpeta_id: string
  compra_id: string
  idempotency_key: string
}

export interface RegisterImportExpenseInput {
  carpeta_id: string
  tipo: ImportExpenseType
  descripcion: string
  monto: number
  moneda: ImportExpenseCurrency
  tipo_cambio?: number | null
  referencia?: string
  idempotency_key: string
}
