import type { RecordItem } from '../types'

export const YAPE_CONFIG_CODE = 'YAPE_QR'
export const MAX_YAPE_QR_BYTES = 1024 * 1024

export type YapeSettings = {
  titular: string
  celular: string
  qrImage: string
  enabled: boolean
}

export const EMPTY_YAPE_SETTINGS: YapeSettings = { titular: '', celular: '', qrImage: '', enabled: false }

export function isYapeMethod(method?: string | null): boolean {
  return method?.trim().toLocaleLowerCase('es') === 'yape'
}

/** Usa la misma regla de la venta: descuento sobre líneas; monto manual sin líneas. */
export function salePayableTotal(subtotal: number, discount: number, manualAmount: number, hasLines: boolean): number {
  if (!hasLines) return Number.isFinite(manualAmount) ? manualAmount : 0
  const roundedSubtotal = Math.round(subtotal * 100) / 100
  const percent = Math.min(100, Math.max(0, Number(discount) || 0))
  return Math.round(roundedSubtotal * (1 - percent / 100) * 100) / 100
}

export function isValidYapeQrImage(value: string): boolean {
  const match = /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value)
  if (!match || match[1].length % 4 !== 0) return false
  const encoded = match[1]
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0
  return encoded.length * 3 / 4 - padding <= MAX_YAPE_QR_BYTES
}

export function validateYapeSettings(input: YapeSettings): YapeSettings {
  const settings = {
    titular: input.titular.trim(),
    celular: input.celular.replace(/\D/g, ''),
    qrImage: input.qrImage,
    enabled: input.enabled,
  }
  if (settings.enabled && settings.titular.length < 2) throw new Error('Escribe el nombre del titular que aparece en tu Yape.')
  if (settings.celular && !/^9\d{8}$/.test(settings.celular)) throw new Error('El celular de Yape debe tener 9 dígitos y empezar por 9.')
  if (settings.qrImage && !isValidYapeQrImage(settings.qrImage)) throw new Error('Usa una imagen PNG, JPG o WebP de hasta 1 MB para el QR.')
  if (settings.enabled && !settings.qrImage) throw new Error('Carga la imagen de tu QR de Yape para habilitarlo.')
  return settings
}

export function parseYapeSettings(detail: string): YapeSettings {
  let raw: Record<string, unknown>
  try {
    const data: unknown = JSON.parse(detail)
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error()
    raw = data as Record<string, unknown>
  } catch {
    throw new Error('La configuración de Yape no es válida. Vuelve a guardarla en Mantenimiento → QR de Yape.')
  }
  return validateYapeSettings({
    titular: typeof raw.titular === 'string' ? raw.titular : '',
    celular: typeof raw.celular === 'string' ? raw.celular : '',
    qrImage: typeof raw.qrImage === 'string' ? raw.qrImage : '',
    enabled: raw.enabled === true,
  })
}

export function readYapeSettings(records: RecordItem[]): YapeSettings | null {
  const row = records.find(item => item.id === YAPE_CONFIG_CODE)
  return row ? parseYapeSettings(row.detail) : null
}
