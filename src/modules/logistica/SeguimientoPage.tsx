import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, ClipboardCheck, History, PackageCheck, Phone, Play, RefreshCw, Route, ShieldCheck, Truck, Undo2 } from 'lucide-react'
import ConfirmModal from '../../components/ConfirmModal'
import { useAuth } from '../../context/AuthContext'
import { useRecords } from '../../context/RecordsContext'
import { friendlyError } from '../../services/records'
import { crearDespachoService } from './despachoService'
import { ESTADOS_DESPACHO, unidadesDeParada } from './despachos'
import { crearFlotaService, etiquetaVehiculo } from './flotaService'
import { permisosLogistica } from './permisos'
import { ahoraLima, formatoFecha } from './rules'
import { devolucionesDe, estadoParada, lineasDevueltas, motivoLabel, motivosParaCompletar, RESULTADOS_ENTREGA, resumenSeguimiento, unidadesEntregadas } from './seguimiento'
import { EntregaDialog, formatoMomento, LineaTiempoDialog, ReingresoDialog } from './SeguimientoDialogs'
import type { AlmacenLogistica } from './storage'
import { useAlmacenLogistica } from './useAlmacen'
import type { Conductor, Despacho, Parada, Vehiculo } from './types'

type Pestana = 'ruta' | 'devoluciones' | 'historial'
type DialogState =
  | { tipo: 'entrega'; despacho: Despacho; parada: Parada }
  | { tipo: 'reingreso'; despacho: Despacho; parada: Parada }
  | { tipo: 'tiempo'; despacho: Despacho }
  | { tipo: 'iniciar'; despacho: Despacho }
  | { tipo: 'completar'; despacho: Despacho }
  | null

const PRIORIDAD_TONO = { normal: '', alta: 'amber', urgente: 'red' } as const

