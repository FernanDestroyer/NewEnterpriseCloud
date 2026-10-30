import assert from 'node:assert/strict'
import test from 'node:test'
import {
  coberturaVenta, construirParada, ESTADOS_VENTA_DESPACHABLES, moverParada, ordenarPorZona, puedeTransicionar, quitarParada, renumerar,
  siguienteNumero, unidadesDeDespacho, validarCantidadesContraOtros, validarDespacho, ventasDespachables, zonasDeRuta,
} from '../src/modules/logistica/despachos.ts'
import { crearDespachoService } from '../src/modules/logistica/despachoService.ts'
import { crearFlotaService, ErrorValidacion } from '../src/modules/logistica/flotaService.ts'
import { crearAlmacenLocal } from '../src/modules/logistica/storage.ts'

const linea = (extra = {}) => ({ productoId: 'p1', codigo: 'PRD-001', nombre: 'Balde 20L', cantidadVendida: 10, cantidad: 10, ...extra })
const parada = (extra = {}) => ({
  id: 's1', orden: 1, ventaId: 'v1', ventaCodigo: 'V-021', clienteId: 'c1', clienteNombre: 'Ferretería Sol', direccion: 'Av. Lima 123, Callao',
  telefono: '987654321', zonaId: 'z1', zonaNombre: 'Callao', lineas: [linea()], ...extra,
})
const despacho = (extra = {}) => ({
  id: 'd1', numero: 'DSP-20990110-01', fecha: '2099-01-10', prioridad: 'normal', almacenId: 'a1', almacenNombre: 'Central', pesoEstimadoKg: 500,
  observaciones: '', paradas: [parada()], vehiculoId: 'veh1', conductorId: 'con1', desde: '2099-01-10T08:00', hasta: '2099-01-10T12:00',
  asignacionId: null, estado: 'programado', motivoCancelacion: '', createdAt: '', updatedAt: '', ...extra,
})
const entrada = (extra = {}) => { const { id, numero, asignacionId, estado, motivoCancelacion, createdAt, updatedAt, ...resto } = despacho(); return { ...resto, ...extra } }
const vehiculoCap = (extra = {}) => ({ id: 'veh1', placa: 'ABC-123', capacidadKg: 1000, ...extra })

test('solo se listan ventas despachables, con dirección del cliente y su zona de reparto', () => {
  const ventas = [
    { id: 'V-001', rowId: 'r1', name: 'Ferretería Sol', date: '10/01/2099', status: 'Completada', amount: 150, cliente_id: 'c1' },
    { id: 'V-002', rowId: 'r2', name: 'Cliente crédito', date: '10/01/2099', status: 'Pendiente', amount: 80, cliente_id: 'c2' },
    { id: 'V-003', rowId: 'r3', name: 'Rechazada', date: '10/01/2099', status: 'Rechazada', amount: 10, cliente_id: 'c1' },
    { id: 'V-004', name: 'Sin rowId', date: '10/01/2099', status: 'Completada', amount: 10 },
  ]
  const clientes = [{ id: 'CLI-1', rowId: 'c1', name: 'Ferretería Sol', direccion: ' Av. Lima 123 ', telefono: '987654321', status: 'Activo' }]
  const lista = ventasDespachables(ventas, clientes, { c1: { id: 'z1', nombre: 'Callao' } })
  assert.deepEqual(lista.map(item => item.codigo), ['V-001', 'V-002'])
  assert.equal(lista[0].direccion, 'Av. Lima 123'); assert.equal(lista[0].zonaNombre, 'Callao')
  assert.equal(lista[1].direccion, ''); assert.equal(lista[1].zonaId, null)
  assert.ok(ESTADOS_VENTA_DESPACHABLES.includes('Pendiente'))
})

test('la cobertura de una venta distingue sin despacho, parcial y completa e ignora los cancelados', () => {
  assert.equal(coberturaVenta('v1', []), 'sin_despacho')
  const parcial = despacho({ paradas: [parada({ lineas: [linea({ cantidad: 4 })] })] })
  assert.equal(coberturaVenta('v1', [parcial]), 'parcial')
  const resto = despacho({ id: 'd2', paradas: [parada({ id: 's2', lineas: [linea({ cantidad: 6 })] })] })
  assert.equal(coberturaVenta('v1', [parcial, resto]), 'completa')
  assert.equal(coberturaVenta('v1', [parcial, despacho({ id: 'd2', estado: 'cancelado' })]), 'parcial')
  assert.equal(coberturaVenta('v1', [parcial, resto], 'd2'), 'parcial')
})

