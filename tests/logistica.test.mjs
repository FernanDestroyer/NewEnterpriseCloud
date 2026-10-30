import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ahoraLima, documentosEnAtencion, formatearPlaca, formatoFecha, licenciaPermite, normalizarConductor, normalizarPlaca, normalizarVehiculo,
  placaValida, seSuperponen, sumarHoras, validarAsignacion, validarConductor, validarVehiculo, vigenciaDocumento,
} from '../src/modules/logistica/rules.ts'
import { crearAlmacenLocal } from '../src/modules/logistica/storage.ts'
import { crearFlotaService, ErrorValidacion } from '../src/modules/logistica/flotaService.ts'

const HOY = '2026-10-27'
const AHORA = '2026-10-27T09:00'
const vehiculo = (extra = {}) => ({
  id: 'v1', placa: 'ABC-123', tipo: 'furgoneta', marca: 'Hyundai', modelo: 'H100', capacidadKg: 1000, propiedad: 'propio',
  transportista: '', soatVence: '2027-06-01', revisionVence: '2027-06-01', estado: 'activo', observaciones: '', createdAt: '', updatedAt: '', ...extra,
})
const conductor = (extra = {}) => ({
  id: 'c1', nombre: 'Luis Pérez', documento: '12345678', telefono: '987654321', licenciaNumero: 'Q12345678', licenciaCategoria: 'A-IIb',
  licenciaVence: '2028-01-01', estado: 'activo', observaciones: '', createdAt: '', updatedAt: '', ...extra,
})
const asignacion = (extra = {}) => ({
  id: 'a1', vehiculoId: 'v1', conductorId: 'c1', desde: '2026-10-28T08:00', hasta: '2026-10-28T12:00', referencia: '', estado: 'programada',
  motivoCancelacion: '', createdAt: '', updatedAt: '', ...extra,
})
const args = (extra = {}) => ({ vehiculo: vehiculo(), conductor: conductor(), desde: '2026-10-28T08:00', hasta: '2026-10-28T12:00', ahora: AHORA, asignaciones: [], ...extra })

test('la placa se normaliza, valida y formatea', () => {
  assert.equal(normalizarPlaca(' abc-123 '), 'ABC123')
  assert.equal(formatearPlaca('abc123'), 'ABC-123')
  assert.equal(placaValida('B7K-210'), true)
  assert.equal(placaValida('AB-12'), false)
})

test('la licencia habilita solo los vehículos que corresponden', () => {
  assert.equal(licenciaPermite('A-I', 'furgoneta'), true)
  assert.equal(licenciaPermite('A-I', 'camion'), false)
  assert.equal(licenciaPermite('A-IIb', 'camion'), true)
  assert.equal(licenciaPermite('B-IIb', 'moto'), true)
  assert.equal(licenciaPermite('B-IIb', 'furgoneta'), false)
  assert.equal(licenciaPermite('A-I', 'otro'), true)
})

test('dos horarios se superponen solo si realmente se cruzan', () => {
  assert.equal(seSuperponen('2026-10-28T08:00', '2026-10-28T12:00', '2026-10-28T11:00', '2026-10-28T13:00'), true)
  assert.equal(seSuperponen('2026-10-28T08:00', '2026-10-28T12:00', '2026-10-28T12:00', '2026-10-28T14:00'), false)
})

test('la vigencia distingue vigente, por vencer, vencido y sin dato', () => {
  assert.equal(vigenciaDocumento('2027-06-01', HOY), 'vigente')
  assert.equal(vigenciaDocumento('2026-11-10', HOY), 'por_vencer')
  assert.equal(vigenciaDocumento('2026-10-27', HOY), 'por_vencer')
  assert.equal(vigenciaDocumento('2026-10-26', HOY), 'vencido')
  assert.equal(vigenciaDocumento('', HOY), 'sin_dato')
})

test('la hora actual se toma de Lima, no de UTC', () => {
  assert.equal(ahoraLima(new Date('2026-10-28T02:30:00Z')), '2026-10-27T21:30')
  assert.equal(sumarHoras('2026-10-27T22:00', 4), '2026-10-28T02:00')
})

test('las fechas se muestran como dd/mm/aaaa', () => {
  assert.equal(formatoFecha('2026-10-28'), '28/10/2026')
  assert.equal(formatoFecha('2026-10-28T08:05'), '28/10/2026 08:05')
  assert.equal(formatoFecha(''), '—')
})

