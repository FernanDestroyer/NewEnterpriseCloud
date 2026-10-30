import assert from 'node:assert/strict'
import test from 'node:test'
import { coberturaVenta, despachadoPorProducto } from '../src/modules/logistica/despachos.ts'
import { crearDespachoService } from '../src/modules/logistica/despachoService.ts'
import { crearFlotaService, ErrorValidacion } from '../src/modules/logistica/flotaService.ts'
import { demapearDespacho, mapearDespacho } from '../src/modules/logistica/filas.ts'
import { devolucionesDe, estadoParada, motivosParaCompletar, resumenSeguimiento, validarEntrega } from '../src/modules/logistica/seguimiento.ts'
import { crearAlmacenLocal } from '../src/modules/logistica/storage.ts'

const parada = (id = 's1', extra = {}) => ({
  id, orden: 1, ventaId: `v-${id}`, ventaCodigo: `V-${id}`, clienteId: 'c1', clienteNombre: 'Ferretería Sol', direccion: 'Av. Lima 123', telefono: '987654321',
  zonaId: null, zonaNombre: '', lineas: [{ productoId: 'p1', codigo: 'PRD-001', nombre: 'Balde 20L', cantidadVendida: 10, cantidad: 10 }], ...extra,
})
const despacho = (extra = {}) => ({
  id: 'd1', numero: 'DSP-20990110-01', fecha: '2099-01-10', prioridad: 'normal', almacenId: null, almacenNombre: '', pesoEstimadoKg: null, observaciones: '',
  paradas: [parada('s1'), parada('s2')], vehiculoId: null, conductorId: null, desde: '', hasta: '', asignacionId: null, estado: 'programado', motivoCancelacion: '',
  createdAt: '', updatedAt: '', ...extra,
})
const entregaCompleta = { resultado: 'entregada', receptor: 'Juan Pérez', motivo: '', nota: '', cantidades: {} }

function servicio(inicial) {
  const almacen = crearAlmacenLocal(`seg-${Math.random()}`)
  const flota = crearFlotaService(almacen)
  return { almacen, svc: crearDespachoService(almacen, flota), guardar: item => almacen.despachos.guardar(item) }
}

test('validarEntrega exige receptor, motivo y cantidades coherentes', () => {
  const p = parada()
  assert.equal(validarEntrega(p, { ...entregaCompleta, receptor: ' ' }).campos.receptor !== undefined, true)
  assert.equal(validarEntrega(p, entregaCompleta).valido, true)
  assert.equal(validarEntrega(p, { resultado: 'no_entregada', receptor: '', motivo: '', nota: '', cantidades: {} }).campos.motivo !== undefined, true)
  assert.equal(validarEntrega(p, { resultado: 'no_entregada', receptor: '', motivo: 'otro', nota: '', cantidades: {} }).campos.nota !== undefined, true)
  assert.equal(validarEntrega(p, { resultado: 'parcial', receptor: 'Ana', motivo: 'rechazo', nota: '', cantidades: { p1: '4' } }).valido, true)
  assert.ok(validarEntrega(p, { resultado: 'parcial', receptor: 'Ana', motivo: 'rechazo', nota: '', cantidades: { p1: '10' } }).campos.cantidades)
  assert.ok(validarEntrega(p, { resultado: 'parcial', receptor: 'Ana', motivo: 'rechazo', nota: '', cantidades: { p1: '0' } }).campos.cantidades)
  assert.ok(validarEntrega(p, { resultado: 'parcial', receptor: 'Ana', motivo: 'rechazo', nota: '', cantidades: { p1: '11' } }).campos['cantidad-p1'])
})

test('flujo completo: iniciar ruta, registrar entregas, devolución y completar', async () => {
  const { almacen, svc, guardar } = servicio()
  await guardar(despacho())
  let d = (await svc.listar())[0]
  await assert.rejects(() => svc.registrarEntrega(d, 's1', entregaCompleta), ErrorValidacion) // aún no sale a ruta
  d = await svc.iniciarRuta(d)
  assert.equal(d.estado, 'en_ruta')
  assert.equal(d.eventos.length, 1)
  assert.ok(motivosParaCompletar(d)[0].includes('Faltan 2'))
  d = await svc.registrarEntrega(d, 's1', entregaCompleta)
  assert.equal(estadoParada(d.paradas[0]), 'entregada')
  assert.equal(d.paradas[0].devolucion, null)
  await assert.rejects(() => svc.registrarEntrega(d, 's1', entregaCompleta), /ya tiene su resultado/)
  d = await svc.registrarEntrega(d, 's2', { resultado: 'parcial', receptor: 'Ana', motivo: 'rechazo', nota: '', cantidades: { p1: '6' } })
  assert.equal(d.paradas[1].devolucion.estado, 'pendiente')
  const resumen = resumenSeguimiento(d)
  assert.equal(resumen.parciales, 1); assert.equal(resumen.unidadesDevueltas, 4); assert.equal(resumen.porcentaje, 1)
  assert.equal(devolucionesDe([d]).length, 1)
  d = await svc.confirmarReingreso(d, 's2', 'Recibido en almacén')
  assert.equal(d.paradas[1].devolucion.estado, 'reingresada')
  d = await svc.completar(d)
  assert.equal(d.estado, 'completado')
  assert.deepEqual(d.eventos.map(e => e.tipo), ['inicio_ruta', 'entrega', 'entrega', 'reingreso', 'completado'])
  assert.equal((await almacen.despachos.listar())[0].estado, 'completado')
})

test('no se puede completar con paradas pendientes ni iniciar un despacho que no está programado', async () => {
  const { svc } = servicio()
  await assert.rejects(() => svc.iniciarRuta(despacho({ estado: 'borrador' })), ErrorValidacion)
  await assert.rejects(() => svc.completar(despacho({ estado: 'en_ruta' })), /Faltan 2 paradas/)
})

test('lo no entregado vuelve a «Por despachar»', () => {
  const entregado = parada('s1', { entrega: { resultado: 'parcial', registradoEn: '', receptor: 'Ana', motivo: 'rechazo', nota: '', entregadas: { p1: 6 } } })
  const d = despacho({ estado: 'completado', paradas: [{ ...entregado, ventaId: 'v1' }] })
  assert.equal(despachadoPorProducto('v1', [d]).p1, 6)
  assert.equal(coberturaVenta('v1', [d]), 'parcial')
  const ninguna = parada('s1', { ventaId: 'v2', entrega: { resultado: 'no_entregada', registradoEn: '', receptor: '', motivo: 'ausente', nota: '', entregadas: { p1: 0 } } })
  assert.equal(despachadoPorProducto('v2', [despacho({ paradas: [ninguna] })]).p1, 0)
})

test('los eventos viajan a la base solo cuando existen y vuelven al leer', () => {
  const sin = demapearDespacho(despacho())
  assert.equal('eventos' in sin, false)
  const con = demapearDespacho(despacho({ eventos: [{ id: 'e1', tipo: 'inicio_ruta', fecha: '2099-01-10T13:00:00Z', detalle: 'x' }] }))
  assert.equal(con.eventos.length, 1)
  assert.equal(mapearDespacho({ ...con, created_at: '', updated_at: '' }).eventos.length, 1)
  assert.equal('eventos' in mapearDespacho({ ...sin, created_at: '', updated_at: '' }), false)
})
