import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BarChart3,
  Check,
  Crosshair,
  LocateFixed,
  MapPin,
  MapPinned,
  Minus,
  Navigation,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Route,
  Save,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Truck,
  X,
} from 'lucide-react'
import { SearchablePicker, type PickerOption } from '../../components/SearchablePicker'
import { PageHeader } from '../../components/ui/PageHeader'
import { useAuth } from '../../context/AuthContext'
import { useRecords } from '../../context/RecordsContext'
import { money } from '../../data/helpers'
import { friendlyError } from '../../services/records'
import { crearDespachoService } from './despachoService'
import { coberturaVenta, construirParada, ventasDespachables, type CoberturaVenta, type VentaDespachable } from './despachos'
import { crearFlotaService } from './flotaService'
import { crearFuenteSupabase, type ContextoLogistico } from './fuentes'
import { permisosLogistica } from './permisos'
import { ahoraLima, formatoFecha } from './rules'
import {
  DISTRITOS_LIMA,
  ESTACIONAMIENTO_BASE_DEFAULT,
  calcularMetricasRuta,
  construirAnaliticaRepertorio,
  distanciaTramoKm,
  optimizarParadasPorCercania,
  resolverUbicacionParada,
  type Estacionamiento,
  type FrecuenciaDestino,
  type ParadaRuta,
  type RutaGuardada,
  type TramoRuta,
} from './rutasGeo'
import { crearRutasService } from './rutasService'
import { nuevoId, type AlmacenLogistica } from './storage'
import type { Conductor, Despacho, Parada, Vehiculo } from './types'
import { useAlmacenLogistica } from './useAlmacen'
import './logistica-ui.css'

type PestanaRutas = 'constructor' | 'repertorio'
type EstiloMapa = 'voyager' | 'dark' | 'osm'
type ModoMapa =
  | { tipo: 'navegar' }
  | { tipo: 'estacionamiento' }
  | { tipo: 'parada'; stopId: string }

type VentaConCobertura = VentaDespachable & { cobertura: CoberturaVenta }

type OsrmRuta = {
  waypointsKey: string
  /** Puntos [lat, lng] devueltos por router.project-osrm.org */
  geometria: Array<[number, number]>
  distanciaTotalKm: number
  tiempoManejoMin: number
  tramos: Array<{ distanciaKm: number; tiempoMin: number }>
}

const CONTEXTO_VACIO: ContextoLogistico = { almacenes: [], zonaPorCliente: {}, ventasConPedido: [], avisos: [] }
const TILE_SIZE = 256
const MIN_ZOOM = 10
const MAX_ZOOM = 17

// ---------- Proyección Web Mercator (EPSG:3857) exacta para teselas estilo Google Maps ----------
function latLngToWorldPx(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const worldSize = TILE_SIZE * Math.pow(2, zoom)
  const x = ((lng + 180) / 360) * worldSize
  const sinLat = Math.max(-0.9999, Math.min(0.9999, Math.sin((lat * Math.PI) / 180)))
  const y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * worldSize
  return { x, y }
}

function worldPxToLatLng(wx: number, wy: number, zoom: number): { lat: number; lng: number } {
  const worldSize = TILE_SIZE * Math.pow(2, zoom)
  const lng = (wx / worldSize) * 360 - 180
  const n = Math.PI - (2 * Math.PI * wy) / worldSize
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))
  return { lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) }
}

function tileUrl(style: EstiloMapa, z: number, x: number, y: number): string {
  if (style === 'voyager') {
    const sub = ['a', 'b', 'c', 'd'][(x + y) & 3]
    return `https://${sub}.basemaps.cartocdn.com/rastertiles/voyager/${z}/${x}/${y}@2x.png`
  }
  if (style === 'dark') {
    const sub = ['a', 'b', 'c', 'd'][(x + y) & 3]
    return `https://${sub}.basemaps.cartocdn.com/dark_all/${z}/${x}/${y}@2x.png`
  }
  const subOsm = ['a', 'b', 'c'][(x + y) % 3]
  return `https://${subOsm}.tile.openstreetmap.org/${z}/${x}/${y}.png`
}

function distritoMasCercano(coords: { lat: number; lng: number }) {
  let mejor = DISTRITOS_LIMA[0]
  let menor = Infinity
  for (const d of DISTRITOS_LIMA) {
    const dist = distanciaTramoKm(coords, d)
    if (dist < menor) {
      menor = dist
      mejor = d
    }
  }
  return mejor
}

function recorte(texto: string, max: number): string {
  return texto.length > max ? `${texto.slice(0, max - 1)}…` : texto
}

function PinGotaSvg({ color, texto, grande }: { color: string; texto: string; grande?: boolean }) {
  const w = grande ? 34 : 30
  const h = grande ? 44 : 39
  return (
    <svg width={w} height={h} viewBox="0 0 34 44" aria-hidden="true">
      <path
        d="M17 2 C8.7 2 2 8.7 2 17 C2 28.2 17 42 17 42 C17 42 32 28.2 32 17 C32 8.7 25.3 2 17 2 Z"
        fill={color}
        stroke="#ffffff"
        strokeWidth="2.4"
      />
      <circle cx="17" cy="17" r="8.5" fill="rgba(255,255,255,0.2)" />
      <text x="17" y="21" textAnchor="middle" fontSize="12" fontWeight="800" fill="#ffffff">
        {texto}
      </text>
    </svg>
  )
}

type MapaProps = {
  estacionamiento: Estacionamiento
  paradas: ParadaRuta[]
  tramos: TramoRuta[]
  osrmRuta: OsrmRuta | null
  cargandoRutaVial: boolean
  retornarBase: boolean
  modoMapa: ModoMapa
  paradaActivaId: string | null
  onSeleccionarParada: (id: string | null) => void
  onCambiarModo: (modo: ModoMapa) => void
  onColocarEstacionamiento: (coords: { lat: number; lng: number; distrito: string }) => void
  onReubicarParada: (stopId: string, coords: { lat: number; lng: number; distrito: string; zonaNombre: string }) => void
  onMoverParada: (index: number, delta: -1 | 1) => void
  onQuitarParada: (stopId: string) => void
}

