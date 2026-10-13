import { requireSupabase } from '../lib/supabase'
import { isValidRuc } from './peru'
import type { RecordItem } from '../types'

/** Datos de la empresa: viven en una fila de configuracion con codigo EMPRESA. */
export type CompanyProfile = {
  razonSocial: string
  ruc: string
  direccion: string
  telefono: string
  email: string
}

export const EMPTY_COMPANY: CompanyProfile = { razonSocial: '', ruc: '', direccion: '', telefono: '', email: '' }

/** Lee el perfil desde los registros de configuración ya cargados (sin consultas extra). */
export function readCompanyProfile(settings: RecordItem[]): CompanyProfile | null {
  const row = settings.find(item => item.id === 'EMPRESA')
  if (!row) return null
  let data: Record<string, unknown> = {}
  try {
    data = JSON.parse(row.detail || '{}') as Record<string, unknown>
  } catch {
    data = {}
  }
  const text = (value: unknown) => (typeof value === 'string' ? value : '')
  return {
    razonSocial: row.name,
    ruc: text(data.ruc),
    direccion: text(data.direccion),
    telefono: text(data.telefono),
    email: text(data.email),
  }
}

export async function saveCompanyProfile(input: CompanyProfile): Promise<void> {
  const razonSocial = input.razonSocial.trim()
  if (razonSocial.length < 2) throw new Error('La razón social necesita al menos 2 caracteres.')
  const ruc = input.ruc.replace(/\D/g, '')
  if (ruc && !isValidRuc(ruc)) throw new Error('El RUC no pasa la validación del dígito verificador.')
  const email = input.email.trim()
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('El correo de la empresa no es válido.')
  const payload = {
    codigo: 'EMPRESA',
    nombre: razonSocial,
    detalle: JSON.stringify({ ruc, direccion: input.direccion.trim(), telefono: input.telefono.trim(), email }),
    estado: 'Vigente',
  }
  const client = requireSupabase()
  const { data: existing, error: lookupError } = await client.from('configuracion').select('id').eq('codigo', 'EMPRESA').limit(1)
  if (lookupError) throw lookupError
  if ((existing as Array<{ id: string }> | null)?.length) {
    const { error } = await client.from('configuracion').update(payload).eq('codigo', 'EMPRESA')
    if (error) throw error
    return
  }
  const { error } = await client.from('configuracion').insert(payload)
  if (error) throw error
}
