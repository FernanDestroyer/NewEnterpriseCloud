import { requireSupabase } from '../lib/supabase'
import { isValidRuc } from './peru'

/** Datos fiscales y de contacto de la empresa principal del ERP. */
export type CompanyProfile = {
  razonSocial: string
  ruc: string
  direccion: string
  telefono: string
  email: string
}

type CompanyRow = {
  razon_social: string
  ruc: string | null
  direccion_fiscal: string | null
  telefono: string | null
  email: string | null
}

export const EMPTY_COMPANY: CompanyProfile = { razonSocial: '', ruc: '', direccion: '', telefono: '', email: '' }
const PRIMARY_COMPANY_CODE = 'PRINCIPAL'

function fromRow(row: CompanyRow | null): CompanyProfile | null {
  if (!row) return null
  return {
    razonSocial: row.razon_social,
    ruc: row.ruc ?? '',
    direccion: row.direccion_fiscal ?? '',
    telefono: row.telefono ?? '',
    email: row.email ?? '',
  }
}

/** Lee la ficha principal; su RLS permite consulta a cualquier usuario activo. */
export async function fetchCompanyProfile(): Promise<CompanyProfile | null> {
  const { data, error } = await requireSupabase()
    .from('empresas')
    .select('razon_social,ruc,direccion_fiscal,telefono,email')
    .eq('es_principal', true)
    .maybeSingle()
  if (error) throw error
  return fromRow(data as CompanyRow | null)
}

export async function saveCompanyProfile(input: CompanyProfile, exists: boolean): Promise<void> {
  const razonSocial = input.razonSocial.trim()
  if (razonSocial.length < 2) throw new Error('La razón social necesita al menos 2 caracteres.')
  const ruc = input.ruc.replace(/\D/g, '')
  if (ruc && !isValidRuc(ruc)) throw new Error('El RUC no pasa la validación del dígito verificador.')
  const email = input.email.trim()
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('El correo de la empresa no es válido.')

  const payload = {
    codigo: PRIMARY_COMPANY_CODE,
    razon_social: razonSocial,
    ruc: ruc || null,
    direccion_fiscal: input.direccion.trim() || null,
    telefono: input.telefono.trim() || null,
    email: email || null,
    es_principal: true,
    estado: 'Activo',
  }
  const client = requireSupabase()
  const result = exists
    ? await client.from('empresas').update(payload).eq('codigo', PRIMARY_COMPANY_CODE)
    : await client.from('empresas').insert(payload)
  if (result.error) throw result.error
}
