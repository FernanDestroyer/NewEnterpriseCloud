// Gráfico "Ventas VS Objetivo": barras = lo logrado acumulado a fin de cada mes (según los cortes de
// avance) y línea = objetivo acumulado, ambos en la MISMA escala. Interacción: pasar el cursor (o enfocar
// con el teclado) muestra un detalle flotante; clic o Enter fija el mes y abre su detalle abajo.
// Incluye marca de «Hoy», color de barra según el cumplimiento y un estado vacío con acceso directo a
// «Registrar corte». Solo SVG/HTML, sin librerías de gráficos.
import { useMemo, useState, type KeyboardEvent } from 'react'
import { CalendarDays, ClipboardCheck, Target as TargetIcon, TrendingDown, TrendingUp } from 'lucide-react'
import { formatearValor, porcentaje } from './rules'
import type { Asignacion, Corte, Meta } from './types'

type PuntoMes = { etiqueta: string; inicio: string; fin: string; realMes: number; objetivoMes: number; objetivoAcum: number; realAcum: number }

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const VERDE = '#22c55e', AMBAR = '#f59e0b', ROJO = '#ef4444', NARANJA = '#f97316', AZUL = '#38bdf8'

function finDeMes(inicioMes: string): string {
  const fecha = new Date(`${inicioMes}T12:00:00Z`)
  fecha.setUTCMonth(fecha.getUTCMonth() + 1)
  fecha.setUTCDate(0)
  return fecha.toISOString().slice(0, 10)
}

function diaAntes(valor: string): string {
  const fecha = new Date(`${valor}T12:00:00Z`)
  fecha.setUTCDate(fecha.getUTCDate() - 1)
  return fecha.toISOString().slice(0, 10)
}