test('un vehículo válido no tiene errores; placa duplicada y datos faltantes se detectan', () => {
  const ok = normalizarVehiculo(vehiculo({ id: undefined, placa: 'xyz987' }))
  assert.deepEqual(validarVehiculo(ok, [vehiculo()]), {})
  assert.match(validarVehiculo(normalizarVehiculo(vehiculo({ placa: 'abc123' })), [vehiculo({ id: 'otro' })]).placa, /Ya existe/)
  assert.deepEqual(validarVehiculo(normalizarVehiculo(vehiculo({ placa: 'abc123' })), [vehiculo()], 'v1'), {})
  const malo = validarVehiculo(normalizarVehiculo(vehiculo({ marca: '', capacidadKg: 0, propiedad: 'tercero', transportista: '' })), [])
  assert.ok(malo.marca && malo.capacidadKg && malo.transportista)
})

test('un conductor valida DNI, teléfono, licencia y duplicados', () => {
  const ok = normalizarConductor(conductor({ telefono: '987 654 321', documento: '12.345.678' }))
  assert.equal(ok.telefono, '987654321')
  assert.deepEqual(validarConductor(ok, []), {})
  assert.match(validarConductor(ok, [conductor({ id: 'otro' })]).documento, /Ya existe/)
  const malo = validarConductor(normalizarConductor(conductor({ documento: '123', licenciaCategoria: 'Z', licenciaVence: '' })), [])
  assert.ok(malo.documento && malo.licenciaCategoria && malo.licenciaVence)
})

test('una asignación correcta es válida y avisa si el inicio ya pasó', () => {
  assert.equal(validarAsignacion(args()).valido, true)
  const pasada = validarAsignacion(args({ desde: '2026-10-27T07:00', hasta: '2026-10-27T08:00' }))
  assert.equal(pasada.valido, true)
  assert.match(pasada.avisos.join(' '), /ya pasó/)
})

test('faltan datos o el fin no es posterior al inicio', () => {
  assert.ok(validarAsignacion(args({ vehiculo: undefined })).campos.vehiculoId)
  assert.ok(validarAsignacion(args({ conductor: undefined })).campos.conductorId)
  assert.ok(validarAsignacion(args({ hasta: '2026-10-28T08:00' })).campos.hasta)
})

test('documentos que vencen antes del fin de la asignación la bloquean', () => {
  const soat = validarAsignacion(args({ vehiculo: vehiculo({ soatVence: '2026-10-28' }) }))
  assert.equal(soat.valido, true)
  const vencido = validarAsignacion(args({ vehiculo: vehiculo({ soatVence: '2026-10-20' }), conductor: conductor({ licenciaVence: '2026-10-20' }) }))
  assert.equal(vencido.valido, false)
  assert.match(vencido.motivos.join(' '), /SOAT vence el 20\/10\/2026/)
  assert.match(vencido.motivos.join(' '), /licencia de Luis Pérez vence/)
  assert.match(validarAsignacion(args({ vehiculo: vehiculo({ revisionVence: '' }) })).avisos.join(' '), /revisión técnica/)
})

test('un vehículo en mantenimiento, un conductor inactivo o una licencia que no corresponde bloquean', () => {
  assert.equal(validarAsignacion(args({ vehiculo: vehiculo({ estado: 'mantenimiento' }) })).valido, false)
  assert.equal(validarAsignacion(args({ conductor: conductor({ estado: 'inactivo' }) })).valido, false)
  const camion = validarAsignacion(args({ vehiculo: vehiculo({ tipo: 'camion' }), conductor: conductor({ licenciaCategoria: 'A-I' }) }))
  assert.match(camion.motivos.join(' '), /no habilita/)
})

test('no se permiten cruces de horario del vehículo ni del conductor; los horarios contiguos sí', () => {
  const previa = asignacion()
  const choqueVehiculo = validarAsignacion(args({ asignaciones: [previa], conductor: conductor({ id: 'c2', nombre: 'Ana Ruiz' }), desde: '2026-10-28T11:00', hasta: '2026-10-28T13:00' }))
  assert.match(choqueVehiculo.motivos.join(' '), /vehículo ya tiene/)
  const choqueConductor = validarAsignacion(args({ asignaciones: [previa], vehiculo: vehiculo({ id: 'v2', placa: 'XYZ-987' }), desde: '2026-10-28T11:00', hasta: '2026-10-28T13:00' }))
  assert.match(choqueConductor.motivos.join(' '), /Luis Pérez ya tiene/)
  assert.equal(validarAsignacion(args({ asignaciones: [previa], desde: '2026-10-28T12:00', hasta: '2026-10-28T14:00' })).valido, true)
  assert.equal(validarAsignacion(args({ asignaciones: [asignacion({ estado: 'cancelada' })] })).valido, true)
  assert.equal(validarAsignacion(args({ asignaciones: [previa], ignorarId: 'a1' })).valido, true)
})

