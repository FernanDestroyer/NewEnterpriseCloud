import assert from 'node:assert/strict'
import test from 'node:test'
import {
  demapearAsignacion, demapearConductor, demapearDespacho, demapearVehiculo, errorLogistica,
  mapearAsignacion, mapearConductor, mapearDespacho, mapearVehiculo,
} from '../src/modules/logistica/filas.ts'

const vehiculo = (extra = {}) => ({
  id: 'v1', placa: 'ABC-123', tipo: 'furgoneta', marca: 'Toyota', modelo: 'Hiace', capacidadKg: 1000, propiedad: 'propio',
  transportista: '', soatVence: '2027-06-01', revisionVence: '', estado: 'activo', observaciones: '', createdAt: '', updatedAt: '', ...extra,
})

test('vehículo: los documentos sin fecha viajan como null y vuelven como cadena vacía', () => {
  const fila = demapearVehiculo(vehiculo())
  assert.equal(fila.soat_vence, '2027-06-01')
  assert.equal(fila.revision_vence, null)
  assert.equal(fila.capacidad_kg, 1000)
  const vuelta = mapearVehiculo({ ...fila, created_at: '2026-10-28T10:00:00Z', updated_at: '2026-10-28T10:00:00Z' })
  assert.equal(vuelta.revisionVence, '')
  assert.equal(vuelta.soatVence, '2027-06-01')
  assert.equal(vuelta.capacidadKg, 1000)
  assert.equal(vuelta.createdAt, '2026-10-28T10:00:00Z')
})

test('vehículo: capacidad numérica que llega como texto se convierte a número', () => {
  assert.equal(mapearVehiculo({ id: 'v', capacidad_kg: '1500.50' }).capacidadKg, 1500.5)
})

test('conductor: ida y vuelta conserva los campos de licencia', () => {
  const conductor = {
    id: 'c1', nombre: 'Luis Pérez', documento: '12345678', telefono: '', licenciaNumero: 'Q1234', licenciaCategoria: 'A-IIb',
    licenciaVence: '2028-01-01', estado: 'activo', observaciones: '', createdAt: '', updatedAt: '',
  }
  const fila = demapearConductor(conductor)
  assert.equal(fila.licencia_numero, 'Q1234')
  assert.equal(fila.telefono, '')
  const vuelta = mapearConductor(fila)
  assert.equal(vuelta.licenciaCategoria, 'A-IIb')
  assert.equal(vuelta.licenciaVence, '2028-01-01')
  assert.equal(vuelta.telefono, '')
})

test('asignación: PostgREST devuelve segundos y la app espera YYYY-MM-DDTHH:mm', () => {
  const vuelta = mapearAsignacion({
    id: 'a1', vehiculo_id: 'v1', conductor_id: 'c1', desde: '2026-10-28T09:00:00', hasta: '2026-10-28T17:30:00',
    referencia: 'DSP-1', despacho_id: null, estado: 'programada', motivo_cancelacion: '',
  })
  assert.equal(vuelta.desde, '2026-10-28T09:00')
  assert.equal(vuelta.hasta, '2026-10-28T17:30')
  assert.equal(vuelta.despachoId, null)
  const fila = demapearAsignacion({ ...vuelta, despachoId: 'd1' })
  assert.equal(fila.despacho_id, 'd1')
  assert.equal(fila.desde, '2026-10-28T09:00')
})

test('asignación: si la fecha llega con espacio en vez de T se normaliza', () => {
  assert.equal(mapearAsignacion({ id: 'a', desde: '2026-10-28 09:00:00', hasta: '2026-10-28 10:00:00' }).desde, '2026-10-28T09:00')
})

const despacho = (extra = {}) => ({
  id: 'd1', numero: 'DSP-20261028-01', fecha: '2026-10-28', prioridad: 'alta', almacenId: null, almacenNombre: 'Principal',
  pesoEstimadoKg: null, observaciones: '', paradas: [{ id: 'p1', orden: 1, ventaId: 'vta1', ventaCodigo: 'VT-001', clienteId: null, clienteNombre: 'Ana', direccion: 'Av. 1', telefono: '', zonaId: null, zonaNombre: 'Norte', lineas: [] }],
  vehiculoId: null, conductorId: null, desde: '', hasta: '', asignacionId: null, estado: 'borrador', motivoCancelacion: '', createdAt: '', updatedAt: '', ...extra,
})

