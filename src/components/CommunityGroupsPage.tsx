import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Hash, LockKeyhole, MessageCircle, MessagesSquare, Plus, RefreshCw, Shield, Trash2, Users } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { communityError, createCommunityGroup, createCommunityMemberGroup, listCommunityGroups, listCommunityRoles, removeCommunityGroup, type CommunityCandidate, type CommunityGroup, type CommunityRole } from '../services/community'
import CommunityChat from './CommunityChat'
import CommunityMemberPicker from './CommunityMemberPicker'
import ConfirmModal from './ConfirmModal'
import { PageHeader } from './ui/PageHeader'
import { useDialog } from './useDialog'
import './community.css'

function CreateGroupDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [roles, setRoles] = useState<CommunityRole[]>([])
  const [roleId, setRoleId] = useState('')
  const [audience, setAudience] = useState<'role' | 'members'>('role')
  const [members, setMembers] = useState<CommunityCandidate[]>([])
  const [busy, setBusy] = useState(false)
  const [loadingRoles, setLoadingRoles] = useState(true)
  const [error, setError] = useState('')
  const [rolesError, setRolesError] = useState('')
  const dialog = useDialog<HTMLDivElement>(onClose, busy)
  const validAudience = audience === 'role' ? Boolean(roleId) : members.length > 0

  useEffect(() => {
    let active = true
    listCommunityRoles().then(rows => {
      if (!active) return
      setRoles(rows)
      if (!rows.length) setRolesError('No hay roles disponibles para crear grupos.')
    }).catch(cause => { if (active) setRolesError(communityError(cause, 'No se pudieron cargar los roles.')) })
      .finally(() => { if (active) setLoadingRoles(false) })
    return () => { active = false }
  }, [])

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy || !validAudience) return
    const form = new FormData(event.currentTarget)
    const name = String(form.get('name') ?? '').trim()
    if (name.length < 3 || name.length > 60) { setError('El nombre debe tener entre 3 y 60 caracteres.'); return }
    setBusy(true)
    setError('')
    try {
      const description = String(form.get('description') ?? '').trim()
      const id = audience === 'role'
        ? await createCommunityGroup(roleId, name, description)
        : await createCommunityMemberGroup(name, description, members.map(member => member.id))
      onCreated(id)
    } catch (cause) { setError(communityError(cause, 'No se pudo crear el grupo. Comprueba si ya existe uno con ese nombre.')) }
    finally { setBusy(false) }
  }

  return <div className="modal-backdrop" onMouseDown={event => { if (!busy && event.target === event.currentTarget) onClose() }}>
    <div className="confirm-modal community-dialog" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="community-create-title">
      <h2 id="community-create-title">Crear grupo privado</h2>
      <p>Elige quién puede conversar. Los administradores siempre tienen acceso.</p>
      <form onSubmit={create}>
        <label>Nombre<input name="name" placeholder="Ej. Coordinación comercial" required minLength={3} maxLength={60} disabled={busy} data-autofocus /></label>
        <fieldset className="community-audience"><legend>Acceso al grupo</legend>
          <label><input type="radio" name="audience" checked={audience === 'role'} disabled={busy} onChange={() => { setAudience('role'); setError('') }} /><span><strong>Por rol</strong><small>Todas las cuentas activas del rol elegido.</small></span></label>
          <label><input type="radio" name="audience" checked={audience === 'members'} disabled={busy} onChange={() => { setAudience('members'); setError('') }} /><span><strong>Usuarios específicos</strong><small>Solo las personas que selecciones, aunque tengan roles distintos.</small></span></label>
        </fieldset>
        {audience === 'role' ? <><label>Rol del grupo<select required value={roleId} onChange={event => setRoleId(event.target.value)} disabled={busy || loadingRoles}>
          <option value="">{loadingRoles ? 'Cargando roles…' : 'Selecciona un rol'}</option>
          {roles.map(role => <option key={role.id} value={role.id}>{role.nombre}</option>)}
        </select></label>{rolesError && <div className="community-error-text" role="alert">{rolesError}</div>}</>
        : <CommunityMemberPicker members={members} onChange={setMembers} disabled={busy} />}
        <label>Descripción <span>(opcional)</span><textarea name="description" maxLength={240} rows={2} disabled={busy} placeholder="¿Para qué se usará el grupo?" /></label>
        {error && <div className="community-error-text" role="alert">{error}</div>}
        <div className="modal-actions"><button className="cancel-button" type="button" disabled={busy} onClick={onClose}>Cancelar</button><button className="primary-button" type="submit" disabled={busy || !validAudience}>{busy ? 'Creando…' : 'Crear grupo'}</button></div>
      </form>
    </div>
  </div>
}

