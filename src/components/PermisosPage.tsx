import { useCallback, useEffect, useState } from 'react'
import { BookOpen, KeyRound, Lock, RefreshCw, ShieldCheck } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { displayDate } from '../data/workspace'
import { friendlyError } from '../services/records'
import { fetchPermissionCatalog, fetchRolePermissionLinks, fetchRoles, fetchUsers, PROTECTED_ADMIN_EMAIL, setUserActive, updateUserRole, type AppRole, type AppUser, type PermissionCatalogEntry, type RolePermissionLink } from '../services/usuarios'
import { RoleGuideDialog, UserPermissionsDialog } from './PermissionDialogs'

export default function PermisosPage() {
  const { can, profile, session } = useAuth()
  const [users, setUsers] = useState<AppUser[]>([])
  const [roles, setRoles] = useState<AppRole[]>([])
  const [permissionCatalog, setPermissionCatalog] = useState<PermissionCatalogEntry[]>([])
  const [rolePermissionLinks, setRolePermissionLinks] = useState<RolePermissionLink[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState('')
  const [notice, setNotice] = useState('')
  const [guideOpen, setGuideOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<AppUser | null>(null)
  const isAdmin = profile?.rol === 'Administrador'

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [nextUsers, nextRoles, nextPermissions, nextLinks] = await Promise.all([fetchUsers(), fetchRoles(), fetchPermissionCatalog(), fetchRolePermissionLinks()])
      setUsers(nextUsers)
      setRoles(nextRoles)
      setPermissionCatalog(nextPermissions)
      setRolePermissionLinks(nextLinks)
    } catch (error) {
      setUsers([]); setRoles([])
      setError(friendlyError(error))
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { if (can('settings')) void load() }, [load, can])

  if (!can('settings')) {
    return <section className="ws-card ws-empty-compact"><KeyRound size={28} /><strong>Acceso restringido a permisos</strong><span>Tu rol no tiene permiso de configuración del sistema.</span></section>
  }

  const changeRole = async (user: AppUser, rolId: string) => {
    if (!rolId || rolId === user.rolId) return
    setBusyId(user.id); setNotice('')
    try {
      await updateUserRole(user.id, rolId)
      await load()
      const role = roles.find(item => item.id === rolId)
      setNotice(`Rol de ${user.email} actualizado a ${role?.nombre ?? 'el nuevo rol'}. Aplica cuando vuelva a entrar.`)
    } catch (error) { setNotice(friendlyError(error)) }
    finally { setBusyId('') }
  }

  const toggleActive = async (user: AppUser) => {
    setBusyId(user.id); setNotice('')
    try {
      await setUserActive(user.id, !user.activo)
      await load()
      setNotice(`${user.email} ${user.activo ? 'desactivada: ya no puede entrar' : 'activada de nuevo'}.`)
    } catch (error) { setNotice(friendlyError(error)) }
    finally { setBusyId('') }
  }

  return <>
    <section className="ws-page-heading"><div><span className="ws-eyebrow">ADMINISTRACIÓN DEL SISTEMA</span><h1>Permisos</h1><p>Los roles definen los permisos iniciales. Un administrador puede ajustar permisos para una cuenta específica.</p></div><div className="ws-heading-actions">{isAdmin && <button className="ws-button ws-button-secondary" onClick={() => setGuideOpen(true)}><BookOpen size={16} />Guía de roles</button>}<button className="ws-button ws-button-secondary" disabled={loading} onClick={() => void load()}><RefreshCw size={16} />Actualizar</button></div></section>
    {error && <div className="ws-notice ws-notice-warning" role="alert">{error}<button className="ws-text-button" onClick={() => void load()}>Reintentar</button></div>}
    {notice && <div className="ws-notice" role="status">{notice}</div>}
    <section className="ws-card"><div className="table-scroll"><table className="record-table"><thead><tr><th>Cuenta</th><th>Rol</th><th>Estado</th><th>Registro</th><th><span className="sr-only">Acciones</span></th></tr></thead><tbody>
      {users.map(user => {
        const isSelf = user.id === session?.user.id
        const isProtected = user.email.toLocaleLowerCase('es') === PROTECTED_ADMIN_EMAIL
        const locked = !isAdmin || isSelf || isProtected
        return <tr key={user.id}>
          <td><strong>{user.nombre}</strong><small>{user.email}{isSelf ? ' · Tú' : ''}</small>{isProtected && <span className="linked-badge"><Lock size={11} /> Protegida</span>}</td>
          <td>{!locked ? (
            <select value={user.rolId ?? ''} disabled={busyId === user.id} onChange={(event) => void changeRole(user, event.target.value)} aria-label={`Rol de ${user.email}`} className="ws-control">
              {!user.rolId && <option value="">Sin rol</option>}
              {roles.map(role => <option key={role.id} value={role.id}>{role.nombre}</option>)}
            </select>
          ) : <span className={`status-pill ${user.activo ? 'green' : 'amber'}`}>{user.rol}</span>}</td>
          <td><span className={`status-pill ${user.activo ? 'green' : 'red'}`}>{user.activo ? 'Activo' : 'Inactivo'}</span></td>
          <td className="record-date">{user.creado ? displayDate(user.creado) : '—'}</td>
          <td><div className="row-actions">{isAdmin && !isSelf && !isProtected && user.rol !== 'Administrador' && <button className="row-action" type="button" title="Editar permisos personalizados" aria-label={`Editar permisos de ${user.email}`} onClick={() => setEditingUser(user)}><ShieldCheck size={15} /></button>}{!locked && (
            <button className="row-action" type="button" title={user.activo ? 'Desactivar cuenta' : 'Activar cuenta'} aria-label={`${user.activo ? 'Desactivar' : 'Activar'} ${user.email}`} disabled={busyId === user.id} onClick={() => void toggleActive(user)}>{user.activo ? <Lock size={15} /> : <KeyRound size={15} />}</button>
          )}</div></td>
        </tr>
      })}
      {!users.length && !loading && !error && <tr><td colSpan={5}><div className="ws-empty-compact"><KeyRound size={26} /><strong>Sin cuentas registradas</strong><span>Las cuentas aparecen aquí al registrarse.</span></div></td></tr>}
    </tbody></table></div></section>
    {guideOpen && <RoleGuideDialog roles={roles} permissions={permissionCatalog} roleLinks={rolePermissionLinks} onClose={() => setGuideOpen(false)} />}
    {editingUser && <UserPermissionsDialog user={editingUser} permissions={permissionCatalog} roleLinks={rolePermissionLinks} onClose={() => setEditingUser(null)} onSaved={load} />}
  </>
}
