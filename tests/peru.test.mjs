import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { isValidDni, isValidRuc, lookupDni, lookupRuc, normalizeDni, normalizeRuc } from '../src/services/peru.ts'
import { createPeruDocumentLookupHandler } from '../supabase/functions/_shared/handlePeruLookup.ts'

const normalizedDni = {
  tipoDoc: 'DNI', documento: '12345678', nombre: 'Rosa Díaz Paredes', detalle: 'Persona natural · DNI verificado',
}
const normalizedRuc = {
  tipoDoc: 'RUC', documento: '20123456786', nombre: 'Tecno S.A.C.', detalle: 'Calle 1', direccion: 'Calle 1',
}

test('el DNI exige 8 dígitos y el RUC 11 dígitos con verificador válido', () => {
  assert.equal(isValidDni('12345678'), true)
  assert.equal(isValidDni('1234567'), false)
  assert.equal(isValidDni('1234567a'), false)
  assert.equal(isValidDni(' 12345678 '), true)
  assert.equal(isValidRuc('20123456786'), true)
  assert.equal(isValidRuc('20123456789'), false)
  assert.equal(isValidRuc('20123456780'), false)
  assert.equal(isValidRuc('1234567890'), false)
})

test('normaliza respuestas RENIEC y SUNAT a una forma estable', () => {
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

test('valida documento antes de llamar a Supabase', async () => {
  let calls = 0
  const spy = async () => { calls += 1; return { data: normalizedDni, error: null } }
  await assert.rejects(() => lookupDni('123', spy), /8 dígitos/)
  await assert.rejects(() => lookupRuc('123', 'clientes', spy), /11 dígitos/)
  await assert.rejects(() => lookupRuc('20123456789', 'clientes', spy), /verificador/)
  assert.equal(calls, 0)
})

test('envía tipo y número al endpoint autenticado y devuelve datos normalizados', async () => {
  const seen = []
  const invoke = async (body) => {
    seen.push(body)
    return { data: body.tipo_documento === 'DNI' ? normalizedDni : normalizedRuc, error: null }
  }
  assert.deepEqual(await lookupDni('12345678', invoke), normalizedDni)
  assert.deepEqual(await lookupRuc('20123456786', 'proveedores', invoke), normalizedRuc)
  assert.deepEqual(seen, [
    { tipo_documento: 'DNI', numero: '12345678', modulo: 'clientes' },
    { tipo_documento: 'RUC', numero: '20123456786', modulo: 'proveedores' },
  ])
})

test('traduce errores del servicio sin mostrar información sensible', async () => {
  const failing = (status) => async () => ({ data: null, error: { context: { status } } })
  await assert.rejects(() => lookupDni('12345678', failing(422)), /no existe en RENIEC/)
  await assert.rejects(() => lookupDni('12345678', failing(400)), /rechazó el formato/)
  await assert.rejects(() => lookupRuc('20123456786', 'proveedores', failing(429)), /Límite/)
  await assert.rejects(() => lookupDni('12345678', failing(503)), /no está configurada/)
  await assert.rejects(() => lookupDni('12345678', failing(401)), /sesión/)
  await assert.rejects(() => lookupDni('12345678', failing(403)), /permiso/)
  await assert.rejects(() => lookupDni('12345678', failing(0)), /Supabase/)
  await assert.rejects(() => lookupDni('12345678', async () => { throw new Error('token=secreto') }), /Supabase/)
})

test('el código del navegador no contiene el token ni llama a proveedores directamente', async () => {
  const files = [
    'src/services/peru.ts',
    'src/vite-env.d.ts',
    'src/components/RecordModal.tsx',
  ]
  const browserCode = (await Promise.all(files.map((file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8')))).join('\n')
  assert.doesNotMatch(browserCode, /VITE_PERU_API_(?:TOKEN|URL)/)
  assert.doesNotMatch(browserCode, /api\.apis\.net\.pe|dniruc\.apisperu\.com/)
})

test('el estado de la integración exige permiso de edición de Configuración en el servidor', async () => {
  const calls = []
  const handler = createPeruDocumentLookupHandler({
    getEnv: (name) => ({ SUPABASE_URL: 'https://project.supabase.co', PERU_API_TOKEN: 'secret-token-must-not-leak' })[name],
    corsHeaders: {},
    fetchImpl: async (input, init) => {
      const url = String(input)
      calls.push({ url, init })
      if (url.endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: 'authenticated-user' }), { status: 200 })
      if (url.endsWith('/rest/v1/rpc/tiene_permiso')) return new Response('false', { status: 200 })
      throw new Error('The provider must not be contacted for a denied status check')
    },
  })
  const response = await handler(new Request('https://function.test/peru-document-lookup', {
    method: 'POST',
    headers: { authorization: 'Bearer user-jwt', apikey: 'publishable-key', 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'status' }),
  }))
  assert.equal(response.status, 403)
  assert.deepEqual(JSON.parse(calls[1].init.body), { p_modulo: 'configuracion', p_accion: 'editar' })
  assert.equal(calls.length, 2)
  assert.doesNotMatch(await response.text(), /secret-token|configured|apis\.net\.pe/i)
})

test('una persona autorizada puede consultar estado sin recibir el secreto', async () => {
  const calls = []
  const handler = createPeruDocumentLookupHandler({
    getEnv: (name) => ({ SUPABASE_URL: 'https://project.supabase.co', PERU_API_TOKEN: 'secret-token-must-not-leak' })[name],
    corsHeaders: {},
    fetchImpl: async (input, init) => {
      const url = String(input)
      calls.push({ url, init })
      if (url.endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: 'authorized-user' }), { status: 200 })
      return new Response('true', { status: 200 })
    },
  })
  const response = await handler(new Request('https://function.test/peru-document-lookup', {
    method: 'POST',
    headers: { authorization: 'Bearer user-jwt', apikey: 'publishable-key', 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'status' }),
  }))
  assert.equal(response.status, 200)
  assert.deepEqual(JSON.parse(calls[1].init.body), { p_modulo: 'configuracion', p_accion: 'editar' })
  const result = await response.json()
  assert.deepEqual({ state: result.state, provider: result.provider, verified: result.verified }, {
    state: 'configured', provider: 'apis-net', verified: false,
  })
  assert.doesNotMatch(JSON.stringify(result), /secret-token-must-not-leak/)
})

