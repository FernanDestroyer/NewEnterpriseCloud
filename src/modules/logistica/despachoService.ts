// Casos de uso de la planificación de despachos: valida con despachos.ts y se apoya en el servicio de flota
// para reservar vehículo y conductor. Persiste con la interfaz AlmacenLogistica.
import { siguienteNumero, validarCantidadesContraOtros, validarDespacho, puedeTransicionar, renumerar, type ResultadoDespacho } from './despachos.ts'
import { ErrorValidacion, type FlotaService } from './flotaService.ts'
import { construirEntrega, estadoParada, motivoLabel, motivosParaCompletar, RESULTADOS_ENTREGA, unidadesDevueltas, unidadesEntregadas, validarEntrega, type EntradaEntrega } from './seguimiento.ts'
import { nuevoId, type AlmacenLogistica } from './storage.ts'
import type { Despacho, DespachoInput, EventoDespacho, EventoDespachoTipo, Parada } from './types.ts'

const masRecientes = (a: Despacho, b: Despacho) => b.fecha.localeCompare(a.fecha) || b.numero.localeCompare(a.numero)

function normalizar(input: DespachoInput): DespachoInput {
  return {
    ...input,
    almacenNombre: input.almacenNombre.trim(),
    observaciones: input.observaciones.trim(),
    pesoEstimadoKg: input.pesoEstimadoKg === null || Number.isNaN(input.pesoEstimadoKg) ? null : input.pesoEstimadoKg,
    paradas: renumerar(input.paradas.map(parada => ({
      ...parada, direccion: parada.direccion.trim().replace(/\s+/g, ' '), telefono: parada.telefono.trim(),
      lineas: parada.lineas.map(linea => ({ ...linea, cantidad: Math.trunc(Number(linea.cantidad)) })),
    }))),
  }
}

const evento = (tipo: EventoDespachoTipo, detalle: string, fecha: string): EventoDespacho => ({ id: nuevoId(), tipo, fecha, detalle })

