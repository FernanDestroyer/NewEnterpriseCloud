import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Eye, MapPinned, Pencil, Plus, RefreshCw, ShieldCheck, Truck, X } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useRecords } from '../../context/RecordsContext'
import { money } from '../../data/helpers'
import { friendlyError } from '../../services/records'
import { CancelarDespachoDialog, DespachoDialog } from './DespachoDialog'
import { crearDespachoService } from './despachoService'
import { coberturaVenta, ESTADOS_DESPACHO, puedeTransicionar, unidadesDeDespacho, ventasDespachables, zonasDeRuta, type CoberturaVenta, type VentaDespachable } from './despachos'
import { crearFlotaService } from './flotaService'
import { crearFuenteSupabase, type ContextoLogistico } from './fuentes'
import { permisosLogistica } from './permisos'
import { formatoFecha, tipoLabel } from './rules'
import type { AlmacenLogistica } from './storage'
import { useAlmacenLogistica } from './useAlmacen'
import type { Conductor, Despacho, EstadoDespacho, Vehiculo } from './types'

type Pestana = 'por-despachar' | 'despachos'
type DialogState = { tipo: 'despacho'; despacho?: Despacho; ventas?: VentaDespachable[] } | { tipo: 'cancelar'; item: Despacho } | null
type VentaFila = VentaDespachable & { cobertura: CoberturaVenta }

const CONTEXTO_VACIO: ContextoLogistico = { almacenes: [], zonaPorCliente: {}, avisos: [] }
const PRIORIDAD_TONO = { normal: '', alta: 'amber', urgente: 'red' } as const

