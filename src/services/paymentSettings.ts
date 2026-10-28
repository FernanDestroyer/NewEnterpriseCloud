import { requireSupabase } from '../lib/supabase'
import {
  BANK_TRANSFER_CONFIG_CODE, PLIN_CONFIG_CODE, MAX_YAPE_QR_BYTES,
  parsePlinSettings, validatePlinSettings, parseBankTransferSettings, validateBankTransferSettings,
  type PlinSettings, type BankTransferSettings,
} from '../data/payments'

async function readSetting<T>(code: string, parse: (detail: string) => T): Promise<T | null> {
  const { data, error } = await requireSupabase().from('configuracion').select('detalle').eq('codigo', code).maybeSingle()
  if (error) throw error
  return data ? parse(String(data.detalle ?? '')) : null
}
async function writeSetting<T>(code: string, name: string, settings: T): Promise<void> {
  const client = requireSupabase()
  const payload = { codigo: code, nombre: name, detalle: JSON.stringify(settings), estado: 'Vigente' }
  const { data, error } = await client.from('configuracion').select('id').eq('codigo', code).maybeSingle()
  if (error) throw error
  const result = data ? await client.from('configuracion').update(payload).eq('id', data.id).select('id').single() : await client.from('configuracion').insert(payload).select('id').single()
  if (result.error) throw result.error
}
export const fetchPlinSettings = () => readSetting(PLIN_CONFIG_CODE, parsePlinSettings)
export const savePlinSettings = (settings: PlinSettings) => writeSetting(PLIN_CONFIG_CODE, 'QR de Plin', validatePlinSettings(settings))
export const fetchBankTransferSettings = () => readSetting(BANK_TRANSFER_CONFIG_CODE, parseBankTransferSettings)
export const saveBankTransferSettings = (settings: BankTransferSettings) => writeSetting(BANK_TRANSFER_CONFIG_CODE, 'Cuenta bancaria para transferencia', validateBankTransferSettings(settings))

export async function readPlinQrFile(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Selecciona una imagen PNG, JPG o WebP de tu QR de Plin.')
  if (!file.size || file.size > MAX_YAPE_QR_BYTES) throw new Error('La imagen del QR debe pesar hasta 1 MB.')
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('No se pudo leer la imagen del QR.'))
    reader.readAsDataURL(file)
  })
  await new Promise<void>((resolve, reject) => { const image = new Image(); image.onload = () => resolve(); image.onerror = () => reject(new Error('El archivo no contiene una imagen válida.')); image.src = dataUrl })
  return dataUrl
}
