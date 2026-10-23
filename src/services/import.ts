// -----------------------------------------------------------------------------
// Importación masiva de proveedores con su catálogo de productos (CSV).
// Formato esperado (coma como separador, comillas estándar para celdas con coma):
//   ruc,razon_social,direccion,correo,telefono,forma_pago,estado,productos
// La celda productos lista ofertas separadas por //, cada una como:
//   nombre | costo | detalle(opcional)
// Ejemplo:
//   20123456786,Mi Empresa S.A.C.,Av. Lima 123,contacto@empresa.pe,987654321,Contado,Activo,"Tubo PVC | 8.50 | Tuberías // Codo PVC | 16.75 | Conexiones"
// Nota: la columna linea_credito ya no se usa en proveedores (solo clientes).
// Si un CSV antiguo la trae, se ignora.
// -----------------------------------------------------------------------------

import { isValidRuc } from './peru.ts'

export const SUPPLIER_CSV_HEADER = ['ruc', 'razon_social', 'direccion', 'correo', 'telefono', 'forma_pago', 'estado', 'productos']

export const SUPPLIER_PAYMENT_TERMS = ['Contado', 'Transferencia bancaria', 'Yape / Plin', 'Crédito 30 días', 'Crédito 60 días']

export const SUPPLIER_CSV_EXAMPLE = [
  '20123456786',
  'Importadora Ejemplo S.A.C.',
  'Av. Ejemplo 456',
  'contacto@ejemplo.pe',
  '987654321',
  'Contado',
  'Activo',
  'Tubo Demo | 12.50 | Tuberías // Codo Demo | 16.75 | Conexiones',
]

export const CUSTOMER_CSV_HEADER = ['razon_social', 'tipo_doc', 'documento', 'detalle', 'linea_credito', 'estado']
export const CUSTOMER_CSV_EXAMPLE = ['Cliente Ejemplo S.A.C.', 'RUC', '20123456786', 'Cliente mayorista', '5000', 'Activo']
export const SALES_CSV_HEADER = ['codigo', 'fecha', 'cliente_codigo', 'cliente_nombre', 'detalle', 'monto', 'estado', 'medio_pago']
export const SALES_CSV_EXAMPLE = ['VEN-EXT-001', '2026-10-22', 'CLI-001', 'Cliente Ejemplo S.A.C.', 'Factura F001-25', '250.00', 'Pendiente', '']
export const PURCHASES_CSV_HEADER = ['codigo', 'fecha', 'proveedor_codigo', 'proveedor_nombre', 'detalle', 'monto', 'estado', 'fecha_limite', 'comprobante_tipo', 'comprobante_numero']
export const PURCHASES_CSV_EXAMPLE = ['OC-EXT-001', '2026-10-22', 'PRV-001', 'Proveedor Ejemplo S.A.C.', 'Orden de compra', '120.00', 'Solicitud', '', '', '']

export type CustomerImportRow = { line: number; razonSocial: string; tipoDoc: 'DNI' | 'RUC' | null; documento: string; detalle: string; lineaCredito: number; estado: 'Activo' | 'En curso' }
export type SalesImportRow = { line: number; codigo: string; fecha: string; clienteCodigo: string; clienteNombre: string; detalle: string; monto: number; estado: 'Pendiente' | 'En curso' | 'Completada'; medioPago: string }
export type PurchaseImportRow = { line: number; codigo: string; fecha: string; proveedorCodigo: string; proveedorNombre: string; detalle: string; monto: number; estado: 'Pendiente' | 'Solicitud' | 'Orden' | 'Recibida' | 'Recepción' | 'Factura' | 'Pagada'; fechaLimite: string; comprobanteTipo: string; comprobanteNumero: string }

function validIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}
export type SimpleImportParse<T> = { rows: T[]; errors: string[] }

