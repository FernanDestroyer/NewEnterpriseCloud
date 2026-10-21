import { requireSupabase } from '../lib/supabase'
import { MAX_YAPE_QR_BYTES, parseYapeSettings, validateYapeSettings, YAPE_CONFIG_CODE, type YapeSettings } from '../data/payments'

export async function fetchYapeSettings(): Promise<YapeSettings | null> {
  const { data, error } = await requireSupabase().from('configuracion')
    .select('detalle').eq('codigo', YAPE_CONFIG_CODE).maybeSingle()
  if (error) throw error
  return data ? parseYapeSettings(String(data.detalle ?? '')) : null
}

export async function saveYapeSettings(input: YapeSettings): Promise<void> {
  const settings = validateYapeSettings(input)
  const client = requireSupabase()
  const payload = {
    codigo: YAPE_CONFIG_CODE,
    nombre: 'QR de Yape',
    detalle: JSON.stringify(settings),
    estado: 'Vigente',
  }
  const { data, error } = await client.from('configuracion').select('id').eq('codigo', YAPE_CONFIG_CODE).maybeSingle()
  if (error) throw error
  const result = data
    ? await client.from('configuracion').update(payload).eq('id', data.id).select('id').single()
    : await client.from('configuracion').insert(payload).select('id').single()
  if (result.error) throw result.error
}

/** Conserva la imagen original, sin compresión ni reconstrucción del código QR. */
export async function readYapeQrFile(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Selecciona una imagen PNG, JPG o WebP de tu QR de Yape.')
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
