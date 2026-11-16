import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOperationalAlertSnapshot, MAX_ALERTS_PER_SOURCE } from '../src/data/operationalAlerts.ts'

const permissions = new Set(['inventory', 'finance', 'purchases'])
const can = module => permissions.has(module)
const blankRecords = () => ({ inventory: [], finance: [], purchases: [] })
const formatters = {
  isStockAlert: record => record.quantity <= 5 || record.status === 'Crítico' || record.status === 'Bajo stock',
  money: amount => `S/ ${amount.toFixed(2)}`,
}

test('builds stable alerts for inventory, open accounts, and purchases', () => {
  const records = blankRecords()
  records.inventory = [{ rowId: 'product-row', id: 'SKU-1', name: 'Resina', status: 'Crítico', quantity: 0 }]
  records.finance = [{ rowId: 'account-row', id: 'CXC-1', name: 'Cliente', status: 'Pendiente', amount: 120, dueAt: '2026-11-10' }]
  records.purchases = [{ rowId: 'purchase-row', id: 'OC-1', name: 'Proveedor', status: 'Solicitud' }]

  const snapshot = buildOperationalAlertSnapshot(records, can, {}, false, '2026-11-12', formatters)

  assert.deepEqual(snapshot.sources, ['inventory', 'finance', 'purchases'])
  assert.deepEqual(snapshot.alerts.map(item => item.clave_fuente), ['product-row', 'account-row', 'purchase-row'])
  assert.deepEqual(snapshot.alerts.map(item => item.severidad), ['critical', 'critical', 'warning'])
  assert.equal(snapshot.alerts[0].referencia, 'SKU-1')
  assert.equal(snapshot.alerts[1].titulo, 'Cliente')
  assert.equal(snapshot.key, JSON.stringify({ sources: snapshot.sources, alerts: snapshot.alerts }))
})

test('keeps failed sources untouched and does not sync while records are loading', () => {
  const records = blankRecords()
  records.inventory = [{ rowId: 'product-row', id: 'SKU-1', name: 'Resina', status: 'Crítico', quantity: 0 }]

  const failed = buildOperationalAlertSnapshot(records, can, { inventory: 'query failed' }, false, '2026-11-12', formatters)
  const loading = buildOperationalAlertSnapshot(records, can, {}, true, '2026-11-12', formatters)

  assert.deepEqual(failed.sources, ['finance', 'purchases'])
  assert.deepEqual(loading.sources, [])
  assert.deepEqual(failed.readableSources, ['finance', 'purchases'])
  assert.deepEqual(loading.readableSources, [])
})

test('leaves a module in temporary view when its full alert snapshot exceeds the safe limit', () => {
  const records = blankRecords()
  records.inventory = Array.from({ length: MAX_ALERTS_PER_SOURCE + 1 }, (_, index) => ({
    rowId: `product-row-${index}`,
    id: `SKU-${index}`,
    name: `Product ${index}`,
    status: 'Crítico',
    quantity: 0,
  }))

  const snapshot = buildOperationalAlertSnapshot(records, can, {}, false, '2026-11-12', formatters)

  assert.deepEqual(snapshot.overflowSources, ['inventory'])
  assert.deepEqual(snapshot.sources, ['finance', 'purchases'])
  assert.equal(snapshot.alerts.length, 0)
  assert.equal(snapshot.alertsBySource.inventory.length, MAX_ALERTS_PER_SOURCE + 1)
})
