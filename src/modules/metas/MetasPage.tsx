import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { AlertTriangle, Award, ClipboardCheck, ClipboardList, Pencil, Plus, RefreshCw, ShieldCheck, Target, Trash2, TrendingUp } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useRecords } from '../../context/RecordsContext'
import { friendlyError } from '../../services/records'
import { AsignacionDialog, ConfirmarEliminar, CorteDialog, MetaDialog } from './MetasDialogs'
import { cargarAportes, cargarLogradoVentas, cargarUbicaciones } from './db'
import { asignacionesVinculadas, fusionarCortes, type Aporte, type Ubicacion } from './ventas'
import { permisosMetas } from './permisos'
import { ALCANCES, calcularAvance, fechaLima, ESTADOS_META, formatearValor, mensajeAlerta, porcentaje } from './rules'
import { crearMetasService, type MetasService } from './service'
import { obtenerAlmacenVerificado } from './db'
import AvanceGrafico from './AvanceGrafico'
import type { Asignacion, AvanceFila, Corte, Meta } from './types'

type Pestana = 'definicion' | 'avance' | 'ranking'
type DialogState =
  | { tipo: 'meta'; item?: Meta }
  | { tipo: 'asignacion'; item?: Asignacion }
  | { tipo: 'corte'; asignacion?: Asignacion }
  | { tipo: 'eliminar-meta'; item: Meta }
  | { tipo: 'eliminar-asignacion'; item: Asignacion }
  | null

const VACIO = ({ texto, ayuda }: { texto: string; ayuda: string }) => <div className="ws-empty-compact"><Target size={26} /><strong>{texto}</strong><span>{ayuda}</span></div>

const TONOS: Record<string, 'green' | 'amber' | 'red'> = { green: 'green', amber: 'amber', red: 'red' }

function pestanaDesdeHash(hash: string): Pestana | null {
  return hash === '#avance' ? 'avance' : hash === '#ranking' ? 'ranking' : hash === '#definicion' ? 'definicion' : null
}
function tonoCumplimiento(cumplimiento: number, previsto: number): 'green' | 'amber' | 'red' {
  if (cumplimiento >= previsto) return 'green'
  if (previsto - cumplimiento < 0.10) return 'amber'
  return 'red'
}
type TonoEstado = 'green' | 'amber' | 'red' | 'blue'
/** Estado en palabras simples: cualquiera lo entiende sin interpretar porcentajes. */
function estadoAvance(fila: AvanceFila): { label: string; tone: TonoEstado } {
  if (fila.cumplimiento >= 1) return { label: 'Meta lograda', tone: 'green' }
  if (fila.previsto <= 0) return { label: 'Aún no inicia', tone: 'blue' }
  if (fila.alerta) return { label: 'Atrasada', tone: 'red' }
  if (fila.cumplimiento >= fila.previsto) return { label: 'Al día', tone: 'green' }
  return { label: 'Leve atraso', tone: 'amber' }
}
function BarraAvance({ fila }: { fila: AvanceFila }) {
  const tono = estadoAvance(fila).tone
  const esperado = Math.min(fila.previsto, 1) * 100
  return <div className="ws-progress-cell">
    <div className="ws-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(fila.cumplimiento, 1) * 100)} aria-label={`Avance de ${fila.asignacion.objetivo}`}>
      <i className={tono === 'blue' ? '' : tono} style={{ width: `${Math.min(fila.cumplimiento, 1) * 100}%` }} />
      {esperado > 0 && esperado < 100 && <span style={{ left: `${esperado}%` }} title={`Debería ir en ${porcentaje(fila.previsto)}`} />}
    </div>
    <small><b>{porcentaje(fila.cumplimiento)}</b> logrado · debería ir en {porcentaje(fila.previsto)}</small>
  </div>
}
/** Compara lo repartido entre responsables con la cuota de la meta. */
function estadoReparto(meta: Meta, asignado: number): { label: string; tone: TonoEstado } {
  const diferencia = Math.round((meta.valorObjetivo - asignado) * 100) / 100
  if (asignado <= 0) return { label: 'Sin asignar', tone: 'amber' }
  if (diferencia === 0) return { label: 'Completo', tone: 'green' }
  return diferencia > 0 ? { label: `Faltan ${formatearValor(meta.indicador, diferencia)}`, tone: 'blue' } : { label: `Excede ${formatearValor(meta.indicador, -diferencia)}`, tone: 'amber' }
}
function alcanceEtiqueta(alcance: Asignacion['alcance']): string {
  return ALCANCES.find(opcion => opcion.value === alcance)?.label ?? alcance
}

