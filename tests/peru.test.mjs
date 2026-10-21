import assert from 'node:assert/strict'
import test from 'node:test'
import { isValidDni, isValidRuc, lookupDni, lookupRuc, normalizeDni, normalizeRuc } from '../src/services/peru.ts'

const okResponse = (body, status = 200) => async () => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
})

test('el DNI exige 8 dígitos y el RUC 11 dígitos con verificador válido', () => {
  assert.equal(isValidDni('12345678'), true)
  assert.equal(isValidDni('1234567'), false)
  assert.equal(isValidDni('1234567a'), false)
  assert.equal(isValidDni(' 12345678 '), true)
  // Base 2012345678: suma 148, resto 5, verificador 6.
  assert.equal(isValidRuc('20123456786'), true)
  assert.equal(isValidRuc('20123456789'), false)
  assert.equal(isValidRuc('20123456780'), false)
  assert.equal(isValidRuc('1234567890'), false)
})

test('la normalización acepta variantes de nombre de campo', () => {
  assert.deepEqual(normalizeDni('12345678', { nombres: 'Juan', apellidoPaterno: 'Pérez', apellidoMaterno: ' Solís ' }), {
    tipoDoc: 'DNI', documento: '12345678', nombre: 'Juan Pérez Solís', detalle: 'Persona natural · DNI verificado',
  })
  assert.deepEqual(normalizeDni('12345678', { nombre_completo: 'Ana Ruiz' }), {
    tipoDoc: 'DNI', documento: '12345678', nombre: 'Ana Ruiz', detalle: 'Persona natural · DNI verificado',
  })
  assert.deepEqual(normalizeRuc('20123456786', { razonSocial: ' Mi Empresa S.A.C. ', direccion: 'Av. Lima 123', estado: 'ACTIVO', condicion: 'HABIDO' }), {
    tipoDoc: 'RUC', documento: '20123456786', nombre: 'Mi Empresa S.A.C.', detalle: 'Av. Lima 123 Estado: ACTIVO Condición: HABIDO', direccion: 'Av. Lima 123',
  })
  assert.throws(() => normalizeDni('12345678', {}), /RENIEC/)
  assert.throws(() => normalizeRuc('20123456786', {}), /SUNAT/)
})

test('el lookup valida el formato antes de llamar a la red', async () => {
  let calls = 0
  const spy = async () => { calls += 1; return okResponse({})() }
  await assert.rejects(() => lookupDni('123', spy), /8 dígitos/)
  await assert.rejects(() => lookupRuc('123', spy), /11 dígitos/)
  await assert.rejects(() => lookupRuc('20123456789', spy), /verificador/)
  assert.equal(calls, 0)
})

test('el lookup completa nombre y detalle con respuestas simuladas', async () => {
  process.env.VITE_PERU_API_TOKEN = 'token-de-prueba'
  const dni = await lookupDni('12345678', okResponse({ nombres: 'Rosa', apellidoPaterno: 'Díaz', apellidoMaterno: 'Paredes' }))
  assert.equal(dni.nombre, 'Rosa Díaz Paredes')
  const ruc = await lookupRuc('20123456786', okResponse({ razonSocial: 'Tecno S.A.C.', direccion: 'Calle 1' }))
  assert.equal(ruc.nombre, 'Tecno S.A.C.')
  assert.match(ruc.detalle, /Calle 1/)
  delete process.env.VITE_PERU_API_TOKEN
})

test('detecta no-encontrado cuando la API responde 200 con success:false', async () => {
  process.env.VITE_PERU_API_TOKEN = 'token-de-prueba'
  await assert.rejects(() => lookupDni('12345678', okResponse({ success: false, message: 'No se encontraron resultados.' })), /no existe en RENIEC/)
  await assert.rejects(() => lookupRuc('20123456786', okResponse({ success: false })), /no existe en SUNAT/)
  delete process.env.VITE_PERU_API_TOKEN
})

test('usa el número en la ruta con apisperu y en query con otros proveedores', async () => {
  process.env.VITE_PERU_API_TOKEN = 'token-de-prueba'
  process.env.VITE_PERU_API_URL = 'https://dniruc.apisperu.com/api/v1'
  const seen = []
  await lookupDni('12345678', async (url, init) => { seen.push([url, init]); return okResponse({ nombres: 'Rosa', apellidoPaterno: 'Díaz', apellidoMaterno: 'Paredes' })() })
  assert.ok(seen[0][0].endsWith('/dni/12345678?token=token-de-prueba'), `URL inesperada: ${seen[0][0]}`)
  assert.ok(!('Authorization' in (seen[0][1]?.headers ?? {})), 'apisperu no debe usar cabecera Authorization (su CORS la bloquea)')
  delete process.env.VITE_PERU_API_URL
  seen.length = 0
  await lookupRuc('20123456786', async (url, init) => { seen.push([url, init]); return okResponse({ razonSocial: 'Tecno S.A.C.' })() })
  assert.ok(seen[0][0].includes('/ruc?numero=20123456786'), `URL inesperada: ${seen[0][0]}`)
  assert.equal(seen[0][1]?.headers?.Authorization, 'Bearer token-de-prueba')
  delete process.env.VITE_PERU_API_TOKEN
})

test('los errores de red y de API se traducen a mensajes claros', async () => {
  process.env.VITE_PERU_API_TOKEN = 'token-de-prueba'
  await assert.rejects(() => lookupDni('12345678', okResponse({}, 404)), /no existe en RENIEC/)
  await assert.rejects(() => lookupRuc('20123456786', okResponse({}, 401)), /token/i)
  await assert.rejects(() => lookupDni('12345678', okResponse({}, 429)), /Límite/)
  await assert.rejects(() => lookupDni('12345678', async () => { throw new Error('boom') }), /conexión/)
  delete process.env.VITE_PERU_API_TOKEN
  await assert.rejects(() => lookupDni('12345678', okResponse({})), /VITE_PERU_API_TOKEN/)
})