function MapaGoogleStyleLima({
  estacionamiento,
  paradas,
  tramos,
  osrmRuta,
  cargandoRutaVial,
  retornarBase,
  modoMapa,
  paradaActivaId,
  onSeleccionarParada,
  onCambiarModo,
  onColocarEstacionamiento,
  onReubicarParada,
  onMoverParada,
  onQuitarParada,
}: MapaProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ w: 780, h: 550 })
  const [estilo, setEstilo] = useState<EstiloMapa>('voyager')
  const [zoom, setZoom] = useState(13)
  const [center, setCenter] = useState({ lat: estacionamiento.lat, lng: estacionamiento.lng })
  const [dragging, setDragging] = useState(false)
  const [failedTiles, setFailedTiles] = useState<Record<string, true>>({})

  const dragRef = useRef<{
    pointerId: number
    clientX: number
    clientY: number
    centerWorldX: number
    centerWorldY: number
    moved: boolean
  } | null>(null)

  // Medir el ancho/alto real del contenedor de mapa
  useEffect(() => {
    const el = viewportRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const actualizar = () => {
      const rect = el.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        setSize({ w: Math.round(rect.width), h: Math.round(rect.height) })
      }
    }
    actualizar()
    const obs = new ResizeObserver(actualizar)
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  const encuadrarRuta = useCallback(() => {
    const puntos = [
      { lat: estacionamiento.lat, lng: estacionamiento.lng },
      ...paradas.map(p => ({ lat: p.lat, lng: p.lng })),
    ]
    if (puntos.length <= 1) {
      setCenter({ lat: estacionamiento.lat, lng: estacionamiento.lng })
      setZoom(13)
      return
    }

    let zElegido = 11
    for (let z = 15; z >= MIN_ZOOM; z -= 1) {
      const worldPts = puntos.map(p => latLngToWorldPx(p.lat, p.lng, z))
      const xs = worldPts.map(p => p.x)
      const ys = worldPts.map(p => p.y)
      const spanX = Math.max(...xs) - Math.min(...xs)
      const spanY = Math.max(...ys) - Math.min(...ys)
      if (spanX <= size.w * 0.68 && spanY <= size.h * 0.64) {
        zElegido = z
        break
      }
    }
    const worldPts = puntos.map(p => latLngToWorldPx(p.lat, p.lng, zElegido))
    const midX = (Math.min(...worldPts.map(p => p.x)) + Math.max(...worldPts.map(p => p.x))) / 2
    const midY = (Math.min(...worldPts.map(p => p.y)) + Math.max(...worldPts.map(p => p.y))) / 2
    setZoom(zElegido)
    setCenter(worldPxToLatLng(midX, midY, zElegido))
  }, [estacionamiento.lat, estacionamiento.lng, paradas, size.h, size.w])

  // Auto-encuadrar al ir agregando/quitando pedidos para ver el trazado en vivo
  const prevCountRef = useRef<number>(paradas.length)
  useEffect(() => {
    if (paradas.length !== prevCountRef.current) {
      prevCountRef.current = paradas.length
      encuadrarRuta()
    }
  }, [paradas.length, encuadrarRuta])

  // Centrar cuando cambia explícitamente el distrito del estacionamiento
  const prevEstRef = useRef({ lat: estacionamiento.lat, lng: estacionamiento.lng })
  useEffect(() => {
    if (
      (prevEstRef.current.lat !== estacionamiento.lat || prevEstRef.current.lng !== estacionamiento.lng) &&
      paradas.length === 0
    ) {
      prevEstRef.current = { lat: estacionamiento.lat, lng: estacionamiento.lng }
      setCenter({ lat: estacionamiento.lat, lng: estacionamiento.lng })
    }
  }, [estacionamiento.lat, estacionamiento.lng, paradas.length])

  // Zoom nativo con rueda del mouse hacia el punto bajo el cursor
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const delta = e.deltaY < 0 ? 1 : -1
      const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom + delta))
      if (nextZoom === zoom) return
      const rect = el.getBoundingClientRect()
      const rx = e.clientX - rect.left
      const ry = e.clientY - rect.top
      const centerPx = latLngToWorldPx(center.lat, center.lng, zoom)
      const cursorWorldX = centerPx.x - size.w / 2 + rx
      const cursorWorldY = centerPx.y - size.h / 2 + ry
      const cursorLatLng = worldPxToLatLng(cursorWorldX, cursorWorldY, zoom)
      const nextCursorPx = latLngToWorldPx(cursorLatLng.lat, cursorLatLng.lng, nextZoom)
      const nextCenterPxX = nextCursorPx.x - (rx - size.w / 2)
      const nextCenterPxY = nextCursorPx.y - (ry - size.h / 2)
      setZoom(nextZoom)
      setCenter(worldPxToLatLng(nextCenterPxX, nextCenterPxY, nextZoom))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [center.lat, center.lng, size.h, size.w, zoom])

  const centerWorld = useMemo(() => latLngToWorldPx(center.lat, center.lng, zoom), [center.lat, center.lng, zoom])
  const topLeftX = centerWorld.x - size.w / 2
  const topLeftY = centerWorld.y - size.h / 2

  const toScreen = useCallback(
    (lat: number, lng: number) => {
      const pt = latLngToWorldPx(lat, lng, zoom)
      return { x: pt.x - topLeftX, y: pt.y - topLeftY }
    },
    [topLeftX, topLeftY, zoom],
  )

  const tiles = useMemo(() => {
    const maxTileIdx = Math.pow(2, zoom) - 1
    const minTileX = Math.max(0, Math.floor(topLeftX / TILE_SIZE))
    const maxTileX = Math.min(maxTileIdx, Math.floor((topLeftX + size.w) / TILE_SIZE))
    const minTileY = Math.max(0, Math.floor(topLeftY / TILE_SIZE))
    const maxTileY = Math.min(maxTileIdx, Math.floor((topLeftY + size.h) / TILE_SIZE))

    const list: Array<{ key: string; url: string; left: number; top: number }> = []
    for (let ty = minTileY; ty <= maxTileY; ty += 1) {
      for (let tx = minTileX; tx <= maxTileX; tx += 1) {
        list.push({
          key: `${estilo}-${zoom}-${tx}-${ty}`,
          url: tileUrl(estilo, zoom, tx, ty),
          left: Math.round(tx * TILE_SIZE - topLeftX),
          top: Math.round(ty * TILE_SIZE - topLeftY),
        })
      }
    }
    return list
  }, [estilo, size.h, size.w, topLeftX, topLeftY, zoom])

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const target = e.target as HTMLElement
    if (target.closest('button')) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = {
      pointerId: e.pointerId,
      clientX: e.clientX,
      clientY: e.clientY,
      centerWorldX: centerWorld.x,
      centerWorldY: centerWorld.y,
      moved: false,
    }
  }

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    if (!d || d.pointerId !== e.pointerId) return
    const dx = e.clientX - d.clientX
    const dy = e.clientY - d.clientY
    if (!d.moved && Math.hypot(dx, dy) < 5) return
    d.moved = true
    setDragging(true)
    setCenter(worldPxToLatLng(d.centerWorldX - dx, d.centerWorldY - dy, zoom))
  }

  const handlePointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    dragRef.current = null
    setDragging(false)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    if (!d || d.moved) return
    if (modoMapa.tipo === 'navegar') {
      onSeleccionarParada(null)
      return
    }
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) return
    const rx = e.clientX - rect.left
    const ry = e.clientY - rect.top
    const coords = worldPxToLatLng(topLeftX + rx, topLeftY + ry, zoom)
    const cercano = distritoMasCercano(coords)

    if (modoMapa.tipo === 'estacionamiento') {
      onColocarEstacionamiento({ lat: coords.lat, lng: coords.lng, distrito: cercano.nombre })
      onCambiarModo({ tipo: 'navegar' })
    } else if (modoMapa.tipo === 'parada') {
      onReubicarParada(modoMapa.stopId, {
        lat: coords.lat,
        lng: coords.lng,
        distrito: cercano.nombre,
        zonaNombre: cercano.zona,
      })
      onCambiarModo({ tipo: 'navegar' })
    }
  }

  // Geometría poligonal de calles reales (OSRM) o recta directa de respaldo
  const osrmPolylinePoints = useMemo(() => {
    if (!osrmRuta || !osrmRuta.geometria.length) return ''
    return osrmRuta.geometria
      .map(([lat, lng]) => {
        const pt = toScreen(lat, lng)
        return `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`
      })
      .join(' ')
  }, [osrmRuta, toScreen])

  const parkingScreen = toScreen(estacionamiento.lat, estacionamiento.lng)
  const paradaActivaIdx = paradas.findIndex(p => p.id === paradaActivaId)
  const paradaActiva = paradaActivaIdx >= 0 ? paradas[paradaActivaIdx] : null
  const tramoActivoOsrm = paradaActivaIdx >= 0 ? osrmRuta?.tramos[paradaActivaIdx] : undefined
  const tramoActivoFallback = paradaActivaIdx >= 0 ? tramos[paradaActivaIdx] : undefined

  const totalKmMostrar = osrmRuta
    ? osrmRuta.distanciaTotalKm
    : Number(tramos.reduce((s, t) => s + t.distanciaKm, 0).toFixed(2))
  const totalMinMostrar = osrmRuta
    ? osrmRuta.tiempoManejoMin + paradas.length * 8
    : tramos.reduce((s, t) => s + t.tiempoMin, 0)

  return (
    <section className="ws-card ec-rutas-map-card" aria-label="Mapa de calles y trazo de ruta">
      <div className="ec-rutas-map-header">
        <div>
          <strong style={{ fontSize: 14 }}>Mapa vial de despacho · Lima Metropolitana y Callao</strong>
          <small style={{ display: 'block', color: 'var(--ws-muted)', fontSize: 12 }}>
            {paradas.length
              ? `${paradas.length} parada(s) desde ${estacionamiento.nombre} · ${
                  osrmRuta ? 'Trazado por avenidas y calles (OSRM)' : cargandoRutaVial ? 'Calculando ruta vial…' : 'Estimación directa'
                }`
              : 'Asigna pedidos o agrega paradas para trazar el recorrido por las calles'}
          </small>
        </div>
      </div>

      {modoMapa.tipo !== 'navegar' && (
        <div className="ec-rutas-mode-banner" role="status">
          <span>
            {modoMapa.tipo === 'estacionamiento'
              ? 'Modo ubicación activo: haz clic en cualquier calle del mapa para fijar el Estacionamiento (P).'
              : 'Modo reubicación activo: haz clic en el mapa para mover la parada seleccionada.'}
          </span>
          <button className="ws-text-button" type="button" onClick={() => onCambiarModo({ tipo: 'navegar' })}>
            Cancelar
          </button>
        </div>
      )}

      <div
        ref={viewportRef}
        className="ec-gmap-viewport"
        data-style={estilo}
        data-placing={modoMapa.tipo !== 'navegar'}
        data-dragging={dragging}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        {/* Capa de teselas cartográficas con calles reales */}
        <div className="ec-gmap-tile-layer">
          {tiles.map(t =>
            failedTiles[t.key] ? null : (
              <img
                key={t.key}
                className="ec-gmap-tile"
                src={t.url}
                alt=""
                draggable={false}
                decoding="async"
                referrerPolicy="no-referrer-when-downgrade"
                style={{ left: t.left, top: t.top }}
                onError={() => setFailedTiles(prev => ({ ...prev, [t.key]: true }))}
              />
            ),
          )}
        </div>

        {/* Capa SVG superpuesta con la ruta azul estilo Google Maps */}
        <svg className="ec-gmap-overlay-svg" viewBox={`0 0 ${size.w} ${size.h}`}>
          <defs>
            <marker id="ec-gmap-arrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto-start-reverse">
              <path d="M 1 1.5 L 8.5 5 L 1 8.5 z" fill="#ffffff" stroke="#174ea6" strokeWidth="1" />
            </marker>
          </defs>

          {osrmPolylinePoints ? (
            <>
              <polyline
                points={osrmPolylinePoints}
                fill="none"
                stroke="#174ea6"
                strokeWidth="8"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeOpacity="0.92"
              />
              <polyline
                points={osrmPolylinePoints}
                fill="none"
                stroke="#4285f4"
                strokeWidth="4.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </>
          ) : (
            tramos.map(tramo => {
              const p1 = toScreen(tramo.desdeLat, tramo.desdeLng)
              const p2 = toScreen(tramo.hastaLat, tramo.hastaLng)
              const retorno = Boolean(tramo.esRetorno)
              return (
                <g key={`tramo-linea-${tramo.orden}`}>
                  <line
                    x1={p1.x}
                    y1={p1.y}
                    x2={p2.x}
                    y2={p2.y}
                    stroke={retorno ? '#b45309' : '#174ea6'}
                    strokeWidth="7.5"
                    strokeLinecap="round"
                    strokeOpacity="0.85"
                    strokeDasharray={retorno ? '8 6' : undefined}
                  />
                  <line
                    x1={p1.x}
                    y1={p1.y}
                    x2={p2.x}
                    y2={p2.y}
                    stroke={retorno ? '#fbbf24' : '#4285f4'}
                    strokeWidth="4.4"
                    strokeLinecap="round"
                    strokeDasharray={retorno ? '8 6' : undefined}
                    markerEnd="url(#ec-gmap-arrow)"
                  />
                </g>
              )
            })
          )}
        </svg>

        {/* Píldoras flotantes de distancia/tiempo entre paradas */}
        {tramos.map((tramo, idx) => {
          const p1 = toScreen(tramo.desdeLat, tramo.desdeLng)
          const p2 = toScreen(tramo.hastaLat, tramo.hastaLng)
          const mx = (p1.x + p2.x) / 2
          const my = (p1.y + p2.y) / 2
          const tramoOsrm = osrmRuta?.tramos[idx]
          const km = tramoOsrm ? tramoOsrm.distanciaKm : tramo.distanciaKm
          const min = tramoOsrm ? tramoOsrm.tiempoMin : tramo.tiempoMin
          return (
            <div key={`pill-${tramo.orden}`} className="ec-gmap-leg-pill" style={{ left: mx, top: my }}>
              {tramo.esRetorno ? `Retorno ${km} km` : `${km} km · ${min} min`}
            </div>
          )
        })}

        {/* Pin verde Estacionamiento (P) */}
        <button
          type="button"
          className="ec-gmap-pin"
          style={{ left: parkingScreen.x, top: parkingScreen.y }}
          onClick={e => {
            e.stopPropagation()
            onSeleccionarParada(null)
          }}
          title={`${estacionamiento.nombre} (${estacionamiento.distrito})`}
        >
          <PinGotaSvg color="#0f9d58" texto="P" grande />
          <span className="ec-gmap-pin-label">{recorte(`P · ${estacionamiento.distrito || estacionamiento.nombre}`, 22)}</span>
        </button>

        {/* Pines numerados de paradas */}
        {paradas.map(parada => {
          const pos = toScreen(parada.lat, parada.lng)
          const activa = parada.id === paradaActivaId
          return (
            <button
              key={parada.id}
              type="button"
              className="ec-gmap-pin"
              data-selected={activa}
              style={{ left: pos.x, top: pos.y }}
              onClick={e => {
                if (modoMapa.tipo !== 'navegar') return
                e.stopPropagation()
                onSeleccionarParada(activa ? null : parada.id)
              }}
              title={`Parada ${parada.orden}: ${parada.clienteNombre}`}
            >
              <PinGotaSvg color={activa ? '#1a73e8' : '#ea4335'} texto={String(parada.orden)} />
              <span className="ec-gmap-pin-label">{recorte(`${parada.orden}. ${parada.clienteNombre}`, 20)}</span>
            </button>
          )
        })}

        {/* Selector de estilo de mapa arriba a la izquierda */}
        <div className="ec-gmap-style-switch" role="group" aria-label="Estilo de mapa">
          <button type="button" aria-pressed={estilo === 'voyager'} onClick={() => setEstilo('voyager')}>
            Mapa
          </button>
          <button type="button" aria-pressed={estilo === 'dark'} onClick={() => setEstilo('dark')}>
            Oscuro
          </button>
          <button type="button" aria-pressed={estilo === 'osm'} onClick={() => setEstilo('osm')}>
            Calles
          </button>
        </div>

        {/* Acciones flotantes arriba a la derecha */}
        <div className="ec-gmap-top-actions">
          <button
            type="button"
            className="ec-gmap-float-btn"
            data-active={modoMapa.tipo === 'estacionamiento'}
            onClick={() =>
              onCambiarModo(modoMapa.tipo === 'estacionamiento' ? { tipo: 'navegar' } : { tipo: 'estacionamiento' })
            }
          >
            <Crosshair size={14} />
            {modoMapa.tipo === 'estacionamiento' ? 'Cancelar ubicación' : 'Ubicar P en mapa'}
          </button>
          <button type="button" className="ec-gmap-float-btn" onClick={encuadrarRuta}>
            <LocateFixed size={14} />
            Centrar ruta
          </button>
        </div>

        {/* Controles verticales de Zoom estilo Google Maps abajo a la derecha */}
        <div className="ec-gmap-zoom" aria-label="Controles de zoom">
          <button
            type="button"
            disabled={zoom >= MAX_ZOOM}
            onClick={() => setZoom(z => Math.min(MAX_ZOOM, z + 1))}
            aria-label="Acercar mapa"
          >
            <Plus size={16} />
          </button>
          <button
            type="button"
            disabled={zoom <= MIN_ZOOM}
            onClick={() => setZoom(z => Math.max(MIN_ZOOM, z - 1))}
            aria-label="Alejar mapa"
          >
            <Minus size={16} />
          </button>
        </div>

        {/* Tarjeta flotante de resumen o parada seleccionada */}
        {(paradaActiva || paradas.length > 0) && (
          <div className="ec-gmap-card">
            {paradaActiva ? (
              <>
                <div>
                  <strong>{`Parada ${paradaActiva.orden} · ${paradaActiva.clienteNombre}`}</strong>
                  <small>
                    {`${paradaActiva.ventaCodigo} · ${paradaActiva.direccion} (${paradaActiva.distrito})`}
                    {tramoActivoOsrm
                      ? ` · +${tramoActivoOsrm.distanciaKm} km (~${tramoActivoOsrm.tiempoMin} min en ruta)`
                      : tramoActivoFallback
                        ? ` · +${tramoActivoFallback.distanciaKm} km (~${tramoActivoFallback.tiempoMin} min)`
                        : ''}
                  </small>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button
                    className="ws-button ws-button-secondary"
                    type="button"
                    disabled={paradaActivaIdx <= 0}
                    onClick={() => onMoverParada(paradaActivaIdx, -1)}
                    title="Subir parada"
                  >
                    <ArrowUp size={13} />
                  </button>
                  <button
                    className="ws-button ws-button-secondary"
                    type="button"
                    disabled={paradaActivaIdx >= paradas.length - 1}
                    onClick={() => onMoverParada(paradaActivaIdx, 1)}
                    title="Bajar parada"
                  >
                    <ArrowDown size={13} />
                  </button>
                  <button
                    className="ws-button ws-button-secondary"
                    type="button"
                    onClick={() => onCambiarModo({ tipo: 'parada', stopId: paradaActiva.id })}
                  >
                    <MapPin size={13} />
                    Reubicar
                  </button>
                  <button className="ws-button ws-button-secondary" type="button" onClick={() => onQuitarParada(paradaActiva.id)}>
                    <Trash2 size={13} />
                  </button>
                </div>
              </>
            ) : (
              <div>
                <strong>{`${totalKmMostrar.toFixed(1)} km · ~${totalMinMostrar} min totales`}</strong>
                <small>
                  {`Salida: ${estacionamiento.distrito || estacionamiento.nombre} → ${paradas.length} entrega(s)`}
                  {osrmRuta ? ' (calles reales)' : ''}
                </small>
              </div>
            )}
          </div>
        )}

        <span className="ec-gmap-attribution">{`Zoom ${zoom} · © OpenStreetMap · CARTO`}</span>
      </div>

      <div className="ec-rutas-map-legend">
        <div className="ec-rutas-legend-items">
          <span>
            <i className="ec-rutas-legend-dot" style={{ background: '#0f9d58' }} />
            Estacionamiento (P)
          </span>
          <span>
            <i className="ec-rutas-legend-dot" style={{ background: '#ea4335' }} />
            Parada de entrega
          </span>
          <span>
            <i className="ec-rutas-legend-dot" style={{ background: '#4285f4' }} />
            Ruta vial
          </span>
          {retornarBase && (
            <span>
              <i className="ec-rutas-legend-dot" style={{ background: '#fbbf24' }} />
              Retorno al estacionamiento
            </span>
          )}
        </div>
        <span>Arrastra para moverte · Rueda del mouse para hacer zoom · Clic en un pin para ver el tramo</span>
      </div>
    </section>
  )
}

