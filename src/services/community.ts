import { requireSupabase } from '../lib/supabase'

export type CommunityGroup = { id: string; nombre: string; descripcion: string; rol: string | null; puede_conversar: boolean | null }
export type CommunityRole = { id: string; nombre: string }
export type CommunityCandidate = { id: string; nombre: string; correo: string | null; rol: string }
export type CommunityMessage = { id: string; autor_id: string | null; autor_nombre: string; cuerpo: string; created_at: string }
export const COMMUNITY_PAGE_SIZE = 50
export const COMMUNITY_CANDIDATE_PAGE_SIZE = 25
export const COMMUNITY_MAX_MEMBERS = 100

export async function listCommunityGroups(): Promise<CommunityGroup[]> {
  const { data, error } = await requireSupabase().rpc('comunidad_listar_grupos')
  if (error) throw error
  return data ?? []
}

export async function listCommunityRoles(): Promise<CommunityRole[]> {
  const { data, error } = await requireSupabase().rpc('comunidad_listar_roles')
  if (error) throw error
  return data ?? []
}

export async function listCommunityMessages(groupId: string, before?: CommunityMessage): Promise<CommunityMessage[]> {
  let query = requireSupabase().from('comunidad_mensajes')
    .select('id,autor_id,autor_nombre,cuerpo,created_at')
    .eq('grupo_id', groupId).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(COMMUNITY_PAGE_SIZE)
  if (before) {
    const { created_at, id } = before
    query = query.or(`created_at.lt.${created_at},and(created_at.eq.${created_at},id.lt.${id})`)
  }
  const { data, error } = await query
  if (error) throw error
  return data ?? []
}

export async function sendCommunityMessage(groupId: string, messageId: string, body: string) {
  const { error } = await requireSupabase().rpc('comunidad_enviar_mensaje', { p_grupo_id: groupId, p_id: messageId, p_cuerpo: body })
  if (error) throw error
}

export async function createCommunityGroup(roleId: string, name: string, description: string): Promise<string> {
  const { data, error } = await requireSupabase().rpc('comunidad_crear_grupo', { p_rol_id: roleId, p_nombre: name, p_descripcion: description })
  if (error) throw error
  return data
}

export async function listCommunityCandidates(search: string, page: number): Promise<CommunityCandidate[]> {
  const { data, error } = await requireSupabase().rpc('comunidad_buscar_usuarios', { p_busqueda: search, p_offset: page * COMMUNITY_CANDIDATE_PAGE_SIZE })
  if (error) throw error
  return data ?? []
}

export async function createCommunityMemberGroup(name: string, description: string, userIds: string[]): Promise<string> {
  const { data, error } = await requireSupabase().rpc('comunidad_crear_grupo_miembros', { p_nombre: name, p_descripcion: description, p_usuario_ids: userIds })
  if (error) throw error
  return data
}

export async function removeCommunityGroup(id: string) {
  const { error } = await requireSupabase().rpc('comunidad_eliminar_grupo', { p_grupo_id: id })
  if (error) throw error
}

export function communityError(error: unknown, fallback: string) {
  const issue = error as { code?: string; message?: string } | null
  if (['PGRST202', 'PGRST205', '42P01', '42883'].includes(issue?.code ?? '')) return 'Comunidad aún no está habilitada en este entorno de Supabase.'
  if (issue?.code === '42501') return 'Tu rol no tiene permiso para realizar esta acción.'
  if (issue?.code === '22023') return issue.message || fallback
  return fallback
}