test('despacho borrador: horas vacías viajan como null y las paradas como JSON', () => {
  const fila = demapearDespacho(despacho())
  assert.equal(fila.desde, null)
  assert.equal(fila.hasta, null)
  assert.equal(fila.peso_estimado_kg, null)
  assert.equal(fila.almacen_id, null)
  assert.ok(Array.isArray(fila.paradas))
  const vuelta = mapearDespacho(fila)
  assert.equal(vuelta.desde, '')
  assert.equal(vuelta.pesoEstimadoKg, null)
  assert.equal(vuelta.paradas.length, 1)
  assert.equal(vuelta.paradas[0].ventaCodigo, 'VT-001')
})

test('despacho programado: peso numeric de la base llega como número', () => {
  const vuelta = mapearDespacho({
    id: 'd2', numero: 'DSP-1', fecha: '2026-10-28', prioridad: 'normal', peso_estimado_kg: '250.00', paradas: [],
    vehiculo_id: 'v1', conductor_id: 'c1', desde: '2026-10-28T08:00:00', hasta: '2026-10-28T12:00:00', asignacion_id: 'a1', estado: 'programado',
  })
  assert.equal(vuelta.pesoEstimadoKg, 250)
  assert.equal(vuelta.desde, '2026-10-28T08:00')
  assert.equal(vuelta.vehiculoId, 'v1')
  assert.equal(vuelta.estado, 'programado')
})

test('despacho: paradas que no son lista se tratan como vacías', () => {
  assert.deepEqual(mapearDespacho({ id: 'd', paradas: null }).paradas, [])
  assert.deepEqual(mapearDespacho({ id: 'd', paradas: 'x' }).paradas, [])
})

test('errores: cruce de horario distingue vehículo y conductor', () => {
  assert.match(errorLogistica({ code: '23P01', message: 'conflicting key value violates exclusion constraint "asignaciones_vehiculo_sin_cruce"' }).message, /vehículo ya tiene/)
  assert.match(errorLogistica({ code: '23P01', message: 'conflicting key value violates exclusion constraint "asignaciones_conductor_sin_cruce"' }).message, /conductor ya tiene/)
})

test('errores: duplicados con mensaje específico', () => {
  assert.match(errorLogistica({ code: '23505', message: 'duplicate key value violates unique constraint "vehiculos_placa_uk"' }).message, /misma placa|esa placa/)
  assert.match(errorLogistica({ code: '23505', message: 'duplicate key value violates unique constraint "conductores_documento_uk"' }).message, /ese documento/)
  assert.match(errorLogistica({ code: '23505', message: 'duplicate key value violates unique constraint "despachos_numero_uk"' }).message, /número de despacho/)
})

test('errores: las reglas del trigger (23514 en español) se muestran tal cual', () => {
  const msg = 'El SOAT del vehículo ABC-123 vence antes del fin de la asignación.'
  assert.equal(errorLogistica({ code: '23514', message: msg }).message, msg)
})

test('errores: un CHECK estándar de Postgres no se muestra en inglés', () => {
  const e = errorLogistica({ code: '23514', message: 'new row for relation "vehiculos" violates check constraint "vehiculos_placa_check"' })
  assert.doesNotMatch(e.message, /violates/)
})

test('errores: permisos y referencias', () => {
  assert.match(errorLogistica({ code: '42501', message: 'new row violates row-level security policy' }).message, /no tiene permiso/)
  assert.match(errorLogistica({ code: '23503', message: 'x' }).message, /ya no existe/)
  assert.match(errorLogistica(null).message, /No se pudo completar/)
})

// ---------- Almacén Supabase con un cliente simulado ----------
import { crearAlmacenSupabase, verificarAlmacen } from '../src/modules/logistica/almacenSupabase.ts'

/**
 * Cliente mínimo en memoria que imita la cadena de supabase-js usada por el almacén.
 * opciones.faltan: tablas inexistentes (error 42P01). opciones.sinUpdate: tablas donde RLS impide el UPDATE (0 filas).
 */