function parseTabular<T>(text: string, required: string[], mapRow: (cell: (name: string) => string, line: number, fail: (reason: string) => void) => T | null): SimpleImportParse<T> {
  const errors: string[] = []
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  if (!lines.length) return { rows: [], errors: ['El archivo está vacío. Descarga la plantilla para ver el formato.'] }
  const header = splitCsvLine(lines[0]).map(cell => cell.toLowerCase())
  const missing = required.filter(name => !header.includes(name))
  if (missing.length) return { rows: [], errors: [`Faltan columnas obligatorias: ${missing.join(', ')}.`] }
  const rows: T[] = []
  lines.slice(1).forEach((raw, index) => {
    const line = index + 2
    const cells = splitCsvLine(raw)
    const cell = (name: string) => cells[header.indexOf(name)]?.trim() ?? ''
    let invalid = false
    const fail = (reason: string) => { errors.push(`Línea ${line}: ${reason}`); invalid = true }
    const row = mapRow(cell, line, fail)
    if (row && !invalid) rows.push(row)
  })
  return { rows, errors }
}

function parseAmount(raw: string, label: string, fail: (reason: string) => void, fallback = 0) {
  if (!raw) return fallback
  const normalized = raw.includes(',') && !raw.includes('.') ? raw.replace(',', '.') : raw
  const value = Number(normalized)
  if (!Number.isFinite(value) || value < 0) { fail(`${label} debe ser un número igual o mayor a cero.`); return fallback }
  return Math.round(value * 100) / 100
}

export function parseCustomersCsv(text: string): SimpleImportParse<CustomerImportRow> {
  const seen = new Set<string>()
  return parseTabular(text, ['razon_social'], (cell, line, fail) => {
    const razonSocial = cell('razon_social')
    if (razonSocial.length < 2) fail('razon_social debe tener al menos 2 caracteres.')
    let tipoDoc = cell('tipo_doc').toUpperCase()
    const documento = cell('documento').replace(/\D/g, '')
    if (!tipoDoc && documento) tipoDoc = documento.length === 11 ? 'RUC' : documento.length === 8 ? 'DNI' : ''
    if (tipoDoc && tipoDoc !== 'DNI' && tipoDoc !== 'RUC') fail('tipo_doc debe ser DNI o RUC.')
    if (documento && tipoDoc === 'DNI' && !/^\d{8}$/.test(documento)) fail('El DNI debe tener 8 dígitos.')
    if (documento && tipoDoc === 'RUC' && (!/^\d{11}$/.test(documento) || !isValidRuc(documento))) fail('El RUC debe tener 11 dígitos y un verificador válido.')
    if (tipoDoc && !documento) fail('documento es obligatorio cuando se especifica tipo_doc.')
    const duplicateKey = documento ? `${tipoDoc}:${documento}` : razonSocial.toLocaleLowerCase('es')
    if (duplicateKey && seen.has(duplicateKey)) fail('Cliente duplicado dentro del archivo.')
    if (duplicateKey) seen.add(duplicateKey)
    const lineaCredito = parseAmount(cell('linea_credito'), 'linea_credito', fail)
    const estadoRaw = cell('estado') || 'Activo'
    if (estadoRaw !== 'Activo' && estadoRaw !== 'En curso') fail('estado debe ser Activo o En curso.')
    const estado = estadoRaw === 'Activo' || estadoRaw === 'En curso' ? estadoRaw : 'Activo'
    return { line, razonSocial, tipoDoc: tipoDoc === 'DNI' || tipoDoc === 'RUC' ? tipoDoc : null, documento, detalle: cell('detalle'), lineaCredito, estado }
  })
}

