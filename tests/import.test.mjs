import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { CUSTOMER_CSV_EXAMPLE, CUSTOMER_CSV_HEADER, parseCustomersCsv, parseSuppliersCsv, splitCsvLine, SUPPLIER_CSV_EXAMPLE, SUPPLIER_CSV_HEADER } from '../src/services/import.ts'

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

// ---------------------------------------------------------------------------
// Clientes
// ---------------------------------------------------------------------------
const customerHeader = CUSTOMER_CSV_HEADER.join(',')

test('la plantilla de clientes es válida', () => {
  assert.deepEqual(CUSTOMER_CSV_HEADER, ['tipo_doc', 'documento', 'razon_social', 'detalle', 'linea_credito', 'estado'])
  const parsed = parseCustomersCsv([customerHeader, CUSTOMER_CSV_EXAMPLE.join(',')].join('\n'))
  assert.equal(parsed.errors.length, 0)
  assert.equal(parsed.rows.length, 1)
  assert.deepEqual(parsed.rows[0], {
    line: 2,
    tipoDoc: 'DNI',
    documento: '45678912',
    razonSocial: 'María Torres Quispe',
    detalle: 'Contacto: 987654321 · maria@correo.pe',
    lineaCredito: 500,
    estado: 'Activo',
  })
})

test('el dataset de ejemplo de clientes se importa completo y sin errores', () => {
  const text = readFileSync(new URL('../dataset-clientes.csv', import.meta.url), 'utf8')
  const parsed = parseCustomersCsv(text)
  assert.deepEqual(parsed.errors, [])
  assert.equal(parsed.rows.length, 18)
  assert.equal(parsed.rows.filter((item) => item.tipoDoc === 'DNI').length, 10)
  assert.equal(parsed.rows.filter((item) => item.tipoDoc === 'RUC').length, 8)
  assert.ok(parsed.rows.some((item) => item.estado === 'En curso'))
  // Una celda con coma entre comillas se conserva completa.
  assert.ok(parsed.rows.some((item) => item.detalle.startsWith('Contacto: Av. Arequipa 1520, Lima')))
})

test('clientes: deduce DNI/RUC por la longitud, acepta BOM, CRLF y otro orden de columnas', () => {
  const text = '﻿razon_social,documento\r\nAna Pérez,12345678\r\n"Mi Empresa, S.A.C.",20100000017\r\n'
  const parsed = parseCustomersCsv(text)
  assert.equal(parsed.errors.length, 0)
  assert.equal(parsed.rows[0].tipoDoc, 'DNI')
  assert.equal(parsed.rows[1].tipoDoc, 'RUC')
  assert.equal(parsed.rows[1].razonSocial, 'Mi Empresa, S.A.C.')
  assert.equal(parsed.rows[0].lineaCredito, 0)
  assert.equal(parsed.rows[0].estado, 'Activo')
})

test('clientes: rechaza archivo vacío y cabecera incompleta', () => {
  assert.match(parseCustomersCsv('  \n').errors[0], /vacío/)
  assert.match(parseCustomersCsv('nombre,telefono\nx,1').errors[0], /documento y razon_social/)
})

test('clientes: cada fila inválida se reporta con su línea sin frenar las demás', () => {
  const parsed = parseCustomersCsv([customerHeader,
    ',123,Documento Corto,,,',
    'DNI,12345678,X,,,',
    'XYZ,12345678,Tipo Raro,,,',
    'RUC,20100000018,Checksum Malo S.A.C.,,,',
    'DNI,12345678,Línea Negativa,,-5,',
    'DNI,11111111,Línea Texto,,abc,',
    'DNI,22222222,Primero,,,',
    'DNI,22222222,Repetido,,,',
    'DNI,33333333,Válido Final,,"1250,50",En curso',
  ].join('\n'))
  assert.deepEqual(parsed.rows.map((item) => item.documento), ['22222222', '33333333'])
  assert.equal(parsed.rows[1].lineaCredito, 1250.5)
  assert.equal(parsed.rows[1].estado, 'En curso')
  assert.equal(parsed.errors.length, 7)
  assert.ok(parsed.errors.some((message) => message.includes('Línea 2') && message.includes('8 dígitos (DNI) u 11')))
  assert.ok(parsed.errors.some((message) => message.includes('Línea 3') && message.includes('razón social')))
  assert.ok(parsed.errors.some((message) => message.includes('tipo_doc inválido')))
  assert.ok(parsed.errors.some((message) => message.includes('verificador')))
  assert.equal(parsed.errors.filter((message) => message.includes('línea de crédito inválida')).length, 2)
  assert.ok(parsed.errors.some((message) => message.includes('Línea 9') && message.includes('duplicado')))
})
