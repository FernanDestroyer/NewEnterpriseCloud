import assert from 'node:assert/strict'
import test from 'node:test'
import { parseSuppliersCsv, splitCsvLine, SUPPLIER_CSV_EXAMPLE, SUPPLIER_CSV_HEADER } from '../src/services/import.ts'

const header = SUPPLIER_CSV_HEADER.join(',')
const row = (...cells) => cells.join(',')
const validRow = row('20123456786', 'Importadora Prueba S.A.C.', 'Av. Prueba 456', 'contacto@prueba.pe', '987654321', 'Contado', 'Activo', '"Tubo Demo | 12.50 | Tuberías // Codo Demo | 16.75 | Conexiones"')

test('divide celdas respetando comillas y comas internas', () => {
  assert.deepEqual(splitCsvLine('a,"b, c",d'), ['a', 'b, c', 'd'])
  assert.deepEqual(splitCsvLine('"dicho ""hola""",x'), ['dicho "hola"', 'x'])
  assert.deepEqual(splitCsvLine('  a , ,c '), ['a', '', 'c'])
})

test('la plantilla de ejemplo es válida y trae productos', () => {
  assert.deepEqual(SUPPLIER_CSV_HEADER, ['ruc', 'razon_social', 'direccion', 'correo', 'telefono', 'forma_pago', 'estado', 'productos'])
  const parsed = parseSuppliersCsv([header, SUPPLIER_CSV_EXAMPLE.join(',')].join('\n'))
  assert.equal(parsed.errors.length, 0)
  assert.equal(parsed.rows.length, 1)
  assert.deepEqual(parsed.rows[0].productos, [
    { nombre: 'Tubo Demo', costo: 12.5, detalle: 'Tuberías' },
    { nombre: 'Codo Demo', costo: 16.75, detalle: 'Conexiones' },
  ])
  assert.equal(parsed.rows[0].formaPago, 'Contado')
})

test('acepta BOM, CRLF y columnas en otro orden', () => {
  const text = '\uFEFFrazon_social,ruc,estado\r\n"Mi Empresa, S.A.C.",20123456786,En curso\r\n'
  const parsed = parseSuppliersCsv(text)
  assert.equal(parsed.errors.length, 0)
  assert.equal(parsed.rows[0].razonSocial, 'Mi Empresa, S.A.C.')
  assert.equal(parsed.rows[0].estado, 'En curso')
})

test('rechaza archivo vacío y cabecera incompleta', () => {
  assert.match(parseSuppliersCsv('   \n').errors[0], /vacío/)
  assert.match(parseSuppliersCsv('nombre,ruc\nx,20123456786').errors[0], /razon_social/)
})

test('cada fila inválida se reporta con su línea sin frenar las demás', () => {
  const parsed = parseSuppliersCsv([header,
    row('123', 'Muy Corto', '', '', '', '', '', ''),
    row('20123456789', 'Checksum Malo S.A.C.', '', '', '', '', '', ''),
    row('20123456786', 'X', '', '', '', '', '', ''),
    row('20123456786', 'Duplicada S.A.C.', '', '', '', '', '', ''),
    row('20123456786', 'Otra Duplicada S.A.C.', '', '', '', '', '', ''),
    row('20543218767', 'Correo Malo S.A.C.', '', 'sin-arroba', '', '', '', ''),
    row('20543218767', 'Telefono Malo S.A.C.', '', '', '12', '', '', ''),
    validRow,
  ].join('\n'))
  assert.equal(parsed.rows.length, 1)
  assert.equal(parsed.rows[0].ruc, '20123456786')
  assert.equal(parsed.errors.length, 7)
  assert.ok(parsed.errors.some((message) => message.includes('Línea 2') && message.includes('11 dígitos')))
  assert.ok(parsed.errors.some((message) => message.includes('verificador')))
  assert.ok(parsed.errors.some((message) => message.includes('duplicado'), 'esperaba duplicado'))
  assert.ok(parsed.errors.some((message) => message.includes('correo')))
  assert.ok(parsed.errors.some((message) => message.includes('teléfono')))
})

test('los productos con costo inválido se observan sin tumbar la fila', () => {
  const parsed = parseSuppliersCsv([header,
    row('20123456786', 'Con Productos S.A.C.', '', '', '', '', '', '"Bien | 10 | Ok // Sin costo | abc | X //  | 5 | Sin nombre"'),
  ].join('\n'))
  assert.equal(parsed.rows.length, 1)
  assert.deepEqual(parsed.rows[0].productos, [{ nombre: 'Bien', costo: 10, detalle: 'Ok' }])
  assert.equal(parsed.productIssues.length, 2)
})

test('el estado desconocido cae a Activo', () => {
  const parsed = parseSuppliersCsv([header, row('20123456786', 'Estado Raro S.A.C.', '', '', '', '', 'Congelado', '')].join('\n'))
  assert.equal(parsed.rows[0].estado, 'Activo')
  assert.deepEqual(parsed.rows[0].productos, [])
})

test('la columna linea_credito antigua se ignora sin romper', () => {
  const parsed = parseSuppliersCsv([`${header},linea_credito`,
    row('20123456786', 'Con Columna Antigua S.A.C.', '', '', '', '', 'Activo', '""', '9999'),
  ].join('\n'))
  assert.equal(parsed.errors.length, 0)
  assert.equal(parsed.rows.length, 1)
})
