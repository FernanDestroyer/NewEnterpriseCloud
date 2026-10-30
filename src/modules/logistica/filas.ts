// Traducción entre las filas de Supabase (snake_case, null) y los tipos de Logística (camelCase, '').
// Sin dependencias de React ni de Supabase: se prueba con node --test (tests/logistica-db.test.mjs).
import type { Asignacion, Conductor, Despacho, Parada, Vehiculo } from './types.ts'

export type Fila = Record<string, unknown>

const texto = (valor: unknown) => (valor == null ? '' : String(valor))
/** 'YYYY-MM-DD' (las columnas date ya vienen así; recorta por si llega con hora). */
const soloFecha = (valor: unknown) => texto(valor).slice(0, 10)
/** 'YYYY-MM-DDTHH:mm': PostgREST devuelve 'YYYY-MM-DDTHH:mm:ss' para timestamp sin zona. */
const fechaHora = (valor: unknown) => texto(valor).slice(0, 16).replace(' ', 'T')
/** Texto vacío -> null, para las columnas opcionales de la base. */
const nulo = (valor: string | null | undefined) => (valor && valor.trim() !== '' ? valor : null)
const numeroONulo = (valor: unknown) => (valor == null || valor === '' || Number.isNaN(Number(valor)) ? null : Number(valor))

// ---------- Vehículos ----------
export function demapearVehiculo(item: Vehiculo): Fila {
  return {
    id: item.id,
    placa: item.placa,
    tipo: item.tipo,
    marca: item.marca,
    modelo: item.modelo,
    capacidad_kg: item.capacidadKg,
    propiedad: item.propiedad,
    transportista: item.transportista,
    soat_vence: nulo(item.soatVence),
    revision_vence: nulo(item.revisionVence),
    estado: item.estado,
    observaciones: item.observaciones,
  }
}

export function mapearVehiculo(fila: Fila): Vehiculo {
  return {
    id: texto(fila.id),
    placa: texto(fila.placa),
    tipo: texto(fila.tipo) as Vehiculo['tipo'],
    marca: texto(fila.marca),
    modelo: texto(fila.modelo),
    capacidadKg: Number(fila.capacidad_kg ?? 0),
    propiedad: texto(fila.propiedad) as Vehiculo['propiedad'],
    transportista: texto(fila.transportista),
    soatVence: soloFecha(fila.soat_vence),
    revisionVence: soloFecha(fila.revision_vence),
    estado: texto(fila.estado) as Vehiculo['estado'],
    observaciones: texto(fila.observaciones),
    createdAt: texto(fila.created_at),
    updatedAt: texto(fila.updated_at),
  }
}

// ---------- Conductores ----------
export function demapearConductor(item: Conductor): Fila {
  return {
    id: item.id,
    nombre: item.nombre,
    documento: item.documento,
    telefono: item.telefono,
    licencia_numero: item.licenciaNumero,
    licencia_categoria: item.licenciaCategoria,
    licencia_vence: item.licenciaVence,
    estado: item.estado,
    observaciones: item.observaciones,
  }
}

export function mapearConductor(fila: Fila): Conductor {
  return {
    id: texto(fila.id),
    nombre: texto(fila.nombre),
    documento: texto(fila.documento),
    telefono: texto(fila.telefono),
    licenciaNumero: texto(fila.licencia_numero),
    licenciaCategoria: texto(fila.licencia_categoria),
    licenciaVence: soloFecha(fila.licencia_vence),
    estado: texto(fila.estado) as Conductor['estado'],
    observaciones: texto(fila.observaciones),
    createdAt: texto(fila.created_at),
    updatedAt: texto(fila.updated_at),
  }
}

// ---------- Asignaciones ----------
export function demapearAsignacion(item: Asignacion): Fila {
  return {
    id: item.id,
    vehiculo_id: item.vehiculoId,
    conductor_id: item.conductorId,
    desde: item.desde,
    hasta: item.hasta,
    referencia: item.referencia,
    despacho_id: item.despachoId ?? null,
    estado: item.estado,
    motivo_cancelacion: item.motivoCancelacion,
  }
}

export function mapearAsignacion(fila: Fila): Asignacion {
  return {
    id: texto(fila.id),
    vehiculoId: texto(fila.vehiculo_id),
    conductorId: texto(fila.conductor_id),
    desde: fechaHora(fila.desde),
    hasta: fechaHora(fila.hasta),
    referencia: texto(fila.referencia),
    despachoId: fila.despacho_id == null ? null : texto(fila.despacho_id),
    estado: texto(fila.estado) as Asignacion['estado'],
    motivoCancelacion: texto(fila.motivo_cancelacion),
    createdAt: texto(fila.created_at),
    updatedAt: texto(fila.updated_at),
  }
}

