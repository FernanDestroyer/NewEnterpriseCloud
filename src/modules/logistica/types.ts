// Tipos del módulo de Logística y Transporte. Sin dependencias de React ni de Supabase.

export type VehiculoTipo = 'moto' | 'furgoneta' | 'camion' | 'otro'
export type VehiculoEstado = 'activo' | 'mantenimiento' | 'inactivo'
export type Propiedad = 'propio' | 'tercero'

export type Vehiculo = {
  id: string
  /** Placa normalizada con guion, p. ej. ABC-123. */
  placa: string
  tipo: VehiculoTipo
  marca: string
  modelo: string
  /** Capacidad de carga en kilogramos. */
  capacidadKg: number
  propiedad: Propiedad
  /** Empresa transportista cuando el vehículo es de terceros. */
  transportista: string
  /** Vencimientos (YYYY-MM-DD). Vacío = sin registrar. */
  soatVence: string
  revisionVence: string
  estado: VehiculoEstado
  observaciones: string
  createdAt: string
  updatedAt: string
}

export type VehiculoInput = Omit<Vehiculo, 'id' | 'createdAt' | 'updatedAt'>

export type ConductorEstado = 'activo' | 'inactivo'

export type Conductor = {
  id: string
  nombre: string
  /** DNI de 8 dígitos. */
  documento: string
  telefono: string
  licenciaNumero: string
  /** Categoría de licencia de conducir, p. ej. A-IIb. */
  licenciaCategoria: string
  /** Vencimiento de la licencia (YYYY-MM-DD). */
  licenciaVence: string
  estado: ConductorEstado
  observaciones: string
  createdAt: string
  updatedAt: string
}

export type ConductorInput = Omit<Conductor, 'id' | 'createdAt' | 'updatedAt'>

export type AsignacionEstado = 'programada' | 'completada' | 'cancelada'

export type Asignacion = {
  id: string
  vehiculoId: string
  conductorId: string
  /** Fecha y hora locales de Lima (YYYY-MM-DDTHH:mm). */
  desde: string
  hasta: string
  /** Texto libre mientras no existan despachos. */
  referencia: string
  /** Reservado para vincular la asignación a un despacho cuando exista esa pieza. */
  despachoId?: string | null
  estado: AsignacionEstado
  motivoCancelacion: string
  createdAt: string
  updatedAt: string
}

export type AsignacionInput = {
  vehiculoId: string
  conductorId: string
  desde: string
  hasta: string
  referencia: string
  /** Despacho al que pertenece la asignación (la crea la planificación de despachos). */
  despachoId?: string | null
}

// ---------- Despachos y rutas ----------
export type PrioridadDespacho = 'normal' | 'alta' | 'urgente'
export type EstadoDespacho = 'borrador' | 'programado' | 'en_ruta' | 'completado' | 'cancelado'

/** Producto de una venta que viaja en una parada. Las cantidades son enteras. */
export type LineaParada = {
  productoId: string
  codigo: string
  nombre: string
  /** Total vendido en la venta (referencia para no despachar de más). */
  cantidadVendida: number
  /** Unidades que viajan en este despacho. */
  cantidad: number
}

// ---------- Seguimiento, entrega y devoluciones ----------
export type ResultadoEntrega = 'entregada' | 'parcial' | 'no_entregada'
export type MotivoNoEntrega = 'ausente' | 'direccion' | 'rechazo' | 'sin_acceso' | 'otro'

/** Resultado registrado de una parada. `entregadas` guarda las unidades entregadas por producto. */
export type Entrega = {
  resultado: ResultadoEntrega
  /** Momento del registro (ISO). */
  registradoEn: string
  /** Quién recibió la mercadería (vacío si no se entregó). */
  receptor: string
  motivo: MotivoNoEntrega | ''
  nota: string
  entregadas: Record<string, number>
}

/** Lo que no se entregó vuelve al almacén: queda pendiente hasta confirmar el reingreso. */
export type Devolucion = { estado: 'pendiente' | 'reingresada'; reingresadaEn: string; nota: string }

export type EventoDespachoTipo = 'inicio_ruta' | 'entrega' | 'reingreso' | 'completado'
export type EventoDespacho = { id: string; tipo: EventoDespachoTipo; fecha: string; detalle: string }

/** Una entrega de la ruta. Guarda una copia de los datos de la venta al planificar. */
export type Parada = {
  id: string
  /** Posición en la ruta, desde 1. */
  orden: number
  /** ventas.id (UUID). */
  ventaId: string
  /** Código legible de la venta. */
  ventaCodigo: string
  clienteId: string | null
  clienteNombre: string
  direccion: string
  telefono: string
  zonaId: string | null
  zonaNombre: string
  lineas: LineaParada[]
  /** Resultado de la entrega; vacío mientras la parada está pendiente. */
  entrega?: Entrega | null
  /** Presente cuando quedaron unidades sin entregar. */
  devolucion?: Devolucion | null
}

export type Despacho = {
  id: string
  /** DSP-AAAAMMDD-NN */
  numero: string
  /** Día del despacho (YYYY-MM-DD, calendario de Lima). */
  fecha: string
  prioridad: PrioridadDespacho
  almacenId: string | null
  almacenNombre: string
  /** Peso total estimado de la carga; vacío si no se conoce. */
  pesoEstimadoKg: number | null
  observaciones: string
  /** Las paradas ordenadas son la ruta. */
  paradas: Parada[]
  vehiculoId: string | null
  conductorId: string | null
  /** Ventana de uso del vehículo y del conductor (YYYY-MM-DDTHH:mm). */
  desde: string
  hasta: string
  /** Asignación creada en Vehículos y conductores al programar. */
  asignacionId: string | null
  estado: EstadoDespacho
  motivoCancelacion: string
  /** Línea de tiempo del seguimiento (inicio de ruta, entregas, reingresos, cierre). */
  eventos?: EventoDespacho[]
  createdAt: string
  updatedAt: string
}

export type DespachoInput = Omit<Despacho, 'id' | 'numero' | 'asignacionId' | 'estado' | 'motivoCancelacion' | 'eventos' | 'createdAt' | 'updatedAt'>
