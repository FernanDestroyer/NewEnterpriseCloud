import { useState, type FormEvent } from 'react'
import { CheckCircle2, ClipboardCheck, Flag, PackageCheck, Route } from 'lucide-react'
import { unidadesDeParada } from './despachos'
import type { DespachoService } from './despachoService'
import { Dialog, Field, reportar } from './FlotaDialogs'
import type { Errores } from './rules'
import { MOTIVOS_NO_ENTREGA, RESULTADOS_ENTREGA, lineasDevueltas, type EntradaEntrega } from './seguimiento'
import type { Despacho, EventoDespachoTipo, Parada, ResultadoEntrega } from './types'

type Cerrar = { onClose: () => void; onSaved: (mensaje: string) => void }

const OPCIONES: Array<{ value: ResultadoEntrega; titulo: string; ayuda: string }> = [
  { value: 'entregada', titulo: 'Entregada completa', ayuda: 'El cliente recibió todo.' },
  { value: 'parcial', titulo: 'Entrega parcial', ayuda: 'Recibió solo una parte; el resto vuelve al almacén.' },
  { value: 'no_entregada', titulo: 'No se pudo entregar', ayuda: 'Nada se entregó; todo vuelve al almacén.' },
]

export function formatoMomento(iso: string): string {
  const fecha = new Date(iso)
  if (Number.isNaN(fecha.getTime())) return iso
  return fecha.toLocaleString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function Botones({ busy, etiqueta, onClose }: { busy: boolean; etiqueta: string; onClose: () => void }) {
  return <div className="ws-fleet-actions">
    <button type="button" className="ws-button ws-button-secondary" onClick={onClose} disabled={busy}>Cancelar</button>
    <button type="submit" className="ws-button" disabled={busy}>{busy ? 'Guardando…' : etiqueta}</button>
  </div>
}

export function EntregaDialog({ servicio, despacho, parada, onClose, onSaved }: Cerrar & { servicio: DespachoService; despacho: Despacho; parada: Parada }) {
  const [form, setForm] = useState<EntradaEntrega>({ resultado: 'entregada', receptor: parada.clienteNombre, motivo: '', nota: '', cantidades: Object.fromEntries(parada.lineas.map(linea => [linea.productoId, String(linea.cantidad)])) })
  const [errores, setErrores] = useState<Errores>({})
  const [mensaje, setMensaje] = useState('')
  const [busy, setBusy] = useState(false)
  const cambiar = <K extends keyof EntradaEntrega>(campo: K, valor: EntradaEntrega[K]) => setForm(actual => ({ ...actual, [campo]: valor }))

  async function enviar(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true); setErrores({}); setMensaje('')
    try {
      await servicio.registrarEntrega(despacho, parada.id, form)
      onSaved(form.resultado === 'entregada' ? 'Entrega registrada.' : 'Resultado registrado. Lo no entregado quedó como devolución pendiente.')
    } catch (reason) { reportar(reason, setErrores, setMensaje) } finally { setBusy(false) }
  }

  const noEntrega = form.resultado !== 'entregada'
  return <Dialog title="Registrar entrega" description={`${parada.ventaCodigo} · ${parada.clienteNombre} — ${unidadesDeParada(parada)} u. a entregar en ${parada.direccion || 'dirección sin registrar'}.`} onClose={onClose} busy={busy}>
    <form className="ws-form" onSubmit={event => void enviar(event)} noValidate>
      {mensaje && <div className="ws-notice ws-notice-warning" role="alert"><span>{mensaje}</span></div>}
      <div className="ws-seg-options" role="radiogroup" aria-label="Resultado de la entrega">
        {OPCIONES.map(opcion => <label key={opcion.value} className={`ws-seg-option tone-${RESULTADOS_ENTREGA[opcion.value].tone}`} data-checked={form.resultado === opcion.value}>
          <input type="radio" name="resultado" value={opcion.value} checked={form.resultado === opcion.value} onChange={() => { cambiar('resultado', opcion.value); setErrores({}) }} />
          <b>{opcion.titulo}</b><small>{opcion.ayuda}</small>
        </label>)}
      </div>
      <div className="ws-form-grid">
        {form.resultado !== 'no_entregada' && <Field label="Recibido por" error={errores.receptor} wide><input value={form.receptor} maxLength={80} onChange={event => cambiar('receptor', event.target.value)} placeholder="Nombre de quien recibió" /></Field>}
        {form.resultado === 'parcial' && <div className="ws-form-wide ws-seg-lineas">
          <small>Unidades entregadas por producto</small>
          {parada.lineas.map(linea => <label key={linea.productoId}>
            <span><b>{linea.nombre}</b> <em>{linea.codigo}</em></span>
            <input type="number" inputMode="numeric" min={0} max={linea.cantidad} step={1} value={form.cantidades[linea.productoId] ?? ''} onChange={event => cambiar('cantidades', { ...form.cantidades, [linea.productoId]: event.target.value })} aria-label={`Entregadas de ${linea.nombre}`} />
            <span>de {linea.cantidad}</span>
            {errores[`cantidad-${linea.productoId}`] && <small className="ws-field-error" role="alert">{errores[`cantidad-${linea.productoId}`]}</small>}
          </label>)}
          {errores.cantidades && <small className="ws-field-error" role="alert">{errores.cantidades}</small>}
        </div>}
        {noEntrega && <Field label="Motivo" error={errores.motivo} wide><select value={form.motivo} onChange={event => cambiar('motivo', event.target.value as EntradaEntrega['motivo'])}>
          <option value="">Elige el motivo…</option>
          {MOTIVOS_NO_ENTREGA.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select></Field>}
        <Field label={noEntrega ? 'Nota (obligatoria si el motivo es «Otro»)' : 'Nota (opcional)'} error={errores.nota} wide><textarea rows={2} maxLength={300} value={form.nota} onChange={event => cambiar('nota', event.target.value)} /></Field>
      </div>
      {noEntrega && <p className="ws-seg-hint"><PackageCheck size={14} />Lo que no se entregue queda como <b>devolución pendiente</b> y vuelve a aparecer en «Por despachar» para programarlo otra vez.</p>}
      <Botones busy={busy} etiqueta="Guardar resultado" onClose={onClose} />
    </form>
  </Dialog>
}

export function ReingresoDialog({ servicio, despacho, parada, onClose, onSaved }: Cerrar & { servicio: DespachoService; despacho: Despacho; parada: Parada }) {
  const [nota, setNota] = useState('')
  const [mensaje, setMensaje] = useState('')
  const [busy, setBusy] = useState(false)
  async function enviar(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true); setMensaje('')
    try { await servicio.confirmarReingreso(despacho, parada.id, nota); onSaved('Reingreso confirmado.') }
    catch (reason) { reportar(reason, () => undefined, setMensaje) } finally { setBusy(false) }
  }
  return <Dialog title="Confirmar reingreso al almacén" description={`${parada.ventaCodigo} · ${parada.clienteNombre}`} onClose={onClose} busy={busy}>
    <form className="ws-form" onSubmit={event => void enviar(event)} noValidate>
      {mensaje && <div className="ws-notice ws-notice-warning" role="alert"><span>{mensaje}</span></div>}
      <ul className="ws-seg-devueltas">{lineasDevueltas(parada).map(item => <li key={item.linea.productoId}><b>{item.cantidad} ×</b> {item.linea.nombre} <em>{item.linea.codigo}</em></li>)}</ul>
      <p className="ws-seg-hint"><ClipboardCheck size={14} />Confirma que la mercadería ya está físicamente en el almacén. <b>Esto no modifica el stock</b>: si corresponde, registra el ingreso en Inventario.</p>
      <div className="ws-form-grid"><Field label="Nota (opcional)" wide><textarea rows={2} maxLength={300} value={nota} onChange={event => setNota(event.target.value)} placeholder="P. ej. Recibido por almacén, embalaje en buen estado" /></Field></div>
      <Botones busy={busy} etiqueta="Confirmar reingreso" onClose={onClose} />
    </form>
  </Dialog>
}