test('la Edge Function solo consulta tras validar una sesión y conserva el token en el servidor', async () => {
  const env = {
    SUPABASE_URL: 'https://project.supabase.co',
    PERU_API_URL: 'https://api.apis.net.pe',
    PERU_API_TOKEN: 'token-servidor-de-prueba',
  }
  const calls = []
  const handler = createPeruDocumentLookupHandler({
    getEnv: (name) => env[name],
    corsHeaders: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type' },
    fetchImpl: async (input, init) => {
      const url = String(input)
      calls.push({ url, init })
      if (url.endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: 'authenticated-user' }), { status: 200 })
      if (url.endsWith('/rest/v1/rpc/tiene_permiso')) return new Response('true', { status: 200 })
      return new Response(JSON.stringify({ nombres: 'Rosa', apellidoPaterno: 'Díaz', apellidoMaterno: 'Paredes' }), { status: 200 })
    },
  })
  const response = await handler(new Request('https://function.test/peru-document-lookup', {
    method: 'POST',
    headers: { authorization: 'Bearer user-jwt', apikey: 'publishable-key', 'content-type': 'application/json' },
    body: JSON.stringify({ tipo_documento: 'DNI', numero: '12345678', modulo: 'clientes' }),
  }))
  assert.equal(response.status, 200)
  const result = await response.json()
  assert.deepEqual(result, normalizedDni)
  assert.equal(calls.length, 3)
  assert.equal(calls[0].url, 'https://project.supabase.co/auth/v1/user')
  assert.equal(calls[0].init.headers.Authorization, 'Bearer user-jwt')
  assert.equal(calls[1].url, 'https://project.supabase.co/rest/v1/rpc/tiene_permiso')
  assert.deepEqual(JSON.parse(calls[1].init.body), { p_modulo: 'clientes', p_accion: 'ver' })
  assert.match(calls[2].url, /^https:\/\/api\.apis\.net\.pe\/v2\/renec\/dni\?numero=12345678$/)
  assert.doesNotMatch(calls[2].url, /token=/i)
  assert.equal(calls[2].init.headers.Authorization, 'Bearer token-servidor-de-prueba')
  assert.equal(calls[2].init.headers.Referer, 'https://apis.net.pe/api-consulta-dni')
  assert.doesNotMatch(JSON.stringify(result), /token-servidor-de-prueba/)
})

