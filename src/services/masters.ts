import { requireSupabase } from '../lib/supabase'

export type MasterPerson = {
  id: string; codigo: string; nombre: string; ruc?: string | null; telefono?: string | null
  email?: string | null; direccion?: string | null; sucursal_id?: string | null
  usuario_id?: string | null; estado: 'Activo' | 'Inactivo'
}
export type BusinessCatalog = {
  id: string; categoria: 'documento_venta' | 'documento_identidad' | 'regimen_tributario' | 'tipo_operacion' | 'condicion_pago' | 'motivo_traslado' | 'tasa_impuesto'
  codigo: string; nombre: string; tasa: number | null; descripcion: string | null; activo: boolean
}
export const catalogLabels: Record<BusinessCatalog['categoria'], string> = {
  documento_venta: 'Documento de venta', documento_identidad: 'Documento de identidad',
  regimen_tributario: 'Régimen tributario', tipo_operacion: 'Tipo de operación',
  condicion_pago: 'Condición de pago', motivo_traslado: 'Motivo de traslado', tasa_impuesto: 'Tasa de impuesto',
}
export async function fetchMasterPeople() {
  const client = requireSupabase()
  const [drivers, sellers] = await Promise.all([
    client.from('transportistas').select('*').order('nombre'),
    client.from('vendedores').select('*').order('nombre'),
  ])
  if (drivers.error) throw drivers.error
  if (sellers.error) throw sellers.error
  return { transportistas: (drivers.data ?? []) as MasterPerson[], vendedores: (sellers.data ?? []) as MasterPerson[] }
}
export async function fetchBusinessCatalogs(): Promise<BusinessCatalog[]> {
  const { data, error } = await requireSupabase().from('catalogos_negocio').select('*').order('categoria').order('nombre')
  if (error) throw error
  return (data ?? []) as BusinessCatalog[]
}
export async function saveMasterPerson(kind: 'transportista' | 'vendedor', input: Partial<MasterPerson>, id?: string) {
  const client = requireSupabase()
  const name = String(input.nombre ?? '').trim()
  const code = String(input.codigo ?? '').trim().toUpperCase()
  if (name.length < 2) throw new Error('El nombre debe contener al menos dos caracteres.')
  if (!/^[A-Z0-9_-]{2,20}$/.test(code)) throw new Error('El código debe tener entre 2 y 20 caracteres (letras, números, guion o guion bajo).')
  const common = { codigo: code, nombre: name, telefono: String(input.telefono ?? '').trim() || null, email: String(input.email ?? '').trim().toLowerCase() || null, estado: input.estado ?? 'Activo' }
  const ruc = String(input.ruc ?? '').replace(/\D/g, '')
  if (kind === 'transportista' && ruc && ruc.length !== 11) throw new Error('El RUC del transportista debe contener 11 dígitos.')
  const result = kind === 'transportista'
    ? id
      ? await client.from('transportistas').update({ ...common, ruc: ruc || null, direccion: String(input.direccion ?? '').trim() || null }).eq('id', id)
      : await client.from('transportistas').insert({ ...common, ruc: ruc || null, direccion: String(input.direccion ?? '').trim() || null })
    : id
      ? await client.from('vendedores').update({ ...common, sucursal_id: input.sucursal_id || null, usuario_id: input.usuario_id || null }).eq('id', id)
      : await client.from('vendedores').insert({ ...common, sucursal_id: input.sucursal_id || null, usuario_id: input.usuario_id || null })
  if (result.error?.code === '23505') throw new Error('El código o usuario ya está asignado a otro registro.')
  if (result.error) throw result.error
}
export async function toggleMasterPerson(kind: 'transportista' | 'vendedor', id: string, active: boolean) {
  const table = kind === 'transportista' ? 'transportistas' : 'vendedores'
  const { error } = await requireSupabase().from(table).update({ estado: active ? 'Activo' : 'Inactivo' }).eq('id', id)
  if (error) throw error
}
export async function fetchMasterChoices() {
  const client = requireSupabase()
  const [branches, users] = await Promise.all([
    client.from('sucursales').select('id,codigo,nombre').eq('estado', 'Activo').order('nombre'),
    client.from('usuarios').select('id,nombre,email').eq('activo', true).order('nombre'),
  ])
  if (branches.error) throw branches.error
  if (users.error) throw users.error
  return { branches: branches.data ?? [], users: users.data ?? [] }
}
export async function saveBusinessCatalog(input: Pick<BusinessCatalog, 'categoria' | 'codigo' | 'nombre' | 'tasa' | 'descripcion'>, id?: string) {
  const payload = {
    categoria: input.categoria, codigo: input.codigo.trim().toUpperCase(), nombre: input.nombre.trim(),
    tasa: input.categoria === 'tasa_impuesto' ? input.tasa : null,
    descripcion: input.descripcion?.trim() || null,
  }
  if (payload.codigo.length < 2 || payload.nombre.length < 2) throw new Error('Completa un código y nombre de al menos dos caracteres.')
  if (input.categoria === 'tasa_impuesto' && (payload.tasa === null || payload.tasa < 0 || payload.tasa > 100)) throw new Error('La tasa debe estar entre 0 y 100 %.')
  const client = requireSupabase()
  const result = id ? await client.from('catalogos_negocio').update(payload).eq('id', id) : await client.from('catalogos_negocio').insert(payload)
  if (result.error?.code === '23505') throw new Error('Ya existe un código con esa categoría.')
  if (result.error) throw result.error
}
export async function toggleBusinessCatalog(id: string, activo: boolean) {
  const { error } = await requireSupabase().from('catalogos_negocio').update({ activo }).eq('id', id)
  if (error) throw error
}
