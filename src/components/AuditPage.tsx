import { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, CalendarDays, Download, Eye, RefreshCw, Search, ShieldCheck, UserRound, X } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { AUDIT_ACTIONS, AUDIT_CSV_HEADER, auditActionLabel, auditActionTone, auditChanges, auditCsvRows, auditModuleLabel, auditModuleOptions, auditRangeError, auditResultLabel, auditResultTone, AUDIT_RESULTS, pageWindow, type AuditChange } from '../data/audit'
import { downloadCsv } from '../data/exports'
import { fetchAuditDetail, fetchAuditForExport, fetchAuditTrail, friendlyError, type AuditDetail, type AuditEntry, type AuditFilters } from '../services/records'
import { useDialog } from './useDialog'

const PAGE_SIZE = 5
const TEXT_DEBOUNCE_MS = 400

function eventTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Fecha no disponible' : date.toLocaleString('es-PE', { timeZone: 'America/Lima', dateStyle: 'medium', timeStyle: 'short' })
}

function shortRecord(value: string | null) {
  if (!value) return '—'
  return /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(value) ? `${value.slice(0, 8)}…` : value
}

function ChangeValue({ type, value }: { type: AuditChange['type']; value: string }) {
  return <span className={`ws-audit-value is-${type}`} title={type === 'ref' ? value : undefined}>{value}</span>
}

function AuditDetailDialog({ entry, onClose }: { entry: AuditEntry; onClose: () => void }) {
  const dialogRef = useDialog<HTMLDivElement>(onClose)
  const [detail, setDetail] = useState<AuditDetail | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let current = true
    setDetail(null)
    setError('')
    void fetchAuditDetail(entry.id)
      .then(result => { if (current) setDetail(result) })
      .catch(reason => { if (current) setError(friendlyError(reason)) })
    return () => { current = false }
  }, [entry.id])
  const changes = useMemo(() => (detail ? auditChanges(detail.before, detail.after) : []), [detail])
  const main = changes.filter(change => !change.technical)
  const technical = changes.filter(change => change.technical)
  const hiddenCount = changes.filter(change => change.hidden).length
  const isUpdate = entry.accion === 'UPDATE'
  const noExitoso = entry.resultado !== 'exitoso'
  const intro = noExitoso ? (entry.resultado === 'denegado' ? 'La base de datos rechazó esta operación por falta de permiso. No se modificó ningún dato.' : 'Esta operación falló y no se guardó ningún cambio.')
    : entry.accion === 'INSERT' ? 'Se creó este registro con los siguientes datos.'
    : entry.accion === 'DELETE' ? 'Se eliminó este registro. Estos eran sus datos.'
      : main.length ? `Se modificó ${main.length === 1 ? '1 campo' : `${main.length} campos`}.` : 'Solo cambiaron datos técnicos del registro.'

  return <div className="modal-backdrop" role="presentation" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <div ref={dialogRef} className="ws-dialog ws-audit-dialog" role="dialog" aria-modal="true" aria-label={`Detalle del evento ${entry.id}`}>
      <header className="modal-heading">
        <div>
          <span className="section-kicker"><i /> SEGURIDAD Y AUDITORÍA</span>
          <h2><span className={`status-pill ${auditActionTone(entry.accion)}`}>{auditActionLabel(entry.accion)}</span> {auditModuleLabel(entry.modulo)}</h2>
          <dl className="ws-audit-meta-list">
            <div><dt>Cuándo</dt><dd>{eventTime(entry.createdAt)}</dd></div>
            <div><dt>Quién</dt><dd>{entry.email ?? 'Usuario no disponible'}</dd></div>
            <div><dt>Registro</dt><dd title={entry.registro ?? undefined}>{shortRecord(entry.registro)}</dd></div>
          </dl>
        </div>
        <button type="button" className="modal-close" onClick={onClose} aria-label="Cerrar"><X size={17} /></button>
      </header>
      <div className="permission-dialog-body">
        {error && <div className="ws-notice ws-notice-warning" role="alert">{error}</div>}
        {!detail && !error && <div className="ws-empty-compact"><RefreshCw size={20} className="ws-spin" /><strong>Cargando cambios…</strong></div>}
        {detail && <>
          <p className="ws-audit-intro">{intro}</p>
          {!!main.length && isUpdate && <div className="table-scroll"><table className="record-table ws-audit-diff"><thead><tr><th>Campo</th><th>Antes</th><th>Después</th></tr></thead><tbody>
            {main.map(change => <tr key={change.field}>
              <th scope="row">{change.label}</th>
              <td className="is-before"><ChangeValue type={change.type} value={change.before} /></td>
              <td className="is-after"><ChangeValue type={change.type} value={change.after} /></td>
            </tr>)}
          </tbody></table></div>}
          {!!main.length && !isUpdate && <dl className="ws-audit-fieldgrid">
            {main.map(change => <div key={change.field}><dt>{change.label}</dt><dd><ChangeValue type={change.type} value={entry.accion === 'DELETE' ? change.before : change.after} /></dd></div>)}
          </dl>}
          {!!technical.length && <details className="ws-audit-technical">
            <summary>Datos técnicos ({technical.length})</summary>
            <dl>{technical.map(change => <div key={change.field}><dt>{change.label}</dt><dd>{isUpdate && change.kind === 'changed'
              ? <><ChangeValue type={change.type} value={change.before} /> → <ChangeValue type={change.type} value={change.after} /></>
              : <ChangeValue type={change.type} value={entry.accion === 'DELETE' ? change.before : change.after} />}</dd></div>)}</dl>
          </details>}
          {!changes.length && <div className="ws-empty-compact"><ShieldCheck size={26} /><strong>Este evento no modificó ningún campo</strong></div>}
          {hiddenCount > 0 && <p className="relation-hint">{hiddenCount === 1 ? 'Un campo sensible' : `${hiddenCount} campos sensibles`} se muestra oculto: la bitácora no expone contraseñas, tokens ni claves.</p>}
        </>}
      </div>
    </div>
  </div>
}

