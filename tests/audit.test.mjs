import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AUDIT_CSV_HEADER, HIDDEN_VALUE, auditChanges, auditCsvRows, auditDayBounds, auditModuleLabel,
  auditModuleOptions, auditRangeError, escapeLike, formatAuditValue, fieldLabel, pageWindow,
} from '../src/data/audit.ts'

test('las tablas conocidas tienen etiqueta y las nuevas se muestran legibles', () => {
  assert.equal(auditModuleLabel('detalle_recepciones_compra'), 'Detalle de recepciones')
  assert.equal(auditModuleLabel('despachos_ruta'), 'Despachos ruta')
  const options = auditModuleOptions(['tabla_nueva', 'ventas'])
  assert.ok(options.some(option => option.value === 'tabla_nueva' && option.label === 'Tabla nueva'))
  assert.equal(options.filter(option => option.value === 'ventas').length, 1)
})

test('el filtro de fechas usa el día de negocio de Lima (UTC-5), con fin exclusivo', () => {
  assert.deepEqual(auditDayBounds('2026-10-26', '2026-10-26'), { gte: '2026-10-26T05:00:00.000Z', lt: '2026-10-27T05:00:00.000Z' })
  assert.deepEqual(auditDayBounds('2026-12-31', '2026-12-31'), { gte: '2026-12-31T05:00:00.000Z', lt: '2027-01-01T05:00:00.000Z' })
  assert.deepEqual(auditDayBounds('', ''), {})
  assert.deepEqual(auditDayBounds('basura', undefined), {})
})

test('un evento a las 23:30 de Lima cae dentro de su día y no del siguiente', () => {
  const { gte, lt } = auditDayBounds('2026-10-26', '2026-10-26')
  const event = new Date('2026-10-27T04:30:00Z') // 23:30 en Lima del 26
  assert.ok(event >= new Date(gte) && event < new Date(lt))
})

test('el rango inválido se detecta', () => {
  assert.equal(auditRangeError('2026-10-27', '2026-10-26'), 'La fecha inicial no puede ser posterior a la final.')
  assert.equal(auditRangeError('2026-10-26', '2026-10-26'), null)
  assert.equal(auditRangeError('26/10/2026', ''), 'La fecha inicial no es válida.')
})

test('el texto buscado no actúa como comodín de LIKE', () => {
  assert.equal(escapeLike(' 50%_off\\ '), '50\\%\\_off\\\\')
})

test('un UPDATE lista solo los campos que cambiaron', () => {
  const changes = auditChanges(
    { id: 'a', monto: 10, estado: 'Pendiente', updated_at: '1' },
    { id: 'a', monto: 25, estado: 'Pendiente', updated_at: '2' },
  )
  assert.deepEqual(changes.map(change => change.field), ['monto', 'updated_at'])
  assert.deepEqual(changes[0], { field: 'monto', label: 'Monto', before: '10.00', after: '25.00', kind: 'changed', type: 'money', technical: false, hidden: false })
})

test('INSERT y DELETE marcan los campos como creados o eliminados', () => {
  const created = auditChanges(null, { nombre: 'Caja 1', activo: true })
  assert.deepEqual(created.map(change => [change.field, change.before, change.after, change.kind]), [
    ['activo', '—', 'Sí', 'added'],
    ['nombre', '—', 'Caja 1', 'added'],
  ])
  const removed = auditChanges({ nombre: 'Caja 1' }, null)
  assert.equal(removed[0].kind, 'removed')
  assert.equal(removed[0].after, '—')
})

test('los campos sensibles no devuelven su valor', () => {
  const [change] = auditChanges({ password_hash: 'abc', api_key: 'x' }, { password_hash: 'def', api_key: 'x' })
  assert.equal(change.field, 'password_hash')
  assert.equal(change.before, HIDDEN_VALUE)
  assert.equal(change.after, HIDDEN_VALUE)
  assert.equal(change.hidden, true)
  const created = auditChanges(null, { token: 'secreto' })
  assert.equal(created[0].after, HIDDEN_VALUE)
})