test('la parada se arma solo con lo que falta despachar y es nula si no queda nada', () => {
  const venta = { ventaId: 'v1', codigo: 'V-021', clienteId: 'c1', clienteNombre: 'Ferretería Sol', direccion: 'Av. Lima 123', telefono: '', zonaId: null, zonaNombre: '' }
  const lineas = [{ productoId: 'p1', codigo: 'PRD-001', nombre: 'Balde 20L', cantidad: 10 }, { productoId: 'p2', codigo: 'PRD-002', nombre: 'Tapa', cantidad: 3 }]
  const previo = despacho({ paradas: [parada({ lineas: [linea({ cantidad: 4 })] })] })
  const nueva = construirParada(venta, lineas, [previo], 's9')
  assert.deepEqual(nueva.lineas.map(item => [item.productoId, item.cantidad, item.cantidadVendida]), [['p1', 6, 10], ['p2', 3, 3]])
  const completo = despacho({ paradas: [parada({ lineas: [linea({ cantidad: 10 }), linea({ productoId: 'p2', cantidadVendida: 3, cantidad: 3 })] })] })
  assert.equal(construirParada(venta, lineas, [completo], 's9'), null)
  assert.ok(construirParada(venta, lineas, [completo], 's9', 'd1'))
})

test('las paradas se reordenan, se quitan y se agrupan por zona manteniendo el orden dentro de cada zona', () => {
  const a = parada({ id: 'a', ventaId: 'va', zonaNombre: 'Callao' })
  const b = parada({ id: 'b', ventaId: 'vb', zonaNombre: '' })
  const c = parada({ id: 'c', ventaId: 'vc', zonaNombre: 'Ate' })
  const d = parada({ id: 'd', ventaId: 'vd', zonaNombre: 'Callao' })
  assert.deepEqual(ordenarPorZona([a, b, c, d]).map(item => item.id), ['c', 'a', 'd', 'b'])
  assert.deepEqual(ordenarPorZona([a, b, c, d]).map(item => item.orden), [1, 2, 3, 4])
  assert.deepEqual(moverParada([a, b, c], 0, 1).map(item => item.id), ['b', 'a', 'c'])
  assert.deepEqual(moverParada([a, b, c], 0, -1).map(item => item.id), ['a', 'b', 'c'])
  assert.deepEqual(quitarParada([a, b, c], 1).map(item => [item.id, item.orden]), [['a', 1], ['c', 2]])
  assert.deepEqual(zonasDeRuta([a, b, c, d]), ['Callao', 'Sin zona', 'Ate'])
  assert.equal(renumerar([c, a])[1].orden, 2)
  assert.equal(unidadesDeDespacho({ paradas: [a, b] }), 20)
})

test('el número de despacho es correlativo por día', () => {
  assert.equal(siguienteNumero([], '2099-01-10'), 'DSP-20990110-01')
  assert.equal(siguienteNumero([despacho(), despacho({ id: 'd2', numero: 'DSP-20990110-07' })], '2099-01-10'), 'DSP-20990110-08')
  assert.equal(siguienteNumero([despacho()], '2099-01-11'), 'DSP-20990111-01')
})

test('un borrador solo exige fecha y paradas con cantidades válidas', () => {
  assert.equal(validarDespacho(entrada(), { modo: 'borrador' }).valido, true)
  assert.ok(validarDespacho(entrada({ fecha: '' }), { modo: 'borrador' }).campos.fecha)
  assert.ok(validarDespacho(entrada({ paradas: [] }), { modo: 'borrador' }).campos.paradas)
  assert.match(validarDespacho(entrada({ paradas: [parada({ lineas: [linea({ cantidad: 11 })] })] }), { modo: 'borrador' }).motivos.join(' '), /más de lo vendido/)
  assert.match(validarDespacho(entrada({ paradas: [parada({ lineas: [linea({ cantidad: 1.5 })] })] }), { modo: 'borrador' }).motivos.join(' '), /entero/)
  assert.match(validarDespacho(entrada({ paradas: [parada({ lineas: [linea({ cantidad: 0 })] })] }), { modo: 'borrador' }).motivos.join(' '), /no tiene productos/)
  assert.match(validarDespacho(entrada({ paradas: [parada(), parada({ id: 's2' })] }), { modo: 'borrador' }).motivos.join(' '), /repetida/)
  assert.ok(validarDespacho(entrada({ pesoEstimadoKg: 0 }), { modo: 'borrador' }).campos.pesoEstimadoKg)
})

