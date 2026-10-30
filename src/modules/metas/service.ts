// Servicio del módulo de Metas y Objetivos: validaciones, códigos automáticos y acceso a datos.
import { ALCANCES, fechaLima } from './rules'
import { nuevoId, type AlmacenMetas } from './storage'
import type { Asignacion, AsignacionInput, Corte, CorteInput, Meta, MetaInput } from './types'

export type Errores = Record<string, string>

/** Error con mensajes por campo; las ventanas de diálogo lo mapean bajo cada control. */
export class ErrorValidacion extends Error {
  campos: Errores
  constructor(mensaje: string, campos: Errores = {}) {
    super(mensaje)
    this.name = 'ErrorValidacion'
    this.campos = campos
  }
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/
const CODIGO = /^[A-Za-zÁÉÍÓÚÑñ][A-Za-zÁÉÍÓÚÑñ0-9 _./-]{0,79}$/

/** Genera el siguiente código META-001, META-002, … según los ya registrados. */
export function siguienteCodigo(metas: Meta[]): string {
  const mayor = metas.reduce((n, meta) => Math.max(n, Number(/(\d+)$/.exec(meta.codigo)?.[1] ?? 0)), 0)
  return `META-${String(mayor + 1).padStart(3, '0')}`
}

export type MetasService = ReturnType<typeof crearMetasService>

export function crearMetasService(almacen: AlmacenMetas) {
  const hoy = fechaLima()

  async function listarMetas() {
    const metas = await almacen.metas.listar()
    return metas.sort((a, b) => a.codigo.localeCompare(b.codigo))
  }

  async function listarAsignaciones() {
    const asignaciones = await almacen.asignaciones.listar()
    return asignaciones.sort((a, b) => a.objetivo.localeCompare(b.objetivo, 'es'))
  }

  async function listarCortes() {
    const cortes = await almacen.cortes.listar()
    return cortes.sort((a, b) => a.fecha.localeCompare(b.fecha))
  }

  /**
   * Datos de demostración para cuando el módulo corre con respaldo local y aún no hay
   * nada registrado: una meta anual, vendedores y una sucursal, y cortes mensuales
   * acumulados hasta hoy. No se ejecuta si ya existe cualquier registro.
   */
  async function sembrarEjemplo(): Promise<void> {
    const [metas, asignaciones, cortes] = await Promise.all([listarMetas(), listarAsignaciones(), listarCortes()])
    if (metas.length || asignaciones.length || cortes.length) return
    const anio = hoy.slice(0, 4)
    const meta = await guardarMeta({
      codigo: 'META-DEMO',
      nombre: 'Ventas del año ' + anio,
      indicador: 'importe',
      valorObjetivo: 240000,
      desde: `${anio}-01-01`,
      hasta: `${anio}-12-31`,
      responsable: 'Gerencia comercial',
      estado: 'vigente',
    })
    const equipo: { alcance: AsignacionInput['alcance']; objetivo: string; cuota: number }[] = [
      { alcance: 'vendedor', objetivo: 'Camila Rojas', cuota: 100000 },
      { alcance: 'vendedor', objetivo: 'Diego Torres', cuota: 80000 },
      { alcance: 'sucursal', objetivo: 'Sucursal San Isidro', cuota: 60000 },
    ]
    const creadas: Asignacion[] = []
    for (const item of equipo) {
      creadas.push(await guardarAsignacion({
        metaId: meta.id,
        alcance: item.alcance,
        objetivo: item.objetivo,
        valorObjetivo: item.cuota,
        estado: 'activa',
      }))
    }
    // Ritmo anual de ejemplo: fracción de la cuota lograda al cierre de cada mes.
    const ritmo = [0.06, 0.13, 0.21, 0.30, 0.36, 0.45, 0.55, 0.61, 0.70]
    const ultimoMes = Math.min(Math.max(Number(hoy.slice(5, 7)), 0), ritmo.length)
    for (const asignacion of creadas) {
      for (let mes = 1; mes <= ultimoMes; mes++) {
        const mesTexto = String(mes).padStart(2, '0')
        let fecha = `${anio}-${mesTexto}-${String(new Date(Number(anio), mes, 0).getDate()).padStart(2, '0')}`
        if (fecha > hoy) fecha = hoy
        await guardarCorte({
          asignacionId: asignacion.id,
          fecha,
          valorAcumulado: Math.round(asignacion.valorObjetivo * ritmo[mes - 1] * 100) / 100,
          fuente: 'ERP (demo)',
        })
      }
    }
  }

  async function guardarMeta(input: MetaInput & { id?: string }, item?: Meta): Promise<Meta> {
    const errores: Errores = {}
    const nombre = input.nombre.trim()
    if (!nombre) errores.nombre = 'Describe el objetivo de la meta.'
    else if (!CODIGO.test(nombre)) errores.nombre = 'Usa un nombre de hasta 80 caracteres.'
    if (!(input.valorObjetivo > 0)) errores.valorObjetivo = 'El valor objetivo debe ser mayor a cero.'
    if (!FECHA.test(input.desde)) errores.desde = 'Indica la fecha de inicio.'
    if (!FECHA.test(input.hasta)) errores.hasta = 'Indica la fecha de cierre.'
    if (FECHA.test(input.desde) && FECHA.test(input.hasta) && input.hasta <= input.desde) errores.hasta = 'El cierre debe ser posterior al inicio.'
    const codigo = (input.codigo || '').trim().toUpperCase() || siguienteCodigo(await listarMetas())
    if (!/^[A-Z0-9][A-Z0-9-]{0,15}$/.test(codigo)) errores.codigo = 'Código de hasta 16 caracteres (letras, números o guion).'
    if (Object.keys(errores).length) throw new ErrorValidacion('Revisa los campos marcados.', errores)
    const ahora = new Date().toISOString()
    const registro: Meta = {
      id: item?.id ?? nuevoId(),
      codigo,
      nombre,
      indicador: input.indicador,
      valorObjetivo: Math.round(input.valorObjetivo * 100) / 100,
      desde: input.desde,
      hasta: input.hasta,
      responsable: input.responsable.trim(),
      estado: input.estado,
      createdAt: item?.createdAt ?? ahora,
      updatedAt: ahora,
    }
    return almacen.metas.guardar(registro)
  }

  /** Eliminar una meta también elimina sus asignaciones y cortes (la meta cerrada conserva resultados; aquí sí se borra físicamente en modo local). */
  async function eliminarMeta(item: Meta) {
    const asignaciones = (await listarAsignaciones()).filter(a => a.metaId === item.id)
    for (const asignacion of asignaciones) {
      for (const corte of (await listarCortes()).filter(c => c.asignacionId === asignacion.id)) await almacen.cortes.eliminar(corte.id)
      await almacen.asignaciones.eliminar(asignacion.id)
    }
    await almacen.metas.eliminar(item.id)
  }

  async function guardarAsignacion(input: AsignacionInput & { id?: string }, item?: Asignacion): Promise<Asignacion> {
    const errores: Errores = {}
    const objetivo = input.objetivo.trim()
    if (!objetivo) errores.objetivo = `Indica el ${ALCANCES.find(a => a.value === input.alcance)?.label.toLowerCase() ?? 'objetivo'} asignado.`
    else if (!CODIGO.test(objetivo)) errores.objetivo = 'Usa un nombre de hasta 80 caracteres.'
    if (!(input.valorObjetivo > 0)) errores.valorObjetivo = 'La cuota debe ser mayor a cero.'
    const metas = await listarMetas()
    const meta = metas.find(m => m.id === input.metaId)
    if (!meta) errores.metaId = 'Selecciona la meta a la que pertenece la asignación.'
    else if (meta.estado !== 'vigente') errores.metaId = 'Solo se pueden asignar metas vigentes.'
    // Sin duplicar asignaciones para el mismo objetivo dentro de la misma meta.
    const asignaciones = await listarAsignaciones()
    const duplicada = asignaciones.some(a =>
      a.id !== item?.id && a.metaId === input.metaId && a.alcance === input.alcance
      && a.objetivo.toLocaleLowerCase('es') === objetivo.toLocaleLowerCase('es'))
    if (duplicada) errores.objetivo = 'Ya existe una asignación para este objetivo en la meta.'
    if (Object.keys(errores).length) throw new ErrorValidacion('Revisa los campos marcados.', errores)
    const ahora = new Date().toISOString()
    const registro: Asignacion = {
      id: item?.id ?? nuevoId(),
      metaId: input.metaId,
      alcance: input.alcance,
      objetivo,
      valorObjetivo: Math.round(input.valorObjetivo * 100) / 100,
      // La referencia solo vale para el objetivo con el que se eligió; si cambia el nombre a mano, se busca por nombre.
      referenciaId: input.referenciaId !== undefined ? input.referenciaId : (item && item.objetivo === objetivo ? item.referenciaId ?? null : null),
      estado: input.estado,
      createdAt: item?.createdAt ?? ahora,
      updatedAt: ahora,
    }
    return almacen.asignaciones.guardar(registro)
  }

  async function eliminarAsignacion(item: Asignacion) {
    for (const corte of (await listarCortes()).filter(c => c.asignacionId === item.id)) await almacen.cortes.eliminar(corte.id)
    await almacen.asignaciones.eliminar(item.id)
  }

  async function guardarCorte(input: CorteInput & { id?: string }, item?: Corte): Promise<Corte> {
    const errores: Errores = {}
    const asignaciones = await listarAsignaciones()
    const asignacion = asignaciones.find(a => a.id === input.asignacionId)
    if (!asignacion) errores.asignacionId = 'Selecciona la asignación que se está midiendo.'
    else {
      const meta = (await listarMetas()).find(m => m.id === asignacion.metaId)
      if (meta) {
        if (!FECHA.test(input.fecha)) errores.fecha = 'Indica la fecha de corte.'
        else if (input.fecha < meta.desde || input.fecha > meta.hasta) errores.fecha = `Debe estar entre ${meta.desde} y ${meta.hasta}.`
        else if (input.fecha > hoy) errores.fecha = 'La fecha de corte no puede ser futura.'
      }
    }
    if (!(input.valorAcumulado >= 0)) errores.valorAcumulado = 'El valor acumulado no puede ser negativo.'
    if (Object.keys(errores).length) throw new ErrorValidacion('Revisa los campos marcados.', errores)
    const ahora = new Date().toISOString()
    const registro: Corte = {
      id: item?.id ?? nuevoId(),
      asignacionId: input.asignacionId,
      fecha: input.fecha,
      valorAcumulado: Math.round(input.valorAcumulado * 100) / 100,
      fuente: input.fuente.trim(),
      createdAt: item?.createdAt ?? ahora,
      updatedAt: ahora,
    }
    return almacen.cortes.guardar(registro)
  }

  async function eliminarCorte(item: Corte) {
    await almacen.cortes.eliminar(item.id)
  }

  return {
    origen: almacen.origen,
    hoy,
    listarMetas,
    listarAsignaciones,
    listarCortes,
    guardarMeta,
    eliminarMeta,
    guardarAsignacion,
    eliminarAsignacion,
    guardarCorte,
    eliminarCorte,
    sembrarEjemplo,
  }
}