test('la Edge Function usa el endpoint documentado de SUNAT para RUC', async () => {
  const calls = []
  const handler = createPeruDocumentLookupHandler({
    getEnv: (name) => ({ SUPABASE_URL: 'https://project.supabase.co', PERU_API_TOKEN: 'token-servidor-de-prueba' })[name],
    corsHeaders: {},
    fetchImpl: async (input, init) => {
      const url = String(input)
      calls.push({ url, init })
      if (url.endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: 'authenticated-user' }), { status: 200 })
      if (url.endsWith('/rest/v1/rpc/tiene_permiso')) return new Response('true', { status: 200 })
      return new Response(JSON.stringify({ razonSocial: 'Tecno S.A.C.', direccion: 'Calle 1' }), { status: 200 })
    },
  })
  const response = await handler(new Request('https://function.test/peru-document-lookup', {
    method: 'POST',
    headers: { authorization: 'Bearer user-jwt', apikey: 'publishable-key', 'content-type': 'application/json' },
    body: JSON.stringify({ tipo_documento: 'RUC', numero: '20123456786', modulo: 'proveedores' }),
  }))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), normalizedRuc)
  assert.deepEqual(JSON.parse(calls[1].init.body), { p_modulo: 'proveedores', p_accion: 'ver' })
  assert.match(calls[2].url, /^https:\/\/api\.apis\.net\.pe\/v2\/sunat\/ruc\?numero=20123456786$/)
  assert.equal(calls[2].init.headers.Authorization, 'Bearer token-servidor-de-prueba')
  assert.equal(calls[2].init.headers.Referer, 'https://apis.net.pe/api-consulta-ruc')
})

test('la Edge Function diferencia documento inexistente de formato rechazado por el proveedor', async () => {
  for (const [providerStatus, expectedStatus] of [[404, 422], [422, 400]]) {
    const handler = createPeruDocumentLookupHandler({
      getEnv: (name) => ({ SUPABASE_URL: 'https://project.supabase.co', PERU_API_TOKEN: 'token-servidor-de-prueba' })[name],
      corsHeaders: {},
      fetchImpl: async (input) => {
        const url = String(input)
        if (url.endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: 'authenticated-user' }), { status: 200 })
        if (url.endsWith('/rest/v1/rpc/tiene_permiso')) return new Response('true', { status: 200 })
        return new Response(JSON.stringify({ error: 'detalle privado del proveedor' }), { status: providerStatus })
      },
    })
    const response = await handler(new Request('https://function.test/peru-document-lookup', {
      method: 'POST',
      headers: { authorization: 'Bearer user-jwt', apikey: 'publishable-key', 'content-type': 'application/json' },
      body: JSON.stringify({ tipo_documento: 'DNI', numero: '12345678', modulo: 'clientes' }),
    }))
    assert.equal(response.status, expectedStatus)
    assert.doesNotMatch(await response.text(), /detalle privado|token-servidor/)
  }
})

