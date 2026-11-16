import assert from 'node:assert/strict'
import test from 'node:test'
import { buildPepsValuationSnapshot } from '../src/data/inventoryPeps.ts'

const stock = (producto_id, almacen_id, stock_fisico, almacen_nombre = almacen_id) => ({ producto_id, almacen_id, stock_fisico, almacen_nombre })
const ledger = (producto_id, almacen_id, saldo_unidades, saldo_peps, problema = null) => ({ producto_id, almacen_id, saldo_unidades, saldo_peps, problema })

test('valoriza el último saldo PEPS conciliado por producto y almacén', () => {
  const result = buildPepsValuationSnapshot(
    [stock('p1', 'a1', 5), stock('p1', 'a2', 2), stock('p2', 'a1', 0)],
    [ledger('p1', 'a1', 5, 42.125), ledger('p1', 'a2', 2, 17.25)],
  )
  assert.equal(result.completo, true)
  assert.equal(result.valor_total, 59.38)
  assert.deepEqual(result.productos, [{ producto_id: 'p1', stock: 7, valor_peps: 59.38, ubicaciones: 2, problemas: 0 }])
})

test('oculta el total cuando falta una capa, el costo o coincide mal el saldo', () => {
  const result = buildPepsValuationSnapshot(
    [stock('p1', 'a1', 5), stock('p1', 'a2', 4), stock('p2', 'a1', 3)],
    [ledger('p1', 'a1', 5, null, 'sin-costo'), ledger('p1', 'a2', 2, 20, 'stock-no-coincide')],
  )
  assert.equal(result.completo, false)
  assert.equal(result.valor_total, null)
  assert.deepEqual(result.ubicaciones.map(row => row.problema), ['sin-costo', 'sin-kardex', 'stock-no-coincide'])
})

test('no publica una valorización cuando la base detecta movimientos simultáneos', () => {
  const result = buildPepsValuationSnapshot(
    [stock('p1', 'a1', 5)],
    [ledger('p1', 'a1', 5, null, 'fechas-empatadas')],
  )
  assert.equal(result.completo, false)
  assert.equal(result.valor_total, null)
  assert.equal(result.ubicaciones[0].problema, 'fechas-empatadas')
})
