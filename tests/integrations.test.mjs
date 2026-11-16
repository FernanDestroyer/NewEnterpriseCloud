import assert from 'node:assert/strict'
import test from 'node:test'
import {
  integrationErrorState,
  integrationStatusDetail,
  integrationStatusLabel,
  parsePeruIntegrationStatus,
} from '../src/data/integrationStatus.ts'

test('el estado de integración acepta solo campos no secretos y fechas válidas', () => {
  const status = parsePeruIntegrationStatus({
    state: 'configured', provider: 'apis-net', checked_at: '2026-11-13T10:00:00.000Z', token: 'no debe conservarse',
  })
  assert.deepEqual(status, {
    state: 'configured', provider: 'apis-net', verified: false, checked_at: '2026-11-13T10:00:00.000Z',
  })
  assert.equal(parsePeruIntegrationStatus({ state: 'connected', provider: 'apis-net', checked_at: '2026-11-13' }), null)
  assert.equal(parsePeruIntegrationStatus({ state: 'configured', provider: 'apisperu', checked_at: '2026-11-13' }), null)
  assert.equal(parsePeruIntegrationStatus({ state: 'configured', provider: 'attacker.example', checked_at: '2026-11-13' }), null)
  assert.equal(parsePeruIntegrationStatus({ state: 'configured', provider: null, checked_at: 'fecha inválida' }), null)
})

test('los mensajes no presentan presencia de secreto como una conexión validada', () => {
  assert.match(integrationStatusLabel('configured'), /no verificada/)
  assert.match(integrationStatusDetail('configured'), /no valida la clave/)
  assert.match(integrationStatusDetail('missing_secret'), /captura manual/)
  assert.match(integrationStatusDetail('not_deployed'), /Despliega la Edge Function/)
})

test('traduce errores de invocación a estados sin conservar mensajes externos', () => {
  assert.equal(integrationErrorState({ context: { status: 404 }, message: 'provider token leaked' }), 'not_deployed')
  assert.equal(integrationErrorState({ context: { status: 401 } }), 'session_required')
  assert.equal(integrationErrorState({ context: { status: 500 } }), 'unavailable')
  assert.equal(integrationErrorState(new Error('token=secret')), 'unavailable')
})
