import assert from 'node:assert/strict'
import test from 'node:test'
import { PLIN_CONFIG_CODE, isPlinMethod, readPlinSettings, walletForMethod, EMPTY_YAPE_SETTINGS, MAX_YAPE_QR_BYTES, isValidYapeQrImage, isYapeMethod, parseYapeSettings, readYapeSettings, salePayableTotal, validateYapeSettings, YAPE_CONFIG_CODE } from '../src/data/payments.ts'

const qr = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9GQAAAAASUVORK5CYII='
const settings = { titular: 'Comercio de prueba', celular: '987654321', qrImage: qr, enabled: true }

test('el panel de Yape se activa exclusivamente con su medio de pago', () => {
  assert.equal(isYapeMethod(' YAPE '), true)
  assert.equal(isYapeMethod('Yape'), true)
  for (const method of ['Efectivo', 'Tarjeta', 'Plin', 'Yape / Plin', null, undefined]) assert.equal(isYapeMethod(method), false)
})

test('el importe a yapear incluye el descuento sobre el total de productos', () => {
  assert.equal(salePayableTotal(14.9, 10, 999, true), 13.41)
  assert.equal(salePayableTotal(40.5, 5, 0, true), 38.48)
  assert.equal(salePayableTotal(118.5, 0, 0, true), 118.5)
  assert.equal(salePayableTotal(118.5, 100, 0, true), 0)
  assert.equal(salePayableTotal(118.5, 120, 0, true), 0)
})

test('una venta sin líneas usa su monto manual sin un segundo descuento', () => {
  assert.equal(salePayableTotal(0, 20, 71.7, false), 71.7)
  assert.equal(salePayableTotal(0, 20, NaN, false), 0)
  assert.equal(salePayableTotal(0, 0, 0, false), 0)
})

test('la configuración conserva el QR original y normaliza el titular y celular', () => {
  const source = { ...settings, titular: '  Comercio de prueba  ', celular: '987 654 321' }
  const original = structuredClone(source)
  assert.deepEqual(validateYapeSettings(source), settings)
  assert.deepEqual(source, original)
  assert.deepEqual(parseYapeSettings(JSON.stringify(source)), settings)
})

test('activar Yape requiere un titular y un QR, con celular opcional', () => {
  assert.throws(() => validateYapeSettings({ ...settings, titular: '' }), /titular/)
  assert.throws(() => validateYapeSettings({ ...settings, qrImage: '' }), /Carga la imagen/)
  assert.throws(() => validateYapeSettings({ ...settings, celular: '123' }), /9 dígitos/)
  assert.deepEqual(validateYapeSettings({ ...settings, celular: '' }), { ...settings, celular: '' })
  assert.deepEqual(validateYapeSettings({ ...EMPTY_YAPE_SETTINGS }), EMPTY_YAPE_SETTINGS)
})

test('las imágenes admitidas son raster y respetan el tamaño máximo', () => {
  assert.equal(isValidYapeQrImage(qr), true)
  assert.equal(isValidYapeQrImage(qr.replace('image/png', 'image/jpeg')), true)
  assert.equal(isValidYapeQrImage(qr.replace('image/png', 'image/webp')), true)
  assert.equal(isValidYapeQrImage(qr.replace('image/png', 'image/svg+xml')), false)
  assert.equal(isValidYapeQrImage('javascript:alert(1)'), false)
  assert.equal(isValidYapeQrImage('data:image/png;base64,abc'), false)
  const oversized = `data:image/png;base64,${Buffer.alloc(MAX_YAPE_QR_BYTES + 1).toString('base64')}`
  assert.equal(isValidYapeQrImage(oversized), false)
})

test('el QR del comercio se lee solo desde su registro de configuración', () => {
  assert.equal(readYapeSettings([]), null)
  assert.equal(readYapeSettings([{ id: 'EMPRESA', detail: JSON.stringify(settings) }]), null)
  assert.deepEqual(readYapeSettings([{ id: YAPE_CONFIG_CODE, detail: JSON.stringify(settings) }]), settings)
  assert.throws(() => parseYapeSettings('no-json'), /configuración de Yape/)
  assert.throws(() => parseYapeSettings('null'), /configuración de Yape/)
  assert.throws(() => parseYapeSettings('[]'), /configuración de Yape/)
})

test('Plin tiene su propio medio de pago y no se confunde con Yape', () => {
  assert.equal(isPlinMethod(' PLIN '), true)
  assert.equal(isPlinMethod('Yape'), false)
  assert.equal(walletForMethod('Yape'), 'yape')
  assert.equal(walletForMethod('plin'), 'plin')
  assert.equal(walletForMethod('Efectivo'), null)
  assert.equal(walletForMethod('Yape / Plin'), null)
})

test('la configuración de Plin se lee de su propio registro y usa su nombre en los errores', () => {
  const plin = { ...settings, titular: 'Titular Plin' }
  const records = [
    { id: YAPE_CONFIG_CODE, detail: JSON.stringify(settings) },
    { id: PLIN_CONFIG_CODE, detail: JSON.stringify(plin) },
  ]
  assert.deepEqual(readPlinSettings(records), plin)
  assert.equal(readPlinSettings([records[0]]), null)
  assert.throws(() => validateYapeSettings({ ...plin, titular: '' }, 'Plin'), /Plin/)
  assert.throws(() => parseYapeSettings('no es json', 'Plin'), /Plin/)
})

import { cardLabel, isCardExpired, validateCardInput } from '../src/data/payments.ts'

const card = { marca: 'Visa', ultimos4: '4242', titular: '  Ana  Pérez ', venceMes: 8, venceAnio: 28 }
const now = new Date('2026-10-22T12:00:00Z')

test('una tarjeta vence al final del mes indicado', () => {
  assert.equal(isCardExpired(10, 26, now), false)
  assert.equal(isCardExpired(9, 26, now), true)
  assert.equal(isCardExpired(12, 2026, now), false)
  assert.equal(isCardExpired(1, 2025, now), true)
})

test('la tarjeta se normaliza y solo conserva datos no sensibles', () => {
  const ok = validateCardInput(card, now)
  assert.deepEqual(ok, { marca: 'Visa', ultimos4: '4242', titular: 'Ana Pérez', venceMes: 8, venceAnio: 2028 })
  assert.equal(cardLabel(ok), 'Visa •••• 4242')
})

test('rechaza tarjetas inválidas o vencidas', () => {
  assert.throws(() => validateCardInput({ ...card, marca: 'Otra marca' }, now), /marca/i)
  assert.throws(() => validateCardInput({ ...card, ultimos4: '4111111111111111' }, now), /4 dígitos/)
  assert.throws(() => validateCardInput({ ...card, ultimos4: '12a4' }, now), /4 dígitos/)
  assert.throws(() => validateCardInput({ ...card, titular: 'A' }, now), /titular/i)
  assert.throws(() => validateCardInput({ ...card, venceMes: 13 }, now), /mes/i)
  assert.throws(() => validateCardInput({ ...card, venceMes: 3, venceAnio: 26 }, now), /vencida/i)
})