function RutasContenido({ almacen }: { almacen: AlmacenLogistica }) {
  const { can } = useAuth()
  const { records, notify } = useRecords()
  const permisos = permisosLogistica(can)
  const flota = useMemo(() => crearFlotaService(almacen), [almacen])
  const despachoServicio = useMemo(() => crearDespachoService(almacen, flota), [almacen, flota])
  const fuente = useMemo(() => crearFuenteSupabase(), [])
  const rutasServicio = useMemo(() => crearRutasService(), [])

  const [pestana, setPestana] = useState<PestanaRutas>('constructor')
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [rutasEnNavegador, setRutasEnNavegador] = useState(false)
  const [contexto, setContexto] = useState<ContextoLogistico>(CONTEXTO_VACIO)
  const [vehiculos, setVehiculos] = useState<Vehiculo[]>([])
  const [conductores, setConductores] = useState<Conductor[]>([])
  const [despachos, setDespachos] = useState<Despacho[]>([])
  const [rutasGuardadas, setRutasGuardadas] = useState<RutaGuardada[]>([])
  const [version, setVersion] = useState(0)

  // Estado del estacionamiento base
  const [estacionamiento, setEstacionamiento] = useState<Estacionamiento>(ESTACIONAMIENTO_BASE_DEFAULT)
  const [editandoParking, setEditandoParking] = useState(false)
  const [parkingDraft, setParkingDraft] = useState<Estacionamiento>(ESTACIONAMIENTO_BASE_DEFAULT)
  const [guardandoParking, setGuardandoParking] = useState(false)

  // Constructor de ruta activa
  const hoy = useMemo(() => ahoraLima().slice(0, 10), [])
  const [rutaEditandoId, setRutaEditandoId] = useState<string | undefined>(undefined)
  const [nombreRuta, setNombreRuta] = useState(() => `Ruta de despacho ${ahoraLima().slice(0, 10)}`)
  const [fechaRuta, setFechaRuta] = useState(hoy)
  const [almacenId, setAlmacenId] = useState('')
  const [conductorId, setConductorId] = useState('')
  const [vehiculoId, setVehiculoId] = useState('')
  const [retornarBase, setRetornarBase] = useState(false)
  const [observaciones, setObservaciones] = useState('')
  const [paradas, setParadas] = useState<ParadaRuta[]>([])
  const [paradaActivaId, setParadaActivaId] = useState<string | null>(null)
  const [modoMapa, setModoMapa] = useState<ModoMapa>({ tipo: 'navegar' })

  // Geometría vial real desde OSRM
  const [osrmRuta, setOsrmRuta] = useState<OsrmRuta | null>(null)
  const [cargandoRutaVial, setCargandoRutaVial] = useState(false)

  // Filtros y parada manual
  const [busquedaVenta, setBusquedaVenta] = useState('')
  const [soloPendientes, setSoloPendientes] = useState(true)
  const [manualCliente, setManualCliente] = useState('')
  const [manualDireccion, setManualDireccion] = useState('')
  const [manualDistrito, setManualDistrito] = useState('Los Olivos')

  useEffect(() => {
    if (!permisos.ver) return
    let vigente = true
    setCargando(true)
    void Promise.all([
      rutasServicio.obtenerEstacionamiento(),
      rutasServicio.listarRutas(),
      despachoServicio.listar(),
      flota.listarVehiculos(),
      flota.listarConductores(),
      fuente.contexto(),
    ])
      .then(([estResp, rutasResp, dsp, veh, cond, ctx]) => {
        if (!vigente) return
        setEstacionamiento(estResp.item)
        setParkingDraft(estResp.item)
        setRutasGuardadas(rutasResp.items)
        setRutasEnNavegador(estResp.enNavegador || rutasResp.enNavegador)
        setDespachos(dsp)
        setVehiculos(veh)
        setConductores(cond)
        setContexto(ctx)
        if (!almacenId && ctx.almacenes.length) setAlmacenId(ctx.almacenes[0].id)
        setError('')
      })
      .catch(reason => {
        if (vigente) setError(friendlyError(reason))
      })
      .finally(() => {
        if (vigente) setCargando(false)
      })
    return () => {
      vigente = false
    }
  }, [permisos.ver, rutasServicio, despachoServicio, flota, fuente, version])

  const recargar = useCallback(() => setVersion(v => v + 1), [])

  const vehiculosActivos = useMemo(() => vehiculos.filter(v => v.estado === 'activo'), [vehiculos])
  const conductoresActivos = useMemo(() => conductores.filter(c => c.estado === 'activo'), [conductores])

  const conductorOptions = useMemo<PickerOption[]>(
    () => [
      { id: '', label: 'Sin conductor asignado', detail: 'Simulación libre' },
      ...conductoresActivos.map(c => ({
        id: c.id,
        label: c.nombre,
        detail: `DNI ${c.documento} · ${c.licenciaCategoria}`,
      })),
    ],
    [conductoresActivos],
  )

  const vehiculoOptions = useMemo<PickerOption[]>(
    () => [
      { id: '', label: 'Sin vehículo asignado', detail: 'Simulación libre' },
      ...vehiculosActivos.map(v => ({
        id: v.id,
        label: `${v.placa} · ${v.marca} ${v.modelo}`,
        detail: `${v.capacidadKg.toLocaleString('es-PE')} kg`,
      })),
    ],
    [vehiculosActivos],
  )

  const almacenOptions = useMemo<PickerOption[]>(
    () => [
      { id: '', label: 'Multi-almacén / Opcional', detail: 'Cualquier sede activa' },
      ...contexto.almacenes.map(a => ({ id: a.id, label: a.nombre })),
    ],
    [contexto.almacenes],
  )

  const distritoOptions = useMemo<PickerOption[]>(
    () => DISTRITOS_LIMA.map(d => ({ id: d.nombre, label: d.nombre, detail: d.zona })),
    [],
  )

  const ventasDisponibles = useMemo<Array<VentaConCobertura & { distritoEstimado: string; zonaEstimada: string }>>(() => {
    const todas = ventasDespachables(records.sales, records.customers, contexto.zonaPorCliente, new Set(contexto.ventasConPedido))
      .map(venta => {
        const geo = resolverUbicacionParada({
          direccion: venta.direccion,
          zonaNombre: venta.zonaNombre,
          clienteNombre: venta.clienteNombre,
          semilla: venta.codigo,
        })
        return {
          ...venta,
          cobertura: coberturaVenta(venta.ventaId, despachos),
          distritoEstimado: geo.distrito,
          zonaEstimada: geo.zonaNombre,
        }
      })
    const q = busquedaVenta.trim().toLowerCase()
    return todas.filter(item => {
      if (soloPendientes && item.cobertura === 'completa') return false
      if (!q) return true
      return (
        item.codigo.toLowerCase().includes(q) ||
        item.clienteNombre.toLowerCase().includes(q) ||
        item.direccion.toLowerCase().includes(q) ||
        item.distritoEstimado.toLowerCase().includes(q)
      )
    })
  }, [records.sales, records.customers, contexto.zonaPorCliente, contexto.ventasConPedido, despachos, busquedaVenta, soloPendientes])

  const ventasAsignadasSet = useMemo(
    () => new Set(paradas.map(p => p.ventaId).filter((id): id is string => Boolean(id))),
    [paradas],
  )

  const estacionamientoVisual = editandoParking ? parkingDraft : estacionamiento
  const metricas = useMemo(
    () => calcularMetricasRuta(estacionamientoVisual, paradas, retornarBase),
    [estacionamientoVisual, paradas, retornarBase],
  )
  const analitica = useMemo(
    () => construirAnaliticaRepertorio(rutasGuardadas, despachos),
    [rutasGuardadas, despachos],
  )

  // Consulta trazado vial real en OSRM al cambiar estacionamiento o paradas
  const waypoints = useMemo(
    () =>
      paradas.length
        ? [
            { lat: estacionamientoVisual.lat, lng: estacionamientoVisual.lng },
            ...paradas.map(p => ({ lat: p.lat, lng: p.lng })),
            ...(retornarBase ? [{ lat: estacionamientoVisual.lat, lng: estacionamientoVisual.lng }] : []),
          ]
        : [],
    [estacionamientoVisual.lat, estacionamientoVisual.lng, paradas, retornarBase],
  )

  const waypointsKey = useMemo(
    () => waypoints.map(p => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`).join(';'),
    [waypoints],
  )

  useEffect(() => {
    if (waypoints.length < 2 || !waypointsKey) {
      setOsrmRuta(null)
      setCargandoRutaVial(false)
      return
    }
    const controller = new AbortController()
    setCargandoRutaVial(true)
    const timer = window.setTimeout(() => {
      void fetch(`https://router.project-osrm.org/route/v1/driving/${waypointsKey}?overview=full&geometries=geojson&steps=false`, {
        signal: controller.signal,
      })
        .then(res => (res.ok ? res.json() : Promise.reject(new Error('osrm-http'))))
        .then(data => {
          const route = data?.routes?.[0]
          const coords: Array<[number, number]> | undefined = route?.geometry?.coordinates
          if (!coords?.length) {
            setOsrmRuta(null)
            return
          }
          const legs: Array<{ distance: number; duration: number }> = Array.isArray(route.legs) ? route.legs : []
          setOsrmRuta({
            waypointsKey,
            geometria: coords.map(([lng, lat]) => [lat, lng]),
            distanciaTotalKm: Number(((route.distance ?? 0) / 1000).toFixed(2)),
            tiempoManejoMin: Math.max(2, Math.round((route.duration ?? 0) / 60)),
            tramos: legs.map(leg => ({
              distanciaKm: Number(((leg.distance ?? 0) / 1000).toFixed(2)),
              tiempoMin: Math.max(2, Math.round((leg.duration ?? 0) / 60)),
            })),
          })
        })
        .catch(() => {
          if (!controller.signal.aborted) setOsrmRuta(null)
        })
        .finally(() => {
          if (!controller.signal.aborted) setCargandoRutaVial(false)
        })
    }, 220)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [waypoints.length, waypointsKey])

  const distanciaFinalKm = osrmRuta ? osrmRuta.distanciaTotalKm : metricas.distanciaTotalKm
  const tiempoFinalMin = osrmRuta ? osrmRuta.tiempoManejoMin + paradas.length * 8 : metricas.tiempoEstimadoMin

  const puedeConfigurarParking =
    estacionamiento.id === ESTACIONAMIENTO_BASE_DEFAULT.id ? permisos.crear || permisos.editar : permisos.editar

  const handleGuardarParking = async () => {
    if (!parkingDraft.nombre.trim()) {
      notify('Indica el nombre del estacionamiento de partida.')
      return
    }
    setGuardandoParking(true)
    try {
      const resp = await rutasServicio.guardarEstacionamiento({
        id: parkingDraft.id,
        nombre: parkingDraft.nombre,
        direccion: parkingDraft.direccion,
        distrito: parkingDraft.distrito,
        referencia: parkingDraft.referencia,
        lat: parkingDraft.lat,
        lng: parkingDraft.lng,
      })
      setEstacionamiento(resp.item)
      setParkingDraft(resp.item)
      setRutasEnNavegador(prev => prev || resp.enNavegador)
      setEditandoParking(false)
      setModoMapa({ tipo: 'navegar' })
      notify('Estacionamiento de partida guardado.')
    } catch (reason) {
      notify(friendlyError(reason))
    } finally {
      setGuardandoParking(false)
    }
  }

  const handleColocarParkingEnMapa = ({ lat, lng, distrito }: { lat: number; lng: number; distrito: string }) => {
    setEditandoParking(true)
    setParkingDraft(actual => ({ ...actual, lat, lng, distrito }))
    notify(`Estacionamiento ubicado en ${distrito}. Haz clic en «Guardar estacionamiento» para conservarlo.`)
  }

  const handleReubicarParadaEnMapa = (
    stopId: string,
    coords: { lat: number; lng: number; distrito: string; zonaNombre: string },
  ) => {
    setParadas(actual =>
      actual.map(item =>
        item.id === stopId
          ? { ...item, lat: coords.lat, lng: coords.lng, distrito: coords.distrito, zonaNombre: coords.zonaNombre }
          : item,
      ),
    )
    notify(`Parada reubicada en ${coords.distrito}.`)
  }

  const asignarVentaARuta = (venta: VentaConCobertura) => {
    if (ventasAsignadasSet.has(venta.ventaId)) {
      setParadas(actual =>
        actual
          .filter(item => item.ventaId !== venta.ventaId)
          .map((item, idx) => ({ ...item, orden: idx + 1 })),
      )
      return
    }
    const geo = resolverUbicacionParada({
      direccion: venta.direccion,
      zonaNombre: venta.zonaNombre,
      clienteNombre: venta.clienteNombre,
      semilla: venta.codigo,
    })
    const stopId = nuevoId()
    const nuevaParada: ParadaRuta = {
      id: stopId,
      orden: paradas.length + 1,
      origen: 'venta',
      ventaId: venta.ventaId,
      ventaCodigo: venta.codigo,
      clienteId: venta.clienteId,
      clienteNombre: venta.clienteNombre,
      direccion: venta.direccion || `Sector ${geo.distrito}`,
      distrito: geo.distrito,
      zonaNombre: geo.zonaNombre,
      telefono: venta.telefono,
      lat: geo.lat,
      lng: geo.lng,
      monto: venta.monto,
      unidades: 1,
    }
    setParadas(actual => [...actual, nuevaParada])
    setParadaActivaId(stopId)
    void fuente
      .lineasVenta(venta.ventaId)
      .then(lineas => {
        const unidades = lineas.reduce((sum, l) => sum + Math.max(0, Math.floor(l.cantidad)), 0)
        if (unidades > 0) {
          setParadas(actual => actual.map(item => (item.id === stopId ? { ...item, unidades } : item)))
        }
      })
      .catch(() => undefined)
  }

  const agregarParadaManual = () => {
    const cliente = manualCliente.trim()
    const direccion = manualDireccion.trim()
    if (!cliente && !direccion) {
      notify('Ingresa al menos el destinatario o la dirección de la parada.')
      return
    }
    const geo = resolverUbicacionParada({
      direccion,
      distrito: manualDistrito,
      clienteNombre: cliente || manualDistrito,
      semilla: `manual-${Date.now()}`,
    })
    const stopId = nuevoId()
    const nueva: ParadaRuta = {
      id: stopId,
      orden: paradas.length + 1,
      origen: 'manual',
      ventaId: null,
      ventaCodigo: 'MANUAL',
      clienteId: null,
      clienteNombre: cliente || `Parada en ${geo.distrito}`,
      direccion: direccion || `Referencia · ${geo.distrito}`,
      distrito: geo.distrito,
      zonaNombre: geo.zonaNombre,
      telefono: '',
      lat: geo.lat,
      lng: geo.lng,
      monto: 0,
      unidades: 1,
    }
    setParadas(actual => [...actual, nueva])
    setParadaActivaId(stopId)
    setManualCliente('')
    setManualDireccion('')
  }

  const agregarDestinoFrecuente = (destino: FrecuenciaDestino) => {
    const stopId = nuevoId()
    const nueva: ParadaRuta = {
      id: stopId,
      orden: paradas.length + 1,
      origen: 'manual',
      ventaId: null,
      ventaCodigo: 'FRECUENTE',
      clienteId: null,
      clienteNombre: destino.clienteNombre,
      direccion: destino.direccion || destino.distrito,
      distrito: destino.distrito,
      zonaNombre: destino.zonaNombre,
      telefono: '',
      lat: destino.lat,
      lng: destino.lng,
      monto: 0,
      unidades: 1,
    }
    setParadas(actual => [...actual, nueva])
    setParadaActivaId(stopId)
    setPestana('constructor')
    notify(`Destino frecuente «${destino.clienteNombre}» añadido a la ruta activa.`)
  }

  const moverParada = (index: number, delta: -1 | 1) => {
    const destino = index + delta
    if (index < 0 || index >= paradas.length || destino < 0 || destino >= paradas.length) return
    setParadas(actual => {
      const copia = [...actual]
      ;[copia[index], copia[destino]] = [copia[destino], copia[index]]
      return copia.map((item, idx) => ({ ...item, orden: idx + 1 }))
    })
  }

  const quitarParada = (stopId: string) => {
    setParadas(actual => actual.filter(item => item.id !== stopId).map((item, idx) => ({ ...item, orden: idx + 1 })))
    if (paradaActivaId === stopId) setParadaActivaId(null)
  }

  const optimizarRuta = () => {
    if (paradas.length < 2) {
      notify('Necesitas al menos 2 paradas para optimizar el orden de salida.')
      return
    }
    const optimizadas = optimizarParadasPorCercania(estacionamientoVisual, paradas)
    setParadas(optimizadas)
    notify('Ruta reordenada por cercanía desde el estacionamiento.')
  }

  const limpiarSimulacion = () => {
    setRutaEditandoId(undefined)
    setParadas([])
    setParadaActivaId(null)
    setModoMapa({ tipo: 'navegar' })
    setObservaciones('')
    setNombreRuta(`Ruta de despacho ${fechaRuta}`)
  }

  const handleGuardarRuta = async (conDespacho: boolean) => {
    if (!paradas.length) {
      notify('Agrega al menos una parada o pedido para guardar la ruta.')
      return
    }
    if (!nombreRuta.trim()) {
      notify('Indica un nombre identificador para guardar la ruta en el repertorio.')
      return
    }
    setGuardando(true)
    try {
      let despachoCreadoId: string | null = null
      let despachoNumero = ''

      if (conDespacho) {
        const ventasPorId = new Map(
          ventasDespachables(records.sales, records.customers, contexto.zonaPorCliente, new Set(contexto.ventasConPedido)).map(
            v => [v.ventaId, v],
          ),
        )
        const paradasConVenta = paradas.filter((p): p is ParadaRuta & { ventaId: string } => Boolean(p.ventaId))
        if (!paradasConVenta.length) {
          notify('Para generar un despacho borrador la ruta debe incluir al menos un pedido vinculado.')
          setGuardando(false)
          return
        }

        const despachosActuales = await despachoServicio.listar()
        const paradasDespacho: Parada[] = []
        for (const p of paradasConVenta) {
          const ventaObj = ventasPorId.get(p.ventaId)
          if (!ventaObj) continue
          const lineas = await fuente.lineasVenta(p.ventaId)
          const construida = construirParada(ventaObj, lineas, despachosActuales, nuevoId())
          if (construida) {
            paradasDespacho.push({
              ...construida,
              orden: paradasDespacho.length + 1,
              direccion: p.direccion || construida.direccion,
              zonaNombre: p.zonaNombre || p.distrito || construida.zonaNombre,
            })
          }
        }

        if (!paradasDespacho.length) {
          notify('Los pedidos seleccionados ya tienen despacho completo; puedes guardar la ruta solo en el repertorio histórico.')
          setGuardando(false)
          return
        }

        const almacenSel = contexto.almacenes.find(a => a.id === almacenId)
        const despachoCreado = await despachoServicio.guardarBorrador({
          fecha: fechaRuta,
          prioridad: 'normal',
          almacenId: almacenId || null,
          almacenNombre: almacenSel?.nombre ?? '',
          pesoEstimadoKg: null,
          observaciones: observaciones.trim() || `Generado desde Mapa de rutas (${nombreRuta.trim()})`,
          paradas: paradasDespacho,
          vehiculoId: vehiculoId || null,
          conductorId: conductorId || null,
          desde: '',
          hasta: '',
        })
        despachoCreadoId = despachoCreado.id
        despachoNumero = despachoCreado.numero
      }

      const conductorSel = conductores.find(c => c.id === conductorId)
      const vehiculoSel = vehiculos.find(v => v.id === vehiculoId)
      const almacenSel = contexto.almacenes.find(a => a.id === almacenId)

      const resp = await rutasServicio.guardarRuta({
        id: rutaEditandoId,
        nombre: nombreRuta,
        fecha: fechaRuta,
        almacenId: almacenId || null,
        almacenNombre: almacenSel?.nombre ?? '',
        estacionamientoId: estacionamientoVisual.id.startsWith('default') ? null : estacionamientoVisual.id,
        estacionamientoNombre: estacionamientoVisual.nombre,
        estacionamientoLat: estacionamientoVisual.lat,
        estacionamientoLng: estacionamientoVisual.lng,
        conductorId: conductorId || null,
        conductorNombre: conductorSel?.nombre ?? '',
        vehiculoId: vehiculoId || null,
        vehiculoPlaca: vehiculoSel?.placa ?? '',
        despachoId: despachoCreadoId,
        paradas,
        retornarBase,
        distanciaTotalKm: distanciaFinalKm,
        tiempoEstimadoMin: tiempoFinalMin,
        observaciones,
      })

      setRutaEditandoId(resp.item.id)
      setRutasEnNavegador(prev => prev || resp.enNavegador)
      notify(
        despachoNumero
          ? `Ruta almacenada en el repertorio y despacho borrador ${despachoNumero} creado.`
          : 'Ruta almacenada en el repertorio histórico.',
      )
      recargar()
    } catch (reason) {
      notify(friendlyError(reason))
    } finally {
      setGuardando(false)
    }
  }

  const handleCargarRuta = (ruta: RutaGuardada) => {
    setRutaEditandoId(ruta.id)
    setNombreRuta(ruta.nombre)
    setFechaRuta(ruta.fecha || hoy)
    setAlmacenId(ruta.almacenId ?? '')
    setConductorId(ruta.conductorId ?? '')
    setVehiculoId(ruta.vehiculoId ?? '')
    setRetornarBase(ruta.retornarBase)
    setObservaciones(ruta.observaciones)
    setParadas(ruta.paradas.map((p, idx) => ({ ...p, orden: idx + 1 })))
    setParadaActivaId(ruta.paradas[0]?.id ?? null)
    setPestana('constructor')
    notify(`Ruta «${ruta.nombre}» cargada en el mapa.`)
  }

  const handleEliminarRuta = async (ruta: RutaGuardada) => {
    try {
      await rutasServicio.eliminarRuta(ruta.id)
      if (rutaEditandoId === ruta.id) setRutaEditandoId(undefined)
      notify(`Ruta «${ruta.nombre}» eliminada del repertorio.`)
      recargar()
    } catch (reason) {
      notify(friendlyError(reason))
    }
  }

  if (!permisos.ver) {
    return (
      <section className="ws-card ws-empty-compact">
        <ShieldCheck size={28} />
        <strong>Acceso restringido a Logística</strong>
        <span>Tu rol necesita permiso de consulta para gestionar el mapa y repertorio de rutas.</span>
      </section>
    )
  }

  return (
    <div className="ec-logistica">
      <PageHeader
        section="Logística y Transporte / Mapa y repertorio"
        title="Mapa y planificación de rutas"
        description="Define el estacionamiento de salida, asigna pedidos a un conductor y visualiza cómo se construye el recorrido por calles reales para guardar estadísticas de destinos frecuentes."
        icon={MapPinned}
        actions={
          <button className="ws-button ws-button-secondary" type="button" disabled={cargando} onClick={recargar}>
            <RefreshCw size={16} className={cargando ? 'ws-spin' : ''} />
            Actualizar
          </button>
        }
      />

      <section className="ec-log-metrics" aria-label="Resumen de rutas y repertorio">
        <article>
          <span>Estacionamiento de salida</span>
          <strong style={{ fontSize: 18, lineHeight: 1.25 }}>{estacionamientoVisual.distrito || 'Lima'}</strong>
          <small>{`${estacionamientoVisual.nombre} · ${estacionamientoVisual.direccion || 'Sin dirección'}`}</small>
        </article>
        <article>
          <span>Paradas en ruta activa</span>
          <strong>{paradas.length}</strong>
          <small>{`${distanciaFinalKm.toFixed(1)} km · ~${tiempoFinalMin} min`}</small>
        </article>
        <article>
          <span>Rutas en repertorio</span>
          <strong>{rutasGuardadas.length}</strong>
          <small>{`${analitica.totalParadasAnalizadas} entregas registradas en ${analitica.totalRutasAnalizadas} ruta(s)`}</small>
        </article>
        <article>
          <span>Zona / destino frecuente</span>
          <strong style={{ fontSize: 18, lineHeight: 1.25 }}>
            {analitica.distritoTop ? analitica.distritoTop.distrito : 'Sin histórico'}
          </strong>
          <small>
            {analitica.destinoTop
              ? `Más repetido: ${analitica.destinoTop.clienteNombre} (${analitica.destinoTop.repeticiones}×)`
              : 'Guarda rutas o despachos para analizar frecuencias'}
          </small>
        </article>
      </section>

      {rutasEnNavegador && (
        <div className="ws-notice" role="status">
          <AlertTriangle size={18} />
          <span>
            <b>Estacionamiento y repertorio guardados temporalmente en este navegador.</b> Aplica la migración{' '}
            <code>20261119000012_logistica_rutas_y_estacionamiento.sql</code> en Supabase para compartir el repertorio con todo el equipo.
          </span>
        </div>
      )}
      {error && (
        <div className="ws-notice ws-notice-warning" role="alert">
          <AlertTriangle size={18} />
          <span>{error}</span>
          <button className="ws-text-button" type="button" onClick={recargar}>
            Reintentar
          </button>
        </div>
      )}

      <div className="ws-tabs ws-fleet-tabs" role="tablist" aria-label="Vistas del módulo de rutas" style={{ marginBottom: 16 }}>
        <button
          id="rutas-tab-constructor"
          role="tab"
          aria-selected={pestana === 'constructor'}
          aria-controls="rutas-panel"
          onClick={() => setPestana('constructor')}
        >
          <Route size={14} />
          Constructor y mapa de ruta
          <b>{paradas.length}</b>
        </button>
        <button
          id="rutas-tab-repertorio"
          role="tab"
          aria-selected={pestana === 'repertorio'}
          aria-controls="rutas-panel"
          onClick={() => setPestana('repertorio')}
        >
          <BarChart3 size={14} />
          Repertorio y destinos frecuentes
          <b>{rutasGuardadas.length}</b>
        </button>
      </div>

      <div id="rutas-panel" role="tabpanel" aria-labelledby={`rutas-tab-${pestana}`}>
        {pestana === 'constructor' && (
          <>
            <section className="ws-card ec-rutas-parking-bar">
              <div className="ec-rutas-parking-head">
                <div className="ec-rutas-parking-id">
                  <span className="ec-rutas-parking-badge">P</span>
                  <div className="ec-rutas-parking-meta">
                    <strong>{estacionamientoVisual.nombre}</strong>
                    <span>{`${estacionamientoVisual.direccion || 'Sin dirección'} · Distrito: ${estacionamientoVisual.distrito || 'Por definir'}`}</span>
                    <small>{`Coordenadas: ${estacionamientoVisual.lat.toFixed(5)}, ${estacionamientoVisual.lng.toFixed(5)}${estacionamientoVisual.referencia ? ` · ${estacionamientoVisual.referencia}` : ''}`}</small>
                  </div>
                </div>
                {puedeConfigurarParking && (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button
                      className="ws-button ws-button-secondary"
                      type="button"
                      onClick={() => setModoMapa({ tipo: 'estacionamiento' })}
                    >
                      <Crosshair size={14} />
                      Fijar clic en el mapa
                    </button>
                    <button
                      className="ws-button ws-button-secondary"
                      type="button"
                      onClick={() => {
                        setParkingDraft(estacionamientoVisual)
                        setEditandoParking(v => !v)
                      }}
                    >
                      <Pencil size={14} />
                      {editandoParking ? 'Ocultar editor' : 'Configurar estacionamiento'}
                    </button>
                  </div>
                )}
              </div>

              {editandoParking && (
                <div className="ws-form ec-rutas-form">
                  <div className="ec-rutas-parking-grid">
                    <label>
                      Nombre del estacionamiento
                      <input
                        value={parkingDraft.nombre}
                        onChange={e => setParkingDraft(actual => ({ ...actual, nombre: e.target.value }))}
                        placeholder="Ej. Estacionamiento Base Norte"
                      />
                    </label>
                    <label>
                      Dirección
                      <input
                        value={parkingDraft.direccion}
                        onChange={e => setParkingDraft(actual => ({ ...actual, direccion: e.target.value }))}
                        placeholder="Ej. Av. Antúnez de Mayolo 850"
                      />
                    </label>
                    <div className="ec-rutas-field">
                      <span>Distrito (centra coordenadas)</span>
                      <SearchablePicker
                        ariaLabel="Distrito del estacionamiento"
                        value={parkingDraft.distrito}
                        options={distritoOptions}
                        onChange={nombre => {
                          const dist = DISTRITOS_LIMA.find(item => item.nombre === nombre)
                          setParkingDraft(actual => ({
                            ...actual,
                            distrito: nombre,
                            lat: dist ? dist.lat : actual.lat,
                            lng: dist ? dist.lng : actual.lng,
                          }))
                        }}
                      />
                    </div>
                    <label>
                      Referencia operativa
                      <input
                        value={parkingDraft.referencia}
                        onChange={e => setParkingDraft(actual => ({ ...actual, referencia: e.target.value }))}
                        placeholder="Puerta de carga, cochera, horario"
                      />
                    </label>
                    <label>
                      Latitud
                      <input
                        type="number"
                        step="0.0001"
                        value={parkingDraft.lat}
                        onChange={e => setParkingDraft(actual => ({ ...actual, lat: Number(e.target.value) || actual.lat }))}
                      />
                    </label>
                    <label>
                      Longitud
                      <input
                        type="number"
                        step="0.0001"
                        value={parkingDraft.lng}
                        onChange={e => setParkingDraft(actual => ({ ...actual, lng: Number(e.target.value) || actual.lng }))}
                      />
                    </label>
                    <div className="ec-rutas-parking-actions">
                      <button
                        className="ws-button ws-button-secondary"
                        type="button"
                        onClick={() => {
                          setParkingDraft(estacionamiento)
                          setEditandoParking(false)
                          setModoMapa({ tipo: 'navegar' })
                        }}
                      >
                        Cancelar
                      </button>
                      <button className="ws-button" type="button" disabled={guardandoParking} onClick={() => void handleGuardarParking()}>
                        <Save size={14} />
                        {guardandoParking ? 'Guardando…' : 'Guardar estacionamiento'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </section>

            <div className="ec-rutas-layout">
              <aside className="ec-rutas-sidebar">
                <section className="ws-card ec-rutas-panel">
                  <div className="ec-rutas-panel-head">
                    <h2>1. Unidad, conductor y parámetros</h2>
                    <span className="status-pill blue">{rutaEditandoId ? 'Editando ruta' : 'Simulación'}</span>
                  </div>
                  <div className="ws-form ec-rutas-form">
                    <div className="ws-form-grid">
                      <label className="ec-rutas-span-2">
                        Nombre de la ruta
                        <input
                          value={nombreRuta}
                          onChange={e => setNombreRuta(e.target.value)}
                          placeholder="Ej. Circuito Norte mañana"
                        />
                      </label>
                      <div className="ec-rutas-field">
                        <span>Conductor asignado</span>
                        <SearchablePicker
                          ariaLabel="Conductor asignado"
                          value={conductorId}
                          options={conductorOptions}
                          placeholder="Sin conductor asignado"
                          onChange={setConductorId}
                        />
                      </div>
                      <div className="ec-rutas-field">
                        <span>Vehículo</span>
                        <SearchablePicker
                          ariaLabel="Vehículo asignado"
                          value={vehiculoId}
                          options={vehiculoOptions}
                          placeholder="Sin vehículo asignado"
                          onChange={setVehiculoId}
                        />
                      </div>
                      <div className="ec-rutas-field">
                        <span>Almacén de carga</span>
                        <SearchablePicker
                          ariaLabel="Almacén de carga"
                          value={almacenId}
                          options={almacenOptions}
                          placeholder="Opcional / multi-almacén"
                          onChange={setAlmacenId}
                        />
                      </div>
                      <label>
                        Fecha operativa
                        <input type="date" value={fechaRuta} onChange={e => setFechaRuta(e.target.value)} />
                      </label>
                      <label className="ec-rutas-check ec-rutas-span-2">
                        <input type="checkbox" checked={retornarBase} onChange={e => setRetornarBase(e.target.checked)} />
                        Incluir tramo de retorno al estacionamiento al terminar entregas
                      </label>
                    </div>
                  </div>
                </section>

                <section className="ws-card ec-rutas-panel">
                  <div className="ec-rutas-panel-head">
                    <h2>2. Pedidos para asignar al conductor</h2>
                    <button className="ws-text-button" type="button" onClick={() => setSoloPendientes(v => !v)}>
                      {soloPendientes ? 'Incluir ya despachadas' : 'Solo pendientes'}
                    </button>
                  </div>

                  <div className="ec-rutas-search-box">
                    <Search size={14} />
                    <input
                      value={busquedaVenta}
                      onChange={e => setBusquedaVenta(e.target.value)}
                      placeholder="Buscar por código, cliente o distrito…"
                    />
                    {busquedaVenta && (
                      <button className="ws-text-button" type="button" onClick={() => setBusquedaVenta('')} aria-label="Limpiar búsqueda">
                        <X size={13} />
                      </button>
                    )}
                  </div>

                  <div className="ec-rutas-orders-list">
                    {ventasDisponibles.map(venta => {
                      const asignada = ventasAsignadasSet.has(venta.ventaId)
                      return (
                        <article className="ec-rutas-order-card" key={venta.ventaId} data-selected={asignada}>
                          <div className="ec-rutas-order-info">
                            <div className="ec-rutas-order-top">
                              <span className="record-id">{venta.codigo}</span>
                              {venta.cobertura === 'parcial' && <span className="status-pill blue">Parcial</span>}
                              {venta.cobertura === 'completa' && <span className="status-pill green">Despachada</span>}
                              <small>{money(venta.monto)}</small>
                            </div>
                            <strong>{venta.clienteNombre}</strong>
                            <small>
                              {venta.direccion
                                ? `${venta.direccion} · ${venta.distritoEstimado}`
                                : `Distrito estimado: ${venta.distritoEstimado} (${venta.zonaEstimada})`}
                            </small>
                          </div>
                          <button
                            className={`ws-button ${asignada ? 'ws-button-secondary' : ''}`}
                            type="button"
                            onClick={() => asignarVentaARuta(venta)}
                          >
                            {asignada ? (
                              <>
                                <Check size={14} />
                                Quitar
                              </>
                            ) : (
                              <>
                                <Plus size={14} />
                                Asignar
                              </>
                            )}
                          </button>
                        </article>
                      )
                    })}
                    {!ventasDisponibles.length && (
                      <div className="ws-empty-compact" style={{ paddingBlock: 18 }}>
                        <Truck size={22} />
                        <strong>No hay ventas visibles con este filtro</strong>
                        <span>Prueba desactivando «Solo pendientes» o agrega una parada manual abajo.</span>
                      </div>
                    )}
                  </div>
                </section>

                <section className="ws-card ec-rutas-panel">
                  <div className="ec-rutas-panel-head">
                    <h2>3. Agregar parada manual / punto libre</h2>
                  </div>
                  <div className="ws-form ec-rutas-form">
                    <div className="ws-form-grid">
                      <label className="ec-rutas-span-2">
                        Destinatario o punto
                        <input
                          value={manualCliente}
                          onChange={e => setManualCliente(e.target.value)}
                          placeholder="Ej. Sucursal Surco o cliente nuevo"
                        />
                      </label>
                      <label>
                        Dirección o avenida
                        <input
                          value={manualDireccion}
                          onChange={e => setManualDireccion(e.target.value)}
                          placeholder="Ej. Av. Benavides 3400"
                        />
                      </label>
                      <div className="ec-rutas-field">
                        <span>Distrito</span>
                        <SearchablePicker
                          ariaLabel="Distrito de parada manual"
                          value={manualDistrito}
                          options={distritoOptions}
                          onChange={setManualDistrito}
                        />
                      </div>
                      <div className="ec-rutas-span-2" style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <button className="ws-button ws-button-secondary" type="button" onClick={agregarParadaManual}>
                          <Plus size={14} />
                          Sumar parada al mapa
                        </button>
                      </div>
                    </div>
                  </div>
                </section>
              </aside>

              <div className="ec-rutas-main-col">
                <MapaGoogleStyleLima
                  estacionamiento={estacionamientoVisual}
                  paradas={paradas}
                  tramos={metricas.tramos}
                  osrmRuta={osrmRuta}
                  cargandoRutaVial={cargandoRutaVial}
                  retornarBase={retornarBase}
                  modoMapa={modoMapa}
                  paradaActivaId={paradaActivaId}
                  onSeleccionarParada={setParadaActivaId}
                  onCambiarModo={setModoMapa}
                  onColocarEstacionamiento={handleColocarParkingEnMapa}
                  onReubicarParada={handleReubicarParadaEnMapa}
                  onMoverParada={moverParada}
                  onQuitarParada={quitarParada}
                />

                <section className="ws-card ec-rutas-panel">
                  <div className="ec-rutas-panel-head">
                    <h2>{`Secuencia de ruta y tramos (${paradas.length} paradas)`}</h2>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button className="ws-button ws-button-secondary" type="button" disabled={paradas.length < 2} onClick={optimizarRuta}>
                        <Sparkles size={14} />
                        Optimizar por cercanía
                      </button>
                      <button className="ws-button ws-button-secondary" type="button" disabled={!paradas.length} onClick={limpiarSimulacion}>
                        <RotateCcw size={14} />
                        Limpiar simulación
                      </button>
                    </div>
                  </div>

                  {paradas.length > 0 ? (
                    <div className="ec-rutas-stop-list">
                      {paradas.map((parada, idx) => {
                        const tramoFallback = metricas.tramos[idx]
                        const tramoOsrm = osrmRuta?.tramos[idx]
                        const km = tramoOsrm ? tramoOsrm.distanciaKm : tramoFallback?.distanciaKm
                        const min = tramoOsrm ? tramoOsrm.tiempoMin : tramoFallback?.tiempoMin
                        return (
                          <article
                            key={parada.id}
                            className="ec-rutas-stop-item"
                            data-active={parada.id === paradaActivaId}
                            onClick={() => setParadaActivaId(parada.id)}
                          >
                            <span className="ec-rutas-stop-num">{parada.orden}</span>
                            <div className="ec-rutas-stop-body">
                              <strong>{`${parada.clienteNombre} · ${parada.ventaCodigo}`}</strong>
                              <span>{parada.direccion}</span>
                              <small>
                                {`${parada.distrito} (${parada.zonaNombre})`}
                                {km !== undefined
                                  ? ` · Tramo ${idx === 0 ? 'desde estacionamiento' : `desde parada ${idx}`}: ${km} km (~${min} min)`
                                  : ''}
                              </small>
                            </div>
                            <div className="ec-rutas-stop-controls" onClick={e => e.stopPropagation()}>
                              <div style={{ minWidth: 168 }}>
                                <SearchablePicker
                                  ariaLabel={`Distrito de parada ${parada.orden}`}
                                  value={parada.distrito}
                                  options={distritoOptions}
                                  onChange={nombre => {
                                    const geo = resolverUbicacionParada({
                                      distrito: nombre,
                                      direccion: parada.direccion,
                                      clienteNombre: parada.clienteNombre,
                                      semilla: parada.ventaCodigo || parada.id,
                                    })
                                    setParadas(actual =>
                                      actual.map(item =>
                                        item.id === parada.id
                                          ? { ...item, distrito: geo.distrito, zonaNombre: geo.zonaNombre, lat: geo.lat, lng: geo.lng }
                                          : item,
                                      ),
                                    )
                                  }}
                                />
                              </div>
                              <button
                                className="row-action"
                                type="button"
                                disabled={idx === 0}
                                onClick={() => moverParada(idx, -1)}
                                title="Mover antes"
                              >
                                <ArrowUp size={14} />
                              </button>
                              <button
                                className="row-action"
                                type="button"
                                disabled={idx === paradas.length - 1}
                                onClick={() => moverParada(idx, 1)}
                                title="Mover después"
                              >
                                <ArrowDown size={14} />
                              </button>
                              <button
                                className="row-action"
                                type="button"
                                onClick={() => setModoMapa({ tipo: 'parada', stopId: parada.id })}
                                title="Reubicar haciendo clic en el mapa"
                              >
                                <Navigation size={14} />
                              </button>
                              <button
                                className="row-action delete"
                                type="button"
                                onClick={() => quitarParada(parada.id)}
                                title="Quitar de la ruta"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </article>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="ws-empty-compact" style={{ paddingBlock: 22 }}>
                      <MapPinned size={24} />
                      <strong>Tu ruta todavía no tiene paradas</strong>
                      <span>Asigna pedidos o agrega un punto manual en el panel izquierdo para ver los tramos trazados en el mapa.</span>
                    </div>
                  )}

                  <div className="ec-rutas-save-bar">
                    <div style={{ fontSize: 12, color: 'var(--ws-muted)' }}>
                      {metricas.distritosRecorridos.length
                        ? `Zonas cubiertas: ${metricas.distritosRecorridos.join(' → ')} · Total: ${distanciaFinalKm.toFixed(1)} km (~${tiempoFinalMin} min)`
                        : 'Puedes simular rutas libremente o guardarlas en tu repertorio histórico.'}
                    </div>
                    {permisos.crear && (
                      <div className="ec-rutas-save-actions">
                        <button
                          className="ws-button ws-button-secondary"
                          type="button"
                          disabled={guardando || !paradas.length}
                          onClick={() => void handleGuardarRuta(false)}
                        >
                          <Save size={15} />
                          {guardando ? 'Guardando…' : 'Guardar solo en repertorio'}
                        </button>
                        <button
                          className="ws-button"
                          type="button"
                          disabled={guardando || !paradas.length}
                          onClick={() => void handleGuardarRuta(true)}
                        >
                          <Truck size={15} />
                          {guardando ? 'Procesando…' : 'Guardar ruta y crear despacho'}
                        </button>
                      </div>
                    )}
                  </div>
                </section>
              </div>
            </div>
          </>
        )}

        {pestana === 'repertorio' && (
          <>
            <div className="ec-rutas-analytics-grid">
              <section className="ws-card ec-rutas-panel">
                <div className="ec-rutas-panel-head">
                  <h2>Distritos y zonas con más reparto</h2>
                  <span style={{ fontSize: 12, color: 'var(--ws-muted)' }}>
                    {`${analitica.totalParadasAnalizadas} entregas registradas`}
                  </span>
                </div>
                {analitica.distritosFrecuentes.length > 0 ? (
                  <div className="ec-rutas-distrito-bars">
                    {analitica.distritosFrecuentes.slice(0, 10).map(dist => (
                      <div className="ec-rutas-distrito-row" key={dist.distrito}>
                        <div className="ec-rutas-distrito-label">
                          <span>
                            <strong>{dist.distrito}</strong>
                            <small style={{ marginLeft: 8, color: 'var(--ws-muted)' }}>{dist.zonaNombre}</small>
                          </span>
                          <span>{`${dist.entregas} entrega(s) · ${dist.porcentaje}%`}</span>
                        </div>
                        <div className="ec-rutas-bar-track">
                          <div className="ec-rutas-bar-fill" style={{ width: `${Math.max(6, dist.porcentaje)}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="ws-empty-compact">
                    <BarChart3 size={24} />
                    <strong>Sin historial de distritos todavía</strong>
                    <span>Guarda al menos una ruta para visualizar la distribución geográfica del reparto.</span>
                  </div>
                )}
              </section>

              <section className="ws-card ec-rutas-panel">
                <div className="ec-rutas-panel-head">
                  <h2>Destinos que más se repiten</h2>
                  <span style={{ fontSize: 12, color: 'var(--ws-muted)' }}>
                    Clientes y direcciones recurrentes (rutas + despachos)
                  </span>
                </div>
                <div className="table-scroll">
                  <table className="record-table">
                    <thead>
                      <tr>
                        <th>Cliente / destino</th>
                        <th>Distrito</th>
                        <th>Repeticiones</th>
                        <th>Última fecha</th>
                        <th><span className="sr-only">Usar</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {analitica.destinosFrecuentes.slice(0, 12).map(dest => (
                        <tr key={dest.clave}>
                          <td>
                            <strong>{dest.clienteNombre}</strong>
                            <small>{dest.direccion}</small>
                          </td>
                          <td>
                            {dest.distrito}
                            <small>{dest.zonaNombre}</small>
                          </td>
                          <td>
                            <span className="status-pill blue">{`${dest.repeticiones} visita(s)`}</span>
                          </td>
                          <td>{dest.ultimaFecha ? formatoFecha(dest.ultimaFecha) : '—'}</td>
                          <td>
                            <button
                              className="ws-button ws-button-secondary"
                              type="button"
                              onClick={() => agregarDestinoFrecuente(dest)}
                            >
                              <Plus size={13} />
                              Usar
                            </button>
                          </td>
                        </tr>
                      ))}
                      {!analitica.destinosFrecuentes.length && (
                        <tr>
                          <td colSpan={5}>
                            <div className="ws-empty-compact">
                              <MapPin size={24} />
                              <strong>No hay destinos repetidos registrados</strong>
                              <span>Al almacenar rutas irán apareciendo aquí los clientes y direcciones más visitados.</span>
                            </div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>

            <section className="ws-card ec-rutas-panel">
              <div className="ec-rutas-panel-head">
                <h2>Repertorio de rutas almacenadas</h2>
                <button className="ws-button ws-button-secondary" type="button" onClick={() => setPestana('constructor')}>
                  <Plus size={14} />
                  Nueva ruta en el mapa
                </button>
              </div>
              <div className="table-scroll">
                <table className="record-table">
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Nombre de ruta</th>
                      <th>Estacionamiento</th>
                      <th>Conductor / unidad</th>
                      <th>Paradas</th>
                      <th>Distancia / tiempo</th>
                      <th><span className="sr-only">Acciones</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rutasGuardadas.map(ruta => (
                      <tr key={ruta.id}>
                        <td>{formatoFecha(ruta.fecha)}</td>
                        <td>
                          <strong>{ruta.nombre}</strong>
                          <small>{ruta.paradas.map(p => p.distrito).filter(Boolean).join(' → ') || 'Sin paradas'}</small>
                        </td>
                        <td>{ruta.estacionamientoNombre || 'Base'}</td>
                        <td>
                          {ruta.conductorNombre || 'Sin conductor'}
                          <small>{ruta.vehiculoPlaca || 'Sin placa asignada'}</small>
                        </td>
                        <td>{`${ruta.paradas.length} parada(s)`}</td>
                        <td>{`${ruta.distanciaTotalKm.toFixed(1)} km · ~${ruta.tiempoEstimadoMin} min`}</td>
                        <td>
                          <div className="row-actions">
                            <button className="ws-button ws-button-secondary" type="button" onClick={() => handleCargarRuta(ruta)}>
                              <Route size={14} />
                              Cargar en mapa
                            </button>
                            {permisos.editar && (
                              <button
                                className="row-action delete"
                                type="button"
                                onClick={() => void handleEliminarRuta(ruta)}
                                title="Eliminar del repertorio"
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {!rutasGuardadas.length && (
                      <tr>
                        <td colSpan={7}>
                          <div className="ws-empty-compact">
                            <Route size={26} />
                            <strong>Aún no has guardado rutas en el repertorio</strong>
                            <span>Construye un recorrido desde el mapa y elige «Guardar solo en repertorio» o «Guardar ruta y crear despacho».</span>
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  )
}

export default function RutasPage() {
  const almacen = useAlmacenLogistica()
  if (!almacen) {
    return (
      <section className="ws-card ws-empty-compact">
        <RefreshCw size={20} className="ws-spin" />
        <strong>Cargando…</strong>
      </section>
    )
  }
  return <RutasContenido almacen={almacen} />
}