function clienteSimulado(opciones = {}) {
  const faltan = new Set(opciones.faltan ?? [])
  const sinUpdate = new Set(opciones.sinUpdate ?? [])
  const datos = new Map()
  const llamadas = []
  const filas = tabla => { if (!datos.has(tabla)) datos.set(tabla, []); return datos.get(tabla) }
  const errorTabla = { code: '42P01', message: 'relation does not exist' }

  function constructor(tabla) {
    const estado = { op: 'select', payload: null, id: null }
    const resolver = (modo) => {
      llamadas.push({ tabla, op: estado.op })
      if (faltan.has(tabla)) return { data: null, error: errorTabla }
      const lista = filas(tabla)
      if (estado.op === 'select') return { data: modo === 'limit' ? lista.slice(0, 1) : [...lista], error: null }
      if (estado.op === 'update') {
        if (sinUpdate.has(tabla)) return { data: null, error: null }
        const i = lista.findIndex(f => f.id === estado.id)
        if (i < 0) return { data: null, error: null }
        lista[i] = { ...lista[i], ...estado.payload, updated_at: 'actualizado' }
        return { data: lista[i], error: null }
      }
      if (lista.some(f => f.id === estado.payload.id)) {
        return { data: null, error: { code: '23505', message: `duplicate key value violates unique constraint "${tabla}_pkey"` } }
      }
      const nueva = { ...estado.payload, created_at: 'creado', updated_at: 'creado' }
      lista.push(nueva)
      return { data: nueva, error: null }
    }
    const api = {
      select() { return api },
      limit() { return Promise.resolve(resolver('limit')) },
      update(payload) { estado.op = 'update'; estado.payload = payload; return api },
      insert(payload) { estado.op = 'insert'; estado.payload = payload; return api },
      eq(_columna, valor) { estado.id = valor; return api },
      maybeSingle() { return Promise.resolve(resolver()) },
      single() { return Promise.resolve(resolver()) },
      then(ok, ko) { return Promise.resolve(resolver()).then(ok, ko) },
    }
    return api
  }
  return { from: constructor, datos, llamadas }
}

test('guardar: si la fila no existe hace UPDATE (0 filas) y luego INSERT', async () => {
  const cliente = clienteSimulado()
  const almacen = crearAlmacenSupabase(cliente)
  const guardado = await almacen.vehiculos.guardar(vehiculo())
  assert.equal(guardado.placa, 'ABC-123')
  assert.equal(guardado.createdAt, 'creado')
  assert.deepEqual(cliente.llamadas.map(l => l.op), ['update', 'insert'])
  assert.equal(cliente.datos.get('vehiculos').length, 1)
})

test('guardar: si la fila existe solo hace UPDATE y no duplica', async () => {
  const cliente = clienteSimulado()
  const almacen = crearAlmacenSupabase(cliente)
  await almacen.vehiculos.guardar(vehiculo())
  cliente.llamadas.length = 0
  const editado = await almacen.vehiculos.guardar(vehiculo({ marca: 'Hyundai' }))
  assert.equal(editado.marca, 'Hyundai')
  assert.deepEqual(cliente.llamadas.map(l => l.op), ['update'])
  assert.equal(cliente.datos.get('vehiculos').length, 1)
})

test('guardar: si RLS impide el UPDATE de una fila existente avisa de permisos y no de duplicado', async () => {
  const cliente = clienteSimulado({ sinUpdate: ['vehiculos'] })
  cliente.datos.set('vehiculos', [{ id: 'v1', placa: 'ABC-123' }])
  const almacen = crearAlmacenSupabase(cliente)
  await assert.rejects(() => almacen.vehiculos.guardar(vehiculo()), /no tiene permiso para modificar/)
})

test('listar: convierte las filas de la base a los tipos de la app', async () => {
  const cliente = clienteSimulado()
  cliente.datos.set('conductores', [{
    id: 'c1', nombre: 'Luis Pérez', documento: '12345678', telefono: '', licencia_numero: 'Q1234', licencia_categoria: 'A-IIb',
    licencia_vence: '2028-01-01', estado: 'activo', observaciones: '',
  }])
  const lista = await crearAlmacenSupabase(cliente).conductores.listar()
  assert.equal(lista.length, 1)
  assert.equal(lista[0].licenciaCategoria, 'A-IIb')
})

test('un error de la base al listar se traduce a un mensaje en español', async () => {
  const cliente = clienteSimulado({ faltan: ['vehiculos'] })
  await assert.rejects(() => crearAlmacenSupabase(cliente).vehiculos.listar(), /tablas de Logística/)
})

test('verificarAlmacen: sin Supabase todo queda en el navegador', async () => {
  const almacen = await verificarAlmacen(null, 'usuario-1')
  assert.equal(almacen.origen, 'navegador')
})

test('verificarAlmacen: con todas las tablas usa la base de datos', async () => {
  const almacen = await verificarAlmacen(clienteSimulado(), 'usuario-1')
  assert.equal(almacen.origen, 'base-de-datos')
  assert.ok(!almacen.despachosEnNavegador)
})

test('verificarAlmacen: sin la tabla despachos, flota en la base y despachos en el navegador', async () => {
  const almacen = await verificarAlmacen(clienteSimulado({ faltan: ['despachos'] }), 'usuario-1')
  assert.equal(almacen.origen, 'base-de-datos')
  assert.equal(almacen.despachosEnNavegador, true)
})

test('verificarAlmacen: sin tablas de flota todo queda en el navegador', async () => {
  const almacen = await verificarAlmacen(clienteSimulado({ faltan: ['vehiculos'] }), 'usuario-1')
  assert.equal(almacen.origen, 'navegador')
})