test('programar exige dirección, vehículo, conductor, mismo día y respeta la capacidad', () => {
  const ok = validarDespacho(entrada(), { modo: 'programar', vehiculo: vehiculoCap() })
  assert.equal(ok.valido, true)
  assert.match(validarDespacho(entrada({ paradas: [parada({ direccion: '' })] }), { modo: 'programar', vehiculo: vehiculoCap() }).motivos.join(' '), /Falta la dirección/)
  const sin = validarDespacho(entrada({ vehiculoId: null, conductorId: null }), { modo: 'programar' })
  assert.ok(sin.campos.vehiculoId && sin.campos.conductorId)
  assert.ok(validarDespacho(entrada({ desde: '2099-01-11T08:00' }), { modo: 'programar', vehiculo: vehiculoCap() }).campos.desde)
  assert.match(validarDespacho(entrada({ pesoEstimadoKg: 1500 }), { modo: 'programar', vehiculo: vehiculoCap() }).motivos.join(' '), /supera la capacidad/)
  assert.match(validarDespacho(entrada({ pesoEstimadoKg: null }), { modo: 'programar', vehiculo: vehiculoCap() }).avisos.join(' '), /Sin peso estimado/)
})

test('las cantidades se comparan con lo que ya viaja en otros despachos', () => {
  const otro = despacho({ id: 'd2', paradas: [parada({ lineas: [linea({ cantidad: 8 })] })] })
  const motivos = validarCantidadesContraOtros([parada({ lineas: [linea({ cantidad: 3 })] })], [otro], 'd1')
  assert.match(motivos.join(' '), /ya hay 8 unidad.*solo quedan 2/)
  assert.deepEqual(validarCantidadesContraOtros([parada({ lineas: [linea({ cantidad: 2 })] })], [otro], 'd1'), [])
  assert.deepEqual(validarCantidadesContraOtros([parada({ lineas: [linea({ cantidad: 10 })] })], [otro], 'd2'), [])
})

test('las transiciones de estado solo permiten los caminos válidos', () => {
  assert.equal(puedeTransicionar('borrador', 'programado'), true)
  assert.equal(puedeTransicionar('programado', 'cancelado'), true)
  assert.equal(puedeTransicionar('programado', 'borrador'), false)
  assert.equal(puedeTransicionar('cancelado', 'programado'), false)
  assert.equal(puedeTransicionar('completado', 'cancelado'), false)
})

// ---------- Servicio sobre el almacén local ----------
let contador = 0
async function escenario() {
  const almacen = crearAlmacenLocal(`despachos-${Date.now()}-${contador++}`)
  const flota = crearFlotaService(almacen)
  const servicio = crearDespachoService(almacen, flota)
  const vehiculo = await flota.guardarVehiculo({ placa: 'abc123', tipo: 'furgoneta', marca: 'Hyundai', modelo: 'H100', capacidadKg: 1000, propiedad: 'propio', transportista: '', soatVence: '2099-12-31', revisionVence: '2099-12-31', estado: 'activo', observaciones: '' })
  const conductor = await flota.guardarConductor({ nombre: 'Luis Pérez', documento: '12345678', telefono: '', licenciaNumero: 'Q123', licenciaCategoria: 'A-IIb', licenciaVence: '2099-12-31', estado: 'activo', observaciones: '' })
  const base = { ...entrada(), vehiculoId: vehiculo.id, conductorId: conductor.id }
  return { almacen, flota, servicio, vehiculo, conductor, base }
}
const rechaza = async (promesa, patron) => {
  await assert.rejects(promesa, error => { assert.ok(error instanceof ErrorValidacion); assert.match(`${error.message} ${JSON.stringify(error.campos)} ${error.motivos.join(' ')}`, patron); return true })
}

test('guardar borrador numera el despacho, no reserva flota y solo permite editar borradores', async () => {
  const { servicio, flota, base } = await escenario()
  const borrador = await servicio.guardarBorrador(base)
  assert.equal(borrador.estado, 'borrador'); assert.equal(borrador.numero, 'DSP-20990110-01'); assert.equal(borrador.asignacionId, null)
  assert.equal((await flota.listarAsignaciones()).length, 0)
  const editado = await servicio.guardarBorrador({ ...base, observaciones: ' con prisa ' }, borrador)
  assert.equal(editado.id, borrador.id); assert.equal(editado.numero, borrador.numero); assert.equal(editado.observaciones, 'con prisa')
  await rechaza(servicio.guardarBorrador(base), /ya hay 10 unidad/)
  const otro = await servicio.guardarBorrador({ ...base, paradas: [parada({ id: 's2', ventaId: 'v2', ventaCodigo: 'V-022' })] })
  assert.equal(otro.numero, 'DSP-20990110-02')
  const programado = await servicio.programar(base, editado)
  await rechaza(servicio.guardarBorrador(base, programado), /borrador/)
})

