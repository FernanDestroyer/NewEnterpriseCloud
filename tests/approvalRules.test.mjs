import assert from 'node:assert/strict'
import test from 'node:test'
import { describeRuleEffect, isRuleDirty, parseRuleValue, ruleDraftFrom, submittedMessage } from '../src/data/approvalRules.ts'

const rule = (over = {}) => ({
  clave: 'orden_compra_monto_minimo_pen', titulo: 'Monto', descripcion: '', unidad: 'PEN',
  valor: 0, activa: false, actualizado_por: null, actualizado_en: '2026-11-20T00:00:00Z', ...over,
})

test('parseRuleValue acepta montos con separadores y hasta 2 decimales', () => {
  assert.deepEqual(parseRuleValue(' 1,500.50 ', 'PEN', true), { ok: true, value: 1500.5 })
  assert.deepEqual(parseRuleValue('0', 'PEN', false), { ok: true, value: 0 })
})

test('parseRuleValue rechaza vacíos, negativos, texto, decimales excesivos y topes', () => {
  for (const raw of ['', '   ', '-5', 'abc', '1.234', '1e3', 'NaN', '1000000001']) {
    assert.equal(parseRuleValue(raw, 'PEN', false).ok, false, raw)
  }
})

test('las unidades deben ser enteras y activar exige umbral > 0', () => {
  assert.equal(parseRuleValue('2.5', 'unidades', true).ok, false)
  assert.equal(parseRuleValue('0', 'PEN', true).ok, false)
  assert.deepEqual(parseRuleValue('5', 'unidades', true), { ok: true, value: 5 })
})

test('isRuleDirty compara por valor numérico y por estado', () => {
  const r = rule({ valor: 1000, activa: true })
  assert.equal(isRuleDirty(r, ruleDraftFrom(r)), false)
  assert.equal(isRuleDirty(r, { valor: '1,000.00', activa: true }), false)
  assert.equal(isRuleDirty(r, { valor: '1000', activa: false }), true)
  assert.equal(isRuleDirty(r, { valor: '900', activa: true }), true)
  assert.equal(isRuleDirty(r, { valor: 'x', activa: true }), true)
})

test('describeRuleEffect distingue regla activa e inactiva', () => {
  assert.match(describeRuleEffect(rule()), /toda orden de compra exige aprobación/)
  assert.match(describeRuleEffect(rule({ valor: 1000, activa: true }), v => `S/ ${v}`), /menores a S\/ 1000 se emiten sin aprobación/)
  assert.match(describeRuleEffect(rule({ clave: 'conteo_fisico_variacion_maxima_unidades', unidad: 'unidades', valor: 5, activa: true })), /hasta 5 unidades/)
})

test('submittedMessage informa si el umbral emitió el documento o quedó pendiente', () => {
  const id = 'abcdef12-0000-0000-0000-000000000000'
  assert.match(submittedMessage('order', id, { estado: 'approved', auto: true }), /sin aprobación manual/)
  assert.match(submittedMessage('count', id, { estado: 'approved', auto: true }), /Conteo aplicado sin aprobación manual/)
  assert.match(submittedMessage('order', id, { estado: 'pending', auto: false }), /bandeja de aprobaciones/)
  assert.match(submittedMessage('count', id, null), /Conteo enviado a aprobación/)
  assert.match(submittedMessage('order', id, { estado: 'approved', auto: false }), /bandeja de aprobaciones/)
})