export default function AuditPage() {
  const { can } = useAuth()
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [total, setTotal] = useState(0)
  const [filters, setFilters] = useState<AuditFilters>({})
  const [userDraft, setUserDraft] = useState('')
  const [recordDraft, setRecordDraft] = useState('')
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const [selected, setSelected] = useState<AuditEntry | null>(null)
  const allowed = can('audit', 'ver')
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const rangeError = auditRangeError(filters.desde, filters.hasta)
  const hasFilters = Object.values(filters).some(Boolean) || !!userDraft || !!recordDraft
  const moduleOptions = useMemo(() => auditModuleOptions(entries.map(entry => entry.modulo)), [entries])

  const setFilter = (key: keyof AuditFilters, value: string) => {
    setFilters(current => ({ ...current, [key]: value || undefined }))
    setPage(0)
  }

  // El texto se aplica poco después de dejar de escribir para no consultar en cada tecla.
  const filtersRef = useRef(filters)
  filtersRef.current = filters
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const current = filtersRef.current
      const usuario = userDraft.trim() || undefined
      const registro = recordDraft.trim() || undefined
      if (current.usuario === usuario && current.registro === registro) return
      setFilters({ ...current, usuario, registro })
      setPage(0)
    }, TEXT_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [userDraft, recordDraft])

  useEffect(() => {
    if (!allowed) { setLoading(false); return }
    if (rangeError) { setEntries([]); setTotal(0); setLoading(false); setError(rangeError); return }
    let current = true
    setLoading(true)
    setError('')
    void fetchAuditTrail({ ...filters, limit: PAGE_SIZE, offset: page * PAGE_SIZE })
      .then(result => {
        if (!current) return
        setEntries(result.entries)
        setTotal(result.total)
      })
      .catch(reason => { if (current) { setEntries([]); setTotal(0); setError(friendlyError(reason)) } })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [allowed, filters, page, refreshKey, rangeError])

  const clearFilters = () => { setFilters({}); setUserDraft(''); setRecordDraft(''); setPage(0) }

  const exportCsv = async () => {
    setExporting(true)
    setNotice('')
    try {
      const result = await fetchAuditForExport(filters)
      if (!result.entries.length) { setNotice('No hay eventos para exportar con estos filtros.'); return }
      downloadCsv(`bitacora-${new Date().toISOString().slice(0, 10)}.csv`, AUDIT_CSV_HEADER, auditCsvRows(result.entries))
      setNotice(result.truncated
        ? `Se exportaron los ${result.entries.length} eventos más recientes de ${result.total}. Acota las fechas para exportar el resto.`
        : `Se exportaron ${result.entries.length} eventos.`)
    } catch (reason) { setNotice(friendlyError(reason)) }
    finally { setExporting(false) }
  }

  if (!allowed) return <section className="ws-card ws-empty-compact"><ShieldCheck size={28} /><strong>Acceso restringido a la bitácora</strong><span>Tu rol necesita el permiso de consulta de auditoría.</span></section>

  const firstRow = total ? page * PAGE_SIZE + 1 : 0
  const lastRow = Math.min((page + 1) * PAGE_SIZE, total)

  return <>
    <section className="ws-page-heading"><div><span className="ws-eyebrow">SEGURIDAD Y AUDITORÍA</span><h1>Bitácora de operaciones</h1><p>Consulta quién creó, editó o eliminó un registro, cuándo ocurrió y qué valores cambiaron.</p></div><div className="ws-heading-actions">
      <button className="ws-button ws-button-secondary" disabled={loading || exporting || !total} onClick={() => void exportCsv()}><Download size={16} />{exporting ? 'Exportando…' : 'Exportar CSV'}</button>
      <button className="ws-button ws-button-secondary" disabled={loading} onClick={() => setRefreshKey(value => value + 1)}><RefreshCw size={16} className={loading ? 'ws-spin' : ''} />Actualizar</button>
    </div></section>
    {error && <div className="ws-notice ws-notice-warning" role="alert">{error}{!rangeError && <button className="ws-text-button" type="button" onClick={() => setRefreshKey(value => value + 1)}>Reintentar</button>}</div>}
    {notice && <div className="ws-notice" role="status">{notice}</div>}
    <section className="ws-card">
      <div className="ws-audit-toolbar">
        <div className="ws-audit-filters">
          <label className="ws-audit-field"><Search size={15} /><select value={filters.modulo ?? ''} onChange={event => setFilter('modulo', event.target.value)} aria-label="Filtrar por módulo"><option value="">Todos los módulos</option>{moduleOptions.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          <label className="ws-audit-field"><Activity size={15} /><select value={filters.accion ?? ''} onChange={event => setFilter('accion', event.target.value)} aria-label="Filtrar por acción">{AUDIT_ACTIONS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          <label className="ws-audit-field"><ShieldCheck size={15} /><select value={filters.resultado ?? ''} onChange={event => setFilter('resultado', event.target.value)} aria-label="Filtrar por resultado">{AUDIT_RESULTS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          <label className="ws-audit-field"><CalendarDays size={15} /><span>Desde</span><input type="date" value={filters.desde ?? ''} max={filters.hasta || undefined} onChange={event => setFilter('desde', event.target.value)} aria-label="Desde" /></label>
          <label className="ws-audit-field"><CalendarDays size={15} /><span>Hasta</span><input type="date" value={filters.hasta ?? ''} min={filters.desde || undefined} onChange={event => setFilter('hasta', event.target.value)} aria-label="Hasta" /></label>
          <label className="ws-audit-field"><UserRound size={15} /><input type="search" value={userDraft} onChange={event => setUserDraft(event.target.value)} placeholder="Usuario (correo)" aria-label="Filtrar por usuario" autoComplete="off" /></label>
          <label className="ws-audit-field"><Search size={15} /><input type="search" value={recordDraft} onChange={event => setRecordDraft(event.target.value)} placeholder="Código de registro" aria-label="Filtrar por registro" autoComplete="off" /></label>
        </div>
        <div className="ws-audit-meta">
          <span className="relation-hint">{total} {total === 1 ? 'evento' : 'eventos'} visibles para tu permiso</span>
          {hasFilters && <button className="ws-text-button" type="button" onClick={clearFilters}>Limpiar filtros</button>}
        </div>
      </div>
      <div className={`table-scroll ws-audit-table${loading && entries.length ? ' is-loading' : ''}`} aria-busy={loading}>{loading && !!entries.length && <div className="ws-audit-progress" role="status" aria-label="Cargando eventos" />}<table className="record-table"><thead><tr><th>Fecha y hora</th><th>Usuario</th><th>Módulo</th><th>Acción</th><th>Registro</th><th>Resultado</th><th><span className="sr-only">Detalle</span></th></tr></thead><tbody>
        {entries.map(entry => <tr key={entry.id}>
          <td>{eventTime(entry.createdAt)}</td>
          <td>{entry.email ?? 'Usuario no disponible'}</td>
          <td>{auditModuleLabel(entry.modulo)}</td>
          <td><span className={`status-pill ${auditActionTone(entry.accion)}`}>{auditActionLabel(entry.accion)}</span></td>
          <td><span className="record-id">{entry.registro ?? '—'}</span></td>
          <td><span className={`status-pill ${auditResultTone(entry.resultado)}`}>{auditResultLabel(entry.resultado)}</span></td>
          <td><div className="row-actions"><button className="row-action" type="button" title="Ver qué cambió" aria-label={`Ver cambios del evento ${entry.id}`} onClick={() => setSelected(entry)}><Eye size={15} /></button></div></td>
        </tr>)}
        {!entries.length && !loading && !error && <tr><td colSpan={7}><div className="ws-empty-compact"><ShieldCheck size={26} /><strong>No hay eventos para estos filtros</strong><span>Prueba otro rango de fechas, acción o módulo, o limpia los filtros.</span></div></td></tr>}
        {loading && !entries.length && <tr><td colSpan={7}><div className="ws-empty-compact"><RefreshCw size={20} className="ws-spin" /><strong>Cargando eventos…</strong></div></td></tr>}
      </tbody></table></div>
      <div className="ws-pagination"><span>Mostrando {firstRow}–{lastRow} de {total}</span><nav className="ws-page-numbers" aria-label="Paginación de la bitácora">
        <button className="ws-icon-button" type="button" disabled={page === 0} onClick={() => setPage(value => Math.max(0, value - 1))} aria-label="Página anterior">‹</button>
        {pageWindow(page, pageCount).map((item, index) => item === '…'
          ? <span className="ws-page-gap" key={`gap-${index}`} aria-hidden="true">…</span>
          : <button className={`ws-page-number${item === page ? ' is-current' : ''}`} type="button" key={item} aria-label={`Página ${item + 1}`} aria-current={item === page ? 'page' : undefined} onClick={() => setPage(item)}>{item + 1}</button>)}
        <button className="ws-icon-button" type="button" disabled={page + 1 >= pageCount} onClick={() => setPage(value => Math.min(pageCount - 1, value + 1))} aria-label="Página siguiente">›</button>
      </nav></div>
    </section>
    <p className="relation-hint ws-audit-footnote">La bitácora registra las altas, ediciones y eliminaciones de las tablas de negocio y configuración, con el usuario autenticado y los valores antes y después. También quedan registrados los intentos denegados por falta de permiso y las operaciones que fallan (Resultado «Denegado» o «Fallido»). Las simples consultas no se registran. Las horas se muestran en Lima.</p>
    {selected && <AuditDetailDialog entry={selected} onClose={() => setSelected(null)} />}
  </>
}
