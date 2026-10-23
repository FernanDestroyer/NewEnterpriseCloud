import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { permissionModule, type PermissionModuleKey } from '../data/workspace'

export type Profile = {
  id: string
  nombre: string
  email: string
  rol: string
  activo: boolean
  avatarUrl: string | null
}

type SignUpResult = { error: string | null; needsConfirmation: boolean }
export type PermissionAction = 'ver' | 'crear' | 'editar' | 'eliminar' | 'importar'

type AuthContextValue = {
  session: Session | null
  profile: Profile | null
  loading: boolean
  configured: boolean
  error: string
  permissions: string[]
  can: (page: PermissionModuleKey, action?: PermissionAction) => boolean
  refreshProfile: () => Promise<void>
  updateProfile: (nombre: string, avatarUrl?: string | null) => Promise<void>
  signIn: (email: string, password: string) => Promise<string | null>
  signUp: (nombre: string, email: string, password: string) => Promise<SignUpResult>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

function translateAuthError(message: string) {
  const text = message.toLowerCase()
  if (text.includes('invalid login credentials')) return 'Credenciales incorrectas. Revisa el correo y la contraseña e inténtalo de nuevo.'
  if (text.includes('email not confirmed')) return 'Aún no confirmaste tu correo. Revisa tu bandeja de entrada y abre el enlace de confirmación.'
  if (text.includes('already registered') || text.includes('already been registered')) return 'Este correo ya está registrado. Inicia sesión o usa otro correo.'
  if (text.includes('password should be at least')) return 'La contraseña es demasiado corta.'
  if (text.includes('rate limit') || text.includes('too many')) return 'Demasiados intentos. Espera unos minutos e inténtalo otra vez.'
  if (text.includes('signups not allowed') || text.includes('signup is disabled')) return 'El registro de nuevos usuarios está deshabilitado en este proyecto.'
  if (text.includes('fetch') || text.includes('network')) return 'No se pudo conectar con el servidor. Revisa tu conexión.'
  return message
}

type ProfileRow = {
  id: string
  nombre: string
  email: string | null
  activo: boolean
  rol_id: string | null
  avatar_url?: string | null
  roles: { nombre: string } | { nombre: string }[] | null
}

function isMissingAvatarColumn(error: unknown): boolean {
  const err = error as { code?: string; message?: string; details?: string; hint?: string } | null
  if (err?.code !== '42703' && err?.code !== 'PGRST204') return false
  const haystack = `${err?.message ?? ''} ${err?.details ?? ''} ${err?.hint ?? ''}`.toLowerCase()
  return haystack.includes('avatar_url')
}

async function loadProfile(session: Session): Promise<{ profile: Profile; permissions: string[] }> {
  if (!supabase) throw new Error('Supabase no está configurado.')
  const first = await supabase
    .from('usuarios')
    .select('id, nombre, email, activo, rol_id, avatar_url, roles(nombre)')
    .eq('id', session.user.id)
    .maybeSingle()
  // Si la migración de foto aún no se ejecutó, se reintenta sin esa columna
  // para no bloquear el inicio de sesión.
  const { data, error } = isMissingAvatarColumn(first.error)
    ? await supabase
      .from('usuarios')
      .select('id, nombre, email, activo, rol_id, roles(nombre)')
      .eq('id', session.user.id)
      .maybeSingle()
    : first
  if (error) throw new Error(`No se pudo cargar tu perfil: ${error.message}`)
  if (!data) throw new Error('No existe tu perfil en la tabla usuarios. Revisa el registro de usuarios en Supabase.')
  const row = data as unknown as ProfileRow
  if (!row.activo) throw new Error('Tu usuario está desactivado. Contacta a un administrador.')
  const role = Array.isArray(row.roles) ? row.roles[0] : row.roles
  const permissions: string[] = []
  if (row.rol_id) {
    const result = await supabase.from('rol_permisos').select('permisos(modulo, accion)').eq('rol_id', row.rol_id)
    if (result.error) throw new Error(`No se pudieron cargar tus permisos: ${result.error.message}`)
    for (const entry of result.data as unknown as Array<{ permisos: { modulo: string; accion: string } | { modulo: string; accion: string }[] | null }>) {
      const values = Array.isArray(entry.permisos) ? entry.permisos : entry.permisos ? [entry.permisos] : []
      for (const permission of values) permissions.push(`${permission.modulo}:${permission.accion}`)
    }
  }
  // Overrides are optional until the permissions-customization migration is installed.
  const overrides = await supabase.from('usuario_permisos').select('permitido, permisos(modulo, accion)').eq('usuario_id', session.user.id)
  if (!overrides.error) {
    for (const entry of overrides.data as unknown as Array<{ permitido: boolean; permisos: { modulo: string; accion: string } | { modulo: string; accion: string }[] | null }>) {
      const values = Array.isArray(entry.permisos) ? entry.permisos : entry.permisos ? [entry.permisos] : []
      for (const permission of values) {
        const key = `${permission.modulo}:${permission.accion}`
        if (entry.permitido) permissions.push(key)
        else {
          const index = permissions.indexOf(key)
          if (index >= 0) permissions.splice(index, 1)
        }
      }
    }
  } else if (!['42P01', 'PGRST205'].includes(String((overrides.error as { code?: string }).code ?? ''))) {
    throw new Error(`No se pudieron cargar tus permisos personalizados: ${overrides.error.message}`)
  }
  return { profile: { id: row.id, nombre: row.nombre, email: row.email ?? session.user.email ?? '', rol: role?.nombre ?? 'Sin rol', activo: row.activo, avatarUrl: row.avatar_url ?? null }, permissions }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [error, setError] = useState('')
  const [permissions, setPermissions] = useState<string[]>([])

  useEffect(() => {
    if (!supabase) return
    let active = true
    supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return
      if (error) setError(translateAuthError(error.message))
      setSession(data.session)
      if (!data.session) setLoading(false)
    }).catch((error) => { if (active) { setError(String(error.message)); setLoading(false) } })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      if (!next) {
        setProfile(null)
        setPermissions([])
        setError('')
        setLoading(false)
      }
    })
    return () => {
      active = false
      listener.subscription.unsubscribe()
    }
  }, [])

  // El perfil se recarga solo cuando cambia la persona, no en cada renovación de token.
  const userId = session?.user.id
  useEffect(() => {
    if (!session || !userId) return
    let active = true
    setLoading(true)
    setProfile(null)
    setPermissions([])
    setError('')
    loadProfile(session).then((next) => {
      if (!active) return
      setProfile(next.profile)
      setPermissions(next.permissions)
    }).catch((error) => active && setError(error.message || 'No se pudo cargar tu perfil.'))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  const signIn = useCallback<AuthContextValue['signIn']>(async (email, password) => {
    if (!supabase) return 'Supabase no está configurado. Completa el archivo .env.'
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error) return translateAuthError(error.message)
    try {
      const next = await loadProfile(data.session)
      setProfile(next.profile)
      setPermissions(next.permissions)
    } catch (error) { return (error as Error).message }
    return null
  }, [])

  const signUp = useCallback<AuthContextValue['signUp']>(async (nombre, email, password) => {
    if (!supabase) return { error: 'Supabase no está configurado. Completa el archivo .env.', needsConfirmation: false }
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { nombre: nombre.trim() } },
    })
    if (error) return { error: translateAuthError(error.message), needsConfirmation: false }
    // Con confirmación de correo activa, Supabase no devuelve error si el correo ya existe: devuelve identities vacío.
    if (data.user && data.user.identities && data.user.identities.length === 0) {
      return { error: 'Este correo ya está registrado. Inicia sesión o usa otro correo.', needsConfirmation: false }
    }
    return { error: null, needsConfirmation: !data.session }
  }, [])

  const signOut = useCallback(async () => {
    if (supabase) {
      const { error } = await supabase.auth.signOut()
      if (error) throw error
    }
    setSession(null)
    setProfile(null)
    setPermissions([])
  }, [])

  const refreshProfile = useCallback(async () => {
    if (!session) return
    setLoading(true)
    setError('')
    try {
      const next = await loadProfile(session)
      setProfile(next.profile)
      setPermissions(next.permissions)
    } catch (error) { setError((error as Error).message) }
    finally { setLoading(false) }
  }, [session])

  const updateProfile = useCallback(async (nombre: string, avatarUrl?: string | null) => {
    if (!supabase || !session) throw new Error('Inicia sesión para actualizar tu perfil.')
    const name = nombre.trim()
    if (name.length < 2) throw new Error('Escribe tu nombre completo.')
    const payload: { nombre: string; avatar_url?: string | null } = { nombre: name }
    if (avatarUrl !== undefined) payload.avatar_url = avatarUrl
    const result = await supabase.from('usuarios').update(payload).eq('id', session.user.id).select('id').single()
    if (result.error) {
      if (avatarUrl !== undefined && isMissingAvatarColumn(result.error)) {
        throw new Error('Falta la columna avatar_url en Supabase. Ejecuta la migración 20261016000000_perfil_avatar.sql y vuelve a intentarlo. Tu nombre no se modificó.')
      }
      throw result.error
    }
    setProfile(current => current ? { ...current, nombre: name, avatarUrl: avatarUrl === undefined ? current.avatarUrl : avatarUrl } : current)
  }, [session])

  const can = useCallback((page: PermissionModuleKey, action: PermissionAction = 'ver') => Boolean(profile?.activo && permissions.includes(`${permissionModule[page]}:${action}`)), [profile, permissions])

  const value = useMemo<AuthContextValue>(
    () => ({ session, profile, loading, error, permissions, can, refreshProfile, updateProfile, configured: isSupabaseConfigured, signIn, signUp, signOut }),
    [session, profile, loading, error, permissions, can, refreshProfile, updateProfile, signIn, signUp, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth debe usarse dentro de AuthProvider')
  return context
}
