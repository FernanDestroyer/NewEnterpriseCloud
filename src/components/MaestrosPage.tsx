import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Building2, Check, Edit3, MapPinned, Package, Plus, RefreshCw, Save, Truck, UserRound, X } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { catalogLabels, fetchBusinessCatalogs, fetchMasterChoices, fetchMasterPeople, saveBusinessCatalog, saveMasterPerson, toggleBusinessCatalog, toggleMasterPerson, type BusinessCatalog, type MasterPerson } from '../services/masters'
import { friendlyError } from '../services/records'

type MasterTab = 'personas' | 'catalogos'
const categoryList = Object.keys(catalogLabels) as BusinessCatalog['categoria'][]
const blankCatalog = (): Pick<BusinessCatalog, 'categoria' | 'codigo' | 'nombre' | 'tasa' | 'descripcion'> => ({ categoria: 'documento_venta', codigo: '', nombre: '', tasa: null, descripcion: '' })
export default function MaestrosPage() {
  const location = useLocation()
  const { can } = useAuth()
  const [tab, setTab] = useState<MasterTab>('personas')
  const [people, setPeople] = useState<{ transportistas: MasterPerson[]; vendedores: MasterPerson[] }>({ transportistas: [], vendedores: [] })
  const [catalogs, setCatalogs] = useState<BusinessCatalog[]>([])
  const [choices, setChoices] = useState<{ branches: Array<{ id: string; codigo: string; nombre: string }>; users: Array<{ id: string; nombre: string; email: string | null }> }>({ branches: [], users: [] })
  const [kind, setKind] = useState<'transportista' | 'vendedor'>('transportista')
  const [editingPerson, setEditingPerson] = useState<MasterPerson | null>(null)
  const [editingCatalog, setEditingCatalog] = useState<BusinessCatalog | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [nextPeople, nextCatalogs, nextChoices] = await Promise.all([fetchMasterPeople(), fetchBusinessCatalogs(), fetchMasterChoices()])
      setPeople(nextPeople); setCatalogs(nextCatalogs); setChoices(nextChoices)
    } catch (cause) { setError(friendlyError(cause)) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const anchor = location.hash.slice(1)
    if (anchor !== 'personas' && anchor !== 'catalogos') return
    setTab(anchor)
    const timer = window.setTimeout(() => document.getElementById(anchor)?.scrollIntoView({ block: 'start' }), 50)
    return () => window.clearTimeout(timer)
  }, [location.hash])
  const startPersonEdit = (personKind: 'transportista' | 'vendedor', value: MasterPerson) => { setKind(personKind); setEditingPerson(value) }
  const personSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (busy || !can('settings', editingPerson ? 'editar' : 'crear')) return
    const values = new FormData(event.currentTarget)
    setBusy(true); setError(''); setMessage('')
    try {
      await saveMasterPerson(kind, {
        codigo: String(values.get('codigo') ?? ''), nombre: String(values.get('nombre') ?? ''),
        ruc: String(values.get('ruc') ?? ''), telefono: String(values.get('telefono') ?? ''),
        email: String(values.get('email') ?? ''), direccion: String(values.get('direccion') ?? ''),
        sucursal_id: String(values.get('sucursal_id') ?? '') || null, usuario_id: String(values.get('usuario_id') ?? '') || null,
        estado: String(values.get('estado') ?? 'Activo') as MasterPerson['estado'],
      }, editingPerson?.id)
      setEditingPerson(null); setMessage(`${kind === 'vendedor' ? 'Vendedor' : 'Transportista'} guardado.`); await load()
    } catch (cause) { setError(friendlyError(cause)) }
    finally { setBusy(false) }
  }
  const catalogSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (busy || !can('settings', editingCatalog ? 'editar' : 'crear')) return
    const values = new FormData(event.currentTarget)
    setBusy(true); setError(''); setMessage('')
    try {
      const category = String(values.get('categoria')) as BusinessCatalog['categoria']
      const rawRate = String(values.get('tasa') ?? '')
      await saveBusinessCatalog({ categoria: category, codigo: String(values.get('codigo') ?? ''), nombre: String(values.get('nombre') ?? ''), tasa: rawRate === '' ? null : Number(rawRate), descripcion: String(values.get('descripcion') ?? '') }, editingCatalog?.id)
      setEditingCatalog(null); setMessage('Catálogo guardado en Supabase.'); await load()
    } catch (cause) { setError(friendlyError(cause)) }
    finally { setBusy(false) }
  }
  const togglePerson = async (personKind: 'transportista' | 'vendedor', item: MasterPerson) => {
    if (busy || !can('settings', 'editar')) return
    setBusy(true); setError(''); setMessage('')
    try { await toggleMasterPerson(personKind, item.id, item.estado !== 'Activo'); await load(); setMessage(`${item.nombre} ${item.estado === 'Activo' ? 'desactivado' : 'activado'}.`) }
    catch (cause) { setError(friendlyError(cause)) } finally { setBusy(false) }
  }
  const toggleCatalog = async (item: BusinessCatalog) => {
    if (busy || !can('settings', 'editar')) return
    setBusy(true); setError(''); setMessage('')
    try { await toggleBusinessCatalog(item.id, !item.activo); await load(); setMessage('Estado de catálogo actualizado.') }
    catch (cause) { setError(friendlyError(cause)) } finally { setBusy(false) }
  }
  const activePeople = kind === 'transportista' ? people.transportistas : people.vendedores
  const catalogGroups = useMemo(() => categoryList.map(category => ({ category, rows: catalogs.filter(row => row.categoria === category) })), [catalogs])
  const permitted = can('settings')
  if (!can('settings')) return <div className="ws-card ws-empty-compact"><Building2 size={28} /><strong>Acceso restringido a Maestros</strong><span>Tu rol no tiene permiso de consulta de Configuración.</span></div>
  return <div className="ec-module-page">
    <header className="module-header"><div><span className="section-kicker">DATOS MAESTROS / CONFIGURACIÓN</span><h1>Maestros</h1><p>Catálogos y estructuras compartidas por ventas, compras, inventario y documentos.</p></div><button className="export-button" type="button" disabled={loading || busy} onClick={() => void load()}><RefreshCw size={15} className={loading ? 'ws-spin' : ''} />Actualizar</button></header>
    <div className="ws-report-grid ec-master-shortcuts">
      <Link className="ws-card ws-report-card" to="/inventory#productos"><span className="ws-soft-icon blue"><Package size={20} /></span><h2>Productos y clasificación</h2><p>Productos, categorías y unidades de medida compartidas con inventario.</p><span className="ws-text-button">Abrir catálogo</span></Link>
      <Link className="ws-card ws-report-card" to="/mantenimientos#empresa"><span className="ws-soft-icon violet"><Building2 size={20} /></span><h2>Ficha de empresa</h2><p>Razón social, RUC, domicilio fiscal y contacto del emisor.</p><span className="ws-text-button">Administrar empresa</span></Link>
      <Link className="ws-card ws-report-card" to="/mantenimientos#organizacion"><span className="ws-soft-icon green"><MapPinned size={20} /></span><h2>Sucursales, almacenes y zonas</h2><p>Estructura física, territorios comerciales y rutas de reparto.</p><span className="ws-text-button">Administrar organización</span></Link>
    </div>
    <section id={tab} className="ws-card ec-module-card">
      <div className="ws-card-heading"><div><h2>Personas y catálogos complementarios</h2><p>Transportistas, vendedores y parámetros comerciales/tributarios.</p></div></div>
      <div className="ec-module-toolbar"><div className="ws-tabs" role="tablist" aria-label="Secciones de Maestros"><button role="tab" aria-selected={tab === 'personas'} onClick={() => { setTab('personas'); setEditingPerson(null) }}>Transportistas y vendedores</button><button role="tab" aria-selected={tab === 'catalogos'} onClick={() => { setTab('catalogos'); setEditingCatalog(null) }}>Catálogos comerciales y tributarios</button></div></div>
      {error && <div className="ws-notice ws-notice-warning" role="alert">{error}</div>}{message && <div className="ws-notice" role="status"><Check size={15} />{message}</div>}
      {loading ? <div className="ws-empty-compact"><RefreshCw size={24} className="ws-spin" /><strong>Cargando maestros de Supabase…</strong></div> : tab === 'personas' ? <>
        <div className="ec-module-toolbar"><div className="ws-tabs" role="tablist" aria-label="Tipo de persona"><button role="tab" aria-selected={kind === 'transportista'} onClick={() => { setKind('transportista'); setEditingPerson(null) }}><Truck size={14} />Transportistas ({people.transportistas.length})</button><button role="tab" aria-selected={kind === 'vendedor'} onClick={() => { setKind('vendedor'); setEditingPerson(null) }}><UserRound size={14} />Vendedores ({people.vendedores.length})</button></div><button className="primary-button" type="button" disabled={!can('settings', 'crear')} onClick={() => setEditingPerson({ id: '', codigo: '', nombre: '', estado: 'Activo' })}><Plus size={15} />Agregar {kind === 'vendedor' ? 'vendedor' : 'transportista'}</button></div>
        <div className="table-scroll"><table className="record-table"><thead><tr><th>Código</th><th>Nombre</th><th>Contacto / datos</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{activePeople.map(item => <tr key={item.id}><td><span className="record-id">{item.codigo}</span></td><td><strong>{item.nombre}</strong>{item.sucursal_id && <small>{choices.branches.find(branch => branch.id === item.sucursal_id)?.nombre ?? 'Sucursal'}</small>}</td><td>{kind === 'transportista' && item.ruc ? <span>RUC {item.ruc}</span> : <span>{item.email || '—'}</span>}<small>{[item.telefono, item.direccion].filter(Boolean).join(' · ') || 'Sin datos adicionales'}</small></td><td><span className={`status-pill ${item.estado === 'Activo' ? 'green' : 'amber'}`}>{item.estado}</span></td><td><div className="row-actions">{can('settings', 'editar') && <button className="row-action" title="Editar" onClick={() => startPersonEdit(kind, item)}><Edit3 size={15} /></button>}{can('settings', 'editar') && <button className="export-button" disabled={busy} onClick={() => void togglePerson(kind, item)}>{item.estado === 'Activo' ? 'Desactivar' : 'Activar'}</button>}</div></td></tr>)}{activePeople.length === 0 && <tr><td colSpan={5}><div className="ws-empty-compact">Aún no hay registros para este catálogo.</div></td></tr>}</tbody></table></div>
        {editingPerson && <form key={editingPerson.id || 'new-person'} className="ws-form ec-inline-form" onSubmit={personSubmit}><div className="ws-section-heading"><div><h2>{editingPerson.id ? 'Editar' : 'Nuevo'} {kind === 'vendedor' ? 'vendedor' : 'transportista'}</h2><p>El registro se conserva en Supabase y puede desactivarse sin borrar historial.</p></div><button type="button" className="ws-icon-button" aria-label="Cerrar" onClick={() => setEditingPerson(null)}><X size={16} /></button></div><div className="ws-form-grid">
          <label>Código<input name="codigo" required minLength={2} maxLength={20} pattern="[A-Za-z0-9_-]+" defaultValue={editingPerson.codigo} placeholder={kind === 'vendedor' ? 'VEN-001' : 'TRA-001'} /></label>
          <label>Nombre o razón social<input name="nombre" required minLength={2} maxLength={180} defaultValue={editingPerson.nombre} /></label>
          <label>Teléfono<input name="telefono" maxLength={40} defaultValue={editingPerson.telefono ?? ''} /></label>
          <label>Correo<input type="email" name="email" maxLength={180} defaultValue={editingPerson.email ?? ''} /></label>
          {kind === 'transportista' ? <><label>RUC<input name="ruc" inputMode="numeric" maxLength={11} pattern="[0-9]{0,11}" defaultValue={editingPerson.ruc ?? ''} /></label><label>Dirección<input name="direccion" maxLength={240} defaultValue={editingPerson.direccion ?? ''} /></label></> : <><label>Sucursal<select name="sucursal_id" defaultValue={editingPerson.sucursal_id ?? ''}><option value="">Sin asignar</option>{choices.branches.map(branch => <option key={branch.id} value={branch.id}>{branch.codigo} · {branch.nombre}</option>)}</select></label><label>Usuario vinculado<select name="usuario_id" defaultValue={editingPerson.usuario_id ?? ''}><option value="">Sin vincular</option>{choices.users.map(user => <option key={user.id} value={user.id}>{user.nombre}{user.email ? ` · ${user.email}` : ''}</option>)}</select></label></>}
          {editingPerson.id && <label>Estado<select name="estado" defaultValue={editingPerson.estado}><option>Activo</option><option>Inactivo</option></select></label>}
        </div><div className="ws-heading-actions"><button type="button" className="cancel-button" onClick={() => setEditingPerson(null)}>Cancelar</button><button className="primary-button" type="submit" disabled={busy || !permitted}>{busy ? 'Guardando…' : <><Save size={15} />Guardar</>}</button></div></form>}
      </> : <>
        <div className="ec-module-toolbar"><p className="relation-hint">Los catálogos no sustituyen la emisión electrónica SUNAT. Las tasas parametrizan la operación; confirme su aplicación tributaria con su asesor.</p><button className="primary-button" type="button" disabled={!can('settings', 'crear')} onClick={() => setEditingCatalog({ ...blankCatalog(), id: '', activo: true, created_at: '', updated_at: '' } as BusinessCatalog)}><Plus size={15} />Agregar elemento</button></div>
        {catalogGroups.map(group => <section className="ec-catalog-group" key={group.category}><div className="ws-section-heading"><div><h2>{catalogLabels[group.category]}</h2><p>{group.rows.filter(row => row.activo).length} vigentes · se puede desactivar sin perder el registro</p></div></div><div className="table-scroll"><table className="record-table"><thead><tr><th>Código</th><th>Nombre</th><th>Tasa / detalle</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{group.rows.map(item => <tr key={item.id}><td><span className="record-id">{item.codigo}</span></td><td><strong>{item.nombre}</strong></td><td>{item.tasa !== null ? `${item.tasa}%` : item.descripcion || '—'}</td><td><span className={`status-pill ${item.activo ? 'green' : 'amber'}`}>{item.activo ? 'Activo' : 'Inactivo'}</span></td><td><div className="row-actions">{can('settings', 'editar') && <button className="row-action" title="Editar" onClick={() => setEditingCatalog(item)}><Edit3 size={15} /></button>}{can('settings', 'editar') && <button className="export-button" disabled={busy} onClick={() => void toggleCatalog(item)}>{item.activo ? 'Desactivar' : 'Activar'}</button>}</div></td></tr>)}{!group.rows.length && <tr><td colSpan={5}><span className="relation-hint">Sin elementos definidos para esta categoría.</span></td></tr>}</tbody></table></div></section>)}
        {editingCatalog && <form key={editingCatalog.id || 'new-catalog'} className="ws-form ec-inline-form" onSubmit={catalogSubmit}><div className="ws-section-heading"><div><h2>{editingCatalog.id ? 'Editar' : 'Nuevo'} elemento de catálogo</h2></div><button type="button" className="ws-icon-button" aria-label="Cerrar" onClick={() => setEditingCatalog(null)}><X size={16} /></button></div><div className="ws-form-grid"><label>Categoría<select name="categoria" value={editingCatalog.categoria} onChange={event => setEditingCatalog(current => current ? { ...current, categoria: event.target.value as BusinessCatalog['categoria'] } : current)}>{categoryList.map(category => <option key={category} value={category}>{catalogLabels[category]}</option>)}</select></label><label>Código<input name="codigo" required minLength={2} maxLength={30} defaultValue={editingCatalog.codigo} /></label><label>Nombre<input name="nombre" required minLength={2} maxLength={120} defaultValue={editingCatalog.nombre} /></label>{editingCatalog.categoria === 'tasa_impuesto' && <label>Tasa (%)<input name="tasa" required type="number" min="0" max="100" step="0.0001" defaultValue={editingCatalog.tasa ?? ''} /></label>}<label className="ec-span-all">Descripción<input name="descripcion" maxLength={300} defaultValue={editingCatalog.descripcion ?? ''} /></label></div><div className="ws-heading-actions"><button type="button" className="cancel-button" onClick={() => setEditingCatalog(null)}>Cancelar</button><button className="primary-button" type="submit" disabled={busy}>{busy ? 'Guardando…' : <><Save size={15} />Guardar catálogo</>}</button></div></form>}
      </>}
    </section>
  </div>
}
