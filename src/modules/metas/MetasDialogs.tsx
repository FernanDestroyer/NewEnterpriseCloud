import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import ConfirmModal from '../../components/ConfirmModal'
import { useDialog } from '../../components/useDialog'
import { friendlyError } from '../../services/records'
import { cargarCatalogo, type OpcionCatalogo } from './db'
import { ALCANCES, ESTADOS_META, INDICADORES } from './rules'
import { ErrorValidacion, type Errores, type MetasService } from './service'
import type { Asignacion, Corte, Meta } from './types'

type Cerrar = { onClose: () => void; onSaved: (mensaje: string) => void }

function Dialog({ title, description, onClose, busy, children }: { title: string; description: string; onClose: () => void; busy?: boolean; children: ReactNode }) {
  const ref = useDialog<HTMLDivElement>(onClose, busy)
  return <div className="modal-backdrop" role="presentation" onMouseDown={event => !busy && event.target === event.currentTarget && onClose()}>
    <div ref={ref} className="ws-dialog ws-platform-dialog" role="dialog" aria-modal="true" aria-label={title}>
      <header className="modal-heading"><div><span className="section-kicker"><i /> METAS Y OBJETIVOS</span><h2>{title}</h2><p>{description}</p></div><button type="button" className="modal-close" onClick={onClose} disabled={busy} aria-label="Cerrar"><X size={17} /></button></header>
      {children}
    </div>
  </div>
}

function Field({ label, error, wide, children }: { label: string; error?: string; wide?: boolean; children: ReactNode }) {
  return <label className={wide ? 'ws-form-wide' : undefined}>{label}{children}{error && <small className="ws-field-error" role="alert">{error}</small>}</label>
}

function Actions({ busy, submitLabel, disabled, onClose }: { busy: boolean; submitLabel: string; disabled?: boolean; onClose: () => void }) {
  return <div className="ws-fleet-actions">
    <button type="button" className="ws-button ws-button-secondary" onClick={onClose} disabled={busy}>Cancelar</button>
    <button type="submit" className="ws-button" disabled={disabled} aria-disabled={busy || disabled}>{busy ? 'Guardando…' : submitLabel}</button>
  </div>
}

function reportar(reason: unknown, setErrores: (errores: Errores) => void, setMensaje: (mensaje: string) => void) {
  if (reason instanceof ErrorValidacion) {
    setErrores(reason.campos)
    setMensaje(reason.message)
    return
  }
  setMensaje(friendlyError(reason))
}

const Aviso = ({ mensaje }: { mensaje: string }) => mensaje ? <div className="ws-notice ws-notice-warning" role="alert"><AlertTriangle size={17} /><span>{mensaje}</span></div> : null

