import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { BookOpen, Check, LoaderCircle, Save, ShieldCheck, X } from 'lucide-react'
import { DATA_PAGES, pageMeta } from '../data/catalog'
import { permissionModule } from '../data/workspace'
import { fetchUserPermissionOverrides, saveUserPermissionOverrides, type AppRole, type PermissionCatalogEntry, type RolePermissionLink } from '../services/usuarios'
import { friendlyError } from '../services/records'
import { useDialog } from './useDialog'

const ACTIONS: PermissionCatalogEntry['accion'][] = ['ver', 'crear', 'editar', 'eliminar', 'importar']
const ACTION_LABEL: Record<PermissionCatalogEntry['accion'], string> = {
  ver: 'Consultar', crear: 'Crear', editar: 'Editar', eliminar: 'Eliminar', importar: 'Importar CSV',
}
const MODULE_LABEL = Object.fromEntries(DATA_PAGES.map(page => [permissionModule[page], pageMeta[page].title])) as Record<string, string>
MODULE_LABEL.usuarios = 'Usuarios'
MODULE_LABEL.auditoria = 'Seguridad y Auditoría'
MODULE_LABEL.metas = 'Metas y Objetivos'

function groupPermissions(permissions: PermissionCatalogEntry[]) {
  return permissions.reduce<Record<string, PermissionCatalogEntry[]>>((groups, permission) => {
    ;(groups[permission.modulo] ??= []).push(permission)
    return groups
  }, {})
}

function DialogShell({ title, description, onClose, children, footer }: { title: string; description: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const dialogRef = useDialog<HTMLDivElement>(onClose)
  return <div className="modal-backdrop" role="presentation" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <div ref={dialogRef} className="ws-dialog permission-dialog" role="dialog" aria-modal="true" aria-label={title}>
      <header className="modal-heading"><div><span className="section-kicker"><i /> ADMINISTRACIÓN DE ACCESO</span><h2>{title}</h2><p>{description}</p></div><button type="button" className="modal-close" onClick={onClose} aria-label="Cerrar"><X size={17} /></button></header>
      <div className="permission-dialog-body">{children}</div>
      {footer && <footer className="ws-heading-actions permission-dialog-footer">{footer}</footer>}
    </div>
  </div>
}

export function RoleGuideDialog({ roles, permissions, roleLinks, onClose }: { roles: AppRole[]; permissions: PermissionCatalogEntry[]; roleLinks: RolePermissionLink[]; onClose: () => void }) {
  const [selectedRoleId, setSelectedRoleId] = useState(roles[0]?.id ?? '')
  const rolePermissionIds = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const link of roleLinks) {
      if (!map.has(link.rol_id)) map.set(link.rol_id, new Set())
      map.get(link.rol_id)!.add(link.permiso_id)
    }
    return map
  }, [roleLinks])
  const groups = groupPermissions(permissions)
  const selectedRole = roles.find(role => role.id === selectedRoleId) ?? roles[0]
  const selectedPermissionIds = rolePermissionIds.get(selectedRole?.id ?? '') ?? new Set<string>()
  return <DialogShell title="Guía de roles" description="Permisos predeterminados de cada rol. Los ajustes individuales se muestran en la cuenta correspondiente." onClose={onClose}>
    <div className="permission-guide-content">
      {!!roles.length && <div className="permission-role-tabs" role="tablist" aria-label="Seleccionar rol">
        {roles.map(role => {
          const count = rolePermissionIds.get(role.id)?.size ?? 0
          const selected = role.id === selectedRole?.id
          return <button className={`permission-role-tab${selected ? ' is-selected' : ''}`} type="button" role="tab" aria-selected={selected} aria-controls={`role-permissions-${role.id}`} id={`role-tab-${role.id}`} key={role.id} onClick={() => setSelectedRoleId(role.id)}>
            <ShieldCheck size={16} /><span><strong>{role.nombre}</strong><small>{count} {count === 1 ? 'permiso' : 'permisos'}</small></span>
          </button>
        })}
      </div>}
      {selectedRole && <section className="permission-role-card permission-role-panel" role="tabpanel" id={`role-permissions-${selectedRole.id}`} aria-labelledby={`role-tab-${selectedRole.id}`}>
        <h3><ShieldCheck size={16} />Permisos del rol {selectedRole.nombre}</h3>
        {Object.entries(groups).map(([module, rows]) => {
          const assigned = rows.filter(permission => selectedPermissionIds.has(permission.id))
          if (!assigned.length) return null
          return <div className="permission-role-group" key={`${selectedRole.id}-${module}`}><strong>{MODULE_LABEL[module] ?? module}</strong><span>{assigned.map(permission => ACTION_LABEL[permission.accion]).join(' · ')}</span></div>
        })}
        {!selectedPermissionIds.size && <p className="relation-hint">Este rol todavía no tiene permisos asignados.</p>}
      </section>}
      {!roles.length && <p className="relation-hint">No hay roles configurados.</p>}
      <p className="permission-dialog-hint"><BookOpen size={15} />Esta guía muestra la base del rol. Cada usuario puede tener permisos particulares adicionales o restringidos.</p>
    </div>
  </DialogShell>
}