// ---------- Despachos ----------
export function demapearDespacho(item: Despacho): Fila {
  return {
    id: item.id,
    numero: item.numero,
    fecha: item.fecha,
    prioridad: item.prioridad,
    almacen_id: item.almacenId,
    almacen_nombre: item.almacenNombre,
    peso_estimado_kg: item.pesoEstimadoKg,
    observaciones: item.observaciones,
    paradas: item.paradas,
    vehiculo_id: item.vehiculoId,
    conductor_id: item.conductorId,
    desde: nulo(item.desde),
    hasta: nulo(item.hasta),
    asignacion_id: item.asignacionId,
    estado: item.estado,
    motivo_cancelacion: item.motivoCancelacion,
    // Solo se envía cuando hay seguimiento: así el resto del módulo funciona aunque falte la columna.
    ...(item.eventos?.length ? { eventos: item.eventos } : {}),
  }
}

export function mapearDespacho(fila: Fila): Despacho {
  return {
    id: texto(fila.id),
    numero: texto(fila.numero),
    fecha: soloFecha(fila.fecha),
    prioridad: texto(fila.prioridad) as Despacho['prioridad'],
    almacenId: fila.almacen_id == null ? null : texto(fila.almacen_id),
    almacenNombre: texto(fila.almacen_nombre),
    pesoEstimadoKg: numeroONulo(fila.peso_estimado_kg),
    observaciones: texto(fila.observaciones),
    paradas: Array.isArray(fila.paradas) ? (fila.paradas as Parada[]) : [],
    vehiculoId: fila.vehiculo_id == null ? null : texto(fila.vehiculo_id),
    conductorId: fila.conductor_id == null ? null : texto(fila.conductor_id),
    desde: fechaHora(fila.desde),
    hasta: fechaHora(fila.hasta),
    asignacionId: fila.asignacion_id == null ? null : texto(fila.asignacion_id),
    estado: texto(fila.estado) as Despacho['estado'],
    motivoCancelacion: texto(fila.motivo_cancelacion),
    ...(Array.isArray(fila.eventos) && fila.eventos.length ? { eventos: fila.eventos as Despacho['eventos'] } : {}),
    createdAt: texto(fila.created_at),
    updatedAt: texto(fila.updated_at),
  }
}

// ---------- Errores de la base ----------
type ErrorBD = { code?: string; message?: string; details?: string } | null

/**
 * Convierte un error de Postgres/PostgREST en un mensaje claro en español.
 * Las reglas del trigger validar_asignacion_vehiculo ya llegan en español (código 23514): se muestran tal cual.
 */
export function errorLogistica(razon: unknown): Error {
  const error = razon as ErrorBD
  const mensaje = (error?.message ?? '').trim()
  const detalle = `${mensaje} ${error?.details ?? ''}`
  switch (error?.code) {
    case '23P01':
      if (/conductor_sin_cruce/.test(detalle)) return new Error('El conductor ya tiene una asignación programada que se cruza con ese horario.')
      if (/vehiculo_sin_cruce/.test(detalle)) return new Error('El vehículo ya tiene una asignación programada que se cruza con ese horario.')
      return new Error('El vehículo o el conductor ya tiene una asignación programada que se cruza con ese horario.')
    case '23505':
      if (/vehiculos_placa_uk/.test(detalle)) return new Error('Ya existe un vehículo con esa placa.')
      if (/conductores_documento_uk/.test(detalle)) return new Error('Ya existe un conductor con ese documento.')
      if (/despachos_numero_uk/.test(detalle)) return new Error('Ese número de despacho ya existe. Actualiza la pantalla e inténtalo de nuevo.')
      return new Error('Ya existe un registro con esos datos.')
    case '42501':
      return new Error('Tu rol no tiene permiso para realizar esta acción.')
    case '42703':
    case 'PGRST204':
      if (/eventos/.test(detalle)) return new Error('Falta la columna de seguimiento en la base de datos. Ejecuta la migración 20261104030000_seguimiento_despachos.sql en el SQL Editor de Supabase.')
      return new Error(mensaje || 'La base de datos no tiene una columna que necesita Logística.')
    case '23503':
      return new Error('Un vehículo, conductor o almacén seleccionado ya no existe. Actualiza la pantalla e inténtalo de nuevo.')
    case '42P01':
    case 'PGRST205':
      return new Error('La base de datos no tiene las tablas de Logística. Aplica el script base y la migración 20261104010000_despachos.sql.')
    case '23514':
      // Mensajes de reglas propias (en español) se muestran; los de CHECK estándar de Postgres no.
      return new Error(mensaje && !/violates check constraint|new row for relation/i.test(mensaje) ? mensaje : 'Alguno de los valores no cumple las reglas de la base de datos.')
    default:
      return new Error(mensaje || 'No se pudo completar la operación en la base de datos.')
  }
}
