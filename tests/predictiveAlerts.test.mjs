import assert from 'node:assert/strict'
import test from 'node:test'
import { buildPredictiveAlerts, confidenceLabel, ewma } from '../src/data/predictiveAlerts.ts'

const today = '2026-11-20'
const day = offset => { const d = new Date(Date.UTC(2026, 10, 20 + offset)); return d.toISOString().slice(0, 10) + 'T15:00:00Z' }
const out = (producto_id, offset, cantidad, tipo = 'salida') => ({ producto_id, tipo, cantidad, created_at: day(offset) })
const product = (productId, stock, name = `Prod ${productId}`) => ({ productId, code: `C-${productId}`, name, stock })
const daily = (id, qty, days = 14) => Array.from({ length: days }, (_, i) => out(id, -i, qty))

test('ewma pondera más lo reciente', () => {
  assert.equal(ewma([], 0.3), 0)
  assert.equal(ewma([10, 10, 10], 0.3), 10)
  assert.ok(ewma([0, 0, 0, 10], 0.5) > ewma([10, 0, 0, 0], 0.5))
})

test('consumo constante de 10/día con 25 u. → crítica (~2 días)', () => {
  const [alert] = buildPredictiveAlerts([product('a', 25)], daily('a', 10), { today })
  assert.equal(alert.severidad, 'critical')
  assert.equal(alert.fuente, 'predictive')
  assert.equal(alert.clave_fuente, 'stockout:a')
  assert.equal(alert.referencia, 'C-a')
  assert.match(alert.titulo, /~2 días/)
  // El suavizado exponencial arranca en 0 (14 de 28 días sin ventas), así que converge a ~10 sin igualarlo.
  assert.match(alert.detalle, /consumo ~(9\.[5-9]|10\.0)\/día/)
  assert.match(alert.detalle, /reponer ~27\d u\./)
})

test('10 días de cobertura → atención; 20 días → sin alerta', () => {
  assert.equal(buildPredictiveAlerts([product('a', 100)], daily('a', 10), { today })[0].severidad, 'warning')
  assert.deepEqual(buildPredictiveAlerts([product('a', 200)], daily('a', 10), { today }), [])
})

test('sin stock y con demanda activa → crítica', () => {
  const [alert] = buildPredictiveAlerts([product('a', 0)], daily('a', 4), { today })
  assert.equal(alert.severidad, 'critical')
  assert.match(alert.titulo, /sin stock con demanda activa/)
})

test('pocos días con salidas (< 3) no generan alerta: evita ruido', () => {
  assert.deepEqual(buildPredictiveAlerts([product('a', 1)], [out('a', 0, 50), out('a', -1, 50)], { today }), [])
})

test('ignora entradas, ajustes, transferencias, fuera de ventana y movimientos sin producto', () => {
  const noise = [
    ...daily('a', 10).map(m => ({ ...m, tipo: 'entrada' })),
    ...daily('a', 10).map(m => ({ ...m, tipo: 'ajuste' })),
    ...daily('a', 10).map(m => ({ ...m, tipo: 'transferencia' })),
    ...daily('a', 10, 40).slice(30).map(m => m), // días -30..-39: fuera de la ventana de 28
    { producto_id: null, tipo: 'salida', cantidad: 99, created_at: day(0) },
  ]
  assert.deepEqual(buildPredictiveAlerts([product('a', 1)], noise, { today }), [])
})

test('cantidades negativas o no numéricas no rompen el cálculo', () => {
  const movements = [...daily('a', 10), out('a', -20, 'x'), out('a', -21, Number.NaN)]
  const alerts = buildPredictiveAlerts([product('a', 25)], movements, { today })
  assert.equal(alerts.length, 1)
  assert.equal(buildPredictiveAlerts([product('a', 25)], daily('a', -10), { today })[0].severidad, 'critical')
})

test('ordena de la más urgente a la menos y respeta el tope', () => {
  const products = [product('a', 100), product('b', 20), product('c', 60)]
  const movements = [...daily('a', 10), ...daily('b', 10), ...daily('c', 10)]
  assert.deepEqual(buildPredictiveAlerts(products, movements, { today }).map(a => a.clave_fuente), ['stockout:b', 'stockout:c', 'stockout:a'])
  assert.equal(buildPredictiveAlerts(products, movements, { today, maxAlerts: 2 }).length, 2)
})

test('dayOf permite usar la fecha de negocio local', () => {
  const movements = daily('a', 10).map(m => ({ ...m, created_at: 'zzz' }))
  assert.equal(buildPredictiveAlerts([product('a', 25)], movements, { today }).length, 0)
  let i = 0
  const alerts = buildPredictiveAlerts([product('a', 25)], movements, { today, dayOf: () => day(-(i++ % 14)).slice(0, 10) })
  assert.equal(alerts.length, 1)
})

test('títulos y detalle respetan los límites de la base (180 / 500)', () => {
  const [alert] = buildPredictiveAlerts([product('a', 0, 'N'.repeat(400))], daily('a', 5), { today })
  assert.ok(alert.titulo.length <= 180 && alert.detalle.length <= 500)
})

test('confianza según días con movimiento', () => {
  assert.equal(confidenceLabel(3, 28), 'baja')
  assert.equal(confidenceLabel(8, 28), 'media')
  assert.equal(confidenceLabel(14, 28), 'alta')
})

test('el día en curso (incompleto) no rebaja el consumo estimado', () => {
  // 14 días de 10/día que terminan AYER; hoy todavía no hubo ventas.
  const upToYesterday = Array.from({ length: 14 }, (_, i) => out('a', -(i + 1), 10))
  const [alert] = buildPredictiveAlerts([product('a', 120)], upToYesterday, { today })
  assert.match(alert.detalle, /consumo ~(9\.[5-9]|10\.0)\/día/)
  assert.equal(alert.severidad, 'warning') // 120 u. / ~10 = ~12 días
  // Las salidas de hoy se ignoran hasta que el día cierre.
  const withToday = [...upToYesterday, out('a', 0, 500)]
  assert.equal(buildPredictiveAlerts([product('a', 120)], withToday, { today })[0].detalle, alert.detalle)
})
