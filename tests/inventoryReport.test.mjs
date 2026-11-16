import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { buildInventoryKardexReport, inventoryKardexCsvRows, isCompleteKardexSet } from '../src/data/inventoryReport.ts'
import { csvContent } from '../src/data/exports.ts'

const movement = (overrides = {}) => ({
  movimiento_id: 'movement-1', producto_id: 'product-1', almacen_id: 'warehouse-1',
  fecha: '2026-11-12T04:30:00.000Z', tipo: 'entrada', cantidad: 5,
  stock_anterior: 0, stock_nuevo: 5, referencia: 'IN-01', motivo: null,
  costo_peps: 50, costo_promedio: 50, saldo_peps: 50, saldo_promedio: 50,
  ...overrides,
})

test('el reporte filtra por fecha civil de Perú y calcula desglose solo con el conjunto completo', () => {
  const report = buildInventoryKardexReport({
    range: { from: '2026-11-11', to: '2026-11-11' }, totalCount: 2, complete: true,
    rows: [
      movement(),
      movement({ movimiento_id: 'movement-2', fecha: '2026-11-12T05:00:00.000Z', tipo: 'salida' }),
      movement({ movimiento_id: 'outside-period', fecha: '2026-11-13T05:00:00.000Z' }),
    ],
  })
  assert.equal(report.rows.length, 1)
  assert.equal(report.complete, false)
  assert.equal(report.countsByType, null)
  assert.equal(report.muestra.length, 1)

  const complete = buildInventoryKardexReport({
    range: { from: '2026-11-11', to: '2026-11-11' }, totalCount: 2, complete: true,
    rows: [movement(), movement({ movimiento_id: 'movement-2', fecha: '2026-11-12T04:59:59.999Z', tipo: 'salida' })],
  })
  assert.equal(complete.complete, true)
  assert.deepEqual(complete.countsByType, [{ tipo: 'entrada', cantidad: 1 }, { tipo: 'salida', cantidad: 1 }])
})

test('el reporte no certifica conteos incompletos ni mayores al límite', () => {
  assert.equal(isCompleteKardexSet(0, 0), true)
  assert.equal(isCompleteKardexSet(501, 500), false)
  assert.equal(isCompleteKardexSet(501, 500, 500), false)
  assert.equal(isCompleteKardexSet(null, 0), false)
  const report = buildInventoryKardexReport({ range: { from: '', to: '' }, totalCount: 501, complete: false, rows: [movement()] })
  assert.equal(report.complete, false)
  assert.equal(report.countsByType, null)
})

test('la exportación contiene fecha, costos y corte, y el CSV neutraliza fórmulas', () => {
  const csv = inventoryKardexCsvRows([movement({ referencia: '=HYPERLINK("x")' })], '2026-11-11 a 2026-11-11', '2026-11-13T00:00:00.000Z')
  assert.equal(csv.rows[0][1], '2026-11-11')
  assert.equal(csv.rows[0][10], 50)
  assert.equal(csv.rows[0][14], '2026-11-11 a 2026-11-11')
  assert.match(csvContent(csv.header, csv.rows), /'=HYPERLINK/)
  assert.match(csv.header.join(','), /Generado en UTC/)
})

test('Reportes conecta el detalle Kardex a la fuente del módulo activo', async () => {
  const page = await readFile(new URL('../src/components/ReportsPage.tsx', import.meta.url), 'utf8')
  const service = await readFile(new URL('../src/services/inventoryReport.ts', import.meta.url), 'utf8')
  assert.match(page, /active\.id === 'kardex' \? <InventoryKardexDetail/)
  assert.match(service, /ec_consultar_kardex/)
  assert.match(service, /\.gte\('fecha'/)
  assert.match(service, /\.lt\('fecha'/)
  assert.doesNotMatch(page, /active\.id === 'kardex' \? <ModuloPage/)
})
