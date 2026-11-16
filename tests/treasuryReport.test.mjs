import assert from 'node:assert/strict'
import test from 'node:test'
import { buildTreasuryMovementReport, isCompleteMovementSet, peruDateBounds, treasuryMovementCsvRows } from '../src/data/treasuryReport.ts'
import { csvContent } from '../src/data/exports.ts'

const movement = (overrides) => ({
  id: 'movement-1', codigo: 'MOV-001', tipo: 'cobro', monto: 0, moneda: null, medio_pago: 'Efectivo',
  referencia: null, created_at: '2026-10-13T02:00:00.000Z', anulado_en: null,
  ...overrides,
})

test('convierte fechas de negocio de Perú en límites UTC inclusivo/exclusivo', () => {
  assert.deepEqual(peruDateBounds({ from: '2026-10-12', to: '2026-10-13' }), {
    fromInclusive: '2026-10-12T05:00:00.000Z',
    toExclusive: '2026-10-14T05:00:00.000Z',
  })
  assert.deepEqual(peruDateBounds({ from: '', to: '2026-10-13' }), {
    fromInclusive: null,
    toExclusive: '2026-10-14T05:00:00.000Z',
  })
  assert.throws(() => peruDateBounds({ from: '2026-02-30', to: '' }), /no es válido/)
  assert.throws(() => peruDateBounds({ from: '2026-10-14', to: '2026-10-13' }), /supera/)
})

test('resume importes por moneda y deja fuera del total las filas sin moneda conciliada', () => {
  const report = buildTreasuryMovementReport({
    range: { from: '2026-10-12', to: '2026-10-12' },
    totalCount: 4,
    complete: true,
    rows: [
      movement({ id: 'cash-in', monto: 100, moneda: 'PEN' }),
      movement({ id: 'transfer-out', tipo: 'pago', monto: 40, moneda: 'USD', medio_pago: 'Transferencia', created_at: '2026-10-12T16:00:00.000Z' }),
      movement({ id: 'unknown', monto: 25, medio_pago: 'Efectivo' }),
      movement({ id: 'voided', monto: 500, moneda: 'USD', anulado_en: '2026-10-13T00:00:00.000Z' }),
      movement({ id: 'outside-period', monto: 900, created_at: '2026-10-13T06:00:00.000Z' }),
    ],
  })
  assert.equal(report.totalCount, 4)
  assert.equal(report.counts.cobros, 2)
  assert.equal(report.counts.pagos, 1)
  assert.equal(report.counts.anulados, 1)
  assert.equal(report.counts.activos, 3)
  assert.equal(report.counts.monedaDesconocida, 1)
  assert.deepEqual(report.counts.porMoneda.map(item => [item.moneda, item.cobros, item.pagos, item.neto]), [
    ['PEN', 100, 0, 100], ['USD', 0, 40, -40],
  ])
  assert.deepEqual(report.counts.porMedio.map(item => item.metodo).sort(), ['Efectivo', 'Transferencia'])
  assert.equal('neto' in report, false)
  assert.equal('totals' in report, false)
  assert.equal(report.rows.some(row => row.id === 'outside-period'), false)
})

test('no publica sumas parciales al alcanzar el límite de filas', () => {
  const report = buildTreasuryMovementReport({
    range: { from: '', to: '' }, totalCount: 10_500, complete: false,
    rows: Array.from({ length: 10_000 }, (_, index) => movement({ id: `movement-${index}`, monto: 1 })),
  })
  assert.equal(report.complete, false)
  assert.equal(report.counts, null)
  assert.equal(report.muestra.length, 200)
  assert.equal(report.totalCount, 10_500)
})

test('solo confirma un conjunto completo si el conteo coincide y no supera el máximo', () => {
  assert.equal(isCompleteMovementSet(0, 0, 10_000), true)
  assert.equal(isCompleteMovementSet(500, 500, 10_000), true)
  assert.equal(isCompleteMovementSet(501, 500, 10_000), false)
  assert.equal(isCompleteMovementSet(10_001, 10_000, 10_000), false)
  assert.equal(isCompleteMovementSet(null, 0, 10_000), false)
})

test('el CSV incluye el conjunto completo, período/corte y referencia protegida contra fórmulas', () => {
  const csv = treasuryMovementCsvRows([
    movement({ monto: 100, moneda: 'PEN', referencia: '=SUM(A1:A2)', anulado_en: '2026-10-13T00:00:00.000Z' }),
  ], '2026-10-12 a 2026-10-13', '2026-10-14T00:00:00.000Z')
  assert.deepEqual(csv.rows[0], [
    '2026-10-12', '2026-10-13T02:00:00.000Z', 'Cobro', 'MOV-001', 'PEN', '=SUM(A1:A2)',
    'Efectivo', 100, 'Anulado', '2026-10-12 a 2026-10-13', '2026-10-14T00:00:00.000Z',
  ])
  assert.equal(csv.header[4], 'Moneda')
  const content = csvContent(csv.header, csv.rows)
  assert.match(content, /'=SUM\(A1:A2\)/)
  assert.match(content, /Generado en UTC/)
})
