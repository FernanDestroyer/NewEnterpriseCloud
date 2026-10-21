import assert from 'node:assert/strict'
import test from 'node:test'
import { buildSalesSeries, financialSnapshot, percentage, totalAmount } from '../src/data/dashboard.ts'
import { buildExecutiveReport } from '../src/data/executiveReport.ts'
import { renderExecutiveReport } from '../src/data/executiveReportHtml.ts'

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

test('el informe ejecutivo usa el período peruano y mantiene los saldos actuales', () => {
  const sales = [
    { ...record('V-1', 50), createdAt: '2026-10-12T15:00:00Z', medio: 'Yape' },
    { ...record('V-2', 100, 'Completada'), createdAt: '2026-10-13T15:00:00Z', medio: 'Tarjeta', cliente_id: 'cliente-a', name: 'Cliente A' },
    { ...record('V-10', 200), createdAt: '2026-10-13T15:00:00Z', medio: 'Efectivo', cliente_id: 'cliente-b', name: 'Cliente B' },
    { ...record('V-11', 999), createdAt: '2026-10-13T02:00:00Z', medio: 'Yape' },
  ]
  const original = structuredClone(sales)
  const report = buildExecutiveReport({
    sales, purchases: [{ ...record('OC-1', 120), createdAt: '2026-10-13T15:00:00Z' }],
    inventory: [{ ...record('PRD-1', undefined, 'Bajo stock'), quantity: 3, precio: 20, createdAt: '2026-01-01T15:00:00Z' }],
    finance: [{ ...record('CXC-1', 80), dueAt: '2026-10-12', createdAt: '2026-01-01T15:00:00Z' }, record('CXC-2', 40, 'Completada')],
    range: { from: '2026-10-13', to: '2026-10-13' }, now: new Date('2026-10-13T18:00:00Z'),
  })
  assert.deepEqual(report.sales.map(sale => sale.id), ['V-10', 'V-2'])
  assert.equal(report.salesTotal, 300)
  assert.equal(report.purchasesTotal, 120)
  assert.equal(report.operationBalance, 180)
  assert.equal(report.averageTicket, 150)
  // El período anterior incluye dos ventas del 12/10 en el calendario peruano.
  assert.equal(report.salesChange, -71.4)
  assert.equal(report.statuses[0].amount, 100)
  assert.equal(report.customers[0].label, 'Cliente B')
  assert.equal(report.paymentMethods[0].label, 'Efectivo')
  assert.equal(report.trend.buckets.reduce((sum, bucket) => sum + bucket.sales, 0), 300)
  assert.equal(report.inventory.units, 3)
  assert.equal(report.inventory.saleValue, 60)
  assert.equal(report.finance.receivable, 80)
  assert.equal(report.overdueCount, 1)
  assert.deepEqual(sales, original)
})

test('las fuentes no disponibles del PDF no se representan como saldos cero', () => {
  const report = buildExecutiveReport({ sales: [], range: { from: '', to: '' } })
  assert.equal(report.purchasesTotal, null)
  assert.equal(report.operationBalance, null)
  assert.equal(report.inventory, null)
  assert.equal(report.finance, null)
  assert.deepEqual(report.sources, ['Ventas'])
  const emptySource = buildExecutiveReport({ sales: [], purchases: [], inventory: [], finance: [], range: { from: '', to: '' } })
  assert.equal(emptySource.purchasesTotal, 0)
  assert.equal(emptySource.inventory.count, 0)
  assert.equal(emptySource.finance.receivable, 0)
  assert.deepEqual(emptySource.sources, ['Ventas', 'Compras', 'Inventario', 'Finanzas'])
})

