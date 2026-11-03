/** Evaluación capturada una vez por orden recibida; la edición conserva su fila. */
export interface SupplierOrderEvaluation {
  id: string
  compra_id: string
  proveedor_id: string
  calidad_producto: SupplierEvaluationScore
  cumplimiento_plazos: SupplierEvaluationScore
  nivel_servicio: SupplierEvaluationScore
  evaluado_por: string
  creado_en: string
  actualizado_en: string
}

/** Escala entera aprobada: 1 (deficiente) a 5 (excelente). */
export type SupplierEvaluationScore = 1 | 2 | 3 | 4 | 5

export interface SaveSupplierOrderEvaluationInput {
  compra_id: string
  calidad_producto: SupplierEvaluationScore
  cumplimiento_plazos: SupplierEvaluationScore
  nivel_servicio: SupplierEvaluationScore
}

/** Sin evaluaciones, la cantidad es cero y los promedios son null. */
export interface SupplierEvaluationSummary {
  proveedor_id: string
  cantidad_evaluaciones: number
  promedio_calidad: number | null
  promedio_plazos: number | null
  promedio_servicio: number | null
  promedio_global: number | null
}
