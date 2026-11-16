import test from 'node:test'
import assert from 'node:assert/strict'
import { cashCurrencyTotals, expectedCashByCurrency, hasUnreconciledHistoricalCashClose } from '../src/data/cashAccounting.ts'

const movements = [
  { tipo: 'cobro', monto: 80, moneda: 'PEN', medioPago: 'Efectivo', anuladoEn: null },
  { tipo: 'pago', monto: 10, moneda: 'PEN', medioPago: 'efectivo', anuladoEn: null },
  { tipo: 'cobro', monto: 20, moneda: 'USD', medioPago: 'Efectivo', anuladoEn: null },
  { tipo: 'cobro', monto: 200, moneda: 'USD', medioPago: 'Yape', anuladoEn: null },
  { tipo: 'pago', monto: 15, moneda: null, medioPago: 'Efectivo', anuladoEn: null },
  { tipo: 'cobro', monto: 7, moneda: 'USD', medioPago: 'Efectivo', anuladoEn: '2026-11-01T00:00:00Z' },
]

test('cash movement totals keep PEN and USD separate and exclude electronic/cancelled movements', () => {
  assert.deepEqual(cashCurrencyTotals(movements), {
    PEN: { cobros: 80, pagos: 10, neto: 70, cantidad: 2 },
    USD: { cobros: 20, pagos: 0, neto: 20, cantidad: 1 },
  })
})

test('expected cash keeps each currency separate and counts unclassified active cash', () => {
  assert.deepEqual(expectedCashByCurrency({ pen: 100, usd: 5 }, movements), {
    PEN: 170,
    USD: 25,
    monedaDesconocida: 1,
  })
})

test('old closed mixed-currency shift is marked for manual review when no USD count exists', () => {
  assert.equal(hasUnreconciledHistoricalCashClose('Cerrado', null, movements), true)
  assert.equal(hasUnreconciledHistoricalCashClose('Cerrado', 0, movements), false)
  assert.equal(hasUnreconciledHistoricalCashClose('Abierto', null, movements), false)
})
