import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Info, MapPinned, X } from 'lucide-react'
import ConfirmModal from '../../components/ConfirmModal'
import { friendlyError } from '../../services/records'
import type { DespachoService } from './despachoService'
import { construirParada, moverParada, ordenarPorZona, PRIORIDADES, quitarParada, renumerar, unidadesDeParada, zonasDeRuta, type VentaDespachable } from './despachos'
import { Aviso, Dialog, Field, reportar } from './FlotaDialogs'
import { ErrorValidacion } from './flotaService'
import type { AlmacenInfo, FuenteDespacho } from './fuentes'
import { ahoraLima, etiquetaVehiculoCorta, type Errores } from './rules'
import { nuevoId } from './storage'
import type { Conductor, Despacho, DespachoInput, Parada, PrioridadDespacho, Vehiculo } from './types'

type Props = {
  servicio: DespachoService
  fuente: FuenteDespacho
  /** Despacho que se abre para ver o editar; sin él se crea uno nuevo con `ventas`. */
  despacho?: Despacho
  ventas?: VentaDespachable[]
  despachos: Despacho[]
  vehiculos: Vehiculo[]
  conductores: Conductor[]
  almacenes: AlmacenInfo[]
  onClose: () => void
  onSaved: (mensaje: string) => void
}

const HORA_INICIO = '08:00'
const HORA_FIN = '12:00'

