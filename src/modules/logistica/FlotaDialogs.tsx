import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { AlertTriangle, Info, X } from 'lucide-react'
import ConfirmModal from '../../components/ConfirmModal'
import { useDialog } from '../../components/useDialog'
import { friendlyError } from '../../services/records'
import { ErrorValidacion, etiquetaVehiculo, type FlotaService } from './flotaService'
import { ahoraLima, LICENCIA_CATEGORIAS, sumarHoras, VEHICULO_TIPOS, type Errores, type ResultadoAsignacion } from './rules'
import type { Asignacion, Conductor, Vehiculo } from './types'

type Cerrar = { onClose: () => void; onSaved: (mensaje: string) => void }

export function Dialog({ title, description, onClose, busy, ancho, children }: { title: string; description: string; onClose: () => void; busy?: boolean; ancho?: boolean; children: ReactNode }) {
  const ref = useDialog<HTMLDivElement>(onClose, busy)
  return <div className="modal-backdrop" role="presentation" onMouseDown={event => !busy && event.target === event.currentTarget && onClose()}>
    <div ref={ref} className={`ws-dialog ws-fleet-dialog${ancho ? ' ws-dispatch-dialog' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
      <header className="modal-heading"><div><span className="section-kicker"><i /> LOGÍSTICA Y TRANSPORTE</span><h2>{title}</h2><p>{description}</p></div><button type="button" className="modal-close" onClick={onClose} disabled={busy} aria-label="Cerrar"><X size={17} /></button></header>
      {children}
    </div>
  </div>
}

export function Field({ label, error, wide, children }: { label: string; error?: string; wide?: boolean; children: ReactNode }) {
  return <label className={wide ? 'ws-form-wide' : undefined}>{label}{children}{error && <small className="ws-field-error" role="alert">{error}</small>}</label>
}

function Actions({ busy, submitLabel, disabled, onClose }: { busy: boolean; submitLabel: string; disabled?: boolean; onClose: () => void }) {
  return <div className="ws-fleet-actions">
    <button type="button" className="ws-button ws-button-secondary" onClick={onClose} disabled={busy}>Cancelar</button>
    <button type="submit" className="ws-button" disabled={disabled} aria-disabled={busy || disabled}>{busy ? 'Guardando…' : submitLabel}</button>
  </div>
}

export function reportar(reason: unknown, setErrores: (errores: Errores) => void, setMensaje: (mensaje: string) => void) {
  if (reason instanceof ErrorValidacion) {
    setErrores(reason.campos)
    setMensaje(reason.message)
    return
  }
  setMensaje(friendlyError(reason))
}

export const Aviso = ({ mensaje }: { mensaje: string }) => mensaje ? <div className="ws-notice ws-notice-warning" role="alert"><AlertTriangle size={17} /><span>{mensaje}</span></div> : null

// ---------- Vehículo ----------
export function VehiculoDialog({ servicio, item, onClose, onSaved }: Cerrar & { servicio: FlotaService; item?: Vehiculo }) {
  const [form, setForm] = useState({
    placa: item?.placa ?? '', tipo: item?.tipo ?? 'furgoneta', marca: item?.marca ?? '', modelo: item?.modelo ?? '',
    capacidadKg: item ? String(item.capacidadKg) : '', propiedad: item?.propiedad ?? 'propio', transportista: item?.transportista ?? '',
    soatVence: item?.soatVence ?? '', revisionVence: item?.revisionVence ?? '', estado: item?.estado ?? 'activo', observaciones: item?.observaciones ?? '',
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
      await servicio.guardarVehiculo({ ...form, capacidadKg: Number(form.capacidadKg) }, item)
      onSaved(item ? 'Vehículo actualizado.' : 'Vehículo registrado.')
    } catch (reason) { reportar(reason, setErrores, setMensaje) } finally { setBusy(false) }
  }

  return <Dialog title={item ? 'Editar vehículo' : 'Nuevo vehículo'} description="Registra la unidad con su capacidad y los vencimientos de SOAT y revisión técnica." onClose={onClose} busy={busy}>
    <form className="ws-form" onSubmit={event => void enviar(event)} noValidate>
      <Aviso mensaje={mensaje} />
      <div className="ws-form-grid">
        <Field label="Placa" error={errores.placa}><input value={form.placa} onChange={event => cambiar('placa', event.target.value)} placeholder="ABC-123" maxLength={8} autoComplete="off" data-autofocus /></Field>
        <Field label="Tipo" error={errores.tipo}><select value={form.tipo} onChange={event => cambiar('tipo', event.target.value as typeof form.tipo)}>{VEHICULO_TIPOS.map(tipo => <option key={tipo.value} value={tipo.value}>{tipo.label}</option>)}</select></Field>
        <Field label="Marca" error={errores.marca}><input value={form.marca} onChange={event => cambiar('marca', event.target.value)} maxLength={40} /></Field>
        <Field label="Modelo" error={errores.modelo}><input value={form.modelo} onChange={event => cambiar('modelo', event.target.value)} maxLength={40} /></Field>
        <Field label="Capacidad de carga (kg)" error={errores.capacidadKg}><input type="number" min={1} step={1} value={form.capacidadKg} onChange={event => cambiar('capacidadKg', event.target.value)} /></Field>
        <Field label="Estado" error={errores.estado}><select value={form.estado} onChange={event => cambiar('estado', event.target.value as typeof form.estado)}><option value="activo">Activo</option><option value="mantenimiento">En mantenimiento</option><option value="inactivo">Inactivo</option></select></Field>
        <Field label="Propiedad"><select value={form.propiedad} onChange={event => cambiar('propiedad', event.target.value as typeof form.propiedad)}><option value="propio">Propio</option><option value="tercero">De terceros</option></select></Field>
        {form.propiedad === 'tercero' && <Field label="Empresa transportista" error={errores.transportista}><input value={form.transportista} onChange={event => cambiar('transportista', event.target.value)} maxLength={80} /></Field>}
        <Field label="SOAT vence" error={errores.soatVence}><input type="date" value={form.soatVence} onChange={event => cambiar('soatVence', event.target.value)} /></Field>
        <Field label="Revisión técnica vence" error={errores.revisionVence}><input type="date" value={form.revisionVence} onChange={event => cambiar('revisionVence', event.target.value)} /></Field>
        <Field label="Observaciones (opcional)" wide><textarea value={form.observaciones} onChange={event => cambiar('observaciones', event.target.value)} maxLength={300} rows={2} /></Field>
      </div>
      <Actions busy={busy} submitLabel={item ? 'Guardar cambios' : 'Registrar vehículo'} onClose={onClose} />
    </form>
  </Dialog>
}

// ---------- Conductor ----------
export function ConductorDialog({ servicio, item, onClose, onSaved }: Cerrar & { servicio: FlotaService; item?: Conductor }) {
  const [form, setForm] = useState({
    nombre: item?.nombre ?? '', documento: item?.documento ?? '', telefono: item?.telefono ?? '', licenciaNumero: item?.licenciaNumero ?? '',
    licenciaCategoria: item?.licenciaCategoria ?? 'A-IIb', licenciaVence: item?.licenciaVence ?? '', estado: item?.estado ?? 'activo', observaciones: item?.observaciones ?? '',
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
      await servicio.guardarConductor(form, item)
      onSaved(item ? 'Conductor actualizado.' : 'Conductor registrado.')
    } catch (reason) { reportar(reason, setErrores, setMensaje) } finally { setBusy(false) }
  }

  return <Dialog title={item ? 'Editar conductor' : 'Nuevo conductor'} description="Registra al conductor con su licencia; una licencia vencida impide asignarlo." onClose={onClose} busy={busy}>
    <form className="ws-form" onSubmit={event => void enviar(event)} noValidate>
      <Aviso mensaje={mensaje} />
      <div className="ws-form-grid">
        <Field label="Nombre completo" error={errores.nombre} wide><input value={form.nombre} onChange={event => cambiar('nombre', event.target.value)} maxLength={80} data-autofocus /></Field>
        <Field label="DNI" error={errores.documento}><input value={form.documento} onChange={event => cambiar('documento', event.target.value)} inputMode="numeric" maxLength={8} autoComplete="off" /></Field>
        <Field label="Teléfono (opcional)" error={errores.telefono}><input value={form.telefono} onChange={event => cambiar('telefono', event.target.value)} inputMode="tel" maxLength={14} /></Field>
        <Field label="N.º de licencia" error={errores.licenciaNumero}><input value={form.licenciaNumero} onChange={event => cambiar('licenciaNumero', event.target.value)} maxLength={16} autoComplete="off" /></Field>
        <Field label="Categoría" error={errores.licenciaCategoria}><select value={form.licenciaCategoria} onChange={event => cambiar('licenciaCategoria', event.target.value)}>{LICENCIA_CATEGORIAS.map(categoria => <option key={categoria} value={categoria}>{categoria}</option>)}</select></Field>
        <Field label="Licencia vence" error={errores.licenciaVence}><input type="date" value={form.licenciaVence} onChange={event => cambiar('licenciaVence', event.target.value)} /></Field>
        <Field label="Estado" error={errores.estado}><select value={form.estado} onChange={event => cambiar('estado', event.target.value as typeof form.estado)}><option value="activo">Activo</option><option value="inactivo">Inactivo</option></select></Field>
        <Field label="Observaciones (opcional)" wide><textarea value={form.observaciones} onChange={event => cambiar('observaciones', event.target.value)} maxLength={300} rows={2} /></Field>
      </div>
      <Actions busy={busy} submitLabel={item ? 'Guardar cambios' : 'Registrar conductor'} onClose={onClose} />
    </form>
  </Dialog>
}

// ---------- Asignación ----------
export function AsignacionDialog({ servicio, vehiculos, conductores, onClose, onSaved }: Cerrar & { servicio: FlotaService; vehiculos: Vehiculo[]; conductores: Conductor[] }) {
  const [form, setForm] = useState(() => {
    const desde = sumarHoras(`${ahoraLima().slice(0, 13)}:00`, 1)
    return { vehiculoId: '', conductorId: '', desde, hasta: sumarHoras(desde, 4), referencia: '' }
  })
  const [resultado, setResultado] = useState<ResultadoAsignacion | null>(null)
  const [errores, setErrores] = useState<Errores>({})
  const [mensaje, setMensaje] = useState('')
  const [busy, setBusy] = useState(false)
  const cambiar = <K extends keyof typeof form>(campo: K, valor: string) => setForm(actual => ({ ...actual, [campo]: valor }))
  const elegidos = Boolean(form.vehiculoId && form.conductorId)

  useEffect(() => {
    let vigente = true
    void servicio.revisarAsignacion(form).then(nuevo => { if (vigente) setResultado(nuevo) }).catch(() => { if (vigente) setResultado(null) })
    return () => { vigente = false }
  }, [servicio, form])

  async function enviar(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true); setErrores({}); setMensaje('')
    try {
      await servicio.crearAsignacion(form)
      onSaved('Asignación registrada.')
    } catch (reason) { reportar(reason, setErrores, setMensaje) } finally { setBusy(false) }
  }

  const motivos = elegidos ? resultado?.motivos ?? [] : []
  const avisos = elegidos ? resultado?.avisos ?? [] : []
  const campos = { ...(resultado?.campos ?? {}), ...errores }

  return <Dialog title="Nueva asignación" description="Un vehículo o un conductor no puede estar en dos asignaciones con horarios que se crucen." onClose={onClose} busy={busy}>
    <form className="ws-form" onSubmit={event => void enviar(event)} noValidate>
      {mensaje && !motivos.length && <Aviso mensaje={mensaje} />}
      <div className="ws-form-grid">
        <Field label="Vehículo" error={errores.vehiculoId}><select value={form.vehiculoId} onChange={event => cambiar('vehiculoId', event.target.value)} data-autofocus><option value="">Elige un vehículo</option>{vehiculos.map(item => <option key={item.id} value={item.id}>{etiquetaVehiculo(item)}</option>)}</select></Field>
        <Field label="Conductor" error={errores.conductorId}><select value={form.conductorId} onChange={event => cambiar('conductorId', event.target.value)}><option value="">Elige un conductor</option>{conductores.map(item => <option key={item.id} value={item.id}>{item.nombre} · {item.licenciaCategoria}</option>)}</select></Field>
        <Field label="Desde" error={campos.desde}><input type="datetime-local" value={form.desde} onChange={event => cambiar('desde', event.target.value)} /></Field>
        <Field label="Hasta" error={campos.hasta}><input type="datetime-local" value={form.hasta} onChange={event => cambiar('hasta', event.target.value)} /></Field>
        <Field label="Referencia (opcional)" wide><input value={form.referencia} onChange={event => cambiar('referencia', event.target.value)} placeholder="Despacho, ruta o pedido" maxLength={80} /></Field>
      </div>
      {motivos.length > 0 && <div className="ws-notice ws-notice-warning" role="alert"><AlertTriangle size={17} /><div><ul className="ws-fleet-reasons">{motivos.map(motivo => <li key={motivo}>{motivo}</li>)}</ul></div></div>}
      {avisos.length > 0 && <div className="ws-notice"><Info size={17} /><div><ul className="ws-fleet-reasons">{avisos.map(aviso => <li key={aviso}>{aviso}</li>)}</ul></div></div>}
      <Actions busy={busy} submitLabel="Registrar asignación" disabled={elegidos && resultado !== null && !resultado.valido} onClose={onClose} />
    </form>
  </Dialog>
}

// ---------- Cancelar asignación ----------
export function CancelarDialog({ servicio, item, onClose, onSaved }: Cerrar & { servicio: FlotaService; item: Asignacion }) {
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState('')
  const campo = useRef<HTMLTextAreaElement>(null)

  async function confirmar() {
    setError('')
    try {
      await servicio.cancelarAsignacion(item, motivo)
      onSaved('Asignación cancelada.')
    } catch (reason) {
      setError(reason instanceof ErrorValidacion ? reason.message : friendlyError(reason))
      campo.current?.focus()
    }
  }

  return <ConfirmModal title="Cancelar asignación" message="El horario quedará libre para otras asignaciones. Indica el motivo para dejar constancia." confirmLabel="Cancelar asignación" onCancel={onClose} onConfirm={confirmar}>
    <div className="ws-form ws-fleet-cancel">
      <label>Motivo<textarea ref={campo} value={motivo} onChange={event => setMotivo(event.target.value)} rows={3} maxLength={200} data-autofocus />{error && <small className="ws-field-error" role="alert">{error}</small>}</label>
    </div>
  </ConfirmModal>
}
