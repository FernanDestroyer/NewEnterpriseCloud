// Reglas de negocio de la flota. Lógica pura: sin React, sin Supabase y sin acceso a datos.
import type { Asignacion, Conductor, ConductorInput, Vehiculo, VehiculoInput, VehiculoTipo } from './types.ts'

export type Errores = Record<string, string>

export const DIAS_AVISO_VENCIMIENTO = 30

export const VEHICULO_TIPOS: Array<{ value: VehiculoTipo; label: string }> = [
  { value: 'moto', label: 'Moto' },
  { value: 'furgoneta', label: 'Furgoneta' },
  { value: 'camion', label: 'Camión' },
  { value: 'otro', label: 'Otro' },
]

export const LICENCIA_CATEGORIAS = ['A-I', 'A-IIa', 'A-IIb', 'A-IIIa', 'A-IIIb', 'A-IIIc', 'B-I', 'B-IIa', 'B-IIb', 'B-IIc']

// Regla simplificada y parametrizable: qué categorías de licencia habilitan cada tipo de vehículo.
// Validarla con el responsable de transporte y con la normativa vigente del MTC antes de producción.
const CATEGORIAS_CAMION = ['A-IIb', 'A-IIIa', 'A-IIIb', 'A-IIIc']

export function etiquetaVehiculoCorta(vehiculo: Vehiculo) {
  return `${vehiculo.placa} · ${tipoLabel(vehiculo.tipo)} · ${vehiculo.capacidadKg.toLocaleString('es-PE')} kg`
}

export function tipoLabel(tipo: VehiculoTipo) {
  return VEHICULO_TIPOS.find(item => item.value === tipo)?.label ?? tipo
}

