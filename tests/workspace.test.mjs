import assert from 'node:assert/strict'
import test from 'node:test'
import { businessDate, dailyOperations, inDateRange, matchesSearch, periodRange } from '../src/data/workspace.ts'
import { financialSnapshot, totalAmount } from '../src/data/dashboard.ts'
import { csvContent } from '../src/data/exports.ts'

const record = (id, amount, createdAt, extra = {}) => ({ id, name: id, detail: '', date: 'Texto de presentación', status: 'Pendiente', amount, createdAt, ...extra })

test('los períodos y los registros usan el calendario de Perú, incluso al cruzar medianoche UTC', () => {
  assert.equal(businessDate('2026-10-10T02:00:00Z'), '2026-10-09')
  assert.deepEqual(periodRange('7', new Date('2026-10-10T02:00:00Z')), { from: '2026-10-03', to: '2026-10-09' })
  assert.equal(inDateRange(record('V-1', 12, '2026-10-10T02:00:00Z'), { from: '2026-10-09', to: '2026-10-09' }), true)
  assert.equal(inDateRange(record('V-2', 12, '2026-10-10T06:00:00Z'), { from: '2026-10-09', to: '2026-10-09' }), false)
})

test('un filtro abierto incluye todos los registros; un intervalo no inventa fechas a partir de etiquetas', () => {
  const missingDate = record('V-1', 25, undefined)
  assert.equal(inDateRange(missingDate, { from: '', to: '' }), true)
  assert.equal(inDateRange(missingDate, { from: '2026-10-01', to: '2026-10-10' }), false)
})

test('el gráfico agrega las mismas operaciones del período y completa los días sin movimientos con cero', () => {
  const sales = [record('V-1', 10, '2026-10-01T15:00:00Z'), record('V-2', 15, '2026-10-01T18:00:00Z'), record('V-3', 999, '2026-09-30T18:00:00Z')]
  const purchases = [record('OC-1', 8, '2026-10-03T15:00:00Z')]
  const original = structuredClone(sales)
  const { buckets } = dailyOperations(sales, purchases, { from: '2026-10-01', to: '2026-10-03' })
  assert.deepEqual(buckets, [{ date: '2026-10-01', sales: 25, purchases: 0 }, { date: '2026-10-02', sales: 0, purchases: 0 }, { date: '2026-10-03', sales: 0, purchases: 8 }])
  assert.deepEqual(sales, original)
})

test('los intervalos largos reducen puntos sin perder importes del gráfico', () => {
  const sales = [record('V-1', 0.1, '2026-01-01T15:00:00Z'), record('V-2', 0.2, '2026-12-31T15:00:00Z')]
  const { buckets, interval } = dailyOperations(sales, [], { from: '2026-01-01', to: '2026-12-31' })
  assert.ok(interval > 1)
  assert.ok(buckets.length <= 31)
  assert.ok(Math.abs(buckets.reduce((sum, item) => sum + item.sales, 0) - 0.3) < 1e-9)
  assert.equal(totalAmount(sales), 0.3)
})

test('finanzas utiliza el tipo persistido y excluye las cuentas canceladas de las deudas', () => {
  const result = financialSnapshot([record('FIN-1', 100, undefined, { financeType: 'cobrar' }), record('FIN-2', 40, undefined, { financeType: 'pagar' }), record('FIN-3', 60, undefined, { financeType: 'cobrar', status: 'Completada' })])
  assert.equal(result.receivable, 100)
  assert.equal(result.payable, 40)
  assert.equal(result.cajaIngresos, 60)
})

test('la búsqueda acepta acentos, códigos y RUC sin alterar el registro', () => {
  const item = record('PRV-001', 0, undefined, { name: 'Comercial Álvarez', ruc: '20123456789' })
  assert.equal(matchesSearch(item, 'alvarez'), true)
  assert.equal(matchesSearch(item, '20123456789'), true)
  assert.equal(matchesSearch(item, 'inexistente'), false)
})

test('el CSV conserva encabezados y decimales, escapa comillas y neutraliza fórmulas de texto', () => {
  const csv = csvContent(['Producto', 'Precio'], [['Monitor "Pro"', 12.5], ['=HYPERLINK("url")', 0], [' +SUM(1,2)', -5]])
  assert.ok(csv.startsWith('\ufeff"Producto","Precio"\r\n'))
  assert.ok(csv.includes('"Monitor ""Pro""","12.5"'))
  assert.ok(csv.includes('"\'=HYPERLINK(""url"")"'))
  assert.ok(csv.includes('"\' +SUM(1,2)","-5"'))
})
