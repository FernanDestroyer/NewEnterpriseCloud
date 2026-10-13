import assert from 'node:assert/strict'
import test from 'node:test'
import { buildSalesSeries, financialSnapshot, percentage, totalAmount } from '../src/data/dashboard.ts'

const record = (id, amount, status = 'Pendiente', detail = '') => ({ id, amount, status, detail, name: id, date: 'Registrado ahora' })

test('las cuentas completadas no forman parte de los compromisos pendientes', () => {
  const result = financialSnapshot([
    record('CXC-1', 300), record('CXC-2', 900, 'Completada'),
    record('CXP-1', 500, 'En curso'), record('CXP-2', 800, 'Completada'),
    record('FIN-1', 100, 'Pendiente', 'Cuenta por cobrar'),
    record('FIN-2', 50, 'Pendiente', 'Cuenta por pagar'),
    record('FIN-3', 75, 'Pendiente', 'Movimiento sin tipo'),
  ])
  assert.equal(result.receivable, 400)
  assert.equal(result.payable, 550)
  assert.equal(result.balance, -150)
  assert.equal(result.open.length, 5)
  assert.deepEqual(result.unclassified.map((item) => item.id), ['FIN-3'])
})

test('el acumulado recorre los registros del más antiguo al más reciente sin mutarlos', () => {
  const sales = [record('V-3', 50), record('V-2', 200, 'Completada'), record('V-1', 100, 'Completada')]
  const original = structuredClone(sales)
  const { points, total, ceiling } = buildSalesSeries(sales, 'all', 'cumulative')
  assert.deepEqual(points.map((point) => [point.item.id, point.value]), [['V-1', 100], ['V-2', 300], ['V-3', 350]])
  assert.equal(total, 350)
  assert.ok(ceiling >= 350)
  assert.deepEqual(sales, original)
})

test('las referencias financieras prevalecen y los conceptos ambiguos quedan sin clasificar', () => {
  const result = financialSnapshot([
    record('CXP-1', 200, 'Pendiente', 'Relacionada con cuenta por cobrar'),
    record('FIN-1', 150, 'Pendiente', 'Revisión de cuentas por cobrar y por pagar'),
  ])
  assert.equal(result.payable, 200)
  assert.equal(result.receivable, 0)
  assert.equal(result.unclassified.length, 1)
})

test('los filtros y la vista individual usan los importes de cada estado', () => {
  const sales = [record('V-3', 50), record('V-2', 200, 'En curso'), record('V-1', 100, 'Completada')]
  const open = buildSalesSeries(sales, 'open', 'individual')
  assert.deepEqual(open.points.map((point) => point.value), [200, 50])
  assert.equal(open.total, 250)
  const completed = buildSalesSeries(sales, 'completed', 'cumulative')
  assert.equal(completed.points.length, 1)
  assert.equal(completed.points[0].x, 50)
  assert.equal(completed.total, 100)
})

test('el gráfico limita la muestra y suma exclusivamente los registros visibles', () => {
  const sales = Array.from({ length: 20 }, (_, index) => record(`V-${20 - index}`, 20 - index))
  const result = buildSalesSeries(sales, 'all', 'cumulative')
  assert.equal(result.count, 20)
  assert.equal(result.visibleCount, 12)
  assert.equal(result.points[0].item.id, 'V-9')
  assert.equal(result.points.at(-1).item.id, 'V-20')
  assert.equal(result.total, 174)
})

test('las vistas vacías y los importes cero conservan escalas y porcentajes válidos', () => {
  assert.equal(percentage(0, 0), 0)
  assert.equal(percentage(1, 3), 33)
  assert.deepEqual(buildSalesSeries([], 'all', 'cumulative').points, [])
  const { points, ceiling } = buildSalesSeries([record('V-0', 0)], 'all', 'cumulative')
  assert.ok(Number.isFinite(points[0].y))
  assert.ok(ceiling > 0)
  assert.equal(financialSnapshot([]).balance, 0)
  assert.equal(totalAmount([record('V-1', undefined), record('V-2', NaN), record('V-3', 10)]), 10)
})
