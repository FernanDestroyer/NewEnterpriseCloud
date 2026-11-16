import assert from 'node:assert/strict'
import test from 'node:test'
import { createProjectAnalyzerHandler } from '../supabase/functions/_shared/handleProjectAnalyzer.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function makeHandler({ permission = true, authenticated = true } = {}) {
  const calls = []
  const handler = createProjectAnalyzerHandler({
    getEnv: name => name === 'SUPABASE_URL' ? 'https://example.supabase.co/' : undefined,
    corsHeaders,
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options })
      if (String(url).endsWith('/auth/v1/user')) {
        return authenticated
          ? Response.json({ id: 'user-1' })
          : new Response('{}', { status: 401 })
      }
      if (String(url).endsWith('/rest/v1/rpc/tiene_permiso')) return Response.json(permission)
      return new Response('{}', { status: 404 })
    },
  })
  return { handler, calls }
}

function request(body, { token = 'valid-token' } = {}) {
  return new Request('https://example.supabase.co/functions/v1/project-analyzer', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, apikey: 'publishable-key', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const validPayload = {
  name: 'demo',
  kind: 'zip',
  origin: 'demo.zip',
  coverage: { filesAvailable: 2, bytesAvailable: 130, textFilesAvailable: 1, inventoryComplete: true, bytesTotalKnown: true },
  files: [
    { path: 'package.json', bytes: 100, text: '{"dependencies":{"@aws-sdk/client-s3":"3"}}' },
    { path: 'assets/logo.png', bytes: 30 },
  ],
}

test('la función responde OPTIONS sin consultar identidad ni permisos', async () => {
  const { handler, calls } = makeHandler()
  const response = await handler(new Request('https://example.supabase.co/functions/v1/project-analyzer', { method: 'OPTIONS' }))
  assert.equal(response.status, 200)
  assert.equal(calls.length, 0)
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*')
})

test('rechaza solicitudes sin usuario autenticado y no ejecuta el análisis', async () => {
  const { handler, calls } = makeHandler({ authenticated: false })
  const response = await handler(request(validPayload))
  assert.equal(response.status, 403)
  assert.equal(calls.length, 1)
  assert.match((await response.json()).error, /sesión con permiso/i)
})

test('rechaza usuarios sin permiso de analizador', async () => {
  const { handler, calls } = makeHandler({ permission: false })
  const response = await handler(request(validPayload))
  assert.equal(response.status, 403)
  assert.equal(calls.length, 2)
  assert.match(calls[1].url, /tiene_permiso$/)
  assert.deepEqual(JSON.parse(calls[1].options.body), { p_modulo: 'analizador', p_accion: 'ver' })
})

test('analiza en servidor, devuelve cobertura y no persiste el código ni el informe', async () => {
  const { handler, calls } = makeHandler()
  const response = await handler(request(validPayload))
  const report = await response.json()
  assert.equal(response.status, 200)
  assert.equal(report.analysisVersion, 1)
  assert.equal(report.name, 'demo')
  assert.equal(report.stats.files, 2)
  assert.equal(report.stats.bytes, 130)
  assert.deepEqual(report.coverage, {
    filesAvailable: 2,
    filesSent: 2,
    textFilesAvailable: 1,
    textFilesSent: 1,
    inventoryComplete: true,
    bytesTotalKnown: true,
  })
  assert.ok(report.awsRecommendations.some(item => item.service === 'Amazon S3'))
  assert.equal(calls.length, 2, 'solo llama Auth y la RPC de permisos; no inserta ni almacena el contenido')
})

test('rechaza rutas que intentan salir del proyecto', async () => {
  const { handler } = makeHandler()
  const payload = structuredClone(validPayload)
  payload.files[0].path = '../secreto.env'
  const response = await handler(request(payload))
  assert.equal(response.status, 400)
})

test('rechaza textos y cantidades por encima de los límites documentados', async () => {
  const { handler } = makeHandler()
  const tooMuchText = structuredClone(validPayload)
  tooMuchText.coverage.textFilesAvailable = 1
  tooMuchText.files[0].text = 'x'.repeat(131_073)
  const textResponse = await handler(request(tooMuchText))
  assert.equal(textResponse.status, 400)

  const tooManyFiles = structuredClone(validPayload)
  tooManyFiles.files = Array.from({ length: 2_501 }, (_, index) => ({ path: `file-${index}.txt`, bytes: 1 }))
  tooManyFiles.coverage.filesAvailable = 2_501
  tooManyFiles.coverage.bytesAvailable = 2_501
  tooManyFiles.coverage.textFilesAvailable = 0
  const countResponse = await handler(request(tooManyFiles))
  assert.equal(countResponse.status, 400)
})

test('rechaza cuerpos que superan 1.8 MB antes de analizar', async () => {
  const { handler } = makeHandler()
  const oversized = { ...validPayload, files: [{ path: 'large.txt', bytes: 1_900_000, text: 'x'.repeat(1_900_000) }] }
  const response = await handler(request(oversized))
  assert.equal(response.status, 413)
})

test('solo admite POST y OPTIONS', async () => {
  const { handler, calls } = makeHandler()
  const response = await handler(new Request('https://example.supabase.co/functions/v1/project-analyzer', { method: 'GET' }))
  assert.equal(response.status, 405)
  assert.equal(calls.length, 0)
})
