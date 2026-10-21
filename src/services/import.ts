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

import { isValidDni, isValidRuc } from './peru.ts'

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

// -----------------------------------------------------------------------------
// Importación masiva de clientes (CSV).
// Formato esperado (coma como separador, comillas estándar para celdas con coma):
//   tipo_doc,documento,razon_social,detalle,linea_credito,estado
// - tipo_doc: DNI o RUC. Si se deja vacío se deduce por la longitud del documento
//   (8 dígitos = DNI, 11 dígitos = RUC).
// - documento: 8 dígitos (DNI) u 11 dígitos con dígito verificador válido (RUC).
// - detalle: contacto, correo o segmento (texto libre, opcional).
// - linea_credito: monto en soles (opcional, 0 si se omite).
// - estado: Activo o En curso (cualquier otro valor cae a Activo).
// Ejemplo:
//   DNI,45678912,María Torres Quispe,"Contacto: 987654321, maria@correo.pe",500.00,Activo
// -----------------------------------------------------------------------------

export const CUSTOMER_CSV_HEADER = ['tipo_doc', 'documento', 'razon_social', 'detalle', 'linea_credito', 'estado']

export const CUSTOMER_CSV_EXAMPLE = ['DNI', '45678912', 'María Torres Quispe', 'Contacto: 987654321 · maria@correo.pe', '500.00', 'Activo']

export type CustomerImportRow = {
  line: number
  tipoDoc: 'DNI' | 'RUC'
  documento: string
  razonSocial: string
  detalle: string
  lineaCredito: number
  estado: 'Activo' | 'En curso'
}

export type CustomerImportIssue = { line: number; documento: string; reason: string }

export type CustomerImportParse = {
  rows: CustomerImportRow[]
  errors: string[]
}

export type CustomerImportReport = {
  created: number
  /** Clientes que ya existían (mismo documento) o repetidos dentro del archivo. */
  omitted: CustomerImportIssue[]
  /** Filas que la base de datos rechazó. */
  failed: CustomerImportIssue[]
}

/** Valida el archivo completo de clientes sin tocar la base de datos. */
export function parseCustomersCsv(text: string): CustomerImportParse {
  const errors: string[] = []
  const rows: CustomerImportRow[] = []
  const content = text.replace(/^﻿/, '')
  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0)
  if (!lines.length) return { rows, errors: ['El archivo está vacío. Descarga la plantilla para ver el formato.'] }
  const header = splitCsvLine(lines[0]).map((cell) => cell.toLowerCase())
  const indexOf = (name: string) => header.indexOf(name)
  if (indexOf('documento') === -1 || indexOf('razon_social') === -1) {
    return { rows, errors: ['La cabecera debe incluir al menos las columnas documento y razon_social. Descarga la plantilla.'] }
  }
  const seen = new Set<string>()
  lines.slice(1).forEach((line, position) => {
    const lineNumber = position + 2
    const cells = splitCsvLine(line)
    const cell = (name: string) => cells[indexOf(name)] ?? ''
    const documento = cell('documento').replace(/\D/g, '')
    const razonSocial = cell('razon_social').trim()
    const fail = (reason: string) => errors.push(`Línea ${lineNumber} (documento ${documento || '¿?'}): ${reason}`)
    const tipoRaw = cell('tipo_doc').trim().toUpperCase()
    if (tipoRaw && tipoRaw !== 'DNI' && tipoRaw !== 'RUC') {
      fail(`tipo_doc inválido ("${cell('tipo_doc').trim()}"): usa DNI o RUC.`)
      return
    }
    const tipoDoc: CustomerImportRow['tipoDoc'] | null = tipoRaw === 'DNI' || tipoRaw === 'RUC'
      ? tipoRaw
      : documento.length === 8 ? 'DNI' : documento.length === 11 ? 'RUC' : null
    if (!tipoDoc) {
      fail('documento inválido: debe tener 8 dígitos (DNI) u 11 dígitos (RUC).')
      return
    }
    if (tipoDoc === 'DNI' && !isValidDni(documento)) {
      fail('DNI inválido: debe tener 8 dígitos.')
      return
    }
    if (tipoDoc === 'RUC') {
      if (!/^\d{11}$/.test(documento)) {
        fail('RUC inválido: debe tener 11 dígitos.')
        return
      }
      if (!isValidRuc(documento)) {
        fail('RUC con dígito verificador inválido.')
        return
      }
    }
    if (seen.has(documento)) {
      fail('documento duplicado dentro del archivo.')
      return
    }
    if (razonSocial.length < 2) {
      fail('razón social muy corta (mínimo 2 caracteres).')
      return
    }
    const creditRaw = cell('linea_credito').trim()
    const lineaCredito = creditRaw === '' ? 0 : Number(creditRaw.replace(',', '.'))
    if (!Number.isFinite(lineaCredito) || lineaCredito < 0) {
      fail(`línea de crédito inválida ("${creditRaw}"): debe ser un monto igual o mayor a 0.`)
      return
    }
    const estadoRaw = cell('estado').trim().toLowerCase()
    const estado: CustomerImportRow['estado'] = estadoRaw === 'en curso' ? 'En curso' : 'Activo'
    seen.add(documento)
    rows.push({
      line: lineNumber,
      tipoDoc,
      documento,
      razonSocial,
      detalle: cell('detalle').trim(),
      lineaCredito: Math.round(lineaCredito * 100) / 100,
      estado,
    })
  })
  return { rows, errors }
}