export function parseSalesCsv(text: string): SimpleImportParse<SalesImportRow> {
  const seen = new Set<string>()
  return parseTabular(text, ['codigo', 'cliente_nombre', 'detalle', 'monto'], (cell, line, fail) => {
    const codigo = cell('codigo')
    const clienteNombre = cell('cliente_nombre')
    if (codigo.length < 2) fail('codigo es obligatorio y debe tener al menos 2 caracteres.')
    if (seen.has(codigo.toLocaleLowerCase('es'))) fail('codigo duplicado dentro del archivo.')
    seen.add(codigo.toLocaleLowerCase('es'))
    if (clienteNombre.length < 2) fail('cliente_nombre debe tener al menos 2 caracteres.')
    if (!cell('monto')) fail('monto es obligatorio.')
    const monto = parseAmount(cell('monto'), 'monto', fail)
    const fecha = cell('fecha')
    if (fecha && !validIsoDate(fecha)) fail('fecha debe ser una fecha válida con formato AAAA-MM-DD.')
    const estadoRaw = cell('estado') || 'Pendiente'
    const allowed = ['Pendiente', 'En curso', 'Completada'] as const
    if (!allowed.includes(estadoRaw as typeof allowed[number])) fail(`estado debe ser uno de: ${allowed.join(', ')}.`)
    return { line, codigo, fecha, clienteCodigo: cell('cliente_codigo'), clienteNombre, detalle: cell('detalle'), monto, estado: allowed.includes(estadoRaw as typeof allowed[number]) ? estadoRaw as SalesImportRow['estado'] : 'Pendiente', medioPago: cell('medio_pago') }
  })
}

export function parsePurchasesCsv(text: string): SimpleImportParse<PurchaseImportRow> {
  const seen = new Set<string>()
  return parseTabular(text, ['codigo', 'proveedor_nombre', 'detalle', 'monto'], (cell, line, fail) => {
    const codigo = cell('codigo')
    const proveedorNombre = cell('proveedor_nombre')
    if (codigo.length < 2) fail('codigo es obligatorio y debe tener al menos 2 caracteres.')
    if (seen.has(codigo.toLocaleLowerCase('es'))) fail('codigo duplicado dentro del archivo.')
    seen.add(codigo.toLocaleLowerCase('es'))
    if (proveedorNombre.length < 2) fail('proveedor_nombre debe tener al menos 2 caracteres.')
    if (!cell('monto')) fail('monto es obligatorio.')
    const monto = parseAmount(cell('monto'), 'monto', fail)
    const fecha = cell('fecha')
    if (fecha && !validIsoDate(fecha)) fail('fecha debe ser una fecha válida con formato AAAA-MM-DD.')
    const allowed = ['Pendiente', 'Solicitud', 'Orden', 'Recibida', 'Recepción', 'Factura', 'Pagada'] as const
    const estadoRaw = cell('estado') || 'Solicitud'
    if (!allowed.includes(estadoRaw as typeof allowed[number])) fail(`estado debe ser uno de: ${allowed.join(', ')}.`)
    const fechaLimite = cell('fecha_limite')
    if (fechaLimite && !validIsoDate(fechaLimite)) fail('fecha_limite debe ser una fecha válida con formato AAAA-MM-DD.')
    return { line, codigo, fecha, proveedorCodigo: cell('proveedor_codigo'), proveedorNombre, detalle: cell('detalle'), monto, estado: allowed.includes(estadoRaw as typeof allowed[number]) ? estadoRaw as PurchaseImportRow['estado'] : 'Solicitud', fechaLimite, comprobanteTipo: cell('comprobante_tipo'), comprobanteNumero: cell('comprobante_numero') }
  })
}

export type SupplierProductDraft = { nombre: string; costo: number; detalle: string }

export type SupplierImportRow = {
  line: number
  ruc: string
  razonSocial: string
  direccion: string
  correo: string
  telefono: string
  formaPago: string
  estado: 'Activo' | 'En curso'
  productos: SupplierProductDraft[]
}

export type SupplierImportIssue = { line: number; ruc: string; reason: string }

export type SupplierImportParse = {
  rows: SupplierImportRow[]
  errors: string[]
  productIssues: string[]
}

export type SupplierImportReport = {
  created: number
  /** Proveedores que ya existían y a los que se les agregaron productos. */
  updated: number
  products: number
  omitted: SupplierImportIssue[]
  failed: SupplierImportIssue[]
  skippedProducts: Array<{ proveedor: string; producto: string; reason: string }>
}

