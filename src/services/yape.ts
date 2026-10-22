import { requireSupabase } from '../lib/supabase'
import { MAX_YAPE_QR_BYTES, parseYapeSettings, validateYapeSettings, WALLETS, type WalletId, type YapeSettings } from '../data/payments'

export async function fetchWalletSettings(wallet: WalletId): Promise<YapeSettings | null> {
  const { code, label } = WALLETS[wallet]
  const { data, error } = await requireSupabase().from('configuracion')
    .select('detalle').eq('codigo', code).maybeSingle()
  if (error) throw error
  return data ? parseYapeSettings(String(data.detalle ?? ''), label) : null
}

export async function saveWalletSettings(wallet: WalletId, input: YapeSettings): Promise<void> {
  const { code, label } = WALLETS[wallet]
  const settings = validateYapeSettings(input, label)
  const client = requireSupabase()
  const payload = {
    codigo: code,
    nombre: `QR de ${label}`,
    detalle: JSON.stringify(settings),
    estado: 'Vigente',
  }
  const { data, error } = await client.from('configuracion').select('id').eq('codigo', code).maybeSingle()
  if (error) throw error
  const result = data
    ? await client.from('configuracion').update(payload).eq('id', data.id).select('id').single()
    : await client.from('configuracion').insert(payload).select('id').single()
  if (result.error) throw result.error
}

export const fetchYapeSettings = () => fetchWalletSettings('yape')
export const saveYapeSettings = (input: YapeSettings) => saveWalletSettings('yape', input)
export const fetchPlinSettings = () => fetchWalletSettings('plin')
export const savePlinSettings = (input: YapeSettings) => saveWalletSettings('plin', input)

/** Conserva la imagen original, sin compresión ni reconstrucción del código QR. */
export async function readYapeQrFile(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Selecciona una imagen PNG, JPG o WebP de tu QR.')
  if (!file.size || file.size > MAX_YAPE_QR_BYTES) throw new Error('La imagen del QR debe pesar hasta 1 MB.')
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('No se pudo leer la imagen del QR.'))
    reader.readAsDataURL(file)
  })
  await new Promise<void>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve()
    image.onerror = () => reject(new Error('El archivo no contiene una imagen válida.'))
    image.src = dataUrl
  })
  return dataUrl
}