test('la Edge Function rechaza llamadas anónimas y destinos de proveedor no aprobados', async () => {
  let providerCalls = 0
  const base = {
    SUPABASE_URL: 'https://project.supabase.co',
    PERU_API_URL: 'https://attacker.example/v1',
    PERU_API_TOKEN: 'token-servidor-de-prueba',
  }
  const handler = createPeruDocumentLookupHandler({
    getEnv: (name) => base[name],
    corsHeaders: {},
    fetchImpl: async (input) => {
      if (String(input).endsWith('/auth/v1/user')) return new Response('{}', { status: 401 })
      providerCalls += 1
      return new Response('{}', { status: 200 })
    },
  })
  const request = (authorization) => new Request('https://function.test/peru-document-lookup', {
    method: 'POST',
    headers: { ...(authorization ? { authorization } : {}), apikey: 'publishable-key', 'content-type': 'application/json' },
    body: JSON.stringify({ tipo_documento: 'DNI', numero: '12345678', modulo: 'clientes' }),
  })
  const anonymous = await handler(request('Bearer anon-token'))
  assert.equal(anonymous.status, 401)
  assert.equal(providerCalls, 0)

  let authenticatedProviderCalls = 0
  const authenticatedHandler = createPeruDocumentLookupHandler({
    getEnv: (name) => base[name],
    corsHeaders: {},
    fetchImpl: async (input) => {
      if (String(input).endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: 'authenticated-user' }), { status: 200 })
      if (String(input).endsWith('/rest/v1/rpc/tiene_permiso')) return new Response('true', { status: 200 })
      authenticatedProviderCalls += 1
      return new Response('{}', { status: 200 })
    },
  })
  const untrustedProvider = await authenticatedHandler(request('Bearer user-jwt'))
  assert.equal(untrustedProvider.status, 503)
  assert.equal(authenticatedProviderCalls, 0)

  base.PERU_API_URL = 'https://dniruc.apisperu.com/api/v1'
  const queryTokenProvider = await authenticatedHandler(request('Bearer user-jwt'))
  assert.equal(queryTokenProvider.status, 503)
  assert.equal(authenticatedProviderCalls, 0)

  base.PERU_API_URL = 'https://api.apis.net.pe/v1'
  const legacyV1Provider = await authenticatedHandler(request('Bearer user-jwt'))
  assert.equal(legacyV1Provider.status, 503)
  assert.equal(authenticatedProviderCalls, 0)

  let deniedProviderCalls = 0
  const deniedHandler = createPeruDocumentLookupHandler({
    getEnv: (name) => base[name],
    corsHeaders: {},
    fetchImpl: async (input) => {
      if (String(input).endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: 'authenticated-user' }), { status: 200 })
      if (String(input).endsWith('/rest/v1/rpc/tiene_permiso')) return new Response('false', { status: 200 })
      deniedProviderCalls += 1
      return new Response('{}', { status: 200 })
    },
  })
  const noModulePermission = await deniedHandler(request('Bearer user-jwt'))
  assert.equal(noModulePermission.status, 403)
  assert.equal(deniedProviderCalls, 0)
})

test('la Edge Function informa si el secreto está presente sin devolverlo ni probar el proveedor', async () => {
  const calls = []
  const env = { SUPABASE_URL: 'https://project.supabase.co', PERU_API_URL: 'https://api.apis.net.pe', PERU_API_TOKEN: 'secreto-interno' }
  const handler = createPeruDocumentLookupHandler({
    getEnv: (name) => env[name],
    corsHeaders: {},
    fetchImpl: async (input) => {
      const url = String(input)
      calls.push(url)
      if (url.endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: 'authenticated-user' }), { status: 200 })
      if (url.endsWith('/rest/v1/rpc/tiene_permiso')) return new Response('true', { status: 200 })
      throw new Error('The provider must not be contacted by a status check')
    },
  })
  const response = await handler(new Request('https://function.test/peru-document-lookup', {
    method: 'POST',
    headers: { authorization: 'Bearer user-jwt', apikey: 'publishable-key', 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'status' }),
  }))
  const body = await response.json()
  assert.equal(response.status, 200)
  assert.equal(body.state, 'configured')
  assert.equal(body.provider, 'apis-net')
  assert.equal(body.verified, false)
  assert.equal(calls.length, 2)
  assert.doesNotMatch(JSON.stringify(body), /secreto-interno|api\.apis\.net\.pe/)

  const missing = createPeruDocumentLookupHandler({
    getEnv: (name) => name === 'SUPABASE_URL' ? env.SUPABASE_URL : undefined,
    corsHeaders: {},
    fetchImpl: async (input) => String(input).endsWith('/auth/v1/user')
      ? new Response(JSON.stringify({ id: 'authenticated-user' }), { status: 200 })
      : String(input).endsWith('/rest/v1/rpc/tiene_permiso')
        ? new Response('true', { status: 200 })
        : new Response('{}', { status: 500 }),
  })
  const missingResponse = await missing(new Request('https://function.test/peru-document-lookup', {
    method: 'POST',
    headers: { authorization: 'Bearer user-jwt', apikey: 'publishable-key', 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'status' }),
  }))
  assert.equal((await missingResponse.json()).state, 'missing_secret')
})

