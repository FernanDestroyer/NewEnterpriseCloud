import assert from 'node:assert/strict'
import test from 'node:test'
import { requiresTreasuryPermission } from '../src/data/operationPermissions.ts'

test('crear una compra no requiere permiso de Tesorería para su CxP derivada', () => {
  assert.equal(requiresTreasuryPermission({ operation: 'purchase', editing: false, status: 'Pendiente', total: 118 }), false)
})

test('crear una venta pendiente o a crédito no requiere permiso de Tesorería', () => {
  assert.equal(requiresTreasuryPermission({ operation: 'sale', editing: false, status: 'Pendiente', paymentMethod: 'Efectivo', total: 118 }), false)
  assert.equal(requiresTreasuryPermission({ operation: 'sale', editing: false, status: 'Completada', paymentMethod: 'Tarjeta', total: 118 }), false)
})

test('un cobro inmediato positivo requiere Tesorería', () => {
  assert.equal(requiresTreasuryPermission({ operation: 'sale', editing: false, status: 'Completada', paymentMethod: 'Efectivo', total: 118 }), true)
  assert.equal(requiresTreasuryPermission({ operation: 'sale', editing: false, status: 'Completada', paymentMethod: 'Yape', total: 118 }), true)
})

test('editar una operación con cuenta vinculada mantiene el permiso de Tesorería', () => {
  assert.equal(requiresTreasuryPermission({ operation: 'purchase', editing: true, status: 'Pendiente', total: 118 }), true)
  assert.equal(requiresTreasuryPermission({ operation: 'sale', editing: true, status: 'Pendiente', paymentMethod: 'Tarjeta', total: 118 }), true)
})