/** Divide una línea CSV respetando comillas dobles (""). */
export function splitCsvLine(line: string): string[] {
  const cells: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        current += char
      }
    } else if (char === '"') {
      inQuotes = true
    } else if (char === ',') {
      cells.push(current)
      current = ''
    } else {
      current += char
    }
  }
  cells.push(current)
  return cells.map((cell) => cell.trim())
}

function parseProductsCell(cell: string, line: number, ruc: string): { items: SupplierProductDraft[]; issues: string[] } {
  const items: SupplierProductDraft[] = []
  const issues: string[] = []
  if (!cell.trim()) return { items, issues }
  for (const chunk of cell.split('//')) {
    const [rawName = '', rawCost = '', rawDetail = ''] = chunk.split('|').map((part) => part.trim())
    const nombre = rawName.trim()
    if (nombre.length < 2) {
      issues.push(`Línea ${line} (RUC ${ruc || '¿?'}): producto sin nombre válido, se omite.`)
      continue
    }
    const costo = rawCost === '' ? 0 : Number(rawCost.replace(',', '.'))
    if (!Number.isFinite(costo) || costo < 0) {
      issues.push(`Línea ${line} (RUC ${ruc || '¿?'}): "${nombre}" tiene costo inválido, se omite.`)
      continue
    }
    items.push({ nombre, costo: Math.round(costo * 100) / 100, detalle: rawDetail.trim() })
  }
  return { items, issues }
}

/** Valida el archivo completo sin tocar la base de datos. */
export function parseSuppliersCsv(text: string): SupplierImportParse {
  const errors: string[] = []
  const productIssues: string[] = []
  const rows: SupplierImportRow[] = []
  const content = text.replace(/^\uFEFF/, '')
  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0)
  if (!lines.length) return { rows, errors: ['El archivo está vacío. Descarga la plantilla para ver el formato.'], productIssues }
  const header = splitCsvLine(lines[0]).map((cell) => cell.toLowerCase())
  const indexOf = (name: string) => header.indexOf(name)
  if (indexOf('ruc') === -1 || indexOf('razon_social') === -1) {
    return { rows, errors: ['La cabecera debe incluir al menos las columnas ruc y razon_social. Descarga la plantilla.'], productIssues }
  }
  const seen = new Set<string>()
  lines.slice(1).forEach((line, position) => {
    const lineNumber = position + 2
    const cells = splitCsvLine(line)
    const cell = (name: string) => cells[indexOf(name)] ?? ''
    const ruc = cell('ruc').replace(/\D/g, '')
    const razonSocial = cell('razon_social').trim()
    const fail = (reason: string) => errors.push(`Línea ${lineNumber} (RUC ${ruc || '¿?'}): ${reason}`)
    if (!/^\d{11}$/.test(ruc)) {
      fail('RUC inválido: debe tener 11 dígitos.')
      return
    }
    if (!isValidRuc(ruc)) {
      fail('RUC con dígito verificador inválido.')
      return
    }
    if (seen.has(ruc)) {
      fail('RUC duplicado dentro del archivo.')
      return
    }
    if (razonSocial.length < 2) {
      fail('razón social muy corta (mínimo 2 caracteres).')
      return
    }
    const correo = cell('correo').trim()
    if (correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
      fail(`correo inválido ("${correo}").`)
      return
    }
    const telefono = cell('telefono').replace(/[^\d+\s-]/g, '').trim()
    if (telefono && telefono.replace(/\D/g, '').length < 6) {
      fail('teléfono inválido: debe tener al menos 6 dígitos.')
      return
    }
    const estadoRaw = cell('estado').trim().toLowerCase()
    const estado: SupplierImportRow['estado'] = estadoRaw === 'en curso' ? 'En curso' : 'Activo'
    seen.add(ruc)
    const { items, issues } = parseProductsCell(indexOf('productos') === -1 ? '' : cell('productos'), lineNumber, ruc)
    productIssues.push(...issues)
    rows.push({
      line: lineNumber,
      ruc,
      razonSocial,
      direccion: cell('direccion').trim(),
      correo,
      telefono,
      formaPago: cell('forma_pago').trim(),
      estado,
      productos: items,
    })
  })
  return { rows, errors, productIssues }
}