export function UserPermissionsDialog({ user, permissions, roleLinks, onClose, onSaved }: { user: { id: string; nombre: string; email: string; rol: string; rolId: string | null }; permissions: PermissionCatalogEntry[]; roleLinks: RolePermissionLink[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const rolePermissionIds = useMemo(() => new Set(roleLinks.filter(link => link.rol_id === user.rolId).map(link => link.permiso_id)), [roleLinks, user.rolId])
  const groups = groupPermissions(permissions)

  useEffect(() => {
    let active = true
    fetchUserPermissionOverrides(user.id).then(overrides => {
      if (!active) return
      const next: Record<string, boolean> = {}
      for (const permission of permissions) next[permission.id] = rolePermissionIds.has(permission.id)
      for (const override of overrides) next[override.permiso_id] = override.permitido
      setSelected(next)
    }).catch(error => active && setError(friendlyError(error))).finally(() => active && setLoading(false))
    return () => { active = false }
  }, [user.id, permissions, rolePermissionIds])

  const save = async () => {
    setBusy(true); setError(''); setNotice('')
    try {
      const overrides = permissions.flatMap(permission => {
        const defaultAllowed = rolePermissionIds.has(permission.id)
        const effectiveAllowed = selected[permission.id] ?? defaultAllowed
        return effectiveAllowed === defaultAllowed ? [] : [{ permiso_id: permission.id, permitido: effectiveAllowed }]
      })
      await saveUserPermissionOverrides(user.id, overrides)
      await onSaved()
      setNotice('Permisos personalizados guardados.')
      window.setTimeout(onClose, 700)
    } catch (error) { setError(friendlyError(error)) }
    finally { setBusy(false) }
  }

  const restoreRole = () => setSelected(Object.fromEntries(permissions.map(permission => [permission.id, rolePermissionIds.has(permission.id)])))
  const updatePermission = (permission: PermissionCatalogEntry, allowed: boolean) => {
    setSelected(current => {
      const next = { ...current, [permission.id]: allowed }
      const modulePermissions = permissions.filter(item => item.modulo === permission.modulo)
      if (permission.accion === 'ver' && !allowed) {
        for (const item of modulePermissions) next[item.id] = false
      } else if (permission.accion !== 'ver' && allowed) {
        const viewPermission = modulePermissions.find(item => item.accion === 'ver')
        if (viewPermission) next[viewPermission.id] = true
      }
      return next
    })
  }
  return <DialogShell title="Permisos personalizados" description={`${user.nombre} · ${user.email} · Rol ${user.rol}. Los cambios solo afectan a esta cuenta.`} onClose={() => !busy && onClose()} footer={<><button className="ws-button ws-button-secondary" type="button" disabled={busy || loading} onClick={restoreRole}>Restablecer permisos del rol</button><button className="ws-button" type="button" disabled={busy || loading} onClick={() => void save()}><Save size={15} />{busy ? 'Guardando…' : 'Guardar cambios'}</button></>}>
    <div className="permission-editor-content">
      <div className="permission-dialog-hint"><ShieldCheck size={15} /><span>Marcado = permitido. Los cambios se guardan como excepciones personales; lo demás se hereda del rol.</span></div>
      {loading ? <div className="ws-empty-compact"><LoaderCircle size={22} className="ws-spin" />Cargando permisos…</div> : <div className="permission-matrix-scroll"><table className="permission-matrix">
        <thead><tr><th scope="col">Módulo</th>{ACTIONS.map(action => <th scope="col" key={action}>{ACTION_LABEL[action]}</th>)}</tr></thead>
        <tbody>{Object.entries(groups).map(([module, rows]) => <tr key={module}>
          <th scope="row">{MODULE_LABEL[module] ?? module}</th>
          {ACTIONS.map(action => {
            const permission = rows.find(item => item.accion === action)
            if (!permission) return <td className="permission-matrix-unavailable" key={action} aria-label="No aplica">—</td>
          const base = rolePermissionIds.has(permission.id)
          const value = selected[permission.id] ?? base
          const customized = value !== base
            return <td key={permission.id}><label className="permission-matrix-option" title={customized ? (value ? 'Permiso adicional' : 'Restringido') : (base ? 'Heredado del rol: permitido' : 'Heredado del rol: no permitido')}>
              <input type="checkbox" checked={value} disabled={busy} onChange={event => updatePermission(permission, event.target.checked)} aria-label={`${ACTION_LABEL[action]} en ${MODULE_LABEL[module] ?? module}`} />
              <small className={customized ? 'is-customized' : ''}>{customized ? (value ? 'Personalizado' : 'Restringido') : (base ? 'Heredado' : 'No permitido')}</small>
            </label></td>
          })}
        </tr>)}</tbody>
      </table></div>}
      {error && <div className="ws-notice ws-notice-warning" role="alert">{error}</div>}
      {notice && <div className="ws-notice" role="status"><Check size={15} />{notice}</div>}
    </div>
  </DialogShell>
}