function SeguimientoContenido({ almacen }: { almacen: AlmacenLogistica }) {
  const { can } = useAuth()
  const { notify } = useRecords()
  const permisos = permisosLogistica(can)
  const flota = useMemo(() => crearFlotaService(almacen), [almacen])
  const servicio = useMemo(() => crearDespachoService(almacen, flota), [almacen, flota])

  const [pestana, setPestana] = useState<Pestana>('ruta')
  const [despachos, setDespachos] = useState<Despacho[]>([])
  const [vehiculos, setVehiculos] = useState<Vehiculo[]>([])
  const [conductores, setConductores] = useState<Conductor[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [dialog, setDialog] = useState<DialogState>(null)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    if (!permisos.ver) return
    let vigente = true
    setCargando(true)
    void Promise.all([servicio.listar(), flota.listarVehiculos(), flota.listarConductores()])
      .then(([d, v, c]) => { if (vigente) { setDespachos(d); setVehiculos(v); setConductores(c); setError('') } })
      .catch(reason => { if (vigente) setError(friendlyError(reason)) })
      .finally(() => { if (vigente) setCargando(false) })
    return () => { vigente = false }
  }, [servicio, flota, permisos.ver, version])

  const recargar = useCallback(() => setVersion(actual => actual + 1), [])
  const alGuardar = useCallback((mensaje: string) => { setDialog(null); notify(mensaje); recargar() }, [notify, recargar])
  const ejecutar = useCallback(async (accion: () => Promise<unknown>, exito: string) => {
    try { await accion(); alGuardar(exito) } catch (reason) { setDialog(null); notify(friendlyError(reason)); recargar() }
  }, [alGuardar, notify, recargar])

  const vehiculoPorId = useMemo(() => new Map(vehiculos.map(item => [item.id, item])), [vehiculos])
  const conductorPorId = useMemo(() => new Map(conductores.map(item => [item.id, item])), [conductores])
  const hoy = ahoraLima().slice(0, 10)

  const enCurso = useMemo(() => despachos.filter(item => item.estado === 'programado' || item.estado === 'en_ruta')
    .sort((a, b) => (a.estado === b.estado ? a.fecha.localeCompare(b.fecha) || a.numero.localeCompare(b.numero) : a.estado === 'en_ruta' ? -1 : 1)), [despachos])
  const historial = useMemo(() => despachos.filter(item => item.estado === 'completado' || item.estado === 'cancelado'), [despachos])
  const devoluciones = useMemo(() => devolucionesDe(despachos), [despachos])
  const pendientes = devoluciones.filter(item => item.estado === 'pendiente')
  const entregasHoy = despachos.flatMap(item => item.paradas).filter(parada => parada.entrega && parada.entrega.resultado !== 'no_entregada'
    && new Date(parada.entrega.registradoEn).toLocaleDateString('en-CA', { timeZone: 'America/Lima' }) === hoy).length

  if (!permisos.ver) return <section className="ws-card ws-empty-compact"><ShieldCheck size={28} /><strong>Acceso restringido a Logística</strong><span>Tu rol necesita permiso de consulta para ver el seguimiento.</span></section>

  return <>
    <section className="ws-page-heading"><div><span className="ws-eyebrow">LOGÍSTICA Y TRANSPORTE</span><h1>Seguimiento, entrega y devoluciones</h1><p>Sigue cada ruta: marca la salida, registra qué se entregó en cada parada y controla lo que vuelve al almacén.</p></div>
      <div className="ws-heading-actions"><button className="ws-button ws-button-secondary" type="button" disabled={cargando} onClick={recargar}><RefreshCw size={16} className={cargando ? 'ws-spin' : ''} />Actualizar</button></div></section>
    {almacen.origen === 'navegador' && <div className="ws-notice" role="status"><AlertTriangle size={18} /><span><b>Datos guardados solo en este navegador.</b> Las tablas de Logística no están disponibles en tu base de datos.</span></div>}
    {almacen.despachosEnNavegador && <div className="ws-notice" role="status"><AlertTriangle size={18} /><span><b>Los despachos se guardan solo en este navegador.</b> Ejecuta <code>20261104010000_despachos.sql</code> y <code>20261104030000_seguimiento_despachos.sql</code> en el SQL Editor de Supabase para compartirlos y registrarlos en la bitácora.</span></div>}
    {error && <div className="ws-notice ws-notice-warning" role="alert"><AlertTriangle size={18} /><span>{error}</span><button className="ws-text-button" type="button" onClick={recargar}>Reintentar</button></div>}

    <div className="ws-seg-kpis">
      <div className="ws-seg-kpi"><Play size={16} /><span>Por salir</span><b>{enCurso.filter(item => item.estado === 'programado').length}</b></div>
      <div className="ws-seg-kpi is-blue"><Route size={16} /><span>En ruta</span><b>{enCurso.filter(item => item.estado === 'en_ruta').length}</b></div>
      <div className="ws-seg-kpi is-green"><CheckCircle2 size={16} /><span>Entregas de hoy</span><b>{entregasHoy}</b></div>
      <div className={`ws-seg-kpi${pendientes.length ? ' is-amber' : ''}`}><Undo2 size={16} /><span>Devoluciones pendientes</span><b>{pendientes.length}</b></div>
    </div>

    <div className="ws-tabs ws-fleet-tabs" role="tablist" aria-label="Secciones del seguimiento">
      <button role="tab" aria-selected={pestana === 'ruta'} onClick={() => setPestana('ruta')}><Truck size={14} />En curso<b>{enCurso.length}</b></button>
      <button role="tab" aria-selected={pestana === 'devoluciones'} onClick={() => setPestana('devoluciones')}><Undo2 size={14} />Devoluciones<b>{pendientes.length}</b></button>
      <button role="tab" aria-selected={pestana === 'historial'} onClick={() => setPestana('historial')}><History size={14} />Historial<b>{historial.length}</b></button>
    </div>

    {pestana === 'ruta' && <div className="ws-seg-list">
      {!enCurso.length && !cargando && <section className="ws-card ws-empty-compact"><Route size={26} /><strong>No hay rutas por seguir</strong><span>Programa un despacho en «Planificación de despachos y rutas» y aparecerá aquí para iniciar la ruta.</span></section>}
      {enCurso.map(despacho => {
        const resumen = resumenSeguimiento(despacho)
        const vehiculo = despacho.vehiculoId ? vehiculoPorId.get(despacho.vehiculoId) : undefined
        const conductor = despacho.conductorId ? conductorPorId.get(despacho.conductorId) : undefined
        const enRuta = despacho.estado === 'en_ruta'
        const faltan = motivosParaCompletar(despacho)
        return <article className="ws-card ws-seg-card" key={despacho.id}>
          <header className="ws-seg-head">
            <div>
              <div className="ws-seg-title"><span className="record-id">{despacho.numero}</span><span className={`status-pill ${ESTADOS_DESPACHO[despacho.estado].tone}`}>{ESTADOS_DESPACHO[despacho.estado].label}</span>{despacho.prioridad !== 'normal' && <span className={`status-pill ${PRIORIDAD_TONO[despacho.prioridad]}`}>{despacho.prioridad === 'urgente' ? 'Urgente' : 'Alta'}</span>}</div>
              <small>{formatoFecha(despacho.fecha)} · {vehiculo ? etiquetaVehiculo(vehiculo) : 'Sin vehículo'} · {conductor?.nombre ?? 'Sin conductor'}{despacho.estado === 'programado' && despacho.fecha > hoy ? ' · programado para otro día' : ''}</small>
            </div>
            <div className="ws-seg-head-actions">
              <button className="ws-button ws-button-secondary" type="button" onClick={() => setDialog({ tipo: 'tiempo', despacho })}><History size={15} />Línea de tiempo</button>
              {permisos.editar && !enRuta && <button className="ws-button" type="button" onClick={() => setDialog({ tipo: 'iniciar', despacho })}><Play size={15} />Iniciar ruta</button>}
              {permisos.editar && enRuta && <button className="ws-button" type="button" disabled={faltan.length > 0} title={faltan[0]} onClick={() => setDialog({ tipo: 'completar', despacho })}><CheckCircle2 size={15} />Completar despacho</button>}
            </div>
          </header>
          <div className="ws-seg-progress"><div className="ws-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(resumen.porcentaje * 100)} aria-label="Paradas resueltas"><i className={resumen.porcentaje >= 1 ? 'green' : ''} style={{ width: `${resumen.porcentaje * 100}%` }} /></div>
            <small><b>{resumen.resueltas}</b> de {resumen.total} paradas resueltas{resumen.unidadesDevueltas > 0 && ` · ${resumen.unidadesDevueltas} u. por devolver`}</small></div>
          <ol className="ws-seg-stops">
            {despacho.paradas.map(parada => {
              const estado = estadoParada(parada)
              return <li key={parada.id} className={`ws-seg-stop is-${estado}`}>
                <span className="ws-seg-order">{parada.orden}</span>
                <div className="ws-seg-stop-main">
                  <strong>{parada.clienteNombre}</strong>
                  <small>{parada.ventaCodigo} · {parada.direccion || 'Sin dirección'}{parada.zonaNombre ? ` · ${parada.zonaNombre}` : ''} · {unidadesDeParada(parada)} u.</small>
                  {parada.entrega && <small className="ws-seg-result">{parada.entrega.receptor && `Recibió ${parada.entrega.receptor} · `}{formatoMomento(parada.entrega.registradoEn)}{parada.entrega.motivo && ` · ${motivoLabel(parada.entrega.motivo)}`}{parada.entrega.resultado === 'parcial' && ` · ${unidadesEntregadas(parada)} de ${unidadesDeParada(parada)} u.`}</small>}
                </div>
                <div className="ws-seg-stop-side">
                  {estado === 'pendiente' ? <span className="status-pill">Pendiente</span> : <span className={`status-pill ${RESULTADOS_ENTREGA[estado].tone}`}>{RESULTADOS_ENTREGA[estado].label}</span>}
                  {parada.telefono && <a className="row-action" href={`tel:${parada.telefono}`} title={`Llamar al ${parada.telefono}`} aria-label={`Llamar a ${parada.clienteNombre}`}><Phone size={15} /></a>}
                  {permisos.editar && enRuta && estado === 'pendiente' && <button className="ws-button ws-button-secondary" type="button" onClick={() => setDialog({ tipo: 'entrega', despacho, parada })}><PackageCheck size={15} />Registrar entrega</button>}
                </div>
              </li>
            })}
          </ol>
        </article>
      })}
    </div>}

    {pestana === 'devoluciones' && <section className="ws-card ws-fleet-panel">
      <div className="ws-seg-hint ws-seg-hint-bar"><ClipboardCheck size={14} />Lo que no se entregó vuelve al almacén. Confirmar el reingreso deja constancia, <b>pero no modifica el stock</b>. Estas ventas vuelven a aparecer en «Por despachar» para programarlas de nuevo.</div>
      <div className="table-scroll"><table className="ws-fleet-table"><thead><tr><th>Despacho</th><th>Venta y cliente</th><th>Devuelto</th><th>Motivo</th><th>Estado</th><th><span className="sr-only">Acciones</span></th></tr></thead><tbody>
        {devoluciones.map(fila => <tr key={`${fila.despacho.id}-${fila.parada.id}`}>
          <td><div className="ws-cell-stack"><span className="record-id">{fila.despacho.numero}</span><small>{formatoFecha(fila.despacho.fecha)}</small></div></td>
          <td><div className="ws-cell-stack"><span>{fila.parada.ventaCodigo}</span><small>{fila.parada.clienteNombre}</small></div></td>
          <td><div className="ws-cell-stack">{lineasDevueltas(fila.parada).map(item => <span key={item.linea.productoId}>{item.cantidad} × {item.linea.nombre}</span>)}</div></td>
          <td>{fila.parada.entrega?.motivo ? motivoLabel(fila.parada.entrega.motivo) : '—'}</td>
          <td>{fila.estado === 'pendiente' ? <span className="status-pill amber">Pendiente de reingreso</span> : <div className="ws-cell-stack"><span className="status-pill green">Reingresada</span><small>{fila.parada.devolucion?.reingresadaEn ? formatoMomento(fila.parada.devolucion.reingresadaEn) : ''}</small></div>}</td>
          <td>{permisos.editar && fila.estado === 'pendiente' && <button className="ws-button ws-button-secondary" type="button" onClick={() => setDialog({ tipo: 'reingreso', despacho: fila.despacho, parada: fila.parada })}><ClipboardCheck size={15} />Confirmar reingreso</button>}</td>
        </tr>)}
        {!devoluciones.length && !cargando && <tr><td colSpan={6}><div className="ws-empty-compact"><Undo2 size={24} /><strong>No hay devoluciones</strong><span>Aparecen cuando una entrega queda parcial o no se puede realizar.</span></div></td></tr>}
      </tbody></table></div>
    </section>}

    {pestana === 'historial' && <section className="ws-card ws-fleet-panel"><div className="table-scroll"><table className="ws-fleet-table"><thead><tr><th>Despacho</th><th>Fecha</th><th>Vehículo y conductor</th><th>Resultado de las paradas</th><th>Estado</th><th><span className="sr-only">Acciones</span></th></tr></thead><tbody>
      {historial.map(despacho => {
        const resumen = resumenSeguimiento(despacho)
        const vehiculo = despacho.vehiculoId ? vehiculoPorId.get(despacho.vehiculoId) : undefined
        return <tr key={despacho.id}>
          <td><span className="record-id">{despacho.numero}</span></td><td>{formatoFecha(despacho.fecha)}</td>
          <td><div className="ws-cell-stack"><span>{vehiculo ? etiquetaVehiculo(vehiculo) : '—'}</span><small>{despacho.conductorId ? conductorPorId.get(despacho.conductorId)?.nombre ?? '—' : '—'}</small></div></td>
          <td>{despacho.estado === 'cancelado' ? <span className="ws-fleet-muted">Cancelado: {despacho.motivoCancelacion}</span> : <div className="ws-seg-chips"><span className="status-pill green">{resumen.entregadas} entregadas</span>{resumen.parciales > 0 && <span className="status-pill amber">{resumen.parciales} parciales</span>}{resumen.noEntregadas > 0 && <span className="status-pill red">{resumen.noEntregadas} no entregadas</span>}</div>}</td>
          <td><span className={`status-pill ${ESTADOS_DESPACHO[despacho.estado].tone}`}>{ESTADOS_DESPACHO[despacho.estado].label}</span></td>
          <td><button className="row-action" type="button" title="Ver línea de tiempo" aria-label={`Línea de tiempo de ${despacho.numero}`} onClick={() => setDialog({ tipo: 'tiempo', despacho })}><History size={15} /></button></td>
        </tr>
      })}
      {!historial.length && !cargando && <tr><td colSpan={6}><div className="ws-empty-compact"><History size={24} /><strong>Aún no hay historial</strong><span>Los despachos completados o cancelados quedan aquí.</span></div></td></tr>}
    </tbody></table></div></section>}

    {dialog?.tipo === 'entrega' && <EntregaDialog servicio={servicio} despacho={dialog.despacho} parada={dialog.parada} onClose={() => setDialog(null)} onSaved={alGuardar} />}
    {dialog?.tipo === 'reingreso' && <ReingresoDialog servicio={servicio} despacho={dialog.despacho} parada={dialog.parada} onClose={() => setDialog(null)} onSaved={alGuardar} />}
    {dialog?.tipo === 'tiempo' && <LineaTiempoDialog despacho={dialog.despacho} onClose={() => setDialog(null)} />}
    {dialog?.tipo === 'iniciar' && <ConfirmModal title="Iniciar ruta" message={`El despacho ${dialog.despacho.numero} pasará a «En ruta» y quedará registrada la hora de salida.`} confirmLabel="Iniciar ruta" onCancel={() => setDialog(null)} onConfirm={() => ejecutar(() => servicio.iniciarRuta(dialog.despacho), 'Ruta iniciada.')} />}
    {dialog?.tipo === 'completar' && <ConfirmModal title="Completar despacho" message={`Se cerrará la ruta ${dialog.despacho.numero} y se liberarán el vehículo y el conductor. Esta acción no se puede deshacer.`} confirmLabel="Completar despacho" onCancel={() => setDialog(null)} onConfirm={() => ejecutar(() => servicio.completar(dialog.despacho), 'Despacho completado.')} />}
  </>
}

export default function SeguimientoPage() {
  const almacen = useAlmacenLogistica()
  if (!almacen) return <section className="ws-card ws-empty-compact"><RefreshCw size={20} className="ws-spin" /><strong>Cargando…</strong></section>
  return <SeguimientoContenido almacen={almacen} />
}
