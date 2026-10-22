import type { RecordItem } from '../types'

export const YAPE_CONFIG_CODE = 'YAPE_QR'
export const PLIN_CONFIG_CODE = 'PLIN_QR'
export const MAX_YAPE_QR_BYTES = 1024 * 1024

/** Billeteras con QR de cobro. Plin usa la misma estructura de datos que Yape. */
export type WalletId = 'yape' | 'plin'
export const WALLETS: Record<WalletId, { label: string; code: string }> = {
  yape: { label: 'Yape', code: YAPE_CONFIG_CODE },
  plin: { label: 'Plin', code: PLIN_CONFIG_CODE },
}

export type YapeSettings = {
  titular: string
  celular: string
  qrImage: string
  enabled: boolean
}

export type WalletSettings = YapeSettings

export const EMPTY_YAPE_SETTINGS: YapeSettings = { titular: '', celular: '', qrImage: '', enabled: false }
export const EMPTY_WALLET_SETTINGS: WalletSettings = EMPTY_YAPE_SETTINGS

export function isYapeMethod(method?: string | null): boolean {
  return method?.trim().toLocaleLowerCase('es') === 'yape'
}

export function isPlinMethod(method?: string | null): boolean {
  return method?.trim().toLocaleLowerCase('es') === 'plin'
}

/** Devuelve la billetera con QR que corresponde al medio de pago, o null si no tiene. */
export function walletForMethod(method?: string | null): WalletId | null {
  if (isYapeMethod(method)) return 'yape'
  if (isPlinMethod(method)) return 'plin'
  return null
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

export function validateYapeSettings(input: YapeSettings, label = 'Yape'): YapeSettings {
  const settings = {
    titular: input.titular.trim(),
    celular: input.celular.replace(/\D/g, ''),
    qrImage: input.qrImage,
    enabled: input.enabled,
  }
  if (settings.enabled && settings.titular.length < 2) throw new Error(`Escribe el nombre del titular que aparece en tu ${label}.`)
  if (settings.celular && !/^9\d{8}$/.test(settings.celular)) throw new Error(`El celular de ${label} debe tener 9 dígitos y empezar por 9.`)
  if (settings.qrImage && !isValidYapeQrImage(settings.qrImage)) throw new Error('Usa una imagen PNG, JPG o WebP de hasta 1 MB para el QR.')
  if (settings.enabled && !settings.qrImage) throw new Error(`Carga la imagen de tu QR de ${label} para habilitarlo.`)
  return settings
}

export function parseYapeSettings(detail: string, label = 'Yape'): YapeSettings {
  let raw: Record<string, unknown>
  try {
    const data: unknown = JSON.parse(detail)
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error()
    raw = data as Record<string, unknown>
  } catch {
    throw new Error(`La configuración de ${label} no es válida. Vuelve a guardarla en Mantenimiento → QR de ${label}.`)
  }
  return validateYapeSettings({
    titular: typeof raw.titular === 'string' ? raw.titular : '',
    celular: typeof raw.celular === 'string' ? raw.celular : '',
    qrImage: typeof raw.qrImage === 'string' ? raw.qrImage : '',
    enabled: raw.enabled === true,
  }, label)
}

export function readWalletSettings(records: RecordItem[], wallet: WalletId): WalletSettings | null {
  const { code, label } = WALLETS[wallet]
  const row = records.find(item => item.id === code)
  return row ? parseYapeSettings(row.detail, label) : null
}

export function readYapeSettings(records: RecordItem[]): YapeSettings | null {
  return readWalletSettings(records, 'yape')
}

export function readPlinSettings(records: RecordItem[]): WalletSettings | null {
  return readWalletSettings(records, 'plin')
}

/** Tarjetas de crédito/débito registradas en la cuenta del cliente. Solo se guarda lo no sensible: nunca el número completo ni el CVV. */
export const CARD_BRANDS = ['Visa', 'Mastercard', 'American Express', 'Diners Club', 'Otra'] as const

export type CustomerCard = { id: string; clienteId: string; marca: string; ultimos4: string; titular: string; venceMes: number; venceAnio: number }
export type CardInput = { marca: string; ultimos4: string; titular: string; venceMes: number; venceAnio: number }

/** Una tarjeta vence al final del mes indicado. */
export function isCardExpired(venceMes: number, venceAnio: number, now = new Date()): boolean {
  const year = venceAnio < 100 ? 2000 + venceAnio : venceAnio
  return year < now.getFullYear() || (year === now.getFullYear() && venceMes < now.getMonth() + 1)
}

export function validateCardInput(input: CardInput, now = new Date()): CardInput {
  const card = {
    marca: input.marca.trim(),
    ultimos4: input.ultimos4.trim(),
    titular: input.titular.trim().replace(/\s+/g, ' '),
    venceMes: Math.trunc(Number(input.venceMes)),
    venceAnio: Math.trunc(Number(input.venceAnio)),
  }
  if (!(CARD_BRANDS as readonly string[]).includes(card.marca)) throw new Error('Elige la marca de la tarjeta.')
  if (!/^\d{4}$/.test(card.ultimos4)) throw new Error('Escribe los últimos 4 dígitos de la tarjeta.')
  if (card.titular.length < 3) throw new Error('Escribe el nombre del titular como aparece en la tarjeta.')
  if (!(card.venceMes >= 1 && card.venceMes <= 12)) throw new Error('El mes de vencimiento debe estar entre 01 y 12.')
  if (card.venceAnio < 0 || card.venceAnio > 2999) throw new Error('El año de vencimiento no es válido.')
  if (isCardExpired(card.venceMes, card.venceAnio, now)) throw new Error('La tarjeta está vencida.')
  return { ...card, venceAnio: card.venceAnio < 100 ? 2000 + card.venceAnio : card.venceAnio }
}

export function cardLabel(card: { marca: string; ultimos4: string }): string {
  return `${card.marca} •••• ${card.ultimos4}`
}