function dias(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T12:00:00Z`) - Date.parse(`${desde}T12:00:00Z`)) / 86400000)
}

/** Real acumulado a una fecha: por asignación se usa el último corte con fecha ≤ tope. */
function realAcumuladoHasta(asignaciones: Asignacion[], cortes: Corte[], tope: string): number {
  return asignaciones.reduce((suma, asignacion) => {
    const propios = cortes
      .filter(item => item.asignacionId === asignacion.id && item.fecha <= tope)
      .sort((a, b) => a.fecha.localeCompare(b.fecha))
    return suma + Math.max(0, (propios[propios.length - 1]?.valorAcumulado ?? 0))
  }, 0)
}

/** Aporte de una asignación al mes [desde, hasta] (diferencia de acumulados). */
function aporteDe(asignacion: Asignacion, cortes: Corte[], desde: string, hasta: string): { nombre: string; alcance: string; valor: number } {
  const acumulado = realAcumuladoHasta([asignacion], cortes, hasta)
  const base = realAcumuladoHasta([asignacion], cortes, diaAntes(desde))
  const alcance = asignacion.alcance === 'vendedor' ? 'Vendedor' : asignacion.alcance === 'sucursal' ? 'Sucursal' : 'Producto'
  return { nombre: asignacion.objetivo, alcance, valor: Math.max(0, acumulado - base) }
}

/** Color de la barra según qué tan cerca está de lo que debería llevar a fin de ese mes. */
function colorBarra(punto: PuntoMes): string {
  if (punto.objetivoAcum <= 0) return AZUL
  const razon = punto.realAcum / punto.objetivoAcum
  return razon >= 1 ? VERDE : razon >= 0.8 ? AMBAR : ROJO
}

export default function AvanceGrafico({ metas, asignaciones, cortes, hoy, onRegistrar, automatico = false }: { metas: Meta[]; asignaciones: Asignacion[]; cortes: Corte[]; hoy: string; onRegistrar?: () => void; automatico?: boolean }) {
  const vigentes = metas.filter(meta => meta.estado !== 'inactiva' && /^\d{4}-\d{2}-\d{2}$/.test(meta.desde) && /^\d{4}-\d{2}-\d{2}$/.test(meta.hasta))
  const [metaId, setMetaId] = useState<string | null>(null)
  const [mesElegido, setMesElegido] = useState<number | null>(null)
  const [mesCursor, setMesCursor] = useState<number | null>(null)
  const meta = vigentes.find(item => item.id === metaId) ?? vigentes[0]
  const propias = useMemo(() => meta ? asignaciones.filter(item => item.metaId === meta.id && item.estado === 'activa') : [], [meta, asignaciones])

  const datos = useMemo<PuntoMes[]>(() => {
    if (!meta) return []
    const cuota = meta.valorObjetivo
    const meses: { inicio: string; fin: string }[] = []
    let cursor = `${meta.desde.slice(0, 7)}-01`
    while (cursor <= meta.hasta && meses.length < 24) {
      meses.push({ inicio: cursor, fin: finDeMes(cursor) < meta.hasta ? finDeMes(cursor) : meta.hasta })
      const siguiente = new Date(`${cursor}T12:00:00Z`)
      siguiente.setUTCMonth(siguiente.getUTCMonth() + 1)
      cursor = siguiente.toISOString().slice(0, 8) + '01'
    }
    if (!meses.length) return []
    const salto = Math.ceil(meses.length / 12)
    const puntos: PuntoMes[] = []
    for (let indice = salto - 1; indice < meses.length; indice += salto) {
      const primero = meses[indice - salto + 1]
      const ultimo = meses[indice]
      const previo = realAcumuladoHasta(propias, cortes, diaAntes(primero.inicio))
      const realAcum = realAcumuladoHasta(propias, cortes, ultimo.fin)
      puntos.push({
        etiqueta: MESES[Number(ultimo.inicio.slice(5, 7)) - 1] ?? ultimo.inicio,
        inicio: primero.inicio,
        fin: ultimo.fin,
        realMes: Math.max(0, realAcum - previo),
        objetivoMes: Math.round(cuota / meses.length * salto * 100) / 100,
        objetivoAcum: Math.round(cuota * (indice + 1) / meses.length * 100) / 100,
        realAcum,
      })
    }
    return puntos
  }, [meta, propias, cortes])

  if (!vigentes.length) return <section className="ws-card"><header className="ws-card-heading"><h2>Ventas VS Objetivo</h2><p>Compara lo logrado con el objetivo acumulado mes a mes.</p></header>
    <div className="ws-empty-compact"><TargetIcon size={26} /><strong>Aún hay poco que graficar</strong><span>Primero crea una meta con fechas en «Definición y asignación»; luego registra cortes de avance aquí.</span></div>
  </section>

  // Con avance automático siempre existe una fila en 0 al inicio: solo cuenta lo que ya tiene valor.
  const hayCortes = propias.some(asignacion => cortes.some(corte => corte.asignacionId === asignacion.id && corte.valorAcumulado > 0))
  const noInicia = hoy < meta!.desde
  const indicador = meta!.indicador

  // Mes activo: el fijado con clic o, por defecto, el último mes con logro registrado (o el mes actual).
  let indiceDefecto = 0
  for (let i = 0; i < datos.length; i++) if (datos[i].realMes > 0 || (datos[i].inicio <= hoy && !hayCortes)) indiceDefecto = i
  const indiceActivo = mesElegido !== null ? Math.min(mesElegido, datos.length - 1) : indiceDefecto
  const activo = datos[indiceActivo]
  const indiceTip = mesCursor ?? null
  const tip = indiceTip !== null ? datos[indiceTip] : undefined

  // Geometría del SVG: una sola escala (eje izquierdo) para barras y línea.
  const W = 1000, H = 340
  const margen = { arriba: 34, abajo: 42, izquierda: 84, derecha: 28 }
  const maximo = Math.max(...datos.map(punto => Math.max(punto.realAcum, punto.objetivoAcum)), 1) * 1.12
  const columna = datos.length ? (W - margen.izquierda - margen.derecha) / datos.length : W
  const altoUtil = H - margen.arriba - margen.abajo
  const y = (valor: number) => margen.arriba + altoUtil * (1 - valor / maximo)
  const xCentro = (indice: number) => margen.izquierda + columna * indice + columna / 2
  const corta = (etiqueta: string) => datos.length > 6 ? etiqueta.slice(0, 3) : etiqueta
  const unidad = indicador === 'importe' ? 'S/' : 'u'

  const totalLogrado = realAcumuladoHasta(propias, cortes, meta!.hasta)
  const totalAsignado = propias.reduce((suma, item) => suma + item.valorObjetivo, 0)
  const avanceTotal = meta!.valorObjetivo > 0 ? totalLogrado / meta!.valorObjetivo : 0

  // Marca de «Hoy» dentro del periodo graficado.
  let xHoy: number | null = null
  const indiceHoy = datos.findIndex(punto => punto.inicio <= hoy && hoy <= punto.fin)
  if (indiceHoy >= 0) {
    const punto = datos[indiceHoy]
    xHoy = margen.izquierda + columna * (indiceHoy + Math.min(1, (dias(punto.inicio, hoy) + 0.5) / (dias(punto.inicio, punto.fin) + 1)))
  }

  const detalle = activo ? propias
    .map(asignacion => aporteDe(asignacion, cortes, activo.inicio, activo.fin))
    .filter(item => item.valor > 0)
    .sort((a, b) => b.valor - a.valor) : []
  const maxAporte = Math.max(...detalle.map(item => item.valor), 1)
  const cumplimientoAcum = activo && activo.objetivoAcum > 0 ? activo.realAcum / activo.objetivoAcum : 0
  const diferencia = activo ? activo.realAcum - activo.objetivoAcum : 0
  const mesFuturo = activo ? activo.inicio > hoy : false

  const alTeclado = (evento: KeyboardEvent, indice: number) => {
    if (evento.key === 'Enter' || evento.key === ' ') { evento.preventDefault(); setMesElegido(indice) }
    else if (evento.key === 'ArrowRight' || evento.key === 'ArrowLeft') {
      evento.preventDefault()
      const siguiente = Math.max(0, Math.min(datos.length - 1, indice + (evento.key === 'ArrowRight' ? 1 : -1)))
      setMesCursor(siguiente)
      ;(evento.currentTarget.parentElement?.querySelector(`[data-mes="${siguiente}"]`) as SVGGElement | null)?.focus()
    }
  }

  return <section className="ws-card ws-vs">
    <header className="ws-card-heading">
      <div><h2>Ventas VS Objetivo</h2><p>Las barras muestran lo que llevas logrado y la línea naranja lo que deberías llevar. Pasa el cursor o toca un mes para ver su detalle.</p></div>
      <select value={meta!.id} onChange={evento => { setMetaId(evento.target.value); setMesElegido(null); setMesCursor(null) }} aria-label="Elegir meta" style={{ maxWidth: 300 }}>
        {vigentes.map(item => <option key={item.id} value={item.id}>{item.codigo} · {item.nombre}</option>)}
      </select>
    </header>

    <div className="ws-metas-kpis">
      <Metrica etiqueta="Meta" valor={`${meta!.codigo} · ${meta!.nombre}`} detalle={`${meta!.desde} — ${meta!.hasta}`} />
      <Metrica etiqueta="Cuota de la meta" valor={formatearValor(indicador, meta!.valorObjetivo)}
        detalle={totalAsignado > 0 && Math.round(totalAsignado) !== Math.round(meta!.valorObjetivo) ? `Repartido entre responsables: ${formatearValor(indicador, totalAsignado)}` : undefined} />
      <Metrica etiqueta="Logrado hasta hoy" valor={formatearValor(indicador, totalLogrado)} />
      <Metrica etiqueta="Avance de la meta" valor={porcentaje(avanceTotal)} tono={avanceTotal >= 1 ? 'var(--ws-green)' : avanceTotal > 0 ? 'var(--ws-amber)' : undefined} />
    </div>

    <div className="ws-vs-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="group" aria-label="Logrado acumulado frente al objetivo acumulado por mes" className="ws-vs-svg" style={{ color: 'var(--ws-text)' }}>
        <defs>
          {[['ok', VERDE], ['mid', AMBAR], ['low', ROJO], ['new', AZUL]].map(([id, color]) => <linearGradient key={id} id={`vs-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity=".95" /><stop offset="100%" stopColor={color} stopOpacity=".35" />
          </linearGradient>)}
          <linearGradient id="vs-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={NARANJA} stopOpacity=".22" /><stop offset="100%" stopColor={NARANJA} stopOpacity="0" /></linearGradient>
        </defs>

        {[0, .25, .5, .75, 1].map(parte => <g key={parte}>
          <line x1={margen.izquierda} x2={W - margen.derecha} y1={y(maximo * parte)} y2={y(maximo * parte)} stroke="currentColor" strokeOpacity={parte === 0 ? .25 : .08} strokeDasharray={parte === 0 ? undefined : '4 6'} />
          <text x={margen.izquierda - 12} y={y(maximo * parte) + 4} fontSize={11} textAnchor="end" fill="var(--ws-muted)">{resumir(unidad, maximo * parte)}</text>
        </g>)}

        {/* Área bajo el objetivo acumulado */}
        {datos.length > 1 && <path d={`${datos.map((punto, indice) => `${indice ? 'L' : 'M'}${xCentro(indice).toFixed(1)} ${y(punto.objetivoAcum).toFixed(1)}`).join(' ')} L${xCentro(datos.length - 1).toFixed(1)} ${y(0)} L${xCentro(0).toFixed(1)} ${y(0)} Z`} fill="url(#vs-area)" />}

        {/* Barras de lo logrado acumulado */}
        {datos.map((punto, indice) => {
          const futuro = punto.inicio > hoy
          const elegido = indice === indiceActivo
          const resaltado = elegido || indice === indiceTip
          const alto = Math.max(0, y(0) - y(punto.realAcum))
          const color = colorBarra(punto)
          const gradiente = color === VERDE ? 'ok' : color === AMBAR ? 'mid' : color === ROJO ? 'low' : 'new'
          const ancho = Math.min(columna * .46, 72)
          return <g key={punto.inicio} data-mes={indice} tabIndex={0} role="button" className="ws-vs-col" style={{ cursor: 'pointer', outline: 'none' }}
            aria-label={`${punto.etiqueta}: logrado acumulado ${formatearValor(indicador, punto.realAcum)} de ${formatearValor(indicador, punto.objetivoAcum)} esperados`} aria-pressed={elegido}
            onClick={() => setMesElegido(indice)} onMouseEnter={() => setMesCursor(indice)} onMouseLeave={() => setMesCursor(null)} onFocus={() => setMesCursor(indice)} onBlur={() => setMesCursor(null)} onKeyDown={evento => alTeclado(evento, indice)}>
            <rect x={margen.izquierda + columna * indice} y={margen.arriba} width={columna} height={altoUtil} fill={resaltado ? 'currentColor' : 'transparent'} fillOpacity={.045} rx={6} />
            {alto > 0 && <rect x={xCentro(indice) - ancho / 2} width={ancho} y={y(punto.realAcum)} height={alto} fill={`url(#vs-${gradiente})`} rx={5} opacity={futuro ? .4 : resaltado ? 1 : .85} stroke={elegido ? color : 'none'} strokeWidth={elegido ? 1.5 : 0} />}
            {punto.realAcum > 0 && <text x={xCentro(indice)} y={y(punto.realAcum) - 8} fontSize={11} fontWeight={700} textAnchor="middle" fill="currentColor">{resumir(unidad, punto.realAcum)}</text>}
          </g>
        })}

        {/* Línea y puntos del objetivo acumulado */}
        <path d={datos.map((punto, indice) => `${indice ? 'L' : 'M'}${xCentro(indice).toFixed(1)} ${y(punto.objetivoAcum).toFixed(1)}`).join(' ')} fill="none" stroke={NARANJA} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" pointerEvents="none" />
        {datos.map((punto, indice) => <g key={`p${indice}`} pointerEvents="none">
          <circle cx={xCentro(indice)} cy={y(punto.objetivoAcum)} r={indice === indiceActivo || indice === indiceTip ? 7 : 5} fill="var(--ws-surface)" stroke={NARANJA} strokeWidth={2.5} />
          <text x={xCentro(indice)} y={y(punto.objetivoAcum) - 14} fontSize={10} fontWeight={600} textAnchor="middle" fill={NARANJA}>{resumir(unidad, punto.objetivoAcum)}</text>
        </g>)}

        {/* Hoy */}
        {xHoy !== null && <g pointerEvents="none">
          <line x1={xHoy} x2={xHoy} y1={margen.arriba - 6} y2={y(0)} stroke="var(--ws-primary)" strokeWidth={1.5} strokeDasharray="5 5" />
          <rect x={xHoy - 17} y={margen.arriba - 24} width={34} height={17} rx={8} fill="var(--ws-primary)" />
          <text x={xHoy} y={margen.arriba - 12} fontSize={10} fontWeight={700} textAnchor="middle" fill="var(--ws-surface)">Hoy</text>
        </g>}

        {datos.map((punto, indice) => <text key={`t${indice}`} x={xCentro(indice)} y={H - 14} fontSize={indice === indiceActivo ? 13 : 12} fontWeight={indice === indiceActivo ? 700 : 400}
          textAnchor="middle" fill={indice === indiceActivo ? 'var(--ws-text)' : 'var(--ws-muted)'}>{corta(punto.etiqueta)}</text>)}
      </svg>

      {/* Detalle flotante al pasar el cursor o enfocar */}
      {tip && <div className="ws-vs-tip" role="status" style={{ left: `${Math.min(86, Math.max(14, xCentro(indiceTip as number) / W * 100))}%` }}>
        <strong>{tip.etiqueta}</strong>
        <span><i style={{ background: colorBarra(tip) }} />Logrado acumulado<b>{formatearValor(indicador, tip.realAcum)}</b></span>
        <span><i style={{ background: NARANJA }} />Objetivo acumulado<b>{formatearValor(indicador, tip.objetivoAcum)}</b></span>
        <span className="ws-vs-tip-total">{tip.realAcum - tip.objetivoAcum >= 0 ? 'Por encima' : 'Por debajo'}<b>{formatearValor(indicador, Math.abs(tip.realAcum - tip.objetivoAcum))}</b></span>
      </div>}

      {/* Estado vacío: aún no hay cortes */}
      {!hayCortes && <div className="ws-vs-empty">
        <ClipboardCheck size={24} />
        <strong>{noInicia ? `La meta empieza el ${meta!.desde}` : automatico ? 'Aún no hay ventas completadas en el periodo' : 'Aún no hay avances registrados'}</strong>
        <span>{noInicia ? 'Cuando comience el periodo y se completen ventas, aquí verás las barras.' : automatico ? 'Cada venta completada de los responsables asignados se suma sola y aparecerá aquí.' : 'Registra un corte con el total logrado a una fecha y aparecerán las barras.'}</span>
        {onRegistrar && !noInicia && !automatico && <button type="button" className="ws-button" onClick={onRegistrar}>Registrar corte</button>}
      </div>}
    </div>

    {/* Pastillas: selector de mes */}
    <div className="ws-mes-chips" role="group" aria-label="Elegir mes">
      {datos.map((punto, indice) => <button key={punto.inicio} type="button" aria-selected={indice === indiceActivo} onClick={() => setMesElegido(indice)}>{punto.etiqueta}</button>)}
    </div>
    <div className="ws-vs-legend">
      <span><i style={{ background: `linear-gradient(${VERDE}, ${VERDE}66)` }} />Logrado acumulado</span>
      <span><i style={{ background: NARANJA, height: 3, borderRadius: 2, width: 17 }} />Objetivo acumulado</span>
      <span className="ws-vs-legend-semaforo"><i style={{ background: VERDE }} />Al día<i style={{ background: AMBAR }} />Leve atraso<i style={{ background: ROJO }} />Atrasado</span>
    </div>

    {/* Detalle del mes elegido */}
    {activo && <div className="ws-vs-detail">
      <div className="ws-vs-detail-head">
        <span><CalendarDays size={14} style={{ color: 'var(--ws-primary)' }} />Detalle de {activo.etiqueta}<small>{activo.inicio} — {activo.fin}</small></span>
        {!mesFuturo && activo.objetivoAcum > 0 && <span className={`status-pill ${diferencia >= 0 ? 'green' : cumplimientoAcum >= 0.8 ? 'amber' : 'red'}`}>
          {diferencia >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}&nbsp;{diferencia >= 0 ? 'Por encima' : 'Por debajo'} del objetivo en {formatearValor(indicador, Math.abs(diferencia))}
        </span>}
      </div>
      <div className="ws-progress-cell">
        <div className="ws-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(cumplimientoAcum, 1) * 100)} aria-label={`Logrado acumulado de ${activo.etiqueta} frente al objetivo`}>
          <i className={cumplimientoAcum >= 1 ? 'green' : cumplimientoAcum >= 0.8 ? 'amber' : 'red'} style={{ width: `${Math.min(cumplimientoAcum, 1) * 100}%` }} />
        </div>
        <small><b>{porcentaje(cumplimientoAcum)}</b> del objetivo acumulado a fin de {activo.etiqueta.toLowerCase()}</small>
      </div>
      <div className="ws-vs-detail-grid">
        <Metrica etiqueta="Objetivo del mes" valor={formatearValor(indicador, activo.objetivoMes)} />
        <Metrica etiqueta="Logrado del mes" valor={formatearValor(indicador, activo.realMes)} tono={mesFuturo ? undefined : activo.realMes >= activo.objetivoMes ? 'var(--ws-green)' : activo.realMes > 0 ? 'var(--ws-amber)' : 'var(--ws-red)'} />
        <Metrica etiqueta="Objetivo acumulado" valor={formatearValor(indicador, activo.objetivoAcum)} />
        <Metrica etiqueta="Logrado acumulado" valor={formatearValor(indicador, activo.realAcum)} />
      </div>
      {detalle.length > 0 ? <div className="ws-vs-aportes">
        <small>Aporte por asignación en {activo.etiqueta}</small>
        {detalle.map(item => <div key={item.nombre} className="ws-vs-aporte">
          <span><b>{item.nombre}</b> · {item.alcance}</span>
          <div className="ws-progress"><i style={{ width: `${item.valor / maxAporte * 100}%` }} /></div>
          <b>{formatearValor(indicador, item.valor)}</b>
        </div>)}
      </div> : <small className="ws-vs-sin-aportes">{mesFuturo ? 'Este mes aún no ocurre.' : 'Ninguna asignación registró avance en este mes.'}</small>}
    </div>}
  </section>
}

function resumir(unidad: string, valor: number): string {
  if (valor >= 1_000_000) return `${unidad} ${Math.round(valor / 100_000) / 10}M`
  if (valor >= 10_000) return `${unidad} ${Math.round(valor / 100) / 10}k`
  return valor >= 1000 ? `${unidad} ${Math.round(valor).toLocaleString('es-PE')}` : `${unidad} ${Math.round(valor * 10) / 10}`
}

function Metrica({ etiqueta, valor, detalle, tono }: { etiqueta: string; valor?: string; detalle?: string; tono?: string }) {
  return <div style={{ display: 'grid', gap: 3 }}>
    <small style={{ color: 'var(--ws-muted)', fontSize: 9, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase' }}>{etiqueta}</small>
    <strong style={{ fontSize: valor && valor.length > 24 ? 12 : 15, color: tono ?? 'var(--ws-text)' }}>{valor}</strong>
    {detalle && <small style={{ color: 'var(--ws-muted)', fontSize: 10 }}>{detalle}</small>}
  </div>
}