test('la Edge Function maneja preflight y bloquea métodos distintos de POST', async () => {
  const handler = createPeruDocumentLookupHandler({
    getEnv: () => undefined,
    corsHeaders: { 'Access-Control-Allow-Origin': '*' },
    fetchImpl: async () => { throw new Error('no debe llamar a la red') },
  })
  const options = await handler(new Request('https://function.test/peru-document-lookup', { method: 'OPTIONS' }))
  assert.equal(options.status, 200)
  assert.equal(options.headers.get('Access-Control-Allow-Origin'), '*')
  const get = await handler(new Request('https://function.test/peru-document-lookup', { method: 'GET' }))
  assert.equal(get.status, 405)
})

test('la Edge Function rechaza cuerpos JSON que no sean objetos', async () => {
  const handler = createPeruDocumentLookupHandler({
    getEnv: (name) => name === 'SUPABASE_URL' ? 'https://project.supabase.co' : undefined,
    corsHeaders: {},
    fetchImpl: async (input) => String(input).endsWith('/auth/v1/user')
      ? new Response(JSON.stringify({ id: 'authenticated-user' }), { status: 200 })
      : new Response('{}', { status: 200 }),
  })
  for (const body of ['null', '[]', '42', '"texto"']) {
    const response = await handler(new Request('https://function.test/peru-document-lookup', {
      method: 'POST',
      headers: { authorization: 'Bearer user-jwt', apikey: 'publishable-key', 'content-type': 'application/json' },
      body,
    }))
    assert.equal(response.status, 400)
  }
})

test('la configuración de función requiere JWT y expone CORS del SDK', async () => {
  const functionCode = await readFile(new URL('../supabase/functions/_shared/handlePeruLookup.ts', import.meta.url), 'utf8')
  const entryCode = await readFile(new URL('../supabase/functions/peru-document-lookup/index.ts', import.meta.url), 'utf8')
  const denoConfig = JSON.parse(await readFile(new URL('../supabase/functions/peru-document-lookup/deno.json', import.meta.url), 'utf8'))
  const packageLock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'))
  const config = await readFile(new URL('../supabase/config.toml', import.meta.url), 'utf8')
  assert.match(functionCode, /auth\/v1\/user/)
  assert.match(functionCode, /rest\/v1\/rpc\/tiene_permiso/)
  assert.match(functionCode, /getEnv\('PERU_API_TOKEN'\)/)
  assert.match(functionCode, /api\.apis\.net\.pe/)
  assert.doesNotMatch(functionCode, /dniruc\.apisperu\.com/)
  assert.match(entryCode, /corsHeaders/)
  assert.match(entryCode, /@supabase\/supabase-js\/cors/)
  assert.match(entryCode, /Deno\.serve/)
  const pinnedVersion = packageLock.packages['node_modules/@supabase/supabase-js'].version
  assert.equal(denoConfig.imports['@supabase/supabase-js/cors'], `npm:@supabase/supabase-js@${pinnedVersion}/cors`)
  assert.match(config, /\[functions\.peru-document-lookup\][\s\S]*?verify_jwt\s*=\s*true/)
})
