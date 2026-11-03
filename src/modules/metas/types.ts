// Tipos del módulo de Metas y Objetivos. Sin dependencias de React ni de Supabase.
// Modelo según Módulo 08 del PDF de arquitectura (8.1–8.7), condensado en 3 submódulos.

/** Tipo de indicador que mide la meta (8.1: tipo_indicador / unidad_medida). */
export type IndicadorMeta = 'importe' | 'unidades'

/** Alcance de una asignación (8.2 vendedor, 8.3 sucursal/equipo, 8.4 producto/categoría). */
export type AlcanceMeta = 'vendedor' | 'sucursal' | 'producto'

/** Estado de la meta; las cerradas conservan versión y resultados del periodo. */
export type EstadoMeta = 'vigente' | 'cerrada' | 'inactiva'

export type EstadoAsignacion = 'activa' | 'inactiva'

export type Meta = {
  id: string
  /** Código único, p. ej. META-001. Se genera automáticamente si se deja vacío. */
  codigo: string
  nombre: string
  indicador: IndicadorMeta
  /** Valor objetivo total de la meta (S/ o unidades según el indicador). */
  valorObjetivo: number
  /** Vigencia del periodo (YYYY-MM-DD). */
  desde: string
  hasta: string
  responsable: string
  estado: EstadoMeta
  createdAt: string
  updatedAt: string
}

export type MetaInput = Omit<Meta, 'id' | 'createdAt' | 'updatedAt'>

export type Asignacion = {
  id: string
  metaId: string
  alcance: AlcanceMeta
  /** Nombre del vendedor, sucursal o producto asignado (etiqueta editable mientras no exista el maestro). */
  objetivo: string
  /** Cuota de la asignación (parte del valor objetivo de la meta). */
  valorObjetivo: number
  /** Usuario, sucursal o producto elegido de la lista; enlaza la asignación con las ventas. Vacío = se busca por nombre. */
  referenciaId?: string | null
  estado: EstadoAsignacion
  createdAt: string
  updatedAt: string
}

export type AsignacionInput = Omit<Asignacion, 'id' | 'createdAt' | 'updatedAt'>

/** Corte de avance (8.5: valor_real, fecha_corte, fuente_datos). El valor real de la asignación es el último corte. */
export type Corte = {
  id: string
  asignacionId: string
  /** Fecha de corte (YYYY-MM-DD). */
  fecha: string
  /** Valor acumulado logrado hasta la fecha de corte. */
  valorAcumulado: number
  /** Origen del dato: referencia operativa (p. ej. "Ventas de octubre"), no una cifra sin trazabilidad. */
  fuente: string
  /** true cuando el valor sale de las ventas completadas y no de un corte escrito a mano. */
  automatico?: boolean
  createdAt: string
  updatedAt: string
}

export type CorteInput = Omit<Corte, 'id' | 'createdAt' | 'updatedAt'>

/** Fila ya calculada para los submódulos de avance, ranking y alertas. */
export type AvanceFila = {
  asignacion: Asignacion
  meta: Meta
  /** Último corte registrado (o null si aún no hay avances). */
  corte?: Corte | null
  valorReal: number
  /** Porcentaje de cumplimiento 0–1. */
  cumplimiento: number
  /** Proporción del periodo transcurrido 0–1. */
  previsto: number
  /** Desfase en puntos porcentuales (cumplimiento − previsto). */
  desfase: number
  alerta: boolean
}
