import assert from 'node:assert/strict'
import test from 'node:test'
import { buildAnalysisFromFiles, formatBytes, scoreTone, severityTone } from '../src/data/analyzer.ts'

const insecureFiles = () => [
  { path: 'src/config/aws.js', bytes: 60, text: 'const client = new S3Client({ accessKeyID: \'AKIAXXXXXXXXXXXXXXXX\', secretAccessKey: \'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY\' })' },
  { path: '.env', bytes: 40, text: 'AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI\n' },
  { path: 'package.json', bytes: 80, text: JSON.stringify({ dependencies: { express: '4.18.0', '@aws-sdk/client-s3': '3.0.0' } }) },
  { path: 'src/dao.js', bytes: 90, text: 'const rows = await pool.query(`SELECT * FROM ventas WHERE cliente = ${clienteId}`)' },
]

test('punta credenciales AWS y archivos sensibles con severidades accionables', () => {
  const report = buildAnalysisFromFiles('demo', 'zip', 'demo.zip', insecureFiles())
  const byId = new Map(report.findings.map((finding) => [finding.id, finding]))
  assert.equal(byId.get('S-AWS-CREDENCIAL')?.severity, 'Critica')
  assert.ok(byId.get('S-AWS-CREDENCIAL')?.files.includes('src/config/aws.js'))
  assert.equal(byId.get('S-ENV-INCLUIDO')?.severity, 'Alta')
  assert.ok(byId.get('P-SIN-ENDURECIMIENTO'))
  assert.ok(byId.get('E-SELECT-SIN-PAGINAR'))
  const critical = report.findings.filter((finding) => finding.area === 'Seguridad' && (finding.severity === 'Critica' || finding.severity === 'Alta'))
  assert.ok(critical.length >= 2)
})

test('las puntuaciones quedan acotadas entre 0 y 100 y el total es la media ponderada', () => {
  const insecure = buildAnalysisFromFiles('demo', 'zip', 'demo.zip', insecureFiles())
  const secure = buildAnalysisFromFiles('clean', 'zip', 'clean.zip', [
    { path: 'README.md', bytes: 30, text: '# Demo\n' },
    { path: 'package.json', bytes: 60, text: JSON.stringify({ dependencies: { react: '19.0.0' } }) },
    { path: 'Dockerfile', bytes: 30, text: 'FROM node:22\n' },
    { path: '.github/workflows/ci.yml', bytes: 30, text: 'on: push\njobs:\n' },
    { path: 'tests/main.test.js', bytes: 30, text: 'test()\n' },
  ])
  for (const scores of [insecure.scores, secure.scores]) {
    for (const score of Object.values(scores)) {
      assert.ok(Number.isInteger(score), 'puntaje entero')
      assert.ok(score >= 0 && score <= 100, 'puntaje dentro del rango')
    }
  }
  const expected = Math.round(insecure.scores.security * 0.4 + insecure.scores.scalability * 0.3 + insecure.scores.cloudReadiness * 0.3)
  assert.ok(Math.abs(insecure.scores.total - expected) <= 1)
  assert.ok(secure.scores.security > insecure.scores.security)
})

test('reconoce la pila del proyecto y los servicios AWS por evidencias', () => {
  const report = buildAnalysisFromFiles('demo', 'zip', 'demo.zip', insecureFiles())
  assert.ok(report.stack.includes('JavaScript'))
  assert.ok(report.stack.includes('AWS SDK v3'))
  assert.deepEqual(report.stats.languages, ['JavaScript'])
  const s3 = report.aws.find((insight) => insight.service === 'Amazon S3')
  assert.ok(s3, 'debe detectar Amazon S3')
  assert.ok(s3.category.length > 0)
  const clean = buildAnalysisFromFiles('clean', 'zip', 'clean.zip', [
    { path: 'README.md', bytes: 30, text: '# Demo\n' },
    { path: 'package.json', bytes: 60, text: JSON.stringify({ dependencies: {} }) },
    { path: 'Dockerfile', bytes: 30, text: 'FROM node:22\n' },
    { path: '.github/workflows/ci.yml', bytes: 30, text: 'on: push\njobs:\n' },
    { path: 'tests/main.test.js', bytes: 30, text: 'test()\n' },
  ])
  assert.equal(clean.aws.length, 0)
  assert.equal(clean.findings.length, 0)
})

test('mapea severidades y puntuaciones a los tonos de las etiquetas', () => {
  assert.equal(severityTone('Critica'), 'red')
  assert.equal(severityTone('Alta'), 'amber')
  assert.equal(severityTone('Media'), 'blue')
  assert.equal(severityTone('Info'), 'green')
  assert.equal(scoreTone(90), 'green')
  assert.equal(scoreTone(60), 'amber')
  assert.equal(scoreTone(10), 'red')
  assert.equal(formatBytes(2048), '2.0 KB')
  assert.equal(formatBytes(0), '0 B')
})