test('los rankings distinguen clientes vinculados y los medios sin registrar', () => {
  const report = buildExecutiveReport({
    sales: [
      { ...record('V-1', 30), name: 'Mismo nombre', cliente_id: 'cliente-a', medio: ' Tarjeta ' },
      { ...record('V-2', 20), name: 'Mismo nombre', cliente_id: 'cliente-b', medio: 'tarjeta' },
      { ...record('V-3', 10), name: 'Sin vínculo' },
    ], range: { from: '', to: '' },
  })
  assert.equal(report.customers.length, 3)
  assert.deepEqual(report.paymentMethods.map(method => [method.label, method.amount]), [['Tarjeta', 50], ['Sin registrar', 10]])
  assert.equal(report.undatedCount, 3)
})

test('la tendencia del PDF abarca todos los registros aun con fechas posteriores a su emisión', () => {
  const report = buildExecutiveReport({
    sales: [
      { ...record('V-1', 10), createdAt: '2026-01-01T15:00:00Z' },
      { ...record('V-2', 20), createdAt: '2026-12-20T15:00:00Z' },
    ], range: { from: '', to: '' }, now: new Date('2026-10-13T18:00:00Z'),
  })
  assert.ok(report.trend.buckets.length <= 30)
  assert.equal(report.trend.buckets.reduce((sum, bucket) => sum + bucket.sales, 0), report.salesTotal)
})

test('el PDF pagina todas las ventas y escapa el texto de empresa y registros', () => {
  const sales = Array.from({ length: 23 }, (_, index) => ({
    ...record(`V-${index + 1}`, 10, 'Completada', '<script>alert("x")</script>'),
    name: 'Cliente <ejemplo>', createdAt: '2026-10-13T15:00:00Z', medio: 'Tarjeta',
  }))
  const report = buildExecutiveReport({ sales, purchases: [], range: { from: '', to: '' } })
  const html = renderExecutiveReport(report, { name: 'Empresa "A" <B>', periodLabel: 'Todos los registros', autoPrint: false })
  assert.equal((html.match(/<section class="report-sheet /g) ?? []).length, 4)
  assert.equal((html.match(/<span class="ref">V-/g) ?? []).length, 23)
  assert.ok(html.includes('04 / 04'))
  assert.ok(html.includes('Registros 17–23 de 23'))
  assert.ok(html.includes('Empresa &quot;A&quot; &lt;B&gt;'))
  assert.ok(html.includes('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;'))
  assert.ok(!html.includes('<script>alert("x")</script>'))
  assert.ok(html.includes('@page { size: A4 landscape; margin: 0; }'))
})

test('un informe vacío o con importes no numéricos mantiene un diseño válido', () => {
  for (const sales of [[], [record('V-1', NaN)]]) {
    const report = buildExecutiveReport({ sales, range: { from: '', to: '' } })
    const html = renderExecutiveReport(report, { name: 'EnterpriseCloud', periodLabel: 'Todos los registros', autoPrint: false })
    assert.ok(!html.includes('NaN'))
    assert.ok(!html.includes('Infinity'))
    assert.equal(report.averageTicket, 0)
  }
})

test('los conceptos y nombres largos reciben espacio adicional en la paginación', () => {
  const sales = Array.from({ length: 10 }, (_, index) => ({
    ...record(`V-${index + 1}`, 10, 'Completada', 'Factura F001-0012 · Lima · Venta de productos y accesorios para la sede principal de la organización'),
    name: 'Corporación Internacional de Tecnología, Distribuciones y Servicios Empresariales del Perú S.A.C.',
  }))
  const report = buildExecutiveReport({ sales, range: { from: '', to: '' } })
  const html = renderExecutiveReport(report, { name: 'EnterpriseCloud', periodLabel: 'Todos los registros', autoPrint: false })
  assert.equal((html.match(/<section class="report-sheet /g) ?? []).length, 3)
  assert.equal((html.match(/<span class="ref">V-/g) ?? []).length, 10)
  assert.ok(html.includes('Registros 1–6 de 10'))
  assert.ok(html.includes('Registros 7–10 de 10'))
})