test('programar crea la asignación del vehículo y conductor ligada al despacho', async () => {
  const { servicio, flota, base } = await escenario()
  const programado = await servicio.programar(base)
  assert.equal(programado.estado, 'programado')
  const [asignacion] = await flota.listarAsignaciones()
  assert.equal(asignacion.id, programado.asignacionId); assert.equal(asignacion.despachoId, programado.id)
  assert.equal(asignacion.referencia, programado.numero); assert.equal(asignacion.estado, 'programada')
  await rechaza(flota.cancelarAsignacion(asignacion, 'manual'), /pertenece a un despacho/)
  await rechaza(flota.completarAsignacion(asignacion), /despacho/)
})

test('programar no guarda nada si el vehículo ya está ocupado, supera la capacidad o falta información', async () => {
  const { servicio, flota, almacen, base } = await escenario()
  await servicio.programar(base)
  const otraVenta = { ...base, paradas: [parada({ id: 's2', ventaId: 'v2', ventaCodigo: 'V-022' })], desde: '2099-01-10T10:00', hasta: '2099-01-10T13:00' }
  await rechaza(servicio.programar(otraVenta), /vehículo ya tiene/)
  await rechaza(servicio.programar({ ...otraVenta, desde: '2099-01-10T14:00', hasta: '2099-01-10T16:00', pesoEstimadoKg: 2000 }), /supera la capacidad/)
  await rechaza(servicio.programar({ ...otraVenta, desde: '2099-01-10T14:00', hasta: '2099-01-10T16:00', paradas: [parada({ id: 's2', ventaId: 'v2', direccion: '' })] }), /Falta la dirección/)
  assert.equal((await almacen.despachos.listar()).length, 1)
  assert.equal((await flota.listarAsignaciones()).length, 1)
})

test('una venta puede despacharse en partes pero nunca más de lo vendido', async () => {
  const { servicio, base } = await escenario()
  await servicio.programar({ ...base, paradas: [parada({ lineas: [linea({ cantidad: 7 })] })] })
  const segundo = { ...base, desde: '2099-01-10T14:00', hasta: '2099-01-10T16:00', paradas: [parada({ id: 's2', lineas: [linea({ cantidad: 4 })] })] }
  await rechaza(servicio.programar(segundo), /ya hay 7 unidad.*solo quedan 3/)
  const ok = await servicio.programar({ ...segundo, paradas: [parada({ id: 's2', lineas: [linea({ cantidad: 3 })] })] })
  assert.equal(ok.estado, 'programado')
})

test('cancelar un despacho programado libera el vehículo y el conductor', async () => {
  const { servicio, flota, base } = await escenario()
  const programado = await servicio.programar(base)
  await rechaza(servicio.cancelar(programado, '  '), /motivo/i)
  const cancelado = await servicio.cancelar(programado, 'Cliente no recibe')
  assert.equal(cancelado.estado, 'cancelado'); assert.equal(cancelado.motivoCancelacion, 'Cliente no recibe')
  const [asignacion] = await flota.listarAsignaciones()
  assert.equal(asignacion.estado, 'cancelada'); assert.match(asignacion.motivoCancelacion, /DSP-20990110-01/)
  await rechaza(servicio.cancelar(cancelado, 'otra vez'), /ya no se puede cancelar/)
  const reprogramado = await servicio.programar({ ...base, paradas: [parada({ id: 's5' })] })
  assert.equal(reprogramado.estado, 'programado')
  assert.equal(reprogramado.numero, 'DSP-20990110-02')
})

test('cancelar un borrador no toca la flota', async () => {
  const { servicio, flota, base } = await escenario()
  const borrador = await servicio.guardarBorrador(base)
  const cancelado = await servicio.cancelar(borrador, 'Ya no se necesita')
  assert.equal(cancelado.estado, 'cancelado')
  assert.equal((await flota.listarAsignaciones()).length, 0)
  assert.deepEqual((await servicio.listar()).map(item => item.estado), ['cancelado'])
})
