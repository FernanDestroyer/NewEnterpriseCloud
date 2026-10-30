import assert from 'node:assert/strict'
import test from 'node:test'
import { asignacionesVinculadas, cortesDesdeVentas, fusionarCortes, FUENTE_VENTAS } from '../src/modules/metas/ventas.ts'

const manual = (asignacionId, fecha, valorAcumulado) => ({ id: `man-${asignacionId}-${fecha}`, asignacionId, fecha, valorAcumulado, fuente: 'Manual', createdAt: '', updatedAt: '' })

test('las filas de la base se convierten en cortes automáticos acumulados', () => {
  const cortes = cortesDesdeVentas([
    { asignacion_id: 'diego', fecha: '2026-11-01', valor_acumulado: '0.00' },
    { asignacion_id: 'diego', fecha: '2026-11-10', valor_acumulado: '5000.50' },
  ])
  assert.equal(cortes.length, 2)
  assert.equal(cortes[1].valorAcumulado, 5000.5)
  assert.equal(cortes[1].automatico, true)
  assert.equal(cortes[1].fuente, FUENTE_VENTAS)
  assert.deepEqual([...asignacionesVinculadas(cortes)], ['diego'])
})

test('lo enlazado usa solo ventas (aunque haya cortes manuales); lo demás conserva los manuales', () => {
  const autos = cortesDesdeVentas([{ asignacion_id: 'diego', fecha: '2026-11-01', valor_acumulado: 0 }])
  const efectivos = fusionarCortes([manual('diego', '2026-11-05', 9999), manual('jessica', '2026-11-05', 4000)], autos)
  assert.equal(efectivos.some(c => c.asignacionId === 'diego' && !c.automatico), false)
  assert.equal(efectivos.some(c => c.asignacionId === 'diego' && c.automatico), true)
  assert.equal(efectivos.some(c => c.asignacionId === 'jessica' && c.valorAcumulado === 4000), true)
})

test('sin filas automáticas todo sigue usando los cortes manuales', () => {
  const manuales = [manual('diego', '2026-11-05', 9999)]
  assert.deepEqual(fusionarCortes(manuales, []), manuales)
})

import { agruparAportes } from '../src/modules/metas/ventas.ts'

test('el aporte por vendedor se agrupa por sucursal, de mayor a menor, sin ceros', () => {
  const mapa = agruparAportes([
    { asignacion_id: 'miraflores', vendedor_id: 'u1', vendedor: 'Diego', valor: '500.00' },
    { asignacion_id: 'miraflores', vendedor_id: 'u2', vendedor: 'Ana', valor: 800 },
    { asignacion_id: 'miraflores', vendedor_id: 'u3', vendedor: 'Sin ventas', valor: 0 },
    { asignacion_id: 'surco', vendedor_id: null, vendedor: 'Sin vendedor', valor: 50 },
  ])
  assert.deepEqual(mapa.get('miraflores').map(item => [item.vendedor, item.valor]), [['Ana', 800], ['Diego', 500]])
  assert.equal(mapa.get('surco')[0].vendedorId, null)
  assert.equal(mapa.has('otra'), false)
})

import { agruparUbicaciones } from '../src/modules/metas/ventas.ts'

test('la ubicación del vendedor enlaza con la asignación de su sucursal', () => {
  const mapa = agruparUbicaciones([{ asignacion_id: 'diego', sucursal_id: 's1', sucursal: 'Miraflores', caja: 'Caja 1 (CJ-01)', sucursal_asignacion_id: 'asig-miraflores' }])
  assert.deepEqual(mapa.get('diego'), { sucursal: 'Miraflores', caja: 'Caja 1 (CJ-01)', sucursalAsignacionId: 'asig-miraflores' })
  assert.equal(mapa.get('otro'), undefined)
})