test('el resumen cuenta solo documentos de vehículos y conductores activos que requieren atención', () => {
  const vehiculos = [vehiculo({ soatVence: '2026-11-10' }), vehiculo({ id: 'v2', revisionVence: '', estado: 'inactivo' })]
  const conductores = [conductor({ licenciaVence: '2026-08-01' }), conductor({ id: 'c2', estado: 'inactivo', licenciaVence: '' })]
  assert.equal(documentosEnAtencion(vehiculos, conductores, HOY), 2)
})

// ---------- Servicio sobre el almacén local (memoria, sin localStorage en Node) ----------
let contador = 0
const servicio = () => crearFlotaService(crearAlmacenLocal(`prueba-${Date.now()}-${contador++}`))
const veh = (extra = {}) => ({ placa: 'abc123', tipo: 'furgoneta', marca: ' Hyundai ', modelo: 'H100', capacidadKg: 1000, propiedad: 'propio', transportista: '', soatVence: '2099-12-31', revisionVence: '2099-12-31', estado: 'activo', observaciones: '', ...extra })
const con = (extra = {}) => ({ nombre: '  Luis   Pérez ', documento: '12345678', telefono: '987 654 321', licenciaNumero: 'q-123', licenciaCategoria: 'A-IIb', licenciaVence: '2099-12-31', estado: 'activo', observaciones: '', ...extra })
const rechaza = async (promesa, patron) => {
  await assert.rejects(promesa, error => { assert.ok(error instanceof ErrorValidacion); assert.match(`${error.message} ${JSON.stringify(error.campos)} ${error.motivos.join(' ')}`, patron); return true })
}

test('el servicio normaliza y guarda vehículos y conductores, y rechaza duplicados', async () => {
  const f = servicio()
  const v = await f.guardarVehiculo(veh())
  assert.equal(v.placa, 'ABC-123'); assert.equal(v.marca, 'Hyundai')
  await rechaza(f.guardarVehiculo(veh({ placa: 'ABC-123' })), /Ya existe/)
  const c = await f.guardarConductor(con())
  assert.equal(c.nombre, 'Luis Pérez'); assert.equal(c.telefono, '987654321'); assert.equal(c.licenciaNumero, 'Q123')
  await rechaza(f.guardarConductor(con()), /Ya existe/)
  const editado = await f.guardarVehiculo(veh({ modelo: 'H200' }), v)
  assert.equal(editado.id, v.id); assert.equal((await f.listarVehiculos()).length, 1)
})

test('el servicio crea asignaciones sin cruces y no deja inactivar recursos con asignaciones programadas', async () => {
  const f = servicio()
  const v = await f.guardarVehiculo(veh())
  const c1 = await f.guardarConductor(con())
  const c2 = await f.guardarConductor(con({ nombre: 'Ana Ruiz', documento: '87654321' }))
  const base = { vehiculoId: v.id, conductorId: c1.id, desde: '2099-01-10T08:00', hasta: '2099-01-10T12:00', referencia: ' pedido 1 ' }
  const a = await f.crearAsignacion(base)
  assert.equal(a.referencia, 'pedido 1'); assert.equal(a.estado, 'programada')
  await rechaza(f.crearAsignacion({ ...base, conductorId: c2.id, desde: '2099-01-10T11:00', hasta: '2099-01-10T13:00' }), /vehículo ya tiene/)
  await rechaza(f.crearAsignacion({ ...base, vehiculoId: 'otro' }), /Elige un vehículo/)
  await f.crearAsignacion({ ...base, conductorId: c2.id, desde: '2099-01-10T12:00', hasta: '2099-01-10T14:00' })
  await rechaza(f.guardarVehiculo(veh({ estado: 'mantenimiento' }), v), /asignaci/)
  await rechaza(f.guardarConductor(con({ estado: 'inactivo' }), c1), /asignaci/)
  await rechaza(f.cancelarAsignacion(a, '  '), /motivo/i)
  const cancelada = await f.cancelarAsignacion(a, 'Cliente reprogramó')
  assert.equal(cancelada.estado, 'cancelada')
  await rechaza(f.cancelarAsignacion(cancelada, 'otra vez'), /programadas/)
  await f.crearAsignacion(base)
  const ok = await f.guardarVehiculo(veh({ estado: 'activo', modelo: 'H300' }), v)
  assert.equal(ok.modelo, 'H300')
})

test('completar una asignación la cierra y deja libre el horario solo si fue cancelada', async () => {
  const f = servicio()
  const v = await f.guardarVehiculo(veh())
  const c = await f.guardarConductor(con())
  const a = await f.crearAsignacion({ vehiculoId: v.id, conductorId: c.id, desde: '2099-02-01T08:00', hasta: '2099-02-01T10:00', referencia: '' })
  const hecha = await f.completarAsignacion(a)
  assert.equal(hecha.estado, 'completada')
  await rechaza(f.completarAsignacion(hecha), /programadas/)
  assert.equal((await f.listarAsignaciones())[0].estado, 'completada')
})