export function crearDespachoService(almacen: AlmacenLogistica, flota: FlotaService) {
  /** Revisa todo lo que puede revisarse sin guardar: reglas del despacho, cantidades y disponibilidad del vehículo y conductor. */
  const revisarProgramacion = async (entrada: DespachoInput, existente?: Despacho): Promise<ResultadoDespacho> => {
    const input = normalizar(entrada)
    const [despachos, vehiculos] = await Promise.all([almacen.despachos.listar(), flota.listarVehiculos()])
    const base = validarDespacho(input, { modo: 'programar', vehiculo: vehiculos.find(item => item.id === input.vehiculoId) })
    const motivos = [...base.motivos, ...validarCantidadesContraOtros(input.paradas, despachos, existente?.id)]
    const campos = { ...base.campos }
    const avisos = [...base.avisos]
    if (input.vehiculoId && input.conductorId && input.desde && input.hasta) {
      const asignacion = await flota.revisarAsignacion({ vehiculoId: input.vehiculoId, conductorId: input.conductorId, desde: input.desde, hasta: input.hasta, referencia: '' })
      Object.assign(campos, { desde: campos.desde ?? asignacion.campos.desde, hasta: asignacion.campos.hasta })
      for (const clave of Object.keys(campos)) if (!campos[clave]) delete campos[clave]
      motivos.push(...asignacion.motivos)
      avisos.push(...asignacion.avisos)
    } else if (input.vehiculoId && input.conductorId) {
      campos.desde = campos.desde ?? 'Indica la fecha y hora de inicio.'
      campos.hasta = campos.hasta ?? 'Indica la fecha y hora de fin.'
    }
    return { valido: Object.keys(campos).length === 0 && motivos.length === 0, campos, motivos, avisos }
  }

  return {
    origen: almacen.origen,
    revisarProgramacion,

    async listar() { return (await almacen.despachos.listar()).sort(masRecientes) },

    /** Guarda el despacho como borrador (no reserva vehículo ni conductor). */
    async guardarBorrador(entrada: DespachoInput, existente?: Despacho): Promise<Despacho> {
      if (existente && existente.estado !== 'borrador') throw new ErrorValidacion('Solo se pueden editar despachos en borrador.')
      const input = normalizar(entrada)
      const despachos = await almacen.despachos.listar()
      const base = validarDespacho(input, { modo: 'borrador' })
      const motivos = [...base.motivos, ...validarCantidadesContraOtros(input.paradas, despachos, existente?.id)]
      if (!base.valido || motivos.length) throw new ErrorValidacion(motivos[0] ?? 'Revisa los datos del despacho.', base.campos, motivos)
      const ahora = new Date().toISOString()
      return almacen.despachos.guardar({
        ...input, id: existente?.id ?? nuevoId(), numero: existente?.numero ?? siguienteNumero(despachos, input.fecha),
        asignacionId: null, estado: 'borrador', motivoCancelacion: '', createdAt: existente?.createdAt ?? ahora, updatedAt: ahora,
      })
    },

    /** Programa el despacho: reserva vehículo y conductor creando la asignación y lo deja en estado «programado». */
    async programar(entrada: DespachoInput, existente?: Despacho): Promise<Despacho> {
      if (existente && !puedeTransicionar(existente.estado, 'programado')) throw new ErrorValidacion('Este despacho ya no se puede programar.')
      const input = normalizar(entrada)
      const resultado = await revisarProgramacion(input, existente)
      if (!resultado.valido) throw new ErrorValidacion(resultado.motivos[0] ?? 'Revisa los datos del despacho.', resultado.campos, resultado.motivos)
      const despachos = await almacen.despachos.listar()
      const id = existente?.id ?? nuevoId()
      const numero = existente?.numero ?? siguienteNumero(despachos, input.fecha)
      const asignacion = await flota.crearAsignacion({ vehiculoId: input.vehiculoId ?? '', conductorId: input.conductorId ?? '', desde: input.desde, hasta: input.hasta, referencia: numero, despachoId: id })
      const ahora = new Date().toISOString()
      try {
        return await almacen.despachos.guardar({
          ...input, id, numero, asignacionId: asignacion.id, estado: 'programado', motivoCancelacion: '', createdAt: existente?.createdAt ?? ahora, updatedAt: ahora,
        })
      } catch (error) {
        await flota.cancelarAsignacion(asignacion, 'No se pudo guardar el despacho', { desdeDespacho: true }).catch(() => undefined)
        throw error
      }
    },

    /** Cancela el despacho y, si estaba programado, libera el vehículo y el conductor. */
    async cancelar(despacho: Despacho, motivo: string): Promise<Despacho> {
      if (!puedeTransicionar(despacho.estado, 'cancelado')) throw new ErrorValidacion('Este despacho ya no se puede cancelar.')
      const texto = motivo.trim()
      if (!texto) throw new ErrorValidacion('Indica el motivo de la cancelación.', { motivo: 'Indica el motivo de la cancelación.' })
      if (despacho.asignacionId) {
        const asignacion = (await flota.listarAsignaciones()).find(item => item.id === despacho.asignacionId)
        if (asignacion?.estado === 'programada') await flota.cancelarAsignacion(asignacion, `Despacho ${despacho.numero} cancelado: ${texto}`, { desdeDespacho: true })
      }
      return almacen.despachos.guardar({ ...despacho, estado: 'cancelado', motivoCancelacion: texto, updatedAt: new Date().toISOString() })
    },

    // ---------- Seguimiento, entrega y devoluciones ----------

    /** Programado → en ruta. Deja constancia del momento de salida. */
    async iniciarRuta(despacho: Despacho): Promise<Despacho> {
      if (!puedeTransicionar(despacho.estado, 'en_ruta')) throw new ErrorValidacion('Solo se puede iniciar la ruta de un despacho programado.')
      if (!despacho.paradas.length) throw new ErrorValidacion('El despacho no tiene paradas.')
      const ahora = new Date().toISOString()
      return almacen.despachos.guardar({
        ...despacho, estado: 'en_ruta', updatedAt: ahora,
        eventos: [...(despacho.eventos ?? []), evento('inicio_ruta', `Salió a ruta con ${despacho.paradas.length} ${despacho.paradas.length === 1 ? 'parada' : 'paradas'}.`, ahora)],
      })
    },

    /** Registra el resultado de una parada. Lo no entregado queda como devolución pendiente de reingreso. */
    async registrarEntrega(despacho: Despacho, paradaId: string, entrada: EntradaEntrega): Promise<Despacho> {
      if (despacho.estado !== 'en_ruta') throw new ErrorValidacion('Solo se registran entregas de un despacho en ruta.')
      const parada = despacho.paradas.find(item => item.id === paradaId)
      if (!parada) throw new ErrorValidacion('La parada ya no existe en este despacho.')
      if (parada.entrega) throw new ErrorValidacion('Esta parada ya tiene su resultado registrado.')
      const revision = validarEntrega(parada, entrada)
      if (!revision.valido) throw new ErrorValidacion('Revisa los campos marcados.', revision.campos)
      const ahora = new Date().toISOString()
      const entrega = construirEntrega(parada, entrada, ahora)
      const actualizada: Parada = { ...parada, entrega, devolucion: null }
      const devueltas = unidadesDevueltas(actualizada)
      if (devueltas > 0) actualizada.devolucion = { estado: 'pendiente', reingresadaEn: '', nota: '' }
      const resumen = `${parada.ventaCodigo} · ${parada.clienteNombre}: ${RESULTADOS_ENTREGA[entrega.resultado].label.toLowerCase()}`
        + (entrega.receptor ? `, recibió ${entrega.receptor}` : '')
        + (entrega.resultado === 'parcial' ? ` (${unidadesEntregadas(actualizada)} de ${unidadesEntregadas(actualizada) + devueltas} u.)` : '')
        + (entrega.motivo ? `. Motivo: ${motivoLabel(entrega.motivo)}` : '') + '.'
      return almacen.despachos.guardar({
        ...despacho, updatedAt: ahora,
        paradas: despacho.paradas.map(item => item.id === paradaId ? actualizada : item),
        eventos: [...(despacho.eventos ?? []), evento('entrega', resumen, ahora)],
      })
    },

    /** Confirma que la mercadería devuelta ya volvió al almacén. No mueve stock: es solo la constancia. */
    async confirmarReingreso(despacho: Despacho, paradaId: string, nota: string): Promise<Despacho> {
      if (despacho.estado === 'cancelado') throw new ErrorValidacion('El despacho está cancelado.')
      const parada = despacho.paradas.find(item => item.id === paradaId)
      if (!parada || parada.devolucion?.estado !== 'pendiente') throw new ErrorValidacion('Esta devolución ya no está pendiente.')
      const ahora = new Date().toISOString()
      const texto = nota.trim()
      return almacen.despachos.guardar({
        ...despacho, updatedAt: ahora,
        paradas: despacho.paradas.map(item => item.id === paradaId ? { ...item, devolucion: { estado: 'reingresada' as const, reingresadaEn: ahora, nota: texto } } : item),
        eventos: [...(despacho.eventos ?? []), evento('reingreso', `${parada.ventaCodigo}: ${unidadesDevueltas(parada)} u. reingresadas al almacén${texto ? `. ${texto}` : '.'}`, ahora)],
      })
    },

    /** En ruta → completado, cuando todas las paradas tienen resultado. Libera el vehículo y el conductor. */
    async completar(despacho: Despacho): Promise<Despacho> {
      const motivos = motivosParaCompletar(despacho)
      if (motivos.length) throw new ErrorValidacion(motivos[0], {}, motivos)
      const ahora = new Date().toISOString()
      const total = despacho.paradas.length
      const entregadas = despacho.paradas.filter(parada => estadoParada(parada) !== 'no_entregada').length
      const guardado = await almacen.despachos.guardar({
        ...despacho, estado: 'completado', updatedAt: ahora,
        eventos: [...(despacho.eventos ?? []), evento('completado', `Ruta cerrada: ${entregadas} de ${total} ${total === 1 ? 'parada con entrega' : 'paradas con entrega'}.`, ahora)],
      })
      if (despacho.asignacionId) {
        const asignacion = (await flota.listarAsignaciones()).find(item => item.id === despacho.asignacionId)
        // Si la reserva ya no está programada no hay nada que cerrar; un fallo aquí no debe deshacer el cierre.
        if (asignacion?.estado === 'programada') await flota.completarAsignacion(asignacion, { desdeDespacho: true }).catch(() => undefined)
      }
      return guardado
    },
  }
}

export type DespachoService = ReturnType<typeof crearDespachoService>