const ICONO_EVENTO: Record<EventoDespachoTipo, typeof Route> = { inicio_ruta: Route, entrega: PackageCheck, reingreso: ClipboardCheck, completado: Flag }
const TITULO_EVENTO: Record<EventoDespachoTipo, string> = { inicio_ruta: 'Salida a ruta', entrega: 'Entrega', reingreso: 'Reingreso', completado: 'Ruta completada' }

export function LineaTiempoDialog({ despacho, onClose }: { despacho: Despacho; onClose: () => void }) {
  const eventos = [...(despacho.eventos ?? [])].sort((a, b) => a.fecha.localeCompare(b.fecha))
  return <Dialog title={`Línea de tiempo · ${despacho.numero}`} description="Cada paso del seguimiento queda con su fecha y hora (hora de Lima)." onClose={onClose}>
    {eventos.length ? <ol className="ws-timeline">{eventos.map(item => { const Icono = ICONO_EVENTO[item.tipo] ?? CheckCircle2; return <li key={item.id}>
      <span className="ws-timeline-dot"><Icono size={14} /></span>
      <div><strong>{TITULO_EVENTO[item.tipo] ?? item.tipo}</strong><small>{formatoMomento(item.fecha)}</small><p>{item.detalle}</p></div>
    </li> })}</ol> : <p className="ws-seg-hint">Este despacho aún no tiene movimientos de seguimiento.</p>}
    <div className="ws-fleet-actions"><button type="button" className="ws-button ws-button-secondary" onClick={onClose}>Cerrar</button></div>
  </Dialog>
}
