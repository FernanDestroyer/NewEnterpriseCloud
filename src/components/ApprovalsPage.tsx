import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AlertTriangle, Check, ChevronLeft, ChevronRight, ClipboardCheck, Clock3, RefreshCw, ShieldCheck, Workflow, X } from 'lucide-react'
import { moneyCurrency } from '../data/helpers'
import { useAuth } from '../context/AuthContext'
import { useRecords } from '../context/RecordsContext'
import { decideApproval, fetchApprovalEvents, fetchApprovals, type ApprovalEvent, type ApprovalFilter, type ApprovalRequest } from '../services/approvals'
import { PageHeader } from './ui/PageHeader'
import ApprovalRulesPanel from './ApprovalRulesPanel'
import ConfirmModal from './ConfirmModal'

const PAGE_SIZE = 25
type JsonObject = Record<string, unknown>
function object(value: unknown): JsonObject { return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {} }
function text(value: unknown, fallback = '—') { return value === null || value === undefined || value === '' ? fallback : String(value) }
function number(value: unknown) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0 }
function currencyCode(value: unknown): 'PEN' | 'USD' { return value === 'USD' ? 'USD' : 'PEN' }
function dateTime(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}
function stateLabel(state: ApprovalRequest['estado']) {
  return state === 'pending' ? 'Pendiente' : state === 'approved' ? 'Aprobada' : state === 'rejected' ? 'Rechazada' : 'Requiere actualizar'
}
function kindLabel(kind: ApprovalRequest['tipo']) {
  return kind === 'purchase_manual' ? 'Orden manual' : kind === 'purchase_sourcing' ? 'Orden desde oferta' : kind === 'purchase_contract' ? 'Liberación de contrato' : 'Ajuste de conteo físico'
}
function summary(request: ApprovalRequest) {
  const snapshot = request.snapshot
  const sourcingRequest = object(snapshot.solicitud)
  const offer = object(snapshot.oferta)
  const pairs: Array<[string, string]> = []
  if (request.tipo === 'purchase_manual') {
    pairs.push(['Proveedor', text(snapshot.proveedor_nombre, text(snapshot.proveedor_id))], ['Detalle', text(snapshot.detalle)], ['Moneda', text(snapshot.moneda)], ['Monto propuesto', moneyCurrency(number(snapshot.monto_manual), currencyCode(snapshot.moneda))], ['Fecha límite', text(snapshot.fecha_limite)])
  } else if (request.tipo === 'purchase_sourcing') {
    pairs.push(['Solicitud', text(sourcingRequest.codigo, text(sourcingRequest.id))], ['Proveedor ofertante', text(offer.proveedor_nombre, text(offer.proveedor_id))], ['Moneda de la oferta', text(offer.moneda)], ['Total de oferta', moneyCurrency(number(offer.total), currencyCode(offer.moneda))], ['Total referencial en PEN', moneyCurrency(number(offer.total_pen), 'PEN')])
  } else if (request.tipo === 'purchase_contract') {
    pairs.push(['Contrato', text(snapshot.contrato_id)], ['Proveedor', text(snapshot.proveedor_nombre)], ['Versión', text(snapshot.version_id)], ['Moneda', text(snapshot.moneda)], ['Detalle', text(snapshot.detalle)], ['Fecha límite', text(snapshot.fecha_limite)])
  } else {
    pairs.push(['Almacén', text(snapshot.almacen, text(snapshot.almacen_id))], ['Motivo', text(snapshot.motivo)], ['Líneas contadas', text(snapshot.cantidad_lineas)], ['Diferencias', text(snapshot.diferencias)], ['Variación neta', text(snapshot.variacion_unidades_neta)], ['Variación absoluta', text(snapshot.variacion_unidades_absoluta)])
  }
  return pairs
}
function lineRows(request: ApprovalRequest): JsonObject[] {
  const lines = request.snapshot.lineas
  return Array.isArray(lines) ? lines.map(object) : []
}