export default function MetasPage() {
  const { can, profile } = useAuth()
  const { notify } = useRecords()
  const location = useLocation()
  const [servicio, setServicio] = useState<MetasService | null>(null)
  const permisos = permisosMetas(can, profile?.rol === 'Administrador', servicio?.origen === 'navegador')
  const [pestana, setPestana] = useState<Pestana>(() => pestanaDesdeHash(location.hash) ?? 'definicion')
  const [subDefinicion, setSubDefinicion] = useState<'metas' | 'asignaciones'>('metas')
  const [subPestana, setSubPestana] = useState<'ranking' | 'alertas'>('ranking')
  const [metas, setMetas] = useState<Meta[]>([])
  const [asignaciones, setAsignaciones] = useState<Asignacion[]>([])
  const [cortes, setCortes] = useState<Corte[]>([])
  // Avance calculado con las ventas completadas (función metas_logrado); vacío si la migración no se aplicó.
  const [automaticos, setAutomaticos] = useState<Corte[]>([])
  const [ventasDisponible, setVentasDisponible] = useState(false)
  // Aporte de cada vendedor a las metas por sucursal.
  const [aportes, setAportes] = useState<Map<string, Aporte[]>>(new Map())
  // Sucursal y caja de cada vendedor.
  const [ubicaciones, setUbicaciones] = useState<Map<string, Ubicacion>>(new Map())
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [dialog, setDialog] = useState<DialogState>(null)
  const [version, setVersion] = useState(0)

  // Elige la implementación de datos: Supabase si las tablas existen y son accesibles;
  // respaldo local (navegador) si la migración aún no se aplica.
  useEffect(() => {
    let vigente = true
    void obtenerAlmacenVerificado().then(almacen => { if (vigente) setServicio(crearMetasService(almacen)) })
    return () => { vigente = false }
  }, [])

  // Los tres submódulos del menú apuntan a /metas#definicion, #avance y #ranking; al
  // navegar entre ellos la ruta no cambia (solo el hash), así que se sincroniza aquí.
  useEffect(() => {
    const nueva = pestanaDesdeHash(location.hash)
    if (nueva) setPestana(nueva)
  }, [location.hash])

  useEffect(() => {
    if (!permisos.ver || !servicio) return
    let vigente = true
    setCargando(true)
    void Promise.all([servicio.listarMetas(), servicio.listarAsignaciones(), servicio.listarCortes()])
      .then(async ([m, a, c]) => {
        if (!vigente) return
        // Respaldo local recién iniciado: siembra datos de ejemplo para ver el módulo en acción.
    if (!m.length && !a.length && !c.length && servicio.origen === 'navegador') {
      try { await servicio.sembrarEjemplo() } catch { /* los datos de ejemplo no bloquean el módulo */ }
      ;[m, a, c] = await Promise.all([servicio.listarMetas(), servicio.listarAsignaciones(), servicio.listarCortes()])
    }
        setMetas(m); setAsignaciones(a); setCortes(c); setError('')
        if (servicio.origen === 'navegador') { setAutomaticos([]); setVentasDisponible(false); setAportes(new Map()); setUbicaciones(new Map()); return }
        const [logrado, detalle, donde] = await Promise.all([cargarLogradoVentas(), cargarAportes(), cargarUbicaciones()])
        if (vigente) { setAutomaticos(logrado.cortes); setVentasDisponible(logrado.disponible); setAportes(detalle); setUbicaciones(donde) }
      })
      .catch(reason => { if (vigente) setError(friendlyError(reason)) })
      .finally(() => { if (vigente) setCargando(false) })
    return () => { vigente = false }
  }, [servicio, permisos.ver, version])

  const recargar = useCallback(() => setVersion(actual => actual + 1), [])
  const alGuardar = useCallback((mensaje: string) => { setDialog(null); notify(mensaje); recargar() }, [notify, recargar])

  const metaPorId = useMemo(() => new Map(metas.map(item => [item.id, item])), [metas])
  // Cortes que se usan: ventas completadas para lo enlazado; cortes manuales para el resto.
  const cortesEfectivos = useMemo(() => fusionarCortes(cortes, automaticos), [cortes, automaticos])
  const vinculadas = useMemo(() => asignacionesVinculadas(automaticos), [automaticos])
  const filas = useMemo(() => {
    if (!servicio) return []
    return asignaciones
      .map(asignacion => calcularAvance(asignacion, metaPorId.get(asignacion.metaId), cortesEfectivos, servicio.hoy))
      .filter((fila): fila is NonNullable<typeof fila> => Boolean(fila))
  }, [asignaciones, cortesEfectivos, metaPorId, servicio])
  const sinEnlazar = useMemo(() => ventasDisponible ? asignaciones.filter(a => a.estado === 'activa' && !vinculadas.has(a.id)) : [], [ventasDisponible, asignaciones, vinculadas])
  const asignadoPorMeta = useMemo(() => {
    const mapa = new Map<string, number>()
    for (const item of asignaciones) if (item.estado === 'activa') mapa.set(item.metaId, (mapa.get(item.metaId) ?? 0) + item.valorObjetivo)
    return mapa
  }, [asignaciones])
  const alertas = useMemo(() => filas.filter(fila => fila.alerta).sort((a, b) => a.desfase - b.desfase), [filas])
  const ranking = useMemo(() => filas.filter(fila => fila.asignacion.alcance === 'vendedor')
    .sort((a, b) => b.cumplimiento - a.cumplimiento || b.valorReal - a.valorReal), [filas])

  async function eliminarPor(onConfirm: () => Promise<void>) {
    try { await onConfirm(); notify('Registro eliminado.'); recargar() } catch (reason) { notify(friendlyError(reason)) }
  }

  if (!permisos.ver) return <section className="ws-card ws-empty-compact"><ShieldCheck size={28} /><strong>Acceso restringido a Metas y Objetivos</strong><span>Tu rol necesita permiso de consulta (metas:ver) para ver las metas y su avance.</span></section>

  const botones = pestana === 'definicion'
    ? subDefinicion === 'metas'
      ? [{ label: 'Nueva meta', abrir: () => setDialog({ tipo: 'meta' }) }]
      : [{ label: 'Nueva asignación', abrir: () => setDialog({ tipo: 'asignacion' }) }]
    : pestana === 'avance'
      ? [{ label: 'Registrar corte', abrir: () => setDialog({ tipo: 'corte' }) }]
      : []

  return <div className="ws-metas-page">
    <section className="ws-page-heading"><div><span className="ws-eyebrow">GESTIÓN COMERCIAL</span>
      <h1>{pestana === 'definicion' ? 'Definición y asignación de metas' : pestana === 'avance' ? 'Avance por vendedor, sucursal o producto' : 'Ranking y alertas de cumplimiento'}</h1>
      <p>{pestana === 'definicion' ? 'Crea la meta general y repártela en cuotas para cada vendedor, sucursal o producto.'
        : pestana === 'avance' ? 'Mira cuánto lleva logrado cada responsable frente a su cuota y a lo que debería llevar a hoy.'
        : 'Quién va primero entre los vendedores y qué asignaciones van atrasadas y necesitan atención.'}</p></div>
      <div className="ws-heading-actions">
        <button className="ws-button ws-button-secondary" type="button" disabled={cargando} onClick={recargar}><RefreshCw size={16} className={cargando ? 'ws-spin' : ''} />Actualizar</button>
        {permisos.crear && servicio && botones.map(boton => <button key={boton.label} className="ws-button" type="button" onClick={boton.abrir}><Plus size={16} />{boton.label}</button>)}
      </div></section>
    {permisos.ver && servicio?.origen === 'navegador' && <div className="ws-notice" role="status"><AlertTriangle size={18} /><span><b>Las tablas de Metas aún no están disponibles en tu base de datos.</b> Ejecuta la migración <code>20261103000000_metas_objetivos.sql</code> en el SQL Editor de Supabase para compartirlas con el equipo; mientras tanto se guardan en este navegador.</span></div>}
    {error && <div className="ws-notice ws-notice-warning" role="alert"><AlertTriangle size={18} /><span>{error}</span><button className="ws-text-button" type="button" onClick={recargar}>Reintentar</button></div>}
    {pestana === 'ranking' && alertas.length > 0 && <div className="ws-notice ws-notice-warning" role="status"><AlertTriangle size={18} /><span><b>{alertas.length} {alertas.length === 1 ? 'asignación requiere atención' : 'asignaciones requieren atención'}:</b> avanzan por debajo del ritmo esperado del periodo.</span></div>}

    {cargando && <section className="ws-card"><div className="ws-empty-compact" style={{ fontFamily: 'inherit' }}><RefreshCw size={20} className="ws-spin" /><strong>Cargando…</strong></div></section>}

    {pestana === 'definicion' && <>
      <ol className="ws-metas-steps" aria-label="Cómo funciona">
        <li><span><b>Crea la meta</b> con su objetivo y fechas</span></li>
        <li><span><b>Asigna cuotas</b> a vendedores, sucursales o productos</span></li>
        <li><span>Las <b>ventas completadas</b> suman solas al avance (los cortes manuales son el respaldo)</span></li>
      </ol>
      <div className="ws-tabs ws-fleet-tabs" role="tablist" aria-label="Secciones de definición y asignación">
        <button role="tab" aria-selected={subDefinicion === 'metas'} onClick={() => setSubDefinicion('metas')}><Target size={14} />Metas definidas<b>{metas.length}</b></button>
        <button role="tab" aria-selected={subDefinicion === 'asignaciones'} onClick={() => setSubDefinicion('asignaciones')}><ClipboardList size={14} />Asignaciones<b>{asignaciones.length}</b></button>
      </div>

      {subDefinicion === 'metas' && <section className="ws-card"><header className="ws-card-heading"><h2>Metas definidas</h2><p>Cada meta es el objetivo general. «Repartido en cuotas» indica cuánto ya se asignó a responsables.</p></header>
        <div className="table-scroll">
          <table className="record-table"><thead><tr><th>Meta</th><th>Se mide en</th><th>Objetivo</th><th>Repartido en cuotas</th><th>Vigencia</th><th>Responsable</th><th>Estado</th><th><span className="sr-only">Acciones</span></th></tr></thead><tbody>
            {metas.map(item => <tr key={item.id}>
              <td><div className="ws-cell-stack"><span className="record-id">{item.codigo}</span><small>{item.nombre}</small></div></td><td>{item.indicador === 'importe' ? 'Importe (S/)' : 'Unidades'}</td>
              <td>{formatearValor(item.indicador, item.valorObjetivo)}</td>
              <td>{(() => { const asignado = asignadoPorMeta.get(item.id) ?? 0; const reparto = estadoReparto(item, asignado); return <div className="ws-cell-stack"><span>{formatearValor(item.indicador, asignado)}</span><span className={`status-pill ${reparto.tone}`}>{reparto.label}</span></div> })()}</td>
              <td>{item.desde} — {item.hasta}</td><td>{item.responsable || '—'}</td>
              <td><span className={`status-pill ${ESTADOS_META[item.estado].tone}`}>{ESTADOS_META[item.estado].label}</span></td>
              <td>{(permisos.editar || permisos.eliminar) && <div className="row-actions">
                {permisos.editar && <button className="row-action" type="button" title="Editar meta" aria-label={`Editar meta ${item.codigo}`} onClick={() => setDialog({ tipo: 'meta', item })}><Pencil size={15} /></button>}
                {permisos.eliminar && <button className="row-action delete" type="button" title="Eliminar meta" aria-label={`Eliminar meta ${item.codigo}`} onClick={() => setDialog({ tipo: 'eliminar-meta', item })}><Trash2 size={15} /></button>}
              </div>}</td>
            </tr>)}
            {!metas.length && !cargando && <tr><td colSpan={8}><VACIO texto="Aún no hay metas" ayuda="Registra la primera con «Nueva meta»." /></td></tr>}
          </tbody></table>
        </div>
      </section>}
      {subDefinicion === 'asignaciones' && <section className="ws-card"><header className="ws-card-heading"><h2>Asignaciones por vendedor, sucursal o producto</h2><p>La cuota que debe cumplir cada vendedor, sucursal o producto.</p></header>
        <div className="table-scroll">
          <table className="record-table"><thead><tr><th>Asignado a</th><th>Meta</th><th>Cuota</th><th>Estado</th><th><span className="sr-only">Acciones</span></th></tr></thead><tbody>
            {asignaciones.map(item => <tr key={item.id}>
              <td><div className="ws-cell-stack"><span>{item.objetivo}</span><small>{alcanceEtiqueta(item.alcance)}</small></div></td>
              <td><span className="record-id">{metaPorId.get(item.metaId)?.codigo ?? '—'}</span></td>
              <td>{formatearValor(metaPorId.get(item.metaId)?.indicador ?? 'importe', item.valorObjetivo)}</td>
              <td><span className={`status-pill ${item.estado === 'activa' ? 'green' : 'red'}`}>{item.estado === 'activa' ? 'Activa' : 'Inactiva'}</span></td>
              <td>{(permisos.editar || permisos.eliminar) && <div className="row-actions">
                {permisos.editar && <button className="row-action" type="button" title="Editar asignación" aria-label={`Editar asignación de ${item.objetivo}`} onClick={() => setDialog({ tipo: 'asignacion', item })}><Pencil size={15} /></button>}
                {permisos.eliminar && <button className="row-action delete" type="button" title="Eliminar asignación" aria-label={`Eliminar asignación de ${item.objetivo}`} onClick={() => setDialog({ tipo: 'eliminar-asignacion', item })}><Trash2 size={15} /></button>}
              </div>}</td>
            </tr>)}
            {!asignaciones.length && !cargando && <tr><td colSpan={5}><VACIO texto="Aún no hay asignaciones" ayuda="Crea una con «Nueva asignación» eligiendo la meta, el alcance y su cuota." /></td></tr>}
          </tbody></table>
        </div>
      </section>}
    </>}

    {pestana === 'avance' && <>
      {servicio?.origen === 'base-de-datos' && !ventasDisponible && !cargando && <div className="ws-notice ws-notice-warning" role="status"><AlertTriangle size={18} /><span><b>El avance aún no se calcula con las ventas.</b> Ejecuta <code>20261104040000_metas_ventas_automaticas.sql</code> en el SQL Editor de Supabase. Mientras tanto se usan los cortes manuales.</span></div>}
      {ventasDisponible && <div className="ws-notice" role="status"><TrendingUp size={18} /><span><b>El avance se calcula solo con las ventas completadas</b> de cada vendedor, sucursal o producto, dentro de las fechas de la meta. La meta de una <b>sucursal</b> suma las ventas de todos sus vendedores, según el turno de caja en que cada uno fue asignado. {vinculadas.size} de {vinculadas.size + sinEnlazar.length} asignaciones están enlazadas.{sinEnlazar.length > 0 && <> <b>Sin enlazar:</b> {sinEnlazar.map(item => item.objetivo).join(', ')}. Edita la asignación y elige de la lista (solo se cuentan las ventas de quien aparece ahí); mientras tanto usan cortes manuales.</>}</span></div>}
      <AvanceGrafico metas={metas} asignaciones={asignaciones} cortes={cortesEfectivos} automatico={vinculadas.size > 0} hoy={servicio?.hoy ?? fechaLima()} onRegistrar={permisos.editar && servicio ? () => setDialog({ tipo: 'corte' }) : undefined} />
      {asignaciones.length > 0 && <section className="ws-card"><header className="ws-card-heading"><h2>Avance por vendedor, sucursal o producto</h2><p>La marca vertical de cada barra indica cuánto debería llevar a hoy; «Registrar corte» (✓) actualiza lo logrado.</p></header>
      <div className="table-scroll">
        <table className="record-table"><thead><tr><th>Asignado a</th><th>Cuota</th><th>Logrado</th><th>Avance</th><th>Estado</th><th>Último dato</th><th><span className="sr-only">Acciones</span></th></tr></thead><tbody>
          {filas.map(fila => { const estado = estadoAvance(fila); return <tr key={fila.asignacion.id}>
            <td><div className="ws-cell-stack"><span>{fila.asignacion.objetivo}</span><small>{alcanceEtiqueta(fila.asignacion.alcance)} · {fila.meta.codigo}</small>{fila.asignacion.alcance === 'vendedor' && ventasDisponible && (() => { const donde = ubicaciones.get(fila.asignacion.id); const suc = donde?.sucursalAsignacionId ? filas.find(item => item.asignacion.id === donde.sucursalAsignacionId) : undefined; return donde ? <small className="ws-aportes"><b>{donde.sucursal}</b> · {donde.caja}{suc && <> · Meta de la sucursal: {formatearValor(suc.meta.indicador, suc.asignacion.valorObjetivo)} (lleva {porcentaje(suc.cumplimiento)})</>}</small> : <small className="ws-aportes">Sin caja asignada: sus ventas cuentan por la sucursal del almacén.</small> })()}{fila.asignacion.alcance === 'sucursal' && (aportes.get(fila.asignacion.id)?.length ?? 0) > 0 && <small className="ws-aportes"><b>Aporte por vendedor:</b> {aportes.get(fila.asignacion.id)!.map(aporte => `${aporte.vendedor} ${formatearValor(fila.meta.indicador, aporte.valor)}`).join(' · ')}</small>}</div></td>
            <td>{formatearValor(fila.meta.indicador, fila.asignacion.valorObjetivo)}</td>
            <td>{formatearValor(fila.meta.indicador, fila.valorReal)}</td>
            <td><BarraAvance fila={fila} /></td>
            <td><span className={`status-pill ${estado.tone}`}>{estado.label}</span></td>
            <td>{fila.corte ? <div className="ws-cell-stack"><span>{fila.corte.fecha}</span><small>{fila.corte.fuente || 'Sin fuente indicada'}</small></div> : <span className="ws-fleet-muted">Sin cortes</span>}</td>
            <td>{permisos.editar && !vinculadas.has(fila.asignacion.id) && <div className="row-actions"><button className="row-action" type="button" title="Registrar corte de avance" aria-label={`Registrar corte de ${fila.asignacion.objetivo}`} onClick={() => setDialog({ tipo: 'corte', asignacion: fila.asignacion })}><ClipboardCheck size={15} /></button></div>}</td>
          </tr> })}
          {!filas.length && !cargando && <tr><td colSpan={7}><VACIO texto="Aún no hay avances" ayuda="Asigna metas activas: el avance se calcula con las ventas completadas." /></td></tr>}
        </tbody></table>
      </div>
      </section>}</>}

    {pestana === 'ranking' && <>
      <div className="ws-tabs ws-fleet-tabs" role="tablist" aria-label="Secciones de ranking y alertas">
        <button role="tab" aria-selected={subPestana === 'ranking'} onClick={() => setSubPestana('ranking')}><Award size={14} />Ranking comercial<b>{ranking.length}</b></button>
        <button role="tab" aria-selected={subPestana === 'alertas'} onClick={() => setSubPestana('alertas')}><AlertTriangle size={14} />Alertas de cumplimiento<b>{alertas.length}</b></button>
      </div>

      {subPestana === 'ranking' && <section className="ws-card"><header className="ws-card-heading"><h2>Ranking comercial por cumplimiento</h2><p>Vendedores ordenados de mayor a menor avance sobre su cuota.</p></header>
        <div className="table-scroll">
          <table className="record-table"><thead><tr><th>Puesto</th><th>Vendedor</th><th>Meta</th><th>Logrado</th><th>Cuota</th><th>Avance</th><th>Estado</th></tr></thead><tbody>
            {ranking.map((fila, index) => { const estado = estadoAvance(fila); return <tr key={fila.asignacion.id}>
              <td><span className={`ws-rank-pos${index < 3 ? ' top' : ''}`}>{index + 1}</span></td>
              <td>{index === 0 && <Award size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />}{fila.asignacion.objetivo}</td>
              <td><span className="record-id">{fila.meta.codigo}</span></td>
              <td>{formatearValor(fila.meta.indicador, fila.valorReal)}</td>
              <td>{formatearValor(fila.meta.indicador, fila.asignacion.valorObjetivo)}</td>
              <td><BarraAvance fila={fila} /></td>
              <td><span className={`status-pill ${estado.tone}`}>{estado.label}</span></td>
            </tr> })}
            {!ranking.length && !cargando && <tr><td colSpan={7}><VACIO texto="Aún no hay ranking" ayuda="Se arma con las asignaciones por vendedor y sus ventas completadas." /></td></tr>}
          </tbody></table>
        </div>
      </section>}
      {subPestana === 'alertas' && <section className="ws-card"><header className="ws-card-heading"><h2>Alertas de cumplimiento</h2><p>Asignaciones que llevan 10 puntos porcentuales o más por debajo de lo esperado a hoy.</p></header>
        <div className="table-scroll">
          <table className="record-table"><thead><tr><th>Asignado a</th><th>Meta</th><th>Avance</th><th>Qué pasa</th></tr></thead><tbody>
            {alertas.map(fila => <tr key={fila.asignacion.id}>
              <td><div className="ws-cell-stack"><span>{fila.asignacion.objetivo}</span><small>{alcanceEtiqueta(fila.asignacion.alcance)}</small></div></td>
              <td><span className="record-id">{fila.meta.codigo}</span></td>
              <td><BarraAvance fila={fila} /></td>
              <td>{mensajeAlerta(fila)}</td>
            </tr>)}
            {!alertas.length && !cargando && <tr><td colSpan={4}><VACIO texto="Sin alertas por ahora" ayuda="Todas las asignaciones van al ritmo esperado. Aquí aparecerán las que se atrasen." /></td></tr>}
          </tbody></table>
        </div>
      </section>}
    </>}

    {dialog?.tipo === 'meta' && servicio && <MetaDialog servicio={servicio} item={dialog.item} onClose={() => setDialog(null)} onSaved={alGuardar} />}
    {dialog?.tipo === 'asignacion' && servicio && <AsignacionDialog servicio={servicio} metas={metas.filter(m => m.estado === 'vigente' || m.id === dialog.item?.metaId)} item={dialog.item} onClose={() => setDialog(null)} onSaved={alGuardar} />}
    {dialog?.tipo === 'corte' && servicio && <CorteDialog servicio={servicio} asignaciones={asignaciones.filter(a => a.estado === 'activa' && !vinculadas.has(a.id))} hayAutomaticas={vinculadas.size > 0} metas={metas} asignacion={dialog.asignacion} onClose={() => setDialog(null)} onSaved={alGuardar} />}
    {dialog?.tipo === 'eliminar-meta' && servicio && <ConfirmarEliminar titulo={`Eliminar meta ${dialog.item.codigo}`} texto="Se eliminarán también sus asignaciones y cortes de avance. Esta acción no se puede deshacer." busyLabel="Eliminar" onClose={() => setDialog(null)} onConfirm={() => eliminarPor(() => servicio.eliminarMeta(dialog.item))} />}
    {dialog?.tipo === 'eliminar-asignacion' && servicio && <ConfirmarEliminar titulo={`Eliminar asignación de ${dialog.item.objetivo}`} texto="Se eliminarán también sus cortes de avance." busyLabel="Eliminar" onClose={() => setDialog(null)} onConfirm={() => eliminarPor(() => servicio.eliminarAsignacion(dialog.item))} />}
  </div>
}