export function DespachoDialog({ servicio, fuente, despacho, ventas = [], despachos, vehiculos, conductores, almacenes, onClose, onSaved }: Props) {
  const soloLectura = Boolean(despacho && despacho.estado !== 'borrador')
  const [form, setForm] = useState(() => {
    const fecha = despacho?.fecha ?? ahoraLima().slice(0, 10)
    const almacen = almacenes.find(item => item.id === despacho?.almacenId) ?? (despacho ? undefined : almacenes[0])
    return {
      fecha, prioridad: (despacho?.prioridad ?? 'normal') as PrioridadDespacho, almacenId: almacen?.id ?? despacho?.almacenId ?? '', almacenNombre: despacho?.almacenNombre ?? almacen?.nombre ?? '',
      peso: despacho?.pesoEstimadoKg != null ? String(despacho.pesoEstimadoKg) : '', observaciones: despacho?.observaciones ?? '',
      vehiculoId: despacho?.vehiculoId ?? '', conductorId: despacho?.conductorId ?? '',
      desde: despacho?.desde || `${fecha}T${HORA_INICIO}`, hasta: despacho?.hasta || `${fecha}T${HORA_FIN}`,
    }
  })
  const [paradas, setParadas] = useState<Parada[]>(despacho?.paradas ?? [])
  const [cargando, setCargando] = useState(!despacho && ventas.length > 0)
  const [avisosCarga, setAvisosCarga] = useState<string[]>([])
  const [resultado, setResultado] = useState<{ valido: boolean; campos: Errores; motivos: string[]; avisos: string[] } | null>(null)
  const [errores, setErrores] = useState<Errores>({})
  const [mensaje, setMensaje] = useState('')
  const [busy, setBusy] = useState(false)
  const ventasIniciales = useRef(ventas)

  // Carga las líneas de cada venta elegida y arma las paradas con lo que falta despachar.
  useEffect(() => {
    if (despacho || !ventasIniciales.current.length) return
    let vigente = true
    void (async () => {
      const nuevas: Parada[] = []
      const avisos: string[] = []
      for (const venta of ventasIniciales.current) {
        try {
          const parada = construirParada(venta, await fuente.lineasVenta(venta.ventaId), despachos, nuevoId())
          if (parada) nuevas.push(parada)
          else avisos.push(`${venta.codigo} ya está despachada por completo.`)
        } catch (error) { avisos.push(`No se pudieron cargar las líneas de ${venta.codigo}: ${friendlyError(error)}`) }
      }
      if (!vigente) return
      setParadas(ordenarPorZona(nuevas))
      setAvisosCarga(avisos)
      setCargando(false)
    })()
    return () => { vigente = false }
  }, [despacho, despachos, fuente])

  const cambiar = <K extends keyof typeof form>(campo: K, valor: (typeof form)[K]) => setForm(actual => ({ ...actual, [campo]: valor }))
  const cambiarFecha = (fecha: string) => setForm(actual => ({ ...actual, fecha, desde: `${fecha}T${actual.desde.slice(11, 16) || HORA_INICIO}`, hasta: `${fecha}T${actual.hasta.slice(11, 16) || HORA_FIN}` }))
  const vehiculo = vehiculos.find(item => item.id === form.vehiculoId)

  const entrada = useMemo((): DespachoInput => ({
    fecha: form.fecha, prioridad: form.prioridad, almacenId: form.almacenId || null, almacenNombre: form.almacenNombre,
    pesoEstimadoKg: form.peso.trim() === '' ? null : Number(form.peso), observaciones: form.observaciones, paradas: renumerar(paradas),
    vehiculoId: form.vehiculoId || null, conductorId: form.conductorId || null, desde: form.desde, hasta: form.hasta,
  }), [form, paradas])

  // Qué falta para programar, calculado en vivo.
  useEffect(() => {
    if (soloLectura || !paradas.length) { setResultado(null); return }
    let vigente = true
    void servicio.revisarProgramacion(entrada, despacho).then(nuevo => { if (vigente) setResultado(nuevo) }).catch(() => { if (vigente) setResultado(null) })
    return () => { vigente = false }
  }, [servicio, entrada, despacho, soloLectura, paradas.length])

  const editarParada = (id: string, cambio: Partial<Parada>) => setParadas(actual => actual.map(item => item.id === id ? { ...item, ...cambio } : item))
  const editarCantidad = (id: string, productoId: string, valor: string) => setParadas(actual => actual.map(item => item.id !== id ? item : { ...item, lineas: item.lineas.map(linea => linea.productoId === productoId ? { ...linea, cantidad: valor === '' ? 0 : Number(valor) } : linea) }))

  async function guardar(modo: 'borrador' | 'programar') {
    if (busy) return
    setBusy(true); setErrores({}); setMensaje('')
    try {
      if (modo === 'borrador') await servicio.guardarBorrador(entrada, despacho)
      else await servicio.programar(entrada, despacho)
      onSaved(modo === 'borrador' ? 'Borrador guardado.' : 'Despacho programado.')
    } catch (reason) { reportar(reason, setErrores, setMensaje); if (reason instanceof ErrorValidacion) setMensaje(reason.motivos.length > 1 ? 'Revisa los puntos indicados abajo.' : reason.message) } finally { setBusy(false) }
  }

  const pendientes = resultado ? [...new Set([...Object.values(resultado.campos), ...resultado.motivos])] : []
  const campos = { ...(resultado?.campos ?? {}), ...errores }
  const titulo = despacho ? (soloLectura ? `Despacho ${despacho.numero}` : `Editar ${despacho.numero}`) : 'Nuevo despacho'
  const zonas = zonasDeRuta(paradas)

  return <Dialog title={titulo} description={soloLectura ? 'Este despacho ya no se puede editar; consulta su ruta y su asignación.' : 'Arma la ruta con las ventas elegidas, asigna vehículo y conductor y prográmalo.'} onClose={onClose} busy={busy} ancho>
    <form className="ws-form" onSubmit={event => { event.preventDefault(); void guardar('programar') }} noValidate>
      <Aviso mensaje={mensaje} />
      <fieldset className="ws-dispatch-fieldset" disabled={soloLectura}>
        <section className="ws-dispatch-section">
          <h3>Datos del despacho</h3>
          <div className="ws-form-grid">
            <Field label="Fecha" error={campos.fecha}><input type="date" value={form.fecha} onChange={event => cambiarFecha(event.target.value)} data-autofocus={soloLectura ? undefined : true} /></Field>
            <Field label="Prioridad"><select value={form.prioridad} onChange={event => cambiar('prioridad', event.target.value as PrioridadDespacho)}>{PRIORIDADES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field>
            <Field label="Almacén de origen">{almacenes.length
              ? <select value={form.almacenId} onChange={event => setForm(actual => ({ ...actual, almacenId: event.target.value, almacenNombre: almacenes.find(item => item.id === event.target.value)?.nombre ?? '' }))}>{!form.almacenId && <option value="">Sin almacén</option>}{almacenes.map(item => <option key={item.id} value={item.id}>{item.nombre}</option>)}</select>
              : <input value={form.almacenNombre} onChange={event => cambiar('almacenNombre', event.target.value)} placeholder="Ej. Almacén central" maxLength={60} />}</Field>
            <Field label="Peso estimado de la carga (kg)" error={campos.pesoEstimadoKg}><input type="number" min={1} step="any" value={form.peso} onChange={event => cambiar('peso', event.target.value)} placeholder="Opcional" /></Field>
            <Field label="Observaciones (opcional)" wide><input value={form.observaciones} onChange={event => cambiar('observaciones', event.target.value)} maxLength={200} /></Field>
          </div>
        </section>

        <section className="ws-dispatch-section">
          <div className="ws-dispatch-heading"><h3>Ruta · {paradas.length} {paradas.length === 1 ? 'parada' : 'paradas'}{zonas.length > 0 && <small>{zonas.join(' → ')}</small>}</h3>
            {!soloLectura && paradas.length > 1 && <button type="button" className="ws-button ws-button-secondary" onClick={() => setParadas(ordenarPorZona(paradas))}><MapPinned size={15} />Ordenar por zona</button>}</div>
          {cargando && <div className="ws-notice"><Info size={17} /><span>Cargando las líneas de las ventas…</span></div>}
          {avisosCarga.length > 0 && <div className="ws-notice ws-notice-warning" role="alert"><Info size={17} /><div><ul className="ws-fleet-reasons">{avisosCarga.map(aviso => <li key={aviso}>{aviso}</li>)}</ul></div></div>}
          {campos.paradas && !cargando && <small className="ws-field-error" role="alert">{campos.paradas}</small>}
          <div className="ws-stops">
            {paradas.map((parada, indice) => <article className="ws-stop" key={parada.id}>
              <div className="ws-stop-head">
                <span className="ws-stop-n">{parada.orden || indice + 1}</span>
                <div className="ws-stop-title"><strong>{parada.clienteNombre}</strong><small>{parada.ventaCodigo} · {parada.zonaNombre || 'Sin zona'} · {unidadesDeParada(parada)} u.</small></div>
                {!soloLectura && <div className="row-actions">
                  <button type="button" className="row-action" title="Subir parada" aria-label={`Subir la parada de ${parada.clienteNombre}`} disabled={indice === 0} onClick={() => setParadas(moverParada(paradas, indice, -1))}><ArrowUp size={15} /></button>
                  <button type="button" className="row-action" title="Bajar parada" aria-label={`Bajar la parada de ${parada.clienteNombre}`} disabled={indice === paradas.length - 1} onClick={() => setParadas(moverParada(paradas, indice, 1))}><ArrowDown size={15} /></button>
                  <button type="button" className="row-action delete" title="Quitar del despacho" aria-label={`Quitar ${parada.ventaCodigo} del despacho`} onClick={() => setParadas(quitarParada(paradas, indice))}><X size={15} /></button>
                </div>}
              </div>
              <label>Dirección de entrega<input value={parada.direccion} onChange={event => editarParada(parada.id, { direccion: event.target.value })} placeholder="Calle, número, distrito" maxLength={160} /></label>
              <div className="ws-stop-lines">{parada.lineas.map(linea => <label key={linea.productoId}><span>{linea.nombre}<small>de {linea.cantidadVendida}</small></span><input type="number" min={0} max={linea.cantidadVendida} step={1} value={linea.cantidad} onChange={event => editarCantidad(parada.id, linea.productoId, event.target.value)} aria-label={`Cantidad de ${linea.nombre} para ${parada.clienteNombre}`} /></label>)}</div>
            </article>)}
          </div>
        </section>

        <section className="ws-dispatch-section">
          <h3>Vehículo y conductor</h3>
          <div className="ws-form-grid">
            <Field label="Vehículo" error={errores.vehiculoId}><select value={form.vehiculoId} onChange={event => cambiar('vehiculoId', event.target.value)}><option value="">Elige un vehículo</option>{vehiculos.map(item => <option key={item.id} value={item.id}>{etiquetaVehiculoCorta(item)}</option>)}</select></Field>
            <Field label="Conductor" error={errores.conductorId}><select value={form.conductorId} onChange={event => cambiar('conductorId', event.target.value)}><option value="">Elige un conductor</option>{conductores.map(item => <option key={item.id} value={item.id}>{item.nombre} · {item.licenciaCategoria}</option>)}</select></Field>
            <Field label="Sale a las" error={campos.desde}><input type="datetime-local" value={form.desde} onChange={event => cambiar('desde', event.target.value)} /></Field>
            <Field label="Regresa a las" error={campos.hasta}><input type="datetime-local" value={form.hasta} onChange={event => cambiar('hasta', event.target.value)} /></Field>
          </div>
          {vehiculo && <small className="ws-dispatch-hint">Capacidad del vehículo: {vehiculo.capacidadKg.toLocaleString('es-PE')} kg</small>}
        </section>
      </fieldset>

      {!soloLectura && pendientes.length > 0 && <div className="ws-notice ws-notice-warning" role="status"><Info size={17} /><div><strong>Para programar falta resolver:</strong><ul className="ws-fleet-reasons">{pendientes.map(item => <li key={item}>{item}</li>)}</ul></div></div>}
      {!soloLectura && (resultado?.avisos.length ?? 0) > 0 && <div className="ws-notice"><Info size={17} /><div><ul className="ws-fleet-reasons">{resultado?.avisos.map(item => <li key={item}>{item}</li>)}</ul></div></div>}
      {soloLectura && despacho?.estado === 'cancelado' && despacho.motivoCancelacion && <div className="ws-notice ws-notice-warning"><Info size={17} /><span>Motivo de la cancelación: {despacho.motivoCancelacion}</span></div>}

      <div className="ws-fleet-actions">
        <button type="button" className="ws-button ws-button-secondary" onClick={onClose} disabled={busy}>{soloLectura ? 'Cerrar' : 'Cancelar'}</button>
        {!soloLectura && <button type="button" className="ws-button ws-button-secondary" aria-disabled={busy} disabled={!paradas.length || cargando} onClick={() => void guardar('borrador')}>{busy ? 'Guardando…' : 'Guardar borrador'}</button>}
        {!soloLectura && <button type="submit" className="ws-button" aria-disabled={busy} disabled={!paradas.length || cargando || (resultado !== null && !resultado.valido)}>{busy ? 'Guardando…' : 'Programar despacho'}</button>}
      </div>
    </form>
  </Dialog>
}

// ---------- Cancelar despacho ----------
export function CancelarDespachoDialog({ servicio, item, onClose, onSaved }: { servicio: DespachoService; item: Despacho; onClose: () => void; onSaved: (mensaje: string) => void }) {
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState('')
  const campo = useRef<HTMLTextAreaElement>(null)

  async function confirmar() {
    setError('')
    try {
      await servicio.cancelar(item, motivo)
      onSaved(item.asignacionId ? 'Despacho cancelado; vehículo y conductor liberados.' : 'Despacho cancelado.')
    } catch (reason) {
      setError(reason instanceof ErrorValidacion ? reason.message : friendlyError(reason))
      campo.current?.focus()
    }
  }

  return <ConfirmModal title={`Cancelar ${item.numero}`} message={item.asignacionId ? 'Se liberarán el vehículo y el conductor reservados. Indica el motivo para dejar constancia.' : 'Indica el motivo para dejar constancia.'} confirmLabel="Cancelar despacho" onCancel={onClose} onConfirm={confirmar}>
    <div className="ws-form ws-fleet-cancel">
      <label>Motivo<textarea ref={campo} value={motivo} onChange={event => setMotivo(event.target.value)} rows={3} maxLength={200} data-autofocus />{error && <small className="ws-field-error" role="alert">{error}</small>}</label>
    </div>
  </ConfirmModal>
}
