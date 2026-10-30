import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CalendarDays, ClipboardCheck, Pencil, Plus, RefreshCw, ShieldCheck, Truck, UserRound, X } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useRecords } from '../../context/RecordsContext'
import { friendlyError } from '../../services/records'
import { AsignacionDialog, CancelarDialog, ConductorDialog, VehiculoDialog } from './FlotaDialogs'
import { crearFlotaService, etiquetaVehiculo } from './flotaService'
import { permisosLogistica } from './permisos'
import { ahoraLima, documentosEnAtencion, formatoFecha, tipoLabel, vigenciaDocumento, type VigenciaDocumento } from './rules'
import type { AlmacenLogistica } from './storage'
import { useAlmacenLogistica } from './useAlmacen'
import type { Asignacion, Conductor, Vehiculo } from './types'

type Pestana = 'vehiculos' | 'conductores' | 'asignaciones'
type DialogState =
  | { tipo: 'vehiculo'; item?: Vehiculo }
  | { tipo: 'conductor'; item?: Conductor }
  | { tipo: 'asignacion' }
  | { tipo: 'cancelar'; item: Asignacion }
  | null

const VIGENCIA: Record<VigenciaDocumento, { label: string; tone: 'green' | 'amber' | 'red' }> = {
  vigente: { label: 'Vigente', tone: 'green' },
  por_vencer: { label: 'Por vencer', tone: 'amber' },
  vencido: { label: 'Vencido', tone: 'red' },
  sin_dato: { label: 'Sin registrar', tone: 'amber' },
}

const ESTADO_VEHICULO = { activo: { label: 'Activo', tone: 'green' }, mantenimiento: { label: 'Mantenimiento', tone: 'amber' }, inactivo: { label: 'Inactivo', tone: 'red' } } as const
const ESTADO_CONDUCTOR = { activo: { label: 'Activo', tone: 'green' }, inactivo: { label: 'Inactivo', tone: 'red' } } as const
const ESTADO_ASIGNACION = { programada: { label: 'Programada', tone: 'blue' }, completada: { label: 'Completada', tone: 'green' }, cancelada: { label: 'Cancelada', tone: 'red' } } as const

function Documento({ vence, hoy }: { vence: string; hoy: string }) {
  const vigencia = VIGENCIA[vigenciaDocumento(vence, hoy)]
  return <div className="ws-fleet-doc"><span className={`status-pill ${vigencia.tone}`}>{vigencia.label}</span>{vence && <small>{formatoFecha(vence)}</small>}</div>
}

const Vacio = ({ texto, ayuda }: { texto: string; ayuda: string }) => <div className="ws-empty-compact"><Truck size={26} /><strong>{texto}</strong><span>{ayuda}</span></div>