// ---------- Meta (8.1 Definición de metas) ----------
export function MetaDialog({ servicio, item, onClose, onSaved }: Cerrar & { servicio: MetasService; item?: Meta }) {
  const [form, setForm] = useState({
    codigo: item?.codigo ?? '', nombre: item?.nombre ?? '', indicador: item?.indicador ?? 'importe',
    valorObjetivo: item ? String(item.valorObjetivo) : '', desde: item?.desde ?? '', hasta: item?.hasta ?? '',
    responsable: item?.responsable ?? '', estado: item?.estado ?? 'vigente',
  })
  const [errores, setErrores] = useState<Errores>({})
  const [mensaje, setMensaje] = useState('')
  const [busy, setBusy] = useState(false)
  const cambiar = <K extends keyof typeof form>(campo: K, valor: (typeof form)[K]) => setForm(actual => ({ ...actual, [campo]: valor }))

  async function enviar(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true); setErrores({}); setMensaje('')
    try {
      await servicio.guardarMeta({ ...form, valorObjetivo: Number(form.valorObjetivo), responsable: form.responsable }, item)
      onSaved(item ? 'Meta actualizada.' : 'Meta registrada.')
    } catch (reason) { reportar(reason, setErrores, setMensaje) } finally { setBusy(false) }
  }

  return <Dialog title={item ? 'Editar meta' : 'Nueva meta'} description="Define el objetivo, su indicador y la vigencia del periodo. El valor objetivo se reparte entre las asignaciones." onClose={onClose} busy={busy}>
    <form className="ws-form" onSubmit={event => void enviar(event)} noValidate>
      <Aviso mensaje={mensaje} />
      <div className="ws-form-grid">
        <Field label="Código" error={errores.codigo}><input value={form.codigo} onChange={event => cambiar('codigo', event.target.value)} placeholder="Se genera automáticamente" maxLength={16} autoComplete="off" data-autofocus /></Field>
        <Field label="Indicador" error={errores.indicador}><select value={form.indicador} onChange={event => cambiar('indicador', event.target.value as typeof form.indicador)}>{INDICADORES.map(opcion => <option key={opcion.value} value={opcion.value}>{opcion.label}</option>)}</select></Field>
        <Field label="Nombre" error={errores.nombre} wide><input value={form.nombre} onChange={event => cambiar('nombre', event.target.value)} maxLength={80} placeholder="P. ej. Ventas importe primer trimestre" /></Field>
        <Field label={form.indicador === 'importe' ? 'Valor objetivo (S/)' : 'Valor objetivo (unidades)'} error={errores.valorObjetivo}><input type="number" min={0.01} step={form.indicador === 'unidades' ? 1 : 0.01} value={form.valorObjetivo} onChange={event => cambiar('valorObjetivo', event.target.value)} /></Field>
        <Field label="Responsable (opcional)"><input value={form.responsable} onChange={event => cambiar('responsable', event.target.value)} maxLength={80} /></Field>
        <Field label="Inicio del periodo" error={errores.desde}><input type="date" value={form.desde} onChange={event => cambiar('desde', event.target.value)} /></Field>
        <Field label="Cierre del periodo" error={errores.hasta}><input type="date" value={form.hasta} onChange={event => cambiar('hasta', event.target.value)} /></Field>
        <Field label="Estado" error={errores.estado}><select value={form.estado} onChange={event => cambiar('estado', event.target.value as typeof form.estado)}>{(Object.keys(ESTADOS_META) as (keyof typeof ESTADOS_META)[]).map(estado => <option key={estado} value={estado}>{ESTADOS_META[estado].label}</option>)}</select></Field>
      </div>
      <Actions busy={busy} submitLabel={item ? 'Guardar cambios' : 'Registrar meta'} onClose={onClose} />
    </form>
  </Dialog>
}