export default function ApprovalsPage() {
  const { can, profile } = useAuth()
  const { reload } = useRecords()
  const location = useLocation()
  const navigate = useNavigate()
  const canReview = can('approvals', 'aprobar') && (profile?.rol === 'Gerente' || profile?.rol === 'Administrador')
  const canView = can('approvals', 'ver') || canReview
  const [filter, setFilter] = useState<ApprovalFilter>('pending')
  const activeTab: 'pending' | 'history' | 'rules' = location.hash === '#reglas' ? 'rules' : filter
  const selectTab = (nextTab: 'pending' | 'history' | 'rules') => {
    if (nextTab === 'rules') {
      navigate({ pathname: location.pathname, hash: '#reglas' }, { replace: true })
      return
    }
    setFilter(nextTab)
    setPage(0)
    setReason('')
    if (location.hash === '#reglas') {
      navigate({ pathname: location.pathname, hash: '' }, { replace: true })
    }
  }
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState<ApprovalRequest[]>([])
  const [total, setTotal] = useState(0)
  const [selectedId, setSelectedId] = useState('')
  const [events, setEvents] = useState<ApprovalEvent[]>([])
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(true)
  const [eventsLoading, setEventsLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [eventError, setEventError] = useState('')
  const [notice, setNotice] = useState('')
  const [confirmingApproval, setConfirmingApproval] = useState(false)
  const selected = useMemo(() => rows.find(row => row.id === selectedId) ?? null, [rows, selectedId])
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const result = await fetchApprovals(filter, page)
      setRows(result.rows); setTotal(result.total)
      setSelectedId(current => result.rows.some(row => row.id === current) ? current : result.rows[0]?.id ?? '')
    } catch (cause) {
      setRows([]); setTotal(0); setSelectedId('')
      setError((cause as { message?: string } | null)?.message ?? 'No se pudieron consultar las solicitudes.')
    } finally { setLoading(false) }
  }, [filter, page])

  useEffect(() => { if (canView) void load() }, [canView, load])

  useEffect(() => {
    if (!selectedId) { setEvents([]); setEventError(''); return }
    let active = true
    setEventsLoading(true); setEventError('')
    void fetchApprovalEvents(selectedId).then(result => { if (active) setEvents(result) })
      .catch(cause => { if (active) setEventError((cause as { message?: string } | null)?.message ?? 'No se pudo consultar la bitácora.') })
      .finally(() => { if (active) setEventsLoading(false) })
    return () => { active = false }
  }, [selectedId])

  const decide = async (approve: boolean, confirmed = false) => {
    if (!selected || selected.estado !== 'pending' || busy || !canReview) return
    if (selected.solicitante_id === profile?.id) return setError('La persona solicitante no puede aprobar su propia solicitud.')
    if (!approve && reason.trim().length < 3) return setError('Escribe un motivo de rechazo de al menos 3 caracteres.')
    if (approve && !confirmed) { setError(''); setConfirmingApproval(true); return }
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await decideApproval(selected.id, approve, reason)
      setNotice(result.estado === 'approved'
        ? `Aprobación registrada. Resultado: ${result.resultado_id ?? 'procesado'}.`
        : result.estado === 'stale'
          ? 'El documento cambió mientras esperaba revisión. La solicitud se cerró como obsoleta; consulta el motivo e inicia una nueva si corresponde.'
          : 'Solicitud rechazada. El motivo quedó registrado en la bitácora.')
      setReason('')
      if (result.estado === 'approved') await reload()
      await load()
    } catch (cause) {
      setError((cause as { message?: string } | null)?.message ?? 'No se pudo decidir la solicitud.')
    } finally { setBusy(false) }
  }

  if (!canView) return <section className="ws-card ws-empty-compact"><ShieldCheck size={28} /><strong>Acceso restringido</strong><span>Tu rol no puede consultar la bandeja de aprobaciones.</span></section>

  return <section className="approval-page">
    {confirmingApproval && selected && selected.estado === 'pending' && <ConfirmModal
      tone="primary"
      title="Aprobar solicitud"
      message={selected.tipo === 'physical_count'
        ? 'Se aplicarán los ajustes del conteo al stock y quedarán trazados en el Kardex. Todo ocurre en una sola operación.'
        : 'Se emitirá la orden de compra con estos datos. Todo ocurre en una sola operación y la decisión queda registrada con tu nombre.'}
      confirmLabel="Sí, aprobar"
      busy={busy}
      onCancel={() => setConfirmingApproval(false)}
      onConfirm={async () => { setConfirmingApproval(false); await decide(true, true) }}
    >
      <dl className="ec-approval-confirm-summary">
        <div><dt>Tipo</dt><dd>{kindLabel(selected.tipo)}</dd></div>
        {summary(selected).filter(([label]) => label !== 'Detalle').slice(0, 4).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      </dl>
    </ConfirmModal>}
    <PageHeader
      icon={ClipboardCheck}
      section="Notificaciones y aprobaciones"
      title="Bandeja de aprobaciones"
      description="Las decisiones quedan registradas. Quien solicita no puede aprobar su propia orden ni su propio conteo."
      actions={<button type="button" className="ws-button ws-button-secondary" disabled={loading} onClick={() => void load()}><RefreshCw size={16} />Actualizar</button>}
    />

    <div className="approval-tabs" role="tablist" aria-label="Solicitudes de aprobación">
      <button type="button" role="tab" aria-selected={activeTab === 'pending'} className={activeTab === 'pending' ? 'is-active' : ''} onClick={() => selectTab('pending')}><Clock3 size={15} />Pendientes</button>
      <button type="button" role="tab" aria-selected={activeTab === 'history'} className={activeTab === 'history' ? 'is-active' : ''} onClick={() => selectTab('history')}><ClipboardCheck size={15} />Historial</button>
      <button type="button" role="tab" aria-selected={activeTab === 'rules'} className={activeTab === 'rules' ? 'is-active' : ''} onClick={() => selectTab('rules')}><Workflow size={15} />Reglas y flujos</button>
      <span>{activeTab === 'rules' ? 'Políticas de aprobación vigentes' : `${total} ${filter === 'pending' ? 'pendientes visibles' : 'decisiones registradas'}`}</span>
    </div>

    {error && <div className="ws-notice ws-notice-warning" role="alert"><AlertTriangle size={16} />{error}<button className="ws-text-button" type="button" onClick={() => void load()}>Reintentar</button></div>}
    {notice && <div className="ws-notice ws-notice-info" role="status"><Check size={16} />{notice}</div>}

    {activeTab === 'rules' && (
      <section className="ws-card ec-approval-rules" role="tabpanel" aria-label="Workflows y reglas de aprobación">
        <div className="ws-card-heading">
          <div>
            <h2>Reglas y flujos de aprobación</h2>
            <p>Controles internos aplicados automáticamente antes de comprometer stock, compras o devoluciones.</p>
          </div>
          <span className="status-pill green">Activos</span>
        </div>
        <ApprovalRulesPanel canEdit={canReview} />
        <div className="ec-approval-rules-grid">
          <article className="ec-approval-rule-card">
            <strong>Segregación de funciones</strong>
            <p>Quien registra una solicitud, orden de compra o conteo físico no puede aprobarlo ni rechazarlo.</p>
            <small>Roles habilitados: Gerente y Administrador con permiso de aprobación.</small>
          </article>
          <article className="ec-approval-rule-card">
            <strong>Órdenes de compra</strong>
            <p>Las órdenes que requieren validación quedan en estado Pendiente antes de su recepción o pago. Las que quedan bajo el umbral configurado arriba se emiten directamente y se registran en el historial.</p>
            <small>Estado inicial: Pendiente · Decisión obligatoria con motivo en rechazos.</small>
          </article>
          <article className="ec-approval-rule-card">
            <strong>Conteos de inventario físico</strong>
            <p>Los cierres de inventario físico con diferencias pasan a revisión antes de ajustar existencias.</p>
            <small>Al aprobarse se generan los ajustes trazables en Kardex.</small>
          </article>
          <article className="ec-approval-rule-card">
            <strong>Trazabilidad y avisos</strong>
            <p>Cada decisión notifica en tiempo real en Centro de alertas y queda auditada en Bitácora.</p>
            <small>Consulta todas las resoluciones emitidas en la pestaña Historial.</small>
          </article>
        </div>
      </section>
    )}

    <div className="approval-layout" hidden={activeTab === 'rules'}>
      <section className="ws-card approval-list" aria-label="Solicitudes">
        <div className="approval-list-heading"><div><strong>{filter === 'pending' ? 'Por revisar' : 'Historial'}</strong><small>Visibilidad según tu rol y permisos.</small></div>{loading && <RefreshCw size={16} className="ws-spin" />}</div>
        {!loading && rows.length === 0 && <div className="ws-empty-compact"><ClipboardCheck size={25} /><strong>{filter === 'pending' ? 'No hay solicitudes pendientes' : 'Todavía no hay decisiones'}</strong><span>{filter === 'pending' ? 'Las nuevas solicitudes aparecerán aquí.' : 'Las aprobaciones y rechazos aparecerán aquí.'}</span></div>}
        <div className="approval-request-list">{rows.map(row => <button type="button" key={row.id} className={`approval-request-item ${selectedId === row.id ? 'is-selected' : ''}`} onClick={() => { setSelectedId(row.id); setReason(''); setError('') }}>
          <span className={`approval-state approval-state-${row.estado}`}>{stateLabel(row.estado)}</span><strong>{kindLabel(row.tipo)}</strong><small>{row.solicitante_id === profile?.id ? 'Solicitada por ti' : `Solicitante · ${row.solicitante_id.slice(0, 8)}`}</small><small>{dateTime(row.creado_en)}</small>
        </button>)}</div>
        <div className="approval-pagination"><span>Página {page + 1} de {pageCount}</span><div><button className="ws-icon-button" type="button" aria-label="Página anterior" disabled={page === 0 || loading} onClick={() => setPage(value => Math.max(0, value - 1))}><ChevronLeft size={15} /></button><button className="ws-icon-button" type="button" aria-label="Página siguiente" disabled={(page + 1) * PAGE_SIZE >= total || loading} onClick={() => setPage(value => value + 1)}><ChevronRight size={15} /></button></div></div>
      </section>

      <section className="ws-card approval-detail" aria-label="Detalle de solicitud">
        {!selected ? <div className="ws-empty-compact"><ClipboardCheck size={28} /><strong>Selecciona una solicitud</strong><span>El detalle mostrará el documento y su historial.</span></div> : <>
          <header className="approval-detail-heading"><div><span className="ws-eyebrow">{kindLabel(selected.tipo)}</span><h2>Solicitud {selected.id.slice(0, 8)}</h2><p>Enviada {dateTime(selected.creado_en)} · Solicitante {selected.solicitante_id}</p></div><span className={`approval-state approval-state-${selected.estado}`}>{stateLabel(selected.estado)}</span></header>
          <div className="approval-summary-grid">{summary(selected).map(([label, value]) => <div key={label}><small>{label}</small><strong>{value}</strong></div>)}</div>
          {lineRows(selected).length > 0 && <div className="approval-lines"><h3>Detalle de líneas</h3><div className="table-scroll"><table className="record-table"><thead><tr><th>Artículo</th>{selected.tipo === 'physical_count' ? <><th>Stock sistema</th><th>Stock contado</th><th>Diferencia</th><th>Costo de sobrante</th></> : <><th>Cantidad</th><th>Precio unitario</th><th>Impuesto</th></>}</tr></thead><tbody>{lineRows(selected).map((line, index) => <tr key={`${text(line.producto_id, 'linea')}-${index}`}>
            <td><strong>{text(line.producto, text(line.descripcion, text(line.producto_id)))}</strong>{line.descripcion && line.producto ? <small>{text(line.descripcion)}</small> : null}</td>
            {selected.tipo === 'physical_count' ? <><td>{text(line.stock_sistema)}</td><td>{text(line.stock_contado)}</td><td>{text(line.diferencia)}</td><td>{line.costo_entrada !== null && line.costo_entrada !== undefined ? moneyCurrency(number(line.costo_entrada), 'PEN') : '—'}</td></> : <><td>{text(line.cantidad)}</td><td>{line.precio_unitario !== undefined ? moneyCurrency(number(line.precio_unitario), currencyCode(object(selected.snapshot.oferta).moneda ?? selected.snapshot.moneda)) : line.precio !== undefined ? moneyCurrency(number(line.precio), currencyCode(selected.snapshot.moneda)) : '—'}</td><td>{line.tratamiento_tributario ? `${text(line.tratamiento_tributario)} · ${text(line.tasa_tributaria)}%` : '—'}</td></>}
          </tr>)}</tbody></table></div></div>}
          {selected.estado === 'pending' && canReview && <div className="approval-decision">
            {selected.solicitante_id === profile?.id
              ? <div className="ws-notice ws-notice-warning"><AlertTriangle size={15} />No puedes aprobar una solicitud que enviaste tú. Otro Gerente o Administrador debe revisarla.</div>
              : <>
                <label>Motivo del rechazo<textarea className="ws-control" rows={3} maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} placeholder="Obligatorio si rechazas; explica qué debe corregirse." /></label>
                <div className="ws-heading-actions"><button type="button" className="ws-button ws-button-secondary" disabled={busy || reason.trim().length < 3} onClick={() => void decide(false)}><X size={15} />Rechazar con motivo</button><button type="button" className="ws-button" disabled={busy} onClick={() => void decide(true)}><Check size={15} />{busy ? 'Procesando…' : 'Aprobar'}</button></div>
              </>}
          </div>}
          {selected.motivo_decision && <div className="ws-notice ws-notice-warning"><AlertTriangle size={15} />Motivo registrado: {selected.motivo_decision}</div>}
          {selected.resultado_id && <div className="approval-result"><Check size={16} /><span>Documento generado / conteo aplicado</span><code>{selected.resultado_id}</code></div>}
          <div className="approval-events"><h3>Historial de decisiones</h3>{eventsLoading ? <small>Consultando bitácora…</small> : eventError ? <div className="ws-notice ws-notice-warning">{eventError}</div> : events.length ? events.map(event => <article key={event.id}><span className={`approval-event-dot approval-event-${event.evento}`} /><div><strong>{event.evento === 'solicitada' ? 'Solicitud enviada' : event.evento === 'aprobada' ? 'Aprobada' : event.evento === 'rechazada' ? 'Rechazada' : 'Documento actualizado'}</strong><small>{dateTime(event.creado_en)} · actor {event.actor_id.slice(0, 8)}</small>{event.motivo && <p>{event.motivo}</p>}</div></article>) : <small>Sin eventos registrados.</small>}</div>
        </>}
      </section>
    </div>
  </section>
}