function FlotaContenido({ almacen }: { almacen: AlmacenLogistica }) {
  const { can } = useAuth()
  const { notify } = useRecords()
  const permisos = permisosLogistica(can)
  const servicio = useMemo(() => crearFlotaService(almacen), [almacen])
  const [pestana, setPestana] = useState<Pestana>('vehiculos')
  const [vehiculos, setVehiculos] = useState<Vehiculo[]>([])
  const [conductores, setConductores] = useState<Conductor[]>([])
  const [asignaciones, setAsignaciones] = useState<Asignacion[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [dialog, setDialog] = useState<DialogState>(null)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    if (!permisos.ver) return
    let vigente = true
    setCargando(true)
    void Promise.all([servicio.listarVehiculos(), servicio.listarConductores(), servicio.listarAsignaciones()])
      .then(([v, c, a]) => { if (vigente) { setVehiculos(v); setConductores(c); setAsignaciones(a); setError('') } })
      .catch(reason => { if (vigente) setError(friendlyError(reason)) })
      .finally(() => { if (vigente) setCargando(false) })
    return () => { vigente = false }
  }, [servicio, permisos.ver, version])

  const recargar = useCallback(() => setVersion(actual => actual + 1), [])
  const alGuardar = useCallback((mensaje: string) => { setDialog(null); notify(mensaje); recargar() }, [notify, recargar])

  const hoy = ahoraLima().slice(0, 10)
  const atencion = useMemo(() => documentosEnAtencion(vehiculos, conductores, hoy), [vehiculos, conductores, hoy])
  const vehiculoPorId = useMemo(() => new Map(vehiculos.map(item => [item.id, item])), [vehiculos])
  const conductorPorId = useMemo(() => new Map(conductores.map(item => [item.id, item])), [conductores])
  const programadas = asignaciones.filter(item => item.estado === 'programada').length

  async function completar(asignacion: Asignacion) {
    try { await servicio.completarAsignacion(asignacion); notify('Asignación completada.'); recargar() } catch (reason) { notify(reason instanceof Error ? reason.message : friendlyError(reason)) }
  }

  if (!permisos.ver) return <section className="ws-card ws-empty-compact"><ShieldCheck size={28} /><strong>Acceso restringido a Logística</strong><span>Tu rol necesita permiso de consulta para ver la flota y las asignaciones.</span></section>

  const accion = pestana === 'vehiculos' ? { label: 'Nuevo vehículo', abrir: () => setDialog({ tipo: 'vehiculo' }) }
    : pestana === 'conductores' ? { label: 'Nuevo conductor', abrir: () => setDialog({ tipo: 'conductor' }) }
    : { label: 'Nueva asignación', abrir: () => setDialog({ tipo: 'asignacion' }) }
  const activosV = vehiculos.filter(item => item.estado === 'activo')
  const activosC = conductores.filter(item => item.estado === 'activo')
  const sinRecursos = pestana === 'asignaciones' && (!activosV.length || !activosC.length)

  return <>
    <section className="ws-page-heading"><div><span className="ws-eyebrow">LOGÍSTICA Y TRANSPORTE</span><h1>Vehículos y conductores</h1><p>Registra la flota, controla SOAT, revisión técnica y licencias, y asigna conductores sin cruces de horario.</p></div>
      <div className="ws-heading-actions">
        <button className="ws-button ws-button-secondary" type="button" disabled={cargando} onClick={recargar}><RefreshCw size={16} className={cargando ? 'ws-spin' : ''} />Actualizar</button>
        {permisos.crear && <button className="ws-button" type="button" disabled={sinRecursos} title={sinRecursos ? 'Registra al menos un vehículo y un conductor activos' : undefined} onClick={accion.abrir}><Plus size={16} />{accion.label}</button>}
      </div></section>
    {servicio.origen === 'navegador' && <div className="ws-notice" role="status"><AlertTriangle size={18} /><span><b>Datos guardados solo en este navegador.</b> Las tablas de Logística no están disponibles en tu base de datos, por lo que no se comparten con otras personas ni quedan en la bitácora. Revisa que el script base de la base de datos esté aplicado.</span></div>}
    {error && <div className="ws-notice ws-notice-warning" role="alert"><AlertTriangle size={18} /><span>{error}</span><button className="ws-text-button" type="button" onClick={recargar}>Reintentar</button></div>}
    {atencion > 0 && <div className="ws-notice ws-notice-warning" role="status"><AlertTriangle size={18} /><span><b>{atencion} {atencion === 1 ? 'documento requiere' : 'documentos requieren'} atención:</b> vencidos, por vencer en 30 días o sin registrar. Un documento vencido impide asignar el vehículo o conductor.</span></div>}

    <div className="ws-tabs ws-fleet-tabs" role="tablist" aria-label="Secciones de la flota">
      <button id="flota-tab-vehiculos" role="tab" aria-selected={pestana === 'vehiculos'} aria-controls="flota-panel" onClick={() => setPestana('vehiculos')}><Truck size={14} />Vehículos<b>{vehiculos.length}</b></button>
      <button id="flota-tab-conductores" role="tab" aria-selected={pestana === 'conductores'} aria-controls="flota-panel" onClick={() => setPestana('conductores')}><UserRound size={14} />Conductores<b>{conductores.length}</b></button>
      <button id="flota-tab-asignaciones" role="tab" aria-selected={pestana === 'asignaciones'} aria-controls="flota-panel" onClick={() => setPestana('asignaciones')}><CalendarDays size={14} />Asignaciones<b>{programadas}</b></button>
    </div>

    <section className="ws-card ws-fleet-panel" id="flota-panel" role="tabpanel" aria-labelledby={`flota-tab-${pestana}`}>
      <div className="table-scroll">
        {pestana === 'vehiculos' && <table className="record-table"><thead><tr><th>Placa</th><th>Tipo</th><th>Marca y modelo</th><th>Capacidad</th><th>Propiedad</th><th>SOAT</th><th>Revisión técnica</th><th>Estado</th><th><span className="sr-only">Acciones</span></th></tr></thead><tbody>
          {vehiculos.map(item => <tr key={item.id}>
            <td><span className="record-id">{item.placa}</span></td><td>{tipoLabel(item.tipo)}</td><td>{item.marca} {item.modelo}</td><td>{item.capacidadKg.toLocaleString('es-PE')} kg</td>
            <td>{item.propiedad === 'tercero' ? item.transportista || 'Terceros' : 'Propio'}</td>
            <td><Documento vence={item.soatVence} hoy={hoy} /></td><td><Documento vence={item.revisionVence} hoy={hoy} /></td>
            <td><span className={`status-pill ${ESTADO_VEHICULO[item.estado].tone}`}>{ESTADO_VEHICULO[item.estado].label}</span></td>
            <td>{permisos.editar && <div className="row-actions"><button className="row-action" type="button" title="Editar vehículo" aria-label={`Editar vehículo ${item.placa}`} onClick={() => setDialog({ tipo: 'vehiculo', item })}><Pencil size={15} /></button></div>}</td>
          </tr>)}
          {!vehiculos.length && !cargando && <tr><td colSpan={9}><Vacio texto="Aún no hay vehículos" ayuda="Registra la primera unidad con «Nuevo vehículo»." /></td></tr>}
        </tbody></table>}

        {pestana === 'conductores' && <table className="record-table"><thead><tr><th>Nombre</th><th>DNI</th><th>Teléfono</th><th>Licencia</th><th>Vigencia de licencia</th><th>Estado</th><th><span className="sr-only">Acciones</span></th></tr></thead><tbody>
          {conductores.map(item => <tr key={item.id}>
            <td>{item.nombre}</td><td>{item.documento}</td><td>{item.telefono || '—'}</td><td><span className="record-id">{item.licenciaNumero}</span> {item.licenciaCategoria}</td>
            <td><Documento vence={item.licenciaVence} hoy={hoy} /></td>
            <td><span className={`status-pill ${ESTADO_CONDUCTOR[item.estado].tone}`}>{ESTADO_CONDUCTOR[item.estado].label}</span></td>
            <td>{permisos.editar && <div className="row-actions"><button className="row-action" type="button" title="Editar conductor" aria-label={`Editar conductor ${item.nombre}`} onClick={() => setDialog({ tipo: 'conductor', item })}><Pencil size={15} /></button></div>}</td>
          </tr>)}
          {!conductores.length && !cargando && <tr><td colSpan={7}><Vacio texto="Aún no hay conductores" ayuda="Registra el primero con «Nuevo conductor»." /></td></tr>}
        </tbody></table>}

        {pestana === 'asignaciones' && <table className="record-table"><thead><tr><th>Vehículo</th><th>Conductor</th><th>Desde</th><th>Hasta</th><th>Referencia</th><th>Estado</th><th><span className="sr-only">Acciones</span></th></tr></thead><tbody>
          {asignaciones.map(item => {
            const vehiculo = vehiculoPorId.get(item.vehiculoId)
            const conductor = conductorPorId.get(item.conductorId)
            return <tr key={item.id}>
              <td>{vehiculo ? etiquetaVehiculo(vehiculo) : '—'}</td><td>{conductor?.nombre ?? '—'}</td><td>{formatoFecha(item.desde)}</td><td>{formatoFecha(item.hasta)}</td>
              <td>{item.referencia || '—'}{item.estado === 'cancelada' && item.motivoCancelacion && <small className="ws-fleet-motivo">Motivo: {item.motivoCancelacion}</small>}</td>
              <td><span className={`status-pill ${ESTADO_ASIGNACION[item.estado].tone}`}>{ESTADO_ASIGNACION[item.estado].label}</span></td>
              <td>{permisos.editar && item.estado === 'programada' && !item.despachoId && <div className="row-actions">
                <button className="row-action" type="button" title="Marcar como completada" aria-label="Marcar asignación como completada" onClick={() => void completar(item)}><ClipboardCheck size={15} /></button>
                <button className="row-action delete" type="button" title="Cancelar asignación" aria-label="Cancelar asignación" onClick={() => setDialog({ tipo: 'cancelar', item })}><X size={15} /></button>
              </div>}</td>
            </tr>
          })}
          {!asignaciones.length && !cargando && <tr><td colSpan={7}><Vacio texto="Aún no hay asignaciones" ayuda={sinRecursos ? 'Primero registra al menos un vehículo y un conductor activos.' : 'Crea una con «Nueva asignación».'} /></td></tr>}
        </tbody></table>}
        {cargando && <div className="ws-empty-compact"><RefreshCw size={20} className="ws-spin" /><strong>Cargando…</strong></div>}
      </div>
    </section>

    {dialog?.tipo === 'vehiculo' && <VehiculoDialog servicio={servicio} item={dialog.item} onClose={() => setDialog(null)} onSaved={alGuardar} />}
    {dialog?.tipo === 'conductor' && <ConductorDialog servicio={servicio} item={dialog.item} onClose={() => setDialog(null)} onSaved={alGuardar} />}
    {dialog?.tipo === 'asignacion' && <AsignacionDialog servicio={servicio} vehiculos={activosV} conductores={activosC} onClose={() => setDialog(null)} onSaved={alGuardar} />}
    {dialog?.tipo === 'cancelar' && <CancelarDialog servicio={servicio} item={dialog.item} onClose={() => setDialog(null)} onSaved={alGuardar} />}
  </>
}

export default function FlotaPage() {
  const almacen = useAlmacenLogistica()
  if (!almacen) return <section className="ws-card ws-empty-compact"><RefreshCw size={20} className="ws-spin" /><strong>Cargando…</strong></section>
  return <FlotaContenido almacen={almacen} />
}