// ---------- Asignación (8.2/8.3/8.4: metas por vendedor, sucursal o producto) ----------
export function AsignacionDialog({ servicio, metas, item, onClose, onSaved }: Cerrar & { servicio: MetasService; metas: Meta[]; item?: Asignacion }) {
  const [form, setForm] = useState({
    metaId: item?.metaId ?? metas[0]?.id ?? '', alcance: item?.alcance ?? 'vendedor',
    objetivo: item?.objetivo ?? '', valorObjetivo: item ? String(item.valorObjetivo) : '', estado: item?.estado ?? 'activa',
    referenciaId: item?.referenciaId ?? '',
  })
  const [catalogo, setCatalogo] = useState<OpcionCatalogo[]>([])
  useEffect(() => {
    let vigente = true
    setCatalogo([])
    void cargarCatalogo(form.alcance).then(lista => { if (vigente) setCatalogo(lista) })
    return () => { vigente = false }
  }, [form.alcance])
  const [errores, setErrores] = useState<Errores>({})
  const [mensaje, setMensaje] = useState('')
  const [busy, setBusy] = useState(false)
  const cambiar = <K extends keyof typeof form>(campo: K, valor: (typeof form)[K]) => setForm(actual => ({ ...actual, [campo]: valor }))
  const alcanceInfo = ALCANCES.find(opcion => opcion.value === form.alcance)
  const sinMetas = !metas.length

  async function enviar(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true); setErrores({}); setMensaje('')
    try {
      await servicio.guardarAsignacion({ ...form, referenciaId: form.referenciaId || null, valorObjetivo: Number(form.valorObjetivo) }, item)
      onSaved(item ? 'Asignación actualizada.' : 'Asignación registrada.')
    } catch (reason) { reportar(reason, setErrores, setMensaje) } finally { setBusy(false) }
  }

  return <Dialog title={item ? 'Editar asignación' : 'Nueva asignación'} description="Asigna la meta a un vendedor, sucursal o producto con su cuota del periodo." onClose={onClose} busy={busy}>
    <form className="ws-form" onSubmit={event => void enviar(event)} noValidate>
      <Aviso mensaje={sinMetas ? 'Primero registra una meta vigente.' : mensaje} />
      <div className="ws-form-grid">
        <Field label="Meta" error={errores.metaId} wide><select value={form.metaId} onChange={event => cambiar('metaId', event.target.value)} disabled={sinMetas} data-autofocus>{metas.map(meta => <option key={meta.id} value={meta.id}>{meta.codigo} · {meta.nombre}</option>)}</select></Field>
        <Field label="Alcance" error={errores.alcance}><select value={form.alcance} onChange={event => setForm(actual => ({ ...actual, alcance: event.target.value as typeof form.alcance, referenciaId: '', objetivo: '' }))}>{ALCANCES.map(opcion => <option key={opcion.value} value={opcion.value}>{opcion.label}</option>)}</select></Field>
        {catalogo.length > 0
          ? <Field label={alcanceInfo?.label ?? 'Objetivo'} error={errores.objetivo}><select value={form.referenciaId} onChange={event => { const elegido = catalogo.find(opcion => opcion.id === event.target.value); setForm(actual => ({ ...actual, referenciaId: event.target.value, objetivo: elegido?.nombre ?? actual.objetivo })) }}>
              <option value="">{form.objetivo && !form.referenciaId ? `${form.objetivo} (sin enlazar)` : 'Elige de la lista…'}</option>
              {catalogo.map(opcion => <option key={opcion.id} value={opcion.id}>{opcion.nombre}</option>)}
            </select></Field>
          : <Field label={alcanceInfo?.label ?? 'Objetivo'} error={errores.objetivo}><input value={form.objetivo} onChange={event => setForm(actual => ({ ...actual, objetivo: event.target.value, referenciaId: '' }))} maxLength={80} placeholder={alcanceInfo?.placeholder} /></Field>}
        <Field label="Cuota asignada" error={errores.valorObjetivo}><input type="number" min={0.01} step={0.01} value={form.valorObjetivo} onChange={event => cambiar('valorObjetivo', event.target.value)} /></Field>
        <Field label="Estado" error={errores.estado}><select value={form.estado} onChange={event => cambiar('estado', event.target.value as typeof form.estado)}><option value="activa">Activa</option><option value="inactiva">Inactiva</option></select></Field>
      </div>
      <Actions busy={busy} submitLabel={item ? 'Guardar cambios' : 'Registrar asignación'} onClose={onClose} disabled={sinMetas} />
    </form>
  </Dialog>
}

// ---------- Corte de avance (8.5 Avance de metas) ----------
/** Fecha de corte sugerida: hoy si cae dentro del periodo de la meta; si la meta ya terminó, su último día; si aún no empieza, vacía. */
function fechaSugerida(meta: Meta | undefined, hoy: string): string {
  if (!meta) return hoy
  if (hoy < meta.desde) return ''
  return hoy > meta.hasta ? meta.hasta : hoy
}