function DespachosContenido({ almacen }: { almacen: AlmacenLogistica }) {
  const { can } = useAuth()
  const { records, notify } = useRecords()
  const permisos = permisosLogistica(can)
  const flota = useMemo(() => crearFlotaService(almacen), [almacen])
  const servicio = useMemo(() => crearDespachoService(almacen, flota), [almacen, flota])
  const fuente = useMemo(() => crearFuenteSupabase(), [])

  const [pestana, setPestana] = useState<Pestana>('por-despachar')
  const [despachos, setDespachos] = useState<Despacho[]>([])
  const [vehiculos, setVehiculos] = useState<Vehiculo[]>([])
  const [conductores, setConductores] = useState<Conductor[]>([])
  const [contexto, setContexto] = useState<ContextoLogistico>(CONTEXTO_VACIO)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set())
  const [filtroEstado, setFiltroEstado] = useState<'todos' | EstadoDespacho>('todos')
  const [dialog, setDialog] = useState<DialogState>(null)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    if (!permisos.ver) return
    let vigente = true
    setCargando(true)
    void Promise.all([servicio.listar(), flota.listarVehiculos(), flota.listarConductores(), fuente.contexto()])
      .then(([d, v, c, ctx]) => { if (vigente) { setDespachos(d); setVehiculos(v); setConductores(c); setContexto(ctx); setError('') } })
      .catch(reason => { if (vigente) setError(friendlyError(reason)) })
      .finally(() => { if (vigente) setCargando(false) })
    return () => { vigente = false }
  }, [servicio, flota, fuente, permisos.ver, version])

  const recargar = useCallback(() => setVersion(actual => actual + 1), [])
  const alGuardar = useCallback((mensaje: string) => { setDialog(null); setSeleccion(new Set()); notify(mensaje); recargar() }, [notify, recargar])

  const ventas = useMemo<VentaFila[]>(() => ventasDespachables(records.sales, records.customers, contexto.zonaPorCliente)
    .map(venta => ({ ...venta, cobertura: coberturaVenta(venta.ventaId, despachos) }))
    .filter(venta => venta.cobertura !== 'completa'), [records.sales, records.customers, contexto.zonaPorCliente, despachos])
  const elegidas = ventas.filter(venta => seleccion.has(venta.ventaId))
  const visibles = despachos.filter(item => filtroEstado === 'todos' || item.estado === filtroEstado)
  const conteoPorEstado = useMemo(() => {
    const conteo: Record<EstadoDespacho, number> = { borrador: 0, programado: 0, en_ruta: 0, completado: 0, cancelado: 0 }
    for (const item of despachos) conteo[item.estado] += 1
    return conteo
  }, [despachos])
  const vehiculoPorId = useMemo(() => new Map(vehiculos.map(item => [item.id, item])), [vehiculos])
  const conductorPorId = useMemo(() => new Map(conductores.map(item => [item.id, item])), [conductores])

  const alternar = (ventaId: string) => setSeleccion(actual => { const nuevo = new Set(actual); if (nuevo.has(ventaId)) nuevo.delete(ventaId); else nuevo.add(ventaId); return nuevo })
  const todasMarcadas = ventas.length > 0 && elegidas.length === ventas.length
  const alternarTodas = () => setSeleccion(todasMarcadas ? new Set() : new Set(ventas.map(venta => venta.ventaId)))

  if (!permisos.ver) return <section className="ws-card ws-empty-compact"><ShieldCheck size={28} /><strong>Acceso restringido a Logística</strong><span>Tu rol necesita permiso de consulta para planificar despachos.</span></section>

  const vehiculosActivos = vehiculos.filter(item => item.estado === 'activo')
  const conductoresActivos = conductores.filter(item => item.estado === 'activo')

  return <>
    <section className="ws-page-heading"><div><span className="ws-eyebrow">LOGÍSTICA Y TRANSPORTE</span><h1>Planificación de despachos y rutas</h1><p>Agrupa las ventas por entregar, ordena la ruta por zona y reserva vehículo y conductor sin cruces de horario.</p></div>
      <div className="ws-heading-actions">
        <button className="ws-button ws-button-secondary" type="button" disabled={cargando} onClick={recargar}><RefreshCw size={16} className={cargando ? 'ws-spin' : ''} />Actualizar</button>
        {permisos.crear && pestana === 'por-despachar' && <button className="ws-button" type="button" disabled={!elegidas.length} title={elegidas.length ? undefined : 'Marca al menos una venta'} onClick={() => setDialog({ tipo: 'despacho', ventas: elegidas })}><Plus size={16} />Crear despacho{elegidas.length > 0 && ` (${elegidas.length})`}</button>}
      </div></section>
    {almacen.origen === 'navegador' && <div className="ws-notice" role="status"><AlertTriangle size={18} /><span><b>Datos guardados solo en este navegador.</b> Las tablas de Logística no están disponibles en tu base de datos, por lo que los despachos no se comparten con otras personas ni quedan en la bitácora. Las ventas, clientes y zonas sí son las reales del sistema.</span></div>}
    {almacen.despachosEnNavegador && <div className="ws-notice" role="status"><AlertTriangle size={18} /><span><b>Los despachos se guardan solo en este navegador.</b> Falta la tabla <code>despachos</code> en tu base de datos: ejecuta <code>20261104010000_despachos.sql</code> en el SQL Editor de Supabase para compartirlos con el equipo y registrarlos en la bitácora. Vehículos, conductores y asignaciones ya usan la base de datos.</span></div>}
    {error && <div className="ws-notice ws-notice-warning" role="alert"><AlertTriangle size={18} /><span>{error}</span><button className="ws-text-button" type="button" onClick={recargar}>Reintentar</button></div>}
    {contexto.avisos.map(aviso => <div className="ws-notice ws-notice-warning" role="status" key={aviso}><AlertTriangle size={18} /><span>{aviso}</span></div>)}
    {!cargando && (!vehiculosActivos.length || !conductoresActivos.length) && <div className="ws-notice ws-notice-warning" role="status"><Truck size={18} /><span>Para programar un despacho necesitas al menos un vehículo y un conductor activos. Regístralos en <b>Vehículos y conductores</b>; mientras tanto puedes guardar borradores.</span></div>}

    <div className="ws-tabs ws-fleet-tabs" role="tablist" aria-label="Secciones de la planificación">
      <button id="desp-tab-por-despachar" role="tab" aria-selected={pestana === 'por-despachar'} aria-controls="desp-panel" onClick={() => setPestana('por-despachar')}><MapPinned size={14} />Por despachar<b>{ventas.length}</b></button>
      <button id="desp-tab-despachos" role="tab" aria-selected={pestana === 'despachos'} aria-controls="desp-panel" onClick={() => setPestana('despachos')}><Truck size={14} />Despachos<b>{despachos.length}</b></button>
    </div>

    <section className="ws-card ws-fleet-panel" id="desp-panel" role="tabpanel" aria-labelledby={`desp-tab-${pestana}`}>
      {pestana === 'despachos' && <div className="ws-filter-chips" role="group" aria-label="Filtrar despachos por estado">
        <button type="button" aria-pressed={filtroEstado === 'todos'} onClick={() => setFiltroEstado('todos')}>Todos<b>{despachos.length}</b></button>
        {(Object.keys(ESTADOS_DESPACHO) as EstadoDespacho[]).map(estado => <button key={estado} type="button" aria-pressed={filtroEstado === estado} disabled={!conteoPorEstado[estado] && filtroEstado !== estado} onClick={() => setFiltroEstado(estado)}>{ESTADOS_DESPACHO[estado].label}<b>{conteoPorEstado[estado]}</b></button>)}
      </div>}
      <div className="table-scroll">
        {pestana === 'por-despachar' && <table className="record-table"><thead><tr>
          <th><input type="checkbox" checked={todasMarcadas} onChange={alternarTodas} disabled={!ventas.length || !permisos.crear} aria-label="Marcar todas las ventas" /></th>
          <th>Venta</th><th>Cliente</th><th>Zona</th><th>Dirección de entrega</th><th>Fecha</th><th>Monto</th><th>Despacho</th></tr></thead><tbody>
          {ventas.map(venta => <tr key={venta.ventaId}>
            <td><input type="checkbox" checked={seleccion.has(venta.ventaId)} onChange={() => alternar(venta.ventaId)} disabled={!permisos.crear} aria-label={`Marcar la venta ${venta.codigo}`} /></td>
            <td><span className="record-id">{venta.codigo}</span></td><td>{venta.clienteNombre}</td><td>{venta.zonaNombre || <span className="ws-fleet-muted">Sin zona</span>}</td>
            <td>{venta.direccion || <span className="status-pill amber">Sin dirección</span>}</td><td>{venta.fecha}</td><td>{money(venta.monto)}</td>
            <td>{venta.cobertura === 'parcial' ? <span className="status-pill blue">Parcial</span> : <span className="ws-fleet-muted">Pendiente</span>}</td>
          </tr>)}
          {!ventas.length && !cargando && <tr><td colSpan={8}><div className="ws-empty-compact"><MapPinned size={26} /><strong>No hay ventas por despachar</strong><span>Aparecen aquí las ventas registradas que aún no están en un despacho.</span></div></td></tr>}
        </tbody></table>}

        {pestana === 'despachos' && <table className="record-table"><thead><tr><th>Despacho</th><th>Fecha</th><th>Prioridad</th><th>Ruta</th><th>Vehículo</th><th>Conductor</th><th>Carga</th><th>Estado</th><th><span className="sr-only">Acciones</span></th></tr></thead><tbody>
          {visibles.map(item => {
            const vehiculo = item.vehiculoId ? vehiculoPorId.get(item.vehiculoId) : undefined
            const conductor = item.conductorId ? conductorPorId.get(item.conductorId) : undefined
            const estado = ESTADOS_DESPACHO[item.estado]
            return <tr key={item.id}>
              <td><span className="record-id">{item.numero}</span></td><td>{formatoFecha(item.fecha)}</td>
              <td><span className={`status-pill ${PRIORIDAD_TONO[item.prioridad]}`}>{item.prioridad === 'normal' ? 'Normal' : item.prioridad === 'alta' ? 'Alta' : 'Urgente'}</span></td>
              <td>{item.paradas.length} {item.paradas.length === 1 ? 'parada' : 'paradas'}<small className="ws-fleet-motivo">{zonasDeRuta(item.paradas).join(' → ')}</small></td>
              <td>{vehiculo ? `${vehiculo.placa} · ${tipoLabel(vehiculo.tipo)}` : '—'}</td><td>{conductor?.nombre ?? '—'}</td>
              <td>{unidadesDeDespacho(item)} u.{item.pesoEstimadoKg != null && <small className="ws-fleet-motivo">{item.pesoEstimadoKg.toLocaleString('es-PE')} kg</small>}</td>
              <td><span className={`status-pill ${estado.tone}`}>{estado.label}</span></td>
              <td><div className="row-actions">
                <button className="row-action" type="button" title={item.estado === 'borrador' && permisos.editar ? 'Editar despacho' : 'Ver despacho'} aria-label={`${item.estado === 'borrador' && permisos.editar ? 'Editar' : 'Ver'} el despacho ${item.numero}`} onClick={() => setDialog({ tipo: 'despacho', despacho: item })}>{item.estado === 'borrador' && permisos.editar ? <Pencil size={15} /> : <Eye size={15} />}</button>
                {permisos.editar && puedeTransicionar(item.estado, 'cancelado') && <button className="row-action delete" type="button" title="Cancelar despacho" aria-label={`Cancelar el despacho ${item.numero}`} onClick={() => setDialog({ tipo: 'cancelar', item })}><X size={15} /></button>}
              </div></td>
            </tr>
          })}
          {!visibles.length && !cargando && <tr><td colSpan={9}><div className="ws-empty-compact"><Truck size={26} /><strong>{despachos.length ? 'Ningún despacho con ese estado' : 'Aún no hay despachos'}</strong><span>{despachos.length ? 'Elige «Todos» u otro estado para ver los demás despachos.' : 'Marca ventas en «Por despachar» y crea el primero.'}</span></div></td></tr>}
        </tbody></table>}
        {cargando && <div className="ws-empty-compact"><RefreshCw size={20} className="ws-spin" /><strong>Cargando…</strong></div>}
      </div>
    </section>

    {dialog?.tipo === 'despacho' && <DespachoDialog servicio={servicio} fuente={fuente} despacho={dialog.despacho} ventas={dialog.ventas} despachos={despachos} vehiculos={dialog.despacho ? vehiculos : vehiculosActivos} conductores={dialog.despacho ? conductores : conductoresActivos} almacenes={contexto.almacenes} onClose={() => setDialog(null)} onSaved={alGuardar} />}
    {dialog?.tipo === 'cancelar' && <CancelarDespachoDialog servicio={servicio} item={dialog.item} onClose={() => setDialog(null)} onSaved={alGuardar} />}
  </>
}

export default function DespachosPage() {
  const almacen = useAlmacenLogistica()
  if (!almacen) return <section className="ws-card ws-empty-compact"><RefreshCw size={20} className="ws-spin" /><strong>Cargando…</strong></section>
  return <DespachosContenido almacen={almacen} />
}