// ---------- Placas ----------
export function normalizarPlaca(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function placaValida(value: string) {
  return /^[A-Z0-9]{6}$/.test(normalizarPlaca(value))
}

export function formatearPlaca(value: string) {
  const placa = normalizarPlaca(value)
  return placa.length > 3 ? `${placa.slice(0, 3)}-${placa.slice(3)}` : placa
}

// ---------- Licencias ----------
export function licenciaPermite(categoria: string, tipo: VehiculoTipo) {
  if (tipo === 'moto') return categoria.startsWith('B')
  if (tipo === 'furgoneta') return categoria.startsWith('A')
  if (tipo === 'camion') return CATEGORIAS_CAMION.includes(categoria)
  return true
}

// ---------- Fechas (calendario de Lima, sin horario de verano) ----------
const FECHA = /^\d{4}-\d{2}-\d{2}$/
const FECHA_HORA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/

export function fechaReal(value: string) {
  if (!FECHA.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function fechaHoraReal(value: string) {
  return FECHA_HORA.test(value) && fechaReal(value.slice(0, 10)) && Number(value.slice(11, 13)) < 24 && Number(value.slice(14, 16)) < 60
}

/** Fecha y hora actuales de Lima en formato YYYY-MM-DDTHH:mm. */
export function ahoraLima(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now)
  const get = (type: string) => parts.find(part => part.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`
}

/** Suma horas a una fecha local YYYY-MM-DDTHH:mm. */
export function sumarHoras(local: string, horas: number) {
  const date = new Date(`${local}:00Z`)
  if (Number.isNaN(date.getTime())) return local
  date.setUTCHours(date.getUTCHours() + horas)
  return date.toISOString().slice(0, 16)
}

export function diasEntre(desde: string, hasta: string) {
  return Math.round((Date.parse(`${hasta.slice(0, 10)}T00:00:00Z`) - Date.parse(`${desde.slice(0, 10)}T00:00:00Z`)) / 86_400_000)
}

/** dd/mm/aaaa para YYYY-MM-DD, y dd/mm/aaaa hh:mm si trae hora. */
export function formatoFecha(value: string) {
  if (!value) return '—'
  const [y, m, d] = value.slice(0, 10).split('-')
  const fecha = `${d}/${m}/${y}`
  return value.length >= 16 ? `${fecha} ${value.slice(11, 16)}` : fecha
}

export function seSuperponen(aDesde: string, aHasta: string, bDesde: string, bHasta: string) {
  return aDesde < bHasta && bDesde < aHasta
}

// ---------- Vigencia de documentos ----------
export type VigenciaDocumento = 'vigente' | 'por_vencer' | 'vencido' | 'sin_dato'

/** Estado de un documento con vencimiento (YYYY-MM-DD) respecto al día de hoy. */
export function vigenciaDocumento(vence: string | null | undefined, hoy: string, diasAviso = DIAS_AVISO_VENCIMIENTO): VigenciaDocumento {
  if (!vence || !fechaReal(vence)) return 'sin_dato'
  const dias = diasEntre(hoy, vence)
  if (dias < 0) return 'vencido'
  return dias <= diasAviso ? 'por_vencer' : 'vigente'
}

/** Cuántos documentos de vehículos y conductores activos requieren atención (vencidos, por vencer o sin registrar). */
export function documentosEnAtencion(vehiculos: Vehiculo[], conductores: Conductor[], hoy: string) {
  let total = 0
  for (const vehiculo of vehiculos.filter(item => item.estado === 'activo')) {
    if (vigenciaDocumento(vehiculo.soatVence, hoy) !== 'vigente') total += 1
    if (vigenciaDocumento(vehiculo.revisionVence, hoy) !== 'vigente') total += 1
  }
  for (const conductor of conductores.filter(item => item.estado === 'activo')) {
    if (vigenciaDocumento(conductor.licenciaVence, hoy) !== 'vigente') total += 1
  }
  return total
}

// ---------- Normalización de entradas ----------
const limpiar = (value: string) => value.trim().replace(/\s+/g, ' ')

export function normalizarVehiculo(input: VehiculoInput): VehiculoInput {
  return {
    ...input,
    placa: formatearPlaca(input.placa),
    marca: limpiar(input.marca),
    modelo: limpiar(input.modelo),
    transportista: input.propiedad === 'tercero' ? limpiar(input.transportista) : '',
    soatVence: input.soatVence.trim(),
    revisionVence: input.revisionVence.trim(),
    observaciones: input.observaciones.trim(),
  }
}

export function normalizarConductor(input: ConductorInput): ConductorInput {
  return {
    ...input,
    nombre: limpiar(input.nombre),
    documento: input.documento.replace(/\D/g, ''),
    telefono: input.telefono.replace(/[^\d]/g, ''),
    licenciaNumero: input.licenciaNumero.toUpperCase().replace(/[^A-Z0-9]/g, ''),
    licenciaVence: input.licenciaVence.trim(),
    observaciones: input.observaciones.trim(),
  }
}

// ---------- Validación de catálogos (recibe datos ya normalizados) ----------
export function validarVehiculo(input: VehiculoInput, existentes: Vehiculo[], ignorarId?: string): Errores {
  const errores: Errores = {}
  if (!placaValida(input.placa)) errores.placa = 'Ingresa una placa de 6 caracteres (por ejemplo ABC-123).'
  else if (existentes.some(item => item.id !== ignorarId && normalizarPlaca(item.placa) === normalizarPlaca(input.placa))) errores.placa = 'Ya existe un vehículo con esa placa.'
  if (!VEHICULO_TIPOS.some(item => item.value === input.tipo)) errores.tipo = 'Elige el tipo de vehículo.'
  if (input.marca.length < 2) errores.marca = 'Indica la marca.'
  if (input.modelo.length < 1) errores.modelo = 'Indica el modelo.'
  if (!Number.isFinite(input.capacidadKg) || input.capacidadKg <= 0 || input.capacidadKg > 100_000) errores.capacidadKg = 'La capacidad debe estar entre 1 y 100 000 kg.'
  if (input.propiedad === 'tercero' && input.transportista.length < 3) errores.transportista = 'Indica la empresa transportista del vehículo de terceros.'
  if (input.soatVence && !fechaReal(input.soatVence)) errores.soatVence = 'Fecha de vencimiento no válida.'
  if (input.revisionVence && !fechaReal(input.revisionVence)) errores.revisionVence = 'Fecha de vencimiento no válida.'
  return errores
}

export function validarConductor(input: ConductorInput, existentes: Conductor[], ignorarId?: string): Errores {
  const errores: Errores = {}
  if (input.nombre.length < 3) errores.nombre = 'Indica el nombre completo.'
  if (!/^\d{8}$/.test(input.documento)) errores.documento = 'El DNI debe tener 8 dígitos.'
  else if (existentes.some(item => item.id !== ignorarId && item.documento === input.documento)) errores.documento = 'Ya existe un conductor con ese DNI.'
  if (input.telefono && !/^\d{7,9}$/.test(input.telefono)) errores.telefono = 'El teléfono debe tener entre 7 y 9 dígitos.'
  if (input.licenciaNumero.length < 4) errores.licenciaNumero = 'Indica el número de licencia.'
  if (!LICENCIA_CATEGORIAS.includes(input.licenciaCategoria)) errores.licenciaCategoria = 'Elige la categoría de la licencia.'
  if (!fechaReal(input.licenciaVence)) errores.licenciaVence = 'Indica la fecha de vencimiento de la licencia.'
  return errores
}

// ---------- Validación de asignaciones ----------
export type ResultadoAsignacion = {
  valido: boolean
  /** Errores por campo, para mostrarlos junto al control. */
  campos: Errores
  /** Motivos que impiden registrar la asignación. */
  motivos: string[]
  /** Advertencias que no la impiden. */
  avisos: string[]
}

export type ValidarAsignacionArgs = {
  vehiculo: Vehiculo | undefined
  conductor: Conductor | undefined
  desde: string
  hasta: string
  /** Fecha y hora actuales de Lima (YYYY-MM-DDTHH:mm). */
  ahora: string
  asignaciones: Asignacion[]
  /** Asignación que se está editando y no debe contarse como conflicto. */
  ignorarId?: string
}

export function validarAsignacion(args: ValidarAsignacionArgs): ResultadoAsignacion {
  const { vehiculo, conductor, desde, hasta, ahora, asignaciones, ignorarId } = args
  const campos: Errores = {}
  const motivos: string[] = []
  const avisos: string[] = []

  if (!vehiculo) campos.vehiculoId = 'Elige un vehículo.'
  if (!conductor) campos.conductorId = 'Elige un conductor.'
  if (!fechaHoraReal(desde)) campos.desde = 'Indica la fecha y hora de inicio.'
  if (!fechaHoraReal(hasta)) campos.hasta = 'Indica la fecha y hora de fin.'
  if (!campos.desde && !campos.hasta && hasta <= desde) campos.hasta = 'El fin debe ser posterior al inicio.'
  if (Object.keys(campos).length || !vehiculo || !conductor) return { valido: false, campos, motivos, avisos }

  if (vehiculo.estado !== 'activo') motivos.push(`El vehículo ${vehiculo.placa} está en estado «${vehiculo.estado}».`)
  if (conductor.estado !== 'activo') motivos.push(`${conductor.nombre} está inactivo.`)

  const finDia = hasta.slice(0, 10)
  const documentos: Array<[string, string]> = [['El SOAT', vehiculo.soatVence], ['La revisión técnica', vehiculo.revisionVence]]
  for (const [nombre, vence] of documentos) {
    if (!vence) avisos.push(`${nombre} del vehículo no está registrado.`)
    else if (vence < finDia) motivos.push(`${nombre} vence el ${formatoFecha(vence)}, antes del fin de la asignación.`)
  }
  if (conductor.licenciaVence < finDia) motivos.push(`La licencia de ${conductor.nombre} vence el ${formatoFecha(conductor.licenciaVence)}, antes del fin de la asignación.`)
  if (!licenciaPermite(conductor.licenciaCategoria, vehiculo.tipo)) motivos.push(`La licencia ${conductor.licenciaCategoria} de ${conductor.nombre} no habilita conducir un vehículo tipo ${tipoLabel(vehiculo.tipo).toLowerCase()}.`)
  if (desde < ahora) avisos.push('El inicio de la asignación ya pasó.')

  for (const otra of asignaciones) {
    if (otra.estado !== 'programada' || otra.id === ignorarId || !seSuperponen(desde, hasta, otra.desde, otra.hasta)) continue
    const rango = `del ${formatoFecha(otra.desde)} al ${formatoFecha(otra.hasta)}`
    if (otra.vehiculoId === vehiculo.id) motivos.push(`El vehículo ya tiene una asignación ${rango}.`)
    if (otra.conductorId === conductor.id) motivos.push(`${conductor.nombre} ya tiene una asignación ${rango}.`)
  }

  return { valido: motivos.length === 0, campos, motivos, avisos }
}