export function CorteDialog({ servicio, asignaciones, metas, asignacion, hayAutomaticas = false, onClose, onSaved }: Cerrar & { servicio: MetasService; asignaciones: Asignacion[]; metas: Meta[]; asignacion?: Asignacion; hayAutomaticas?: boolean }) {
  const hoy = servicio.hoy
  const metaDe = (asignacionId: string) => metas.find(meta => meta.id === asignaciones.find(item => item.id === asignacionId)?.metaId)
  // Si no se eligió una asignación, se propone la primera cuya meta ya empezó (las demás aún no admiten cortes).
  const inicial = asignacion ?? asignaciones.find(item => { const meta = metas.find(m => m.id === item.metaId); return !meta || meta.desde <= hoy }) ?? asignaciones[0]
  const [form, setForm] = useState({
    asignacionId: inicial?.id ?? '', fecha: fechaSugerida(inicial ? metaDe(inicial.id) : undefined, hoy), valorAcumulado: '', fuente: '',
  })
  const [errores, setErrores] = useState<Errores>({})
  const [mensaje, setMensaje] = useState('')
  const [busy, setBusy] = useState(false)
  const cambiar = <K extends keyof typeof form>(campo: K, valor: (typeof form)[K]) => setForm(actual => ({ ...actual, [campo]: valor }))
  const sinAsignaciones = !asignaciones.length
  const meta = metaDe(form.asignacionId)
  const noInicia = !!meta && hoy < meta.desde
  const maxFecha = meta && meta.hasta < hoy ? meta.hasta : hoy
  const indicador = meta?.indicador ?? 'importe'

  function elegirAsignacion(id: string) {
    setForm(actual => ({ ...actual, asignacionId: id, fecha: fechaSugerida(metaDe(id), hoy) }))
    setErrores({}); setMensaje('')
  }

  async function enviar(event: FormEvent) {
    event.preventDefault()
    if (busy || noInicia) return
    setBusy(true); setErrores({}); setMensaje('')
    try {
      await servicio.guardarCorte({ ...form, valorAcumulado: Number(form.valorAcumulado) })
      onSaved('Corte de avance registrado.')
    } catch (reason) { reportar(reason, setErrores, setMensaje) } finally { setBusy(false) }
  }

  return <Dialog title="Registrar corte de avance" description="Anota cuánto lleva logrado una asignación a una fecha. Es el total acumulado desde el inicio de la meta, no solo lo de ese día." onClose={onClose} busy={busy}>
    <form className="ws-form" onSubmit={event => void enviar(event)} noValidate>
      <Aviso mensaje={sinAsignaciones ? (hayAutomaticas ? 'Todas las asignaciones se calculan solas con las ventas completadas; no necesitan cortes manuales.' : 'Primero registra una asignación activa.') : mensaje} />
      {hayAutomaticas && !sinAsignaciones && <p className="ws-seg-hint"><AlertTriangle size={14} />Aquí solo aparecen las asignaciones que no se pudieron enlazar con ventas. Las demás se calculan solas.</p>}
      {noInicia && meta && <div className="ws-notice" role="status"><AlertTriangle size={18} /><span><b>{meta.codigo} empieza el {meta.desde}.</b> Los cortes se registran con fechas que ya ocurrieron (hasta hoy, {hoy}), así que podrás cargar el primero desde esa fecha. Para probar ahora, elige una asignación de una meta que ya haya empezado o adelanta el inicio de la meta en «Definición».</span></div>}
      <div className="ws-form-grid">
        <Field label="Asignación" error={errores.asignacionId} wide><select value={form.asignacionId} onChange={event => elegirAsignacion(event.target.value)} disabled={sinAsignaciones} data-autofocus>{asignaciones.map(item => { const m = metas.find(x => x.id === item.metaId); return <option key={item.id} value={item.id}>{m ? `${m.codigo} · ` : ''}{item.objetivo} ({ALCANCES.find(a => a.value === item.alcance)?.label ?? item.alcance}){m && m.desde > hoy ? ' — aún no inicia' : ''}</option> })}</select></Field>
        <Field label={meta ? `Fecha de corte (entre ${meta.desde} y ${maxFecha < meta.desde ? meta.desde : maxFecha})` : 'Fecha de corte'} error={errores.fecha}><input type="date" value={form.fecha} min={meta?.desde} max={maxFecha} disabled={noInicia} onChange={event => cambiar('fecha', event.target.value)} /></Field>
        <Field label={indicador === 'importe' ? 'Total vendido hasta esa fecha (S/)' : 'Total de unidades hasta esa fecha'} error={errores.valorAcumulado}><input type="number" inputMode="decimal" min={0} step={indicador === 'importe' ? 0.01 : 1} value={form.valorAcumulado} disabled={noInicia} onChange={event => cambiar('valorAcumulado', event.target.value)} placeholder={indicador === 'importe' ? 'Ej. 8000' : 'Ej. 120'} /></Field>
        <Field label="Fuente del dato (opcional)" error={errores.fuente} wide><input value={form.fuente} maxLength={120} disabled={noInicia} onChange={event => cambiar('fuente', event.target.value)} placeholder="P. ej. Reporte de ventas del turno" /></Field>
      </div>
      <Actions busy={busy} submitLabel="Registrar corte" onClose={onClose} disabled={sinAsignaciones || noInicia} />
    </form>
  </Dialog>
}

// ---------- Eliminaciones ----------
export function ConfirmarEliminar({ titulo, texto, busyLabel, onClose, onConfirm }: { titulo: string; texto: string; busyLabel: string; onClose: () => void; onConfirm: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const confirmar = async () => {
    setBusy(true)
    try { await onConfirm(); onClose() } finally { setBusy(false) }
  }
  return <ConfirmModal title={titulo} message={texto} confirmLabel={busyLabel} busy={busy} onCancel={onClose} onConfirm={() => void confirmar()} />
}