function CommunityWorkspace({ userId, administrator }: { userId: string; administrator: boolean }) {
  const [groups, setGroups] = useState<CommunityGroup[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [removing, setRemoving] = useState<CommunityGroup | null>(null)
  const [removeError, setRemoveError] = useState('')
  const [initialized, setInitialized] = useState(false)
  const sequence = useRef(0)

  const refresh = useCallback(async (manual = false) => {
    const version = ++sequence.current
    if (manual) setLoading(true)
    try {
      const next = await listCommunityGroups()
      if (version !== sequence.current) return
      setGroups(next)
      setError('')
      setInitialized(true)
    } catch (cause) {
      if (version !== sequence.current) return
      setGroups([])
      setError(communityError(cause, 'No se pudieron cargar los grupos. Intenta nuevamente.'))
    } finally { if (version === sequence.current) setLoading(false) }
  }, [])

  useEffect(() => {
    const poll = () => { if (document.visibilityState === 'visible') void refresh() }
    void refresh()
    const timer = window.setInterval(poll, 10000)
    document.addEventListener('visibilitychange', poll)
    return () => { sequence.current++; window.clearInterval(timer); document.removeEventListener('visibilitychange', poll) }
  }, [refresh])

  const memberGroups = groups.filter(group => group.puede_conversar && (!administrator || group.rol === 'Administrador'))
  const managedGroups = administrator ? groups.filter(group => group.rol !== 'Administrador') : []
  const selected = groups.find(group => group.id === selectedId) ?? memberGroups[0] ?? managedGroups[0]

  const remove = async () => {
    if (!removing) return
    setRemoveError('')
    try {
      await removeCommunityGroup(removing.id)
      setGroups(current => current.filter(group => group.id !== removing.id))
      setRemoving(null)
      setNotice('Grupo eliminado. La conversación dejó de estar disponible.')
      void refresh()
    } catch (cause) { setRemoveError(communityError(cause, 'No se pudo eliminar el grupo. Intenta nuevamente.')) }
  }

  const renderGroup = (group: CommunityGroup) => <button className="community-group-option" key={group.id} type="button" aria-pressed={selected?.id === group.id} onClick={() => { setSelectedId(group.id); setNotice('') }}>
    <span className="community-group-icon">{!group.puede_conversar ? <LockKeyhole size={16} /> : group.rol ? <Hash size={18} /> : <Users size={16} />}</span><span><strong>{group.nombre}</strong><small>{group.rol ?? 'Usuarios específicos'}</small></span>
  </button>

  return <>
    <PageHeader icon={MessagesSquare} section="Comunidad" title="Grupos" description={administrator ? 'Conversa en todos los grupos y administra los canales de EnterpriseCloud.' : 'Conversa en los grupos de tu rol y en los que te hayan incluido.'} actions={administrator && <button className="ws-button community-action" type="button" disabled={!initialized || Boolean(error)} onClick={() => setCreateOpen(true)}><Plus size={17} /> Crear grupo</button>} />
    {notice && <div className="ws-notice" role="status">{notice}</div>}
    {error && <div className="ws-notice ws-notice-warning" role="alert">{error}<button className="ws-button ws-button-secondary" type="button" disabled={loading} onClick={() => void refresh(true)}><RefreshCw size={15} /> Reintentar</button></div>}
    <div className="community-layout">
      <aside className="ws-card community-sidebar" aria-label="Lista de grupos">
        <div className="community-sidebar-heading"><Users size={19} /><div><h2>Mis conversaciones</h2><span>{memberGroups.length} {memberGroups.length === 1 ? 'grupo disponible' : 'grupos disponibles'}</span></div></div>
        <div className="community-group-list">{memberGroups.map(renderGroup)}
          {!memberGroups.length && <p>{loading ? 'Cargando grupos…' : error ? 'Grupos no disponibles.' : 'No tienes grupos activos.'}</p>}
        </div>
        {managedGroups.length > 0 && <div className="community-manage-list"><h3><Shield size={15} /> Otros grupos</h3><span>Acceso de administrador.</span><div className="community-group-list">{managedGroups.map(renderGroup)}</div></div>}
      </aside>
      <section className="ws-card community-room" aria-label={selected ? `Grupo ${selected.nombre}` : 'Conversación'}>
        {selected ? <>
          <header className="community-room-header">
            <span className="community-room-icon"><Hash size={25} /></span>
            <div><span className="ec-eyebrow">{administrator && selected.rol !== 'Administrador' ? 'Acceso de administrador' : 'Canal privado'}</span><h2>{selected.nombre}</h2>{selected.descripcion && <p>{selected.descripcion}</p>}</div>
            {administrator && <button className="ws-button ws-button-secondary community-delete" type="button" onClick={() => { setRemoving(selected); setRemoveError('') }}><Trash2 size={15} /> Eliminar grupo</button>}
          </header>
          {selected.puede_conversar ? <CommunityChat key={selected.id} group={selected} userId={userId} /> : <div className="community-thread-empty community-room-placeholder"><span className="community-empty-icon"><LockKeyhole size={26} /></span><strong>Chat no habilitado para administración</strong><span>Aplica la migración de acceso administrativo en Supabase para leer y enviar mensajes en este grupo.</span></div>}
        </> : <div className="community-thread-empty community-room-placeholder"><span className="community-empty-icon"><MessageCircle size={26} /></span><strong>{loading ? 'Cargando Comunidad…' : 'No hay una conversación disponible'}</strong><span>{error ? 'Reintenta la carga para continuar.' : 'Los grupos aparecerán aquí cuando haya un canal habilitado para tu rol.'}</span></div>}
      </section>
    </div>
    {createOpen && administrator && <CreateGroupDialog onClose={() => setCreateOpen(false)} onCreated={id => { setSelectedId(id); setCreateOpen(false); setNotice('Grupo creado correctamente.'); void refresh() }} />}
    {removing && administrator && <ConfirmModal title={`¿Eliminar «${removing.nombre}»?`} message="El grupo se quitará de Comunidad y sus miembros ya no podrán abrir la conversación. El historial se conserva archivado." confirmLabel="Eliminar grupo" onCancel={() => setRemoving(null)} onConfirm={remove}>
      {removeError && <div className="community-error-text" role="alert">{removeError}</div>}
    </ConfirmModal>}
  </>
}

export default function CommunityGroupsPage() {
  const { profile, session } = useAuth()
  if (!profile?.activo || !session) return <div className="ws-empty-compact">Necesitas una cuenta activa para ingresar a Comunidad.</div>
  return <CommunityWorkspace key={`${session.user.id}:${profile.rol}`} userId={session.user.id} administrator={profile.rol === 'Administrador'} />
}