test('los valores largos, objetos y archivos incrustados se resumen', () => {
  assert.equal(formatAuditValue(null), '—')
  assert.equal(formatAuditValue(''), '(vacío)')
  assert.equal(formatAuditValue({ a: 1 }), '{"a":1}')
  assert.match(formatAuditValue('data:image/png;base64,AAAA'), /^\[archivo incrustado/)
  assert.equal(formatAuditValue('x'.repeat(500)).length, 161)
})

test('las marcas de tiempo técnicas quedan al final', () => {
  const changes = auditChanges({ updated_at: '1', zeta: 1, alfa: 1 }, { updated_at: '2', zeta: 2, alfa: 2 })
  assert.deepEqual(changes.map(change => change.field), ['alfa', 'zeta', 'updated_at'])
})

test('la exportación CSV usa etiquetas y hora de Lima', () => {
  const rows = auditCsvRows([{ createdAt: '2026-10-27T04:30:00Z', email: 'a@b.pe', modulo: 'ventas', accion: 'INSERT', registro: 'V-001', resultado: 'exitoso' }])
  assert.equal(AUDIT_CSV_HEADER.length, rows[0].length)
  assert.match(rows[0][0], /26\/10\/26|26\/10\/2026/)
  assert.deepEqual(rows[0].slice(1), ['a@b.pe', 'Ventas', 'Creación', 'V-001', 'exitoso'])
})

test('la paginación muestra primera, última y vecinas, con saltos', () => {
  assert.deepEqual(pageWindow(0, 0), [])
  assert.deepEqual(pageWindow(0, 1), [0])
  assert.deepEqual(pageWindow(0, 3), [0, 1, 2])
  assert.deepEqual(pageWindow(0, 10), [0, 1, '…', 9])
  assert.deepEqual(pageWindow(4, 10), [0, '…', 3, 4, 5, '…', 9])
  assert.deepEqual(pageWindow(9, 10), [0, '…', 8, 9])
  assert.deepEqual(pageWindow(2, 10), [0, 1, 2, 3, '…', 9])
})

test('los nombres de campo se muestran en español y con tilde', () => {
  assert.equal(fieldLabel('descripcion'), 'Descripción')
  assert.equal(fieldLabel('precio_unitario'), 'Precio unitario')
  assert.equal(fieldLabel('cotizacion_id'), 'Cotización')
  assert.equal(fieldLabel('campo_nuevo'), 'Campo nuevo')
})

test('importes, fechas y referencias se formatean y los campos técnicos van al final', () => {
  const changes = auditChanges(null, {
    id: '37298b98-ed1b-4b39-983d-aa4847b0ae9f',
    cotizacion_id: '743080bd-c6cc-4d01-af21-f098d06cefb4',
    cantidad: 1,
    precio_unitario: 7.9,
    subtotal: 1234.5,
    created_at: '2026-10-27T05:55:00Z',
    fecha_limite: '2026-11-05',
  })
  const byField = Object.fromEntries(changes.map(change => [change.field, change]))
  assert.equal(byField.precio_unitario.after, '7.90')
  assert.equal(byField.subtotal.after, '1,234.50')
  assert.equal(byField.subtotal.type, 'money')
  assert.equal(byField.cantidad.type, 'text')
  assert.equal(byField.cotizacion_id.type, 'ref')
  assert.equal(byField.fecha_limite.after, '05/11/2026')
  assert.match(byField.created_at.after, /27\/10\/26|27\/10\/2026/)
  assert.equal(byField.id.technical, true)
  assert.equal(byField.created_at.technical, true)
  assert.equal(byField.cotizacion_id.technical, false)
  const firstTechnical = changes.findIndex(change => change.technical)
  assert.ok(changes.slice(firstTechnical).every(change => change.technical))
})

// ---- Eventos denegados / fallidos ----
import { clasificarFallo, registrarEventoFallido } from '../src/lib/auditoriaEventos.ts'

test('clasifica 42501 y rechazos de RLS como denegado, y el resto como fallido', () => {
  assert.equal(clasificarFallo({ code: '42501', message: 'x' }), 'denegado')
  assert.equal(clasificarFallo({ message: 'new row violates row-level security policy' }), 'denegado')
  assert.equal(clasificarFallo({ code: '23514', message: 'check' }), 'fallido')
})

test('registrarEventoFallido llama al RPC con los datos del intento y tolera clientes sin rpc', async () => {
  const llamadas = []
  const cliente = { rpc: (nombre, args) => { llamadas.push({ nombre, args }); return Promise.resolve({ error: null }) } }
  registrarEventoFallido(cliente, 'INSERT', 'despachos', 'DSP-1', { code: '42501', message: 'sin permiso' })
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(llamadas.length, 1)
  assert.equal(llamadas[0].nombre, 'registrar_evento_auditoria')
  assert.equal(llamadas[0].args.p_resultado, 'denegado')
  assert.equal(llamadas[0].args.p_modulo, 'despachos')
  assert.doesNotThrow(() => registrarEventoFallido({}, 'INSERT', 'x', null, new Error('e')))
  assert.doesNotThrow(() => registrarEventoFallido(null, 'INSERT', 'x', null, new Error('e')))
  const roto = { rpc: () => Promise.reject(new Error('red')) }
  assert.doesNotThrow(() => registrarEventoFallido(roto, 'INSERT', 'x', null, new Error('e')))
})
