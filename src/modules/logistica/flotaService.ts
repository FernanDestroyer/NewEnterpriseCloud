// Casos de uso de la flota: valida con rules.ts y persiste con la interfaz AlmacenLogistica.
import { ahoraLima, normalizarConductor, normalizarVehiculo, validarAsignacion, validarConductor, validarVehiculo, type Errores, type ResultadoAsignacion } from './rules.ts'
import { nuevoId, type AlmacenLogistica } from './storage.ts'
import type { Asignacion, AsignacionInput, Conductor, ConductorInput, Vehiculo, VehiculoInput } from './types.ts'

export class ErrorValidacion extends Error {
  campos: Errores
  motivos: string[]
  constructor(mensaje: string, campos: Errores = {}, motivos: string[] = []) {
    super(mensaje)
    this.name = 'ErrorValidacion'
    this.campos = campos
    this.motivos = motivos
  }
}

export function etiquetaVehiculo(vehiculo: Vehiculo) {
  return `${vehiculo.placa} · ${vehiculo.marca} ${vehiculo.modelo}`
}

const porPlaca = (a: Vehiculo, b: Vehiculo) => a.placa.localeCompare(b.placa)
const porNombre = (a: Conductor, b: Conductor) => a.nombre.localeCompare(b.nombre, 'es')
const masRecientes = (a: Asignacion, b: Asignacion) => b.desde.localeCompare(a.desde)

function plural(cantidad: number) {
  return cantidad === 1 ? 'una asignación programada' : `${cantidad} asignaciones programadas`
}

export function crearFlotaService(almacen: AlmacenLogistica) {
  const programadas = async (filtro: (item: Asignacion) => boolean) =>
    (await almacen.asignaciones.listar()).filter(item => item.estado === 'programada' && filtro(item))

  const revisarAsignacion = async (input: AsignacionInput): Promise<ResultadoAsignacion> => {
    const [vehiculos, conductores, asignaciones] = await Promise.all([almacen.vehiculos.listar(), almacen.conductores.listar(), almacen.asignaciones.listar()])
    return validarAsignacion({
      vehiculo: vehiculos.find(item => item.id === input.vehiculoId),
      conductor: conductores.find(item => item.id === input.conductorId),
      desde: input.desde, hasta: input.hasta, ahora: ahoraLima(), asignaciones,
    })
  }

  return {
    origen: almacen.origen,

    async listarVehiculos() { return (await almacen.vehiculos.listar()).sort(porPlaca) },
    async listarConductores() { return (await almacen.conductores.listar()).sort(porNombre) },
    async listarAsignaciones() { return (await almacen.asignaciones.listar()).sort(masRecientes) },

    async guardarVehiculo(input: VehiculoInput, existente?: Vehiculo): Promise<Vehiculo> {
      const datos = normalizarVehiculo(input)
      const errores = validarVehiculo(datos, await almacen.vehiculos.listar(), existente?.id)
      if (existente && datos.estado !== 'activo' && existente.estado === 'activo') {
        const pendientes = await programadas(item => item.vehiculoId === existente.id)
        if (pendientes.length) errores.estado = `No puedes dejar el vehículo fuera de servicio: tiene ${plural(pendientes.length)}. Cancélalas primero.`
      }
      if (Object.keys(errores).length) throw new ErrorValidacion('Revisa los datos del vehículo.', errores)
      const ahora = new Date().toISOString()
      return almacen.vehiculos.guardar({ ...datos, id: existente?.id ?? nuevoId(), createdAt: existente?.createdAt ?? ahora, updatedAt: ahora })
    },

    async guardarConductor(input: ConductorInput, existente?: Conductor): Promise<Conductor> {
      const datos = normalizarConductor(input)
      const errores = validarConductor(datos, await almacen.conductores.listar(), existente?.id)
      if (existente && datos.estado !== 'activo' && existente.estado === 'activo') {
        const pendientes = await programadas(item => item.conductorId === existente.id)
        if (pendientes.length) errores.estado = `No puedes inactivar al conductor: tiene ${plural(pendientes.length)}. Cancélalas primero.`
      }
      if (Object.keys(errores).length) throw new ErrorValidacion('Revisa los datos del conductor.', errores)
      const ahora = new Date().toISOString()
      return almacen.conductores.guardar({ ...datos, id: existente?.id ?? nuevoId(), createdAt: existente?.createdAt ?? ahora, updatedAt: ahora })
    },

    /** Valida una asignación sin guardarla (para avisar en pantalla mientras se completa el formulario). */
    revisarAsignacion,

    async crearAsignacion(input: AsignacionInput): Promise<Asignacion> {
      const resultado = await revisarAsignacion(input)
      if (!resultado.valido) throw new ErrorValidacion(resultado.motivos[0] ?? 'Revisa los datos de la asignación.', resultado.campos, resultado.motivos)
      const ahora = new Date().toISOString()
      return almacen.asignaciones.guardar({
        id: nuevoId(), vehiculoId: input.vehiculoId, conductorId: input.conductorId, desde: input.desde, hasta: input.hasta,
        referencia: input.referencia.trim(), despachoId: input.despachoId ?? null, estado: 'programada', motivoCancelacion: '', createdAt: ahora, updatedAt: ahora,
      })
    },

    async cancelarAsignacion(asignacion: Asignacion, motivo: string, opciones: { desdeDespacho?: boolean } = {}): Promise<Asignacion> {
      if (asignacion.despachoId && !opciones.desdeDespacho) throw new ErrorValidacion('Esta asignación pertenece a un despacho. Cancela el despacho para liberarla.')
      if (asignacion.estado !== 'programada') throw new ErrorValidacion('Solo se pueden cancelar asignaciones programadas.')
      const texto = motivo.trim()
      if (!texto) throw new ErrorValidacion('Indica el motivo de la cancelación.', { motivo: 'Indica el motivo de la cancelación.' })
      return almacen.asignaciones.guardar({ ...asignacion, estado: 'cancelada', motivoCancelacion: texto, updatedAt: new Date().toISOString() })
    },

    async completarAsignacion(asignacion: Asignacion, opciones: { desdeDespacho?: boolean } = {}): Promise<Asignacion> {
      if (asignacion.despachoId && !opciones.desdeDespacho) throw new ErrorValidacion('Esta asignación pertenece a un despacho; se cierra desde el seguimiento del despacho.')
      if (asignacion.estado !== 'programada') throw new ErrorValidacion('Solo se pueden completar asignaciones programadas.')
      return almacen.asignaciones.guardar({ ...asignacion, estado: 'completada', updatedAt: new Date().toISOString() })
    },
  }
}

export type FlotaService = ReturnType<typeof crearFlotaService>
