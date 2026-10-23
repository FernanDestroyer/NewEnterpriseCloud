import { requireSupabase } from '../lib/supabase'

/** Cuenta administradora permanente: no se puede degradar ni desactivar. */
export const PROTECTED_ADMIN_EMAIL = '1604251@senati.pe'

export type AppUser = {
  id: string
  nombre: string
  email: string
  activo: boolean
  rolId: string | null
  rol: string
  creado: string
}

export type AppRole = { id: string; nombre: string }
export type PermissionCatalogEntry = { id: string; modulo: string; accion: PermissionAction }
export type PermissionAction = 'ver' | 'crear' | 'editar' | 'eliminar' | 'importar'
export type UserPermissionOverride = { permiso_id: string; permitido: boolean }
export type RolePermissionLink = { rol_id: string; permiso_id: string }

type UserRow = {
  id: string
  nombre: string
  email: string | null
  activo: boolean
  rol_id: string | null
  created_at: string
  roles: { nombre: string } | Array<{ nombre: string }> | null
}

function roleName(value: UserRow['roles']): string {
  if (!value) return 'Sin rol'
  if (Array.isArray(value)) return value[0]?.nombre ?? 'Sin rol'
  return value.nombre ?? 'Sin rol'
}

/** Todas las cuentas registradas (requiere permiso de ver usuarios). */
export async function fetchUsers(): Promise<AppUser[]> {
  const { data, error } = await requireSupabase()
    .from('usuarios')
    .select('id, nombre, email, activo, rol_id, created_at, roles(nombre)')
    .order('created_at', { ascending: true })
  if (error) throw error
  return ((data ?? []) as UserRow[]).map((row) => ({
    id: String(row.id),
    nombre: row.nombre ?? 'Usuario',
    email: row.email ?? '',
    activo: Boolean(row.activo),
    rolId: row.rol_id ? String(row.rol_id) : null,
    rol: roleName(row.roles),
    creado: typeof row.created_at === 'string' ? row.created_at : '',
  }))
}

export async function fetchRoles(): Promise<AppRole[]> {
  const { data, error } = await requireSupabase().from('roles').select('id, nombre').order('nombre')
  if (error) throw error
  return ((data ?? []) as Array<{ id: string; nombre: string }>)
    .filter((row) => row.nombre.trim())
    .map((row) => ({ id: String(row.id), nombre: row.nombre }))
}

export async function fetchPermissionCatalog(): Promise<PermissionCatalogEntry[]> {
  const { data, error } = await requireSupabase().from('permisos').select('id, modulo, accion').order('modulo').order('accion')
  if (error) throw error
  return ((data ?? []) as Array<{ id: string; modulo: string; accion: PermissionAction }>).map(row => ({ ...row, id: String(row.id) }))
}

export async function fetchRolePermissionLinks(): Promise<RolePermissionLink[]> {
  const { data, error } = await requireSupabase().from('rol_permisos').select('rol_id, permiso_id')
  if (error) throw error
  return ((data ?? []) as RolePermissionLink[]).map(row => ({ rol_id: String(row.rol_id), permiso_id: String(row.permiso_id) }))
}

export async function fetchUserPermissionOverrides(userId: string): Promise<UserPermissionOverride[]> {
  const { data, error } = await requireSupabase().from('usuario_permisos').select('permiso_id, permitido').eq('usuario_id', userId)
  if (error) throw error
  return ((data ?? []) as UserPermissionOverride[]).map(row => ({ permiso_id: String(row.permiso_id), permitido: Boolean(row.permitido) }))
}

/** Reemplaza las excepciones del usuario de forma atómica en la base de datos. */
export async function saveUserPermissionOverrides(userId: string, overrides: UserPermissionOverride[]): Promise<void> {
  const { error } = await requireSupabase().rpc('guardar_permisos_usuario', {
    p_usuario_id: userId,
    p_overrides: overrides.map(({ permiso_id, permitido }) => ({ permiso_id, permitido })),
  })
  if (error) throw error
}

/** Otorga un rol a una cuenta (solo administradores; la BD lo exige). */
export async function updateUserRole(id: string, rolId: string): Promise<void> {
  if (!rolId) throw new Error('Elige un rol válido.')
  const { data, error } = await requireSupabase().from('usuarios').update({ rol_id: rolId }).eq('id', id).select('id')
  if (error) throw error
  if (!(data as Array<{ id: string }> | null)?.length) throw { code: '42501', message: 'Tu rol no tiene permiso para cambiar roles.' }
}

/** Activa o desactiva una cuenta (solo administradores; la BD lo exige). */
export async function setUserActive(id: string, activo: boolean): Promise<void> {
  const { data, error } = await requireSupabase().from('usuarios').update({ activo }).eq('id', id).select('id')
  if (error) throw error
  if (!(data as Array<{ id: string }> | null)?.length) throw { code: '42501', message: 'Tu rol no tiene permiso para cambiar el estado.' }
}
